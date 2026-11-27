/* Version 15 reports: daily inbound / outbound table (per site), OSD report, EV tag report, ageing, truck turnaround
   & labour, late cargo, admin changes. Each report is a list of sheets {name, head, rows, total?, widths, note}
   that becomes an Excel file (same red header style as the site's huddle sheet) and an HTML table for the e-mail body. */
(function (root) {
  'use strict';
  const CSD = root.CSD;
  const ist = CSD.ist;
  const U = v => String(v ?? '').trim().toUpperCase();
  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };
  const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dShort = iso => { const m = String(iso || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? `${m[3]}/${MON[+m[2] - 1]}` : ''; };
  const dLong = iso => { const m = String(iso || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? `${m[3]}-${MON[+m[2] - 1]}-${m[1]}` : String(iso || ''); };
  const cust = d => U(d.GroupName || d['Customer Name'] || 'NOT SET');
  const day0 = s => String(s || '').slice(0, 10);
  /* when the cargo entered stock: Offloaded At (v15), else offloading date, else entry date */
  const inDate = d => day0(d['Offloaded At']) || d['Offloading Date'] || d['Entry Date'] || '';
  const outDate = s => day0(s.removed_at);
  const mins = (a, b) => { const t = x => { const m = String(x || '').match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null; }; const x = t(a), y = t(b); return x === null || y === null ? null : Math.round(y - x); };
  const daysBetween = (a, b) => { const t = x => { const m = String(x || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; }; const x = t(a), y = t(b); return x === null || y === null ? null : Math.round(y - x); };
  const hm = m => m === null || m === undefined ? '' : `${Math.floor(m / 60)}:${String(Math.abs(m % 60)).padStart(2, '0')}`;
  const truckKey = s => s.batch_id ?? ('r' + s.id);

  /* ======================================================================================
     1. Daily inbound / outbound table (like the site's huddle sheet)
     ====================================================================================== */
  function inout({stock, stuffings, day, site}) {
    const mine = stock.filter(s => !site || U(s.data['Warehouse ID']) === U(site) || !s.data['Warehouse ID']);
    const live = mine.filter(s => s.status === 'in' || s.status === 'out');
    const m = new Map(), get = c => { if (!m.has(c)) m.set(c, {customer: c, opening: 0, inTrucks: new Set(), inCbm: 0, offTrucks: new Set(), pendTrucks: new Set(), pendCbm: 0, containers: new Set(), outCbm: 0, osd: 0, units: {}}); return m.get(c); };
    for (const s of live) {
      const d = s.data, c = cust(d), cbm = num(d['Total CBM']), id = inDate(d), od = s.status === 'out' ? outDate(s) : '';
      const wasIn = (!id || id < day) && (s.status === 'in' || (od && od >= day));
      if (wasIn) get(c).opening += cbm;
      if (id === day) { const g = get(c); g.inCbm += cbm; g.offTrucks.add(truckKey(s)); if (U(d.OSD) === 'YES') g.osd += num(d['Total OSD cartons']); }
      if (s.status === 'out' && od === day) { const g = get(c); g.outCbm += cbm; if (d['Container No']) g.containers.add(d['Container No']); }
    }
    /* trucks that arrived on the day (saved), and trucks waiting now */
    for (const s of mine) {
      const d = s.data, c = cust(d);
      if (day0(d['Truck Arrival']) === day || (!d['Truck Arrival'] && d['Allow Date'] === day && s.status !== 'out')) get(c).inTrucks.add(truckKey(s));
      if (s.status === 'pending') { const g = get(c); g.pendTrucks.add(truckKey(s)); g.pendCbm += num(d['Total CBM']); }
    }
    /* stuffings of the day → "Stuffing 01 X 40HC" per customer */
    for (const st of stuffings || []) {
      if ((st.header || {}).date !== day || (site && st.site && U(st.site) !== U(site))) continue;
      const unit = String(st.header.unit || '').replace(/\s+/g, '').toUpperCase() || 'CNTR';
      for (const c of new Set(st.rows.map(cust))) { const g = get(c); g.units[unit] = (g.units[unit] || 0) + 1; }
    }
    const rows = [...m.values()].filter(g => g.opening || g.inCbm || g.pendCbm || g.outCbm || g.inTrucks.size || g.pendTrucks.size).sort((a, b) => a.customer.localeCompare(b.customer)).map(g => {
      const rem = [];
      const st = Object.entries(g.units).map(([u, n]) => `${String(n).padStart(2, '0')} X ${u}`); if (st.length) rem.push(`${dShort(day)}: Stuffing ${st.join(', ')}`);
      if (g.pendTrucks.size) rem.push(`${g.pendTrucks.size} truck(s) waiting to offload`);
      if (g.osd) rem.push(`OSD: ${g.osd} ctn(s)`);
      return {customer: g.customer, opening: r2(g.opening), inTrucks: g.inTrucks.size, inCbm: r2(g.inCbm), totalIn: r2(g.opening + g.inCbm), offloaded: g.offTrucks.size,
        pendTrucks: g.pendTrucks.size, pendCbm: r2(g.pendCbm), outContainers: g.containers.size, outCbm: r2(g.outCbm), end: r2(g.opening + g.inCbm - g.outCbm), remarks: rem.join('; ')};
    });
    const T = k => r2(rows.reduce((t, r) => t + (r[k] || 0), 0));
    const total = {customer: 'TOTAL', opening: T('opening'), inTrucks: T('inTrucks'), inCbm: T('inCbm'), totalIn: T('totalIn'), offloaded: T('offloaded'), pendTrucks: T('pendTrucks'), pendCbm: T('pendCbm'), outContainers: T('outContainers'), outCbm: T('outCbm'), end: T('end'), remarks: ''};
    return {day, site, rows, total};
  }
  const INOUT_HEAD = ['CARGO IN CFS', 'CBM', 'Inbound Trucks', 'Inbound ( Cbm )', 'Total Inbound Cbm', 'Inbound Status (offloading)', 'Pending Trucks (Offloading)', 'Pending Trucks / Cbm', 'Outbound Status (Stuffed)', 'Outbound ( cbm)', 'End Day inventory', 'Remarks'];
  const inoutRow = r => [r.customer, r.opening, r.inTrucks, r.inCbm, r.totalIn, r.offloaded, r.pendTrucks, r.pendCbm, r.outContainers, r.outCbm, r.end, r.remarks];
  function inoutSheets(io, late) {
    const sh = [{name: 'Inbound & outbound', title: `${io.site || 'CFS'} – ${dLong(io.day)}`, head: INOUT_HEAD, rows: io.rows.map(inoutRow), total: inoutRow(io.total), red: true,
      widths: [24, 10, 9, 10, 11, 11, 11, 11, 11, 10, 11, 42], num: [1, 3, 4, 7, 9, 10], int: [2, 5, 6, 8],
      note: 'CBM = stock at the start of the day · Inbound = trucks that arrived; Inbound ( Cbm ) = cargo offloaded into stock · Pending = waiting to offload now · End Day inventory = CBM + Inbound − Outbound.'}];
    if (late) sh.push(late);
    return sh;
  }

  /* ======================================================================================
     2. OSD report: received yesterday + all open OSD (summary / detail / damage lines)
     ====================================================================================== */
  function osd({stock, day, site}) {
    const yest = ist.addDays(day, -1);
    const mine = stock.filter(s => (s.status === 'in' || (s.status === 'out' && inDate(s.data) === yest)) && (!site || U(s.data['Warehouse ID']) === U(site)) && U(s.data.OSD) === 'YES');
    const newRows = mine.filter(s => inDate(s.data) === yest), open = mine.filter(s => s.status === 'in');
    const sum = new Map();
    for (const s of open) { const d = s.data, c = cust(d), g = sum.get(c) || {c, ship: new Set(), short: 0, excess: 0, dmg: 0, newShip: new Set()}; sum.set(c, g);
      g.ship.add(d['Shipper invoice number'] + '|' + d['PO Number']); if (inDate(d) === yest) g.newShip.add(d['Shipper invoice number'] + '|' + d['PO Number']);
      const tp = num(d['Total Packages']), rc = num(d['Received Pkgs']) || tp; if (rc < tp) g.short += tp - rc; if (rc > tp) g.excess += rc - tp; g.dmg += (d.Damage || []).reduce((n, l) => n + (l.count || 0), 0); }
    const detail = s => { const d = s.data, tp = num(d['Total Packages']), rc = num(d['Received Pkgs']) || tp;
      return [inDate(d) === yest ? 'NEW' : '', cust(d), d['Truck Plate Number'] || '', d['Shipper invoice number'] || '', d['PO Number'] || '', d.Style || '', d.Colour || '', tp, rc, d['OSD type'] || '', num(d['Total OSD cartons']) || '', d['OSD Remarks'] || '', d['Seal Condition'] || '', inDate(d), daysBetween(inDate(d), day) ?? '', d['Warehouse Bay number'] || '', photoLinks(d)]; };
    const lines = []; for (const s of open) for (const l of s.data.Damage || []) lines.push([cust(s.data), s.data['Truck Plate Number'] || '', s.data['Shipper invoice number'] || '', l.po, l.style, l.colour || '', l.size || '', l.cartons, l.count || '', l.type, l.remark || '', inDate(s.data), (l.photos || []).join(' ')]);
    const summary = [...sum.values()].sort((a, b) => a.c.localeCompare(b.c)).map(g => [g.c, g.newShip.size, g.ship.size, g.short, g.excess, g.dmg]);
    const T = i => summary.reduce((t, r) => t + r[i], 0);
    return {day, yest, newCount: newRows.length, openCount: open.length, sheets: [
      {name: 'Summary', title: `OSD – ${site || ''} – received ${dLong(yest)} and all open`, head: ['Customer', 'New OSD (yesterday)', 'Open OSD (PO lines)', 'Cartons short', 'Cartons excess', 'Cartons damaged'], rows: summary, total: ['TOTAL', T(1), T(2), T(3), T(4), T(5)], widths: [26, 14, 14, 12, 12, 13], int: [1, 2, 3, 4, 5]},
      {name: 'Detail', head: ['New', 'Customer', 'Truck', 'Invoice', 'PO', 'Style', 'Colour', 'Booked ctns', 'Received ctns', 'OSD type', 'OSD ctns', 'OSD remarks', 'Seal', 'In stock since', 'Days in CFS', 'Bay', 'Photos'], rows: open.sort((a, b) => inDate(b.data).localeCompare(inDate(a.data))).map(detail),
        widths: [6, 20, 13, 18, 13, 11, 10, 9, 9, 16, 8, 50, 11, 12, 8, 7, 40], int: [7, 8, 10, 14]},
      {name: 'Damage lines', head: ['Customer', 'Truck', 'Invoice', 'PO', 'Style', 'Colour', 'Size', 'Carton no(s)', 'Cartons', 'Damage type', 'Remark', 'In stock since', 'Photos'], rows: lines, widths: [20, 13, 18, 13, 11, 10, 7, 18, 8, 26, 26, 12, 40], int: [8]}]};
  }
  const photoLinks = d => (d.Damage || []).flatMap(l => l.photos || []).concat(d.Photos ? String(d.Photos).split(/\s+/) : []).filter(Boolean).join(' ');

  /* ======================================================================================
     3. EV tag report (stuffing only): containers per customer moved by EV / Diesel / CNG
     ====================================================================================== */
  function ev({stuffings, from, to, site, evCustomers}) {
    const want = Object.keys(evCustomers || {}).map(U);
    const list = (stuffings || []).filter(s => (s.header || {}).date >= from && s.header.date <= to && (!site || !s.site || U(s.site) === U(site)));
    const per = new Map(), det = [];
    for (const s of list) {
      const h = s.header, type = h.truck_type || (s.rows[0] || {})['Stuffing Truck Type'] || 'Not recorded';
      for (const c of new Set(s.rows.map(cust))) {
        if (want.length && !want.includes(c)) continue;
        const g = per.get(c) || {c, n: 0, ev: 0}; per.set(c, g); g.n++; if (U(type) === 'EV') g.ev++;
        det.push([c, dLong(h.date), h.container, s.running_no, h.unit || '', h.truck_no || '', type, h.transporter || '', s.rows.filter(r => cust(r) === c).reduce((t, r) => t + num(r['Stuffed Pkgs'] || r['Received Pkgs']), 0)]);
      }
    }
    const rows = [...per.values()].sort((a, b) => a.c.localeCompare(b.c)).map(g => { const t = (evCustomers || {})[g.c]; const pct = g.n ? Math.round(g.ev / g.n * 1000) / 10 : 0;
      return [g.c, g.n, g.ev, pct / 100, t ? t / 100 : '', t ? (pct < t ? 'BELOW TARGET' : 'OK') : '']; });
    const n = rows.reduce((t, r) => t + r[1], 0), e = rows.reduce((t, r) => t + r[2], 0);
    return {from, to, sheets: [
      {name: 'EV summary', title: `EV tag report – ${site || ''} – ${dLong(from)} to ${dLong(to)}`, head: ['Customer', 'Containers stuffed', 'Moved by EV', '% EV', 'Target %', 'Status'], rows, total: ['TOTAL', n, e, n ? e / n : 0, '', ''], widths: [26, 14, 12, 9, 9, 14], int: [1, 2], pct: [3, 4], flag: 5},
      {name: 'Containers', head: ['Customer', 'Stuffing date', 'Container no', 'Running no', 'Unit', 'Truck / trailer no', 'Truck type', 'Transporter', 'Cartons'], rows: det.sort((a, b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1]))), widths: [24, 13, 15, 10, 8, 16, 11, 22, 9], int: [3, 8]}]};
  }

  /* ======================================================================================
     4. Ageing / slow-moving (bands from the Offloaded date) + red list (crossed 15 days)
     ====================================================================================== */
  const BANDS = [['0–7 days', 0, 7], ['8–15 days', 8, 15], ['16–30 days', 16, 30], ['over 30 days', 31, 1e9]];
  function ageing({stock, day, site}) {
    const rows = stock.filter(s => s.status === 'in' && (!site || U(s.data['Warehouse ID']) === U(site))).map(s => ({s, d: s.data, age: daysBetween(inDate(s.data), day) ?? 0}));
    const per = new Map();
    for (const x of rows) { const c = cust(x.d), g = per.get(c) || {c, b: BANDS.map(() => ({po: new Set(), ctn: 0, cbm: 0})), oldest: null}; per.set(c, g);
      const k = BANDS.findIndex(([, a, b]) => x.age >= a && x.age <= b); const B = g.b[k]; B.po.add(x.d['PO Number']); B.ctn += num(x.d['Received Pkgs'] || x.d['Total Packages']); B.cbm += num(x.d['Total CBM']);
      if (!g.oldest || x.age > g.oldest.age) g.oldest = x; }
    const sum = [...per.values()].sort((a, b) => a.c.localeCompare(b.c)).map(g => [g.c, ...g.b.flatMap(B => [B.po.size, B.ctn, r3(B.cbm)]), g.oldest ? `${g.oldest.d['PO Number']} (${g.oldest.age} d)` : '']);
    const tot = ['TOTAL']; for (let i = 1; i <= 12; i++) tot.push(i % 3 === 0 ? r3(sum.reduce((t, r) => t + r[i], 0)) : sum.reduce((t, r) => t + r[i], 0)); tot.push('');
    const det = rows.sort((a, b) => b.age - a.age).map(x => [x.age, x.age > 30 ? 'over 30' : x.age > 15 ? '16–30' : x.age > 7 ? '8–15' : '0–7', cust(x.d), x.d['Shipper invoice number'] || '', x.d['PO Number'] || '', x.d.Style || '', num(x.d['Received Pkgs'] || x.d['Total Packages']), r3(num(x.d['Total CBM'])), inDate(x.d), x.d['Warehouse Bay number'] || '', x.d.PLAN ? 'Planned (' + x.d.PLAN + ')' : '', x.d['SHIP CXL'] || '']);
    const red = rows.filter(x => x.age === 16).map(x => [cust(x.d), x.d['PO Number'] || '', x.d.Style || '', num(x.d['Received Pkgs'] || x.d['Total Packages']), r3(num(x.d['Total CBM'])), inDate(x.d), x.d.PLAN ? 'Planned' : 'Not planned']);
    const head = ['Customer']; for (const [b] of BANDS) head.push(`${b} – POs`, `${b} – ctns`, `${b} – CBM`); head.push('Oldest PO');
    return {day, red, over15: rows.filter(x => x.age > 15).length, sheets: [
      {name: 'Ageing summary', title: `Ageing – ${site || ''} – as on ${dLong(day)}`, head, rows: sum, total: tot, widths: [24, ...Array(12).fill(9), 22], int: [1, 2, 4, 5, 7, 8, 10, 11], num: [3, 6, 9, 12], wrapHead: true},
      {name: 'Detail', head: ['Days in CFS', 'Band', 'Customer', 'Invoice', 'PO', 'Style', 'Cartons', 'CBM', 'In stock since', 'Bay', 'Plan', 'SHIP CXL'], rows: det, widths: [9, 9, 22, 18, 13, 11, 9, 9, 12, 7, 14, 11], int: [0, 6], num: [7], redIf: r => r[0] > 15}]};
  }
  const redListSheet = (red, day) => ({name: 'Over 15 days (new)', title: `Cargo that crossed 15 days in CFS today – ${dLong(day)}`, head: ['Customer', 'PO', 'Style', 'Cartons', 'CBM', 'In stock since', 'Plan'], rows: red, widths: [24, 13, 11, 9, 9, 12, 12], int: [3], num: [4]});

  /* ======================================================================================
     5. Truck turnaround & labour (weekly)
     ====================================================================================== */
  function turnaround({stock, from, to, site, limitH = 4}) {
    const g = new Map();
    for (const s of stock) { const d = s.data; const od = day0(d['Offloaded At']); if (!od || od < from || od > to || (site && U(d['Warehouse ID']) !== U(site))) continue;
      const k = truckKey(s); if (!g.has(k)) g.set(k, []); g.get(k).push(s); }
    const trucks = [...g.values()].map(rs => { const d = rs[0].data, start = d['Offloading Date'] && d['Offloading Start Time'] ? `${d['Offloading Date']} ${d['Offloading Start Time']}` : '';
      const wait = mins(d['Truck Arrival'], start), off = mins(start, String(d['Offloaded At']).slice(0, 16)), total = mins(d['Truck Arrival'], String(d['Offloaded At']).slice(0, 16));
      const ctn = rs.reduce((t, s) => t + num(s.data['Received Pkgs'] || s.data['Total Packages']), 0), cbm = rs.reduce((t, s) => t + num(s.data['Total CBM']), 0), lab = num(d['No of Labour']);
      return {customer: cust(d), truck: d['Truck Plate Number'] || '', day: day0(d['Offloaded At']), arrived: d['Truck Arrival'] || '', start, end: String(d['Offloaded At']).slice(0, 16), wait, off, total, ctn, cbm: r3(cbm), lab, perLab: lab ? Math.round(ctn / lab) : '', cbmLab: lab ? r2(cbm / lab) : ''}; });
    const per = new Map(); for (const t of trucks) { const x = per.get(t.customer) || {c: t.customer, n: 0, w: [], o: [], tot: [], ctn: 0, cbm: 0, lab: 0}; per.set(t.customer, x);
      x.n++; if (t.wait !== null) x.w.push(t.wait); if (t.off !== null) x.o.push(t.off); if (t.total !== null) x.tot.push(t.total); x.ctn += t.ctn; x.cbm += t.cbm; x.lab += t.lab; }
    const avg = a => a.length ? Math.round(a.reduce((t, v) => t + v, 0) / a.length) : null, max = a => a.length ? Math.max(...a) : null;
    const rows = [...per.values()].sort((a, b) => a.c.localeCompare(b.c)).map(x => [x.c, x.n, hm(avg(x.w)), hm(max(x.w)), hm(avg(x.o)), hm(max(x.o)), x.ctn, r3(x.cbm), x.lab ? Math.round(x.ctn / x.lab) : '', x.lab ? r2(x.cbm / x.lab) : '']);
    const all = {n: trucks.length, w: trucks.map(t => t.wait).filter(v => v !== null), o: trucks.map(t => t.off).filter(v => v !== null), ctn: trucks.reduce((t, x) => t + x.ctn, 0), cbm: trucks.reduce((t, x) => t + x.cbm, 0), lab: trucks.reduce((t, x) => t + x.lab, 0)};
    const slow = trucks.filter(t => t.total !== null && t.total > limitH * 60).sort((a, b) => b.total - a.total);
    const tr = t => [t.customer, t.truck, t.arrived, t.start, t.end, hm(t.wait), hm(t.off), hm(t.total), t.ctn, t.cbm, t.lab || '', t.perLab];
    const TH = ['Customer', 'Truck', 'Arrived', 'Start offloading', 'Offloaded', 'Waiting (h:mm)', 'Offloading (h:mm)', 'Total (h:mm)', 'Cartons', 'CBM', 'Labour', 'Cartons per labourer'];
    return {from, to, slow: slow.length, sheets: [
      {name: 'Turnaround summary', title: `Truck turnaround & labour – ${site || ''} – ${dLong(from)} to ${dLong(to)}`, head: ['Customer', 'Trucks', 'Avg waiting', 'Longest waiting', 'Avg offloading', 'Longest offloading', 'Cartons', 'CBM', 'Cartons per labourer', 'CBM per labourer'], rows,
        total: ['ALL', all.n, hm(avg(all.w)), hm(max(all.w)), hm(avg(all.o)), hm(max(all.o)), all.ctn, r3(all.cbm), all.lab ? Math.round(all.ctn / all.lab) : '', all.lab ? r2(all.cbm / all.lab) : ''], widths: [24, 8, 11, 12, 12, 13, 9, 9, 12, 11], int: [1, 6, 8], num: [7, 9]},
      {name: `Over ${limitH} hours`, head: TH, rows: slow.map(tr), widths: [22, 13, 16, 16, 16, 10, 11, 10, 8, 8, 7, 11], int: [8, 10, 11], num: [9]},
      {name: 'All trucks', head: TH, rows: trucks.sort((a, b) => String(a.arrived).localeCompare(String(b.arrived))).map(tr), widths: [22, 13, 16, 16, 16, 10, 11, 10, 8, 8, 7, 11], int: [8, 10, 11], num: [9]}]};
  }

  /* ======================================================================================
     6. Late cargo (arrival after the cargo cut-off) and 7. admin changes
     ====================================================================================== */
  function late({stock, day, site}) {
    const g = new Map();
    for (const s of stock) { const d = s.data; if (U(d['Late Cargo']) !== 'YES' || (site && U(d['Warehouse ID']) !== U(site))) continue; if (day0(d['Truck Arrival'] || d['Allow Date']) !== day) continue;
      const k = truckKey(s); if (!g.has(k)) g.set(k, []); g.get(k).push(s); }
    const rows = [...g.values()].map(rs => { const d = rs[0].data, arr = d['Truck Arrival'] || `${d['Allow Date']} ${d['Allow Time'] || ''}`, cut = `${d['Cargo Cutoff Date'] || ''} ${d['Cargo Cutoff Time'] || ''}`.trim(), m = mins(cut, arr);
      return [cust(d), d['Vendor Name'] || '', d['Shipper invoice number'] || '', d['Truck Plate Number'] || '', [...new Set(rs.map(s => s.data['PO Number']))].join(', '), rs.reduce((t, s) => t + num(s.data['Total Packages']), 0), arr, cut, m === null ? '' : hm(m)]; });
    return {name: 'Late cargo', title: `Late cargo – arrived after the cargo cut-off – ${dLong(day)}`, head: ['Customer', 'Shipper', 'Invoice', 'Truck', 'POs', 'Cartons', 'Arrived', 'Cargo cut-off', 'Late by (h:mm)'], rows, widths: [22, 26, 18, 13, 24, 9, 16, 16, 11], int: [5]};
  }
  const ADMIN_ACTIONS = /^(pin_fail|pin_locked|stock_delete|alias_edit|alias_import|stuff_override|returned|repeat_invoice|admin_pin|user_|password_reset|moved_up|lists|cha_list|delete|deleted|edit|stock_edit)/;
  function adminChanges({audit, stock, day}) {
    const rows = (audit || []).filter(a => a.day === day || String(a.at).startsWith(day)).filter(a => ADMIN_ACTIONS.test(a.action) || /edit|delete|return|override|PIN|user/i.test(a.action + ' ' + a.detail))
      .sort((a, b) => String(a.at).localeCompare(String(b.at))).map(a => [String(a.at).slice(11, 16), a.user, a.site || '', a.action, a.detail]);
    const edits = (stock || []).filter(s => String(s.updated_at || '').startsWith(day) && /edit|returned/i.test(String(s.updated_by || ''))).map(s => [String(s.updated_at).slice(11, 16), s.updated_by, s.data['Warehouse ID'] || '', 'stock row changed', `${s.data['Shipper invoice number'] || ''} / PO ${s.data['PO Number'] || ''} / ${s.data.Style || ''}`]);
    return {sheets: [{name: 'Admin changes', title: `Admin changes – ${dLong(day)}`, head: ['Time', 'User', 'Site', 'Action', 'Detail'], rows: [...rows, ...edits].sort((a, b) => String(a[0]).localeCompare(String(b[0]))), widths: [7, 18, 22, 18, 90]}]};
  }

  /* ======================================================================================
     Excel + HTML
     ====================================================================================== */
  const RED = 'FFC00000', DARK = 'FF7F0000';
  async function toXlsx(sheets) {
    const wb = new root.ExcelJS.Workbook(); wb.creator = 'CFS Stock Desk';
    const thin = {style: 'thin', color: {argb: 'FFBFBFBF'}}, B = {top: thin, left: thin, bottom: thin, right: thin};
    for (const sh of sheets) {
      const ws = wb.addWorksheet(sh.name.slice(0, 31), {views: [{state: 'frozen', ySplit: sh.title ? 2 : 1, showGridLines: false}]});
      let r = 1;
      if (sh.title) { ws.mergeCells(1, 1, 1, sh.head.length); const c = ws.getCell(1, 1); c.value = sh.title; c.font = {name: 'Calibri', size: 13, bold: true, color: {argb: sh.red ? RED : 'FF1F3864'}}; ws.getRow(1).height = 22; r = 2; }
      const hr = ws.getRow(r); hr.height = sh.red || sh.wrapHead ? 60 : 30;
      sh.head.forEach((h, i) => { const c = hr.getCell(i + 1); c.value = h; c.font = {name: 'Calibri', bold: true, size: 10, color: {argb: 'FFFFFFFF'}}; c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: sh.red ? RED : 'FF1F3864'}};
        c.alignment = {horizontal: 'center', vertical: 'middle', wrapText: true, textRotation: sh.red && i > 0 && i < sh.head.length - 1 ? 90 : 0}; c.border = B; });
      const put = (vals, total) => { r++; const row = ws.getRow(r);
        vals.forEach((v, i) => { const c = row.getCell(i + 1); c.value = v === '' || v === null || v === undefined ? (total ? '' : null) : v; c.border = B;
          c.font = {name: 'Calibri', size: 10, bold: !!total, color: {argb: total && sh.red ? 'FFFFFFFF' : (sh.flag === i && v === 'BELOW TARGET') || (sh.redIf && !total && sh.redIf(vals) && i === 0) ? RED : 'FF000000'}};
          if (total && sh.red) c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: RED}}; else if (total) c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FFE7E6E6'}};
          if ((sh.num || []).includes(i) && typeof v === 'number') c.numFmt = '#,##0.00';
          if ((sh.int || []).includes(i) && typeof v === 'number') c.numFmt = '#,##0';
          if ((sh.pct || []).includes(i) && typeof v === 'number') c.numFmt = '0.0%';
          c.alignment = {vertical: 'top', wrapText: i === vals.length - 1 && String(v || '').length > 30, horizontal: typeof v === 'number' ? 'right' : 'left'}; }); };
      for (const v of sh.rows) put(v);
      if (!sh.rows.length) { r++; ws.getCell(r, 1).value = 'Nothing to report.'; ws.getCell(r, 1).font = {name: 'Calibri', italic: true, size: 10, color: {argb: 'FF7F7F7F'}}; }
      if (sh.total) put(sh.total, true);
      if (sh.note) { r += 2; ws.mergeCells(r, 1, r, sh.head.length); const c = ws.getCell(r, 1); c.value = sh.note; c.font = {name: 'Calibri', size: 9, italic: true, color: {argb: 'FF595959'}}; c.alignment = {wrapText: true}; ws.getRow(r).height = 28; }
      (sh.widths || []).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    }
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  const he = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  function fmtCell(sh, i, v) {
    if (typeof v !== 'number') return he(v);
    if ((sh.pct || []).includes(i)) return (v * 100).toFixed(1) + '%';
    if ((sh.num || []).includes(i)) return v.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    return v.toLocaleString('en-IN');
  }
  /* e-mail body table (inline styles – e-mail programs ignore style sheets) */
  function toHtml(sh, maxRows = 60) {
    const col = sh.red ? '#C00000' : '#1F3864', td = 'border:1px solid #bfbfbf;padding:3px 6px;font:12px Calibri,Arial,sans-serif;';
    const rows = sh.rows.slice(0, maxRows);
    return `${sh.title ? `<p style="font:bold 14px Calibri,Arial,sans-serif;color:${col};margin:12px 0 4px">${he(sh.title)}</p>` : ''}<table style="border-collapse:collapse">` +
      `<tr>${sh.head.map(h => `<th style="${td}background:${col};color:#fff;font-weight:bold;text-align:center">${he(h)}</th>`).join('')}</tr>` +
      rows.map(r => `<tr>${r.map((v, i) => `<td style="${td}${typeof v === 'number' ? 'text-align:right;' : ''}">${fmtCell(sh, i, v)}</td>`).join('')}</tr>`).join('') +
      (sh.rows.length > maxRows ? `<tr><td colspan="${sh.head.length}" style="${td}font-style:italic">… ${sh.rows.length - maxRows} more rows in the attached Excel</td></tr>` : '') +
      (!sh.rows.length ? `<tr><td colspan="${sh.head.length}" style="${td}font-style:italic;color:#777">Nothing to report.</td></tr>` : '') +
      (sh.total ? `<tr>${sh.total.map((v, i) => `<td style="${td}font-weight:bold;${sh.red ? 'background:#C00000;color:#fff;' : 'background:#E7E6E6;'}${typeof v === 'number' ? 'text-align:right;' : ''}">${fmtCell(sh, i, v)}</td>`).join('')}</tr>` : '') + '</table>';
  }
  root.CSD.r15 = {inout, inoutSheets, osd, ev, ageing, redListSheet, turnaround, late, adminChanges, toXlsx, toHtml, dLong, dShort, BANDS, inDate};
})(typeof self !== 'undefined' ? self : globalThis);
