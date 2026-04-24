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
 *   node worker/generateNews.js --force   # 오늘 이미 올라가 있어도 강제 발행
 *
 * Railway Cron 권장: 여러 번 찔러봄 (실패해도 복구)
 *   Schedule: "0 23,0,2,5 * * *"   (UTC 23/00/02/05시 = KST 08/09/11/14시)
 *   내부 dedup(20시간 이내 발행 여부)이 중복 방지하므로 반복 실행 안전.
 *   하루 중 단 1번이라도 성공하면 브리핑이 올라감.
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
//   - 1차: 마케팅 키워드 필터 통과 기사
//   - 2차(폴백): 아무것도 안 걸리면 최신 기사 상위를 그대로 씀
//   - 피드별 1회 재시도 (일시적 네트워크 오류 대비)
// ─────────────────────────────────────────────
const MARKETING_KEYWORDS = [
  '마케팅','광고','네이버','카카오','메타','구글','인스타','유튜브','틱톡',
  '이커머스','쇼핑','브랜드','캠페인','seo','cpc','cpm','roas',
  '스마트스토어','쿠팡','d2c','콘텐츠','인플루언서','크리에이터',
  'ad','marketing','digital','commerce','platform',
];

async function fetchFeedWithRetry(src) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await parser.parseURL(src.url);
    } catch (err) {
      if (attempt === 2) {
        console.warn(`[rss] ${src.name} 최종 실패:`, err.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return null;
}

async function fetchAllFeeds() {
  const relevant = [];       // 마케팅 키워드 매칭
  const allRecent = [];      // 폴백용 (필터 무시)
  const cutoff = Date.now() - 48 * 3600 * 1000; // 최근 48시간

  for (const src of RSS_FEEDS) {
    const feed = await fetchFeedWithRetry(src);
    if (!feed) continue;
    for (const item of (feed.items || []).slice(0, 10)) {
      const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
      if (pubDate < cutoff) continue;

      const article = {
        source: src.name,
        title: (item.title || '').trim(),
        snippet: (item.contentSnippet || '').slice(0, 300).trim(),
        link: item.link || '',
        pubDate: new Date(pubDate),
      };
      if (!article.title) continue;

      allRecent.push(article);

      const text = ((article.title) + ' ' + (article.snippet)).toLowerCase();
      if (MARKETING_KEYWORDS.some(k => text.includes(k))) {
        relevant.push(article);
      }
    }
  }

  const pool = relevant.length > 0 ? relevant : allRecent;
  if (relevant.length === 0 && allRecent.length > 0) {
    console.log('  ℹ️ 키워드 매칭 0건 → 최신 기사 폴백 사용');
  }

  // 최신순 정렬 + 중복 제거
  const seen = new Set();
  const unique = pool.filter(a => {
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
// KST 기준 오늘 날짜 (타이틀 프리픽스용)
// ─────────────────────────────────────────────
function getKSTDateLabel() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 3600 * 1000);
  return `${kst.getMonth() + 1}/${kst.getDate()}`;
}

// "오늘의 마케팅 브리핑 — 키워드" → "[4/24] 마케팅 브리핑 — 키워드"
function formatTitleWithDate(rawTitle, dateLabel) {
  let t = (rawTitle || '').trim().replace(/^["']|["']$/g, '');
  // "오늘의", "오늘" 접두 제거 (중복 방지)
  t = t.replace(/^오늘의?\s*/, '');
  // 이미 날짜가 들어 있으면 그대로 두되, 없으면 프리픽스
  if (/^\[?\d+\/\d+\]?/.test(t) || /\d+월\s*\d+일/.test(t)) {
    return t.slice(0, 240);
  }
  return `[${dateLabel}] ${t}`.slice(0, 240);
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function main() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');
  const isForce  = process.argv.includes('--force');

  console.log(`📰 마케팅 뉴스 브리핑 워커 시작${isDryRun ? ' [DRY-RUN]' : ''}${isForce ? ' [FORCE]' : ''}`);

  // 중복 체크 (--force 시 스킵)
  if (!isDryRun && !isForce) {
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
  const dateLabel = getKSTDateLabel();
  const finalTitle = formatTitleWithDate(result.title, dateLabel);
  console.log(`  제목: ${finalTitle}`);
  console.log(`  본문: ${result.body.slice(0, 150)}...`);
  console.log(`  플랫폼: ${result.platform || 'none'}`);

  // 3. 원문 출처 링크 추가
  const sourceBlock = '\n\n---\n\n📌 **원문 출처**\n' +
    articles.map(a => `- [${a.source}] ${a.title}\n  ${a.link}`).join('\n');
  const fullBody = result.body + sourceBlock;

  // 4. 저장
  if (!isDryRun) {
    const saved = await saveNewsPost(finalTitle, fullBody, result.platform);
    console.log(`\n✅ 브리핑 발행 완료 (id=${saved.id})`);

    // 디스코드 알림
    notifyNewPost({
      id: saved.id,
      title: finalTitle,
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
