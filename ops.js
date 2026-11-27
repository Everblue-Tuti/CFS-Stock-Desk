/* Cargo Loading Plan (from Customer service), the check against stock, stuffing and the Stuffing Report.
   Everything stays in this browser (settings store): plans, stuffings, the drop-down lists, the running number,
   the report log. */
(function (root) {
  const CSD = root.CSD, F = CSD.F;
  const U = s => String(s ?? '').trim().toUpperCase();
  const N = s => U(s).replace(/[^A-Z0-9]/g, '');
  const empty = v => v === null || v === undefined || v === '';
  const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };

  /* ---------- drop-down lists (kept by the admin) ---------- */
  const LIST_NAMES = ['Applicant', 'Place of stuffing', 'Consignee', 'Port of loading', 'Port of destination', 'Carrier', 'Unit', 'Vessel', 'Transporter'];
  const LIST_DEFAULTS = {
    'Applicant': ['M/s APL LOGISTICS, TUTICORIN'],
    'Place of stuffing': ['M/s ST. JOHN ICD, TUTICORIN', 'M/s SICAL DISTRIPARK, TUTICORIN'],
    'Consignee': ['GAP'],
    'Port of loading': ['TUTICORIN'],
    'Port of destination': ['NEW YORK', 'HALIFAX', 'LOS ANGELES', 'SAVANNAH', 'HOUSTON'],
    'Carrier': ['MSC', 'MAERSK', 'CMA CGM', 'HAPAG-LLOYD', 'ONE', 'EVERGREEN', 'COSCO', 'YANG MING', 'HMM', 'ZIM'],
    'Unit': ['20 GP', '40 GP', '40 HC', '45 HC'],
    'Vessel': [],
    'Transporter': [],
  };
  async function getLists() {
    const saved = (await CSD.store.getSetting('lists')) || {};
    const out = {};
    for (const k of LIST_NAMES) out[k] = Array.isArray(saved[k]) ? saved[k] : LIST_DEFAULTS[k].slice();
    return out;
  }

  /* ---------- reading the plan Excel from Customer service ----------
     Any sheet; one or more heading rows (PO. No + style); columns found by their heading. */
  const PLAN_HEAD = {
    'PO Number': ['PO. NO', 'PO NO', 'PO NUMBER', 'PO'], 'Style': ['STYLE', 'STYLE NUMBER', 'STYLE NO'],
    'Shipper invoice number': ['SHIPPER INV NO', 'SHIPPER INVOICE NUMBER', 'INVOICE NO', 'INV NO'],
    'Total Packages': ['TOTAL PKGS', 'TOTAL PACKAGES', 'CTNS', 'CARTONS'], 'SHIP TO': ['SHIP TO'], 'STATUS': ['STATUS'],
    'T.POINT': ['T.POINT', 'T POINT', 'TPOINT'], 'FOB': ['FOB'], 'SHIP CXL': ['SHIP CXL', 'SHIP CANCEL', 'SHIP CXL DATE'], 'PLAN': ['PLAN', 'PLAN NO', 'PLAN NUMBER'],
    'Port of Discharge': ['PORT OF DISCHARGE'], 'Customer Name': ['CUSTOMER NAME'], 'Vendor Name': ['VENDOR NAME'], 'Delivery No': ['DELIVERY NO', 'BOOKING NO'],
  };
  const headKey = t => { const u = U(t).replace(/\s+/g, ' '); for (const [f, names] of Object.entries(PLAN_HEAD)) if (names.includes(u)) return f; return null; };
  const dateStr = v => v instanceof Date ? CSD.normDate(v) : (typeof v === 'number' && v > 20000 && v < 80000 ? CSD.normDate(new Date(Math.round((v - 25569) * 86400000))) : (CSD.normDate(v) || String(v ?? '').trim()));
  function readPlan(buf) {
    const wb = root.XLSX.read(buf, {type: 'array', cellDates: true});
    const rows = [], seen = new Map(), conflicts = [];
    for (const name of wb.SheetNames) {
      const aoa = root.XLSX.utils.sheet_to_json(wb.Sheets[name], {header: 1, defval: '', raw: true});
      let map = null;
      aoa.forEach((line, ri) => {
        const keys = line.map(headKey);
        if (keys.includes('PO Number') && keys.includes('Style')) { map = {}; keys.forEach((k, i) => { if (k && !(k in map)) map[k] = i; }); return; }
        if (!map) return;
        const g = f => (f in map ? line[map[f]] : '');
        const po = String(g('PO Number')).trim(), st = String(g('Style')).trim();
        if (!po || !st || /^TOTAL/i.test(po)) return;
        const r = {sheet: name, line: ri + 1, 'PO Number': U(po), Style: U(st), 'Shipper invoice number': U(g('Shipper invoice number')),
          'Total Packages': num(g('Total Packages')) || null, 'SHIP TO': U(g('SHIP TO')), STATUS: String(g('STATUS')).trim(), 'T.POINT': String(g('T.POINT')).trim(),
          FOB: String(g('FOB')).trim(), 'SHIP CXL': dateStr(g('SHIP CXL')), PLAN: String(g('PLAN')).trim(),
          'Port of Discharge': U(g('Port of Discharge')), 'Customer Name': U(g('Customer Name')), 'Vendor Name': U(g('Vendor Name')), 'Delivery No': String(g('Delivery No')).trim()};
        if (!r.PLAN) return;                         // only planned rows
        const k = N(r['PO Number']) + '|' + N(r.Style) + '|' + N(r['Shipper invoice number']);
        if (seen.has(k)) {
          const o = seen.get(k);
          for (const f of Object.keys(r)) if (empty(o[f]) && !empty(r[f])) o[f] = r[f];      // fill gaps from the other sheet
          if (String(o.PLAN) !== String(r.PLAN)) conflicts.push(`PO ${r['PO Number']} style ${r.Style}: plan ${o.PLAN} (sheet ${o.sheet}) and plan ${r.PLAN} (sheet ${name})`);
          return;
        }
        seen.set(k, r); rows.push(r);
      });
    }
    return {rows, conflicts};
  }

  /* ---------- check the plan against the stock ---------- */
  const recv = d => empty(d['Received Pkgs']) ? num(d['Total Packages']) : num(d['Received Pkgs']);
  function checkPlan(plan, stock, site, fileId, bookings) {
    const mine = stock.filter(s => !site || U(s.data['Warehouse ID']) === U(site) || !s.data['Warehouse ID']);
    const inStock = mine.filter(s => (s.status || 'in') === 'in'), out = mine.filter(s => s.status === 'out'), waiting = mine.filter(s => s.status === 'pending');
    const used = new Set();
    const res = plan.rows.map(p => {
      const match = s => N(s.data['PO Number']) === N(p['PO Number']) && N(s.data.Style) === N(p.Style) && (!p['Shipper invoice number'] || !s.data['Shipper invoice number'] || N(s.data['Shipper invoice number']) === N(p['Shipper invoice number']));
      const cands = inStock.filter(s => match(s) && !used.has(s.id));
      const r = Object.assign({}, p, {issues: [], level: 'ok', stock_id: null});
      const bad = (m, lvl = 'error') => { r.issues.push(m); if (lvl === 'error' || r.level === 'ok') r.level = lvl; };
      if (!cands.length) {
        const w = waiting.find(match);
        if (out.some(match)) bad('Already stuffed / shipped out');
        else if (w) bad(`On truck ${w.data['Truck Plate Number'] || ''} – waiting to offload`, 'warn');
        else bad('Not in stock');
        return r;
      }
      const s = cands[0]; used.add(s.id); r.stock_id = s.id;
      const d = s.data, rc = recv(d);
      if (p['Total Packages'] !== null && p['Total Packages'] !== rc) bad(`Cartons differ: plan ${p['Total Packages']}, received ${rc}`);
      if (d.PLAN && String(d.PLAN) !== String(p.PLAN) && d['Plan File'] !== fileId) bad(`Already in plan ${d.PLAN}`);
      if (U(d.OSD) === 'YES') bad(`OSD: ${d['OSD type'] || 'yes'}${d['OSD Remarks'] ? ' – ' + d['OSD Remarks'] : ''}`, 'warn');
      r.data = {cbm: num(d['Total CBM']), gross: num(d['Gross weight (kg)']), qty: num(d['Item Qty (pcs)']), received: rc, bay: d['Warehouse Bay number'] || ''};
      return r;
    });
    // stock rows for the same destinations that are in no plan
    const pods = new Set(plan.rows.map(p => N(p['Port of Discharge'])).filter(Boolean));
    /* SHIP TO from the booking list (Customer service) when known; otherwise the same port of discharge */
    const shipTo = d => { if (d['SHIP TO']) return N(d['SHIP TO']); if (!bookings) return ''; const b = bookings.get(N(d['PO Number']) + '|' + N(d.Style || '')) || bookings.get(N(d['PO Number']) + '|'); return b ? N(b['SHIP TO']) : ''; };
    const tos = new Set(plan.rows.map(p => N(p['SHIP TO'])).filter(Boolean));
    const notPlanned = inStock.filter(s => !used.has(s.id) && !s.data.PLAN && (tos.size && shipTo(s.data) ? tos.has(shipTo(s.data)) : (!pods.size || pods.has(N(s.data['Port of Discharge'])))))
      .map(s => ({id: s.id, 'SHIP TO': shipTo(s.data), 'Port of Discharge': s.data['Port of Discharge'], 'Customer Name': s.data['Customer Name'], 'PO Number': s.data['PO Number'], Style: s.data.Style,
        'Shipper invoice number': s.data['Shipper invoice number'], 'Received Pkgs': recv(s.data), 'Total CBM': s.data['Total CBM'], 'Warehouse Bay number': s.data['Warehouse Bay number']}));
    const plans = {};
    for (const r of res) {
      const a = plans[r.PLAN] = plans[r.PLAN] || {plan: r.PLAN, rows: 0, ok: 0, errors: 0, warns: 0, pkgs: 0, cbm: 0, gross: 0, shipto: new Set()};
      a.rows++; a[r.level === 'ok' ? 'ok' : r.level === 'warn' ? 'warns' : 'errors']++;
      if (r.data) { a.pkgs += r.data.received; a.cbm += r.data.cbm; a.gross += r.data.gross; }
      if (r['SHIP TO']) a.shipto.add(r['SHIP TO']);
    }
    const summary = Object.values(plans).map(a => Object.assign(a, {cbm: +a.cbm.toFixed(3), gross: +a.gross.toFixed(3), shipto: [...a.shipto].join(', ')}))
      .sort((a, b) => String(a.plan).localeCompare(String(b.plan), undefined, {numeric: true}));
    return {rows: res, notPlanned, summary, conflicts: plan.conflicts};
  }

  /* ---------- Excel helpers ---------- */
  const ST = () => CSD.report.STYLE;
  function headRow(ws, r, heads, widths) {
    const {NAVY, GRID, cal} = ST();
    heads.forEach((h, i) => { const c = ws.getCell(r, i + 1); c.value = h; c.font = cal({bold: true, color: {argb: 'FFFFFFFF'}}); c.border = GRID;
      c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: NAVY}}; c.alignment = {horizontal: 'center', vertical: 'middle', wrapText: true}; if (widths) ws.getColumn(i + 1).width = widths[i]; });
    ws.getRow(r).height = 30;
  }
  function dataCell(ws, r, i, v, o = {}) {
    const {GRID, cal, BAND} = ST();
    const c = ws.getCell(r, i + 1);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { c.value = CSD.report.cellValue('Entry Date', v); c.numFmt = CSD.report.DATE_FMT; }
    else c.value = v === undefined || v === '' ? null : v;
    c.font = cal(o.font || {}); c.border = GRID; c.alignment = {vertical: 'middle', horizontal: typeof v === 'number' ? 'right' : 'left', wrapText: !!o.wrap};
    if (o.numFmt) c.numFmt = o.numFmt;
    if (o.fill) c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: o.fill}}; else if (o.band) c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: BAND}};
    return c;
  }
  async function blob(wb) { const buf = await wb.xlsx.writeBuffer(); return new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); }

  /* the plan check as an Excel file: Check (every plan row), Plans (summary), Not in any plan */
  async function checkReport(check, site, fileName) {
    const {NAVY, TEAL, cal, TOTAL_FILL} = ST();
    const wb = new root.ExcelJS.Workbook();
    const ws = wb.addWorksheet('Check', {views: [{state: 'frozen', ySplit: 4, showGridLines: false}]});
    ws.mergeCells(1, 1, 1, 10); ws.getCell(1, 1).value = `Cargo Loading Plan check – ${site || ''}`; ws.getCell(1, 1).font = cal({size: 14, bold: true, color: {argb: NAVY}});
    ws.mergeCells(2, 1, 2, 10); ws.getCell(2, 1).value = `${fileName || ''} · checked ${CSD.ist.stamp()} IST`; ws.getCell(2, 1).font = cal({size: 9, color: {argb: 'FF595959'}});
    const H = ['PLAN', 'SHIP TO', 'Port of Discharge', 'PO. No', 'Style', 'Shipper Inv No', 'Plan Pkgs', 'Received Pkgs', 'CBM', 'Gross Weight', 'Warehouse BAY No', 'Result', 'Remarks'];
    headRow(ws, 4, H, [7, 16, 16, 13, 12, 18, 10, 11, 10, 12, 11, 12, 48]);
    const FILL = {ok: 'FFE3F3E8', warn: 'FFFFF1D1', error: 'FFFDE7E4'};
    check.rows.forEach((r, k) => {
      const vals = [r.PLAN, r['SHIP TO'], r['Port of Discharge'], r['PO Number'], r.Style, r['Shipper invoice number'], r['Total Packages'], r.data ? r.data.received : null,
        r.data ? r.data.cbm : null, r.data ? r.data.gross : null, r.data ? r.data.bay : '', r.level === 'ok' ? 'OK' : r.level === 'warn' ? 'CHECK' : 'PROBLEM', r.issues.join('; ')];
      vals.forEach((v, i) => dataCell(ws, 5 + k, i, v, {numFmt: i === 8 || i === 9 ? '#,##0.000' : i === 6 || i === 7 ? '#,##0' : null, fill: i >= 11 ? FILL[r.level] : null, band: k % 2 === 1, wrap: i === 12}));
    });
    ws.autoFilter = {from: {row: 4, column: 1}, to: {row: 4 + check.rows.length, column: H.length}};
    const s2 = wb.addWorksheet('Plans', {views: [{showGridLines: false}]});
    headRow(s2, 1, ['PLAN', 'SHIP TO', 'Rows', 'OK', 'Check', 'Problem', 'Cartons', 'CBM', 'Gross Weight'], [8, 40, 8, 8, 8, 10, 10, 10, 14]);
    check.summary.forEach((a, k) => [a.plan, a.shipto, a.rows, a.ok, a.warns, a.errors, a.pkgs, a.cbm, a.gross].forEach((v, i) => dataCell(s2, 2 + k, i, v, {numFmt: i === 7 || i === 8 ? '#,##0.000' : null, band: k % 2 === 1})));
    const s3 = wb.addWorksheet('Not in any plan', {views: [{showGridLines: false}]});
    headRow(s3, 1, ['Port of Discharge', 'Customer Name', 'PO. No', 'Style', 'Shipper Inv No', 'Received Pkgs', 'CBM', 'Warehouse BAY No'], [16, 22, 13, 12, 18, 11, 10, 12]);
    check.notPlanned.forEach((x, k) => [x['Port of Discharge'], x['Customer Name'], x['PO Number'], x.Style, x['Shipper invoice number'], x['Received Pkgs'], x['Total CBM'], x['Warehouse Bay number']]
      .forEach((v, i) => dataCell(s3, 2 + k, i, v, {band: k % 2 === 1})));
    if (check.conflicts.length) { const s4 = wb.addWorksheet('Plan file conflicts'); headRow(s4, 1, ['Row in two plans'], [100]); check.conflicts.forEach((c, k) => dataCell(s4, 2 + k, 0, c)); }
    return blob(wb);
  }

  /* ---------- Stuffing Report (your format; one sheet, containers one below the other) ---------- */
  const SR_HEAD = ['S.NO', 'DATE', 'Port of Discharge', 'Customer Name', 'Vendor Name', 'Booking No', 'PO. No', 'Shipper Inv No', 'Inv.Date', 'style', 'SHIP TO',
    'Total Pkgs', 'Received Pkgs', 'Item Qty (Pcs)', 'TYPE', 'Gross Weight', 'Net Weight', 'CBM', 'Warehouse BAY No', 'Shipping number', 'Shipping Date', 'CHA Name'];
  const SR_W = [5, 17, 14, 16, 18, 10, 11, 17, 11, 10, 14, 8, 9, 10, 6, 11, 11, 8, 10, 11, 11, 12];
  async function stuffingReport(list, surveyor) {
    const {NAVY, TEAL, cal, TOTAL_FILL, hair} = ST();
    const wb = new root.ExcelJS.Workbook();
    const ws = wb.addWorksheet('Stuffing Report', {views: [{showGridLines: false}]});
    SR_W.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    let r = 2;
    const lab = (row, col, text, span) => { if (span) ws.mergeCells(row, col, row, col + span - 1); const c = ws.getCell(row, col); c.value = text; c.font = cal({bold: true, size: 10}); };
    const val = (row, col, v, span) => { if (span) ws.mergeCells(row, col, row, col + span - 1); const c = ws.getCell(row, col); c.value = v instanceof Date ? v : (v ?? ''); c.font = cal({size: 10});
      if (v instanceof Date) c.numFmt = CSD.report.DATE_FMT; c.alignment = {horizontal: 'left'}; c.border = {bottom: hair}; };
    for (const s of list) {
      const h = s.header || {};
      const D = x => x ? CSD.report.cellValue('Entry Date', x) : '';
      lab(r, 11, 'PLAN'); val(r, 12, isNaN(+s.plan) ? s.plan : +s.plan);
      lab(r + 1, 11, 'RUNNING NO'); val(r + 1, 12, s.running_no);
      const top = r + 3;
      const left = [['APPLICANT', h.applicant], ['PLACE OF STUFFING', h.place], ['CONSIGNEE NAME', h.consignee], ['DATE OF STUFFING', D(h.date)], ['CONTAINER PICK UP DATE', D(h.pickup)],
        ['CONTAINER NO', h.container], ['CARRIER & UNIT', [h.carrier, h.unit].filter(Boolean).join(' & ')], ['CARRIER SEAL NO', h.seal], ['NO OF LABOUR USED', h.labour === '' || h.labour === undefined ? '' : +h.labour]];
      const right = [['PORT OF LOADING', h.pol], ['PORT OF DESTINATION', h.pod], ['TIME', [h.from, h.to].filter(Boolean).join(' TO ')], ['VESSEL NAME', h.vessel], null, ['VOYAGE', h.voyage],
        ['CARRIER BOOKING', h.booking], ['TRANSPORTER', h.transporter]];
      left.forEach(([l, v], k) => { lab(top + k, 1, l, 2); val(top + k, 3, v, 4); });
      right.forEach((x, k) => { if (!x) return; lab(top + k, 17, x[0], 2); val(top + k, 19, x[1], 4); });
      ws.mergeCells(top + 3, 8, top + 5, 15);
      const sv = ws.getCell(top + 3, 8); sv.value = surveyor || 'EVERBLUE INDIA'; sv.font = cal({size: 18, bold: true, color: {argb: NAVY}}); sv.alignment = {horizontal: 'center', vertical: 'middle'};
      const hr = top + left.length + 2;
      headRow(ws, hr, SR_HEAD);
      s.rows.forEach((x, k) => {
        const v = [k + 1, x['Entry Date'], x['Port of Discharge'], x['Customer Name'], x['Vendor Name'], x['Delivery No'], x['PO Number'], x['Shipper invoice number'], x['Invoice Date'], x.Style,
          x['SHIP TO'], x['Total Packages'], x['Received Pkgs'], x['Item Qty (pcs)'], x['Qty Type'], x['Gross weight (kg)'], x['Net weight (kg)'], x['Total CBM'],
          x['Warehouse Bay number'], x['Shipping Bill Number'], x['Shipping Bill date'], x['CHA Name']];
        v.forEach((y, i) => dataCell(ws, hr + 1 + k, i, typeof y === 'string' && /^\d+(\.\d+)?$/.test(y) && i !== 6 && i !== 9 && i !== 19 ? +y : y,
          {numFmt: [15, 16].includes(i) ? '#,##0.000' : i === 17 ? '0.00' : [11, 12, 13].includes(i) ? '#,##0' : null, band: k % 2 === 1}));
      });
      const tr = hr + 1 + s.rows.length;
      const tc = ws.getCell(tr, 11); tc.value = 'TOTAL'; tc.font = cal({bold: true});
      for (const [i, f, fm] of [[12, 'Total Packages', '#,##0'], [13, 'Received Pkgs', '#,##0'], [14, 'Item Qty (pcs)', '#,##0'], [16, 'Gross weight (kg)', '#,##0.000'], [17, 'Net weight (kg)', '#,##0.000'], [18, 'Total CBM', '0.00']]) {
        const c = ws.getCell(tr, i); const L = ws.getColumn(i).letter;
        c.value = {formula: `SUM(${L}${hr + 1}:${L}${tr - 1})`, result: s.rows.reduce((t, x) => t + num(x[f]), 0)}; c.numFmt = fm; c.font = cal({bold: true});
        c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: TOTAL_FILL}}; c.border = {top: {style: 'medium', color: {argb: NAVY}}};
      }
      r = tr + 4;
      ws.getRow(r - 2).addPageBreak && ws.getRow(r - 2).addPageBreak();
    }
    ws.pageSetup = {orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: {left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2}};
    return blob(wb);
  }

  root.CSD.ops = {LIST_NAMES, LIST_DEFAULTS, getLists, readPlan, checkPlan, checkReport, stuffingReport, recv, num, N, U};
})(typeof self !== 'undefined' ? self : globalThis);
