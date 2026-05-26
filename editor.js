/* ────────────────────────────────────────────────────────────────
 * MTEditor — 마케톡 공용 리치 텍스트 에디터 (contenteditable + execCommand)
 *
 * 의존성 없음(브라우저 네이티브). DOMPurify가 로드돼 있으면 붙여넣기/내보내기
 * 시점에 sanitize한다. 서버(api/posts.js)도 sanitize-html로 동일 화이트리스트를
 * 한 번 더 적용하므로, 클라이언트 sanitize는 UX/방어 심층화 용도.
 *
 * 사용:
 *   const ed = MTEditor.create({ mount: el, initialHTML, placeholder });
 *   ed.getHTML();  ed.setHTML(html);  ed.focus();  ed.isEmpty();
 *
 * 본문 렌더링(.rich)과 에디터 편집영역은 같은 스타일을 공유한다.
 * ──────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── 화이트리스트 (클라이언트 DOMPurify용 — 서버 sanitize-html과 동일 정책) ──
  var PURIFY_CONFIG = {
    ALLOWED_TAGS: [
      'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
      'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4',
      'code', 'pre', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'font',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'style', 'colspan', 'rowspan', 'color', 'face', 'align'],
    // http(s)/mailto + 루트 상대경로(/...) + 앵커(#)만 허용 (javascript: 등 차단)
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[/#])/i,
  };

  // 업로드 이미지 경로만 src로 허용 (외부 추적/믹스드콘텐츠 방지)
  var IMG_SRC_OK = /^\/api\/posts\/images\/\d+/;

  function ensureDOMPurifyHook() {
    if (!window.DOMPurify || window.__mteHookAdded) return;
    window.__mteHookAdded = true;
    window.DOMPurify.addHook('afterSanitizeAttributes', function (node) {
      if (node.tagName === 'IMG') {
        var src = node.getAttribute('src') || '';
        if (!IMG_SRC_OK.test(src)) node.removeAttribute('src');
      }
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener nofollow ugc');
      }
    });
  }

  function sanitize(html) {
    if (window.DOMPurify) {
      ensureDOMPurifyHook();
      return window.DOMPurify.sanitize(html || '', PURIFY_CONFIG);
    }
    return html || ''; // DOMPurify 없으면 서버 sanitize에 의존
  }

  function stripHtml(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/ /g, ' ');
  }

  function escapeText(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── 스타일 1회 주입 ──
  function injectStyles() {
    if (document.getElementById('mte-styles')) return;
    var css = `
.rich{line-height:1.7;font-size:15px;color:#15171c;word-break:break-word}
.rich p{margin:0 0 .6em}
.rich h1{font-size:1.6em;font-weight:800;margin:.6em 0 .3em;line-height:1.3}
.rich h2{font-size:1.35em;font-weight:800;margin:.6em 0 .3em;line-height:1.3}
.rich h3{font-size:1.15em;font-weight:700;margin:.5em 0 .3em}
.rich h4{font-size:1em;font-weight:700;margin:.5em 0 .2em}
.rich ul{list-style:disc;padding-left:1.4em;margin:.4em 0}
.rich ol{list-style:decimal;padding-left:1.4em;margin:.4em 0}
.rich li{margin:.15em 0}
.rich blockquote{border-left:4px solid rgba(255,62,95,.4);padding:.3em .9em;margin:.6em 0;color:rgba(0,0,0,.7);background:rgba(0,0,0,.02);border-radius:0 6px 6px 0}
.rich a{color:#ff3e5f;text-decoration:underline;word-break:break-all}
.rich code{background:#f1f2f4;border-radius:5px;padding:.1em .4em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}
.rich pre{background:#f1f2f4;border-radius:8px;padding:.8em 1em;overflow:auto;margin:.6em 0;white-space:pre-wrap}
.rich pre code{background:none;padding:0}
.rich img{max-width:100%;height:auto;border-radius:8px;margin:.4em 0}
.rich table{border-collapse:collapse;margin:.6em 0;max-width:100%}
.rich td,.rich th{border:1px solid rgba(0,0,0,.18);padding:.4em .6em;min-width:2.5em}
.rich th{background:rgba(0,0,0,.04);font-weight:700}
.rich hr{border:none;border-top:1px solid rgba(0,0,0,.12);margin:1em 0}
.mte-wrap{border:1px solid rgba(0,0,0,.12);border-radius:12px;background:#fff;overflow:hidden}
.mte-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:6px;border-bottom:1px solid rgba(0,0,0,.08);background:#fafafa;position:sticky;top:0;z-index:5}
.mte-btn{height:30px;min-width:30px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;color:#4b5563;cursor:pointer;border:none;background:none}
.mte-btn:hover{background:#fff;color:#111;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.mte-btn.active{background:#ffe3e9;color:#ff3e5f}
.mte-sep{width:1px;height:20px;background:rgba(0,0,0,.12);margin:0 3px}
.mte-sel{height:30px;border:1px solid rgba(0,0,0,.12);border-radius:7px;font-size:12px;padding:0 4px;background:#fff;color:#333;cursor:pointer}
.mte-color{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:7px;color:#4b5563;cursor:pointer}
.mte-color:hover{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.mte-color input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.mte-color .bar{position:absolute;bottom:4px;left:6px;right:6px;height:3px;border-radius:2px}
.mte-edit{min-height:300px;max-height:60vh;padding:14px 16px;outline:none;overflow-y:auto}
.mte-edit:empty:before{content:attr(data-placeholder);color:rgba(0,0,0,.35);pointer-events:none}
`;
    var s = document.createElement('style');
    s.id = 'mte-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ── 툴바 정의 ──
  var FONTS = [
    ['', '글꼴'],
    ['Pretendard, system-ui, sans-serif', '프리텐다드'],
    ["'Noto Sans KR', sans-serif", '본고딕'],
    ["'Malgun Gothic', sans-serif", '맑은 고딕'],
    ["'Nanum Gothic', sans-serif", '나눔고딕'],
    ['Georgia, serif', '세리프'],
    ['ui-monospace, monospace', '고정폭'],
  ];
  // execCommand fontSize(1-7) → styleWithCSS 시 키워드 크기로 렌더
  var SIZES = [
    ['', '크기'],
    ['1', '아주 작게'],
    ['2', '작게'],
    ['3', '보통'],
    ['5', '크게'],
    ['6', '더 크게'],
    ['7', '아주 크게'],
  ];
  var ic = function (name) { return '<i data-lucide="' + name + '" style="width:16px;height:16px"></i>'; };

  function create(opts) {
    opts = opts || {};
    injectStyles();
    var mount = opts.mount;
    var uploadUrl = opts.uploadUrl || '/api/posts/upload-image';

    var wrap = document.createElement('div');
    wrap.className = 'mte-wrap';
    wrap.innerHTML =
      '<div class="mte-toolbar">' +
        '<select class="mte-sel" data-role="fontName" title="글꼴">' +
          FONTS.map(function (f) { return '<option value="' + f[0] + '">' + f[1] + '</option>'; }).join('') +
        '</select>' +
        '<select class="mte-sel" data-role="fontSize" title="크기">' +
          SIZES.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === '3' ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') +
        '</select>' +
        '<span class="mte-sep"></span>' +
        '<button type="button" class="mte-btn" data-cmd="bold" title="굵게 (Ctrl+B)">' + ic('bold') + '</button>' +
        '<button type="button" class="mte-btn" data-cmd="italic" title="기울임 (Ctrl+I)">' + ic('italic') + '</button>' +
        '<button type="button" class="mte-btn" data-cmd="underline" title="밑줄 (Ctrl+U)">' + ic('underline') + '</button>' +
        '<button type="button" class="mte-btn" data-cmd="strikeThrough" title="취소선">' + ic('strikethrough') + '</button>' +
        '<span class="mte-color" data-role="foreColor" title="글자색">' + ic('baseline') + '<span class="bar" style="background:#ff3e5f"></span><input type="color" value="#ff3e5f"></span>' +
        '<span class="mte-color" data-role="hiliteColor" title="형광펜">' + ic('highlighter') + '<span class="bar" style="background:#ffe600"></span><input type="color" value="#ffe600"></span>' +
        '<span class="mte-sep"></span>' +
        '<button type="button" class="mte-btn" data-cmd="justifyLeft" title="왼쪽 정렬">' + ic('align-left') + '</button>' +
        '<button type="button" class="mte-btn" data-cmd="justifyCenter" title="가운데 정렬">' + ic('align-center') + '</button>' +
        '<button type="button" class="mte-btn" data-cmd="justifyRight" title="오른쪽 정렬">' + ic('align-right') + '</button>' +
        '<button type="button" class="mte-btn" data-cmd="justifyFull" title="양쪽 정렬">' + ic('align-justify') + '</button>' +
        '<span class="mte-sep"></span>' +
        '<button type="button" class="mte-btn" data-cmd="insertUnorderedList" title="글머리 기호 목록">' + ic('list') + '</button>' +
        '<button type="button" class="mte-btn" data-cmd="insertOrderedList" title="번호 목록">' + ic('list-ordered') + '</button>' +
        '<button type="button" class="mte-btn" data-act="quote" title="인용">' + ic('quote') + '</button>' +
        '<button type="button" class="mte-btn" data-act="code" title="코드">' + ic('code') + '</button>' +
        '<span class="mte-sep"></span>' +
        '<button type="button" class="mte-btn" data-act="link" title="링크 (Ctrl+K)">' + ic('link') + '</button>' +
        '<button type="button" class="mte-btn" data-act="image" title="이미지 삽입">' + ic('image') + '</button>' +
        '<button type="button" class="mte-btn" data-act="table" title="표 삽입">' + ic('table') + '</button>' +
        '<span class="mte-sep"></span>' +
        '<button type="button" class="mte-btn" data-cmd="removeFormat" title="서식 지우기">' + ic('eraser') + '</button>' +
        '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none" data-role="imgfile">' +
      '</div>' +
      '<div class="mte-edit rich" contenteditable="true" data-placeholder="' + (opts.placeholder || '내용을 입력하세요…') + '"></div>';

    mount.appendChild(wrap);

    var editable = wrap.querySelector('.mte-edit');
    var toolbar = wrap.querySelector('.mte-toolbar');
    var imgFile = wrap.querySelector('[data-role="imgfile"]');
    if (opts.initialHTML) editable.innerHTML = sanitize(opts.initialHTML);

    // ── 선택영역 저장/복원 (select·color input 클릭 시 selection 유실 방지) ──
    var savedRange = null;
    function inEditable(node) {
      while (node) { if (node === editable) return true; node = node.parentNode; }
      return false;
    }
    function saveSel() {
      var sel = window.getSelection();
      if (sel && sel.rangeCount && inEditable(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
    }
    function restoreSel() {
      editable.focus();
      if (!savedRange) return;
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    document.addEventListener('selectionchange', function () {
      var sel = window.getSelection();
      if (sel && sel.rangeCount && inEditable(sel.anchorNode)) { saveSel(); syncActive(); }
    });
    editable.addEventListener('keyup', saveSel);
    editable.addEventListener('mouseup', saveSel);

    function exec(cmd, val) {
      restoreSel();
      try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
      document.execCommand(cmd, false, val);
      saveSel();
    }
    function insertHTML(html) {
      restoreSel();
      document.execCommand('insertHTML', false, html);
      saveSel();
    }

    function syncActive() {
      try {
        toolbar.querySelectorAll('.mte-btn[data-cmd]').forEach(function (b) {
          var c = b.getAttribute('data-cmd');
          if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList',
               'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'].indexOf(c) >= 0) {
            b.classList.toggle('active', document.queryCommandState(c));
          }
        });
      } catch (e) {}
    }

    // ── 동작들 ──
    function doQuote() {
      // 토글 비슷하게: 이미 blockquote 안이면 p로
      exec('formatBlock', 'blockquote');
    }
    function doCode() {
      restoreSel();
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var text = sel.toString();
      if (text) insertHTML('<code>' + escapeText(text) + '</code>&nbsp;');
      else insertHTML('<code>코드</code>&nbsp;');
    }
    function doLink() {
      restoreSel();
      var sel = window.getSelection();
      var has = sel && sel.toString().length > 0;
      var url = window.prompt('링크 주소를 입력하세요', 'https://');
      if (!url) return;
      url = url.trim();
      if (!/^(https?:\/\/|mailto:|\/|#)/i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
      if (has) { exec('createLink', url); }
      else { insertHTML('<a href="' + escapeText(url) + '">' + escapeText(url) + '</a>&nbsp;'); }
    }
    function doTable() {
      var r = parseInt(window.prompt('표 행(row) 수', '2'), 10);
      var c = parseInt(window.prompt('표 열(column) 수', '2'), 10);
      if (!r || !c || r < 1 || c < 1 || r > 20 || c > 10) return;
      var html = '<table><tbody>';
      for (var i = 0; i < r; i++) {
        html += '<tr>';
        for (var j = 0; j < c; j++) html += '<td><br></td>';
        html += '</tr>';
      }
      html += '</tbody></table><p><br></p>';
      insertHTML(html);
    }
    function doImage() { restoreSel(); imgFile.value = ''; imgFile.click(); }

    imgFile.addEventListener('change', function () {
      var f = imgFile.files && imgFile.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { alert('이미지는 5MB 이하만 가능합니다.'); return; }
      var fd = new FormData();
      fd.append('image', f);
      insertHTML('<span data-uploading>이미지 업로드 중…</span>');
      fetch(uploadUrl, { method: 'POST', credentials: 'same-origin', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var ph = editable.querySelector('[data-uploading]');
          if (!j || !j.url) { if (ph) ph.outerHTML = ''; alert('업로드 실패'); return; }
          if (ph) ph.outerHTML = '<img src="' + j.url + '" alt=""><p><br></p>';
          else insertHTML('<img src="' + j.url + '" alt=""><p><br></p>');
        })
        .catch(function () {
          var ph = editable.querySelector('[data-uploading]');
          if (ph) ph.outerHTML = '';
          alert('업로드 중 오류가 발생했습니다.');
        });
    });

    // ── 클릭 라우팅 ──
    // 버튼은 mousedown에서 preventDefault → 편집영역 selection 유지
    toolbar.addEventListener('mousedown', function (e) {
      if (e.target.closest('.mte-btn')) e.preventDefault();
    });
    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('.mte-btn');
      if (!btn) return;
      var cmd = btn.getAttribute('data-cmd');
      var act = btn.getAttribute('data-act');
      if (cmd) { exec(cmd); syncActive(); return; }
      if (act === 'quote') doQuote();
      else if (act === 'code') doCode();
      else if (act === 'link') doLink();
      else if (act === 'image') doImage();
      else if (act === 'table') doTable();
    });

    // 글꼴 / 크기 select
    toolbar.querySelector('[data-role="fontName"]').addEventListener('change', function (e) {
      if (e.target.value) exec('fontName', e.target.value);
      e.target.selectedIndex = 0;
    });
    toolbar.querySelector('[data-role="fontSize"]').addEventListener('change', function (e) {
      if (e.target.value) exec('fontSize', e.target.value);
    });

    // 색상
    function bindColor(role, cmds) {
      var box = toolbar.querySelector('[data-role="' + role + '"]');
      var input = box.querySelector('input');
      var bar = box.querySelector('.bar');
      input.addEventListener('input', function () { bar.style.background = input.value; });
      input.addEventListener('change', function () {
        bar.style.background = input.value;
        for (var i = 0; i < cmds.length; i++) {
          try { restoreSel(); document.execCommand('styleWithCSS', false, true);
            if (document.execCommand(cmds[i], false, input.value)) break; } catch (e) {}
        }
        saveSel();
      });
    }
    bindColor('foreColor', ['foreColor']);
    bindColor('hiliteColor', ['hiliteColor', 'backColor']);

    // 단축키
    editable.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); exec('bold'); syncActive(); }
      else if (k === 'i') { e.preventDefault(); exec('italic'); syncActive(); }
      else if (k === 'u') { e.preventDefault(); exec('underline'); syncActive(); }
      else if (k === 'k') { e.preventDefault(); doLink(); }
    });

    // 붙여넣기 — sanitize 후 삽입 (지저분한 외부 서식·스크립트 제거)
    editable.addEventListener('paste', function (e) {
      var cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      var html = cd.getData('text/html');
      var text = cd.getData('text/plain');
      e.preventDefault();
      if (html) insertHTML(sanitize(html));
      else if (text) insertHTML(escapeText(text).replace(/\n/g, '<br>'));
      if (opts.onInput) opts.onInput();
    });

    if (opts.onInput) editable.addEventListener('input', opts.onInput);

    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();

    return {
      el: editable,
      getHTML: function () { return sanitize(editable.innerHTML); },
      getText: function () { return stripHtml(editable.innerHTML).trim(); },
      setHTML: function (h) { editable.innerHTML = sanitize(h); },
      isEmpty: function () {
        return stripHtml(editable.innerHTML).trim().length === 0 && !editable.querySelector('img,table,hr');
      },
      focus: function () { editable.focus(); },
    };
  }

  window.MTEditor = { create: create, sanitize: sanitize, stripHtml: stripHtml };
})();
