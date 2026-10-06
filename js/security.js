/* ===== CASA Security — تشفير كلمات المرور + توقيع الجلسات =====
   كل كلمة سر بتتخزن SHA-256 + Salt فريد — والنص القديم بيترقّي أول دخولة.
   الجلسات موقّعة: تعديلها من كونسول المتصفح يفصلك فوراً. */
const SEC = (() => {
  const enc = new TextEncoder();
  const rnd = n => { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); };
  const sha = async s => { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join(''); };
  const hashNew = async p => { const salt = rnd(16); return { salt, pass: await sha(salt + ':' + p) }; };
  /* rec: {salt,pass} مشفر | {pass} قديم نصي (بيترقّي) */
  const verify = async (rec, p) => {
    if (!rec) return { ok: false };
    if (rec.salt && rec.pass) return { ok: (await sha(rec.salt + ':' + p)) === rec.pass };
    if (rec.pass === p) { const h = await hashNew(p); return { ok: true, upgraded: true, rec: h }; }
    return { ok: false };
  };
  const cyrb = (s, seed) => { let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); };

  /* توقيع جلسة الدخول للموقع (Login) */
  function signLogin(user, labId, secret) {
    const s = ['casa-login', labId || '*', user, secret || ''].join('|');
    return cyrb(s, 7) + cyrb(s.split('').reverse().join(''), 13);
  }
  function loginTampered(user, labId, secret) {
    try { const sig = sessionStorage.getItem('casa_lsig'); return !sig || sig !== signLogin(user, labId, secret); } catch (e) { return true; }
  }

  /* توقيع جلسة لوحة التحكم (admin) */
  function signAdmin(secret) { const s = 'casa-admin|' + (secret || ''); return cyrb(s, 3) + cyrb(s.split('').reverse().join(''), 11); }
  function adminTampered(secret) {
    try { const sig = sessionStorage.getItem('casa_asig'); return !sig || sig !== signAdmin(secret); } catch (e) { return true; }
  }

  return { hashNew, verify, signLogin, loginTampered, signAdmin, adminTampered };
})();
