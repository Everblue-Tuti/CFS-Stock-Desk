/* CFS Stock Desk — screens. In the web app, every /api/ request is answered inside the browser (engine/server.js). */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let META = null;
const S = {cfs: '', files: [], job: null, docs: [], header: {}, hstatus: {}, hsrc: {}, items: [], totals: {}, pick: null,
  page: 0, extra: {}, shipper: '', source: '', rowErrors: [], sources: {}, need: {}, pageTypes: {}, stock: [], sel: new Set(), group: '', editing: null};

function user() { try { return localStorage.getItem('csd_user') || ''; } catch (e) { return ''; } }
async function api(path, opts = {}) {
  opts.headers = Object.assign({'X-User': user() || 'unknown'}, opts.headers || {});
  if (opts.json !== undefined) { opts.body = JSON.stringify(opts.json); opts.headers['Content-Type'] = 'application/json'; opts.method = opts.method || 'POST'; }
  const r = await fetch(path, opts);
  let data = null;
  try { data = await r.json(); } catch (e) { data = {}; }
  if (!r.ok) { const err = new Error(data.error || ('Server error ' + r.status)); err.data = data; err.status = r.status; throw err; }
  return data;
}
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function alertBox(text, btn = 'OK') {
  return new Promise(res => { const d = $('#alertDlg'); $('#alertText').textContent = text; const b = d.querySelector('button[value="ok"]'); if (b) b.textContent = btn; d.showModal(); d.addEventListener('close', () => res(), {once: true}); });
}
function confirmBox(text) {
  return new Promise(res => { const d = $('#confirmDlg'); $('#confirmText').textContent = text; d.returnValue = ''; d.showModal();
    d.addEventListener('close', () => res(d.returnValue === 'yes'), {once: true}); });
}
/* v16.1: a typed answer in the app's own dialog (no browser pop-up). opts: {password, twice, min} → text or null */
function promptBox(text, opts = {}) {
  return new Promise(res => {
    const d = $('#promptDlg'), a = $('#promptIn'), b = $('#promptIn2'), er = $('#promptErr');
    $('#promptText').textContent = text; a.type = opts.password ? 'password' : 'text'; a.value = ''; b.value = ''; b.hidden = !opts.twice; er.hidden = true;
    $('#promptOk').onclick = e => {
      const v = a.value;
      const bad = opts.min && v.length < opts.min ? `At least ${opts.min} characters.` : opts.twice && v !== b.value ? 'The two entries are not the same.' : '';
      if (bad) { e.preventDefault(); er.textContent = bad; er.hidden = false; }
    };
    d.returnValue = ''; d.showModal(); setTimeout(() => a.focus(), 30);
    d.addEventListener('close', () => res(d.returnValue === 'yes' && a.value ? a.value : null), {once: true});
  });
}
window.alertBox = alertBox; window.confirmBox = confirmBox; window.promptBox = promptBox;
const isNum = f => META.numeric.includes(f);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const showDate = v => { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}-${MON[+m[2] - 1]}-${m[1]}` : String(v); };
const fmtNum = (f, v) => v === null || v === undefined || v === '' ? '' : (f === 'Total CBM' ? (+v).toFixed(3) : f === 'Gross weight (kg)' ? (+v).toFixed(2) : (META && META.dates.includes(f)) ? showDate(v) : String(v));

/* ---------- input builder shared by review form, stock editor ---------- */
function inputFor(f, value, attrs = '') {
  const id = 'f_' + Math.random().toString(36).slice(2, 9);
  const v = value ?? '';
  if (META.selects[f]) {
    return `<select data-f="${esc(f)}" id="${id}" ${attrs}><option value=""></option>${META.selects[f].map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}${v && !META.selects[f].includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`;
  }
  let type = 'text', extra = '';
  if (META.dates.includes(f)) type = 'date';
  else if (META.times.includes(f)) type = 'time';
  else if (isNum(f)) { type = 'number'; extra = 'step="any" min="0"'; }
  const list = META.lists[f] ? `list="dl_${listId(f)}"` : '';
  return `<input type="${type}" data-f="${esc(f)}" id="${id}" value="${esc(v)}" ${extra} ${list} ${attrs} autocomplete="off">`;
}
const listId = f => f.replace(/[^A-Za-z0-9]/g, '');
function buildDatalists() {
  document.querySelectorAll('datalist').forEach(d => d.remove());
  for (const [f, vals] of Object.entries(META.lists)) {
    const dl = document.createElement('datalist'); dl.id = 'dl_' + listId(f);
    dl.innerHTML = vals.map(v => `<option value="${esc(v)}">`).join(''); document.body.appendChild(dl);
  }
}
function readVal(el) {
  const f = el.dataset.f; let v = el.value.trim();
  if (v === '') return '';
  if (isNum(f)) { const n = parseFloat(v); return isNaN(n) ? v : n; }
  if (!META.dates.includes(f) && !META.times.includes(f) && !META.selects[f]) v = v.toUpperCase();
  return v;
}

/* ---------- tabs ---------- */
function showTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'tab-' + name));
  if (name === 'stock') loadStock();
  if (name === 'formats') loadFormats();
}
$$('.tab').forEach(t => t.onclick = () => showTab(t.dataset.tab));

/* ---------- upload ---------- */
const OK_EXT = ['.pdf', '.xls', '.xlsx', '.xlsm', '.csv', '.jpg', '.jpeg', '.png', '.tif', '.tiff'];
/* v17.1: the file must really be what its name says (a renamed EXE / ZIP is refused) and not too big */
async function fileKind(f) {
  const b = new Uint8Array(await f.slice(0, 8).arrayBuffer()), h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  if (h.startsWith('25504446')) return 'pdf';                       // %PDF
  if (h.startsWith('504b0304')) return 'zip';                       // xlsx / xlsm (zip inside)
  if (h.startsWith('d0cf11e0a1b11ae1')) return 'xls';
  if (h.startsWith('89504e47')) return 'png';
  if (h.startsWith('ffd8ff')) return 'jpg';
  if (h.startsWith('49492a00') || h.startsWith('4d4d002a')) return 'tif';
  const t = new Uint8Array(await f.slice(0, 512).arrayBuffer()); return t.includes(0) ? 'bin' : 'text';
}
const KIND_OK = {'.pdf': ['pdf'], '.xlsx': ['zip'], '.xlsm': ['zip'], '.xls': ['xls', 'zip', 'text'], '.csv': ['text'], '.jpg': ['jpg'], '.jpeg': ['jpg'], '.png': ['png'], '.tif': ['tif'], '.tiff': ['tif']};
function slotOf(name) {
  const n = String(name).toUpperCase().replace(/[_\-.]+/g, ' ');
  if (/\bVDF\b|DELIVERY\s*NOTICE|CARGO\s*DELIVERY/.test(n)) return 'vdf';
  const pl = /PACK|PK\s*LIST|\bPL\b|P\s*L\s*IST/.test(n), inv = /\bINV|INVOICE/.test(n);
  return pl && inv ? 'both' : pl ? 'pl' : inv ? 'inv' : 'other';
}
async function addFiles(list, slot) {
  list = [...list];          // copy first: the file box is emptied right after this call starts (live FileList)
  for (const f of list) {
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!OK_EXT.includes(ext)) { toast(`${f.name}: use Excel, PDF or an image`); continue; }
    if (f.size > 60 * 1024 * 1024) { toast(`${f.name} is ${Math.round(f.size / 1048576)} MB – too big (60 MB at most). Ask for a smaller file or split it.`, 6000); continue; }
    const k = await fileKind(f);
    if (!(KIND_OK[ext] || []).includes(k)) { toast(`${f.name} is not a real ${ext.slice(1).toUpperCase()} file – not added.`, 6000); continue; }
    if (!S.files.some(x => x.name === f.name && x.size === f.size)) { f._slot = slot || slotOf(f.name); S.files.push(f); }
  }
  renderFiles();
}
function renderFiles() {
  /* v17.1: files shown in their slot (Invoice / Packing lists / VDF) + what is missing */
  const li = (f, i) => `<li>${esc(f.name)} <span class="muted small">${Math.ceil(f.size / 1024)} KB</span><button title="Remove" data-i="${i}">×</button></li>`;
  for (const s of ['inv', 'pl', 'vdf']) { const ul = $(`.slot[data-slot="${s}"] ul`); if (ul) ul.innerHTML = S.files.map((f, i) => [f, i]).filter(([f]) => f._slot === s || (f._slot === 'both' && s !== 'vdf')).map(([f, i]) => li(f, i)).join(''); }
  const chk = [], has = s => S.files.some(f => f._slot === s || (f._slot === 'both' && s !== 'vdf'));
  if (S.files.length) {
    if (!has('inv')) chk.push('No invoice added yet.');
    if (!has('pl')) chk.push('No packing list added yet.');
    const xy = {}; for (const f of S.files.filter(f => f._slot === 'pl' || f._slot === 'both')) { const m = String(f.name).toUpperCase().match(/\b(\d{1,2})\s*OF\s*(\d{1,2})\b/); if (m) { const y = +m[2]; (xy[y] = xy[y] || new Set()).add(+m[1]); } }
    for (const [y, got] of Object.entries(xy)) { const miss = []; for (let k = 1; k <= +y; k++) if (!got.has(k)) miss.push(k); if (miss.length) chk.push(`Packing list ${miss.join(', ')} of ${y} missing.`); }
    if (!has('vdf')) chk.push('No VDF added (Delivery No will be asked).');
  }
  $('#fileCheck').hidden = !chk.length; $('#fileCheck').innerHTML = chk.map(t => `<span>⚠ ${esc(t)}</span>`).join('');
  $$('.slot ul button').forEach(b => b.onclick = () => { S.files.splice(+b.dataset.i, 1); renderFiles(); });
  $('#fileList').innerHTML = S.files.map((f, i) => [f, i]).filter(([f]) => f._slot === 'other').map(([f, i]) => li(f, i)).join('');
  $$('#fileList button').forEach(b => b.onclick = () => { S.files.splice(+b.dataset.i, 1); renderFiles(); });
  $('#readBtn').disabled = !S.files.length; $('#clearFiles').hidden = !S.files.length;
}
$('#fileInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$$('.slot input[type=file]').forEach(inp => inp.onchange = e => { addFiles(e.target.files, inp.dataset.slot); e.target.value = ''; });
$('#clearFiles').onclick = () => { S.files = []; renderFiles(); };
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));

$('#readBtn').onclick = async () => {
  if (!user()) { $('#userName').focus(); toast('Enter your name first (top right)'); return; }
  if ($('#cfsSel') && !$('#cfsSel').value) { $('#cfsSel').focus(); toast('Choose this PC\'s CFS first (top right)'); return; }
  const fd = new FormData(); S.files.forEach(f => fd.append('files', f));
  $('#readBtn').disabled = true;
  try {
    const {job} = await api('/api/read', {method: 'POST', body: fd});
    startPolling(job);
  } catch (e) { toast(e.message); $('#readBtn').disabled = false; }
};
function startPolling(job) {
  S.job = job;
  $('#uploadCard').hidden = true; $('#review').hidden = true; $('#progress').hidden = false;
  $('#progTitle').textContent = 'Reading documents…'; $('#progLog').innerHTML = '';
  const tick = async () => {
    try {
      const j = await api('/api/job/' + job + (S.docs.length ? '' : '?docs=1'));
      $('#progLog').innerHTML = (j.log || []).map(l => `<li>${esc(l.at)} — ${esc(l.msg)}</li>`).join('');
      if (j.state === 'running') return setTimeout(tick, 1500);
      if (j.state === 'error') { $('#progTitle').textContent = 'Could not read the documents'; addRetry(); return; }
      const full = j.docs ? j : await api('/api/job/' + job + '?docs=1');
      openReview(full);
    } catch (e) { $('#progTitle').textContent = e.message; addRetry(); }
  };
  tick();
}
function addRetry() {
  const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Back'; b.onclick = resetRead; $('#progress').appendChild(b);
}
function resetRead() {
  S.lateEdited = false; S.cutoffTried = false;
  Object.assign(S, {files: [], job: null, docs: [], header: {}, hstatus: {}, hsrc: {}, items: [], totals: {}, pick: null, page: 0, extra: {}, rowErrors: [], sources: {}, need: {}, pageTypes: {}});
  renderFiles(); $('#uploadCard').hidden = false; $('#progress').hidden = true; $('#review').hidden = true;
  $('#saved').hidden = true; $('#saveErrors').hidden = true; $('#readBtn').disabled = true;
  $$('#progress > button').forEach(b => b.remove());
}
$('#startOver').onclick = resetRead;

/* ---------- review ---------- */
function openReview(j) {
  S.docs = j.docs || []; const r = j.result || {header: {}, header_status: {}, items: [], totals: {}};
  S.header = Object.assign({}, r.header); S.hstatus = Object.assign({}, r.header_status); S.hsrc = r.header_src || {};
  S.items = (r.items || []).map(x => Object.assign({}, x)); S.totals = r.totals || {}; S.shipper = j.shipper || S.header['Vendor Name'] || '';
  S.source = j.source; S.page = 0; S.rowErrors = [];
  $('#progress').hidden = true; $('#review').hidden = false; $('#saved').hidden = true;
  const known = j.source === 'profile';
  $('#srcChip').className = 'eyebrow ' + (known ? 'known' : 'new');
  $('#srcChip').textContent = known ? 'Known shipper – read with saved format' : j.source === 'auto' ? 'New shipper – read automatically, check the amber values' : (j.used_ai ? 'New shipper – suggested by local AI, please check' : 'New shipper – teach the format once');
  $('#shipperName').textContent = S.shipper || 'Shipper not recognised yet';
  $('#fileNames').textContent = (j.files || []).join(' · ');
  $('#askAi').hidden = !(META.ai && META.ai.model_ready);
  S.sources = Object.assign({}, j.sources || {}); S.need = Object.assign({}, j.need || {}); S.pageTypes = j.page_types || {};
  S.hasPL = !!j.has_packing; S.plNA = false; S.damage = [];
  $('#plBanner').hidden = !(isTut() && !S.hasPL); $('#plNA').checked = false;
  if (!S.items.length) S.items.push({});
  renderHeader(); renderItems(); renderExtra(); renderNeeds(); renderViewer(); renderColset();
  if (S.docs.length && S.items[0] && S.items[0]._src && S.items[0]._src.Style) goToSrc(S.items[0]._src.Style, false);
}
/* Tuticorin sites (GAP report): GAP names, the invoice fields and the hand-entered fields in GAP order */
function isTut() { return (META.tuticorin || []).includes(String(S.header['Warehouse ID'] || META.site_lock || META.warehouse || '').toUpperCase()); }
function lab(f) { return (isTut() && (META.gap_label || {})[f]) || f; }
const ITEM_SHOWN = () => isTut() ? META.tut_items : META.item_fields;
const HEADER_SHOWN = () => isTut() ? ['Warehouse ID', ...META.tut_doc_header] : ['GroupName', 'Customer Name', 'Customer Code', 'Customer Type', 'Vendor Name', 'Shipper invoice number', 'Invoice Date', 'Consignee',
  'Port of Discharge', 'FPD', 'Cargo Description', 'Package UOM', 'IEC', 'CIN', 'Booking Number', 'Warehouse ID'];
/* mandatory columns: by site (Tuticorin = GAP set incl. carting), minus what this shipper does not need */
const ALWAYS_NEEDED = ['Warehouse ID', 'Vendor Name', 'Style', 'Shipper invoice number'];
function requiredList(site) { return ((META.required_by_site || {})[site || S.header['Warehouse ID'] || META.warehouse] || META.required).filter(f => f !== 'Entry Date'); }
function isReq(f, need = S.need) { return requiredList().includes(f) && (ALWAYS_NEEDED.includes(f) || (need || {})[f] !== 'no'); }
function statusOf(f, v, st) {
  if (st === 'edited' || st === 'picked') return 'st-picked';
  if (st && st.startsWith('cha-')) return 'st-default';
  if (v === '' || v === null || v === undefined) return isReq(f) ? 'st-missing' : '';
  return st ? 'st-' + st : '';
}
function fieldHtml(f, v, st, scope, extraAttrs = '') {
  const req = isReq(f) ? 'req' : '';
  return `<div class="fld"><label><span class="${req}">${esc(lab(f))}</span><button class="pickbtn" type="button" data-pick="${esc(f)}" data-scope="${scope}" title="Pick this value in the document">Pick</button></label>
    <div class="in">${inputFor(f, v, `class="${statusOf(f, v, st)}" data-scope="${scope}" ${extraAttrs}`)}</div></div>`;
}
function renderHeader() {
  if (META.site_lock) { S.header['Warehouse ID'] = META.site_lock; S.hstatus['Warehouse ID'] = 'fixed'; }
  $('#headerForm').innerHTML = HEADER_SHOWN().map(f => fieldHtml(f, S.header[f], S.hstatus[f], 'h')).join('');
  $$('#headerForm [data-f]').forEach(el => {
    el.addEventListener('change', () => {
      const f = el.dataset.f; S.header[f] = readVal(el); S.hstatus[f] = 'edited';
      if (f === 'Customer Name') fillCustomer();
      el.className = statusOf(f, S.header[f], 'edited'); renderNeeds();
    });
    el.addEventListener('focus', () => { if (S.hsrc[el.dataset.f]) goToSrc(S.hsrc[el.dataset.f]); });
  });
  bindPickButtons('#headerForm');
  if (META.site_lock) { const w = $('#headerForm [data-f="Warehouse ID"]'); if (w) { w.disabled = true; w.title = 'Fixed for this site'; const b = w.closest('.fld').querySelector('.pickbtn'); if (b) b.hidden = true; } }
}
function fillCustomer() {
  const m = META.customers[(S.header['Customer Name'] || '').toUpperCase()];
  if (!m) return;
  for (const [f, v] of Object.entries(m)) if (!S.header[f] && v) { S.header[f] = v; S.hstatus[f] = 'default'; }
  renderHeader();
}
function itemStatus(row, f) {
  if (row._st && row._st[f]) return row._st[f];
  if (row._ai && row._ai[f]) return row._ai[f];
  if (row._src && row._src[f]) return 'profile';
  return '';
}
function renderItems() {
  if (S.docs && S.docs.length) { renderTrain(); loadPicks(); }
  const F = ITEM_SHOWN(), M = (META.manual_item || []).filter(f => !F.includes(f));
  const tut = isTut(), anyDiff = S.items.some(r => r._diff && Object.keys(r._diff).length);
  let h = '<thead><tr><th>#</th>' + F.map(f => `<th class="${isNum(f) ? 'num' : ''}"><span class="${isReq(f) ? 'req' : ''}">${esc(lab(f))}</span></th>`).join('') +
    M.map(f => `<th class="num manual" title="Entered by hand at the CFS"><span class="${isReq(f) ? 'req' : ''}">${esc(lab(f))}</span><div class="small">enter by hand</div></th>`).join('') +
    (tut ? (META.truck_flow ? '' : '<th class="chk manual"><span class="req">Pkgs &amp; CBM checked</span></th>') + (anyDiff ? '<th class="chk"><span class="req">Packing list difference checked</span></th>' : '') : '') + '<th></th></tr></thead><tbody>';
  S.items.forEach((row, i) => {
    h += `<tr><td class="muted">${i + 1}</td>` + F.map(f => {
      const v = row[f] ?? ''; const err = (S.rowErrors[i] || []).some(w => w.field === f) ? ' has-err' : '';
      const d = row._diff && row._diff[f] !== undefined ? row._diff[f] : undefined;
      const cls = d !== undefined ? 'st-diff' : statusOf(f, v, itemStatus(row, f));
      return `<td><div class="cellwrap">${inputFor(f, v, `class="${cls}${err}" data-row="${i}" data-scope="i"${d !== undefined ? ` title="Packing list: ${esc(v)} · Invoice: ${esc(d)}"` : ''}`)}<button class="pickbtn" type="button" data-pick="${esc(f)}" data-scope="i" data-row="${i}" title="Pick in document">⌖</button></div>${d !== undefined ? `<div class="diffnote">Invoice: ${esc(d)}</div>` : ''}</td>`;
    }).join('') + M.map(f => {
      let v = row[f] ?? '', cls = row._st && row._st[f] ? 'st-picked' : '';
      if (f === 'Received Pkgs' && v === '') { v = row['Total Packages'] ?? ''; cls = 'st-default'; }       // same as booked until changed
      const err = (S.rowErrors[i] || []).some(w => w.field === f) ? ' has-err' : '';
      return `<td class="manual">${inputFor(f, v, `class="${cls}${err}" data-row="${i}" data-scope="m"`)}</td>`;
    }).join('') + (tut ? (META.truck_flow ? '' : `<td class="chk manual${row._chkPkgs ? '' : ' todo'}"><input type="checkbox" data-chk="pkgs" data-row="${i}" ${row._chkPkgs ? 'checked' : ''} title="I have checked the received cartons and CBM of this row"></td>`) +
      (anyDiff ? `<td class="chk${row._diff && Object.keys(row._diff).length && !row._chkDiff ? ' todo' : ''}">${row._diff && Object.keys(row._diff).length ? `<input type="checkbox" data-chk="diff" data-row="${i}" ${row._chkDiff ? 'checked' : ''} title="I have checked the values that differ between packing list and invoice">` : ''}</td>` : '') : '') + `<td><button class="btn small" data-del="${i}" title="Remove row">×</button></td></tr>`;
  });
  $('#itemTable').innerHTML = h + '</tbody>';
  $$('#itemTable [data-f]').forEach(el => {
    el.addEventListener('change', () => {
      const i = +el.dataset.row, f = el.dataset.f; S.items[i][f] = readVal(el);
      (S.items[i]._st = S.items[i]._st || {})[f] = 'edited';
      el.className = el.dataset.scope === 'm' ? 'st-picked' : statusOf(f, S.items[i][f], 'edited'); renderTotals(); renderNeeds();
      if (f === 'Total Packages') { const rc = $(`#itemTable [data-row="${i}"][data-f="Received Pkgs"]`); if (rc && rc.classList.contains('st-default')) rc.value = S.items[i][f] ?? ''; }
      if (f === 'Received Pkgs' || f === 'Total Packages') { checkOsd(); renderDamage(); }
      if (el.dataset.scope === 'i' && S.items[i]._diff && S.items[i]._diff[f] !== undefined) el.classList.add('st-diff');
      if (f === 'Gross weight (kg)' || f === 'Net weight (kg)') checkWeights(i);
    });
    if (el.dataset.scope !== 'm') el.addEventListener('focus', () => { const r = S.items[+el.dataset.row]; if (r._src && r._src[el.dataset.f]) goToSrc(r._src[el.dataset.f]); });
  });
  $$('#itemTable [data-chk]').forEach(el => el.onchange = () => { S.items[+el.dataset.row][el.dataset.chk === 'pkgs' ? '_chkPkgs' : '_chkDiff'] = el.checked; el.closest('td').classList.toggle('todo', !el.checked); });
  $$('#itemTable [data-del]').forEach(b => b.onclick = () => { S.items.splice(+b.dataset.del, 1); if (!S.items.length) S.items.push({}); renderItems(); renderNeeds(); });
  bindPickButtons('#itemTable');
  renderTotals();
}
$('#addRow').onclick = () => {
  const last = S.items[S.items.length - 1] || {};
  S.items.push({'PO Number': last['PO Number'] || ''}); renderItems(); renderNeeds();
};
function renderTotals() {
  const nf = ['Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)'];
  $('#totals').innerHTML = nf.map(f => {
    const sum = S.items.reduce((a, r) => a + (parseFloat(r[f]) || 0), 0);
    const t = S.totals[f]; const same = t && Math.abs(t.sum - sum) < Math.max(0.006, sum * 0.002);
    let cls = '', note = '';
    if (t && same && t.found) { cls = 'ok'; note = ' ✓ matches a total in the document'; }
    else if (t && same && !t.found) { cls = ''; note = ' (no grand total printed to compare)'; }
    return `<span class="tot ${cls}" ${t && t.found && same ? `data-goto='${esc(JSON.stringify([t.found.page, t.found.row, t.found.cell]))}' style="cursor:pointer"` : ''}>${esc(f)}: <b>${fmtNum(f, Math.round(sum * 1000) / 1000)}</b>${note}</span>`;
  }).join('');
  $$('#totals [data-goto]').forEach(el => el.onclick = () => goToSrc(JSON.parse(el.dataset.goto)));
}
/* Customs & carting part of the reading screen (entered by hand) */
const OSD_DEP = ['OSD type', 'Total OSD cartons', 'OSD Remarks'];        // shown when OSD = Yes
const itemsTotal = f => Math.round(S.items.reduce((a, r) => a + (parseFloat(r[f]) || 0), 0) * 1000) / 1000;
const HINT = {'cha-list': 'from the Shipper & CHA list – change if needed', 'cha-past': 'used for this shipper last time – change if needed', 'cut-last': 'last cut-off typed for this customer – check it'};
const todayStr = () => window.CSD.ist.date();
const nowStr = () => window.CSD.ist.time();
const xval = f => S.extra[f] ?? S.header[f];
function manualGroups() {
  if (isTut()) return META.tut_manual;
  const off = META.truck_flow ? ((META.offload || {}).all || []) : [];
  const gs = META.groups.filter(g => g[0] !== 'Shipment (from documents)').map(([g, fs]) => [g, fs.filter(f => !(META.manual_item || []).includes(f) && !off.includes(f) && !['Offloading Date', 'Offloading Start Time', 'Offloading END Time', 'SORTED/UN SORTED', 'Sorting Done by APLL', 'Carting Remark', 'Articles', 'Load_Status'].includes(f))]).filter(([, fs]) => fs.length);
  if (META.truck_flow) { const c = gs.find(([g]) => g === 'Carting') || gs[gs.length - 1]; for (const f of ['Cargo Cutoff Date', 'Cargo Cutoff Time', 'Late Cargo']) if (!c[1].includes(f)) c[1].push(f); }
  return gs;
}
function renderExtra() {
  /* cargo cut-off: suggest the one last typed for this customer (same booking usually) */
  if (META.truck_flow && !S.cutoffTried) {
    S.cutoffTried = true;
    try { const c = JSON.parse(localStorage.getItem('csd_cutoff_' + String(S.header['Customer Name'] || '').toUpperCase()) || 'null');
      if (c && c.date >= todayStr() && S.extra['Cargo Cutoff Date'] === undefined) { S.extra['Cargo Cutoff Date'] = c.date; S.extra['Cargo Cutoff Time'] = c.time; S.hstatus['Cargo Cutoff Date'] = S.hstatus['Cargo Cutoff Time'] = 'cut-last'; } } catch (e) {}
  }
  const groups = manualGroups();
  const reqExtra = groups.some(([, fs]) => fs.some(f => isReq(f)));
  $('#extraBox').open = true;
  $('#extraBox summary h3').firstChild.textContent = META.truck_flow ? 'Customs, truck & cargo cut-off (enter by hand) ' : isTut() ? 'Customs, carting & OSD (enter by hand) ' : 'Customs & carting details ';
  $('#extraBox summary .muted').textContent = reqExtra ? '(fields marked * are required for this site)' : '(optional now – can be added later in Stock)';
  const osdYes = String(xval('OSD') || '').toUpperCase() === 'YES';
  const field = f => {
    const v = xval(f), st = S.extra[f] !== undefined ? 'edited' : S.hstatus[f];
    const empt = v === undefined || v === null || v === '';
    const cls = st && st.startsWith('cha-') ? 'st-default' : (st && st !== 'edited' && !empt ? statusOf(f, v, st) : (empt && (isReq(f) || f === 'OSD') ? 'st-todo' : ''));
    const quick = META.dates.includes(f) ? `<button type="button" class="btn small" data-today="${esc(f)}">Today</button>` : META.times.includes(f) ? `<button type="button" class="btn small" data-now="${esc(f)}">Now</button>` : '';
    const hint = HINT[st] ? `<div class="muted small">${esc(HINT[st])}</div>`
      : f === 'OSD' ? '<div class="muted small">Overage / Shortage / Damage – choose for every shipment. Set to Yes by itself when the received cartons differ from the booked cartons.</div>' : '';
    const dep = OSD_DEP.includes(f);
    return `<div class="fld${dep ? ' osd-dep' : ''}"${dep && !osdYes ? ' hidden' : ''}><label><span class="${isReq(f) || f === 'OSD' ? 'req' : ''}">${esc(lab(f))}</span></label><div class="in cellwrap">${inputFor(f, v, `data-scope="x" class="${cls}"`)}${quick}</div>${hint}</div>`;
  };
  $('#extraForm').innerHTML = groups.map(([g, fs]) => `<fieldset><legend>${esc(g)}</legend><div class="form-grid">${fs.map(field).join('')}</div></fieldset>`).join('') +
    (META.truck_flow ? '<p class="muted small">These values are applied to every item row of this shipment. Saving puts the truck on the <b>Truck report</b> (waiting to offload). Received cartons, bay, labour, OSD and damage are entered when you click <b>Offloaded</b>. Late Cargo is set by itself from the arrival and cut-off – change it if needed.</p>'
      : '<p class="muted small">These values are applied to every item row of this shipment. Received Pkgs and Actual CBM are entered per row in the items table above.</p>');
  $$('#extraForm [data-f]').forEach(el => el.addEventListener('change', async () => {
    const f = el.dataset.f; S.extra[f] = readVal(el);
    el.className = (S.extra[f] === '' || S.extra[f] === null) && (isReq(f) || f === 'OSD') ? 'st-todo' : '';
    if (f === 'Any Damage') { if (String(S.extra[f]).toUpperCase() === 'YES' && !S.damage.length) S.damage.push({}); renderDamage(); }
    if (META.truck_flow && ['Allow Date', 'Allow Time', 'Cargo Cutoff Date', 'Cargo Cutoff Time'].includes(f) && !S.lateEdited) {
      const r0 = {'Allow Date': xval('Allow Date') || todayStr(), 'Allow Time': xval('Allow Time') || nowStr(), 'Cargo Cutoff Date': xval('Cargo Cutoff Date'), 'Cargo Cutoff Time': xval('Cargo Cutoff Time')};
      const late = window.CSD.F.lateCargo(r0); const le = $('#extraForm [data-f="Late Cargo"]'); if (late && le) { S.extra['Late Cargo'] = late; le.value = late; le.className = late === 'Yes' ? 'st-diff' : ''; }
    }
    if (f === 'Late Cargo') S.lateEdited = true;
    if (f === 'OSD Remarks') renderDamage();
    if (f === 'OSD') {
      if (String(S.extra.OSD).toUpperCase() !== 'YES' && osdRows().length) {
        await alertBox(`Received cartons differ from the booked cartons (${osdRows().map(r => `${r.Style}: ${r['Received Pkgs']} of ${r['Total Packages']}`).join(', ')}). This is OSD – it must be "Yes".`);
        S.extra.OSD = 'Yes'; el.value = 'Yes';
      }
      $$('#extraForm .osd-dep').forEach(x => x.hidden = String(S.extra.OSD).toUpperCase() !== 'YES');
    }
  }));
  if (isTut() && !META.truck_flow) {
    const box = document.createElement('div'); box.id = 'dmgBox'; box.className = 'dmg';
    const fs = [...$$('#extraForm fieldset')].pop(); fs.appendChild(box); renderDamage();
  }
  $$('#extraForm [data-today]').forEach(b => b.onclick = () => { const el = $(`#extraForm [data-f="${b.dataset.today}"]`); el.value = todayStr(); el.dispatchEvent(new Event('change')); });
  $$('#extraForm [data-now]').forEach(b => b.onclick = () => { const el = $(`#extraForm [data-f="${b.dataset.now}"]`); el.value = nowStr(); el.dispatchEvent(new Event('change')); });
}
/* damage lines (Tuticorin): PO, style, colour from the shipment's rows; size, cartons, type, remark typed / chosen */
const ctnCount = s => String(s || '').split(/[,;\s]+/).filter(Boolean).reduce((n, p) => { const m = p.match(/^(\d+)\s*[-–]\s*(\d+)$/); return n + (m ? Math.max(1, Math.abs(+m[2] - +m[1]) + 1) : 1); }, 0);
function renderDamage() {
  const box = $('#dmgBox'); if (!box) return;
  const yes = String(xval('Any Damage') || '').toUpperCase() === 'YES';
  const rows = S.items.filter(r => r.Style);
  const uniq = a => [...new Set(a.filter(x => x !== undefined && x !== null && x !== '').map(String))];
  const opt = (list, v) => `<option value=""></option>` + list.map(x => `<option ${String(v ?? '') === x ? 'selected' : ''}>${esc(x)}</option>`).join('');
  let h = '';
  if (yes) {
    h += `<div class="table-wrap"><table class="grid"><thead><tr><th><span class="req">PO. No</span></th><th><span class="req">Style No</span></th><th>Colour</th><th>Size</th><th><span class="req">Carton no(s)</span></th><th><span class="req">Damage type</span></th><th>Remark</th><th></th></tr></thead><tbody>` +
      S.damage.map((l, i) => {
        const pos = uniq(rows.map(r => r['PO Number'])), sts = uniq(rows.filter(r => !l.po || String(r['PO Number']) === String(l.po)).map(r => r.Style));
        const cols = uniq(rows.filter(r => (!l.po || String(r['PO Number']) === String(l.po)) && (!l.style || String(r.Style) === String(l.style))).map(r => r.Colour));
        return `<tr><td><select data-dl="${i}" data-k="po">${opt(pos, l.po)}</select></td><td><select data-dl="${i}" data-k="style">${opt(sts, l.style)}</select></td>
          <td>${cols.length ? `<select data-dl="${i}" data-k="colour">${opt(cols, l.colour)}</select>` : `<input data-dl="${i}" data-k="colour" value="${esc(l.colour || '')}">`}</td>
          <td><input data-dl="${i}" data-k="size" value="${esc(l.size || '')}" style="width:70px"></td>
          <td><input data-dl="${i}" data-k="cartons" value="${esc(l.cartons || '')}" placeholder="12, 15, 20-22"><div class="muted small">${l.cartons ? ctnCount(l.cartons) + ' carton(s)' : ''}</div></td>
          <td><select data-dl="${i}" data-k="type">${opt(META.damage_types || [], l.type)}</select></td>
          <td><input data-dl="${i}" data-k="remark" value="${esc(l.remark || '')}" placeholder="${l.type === 'Others' ? 'required for Others' : ''}"></td>
          <td><button type="button" class="btn small" data-dldel="${i}">×</button></td></tr>`;
      }).join('') + `</tbody></table></div><button type="button" class="btn small" id="dmgAdd">+ Add damage line</button>`;
  }
  // OSD of each row, as it will be saved
  const parts = rows.map(r => {
    const tp = +r['Total Packages'] || 0, rc = r['Received Pkgs'] === undefined || r['Received Pkgs'] === '' ? tp : +r['Received Pkgs'];
    const dc = yes ? S.damage.filter(l => String(l.po) === String(r['PO Number']) && String(l.style) === String(r.Style)).reduce((n, l) => n + ctnCount(l.cartons), 0) : 0;
    const t = [rc < tp ? `shortage ${tp - rc}` : rc > tp ? `overage ${rc - tp}` : '', dc ? `damage ${dc}` : ''].filter(Boolean);
    return t.length ? `${r.Style}${r['PO Number'] ? ' / PO ' + r['PO Number'] : ''}: ${t.join(', ')} ctn(s)` : null;
  }).filter(Boolean);
  h = `<div class="osdline">OSD: ${parts.length ? 'YES – ' + esc(parts.join(' · ')) : (xval('Any Damage') ? 'NO (cartons match, no damage)' : '— answer "Any damaged cartons?"')}</div>` + h;
  box.innerHTML = h;
  $$('#dmgBox [data-dl]').forEach(el => el.onchange = () => { const l = S.damage[+el.dataset.dl]; l[el.dataset.k] = el.value; if (el.dataset.k === 'po') { l.style = ''; l.colour = ''; } if (el.dataset.k === 'style') l.colour = ''; renderDamage(); });
  $$('#dmgBox [data-dldel]').forEach(b => b.onclick = () => { S.damage.splice(+b.dataset.dldel, 1); renderDamage(); });
  const add = $('#dmgAdd'); if (add) add.onclick = () => { S.damage.push({}); renderDamage(); };
}
/* rows whose received cartons (entered) differ from the booked cartons */
const osdRows = () => S.items.filter(r => r.Style && r['Received Pkgs'] !== undefined && r['Received Pkgs'] !== '' && r['Total Packages'] !== undefined && r['Total Packages'] !== '' && +r['Received Pkgs'] !== +r['Total Packages']);
function checkOsd() {
  const rows = osdRows();
  if (rows.length && String(S.extra.OSD || '').toUpperCase() !== 'YES') {
    S.extra.OSD = 'Yes';
    const sel = $('#extraForm [data-f="OSD"]'); if (sel) { sel.value = 'Yes'; sel.className = ''; }
    $$('#extraForm .osd-dep').forEach(x => x.hidden = false);
    toast('Received cartons differ from the booked cartons – OSD set to "Yes". Add the OSD remark.', 5000);
  }
}
/* gross weight must not be less than the nett weight */
async function checkWeights(i) {
  const r = S.items[i], g = parseFloat(r['Gross weight (kg)']), n = parseFloat(r['Net weight (kg)']);
  if (g && n && n > g) {
    $$(`#itemTable [data-row="${i}"][data-f="Gross weight (kg)"], #itemTable [data-row="${i}"][data-f="Net weight (kg)"]`).forEach(el => el.classList.add('has-err'));
    await alertBox(`Row ${i + 1} (${r.Style || 'no style'}): Gross weight ${g} is less than the Nett weight ${n}. Please check the document and correct the weights.`, 'OK – I will correct it');
  }
}
function renderNeeds() {
  const need = [];
  for (const f of HEADER_SHOWN()) {
    const st = S.hstatus[f]; const v = S.header[f];
    if ((isReq(f) && (v === '' || v === undefined || v === null)) || st === 'ai-check') need.push({f, scope: 'h', label: lab(f) + (st === 'ai-check' ? ' (check)' : '')});
  }
  S.items.forEach((r, i) => ITEM_SHOWN().forEach(f => {
    const v = r[f]; const st = itemStatus(r, f);
    if ((isReq(f) && (v === '' || v === undefined || v === null)) || st === 'ai-check')
      need.push({f, scope: 'i', row: i, label: `Row ${i + 1}: ${lab(f)}` + (st === 'ai-check' ? ' (check)' : '')});
  }));
  $('#needs').hidden = !need.length;
  $('#needList').innerHTML = need.slice(0, 40).map(n => `<li><button data-pick="${esc(n.f)}" data-scope="${n.scope}" ${n.row !== undefined ? `data-row="${n.row}"` : ''}>${esc(n.label)} – Pick</button></li>`).join('') + (need.length > 40 ? `<li class="muted small">and ${need.length - 40} more</li>` : '');
  bindPickButtons('#needList');
}

/* ---------- pick from document ---------- */
function bindPickButtons(root) {
  $$(root + ' [data-pick]').forEach(b => b.onclick = () => startPick({field: b.dataset.pick, scope: b.dataset.scope, row: b.dataset.row !== undefined ? +b.dataset.row : null}));
}
function startPick(p) {
  S.pick = p; $('#pageView').classList.add('picking');
  $('#pickBanner').hidden = false;
  $('#pickBanner').innerHTML = `<span>Click the value for <b>${esc(p.field)}</b>${p.row !== null ? ' (row ' + (p.row + 1) + ')' : ''} in the document below.</span><button type="button" id="cancelPick">Cancel</button>`;
  $('#cancelPick').onclick = stopPick;
  $$('.pickbtn').forEach(b => b.classList.toggle('active', b.dataset.pick === p.field && b.dataset.scope === p.scope && String(b.dataset.row ?? '') === String(p.row ?? '')));
  $('.right').scrollIntoView({block: 'nearest', behavior: 'smooth'});
}
function stopPick() { S.pick = null; $('#pageView').classList.remove('picking'); $('#pickBanner').hidden = true; $$('.pickbtn.active').forEach(b => b.classList.remove('active')); }
const MONTHS = {JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12};
function mkDate(y, m, d) {
  y = +y; if (y < 100) y += 2000; m = +m; d = +d;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/* '23.10.2026', '23/Oct/2026', '2026-10-23' -> '2026-10-23' (day before month, as on Indian documents) */
function normDate(t) {
  const s = String(t).toUpperCase(); let m;
  if ((m = s.match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/))) return mkDate(m[1], m[2], m[3]);
  if ((m = s.match(/\b(\d{1,2})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{4}|\d{2})\b/))) return mkDate(m[3], m[2], m[1]);
  if ((m = s.match(/\b(\d{1,2})(?:ST|ND|RD|TH)?[\s\-\/.,]*([A-Z]{3})[A-Z]*[\s\-\/.,]*(\d{4}|\d{2})\b/)) && MONTHS[m[2]]) return mkDate(m[3], MONTHS[m[2]], m[1]);
  if ((m = s.match(/\b([A-Z]{3})[A-Z]*[\s\-\/.]*(\d{1,2})(?:ST|ND|RD|TH)?[\s,]+(\d{4})\b/)) && MONTHS[m[1]]) return mkDate(m[3], MONTHS[m[1]], m[2]);
  return null;
}
/* '12:00 PM', '1430 HRS', '14:30:00' -> 'HH:MM' */
function normTime(t) {
  const s = String(t).toUpperCase().replace(/HRS|HOURS/g, '').trim(); let m;
  if ((m = s.match(/\b(\d{1,2})(?:[:.](\d{2}))?(?:[:.]\d{2})?\s*([AP])\.?\s*M\.?\b/))) {
    let h = +m[1], mi = +(m[2] || 0); if (h < 1 || h > 12 || mi > 59) return null;
    h = h % 12 + (m[3] === 'P' ? 12 : 0); return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  if ((m = s.match(/\b(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\b/)) && +m[1] < 24 && +m[2] < 60) return `${m[1].padStart(2, '0')}:${m[2]}`;
  if ((m = s.match(/^(\d{2})(\d{2})$/)) && +m[1] < 24 && +m[2] < 60) return `${m[1]}:${m[2]}`;
  return null;
}
function cleanPicked(f, t) {
  if (META.dates.includes(f)) return normDate(t);
  if (META.times.includes(f)) return normTime(t);
  if (isNum(f)) {
    const m = String(t).replace(/[$₹]/g, '').match(/-?\d[\d,]*(?:\.\d+)?/);
    if (!m) return null;
    let s = m[0];
    if (s.includes(',') && !s.includes('.') && /^\d+,\d{3}$/.test(s) && (f === 'Gross weight (kg)' || f === 'Total CBM')) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    return parseFloat(s);
  }
  if (f === 'Qty Type') return window.CSD.V.qtyType(t) || null;     // CRTNS → CARTONS
  let v = String(t).replace(/\s+/g, ' ').trim().replace(/^[:;(\[\s]+|[:;)\]\s]+$/g, '');
  if (['Shipper invoice number', 'PO Number', 'Style', 'IEC', 'Booking Number', 'Shipping Bill Number'].includes(f)) v = v.replace(/\s+/g, '');
  return v.toUpperCase();
}
function onCellClick(pageId, ri, ci, text) {
  if (!S.pick) return;
  const {field, scope, row} = S.pick; const v = cleanPicked(field, text);
  if (v === null) { toast(META.dates.includes(field) ? 'That cell has no date in it' : META.times.includes(field) ? 'That cell has no time in it' : 'That cell has no number in it'); return; }
  const ref = [pageId, ri, ci];
  if (scope === 'h') { S.header[field] = v; S.hstatus[field] = 'picked'; S.hsrc[field] = ref; if (field === 'Customer Name') fillCustomer(); renderHeader(); }
  else if (field === 'Qty Type') setQtyType(v);
  else if (window.CSD.P.PICK_FIELDS.includes(field) && trainPick(field, row, ref, v)) { /* whole column filled and saved for the shipper */ }
  else { const r = S.items[row]; r[field] = v; (r._st = r._st || {})[field] = 'picked'; (r._src = r._src || {})[field] = ref; renderItems(); }
  stopPick(); renderNeeds(); highlightSrc();
  if (window.CSD.wiz) window.CSD.wiz.refresh();
}
/* ---------- v15.1 Pick training: pick once in any row → the whole column for every row, saved for this shipper ---------- */
const shipperName = () => String(S.header['Vendor Name'] || '').trim().toUpperCase();
/* v16.3: Type is not printed per line – a picked / typed Type goes to every line and is this shipper's default */
function setQtyType(raw) {
  const v = window.CSD.V.qtyType(raw), list = META.selects['Qty Type'] || [];
  if (!list.includes(v)) { toast(`"${raw}" is not a Type. Choose one of: ${list.join(', ')}.`, 5000); return false; }
  S.items.forEach(it => { it['Qty Type'] = v; (it._st = it._st || {})['Qty Type'] = 'edited'; if (it._src) delete it._src['Qty Type']; });
  const sh = shipperName();
  if (sh) api('/api/profile/pick', {json: {shipper: sh, field: 'Qty Type', fixed: v}}).then(() => toast(`Type = ${v} for all ${S.items.length} line(s) – remembered for ${sh}.`, 5000)).catch(e => toast(e.message, 5000));
  renderItems(); return true;
}
function trainPick(field, row, ref, v) {
  const P = window.CSD.P, spec = P.pickSpec(S.docs, ref, field); if (!spec) return false;
  const vals = P.pickValues(S.docs, Object.assign({}, spec, {field}));
  const at = vals.findIndex(x => x.src[0] === ref[0] && x.src[1] === ref[1] && x.src[2] === ref[2]);
  if (at < 0) return false;                         // no repeating pattern found: only this cell is filled
  /* the picked place is value number "at"; put it in the row the operator picked, the others around it */
  /* PO printed once for a group of style lines: give every line the PO printed above it */
  if (['PO Number', 'Delivery No'].includes(field) && S.items.some(it => it._src && it._src.Style)) {
    const keys = S.items.map(it => ({src: it._src && it._src.Style}));
    if (keys.every(k => k.src)) { const al = P.alignGroup(S.docs, keys, vals);
      al.forEach((x, k) => { const it = S.items[k]; it[field] = x.v; (it._st = it._st || {})[field] = 'picked'; (it._src = it._src || {})[field] = x.src; });
      const sh = shipperName(); renderItems(); if (sh) savePick(sh, field, spec, al.length); else S.pendingPicks = Object.assign(S.pendingPicks || {}, {[field]: spec}); return true; }
  }
  const start = row - at; if (start < 0) return false;
  /* only Style / PO may add rows; other columns fill the rows that are there (extra places found are ignored) */
  if (['Style', 'PO Number'].includes(field)) while (S.items.length < start + vals.length) S.items.push({'PO Number': (S.items[S.items.length - 1] || {})['PO Number'] || ''});
  vals.forEach((x, k) => { const it = S.items[start + k]; if (!it) return; it[field] = x.v; (it._st = it._st || {})[field] = 'picked'; (it._src = it._src || {})[field] = x.src; });
  const sh = shipperName();
  renderItems();
  if (!sh) { toast(`${lab(field)}: ${vals.length} row(s) filled. Fill in the shipper (Vendor Name) so the app can remember it.`, 6000); S.pendingPicks = Object.assign(S.pendingPicks || {}, {[field]: spec}); return true; }
  savePick(sh, field, spec, vals.length);
  return true;
}
async function savePick(sh, field, spec, n) {
  try { const r = await api('/api/profile/pick', {json: {shipper: sh, field, spec}}); S.picks = r.picks; S.picksFor = sh; renderTrain();
    toast(`${lab(field)}: ${n} row(s) filled from the ${TYPE_LABEL[spec.type] || 'document'} – saved for ${sh}. Next time it is filled by itself.`, 6000); }
  catch (e) { toast(e.message, 6000); }
}
const TRAIN = ['PO Number', 'Style', 'Colour', 'Total Packages', 'Gross weight (kg)', 'Net weight (kg)', 'Total CBM', 'Item Qty (pcs)'];   // Type: shipper default (setQtyType)
async function loadPicks() {
  const sh = shipperName(); if (!sh || S.picksFor === sh) return;
  S.picksFor = sh; try { S.picks = (await api('/api/profile/pick?shipper=' + encodeURIComponent(sh))).picks || {}; } catch (e) { S.picks = {}; }
  for (const [f, spec] of Object.entries(S.pendingPicks || {})) savePick(sh, f, spec, '');
  S.pendingPicks = {}; renderTrain();
}
function renderTrain() {
  let bar = $('#trainBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'trainBar'; bar.className = 'trainbar'; $('#itemTable').closest('.table-wrap').before(bar); }
  const picks = S.picks || {}, n = TRAIN.filter(f => picks[f]).length;
  bar.innerHTML = `<span class="small"><b>Train this shipper's layout</b> (${n} of ${TRAIN.length}) – Pick once, every row is filled and remembered:</span>` +
    TRAIN.map(f => `<span class="trainbtn"><button type="button" class="btn small ${picks[f] ? 'trained' : ''}" data-train="${esc(f)}" title="${picks[f] ? 'Trained – click to pick again (replaces it)' : 'Click, then click the value of row 1 in the packing list'}">${picks[f] ? '✓ ' : '⌖ '}${esc(lab(f))}</button>${picks[f] ? `<button type="button" class="btn small untrain" data-untrain="${esc(f)}" title="Remove this training (wrong place) – the column is emptied">×</button>` : ''}</span>`).join('');
  $$('#trainBar [data-train]').forEach(b => b.onclick = () => startPick({field: b.dataset.train, scope: 'i', row: 0}));
  $$('#trainBar [data-untrain]').forEach(b => b.onclick = async () => {
    const f = b.dataset.untrain, sh = shipperName();
    if (!(await confirmBox(`Remove the training of "${lab(f)}" for ${sh}? The column is emptied – pick the right value again.`))) return;
    try { const r = await api('/api/profile/pick', {json: {shipper: sh, field: f, clear: true}}); S.picks = r.picks;
      S.items.forEach(it => { if (it._ai && it._ai[f] === 'trained' || (it._st && it._st[f] === 'picked')) { it[f] = ''; if (it._st) delete it._st[f]; if (it._src) delete it._src[f]; if (it._ai) delete it._ai[f]; } });
      /* rows that only existed because of a wrong training (nothing but the PO filled) are removed */
      S.items = S.items.filter((it, i) => i === 0 || Object.keys(it).some(k => !k.startsWith('_') && k !== 'PO Number' && k !== 'Delivery No' && it[k] !== '' && it[k] !== null && it[k] !== undefined));
      renderItems(); renderNeeds(); toast(`${lab(f)}: training removed. Click ⌖ ${lab(f)} and pick the right value.`, 5000);
    } catch (e) { toast(e.message, 5000); }
  });
}

/* ---------- column settings (per shipper): read from which document, and needed or not ---------- */
const TYPE_LABEL = {invoice: 'Invoice', packing: 'Packing list', sb: 'Shipping bill', po: 'Purchase order', vdf: 'VDF', other: 'Other'};
const SOURCE_FIELDS = ['Shipper invoice number', 'Invoice Date', 'PO Number', 'Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)',
  'Net weight (kg)', 'Colour', 'Delivery No', 'Customer Name', 'Consignee', 'Port of Discharge', 'FPD', 'Cargo Description', 'IEC', 'Booking Number',
  'Shipping Bill Number', 'Shipping Bill date', 'SB LEO DATE', 'SB LEO TIME', 'CHA Name'];
function colsetRows(sources, need, site) {
  const req = requiredList(site);
  const fields = [...SOURCE_FIELDS, ...req.filter(f => !SOURCE_FIELDS.includes(f) && !ALWAYS_NEEDED.includes(f))];
  return '<thead><tr><th>Column</th><th>Read from</th><th>Needed for this shipper</th></tr></thead><tbody>' + fields.map(f => {
    const src = SOURCE_FIELDS.includes(f)
      ? `<select data-src="${esc(f)}">${['auto', 'invoice', 'packing', 'sb', 'po'].map(t => `<option value="${t}" ${(sources[f] || 'auto') === t ? 'selected' : ''}>${t === 'auto' ? 'Automatic (any document)' : TYPE_LABEL[t]}</option>`).join('')}</select>`
      : '<span class="muted small">entered by hand</span>';
    const nd = !req.includes(f) ? '<span class="muted small">optional</span>' : ALWAYS_NEEDED.includes(f) ? '<b>Required</b>'
      : `<select data-need="${esc(f)}"><option value="yes">Required</option><option value="no" ${need[f] === 'no' ? 'selected' : ''}>Not needed</option></select>`;
    return `<tr><td>${esc(f)}</td><td>${src}</td><td>${nd}</td></tr>`;
  }).join('') + '</tbody>';
}
function renderColset() {
  const counts = {}; Object.values(S.pageTypes).forEach(t => counts[t] = (counts[t] || 0) + 1);
  $('#docTypes').innerHTML = Object.keys(counts).length ? 'Documents found: ' + Object.entries(counts).map(([t, n]) => `<b>${esc(TYPE_LABEL[t] || t)}</b> (${n} page${n === 1 ? '' : 's'})`).join(', ') + '. <span class="muted">Detected from each page\'s title and the file name.</span>' : '';
  $('#colsetTable').innerHTML = colsetRows(S.sources, S.need);
  if (Object.values(S.sources).some(v => v && v !== 'auto') || Object.values(S.need).some(v => v === 'no')) $('#colsetBox').open = true;
  $$('#colsetTable [data-src]').forEach(el => el.onchange = () => changeSource(el.dataset.src, el.value, el));
  $$('#colsetTable [data-need]').forEach(el => el.onchange = () => {
    if (el.value === 'no') S.need[el.dataset.need] = 'no'; else delete S.need[el.dataset.need];
    renderHeader(); renderItems(); renderExtra(); renderNeeds();
  });
}
const canonKey = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2').replace(/G/g, '6');
async function changeSource(f, value, el) {
  if (value === 'auto') delete S.sources[f]; else S.sources[f] = value;
  if (value !== 'auto' && !Object.values(S.pageTypes).includes(value)) toast(`No ${TYPE_LABEL[value].toLowerCase()} page was found in these documents – ${f} will be empty.`, 4500);
  try {
    const r = await api(`/api/job/${S.job}/sources`, {json: {sources: S.sources}});
    const res = r.result;
    if (META.item_fields.includes(f)) {
      for (const row of S.items) {
        const hit = res.items.find(x => canonKey(x.Style) === canonKey(row.Style) && (!row['PO Number'] || !x['PO Number'] || canonKey(x['PO Number']) === canonKey(row['PO Number'])));
        row[f] = hit && hit[f] !== null && hit[f] !== undefined ? hit[f] : '';
        row._src = row._src || {}; row._ai = row._ai || {}; if (row._st) delete row._st[f];
        if (hit && hit._src && hit._src[f]) row._src[f] = hit._src[f]; else delete row._src[f];
        if (hit && hit._ai && hit._ai[f]) row._ai[f] = hit._ai[f]; else delete row._ai[f];
      }
      renderItems();
    } else {
      S.header[f] = res.header[f] ?? ''; S.hstatus[f] = res.header_status[f] || ''; if (res.header_src[f]) S.hsrc[f] = res.header_src[f]; else delete S.hsrc[f];
      renderHeader();
    }
    renderNeeds(); highlightSrc();
    const tr = el && el.closest('tr'); if (tr) { tr.classList.add('changed'); setTimeout(() => tr.classList.remove('changed'), 1500); }
    toast(`${f}: now read from ${value === 'auto' ? 'any document' : 'the ' + TYPE_LABEL[value].toLowerCase()}`);
  } catch (e) { toast(e.message); }
}

$('#plNA').onchange = async e => {
  S.plNA = e.target.checked;
  for (const f of META.pl_fields || []) S.sources[f] = S.plNA ? 'invoice' : 'packing';
  try {
    const r = await api(`/api/job/${S.job}/sources`, {json: {sources: S.sources}});
    const used = new Set();
    for (const row of S.items) {
      let k = r.result.items.findIndex((x, j) => !used.has(j) && canonKey(x.Style) === canonKey(row.Style)); if (k >= 0) used.add(k);
      const hit = k >= 0 ? r.result.items[k] : null;
      for (const f of META.pl_fields || []) { row[f] = hit && hit[f] !== null && hit[f] !== undefined ? hit[f] : ''; if (row._st) delete row._st[f]; }
      delete row._diff;
    }
    renderItems(); renderNeeds(); renderDamage();
    if (window.CSD.wiz && window.CSD.wiz.rebuild) window.CSD.wiz.rebuild();
    toast(S.plNA ? 'Values taken from the invoice (no packing list)' : 'Back to: values from the packing list');
  } catch (err) { toast(err.message); }
};

/* ---------- document viewer ---------- */
function allPages() { const out = []; S.docs.forEach(d => d.pages.forEach(p => out.push(p))); return out; }
function renderViewer() {
  const pages = allPages();
  $('#pageTabs').innerHTML = pages.map((p, i) => `<button type="button" data-i="${i}" class="${i === S.page ? 'active' : ''}" title="${esc(p.doc)}">${S.pageTypes[p.id] && S.pageTypes[p.id] !== 'other' ? `<b>${esc(TYPE_LABEL[S.pageTypes[p.id]])}</b> · ` : ''}${esc(shortName(p.doc))} · ${esc(p.title)}</button>`).join('');
  $$('#pageTabs button').forEach(b => b.onclick = () => { S.page = +b.dataset.i; renderViewer(); });
  const p = pages[S.page];
  if (!p) { $('#pageView').innerHTML = '<p class="muted" style="padding:10px">No document text.</p>'; return; }
  $('#pageNote').textContent = p.error ? p.error : p.kind === 'scan' ? 'Scanned page – text read by OCR. Check numbers against the paper.' : '';
  $('#pageView').innerHTML = p.kind === 'excel' ? excelView(p) : lineView(p);
  $$('#pageView .cell').forEach(el => el.onclick = () => onCellClick(p.id, +el.dataset.r, +el.dataset.c, el.dataset.t ?? el.textContent));
  highlightSrc();
}
const shortName = n => n.length > 26 ? n.slice(0, 12) + '…' + n.slice(-10) : n;
function excelView(p) {
  let maxc = 1; p.rows.forEach(r => r.forEach(c => { maxc = Math.max(maxc, c.x1 - 1); }));
  maxc = Math.min(maxc, 60);
  let h = '<table class="pv-table"><tbody>';
  p.rows.forEach((row, ri) => {
    h += `<tr><td class="rn">${ri + 1}</td>`; let col = 1;
    row.forEach((c, ci) => {
      const x0 = Math.round(c.x0), span = Math.max(1, Math.round(c.x1 - c.x0));
      while (col < x0 && col <= maxc) { h += '<td class="empty"></td>'; col++; }
      if (col > maxc) return;
      h += `<td class="cell" colspan="${span}" data-r="${ri}" data-c="${ci}" title="${esc(c.t)}">${esc(c.t)}</td>`; col += span;
    });
    h += '</tr>';
  });
  return h + '</tbody></table>';
}
function lineView(p) {
  return '<div class="pv-lines">' + p.rows.map((row, ri) => '<div class="pv-line">' + row.map((c, ci) =>
    `<span class="cell" data-r="${ri}" data-c="${ci}" title="${esc(c.t)}" style="left:${(c.x0 / 10).toFixed(2)}%;max-width:${Math.max(4, (c.x1 - c.x0) / 10 + 2).toFixed(2)}%">${esc(c.t)}</span>`).join('') + '</div>').join('') + '</div>';
}
function srcRefs() {
  const refs = Object.values(S.hsrc || {});
  S.items.forEach(r => Object.values(r._src || {}).forEach(x => refs.push(x)));
  return refs;
}
function highlightSrc() {
  const p = allPages()[S.page]; if (!p) return;
  const mine = new Set(srcRefs().filter(x => x && x[0] === p.id).map(x => x[1] + ':' + x[2]));
  $$('#pageView .cell').forEach(el => el.classList.toggle('src', mine.has(el.dataset.r + ':' + el.dataset.c)));
}
function goToSrc(ref, flash = true) {
  if (!ref) return;
  const pages = allPages(); const i = pages.findIndex(p => p.id === ref[0]);
  if (i < 0) return;
  if (i !== S.page) { S.page = i; renderViewer(); }
  const el = $(`#pageView .cell[data-r="${ref[1]}"][data-c="${ref[2]}"]`);
  if (el) { el.scrollIntoView({block: 'center', inline: 'center'}); if (flash) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900); } }
}

/* ---------- ask AI ---------- */
$('#askAi').onclick = async () => {
  try { await api(`/api/job/${S.job}/ai`, {json: {}}); S.docs = []; startPolling(S.job); }
  catch (e) { toast(e.message, 6000); }
};

/* ---------- save ---------- */
function cleanItems() {
  return S.items.filter(r => META.item_fields.some(f => r[f] !== '' && r[f] !== undefined && r[f] !== null))
    .map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))));
}
async function doSave(force, pin) {
  if (!user()) { $('#userName').focus(); toast('Enter your name first (top right)'); return; }
  /* OSD = No: the OSD details are not kept (the report shows "NO OSD") */
  const extra = Object.assign({}, S.extra);
  if (String(extra.OSD || '').toUpperCase() === 'NO') for (const f of OSD_DEP) delete extra[f];
  const header = Object.assign({}, S.header, Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== '')));
  const items = cleanItems();
  if (!items.length) { toast('Add at least one item row'); return; }
  let tutBody = {};
  if (isTut()) {
    if (!S.hasPL && !S.plNA) { await alertBox('No packing list in these documents. Upload the packing list with the invoice, or tick "Packing list not available – take these values from the invoice".'); return; }
    const noPk = META.truck_flow ? [] : S.items.map((r, i) => r.Style && !r._chkPkgs ? i + 1 : null).filter(Boolean);
    const noDf = S.items.map((r, i) => r.Style && r._diff && Object.keys(r._diff).length && !r._chkDiff ? i + 1 : null).filter(Boolean);
    if (noPk.length || noDf.length) {
      await alertBox([noPk.length ? `Tick "Pkgs & CBM checked" for row(s) ${noPk.join(', ')}.` : '', noDf.length ? `Tick "Packing list difference checked" for row(s) ${noDf.join(', ')} (amber values: packing list and invoice differ).` : ''].filter(Boolean).join(' '));
      return;
    }
    if (!META.truck_flow && !(await confirmBox('I have checked the received cartons (Received Pkgs) and the CBM of all rows.'))) return;
    tutBody = META.truck_flow ? {checked_diff: true, pl_not_available: !!S.plNA} : {checked: true, damage: S.damage, pl_not_available: !!S.plNA};
  }
  $('#saveBtn').disabled = true;
  try {
    const send = p => api('/api/save', {json: Object.assign({job: S.job, header, items, learn: $('#learnChk').checked, force: !!force, sources: S.sources, need: S.need}, tutBody, p ? {admin_pin: p} : {})});
    let r;
    try { r = await send(pin); }
    catch (e) {
      /* same shipper + invoice already in stock: blocked; only the admin can save it again (e.g. a genuine second lot) */
      if (!(e.data && e.data.dup_invoice)) throw e;
      const d = e.data.dup_invoice;
      const ok = await confirmBox(`Invoice ${d.invoice} of ${d.shipper} is already in stock: ${d.rows} row(s) saved on ${d.saved_on}${d.by ? ' by ' + d.by : ''}`
        + `${d.shipped_out ? ` (${d.shipped_out} already shipped out)` : ''}${d.styles && d.styles.length ? ` – styles ${d.styles.join(', ')}` : ''}. `
        + `Saving it again makes duplicate rows. Only for a genuine second lot of this invoice can the admin save it with the PIN. Continue to the admin PIN?`);
      if (!ok) { toast('Not saved – this invoice is already in stock.', 5000); return; }
      const p = await adminPin('Saving the same invoice again needs the admin PIN.'); if (!p) return;
      r = await send(p);
    }
    $('#saveErrors').hidden = true; $('#forceSave').hidden = true; S.rowErrors = [];
    if (META.truck_flow && header['Cargo Cutoff Date']) try { localStorage.setItem('csd_cutoff_' + String(header['Customer Name'] || '').toUpperCase(), JSON.stringify({date: header['Cargo Cutoff Date'], time: header['Cargo Cutoff Time'] || ''})); } catch (e) {}
    const learnt = Object.entries(r.learnt || {}).filter(([k]) => !k.startsWith('_'));
    const nf = learnt.filter(([, v]) => v === 'not found in documents').map(([k]) => k);
    $('#saved').hidden = false;
    $('#saved').innerHTML = (META.truck_flow ? `<h3>Truck ${esc(header['Truck Plate Number'] || '')} is on the Truck report – ${r.rows} row${r.rows === 1 ? '' : 's'} waiting to offload</h3><p class="muted small">Click <b>Offloaded</b> on the Truck report when offloading is finished; the cargo then goes into stock.</p>`
      : `<h3>Added ${r.rows} row${r.rows === 1 ? '' : 's'} to stock</h3>`) + `
      <p>${$('#learnChk').checked ? `The format for <b>${esc(r.shipper)}</b> is saved. ${esc(r.learnt._items || '')}.` : 'Format not saved (you unticked it).'}
      ${nf.length ? `<br><span class="muted small">Not printed in these documents, so it will be asked again next time: ${esc(nf.join(', '))}.</span>` : ''}</p>
      <div class="row-end">${META.truck_flow ? '<button class="btn" id="goTrucks">Open Truck report</button>' : ''}<button class="btn" id="goStock">Open stock</button><button class="btn" id="dlExcelSaved">⬇ Download Excel</button><button class="btn primary" id="readNext">Read next documents</button></div>`;
    $('#dlExcelSaved').onclick = () => downloadExcel();
    $('#goStock').onclick = () => { resetRead(); showTab('stock'); };
    if ($('#goTrucks')) $('#goTrucks').onclick = () => { resetRead(); showTab('trucks'); };
    $('#readNext').onclick = resetRead;
    $('#saved').scrollIntoView({behavior: 'smooth'});
    refreshCounts();
    api('/api/meta').then(m => { META = m; window.CSD_META = m; buildDatalists(); }).catch(() => {});   // new Bay / SB / CHA values become suggestions
    if (window.CSD.wiz && window.CSD.wiz.afterSave) window.CSD.wiz.afterSave(r, header);   // v17.1: next invoice of the same truck
  } catch (e) {
    const w = (e.data && e.data.warnings) || [];
    S.rowErrors = w;
    const list = [];
    const fieldOf = {};
    w.forEach((ws, i) => ws.filter(x => x.level === 'error').forEach(x => { const t = `Row ${i + 1} – ${lab(x.field)}: ${x.msg}`; list.push(t); fieldOf[t] = [x.field, i]; }));
    /* the same shop-floor field missing on every row is one thing to fill: list it once */
    const shown = [], seenF = new Set();
    for (const t of [...new Set(list)]) { const [f] = fieldOf[t]; const shipmentLevel = !(META.item_fields || []).includes(f) && !(META.manual_item || []).includes(f);
      if (shipmentLevel) { if (seenF.has(f)) continue; seenF.add(f); shown.push([`${lab(f)}: ${t.split(': ').slice(1).join(': ')}`, f, null]); } else shown.push([t, f, fieldOf[t][1]]); }
    $('#saveErrors').hidden = false;
    $('#saveErrors').innerHTML = `<b>${esc(e.message)}</b>` + (shown.length ? '<ul>' + shown.slice(0, 20).map(([t, f, i]) => `<li data-goto="${esc(f)}" data-row="${i ?? ''}" title="Click to go to the field">${esc(t)}</li>`).join('') + '</ul>' : '');
    $$('#saveErrors li[data-goto]').forEach(li => li.onclick = () => {
      const f = li.dataset.goto, i = li.dataset.row;
      const el = i !== '' ? $(`#itemTable [data-row="${i}"][data-f="${CSS.escape(f)}"]`) : ($(`#extraForm [data-f="${CSS.escape(f)}"]`) || $(`#headerForm [data-f="${CSS.escape(f)}"]`));
      if (window.CSD.wiz && window.CSD.wiz.on && window.CSD.wiz.jump(f, i === '' ? null : +i)) return;
      if (el) { const box = el.closest('details'); if (box) box.open = true; el.scrollIntoView({behavior: 'smooth', block: 'center'}); setTimeout(() => el.focus(), 300); }
    });
    const onlyDup = list.length && list.every(x => x.includes('already in stock'));
    $('#forceSave').hidden = !onlyDup;
    renderItems();
    $$('#headerForm [data-f], #extraForm [data-f]').forEach(el => { if (w.some(ws => ws.some(x => x.field === el.dataset.f && x.level === 'error'))) el.classList.add('has-err'); });
  } finally { $('#saveBtn').disabled = false; }
}
$('#saveBtn').onclick = () => doSave(false);
$('#forceSave').onclick = async () => { const p = await adminPin('Saving rows that are already in stock needs the admin PIN.'); if (p) doSave(true, p); };

/* ---------- stock ---------- */
async function loadStock() {
  const r = await api('/api/stock'); S.stock = r.rows; S.sel.clear(); renderStock(); $('#stockCount').textContent = r.rows.length || '';
}
const cfsOfRow = d => String(d['Warehouse ID'] || '').toUpperCase() || 'NOT SET';
function filteredStock() {
  const q = $('#stockSearch').value.trim().toUpperCase(); const only = $('#onlyIssues').checked;
  return S.stock.filter(s => {
    const d = s.data;
    if (S.cfs && cfsOfRow(d) !== S.cfs) return false;
    if (S.group && (d.GroupName || 'UNASSIGNED').toUpperCase() !== S.group) return false;
    if (only && !s.warnings.length) return false;
    if (q && !Object.values(d).some(v => String(v).toUpperCase().includes(q))) return false;
    return true;
  });
}
function renderStock() {
  const cfsCount = {}; S.stock.forEach(s => { const c = cfsOfRow(s.data); cfsCount[c] = (cfsCount[c] || 0) + 1; });
  const cfsNames = [...new Set([...(META.cfs_list || []), ...Object.keys(cfsCount)])];
  $('#cfsFilter').innerHTML = `<option value="">All CFS (${S.stock.length})</option>` + cfsNames.map(c => `<option value="${esc(c)}" ${c === S.cfs ? 'selected' : ''}>${esc(c)} (${cfsCount[c] || 0})</option>`).join('');
  const groups = {};
  S.stock.filter(s => !S.cfs || cfsOfRow(s.data) === S.cfs).forEach(s => { const g = (s.data.GroupName || 'UNASSIGNED').toUpperCase(); const o = groups[g] = groups[g] || {rows: 0, ctn: 0, cbm: 0, issues: 0};
    o.rows++; o.ctn += +s.data['Total Packages'] || 0; o.cbm += +s.data['Total CBM'] || 0; if (s.warnings.some(w => w.level === 'error')) o.issues++; });
  const names = Object.keys(groups).sort();
  $('#grpFilter').innerHTML = `<option value="">All customers (${S.stock.length})</option>` + names.map(g => `<option value="${esc(g)}" ${g === S.group ? 'selected' : ''}>${esc(g)} (${groups[g].rows})</option>`).join('');
  $('#groupCards').innerHTML = names.map(g => `<button type="button" class="gcard ${g === S.group ? 'active' : ''}" data-g="${esc(g)}"><div class="g">${esc(g)}</div>
    <div class="n">${groups[g].rows} rows · ${groups[g].ctn.toLocaleString('en-IN')} ctns · ${groups[g].cbm.toFixed(1)} CBM</div>
    ${groups[g].issues ? `<span class="badge">${groups[g].issues} need fixing</span>` : ''}</button>`).join('');
  $$('#groupCards .gcard').forEach(b => b.onclick = () => { S.group = S.group === b.dataset.g ? '' : b.dataset.g; renderStock(); });
  const cols = ['GroupName', 'Customer Name', 'Vendor Name', 'Shipper invoice number', 'PO Number', 'Style', 'Item Qty (pcs)', 'Total Packages', 'Total CBM', 'Gross weight (kg)', 'Shipping Bill Number', 'Truck Plate Number', 'Offloading Date', 'Warehouse Bay number'];
  const rows = filteredStock();
  let h = `<thead><tr><th><input type="checkbox" id="selAll" title="Select all shown"></th>${cols.map(c => `<th class="${isNum(c) ? 'num' : ''}">${esc(c)}</th>`).join('')}<th>Checks</th></tr></thead><tbody>`;
  rows.forEach(s => {
    const errs = s.warnings.filter(w => w.level === 'error'), warns = s.warnings.filter(w => w.level !== 'error');
    h += `<tr data-id="${s.id}"><td><input type="checkbox" class="sel" data-id="${s.id}" ${S.sel.has(s.id) ? 'checked' : ''}></td>${cols.map(c => `<td class="${isNum(c) ? 'num' : ''}">${esc(fmtNum(c, s.data[c]))}</td>`).join('')}
      <td>${errs.length ? `<span class="badge" title="${esc(errs.map(w => w.field + ': ' + w.msg).join('\n'))}">${errs.length} to fix</span>` : ''} ${warns.length ? `<span class="badge warn" title="${esc(warns.map(w => w.field + ': ' + w.msg).join('\n'))}">${warns.length} check</span>` : ''}${shipBadge(s.ship)}</td></tr>`;
  });
  if (!rows.length) h += `<tr><td colspan="${cols.length + 2}" class="muted" style="padding:16px">${S.stock.length ? 'No rows match.' : 'No stock yet. Read shipper documents, or import your current stock report.'}</td></tr>`;
  $('#stockTable').innerHTML = h + '</tbody>';
  $$('#stockTable tbody tr[data-id]').forEach(tr => tr.onclick = async e => { if (e.target.classList.contains('sel')) return; if (await adminPin('Editing added stock needs the admin PIN.')) openEdit([+tr.dataset.id]); });
  $$('#stockTable .sel').forEach(cb => cb.onchange = () => { cb.checked ? S.sel.add(+cb.dataset.id) : S.sel.delete(+cb.dataset.id); selInfo(); });
  const all = $('#selAll'); if (all) all.onchange = () => { rows.forEach(s => all.checked ? S.sel.add(s.id) : S.sel.delete(s.id)); renderStock(); };
  selInfo();
  const nSites = META.site_lock || S.cfs ? 1 : new Set(S.stock.map(x => cfsOfRow(x.data))).size;
  $('#dlReport').textContent = nSites > 1 ? `Download ${nSites} reports (one per CFS)` : 'Download stock report (.xlsx)';
}
/* ship-cancel marks (booking list): amber within 10 days of SHIP CXL, red within 5 days or past – only cargo not in a plan */
function shipBadge(x) {
  if (!x) return '';
  if (x.missing) return ' <span class="badge grey" title="This PO is not in the booking list (no SHIP CXL)">SHIP CXL missing</span>';
  if (!x.mark) return '';
  return ` <span class="badge ${x.mark === 'red' ? '' : 'warn'}" title="SHIP CXL ${esc(x.cxl)}${x.ship_to ? ' · SHIP TO ' + esc(x.ship_to) : ''} – not in any loading plan">${x.days < 0 ? 'SHIP CXL passed' : `SHIP CXL in ${x.days} day${x.days === 1 ? '' : 's'}`}</span>`;
}
function selInfo() {
  const n = S.sel.size; $('#bulkEdit').disabled = !n; $('#markOut').disabled = !n; $('#delSel').disabled = !n;
  $('#selInfo').textContent = n ? `${n} row${n === 1 ? '' : 's'} selected` : 'Click a row to edit it. Tick rows to update several at once.';
}
$('#grpFilter').onchange = e => { S.group = e.target.value; renderStock(); };
$('#cfsFilter').onchange = e => { S.cfs = e.target.value; renderStock(); };
$('#stockSearch').oninput = () => renderStock();
$('#onlyIssues').onchange = () => renderStock();
/* admin PIN: asked once, then remembered for 10 minutes on this screen */
function askPin(why) {
  return new Promise(res => {
    const d = $('#pinDlg'); $('#pinWhy').textContent = why; $('#pinErr').textContent = ''; $('#pinInput').value = ''; d.returnValue = ''; d.showModal(); $('#pinInput').focus();
    d.addEventListener('close', () => res(d.returnValue === 'ok' ? $('#pinInput').value.trim() : null), {once: true});
  });
}
window.adminPinAsk = (why) => adminPin(why);
async function adminPin(why) {
  /* the PIN is asked every time (no memory) */
  const st = await api('/api/admin-pin');
  if (!st.set) { await alertBox('No admin PIN is set on this PC yet. The admin sets it in Import / backup → Admin PIN.'); return null; }
  for (let t = 0; t < 3; t++) {
    const pin = await askPin(t ? 'Wrong PIN – try again. ' + why : why); if (pin === null) return null;
    const r = await api('/api/admin-pin/check', {json: {pin}});
    if (r.ok) { if (r.weak) toast('Please change the admin PIN to 6 or more digits (Import / backup → Admin PIN).', 7000); return pin; }
    if (r.locked) { await alertBox(r.error); return null; }
  }
  await alertBox('Wrong admin PIN.'); return null;
}
$('#bulkEdit').onclick = async () => { if (await adminPin('Editing added stock needs the admin PIN.')) openEdit([...S.sel]); };
$('#delSel').onclick = async () => {
  const pin = await adminPin('Deleting stock needs the admin PIN.'); if (!pin) return;
  if (!(await confirmBox(`Delete ${S.sel.size} row(s) from stock? They are removed from the stock report (kept in the history).`))) return;
  try { await api('/api/stock/status', {json: {ids: [...S.sel], status: 'deleted', admin_pin: pin}}); toast('Deleted'); loadStock(); } catch (e) { toast(e.message); }
};
$('#markOut').onclick = async () => {
  if (!(await confirmBox(`Mark ${S.sel.size} row(s) as shipped out? They will leave the stock report.`))) return;
  await api('/api/stock/status', {json: {ids: [...S.sel], status: 'out'}}); toast('Marked as shipped out'); loadStock();
};
/* ---------- shipped out: view, and return to stock (admin PIN) ---------- */
const OUT = {rows: [], sel: new Set()};
async function loadOut() {
  const r = await api('/api/stock?status=out');
  OUT.rows = r.rows.sort((a, b) => String(b.removed_at || '').localeCompare(String(a.removed_at || '')) || b.id - a.id);
  OUT.sel.clear(); renderOut();
}
function renderOut() {
  const q = $('#outSearch').value.trim().toUpperCase();
  const rows = OUT.rows.filter(s => !q || Object.values(s.data).some(v => String(v).toUpperCase().includes(q)));
  const cols = [['Shipped out on', s => String(s.removed_at || '').slice(0, 16)], ['Container No', s => s.data['Container No'] || '(marked by hand)'], ['Running No', s => s.data['Running No']],
    ['Stuffing Date', s => s.data['Stuffing Date']], ['Customer', s => s.data['Customer Name'] || s.data.GroupName], ['Shipper Inv No', s => s.data['Shipper invoice number']],
    ['PO No', s => s.data['PO Number']], ['Style', s => s.data.Style], ['Cartons', s => s.data['Received Pkgs'] || s.data['Total Packages'], 1], ['CBM', s => fmtNum('Total CBM', s.data['Total CBM']), 1],
    ['Remarks', s => s.data['OSD Remarks'] === 'NO OSD' ? '' : s.data['OSD Remarks']], ['By', s => s.updated_by]];
  const shown = rows.slice(0, 500);
  let h = `<thead><tr><th><input type="checkbox" id="outAll" title="Tick all shown"></th>${cols.map(c => `<th class="${c[2] ? 'num' : ''}">${esc(c[0])}</th>`).join('')}</tr></thead><tbody>`;
  shown.forEach(s => { h += `<tr><td><input type="checkbox" class="osel" data-id="${s.id}" ${OUT.sel.has(s.id) ? 'checked' : ''}></td>${cols.map(c => `<td class="${c[2] ? 'num' : ''}">${esc(c[1](s) == null ? '' : c[1](s))}</td>`).join('')}</tr>`; });
  if (!shown.length) h += `<tr><td colspan="${cols.length + 1}" class="muted" style="padding:16px">${OUT.rows.length ? 'No rows match.' : 'Nothing shipped out yet.'}</td></tr>`;
  $('#outTable').innerHTML = h + '</tbody>';
  $$('#outTable .osel').forEach(cb => cb.onchange = () => { cb.checked ? OUT.sel.add(+cb.dataset.id) : OUT.sel.delete(+cb.dataset.id); outInfo(); });
  $('#outAll').checked = shown.length > 0 && shown.every(s => OUT.sel.has(s.id));
  $('#outAll').onchange = e => { shown.forEach(s => e.target.checked ? OUT.sel.add(s.id) : OUT.sel.delete(s.id)); renderOut(); };
  outInfo(rows.length > shown.length ? ` · showing the latest 500 of ${rows.length} – search to narrow` : '');
}
function outInfo(extra = '') {
  const n = OUT.sel.size; $('#outReturn').disabled = !n;
  $('#outReturn').textContent = n ? `Return ${n} row${n === 1 ? '' : 's'} to stock` : 'Return to stock';
  $('#outInfo').textContent = `${OUT.rows.length} row(s) shipped out${n ? ` · ${n} ticked` : ''}${typeof extra === 'string' ? extra : ''}`;
}
$('#viewOut').onclick = async () => { $('#outSearch').value = ''; try { await loadOut(); $('#outDlg').showModal(); } catch (e) { toast(e.message); } };
$('#outSearch').oninput = () => renderOut();
$('#outReturn').onclick = async () => {
  const picked = OUT.rows.filter(s => OUT.sel.has(s.id)); if (!picked.length) return;
  const conts = [...new Set(picked.map(s => s.data['Container No']).filter(Boolean))];
  const pin = await adminPin('Returning shipped-out rows to stock needs the admin PIN.'); if (!pin) return;
  const msg = `Return ${picked.length} row(s) to stock?` + (conts.length ? ` They will be taken off the stuffing report of ${conts.join(', ')}.` : '');
  if (!(await confirmBox(msg))) return;
  try {
    const r = await api('/api/stock/return', {json: {ids: picked.map(s => s.id), admin_pin: pin}});
    if (r.containers && r.containers.length && window.CSD.mailer && window.CSD.cloud && window.CSD.cloud.enabled) window.CSD.mailer.cancelled({containers: r.containers}).catch(e => toast('E-mail: ' + e.message, 6000));
    toast(`${picked.length} row(s) back in stock` + (r.merged ? ` (${r.merged} added back to part-loaded rows)` : '') + (r.removed_containers ? ` · ${r.removed_containers} container(s) removed from the stuffing list` : ''), 6000);
    await loadOut(); loadStock();
  } catch (e) { toast(e.message, 6000); }
};
/* One report per site (HTPL, SATTVA, SICAL, ST JOHN), each with its own header block. */
const pause = ms => new Promise(r => setTimeout(r, ms));
const siteParam = c => c === '' || c === 'NOT SET' ? '__none' : c;
/* "Download Excel" (top bar, after saving and on the Stock tab): the stock report(s) as .xlsx in Downloads */
function downloadExcel() { return $('#dlReport').onclick(false); }
$('#dlExcelTop').onclick = () => downloadExcel();
$('#dlReport').onclick = async (useFilters = true) => {
  try {
    const filt = useFilters === true || (useFilters && useFilters.type === 'click');
    const base = new URLSearchParams(); if (filt && S.group) base.set('group', S.group);
    let sites = (await api('/api/report/sites' + (base.toString() ? '?' + base : ''))).sites;
    if (filt && S.cfs) sites = sites.filter(x => (x.cfs || 'NOT SET') === S.cfs);
    if (!sites.length) { toast('No stock rows to report for this selection'); return; }
    const names = [];
    for (const x of sites) {
      const qs = new URLSearchParams(base); qs.set('cfs', siteParam(x.cfs));
      names.push(await download('/api/report?' + qs, 'Stock_Report.xlsx'));
      if (sites.length > 1) await pause(800);
    }
    toast(names.length === 1 ? 'Saved ' + names[0] + ' in your Downloads folder' : `Saved ${names.length} reports (one per CFS) in your Downloads folder`, 5000);
  } catch (e) { toast(e.message); }
};
function openEdit(ids) {
  const bulk = ids.length > 1; S.editing = ids;
  const one = bulk ? {} : S.stock.find(s => s.id === ids[0]).data;
  $('#editTitle').textContent = bulk ? `Update ${ids.length} rows – only filled fields are changed` : `${one['Shipper invoice number'] || ''} · ${one['Style'] || ''}`;
  const warns = bulk ? [] : S.stock.find(s => s.id === ids[0]).warnings;
  $('#editBody').innerHTML = META.groups.map(([g, fs]) => `<fieldset><legend>${esc(g)}</legend><div class="form-grid">${fs.map(f => {
    const w = warns.filter(x => x.field === f);
    return `<div class="fld"><label><span>${esc(f)}</span>${w.length ? `<span class="badge ${w[0].level === 'error' ? '' : 'warn'}">${esc(w[0].msg)}</span>` : ''}</label><div class="in">${inputFor(f, one[f], w.some(x => x.level === 'error') ? 'class="has-err"' : '')}</div></div>`;
  }).join('')}</div></fieldset>`).join('');
  $('#editErrors').hidden = true;
  if (!bulk) $$('#editBody [data-f="Customer Name"]').forEach(el => el.addEventListener('change', () => {
    const m = META.customers[el.value.trim().toUpperCase()]; if (!m) return;
    for (const [f, v] of Object.entries(m)) { const t = $(`#editBody [data-f="${f}"]`); if (t && !t.value) t.value = v; }
  }));
  $('#editDlg').showModal();
}
$('#editForm').addEventListener('submit', async e => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault();
  const ids = S.editing; const bulk = ids.length > 1;
  const vals = {}; $$('#editBody [data-f]').forEach(el => { vals[el.dataset.f] = readVal(el); });
  try {
    for (const id of ids) {
      const cur = S.stock.find(s => s.id === id).data;
      const data = bulk ? Object.assign({}, cur, Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== ''))) : vals;
      await api('/api/stock/' + id, {method: 'PUT', json: {data, admin_pin: S.adminPin}});
    }
    $('#editDlg').close(); toast(bulk ? `Updated ${ids.length} rows` : 'Saved'); loadStock();
  } catch (err) {
    const w = (err.data && err.data.warnings || []).filter(x => x.level === 'error');
    $('#editErrors').hidden = false;
    $('#editErrors').innerHTML = `<b>${esc(err.message)}</b><ul>${w.map(x => `<li>${esc(x.field)}: ${esc(x.msg)}</li>`).join('')}</ul>`;
    $$('#editBody [data-f]').forEach(el => el.classList.toggle('has-err', w.some(x => x.field === el.dataset.f)));
  }
});

/* ---------- formats ---------- */
function describe(spec) {
  if (!spec) return '';
  if (spec.method === 'fixed') return `<span class="method">Fixed</span> always <b>${esc(spec.value)}</b>`;
  if (spec.method === 'anchor') return `<span class="method">Label</span> ${spec.dir === 'right' ? 'next to' : 'under'} <code>${esc(spec.label_text || spec.label)}</code>`;
  if (spec.method === 'regex') return `<span class="method">Inside text</span> e.g. <code>${esc((spec.examples || [])[0] || '')}</code> <span class="muted small">${esc(spec.pattern)}</span>`;
  return esc(JSON.stringify(spec));
}
function colsetSummary(d) {
  const s = Object.entries(d.source || {}).filter(([, t]) => t && t !== 'auto'), n = Object.keys(d.need || {});
  return (s.length ? s.map(([f, t]) => `${f} from ${TYPE_LABEL[t].toLowerCase()}`).join(', ') : 'all columns: automatic') + (n.length ? ` · not needed: ${n.join(', ')}` : '');
}
/* ---------- v17.1 shipper name list (alias list) ---------- */
const AL = {list: [], unmapped: [], edit: false};
const csvOf = a => (a || []).join(', '), listOf = t => String(t || '').split(',').map(x => x.trim()).filter(Boolean);
const pfxShow = rx => /^\^[A-Z0-9\-\/]+$/i.test(rx) ? rx.slice(1) + '…' : rx;
const pfxRead = t => /[\\[\]{}()$|?*+]/.test(t) || t.startsWith('^') ? t : '^' + t.replace(/…$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function loadAlias() {
  try { const r = await api('/api/shipper-alias'); AL.list = r.list; AL.unmapped = r.unmapped; AL.at = r.at; renderAlias(); } catch (e) { $('#aliasList').textContent = e.message; }
}
function renderAlias() {
  const un = AL.unmapped || [];
  $('#aliasUnmapped').innerHTML = un.length ? `<div class="banner warnbox"><b>${un.length} shipper name(s) not in the list yet</b> – read from documents. Add each as a new shipper or as another spelling (admin).
    <table class="grid small"><thead><tr><th>Name on the document</th><th>GSTIN state</th><th>Invoice</th><th>First seen</th><th></th></tr></thead><tbody>${un.map((u, i) => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.gstin || '')}</td><td>${esc(u.invoice || '')}</td><td>${esc(String(u.at || '').slice(0, 16))}</td>
    <td class="row-end"><button class="btn small" data-unnew="${i}" type="button">New shipper</button><select data-unto="${i}"><option value="">Spelling of…</option>${AL.list.map((a, k) => `<option value="${k}">${esc(a.name)}</option>`).join('')}</select><button class="btn small" data-unign="${i}" type="button">Ignore</button></td></tr>`).join('')}</tbody></table></div>` : '';
  const ed = AL.edit;
  $('#aliasList').innerHTML = `<div class="table-wrap"><table class="grid"><thead><tr><th>Shipper (one name)</th><th>Other spellings</th><th>Invoice no. starts with</th><th>GSTIN</th>${ed ? '<th></th>' : ''}</tr></thead><tbody>` +
    AL.list.map((a, i) => ed ? `<tr><td><input data-al="${i}" data-k="name" value="${esc(a.name)}"></td><td><input data-al="${i}" data-k="aliases" value="${esc(csvOf(a.aliases))}"></td>
      <td><input data-al="${i}" data-k="prefixes" value="${esc((a.prefixes || []).map(pfxShow).join(', '))}"></td><td><input data-al="${i}" data-k="gstin" value="${esc(csvOf(a.gstin))}"></td><td><button class="btn small" data-aldel="${i}" type="button">×</button></td></tr>`
      : `<tr><td><b>${esc(a.name)}</b></td><td>${esc(csvOf(a.aliases))}</td><td>${esc((a.prefixes || []).map(pfxShow).join(', '))}</td><td class="mono">${esc(csvOf(a.gstin))}</td></tr>`).join('') + '</tbody></table></div>' +
    (ed ? `<div class="row-end"><button class="btn small" id="alAdd" type="button">+ Add shipper</button><button class="btn" id="alCancel" type="button">Cancel</button><button class="btn primary" id="alSave" type="button">Save list (admin PIN)</button></div>` :
      (AL.list.length ? `<p class="muted small">${AL.list.length} shippers${AL.at ? ' · changed ' + esc(String(AL.at).slice(0, 16)) : ''}</p>` :
        `<p class="small"><b>No shipper name list on this PC yet.</b> Admin: click <b>Import formats file</b> above and choose <b>Shipper_name_list_import.json</b> from the setup package (it is kept out of the program because the GitHub copy is public).</p>`));
  $$('#aliasList [data-al]').forEach(el => el.onchange = () => { const a = AL.list[+el.dataset.al], k = el.dataset.k; a[k] = k === 'name' ? el.value.trim().toUpperCase() : k === 'prefixes' ? listOf(el.value).map(pfxRead) : listOf(el.value).map(x => x.toUpperCase()); });
  $$('#aliasList [data-aldel]').forEach(b => b.onclick = () => { AL.list.splice(+b.dataset.aldel, 1); renderAlias(); });
  if ($('#alAdd')) $('#alAdd').onclick = () => { AL.list.push({name: '', aliases: [], prefixes: [], gstin: []}); renderAlias(); };
  if ($('#alCancel')) $('#alCancel').onclick = () => { AL.edit = false; loadAlias(); };
  if ($('#alSave')) $('#alSave').onclick = () => saveAlias();
  $$('#aliasUnmapped [data-unnew]').forEach(b => b.onclick = () => { const u = un[+b.dataset.unnew]; AL.list.push({name: u.name, aliases: [], prefixes: [], gstin: []}); AL.edit = true; AL.done = (AL.done || []).concat(u.name); renderAlias(); });
  $$('#aliasUnmapped [data-unto]').forEach(sel => sel.onchange = () => { if (sel.value === '') return; const u = un[+sel.dataset.unto], a = AL.list[+sel.value]; a.aliases = [...new Set([...(a.aliases || []), u.name])]; AL.edit = true; renderAlias(); toast(`${u.name} added as a spelling of ${a.name} – press "Save list"`); });
  $$('#aliasUnmapped [data-unign]').forEach(b => b.onclick = async () => { const pin = await adminPin('Removing a name from the "not in the list" box needs the admin PIN.'); if (!pin) return;
    try { const r = await api('/api/shipper-alias/unmapped', {method: 'DELETE', json: {name: un[+b.dataset.unign].name, admin_pin: pin}}); AL.unmapped = r.unmapped; renderAlias(); } catch (e) { toast(e.message); } });
}
async function saveAlias() {
  const pin = AL.pin || await adminPin('Changing the shipper name list needs the admin PIN.'); AL.pin = null; if (!pin) return;
  try { const r = await api('/api/shipper-alias', {method: 'PUT', json: {list: AL.list.filter(a => a.name), admin_pin: pin}}); AL.list = r.list; AL.unmapped = r.unmapped; AL.at = r.at; AL.edit = false; renderAlias(); toast('Shipper name list saved. Export formats to give it to the other PCs.', 6000); }
  catch (e) { await alertBox(e.message); }
}
$('#aliasEdit').onclick = async () => { const pin = await adminPin('Editing the shipper name list needs the admin PIN.'); if (pin) { AL.pin = pin; AL.edit = true; renderAlias(); } };
async function loadFormats() {
  loadAlias();
  const {profiles} = await api('/api/profiles'); $('#fmtCount').textContent = profiles.length || '';
  if (!profiles.length) { $('#formatList').innerHTML = '<div class="card muted">No shipper formats yet. They are created automatically the first time you save a shipper\'s documents.</div>'; return; }
  $('#formatList').innerHTML = profiles.map(p => {
    const hdr = Object.entries(p.data.header || {});
    const it = p.data.items;
    return `<div class="card fmt"><div class="row-between"><div><h3>${esc(p.shipper)}</h3><div class="muted small">Used ${p.data.uses || 0} time(s) · updated ${esc(p.updated_at)} by ${esc(p.updated_by || '')}</div></div>
      <button class="btn small danger" data-delp="${p.id}" data-name="${esc(p.shipper)}">Delete format</button></div>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Field</th><th>How it is found</th><th></th></tr></thead><tbody>
      ${it ? `<tr><td>Item rows</td><td>Rows under the heading <code>${esc(it.key_header)}</code>, e.g. ${esc((it.key_examples || []).slice(0, 3).join(', '))}; columns: ${Object.entries(it.columns || {}).map(([f, c]) => `${esc(f)} <span class="muted small">(${esc(c.header || 'by position')})</span>`).join(', ')}</td>
        <td><button class="btn small" data-forget-items="${p.id}">Forget</button></td></tr>` : ''}
      ${hdr.map(([f, s]) => `<tr><td>${esc(f)}</td><td>${describe(s)}</td><td><div class="row-end"><button class="btn small" data-fixed="${p.id}" data-f="${esc(f)}">Set fixed value</button><button class="btn small" data-forget="${p.id}" data-f="${esc(f)}">Forget</button></div></td></tr>`).join('')}
      </tbody></table></div>
      <details class="colset-wrap"><summary><b>Column settings</b> <span class="muted small">${esc(colsetSummary(p.data))}</span></summary>
        <div class="table-wrap"><table class="grid colset" data-prof="${p.id}">${colsetRows(p.data.source || {}, p.data.need || {}, META.warehouse)}</table></div></details></div>`;
  }).join('');
  $$('table.colset[data-prof] select').forEach(el => el.onchange = async () => {
    const id = el.closest('table').dataset.prof;
    const body = el.dataset.src ? {action: 'source', field: el.dataset.src, value: el.value} : {action: 'need', field: el.dataset.need, value: el.value};
    await api(`/api/profiles/${id}/field`, {json: body});
    toast(`${body.field}: ${body.action === 'source' ? (el.value === 'auto' ? 'read from any document' : 'read from the ' + TYPE_LABEL[el.value].toLowerCase()) : (el.value === 'no' ? 'not needed' : 'required')} – used from the next document`);
    const sum = el.closest('details').querySelector('summary .muted'); const p = (await api('/api/profiles')).profiles.find(x => String(x.id) === id); if (p && sum) sum.textContent = colsetSummary(p.data);
  });
  $$('[data-delp]').forEach(b => b.onclick = async () => { if (await confirmBox(`Delete the saved format for ${b.dataset.name}? Their next documents will be treated as a new shipper.`)) { await api('/api/profiles/' + b.dataset.delp, {method: 'DELETE'}); loadFormats(); } });
  $$('[data-forget]').forEach(b => b.onclick = async () => { await api(`/api/profiles/${b.dataset.forget}/field`, {json: {field: b.dataset.f, action: 'forget'}}); toast(`${b.dataset.f} will be asked next time`); loadFormats(); });
  $$('[data-forget-items]').forEach(b => b.onclick = async () => { await api(`/api/profiles/${b.dataset.forgetItems}/field`, {json: {action: 'forget_items'}}); loadFormats(); });
  $$('[data-fixed]').forEach(b => b.onclick = () => {
    const td = b.closest('tr').children[1];
    td.innerHTML = `<div class="cellwrap"><input id="fx" placeholder="Value for every shipment"><button class="btn small primary" id="fxOk">Save</button></div>`;
    $('#fx').focus();
    $('#fxOk').onclick = async () => { await api(`/api/profiles/${b.dataset.fixed}/field`, {json: {field: b.dataset.f, action: 'fixed', value: $('#fx').value}}); loadFormats(); };
  });
}

/* ---------- share formats ---------- */
async function download(url, fallbackName) {
  const r = await fetch(url, {headers: {'X-User': user()}});
  if (!r.ok) { let m = 'Download failed'; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
  const blob = await r.blob(); const cd = r.headers.get('Content-Disposition') || '';
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return name;
}
$('#fmtExport').onclick = async () => { try { const n = await download('/api/profiles/export', 'shipper_formats.json'); toast('Saved ' + n + ' in your Downloads folder'); } catch (e) { toast(e.message); } };
let fmtFile = null;
$('#fmtImportFile').onchange = async e => {
  fmtFile = e.target.files[0]; e.target.value = ''; if (!fmtFile) return;
  const fd = new FormData(); fd.append('file', fmtFile); fd.append('preview', '1');
  try {
    const r = await api('/api/profiles/import', {method: 'POST', body: fd});
    const changes = r.plan.filter(p => !p.action.startsWith('keep mine'));
    $('#fmtImportPlan').hidden = false;
    $('#fmtImportPlan').innerHTML = `<p><b>${esc(fmtFile.name)}</b> from ${esc(r.from_pc || 'another PC')} (${esc(r.exported_at || '')})</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Shipper</th><th>What will happen</th><th>Their version</th><th>This PC's version</th></tr></thead><tbody>
      ${r.plan.map(p => `<tr><td>${esc(p.shipper)}</td><td>${esc(p.action)}</td><td>${esc(p.theirs || '')}</td><td>${esc(p.mine || '–')}</td></tr>`).join('')}</tbody></table></div>
      <div class="row-end" style="margin-top:8px"><button class="btn" id="fmtCancel">Cancel</button>
      <button class="btn" id="fmtAll">Import all (replace mine)</button><button class="btn primary" id="fmtGo" ${changes.length ? '' : 'disabled'}>Import ${changes.length} format(s)</button></div>`;
    $('#fmtCancel').onclick = () => { $('#fmtImportPlan').hidden = true; };
    const go = async mode => {
      const f2 = new FormData(); f2.append('file', fmtFile); f2.append('mode', mode);
      const res = await api('/api/profiles/import', {method: 'POST', body: f2});
      toast(`Imported ${res.plan.filter(p => p.action === 'add' || p.action === 'replace').length} format(s)`); $('#fmtImportPlan').hidden = true; loadFormats();
    };
    $('#fmtGo').onclick = () => go('newer'); $('#fmtAll').onclick = () => go('all');
  } catch (err) { toast(err.message, 5000); }
};

/* ---------- combine reports ---------- */
let cmbFiles = [];
async function combinePreview() {
  if (!cmbFiles.length) { $('#cmbInfo').textContent = ''; $('#cmbBtn').hidden = true; return; }
  const fd = new FormData(); cmbFiles.forEach(f => fd.append('files', f)); fd.append('include_mine', $('#cmbMine').checked ? '1' : '0'); fd.append('preview', '1');
  $('#cmbInfo').textContent = 'Reading reports…';
  try {
    const r = await api('/api/combine', {method: 'POST', body: fd});
    S.cmbSites = r.sites;
    $('#cmbInfo').innerHTML = `<ul>${r.sources.map(s => `<li>${esc(s.source)}: ${s.rows} rows</li>`).join('')}</ul>
      <b>${r.combined_rows} rows</b> after combining${r.duplicates ? `; ${r.duplicates} duplicate row(s) removed (listed on a separate sheet)` : ''}.
      One report per CFS: ${r.sites.map(x => `${esc(x.cfs || 'CFS not set')} (${x.rows})`).join(', ')}.`;
    $('#cmbBtn').textContent = r.sites.length > 1 ? `Download ${r.sites.length} combined reports (one per CFS)` : 'Download combined report';
    $('#cmbBtn').hidden = false;
  } catch (e) { $('#cmbInfo').textContent = e.message; $('#cmbBtn').hidden = true; }
}
$('#cmbFiles').onchange = e => { cmbFiles = [...e.target.files]; e.target.value = ''; combinePreview(); };
$('#cmbMine').onchange = combinePreview;
$('#cmbBtn').onclick = async () => {
  try {
    let n = 0;
    for (const x of S.cmbSites || []) {
      const fd = new FormData(); cmbFiles.forEach(f => fd.append('files', f)); fd.append('include_mine', $('#cmbMine').checked ? '1' : '0'); fd.append('site', siteParam(x.cfs));
      const r = await fetch('/api/combine', {method: 'POST', body: fd, headers: {'X-User': user()}});
      if (!r.ok) throw new Error((await r.json()).error || 'Could not combine');
      const blob = await r.blob(); const name = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'Combined_Stock_Report.xlsx';
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); n++;
      if ((S.cmbSites || []).length > 1) await pause(800);
    }
    toast(`Saved ${n} combined report${n === 1 ? '' : 's'} in your Downloads folder`, 5000);
  } catch (e) { toast(e.message); }
};
$('#backupBtn').onclick = async () => { try { const n = await download('/api/backup', 'CFS_Backup.json'); toast('Saved ' + n + ' in your Downloads folder – copy the newest backup file to the shared folder', 7000); } catch (e) { toast(e.message); } };

/* ---------- import ---------- */
let importFile = null;
$('#importFile').onchange = async e => {
  importFile = e.target.files[0]; if (!importFile) return;
  const fd = new FormData(); fd.append('file', importFile); fd.append('preview', '1');
  try {
    const r = await api('/api/import', {method: 'POST', body: fd});
    $('#importInfo').innerHTML = `<b>${esc(importFile.name)}</b>: ${r.rows} rows${r.site ? ' for ' + esc(r.site) : ''} found.${r.other_site ? ` ${r.other_site} rows of other CFS are skipped.` : ''}${r.transporter_fixed ? ` Transporter names found in the "Articles" column will be moved to "Transporter Name" (${r.transporter_fixed} rows).` : ''}`;
    $('#importBtn').hidden = false;
  } catch (err) { $('#importInfo').textContent = err.message; $('#importBtn').hidden = true; }
};
$('#importBtn').onclick = async () => {
  if (!user()) { $('#userName').focus(); toast('Enter your name first (top right)'); return; }
  const fd = new FormData(); fd.append('file', importFile);
  try { const r = await api('/api/import', {method: 'POST', body: fd}); toast(`Imported ${r.rows} rows`); $('#importBtn').hidden = true; showTab('stock'); }
  catch (err) { toast(err.message); }
};

/* ---------- Admin PIN card ---------- */
async function pinInfo() { try { const st = await api('/api/admin-pin'); $('#pinSet').textContent = st.set ? 'Change admin PIN' : 'Set admin PIN'; $('#pinInfo').textContent = st.set ? 'An admin PIN is set on this PC.' : 'No admin PIN set yet – editing and deleting added stock is blocked until it is set.'; } catch (e) {} }
$('#pinSet').onclick = async () => {
  const st = await api('/api/admin-pin');
  let current = '';
  if (st.set) { current = await askPin('Enter the CURRENT admin PIN.'); if (current === null) return; }
  const pin = await askPin('Enter the NEW admin PIN (6 to 12 digits, not 123456 or 111111).'); if (pin === null) return;
  const again = await askPin('Enter the new PIN once more.'); if (again === null) return;
  if (pin !== again) { await alertBox('The two PINs are not the same. Nothing was changed.'); return; }
  try { await api('/api/admin-pin', {json: {current, pin}}); toast('Admin PIN saved on this PC'); S.adminPin = null; pinInfo(); } catch (e) { await alertBox(e.message); }
};

/* ---------- Shipper & CHA list ---------- */
async function chaInfo() {
  try { const r = await api('/api/cha-list'); $('#chaInfo').innerHTML = `${r.uploaded ? `<b>${r.uploaded}</b> shippers from the uploaded list` : 'No list uploaded yet'} · ${r.list.length} shippers with a CHA in total (list + past shipments).`; } catch (e) {}
}
$('#chaFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  try { const r = await api('/api/cha-list', {method: 'POST', body: fd}); toast(`Shipper & CHA list saved: ${r.rows} shippers`); chaInfo(); META = await api('/api/meta'); buildDatalists(); }
  catch (err) { $('#chaInfo').textContent = err.message; }
};
$('#chaExport').onclick = async () => { try { const n = await download('/api/cha-list/export', 'Shipper_CHA_list.xlsx'); toast('Saved ' + n + ' in your Downloads folder'); } catch (e) { toast(e.message); } };
$('#chaClear').onclick = async () => { if (!(await confirmBox('Remove the uploaded Shipper & CHA list? (CHA names from past shipments are still suggested.)'))) return;
  const fd = new FormData(); fd.append('clear', '1'); await api('/api/cha-list', {method: 'POST', body: fd}); toast('List removed'); chaInfo(); };

/* ---------- start ---------- */
async function refreshCounts() {
  try { const s = await api('/api/stock'); $('#stockCount').textContent = s.rows.length || ''; const p = await api('/api/profiles'); $('#fmtCount').textContent = p.profiles.length || ''; } catch (e) {}
}
(async function init() {
  const mode = await window.CSD_READY;          // version 15: waits for sign-in when the central database is set up
  $('#userName').value = user();
  $('#userName').addEventListener('change', e => { try { localStorage.setItem('csd_user', e.target.value.trim()); } catch (er) {} });
  META = await api('/api/meta');
  buildDatalists();
  if (mode === 'cloud' && window.CSD.cloudUI) window.CSD.cloudUI.afterReady();
  const sel = $('#cfsSel');
  if (META.site_lock) {       // site mode: this PC works only for one site – no CFS choice anywhere
    document.body.classList.add('site-mode');
    if (sel) { sel.innerHTML = `<option selected>${esc(META.site_lock)}</option>`; sel.value = META.site_lock; sel.hidden = true; }
    const lab = document.querySelector('label[for="cfsSel"]'); if (lab) lab.hidden = true;
    S.cfs = '';
    document.title = 'CFS Stock Desk – ' + META.site_lock;
  } else if (sel && META.cfs_list) {
    sel.innerHTML = '<option value="">Choose CFS…</option>' + META.cfs_list.map(c => `<option ${c === META.warehouse ? 'selected' : ''}>${esc(c)}</option>`).join('');
    sel.onchange = () => { try { localStorage.setItem('csd_cfs', sel.value); } catch (e) {} META.warehouse = sel.value; $('#wh').textContent = sel.value || 'Choose this PC\'s CFS';
      if (S.header && !S.header['Warehouse ID'] && sel.value && !$('#review').hidden) { S.header['Warehouse ID'] = sel.value; S.hstatus['Warehouse ID'] = 'default'; renderHeader(); } };
  }
  $('#wh').textContent = META.site_lock ? META.site_lock + ' 🔒' : (META.warehouse || 'Choose this PC\'s CFS');
  if (META.site_lock) $('#wh').title = 'This PC works only for ' + META.site_lock + ' (opened with the site link).';
  setTimeout(() => { try { window.CSD.R.warm(); } catch (e) {} }, 2500);   // get the scan reader ready in the background
  $('#ocrPill').className = 'pill ' + (META.ocr ? 'on' : 'off'); $('#ocrPill').textContent = META.ocr ? 'OCR ready' : 'OCR off';
  window.CSD_META = META;
  const ai = META.ai || {};
  const aiPill = $('#aiPill');
  if (aiPill) { aiPill.className = 'pill ' + (ai.model_ready ? 'on' : 'off'); aiPill.textContent = ai.model_ready ? 'AI ready' : 'AI off'; }
  refreshCounts(); chaInfo(); pinInfo();
  if (!META.web) { setInterval(() => fetch('/api/ping').catch(() => {}), 20000); fetch('/api/ping').catch(() => {}); }
  if (window.PWA_READY) window.PWA_READY();
  try { const a = await api('/api/about'); $('#aboutInfo').textContent = `Version ${a.version} · PC ${a.pc} · data folder: ${a.data_dir}`; } catch (e) {}
})();
