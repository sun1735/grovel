/**
 * 마케톡 — 커스텀 토스트 알림 + 확인 모달
 * 모든 페이지에서 <script src="/ui.js"></script>로 로드
 */

(function() {
  // ── CSS 주입 ──
  const style = document.createElement('style');
  style.textContent = `
    /* 토스트 */
    .mt-toast-wrap { position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
    .mt-toast {
      pointer-events:auto;
      min-width:280px; max-width:480px; padding:14px 20px; border-radius:12px;
      font-size:14px; font-weight:600; line-height:1.5;
      box-shadow: 0 8px 30px -10px rgba(0,0,0,.2);
      display:flex; align-items:center; gap:10px;
      animation: mt-toast-in .3s ease;
      font-family: 'Pretendard Variable', system-ui, sans-serif;
    }
    .mt-toast.out { animation: mt-toast-out .25s ease forwards; }
    .mt-toast-success { background:#15171c; color:#fff; }
    .mt-toast-error { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
    .mt-toast-info { background:#fff; color:#15171c; border:1px solid #eaecef; }
    .mt-toast-warn { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
    @keyframes mt-toast-in { from { opacity:0; transform:translateY(-12px); } to { opacity:1; transform:translateY(0); } }
    @keyframes mt-toast-out { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(-12px); } }

    /* 확인 모달 */
    .mt-modal-bg {
      position:fixed; inset:0; z-index:9998;
      background:rgba(0,0,0,.4); backdrop-filter:blur(4px);
      display:flex; align-items:center; justify-content:center;
      animation: mt-fade-in .2s ease;
      font-family: 'Pretendard Variable', system-ui, sans-serif;
    }
    .mt-modal-bg.out { animation: mt-fade-out .2s ease forwards; }
    .mt-modal {
      background:#fff; border-radius:16px; padding:28px 24px 20px;
      width:90%; max-width:380px; box-shadow:0 20px 60px -20px rgba(0,0,0,.25);
      animation: mt-modal-in .25s ease;
    }
    .mt-modal-bg.out .mt-modal { animation: mt-modal-out .2s ease forwards; }
    .mt-modal-title { font-size:17px; font-weight:800; color:#15171c; margin-bottom:8px; }
    .mt-modal-msg { font-size:14px; color:#555; line-height:1.6; margin-bottom:20px; }
    .mt-modal-btns { display:flex; gap:8px; justify-content:flex-end; }
    .mt-modal-btn {
      padding:10px 20px; border-radius:10px; font-size:14px; font-weight:700;
      cursor:pointer; border:none; transition:all .15s;
    }
    .mt-modal-cancel { background:#f4f5f7; color:#555; }
    .mt-modal-cancel:hover { background:#eaecef; }
    .mt-modal-ok { background:#15171c; color:#fff; }
    .mt-modal-ok:hover { background:#333; }
    .mt-modal-danger { background:#ff3e5f; color:#fff; }
    .mt-modal-danger:hover { background:#ed1f43; }
    @keyframes mt-fade-in { from { opacity:0; } to { opacity:1; } }
    @keyframes mt-fade-out { from { opacity:1; } to { opacity:0; } }
    @keyframes mt-modal-in { from { opacity:0; transform:scale(.95); } to { opacity:1; transform:scale(1); } }
    @keyframes mt-modal-out { from { opacity:1; transform:scale(1); } to { opacity:0; transform:scale(.95); } }

    /* 플로팅 카카오톡 문의 버튼 */
    .mt-kakao-fab {
      position:fixed; right:20px; bottom:24px; z-index:9990;
      width:56px; height:56px; border-radius:999px;
      background:#FEE500; color:#191919;
      display:flex; align-items:center; justify-content:center;
      box-shadow: 0 10px 28px -8px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.08);
      transition: transform .15s ease, box-shadow .15s ease;
      text-decoration:none;
    }
    .mt-kakao-fab:hover { transform: translateY(-2px); box-shadow: 0 14px 32px -8px rgba(0,0,0,.32), 0 2px 6px rgba(0,0,0,.1); }
    .mt-kakao-fab:active { transform: translateY(0); }
    .mt-kakao-fab .mt-kakao-tip {
      position:absolute; right:calc(100% + 10px); top:50%; transform:translateY(-50%);
      background:#15171c; color:#fff; font-size:12px; font-weight:600;
      padding:7px 11px; border-radius:8px; white-space:nowrap;
      opacity:0; pointer-events:none; transition: opacity .15s ease;
      font-family:'Pretendard Variable', system-ui, sans-serif;
    }
    .mt-kakao-fab .mt-kakao-tip::after {
      content:''; position:absolute; left:100%; top:50%; transform:translateY(-50%);
      border:5px solid transparent; border-left-color:#15171c;
    }
    .mt-kakao-fab:hover .mt-kakao-tip { opacity:1; }
    @media (max-width:640px) {
      .mt-kakao-fab { width:52px; height:52px; right:16px; bottom:20px; }
      .mt-kakao-fab .mt-kakao-tip { display:none; }
    }

    /* 읽은 글 표시 — 방문 이력 기반으로 제목 흐리게 */
    a.mt-read { color: rgba(0,0,0,0.42); }
    a.mt-read:hover { color: rgba(0,0,0,0.62); }
  `;
  document.head.appendChild(style);

  // ── 토스트 컨테이너 ──
  const wrap = document.createElement('div');
  wrap.className = 'mt-toast-wrap';
  document.body.appendChild(wrap);

  // ── 토스트 함수 ──
  const ICONS = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warn: '⚠',
  };

  window.mtToast = function(msg, type = 'success', duration = 3000) {
    const el = document.createElement('div');
    el.className = `mt-toast mt-toast-${type}`;
    el.innerHTML = `<span>${ICONS[type] || ''}</span><span>${msg}</span>`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 250);
    }, duration);
  };

  // ── 확인 모달 함수 ──
  window.mtConfirm = function(msg, { title = '확인', okText = '확인', cancelText = '취소', danger = false } = {}) {
    return new Promise((resolve) => {
      const bg = document.createElement('div');
      bg.className = 'mt-modal-bg';
      bg.innerHTML = `
        <div class="mt-modal">
          <div class="mt-modal-title">${title}</div>
          <div class="mt-modal-msg">${msg}</div>
          <div class="mt-modal-btns">
            <button class="mt-modal-btn mt-modal-cancel">${cancelText}</button>
            <button class="mt-modal-btn ${danger ? 'mt-modal-danger' : 'mt-modal-ok'}">${okText}</button>
          </div>
        </div>`;

      const close = (result) => {
        bg.classList.add('out');
        setTimeout(() => { bg.remove(); resolve(result); }, 200);
      };

      bg.querySelector('.mt-modal-cancel').addEventListener('click', () => close(false));
      bg.querySelector('.mt-modal-ok, .mt-modal-danger').addEventListener('click', () => close(true));
      bg.addEventListener('click', (e) => { if (e.target === bg) close(false); });

      document.body.appendChild(bg);
    });
  };

  // ── 기본 alert 오버라이드 ──
  const origAlert = window.alert;
  window.alert = function(msg) {
    mtToast(msg, 'info', 3500);
  };

  // ── 플로팅 카카오톡 문의 버튼 ──
  // data-no-kakao-fab 속성이 <body> 또는 <html>에 있으면 렌더하지 않음
  if (!document.documentElement.hasAttribute('data-no-kakao-fab') &&
      !document.body.hasAttribute('data-no-kakao-fab')) {
    const fab = document.createElement('a');
    fab.className = 'mt-kakao-fab';
    fab.href = 'https://pf.kakao.com/_Yxnwxfn/chat';
    fab.target = '_blank';
    fab.rel = 'noopener';
    fab.setAttribute('aria-label', '카카오톡으로 문의');
    fab.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path fill="#191919" d="M12 3C6.48 3 2 6.58 2 11c0 2.86 1.88 5.36 4.69 6.77-.2.72-.73 2.66-.84 3.08-.13.52.19.51.4.37.17-.11 2.66-1.82 3.73-2.56.67.1 1.35.15 2.02.15 5.52 0 10-3.58 10-8C22 6.58 17.52 3 12 3Z"/>
      </svg>
      <span class="mt-kakao-tip">카카오톡으로 문의</span>
    `;
    document.body.appendChild(fab);
  }

  // ── 읽은 글 표시 (localStorage + MutationObserver) ──
  // 게시글 링크 <a href="/post.html?id=N">에 mt-read 클래스 부여 → 제목 흐리게.
  // 현재 페이지가 /post.html이면 해당 id를 읽음 처리.
  const READ_KEY = 'mt_read_posts';
  const READ_MAX = 2000;

  function getReadSet() {
    try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function markPostRead(id) {
    if (!id) return;
    const s = getReadSet();
    s.delete(id); s.add(id); // LRU 유지
    let arr = [...s];
    if (arr.length > READ_MAX) arr = arr.slice(-READ_MAX);
    try { localStorage.setItem(READ_KEY, JSON.stringify(arr)); } catch {}
  }
  function applyReadStyles() {
    const read = getReadSet();
    if (read.size === 0) return;
    const links = document.querySelectorAll('a[href*="/post.html?id="]');
    for (const a of links) {
      if (a.classList.contains('mt-read')) continue;
      const m = a.getAttribute('href').match(/[?&]id=(\d+)/);
      if (m && read.has(m[1])) a.classList.add('mt-read');
    }
  }
  window.mtMarkPostRead = markPostRead;

  // 현재 페이지가 글 상세면 id 기록
  if (/\/post\.html$/.test(location.pathname)) {
    const m = location.search.match(/[?&]id=(\d+)/);
    if (m) markPostRead(m[1]);
  }

  // 초기 + 동적 렌더 감지 (fetch 후 innerHTML 주입 대응)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyReadStyles);
  } else {
    applyReadStyles();
  }
  let readScanTimer;
  const readObserver = new MutationObserver(() => {
    clearTimeout(readScanTimer);
    readScanTimer = setTimeout(applyReadStyles, 120);
  });
  readObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
