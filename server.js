/* Local "server" inside the browser. The screens were written for the desktop version, which talks to a small
   server with requests like fetch('/api/stock'). Here those requests never leave the PC: they are answered by the
   functions below, using the browser's own storage. Same routes and answers as the desktop version (app.py). */
(function (root) {
  const CSD = root.CSD, F = CSD.F, P = CSD.P, V = CSD.V, R = CSD.R, store = CSD.store, REP = CSD.report;
  const empty = v => v === null || v === undefined || v === '';
  const JOBS = new Map();
  /* the CFS this PC works for (chosen in the top bar; kept in this browser) */
  function thisCfs() { const l = F.siteLock(); if (l) return l; try { const v = localStorage.getItem('csd_cfs') || ''; return F.CFS_LIST.includes(v) ? v : ''; } catch (e) { return ''; } }
  /* site mode: only this site's rows (rows without a CFS are treated as this site's) */
  const whOf = r => String((r && r['Warehouse ID']) || '').trim().toUpperCase();

  /* v17.1 daily reconciliation: today's opening = the last closing of an earlier day; opening + in − out = closing */
  async function reconcile(site, day, closingTotal) {
    const S = String(site || '').toUpperCase(), atSite = d => !S || String(d['Warehouse ID'] || '').toUpperCase() === S, n = v => Number(v) || 0, r3 = v => Math.round(v * 1000) / 1000;
    const log = (await store.getSetting('report_log')) || [];
    const prev = log.filter(x => x.slot === 'closing' && x.date < day && String(x.site || '').toUpperCase() === S).sort((a, b) => String(a.date + a.at).localeCompare(String(b.date + b.at))).pop();
    const all = await store.stock(null);
    const inRows = all.filter(s => s.status !== 'pending' && s.status !== 'deleted' && String(s.data['Offloaded At'] || '').startsWith(day) && atSite(s.data));
    const outRows = all.filter(s => s.status === 'out' && String(s.data['Stuffing Date'] || '').slice(0, 10) === day && atSite(s.data));
    const sum = rs => ({pkgs: rs.reduce((t, s) => t + n(s.data['Total Packages']), 0), cbm: r3(rs.reduce((t, s) => t + n(s.data['Total CBM']), 0))});
    const inn = sum(inRows), out = sum(outRows);
    let closing = closingTotal ? {pkgs: n(closingTotal.pkgs), cbm: r3(n(closingTotal.cbm))} : sum(all.filter(s => s.status === 'in' && atSite(s.data)).filter(s => siteRows([s.data]).length));
    let audit = []; try { audit = cloudOn() ? await CSD.cloud.auditDay(day) : (store.auditDay ? await store.auditDay(day) : []); } catch (e) { audit = []; }
    const adminCh = audit.filter(a => /stock_edit|stock_delete|return|stuff_override|offload_undo/.test(a.action || '')).length;
    if (!prev) return {ok: true, opening: null, in: inn, out, closing, note: 'No closing report of an earlier day yet – the check starts from the next day.'};
    const opening = {date: prev.date, pkgs: n(prev.pkgs), cbm: r3(n(prev.cbm))};
    const expected = {pkgs: opening.pkgs + inn.pkgs - out.pkgs, cbm: r3(opening.cbm + inn.cbm - out.cbm)};
    const diff = {pkgs: closing.pkgs - expected.pkgs, cbm: r3(closing.cbm - expected.cbm)};
    return {ok: diff.pkgs === 0 && Math.abs(diff.cbm) < 0.01, opening, in: inn, out, expected, closing, diff, admin_changes: adminCh};
  }
  function siteRows(rows) {
    const l = F.siteLock(); if (!l) return rows;
    return rows.filter(r => { const w = whOf(r); return w === l || w === ''; }).map(r => whOf(r) ? r : Object.assign({}, r, {'Warehouse ID': l}));
  }
  const VERSION = '17.1-web';

  /* ---------- helpers (same as app.py) ---------- */
  function coerce(field, v) {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
    if (F.DATES.has(field)) return CSD.normDate(v) || String(v).trim();
    if (F.TIMES.has(field)) return CSD.normTime(v) || String(v).trim();
    if (F.NUMERIC.has(field)) {
      const c = typeof v === 'number' ? [v] : P.numCandidates(v); if (!c.length) return null;
      return c[0];
    }
    let s = String(v).replace(/\s+/g, ' ').trim();
    if (F.IDS.has(field)) s = s.replace(/ /g, '');
    return F.TIMES.has(field) ? s : s.toUpperCase();
  }
  async function customerMaster() {
    const m = {};
    for (const [k, v] of Object.entries(F.CUSTOMERS)) m[k] = {'Customer Code': v[0], 'Customer Type': v[1], GroupName: v[2]};
    const rows = await store.stock(null);
    for (const s of rows.slice(-3000)) {
      const d = s.data, n = String(d['Customer Name'] || '').toUpperCase();
      if (n && d.GroupName) m[n] = {'Customer Code': d['Customer Code'] || '', 'Customer Type': d['Customer Type'] || '', GroupName: d.GroupName};
    }
    return m;
  }
  /* CHA per shipper: the uploaded "Shipper & CHA list" first, else the CHA of the shipper's last shipment */
  async function chaMap() {
    const m = new Map();
    const rows = await store.stock(null);
    for (const s of rows) { const v = P.norm(s.data['Vendor Name']), c = s.data['CHA Name']; if (v && c) m.set(v, {shipper: String(s.data['Vendor Name']).toUpperCase(), cha: String(c).toUpperCase(), from: 'past'}); }
    const list = (await store.getSetting('cha_list')) || {};
    for (const [k, x] of Object.entries(list)) m.set(k, {shipper: x.shipper, cha: x.cha, from: 'list'});
    return m;
  }
  async function applyDefaults(header, status) {
    if (empty(header['CHA Name']) && header['Vendor Name']) {
      const c = (await chaMap()).get(P.norm(header['Vendor Name']));
      if (c) { header['CHA Name'] = c.cha; status['CHA Name'] = c.from === 'list' ? 'cha-list' : 'cha-past'; }
    }
    const m = await customerMaster();
    const cn = String(header['Customer Name'] || '').toUpperCase();
    if (m[cn]) for (const [f, v] of Object.entries(m[cn])) if (!header[f] && v) { header[f] = v; status[f] = 'default'; }
    for (const [f, v] of [['Package UOM', 'CARTONS'], ['Warehouse ID', thisCfs()]]) if (v && !header[f]) { header[f] = v; status[f] = 'default'; }
  }
  function finishResult(docs, header, hsrc, items, status) {
    const totals = items.length ? P.totalChecks(items, docs) : {};
    for (const it of items) if (header['PO Number'] && !it['PO Number']) it['PO Number'] = header['PO Number'];
    return {header, header_src: hsrc, header_status: status, items, totals};
  }
  /* columns each shipper does not need (Shipper formats -> column settings), by shipper name */
  async function notNeededMap() {
    const m = new Map();
    for (const p of await store.profiles()) { const n = Object.entries((p.data && p.data.need) || {}).filter(([, v]) => v === 'no').map(([f]) => f); if (n.length) m.set(P.norm(p.shipper), n); }
    return m;
  }
  const nnOf = (m, r) => m.get(P.norm(r['Vendor Name'])) || [];
  /* Received Pkgs = booked cartons unless entered; different = OSD (overage / shortage) with type and cartons filled */
  function osdFill(r) {
    const tp = Number(r['Total Packages']);
    if (empty(r['Received Pkgs']) && !empty(r['Total Packages'])) r['Received Pkgs'] = r['Total Packages'];
    const rc = Number(r['Received Pkgs']);
    if (!empty(r['Received Pkgs']) && tp && rc !== tp) {
      if (empty(r.OSD)) r.OSD = 'Yes';
      if (String(r.OSD).toUpperCase() === 'YES') {
        if (empty(r['OSD type'])) r['OSD type'] = rc < tp ? 'SHORTAGE' : 'OVERAGE';
        if (empty(r['Total OSD cartons'])) r['Total OSD cartons'] = Math.abs(tp - rc);
      }
    }
    if (String(r.OSD || '').toUpperCase() === 'NO' && empty(r['OSD Remarks'])) r['OSD Remarks'] = 'NO OSD';
    return r;
  }
  /* Tuticorin OSD: overage / shortage from the cartons, damage from the damage lines (PO, style, colour, size, cartons, type) */
  const ctnCount = s => String(s || '').split(/[,;\s]+/).filter(Boolean).reduce((n, p) => { const m = p.match(/^(\d+)\s*[-–]\s*(\d+)$/); return n + (m ? Math.max(1, Math.abs(+m[2] - +m[1]) + 1) : 1); }, 0);
  function damageFill(rows, lines, header) {
    const anyDmg = String(header['Any Damage'] || '').toUpperCase();
    lines = (lines || []).filter(l => l && (l.po || l.style || l.cartons || l.type));
    if (anyDmg === 'YES' && !lines.length) return 'Any damaged cartons = Yes: add the damage lines (PO, Style, Carton no(s), Damage type).';
    if (anyDmg !== 'YES') lines = [];
    for (const [i, l] of lines.entries()) {
      if (!l.po || !l.style || !l.cartons || !l.type) return `Damage line ${i + 1}: PO, Style, Carton no(s) and Damage type are needed.`;
      if (l.type === 'Others' && !String(l.remark || '').trim()) return `Damage line ${i + 1}: "Others" needs a remark.`;
      const n = ctnCount(l.cartons); if (!n) return `Damage line ${i + 1}: carton numbers not understood ("${l.cartons}").`;
      l.count = n;
      if (!rows.some(r => P.norm(r['PO Number']) === P.norm(l.po) && P.norm(r.Style) === P.norm(l.style))) return `Damage line ${i + 1}: PO ${l.po} / style ${l.style} is not in this shipment.`;
    }
    for (const r of rows) {
      const tp = Number(r['Total Packages']) || 0, rc = empty(r['Received Pkgs']) ? tp : Number(r['Received Pkgs']);
      const mine = lines.filter(l => P.norm(l.po) === P.norm(r['PO Number']) && P.norm(l.style) === P.norm(r.Style) && (!l.colour || !r.Colour || P.norm(l.colour) === P.norm(r.Colour)));
      const dc = mine.reduce((n, l) => n + l.count, 0), diff = rc - tp;
      const types = [diff < 0 ? 'SHORTAGE' : diff > 0 ? 'OVERAGE' : '', dc ? 'DAMAGE' : ''].filter(Boolean);
      const note = String(header['OSD Remarks'] || '').trim();
      if (!types.length) { r.OSD = 'No'; r['OSD type'] = ''; r['Total OSD cartons'] = ''; r['OSD Remarks'] = note && note.toUpperCase() !== 'NO OSD' ? note : 'NO OSD'; r.Damage = []; continue; }
      const parts = [];
      if (diff) parts.push(`${diff < 0 ? 'Short' : 'Excess'} ${Math.abs(diff)} ctn(s)`);
      for (const l of mine) parts.push(`Damaged ctn ${l.cartons}${l.size ? ' (size ' + l.size + ')' : ''}: ${l.type}${l.remark ? ' – ' + l.remark : ''}`);
      r.OSD = 'Yes'; r['OSD type'] = types.join(' & '); r['Total OSD cartons'] = Math.abs(diff) + dc;
      r['OSD Remarks'] = [note, parts.join('; ')].filter(Boolean).join(' | ').toUpperCase();
      r.Damage = mine.map(l => ({po: l.po, style: l.style, colour: l.colour || r.Colour || '', size: l.size || '', cartons: l.cartons, count: l.count, type: l.type, remark: l.remark || ''}));
    }
    return null;
  }
  /* admin PIN (per PC): needed to edit or delete stock that has been added */
  async function pinHash(pin, salt) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + String(pin))); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  /* central version: admin actions need the admin role AND the PIN */
  const cloudOn = () => !!(CSD.cloud && CSD.cloud.enabled && store.isCloud && store.isCloud());
  const isAdminUser = () => !cloudOn() || (CSD.cloud.profile && CSD.cloud.profile.role === 'admin');
  /* v17.1 admin PIN: 5 wrong PINs → locked 15 minutes on this PC; every failure is logged */
  const pinLocal = () => CSD.localStore || store;
  async function pinLock() { const l = (await pinLocal().getSetting('pin_lock')) || {fails: 0, until: 0}; return l; }
  async function pinLockedMsg() { const l = await pinLock(); if (l.until > Date.now()) return `Admin PIN locked after 5 wrong tries – try again in ${Math.ceil((l.until - Date.now()) / 60000)} min.`; return ''; }
  async function pinOk(pin) {
    if (!isAdminUser()) return false;
    const l = await pinLock(); if (l.until > Date.now()) return false;
    const s = await store.getSetting('admin_pin'); if (!s || !pin) return false;
    if (await pinHash(pin, s.salt) === s.hash) { if (l.fails) await pinLocal().setSetting('pin_lock', {fails: 0, until: 0}); return true; }
    l.fails = (l.fails || 0) + 1; const who = (CSD.cloud && CSD.cloud.profile && CSD.cloud.profile.user_id) || 'this PC';
    try { await store.audit(who, 'pin_fail', `wrong admin PIN (${l.fails} of 5)`); } catch (e) {}
    if (l.fails >= 5) { l.until = Date.now() + 15 * 60000; l.fails = 0; try { await store.audit(who, 'pin_locked', 'admin PIN locked for 15 minutes after 5 wrong tries'); } catch (e) {} }
    await pinLocal().setSetting('pin_lock', l);
    return false;
  }
  /* things that wait for the internet in the central version (decision: safe work only offline) */
  function needsNet(method, path, body) {
    if (method === 'GET') return '';
    if (path === '/api/stuff') return 'Stuffing needs the internet (running number). Try again when the line is back.';
    if (/^\/api\/stock\/\d+$/.test(path) || path === '/api/stock/return' || path === '/api/lists' || path === '/api/admin-pin' || path === '/api/cha-list' || path === '/api/booking') return 'Admin changes need the internet. Try again when the line is back.';
    if (path === '/api/stock/status' && body && body.status === 'deleted') return 'Deleting stock needs the internet. Try again when the line is back.';
    if (path === '/api/save' && body && body.admin_pin) return 'Saving the same invoice again (admin) needs the internet.';
    if (path === '/api/mail/send') return 'Sending e-mail needs the internet.';
    return '';
  }
  const today = () => CSD.ist.date();          // India time
  /* booking list (PO → SHIP TO, FOB, SHIP CXL) */
  async function bookingIndex() { const m = new Map(); for (const b of (await store.getBookings()) || []) { const po = P.norm(b['PO Number']); if (!po) continue; m.set(po + '|' + P.norm(b.Style || ''), b); if (!m.has(po + '|')) m.set(po + '|', b); } return m; }
  const bookingOf = (d, bk) => bk.get(P.norm(d['PO Number']) + '|' + P.norm(d.Style || '')) || bk.get(P.norm(d['PO Number']) + '|') || null;
  function shipMark(d, bk, t0) {
    const b = bookingOf(d, bk), cxl = (b && b['SHIP CXL']) || d['SHIP CXL'] || '';
    if (!cxl) return {missing: true, ship_to: (b && b['SHIP TO']) || d['SHIP TO'] || ''};
    const [y, mo, dd] = cxl.split('-').map(Number), [y0, m0, d0] = t0.split('-').map(Number);
    const days = Math.round((Date.UTC(y, mo - 1, dd) - Date.UTC(y0, m0 - 1, d0)) / 86400000);
    return {cxl, days, ship_to: (b && b['SHIP TO']) || d['SHIP TO'] || '', mark: days <= 5 ? 'red' : days <= 10 ? 'amber' : ''};
  }
  const BOOK_ALIAS = {'Customer Name': /^(customer( name)?|buyer|brand)$/, 'PO Number': /^(po\.?\s*(no|number)?\.?|purchase order( no)?)$/, Style: /^style( no)?\.?$/, 'SHIP TO': /^ship\s*to$/,
    FOB: /^fob$/, 'T.POINT': /^t\.?\s*point$/, 'SHIP CXL': /^ship\s*(cxl|cancel( date)?)$/, 'Port of Discharge': /^port of discharge$|^pod$/, 'Final Destination': /^final destination$|^fpd$/, Remarks: /^remarks?$/,
    'CARGO CUT-OFF': /^cargo\s*cut[\s-]*off(\s*date)?(\s*(&|and)\s*time)?$|^cut[\s-]*off$/, 'CARGO CUT-OFF TIME': /^cargo\s*cut[\s-]*off\s*time$|^cut[\s-]*off\s*time$/};
  /* v17.1: "28-11-2026 18:00", Excel date-time number, or date + separate time column → {date, time} */
  function cutoffOf(v, t) {
    let date = '', time = '';
    if (typeof v === 'number' && v > 20000 && v < 80000) { const ms = Math.round((v % 1) * 1440); date = isoDate(Math.floor(v)); if (ms) time = String(Math.floor(ms / 60)).padStart(2, '0') + ':' + String(ms % 60).padStart(2, '0'); }
    else { const str = String(v ?? '').trim(), m = str.match(/(\d{1,2}):(\d{2})/); date = isoDate(str.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(hrs|h)?$/i, '').trim()); if (m) time = m[1].padStart(2, '0') + ':' + m[2]; }
    if (t !== undefined && t !== '') { if (typeof t === 'number' && t < 1) { const ms = Math.round(t * 1440); time = String(Math.floor(ms / 60)).padStart(2, '0') + ':' + String(ms % 60).padStart(2, '0'); } else { const m = String(t).match(/(\d{1,2})[:.](\d{2})/); if (m) time = m[1].padStart(2, '0') + ':' + m[2]; } }
    return {date, time};
  }
  function isoDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10); }
    if (v instanceof Date) return CSD.ist.date(v);
    const s = String(v).trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if ((m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})$/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const MO = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
    if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]*(\d{2,4})$/)) && MO[m[2].toLowerCase()]) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${String(MO[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
  }
  function readBookings(buf) {
    const wb = root.XLSX.read(buf, {type: 'array', cellDates: false}); const out = []; let found = false;
    for (const name of wb.SheetNames) {
      const aoa = root.XLSX.utils.sheet_to_json(wb.Sheets[name], {header: 1, raw: true, defval: ''});
      for (let i = 0; i < Math.min(aoa.length, 30); i++) {
        const map = {}; aoa[i].forEach((h, j) => { const k = String(h || '').trim().toLowerCase().replace(/\s+/g, ' '); for (const [f, re] of Object.entries(BOOK_ALIAS)) if (re.test(k) && map[f] === undefined) map[f] = j; });
        if (map['PO Number'] === undefined || map['SHIP CXL'] === undefined) continue;
        found = true;
        for (const row of aoa.slice(i + 1)) {
          const po = String(row[map['PO Number']] ?? '').trim(); if (!po) continue;
          const b = {}; for (const [f, j] of Object.entries(map)) b[f] = f === 'SHIP CXL' ? isoDate(row[j]) : f.startsWith('CARGO CUT-OFF') ? '' : String(row[j] ?? '').trim().toUpperCase();
          if (map['CARGO CUT-OFF'] !== undefined) { const c = cutoffOf(row[map['CARGO CUT-OFF']], map['CARGO CUT-OFF TIME'] !== undefined ? row[map['CARGO CUT-OFF TIME']] : undefined); b['Cargo Cutoff Date'] = c.date; b['Cargo Cutoff Time'] = c.time; }
          delete b['CARGO CUT-OFF']; delete b['CARGO CUT-OFF TIME'];
          b['PO Number'] = po.toUpperCase(); if (/^example/i.test(b.Remarks || '')) continue; out.push(b);
        }
        break;
      }
    }
    if (!found) throw new Error('Headings "PO No" and "SHIP CXL" not found. Use the booking list template.');
    return out;
  }
  async function stockKeys(excludeIds = new Set()) {
    return new Set([...(await store.stock('pending')), ...(await store.stock('in'))].filter(s => !excludeIds.has(s.id)).map(s => s.data).filter(V.keyComplete).map(V.rowKey));
  }
  const log = (job, msg) => { job.log.push({at: CSD.ist.stamp().slice(11), msg}); };

  /* Read the values out of the documents: saved format first, automatic reading for whatever is still empty,
     then the shipper's "read this column from the invoice / packing list" choices. */
  function extract(allDocs, profData, sources) {
    sources = sources || {};
    const docs = P.withoutVdf(allDocs);            // the VDF gives only the Delivery No
    let header = {}, hsrc = {}, items = [], status = {};
    const prof = profData ? Object.assign({}, profData, {source: sources}) : null;
    if (prof) {
      const r = P.applyProfile(prof, docs);
      header = r.header; hsrc = r.src; items = r.items;
      for (const f of Object.keys(header)) status[f] = r.how[f] === 'fixed' ? 'fixed' : 'profile';
    }
    let auto = {header: {}, src: {}, items: []};
    try { auto = CSD.A.guess(docs); } catch (e) { console.warn('auto read failed', e); }
    const autoOf = {};
    const autoHeader = f => {
      const t = sources[f]; if (!t || t === 'auto') return [auto.header[f], auto.src[f]];
      if (!autoOf[t]) { const sub = CSD.A.docsFor(docs, t); autoOf[t] = sub.length ? CSD.A.headerGuess(sub) : {header: {}, src: {}}; }
      return [autoOf[t].header[f], autoOf[t].src[f]];
    };
    let nAuto = 0;
    for (const f of new Set([...Object.keys(auto.header), ...Object.keys(sources)])) {
      if (!F.HEADER_FIELDS.includes(f) && f !== 'PO Number') continue;
      const [v, src] = autoHeader(f);
      if (empty(header[f]) && !empty(v)) { header[f] = v; status[f] = 'auto'; if (src) hsrc[f] = src; nAuto++; }
    }
    if (!items.length && auto.items.length) { items = auto.items; nAuto += items.length; }
    else if (items.length && auto.items.length) {      // known format: fill single missing cells only when the style matches
      for (const it of items) { const a = auto.items.find(x => P.canon(x.Style) === P.canon(it.Style)); if (!a) continue;
        for (const f of F.ITEM_FIELDS) if (empty(it[f]) && !empty(a[f])) { it[f] = a[f]; (it._ai = it._ai || {})[f] = 'auto'; (it._src = it._src || {})[f] = a._src[f]; }
        /* gross weight is always the largest weight printed for the row: if the saved format picked a smaller one
           (usually net weight, when the "Gross" heading is unreadable on a scan), use the larger one and mark it to check */
        const g = 'Gross weight (kg)';
        if (!sources[g] && typeof it[g] === 'number' && typeof a[g] === 'number' && a[g] > it[g] * 1.02 && a[g] < it[g] * 3) {
          it[g] = a[g]; (it._ai = it._ai || {})[g] = 'auto'; (it._src = it._src || {})[g] = a._src[g];
        } }
    }
    if (Object.values(sources).some(t => t && t !== 'auto')) CSD.A.overrideItems(items, docs, sources, prof && prof.items);
    /* gross and nett read the wrong way round (a saved layout on a scan without the "Gross" heading):
       swap them back when the automatic reading shows exactly the two values the other way, and mark them to check */
    { const g = 'Gross weight (kg)', n = 'Net weight (kg)';
      for (const it of items) {
        if (!(typeof it[g] === 'number' && typeof it[n] === 'number' && it[n] > it[g])) continue;
        const a = auto.items.find(x => P.canon(x.Style) === P.canon(it.Style) && typeof x[g] === 'number');
        if (a && Math.abs(a[g] - it[n]) < 0.01 && (a[n] === undefined || a[n] === null || Math.abs(a[n] - it[g]) < 0.01 || a[n] <= a[g])) {
          const t = it[g]; it[g] = it[n]; it[n] = t; it._ai = Object.assign(it._ai || {}, {[g]: 'auto', [n]: 'auto'});
        }
      } }
    /* Tuticorin: packing-list values that differ from the invoice are shown (amber) and must be ticked as checked */
    if (isTut() && CSD.A.docsFor(docs, 'packing').length && CSD.A.docsFor(docs, 'invoice').length) {
      const plF = F.PL_FIELDS.filter(f => sources[f] === 'packing');
      if (plF.length) {
        const inv = items.map(it => Object.assign({}, it, {_src: {}, _ai: {}}));
        CSD.A.overrideItems(inv, docs, Object.fromEntries(plF.map(f => [f, 'invoice'])), prof && prof.items);
        const same = (a, b) => typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a) - Number(b)) < 0.0051 : P.norm(a) === P.norm(b);
        items.forEach((it, i) => { for (const f of plF) { const v = inv[i][f]; if (!empty(v) && !empty(it[f]) && !same(v, it[f])) (it._diff = it._diff || {})[f] = v; } });
      }
    }
    /* v15.1: columns the operator trained with Pick for this shipper win (row k = k-th place found) */
    const pickWarn = [];
    if (prof && prof.picks && Object.keys(prof.picks).length) {
      const before = items.filter(it => !empty(it.Style)).length;
      const r = P.applyPicks(prof.picks, docs, items); items = r.items; nAuto += r.filled;
      /* v16.1: the shipper's layout may have changed – say so instead of a silent partial read */
      if (r.none.length) pickWarn.push({kind: 'none', fields: r.none, msg: `Not found in the trained place any more: ${r.none.join(', ')}. The shipper's layout may have changed – pick these again.`});
      const c = r.counts || {}, n = c.Style || 0;
      if (n && before && n !== before) pickWarn.push({kind: 'count', fields: ['Style'], msg: `The trained layout found ${n} line(s), the automatic reading found ${before}. Check that no line is missing or extra.`});
      for (const [f, k] of Object.entries(c)) if (n && f !== 'Style' && f !== 'PO Number' && f !== 'Delivery No' && k < n) pickWarn.push({kind: 'short', fields: [f], msg: `${f}: found for ${k} of ${n} line(s) – pick it again on a line where it is missing.`});
      const doubt = new Set(pickWarn.filter(w => w.kind !== 'none').flatMap(w => w.fields));
      for (const it of items) for (const f of doubt) if (it._ai && it._ai[f] === 'trained') it._ai[f] = 'auto';   // asked again in the steps
    }
    /* v17: Carrefour packing list – read by the buyer's template (no training needed); checked against the printed totals. */
    let crf = null, crfUsed = false, vdfWrong = false;
    try { crf = CSD.CRF ? CSD.CRF.read(docs) : null; } catch (e) { console.warn('Carrefour reader failed', e); }
    if (crf && crf.lines.length) {
      /* v17.1: the template reading always wins for Carrefour documents – old Pick training of the shipper is not used
         (it filled e.g. "COLOUR: SAB" from the side marks); what does not add up is shown and asked */
      {
        /* a warning about one item makes only that item doubtful; a general one (cartons do not add up …) all of them */
        const own = crf.warn.filter(w => !/without a packing list|^Packing list [\d, ]+ of \d+ missing|^Scan letters/.test(w));
        const general = own.some(w => !/I\d{6}/.test(w));
        items = crf.lines.map(L => {
          const doubt = general || own.some(w => w.includes(L.Style));
          const it = {_src: Object.assign({}, L._src), _ai: {}};
          for (const [k, v] of Object.entries(L)) if (!k.startsWith('_')) { it[k] = v; if (!empty(v)) it._ai[k] = doubt ? 'auto' : 'template'; }
          if (L._missingPL) it._missingPL = true;
          return it;
        });
        nAuto += items.length;
        pickWarn.length = 0;
        /* header fields with fixed labels on the Carrefour documents (Buyer, Consignee, Port of Discharge, Final Destination, Seller) */
        try { const h = CSD.CRF.header(docs);
          for (const [f, v] of Object.entries(h.header)) if (empty(header[f]) || status[f] === 'auto' || P.norm(header[f]) === P.norm(v)) { header[f] = v; status[f] = 'template'; if (h.src[f]) hsrc[f] = h.src[f]; }
          /* v17.1: invoice number / date – cleaned, and green when the packing list prints the same */
          const inv = CSD.CRF.cleanInvoice(header['Shipper invoice number']);
          if (inv) { header['Shipper invoice number'] = inv; const ok = CSD.CRF.confirmInvoice(docs, inv, header['Invoice Date']);
            status['Shipper invoice number'] = ok.inv ? 'template' : 'auto'; if (header['Invoice Date']) status['Invoice Date'] = ok.date ? 'template' : 'auto'; }
          /* v17.1: Cargo Description from the product text (MADEUPS / TOYS / GARMENTS) */
          if (crf.commodity) { header['Cargo Description'] = crf.commodity; status['Cargo Description'] = 'template'; }
        } catch (e) { console.warn('Carrefour header', e); }
        crfUsed = true;
        if (!crf.ok) pickWarn.push({kind: 'carrefour', fields: [], msg: crf.warn.join(' ')});
      }
    }
    if (prof && prof.item_defaults) for (const it of items) for (const [f, v] of Object.entries(prof.item_defaults)) if (empty(it[f])) { it[f] = v; (it._ai = it._ai || {})[f] = 'fixed'; }
    /* v16.1: Type – the document's word (CRTNS …) to the list's word; CARTONS when not printed (change it if needed) */
    for (const it of items) {
      if (empty(it['Qty Type'])) { it['Qty Type'] = 'CARTONS'; (it._ai = it._ai || {})['Qty Type'] = 'fixed'; }
      else it['Qty Type'] = V.qtyType(it['Qty Type']);
      if (!(F.SELECTS['Qty Type'] || []).includes(it['Qty Type'])) { it['Qty Type'] = 'CARTONS'; (it._ai = it._ai || {})['Qty Type'] = 'fixed'; if (it._src) delete it._src['Qty Type']; }   // e.g. a number from an old Type training
    }
    /* Delivery No only from the VDF (APL Logistics "Vendors Cargo Delivery Notice"), matched to the PO printed on it */
    const vdf = P.vdfDeliveries(allDocs);
    /* v17.1: a VDF on which none of the invoice's POs is printed is the wrong VDF (e.g. yesterday's) – no Delivery No is taken */
    if (vdf.length) { const pos = [...new Set(items.map(it => P.norm(it['PO Number'] || header['PO Number'] || '')).filter(x => x.length >= 6))];
      if (pos.length && !vdf.some(v => pos.some(po => v.text.includes(po)))) vdfWrong = true; }
    if (vdf.length && !vdfWrong) for (const it of items) {
      const hit = vdf.find(v => it['PO Number'] && v.text.includes(P.norm(it['PO Number']))) || (vdf.length === 1 ? vdf[0] : null);   // one VDF: every row
      if (hit) { it['Delivery No'] = hit.no; (it._ai = it._ai || {})['Delivery No'] = 'auto'; if (hit.src) (it._src = it._src || {})['Delivery No'] = hit.src; }
    }
    if (vdfWrong) pickWarn.push({kind: 'block', fields: ['Delivery No'], msg: 'Wrong VDF attached – none of the POs on the VDF match this invoice. Remove it and add the right VDF.'});
    else if (vdf.length) { const no = items.filter(it => empty(it['Delivery No'])); if (no.length) pickWarn.push({kind: 'carrefour', fields: ['Delivery No'], msg: `The VDF gives no Delivery No for ${no.map(it => it.Style || '?').join(', ')} (PO not on the VDF) – please type it.`}); }
    const scanned = allDocs.some(d => d.pages.some(pg => pg.kind === 'scan'));
    return {header, hsrc, items, status, nAuto, pickWarn, crf: crfUsed, vdfWrong, scanned, xofy: crf && crf.xofy};
  }
  /* v17.1: after reading – one shipper name through the alias list, the booking list (cut-off, PO, destination) */
  const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;
  async function shipperAlias() { const l = await store.getSetting('shipper_alias'); return Array.isArray(l) && l.length ? l : F.SHIPPER_ALIAS_DEFAULT; }
  async function afterExtract(r, docs) {
    const {header, status, pickWarn, items} = r;
    const text = P.withoutVdf(docs).flatMap(d => d.pages.flatMap(pg => pg.rows.map(row => row.map(c => c.t).join(' ')))).join(' ').toUpperCase();
    const gst = [...new Set(text.match(GSTIN_RE) || [])];
    if (header['Vendor Name']) {
      const c = F.canonShipper(await shipperAlias(), header['Vendor Name'], gst, header['Shipper invoice number']);
      if (c.matched) header['Vendor Name'] = c.name;
      else {
        header['Vendor Name'] = c.name;
        pickWarn.push({kind: 'info', fields: [], msg: `New shipper name "${c.name}" – not in the shipper list yet. The admin can link it under Shipper formats → Unmapped shippers.`});
        const un = (await store.getSetting('shipper_unmapped')) || [];
        if (!un.some(u => F.shipperKey(u.name) === F.shipperKey(c.name))) { un.push({name: c.name, gstin: gst.slice(0, 2), invoice: header['Shipper invoice number'] || '', at: CSD.ist.stamp()}); await store.setSetting('shipper_unmapped', un.slice(-200)); }
      }
      if (c.conflict) { status['Vendor Name'] = 'auto'; pickWarn.push({kind: 'carrefour', fields: ['Vendor Name'], msg: `Shipper ${c.name} – but invoice ${header['Shipper invoice number']} looks like ${c.conflict}'s invoice numbers. Check which shipper this truck is for.`}); }
    }
    /* booking list: cargo cut-off of the PO; PO not booked; final destination different from SHIP TO */
    const book = await store.getBookings();
    if (book.length) {
      const pos = [...new Set(items.map(it => P.norm(it['PO Number'] || '')).filter(Boolean))];
      const hit = po => book.filter(b => P.norm(b['PO Number']) === po);
      const notBooked = pos.filter(po => !hit(po).length);
      const withCut = pos.flatMap(hit).find(b => b['Cargo Cutoff Date']);
      if (withCut && empty(header['Cargo Cutoff Date'])) { header['Cargo Cutoff Date'] = withCut['Cargo Cutoff Date']; status['Cargo Cutoff Date'] = 'template';
        if (withCut['Cargo Cutoff Time']) { header['Cargo Cutoff Time'] = withCut['Cargo Cutoff Time']; status['Cargo Cutoff Time'] = 'template'; } }
      if (notBooked.length) pickWarn.push({kind: 'info', fields: [], msg: `PO ${notBooked.join(', ')} is not in the booking list – check with Customer service.`});
      const shipTo = [...new Set(pos.flatMap(hit).map(b => String(b['SHIP TO'] || '').toUpperCase()).filter(Boolean))];
      const fpd = String(header.FPD || '').toUpperCase(), pod = String(header['Port of Discharge'] || '').toUpperCase();
      if (shipTo.length && (fpd || pod) && !shipTo.some(st => [fpd, pod].some(x => x && (st.includes(x) || x.includes(st)))))
        pickWarn.push({kind: 'info', fields: [], msg: `Final destination ${fpd || pod} – the booking list says SHIP TO ${shipTo.join(' / ')}. Check with Customer service.`});
    }
    return r;
  }
  const isTut = () => F.TUTICORIN.includes(thisCfs());
  const tutSources = () => isTut() ? Object.fromEntries(F.PL_FIELDS.map(f => [f, 'packing'])) : {};
  async function runRead(job) {
    try {
      const docs = [];
      // all documents at once: scanned pages of different files share the OCR workers
      docs.push(...await Promise.all(job.fileObjs.map(f => R.readDocument(f, m => log(job, m)))));
      job.docs = docs;
      for (const e of new Set(docs.flatMap(d => d.pages).filter(p => p.error).map(p => p.error))) log(job, e);
      const prof = P.detectShipper(await store.profiles(), P.withoutVdf(docs));
      if (prof) { job.shipper = prof.shipper; job.source = 'profile'; job.profData = prof.data; log(job, `Known shipper: ${prof.shipper}. Using the saved format.`); }
      else job.source = 'new';
      job.sources = Object.assign(tutSources(), (prof && prof.data.source) || {});
      const ex = await afterExtract(extract(docs, prof ? prof.data : null, job.sources), docs);
      const {header, hsrc, items, status, nAuto, pickWarn} = ex;
      if (!prof) {
        if (header['Vendor Name']) job.shipper = header['Vendor Name'];
        log(job, nAuto ? 'New shipper: read automatically. Check the amber values (click Pick to correct one); the format is remembered when you save.'
          : 'This shipper has no saved format yet. Please click the values in the document (Pick) – the format is remembered when you save.');
        if (nAuto) job.source = 'auto';
      }
      await applyDefaults(header, status);
      job.result = finishResult(docs, header, hsrc, items, status); job.result.pick_warn = pickWarn;
      Object.assign(job.result, {crf: ex.crf, vdf_wrong: ex.vdfWrong, scanned: ex.scanned, xofy: ex.xofy || null});
      if (pickWarn.length) log(job, 'Check: ' + pickWarn.map(w => w.msg).join(' '));
      job.state = 'done'; log(job, 'Ready for checking.');
    } catch (e) {
      job.state = 'error'; job.error = e.message || String(e);
      /* v17.1: plain words for the usual file problems */
      const em = String(job.error);
      if (/password/i.test(em) || e.name === 'PasswordException') job.error = 'This PDF is locked with a password – ask the shipper for an open (not protected) copy.';
      else if (/Invalid PDF|InvalidPDF|bad XRef|Missing PDF|startxref|corrupt/i.test(em) || e.name === 'InvalidPDFException') job.error = 'This PDF is damaged and cannot be opened – ask for the file again.';
      log(job, 'Error: ' + job.error);
      console.error(e);
    } finally { delete job.fileObjs; }
  }


  /* Combine several sources (reports or data files) into one stock: duplicates (same invoice + PO + style) kept once
     and listed; then one combined report per site. Used by both "Combine reports" and "Combine from shared folder". */
  async function combineResponse(sources, preview, siteWanted) {
      sources = sources.map(([n, r]) => [n, siteRows(r)]);          // site mode: only this site's PCs / rows
      if (F.siteLock()) siteWanted = F.siteLock();
      const seen = new Map(), merged = [], dups = [];
      for (const [name, rows] of sources) for (const r of rows) {
        if (V.keyComplete(r)) {
          const k = V.rowKey(r);
          if (seen.has(k)) { const d = {Invoice: r['Shipper invoice number'], PO: r['PO Number'], Style: r.Style, 'Kept from': seen.get(k), 'Also in': name};
            Object.defineProperty(d, '_row', {value: r, enumerable: false}); dups.push(d); continue; }
          seen.set(k, name);
        }
        merged.push(r);
      }
      const summary = sources.map(([n, r]) => ({source: n, rows: r.length}));
      const sites = REP.splitBySite(merged);
      if (preview) return json({sources: summary, combined_rows: merged.length, duplicates: dups.length, dup_examples: dups.slice(0, 10),
        sites: sites.map(x => ({cfs: x.site, rows: x.rows.length}))});
      const want = String(siteWanted || '').toUpperCase();
      const one = sites.find(x => x.site === (want === '__NONE' ? '' : want)) || {site: want === '__NONE' ? '' : want, rows: []};
      const siteKey = r => String(r['Warehouse ID'] || '').trim().toUpperCase();
      const perSource = sources.map(([n, r]) => [n, r.filter(x => siteKey(x) === one.site).length]);
      const extra = [['Combined from', ['Report / PC', 'Rows for ' + (one.site || 'CFS not set')], [...perSource, ['Combined rows (after removing duplicates)', one.rows.length]]]];
      const myDups = dups.filter(d => siteKey(d._row) === one.site).map(d => { const o = Object.assign({}, d); delete o._row; return o; });
      if (myDups.length) extra.push(['Duplicates removed', Object.keys(myDups[0]), myDups.map(d => Object.values(d))]);
      return fileResp(await REP.buildReport(one.rows, extra, one.site), REP.reportFileName('_COMBINED', one.site));
  }

  /* ---------- routes ---------- */
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {status, headers: {'Content-Type': 'application/json'}});
  const fileResp = (blob, name) => new Response(blob, {status: 200, headers: {'Content-Disposition': `attachment; filename="${name}"`, 'Content-Type': blob.type || 'application/octet-stream'}});
  const userOf = h => (h && (h['X-User'] || h['x-user'])) || 'unknown';

  async function handle(method, path, query, body, headers) {
    const user = userOf(headers);
    if (cloudOn()) {
      if (CSD.cloud.profile && CSD.cloud.profile.role === 'management' && method !== 'GET' && !/^\/api\/(report|stuffing-report|validate|read|job)/.test(path)) return json({error: 'View only: your login cannot change data.'}, 403);
      const why = !CSD.cloud.online() && needsNet(method, path, body && typeof body.get !== 'function' ? body : null);
      if (why) return json({error: why, offline: true}, 503);
    }
    if (path === '/api/ping') return json({app: 'CFS Stock Desk', version: VERSION});
    if (path === '/api/meta') {
      const lists = Object.fromEntries(Object.entries(F.LISTS).map(([k, v]) => [k, [...v]]));
      for (const s of (await store.stock(null)).slice(-5000)) for (const f of ['CHA Name', 'Transporter Name', 'Port of Discharge', 'FPD', 'Customer Name', 'GroupName', 'Vendor Name', 'Warehouse Bay number', 'Shipping Bill Number', 'OSD type']) {
        const v = s.data[f]; if (v) (lists[f] = lists[f] || []).push(v);
      }
      for (const k of Object.keys(lists)) lists[k] = [...new Set(lists[k])].sort();
      for (const x of Object.values((await store.getSetting('cha_list')) || {})) (lists['CHA Name'] = lists['CHA Name'] || []).push(x.cha);
      for (const k of ['CHA Name']) lists[k] = [...new Set(lists[k] || [])].sort();
      lists['Customer Name'] = [...new Set([...(lists['Customer Name'] || []), ...Object.keys(F.CUSTOMERS)])].sort();
      lists.GroupName = [...new Set([...(lists.GroupName || []), ...Object.values(F.CUSTOMERS).map(v => v[2])])].sort();
      return json({columns: F.COLUMNS, item_fields: F.ITEM_FIELDS, header_fields: F.HEADER_FIELDS, required: F.requiredFor(thisCfs(), 'scan'), required_by_site: Object.fromEntries(F.CFS_LIST.map(c => [c, F.requiredFor(c, 'scan')])), required_stock: F.requiredFor(thisCfs()),
        selects: F.SELECTS, lists, groups: F.FORM_GROUPS, numeric: [...F.NUMERIC], dates: [...F.DATES], times: [...F.TIMES],
        customers: await customerMaster(), ocr: true, ai: {enabled: false}, warehouse: thisCfs(), cfs_list: F.CFS_LIST, web: true, site_lock: F.siteLock(), damage_types: F.DAMAGE_TYPES, seal_options: F.SEAL, bad_remark: F.BAD_REMARK.source, pl_fields: F.PL_FIELDS,
        tuticorin: F.TUTICORIN, tut_doc_header: F.TUT_DOC_HEADER, tut_items: F.TUT_ITEMS, tut_manual: F.TUT_MANUAL_V15, gap_label: F.GAP_LABEL, manual_item: [], truck_flow: true,
        offload: {truck: F.OFFLOAD_TRUCK, truck_apll: F.OFFLOAD_TRUCK_APLL, row: F.OFFLOAD_ROW, osd: F.OFFLOAD_OSD, all: F.OFFLOAD_ALL}, scan_required_extra: F.SCAN_REQUIRED_EXTRA,
        required_scan: F.requiredFor(thisCfs(), 'scan'), role: cloudOn() && CSD.cloud.profile ? CSD.cloud.profile.role : 'admin'});
    }
    if (path === '/api/about') return json({version: VERSION, data_dir: 'this browser (and your data file)', pc: 'this PC', ocr: true, ai: {enabled: false}});
    if (path === '/api/read' && method === 'POST') {
      const files = body.getAll('files').filter(f => f && f.name);
      if (!files.length) return json({error: 'Choose at least one document.'}, 400);
      for (const f of files) { const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase(); if (!R.SUPPORTED.includes(ext)) return json({error: `${f.name}: file type ${ext} is not supported. Use Excel, PDF or an image.`}, 400); }
      const id = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
      const job = {id, state: 'running', log: [], files: files.map(f => f.name), fileObjs: files, user, created: store.now()};
      for (const k of [...JOBS.keys()].slice(0, Math.max(0, JOBS.size - 3))) JOBS.delete(k);   // keep memory small
      JOBS.set(id, job); runRead(job);
      return json({job: id});
    }
    let m;
    if ((m = path.match(/^\/api\/job\/([a-f0-9]{12})$/))) {
      const job = JOBS.get(m[1]); if (!job) return json({error: 'Not found'}, 404);
      const out = {id: job.id, state: job.state, log: job.log, shipper: job.shipper, source: job.source, result: job.result, error: job.error, used_ai: false, ai: {enabled: false}, files: job.files};
      if (job.state === 'done' && query.get('docs')) out.docs = job.docs;
      if (job.state === 'done') { out.has_packing = (job.docs || []).some(d => d.pages.some(pg => CSD.A.pageType(pg, d.name) === 'packing')); out.tut = isTut();
        out.need = (job.profData && job.profData.need) || {}; out.sources = job.sources || {}; out.page_types = Object.fromEntries((job.docs || []).flatMap(d => d.pages.map(pg => [pg.id, CSD.A.pageType(pg, d.name)]))); }
      return json(out);
    }
    if ((m = path.match(/^\/api\/job\/([a-f0-9]{12})\/sources$/)) && method === 'POST') {
      /* the person changed "read this column from: invoice / packing list" – read again with the new choice */
      const job = JOBS.get(m[1]); if (!job || !job.docs) return json({error: 'This reading has expired. Upload the documents again.'}, 400);
      job.sources = Object.assign({}, body.sources || {});
      const ex = await afterExtract(extract(job.docs, job.profData || null, job.sources), job.docs);
      const {header, hsrc, items, status, pickWarn} = ex;
      await applyDefaults(header, status);
      return json({result: Object.assign(finishResult(job.docs, header, hsrc, items, status), {pick_warn: pickWarn, crf: ex.crf, vdf_wrong: ex.vdfWrong, scanned: ex.scanned, xofy: ex.xofy || null}), sources: job.sources});
    }
    if ((m = path.match(/^\/api\/job\/([a-f0-9]{12})\/ai$/))) return json({error: 'Local AI is only available in the desktop version.'}, 400);
    if (path === '/api/validate' && method === 'POST') {
      const keys = await stockKeys(new Set(body.exclude || []));
      return json({warnings: (body.rows || []).map(r => V.validateRow(Object.assign({'Entry Date': today()}, r), keys, body.not_needed))});
    }
    if (path === '/api/save' && method === 'POST') {
      const job = JOBS.get(body.job);
      if (!job) return json({error: 'This reading has expired. Upload the documents again.'}, 400);
      const header = {}; for (const [f, v] of Object.entries(body.header || {})) if (F.COLUMNS.includes(f)) header[f] = coerce(f, v);
      if (F.siteLock()) header['Warehouse ID'] = F.siteLock();
      let items = (body.items || []).map(it => { const o = {}; for (const [f, v] of Object.entries(it)) if (F.COLUMNS.includes(f)) o[f] = coerce(f, v); return o; });
      items = items.filter(it => Object.values(it).some(v => v !== null));
      if (!items.length) return json({error: 'There are no item rows to save.'}, 400);
      /* "Received Pkgs" typed once for the shipment: when it equals the shipment's cartons, each row gets its own count */
      const recv = header['Received Pkgs'];
      if (typeof recv === 'number' && items.length > 1) {
        const tot = items.reduce((t, it) => t + (Number(it['Total Packages']) || 0), 0);
        if (Math.abs(tot - recv) < 1e-9) { delete header['Received Pkgs']; for (const it of items) if (empty(it['Received Pkgs'])) it['Received Pkgs'] = it['Total Packages']; }
      }
      const rows = items.map(it => {
        const r = Object.fromEntries(F.COLUMNS.map(f => [f, '']));
        for (const [k, v] of Object.entries(header)) if (!empty(v)) r[k] = v;
        for (const [k, v] of Object.entries(it)) if (!empty(v)) r[k] = v;
        if (empty(r['Entry Date'])) r['Entry Date'] = today();           // GAP report "DATE" = day of entry
        if (empty(r['Qty Type'])) r['Qty Type'] = 'CARTONS';          // v16.1: default CARTONS (was PCS)
        /* v15: the truck is waiting – arrival (Allow Date / Time) is now unless typed; Late Cargo from the cut-off */
        if (empty(r['Allow Date'])) r['Allow Date'] = today();
        if (empty(r['Allow Time'])) r['Allow Time'] = CSD.ist.time();
        r['Truck Arrival'] = `${r['Allow Date']} ${r['Allow Time']}`;
        if (empty(r['Late Cargo'])) r['Late Cargo'] = F.lateCargo(r);
        for (const f of F.OFFLOAD_ROW) if (f === 'Received Pkgs') r[f] = '';      // received cartons are counted at offloading
        return V.normaliseRow(r);
      });
      if (isTut()) {
        const hasPL = job.docs.some(d => d.pages.some(pg => CSD.A.pageType(pg, d.name) === 'packing'));
        if (!hasPL && !body.pl_not_available) return json({error: 'No packing list found. Upload the packing list, or tick "Packing list not available – take from invoice".'}, 422);
        if (body.checked_diff === false) return json({error: 'Tick "Packing list difference checked" on the rows where the packing list and invoice differ.'}, 422);
      }
      /* v17.1: the wrong VDF blocks saving */
      if (job.result && job.result.vdf_wrong) return json({error: 'Wrong VDF attached – none of the POs on the VDF match this invoice. Remove it, add the right VDF and read again.'}, 422);
      /* OSD, received cartons and damage are confirmed later, when the operator clicks Offloaded (Truck report) */
      if (header['Vendor Name']) { const c = F.canonShipper(await shipperAlias(), header['Vendor Name'], [], header['Shipper invoice number']); header['Vendor Name'] = c.name; }   // v17.1: one name per shipper
      const shipper = String(header['Vendor Name'] || job.shipper || 'UNKNOWN SHIPPER').toUpperCase();
      let repeatOk = false;
      /* same shipper + same invoice already in stock (or shipped out): blocked, the admin PIN overrides (e.g. a second lot of the same invoice) */
      const invN = V.invNorm(header['Shipper invoice number'] || rows[0]['Shipper invoice number']);
      if (invN) {
        /* v17.1: shipper compared by its alias-list name; invoice number without separators and leading zeros */
        const aliasL = await shipperAlias(), vn = v => v ? F.shipperKey(F.canonShipper(aliasL, v, [], '').name) : '';
        const same = siteRows([...(await store.stock('pending')), ...(await store.stock('in')), ...(await store.stock('out'))].map(s => Object.assign({}, s.data, {_s: s})))
          .filter(d => V.invNorm(d['Shipper invoice number']) === invN && (!vn(d['Vendor Name']) || !vn(shipper) || vn(d['Vendor Name']) === vn(shipper)));
        if (same.length && !(await pinOk(body.admin_pin))) {
          const first = same[0]._s, out = same.filter(d => d._s.status === 'out').length;
          return json({error: `Invoice ${same[0]['Shipper invoice number']} of ${same[0]['Vendor Name'] || shipper} is already in stock.`, need_pin: true,
            dup_invoice: {invoice: same[0]['Shipper invoice number'], shipper: same[0]['Vendor Name'] || shipper, rows: same.length, shipped_out: out,
              saved_on: String(first.created_at || '').slice(0, 16), by: first.updated_by || '', styles: [...new Set(same.map(d => d.Style))].slice(0, 8)}}, 409);
        }
        if (same.length) repeatOk = same.length;
      }
      const keys = repeatOk ? new Set() : await stockKeys();   // admin let the same invoice in again: its rows are not 'duplicates'
      const nnSaved = (await store.profileByShipper(String(header['Vendor Name'] || job.shipper || '').toUpperCase()) || {data: {}}).data.need || {};
      const notNeeded = Object.entries(body.need || nnSaved).filter(([, v]) => v === 'no').map(([f]) => f);
      const warns = rows.map(r => V.validateRow(r, keys, notNeeded, 'scan'));
      if (warns.some(ws => ws.some(w => w.level === 'error')) && !body.force) return json({error: 'Fix the highlighted fields first.', warnings: warns}, 422);
      if (body.force && warns.some(ws => ws.some(w => w.level === 'error')) && !(await pinOk(body.admin_pin))) return json({error: 'Admin PIN needed to save rows that are already in stock.', need_pin: true, warnings: warns}, 403);
      let learnt = {};
      if (body.learn !== false && job.docs) {
        const old = (await store.profileByShipper(shipper)) || (job.shipper ? await store.profileByShipper(job.shipper) : null);
        const r = P.learnProfile(old ? JSON.parse(JSON.stringify(old.data)) : null, shipper, header, items, P.withoutVdf(job.docs), body.sources || job.sources || null);
        learnt = r.report;
        if (body.need) { const n = {}; for (const [f, v] of Object.entries(body.need)) if (v === 'no') n[f] = 'no'; r.profile.need = n; }
        await store.saveProfile(shipper, r.profile, user);
      }
      if (body.pl_not_available) await store.audit(user, 'no_packing_list', `${shipper} ${header['Shipper invoice number']}: values taken from the invoice`);
      const bid = await store.addBatch(shipper, header['Shipper invoice number'], job.files, user, rows, 'pending');   // waiting to offload
      await store.audit(user, 'add_stock', `${shipper} ${header['Shipper invoice number']}: ${rows.length} rows`);
      if (repeatOk) await store.audit(user, 'repeat_invoice', `${shipper} ${header['Shipper invoice number']}: saved again with the admin PIN (${repeatOk} earlier row(s))`);
      JOBS.delete(body.job);
      /* v17.1: shipping bill already in stock on another invoice – a warning only (one SB can cover several invoices) */
      const notes = [], sb = P.norm(header['Shipping Bill Number'] || rows[0]['Shipping Bill Number'] || '');
      if (sb) { const other = [...(await store.stock('pending')), ...(await store.stock('in')), ...(await store.stock('out'))].map(x => x.data)
          .filter(d => P.norm(d['Shipping Bill Number'] || '') === sb && V.invNorm(d['Shipper invoice number']) !== V.invNorm(header['Shipper invoice number']));
        if (other.length) notes.push(`Shipping bill ${header['Shipping Bill Number'] || rows[0]['Shipping Bill Number']} is also on invoice ${[...new Set(other.map(d => d['Shipper invoice number']))].slice(0, 3).join(', ')} – correct if one shipping bill covers several invoices, otherwise check.`); }
      return json({batch: bid, rows: rows.length, learnt, shipper, notes});
    }
    if (path === '/api/stock' && method === 'GET') {
      let rows = await store.stock(query.get('status') || 'in');
      if (F.siteLock()) { const l = F.siteLock(); rows = rows.filter(s => { const w = whOf(s.data); return w === l || w === ''; }); }
      const count = new Map(); for (const s of rows) if (V.keyComplete(s.data)) count.set(V.rowKey(s.data), (count.get(V.rowKey(s.data)) || 0) + 1);
      const dup = new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
      const nn = await notNeededMap();
      for (const s of rows) s.warnings = V.validateRow(s.data, dup.has(V.rowKey(s.data)) ? dup : new Set(), nnOf(nn, s.data));
      rows.forEach(s => { if (s.data.Damage && !Array.isArray(s.data.Damage)) delete s.data.Damage; });
      /* ship-cancel marks (booking list): cargo in stock, not in any plan, close to SHIP CXL */
      const bk = await bookingIndex(), t0 = today();
      for (const s of rows) { if (s.status !== 'in' || s.data.PLAN) continue; s.ship = shipMark(s.data, bk, t0); }
      return json({rows});
    }
    if ((m = path.match(/^\/api\/stock\/(\d+)$/)) && method === 'PUT') {
      if (!(await pinOk(body.admin_pin))) return json({error: 'Admin PIN needed to edit added stock.', need_pin: true}, 403);
      const id = +m[1]; const data = {};
      const cur = (await store.stock(null)).find(s => s.id === id); if (cur && cur.data.Damage) data.Damage = cur.data.Damage;
      for (const [f, v] of Object.entries(body.data || {})) if (F.COLUMNS.includes(f)) { const c = coerce(f, v); data[f] = c === null ? '' : c; }
      V.normaliseRow(data);
      const warns = V.validateRow(data, await stockKeys(new Set([id])), nnOf(await notNeededMap(), data));
      if (warns.some(w => w.level === 'error') && !body.force) return json({error: 'Fix the highlighted fields first.', warnings: warns}, 422);
      await store.updateStock(id, data, user);
      /* v17.1: admin change log – field, old value, new value */
      if (cur) { const ch = []; for (const f of new Set([...Object.keys(cur.data), ...Object.keys(data)])) { if (f === 'Damage' || f.startsWith('_')) continue;
          const a = cur.data[f] ?? '', b = data[f] ?? ''; if (String(a) !== String(b)) ch.push(`${f}: ${a === '' ? '–' : a} → ${b === '' ? '–' : b}`); }
        await store.audit(user, 'stock_edit', `${cur.data['Vendor Name'] || ''} ${cur.data['Shipper invoice number'] || ''} ${cur.data.Style || ''} (row ${id}): ${ch.join('; ') || 'no change'}`); }
      return json({ok: true, warnings: warns});
    }
    if (path === '/api/stock/status' && method === 'POST') {
      const status = body.status || 'out';
      if (!['in', 'out', 'deleted'].includes(status)) return json({error: 'bad status'}, 400);
      if (status === 'deleted' && !(await pinOk(body.admin_pin))) return json({error: 'Admin PIN needed to delete stock.', need_pin: true}, 403);
      if (status === 'in') return json({error: 'Use "Return to stock".'}, 400);
      if (status === 'deleted') { const all = await store.stock(null), ids = new Set((body.ids || []).map(Number));
        for (const x of all.filter(y => ids.has(y.id))) await store.audit(user, 'stock_delete', `${x.data['Vendor Name'] || ''} ${x.data['Shipper invoice number'] || ''} PO ${x.data['PO Number'] || ''} ${x.data.Style || ''} ${x.data.Colour || ''}: ${x.data['Total Packages'] || ''} ctns, ${x.data['Total CBM'] || ''} CBM (was ${x.status}) – deleted`); }
      await store.setStatus((body.ids || []).map(Number), status, user);
      return json({ok: true});
    }
    if (path === '/api/seal-photo' && method === 'POST') {
      const ids = new Set((body.ids || []).map(Number)); let n = 0;
      for (const s of (await store.stock(null)).filter(x => ids.has(x.id))) {
        const d = Object.assign({}, s.data); if (String(d['Seal Photo'] || '').includes(body.url)) continue;
        d['Seal Photo'] = [d['Seal Photo'], body.url].filter(Boolean).join(' · '); await store.updateStock(s.id, d, user + ' (seal photo)'); n++;
      }
      return json({ok: true, rows: n});
    }
    if (path === '/api/damage-photos' && method === 'POST') {
      const ids = new Set((body.ids || []).map(Number)); let n = 0;
      for (const s of [...(await store.stock('in')), ...(await store.stock('out'))].filter(x => ids.has(x.id))) {
        const d = Object.assign({}, s.data), dm = (d.Damage || []).map(l => Object.assign({}, l)); let ch = false;
        for (const p of body.links || []) { const l = dm.find(x => P.norm(x.po) === P.norm(p.po) && P.norm(x.style) === P.norm(p.style)); if (l) { l.photos = [...new Set([...(l.photos || []), p.url])]; ch = true; } }
        if (ch) { d.Damage = dm; d.Photos = [...new Set(dm.flatMap(l => l.photos || []))].join(' '); await store.updateStock(s.id, d, user + ' (photos)'); n++; }
      }
      return json({ok: true, rows: n});
    }
    if (path === '/api/booking' && method === 'POST') {
      const f = body.get('file'); if (!f) return json({error: 'Choose the booking list (.xlsx).'}, 400);
      let list; try { list = readBookings(await f.arrayBuffer()); } catch (e) { return json({error: e.message}, 400); }
      const noCxl = list.filter(b => !b['SHIP CXL']).length;
      if (body.get('preview') === '1') return json({rows: list.length, no_cxl: noCxl, sample: list.slice(0, 5)});
      const n = await store.saveBookings(list, user); await store.audit(user, 'booking_list', `${f.name}: ${list.length} PO rows (${n} new or changed)`);
      return json({ok: true, rows: list.length, changed: n, no_cxl: noCxl});
    }
    if (path === '/api/booking' && method === 'GET') { const l = (await store.getBookings()) || []; return json({count: l.length, latest: l.slice(-5)}); }
    if (path === '/api/assign-site' && method === 'POST') {
      if (!(await pinOk(body.admin_pin))) return json({error: 'Admin PIN needed.', need_pin: true}, 403);
      const site = String(body.site || '').toUpperCase(); if (!F.CFS_LIST.includes(site)) return json({error: 'Choose a CFS.'}, 400);
      const ids = new Set((body.ids || []).map(Number)); let n = 0;
      for (const s of await store.stock(null)) if (ids.has(s.id) && !whOf(s.data)) { await store.updateStock(s.id, Object.assign({}, s.data, {'Warehouse ID': site}), user + ' (site assigned)'); n++; }
      await store.audit(user, 'assign_site', `${n} row(s) → ${site}`);
      return json({ok: true, rows: n});
    }
    if (path === '/api/no-site' && method === 'GET') return json({rows: (await store.stock(null)).filter(s => s.status !== 'deleted' && !whOf(s.data)).map(s => ({id: s.id, status: s.status, invoice: s.data['Shipper invoice number'], po: s.data['PO Number'], style: s.data.Style, customer: s.data['Customer Name'], pkgs: s.data['Total Packages']}))});
    /* ---- v15 reports: inout | osd | ev | ageing | turnaround | late | admin ---- */
    if ((m = path.match(/^\/api\/r15\/(inout|osd|ev|ageing|turnaround|late|admin)$/))) {
      const name = m[1], R = CSD.r15, site = (query.get('cfs') || thisCfs() || '').toUpperCase(), day = query.get('day') || today();
      if (name === 'admin' && !isAdminUser()) return json({error: 'Only the admin can see the admin changes.'}, 403);
      const grp = String(query.get('group') || '').toUpperCase(), inGrp = d => !grp || String(d.GroupName || d['Customer Name'] || '').toUpperCase() === grp;
      const stock = (await store.stock(null)).filter(s => s.status !== 'deleted' && inGrp(s.data));
      const stuffings = ((await store.getSetting('stuffings')) || []).map(x => grp ? Object.assign({}, x, {rows: x.rows.filter(inGrp)}) : x).filter(x => x.rows.length);
      const from = query.get('from') || CSD.ist.addDays(day, -6), to = query.get('to') || day;
      const extra = body && typeof body.get !== 'function' ? body : {};
      let rep, file;
      const short = (REP.SITES[site] || {}).short || site || 'CFS', tag = short.replace(/[^A-Za-z0-9]+/g, '_');
      if (name === 'inout') {
        const io = R.inout({stock, stuffings, day, site});
        for (const r of io.rows) if (extra.remarks && extra.remarks[r.customer] !== undefined) r.remarks = String(extra.remarks[r.customer]);
        rep = {io, sheets: R.inoutSheets(io, R.late({stock, day, site}))}; file = `Inbound_Outbound_${tag}_${day}.xlsx`;
      } else if (name === 'osd') { rep = R.osd({stock, day, site}); file = `OSD_Report_${tag}_${day}.xlsx`; }
      else if (name === 'ev') { rep = R.ev({stuffings, from, to, site, evCustomers: (await store.getSetting('ev_customers')) || {}}); file = `EV_Tag_Report_${tag}_${from}_to_${to}.xlsx`; }
      else if (name === 'ageing') { rep = R.ageing({stock, day, site}); file = `Ageing_Report_${tag}_${day}.xlsx`; }
      else if (name === 'turnaround') { rep = R.turnaround({stock, from, to, site, limitH: Number((await store.getSetting('turnaround_limit_h')) || 4)}); file = `Truck_Turnaround_${tag}_${from}_to_${to}.xlsx`; }
      else if (name === 'late') { rep = {sheets: [R.late({stock, day, site})]}; file = `Late_Cargo_${tag}_${day}.xlsx`; }
      else { const audit = cloudOn() ? await CSD.cloud.auditDay(day) : (store.auditDay ? await store.auditDay(day) : []); rep = R.adminChanges({audit, stock, day}); file = `Admin_Changes_${day}.xlsx`; }
      if (query.get('format') === 'json') return json(Object.assign({file, html: rep.sheets.map(sh => R.toHtml(sh)).join('')}, rep, {sheets: rep.sheets.map(sh => ({name: sh.name, rows: sh.rows.length}))}));
      return fileResp(await R.toXlsx(rep.sheets), file);
    }
    /* ---- v15 Truck report: trucks waiting to offload (documents saved) → Start offloading → Offloaded ---- */
    if (path === '/api/trucks' && method === 'GET') {
      const group = rows => { const m = new Map(); for (const s of rows) { const k = s.batch_id ?? ('r' + s.id); if (!m.has(k)) m.set(k, []); m.get(k).push(s); } return [...m.entries()]; };
      const mins = (a, b) => { const t = x => { const m = String(x || '').match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null; }; const x = t(a), y = t(b); return x === null || y === null ? null : Math.round(y - x); };
      const nowS = CSD.ist.stamp().slice(0, 16);
      const card = ([batch, rs]) => {
        const d = rs[0].data, start = d['Offloading Date'] && d['Offloading Start Time'] ? `${d['Offloading Date']} ${d['Offloading Start Time']}` : '';
        return {batch, ids: rs.map(s => s.id), truck: d['Truck Plate Number'] || '', customer: d['Customer Name'] || d.GroupName || '', vendor: d['Vendor Name'] || '', invoice: d['Shipper invoice number'] || '',
          site: d['Warehouse ID'] || '', arrived: d['Truck Arrival'] || (d['Allow Date'] ? `${d['Allow Date']} ${d['Allow Time'] || ''}`.trim() : ''), started: start, offloaded: d['Offloaded At'] || '',
          seal: d['Seal Condition'] || '', seal_photo: d['Seal Photo'] || '', late: d['Late Cargo'] || '', cutoff: d['Cargo Cutoff Date'] ? `${d['Cargo Cutoff Date']} ${d['Cargo Cutoff Time'] || ''}`.trim() : '', bay: d['Warehouse Bay number'] || '', labour: d['No of Labour'] ?? '',
          vehicle: d.VehicleSize || '', transporter: d['Transporter Name'] || '', pkgs: rs.reduce((t, s) => t + (Number(s.data['Total Packages']) || 0), 0),
          received: rs.reduce((t, s) => t + (Number(s.data['Received Pkgs']) || 0), 0), cbm: Math.round(rs.reduce((t, s) => t + (Number(s.data['Total CBM']) || 0), 0) * 1000) / 1000,
          osd: rs.some(s => String(s.data.OSD || '').toUpperCase() === 'YES'),
          waiting_min: mins(d['Truck Arrival'], start || (d['Offloaded At'] || '').slice(0, 16) || nowS), offloading_min: start ? mins(start, (d['Offloaded At'] || '').slice(0, 16) || nowS) : null,
          rows: rs.map(s => ({id: s.id, po: s.data['PO Number'] || '', style: s.data.Style || '', colour: s.data.Colour || '', pkgs: s.data['Total Packages'] ?? '', cbm: s.data['Total CBM'] ?? '',
            received: s.data['Received Pkgs'] ?? '', actual_cbm: s.data['Actual CBM'] ?? ''}))};
      };
      const inSite = s => siteRows([s.data]).length > 0;
      const waiting = group((await store.stock('pending')).filter(inSite)).map(card)
        .sort((a, b) => String(a.arrived).localeCompare(String(b.arrived)));
      const day = query.get('day') || today();
      const done = group((await store.stock(null)).filter(s => s.status !== 'pending' && String(s.data['Offloaded At'] || '').startsWith(day)).filter(inSite)).map(card)
        .sort((a, b) => String(b.offloaded).localeCompare(String(a.offloaded)));
      return json({waiting, offloaded: done, day, now: nowS});
    }
    if (path === '/api/truck/start' && method === 'POST') {
      const rs = (await store.stock('pending')).filter(s => (body.ids || []).includes(s.id));
      if (!rs.length) return json({error: 'This truck is no longer waiting. Reload.'}, 409);
      const seal = String(body.seal || '').trim();
      if (!F.SEAL.includes(seal)) return json({error: 'Choose the seal / truck condition (Intact, Broken or Open truck) before offloading starts.'}, 422);
      const ph = body.seal_photo && body.seal_photo.sha256 ? `${body.seal_photo.name || 'seal.jpg'} · SHA-256 ${body.seal_photo.sha256} · ${body.seal_photo.at || ''} · ${body.seal_photo.user || user}` : '';
      const d = today(), t = CSD.ist.time();
      for (const s of rs) await store.updateStock(s.id, Object.assign({}, s.data, {'Offloading Date': s.data['Offloading Date'] || d, 'Offloading Start Time': s.data['Offloading Start Time'] || t, 'Seal Condition': seal, 'Seal Photo': ph || s.data['Seal Photo'] || ''}), user + ' (start offloading)');
      await store.audit(user, 'offload_start', `${rs[0].data['Truck Plate Number'] || ''} · ${rs.length} row(s) · seal ${seal}${ph ? ' · photo ' + body.seal_photo.sha256.slice(0, 12) : ''}`);
      return json({ok: true, start: `${d} ${t}`});
    }
    if (path === '/api/truck/offload' && method === 'POST') {
      const rs = (await store.stock('pending')).filter(s => (body.ids || []).includes(s.id));
      if (!rs.length) return json({error: 'This truck is no longer waiting. Reload.'}, 409);
      if (body.checked !== true) return json({error: 'Tick "Pkgs & CBM checked" for every row, then confirm.'}, 422);
      if (!F.SEAL.includes(String(rs[0].data['Seal Condition'] || body.seal || ''))) return json({error: 'Seal / truck condition is missing – press "Start offloading" and choose Intact, Broken or Open truck first.', need_seal: true}, 422);
      { /* OSD remark rule: needed when received cartons differ from booked, or Actual CBM is more than 10% off */
        const per0 = new Map((body.rows || []).map(x => [Number(x.id), x])), rem = String(body.osd_remarks || '').trim();
        const why = rs.map(s => { const x = per0.get(s.id) || {}, bk = Number(s.data['Total Packages']) || 0, rc = x['Received Pkgs'] === undefined || x['Received Pkgs'] === '' ? bk : Number(x['Received Pkgs']);
          const bc = Number(s.data['Total CBM']) || 0, ac = x['Actual CBM'] === undefined || x['Actual CBM'] === '' ? null : Number(x['Actual CBM']);
          return rc !== bk ? `${s.data.Style || ''} received ${rc} vs booked ${bk}` : (ac !== null && bc > 0 && Math.abs(ac - bc) / bc > 0.10 ? `${s.data.Style || ''} actual CBM ${ac} vs ${bc}` : ''); }).filter(Boolean);
        if (why.length && (rem.length < 10 || F.BAD_REMARK.test(rem))) return json({error: `OSD remark needed (at least 10 characters, not OK / NIL / DONE / CHECKED): ${why.slice(0, 3).join('; ')}.`, need_remark: true}, 422);
        if (rem && F.BAD_REMARK.test(rem)) return json({error: 'OSD remark "' + rem + '" is not accepted – write what was found, or leave it empty.', need_remark: true}, 422);
      }
      const h = {}; for (const [f, v] of Object.entries(body.header || {})) if (F.COLUMNS.includes(f)) h[f] = coerce(f, v);
      const d = today(), t = CSD.ist.time(), stamp = CSD.ist.stamp();
      const per = new Map((body.rows || []).map(x => [Number(x.id), x]));
      const rows = rs.map(s => {
        const r = Object.assign({}, s.data);
        for (const [k, v] of Object.entries(h)) if (!empty(v)) r[k] = v;
        const x = per.get(s.id) || {};
        for (const f of F.OFFLOAD_ROW) if (x[f] !== undefined && x[f] !== '') r[f] = coerce(f, x[f]);
        if (empty(r['Seal Condition']) && F.SEAL.includes(String(body.seal || ''))) r['Seal Condition'] = body.seal;
        if (empty(r['Offloading Date'])) r['Offloading Date'] = d;
        if (empty(r['Offloading Start Time'])) r['Offloading Start Time'] = t;
        if (empty(r['Offloading END Time'])) r['Offloading END Time'] = t;
        r['Offloaded At'] = stamp;
        if (empty(r['Received Pkgs'])) r['Received Pkgs'] = r['Total Packages'];
        r._id = s.id; return r;
      });
      const head = Object.assign({}, h, {'Any Damage': body.any_damage || h['Any Damage'] || 'No', 'OSD Remarks': body.osd_remarks || ''});
      for (const r of rows) r['Any Damage'] = head['Any Damage'];
      const dmg = damageFill(rows, body.damage || [], head); if (dmg) return json({error: dmg}, 422);
      for (const r of rows) { osdFill(r); V.normaliseRow(r); }
      const nn = await notNeededMap();
      const warns = rows.map(r => V.validateRow(r, null, nnOf(nn, r)));
      if (warns.some(ws => ws.some(w => w.level === 'error'))) return json({error: 'Fill in the highlighted fields.', warnings: warns.map(ws => ws.filter(w => w.level === 'error'))}, 422);
      for (const r of rows) { const id = r._id; delete r._id; await store.updateStock(id, V.normaliseRow(r), user + ' (offloaded)'); }
      await store.setStatus(rs.map(s => s.id), 'in', user);
      const lines = rows.flatMap(r => (r.Damage || []).map(x => Object.assign({}, x, {customer: r['Customer Name'] || '', invoice: r['Shipper invoice number'] || '', truck: r['Truck Plate Number'] || ''})));
      await store.audit(user, 'offloaded', `${rows[0]['Truck Plate Number'] || ''} · ${rows.length} row(s)${lines.length ? ` · ${lines.length} damage line(s)` : ''}`);
      return json({ok: true, rows: rows.length, damage: lines, osd: rows.filter(r => String(r.OSD).toUpperCase() === 'YES').length, truck: rows[0]['Truck Plate Number'] || '', ids: rs.map(s => s.id)});
    }
    /* "Return to stock" (admin PIN): shipped-out rows come back into stock.
       A stuffed row loses its container details and is taken off its stuffing report;
       a part-loaded row is added back into the cartons that stayed in stock. */
    if (path === '/api/stock/return' && method === 'POST') {
      if (!(await pinOk(body.admin_pin))) return json({error: 'Admin PIN needed to return rows to stock.', need_pin: true}, 403);
      const ids = new Set((body.ids || []).map(Number));
      const outRows = (await store.stock('out')).filter(s => ids.has(s.id));
      if (!outRows.length) return json({error: 'None of the ticked rows is shipped out any more. Reload the list.'}, 409);
      const N = v => String(v == null ? '' : v).trim().toUpperCase(), r3 = v => Math.round(v * 1000) / 1000;
      const ADD = [['Received Pkgs', Math.round], ['Total Packages', Math.round], ['Item Qty (pcs)', Math.round], ['Total CBM', r3], ['Gross weight (kg)', r3], ['Net weight (kg)', r3], ['Actual CBM', r3]];
      const CLEAR = ['Stuffed Pkgs', 'Container No', 'Stuffing Date', 'Running No', 'Stuffing Truck No', 'Stuffing Truck Type', 'Stuffing Transporter'];
      let returned = 0, merged = 0; const touched = [];
      for (const s of outRows) {
        const d = s.data, cont = N(d['Container No']), n = CSD.ops.num(d['Stuffed Pkgs']);
        if (cont) touched.push({id: s.id, d});
        /* part load: find the cartons left in stock with the matching "PART LOADED n CTN(S) IN <container>" remark */
        const tag = cont && n ? `PART LOADED ${n} CTN(S) IN ${cont}` : '';
        const rest = tag && (await store.stock('in')).find(x => N(x.data['Shipper invoice number']) === N(d['Shipper invoice number']) && N(x.data['PO Number']) === N(d['PO Number'])
          && N(x.data.Style) === N(d.Style) && String(x.data['OSD Remarks'] || '').split(' | ').some(p => N(p) === tag));
        if (rest) {
          const m = Object.assign({}, rest.data);
          for (const [f, rnd] of ADD) if (!empty(d[f]) || !empty(m[f])) m[f] = rnd(CSD.ops.num(m[f]) + CSD.ops.num(d[f]));
          const left = String(m['OSD Remarks'] || '').split(' | ').filter(p => N(p) !== tag);
          m['OSD Remarks'] = left.length ? left.join(' | ') : (N(d['OSD Remarks']).startsWith('NO OSD') ? 'NO OSD' : '');
          await store.updateStock(rest.id, m, user + ' (returned to stock)');
          await store.setStatus([s.id], 'deleted', user);       // its cartons now live in the merged row
          merged++;
        } else {
          const back = Object.assign({}, d); for (const f of CLEAR) back[f] = '';
          await store.updateStock(s.id, back, user + ' (returned to stock)');
          await store.setStatus([s.id], 'in', user);
          returned++;
        }
      }
      /* take the rows off their stuffing records; a container with no rows left is removed from the stuffing list */
      let removedRec = 0; const changed = new Map();
      if (touched.length) {
        const list = (await store.getSetting('stuffings')) || [];
        const same = (x, d) => N(x['Container No']) === N(d['Container No']) && String(x['Running No']) === String(d['Running No']) && N(x['Shipper invoice number']) === N(d['Shipper invoice number'])
          && N(x['PO Number']) === N(d['PO Number']) && N(x.Style) === N(d.Style) && CSD.ops.num(x['Stuffed Pkgs']) === CSD.ops.num(d['Stuffed Pkgs']);
        for (const t of touched) for (const rec of list) {
          let k = rec.rows.findIndex(x => x._id === t.id); if (k < 0) k = rec.rows.findIndex(x => x._id == null && same(x, t.d));
          if (k >= 0) { const row = rec.rows.splice(k, 1)[0]; const c = changed.get(rec.running_no) || {container: rec.header.container, running_no: rec.running_no, rows: []}; c.rows.push(row); changed.set(rec.running_no, c); break; }
        }
        for (const c of changed.values()) c.removed = !list.some(r => r.running_no === c.running_no && r.rows.length);
        const keep = list.filter(r => r.rows.length); removedRec = list.length - keep.length;
        await store.setSetting('stuffings', keep);
      }
      await store.audit(user, 'returned', `${outRows.length} row(s) returned to stock (${merged} added back into part-loaded rows${removedRec ? `, ${removedRec} container(s) removed from the stuffing list` : ''})`);
      return json({ok: true, returned, merged, removed_containers: removedRec, containers: [...changed.values()].map(c => ({container: c.container, running_no: c.running_no, removed: c.removed, rows: c.rows.map(r => ({po: r['PO Number'], style: r.Style, pkgs: r['Stuffed Pkgs']}))}))});
    }
    if (path === '/api/report' || path === '/api/report/sites') {
      /* one report per site (HTPL, SATTVA, SICAL, ST JOHN), each with its own header block */
      let rows = siteRows((await store.stock('in')).map(s => s.data));
      const g = query.get('group'); if (g) rows = rows.filter(r => String(r.GroupName || '').toUpperCase() === g.toUpperCase());
      const sites = REP.splitBySite(rows);
      if (path === '/api/report/sites') return json({sites: sites.map(x => ({cfs: x.site, rows: x.rows.length}))});
      const c = (query.get('cfs') || '').toUpperCase();
      const one = sites.find(x => x.site === (c === '__NONE' ? '' : c)) || {site: c === '__NONE' ? '' : c, rows: []};
      const slot = query.get('slot');
      if (slot && REP.SLOTS[slot]) {
        const name = REP.reportFileName('', one.site, slot), ab = REP.abstractRows(one.rows).total;
        const log = (await store.getSetting('report_log')) || [];
        const at = CSD.ist.stamp().slice(0, 16), auto = user === 'system';
        log.push({date: today(), slot, at: store.now(), by: user, file: name, site: one.site, rows: one.rows.length, pkgs: ab.pkgs, cbm: ab.cbm});
        await store.setSetting('report_log', log.slice(-500));
        const opts = {slot};
        if (slot === 'closing') { opts.recon = await reconcile(one.site, today(), ab); opts.madeBy = auto ? `the app automatically (no Closing report made), ${at} IST` : `${user}, ${at} IST`; }
        return fileResp(await REP.buildReport(one.rows, [], one.site, opts), name);
      }
      return fileResp(await REP.buildReport(one.rows, [], one.site), REP.reportFileName('', one.site));
    }
    if (path === '/api/import' && method === 'POST') {
      const f = body.get('file'); if (!f) return json({error: 'Choose the stock report file.'}, 400);
      if (cloudOn() && !thisCfs()) return json({error: 'Choose a site first (top right). Every stock row needs its CFS.'}, 400);
      let res; try { res = REP.importReport(await f.arrayBuffer()); } catch (e) { return json({error: 'Could not read this report: ' + e.message}, 400); }
      for (const r of res.rows) if (empty(r['Entry Date'])) r['Entry Date'] = today();
      const all = res.rows.length; res.rows = siteRows(res.rows);
      const other = all - res.rows.length;
      if (body.get('preview') === '1') return json({rows: res.rows.length, transporter_fixed: res.fixed, other_site: other, site: F.siteLock()});
      const bid = await store.addBatch('IMPORTED REPORT', '', [f.name], user, res.rows);
      await store.audit(user, 'import', `${f.name}: ${res.rows.length} rows`);
      return json({rows: res.rows.length, transporter_fixed: res.fixed, batch: bid, other_site: other});
    }
    if (path === '/api/profiles' && method === 'GET') return json({profiles: await store.profiles()});
    /* v15.1 Pick training: save / clear where one item column is printed for this shipper */
    if (path === '/api/profile/pick' && method === 'GET') {
      const sh = String(query.get('shipper') || '').toUpperCase(); const p = sh ? await store.profileByShipper(sh) : null;
      return json({shipper: sh, picks: (p && p.data && p.data.picks) || {}, item_defaults: (p && p.data && p.data.item_defaults) || {}});
    }
    if (path === '/api/profile/pick' && method === 'POST') {
      const sh = String(body.shipper || '').trim().toUpperCase();
      if (!sh) return json({error: 'Fill in the shipper (Vendor Name) first – the trained layout is saved for that shipper.'}, 400);
      if (!P.PICK_FIELDS.includes(body.field)) return json({error: 'This column cannot be trained.'}, 400);
      const old = await store.profileByShipper(sh);
      const data = old ? JSON.parse(JSON.stringify(old.data)) : {shipper: sh, match: P.norm(sh)};
      data.picks = data.picks || {};
      if (body.fixed !== undefined) {   // v16: a value typed for a column this shipper's documents never print (e.g. Type = PCS)
        data.item_defaults = data.item_defaults || {};
        if (body.field === 'Qty Type') delete data.picks['Qty Type'];   // v16.3: an old position training of Type is dropped
        if (String(body.fixed).trim() === '') delete data.item_defaults[body.field]; else data.item_defaults[body.field] = body.field === 'Qty Type' ? V.qtyType(body.fixed) : String(body.fixed).trim().toUpperCase();
        await store.saveProfile(sh, data, user); await store.audit(user, 'pick_trained', `${sh}: ${body.field} = ${body.fixed} (typed default)`);
        return json({ok: true, picks: data.picks, item_defaults: data.item_defaults});
      }
      if (body.field === 'Qty Type' && !body.clear) return json({error: 'Type is not trained by position – pick or type it once and it is used for every line.'}, 400);
      if (body.clear) delete data.picks[body.field];
      else { const sp = body.spec || {}; data.picks[body.field] = {type: sp.type, mode: sp.mode, anchor: String(sp.anchor || ''), dy: +sp.dy || 0, dx: +sp.dx || 0, w: +sp.w || 1, ax: sp.ax === undefined ? undefined : +sp.ax, ord: sp.ord === undefined ? -1 : +sp.ord, above: sp.above ? String(sp.above) : undefined, dx2: sp.dx2 === undefined ? undefined : +sp.dx2, vshape: sp.vshape ? String(sp.vshape) : undefined, vlen: sp.vlen ? +sp.vlen : undefined, vdig: sp.vdig === undefined ? undefined : +sp.vdig}; }
      await store.saveProfile(sh, data, user);
      await store.audit(user, 'pick_trained', `${sh}: ${body.field}${body.clear ? ' cleared' : ''}`);
      return json({ok: true, picks: data.picks});
    }
    /* v17.1 shipper name list (alias list): admin edits with the PIN; travels with the shipper formats file */
    if (path === '/api/shipper-alias' && method === 'GET') {
      return json({list: await shipperAlias(), custom: Array.isArray(await store.getSetting('shipper_alias')), at: (await store.getSetting('shipper_alias_at')) || '', unmapped: (await store.getSetting('shipper_unmapped')) || []});
    }
    if (path === '/api/shipper-alias' && method === 'PUT') {
      if (!(await pinOk(body.admin_pin))) return json({error: (await pinLockedMsg()) || 'Admin PIN needed to change the shipper name list.', need_pin: true}, 403);
      const clean = a => [...new Set((a || []).map(x => String(x || '').trim().toUpperCase()).filter(Boolean))];
      const list = [];
      for (const e of body.list || []) {
        const name = String(e.name || '').trim().toUpperCase(); if (!name) continue;
        const prefixes = (e.prefixes || []).map(x => String(x || '').trim()).filter(Boolean);
        for (const rx of prefixes) { try { new RegExp(rx, 'i'); } catch (er) { return json({error: `${name}: invoice prefix "${rx}" is not valid.`}, 400); } }
        const gstin = clean(e.gstin); for (const g of gstin) if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(g)) return json({error: `${name}: GSTIN "${g}" is not 15 characters in the GSTIN pattern.`}, 400);
        list.push({name, aliases: clean(e.aliases).filter(a => a !== name), gstin, prefixes});
      }
      const names = list.map(e => F.shipperKey(e.name)); const dup = names.find((n0, i) => names.indexOf(n0) !== i); if (dup) return json({error: 'The same shipper name is twice in the list.'}, 400);
      const old = await shipperAlias(), at = store.now();
      await store.setSetting('shipper_alias', list); await store.setSetting('shipper_alias_at', at);
      const oldN = new Set(old.map(e => e.name)), newN = new Set(list.map(e => e.name));
      await store.audit(user, 'alias_edit', `shipper name list: ${list.length} shippers · added ${[...newN].filter(n0 => !oldN.has(n0)).join(', ') || '–'} · removed ${[...oldN].filter(n0 => !newN.has(n0)).join(', ') || '–'}`);
      const un = ((await store.getSetting('shipper_unmapped')) || []).filter(u => !F.canonShipper(list, u.name, [], u.invoice).matched);
      await store.setSetting('shipper_unmapped', un);
      return json({ok: true, list, at, unmapped: un});
    }
    if (path === '/api/shipper-alias/unmapped' && method === 'DELETE') {
      if (!(await pinOk(body.admin_pin))) return json({error: (await pinLockedMsg()) || 'Admin PIN needed.', need_pin: true}, 403);
      const un = ((await store.getSetting('shipper_unmapped')) || []).filter(u => F.shipperKey(u.name) !== F.shipperKey(body.name));
      await store.setSetting('shipper_unmapped', un); return json({ok: true, unmapped: un});
    }
    if (path === '/api/profiles/export') {
      const ids = new Set((query.get('ids') || '').split(',').filter(x => /^\d+$/.test(x)).map(Number));
      const profs = (await store.profiles()).filter(p => !ids.size || ids.has(p.id));
      const out = {app: 'CFS Stock Desk', kind: 'shipper_formats', version: 1, exported_at: store.now(), pc: user + ' (web)', by: user,
        profiles: profs.map(p => ({shipper: p.shipper, data: p.data, updated_at: p.updated_at, updated_by: p.updated_by})),
        alias: await shipperAlias(), alias_at: (await store.getSetting('shipper_alias_at')) || ''};
      const d = CSD.ist.date();
      return fileResp(new Blob([JSON.stringify(out, null, 1)], {type: 'application/json'}), `CFS_shipper_formats_${user.replace(/[^A-Za-z0-9_-]+/g, '_')}_${d}.json`);
    }
    if (path === '/api/profiles/import' && method === 'POST') {
      const f = body.get('file'); if (!f) return json({error: 'Choose a shipper formats file (.json).'}, 400);
      let data; try { data = JSON.parse((await f.text()).replace(/^﻿/, '')); if (data.kind !== 'shipper_formats' || !Array.isArray(data.profiles)) throw 0; }
      catch (e) { return json({error: 'This is not a CFS Stock Desk shipper formats file.'}, 400); }
      const mode = body.get('mode') || 'newer'; const preview = body.get('preview') === '1';
      const mine = Object.fromEntries((await store.profiles()).map(p => [p.shipper, p]));
      const plan = [];
      for (const p of data.profiles) {
        const sh = String(p.shipper || '').toUpperCase().trim();
        if (!sh || !p.data || typeof p.data !== 'object') continue;
        const cur = mine[sh];
        const act = !cur ? 'add' : (mode === 'all' || (p.updated_at || '') > (cur.updated_at || '')) ? 'replace' : 'keep mine (same or newer)';
        plan.push({shipper: sh, action: act, theirs: p.updated_at, mine: cur ? cur.updated_at : null});
        if (!preview && (act === 'add' || act === 'replace')) await store.saveProfile(sh, Object.assign({}, p.data, {shipper: sh}), `${user} (imported from ${data.pc || 'another PC'})`);
      }
      if (Array.isArray(data.alias) && data.alias.length) {     /* v17.1: the shipper name list travels with the formats */
        const myAt = (await store.getSetting('shipper_alias_at')) || '', theirs = data.alias_at || '';
        const act = !isAdminUser() ? 'not changed – only an admin can import the shipper name list' : (theirs && theirs > myAt) || (mode === 'all' && theirs) ? 'replace' : 'keep mine (same or newer)';
        plan.push({shipper: `SHIPPER NAME LIST (${data.alias.length} shippers)`, action: act, theirs, mine: myAt || null});
        if (!preview && act === 'replace') { const ok = data.alias.filter(e => e && e.name).map(e => ({name: String(e.name).toUpperCase(), aliases: e.aliases || [], gstin: e.gstin || [], prefixes: (e.prefixes || []).filter(rx => { try { new RegExp(rx); return true; } catch (er) { return false; } })}));
          await store.setSetting('shipper_alias', ok); await store.setSetting('shipper_alias_at', theirs); await store.audit(user, 'alias_import', `shipper name list (${ok.length}) imported from ${data.pc || 'another PC'}`); }
      }
      return json({from_pc: data.pc, exported_at: data.exported_at, plan});
    }
    if ((m = path.match(/^\/api\/profiles\/(\d+)$/))) {
      if (method === 'DELETE') { await store.deleteProfile(+m[1]); return json({ok: true}); }
      if (method === 'PUT') { await store.updateProfile(+m[1], body.data, user); return json({ok: true}); }
    }
    if ((m = path.match(/^\/api\/profiles\/(\d+)\/field$/)) && method === 'POST') {
      const p = (await store.profiles()).find(x => x.id === +m[1]); if (!p) return json({error: 'Not found'}, 404);
      const d = p.data; d.header = d.header || {};
      if (body.action === 'forget') delete d.header[body.field];
      else if (body.action === 'fixed') d.header[body.field] = {method: 'fixed', value: coerce(body.field, body.value)};
      else if (body.action === 'forget_items') delete d.items;
      else if (body.action === 'need') { d.need = d.need || {}; if (body.value === 'no') d.need[body.field] = 'no'; else delete d.need[body.field]; }
      else if (body.action === 'source') { d.source = d.source || {}; if (!body.value || body.value === 'auto') delete d.source[body.field]; else d.source[body.field] = body.value; }
      await store.updateProfile(p.id, d, user); return json({ok: true});
    }
    if (path === '/api/combine' && method === 'POST') {
      const files = body.getAll('files').filter(f => f && f.name);
      const sources = [];
      if (body.get('include_mine') !== '0') sources.push(['This PC', (await store.stock('in')).map(s => s.data)]);
      for (const f of files) { try { sources.push([f.name, REP.importReport(await f.arrayBuffer()).rows]); } catch (e) { return json({error: `${f.name}: ${e.message}`}, 400); } }
      if (sources.length < 2) return json({error: 'Choose at least one report from another PC.'}, 400);
      return combineResponse(sources, body.get('preview') === '1', body.get('site'));
    }
    if (path === '/api/combine-data' && method === 'POST') {
      /* body.sources: [{name, rows}] read from the PCs' data files in the shared folder */
      const sources = [];
      if (body.include_mine) sources.push(['This PC', (await store.stock('in')).map(s => s.data)]);
      for (const src of body.sources || []) sources.push([src.name, src.rows || []]);
      if (!sources.length) return json({error: 'No data files found.'}, 400);
      return combineResponse(sources, !!body.preview, body.site);
    }
    /* ---- the 5 daily stock reports: abstract for the e-mail, log ---- */
    if (path === '/api/reconcile') {
      const c = (query.get('cfs') || thisCfs() || '').toUpperCase(), day = query.get('day') || today();
      const log = (await store.getSetting('report_log')) || [], mine = log.filter(x => x.date === day && x.slot === 'closing' && String(x.site || '').toUpperCase() === c).pop();
      const r = await reconcile(c, day);
      return json(Object.assign(r, {made_by: mine ? (mine.by === 'system' ? 'the app automatically (no Closing report made)' : mine.by) : '', made_at: mine ? mine.at : ''}));
    }
    if (path === '/api/report/abstract') {
      const slot = query.get('slot'); const si = REP.slotInfo(slot); if (!si) return json({error: 'Unknown report time'}, 400);
      let rows = siteRows((await store.stock('in')).map(s => s.data));
      const c = (query.get('cfs') || thisCfs() || '').toUpperCase(); if (c) rows = rows.filter(r => String(r['Warehouse ID'] || '').toUpperCase() === c);
      const site = c || 'CFS';
      return json(Object.assign(REP.abstractRows(rows), {subject: `APLL ${site} ${si.label} As On ${si.date} ${si.hrs}`, title: `${si.label} – As On ${si.date} ${si.hrs}`, slot: si}));
    }
    if (path === '/api/report/log') {
      const log = (await store.getSetting('report_log')) || [];
      return json({log: log.slice(-200).reverse(), today: log.filter(x => x.date === today() && (!thisCfs() || x.site === thisCfs())).map(x => x.slot)});
    }
    /* ---- Cargo Loading Plan ---- */
    if (path === '/api/plan/check' && method === 'POST') {
      const f = body.get('file'); if (!f) return json({error: 'Choose the loading plan (.xlsx) from Customer service.'}, 400);
      let plan; try { plan = CSD.ops.readPlan(await f.arrayBuffer()); } catch (e) { return json({error: 'Could not read this file: ' + e.message}, 400); }
      if (!plan.rows.length) return json({error: 'No planned rows found (need the columns "PO. No", "style" and "PLAN").'}, 400);
      const fileId = 'P' + Date.now().toString(36);
      const chk = CSD.ops.checkPlan(plan, await store.stock(null), thisCfs(), fileId, await bookingIndex());
      const mode = body.get('mode') || 'preview';
      if (mode === 'report') return fileResp(await CSD.ops.checkReport(chk, thisCfs(), f.name), `Loading_Plan_Check_${f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_')}.xlsx`);
      if (mode === 'apply') {
        let n = 0;
        for (const r of chk.rows) {
          if (!r.stock_id || r.issues.some(m => /^Already in plan|^Already stuffed/.test(m))) continue;
          const s = (await store.stock(null)).find(x => x.id === r.stock_id); if (!s) continue;
          const d = Object.assign({}, s.data, {'SHIP TO': r['SHIP TO'], STATUS: r.STATUS, 'T.POINT': r['T.POINT'], FOB: r.FOB, 'SHIP CXL': r['SHIP CXL'], PLAN: r.PLAN, 'Plan File': fileId});
          await store.updateStock(s.id, d, user + ' (loading plan)'); n++;
        }
        const plans = (await store.getSetting('plans')) || [];
        plans.push({id: fileId, file: f.name, at: store.now(), by: user, site: thisCfs(), rows: chk.rows.length, linked: n, summary: chk.summary});
        await store.setSetting('plans', plans.slice(-200)); await store.audit(user, 'loading_plan', `${f.name}: ${n} of ${chk.rows.length} rows linked`);
        return json({linked: n, rows: chk.rows.length});
      }
      return json({file: f.name, rows: chk.rows, summary: chk.summary, not_planned: chk.notPlanned, conflicts: chk.conflicts});
    }
    if (path === '/api/plans' && method === 'GET') {
      /* plans waiting to be stuffed: stock rows (in stock) linked to a plan */
      const rows = (await store.stock('in')).filter(s => s.data.PLAN && (!thisCfs() || String(s.data['Warehouse ID'] || '').toUpperCase() === thisCfs()));
      const g = {};
      for (const s of rows) { const k = String(s.data.PLAN); const a = g[k] = g[k] || {plan: k, rows: [], pkgs: 0, cbm: 0, gross: 0, shipto: new Set(), pod: new Set()};
        a.rows.push({id: s.id, data: s.data}); a.pkgs += CSD.ops.recv(s.data); a.cbm += CSD.ops.num(s.data['Total CBM']); a.gross += CSD.ops.num(s.data['Gross weight (kg)']);
        if (s.data['SHIP TO']) a.shipto.add(s.data['SHIP TO']); if (s.data['Port of Discharge']) a.pod.add(s.data['Port of Discharge']); }
      const list = Object.values(g).map(a => Object.assign(a, {cbm: +a.cbm.toFixed(3), gross: +a.gross.toFixed(3), shipto: [...a.shipto].join(', '), pod: [...a.pod].join(', ')}))
        .sort((a, b) => a.plan.localeCompare(b.plan, undefined, {numeric: true}));
      return json({plans: list, uploads: ((await store.getSetting('plans')) || []).slice(-20).reverse()});
    }
    /* ---- stuffing ---- */
    if (path === '/api/stuff' && method === 'POST') {
      const h = body.header || {}, lines = (body.rows || []).filter(x => x && x.id && +x.pkgs > 0);
      for (const k of ['container', 'date', 'carrier', 'unit', 'seal', 'truck_no', 'truck_type']) if (!String(h[k] || '').trim()) return json({error: 'Fill in: ' + ({container: 'Container no', date: 'Date of stuffing', carrier: 'Carrier', unit: 'Unit', seal: 'Carrier seal no', truck_no: 'Truck / trailer no', truck_type: 'Truck type (EV / Diesel / CNG)'})[k]}, 400);
      h.truck_no = String(h.truck_no).toUpperCase().replace(/[\s-]/g, '');
      if (!lines.length) return json({error: 'Tick at least one row as stuffed.'}, 400);
      const iso = V.isoCheck(h.container); h.container = iso.clean;
      const size = V.unitCode(h.unit); if (!size) return json({error: 'Unit (container size) should be 20GP, 40GP, 40HC or 45HC.'}, 400);
      h.unit = size;
      const all = await store.stock('in');
      for (const x of lines) if (!all.some(y => y.id === x.id)) return json({error: 'A row of this plan is no longer in stock. Reload the plan.'}, 409);
      { /* v17.1: ISO 6346 check digit and container capacity; red needs the admin PIN, amber (over 95%) needs a confirm */
        let cbm = 0, kg = 0;
        for (const x of lines) { const d = all.find(y => y.id === x.id).data, rc = CSD.ops.recv(d) || 1, f = Math.min(+x.pkgs, rc) / rc; cbm += CSD.ops.num(d['Total CBM']) * f; kg += CSD.ops.num(d['Gross weight (kg)']) * f; }
        cbm = Math.round(cbm * 1000) / 1000; kg = Math.round(kg);
        const cap = F.CONTAINER_CAP[size], pc = Math.max(cbm / cap.cbm, kg / cap.kg), red = [], amber = [];
        if (!iso.ok) red.push(iso.why);
        if (cbm > cap.cbm) red.push(`${cbm} CBM is more than a ${size} holds (${cap.cbm} CBM).`);
        if (kg > cap.kg) red.push(`${kg.toLocaleString('en-IN')} kg is more than the ${size} payload (${cap.kg.toLocaleString('en-IN')} kg).`);
        if (!red.length && pc > 0.95) amber.push(`This ${size} will be ${Math.round(pc * 100)}% full (${cbm} of ${cap.cbm} CBM, ${kg.toLocaleString('en-IN')} of ${cap.kg.toLocaleString('en-IN')} kg).`);
        if (red.length) {
          if (!body.admin_pin) return json({error: red.join(' '), need_pin: true, red}, 409);
          if (!(await pinOk(body.admin_pin))) return json({error: 'Wrong admin PIN.', need_pin: true, red}, 403);
          await store.audit(user, 'stuff_override', `${h.container} ${size}: ${red.join(' ')}`);
        } else if (amber.length && body.confirm_full !== true) return json({error: amber[0], need_confirm: true}, 409);
        h.load_cbm = cbm; h.load_kg = kg; h.load_pc = Math.round(pc * 100);
      }
      /* running number: one series per site, shared by every PC (central version: from the database) */
      let next;
      if (cloudOn()) { try { next = await store.nextRunningNo(thisCfs()); } catch (e) { return json({error: e.message, offline: true}, 503); } }
      else next = (await store.getSetting('running_no')) || 1;
      const done = [];
      for (const x of lines) {
        const s = all.find(y => y.id === x.id); if (!s) return json({error: 'A row of this plan is no longer in stock. Reload the plan.'}, 409);
        const d = s.data, rc = CSD.ops.recv(d), n = Math.min(+x.pkgs, rc);
        const part = n < rc, f = rc ? n / rc : 1, r3 = v => Math.round(v * 1000) / 1000;
        const stuffed = Object.assign({}, d, {'Received Pkgs': n, 'Stuffed Pkgs': n, 'Container No': h.container, 'Stuffing Date': h.date, 'Running No': next,
          'Stuffing Truck No': h.truck_no, 'Stuffing Truck Type': h.truck_type, 'Stuffing Transporter': h.transporter || ''});
        /* part load: cartons stuffed = n; pieces, CBM and weights in proportion; the rest stays in stock */
        const PROP = [['Item Qty (pcs)', Math.round], ['Total CBM', r3], ['Gross weight (kg)', r3], ['Net weight (kg)', r3], ['Actual CBM', r3]];
        if (part) { stuffed['Total Packages'] = n; for (const [fld, rnd] of PROP) if (!empty(d[fld])) stuffed[fld] = rnd(CSD.ops.num(d[fld]) * f); }
        const recRow = Object.assign({}, stuffed); done.push(recRow);
        if (part) {      // the rest stays in stock
          const rest = Object.assign({}, d, {'Received Pkgs': rc - n, 'Total Packages': Math.max(0, CSD.ops.num(d['Total Packages']) - n)});
          for (const [fld, rnd] of PROP) if (!empty(d[fld])) rest[fld] = rnd(CSD.ops.num(d[fld]) - stuffed[fld]);
          rest['OSD Remarks'] = [d['OSD Remarks'] && d['OSD Remarks'] !== 'NO OSD' ? d['OSD Remarks'] : '', `PART LOADED ${n} CTN(S) IN ${h.container}`].filter(Boolean).join(' | ');
          /* v17.1: one save – the rest stays in stock and the stuffed part leaves (checked by the database rules) */
          recRow._id = await store.splitStock(s.id, rest, Object.assign({}, stuffed), user + ' (part stuffed)');
        } else {
          await store.updateStock(s.id, stuffed, user + ' (stuffed)'); await store.setStatus([s.id], 'out', user); recRow._id = s.id;
        }
      }
      const rec = {running_no: next, plan: String(body.plan || ''), site: thisCfs(), header: h, rows: done, at: store.now(), by: user};
      const list = (await store.getSetting('stuffings')) || []; list.push(rec);
      await store.setSetting('stuffings', list); if (!cloudOn()) await store.setSetting('running_no', next + 1);
      await store.audit(user, 'stuffed', `Plan ${rec.plan} · ${h.container} · running no ${next} · ${done.length} rows`);
      return json({running_no: next, rows: done.length});
    }
    if (path === '/api/stuffings' && method === 'GET') {
      const list = ((await store.getSetting('stuffings')) || []).filter(s => !thisCfs() || s.site === thisCfs());
      return json({stuffings: list.slice(-100).reverse().map(s => ({running_no: s.running_no, plan: s.plan, date: s.header.date, container: s.header.container, unit: s.header.unit, carrier: s.header.carrier,
        rows: s.rows.length, pkgs: s.rows.reduce((t, x) => t + CSD.ops.num(x['Received Pkgs']), 0), at: s.at, by: s.by})), next_running_no: (await store.getSetting('running_no')) || 1});
    }
    if (path === '/api/stuffing-report') {
      const d = query.get('date'), rn = query.get('running');
      let list = ((await store.getSetting('stuffings')) || []).filter(s => !thisCfs() || s.site === thisCfs());
      list = rn ? list.filter(s => String(s.running_no) === rn) : list.filter(s => s.header.date === d);
      if (!list.length) return json({error: rn ? 'No such stuffing.' : 'No containers were stuffed on that date.'}, 404);
      list.sort((a, b) => a.running_no - b.running_no);
      const hd = (await REP.getHeaders())[(REP.SITES[thisCfs()] || {header: 'EVERBLUE'}).header] || {};
      const surveyor = String(hd.company || 'EVERBLUE INDIA').replace(/\s+SERVICES.*$/i, '').replace(/\s+PVT.*$/i, '');
      const name = rn ? `Stuffing_Report_${list[0].header.container}_${list[0].header.date}.xlsx` : `${(REP.SITES[thisCfs()] || {short: 'CFS'}).short.replace(/ /g, '_')}_Stuffing_Report_${d}.xlsx`;
      return fileResp(await CSD.ops.stuffingReport(list, surveyor), name);
    }
    /* ---- drop-down lists (admin) ---- */
    if (path === '/api/lists' && method === 'GET') return json({lists: await CSD.ops.getLists(), names: CSD.ops.LIST_NAMES, next_running_no: (await store.getSetting('running_no')) || 1});
    if (path === '/api/lists' && method === 'POST') {
      if (!(await pinOk(body.admin_pin))) return json({error: 'Admin PIN needed to change the lists.', need_pin: true}, 403);
      const out = {}; for (const k of CSD.ops.LIST_NAMES) out[k] = [...new Set((body.lists && body.lists[k] || []).map(v => String(v).trim()).filter(Boolean))];
      await store.setSetting('lists', out);
      if (body.next_running_no) { const n = parseInt(body.next_running_no, 10); if (n > 0) await store.setSetting('running_no', n); }
      await store.audit(user, 'lists', 'lists updated'); return json({ok: true});
    }
    /* ---- admin PIN ---- */
    if (path === '/api/admin-pin' && method === 'GET') return json({set: !!(await store.getSetting('admin_pin'))});
    if (path === '/api/admin-pin/check' && method === 'POST') {
      const lk = await pinLockedMsg(); if (lk) return json({ok: false, locked: true, error: lk});
      const ok = await pinOk(body.pin), s0 = await store.getSetting('admin_pin');
      return json({ok, locked: !!(await pinLockedMsg()), error: await pinLockedMsg(), weak: ok && !(s0 && s0.len >= 6)});
    }
    if (path === '/api/admin-pin' && method === 'POST') {
      const cur = await store.getSetting('admin_pin');
      if (cur && !(await pinOk(body.current))) return json({error: 'The current admin PIN is not correct.'}, 403);
      if (!/^\d{6,12}$/.test(String(body.pin || ''))) return json({error: 'The PIN must be 6 to 12 digits.'}, 400);
      if (/^(\d)\1+$/.test(body.pin) || '0123456789012'.includes(body.pin) || '9876543210987'.includes(body.pin)) return json({error: 'Choose a PIN that is not all the same digit or a simple run (123456).'}, 400);
      const salt = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
      await store.setSetting('admin_pin', {salt, hash: await pinHash(body.pin, salt), len: String(body.pin).length}); await store.audit(user, 'admin_pin', cur ? 'changed' : 'set');
      return json({ok: true});
    }
    /* ---- Shipper & CHA list ---- */
    if (path === '/api/cha-list' && method === 'GET') {
      const m = await chaMap();
      return json({list: [...m.values()].sort((a, b) => a.shipper.localeCompare(b.shipper)), uploaded: Object.keys((await store.getSetting('cha_list')) || {}).length});
    }
    if (path === '/api/cha-list/export') {
      const list = [...(await chaMap()).values()].sort((a, b) => a.shipper.localeCompare(b.shipper));
      const XLSX = root.XLSX, ws = XLSX.utils.aoa_to_sheet([['Shipper', 'CHA Name'], ...list.map(x => [x.shipper, x.cha])]);
      ws['!cols'] = [{wch: 45}, {wch: 35}];
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Shipper CHA');
      const out = XLSX.write(wb, {type: 'array', bookType: 'xlsx'});
      return fileResp(new Blob([out], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), 'Shipper_CHA_list.xlsx');
    }
    if (path === '/api/cha-list' && method === 'POST') {
      if (body.get('clear') === '1') { await store.setSetting('cha_list', null); return json({ok: true}); }
      const f = body.get('file'); if (!f) return json({error: 'Choose the Shipper & CHA list (.xlsx or .csv).'}, 400);
      let aoa; try { const wb = root.XLSX.read(await f.arrayBuffer(), {type: 'array'}); aoa = root.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, defval: ''}); }
      catch (e) { return json({error: 'Could not read this file: ' + e.message}, 400); }
      /* heading row = the first row with a shipper column AND a different CHA column (a title like "Shipper & CHA list" is skipped) */
      let hr = -1, cs = -1, cc = -1;
      for (let r = 0; r < Math.min(20, aoa.length) && hr < 0; r++) {
        let s1 = -1, c1 = -1;
        (aoa[r] || []).forEach((h, i) => {
          const t = String(h).toUpperCase().trim(); if (!t || t.length > 40) return;
          if (c1 < 0 && /\bCHA\b|CUSTOMS|BROKER|C\.H\.A/.test(t)) c1 = i;
          else if (s1 < 0 && /SHIPPER|VENDOR|EXPORTER/.test(t)) s1 = i;
        });
        if (s1 >= 0 && c1 >= 0 && s1 !== c1) { hr = r; cs = s1; cc = c1; }
      }
      if (hr < 0) return json({error: 'Could not find the columns "Shipper" and "CHA Name" in the first rows of the file.'}, 400);
      const list = {};
      for (const row of aoa.slice(hr + 1)) { const sh = String(row[cs] || '').trim().toUpperCase(), ch = String(row[cc] || '').trim().toUpperCase(); if (sh && ch) list[P.norm(sh)] = {shipper: sh, cha: ch}; }
      if (body.get('preview') === '1') return json({rows: Object.keys(list).length, examples: Object.values(list).slice(0, 5)});
      await store.setSetting('cha_list', list); await store.audit(user, 'cha_list', `${f.name}: ${Object.keys(list).length} shippers`);
      return json({rows: Object.keys(list).length});
    }
    if (path === '/api/backup') {
      const t = CSD.ist.stamp();
      return fileResp(new Blob([JSON.stringify(await store.snapshot())], {type: 'application/json'}), `CFS_Backup_${String(thisCfs() || query.get('cfs') || 'ALL').replace(/[^A-Za-z0-9]+/g, '_')}_${t.slice(0, 10)}_${t.slice(11, 13)}${t.slice(14, 16)}.json`);
    }
    return json({error: 'Unknown request ' + path}, 404);
  }

  /* Answer the app's own /api/ requests locally; everything else goes to the network as usual. */
  const realFetch = root.fetch.bind(root);
  root.fetch = async function (input, opts = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, root.location.href);
    const i = url.pathname.indexOf('/api/');
    if (i < 0 || url.origin !== root.location.origin) return realFetch(input, opts);
    const path = url.pathname.slice(i);
    let body = opts.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }
    try { return await handle((opts.method || 'GET').toUpperCase(), path, url.searchParams, body, opts.headers || {}); }
    catch (e) { console.error(e); return json({error: e.message || String(e)}, 500); }
  };
  root.CSD.server = {handle, VERSION};
})(typeof self !== 'undefined' ? self : globalThis);
