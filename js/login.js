/* ===== E-CASA Web — Login gate (v3 — labs + activation) =====
   - دخول بصيغة: معمل/مستخدم  (مثال: sakr/ahmed) — أو اسم مستخدم لوحده للسوبر أدمن
   - حسابات كل معمل عايشة في مساره السحابي الخاص — الجهاز الجديد بيسحبها من السحابة
   - كود التفعيل: كل معمل ليه كود — يتكتب مرة واحدة بس في أول استخدام للجهاز
   - السوبر أدمن (user "1" / "5") مفيش عليه تفعيل
*/
const Login = (() => {
  const KEY = 'casa_login_user';
  const LAB = 'casa_login_lab';

  function current() { return sessionStorage.getItem(KEY) || ''; }
  function lab() {
    const l = sessionStorage.getItem(LAB);
    return l == null ? '*' : l; /* no entry → super admin */
  }
  function isSuper() { return lab() === '*'; }

  const actFlag = id => 'casa_act_' + id;

  /* ---------- حسابات محلية (للعمل أوفلاين بعد أول دخولة) ---------- */
  async function localAccounts(labId) {
    try {
      const r = await DB.get('meta', 'accounts');
      if (r && Array.isArray(r.value) && r.value.length)
        return labId === '*' ? r.value.filter(a => (a.lab || '*') === '*')
                             : r.value.filter(a => a.lab === labId);
    } catch (e) {}
    return labId === '*' ? [{ u: '1', p: 'mhmd@1993', lab: '*' }] : [];
  }

  async function localLabs() {
    try {
      const r = await DB.get('meta', 'labs');
      if (r && Array.isArray(r.value)) return r.value;
    } catch (e) {}
    return [];
  }

  /* ---------- هيكل صفحة الدخول ---------- */
  function pageHTML() {
    return `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#175f9e,#247ecb);padding:16px">
        <div style="background:#fff;border-radius:16px;padding:32px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.4);text-align:center">
          <div style="font-size:26px;font-weight:800;color:#175f9e">MT <span style="color:#e39823">CASA</span></div>
          <p style="color:#64748b;font-size:14px;margin:6px 0 22px">Semen Analysis System — staff login</p>
          <label style="display:block;text-align:left;font-size:13px;font-weight:600;color:#64748b;margin-bottom:12px">Username
            <span style="display:block;font-weight:400;font-size:11px;color:#94a3b8;margin-top:2px">lab/username — مثال: sakr/ahmed</span>
            <input id="lg-user" autocomplete="username" style="width:100%;padding:11px;border:1px solid #d9e2ec;border-radius:9px;font-size:15px;margin-top:4px;box-sizing:border-box" placeholder="lab/username">
          </label>
          <label style="display:block;text-align:left;font-size:13px;font-weight:600;color:#64748b;margin-bottom:16px">Password
            <input id="lg-pass" type="password" autocomplete="current-password" style="width:100%;padding:11px;border:1px solid #d9e2ec;border-radius:9px;font-size:15px;margin-top:4px;box-sizing:border-box">
          </label>
          <button id="lg-go" style="width:100%;padding:12px;border:0;border-radius:10px;background:#247ecb;color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit">Sign in</button>
          <p id="lg-err" style="color:#d13438;font-size:13px;min-height:18px;margin:10px 0 0"></p>
        </div>
      </div>`;
  }

  /* ---------- بوابة التفعيل: كود المعمل مرة واحدة في أول استخدام ---------- */
  function activationGate(labId, labRec) {
    if (localStorage.getItem(actFlag(labId))) return Promise.resolve(true);
    return new Promise(resolve => {
      document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f3a63,#175f9e);padding:16px">
          <div style="background:#fff;border-radius:16px;padding:32px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.4);text-align:center">
            <div style="font-size:38px">🔐</div>
            <h2 style="margin:8px 0 4px;color:#175f9e">Device activation</h2>
            <p style="color:#64748b;font-size:13px;margin:0 0 18px">Lab: <b>${labRec ? labRec.name : labId}</b><br>Enter the lab activation code — once per device.</p>
            <input id="act-code" placeholder="Activation code" style="width:100%;padding:12px;border:1px solid #d9e2ec;border-radius:9px;font-size:16px;text-align:center;letter-spacing:2px;box-sizing:border-box">
            <p id="act-err" style="color:#d13438;font-size:13px;min-height:18px;margin:8px 0 0"></p>
            <button id="act-go" style="width:100%;padding:12px;border:0;border-radius:10px;background:#175f9e;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:6px">Activate</button>
          </div>
        </div>`;
      const go = () => {
        const v = document.getElementById('act-code').value.trim();
        const real = labRec && labRec.code;
        if (real && v.toLowerCase() !== String(real).toLowerCase()) {
          document.getElementById('act-err').textContent = 'Wrong activation code ❌';
          return;
        }
        localStorage.setItem(actFlag(labId), '1');
        resolve(true);
      };
      document.getElementById('act-go').onclick = go;
      document.getElementById('act-code').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      document.getElementById('act-code').focus();
    });
  }

  /* ---------- البوابة الرئيسية ---------- */
  async function gate() {
    await DB.open(); await DB.seed();
    const user = current();
    if (user) { injectLogout(user); return; }

    document.body.innerHTML = pageHTML();

    const tryLogin = async () => {
      const raw = document.getElementById('lg-user').value.trim();
      const p = document.getElementById('lg-pass').value;
      const err = m => { document.getElementById('lg-err').textContent = m; };
      if (!raw || !p) return err('Enter username and password');

      /* فك الصيغة: slug/user أو user */
      let slug = null, uname = raw;
      if (raw.includes('/')) {
        const i = raw.indexOf('/');
        slug = raw.slice(0, i).trim().toLowerCase();
        uname = raw.slice(i + 1).trim();
        if (!slug || !uname) return err('Format: lab/username');
      }

      /* 1) جيب بيانات المعامل: من المحلي الأول، ولو مش موجود من السحابة */
      let labs = await localLabs();
      let labRec = null, labId = '*';
      if (slug) {
        labRec = labs.find(l => (l.slug || '').toLowerCase() === slug);
        if (!labRec && typeof SYNC !== 'undefined' && SYNC.fetchLabs) {
          try {
            labs = await SYNC.fetchLabs();
            labRec = labs.find(l => (l.slug || '').toLowerCase() === slug);
          } catch (e) { /* offline */ }
        }
        if (!labRec) return err('Lab "' + slug + '" not found — check the name or your internet');
        labId = labRec.id;
      }

      /* 2) جيب الحسابات: كاش الجهاز أولًا، وبعدين السحابة — الكاش في localStorage
            مش في meta عشان حسابات معمل مايترفعوش لمعمل تاني بالغلط */
      const cacheKey = 'casa_accs_' + labId;
      let accs = [];
      try { const c = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (Array.isArray(c)) accs = c; } catch (e) {}
      if (!accs.length) accs = slug ? await localAccounts(labId) : await localAccounts('*');
      if (!accs.length && typeof SYNC !== 'undefined' && SYNC.fetchAccounts) {
        try {
          const cloud = await SYNC.fetchAccounts(labId);
          if (cloud && cloud.length) {
            accs = cloud;
            try { localStorage.setItem(cacheKey, JSON.stringify(cloud)); } catch (e) {}
          }
        } catch (e) { /* offline + no cache */ }
      }

      let hit = null;
      for (const a of accs) {
        if (a.u !== uname) continue;
        if (a.p === p) { hit = a; break; }
        if (a.salt && a.pass && typeof SEC !== 'undefined') {
          const v = await SEC.verify(a, p);
          if (v.ok) { hit = a; break; }
        }
      }
      if (!hit) return err('Wrong username or password ❌');

      /* 3) تفعيل الجهاز لمعملات غير السوبر — مرة واحدة بس */
      if (labId !== '*') {
        const ok = await activationGate(labId, labRec);
        if (!ok) return;
      }

      sessionStorage.setItem(KEY, slug ? slug + '/' + uname : uname);
      sessionStorage.setItem(LAB, labId);
      location.reload();
    };
    document.getElementById('lg-go').onclick = tryLogin;
    document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
    document.getElementById('lg-user').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

    await new Promise(() => {}); /* block until login succeeds */
  }

  function logout() {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(LAB);
    location.reload();
  }

  function injectLogout(user) {
    const bar = document.querySelector('.topbar');
    if (!bar || document.getElementById('login-out')) return;
    const b = document.createElement('button');
    b.id = 'login-out';
    b.textContent = '⏻ ' + user + ' — Logout';
    b.style.cssText = 'background:rgba(255,255,255,.14);color:#fff;border:0;border-radius:999px;padding:6px 14px;font-size:13px;cursor:pointer;font-family:inherit';
    b.onclick = logout;
    bar.appendChild(b);
  }

  return { gate, logout, current, lab, isSuper };
})();
