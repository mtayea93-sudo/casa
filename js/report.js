/* ===== E-CASA Web — مولّد التقرير (نسخة منقحة — تقرير متعدد الصفحات بروفيسيونال) ===== */
const Report = (() => {

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const num = v => (v === '' || v == null) ? null : parseFloat(v);

  /* أقسام عيوب المورفولوجيا (WHO strict criteria) */
  const DEFECTS = {
    head: [['bigHead','Big Head'],['smallHead','Small head'],['tapered','Tapered head'],
           ['pyriform','Pyriform head'],['round','Round head'],['amorphous','Amorphus head'],
           ['vacuolated','Vacuolated head'],['smallAcrosome','Small akrosome'],['doubleHead','Double head'],
           ['microspermia','Microspermia']],
    neck: [['thinNeck','Thin neck'],['bentNeck','Bent neck'],['thickNeck','Thick / irregular'],
           ['asymmetric','Asymmetric connected']],
    tail: [['bentTail','Bent tail'],['multiTail','Multi tail'],['tailBreakdown','Tail breakdown'],
           ['coiledTail','Coiled tail'],['irregularTail','Irregular tail'],['shortTail','Short tail']],
  };

  /* pass / fail / '' حسب مرجع WHO */
  function status(REF, key, val) {
    const n = num(val);
    if (n == null) return '';
    const r = REF[key];
    if (!r) return '';
    if (r.low  != null && n < r.low)  return 'fail';
    if (r.high != null && n > r.high) return 'fail';
    return 'pass';
  }

  const cellVal = (REF, key, val) => {
    const n = num(val);
    if (n == null) return '';
    const st = status(REF, key, val);
    const cls = st === 'fail' ? 'red' : st === 'pass' ? 'green' : '';
    return `<span class="${cls}"><b>${n.toFixed(2)}</b></span>`;
  };

  const statusCell = (REF, key, val) => {
    const st = status(REF, key, val);
    if (!st) return '';
    return `<b class="${st === 'pass' ? 'green' : 'red'}">${st === 'pass' ? 'PASSED' : 'FAILED'}</b>`;
  };

  function bar(label, pct, color) {
    const h = Math.max(2, Math.round(Math.min(100, pct || 0) * 1.2));
    return `<div class="rbar"><b>${pct == null ? '' : pct + ' %'}</b>
      <i style="height:${h}px;background:${color};border-color:#333"></i><span>(${label})</span></div>`;
  }

  const defectBox = (title, rows, d) => `
    <div style="border:1.5px solid #000;border-radius:10px;padding:8px 14px;min-width:240px;flex:1">
      <h4 class="sec" style="margin:2px 0 6px">${title}</h4>
      ${rows.map(([k, label]) => `<div style="display:flex;justify-content:space-between;gap:18px;padding:1px 0"><span>${label}</span><b>${num(d[k]) != null ? num(d[k]).toFixed(2) : '0'}</b></div>`).join('')}
    </div>`;

  function build(p, s, REF, images = [], brand = null) {
    const pr = num(s.pr), np = num(s.np), im = num(s.immotile);
    const conc = num(s.concentration), count = num(s.count);
    const labName = (brand && brand.name) || 'MT CASA';
    const d = s.defects || {};
    const hasDefects = Object.values(d).some(v => num(v) != null && num(v) > 0);
    const normal = num(s.normalMorph);
    const terato = normal != null ? 100 - normal : null;

    /* الحكم العام حسب مرجع WHO */
    const fails = ['concentration', 'count', 'pr', 'normal'].filter(k => status(REF, k, s[k]) === 'fail');
    const verdict = fails.length
      ? `<div style="border:2px solid #e01f26;border-radius:10px;padding:8px 14px;margin:10px 0;background:#fdecec">
           <b class="red" style="font-size:15px">⚠ Outside WHO reference limits</b>
           <span style="color:#333"> — ${fails.length} parameter(s) below reference: ${fails.map(k => esc(REF[k].label)).join(', ')}</span>
         </div>`
      : `<div style="border:2px solid #12a03c;border-radius:10px;padding:8px 14px;margin:10px 0;background:#eafbee">
           <b class="green" style="font-size:15px">✔ Within WHO reference limits</b>
           <span style="color:#333"> — all measured parameters meet the WHO lower reference limits.</span>
         </div>`;

    /* الترويسة اللي بتتكرر في كل صفحة */
    const headImg = (brand && brand.header) ? `<img src="${brand.header}" class="rp-headimg">` : '';
    const pageHead = pg => `
      ${headImg}
      <div class="rp-head">
        ${brand && brand.logo ? `<img src="${brand.logo}" class="rp-logo">` : ''}
        <div class="rp-title">
          <h1>Computer Assisted Semen Analysis ( ${esc(labName)} )</h1>
          <div class="rp-case">
            <span><b>Case Info.:</b> &lt;${esc(p.code)}&gt; ${esc(p.name)}</span>
            <span><b>DOB \ Age:</b> ${esc(p.age)}</span>
            <span><b>Study Date:</b> ${esc(s.date)}</span>
            ${p.refDoctor ? `<span><b>Ref.:</b> ${esc(p.refDoctor)}</span>` : ''}
          </div>
        </div>
        <div class="rp-pg">${pg}</div>
      </div>`;

    const physRow = (label, inner) => `<div><b>${label}:</b><span>${inner}</span></div>`;

    const resultRow = (key, val, label, refText) => `
      <tr>
        <td style="text-align:left">${esc(label || (key && REF[key] ? REF[key].label : ''))} :</td>
        <td class="res">${cellVal(REF, key, val)}</td>
        <td>${statusCell(REF, key, val)}</td>
        <td>${esc(refText || (REF[key] ? REF[key].ref : ''))}</td>
      </tr>`;

    const dyn1Row = (label, pct) => {
      const n = num(pct);
      const c = (n != null && conc != null) ? (n / 100 * conc).toFixed(2) : '';
      const t = (n != null && count != null) ? (n / 100 * count).toFixed(2) : '';
      return `<tr><td style="text-align:left">${label}</td><td>${n == null ? '' : n.toFixed(2)}</td><td>${c}</td><td>${t}</td></tr>`;
    };

    /* ---------- الصفحة 1: النتائج الأساسية ---------- */
    const page1 = `
    <div class="rpage">
      ${pageHead('1 / 4')}
      <p class="who">The system follows WHO strict criteria for motility patterns &amp; morphometric assessment of human semen.</p>
      ${verdict}
      <div class="flex">
        <div class="phys">
          <h4 class="sec">Physical properties</h4>
          ${physRow('Volume (ml)',       cellVal(REF, 'volume', s.volume))}
          ${physRow('PH',                cellVal(REF, 'ph', s.ph))}
          ${physRow('Color',             esc(s.color || ''))}
          ${physRow('Odor',              esc(s.odor || ''))}
          ${physRow('Viscosity',         esc(s.viscosity || ''))}
          ${physRow('Liquefaction time', esc(s.liquefactionTime || ''))}
          ${physRow('Liquefaction state',esc(s.liquefactionState || ''))}
          ${physRow('Abst. days',        esc(s.abstDays || ''))}
          ${physRow('Agglutination',     esc(s.agglutination || ''))}
        </div>
        <div class="report-bars">
          ${bar('PR', pr, '#12a03c')}
          ${bar('NP', np, '#ffd400')}
          ${bar('Immotile', im, '#e01f26')}
        </div>
      </div>

      <h4 class="sec">Test Results</h4>
      <table>
        <tr><th style="text-align:left">Parameter</th><th>Result</th><th>Status</th><th>Reference</th></tr>
        ${resultRow('concentration', s.concentration)}
        ${resultRow('count', s.count)}
        ${resultRow('pr', s.pr)}
        ${resultRow('motile', s.motileRatio)}
        ${resultRow('normal', s.normalMorph)}
        ${resultRow('tzi', s.tzi)}
        ${resultRow(null, s.sdi, 'Sperm Deformity Index (SDI)', '')}
      </table>

      <h4 class="sec">Cells other than sperms</h4>
      <table>
        ${resultRow('wbc', s.wbc, 'White blood cells')}
        ${resultRow('rbc', s.rbc, 'Red blood cells')}
        ${resultRow(null, s.spermatogenicCells, 'Spermatogenic cells', '/ H.P.F')}
      </table>

      ${s.comment && String(s.comment).trim() ? `
      <h4 class="sec">Comment</h4>
      <p style="border:1px solid #333;border-radius:8px;padding:10px;min-height:50px;margin-bottom:0">${esc(s.comment)}</p>` : ''}
    </div>`;

    /* ---------- الصفحة 2: الديناميك ---------- */
    const page2 = (pr != null || np != null || im != null || num(s.vcl) != null) ? `
    <div class="rpage">
      ${pageHead('2 / 4')}
      ${(pr != null || np != null || im != null) ? `
      <h4 class="sec">Dynamic Parameters Report (I)</h4>
      <table>
        <tr><th style="text-align:left">Classification</th><th>Percentage (%)</th><th>Conc. (million/ml)</th><th>Total (million)</th></tr>
        ${dyn1Row('Progressive Motility', pr)}
        ${dyn1Row('Non-progressive', np)}
        ${dyn1Row('Motile Ratio', num(s.motileRatio))}
        ${dyn1Row('Immotile', im)}
      </table>
      <p class="note">* Progressive motility (PR): spermatozoa moving actively, either linearly or in a large circle, regardless of speed.<br>
      * Non-progressive motility (NP): all other patterns of motility with an absence of progression, i.e. swimming in small circles, the flagellar force hardly displacing the head, or when only a flagellar beat can be observed.<br>
      * Immotile (IM): no movement.</p>` : ''}

      ${num(s.vcl) != null ? `
      <h4 class="sec">Dynamic Parameters Report (II)</h4>
      <table>
        <tr><th>VCL</th><td>${num(s.vcl).toFixed(2)}</td><th>LIN</th><td>${num(s.lin) != null ? num(s.lin).toFixed(2) : ''}</td></tr>
        <tr><th>VSL</th><td>${num(s.vsl).toFixed(2)}</td><th>WOB</th><td>${num(s.wob) != null ? num(s.wob).toFixed(2) : ''}</td></tr>
        <tr><th>VAP</th><td>${num(s.vap).toFixed(2)}</td><th>STR</th><td>${num(s.str) != null ? num(s.str).toFixed(2) : ''}</td></tr>
      </table>
      <div class="flex" style="margin-top:8px">
        <p class="note" style="margin:0">VCL: Curvilinear velocity<br>VSL: Straight line velocity<br>VAP: Average path velocity<br>LIN: Linearity (VSL/VCL)<br>WOB: Wobble (VAP/VCL)<br>STR: Straightness (VSL/VAP)</p>
        <img src="assets/path-diagram.png" style="max-width:360px;border:1px solid #333;border-radius:6px">
      </div>` : ''}
    </div>` : '';

    /* ---------- الصفحة 3: المورفولوجي ---------- */
    const page3 = (normal != null || hasDefects) ? `
    <div class="rpage">
      ${pageHead('3 / 4')}
      <h4 class="sec" style="text-align:center;font-size:18px">Morphology Analysis Report (CASA - WHO)</h4>
      <div style="display:flex;gap:30px;margin-bottom:8px">
        <div><b>Normal Sperms (Morphology Index):</b> ${normal != null ? normal.toFixed(2) : ''}</div>
        <div><b>Terato Sperms:</b> ${terato != null ? terato.toFixed(0) : ''}</div>
      </div>
      <div class="flex" style="gap:14px;align-items:flex-start">
        <div style="flex:1;min-width:250px;display:flex;flex-direction:column;gap:10px">
          ${defectBox('A. Head Abnormality :', DEFECTS.head, d)}
          ${defectBox('B. Neck &amp; Midpiece Abnormality :', DEFECTS.neck, d)}
        </div>
        <div style="flex:1;min-width:250px;display:flex;flex-direction:column;gap:10px">
          ${defectBox('C. Tail Abnormality :', DEFECTS.tail, d)}
          <div style="border:1.5px solid #000;border-radius:10px;padding:8px 14px">
            <h4 class="sec" style="margin:2px 0 6px">D. Excess Residual Cytoplasm (E.R.C.) :</h4>
            <div style="border:1.5px solid #000;border-radius:999px;padding:4px 14px;display:flex;justify-content:space-between"><span>E.R.C.</span><b>${num(d.erc) != null ? num(d.erc).toFixed(2) : '0'}</b></div>
            <div style="margin-top:10px;display:flex;gap:14px;align-items:baseline"><b style="font-size:16px">TZI</b><b>${num(s.tzi) != null ? num(s.tzi).toFixed(2) : ''}</b></div>
            <p class="note" style="margin:2px 0 8px">TeratoZoospermic Index (TZI): Total number of defects divided by the number of abnormal sperms.</p>
            <div style="display:flex;gap:14px;align-items:baseline"><b style="font-size:16px">SDI</b><b>${num(s.sdi) != null ? num(s.sdi).toFixed(2) : ''}</b></div>
            <p class="note" style="margin:2px 0 0">Sperm Deformity Index (SDI): Total number of defects divided by the number of sperms counted.</p>
          </div>
        </div>
      </div>
      <img src="assets/defects-diagram.png" style="width:100%;max-width:900px;border:1px solid #333;border-radius:6px;margin-top:8px">
    </div>` : '';

    /* ---------- الصفحة 4: الصور ---------- */
    const page4 = (images || []).length ? `
    <div class="rpage">
      ${pageHead('4 / 4')}
      <h4 class="sec">Morphology Pictures</h4>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${images.slice(0, 6).map(u => `<img src="${u}" style="width:31%;flex-grow:1;min-width:150px;height:180px;object-fit:cover;border:1px solid #333;border-radius:6px">`).join('')}
      </div>
    </div>` : '';

    const wm = (brand && brand.logo) ? `<div class="rp-wm"><img src="${brand.logo}"></div>` : '';
    const footImg = (brand && brand.footer) ? `<img src="${brand.footer}" class="rp-footimg">` : '';
    const pages = [page1, page2, page3, page4].filter(Boolean);
    const total = pages.length;
    return `
    <div class="report">
      ${pages.map((pgh, i) => pgh
        .replace(/\d+ \/ 4/, (i + 1) + ' / ' + total)
        .replace('<div class="rpage">', '<div class="rpage">' + wm)).join('')}
      ${footImg}
    </div>`;
  }

  return { build, DEFECTS };
})();
