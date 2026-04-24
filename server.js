// Sentry는 어떤 모듈보다도 먼저 로드되어야 instrumentation이 정상 동작
const sentryInit = require('./instrument');
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
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

// Railway + Fastly CDN 뒤에 있으므로 모든 XFF hop 신뢰 필요.
// (trust proxy=1 이면 Fastly edge IP로만 rate-limit 집계되어 실패함)
app.set('trust proxy', true);

// 보안 헤더 — HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy 등
// CSP/COEP/CORP은 외부 CDN(tailwind/jsdelivr/unpkg/쿠팡파트너스) 호환성 문제로 비활성
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));

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
    <meta name="twitter:description" content="${clean(p.excerpt)}" />
    <meta name="description" content="${clean(p.excerpt)}" />
    <link rel="canonical" href="https://www.grovel.kr/post.html?id=${id}" />
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Article","headline":"${clean(p.title)}","description":"${clean(p.excerpt)}","url":"https://www.grovel.kr/post.html?id=${id}","publisher":{"@type":"Organization","name":"마케톡","url":"https://www.grovel.kr"}}
    </script>`;
    // 네이버/구글 인증 메타태그 (env에 있으면 주입)
    let verifyTags = '';
    if (process.env.NAVER_VERIFY) verifyTags += `\n    <meta name="naver-site-verification" content="${process.env.NAVER_VERIFY}" />`;
    if (process.env.GOOGLE_VERIFY) verifyTags += `\n    <meta name="google-site-verification" content="${process.env.GOOGLE_VERIFY}" />`;

    res.send(postHtmlTemplate
      .replace('<title>마케톡 — 게시글</title>', `<title>${clean(p.title)} — 마케톡</title>`)
      .replace('</head>', ogTags + verifyTags + '\n</head>'));
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

// SEO 인증 메타태그 (네이버/구글)
app.get('/api/seo-verify', (_req, res) => {
  res.json({
    naver: process.env.NAVER_VERIFY || null,
    google: process.env.GOOGLE_VERIFY || null,
  });
});

// ads.txt
app.get('/ads.txt', (_req, res) => {
  res.type('text/plain').send(process.env.ADS_TXT || '# add your ads.txt content via ADS_TXT env var');
});

// ── SEO: robots.txt ──
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /api/admin/
Disallow: /reset-password.html

Sitemap: https://www.grovel.kr/sitemap.xml
`);
});

// ── SEO: sitemap.xml (동적) ──
app.get('/sitemap.xml', async (_req, res) => {
  try {
    const db = require('./db');
    const base = 'https://www.grovel.kr';

    // 정적 페이지
    const staticPages = [
      { loc: '/', priority: '1.0', changefreq: 'hourly' },
      { loc: '/resources.html', priority: '0.8', changefreq: 'weekly' },
      { loc: '/copy-generator.html', priority: '0.8', changefreq: 'monthly' },
      { loc: '/agencies.html', priority: '0.7', changefreq: 'weekly' },
      { loc: '/guide.html', priority: '0.5', changefreq: 'monthly' },
      { loc: '/contact.html', priority: '0.4', changefreq: 'monthly' },
      { loc: '/terms.html', priority: '0.3', changefreq: 'yearly' },
      { loc: '/privacy.html', priority: '0.3', changefreq: 'yearly' },
      { loc: '/search.html', priority: '0.6', changefreq: 'daily' },
    ];

    // 게시글 (최근 500개)
    const { rows: posts } = await db.query(`
      SELECT id, published_at FROM posts
      WHERE published_at IS NOT NULL
      ORDER BY published_at DESC LIMIT 500
    `);

    // 자료
    const { rows: resources } = await db.query(`
      SELECT slug, updated_at FROM resources WHERE is_active = TRUE
    `);

    // 대행사
    const { rows: agencies } = await db.query(`
      SELECT slug, updated_at FROM agencies WHERE is_active = TRUE
    `);

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    for (const p of staticPages) {
      xml += `<url><loc>${base}${p.loc}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>\n`;
    }
    for (const p of posts) {
      const date = new Date(p.published_at).toISOString().slice(0, 10);
      xml += `<url><loc>${base}/post.html?id=${p.id}</loc><lastmod>${date}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
    }
    for (const r of resources) {
      const date = new Date(r.updated_at).toISOString().slice(0, 10);
      xml += `<url><loc>${base}/resource.html?slug=${r.slug}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
    }
    for (const a of agencies) {
      xml += `<url><loc>${base}/agency.html?slug=${a.slug}</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;
    }

    xml += '</urlset>';
    res.type('application/xml').send(xml);
  } catch (err) {
    console.error('[sitemap]', err);
    res.type('application/xml').send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
});

// ── SEO: RSS 피드 ──
app.get('/rss.xml', async (_req, res) => {
  try {
    const db = require('./db');
    const { rows } = await db.query(`
      SELECT p.id, p.title, SUBSTRING(p.body, 1, 300) AS excerpt,
             p.author_nickname, p.published_at, b.name AS board_name
      FROM posts p JOIN boards b ON b.id = p.board_id
      ORDER BY p.published_at DESC LIMIT 30
    `);

    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n';
    xml += '<title>마케톡 — 마케터들의 익명 커뮤니티</title>\n';
    xml += '<link>https://www.grovel.kr</link>\n';
    xml += '<description>마케팅, 광고, SEO, 부업까지. 실무자들이 모이는 가장 솔직한 익명 커뮤니티.</description>\n';
    xml += '<language>ko</language>\n';
    xml += '<atom:link href="https://www.grovel.kr/rss.xml" rel="self" type="application/rss+xml" />\n';

    for (const p of rows) {
      xml += '<item>\n';
      xml += `<title>${esc(p.title)}</title>\n`;
      xml += `<link>https://www.grovel.kr/post.html?id=${p.id}</link>\n`;
      xml += `<guid>https://www.grovel.kr/post.html?id=${p.id}</guid>\n`;
      xml += `<description>${esc(p.excerpt)}</description>\n`;
      xml += `<pubDate>${new Date(p.published_at).toUTCString()}</pubDate>\n`;
      xml += `<category>${esc(p.board_name)}</category>\n`;
      xml += '</item>\n';
    }

    xml += '</channel>\n</rss>';
    res.type('application/rss+xml').send(xml);
  } catch (err) {
    console.error('[rss]', err);
    res.type('application/rss+xml').send('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>');
  }
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

// Sentry Express 에러 핸들러 — 모든 라우트 뒤, app.listen 전
if (sentryInit.enabled) {
  sentryInit.Sentry.setupExpressErrorHandler(app);
}

app.listen(PORT, () => {
  console.log(`🚀 마케톡 listening on :${PORT}`);
});
