/* Version 15 screens: Reports card (inbound & outbound with remarks, OSD, EV tag, ageing, turnaround, late cargo,
   admin changes), the booking list upload (Customer service), and admin settings (EV customers, turnaround limit,
   rows without a CFS). Uses the helpers of app.js. */
(function () {
  'use strict';
  const ist = window.CSD.ist;
  const isAdmin = () => !(window.CSD.cloud && window.CSD.cloud.enabled) || (window.CSD.cloud.profile && window.CSD.cloud.profile.role === 'admin');
  const lastWeek = () => { const d = ist.date(), dow = ist.dow(); const mon = ist.addDays(d, -((dow + 6) % 7) - 7); return [mon, ist.addDays(mon, 6)]; };
  const lastMonth = () => { const [y, m] = ist.date().split('-').map(Number); const a = new Date(Date.UTC(y, m - 2, 1)), b = new Date(Date.UTC(y, m - 1, 0)); return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)]; };
  window.CSD.periods = {lastWeek, lastMonth};

  /* ---------- Reports card (Stock tab) ---------- */
  const card = document.createElement('div'); card.className = 'card'; card.id = 'r15Card';
  card.innerHTML = `<div class="row-end" style="justify-content:space-between"><h3 style="margin:0">Reports</h3><span class="muted small">Day <input type="date" id="r15Day"></span></div>
    <div class="r15grid">
      <button class="btn" type="button" data-r="inout"><b>Inbound &amp; outbound</b><small>per customer, with remarks · sent with the Closing report</small></button>
      <button class="btn" type="button" data-r="osd"><b>OSD report</b><small>received the day before + all open OSD · sent at 10:00</small></button>
      <button class="btn" type="button" data-r="ageing"><b>Ageing</b><small>0–7 / 8–15 / 16–30 / over 30 days · Mondays</small></button>
      <button class="btn" type="button" data-r="ev"><b>EV tag report</b><small>last week (Mondays) · last month (1st)</small></button>
      <button class="btn" type="button" data-r="turnaround"><b>Truck turnaround &amp; labour</b><small>last week · Mondays</small></button>
      <button class="btn" type="button" data-r="late"><b>Late cargo</b><small>arrived after the cargo cut-off</small></button>
      <button class="btn admin-only" type="button" data-r="admin"><b>Admin changes</b><small>edits, deletes, returns, overrides · daily</small></button>
    </div>`;
  const slot = $('#slotCard'); slot.after(card);
  $('#r15Day').value = ist.date();
  const day = () => $('#r15Day').value || ist.date();
  $$('#r15Card [data-r]').forEach(b => b.onclick = async () => {
    const r = b.dataset.r;
    if (r === 'inout') return inoutDialog();
    if (r === 'ev') { const which = await choosePeriod('EV tag report'); if (!which) return; return download(`/api/r15/ev?from=${which[0]}&to=${which[1]}`, 'EV_Tag_Report.xlsx'); }
    if (r === 'turnaround') { const which = await choosePeriod('Truck turnaround & labour'); if (!which) return; return download(`/api/r15/turnaround?from=${which[0]}&to=${which[1]}`, 'Truck_Turnaround.xlsx'); }
    download(`/api/r15/${r}?day=${day()}`, r + '.xlsx');
  });
  function choosePeriod(title) {
    return new Promise(res => {
      let d = $('#periodDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'periodDlg'; document.body.appendChild(d); }
      const [w1, w2] = lastWeek(), [m1, m2] = lastMonth();
      d.innerHTML = `<form method="dialog" class="dlg-pad"><h3>${esc(title)}</h3><div class="form-grid">
        <label><input type="radio" name="pp" value="w" checked> Last week (${esc(w1)} to ${esc(w2)})</label><label><input type="radio" name="pp" value="m"> Last month (${esc(m1)} to ${esc(m2)})</label>
        <label><input type="radio" name="pp" value="c"> From <input type="date" id="ppFrom" value="${w1}"> to <input type="date" id="ppTo" value="${ist.date()}"></label></div>
        <div class="row-end"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">Download</button></div></form>`;
      d.showModal();
      d.addEventListener('close', () => { if (d.returnValue !== 'ok') return res(null); const v = d.querySelector('[name="pp"]:checked').value; res(v === 'w' ? [w1, w2] : v === 'm' ? [m1, m2] : [$('#ppFrom').value, $('#ppTo').value]); }, {once: true});
    });
  }
  /* inbound & outbound: preview with remarks the operator can add to before downloading / sending */
  async function inoutDialog() {
    let r; try { r = await api(`/api/r15/inout?day=${day()}&format=json`); } catch (e) { return toast(e.message, 5000); }
    let d = $('#inoutDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'inoutDlg'; d.className = 'wide'; document.body.appendChild(d); }
    const io = r.io, f2 = v => Number(v || 0).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    d.innerHTML = `<form method="dialog" class="dlg-pad"><div class="row-end" style="justify-content:space-between"><h3 style="margin:0">Inbound &amp; outbound – ${esc(io.site || '')} – ${esc(window.CSD.r15.dLong(io.day))}</h3><button class="btn small" value="close">Close</button></div>
      <div class="table-wrap"><table class="grid io"><thead><tr><th>Cargo in CFS</th><th class="num">CBM</th><th class="num">Inbound trucks</th><th class="num">Inbound CBM</th><th class="num">Total inbound CBM</th><th class="num">Offloaded</th><th class="num">Pending trucks</th><th class="num">Pending CBM</th><th class="num">Stuffed</th><th class="num">Outbound CBM</th><th class="num">End day inventory</th><th>Remarks</th></tr></thead><tbody>
      ${io.rows.map((x, i) => `<tr><td><b>${esc(x.customer)}</b></td><td class="num">${f2(x.opening)}</td><td class="num">${x.inTrucks}</td><td class="num">${f2(x.inCbm)}</td><td class="num">${f2(x.totalIn)}</td><td class="num">${x.offloaded}</td><td class="num">${x.pendTrucks}</td><td class="num">${f2(x.pendCbm)}</td><td class="num">${x.outContainers}</td><td class="num">${f2(x.outCbm)}</td><td class="num"><b>${f2(x.end)}</b></td>
        <td><input data-rem="${esc(x.customer)}" value="${esc(x.remarks)}" style="min-width:260px"></td></tr>`).join('') || '<tr><td colspan="12" class="muted">No cargo.</td></tr>'}
      <tr class="tot"><td>TOTAL</td><td class="num">${f2(io.total.opening)}</td><td class="num">${io.total.inTrucks}</td><td class="num">${f2(io.total.inCbm)}</td><td class="num">${f2(io.total.totalIn)}</td><td class="num">${io.total.offloaded}</td><td class="num">${io.total.pendTrucks}</td><td class="num">${f2(io.total.pendCbm)}</td><td class="num">${io.total.outContainers}</td><td class="num">${f2(io.total.outCbm)}</td><td class="num">${f2(io.total.end)}</td><td></td></tr>
      </tbody></table></div><p class="muted small">Remarks are filled from the day's events – add to them before downloading or sending. The Excel also has the late cargo of the day.</p>
      <div class="row-end"><button class="btn" type="button" id="ioDl">⬇ Download Excel</button>${window.CSD.mailer ? '<button class="btn primary" type="button" id="ioSend">Send now by e-mail</button>' : ''}</div></form>`;
    d.showModal();
    const remarks = () => { const o = {}; $$('#inoutDlg [data-rem]').forEach(el => { o[el.dataset.rem] = el.value.trim(); }); window.CSD.ioRemarks = {day: io.day, remarks: o}; return o; };
    $('#ioDl').onclick = async () => { const res = await fetch(`/api/r15/inout?day=${io.day}`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-User': user()}, body: JSON.stringify({remarks: remarks()})}); saveBlob(await res.blob(), `Inbound_Outbound_${io.day}.xlsx`); };
    if ($('#ioSend')) $('#ioSend').onclick = async () => { remarks(); try { await window.CSD.mailer.sendNow('closing_io', {day: io.day}); toast('Sent'); } catch (e) { toast(e.message, 6000); } };
    $$('#inoutDlg [data-rem]').forEach(el => el.onchange = remarks);
  }
  function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

  /* ---------- booking list (Plan tab) ---------- */
  const bk = document.createElement('div'); bk.className = 'card'; bk.id = 'bookingCard';
  bk.innerHTML = `<h3>Booking list from Customer service</h3>
    <p class="muted small">PO → SHIP TO, FOB, SHIP CXL. Used for SHIP TO in the plan check and for the ship-cancel marks on the Stock screen (amber within 10 days, red within 5 days or passed – only cargo not in a plan). Upload again any time: the same PO is updated.</p>
    <div class="row-end" style="justify-content:flex-start"><label class="btn" for="bookFile">Choose booking list (.xlsx)…</label><input type="file" id="bookFile" accept=".xlsx,.xls" hidden>
      <span class="small" id="bookInfo"></span><button class="btn primary" id="bookGo" type="button" hidden>Save booking list</button></div>`;
  $('#tab-plan .card').before(bk);
  let bookFile = null;
  async function bookCount() { try { const r = await api('/api/booking'); $('#bookInfo').textContent = r.count ? `${r.count} PO row(s) in the booking list.` : 'No booking list yet.'; } catch (e) {} }
  $('#bookFile').onchange = async e => {
    bookFile = e.target.files[0]; if (!bookFile) return; const fd = new FormData(); fd.append('file', bookFile); fd.append('preview', '1');
    try { const r = await api('/api/booking', {method: 'POST', body: fd}); $('#bookInfo').innerHTML = `<b>${r.rows}</b> PO row(s) found${r.no_cxl ? ` · <span class="err">${r.no_cxl} without SHIP CXL</span>` : ''}.`; $('#bookGo').hidden = false; }
    catch (er) { $('#bookInfo').textContent = er.message; $('#bookGo').hidden = true; }
    e.target.value = '';
  };
  $('#bookGo').onclick = async () => { const fd = new FormData(); fd.append('file', bookFile); try { const r = await api('/api/booking', {method: 'POST', body: fd}); toast(`Booking list saved – ${r.rows} PO rows (${r.changed} new or changed)`); $('#bookGo').hidden = true; bookCount(); } catch (e) { toast(e.message, 5000); } };

  /* ---------- admin settings (Admin tab, central version) ---------- */
  window.CSD.adminExtras = async function (sec) {
    const box = document.createElement('div'); box.className = 'card';
    box.innerHTML = `<h3>Report settings</h3><div class="form-grid">
      <label>Customers that need the EV tag report (one per line, optional target %: <code>GAP INC, 50</code>)<textarea id="evCust" rows="5"></textarea></label>
      <label>Truck turnaround: list trucks that took longer than (hours)<input type="number" id="turnLim" min="1" step="0.5"></label></div>
      <div class="row-end"><button class="btn primary" id="repSave" type="button">Save report settings</button></div>`;
    const ns = document.createElement('div'); ns.className = 'card';
    ns.innerHTML = `<h3>Rows without a CFS</h3><p class="muted small" id="nsInfo">Checking…</p><div class="row-end" style="justify-content:flex-start"><select id="nsSite"></select><button class="btn" id="nsGo" type="button" disabled>Assign these rows to the CFS</button></div>`;
    sec.appendChild(box); sec.appendChild(ns);
    if (window.CSD.mailer) mailCard(sec);
    const ev = (await window.CSD.store.getSetting('ev_customers')) || {};
    $('#evCust').value = Object.entries(ev).map(([c, t]) => t ? `${c}, ${t}` : c).join('\n');
    $('#turnLim').value = (await window.CSD.store.getSetting('turnaround_limit_h')) || 4;
    $('#repSave').onclick = async () => {
      if (!(await window.adminPinAsk('Changing report settings needs the admin PIN.'))) return;
      const o = {}; for (const line of $('#evCust').value.split('\n')) { const [c, t] = line.split(','); if (c && c.trim()) o[c.trim().toUpperCase()] = t && +t ? +t : 0; }
      await window.CSD.store.setSetting('ev_customers', o); await window.CSD.store.setSetting('turnaround_limit_h', +$('#turnLim').value || 4); toast('Report settings saved');
    };
    $('#nsSite').innerHTML = (META.selects['Warehouse ID'] || []).map(s => `<option>${esc(s)}</option>`).join('');
    try { const r = await api('/api/no-site'); $('#nsInfo').textContent = r.rows.length ? `${r.rows.length} row(s) have no CFS (from before site mode). They show under every site until assigned.` : 'Every row has its CFS. Nothing to do.'; $('#nsGo').disabled = !r.rows.length;
      $('#nsGo').onclick = async () => { const pin = await window.adminPinAsk('Assigning a CFS needs the admin PIN.'); if (!pin) return; try { const x = await api('/api/assign-site', {json: {site: $('#nsSite').value, ids: r.rows.map(z => z.id), admin_pin: pin}}); toast(`${x.rows} row(s) assigned`); $('#nsInfo').textContent = 'Done.'; $('#nsGo').disabled = true; } catch (e) { toast(e.message, 5000); } };
    } catch (e) { $('#nsInfo').textContent = e.message; }
  };

  /* ---------- e-mail settings (Admin tab) ---------- */
  async function mailCard(sec) {
    const M = window.CSD.mailer, {mail, rec} = await M.settings();
    const sites = (META.selects['Warehouse ID'] || []);
    const c = document.createElement('div'); c.className = 'card'; c.id = 'mailCard';
    const cell = (k, st) => `<textarea data-rk="${esc(k)}" data-rs="${esc(st)}" rows="2" placeholder="name@example.com, group@googlegroups.com">${esc(((rec.routes || {})[k] || {})[st] || '')}</textarea>`;
    c.innerHTML = `<h3>E-mail</h3>
      <div class="form-grid">
        <label>Google script web-app URL<input id="mlUrl" value="${esc(mail.url || '')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <label>Script key (same as KEY in the script)<input id="mlKey" value="${esc(mail.key || '')}" type="password" autocomplete="off"></label>
        <label>Sender name<input id="mlFrom" value="${esc(mail.from_name || 'CFS Stock Desk')}"></label>
        <label>Closing e-mail by (if the Closing report is not made)<input id="mlClose" type="time" value="${esc(mail.closing_backup || '20:00')}"></label>
        <label><span><input type="checkbox" id="mlOn" ${mail.enabled === false ? '' : 'checked'}> Send automatically from the site PC</span></label>
        <label><span><input type="checkbox" id="mlBackup" ${mail.backup === false ? '' : 'checked'}> Google backup when no PC sent on time</span></label>
      </div>
      <div class="row-end" style="justify-content:flex-start"><input id="mlTestTo" placeholder="your e-mail for a test"><button class="btn" id="mlTest" type="button">Send test e-mail</button><span class="small" id="mlInfo"></span></div>
      <h3 style="margin-top:14px">Who gets which e-mail</h3>
      <p class="muted small">Separate addresses with commas. A Google Group address (e.g. cs-gap-tut@googlegroups.com) keeps the daily count low. Free Gmail: ${M.LIMIT} recipients a day; the app warns at ${M.WARN}.</p>
      <div class="table-wrap"><table class="grid mailgrid"><thead><tr><th>E-mail</th>${sites.map(st => `<th>${esc(st)}</th>`).join('')}</tr></thead><tbody>
        ${M.ROUTES.map(([k, l]) => `<tr><td><b>${esc(l)}</b></td>${k === 'admin' ? `<td colspan="${sites.length}">${cell(k, 'ALL')}</td>` : sites.map(st => `<td>${cell(k, st)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <h3 style="margin-top:14px">Customer copies (same report, only that customer's cargo)</h3>
      <p class="muted small">One line per customer group: <code>GAP: gap-team@example.com, x@y.com</code>. They get the stock reports and the closing e-mail filtered to their cargo.</p>
      <div class="form-grid">${sites.map(st => `<label>${esc(st)}<textarea data-cust="${esc(st)}" rows="3">${esc((rec.customers || {})[st] || '')}</textarea></label>`).join('')}</div>
      <div class="row-end"><button class="btn primary" id="mlSave" type="button">Save e-mail settings</button></div>
      <h3 style="margin-top:14px">Sent today <span class="muted small" id="mlCount"></span></h3><div class="table-wrap"><table class="grid" id="mlLog"></table></div>`;
    sec.appendChild(c);
    const collect = () => {
      const routes = {}; $$('#mailCard [data-rk]').forEach(t => { (routes[t.dataset.rk] = routes[t.dataset.rk] || {})[t.dataset.rs] = t.value.trim(); });
      const customers = {}; $$('#mailCard [data-cust]').forEach(t => { customers[t.dataset.cust] = t.value.trim(); });
      return {mail: {url: $('#mlUrl').value.trim(), key: $('#mlKey').value.trim(), from_name: $('#mlFrom').value.trim(), closing_backup: $('#mlClose').value || '20:00', enabled: $('#mlOn').checked, backup: $('#mlBackup').checked}, rec: {routes, customers}};
    };
    $('#mlSave').onclick = async () => {
      if (!(await window.adminPinAsk('Changing e-mail settings needs the admin PIN.'))) return;
      const x = collect(); await window.CSD.store.setSetting('mail', x.mail); await window.CSD.store.setSetting('recipients', x.rec); toast('E-mail settings saved');
    };
    $('#mlTest').onclick = async () => { const x = collect(); await window.CSD.store.setSetting('mail', x.mail).catch(() => {});
      $('#mlInfo').textContent = 'Sending…'; try { const r = await M.test($('#mlTestTo').value); $('#mlInfo').textContent = `Sent. Google allows ${r.remaining} more recipients today.`; } catch (e) { $('#mlInfo').textContent = e.message; } };
    window.CSD.refreshMailLog = async () => { try {
      const log = await window.CSD.cloud.mailLog(); const used = log.reduce((t, x) => t + (x.recipients || 0), 0);
      $('#mlCount').textContent = `· ${used} of ${M.LIMIT} recipients used`;
      $('#mlLog').innerHTML = `<thead><tr><th>Time</th><th>Site</th><th>E-mail</th><th>To</th><th>By</th><th>Status</th></tr></thead><tbody>` + (log.slice(0, 40).map(x => `<tr><td>${esc(String(x.at).slice(11, 16))}</td><td>${esc(x.site)}</td><td>${esc(x.subject || x.key)}</td><td class="small">${esc(x.to)}</td><td>${esc(x.by)}</td><td>${esc(x.status || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing sent today.</td></tr>') + '</tbody>';
    } catch (e) { $('#mlLog').innerHTML = `<tr><td class="muted">${esc(e.message)}</td></tr>`; } };
    window.CSD.refreshMailLog();
  }

  const wait = setInterval(() => { if (typeof META !== 'undefined' && META && META.columns) { clearInterval(wait); bookCount(); if (!isAdmin()) $$('.admin-only').forEach(e => { e.hidden = true; }); } }, 400);
})();
