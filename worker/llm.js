/**
 * Claude API 래퍼.
 *
 * - engine_log 테이블에 모든 호출 기록 (성공/실패, 토큰, 지연)
 * - JSON 응답 파싱 + 재시도 (식별률·신뢰도 KPI 충족 위함)
 * - 모델 폴백: Sonnet 실패 시 Haiku로 1회 재시도
 */
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { query } = require('../db');

const PRIMARY_MODEL  = process.env.LLM_MODEL || 'claude-sonnet-4-6';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS     = parseInt(process.env.LLM_MAX_TOKENS || '2000');
const REQUEST_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '30000');     // 요청당 30초
const HOURLY_LIMIT       = parseInt(process.env.LLM_HOURLY_LIMIT || '60');       // 시간당 60회
const DAILY_LIMIT        = parseInt(process.env.LLM_DAILY_LIMIT || '500');       // 일 500회

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY가 설정되지 않았습니다. .env 파일에 추가하세요.');
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: REQUEST_TIMEOUT_MS,  // 요청당 timeout
  maxRetries: 0,                // SDK 자체 재시도 비활성 — 우리가 명시적 제어
});

// 시간당·일일 호출 한도 확인 (비용 폭주 방어)
async function checkQuota() {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM engine_log WHERE created_at > NOW() - INTERVAL '1 hour') AS hourly,
       (SELECT COUNT(*)::int FROM engine_log WHERE created_at > NOW() - INTERVAL '24 hours') AS daily`
  );
  const { hourly, daily } = rows[0];
  if (hourly >= HOURLY_LIMIT) {
    throw new Error(`LLM 시간당 한도 초과 (${hourly}/${HOURLY_LIMIT}). 1시간 후 재시도.`);
  }
  if (daily >= DAILY_LIMIT) {
    throw new Error(`LLM 일일 한도 초과 (${daily}/${DAILY_LIMIT}). 24시간 후 재시도.`);
  }
}

// Anthropic rate/overload 에러는 재시도해도 즉시 실패 (429/529/overload_error)
function isRateLimitError(err) {
  if (!err) return false;
  const status = err.status || err.response?.status;
  if (status === 429 || status === 529) return true;
  const name = err.error?.type || err.name || '';
  return /overload|rate_limit/i.test(name);
}

/**
 * LLM에 메시지 전송 후 텍스트 응답 반환
 *
 * @param {object} opts
 * @param {string} opts.system            시스템 프롬프트
 * @param {string} opts.user              유저 프롬프트
 * @param {string} [opts.model]
 * @param {object} [opts.logCtx]          engine_log에 같이 저장할 컨텍스트
 * @returns {Promise<{text: string, model: string, usage: object}>}
 */
async function complete({ system, user, model = PRIMARY_MODEL, maxTokens, logCtx = {} }) {
  // 호출 전 quota 체크 — 초과 시 즉시 예외
  await checkQuota();

  const start = Date.now();
  let usedModel = model;
  const tokens = maxTokens || MAX_TOKENS;
  let result, error;

  try {
    result = await client.messages.create({
      model: usedModel,
      max_tokens: tokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (err) {
    // Rate limit/overload는 폴백 호출 안 함 (똑같이 실패할 것)
    if (isRateLimitError(err)) {
      console.warn(`[llm] ${usedModel} rate/overload (${err.status || err.name}), 폴백 스킵`);
      error = err;
    } else {
      // 그 외 일반 실패 → 폴백 모델로 1회 재시도
      console.warn(`[llm] ${usedModel} 실패: ${err.message} → ${FALLBACK_MODEL}로 폴백`);
      usedModel = FALLBACK_MODEL;
      try {
        result = await client.messages.create({
          model: usedModel,
          max_tokens: tokens,
          system,
          messages: [{ role: 'user', content: user }],
        });
      } catch (err2) {
        error = err2;
      }
    }
  }

  const duration = Date.now() - start;
  const success = !!result && !error;

  // engine_log 기록
  await logToEngine({
    ...logCtx,
    success,
    error_message: error?.message || null,
    llm_model: usedModel,
    input_tokens: result?.usage?.input_tokens || 0,
    output_tokens: result?.usage?.output_tokens || 0,
    duration_ms: duration,
  });

  if (!success) {
    throw new Error(`LLM 호출 실패: ${error?.message || 'unknown'}`);
  }

  // text content blocks 합침
  const text = result.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  return { text, model: usedModel, usage: result.usage };
}

/**
 * LLM에서 JSON 객체를 추출. 실패 시 1회 재시도.
 *
 * @param {object} opts
 * @returns {Promise<object>}
 */
async function completeJson(opts) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text, model, usage } = await complete(opts);
    const parsed = tryParseJson(text);
    if (parsed) return { ...parsed, _meta: { model, usage, attempt } };

    lastErr = new Error('JSON 파싱 실패');
    console.warn(`[llm] JSON 파싱 실패 (attempt ${attempt}). 응답: ${text.slice(0, 200)}...`);

    // 재시도 시 더 명확한 지시 추가
    opts = {
      ...opts,
      user: opts.user + '\n\n⚠️ 이전 응답이 JSON 형식이 아니었습니다. 반드시 {...} JSON 객체로만 응답하세요.',
    };
  }
  throw lastErr;
}

/** ```json ... ``` 블록이나 inline {} 둘 다 처리 */
function tryParseJson(text) {
  // 1. 코드 블록 시도
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }
  // 2. 첫 { 부터 마지막 } 까지
  const first = text.indexOf('{');
  const last  = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

/** engine_log 테이블 기록 */
async function logToEngine(entry) {
  try {
    await query(
      `INSERT INTO engine_log
        (task_type, persona_id, board_slug, success, error_message,
         llm_model, input_tokens, output_tokens, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        entry.task_type || 'unknown',
        entry.persona_id || null,
        entry.board_slug || null,
        entry.success,
        entry.error_message,
        entry.llm_model,
        entry.input_tokens,
        entry.output_tokens,
        entry.duration_ms,
      ]
    );
  } catch (err) {
    console.error('[engine_log] 기록 실패:', err.message);
  }
}

module.exports = { complete, completeJson, PRIMARY_MODEL, FALLBACK_MODEL };
