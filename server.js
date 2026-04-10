require('dotenv').config();
const express = require('express');
const path = require('path');

const boardsApi = require('./api/boards');
const postsApi  = require('./api/posts');
const statsApi  = require('./api/stats');

const app = express();
const PORT = process.env.PORT || 3000;

// JSON 바디 파싱
app.use(express.json({ limit: '256kb' }));

// 정적 파일
app.use(express.static(__dirname, {
  extensions: ['html'],
  maxAge: '5m',
  index: 'index.html',
}));

// API 라우트
app.use('/api/boards', boardsApi);
app.use('/api/posts',  postsApi);
app.use('/api/stats',  statsApi);

// 헬스체크
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'marketalk' });
});

// 진단 — DB 연결 상태 확인 (임시, 배포 후 제거 권장)
app.get('/_diag', async (_req, res) => {
  const out = {
    has_DATABASE_URL: !!process.env.DATABASE_URL,
    db_host: null,
    db_ok: false,
    db_error: null,
    boards: null,
    posts: null,
  };
  if (process.env.DATABASE_URL) {
    try {
      const u = new URL(process.env.DATABASE_URL);
      out.db_host = u.hostname + ':' + u.port;
    } catch (e) { out.db_host = 'parse_error'; }
  }
  try {
    const { query } = require('./db');
    const r1 = await query('SELECT COUNT(*)::int AS c FROM boards');
    const r2 = await query('SELECT COUNT(*)::int AS c FROM posts');
    out.db_ok = true;
    out.boards = r1.rows[0].c;
    out.posts  = r2.rows[0].c;
  } catch (err) {
    out.db_error = err.message;
  }
  res.json(out);
});

// SPA-ish 폴백 — API/healthz는 위에서 처리됨, 나머지는 index.html
app.get('*', (req, res) => {
  // post.html 같은 정적 파일은 위 미들웨어가 처리
  // 매칭 안 된 경로는 index로
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 마케톡 listening on :${PORT}`);
});
