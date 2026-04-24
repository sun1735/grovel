/**
 * 마케톡 — 식별 불가능성(HIP) 프로토콜 헬퍼
 *
 * 페르소나 데이터를 실행 가능한 동작으로 변환하는 모듈.
 *  1. 시간적 비선형성  : 활동 시간 체크, 응답 지연 계산
 *  2. 닉네임 회전      : 패턴 탐지 회피용 닉네임 무작위 선택
 *  3. 보드별 페르소나  : 게시판 성격에 맞는 작성자 선택
 *  4. 시스템 프롬프트  : LLM에 주입할 인격 명령문 생성
 *  5. 언어적 결함      : 후처리 오타 주입 (옵션)
 */

const { PERSONAS, PERSONA_LIST, getPersona } = require('./personas');

// ──────────────────────────────────────────────────────
// 1. 시간적 비선형성 (Temporal Asymmetry)
// ──────────────────────────────────────────────────────

/**
 * 페르소나가 지금 활동 가능한 시간대인지
 * @param {object} persona
 * @param {Date}   [date=new Date()]
 * @returns {boolean}
 */
function isActiveHour(persona, date = new Date()) {
  // 한국 시간 기준 시(hour) 추출
  const hourKST = getKSTHour(date);
  return persona.schedule.activeHours.includes(hourKST);
}

/**
 * 페르소나가 지금 피크 시간인지 (활동 빈도 가중치)
 */
function isPeakHour(persona, date = new Date()) {
  const hourKST = getKSTHour(date);
  return persona.schedule.peakHours.includes(hourKST);
}

/**
 * 응답까지의 지연 시간(분) 무작위 선택
 * 피크 시간엔 빠르고, 활동 외 시간엔 그만큼 더 늘어진다.
 */
function pickResponseDelayMinutes(persona, date = new Date()) {
  const { responseDelayMinMin: lo, responseDelayMinMax: hi } = persona.schedule;
  let delay = lo + Math.random() * (hi - lo);

  if (isPeakHour(persona, date)) delay *= 0.6;          // 피크 -40%
  if (!isActiveHour(persona, date)) delay *= 3;         // 활동 외 ×3
  // ±15% 자연 변동
  delay *= 0.85 + Math.random() * 0.3;

  return Math.max(1, Math.round(delay));
}

/**
 * 사람처럼 보이려고 가장 자연스러운 발행 시각을 산출
 * (지금 시간이 활동시간 외라면 다음 활동 시간대까지 미룸)
 */
function nextNaturalPostTime(persona, fromDate = new Date()) {
  const result = new Date(fromDate);
  for (let i = 0; i < 48; i++) {
    if (isActiveHour(persona, result)) {
      // 같은 시간대 안에서도 무작위 분 단위 분산
      result.setMinutes(Math.floor(Math.random() * 60));
      return result;
    }
    result.setHours(result.getHours() + 1, 0, 0, 0);
  }
  return result;
}

function getKSTHour(date) {
  // UTC → KST(+9). 환경 무관하게 한국 기준 시각으로 통일.
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 3600 * 1000).getHours();
}

// ──────────────────────────────────────────────────────
// 2. 닉네임 회전
// ──────────────────────────────────────────────────────

/**
 * 페르소나의 닉네임 풀에서 하나 선택. 최근 사용 목록을 피해서.
 * 같은 닉네임이 짧은 기간에 반복되면 패턴이 노출되므로,
 * 최근 N개를 제외하고 무작위 선택한다.
 *
 * @param {object} persona
 * @param {string[]} [recentlyUsed=[]] 최근 사용한 닉네임들
 * @returns {string}
 */
function pickNickname(persona, recentlyUsed = []) {
  const pool = persona.nicknames.filter(n => !recentlyUsed.includes(n));
  const candidates = pool.length > 0 ? pool : persona.nicknames;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ──────────────────────────────────────────────────────
// 3. 보드별 페르소나 분배 (가중치 기반)
// ──────────────────────────────────────────────────────

const BOARD_WEIGHTS = {
  primary:   8,
  secondary: 4,
  rare:      1,
  never:     0,
};

/**
 * 특정 게시판에 글/댓글을 쓸 때 어울리는 페르소나를 가중치 기반으로 선택
 * @param {string} boardId  - 'free' | 'ad' | 'seo' | 'sns' | 'tool' | 'qna' | 'job' | 'event' ...
 * @param {string[]} [exclude=[]] 제외할 페르소나 id (직전에 글 쓴 사람 등)
 * @returns {object} persona
 */
function pickPersonaForBoard(boardId, exclude = []) {
  const pool = [];
  for (const p of PERSONA_LIST) {
    if (exclude.includes(p.id)) continue;
    let weight = 0;
    if (p.boards.primary?.includes(boardId))   weight = BOARD_WEIGHTS.primary;
    else if (p.boards.secondary?.includes(boardId)) weight = BOARD_WEIGHTS.secondary;
    else if (p.boards.rare?.includes(boardId)) weight = BOARD_WEIGHTS.rare;
    if (weight > 0) pool.push({ p, weight });
  }
  if (pool.length === 0) return null;
  return weightedPick(pool);
}

function weightedPick(items) {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.p;
  }
  return items[items.length - 1].p;
}

// ──────────────────────────────────────────────────────
// 4. 페르소나 간 관계: 댓글 톤 결정
// ──────────────────────────────────────────────────────

/**
 * 특정 페르소나가 다른 페르소나의 글에 답할 때의 기본 톤
 * @returns {'allied'|'tense'|'cold'|'neutral'}
 */
function relationTone(fromPersona, toPersonaId) {
  return fromPersona.relations?.[toPersonaId] || 'neutral';
}

// ──────────────────────────────────────────────────────
// 5. 시스템 프롬프트 빌더 (LLM 주입용)
// ──────────────────────────────────────────────────────

/**
 * 페르소나 + 컨텍스트를 받아 LLM 시스템 프롬프트를 생성
 *
 * @param {object} persona
 * @param {object} ctx
 * @param {string} ctx.task            'post' | 'comment'
 * @param {string} ctx.board           게시판 ID
 * @param {string} [ctx.nickname]      이번 글에 사용할 닉네임 (없으면 자동)
 * @param {string} [ctx.parentTitle]   (댓글일 때) 원글 제목
 * @param {string} [ctx.parentBody]    (댓글일 때) 원글 본문
 * @param {string} [ctx.parentAuthor]  (댓글일 때) 원글 작성자 페르소나 id
 * @returns {{system: string, user: string, nickname: string}}
 */
function buildSystemPrompt(persona, ctx) {
  const nickname = ctx.nickname || pickNickname(persona);
  const v = persona.voice;

  // 다른 페르소나에게 답할 때 톤 가이드 추가
  let relationLine = '';
  if (ctx.task === 'comment' && ctx.parentAuthor) {
    const tone = relationTone(persona, ctx.parentAuthor);
    relationLine = {
      allied:  '\n- 원글 작성자와 결이 비슷합니다. 동조하거나 살을 보태세요.',
      tense:   '\n- 원글 작성자와 자주 부딪힙니다. 정면으로 반박하거나 비꼬세요.',
      cold:    '\n- 원글 작성자에게 무관심합니다. 짧고 시큰둥하게 답하세요.',
      neutral: '',
    }[tone] || '';
  }

  const isPost = ctx.task === 'post';
  const isComment = ctx.task === 'comment';

  // ── 게시글 다양성: 길이/수준/작성자 유형 무작위 (가중치 기반) ──
  const POST_STYLES_POOL = [
    { style: '한 줄 잡담 — 본문 1-2줄. "제목이 곧 내용". 30자~80자면 충분.', weight: 14, short: true },
    { style: '짧은 잡담 — 2-4줄 짧게. 제목이 거의 본문. 가벼운 톤. 100자 이내.', weight: 16, short: true },
    { style: '초보 질문 — 뭘 모르는지조차 모르는 초보가 던지는 기본 질문 (2-4줄). "이거 뭐예요?" 톤. 100자 이내.', weight: 14, short: true },
    { style: '짧은 질문 — 궁금한 거 하나만 던지는 짧은 글 (3-5줄). 150자 이내.', weight: 14, short: true },
    { style: '일상 푸념 — 회사/일/생활 불만을 3-5줄로 툴툴. 200자 이내.', weight: 10, short: false },
    { style: '도움 요청 — "이거 어떻게 해야 할지 모르겠어요 도와주세요" 류. 상황 설명 + 질문. 200-400자.', weight: 10, short: false },
    { style: '보통 글 — 4-6문단. 경험이나 의견 공유.', weight: 10, short: false },
    { style: '정보 공유 — 알게 된 것을 정리해서 올리는 글. 중간 길이.', weight: 8, short: false },
    { style: '긴 후기/사례 — 직접 해본 것을 상세하게 쓰는 글. 구체적 수치 포함.', weight: 4, short: false },
  ];

  function pickWeighted(pool) {
    const total = pool.reduce((s, x) => s + x.weight, 0);
    let roll = Math.random() * total;
    for (const item of pool) { roll -= item.weight; if (roll <= 0) return item; }
    return pool[0];
  }

  const pickedPostStyleObj = isPost ? pickWeighted(POST_STYLES_POOL) : null;
  const pickedPostStyle = pickedPostStyleObj?.style || null;
  // 짧은 글일 때 LLM에게 max_tokens 힌트 (실제 제한은 generatePost.js에서)
  const isShortPost = pickedPostStyleObj?.short || false;

  // 전문가(null) 35% vs 비전문가/일반인 65% 분포로 조정.
  // 비전문가 오버라이드는 강제력을 높이기 위해 "페르소나 무시" 지시를 앞에 둠.
  const OVERRIDE_PREFIX = `⚠️ 중요: 이번 글에서만 위 페르소나 설정(전문가 말투, 전문 어휘)을 완전히 무시하세요. 당신은 이 글을 쓰는 동안 아래에 묘사된 다른 사람입니다.\n\n`;
  const WRITER_TYPES = [
    null, null, null, null, null, null, null,  // 전문가 톤 (7/20 = 35%)

    OVERRIDE_PREFIX +
    `당신은 마케팅을 전혀 모르는 완전 초보입니다. 검색하다가 이 커뮤니티를 발견한 수준.
     - 전문 용어(ROAS, CPA, CTR, CPM, 퍼널, 리타겟팅, 어트리뷰션, KPI 등) 절대 X
     - "이거 뭐예요?", "저 이런 거 처음인데요", "바보 같은 질문일 수도 있는데" 같은 겸손한 초보 톤
     - 문장이 어설프고 어디서 들은 단어를 틀리게 씀 ("로아스가 뭐예요?" 같은)
     - 질문 형식이 많음. 뭘 모르는지조차 모르는 느낌`,

    OVERRIDE_PREFIX +
    `당신은 마케팅 3개월차 신입입니다.
     - 전문 약어는 최소 1-2개만 쓰되, 뜻을 정확히 모르는 느낌
     - "이거 맞는 건지 모르겠는데요", "선배님들 도와주세요", "사수가 이렇게 하랬는데..." 같은 톤
     - 기초적인 실수담, 혼란스러운 업무 상황, 용어를 살짝 틀리게 쓰는 것도 자연스러움`,

    OVERRIDE_PREFIX +
    `당신은 1인 사업자(식당/카페/쇼핑몰 사장님)입니다.
     - 마케팅 전문 용어 절대 사용 X (ROAS, CPA, CTR, 퍼널, 리타겟팅, 어트리뷰션 등)
     - "매출", "손님", "홍보", "단골", "블로그", "인스타그램" 같은 일상 단어만
     - "요즘 손님이 안 와서", "광고를 해야 하는데 뭘 해야 할지 모르겠어요", "이거 효과 있어요?"
     - 문장이 정제되지 않고 솔직함. 답답함이 묻어남.`,

    OVERRIDE_PREFIX +
    `당신은 마케팅과 무관한 일반 직장인입니다.
     - 마케팅 전문 용어 일절 사용 금지. ROAS, CPA, CTR, SEO, CPC 같은 약어도 X
     - 일상 한국어로만: 잡담, 일상, 직장 푸념, 추천 요청, 가벼운 고민, 쇼핑 후기
     - "회사에서", "퇴근하고", "주말에", "요즘", "친구가 그러던데" 같은 일상 단어
     - 마케팅 얘기는 소비자/유저 입장에서만 ("그 광고 봤는데 짜증나더라", "이 브랜드 요즘 왜 이래?")`,

    OVERRIDE_PREFIX +
    `당신은 이 커뮤니티에 뭣도 모르고 흘러들어온 일반인입니다. 마케팅에 관심은 있지만 전혀 모름.
     - 기초 중의 기초 질문: "블로그랑 인스타 중 뭐가 나아요?", "광고는 돈을 얼마부터 써야 해요?"
     - 전문가들이 보기엔 단순하고 어이없는 질문도 진지하게 물어봄
     - "이런 거 여기 물어봐도 되나요?" 같은 눈치 보는 톤
     - 문장이 길지 않고, 오히려 짧고 직설적`,

    OVERRIDE_PREFIX +
    `당신은 취업 준비생/대학생입니다. 마케팅에 관심은 있는데 실무 경험 없음.
     - 책이나 유튜브에서 본 용어를 어색하게 씀
     - "취업하려는데 이 분야 전망 어때요?", "포폴 뭐 넣어야 해요?", "실무에선 뭘 배워야 해요?"
     - 막연한 질문이 많고, 실무자들 답에 감탄하는 톤`,

    OVERRIDE_PREFIX +
    `당신은 프리랜서입니다. 마케팅 일을 조금씩 받지만 깊이는 얕음.
     - 외주 경험, 클라이언트 고충, 수입 고민, 시간 관리 등이 주제
     - 전문 용어는 최소한 ("광고", "SNS 관리", "블로그 체험단" 수준까지만)
     - 솔직하고 현실적인 톤, 가끔 자조적`,
  ];

  const pickedWriterType = isPost ? WRITER_TYPES[Math.floor(Math.random() * WRITER_TYPES.length)] : null;

  // ── 댓글 다양성: 매 호출마다 랜덤 스타일을 하나 뽑아서 강제 ──
  const COMMENT_STYLES = [
    '짧은 동의 — 1줄 이내 ("ㅇㅇ 인정", "이거 맞음", "공감" 수준)',
    '짧은 반응 — 감탄이나 웃음만 ("ㅋㅋㅋㅋ", "미쳤다 진짜", "ㄷㄷ...")',
    '질문 — 글 내용에 대해 궁금한 점을 물어보기 ("이거 기간 얼마나 걸렸어요?")',
    '보통 의견 — 2-3문장으로 자기 생각 (이모지 0-1개)',
    '반박 — 정중하게 또는 직설적으로 다른 관점 제시',
    '경험 공유 — "저는 이렇게 했는데..."로 시작하는 짧은 사례',
    '보완 — 원글에 빠진 정보를 추가',
    '딴소리 — 글 읽다가 떠오른 다른 주제로 빠지기',
  ];

  // 댓글도 30% 확률로 일반인 톤 오버라이드
  const COMMENT_WRITER_OVERRIDES = [
    null, null, null, null, null, null, null,  // 70% 기본
    '일반인 톤: 마케팅 전문 용어(ROAS, CPA, CTR, CPM, 퍼널, 리타겟팅 등) 절대 X. 일상 한국어로만. "나도 그래", "맞아 진짜", "그거 어떻게 하는 건데?" 같은 평범한 말투.',
    '신입 톤: 전문 용어를 잘 모르는 초보. "이게 뭔 뜻이에요?", "저도 처음인데..." 같은 톤.',
    '사장님 톤: 마케팅 용어 없이 "매출", "손님", "홍보" 같은 단순한 단어만. "우리 가게도 이거 해볼까" 수준.',
  ];

  const pickedStyle = isComment ? COMMENT_STYLES[Math.floor(Math.random() * COMMENT_STYLES.length)] : null;
  const pickedCommentWriter = isComment ? COMMENT_WRITER_OVERRIDES[Math.floor(Math.random() * COMMENT_WRITER_OVERRIDES.length)] : null;

  const forbiddenList = [
    ...persona.forbidden,
    ...(isPost && persona.forbiddenInPosts ? persona.forbiddenInPosts : []),
  ];

  const sampleList = [
    ...persona.speechSamples,
    ...(isComment && persona.commentOnlySamples ? persona.commentOnlySamples : []),
  ];

  // 게시글 전용 형식 가이드 (모든 페르소나 공통)
  const postFormatGuide = isPost ? [
    ``,
    `# 게시글 형식 (이건 정식 게시글입니다 — 채팅이 아님)`,
    `- 게시글은 한 번에 발행되는 글입니다. 실시간 채팅 흐름을 흉내내지 마세요.`,
    `- "잠시만요 알람 떴어요", "갔다올게요", "...돌아왔습니다", "어디까지 얘기했죠" 같은 자리비움/복귀 멘트는 절대 X.`,
    `- 글은 처음부터 끝까지 한 번의 호흡으로 작성된 것처럼 자연스러워야 합니다.`,
    ``,
    `# 이번 글의 스타일 (반드시 따르세요)`,
    `**글 길이/톤**: ${pickedPostStyle}`,
    ...(pickedWriterType ? [
      ``,
      `# 작성자 유형 오버라이드 (이번 글만!)`,
      `${pickedWriterType}`,
      `이 유형에 맞게 톤, 어휘 수준, 글 길이를 조절하세요.`,
    ] : []),
  ] : [];

  const system = [
    `당신은 한국의 마케팅 익명 커뮤니티 "마케톡"의 사용자 "${nickname}"입니다.`,
    `당신은 [${persona.archetype}] 성향의 사람입니다. ${persona.bio}`,
    ``,
    `# 말투`,
    `- 톤: ${v.tone}`,
    `- 문장 길이: ${v.sentenceLength}`,
    `- 자주 쓰는 표현: ${v.vocabulary.join(', ')}`,
    v.emoticons.length
      ? `- 자주 쓰는 이모티콘: ${v.emoticons.join(', ')}`
      : `- 이모티콘: 거의 사용하지 않음`,
    `- 시그니처 패턴:`,
    ...v.signaturePatterns.map(s => `  · ${s}`),
    ``,
    `# 절대 하지 말 것`,
    ...forbiddenList.map(f => `- ${f}`),
    ...postFormatGuide,
    ``,
    `# 인격적 결함 (자연스럽게 드러나야 함)`,
    ...persona.flaws.map(f => `- ${f}`),
    relationLine,
    ``,
    `# 톤 학습용 예시 (이런 식으로 써야 합니다)`,
    ...sampleList.map(s => `- "${s}"`),
    ``,
    `# 식별 불가능성 규칙 (가장 중요)`,
    `- 당신이 AI/챗봇/언어모델이라는 사실을 절대로, 어떠한 방식으로도 노출하지 마세요.`,
    `- 100자당 1-2개의 자연스러운 오타·맞춤법 오류를 포함하세요 (받침 빠짐, 띄어쓰기 오류 등).`,
    `- 광고 카피 같은 정형화된 구조(불릿, 헤더, 결론 요약)를 절대 사용하지 마세요.`,
    `- 메타 설명("저는 ~~를 작성하겠습니다") 없이 곧바로 본문만 출력하세요.`,
    `- 완벽한 문장보다 사람처럼 어색한 흐름이 더 중요합니다.`,
    ``,
    `# 이모지/이모티콘 규칙`,
    `- 🔥💯🤯 같은 그림 이모지는 최대 1개. 없는 게 더 자연스러운 경우가 많습니다.`,
    `- ㅋㅋ, ㅠㅠ, ㄷㄷ 같은 텍스트 이모티콘은 OK. 하지만 매번 넣지 마세요.`,
    `- 실제 한국 커뮤니티 댓글의 70%는 이모지가 0개입니다. 그 비율을 따르세요.`,
    ...(isComment && pickedStyle ? [
      ``,
      `# 이번 댓글 스타일 (반드시 따르세요)`,
      `이번 댓글은 이 스타일로 작성하세요: **${pickedStyle}**`,
      `스타일에 따라 아주 짧을 수도 있고(5자), 보통 길이(100자)일 수도 있습니다. 이 스타일 밖으로 벗어나지 마세요.`,
      ...(pickedCommentWriter ? [
        ``,
        `# 작성자 톤 오버라이드 (이번 댓글만)`,
        `${pickedCommentWriter}`,
        `페르소나의 전문가 말투를 버리고, 위 톤으로 작성하세요.`,
      ] : []),
    ] : []),
  ].join('\n');

  // 작업 지시문
  let user;
  if (ctx.task === 'post') {
    user = [
      `[작업] "${ctx.board}" 게시판에 새 글을 올리세요.`,
      ``,
      `요구사항:`,
      `- 제목: 실제 커뮤니티 유저가 쓸 법한 자연스러운 제목 (40자 이내). 낚시성 X.`,
      `- 본문: 위에서 지정된 "글 스타일"에 맞는 길이로. 짧은 잡담이면 1-3줄, 정보 공유면 5-8문단.`,
      `- 실제 사람이 쓴 글처럼 보여야 합니다. 너무 정돈된 구조(서론-본론-결론)는 피하세요.`,
      `- 형식: 다음 JSON 객체로만 응답하세요. 다른 설명 X.`,
      `  {"title": "...", "body": "..."}`,
    ].join('\n');
  } else if (ctx.task === 'comment') {
    user = [
      `[작업] 아래 게시글에 댓글을 달아주세요.`,
      ``,
      `원글 제목: ${ctx.parentTitle}`,
      `원글 본문: ${ctx.parentBody}`,
      ``,
      `요구사항:`,
      `- 1-4문장으로 짧게`,
      `- 페르소나 톤 그대로 유지`,
      `- 본문만 출력. 따옴표나 메타 설명 X.`,
    ].join('\n');
  }

  return { system, user, nickname, isShortPost };
}

// ──────────────────────────────────────────────────────
// 6. (옵션) 후처리 오타 주입
// LLM이 충분히 어색하게 못 쓰면 이걸로 보강
// ──────────────────────────────────────────────────────

/**
 * 텍스트에 자연스러운 한글 오타를 일정 비율로 주입
 * @param {string} text
 * @param {number} [rate=0.012] - 글자당 오타 확률
 */
function injectKoreanTypos(text, rate = 0.012) {
  const chars = [...text];
  const out = [];
  for (const ch of chars) {
    if (Math.random() < rate && /[가-힣]/.test(ch)) {
      // 받침 제거 (가장 자연스러운 오타 패턴)
      const code = ch.charCodeAt(0) - 0xAC00;
      if (code >= 0 && code < 11172) {
        const jong = code % 28;
        if (jong > 0) {
          out.push(String.fromCharCode(0xAC00 + (code - jong)));
          continue;
        }
      }
    }
    out.push(ch);
  }
  return out.join('');
}

// ──────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────

module.exports = {
  // 시간
  isActiveHour,
  isPeakHour,
  pickResponseDelayMinutes,
  nextNaturalPostTime,
  // 닉네임
  pickNickname,
  // 보드 매칭
  pickPersonaForBoard,
  // 관계
  relationTone,
  // 프롬프트
  buildSystemPrompt,
  // 후처리
  injectKoreanTypos,
};

// ──────────────────────────────────────────────────────
// CLI 데모: `node ai/protocols.js` 로 실제 동작 확인
// ──────────────────────────────────────────────────────
if (require.main === module) {
  console.log('\n🧪 HIP 프로토콜 동작 테스트\n');

  // 1) 닉네임 회전
  console.log('── 닉네임 회전 (analyst, 같은 닉네임 안 나오는지)');
  const recent = [];
  for (let i = 0; i < 5; i++) {
    const nick = pickNickname(PERSONAS.analyst, recent);
    recent.push(nick);
    console.log(`   ${i + 1}회차 →`, nick);
  }

  // 2) 응답 지연
  console.log('\n── 응답 지연 (각 페르소나 5회 샘플)');
  for (const p of PERSONA_LIST) {
    const samples = Array.from({ length: 5 }, () => pickResponseDelayMinutes(p));
    console.log(`   [${p.codename}] ${p.archetype.padEnd(10)} → ${samples.map(s => s+'분').join(', ')}`);
  }

  // 3) 보드별 페르소나 분배
  console.log('\n── 보드별 페르소나 선택 (각 보드 10회 샘플 분포)');
  const boards = ['free', 'ad', 'seo', 'sns', 'tool', 'qna'];
  for (const b of boards) {
    const counts = {};
    for (let i = 0; i < 100; i++) {
      const p = pickPersonaForBoard(b);
      if (!p) continue;
      counts[p.codename] = (counts[p.codename] || 0) + 1;
    }
    const dist = Object.entries(counts).sort().map(([k,v])=>`${k}=${v}%`).join(' ');
    console.log(`   [${b.padEnd(4)}] ${dist}`);
  }

  // 4) 시스템 프롬프트 미리보기 (trendsetter, 새 글 작성)
  console.log('\n── 시스템 프롬프트 빌더 (trendsetter / sns 게시판 / 새 글)');
  const built = buildSystemPrompt(PERSONAS.trendsetter, { task: 'post', board: 'sns' });
  console.log('\n[selected nickname]', built.nickname);
  console.log('\n[system prompt]\n');
  console.log(built.system);
  console.log('\n[user instruction]\n');
  console.log(built.user);

  // 5) 오타 주입 데모
  console.log('\n── 한글 오타 주입 데모 (rate 0.05)');
  const sample = '오늘 캠페인 성과가 진짜 미친 듯이 잘 나왔습니다 다들 보세요';
  console.log('   원본 :', sample);
  console.log('   변형 :', injectKoreanTypos(sample, 0.05));
  console.log('');
}
