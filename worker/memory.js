/**
 * 페르소나 컨텍스트 메모리 — 잔존율 KPI 핵심.
 *
 * 페르소나가 과거 대화를 "기억"하게 만들어,
 * 며칠 후에도 "지난번에 말씀하신 그 광고 소재는 어떻게 됐어요?" 같은
 * 개인화된 멘트가 자연스럽게 나오게 한다.
 *
 * 사용 흐름:
 *   1. 댓글/글 생성 후 → extractMemories() 호출 → 핵심 사실을 메모리로 저장
 *   2. 다음 댓글 생성 시 → recallMemories() 호출 → 관련 메모리를 프롬프트에 주입
 */
const { query } = require('../db');
const { complete } = require('./llm');

/**
 * 페르소나가 특정 게시글을 보고 기억할 만한 사실을 추출해 저장
 */
async function extractAndSave(persona, postOrComment) {
  // 너무 짧은 글은 메모리 추출 안 함
  const text = (postOrComment.title || '') + '\n' + (postOrComment.body || '');
  if (text.length < 100) return null;

  try {
    const { text: raw } = await complete({
      system: `당신은 ${persona.archetype} 성향의 페르소나입니다. 다음 게시글에서 당신이 "기억할 만한 한 가지"를 추출하세요. 사람이 친구의 말을 기억하듯, 구체적이고 짧게.`,
      user: `${text}\n\n다음 JSON 형식으로만 응답:\n{"topic_key": "한_단어_핵심키워드", "summary": "한 줄 요약 (40자 이내)"}`,
      logCtx: { task_type: 'memory', persona_id: persona.id },
    });

    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (!parsed.topic_key || !parsed.summary) return null;

    await query(
      `INSERT INTO memory_threads
        (persona_id, topic_key, summary, related_post_id)
       VALUES ($1,$2,$3,$4)`,
      [persona.id, parsed.topic_key.slice(0, 128), parsed.summary.slice(0, 200), postOrComment.id || null]
    );
    return parsed;
  } catch (err) {
    console.warn(`[memory] 추출 실패 (${persona.id}):`, err.message);
    return null;
  }
}

/**
 * 페르소나가 가진 최근 메모리를 N개 가져옴.
 * 댓글 생성 시 프롬프트에 주입한다.
 */
async function recall(personaId, limit = 3) {
  const { rows } = await query(
    `SELECT topic_key, summary, related_post_id, created_at
     FROM memory_threads
     WHERE persona_id = $1
       AND created_at > NOW() - INTERVAL '14 days'
     ORDER BY recall_count ASC, created_at DESC
     LIMIT $2`,
    [personaId, limit]
  );

  if (rows.length > 0) {
    // recall_count 증가 (덜 쓰인 메모리부터 우선 사용하기 위함)
    const ids = rows.map(r => r.related_post_id).filter(Boolean);
    if (ids.length > 0) {
      await query(
        `UPDATE memory_threads
         SET recall_count = recall_count + 1
         WHERE persona_id = $1 AND related_post_id = ANY($2)`,
        [personaId, ids]
      );
    }
  }

  return rows;
}

/**
 * 메모리를 프롬프트 문자열로 포맷
 */
function formatMemoriesForPrompt(memories) {
  if (!memories || memories.length === 0) return '';
  const lines = memories.map(m => `- (${m.topic_key}) ${m.summary}`);
  return [
    '',
    '# 당신의 기억 (자연스럽게 인용 가능. 강제 X)',
    ...lines,
    '※ 위 기억 중 지금 상황에 관련된 것이 있다면, "지난번에...", "전에 말씀하셨던..." 같은 식으로 자연스럽게 언급할 수 있습니다.',
    '',
  ].join('\n');
}

module.exports = { extractAndSave, recall, formatMemoriesForPrompt };
