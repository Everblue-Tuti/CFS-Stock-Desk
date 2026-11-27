/* Report columns, field groups and reference lists (same as the desktop version). */
(function (root) {
  const F = {
 "COLUMNS": [
  "Warehouse ID",
  "Customer Name",
  "Customer Code",
  "Customer Type",
  "Vendor Name",
  "Booking Number",
  "PO Number",
  "Style",
  "Item Qty (pcs)",
  "Shipper invoice number",
  "Total Packages",
  "Package UOM",
  "Total CBM",
  "Gross weight (kg)",
  "CHA Name",
  "Shipping Bill Number",
  "Shipping Bill date",
  "SB LEO DATE",
  "SB LEO TIME",
  "Document Cutoff Date",
  "Document Cutoff Time",
  "Allow Date",
  "Allow Time",
  "Warehouse Bay number",
  "Consignee",
  "Port of Discharge",
  "FPD",
  "Load_Status",
  "Cargo Description",
  "CO",
  "Truck Plate Number",
  "VehicleSize",
  "Transporter Name",
  "Truck Seal",
  "Offloading Date",
  "Offloading Start Time",
  "Offloading END Time",
  "Handover Date",
  "Handover Time",
  "Total OSD cartons",
  "OSD type",
  "OSD Remarks",
  "SORTED/UN SORTED",
  "Sorting Done by APLL",
  "Carting Remark",
  "Articles",
  "IEC",
  "CIN",
  "GroupName"
 ],
 "ITEM_FIELDS": [
  "PO Number",
  "Style",
  "Item Qty (pcs)",
  "Total Packages",
  "Total CBM",
  "Gross weight (kg)"
 ],
 "HEADER_FIELDS": [
  "Vendor Name",
  "Shipper invoice number",
  "Customer Name",
  "Consignee",
  "Port of Discharge",
  "FPD",
  "Cargo Description",
  "Package UOM",
  "IEC",
  "CIN",
  "Booking Number",
  "CHA Name",
  "Shipping Bill Number",
  "Shipping Bill date",
  "SB LEO DATE",
  "SB LEO TIME",
  "GroupName"
 ],
 "DOC_FIELDS": [
  "PO Number",
  "Style",
  "Item Qty (pcs)",
  "Total Packages",
  "Total CBM",
  "Gross weight (kg)",
  "Vendor Name",
  "Shipper invoice number",
  "Customer Name",
  "Consignee",
  "Port of Discharge",
  "FPD",
  "Cargo Description",
  "Package UOM",
  "IEC",
  "CIN",
  "Booking Number",
  "CHA Name",
  "Shipping Bill Number",
  "Shipping Bill date",
  "SB LEO DATE",
  "SB LEO TIME",
  "GroupName"
 ],
 "REQUIRED_DOC": [
  "Vendor Name",
  "Shipper invoice number",
  "Customer Name",
  "PO Number",
  "Style",
  "Item Qty (pcs)",
  "Total Packages",
  "Total CBM",
  "Gross weight (kg)",
  "Port of Discharge",
  "GroupName"
 ],
 "SELECTS": {
  "VehicleSize": [
   "D-10",
   "D-20",
   "D-40"
  ],
  "Load_Status": [
   "On Time",
   "Delay"
  ],
  "Package UOM": [
   "CARTONS",
   "PALLETS",
   "BALES",
   "PACKAGES",
   "ROLLS"
  ],
  "Cargo Description": [
   "GARMENTS",
   "FOOTWEAR",
   "HOME TEXTILES",
   "ACCESSORIES",
   "OTHER"
  ],
  "SORTED/UN SORTED": [
   "Yes",
   "No"
  ],
  "Sorting Done by APLL": [
   "Yes",
   "No"
  ]
 },
 "LISTS": {
  "CHA Name": [
   "BEE YEM AAR LOGISTICS",
   "D P LOGISTICS PVT LTD",
   "EASYWAY LOGISTICS",
   "INDEV INFRA PVT LTD",
   "J S SHIPPING SERVICES",
   "KENSHO GLOBAL",
   "KSR FREIGHT",
   "MULTIPORT TERMINAL",
   "OMEGA FORWARDERS",
   "RENOWN FORWARDERS PVT LTD",
   "SHALOM FORWARDERS",
   "SRI SURABHI IMPEX",
   "STAR AIR SEA LOGISTICS PVT LTD",
   "SURMOUNT LOGISTICS SOLUTIONS PVT LTD.",
   "THEESHIKSHA LOGISTICS PVT.LTD",
   "TRIWAY FORWARDERS"
  ],
  "Transporter Name": [
   "AASIF TRANSPORT",
   "DHARSHAN TRANSPORT",
   "JESUS TRANSPORT",
   "KH TRANSPORT",
   "KSR TRANSPORT",
   "KT TRANSPORT",
   "MAR TRANSPORT",
   "MULTI TRANSPORT",
   "SEKAR TRANSPORT",
   "SRI SURABHI TRANSPORTS"
  ],
  "Port of Discharge": [
   "BREMERHAVEN",
   "BUSAN",
   "HALIFAX",
   "HAMBURG",
   "HONG KONG",
   "JEBEL ALI",
   "LOS ANGELES",
   "MEMPHIS",
   "MONTREAL",
   "NEW YORK",
   "ROTTERDAM",
   "SAVANNAH",
   "SHANGHAI",
   "SHEKOU",
   "SINGAPORE",
   "SYDNEY",
   "TOKYO",
   "TORONTO",
   "VALENCIA",
   "VENLO",
   "ZEEBRUGGE"
  ],
  "FPD": [
   "BREMERHAVEN",
   "BUSAN",
   "HALIFAX",
   "HAMBURG",
   "HONG KONG",
   "JEBEL ALI",
   "LOS ANGELES",
   "MEMPHIS",
   "MONTREAL",
   "NEW YORK",
   "ROTTERDAM",
   "SAVANNAH",
   "SHANGHAI",
   "SHEKOU",
   "SINGAPORE",
   "SYDNEY",
   "TOKYO",
   "TORONTO",
   "VALENCIA",
   "VENLO",
   "ZEEBRUGGE"
  ]
 },
 "GROUP_ORDER": [
  "PVH",
  "CALVIN KLEIN",
  "AEO ALSHAYA",
  "DEICHMANN",
  "COLE HAAN LLC",
  "AEOMIX",
  "NIKE"
 ],
 "FORM_GROUPS": [
  [
   "Shipment (from documents)",
   [
    "Warehouse ID",
    "GroupName",
    "Customer Name",
    "Customer Code",
    "Customer Type",
    "Vendor Name",
    "Booking Number",
    "PO Number",
    "Style",
    "Item Qty (pcs)",
    "Shipper invoice number",
    "Total Packages",
    "Package UOM",
    "Total CBM",
    "Gross weight (kg)",
    "Consignee",
    "Port of Discharge",
    "FPD",
    "Cargo Description",
    "IEC",
    "CIN"
   ]
  ],
  [
   "Customs",
   [
    "CHA Name",
    "Shipping Bill Number",
    "Shipping Bill date",
    "SB LEO DATE",
    "SB LEO TIME",
    "Document Cutoff Date",
    "Document Cutoff Time",
    "Allow Date",
    "Allow Time",
    "CO"
   ]
  ],
  [
   "Carting",
   [
    "Warehouse Bay number",
    "Load_Status",
    "Truck Plate Number",
    "VehicleSize",
    "Transporter Name",
    "Truck Seal",
    "Offloading Date",
    "Offloading Start Time",
    "Offloading END Time",
    "Handover Date",
    "Handover Time"
   ]
  ],
  [
   "OSD & sorting",
   [
    "Total OSD cartons",
    "OSD type",
    "OSD Remarks",
    "SORTED/UN SORTED",
    "Sorting Done by APLL",
    "Carting Remark",
    "Articles"
   ]
  ]
 ],
 "FIXED_OK": [
  "Cargo Description",
  "GroupName",
  "Package UOM"
 ],
 "NEVER_FIXED": [
  "Consignee",
  "Customer Name",
  "FPD",
  "Port of Discharge"
 ],
 "NUMERIC": [
  "Gross weight (kg)",
  "Item Qty (pcs)",
  "Total CBM",
  "Total OSD cartons",
  "Total Packages"
 ],
 "INTEGER": [
  "Item Qty (pcs)",
  "Total OSD cartons",
  "Total Packages"
 ],
 "DATES": [
  "Allow Date",
  "Document Cutoff Date",
  "Handover Date",
  "Offloading Date",
  "SB LEO DATE",
  "Shipping Bill date"
 ],
 "TIMES": [
  "Allow Time",
  "Document Cutoff Time",
  "Handover Time",
  "Offloading END Time",
  "Offloading Start Time",
  "SB LEO TIME"
 ],
 "IDS": [
  "Booking Number",
  "CIN",
  "IEC",
  "PO Number",
  "Shipper invoice number",
  "Shipping Bill Number",
  "Style",
  "Truck Plate Number"
 ],
 "CUSTOMERS": {
  "PVH": [
   "",
   "",
   "PVH"
  ],
  "CALVIN KLEIN": [
   "CKRTEU",
   "CNS",
   "CALVIN KLEIN"
  ],
  "BLUE STAR IMPORTS LP AEO ALSHAYA": [
   "AEO ALSHAYA",
   "CNS",
   "AEO ALSHAYA"
  ],
  "BLUE STAR IMPORTS LP AEOMIX": [
   "AEOMIX",
   "CNS",
   "AEOMIX"
  ],
  "COLE HAAN LLC": [
   "COLE",
   "CNS",
   "COLE HAAN LLC"
  ],
  "DEICHMANN SE": [
   "DEICH",
   "CNS",
   "DEICHMANN"
  ],
  "NIKE USA": [
   "SWOOSH",
   "CNS",
   "NIKE"
  ],
  "NIKE CANADA CORP": [
   "SWOOSH",
   "CNS",
   "NIKE"
  ],
  "CENTROS COMERCIALES CARREFOUR SA": [
   "",
   "CNS",
   "CARREFOUR"
  ]
 }
};
  F.CFS_LIST = ["HIND TERMINAL CFS", "SATTVA VICHOOR CFS", "SICAL DISTRIPARK", "ST JOHN FREIGHT SYSTEMS"];
  /* ---- fields of the Tuticorin (GAP) stock report that the APLL report does not have ----
     The APLL report keeps exactly its 49 columns (APLL_COLUMNS); the extra fields are stored with every row. */
  F.APLL_COLUMNS = F.COLUMNS.slice();
  const EXTRA = ["Entry Date", "Delivery No", "Colour", "Invoice Date", "Received Pkgs", "Qty Type", "Net weight (kg)", "Late Cargo", "No of Labour", "OSD", "Actual CBM", "Any Damage"];
  /* from the Cargo Loading Plan (Customer service) and from stuffing */
  EXTRA.push("SHIP TO", "STATUS", "T.POINT", "FOB", "SHIP CXL", "PLAN", "Plan File", "Stuffed Pkgs", "Container No", "Stuffing Date", "Running No");
  for (const f of EXTRA) if (!F.COLUMNS.includes(f)) F.COLUMNS.push(f);
  for (const f of ["Net weight (kg)", "Colour", "Delivery No", "Qty Type"]) if (!F.ITEM_FIELDS.includes(f)) F.ITEM_FIELDS.push(f);
  if (!F.HEADER_FIELDS.includes("Invoice Date")) F.HEADER_FIELDS.push("Invoice Date");
  F.NUMERIC.push("Net weight (kg)", "Received Pkgs", "No of Labour", "Actual CBM"); F.INTEGER.push("Received Pkgs", "No of Labour");
  F.DATES.push("Entry Date", "Invoice Date", "SHIP CXL", "Stuffing Date"); F.IDS.push("Delivery No");
  F.SELECTS["Qty Type"] = ["CARTONS", "PCS", "PAC", "SET", "PRS", "DOZ"];   // v16.1: CARTONS = default
  F.SELECTS["Late Cargo"] = ["Yes", "No"];
  /* OSD = Overage, Shortage, Damage. Chosen for every shipment (no default); "Yes" automatically when the received
     cartons differ from the booked cartons. */
  F.SELECTS.OSD = ["Yes", "No"];
  F.SELECTS["Any Damage"] = ["Yes", "No"];
  /* damage types for the damage lines (Tuticorin) */
  F.DAMAGE_TYPES = ["Carton wet / water damage", "Carton torn / broken", "Carton crushed / dented", "Carton open / re-taped", "Seal / tape tampered",
    "Carton stained (oil / dirt)", "Strap / band broken", "Marking / label missing or wrong", "Mould / fungus", "Pilferage suspected", "Others"];
  /* Tuticorin: these item fields come from the packing list first (the invoice only when the packing list is not available) */
  F.PL_FIELDS = ["PO Number", "Colour", "Item Qty (pcs)", "Total Packages", "Gross weight (kg)", "Net weight (kg)", "Delivery No", "Qty Type"];
  F.LISTS["OSD type"] = ["SHORTAGE", "OVERAGE", "DAMAGE", "SHORTAGE & DAMAGE", "OVERAGE & DAMAGE"];
  /* entered by hand at the CFS, per item row (in the items table, next to the values read from the documents) */
  F.MANUAL_ITEM = ["Received Pkgs", "Actual CBM"];
  for (const v of ["14FT", "17FT", "19FT", "20FT", "22FT", "24FT", "32FT", "40FT"]) if (!F.SELECTS.VehicleSize.includes(v)) F.SELECTS.VehicleSize.push(v);
  const G = Object.fromEntries(F.FORM_GROUPS);
  const addTo = (g, after, fs) => { const l = G[g]; if (!l) return; let i = l.indexOf(after); for (const f of fs) if (!l.includes(f)) l.splice(i < 0 ? l.length : ++i, 0, f); };
  addTo("Shipment (from documents)", "Shipper invoice number", ["Invoice Date"]);
  addTo("Shipment (from documents)", "Gross weight (kg)", ["Net weight (kg)", "Qty Type", "Colour", "Delivery No"]);
  addTo("Carting", "Warehouse Bay number", ["Received Pkgs", "Actual CBM"]);
  addTo("OSD & sorting", "Sorting Done by APLL", ["Late Cargo", "No of Labour"]);
  { const l = G["OSD & sorting"]; if (l && !l.includes("OSD")) l.unshift("OSD"); }
  /* mandatory columns: Chennai = REQUIRED_DOC; Tuticorin (GAP report) = the GAP set incl. carting details.
     A shipper can mark some of them "Not needed" (Shipper formats -> column settings). Entry Date is filled automatically. */
  F.REQUIRED_TUT = ["Entry Date", "Warehouse ID", "Port of Discharge", "Customer Name", "Vendor Name", "PO Number", "Style",
    "Shipper invoice number", "Total Packages", "Item Qty (pcs)", "Gross weight (kg)", "Total CBM",
    "Truck Plate Number", "Offloading Date", "Offloading Start Time", "Warehouse Bay number", "Received Pkgs", "Any Damage"];
  /* Tuticorin reading screen: what is read from the invoice / packing list, and what is entered by hand (GAP order) */
  F.TUT_DOC_HEADER = ["Port of Discharge", "FPD", "Cargo Description", "Customer Name", "Customer Type", "Vendor Name", "Shipper invoice number", "Invoice Date", "Package UOM"];
  F.TUT_ITEMS = ["Delivery No", "PO Number", "Style", "Colour", "Total Packages", "Item Qty (pcs)", "Qty Type", "Gross weight (kg)", "Net weight (kg)", "Total CBM"];
  F.TUT_MANUAL = [["Customs & carting (enter by hand)", ["Warehouse Bay number", "Shipping Bill Number", "Shipping Bill date", "CHA Name",
      "Document Cutoff Date", "Document Cutoff Time", "Handover Date", "Handover Time", "Allow Date", "Allow Time", "Truck Plate Number",
      "Offloading Date", "Offloading Start Time", "Offloading END Time", "Transporter Name", "VehicleSize", "SORTED/UN SORTED", "Late Cargo", "No of Labour"]],
    ["OSD (Overage / Shortage / Damage)", ["Any Damage", "OSD Remarks"]]];
  /* names as in the GAP stock report (shown on the Tuticorin screens) */
  F.GAP_LABEL = {"FPD": "Final Destination", "Shipper invoice number": "Shipper Inv No", "Invoice Date": "Inv.Date", "PO Number": "PO. No",
    "Style": "Style No", "Total Packages": "Total Pkgs", "Item Qty (pcs)": "Item Qty (Pcs)", "Qty Type": "Type", "Gross weight (kg)": "Gross Weight",
    "Net weight (kg)": "Nett Weight", "Total CBM": "CBM Per Booking", "Warehouse Bay number": "Warehouse Bay No", "Shipping Bill date": "Shipping Date",
    "Document Cutoff Date": "Document Cut Off Date", "Document Cutoff Time": "Document Cut Off Time", "Handover Date": "Document Hand Over Date",
    "Handover Time": "Document Hand Over Time", "Offloading Date": "Offloading Date", "Offloading Start Time": "Offloading Start Time",
    "Offloading END Time": "Offloading End Time (optional)", "VehicleSize": "Size", "SORTED/UN SORTED": "Sorted / Unsorted", "No of Labour": "No of Labour",
    "Total OSD cartons": "OSD Cartons", "OSD type": "OSD Type", "OSD Remarks": "OSD Remark (optional)", "Any Damage": "Any damaged cartons?"};
  F.TUTICORIN = ["SICAL DISTRIPARK", "ST JOHN FREIGHT SYSTEMS"];
  /* GAP Inc. brands (from the GAP stock report) */
  for (const c of ["OLD NAVY (CANADA)", "OLD NAVY", "GAP INC", "GAP (CANADA)", "BANANA REPUBLIC", "ATHLETA"]) if (!F.CUSTOMERS[c]) F.CUSTOMERS[c] = ["", "CNS", "GAP"];
  if (!F.GROUP_ORDER.includes("GAP")) F.GROUP_ORDER.push("GAP");
  /* ---- version 15: truck flow. Documents are scanned when the truck arrives (row "waiting to offload");
     the carting / OSD details are filled when the operator clicks Offloaded. ---- */
  const V15 = ["Cargo Cutoff Date", "Cargo Cutoff Time", "Truck Arrival", "Offloaded At", "Stuffing Truck No", "Stuffing Truck Type", "Stuffing Transporter", "Photos"];
  for (const f of V15) if (!F.COLUMNS.includes(f)) F.COLUMNS.push(f);
  F.DATES.add ? F.DATES.add("Cargo Cutoff Date") : F.DATES.push("Cargo Cutoff Date");
  F.TIMES.add ? F.TIMES.add("Cargo Cutoff Time") : F.TIMES.push("Cargo Cutoff Time");
  F.SELECTS["Stuffing Truck Type"] = ["EV", "Diesel", "CNG"];
  /* filled in the Offloaded pop-up (not when the documents are scanned) */
  F.OFFLOAD_TRUCK = ["Warehouse Bay number", "Offloading Date", "Offloading Start Time", "Offloading END Time", "No of Labour", "SORTED/UN SORTED", "Late Cargo"];
  F.OFFLOAD_TRUCK_APLL = ["Load_Status", "Sorting Done by APLL", "Carting Remark", "Articles"];
  F.OFFLOAD_ROW = ["Received Pkgs", "Actual CBM"];
  F.OFFLOAD_OSD = ["Any Damage", "OSD", "OSD type", "Total OSD cartons", "OSD Remarks"];
  /* v17.1: seal / truck condition (chosen at Start offloading) */
  for (const f of ["Seal Condition", "Seal Photo"]) if (!F.COLUMNS.includes(f)) F.COLUMNS.push(f);
  F.SELECTS["Seal Condition"] = ["Intact", "Broken", "Open truck"];
  F.SEAL = ["Intact", "Broken", "Open truck"];
  /* v17.1 container size and usable capacity (CBM / payload kg) */
  F.CONTAINER_CAP = {"20GP": {cbm: 33, kg: 28000}, "40GP": {cbm: 67, kg: 26500}, "40HC": {cbm: 76, kg: 26500}, "45HC": {cbm: 86, kg: 27600}};
  F.BAD_REMARK = /^(ok|okay|nil|nill|none|na|n\/a|done|checked|-+|\.+)$/i;
  F.OFFLOAD_ALL = [...F.OFFLOAD_TRUCK, ...F.OFFLOAD_TRUCK_APLL, ...F.OFFLOAD_ROW, ...F.OFFLOAD_OSD];
  F.SCAN_REQUIRED_EXTRA = ["Truck Plate Number", "Cargo Cutoff Date", "Cargo Cutoff Time"];
  /* Tuticorin scan screen: customs & carting entered by hand at the gate (offloading details come later) */
  F.TUT_MANUAL_V15 = [["Customs, truck & cut-off (enter by hand)", ["Truck Plate Number", "VehicleSize", "Transporter Name", "Allow Date", "Allow Time",
    "Cargo Cutoff Date", "Cargo Cutoff Time", "Late Cargo", "Shipping Bill Number", "Shipping Bill date", "CHA Name", "Document Cutoff Date", "Document Cutoff Time", "Handover Date", "Handover Time"]]];
  F.GAP_LABEL["Allow Date"] = "Truck arrival date (Allow Date)"; F.GAP_LABEL["Allow Time"] = "Truck arrival time (Allow Time)";
  F.GAP_LABEL["Cargo Cutoff Date"] = "Cargo cut-off date"; F.GAP_LABEL["Cargo Cutoff Time"] = "Cargo cut-off time";
  const baseRequired = site => F.TUTICORIN.includes(String(site || "").toUpperCase()) ? F.REQUIRED_TUT : F.REQUIRED_DOC;
  /* stage "scan" = when the documents are saved (truck waiting); otherwise = in stock (after Offloaded) */
  F.requiredFor = (site, stage) => {
    const base = baseRequired(site);
    if (stage !== "scan") return base;
    return [...base.filter(f => !F.OFFLOAD_ALL.includes(f) && !["Offloading Date", "Offloading Start Time"].includes(f)), ...F.SCAN_REQUIRED_EXTRA.filter(f => !base.includes(f) || true)].filter((f, i, a) => a.indexOf(f) === i);
  };
  /* Late Cargo: arrival later than the cargo cut-off date & time */
  F.lateCargo = (r) => {
    const cd = r["Cargo Cutoff Date"], ct = r["Cargo Cutoff Time"] || "23:59", ad = r["Allow Date"], at = r["Allow Time"] || "00:00";
    if (!cd || !ad) return "";
    return `${ad} ${String(at).padStart(5, "0")}` > `${cd} ${String(ct).padStart(5, "0")}` ? "Yes" : "No";
  };
  F.SELECTS["Warehouse ID"] = F.CFS_LIST;
  if (!F.REQUIRED_DOC.includes("Warehouse ID")) F.REQUIRED_DOC.unshift("Warehouse ID");
  for (const k of ["FIXED_OK","NEVER_FIXED","NUMERIC","INTEGER","DATES","TIMES","IDS"]) F[k] = new Set(F[k]);
  /* Site mode: each site opens its own link, e.g. …/CFS-Stock-Desk/?site=SICAL. The PC then stays on that site
     (also when opened later without the link, e.g. from the installed app). ?site=ALL switches site mode off. */
  F.SITE_CODES = {HTPL: "HIND TERMINAL CFS", HIND: "HIND TERMINAL CFS", SATTVA: "SATTVA VICHOOR CFS", SICAL: "SICAL DISTRIPARK",
    STJ: "ST JOHN FREIGHT SYSTEMS", STJOHN: "ST JOHN FREIGHT SYSTEMS", STJOHNS: "ST JOHN FREIGHT SYSTEMS"};
  try {
    const q = root.location && new URLSearchParams(root.location.search).get("site");
    if (q !== null && q !== undefined) {
      const k = String(q).toUpperCase().replace(/[^A-Z]/g, "");
      if (!k || k === "ALL") root.localStorage.removeItem("csd_site_lock");
      else { const c = F.SITE_CODES[k] || F.CFS_LIST.find(x => x.replace(/[^A-Z]/g, "") === k);
        if (c) { root.localStorage.setItem("csd_site_lock", c); root.localStorage.setItem("csd_cfs", c); } }
    }
  } catch (e) { /* no browser storage: site mode off */ }
  F.siteLock = () => { try { const v = root.localStorage.getItem("csd_site_lock") || ""; return F.CFS_LIST.includes(v) ? v : ""; } catch (e) { return ""; } };
  root.CSD = root.CSD || {}; root.CSD.F = F;
  /* All dates and times the app records are India time (IST, Asia/Kolkata), whatever the PC's own time zone is. */
  const IST_FMT = (() => { try { return new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}); } catch (e) { return null; } })();
  function istParts(d) {
    d = d || new Date();
    if (IST_FMT) { const o = {}; for (const p of IST_FMT.formatToParts(d)) o[p.type] = p.value; return {y: o.year, m: o.month, d: o.day, H: o.hour === '24' ? '00' : o.hour, M: o.minute, S: o.second}; }
    const x = new Date(d.getTime() + 330 * 60000), p = n => String(n).padStart(2, '0');     // fallback: UTC + 5:30
    return {y: String(x.getUTCFullYear()), m: p(x.getUTCMonth() + 1), d: p(x.getUTCDate()), H: p(x.getUTCHours()), M: p(x.getUTCMinutes()), S: p(x.getUTCSeconds())};
  }
  root.CSD.ist = {
    parts: istParts,
    date: d => { const p = istParts(d); return `${p.y}-${p.m}-${p.d}`; },                   // 2026-11-26
    time: d => { const p = istParts(d); return `${p.H}:${p.M}`; },                           // 07:30
    stamp: d => { const p = istParts(d); return `${p.y}-${p.m}-${p.d} ${p.H}:${p.M}:${p.S}`; },
    minutes: d => { const p = istParts(d); return +p.H * 60 + +p.M; },
    dow: d => { const p = istParts(d); return new Date(Date.UTC(+p.y, +p.m - 1, +p.d)).getUTCDay(); },   // 0 = Sunday
    addDays: (iso, n) => { const [y, m, dd] = String(iso).split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd + n)); return x.toISOString().slice(0, 10); },
  };
})(typeof self !== "undefined" ? self : globalThis);
/* v17.1: shipper alias list – one shipper name per shipper (as Customer service writes it in the carting sheet), with the
   other spellings on documents / earlier entries, GSTIN and the start of its invoice numbers. The admin keeps it in the app. */
(function (root) {
  const F = root.CSD.F;
  /* v17.1: the shipper name list is NOT in the program (the GitHub repository is public). The admin imports it once from
     the setup package (Shipper_name_list_import.json → Shipper formats → Import formats file); it then travels with
     "Export formats" to the other PCs, or lives in the central database. */
  F.SHIPPER_ALIAS_DEFAULT = [];
  const key = v => String(v || '').toUpperCase().replace(/^\s*M\s*\/\s*S\.?\s+/, '').replace(/[^A-Z0-9]/g, '');
  F.shipperKey = key;
  F.cleanShipper = v => String(v || '').toUpperCase().replace(/^\s*M\s*\/\s*S\.?\s+/, '').replace(/[.,]+$/, '').replace(/\s*-\s*$/, '').replace(/\s+/g, ' ').trim();
  /* → {name, matched, by, conflict}: GSTIN first, then the name / other spellings, then the invoice number pattern */
  F.canonShipper = (list, raw, gstins, invoice) => {
    list = list && list.length ? list : F.SHIPPER_ALIAS_DEFAULT;
    const k = key(raw), inv = String(invoice || '').toUpperCase().replace(/\s+/g, '');
    const byG = (gstins || []).length ? list.find(s => (s.gstin || []).some(g => gstins.includes(String(g).toUpperCase()))) : null;
    const byN = k ? list.find(s => [s.name, ...(s.aliases || [])].some(a => key(a) === k)) : null;
    const byP = inv ? list.find(s => (s.prefixes || []).some(rx => { try { return new RegExp(rx, 'i').test(inv); } catch (e) { return false; } })) : null;
    const hit = byG || byN || byP;
    return {name: hit ? hit.name : F.cleanShipper(raw), matched: !!hit, by: byG ? 'gstin' : byN ? 'name' : byP ? 'invoice' : '',
      conflict: byP && hit && byP !== hit ? byP.name : ''};
  };
  F.CUSTOMERS['CARREFOUR IMPORT SAS'] = ['CARRE4', 'CNS', 'CARREFOUR'];
  if (F.CUSTOMERS['CENTROS COMERCIALES CARREFOUR SA']) F.CUSTOMERS['CENTROS COMERCIALES CARREFOUR SA'][0] = 'CARRE4';
  /* v17.1: normal CBM per carton by commodity – ST JOHN carting sheet Jan–Sep 2026 (5,462 lines): 1st–99th percentile
     GARMENTS 0.0085–0.093, MADEUPS 0.010–0.092, TOYS 0.039–0.064 – a little wider here so normal cargo is never flagged */
  F.CBM_PER_CTN = {GARMENTS: [0.006, 0.12], MADEUPS: [0.008, 0.12], TOYS: [0.02, 0.15]};
})(typeof self !== 'undefined' ? self : globalThis);
