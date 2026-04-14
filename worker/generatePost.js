/**
 * 게시글 생성 워커.
 *
 * 흐름:
 *   1. 활성 보드 중 하나 선택 (가중치 분배)
 *   2. 보드에 어울리는 페르소나 선택
 *   3. 최근 사용 안 한 닉네임 선택
 *   4. 시스템 프롬프트 빌드 → LLM 호출
 *   5. 결과 검증 (제목/본문 길이 등 품질 필터)
 *   6. DB 저장 + 자연스러운 초기 view_count
 *   7. (선택) Discord 웹훅 알림
 *
 * 사용:
 *   node worker/generatePost.js              # 1개 글 생성
 *   node worker/generatePost.js --count 5    # 5개 생성
 *   node worker/generatePost.js --board ad   # 특정 보드만
 *   node worker/generatePost.js --dry-run    # DB 저장 안 함, 미리보기만
 */
require('dotenv').config();
const { pool, query } = require('../db');
const { getPersona, PERSONA_LIST } = require('../ai/personas');
const {
  pickPersonaForBoard,
  pickNickname,
  buildSystemPrompt,
  isActiveHour,
  injectKoreanTypos,
} = require('../ai/protocols');
const { completeJson } = require('./llm');
const { notifyNewPost } = require('./discord');

// ─────────────────────────────────────────────
// CLI 파싱
// ─────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { count: 1, board: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count')   out.count = parseInt(args[++i]) || 1;
    if (args[i] === '--board')   out.board = args[++i];
    if (args[i] === '--dry-run' || args[i] === '--dry') out.dryRun = true;
  }
  return out;
}

// ─────────────────────────────────────────────
// 보드 선택 (활성 보드 + 시간대 가중치)
// ─────────────────────────────────────────────
async function pickBoard(forceSlug) {
  if (forceSlug) {
    const { rows } = await query('SELECT id, slug, name FROM boards WHERE slug=$1', [forceSlug]);
    if (!rows[0]) throw new Error(`존재하지 않는 보드: ${forceSlug}`);
    return rows[0];
  }
  // 가중치: 마케팅 콘텐츠 중심, 자유게시판은 적당히
  const weights = {
    free: 15, ad: 25, sns: 20, side: 14, qna: 12, seo: 10, tool: 8, job: 5, event: 1, notice: 0,
  };
  const { rows } = await query('SELECT id, slug, name FROM boards WHERE slug != $1', ['notice']);
  const pool = rows.map(b => ({ b, w: weights[b.slug] || 5 }));
  const total = pool.reduce((s, x) => s + x.w, 0);
  let roll = Math.random() * total;
  for (const { b, w } of pool) {
    roll -= w;
    if (roll <= 0) return b;
  }
  return pool[0].b;
}

// ─────────────────────────────────────────────
// 닉네임 회전 — DB에서 최근 사용 이력 확인
// ─────────────────────────────────────────────
async function pickFreshNickname(persona) {
  const { rows } = await query(
    `SELECT nickname FROM nickname_usage
     WHERE persona_id = $1 AND used_at > NOW() - INTERVAL '7 days'
     ORDER BY used_at DESC LIMIT 5`,
    [persona.id]
  );
  const recentlyUsed = rows.map(r => r.nickname);
  const nickname = pickNickname(persona, recentlyUsed);

  // 사용 기록
  await query(
    'INSERT INTO nickname_usage (persona_id, nickname) VALUES ($1, $2)',
    [persona.id, nickname]
  );
  return nickname;
}

// ─────────────────────────────────────────────
// 품질 검증 — 식별률 KPI 충족 위한 필터
// ─────────────────────────────────────────────
function validateOutput(out) {
  if (!out || !out.title || !out.body) return '제목/본문 누락';
  if (out.title.length < 5 || out.title.length > 100) return `제목 길이 이상 (${out.title.length}자)`;
  if (out.body.length < 10) return '본문이 너무 짧음';
  if (out.body.length > 4000) return '본문이 너무 김';

  // AI 흔적 감지 — 절대 노출되면 안 되는 표현들
  const aiMarkers = [
    '죄송합니다만', '저는 AI', '언어 모델', 'AI 어시스턴트',
    '도움이 되었기를', '추가로 궁금한', '아래와 같이',
  ];
  for (const m of aiMarkers) {
    if (out.title.includes(m) || out.body.includes(m)) {
      return `AI 흔적 감지: "${m}"`;
    }
  }

  // 정형화된 마크다운 헤더 = 광고 카피 같은 정형화 패턴
  if (/^#{1,6}\s/m.test(out.body)) return '마크다운 헤더 사용 (정형화 패턴)';
  if (/^[-*]\s.+\n[-*]\s/m.test(out.body)) return '불릿 리스트 사용 (정형화 패턴)';

  return null; // OK
}

// ─────────────────────────────────────────────
// 자연스러운 초기 조회수 (식별률 회피)
// 갓 올린 글이 0뷰면 어색함. 30~250 사이 무작위.
// ─────────────────────────────────────────────
function naturalInitialViewCount() {
  return 30 + Math.floor(Math.random() * 220);
}

// ─────────────────────────────────────────────
// 토픽 시드 선택 — 사용 횟수 적은 것 우선
// ─────────────────────────────────────────────
async function pickTopicForBoard(boardSlug) {
  // 가장 덜 사용된 시드 상위 5개 중 무작위 (완전 결정적이면 패턴됨)
  const { rows } = await query(`
    SELECT id, topic, angle, keywords, platform
    FROM topic_seeds
    WHERE board_slug = $1
    ORDER BY used_count ASC, last_used_at NULLS FIRST, RANDOM()
    LIMIT 5
  `, [boardSlug]);
  if (rows.length === 0) return null;
  return rows[Math.floor(Math.random() * rows.length)];
}

// 최근 같은 보드에 올라온 글 제목 가져오기 (회피용)
async function recentTitlesForBoard(boardSlug, limit = 30) {
  const { rows } = await query(`
    SELECT p.title
    FROM posts p JOIN boards b ON b.id = p.board_id
    WHERE b.slug = $1
    ORDER BY p.published_at DESC
    LIMIT $2
  `, [boardSlug, limit]);
  return rows.map(r => r.title);
}

// 시드 사용 기록
async function markSeedUsed(seedId) {
  await query(
    `UPDATE topic_seeds
     SET used_count = used_count + 1, last_used_at = NOW()
     WHERE id = $1`,
    [seedId]
  );
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function generateOnePost(forcedBoardSlug) {
  const board = await pickBoard(forcedBoardSlug);
  const persona = pickPersonaForBoard(board.slug) || PERSONA_LIST[Math.floor(Math.random() * PERSONA_LIST.length)];

  // 시간대 체크: 페르소나가 지금 활동시간 아니면 다른 페르소나로 교체 시도
  let chosenPersona = persona;
  if (!isActiveHour(persona) && Math.random() > 0.2) {  // 20%만 비활성 시간 통과
    const alt = PERSONA_LIST.find(p => isActiveHour(p) && p.boards.primary?.includes(board.slug));
    if (alt) chosenPersona = alt;
  }

  const nickname = await pickFreshNickname(chosenPersona);

  // 토픽 시드 선택 + 회피 목록
  const seed = await pickTopicForBoard(board.slug);
  const recentTitles = await recentTitlesForBoard(board.slug, 30);

  console.log(`\n📝 [${board.name}] ${chosenPersona.archetype} (${nickname}) — 글 생성 중...`);
  if (seed) {
    console.log(`   📌 토픽: ${seed.topic}${seed.platform && seed.platform !== 'none' ? ` [${seed.platform}]` : ''}`);
  } else {
    console.log(`   ⚠️ 이 보드 토픽 시드 없음 — LLM이 자유 선택`);
  }

  const promptResult = buildSystemPrompt(chosenPersona, {
    task: 'post',
    board: board.slug,
    nickname,
  });
  const { system, user: baseUser, isShortPost } = promptResult;

  // 토픽 + 회피 목록을 user 프롬프트에 추가 주입
  const topicBlock = seed ? `

# 이번 글의 주제 (이걸 본인의 시각·말투로 풀어내세요)
- 주제: ${seed.topic}${seed.platform && seed.platform !== 'none' ? `\n- 플랫폼: ${seed.platform}` : ''}${seed.keywords ? `\n- 핵심 키워드: ${seed.keywords}` : ''}${seed.angle ? `\n- 풀어가는 각도: ${seed.angle}` : ''}
` : '';

  const avoidBlock = recentTitles.length > 0 ? `

# 최근 이 보드에 올라온 글 제목 (이것들과 의미가 겹치는 글은 절대 쓰지 마세요)
${recentTitles.slice(0, 30).map(t => `- ${t}`).join('\n')}
` : '';

  const finalUser = baseUser + topicBlock + avoidBlock;

  const result = await completeJson({
    system,
    user: finalUser,
    maxTokens: isShortPost ? 400 : undefined,  // 짧은 글은 토큰 제한
    logCtx: { task_type: 'post', persona_id: chosenPersona.id, board_slug: board.slug },
  });

  const error = validateOutput(result);
  if (error) {
    throw new Error(`품질 검증 실패: ${error}`);
  }

  // 가벼운 후처리 오타 (LLM이 충분히 어색하지 않을 경우 보강)
  const finalBody = Math.random() < 0.4
    ? injectKoreanTypos(result.body, 0.008)
    : result.body;

  return {
    board, persona: chosenPersona, nickname, seed,
    title: result.title.trim(),
    body: finalBody.trim(),
    meta: result._meta,
  };
}

async function savePost(p) {
  // 토픽 시드의 platform 정보가 있으면 글에 그대로 부여
  const platform = p.seed?.platform && p.seed.platform !== 'none'
    ? p.seed.platform
    : null;

  const { rows } = await query(
    `INSERT INTO posts
      (board_id, persona_id, author_nickname, title, body, view_count, is_ai, platform)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, published_at`,
    [
      p.board.id, p.persona.id, p.nickname,
      p.title, p.body, naturalInitialViewCount(), true, platform,
    ]
  );
  return rows[0];
}

async function main() {
  const args = parseArgs();
  console.log(`🤖 게시글 워커 시작 (count=${args.count}${args.board ? `, board=${args.board}` : ''}${args.dryRun ? ', DRY-RUN' : ''})`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < args.count; i++) {
    try {
      const post = await generateOnePost(args.board);

      console.log(`\n   ┌── [${post.persona.codename}] ${post.nickname}`);
      console.log(`   │ 제목: ${post.title}`);
      console.log(`   │ 본문: ${post.body.slice(0, 100)}${post.body.length > 100 ? '...' : ''}`);
      console.log(`   │ 토큰: in=${post.meta.usage.input_tokens} out=${post.meta.usage.output_tokens}`);

      if (!args.dryRun) {
        const saved = await savePost(post);
        if (post.seed) await markSeedUsed(post.seed.id);
        console.log(`   └── ✅ 저장됨 (id=${saved.id})`);
        // 디스코드 알림 (비동기, 실패해도 무시)
        notifyNewPost({
          id: saved.id, title: post.title,
          author: post.nickname, board: post.board.name,
          excerpt: post.body.slice(0, 150),
        }).catch(() => {});
      } else {
        console.log(`   └── 🧪 DRY-RUN (저장 안 함)`);
      }
      succeeded++;
    } catch (err) {
      console.error(`   ❌ 실패: ${err.message}`);
      failed++;
    }

    // 연속 호출 시 약간 텀
    if (i < args.count - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n🎯 결과: 성공 ${succeeded}, 실패 ${failed}`);
  await pool.end();
}

// 모듈로 import될 땐 자동 실행 X. CLI로 직접 실행한 경우만 main() 호출.
if (require.main === module) {
  main().catch((err) => {
    console.error('💥 워커 충돌:', err);
    pool.end().then(() => process.exit(1));
  });
}

module.exports = {
  generateOnePost,
  savePost,
  markSeedUsed,
  pickBoard,
  pickTopicForBoard,
  recentTitlesForBoard,
  validateOutput,
};
