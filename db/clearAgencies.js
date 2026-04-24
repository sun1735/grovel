/**
 * 대행사(agencies) 테이블 전체 데이터 삭제 — 일회성 유틸.
 * 목업/시드 데이터를 비우고 운영 데이터만 다시 입력할 때 사용.
 *
 * 사용법:
 *   1) 드라이런(현재 행 수만 출력):
 *        node db/clearAgencies.js
 *   2) 실제 삭제:
 *        node db/clearAgencies.js --confirm
 *
 * 프로덕션 DB에 쓰려면 DATABASE_URL env를 프로덕션 값으로 세팅 후 실행.
 *   예) DATABASE_URL="postgresql://..." node db/clearAgencies.js --confirm
 */
const { pool, query } = require('./index');

(async () => {
  const confirm = process.argv.includes('--confirm');

  try {
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM agencies');
    const count = rows[0].n;

    if (count === 0) {
      console.log('agencies 테이블이 이미 비어 있습니다.');
      return;
    }

    if (!confirm) {
      console.log(`현재 agencies 행 수: ${count}`);
      console.log('실제로 삭제하려면 다시 "--confirm" 플래그로 실행하세요.');
      console.log('  node db/clearAgencies.js --confirm');
      return;
    }

    const { rowCount } = await query('DELETE FROM agencies');
    console.log(`✓ ${rowCount}개 대행사 삭제 완료`);
  } catch (err) {
    console.error('실패:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
