/* ===== E-CASA Web — UI & routing (English) ===== */
(() => {
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);

let TEMPLATES = {};

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('hashchange', route);
window.addEventListener('online',  netStatus);
window.addEventListener('offline', netStatus);

async function init() {
  if (typeof Login !== 'undefined') await Login.gate();  /* login wall before anything renders */
  await DB.open();
  await DB.seed();
  TEMPLATES = (await DB.get('meta', 'templates')).value;
  seedBundledTargets();
  if (typeof SYNC !== 'undefined') SYNC.init();
  netStatus();
  route();
}

function netStatus() {
  const el = $('#net-status');
  if (!el) return;
  if (typeof SYNC !== 'undefined' && SYNC.ready && SYNC.connected) {
    el.textContent = 'Cloud connected ☁️ — data syncs across all your devices';
    el.className = 'net on';
    return;
  }
  if (typeof SYNC !== 'undefined' && SYNC.ready && !SYNC.connected) {
    el.textContent = 'Offline — work is saved locally and will sync when back online';
    el.className = 'net off';
    return;
  }
  const on = navigator.onLine;
  el.textContent = on ? 'Online' : 'Offline — work is saved locally';
  el.className = 'net ' + (on ? 'on' : 'off');
}

/* ---------- labs: each user sees only their lab's data ---------- */
function myLab() { return (typeof Login !== 'undefined' && Login.lab) ? Login.lab() : '*'; }
function visible(list) {
  const l = myLab();
  return l === '*' ? list : list.filter(r => (r.labId || 'main') === l);
}
async function getLabs() {
  try {
    const r = await DB.get('meta', 'labs');
    if (r && Array.isArray(r.value)) return r.value;
  } catch (e) {}
  return [];
}
/* report header for a record: its lab's name/logo, fallback to global settings */
async function brandFor(rec) {
  const labs = await getLabs();
  const hit = labs.find(x => x.id === (rec.labId || 'main'));
  if (hit) return { name: hit.name, logo: hit.logo || '' };
  try {
    const r = await DB.get('meta', 'settings');
    if (r && r.value) return { name: r.value.siteName || 'MT CASA', logo: r.value.logo || '' };
  } catch (e) {}
  return { name: 'MT CASA', logo: '' };
}

/* bundled target images/videos — seeded once so analysis always has references */
async function seedBundledTargets() {
  try {
    const r = await DB.get('meta', 'targets');
    if (r && r.value && ((r.value.videos || []).length || (r.value.images || []).length)) return;
    const toData = b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); });
    const t = { videos: [], images: [] };
    for (const n of ['target-morph-1.png', 'target-morph-2.png']) {
      t.images.push({ name: n, dataUrl: await toData(await (await fetch('assets/' + n)).blob()) });
    }
    t.videos.push({ name: 'target-motility.mp4', dataUrl: await toData(await (await fetch('assets/target-motility.mp4')).blob()) });
    await DB.put('meta', { key: 'targets', value: t });
  } catch (e) { /* offline first run — admin can re-add from the Targets tab */ }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- router ---------- */
async function route() {
  if (typeof Cam !== 'undefined') Cam.stop();
  const parts = (location.hash || '#cases').slice(1).split('/');
  const page = parts[0] || 'cases';
  try {
    if (page === 'newcase')  return pagePatient(null);
    if (page === 'patient')  return Number.isFinite(+parts[1]) && +parts[1] > 0 ? pagePatient(+parts[1]) : pageCases();
    if (page === 'study')    return pageStudy(+parts[1], parts[2] ? +parts[2] : null);
    if (page === 'report')   return pageReport(+parts[1]);
    if (page === 'backup')   return pageBackup();
    return pageCases();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="red">${esc(e.message)}</p>
      <a class="btn ghost" href="#cases">Back to cases</a></div>`;
  }
}

/* ---------- page: cases ---------- */
async function pageCases() {
  const [allP, allS] = await Promise.all([DB.all('patients'), DB.all('studies')]);
  const patients = visible(allP);
  const studies = visible(allS);
  const counts = {};
  studies.forEach(s => { if (s.patientId != null) counts[s.patientId] = (counts[s.patientId] || 0) + 1; });
  patients.sort((a, b) => (b.id || 0) - (a.id || 0));

  const rows = list => list.map(p => `
    <tr class="clickable" onclick="location.hash='patient/${p.id}'">
      <td>&lt;${esc(p.code)}&gt;</td><td>${esc(p.name)}</td><td>${esc(p.age || '')}</td>
      <td>${counts[p.id] || 0}</td><td>${esc(p.phone || '')}</td>
    </tr>`).join('');

  $('#app').innerHTML = `
    <div class="card">
      <div class="row">
        <h2 class="spacer">Cases (${patients.length})</h2>
        <a class="btn accent" href="#newcase">+ New case</a>
      </div>
      <p><input id="search" placeholder="Search by name or code…" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px"></p>
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Age</th><th>Studies</th><th>Phone</th></tr></thead>
        <tbody id="p-rows">${rows(patients)}</tbody>
      </table>
    </div>`;

  $('#search').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = patients.filter(p =>
      !q || (p.name || '').toLowerCase().includes(q) || String(p.code || '').toLowerCase().includes(q));
    $('#p-rows').innerHTML = rows(filtered) ||
      `<tr><td colspan="5" class="gray">No results</td></tr>`;
  };
}

/* ---------- page: patient data + their studies ---------- */
async function pagePatient(id) {
  let p = id ? await DB.get('patients', id) : {};
  if (id && !p) { location.hash = 'cases'; return; }
  if (id && p && myLab() !== '*' && (p.labId || 'main') !== myLab()) { location.hash = 'cases'; return; }

  const studies = id
    ? (await DB.byIndex('studies', 'patientId', id)).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    : [];

  const sRows = studies.map(s => `
    <tr class="clickable" onclick="location.hash='study/${id}/${s.id}'">
      <td>${esc(s.date)}</td>
      <td>${esc(s.concentration ?? '')}</td>
      <td>${esc(s.pr ?? '')}</td>
      <td>${esc(s.normalMorph ?? '')}</td>
      <td><a class="btn small ghost" href="#report/${s.id}">Report</a></td>
    </tr>`).join('');

  $('#app').innerHTML = `
    <div class="card">
      <h2>${id ? 'Edit case' : 'New case'}</h2>
      <div class="grid">
        <label class="f"><span>Code</span><input id="p-code" value="${esc(p.code || '')}" placeholder="Auto-generated if left empty"></label>
        <label class="f"><span>Name *</span><input id="p-name" value="${esc(p.name || '')}"></label>
        <label class="f"><span>Age</span><input id="p-age" type="number" value="${esc(p.age || '')}"></label>
        <label class="f"><span>Phone</span><input id="p-phone" value="${esc(p.phone || '')}"></label>
        <label class="f"><span>Referring doctor</span><input id="p-ref" value="${esc(p.refDoctor || '')}"></label>
        <label class="f"><span>Notes</span><input id="p-notes" value="${esc(p.notes || '')}"></label>
      </div>
      <br>
      <div class="row">
        <button class="btn" id="save-p">Save</button>
        ${id ? `<a class="btn accent" href="#study/${id}">+ New study</a>
                <button class="btn danger" id="del-p">Delete case</button>` : ''}
        <a class="btn ghost spacer" style="text-align:center" href="#cases">Back</a>
      </div>
    </div>
    ${id ? `
    <div class="card">
      <h3>Studies (${studies.length})</h3>
      <table>
        <thead><tr><th>Date</th><th>Concentration (M/ml)</th><th>PR %</th><th>Normal morphology %</th><th></th></tr></thead>
        <tbody>${sRows || '<tr><td colspan="5" class="gray">No studies yet</td></tr>'}</tbody>
      </table>
    </div>` : ''}`;

  $('#save-p').onclick = async () => {
    const name = $('#p-name').value.trim();
    if (!name) return toast('Name is required');
    let code = $('#p-code').value.trim();
    if (!code) {
      const all = await DB.all('patients');
      code = String(Math.max(0, ...all.map(x => parseInt(x.code) || 0)) + 1);
    }
    const rec = { ...p, code, name, age: $('#p-age').value, phone: $('#p-phone').value,
                  refDoctor: $('#p-ref').value, notes: $('#p-notes').value };
    if (!rec.labId) rec.labId = myLab() === '*' ? 'main' : myLab();
    const newId = await DB.put('patients', rec);
    toast('Saved');
    location.hash = 'patient/' + newId;
  };

  const del = $('#del-p');
  if (del) del.onclick = async () => {
    if (!confirm('Delete this case with ALL its studies permanently?')) return;
    for (const s of await DB.byIndex('studies', 'patientId', id)) {
      for (const m of await DB.byIndex('media', 'studyId', s.id)) await DB.del('media', m.id);
      await DB.del('studies', s.id);
    }
    await DB.del('patients', id);
    toast('Deleted');
    location.hash = 'cases';
  };
}

/* ---------- page: study (result entry) ---------- */
const REFKEYS = { volume:'volume', ph:'ph', concentration:'concentration', count:'count',
  pr:'pr', motileRatio:'motile', normalMorph:'normal', tzi:'tzi', wbc:'wbc', rbc:'rbc' };

const PHYS = [
  ['volume',           'Volume (ml)',              'number'],
  ['ph',               'pH',                       'number'],
  ['color',            'Color',                    'text', 'Color:'],
  ['odor',             'Odor',                     'text', 'Odor:'],
  ['viscosity',        'Viscosity',                'text', 'Viscosity:'],
  ['liquefactionTime', 'Liquefaction time',        'text', 'Liquefaction time:'],
  ['liquefactionState','Liquefaction state',       'text', 'Liquefaction state:'],
  ['abstDays',         'Abstinence days',          'text', 'Abst. days:'],
  ['agglutination',    'Agglutination',            'text', 'Agglutination:'],
];
const RESULTS = [
  ['concentration', 'Concentration (M/ml)',      'number'],
  ['count',         'Total count (M/ejaculate)', 'number'],
  ['pr',            'Progressive motility PR %', 'number'],
  ['np',            'Non-progressive NP %',      'number'],
  ['immotile',      'Immotile %',                'number'],
  ['motileRatio',   'Total motile % (auto)',     'number'],
  ['normalMorph',   'Normal morphology %',       'number'],
  ['tzi',           'TZI',                       'number'],
  ['sdi',           'SDI',                       'number'],
  ['wbc',           'White blood cells /HPF',    'number'],
  ['rbc',           'Red blood cells /HPF',      'number'],
  ['spermatogenicCells', 'Spermatogenic cells /HPF', 'number'],
];
const DYN = [   /* motion parameters from automatic analysis */
  ['vcl', 'VCL — Curvilinear velocity'],
  ['vsl', 'VSL — Straight line velocity'],
  ['vap', 'VAP — Average path velocity'],
  ['lin', 'LIN — Linearity (VSL/VCL)'],
  ['wob', 'WOB — Wobble (VAP/VCL)'],
  ['str', 'STR — Straightness (VSL/VAP)'],
];

/* morphology defect counts (WHO) — counts out of 100 spermatozoa */
const MORPH = [
  ['bigHead','Big Head'],['smallHead','Small head'],['tapered','Tapered head'],
  ['pyriform','Pyriform head'],['round','Round head'],['amorphous','Amorphus head'],
  ['vacuolated','Vacuolated head'],['smallAcrosome','Small akrosome'],['doubleHead','Double head'],
  ['thinNeck','Thin neck'],['bentNeck','Bent neck'],['thickNeck','Thick / irregular neck'],
  ['asymmetric','Asymmetric connected'],
  ['bentTail','Bent tail'],['multiTail','Multi tail'],['tailBreakdown','Tail breakdown'],
  ['coiledTail','Coiled tail'],['irregularTail','Irregular tail'],['shortTail','Short tail'],
  ['erc','E.R.C. (excess residual cytoplasm)'],
];

async function pageStudy(pid, sid) {
  const p = await DB.get('patients', pid);
  if (!p || !pid) { location.hash = 'cases'; return; }
  const s = sid ? await DB.get('studies', sid) : { date: today(), patientId: pid };
  /* study missing (bad id / not synced yet): go back to the patient's page, no crash */
  if (sid && !s) { location.hash = 'patient/' + pid; return; }
  const v = k => esc(s[k] ?? '');

  const numField = ([k, label]) => `
    <label class="f"><span>${label}</span>
      <input id="f-${k}" type="number" step="any" value="${v(k)}" data-ref="${REFKEYS[k] || ''}">
      <em class="badge" data-b="${REFKEYS[k] || ''}"></em>
    </label>`;
  const txtField = ([k, label, , tpl]) => `
    <label class="f"><span>${label}</span>
      <input id="f-${k}" list="dl-${(tpl || '').replace(/[^A-Za-z]/g, '')}" value="${v(k)}">
    </label>`;

  const datalists = Object.entries(TEMPLATES).map(([k, items]) => `
    <datalist id="dl-${k.replace(/[^A-Za-z]/g, '')}">
      ${items.map(i => `<option value="${esc(i)}">`).join('')}
    </datalist>`).join('');

  $('#app').innerHTML = `
    ${datalists}
    <div class="card">
      <h2>${sid ? 'Edit study' : 'New study'} — ${esc(p.name)} <span class="gray">&lt;${esc(p.code)}&gt;</span></h2>
      <div class="grid">
        <label class="f"><span>Study date</span><input id="f-date" type="date" value="${esc(s.date || today())}"></label>
      </div>
    </div>

    <div class="card">
      <h3>Physical properties</h3>
      <div class="grid">${PHYS.map(f => f[2] === 'number' ? numField(f) : txtField(f)).join('')}</div>
    </div>

    <div class="card">
      <h3>Results</h3>
      <div class="grid">${RESULTS.map(numField).join('')}</div>
      <p class="hint">Total count = concentration × volume, and total motile = PR + NP — calculated automatically on save.</p>
      <label class="f"><span>Comment</span>
        <textarea id="f-comment" list="dl-Comment">${v('comment')}</textarea>
      </label>
      <br>
      <div class="row">
        <button class="btn" id="save-s">Save</button>
        <button class="btn accent" id="save-report">Save + report</button>
        ${sid ? `<button class="btn danger" id="del-s">Delete study</button>` : ''}
        <a class="btn ghost spacer" style="text-align:center" href="#patient/${pid}">Back</a>
      </div>
    </div>

    <div class="card">
      <h3>Motion parameters (from automatic analysis)</h3>
      <div class="grid">${DYN.map(([k, label]) => `
        <label class="f"><span>${label}</span>
          <input id="f-${k}" type="number" step="any" value="${v(k)}" readonly>
        </label>`).join('')}</div>
    </div>

    <div class="card">
      <h3>Morphology defect counts <span class="gray">(out of 100 spermatozoa — WHO)</span></h3>
      <div class="grid">${MORPH.map(([k, label]) => `
        <label class="f"><span>${label}</span>
          <input id="f-df-${k}" type="number" min="0" step="1" value="${esc((s.defects || {})[k] ?? '')}">
        </label>`).join('')}</div>
      <p class="hint">TZI and SDI are calculated automatically on save: TZI = total defects ÷ terato sperms, SDI = total defects ÷ 100 counted.</p>
    </div>

    <div id="cam-box"></div>`;

  let currentSid = sid;
  if (typeof Cam !== 'undefined') Cam.render($('#cam-box'), {
    patientId: pid,
    studyId: sid,
    getStudyId: async () => currentSid || await save(),
  });
  if (typeof Motility !== 'undefined') Motility.configure({
    getStudyId: async () => currentSid || await save(),
    getVideos: async () => {
      const sid = currentSid || await save();
      currentSid = sid;
      return DB.byIndex('media', 'studyId', sid);
    },
    apply: vals => {
      const map = { pr: 'pr', np: 'np', im: 'immotile', vcl: 'vcl', vsl: 'vsl',
                    vap: 'vap', lin: 'lin', wob: 'wob', str: 'str' };
      for (const [vk, fk] of Object.entries(map)) {
        const el = $('#f-' + fk);
        if (el) { el.value = vals[vk]; el.dispatchEvent(new Event('input')); }
      }
      toast('Analysis results filled into the study');
    },
  });
  if (typeof Morpho !== 'undefined') Morpho.configure({
    getStudyId: async () => currentSid || await save(),
    apply: vals => {
      const el = $('#f-normalMorph');
      if (el) { el.value = vals.normalMorph; el.dispatchEvent(new Event('input')); }
      toast('Normal morphology % filled into the study');
    },
  });
  if (typeof Annotate !== 'undefined') Annotate.configure({
    getStudyId: async () => currentSid || await save(),
    apply: vals => {
      const el = $('#f-normalMorph'), w = $('#f-wbc');
      if (el && vals.normalMorph != null) { el.value = vals.normalMorph; el.dispatchEvent(new Event('input')); }
      if (w && vals.wbc != null) { w.value = vals.wbc; w.dispatchEvent(new Event('input')); }
      toast('Manual marking results filled into the study');
    },
  });

  const updBadges = () => {
    $$('#app input[data-ref]').forEach(inp => {
      const key = inp.dataset.ref, out = $(`[data-b="${key}"]`);
      if (!key || !out) return;
      const n = parseFloat(inp.value);
      const r = DB.REFERENCES[key];
      if (isNaN(n) || !r) { out.textContent = ''; out.className = 'badge'; return; }
      const bad = (r.low != null && n < r.low) || (r.high != null && n > r.high);
      out.textContent = bad ? 'Abnormal' : 'Normal';
      out.className = 'badge ' + (bad ? 'fail' : 'pass');
    });
  };
  $$('#app input[data-ref]').forEach(i => i.addEventListener('input', updBadges));
  updBadges();

  async function save() {
    const rec = currentSid ? { ...s, patientId: (s && s.patientId != null) ? s.patientId : pid }
                           : { patientId: pid };
    rec.date = $('#f-date').value || today();
    [...PHYS, ...RESULTS, ...DYN].forEach(([k]) => rec[k] = $('#f-' + k).value);
    rec.comment = $('#f-comment').value;

    /* morphology defects + automatic TZI / SDI */
    rec.defects = {};
    let totalDefects = 0;
    for (const [k] of MORPH) {
      const v = parseFloat($('#f-df-' + k).value);
      rec.defects[k] = isNaN(v) ? '' : v;
      if (!isNaN(v)) totalDefects += v;
    }
    const nm = parseFloat(rec.normalMorph);
    if (!isNaN(nm)) {
      const terato = 100 - nm;
      rec.tzi = terato > 0 ? (totalDefects / terato).toFixed(2) : '';
      rec.sdi = (totalDefects / 100).toFixed(2);
      const tziEl = $('#f-tzi'), sdiEl = $('#f-sdi');
      if (tziEl) tziEl.value = rec.tzi;
      if (sdiEl) sdiEl.value = rec.sdi;
    }
    if (!rec.labId) {
      const pp = await DB.get('patients', pid);
      rec.labId = (pp && pp.labId) ? pp.labId : (myLab() === '*' ? 'main' : myLab());
    }

    /* automatic calculations (same logic as E-CASA) */
    const vol = parseFloat(rec.volume), conc = parseFloat(rec.concentration);
    if (!isNaN(vol) && !isNaN(conc)) rec.count = (conc * vol).toFixed(1);
    const pr = parseFloat(rec.pr), np = parseFloat(rec.np);
    if (!isNaN(pr) && !isNaN(np)) rec.motileRatio = String(pr + np);

    const newId = await DB.put('studies', rec);
    currentSid = newId;
    toast('Saved');
    return newId;
  }

  $('#save-s').onclick = async () => { await save(); location.hash = `study/${pid}/${currentSid}`; };
  $('#save-report').onclick = async () => { await save(); location.hash = 'report/' + currentSid; };

  const del = $('#del-s');
  if (del) del.onclick = async () => {
    if (!confirm('Delete this study with all its media permanently?')) return;
    for (const m of await DB.byIndex('media', 'studyId', currentSid)) await DB.del('media', m.id);
    await DB.del('studies', currentSid);
    toast('Deleted');
    location.hash = 'patient/' + pid;
  };
}

/* capture a still frame from a video blob URL for the printed report */
function videoFrame(url) {
  return new Promise(res => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const to = setTimeout(() => { v.removeAttribute('src'); res(null); }, 5000);
    v.onloadeddata = () => {
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 320; c.height = v.videoHeight || 240;
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        clearTimeout(to); res(c.toDataURL('image/jpeg', 0.72));
      } catch (e) { clearTimeout(to); res(null); }
    };
    v.onerror = () => { clearTimeout(to); res(null); };
    v.src = url;
  });
}

/* ---------- page: report ---------- */
async function pageReport(sid) {
  const s = await DB.get('studies', sid);
  if (!s || !sid) { location.hash = 'cases'; return; }
  /* missing patient link: still show the report so the data is never lost */
  const p = (await DB.get('patients', s.patientId)) || { name: 'Unknown patient', code: '-', age: '' };
  if (myLab() !== '*' && (p.labId || 'main') !== myLab()) { location.hash = 'cases'; return; }
  const brand = await brandFor(p.labId ? { labId: p.labId } : s);

  const media = await DB.byIndex('media', 'studyId', sid);
  const imgUrls = media.filter(m => m.kind === 'image').map(m => DB.urlFor(m));
  const videos = media.filter(m => m.kind === 'video');

  $('#print-area').innerHTML = Report.build(p, s, DB.REFERENCES, imgUrls, brand);

  $('#app').innerHTML = `
    <div class="card">
      <div class="row">
        <h2 class="spacer">Report — ${esc(p.name)} (${esc(s.date)})</h2>
        <button class="btn accent" id="print">Print / Save PDF</button>
        <a class="btn ghost" href="#study/${p.id || ''}/${sid}">Edit study</a>
        <a class="btn ghost" href="#patient/${p.id || 'cases'}">Back</a>
      </div>
      <p class="hint">When printing, choose "Save as PDF" — and enable <b>"Background graphics"</b> in the print dialog so the report colors appear.</p>
      ${videos.length ? `<p>Attached videos (${videos.length}) — kept on file; not part of the printed report.</p>` : ''}
      ${imgUrls.length ? `<p>Attached images (${imgUrls.length}) — they appear in the printed report.</p>` : ''}
    </div>
    <div class="card" dir="ltr" style="background:#fff">
      ${Report.build(p, s, DB.REFERENCES, imgUrls, brand)}
    </div>`;

  $('#print').onclick = () => window.print();
}

/* ---------- page: backup ---------- */
async function pageBackup() {
  const [allP, allS, media] = await Promise.all([DB.all('patients'), DB.all('studies'), DB.all('media')]);
  const patients = visible(allP), studies = visible(allS);

  $('#app').innerHTML = `
    <div class="card">
      <h2>Backup</h2>
      <p>Cases: <b>${patients.length}</b> — Studies: <b>${studies.length}</b></p>
      <div class="row">
        <button class="btn accent" id="export">Download JSON backup</button>
        <label class="btn ghost" style="cursor:pointer">Import backup
          <input id="import" type="file" accept="application/json" hidden>
        </label>
        <button class="btn ghost" id="cloudRestore" style="display:none">☁️ Restore from cloud</button>
      </div>
      <p id="cloudInfo" class="hint" style="margin-top:8px"></p>
      <br>
      <p class="hint">Keep the file somewhere safe — it contains patient data and media (it can be large). Importing a backup replaces all current data.</p>
    </div>`;

  if (typeof SYNC !== 'undefined' && SYNC.ready) {
    const btn = $('#cloudRestore'), info = $('#cloudInfo');
    btn.style.display = '';
    btn.onclick = () => SYNC.restoreFromCloud();
    info.textContent = 'Cases and studies sync automatically with Firebase. Media (images/videos) stay on the device and travel through the JSON backup.';
  }

  $('#export').onclick = async () => {
    const mediaOut = await Promise.all(media.map(async m => {
      const dataUrl = await new Promise(res => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(m.blob);
      });
      const { blob, ...rest } = m;
      return { ...rest, dataUrl };
    }));
    const data = { app: 'ecasa-web', version: 2, exportedAt: new Date().toISOString(), patients, studies, media: mediaOut };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ecasa-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup downloaded');
  };

  $('#import').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.patients) || !Array.isArray(data.studies))
        throw new Error('Invalid file');
      if (!confirm(`Import ${data.patients.length} case(s) and ${data.studies.length} study/studies? Current data will be replaced!`)) return;
      await DB.clear('patients');
      await DB.clear('studies');
      await DB.clear('media');
      for (const p of data.patients) await DB.put('patients', p);
      for (const s of data.studies) await DB.put('studies', s);
      for (const m of (data.media || [])) {
        const { dataUrl, ...rest } = m;
        const blob = dataUrl ? await (await fetch(dataUrl)).blob() : new Blob();
        await DB.put('media', { ...rest, blob });
      }
      toast('Imported successfully');
      route();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
}

})();
