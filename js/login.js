/* ===== E-CASA Web — Login gate (v2 — labs) =====
   Simple username/password login before the app opens.
   - Accounts live in meta 'accounts' and sync across devices via Firebase
   - Each account belongs to a lab (field 'lab') or '*' = super admin (sees everything)
   - Default account: user "1" / password "5" — super admin (change from admin → Users)
   - Session only lasts until the tab closes (sessionStorage)
*/
const Login = (() => {
  const KEY = 'casa_login_user';
  const LAB = 'casa_login_lab';

  function current() { return sessionStorage.getItem(KEY) || ''; }
  function lab() {
    const l = sessionStorage.getItem(LAB);
    return l == null ? '*' : l; /* no entry → behave like super (backwards compatible) */
  }
  function isSuper() { return lab() === '*'; }

  async function getAccounts() {
    try {
      const r = await DB.get('meta', 'accounts');
      if (r && Array.isArray(r.value) && r.value.length) return r.value;
    } catch (e) {}
    return [{ u: '1', p: '5', lab: '*' }];
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

  /* called by app.js init before anything else renders */
  async function gate() {
    await DB.open(); await DB.seed();
    const user = current();
    if (user) { injectLogout(user); return; }

    const accounts = await getAccounts();
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#175f9e,#247ecb);padding:16px">
        <div style="background:#fff;border-radius:16px;padding:32px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.4);text-align:center">
          <div style="font-size:26px;font-weight:800;color:#175f9e">MT <span style="color:#e39823">CASA</span></div>
          <p style="color:#64748b;font-size:14px;margin:6px 0 22px">Semen Analysis System — staff login</p>
          <label style="display:block;text-align:left;font-size:13px;font-weight:600;color:#64748b;margin-bottom:12px">Username
            <input id="lg-user" autocomplete="username" style="width:100%;padding:11px;border:1px solid #d9e2ec;border-radius:9px;font-size:15px;margin-top:4px;box-sizing:border-box">
          </label>
          <label style="display:block;text-align:left;font-size:13px;font-weight:600;color:#64748b;margin-bottom:16px">Password
            <input id="lg-pass" type="password" autocomplete="current-password" style="width:100%;padding:11px;border:1px solid #d9e2ec;border-radius:9px;font-size:15px;margin-top:4px;box-sizing:border-box">
          </label>
          <button id="lg-go" style="width:100%;padding:12px;border:0;border-radius:10px;background:#247ecb;color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit">Sign in</button>
          <p id="lg-err" style="color:#d13438;font-size:13px;min-height:18px;margin:10px 0 0"></p>
        </div>
      </div>`;

    const tryLogin = async () => {
      const u = document.getElementById('lg-user').value.trim();
      const p = document.getElementById('lg-pass').value;
      const list = await getAccounts();
      const hit = list.find(a => a.u === u && a.p === p);
      if (hit) {
        sessionStorage.setItem(KEY, u);
        sessionStorage.setItem(LAB, hit.lab || '*');
        location.reload();          /* reload so the app boots cleanly behind the gate */
      } else {
        document.getElementById('lg-err').textContent = 'Wrong username or password ❌';
      }
    };
    document.getElementById('lg-go').onclick = tryLogin;
    document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
    document.getElementById('lg-user').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

    /* block app boot forever until login succeeds (reload happens on success) */
    await new Promise(() => {});
  }

  return { gate, logout, current, lab, isSuper };
})();
