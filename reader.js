/* Turn shipper documents (Excel, text PDF, scanned PDF, photo) into pages -> rows -> cells {t, x0, x1},
   exactly like the desktop version, entirely inside the browser (nothing is uploaded anywhere).
   Excel: SheetJS.  PDF text: pdf.js.  Scans/photos: Tesseract OCR (WebAssembly) after removing table lines. */
(function (root) {
  const CSD = root.CSD;
  const BASE = (typeof document !== 'undefined' && document.baseURI) ? new URL('.', document.baseURI).href : './';
  /* OCR settings (tuned on real copier scans of packing lists) */
  const OPT = {dpi: 300, ink: 170, removeLines: true, psm: '3', lang: 'eng'};

  /* ---------- values ---------- */
  const pad = n => String(n).padStart(2, '0');
  function fmt(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (v instanceof Date) return `${pad(v.getDate())}.${pad(v.getMonth() + 1)}.${v.getFullYear()}`;
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return String(v);
      return v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    }
    return String(v).replace(/\s+/g, ' ').trim();
  }

  /* ---------- Excel / CSV ---------- */
  function readWorkbook(buf, name) {
    const XLSX = root.XLSX;
    const wb = XLSX.read(buf, {type: 'array', cellDates: true, cellNF: false, cellText: false});
    const pages = [];
    wb.SheetNames.forEach((sn, i) => {
      const meta = ((wb.Workbook || {}).Sheets || [])[i];
      if (meta && meta.Hidden) return;
      const ws = wb.Sheets[sn];
      if (!ws || !ws['!ref']) { pages.push({title: 'Sheet ' + sn, rows: [], kind: 'excel'}); return; }
      const rng = XLSX.utils.decode_range(ws['!ref']);
      const span = {};
      for (const m of ws['!merges'] || []) span[m.s.r + ':' + m.s.c] = m.e.c + 2;
      const rows = [];
      for (let r = rng.s.r; r <= rng.e.r; r++) {
        const row = [];
        for (let c = rng.s.c; c <= rng.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({r, c})];
          if (!cell) continue;
          let v = cell.v;
          if (cell.t === 'e') continue;
          const t = fmt(v);
          if (!t) continue;
          row.push({t, x0: c + 1, x1: span[r + ':' + c] || c + 2});
        }
        if (row.length) rows.push(row.sort((a, b) => a.x0 - b.x0));
      }
      pages.push({title: 'Sheet ' + sn, rows, kind: 'excel'});
    });
    return pages;
  }

  /* ---------- words -> rows of cells (same clustering as the desktop version) ---------- */
  function wordsToRows(words, width, gapFactor = 0.9) {
    if (!words.length) return [];
    const hs = words.map(w => w.bottom - w.top).filter(h => h > 0).sort((a, b) => a - b);
    let h = 10;
    if (hs.length) h = hs.length % 2 ? hs[(hs.length - 1) / 2] : (hs[hs.length / 2 - 1] + hs[hs.length / 2]) / 2;
    words = [...words].sort((a, b) => ((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) || (a.x0 - b.x0));
    const lines = []; let cur = [], curMid = null;
    for (const w of words) {
      const mid = (w.top + w.bottom) / 2;
      if (cur.length && Math.abs(mid - curMid) > h * 0.55) { lines.push(cur); cur = []; }
      cur.push(w);
      curMid = cur.length === 1 ? mid : (curMid * (cur.length - 1) + mid) / cur.length;
    }
    if (cur.length) lines.push(cur);
    const scale = 1000 / width;
    const r1 = x => Math.round(x * scale * 10) / 10;
    return lines.map(line => {
      line.sort((a, b) => a.x0 - b.x0);
      const cells = []; let cell = null;
      for (const w of line) {
        if (cell && w.x0 - cell.x1r <= h * gapFactor) { cell.t += ' ' + w.t; cell.x1r = w.x1; }
        else { if (cell) cells.push(cell); cell = {t: w.t, x0r: w.x0, x1r: w.x1}; }
      }
      if (cell) cells.push(cell);
      return cells.map(c => ({t: c.t, x0: r1(c.x0r), x1: r1(c.x1r)}));
    });
  }

  /* ---------- OCR ---------- */
  /* Erase long straight lines (table rulings): they confuse OCR. Same method as the desktop version. */
  function removeTableLines(img, minlen = 120, ink = OPT.ink) {
    const {width: W, height: H, data} = img;
    const b = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < W * H; i++, p += 4) b[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) < ink ? 1 : 0;
    const line = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { let s = -1; const o = y * W;
      for (let x = 0; x <= W; x++) { const on = x < W && b[o + x];
        if (on && s < 0) s = x; else if (!on && s >= 0) { if (x - s >= minlen) line.fill(1, o + s, o + x); s = -1; } } }
    for (let x = 0; x < W; x++) { let s = -1;
      for (let y = 0; y <= H; y++) { const on = y < H && b[y * W + x];
        if (on && s < 0) s = y; else if (!on && s >= 0) { if (y - s >= minlen) for (let k = s; k < y; k++) line[k * W + x] = 1; s = -1; } } }
    const out = new ImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const near = line[i] || (y > 0 && line[i - W]) || (y < H - 1 && line[i + W]) || (x > 0 && line[i - 1]) || (x < W - 1 && line[i + 1]);
      const v = b[i] && !near ? 0 : 255, p = i * 4;
      out.data[p] = out.data[p + 1] = out.data[p + 2] = v; out.data[p + 3] = 255;
    }
    return out;
  }
  /* A small pool of OCR workers: several scanned pages are read at the same time (one per spare processor core). */
  const POOL_MAX = Math.max(2, Math.min(3, ((root.navigator && root.navigator.hardwareConcurrency) || 2) - 1));
  const pool = [];            // {p: Promise<worker>, busy: bool}
  const waiting = [];
  function newWorker() {
    const p = root.Tesseract.createWorker(OPT.lang, 1, {
      workerPath: BASE + 'tesseract-worker.min.js',
      corePath: BASE,
      langPath: BASE,
      gzip: true, cacheMethod: 'none', workerBlobURL: false,
    }).then(async w => { await w.setParameters({tessedit_pageseg_mode: OPT.psm}); return w; });
    const slot = {p, busy: false};
    p.catch(() => { const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1); });
    pool.push(slot);
    return slot;
  }
  function acquire() {
    const free = pool.find(s => !s.busy);
    if (free) { free.busy = true; return Promise.resolve(free); }
    if (pool.length < POOL_MAX) { const s = newWorker(); s.busy = true; return Promise.resolve(s); }
    return new Promise(res => waiting.push(res));
  }
  function release(slot) {
    const next = waiting.shift();
    if (next) next(slot); else slot.busy = false;
  }
  /* start one OCR worker in the background when the app opens, so the first scan does not wait for it */
  function warm() { try { if (!pool.length && root.Tesseract) newWorker(); } catch (e) { /* ignore */ } }
  function wordsFromResult(data) {
    let ws = data.words;
    if (!ws || !ws.length) {
      ws = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) ws.push(w);
    }
    const out = [];
    for (const w of ws) {
      const t = (w.text || '').trim(); if (!t) continue;
      if ((w.confidence ?? 100) < 20 && t.length < 2) continue;
      out.push({t, x0: w.bbox.x0, x1: w.bbox.x1, top: w.bbox.y0, bottom: w.bbox.y1});
    }
    return out;
  }
  async function ocrCanvas(canvas) {
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    try { if (OPT.removeLines) ctx.putImageData(removeTableLines(img), 0, 0); } catch (e) { /* keep original */ }
    const slot = await acquire();
    try {
      const w = await slot.p;
      const {data} = await w.recognize(canvas);
      return wordsToRows(wordsFromResult(data), canvas.width, 1.1);
    } finally { release(slot); }
  }

  /* ---------- PDFium (same PDF engine as the desktop version) for drawing scanned pages ----------
     Scanned pages are drawn with PDFium because OCR on faint copier scans is very sensitive to how the page is drawn;
     PDFium gives the same picture as the desktop version, where the item rows read correctly. */
  let pdfiumP = null;
  function pdfium() {
    if (!pdfiumP) pdfiumP = (async () => {
      const mod = await import(BASE + 'pdfium.js');
      const wasm = await (await fetch(BASE + 'pdfium.wasm')).arrayBuffer();
      const M = await mod.init({wasmBinary: wasm});
      M.FPDF_InitLibrary();
      return M;
    })();
    pdfiumP.catch(() => { pdfiumP = null; });
    return pdfiumP;
  }
  async function pdfiumOpen(bytes) {
    const M = await pdfium(), P = M.pdfium;
    const ptr = P._malloc(bytes.length); P.HEAPU8.set(bytes, ptr);
    const doc = M.FPDF_LoadMemDocument(ptr, bytes.length, '');
    if (!doc) { P._free(ptr); throw new Error('PDFium could not open the file'); }
    return {
      render(index, dpi) {
        const page = M.FPDF_LoadPage(doc, index);
        const s = dpi / 72, w = Math.round(M.FPDF_GetPageWidthF(page) * s), h = Math.round(M.FPDF_GetPageHeightF(page) * s);
        const bmp = M.FPDFBitmap_Create(w, h, 0);
        M.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xFFFFFFFF);
        M.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, 0);
        const buf = M.FPDFBitmap_GetBuffer(bmp), stride = M.FPDFBitmap_GetStride(bmp);
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        const img = ctx.createImageData(w, h), H8 = P.HEAPU8;
        for (let y = 0; y < h; y++) { let src = buf + y * stride, dst = y * w * 4;
          for (let x = 0; x < w; x++, src += 4, dst += 4) { img.data[dst] = H8[src + 2]; img.data[dst + 1] = H8[src + 1]; img.data[dst + 2] = H8[src]; img.data[dst + 3] = 255; } }
        ctx.putImageData(img, 0, 0);
        M.FPDFBitmap_Destroy(bmp); M.FPDF_ClosePage(page);
        return canvas;
      },
      close() { M.FPDF_CloseDocument(doc); P._free(ptr); },
    };
  }

  /* ---------- PDF ---------- */
  async function readPdf(buf, log) {
    const bytes = new Uint8Array(buf.slice(0));
    let pdfiumDoc = null, pdfiumTried = false;
    const pdfjs = root.pdfjsLib;
    const doc = await pdfjs.getDocument({data: bytes.slice(0), isEvalSupported: false}).promise;
    const pages = [], jobs = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({scale: 1});
      const tc = await page.getTextContent();
      const words = [];
      for (const it of tc.items) {
        const s = it.str || ''; if (!s.trim()) continue;
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const fh = Math.hypot(it.transform[2], it.transform[3]) || it.height || 8;
        const cw = (it.width || fh * 0.5 * s.length) / Math.max(1, s.length);
        let idx = 0;
        for (const part of s.split(/(\s+)/)) {
          if (part && !/^\s+$/.test(part)) words.push({t: part, x0: x + idx * cw, x1: x + (idx + part.length) * cw, top: y - fh, bottom: y});
          idx += part.length;
        }
      }
      if (words.length >= 15) pages.push({title: 'Page ' + i, rows: wordsToRows(words, vp.width), kind: 'pdf'});
      else {
        if (log) log(`Recognising text on page ${i} of ${doc.numPages} (scanned page)…`);
        let canvas = null;
        if (!pdfiumTried) { pdfiumTried = true; try { pdfiumDoc = await pdfiumOpen(bytes); } catch (e) { console.warn('PDFium not available, using pdf.js', e); } }
        if (pdfiumDoc) { try { canvas = pdfiumDoc.render(i - 1, OPT.dpi); } catch (e) { console.warn(e); } }
        if (!canvas) {
          const v2 = page.getViewport({scale: OPT.dpi / 72});
          canvas = document.createElement('canvas'); canvas.width = Math.round(v2.width); canvas.height = Math.round(v2.height);
          const ctx = canvas.getContext('2d', {willReadFrequently: true});
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({canvasContext: ctx, viewport: v2}).promise;
        }
        const pg = {title: 'Page ' + i, rows: [], kind: 'scan'}; pages.push(pg);
        jobs.push(ocrCanvas(canvas).then(rows => { pg.rows = rows; }, e => { pg.error = 'Could not read this scanned page: ' + (e.message || e); }));
        if (jobs.length >= POOL_MAX) await Promise.race(jobs.map(j => j.then(() => {}, () => {})));   // keep memory small
      }
      page.cleanup();
    }
    await Promise.all(jobs);
    await doc.destroy();
    if (pdfiumDoc) pdfiumDoc.close();
    return pages;
  }
  async function readImage(file, log) {
    if (log) log('Recognising text in the image…');
    const bmp = await createImageBitmap(file);
    let w = bmp.width, h = bmp.height;
    if (w < 1800) { const f = 1800 / w; w = Math.round(w * f); h = Math.round(h * f); }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
    return [{title: 'Image', rows: await ocrCanvas(canvas), kind: 'scan'}];
  }

  const SUPPORTED = ['.xlsx', '.xlsm', '.xls', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.bmp', '.webp'];
  /* pages already read in this session are remembered (same file content = same result), so reading the same
     scan again – after "Start over" or with another document added – is instant */
  const CACHE = new Map();
  async function fileKey(buf) {
    try { const d = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
    catch (e) { return null; }
  }
  async function readDocument(file, log) {
    const name = file.name;
    const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!SUPPORTED.includes(ext)) throw new Error(`${name}: file type ${ext || '?'} is not supported. Use Excel, PDF or an image.`);
    if (log) log('Reading ' + name);
    const buf = await file.arrayBuffer();
    const key = ['.pdf', '.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(ext) ? await fileKey(buf) : null;
    let pages;
    if (key && CACHE.has(key)) { pages = JSON.parse(CACHE.get(key)); if (log) log(name + ': already read earlier – using that result'); }
    else {
      if (['.xlsx', '.xlsm', '.xls', '.csv'].includes(ext)) pages = readWorkbook(buf, name);
      else if (ext === '.pdf') pages = await readPdf(buf, log);
      else pages = await readImage(file, log);
      if (key && !pages.some(p => p.error)) { CACHE.set(key, JSON.stringify(pages)); while (CACHE.size > 30) CACHE.delete(CACHE.keys().next().value); }
    }
    pages.forEach((pg, i) => { pg.doc = name; pg.id = `${name}#${i}`; });
    return {name, pages};
  }
  root.CSD.R = {readDocument, readWorkbook, wordsToRows, removeTableLines, fmt, SUPPORTED, OPT, warm, POOL_MAX};
})(typeof self !== 'undefined' ? self : globalThis);
