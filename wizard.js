/* Version 16 – step-by-step reading.
   All documents are added at once; the app then goes page by page:
     Invoice (header fields) → Packing list page 1 → page 2 → … → VDF (Delivery No) → manual entries → check & save.
   Each step shows only that page and its fields (no scrolling to the right). New / doubtful values are asked one
   field at a time (Pick on the page, or type, or "Correct"); a trained page shows all its values with one
   "Correct – next page". Every Pick of an item field trains the shipper (see trainPick in app.js).
   Uses the helpers and state of app.js (S, META, $, $$, esc, lab, inputFor, readVal, startPick, stopPick, goToSrc…). */
(function () {
  'use strict';
  const INV_FIELDS = ['Vendor Name', 'Shipper invoice number', 'Invoice Date', 'Customer Name', 'Consignee', 'Port of Discharge', 'FPD', 'Cargo Description', 'IEC'];
  const LINE_FIELDS = ['PO Number', 'Style', 'Colour', 'Total Packages', 'Qty Type', 'Gross weight (kg)', 'Net weight (kg)', 'Total CBM', 'Item Qty (pcs)'];
  const OK_ST = new Set(['profile', 'picked', 'edited', 'trained', 'confirmed', 'default', 'fixed', 'template']);
  const W = {on: true, steps: [], i: 0, gap: null};
  window.CSD.wiz = W;
  const empty = v => v === undefined || v === null || v === '' || (typeof v === 'number' && isNaN(v));
  const pages = () => allPages();
  const typeOf = pg => S.pageTypes[pg.id] || 'other';

  /* ---------- the step list for these documents ---------- */
  function buildSteps() {
    /* v17.1: Carrefour documents read by the template → one screen (truck plate, cut-off, Save) */
    if (S.crf) { const pl = pages().find(p => typeOf(p) === 'packing') || pages()[0] || {}; W.steps = [{kind: 'quick', page: pl.id, title: 'Check & save'}]; return; }
    const ps = pages(), inv = ps.filter(p => typeOf(p) === 'invoice'), pl = ps.filter(p => typeOf(p) === 'packing'), vdf = ps.filter(p => typeOf(p) === 'vdf');
    const steps = [];
    steps.push({kind: 'invoice', page: (inv[0] || ps.find(p => typeOf(p) !== 'vdf') || ps[0] || {}).id, title: 'Invoice'});
    const linePages = pl.length && !S.plNA ? pl : (inv.length ? inv : ps.filter(p => typeOf(p) !== 'vdf'));
    const lineName = pl.length && !S.plNA ? 'Packing list' : 'Invoice (no packing list)';
    linePages.forEach((p, k) => steps.push({kind: 'lines', page: p.id, title: `${lineName} page ${k + 1}${linePages.length > 1 ? ' of ' + linePages.length : ''}`}));
    if (vdf.length || ITEM_SHOWN().includes('Delivery No')) steps.push({kind: 'vdf', page: vdf.length ? vdf[0].id : null, title: vdf.length ? 'VDF – Delivery No' : 'Delivery No (no VDF added)'});
    steps.push({kind: 'manual', page: null, title: 'Truck, cut-off & customs'});
    steps.push({kind: 'check', page: null, title: 'Check & save'});
    W.steps = steps;
  }
  /* which page an item line belongs to: where its style (or another of its values) was read */
  function pageOfItem(it) {
    if (it._page) return it._page;
    const src = it._src || {};
    for (const f of ['Style', ...LINE_FIELDS]) if (src[f]) return src[f][0];
    return null;
  }
  function linesOf(pageId) {
    const lineSteps = W.steps.filter(s => s.kind === 'lines'), first = lineSteps[0] && lineSteps[0].page;
    const onSteps = new Set(lineSteps.map(s => s.page));
    return S.items.map((it, i) => ({it, i})).filter(({it}) => { const p = pageOfItem(it); return p === pageId || ((!p || !onSteps.has(p)) && pageId === first); });
  }
  /* a value is asked when it is empty (and needed) or read automatically / not yet confirmed */
  const hStat = f => { const st = S.hstatus[f] || (S.hsrc[f] ? 'profile' : 'profile'); return st.startsWith('cha-') ? 'default' : st; };
  const hDoubt = f => empty(S.header[f]) ? isReq(f) : !OK_ST.has(hStat(f));
  const iDoubt = (it, f) => empty(it[f]) ? (isReq(f) || (LINE_FIELDS.includes(f) && S.need[f] !== 'no')) : !OK_ST.has(itemStatus(it, f) || 'profile');
  /* fields of a line: the 9 packing-list fields (as shown for this site), then other item fields this site needs */
  function lineFields() {
    const shown = ITEM_SHOWN();
    return [...LINE_FIELDS.filter(f => shown.includes(f) && S.need[f] !== 'no'), ...shown.filter(f => !LINE_FIELDS.includes(f) && f !== 'Delivery No' && isReq(f))];
  }
  function invFields() {
    const req = (META.required || []);
    const extra = HEADER_SHOWN().filter(f => !INV_FIELDS.includes(f) && req.includes(f) && empty(S.header[f]) && (f !== 'Warehouse ID' || !META.site_lock));
    return [...INV_FIELDS.filter(f => HEADER_SHOWN().includes(f) || f === 'Vendor Name'), ...extra];
  }
  /* gaps of the current step, in order */
  function gaps(step) {
    if (step.kind === 'invoice') return invFields().filter(hDoubt).map(f => ({scope: 'h', f}));
    if (step.kind === 'lines') { const out = []; for (const {it, i} of linesOf(step.page)) for (const f of lineFields()) if (iDoubt(it, f)) out.push({scope: 'i', f, row: i}); return out; }
    if (step.kind === 'vdf') return S.items.map((it, i) => ({it, i})).filter(({it}) => empty(it['Delivery No'])).map(({i}) => ({scope: 'i', f: 'Delivery No', row: i}));
    return [];
  }

  /* ---------- screen ---------- */
  const left = $('#review .left');
  const bar = document.createElement('div'); bar.id = 'wizBar'; bar.className = 'card wizbar';
  const card = document.createElement('div'); card.id = 'wizCard'; card.className = 'card wizcard';
  const warnBox = document.createElement('div'); warnBox.id = 'pickWarnBox'; warnBox.className = 'card wizwarn'; warnBox.hidden = true;
  left.prepend(card); left.prepend(bar); left.prepend(warnBox);
  /* v16.1: the trained layout did not fit this document well (shipper changed the layout?) */
  function showPickWarn(list) {
    warnBox.hidden = !(list && list.length);
    if (warnBox.hidden) return;
    const block = list.some(w => w.kind === 'block'), crf = list.every(w => ['carrefour', 'info', 'block'].includes(w.kind)), info = list.every(w => w.kind === 'info');
    warnBox.classList.toggle('wizblock', block);
    warnBox.innerHTML = info ? `<b>Note</b><ul>${list.map(w => `<li>${esc(w.msg)}</li>`).join('')}</ul>` : crf ? `<b>Please check the packing list.</b><ul>${list.map(w => `<li>${esc(w.msg)}</li>`).join('')}</ul><span class="small">The values concerned are asked in the packing-list steps.</span>`
      : `<b>This shipper's layout may have changed.</b><ul>${list.map(w => `<li>${esc(w.msg)}</li>`).join('')}</ul><span class="small">The values concerned are asked again in the packing-list steps. A new Pick replaces the old training.</span>`;
  }
  $('#extraBox').classList.add('wiz-manual'); $('.card.save').classList.add('wiz-check');
  [$('#headerForm').closest('.card'), $('#itemTable').closest('.card'), $('#needs'), $('#colsetBox')].forEach(el => el && el.classList.add('wiz-hide'));

  function render() {
    const R = $('#review');
    R.classList.toggle('wiz', W.on);
    if (!W.on) { bar.innerHTML = `<div class="row-between"><span class="muted small">Full view – all fields at once.</span><button class="btn small" id="wizOn" type="button">Step-by-step view</button></div>`; $('#wizOn').onclick = () => { W.on = true; try { localStorage.removeItem('csd_fullview'); } catch (e) {} go(W.i); }; card.hidden = true; return; }
    card.hidden = false;
    const st = W.steps[W.i];
    bar.innerHTML = st.kind === 'quick' ? `<div class="row-between"><span class="muted small"><b>Carrefour documents</b> – read and checked against the printed totals.</span><button class="btn small" id="wizOff" type="button">Full view</button></div>` : `<div class="wizsteps">${W.steps.map((s, k) => `<button type="button" class="wstep ${k === W.i ? 'cur' : ''} ${k < W.i ? 'done' : ''}" data-step="${k}" title="${esc(s.title)}">${k + 1}<span>${esc(short(s))}</span></button>`).join('')}</div>
      <div class="row-between"><span class="muted small">Step ${W.i + 1} of ${W.steps.length}</span><button class="btn small" id="wizOff" type="button">Full view</button></div>`;
    $$('#wizBar [data-step]').forEach(b => b.onclick = () => go(+b.dataset.step));
    $('#wizOff').onclick = () => { W.on = false; try { localStorage.setItem('csd_fullview', '1'); } catch (e) {} stopPick(); render(); renderHeader(); renderItems(); };
    R.classList.toggle('wiz-show-manual', st.kind === 'manual' || st.kind === 'quick');
    R.classList.toggle('wiz-show-check', st.kind === 'check' || st.kind === 'quick');
    R.classList.toggle('wiz-quick', st.kind === 'quick');
    if (st.kind === 'quick') return renderQuick(st);
    if (st.kind === 'manual') { $('#extraBox').open = true; card.innerHTML = head(st, 'Enter by hand as before: truck, arrival, cargo cut-off, customs. Then go to the last step to save.') + nav(); bindNav(); return; }
    if (st.kind === 'check') return renderCheck(st);
    const g = gaps(st).filter(x => !(W.skip && W.skip.has(key(x))));
    if (!g.length) return renderAllGood(st);
    W.gap = g[0];
    renderAsk(st, g);
  }
  const short = s => s.kind === 'invoice' ? 'Invoice' : s.kind === 'lines' ? 'PL ' + (W.steps.filter(x => x.kind === 'lines').indexOf(s) + 1) : s.kind === 'vdf' ? 'VDF' : s.kind === 'manual' ? 'Manual' : 'Save';
  const head = (st, sub) => `<div class="wizhead"><h3>${esc(st.title)}</h3>${sub ? `<p class="muted small">${sub}</p>` : ''}</div>`;
  const nav = (nextLabel) => `<div class="row-between wiznav"><button type="button" class="btn" id="wzBack" ${W.i ? '' : 'disabled'}>← Back</button>${W.i < W.steps.length - 1 ? `<button type="button" class="btn primary" id="wzNext">${nextLabel || 'Next →'}</button>` : ''}</div>`;
  function bindNav() { if ($('#wzBack')) $('#wzBack').onclick = () => go(W.i - 1); if ($('#wzNext')) $('#wzNext').onclick = () => go(W.i + 1); }
  function valOf(gp) { return gp.scope === 'h' ? S.header[gp.f] : S.items[gp.row][gp.f]; }
  function srcOf(gp) { return gp.scope === 'h' ? S.hsrc[gp.f] : (S.items[gp.row]._src || {})[gp.f]; }
  function stOf(gp) { return gp.scope === 'h' ? (S.hstatus[gp.f] || '') : itemStatus(S.items[gp.row], gp.f); }

  /* one field at a time */
  function renderAsk(st, g) {
    const gp = W.gap, v = valOf(gp), s = stOf(gp), line = gp.scope === 'i' ? linesOf(st.page).findIndex(x => x.i === gp.row) : -1;
    const total = st.kind === 'invoice' ? invFields().length : st.kind === 'lines' ? linesOf(st.page).length * lineFields().length : S.items.length;
    const noPL = gp.scope === 'i' && S.items[gp.row] && S.items[gp.row]._missingPL;
    const what = noPL && empty(v) ? 'this item\'s packing list is not among the documents – add it and read again, or type the value' : empty(v) ? 'not found yet' : s === 'auto' ? 'read automatically – please check' : s === 'fixed' || s === 'default' ? 'remembered default – please check' : 'please check';
    card.innerHTML = head(st, `${g.length} field${g.length === 1 ? '' : 's'} to check on this page (of ${total})${st.kind === 'lines' && S.shipperTrained ? '' : ' · each Pick is remembered for this shipper'}`) +
      `<div class="wizask">
        <div class="wizq">${gp.scope === 'i' && st.kind !== 'invoice' ? `<span class="pill">Line ${line + 1}${S.items[gp.row].Style ? ' · ' + esc(S.items[gp.row].Style) : ''}</span> ` : ''}<b>${esc(lab(gp.f))}</b> <span class="muted small">– ${what}</span></div>
        <div class="wizin">${inputFor(gp.f, v ?? '', `data-wiz="1" class="${empty(v) ? 'st-missing' : s === 'auto' ? 'st-auto' : ''}"`)}</div>
        <p class="muted small">Click the value in the page on the right${empty(v) ? '' : ', or press <b>Correct</b> if it is right'} – or type it.</p>
        <div class="row-end wizbtns">${gp.scope === 'i' && empty(v) && !isReq(gp.f) ? '<button type="button" class="btn" id="wzNone" title="This shipper\'s documents never show it">Not on these documents</button>' : ''}<button type="button" class="btn" id="wzSkip">Skip</button><button type="button" class="btn" id="wzPick">⌖ Pick again</button><button type="button" class="btn primary" id="wzOk" ${empty(v) ? 'disabled' : ''}>✓ Correct</button></div>
      </div>` + lineSummary(st) + nav('Next page →');
    bindNav();
    const el = $('#wizCard [data-wiz]');
    el.addEventListener('input', () => { $('#wzOk').disabled = el.value.trim() === ''; });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#wzOk').click(); } });
    $('#wzOk').onclick = () => {
      const changed = el.value !== String(v ?? '');
      if (gp.f === 'Qty Type') { if (setQtyType(el.value)) next(); return; }   // every line + shipper default
      /* "Correct" on a value read from the page also trains this shipper for the whole column (same as a Pick) */
      if (!changed && gp.scope === 'i' && window.CSD.P.PICK_FIELDS.includes(gp.f) && srcOf(gp) && trainPick(gp.f, gp.row, srcOf(gp), v)) { stopPick(); next(); return; }
      const nv = readVal(el);
      /* typed for a column the page does not print (e.g. Type = PCS): every empty line gets it, and the shipper remembers it */
      if (changed && gp.scope === 'i' && empty(v) && !srcOf(gp) && !isNum(gp.f) && gp.f !== 'Style' && !empty(nv)) {
        let n = 0; S.items.forEach(it => { if (empty(it[gp.f])) { it[gp.f] = nv; (it._st = it._st || {})[gp.f] = 'edited'; n++; } });
        const sh = String(S.header['Vendor Name'] || '').trim().toUpperCase();
        if (sh) api('/api/profile/pick', {json: {shipper: sh, field: gp.f, fixed: nv}}).then(() => toast(`${lab(gp.f)} = ${nv}: filled in ${n} line(s) and remembered for ${sh}.`, 5000)).catch(e => toast(e.message, 5000));
        next(); return;
      }
      setVal(gp, nv, changed ? 'edited' : 'confirmed'); next();
    };
    if ($('#wzNone')) $('#wzNone').onclick = () => { S.need[gp.f] = 'no'; renderColset(); toast(`${lab(gp.f)}: not on this shipper's documents – not asked again (Column settings).`, 4500); next(); };
    $('#wzSkip').onclick = () => { W.skip = W.skip || new Set(); W.skip.add(key(gp)); next(); };
    $('#wzPick').onclick = () => armPick(gp);
    if (srcOf(gp)) goToSrc(srcOf(gp)); else showPage(st.page);
    armPick(gp);
    $$('#wizCard [data-jump]').forEach(b => b.onclick = () => { const [r, f] = b.dataset.jump.split('|'); W.gap = {scope: 'i', f, row: +r}; renderAsk(st, g); });
    plNote(st);
    setTimeout(() => el.focus(), 30);
  }
  /* no packing list among the documents (Tuticorin): the choice that was in the Items card */
  function plNote(st) {
    if (st.kind !== 'lines' || S.hasPL || !isTut()) return;
    card.insertAdjacentHTML('afterbegin', `<div class="wizwarn"><b>No packing list found.</b> Add it with the invoice and read again, or
      <label class="check"><input type="checkbox" id="wzPlNA" ${S.plNA ? 'checked' : ''}> Packing list not available – take these values from the invoice</label></div>`);
    $('#wzPlNA').onchange = e => { $('#plNA').checked = e.target.checked; $('#plNA').dispatchEvent(new Event('change')); };
  }
  const key = gp => gp.scope + '|' + (gp.row ?? '') + '|' + gp.f;
  function armPick(gp) { startPick({field: gp.f, scope: gp.scope, row: gp.scope === 'h' ? null : gp.row}); $('#pickBanner').hidden = true; }
  function setVal(gp, v, how) {
    if (gp.scope === 'h') { S.header[gp.f] = v; S.hstatus[gp.f] = how; if (gp.f === 'Customer Name') fillCustomer(); }
    else { const it = S.items[gp.row]; it[gp.f] = v; (it._st = it._st || {})[gp.f] = how; }
  }
  function next() { stopPick(); const st = W.steps[W.i]; const g = gaps(st).filter(x => !(W.skip && W.skip.has(key(x)))); if (!g.length) { render(); return; } W.gap = g[0]; renderAsk(st, g); }
  /* compact view of the lines of this page (no wide table) */
  function lineSummary(st) {
    if (st.kind !== 'lines' && st.kind !== 'vdf') return '';
    const ls = st.kind === 'vdf' ? S.items.map((it, i) => ({it, i})) : linesOf(st.page), fs = st.kind === 'vdf' ? ['PO Number', 'Style', 'Delivery No'] : lineFields();
    return `<div class="wizlines">${ls.map(({it, i}, k) => `<div class="wline"><div class="wline-h">Line ${k + 1}</div><div class="wline-g">${fs.map(f => {
      const bad = iDoubt(it, f) || (S.rowErrors[i] || []).some(w => w.field === f && w.level === 'error');
      return `<button type="button" class="wcell ${bad ? (empty(it[f]) ? 'miss' : 'doubt') : 'ok'}" data-jump="${i}|${esc(f)}" title="${esc(lab(f))}"><small>${esc(lab(f))}</small><span>${empty(it[f]) ? '—' : esc(it[f])}</span></button>`;
    }).join('')}</div></div>`).join('')}</div>`;
  }
  /* a trained / finished page: all its values at once */
  function renderAllGood(st) {
    let body = '';
    if (st.kind === 'invoice') body = `<div class="wline-g wide">${invFields().map(f => `<button type="button" class="wcell ok" data-h="${esc(f)}"><small>${esc(lab(f))}</small><span>${empty(S.header[f]) ? '—' : esc(S.header[f])}</span></button>`).join('')}</div>`;
    else if (st.kind === 'lines' && !linesOf(st.page).length) body = `<p class="muted">No line was found on this page. If it has a line, add it and pick its values.</p><button type="button" class="btn" id="wzAddLine">+ This page has a line</button>`;
    else body = lineSummary(st);
    card.innerHTML = head(st, st.kind === 'lines' && linesOf(st.page).length ? 'All values of this page are filled from the saved format. Click a value to change it.' : st.kind === 'invoice' ? 'All invoice values are filled. Click a value to change it.' : '') + body +
      `<div class="row-between wiznav"><button type="button" class="btn" id="wzBack" ${W.i ? '' : 'disabled'}>← Back</button><button type="button" class="btn primary" id="wzNext">✓ Correct – next ${W.steps[W.i + 1] && W.steps[W.i + 1].kind === 'lines' ? 'page' : 'step'} →</button></div>`;
    bindNav();
    if ($('#wzAddLine')) $('#wzAddLine').onclick = () => { S.items.push({_page: st.page, 'PO Number': (S.items[S.items.length - 1] || {})['PO Number'] || ''}); if (S.items.length === 2 && !Object.keys(S.items[0]).some(k => !k.startsWith('_') && !empty(S.items[0][k]))) S.items.shift(); render(); };
    $$('#wizCard [data-jump]').forEach(b => b.onclick = () => { const [r, f] = b.dataset.jump.split('|'); W.gap = {scope: 'i', f, row: +r}; renderAsk(st, [W.gap]); });
    $$('#wizCard [data-h]').forEach(b => b.onclick = () => { W.gap = {scope: 'h', f: b.dataset.h}; renderAsk(st, [W.gap]); });
    showPage(st.page); plNote(st);
  }
  /* last step: packing list vs invoice differences (one tick), totals, save */
  function renderCheck(st) {
    const diffs = S.items.map((it, i) => ({it, i})).filter(({it}) => it._diff && Object.keys(it._diff).length);
    const left = [...new Set(W.steps.filter(s => s.kind === 'invoice' || s.kind === 'lines' || s.kind === 'vdf').flatMap(s => gaps(s).map(g => s.title)))];
    renderTotals();
    card.innerHTML = head(st, '') +
      (left.length ? `<div class="wizwarn">Still to check: ${left.map(t => `<b>${esc(t)}</b>`).join(', ')} (skipped fields).</div>` : '') +
      (diffs.length ? `<div class="wizdiff"><h4>Packing list and invoice differ</h4><table class="grid"><thead><tr><th>Line</th><th>Style</th><th>Field</th><th>Packing list</th><th>Invoice</th></tr></thead><tbody>${diffs.flatMap(({it, i}) => Object.entries(it._diff).map(([f, v]) => `<tr><td>${i + 1}</td><td>${esc(it.Style || '')}</td><td>${esc(lab(f))}</td><td><b>${esc(it[f])}</b></td><td>${esc(v)}</td></tr>`)).join('')}</tbody></table>
        <label class="check"><input type="checkbox" id="wzDiffOk" ${diffs.every(({it}) => it._chkDiff) ? 'checked' : ''}> I have checked these differences – the packing list values are taken</label></div>` : '<p class="muted small">Packing list and invoice agree.</p>') +
      `<div class="totals">${$('#totals').innerHTML}</div><p class="muted small">${S.items.length} line(s). Press <b>Save</b> below.</p>` + nav();
    bindNav();
    if ($('#wzDiffOk')) $('#wzDiffOk').onchange = e => { diffs.forEach(({it}) => { it._chkDiff = e.target.checked; }); };
    stopPick();
  }
  function showPage(pageId) {
    if (!pageId) return; const i = pages().findIndex(p => p.id === pageId);
    if (i >= 0 && i !== S.page) { S.page = i; renderViewer(); } else highlightSrc();
  }
  function go(i) {
    if (i < 0 || i >= W.steps.length) return;
    stopPick(); W.i = i; W.skip = new Set(); render();
    const st = W.steps[i]; if (st.page) showPage(st.page);
    $('#review').scrollIntoView({block: 'start'});
  }
  /* ---------- v17.1: one screen for Carrefour documents ---------- */
  const TRUCK = ['Truck Plate Number', 'Cargo Cutoff Date', 'Cargo Cutoff Time'];
  const xv = f => S.extra[f] !== undefined ? S.extra[f] : S.header[f];
  function quickGaps() {
    const out = invFields().filter(hDoubt).map(f => ({scope: 'h', f, why: empty(S.header[f]) ? 'not found on the documents' : 'not confirmed by the packing list – check'}));
    const hasVdf = pages().some(p => typeOf(p) === 'vdf');
    S.items.forEach((it, i) => {
      for (const f of lineFields()) if (iDoubt(it, f)) out.push({scope: 'i', f, row: i, why: it._missingPL && empty(it[f]) ? 'its packing list is not among the documents – add it and read again, or type it' : empty(it[f]) ? 'not found' : 'does not add up with the printed totals – check'});
      if (hasVdf && !S.vdfWrong && empty(it['Delivery No'])) out.push({scope: 'i', f: 'Delivery No', row: i, why: 'PO not on the VDF – type it'});
    });
    for (const k of (W.extraEdit || [])) { const [sc, r, f] = k.split('|'); if (!out.some(g => key(g) === k)) out.push({scope: sc, row: sc === 'i' ? +r : undefined, f, why: 'opened to change'}); }
    return out;
  }
  function renderQuick(st) {
    const G = quickGaps(), H = S.header, n = S.items.length;
    const sum = f => S.items.reduce((a, it) => a + (Number(it[f]) || 0), 0);
    const tot = `${n} line${n === 1 ? '' : 's'} · ${sum('Total Packages')} ctns · ${Math.round(sum('Total CBM') * 1000) / 1000} CBM · ${Math.round(sum('Gross weight (kg)') * 100) / 100} kg`;
    const hcell = f => `<button type="button" class="wcell ${hDoubt(f) ? (empty(H[f]) ? 'miss' : 'doubt') : 'ok'}" data-qh="${esc(f)}"><small>${esc(lab(f))}</small><span>${empty(H[f]) ? '—' : esc(H[f])}</span></button>`;
    const lineOf = i => { const it = S.items[i]; return `Line ${i + 1}${it.Style ? ' · ' + esc(it.Style) : ''}${it.Colour ? ' · ' + esc(it.Colour) : ''}`; };
    card.innerHTML = `<div class="wizhead"><h3>${esc(H['Shipper invoice number'] || 'Invoice')} · ${esc(H['Vendor Name'] || '')}</h3><p class="muted small">${tot}</p></div>
      ${S.scanned ? '<div class="wizwarn"><b>Scanned copy.</b> Digital files (the e-mailed PDF / Excel) are read exactly – ask the CHA / trucker for the original file; check the amber values against the paper.</div>' : ''}
      ${S.vdfWrong ? '<div class="wizwarn wizblock"><b>Wrong VDF attached</b> – none of its POs match this invoice. Remove it (Start over), add the right VDF and read again. Saving is blocked.</div>' : ''}
      <div class="wline-g wide">${['Invoice Date', 'Customer Name', 'Consignee', 'Port of Discharge', 'FPD', 'Cargo Description'].filter(f => HEADER_SHOWN().includes(f) || f === 'Cargo Description').map(hcell).join('')}</div>
      ${G.length ? `<div class="wizask quickfix"><div class="wizq"><b>${G.length} value${G.length === 1 ? '' : 's'} to fix</b> <span class="muted small">– everything else is read and checked</span></div>
        ${G.map((g, k) => `<div class="qrow"><div class="qlab">${g.scope === 'i' ? `<span class="pill">${lineOf(g.row)}</span> ` : ''}<b>${esc(lab(g.f))}</b><div class="muted small">${esc(g.why)}${(g.scope === 'h' ? S.hsrc[g.f] : (S.items[g.row]._src || {})[g.f]) ? ` · <a href="#" data-qshow="${k}">show on the page</a>` : ''}</div></div>
          <div class="qin">${inputFor(g.f, (g.scope === 'h' ? H[g.f] : S.items[g.row][g.f]) ?? '', `data-q="${k}"`)}</div></div>`).join('')}</div>` : ''}
      <div class="wizlines">${S.items.map((it, i) => `<div class="wline"><div class="wline-h">${lineOf(i)}</div><div class="wline-g">${lineFields().filter(f => !['PO Number', 'Style', 'Colour'].includes(f) || true).map(f => {
        const bad = iDoubt(it, f); return `<button type="button" class="wcell ${bad ? (empty(it[f]) ? 'miss' : 'doubt') : 'ok'}" data-qi="${i}|${esc(f)}" title="Click to change"><small>${esc(lab(f))}</small><span>${empty(it[f]) ? '—' : esc(it[f])}</span></button>`; }).join('')}${pages().some(p => typeOf(p) === 'vdf') ? `<button type="button" class="wcell ${empty(it['Delivery No']) ? 'miss' : 'ok'}" data-qi="${i}|Delivery No"><small>Delivery No</small><span>${empty(it['Delivery No']) ? '—' : esc(it['Delivery No'])}</span></button>` : ''}</div></div>`).join('')}</div>
      <div class="quicktruck"><h4>Truck</h4><div class="qtgrid">${TRUCK.map(f => `<div class="fld"><label><span class="req">${esc(lab(f))}</span>${S.hstatus[f] === 'template' && S.extra[f] === undefined ? ' <span class="muted small">(from the booking list)</span>' : ''}</label><div class="in">${inputFor(f, xv(f) ?? '', `data-qt="${esc(f)}"`)}</div></div>`).join('')}</div>
        <p class="muted small">Truck arrival is stamped at Save (change it under the "More fields" box below if the truck came earlier).</p></div>
      <div class="row-end wiznav"><button type="button" class="btn" id="qNext" ${S.vdfWrong ? 'disabled' : ''} title="Save this invoice; the truck plate and cut-off stay filled for the next invoice of the same truck">Save &amp; add next invoice (same truck)</button><button type="button" class="btn primary" id="qSave" ${S.vdfWrong ? 'disabled' : ''}>Save</button></div>`;
    $$('#wizCard [data-q]').forEach(el => el.addEventListener('change', () => { const g = G[+el.dataset.q]; setVal(g, readVal(el), 'edited'); }));
    $$('#wizCard [data-qshow]').forEach(a => a.onclick = e => { e.preventDefault(); const g = G[+a.dataset.qshow]; goToSrc(g.scope === 'h' ? S.hsrc[g.f] : S.items[g.row]._src[g.f]); });
    $$('#wizCard [data-qt]').forEach(el => el.addEventListener('change', () => { S.extra[el.dataset.qt] = readVal(el); renderExtra(); }));
    $$('#wizCard [data-qi]').forEach(b => b.onclick = () => { const [r, f] = b.dataset.qi.split('|'); (W.extraEdit = W.extraEdit || []).push(`i|${r}|${f}`); renderQuick(st); const src = (S.items[+r]._src || {})[f]; if (src) goToSrc(src); });
    $$('#wizCard [data-qh]').forEach(b => b.onclick = () => { (W.extraEdit = W.extraEdit || []).push(`h||${b.dataset.qh}`); renderQuick(st); if (S.hsrc[b.dataset.qh]) goToSrc(S.hsrc[b.dataset.qh]); });
    const doQ = next => {
      $$('#wizCard [data-q], #wizCard [data-qt]').forEach(el => el.dispatchEvent(new Event('change')));
      const miss = TRUCK.filter(f => empty(xv(f)));
      if (miss.length) { toast('Please fill: ' + miss.map(lab).join(', '), 4000); const el = $(`#wizCard [data-qt="${miss[0]}"]`); if (el) el.focus(); return; }
      W.keepNext = next; $('#saveBtn').click();
    };
    $('#qSave').onclick = () => doQ(false); $('#qNext').onclick = () => doQ(true);
    stopPick(); showPage(st.page);
    const first = $('#wizCard [data-q]') || $(`#wizCard [data-qt="${TRUCK.find(f => empty(xv(f))) || TRUCK[0]}"]`); if (first) setTimeout(() => first.focus(), 30);
  }
  /* after a successful save: "Save & add next invoice" keeps the truck plate, cut-off and arrival for the next reading */
  W.afterSave = (r, header) => {
    if (r && r.notes && r.notes.length) toast(r.notes.join(' '), 8000);
    if (W.keepNext) {
      const keep = {}; for (const f of [...TRUCK, 'Allow Date', 'Allow Time']) if (!empty(header[f])) keep[f] = header[f];
      try { sessionStorage.setItem('csd_keep_truck', JSON.stringify(keep)); } catch (e) {}
      W.keepNext = false; resetRead(); toast(`Saved. Truck ${keep['Truck Plate Number'] || ''} kept – add the next invoice's documents.`, 6000);
    } else { try { sessionStorage.removeItem('csd_keep_truck'); } catch (e) {} }
  };
  /* a save error was clicked: go to the step of that field and ask it */
  W.jump = (f, row) => {
    let k = -1, gp = null;
    if (W.steps[0] && W.steps[0].kind === 'quick') { (W.extraEdit = W.extraEdit || []).push(row === null || row === undefined ? `h||${f}` : `i|${row}|${f}`); W.i = 0; render(); return true; }
    if (row === null || row === undefined) { if (invFields().includes(f)) { k = W.steps.findIndex(s => s.kind === 'invoice'); gp = {scope: 'h', f}; } else k = W.steps.findIndex(s => s.kind === 'manual'); }
    else if (f === 'Delivery No') { k = W.steps.findIndex(s => s.kind === 'vdf'); gp = {scope: 'i', f, row}; }
    else if (lineFields().includes(f)) { const pg = pageOfItem(S.items[row]); k = W.steps.findIndex(s => s.kind === 'lines' && s.page === pg); if (k < 0) k = W.steps.findIndex(s => s.kind === 'lines'); gp = {scope: 'i', f, row}; }
    if (k < 0) return false;
    stopPick(); W.i = k; W.skip = new Set(); render();
    if (gp) { W.gap = gp; renderAsk(W.steps[k], [gp]); }
    $('#review').scrollIntoView({block: 'start'});
    return true;
  };
  /* after any pick / change made elsewhere (trainPick fills whole columns): show the current step again */
  W.refresh = () => { if (!W.on || $('#review').hidden) return; const st = W.steps[W.i]; if (st && (st.kind === 'invoice' || st.kind === 'lines' || st.kind === 'vdf')) next(); };

  /* start when a reading opens */
  const openOrig = window.openReview;
  window.openReview = function (j) {
    openOrig(j);
    const res = (j && j.result) || {};
    S.crf = !!res.crf; S.vdfWrong = !!res.vdf_wrong; S.scanned = !!res.scanned; W.extraEdit = []; W.keepNext = false;
    /* the next invoice of the same truck: truck plate, cut-off and arrival kept */
    try { const k = JSON.parse(sessionStorage.getItem('csd_keep_truck') || 'null'); if (k) { for (const [f, v] of Object.entries(k)) S.extra[f] = v; renderExtra(); } } catch (e) {}
    showPickWarn(res.pick_warn);
    if (!S.docs || !S.docs.length) { W.on = false; render(); return; }
    try { W.on = localStorage.getItem('csd_fullview') !== '1'; } catch (e) { W.on = true; }
    buildSteps(); W.i = 0; W.skip = new Set(); render();
    const st = W.steps[0]; if (st.page) showPage(st.page);
  };
  W.rebuild = () => { if ($('#review').hidden || !W.steps.length) return; const cur = W.steps[W.i] && W.steps[W.i].kind; buildSteps(); let k = W.steps.findIndex(s => s.kind === cur); if (k < 0) k = 0; if (W.on) go(k); else W.i = k; };
})();
