/* ===== E-CASA Web — التحليل الآلي للحركة (v4) =====
   OpenCV.js (Wasm) — تتبع الحيوانات المنوية + حساب VCL/VSL/VAP/LIN/WOB/STR + تصنيف PR/NP/IM
   - نمطان: أوتوماتيك (تتبع بالفريمات) ومانيوال (إدخال يدوي)
   - تحليل جماعي: كل فيديوهات الدراسة بضغطة واحدة + متوسط موزون
   - تقييم التارجت: مقارنة بالفيديوهات المرجعية المرفوعة من لوحة التحكم
*/
const Motility = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  let cfg = { getStudyId: null, apply: null, getVideos: null };
  function configure(c) { cfg = { ...cfg, ...c }; }

  /* ================= رياضيات التتبع (Pure) ================= */
  function smooth(pts, w) {
    if (pts.length < 3) return pts.slice();
    const out = [], half = Math.floor(w / 2);
    out.push(pts[0]);
    for (let i = 1; i < pts.length - 1; i++) {
      let x = 0, y = 0, n = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(pts.length - 1, i + half); j++) {
        x += pts[j].x; y += pts[j].y; n++;
      }
      out.push({ x: x / n, y: y / n, t: pts[i].t });
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function trackStats(trk, umPerPx) {
    const pts = trk.points;
    if (pts.length < 4) return null;
    const T = pts[pts.length - 1].t - pts[0].t;
    if (T <= 0) return null;
    let path = 0;
    for (let i = 1; i < pts.length; i++) path += dist(pts[i], pts[i - 1]);
    const disp = dist(pts[pts.length - 1], pts[0]);
    const sm = smooth(pts, 5);
    let apath = 0;
    for (let i = 1; i < sm.length; i++) apath += dist(sm[i], sm[i - 1]);
    const vcl = path / T * umPerPx;
    const vsl = disp  / T * umPerPx;
    const vap = apath / T * umPerPx;
    return {
      vcl, vsl, vap,
      lin: vcl ? vsl / vcl : 0,
      wob: vcl ? vap / vcl : 0,
      str: vap ? vsl / vap : 0,
    };
  }

  function classify(st, th) {
    if (st.vcl < th.imVCL) return 'IM';
    if (st.vsl >= th.prVSL) return 'PR';
    return 'NP';
  }

  function aggregate(tracks, umPerPx, th) {
    const cnt = { PR: 0, NP: 0, IM: 0 };
    const vel = [];
    for (const trk of tracks) {
      const st = trackStats(trk, umPerPx);
      if (!st) continue;
      const c = classify(st, th);
      cnt[c]++;
      if (c !== 'IM') vel.push(st);
    }
    const total = cnt.PR + cnt.NP + cnt.IM;
    const avg = k => vel.length ? vel.reduce((a, b) => a + b[k], 0) / vel.length : 0;
    const pct = n => total ? Math.round(n / total * 100) : 0;
    return {
      total,
      pr: pct(cnt.PR), np: pct(cnt.NP), im: pct(cnt.IM),
      vcl: +avg('vcl').toFixed(2), vsl: +avg('vsl').toFixed(2), vap: +avg('vap').toFixed(2),
      lin: +avg('lin').toFixed(2), wob: +avg('wob').toFixed(2), str: +avg('str').toFixed(2),
    };
  }

  /* دمج نتائج فيديوهات متعددة بمتوسط موزون بعدد الحيوانات */
  function mergeResults(list) {
    const wsum = list.reduce((a, r) => a + (r.total || 0), 0) || 1;
    const wavg = k => +(list.reduce((a, r) => a + r[k] * (r.total || 0), 0) / wsum).toFixed(2);
    return {
      total: list.reduce((a, r) => a + (r.total || 0), 0),
      pr: Math.round(list.reduce((a, r) => a + r.pr * (r.total || 0), 0) / wsum),
      np: Math.round(list.reduce((a, r) => a + r.np * (r.total || 0), 0) / wsum),
      im: Math.round(list.reduce((a, r) => a + r.im * (r.total || 0), 0) / wsum),
      vcl: wavg('vcl'), vsl: wavg('vsl'), vap: wavg('vap'),
      lin: wavg('lin'), wob: wavg('wob'), str: wavg('str'),
    };
  }

  function createTracker(gatePx, missMax) {
    let nextId = 1;
    const active = [], finished = [];
    function update(dets, t) {
      for (const trk of active) trk._hit = false;
      for (const d of dets) {
        let best = null, bd = gatePx;
        for (const trk of active) {
          if (trk._hit) continue;
          const dd = dist(trk.points[trk.points.length - 1], d);
          if (dd < bd) { bd = dd; best = trk; }
        }
        if (best) { best.points.push({ x: d.x, y: d.y, t }); best._miss = 0; best._hit = true; }
        else active.push({ id: nextId++, points: [{ x: d.x, y: d.y, t }], _miss: 0, _hit: true });
      }
      for (let i = active.length - 1; i >= 0; i--) {
        const trk = active[i];
        if (!trk._hit) trk._miss++;
        if (trk._miss > missMax) { finished.push(trk); active.splice(i, 1); }
      }
      return finished;
    }
    function flush() { finished.push(...active); active.length = 0; return finished; }
    return { update, flush, active, finished };
  }

  /* ================= تحميل OpenCV ================= */
  function loadOpenCv() {
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

  /* ================= كشف الحيوانات في الإطار ================= */
  function detectFrame(cv, canvas, st, opts) {
    const src = cv.imread(canvas);
    cv.cvtColor(src, st.gray, cv.COLOR_RGBA2GRAY);
    if (!st.bg) st.bg = new cv.BackgroundSubtractorMOG2(500, 16, false);
    st.bg.apply(st.gray, st.mask);
    cv.threshold(st.mask, st.mask, 120, 255, cv.THRESH_BINARY);
    cv.morphologyEx(st.mask, st.mask, cv.MORPH_OPEN, st.k);
    cv.morphologyEx(st.mask, st.mask, cv.MORPH_CLOSE, st.kBig);
    st.contours = new cv.MatVector();
    st.hier = new cv.Mat();
    cv.findContours(st.mask, st.contours, st.hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const dets = [];
    for (let i = 0; i < st.contours.size(); i++) {
      const cnt = st.contours.get(i);
      const a = cv.contourArea(cnt);
      if (a >= opts.minArea && a <= opts.maxArea) {
        const m = cv.moments(cnt);
        if (m.m00 > 0) dets.push({ x: m.m10 / m.m00, y: m.m01 / m.m00 });
      }
      cnt.delete();
    }
    st.contours.delete(); st.hier.delete();
    src.delete();
    return dets;
  }

  const CLS_COLOR = { PR: '#1a9c3c', NP: '#e6c200', IM: '#e01f26' };
  function drawTracks(ctx2d, tracks, umPerPx, th) {
    ctx2d.lineWidth = 1.6;
    for (const trk of tracks) {
      const pts = trk.points;
      if (pts.length < 2) continue;
      const st = trackStats(trk, umPerPx);
      const c = st ? CLS_COLOR[classify(st, th)] : '#888';
      ctx2d.strokeStyle = c;
      ctx2d.beginPath();
      ctx2d.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx2d.lineTo(pts[i].x, pts[i].y);
      ctx2d.stroke();
      ctx2d.fillStyle = c;
      ctx2d.beginPath();
      ctx2d.arc(pts[pts.length - 1].x, pts[pts.length - 1].y, 4, 0, 7);
      ctx2d.fill();
    }
  }

  /* ================= مقارنة التارجت (هيستوجرام رمادي) ================= */
  function grayHist(canvas) {
    const c = document.createElement('canvas');
    const s = 64 / Math.max(canvas.width, canvas.height);
    c.width = Math.max(8, Math.round(canvas.width * s));
    c.height = Math.max(8, Math.round(canvas.height * s));
    const x = c.getContext('2d');
    x.drawImage(canvas, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const h = new Array(32).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
      h[Math.min(31, g >> 3)]++;
    }
    return h;
  }

  function histCorr(a, b) {
    const ma = a.reduce((x, y) => x + y, 0) / a.length;
    const mb = b.reduce((x, y) => x + y, 0) / b.length;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return (da && db) ? num / Math.sqrt(da * db) : 0;
  }

  async function loadTargets() {
    try {
      const r = await DB.get('meta', 'targets');
      return (r && r.value) || { videos: [], images: [] };
    } catch (e) { return { videos: [], images: [] }; }
  }

  function frameCanvasOfVideo(video) {
    const c = document.createElement('canvas');
    c.width = video.videoWidth || 320; c.height = video.videoHeight || 240;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c;
  }

  async function evalTargets(video, canvas) {
    const t = await loadTargets();
    if (!t.videos.length) return '';
    const h = grayHist(canvas);
    let best = null, bestScore = -2;
    for (const tv of t.videos) {
      try {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.src = tv.dataUrl;
        await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
        v.currentTime = Math.min(1, (v.duration || 1) / 2);
        await new Promise(res => { v.onseeked = res; });
        const s = histCorr(h, grayHist(frameCanvasOfVideo(v)));
        if (s > bestScore) { bestScore = s; best = tv.name; }
      } catch (e) {}
    }
    if (!best) return '';
    const pct = Math.max(0, Math.min(100, Math.round((bestScore + 1) / 2 * 100)));
    return `<p class="hint" style="margin-top:6px">🎯 Closest target: <b>${esc(best)}</b> — similarity ${pct}%</p>`;
  }

  /* ================= النواة: تحليل فيديو واحد ================= */
  async function analyzeBlob(blob, opts, hooks = {}) {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.src = url;
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error('Could not play the video'));
    });
    await video.play();

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx2d = canvas.getContext('2d');

    const cv = window.cv;
    const st = {
      gray: new cv.Mat(), mask: new cv.Mat(),
      k: cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)),
      kBig: cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7)),
      bg: null, contours: null, hier: null,
    };
    const tracker = createTracker(opts.gate, 6);
    const limit = Math.min(video.duration || opts.maxSec, opts.maxSec);
    const th = { imVCL: opts.imVCL, prVSL: opts.prVSL };
    let lastT = -1, frame = 0;

    try {
      while (!cancelFlag) {
        const t = video.currentTime;
        if (video.ended || t >= limit) break;
        if (t - lastT >= 1 / 120) {
          lastT = t;
          ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
          const cleanFrame = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
          const dets = detectFrame(cv, canvas, st, opts);
          tracker.update(dets, t);
          if (hooks.onFrame && frame % 3 === 0) {
            ctx2d.putImageData(cleanFrame, 0, 0);
            drawTracks(ctx2d, [...tracker.active, ...tracker.finished], opts.um, th);
            hooks.onFrame(canvas, frame, t, dets.length);
          }
          if (hooks.onTick && frame % 10 === 0) hooks.onTick(frame, t, dets.length);
          frame++;
        }
        await new Promise(r => requestAnimationFrame(r));
      }
    } finally {
      video.pause(); video.src = ''; URL.revokeObjectURL(url);
      if (st.bg) st.bg.delete();
      st.gray.delete(); st.mask.delete(); st.k.delete(); st.kBig.delete();
    }

    const tracks = tracker.flush();
    const res = aggregate(tracks, opts.um, th);
    return { res, tracks, canvas, limit, th };
  }

  /* ================= نافذة التحليل ================= */
  let cancelFlag = false;

  function closeModal() {
    cancelFlag = true;
    const m = $('#ana-modal');
    if (m) m.remove();
  }

  function resultsHTML(res, extra = '') {
    return `
      <h3>Results</h3>
      <table>
        <thead><tr><th>PR %</th><th>NP %</th><th>Immotile %</th><th>Total tracked</th></tr></thead>
        <tbody><tr>
          <td class="green"><b>${res.pr}</b></td>
          <td style="color:#b89b00"><b>${res.np}</b></td>
          <td class="red"><b>${res.im}</b></td>
          <td><b>${res.total}</b></td>
        </tr></tbody>
      </table>
      <br>
      <table>
        <thead><tr><th>VCL µm/s</th><th>VSL µm/s</th><th>VAP µm/s</th><th>LIN</th><th>WOB</th><th>STR</th></tr></thead>
        <tbody><tr>
          <td>${res.vcl}</td><td>${res.vsl}</td><td>${res.vap}</td>
          <td>${res.lin}</td><td>${res.wob}</td><td>${res.str}</td>
        </tr></tbody>
      </table>
      ${extra}
      <br>
      <button class="btn accent" id="ana-apply">Fill results into the study</button>`;
  }

  async function applyResult(res) {
    if (cfg.getStudyId) await cfg.getStudyId();
    if (cfg.apply) cfg.apply({
      pr: res.pr, np: res.np, im: res.im,
      vcl: res.vcl, vsl: res.vsl, vap: res.vap,
      lin: res.lin, wob: res.wob, str: res.str,
    });
  }

  function readOpts() {
    const o = {
      um:   parseFloat($('#ana-um').value)    || 0.30,
      minArea: parseInt($('#ana-min').value)  || 25,
      maxArea: parseInt($('#ana-max').value)  || 2000,
      gate: parseInt($('#ana-gate').value)    || 30,
      imVCL: parseFloat($('#ana-imvcl').value)|| 10,
      prVSL: parseFloat($('#ana-prvsl').value)|| 5,
      maxSec: parseFloat($('#ana-secs').value)|| 10,
    };
    localStorage.setItem('ecasa-umpx', String(o.um));
    return o;
  }

  /* ---------- نافذة فيديو واحد (تابان: أوتوماتيك / مانيوال) ---------- */
  function open(media) {
    closeModal();
    cancelFlag = false;
    const umDefault = localStorage.getItem('ecasa-umpx') || '0.30';

    const ov = document.createElement('div');
    ov.className = 'ana-overlay';
    ov.id = 'ana-modal';
    ov.innerHTML = `
      <div class="ana-modal">
        <div class="row">
          <h2 class="spacer">Motility analysis — ${esc(media.name)}</h2>
          <button class="btn small ghost" id="ana-close">Close ✖</button>
        </div>

        <div class="row" style="margin:12px 0;gap:8px">
          <button class="btn small" id="tabbtn-auto">🤖 Automatic</button>
          <button class="btn small ghost" id="tabbtn-manual">✍️ Manual</button>
        </div>

        <div id="pane-auto">
          <div class="card" style="box-shadow:none">
            <h3>Calibration & classification settings</h3>
            <div class="ana-grid">
              <label class="f"><span>µm per pixel *</span><input id="ana-um" type="number" step="0.001" value="${umDefault}"></label>
              <label class="f"><span>Min area (px²)</span><input id="ana-min" type="number" value="25"></label>
              <label class="f"><span>Max area (px²)</span><input id="ana-max" type="number" value="2000"></label>
              <label class="f"><span>Max tracking jump (px)</span><input id="ana-gate" type="number" value="30"></label>
              <label class="f"><span>Immotile threshold VCL (µm/s)</span><input id="ana-imvcl" type="number" step="0.5" value="10"></label>
              <label class="f"><span>PR threshold for VSL (µm/s)</span><input id="ana-prvsl" type="number" step="0.5" value="5"></label>
              <label class="f"><span>Analysis duration (seconds)</span><input id="ana-secs" type="number" value="10"></label>
            </div>
            <p class="hint" style="margin-top:8px">The µm/pixel value comes from your microscope calibration (in the old system: 133 pixels = 0.04 mm ≈ 0.30 µm/pixel). Change it to match your calibration.</p>
            <br>
            <div class="row">
              <button class="btn accent" id="ana-run">Start analysis</button>
              <button class="btn" id="ana-all" title="Analyze all study videos and merge the average">🎬 Analyze all videos</button>
              <button class="btn danger" id="ana-cancel" hidden>Stop</button>
              <span id="ana-status" class="gray"></span>
            </div>
          </div>

          <div class="card" style="box-shadow:none" id="ana-preview-card" hidden>
            <canvas id="ana-canvas" width="640" height="480"></canvas>
            <div class="row" style="margin-top:6px;font-size:13px">
              <span style="color:#1a9c3c">■ PR progressive</span>
              <span style="color:#b89b00">■ NP non-progressive</span>
              <span style="color:#e01f26">■ IM immotile</span>
            </div>
          </div>
        </div>

        <div id="pane-manual" hidden>
          <div class="card" style="box-shadow:none">
            <h3>Manual entry — type your own results</h3>
            <div class="ana-grid">
              <label class="f"><span>PR % (progressive)</span><input id="mn-pr" type="number" value=""></label>
              <label class="f"><span>NP % (non-progressive)</span><input id="mn-np" type="number" value=""></label>
              <label class="f"><span>Immotile %</span><input id="mn-im" type="number" value=""></label>
              <label class="f"><span>VCL (µm/s)</span><input id="mn-vcl" type="number" step="0.01" value=""></label>
              <label class="f"><span>VSL (µm/s)</span><input id="mn-vsl" type="number" step="0.01" value=""></label>
              <label class="f"><span>VAP (µm/s)</span><input id="mn-vap" type="number" step="0.01" value=""></label>
              <label class="f"><span>LIN</span><input id="mn-lin" type="number" step="0.01" value=""></label>
              <label class="f"><span>WOB</span><input id="mn-wob" type="number" step="0.01" value=""></label>
              <label class="f"><span>STR</span><input id="mn-str" type="number" step="0.01" value=""></label>
            </div>
            <br>
            <button class="btn accent" id="mn-apply">Fill results into the study</button>
            <span class="hint" style="margin-inline-start:8px">PR + NP + IM must add up to 100%</span>
          </div>
        </div>

        <div class="card" style="box-shadow:none" id="ana-results" hidden></div>
      </div>`;
    document.body.appendChild(ov);

    const switchTab = t => {
      $('#pane-auto').hidden = t !== 'auto';
      $('#pane-manual').hidden = t !== 'manual';
      $('#tabbtn-auto').className = 'btn small' + (t === 'auto' ? '' : ' ghost');
      $('#tabbtn-manual').className = 'btn small' + (t === 'manual' ? '' : ' ghost');
      $('#ana-results').hidden = true;
    };
    $('#tabbtn-auto').onclick = () => switchTab('auto');
    $('#tabbtn-manual').onclick = () => switchTab('manual');
    $('#ana-close').onclick = closeModal;
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });

    /* مانيوال */
    $('#mn-apply').onclick = () => {
      const g = id => parseFloat($(id).value);
      const pr = g('#mn-pr') || 0, np = g('#mn-np') || 0, im = g('#mn-im') || 0;
      if (Math.abs(pr + np + im - 100) > 1) {
        alert('⚠️ PR + NP + IM must add up to 100% (currently = ' + (pr + np + im) + '%)');
        return;
      }
      applyResult({
        pr, np, im,
        vcl: g('#mn-vcl') || 0, vsl: g('#mn-vsl') || 0, vap: g('#mn-vap') || 0,
        lin: g('#mn-lin') || 0, wob: g('#mn-wob') || 0, str: g('#mn-str') || 0,
      });
      closeModal();
    };

    /* أوتوماتيك — فيديو واحد */
    $('#ana-run').onclick = async () => {
      const opts = readOpts();
      const statusEl = $('#ana-status');
      const runBtn = $('#ana-run'), allBtn = $('#ana-all'), cancelBtn = $('#ana-cancel');
      runBtn.disabled = allBtn.disabled = true; cancelBtn.hidden = false;
      cancelFlag = false;
      $('#ana-results').hidden = true;
      $('#ana-preview-card').hidden = false;
      try {
        await loadOpenCv();
        const canvas = $('#ana-canvas');
        const out = canvas.getContext('2d');
        const { res, limit, canvas: lastC } = await analyzeBlob(media.blob, opts, {
          onFrame: (c) => { canvas.width = c.width; canvas.height = c.height; out.drawImage(c, 0, 0); },
        });
        const targetNote = await evalTargets(null, lastC);
        out.fillStyle = '#000'; out.fillRect(0, 0, canvas.width, canvas.height);
        statusEl.textContent = cancelFlag ? 'Stopped' :
          `Done — ${res.total} sperms tracked over ${limit.toFixed(1)} seconds`;
        const R = $('#ana-results');
        R.hidden = false;
        R.innerHTML = resultsHTML(res, `<p class="gray" style="font-size:13px">Velocity averages are computed on motile sperms (PR + NP). Review the result and adjust classification thresholds or calibration if needed.</p>${targetNote}`);
        $('#ana-apply').onclick = () => { applyResult(res); closeModal(); };
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
      } finally {
        runBtn.disabled = allBtn.disabled = false; cancelBtn.hidden = true;
      }
    };

    /* تحليل كل الفيديوهات */
    $('#ana-all').onclick = async () => {
      const videos = (cfg.getVideos ? await cfg.getVideos() : []).filter(m => m.kind === 'video');
      if (!videos.length) { alert('No videos in this study'); return; }
      if (!confirm(`Will analyze ${videos.length} videos one after another and merge the average. Continue?`)) return;
      const opts = readOpts();
      const statusEl = $('#ana-status');
      const runBtn = $('#ana-run'), allBtn = $('#ana-all'), cancelBtn = $('#ana-cancel');
      runBtn.disabled = allBtn.disabled = true; cancelBtn.hidden = false;
      cancelFlag = false;
      $('#ana-results').hidden = true;
      $('#ana-preview-card').hidden = false;
      const canvas = $('#ana-canvas');
      const out = canvas.getContext('2d');
      const perVideo = [];
      try {
        await loadOpenCv();
        for (let i = 0; i < videos.length; i++) {
          if (cancelFlag) break;
          statusEl.textContent = `Video ${i + 1}/${videos.length}: ${videos[i].name}`;
          const { res, canvas: lastC } = await analyzeBlob(videos[i].blob, opts, {
            onFrame: (c) => { canvas.width = c.width; canvas.height = c.height; out.drawImage(c, 0, 0); },
          });
          perVideo.push({ name: videos[i].name, res, canvas: lastC });
        }
        if (!perVideo.length) { statusEl.textContent = 'No results'; return; }
        const merged = mergeResults(perVideo.map(v => v.res));
        statusEl.textContent = `Analyzed ${perVideo.length} videos — ${merged.total} sperms total`;
        const rows = perVideo.map(v =>
          `<tr><td>${esc(v.name)}</td><td>${v.res.total}</td><td>${v.res.pr}%</td><td>${v.res.np}%</td><td>${v.res.im}%</td></tr>`).join('');
        const targetNote = perVideo.length && perVideo[perVideo.length - 1].canvas
          ? await evalTargets(null, perVideo[perVideo.length - 1].canvas) : '';
        const R = $('#ana-results');
        R.hidden = false;
        R.innerHTML = resultsHTML(merged, `
          <h4 style="margin:12px 0 6px">Per-video breakdown</h4>
          <table>
            <thead><tr><th style="text-align:left">Video</th><th>Tracked</th><th>PR</th><th>NP</th><th>IM</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="gray" style="font-size:13px">The merged row is a weighted average by the number of sperms tracked in each video.</p>${targetNote}`);
        $('#ana-apply').onclick = () => { applyResult(merged); closeModal(); };
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
      } finally {
        runBtn.disabled = allBtn.disabled = false; cancelBtn.hidden = true;
      }
    };
    $('#ana-cancel').onclick = () => { cancelFlag = true; };
  }

  /* واجهة للاختبارات */
  return { configure, open, close: closeModal, _t: { trackStats, classify, aggregate, createTracker, smooth, mergeResults, histCorr } };
})();
