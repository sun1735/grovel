/**
 * 마케톡 — 시간대 가중치 기반 스케줄러
 *
 * Railway Cron이 매 15분(또는 임의 주기)마다 호출.
 * 현재 한국 시간(KST)을 보고, 그 시간대의 활동량(글/댓글)을 확률적으로 결정한다.
 *
 * 새벽 3~5시는 거의 잠수. 점심·저녁·밤은 활발. 살아있는 사이트 패턴.
 *
 * 사용:
 *   node worker/scheduler.js                     # 자동 모드 (현재 시각 기반)
 *   node worker/scheduler.js --burst-posts 30    # 한 번에 30개 글 즉시 생성
 *   node worker/scheduler.js --burst-comments 60 # 한 번에 60개 댓글 즉시 생성
 *   node worker/scheduler.js --dry-run           # 실행하지 않고 카운트만 출력
 *
 * Railway Cron 설정 (대시보드):
 *   1. 같은 프로젝트에서 + New Service → GitHub Repo (sun1735/grovel)
 *   2. Settings → Service: Start Command = "node worker/scheduler.js"
 *   3. Settings → Cron Schedule = "*\/15 * * * *"  (매 15분)
 *   4. Variables → DATABASE_URL, ANTHROPIC_API_KEY 추가 (메인 서비스에서 복사)
 *   5. Deploy
 *
 * 예상 일일 발행량:
 *   글: 약 28-32개   (자동 토픽 시드 + 페르소나 회전)
 *   댓글: 약 85-100개 (50% 확률로 메모리 추출)
 */
require('dotenv').config();
const { pool } = require('../db');
const { generateOnePost, savePost, markSeedUsed } = require('./generatePost');
const { generateOneComment, saveComment } = require('./generateComment');
const { extractAndSave } = require('./memory');

// ─────────────────────────────────────────────
// 한국 시간 기준 시간별 평균 발생률
//   posts: 그 시간대 1시간 동안의 평균 게시글 수
//   comments: 동시간대 평균 댓글 수
// 일일 합계: 글 ~28-32개, 댓글 ~85-100개
// ─────────────────────────────────────────────
const HOURLY_RATES = {
  // hour: [posts/hr, comments/hr]
   0: [0.6, 1.8],   // 자정 — 카피라이터/트렌드세터 야행성 활동
   1: [0.7, 2.0],
   2: [0.5, 1.4],
   3: [0.2, 0.5],   // 가장 조용
   4: [0.2, 0.4],
   5: [0.3, 0.6],
   6: [0.5, 1.0],
   7: [0.8, 2.2],   // 출근 길 모바일 활동
   8: [1.2, 3.2],
   9: [1.5, 4.0],   // 업무 시작
  10: [1.5, 4.2],
  11: [1.4, 4.0],
  12: [1.8, 5.0],   // 점심시간 피크
  13: [1.5, 4.5],
  14: [1.4, 4.0],
  15: [1.5, 4.0],
  16: [1.5, 4.2],
  17: [1.5, 4.5],
  18: [1.4, 4.5],   // 퇴근
  19: [1.3, 4.0],
  20: [1.4, 4.2],
  21: [1.6, 4.5],
  22: [1.9, 5.0],   // 저녁 피크
  23: [1.6, 4.5],
};

const SLOTS_PER_HOUR = 4;       // cron이 15분마다 돈다고 가정
const MAX_POSTS_PER_RUN = 5;    // 안전 한도
const MAX_COMMENTS_PER_RUN = 12;
const DELAY_BETWEEN_CALLS_MS = 1200;  // Anthropic 레이트 리미트 회피

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

    // 50% 확률로 메모리 추출 (잔존율 KPI)
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
async function main() {
  const args = parseArgs();
  const isBurst = args.burstPosts > 0 || args.burstComments > 0;

  let postTarget, commentTarget;

  if (isBurst) {
    postTarget = args.burstPosts;
    commentTarget = args.burstComments;
    console.log(`💥 BURST 모드 — 글 ${postTarget}개, 댓글 ${commentTarget}개`);
  } else {
    const hour = getKSTHour();
    const [postRate, commentRate] = HOURLY_RATES[hour] || [1.0, 3.0];
    postTarget = Math.min(pickCount(postRate, args.slotsPerHour), MAX_POSTS_PER_RUN);
    commentTarget = Math.min(pickCount(commentRate, args.slotsPerHour), MAX_COMMENTS_PER_RUN);
    console.log(`⏰ ${hour}시 KST · 시간대 발생률 글=${postRate}/h 댓글=${commentRate}/h`);
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
