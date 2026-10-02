/* ===== E-CASA Web — التحليل الآلي للمورفولوجي (v4) =====
   كشف رأس الحيوان + قياس الأبعاد (µm) + نسبة الأكرازوم + تصنيف طبيعي/شاذ
   نفس فكرة معايرة النظام الأصلي (mr_area / mr_error_factor / mr_akrosome)
*/
const Morpho = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let cfg = { getStudyId: null, apply: null };
  function configure(c) { cfg = { ...cfg, ...c }; }

  /* ================= رياضيات التصنيف (Pure) ================= */
  /* قياسات رأس واحد من إهليج (µm) + نسبة الأكرازوم */
  function classifyHead(m, o) {
    const areaOK = m.areaPx >= o.normalArea * (1 - o.err) &&
                   m.areaPx <= o.normalArea * (1 + o.err);
    const aspect = m.widthPx > 0 ? m.lengthPx / m.widthPx : 0;
    const aspectOK = aspect >= o.aspMin && aspect <= o.aspMax;
    const akoOK = m.akrosome >= o.akoMin && m.akrosome <= o.akoMax;
    return { areaOK, aspect, aspectOK, akoOK, normal: areaOK && aspectOK && akoOK };
  }

  function aggregateHeads(heads, o, umPerPx) {
    if (!heads.length) return { total: 0, normalPct: 0, abnormalPct: 0, len: 0, wid: 0, ako: 0 };
    let n = 0, len = 0, wid = 0, ako = 0;
    for (const h of heads) {
      const c = classifyHead(h, o);
      if (c.normal) n++;
      len += h.lengthPx; wid += h.widthPx; ako += h.akrosome;
    }
    const r2 = v => +v.toFixed(2);
    return {
      total: heads.length,
      normalPct: Math.round(n / heads.length * 100),
      abnormalPct: Math.round((heads.length - n) / heads.length * 100),
      len: r2(len / heads.length * umPerPx),
      wid: r2(wid / heads.length * umPerPx),
      ako: r2(ako / heads.length * 100),
    };
  }

  /* ================= كشف الرؤوس في الصورة ================= */
  function detectHeads(cv, canvas, opts) {
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const bin = new cv.Mat();
    /* الرؤوس المصبوغة أغمق من الخلفية — threshold معكوس */
    cv.threshold(gray, bin, opts.thresh, 255, cv.THRESH_BINARY_INV);
    const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, k);
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k);
    const contours = new cv.MatVector();
    const hier = new cv.Mat();
    cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const heads = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const areaPx = cv.contourArea(cnt);
      if (areaPx < opts.minArea || areaPx > opts.maxArea) { cnt.delete(); continue; }
      if (cnt.rows < 5) { cnt.delete(); continue; }           // fitEllipse محتاج 5 نقط على الأقل
      const ell = cv.fitEllipse(cnt);
      const lengthPx = Math.max(ell.size.width, ell.size.height);
      const widthPx  = Math.min(ell.size.width, ell.size.height);
      if (widthPx < 2) { cnt.delete(); continue; }

      /* الأكرازوم: البيكسلات الأفتح جوه الرأس (صبغة أخف) */
      const headMask = new cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
      const one = new cv.MatVector();
      one.push_back(cnt);
      cv.drawContours(headMask, one, 0, new cv.Scalar(255), -1);
      const mean = cv.mean(gray, headMask)[0];
      const bright = new cv.Mat();
      cv.threshold(gray, bright, mean * opts.akoBright, 255, cv.THRESH_BINARY);
      const ako = new cv.Mat();
      cv.bitwise_and(bright, headMask, ako);
      const akrosome = areaPx > 0 ? cv.countNonZero(ako) / areaPx : 0;

      heads.push({
        cx: ell.center.x, cy: ell.center.y,
        lengthPx, widthPx, areaPx,
        angle: ell.angle, akrosome,
      });

      ako.delete(); bright.delete(); headMask.delete(); one.delete();
      cnt.delete();
    }
    contours.delete(); hier.delete(); bin.delete(); gray.delete(); src.delete(); k.delete();
    return heads;
  }

  /* رسم النتايج على الـ canvas */
  function drawHeads(ctx2d, heads, opts) {
    ctx2d.lineWidth = 2;
    for (const h of heads) {
      const c = classifyHead(h, opts);
      ctx2d.strokeStyle = c.normal ? '#1a9c3c' : '#e01f26';
      ctx2d.beginPath();
      ctx2d.ellipse(h.cx, h.cy, h.lengthPx / 2, h.widthPx / 2, h.angle * Math.PI / 180, 0, 7);
      ctx2d.stroke();
      /* علامة زرقاء صغيرة لو الأكرازوم خارج المعدل */
      if (!c.akoOK) {
        ctx2d.strokeStyle = '#247ecb';
        ctx2d.beginPath();
        ctx2d.arc(h.cx, h.cy, 3, 0, 7);
        ctx2d.stroke();
      }
    }
  }

  /* ================= نافذة التحليل ================= */
  let cancelFlag = false;

  function closeModal() {
    cancelFlag = true;
    const m = $('#morph-modal');
    if (m) m.remove();
  }

  function loadOpenCv() {
    /* محمي من التحميل المزدوج: Motility و Morphology بيشاركوا نفس الوعد */
    if (window.__cvReady) return window.__cvReady;
    window.__cvReady = new Promise((res, rej) => {
      if (window.cv && window.cv.Mat) return res();
      const s = document.createElement('script');
      s.src = 'https://docs.opencv.org/4.8.0/opencv.js';
      s.onload = () => {
        const wait = () => (window.cv && window.cv.Mat) ? res() : setTimeout(wait, 120);
        wait();
      };
      s.onerror = () => { window.__cvReady = null; rej(new Error('Could not load the analysis engine — internet needed the first time')); };
      document.body.appendChild(s);
    });
    return window.__cvReady;
  }

  function open(media) {
    closeModal();
    cancelFlag = false;
    const umDefault = localStorage.getItem('ecasa-umpx') || '0.30';

    const ov = document.createElement('div');
    ov.className = 'ana-overlay';
    ov.id = 'morph-modal';
    ov.innerHTML = `
      <div class="ana-modal">
        <div class="row">
          <h2 class="spacer">Automatic morphology — ${esc(media.name)}</h2>
          <button class="btn small ghost" id="morph-close">Close ✖</button>
        </div>

        <div class="card" style="box-shadow:none">
          <h3>Calibration & classification settings</h3>
          <div class="ana-grid">
            <label class="f"><span>µm per pixel *</span><input id="mo-um" type="number" step="0.001" value="${umDefault}"></label>
            <label class="f"><span>Normal head area (px²)</span><input id="mo-area" type="number" value="3456"></label>
            <label class="f"><span>Error margin (%)</span><input id="mo-err" type="number" value="30"></label>
            <label class="f"><span>Separation threshold (0-255)</span><input id="mo-thresh" type="number" value="140"></label>
            <label class="f"><span>Min area (px²)</span><input id="mo-min" type="number" value="120"></label>
            <label class="f"><span>Max area (px²)</span><input id="mo-max" type="number" value="8000"></label>
            <label class="f"><span>Length/width ratio from</span><input id="mo-aspmin" type="number" step="0.05" value="1.30"></label>
            <label class="f"><span>Length/width ratio to</span><input id="mo-aspmax" type="number" step="0.05" value="2.10"></label>
            <label class="f"><span>Acrosome sensitivity (×mean brightness)</span><input id="mo-akob" type="number" step="0.01" value="1.12"></label>
            <label class="f"><span>Acrosome % from</span><input id="mo-akomin" type="number" value="30"></label>
            <label class="f"><span>Acrosome % to</span><input id="mo-akomax" type="number" value="70"></label>
          </div>
          <p class="hint" style="margin-top:8px">Defaults come from the original system's calibration: normal head area 3456 px² (at 720×480) with 30% error margin — adjust them for your stain and microscope calibration. Blue = acrosome out of range.</p>
          <br>
          <div class="row">
            <button class="btn accent" id="mo-run">Start analysis</button>
            <span id="mo-status" class="gray"></span>
          </div>
        </div>

        <div class="card" style="box-shadow:none" id="mo-preview-card" hidden>
          <canvas id="mo-canvas" width="720" height="480"></canvas>
          <div class="row" style="margin-top:6px;font-size:13px">
            <span style="color:#1a9c3c">■ Normal</span>
            <span style="color:#e01f26">■ Abnormal</span>
            <span style="color:#247ecb">● blue dot = acrosome out of range</span>
          </div>
        </div>

        <div class="card" style="box-shadow:none" id="mo-results" hidden></div>
      </div>`;
    document.body.appendChild(ov);

    $('#morph-close').onclick = closeModal;
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });

    $('#mo-run').onclick = async () => {
      const opts = {
        um:    parseFloat($('#mo-um').value)     || 0.30,
        normalArea: parseFloat($('#mo-area').value) || 3456,
        err:   (parseFloat($('#mo-err').value) || 30) / 100,
        thresh: parseInt($('#mo-thresh').value)  || 140,
        minArea: parseInt($('#mo-min').value)    || 120,
        maxArea: parseInt($('#mo-max').value)    || 8000,
        aspMin: parseFloat($('#mo-aspmin').value) || 1.30,
        aspMax: parseFloat($('#mo-aspmax').value) || 2.10,
        akoBright: parseFloat($('#mo-akob').value) || 1.12,
        akoMin: (parseFloat($('#mo-akomin').value) || 30) / 100,
        akoMax: (parseFloat($('#mo-akomax').value) || 70) / 100,
      };
      localStorage.setItem('ecasa-umpx', String(opts.um));
      try {
        await loadOpenCv();
        await run(media, opts);
      } catch (e) {
        $('#mo-status').textContent = 'خطأ: ' + e.message;
      }
    };
  }

  /* ================= التشغيل ================= */
  async function run(media, opts) {
    cancelFlag = false;
    $('#mo-results').hidden = true;
    $('#mo-preview-card').hidden = false;
    const statusEl = $('#mo-status');
    const runBtn = $('#mo-run');
    runBtn.disabled = true;

    const url = URL.createObjectURL(media.blob);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not open the image')); img.src = url; });

    const canvas = $('#mo-canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx2d = canvas.getContext('2d');
    ctx2d.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    statusEl.textContent = 'Detecting heads…';
    let heads = [];
    try {
      heads = detectHeads(window.cv, canvas, opts);
    } finally {
      runBtn.disabled = false;
    }

    drawHeads(ctx2d, heads, opts);
    const res = aggregateHeads(heads, opts, opts.um);
    statusEl.textContent = res.total
      ? `Done — ${res.total} heads detected (${res.normalPct}% normal)`
      : 'No heads found — try adjusting the separation threshold or area ranges';

    const R = $('#mo-results');
    R.hidden = false;
    R.innerHTML = res.total ? `
      <h3>Results</h3>
      <table>
        <thead><tr><th>Total heads</th><th>Normal %</th><th>Abnormal %</th><th>Mean length µm</th><th>Mean width µm</th><th>Mean acrosome %</th></tr></thead>
        <tbody><tr>
          <td><b>${res.total}</b></td>
          <td class="green"><b>${res.normalPct}</b></td>
          <td class="red"><b>${res.abnormalPct}</b></td>
          <td>${res.len}</td><td>${res.wid}</td><td>${res.ako}</td>
        </tr></tbody>
      </table>
      <p class="gray" style="font-size:13px">Review the annotated image before confirming — automatic classification needs to match your stain's calibration (adjust threshold/areas/acrosome if needed).</p>
      <br>
      <button class="btn accent" id="mo-apply">Fill “Normal morphology %” into the study</button>`
      : `<p class="hint">Try: lowering the separation threshold (e.g. 120) or widening the area ranges — depending on your image brightness.</p>`;

    const ap = $('#mo-apply');
    if (ap) ap.onclick = async () => {
      if (cfg.getStudyId) await cfg.getStudyId();
      if (cfg.apply) cfg.apply({ normalMorph: res.normalPct });
      closeModal();
    };
  }

  /* ---------- تحليل جماعي: كل صور الدراسة + متوسط موزون واحد ---------- */
  function openBatch(medias) {
    closeModal();
    cancelFlag = false;
    const umDefault = localStorage.getItem('ecasa-umpx') || '0.30';

    const ov = document.createElement('div');
    ov.className = 'ana-overlay';
    ov.id = 'morph-modal';
    ov.innerHTML = `
      <div class="ana-modal">
        <div class="row">
          <h2 class="spacer">Batch morphology — ${medias.length} image(s)</h2>
          <button class="btn small ghost" id="mob-close">Close ✖</button>
        </div>

        <div class="card" style="box-shadow:none">
          <h3>Calibration & classification settings</h3>
          <div class="ana-grid">
            <label class="f"><span>µm per pixel *</span><input id="mo-um" type="number" step="0.001" value="${umDefault}"></label>
            <label class="f"><span>Normal head area (px²)</span><input id="mo-area" type="number" value="3456"></label>
            <label class="f"><span>Error margin (%)</span><input id="mo-err" type="number" value="30"></label>
            <label class="f"><span>Separation threshold (0-255)</span><input id="mo-thresh" type="number" value="140"></label>
            <label class="f"><span>Min area (px²)</span><input id="mo-min" type="number" value="120"></label>
            <label class="f"><span>Max area (px²)</span><input id="mo-max" type="number" value="8000"></label>
            <label class="f"><span>Length/width ratio from</span><input id="mo-aspmin" type="number" step="0.05" value="1.30"></label>
            <label class="f"><span>Length/width ratio to</span><input id="mo-aspmax" type="number" step="0.05" value="2.10"></label>
            <label class="f"><span>Acrosome sensitivity (×mean brightness)</span><input id="mo-akob" type="number" step="0.01" value="1.12"></label>
            <label class="f"><span>Acrosome % from</span><input id="mo-akomin" type="number" value="30"></label>
            <label class="f"><span>Acrosome % to</span><input id="mo-akomax" type="number" value="70"></label>
          </div>
          <br>
          <div class="row">
            <button class="btn accent" id="mo-runall">Analyze all images (${medias.length})</button>
            <span id="mo-status" class="gray"></span>
          </div>
        </div>

        <div class="card" style="box-shadow:none" id="mo-results" hidden></div>
      </div>`;
    document.body.appendChild(ov);

    $('#mob-close').onclick = closeModal;
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });

    $('#mo-runall').onclick = async () => {
      const opts = {
        um:    parseFloat($('#mo-um').value)     || 0.30,
        normalArea: parseFloat($('#mo-area').value) || 3456,
        err:   (parseFloat($('#mo-err').value) || 30) / 100,
        thresh: parseInt($('#mo-thresh').value)  || 140,
        minArea: parseInt($('#mo-min').value)    || 120,
        maxArea: parseInt($('#mo-max').value)    || 8000,
        aspMin: parseFloat($('#mo-aspmin').value) || 1.30,
        aspMax: parseFloat($('#mo-aspmax').value) || 2.10,
        akoBright: parseFloat($('#mo-akob').value) || 1.12,
        akoMin: (parseFloat($('#mo-akomin').value) || 30) / 100,
        akoMax: (parseFloat($('#mo-akomax').value) || 70) / 100,
      };
      localStorage.setItem('ecasa-umpx', String(opts.um));
      const statusEl = $('#mo-status');
      const runBtn = $('#mo-runall');
      runBtn.disabled = true;
      cancelFlag = false;
      try {
        await loadOpenCv();
        const allHeads = [];
        const perImage = [];
        for (let i = 0; i < medias.length; i++) {
          if (cancelFlag) break;
          statusEl.textContent = `Image ${i + 1}/${medias.length}: ${medias[i].name}`;
          const url = URL.createObjectURL(medias[i].blob);
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not open ' + medias[i].name)); img.src = url; });
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          const heads = detectHeads(window.cv, c, opts);
          allHeads.push(...heads);
          perImage.push({ name: medias[i].name, total: heads.length,
            normalPct: heads.length ? Math.round(heads.filter(h => classifyHead(h, opts).normal).length / heads.length * 100) : 0 });
        }
        const res = aggregateHeads(allHeads, opts, opts.um);
        statusEl.textContent = res.total
          ? `Done — ${res.total} heads across ${perImage.length} image(s) (${res.normalPct}% normal)`
          : 'No heads found — try adjusting the separation threshold or area ranges';
        const rows = perImage.map(x =>
          `<tr><td>${esc(x.name)}</td><td>${x.total}</td><td>${x.normalPct}%</td></tr>`).join('');
        const R = $('#mo-results');
        R.hidden = false;
        R.innerHTML = res.total ? `
          <h3>Final result (all images combined)</h3>
          <table>
            <thead><tr><th>Total heads</th><th>Normal %</th><th>Abnormal %</th><th>Mean length µm</th><th>Mean width µm</th><th>Mean acrosome %</th></tr></thead>
            <tbody><tr>
              <td><b>${res.total}</b></td>
              <td class="green"><b>${res.normalPct}</b></td>
              <td class="red"><b>${res.abnormalPct}</b></td>
              <td>${res.len}</td><td>${res.wid}</td><td>${res.ako}</td>
            </tr></tbody>
          </table>
          <h4 style="margin:12px 0 6px">Per-image breakdown</h4>
          <table>
            <thead><tr><th style="text-align:left">Image</th><th>Heads</th><th>Normal</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <br>
          <button class="btn accent" id="mo-apply">Fill “Normal morphology %” into the study</button>` :
          `<p class="hint">Try: lowering the separation threshold (e.g. 120) or widening the area ranges — depending on your image brightness.</p>`;
        const ap = $('#mo-apply');
        if (ap) ap.onclick = async () => {
          if (cfg.getStudyId) await cfg.getStudyId();
          if (cfg.apply) cfg.apply({ normalMorph: res.normalPct });
          closeModal();
        };
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
      } finally {
        runBtn.disabled = false;
      }
    };
  }

  return { configure, open, openBatch, close: closeModal, _t: { classifyHead, aggregateHeads } };
})();
