/* Automatic first reading for a NEW shipper (no saved format yet).
   Looks for the usual printed labels (Invoice No, Exporter, Consignee, Port of Discharge, IEC, SB No …) and for the
   item table (Style / Item Ref + Qty + Cartons + CBM + Gross weight columns). Everything found this way is shown in
   amber ("read automatically – check"). When the user saves, the confirmed values teach the format as before, so
   the next document from the same shipper is read with the saved format. */
(function (root) {
  const CSD = root.CSD, F = CSD.F, P = CSD.P;
  const empty = v => v === null || v === undefined || v === '';
  const U = s => String(s || '').toUpperCase();
  const xc = c => (c.x0 + c.x1) / 2;
  const isNum = t => P.isNumberish(String(t).replace(/[|\]\[=]+/g, ' ').trim());
  const numClean = t => String(t).replace(/[|\]\[=]+/g, ' ').replace(/\s+/g, ' ').trim();

  /* ---------- header labels ---------- */
  const H = [
    {f: 'Shipper invoice number', re: /(^|[^A-Z])[LI1|]?(INVO[I1L]CE|INV\b)\.?\s*(NO|NUMBER|NB|N°|#|REF)?/, not: /\b(TOTAL|AMOUNT|VALUE|CURRENCY|CHARGABLE|CHARGEABLE|IN\s+WORDS)\b|INVOICE\s+DATE\s*:?\s*$/, kind: 'id', dir: ['in', 'right', 'below']},
    {f: 'Invoice Date', re: /(^|[^A-Z])[LI1|]?(INVO[I1L]CE|INV)\.?\s*(DATE|DT|DTD)\b|(INVO[I1L]CE|INV)\.?\s*(NO|NUMBER)\.?\s*(&|AND)\s*DATE/, kind: 'date', dir: ['in', 'right', 'below']},
    {f: 'Vendor Name', re: /^(EXPORTER|SELLER|SHIPPER|VENDOR|MANUFACTURER|MAKER)\b(?!['’])/, not: /\b(REF|CODE|NO)\b/, kind: 'name', dir: ['in', 'below', 'right']},
    {f: 'Consignee', re: /\b(CONSIGNEE|SEND\s*TO)\b/, not: /OTHER\s+THAN/, kind: 'name', dir: ['in', 'below', 'right']},
    {f: 'Port of Discharge', re: /\bPORT\s+OF\s+DISCHARGE\b|\bP\.?O\.?D\b|\bDISCHARGE\s+PORT\b/, kind: 'place', dir: ['in', 'right', 'below']},
    {f: 'FPD', re: /\bFINAL\s+(DESTINATION|PLACE|PORT)\b|\bPLACE\s+OF\s+DELIVERY\b|\bF\.?P\.?D\b/, kind: 'place', dir: ['in', 'right', 'below']},
    {f: 'IEC', re: /\bI\.?E\.?C\b/, kind: 'iec', dir: ['in', 'right', 'below']},
    {f: 'CIN', re: /\bCIN\b/, kind: 'id', dir: ['in', 'right']},
    {f: 'Booking Number', re: /\b(BOOKING|BKG)\b\.?\s*(NO|NUMBER|REF)?/, kind: 'id', dir: ['in', 'right', 'below']},
    {f: 'Shipping Bill Number', re: /\b(S\.?B|SHIPPING\s+BILL)\b\.?\s*(NO|NUMBER)\b/, kind: 'digits', dir: ['in', 'right', 'below']},
    {f: 'Shipping Bill date', re: /\b(S\.?B|SHIPPING\s+BILL)\b\.?\s*(DATE|DT)\b/, kind: 'date', dir: ['in', 'right', 'below']},
    {f: 'SB LEO DATE', re: /\bLEO\b\.?\s*(DATE|DT)\b/, kind: 'date', dir: ['in', 'right', 'below']},
    {f: 'SB LEO TIME', re: /\bLEO\b\.?\s*TIME\b/, kind: 'time', dir: ['in', 'right', 'below']},
    {f: 'CHA Name', re: /^(CHA|C\.H\.A|CUSTOMS\s+(HOUSE\s+)?(AGENT|BROKER))\b/, kind: 'name', dir: ['in', 'right', 'below']},
    {f: 'PO Number', re: /\b(BUYER'?S?\s+ORDER|ORDER\s+(NO|NUMBER)|P\.?O\.?\s*(NO|NUMBER|#))\b/, kind: 'id', dir: ['in', 'right', 'below']},
  ];
  const tidy = s => String(s).replace(/^[\s'"‘’“”`|:;.,(\[-]+/, '').replace(/[\s'"‘’“”`|:;,)\]]+$/, '').replace(/\s+/g, ' ').trim();
  function afterLabel(t, re) {          // "IEC No: 3593003996" -> "3593003996"
    const m = U(t).match(re); if (!m) return '';
    let rest = t.slice(m.index + m[0].length), prev = null;
    while (prev !== rest) { prev = rest; rest = rest.replace(/^\s*((&|AND)\s*DATE|NO\b\.?|NUMBER|#|[:.\-])\s*/i, ''); }
    return tidy(rest);
  }
  /* a neighbouring cell that is itself a label is never a value */
  const LABELISH = /^(BUYER|MAKER|SELLER|NOTIFY|EXPORTER|CONS[I1L]G\w*|SEND\s*TO|COUNTRY|PORT|FINAL|PLACE|VESSEL|PRE.?CARRIAGE|TERMS|MARKS|INVOICE|DATE|IEC|GSTIN|PAN|ORDER|DESCRIPTION|TOTAL|MODE|INCOTERM|SHIPPER|VENDOR|ISSUING|BANK|PAGE|PACKING|CHA|LEO|SB|SHIPPING|BOOKING|CONTAINER)\b/i;
  const isLabelCell = t => /:\s*$/.test(String(t).trim()) || LABELISH.test(tidy(t));
  function check(kind, v, f) {
    v = tidy(v); if (!v || isLabelCell(v)) return null;
    const u = U(v);
    if (kind === 'id') {
      v = v.replace(/\s+(DT|DATE|DATED|D\/T)\b.*$/i, '').replace(/\s*\/\s*/g, '/').replace(/\s*-\s*/g, '-');
      if (!/\d/.test(v) || v.length < 3 || v.length > 30 || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(v)) return null;
      if (v.split(' ').length > 3) return null;
      return U(v);
    }
    if (kind === 'digits') { const m = u.match(/\b\d{6,8}\b/); return m ? m[0] : null; }
    if (kind === 'iec') { const m = u.replace(/\s/g, '').match(/\d{10}/); return m ? m[0] : null; }
    if (kind === 'date') { const m = v.match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}[ -](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[ -,]*\d{2,4}|\d{4}-\d{2}-\d{2}/i); return CSD.normDate(m ? m[0] : v) || null; }
    if (kind === 'time') return CSD.normTime(v) || null;
    if (kind === 'name') {
      v = v.replace(/^\(\s*|\s*\)$/g, '').trim();
      const letters = (v.match(/[A-Za-z]/g) || []).length;
      if (letters < 3 || letters < v.replace(/\s/g, '').length * 0.6 || v.length > 60) return null;
      if (/\b(STREET|ROAD|NAGAR|PLOT|AVENUE|AVDA|NO\.\s*\d)/i.test(v)) return null;
      return U(v).replace(/\bS\.A\.?$/, 'SA').replace(/[.,]+$/, '');
    }
    if (kind === 'place') {
      v = v.replace(/^[:\s]+/, '').split(/\s*[,»(]\s*|\s+-\s+|\s+–\s+/)[0].trim();
      if (!/^[A-Za-z][A-Za-z .']{2,30}$/.test(v)) return null;
      return U(v);
    }
    return U(v);
  }
  function below(pg, ri, c, maxDown = 3) {
    for (let r = ri + 1; r < Math.min(pg.rows.length, ri + 1 + maxDown); r++) {
      const hit = pg.rows[r].find(x => Math.min(x.x1, c.x1 + 15) > Math.max(x.x0, c.x0 - 15) && Math.abs(x.x0 - c.x0) < (pg.kind === 'excel' ? 1.5 : 60));
      if (hit) return [hit, r, pg.rows[r].indexOf(hit)];
    }
    return null;
  }
  function headerGuess(docs) {
    const out = {}, src = {};
    const pages = []; for (const d of docs) for (const pg of d.pages) pages.push(pg);
    const topText = pg => U(pg.rows.slice(0, 4).map(r => r.map(c => c.t).join(' ')).join(' '));
    const SBF = new Set(['Shipping Bill Number', 'Shipping Bill date', 'SB LEO DATE', 'SB LEO TIME', 'CHA Name']);
    function pref(f, pg) {        // which kind of document a field should come from
      const t = topText(pg), sb = /SHIPPING\s+BILL/.test(t);
      if (SBF.has(f)) return sb ? 0 : 1;
      if (f === 'Shipper invoice number' || f === 'Invoice Date') return /INVOICE/.test(t) && !sb ? 0 : sb ? 2 : 1;
      return sb ? 1 : 0;
    }
    for (const spec of H) {
      let best = null;
      pages.forEach((pg, pi) => pg.rows.forEach((row, ri) => row.forEach((c, ci) => {
        const t = U(c.t);
        if (t.length > 60 || !spec.re.test(t) || (spec.not && spec.not.test(t))) return;
        if (spec.f === 'Shipper invoice number' && /\b(PACKING|PROFORMA)\b/.test(t)) return;
        const tries = [];
        for (const [di, dir] of spec.dir.entries()) {
          if (dir === 'in') tries.push([afterLabel(c.t, spec.re), [pg.id, ri, ci], di]);
          if (dir === 'right' && row[ci + 1]) tries.push([row[ci + 1].t, [pg.id, ri, ci + 1], di]);
          if (dir === 'below') { const b = below(pg, ri, c); if (b) tries.push([b[0].t, [pg.id, b[1], b[2]], di]); }
        }
        for (const [raw, ref, rank] of tries) {
          const v = check(spec.kind, raw, spec.f); if (!v) continue;
          const score = pref(spec.f, pg) * 10 + rank + pi * 0.001 + (t.endsWith(':') ? -0.5 : 0);
          if (!best || score < best[2]) best = [v, ref, score];
          break;
        }
      })));
      if (best) { out[spec.f] = best[0]; src[spec.f] = best[1]; }
    }
    // IEC is often printed inside the REX number: INREX3292001471TC025
    if (!out.IEC) for (const pg of pages) for (const row of pg.rows) for (const c of row) { const m = U(c.t).replace(/\s/g, '').match(/INREX(\d{10})/); if (m && !out.IEC) out.IEC = m[1]; }
    // Customer: a known customer name printed anywhere, else the consignee
    const all = pages.map(pg => pg.rows.map(r => r.map(c => P.norm(c.t)).join('|')).join('|')).join('|');
    let cust = null;
    for (const k of Object.keys(F.CUSTOMERS).sort((a, b) => b.length - a.length)) if (P.norm(k).length >= 4 && all.includes(P.norm(k))) { cust = k; break; }
    const base = s => P.canon(s).replace(/(5A|SA|5AS|SAS|LLC|LTD|INC)$/, '');
    if (cust) { out['Customer Name'] = cust; if (out.Consignee && base(out.Consignee) === base(cust)) out.Consignee = cust; }
    else if (out.Consignee) out['Customer Name'] = out.Consignee;
    // FPD printed as a country only -> use the port city (as in the stock report)
    if (out['Port of Discharge'] && (!out.FPD || out.FPD.length <= 3 || /^(SPAIN|FRANCE|USA|UNITED STATES|CANADA|GERMANY|ITALY|UK|UNITED KINGDOM|NETHERLANDS|BELGIUM|INDIA)$/.test(out.FPD))) { out.FPD = out['Port of Discharge']; delete src.FPD; }
    return {header: out, src};
  }

  /* ---------- which document a page belongs to ----------
     invoice / packing list / shipping bill / purchase order, from the page's own title (first lines),
     then the Excel sheet name, then the file name. Used for the per-shipper "read this column from" setting. */
  const TYPES = [['vdf', /VENDORS?\s*CARGO\s*DELIVERY\s*NOTICE|CARGO\s*DELIVERY\s*NOTICE/], ['sb', /SHIPPING\s*BILL|\bS\/?B\b\s*(NO|COPY)/], ['po', /PURCHASE\s+ORDER|\bP\.?O\.?\s+(COPY|SHEET)/],
    ['packing', /PACKING\s*LIST|PACKING\s*SLIP|\bP\.?\s?L\b|PACKING/], ['invoice', /INVOICE|\bINV\b/]];
  const TYPE_NAMES = {invoice: 'Invoice', packing: 'Packing list', sb: 'Shipping bill', po: 'Purchase order', vdf: 'VDF (delivery notice)', other: 'Other'};
  function pageType(pg, docName) {
    if (pg._type) return pg._type;
    const top = U(pg.rows.slice(0, 6).map(r => r.map(c => c.t).join(' ')).join(' | '));
    const sheet = U(String(pg.title || '').replace(/^SHEET\s+/i, ''));
    const file = U(String(docName || pg.doc || '').replace(/[_\-.]+/g, ' '));
    for (const txt of [top, sheet, file]) for (const [t, re] of TYPES) if (re.test(txt)) return (pg._type = t);
    return (pg._type = 'other');
  }
  function docsFor(docs, type) {
    return docs.map(d => ({name: d.name, pages: d.pages.filter(pg => pageType(pg, d.name) === type)})).filter(d => d.pages.length);
  }
  /* Values of the item fields that a shipper reads from a chosen document (e.g. quantity from the invoice,
     cartons / CBM / weight from the packing list). Rows are matched by style + PO (or style alone). */
  function overrideItems(items, docs, sources, profItems) {
    const byType = {};
    for (const [f, type] of Object.entries(sources || {})) {
      if (!F.ITEM_FIELDS.includes(f) || f === 'Style' || !type || type === 'auto') continue;
      if (!byType[type]) {
        const sub = docsFor(docs, type);
        let rows = [];
        if (sub.length && profItems) { try { rows = P.applyProfile({items: profItems}, sub).items; } catch (e) { rows = []; } }
        let autoRows = []; if (sub.length) try { autoRows = itemsGuess(sub); } catch (e) {}
        byType[type] = {prof: rows, auto: autoRows};
      }
      const {prof, auto} = byType[type];
      const used = new Map([[prof, new Set()], [auto, new Set()]]);
      for (const it of items) {
        /* same style + PO; a style that appears on several lines (several POs) takes the next unused line */
        const find = list => {
          const ok = x => P.canon(x.Style) === P.canon(it.Style) && (!it['PO Number'] || !x['PO Number'] || P.norm(x['PO Number']) === P.norm(it['PO Number']));
          const u = used.get(list); let k = list.findIndex((x, j) => ok(x) && !u.has(j)); if (k < 0) k = list.findIndex(ok);
          if (k >= 0) u.add(k); return k >= 0 ? list[k] : undefined;
        };
        let hit = find(prof), how = 'profile';
        if (!hit || empty(hit[f])) { hit = find(auto); how = 'auto'; }
        it._ai = it._ai || {}; it._src = it._src || {};
        if (hit && !empty(hit[f])) { it[f] = hit[f]; it._src[f] = (hit._src || {})[f]; if (how === 'auto') it._ai[f] = 'auto'; else delete it._ai[f]; }
        else { it[f] = null; delete it._src[f]; delete it._ai[f]; }    // not in that document: asked (red)
      }
    }
    return items;
  }

  /* ---------- PO of an item row ----------
     An invoice can cover several purchase orders. When the PO is not a column of the item table, it is printed
     above the items (e.g. "PO No: 4500012345", one block or one page per PO): each item row takes the nearest PO
     printed above it on the same page, so the same style under two POs gives two stock rows. */
  const PO_RE = /(^|[^A-Z])(P\.?\s?O\.?(\s*(NO|NUMBER|NB|N°|#|REF))?|PURCHASE\s+ORDER(\s*(NO|NUMBER|#))?|(BUYER'?S?\s+)?ORDER\s*(NO|NUMBER|NB|N°|#|REF))\.?\s*(:|$|\s)/;
  const poShape = v => !/\bBOX\b/.test(v) && (/^\d+$/.test(v) ? v.length >= 7 : v.length >= 6 && (v.match(/\d/g) || []).length >= 3);
  function poValue(pg, ri, ci) {
    const row = pg.rows[ri], c = row[ci], t = U(c.t);
    if (t.length > 50 || !PO_RE.test(t) || /\b(DATE|DT)\s*:?\s*$/.test(t) && !/\d/.test(t)) return null;
    const tries = [afterLabel(c.t, PO_RE).replace(/\s+(DT|DATE|DATED)\b.*$/i, '')];
    if (row[ci + 1]) tries.push(row[ci + 1].t);
    const b = below(pg, ri, c, 1); if (b) tries.push(b[0].t);
    for (const raw of tries) { const v = check('id', raw); if (v && poShape(v)) return v; }
    return null;
  }
  function poNear(pg, ri, skipRows) {
    for (let r = ri; r >= 0 && r >= ri - 80; r--) {
      if (skipRows && skipRows.has(r)) continue;
      const row = pg.rows[r];
      for (let ci = 0; ci < row.length; ci++) {
        const v = poValue(pg, r, ci); if (v) return v;
      }
    }
    return null;
  }

  /* ---------- item table ---------- */
  const ROLE = [
    ['Style', /\b(STYLE|ITEM\s*REF|ITEM\s*REFERENCE|REFERENCE|ARTICLE|ART\.?\s*NO|MODEL|ITEM\s*(NO|CODE|#)|SKU|ITEM)\b/, /\b(DESCRIPTION|DESC)\b/],
    ['PO Number', /\b(ORDER\s*(NO|NUMBER|NB)?|P\.?O\.?\s*(NO|NUMBER|#)?|PO)\b/, /\bGLOBAL\b/],
    ['Item Qty (pcs)', /\b(QTY|QUANTITY|PCS|PIECES|UNITS|TTL\s*PCS)\b/, /\b(PCS\s*\/\s*(CTN|INNER|CRTN)|QTY\s*\/|\/\s*(CTN|CRTN)|PER\s+(CTN|CARTON)|INNER|ASST|UNIT\s*PRICE)\b/],
    ['Total Packages', /\b(CTNS?|CRTNS?|CRINS|CARTONS?|PKGS?|PACKAGES?|BOXES|BALES|NO\.?\s*OF)\b/, /\b(DIMENSION|DIMENSIONS|NUMBERS?|PCS|CTN\s*NO|CARTON\s*NO|L\s*X)\b/],
    ['Total CBM', /\b(CBM|VOLUME|M3)\b/, null],
    ['Gross weight (kg)', /\b(GROSS|GR\.?\s*WT|G\.?\s*W\.?T?|GRS)\b/, /\bNET\b/],
    ['Net weight (kg)', /\b(NET|NT)\b/, /\b(GROSS|GR)\b|NET\s*(PRICE|AMOUNT|VALUE)/],
    ['Colour', /\b(COLOU?RS?|CLR)\b/, null],
  ];
  const WEIGHT = /\b(WEIGHT|WT|WGT|KGS?)\b/, NET = /\b(NET|NT)\b/;
  const styleLike = v => /^[A-Z0-9][A-Z0-9\-\/.]{3,19}$/i.test(v) && /\d/.test(v) && (/[A-Z]/i.test(v) ? !/^\d+[.,]\d+$/.test(v) : /^\d{6,}$/.test(v));
  function tablesOn(pg) {
    const tables = [], excel = pg.kind === 'excel';
    for (let hr = 0; hr < pg.rows.length; hr++) {
      // header = this row, plus the next row when it holds more labels (two-line headings)
      const rowsH = [hr]; const nxt = pg.rows[hr + 1];
      if (nxt && nxt.filter(c => !isNum(c.t)).length >= Math.max(2, nxt.length * 0.6)) rowsH.push(hr + 1);
      const labels = pg.rows[hr].filter(c => !isNum(c.t));
      if (labels.length < 3) continue;
      const firstTxt = U(pg.rows[hr].map(c => c.t).join(' | '));
      if (!ROLE.some(([, re]) => re.test(firstTxt))) continue;
      if (pg.rows[hr].filter(c => /^\s*[:;+]/.test(c.t) || /:\s*$/.test(c.t)).length >= 2) continue;
      // columns: cells of the first header row; second-row words attach to the nearest column
      const cols = pg.rows[hr].map(c => ({x0: c.x0, x1: c.x1, t: U(c.t)}));
      if (rowsH.length > 1) for (const c of pg.rows[hr + 1]) {
        let k = cols.findIndex(h => Math.min(h.x1, c.x1) > Math.max(h.x0, c.x0));
        if (k < 0) { let bd = 1e9; cols.forEach((h, i) => { const d = Math.abs(xc(h) - xc(c)); if (d < bd) { bd = d; k = i; } }); if (bd > (excel ? 1.5 : 45)) { cols.push({x0: c.x0, x1: c.x1, t: U(c.t)}); continue; } }
        cols[k].t += ' ' + U(c.t); cols[k].x0 = Math.min(cols[k].x0, c.x0); cols[k].x1 = Math.max(cols[k].x1, c.x1);
      }
      cols.sort((a, b) => a.x0 - b.x0);
      const roles = {};
      for (const [f, re, not] of ROLE) cols.forEach((h, i) => {
        if (re.test(h.t) && !(not && not.test(h.t))) (roles[f] = roles[f] || []).push(i);
      });
      // plain "weight" columns (no NET) are gross candidates too
      cols.forEach((h, i) => { if (WEIGHT.test(h.t) && !NET.test(h.t) && !(roles['Gross weight (kg)'] || []).includes(i) && !(roles['Total CBM'] || []).includes(i)) (roles['Gross weight (kg)'] = roles['Gross weight (kg)'] || []).push(i); });
      if (!roles.Style) continue;
      roles.Style = roles.Style.filter(i => !(roles['PO Number'] || []).includes(i) || /ITEM|STYLE|REF/.test(cols[i].t));
      if (!roles.Style.length) continue;
      const numRoles = ['Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)'].filter(f => roles[f]);
      if (numRoles.length < 1) continue;
      tables.push({pg, hr, last: rowsH[rowsH.length - 1], cols, roles, score: 1 + numRoles.length + (roles['PO Number'] ? 0.5 : 0)});
      hr = rowsH[rowsH.length - 1];
    }
    return tables;
  }
  function colOf(t, c) {
    const excel = t.pg.kind === 'excel';
    if (excel) { // Excel: column numbers; a value belongs to the header whose merged span contains it
      let k = t.cols.findIndex(h => c.x0 >= h.x0 && c.x0 < h.x1);
      if (k < 0) k = t.cols.findIndex(h => c.x0 === h.x0);
      return k;
    }
    let k = -1, bd = 1e9;
    t.cols.forEach((h, i) => { const d = Math.min(Math.abs(xc(h) - xc(c)), Math.abs(h.x1 - c.x1), Math.abs(h.x0 - c.x0)); if (d < bd) { bd = d; k = i; } });
    return bd <= 70 ? k : -1;
  }
  function pickNum(raw) { const c = P.numCandidates(numClean(raw)); return c; }
  function rowsOf(t) {
    const out = [], pg = t.pg;
    const lastCol = Math.max(...Object.values(t.roles).flat());
    for (let ri = t.last + 1; ri < Math.min(pg.rows.length, t.last + 60); ri++) {
      const row = pg.rows[ri];
      if (row.length && /^\s*(TOTAL|GRAND\s+TOTAL|SUB\s*TOTAL)\b/i.test(row[0].t) && out.length) break;
      if (row.filter(c => !isNum(c.t)).length >= 3 && ROLE[0][1].test(U(row.map(c => c.t).join(' '))) && ri > t.last + 1) break;   // next header
      const byCol = {}; const extra = [];
      row.forEach((c, ci) => { const k = colOf(t, c); if (k >= 0) { (byCol[k] = byCol[k] || []).push([c, ci]); } else extra.push([c, ci]); });
      let style = null, sref = null;
      for (const k of t.roles.Style) for (const [c, ci] of byCol[k] || []) {
        const v = tidy(c.t).split(' ')[0]; if (!style && styleLike(v)) { style = U(v); sref = [pg.id, ri, ci]; }
      }
      if (!style) continue;
      const r = {Style: style, _src: {Style: sref}, _ai: {Style: 'auto'}};
      const cand = {};
      for (const f of ['Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)', 'Net weight (kg)']) if (t.roles[f]) {
        for (const k of t.roles[f]) for (const [c, ci] of byCol[k] || []) { if (!isNum(c.t)) continue; const n = pickNum(c.t); if (n.length) (cand[f] = cand[f] || []).push([n, [pg.id, ri, ci]]); }
      }
      const LIM = {'Item Qty (pcs)': [0.5, 5000], 'Total CBM': [0.002, 0.6], 'Gross weight (kg)': [0.05, 80], 'Net weight (kg)': [0.05, 80]};
      const pk = (cand['Total Packages'] || []).map(([n, ref]) => [n.find(x => Number.isInteger(x) && x > 0), ref]).find(([x]) => x);
      if (pk) { r['Total Packages'] = pk[0]; r._src['Total Packages'] = pk[1]; r._ai['Total Packages'] = 'auto'; }
      for (const f of ['Item Qty (pcs)', 'Total CBM', 'Gross weight (kg)', 'Net weight (kg)']) {
        let best = null;
        for (const [n, ref] of cand[f] || []) {
          const v = pk ? (n.find(x => x / pk[0] >= LIM[f][0] && x / pk[0] <= LIM[f][1]) ?? null) : n[0];
          if (v === null) continue;
          // weights/volume: when two columns qualify (per carton and total), the total is the larger one
          if (!best || (f !== 'Item Qty (pcs)' && v > best[0])) best = [v, ref];
        }
        if (best) { r[f] = best[0]; r._src[f] = best[1]; r._ai[f] = 'auto'; }
      }
      // numbers in an unlabeled column right of the last weight column: gross weight printed without its heading
      const gw = t.roles['Gross weight (kg)'] || [];
      if (gw.length) for (const [c, ci] of row.map((c, ci) => [c, ci]).filter(([c]) => c.x0 > t.cols[Math.max(...gw)].x1 && (colOf(t, c) === -1 || colOf(t, c) > lastCol))) {
        if (!isNum(c.t)) continue; const n = pickNum(c.t);
        const v = r['Total Packages'] ? n.find(x => x / r['Total Packages'] >= 0.05 && x / r['Total Packages'] <= 80) : n[0];
        if (v !== undefined && (empty(r['Gross weight (kg)']) || (v > r['Gross weight (kg)'] && v < r['Gross weight (kg)'] * 3))) { r['Gross weight (kg)'] = v; r._src['Gross weight (kg)'] = [pg.id, ri, ci]; r._ai['Gross weight (kg)'] = 'auto'; }
      }
      if (t.roles.Colour) for (const k of t.roles.Colour) for (const [c, ci] of byCol[k] || []) {
        if (!r.Colour && !isNum(c.t) && tidy(c.t).length >= 2) { r.Colour = U(tidy(c.t)).slice(0, 40); r._src.Colour = [pg.id, ri, ci]; r._ai.Colour = 'auto'; }
      }
      if (r._src['Item Qty (pcs)']) {   // unit printed with the quantity: "500 SET", "1200 PCS"
        const qc = pg.rows[ri][r._src['Item Qty (pcs)'][2]]; const um = qc && U(qc.t).match(/\b(PCS|PC|PIECES|SETS?|PAC|PACKS?|PRS|PAIRS?|DOZ)\b/);
        if (um) { const u = um[1]; r['Qty Type'] = /^PC|PIECE/.test(u) ? 'PCS' : /^SET/.test(u) ? 'SET' : /^PAC/.test(u) ? 'PAC' : /^P(RS|AIR)/.test(u) ? 'PRS' : 'DOZ'; r._ai['Qty Type'] = 'auto'; }
      }
      if (t.roles['PO Number']) for (const k of t.roles['PO Number']) for (const [c, ci] of byCol[k] || []) {
        const v = tidy(c.t).split(' ')[0]; if (!r['PO Number'] && /\d/.test(v) && v.length >= 4 && U(v) !== style) { r['PO Number'] = U(v); r._src['PO Number'] = [pg.id, ri, ci]; r._ai['PO Number'] = 'auto'; }
      }
      if (!r['PO Number']) { const po = poNear(pg, ri, new Set([t.hr, t.last])); if (po && P.norm(po) !== P.norm(style)) { r['PO Number'] = po; r._ai['PO Number'] = 'auto'; } }
      if (['Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)'].filter(f => !empty(r[f])).length < 1) continue;
      out.push(r);
    }
    return out;
  }
  function fixPlausible(r) {           // "339,000" for 100 cartons is 339.000 kg, not 339 000 kg
    const ctn = r['Total Packages'] || 0;
    for (const [f, lim] of [['Gross weight (kg)', 80], ['Total CBM', 0.6], ['Item Qty (pcs)', 5000]]) {
      const v = r[f]; if (v && ctn && v / ctn > lim) for (const alt of r['_alt_' + f] || []) if (alt / ctn <= lim) { r[f] = alt; break; }
    }
    for (const k of Object.keys(r)) if (k.startsWith('_alt_')) delete r[k];
    return r;
  }
  function itemsGuess(docs) {
    let tables = [];
    for (const d of docs) for (const pg of d.pages) tables.push(...tablesOn(pg));
    if (!tables.length) return [];
    // use the most complete kind of table (packing list over the invoice, usually)
    const withRows = tables.map(t => ({t, rows: rowsOf(t)})).filter(x => x.rows.length);
    if (!withRows.length) return [];
    const top = Math.max(...withRows.map(x => x.t.score));
    const chosen = withRows.filter(x => x.t.score >= top - 1.01);
    const NUMF = ['Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)'];
    for (const x of withRows) {           // one style + PO on several lines of the same table: add them up
      const m = new Map(), keep = [];
      for (const r of x.rows) {
        const k = P.canon(r.Style) + '|' + P.norm(r['PO Number']);
        const o = m.get(k);
        if (!o) { m.set(k, r); keep.push(r); continue; }
        for (const f of NUMF) if (typeof r[f] === 'number') o[f] = typeof o[f] === 'number' ? Math.round((o[f] + r[f]) * 100000) / 100000 : r[f];
      }
      x.rows = keep;
    }
    const out = [], seen = new Map();
    for (const {rows} of chosen) for (const r0 of rows) {
      const r = r0;
      const key = P.norm(r.Style) + '|' + P.norm(r['PO Number']);
      const n = F.ITEM_FIELDS.filter(f => !empty(r[f])).length;
      if (seen.has(key)) { const [pn, idx] = seen.get(key); if (n > pn) { out[idx] = r; seen.set(key, [n, idx]); } continue; }
      seen.set(key, [n, out.length]); out.push(r);
    }
    // fill missing values from a lower-scored table (e.g. quantity from the invoice) – only when the style matches
    for (const {rows} of withRows.filter(x => !chosen.includes(x))) for (const r of rows) {
      const tgt = out.find(o => P.norm(o.Style) === P.norm(r.Style)); if (!tgt) continue;
      for (const f of F.ITEM_FIELDS) if (empty(tgt[f]) && !empty(r[f])) { tgt[f] = r[f]; tgt._src[f] = r._src[f]; tgt._ai[f] = 'auto'; }
    }
    return out;
  }

  function guess(docs) {
    const {header, src} = headerGuess(docs);
    const items = itemsGuess(docs);
    if (!header['PO Number']) { const po = items.map(i => i['PO Number']).find(Boolean); if (po) header['PO Number'] = po; }
    if (header['PO Number']) for (const it of items) if (!it['PO Number']) { it['PO Number'] = header['PO Number']; it._ai['PO Number'] = 'auto'; }
    if (header['Vendor Name']) {         // shipper name: drop "PRIVATE LIMITED," punctuation, keep words
      header['Vendor Name'] = header['Vendor Name'].replace(/[.,;:]+$/, '').trim();
    }
    return {header, src, items};
  }
  root.CSD.A = {guess, headerGuess, itemsGuess, poNear, pageType, docsFor, overrideItems, TYPE_NAMES, _tablesOn: tablesOn, _rowsOf: rowsOf};
})(typeof self !== 'undefined' ? self : globalThis);
