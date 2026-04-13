require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const boardsApi = require('./api/boards');
const postsApi  = require('./api/posts');
const statsApi  = require('./api/stats');
const authApi   = require('./api/auth');
const adminApi  = require('./api/admin');
const searchApi = require('./api/search');
const { router: bannersApi } = require('./api/banners');
const { router: agenciesApi } = require('./api/agencies');
const { router: resourcesApi } = require('./api/resources');
const copyApi = require('./api/copy');
const { attachUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(attachUser);  // 모든 요청에 req.user 채워줌 (없으면 null)

// ── OG 메타태그 주입 (소셜 공유 미리보기) ──
const fs = require('fs');
const postHtmlTemplate = fs.readFileSync(path.join(__dirname, 'post.html'), 'utf-8');

app.get('/post.html', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.send(postHtmlTemplate);
  try {
    const { rows } = await require('./db').query(
      `SELECT p.title, SUBSTRING(p.body, 1, 200) AS excerpt
       FROM posts p WHERE p.id = $1`, [id]
    );
    if (rows.length === 0) return res.send(postHtmlTemplate);
    const p = rows[0];
    const clean = (s) => String(s || '').replace(/["\n\r<>]/g, ' ').trim();
    const ogTags = `
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${clean(p.title)}" />
    <meta property="og:description" content="${clean(p.excerpt)}" />
    <meta property="og:site_name" content="마케톡" />
    <meta property="og:url" content="https://www.grovel.kr/post.html?id=${id}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${clean(p.title)}" />
    <meta name="twitter:description" content="${clean(p.excerpt)}" />`;
    res.send(postHtmlTemplate
      .replace('<title>마케톡 — 게시글</title>', `<title>${clean(p.title)} — 마케톡</title>`)
      .replace('</head>', ogTags + '\n</head>'));
  } catch { res.send(postHtmlTemplate); }
});

// 정적 파일
app.use(express.static(__dirname, {
  extensions: ['html'],
  maxAge: '5m',
  index: 'index.html',
}));

// API 라우트
app.use('/api/auth',    authApi);
app.use('/api/boards',  boardsApi);
app.use('/api/posts',   postsApi);
app.use('/api/stats',   statsApi);
app.use('/api/admin',   adminApi);
app.use('/api/search',  searchApi);
app.use('/api/banners',   bannersApi);
app.use('/api/agencies',  agenciesApi);
app.use('/api/resources', resourcesApi);
app.use('/api/copy',      copyApi);

// 헬스체크
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'marketalk' });
});

// ads.txt — AdSense 승인 후 채워질 자리 (env로 주입)
app.get('/ads.txt', (_req, res) => {
  res.type('text/plain').send(process.env.ADS_TXT || '# add your ads.txt content via ADS_TXT env var');
});

// 광고 코드 주입 — env에 있는 슬롯별 HTML을 프론트가 가져가서 렌더링
app.get('/api/ads', (_req, res) => {
  res.json({
    top:     process.env.AD_SLOT_TOP     || null,
    inline:  process.env.AD_SLOT_INLINE  || null,
    bottom:  process.env.AD_SLOT_BOTTOM  || null,
    side1:   process.env.AD_SLOT_SIDE1   || null,
    side2:   process.env.AD_SLOT_SIDE2   || null,
    head:    process.env.AD_HEAD_SCRIPT  || null,  // AdSense 페이지 헤드 스크립트
  });
});

// SPA-ish 폴백
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 마케톡 listening on :${PORT}`);
});
