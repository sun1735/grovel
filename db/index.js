/**
 * Postgres 연결 풀.
 * Railway 환경에서는 DATABASE_URL 환경변수가 자동 주입됨.
 */
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL이 설정되지 않았습니다. .env 파일을 확인하세요.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres는 SSL 필요하지만 sslmode=require가 connectionString에 포함되어 있으면 자동.
  // 일부 프록시 환경 호환성을 위해 reject unauthorized 끔.
  ssl: process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error:', err);
});

/** 짧은 헬퍼 — `db.query('SELECT ...')` 식으로 사용 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.DB_DEBUG === '1') {
      console.log('[db]', `${Date.now() - start}ms`, text.split('\n')[0].slice(0, 80));
    }
    return res;
  } catch (err) {
    console.error('[db] query failed:', err.message, '\n  SQL:', text.slice(0, 120));
    throw err;
  }
}

/** 트랜잭션 헬퍼 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
