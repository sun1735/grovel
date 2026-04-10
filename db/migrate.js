/**
 * 스키마 마이그레이션 — schema.sql을 통째로 적용.
 * 멱등(idempotent): 이미 존재하는 테이블은 IF NOT EXISTS로 건너뜀.
 *
 * 사용:
 *   node db/migrate.js
 *   npm run db:migrate
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

async function migrate() {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  console.log('🚀 마이그레이션 시작...');
  console.log(`   대상: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@') || '(미설정)'}`);

  try {
    await pool.query(sql);
    console.log('✅ 마이그레이션 완료. 모든 테이블 준비됨.');

    // 검증
    const { rows } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log('\n📋 적용된 테이블:');
    rows.forEach((r) => console.log(`   • ${r.table_name}`));
  } catch (err) {
    console.error('❌ 마이그레이션 실패:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
