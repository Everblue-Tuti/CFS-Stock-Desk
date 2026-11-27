/* Version 15 screens for the central database: sign-in, first admin, sync bar, user menu, site choice,
   and the Admin tab (users, CFS list, moving a PC's data up). Loaded before cloud.js (cloud.js calls showLogin/busy). */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const ROLE = {operator: 'Operator', admin: 'Admin', management: 'Management (view only)'};
  const ui = {};
  window.CSD.cloudUI = ui;
  const C = () => window.CSD.cloud;

  /* ---------- full-screen sign-in ---------- */
  function overlay() {
    let o = $('#cloudGate');
    if (!o) {
      o = document.createElement('div'); o.id = 'cloudGate'; o.className = 'gate';
      o.innerHTML = `<div class="gate-card"><div class="brand"><span class="mark" aria-hidden="true"></span><div><strong>CFS Stock Desk</strong><small>Central database</small></div></div><div id="gateBody"></div></div>`;
      document.body.appendChild(o);
    }
    o.hidden = false; return o;
  }
  ui.busy = msg => { overlay(); $('#gateBody').innerHTML = `<p class="muted">${esc(msg)}</p>`; };
  ui.hideGate = () => { const o = $('#cloudGate'); if (o) o.hidden = true; };
  ui.showLogin = async (why) => {
    overlay();
    const first = await C().needsOwner();
    if (first) return showFirstAdmin();
    $('#gateBody').innerHTML = `
      <h2>Sign in</h2>
      ${why ? `<p class="gate-err">${esc(why)}</p>` : ''}
      <form id="loginForm" class="gate-form" autocomplete="on">
        <label>User ID<input id="lgUser" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="e.g. ravi.stj"></label>
        <label>Password<input id="lgPw" type="password" autocomplete="current-password" required></label>
        <p class="gate-err" id="lgErr" hidden></p>
        <button class="btn primary" id="lgBtn">Sign in</button>
        <p class="muted small">Forgot the password? Ask the admin to set a new one. The first sign-in on a PC needs the internet.</p>
      </form>`;
    $('#lgUser').focus();
    $('#loginForm').onsubmit = async e => {
      e.preventDefault(); $('#lgBtn').disabled = true; $('#lgErr').hidden = true;
      try { await C().signIn($('#lgUser').value, $('#lgPw').value); ui.busy('Signing in…'); }
      catch (er) { $('#lgErr').textContent = er.message; $('#lgErr').hidden = false; $('#lgBtn').disabled = false; }
    };
  };
  function showFirstAdmin() {
    $('#gateBody').innerHTML = `
      <h2>Set up the central database</h2>
      <p class="muted">No admin exists yet. Create the first admin – this is done once. The admin then adds everyone else.</p>
      <form id="faForm" class="gate-form">
        <label>Admin user ID<input id="faUser" required placeholder="e.g. admin.everblue" autocapitalize="none" spellcheck="false"></label>
        <label>Name<input id="faName" required placeholder="Full name"></label>
        <label>Password (min. 10, letters + digits)<input id="faPw" type="password" required autocomplete="new-password"></label>
        <label>Password again<input id="faPw2" type="password" required autocomplete="new-password"></label>
        <p class="gate-err" id="faErr" hidden></p>
        <button class="btn primary" id="faBtn">Create admin and sign in</button>
      </form>`;
    $('#faForm').onsubmit = async e => {
      e.preventDefault(); const err = m => { $('#faErr').textContent = m; $('#faErr').hidden = false; };
      if ($('#faPw').value !== $('#faPw2').value) return err('The two passwords are not the same.');
      if (C().pwBad && C().pwBad($('#faPw').value)) return err(C().pwBad($('#faPw').value));
      $('#faBtn').disabled = true;
      try { await C().createFirstAdmin($('#faUser').value, $('#faName').value, $('#faPw').value); ui.busy('Admin created – opening…'); }
      catch (er) { err(er.message || String(er)); $('#faBtn').disabled = false; }
    };
  }

  /* ---------- after sign-in: sync bar, user menu, site choice, role limits ---------- */
  ui.afterReady = () => {
    const c = C(), p = c.profile, F = window.CSD.F;
    ui.hideGate();
    document.body.classList.add('cloud', 'role-' + p.role);
    /* local-only things are not used with the central database */
    for (const s of ['[data-tab="combine"]', '#filePill', '#fileBanner', '#cfsSel', 'label[for="cfsSel"]', '#userName']) $$(s).forEach(el => { el.hidden = true; });
    const dfCard = $('#dfNew') && $('#dfNew').closest('.card'); if (dfCard) dfCard.hidden = true;
    const rsCard = $('#restoreFile') && $('#restoreFile').closest('.card'); if (rsCard) rsCard.hidden = true;
    /* user menu */
    const who = $('.who');
    const chip = document.createElement('div'); chip.className = 'userchip';
    const allSites = p.site === 'ALL';
    chip.innerHTML = `<span id="syncPill" class="pill">…</span>
      ${allSites ? `<select id="siteSwitch" title="Site you are working on">${['', ...F.CFS_LIST].map(s => `<option value="${esc(s)}" ${s === (F.siteLock() || '') ? 'selected' : ''}>${s ? esc(s) : 'All sites (view)'}</option>`).join('')}</select>` : ''}
      <button class="btn small" id="userBtn" type="button" title="${esc(ROLE[p.role] || p.role)}">${esc(p.name || p.user_id)} ▾</button>
      <div class="usermenu" id="userMenu" hidden>
        <div class="muted small">${esc(p.user_id)} · ${esc(ROLE[p.role] || p.role)}<br>${esc(p.site === 'ALL' ? 'All sites' : p.site)}</div>
        <button class="btn small" id="pwBtn" type="button">Change my password</button>
        <button class="btn small" id="outBtn" type="button">Sign out</button>
      </div>`;
    who.appendChild(chip);
    $('#userBtn').onclick = () => { $('#userMenu').hidden = !$('#userMenu').hidden; };
    document.addEventListener('click', e => { if (!chip.contains(e.target)) $('#userMenu').hidden = true; });
    $('#outBtn').onclick = async () => { if (c.syncState().pending && !(await ask('Some entries are not sent to the central database yet (no internet). If you sign out now they may be lost. Sign out anyway?'))) return; c.signOut(); };
    $('#pwBtn').onclick = async () => {
      const pw = await typed('New password (at least 10 characters, letters and digits):', {password: true, twice: true, min: 10}); if (!pw) return;
      try { await c.changePassword(pw); toast('Password changed'); } catch (e) { say(/recent/.test(e.code || '') ? 'For safety, sign out and sign in again, then change the password.' : (e.message || e)); }
    };
    if ($('#siteSwitch')) $('#siteSwitch').onchange = e => c.switchSite(e.target.value);
    /* sync / offline bar */
    let bar = $('#syncBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'syncBar'; bar.className = 'syncbar'; bar.hidden = true; $('main').prepend(bar); }
    c.onSync(s => {
      const pill = $('#syncPill');
      if (pill) { pill.className = 'pill ' + (s.online && !s.pending ? 'on' : 'off'); pill.textContent = s.online ? (s.pending ? `Sending ${s.pending}…` : 'Online') : 'Offline'; }
      if (!s.online) { bar.hidden = false; bar.className = 'syncbar off'; bar.textContent = `Offline – ${s.pending ? s.pending + ' entr' + (s.pending === 1 ? 'y' : 'ies') + ' waiting to be sent. ' : ''}Reading documents, saving stock and Start / Offloaded still work. Stuffing, admin changes and sending reports wait for the internet.`; }
      else if (s.error) { bar.hidden = false; bar.className = 'syncbar bad'; bar.textContent = 'Central database: ' + s.error; }
      else if (s.pending) { bar.hidden = false; bar.className = 'syncbar'; bar.textContent = `Sending ${s.pending} entr${s.pending === 1 ? 'y' : 'ies'} to the central database…`; }
      else bar.hidden = true;
    });
    window.addEventListener('beforeunload', e => { if (c.syncState().pending) { e.preventDefault(); e.returnValue = ''; } });
    /* management: view only */
    if (p.role === 'management') {
      $$('[data-tab="read"],[data-tab="formats"],[data-tab="import"]').forEach(el => { el.hidden = true; });
      const st = $('[data-tab="stock"]'); if (st) st.click();
    }
    if (allSites && !F.siteLock()) {
      const b = document.createElement('div'); b.className = 'card banner';
      b.innerHTML = '<span><b>Choose a site</b> (top right) to work. "All sites" is for viewing only.</span>';
      $('main').prepend(b);
      $$('[data-tab="read"]').forEach(el => { el.hidden = true; }); const st = $('[data-tab="stock"]'); if (st) st.click();
    }
    if (p.role === 'admin') buildAdminTab();
  };
  /* v16.1: the app's own dialogs instead of browser pop-ups (fallback only before the app has loaded) */
  const say = m => window.alertBox ? window.alertBox(String(m)) : window.alert(m);
  const ask = m => window.confirmBox ? window.confirmBox(m) : Promise.resolve(window.confirm(m));
  const typed = (m, o) => window.promptBox ? window.promptBox(m, o) : Promise.resolve(window.prompt(m));
  function toast(m) { const t = $('#toast'); if (!t) return say(m); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 4000); }

  /* =====================================================================================================
     Admin tab: users · CFS list · move data up
     ===================================================================================================== */
  function buildAdminTab() {
    const tabs = $('.tabs');
    const tb = document.createElement('button'); tb.className = 'tab'; tb.dataset.tab = 'admin'; tb.textContent = 'Admin'; tabs.appendChild(tb);
    const sec = document.createElement('section'); sec.id = 'tab-admin'; sec.className = 'view';
    sec.innerHTML = `
      <div class="card"><div class="row-end" style="justify-content:space-between"><h3>Users</h3><button class="btn primary small" id="uAdd" type="button">+ Add user</button></div>
        <div class="table-wrap"><table class="grid" id="uTable"></table></div>
        <p class="muted small">Operator: own site work. Admin: everything, incl. edit / delete / return to stock, lists, users and CFS list. Management: view only. A blocked user cannot sign in.</p></div>
      <div class="card"><div class="row-end" style="justify-content:space-between"><h3>CFS sites</h3><button class="btn small" id="sAdd" type="button">+ Add CFS</button></div>
        <div class="table-wrap"><table class="grid" id="sTable"></table></div>
        <div class="row-end"><button class="btn primary" id="sSave" type="button" disabled>Save CFS list</button></div>
        <p class="muted small">Layout GAP = Tuticorin stock report (45 columns); APLL = current Chennai report (49 columns). A CFS with data can only be deactivated (hidden from new entries; its stock, reports and history stay).</p></div>
      <div class="card"><h3>Move this PC's data to the central database</h3>
        <p class="muted small">Switch-over day, once per site: on the PC that has that site's combined and checked stock, choose the site and press Move. Shipper formats from every PC can be added with "Add this PC's shipper formats".</p>
        <div class="row-end" style="justify-content:flex-start"><select id="mvSite"></select><button class="btn primary" id="mvGo" type="button">Move stock, stuffings and formats</button>
          <button class="btn" id="mvFmt" type="button">Add this PC's shipper formats only</button></div>
        <p class="small" id="mvInfo"></p></div>`;
    $('main').appendChild(sec);
    tb.addEventListener('click', () => { $$('.tab').forEach(t => t.classList.toggle('active', t === tb)); $$('.view').forEach(v => v.classList.toggle('active', v === sec)); loadUsers(); renderSites(); if (window.CSD.refreshMailLog) window.CSD.refreshMailLog(); });
    /* other tabs must hide this one */
    $$('.tab').forEach(t => { if (t !== tb) t.addEventListener('click', () => { sec.classList.remove('active'); tb.classList.remove('active'); }); });
    $('#uAdd').onclick = () => userDialog();
    $('#sAdd').onclick = () => { sites.push({name: '', code: '', short: '', city: '', layout: 'GAP', header: 'EVERBLUE', active: true, _new: true}); renderSites(true); };
    $('#sSave').onclick = saveSites;
    $('#mvSite').innerHTML = window.CSD.F.CFS_LIST.map(s => `<option ${s === window.CSD.F.siteLock() ? 'selected' : ''}>${esc(s)}</option>`).join('');
    $('#mvGo').onclick = moveUp;
    if (window.CSD.adminExtras) window.CSD.adminExtras(sec);
    $('#mvFmt').onclick = async () => { try { const n = await C().uploadFormats(); $('#mvInfo').textContent = `${n} shipper format(s) added or updated.`; } catch (e) { $('#mvInfo').textContent = e.message; } };
  }
  let users = [], sites = [];
  async function loadUsers() {
    try { users = await C().listUsers(); } catch (e) { $('#uTable').innerHTML = `<tr><td class="muted">${esc(e.message)}</td></tr>`; return; }
    const shown = users.filter(u => !u.replaced_by);
    $('#uTable').innerHTML = `<thead><tr><th>User ID</th><th>Name</th><th>Role</th><th>Site</th><th>Status</th><th></th></tr></thead><tbody>` +
      shown.map(u => `<tr><td>${esc(u.user_id)}</td><td>${esc(u.name)}</td><td>${esc(ROLE[u.role] || u.role)}</td><td>${esc(u.site === 'ALL' ? 'All sites' : u.site)}</td>
        <td>${u.active === false ? '<span class="pill off">Blocked</span>' : '<span class="pill on">Active</span>'}</td>
        <td class="row-end"><button class="btn small" data-ed="${esc(u.uid)}">Edit</button><button class="btn small" data-pw="${esc(u.uid)}">New password</button>
          <button class="btn small" data-bl="${esc(u.uid)}">${u.active === false ? 'Unblock' : 'Block'}</button></td></tr>`).join('') + '</tbody>';
    $$('#uTable [data-ed]').forEach(b => b.onclick = () => userDialog(users.find(u => u.uid === b.dataset.ed)));
    $$('#uTable [data-pw]').forEach(b => b.onclick = async () => {
      const u = users.find(x => x.uid === b.dataset.pw); const pw = await typed(`New password for ${u.user_id} (at least 10 characters, letters and digits):`, {password: true, twice: true, min: 10}); if (!pw) return;
      if (!(await pinOk('Setting a new password needs the admin PIN.'))) return;
      try { await C().resetPassword(u, pw); toast(`New password set for ${u.user_id}. Tell them to sign in again.`); loadUsers(); } catch (e) { say(e.message || e); }
    });
    $$('#uTable [data-bl]').forEach(b => b.onclick = async () => {
      const u = users.find(x => x.uid === b.dataset.bl);
      if (!(await pinOk((u.active === false ? 'Unblocking' : 'Blocking') + ' a user needs the admin PIN.'))) return;
      try { await C().updateUser(u.uid, {active: u.active === false}); loadUsers(); } catch (e) { say(e.message || e); }
    });
  }
  function siteOptions(cur) { return ['ALL', ...window.CSD.F.SELECTS['Warehouse ID']].map(s => `<option value="${esc(s)}" ${s === cur ? 'selected' : ''}>${s === 'ALL' ? 'All sites' : esc(s)}</option>`).join(''); }
  function userDialog(u) {
    let d = $('#userDlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'userDlg'; document.body.appendChild(d); }
    d.innerHTML = `<form method="dialog" class="dlg-pad"><h3>${u ? 'Edit user ' + esc(u.user_id) : 'Add user'}</h3>
      <div class="form-grid">
        <label>User ID<input id="udId" ${u ? 'disabled' : ''} value="${esc(u ? u.user_id : '')}" placeholder="e.g. ravi.stj" autocapitalize="none" spellcheck="false"></label>
        <label>Name<input id="udName" value="${esc(u ? u.name : '')}"></label>
        <label>Role<select id="udRole">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${u && u.role === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>Site<select id="udSite">${siteOptions(u ? u.site : '')}</select></label>
        ${u ? '' : '<label>Password (min. 10, letters + digits)<input id="udPw" type="text" autocomplete="off"></label>'}
      </div><p class="gate-err" id="udErr" hidden></p>
      <div class="row-end"><button class="btn" value="cancel">Cancel</button><button class="btn primary" id="udOk" type="button">${u ? 'Save' : 'Add user'}</button></div></form>`;
    d.showModal();
    $('#udOk').onclick = async () => {
      const err = m => { $('#udErr').textContent = m; $('#udErr').hidden = false; };
      if (!(await pinOk((u ? 'Changing' : 'Adding') + ' a user needs the admin PIN.'))) return;
      $('#udOk').disabled = true;
      try {
        if (u) await C().updateUser(u.uid, {name: $('#udName').value.trim(), role: $('#udRole').value, site: $('#udSite').value});
        else await C().addUser({user_id: $('#udId').value, name: $('#udName').value.trim(), role: $('#udRole').value, site: $('#udSite').value, password: $('#udPw').value});
        d.close(); toast(u ? 'User saved' : 'User added'); loadUsers();
      } catch (e) { err(e.message || String(e)); $('#udOk').disabled = false; }
    };
  }
  /* admin PIN (asked every time) – uses the app's PIN dialog when present */
  async function pinOk(why) {
    if (typeof window.adminPinAsk === 'function') return !!(await window.adminPinAsk(why));
    return true;
  }
  async function renderSites(dirty) {
    if (!dirty) sites = JSON.parse(JSON.stringify(C().sites || []));
    const counts = {};
    try { for (const r of await window.CSD.store.stock('')) { const w = String(r.data['Warehouse ID'] || '').toUpperCase(); counts[w] = (counts[w] || 0) + 1; } } catch (e) {}
    $('#sTable').innerHTML = `<thead><tr><th>CFS name (as Warehouse ID)</th><th>Code</th><th>Short name</th><th>City</th><th>Report layout</th><th>Report header</th><th>Status</th><th></th></tr></thead><tbody>` +
      sites.map((s, i) => `<tr data-i="${i}"><td><input data-k="name" value="${esc(s.name)}" ${s._new ? '' : 'readonly title="The name is stored on every stock row, so it cannot be changed. Add a new CFS instead."'}></td>
        <td><input data-k="code" value="${esc(s.code)}" style="min-width:60px"></td><td><input data-k="short" value="${esc(s.short)}"></td><td><input data-k="city" value="${esc(s.city)}"></td>
        <td><select data-k="layout"><option ${s.layout === 'GAP' ? 'selected' : ''}>GAP</option><option ${s.layout === 'APLL' ? 'selected' : ''}>APLL</option></select></td>
        <td><select data-k="header"><option ${s.header === 'EVERBLUE' ? 'selected' : ''}>EVERBLUE</option><option ${s.header === 'PINNACLE' ? 'selected' : ''}>PINNACLE</option></select></td>
        <td>${s.active === false ? '<span class="pill off">Inactive</span>' : '<span class="pill on">Active</span>'} <span class="muted small">${counts[String(s.name).toUpperCase()] || 0} rows</span></td>
        <td class="row-end">${s._new && !counts[String(s.name).toUpperCase()] ? '<button class="btn small" data-del>Remove</button>' : `<button class="btn small" data-act>${s.active === false ? 'Activate' : 'Deactivate'}</button>`}
          ${!s._new && !counts[String(s.name).toUpperCase()] ? '<button class="btn small" data-del>Delete</button>' : ''}</td></tr>`).join('') + '</tbody>';
    $$('#sTable input, #sTable select').forEach(el => el.oninput = el.onchange = () => { const i = +el.closest('tr').dataset.i; sites[i][el.dataset.k] = el.value.toUpperCase ? (el.dataset.k === 'name' || el.dataset.k === 'code' ? el.value.toUpperCase() : el.value) : el.value; $('#sSave').disabled = false; });
    $$('#sTable [data-act]').forEach(b => b.onclick = () => { const i = +b.closest('tr').dataset.i; sites[i].active = sites[i].active === false; renderSites(true); $('#sSave').disabled = false; });
    $$('#sTable [data-del]').forEach(b => b.onclick = () => { const i = +b.closest('tr').dataset.i; sites.splice(i, 1); renderSites(true); $('#sSave').disabled = false; });
  }
  async function saveSites() {
    const clean = sites.map(s => ({name: String(s.name || '').trim().toUpperCase(), code: String(s.code || '').trim().toUpperCase(), short: String(s.short || s.code || '').trim().toUpperCase(),
      city: String(s.city || '').trim().toUpperCase(), layout: s.layout || 'GAP', header: s.header || 'EVERBLUE', active: s.active !== false}));
    if (clean.some(s => !s.name || !s.code)) return say('Every CFS needs a name and a code.');
    if (new Set(clean.map(s => s.name)).size !== clean.length || new Set(clean.map(s => s.code)).size !== clean.length) return say('Two CFS have the same name or code.');
    if (!(await pinOk('Changing the CFS list needs the admin PIN.'))) return;
    try { await C().saveSites(clean); $('#sSave').disabled = true; toast('CFS list saved'); renderSites(); } catch (e) { say(e.message || e); }
  }
  async function moveUp() {
    const site = $('#mvSite').value;
    if (!(await ask(`Move this PC's stock for ${site} into the central database?\n\nDo this once per site, from the PC with the combined and checked stock. Rows with no CFS are given ${site}.`))) return;
    if (!(await pinOk('Moving data needs the admin PIN.'))) return;
    $('#mvGo').disabled = true; $('#mvInfo').textContent = 'Reading this PC\'s data…';
    try {
      const r = await C().uploadLocal({site, onProgress: m => { $('#mvInfo').textContent = m; }});
      $('#mvInfo').innerHTML = `<b>Done:</b> ${r.in} rows in stock, ${r.pending} waiting to offload and ${r.out} shipped-out rows, ${r.stuffings} stuffings and ${r.formats} shipper format(s) moved for ${esc(site)}.` + (r.other_site ? ` ${r.other_site} row(s) of other sites were left out.` : '');
    } catch (e) { $('#mvInfo').textContent = e.message || String(e); }
    $('#mvGo').disabled = false;
  }
  /* v17.1 idle timeout (central version): warning after 15 minutes without use, sign-out after 30 minutes.
     Entries still waiting to be sent keep the user signed in (the warning stays) so nothing is lost. */
  (function idle() {
    const WARN = 15 * 60000, OUT = 30 * 60000; let last = Date.now(), bar = null, pending = 0;
    const touch = () => { last = Date.now(); if (bar) { bar.remove(); bar = null; } };
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'].forEach(ev => document.addEventListener(ev, touch, {passive: true, capture: true}));
    const hook = setInterval(() => { const c = C(); if (c && c.enabled && c.onSync) { clearInterval(hook); c.onSync(st => { pending = st.pending || 0; }); } }, 1000);
    setInterval(() => {
      const c = C(); if (!c || !c.enabled || !c.profile) return;
      const idleFor = Date.now() - last;
      if (idleFor >= OUT && !pending) { c.signOut(); return; }
      if (idleFor >= WARN && !bar) {
        bar = document.createElement('div'); bar.className = 'idlebar';
        bar.textContent = pending ? 'Not used for 15 minutes. Entries are still being sent – you stay signed in until they are sent.' : 'Not used for 15 minutes – you will be signed out in 15 minutes for safety. Move the mouse or press a key to stay signed in.';
        document.body.appendChild(bar);
      }
    }, 20000);
  })();
})();
