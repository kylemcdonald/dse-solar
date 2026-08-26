import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolve = (relativePath) => path.join(root, relativePath);
const readJson = (relativePath) => JSON.parse(fs.readFileSync(resolve(relativePath), "utf8"));
const writeJson = (relativePath, value) =>
  fs.writeFileSync(resolve(relativePath), `${JSON.stringify(value, null, 2)}\n`);
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const mass = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;

const system = readJson("data/dse-system.json");
const delivery = readJson("data/dse-delivery.json");
const customs = readJson("data/dse-customs.json");
const priorAmazon = readJson("private/amazon-orders-through-2026-08-25.json");

const newOrders = [
  {
    date: "2026-08-26",
    orderNumber: "111-1640261-9329869",
    receiptFile: "amazon-2026-08-26-order-111-1640261-9329869-pv-and-32a-breakers.pdf",
    itemsSubtotalUsd: 46.22,
    shippingUsd: 2.99,
    freeShippingUsd: -2.99,
    taxUsd: 4.52,
    grandTotalUsd: 50.74,
    eta: "2026-08-27 04:00–08:00",
    items: [
      {
        bomId: "dse-pv-string-breakers",
        qty: 2,
        item: "CHTAIXI 2-pole 600 VDC 20 A miniature circuit breaker",
        asin: "B0D4JR95Y4",
        unitCostUsd: 14.12,
        disposition: "One common-trip two-pole breaker per PV string",
      },
      {
        bomIds: ["dse-orion-input-breaker", "dse-chargeit-branch-breaker"],
        qty: 2,
        item: "CHTAIXI 12–110 VDC 32 A single-pole miniature circuit breaker",
        asin: "B09H4X8K1C",
        unitCostUsd: 8.99,
        disposition: "One Orion-input branch breaker and one ChargeIT branch breaker",
      },
    ],
  },
  {
    date: "2026-08-26",
    orderNumber: "111-3622276-5853868",
    receiptFile: "amazon-2026-08-26-order-111-3622276-5853868-dihool-120a-breakers.pdf",
    itemsSubtotalUsd: 35.97,
    shippingUsd: 0,
    taxUsd: 3.51,
    grandTotalUsd: 39.48,
    eta: "2026-08-28",
    items: [
      {
        bomIds: ["dse-battery-string-breakers", "dse-breaker-mnedc100"],
        qty: 3,
        item: "DIHOOL AC/DC non-polarized single-pole 120 A miniature circuit breaker",
        asin: "B0BFF7F46Y",
        unitCostUsd: 11.99,
        disposition: "Two battery-string disconnects and one SmartSolar 24 V disconnect",
      },
    ],
  },
];

function validateOrder(order) {
  const subtotal = money(order.items.reduce((sum, item) => sum + item.qty * item.unitCostUsd, 0));
  if (subtotal !== order.itemsSubtotalUsd) {
    throw new Error(`${order.orderNumber}: line subtotal ${subtotal} != ${order.itemsSubtotalUsd}`);
  }
  const total = money(order.itemsSubtotalUsd + (order.shippingUsd ?? 0)
    + (order.freeShippingUsd ?? 0) + (order.promotionUsd ?? 0) + order.taxUsd);
  if (total !== order.grandTotalUsd) {
    throw new Error(`${order.orderNumber}: calculated total ${total} != ${order.grandTotalUsd}`);
  }
}
newOrders.forEach(validateOrder);

const receiptMoves = [
  ["Order Details-breakers.pdf", newOrders[0].receiptFile],
  ["Order Details-breakers-1_1.jpg", newOrders[0].receiptFile.replace(".pdf", "-page-1.jpg")],
  ["Order Details-breakers-1_2.jpg", newOrders[0].receiptFile.replace(".pdf", "-page-2.jpg")],
  ["Order Details-dihool.pdf", newOrders[1].receiptFile],
  ["Order Details-dihool-1_1.jpg", newOrders[1].receiptFile.replace(".pdf", "-page-1.jpg")],
];
for (const [sourceName, archivedName] of receiptMoves) {
  const source = resolve(path.join("private/to-process", sourceName));
  const archived = resolve(path.join("private", archivedName));
  if (!fs.existsSync(source) && !fs.existsSync(archived)) {
    throw new Error(`Missing receipt input: ${sourceName}`);
  }
}

const findBom = (id) => {
  const row = system.bom.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing BOM row: ${id}`);
  return row;
};
const upsertBom = (row, beforeId = "dse-amazon-promotion") => {
  const existing = system.bom.findIndex((candidate) => candidate.id === row.id);
  if (existing >= 0) system.bom.splice(existing, 1);
  const before = system.bom.findIndex((candidate) => candidate.id === beforeId);
  system.bom.splice(before >= 0 ? before : system.bom.length, 0, {
    ...row,
    totalUsd: money(row.qty * row.unitCost),
    totalWeightKg: mass(row.qty * row.unitWeightKg),
  });
};
const removeBom = (id) => {
  const index = system.bom.findIndex((candidate) => candidate.id === id);
  if (index >= 0) system.bom.splice(index, 1);
};

const commonImported = {
  category: "DC distribution",
  currency: "USD",
  location: "Import",
  procurement: "Purchased",
  priority: "Must",
};
Object.assign(findBom("dse-battery-string-breakers"), {
  item: "DIHOOL DZ47X-125-frame non-polarized 120 A battery-string disconnect breakers",
  qty: 2,
  unitCost: 11.99,
  totalUsd: 23.98,
  procurement: "Purchased",
  priority: "Must · verify received terminals",
  description: "Two of the three DIHOOL non-polarized 120 A breakers ordered 26 Aug 2026, ASIN B0BFF7F46Y. Install one on each 24 V battery-string positive entry in the main junction. The order title identifies AC/DC use and a DZ47X-125 frame; confirm the received 120 A marking, DC interrupt rating, clamp range and torque before terminating 1/0 AWG cable or an approved transition.",
  productUrl: "https://www.amazon.com/dp/B0BFF7F46Y",
  specUrl: undefined,
  unitWeightKg: 0.18,
  totalWeightKg: 0.36,
  weightBasis: "estimate",
  weightNote: "Estimated per single-pole high-current breaker pending receipt and weighing.",
});
Object.assign(findBom("dse-breaker-mnedc100"), {
  item: "DIHOOL DZ47X-125-frame non-polarized 120 A SmartSolar 24 V disconnect breaker",
  qty: 1,
  unitCost: 11.99,
  totalUsd: 11.99,
  procurement: "Purchased",
  priority: "Must · verify received terminals",
  description: "The third DIHOOL non-polarized 120 A breaker ordered 26 Aug 2026, ASIN B0BFF7F46Y, is the SmartSolar battery-side disconnect inside the main junction. Confirm the received 120 A marking, DC interrupt rating, conductor coordination, clamp range and torque before commissioning.",
  productUrl: "https://www.amazon.com/dp/B0BFF7F46Y",
  unitWeightKg: 0.18,
  totalWeightKg: 0.18,
  weightBasis: "estimate",
  weightNote: "Estimated single-pole breaker mass pending receipt and weighing.",
});
Object.assign(findBom("dse-pv-string-breakers"), {
  item: "CHTAIXI two-pole 600 VDC 20 A PV string breakers",
  qty: 2,
  unitCost: 14.12,
  totalUsd: 28.24,
  procurement: "Purchased",
  priority: "Must · verify received markings",
  description: "Two 20 A common-trip two-pole breakers ordered 26 Aug 2026, ASIN B0D4JR95Y4, replacing the incompatible 32 A purchase. One device switches and protects both conductors of each PV string. Verify the exact received 20 A marking, polarity diagram, DC voltage/interrupt rating, cold-Voc margin and local acceptance before use.",
  productUrl: "https://www.amazon.com/dp/B0D4JR95Y4",
  weightSourceUrl: "https://www.amazon.com/dp/B0D4JR95Y4",
});
upsertBom({
  ...commonImported,
  id: "dse-orion-input-breaker",
  item: "CHTAIXI 32 A single-pole Orion input branch breaker",
  qty: 1, unit: "ea", unitCost: 8.99,
  description: "One of two 32 A single-pole DC breakers ordered 26 Aug 2026, ASIN B09H4X8K1C. It sits inside the main junction between the 24 V positive bus and the Orion-Tr Smart 24/12-30 input. Verify received polarity, DC rating, terminal range, conductor ampacity and torque before commissioning.",
  productUrl: "https://www.amazon.com/dp/B09H4X8K1C",
  specUrl: "https://www.victronenergy.com/media/pg/Orion-Tr_Smart_DC-DC_Charger_-_Non-Isolated/en/installation.html",
  unitWeightKg: 0.1, weightBasis: "estimate",
  weightNote: "Estimated single-pole miniature-breaker mass pending receipt and weighing.",
});
upsertBom({
  ...commonImported,
  id: "dse-chargeit-branch-breaker",
  item: "CHTAIXI 32 A single-pole ChargeIT! branch breaker",
  qty: 1, unit: "ea", unitCost: 8.99,
  description: "One of two 32 A single-pole DC breakers ordered 26 Aug 2026, ASIN B09H4X8K1C. It sits inside the main junction and protects the 24 V positive feed to four 75 W ChargeIT! Mini modules (300 W total nameplate; 12.5 A ideal at 24 V). The breaker frame permits up to 768 W at 24 V, subject to conductor, terminal and derating checks.",
  productUrl: "https://www.amazon.com/dp/B09H4X8K1C",
  unitWeightKg: 0.1, weightBasis: "estimate",
  weightNote: "Estimated single-pole miniature-breaker mass pending receipt and weighing.",
});
upsertBom({
  category: "Purchase discrepancy",
  id: "dse-b125-chtaixi-unused",
  item: "CHTAIXI DZ47NZ-125 B125 breakers · superseded by non-polarized DIHOOL devices",
  qty: 3, unit: "ea", unitCost: 11.97, currency: "USD",
  location: "Return", procurement: "Purchased · return pending", priority: "Not in design",
  accountingGroup: "returns", includedInTotal: false,
  description: "Three polarized CHTAIXI B125 breakers purchased on 24 Aug 2026 are superseded by the ordered non-polarized DIHOOL devices. Keep them out of the canonical topology and Fiji import manifest; retain this row and both receipt references until refunds are recorded.",
  productUrl: "https://www.amazon.com/dp/B0B1WC651R",
  unitWeightKg: 0.18, weightBasis: "estimate",
  weightNote: "Estimated mass per single-pole breaker; items are return-pending.",
});
removeBom("dse-breaker-mnepv20");
delete delivery.items["dse-breaker-mnepv20"];
delete customs.itemMeta["dse-breaker-mnepv20"];

Object.assign(findBom("dse-switched-load-breaker"), {
  description: "One 10 A breaker directly on the main 24 V bus protects the combined lights, Starlink and UniFi switched-service group. Its 240 W nominal branch capacity is sufficient for these services; USB charging power uses the separate 32 A branches.",
});
Object.assign(findBom("dse-chargeit-mini-75"), {
  description: "Four modules purchased 21 Aug 2026. A dedicated 32 A breaker in the main junction feeds the 10 AWG positive trunk to module A; positive and negative conductors continue A→B→C→D through explicit three-way joins so each Phoenix terminal receives one field lead. Four 75 W modules total 300 W nameplate, not 375 W. Verify received plug capacity and every splice before energizing.",
});
Object.assign(findBom("dse-orion-usb-converter"), {
  description: `${findBom("dse-orion-usb-converter").description} A dedicated purchased 32 A breaker now protects its 24 V positive input branch inside the main junction.`,
});
Object.assign(findBom("dse-usb-station-wiring"), {
  description: "Allowance for the wall-mounted Orion, two secured socket/145 W charger pairs and four wall-mounted ChargeIT modules. Dedicated 32 A breakers inside the main junction protect the Orion input and ChargeIT positive feed. Orion +OUT/common return still daisy-chain socket A→B; 10 AWG positive/negative conductors and explicit three-way joins serve ChargeIT A→B→C→D. Include wall clips, strain relief, approved splices/terminations and durable labels.",
});

const tax = findBom("dse-us-sales-tax");
Object.assign(tax, {
  item: "U.S. sales tax on twenty-nine Amazon project receipts",
  unitCost: 339.45,
  totalUsd: 339.45,
  description: "Actual U.S. sales tax across twenty-nine reconciled Amazon project receipts through 26 Aug 2026, including $8.03 on the two breaker orders ingested in this revision.",
});

system.schemaVersion = "r25-canonical-graph";
system.revision = "Design R25 · 26 Aug 2026";
system.status = "Canonical graph and receipt reconciliation · commissioning checks open";
system.summary = "DSE/Fiji uses one canonical device–conductor–connection graph for the detailed diagram and routed 3D model. Four 565 W panels feed two purchased 20 A common-trip two-pole PV breakers, comb rails, SPD and disconnect before the SmartSolar. Two battery strings and the SmartSolar battery branch use three ordered non-polarized DIHOOL 120 A breakers. The main DIN rail now has six devices: those three 120 A breakers, the 10 A / 240 W shared switched-service breaker, a 32 A Orion-input breaker and a 32 A ChargeIT branch breaker. The redundant 20 A ordinary-service stage and every selected MidNite product are removed. Four ChargeIT! Mini modules total 300 W and share their protected 24 V branch. The physical wall penetration remains in the installation model but collapses to continuous wires in the schematic; cable breakouts and electrical splits render as bodyless fan junctions.";
const batteryFact = system.keyFacts.find((fact) => fact.label === "Battery switching");
if (batteryFact) Object.assign(batteryFact, { value: "Dual 120 A disconnects", detail: "2 × non-polarized DIHOOL · received checks" });
const usbFact = system.keyFacts.find((fact) => fact.label === "USB charging");
if (usbFact) Object.assign(usbFact, { value: "590 W · 12 ports", detail: "32 A Orion input + 32 A ChargeIT branches" });
system.powerModel.sharedServiceCapacityWatts = 240;
system.powerModel.chargeItNameplateWatts = 300;
system.powerModel.assumptions = system.powerModel.assumptions
  .replace("The requested R22 topology has no USB breakers; use ORION REMOTE H to shut down the daisy-chained 145 W socket branch, and keep both USB supply chains de-energized until their conductor-protection holds are resolved.",
    "R25 adds dedicated 32 A positive-branch breakers for the Orion input and four-module ChargeIT chain. Use ORION REMOTE H to shut down the 145 W socket branch and verify the downstream 12 V harness protection separately.");
system.batteryCablePlan.measurementRule = "Buy only after a 1:1 layout using a received DIHOOL 120 A sample and the auto-sized main junction. Verify the received terminal accepts the selected 1/0 AWG conductor or specify a listed transition; do not trim strands. Place the junction immediately above the battery bank, preserve broad bend radii, keep paired A/B paths equal and confirm every termination before ordering.";
system.batteryCablePlan.assemblies.forEach((assembly) => {
  assembly.from = assembly.from.replaceAll("CHTAIXI B125 125 A", "DIHOOL 120 A");
  assembly.to = assembly.to.replaceAll("CHTAIXI B125 125 A", "DIHOOL 120 A");
});
system.budget.note = system.budget.note
  .replace("through 24 Aug 2026", "through 26 Aug 2026")
  .replace("Twenty-seven Amazon receipts", "Twenty-nine Amazon project receipts");

system.commissioning = system.commissioning.map((instruction) => {
  if (instruction.startsWith("Before ordering the imported heavy-cable set")) {
    return "Before ordering the imported heavy-cable set, bench-check one received DIHOOL 120 A breaker, the SmartShunt and covered busbars; then make a full-size main-junction/battery/MultiPlus layout. Confirm terminal fit without trimming strands and order factory-prepared 1/0 AWG assemblies only after all routes are proven.";
  }
  if (instruction.startsWith("Fit the two selected 125 A CHTAIXI")) {
    return "Fit the two selected non-polarized DIHOOL 120 A battery-string breakers adjacent to their positive entries. Confirm received DC markings, interrupt rating, terminal capacity and torque; land their outputs separately on the covered positive bus and guard all terminals.";
  }
  if (instruction.startsWith("Do not energize either purchased 32 A CHTAIXI device as a Suntech")) {
    return "Use the two purchased 20 A common-trip two-pole CHTAIXI devices as the planned PV string breakers only after received-marking, polarity, cold-Voc, interrupt-rating and local-acceptance checks. Keep the older 32 A pair out of the design and return it.";
  }
  if (instruction.startsWith("With the 24 V bank isolated, make a full-size enclosure")) {
    return "With the 24 V bank isolated, make a full-size enclosure and wall-layout mock-up. The canonical main layout now resolves a 960 × 560 × 240 mm usable envelope and 22 auto-laid-out glands. Select a larger nominal enclosure with at least that usable backplate/depth, mount it directly above the batteries and preserve breaker access, bend radii and guarded terminals.";
  }
  if (instruction.startsWith("Build the main DIN rail from the canonical graph")) {
    return "Build the main DIN rail from the canonical graph in this exact left-to-right order: string A DIHOOL 120 A; string B DIHOOL 120 A; SmartSolar DIHOOL 120 A; shared switched services 10 A / 240 W; Orion input 32 A; ChargeIT branch 32 A.";
  }
  if (instruction.startsWith("Treat both daisy-chained USB supplies as commissioning holds")) {
    return "Verify both purchased 32 A input breakers, their 24 V conductors and every downstream terminal before energizing. Separately confirm how the Orion current-limited 12 V output and retained socket harnesses protect the 12 AWG socket A→B daisy chain.";
  }
  return instruction;
});
system.operatingRules = system.operatingRules.map((rule) => {
  if (rule.includes("four daisy-chained ChargeIT Minis have no remote shutoff")) {
    return "Keep the AC inverter off when no AC loads are required. Use STARLINK + UNIFI to shut down Starlink and UniFi overnight, and use ORION REMOTE H to put the Orion below 1 mA remote-off standby. The four breaker-protected ChargeIT Minis have no remote shutoff; measure their combined idle draw and open their 32 A branch breaker when long-term shutdown is needed.";
  }
  if (rule.includes("selected CHTAIXI devices")) {
    return "Keep both internal 120 A battery-string breakers ON in normal service only after the received DIHOOL devices pass documented DC-rating, interrupt-capacity, terminal and acceptance checks. Switch both OFF after AC loads, MultiPlus, PV and generator charging are shut down. Battery fault energy remains substantial.";
  }
  return rule;
});
system.research = system.research.filter((source) => source.publisher !== "MidNite Solar");

const unresolvedOrigin = (sourceUrl) => ({
  origin: "", originBasis: "unresolved", originSourceUrl: sourceUrl,
  originNote: "Confirm manufacturing country from the received product and packaging before filing.",
  originReviewedOn: "2026-08-26",
});
const chtaixiOrigin = {
  origin: "CN", originBasis: "manufacturer", originSourceUrl: "https://www.chtaixi.com/contact",
  originNote: "CHTAIXI identifies its manufacturing operation in Zhejiang, China; verify the received label before filing.",
  originReviewedOn: "2026-08-26",
};
customs.itemMeta["dse-battery-string-breakers"] = {
  make: "DIHOOL", model: "DZ47X-125-frame non-polarized single-pole breaker", additionalInfo: "120 A · AC/DC",
  serialRequired: false, defaultCondition: "New", ...unresolvedOrigin("https://www.amazon.com/dp/B0BFF7F46Y"),
};
customs.itemMeta["dse-breaker-mnedc100"] = {
  make: "DIHOOL", model: "DZ47X-125-frame non-polarized single-pole breaker", additionalInfo: "120 A · AC/DC",
  serialRequired: false, defaultCondition: "New", ...unresolvedOrigin("https://www.amazon.com/dp/B0BFF7F46Y"),
};
customs.itemMeta["dse-pv-string-breakers"] = {
  make: "CHTAIXI", model: "DZ47NZ-63 two-pole PV breaker", additionalInfo: "600 VDC · 20 A",
  serialRequired: false, defaultCondition: "New", ...chtaixiOrigin,
};
for (const id of ["dse-orion-input-breaker", "dse-chargeit-branch-breaker"]) {
  customs.itemMeta[id] = {
    make: "CHTAIXI", model: "Single-pole DC miniature breaker", additionalInfo: "12–110 VDC · 32 A",
    serialRequired: false, defaultCondition: "New", ...chtaixiOrigin,
  };
}
customs.itemMeta["dse-b125-chtaixi-unused"] = {
  make: "CHTAIXI", model: "DZ47NZ-125 B125 single-pole breaker", additionalInfo: "125 A · return pending",
  serialRequired: false, excludedFromManifest: true,
  exclusionReason: "Superseded and return pending; item will not be imported into Fiji.", ...chtaixiOrigin,
};

const deliveryRows = {
  "dse-battery-string-breakers": ["Amazon · DIHOOL B0BFF7F46Y", "Ordered Aug 26 · two allocated", "Two non-polarized battery-string disconnects; arriving Aug 28."],
  "dse-breaker-mnedc100": ["Amazon · DIHOOL B0BFF7F46Y", "Ordered Aug 26 · one allocated", "SmartSolar battery-side disconnect; arriving Aug 28."],
  "dse-pv-string-breakers": ["Amazon · CHTAIXI B0D4JR95Y4", "Ordered Aug 26 · quantity 2", "Correct 20 A two-pole replacements; overnight ETA."],
  "dse-orion-input-breaker": ["Amazon · CHTAIXI B09H4X8K1C", "Ordered Aug 26 · one allocated", "32 A Orion input branch breaker; overnight ETA."],
  "dse-chargeit-branch-breaker": ["Amazon · CHTAIXI B09H4X8K1C", "Ordered Aug 26 · one allocated", "32 A ChargeIT branch breaker; overnight ETA."],
};
for (const [id, [sourceLabel, time, note]] of Object.entries(deliveryRows)) {
  delivery.items[id] = {
    amazonStatus: "purchased", sourceLabel, sourceUrl: findBom(id).productUrl,
    eta: time.includes("overnight") ? "Overnight" : "Arriving", time, note,
  };
}
delivery.items["dse-b125-chtaixi-unused"] = {
  amazonStatus: "return-pending", sourceLabel: "Amazon · CHTAIXI B0B1WC651R",
  sourceUrl: "https://www.amazon.com/dp/B0B1WC651R", eta: "Return pending",
  time: "Three purchased Aug 24", note: "Superseded by non-polarized DIHOOL breakers; excluded from design and Fiji manifest.",
};
Object.assign(delivery.items["dse-switched-load-breaker"], {
  note: "Direct 10 A / 240 W shared-service branch for lights, Starlink and UniFi; no upstream 20 A stage.",
});
Object.assign(delivery.items["dse-us-sales-tax"], {
  eta: "Paid through Aug 26", time: "Twenty-nine reconciled project receipts",
  note: "$339.45 combined U.S. sales tax through the two 26 Aug breaker orders.",
});

const mergeOrders = (prior, additions) => [...new Map(
  [...prior, ...additions].map((order) => [order.orderNumber, order]),
).values()].sort((a, b) => a.date.localeCompare(b.date) || a.orderNumber.localeCompare(b.orderNumber));
const allOrders = mergeOrders(priorAmazon.orders, newOrders);
for (const order of allOrders) {
  for (const item of order.items ?? []) {
    if (item.asin === "B0B1WC651R") {
      item.bomId = "dse-b125-chtaixi-unused";
      item.disposition = "Superseded by non-polarized DIHOOL breakers; return pending";
    }
  }
  validateOrder(order);
}

delivery.checkedOn = "2026-08-26";
customs.checkedOn = "2026-08-26";
writeJson("data/dse-system.json", system);
writeJson("data/dse-delivery.json", delivery);
writeJson("data/dse-customs.json", customs);
writeJson("private/amazon-orders-through-2026-08-26.json", {
  privacy: priorAmazon.privacy,
  scope: "Incremental Amazon orders through 26 Aug 2026, reconciled without names, addresses or payment details.",
  orders: allOrders,
});

execFileSync(process.execPath, [resolve("scripts/normalize-customs-descriptions.mjs")], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [resolve("scripts/generate-public-receipt-manifest.mjs")], { cwd: root, stdio: "inherit" });

for (const [sourceName, archivedName] of receiptMoves) {
  const source = resolve(path.join("private/to-process", sourceName));
  const archived = resolve(path.join("private", archivedName));
  if (fs.existsSync(source)) fs.renameSync(source, archived);
}
const finderMetadata = resolve("private/to-process/.DS_Store");
if (fs.existsSync(finderMetadata)) fs.rmSync(finderMetadata);
const remainingQueue = fs.readdirSync(resolve("private/to-process"));
if (remainingQueue.length) throw new Error(`Receipt queue is not empty: ${remainingQueue.join(", ")}`);

console.log(JSON.stringify({
  ingestedReceipts: newOrders.length,
  receiptArithmeticValidated: true,
  queueEmpty: true,
  bomRows: system.bom.length,
}, null, 2));
