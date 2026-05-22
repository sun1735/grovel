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
    /* 선택 모달 (mtSelect) — 라디오 리스트 */
    .mt-select-list { display:flex; flex-direction:column; gap:6px; margin-bottom:18px; }
    .mt-select-item {
      display:flex; align-items:center; gap:10px;
      padding:11px 14px; border:1.5px solid rgba(0,0,0,0.08);
      background:#fff; border-radius:10px; cursor:pointer;
      font-size:13.5px; font-weight:600; color:#15171c;
      transition: background .12s, border-color .12s;
      text-align:left;
    }
    .mt-select-item:hover { background:#fafbfc; border-color:rgba(0,0,0,0.16); }
    .mt-select-item.selected { background:#fff1f3; border-color:#ff3e5f; color:#ed1f43; }
    .mt-select-item .mt-select-radio {
      width:18px; height:18px; border-radius:999px;
      border:2px solid rgba(0,0,0,0.18); flex-shrink:0; position:relative;
      transition: border-color .12s;
    }
    .mt-select-item.selected .mt-select-radio { border-color:#ff3e5f; }
    .mt-select-item.selected .mt-select-radio::after {
      content:''; position:absolute; inset:3px; border-radius:999px; background:#ff3e5f;
    }
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

    /* 플로팅 글쓰기 버튼 — 모바일 전용, 카카오 FAB 위에 스택 */
    .mt-write-fab {
      position:fixed; right:20px; bottom:92px; z-index:9989;
      width:56px; height:56px; border-radius:999px;
      background:#ff3e5f; color:#fff;
      display:flex; align-items:center; justify-content:center;
      box-shadow: 0 10px 28px -8px rgba(237,31,67,.38), 0 2px 6px rgba(0,0,0,.08);
      transition: transform .15s ease, box-shadow .15s ease;
      text-decoration:none;
    }
    .mt-write-fab:hover { transform: translateY(-2px); }
    .mt-write-fab:active { transform: translateY(0); }
    @media (min-width:641px) { .mt-write-fab { display:none; } }
    @media (max-width:640px) {
      .mt-write-fab { width:52px; height:52px; right:16px; bottom:84px; }
    }

    /* 알림 벨 + 드롭다운 — 헤더 주입용 */
    .mt-notif-dropdown {
      position:absolute; right:0; top:calc(100% + 6px);
      width:340px; max-width:calc(100vw - 32px);
      background:#fff; border:1px solid rgba(0,0,0,0.06);
      border-radius:14px; box-shadow: 0 20px 50px -18px rgba(0,0,0,.22), 0 2px 6px rgba(0,0,0,.06);
      z-index:50; overflow:hidden;
      font-family:'Pretendard Variable', system-ui, sans-serif;
    }
    html.dark .mt-notif-dropdown { background:#181a21; border-color:rgba(255,255,255,0.08); }
    .mt-notif-item { text-decoration:none; color:inherit; display:block; }
    .mt-notif-unread { background:rgba(255,62,95,0.04); position:relative; }
    .mt-notif-unread::before {
      content:''; position:absolute; left:8px; top:50%; transform:translateY(-50%);
      width:6px; height:6px; border-radius:999px; background:#ff3e5f;
    }
    html.dark .mt-notif-unread { background:rgba(255,62,95,0.08); }

    /* 다크 모드 토글 — 왼쪽 하단 */
    .mt-theme-fab {
      position:fixed; left:20px; bottom:24px; z-index:9988;
      width:44px; height:44px; border-radius:999px;
      background:#fff; color:#15171c;
      border:1px solid rgba(0,0,0,0.08);
      display:flex; align-items:center; justify-content:center;
      box-shadow: 0 6px 18px -6px rgba(0,0,0,.18);
      cursor:pointer; transition: transform .15s ease, background .15s ease;
    }
    .mt-theme-fab:hover { transform: translateY(-1px); }
    html.dark .mt-theme-fab { background:#181a21; color:#edeef2; border-color:rgba(255,255,255,0.08); }
    html.dark .mt-theme-fab .icon-sun { display:block; }
    html.dark .mt-theme-fab .icon-moon { display:none; }
    .mt-theme-fab .icon-sun { display:none; }
    .mt-theme-fab .icon-moon { display:block; }
    @media (max-width:640px) {
      .mt-theme-fab { width:40px; height:40px; left:16px; bottom:20px; }
    }

    /* Discord 환영 모달 — ui.js가 자동 주입 */
    .mt-dc-bg {
      position:fixed; inset:0; z-index:9997;
      background:rgba(15,17,28,.55); backdrop-filter:blur(6px);
      display:flex; align-items:center; justify-content:center; padding:16px;
      animation: mt-fade-in .25s ease;
      font-family:'Pretendard Variable', system-ui, sans-serif;
    }
    .mt-dc-bg.out { animation: mt-fade-out .2s ease forwards; }
    .mt-dc-card {
      position:relative; width:100%; max-width:380px;
      background:linear-gradient(160deg,#5865F2 0%,#4752C4 100%);
      color:#fff; border-radius:20px; padding:28px 24px 22px;
      box-shadow:0 30px 80px -20px rgba(20,25,80,.55), 0 4px 12px rgba(0,0,0,.18);
      animation: mt-modal-in .3s cubic-bezier(.16,1,.3,1);
      overflow:hidden;
    }
    .mt-dc-bg.out .mt-dc-card { animation: mt-modal-out .22s ease forwards; }
    .mt-dc-card::before {
      content:''; position:absolute; top:-40px; right:-40px;
      width:160px; height:160px; border-radius:999px;
      background:rgba(255,255,255,.08); pointer-events:none;
    }
    .mt-dc-close {
      position:absolute; top:10px; right:10px; width:32px; height:32px;
      display:flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,.12); border:none; color:#fff;
      border-radius:999px; cursor:pointer; transition:background .15s;
      font-size:18px; line-height:1; font-weight:300;
    }
    .mt-dc-close:hover { background:rgba(255,255,255,.22); }
    .mt-dc-logo {
      width:56px; height:56px; border-radius:16px; background:rgba(255,255,255,.14);
      display:flex; align-items:center; justify-content:center; margin-bottom:14px;
    }
    .mt-dc-title { font-size:20px; font-weight:900; line-height:1.3; letter-spacing:-.01em; }
    .mt-dc-desc { font-size:13.5px; color:rgba(255,255,255,.85); margin-top:8px; line-height:1.55; }
    .mt-dc-perks { margin:16px 0 18px; display:flex; flex-direction:column; gap:8px; }
    .mt-dc-perk { display:flex; align-items:center; gap:9px; font-size:13px; color:rgba(255,255,255,.92); font-weight:600; }
    .mt-dc-perk-dot { width:18px; height:18px; border-radius:999px; background:rgba(255,255,255,.18); display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; font-size:11px; }
    .mt-dc-cta {
      display:flex; align-items:center; justify-content:center; gap:6px;
      width:100%; height:46px; background:#fff; color:#4752C4;
      border-radius:12px; font-weight:800; font-size:14.5px;
      text-decoration:none; transition:transform .12s, box-shadow .15s;
      box-shadow:0 6px 16px -6px rgba(0,0,0,.25);
    }
    .mt-dc-cta:hover { transform:translateY(-1px); box-shadow:0 10px 22px -8px rgba(0,0,0,.32); }
    .mt-dc-skip {
      display:block; width:100%; margin-top:10px; background:none; border:none;
      color:rgba(255,255,255,.6); font-size:12px; font-weight:600; cursor:pointer;
      padding:6px; transition:color .15s;
    }
    .mt-dc-skip:hover { color:rgba(255,255,255,.85); }
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

  // ── 선택 모달 (라디오 리스트) ──
  // options: [{ value, label }] — 선택한 value 반환, 취소 시 null
  window.mtSelect = function(options, { title = '선택', message = '', okText = '확인', cancelText = '취소', defaultValue = null } = {}) {
    return new Promise((resolve) => {
      const bg = document.createElement('div');
      bg.className = 'mt-modal-bg';
      const itemsHtml = options.map((o, i) => `
        <button type="button" class="mt-select-item ${o.value === defaultValue ? 'selected' : ''}" data-i="${i}">
          <span class="mt-select-radio"></span>
          <span>${String(o.label).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span>
        </button>
      `).join('');
      bg.innerHTML = `
        <div class="mt-modal" style="max-width:400px">
          <div class="mt-modal-title">${title}</div>
          ${message ? `<div class="mt-modal-msg">${message}</div>` : ''}
          <div class="mt-select-list">${itemsHtml}</div>
          <div class="mt-modal-btns">
            <button class="mt-modal-btn mt-modal-cancel">${cancelText}</button>
            <button class="mt-modal-btn mt-modal-ok" disabled style="opacity:.4;cursor:not-allowed">${okText}</button>
          </div>
        </div>`;

      let selected = defaultValue;
      const okBtn = bg.querySelector('.mt-modal-ok');
      function refreshOk() {
        if (selected !== null && selected !== undefined) {
          okBtn.disabled = false;
          okBtn.style.opacity = '';
          okBtn.style.cursor = '';
        }
      }
      if (selected !== null) refreshOk();

      bg.querySelectorAll('.mt-select-item').forEach(btn => {
        btn.addEventListener('click', () => {
          bg.querySelectorAll('.mt-select-item').forEach(x => x.classList.remove('selected'));
          btn.classList.add('selected');
          selected = options[parseInt(btn.dataset.i)].value;
          refreshOk();
        });
      });

      const close = (result) => {
        bg.classList.add('out');
        setTimeout(() => { bg.remove(); resolve(result); }, 200);
      };
      bg.querySelector('.mt-modal-cancel').addEventListener('click', () => close(null));
      okBtn.addEventListener('click', () => {
        if (selected === null || selected === undefined) return;
        close(selected);
      });
      bg.addEventListener('click', (e) => { if (e.target === bg) close(null); });

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

  // ── 알림 벨 (헤더 placeholder 기반) ──
  // 각 페이지의 <button id="mt-notif-bell">에 바인딩. 미로그인 시 숨김.
  (function initNotifBell() {
    const bell = document.getElementById('mt-notif-bell');
    if (!bell) return;

    const dot   = bell.querySelector('.mt-notif-dot');
    const badge = bell.querySelector('.mt-notif-badge');

    function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function timeAgo(iso) {
      const d = (Date.now() - new Date(iso).getTime()) / 1000;
      if (d < 60) return '방금';
      if (d < 3600) return Math.floor(d/60) + '분 전';
      if (d < 86400) return Math.floor(d/3600) + '시간 전';
      if (d < 86400*7) return Math.floor(d/86400) + '일 전';
      return new Date(iso).toLocaleDateString('ko-KR');
    }

    async function updateUnreadCount() {
      try {
        const r = await fetch('/api/notifications/unread-count', { credentials: 'same-origin' });
        if (!r.ok) return;
        const { count } = await r.json();
        if (count > 0) {
          if (badge) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); }
          if (dot && !badge) dot.classList.remove('hidden');
        } else {
          if (badge) badge.classList.add('hidden');
          if (dot) dot.classList.add('hidden');
        }
      } catch {}
    }

    // 로그인 상태 체크 — 미로그인이면 bell 숨김
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(({ user }) => {
        if (!user) { bell.style.display = 'none'; return; }
        bell.style.display = '';
        updateUnreadCount();
        setInterval(updateUnreadCount, 30000);
      })
      .catch(() => {});

    let dropdown = null;
    function closeDropdown() {
      if (dropdown) { dropdown.remove(); dropdown = null; }
      document.removeEventListener('click', onDocClick);
    }
    function onDocClick(e) {
      if (dropdown && !dropdown.contains(e.target) && !bell.contains(e.target)) closeDropdown();
    }

    function render(notifs) {
      if (!dropdown) return;
      if (!notifs || notifs.length === 0) {
        dropdown.innerHTML = '<div class="p-8 text-center text-sm text-black/40">아직 알림이 없어요</div>';
        return;
      }
      dropdown.innerHTML = `
        <div class="flex items-center justify-between px-4 py-2.5 border-b border-black/5">
          <span class="text-[12.5px] font-bold">알림</span>
          <button id="mt-notif-readall" class="text-[11px] text-brand-500 font-semibold hover:text-brand-600">모두 읽음</button>
        </div>
        <div class="max-h-[420px] overflow-y-auto">
          ${notifs.map(n => {
            const href = n.post_id
              ? `/post.html?id=${n.post_id}${n.comment_id ? '#c' + n.comment_id : ''}`
              : '#';
            return `
              <a href="${href}" data-id="${n.id}"
                 class="mt-notif-item px-4 py-3 border-b border-black/5 hover:bg-paper ${!n.is_read ? 'mt-notif-unread pl-6' : ''}">
                <div class="text-[13px] leading-snug">${escHtml(n.message)}</div>
                <div class="text-[10.5px] text-black/40 mt-1">${timeAgo(n.created_at)}</div>
              </a>`;
          }).join('')}
        </div>
      `;
      dropdown.querySelectorAll('.mt-notif-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.id;
          if (id) fetch(`/api/notifications/${id}/read`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        });
      });
      dropdown.querySelector('#mt-notif-readall')?.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'same-origin' });
          dropdown.querySelectorAll('.mt-notif-unread').forEach(el => {
            el.classList.remove('mt-notif-unread', 'pl-6');
          });
          updateUnreadCount();
        } catch {}
      });
    }

    bell.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (dropdown) { closeDropdown(); return; }
      // bell은 position:relative 필요 — 페이지 마크업에서 relative 클래스 부여
      dropdown = document.createElement('div');
      dropdown.className = 'mt-notif-dropdown';
      dropdown.innerHTML = '<div class="p-6 text-center text-sm text-black/40">불러오는 중…</div>';
      bell.appendChild(dropdown);
      setTimeout(() => document.addEventListener('click', onDocClick), 0);
      try {
        const r = await fetch('/api/notifications?limit=15', { credentials: 'same-origin' });
        const { notifications } = await r.json();
        render(notifications);
      } catch {
        if (dropdown) dropdown.innerHTML = '<div class="p-6 text-center text-sm text-rose-500">불러오기 실패</div>';
      }
    });
  })();

  // ── 다크 모드 토글 FAB ──
  // preload script가 <head>에서 이미 class를 적용하므로 FOUC 없음.
  // data-no-theme-fab 있으면 숨김.
  if (!document.documentElement.hasAttribute('data-no-theme-fab') &&
      !document.body.hasAttribute('data-no-theme-fab')) {
    const themeFab = document.createElement('button');
    themeFab.type = 'button';
    themeFab.className = 'mt-theme-fab';
    themeFab.setAttribute('aria-label', '테마 전환');
    themeFab.innerHTML = `
      <svg class="icon-moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
      <svg class="icon-sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
    `;
    themeFab.addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('mt-theme', isDark ? 'dark' : 'light'); } catch {}
    });
    document.body.appendChild(themeFab);
  }

  // ── 플로팅 글쓰기 버튼 (모바일 전용) ──
  // data-no-write-fab 있으면 비활성. 글쓰기 페이지 자체에선 자동 숨김.
  const isComposePage = /\/compose\.html$/.test(location.pathname);
  if (!isComposePage &&
      !document.documentElement.hasAttribute('data-no-write-fab') &&
      !document.body.hasAttribute('data-no-write-fab')) {
    const writeFab = document.createElement('a');
    writeFab.className = 'mt-write-fab';
    writeFab.href = '/compose.html';
    writeFab.setAttribute('aria-label', '글쓰기');
    writeFab.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>
    `;
    document.body.appendChild(writeFab);
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

  // ── Discord 초대 모달 ──
  // 환경설정:
  //   <html data-no-discord-modal> / <body data-no-discord-modal> → 비활성
  //   자동 노출: 첫 방문 시 ~15초 후, 또는 글 작성 직후 post.html 진입 시 즉시
  //   localStorage: mt-dc-modal = 'shown' (영구), 'never' (다시 보지 않기)
  //                 mt-dc-post-prompt = 글 작성 직후 1회 표시 트리거
  //   수동: window.mtDiscordModal({ trigger: 'post-create' | 'manual' })
  const DC_URL = 'https://discord.gg/YxFrtS7q';
  const DC_KEY = 'mt-dc-modal';
  const DC_POST_KEY = 'mt-dc-post-prompt';
  const DC_AUTO_DELAY = 15000; // 15s

  function dcGet() {
    try { return localStorage.getItem(DC_KEY); } catch { return null; }
  }
  function dcSet(v) {
    try { localStorage.setItem(DC_KEY, v); } catch {}
  }

  function dcRender({ trigger = 'auto' } = {}) {
    if (document.querySelector('.mt-dc-bg')) return; // 중복 방지

    const variants = {
      auto: {
        title: '실시간 마케터들이 모여있어요',
        desc: '마케톡 회원이라면 누구나 무료로 입장 가능한 디스코드 커뮤니티.',
        perks: [
          ['🔔', '새 글 알림을 가장 빨리'],
          ['💬', '실시간 마케터 수다방'],
          ['🤝', '광고주/제휴 매칭 채널'],
        ],
        cta: '디스코드 입장하기',
      },
      'post-create': {
        title: '글 올렸어요. 답글 알림 받을래요?',
        desc: '내 글에 누가 답글을 달았는지 디스코드로 가장 먼저 받아보세요.',
        perks: [
          ['🔔', '답글 실시간 알림 (3초 이내)'],
          ['👥', '같은 주제 마케터와 토론'],
          ['🎁', '디스코드 전용 자료/이벤트'],
        ],
        cta: '디스코드에서 알림 받기',
      },
      manual: {
        title: '디스코드에서 같이 떠들어요',
        desc: '마케톡 디스코드는 무료 입장이에요. 1초만에 합류!',
        perks: [
          ['💬', '실시간 마케터 채팅'],
          ['🔔', '새 글/뉴스 즉시 알림'],
          ['🤝', '협업·구인 매칭 채널'],
        ],
        cta: '디스코드 입장하기',
      },
    };
    const v = variants[trigger] || variants.auto;

    const bg = document.createElement('div');
    bg.className = 'mt-dc-bg';
    bg.innerHTML = `
      <div class="mt-dc-card" role="dialog" aria-modal="true" aria-label="디스코드 초대">
        <button class="mt-dc-close" aria-label="닫기">×</button>
        <div class="mt-dc-logo">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
            <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
        </div>
        <div class="mt-dc-title">${v.title}</div>
        <div class="mt-dc-desc">${v.desc}</div>
        <div class="mt-dc-perks">
          ${v.perks.map(([icon, txt]) => `
            <div class="mt-dc-perk">
              <span class="mt-dc-perk-dot">${icon}</span>
              <span>${txt}</span>
            </div>`).join('')}
        </div>
        <a href="${DC_URL}" target="_blank" rel="noopener" class="mt-dc-cta">
          ${v.cta}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </a>
        <button class="mt-dc-skip" type="button">다시 보지 않기</button>
      </div>
    `;

    const close = (opt = {}) => {
      bg.classList.add('out');
      setTimeout(() => bg.remove(), 220);
      if (opt.never) dcSet('never');
      else dcSet('shown');
    };

    bg.querySelector('.mt-dc-close').addEventListener('click', () => close());
    bg.querySelector('.mt-dc-skip').addEventListener('click', () => close({ never: true }));
    bg.querySelector('.mt-dc-cta').addEventListener('click', () => {
      // 클릭 후 영구 차단 (이미 가입한 것으로 간주)
      dcSet('never');
      // 페이지는 새 탭이라 모달은 일단 닫음
      setTimeout(() => { bg.classList.add('out'); setTimeout(() => bg.remove(), 220); }, 50);
    });
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });

    document.body.appendChild(bg);
  }

  window.mtDiscordModal = dcRender;

  // 글 작성 직후 트리거 — compose.html에서 제출 성공 시 호출:
  //   localStorage.setItem('mt-dc-post-prompt', '1'); location.href = '/post.html?id=...';
  window.mtDiscordOnPostCreated = function() {
    try { localStorage.setItem(DC_POST_KEY, '1'); } catch {}
  };

  // 자동 노출 로직
  if (!document.documentElement.hasAttribute('data-no-discord-modal') &&
      !document.body.hasAttribute('data-no-discord-modal')) {

    // 1) post.html 진입 + 글 작성 직후 트리거 → 즉시 노출 (한 번)
    let pendingPost = null;
    try { pendingPost = localStorage.getItem(DC_POST_KEY); } catch {}
    if (pendingPost === '1') {
      try { localStorage.removeItem(DC_POST_KEY); } catch {}
      // 'never'여도 글쓰기 직후엔 노출 (가장 강력한 유입 동선)
      setTimeout(() => dcRender({ trigger: 'post-create' }), 800);
    } else if (dcGet() !== 'shown' && dcGet() !== 'never') {
      // 2) 일반 첫 방문 — 15초 후 1회
      setTimeout(() => {
        if (document.visibilityState === 'visible' && !document.querySelector('.mt-dc-bg')) {
          dcRender({ trigger: 'auto' });
        }
      }, DC_AUTO_DELAY);
    }
  }
})();
