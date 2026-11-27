/* Web-app extras: offline support, "Install app", the data file, backup/restore and first-start welcome. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const store = window.CSD.store;
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';

  /* offline: keep a copy of the app on this PC */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    /* updates: look for a new version every time the app opens; when it has been installed, reload once */
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false, asked = false;
    /* v17.1: a new version is shown as a button; it is used only when the user clicks it (work in progress is not lost) */
    const offer = w => {
      if (!w || !navigator.serviceWorker.controller || document.getElementById('newVer')) return;
      const b = document.createElement('button'); b.id = 'newVer'; b.type = 'button'; b.className = 'newver'; b.textContent = '⟳ New version – click to refresh';
      b.title = 'Save what you are typing first. The app reloads with the new version.';
      b.onclick = () => { asked = true; b.disabled = true; b.textContent = 'Updating…'; w.postMessage({type: 'SKIP_WAITING'}); setTimeout(() => { if (!reloaded) location.reload(); }, 4000); };
      document.body.appendChild(b);
    };
    navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(reg => {
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => { const w = reg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); }); });
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 30 * 60000);
    }).catch(e => console.warn('Offline mode not available:', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && asked && !reloaded) { reloaded = true; location.reload(); } });
  }
  /* ask the browser not to clear this app's data when the disk is full */
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  /* v16.1: Chrome may still clear the data of a plain browser tab. Warn when the storage is not marked as lasting and
     the app is not installed; the fix is the app icon ("Install app"). "Later" hides it for 7 days on this PC. */
  async function storageCheck() {
    try {
      if (!navigator.storage || !navigator.storage.persisted || location.protocol === 'file:') return;
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
      if (standalone || await navigator.storage.persisted()) return;
      let later = ''; try { later = localStorage.getItem('csd_store_later') || ''; } catch (e) {}
      if (later && Date.now() - Number(later) < 7 * 864e5) return;
      const central = !!(window.CSD.cloud && window.CSD.cloud.enabled);
      const b = document.createElement('div'); b.id = 'storeBanner'; b.className = 'card banner';
      b.innerHTML = `<span><b>Chrome may clear this app's data on this PC.</b> ${central ? 'Entries made while the internet is down are kept only here until they are sent.' : 'Your stock and shipper formats are kept only in this browser (plus your data file / backups).'}
        Install the app (button <b>Install app</b> at the top, or the ⊕ icon in Chrome's address bar) and open it from its icon – then Chrome keeps the data. Never use "Clear browsing data".</span>
        <span class="row-end">${$('#installBtn') && !$('#installBtn').hidden ? '<button class="btn primary" id="sbInstall" type="button">Install app</button>' : ''}<button class="btn" id="sbLater" type="button">Later</button></span>`;
      document.querySelector('main').prepend(b);
      const close = () => { b.remove(); try { localStorage.setItem('csd_store_later', String(Date.now())); } catch (e) {} };
      $('#sbLater').onclick = close;
      if ($('#sbInstall')) $('#sbInstall').onclick = () => { $('#installBtn').click(); close(); };
    } catch (e) {}
  }
  setTimeout(storageCheck, 2500);

  /* "Install app" button (Edge / Chrome) */
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('#installBtn').hidden = true; };
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });

  const toast = msg => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3500); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const goTab = name => document.querySelector(`.tab[data-tab="${name}"]`).click();

  /* ---------- data file ---------- */
  function renderFile(st) {
    const pill = $('#filePill'), info = $('#dataFileInfo'), banner = $('#fileBanner');
    $('#dfSave').hidden = !st.name; $('#dfForget').hidden = !st.name;
    if (!store.fileSupported) { $('#dfUnsupported').hidden = false; $('#dfNew').disabled = true; $('#dfOpen').disabled = true; }
    if (st.status === 'ok') {
      pill.className = 'pill on'; pill.textContent = 'Saved to file';
      pill.title = `Data file: ${st.name}${st.saved_at ? ' · saved ' + st.saved_at : ''}`;
      info.innerHTML = `Linked to <b>${esc(st.name)}</b>${st.saved_at ? ` · last saved ${esc(st.saved_at)}` : ''}.`;
      banner.hidden = true;
    } else if (st.status === 'reconnect' || st.status === 'error') {
      pill.className = 'pill off'; pill.textContent = 'File not saved';
      info.innerHTML = st.status === 'error' ? `Could not save to <b>${esc(st.name)}</b>: ${esc(st.error)}. Choose another location with <b>Create data file</b>, or use <b>Download backup</b>.` : `Linked to <b>${esc(st.name)}</b>. Click <b>Save now</b> to allow saving in this session.`;
      banner.hidden = false; banner.className = 'card banner';
      banner.innerHTML = `<span>Your changes are kept in this browser but not yet in your data file <b>${esc(st.name)}</b>.</span><button class="btn primary" id="bnSave" type="button">Allow saving to the file</button>`;
      $('#bnSave').onclick = () => store.saveToFile(true).then(ok => toast(ok ? 'Saved to ' + st.name : 'Saving was not allowed'));
    } else {
      pill.className = 'pill off'; pill.textContent = 'No data file';
      pill.title = 'Data is only inside this browser. Link a data file (Import / backup tab).';
      info.textContent = 'No data file linked yet. Your data is only inside this browser.';
      backupReminder();
    }
  }
  /* Without a data file: remind to download a backup when there are changes not yet backed up. */
  function backupReminder() {
    const banner = $('#fileBanner');
    let lastChange = '', lastBackup = '';
    try { lastChange = localStorage.getItem('csd_last_change') || ''; lastBackup = localStorage.getItem('csd_last_backup') || ''; } catch (e) {}
    if (!lastChange || lastChange <= lastBackup) { banner.hidden = true; return; }
    banner.hidden = false; banner.className = 'card banner';
    banner.innerHTML = `<span>Changes since ${lastBackup ? 'your last backup (' + esc(lastBackup) + ')' : 'you started'} are only inside this browser.</span><button class="btn primary" id="bnBackup" type="button">Download backup now</button>`;
    $('#bnBackup').onclick = () => $('#backupBtn').click();
  }
  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'backupBtn') setTimeout(() => { try { localStorage.setItem('csd_last_backup', store.now()); } catch (er) {} backupReminder(); }, 1500);
  }, true);
  setInterval(() => { if ($('#filePill').textContent === 'No data file') backupReminder(); }, 30000);
  $('#filePill').onclick = () => goTab('import');
  /* Explain a data-file problem in plain words and keep it on screen (not a disappearing message). */
  function diagnose() {
    const brand = (navigator.userAgentData && navigator.userAgentData.brands || []).map(b => b.brand).filter(b => !/Not.?A.?Brand/i.test(b)).join(', ') || navigator.userAgent.split(') ').pop();
    const installed = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches;
    return `Address: ${location.origin}${location.pathname} · secure page: ${window.isSecureContext ? 'yes' : 'no'} · installed app: ${installed ? 'yes' : 'no'} · file saving supported: ${store.fileSupported ? 'yes' : 'no'} · browser: ${brand}`;
  }
  function showFileError(e, action) {
    if (e && e.name === 'AbortError') return;          // the person pressed Cancel
    const name = (e && e.name) || 'Error', msg = (e && e.message) || String(e);
    let why = 'The browser refused to ' + action + '.';
    if (location.protocol === 'file:') why = 'The app was opened as a file from the PC (address starts with file://). Open it from the GitHub address (https://…github.io/…) instead.';
    else if (!window.isSecureContext) why = 'The page is not opened from a secure (https) address. Open it from the GitHub address.';
    else if (name === 'SecurityError' || name === 'NotAllowedError') why = 'Saving to a chosen file is blocked on this PC – usually a company setting in Edge/Chrome, or the folder (e.g. a protected or synced folder) does not allow it. Try saving in Documents first. If it is still blocked, use “Download backup” at the end of each day instead.';
    else if (name === 'TypeError') why = 'This browser does not support saving to a chosen file. Use Microsoft Edge or Google Chrome, or use “Download backup” regularly.';
    else if (name === 'NoModificationAllowedError' || name === 'InvalidStateError') why = 'The chosen file could not be written – it may be read-only or open in another program. Choose another location (e.g. Documents).';
    const box = $('#dfError'); box.hidden = false;
    box.innerHTML = `<b>Could not ${esc(action)}.</b> ${esc(why)}<br><span class="small">Technical detail: ${esc(name)} – ${esc(msg)}<br>${esc(diagnose())}</span>`;
  }
  $('#dfNew').onclick = async () => {
    $('#dfError').hidden = true;
    try { await store.chooseNewFile(); toast('Data file created – it is updated after every change'); }
    catch (e) { showFileError(e, 'create the data file'); }
  };
  $('#dfOpen').onclick = async () => {
    $('#dfError').hidden = true;
    try { await store.openExistingFile(); toast('Data loaded from the file'); setTimeout(() => location.reload(), 600); }
    catch (e) { showFileError(e, 'open the data file'); }
  };
  $('#dfSave').onclick = () => store.saveToFile(true).then(ok => toast(ok ? 'Saved' : 'Saving was not allowed'));
  $('#dfForget').onclick = () => store.forgetFile().then(() => toast('Data file unlinked (the file itself is not deleted)'));
  $('#restoreFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const snap = JSON.parse(await f.text());
      if (snap.kind !== 'cfs_data') throw new Error('This is not a CFS Stock Desk backup file.');
      const d = $('#confirmDlg'); $('#confirmText').textContent = `Replace everything in this app with the backup from ${snap.saved_at || 'the file'} (${(snap.stock || []).length} stock rows, ${(snap.profiles || []).length} shipper formats)?`;
      d.returnValue = ''; d.showModal();
      d.addEventListener('close', async () => { if (d.returnValue !== 'yes') return; await store.restore(snap); await store.saveToFile(false); toast('Backup restored'); setTimeout(() => location.reload(), 600); }, {once: true});
    } catch (err) { toast(err.message); }
  };

  /* ---------- first start ---------- */
  async function firstStart() {
    if (window.CSD.cloud && window.CSD.cloud.enabled) return;     // central version: no data file
    const seen = await store.getSetting('welcomed');
    const [profiles, stock] = await Promise.all([store.profiles(), store.stock(null)]);
    if (seen || profiles.length || stock.length) return;
    const card = document.createElement('div'); card.className = 'card banner ok'; card.id = 'welcome';
    card.innerHTML = `<div><b>Welcome to CFS Stock Desk.</b> Everything runs inside this browser – documents never leave this PC.<br>
      <span class="muted small">Start by linking a data file (keeps your data safe), then import the starter shipper formats file and your current stock report if you have them.</span></div>
      <div class="row-end"><button class="btn" id="wSkip" type="button">Later</button><button class="btn primary" id="wGo" type="button">Set up data file</button></div>`;
    if (!document.querySelector('#cfsSel').value) card.querySelector('.muted').insertAdjacentHTML('afterbegin', '<b>First choose this PC\'s CFS at the top right.</b> ');
    document.querySelector('main').prepend(card);
    const close = () => { card.remove(); store.setSetting('welcomed', true); };
    $('#wSkip').onclick = close; $('#wGo').onclick = () => { close(); goTab('import'); };
  }

  /* ---------- report headers per city ---------- */
  let hdrState = {};
  async function renderHeaders() {
    const REP = window.CSD.report; hdrState = await REP.getHeaders();
    const lock = window.CSD.F.siteLock(), mineKey = lock ? (REP.SITES[lock] || {}).header : null;
    $('#headersForm').innerHTML = Object.entries(hdrState).filter(([k]) => !mineKey || k === mineKey).map(([k, v]) => `<fieldset><legend>${esc(v.label)}</legend><div class="hdr-grid">
      ${REP.HEADER_FIELDS.map(([f, lab]) => `<label class="fld"><span class="muted small">${esc(lab)}</span><input data-h="${k}" data-f="${f}" value="${esc(v[f] || '')}" ${!v[f] ? 'placeholder="(blank)"' : ''}></label>`).join('')}
    </div></fieldset>`).join('');
  }
  function collect() { document.querySelectorAll('#headersForm input[data-h]').forEach(i => { hdrState[i.dataset.h][i.dataset.f] = i.value.trim(); }); }
  async function saveHeaders(msg) {
    const out = {}; for (const [k, v] of Object.entries(hdrState)) { out[k] = Object.assign({}, v); delete out[k].label; delete out[k].logo; }
    await store.setSetting('report_headers', out); await renderHeaders(); toast(msg || 'Report headers saved');
  }
  $('#hdrSave').onclick = () => { collect(); saveHeaders(); };
  $('#hdrReset').onclick = async () => { await store.setSetting('report_headers', null); await renderHeaders(); toast('Report headers reset to default'); };


  /* ---------- combine from shared folder (every PC's data file) ---------- */
  let sfSources = [], sfSites = [];
  const ageHours = t => { const d = new Date(String(t || '').replace(' ', 'T')); return isNaN(d) ? null : (Date.now() - d.getTime()) / 3600000; };
  function sfError(e) { const b = $('#sfErr'); if (!e) { b.hidden = true; return; } b.hidden = false; b.innerHTML = esc(e); }
  async function readDataFiles(entries) {        // entries: [{name, file, handle}]
    const out = [], otherSite = []; let mineFound = false, skipped = 0;
    for (const en of entries) {
      try {
        const snap = JSON.parse(await en.file.text());
        if (snap.kind !== 'cfs_data') { skipped++; continue; }
        if (en.handle && await store.isMyFile(en.handle)) mineFound = true;
        let rows = (snap.stock || []).filter(x => (x.status || 'in') === 'in').map(x => x.data);
        const lock = window.CSD.F.siteLock();
        if (lock) {            // site mode: only this site's data files / rows
          if (snap.cfs && snap.cfs !== lock) { otherSite.push(en.name + ' (' + snap.cfs + ')'); continue; }
          rows = rows.filter(r => { const w = String(r['Warehouse ID'] || '').trim().toUpperCase(); return !w || w === lock; });
        }
        out.push({file: en.name, saved_by: snap.saved_by || '', cfs: snap.cfs || '', saved_at: snap.saved_at || '', rows});
      } catch (e) { skipped++; }
    }
    return {out, mineFound, skipped, otherSite};
  }
  async function useEntries(entries, folderName) {
    sfError(null); $('#sfBtn').hidden = true; $('#sfInfo').textContent = 'Reading data files…';
    const {out, mineFound, skipped, otherSite} = await readDataFiles(entries);
    if (mineFound) $('#sfMine').checked = false;
    if (!out.length) { $('#sfInfo').textContent = ''; sfError(otherSite.length ? `No data files of ${window.CSD.F.siteLock()} here – only of other CFS: ${otherSite.join(', ')}.` : `No CFS Stock Desk data files found${folderName ? ' in “' + folderName + '”' : ''}. Each PC must create its data file in this folder (Import / backup → Create data file).`); return; }
    out.sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));   // freshest data file first: its rows win duplicates
    sfSources = out.map(x => ({name: `${x.saved_by || x.file}${x.cfs ? ' – ' + x.cfs : ''} (saved ${x.saved_at || '?'})`, rows: x.rows}));
    const r = await (await fetch('/api/combine-data', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sources: sfSources, include_mine: $('#sfMine').checked, preview: true})})).json();
    if (r.error) { sfError(r.error); return; }
    sfSites = r.sites || [];
    $('#sfInfo').innerHTML = `${folderName ? `Folder <b>${esc(folderName)}</b> · ` : ''}${out.length} data file(s)${skipped ? `, ${skipped} other file(s) ignored` : ''}${otherSite.length ? `, ${otherSite.length} data file(s) of other CFS not included: ${esc(otherSite.join(', '))}` : ''}${mineFound ? ' · this PC\'s own data file is included' : ''}
      <div class="table-wrap"><table class="grid"><thead><tr><th>Data file</th><th>Saved by</th><th>CFS</th><th>Last saved</th><th class="num">Rows in stock</th></tr></thead><tbody>
      ${out.map(x => { const h = ageHours(x.saved_at); const old = h === null || h > 24;
        return `<tr><td>${esc(x.file)}</td><td>${esc(x.saved_by || '–')}</td><td>${esc(x.cfs || '–')}</td><td>${esc(x.saved_at || '?')}${old ? ' <span class="badge warn">' + (h === null ? 'unknown' : Math.round(h) + ' h old') + '</span>' : ''}</td><td class="num">${x.rows.length}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p><b>${r.combined_rows} rows</b> after combining${r.duplicates ? `; ${r.duplicates} duplicate row(s) removed (listed on a separate sheet)` : ''}. One report per CFS: ${sfSites.map(x => `${esc(x.cfs || 'CFS not set')} (${x.rows})`).join(', ') || '–'}.</p>`;
    $('#sfBtn').textContent = sfSites.length > 1 ? `Download ${sfSites.length} combined reports (one per CFS)` : 'Download combined report';
    $('#sfBtn').hidden = !sfSites.length;
  }
  async function folderEntries(dir) {
    const list = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file' && /\.json$/i.test(name)) list.push({name, handle: h, file: await h.getFile()});
      else if (h.kind === 'directory') {            // one level of sub-folders (e.g. one per person)
        for await (const [n2, h2] of h.entries()) if (h2.kind === 'file' && /\.json$/i.test(n2)) list.push({name: name + '/' + n2, handle: h2, file: await h2.getFile()});
      }
    }
    return list;
  }
  async function combineFolder(dir) {
    try { await useEntries(await folderEntries(dir), dir.name); }
    catch (e) { sfError('Could not read the folder: ' + (e.name ? e.name + ' – ' : '') + (e.message || e)); }
  }
  if (typeof window.showDirectoryPicker !== 'function') {
    $('#sfPick').hidden = true;
    $('#sfInfo').innerHTML = 'This browser cannot open a folder – use <b>Choose data files instead</b> and select all the data files in the shared folder (Ctrl+A).';
  }
  $('#sfPick').onclick = async () => {
    try { const dir = await window.showDirectoryPicker({mode: 'read'}); await store.setSetting('combineFolder', dir); $('#sfAgain').hidden = false; $('#sfAgain').textContent = 'Combine again from “' + dir.name + '”'; await combineFolder(dir); }
    catch (e) { if (e.name !== 'AbortError') sfError('Could not open the folder: ' + (e.name ? e.name + ' – ' : '') + (e.message || e) + '. If this keeps happening, use “Choose data files instead”.'); }
  };
  $('#sfAgain').onclick = async () => {
    const dir = await store.getSetting('combineFolder'); if (!dir) return;
    try { if ((await dir.requestPermission({mode: 'read'})) !== 'granted') { sfError('Reading the folder was not allowed.'); return; } await combineFolder(dir); }
    catch (e) { sfError('Could not open the folder again – choose it once more. (' + (e.message || e) + ')'); }
  };
  $('#sfFiles').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) await useEntries(fs.map(f => ({name: f.name, file: f, handle: null})), ''); };
  $('#sfBtn').onclick = async () => {
    try {
      let n = 0;
      for (const x of sfSites) {
        const r = await fetch('/api/combine-data', {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({sources: sfSources, include_mine: $('#sfMine').checked, site: x.cfs === '' ? '__none' : x.cfs})});
        if (!r.ok) throw new Error((await r.json()).error || 'Could not combine');
        const blob = await r.blob(); const name = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'Combined_Stock_Report.xlsx';
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); n++;
        if (sfSites.length > 1) await new Promise(r2 => setTimeout(r2, 800));
      }
      toast(`Saved ${n} combined report${n === 1 ? '' : 's'} in your Downloads folder`);
    } catch (e) { sfError(e.message || String(e)); }
  };

  window.PWA_READY = async () => {
    store.getSetting('combineFolder').then(d => { if (d) { $('#sfAgain').hidden = false; $('#sfAgain').textContent = 'Combine again from “' + d.name + '”'; } }).catch(() => {});
    renderHeaders();
    store.onFileState(renderFile);
    await store.initFile();
    firstStart();
    const a = $('#aboutInfo'); if (a) a.textContent = `Version ${window.CSD.server.VERSION} · data kept in this browser${store.fileSupported ? ' and your data file' : ''}`;
  };
})();
