/* ===== E-CASA Web — مزامنة Firebase Realtime Database =====
   بنفس فلسفة نظام معامل صقر (المُصلحة):
   - الحالات (patients) والدراسات (studies) بتتزامن على السحابة لحظيًا
   - الوسائط (صور/فيديو) محلية فقط — حجمها كبير، بتتنقل بنسخة JSON الاحتياطية
   - أول مزامنة لأي جهاز: السحابة هي اللي تكسب (مستحيل نسخة قديمة تمسح البيانات)
   - مفيش أي عملية كتابة فاضية للسحابة
*/
const SYNC = (() => {
  const FB_CONFIG = {
    apiKey: "AIzaSyAPawpCwihRHOaPjMzhhcsSDa9WAy0Qx-Q",
    authDomain: "sakrlab2026.firebaseapp.com",
    databaseURL: "https://sakrlab2026-default-rtdb.firebaseio.com",
    projectId: "sakrlab2026",
    storageBucket: "sakrlab2026.firebasestorage.app",
    messagingSenderId: "1049726811378",
    appId: "1:1049726811378:web:0959efa43bad0f7e24e46b"
  };
  const ROOT = 'sakr/ecasa'; /* تحت مسار sakr المسموح في قواعد Firebase */
  const KEYS = ['patients', 'studies', 'meta'];
  let db = null;
  const state = { ready: false, connected: false, failed: false, lastSync: 0, applying: false };

  const mtGet = k => parseInt(localStorage.getItem('casa_mt_' + k) || '0', 10);
  const mtSet = (k, t) => localStorage.setItem('casa_mt_' + k, String(t));

  /* رفع محتوى مخزن للسحابة */
  async function push(k) {
    if (!state.ready || state.applying) return;
    try {
      let d = await DB.all(k);
      if (!Array.isArray(d)) return;
      if (k === 'studies') d = d.filter(r => r && r.patientId !== undefined && r.patientId !== null);
      if (d.length === 0) return; /* ممنوع نكتب فاضي — بنسيب السحابة زي ما هي */
      await db.ref(ROOT + '/' + k).set({ t: Date.now(), d });
      mtSet(k, Date.now());
      state.lastSync = Date.now();
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
      if (k === 'meta' && typeof Admin !== 'undefined' && Admin.onMetaSynced) Admin.onMetaSynced();
    } finally { state.applying = false; }
  }

  function hasData(a) { return Array.isArray(a) && a.length > 0; }

  function listen(k) {
    if (!localStorage.getItem('casa_mt_' + k)) mtSet(k, 0); /* أول مرة: السحابة تكسب */
    db.ref(ROOT + '/' + k).on('value', async s => {
      const v = s.val();
      const mt = mtGet(k);
      let data = null, valid = false, wrapped = false;
      if (v && typeof v === 'object' && 'd' in v) { data = v.d; wrapped = true; valid = Array.isArray(data); }
      else if (Array.isArray(v)) { data = v; valid = true; }
      if (!valid) {
        /* السحابة فاضية/مش مفهومة: نمسك المحلي ونرفعه لو فيه بيانات */
        const lv = await DB.all(k);
        if (hasData(lv)) { try { await db.ref(ROOT + '/' + k).set({ t: Date.now(), d: lv }); mtSet(k, Date.now()); } catch (e) {} }
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
          if (hasData(lv)) { try { await db.ref(ROOT + '/' + k).set({ t: mt, d: lv }); } catch (e) {} }
        }
      } else {
        await applyCloud(k, data);
        mtSet(k, Date.now());
        try { await db.ref(ROOT + '/' + k).set({ t: Date.now(), d: data }); } catch (e) {}
        if (typeof route === 'function') route();
      }
    });
  }

  function wrapDb() {
    const _put = DB.put.bind(DB), _del = DB.del.bind(DB);
    DB.put = async (n, v) => { const r = await _put(n, v); if (KEYS.includes(n)) push(n); return r; };
    DB.del = async (n, id) => { const r = await _del(n, id); if (KEYS.includes(n)) push(n); return r; };
  }

  function startDb() {
    if (state.ready) return;
    try {
      db = firebase.database();
      state.ready = true;
      db.ref('.info/connected').on('value', s => {
        state.connected = !!s.val();
        if (typeof netStatus === 'function') netStatus();
      });
      KEYS.forEach(listen);
      wrapDb();
    } catch (e) { state.failed = true; }
  }

  function init() {
    if (typeof firebase === 'undefined') { state.failed = true; return; }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
      /* دخول مجهول تلقائي: القواعد الجديدة بتشترط auth != null
         لو ميزة Anonymous لسه مش مفعّلة في الكونسول بنشتغل بدونها مؤقتًا */
      firebase.auth().signInAnonymously()
        .then(startDb)
        .catch(() => startDb());
    } catch (e) { state.failed = true; }
  }

  /* استعادة يدوية: تمسح المحلي ويسحب السحابة (من صفحة النسخ الاحتياطي) */
  async function restoreFromCloud() {
    if (!state.ready) { alert('Firebase is not connected — cannot restore right now'); return; }
    if (!confirm('Cases and studies on this device will be replaced with the cloud copy. Are you sure?')) return;
    KEYS.forEach(k => { localStorage.removeItem('casa_mt_' + k); });
    location.reload();
  }

  return {
    get ready() { return state.ready; },
    get connected() { return state.connected; },
    get failed() { return state.failed; },
    get lastSync() { return state.lastSync; },
    init, push, restoreFromCloud,
  };
})();
