/* Excel stock report in the current APLL / Hind Terminal CFS layout (header block, header row 12, data from row 13,
   ALL sheet + one sheet per customer group), importing an existing report, and combining reports from several PCs. */
(function (root) {
  const CSD = root.CSD, F = CSD.F;
  /* Report header block per site. Chennai sites use PINNACLE MARINE SERVICES, Tuticorin sites EVERBLUE INDIA SERVICES.
     The lines can be edited in the app (Import / backup -> Report headers); these are the starting values. */
  const HEADERS_DEFAULT = {
    PINNACLE: {label: 'Chennai – HTPL and SATTVA',
      company: 'PINNACLE MARINE SERVICES PVT. LTD.',
      address: '9, GIRI NIWAS, AADI MARZBAN PATH, FORT,,Mumbai,Maharastra 400001,INDIA  TEL:+91-22-22692822  FAX:  Email-pinnacle.himanshu@rediffmail.com',
      branch: 'Branch Office: CHENNAI',
      branch_address: 'Branch Address: OFFICE NO 36/79, 2ND FLOOR, IBRAHIM CHAMBERS, ANGAPPA STREET, MANNADY, CHENNAI - 600001.,TAMILNADU TEL:8082000354 /044-48604422 Fax: Email:',
      agent: 'AGENT: APL LOGISTICS (INDIA) PVT LTD, CHENNAI'},
    EVERBLUE: {label: 'Tuticorin – ST JOHN and SICAL',
      company: 'EVERBLUE INDIA SERVICES',
      address: '2H/313 E & F, First Floor, KG Towers, Second Street, Kathirvel Nagar, Tuticorin - 628008',
      branch: '',
      branch_address: '',
      agent: 'AGENT: APL LOGISTICS (INDIA) PVT LTD, TUTICORIN'},
  };
  const HEADER_FIELDS = [['company', 'Company'], ['address', 'Address'], ['branch', 'Branch office'], ['branch_address', 'Branch address'], ['agent', 'Agent line']];
  const SITES = {
    'HIND TERMINAL CFS': {short: 'HTPL', city: 'CHENNAI', header: 'PINNACLE'},
    'SATTVA VICHOOR CFS': {short: 'SATTVA', city: 'CHENNAI', header: 'PINNACLE'},
    'SICAL DISTRIPARK': {short: 'SICAL', city: 'TUTICORIN', header: 'EVERBLUE'},
    'ST JOHN FREIGHT SYSTEMS': {short: 'ST JOHN', city: 'TUTICORIN', header: 'EVERBLUE'},
  };
  async function getHeaders() {
    let saved = null;
    try { saved = CSD.store && await CSD.store.getSetting('report_headers'); } catch (e) {}
    const out = {};
    for (const [k, d] of Object.entries(HEADERS_DEFAULT)) out[k] = Object.assign({}, d, (saved || {})[k] || {}, {label: d.label});
    return out;
  }
  const LINES = Object.assign({warehouse: 'HIND TERMINAL CFS'}, HEADERS_DEFAULT.PINNACLE);
  const HEADER_FILL = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF1F4E78'}};
  const THIN = {style: 'thin', color: {argb: 'FFBFBFBF'}};
  const BORDER = {left: THIN, right: THIN, top: THIN, bottom: THIN};
  const THIN_BLACK = {style: 'thin', color: {argb: 'FF000000'}};
  const BORDER_BLACK = {left: THIN_BLACK, right: THIN_BLACK, top: THIN_BLACK, bottom: THIN_BLACK};
  const DATE_FMT = 'dd-mmm-yyyy';   // e.g. 03-Nov-2026
  const font = (o = {}) => Object.assign({name: 'Arial', size: 9}, o);

  /* ---- report layouts ----
     APLL (Chennai: HTPL, SATTVA): the 49 APLL columns.
     GAP  (Tuticorin: ST JOHN, SICAL): the columns of the GAP stock report (without its second "style" column). */
  const GAP_CODE = {'ST JOHN FREIGHT SYSTEMS': 'STJ', 'SICAL DISTRIPARK': 'SICAL', 'HIND TERMINAL CFS': 'HTPL', 'SATTVA VICHOOR CFS': 'SATTVA'};
  const dt = (d, t) => d ? (t ? d + ' ' + t : d) : '';
  function endDT(r) {       // offloading end: same day as the start, next day when it ends before it starts
    const d = r['Offloading Date'], s = r['Offloading Start Time'], e = r['Offloading END Time'];
    if (!d || !e) return '';
    if (s && e < s) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) + ' ' + e; }
    return d + ' ' + e;
  }
  const up = v => (v === null || v === undefined) ? v : String(v).toUpperCase();
  const L = (h, f, get) => ({h, f, get: get || (r => r[f])});
  const LAYOUTS = {
    APLL: () => F.APLL_COLUMNS.map(f => L(f, f)),
    GAP: () => [
      L('DATE', 'Entry Date'), L('Warehouse ID', 'Warehouse ID', r => GAP_CODE[String(r['Warehouse ID'] || '').toUpperCase()] || r['Warehouse ID']),
      L('Port of Discharge', 'Port of Discharge'), L('Final Destination', 'FPD'), L('Cargo Description', 'Cargo Description'),
      L('Customer Name', 'Customer Name'), L('Customer Type', 'Customer Type'), L('Vendor Name', 'Vendor Name'), L('Delivery No', 'Delivery No'),
      L('PO. No', 'PO Number'), L('Style number', 'Style'), L('Colour', 'Colour'), L('Shipper Inv No', 'Shipper invoice number'),
      L('Inv.Date', 'Invoice Date'), L('Total Pkgs', 'Total Packages'), L('Received Pkgs', 'Received Pkgs'), L('Item Qty (Pcs)', 'Item Qty (pcs)'),
      L('TYPE', 'Qty Type'), L('Package UOM', 'Package UOM'), L('Gross Weight', 'Gross weight (kg)'), L('Net Weight', 'Net weight (kg)'),
      L('CBM Per Booking', 'Total CBM'), L('Actual CBM', 'Actual CBM'), L('Warehouse BAY No', 'Warehouse Bay number'), L('Shipping number', 'Shipping Bill Number'),
      L('Shipping Date', 'Shipping Bill date'), L('CHA Name', 'CHA Name'), L('Document Cut Off Date', 'Document Cutoff Date'),
      L('Document Cut Off Time', 'Document Cutoff Time'), L('Document Hand over Date', 'Handover Date'), L('Document Hand over Time', 'Handover Time'),
      L('Allow Date', 'Allow Date'), L('Allow Time', 'Allow Time'), L('Truck Plate Number', 'Truck Plate Number'),
      Object.assign(L('Offloading Start Date Time', '_dt', r => dt(r['Offloading Date'], r['Offloading Start Time'])), {kind: 'datetime'}),
      Object.assign(L('Offloading End Date Time', '_dt', endDT), {kind: 'datetime'}),
      L('TRANSPORT NAME', 'Transporter Name'), L('Size', 'VehicleSize'), L('Sorted / Unsorted', 'SORTED/UN SORTED', r => up(r['SORTED/UN SORTED'])), L('Late Cargo', 'Late Cargo', r => up(r['Late Cargo'])),
      L('NO OF LABOUR', 'No of Labour'), L('OSD', 'OSD', r => up(r.OSD)), L('OSD Type', 'OSD type'), L('OSD Cartons', 'Total OSD cartons'),
      L('OSD Remarks', 'OSD Remarks')],
  };
  const GAP_ALIAS = {'date': 'Entry Date', 'final destination': 'FPD', 'po. no': 'PO Number', 'po no': 'PO Number', 'style number': 'Style',
    'shipper inv no': 'Shipper invoice number', 'inv.date': 'Invoice Date', 'inv date': 'Invoice Date', 'total pkgs': 'Total Packages',
    'received pkgs': 'Received Pkgs', 'item qty (pcs)': 'Item Qty (pcs)', 'type': 'Qty Type', 'gross weight': 'Gross weight (kg)',
    'net weight': 'Net weight (kg)', 'nett weight': 'Net weight (kg)', 'cbm': 'Total CBM', 'cbm per booking': 'Total CBM', 'actual cbm': 'Actual CBM',
    'osd': 'OSD', 'osd type': 'OSD type', 'osd cartons': 'Total OSD cartons', 'warehouse bay no': 'Warehouse Bay number', 'shipping number': 'Shipping Bill Number',
    'shipping date': 'Shipping Bill date', 'document cut off date': 'Document Cutoff Date', 'document cut off time': 'Document Cutoff Time',
    'document hand over date': 'Handover Date', 'document hand over time': 'Handover Time', 'transport name': 'Transporter Name',
    'size': 'VehicleSize', 'sorted / unsorted': 'SORTED/UN SORTED', 'no of labour': 'No of Labour'};
  const layoutFor = site => (SITES[String(site || '').toUpperCase()] || {}).city === 'TUTICORIN' ? 'GAP' : 'APLL';
  function cellValue(f, v, kind) {
    if (v === null || v === undefined || v === '') return null;
    if (kind === 'datetime') { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{1,2}):(\d{2}))?/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))) : v; }
    if (v === null || v === undefined || v === '') return null;
    if (F.DATES.has(f)) { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : v; }
    if (F.TIMES.has(f)) { const m = String(v).match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1] * 60 + +m[2]) / 1440 : v; }
    if (F.NUMERIC.has(f)) { const x = Number(v); return isNaN(x) ? v : x; }
    return v;
  }
  /* One report style for every site and surveyor (PINNACLE or EVERBLUE): letterhead block at the top left
     (blank lines skipped), column headings on row 12, data from row 13, totals row underneath.
     Only the look is set here – headings and data are exactly as in the stock. */
  const NAVY = 'FF1F3A5F', TEAL = 'FF0C6B75', GREY = 'FF595959', BAND = 'FFF3F6F9', LINE = 'FFD0D7DE', TOTAL_FILL = 'FFE4EBF2';
  const cal = (o = {}) => Object.assign({name: 'Calibri', size: 10}, o);
  const hair = {style: 'thin', color: {argb: LINE}};
  const GRID = {left: hair, right: hair, top: hair, bottom: hair};
  const RIGHT = new Set(['Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)', 'Total OSD cartons', 'Net weight (kg)', 'Received Pkgs', 'No of Labour', 'Actual CBM']);
  const NUMFMT = {'Item Qty (pcs)': '#,##0', 'Total Packages': '#,##0', 'Total OSD cartons': '#,##0', 'Total CBM': '#,##0.000', 'Gross weight (kg)': '#,##0.000',
    'Net weight (kg)': '#,##0.000', 'Received Pkgs': '#,##0', 'No of Labour': '0', 'Actual CBM': '#,##0.000'};
  const TOTALS = ['Item Qty (pcs)', 'Total Packages', 'Received Pkgs', 'Total CBM', 'Actual CBM', 'Gross weight (kg)', 'Net weight (kg)', 'Total OSD cartons'];
  function widthFor(col, rows) {
    const f = col.f;
    if (col.kind === 'datetime') return 17;
    if (F.DATES.has(f)) return 12.5;
    if (F.TIMES.has(f)) return 9;
    let w = Math.max(...String(col.h).split(/\s+/).map(x => x.length)) + 2;           // heading wraps on spaces
    for (const r of rows.slice(0, 2000)) { const v = col.get(r); if (v !== null && v !== undefined && v !== '') w = Math.max(w, String(v).length + 3); }
    return Math.max(8, Math.min(42, w));
  }
  function sheet(wb, name, titleLine, rows, lines, cols) {
    cols = cols || LAYOUTS.APLL();
    const ws = wb.addWorksheet(name, {views: [{state: 'frozen', ySplit: 12, showGridLines: false}],
      pageSetup: {orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 2, fitToHeight: 0,
        margins: {left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2}, printTitlesRow: '12:12'}});
    const last = Math.min(cols.length, 12);
    const line = (r, v, font, height) => {
      ws.mergeCells(r, 1, r, last);
      const c = ws.getCell(r, 1); c.value = v; c.font = font; c.alignment = {horizontal: 'left', vertical: 'middle', wrapText: true};
      if (height) ws.getRow(r).height = height;
    };
    /* letterhead: surveyor name, then its address lines without gaps */
    line(1, lines.company || null, cal({bold: true, size: 16, color: {argb: NAVY}}), 24);
    let r = 2;
    for (const [k, bold] of [['address', false], ['branch', true], ['branch_address', false]]) {
      if (lines[k]) { line(r, lines[k], cal({size: 10, bold, color: {argb: GREY}}), 15); r++; }
    }
    while (r <= 4) { ws.getRow(r).height = 6; r++; }
    line(6, lines.warehouse || null, cal({bold: true, size: 13, color: {argb: TEAL}}), 20);
    line(8, titleLine || null, cal({bold: true, size: 12, color: {argb: NAVY}}), 18);
    line(10, lines.agent || null, cal({bold: true, size: 10, color: {argb: GREY}}), 15);
    ws.getRow(5).height = 6; ws.getRow(7).height = 6; ws.getRow(9).height = 6; ws.getRow(11).height = 8;
    /* column headings (text unchanged) */
    const head = ws.getRow(12); head.height = 45;
    cols.forEach((col, i) => {
      const c = ws.getCell(12, i + 1);
      c.value = col.h; c.font = cal({bold: true, color: {argb: 'FFFFFFFF'}});
      c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: NAVY}};
      c.alignment = {horizontal: 'center', vertical: 'middle', wrapText: true};
      c.border = {left: {style: 'thin', color: {argb: 'FF3E5C7E'}}, right: {style: 'thin', color: {argb: 'FF3E5C7E'}}};
      ws.getColumn(i + 1).width = widthFor(col, rows);
    });
    /* data */
    rows.forEach((row, ri) => {
      const band = ri % 2 === 1 ? {type: 'pattern', pattern: 'solid', fgColor: {argb: BAND}} : null;
      cols.forEach((col, i) => {
        const f = col.f;
        const c = ws.getCell(13 + ri, i + 1);
        c.value = cellValue(f, col.get(row), col.kind); c.font = cal(); c.border = GRID;
        if (band) c.fill = band;
        if (col.kind === 'datetime') { c.numFmt = 'dd-mmm-yyyy hh:mm'; c.alignment = {horizontal: 'center', vertical: 'middle'}; }
        else if (F.DATES.has(f)) { c.numFmt = DATE_FMT; c.alignment = {horizontal: 'center', vertical: 'middle'}; }
        else if (F.TIMES.has(f)) { c.numFmt = 'hh:mm'; c.alignment = {horizontal: 'center', vertical: 'middle'}; }
        else if (RIGHT.has(f)) { if (NUMFMT[f]) c.numFmt = NUMFMT[f]; c.alignment = {horizontal: 'right', vertical: 'middle', indent: 1}; }
        else c.alignment = {horizontal: 'left', vertical: 'middle', indent: 1};
      });
    });
    if (rows.length) ws.autoFilter = {from: {row: 12, column: 1}, to: {row: 12 + rows.length, column: cols.length}};
    /* totals row: Item Qty, Total Packages, Total CBM, Gross weight */
    if (rows.length) {
      const tr = 13 + rows.length, lastRow = 12 + rows.length;
      const top = {style: 'medium', color: {argb: NAVY}};
      cols.forEach((col, i) => { const c = ws.getCell(tr, i + 1); c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: TOTAL_FILL}}; c.border = {top, bottom: hair}; });
      const TOT = cols.some(c => c.h === 'DATE') ? TOTALS : ['Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)'];   // APLL: as the original
      for (const f of TOT) {
        const col = cols.findIndex(x => x.f === f) + 1; if (!col) continue;
        const L = colLetter(col);
        const sum = rows.reduce((a, x) => a + (Number(x[f]) || 0), 0);
        const c = ws.getCell(tr, col);
        c.value = {formula: `SUM(${L}13:${L}${lastRow})`, result: Math.round(sum * 1000) / 1000};
        c.font = cal({bold: true, color: {argb: NAVY}}); c.numFmt = NUMFMT[f]; c.alignment = {horizontal: 'right', vertical: 'middle', indent: 1};
      }
      ws.getRow(tr).height = 18;
    }
  }
  function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  const siteOf = r => String(r['Warehouse ID'] || '').trim().toUpperCase();
  /* rows grouped by site, in the order HTPL, SATTVA, SICAL, ST JOHN, then anything else, then rows without a CFS */
  function splitBySite(rows) {
    const m = new Map();
    for (const r of rows) { const k = siteOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    const order = [...F.CFS_LIST.filter(c => m.has(c)), ...[...m.keys()].filter(k => k && !F.CFS_LIST.includes(k)).sort(), ...(m.has('') ? [''] : [])];
    return order.map(site => ({site, rows: m.get(site)}));
  }
  /* ---- the 5 daily stock reports: Opening 10:00, 12:00, 16:00, 18:00, Closing (time of making) ---- */
  const SLOTS = {opening: {label: 'Opening Stock Report', at: '10:00'}, s1200: {label: 'Stock Report', at: '12:00'}, s1600: {label: 'Stock Report', at: '16:00'},
    s1800: {label: 'Stock Report', at: '18:00'}, closing: {label: 'Closing Stock Report', at: null}};
  function slotInfo(slot, d = new Date()) {
    const s = SLOTS[slot]; if (!s) return null;
    const t = CSD.ist.parts(d);                    // India time
    const hm = s.at || `${t.H}:${t.M}`;
    return {slot, label: s.label, at: hm, date: `${t.d}.${t.m}.${t.y}`, hhmm: hm.replace(':', ''), hrs: hm.replace(':', '.') + ' hrs'};
  }
  /* Abstract: per customer – number of POs, cartons, pieces, CBM, gross weight, with a TOTAL */
  function abstractRows(rows) {
    const m = new Map();
    for (const r of rows) {
      const k = String(r['Customer Name'] || 'NOT SET').trim().toUpperCase();
      const a = m.get(k) || {customer: k, pos: new Set(), pkgs: 0, qty: 0, cbm: 0, gross: 0};
      if (r['PO Number']) a.pos.add(String(r['PO Number'])); a.pkgs += +r['Total Packages'] || 0; a.qty += +r['Item Qty (pcs)'] || 0;
      a.cbm += +r['Total CBM'] || 0; a.gross += +r['Gross weight (kg)'] || 0; m.set(k, a);
    }
    const out = [...m.values()].sort((a, b) => a.customer.localeCompare(b.customer)).map(a => ({customer: a.customer, pos: a.pos.size, pkgs: a.pkgs, qty: a.qty, cbm: +a.cbm.toFixed(3), gross: +a.gross.toFixed(3)}));
    const t = out.reduce((t, a) => ({customer: 'TOTAL', pos: t.pos + a.pos, pkgs: t.pkgs + a.pkgs, qty: t.qty + a.qty, cbm: t.cbm + a.cbm, gross: t.gross + a.gross}), {pos: 0, pkgs: 0, qty: 0, cbm: 0, gross: 0});
    t.cbm = +t.cbm.toFixed(3); t.gross = +t.gross.toFixed(3);
    return {rows: out, total: t};
  }
  function abstractSheet(wb, rows, lines, title, extra = {}) {
    const ws = wb.addWorksheet('Abstract', {views: [{showGridLines: false}], properties: {tabColor: {argb: TEAL}}});
    const {rows: ab, total} = abstractRows(rows);
    const H = ['Customer', 'No. of POs', 'Total Pkgs', 'Item Qty (Pcs)', 'CBM', 'Gross Weight (kg)'];
    [44, 12, 13, 15, 13, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const put = (r, v, f) => { ws.mergeCells(r, 1, r, 6); const c = ws.getCell(r, 1); c.value = v; c.font = cal(f); c.alignment = {vertical: 'middle'}; };
    let r = 1;
    put(r++, lines.company, {size: 15, bold: true, color: {argb: NAVY}});
    if (lines.address) put(r++, lines.address, {size: 9, color: {argb: GREY}});
    r++; put(r++, lines.warehouse, {size: 13, bold: true, color: {argb: TEAL}});
    put(r++, title, {size: 12, bold: true}); ws.getRow(r - 1).height = 20;
    put(r++, 'ABSTRACT REPORT', {size: 10, bold: true, color: {argb: GREY}});
    r++;
    const hr = r;
    H.forEach((h, i) => { const c = ws.getCell(hr, i + 1); c.value = h; c.font = cal({bold: true, color: {argb: 'FFFFFFFF'}}); c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: NAVY}};
      c.alignment = {horizontal: i ? 'center' : 'left', vertical: 'middle', wrapText: true, indent: i ? 0 : 1}; c.border = GRID; });
    ws.getRow(hr).height = 30;
    const fm = [null, '#,##0', '#,##0', '#,##0', '#,##0.000', '#,##0.000'];
    ab.forEach((a, k) => {
      const vals = [a.customer, a.pos, a.pkgs, a.qty, a.cbm, a.gross];
      vals.forEach((v, i) => { const c = ws.getCell(hr + 1 + k, i + 1); c.value = v; c.font = cal(); c.border = GRID; if (fm[i]) c.numFmt = fm[i];
        c.alignment = {horizontal: i ? 'right' : 'left', vertical: 'middle', indent: 1}; if (k % 2) c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: BAND}}; });
      ws.getRow(hr + 1 + k).height = 18;
    });
    const tr = hr + 1 + ab.length;
    [total.customer, total.pos, total.pkgs, total.qty, total.cbm, total.gross].forEach((v, i) => { const c = ws.getCell(tr, i + 1); c.value = v; c.font = cal({bold: true}); if (fm[i]) c.numFmt = fm[i];
      c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: TOTAL_FILL}}; c.border = {top: {style: 'medium', color: {argb: NAVY}}, bottom: hair, left: hair, right: hair};
      c.alignment = {horizontal: i ? 'right' : 'left', vertical: 'middle', indent: 1}; });
    ws.getRow(tr).height = 20;
    let er = tr + 2;
    const rc = extra.recon;
    if (rc && rc.opening) {          /* v17.1 daily reconciliation */
      const line = (lab, p, c, f = {}) => { ws.getCell(er, 1).value = lab; ws.getCell(er, 3).value = p; ws.getCell(er, 3).numFmt = '#,##0'; ws.getCell(er, 5).value = c; ws.getCell(er, 5).numFmt = '#,##0.000';
        [1, 3, 5].forEach(i => { ws.getCell(er, i).font = cal(f); ws.getCell(er, i).alignment = {horizontal: i === 1 ? 'left' : 'right', indent: 1}; }); er++; };
      ws.mergeCells(er, 1, er, 6); ws.getCell(er, 1).value = 'DAILY RECONCILIATION (cartons · CBM)'; ws.getCell(er, 1).font = cal({bold: true, color: {argb: NAVY}}); er++;
      line(`Opening (closing of ${rc.opening.date})`, rc.opening.pkgs, rc.opening.cbm);
      line('+ In (offloaded today)', rc.in.pkgs, rc.in.cbm); line('− Out (shipped out today)', rc.out.pkgs, rc.out.cbm);
      line('= Expected closing', rc.expected.pkgs, rc.expected.cbm, {bold: true}); line('Closing (this report)', rc.closing.pkgs, rc.closing.cbm, {bold: true});
      if (!rc.ok) line(`DIFFERENCE – explain (admin changes today: ${rc.admin_changes})`, rc.diff.pkgs, rc.diff.cbm, {bold: true, color: {argb: 'FFC00000'}});
      else line('Difference', 0, 0, {color: {argb: 'FF1F7A1F'}});
      er++;
    }
    if (extra.madeBy) { ws.mergeCells(er, 1, er, 6); ws.getCell(er, 1).value = `Made by ${extra.madeBy}`; ws.getCell(er, 1).font = cal({size: 9, italic: true, color: {argb: GREY}}); }
    ws.pageSetup = {orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: {left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3}};
    return ws;
  }
  async function buildReport(rows, extraSheets = [], site = null, opts = {}) {
    const headers = await getHeaders();
    const s = site === null ? (splitBySite(rows)[0] || {site: ''}).site : site;
    const def = SITES[s] || {header: 'PINNACLE'};
    const lines = Object.assign({}, headers[def.header], {warehouse: s || 'CFS NOT SET'});
    const cols = LAYOUTS[layoutFor(s)]();
    const wb = new root.ExcelJS.Workbook();
    if (opts.slot) { const si = slotInfo(opts.slot, opts.now || new Date()); abstractSheet(wb, rows, lines, `${si.label} – As On ${si.date} ${si.hrs}`, {recon: opts.recon, madeBy: opts.madeBy}); }
    sheet(wb, 'ALL', null, rows, lines, cols);
    const groups = new Map();
    for (const r of rows) { const g = String(r.GroupName || 'UNASSIGNED').trim().toUpperCase(); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
    const order = [...F.GROUP_ORDER.filter(g => groups.has(g)), ...[...groups.keys()].filter(g => !F.GROUP_ORDER.includes(g)).sort()];
    for (const g of order) sheet(wb, g.replace(/[\[\]*?/\\:]/g, ' ').slice(0, 31), g, groups.get(g), lines, cols);
    /* Tuticorin: every damage line (PO, style, colour, size, carton numbers, type, remark) */
    const dmg = rows.flatMap(r => (Array.isArray(r.Damage) ? r.Damage : []).map(l => [cellValue('Entry Date', r['Entry Date']) || '', r['Shipper invoice number'] || '', r['Vendor Name'] || '',
      l.po, l.style, l.colour, l.size, l.cartons, l.count, l.type, l.remark, r['Warehouse Bay number'] || '']));
    if (dmg.length) extraSheets = [['Damage details', ['Date', 'Shipper Inv No', 'Vendor Name', 'PO. No', 'Style No', 'Colour', 'Size', 'Carton No(s)', 'Damaged cartons', 'Damage type', 'Remark', 'Warehouse BAY No'], dmg], ...extraSheets];
    for (const [title, headers, data] of extraSheets) {
      const ws = wb.addWorksheet(title.slice(0, 31));
      headers.forEach((h, i) => { const c = ws.getCell(1, i + 1); c.value = h; c.font = font({bold: true, color: {argb: 'FFFFFFFF'}, size: 10}); c.fill = HEADER_FILL; ws.getColumn(i + 1).width = i === 0 ? 34 : 20; });
      data.forEach((row, r) => row.forEach((v, i) => { const c = ws.getCell(r + 2, i + 1); c.value = v; c.font = font({size: 10}); if (v instanceof Date) c.numFmt = DATE_FMT; }));
    }
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function reportFileName(kind = '', site = '', slot = null) {
    const d = new Date(), t = CSD.ist.parts(d);
    const name = site ? site.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : 'CFS_NOT_SET';
    const si = slot && slotInfo(slot, d);
    if (si) return `APLL_${name}_${si.label.replace(/ /g, '_')}_As_On_${si.date}.${si.hhmm}_hrs.xlsx`;
    return `APLL_${name}_Stock_Report${kind}_As_On_${t.d}.${t.m}.${t.y}.${t.H}${t.M}_hrs.xlsx`;
  }

  /* ---- read an existing stock report (.xlsx); uses the ALL sheet when there is one ---- */
  function importValue(f, v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') {
      if (F.DATES.has(f)) return CSD.normDate(new Date(Math.round((v - 25569) * 86400000))) || '';
      if (F.TIMES.has(f)) return CSD.normTime(v - Math.floor(v));
      if (!F.NUMERIC.has(f) && Number.isInteger(v)) return String(v);
      return v;
    }
    if (typeof v === 'boolean') return String(v);
    const s = String(v).trim();
    if (F.DATES.has(f) && s) return CSD.normDate(s) || s;
    if (F.TIMES.has(f) && s) return CSD.normTime(s) || s;
    return s;
  }
  function importReport(buf) {
    const XLSX = root.XLSX;
    const wb = XLSX.read(buf, {type: 'array', cellDates: false});
    const ws = wb.Sheets.ALL || wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, defval: null, blankrows: true});
    let hdr = -1;
    for (let r = 0; r < Math.min(40, aoa.length); r++) if ((aoa[r] || []).includes('Warehouse ID')) { hdr = r; break; }
    if (hdr < 0) throw new Error('Could not find the header row ("Warehouse ID") in this file.');
    /* headings of the APLL report are the field names; the GAP report uses its own headings */
    const byField = {}, lower = Object.fromEntries(F.COLUMNS.map(f => [f.toLowerCase(), f]));
    let gapStyleCol = null, startCol = null, endCol = null;
    (aoa[hdr] || []).forEach((h, i) => {
      if (h === null || h === undefined || h === '') return;
      const t = String(h).trim(), k = t.toLowerCase();
      if (t === 'style') { gapStyleCol = i; return; }                 // GAP's second style column (fallback only)
      if (k === 'offloading start date time') { startCol = i; return; }
      if (k === 'offloading end date time') { endCol = i; return; }
      const f = lower[k] || GAP_ALIAS[k];
      if (f && !(f in byField)) byField[f] = i;
    });
    const isGap = 'Entry Date' in byField || startCol !== null;
    const CODE_TO_CFS = Object.fromEntries(Object.entries(GAP_CODE).map(([c, k]) => [k, c]));
    const splitDT = v => {            // Excel date-time number or "17-11-2026 16:30" -> [date, time]
      if (v === null || v === undefined || v === '') return ['', ''];
      if (typeof v === 'number') return [importValue('Offloading Date', Math.floor(v)), CSD.normTime(v - Math.floor(v)) || ''];
      const m = String(v).trim().match(/^(.*?)[ T]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)$/i);
      return m ? [CSD.normDate(m[1]) || '', CSD.normTime(m[2]) || ''] : [CSD.normDate(String(v)) || '', ''];
    };
    const rows = []; let fixed = 0;
    for (let r = hdr + 1; r < aoa.length; r++) {
      const line = aoa[r] || [];
      if (!line[byField['Warehouse ID'] ?? 0]) continue;
      const row = {};
      for (const f of F.COLUMNS) row[f] = f in byField ? importValue(f, line[byField[f]]) : '';
      if (isGap) {
        const w = String(row['Warehouse ID'] || '').trim().toUpperCase(); if (CODE_TO_CFS[w]) row['Warehouse ID'] = CODE_TO_CFS[w];
        if (!row.Style && gapStyleCol !== null) row.Style = importValue('Style', line[gapStyleCol]);
        if (startCol !== null) { const [d, t] = splitDT(line[startCol]); if (d) row['Offloading Date'] = d; if (t) row['Offloading Start Time'] = t; }
        if (endCol !== null) { const [d, t] = splitDT(line[endCol]); if (t) row['Offloading END Time'] = t; if (d && !row['Offloading Date']) row['Offloading Date'] = d; }
        for (const f of ['Vendor Name', 'Customer Name']) if (typeof row[f] === 'string') row[f] = row[f].trim();
      }
      if (!row.GroupName) { const m = F.CUSTOMERS[String(row['Customer Name'] || '').toUpperCase()]; if (m) { row.GroupName = m[2]; if (!row['Customer Type']) row['Customer Type'] = m[1]; } }
      if (!row['Transporter Name'] && row.Articles && !/\d/.test(String(row.Articles))) { row['Transporter Name'] = row.Articles; row.Articles = ''; fixed++; }
      rows.push(CSD.V.normaliseRow(row));
    }
    return {rows, fixed};
  }
  root.CSD.report = {SLOTS, slotInfo, abstractRows, STYLE: {NAVY, TEAL, GREY, BAND, TOTAL_FILL, GRID, hair, cal}, cellValue, DATE_FMT, buildReport, importReport, reportFileName, splitBySite, getHeaders, HEADERS_DEFAULT, HEADER_FIELDS, SITES, LINES, LAYOUTS, layoutFor};
})(typeof self !== 'undefined' ? self : globalThis);
