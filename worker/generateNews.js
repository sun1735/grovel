/**
 * 마케톡 — 마케팅 뉴스 브리핑 자동 생성 워커
 *
 * 흐름:
 *   1. RSS 피드에서 최근 마케팅 뉴스 수집
 *   2. Claude가 분석 브리핑 작성
 *   3. 작성자 "마케톡" (페르소나 X)으로 news 보드에 발행
 *
 * 사용:
 *   node worker/generateNews.js           # 1회 실행
 *   node worker/generateNews.js --dry-run # 미리보기만
 *
 * Railway Cron 권장: 매일 1회 (한국 시간 08:00)
 *   Schedule: "0 23 * * *"   (UTC 23:00 = KST 08:00)
 *   Start Command: "node worker/generateNews.js"
 */
require('dotenv').config();
const Parser = require('rss-parser');
const { pool, query } = require('../db');
const { complete } = require('./llm');
const { notifyNewPost } = require('./discord');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'MarketalkBot/1.0' },
});

// ─────────────────────────────────────────────
// RSS 소스 (한국 마케팅/테크 뉴스)
// ─────────────────────────────────────────────
const RSS_FEEDS = [
  { name: '모비인사이드', url: 'https://www.mobiinside.co.kr/feed/' },
  { name: '바이라인네트워크', url: 'https://byline.network/feed/' },
  { name: '플래텀', url: 'https://platum.kr/feed' },
  { name: '블로터', url: 'https://www.bloter.net/feed' },
];

// ─────────────────────────────────────────────
// RSS 수집
// ─────────────────────────────────────────────
async function fetchAllFeeds() {
  const articles = [];
  const cutoff = Date.now() - 48 * 3600 * 1000; // 최근 48시간

  for (const src of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(src.url);
      for (const item of (feed.items || []).slice(0, 10)) {
        const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
        if (pubDate < cutoff) continue;

        // 마케팅 관련 필터 (넓게)
        const text = ((item.title || '') + ' ' + (item.contentSnippet || '')).toLowerCase();
        const marketingKeywords = [
          '마케팅','광고','네이버','카카오','메타','구글','인스타','유튜브','틱톡',
          '이커머스','쇼핑','브랜드','캠페인','seo','cpc','cpm','roas',
          '스마트스토어','쿠팡','d2c','콘텐츠','인플루언서','크리에이터',
          'ad','marketing','digital','commerce','platform',
        ];
        const isRelevant = marketingKeywords.some(k => text.includes(k));
        if (!isRelevant) continue;

        articles.push({
          source: src.name,
          title: (item.title || '').trim(),
          snippet: (item.contentSnippet || '').slice(0, 300).trim(),
          link: item.link || '',
          pubDate: new Date(pubDate),
        });
      }
    } catch (err) {
      console.warn(`[rss] ${src.name} 실패:`, err.message);
    }
  }

  // 최신순 정렬 + 중복 제거
  const seen = new Set();
  const unique = articles.filter(a => {
    const key = a.title.slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.pubDate - a.pubDate);

  return unique.slice(0, 8); // 상위 8개
}

// ─────────────────────────────────────────────
// Claude 분석 브리핑 생성
// ─────────────────────────────────────────────
async function generateBriefing(articles) {
  if (articles.length === 0) {
    throw new Error('분석할 뉴스가 없습니다.');
  }

  const articleList = articles.map((a, i) =>
    `${i + 1}. [${a.source}] ${a.title}\n   ${a.snippet}`
  ).join('\n\n');

  const system = `당신은 한국 마케팅 전문 에디터입니다. 여러 뉴스를 종합하여 마케터에게 도움이 되는 브리핑 리포트를 작성합니다.

# 작성 규칙
- 마케톡 커뮤니티의 공식 뉴스 브리핑입니다
- 객관적이고 분석적인 톤, 하지만 딱딱하지 않게
- 각 뉴스의 마케터 실무 영향을 반드시 짚어주세요
- 한국 마케팅 시장 맥락에서 해석
- "~입니다" 체 사용 (공식 브리핑)
- 이모지는 섹션 구분용으로만 가끔
- AI라는 사실 절대 노출 X`;

  const user = `다음은 최근 마케팅 관련 뉴스 ${articles.length}건입니다.

${articleList}

# 작업
위 뉴스를 종합 분석하여 "마케팅 뉴스 브리핑" 글을 작성하세요.

구성:
1. 제목: "오늘의 마케팅 브리핑 — [핵심 키워드 1-2개]" 형태 (30-50자)
2. 본문:
   - 도입 (2-3줄): 오늘 주목할 포인트 요약
   - 주요 뉴스별 분석 (각 뉴스마다 요약 + 마케터 영향 + 대응 포인트)
   - 마무리: 실무자를 위한 한 줄 인사이트

형식: JSON으로만 응답
{"title": "...", "body": "...", "platform": "가장 관련 있는 플랫폼 키 또는 none"}`;

  const { text } = await complete({
    system, user,
    maxTokens: 3000,
    logCtx: { task_type: 'news', persona_id: null, board_slug: 'news' },
  });

  // JSON 파싱
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON 파싱 실패');
  return JSON.parse(match[0]);
}

// ─────────────────────────────────────────────
// DB 저장
// ─────────────────────────────────────────────
async function saveNewsPost(title, body, platform) {
  // news 보드 ID 조회
  const { rows: boardRows } = await query(
    "SELECT id FROM boards WHERE slug = 'news'"
  );
  if (boardRows.length === 0) throw new Error('news 보드가 없습니다');

  const { rows } = await query(
    `INSERT INTO posts
      (board_id, persona_id, user_id, author_nickname, title, body, platform,
       view_count, is_ai, is_pinned)
     VALUES ($1, NULL, NULL, '마케톡', $2, $3, $4, $5, TRUE, FALSE)
     RETURNING id, published_at`,
    [boardRows[0].id, title.trim(), body.trim(), platform || null,
     30 + Math.floor(Math.random() * 120)]
  );
  return rows[0];
}

// ─────────────────────────────────────────────
// 중복 체크 (같은 날 이미 발행했는지)
// ─────────────────────────────────────────────
async function alreadyPublishedToday() {
  const { rows } = await query(`
    SELECT p.id FROM posts p
    JOIN boards b ON b.id = p.board_id
    WHERE b.slug = 'news'
      AND p.author_nickname = '마케톡'
      AND p.published_at > NOW() - INTERVAL '20 hours'
    LIMIT 1
  `);
  return rows.length > 0;
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');

  console.log(`📰 마케팅 뉴스 브리핑 워커 시작${isDryRun ? ' [DRY-RUN]' : ''}`);

  // 중복 체크
  if (!isDryRun) {
    const already = await alreadyPublishedToday();
    if (already) {
      console.log('  ⏭ 오늘 이미 브리핑이 발행되어 건너뜁니다.');
      await pool.end();
      return;
    }
  }

  // 1. RSS 수집
  console.log('\n📡 RSS 수집 중...');
  const articles = await fetchAllFeeds();
  console.log(`  수집된 기사: ${articles.length}개`);
  articles.forEach((a, i) => console.log(`  ${i + 1}. [${a.source}] ${a.title.slice(0, 50)}`));

  if (articles.length === 0) {
    console.log('  ⚠️ 마케팅 관련 기사를 찾지 못했습니다.');
    await pool.end();
    return;
  }

  // 2. Claude 분석
  console.log('\n🤖 Claude 분석 중...');
  const result = await generateBriefing(articles);
  console.log(`  제목: ${result.title}`);
  console.log(`  본문: ${result.body.slice(0, 150)}...`);
  console.log(`  플랫폼: ${result.platform || 'none'}`);

  // 3. 저장
  if (!isDryRun) {
    const saved = await saveNewsPost(result.title, result.body, result.platform);
    console.log(`\n✅ 브리핑 발행 완료 (id=${saved.id})`);

    // 디스코드 알림
    notifyNewPost({
      id: saved.id,
      title: result.title,
      author: '마케톡',
      board: '뉴스/동향',
      excerpt: result.body.slice(0, 150),
    }).catch(() => {});
  } else {
    console.log('\n🧪 DRY-RUN — 저장하지 않음');
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('💥 뉴스 워커 충돌:', err);
  await pool.end();
  process.exit(1);
});
