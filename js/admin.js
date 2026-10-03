/* ===== E-CASA Web — لوحة التحكم =====
   دخول بكلمة سر (افتراضي: casa2026 — بتتغير من اللوحة نفسها)
   - الاسم واللوجو (بيتزامنوا على كل الأجهزة)
   - النورمالات المرجعية WHO (بتتزامن)
   - حذف/تعديل الحالات مع كل دراساتها ووسائطها
*/
const Admin = (() => {
  const DEF = { siteName: 'MT CASA', logo: '', adminPass: 'casa2026' };
  let settings = { ...DEF };
  let overlay = null;

  const $id = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function whenDb() {
    while (typeof DB === 'undefined' || !DB.backend)
      await new Promise(r => setTimeout(r, 120));
  }

  async function loadSettings() {
    try {
      const r = await DB.get('meta', 'settings');
      if (r && r.value) settings = { ...DEF, ...r.value };
    } catch (e) {}
    /* النورمالات المحفوظة (لو اتعدلت) تتطبق على المرجع الحي */
    try {
      const r = await DB.get('meta', 'refs');
      if (r && r.value) for (const k in r.value) DB.REFERENCES[k] = r.value[k];
    } catch (e) {}
  }

  async function saveSettings() {
    await DB.put('meta', { key: 'settings', value: settings });
  }

  function applyBranding() {
    const name = settings.siteName || DEF.siteName;
    const brand = document.querySelector('.brand');
    if (brand) {
      if (settings.logo) {
        brand.innerHTML = `<img src="${settings.logo}" alt="logo" style="width:30px;height:30px;border-radius:8px;object-fit:cover;background:#fff"> <span><b>${esc(name)}</b></span>`;
      } else {
        const span = brand.querySelector('span');
        if (span) span.innerHTML = `<b>${esc(name)}</b>`;
      }
    }
    document.title = name + ' — Semen Analysis';
    const fn = $id('adm-foot-name');
    if (fn) fn.textContent = name;
  }

  function injectFooter() {
    if ($id('admin-footer')) return;
    const f = document.createElement('div');
    f.id = 'admin-footer';
    f.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:#0d1117;color:#8b949e;padding:16px 22px;margin-top:32px;font-size:13px;border-top:1px solid #21262d';
    f.innerHTML = `
      <div>© 2026 <b style="color:#c9d1d9">Mohamed Tayea</b> — All rights reserved ·
        <button id="adm-open" style="background:none;border:none;color:#58a6ff;cursor:pointer;font-size:13px;padding:0;font-family:inherit">Admin panel ⚙️</button>
      </div>
      <div>Crafted with passion, signature <span style="color:#c9d1d9;font-weight:700">M_Tayea</span></div>`;
    document.body.appendChild(f);
    $id('adm-open').onclick = open;
  }

  function authed() {
    if (sessionStorage.getItem('casa_admin') === '1') return true;
    const p = prompt('🔒 Admin panel — password:');
    if (p === null) return false;
    if (p === (settings.adminPass || DEF.adminPass)) {
      sessionStorage.setItem('casa_admin', '1');
      return true;
    }
    alert('Wrong password ❌');
    return false;
  }

  /* ---------- الواجهة ---------- */
  function open() {
    if (!authed()) return;
    if (overlay) { overlay.remove(); overlay = null; }
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.6);z-index:5000;overflow:auto;padding:24px 12px';
    overlay.innerHTML = `
      <div style="background:#fff;max-width:880px;margin:0 auto;border-radius:14px;padding:20px;direction:rtl;text-align:right">
        <div class="row">
          <h2 class="spacer">⚙️ Admin panel</h2>
          <button class="btn ghost" id="adm-close">Close ✖</button>
        </div>
        <div class="row" style="margin:14px 0;gap:8px;flex-wrap:wrap">
          <button class="btn small" data-tab="settings">Settings & logo</button>
          <button class="btn small ghost" data-tab="refs">Reference values</button>
          <button class="btn small ghost" data-tab="cases">Cases</button>
          <button class="btn small ghost" data-tab="users">🔑 Users</button>
          <button class="btn small ghost" data-tab="targets">🎯 Targets</button>
          ${myLabId() === '*' ? '<button class="btn small ghost" data-tab="labs">🧪 معامل Labs</button>' : ''}
        </div>
        <div id="adm-body"></div>
      </div>`;
    document.body.appendChild(overlay);
    $id('adm-close').onclick = () => { overlay.remove(); overlay = null; };
    overlay.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
      overlay.querySelectorAll('[data-tab]').forEach(x => x.className = 'btn small ghost');
      b.className = 'btn small';
      render(b.dataset.tab);
    });
    render('settings');
  }

  function render(tab) {
    if (tab === 'settings') renderSettings();
    else if (tab === 'refs') renderRefs();
    else if (tab === 'targets') renderTargets();
    else if (tab === 'users') renderUsers();
    else if (tab === 'labs') renderLabs();
    else renderCases();
  }

  /* ---------- تبويب المعامل (للسوبر أدمن فقط) ---------- */
  async function getLabs() {
    try {
      const r = await DB.get('meta', 'labs');
      if (r && Array.isArray(r.value)) return r.value;
    } catch (e) {}
    return [];
  }
  async function saveLabs(l) { await DB.put('meta', { key: 'labs', value: l }); }
  const myLabId = () => (typeof Login !== 'undefined' && Login.lab) ? Login.lab() : '*';

  async function renderLabs() {
    if (myLabId() !== '*') { $id('adm-body').innerHTML = '<p class="hint">Only the super admin can manage labs.</p>'; return; }
    const labs = await getLabs();
    const acc = await getAccounts();
    const patients = await DB.all('patients');
    const countFor = id => patients.filter(p => (p.labId || 'main') === id).length;
    $id('adm-body').innerHTML = `
      <p class="hint" style="margin-bottom:10px">Each lab has its own name, logo (report header) and isolated cases. Create a lab, then create its user from the <b>Users</b> tab choosing this lab.</p>
      <div class="card" style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="text-align:left;color:#666">
            <th style="padding:6px">Lab</th><th>Name</th><th>Login prefix</th><th>Activation code</th><th>Users</th><th>Cases</th><th></th>
          </tr></thead>
          <tbody>${labs.map((L, i) => `
            <tr style="border-top:1px solid #eee">
              <td style="padding:6px">${L.logo ? `<img src="${L.logo}" style="width:34px;height:34px;object-fit:cover;border-radius:8px">` : '—'}</td>
              <td style="font-weight:700">${esc(L.name)}</td>
              <td><code style="background:#eef2f7;padding:2px 7px;border-radius:6px;font-weight:700">${esc(L.slug || '—')}/</code></td>
              <td><code style="background:#fff8e6;padding:2px 7px;border-radius:6px;font-weight:700;letter-spacing:1px">${esc(L.code || '—')}</code></td>
              <td>${acc.filter(a => a.lab === L.id).map(a => esc(a.u)).join(', ') || '<span class="gray">no user</span>'}</td>
              <td>${countFor(L.id)}</td>
              <td style="white-space:nowrap;text-align:right">
                <button class="btn small ghost" data-lcode="${i}">🔑 Code</button>
                <button class="btn small ghost" data-lrename="${i}">Rename</button>
                <button class="btn small ghost" data-llogo="${i}">Logo</button>
                <button class="btn small" style="background:#b91c1c" data-ldel="${i}">Delete</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="7" style="padding:16px;text-align:center;color:#999">No labs yet</td></tr>'}</tbody>
        </table>
      </div>
      <div class="card">
        <h4 style="margin:0 0 10px">＋ Add lab</h4>
        <div class="row">
          <input id="adm-lname" placeholder="Lab name (shown on the report)" style="flex:2;padding:9px;border:1px solid #ddd;border-radius:8px">
          <input id="adm-lslug" placeholder="Login prefix (English, short)" style="flex:1;padding:9px;border:1px solid #ddd;border-radius:8px">
          <label class="btn ghost" style="cursor:pointer">Logo
            <input id="adm-llogo-new" type="file" accept="image/*" hidden>
          </label>
          <img id="adm-llogo-prev" style="display:none;width:38px;height:38px;object-fit:cover;border-radius:8px">
          <button class="btn" id="adm-ladd">Add</button>
        </div>
        <p class="hint" style="margin-top:8px">Users will log in as <b>prefix/username</b> — e.g. <b>sakr/ahmed</b>. An activation code is generated automatically and the device asks for it once on first use.</p>
      </div>`;

    let newLogo = '';
    $id('adm-llogo-new').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const sc = Math.min(1, 220 / Math.max(img.width, img.height));
        c.width = img.width * sc; c.height = img.height * sc;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        newLogo = c.toDataURL('image/png');
        const pv = $id('adm-llogo-prev'); pv.src = newLogo; pv.style.display = '';
      };
      img.src = URL.createObjectURL(f);
    };
    const mkCode = () => {
      const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
      let s = '';
      for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
      return s.slice(0, 4) + '-' + s.slice(4);
    };
    $id('adm-ladd').onclick = async () => {
      const name = $id('adm-lname').value.trim();
      if (!name) { alert('Lab name is required'); return; }
      let slug = $id('adm-lslug').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!slug) slug = 'lab' + Math.random().toString(36).slice(2, 6);
      if (labs.some(l => (l.slug || '').toLowerCase() === slug)) { alert('This login prefix is already used — choose another'); return; }
      const id = 'lab' + Date.now();
      labs.push({ id, name, slug, code: mkCode(), logo: newLogo });
      await saveLabs(labs);
      renderLabs();
    };
    $id('adm-body').querySelectorAll('[data-lcode]').forEach(b => b.onclick = async () => {
      const L = labs[+b.dataset.lcode];
      if (!confirm('Generate a NEW activation code for "' + L.name + '"?\n\nOld devices keep working — new devices will need the new code.')) return;
      L.code = mkCode();
      await saveLabs(labs);
      renderLabs();
      alert('New code for ' + L.name + ': ' + L.code);
    });
    $id('adm-body').querySelectorAll('[data-lrename]').forEach(b => b.onclick = async () => {
      const L = labs[+b.dataset.lrename];
      const n = prompt('Lab name:', L.name); if (n === null || !n.trim()) return;
      L.name = n.trim(); await saveLabs(labs); renderLabs();
    });
    $id('adm-body').querySelectorAll('[data-llogo]').forEach(b => b.onclick = async () => {
      const L = labs[+b.dataset.llogo];
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const img = new Image();
        img.onload = async () => {
          const c = document.createElement('canvas');
          const sc = Math.min(1, 220 / Math.max(img.width, img.height));
          c.width = img.width * sc; c.height = img.height * sc;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          L.logo = c.toDataURL('image/png');
          await saveLabs(labs); renderLabs();
        };
        img.src = URL.createObjectURL(f);
      };
      inp.click();
    });
    $id('adm-body').querySelectorAll('[data-ldel]').forEach(b => b.onclick = async () => {
      const L = labs[+b.dataset.ldel];
      const used = acc.some(a => a.lab === L.id) || countFor(L.id) > 0;
      if (!confirm(`Delete lab "${L.name}"?${used ? ' It has users and/or cases — they will become invisible to lab users.' : ''}`)) return;
      labs.splice(+b.dataset.ldel, 1);
      await saveLabs(labs); renderLabs();
    });
  }

  /* ---------- تبويب الإعدادات ---------- */
  function renderSettings() {
    if (myLabId() !== '*') { renderMyLabSettings(); return; }
    renderSettingsSuper();
  }

  /* إعدادات المعمل الخاص: الاسم واللوجو اللي في ترويسة التقرير */
  async function renderMyLabSettings() {
    const labs = await getLabs();
    const id = myLabId();
    let lab = labs.find(x => x.id === id);
    if (!lab) { lab = { id, name: '', logo: '' }; }
    $id('adm-body').innerHTML = `
      <div class="card">
        <h3>اسم معملك</h3>
        <label class="f"><span>الاسم اللي هيظهر في ترويسة التقرير</span>
          <input id="adm-lab-name" value="${esc(lab.name || '')}" placeholder="مثال: معمل الدكتور صقر"></label>
      </div>
      <div class="card">
        <h3>لوجو معملك</h3>
        <div class="row" style="align-items:center;gap:12px">
          <div id="adm-lab-logo-prev" style="width:64px;height:64px;border:1px dashed #ccc;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${lab.logo ? `<img src="${lab.logo}" style="width:100%;height:100%;object-fit:cover">` : '<span style="font-size:11px;color:#aaa">لا يوجد</span>'}
          </div>
          <div style="flex:1">
            <label class="btn small ghost" style="cursor:pointer">رفع لوجو
              <input id="adm-lab-logo" type="file" accept="image/*" hidden>
            </label>
            ${lab.logo ? ' <button class="btn small ghost" id="adm-lab-logo-del">إزالة اللوجو</button>' : ''}
            <p class="hint" style="margin-top:6px">بيبان في الترويسة وكمان كعلامة مائية خفيفة في خلفية كل صفحة من التقرير المطبوع.</p>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>صورة رأس التقرير (اختياري)</h3>
        <div class="row" style="align-items:center;gap:12px">
          <div id="adm-lab-head-prev" style="width:120px;height:44px;border:1px dashed #ccc;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${lab.header ? `<img src="${lab.header}" style="width:100%;height:100%;object-fit:contain">` : '<span style="font-size:11px;color:#aaa">لا يوجد</span>'}
          </div>
          <div style="flex:1">
            <label class="btn small ghost" style="cursor:pointer">رفع صورة الرأس
              <input id="adm-lab-head" type="file" accept="image/*" hidden>
            </label>
            ${lab.header ? ' <button class="btn small ghost" id="adm-lab-head-del">إزالة</button>' : ''}
            <p class="hint" style="margin-top:6px">تظهر عرض الصفحة كاملة فوق كل صفحة من التقرير (مناسبة لليتر هيد بتاع المعمل).</p>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>صورة ديل التقرير (اختياري)</h3>
        <div class="row" style="align-items:center;gap:12px">
          <div id="adm-lab-foot-prev" style="width:120px;height:44px;border:1px dashed #ccc;border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${lab.footer ? `<img src="${lab.footer}" style="width:100%;height:100%;object-fit:contain">` : '<span style="font-size:11px;color:#aaa">لا يوجد</span>'}
          </div>
          <div style="flex:1">
            <label class="btn small ghost" style="cursor:pointer">رفع صورة الديل
              <input id="adm-lab-foot" type="file" accept="image/*" hidden>
            </label>
            ${lab.footer ? ' <button class="btn small ghost" id="adm-lab-foot-del">إزالة</button>' : ''}
            <p class="hint" style="margin-top:6px">تظهر ثابتة تحت كل صفحة من صفحات التقرير المطبوع.</p>
          </div>
        </div>
      </div>
      <br><button class="btn" id="adm-lab-save">💾 حفظ</button>`;

    /* رفع صورة لأي خانة: logo (220px) / header / footer (عرض 1000px) */
    const bindUpload = (inputId, field, prevId, maxDim, cover) => {
      const inp = $id(inputId);
      if (!inp) return;
      inp.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          const isW = img.width >= img.height;
          const scale = isW ? Math.min(1, maxDim / img.width) : Math.min(1, maxDim / img.height);
          c.width = img.width * scale; c.height = img.height * scale;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          lab[field] = c.toDataURL('image/png');
          const fit = cover ? 'cover' : 'contain';
          $id(prevId).innerHTML = `<img src="${lab[field]}" style="width:100%;height:100%;object-fit:${fit}">`;
        };
        img.src = URL.createObjectURL(file);
      };
      const delB = $id(inputId + '-del');
      if (delB) delB.onclick = () => { lab[field] = ''; renderMyLabSettings(); };
    };
    bindUpload('adm-lab-logo', 'logo', 'adm-lab-logo-prev', 220, true);
    bindUpload('adm-lab-head', 'header', 'adm-lab-head-prev', 1000, false);
    bindUpload('adm-lab-foot', 'footer', 'adm-lab-foot-prev', 1000, false);
    $id('adm-lab-save').onclick = async () => {
      lab.name = $id('adm-lab-name').value.trim();
      const i = labs.findIndex(x => x.id === id);
      if (i >= 0) labs[i] = lab; else labs.push(lab);
      await saveLabs(labs);
      alert('✅ تم الحفظ — هيظهر في ترويسة التقرير');
    };
  }

  /* إعدادات السوبر أدمن (الموقع كله) */
  function renderSettingsSuper() {
    $id('adm-body').innerHTML = `
      <div class="card">
        <h3>Lab name</h3>
        <label class="f"><span>Name shown in the header and report</span>
          <input id="adm-name" value="${esc(settings.siteName)}"></label>
      </div>
      <div class="card">
        <h3>Logo</h3>
        <div class="row" style="align-items:center;gap:12px">
          <div id="adm-logo-prev" style="width:64px;height:64px;border:1px dashed #ccc;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${settings.logo ? `<img src="${settings.logo}" style="width:100%;height:100%;object-fit:cover">` : '<span style="font-size:11px;color:#aaa">none</span>'}
          </div>
          <div style="flex:1">
            <label class="btn small ghost" style="cursor:pointer">Upload a logo
              <input id="adm-logo" type="file" accept="image/*" hidden>
            </label>
            ${settings.logo ? ' <button class="btn small ghost" id="adm-logo-del">Remove logo</button>' : ''}
            <p class="hint" style="margin-top:6px">The image is resized automatically — it syncs to all your devices.</p>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Admin panel password</h3>
        <label class="f"><span>New password</span><input id="adm-pass" type="text" value="${esc(settings.adminPass)}"></label>
      </div>
      <br><button class="btn" id="adm-save">💾 Save</button>`;

    $id('adm-logo').onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const s = Math.min(1, 160 / Math.max(img.width, img.height));
        c.width = img.width * s; c.height = img.height * s;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        settings.logo = c.toDataURL('image/png');
        $id('adm-logo-prev').innerHTML = `<img src="${settings.logo}" style="width:100%;height:100%;object-fit:cover">`;
      };
      img.src = URL.createObjectURL(file);
    };
    const del = $id('adm-logo-del');
    if (del) del.onclick = () => { settings.logo = ''; renderSettings(); };
    $id('adm-save').onclick = async () => {
      settings.siteName = $id('adm-name').value.trim() || DEF.siteName;
      const np = $id('adm-pass').value.trim();
      if (np) settings.adminPass = np;
      await saveSettings();
      alert('✅ Saved — the page will reload');
      location.reload();
    };
  }

  /* ---------- تبويب النورمالات ---------- */
  function renderRefs() {
    const keys = Object.keys(DB.REFERENCES);
    $id('adm-body').innerHTML = `
      <p class="hint" style="margin-bottom:10px">The reference values (WHO) the report works against — edit freely and press Save. <b>low/high = numeric rejection limits.</b></p>
      <div class="card" style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="text-align:right;color:#666">
            <th style="padding:6px">Parameter</th><th>Label</th><th>Reference text</th><th>low</th><th>high</th>
          </tr></thead>
          <tbody>${keys.map(k => {
            const r = DB.REFERENCES[k];
            return `<tr style="border-top:1px solid #eee">
              <td style="padding:6px;font-weight:700">${esc(k)}</td>
              <td><input data-k="${k}" data-f="label" value="${esc(r.label)}" style="width:150px"></td>
              <td><input data-k="${k}" data-f="ref" value="${esc(r.ref)}" style="width:140px"></td>
              <td><input data-k="${k}" data-f="low" type="number" step="any" value="${r.low ?? ''}" style="width:70px"></td>
              <td><input data-k="${k}" data-f="high" type="number" step="any" value="${r.high ?? ''}" style="width:70px"></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <br><button class="btn" id="adm-refs-save">💾 Save reference values</button>`;

    $id('adm-refs-save').onclick = async () => {
      const out = {};
      overlay.querySelectorAll('#adm-body input[data-k]').forEach(inp => {
        const k = inp.dataset.k, f = inp.dataset.f;
        out[k] = out[k] || { ...DB.REFERENCES[k] };
        out[k][f] = inp.value === '' ? undefined : (f === 'label' || f === 'ref' ? inp.value : parseFloat(inp.value));
      });
      for (const k in out) DB.REFERENCES[k] = out[k];
      await DB.put('meta', { key: 'refs', value: JSON.parse(JSON.stringify(DB.REFERENCES)) });
      alert('✅ Reference values saved — they apply on all devices via sync');
    };
  }

  /* ---------- تبويب الحالات ---------- */
  async function renderCases() {
    const body = $id('adm-body');
    body.innerHTML = `<p class="hint">Loading…</p>`;
    const mine2 = myLabId();
    const [allP, studies] = [await DB.all('patients'), await DB.all('studies')];
    const patients = mine2 === '*' ? allP : allP.filter(p => (p.labId || 'main') === mine2);
    const counts = {};
    studies.forEach(s => counts[s.patientId] = (counts[s.patientId] || 0) + 1);
    const sorted = patients.slice().sort((a, b) => (b.id || 0) - (a.id || 0));

    body.innerHTML = `
      <div class="row" style="margin-bottom:10px">
        <input id="adm-q" placeholder="🔍 Search by name or code…" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px">
        <span class="hint">${sorted.length} case(s)</span>
      </div>
      <div class="card" style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px" id="adm-tbl">
          <thead><tr style="text-align:right;color:#666">
            <th style="padding:6px">Code</th><th>Name</th><th>Age</th><th>Phone</th><th>Studies</th><th></th>
          </tr></thead>
          <tbody>${sorted.map(p => `
            <tr data-row="${p.id}" style="border-top:1px solid #eee">
              <td style="padding:6px">${esc(p.code || '')}</td>
              <td>${esc(p.name)}</td>
              <td>${esc(p.age || '')}</td>
              <td>${esc(p.phone || '')}</td>
              <td>${counts[p.id] || 0}</td>
              <td style="white-space:nowrap">
                <button class="btn small ghost" data-edit="${p.id}">Edit</button>
                <button class="btn small" style="background:#b91c1c" data-del="${p.id}">حذف</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="6" style="padding:16px;text-align:center;color:#999">No cases</td></tr>'}</tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:8px">⚠️ Deleting removes the case + all its studies + its images and videos permanently from the device and the cloud.</p>`;

    $id('adm-q').oninput = e => {
      const q = e.target.value.trim();
      body.querySelectorAll('#adm-tbl tbody tr').forEach(tr => {
        if (!q) { tr.style.display = ''; return; }
        tr.style.display = tr.textContent.includes(q) ? '' : 'none';
      });
    };
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
      const p = patients.find(x => x.id === +b.dataset.edit);
      if (!p) return;
      const name = prompt('Name:', p.name || ''); if (name === null) return;
      const age = prompt('Age:', p.age || ''); if (age === null) return;
      const phone = prompt('Phone:', p.phone || ''); if (phone === null) return;
      await DB.put('patients', { ...p, name: name.trim(), age: age.trim(), phone: phone.trim() });
      alert('✅ Saved');
      renderCases();
    });
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const p = patients.find(x => x.id === +b.dataset.del);
      if (!p) return;
      const n = counts[p.id] || 0;
      if (!confirm(`⚠️ "${p.name}" and ${n} study/studies with all their media will be deleted. Are you sure?`)) return;
      const sts = await DB.byIndex('studies', 'patientId', p.id);
      for (const s of sts) {
        const media = await DB.byIndex('media', 'studyId', s.id);
        for (const m of media) await DB.del('media', m.id);
        await DB.del('studies', s.id);
      }
      await DB.del('patients', p.id);
      renderCases();
    });
  }

  /* ---------- تبويب التارجت (فيديوهات/صور مرجعية للتقييم) ---------- */
  async function getTargets() {
    try {
      const r = await DB.get('meta', 'targets');
      return (r && r.value) || { videos: [], images: [] };
    } catch (e) { return { videos: [], images: [] }; }
  }

  async function saveTargets(t) {
    await DB.put('meta', { key: 'targets', value: t });
  }

  function fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function renderTargets() {
    const t = await getTargets();
    $id('adm-body').innerHTML = `
      <p class="hint" style="margin-bottom:10px">Upload <b>target (certified reference)</b> videos and images — automatic analysis evaluates each video against them and shows the similarity to the closest target. They sync across devices.</p>
      <div class="card">
        <h3>🎬 Target videos (${t.videos.length}/4)</h3>
        <div class="row" style="flex-wrap:wrap;gap:10px">
          ${t.videos.map((v, i) => `
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:8px;width:220px">
              <video src="${v.dataUrl}" controls style="width:100%;height:110px;background:#000;border-radius:6px"></video>
              <div class="row" style="margin-top:6px">
                <small class="spacer gray">${esc(v.name)}</small>
                <button class="btn small ghost" data-delvid="${i}">Delete</button>
              </div>
            </div>`).join('')}
          ${t.videos.length < 4 ? `
            <label class="btn ghost" style="cursor:pointer;align-self:center">＋ Add target video
              <input id="adm-tvid" type="file" accept="video/*,.avi,.mkv,.mov,.wmv" hidden>
            </label>` : ''}
        </div>
        <p class="hint" style="margin-top:8px">Maximum 4 videos — each up to 2.5 MB (a short 3-5 second clip from a certified sample).</p>
      </div>
      <div class="card">
        <h3>🖼️ Target images (${t.images.length}/4)</h3>
        <div class="row" style="flex-wrap:wrap;gap:10px">
          ${t.images.map((v, i) => `
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:8px;width:160px">
              <img src="${v.dataUrl}" style="width:100%;height:110px;object-fit:cover;border-radius:6px">
              <div class="row" style="margin-top:6px">
                <small class="spacer gray">${esc(v.name)}</small>
                <button class="btn small ghost" data-delimg="${i}">Delete</button>
              </div>
            </div>`).join('')}
          ${t.images.length < 4 ? `
            <label class="btn ghost" style="cursor:pointer;align-self:center">＋ Add target image
              <input id="adm-timg" type="file" accept="image/*" multiple hidden>
            </label>` : ''}
        </div>
      </div>`;

    const vidIn = $id('adm-tvid');
    if (vidIn) vidIn.onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 2.5 * 1024 * 1024) { alert('⚠️ Video is larger than 2.5 MB — cut a shorter clip'); return; }
      t.videos.push({ name: f.name, dataUrl: await fileToDataUrl(f) });
      await saveTargets(t);
      renderTargets();
    };
    const imgIn = $id('adm-timg');
    if (imgIn) imgIn.onchange = async e => {
      for (const f of [...e.target.files].slice(0, 4 - t.images.length)) {
        const dataUrl = await fileToDataUrl(f);
        const img = new Image();
        await new Promise(res => { img.onload = res; img.src = dataUrl; });
        const c = document.createElement('canvas');
        const s = Math.min(1, 360 / Math.max(img.width, img.height));
        c.width = img.width * s; c.height = img.height * s;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        t.images.push({ name: f.name, dataUrl: c.toDataURL('image/jpeg', 0.85) });
      }
      await saveTargets(t);
      renderTargets();
    };
    overlay.querySelectorAll('[data-delvid]').forEach(b => b.onclick = async () => {
      t.videos.splice(+b.dataset.delvid, 1); await saveTargets(t); renderTargets();
    });
    overlay.querySelectorAll('[data-delimg]').forEach(b => b.onclick = async () => {
      t.images.splice(+b.dataset.delimg, 1); await saveTargets(t); renderTargets();
    });
  }

  /* ---------- accounts tab (site login) ---------- */
  async function getAccounts() {
    try {
      const r = await DB.get('meta', 'accounts');
      if (r && Array.isArray(r.value) && r.value.length) return r.value;
    } catch (e) {}
    return [{ u: '1', p: '5' }];
  }
  async function saveAccounts(a) { await DB.put('meta', { key: 'accounts', value: a }); }

  async function renderUsers() {
    const acc = await getAccounts();
    const labs = await getLabs();
    const mine = myLabId();
    /* lab admin manages only their lab's accounts; super sees all */
    const list = mine === '*' ? acc.map((a, i) => ({ a, i })) : acc.map((a, i) => ({ a, i })).filter(x => (x.a.lab || '*') === mine);
    const labName = id => id === '*' ? '⭐ super admin' : ((labs.find(l => l.id === id) || {}).name || id || 'main');
    $id('adm-body').innerHTML = `
      <p class="hint" style="margin-bottom:10px">Login accounts for the site. Changes sync to all devices. The last super account cannot be deleted — the site must always keep at least one.<br>Users log in as <b>lab-prefix/username</b> (e.g. <b>${esc((labs.find(l => l.id === mine) || {}).slug || '')}/${esc((list[0] && list[0].a.u) || 'user')}</b>).</p>
      <div class="card" style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="text-align:left;color:#666">
            <th style="padding:6px">Username</th><th>Password</th>${mine === '*' ? '<th>Lab</th>' : ''}<th></th>
          </tr></thead>
          <tbody>${list.map(({ a, i }) => `
            <tr style="border-top:1px solid #eee">
              <td style="padding:6px;font-weight:700">${esc(a.u)}</td>
              <td>${esc(a.p)}</td>
              ${mine === '*' ? `<td>${esc(labName(a.lab))}</td>` : ''}
              <td style="white-space:nowrap;text-align:right">
                <button class="btn small ghost" data-uedit="${i}">Edit</button>
                <button class="btn small" style="background:#b91c1c" data-udel="${i}" ${acc.filter(x => (x.lab || '*') === '*').length === 1 && (a.lab || '*') === '*' ? 'disabled title="Last super account"' : ''}>Delete</button>
              </td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="card">
        <h4 style="margin:0 0 10px">＋ Add account</h4>
        <div class="row">
          <input id="adm-nu" placeholder="Username" style="padding:9px;border:1px solid #ddd;border-radius:8px">
          <input id="adm-np" placeholder="Password" style="padding:9px;border:1px solid #ddd;border-radius:8px">
          ${mine === '*' ? `<select id="adm-nlab" style="padding:9px;border:1px solid #ddd;border-radius:8px">
            <option value="*">⭐ super admin (sees all labs)</option>
            ${labs.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}
          </select>` : ''}
          <button class="btn" id="adm-addu">Add</button>
        </div>
      </div>`;

    $id('adm-addu').onclick = async () => {
      const u = $id('adm-nu').value.trim(), p = $id('adm-np').value;
      const lab = mine === '*' ? ($id('adm-nlab') ? $id('adm-nlab').value : '*') : mine;
      if (!u || !p) { alert('Username and password are both required'); return; }
      if (acc.some(a => a.u === u)) { alert('This username already exists'); return; }
      acc.push({ u, p, lab });
      await saveAccounts(acc);
      renderUsers();
    };
    $id('adm-body').querySelectorAll('[data-uedit]').forEach(b => b.onclick = async () => {
      const a = acc[+b.dataset.uedit];
      const nu = prompt('Username:', a.u); if (nu === null) return;
      const np = prompt('Password:', a.p); if (np === null) return;
      if (!nu.trim() || !np) { alert('Username and password cannot be empty'); return; }
      if (acc.some((x, i) => x.u === nu.trim() && i !== +b.dataset.uedit)) { alert('This username already exists'); return; }
      acc[+b.dataset.uedit] = { ...acc[+b.dataset.uedit], u: nu.trim(), p: np };
      await saveAccounts(acc);
      renderUsers();
    });
    $id('adm-body').querySelectorAll('[data-udel]').forEach(b => b.onclick = async () => {
      if (acc.length === 1) { alert('The last account cannot be deleted'); return; }
      if (!confirm(`Delete account "${acc[+b.dataset.udel].u}"?`)) return;
      acc.splice(+b.dataset.udel, 1);
      await saveAccounts(acc);
      renderUsers();
    });
  }

  /* after meta syncs from the cloud */
  async function onMetaSynced() {
    await loadSettings();
    applyBranding();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await whenDb();
    injectFooter();
    await loadSettings();
    applyBranding();
  });

  return { open, onMetaSynced };
})();
