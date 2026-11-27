/* Version 15 – Truck report: trucks whose documents are saved wait here until the operator clicks Offloaded.
   Start offloading → Offloaded pop-up (received cartons, bay, labour, OSD, damage lines with photos) → cargo goes into stock.
   Uses the helpers of app.js ($, $$, esc, api, toast, inputFor, readVal, META). */
(function () {
  'use strict';
  const fmt = (v, d = 0) => (v === null || v === undefined || v === '') ? '' : Number(v).toLocaleString('en-IN', {minimumFractionDigits: d, maximumFractionDigits: d});
  const hm = m => m === null || m === undefined ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  const tShort = s => String(s || '').slice(11, 16) ? `${String(s).slice(8, 10)}-${String(s).slice(5, 7)} ${String(s).slice(11, 16)}` : String(s || '');
  const canWork = () => !(window.CSD.cloud && window.CSD.cloud.enabled && window.CSD.cloud.profile && window.CSD.cloud.profile.role === 'management');
  let data = {waiting: [], offloaded: []}, timer = null;
  window.CSD.photoQueue = window.CSD.photoQueue || [];

  /* tab + section */
  const tab = document.createElement('button'); tab.className = 'tab'; tab.dataset.tab = 'trucks';
  tab.innerHTML = 'Truck report <span class="count" id="truckCount"></span>';
  const readTab = $('.tab[data-tab="read"]'); readTab.after(tab);
  const sec = document.createElement('section'); sec.id = 'tab-trucks'; sec.className = 'view';
  sec.innerHTML = `
    <div class="card"><div class="row-end" style="justify-content:space-between"><div><h3 style="margin:0">Waiting to offload</h3><p class="muted small" id="trkSum" style="margin:2px 0 0"></p></div>
      <div class="row-end"><button class="btn small" id="trkRefresh" type="button">Refresh</button></div></div>
      <div class="table-wrap"><table class="grid" id="trkWait"></table></div>
      <p class="muted small">A truck comes here when its documents are saved. Click <b>Start offloading</b> when unloading begins and <b>Offloaded</b> when it is finished – the cargo then goes into stock.</p></div>
    <div class="card"><div class="row-end" style="justify-content:space-between"><h3 style="margin:0">Offloaded on <input type="date" id="trkDay"></h3><span class="muted small" id="trkDoneSum"></span></div>
      <div class="table-wrap"><table class="grid" id="trkDone"></table></div></div>`;
  $('#tab-read').after(sec);
  tab.onclick = () => showTab('trucks');
  const oldShow = window.showTab;
  window.showTab = function (name) { oldShow(name); if (name === 'trucks') load(); };
  /* other tab buttons were bound to the old showTab */
  $$('.tab').forEach(t => { if (t.dataset.tab && t.dataset.tab !== 'admin') t.onclick = () => window.showTab(t.dataset.tab); });

  async function load() {
    const day = $('#trkDay').value || window.CSD.ist.date(); $('#trkDay').value = day;
    try { data = await api('/api/trucks?day=' + day); } catch (e) { $('#trkSum').textContent = e.message; return; }
    render(); count();
  }
  async function count() {
    try { const r = data.waiting ? data : await api('/api/trucks'); $('#truckCount').textContent = r.waiting.length || ''; } catch (e) {}
  }
  $('#trkRefresh').onclick = load;
  $('#trkDay').onchange = load;
  function render() {
    const w = data.waiting;
    $('#trkSum').textContent = w.length ? `${w.length} truck(s) · ${fmt(w.reduce((t, x) => t + x.pkgs, 0))} cartons · ${fmt(w.reduce((t, x) => t + x.cbm, 0), 3)} CBM` : 'No truck waiting.';
    $('#trkWait').innerHTML = `<thead><tr><th>Truck no</th><th>Customer</th><th>Shipper · Invoice</th><th class="num">POs</th><th class="num">Cartons</th><th class="num">CBM</th><th>Arrived</th><th>Waiting</th><th>Cut-off</th><th>Status</th><th></th></tr></thead><tbody>` +
      (w.length ? w.map((x, i) => `<tr class="${x.late === 'Yes' ? 'late' : ''}"><td><b>${esc(x.truck || '—')}</b><div class="muted small">${esc([x.vehicle, x.transporter].filter(Boolean).join(' · '))}</div></td>
        <td>${esc(x.customer)}</td><td>${esc(x.vendor)}<div class="muted small">${esc(x.invoice)}</div></td><td class="num">${new Set(x.rows.map(r => r.po)).size}</td>
        <td class="num">${fmt(x.pkgs)}</td><td class="num">${fmt(x.cbm, 3)}</td><td>${esc(tShort(x.arrived))}</td><td>${hm(x.waiting_min)}</td>
        <td>${esc(tShort(x.cutoff))}${x.late === 'Yes' ? ' <span class="pill off">Late cargo</span>' : ''}</td>
        <td>${x.started ? `<span class="pill on">Offloading since ${esc(String(x.started).slice(11, 16))}</span><div class="muted small">${hm(x.offloading_min)}</div>` : '<span class="pill">Waiting</span>'}</td>
        <td class="row-end">${canWork() ? `${x.started ? '' : `<button class="btn small" data-start="${i}" type="button">Start offloading</button>`}<button class="btn small primary" data-off="${i}" type="button">Offloaded</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="11" class="muted" style="padding:14px">No truck waiting to offload.</td></tr>') + '</tbody>';
    $$('#trkWait [data-start]').forEach(b => b.onclick = async () => {
      const x = w[+b.dataset.start];
      const sd = await sealDialog(x); if (!sd) return;
      b.disabled = true;
      try { await api('/api/truck/start', {json: {ids: x.ids, seal: sd.seal, seal_photo: sd.photo ? {name: sd.photo.name, sha256: sd.photo.sha256, at: sd.photo.at, user: sd.photo.user} : null}}); toast(`${x.truck}: offloading started · seal ${sd.seal}`); load();
        if (sd.photo && window.CSD.mailer && window.CSD.mailer.sealPhoto) window.CSD.mailer.sealPhoto({truck: x.truck, site: x.site || META.site_lock, photo: sd.photo, ids: x.ids}).catch(() => {});
        if (sd.seal === 'Broken' && window.CSD.mailer) window.CSD.mailer.damageAlert({truck: x.truck, site: x.site || META.site_lock, customer: x.customer, vendor: x.vendor, invoice: x.invoice, seal: sd.seal,
          lines: [], photos: sd.photo ? [Object.assign({line: -1, po: 'SEAL', style: ''}, sd.photo, {name: `${x.truck}_SEAL.jpg`})] : [], ids: x.ids}).catch(e => toast('Seal alert: ' + e.message, 5000));
      } catch (e) { toast(e.message, 5000); b.disabled = false; }
    });
    $$('#trkWait [data-off]').forEach(b => b.onclick = () => offloadDialog(w[+b.dataset.off]));
    const d = data.offloaded;
    $('#trkDoneSum').textContent = d.length ? `${d.length} truck(s) · ${fmt(d.reduce((t, x) => t + x.received, 0))} cartons received · ${fmt(d.reduce((t, x) => t + x.cbm, 0), 3)} CBM` : '';
    $('#trkDone').innerHTML = `<thead><tr><th>Truck no</th><th>Customer</th><th>Shipper · Invoice</th><th class="num">Booked</th><th class="num">Received</th><th class="num">CBM</th><th>Arrived</th><th>Start</th><th>Offloaded</th><th>Waiting</th><th>Offloading</th><th>Bay</th><th class="num">Labour</th><th>OSD</th></tr></thead><tbody>` +
      (d.length ? d.map(x => `<tr><td><b>${esc(x.truck)}</b></td><td>${esc(x.customer)}</td><td>${esc(x.vendor)}<div class="muted small">${esc(x.invoice)}</div></td><td class="num">${fmt(x.pkgs)}</td>
        <td class="num">${fmt(x.received)}</td><td class="num">${fmt(x.cbm, 3)}</td><td>${esc(tShort(x.arrived))}</td><td>${esc(String(x.started).slice(11, 16))}</td><td>${esc(String(x.offloaded).slice(11, 16))}</td>
        <td>${hm(x.waiting_min)}</td><td>${hm(x.offloading_min)}</td><td>${esc(x.bay)}</td><td class="num">${esc(x.labour)}</td><td>${x.osd ? '<span class="pill off">OSD</span>' : ''}${x.late === 'Yes' ? ' <span class="pill off">Late</span>' : ''}</td></tr>`).join('')
        : '<tr><td colspan="14" class="muted" style="padding:14px">No truck offloaded on this day.</td></tr>') + '</tbody>';
  }

  /* ---------- Offloaded pop-up ---------- */
  let dlg = null, T = null;
  function offloadDialog(x) {
    T = {x, damage: [], rows: x.rows.map(r => ({id: r.id, po: r.po, style: r.style, colour: r.colour, pkgs: r.pkgs, cbm: r.cbm, received: r.pkgs, actual: '', ok: false})), anyDamage: '', photos: {}};
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'offDlg'; dlg.className = 'wide'; document.body.appendChild(dlg); }
    const apll = !(META.tuticorin || []).includes(String(x.site || META.site_lock || '').toUpperCase());
    const tf = [...META.offload.truck, ...(apll ? META.offload.truck_apll : [])];
    const pre = {'Offloading Date': x.started ? String(x.started).slice(0, 10) : window.CSD.ist.date(), 'Offloading Start Time': x.started ? String(x.started).slice(11, 16) : '',
      'Offloading END Time': window.CSD.ist.time(), 'Late Cargo': x.late, 'Warehouse Bay number': x.bay, 'No of Labour': x.labour};
    dlg.innerHTML = `<form method="dialog" class="dlg-pad" id="offForm">
      <div class="row-end" style="justify-content:space-between"><h3 style="margin:0">Offloaded – truck ${esc(x.truck)}</h3><span class="muted small">${esc(x.customer)} · ${esc(x.vendor)} · ${esc(x.invoice)}</span></div>
      <fieldset><legend>Truck</legend><div class="form-grid">${tf.map(f => `<div class="fld"><label><span class="${['Warehouse Bay number', 'No of Labour'].includes(f) ? 'req' : ''}">${esc(lab(f))}</span></label><div class="in">${inputFor(f, pre[f] ?? '', 'data-scope="t"')}</div></div>`).join('')}</div></fieldset>
      <fieldset><legend>Cartons received</legend><div class="table-wrap"><table class="grid"><thead><tr><th>PO</th><th>Style</th><th>Colour</th><th class="num">Booked ctns</th><th class="num"><span class="req">Received ctns</span></th><th class="num">CBM</th><th class="num">Actual CBM</th><th class="chk"><span class="req">Pkgs &amp; CBM checked</span></th></tr></thead><tbody>
        ${T.rows.map((r, i) => `<tr><td>${esc(r.po)}</td><td>${esc(r.style)}</td><td>${esc(r.colour)}</td><td class="num">${fmt(r.pkgs)}</td>
          <td><input type="number" min="0" step="1" data-rc="${i}" value="${esc(r.received)}" style="width:90px"></td><td class="num">${fmt(r.cbm, 3)}</td>
          <td><input type="number" min="0" step="any" data-ac="${i}" value="" style="width:90px"></td><td class="chk todo"><input type="checkbox" data-ok="${i}"></td></tr>`).join('')}
      </tbody></table></div><button class="btn small" type="button" id="offAllOk">Tick all checked</button></fieldset>
      <fieldset><legend>OSD &amp; damage</legend>
        <div class="form-grid"><div class="fld"><label><span class="req">Any damaged cartons?</span></label><div class="in"><select id="offDmg"><option value=""></option><option>Yes</option><option>No</option></select></div></div>
          <div class="fld"><label><span id="offRemarkLab">OSD remark</span></label><div class="in"><input id="offRemark" placeholder="what was found – at least 10 characters"></div></div>
          ${x.seal ? `<div class="fld"><label>Seal / truck condition</label><div class="in"><b>${esc(x.seal)}</b></div></div>` : `<div class="fld"><label><span class="req">Seal / truck condition</span></label><div class="in"><select id="offSeal"><option value=""></option>${META.seal_options.map(o => `<option>${esc(o)}</option>`).join('')}</select></div></div>`}</div>
        <div id="offDmgBox"></div><p class="small" id="offOsd"></p></fieldset>
      <p class="gate-err" id="offErr" hidden></p>
      <div class="row-end"><button class="btn" value="cancel">Cancel</button><button class="btn primary" id="offSave" type="button">Confirm offloaded – put into stock</button></div></form>`;
    dlg.showModal();
    $$('#offDlg [data-rc]').forEach(el => el.oninput = () => { T.rows[+el.dataset.rc].received = el.value; osdLine(); });
    $$('#offDlg [data-ac]').forEach(el => el.oninput = () => { T.rows[+el.dataset.ac].actual = el.value; osdLine(); });
    $$('#offDlg [data-ok]').forEach(el => el.onchange = () => { T.rows[+el.dataset.ok].ok = el.checked; el.closest('td').classList.toggle('todo', !el.checked); });
    $('#offAllOk').onclick = () => $$('#offDlg [data-ok]').forEach(el => { el.checked = true; el.dispatchEvent(new Event('change')); });
    $('#offDmg').onchange = () => { T.anyDamage = $('#offDmg').value; if (T.anyDamage === 'Yes' && !T.damage.length) T.damage.push({}); renderDmg(); osdLine(); };
    $('#offSave').onclick = save;
    renderDmg(); osdLine();
  }
  const uniq = a => [...new Set(a.filter(v => v !== '' && v !== null && v !== undefined).map(String))];
  const ctn = s => String(s || '').split(/[,;\s]+/).filter(Boolean).reduce((n, p) => { const m = p.match(/^(\d+)\s*[-–]\s*(\d+)$/); return n + (m ? Math.max(1, Math.abs(+m[2] - +m[1]) + 1) : 1); }, 0);
  function renderDmg() {
    const box = $('#offDmgBox'); if (T.anyDamage !== 'Yes') { box.innerHTML = ''; return; }
    const opt = (l, v) => '<option value=""></option>' + l.map(o => `<option ${String(v ?? '') === o ? 'selected' : ''}>${esc(o)}</option>`).join('');
    box.innerHTML = `<div class="table-wrap"><table class="grid"><thead><tr><th><span class="req">PO</span></th><th><span class="req">Style</span></th><th>Colour</th><th>Size</th><th><span class="req">Carton no(s)</span></th><th><span class="req">Damage type</span></th><th>Remark</th><th>Photos</th><th></th></tr></thead><tbody>` +
      T.damage.map((l, i) => {
        const pos = uniq(T.rows.map(r => r.po)), sts = uniq(T.rows.filter(r => !l.po || r.po === l.po).map(r => r.style)), cols = uniq(T.rows.filter(r => (!l.po || r.po === l.po) && (!l.style || r.style === l.style)).map(r => r.colour));
        const ph = T.photos[i] || [];
        return `<tr><td><select data-dl="${i}" data-k="po">${opt(pos, l.po)}</select></td><td><select data-dl="${i}" data-k="style">${opt(sts, l.style)}</select></td>
          <td>${cols.length ? `<select data-dl="${i}" data-k="colour">${opt(cols, l.colour)}</select>` : `<input data-dl="${i}" data-k="colour" value="${esc(l.colour || '')}">`}</td>
          <td><input data-dl="${i}" data-k="size" value="${esc(l.size || '')}" style="width:70px"></td>
          <td><input data-dl="${i}" data-k="cartons" value="${esc(l.cartons || '')}" placeholder="12, 15, 20-22"><div class="muted small">${l.cartons ? ctn(l.cartons) + ' carton(s)' : ''}</div></td>
          <td><select data-dl="${i}" data-k="type">${opt(META.damage_types || [], l.type)}</select></td>
          <td><input data-dl="${i}" data-k="remark" value="${esc(l.remark || '')}" placeholder="${l.type === 'Others' ? 'required for Others' : ''}"></td>
          <td><label class="btn small">📷 ${ph.length ? ph.length : 'Add'}<input type="file" accept="image/*" capture="environment" multiple data-ph="${i}" hidden></label>
            <div class="thumbs">${ph.map(p => `<img src="${p.url}" alt="">`).join('')}</div></td>
          <td><button type="button" class="btn small" data-dldel="${i}">×</button></td></tr>`;
      }).join('') + '</tbody></table></div><button type="button" class="btn small" id="offDmgAdd">+ Add damage line</button><p class="muted small">Up to 5 photos per line; they are made smaller and saved to the surveyor\'s Google Drive, and attached to the damage alert e-mail.</p>';
    $$('#offDmgBox [data-dl]').forEach(el => el.onchange = () => { const i = +el.dataset.dl; T.damage[i][el.dataset.k] = el.value.trim(); if (el.dataset.k === 'po' || el.dataset.k === 'style' || el.dataset.k === 'cartons' || el.dataset.k === 'type') renderDmg(); osdLine(); });
    $$('#offDmgBox [data-dldel]').forEach(b => b.onclick = () => { const i = +b.dataset.dldel; T.damage.splice(i, 1); const p = {}; Object.keys(T.photos).forEach(k => { const n = +k; if (n < i) p[n] = T.photos[n]; else if (n > i) p[n - 1] = T.photos[n]; }); T.photos = p; renderDmg(); osdLine(); });
    $('#offDmgAdd').onclick = () => { T.damage.push({}); renderDmg(); };
    $$('#offDmgBox [data-ph]').forEach(inp => inp.onchange = async () => {
      const i = +inp.dataset.ph; T.photos[i] = T.photos[i] || [];
      for (const f of [...inp.files].slice(0, 5 - T.photos[i].length)) { try { T.photos[i].push(await shrink(f)); } catch (e) { toast('Photo not readable: ' + f.name); } }
      renderDmg();
    });
  }
  /* v17.1 seal / truck condition – required before offloading starts; optional photo with SHA-256 */
  let sdlg = null;
  function sealDialog(x) {
    return new Promise(done => {
      if (!sdlg) { sdlg = document.createElement('dialog'); sdlg.id = 'sealDlg'; document.body.appendChild(sdlg); }
      let photo = null;
      sdlg.innerHTML = `<form method="dialog" class="dlg-pad"><h3 style="margin:0 0 8px">Start offloading – truck ${esc(x.truck)}</h3>
        <p class="small"><span class="req">Seal / truck condition</span> – check before the doors are opened.</p>
        <div class="row-end" style="justify-content:flex-start;gap:14px;flex-wrap:wrap">${META.seal_options.map(o => `<label class="chk-l"><input type="radio" name="seal" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>
        <p style="margin:10px 0 4px"><label class="btn small">📷 Seal photo (optional)<input type="file" accept="image/*" capture="environment" id="sealPh" hidden></label> <span class="muted small" id="sealPhInfo"></span></p>
        <p class="gate-err" id="sealErr" hidden></p>
        <div class="row-end"><button class="btn" value="cancel">Cancel</button><button class="btn primary" type="button" id="sealOk">Start offloading</button></div></form>`;
      sdlg.showModal();
      sdlg.onclose = () => done(null);
      $('#sealPh').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { photo = await shrink(f, x.truck); $('#sealPhInfo').textContent = `${photo.name} · ${photo.sha256 ? photo.sha256.slice(0, 12) + '…' : ''}`; } catch (_) { toast('Photo not readable'); } };
      $('#sealOk').onclick = () => {
        const v = (sdlg.querySelector('input[name="seal"]:checked') || {}).value;
        if (!v) { $('#sealErr').textContent = 'Choose Intact, Broken or Open truck.'; $('#sealErr').hidden = false; return; }
        sdlg.onclose = null; sdlg.close(); done({seal: v, photo});
      };
    });
  }
  async function sha256(dataUrl) {
    try { const bin = atob(dataUrl.split(',')[1]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const h = await crypto.subtle.digest('SHA-256', u); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (e) { return ''; }
  }
  /* photos: made smaller in the browser (about 1280 px, JPEG ~200 KB) before they are queued for upload */
  async function shrink(file, truck) {
    const p = await shrink0(file);
    p.sha256 = await sha256(p.url); p.at = window.CSD.ist.stamp(); p.user = (typeof user === 'function' ? user() : '') || ''; p.truck = truck || (T && T.x && T.x.truck) || '';
    return p;
  }
  function shrink0(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 1280 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        let q = 0.8, d = c.toDataURL('image/jpeg', q); while (d.length > 280000 && q > 0.4) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
        res({name: file.name.replace(/\.[^.]+$/, '') + '.jpg', url: d}); };
      img.onerror = rej; img.src = url;
    });
  }
  function osdLine() {
    const parts = T.rows.map(r => {
      const tp = +r.pkgs || 0, rc = r.received === '' ? tp : +r.received;
      const dc = T.anyDamage === 'Yes' ? T.damage.filter(l => l.po === r.po && l.style === r.style).reduce((n, l) => n + ctn(l.cartons), 0) : 0;
      const t = [rc < tp ? `short ${tp - rc}` : rc > tp ? `excess ${rc - tp}` : '', dc ? `damaged ${dc}` : ''].filter(Boolean);
      return t.length ? `${r.style} / PO ${r.po}: ${t.join(', ')} ctn(s)` : null;
    }).filter(Boolean);
    T.needRemark = remarkWhy();
    const lb = $('#offRemarkLab'); if (lb) { lb.className = T.needRemark.length ? 'req' : ''; lb.textContent = T.needRemark.length ? 'OSD remark (required)' : 'OSD remark (optional)'; }
    $('#offOsd').innerHTML = parts.length ? `<b>OSD:</b> ${esc(parts.join(' · '))}` : '<span class="muted">No OSD – received cartons match the booking.</span>';
  }
  function remarkWhy() {
    return T.rows.map(r => { const bk = +r.pkgs || 0, rc = r.received === '' ? bk : +r.received, bc = +r.cbm || 0, ac = r.actual === '' ? null : +r.actual;
      return rc !== bk ? `${r.style}: received ${rc} vs booked ${bk}` : (ac !== null && bc > 0 && Math.abs(ac - bc) / bc > 0.10 ? `${r.style}: actual CBM ${ac} vs ${bc} (more than 10%)` : ''); }).filter(Boolean);
  }
  async function save() {
    const err = m => { $('#offErr').textContent = m; $('#offErr').hidden = false; };
    $('#offErr').hidden = true;
    const header = {}; $$('#offDlg [data-scope="t"]').forEach(el => header[el.dataset.f] = readVal(el));
    if (!T.anyDamage) return err('Choose "Any damaged cartons?" (Yes or No).');
    const notOk = T.rows.map((r, i) => r.ok ? null : i + 1).filter(Boolean);
    if (notOk.length) return err(`Tick "Pkgs & CBM checked" for row(s) ${notOk.join(', ')}.`);
    if (T.rows.some(r => r.received === '' || isNaN(+r.received))) return err('Fill in the received cartons of every row.');
    const seal = T.x.seal || ($('#offSeal') ? $('#offSeal').value : '');
    if (!seal) return err('Choose the seal / truck condition (Intact, Broken or Open truck).');
    const rem = $('#offRemark').value.trim(), why = remarkWhy(), bad = new RegExp(META.bad_remark, 'i');
    if (why.length && (rem.length < 10 || bad.test(rem))) return err(`OSD remark needed – at least 10 characters, saying what was found (not OK / NIL / DONE / CHECKED). ${why.slice(0, 3).join('; ')}.`);
    if (rem && bad.test(rem)) return err(`OSD remark "${rem}" is not accepted – write what was found, or leave it empty.`);
    $('#offSave').disabled = true;
    try {
      const body = {ids: T.x.ids, header, checked: true, seal, any_damage: T.anyDamage, osd_remarks: $('#offRemark').value.trim(),
        damage: T.anyDamage === 'Yes' ? T.damage : [], rows: T.rows.map(r => ({id: r.id, 'Received Pkgs': r.received, 'Actual CBM': r.actual}))};
      const r = await api('/api/truck/offload', {json: body});
      dlg.close();
      toast(`Truck ${r.truck} offloaded – ${r.rows} row(s) now in stock${r.osd ? ` · ${r.osd} with OSD` : ''}`, 6000);
      /* damage: photos + instant alert (sent when online; waits otherwise) */
      if (r.damage && r.damage.length && window.CSD.mailer) {
        const photos = []; T.damage.forEach((l, i) => (T.photos[i] || []).forEach((p, k) => photos.push({line: i, po: l.po, style: l.style, name: `${T.x.truck}_${l.po}_${l.style}_${i + 1}_${k + 1}.jpg`, url: p.url, sha256: p.sha256, at: p.at, user: p.user, truck: p.truck})));
        window.CSD.mailer.damageAlert({seal, seal_photo: T.x.seal_photo || '', truck: r.truck, site: T.x.site || META.site_lock, customer: T.x.customer, vendor: T.x.vendor, invoice: T.x.invoice, lines: r.damage, photos, ids: r.ids}).catch(e => toast('Damage alert: ' + e.message, 6000));
      }
      load(); if (typeof refreshCounts === 'function') refreshCounts();
    } catch (e) {
      const w = (e.data && e.data.warnings) || []; const miss = [...new Set(w.flat().map(x => x.msg && x.msg !== 'Required' ? `${lab(x.field)} (${x.msg})` : lab(x.field)))];
      err(e.message + (miss.length ? ' ' + miss.join(', ') : '')); $('#offSave').disabled = false;
    }
  }
  /* keep the count fresh */
  const start = setInterval(() => { if (typeof META !== 'undefined' && META && META.columns) { clearInterval(start); count(); timer = setInterval(() => { if (sec.classList.contains('active')) load(); else count(); }, 30000);
    if (window.CSD.cloud && window.CSD.cloud.enabled && window.CSD.cloud.onSync) { let last = -1; window.CSD.cloud.onSync(s => { if (s.pending === 0 && last !== 0 && sec.classList.contains('active')) load(); last = s.pending; }); } } }, 400);
})();
