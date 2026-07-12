// Sentry는 어떤 모듈보다도 먼저 로드되어야 instrumentation이 정상 동작
const sentryInit = require('./instrument');
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');
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
const { router: notificationsApi } = require('./api/notifications');
const { router: pointsApi } = require('./api/points');
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

// gzip/br 응답 압축 — HTML/JSON/CSS/JS. 이미지·이미 압축된 응답은 자동 제외.
// 이미지 BYTEA 응답은 컨트롤러에서 별도 Cache-Control 설정됨.
app.use(compression({ threshold: 1024 }));

// 미들웨어
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(attachUser);  // 모든 요청에 req.user 채워줌 (없으면 null)

// ── OG 메타태그 주입 (소셜 공유 미리보기) ──
const fs = require('fs');
const postHtmlTemplate     = fs.readFileSync(path.join(__dirname, 'post.html'), 'utf-8');
const resourceHtmlTemplate = fs.readFileSync(path.join(__dirname, 'resource.html'), 'utf-8');
const agencyHtmlTemplate   = fs.readFileSync(path.join(__dirname, 'agency.html'), 'utf-8');

const cleanMeta = (s) => String(s || '').replace(/["\n\r<>]/g, ' ').trim();

function verifyTags() {
  let t = '';
  if (process.env.NAVER_VERIFY) t += `\n    <meta name="naver-site-verification" content="${process.env.NAVER_VERIFY}" />`;
  if (process.env.GOOGLE_VERIFY) t += `\n    <meta name="google-site-verification" content="${process.env.GOOGLE_VERIFY}" />`;
  return t;
}

function buildOgTags({ type, title, description, url, schemaType }) {
  const t = cleanMeta(title);
  const d = cleanMeta(description);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': schemaType || 'Article',
    headline: t,
    description: d,
    url,
    publisher: { '@type': 'Organization', name: '마케톡', url: 'https://www.grovel.kr' },
  };
  return `
    <meta property="og:type" content="${type}" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:site_name" content="마케톡" />
    <meta property="og:url" content="${url}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${url}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

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
    const url = `https://www.grovel.kr/post.html?id=${id}`;
    const ogTags = buildOgTags({ type: 'article', title: p.title, description: p.excerpt, url, schemaType: 'Article' });
    res.send(postHtmlTemplate
      .replace('<title>마케톡 — 게시글</title>', `<title>${cleanMeta(p.title)} — 마케톡</title>`)
      .replace('</head>', ogTags + verifyTags() + '\n</head>'));
  } catch { res.send(postHtmlTemplate); }
});

app.get('/resource.html', async (req, res) => {
  const slug = req.query.slug;
  if (!slug) return res.send(resourceHtmlTemplate);
  try {
    const { rows } = await require('./db').query(
      `SELECT title, subtitle, description FROM resources WHERE slug = $1 AND is_active = TRUE`,
      [slug]
    );
    if (rows.length === 0) return res.send(resourceHtmlTemplate);
    const r = rows[0];
    const desc = r.description || r.subtitle || `${r.title} — 마케톡 자료실`;
    const url = `https://www.grovel.kr/resource.html?slug=${encodeURIComponent(slug)}`;
    const ogTags = buildOgTags({ type: 'article', title: r.title, description: desc, url, schemaType: 'Article' });
    res.send(resourceHtmlTemplate
      .replace('<title>자료 — 마케톡</title>', `<title>${cleanMeta(r.title)} — 마케톡 자료실</title>`)
      .replace('</head>', ogTags + verifyTags() + '\n</head>'));
  } catch { res.send(resourceHtmlTemplate); }
});

// /u/:nickname → user.html (정적 파일 라우팅과 통일)
const userHtmlTemplate = fs.readFileSync(path.join(__dirname, 'user.html'), 'utf-8');
app.get('/u/:nickname', async (req, res) => {
  const nickname = req.params.nickname;
  if (!/^[가-힣A-Za-z0-9_]{2,20}$/.test(nickname || '')) {
    return res.status(404).send(userHtmlTemplate);
  }
  try {
    const { rows } = await require('./db').query(
      `SELECT nickname, bio FROM users WHERE nickname = $1 AND is_active = TRUE`,
      [nickname]
    );
    if (rows.length === 0) return res.send(userHtmlTemplate);
    const u = rows[0];
    const desc = u.bio || `@${u.nickname}의 마케톡 활동 기록 — 작성한 글과 댓글`;
    const url = `https://www.grovel.kr/u/${encodeURIComponent(u.nickname)}`;
    const ogTags = buildOgTags({ type: 'profile', title: `@${u.nickname}`, description: desc, url, schemaType: 'Person' });
    res.send(userHtmlTemplate
      .replace('<title>회원 — 마케톡</title>', `<title>@${cleanMeta(u.nickname)} — 마케톡</title>`)
      .replace('</head>', ogTags + verifyTags() + '\n</head>'));
  } catch { res.send(userHtmlTemplate); }
});

app.get('/agency.html', async (req, res) => {
  const slug = req.query.slug;
  if (!slug) return res.send(agencyHtmlTemplate);
  try {
    const { rows } = await require('./db').query(
      `SELECT name, tagline, description, specialties FROM agencies WHERE slug = $1 AND is_active = TRUE`,
      [slug]
    );
    if (rows.length === 0) return res.send(agencyHtmlTemplate);
    const a = rows[0];
    const desc = a.tagline || (a.description ? a.description.slice(0, 200) : `${a.name} — 마케톡 광고대행사 디렉토리`);
    const url = `https://www.grovel.kr/agency.html?slug=${encodeURIComponent(slug)}`;
    const ogTags = buildOgTags({ type: 'profile', title: a.name, description: desc, url, schemaType: 'Organization' });
    res.send(agencyHtmlTemplate
      .replace('<title>대행사 상세 — 마케톡</title>', `<title>${cleanMeta(a.name)} — 마케톡 대행사</title>`)
      .replace('</head>', ogTags + verifyTags() + '\n</head>'));
  } catch { res.send(agencyHtmlTemplate); }
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
app.use('/api/notifications', notificationsApi);
app.use('/api/points',  pointsApi);

// 헬스체크
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'marketalk' });
});

// SEO 인증 메타태그 (네이버/구글) + 분석 ID + 카카오 공유 키
app.get('/api/seo-verify', (_req, res) => {
  res.json({
    naver: process.env.NAVER_VERIFY || null,
    google: process.env.GOOGLE_VERIFY || null,
    ga: process.env.GA_MEASUREMENT_ID || null,        // G-XXXXXXXXXX
    plausible: process.env.PLAUSIBLE_DOMAIN || null,  // 예: grovel.kr
    kakao_js_key: process.env.KAKAO_JS_KEY || null,   // 카카오 공유 JS Key
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

// ── SEO: RSS 피드 (전체 + 보드별) ──
function rssEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function buildRss({ board, title, description, selfHref }) {
  const db = require('./db');
  const params = [];
  let where = '';
  if (board) {
    params.push(board);
    where = `WHERE b.slug = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT p.id, p.title, SUBSTRING(p.body, 1, 300) AS excerpt,
            p.author_nickname, p.published_at, b.name AS board_name
     FROM posts p JOIN boards b ON b.id = p.board_id
     ${where}
     ORDER BY p.published_at DESC LIMIT 30`,
    params
  );

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n';
  xml += `<title>${rssEsc(title)}</title>\n`;
  xml += '<link>https://www.grovel.kr</link>\n';
  xml += `<description>${rssEsc(description)}</description>\n`;
  xml += '<language>ko</language>\n';
  xml += `<atom:link href="${selfHref}" rel="self" type="application/rss+xml" />\n`;
  for (const p of rows) {
    xml += '<item>\n';
    xml += `<title>${rssEsc(p.title)}</title>\n`;
    xml += `<link>https://www.grovel.kr/post.html?id=${p.id}</link>\n`;
    xml += `<guid>https://www.grovel.kr/post.html?id=${p.id}</guid>\n`;
    xml += `<description>${rssEsc(p.excerpt)}</description>\n`;
    xml += `<pubDate>${new Date(p.published_at).toUTCString()}</pubDate>\n`;
    xml += `<category>${rssEsc(p.board_name)}</category>\n`;
    xml += '</item>\n';
  }
  xml += '</channel>\n</rss>';
  return xml;
}

app.get('/rss.xml', async (_req, res) => {
  try {
    const xml = await buildRss({
      board: null,
      title: '마케톡 — 마케터들의 익명 커뮤니티',
      description: '마케팅, 광고, SEO, 부업까지. 실무자들이 모이는 가장 솔직한 익명 커뮤니티.',
      selfHref: 'https://www.grovel.kr/rss.xml',
    });
    res.type('application/rss+xml').send(xml);
  } catch (err) {
    console.error('[rss]', err);
    res.type('application/rss+xml').send('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>');
  }
});

// 통폐합된 옛 게시판 슬러그 → 현행 슬러그 (구독 중인 RSS·검색엔진 유입 보존)
const BOARD_SLUG_ALIASES = { seo: 'ad', sns: 'ad', tool: 'ad', event: 'free', job: 'qna' };

// 보드별 RSS — /rss/board/:slug.xml
app.get('/rss/board/:slug.xml', async (req, res) => {
  const slug = req.params.slug;
  if (BOARD_SLUG_ALIASES[slug]) {
    return res.redirect(301, `/rss/board/${BOARD_SLUG_ALIASES[slug]}.xml`);
  }
  try {
    const db = require('./db');
    const { rows } = await db.query('SELECT name FROM boards WHERE slug = $1', [slug]);
    if (rows.length === 0) return res.status(404).type('text').send('not found');
    const xml = await buildRss({
      board: slug,
      title: `마케톡 · ${rows[0].name}`,
      description: `마케톡 ${rows[0].name} 게시판 — 최신 글 피드`,
      selfHref: `https://www.grovel.kr/rss/board/${slug}.xml`,
    });
    res.type('application/rss+xml').send(xml);
  } catch (err) {
    console.error('[rss/board]', err);
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

// 기동 시 schema.sql 자동 적용 — IF NOT EXISTS 기반 멱등. 새 테이블/컬럼이 배포될 때마다 보장됨.
// 비활성화하려면 SKIP_AUTO_MIGRATE=1 env.
async function autoMigrate() {
  if (process.env.SKIP_AUTO_MIGRATE === '1') return;
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf-8');
    await require('./db').query(schemaSql);
    console.log('[auto-migrate] schema 검증 완료');
  } catch (err) {
    console.error('[auto-migrate] 실패 (앱은 계속 기동):', err.message);
  }
}

autoMigrate().finally(() => {
  app.listen(PORT, () => {
    console.log(`🚀 마케톡 listening on :${PORT}`);
  });
});
