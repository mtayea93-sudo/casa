/* ===== CSL Bridge — ربط CASA بنظام CSL =====
   أي حالة Semen Analysis تتسجل هنا بتتبعت فوراً لنفس المعمل في CSL
   (قسم «المعمل» — labops) كزيارة جاهزة للطباعة مع تقريرها.
   شغال على نفس سحابة CSL (Cloudflare Worker) — من غير Firebase. */
window.CSLBridge = (function () {
  const SYNC_URL = 'https://csl-sync.m-tayea93.workers.dev';
  const CSL_KEY = 'csl-sync-9f31kx7qv2mhmd93';
  const PROFILE_ID = 9900001, TEST_ID = 9900001;
  let busy = null;

  async function reqLab(labId, method, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(SYNC_URL + '/lab/' + encodeURIComponent(labId) + '?key=' + CSL_KEY, {
        method: method || 'GET',
        signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
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
      if (!L || !L.csl || !L.csl.labId) return; /* المعمل ده مش مربوط بـ CSL */
      if (busy) return; busy = true;
      try {
        const doc = await reqLab(L.csl.labId, 'GET');
        let DBc = {};
        if (doc && doc.v && typeof doc.v === 'object') DBc = doc.v;
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
        await reqLab(L.csl.labId, 'PUT', { v: DBc, at: new Date().toISOString() });
        if (typeof toast === 'function') toast('☁️ الحالة اتبعتت لـ CSL');
      } finally { busy = false; }
    } catch (e) { console.error('CSLBridge:', e); }
  }

  return { pushStudy };
})();
