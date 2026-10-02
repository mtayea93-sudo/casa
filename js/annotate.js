/* ===== E-CASA Web — Manual image annotation (v2 — pen tool) =====
   The doctor draws freely on any study image with a colored pen:
   - draw a circle/stroke around a normal head (green), abnormal head (red),
     pus cell (purple) or any other cell (gray) — like marking on paper
   - every stroke counts as one marked object of its tool
   - markings feed the study: Normal morphology % and WBC /HPF
   - a flattened annotated copy is saved as an extra image of the study
     so it appears in the printed report exactly as it was marked
*/
const Annotate = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let cfg = { getStudyId: null, apply: null };
  function configure(c) { cfg = { ...cfg, ...c }; }

  const TOOLS = [
    { id: 'normal',   label: '✔ Normal',   color: '#12a03c' },
    { id: 'abnormal', label: '✘ Abnormal', color: '#e01f26' },
    { id: 'pus',      label: '● Pus cell', color: '#8b5cf6' },
    { id: 'other',    label: '○ Other',    color: '#64748b' },
  ];
  const toolColor = id => (TOOLS.find(t => t.id === id) || TOOLS[3]).color;

  let ov = null, img = null, scale = 1, strokes = [], currentTool = 'normal',
      mediaId = null, drawing = false, liveCtx = null;

  function close() { if (ov) { ov.remove(); ov = null; } drawing = false; }

  function counts() {
    const c = { normal: 0, abnormal: 0, pus: 0, other: 0 };
    for (const st of strokes) c[st.t] = (c[st.t] || 0) + 1;
    return c;
  }

  function paintStroke(ctx, st, k) {
    ctx.strokeStyle = toolColor(st.t);
    ctx.fillStyle = toolColor(st.t);
    ctx.lineWidth = 3 * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (st.pts.length === 1) {
      ctx.beginPath();
      ctx.arc(st.pts[0].x * k, st.pts[0].y * k, 4 * k, 0, 7);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(st.pts[0].x * k, st.pts[0].y * k);
    for (let i = 1; i < st.pts.length; i++) ctx.lineTo(st.pts[i].x * k, st.pts[i].y * k);
    ctx.stroke();
  }

  function draw() {
    const canvas = $('#an-canvas');
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const st of strokes) paintStroke(ctx, st, scale);
    refreshCounters();
  }

  function refreshCounters() {
    const c = counts();
    const el = $('#an-counters');
    if (el) {
      el.innerHTML = TOOLS.map(t =>
        `<span style="color:${t.color};font-weight:700">${t.label}: <b>${c[t.id] || 0}</b></span>`).join(' &nbsp;·&nbsp; ');
    }
    const n = (c.normal || 0) + (c.abnormal || 0);
    const pct = n ? Math.round((c.normal || 0) / n * 100) : null;
    const el2 = $('#an-pct');
    if (el2) el2.textContent = pct == null
      ? 'Draw around at least one normal/abnormal head to get the %'
      : `Marked normal morphology on THIS image: ${pct}% (${c.normal}/${n})`;
  }

  async function open(media) {
    close();
    mediaId = media.id;
    strokes = [];
    if (media.markings && Array.isArray(media.markings.strokes))
      strokes = media.markings.strokes.map(st => ({ t: st.t, pts: st.pts.slice() }));
    else if (media.markings && Array.isArray(media.markings.points))
      strokes = media.markings.points.map(p => ({ t: p.t, pts: [{ x: p.x, y: p.y }] }));
    currentTool = 'normal';

    const url = URL.createObjectURL(media.blob);
    img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('Could not open the image'));
      img.src = url;
    });

    const MAXW = 1100, MAXH = 560;
    const k = Math.min(MAXW / img.naturalWidth, MAXH / img.naturalHeight, 1);
    scale = k;

    ov = document.createElement('div');
    ov.className = 'ana-overlay';
    ov.id = 'an-modal';
    ov.innerHTML = `
      <div class="ana-modal" dir="ltr" style="text-align:left">
        <div class="row">
          <h2 class="spacer">✏️ Marking — ${esc(media.name)}</h2>
          <button class="btn small ghost" id="an-close">Close ✖</button>
        </div>
        <p class="hint" style="margin:10px 0"><b>Draw with the pen directly on the image</b> — circle or strike over each object.
        Green ✔ normal head · Red ✘ abnormal head · Purple ● pus cell · Gray ○ other.
        Every drawn mark counts as one object and feeds <b>Normal morphology %</b> and <b>WBC /HPF</b> of the study.</p>
        <div class="row" style="margin:8px 0;gap:8px;flex-wrap:wrap;align-items:center">
          ${TOOLS.map(t => `<button class="btn small${t.id === 'normal' ? '' : ' ghost'}" data-tool="${t.id}" style="border:2px solid ${t.id === 'normal' ? t.color : 'transparent'}">${t.label}</button>`).join('')}
          <label style="font-size:13px;color:#64748b;display:flex;align-items:center;gap:6px;margin-inline-start:8px">
            Pen size <input id="an-size" type="range" min="1" max="8" value="3" style="width:90px"></label>
        </div>
        <div class="card" style="box-shadow:none;padding:10px;overflow:auto">
          <canvas id="an-canvas" width="${Math.round(img.naturalWidth * k)}" height="${Math.round(img.naturalHeight * k)}" style="cursor:crosshair;max-width:none;touch-action:none"></canvas>
        </div>
        <p id="an-counters" style="margin:10px 0 4px;font-size:14px"></p>
        <p id="an-pct" class="gray" style="font-size:13px;margin:0 0 10px"></p>
        <div class="row">
          <button class="btn" id="an-undo">↩ Undo last stroke</button>
          <button class="btn ghost" id="an-clear">Clear all</button>
          <button class="btn" id="an-save">💾 Save markings</button>
          <button class="btn accent" id="an-apply">💾 Save + apply to study (all marked images)</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    URL.revokeObjectURL(url);

    ov.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
      currentTool = b.dataset.tool;
      ov.querySelectorAll('[data-tool]').forEach(x => {
        x.className = 'btn small ghost';
        x.style.border = '2px solid transparent';
      });
      b.className = 'btn small';
      b.style.border = '2px solid ' + toolColor(currentTool);
    });
    $('#an-close').onclick = close;
    ov.addEventListener('click', e => { if (e.target === ov) close(); });

    const canvas = $('#an-canvas');
    let cur = null;
    const pos = e => {
      const r = canvas.getBoundingClientRect();
      return { x: Math.round((e.clientX - r.left) / scale), y: Math.round((e.clientY - r.top) / scale) };
    };
    canvas.onpointerdown = e => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      cur = { t: currentTool, pts: [pos(e)] };
      strokes.push(cur);
      drawing = true;
      const ctx = canvas.getContext('2d');
      paintStroke(ctx, cur, scale);
    };
    canvas.onpointermove = e => {
      if (!drawing || !cur) return;
      const p = pos(e);
      const last = cur.pts[cur.pts.length - 1];
      if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 2) return;
      cur.pts.push(p);
      /* redraw whole canvas (cheap at this size) */
      draw();
    };
    canvas.onpointerup = e => {
      if (!drawing) return;
      drawing = false;
      if (cur && cur.pts.length === 1) { /* dot mark */ }
      cur = null;
      draw();
    };
    $('#an-undo').onclick = () => { strokes.pop(); draw(); };
    $('#an-clear').onclick = () => { if (confirm('Remove ALL marks on this image?')) { strokes = []; draw(); } };
    $('#an-save').onclick = async () => { await saveMarks(); close(); };
    $('#an-apply').onclick = async () => {
      await saveMarks();
      await applyToStudy();
      close();
    };

    draw();
  }

  async function saveMarks() {
    const m = await DB.get('media', mediaId);
    if (!m) return;
    const c = counts();
    m.markings = { normal: c.normal || 0, abnormal: c.abnormal || 0, pus: c.pus || 0, other: c.other || 0, strokes };
    await DB.put('media', m);
    /* flattened annotated copy at natural resolution — appears in the report */
    try {
      const cnv = document.createElement('canvas');
      cnv.width = img.naturalWidth; cnv.height = img.naturalHeight;
      const ctx = cnv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      for (const st of strokes) paintStroke(ctx, st, 1);
      const dataUrl = cnv.toDataURL('image/png');
      const old = await DB.byIndex('media', 'studyId', m.studyId);
      const prev = old.find(x => x.kind === 'image' && x.name === 'annotated-' + m.name);
      const blob = await (await fetch(dataUrl)).blob();
      if (prev) await DB.put('media', { ...prev, blob, mime: 'image/png', updatedAt: new Date().toISOString() });
      else await DB.put('media', { studyId: m.studyId, kind: 'image', name: 'annotated-' + m.name,
        mime: 'image/png', blob, createdAt: new Date().toISOString() });
    } catch (e) { /* flattening is best-effort */ }
  }

  /* combine markings from every marked image of the study and fill the fields */
  async function applyToStudy() {
    if (!cfg.getStudyId) return;
    const sid = await cfg.getStudyId();
    const all = await DB.byIndex('media', 'studyId', sid);
    let n = 0, a = 0, pus = 0;
    for (const m of all) {
      if (!m.markings) continue;
      n += m.markings.normal || 0;
      a += m.markings.abnormal || 0;
      pus += m.markings.pus || 0;
    }
    const total = n + a;
    if (!total) { alert('No normal/abnormal heads marked yet on any image of this study.'); return; }
    const normalMorph = Math.round(n / total * 100);
    if (cfg.apply) cfg.apply({ normalMorph, wbc: pus || '' });
  }

  return { configure, open, close, _t: { counts } };
})();
