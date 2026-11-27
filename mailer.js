/* Version 15 – sending reports by e-mail through the surveyor's Google Apps Script (Gmail).
   The open site PC sends at the set times (full Excel); if nothing has gone 15 minutes after the time, the Google
   script sends a backup copy from the database. One claim per site / day / report, so only one sender wins.
   E-mails (decision C – fewer, combined):
     10:00  Opening stock + OSD report          12:00 / 16:00 / 18:00  stock report
     Closing (when the Closing report is made, or at the backup time): Closing stock + inbound & outbound table
       + stuffing day summary + ageing red list            Admin changes (admin list) with the closing
     Mondays: ageing + EV tag (last week) + truck turnaround     1st of the month: EV tag (last month)
     At once (short list): damage alert with photos, each stuffed container, "cancelled / returned to stock". */
(function () {
  'use strict';
  const CSD = window.CSD, ist = CSD.ist, cloud = () => CSD.cloud;
  const LIMIT = 100, WARN = 80;
  const ROUTES = [
    ['opening', 'Opening stock + OSD report (10:00)'], ['s1200', 'Stock report 12:00'], ['s1600', 'Stock report 16:00'], ['s1800', 'Stock report 18:00'],
    ['closing', 'Closing e-mail (stock, inbound & outbound, stuffing, ageing red list)'], ['weekly', 'Mondays: ageing, EV tag, truck turnaround'], ['ev_monthly', '1st of month: EV tag (last month)'],
    ['stuffing', 'Each stuffed container (short list)'], ['osd_alert', 'Damage alert with photos (short list)'], ['admin', 'Admin changes (daily, admin list)']];
  const CUSTOMER_COPY = ['opening', 's1200', 's1600', 's1800', 'closing'];
  const SLOT_AT = {opening: '10:00', s1200: '12:00', s1600: '16:00', s1800: '18:00'};
  const code = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const mails = s => String(s || '').split(/[\s,;]+/).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  const site = () => CSD.F.siteLock();
  const short = s => ((CSD.report.SITES[s] || {}).short || s || 'CFS');
  const dmy = d => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
  async function settings() { return {mail: (await CSD.store.getSetting('mail')) || {}, rec: (await CSD.store.getSetting('recipients')) || {}}; }
  const listFor = (rec, key, s) => mails(((rec.routes || {})[key] || {})[s] || '');
  const customerLists = (rec, s) => { const o = {}; for (const line of String(((rec.customers || {})[s]) || '').split('\n')) { const [g, ...m] = line.split(':'); const l = mails(m.join(':')); if (g && g.trim() && l.length) o[g.trim().toUpperCase()] = l; } return o; };

  /* ---------- helpers: files from the app's own routes ---------- */
  async function file(url, opts) {
    const r = await fetch(url, Object.assign({headers: {'X-User': localStorage.getItem('csd_user') || 'system'}}, opts || {}));
    if (!r.ok) { let m = 'Server error ' + r.status; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
    const cd = r.headers.get('Content-Disposition') || ''; const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    return {blob: await r.blob(), name: m ? decodeURIComponent(m[1]) : url.split('/').pop()};
  }
  const getJson = async url => { const r = await fetch(url, {headers: {'X-User': localStorage.getItem('csd_user') || 'system'}}); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const b64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  async function att(f) { return {name: f.name, mime: f.blob.type || 'application/octet-stream', b64: await b64(f.blob)}; }

  /* ---------- the actual send (through the Apps Script web app) ---------- */
  async function post(mail, payload) {
    if (!mail.url || !mail.key) throw new Error('E-mail is not set up yet (Admin → E-mail).');
    const r = await fetch(mail.url, {method: 'POST', body: JSON.stringify(Object.assign({key: mail.key}, payload))});
    const j = await r.json().catch(() => ({ok: false, error: 'No answer from the Google script'}));
    if (!j.ok) throw new Error('Google script: ' + (j.error || 'failed'));
    return j;
  }
  async function countToday() { try { return (await cloud().mailLog()).reduce((t, x) => t + (x.recipients || 0), 0); } catch (e) { return 0; } }
  async function send({key, s, to, subject, html, files}) {
    const {mail} = await settings();
    if (!to.length) return {skipped: 'no recipients'};
    const used = await countToday();
    if (used + to.length > LIMIT) { await cloud().logMail({key, site: s, subject, to: to.join(', '), recipients: 0, status: `NOT SENT – daily limit (${used} of ${LIMIT} used)`}); throw new Error(`Not sent: today's Gmail limit (${LIMIT} recipients) would be passed – ${used} used. Use a group address for big lists.`); }
    const attachments = []; for (const f of files || []) attachments.push(await att(f));
    const r = await post(mail, {action: 'send', to, subject, html: html + footer(), attachments, fromName: mail.from_name || 'CFS Stock Desk'});
    await cloud().logMail({key, site: s, subject, to: to.join(', '), recipients: to.length, files: (files || []).map(f => f.name).join(', '), status: 'sent'});
    if (used + to.length >= WARN) notifyAdmin(`${used + to.length} of ${LIMIT} e-mail recipients used today.`);
    return r;
  }
  const footer = () => `<p style="font:11px Calibri,Arial;color:#777;margin-top:16px">Sent by CFS Stock Desk · ${ist.stamp()} IST</p>`;
  function notifyAdmin(m) { if (cloud().profile && cloud().profile.role === 'admin' && typeof toast === 'function') toast(m, 6000); }

  /* ---------- building each e-mail ---------- */
  async function build(key, s, day, extra = {}) {
    const S = short(s), files = [], parts = [], grp = extra.group ? '&group=' + encodeURIComponent(extra.group) : '';
    const cfs = '&cfs=' + encodeURIComponent(s);
    let subject = '';
    if (SLOT_AT[key] || key === 'closing') {
      const slot = key;
      const ab = await getJson(`/api/report/abstract?slot=${slot}${cfs}`);
      files.push(await file(`/api/report?slot=${slot}${cfs}${grp}`));
      subject = ab.subject + (extra.group ? ` – ${extra.group}` : '');
      if (!extra.group) parts.push(abstractHtml(ab));
    }
    if (key === 'opening') {
      const o = await getJson(`/api/r15/osd?day=${day}${cfs}${grp}&format=json`);
      files.push(await file(`/api/r15/osd?day=${day}${cfs}${grp}`));
      parts.push(`<p style="font:bold 14px Calibri,Arial;margin:14px 0 4px">OSD: ${o.newCount} new line(s) yesterday · ${o.openCount} open</p>` + o.html.split('</table>')[0] + '</table>');
    }
    if (key === 'closing') {
      const rem = CSD.ioRemarks && CSD.ioRemarks.day === day ? CSD.ioRemarks.remarks : null;
      const io = await fetch(`/api/r15/inout?day=${day}${cfs}${grp}&format=json`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-User': 'system'}, body: JSON.stringify({remarks: rem})}).then(r => r.json());
      files.push(await file(`/api/r15/inout?day=${day}${cfs}${grp}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({remarks: rem})}));
      parts.unshift(io.html.split('</table>')[0] + '</table>');
      try { /* v17.1 daily reconciliation + who made the closing */
        const rc = await getJson(`/api/reconcile?day=${day}${cfs}`), f0 = v => Number(v || 0).toLocaleString('en-IN'), f3 = v => Number(v || 0).toLocaleString('en-IN', {minimumFractionDigits: 3, maximumFractionDigits: 3});
        const td = 'border:1px solid #bfbfbf;padding:3px 8px;font:12px Calibri,Arial;', row = (l, a, st = '') => `<tr><td style="${td}${st}">${l}</td><td style="${td}${st}text-align:right">${f0(a.pkgs)}</td><td style="${td}${st}text-align:right">${f3(a.cbm)}</td></tr>`;
        let h = `<p style="font:bold 13px Calibri,Arial;margin:12px 0 4px">Daily reconciliation</p>`;
        if (rc.opening) h += `<table style="border-collapse:collapse"><tr><th style="${td}background:#1F3864;color:#fff">Stock</th><th style="${td}background:#1F3864;color:#fff">Cartons</th><th style="${td}background:#1F3864;color:#fff">CBM</th></tr>` +
          row(`Opening (closing of ${dmy(rc.opening.date)})`, rc.opening) + row('+ In (offloaded today)', rc.in) + row('− Out (shipped out today)', rc.out) + row('= Expected closing', rc.expected, 'font-weight:bold;') + row('Closing', rc.closing, 'font-weight:bold;') +
          (rc.ok ? row('Difference', {pkgs: 0, cbm: 0}, 'color:#1F7A1F;') : row(`DIFFERENCE – to be explained (admin changes today: ${rc.admin_changes})`, rc.diff, 'color:#C00000;font-weight:bold;background:#FDE9E9;')) + '</table>';
        else h += `<p style="font:12px Calibri,Arial;color:#777">${rc.note || ''}</p>`;
        h += `<p style="font:11px Calibri,Arial;color:#555">Closing made by ${rc.made_by || (cloud().profile && cloud().profile.user_id) || 'the app automatically'}${rc.made_at ? ', ' + String(rc.made_at).slice(0, 16) + ' IST' : ''}.</p>`;
        parts.splice(1, 0, h);
        if (!rc.ok && rc.opening) subject = (subject || '') + ' – RECONCILIATION DIFFERENCE';
      } catch (e) { console.warn('reconcile', e); }
      if (!extra.group) {
        try { files.push(await file(`/api/stuffing-report?date=${day}`)); } catch (e) { /* no container stuffed today */ }
        const ag = await getJson(`/api/r15/ageing?day=${day}${cfs}&format=json`);
        if (ag.red && ag.red.length) parts.push(CSD.r15.toHtml(CSD.r15.redListSheet(ag.red, day)));
        parts.push(`<p style="font:12px Calibri,Arial">Cargo over 15 days in CFS: <b>${ag.over15}</b> row(s).</p>`);
      }
    }
    if (key === 'weekly') {
      const [a, b] = CSD.periods.lastWeek();
      files.push(await file(`/api/r15/ageing?day=${day}${cfs}`), await file(`/api/r15/ev?from=${a}&to=${b}${cfs}`), await file(`/api/r15/turnaround?from=${a}&to=${b}${cfs}`));
      const ev = await getJson(`/api/r15/ev?from=${a}&to=${b}${cfs}&format=json`), tr = await getJson(`/api/r15/turnaround?from=${a}&to=${b}${cfs}&format=json`);
      subject = `APLL ${s} – weekly reports (ageing, EV tag, truck turnaround) ${dmy(a)} to ${dmy(b)}`;
      parts.push(ev.html.split('</table>')[0] + '</table>', tr.html.split('</table>')[0] + '</table>');
    }
    if (key === 'ev_monthly') {
      const [a, b] = CSD.periods.lastMonth();
      files.push(await file(`/api/r15/ev?from=${a}&to=${b}${cfs}`));
      const ev = await getJson(`/api/r15/ev?from=${a}&to=${b}${cfs}&format=json`);
      subject = `APLL ${s} – EV tag report ${dmy(a)} to ${dmy(b)}`; parts.push(ev.html.split('</table>')[0] + '</table>');
    }
    if (key === 'admin') {
      files.push(await file(`/api/r15/admin?day=${day}`));
      const ad = await getJson(`/api/r15/admin?day=${day}&format=json`);
      subject = `CFS Stock Desk – admin changes ${dmy(day)}`; parts.push(ad.html);
    }
    return {subject: subject || `APLL ${S} ${key}`, html: parts.join(''), files};
  }
  function abstractHtml(ab) {
    const td = 'border:1px solid #bfbfbf;padding:3px 6px;font:12px Calibri,Arial,sans-serif;', f = (v, d = 0) => Number(v || 0).toLocaleString('en-IN', {minimumFractionDigits: d, maximumFractionDigits: d});
    return `<p style="font:bold 14px Calibri,Arial;color:#1F3864;margin:0 0 4px">${ab.title || ''}</p><table style="border-collapse:collapse"><tr>${['Customer', 'No. of POs', 'Total Pkgs', 'Item Qty', 'CBM', 'Gross (kg)'].map(h => `<th style="${td}background:#1F3864;color:#fff">${h}</th>`).join('')}</tr>` +
      (ab.rows || []).map(r => `<tr><td style="${td}">${r.customer}</td><td style="${td}text-align:right">${f(r.pos)}</td><td style="${td}text-align:right">${f(r.pkgs)}</td><td style="${td}text-align:right">${f(r.qty)}</td><td style="${td}text-align:right">${f(r.cbm, 3)}</td><td style="${td}text-align:right">${f(r.gross, 2)}</td></tr>`).join('') +
      (ab.total ? `<tr><td style="${td}font-weight:bold;background:#E7E6E6">TOTAL</td><td style="${td}text-align:right;font-weight:bold;background:#E7E6E6">${f(ab.total.pos)}</td><td style="${td}text-align:right;font-weight:bold;background:#E7E6E6">${f(ab.total.pkgs)}</td><td style="${td}text-align:right;font-weight:bold;background:#E7E6E6">${f(ab.total.qty)}</td><td style="${td}text-align:right;font-weight:bold;background:#E7E6E6">${f(ab.total.cbm, 3)}</td><td style="${td}text-align:right;font-weight:bold;background:#E7E6E6">${f(ab.total.gross, 2)}</td></tr>` : '') + '</table>';
  }

  /* one scheduled e-mail: claim → build → send (main list, then each customer's filtered copy) */
  async function runKey(key, day, opts = {}) {
    const s = key === 'admin' ? 'ALL' : site(); if (!s) throw new Error('Choose a site first.');
    const {rec} = await settings();
    const to = listFor(rec, key, s);
    const custs = CUSTOMER_COPY.includes(key) ? customerLists(rec, s) : {};
    if (!to.length && !Object.keys(custs).length) return {skipped: 'no recipients'};
    const id = `${code(s)}_${day}_${key}`;
    if (!opts.force && !(await cloud().claimMail(id, {site: s, key}))) return {skipped: 'already sent'};
    try {
      if (to.length) { const m = await build(key, s, day); await send({key, s, to, subject: m.subject, html: m.html, files: m.files}); }
      for (const [g, l] of Object.entries(custs)) { const m = await build(key, s, day, {group: g}); await send({key: key + ':' + g, s, to: l, subject: m.subject, html: m.html, files: m.files}); }
      await cloud().finishMail(id, 'sent', {by: cloud().profile.user_id});
      return {ok: true};
    } catch (e) { await cloud().finishMail(id, 'failed', {error: String(e.message || e)}).catch(() => {}); throw e; }
  }

  /* ---------- the clock (every minute while this PC is open and online) ---------- */
  let busy = false;
  async function tick() {
    const c = cloud(); if (busy || !c || !c.enabled || !c.profile || !c.online() || c.profile.role === 'management') return;
    const {mail} = await settings(); if (!mail.url || !mail.key || mail.enabled === false) return;
    busy = true;
    try {
      const day = ist.date(), hm = ist.time(), dow = ist.dow();
      const due = [];
      if (site()) {
        for (const [k, at] of Object.entries(SLOT_AT)) if (hm >= at) due.push(k);
        if (hm >= (mail.closing_backup || '20:00')) due.push('closing');
        if (dow === 1 && hm >= '10:05') due.push('weekly');
        if (day.slice(8) === '01' && hm >= '10:10') due.push('ev_monthly');
      }
      if (c.profile.role === 'admin' && hm >= (mail.closing_backup || '20:00')) due.push('admin');
      for (const k of due) {
        const s = k === 'admin' ? 'ALL' : site();
        const st = await c.mailState(`${code(s)}_${day}_${k}`); if (st && (st.status === 'sent' || st.status === 'sending')) continue;
        try { await runKey(k, day); } catch (e) { console.warn('Scheduled e-mail failed', k, e); notifyAdmin(`E-mail "${k}" failed: ${e.message}`); }
      }
      await flushQueue();
    } finally { busy = false; }
  }

  /* ---------- at once: damage alert, stuffed container, cancelled container ---------- */
  async function queue(item) { const q = (await CSD.localStore.getSetting('mail_queue')) || []; q.push(item); await CSD.localStore.setSetting('mail_queue', q); }
  async function flushQueue() {
    const q = (await CSD.localStore.getSetting('mail_queue')) || []; if (!q.length || !cloud().online()) return;
    const left = [];
    for (const it of q) { try { await doInstant(it); } catch (e) { it.tries = (it.tries || 0) + 1; if (it.tries < 20) left.push(it); console.warn('Queued e-mail failed', e); } }
    await CSD.localStore.setSetting('mail_queue', left);
  }
  async function doInstant(it) {
    const {mail, rec} = await settings();
    if (it.type === 'damage') {
      const links = [];
      for (const p of it.photos || []) { if (p.link) { links.push(p); continue; }
        const r = await post(mail, {action: 'photo', name: p.name, mime: 'image/jpeg', b64: p.url.split(',')[1], folder: [short(it.site), it.day.slice(0, 7), 'PO ' + p.po]}); p.link = r.url; links.push(p); }
      if (links.length) await fetch('/api/damage-photos', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-User': 'system'}, body: JSON.stringify({ids: it.ids, links: links.map(p => ({po: p.po, style: p.style, url: p.link}))})});
      const to = listFor(rec, 'osd_alert', it.site); if (!to.length) return;
      const td = 'border:1px solid #bfbfbf;padding:3px 6px;font:12px Calibri,Arial;';
      const sealP = links.filter(p => p.po === 'SEAL'); if (sealP.length) fetch('/api/seal-photo', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-User': 'system'}, body: JSON.stringify({ids: it.ids, url: sealP[0].link})}).catch(() => {});
      const fp = (it.photos || []).filter(p => p.sha256);
      const html = `<p style="font:bold 15px Calibri,Arial;color:#C00000;margin:0 0 6px">${it.lines.length ? 'Damage found at offloading' : 'Seal BROKEN at truck arrival'} – truck ${it.truck}</p><p style="font:13px Calibri,Arial">${it.site} · ${it.customer} · ${it.vendor} · invoice ${it.invoice}</p>
        <p style="font:13px Calibri,Arial">Seal / truck condition: <b style="color:${it.seal === 'Intact' ? '#1F7A1F' : '#C00000'}">${it.seal || 'not recorded'}</b>${sealP.length ? ` · <a href="${sealP[0].link}">seal photo</a>` : ''}</p>
        <table style="border-collapse:collapse"><tr>${['PO', 'Style', 'Colour', 'Size', 'Carton no(s)', 'Cartons', 'Damage type', 'Remark', 'Photos'].map(h => `<th style="${td}background:#C00000;color:#fff">${h}</th>`).join('')}</tr>` +
        it.lines.map(l => `<tr><td style="${td}">${l.po}</td><td style="${td}">${l.style}</td><td style="${td}">${l.colour || ''}</td><td style="${td}">${l.size || ''}</td><td style="${td}">${l.cartons}</td><td style="${td}text-align:right">${l.count || ''}</td><td style="${td}">${l.type}</td><td style="${td}">${l.remark || ''}</td><td style="${td}">${links.filter(p => p.po === l.po && p.style === l.style).map((p, i) => `<a href="${p.link}">photo ${i + 1}</a>`).join(' ')}</td></tr>`).join('') + '</table>' +
        (fp.length ? `<p style="font:bold 12px Calibri,Arial;margin:10px 0 2px">Photo fingerprints (SHA-256 of the photo as taken in the app)</p><table style="border-collapse:collapse"><tr>${['Photo', 'Taken', 'By', 'Truck', 'SHA-256'].map(h => `<th style="${td}background:#595959;color:#fff">${h}</th>`).join('')}</tr>` +
          fp.map(p => `<tr><td style="${td}">${p.name}</td><td style="${td}">${p.at || ''}</td><td style="${td}">${p.user || ''}</td><td style="${td}">${p.truck || it.truck}</td><td style="${td}font-family:Consolas,monospace;font-size:11px">${p.sha256}</td></tr>`).join('') + '</table>' : '');
      const files = (it.photos || []).slice(0, 10).map(p => ({name: p.name, blob: dataBlob(p.url)}));
      await send({key: 'osd_alert', s: it.site, to, subject: it.lines.length ? `DAMAGE at offloading` + ` – ${short(it.site)} – truck ${it.truck} – ${it.customer} – ${it.invoice}${it.seal && it.seal !== 'Intact' ? ' – seal ' + it.seal : ''}` : `SEAL BROKEN – ${short(it.site)} – truck ${it.truck} – ${it.customer} – ${it.invoice}`, html, files});
    } else if (it.type === 'sealphoto') {
      const r = await post(mail, {action: 'photo', name: it.photo.name, mime: 'image/jpeg', b64: it.photo.url.split(',')[1], folder: [short(it.site), it.day.slice(0, 7), 'SEAL']});
      await fetch('/api/seal-photo', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-User': 'system'}, body: JSON.stringify({ids: it.ids, url: r.url})});
    } else if (it.type === 'stuffing') {
      const to = listFor(rec, 'stuffing', it.site); if (!to.length) return;
      const f = await file(`/api/stuffing-report?running=${it.running_no}`);
      await send({key: 'stuffing', s: it.site, to, subject: `APLL ${it.site} – container ${it.container} stuffed – running no ${it.running_no}`, html: `<p style="font:13px Calibri,Arial">Container <b>${it.container}</b> stuffed (running no ${it.running_no}). Stuffing report attached.</p>`, files: [f]});
    } else if (it.type === 'cancel') {
      const to = listFor(rec, 'stuffing', it.site); if (!to.length) return;
      const html = it.containers.map(c => `<p style="font:13px Calibri,Arial">Container <b>${c.container}</b> (running no ${c.running_no}): ${c.removed ? '<b>cancelled</b> – all cartons returned to stock' : 'some rows returned to stock'}:<br>${c.rows.map(r => `PO ${r.po} / ${r.style}: ${r.pkgs} ctn(s)`).join('<br>')}</p>`).join('');
      await send({key: 'stuffing', s: it.site, to, subject: `APLL ${it.site} – CANCELLED / returned to stock – ${it.containers.map(c => c.container).join(', ')}`, html: html + '<p style="font:13px Calibri,Arial">Please correct your stuffing record.</p>'});
    }
  }
  const dataBlob = url => { const [h, d] = url.split(','); const bin = atob(d), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], {type: (h.match(/data:([^;]+)/) || [])[1] || 'image/jpeg'}); };
  async function instant(it) {
    it.day = ist.date(); it.site = it.site || site();
    const {mail} = await settings();
    if (!mail.url || !mail.key) { await queue(it); return; }          // not set up yet: kept on this PC, sent once the admin sets up e-mail
    if (cloud().online()) { try { await doInstant(it); return; } catch (e) { await queue(it); throw e; } }
    await queue(it);
  }

  CSD.mailer = {
    ROUTES, CUSTOMER_COPY, LIMIT, WARN, countToday, post, settings,
    sendNow: (key, o = {}) => runKey(key, o.day || ist.date(), {force: true}),
    damageAlert: it => instant(Object.assign({type: 'damage'}, it)),
    sealPhoto: it => instant(Object.assign({type: 'sealphoto'}, it)),
    stuffing: it => instant(Object.assign({type: 'stuffing'}, it)),
    cancelled: it => instant(Object.assign({type: 'cancel'}, it)),
    closingMade: () => runKey('closing', ist.date()).catch(e => notifyAdmin('Closing e-mail: ' + e.message)),
    test: async to => { const {mail} = await settings(); return post(mail, {action: 'send', to: mails(to), subject: 'CFS Stock Desk – test e-mail', html: '<p>This is a test from CFS Stock Desk. E-mail sending works.</p>' + footer()}); },
    quota: async () => { const {mail} = await settings(); return post(mail, {action: 'quota'}); },
  };
  if (cloud() && cloud().enabled) setInterval(tick, 60000), setTimeout(tick, 15000);
})();
