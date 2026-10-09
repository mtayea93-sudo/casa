/* ===== CSL Bridge — ربط CASA بنظام CSL =====
   أي حالة Semen Analysis تتسجل هنا بتتبعت فوراً لنفس المعمل في CSL
   (قسم «المعمل» — labops) كزيارة جاهزة للطباعة مع تقريرها. */
window.CSLBridge = (function () {
  const CFG = {
    apiKey: "AIzaSyAcLAL-3zzx4biBn97QqBiaWS4MU7Cf3E",
    authDomain: "lab-inventory-b2f6e.firebaseapp.com",
    projectId: "lab-inventory-b2f6e",
    storageBucket: "lab-inventory-b2f6e.firebasestorage.app",
    messagingSenderId: "694689884198",
    appId: "1:694689884198:web:e8919388ce0041a8d11ee7"
  };
  const PROFILE_ID = 9900001, TEST_ID = 9900001;
  let db = null, authedFor = null, busy = null;

  function fb() {
    let app = firebase.apps.find(a => a.name === 'csl-bridge');
    if (!app) app = firebase.initializeApp(CFG, 'csl-bridge');
    db = firebase.firestore(app);
    return firebase.auth(app);
  }
  const mailFor = id => ('csl_' + String(id).replace(/[^a-z0-9]/gi, '_') + '@csl-app.web.app').toLowerCase();

  async function auth(labId, code) {
    const A = fb();
    if (authedFor === labId && A.currentUser) return;
    const email = mailFor(labId);
    try { await A.signInWithEmailAndPassword(email, code); }
    catch (e) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' || e.code === 'auth/invalid-login-credentials') {
        await A.createUserWithEmailAndPassword(email, code);
      } else if (e.code === 'auth/wrong-password') {
        throw new Error('كود تفعيل CSL اتغيّر — حدّث الربط من لوحة تحكم CASA');
      } else throw e;
    }
    authedFor = labId;
  }

  function ensureProfile(DBc) {
    DBc.yset = DBc.yset || { profiles: {}, tests: {}, samples: {}, pdetails: {}, ranges: {}, newProfiles: [], newTests: [], delProfiles: [] };
    const y = DBc.yset;
    y.newProfiles = y.newProfiles || []; y.newTests = y.newTests || [];
    y.pdetails = y.pdetails || {}; y.ranges = y.ranges || {};
    if (!y.newProfiles.find(p => p.profile_id === PROFILE_ID))
      y.newProfiles.push({ profile_id: PROFILE_ID, group_id: 1, profile_name: 'CASA Semen Analysis', arabic_name: 'تحليل السائل المنوي — CASA', report_name: 'Semen Analysis (CASA)', price: 0 });
    if (!y.newTests.find(t => t.test_id === TEST_ID))
      y.newTests.push({ test_id: TEST_ID, test_name: 'Semen Analysis Summary', report_name: 'Semen Analysis Summary', unit_code: '' });
    if (y.pdetails[PROFILE_ID] === undefined) y.pdetails[PROFILE_ID] = [TEST_ID];
    if (y.ranges[TEST_ID] === undefined) y.ranges[TEST_ID] = [];
  }

  function summary(st, p) {
    const L = [];
    L.push('Volume: ' + (st.volume || '-') + ' ml');
    L.push('pH: ' + (st.ph || '-'));
    L.push('Concentration: ' + (st.concentration || '-') + ' M/ml');
    L.push('Total count: ' + (st.count || '-') + ' M/ejaculate');
    L.push('Progressive motility (PR): ' + (st.pr || '-') + '%');
    L.push('Total motility: ' + (st.motileRatio || st.motility || '-') + '%');
    L.push('Immotile: ' + (st.immotile || st.im || '-') + '%');
    L.push('Normal morphology: ' + (st.normalMorph || '-') + '%');
    if (st.tzi) L.push('TZI: ' + st.tzi);
    if (st.sdi) L.push('SDI: ' + st.sdi);
    if (st.comment) L.push('Comment: ' + st.comment);
    L.push('— سُجّلت من CASA —');
    return L.join('\n');
  }

  async function pushStudy(studyId) {
    try {
      const st = await DB.get('studies', studyId); if (!st) return;
      const p = await DB.get('patients', st.patientId); if (!p) return;
      let labs = [];
      try { const r = await DB.get('meta', 'labs'); if (r && Array.isArray(r.value)) labs = r.value; } catch (e) {}
      const L = labs.find(x => x.id === (st.labId || p.labId || 'main')) || labs.find(x => x.id === 'main') || labs[0];
      if (!L || !L.csl || !L.csl.labId || !L.csl.code) return; /* المعمل ده مش مربوط بـ CSL */
      if (busy) return; busy = true;
      try {
        await auth(L.csl.labId, L.csl.code);
        const ref = db.collection('csl').doc(L.csl.labId);
        const snap = await ref.get();
        let DBc = {};
        if (snap.exists) { const d = snap.data(); try { DBc = d.dataJson ? JSON.parse(d.dataJson) : (d.data || {}); } catch (e) { DBc = {}; } }
        ensureProfile(DBc);
        DBc.ypatients = DBc.ypatients || []; DBc.yvisits = DBc.yvisits || [];
        DBc.seq = DBc.seq || {};
        const pid = 'casa_p' + p.id;
        if (!DBc.ypatients.find(x => x.id === pid))
          DBc.ypatients.push({ id: pid, code: 'CASA-' + (p.code || p.id), title: 'السيد', name: p.name || '—', gender: 'ذكر', ageY: parseInt(p.age) || 0, ageM: 0, ageD: 0, dob: '', nat: '', nid: '', phone: p.phone || '', addr: '' });
        const vid = 'casa_s' + st.id;
        let v = DBc.yvisits.find(x => x.id === vid);
        if (!v) {
          v = { id: vid, code: 'CASA-' + (p.code || p.id) + '-' + String(st.id).slice(-4), date: st.date || new Date().toISOString().slice(0, 10), time: new Date().toTimeString().slice(0, 5), patientId: pid, profiles: [PROFILE_ID], results: {}, donePids: [PROFILE_ID], gross: 0, disc: 0, paid: 0, referrer: 'CASA', plan: 'أسعار أساسية', src: 'casa' };
          DBc.yvisits.push(v);
        }
        v.results[PROFILE_ID] = { [TEST_ID]: summary(st, p) };
        await ref.set({ dataJson: JSON.stringify(DBc), updatedAt: new Date().toISOString() });
        if (typeof toast === 'function') toast('☁️ الحالة اتبعتت لـ CSL');
      } finally { busy = false; }
    } catch (e) { console.error('CSLBridge:', e); }
  }

  return { pushStudy };
})();
