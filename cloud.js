/* Version 15 – central database (Firebase / Firestore) with sign-in.
   - With no cloud-config (CSD_CLOUD_CONFIG empty) the app keeps working exactly as before on this PC ("local mode").
   - With a config: everyone signs in, stock lives in one central database shared by all PCs and sites, and
     Firestore keeps a copy on the PC so reading documents / saving stock / Start-Offloaded work offline.
   CSD.store stays the same object for the rest of the app: it hands each call to the local or the central store. */
(function (root) {
  'use strict';
  const CSD = root.CSD, F = CSD.F;
  const local = CSD.store;                         // the v14 store (IndexedDB on this PC) – kept for local mode and for moving data up
  /* ?mode=local keeps a PC on this-PC storage (e.g. Chennai in the week before its switch-over); ?mode=central undoes it */
  try { const q = root.location && new URLSearchParams(root.location.search).get('mode'); if (q === 'local') localStorage.setItem('csd_mode', 'local'); else if (q === 'central') localStorage.removeItem('csd_mode'); } catch (e) {}
  const forcedLocal = (() => { try { return localStorage.getItem('csd_mode') === 'local'; } catch (e) { return false; } })();
  const CFG = !forcedLocal && root.CSD_CLOUD_CONFIG && root.CSD_CLOUD_CONFIG.projectId ? root.CSD_CLOUD_CONFIG : null;
  const LOGIN_DOMAIN = 'users.cfs-stock-desk.app';
  const ADMIN_KEYS = ['admin_pin', 'lists', 'report_headers', 'mail', 'recipients', 'shipper_alias', 'shipper_alias_at'];   // settings only an admin may change
  const LIST_KEYS = {stuffings: r => `${siteCode(r.site)}_${r.running_no}`, report_log: r => `${r.date}_${siteCode(r.site)}_${r.slot}_${String(r.at).replace(/\D/g, '')}`};

  /* ---------- small helpers ---------- */
  const ist = CSD.ist;
  const now = () => ist.stamp();
  const month = (d = ist.date()) => String(d).slice(0, 7);
  const prevMonth = () => { const [y, m] = ist.date().split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
  let seq = 0;
  const newId = () => Date.now() * 1000 + ((seq = (seq + 1) % 1000));          // numeric, unique, < 2^53 (the app compares ids as numbers)
  const bookingKey = b => [b['PO Number'], b.Style || ''].map(x => String(x || '').toUpperCase().replace(/[^A-Z0-9]+/g, '')).filter(Boolean).join('_') || 'X';
  const siteCode = s => String(s || 'NONE').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const J = v => JSON.stringify(v === undefined ? null : v);
  const P = s => { try { return JSON.parse(s); } catch (e) { return null; } };

  /* ---------- facade: CSD.store hands every call to the active store ---------- */
  let active = local;
  const facade = {};
  for (const k of Object.keys(local)) facade[k] = typeof local[k] === 'function' ? (...a) => (active[k] || local[k]).apply(active, a) : local[k];
  Object.defineProperty(facade, 'fileSupported', {get: () => active === local ? local.fileSupported : false});
  facade.isCloud = () => active !== local;
  CSD.localStore = local; CSD.store = facade;

  const cloud = {enabled: !!CFG, user: null, profile: null, sites: [], online: () => true, ready: null};
  CSD.cloud = cloud;
  if (!CFG) { root.CSD_READY = Promise.resolve('local'); return; }

  /* =====================================================================================================
     Firebase start
     ===================================================================================================== */
  const FB = root.FB;
  const app = FB.initializeApp(CFG);
  const auth = FB.getAuth(app);
  const db = FB.initializeFirestore(app, {localCache: FB.persistentLocalCache({tabManager: FB.persistentMultipleTabManager()}), ignoreUndefinedProperties: true});
  if (CFG.emulator) { try { FB.connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true}); FB.connectFirestoreEmulator(db, '127.0.0.1', 8080); } catch (e) {} }
  const D = (...p) => FB.doc(db, ...p), C = p => FB.collection(db, p);

  /* ---------- online / sync state ---------- */
  const sync = {pending: 0, fromCache: true, netOnline: root.navigator ? navigator.onLine !== false : true, lastError: '', listeners: []};
  const emitSync = () => sync.listeners.forEach(f => { try { f(cloud.syncState()); } catch (e) {} });
  cloud.syncState = () => ({pending: sync.pending, online: cloud.online(), error: sync.lastError});
  cloud.onSync = f => { sync.listeners.push(f); f(cloud.syncState()); };
  cloud.online = () => sync.netOnline && !sync.fromCache;
  root.addEventListener && root.addEventListener('online', () => { sync.netOnline = true; emitSync(); });
  root.addEventListener && root.addEventListener('offline', () => { sync.netOnline = false; emitSync(); });
  /* every write goes into Firestore's queue at once (works offline); we only count it until the server has it */
  function commit(b, what) {
    sync.pending++; emitSync();
    return b.commit().then(() => { sync.pending--; sync.lastError = ''; emitSync(); })
      .catch(e => { sync.pending--; sync.lastError = (what ? what + ': ' : '') + (e.code || e.message || e); emitSync(); console.error('Save to central database failed', what, e); });
  }
  function batchWrites(ops, what) {                // ops: [['set'|'update'|'delete', ref, data?]] – max 450 per Firestore batch
    const out = [];
    for (let i = 0; i < ops.length; i += 450) {
      const b = FB.writeBatch(db);
      for (const [op, ref, data] of ops.slice(i, i + 450)) op === 'delete' ? b.delete(ref) : op === 'update' ? b.update(ref, data) : b.set(ref, data, {merge: true});
      out.push(commit(b, what));
    }
    return Promise.all(out);
  }

  /* =====================================================================================================
     The central store – same functions as the local store
     ===================================================================================================== */
  const M = {stock: new Map(), out: new Map(), profiles: new Map(), settings: new Map(), lists: {stuffings: new Map(), report_log: new Map()}, counters: new Map(), bookings: new Map()};
  /* v17.1 field-level protection: the identity of a stock row and its quantities are also stored as plain fields
     (ki / kq) that the database rules can check: an operator can never change ki, and can lower kq only together
     with the shipped-out part row written in the same save (split_to). On reading, these values win over "d". */
  const KI = {sh: 'Vendor Name', inv: 'Shipper invoice number', po: 'PO Number', st: 'Style', co: 'Colour', dn: 'Delivery No'};
  const KQ = {ctn: 'Total Packages', cbm: 'Total CBM', gw: 'Gross weight (kg)', nw: 'Net weight (kg)'};
  const kStr = v => String(v == null ? '' : v).trim().toUpperCase(), kNum = v => { const n = Number(v); return isFinite(n) ? Math.round(n * 1000) / 1000 : 0; };
  const kiOf = data => Object.fromEntries(Object.entries(KI).map(([k, f]) => [k, kStr(data[f])]));
  const kqOf = data => Object.fromEntries(Object.entries(KQ).map(([k, f]) => [k, kNum(data[f])]));
  function kApply(data, ki, kq) {
    if (ki) for (const [k, f] of Object.entries(KI)) if (ki[k] !== undefined && kStr(data[f]) !== ki[k]) data[f] = ki[k];
    if (kq) for (const [k, f] of Object.entries(KQ)) if (kq[k] !== undefined && kNum(data[f]) !== kq[k] && !(kq[k] === 0 && (data[f] === '' || data[f] == null))) data[f] = kq[k];
    return data;
  }
  cloud._k = {kiOf, kqOf, kApply};
  const toRec = d => { const x = d.data ? d : d; return {id: x.id, batch_id: x.batch_id, status: x.status, site: x.site, created_at: x.created_at, updated_at: x.updated_at, updated_by: x.updated_by, removed_at: x.removed_at || null, data: kApply(P(x.d) || {}, x.ki, x.kq)}; };
  const stockDoc = r => ({id: r.id, batch_id: r.batch_id ?? null, status: r.status, site: r.site, out_month: r.status === 'out' ? month(String(r.removed_at || '').slice(0, 10) || ist.date()) : '',
    created_at: r.created_at, updated_at: r.updated_at, updated_by: r.updated_by, removed_at: r.removed_at || null, d: J(r.data), ki: kiOf(r.data), kq: kqOf(r.data), split_to: r.split_to || null,
    uid: cloud.user ? cloud.user.uid : ''});      // v16.1: who wrote it – checked by the database rules, so the history cannot be faked
  const siteOfData = d => String((d && d['Warehouse ID']) || F.siteLock() || '').trim().toUpperCase();
  const putMirror = r => { M.stock.delete(r.id); M.out.delete(r.id); if (r.status === 'in' || r.status === 'pending') M.stock.set(r.id, r); else if (r.status === 'out') M.out.set(r.id, r); };
  const copyRec = r => Object.assign({}, r, {data: Object.assign({}, r.data)});

  const cs = {
    now,
    async profiles() { return [...M.profiles.values()].map(clone).sort((a, b) => a.shipper < b.shipper ? -1 : 1); },
    async profileByShipper(sh) { const p = [...M.profiles.values()].find(x => x.shipper === sh); return p ? clone(p) : undefined; },
    async saveProfile(shipper, data, user) {
      const cur = [...M.profiles.values()].find(x => x.shipper === shipper);
      const rec = {id: cur ? cur.id : newId(), shipper, data, updated_at: now(), updated_by: user};
      M.profiles.set(rec.id, rec);
      batchWrites([['set', D('profiles', String(rec.id)), {id: rec.id, shipper, json: J(data), updated_at: rec.updated_at, updated_by: user}]], 'shipper format');
    },
    async updateProfile(id, data, user) { const cur = M.profiles.get(id); if (!cur) return; return cs.saveProfile(cur.shipper, data, user); },
    async deleteProfile(id) { M.profiles.delete(id); batchWrites([['delete', D('profiles', String(id))]], 'delete format'); },
    async addBatch(shipper, invoice, files, user, rows, status = 'in') {
      const bid = newId(), t = now(), ops = [['set', D('batches', String(bid)), {id: bid, shipper, invoice, files: (files || []).map(String), created_at: t, created_by: user}]];
      for (const r of rows) {
        const rec = {id: newId(), batch_id: bid, data: r, status, site: siteOfData(r), created_at: t, updated_at: t, updated_by: user};
        putMirror(rec); ops.push(['set', D('stock', String(rec.id)), stockDoc(rec)]);
      }
      batchWrites(ops, 'stock'); return bid;
    },
    async stock(status = 'in') {
      const src = status === 'out' ? [...M.out.values()] : status ? [...M.stock.values()].filter(r => r.status === status) : [...M.stock.values(), ...M.out.values()];
      return src.sort((a, b) => a.id - b.id).map(copyRec);
    },
    async updateStock(id, data, user) {
      const cur = M.stock.get(id) || M.out.get(id); if (!cur) return;
      const rec = Object.assign({}, cur, {data: clone(data), updated_at: now(), updated_by: user, site: siteOfData(data) || cur.site, split_to: null});
      putMirror(rec); batchWrites([['set', D('stock', String(id)), stockDoc(rec)]], 'stock edit');
    },
    /* v17.1 part stuffing in ONE save: the row left in stock (lower quantities) + the shipped-out part (new row) */
    async splitStock(id, restData, outData, user) {
      const cur = M.stock.get(id); if (!cur) throw new Error('This row is no longer in stock. Reload.');
      const t = now(), bid = newId(), oid = newId();
      const outRec = {id: oid, batch_id: bid, data: clone(outData), status: 'out', site: siteOfData(outData) || cur.site, created_at: t, updated_at: t, updated_by: user, removed_at: t};
      const rest = Object.assign({}, cur, {data: clone(restData), updated_at: t, updated_by: user, split_to: oid});
      putMirror(outRec); putMirror(rest);
      batchWrites([['set', D('batches', String(bid)), {id: bid, shipper: 'STUFFED (PART)', invoice: outData['Shipper invoice number'] || '', files: [], created_at: t, created_by: user}],
        ['set', D('stock', String(oid)), stockDoc(outRec)], ['set', D('stock', String(id)), stockDoc(rest)]], 'part stuffing');
      return oid;
    },
    async setStatus(ids, status, user) {
      const ops = [];
      for (const id of ids) {
        const cur = M.stock.get(id) || M.out.get(id); if (!cur) continue;
        const rec = Object.assign({}, cur, {status, removed_at: status !== 'in' && status !== 'pending' ? now() : null, updated_by: user, updated_at: now(), split_to: null});
        if (status === 'deleted') { M.stock.delete(id); M.out.delete(id); } else putMirror(rec);
        ops.push(['set', D('stock', String(id)), stockDoc(rec)]);
      }
      if (ops.length) batchWrites(ops, 'stock status');
    },
    async audit(user, action, detail) {
      const id = newId(), at = now();
      batchWrites([['set', D('audit', String(id)), {id, at, day: at.slice(0, 10), user, uid: cloud.user ? cloud.user.uid : '', action, detail: String(detail).slice(0, 2000), site: F.siteLock() || ''}]], 'history');
    },
    /* v16.1: the scrambled admin PIN lives in secrets/admin_pin, readable by admins only (was settings/admin_pin) */
    async adminPin() {
      if (!cloud.profile || cloud.profile.role !== 'admin') return null;
      if (M.pin === undefined) {
        try { const d = await FB.getDoc(D('secrets', 'admin_pin')); M.pin = d.exists() ? P(d.data().json) : null; } catch (e) { return null; }
        const old = M.settings.get('admin_pin');
        if (!M.pin && old) { M.pin = old; batchWrites([['set', D('secrets', 'admin_pin'), {json: J(old), updated_at: now(), by: cloud.profile.user_id}], ['delete', D('settings', 'admin_pin')]], 'admin PIN moved'); }
        else if (M.pin && old) batchWrites([['delete', D('settings', 'admin_pin')]], 'old admin PIN removed');
      }
      return clone(M.pin);
    },
    async getSetting(k) {
      if (k === 'admin_pin') return cs.adminPin();
      if (LIST_KEYS[k]) return [...M.lists[k].values()].map(clone).sort((a, b) => k === 'stuffings' ? (String(a.at) < String(b.at) ? -1 : 1) : (String(a.at) < String(b.at) ? -1 : 1));
      if (k === 'running_no') return M.counters.get(siteCode(F.siteLock())) || 1;
      return clone(M.settings.get(k));
    },
    async setSetting(k, v) {
      if (LIST_KEYS[k]) {                          // list settings live as one document per entry: write only what changed
        const key = LIST_KEYS[k], next = new Map((v || []).map(r => [key(r), r])), ops = [];
        const coll = k === 'stuffings' ? 'stuffings' : 'report_log';
        for (const [id, r] of next) { const old = M.lists[k].get(id); if (!old || J(old) !== J(r)) ops.push(['set', D(coll, id), {site: r.site || '', month: month(String(r.date || r.at || '').slice(0, 10) || ist.date()), json: J(r)}]); }
        for (const id of M.lists[k].keys()) if (!next.has(id) && !(k === 'report_log')) ops.push(['delete', D(coll, id)]);   // the report log is only ever trimmed locally
        M.lists[k] = new Map([...M.lists[k]].filter(([id]) => next.has(id) || k === 'report_log')); for (const [id, r] of next) M.lists[k].set(id, clone(r));
        if (ops.length) batchWrites(ops, k);
        return;
      }
      if (k === 'running_no') { M.counters.set(siteCode(F.siteLock()), v); batchWrites([['set', D('counters', siteCode(F.siteLock())), {running_no: v, site: F.siteLock() || ''}]], 'running number'); return; }
      if (k === 'dataFile') return;                // no data file in central mode
      if (k === 'admin_pin') { M.pin = clone(v); batchWrites([['set', D('secrets', 'admin_pin'), {json: J(v), updated_at: now(), by: cloud.profile ? cloud.profile.user_id : ''}]], 'admin PIN'); return; }
      M.settings.set(k, clone(v));
      batchWrites([['set', D('settings', k), {json: J(v), updated_at: now(), by: cloud.profile ? cloud.profile.user_id : ''}]], 'setting ' + k);
    },
    /* booking list from Customer service (PO → SHIP TO, FOB, SHIP CXL): one document per PO (+ style) */
    async getBookings() { return [...M.bookings.values()].map(clone); },
    async saveBookings(list, user) {
      const ops = [], old = ist.addDays(ist.date(), -90);
      for (const b of list) { const k = bookingKey(b); const prev = M.bookings.get(k); if (prev && J(prev) === J(b)) continue; M.bookings.set(k, clone(b)); ops.push(['set', D('bookings', k), {json: J(b), cxl: b['SHIP CXL'] || '', at: now(), by: user}]); }
      for (const [k, b] of M.bookings) if (b['SHIP CXL'] && b['SHIP CXL'] < old) { M.bookings.delete(k); ops.push(['delete', D('bookings', k)]); }
      if (ops.length) batchWrites(ops, 'booking list');
      return ops.length;
    },
    /* stuffing running number: one counter per site shared by every PC – needs the internet (transaction) */
    async nextRunningNo(site) {
      if (!cloud.online()) throw new Error('Stuffing needs the internet (to give the next running number). Try again when the line is back.');
      const ref = D('counters', siteCode(site));
      const n = await FB.runTransaction(db, async tx => { const s = await tx.get(ref); const cur = (s.exists() && s.data().running_no) || 1; tx.set(ref, {running_no: cur + 1, site}, {merge: true}); return cur; });
      M.counters.set(siteCode(site), n + 1); return n;
    },
    async snapshot() {
      return {app: 'CFS Stock Desk', kind: 'cfs_data', version: 2, central: true, saved_at: now(), saved_by: cloud.profile ? cloud.profile.user_id : '', cfs: F.siteLock(),
        profiles: await cs.profiles(), stock: await cs.stock(''), batches: [],
        report_headers: M.settings.get('report_headers') || null, cha_list: M.settings.get('cha_list') || null,
        settings: {report_headers: M.settings.get('report_headers') || null, cha_list: M.settings.get('cha_list') || null, plans: M.settings.get('plans') || null,
          stuffings: await cs.getSetting('stuffings'), lists: M.settings.get('lists') || null, report_log: await cs.getSetting('report_log')}};
    },
    async restore() { throw new Error('In the central version, data is moved up with "Move this PC\'s data to the central database" (admin).'); },
    onFileState(f) { f({handle: null, status: 'none', name: '', saved_at: '', error: ''}); },
    async initFile() {}, async saveToFile() { return false; }, async isMyFile() { return false; }, async forgetFile() {},
    async chooseNewFile() { throw new Error('Not used in the central version.'); }, async openExistingFile() { throw new Error('Not used in the central version.'); },
    fileSupported: false,
  };
  cloud.store = cs;
  for (const k of Object.keys(cs)) if (typeof cs[k] === 'function' && !(k in facade)) facade[k] = (...x) => { if (!active[k]) throw new Error('Needs the central database.'); return active[k](...x); };

  /* ---------- live copies of the central data (only changes are read after the first load) ---------- */
  const unsubs = [];
  function listen(q, onDocs, trackCache) {
    return new Promise(res => {
      let first = true;
      unsubs.push(FB.onSnapshot(q, {includeMetadataChanges: !!trackCache}, snap => {
        if (trackCache) { sync.fromCache = snap.metadata.fromCache; emitSync(); }
        onDocs(snap);
        if (first) { first = false; res(); }
      }, err => { sync.lastError = 'Reading central data: ' + (err.code || err.message); emitSync(); console.error(err); if (first) { first = false; res(); } }));
    });
  }
  const forEachChange = (snap, add, remove) => snap.docChanges().forEach(ch => ch.type === 'removed' ? remove(ch.doc) : add(ch.doc));
  function startListeners() {
    const site = cloud.profile.site, siteName = site === 'ALL' ? F.siteLock() : site.toUpperCase();
    /* one site (equality filters only, so no extra database indexes are needed); "ALL" users with no site chosen see every site */
    const bySite = (coll, ...more) => siteName ? FB.query(C(coll), FB.where('site', '==', siteName), ...more) : FB.query(C(coll), ...more);
    const months = [month(), prevMonth()];
    return Promise.all([
      listen(bySite('stock', FB.where('status', 'in', ['in', 'pending'])), snap => forEachChange(snap, d => putMirror(toRec(d.data())), d => M.stock.delete(Number(d.id))), true),
      listen(bySite('stock', FB.where('status', '==', 'out'), FB.where('out_month', 'in', months)), snap => forEachChange(snap, d => { const r = toRec(d.data()); r.status === 'out' ? putMirror(r) : M.out.delete(r.id); }, d => M.out.delete(Number(d.id)))),
      listen(C('profiles'), snap => forEachChange(snap, d => { const x = d.data(); M.profiles.set(x.id, {id: x.id, shipper: x.shipper, data: P(x.json), updated_at: x.updated_at, updated_by: x.updated_by}); }, d => M.profiles.delete(Number(d.id)))),
      listen(C('settings'), snap => forEachChange(snap, d => M.settings.set(d.id, P(d.data().json)), d => M.settings.delete(d.id))),
      listen(C('bookings'), snap => forEachChange(snap, d => M.bookings.set(d.id, P(d.data().json)), d => M.bookings.delete(d.id))),
      listen(C('counters'), snap => forEachChange(snap, d => M.counters.set(d.id, d.data().running_no || 1), d => M.counters.delete(d.id))),
      listen(bySite('stuffings', FB.where('month', 'in', months)), snap => forEachChange(snap, d => M.lists.stuffings.set(d.id, P(d.data().json)), d => M.lists.stuffings.delete(d.id))),
      listen(bySite('report_log', FB.where('month', 'in', [month()])), snap => forEachChange(snap, d => M.lists.report_log.set(d.id, P(d.data().json)), d => M.lists.report_log.delete(d.id))),
    ]);
  }
  /* older records for a report (e.g. stuffing report of an older date) – read on request */
  cloud.olderStuffings = async (site, date) => {
    const s = await FB.getDocs(FB.query(C('stuffings'), FB.where('site', '==', site), FB.where('month', '==', month(date))));
    return s.docs.map(d => P(d.data().json)).filter(Boolean);
  };
  cloud.auditDay = async (day) => { const s = await FB.getDocs(FB.query(C('audit'), FB.where('day', '==', day))); return s.docs.map(d => d.data()); };
  cloud.auditRange = async (days) => { const out = []; for (let i = 0; i < days.length; i += 10) { const s = await FB.getDocs(FB.query(C('audit'), FB.where('day', 'in', days.slice(i, i + 10)))); out.push(...s.docs.map(d => d.data())); } return out; };

  /* =====================================================================================================
     Sites (CFS list kept by the admin) – applied to the rest of the app
     ===================================================================================================== */
  const DEFAULT_SITES = [
    {name: 'SICAL DISTRIPARK', code: 'SICAL', short: 'SICAL', city: 'TUTICORIN', layout: 'GAP', header: 'EVERBLUE', active: true},
    {name: 'ST JOHN FREIGHT SYSTEMS', code: 'STJ', short: 'ST JOHN', city: 'TUTICORIN', layout: 'GAP', header: 'EVERBLUE', active: true},
    /* Chennai: switched on by the admin on its switch-over day (one week after Tuticorin) */
    {name: 'SATTVA VICHOOR CFS', code: 'SATTVA', short: 'SATTVA', city: 'CHENNAI', layout: 'APLL', header: 'PINNACLE', active: false},
    {name: 'HIND TERMINAL CFS', code: 'HTPL', short: 'HTPL', city: 'CHENNAI', layout: 'APLL', header: 'PINNACLE', active: false}];
  cloud.DEFAULT_SITES = DEFAULT_SITES;
  function applySites(list) {
    cloud.sites = list;
    const names = list.map(s => s.name.toUpperCase());
    F.CFS_LIST.splice(0, F.CFS_LIST.length, ...names);                                     // every site, also deactivated ones (old data stays readable)
    F.SELECTS['Warehouse ID'] = list.filter(s => s.active !== false).map(s => s.name.toUpperCase());   // drop-downs: active sites only
    F.TUTICORIN.splice(0, F.TUTICORIN.length, ...list.filter(s => s.layout === 'GAP').map(s => s.name.toUpperCase()));
    for (const s of list) { F.SITE_CODES[siteCode(s.code)] = s.name.toUpperCase(); if (CSD.report) CSD.report.SITES[s.name.toUpperCase()] = {short: s.short || s.code, city: s.city || '', header: s.header || 'EVERBLUE'}; }
  }
  cloud.saveSites = async list => {
    await FB.setDoc(D('config', 'sites'), {json: J(list), updated_at: now(), by: cloud.profile.user_id}, {merge: true});
    applySites(list);
  };

  /* =====================================================================================================
     Sign-in, first admin, users
     ===================================================================================================== */
  const emailOf = uid => `${String(uid).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '')}@${LOGIN_DOMAIN}`;
  cloud.validUserId = id => /^[a-z0-9][a-z0-9._-]{2,30}$/.test(String(id).trim().toLowerCase());
  async function loginEmail(userId) {
    try { const s = await FB.getDoc(D('logins', String(userId).trim().toLowerCase())); if (s.exists() && s.data().email) return s.data().email; } catch (e) {}
    return emailOf(userId);
  }
  /* v17.1 password rule: at least 10 characters with letters and digits */
  const pwBad = pw => { pw = String(pw || ''); return pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? 'Password needs at least 10 characters, with letters and digits (e.g. Tuti2026stock).' : ''; };
  cloud.pwBad = pwBad;
  cloud.signIn = async (userId, pw) => {
    const email = await loginEmail(userId);
    try { await FB.signInWithEmailAndPassword(auth, email, pw); }
    catch (e) { const c = e.code || ''; throw new Error(/too-many-requests/.test(c) ? 'Too many attempts – sign-in is blocked for a while for safety. Wait 15 minutes, or ask the admin to set a new password.' : /invalid|wrong|not-found|user-disabled/.test(c) ? 'User ID or password is not right.' : /network/.test(c) ? 'No internet. The first sign-in on a PC needs the internet.' : (e.message || c)); }
  };
  cloud.signOut = async () => { try { await FB.signOut(auth); } catch (e) {} try { localStorage.removeItem('csd_site_lock'); } catch (e) {} location.reload(); };
  cloud.changePassword = async pw => { if (pwBad(pw)) throw new Error(pwBad(pw)); await FB.updatePassword(auth.currentUser, pw); };
  cloud.needsOwner = async () => { try { const s = await FB.getDoc(D('config', 'owner')); return !s.exists(); } catch (e) { return false; } };
  /* first admin: only while the database has no owner yet */
  cloud.createFirstAdmin = async (userId, name, pw) => {
    userId = String(userId).trim().toLowerCase();
    if (!cloud.validUserId(userId)) throw new Error('User ID: 3–31 letters/numbers, no spaces (e.g. admin.everblue).');
    if (pwBad(pw)) throw new Error(pwBad(pw));
    const cred = await FB.createUserWithEmailAndPassword(auth, emailOf(userId), pw);
    const uid = cred.user.uid, b = FB.writeBatch(db);
    b.set(D('config', 'owner'), {uid, user_id: userId, at: now()});
    b.set(D('users', uid), {uid, user_id: userId, name: name || userId, role: 'admin', site: 'ALL', active: true, created_at: now(), created_by: userId});
    b.set(D('logins', userId), {email: emailOf(userId), uid});
    b.set(D('config', 'sites'), {json: J(DEFAULT_SITES), updated_at: now(), by: userId});
    await b.commit();
  };
  /* admin creates a user with a second Firebase connection (so the admin stays signed in) */
  async function makeAuthUser(email, pw) {
    const sec = FB.initializeApp(CFG, 'u' + Date.now());
    try {
      const a2 = FB.initializeAuth ? FB.initializeAuth(sec, {persistence: FB.inMemoryPersistence}) : FB.getAuth(sec);
      if (CFG.emulator) { try { FB.connectAuthEmulator(a2, 'http://127.0.0.1:9099', {disableWarnings: true}); } catch (e) {} }
      const cred = await FB.createUserWithEmailAndPassword(a2, email, pw);
      try { await FB.signOut(a2); } catch (e) {}
      return cred.user.uid;
    } finally { try { await FB.deleteApp(sec); } catch (e) {} }
  }
  const needAdmin = () => { if (!cloud.profile || cloud.profile.role !== 'admin') throw new Error('Only the admin can do this.'); if (!cloud.online()) throw new Error('This needs the internet.'); };
  cloud.listUsers = async () => { needAdmin(); const s = await FB.getDocs(C('users')); return s.docs.map(d => d.data()).sort((a, b) => a.user_id < b.user_id ? -1 : 1); };
  cloud.addUser = async ({user_id, name, role, site, password}) => {
    needAdmin(); user_id = String(user_id).trim().toLowerCase();
    if (!cloud.validUserId(user_id)) throw new Error('User ID: 3–31 letters/numbers, no spaces (e.g. ravi.stj).');
    if (!['operator', 'admin', 'management'].includes(role)) throw new Error('Choose a role.');
    if (pwBad(password)) throw new Error(pwBad(password));
    const ex = await FB.getDoc(D('logins', user_id)); if (ex.exists()) throw new Error(`User ID "${user_id}" is already used.`);
    const email = emailOf(user_id), uid = await makeAuthUser(email, password), b = FB.writeBatch(db);
    b.set(D('users', uid), {uid, user_id, name: name || user_id, role, site: site || 'ALL', active: true, created_at: now(), created_by: cloud.profile.user_id});
    b.set(D('logins', user_id), {email, uid});
    await b.commit(); cs.audit(cloud.profile.user_id, 'user_added', `${user_id} (${role}, ${site})`);
  };
  cloud.updateUser = async (uid, patch) => {
    needAdmin(); if (uid === cloud.user.uid && (patch.active === false || (patch.role && patch.role !== 'admin'))) throw new Error('You cannot block yourself or remove your own admin role.');
    const allowed = {}; for (const k of ['name', 'role', 'site', 'active']) if (k in patch) allowed[k] = patch[k];
    await FB.updateDoc(D('users', uid), allowed); cs.audit(cloud.profile.user_id, 'user_changed', `${uid}: ${J(allowed)}`);
  };
  /* forgotten password: a new sign-in is made for the same user ID (the old one stops working) */
  cloud.resetPassword = async (u, password) => {
    needAdmin(); if (pwBad(password)) throw new Error(pwBad(password));
    const email = `${u.user_id}.r${Date.now().toString(36)}@${LOGIN_DOMAIN}`, uid = await makeAuthUser(email, password), b = FB.writeBatch(db);
    b.set(D('users', uid), Object.assign({}, u, {uid, active: true, reset_at: now(), replaced: u.uid}));
    b.update(D('users', u.uid), {active: false, replaced_by: uid});
    b.set(D('logins', u.user_id), {email, uid});
    await b.commit(); cs.audit(cloud.profile.user_id, 'password_reset', u.user_id);
  };

  /* =====================================================================================================
     Start: wait for sign-in, then load the central data and hand over to the app
     ===================================================================================================== */
  cloud.ready = new Promise((resolve) => {
    let started = false;
    FB.onAuthStateChanged(auth, async user => {
      if (started) { if (!user) location.reload(); return; }
      if (!user) { CSD.cloudUI && CSD.cloudUI.showLogin(); return; }
      cloud.user = user;
      CSD.cloudUI && CSD.cloudUI.busy('Opening the central database…');
      let prof = null;
      try { const s = await FB.getDoc(D('users', user.uid)); prof = s.exists() ? s.data() : null; } catch (e) { console.error(e); }
      if (!prof || prof.active === false) { await FB.signOut(auth).catch(() => {}); CSD.cloudUI && CSD.cloudUI.showLogin(prof ? 'This user is blocked. Ask the admin.' : 'This user is not set up. Ask the admin.'); return; }
      started = true; cloud.profile = prof;
      try { localStorage.setItem('csd_user', prof.name || prof.user_id); } catch (e) {}
      try { const s = await FB.getDoc(D('config', 'sites')); applySites((s.exists() && P(s.data().json)) || DEFAULT_SITES); } catch (e) { applySites(DEFAULT_SITES); }
      unsubs.push(FB.onSnapshot(D('config', 'sites'), s => { if (s.exists()) applySites(P(s.data().json) || DEFAULT_SITES); }, () => {}));
      /* the site this user works for; "ALL" users (admin / management) pick one */
      try {
        if (prof.site !== 'ALL') localStorage.setItem('csd_site_lock', prof.site.toUpperCase());
        else { const cur = localStorage.getItem('csd_site_lock'); if (cur && !F.CFS_LIST.includes(cur)) localStorage.removeItem('csd_site_lock'); }
        if (F.siteLock()) localStorage.setItem('csd_cfs', F.siteLock());
      } catch (e) {}
      await startListeners();
      active = cs;
      resolve('cloud');
    });
  });
  root.CSD_READY = cloud.ready;
  cloud.switchSite = name => { try { name ? localStorage.setItem('csd_site_lock', name) : localStorage.removeItem('csd_site_lock'); } catch (e) {} location.reload(); };
  cloud.can = what => {
    const r = cloud.profile && cloud.profile.role;
    if (r === 'admin') return true;
    if (r === 'management') return what === 'view';
    return ['view', 'work'].includes(what);
  };
  cloud.isAdminSetting = k => ADMIN_KEYS.includes(k);

  /* ---------- move this PC's v14 data up (one clean copy per site) ---------- */
  cloud.uploadLocal = async ({site, onProgress}) => {
    needAdmin();
    const snap = await local.snapshot(), ops = [], t = now(), up = site.toUpperCase();
    const rows = (snap.stock || []).filter(r => r.status === 'in' || r.status === 'out' || r.status === 'pending');
    const mine = rows.filter(r => { const w = String((r.data || {})['Warehouse ID'] || '').trim().toUpperCase(); return !w || w === up; });
    for (const r of mine) {
      const data = Object.assign({}, r.data, {'Warehouse ID': up});
      const rec = {id: newId(), batch_id: null, data, status: r.status, site: up, created_at: r.created_at || t, updated_at: t, updated_by: (cloud.profile.user_id) + ' (moved up)', removed_at: r.removed_at || null};
      ops.push(['set', D('stock', String(rec.id)), stockDoc(rec)]); putMirror(rec);
    }
    /* shipper formats: keep the newest of each shipper */
    let fm = 0;
    for (const p of snap.profiles || []) {
      const cur = [...M.profiles.values()].find(x => x.shipper === p.shipper);
      if (!cur || String(p.updated_at || '') > String(cur.updated_at || '')) { await cs.saveProfile(p.shipper, p.data, p.updated_by || cloud.profile.user_id); fm++; }
    }
    /* settings this site used: stuffings (re-keyed to the site), plans, lists, report headers, CHA list (only if not set yet) */
    const st = snap.settings || {};
    const stf = (st.stuffings || []).filter(x => !x.site || x.site.toUpperCase() === up).map(x => Object.assign({}, x, {site: up}));
    for (const x of stf) ops.push(['set', D('stuffings', LIST_KEYS.stuffings(x)), {site: up, month: month(String(x.header && x.header.date || x.at || '').slice(0, 10) || ist.date()), json: J(x)}]);
    const maxRun = stf.reduce((m, x) => Math.max(m, Number(x.running_no) || 0), 0);
    if (maxRun) ops.push(['set', D('counters', siteCode(up)), {running_no: Math.max(maxRun + 1, Number(st.running_no) || 1), site: up}]);
    for (const k of ['lists', 'report_headers', 'cha_list']) if (st[k] && !M.settings.has(k)) ops.push(['set', D('settings', k), {json: J(st[k]), updated_at: t, by: cloud.profile.user_id}]);
    onProgress && onProgress(`Sending ${ops.length} records…`);
    await batchWrites(ops, 'move data up');
    cs.audit(cloud.profile.user_id, 'moved_up', `${up}: ${mine.length} stock rows, ${stf.length} stuffings, ${fm} shipper formats`);
    return {rows: mine.length, in: mine.filter(r => r.status === 'in').length, out: mine.filter(r => r.status === 'out').length, pending: mine.filter(r => r.status === 'pending').length, stuffings: stf.length, formats: fm, other_site: rows.length - mine.length};
  };
  /* formats only (from every PC) */
  cloud.uploadFormats = async () => {
    const snap = await local.snapshot(); let n = 0;
    for (const p of snap.profiles || []) { const cur = [...M.profiles.values()].find(x => x.shipper === p.shipper);
      if (!cur || String(p.updated_at || '') > String(cur.updated_at || '')) { await cs.saveProfile(p.shipper, p.data, p.updated_by || cloud.profile.user_id); n++; } }
    return n;
  };
  cloud.flush = () => FB.waitForPendingWrites(db);
  /* e-mail bookkeeping: one claim per site / day / report so only one PC sends it (the Google script checks the same) */
  cloud.claimMail = async (id, info) => {
    if (!cloud.online()) return false;
    const ref = D('mail_state', id);
    return FB.runTransaction(db, async tx => {
      const s = await tx.get(ref);
      if (s.exists()) { const x = s.data(); if (x.status === 'sent' || x.status === 'sending' && x.at > ist.stamp(new Date(Date.now() - 10 * 60000))) return false; }
      tx.set(ref, Object.assign({status: 'sending', at: now(), by: cloud.profile.user_id}, info || {})); return true;
    });
  };
  cloud.finishMail = (id, status, extra) => FB.setDoc(D('mail_state', id), Object.assign({status, done_at: now()}, extra || {}), {merge: true});
  cloud.mailState = async id => { try { const s = await FB.getDoc(D('mail_state', id)); return s.exists() ? s.data() : null; } catch (e) { return null; } };
  cloud.logMail = e => { const id = newId(); return batchWrites([['set', D('mail_log', String(id)), Object.assign({id, at: now(), day: ist.date(), by: cloud.profile.user_id}, e)]], 'e-mail log'); };
  cloud.mailLog = async day => { const s = await FB.getDocs(FB.query(C('mail_log'), FB.where('day', '==', day || ist.date()))); return s.docs.map(d => d.data()).sort((a, b) => String(b.at).localeCompare(String(a.at))); };
})(typeof self !== 'undefined' ? self : globalThis);
