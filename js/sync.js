/* ===== E-CASA Web — مزامنة السحابة الخاصة (Cloudflare Worker) =====
   نفس فلسفة النسخة القديمة بالظبط:
   - الحالات (patients) والدراسات (studies) بتتزامن على السحابة لحظيًا
   - الوسائط (صور/فيديو) محلية فقط — بتتنقل بنسخة JSON الاحتياطية
   - أول مزامنة لأي جهاز: السحابة هي اللي تكسب (مستحيل نسخة قديمة تمسح البيانات)
   - مفيش أي عملية كتابة فاضية للسحابة
   - شغال أونلاين وأوفلاين: اللي يتعمل من غير نت بيتحفظ محليًا وبيترفع لوحده أول ما النت يرجع
*/
const SYNC = (() => {
  const SYNC_URL = 'https://csl-sync.m-tayea93.workers.dev';
  const SYNC_KEY = 'casa-sync-k3m9qf27ahmed2026';
  /* كل معمل بيشتغل على مساره الخاص — عزل كامل للبيانات */
  const myLabId = () => (typeof Login !== 'undefined' && Login.lab) ? Login.lab() : '*';
  const rootFor = lab => (lab && lab !== '*') ? 'labs/' + lab : 'main';
  const docFor = (lab, k) => rootFor(lab) + ':' + k;
  const KEYS = ['patients', 'studies', 'meta'];
  const state = { ready: false, connected: false, failed: false, authed: false, lastSync: 0, applying: false };

  const mtGet = k => parseInt(localStorage.getItem('casa_mt_' + k) || '0', 10);
  const mtSet = (k, t) => localStorage.setItem('casa_mt_' + k, String(t));

  /* طلب واحد للسحابة — أي فشل (نت/timeout) بيرمي استثناء والبيانات محلية وآمنة */
  async function req(doc, method, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(SYNC_URL + '/casa?key=' + SYNC_KEY + '&doc=' + encodeURIComponent(doc), {
        method: method || 'GET',
        signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  /* رفع محتوى مخزن للسحابة */
  async function push(k) {
    if (!state.ready || state.applying) return;
    try {
      let d = await DB.all(k);
      if (!Array.isArray(d)) return;
      if (k === 'studies') d = d.filter(r => r && r.patientId !== undefined && r.patientId !== null);
      if (d.length === 0) return; /* ممنوع نكتب فاضي — بنسيب السحابة زي ما هي */
      await req(docFor(myLabId(), k), 'PUT', { t: Date.now(), d });
      mtSet(k, Date.now());
      state.lastSync = Date.now();
      state.connected = true;
      if (typeof netStatus === 'function') netStatus();
    } catch (e) { /* الشبكة وقعت — البيانات محلية وآمنة */ }
  }

  async function applyCloud(k, data) {
    state.applying = true;
    try {
      /* حارس: دراسة من غير patientId بتكسر التقارير — بنستبعدها من السحابة */
      let clean = data;
      if (k === 'studies') {
        clean = data.filter(r => r && r.patientId !== undefined && r.patientId !== null);
        if (clean.length < data.length)
          console.warn('sync: ignored', data.length - clean.length, 'orphan study record(s)');
      }
      await DB.clear(k);
      for (const rec of clean) await DB.put(k, rec);
      /* لو المفتاح اتدوّر والجهاز شغال: امسح واسحب من السحابة على طول */
      if (k === 'meta') {
        const rec = clean.find(r => r && r.key === GUARD_KEY);
        if (rec && guardLocal() && String(rec.value) !== guardLocal()) {
          localStorage.setItem('casa_guard', String(rec.value));
          for (const kk of ['patients', 'studies']) { mtSet(kk, 0); }
          if (typeof route === 'function') route();
        } else if (rec && !guardLocal()) {
          localStorage.setItem('casa_guard', String(rec.value));
        }
        if (typeof Admin !== 'undefined' && Admin.onMetaSynced) Admin.onMetaSynced();
      }
    } finally { state.applying = false; }
  }

  function hasData(a) { return Array.isArray(a) && a.length > 0; }

  /* سحب مفتاح من السحابة وقرار مين يكسب — نفس منطق المستمع القديم بالظبط */
  async function pull(k) {
    if (state.applying) return;
    try {
      const v = await req(docFor(myLabId(), k), 'GET');
      state.connected = true;
      const mt = mtGet(k);
      let data = null, valid = false, wrapped = false;
      if (v && typeof v === 'object' && 'd' in v) { data = v.d; wrapped = true; valid = Array.isArray(data); }
      else if (Array.isArray(v)) { data = v; valid = true; }
      if (!valid) {
        /* السحابة فاضية/مش مفهومة: نمسك المحلي ونرفعه لو فيه بيانات */
        const lv = await DB.all(k);
        if (hasData(lv)) { try { await req(docFor(myLabId(), k), 'PUT', { t: Date.now(), d: lv }); mtSet(k, Date.now()); state.lastSync = Date.now(); } catch (e) {} }
        return;
      }
      if (wrapped) {
        if (v.t > mt) {
          await applyCloud(k, data);
          mtSet(k, v.t);
          state.lastSync = Date.now();
          if (typeof route === 'function') route();
        } else if (v.t < mt) {
          const lv = await DB.all(k);
          if (hasData(lv)) { try { await req(docFor(myLabId(), k), 'PUT', { t: mt, d: lv }); } catch (e) {} }
        }
      } else {
        await applyCloud(k, data);
        mtSet(k, Date.now());
        try { await req(docFor(myLabId(), k), 'PUT', { t: Date.now(), d: data }); } catch (e) {}
        state.lastSync = Date.now();
        if (typeof route === 'function') route();
      }
    } catch (e) { /* offline */ }
  }

  function wrapDb() {
    const _put = DB.put.bind(DB), _del = DB.del.bind(DB);
    DB.put = async (n, v) => { const r = await _put(n, v); if (KEYS.includes(n)) push(n); return r; };
    DB.del = async (n, id) => { const r = await _del(n, id); if (KEYS.includes(n)) push(n); return r; };
  }

  /* مفتاح الحماية: قيمة في سحابة meta تحت key = 'guardKey'.
     أي جهاز مفتاحه المحلي مختلف عن السحابة = داتته مُشتبه فيها (قديمة):
     بيمسح المرضى والدراسات المحلية ويسحب من السحابة — مستحيل يرفع قديم فوق جديد.
     تدوير المفتاح من لوحة التحكم بيجبر كل الأجهزة على إعادة المزامنة. */
  const GUARD_KEY = 'guardKey';
  const guardLocal = () => localStorage.getItem('casa_guard') || '';

  async function guardFromCloud() {
    const v = await req(docFor(myLabId(), 'meta'), 'GET');
    if (v && typeof v === 'object' && 'd' in v && Array.isArray(v.d)) {
      const rec = v.d.find(r => r && r.key === GUARD_KEY);
      return rec ? String(rec.value) : '';
    }
    return '';
  }

  /* بيرجع true لو حصل مسح ومحتاجين راوت/ريلود */
  async function checkGuard() {
    try {
      const cloud = await guardFromCloud();
      state.connected = true;
      const local = guardLocal();
      if (cloud && cloud !== local) {
        for (const k of ['patients', 'studies']) {
          try { await DB.clear(k); } catch (e) {}
          mtSet(k, 0); /* السحابة تكسب بعد المسح */
        }
        localStorage.setItem('casa_guard', cloud);
        return true;
      }
      if (cloud && !local) localStorage.setItem('casa_guard', cloud);
    } catch (e) {}
    return false;
  }

  /* تدوير المفتاح من لوحة التحكم — الجهاز ده يبقى هو المرجع:
     بيرفع داتته للسحابة الأول، وبعدها كل الأجهزة التانية هتمسح وتسحب من السحابة */
  async function rotateGuard() {
    /* استنى أول اتصال لحد 15 ثانية */
    for (let i = 0; i < 30 && !state.ready; i++) await new Promise(r => setTimeout(r, 500));
    if (!state.ready) throw new Error('Cloud is still starting — check internet and try again');
    const k = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    /* ارفع الحالات والدراسات الحالية للسحابة الأول — دي تبقى النسخة المرجعية */
    for (const kk of ['patients', 'studies']) {
      const d = await DB.all(kk);
      if (Array.isArray(d) && d.length) {
        const clean = kk === 'studies' ? d.filter(r => r && r.patientId !== undefined && r.patientId !== null) : d;
        if (clean.length) { await req(docFor(myLabId(), kk), 'PUT', { t: Date.now(), d: clean }); mtSet(kk, Date.now()); }
      }
    }
    await DB.put('meta', { key: GUARD_KEY, value: k });
    localStorage.setItem('casa_guard', k);
    await push('meta');
    return k;
  }

  function init() {
    if (state.ready) return;
    state.ready = true;
    state.authed = true;
    window.addEventListener('online', () => {
      state.connected = true;
      KEYS.forEach(push); /* أول ما النت يرجع: ارفع أي حاجة فاتت */
      if (typeof netStatus === 'function') netStatus();
    });
    window.addEventListener('offline', () => {
      state.connected = false;
      if (typeof netStatus === 'function') netStatus();
    });
    state.connected = navigator.onLine;
    /* فحص المفتاح قبل أي سحب — عشان قديم محلي مايطلعش للسحابة */
    checkGuard().then(wiped => {
      if (wiped && typeof route === 'function') route();
      KEYS.forEach(k => { if (!localStorage.getItem('casa_mt_' + k)) mtSet(k, 0); }); /* أول مرة: السحابة تكسب */
      wrapDb();
      KEYS.forEach(pull);
      if (wiped) state.lastSync = Date.now();
      /* شبكة أمان: كل 30 ثانية اسحب، وكل 45 ثانية ارفع —
         أي داتا "مش مسموعة" بتتصلح لوحدها في الاتنين */
      setInterval(() => { if (navigator.onLine && !state.applying) KEYS.forEach(pull); }, 30000);
      setInterval(() => { if (navigator.onLine && !state.applying) KEYS.forEach(push); }, 45000);
      if (typeof netStatus === 'function') netStatus();
    });
  }

  /* توافق مع شاشة الدخول — مفيش auth تاني، السحابة بمفتاح سري مدمج */
  function ensureAuth() { return Promise.resolve(true); }

  /* قراءة لقطة من meta بمسار معمل معين (مستخدمة في شاشة الدخول) */
  async function fetchMeta(lab, key) {
    const v = await req(docFor(lab, 'meta'), 'GET');
    if (v && typeof v === 'object' && 'd' in v && Array.isArray(v.d)) {
      const rec = v.d.find(r => r && r.key === key);
      return rec ? rec.value : null;
    }
    if (Array.isArray(v)) { const rec = v.find(r => r && r.key === key); return rec ? rec.value : null; }
    return null;
  }

  /* دليل المعامل العام — بيعيش في المسار الرئيسي ومتاح لأي حد */
  async function fetchLabs() {
    const arr = await fetchMeta('*', 'labs');
    return Array.isArray(arr) ? arr : [];
  }
  async function fetchAccounts(lab) {
    const arr = await fetchMeta(lab, 'accounts');
    return Array.isArray(arr) ? arr : null;
  }

  /* استعادة يدوية: تمسح المحلي ويسحب السحابة (من صفحة النسخ الاحتياطي) */
  async function restoreFromCloud() {
    if (!state.ready) { alert('Cloud is not connected — cannot restore right now'); return; }
    if (!confirm('Cases and studies on this device will be replaced with the cloud copy. Are you sure?')) return;
    KEYS.forEach(k => { localStorage.removeItem('casa_mt_' + k); });
    location.reload();
  }

  return {
    get ready() { return state.ready; },
    get connected() { return state.connected; },
    get failed() { return state.failed; },
    get authed() { return state.authed; },
    get lastSync() { return state.lastSync; },
    init, push, restoreFromCloud, rotateGuard, ensureAuth, fetchLabs, fetchAccounts,
  };
})();
