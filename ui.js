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
})();
