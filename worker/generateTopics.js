/**
 * 메타 워커 — 글감(topic_seeds) 자동 생성.
 *
 * Claude에게 보드별로 N개의 새 글감을 제안받아 DB에 저장한다.
 * 한국 마케터 컨텍스트(네이버·카카오·스마트스토어·쿠팡 등) 강조.
 *
 * 사용:
 *   node worker/generateTopics.js                   # 모든 보드에 보드당 20개씩
 *   node worker/generateTopics.js --board ad        # 특정 보드만
 *   node worker/generateTopics.js --count 30        # 보드당 30개
 *   node worker/generateTopics.js --dry-run         # DB 저장 안 함
 *
 * 권장 스케줄: 주 1회 또는 격주 1회.
 */
require('dotenv').config();
const { pool, query } = require('../db');
const { complete } = require('./llm');

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { board: null, count: 20, dryRun: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--board')   out.board = a[++i];
    if (a[i] === '--count')   out.count = parseInt(a[++i]) || 20;
    if (a[i] === '--dry-run' || a[i] === '--dry') out.dryRun = true;
  }
  return out;
}

// ─────────────────────────────────────────────
// 보드별 컨텍스트 — 어떤 글감을 원하는지 명확히 지시
// ─────────────────────────────────────────────
const BOARD_CONTEXTS = {
  free: {
    name: '자유게시판',
    desc: '한국 마케터들의 일상, 푸념, 회사 이야기, 동료 관계, 업무 스트레스, 커리어 고민',
    focus: '플랫폼 종속적이지 않은 사람·일·감정 중심의 잡담 글감',
  },
  ad: {
    name: '광고 노하우',
    desc: '네이버 검색광고/파워링크/쇼핑검색/GFA, 카카오모먼트/비즈보드, 메타(페북·인스타), 구글, 유튜브, 틱톡 광고 실전 운영 노하우',
    focus: '한국 광고 플랫폼이 글감의 60% 이상을 차지하도록. 네이버/카카오를 메타/구글만큼 비중 있게 다룰 것. CPC, CTR, CPA, ROAS, 입찰 전략, 소재, 타겟팅 등 실무 키워드',
  },
  seo: {
    name: 'SEO/검색',
    desc: '네이버 SEO(블로그/카페/인플루언서/C-Rank/D.I.A.), 구글 SEO, 다음 검색, 검색 알고리즘',
    focus: '네이버 SEO를 핵심으로. 한국 검색시장 점유율을 고려해 네이버 글감이 절반 이상',
  },
  sns: {
    name: 'SNS 운영',
    desc: '인스타그램 릴스·스토리·DM, 네이버 블로그·카페, 카카오톡 채널, 유튜브(롱폼·쇼츠), 틱톡, X(트위터)',
    focus: '한국에서 실제로 영향력 있는 채널 위주. 네이버 블로그/카페와 카카오톡 채널을 빼먹지 말 것',
  },
  side: {
    name: '부업/수익화',
    desc: '스마트스토어, 쿠팡 파트너스/로켓그로스, 네이버 블로그 애드포스트, 크몽/숨고/탈잉 외주, 유튜브·인스타 수익화, 디지털 상품 판매, 당근마켓 비즈프로필',
    focus: '한국 1인 사업자/N잡러의 실제 수익화 경로. 스마트스토어와 쿠팡 비중을 높일 것',
  },
  tool: {
    name: '툴/리뷰',
    desc: '한국 마케팅 SaaS(어메이즈, 인사이드, 다이티 등)와 글로벌 툴(GA4, Mixpanel, Hotjar, Notion 등)의 실사용 비교/후기',
    focus: '한국 시장에서 실제로 쓰는 툴. 무료 vs 유료, 국산 vs 글로벌 비교 각도',
  },
  qna: {
    name: '질문답변',
    desc: '실무 중 막힌 질문 (광고 안 풀림, 데이터 안 잡힘, 정책 변경, 계정 정지 복구 등)',
    focus: '진짜 현업에서 자주 검색되는 막힘 포인트. 네이버/카카오/메타 계정 이슈 비중 높게',
  },
  job: {
    name: '구인/협업',
    desc: '마케터 채용 공고, 외주 구함, 협업 파트너 모집',
    focus: '소상공인/스타트업/D2C 브랜드 위주의 현실적 구인',
  },
  event: {
    name: '이벤트',
    desc: '국내 마케팅 컨퍼런스, 웨비나, 강의, 네이버/카카오 광고주 교육',
    focus: '실제로 운영되는 한국 행사 위주',
  },
};

// ─────────────────────────────────────────────
// 프롬프트 빌더
// ─────────────────────────────────────────────
function buildPrompt(boardSlug, count, existingTopics) {
  const ctx = BOARD_CONTEXTS[boardSlug];
  if (!ctx) throw new Error(`Unknown board: ${boardSlug}`);

  const existingBlock = existingTopics.length > 0
    ? `\n\n# 이미 있는 글감 (이것들과 겹치지 않는 새로운 주제로):\n${existingTopics.map(t => `- ${t}`).join('\n')}`
    : '';

  const system = `당신은 한국 마케팅 커뮤니티 "마케톡"의 콘텐츠 큐레이터입니다.
한국 마케터들이 실제로 쓸 법한, 클릭하고 싶은 글감(글 제목 후보)을 만듭니다.
글감은 구체적이고, 한국 시장 맥락(네이버·카카오·스마트스토어·쿠팡 등)을 적극적으로 반영해야 합니다.
일반론("마케팅 잘하는 법")이 아니라 구체적 상황·플랫폼·수치 중심으로 만드세요.`;

  const user = `[보드] ${ctx.name}
[보드 설명] ${ctx.desc}
[핵심 방향] ${ctx.focus}
${existingBlock}

# 작업
위 보드에 어울리는 새 글감 ${count}개를 제안하세요.

# 각 글감의 형식
- topic: 한 줄 주제 (실제 게시글 제목으로 써도 자연스러울 것, 30-60자)
- platform: 가장 관련 있는 플랫폼 키 (naver, kakao, meta, google, youtube, tiktok, x, coupang, smartstore, danggeun, baemin, toss, none 중 하나)
- keywords: 쉼표로 구분된 핵심 키워드 3-5개
- angle: 글을 어떤 관점/스토리로 풀지 한 줄 (선택, 없으면 빈 문자열)

# 출력 형식 (JSON만, 다른 설명 X)
{
  "topics": [
    {"topic":"...","platform":"naver","keywords":"파워링크,입찰가,자동화","angle":"실제 30일 운영 데이터"},
    ...
  ]
}

# 주의
- ${count}개 모두 서로 다른 주제로
- "이미 있는 글감"과 의미가 겹치지 않게
- 클릭하고 싶게, 단 낚시성 자극 제목은 X
- 한국 플랫폼(네이버/카카오/스마트스토어/쿠팡)이 기본값. 글로벌 플랫폼은 한국 마케터가 실제 쓰는 맥락으로
- topic은 짧은 문장 (30-60자), 너무 길면 안 됨
`;

  return { system, user };
}

// ─────────────────────────────────────────────
// JSON 추출
// ─────────────────────────────────────────────
function tryParseJson(text) {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }
  const first = text.indexOf('{');
  const last  = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

// ─────────────────────────────────────────────
// 토픽 검증 + 중복 제거
// ─────────────────────────────────────────────
const VALID_PLATFORMS = new Set([
  'naver','kakao','meta','google','youtube','tiktok','x',
  'coupang','smartstore','danggeun','baemin','toss','none',
]);

function validateAndClean(topics, existingSet) {
  const cleaned = [];
  for (const t of topics) {
    if (!t.topic || typeof t.topic !== 'string') continue;
    const topic = t.topic.trim();
    if (topic.length < 10 || topic.length > 120) continue;
    if (existingSet.has(topic)) continue;

    const platform = VALID_PLATFORMS.has(t.platform) ? t.platform : 'none';

    cleaned.push({
      topic,
      platform,
      keywords: (t.keywords || '').toString().slice(0, 255),
      angle:    (t.angle || '').toString().trim() || null,
    });
    existingSet.add(topic);
  }
  return cleaned;
}

// ─────────────────────────────────────────────
// 보드 한 개 처리
// ─────────────────────────────────────────────
async function generateForBoard(boardSlug, count) {
  // 기존 글감 조회 (회피용)
  const { rows } = await query(
    'SELECT topic FROM topic_seeds WHERE board_slug = $1 ORDER BY created_at DESC LIMIT 80',
    [boardSlug]
  );
  const existing = rows.map(r => r.topic);
  const existingSet = new Set(existing);

  console.log(`\n📋 [${boardSlug}] 기존 ${existing.length}개 → 새 ${count}개 요청`);

  const { system, user } = buildPrompt(boardSlug, count, existing.slice(0, 30));

  const { text, model, usage } = await complete({
    system,
    user,
    maxTokens: 4000,  // 토픽 15개 + 메타데이터는 토큰 많이 필요
    logCtx: { task_type: 'topic_meta', board_slug: boardSlug },
  });

  const parsed = tryParseJson(text);
  if (!parsed || !Array.isArray(parsed.topics)) {
    throw new Error(`JSON 파싱 실패. 응답 머리: ${text.slice(0, 150)}`);
  }

  const cleaned = validateAndClean(parsed.topics, existingSet);
  console.log(`   LLM 응답 ${parsed.topics.length}개 → 검증 통과 ${cleaned.length}개`);
  console.log(`   토큰: in=${usage.input_tokens} out=${usage.output_tokens}`);

  // 미리보기 3개
  cleaned.slice(0, 3).forEach((t, i) => {
    console.log(`     ${i + 1}. [${t.platform}] ${t.topic}`);
  });

  return cleaned;
}

async function saveTopics(boardSlug, topics) {
  let inserted = 0;
  for (const t of topics) {
    try {
      await query(
        `INSERT INTO topic_seeds (board_slug, topic, angle, keywords, platform, source)
         VALUES ($1,$2,$3,$4,$5,'meta_worker')`,
        [boardSlug, t.topic, t.angle, t.keywords, t.platform]
      );
      inserted++;
    } catch (err) {
      console.warn(`     ⚠️ 저장 실패: ${err.message}`);
    }
  }
  return inserted;
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const boards = args.board ? [args.board] : Object.keys(BOARD_CONTEXTS);

  console.log(`🤖 토픽 메타 워커 — ${boards.length}개 보드, 보드당 ${args.count}개 요청${args.dryRun ? ' [DRY-RUN]' : ''}`);

  let totalReq = 0, totalSaved = 0;

  for (const board of boards) {
    try {
      const topics = await generateForBoard(board, args.count);
      totalReq += args.count;
      if (!args.dryRun) {
        const saved = await saveTopics(board, topics);
        totalSaved += saved;
        console.log(`   ✅ ${saved}개 저장됨`);
      }
      // 보드 사이 짧은 휴식 (rate limit 방지)
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`   ❌ [${board}] 실패: ${err.message}`);
    }
  }

  console.log(`\n🎯 총 요청 ${totalReq}개 → 저장 ${totalSaved}개`);
  await pool.end();
}

main().catch(err => {
  console.error('💥 메타 워커 충돌:', err);
  pool.end().then(() => process.exit(1));
});
