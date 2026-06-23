/**
 * 마케톡 — 시간대 가중치 기반 스케줄러
 *
 * Cron이 일정 주기마다 호출. 현재 시각(KST)의 가중치로 작업량을 확률적으로 결정한다.
 *
 * 사용:
 *   node worker/scheduler.js                     # 자동 모드 (현재 시각 기반)
 *   node worker/scheduler.js --burst-posts 30    # 즉시 배치 실행
 *   node worker/scheduler.js --burst-comments 60
 *   node worker/scheduler.js --dry-run           # 카운트만 출력
 *
 * 배율은 GEN_RATE_MULTIPLIER 환경변수로 재배포 없이 조절.
 */
require('dotenv').config();
const { pool } = require('../db');
const { generateOnePost, savePost, markSeedUsed } = require('./generatePost');
const { generateOneComment, saveComment } = require('./generateComment');
const { extractAndSave } = require('./memory');
const { notifyNewPost } = require('./discord');

// 시각별 가중치 [a, b]
const HOURLY_RATES = {
   0: [0, 0.8],
   1: [0, 0.6],
   2: [0, 0.4],
   3: [0, 0.2],
   4: [0, 0.2],
   5: [0, 0.3],
   6: [0, 0.5],
   7: [0.6, 1.8],
   8: [1.2, 3.2],
   9: [1.5, 4.0],
  10: [1.6, 4.2],
  11: [1.5, 4.0],
  12: [1.9, 5.0],
  13: [1.6, 4.5],
  14: [1.5, 4.0],
  15: [1.6, 4.0],
  16: [1.6, 4.2],
  17: [1.6, 4.5],
  18: [1.5, 4.5],
  19: [1.5, 4.2],
  20: [1.7, 4.5],
  21: [1.9, 5.0],
  22: [1.9, 5.0],
  23: [0, 1.5],
};

const SLOTS_PER_HOUR = 4;
const MAX_POSTS_PER_RUN = 5;
const MAX_COMMENTS_PER_RUN = 12;
const DELAY_BETWEEN_CALLS_MS = 1200;

// 전역 배율 — GEN_RATE_MULTIPLIER 환경변수로 조절 (기본 0.1)
function getRateMultiplier() {
  const v = parseFloat(process.env.GEN_RATE_MULTIPLIER);
  if (Number.isFinite(v) && v >= 0) return v;
  return 1 / 10;
}

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = {
    burstPosts: 0,
    burstComments: 0,
    dryRun: false,
    slotsPerHour: SLOTS_PER_HOUR,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--burst-posts')    out.burstPosts = parseInt(a[++i]) || 0;
    if (a[i] === '--burst-comments') out.burstComments = parseInt(a[++i]) || 0;
    if (a[i] === '--slots')          out.slotsPerHour = parseInt(a[++i]) || 4;
    if (a[i] === '--dry-run' || a[i] === '--dry') out.dryRun = true;
  }
  return out;
}

function getKSTHour() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 3600 * 1000).getHours();
}

/** Poisson-like 샘플링: 기댓값 lambda에 자연스러운 변동을 더해 정수 카운트 반환 */
function pickCount(rate, slotsPerHour) {
  if (rate <= 0) return 0;  // 심야 등 작성 금지 시간대는 하드 0
  const expected = rate / slotsPerHour;
  const base = Math.floor(expected);
  const frac = expected - base;
  let n = base + (Math.random() < frac ? 1 : 0);
  // 약간의 추가 변동 (가끔 폭발)
  if (Math.random() < 0.08) n += 1;
  return n;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────
// 안전 래퍼: 글 1개 생성 + 저장
// ─────────────────────────────────────────────
async function tryGeneratePost() {
  try {
    const post = await generateOnePost();
    const saved = await savePost(post);
    if (post.seed) await markSeedUsed(post.seed.id);
    console.log(`   ✅ POST id=${saved.id} [${post.board.slug}] ${post.persona.codename} ${post.nickname} — ${post.title.slice(0, 50)}`);
    // 디스코드 알림
    notifyNewPost({
      id: saved.id, title: post.title,
      author: post.nickname, board: post.board.name,
      excerpt: post.body.slice(0, 150),
    }).catch(() => {});
    return { ok: true, post, saved };
  } catch (err) {
    console.error(`   ❌ POST 실패: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ─────────────────────────────────────────────
// 안전 래퍼: 댓글 1개 생성 + 저장 + 메모리 추출
// ─────────────────────────────────────────────
async function tryGenerateComment() {
  try {
    const cmt = await generateOneComment();
    const saved = await saveComment(cmt);
    console.log(`   💬 COMMENT id=${saved.id} on post#${cmt.post.id} [${cmt.persona.codename}] ${cmt.nickname} — "${cmt.body.slice(0, 50)}"`);

    // 50% 확률로 메모리 추출
    if (Math.random() < 0.5) {
      try {
        const mem = await extractAndSave(cmt.persona, {
          id: cmt.post.id, title: cmt.post.title, body: cmt.post.body,
        });
        if (mem) console.log(`      🧠 기억: ${mem.summary}`);
      } catch {}
    }
    return { ok: true };
  } catch (err) {
    console.error(`   ❌ COMMENT 실패: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 킬 스위치: AI_GENERATION_ENABLED=false 면 자동 생성 중단
//   비용 절감용. 크론 설정은 그대로 두고 환경변수만 끄면 됨.
//   수동 burst(--burst-posts/--burst-comments)는 의도적 실행이므로 통과.
//   재개: Railway Variables 에서 AI_GENERATION_ENABLED=true (또는 변수 삭제)
// ─────────────────────────────────────────────
function isGenerationEnabled() {
  const v = (process.env.AI_GENERATION_ENABLED || '').trim().toLowerCase();
  return !['false', '0', 'off', 'no'].includes(v);
}

async function main() {
  const args = parseArgs();
  const isBurst = args.burstPosts > 0 || args.burstComments > 0;

  // 킬 스위치 — 자동 모드에서만 적용 (burst는 수동 의도)
  if (!isBurst && !isGenerationEnabled()) {
    console.log('🛑 AI_GENERATION_ENABLED=false — 자동 글·댓글 생성 중단됨 (비용 절감 모드)');
    await pool.end();
    return;
  }

  let postTarget, commentTarget;

  if (isBurst) {
    postTarget = args.burstPosts;
    commentTarget = args.burstComments;
    console.log(`💥 BURST 모드 — 글 ${postTarget}개, 댓글 ${commentTarget}개`);
  } else {
    const hour = getKSTHour();
    const mult = getRateMultiplier();
    const [basePostRate, baseCommentRate] = HOURLY_RATES[hour] || [1.0, 3.0];
    const postRate = basePostRate * mult;
    const commentRate = baseCommentRate * mult;
    postTarget = Math.min(pickCount(postRate, args.slotsPerHour), MAX_POSTS_PER_RUN);
    commentTarget = Math.min(pickCount(commentRate, args.slotsPerHour), MAX_COMMENTS_PER_RUN);
    console.log(`⏰ ${hour}시 KST · 배율 x${mult.toFixed(2)} · 발생률 글=${postRate.toFixed(2)}/h 댓글=${commentRate.toFixed(2)}/h`);
    console.log(`🎯 이번 슬롯 목표: 글 ${postTarget}개, 댓글 ${commentTarget}개`);
  }

  if (args.dryRun) {
    console.log('🧪 DRY-RUN — 실제 생성하지 않음');
    await pool.end();
    return;
  }

  let postsDone = 0, commentsDone = 0, postsFailed = 0, commentsFailed = 0;

  // 1. 글 먼저 (댓글이 글에 의존하므로)
  if (postTarget > 0) {
    console.log(`\n📝 글 생성 시작 (${postTarget}개)`);
    for (let i = 0; i < postTarget; i++) {
      const r = await tryGeneratePost();
      if (r.ok) postsDone++; else postsFailed++;
      if (i < postTarget - 1) await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }

  // 2. 댓글
  if (commentTarget > 0) {
    console.log(`\n💬 댓글 생성 시작 (${commentTarget}개)`);
    for (let i = 0; i < commentTarget; i++) {
      const r = await tryGenerateComment();
      if (r.ok) commentsDone++; else commentsFailed++;
      if (i < commentTarget - 1) await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }

  console.log(`\n🎯 결과 — 글 ${postsDone}/${postTarget} (실패 ${postsFailed}), 댓글 ${commentsDone}/${commentTarget} (실패 ${commentsFailed})`);
  await pool.end();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('💥 스케줄러 충돌:', err);
    await pool.end();
    process.exit(1);
  });
}

module.exports = { main, HOURLY_RATES };
