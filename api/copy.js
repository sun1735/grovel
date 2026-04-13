/**
 * /api/copy/* — AI 카피 생성기
 *
 * 비로그인 IP 기반 일 3회, 로그인 일 20회 제한.
 */
const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { complete } = require('../worker/llm');

const router = express.Router();

const ANON_DAILY_LIMIT  = 3;
const USER_DAILY_LIMIT  = 20;

const VALID_PLATFORMS = ['naver', 'meta', 'kakao', 'google', 'youtube', 'instagram'];
const VALID_TONES = ['professional', 'friendly', 'urgent', 'emotional', 'humorous'];

function ipHash(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 32);
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress
      || 'unknown';
}

// ─────────────────────────────────────────────
// GET /api/copy/usage — 현재 사용량 조회
// ─────────────────────────────────────────────
router.get('/usage', async (req, res) => {
  try {
    let used, limit;
    if (req.user) {
      const r = await query(
        `SELECT COUNT(*)::int AS c FROM copy_gen_usage
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [req.user.id]
      );
      used = r.rows[0].c;
      limit = USER_DAILY_LIMIT;
    } else {
      const hash = ipHash(clientIp(req));
      const r = await query(
        `SELECT COUNT(*)::int AS c FROM copy_gen_usage
         WHERE ip_hash = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [hash]
      );
      used = r.rows[0].c;
      limit = ANON_DAILY_LIMIT;
    }
    res.json({ used, limit, remaining: Math.max(0, limit - used), is_logged_in: !!req.user });
  } catch (err) {
    res.status(500).json({ error: 'failed' });
  }
});

// ─────────────────────────────────────────────
// POST /api/copy/generate — 카피 생성
// body: { product, target, tone, platforms: ['naver','meta',...] }
// ─────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { product, category, target, tone, platforms } = req.body || {};

  // 입력 검증
  if (!product || product.length < 2 || product.length > 100) {
    return res.status(400).json({ error: 'invalid_product', message: '제품명을 2~100자로 입력하세요.' });
  }
  if (!Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ error: 'no_platforms', message: '플랫폼을 1개 이상 선택하세요.' });
  }
  const validPlat = platforms.filter(p => VALID_PLATFORMS.includes(p));
  if (validPlat.length === 0) {
    return res.status(400).json({ error: 'invalid_platforms' });
  }
  if (validPlat.length > 4) {
    return res.status(400).json({ error: 'too_many', message: '플랫폼은 한 번에 최대 4개까지.' });
  }

  // 레이트리밋
  try {
    let used, limit;
    if (req.user) {
      const r = await query(
        `SELECT COUNT(*)::int AS c FROM copy_gen_usage
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [req.user.id]
      );
      used = r.rows[0].c;
      limit = USER_DAILY_LIMIT;
    } else {
      const hash = ipHash(clientIp(req));
      const r = await query(
        `SELECT COUNT(*)::int AS c FROM copy_gen_usage
         WHERE ip_hash = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [hash]
      );
      used = r.rows[0].c;
      limit = ANON_DAILY_LIMIT;
    }
    if (used >= limit) {
      return res.status(429).json({
        error: 'rate_limit',
        message: req.user
          ? `일일 한도(${limit}회)를 모두 사용했습니다. 24시간 후에 다시 시도하세요.`
          : `일일 한도(${limit}회)를 모두 사용했습니다. 회원가입하면 일 ${USER_DAILY_LIMIT}회까지 가능합니다.`,
        limit, used, is_logged_in: !!req.user,
      });
    }
  } catch (err) {
    console.error('[copy/rate-limit-check]', err);
  }

  // 프롬프트
  const PLATFORM_SPECS = {
    naver:     '네이버 검색광고: 제목 15자 이내, 설명 45자 이내. 키워드 명확.',
    meta:      '메타(페이스북/인스타) 광고: 헤드라인 40자 이내, 본문 125자 이내. 첫 줄 후킹 + CTA.',
    kakao:     '카카오 비즈보드: 메인 카피 25자 이내, 서브 카피 50자 이내. 직설적.',
    google:    '구글 검색광고: 헤드라인 30자 이내, 설명 90자 이내. USP 명확.',
    youtube:   '유튜브 인스트림 첫 5초 후킹 카피: 30자 이내. 호기심 자극.',
    instagram: '인스타그램 캐러셀(5장)용 짧은 카피: 각 장 20자 이내.',
  };

  const TONE_DESC = {
    professional: '전문적이고 신뢰감 있는',
    friendly:     '친근하고 편안한',
    urgent:       '긴급하고 행동을 유도하는',
    emotional:    '감성적이고 공감 가는',
    humorous:     '재치 있고 유머러스한',
  };

  const system = `당신은 한국 마케팅 카피 전문가입니다. 한국 광고 플랫폼별 글자수 제한과 스타일을 정확히 알고 있으며, 한국 소비자의 정서와 문화에 맞는 카피를 작성합니다.
플랫폼 정책을 위반하는 표현(보장, 100%, 1위, 최고 등)은 절대 사용하지 마세요.`;

  const user = `다음 제품의 광고 카피를 생성해 주세요.

# 제품 정보
- 제품명: ${product}
- 카테고리: ${category || '미지정'}
- 타겟 고객: ${target || '일반 소비자'}
- 톤앤매너: ${TONE_DESC[tone] || '친근하고 편안한'}

# 생성할 플랫폼
${validPlat.map(p => `- ${p}: ${PLATFORM_SPECS[p]}`).join('\n')}

# 출력 형식
다음 JSON 형식으로 정확히 응답하세요. 각 플랫폼당 5개의 카피를 만드세요.

{
  "copies": {
${validPlat.map(p => `    "${p}": [
      { "title": "...", "body": "..." },
      ...총 5개
    ]`).join(',\n')}
  }
}

# 주의
- 글자수 제한 정확히 지킬 것
- 5개는 서로 다른 각도/접근으로 (가격 강조, 감성 자극, 사회적 증거, 호기심, 긴급성 등)
- 한국 광고 정책 위반 표현 금지
- 다른 설명 없이 JSON만 출력`;

  try {
    const { text, model, usage } = await complete({
      system, user,
      maxTokens: 2500,
      logCtx: { task_type: 'copy_gen', persona_id: null, board_slug: null },
    });

    // JSON 파싱
    let parsed;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'parse_failed', message: 'AI 응답을 해석하지 못했습니다.' });
    }
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return res.status(500).json({ error: 'parse_failed' });
    }

    // 사용 기록
    if (req.user) {
      await query(
        'INSERT INTO copy_gen_usage (user_id) VALUES ($1)',
        [req.user.id]
      );
    } else {
      const hash = ipHash(clientIp(req));
      await query(
        'INSERT INTO copy_gen_usage (ip_hash) VALUES ($1)',
        [hash]
      );
    }

    res.json({
      copies: parsed.copies || {},
      meta: {
        model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    });
  } catch (err) {
    console.error('[copy/generate]', err);
    res.status(500).json({ error: 'llm_failed', message: err.message });
  }
});

module.exports = router;
