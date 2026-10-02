/*!
 * m_tayea Signature — التوقيع الرسمي لمواقع محمد طايع
 * ---------------------------------------------------
 * التركيب: ضع هذا السطر قبل وسم الإغلاق </body> في أي موقع:
 *
 *   <script src="https://m-tayea.mtayea.com/signature/mtayea-signature.js"></script>
 *
 * أو لو رافع الملف مع موقعك:
 *
 *   <script src="mtayea-signature.js"></script>
 *
 * © 2026 Mohamed Tayea — m_tayea
 */
(function () {
  'use strict';

  function init() {
  /* لو التوقيع موجود أصلاً، ما تضفهوش مرتين */
  if (document.getElementById('mtayea-signature')) return;

  var SITE_URL = 'https://m-tayea.mtayea.com';
  var HANDLE = '@m_tayea';

  var css = [
    '#mtayea-signature{',
    '  position:fixed;bottom:18px;left:18px;z-index:99999;',
    '  font-family:"Segoe UI",Tahoma,Arial,sans-serif;',
    '  direction:ltr;',
    '}',
    '#mtayea-signature .mt-badge{',
    '  display:flex;align-items:center;gap:8px;',
    '  background:rgba(12,11,14,.82);',
    '  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
    '  border:1px solid rgba(255,255,255,.14);',
    '  border-radius:999px;padding:9px 16px;',
    '  color:#fff;text-decoration:none;font-size:13px;font-weight:600;',
    '  letter-spacing:.02em;cursor:pointer;',
    '  box-shadow:0 8px 30px rgba(0,0,0,.45);',
    '  opacity:0;transform:translateY(16px);',
    '  transition:opacity .6s cubic-bezier(.22,1,.36,1),transform .6s cubic-bezier(.22,1,.36,1),border-color .35s,box-shadow .35s;',
    '}',
    '#mtayea-signature .mt-badge.mt-show{opacity:1;transform:translateY(0)}',
    '#mtayea-signature .mt-badge:hover{',
    '  border-color:rgba(212,175,55,.6);',
    '  box-shadow:0 8px 34px rgba(212,175,55,.35);',
    '}',
    '#mtayea-signature .mt-dot{',
    '  width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#f9e296,#e6c455,#b8912f);',
    '  box-shadow:0 0 10px #d4af37;flex-shrink:0;',
    '}',
    '#mtayea-signature .mt-handle{color:#bdbdbd;font-weight:400}',
    '#mtayea-signature .mt-badge:hover .mt-handle{color:#fff}',
    '@media (max-width:480px){#mtayea-signature .mt-handle{display:none}}',
    '@media (prefers-reduced-motion:reduce){',
    '  #mtayea-signature .mt-badge{transition:none;opacity:1;transform:none}',
    '}'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* شارة التوقيع */
  var wrap = document.createElement('div');
  wrap.id = 'mtayea-signature';
  wrap.innerHTML =
    '<a class="mt-badge" href="' + SITE_URL + '" target="_blank" rel="noopener" title="تصميم وتطوير Mohamed Tayea — m_tayea">' +
    '<span class="mt-dot"></span>' +
    '<span>صُنع بواسطة <b>m_tayea</b></span>' +
    '<span class="mt-handle">' + HANDLE + '</span>' +
    '</a>';
  document.body.appendChild(wrap);

  /* ظهور ناعم بعد تحميل الصفحة */
  window.addEventListener('load', function () {
    setTimeout(function () {
      var badge = wrap.querySelector('.mt-badge');
      if (badge) badge.classList.add('mt-show');
    }, 900);
  });
  }

  /* يشتغل في أي مكان: في الـ head أو قبل إغلاق body */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
