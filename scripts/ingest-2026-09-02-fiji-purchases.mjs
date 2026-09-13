import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolve = (relativePath) => path.join(root, relativePath);
const readJson = (relativePath) => JSON.parse(fs.readFileSync(resolve(relativePath), "utf8"));
const writeJson = (relativePath, value) => fs.writeFileSync(resolve(relativePath), `${JSON.stringify(value, null, 2)}\n`);
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const system = readJson("data/dse-system.json");
const delivery = readJson("data/dse-delivery.json");
const customs = readJson("data/dse-customs.json");
const solarAggregate = readJson("private/solar-fiji-purchases-through-2026-09-02.json");
const hardwareAggregate = readJson("private/rc-manubhai-purchases-through-2026-09-01.json");
const solar = solarAggregate.purchases[0];
const hardware = hardwareAggregate.orders[0];

const sum = (items, key) => roundMoney(items.reduce((total, item) => total + item[key], 0));
const solarFjd = roundMoney(sum(solar.items, "lineTotalFjd") + solar.taxAllocation.lineTotalFjd);
const solarUsd = roundMoney(sum(solar.items, "lineTotalUsd") + solar.taxAllocation.lineTotalUsd);
if (solarFjd !== solar.grandTotalFjd || solarUsd !== solar.planningTotalUsd) {
  throw new Error(`Solar Fiji reconciliation failed: ${solarFjd} FJD / ${solarUsd} USD`);
}
if (sum(hardware.items, "lineTotalFjd") !== hardware.grandTotalFjd
  || sum(hardware.items, "lineTotalUsd") !== hardware.planningTotalUsd) {
  throw new Error("R.C. Manubhai reconciliation failed");
}

const existingById = new Map(system.bom.map((item) => [item.id, item]));
const mergeExisting = (id, changes) => ({ ...(existingById.get(id) ?? {}), id, ...changes });

const solarMeta = {
  "dse-solar-fiji-installation-screws": {
    category: "Mounting", priority: "Installation stock",
    description: "One box quoted for the Solar Fiji installation. Confirm material, corrosion resistance and exact structural use before installation.",
  },
  "dse-panels": {
    category: "Generation", priority: "Must · exact active model",
    description: "Three exact AIKO-A490-MCE54Mw modules paid for through Solar Fiji. They form the active 1,470 W 3S array. Delivery and all received nameplates still need confirmation.",
  },
  "dse-batteries": {
    category: "Storage", priority: "Must · matched active bank",
    description: "Four exact BAT412201104 batteries paid for through Solar Fiji. They form two independently breakered 24 V series strings in parallel: 24 V / 440 Ah. Delivery, date codes, condition and matched commissioning readings remain to be recorded.",
  },
  "dse-solar-fiji-schletter-roof-mount-kit": {
    category: "Mounting", priority: "Must · structural fit hold",
    description: "Three-panel Schletter kit including rails, mids, ends, feet, splice and earthing parts. Reconcile the received kit against the quarter-turned 3 × 1 array and obtain structural approval before drilling or loading the roof/rack.",
  },
  "dse-solar-fiji-schletter-tin-feet": {
    category: "Mounting", priority: "Must · structural fit hold",
    description: "Four additional Schletter RapidPro black L tin feet. Screws were explicitly excluded from this quote line; confirm compatible fasteners and structural spacing.",
  },
  "dse-solar-fiji-50mm-black-cable": {
    category: "Wiring", priority: "Purchased stock · allocation hold",
    description: "Five metres of black 50 mm² single-core battery cable. The canonical schedule calls its aggregate runs 1/0 AWG / 53.5 mm²; do not silently substitute this metric cable until ampacity, insulation, terminal fit and the accepted protection scheme are confirmed.",
  },
  "dse-solar-fiji-50mm-red-cable": {
    category: "Wiring", priority: "Purchased stock · allocation hold",
    description: "Five metres of red 50 mm² single-core battery cable. The canonical schedule calls its aggregate runs 1/0 AWG / 53.5 mm²; do not silently substitute this metric cable until ampacity, insulation, terminal fit and the accepted protection scheme are confirmed.",
  },
  "dse-solar-fiji-35mm-black-cable": {
    category: "Wiring", priority: "Purchased stock · terminal-fit hold",
    description: "Twelve metres of black 35 mm² single-core battery cable. It is close to the scheduled 2 AWG / 33.6 mm² size; verify the received cable and every 35 mm² / 2 AWG clamp and lug before allocation.",
  },
  "dse-solar-fiji-35mm-red-cable": {
    category: "Wiring", priority: "Purchased stock · terminal-fit hold",
    description: "Twelve metres of red 35 mm² single-core battery cable. It is close to the scheduled 2 AWG / 33.6 mm² size; verify the received cable and every 35 mm² / 2 AWG clamp and lug before allocation.",
  },
  "dse-solar-fiji-16mm-twin-battery-cable": {
    category: "Wiring", priority: "Purchased stock · not allocated",
    description: "Eight metres of black/red two-core 16 mm² battery cable. This is not silently substituted for the canonical 8 AWG secondary feeder or 6 mm² branches; assign it only after circuit, terminal and protection review.",
  },
  "dse-solar-fiji-earth-rod": {
    category: "Safety", priority: "Must · site verification",
    description: "One earth rod and clip for the site grounding system. Verify electrode material, length, local soil suitability, corrosion compatibility and measured earth resistance.",
  },
  "dse-solar-fiji-6mm-earth-wire": {
    category: "Safety", priority: "Must · site verification",
    description: "Fifteen metres of 6 mm² earth conductor. Confirm insulation/identification, routing, termination hardware and local bonding requirements before installation.",
  },
  "dse-pv-cable": {
    category: "Wiring", priority: "Must · received-cable verification",
    description: "Thirty-five metres of quoted 4 mm² two-core PV cable for the single AIKO 3S home run and service allowance. Confirm the received cable's PV/DC voltage, UV, wet-location, temperature, polarity-identification, connector and gland suitability before use.",
  },
  "dse-solar-fiji-6mm-twin-pv-cable": {
    category: "Wiring", priority: "Purchased stock · not allocated",
    description: "Ten metres of 6 mm² two-core PV cable. R32 uses 4 mm² for the active array, so retain this as unallocated stock unless a documented circuit change requires it.",
  },
  "dse-solar-fiji-1-5mm-light-wire": {
    category: "Wiring", priority: "Purchased stock · allocation check",
    description: "Eighteen metres of 1.5 mm² light wire. Confirm conductor construction, core count, voltage and environmental suitability before assigning it to a modeled lighting run.",
  },
  "dse-solar-fiji-1-5mm-switch-wire": {
    category: "Wiring", priority: "Purchased stock · allocation check",
    description: "Twenty-seven metres of 1.5 mm² switch wire. The canonical lighting topology switches at the secondary enclosure; assign this stock only after the actual field routing is confirmed.",
  },
  "dse-solar-fiji-1-5mm-twin-flex": {
    category: "Wiring", priority: "Purchased stock · specification hold",
    description: "Ten metres quoted as 1.5 mm twin flex with 0.75 mm construction. Preserve the source wording and verify the received core area, voltage, flex class and permitted circuit before use.",
  },
  "dse-solar-fiji-used-cable-cutter": {
    category: "Tools & accessories", priority: "Installation tool",
    description: "Used manual cutter sold for cable up to 50 mm². Inspect blade condition and prove a clean, non-deforming cut on scrap before preparing installation cable.",
  },
  "dse-solar-fiji-35mm-m8-lugs": {
    category: "Wiring", priority: "Must · crimp and landing verification",
    description: "Sixteen 35 mm² cable lugs with M8 holes. Verify barrel fit, copper/tinning, crimp die, pull test and the exact M8 landing; many main-bus ends require M10 and are not covered by this stock.",
  },
  "dse-solar-fiji-50mm-m8-lugs": {
    category: "Wiring", priority: "Must · crimp and landing verification",
    description: "Six 50 mm² cable lugs with M8 holes. These can only cover verified M8 ends; the SmartShunt and main-bus landings remain M10-class and require different lugs.",
  },
  "dse-solar-fiji-16mm-m8-lugs": {
    category: "Wiring", priority: "Purchased stock · not allocated",
    description: "Four 16 mm² cable lugs with M8 holes. No canonical circuit is automatically reassigned to this size; verify any future allocation and protection first.",
  },
};

const solarRows = solar.items.map((item) => {
  const meta = solarMeta[item.bomId];
  if (!meta) throw new Error(`Missing Solar Fiji metadata for ${item.bomId}`);
  return mergeExisting(item.bomId, {
    category: meta.category,
    item: item.bomId === "dse-panels"
      ? "AIKO Neostar 3P54 490 W panel · AIKO-A490-MCE54Mw"
      : item.bomId === "dse-batteries"
        ? "Victron 12 V 220 Ah GEL Deep Cycle battery · BAT412201104"
        : item.item,
    qty: item.qty,
    unit: item.unit,
    unitCost: item.unitCostFjd,
    currency: "FJD",
    sourceTotal: item.lineTotalFjd,
    totalUsd: item.lineTotalUsd,
    location: "Fiji · Solar Fiji",
    procurement: "Purchased · paid by IYOIYO · delivery pending",
    priority: meta.priority,
    accountingGroup: "system",
    includedInTotal: true,
    grantPayer: "IYOIYO",
    grantSection: "fiji",
    grantPaymentNote: "Paid by IYOIYO in the FJD 12,172 Solar Fiji wire on 2 Sep 2026; delivery confirmation remains pending.",
    purchaseDate: solar.paidDate,
    supplierReference: solar.quoteNumber,
    description: `${meta.description} Solar Fiji quote line: FJD ${item.lineTotalFjd.toFixed(2)} before quote-level VAT; USD accounting value uses 2.20 FJD/USD.`,
  });
});

const taxRow = {
  id: solar.taxAllocation.bomId,
  category: "Tax / adjustments",
  item: solar.taxAllocation.item,
  qty: 1,
  unit: "quote adjustment",
  unitCost: solar.taxAllocation.lineTotalFjd,
  currency: "FJD",
  sourceTotal: solar.taxAllocation.lineTotalFjd,
  totalUsd: solar.taxAllocation.lineTotalUsd,
  location: "Fiji · Solar Fiji",
  procurement: "Purchased · paid by IYOIYO",
  priority: "Transaction reconciliation",
  accountingGroup: "system",
  includedInTotal: true,
  grantPayer: "IYOIYO",
  grantSection: "fiji",
  grantPaymentNote: "Paid by IYOIYO as part of the FJD 12,172 Solar Fiji wire on 2 Sep 2026.",
  purchaseDate: solar.paidDate,
  supplierReference: solar.quoteNumber,
  description: `${solar.taxAllocation.note} USD accounting value uses 2.20 FJD/USD.`,
};

const hardwareMeta = {
  "dse-fiji-cable-ties": ["Mounting", "Installation consumable", "Black 3 × 100 mm cable ties. Use only where temperature, UV exposure and serviceability are appropriate."],
  "dse-fiji-3m-extension-cords": ["AC safety", "Purchased stock · not the specified tool lead", "Two 3 m white 1 mm² ordinary-duty extension cords. They do not silently replace the specified 5 m heavy-duty Type I tool lead; inspect ratings and allocate only to a suitable protected use."],
  "dse-fiji-slotted-screwdriver": ["Tools & accessories", "Installation tool", "One 6 × 200 mm slotted screwdriver purchased for field installation."],
  "dse-fiji-phillips-screwdrivers": ["Tools & accessories", "Installation tools", "Two PH2 × 150 mm Phillips screwdrivers purchased for field installation."],
  "dse-fiji-15a-female-socket": ["AC safety", "Purchased stock · installer selection", "One 15 A female socket. Confirm Fiji/AS-NZS configuration, voltage, enclosure, strain relief and protection before use."],
  "dse-fiji-10a-surface-socket": ["AC safety", "Purchased stock · installer selection", "One 250 V / 10 A surface socket. It is not automatically substituted for the modeled protected Type I tool outlet."],
  "dse-fiji-3-gang-switch": ["DC controls", "Purchased stock · allocation check", "One white horizontal three-gang 10 A switch. Verify AC/DC rating and contact arrangement before assigning it to any circuit."],
  "dse-fiji-2-gang-switch": ["DC controls", "Purchased stock · allocation check", "One white horizontal two-gang 10 A switch. Verify AC/DC rating and contact arrangement before assigning it to any circuit."],
  "dse-fiji-shopping-bag": ["Tools & accessories", "Site-supply expense", "Reusable bag charged on the same cash receipt and retained so the receipt total reconciles exactly."],
};

const hardwareRows = hardware.items.map((item) => {
  const meta = hardwareMeta[item.bomId];
  if (!meta) throw new Error(`Missing R.C. Manubhai metadata for ${item.bomId}`);
  return {
    id: item.bomId,
    category: meta[0],
    item: item.item,
    qty: item.qty,
    unit: item.unit,
    unitCost: item.unitCostFjd,
    currency: "FJD",
    sourceTotal: item.lineTotalFjd,
    totalUsd: item.lineTotalUsd,
    location: "Fiji · Suva",
    procurement: "Purchased · paid cash by IYOIYO",
    priority: meta[1],
    accountingGroup: "system",
    includedInTotal: true,
    grantPayer: "IYOIYO",
    grantSection: "fiji",
    grantPaymentNote: "Paid in cash by IYOIYO; the FJD 50 receipt includes FJD 5.56 VAT.",
    purchaseDate: hardware.date,
    supplierReference: hardware.invoiceNumber,
    description: `${meta[2]} Receipt line: FJD ${item.lineTotalFjd.toFixed(2)} including VAT; USD accounting value uses 2.20 FJD/USD.`,
  };
});

const historicalRows = {
  "dse-suntech-panels-superseded": {
    historicalEstimateFjd: 1996,
    description: "Historical Fiji estimate for four Suntech panels from the retired design. No purchase occurred and neither DSE nor IYOIYO paid this amount; the active AIKO purchase is itemized separately.",
  },
  "dse-everexceed-batteries-superseded": {
    historicalEstimateFjd: 5160,
    description: "Historical Fiji estimate for four EverExceed batteries from the retired design. No purchase occurred and neither DSE nor IYOIYO paid this amount; the active Victron purchase is itemized separately.",
  },
};
for (const [id, history] of Object.entries(historicalRows)) {
  const row = existingById.get(id);
  if (!row) throw new Error(`Missing historical Fiji row ${id}`);
  Object.assign(row, {
    unitCost: 0,
    totalUsd: 0,
    location: "Historical Fiji estimate",
    procurement: "Not purchased · superseded estimate",
    priority: "Reference only",
    accountingGroup: "excluded",
    includedInTotal: false,
    ...history,
  });
  delete row.grantPayer;
  delete row.grantPaymentNote;
  delete row.grantSection;
  delete row.sourceTotal;
}

const customsPaymentCorrections = {
  "dse-customs-vat": {
    procurement: "Purchased · paid by IYOIYO",
    grantPayer: "IYOIYO",
    grantPaymentNote: "Paid by IYOIYO.",
    description: "Import VAT from Extreme Customs Clearance tax invoice 00070037 dated 28 Aug 2026. Source amount is FJD 1,736.65; the USD amount uses the project's 2.20 FJD/USD accounting rate. Paid by IYOIYO.",
  },
  "dse-customs-agent-costs": {
    procurement: "Purchased · paid by IYOIYO",
    grantPayer: "IYOIYO",
    grantPaymentNote: "Paid by IYOIYO.",
    description: "Remaining charges from Extreme Customs Clearance tax invoice 00070037 dated 28 Aug 2026: FJD 157.15 fiscal duty, FJD 828.88 clearance and agent charges, and FJD 85.85 service VAT. The USD amount uses the project's 2.20 FJD/USD accounting rate with the one-cent allocation required to preserve the invoice's FJD 2,808.53 converted total. Paid by IYOIYO.",
  },
};
for (const [id, correction] of Object.entries(customsPaymentCorrections)) {
  const row = existingById.get(id);
  if (!row) throw new Error(`Missing customs row ${id}`);
  Object.assign(row, correction);
}

const outsideScopeIds = [
  "dse-personal-garmin-montana-710i",
  "dse-unused-galaxy-s24-case",
  "dse-unused-sandisk-portable-ssd",
  "dse-personal-flexsolar-panels",
  "dse-unused-acer-card-readers",
  "dse-personal-takoci-hx870-batteries",
  "dse-unused-galaxy-s24-pair",
  "dse-unused-macbook-air-15-m4",
  "dse-type-i-notebook-cord-additional",
  "dse-shelf-brackets-additional",
  "dse-laptop-sleeve-additional",
  "dse-unused-swappa-sales-tax",
  "dse-personal-amazon-promotions",
  "dse-personal-amazon-sales-tax",
];
for (const id of outsideScopeIds) {
  const row = existingById.get(id);
  if (!row) throw new Error(`Missing outside-scope row ${id}`);
  Object.assign(row, {
    accountingGroup: "additional",
    includedInTotal: false,
    grantScope: "outside-scope",
  });
}

const sharedAllocationBasis = "Documented item price only; shared order-level tax, promotions and customs costs remain unallocated by recipient.";
Object.assign(existingById.get("dse-unused-sandisk-portable-ssd"), {
  grantAllocations: [{
    recipientOrganization: "Inowon",
    location: "Polowat",
    qty: 1,
    amountUsd: 164.99,
    note: `Allocation: 1 of 2 SSDs ($164.99 item price) is for Inowon in Polowat. ${sharedAllocationBasis}`,
  }],
  description: "Purchased on Amazon on 31 Jul 2026. Both drives are outside the solar-system scope. One is allocated to Inowon in Polowat and the other remains in the general outside-scope pool.",
});
Object.assign(existingById.get("dse-unused-acer-card-readers"), {
  grantAllocations: [{
    recipientOrganization: "Inowon",
    location: "Polowat",
    qty: 1,
    amountUsd: 14.99,
    note: `Allocation: 1 of 2 SD card readers ($14.99 item price) is for Inowon in Polowat. ${sharedAllocationBasis}`,
  }],
  description: "Purchased on Amazon on 31 Jul 2026. Both readers are outside the solar-system scope. One is allocated to Inowon in Polowat and the other remains in the general outside-scope pool.",
});

const reduceAllowance = (id, item, remainingFjd, description) => {
  const row = existingById.get(id);
  if (!row) throw new Error(`Missing allowance row ${id}`);
  Object.assign(row, {
    item,
    unitCost: remainingFjd,
    currency: "FJD",
    sourceTotal: remainingFjd,
    totalUsd: roundMoney(remainingFjd / system.currency.fjdPerUsd),
    procurement: "Allowance · remaining after local purchase",
    description,
  });
};
reduceAllowance(
  "dse-earth",
  "Remaining grounding and bonding installation allowance",
  37.9,
  "Remaining allowance after itemizing the purchased earth rod/clip and 15 m of 6 mm² earth wire. Covers only unpurchased bonding hardware, corrosion protection and testing.",
);
reduceAllowance(
  "dse-terms",
  "Remaining cable-termination and installation-hardware allowance",
  61.9,
  "Remaining allowance after itemizing the Solar Fiji screw assortment and M8 lug purchases. M10, M6, #10 and #8 terminations still require exact counts and received-hardware verification.",
);
reduceAllowance(
  "dse-light-install",
  "Remaining lighting installation allowance",
  14.4,
  "Remaining allowance after itemizing the purchased 1.5 mm² light and switch wire. Covers only unpurchased clips, brackets, sealed splices, glands and corrosion-resistant mounting details.",
);

const supplemental = existingById.get("dse-supplemental-1-0-cable-fiji");
if (!supplemental) throw new Error("Missing supplemental cable row");
supplemental.item = "Remaining site-fabricated heavy-DC cable assemblies";
supplemental.procurement = "Measure and allocate purchased Fiji cable · price remainder pending";
supplemental.description = "Solar Fiji cable stock is now itemized by exact metric size, colour, quantity and cost. Allocate it only after checking the received cable against the canonical 1/0 AWG, 2 AWG and 8 AWG schedule; this zero-value row retains any remaining fabrication, M10/#10 termination and shortfall work not covered by that stock.";

const existingSolarIds = new Set(["dse-panels", "dse-batteries", "dse-pv-cable"]);
const coreSolarRows = new Map(solarRows
  .filter((row) => existingSolarIds.has(row.id))
  .map((row) => [row.id, row]));
const insertedRows = [
  ...solarRows.filter((row) => !existingSolarIds.has(row.id)),
  taxRow,
  ...hardwareRows,
];
const insertedIds = new Set(insertedRows.map((row) => row.id));
const retainedRows = system.bom
  .filter((item) => !insertedIds.has(item.id))
  .map((item) => coreSolarRows.get(item.id) ?? item);
const insertAfter = retainedRows.findIndex((item) => item.id === "dse-pv-cable");
if (insertAfter < 0) throw new Error("Unable to locate Fiji purchase insertion point");
retainedRows.splice(insertAfter + 1, 0, ...insertedRows);
system.bom = retainedRows;

system.currency.note = "USD remains the reporting base. Actual local purchase amounts are preserved in FJD; USD equivalents use the retained 2.20 FJD/USD project accounting rate because the wire confirmation does not state the USD debit or exchange rate.";
system.budget.note = "Purchases and transaction adjustments are reconciled through 2 Sep 2026. IYOIYO paid Solar Fiji FJD 12,172.00 by wire against quote TP260901-V2 for the three AIKO panels, four Victron batteries, Schletter mounting hardware, cable, grounding materials, lugs and a used cutter; delivery confirmation remains pending. IYOIYO also paid FJD 50.00 cash at R.C. Manubhai for eleven units across nine site-supply lines, including FJD 5.56 VAT. The retired Suntech and EverExceed rows were estimates only: no purchase occurred, their cost is zero, and they are excluded from all payer totals. Actual FJD values remain visible by item; USD reports use 2.20 FJD/USD. Imported equipment and customs clearance have reached Fiji, so the shipping and customs interfaces are archived from production while their source data and code remain retained. IYOIYO paid the Extreme Customs Clearance invoice totaling FJD 2,808.53, including import VAT, fiscal duty, clearance and agent charges, and service VAT. The grant ledger classifies $11,156.93 as solar-system/shared project costs and $3,422.50 as outside scope; together they remain $14,579.43. Within outside scope, one SSD and one SD card reader are allocated to Inowon in Polowat at $179.98 in documented item prices, while shared order-level tax, promotions and customs remain unallocated by recipient. IYOIYO's Ekrano GX purchase remains charged against the $8,000 Pacific Traditions Society check; Erik Godo's donation reimburses PTS and is attribution only. The Amazon audit retains $324.95 in issued or credited refunds and keeps incompatible/return-bound equipment out of the installed design. MultiPlus final Fiji invoicing, local labor, delivery/receipt confirmation and any remaining installation materials still require reconciliation.";

delivery.checkedOn = "2026-09-03";
delivery.archivedOn = "2026-09-03";
delivery.archiveReason = "The imported shipment has arrived in Fiji; production shipping tracking is closed. Local purchase evidence remains in the BOM and grant report.";
for (const id of Object.keys(historicalRows)) {
  delivery.items[id] = {
    amazonStatus: "not-purchased",
    sourceLabel: "Historical Fiji estimate",
    eta: "Never ordered",
    time: "Superseded before purchase",
    note: historicalRows[id].description,
  };
}
for (const item of solar.items) {
  delivery.items[item.bomId] = {
    amazonStatus: "purchased-local",
    sourceLabel: `Solar Fiji · quote ${solar.quoteNumber}`,
    eta: "Payment sent 2 Sep 2026",
    time: "Delivery to Suva included · confirmation pending",
    note: `Paid by IYOIYO as part of the FJD ${solar.grandTotalFjd.toLocaleString("en-US")} transfer. Verify the received item before installation or allocation.`,
  };
}
for (const item of hardware.items) {
  delivery.items[item.bomId] = {
    amazonStatus: "purchased-local",
    sourceLabel: `R.C. Manubhai · invoice ${hardware.invoiceNumber}`,
    eta: "Purchased 1 Sep 2026",
    time: "Collected in Suva · paid cash",
    note: "Paid by IYOIYO and reconciled to the FJD 50 receipt.",
  };
}
delivery.items["dse-customs-vat"] = {
  ...delivery.items["dse-customs-vat"],
  time: "Invoice dated Aug 28 · paid by IYOIYO",
  note: "FJD 1,736.65 import VAT paid by IYOIYO.",
};
delivery.items["dse-customs-agent-costs"] = {
  ...delivery.items["dse-customs-agent-costs"],
  time: "Invoice dated Aug 28 · paid by IYOIYO",
  note: "FJD 1,071.88 in fiscal duty, clearance and agent charges, and service VAT paid by IYOIYO.",
};
delivery.items["dse-unused-sandisk-portable-ssd"].note = "Outside scope: one of two SSDs is allocated to Inowon in Polowat; the other remains in the general outside-scope pool.";
delivery.items["dse-unused-acer-card-readers"].note = "Outside scope: one of two SD card readers is allocated to Inowon in Polowat; the other remains in the general outside-scope pool.";

customs.itemMeta["dse-unused-sandisk-portable-ssd"].recipientAllocation = "One of two units is for Inowon in Polowat.";
customs.itemMeta["dse-unused-acer-card-readers"].recipientAllocation = "One of two units is for Inowon in Polowat.";

customs.checkedOn = "2026-09-03";
customs.archivedOn = "2026-09-03";
customs.archiveReason = "Customs clearance is complete and the imported goods are in Fiji; this filing dataset is retained as an archive and is no longer exposed in production navigation.";

writeJson("data/dse-system.json", system);
writeJson("data/dse-delivery.json", delivery);
writeJson("data/dse-customs.json", customs);

console.log(JSON.stringify({
  solarFiji: { lineItems: solar.items.length, totalFjd: solarFjd, totalUsd: solarUsd },
  suvaHardware: { lineItems: hardware.items.length, totalFjd: hardware.grandTotalFjd, totalUsd: hardware.planningTotalUsd },
  bomRows: system.bom.length,
}, null, 2));
