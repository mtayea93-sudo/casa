/* ===== E-CASA Web — طبقة البيانات =====
   IndexedDB (أساسي) + localStorage (احتياطي تلقائي لو IndexedDB غير متاح — مثل file://)
   بنية مأخوذة من النظام الأصلي:
   - المرجع (REFERENCES) من settings.txt بتاع E-CASA
   - القوالب (TEMPLATES) من autocomplete.txt
*/
const DB = (() => {
  const NAME = 'ecasa-web', VER = 2;
  let backend = null; // 'idb' | 'ls'

  /* مرجع WHO — نفس القيم اللي في settings.txt */
  const REFERENCES = {
    volume:       { label: 'Volume (ml)',                 ref: '>=2 ml',               low: 2   },
    concentration:{ label: 'Concentration (million/ml)',  ref: '>=15 millions/ml',     low: 15  },
    count:        { label: 'Count (million/ejaculate)',   ref: '>=39 millions/ejaculate', low: 39 },
    pr:           { label: 'Progressive motility (%)',    ref: '>=32%',                low: 32  },
    motile:       { label: 'Motile ratio (%)',            ref: '>=40%',                low: 40  },
    normal:       { label: 'Normal sperms (%)',           ref: '>=4%',                 low: 4   },
    tzi:          { label: 'TeratoZoospermic Index TZI',  ref: '<=1.6',                 high: 1.6 },
    ph:           { label: 'PH',                          ref: '>=7.2',                low: 7.2 },
    wbc:          { label: 'White blood cells',           ref: '<=5 / H.P.F',          high: 5  },
    rbc:          { label: 'Red blood cells',             ref: '<=5 / H.P.F',          high: 5  },
  };

  /* القوالب — نفس autocomplete.txt */
  const TEMPLATES = {
    'Comment:':            [''],
    'Color:':              ['Cream white', 'Grayish White'],
    'Odor:':               ['Normal'],
    'Liquefaction time:':  ['20 min', '30 min - 45 min', 'More than 1 hr.'],
    'Liquefaction state:': ['Normal', 'prolonged'],
    'Abst. days:':         ['4 Days'],
    'Agglutination:':      ['Absent', 'Present'],
    'Viscosity:':          ['Normal', 'Prolonged'],
  };

  /* ==================== IndexedDB ==================== */
  let db = null;
  function openIdb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined')
        return rej(new Error('IndexedDB is not available in this browser/mode'));
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('patients'))
          d.createObjectStore('patients', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('studies')) {
          const st = d.createObjectStore('studies', { keyPath: 'id', autoIncrement: true });
          st.createIndex('patientId', 'patientId', { unique: false });
        }
        if (!d.objectStoreNames.contains('meta'))
          d.createObjectStore('meta', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('media')) {
          const md = d.createObjectStore('media', { keyPath: 'id', autoIncrement: true });
          md.createIndex('studyId', 'studyId', { unique: false });
        }
      };
      r.onsuccess = e => { db = e.target.result; res(); };
      r.onerror = () => rej(r.error || new Error('فشل فتح IndexedDB'));
    });
  }
  const store = (name, mode = 'readonly') =>
    db.transaction(name, mode).objectStore(name);
  const req = r => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const IDB = {
    all:    n          => req(store(n).getAll()),
    /* حارس: مفتاح فاضي = null بدل ما يرمي DataError ويكسر الصفحة */
    get:    (n, id)    => (id === undefined || id === null)
                            ? Promise.resolve(null)
                            : req(store(n).get(id)),
    put:    (n, v)     => req(store(n, 'readwrite').put(v)),
    del:    (n, id)    => req(store(n, 'readwrite').delete(id)),
    clear:  n          => req(store(n, 'readwrite').clear()),
    byIndex:(n, i, v)  => req(store(n).index(i).getAll(v)),
  };

  /* ==================== localStorage fallback ==================== */
  const LS = {
    read(n)  { try { return JSON.parse(localStorage.getItem('ecasa.' + n) || '[]'); } catch (e) { return []; } },
    write(n, a) { localStorage.setItem('ecasa.' + n, JSON.stringify(a)); },
    async all(n) { return this.read(n).slice(); },
    async get(n, id) {
      if (n === 'meta') return this.read(n).find(x => x.key === id);
      return this.read(n).find(x => x.id === id);
    },
    async put(n, val) {
      let v = val;
      if (n === 'media' && v.blob) {
        const dataUrl = await new Promise(res => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(v.blob);
        });
        const { blob, ...rest } = v;
        v = { ...rest, dataUrl };
      }
      const a = this.read(n);
      if (n === 'meta') {
        const i = a.findIndex(x => x.key === v.key);
        if (i >= 0) a[i] = v; else a.push(v);
        this.write(n, a);
        return v.key;
      }
      if (v.id != null) {
        const i = a.findIndex(x => x.id === v.id);
        if (i >= 0) a[i] = v; else a.push(v);
      } else {
        v.id = a.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
        a.push(v);
      }
      this.write(n, a);
      return v.id;
    },
    async del(n, id) {
      if (n === 'meta') this.write(n, this.read(n).filter(x => x.key !== id));
      else this.write(n, this.read(n).filter(x => x.id !== id));
    },
    async clear(n) { localStorage.removeItem('ecasa.' + n); },
    async byIndex(n, i, v) { return this.read(n).filter(x => x[i] === v); },
  };

  /* ==================== الواجهة الموحدة ==================== */
  async function open() {
    try {
      await openIdb();
      backend = 'idb';
    } catch (e) {
      if (typeof localStorage === 'undefined') throw e;
      backend = 'ls';
    }
  }
  const pick = m => (...a) => (backend === 'idb' ? IDB[m](...a) : LS[m](...a));

  const api = {
    REFERENCES, TEMPLATES,
    get backend() { return backend; },

    open,
    all:     pick('all'),
    get:     pick('get'),
    put:     pick('put'),
    del:     pick('del'),
    clear:   pick('clear'),
    byIndex: pick('byIndex'),

    /* رابط صالح لوسائط (Blob في IDB أو dataUrl في الاحتياطي) */
    urlFor(m) {
      if (m.blob) return URL.createObjectURL(m.blob);
      if (m.dataUrl) return m.dataUrl;
      return '';
    },

    async seed() {
      const has = backend === 'idb'
        ? !!(await req(store('meta').get('refs')))
        : (await LS.get('meta', 'refs')) != null;
      if (!has) {
        await api.put('meta', { key: 'refs',      value: REFERENCES });
        await api.put('meta', { key: 'templates', value: TEMPLATES });
      }
    },
  };
  return api;
})();
