/* ===== E-CASA Web — مزامنة Firebase Realtime Database =====
   بنفس فلسفة نظام معامل صقر (المُصلحة):
   - الحالات (patients) والدراسات (studies) بتتزامن على السحابة لحظيًا
   - الوسائط (صور/فيديو) محلية فقط — حجمها كبير، بتتنقل بنسخة JSON الاحتياطية
   - أول مزامنة لأي جهاز: السحابة هي اللي تكسب (مستحيل نسخة قديمة تمسح البيانات)
   - مفيش أي عملية كتابة فاضية للسحابة
*/
const SYNC = (() => {
  const FB_CONFIG = {
    apiKey: "AIzaSyA8XG8XyjwRhmrq76oJjCI-Wdh4dTiQkEc",
    authDomain: "casa-mtayea.firebaseapp.com",
    databaseURL: "https://casa-mtayea-default-rtdb.firebaseio.com",
    projectId: "casa-mtayea",
    storageBucket: "casa-mtayea.firebasestorage.app",
    messagingSenderId: "872797782501",
    appId: "1:872797782501:web:f86c79b103f1014511af0c"
  };
  /* كل معمل بيسync على مساره الخاص — عزل كامل للبيانات */
  const myLabId = () => (typeof Login !== 'undefined' && Login.lab) ? Login.lab() : '*';
  const rootFor = lab => (lab && lab !== '*') ? 'ecasa/labs/' + lab : 'ecasa';
  const ROOT = rootFor(myLabId());
  const KEYS = ['patients', 'studies', 'meta'];
  let db = null;
  const state = { ready: false, connected: false, failed: false, authed: false, lastSync: 0, applying: false };

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

  /* مفتاح الحماية: قيمة في سحابة meta تحت key = 'guardKey'.
     أي جهاز مفتاحه المحلي مختلف عن السحابة = داتته مُشتبه فيها (قديمة):
     بيمسح المرضى والدراسات المحلية ويسحب من السحابة — مستحيل يرفع قديم فوق جديد.
     تدوير المفتاح من لوحة التحكم بيجبر كل الأجهزة على إعادة المزامنة. */
  const GUARD_KEY = 'guardKey';
  const guardLocal = () => localStorage.getItem('casa_guard') || '';

  async function guardFromCloud() {
    const snap = await db.ref(ROOT + '/meta').get();
    const v = snap.val();
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
    /* استنى الاتصال لحد 15 ثانية — أحياناً Firebase بياخد وقته في أول تشغيل */
    for (let i = 0; i < 30 && !state.ready; i++) await new Promise(r => setTimeout(r, 500));
    if (!state.ready) throw new Error('Firebase is still starting — check internet and try again');
    const k = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    /* ارفع الحالات والدراسات الحالية للسحابة الأول — دي تبقى النسخة المرجعية */
    for (const kk of ['patients', 'studies']) {
      const d = await DB.all(kk);
      if (Array.isArray(d) && d.length) {
        const clean = kk === 'studies' ? d.filter(r => r && r.patientId !== undefined && r.patientId !== null) : d;
        if (clean.length) { await db.ref(ROOT + '/' + kk).set({ t: Date.now(), d: clean }); mtSet(kk, Date.now()); }
      }
    }
    await DB.put('meta', { key: GUARD_KEY, value: k });
    localStorage.setItem('casa_guard', k);
    await push('meta');
    return k;
  }

  function startDb() {
    if (state.ready) return;
    try {
      db = firebase.database();
      state.ready = true;
      state.authed = true;
      db.ref('.info/connected').on('value', s => {
        state.connected = !!s.val();
        if (s.val()) KEYS.forEach(push); /* أول ما النت يرجع: ارفع أي حاجة فاتت */
        if (typeof netStatus === 'function') netStatus();
      });
      /* فحص المفتاح قبل ما نسمع أي حاجة — عشان قديم محلي مايطلعش للسحابة */
      checkGuard().then(wiped => {
        if (wiped && typeof route === 'function') route();
        KEYS.forEach(listen);
        wrapDb();
        if (wiped) state.lastSync = Date.now();
        /* شبكة أمان: كل 45 ثانية لو متصل ارفع نسخة — أي داتا "مش مسموعة" بتتصلح لوحدها */
        setInterval(() => { if (state.connected && !state.applying) KEYS.forEach(push); }, 45000);
      });
    } catch (e) { state.failed = true; }
  }

  function init() {
    if (typeof firebase === 'undefined') { state.failed = true; return; }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
      /* دخول مجهول تلقائي: القواعد الجديدة بتشترط auth != null.
         على الموبايل الطلب ممكن يفشل مؤقتًا مع نت ضعيف — بنعيد المحاولة 5 مرات */
      /* بنحاول الدخول المجهول للأبد — كل 30 ثانية — لحد ما النت يسمح.
         من غير auth القواعد بترفض كل حاجة، فالاستسلام مش اختيار */
      let tries = 0;
      const tryAuth = () => {
        firebase.auth().signInAnonymously().then(startDb).catch(() => {
          tries++;
          setTimeout(tryAuth, tries < 5 ? 3000 : 30000);
        });
      };
      tryAuth();
    } catch (e) { state.failed = true; }
  }

  /* دخول مجهول مضمون (بإعادات) — بنستخدمه في شاشة الدخول قبل ما التطبيق يفتح */
  function ensureAuth() {
    return new Promise((resolve, reject) => {
      if (typeof firebase === 'undefined') return reject(new Error('Firebase SDK not loaded'));
      try { if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG); } catch (e) {}
      if (firebase.auth().currentUser) return resolve(true);
      let tries = 0;
      const attempt = () => firebase.auth().signInAnonymously()
        .then(() => resolve(true))
        .catch(e => { if (++tries >= 8) reject(e); else setTimeout(attempt, 1500); });
      attempt();
    });
  }

  /* قراءة لقطة من meta بمسار معمل معين (مستخدمة في شاشة الدخول) */
  async function fetchMeta(lab, key) {
    await ensureAuth();
    const snap = await firebase.database().ref(rootFor(lab) + '/meta').get();
    const v = snap.val();
    if (v && typeof v === 'object' && 'd' in v && Array.isArray(v.d)) {
      const rec = v.d.find(r => r && r.key === key);
      return rec ? rec.value : null;
    }
    if (Array.isArray(v)) { const rec = v.find(r => r && r.key === key); return rec ? rec.value : null; }
    return null;
  }

  /* دليل المعامل العام — بيعيش في المسار الرئيسي ومتاح لأي حد متسجل */
  async function fetchLabs() {
    await ensureAuth();
    const arr = await fetchMeta('*', 'labs');
    return Array.isArray(arr) ? arr : [];
  }
  async function fetchAccounts(lab) {
    const arr = await fetchMeta(lab, 'accounts');
    return Array.isArray(arr) ? arr : null;
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
    get authed() { return state.authed; },
    get lastSync() { return state.lastSync; },
    init, push, restoreFromCloud, rotateGuard, ensureAuth, fetchLabs, fetchAccounts,
  };
})();
