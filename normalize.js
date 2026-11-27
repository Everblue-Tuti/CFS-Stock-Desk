/* Dates -> YYYY-MM-DD, times -> HH:MM (24 h). Day before month, as on Indian documents. Same rules as the desktop version. */
(function (root) {
  const MONTHS = {JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12};
  const pad = n => String(n).padStart(2, '0');
  function mk(y, m, d) {
    y = +y; if (y < 100) y += 2000; m = +m; d = +d;
    if (y < 1990 || y > 2100) return null;          // e.g. a mistyped year 0206: keep the text and let the checks flag it
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(dt) || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  function normDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    const s = String(v).trim().toUpperCase(); let m;
    if ((m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) return mk(m[1], m[2], m[3]);
    if ((m = s.match(/\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4}|\d{2})\b/))) return mk(m[3], m[2], m[1]);
    if ((m = s.match(/\b(\d{1,2})(?:ST|ND|RD|TH)?[\s\-/.,]*([A-Z]{3})[A-Z]*[\s\-/.,]*(\d{4}|\d{2})\b/)) && MONTHS[m[2]]) return mk(m[3], MONTHS[m[2]], m[1]);
    if ((m = s.match(/\b([A-Z]{3})[A-Z]*[\s\-/.]*(\d{1,2})(?:ST|ND|RD|TH)?[\s,]+(\d{4})\b/)) && MONTHS[m[1]]) return mk(m[3], MONTHS[m[1]], m[2]);
    if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) return mk(m[3], m[2], m[1]);
    return null;
  }
  function normTime(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
    if (typeof v === 'number' && v >= 0 && v < 1) { const mins = Math.round(v * 1440) % 1440; return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; }
    const s = String(v).trim().toUpperCase().replace(/HRS|HOURS/g, '').trim(); let m;
    if ((m = s.match(/\b(\d{1,2})(?:[:.](\d{2}))?(?:[:.]\d{2})?\s*([AP])\.?\s*M\.?(?![A-Z])/))) {
      let h = +m[1]; const mi = +(m[2] || 0);
      if (!(h >= 1 && h <= 12 && mi < 60)) return null;
      h = h % 12 + (m[3] === 'P' ? 12 : 0); return `${pad(h)}:${pad(mi)}`;
    }
    if ((m = s.match(/\b(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\b/)) && +m[1] < 24 && +m[2] < 60) return `${pad(+m[1])}:${m[2]}`;
    if ((m = s.match(/^(\d{2})(\d{2})$/)) && +m[1] < 24 && +m[2] < 60) return `${m[1]}:${m[2]}`;
    return null;
  }
  root.CSD = root.CSD || {}; Object.assign(root.CSD, {normDate, normTime});
})(typeof self !== 'undefined' ? self : globalThis);
