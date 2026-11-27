/* Shipper format profiles — learn where each field sits in a shipper's documents, then read it again.
   JavaScript version of the desktop program's rules (core/profiles.py); profiles are the same JSON, so
   shipper format files can be exchanged between the browser app and the desktop app.

   header fields: 'anchor' (label next to/above the value), 'regex' (value inside a longer text), 'fixed'
   item rows:     key column (Style) under its heading + each other field located by its printed heading. */
(function (root) {
  const CSD = root.CSD; const F = CSD.F; const {normDate, normTime} = CSD;
  const KEY_FIELD = 'Style';
  const NUM_ITEM = ['Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)'];
  const isNil = v => v === null || v === undefined;
  const empty = v => v === null || v === undefined || v === '';
  const S = v => isNil(v) ? 'None' : String(v);

  /* ---------- text helpers ---------- */
  const norm = s => String(isNil(s) ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const CANON = {O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6'};
  const canon = s => norm(s).replace(/[OQDILSBZG]/g, c => CANON[c]);
  const isDigit = ch => /^[0-9]$/.test(ch);
  const isAlpha = ch => /^\p{L}$/u.test(ch);
  const isSpace = ch => /^\s$/.test(ch);
  function reEscape(s) {   // like Python's re.escape for the characters that matter
    return String(s).replace(/[.*+?^${}()|[\]\\\-#&~ ]/g, '\\$&');
  }
  /* Compile a Python-style pattern ('(?i)' prefix) into a JavaScript RegExp */
  function rx(pattern, extra = '') {
    let flags = extra, p = pattern;
    if (p.startsWith('(?i)')) { p = p.slice(4); flags += 'i'; }
    return new RegExp(p, flags);
  }
  const fullmatch = (p, s) => rx('^(?:' + p + ')$').test(s);
  const strip = (s, chars) => { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); };

  function shape(s) {
    const out = []; let prev = null;
    for (const ch of String(s).trim()) {
      const k = isDigit(ch) ? 'd' : isAlpha(ch) ? 'a' : isSpace(ch) ? 's' : ch;
      if (k === prev && 'das'.includes(k) && k.length === 1) continue;
      out.push(k === 'd' ? '\\d+' : k === 'a' ? '[A-Za-z]+' : k === 's' ? '\\s*' : reEscape(k));
      prev = k;
    }
    return out.join('');
  }
  const D2A = {1: 'I', 0: 'O', 5: 'S', 8: 'B', 2: 'Z', 6: 'G'};
  const A2D = {O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6', '|': '1'};
  function ocrCoerce(value, examples) {
    const v = String(value).trim();
    for (const ex of examples) if (fullmatch(shape(ex), v)) return v;
    for (const ex of examples) {
      if (ex.length !== v.length) continue;
      let out = '';
      for (let i = 0; i < ex.length; i++) {
        const a = ex[i], b = v[i];
        if (isAlpha(a) && isDigit(b)) out += D2A[b] ?? b;
        else if (isDigit(a) && !isDigit(b)) out += A2D[b.toUpperCase()] ?? b;
        else out += b;
      }
      if (fullmatch(shape(ex), out)) return out;
    }
    return null;
  }
  function numCandidates(s) {
    s = String(isNil(s) ? '' : s).replace(/\$/g, '').replace(/₹/g, '');
    const out = [];
    for (const m of s.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
      const t = m[0];
      if (t.includes(',') && !t.includes('.')) {
        out.push(parseFloat(t.replace(/,/g, '')));
        const parts = t.split(',');
        if (parts.length === 2 && parts[1].length === 3) out.push(parseFloat(parts[0] + '.' + parts[1]));
      } else {
        const x = parseFloat(t.replace(/,/g, '')); if (!isNaN(x)) out.push(x);
      }
    }
    return out;
  }
  function isNumberish(s) {
    let t = String(s).replace(/\b(kgs?|cbm|ctns?|cartons?|pcs|nos|sets?|units?)\b/gi, '');
    t = t.replace(/[\s,.$₹:\-/|]/g, '');
    return t.length > 0 && /^[0-9]+$/.test(t);
  }
  function numEqual(a, b, field) {
    if (isNil(a) || isNil(b)) return false;
    const tol = Math.max(Math.abs(b) * 0.002, field === 'Total CBM' ? 0.0006 : 0.006);
    return Math.abs(a - b) <= tol;
  }
  function cleanValue(field, raw, examples, scan) {
    if (isNil(raw)) return null;
    if (F.DATES.has(field)) return normDate(raw) || String(raw).trim();
    if (F.TIMES.has(field)) return normTime(raw) || String(raw).trim();
    if (F.NUMERIC.has(field)) { const c = numCandidates(raw); return c.length ? c[0] : null; }
    let v = strip(String(raw).replace(/\s+/g, ' '), ' :;,|');
    if (F.IDS.has(field)) v = v.replace(/\s+/g, '');
    if (!F.IDS.has(field)) v = strip(v, '()[] ').trim();
    if (scan && examples && examples.length) { const fx = ocrCoerce(v, examples); if (fx) v = fx; }
    for (const ex of examples || []) if (norm(ex) === norm(v) || (scan && canon(ex) === canon(v))) return ex;
    return field !== 'SB LEO TIME' ? v.toUpperCase() : v;
  }

  /* ---------- geometry ---------- */
  const xc = c => (c.x0 + c.x1) / 2;
  const overlap = (a, b, pad = 0) => Math.min(a.x1, b.x1) + pad > Math.max(a.x0, b.x0) - pad;
  const xtol = pg => pg.kind === 'excel' ? 0.6 : 30.0;
  function* iterPages(docs) { for (const d of docs) for (const pg of d.pages) yield pg; }
  const isLabel = t => norm(t).length >= 2 && !isNumberish(t);
  const LABEL_WORDS = new Set(['NO', 'NUMBER', 'DATE', 'NAME', 'TO', 'CONSIGNEE', 'PORT', 'DESTINATION', 'INVOICE', 'REF', 'ORDER',
    'EXPORTER', 'SELLER', 'SHIPPER', 'BUYER', 'IEC', 'DISCHARGE', 'VENDOR', 'MAKER', 'FINAL', 'PO', 'STYLE',
    'TOTAL', 'GROSS', 'CBM', 'VOLUME', 'CARTONS', 'CTNS', 'BILL', 'CODE', 'DELIVERY', 'NOTIFY']);
  const inter = (arr, set) => arr.filter(w => set.has(w));
  function labelScore(t) {
    t = String(t).trim();
    const words = t.toUpperCase().match(/[A-Za-z]+/g) || [];
    const ws = [...new Set(words)];
    let sc = 0;
    if (t.endsWith(':') || t.slice(-3).includes(':')) sc += 3;
    if (inter(ws, LABEL_WORDS).length) sc += 2;
    if (words.length > 5) sc -= 2;
    if (/\d/.test(t)) sc -= 3;
    if (/(\bno|number|#)\.?\s*:?$/i.test(t)) sc += 2;
    const isUpper = /[A-Za-z]/.test(t) && t === t.toUpperCase();
    if (isUpper && words.length >= 3 && !inter(ws, LABEL_WORDS).length) sc -= 2;
    return sc;
  }
  const FIELD_WORDS = {
    'Shipper invoice number': ['INVOICE', 'INV'], 'Vendor Name': ['EXPORTER', 'SELLER', 'SHIPPER', 'VENDOR', 'MANUFACTURER'],
    'Customer Name': ['CONSIGNEE', 'BUYER', 'SEND'], 'Consignee': ['CONSIGNEE', 'SEND'],
    'Port of Discharge': ['DISCHARGE', 'POD'], 'FPD': ['FINAL', 'DESTINATION', 'FPD', 'DISCHARGE'],
    'IEC': ['IEC', 'REX'], 'CIN': ['CIN'], 'Booking Number': ['BOOKING', 'BKG'], 'CHA Name': ['CHA', 'AGENT', 'BROKER', 'CUSTOMS'],
    'Shipping Bill Number': ['SB', 'SHIPPING', 'BILL'], 'Shipping Bill date': ['SB', 'SHIPPING', 'BILL'],
    'SB LEO DATE': ['LEO'], 'SB LEO TIME': ['LEO'], 'PO Number': ['ORDER', 'PO']};
  const FIELD_DOC = {'Shipping Bill Number': 'SHIPPINGBILL', 'Shipping Bill date': 'SHIPPINGBILL', 'SB LEO DATE': 'SHIPPINGBILL',
    'SB LEO TIME': 'SHIPPINGBILL', 'CHA Name': 'SHIPPINGBILL', 'Shipper invoice number': 'INVOICE'};
  function fieldFit(field, label, page) {
    const words = new Set(String(label).toUpperCase().match(/[A-Z]+/g) || []);
    let sc = 2 * (FIELD_WORDS[field] || []).filter(w => words.has(w)).length;
    if ((field === 'Shipping Bill date' || field === 'Shipping Bill Number') && ['INVOICE', 'INV', 'LEO'].some(w => words.has(w))) sc -= 3;
    if (field.startsWith('SB LEO') && !words.has('LEO')) sc -= 1;
    const want = FIELD_DOC[field];
    if (want && pageTitle(page).includes(want)) sc += 2;
    return sc;
  }
  function labelLeft(page, ri, ci) {
    const row = page.rows[ri];
    if (ci - 1 >= 0 && isLabel(row[ci - 1].t)) return row[ci - 1].t;
    return null;
  }
  function labelAbove(page, ri, cell, maxup = 4) {
    for (let k = ri - 1; k > Math.max(-1, ri - 1 - maxup); k--) {
      const cands = page.rows[k].filter(c => overlap(c, cell, page.kind !== 'excel' ? 4 : 0));
      if (cands.length) {
        let c = cands[0]; for (const x of cands) if (Math.abs(xc(x) - xc(cell)) < Math.abs(xc(c) - xc(cell))) c = x;
        if (isLabel(c.t)) return {t: c.t, dy: ri - k, cell: c};
        break;
      }
    }
    return {t: null, dy: null, cell: null};
  }
  /* The column heading above a key cell when other item rows or "PO No: …" lines sit in between
     (e.g. one block of items per purchase order): skip data-looking cells, stop at the first real label. */
  let STYLES_NOW = new Set();
  const dataLike = t => STYLES_NOW.has(norm(t)) || /\d{4,}/.test(t) || isNumberish(t);
  function headingAbove(page, ri, cell, maxup = 60) {
    for (let k = ri - 1; k >= 0 && k >= ri - maxup; k--) {
      const cands = page.rows[k].filter(c => overlap(c, cell, page.kind !== 'excel' ? 4 : 0));
      if (!cands.length) continue;
      let c = cands[0]; for (const x of cands) if (Math.abs(xc(x) - xc(cell)) < Math.abs(xc(c) - xc(cell))) c = x;
      if (dataLike(c.t) || /^(TOTAL|SUB\s*TOTAL)\b/i.test(c.t)) continue;
      if (isLabel(c.t)) return {t: c.t, dy: ri - k, cell: c};
    }
    return {t: null, dy: null, cell: null};
  }
  function cellMatches(page, cellT, value, field) {
    const scan = page.kind === 'scan';
    if (F.DATES.has(field) || F.TIMES.has(field)) {
      if (F.TIMES.has(field) && !/:|\b[AP]\.?\s*M\b|HRS/.test(String(cellT).toUpperCase())) return null;
      const f = F.DATES.has(field) ? normDate : normTime;
      const want = f(value); if (!want) return null;
      if (f(cellT) !== want) return null;
      return norm(cellT).length <= norm(value).length + 4 ? 'exact' : 'contains';
    }
    if (F.NUMERIC.has(field)) {
      if (!isNumberish(cellT)) return null;
      return numCandidates(cellT).some(x => numEqual(x, parseFloat(value), field)) ? 'exact' : null;
    }
    const v = norm(value), c = norm(cellT);
    if (!v) return null;
    if (v === c || (scan && canon(value) === canon(cellT))) return 'exact';
    if (v.length >= 4 && (c.includes(v) || (scan && canon(cellT).includes(canon(value))))) return 'contains';
    return null;
  }
  function findCells(docs, value, field) {
    const hits = [];
    for (const pg of iterPages(docs)) pg.rows.forEach((row, ri) => row.forEach((c, ci) => {
      const m = cellMatches(pg, c.t, value, field); if (m) hits.push([m, pg, ri, ci]);
    }));
    const key = h => (h[0] !== 'exact' ? 2 : 0) + (h[1].kind === 'scan' ? 1 : 0);
    return hits.map((h, i) => [h, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map(x => x[0]);
  }

  /* ---------- header fields ---------- */
  function buildRegex(cellT, value) {
    const t = cellT;
    const pat = [...String(value).replace(/\s+/g, '')].map(reEscape).join('\\s*');
    const m = new RegExp(pat, 'i').exec(t);
    if (!m) return null;
    const pre = t.slice(0, m.index), post = t.slice(m.index + m[0].length);
    function ctx(s, takeLast) {
      const toks = takeLast ? (s.match(/\S+\s*/g) || []) : (s.match(/\s*\S+/g) || []);
      if (!toks.length) return '';
      const part = takeLast ? toks.slice(-2).join('') : toks[0];
      if (!takeLast && isSpace(part[0] || 'x')) return '';
      let out = '';
      for (const ch of part) out += isDigit(ch) ? '\\d' : isSpace(ch) ? '\\s*' : reEscape(ch);
      return out.replace(/(\\s\*)+/g, '\\s*').replace(/(\\d)+/g, '\\d+');
    }
    const p = ctx(pre, true), q = ctx(post, false);
    if (!p && !q) return null;
    return '(?i)' + p + '(' + shape(String(value).replace(/\s+/g, '')).split('\\s*').join('') + ')' + q;
  }
  const TITLE_WORDS = ['COMMERCIALINVOICE', 'PACKINGLIST', 'SHIPPINGBILL', 'INVOICE', 'PACKING', 'BILLOFLADING', 'CERTIFICATE'];
  function pageTitle(page) {
    const head = page.rows.slice(0, 4).map(r => r.map(c => norm(c.t)).join('')).join('');
    for (const w of TITLE_WORDS) if (head.includes(w)) return w;
    return '';
  }
  function shapeScore(field, v, examples) {
    if (empty(v) || !examples || !examples.length) return 0;
    if (F.NUMERIC.has(field)) return numCandidates(v).length ? 2 : 0;
    const sv = shape(String(v).replace(/\s+/g, ' ').trim());
    if (examples.some(e => shape(String(e)) === sv)) return 2;
    const hasD = /\d/.test(String(v));
    return examples.some(e => /\d/.test(String(e)) === hasD) ? 1 : 0;
  }
  function take(spec, text) {
    if (spec.take !== 'prefix') return text;
    for (const e of spec.examples || []) {
      const m = rx('^(?:' + shape(e) + ')').exec(String(text).trim());
      if (m) return m[0];
    }
    return text;
  }
  function applyHeaderSimple(spec, docs, field, allHits) {
    const hits = [];
    const meth = spec.method;
    if (meth === 'fixed') return [spec.value, null];
    if (meth === 'regex') {
      const r = rx(spec.pattern);
      for (const pg of iterPages(docs)) for (let ri = 0; ri < pg.rows.length; ri++) for (let ci = 0; ci < pg.rows[ri].length; ci++) {
        const m = r.exec(pg.rows[ri][ci].t);
        if (m) { hits.push([cleanValue(field, m[1], spec.examples, pg.kind === 'scan'), [pg.id, ri, ci]]); if (!allHits) return hits[0]; }
      }
      return allHits ? hits : [null, null];
    }
    if (meth === 'anchor') {
      const lab = spec.label;
      for (const pg of iterPages(docs)) {
        const scan = pg.kind === 'scan';
        for (let ri = 0; ri < pg.rows.length; ri++) {
          const row = pg.rows[ri];
          for (let ci = 0; ci < row.length; ci++) {
            const c = row[ci];
            if (!(norm(c.t) === lab || (scan && canon(c.t) === canon(lab)))) continue;
            if (spec.dir === 'right') {
              if (ci + 1 < row.length) {
                hits.push([cleanValue(field, take(spec, row[ci + 1].t), spec.examples, scan), [pg.id, ri, ci + 1]]);
                if (!allHits) return hits[0];
              }
            } else {
              const dy = isNil(spec.dy) ? 1 : spec.dy;
              for (let k = ri + 1; k < Math.min(pg.rows.length, ri + dy + 2); k++) {
                const cands = pg.rows[k].map((x, j) => [j, x]).filter(([, x]) => overlap(x, c, pg.kind !== 'excel' ? 4 : 0));
                if (cands.length) {
                  let best = cands[0]; for (const jx of cands) if (Math.abs(xc(jx[1]) - xc(c)) < Math.abs(xc(best[1]) - xc(c))) best = jx;
                  const [j, x] = best;
                  if (k - ri === dy || k === Math.min(pg.rows.length - 1, ri + dy + 1)) {
                    hits.push([cleanValue(field, take(spec, x.t), spec.examples, scan), [pg.id, k, j]]);
                    if (!allHits) return hits[0];
                    break;
                  }
                }
              }
            }
          }
        }
      }
      return allHits ? hits : [null, null];
    }
    return allHits ? hits : [null, null];
  }
  function applyHeader(spec, docs, field) {
    if (!spec) return [null, null];
    if (spec.method === 'anchor' || spec.method === 'regex') {
      const cands = []; let order = 0;
      for (const pg of iterPages(docs)) {
        const title = pageTitle(pg);
        for (const [vv, ss] of applyHeaderSimple(spec, [{name: '', pages: [pg]}], field, true)) cands.push([vv, ss, title, ++order]);
      }
      if (!cands.length) return [null, null];
      const want = spec.title || '';
      const key = c => [-(c[2] === want && !!want ? 1 : 0), -shapeScore(field, c[0], spec.examples), c[3]];
      cands.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
      const best = cands[0];
      if (shapeScore(field, best[0], spec.examples) === 0 && spec.examples && spec.examples.length) return [null, null];
      return [best[0], best[1]];
    }
    return applyHeaderSimple(spec, docs, field, false);
  }
  function same(field, a, b) {
    if (isNil(a) || isNil(b) || a === '') return false;
    if (F.DATES.has(field)) return normDate(a) !== null && normDate(a) === normDate(b);
    if (F.TIMES.has(field)) return normTime(a) !== null && normTime(a) === normTime(b);
    if (F.NUMERIC.has(field)) { const x = parseFloat(a), y = parseFloat(b); return !isNaN(x) && !isNaN(y) && numEqual(x, y, field); }
    return norm(a) === norm(b) || canon(a) === canon(b);
  }
  function learnHeader(field, value, docs) {
    const found = []; let order = 0;
    for (const [kind, pg, ri, ci] of findCells(docs, value, field).slice(0, 20)) {
      const cell = pg.rows[ri][ci];
      const cands = [];
      const prefixOk = kind === 'contains' && !F.FIXED_OK.has(field) && (norm(cell.t).startsWith(norm(value)) || canon(cell.t).startsWith(canon(value)));
      if (kind === 'exact' || prefixOk) {
        const extra = kind !== 'exact' ? {take: 'prefix'} : {};
        const l = labelLeft(pg, ri, ci);
        if (l) cands.push(Object.assign({method: 'anchor', label: norm(l), label_text: l, dir: 'right'}, extra));
        const la = labelAbove(pg, ri, cell);
        if (la.t) cands.push(Object.assign({method: 'anchor', label: norm(la.t), label_text: la.t, dir: 'below', dy: la.dy}, extra));
      }
      if (kind === 'contains' && !F.FIXED_OK.has(field) && !F.DATES.has(field) && !F.TIMES.has(field)) {
        const pat = buildRegex(cell.t, value);
        if (pat) cands.push({method: 'regex', pattern: pat, label_text: cell.t});
      }
      for (const spec of cands) {
        spec.examples = [S(value)]; spec.title = pageTitle(pg);
        let got;
        try { [got] = applyHeader(spec, docs, field); } catch (e) { continue; }
        if (same(field, got, value)) {
          order++;
          let fit = fieldFit(field, spec.label_text, pg) + (spec.method === 'anchor' ? labelScore(spec.label_text) : 0);
          if (spec.method === 'regex') fit -= 1;
          found.push([fit, -order, spec]);
        }
      }
    }
    if (found.length) {
      let best = found[0]; for (const f of found) if (f[0] > best[0] || (f[0] === best[0] && f[1] > best[1])) best = f;
      const spec = best[2]; if (spec.method === 'regex') delete spec.label_text;
      return spec;
    }
    if (F.FIXED_OK.has(field) && !F.NEVER_FIXED.has(field) && !empty(value)) return {method: 'fixed', value};
    return null;
  }

  /* ---------- item table ---------- */
  function keyHits(docs, style) {
    const hits = [];
    for (const pg of iterPages(docs)) pg.rows.forEach((row, ri) => row.forEach((c, ci) => { if (cellMatches(pg, c.t, style, KEY_FIELD) === 'exact') hits.push([pg, ri, ci]); }));
    return hits;
  }
  function rowCells(page, ri, dys) {
    const out = [];
    for (const dy of dys) { const k = ri + dy; if (k >= 0 && k < page.rows.length) page.rows[k].forEach((c, j) => out.push([dy, j, c])); }
    return out;
  }
  const round2 = x => Math.round(x * 100) / 100;
  const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  function mostCommon(arr) { const m = new Map(); for (const v of arr) m.set(v, (m.get(v) || 0) + 1); let best = null, n = -1; for (const [k, c] of m) if (c > n) { best = k; n = c; } return best; }
  const pySorted = arr => [...arr].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  function learnItems(items, docs) {
    const styles = items.filter(it => it[KEY_FIELD]).map(it => S(it[KEY_FIELD]));
    if (!styles.length) return null;
    STYLES_NOW = new Set(styles.map(norm));
    const other = F.ITEM_FIELDS.filter(f => f !== KEY_FIELD);
    const bestOcc = [];
    for (const it of items) {
      const st = it[KEY_FIELD]; if (!st) continue;
      const cands = [];
      for (const [pg, ri, ci] of keyHits(docs, st)) {
        const key = pg.rows[ri][ci];
        let H = labelAbove(pg, ri, key, 6);
        if (!H.t || dataLike(H.t)) H = headingAbove(pg, ri, key);
        if (!H.t) continue;
        const offs = {};
        for (const f of other) {
          const v = it[f]; if (empty(v)) continue;
          for (const [dy, j, c] of rowCells(pg, ri, [0, 1, -1])) {
            if (j === ci && dy === 0) continue;
            if (cellMatches(pg, c.t, v, f) === 'exact') {
              const h2 = labelAbove(pg, ri + dy, c, 6);
              offs[f] = {dx: round2(xc(c) - xc(key)), dy, header: h2.t ? norm(h2.t) : '', hdx: h2.cell ? round2(xc(h2.cell) - xc(H.cell)) : null};
              break;
            }
          }
        }
        const score = Object.keys(offs).length + (pg.kind !== 'scan' ? 0.5 : 0);
        cands.push([score, pg, ri, ci, norm(H.t), offs]);
      }
      if (cands.length) { let b = cands[0]; for (const c of cands) if (c[0] > b[0]) b = c; bestOcc.push(b); }
    }
    if (!bestOcc.length) return null;
    const hdr = mostCommon(bestOcc.map(o => o[4]));
    const cols = {};
    for (const f of other) {
      const vals = bestOcc.filter(o => o[5][f]).map(o => o[5][f]);
      if (!vals.length) continue;
      const kinds = {}, hk = {};
      for (const o of bestOcc) if (o[5][f]) (kinds[o[1].kind] = kinds[o[1].kind] || []).push(o[5][f].dx);
      for (const o of bestOcc) if (o[5][f] && !isNil(o[5][f].hdx)) (hk[o[1].kind] = hk[o[1].kind] || []).push(o[5][f].hdx);
      cols[f] = {dx: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, median(v)])),
        hdx: Object.fromEntries(Object.entries(hk).map(([k, v]) => [k, median(v)])),
        dy: mostCommon(vals.map(v => v.dy)), header: mostCommon(vals.map(v => v.header))};
    }
    const po = pySorted([...new Set(items.filter(it => it['PO Number']).map(it => S(it['PO Number'])))]).slice(0, 12);
    return {key_header: hdr, key_examples: pySorted([...new Set(styles)]).slice(0, 12), columns: cols,
      examples: {'PO Number': po}, min_fields: Math.max(1, Math.ceil(Object.keys(cols).length * 0.6))};
  }
  function columnTargets(spec, pg, hri, h) {
    const kind = pg.kind, scan = kind === 'scan';
    const cands = {};
    for (const [f, col] of Object.entries(spec.columns)) {
      const hd = col.header; const hdx = (col.hdx || {})[kind];
      if (!hd || isNil(hdx)) continue;
      const found = [];
      for (let k = Math.max(0, hri - 3); k < Math.min(pg.rows.length, hri + 4); k++) for (const c of pg.rows[k])
        if (norm(c.t) === hd || (scan && canon(c.t) === canon(hd)) || (hd.length >= 4 && norm(c.t).includes(hd))) found.push(xc(c) - xc(h));
      if (found.length) cands[f] = [hdx, found];
    }
    let ratios = Object.values(cands).filter(([hdx, found]) => found.length === 1 && Math.abs(hdx) > 20).map(([hdx, found]) => found[0] / hdx);
    ratios = ratios.filter(r => r > 0.6 && r < 1.6);
    const sc = ratios.length && kind !== 'excel' ? median(ratios) : 1.0;
    const targets = {};
    for (const [f, col] of Object.entries(spec.columns)) {
      if (cands[f]) { const [hdx, found] = cands[f]; let b = found[0]; for (const d of found) if (Math.abs(d - hdx * sc) < Math.abs(b - hdx * sc)) b = d; targets[f] = b; }
      else { const dx = (col.dx || {})[kind]; if (!isNil(dx)) targets[f] = dx * sc; }
    }
    const withHdr = Object.entries(spec.columns).filter(([, col]) => col.header && !isNil((col.hdx || {})[kind])).map(([f]) => f);
    const coverage = withHdr.length ? Object.keys(cands).length / withHdr.length : 1.0;
    return {targets, sc, coverage};
  }
  function rowPlausible(r) {
    const [q, p, cbm, gw] = NUM_ITEM.map(f => r[f]);
    if (!isNil(p) && (p <= 0 || p > 20000 || Math.abs(p - Math.round(p)) > 1e-6)) return false;
    if (!isNil(q) && (q <= 0 || q > 5000000)) return false;
    if (p) {
      if (!isNil(cbm) && !(cbm / p >= 0.002 && cbm / p <= 0.6)) return false;
      if (!isNil(gw) && !(gw / p >= 0.05 && gw / p <= 80)) return false;
      if (!isNil(q) && q < p * 0.5) return false;
    }
    return true;
  }
  function plausible(r) {
    const ctn = r['Total Packages'] || 0;
    for (const [f, lim] of [['Gross weight (kg)', 80], ['Total CBM', 0.6]]) {
      const v = r[f];
      if (v && ctn && v / ctn > lim) for (const alt of r['_alt_' + f] || []) if (alt / ctn <= lim) { r[f] = alt; break; }
    }
  }
  function applyItems(spec, docs) {
    if (!spec) return [];
    const rows = [];
    const exs = spec.key_examples || [];
    const shapes = [...new Set(exs.map(shape))];
    for (const pg of iterPages(docs)) {
      const scan = pg.kind === 'scan', tol = xtol(pg);
      for (let hri = 0; hri < pg.rows.length; hri++) for (const h of pg.rows[hri]) {
        if (!(norm(h.t) === spec.key_header || (scan && canon(h.t) === canon(spec.key_header)))) continue;
        const {targets, coverage} = columnTargets(spec, pg, hri, h);
        if (coverage < 0.5) continue;
        for (let ri = hri + 1; ri < Math.min(pg.rows.length, hri + 45); ri++) pg.rows[ri].forEach((c, ci) => {
          if (!overlap(c, h, pg.kind !== 'excel' ? tol : 0)) return;
          let val = c.t.trim();
          if (!shapes.some(s => fullmatch(s, val))) { val = scan ? ocrCoerce(val, exs) : null; if (!val) return; }
          const found = {[KEY_FIELD]: val.toUpperCase()};
          const src = {[KEY_FIELD]: [pg.id, ri, ci]};
          for (const [f, col] of Object.entries(spec.columns)) {
            if (!(f in targets)) continue;
            const tx = xc(h) + targets[f];
            let best = null;
            for (const [dy, j, x] of rowCells(pg, ri, [col.dy, 0, 1, -1])) {
              if (dy === 0 && j === ci) continue;
              if (F.NUMERIC.has(f) && !isNumberish(x.t)) continue;
              const d = Math.abs(xc(x) - tx);
              const k = [dy !== col.dy ? 1 : 0, d];
              if (d <= tol * (scan ? 1.5 : 1) && (best === null || k[0] < best[0][0] || (k[0] === best[0][0] && k[1] < best[0][1]))) best = [k, x, [pg.id, ri + dy, j]];
            }
            if (best) { found[f] = best[1].t; src[f] = best[2]; }
          }
          if (Object.keys(found).length - 1 >= (spec.min_fields || 1)) rows.push([found, src, pg]);
        });
      }
    }
    const out = [], seen = new Map();
    for (const [found, src, pg] of rows) {
      const r = {};
      for (const [f, raw] of Object.entries(found)) {
        if (F.NUMERIC.has(f)) { const c = numCandidates(raw); r[f] = c.length ? c[0] : null; r['_alt_' + f] = c.slice(1); }
        else r[f] = cleanValue(f, raw, (spec.examples || {})[f], pg.kind === 'scan');
      }
      plausible(r);
      for (const k of Object.keys(r)) if (k.startsWith('_alt_')) delete r[k];
      if (!rowPlausible(r)) continue;
      r._src = src; r._scan = pg.kind === 'scan';
      /* several purchase orders in one invoice: a row without its own PO column takes the PO printed above it */
      if (empty(r['PO Number']) && CSD.A && CSD.A.poNear) {
        const po = CSD.A.poNear(pg, src[KEY_FIELD][1]);
        if (po && norm(po) !== norm(r[KEY_FIELD])) { r['PO Number'] = po; r._ai = Object.assign(r._ai || {}, {'PO Number': 'auto'}); }
      }
      const key = norm(r[KEY_FIELD]) + '|' + norm(r['PO Number']);
      const n = F.ITEM_FIELDS.filter(f => !empty(r[f])).length;
      if (seen.has(key)) { const [pn, idx] = seen.get(key); if (n > pn) { out[idx] = r; seen.set(key, [n, idx]); } continue; }
      seen.set(key, [n, out.length]); out.push(r);
    }
    return out;
  }

  function itemsAgreement(found, items) {
    const byKey = {}; for (const r of found) byKey[norm(r[KEY_FIELD])] = r;
    let n = 0;
    for (const it of items) { const r = byKey[norm(it[KEY_FIELD])]; if (!r) continue;
      for (const f of F.ITEM_FIELDS) if (!empty(it[f]) && same(f, r[f], it[f])) n++; }
    return n;
  }

  /* ---------- whole profile ---------- */
  /* per-shipper choice of document for a field ("read Invoice No. from the invoice"): only those pages are used */
  function docsOfField(prof, docs, f) {
    const t = ((prof && prof.source) || {})[f];
    if (!t || t === 'auto' || !CSD.A || !CSD.A.docsFor) return docs;
    return CSD.A.docsFor(docs, t);
  }
  function learnProfile(old, shipper, header, items, docs, sources) {
    const prof = Object.assign({}, old || {});
    if (sources) { const s = {}; for (const [f, t] of Object.entries(sources)) if (t && t !== 'auto') s[f] = t; prof.source = s; }
    const allDocs = docs;
    prof.shipper = shipper; prof.match = norm(shipper);
    const hspecs = Object.assign({}, prof.header || {});
    const report = {};
    for (const f of [...F.HEADER_FIELDS, 'PO Number']) {
      let v = header[f];
      if (f === 'PO Number') {
        const vals = new Set(items.filter(it => it[f]).map(it => norm(it[f])));
        if (vals.size !== 1) continue;
        v = items[0][f];
      }
      if (empty(v)) continue;
      docs = docsOfField(prof, allDocs, f);
      let oldSpec = hspecs[f];
      if (oldSpec && oldSpec.method === 'fixed' && F.NEVER_FIXED.has(f)) oldSpec = null;
      if (oldSpec) { let got = null; try { [got] = applyHeader(oldSpec, docs, f); } catch (e) {} if (same(f, got, v)) { report[f] = 'kept'; continue; } }
      const spec = learnHeader(f, v, docs);
      if (spec) { hspecs[f] = spec; report[f] = spec.method; } else report[f] = 'not found in documents';
    }
    docs = allDocs;
    for (const f of Object.keys(hspecs)) if (hspecs[f].method === 'fixed' && (F.NEVER_FIXED.has(f) || !F.FIXED_OK.has(f))) delete hspecs[f];
    prof.header = hspecs;
    const ispec = learnItems(items, docs);
    const oldItems = prof.items;
    if (ispec) {
      if (oldItems) ispec.key_examples = pySorted([...new Set([...ispec.key_examples, ...(oldItems.key_examples || [])])]).slice(0, 30);
      const test = applyItems(ispec, docs);
      if (test.length >= Math.max(1, Math.floor(items.length * 0.6))) {
        if (oldItems) {
          // keep the existing table layout if it reproduces the confirmed values at least as well
          const merged = Object.assign({}, oldItems, {key_examples: ispec.key_examples});
          const mrows = applyItems(merged, docs);
          if (itemsAgreement(mrows, items) >= itemsAgreement(test, items)) { prof.items = merged; report._items = `kept (${mrows.length} of ${items.length} rows found)`; }
          else { prof.items = ispec; report._items = `learnt (${test.length} of ${items.length} rows found)`; }
        } else { prof.items = ispec; report._items = `learnt (${test.length} of ${items.length} rows found)`; }
      } else report._items = `table not reliable (${test.length} of ${items.length} rows found) – kept previous`;
    } else report._items = 'could not locate item rows in documents';
    prof.uses = (prof.uses || 0) + 1;
    return {profile: prof, report};
  }
  function applyProfile(prof, docs) {
    const header = {}, src = {}, how = {};
    for (const [f, spec] of Object.entries((prof || {}).header || {})) {
      if (spec.method === 'fixed' && (F.NEVER_FIXED.has(f) || !F.FIXED_OK.has(f))) continue;
      let v = null, s = null;
      try { [v, s] = applyHeader(spec, docsOfField(prof, docs, f), f); } catch (e) { v = null; }
      if (!empty(v)) { header[f] = v; how[f] = spec.method; if (s) src[f] = s; }
    }
    const items = applyItems((prof || {}).items, docs);
    if ('PO Number' in header) for (const it of items) if (!it['PO Number']) it['PO Number'] = header['PO Number'];
    return {header, src, items, how};
  }
  function detectShipper(profiles, docs) {
    let text = ''; for (const pg of iterPages(docs)) for (const row of pg.rows) for (const c of row) text += norm(c.t);
    let ctext = null, best = null;
    for (const p of profiles) {
      const m = (p.data && p.data.match) || norm(p.shipper);
      if (m.length < 4) continue;
      let hit = text.includes(m);
      if (!hit) { ctext = ctext || canon(text); hit = ctext.includes(canon(m)); }
      if (hit && (best === null || m.length > ((best.data && best.data.match) || '').length)) best = p;
    }
    return best;
  }
  function totalChecks(items, docs) {
    const res = {};
    for (const f of NUM_ITEM) {
      const vals = items.map(it => it[f]).filter(v => typeof v === 'number');
      if (!vals.length) continue;
      const s = vals.reduce((a, b) => a + b, 0);
      let found = null;
      outer: for (const pg of iterPages(docs)) for (let ri = 0; ri < pg.rows.length; ri++) for (let ci = 0; ci < pg.rows[ri].length; ci++) {
        const c = pg.rows[ri][ci];
        if (isNumberish(c.t) || /total/i.test(c.t)) if (numCandidates(c.t).some(x => numEqual(x, s, f))) { found = {page: pg.id, row: ri, cell: ci, text: c.t}; break outer; }
      }
      res[f] = {sum: Math.round(s * 1000) / 1000, found};
    }
    return res;
  }

  /* =====================================================================================================
     v15.1 – "Pick" training for item columns (per shipper).
     The operator picks a value once (any row); the app remembers the text printed above it (the heading) or to its
     left (a label) and the distance to it. Every place where that heading is printed again (one block per page,
     or one line per row under a table heading) gives the value of the next row.
     ===================================================================================================== */
  const PICK_FIELDS = ['PO Number', 'Style', 'Colour', 'Total Packages', 'Qty Type', 'Gross weight (kg)', 'Net weight (kg)', 'Total CBM', 'Item Qty (pcs)', 'Delivery No'];
  const labelText = t => /[A-Za-z]{2,}/.test(String(t)) && !/^\s*[-\d.,]+\s*$/.test(String(t));
  const pageTypeOf = (pg, d) => (root.CSD.A && root.CSD.A.pageType) ? root.CSD.A.pageType(pg, d && d.name) : 'other';
  /* headings read by OCR differ a little from page to page (CRTNS / CRINS, "Volume : weight") */
  function lev1(a, b) { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; }
  /* OCR may change one letter (CRTNS / CRINS, GROSS / GROSE) – but a different word (COLOUR vs COLOUR(S) in the side marks) is not the same heading */
  const anchorEq = (want, t) => { const n = norm(t); if (n === want) return true; if (want.length >= 4 && n.length === want.length && (lev1(want, n) || canon(n) === canon(want))) return true;
    return want.length >= 5 && n.length > want.length + 2 && String(t).toUpperCase().split(/[^A-Z0-9]+/).includes(want); };   // merged cell "Volume : weight"
  /* documents without the VDF (it repeats PO / style / cartons but is not the packing list or invoice) */
  /* the VDF can be its own file or extra pages in the same scan: drop VDF pages (and its "other" continuation pages) only */
  const withoutVdf = docs => docs.map(d => { let inVdf = false; const pages = d.pages.filter(pg => { const t = pageTypeOf(pg, d); if (t === 'vdf') { inVdf = true; return false; } if (t !== 'other') inVdf = false; return !inVdf; });
    return pages.length === d.pages.length ? d : Object.assign({}, d, {pages}); }).filter(d => d.pages.length);
  function findPage(docs, pageId) { for (const d of docs) for (const pg of d.pages) if (pg.id === pageId) return {d, pg}; return null; }
  /* spec for one picked cell: {type, anchor, dy, dx, w, mode} */
  function pickSpec(docs, ref, field) {
    const f = findPage(docs, ref[0]); if (!f) return null;
    const {pg, d} = f, ri = ref[1], c = pg.rows[ri] && pg.rows[ri][ref[2]]; if (!c) return null;
    const type = pageTypeOf(pg, d), w = c.x1 - c.x0, scale = pg.kind === 'excel' ? 1 : 30;
    let best = null;
    for (let k = 1; k <= 8 && ri - k >= 0; k++) for (const a of pg.rows[ri - k]) {
      if (!labelText(a.t) || norm(a.t).length < 2) continue;
      const ov = overlap(a, c, pg.kind === 'excel' ? 0 : 5);
      const score = k * 2 + (ov ? 0 : 3 + Math.abs(xc(a) - xc(c)) / scale);
      if (!best || score < best.score) best = {score, a, k};
    }
    const left = pg.rows[ri].filter(a => a.x1 <= c.x0 + 1 && labelText(a.t)).sort((p, q) => q.x1 - p.x1)[0];
    const ordOf = (a, ri2) => pg.rows[ri2].filter(x => anchorEq(norm(a.t), x.t)).sort((p, q) => p.x0 - q.x0).indexOf(a);
    if (left && (!best || best.score > 6) && norm(left.t).length >= 2) return {type, mode: 'left', anchor: norm(left.t), dy: 0, dx: c.x0 - left.x0, w, ax: left.x0, ord: ordOf(left, ri), field};
    if (!best) return null;
    const ar = ri - best.k, up = ar > 0 ? pg.rows[ar - 1].filter(x => labelText(x.t) && overlap(x, best.a, pg.kind === 'excel' ? 0 : 4)).sort((p, q) => Math.abs(xc(p) - xc(best.a)) - Math.abs(xc(q) - xc(best.a)))[0] : null;
    const cv = cleanValue(field, c.t, null, false), vshape = ['PO Number', 'Style', 'Delivery No'].includes(field) && cv ? shape(cv) : undefined, vlen = vshape ? String(cv).length : undefined, vdig = vshape ? (String(cv).match(/\d/g) || []).length : undefined;
    return {type, mode: 'below', anchor: norm(best.a.t), dy: best.k, dx: c.x0 - best.a.x0, w, ax: best.a.x0, ord: ordOf(best.a, ar), field, vshape, vlen, vdig,
      above: up && norm(up.t).length >= 2 && norm(up.t).length <= 20 ? norm(up.t) : undefined, dx2: up ? c.x0 - up.x0 : undefined};
  }
  /* values for a spec, in document order: [{v, src:[pageId, ri, ci]}] */
  function pickValues(docs, spec) {
    const out = [], field = spec.field;
    const ok = t => { if (isNil(t) || String(t).trim() === '') return false; if (F.NUMERIC.has(field)) return numCandidates(t).length > 0; return !/^(TOTAL|GRAND\s*TOTAL)\b/i.test(String(t).trim()) && norm(t).length > 0; };
    const cellAt = (pg, ri, x0) => { const row = pg.rows[ri]; if (!row) return -1; const want = {x0, x1: x0 + spec.w}; let bi = -1, bo = 0;
      row.forEach((c, ci) => { const o = Math.min(c.x1, want.x1) - Math.max(c.x0, want.x0); if (o > bo || (bi < 0 && overlap(c, want, pg.kind === 'excel' ? 0 : 6))) { bo = Math.max(o, bo); bi = ci; } }); return bi; };
    const occ = [];
    for (const d of docs) for (const pg of d.pages) {
      if (spec.type && spec.type !== 'other' && pageTypeOf(pg, d) !== spec.type) continue;
      pg.rows.forEach((row, ri) => {
        let hits = row.filter(a => anchorEq(spec.anchor, a.t)).sort((p, q) => p.x0 - q.x0); if (!hits.length) return;
        if (spec.above) {              // two-line heading: the upper word must be printed above it too
          const ups = ri > 0 ? pg.rows[ri - 1].filter(x => anchorEq(spec.above, x.t)) : [];
          const both = []; for (const a of hits) { const u = ups.find(x => overlap(x, a, pg.kind === 'excel' ? 0 : 6)); if (u) both.push(Object.assign({}, a, {_up: u})); }
          if (!both.length) return;
          if (both.length === 1) { occ.push({pg, ri, a: both[0]}); return; }
          hits = both;
        }
        /* same heading twice in a row (e.g. "weight" under Net and under Gross): take the same one (1st, 2nd…) as when trained */
        const a = spec.ord >= 0 && hits.length > 1 ? (hits[spec.ord] || hits[hits.length - 1]) : hits.length > 1 && spec.ax !== undefined ? hits.slice().sort((p, q) => Math.abs(p.x0 - spec.ax) - Math.abs(q.x0 - spec.ax))[0] : hits[0];
        occ.push({pg, ri, a});
      });
    }
    const take = (pg, ri, ci) => { const t = pg.rows[ri][ci].t; const v = cleanValue(field, t, null, pg.kind === 'scan'); return v === null || v === '' ? null : {v, src: [pg.id, ri, ci]}; };
    if (spec.mode === 'left') {
      for (const o of occ) { const ci = o.pg.rows[o.ri].findIndex(c => c.x0 >= o.a.x1 - 1 && ok(c.t)); if (ci >= 0) { const x = take(o.pg, o.ri, ci); if (x) out.push(x); } }
      return out;
    }
    /* every heading found: the value under it (same distance as trained), then the lines below it in the same column
       as long as they look like the trained value – so 1 line, 5 lines or 50 lines, on one page or one block per page */
    const looksLike = t => { if (!spec.vshape) return true; const v = cleanValue(field, t, null, false) || ''; const dg = (v.match(/\d/g) || []).length, want = (spec.vdig ?? 1);
      return fullmatch(spec.vshape, v) || (spec.vlen && /^[A-Z0-9-]+$/.test(v) && Math.abs(v.length - spec.vlen) <= 2 && dg >= Math.max(1, want - 2)); };
    for (const o of occ) {
      const vx = o.a._up && spec.dx2 !== undefined ? o.a._up.x0 + spec.dx2 : o.a.x0 + spec.dx;
      let first = -1;
      for (const dy of [spec.dy, spec.dy - 1, spec.dy + 1, spec.dy + 2]) { const ri = o.ri + dy; if (ri <= o.ri) continue; const ci = cellAt(o.pg, ri, vx); if (ci >= 0 && ok(o.pg.rows[ri][ci].t)) { const x = take(o.pg, ri, ci); if (x) { out.push(x); first = ri; break; } } }
      if (first < 0) continue;
      for (let ri = first + 1; ri < o.pg.rows.length; ri++) {
        if (occ.some(q => q.pg === o.pg && q.ri === ri)) break;                       // the next block starts
        if (/\b(GRAND\s*)?TOTAL\b/i.test(o.pg.rows[ri].map(c => c.t).join(' '))) break;
        const ci = cellAt(o.pg, ri, vx);
        const good = ci >= 0 && ok(o.pg.rows[ri][ci].t) && looksLike(o.pg.rows[ri][ci].t);
        /* a PO is often printed once for a group of lines: blank cells under it are skipped, not the end of the table */
        if (!good) { if (GROUP_KEYS.includes(field) && spec.vshape) continue; break; }
        const x = take(o.pg, ri, ci); if (!x) break; out.push(x);
      }
    }
    return fixScale(out, field);
  }
  const GROUP_KEYS = ['PO Number', 'Delivery No'];
  /* position of a value in the documents (page order, then line) – to give each style line the PO printed above it */
  function posIndex(docs) { const m = new Map(); let i = 0; for (const d of docs) for (const pg of d.pages) m.set(pg.id, i++); return src => src ? m.get(src[0]) * 100000 + src[1] : -1; }
  function alignGroup(docs, keyVals, vals) {
    const pos = posIndex(docs), vs = vals.map(x => ({x, p: pos(x.src)})).sort((a, b) => a.p - b.p);
    return keyVals.map(k => { const p = pos(k.src); let best = null; for (const v of vs) if (v.p <= p) best = v.x; return best || vs[0].x; });
  }
  /* OCR on scans: "339,000" can mean 339.000 – when the rows disagree by ×1000, use the reading nearest the others */
  function fixScale(vals, field) {
    if (!['Gross weight (kg)', 'Net weight (kg)', 'Total CBM'].includes(field) || vals.length < 2) return vals;   // counts (pcs, cartons) really vary a lot
    const nums = vals.map(x => x.v).filter(v => typeof v === 'number' && v > 0).sort((a, b) => a - b); if (nums.length < 2) return vals;
    const med = nums[Math.floor(nums.length / 2)];
    for (const x of vals) if (typeof x.v === 'number' && x.v > 0) for (const k of [1000, 0.001]) { const y = x.v / k; if (Math.abs(Math.log10(y / med)) + 0.5 < Math.abs(Math.log10(x.v / med))) { x.v = Math.round(y * 1000) / 1000; break; } }
    return vals;
  }
  /* fill item rows from the saved picks of a shipper (row k = k-th value); PO printed once for a group is repeated */
  function applyPicks(picks, docs, items) {
    const got = {};
    picks = Object.fromEntries(Object.entries(picks || {}).filter(([f]) => f !== 'Qty Type'));   // v16.3: Type is a shipper default, never a position
    for (const [f, spec] of Object.entries(picks || {})) { try { const v = pickValues(docs, Object.assign({field: f}, spec)); if (v.length) got[f] = v; } catch (e) {} }
    /* how many rows: the trained Style column decides; otherwise the longest trained column */
    const n = got.Style ? got.Style.length : Math.max(0, ...Object.entries(got).filter(([f]) => f !== 'PO Number' && f !== 'Delivery No').map(([, v]) => v.length), got['PO Number'] ? got['PO Number'].length : 0);
    const none = Object.keys(picks || {}).filter(f => !got[f]);           // v16.1: trained, but nothing found any more
    if (!n) return {items, filled: 0, none, counts: {}};
    while (items.length < n) items.push({});
    let filled = 0;
    for (const f of GROUP_KEYS) if (got[f] && got.Style && got[f].length < got.Style.length) got[f] = alignGroup(docs, got.Style, got[f]);
    for (const [f, vals] of Object.entries(got)) {
      for (let k = 0; k < n; k++) {
        const x = vals[k] || ((f === 'PO Number' || f === 'Delivery No') && vals.length < n ? vals[vals.length - 1] : null);
        if (!x) continue;
        const it = items[k]; it[f] = x.v; (it._src = it._src || {})[f] = x.src; (it._ai = it._ai || {})[f] = 'trained'; filled++;
      }
    }
    if (got.Style && items.length > n) items.splice(n);     // the trained style column decides how many rows there are
    return {items, filled, rows: n, none, counts: Object.fromEntries(Object.entries(got).map(([f, v]) => [f, v.length]))};
  }
  /* Delivery No from the VDF (APL Logistics "Vendors Cargo Delivery Notice"): the number after DELIVERY NO, matched to the PO on that VDF */
  function vdfDeliveries(docs) {
    const out = [];
    for (const d of docs) for (const pg of d.pages) {
      if (pageTypeOf(pg, d) !== 'vdf') continue;
      const lines = pg.rows.map(r => r.map(c => c.t).join(' ')), all = lines.join(' \n ');
      let no = null, src = null;
      pg.rows.forEach((row, ri) => row.forEach((c, ci) => { if (no || !/DELIVERY\s*NO/i.test(c.t)) return;
        const m = String(c.t).match(/DELIVERY\s*NO\.?\s*:?\s*(\d{4,10})/i); if (m) { no = m[1]; src = [pg.id, ri, ci]; return; }
        for (let k = 0; k <= 3 && !no; k++) { const r2 = pg.rows[ri + k] || []; r2.forEach((x, xi) => { if (!no && (k > 0 || xi > ci) && /^\*?\d{4,10}\*?$/.test(String(x.t).trim())) { no = String(x.t).replace(/\D/g, ''); src = [pg.id, ri + k, xi]; } }); } }));
      if (!no) { const m = all.match(/\*(\d{4,10})\*/); if (m) no = m[1]; }
      if (no) { const prev = out.find(x => x.no === no); if (prev) prev.text += norm(all); else out.push({no, src, text: norm(all), page: pg.id}); }
    }
    return out;
  }
  root.CSD.P = {norm, canon, shape, numCandidates, isNumberish, cleanValue, cellMatches, findCells, learnProfile, applyProfile,
    pickSpec, pickValues, applyPicks, vdfDeliveries, withoutVdf, alignGroup, PICK_FIELDS,
    detectShipper, totalChecks, pageTitle, applyHeader, learnHeader, buildRegex};
})(typeof self !== 'undefined' ? self : globalThis);
