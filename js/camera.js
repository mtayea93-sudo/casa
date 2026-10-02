/* ===== E-CASA Web — microscope camera & media (v2) =====
   Morphology images + Motility video recording, attached to the study and saved offline (Blob in IndexedDB)
*/
const Cam = (() => {
  let stream = null, recorder = null, chunks = [], recording = false;
  let urls = [];

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg) {
    const t = document.querySelector('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function stop() {
    if (recording && recorder) { try { recorder.stop(); } catch (e) {} recording = false; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  async function render(box, ctx) {
    /* ctx: { patientId, studyId, getStudyId } */
    urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
    const media = ctx.studyId ? (await DB.byIndex('media', 'studyId', ctx.studyId)) : [];
    media.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    box.innerHTML = `
    <div class="card">
      <h3>Capture from camera <span class="gray">— video for Motility / images for Morphology</span></h3>
      <div class="row">
        <select id="cam-dev" style="padding:8px;border:1px solid var(--line);border-radius:8px;min-width:260px"></select>
        <button class="btn small" id="cam-start">Start camera</button>
        <button class="btn small ghost" id="cam-stop">Stop</button>
      </div>
      <p id="cam-msg" class="hint" hidden style="margin-top:10px"></p>
      <video id="cam-video" autoplay playsinline muted hidden
        style="width:100%;max-height:420px;background:#000;border-radius:10px;margin-top:10px"></video>
      <div class="row" style="margin-top:12px">
        <button class="btn accent" id="cam-shot" disabled>Capture image (Morphology)</button>
        <button class="btn danger" id="cam-rec" disabled>Start video recording (Motility)</button>
      </div>
      <p class="gray" style="font-size:13px">Tip from the manual: clean the slide and cover slip well, and mix the sample thoroughly so the concentration calculation comes out right.</p>
    </div>
    <div class="card">
      <div class="row">
        <h3 class="spacer">Study media (${media.length})</h3>
        ${media.some(m => m.kind === 'video') ? '<button class="btn small" id="cam-anavids" title="Analyze all study videos and merge the average">🎬 Analyze all videos</button>' : ''}
        ${media.some(m => m.kind === 'image') ? '<button class="btn small" id="cam-anaimgs" title="Analyze all morphology images into one average">🖼️ Analyze all images</button>' : ''}
        <label class="btn small ghost" style="cursor:pointer">Attach images or video (any format)
          <input id="cam-upload" type="file" accept="image/*,video/*,.mkv,.mk3d,.avi,.mov,.wmv,.mpg,.mpeg,.ts,.m2ts,.mts,.3gp,.3g2,.m4v,.flv,.f4v,.mod,.vob,.mxf,.mp4" multiple hidden>
        </label>
      </div>
      ${media.length ? `<div class="grid">${media.map(m => {
        const u = DB.urlFor(m); urls.push(u);
        return `<div style="border:1px solid var(--line);border-radius:10px;padding:8px">
          ${m.kind === 'image'
            ? `<img src="${u}" style="width:100%;height:160px;object-fit:cover;border-radius:8px">`
            : `<video src="${u}" controls style="width:100%;height:160px;border-radius:8px;background:#000"></video>`}
          <div class="row" style="margin-top:6px">
            <small class="gray spacer">${m.kind === 'image' ? 'Morphology image' : 'Motility video'}${m.markings ? ' · <b style="color:#1a9c3c">✏️ marked</b>' : ''}<br>${esc(m.name)}</small>
            ${m.kind === 'video' ? `<button class="btn small accent" data-ana="${m.id}">Motility</button>` : ''}
            ${m.kind === 'image' ? `<button class="btn small accent" data-mana="${m.id}">Morphology</button>` : ''}
            ${m.kind === 'image' ? `<button class="btn small" data-mark="${m.id}" title="Mark sperm heads, pus cells and good/bad yourself">✏️ Mark</button>` : ''}
            <button class="btn small danger" data-del="${m.id}">Delete</button>
          </div>
        </div>`;
      }).join('')}</div>`
      : '<p class="gray">No media yet — start the camera and capture images or record a video.</p>'}
    </div>`;

    /* if the stream is running, rebind it to the fresh element (after re-render) */
    if (stream) {
      const v = $('#cam-video');
      v.srcObject = stream; v.hidden = false;
      $('#cam-shot').disabled = false;
      $('#cam-rec').disabled = false;
      if (recording) $('#cam-rec').textContent = 'Stop recording & save';
    }

    /* camera list */
    try {
      let devs = await navigator.mediaDevices.enumerateDevices();
      let cams = devs.filter(d => d.kind === 'videoinput');
      if (!cams.length || !cams[0].label) {
        try {
          const t = await navigator.mediaDevices.getUserMedia({ video: true });
          t.getTracks().forEach(x => x.stop());
        } catch (e) {}
        devs = await navigator.mediaDevices.enumerateDevices();
        cams = devs.filter(d => d.kind === 'videoinput');
      }
      $('#cam-dev').innerHTML = cams.map((c, i) =>
        `<option value="${c.deviceId}">${esc(c.label || ('Camera ' + (i + 1)))}</option>`).join('')
        || '<option value="">No camera connected</option>';
    } catch (e) {
      const m = $('#cam-msg');
      m.hidden = false;
      m.textContent = 'Could not list cameras: ' + e.message;
    }

    /* start camera */
    $('#cam-start').onclick = async () => {
      const devId = $('#cam-dev').value;
      stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: devId ? { exact: devId } : undefined,
                   width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        const v = $('#cam-video');
        v.srcObject = stream; v.hidden = false;
        $('#cam-shot').disabled = false;
        $('#cam-rec').disabled = false;
        $('#cam-msg').hidden = true;
      } catch (e) {
        const m = $('#cam-msg');
        m.hidden = false;
        m.textContent = 'Could not open the camera: ' + e.message + ' — check the site camera permission.';
      }
    };

    $('#cam-stop').onclick = () => {
      stop();
      const v = $('#cam-video');
      v.srcObject = null; v.hidden = true;
      $('#cam-shot').disabled = true;
      $('#cam-rec').disabled = true;
    };

    /* capture a Morphology image */
    $('#cam-shot').onclick = () => {
      const v = $('#cam-video');
      if (!stream || !v.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      c.toBlob(async b => {
        const sid = await ctx.getStudyId();
        ctx.studyId = sid;
        await DB.put('media', { studyId: sid, kind: 'image',
          name: 'morph-' + stamp() + '.png', mime: b.type, blob: b,
          createdAt: new Date().toISOString() });
        toast('Image saved to the study');
        render(box, ctx);
      }, 'image/png');
    };

    /* record a Motility video */
    $('#cam-rec').onclick = () => {
      if (!stream) return;
      if (!recording) {
        chunks = [];
        let mime = 'video/webm;codecs=vp9,opus';
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
        recorder = new MediaRecorder(stream, { mimeType: mime });
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = async () => {
          const b = new Blob(chunks, { type: mime });
          if (b.size < 500) { toast('Recording failed — video too short or empty, not saved'); chunks = []; render(box, ctx); return; }
          const sid = await ctx.getStudyId();
          ctx.studyId = sid;
          await DB.put('media', { studyId: sid, kind: 'video',
            name: 'motility-' + stamp() + '.webm', mime: b.type, blob: b,
            createdAt: new Date().toISOString() });
          toast('Video saved to the study');
          render(box, ctx);
        };
        recorder.start(1000);
        recording = true;
        $('#cam-rec').textContent = 'Stop recording & save';
      } else {
        recorder.stop();
        recording = false;
        $('#cam-rec').textContent = 'Start video recording (Motility)';
      }
    };

    /* convert AVI/MJPEG (old E-CASA archives) to WebM inside the browser */
    function decodeJpegBytes(bytes) {
      return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('Unreadable frame'));
        img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      });
    }

    function framesToWebm(frames) {
      return (async () => {
        const first = await decodeJpegBytes(frames[0]);
        const canvas = document.createElement('canvas');
        canvas.width = first.naturalWidth; canvas.height = first.naturalHeight;
        const cx = canvas.getContext('2d');
        cx.drawImage(first, 0, 0);
        const stream = canvas.captureStream(30);
        let mime = 'video/webm;codecs=vp9';
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
        const rec = new MediaRecorder(stream, { mimeType: mime });
        const parts = [];
        rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
        const done = new Promise((res, rej) => { rec.onstop = res; rec.onerror = () => rej(new Error('Recording failed')); });
        rec.start();
        for (let i = 1; i < frames.length; i++) {
          const img = await decodeJpegBytes(frames[i]);
          cx.drawImage(img, 0, 0);
          await new Promise(r => setTimeout(r, 33));
        }
        await new Promise(r => setTimeout(r, 120));
        rec.stop();
        await done;
        return new Blob(parts, { type: 'video/webm' });
      })();
    }

    function convertAviMjpeg(file) {
      return (async () => {
        const buf = new Uint8Array(await file.arrayBuffer());
        const tag = (o, n) => String.fromCharCode.apply(null, buf.subarray(o, o + n));
        if (buf.length < 12 || tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'AVI ') return null;
        const view = new DataView(buf.buffer);
        const frames = [];
        const collect = (start, end) => {
          let p = start;
          while (p + 8 <= end) {
            const id = tag(p, 4);
            const sz = view.getUint32(p + 4, true);
            if ((id === '00dc' || id === '00db') && sz > 100)
              frames.push(buf.subarray(p + 8, p + 8 + sz));
            p += 8 + sz + (sz % 2);
          }
        };
        const walk = (start, end) => {
          let p = start;
          while (p + 8 <= end) {
            const id = tag(p, 4);
            const sz = view.getUint32(p + 4, true);
            if (id === 'LIST' && tag(p + 8, 4) === 'movi') collect(p + 12, Math.min(p + 8 + sz, buf.length));
            p += 8 + sz + (sz % 2);
          }
        };
        walk(12, buf.length);
        const jpegs = frames.filter(f => f.length > 4 && f[0] === 0xFF && f[1] === 0xD8);
        if (jpegs.length < 2) return null;
        return await framesToWebm(jpegs);
      })();
    }

    /* attach ready-made files from the device (images/videos) */
    const up = $('#cam-upload');
    if (up) up.onchange = async e => {
      const files = [...e.target.files];
      if (!files.length) return;
      for (const file of files) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const VID_EXT = ['mp4','webm','mov','mkv','mk3d','avi','wmv','mpg','mpeg','ts','m2ts','mts','3gp','3g2','m4v','flv','f4v','mod','vob','mxf'];
        const isVid = file.type.startsWith('video') || (!file.type && VID_EXT.includes(ext)) || file.type === 'video/x-matroska' || file.type === 'application/octet-stream' && VID_EXT.includes(ext);
        const kind = isVid ? 'video' : 'image';
        let blob = file, name = file.name, mime = file.type;
        if (isVid && (ext === 'avi' || file.type.indexOf('msvideo') !== -1)) {
          toast('⏳ Converting the video to a playable format…');
          try {
            const webm = await convertAviMjpeg(file);
            if (webm) {
              blob = webm;
              name = file.name.replace(/\.avi$/i, '') + '-converted.webm';
              mime = 'video/webm';
              toast('✅ Video converted — it will now play');
            } else {
              alert('⚠️ This AVI uses a codec the browser does not support. Convert it to MP4 (e.g. with VLC) and upload it again.');
              continue;
            }
          } catch (err) {
            alert('⚠️ Could not convert the video — convert it to MP4 and upload it again.');
            continue;
          }
        }
        const sid = await ctx.getStudyId();
        ctx.studyId = sid;
        await DB.put('media', { studyId: sid, kind, name,
          mime, blob, createdAt: new Date().toISOString() });
      }
      toast(`Attached ${files.length} file(s)`);
      render(box, ctx);
    };

    /* batch analysis: all videos / all images */
    const avBtn = $('#cam-anavids');
    if (avBtn) avBtn.onclick = () => {
      const vids = media.filter(m => m.kind === 'video');
      if (!vids.length) return;
      Motility.open(vids[0]);
      setTimeout(() => { const b = $('#ana-all'); if (b) b.click(); }, 400);
    };
    const aiBtn = $('#cam-anaimgs');
    if (aiBtn) aiBtn.onclick = () => {
      const imgs = media.filter(m => m.kind === 'image');
      if (imgs.length) Morpho.openBatch(imgs);
    };

    /* delete media */
    box.querySelectorAll('[data-del]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Delete this media?')) return;
      await DB.del('media', +btn.dataset.del);
      render(box, ctx);
    });

    /* automatic motility analysis (v3) */
    box.querySelectorAll('[data-ana]').forEach(btn => btn.onclick = async () => {
      const m = await DB.get('media', +btn.dataset.ana);
      if (typeof Motility !== 'undefined') Motility.open(m);
      else alert('Analysis module is not loaded');
    });

    /* automatic morphology analysis (v4) */
    box.querySelectorAll('[data-mana]').forEach(btn => btn.onclick = async () => {
      const m = await DB.get('media', +btn.dataset.mana);
      if (typeof Morpho !== 'undefined') Morpho.open(m);
      else alert('Analysis module is not loaded');
    });

    /* manual marking on an image (v1) */
    box.querySelectorAll('[data-mark]').forEach(btn => btn.onclick = async () => {
      const m = await DB.get('media', +btn.dataset.mark);
      if (typeof Annotate !== 'undefined') Annotate.open(m);
      else alert('Annotation module is not loaded');
    });
  }

  return { render, stop };
})();
