/* Checks run on every row before it goes into stock and whenever stock is edited (same as the desktop version). */
(function (root) {
  const F = root.CSD.F;
  const PLATE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$|^\d{2}BH\d{4}[A-Z]{1,2}$/;     // v17.1: BH series (24BH1234AA) too
  const plateNorm = v => String(v ?? '').toUpperCase().replace(/[\s\-.]/g, '');
  const emptyV = v => v === null || v === undefined || v === '';
  function d(s) { const m = String(s || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return null;
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return dt.getUTCMonth() === +m[2] - 1 ? dt.getTime() : null; }
  function t(s) { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; }
  /* look-alike characters that the automatic reading mixes up count as the same: I/L=1, O/D/Q=0, S=5, B=8, Z=2, G=6;
     spaces, dashes, dots and slashes are ignored – so "1297070" and "I297070" are the same style */
  const LOOK = {I: '1', L: '1', O: '0', D: '0', Q: '0', S: '5', B: '8', Z: '2', G: '6'};
  const keyNorm = v => String(v ?? '').toUpperCase().replace(/[\s\-./\\_]/g, '').replace(/[ILODQSBZG]/g, c => LOOK[c]);
  /* v17.1: invoice numbers – also leading zeros of each number part ignored: BD0002100170 = BD2100170, INV-001 = INV/001 = INV001 = INV1 */
  const invNorm = v => keyNorm(String(v ?? '').toUpperCase().replace(/[\s\-./\\_]/g, '').replace(/O(?=\d)|(?<=\d)O/g, '0').replace(/(^|[^0-9])0+(?=\d)/g, '$1'));
  const rowKey = r => [invNorm(r['Shipper invoice number']), keyNorm(r['PO Number']), keyNorm(r.Style)].join('\u0001');
  const keyComplete = r => ['Shipper invoice number', 'PO Number', 'Style'].every(f => !emptyV(r[f]));
  /* notNeeded: columns this row's shipper does not need (set once per shipper) */
  function validateRow(r, others, notNeeded, stage) {
    const out = []; const add = (f, msg, level = 'warn') => out.push({field: f, msg, level});
    const skip = new Set(notNeeded || []);
    for (const f of F.requiredFor(r['Warehouse ID'], stage)) if (!skip.has(f) && emptyV(r[f])) add(f, 'Required', 'error');
    for (const f of F.NUMERIC) {
      const v = r[f]; if (emptyV(v)) continue;
      const x = typeof v === 'number' ? v : Number(String(v).trim());
      if (isNaN(x)) { add(f, 'Must be a number', 'error'); continue; }
      if (['Total Packages', 'Total CBM', 'Gross weight (kg)', 'Item Qty (pcs)'].includes(f) && x <= 0) add(f, 'Cannot be zero', 'error');
    }
    const p = +r['Total Packages'] || 0, cbm = +r['Total CBM'] || 0, gw = +r['Gross weight (kg)'] || 0;
    if (p && cbm && !(cbm / p >= 0.005 && cbm / p <= 0.4)) add('Total CBM', `CBM per carton ${(cbm / p).toFixed(3)} looks wrong`);
    else if (p && cbm && F.CBM_PER_CTN) {      // v17.1: normal range of the commodity (from the ST JOHN carting sheet)
      const c = String(r['Cargo Description'] || '').toUpperCase().replace(/[^A-Z]/g, ''), rg = F.CBM_PER_CTN[c === 'GARM' ? 'GARMENTS' : c];
      if (rg && !(cbm / p >= rg[0] && cbm / p <= rg[1])) add('Total CBM', `CBM per carton ${(cbm / p).toFixed(3)} is unusual for ${c} (normally ${rg[0]}–${rg[1]}) – check the packing list`);
    }
    if (p && gw && !(gw / p >= 0.2 && gw / p <= 60)) add('Gross weight (kg)', `Weight per carton ${(gw / p).toFixed(1)} kg looks wrong`);
    const nw = +r['Net weight (kg)'] || 0;
    if (gw && nw && nw === gw) add('Net weight (kg)', `Nett weight is the same as the gross weight (${gw}) – nett is always less (cartons, hangers): please check the packing list`, 'error');
    if (gw && nw && nw > gw) { add('Gross weight (kg)', `Gross weight (${gw}) is less than the nett weight (${nw}) – please correct`, 'error'); add('Net weight (kg)', 'More than the gross weight – please correct', 'error'); }
    /* received cartons different from the booked cartons = OSD (overage / shortage) */
    const rc = r['Received Pkgs'];
    if (rc !== '' && rc !== null && rc !== undefined && p && +rc !== p) {
      if (String(r.OSD || '').toUpperCase() === 'NO') add('OSD', `Received ${rc} of ${p} booked cartons – this is OSD: choose Yes`, 'error');
      else add('Received Pkgs', `${+rc < p ? 'Shortage' : 'Overage'} of ${Math.abs(p - +rc)} carton(s)`);
    }
    for (const f of F.DATES) if (r[f] && d(r[f]) === null) add(f, 'Use a date', 'error');
    for (const f of F.TIMES) if (r[f] && t(r[f]) === null) add(f, 'Use HH:MM', 'error');
    const sb = d(r['Shipping Bill date']), leo = d(r['SB LEO DATE']);
    if (sb !== null && leo !== null && leo < sb) add('SB LEO DATE', 'LEO date is before the Shipping Bill date', 'error');
    const st = t(r['Offloading Start Time']), en = t(r['Offloading END Time']);
    if (st !== null && en !== null && en < st && r['Offloading Date']) add('Offloading END Time', 'Ends before it starts');
    const plates = plateNorm(r['Truck Plate Number']);
    if (plates) for (const pl of plates.split('/')) if (!PLATE.test(pl)) add('Truck Plate Number', `"${pl}" is not a valid Indian vehicle number`, 'error');
    for (const [f, opts] of Object.entries(F.SELECTS)) if (r[f] && !opts.includes(r[f])) add(f, 'Choose from the list', 'error');
    if (keyComplete(r) && others && others.has(rowKey(r))) add('Style', 'Same invoice + PO + style is already in stock (look-alikes such as 1/I, 0/O, 5/S count as the same)', 'error');
    return out;
  }
  /* v16.1: Type as printed on the documents (CRTNS, CTNS, PIECES …) -> the list's word; CARTONS when nothing is given */
  function qtyType(x) {
    const s = String(x ?? '').trim().toUpperCase().replace(/[.\s]/g, '');
    if (!s) return s;
    if (/^(CRTNS?|CTNS?|CARTONS?|CARTOONS?|CRTS?|CTN\(S\))$/.test(s)) return 'CARTONS';
    if (/^(PCS?|PIECES?|NOS?|PCE)$/.test(s)) return 'PCS';
    if (/^(PRS?|PAIRS?)$/.test(s)) return 'PRS';
    if (/^SETS?$/.test(s)) return 'SET';
    if (/^(PAC|PACKS?|PKTS?|PACKETS?)$/.test(s)) return 'PAC';
    if (/^DOZ(EN|ENS)?$/.test(s)) return 'DOZ';
    return s;
  }
  const CRF_PO = /^\d{2,3}[A-Z]{2,4}\d{2}[A-Z]{4}\d{4}$/;
  function normaliseRow(r) {
    /* v17.1: truck plates in one form (TN-69-AB-1234 → TN69AB1234); Carrefour item reference 1297070 → I297070 */
    for (const f of ['Truck Plate Number', 'Stuffing Truck No']) if (!emptyV(r[f])) r[f] = String(r[f]).split('/').map(plateNorm).filter(Boolean).join('/');
    if (!emptyV(r.Style) && /^1\d{6}$/.test(String(r.Style).trim()) && (/CARREFOUR/i.test(String(r['Customer Name'] || '')) || CRF_PO.test(String(r['PO Number'] || '').toUpperCase().trim()))) r.Style = 'I' + String(r.Style).trim().slice(1);
    /* v17: no stray spaces in names ("ATLAS  EXPORT", " SAKTHI INFRA") – reports then group them correctly */
    for (const [k, v] of Object.entries(r)) if (typeof v === 'string' && /^\s|\s$|\s{2}/.test(v) && !/\n/.test(v)) r[k] = v.replace(/\s+/g, ' ').trim();
    if (!emptyV(r['Qty Type'])) r['Qty Type'] = qtyType(r['Qty Type']);
    const v = String(r.VehicleSize || '').trim().toUpperCase().replace(/ /g, '');
    const m = v.match(/^D-?(\d{2})$/); if (m) r.VehicleSize = 'D-' + m[1];
    const ft = v.match(/^(\d{2})(FT|FEET|')$/); if (ft) r.VehicleSize = ft[1] + 'FT';
    /* list values in any case ("NO", "yes", "pcs") -> the list's spelling */
    for (const [f, opts] of Object.entries(F.SELECTS)) {
      const x = r[f]; if (emptyV(x)) continue;
      const hit = opts.find(o => o.toUpperCase() === String(x).trim().toUpperCase()); if (hit) r[f] = hit;
    }
    return r;
  }
  /* v17.1 container number: ISO 6346 check digit (4 letters + 6 digits + check digit) */
  function isoCheck(no) {
    const c = String(no || '').toUpperCase().replace(/[\s\-\/.]/g, '');
    if (!/^[A-Z]{3}[UJZR]\d{7}$/.test(c)) return {ok: false, clean: c, why: 'Container no should be 4 letters (the 4th is U, J, Z or R) + 7 digits, e.g. MSNU9608394.'};
    const val = ch => { if (/\d/.test(ch)) return +ch; let v = 10; for (let k = 65; k < ch.charCodeAt(0); k++) { v++; if (v % 11 === 0) v++; } return v; };
    let sum = 0; for (let i = 0; i < 10; i++) sum += val(c[i]) * Math.pow(2, i);
    const want = sum % 11 % 10;
    return want === +c[10] ? {ok: true, clean: c} : {ok: false, clean: c, want, why: `Container no ${c}: the last digit should be ${want} (ISO 6346 check digit) – check the number on the container door.`};
  }
  /* v17.1 container size from the Unit list text ("40 HC", "40'HC", "40HQ", "20 GP", "20'DV" …) */
  function unitCode(u) {
    const t = String(u || '').toUpperCase().replace(/[\s'’`"-]/g, '').replace('FT', '');
    const m = t.match(/^(20|40|45)(GP|DV|DC|ST|SD|HC|HQ|STD)?$/); if (!m) return '';
    if (m[1] === '45') return '45HC';
    return m[1] + (/HC|HQ/.test(m[2] || '') ? 'HC' : 'GP');
  }
  root.CSD.V = {validateRow, rowKey, keyComplete, keyNorm, invNorm, plateNorm, normaliseRow, qtyType, isoCheck, unitCode};
})(typeof self !== 'undefined' ? self : globalThis);
