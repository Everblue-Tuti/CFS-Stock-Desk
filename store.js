/* Storage on this PC (browser IndexedDB) + an optional data file chosen by the user (OneDrive, shared drive, …)
   that is re-written after every change, so nothing is lost if the browser's data is cleared. */
(function (root) {
  /* settings that travel with the data file / backup (plans, stuffing, lists, running number, report log) */
  const SNAP_KEYS = ['report_headers', 'cha_list', 'plans', 'stuffings', 'lists', 'running_no', 'report_log'];
  const DB_NAME = 'cfs_stock_desk', DB_VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        const p = db.createObjectStore('profiles', {keyPath: 'id', autoIncrement: true}); p.createIndex('shipper', 'shipper', {unique: true});
        db.createObjectStore('stock', {keyPath: 'id', autoIncrement: true});
        db.createObjectStore('batches', {keyPath: 'id', autoIncrement: true});
        db.createObjectStore('audit', {keyPath: 'id', autoIncrement: true});
        db.createObjectStore('settings');
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error || new Error('This browser does not allow the app to store data.'));
    });
    return dbp;
  }
  const done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function all(store) { const db = await open(); return req(db.transaction(store).objectStore(store).getAll()); }
  async function get(store, key) { const db = await open(); return req(db.transaction(store).objectStore(store).get(key)); }
  async function put(store, value, key) {
    const db = await open(); const tx = db.transaction(store, 'readwrite');
    const r = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
    const id = await req(r); await done(tx); return id;
  }
  async function putMany(store, values) {
    const db = await open(); const tx = db.transaction(store, 'readwrite'); const os = tx.objectStore(store);
    const ids = []; for (const v of values) os.put(v).onsuccess = e => ids.push(e.target.result);
    await done(tx); return ids;
  }
  async function del(store, key) { const db = await open(); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); await done(tx); }
  async function clear(store) { const db = await open(); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear(); await done(tx); }
  const now = () => root.CSD.ist.stamp();      // India time

  const st = {
    now,
    async profiles() { return (await all('profiles')).sort((a, b) => a.shipper < b.shipper ? -1 : 1); },
    async profileByShipper(sh) { const db = await open(); return req(db.transaction('profiles').objectStore('profiles').index('shipper').get(sh)); },
    async saveProfile(shipper, data, user) {
      const cur = await st.profileByShipper(shipper);
      const rec = {shipper, data, updated_at: now(), updated_by: user};
      if (cur) rec.id = cur.id;
      await put('profiles', rec); changed();
    },
    async updateProfile(id, data, user) { const cur = await get('profiles', id); if (!cur) return; cur.data = data; cur.updated_at = now(); cur.updated_by = user; await put('profiles', cur); changed(); },
    async deleteProfile(id) { await del('profiles', id); changed(); },
    async addBatch(shipper, invoice, files, user, rows, status = 'in') {
      const bid = await put('batches', {shipper, invoice, files, created_at: now(), created_by: user});
      const t = now();
      await putMany('stock', rows.map(r => ({batch_id: bid, data: r, status, created_at: t, updated_at: t, updated_by: user})));
      changed(); return bid;
    },
    async stock(status = 'in') { const rows = await all('stock'); return rows.filter(r => !status || r.status === status).sort((a, b) => a.id - b.id); },
    async splitStock(id, restData, outData, user) {
      const cur = await get('stock', id); if (!cur) throw new Error('This row is no longer in stock. Reload.');
      const t = now(), bid = await put('batches', {shipper: 'STUFFED (PART)', invoice: outData['Shipper invoice number'] || '', files: [], created_at: t, created_by: user});
      const [oid] = await putMany('stock', [{batch_id: bid, data: outData, status: 'out', created_at: t, updated_at: t, updated_by: user, removed_at: t}]);
      Object.assign(cur, {data: restData, updated_at: t, updated_by: user}); await put('stock', cur); changed(); return oid;
    },
    async updateStock(id, data, user) { const cur = await get('stock', id); if (!cur) return; Object.assign(cur, {data, updated_at: now(), updated_by: user}); await put('stock', cur); changed(); },
    async setStatus(ids, status, user) {
      const db = await open(); const tx = db.transaction('stock', 'readwrite'); const os = tx.objectStore('stock');
      for (const id of ids) os.get(id).onsuccess = e => { const r = e.target.result; if (r) { r.status = status; r.removed_at = status !== 'in' && status !== 'pending' ? now() : null; r.updated_by = user; os.put(r); } };
      await done(tx); changed();
    },
    async audit(user, action, detail) { await put('audit', {at: now(), user, action, detail: String(detail).slice(0, 2000)}); },
    async auditDay(day) { return (await all('audit')).filter(a => String(a.at || '').startsWith(day)); },
    getSetting: k => get('settings', k),
    async getBookings() { return Object.values((await get('settings', 'bookings')) || {}); },
    async saveBookings(list) { const m = (await get('settings', 'bookings')) || {}; for (const b of list) m[[b['PO Number'], b.Style || ''].join('|').toUpperCase()] = b; await put('settings', m, 'bookings'); return list.length; },
    async setSetting(k, v) { await put('settings', v, k); if (SNAP_KEYS.includes(k)) changed(); },

    /* ---- whole data as one JSON (data file / backup / restore) ---- */
    async snapshot() {
      let who = '', cfs = '';
      try { who = localStorage.getItem('csd_user') || ''; cfs = localStorage.getItem('csd_cfs') || ''; } catch (e) {}
      return {app: 'CFS Stock Desk', kind: 'cfs_data', version: 1, saved_at: now(), saved_by: who, cfs,
        profiles: await all('profiles'), stock: await all('stock'), batches: await all('batches'),
        report_headers: (await get('settings', 'report_headers')) || null, cha_list: (await get('settings', 'cha_list')) || null,
        settings: Object.fromEntries(await Promise.all(SNAP_KEYS.map(async k => [k, (await get('settings', k)) ?? null])))};
    },
    async restore(snap) {
      if (!snap || snap.kind !== 'cfs_data') throw new Error('This is not a CFS Stock Desk data file.');
      for (const s of ['profiles', 'stock', 'batches']) await clear(s);
      await putMany('profiles', snap.profiles || []); await putMany('stock', snap.stock || []); await putMany('batches', snap.batches || []);
      if (snap.report_headers) await put('settings', snap.report_headers, 'report_headers');
      if (snap.cha_list) await put('settings', snap.cha_list, 'cha_list');
      for (const [k, v] of Object.entries(snap.settings || {})) if (SNAP_KEYS.includes(k) && v !== null) await put('settings', v, k);
      changed(true);
    },
  };

  /* ---- data file (File System Access API: Edge / Chrome) ---- */
  const fileState = {handle: null, status: 'none', name: '', saved_at: '', error: ''};
  let timer = null, listeners = [];
  const emit = () => listeners.forEach(f => { try { f(Object.assign({}, fileState)); } catch (e) {} });
  function changed(skipSave) { try { localStorage.setItem('csd_last_change', now()); } catch (e) {}
    if (skipSave) { emit(); return; } clearTimeout(timer); timer = setTimeout(() => st.saveToFile(false), 1200); }
  st.fileSupported = typeof root.showSaveFilePicker === 'function';
  st.onFileState = f => { listeners.push(f); f(Object.assign({}, fileState)); };
  st.initFile = async () => {
    try {
      const h = await get('settings', 'dataFile');
      if (h) { fileState.handle = h; fileState.name = h.name;
        const p = await h.queryPermission({mode: 'readwrite'});
        fileState.status = p === 'granted' ? 'ok' : 'reconnect'; }
    } catch (e) { fileState.status = 'none'; }
    emit();
  };
  async function writeFile() {
    const w = await fileState.handle.createWritable();
    await w.write(JSON.stringify(await st.snapshot())); await w.close();
    fileState.saved_at = now(); fileState.status = 'ok'; fileState.error = '';
  }
  st.saveToFile = async (userGesture) => {
    if (!fileState.handle) { emit(); return false; }
    try {
      let p = await fileState.handle.queryPermission({mode: 'readwrite'});
      if (p !== 'granted' && userGesture) p = await fileState.handle.requestPermission({mode: 'readwrite'});
      if (p !== 'granted') { fileState.status = 'reconnect'; emit(); return false; }
      await writeFile(); emit(); return true;
    } catch (e) { fileState.status = 'error'; fileState.error = (e.name ? e.name + ': ' : '') + (e.message || String(e)); emit(); return false; }
  };
  st.chooseNewFile = async () => {
    const site = (root.CSD.F.siteLock && root.CSD.F.siteLock()) || (() => { try { return localStorage.getItem('csd_cfs') || ''; } catch (e) { return ''; } })();
    const short = ((root.CSD.report && root.CSD.report.SITES[site]) || {}).short || '';
    let who = ''; try { who = localStorage.getItem('csd_user') || ''; } catch (e) {}
    const suggested = ['CFS_Stock_Desk_data', short, who].filter(Boolean).join('_').replace(/[^A-Za-z0-9_-]+/g, '_') + '.json';
    const h = await root.showSaveFilePicker({suggestedName: suggested, types: [{description: 'CFS Stock Desk data', accept: {'application/json': ['.json']}}]});
    fileState.handle = h; fileState.name = h.name; await put('settings', h, 'dataFile');
    await writeFile(); emit();
  };
  st.openExistingFile = async () => {
    const [h] = await root.showOpenFilePicker({types: [{description: 'CFS Stock Desk data', accept: {'application/json': ['.json']}}]});
    const snap = JSON.parse(await (await h.getFile()).text());
    await st.restore(snap);
    if ((await h.requestPermission({mode: 'readwrite'})) === 'granted') { fileState.handle = h; fileState.name = h.name; await put('settings', h, 'dataFile'); fileState.status = 'ok'; fileState.saved_at = snap.saved_at || ''; }
    emit();
  };
  st.isMyFile = async (h) => { try { return !!(fileState.handle && h && await fileState.handle.isSameEntry(h)); } catch (e) { return false; } };
  st.forgetFile = async () => { await del('settings', 'dataFile'); Object.assign(fileState, {handle: null, status: 'none', name: '', saved_at: ''}); emit(); };
  root.CSD.store = st;
})(typeof self !== 'undefined' ? self : globalThis);
