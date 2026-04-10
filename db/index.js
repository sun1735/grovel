/**
 * Postgres 연결 풀.
 * Railway 환경에서는 DATABASE_URL 환경변수가 자동 주입됨.
 */
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;

if (!url) {
  console.warn('⚠️  DATABASE_URL이 설정되지 않았습니다. .env 파일을 확인하세요.');
}

// Railway 환경별 SSL 매트릭스:
//  - *.railway.internal  → 내부망 plaintext (SSL X)
//  - *.proxy.rlwy.net    → 외부 프록시, SSL 필요 (자체서명이라 verify off)
//  - 그 외                → SSL X (로컬 등)
function detectSsl(connStr) {
  if (!connStr) return false;
  if (connStr.includes('proxy.rlwy.net')) return { rejectUnauthorized: false };
  if (connStr.includes('railway.internal')) return false;
  if (/sslmode=require/i.test(connStr))    return { rejectUnauthorized: false };
  return false;
}

const pool = new Pool({
  connectionString: url,
  ssl: detectSsl(url),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// 첫 연결 한 번 테스트해서 부팅 시 즉시 알 수 있게
pool.query('SELECT 1').then(
  () => console.log('[db] connected ✓'),
  (err) => console.error('[db] initial connect failed:', err.message),
);

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
