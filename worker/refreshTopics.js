/**
 * 마케톡 — 토픽 시드 자동 보충 (주 1회 cron)
 *
 * 보드별로 used_count 평균이 일정 이상이면 새 토픽을 추가 생성한다.
 * generateTopics.js를 그대로 호출하지만, 정기 cron 진입점을 분리해
 * Railway Cron 설정을 명확히 분리하기 위함.
 *
 * 사용:
 *   node worker/refreshTopics.js          # 모든 보드, 보드당 15개
 *   node worker/refreshTopics.js --count 25
 *
 * Railway Cron 설정:
 *   1. 새 서비스 → 같은 GitHub 레포
 *   2. Start Command: "node worker/refreshTopics.js"
 *   3. Cron Schedule: "0 19 * * 0"   # 한국 시간 일요일 04:00 (UTC 19:00 토)
 *   4. 같은 환경변수 (DATABASE_URL, ANTHROPIC_API_KEY)
 */
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const { pool, query } = require('../db');

async function shouldRefresh() {
  // 어떤 보드든 used_count 평균 >= 3 이면 보충 필요
  const { rows } = await query(`
    SELECT board_slug, AVG(used_count)::numeric(10,2) AS avg_used,
           COUNT(*)::int AS total
    FROM topic_seeds
    GROUP BY board_slug
    ORDER BY avg_used DESC
  `);
  console.log('📊 토픽 풀 현황:');
  rows.forEach(r => console.log(`   ${r.board_slug.padEnd(8)} 총 ${r.total} · 평균 사용 ${r.avg_used}회`));

  const needsRefresh = rows.some(r => parseFloat(r.avg_used) >= 3);
  return { needsRefresh, rows };
}

async function main() {
  const args = process.argv.slice(2);
  let count = 15;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count') count = parseInt(args[++i]) || 15;
  }

  const { needsRefresh } = await shouldRefresh();

  if (!needsRefresh) {
    console.log('✓ 모든 보드 토픽 풀 충분 — 보충 불필요');
    await pool.end();
    return;
  }

  console.log(`\n💡 보충 시작 — 보드당 ${count}개 추가 생성`);
  await pool.end();

  // generateTopics.js를 자식 프로세스로 호출
  const child = spawn(
    'node',
    [path.join(__dirname, 'generateTopics.js'), '--count', String(count)],
    { stdio: 'inherit', env: process.env }
  );

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('💥 refreshTopics 충돌:', err);
    await pool.end();
    process.exit(1);
  });
}
