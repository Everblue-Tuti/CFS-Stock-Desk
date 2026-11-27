/* Screens for: the 5 daily stock reports (reminders, abstract, log), the Cargo Loading Plan check,
   stuffing (per plan) with the Stuffing Report, and the admin's drop-down lists. Uses the helpers of app.js. */
(function () {
  const SLOT_DEF = [{slot: 'opening', label: 'Opening', at: '10:00'}, {slot: 's1200', label: '12:00', at: '12:00'}, {slot: 's1600', label: '16:00', at: '16:00'},
    {slot: 's1800', label: '18:00', at: '18:00'}, {slot: 'closing', label: 'Closing', at: null}];
  const hhmm = () => window.CSD.ist.time();
  const site = () => META.site_lock || (S.cfs && S.cfs !== 'NOT SET' ? S.cfs : '') || META.warehouse || '';
  const fmt = (v, d = 0) => (v === null || v === undefined || v === '') ? '' : Number(v).toLocaleString('en-IN', {minimumFractionDigits: d, maximumFractionDigits: d});
  let doneToday = [];

  /* ---------- daily stock reports ---------- */
  async function renderSlots() {
    try { const r = await api('/api/report/log'); doneToday = r.today || []; } catch (e) { doneToday = []; }
    const now = hhmm();
    $('#slotBtns').innerHTML = SLOT_DEF.map(s => {
      const done = doneToday.includes(s.slot), due = !done && s.at && now >= s.at;
      return `<button type="button" class="btn slot ${done ? 'done' : due ? 'due' : ''}" data-slot="${s.slot}"><b>${s.slot === 'opening' ? 'Opening stock' : s.slot === 'closing' ? 'Closing stock' : s.label + ' stock'}</b>
        <small>${s.at ? s.at + ' · ' : 'any time · '}${done ? '✓ made today' : due ? 'due now' : 'not yet'}</small></button>`;
    }).join('');
    $$('#slotBtns [data-slot]').forEach(b => b.onclick = () => makeSlot(b.dataset.slot));
    renderDue();
  }
  async function makeSlot(slot) {
    try {
      let sites = [site()].filter(Boolean);
      if (!sites.length) sites = (await api('/api/report/sites')).sites.map(x => x.cfs).filter(Boolean);
      if (!sites.length) { toast('No stock rows to report'); return; }
      let last = null;
      for (const c of sites) {
        const n = await download(`/api/report?cfs=${encodeURIComponent(c)}&slot=${slot}`, 'Stock_Report.xlsx');
        last = {c, n};
      }
      toast('Saved ' + last.n + ' in your Downloads folder', 5000);
      /* v15: making the Closing report sends the closing e-mail (stock, inbound & outbound, stuffing, ageing red list) */
      if (slot === 'closing' && window.CSD.mailer && window.CSD.cloud && window.CSD.cloud.enabled) {
        if (window.CSD.ioRemarks === undefined || window.CSD.ioRemarks.day !== window.CSD.ist.date()) toast('Closing e-mail is being sent. (Tip: open Reports → Inbound & outbound first to add remarks.)', 6000);
        window.CSD.mailer.closingMade();
      }
      /* v17.1 local mode: the Closing report also downloads a backup of this PC's data */
      if (slot === 'closing' && !(window.CSD.cloud && window.CSD.cloud.enabled)) {
        try { const b = await download('/api/backup?cfs=' + encodeURIComponent(last.c || ''), 'CFS_Backup.json');
          await alertBox(`Backup saved in Downloads: ${b}. Copy the newest backup file to the shared folder / pen drive today – keep the last 7 days.`); } catch (e) { toast('Backup: ' + e.message, 6000); }
      }
      await showAbstract(slot, last.c);
      renderSlots();
    } catch (e) { toast(e.message); }
  }
  async function showAbstract(slot, cfs) {
    const r = await api(`/api/report/abstract?slot=${slot}&cfs=${encodeURIComponent(cfs || '')}`);
    $('#abSubject').textContent = r.subject;
    const head = ['Customer', 'No. of POs', 'Total Pkgs', 'Item Qty (Pcs)', 'CBM', 'Gross Weight (kg)'];
    const line = a => [a.customer, fmt(a.pos), fmt(a.pkgs), fmt(a.qty), fmt(a.cbm, 3), fmt(a.gross, 3)];
    const html = `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:13px"><tr>${head.map(h => `<th style="background:#1F3A5F;color:#fff;padding:5px 10px;border:1px solid #9fb0c2">${h}</th>`).join('')}</tr>` +
      r.rows.map((a, k) => `<tr>${line(a).map((v, i) => `<td style="padding:4px 10px;border:1px solid #d0d7de;${i ? 'text-align:right;' : ''}${k % 2 ? 'background:#f3f6f9' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('') +
      `<tr>${line(r.total).map((v, i) => `<td style="padding:5px 10px;border:1px solid #9fb0c2;font-weight:bold;background:#e4ebf2;${i ? 'text-align:right' : ''}">${esc(v)}</td>`).join('')}</tr></table>`;
    $('#abTable').innerHTML = `<p class="small"><b>${esc(r.title)}</b> – ABSTRACT REPORT</p>` + html;
    const text = ['ABSTRACT REPORT – ' + r.title, head.join('\t'), ...r.rows.map(a => line(a).join('\t')), line(r.total).join('\t')].join('\n');
    $('#abCopy').onclick = async () => {
      try { await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([`<p><b>ABSTRACT REPORT – ${esc(r.title)}</b></p>` + html], {type: 'text/html'}), 'text/plain': new Blob([text], {type: 'text/plain'})})]); }
      catch (e) { try { await navigator.clipboard.writeText(text); } catch (e2) { toast('Copy not allowed here – select the table and press Ctrl+C'); return; } }
      toast('Abstract copied – paste it into the e-mail (Ctrl+V)');
    };
    $('#abCopySubject').onclick = async () => { try { await navigator.clipboard.writeText(r.subject); toast('Subject copied'); } catch (e) { toast('Copy not allowed here'); } };
    $('#abstractDlg').showModal();
  }
  $('#slotLogBtn').onclick = async () => {
    const box = $('#slotLog'); if (!box.hidden) { box.hidden = true; return; }
    const r = await api('/api/report/log');
    box.hidden = false;
    box.innerHTML = r.log.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Date</th><th>Report</th><th>Made at</th><th>By</th><th>CFS</th><th class="num">Rows</th><th class="num">Cartons</th><th class="num">CBM</th><th>File</th></tr></thead><tbody>` +
      r.log.slice(0, 60).map(x => `<tr><td>${esc(showDate(x.date))}</td><td>${esc((SLOT_DEF.find(s => s.slot === x.slot) || {}).label || x.slot)}</td><td>${esc(String(x.at).slice(11, 16))}</td><td>${esc(x.by)}</td><td>${esc(x.site || '')}</td>
        <td class="num">${fmt(x.rows)}</td><td class="num">${fmt(x.pkgs)}</td><td class="num">${fmt(x.cbm, 3)}</td><td class="small">${esc(x.file)}</td></tr>`).join('') + '</tbody></table></div>'
      : '<p class="muted">No reports made yet.</p>';
  };
  /* reminder bar: a slot whose time has passed and whose report has not been made today on this PC */
  function renderDue() {
    const now = hhmm();
    const due = SLOT_DEF.filter(s => s.at && now >= s.at && !doneToday.includes(s.slot));
    const bar = $('#dueBar');
    if (!due.length || !site()) { bar.hidden = true; return; }
    const s = due[due.length - 1];
    bar.hidden = false;
    bar.innerHTML = `<span>⏰ ${s.slot === 'opening' ? 'Opening (10:00)' : s.label} stock report is due${due.length > 1 ? ` (also not made: ${due.slice(0, -1).map(x => x.label).join(', ')})` : ''}.</span>
      <button class="btn primary small" type="button" id="dueMake">Make it now</button>`;
    $('#dueMake').onclick = () => makeSlot(s.slot);
  }
  setInterval(async () => { try { const r = await api('/api/report/log'); doneToday = r.today || []; } catch (e) {} renderDue(); }, 60000);

  /* ---------- Cargo Loading Plan ---------- */
  let planFile = null;
  $('#planFile').onchange = async e => {
    planFile = e.target.files[0]; e.target.value = ''; if (!planFile) return;
    $('#planName').textContent = planFile.name + ' – checking…';
    const fd = new FormData(); fd.append('file', planFile); fd.append('mode', 'preview');
    try { renderCheck(await api('/api/plan/check', {method: 'POST', body: fd})); }
    catch (err) { $('#planResult').innerHTML = `<div class="errors"><b>${esc(err.message)}</b></div>`; }
    $('#planName').textContent = planFile.name;
  };
  function renderCheck(r) {
    const bad = r.rows.filter(x => x.level === 'error').length, warn = r.rows.filter(x => x.level === 'warn').length;
    const sum = `<div class="table-wrap"><table class="grid"><thead><tr><th>Plan</th><th>SHIP TO</th><th class="num">Rows</th><th class="num">OK</th><th class="num">Check</th><th class="num">Problem</th><th class="num">Cartons</th><th class="num">CBM</th><th class="num">Gross</th></tr></thead><tbody>` +
      r.summary.map(a => `<tr><td><b>${esc(a.plan)}</b></td><td class="small">${esc(a.shipto)}</td><td class="num">${a.rows}</td><td class="num">${a.ok}</td><td class="num">${a.warns}</td><td class="num">${a.errors}</td><td class="num">${fmt(a.pkgs)}</td><td class="num">${fmt(a.cbm, 3)}</td><td class="num">${fmt(a.gross, 3)}</td></tr>`).join('') + '</tbody></table></div>';
    const rows = `<label class="check small"><input type="checkbox" id="onlyBad" ${bad + warn ? 'checked' : ''}> Show only rows to look at</label>
      <div class="table-wrap tall"><table class="grid" id="chkTable"><thead><tr><th>Plan</th><th>SHIP TO</th><th>Port</th><th>PO. No</th><th>Style</th><th>Shipper Inv No</th><th class="num">Plan pkgs</th><th class="num">Received</th><th>Bay</th><th>Result</th></tr></thead><tbody>` +
      r.rows.map(x => `<tr class="res-${x.level}" data-lvl="${x.level}"><td>${esc(x.PLAN)}</td><td>${esc(x['SHIP TO'])}</td><td>${esc(x['Port of Discharge'])}</td><td>${esc(x['PO Number'])}</td><td>${esc(x.Style)}</td><td>${esc(x['Shipper invoice number'])}</td>
        <td class="num">${fmt(x['Total Packages'])}</td><td class="num">${x.data ? fmt(x.data.received) : ''}</td><td>${esc(x.data ? x.data.bay : '')}</td><td class="res">${x.level === 'ok' ? '✓ OK' : esc(x.issues.join('; '))}</td></tr>`).join('') + '</tbody></table></div>';
    const np = r.not_planned.length ? `<details><summary><b>${r.not_planned.length}</b> stock row(s) for the same ports are in no plan</summary><div class="table-wrap"><table class="grid"><thead><tr><th>Port</th><th>Customer</th><th>PO. No</th><th>Style</th><th>Shipper Inv No</th><th class="num">Received</th><th>Bay</th></tr></thead><tbody>` +
      r.not_planned.map(x => `<tr><td>${esc(x['Port of Discharge'])}</td><td>${esc(x['Customer Name'])}</td><td>${esc(x['PO Number'])}</td><td>${esc(x.Style)}</td><td>${esc(x['Shipper invoice number'])}</td><td class="num">${fmt(x['Received Pkgs'])}</td><td>${esc(x['Warehouse Bay number'] || '')}</td></tr>`).join('') + '</tbody></table></div></details>' : '';
    const cf = r.conflicts.length ? `<div class="errors"><b>The plan file puts the same row in two plans:</b><ul>${r.conflicts.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : '';
    $('#planResult').innerHTML = `<p><b>${r.rows.length}</b> planned rows: <span class="ok">${r.rows.length - bad - warn} OK</span>, <b>${warn}</b> to check (OSD / damage), <b class="${bad ? 'err' : ''}">${bad} problem(s)</b>.</p>${cf}${sum}${rows}${np}
      <div class="row-end"><button class="btn" type="button" id="chkReport">Download check report (.xlsx)</button><button class="btn primary" type="button" id="chkApply">Link plan to stock</button></div>
      <p class="muted small">"Link plan to stock" writes SHIP TO, STATUS, T.POINT, FOB, SHIP CXL and PLAN into the matching stock rows (rows not in stock, already stuffed or in another plan are skipped). The plans then appear under 2.</p>`;
    const filt = () => $$('#chkTable tbody tr').forEach(tr => tr.hidden = $('#onlyBad').checked && tr.dataset.lvl === 'ok');
    $('#onlyBad').onchange = filt; filt();
    $('#chkReport').onclick = async () => {
      const fd = new FormData(); fd.append('file', planFile); fd.append('mode', 'report');
      try { const res = await fetch('/api/plan/check', {method: 'POST', body: fd, headers: {'X-User': user()}}); if (!res.ok) throw new Error((await res.json()).error);
        const b = await res.blob(), name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'Loading_Plan_Check.xlsx';
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        toast('Saved ' + name + ' in your Downloads folder');
      } catch (e) { toast(e.message); }
    };
    $('#chkApply').onclick = async () => {
      if (bad && !(await confirmBox(`${bad} row(s) have problems and will be skipped or linked with the problem shown. Link the plan to the stock anyway?`))) return;
      const fd = new FormData(); fd.append('file', planFile); fd.append('mode', 'apply');
      try { const x = await api('/api/plan/check', {method: 'POST', body: fd}); toast(`Plan linked: ${x.linked} of ${x.rows} rows`, 5000); loadPlans(); }
      catch (e) { toast(e.message); }
    };
  }
  async function loadPlans() {
    try {
      const r = await api('/api/plans');
      $('#plansList').innerHTML = r.plans.length ? r.plans.map(p => `<div class="plan-card"><div><b>Plan ${esc(p.plan)}</b> · ${esc(p.pod)}<div class="muted small">${esc(p.shipto)} · ${p.rows.length} rows · ${fmt(p.pkgs)} cartons · ${fmt(p.cbm, 3)} CBM · ${fmt(p.gross, 3)} kg</div></div>
        <button class="btn primary" type="button" data-stuff="${esc(p.plan)}">Stuff container…</button></div>`).join('') : '<p class="muted">No plan linked to the stock yet (upload the plan above and click "Link plan to stock").</p>';
      $$('[data-stuff]').forEach(b => b.onclick = () => openStuff(r.plans.find(p => p.plan === b.dataset.stuff)));
    } catch (e) { $('#plansList').textContent = e.message; }
    loadStuffings();
  }
  $('#plansReload').onclick = loadPlans;

  /* ---------- stuffing ---------- */
  async function openStuff(plan) {
    const {lists} = await api('/api/lists');
    const sel = (k, key, def) => { const l = lists[k] || []; return `<label>${esc(k)}<select data-h="${key}" ${l.length ? '' : 'disabled'}><option value=""></option>${l.map(v => `<option ${v === def ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>${l.length ? '' : '<span class="err small">List empty – the admin adds it in Import / backup → Drop-down lists</span>'}</label>`; };
    const pick = (k, test) => (lists[k] || []).find(test) || (lists[k] || [])[0] || '';
    const st = site().toUpperCase();
    const cust = [...new Set(plan.rows.map(x => String(x.data.GroupName || x.data['Customer Name'] || '').toUpperCase()))];
    const txt = (label, key, ph = '', type = 'text', v = '') => `<label>${esc(label)}<input type="${type}" data-h="${key}" placeholder="${esc(ph)}" value="${esc(v)}"></label>`;
    $('#stuffTitle').textContent = `Stuff container – Plan ${plan.plan} (${plan.pod})`;
    $('#stuffBody').innerHTML = `<div class="stuff-grid">
      ${txt('Container no *', 'container', 'e.g. MSNU9608394')}${sel('Carrier', 'carrier')}<label>Unit (container size) *<select data-h="unit"><option value=""></option>${['20GP', '40GP', '40HC', '45HC'].map(v => `<option ${v === '40HC' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${txt('Carrier seal no *', 'seal')}
      ${txt('Carrier booking', 'booking')}${sel('Vessel', 'vessel')}${txt('Voyage', 'voyage')}${sel('Transporter', 'transporter')}
      ${txt('Truck / trailer no *', 'truck_no', 'e.g. TN69AB1234')}<label>Truck type *<select data-h="truck_type"><option value=""></option><option>EV</option><option>Diesel</option><option>CNG</option></select></label>
      ${txt('Date of stuffing *', 'date', '', 'date', todayStr())}${txt('Container pick-up date', 'pickup', '', 'date', todayStr())}${txt('Time from', 'from', '', 'time')}${txt('Time to', 'to', '', 'time')}
      ${txt('No of labour used', 'labour', '', 'number')}${sel('Applicant', 'applicant', pick('Applicant', () => true))}${sel('Place of stuffing', 'place', pick('Place of stuffing', v => st.includes('JOHN') ? /JOHN/i.test(v) : st.includes('SICAL') ? /SICAL/i.test(v) : true))}
      ${sel('Consignee', 'consignee', pick('Consignee', v => cust.some(c => c.includes(v.toUpperCase()) || v.toUpperCase().includes(c))))}${sel('Port of loading', 'pol', pick('Port of loading', () => true))}${sel('Port of destination', 'pod')}
    </div>
    <div class="table-wrap"><table class="grid"><thead><tr><th>Stuffed</th><th>PO. No</th><th>Style</th><th>SHIP TO</th><th>Shipper Inv No</th><th class="num">Received</th><th class="num">Cartons stuffed</th><th class="num">CBM</th><th>Bay</th><th>OSD</th></tr></thead><tbody>` +
      plan.rows.map((x, i) => { const d = x.data, rc = d['Received Pkgs'] === '' || d['Received Pkgs'] === undefined || d['Received Pkgs'] === null ? d['Total Packages'] : d['Received Pkgs'];
        return `<tr><td class="chk"><input type="checkbox" data-sr="${i}" checked></td><td>${esc(d['PO Number'])}</td><td>${esc(d.Style)}</td><td>${esc(d['SHIP TO'] || '')}</td><td>${esc(d['Shipper invoice number'])}</td>
        <td class="num">${fmt(rc)}</td><td><input type="number" min="0" max="${esc(rc)}" step="1" data-sp="${i}" value="${esc(rc)}" style="width:80px"></td><td class="num">${fmt(d['Total CBM'], 3)}</td><td>${esc(d['Warehouse Bay number'] || '')}</td><td class="small">${String(d.OSD || '').toUpperCase() === 'YES' ? esc(d['OSD type'] || 'YES') : ''}</td></tr>`; }).join('') +
      `</tbody></table></div><p class="small" id="stuffSum"></p><p class="muted small">Fewer cartons than received = part load: the rest stays in stock. Stuffed rows leave the stock (shipped out).</p>`;
    const sum = () => { let n = 0, c = 0; plan.rows.forEach((x, i) => { if ($(`[data-sr="${i}"]`).checked) { const v = +$(`[data-sp="${i}"]`).value || 0; n += v; const rc = +(x.data['Received Pkgs'] || x.data['Total Packages']) || 1; c += (+x.data['Total CBM'] || 0) * v / rc; } });
      const u = ($('#stuffBody [data-h="unit"]') || {}).value, cap = {'20GP': 33, '40GP': 67, '40HC': 76, '45HC': 86}[u], pc = cap ? Math.round(c / cap * 100) : null;
      $('#stuffSum').innerHTML = `<b>To stuff:</b> ${fmt(n)} cartons · ${fmt(c, 3)} CBM` + (pc === null ? '' : ` · <span class="${pc > 100 ? 'bad' : pc > 95 ? 'warn' : ''}">${pc}% of a ${esc(u)} (${cap} CBM)</span>`); };
    const ctr = $('#stuffBody [data-h="container"]'); ctr.addEventListener('change', () => { const c = window.CSD.V.isoCheck(ctr.value); ctr.classList.toggle('bad-in', !!ctr.value && !c.ok); ctr.title = c.ok ? '' : c.why || ''; });
    $('#stuffBody [data-h="unit"]').addEventListener('change', () => sum());
    $$('#stuffBody [data-sr], #stuffBody [data-sp]').forEach(el => el.addEventListener('input', sum)); sum();
    $('#stuffErr').hidden = true;
    $('#stuffForm').onsubmit = async e => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      const header = {}; $$('#stuffBody [data-h]').forEach(el => header[el.dataset.h] = el.value.trim());
      const rows = plan.rows.map((x, i) => ({id: x.id, pkgs: $(`[data-sr="${i}"]`).checked ? +$(`[data-sp="${i}"]`).value || 0 : 0})).filter(x => x.pkgs > 0);
      try {
        const send = async (extra = {}) => { try { return await api('/api/stuff', {json: Object.assign({plan: plan.plan, header, rows}, extra)}); } catch (e) {
          const d = e.data || {};
          if (d.need_confirm && !extra.confirm_full) { if (await confirmBox(e.message + ' Stuff anyway?')) return send(Object.assign({}, extra, {confirm_full: true})); throw new Error('Not saved.'); }
          if (d.need_pin && !extra.admin_pin) { const pin = await askPin((d.red || [e.message]).join(' ') + ' – admin PIN to save anyway:'); if (pin) return send(Object.assign({}, extra, {admin_pin: pin, confirm_full: true})); throw new Error(e.message); }
          throw e; } };
        const r = await send();
        $('#stuffDlg').close();
        toast(`Container ${header.container.toUpperCase()} stuffed – running no ${r.running_no}`, 6000);
        if (window.CSD.mailer && window.CSD.cloud && window.CSD.cloud.enabled) window.CSD.mailer.stuffing({running_no: r.running_no, container: header.container.toUpperCase()}).catch(e => toast('Stuffing e-mail: ' + e.message, 6000));
        if (await confirmBox(`Stuffing saved (running no ${r.running_no}). Download this container's Stuffing Report now?`)) await download('/api/stuffing-report?running=' + r.running_no, 'Stuffing_Report.xlsx');
        loadPlans(); refreshCounts();
      } catch (err) { $('#stuffErr').hidden = false; $('#stuffErr').innerHTML = `<b>${esc(err.message)}</b>`; }
    };
    $('#stuffDlg').showModal();
  }
  async function loadStuffings() {
    try {
      const r = await api('/api/stuffings');
      $('#srNext').textContent = `Next running no.: ${r.next_running_no}`;
      $('#stuffList').innerHTML = r.stuffings.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Running no</th><th>Date</th><th>Plan</th><th>Container</th><th>Carrier & unit</th><th class="num">Rows</th><th class="num">Cartons</th><th>By</th><th></th></tr></thead><tbody>` +
        r.stuffings.map(s => `<tr><td><b>${esc(s.running_no)}</b></td><td>${esc(showDate(s.date))}</td><td>${esc(s.plan)}</td><td>${esc(s.container)}</td><td>${esc([s.carrier, s.unit].filter(Boolean).join(' & '))}</td><td class="num">${s.rows}</td><td class="num">${fmt(s.pkgs)}</td><td>${esc(s.by)}</td>
          <td><button class="btn small" type="button" data-srn="${esc(s.running_no)}">Report</button></td></tr>`).join('') + '</tbody></table></div>' : '<p class="muted">No container stuffed yet.</p>';
      $$('[data-srn]').forEach(b => b.onclick = async () => { try { toast('Saved ' + await download('/api/stuffing-report?running=' + b.dataset.srn, 'Stuffing_Report.xlsx')); } catch (e) { toast(e.message); } });
    } catch (e) {}
  }
  $('#srDate').value = todayStr();
  $('#srDay').onclick = async () => { try { toast('Saved ' + await download('/api/stuffing-report?date=' + $('#srDate').value, 'Stuffing_Report.xlsx') + ' in your Downloads folder', 5000); } catch (e) { toast(e.message); } };

  /* ---------- drop-down lists (admin) ---------- */
  async function loadLists() {
    try {
      const r = await api('/api/lists');
      $('#listsForm').innerHTML = r.names.map(k => `<label class="small"><b>${esc(k)}</b><textarea data-list="${esc(k)}">${esc((r.lists[k] || []).join('\n'))}</textarea></label>`).join('');
      $('#runNo').value = r.next_running_no;
    } catch (e) {}
  }
  $('#listsSave').onclick = async () => {
    const pin = await adminPin('Changing the drop-down lists needs the admin PIN.'); if (!pin) return;
    const lists = {}; $$('#listsForm [data-list]').forEach(t => lists[t.dataset.list] = t.value.split('\n'));
    try { await api('/api/lists', {json: {lists, next_running_no: $('#runNo').value, admin_pin: pin}}); toast('Lists saved'); loadLists(); } catch (e) { await alertBox(e.message); }
  };
  $('#listsFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), {type: 'array'}); const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, defval: ''});
      const head = (aoa[0] || []).map(h => String(h).trim().toUpperCase()); let n = 0;
      $$('#listsForm [data-list]').forEach(t => { const i = head.indexOf(t.dataset.list.toUpperCase()); if (i < 0) return;
        const vals = aoa.slice(1).map(r => String(r[i] ?? '').trim()).filter(Boolean); if (vals.length) { t.value = [...new Set(vals)].join('\n'); n++; } });
      toast(n ? `${n} list(s) filled from ${f.name} – click "Save lists"` : 'No list names found in the first row of the file', 5000);
    } catch (err) { toast('Could not read the file: ' + err.message); }
  };

  /* ---------- hook into the app ---------- */
  const origShow = showTab;
  showTab = function (name) { origShow(name); if (name === 'plan') loadPlans(); if (name === 'stock') renderSlots(); if (name === 'import') loadLists(); };
  const wait = setInterval(() => { if (typeof META !== 'undefined' && META && META.columns) { clearInterval(wait); renderSlots(); loadLists(); } }, 300);
})();
