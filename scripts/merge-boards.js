/**
 * 게시판 통폐합 마이그레이션 (11개 → 6개)
 *
 *   seo, sns, tool  → ad   ('마케팅 실무'로 개명)
 *   event           → free
 *   job             → qna
 *
 * 글·글감(topic_seeds)·게시판 즐겨찾기를 대상 게시판으로 옮긴 뒤
 * 빈 게시판 row를 삭제하고 이름/설명/정렬을 갱신한다.
 * 전체가 한 트랜잭션 — 중간 실패 시 아무것도 바뀌지 않음. 재실행해도 안전(멱등).
 *
 * 사용:
 *   node scripts/merge-boards.js --dry-run   # 이동 대상 개수만 출력
 *   node scripts/merge-boards.js             # 실행
 */
require('dotenv').config();
const { pool, query, withTransaction } = require('../db');

const MERGES = [
  { from: 'seo',   to: 'ad' },
  { from: 'sns',   to: 'ad' },
  { from: 'tool',  to: 'ad' },
  { from: 'event', to: 'free' },
  { from: 'job',   to: 'qna' },
];

const FINAL_BOARDS = [
  { slug: 'notice', name: '공지사항',   description: '관리자 공지', sort: 0 },
  { slug: 'free',   name: '자유게시판', description: '잡담, 일상, 푸념, 이벤트 소식', sort: 1 },
  { slug: 'ad',     name: '마케팅 실무', description: '광고·SEO·SNS·툴, 실전 노하우 전부', sort: 2 },
  { slug: 'side',   name: '부업/수익화', description: '사이드 프로젝트, 프리랜서', sort: 3 },
  { slug: 'qna',    name: '질문답변',   description: '막힐 땐 여기에 — 구인/협업도 환영', sort: 4 },
  { slug: 'news',   name: '뉴스/동향',  description: '마케팅 업계 뉴스 브리핑', sort: 5 },
];

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');

async function main() {
  console.log(`📦 게시판 통폐합 시작${dryRun ? ' (DRY-RUN)' : ''}`);

  const { rows: boards } = await query('SELECT id, slug, name FROM boards');
  const bySlug = Object.fromEntries(boards.map(b => [b.slug, b]));

  // 이동 대상 집계
  for (const m of MERGES) {
    if (!bySlug[m.from]) {
      console.log(`   • ${m.from}: 이미 없음 (건너뜀)`);
      continue;
    }
    if (!bySlug[m.to]) throw new Error(`대상 게시판 없음: ${m.to}`);
    const { rows } = await query(
      'SELECT COUNT(*)::int AS c FROM posts WHERE board_id = $1', [bySlug[m.from].id]);
    console.log(`   • ${m.from} → ${m.to}: 글 ${rows[0].c}개`);
  }

  if (dryRun) {
    console.log('\n🧪 DRY-RUN — 변경 없음');
    await pool.end();
    return;
  }

  await withTransaction(async (client) => {
    for (const m of MERGES) {
      const from = bySlug[m.from];
      const to = bySlug[m.to];
      if (!from) continue;

      await client.query('UPDATE posts SET board_id = $1 WHERE board_id = $2', [to.id, from.id]);
      if (m.from === 'job') {
        // 구인 성격 글감은 질문답변 게시판과 맞지 않아 폐기
        await client.query(`DELETE FROM topic_seeds WHERE board_slug = 'job'`);
      } else {
        await client.query('UPDATE topic_seeds SET board_slug = $1 WHERE board_slug = $2', [m.to, m.from]);
      }
      await client.query(
        `INSERT INTO board_favorites (user_id, board_id)
         SELECT user_id, $1 FROM board_favorites WHERE board_id = $2
         ON CONFLICT (user_id, board_id) DO NOTHING`,
        [to.id, from.id]
      );
      await client.query('DELETE FROM board_favorites WHERE board_id = $1', [from.id]);
      await client.query('DELETE FROM boards WHERE id = $1', [from.id]);
      console.log(`   ✓ ${m.from} → ${m.to} 병합 완료`);
    }

    for (const b of FINAL_BOARDS) {
      await client.query(
        'UPDATE boards SET name = $2, description = $3, sort_order = $4 WHERE slug = $1',
        [b.slug, b.name, b.description, b.sort]
      );
    }
    console.log('   ✓ 게시판 이름/설명/정렬 갱신');
  });

  const { rows: after } = await query(
    `SELECT b.slug, b.name, COUNT(p.id)::int AS posts
     FROM boards b LEFT JOIN posts p ON p.board_id = b.id
     GROUP BY b.id ORDER BY b.sort_order`);
  console.log('\n📋 통폐합 후:');
  after.forEach(b => console.log(`   ${b.slug.padEnd(8)} ${b.name.padEnd(10)} 글 ${b.posts}개`));

  await pool.end();
}

main().catch((err) => {
  console.error('💥 마이그레이션 실패 (롤백됨):', err.message);
  pool.end().then(() => process.exit(1));
});
