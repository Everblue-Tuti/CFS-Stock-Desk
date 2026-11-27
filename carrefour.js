/* v17 – Carrefour packing-list reader (no training needed).
   All Carrefour suppliers fill the same buyer template:
     Order Number | Item Reference | Description | Total Quantity | Ctn Dimensions L x W x H | No. of Ctns | Unit Volume | Net | Gross
   followed by the colour block   Carton Numbers | Nb of CTNS | Colour(s) | sizes … | Quantity
   and a "Total Packing List" footer. Suppliers differ only in details, which are settled by arithmetic:
     · weights per carton or per line  → whichever adds up to the printed totals (footer, total row, side marks)
     · unit volume per carton or per line → compared with L x W x H
     · one style over several rows (different carton sizes) → added up;  one style in several colours → one line per colour
   Result: one stock line per PO + style + colour, with a check against the printed totals.
   Pages come from reader.js: page.rows = [[{t, x0, x1}]] (PDF points, or Excel column numbers). */
(function (root) {
  'use strict';
  root.CSD = root.CSD || {};
  const U = s => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  const PO_RE = /^\d{2,3}[A-Z]{2,4}\d{2}[A-Z]{4}\d{4}$/;
  const STYLE_RE = /^[I1l|][0-9]{6}$/;
  const ROLE_RE = {
    QTY: /QUANTI|QTY|^TOTAL$/, DIM: /DIMEN|L\s*X|LXW|^W\s*X|^H\s*\(|H\s*\(?CMS|HI?CMS/, CTNS: /CTNS|CRTNS|CRINS|CARTONS|NB\s*OF|NO\.?\s*OF/,
    UVOL: /VOLUME|^UNIT$/, NET: /^NET|NET\s*W/, GROSS: /GROSS|GROSE|GRO\s*SS/
  };
  const ORDER = ['QTY', 'L', 'W', 'H', 'CTNS', 'UVOL', 'NET', 'GROSS'];
  const near = (a, b, tol) => Math.abs(a - b) <= Math.max(tol || 0.05, Math.abs(b) * 0.002);
  const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;

  function num(tok) {
    let s = String(tok).trim().replace(/[=:]+$/, '').replace(/^[(:]+/, '');
    if (/[A-Za-z%]/.test(s) || !/\d/.test(s)) return null;
    s = s.replace(/\.$/, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else if (/^\d+,\d{3}$/.test(s)) s = s.replace(',', '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  /* the words of a cell with an x position each (PDF: spread over the cell width; Excel: the column) */
  function tokens(pg, ri) {
    const out = [], excel = pg.kind === 'excel';
    pg.rows[ri].forEach((c, ci) => {
      const t = String(c.t || ''), parts = t.split(/\s+/).filter(Boolean); let off = 0;
      for (const p of parts) {
        const at = t.indexOf(p, off); off = at + p.length;
        const x = excel ? c.x0 : c.x0 + ((c.x1 || c.x0) - c.x0) * ((at + p.length / 2) / Math.max(1, t.length));
        let n = num(p), fixed = false;
        /* v17.1: a scan letter inside a number (O/o→0, I/l/|→1, S→5, B→8) – kept only if the totals then add up */
        if (n === null && /\d/.test(p) && /^[0-9OoIl|SB.,]+$/.test(p) && /[OoIl|SB]/.test(p) && p.length >= 2) {
          const q = num(p.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8'));
          if (q !== null) { n = q; fixed = true; }
        }
        out.push({t: p, x, ci, n, fixed});
      }
    });
    return out;
  }
  const rowText = (pg, ri) => U((pg.rows[ri] || []).map(c => c.t).join(' | '));
  const cellX = (pg, c) => pg.kind === 'excel' ? c.x0 : (c.x0 + (c.x1 || c.x0)) / 2;

  /* ---------- the main table of a packing-list page ---------- */
  function tablesOn(pg) {
    const out = [];
    for (let a = 0; a < pg.rows.length; a++) {
      const t = rowText(pg, a);
      if (!/ORDER\s*N/.test(t) || !/ITEM|REF/.test(t)) continue;
      const isData = r => tokens(pg, r).some(k => (k.n !== null && k.n > 9) || PO_RE.test(U(k.t)) || STYLE_RE.test(U(k.t)));
      const hdrRows = [];
      if (a > 0 && !isData(a - 1) && pg.rows[a - 1].length <= 4) hdrRows.push(a - 1);
      hdrRows.push(a);
      for (let r = a + 1; r < Math.min(pg.rows.length, a + 4) && !isData(r); r++) hdrRows.push(r);
      const hdrTxt = hdrRows.map(r => rowText(pg, r)).join(' | ');
      if (!/VOLUME/.test(hdrTxt) || !ROLE_RE.CTNS.test(hdrTxt)) continue;          // the invoice table has no cartons / volume
      const centre = {}, itemX = [];
      for (const r of hdrRows) for (const c of pg.rows[r]) {
        const u = U(c.t);
        for (const [role, re] of Object.entries(ROLE_RE)) if (re.test(u)) (centre[role] = centre[role] || []).push(cellX(pg, c));
        if (/^ITEM|REFERENCE/.test(u)) itemX.push(cellX(pg, c));
      }
      for (const k of Object.keys(centre)) centre[k] = centre[k].reduce((s, v) => s + v, 0) / centre[k].length;
      if (!centre.QTY && !centre.CTNS) continue;
      let end = pg.rows.length;
      for (let r = a + 1; r < pg.rows.length; r++) {
        const u = rowText(pg, r);
        if ((/CARTON/.test(u) && /COLOU?R/.test(u)) || /SIZE\s*ASSORT|SIDE\s*MARK|SHIPPING\s*MARK|STATEMENT|DECLARATION/.test(u) || (/ORDER\s*N/.test(u) && /ITEM|REF/.test(u))) { end = r; break; }
      }
      out.push({pg, a, hdrRows, centre, itemX: itemX.length ? itemX.reduce((s, v) => s + v, 0) / itemX.length : null, end: Math.min(end, a + 60)});
    }
    return out;
  }
  /* numbers of a row → roles: in print order when the row is complete, otherwise by the nearest heading */
  function rolesOfRow(tb, toks) {
    const nums = toks.filter(k => k.n !== null);
    const res = {};
    if (nums.length >= 8 || (nums.length === 7 && !tb.centre.UVOL)) {
      const order = nums.length === 7 ? ['QTY', 'L', 'W', 'H', 'CTNS', 'NET', 'GROSS'] : ORDER;
      order.forEach((r, i) => { res[r] = nums[i]; });
      return res;
    }
    const cs = Object.entries(tb.centre);
    let dims = 0, prev = null, prevRole = null;
    for (const k of [...nums].sort((a, b) => a.x - b.x)) {
      let role = null;
      // several numbers in one cell ("38.00 38.00 18.00 25"): they follow the print order
      if (prev && prev.ci === k.ci && prevRole) { const i = ORDER.indexOf(prevRole); role = ORDER[i + 1] || null; if (['L', 'W', 'H'].includes(role)) dims++; }
      if (!role) {
        let best = null, bd = 1e9;
        for (const [r, x] of cs) { const d = Math.abs(x - k.x); if (d < bd) { bd = d; best = r; } }
        if (tb.pg.kind !== 'excel' && bd > 90) { prev = k; prevRole = null; continue; }
        role = best === 'DIM' ? (dims < 3 ? ['L', 'W', 'H'][dims++] : null) : best;
      }
      if (role && !res[role]) res[role] = k;
      prev = k; prevRole = role;
    }
    return res;
  }
  function recordsOf(tb) {
    const {pg} = tb, recs = [], styles = [], pos = [], under = [], totals = [];
    let cur = null, started = false;
    const qtyX = tb.centre.QTY || tb.centre.CTNS;
    for (let r = tb.a + 1; r < tb.end; r++) {
      if (tb.hdrRows.includes(r) && !started) continue;
      const toks = tokens(pg, r);
      const left = toks.filter(k => pg.kind === 'excel' ? k.x < qtyX : k.x < qtyX - 25);
      const right = toks.filter(k => !left.includes(k));
      tb.desc = (tb.desc || '') + ' ' + left.map(k => k.t).join(' ');
      for (const k of left) {
        const u = U(k.t);
        if (PO_RE.test(u)) pos.push({r, v: u, ci: k.ci});
        else if (STYLE_RE.test(u)) styles.push({r, v: 'I' + u.slice(1), ci: k.ci});
      }
      // colour printed under the item reference (QK, Quantum): words in the item column that are not codes
      if (tb.itemX !== null) {
        const words = pg.rows[r].filter(c => { const x = cellX(pg, c), u = U(c.t); return Math.abs(x - tb.itemX) < (pg.kind === 'excel' ? 1 : 60) && /[A-Z]{2}/.test(u) && !STYLE_RE.test(u) && !PO_RE.test(u) && !/ORDER|GLOBAL|REFERENCE|^ITEM/.test(u); });
        if (words.length) under.push({r, v: U(words[0].t)});
      }
      const nums = right.filter(k => k.n !== null);
      if (!nums.length) continue;
      started = true;
      const roles = rolesOfRow(tb, right);
      const val = k => (k ? k.n : undefined);
      const row = {r, QTY: val(roles.QTY), L: val(roles.L), W: val(roles.W), H: val(roles.H), CTNS: val(roles.CTNS), UVOL: val(roles.UVOL), NET: val(roles.NET), GROSS: val(roles.GROSS),
        src: Object.fromEntries(Object.entries(roles).map(([k, t]) => [k, [pg.id, r, t.ci]])), allNums: nums.map(k => k.n),
        fixed: Object.values(roles).filter(t => t.fixed).map(t => `${t.t} → ${t.n}`)};
      /* OCR "339,000" on a scan = 339.000 kg, not 339 000 kg */
      for (const f of ['NET', 'GROSS']) if (roles[f] && /^\d{1,3},\d{3}$/.test(roles[f].t) && row[f] / (row.CTNS || 1) > 100) row[f] = row[f] / 1000;
      // a total row: no carton size, and quantity / cartons equal to what is above it
      const sumQ = recs.reduce((s, x) => s + (x.QTY || 0), 0), sumC = recs.reduce((s, x) => s + (x.CTNS || 0), 0);
      const noDims = row.L === undefined && row.W === undefined && row.H === undefined;
      if (recs.length && noDims && ((row.QTY !== undefined && near(row.QTY, sumQ, 0.5)) || (row.CTNS !== undefined && near(row.CTNS, sumC, 0.5)) || nums.some(k => near(k.n, sumQ, 0.5)))) { totals.push(row); cur = null; continue; }
      const complete = row.QTY !== undefined && row.CTNS !== undefined && (row.GROSS !== undefined || row.NET !== undefined || row.UVOL !== undefined);
      const conflicts = cur && Object.keys(row).some(k => ORDER.includes(k) && row[k] !== undefined && cur[k] !== undefined && !near(row[k], cur[k], 0.001));
      const fragment = cur && cur.QTY === undefined && cur.CTNS === undefined;      // e.g. only the gross weight printed one line higher
      if (!cur || (complete && !fragment) || conflicts) { cur = row; recs.push(cur); }
      else { for (const k of ORDER) if (cur[k] === undefined && row[k] !== undefined) { cur[k] = row[k]; cur.src[k] = row.src[k]; } cur.allNums.push(...row.allNums); }
    }
    // style / PO of each record: the last one above it in this table, or else the first one below
    const pickFor = (list, r) => { const above = list.filter(x => x.r <= r); return above.length ? above[above.length - 1] : list.find(x => x.r > r) || null; };
    for (const x of recs) {
      const s = pickFor(styles, x.r), p = pickFor(pos, x.r), u = pickFor(under, x.r);
      x.style = s && s.v; x.styleSrc = s && [pg.id, s.r, s.ci]; x.po = p && p.v; x.poSrc = p && [pg.id, p.r, p.ci];
      x.under = u && u.v;
    }
    return {recs: recs.filter(x => x.QTY !== undefined || x.CTNS !== undefined), totals};
  }
  /* ---------- the colour block ---------- */
  function coloursOn(pg, from) {
    const out = []; let total = null;
    let b = -1;
    for (let r = from; r < pg.rows.length; r++) { const u = rowText(pg, r); if (/CARTON/.test(u) && /COLOU?R/.test(u)) { b = r; break; } if (r > from && /ORDER\s*N/.test(u) && /ITEM|REF/.test(u)) break; }
    if (b < 0) return {rows: out, total, b};
    for (let r = b + 1; r < Math.min(pg.rows.length, b + 45); r++) {
      const u = rowText(pg, r);
      if (/SIDE\s*MARK|SHIPPING\s*MARK|STATEMENT|DIMENSION|ORDER\s*N/.test(u)) break;
      const toks = tokens(pg, r);
      if (/^TOTAL/.test(U(pg.rows[r][0] && pg.rows[r][0].t)) || (/TOTAL/.test(u) && toks.some(k => k.n !== null) && !toks.some(k => /[A-Z]{3}/.test(U(k.t)) && !/TOTAL|PCS|SETS?|PKS/.test(U(k.t))))) {
        const ns = toks.filter(k => k.n !== null); if (ns.length) total = {ctns: ns[0].n, qty: ns[ns.length - 1].n}; break;
      }
      // colour = the first words after the carton numbers
      let ci = -1;
      for (let i = 0; i < toks.length; i++) {
        const k = U(toks[i].t);
        if (toks[i].n === null && /[A-Z]{2}/.test(k) && !/^(TO|PCS|SETS?|PKS|X|TOTAL|CTNS?)$/.test(k) && toks.slice(0, i).some(q => q.n !== null)) { ci = i; break; }
      }
      if (ci < 0) continue;
      const before = toks.slice(0, ci).filter(k => k.n !== null);
      let j = ci; const words = [];
      while (j < toks.length && (toks[j].n === null || words.length === 0) && !/^\d+\s*X$/i.test(toks[j].t)) {
        if (toks[j].n === null) words.push(toks[j].t); j++;
        if (j < toks.length && toks[j].ci !== toks[j - 1].ci && toks[j].n !== null) break;
      }
      // a colour cell may end in a number that belongs to it ("BLACK 1") – keep it when it is in the same cell
      const cell = pg.rows[r][toks[ci].ci].t; let colour = U(cell).replace(/\s+\d{3,}$/, '');
      if (!/[A-Z]{2}/.test(colour)) colour = U(words.join(' '));
      if (toks.filter(k => k.ci === toks[ci].ci).length !== toks.filter(k => k.ci === toks[ci].ci && k.n === null).length && /\(\w+\)\s*\d{3,}$/.test(U(cell))) colour = U(cell).replace(/\s*\d{3,}$/, '');
      const after = toks.filter(k => k.n !== null && k.x > toks[ci].x);
      const ctns = before.length ? before[before.length - 1].n : null;
      const qty = after.length ? after[after.length - 1].n : null;
      if (ctns === null) continue;
      out.push({r, colour: colour.replace(/\s+/g, ' ').trim(), ctns, qty, nums: after.map(k => k.n), src: [pg.id, r, toks[ci].ci]});
    }
    return {rows: out, total, b};
  }
  /* ---------- numbers printed anywhere (footers, totals, invoice) – for the arithmetic checks ---------- */
  function printedNumbers(docs, skip) {
    const out = [];
    for (const d of docs) for (const pg of d.pages) pg.rows.forEach((row, ri) => {
      if (skip.has(pg.id + '#' + ri)) return;
      for (const k of tokens(pg, ri)) if (k.n !== null && k.n > 0) out.push(k.n);
    });
    return out;
  }
  /* total volume printed by the supplier (footer "Total volume", "CBM : 10.750", total row) */
  function printedCbm(docs, totalsRows) {
    const out = totalsRows.map(t => t.UVOL).filter(v => typeof v === 'number');
    for (const d of docs) for (const pg of d.pages) pg.rows.forEach((row, ri) => {
      const u = rowText(pg, ri);
      if (/CBM|VOLUME/.test(u)) for (const k of tokens(pg, ri)) if (k.n !== null) out.push(k.n);
      if (/TOTAL/.test(u) && /VOLUME/.test(u) && pg.rows[ri + 1]) for (const k of tokens(pg, ri + 1)) if (k.n !== null) out.push(k.n);
    });
    return out;
  }
  function sideMarks(pg) {        // NET WT : 2.000 / GROSS WEIGHT: 1.400 KGS  → per-carton weights printed on the marks
    const res = {NET: [], GROSS: []};
    pg.rows.forEach((row, ri) => {
      const txt = U(row.map(c => c.t).join(' '));
      for (const [role, re] of [['NET', /NE[TI]\s*(WT|WEIGHT|WGT)\.?\s*:?\s*([\d.,]+)/g], ['GROSS', /GROSS?\s*(WT|WEIGHT|WGT)\.?\s*:?\s*([\d.,]+)/g]]) {
        let m; while ((m = re.exec(txt))) { const n = num(m[2]); if (n !== null) res[role].push(n); }
      }
    });
    return res;
  }

  /* ---------- the invoice: quantity per style (to compare) ---------- */
  function invoiceItems(docs) {
    const out = [];
    for (const d of docs) for (const pg of d.pages) for (let a = 0; a < pg.rows.length; a++) {
      const t = rowText(pg, a);
      if (!/ORDER\s*N/.test(t) || !/ITEM|REF/.test(t) || !/PRICE|AMOUNT|H\.?\s*S/.test(t + ' ' + rowText(pg, a + 1)) || /VOLUME/.test(t + rowText(pg, a + 1))) continue;
      let qx = null; for (const r of [a, a + 1]) for (const c of (pg.rows[r] || [])) if (/QUANTITY|QTY/.test(U(c.t))) qx = cellX(pg, c);
      if (qx === null) continue;
      let po = null;
      for (let r = a + 1; r < Math.min(pg.rows.length, a + 40); r++) {
        const u = rowText(pg, r); if (/TOTAL/.test(u) && !/[I1][0-9]{6}/.test(u)) break;
        const toks = tokens(pg, r);
        const p = toks.find(k => PO_RE.test(U(k.t))); if (p) po = U(p.t);
        const s = toks.find(k => STYLE_RE.test(U(k.t)));
        if (!s) continue;
        let best = null, bd = 1e9; for (const k of toks) if (k.n !== null) { const dd = Math.abs(k.x - qx); if (dd < bd) { bd = dd; best = k; } }
        if (best && (pg.kind === 'excel' ? bd <= 1 : bd < 60)) out.push({po, style: 'I' + U(s.t).slice(1), qty: best.n, src: [pg.id, r, best.ci]});
      }
    }
    return out;
  }

  /* ---------- the reader ---------- */
  function read(docs) {
    const pieces = [], warn = [], used = new Set(), allRecs = [], totalsRows = [], colourTotals = [], fixedAll = [];
    let descAll = '';
    let pages = 0;
    for (const d of docs) for (const pg of d.pages) {
      const tbs = tablesOn(pg); if (!tbs.length) continue;
      pages++;
      for (const tb of tbs) {
        const {recs, totals} = recordsOf(tb);
        descAll += ' ' + (tb.desc || '');
        for (const x of recs) fixedAll.push(...(x.fixed || []));
        if (!recs.length) continue;
        for (const x of recs) { used.add(pg.id + '#' + x.r); x.pg = pg; }
        totalsRows.push(...totals);
        const col = coloursOn(pg, tb.end - 1);
        if (col.total) colourTotals.push(col.total);
        allRecs.push(...recs.map(x => Object.assign(x, {colours: col.rows, side: sideMarks(pg)})));
      }
    }
    if (!allRecs.length) return null;
    /* weights: per carton or per line – settled for the whole packing list by the printed totals */
    const numbers = printedNumbers(docs, used);
    const has = v => numbers.some(n => near(n, v, 0.06));
    const mode = {};
    for (const f of ['NET', 'GROSS']) {
      const xs = allRecs.filter(x => x[f] !== undefined); if (!xs.length) continue;
      const per = xs.reduce((s, x) => s + x[f] * (x.CTNS || 1), 0), tot = xs.reduce((s, x) => s + x[f], 0);
      const hp = has(per), ht = has(tot);
      if (hp && !ht) mode[f] = 'carton'; else if (ht && !hp) mode[f] = 'line';
    }
    for (const x of allRecs) for (const f of ['NET', 'GROSS']) {
      if (x[f] === undefined) continue;
      let m = mode[f];
      if (!m) {
        const ctn = x.CTNS || 1;
        if (x.allNums.some(n => near(n, x[f] * ctn, 0.06)) && ctn > 1) m = 'carton';
        else if (x.side[f].some(n => near(n, x[f], 0.006))) m = 'carton';
        else if (x.side[f].some(n => near(n, x[f] / ctn, 0.006))) m = 'line';
        else m = x[f] <= 30 && ctn >= 3 ? 'carton' : 'line';
      }
      x[f + '_T'] = m === 'carton' ? x[f] * (x.CTNS || 1) : x[f];
    }
    /* CBM: unit volume per carton or per line – compared with the carton size */
    for (const x of allRecs) {
      const ctn = x.CTNS || 1;
      let pc = null;
      if ([x.L, x.W, x.H].every(v => typeof v === 'number' && v > 0)) pc = [x.L, x.W, x.H].every(v => v < 5) ? x.L * x.W * x.H : x.L * x.W * x.H / 1e6;
      if (typeof x.UVOL === 'number') x.CBM = pc === null ? (x.UVOL < 0.5 && ctn > 2 ? x.UVOL * ctn : x.UVOL) : (Math.abs(x.UVOL - pc) <= Math.abs(x.UVOL - pc * ctn) ? x.UVOL * ctn : x.UVOL);
      else if (pc !== null) x.CBM = pc * ctn;
    }
    /* colours: share the cartons of the table rows out to the colour rows of the same page, in order */
    const byPage = new Map(); for (const x of allRecs) { if (!byPage.has(x.pg.id)) byPage.set(x.pg.id, []); byPage.get(x.pg.id).push(x); }
    for (const recs of byPage.values()) {
      const cols = recs[0].colours.map(c => Object.assign({}, c, {left: c.ctns}));
      const sumR = recs.reduce((s, x) => s + (x.CTNS || 0), 0), sumC = cols.reduce((s, c) => s + c.ctns, 0);
      if (cols.length && near(sumR, sumC, 0.5)) {
        let j = 0;
        for (const x of recs) {
          let left = x.CTNS || 0;
          while (left > 0.0001 && j < cols.length) {
            const m = Math.min(left, cols[j].left), whole = near(m, cols[j].ctns, 0.001) && near(m, x.CTNS, 0.001);
            const share = m / (x.CTNS || 1), c = cols[j];
            /* quantity: the table row's own when the piece is the whole row; when one row is split into colours, the
               colour row's number closest to its share (the last column is not always the quantity) */
            let qty = x.QTY * share;
            if (!near(share, 1, 0.0001) && near(m, c.ctns, 0.001) && (c.nums || []).length) qty = c.nums.reduce((b, n) => Math.abs(n - x.QTY * share) < Math.abs(b - x.QTY * share) ? n : b, c.nums[0]);
            pieces.push({x, colour: c.colour, colourSrc: c.src, ctns: m, qty, share});
            left -= m; c.left -= m; if (c.left <= 0.0001) j++;
          }
        }
      } else {
        if (cols.length) warn.push(`Colour block: ${sumC} cartons, table: ${sumR} cartons – colours taken in order, please check.`);
        recs.forEach((x, i) => { const c = cols.length === recs.length ? cols[i] : cols.length === 1 ? cols[0] : null;
          pieces.push({x, colour: c ? c.colour : (x.under || ''), colourSrc: c ? c.src : null, ctns: x.CTNS, qty: x.QTY, share: 1}); });
      }
    }
    /* one stock line per PO + style + colour */
    const lines = new Map();
    for (const p of pieces) {
      const x = p.x, key = [x.po || '', x.style || '', p.colour].join('|');
      if (!lines.has(key)) lines.set(key, {'PO Number': x.po || '', Style: x.style || '', Colour: p.colour, 'Total Packages': 0, 'Item Qty (pcs)': 0, 'Total CBM': 0, 'Gross weight (kg)': 0, 'Net weight (kg)': 0,
        _src: {'PO Number': x.poSrc, Style: x.styleSrc, Colour: p.colourSrc, 'Total Packages': x.src.CTNS, 'Item Qty (pcs)': x.src.QTY, 'Total CBM': x.src.UVOL, 'Gross weight (kg)': x.src.GROSS, 'Net weight (kg)': x.src.NET}, _n: {}});
      const L = lines.get(key);
      const add = (f, v) => { if (typeof v === 'number' && !isNaN(v)) { L[f] += v; L._n[f] = true; } };
      add('Total Packages', p.ctns); add('Item Qty (pcs)', p.qty); add('Total CBM', x.CBM !== undefined ? x.CBM * p.share : undefined);
      add('Gross weight (kg)', x.GROSS_T !== undefined ? x.GROSS_T * p.share : undefined); add('Net weight (kg)', x.NET_T !== undefined ? x.NET_T * p.share : undefined);
    }
    const out = [...lines.values()].map(L => {
      for (const f of ['Total Packages', 'Item Qty (pcs)', 'Total CBM', 'Gross weight (kg)', 'Net weight (kg)']) {
        if (!L._n[f]) { L[f] = null; delete L._src[f]; continue; }
        L[f] = f === 'Total CBM' ? r3(L[f]) : f === 'Total Packages' || f === 'Item Qty (pcs)' ? Math.round(L[f] * 100) / 100 : r2(L[f]);
      }
      for (const k of Object.keys(L._src)) if (!L._src[k]) delete L._src[k];
      delete L._n; return L;
    });
    /* the supplier's printed total volume wins when it is within 3 % (rounding of the unit volume) */
    { const c = out.reduce((s, L) => s + (L['Total CBM'] || 0), 0), cands = printedCbm(docs, totalsRows).filter(v => v > 0 && Math.abs(v - c) / c <= 0.03);
      if (c > 0 && cands.length && !cands.some(v => near(v, c, 0.0015))) {
        const v = cands.sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0], f = v / c;
        out.forEach(L => { if (L['Total CBM']) L['Total CBM'] = r3(L['Total CBM'] * f); });
        const d = r3(v - out.reduce((s, L) => s + (L['Total CBM'] || 0), 0)); if (d && out.length) { const L = out.find(x => x['Total CBM']); L['Total CBM'] = r3(L['Total CBM'] + d); }
      } }
    /* checks against what the documents print */
    const sum = f => r2(out.reduce((s, L) => s + (L[f] || 0), 0));
    const ctnsSum = sum('Total Packages');
    const printedCtns = colourTotals.length ? colourTotals.reduce((s, t) => s + t.ctns, 0) : null;
    if (printedCtns !== null && !near(printedCtns, ctnsSum, 0.5)) warn.push(`Cartons: lines add up to ${ctnsSum}, the packing list prints ${printedCtns}.`);
    const g = sum('Gross weight (kg)');
    if (g && !mode.GROSS && !has(g)) warn.push(`Gross weight: lines add up to ${g} kg – this total is not printed on the documents, please check.`);
    if (out.some(L => !L.Style)) warn.push('A line without an item reference (style) – please check.');
    /* v17.1: nett weight and CBM against the printed totals too */
    const nt = sum('Net weight (kg)');
    if (nt && !mode.NET && !has(nt)) warn.push(`Nett weight: lines add up to ${nt} kg – this total is not printed on the documents, please check.`);
    { const c = r3(out.reduce((s2, L) => s2 + (L['Total CBM'] || 0), 0)), pr = printedCbm(docs, totalsRows).filter(v => v > 0 && v < 400);
      if (c && pr.length && !pr.some(v => near(v, c, 0.0015)) && !pr.some(v => Math.abs(v - c) / c <= 0.03)) warn.push(`CBM: lines add up to ${c} – the packing list prints ${pr.sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0]}, please check.`); }
    for (const L of out) if (L['Net weight (kg)'] && L['Gross weight (kg)'] && L['Net weight (kg)'] >= L['Gross weight (kg)']) warn.push(`${L.Style} ${L.Colour}: net weight is not less than gross weight.`);
    /* the invoice: every item of the invoice must be in the packing list(s), with the same quantity */
    const inv = invoiceItems(docs), missing = [];
    const byStyle = {}; for (const L of out) byStyle[L.Style] = (byStyle[L.Style] || 0) + (L['Item Qty (pcs)'] || 0);
    const invByStyle = {}; for (const i of inv) { invByStyle[i.style] = (invByStyle[i.style] || 0) + i.qty; }
    for (const [s, q] of Object.entries(invByStyle)) {
      if (byStyle[s] === undefined) { missing.push(s); const i = inv.find(x => x.style === s); out.push({'PO Number': i.po || '', Style: s, Colour: '', 'Item Qty (pcs)': q, 'Total Packages': null, 'Total CBM': null, 'Gross weight (kg)': null, 'Net weight (kg)': null, _src: {Style: i.src, 'Item Qty (pcs)': i.src}, _missingPL: true}); }
      else if (!near(byStyle[s], q, 0.5)) warn.push(`${s}: invoice quantity ${q}, packing list ${byStyle[s]}.`);
    }
    if (missing.length) warn.push(`The invoice has ${missing.length} item(s) without a packing list here: ${missing.join(', ')}. Add their packing list(s), or fill cartons / CBM / weight by hand.`);
    /* v17.1: split packing lists "(2 OF 4)" – name the missing ones */
    const xy = xOfY(docs);
    if (xy && xy.missing.length) warn.push(`Packing list ${xy.missing.join(', ')} of ${xy.of} missing – add ${xy.missing.length === 1 ? 'it' : 'them'} and read again.`);
    if (fixedAll.length && warn.length) warn.push(`Scan letters read as numbers: ${[...new Set(fixedAll)].slice(0, 5).join(', ')} – please check against the paper.`);
    return {lines: out, ok: !warn.length, warn, pages, mode, commodity: commodity(descAll + ' ' + invoiceDesc(docs)), xofy: xy, totals: {ctns: ctnsSum, gross: g, net: sum('Net weight (kg)'), cbm: r3(out.reduce((s, L) => s + (L['Total CBM'] || 0), 0))}};
  }
  /* ---------- v17.1: commodity from the product text (rule A) ---------- */
  function commodity(text) {
    const u = U(text);
    if (/\bMADE[\s-]?UPS?\b|TABLE\s?CLOTH|\bTOWELS?\b|BED\s?SHEET|\bPILLOW|\bCUSHION|\bCURTAIN|\bNAPKIN|\bAPRON|\bRUGS?\b|TOILETRY\s+BAG|\b(TOTE|SHOPPING|LAUNDRY|STORAGE)\s+BAGS?\b/.test(u)) return 'MADEUPS';
    if (/\bTOYS?\b|\bPLUSH|\bPUZZLE|\bBOARD\s+GAME|\bDOLLS?\b/.test(u)) return 'TOYS';
    return 'GARMENTS';
  }
  function invoiceDesc(docs) {        // product words of the invoice item table
    let t = '';
    for (const d of docs) for (const pg of d.pages) for (let a = 0; a < pg.rows.length; a++) {
      const h = rowText(pg, a); if (!/ORDER\s*N/.test(h) || !/DESCRIPTION/.test(h)) continue;
      for (let r = a + 1; r < Math.min(pg.rows.length, a + 25); r++) { const u = rowText(pg, r); if (/^TOTAL|STATEMENT|DECLAR|SIDE\s*MARK/.test(u)) break; t += ' ' + u; }
    }
    return t;
  }
  /* ---------- v17.1: "BD0002100170 (4 OF 4)" – which parts of a split packing list are here ---------- */
  function xOfY(docs) {
    const have = new Set(); let of = 0;
    const scan = txt => { for (const m of U(txt).matchAll(/\(?\b(\d{1,2})\s*OF\s*(\d{1,2})\b\)?/g)) { const x = +m[1], y = +m[2]; if (y >= 2 && y <= 30 && x >= 1 && x <= y) { have.add(x); of = Math.max(of, y); } } };
    for (const d of docs) {
      if (/PACK|PK\s*LIST|\bPL\b/i.test(d.name || '')) scan(String(d.name).replace(/[_]+/g, ' '));
      for (const pg of d.pages) if (tablesOn(pg).length) for (let r = 0; r < Math.min(pg.rows.length, 8); r++) { const t = rowText(pg, r); if (/\bOF\b/.test(t) && !/COUNTRY|PORT|PLACE|MODE/.test(t)) scan(t); }
    }
    if (!of) return null;
    const missing = []; for (let i = 1; i <= of; i++) if (!have.has(i)) missing.push(i);
    return {of, have: [...have].sort((a, b) => a - b), missing};
  }
  /* ---------- v17.1: invoice number / date confirmed when the packing list prints the same ---------- */
  function cleanInvoice(v) {
    let s = String(v || '').toUpperCase().replace(/^\s*(INVOICE|INV)\.?\s*(NO|NUMBER|NB)?\.?\s*[:\-]?\s*/, '');
    s = s.split(/\s+(DTD|DT|DATED|DATE)\b|\s*&\s*|\s+\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/)[0];
    return s.replace(/\s*\(\s*\d+\s*OF\s*\d+\s*\)\s*$/, '').trim();
  }
  const flat = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  function confirmInvoice(docs, inv, isoDate) {
    let plText = '';
    for (const d of docs) for (const pg of d.pages) if (tablesOn(pg).length) plText += ' ' + pg.rows.slice(0, 14).map(r => r.map(c => c.t).join(' ')).join(' ');
    const ft = flat(plText), res = {inv: false, date: false};
    if (inv && flat(inv).length >= 4 && ft.includes(flat(inv))) res.inv = true;
    const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) { const [, y, mo, d] = m, MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][+mo - 1], u = U(plText);
      res.date = new RegExp(`\\b0?${+d}\\s*[-/.]\\s*0?${+mo}\\s*[-/.]\\s*(${y}|${y.slice(2)})\\b`).test(u) || new RegExp(`\\b0?${+d}\\s*[-/. ]\\s*${MON}[A-Z]*\\s*[-/. ,]\\s*(${y}|${y.slice(2)})\\b`).test(u); }
    return res;
  }
  /* ---------- header fields printed with fixed labels on the Carrefour documents ---------- */
  function header(docs) {
    const out = {}, src = {};
    const set = (f, v, ref) => { v = String(v || ''); const par = v.match(/^\s*\(\s*([^)]+?)\s*\)/); if (par) v = par[1]; v = v.replace(/^[\s:;(]+|[\s,;:)]+$/g, '').replace(/^\(\s*|\s*\)$/g, '').replace(/\s+/g, ' ').trim().toUpperCase(); v = v.replace(/\b5\.A\./g, 'S.A.');
      if (v && /[A-Z]{2}/.test(v) && !out[f] && !/TERMS|PAYMENT|INCOTERM|PLACE OF|PORT OF|COUNTRY|MODE OF|VESSEL|PRE-?CARRIAGE/.test(v)) { out[f] = v; src[f] = ref; } };
    let cod = null;
    const place = v => String(v || '').split(/\s*\/\s*|\s*,\s*|\s+[-–]\s+/)[0];
    const pages = [];
    for (const d of docs) for (const pg of d.pages) pages.push(pg);
    pages.sort((a, b) => (tablesOn(b).length ? 1 : 0) - (tablesOn(a).length ? 1 : 0));    // packing-list pages first
    for (const pg of pages) pg.rows.forEach((row, ri) => row.forEach((c, ci) => {
      const u = U(c.t);
      const rightOf = () => { const m = u.match(/:\s*(.+)$/); if (m && /[A-Z]{2}/.test(m[1])) return [m[1], ci]; const n = row[ci + 1]; return n ? [n.t, ci + 1] : [null, null]; };
      const below = () => { for (let r = ri + 1; r <= ri + 2 && r < pg.rows.length; r++) { const hit = pg.rows[r].findIndex(x => (pg.kind === 'excel' ? x.x0 === c.x0 : Math.abs(x.x0 - c.x0) < 40) && /[A-Z]{2}/.test(U(x.t))); if (hit >= 0) return [pg.rows[r][hit].t, r, hit]; } return [null]; };
      if (/^PORT\s*OF\s*DISCHARGE/.test(u)) { const [v, k] = rightOf(); if (v) set('Port of Discharge', place(v), [pg.id, ri, k]); }
      else if (/^FINAL\s*DESTINATION/.test(u)) { const [v, k] = rightOf(); if (v && !/\w-\w/.test(place(v))) set('FPD', place(v), [pg.id, ri, k]); }
      else if (/^COUNTRY\s*OF\s*DESTINATION/.test(u)) { const [v, k] = rightOf(); if (v) { cod = [place(v), [pg.id, ri, k]]; } }
      else if (/^BUYER\s*:?$/.test(u)) { const [v, r, k] = below(); if (v) set('Customer Name', v, [pg.id, r, k]); }
      else if (/CONSIGNEE\)?\s*:?$/.test(u)) { const [v, r, k] = below(); if (v) set('Consignee', v, [pg.id, r, k]); }
      else if (/^(SELLER|VENDOR|EXPORTER)\s*:?$/.test(u)) { const [v, r, k] = below(); if (v) set('Vendor Name', v, [pg.id, r, k]); }
    }));
    if (!out.FPD && cod) set('FPD', cod[0], cod[1]);      // "Final Destination: ALOVERA-TEXTIL" (a warehouse) → the country
    return {header: out, src};
  }
  root.CSD.CRF = {read, header, cleanInvoice, confirmInvoice, commodity, xOfY, _num: num, _tablesOn: tablesOn, _recordsOf: recordsOf};
})(typeof self !== 'undefined' ? self : globalThis);
