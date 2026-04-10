/**
 * 댓글 생성 워커.
 *
 * 흐름:
 *   1. 최근 게시글 중 댓글이 부족한 글 선택
 *   2. 원글 작성자와 다른 페르소나 선택 (관계 매트릭스로 톤 조정)
 *   3. 페르소나의 메모리 조회 → 프롬프트에 주입 (잔존율 KPI)
 *   4. 닉네임 회전
 *   5. LLM 호출 → 검증 → DB 저장
 *   6. comment_count 업데이트
 *   7. (선택) 메모리 추출
 *
 * 사용:
 *   node worker/generateComment.js               # 1개 댓글
 *   node worker/generateComment.js --count 10    # 10개
 *   node worker/generateComment.js --post 42     # 특정 글에 1개
 *   node worker/generateComment.js --dry-run
 */
require('dotenv').config();
const { pool, query } = require('../db');
const { getPersona, PERSONA_LIST } = require('../ai/personas');
const {
  pickNickname,
  buildSystemPrompt,
  isActiveHour,
  injectKoreanTypos,
} = require('../ai/protocols');
const { completeJson, complete } = require('./llm');
const { recall, formatMemoriesForPrompt, extractAndSave } = require('./memory');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { count: 1, postId: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count')   out.count = parseInt(args[++i]) || 1;
    if (args[i] === '--post')    out.postId = parseInt(args[++i]);
    if (args[i] === '--dry-run' || args[i] === '--dry') out.dryRun = true;
  }
  return out;
}

// ─────────────────────────────────────────────
// 댓글이 부족한 게시글 선택
// 우선순위: 댓글 0~3개인 최근 글 > 일반 최근 글
// ─────────────────────────────────────────────
async function pickTargetPost(forcedId) {
  if (forcedId) {
    const { rows } = await query(`
      SELECT p.*, b.slug AS board_slug, b.name AS board_name
      FROM posts p JOIN boards b ON b.id = p.board_id
      WHERE p.id = $1`, [forcedId]);
    return rows[0];
  }
  const { rows } = await query(`
    SELECT p.*, b.slug AS board_slug, b.name AS board_name
    FROM posts p
    JOIN boards b ON b.id = p.board_id
    WHERE p.published_at > NOW() - INTERVAL '48 hours'
      AND p.is_pinned = FALSE
    ORDER BY
      (CASE WHEN p.comment_count < 3 THEN 0 ELSE 1 END),
      p.published_at DESC
    LIMIT 30
  `);
  if (rows.length === 0) return null;
  // 상위 30개 중 무작위 (가장 최신만 계속 답변하면 패턴됨)
  return rows[Math.floor(Math.random() * Math.min(rows.length, 10))];
}

// 닉네임 회전 (DB 기반)
async function pickFreshNickname(persona) {
  const { rows } = await query(
    `SELECT nickname FROM nickname_usage
     WHERE persona_id=$1 AND used_at > NOW() - INTERVAL '7 days'
     ORDER BY used_at DESC LIMIT 5`,
    [persona.id]
  );
  const recent = rows.map(r => r.nickname);
  const nick = pickNickname(persona, recent);
  await query('INSERT INTO nickname_usage (persona_id, nickname) VALUES ($1,$2)', [persona.id, nick]);
  return nick;
}

// 댓글 작성자 선택: 원글 작성자와 다른 페르소나, 활동시간 고려
function pickCommenter(post) {
  const candidates = PERSONA_LIST.filter(p => {
    if (p.id === post.persona_id) return false;     // 자기 글에 자기가 댓글 X
    if (!isActiveHour(p) && Math.random() > 0.3) return false;
    // 보드 적합도
    if (p.boards.never?.includes(post.board_slug)) return false;
    return true;
  });
  if (candidates.length === 0) return PERSONA_LIST[Math.floor(Math.random() * PERSONA_LIST.length)];

  // 가중치: primary > secondary > rare
  const weighted = candidates.map(p => {
    let w = 1;
    if (p.boards.primary?.includes(post.board_slug))   w = 8;
    else if (p.boards.secondary?.includes(post.board_slug)) w = 4;
    else if (p.boards.rare?.includes(post.board_slug)) w = 2;
    return { p, w };
  });
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let roll = Math.random() * total;
  for (const { p, w } of weighted) {
    roll -= w;
    if (roll <= 0) return p;
  }
  return weighted[0].p;
}

// 품질 검증
function validateComment(text) {
  if (!text || text.length < 5) return '너무 짧음';
  if (text.length > 600) return '너무 김 (댓글 본문 600자 초과)';
  const aiMarkers = ['저는 AI', '언어 모델', '도움이 되었기를', 'AI 어시스턴트'];
  for (const m of aiMarkers) if (text.includes(m)) return `AI 흔적: "${m}"`;
  return null;
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function generateOneComment(forcedPostId) {
  const post = await pickTargetPost(forcedPostId);
  if (!post) throw new Error('대상 게시글이 없습니다 (최근 48시간 내 글 없음)');

  const persona = pickCommenter(post);
  const nickname = await pickFreshNickname(persona);

  // 페르소나 메모리 조회
  const memories = await recall(persona.id, 3);
  const memoryBlock = formatMemoriesForPrompt(memories);

  console.log(`\n💬 [${post.board_name}] "${post.title.slice(0, 40)}..." 에 댓글`);
  console.log(`   작성자: [${persona.codename}] ${persona.archetype} (${nickname})`);
  if (memories.length > 0) {
    console.log(`   기억: ${memories.length}개 메모리 주입됨`);
  }

  const { system, user } = buildSystemPrompt(persona, {
    task: 'comment',
    board: post.board_slug,
    nickname,
    parentTitle: post.title,
    parentBody: post.body,
    parentAuthor: post.persona_id,
  });

  // 메모리 블록을 system 프롬프트에 추가
  const finalSystem = system + memoryBlock;

  // 댓글은 짧으니 plain complete 사용
  const { text, model } = await complete({
    system: finalSystem,
    user,
    logCtx: { task_type: 'comment', persona_id: persona.id, board_slug: post.board_slug },
  });

  // 따옴표/메타 제거
  let body = text.trim()
    .replace(/^["「『]/, '')
    .replace(/["」』]$/, '')
    .replace(/^\(?답변\)?[:：]\s*/i, '');

  const error = validateComment(body);
  if (error) throw new Error(`품질 검증 실패: ${error}`);

  // 후처리 오타 (30% 확률)
  if (Math.random() < 0.3) {
    body = injectKoreanTypos(body, 0.01);
  }

  return { post, persona, nickname, body, model };
}

async function saveComment(c) {
  const { rows } = await query(
    `INSERT INTO comments (post_id, persona_id, author_nickname, body, is_ai)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id`,
    [c.post.id, c.persona.id, c.nickname, c.body, true]
  );
  // comment_count 동기화
  await query(
    `UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`,
    [c.post.id]
  );
  return rows[0];
}

async function main() {
  const args = parseArgs();
  console.log(`💬 댓글 워커 시작 (count=${args.count}${args.postId ? `, post=${args.postId}` : ''}${args.dryRun ? ', DRY-RUN' : ''})`);

  let succeeded = 0, failed = 0;

  for (let i = 0; i < args.count; i++) {
    try {
      const cmt = await generateOneComment(args.postId);
      console.log(`   └ "${cmt.body.slice(0, 80)}${cmt.body.length > 80 ? '...' : ''}"`);

      if (!args.dryRun) {
        const saved = await saveComment(cmt);
        console.log(`     ✅ 저장 (id=${saved.id})`);

        // 메모리 추출 (50% 확률 — 모든 댓글에서 추출하면 비용 큼)
        if (Math.random() < 0.5) {
          const mem = await extractAndSave(cmt.persona, { id: cmt.post.id, title: cmt.post.title, body: cmt.post.body });
          if (mem) console.log(`     🧠 기억 저장: ${mem.summary}`);
        }
      } else {
        console.log(`     🧪 DRY-RUN`);
      }
      succeeded++;
    } catch (err) {
      console.error(`   ❌ 실패: ${err.message}`);
      failed++;
    }

    if (i < args.count - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  console.log(`\n🎯 결과: 성공 ${succeeded}, 실패 ${failed}`);
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('💥 워커 충돌:', err);
    pool.end().then(() => process.exit(1));
  });
}

module.exports = {
  generateOneComment,
  saveComment,
  pickTargetPost,
  pickCommenter,
  validateComment,
};
