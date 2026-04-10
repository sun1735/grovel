/**
 * 마케톡 — 초기 글감 풀 (수동 큐레이션)
 *
 * 한국 마케터의 실제 일상·이슈·플랫폼을 반영.
 * 메타 워커(worker/generateTopics.js)가 주기적으로 더 추가한다.
 *
 * 형식:
 *   { topic: '한 줄 주제', platform: '플랫폼 키', keywords: '쉼표,구분', angle: '풀어가는 각도(선택)' }
 *
 * platform 값:
 *   naver, kakao, meta, google, youtube, tiktok, x,
 *   coupang, smartstore, baemin, danggeun, toss, none
 */

const SEEDS = {

  // ───────────────────────────────────────
  // 자유게시판 — 일상·푸념·잡담
  // ───────────────────────────────────────
  free: [
    { topic: '마케터인데 디자이너랑 자꾸 트러블 나는 거 다들 어떻게 푸심', platform: 'none', keywords: '협업,디자이너,트러블' },
    { topic: '월말 결산할 때 광고대행사 보고서가 너무 두꺼워서 한숨', platform: 'none', keywords: '대행사,보고서,월말' },
    { topic: '회사에서 "ROAS 안 나오면 마케터 책임"이라는데 이거 정상임?', platform: 'none', keywords: 'ROAS,책임,회사문화' },
    { topic: '대표가 자꾸 인스타 광고만 하라고 함... 다른 채널 설득하는 법', platform: 'meta', keywords: '대표,설득,채널다각화' },
    { topic: '신입 마케터가 가장 빨리 성장하는 방법이 뭘까요', platform: 'none', keywords: '신입,성장,커리어' },
    { topic: '광고 데이터 정리하다가 새벽까지 야근... 다들 이렇게 일하나요', platform: 'none', keywords: '야근,번아웃,데이터정리' },
    { topic: '대행사 vs 인하우스, 어디가 더 성장에 좋을까', platform: 'none', keywords: '커리어,대행사,인하우스' },
    { topic: '이직 면접에서 "성과 사례 말씀해 주세요" 받았을 때 답변 노하우', platform: 'none', keywords: '이직,면접,성과사례' },
    { topic: '브랜드 마케터인데 매출 책임지라는 압박... 정상인가요', platform: 'none', keywords: '브랜드,매출,KPI' },
    { topic: '마케터 연봉 협상할 때 어떤 데이터를 들고 가야 함?', platform: 'none', keywords: '연봉,협상,데이터' },
  ],

  // ───────────────────────────────────────
  // 광고 노하우 — 가장 활발해야 할 보드
  // ───────────────────────────────────────
  ad: [
    // 네이버
    { topic: '네이버 검색광고 파워링크 입찰가 자동입찰 vs 수동입찰 비교', platform: 'naver', keywords: '파워링크,자동입찰,수동입찰', angle: '실제 30일 운영 데이터' },
    { topic: '네이버 쇼핑검색광고 ROAS 5 넘게 뽑은 키워드 세팅 노하우', platform: 'naver', keywords: '쇼핑검색,ROAS,키워드' },
    { topic: '네이버 GFA 처음 돌려본 후기 — 페북 광고 출신이 느낀 차이', platform: 'naver', keywords: 'GFA,비교,후기' },
    { topic: '네이버 브랜드검색 vs 파워링크 어디에 예산 더 써야 함?', platform: 'naver', keywords: '브랜드검색,파워링크,예산배분' },
    { topic: '네이버 검색광고 품질지수 올리는 5가지 실전 팁', platform: 'naver', keywords: '품질지수,네이버,SEO' },
    { topic: '네이버 파워컨텐츠 광고 진짜 효과 있음? 솔직 후기', platform: 'naver', keywords: '파워컨텐츠,블로그광고' },

    // 카카오
    { topic: '카카오모먼트 처음 돌려보는 분 위한 세팅 가이드 (캡처 포함)', platform: 'kakao', keywords: '카카오모먼트,세팅,초보' },
    { topic: '카카오 비즈보드 클릭률 1% 넘기기 — 소재 만드는 법', platform: 'kakao', keywords: '비즈보드,CTR,소재' },
    { topic: '카카오톡 채널 친구추가 단가 최근 너무 올라서 답답', platform: 'kakao', keywords: '톡채널,친구추가,단가' },
    { topic: '카카오 광고 vs 네이버 광고 — 우리 타겟엔 뭐가 맞을까', platform: 'kakao', keywords: '카카오,네이버,비교' },
    { topic: '카카오모먼트에서 픽셀 안 잡힐 때 체크리스트', platform: 'kakao', keywords: '카카오픽셀,트래킹' },

    // 메타 (페북/인스타)
    { topic: '메타 광고 CBO vs ABO 진짜 결론 — 30개 캠페인 비교', platform: 'meta', keywords: 'CBO,ABO,예산구조' },
    { topic: '메타 어드밴티지+ 캠페인 진짜 잘 돌까? 한 달 결과 공유', platform: 'meta', keywords: '어드밴티지,자동화' },
    { topic: '인스타 광고 CPC 진짜 미친듯이 올랐는데 다들 어떻게 대응함', platform: 'meta', keywords: 'CPC,인스타,상승' },
    { topic: '메타 광고 소재 A/B 테스트 효율적으로 돌리는 법', platform: 'meta', keywords: 'AB테스트,소재,효율' },
    { topic: '페이스북 픽셀 → CAPI 전환 후기 (정확도 변화)', platform: 'meta', keywords: 'CAPI,픽셀,트래킹' },

    // 구글
    { topic: '구글 검색광고 한국 시장에서 진짜 효과 있음? 솔직 후기', platform: 'google', keywords: '구글애드,한국시장' },
    { topic: '구글 P-MAX 캠페인 돌려본 후기 — 블랙박스가 너무 답답함', platform: 'google', keywords: 'PMAX,블랙박스' },
    { topic: 'GA4 이벤트 자꾸 중복으로 잡힐 때 디버깅 방법', platform: 'google', keywords: 'GA4,이벤트,디버깅' },

    // 유튜브
    { topic: '유튜브 광고 인스트림 스킵률 줄이는 첫 5초 만드는 법', platform: 'youtube', keywords: '인스트림,스킵률,훅' },
    { topic: '유튜브 쇼츠 광고 효율 진짜 어떨까 — 일주일 운영 데이터', platform: 'youtube', keywords: '쇼츠광고,효율' },

    // 틱톡
    { topic: '틱톡 광고 한국에서 돌릴 만함? CPM 비교 데이터', platform: 'tiktok', keywords: '틱톡,CPM,한국' },

    // 통합/전략
    { topic: '예산 100만원으로 신제품 채널 검증하는 가장 빠른 순서', platform: 'none', keywords: '예산,검증,신제품' },
    { topic: '광고비 0원에서 매출 1000만원까지 — 작은 D2C 브랜드 사례', platform: 'none', keywords: 'D2C,저예산,사례' },
    { topic: '리타겟팅 vs 신규 획득 — 예산 비율 어떻게 잡으세요', platform: 'none', keywords: '리타겟팅,예산배분' },
  ],

  // ───────────────────────────────────────
  // SEO/검색 — 네이버 SEO가 한국 핵심
  // ───────────────────────────────────────
  seo: [
    // 네이버
    { topic: '네이버 블로그 상위노출 알고리즘 — 2026년 현재 기준', platform: 'naver', keywords: '네이버블로그,상위노출,C-rank' },
    { topic: '네이버 인플루언서 검색 진입 — 키워드 챌린지 노하우', platform: 'naver', keywords: '인플루언서,키워드챌린지' },
    { topic: '네이버 카페 글이 검색에 안 잡힐 때 체크할 5가지', platform: 'naver', keywords: '네이버카페,SEO' },
    { topic: '네이버 D.I.A. 알고리즘 vs C-Rank — 어떤 게 더 중요?', platform: 'naver', keywords: 'DIA,Crank,알고리즘' },
    { topic: '네이버 블로그 vs 티스토리 — SEO 관점에서 비교', platform: 'naver', keywords: '블로그,티스토리,비교' },
    { topic: '네이버 상위노출용 글 첫 100자 작성 공식', platform: 'naver', keywords: '네이버,첫문단,SEO' },
    { topic: '네이버 검색어 자동완성에 우리 브랜드 띄우는 법 (합법 한정)', platform: 'naver', keywords: '자동완성,브랜드' },

    // 구글
    { topic: '구글 SEO 한국 시장 점유율 진짜 늘고 있나? 데이터 공유', platform: 'google', keywords: '구글SEO,점유율' },
    { topic: 'Search Console 인덱싱 거부 페이지 복구한 케이스', platform: 'google', keywords: 'SearchConsole,인덱싱' },
    { topic: '백링크 작업 어디까지가 화이트햇이고 어디부터 블랙햇임', platform: 'google', keywords: '백링크,화이트햇' },

    // 다음/기타
    { topic: '다음 검색 점유율 진짜 떨어졌나? 트래픽 분석', platform: 'none', keywords: '다음,점유율' },
    { topic: '브랜드 검색량 늘리는 가장 빠른 방법 — 실제 사례', platform: 'none', keywords: '브랜드검색량,그로스' },
  ],

  // ───────────────────────────────────────
  // SNS 운영
  // ───────────────────────────────────────
  sns: [
    // 인스타
    { topic: '릴스 도달률 떨어진 거 나만 그런 거 아니죠?? 알고리즘 변화 추정', platform: 'meta', keywords: '릴스,도달률,알고리즘' },
    { topic: '인스타 스토리 하이라이트 — 진짜 매출에 기여하는 운영법', platform: 'meta', keywords: '스토리,하이라이트' },
    { topic: '브랜드 계정 팔로워 1만 만드는 데 6개월 걸린 이유', platform: 'meta', keywords: '인스타,팔로워,그로스' },
    { topic: '인스타 광고 vs 인플루언서 협찬 — ROI 비교', platform: 'meta', keywords: '인플루언서,ROI' },

    // 네이버
    { topic: '네이버 블로그 운영 진짜 의미 있음? 2026년 시점 재평가', platform: 'naver', keywords: '네이버블로그,콘텐츠' },
    { topic: '네이버 카페 운영 — 활성 회원 늘리는 운영 노하우', platform: 'naver', keywords: '네이버카페,커뮤니티' },

    // 카카오
    { topic: '카카오톡 채널 운영 — 차단율 낮추는 메시지 작성법', platform: 'kakao', keywords: '톡채널,차단율' },
    { topic: '카카오 이모티콘 마케팅 — 실제 효과는?', platform: 'kakao', keywords: '이모티콘,마케팅' },

    // 유튜브
    { topic: '유튜브 쇼츠 1개월 운영 결과 — 구독 0→3.4k 후기', platform: 'youtube', keywords: '쇼츠,구독,그로스' },
    { topic: '유튜브 알고리즘이 좋아하는 썸네일 패턴 분석', platform: 'youtube', keywords: '썸네일,CTR' },

    // 틱톡/X
    { topic: '틱톡 한국에서 살아남았나? 운영자 입장에서 본 현재', platform: 'tiktok', keywords: '틱톡,한국' },
    { topic: 'X(트위터) 마케팅이 되살아난 산업 — 우리 브랜드도 가능?', platform: 'x', keywords: 'X,트위터' },
  ],

  // ───────────────────────────────────────
  // 부업/수익화
  // ───────────────────────────────────────
  side: [
    { topic: '스마트스토어 처음 6개월 — 매출 0에서 월 300까지', platform: 'smartstore', keywords: '스마트스토어,초기,매출' },
    { topic: '스마트스토어 키워드 잡는 게 진짜 80% — 노하우 공유', platform: 'smartstore', keywords: '키워드,상위노출' },
    { topic: '쿠팡 파트너스 한 달 정산 후기 (트래픽 vs 수익)', platform: 'coupang', keywords: '쿠팡파트너스,수익' },
    { topic: '쿠팡 로켓그로스 입점 후기 — 광고 안 돌려도 매출 나옴?', platform: 'coupang', keywords: '쿠팡,로켓그로스' },
    { topic: '네이버 블로그 애드포스트로 한 달 30만원 — 가능한가', platform: 'naver', keywords: '애드포스트,수익화' },
    { topic: '크몽 외주 받아서 살아남은 1년차 후기.txt', platform: 'none', keywords: '크몽,외주,프리랜서' },
    { topic: '숨고/탈잉/크몽 — 마케팅 외주 어디가 단가 좋은가', platform: 'none', keywords: '외주플랫폼,비교' },
    { topic: '인스타 공구 1회 진행 후기 (소품 카테고리)', platform: 'meta', keywords: '인스타공구,소품' },
    { topic: '당근마켓 비즈프로필 운영 효과 (오프라인 매장 한정)', platform: 'danggeun', keywords: '당근,비즈프로필' },
    { topic: '디지털 상품(노션 템플릿/PDF) 부업 1년 정산', platform: 'none', keywords: '디지털상품,템플릿' },
    { topic: '직장인 부업 시작할 때 세금 신고 어디서부터?', platform: 'none', keywords: '부업,세금,종합소득' },
  ],

  // ───────────────────────────────────────
  // 툴/리뷰
  // ───────────────────────────────────────
  tool: [
    { topic: '국산 마케팅 대시보드 툴 비교 — 어메이즈 vs 인사이드 vs 다이티', platform: 'none', keywords: '대시보드,한국SaaS' },
    { topic: 'GA4 무료 vs Mixpanel 유료 — 어디까지 무료로 버틸 수 있나', platform: 'google', keywords: 'GA4,Mixpanel' },
    { topic: 'Hotjar vs Microsoft Clarity — 무료 분석 툴 비교', platform: 'none', keywords: 'Hotjar,Clarity,히트맵' },
    { topic: '노션 vs 옵시디언 — 마케터 워크플로우엔 뭐가 맞나', platform: 'none', keywords: '노션,옵시디언' },
    { topic: '캔바 vs 미리캔버스 — 한국 마케터에겐 뭐가 더 유용?', platform: 'none', keywords: '캔바,미리캔버스' },
    { topic: '슬랙 자동화 — 광고 알람을 슬랙으로 받는 법', platform: 'none', keywords: '슬랙,자동화' },
    { topic: '챗GPT 유료 vs Claude 유료 — 마케팅 업무엔 뭐가 나음?', platform: 'none', keywords: 'ChatGPT,Claude' },
    { topic: '한국에서 쓸 만한 인스타 분석 툴 5개 비교', platform: 'meta', keywords: '인스타분석,툴비교' },
  ],

  // ───────────────────────────────────────
  // 질문답변
  // ───────────────────────────────────────
  qna: [
    { topic: 'GA4 이벤트 중복 카운트 원인 아시는 분', platform: 'google', keywords: 'GA4,이벤트,중복' },
    { topic: '네이버 검색광고 갑자기 노출 0 됐어요... 원인이 뭘까요', platform: 'naver', keywords: '네이버,노출0' },
    { topic: '메타 광고 계정 정지 풀어본 분 있나요... 진짜 답답', platform: 'meta', keywords: '계정정지,복구' },
    { topic: '카카오모먼트 픽셀 설치했는데 데이터 안 잡혀요', platform: 'kakao', keywords: '카카오픽셀,트래킹' },
    { topic: '쇼피파이 vs 카페24 vs 식스샵 — 신규 쇼핑몰 추천 좀', platform: 'none', keywords: '쇼핑몰,비교' },
    { topic: '광고 소재 만들 때 폰트 저작권 어디까지 신경써야 함?', platform: 'none', keywords: '폰트,저작권' },
    { topic: '신입인데 KPI 어떻게 잡아야 할지 모르겠어요', platform: 'none', keywords: '신입,KPI' },
  ],

  // ───────────────────────────────────────
  // 구인/협업
  // ───────────────────────────────────────
  job: [
    { topic: '[재택] 퍼포먼스 마케터 프리랜서 구합니다 (월 250)', platform: 'none', keywords: '구인,프리랜서' },
    { topic: '인스타 콘텐츠 디자이너 협업 구함 (스토리 위주)', platform: 'meta', keywords: '협업,콘텐츠' },
    { topic: '네이버 블로그 체험단 모집 대행 가능하신 분', platform: 'naver', keywords: '체험단,블로그' },
    { topic: '소상공인인데 마케팅 컨설팅 가능하신 분 찾습니다', platform: 'none', keywords: '컨설팅,소상공인' },
  ],

  // ───────────────────────────────────────
  // 이벤트
  // ───────────────────────────────────────
  event: [
    { topic: '2026 디지털 마케팅 컨퍼런스 추천 — 가볼 만한 곳', platform: 'none', keywords: '컨퍼런스,2026' },
    { topic: '네이버 광고주 교육 — 무료인데 의외로 알찼던 후기', platform: 'naver', keywords: '교육,네이버' },
    { topic: '카카오 비즈니스 세미나 후기 — 핵심만 정리', platform: 'kakao', keywords: '카카오,세미나' },
  ],
};

// 단일 배열로 평탄화 (DB 시드용)
function flatten() {
  const out = [];
  for (const [boardSlug, list] of Object.entries(SEEDS)) {
    for (const item of list) {
      out.push({
        board_slug: boardSlug,
        topic: item.topic,
        angle: item.angle || null,
        keywords: item.keywords || null,
        platform: item.platform || 'none',
        source: 'manual',
      });
    }
  }
  return out;
}

module.exports = { SEEDS, flatten };

// CLI 데모
if (require.main === module) {
  const all = flatten();
  console.log(`\n📚 초기 글감 시드: ${all.length}개\n`);
  const byBoard = {};
  const byPlatform = {};
  for (const s of all) {
    byBoard[s.board_slug] = (byBoard[s.board_slug] || 0) + 1;
    byPlatform[s.platform] = (byPlatform[s.platform] || 0) + 1;
  }
  console.log('보드별:');
  for (const [k, v] of Object.entries(byBoard).sort()) console.log(`  ${k.padEnd(8)} ${v}`);
  console.log('\n플랫폼별:');
  for (const [k, v] of Object.entries(byPlatform).sort()) console.log(`  ${k.padEnd(12)} ${v}`);
}
