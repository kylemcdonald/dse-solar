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
const priorAmazon = readJson("private/amazon-orders-through-2026-08-26.json");

const newOrders = [
  {
    date: "2026-08-25",
    orderNumber: "111-3438994-8490617",
    receiptFile: "amazon-2026-08-25-order-111-3438994-8490617-dihool-10a-ac-protection.pdf",
    itemsSubtotalUsd: 47.98,
    shippingUsd: 0,
    taxUsd: 4.68,
    grandTotalUsd: 52.66,
    eta: "2026-08-26",
    items: [
      {
        bomId: "dse-ac-rcbo",
        qty: 2,
        item: "DIHOOL 10 A two-pole ground-fault circuit breaker with integrated surge protection",
        asin: "B0CRKNJSRH",
        unitCostUsd: 23.99,
        disposition: "One candidate for AC input and one for AC output; verify every received safety marking before commissioning",
      },
    ],
  },
  {
    date: "2026-08-26",
    orderNumber: "111-2558750-7633865",
    receiptFile: "amazon-2026-08-26-order-111-2558750-7633865-preterminated-battery-cables.pdf",
    itemsSubtotalUsd: 149.34,
    shippingUsd: 0,
    taxUsd: 14.56,
    grandTotalUsd: 163.90,
    eta: "2026-08-27",
    items: [
      {
        bomId: "dse-battery-cable",
        qty: 3,
        item: "Shirbly 1/0 AWG OFC red/black 1.5 ft cable pair with preterminated 3/8 in lugs",
        asin: "B0F93TT9CW",
        unitCostUsd: 23.39,
        disposition: "Fixed-length high-current cable inventory; allocate only after the physical mock-up and terminal-fit check",
      },
      {
        bomId: "dse-battery-cable",
        qty: 2,
        item: "Shirbly 1/0 AWG OFC red/black 2 ft cable pair with preterminated 3/8 in lugs",
        asin: "B0CHS4JBQW",
        unitCostUsd: 26.99,
        disposition: "Fixed-length high-current cable inventory; allocate only after the physical mock-up and terminal-fit check",
      },
      {
        bomId: "dse-shirbly-2awg-cable-pairs",
        qty: 1,
        item: "Shirbly 2 AWG OFC red/black 3 ft cable pair with preterminated 3/8 in lugs",
        asin: "B0CHS3JJ9F",
        unitCostUsd: 25.19,
        disposition: "Purchased cable inventory; integration pending",
      },
    ],
  },
  {
    date: "2026-08-26",
    orderNumber: "111-7124751-6454630",
    receiptFile: "amazon-2026-08-26-order-111-7124751-6454630-2awg-cable-pair.pdf",
    itemsSubtotalUsd: 25.19,
    shippingUsd: 0,
    taxUsd: 2.46,
    grandTotalUsd: 27.65,
    eta: "2026-08-27",
    items: [
      {
        bomId: "dse-shirbly-2awg-cable-pairs",
        qty: 1,
        item: "Shirbly 2 AWG OFC red/black 3 ft cable pair with preterminated 3/8 in lugs",
        asin: "B0CHS3JJ9F",
        unitCostUsd: 25.19,
        disposition: "Purchased cable inventory; integration pending",
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
  ["Order Details.pdf", newOrders[0].receiptFile],
  ["Order Details-3.pdf", newOrders[1].receiptFile],
  ["Order Details-4.pdf", newOrders[2].receiptFile],
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
const removeBom = (id) => {
  const index = system.bom.findIndex((candidate) => candidate.id === id);
  if (index >= 0) system.bom.splice(index, 1);
};
const upsertBom = (row, beforeId = "dse-amazon-promotion") => {
  removeBom(row.id);
  const before = system.bom.findIndex((candidate) => candidate.id === beforeId);
  system.bom.splice(before >= 0 ? before : system.bom.length, 0, {
    ...row,
    totalUsd: row.totalUsd ?? money(row.qty * row.unitCost),
    totalWeightKg: row.totalWeightKg ?? mass(row.qty * row.unitWeightKg),
  });
};

Object.assign(findBom("dse-battery-cable"), {
  item: "Shirbly preterminated 1/0 AWG OFC battery cable pairs · 3/8 in lugs",
  qty: 5,
  unit: "red/black pair",
  unitCost: 24.83,
  totalUsd: 124.15,
  procurement: "Purchased · verify and allocate",
  priority: "Must · physical allocation pending",
  description: "Five fixed-length red/black pairs purchased 26 Aug 2026: 3 × 1.5 ft pairs (ASIN B0F93TT9CW) and 2 × 2 ft pairs (ASIN B0CHS4JBQW), ten individual 1/0 AWG cables and 17 conductor-feet total. The receipt and listing identify flexible OFC copper cable, pre-crimped 3/8 in / M10 closed-end lugs and adhesive heat-shrink; the listing describes tin-plated lugs, not a tinned conductor. Do not represent these as verified UL 1426 marine cable. Inspect conductor material, gauge, crimp quality, lug-hole fit and insulation markings, then allocate them only after the full-size battery/main-junction mock-up. Do not trim strands or drill lugs to force a terminal fit.",
  productUrl: "https://www.amazon.com/dp/B0F93TT9CW",
  specUrl: undefined,
  unitWeightKg: 0.882,
  totalWeightKg: 4.41,
  weightBasis: "retail-listing estimate",
  weightSourceUrl: "https://www.amazon.com/dp/B0F93TT9CW",
  weightNote: "Mixed-length estimate: three 1.5 ft pairs at about 0.91 kg each and two 2 ft pairs at about 0.84 kg each. Weigh the delivered packages for the final shipping declaration.",
});

upsertBom({
  id: "dse-shirbly-2awg-cable-pairs",
  category: "Wiring",
  item: "Shirbly preterminated 2 AWG OFC battery cable pairs · 3 ft · 3/8 in lugs",
  qty: 2,
  unit: "red/black pair",
  unitCost: 25.19,
  currency: "USD",
  location: "Import",
  procurement: "Purchased",
  priority: "Integration pending",
  description: "Two identical three-foot red/black pairs purchased across two 26 Aug 2026 orders, ASIN B0CHS3JJ9F. Each pair contains one red and one black 2 AWG OFC cable with factory-crimped 3/8 in / M10 lugs. Keep unallocated until the next physical-design revision: the SmartSolar uses a screw clamp rather than an M10 stud, so these assemblies are not automatically suitable for the MPPT branch. Verify conductor, insulation, crimp and terminal geometry before assigning them.",
  productUrl: "https://www.amazon.com/dp/B0CHS3JJ9F",
  unitWeightKg: 0.85,
  totalWeightKg: 1.7,
  weightBasis: "length-scaled retail estimate",
  weightSourceUrl: "https://www.amazon.com/dp/B0CHS3JJ9F",
  weightNote: "Estimated at 0.85 kg per three-foot red/black pair from the listed 2 AWG copper area and a shorter-pair retail package weight; weigh received packages before filing.",
});

Object.assign(findBom("dse-ac-rcbo"), {
  item: "DIHOOL 10 A two-pole Type A ground-fault breakers with integrated surge protection",
  qty: 2,
  unit: "ea",
  unitCost: 23.99,
  totalUsd: 47.98,
  procurement: "Purchased · verify received markings",
  priority: "Must · commissioning hold",
  description: "Two units purchased 25 Aug 2026, ASIN B0CRKNJSRH: one candidate for AC input and one for AC output. The order title identifies 10 A, two poles and 120–240 VAC ground-fault protection with an integrated voltage-surge arrester. DIHOOL product-family material advertises Class A 30 mA and 20 kA surge variants, but the exact received model, pole arrangement, 30 mA marking, Type A symbol, formal Type 2 SPD classification, protective-earth terminal, interrupt rating, voltage/frequency suitability and local acceptance must all be confirmed before either unit is commissioned. Keep the older purchased 30 A pair out of service.",
  productUrl: "https://www.amazon.com/dp/B0CRKNJSRH",
  specUrl: "https://www.dihool.net/detail_2674_459",
  unitWeightKg: 0.34,
  totalWeightKg: 0.68,
  weightBasis: "listing",
  weightSourceUrl: "https://www.amazon.com/dp/B0CRKNJSRH",
  weightNote: "Amazon product-family listing reports 0.34 kg per unit; verify the delivered 10 A variant.",
});

const joinfworld = system.bom.find((row) => row.id === "dse-joinfworld-250a-busbars")
  ?? findBom("dse-main-busbars");
Object.assign(findBom("dse-main-busbars"), {
  ...joinfworld,
  id: "dse-main-busbars",
  item: "Joinfworld 250 A four-stud covered positive/negative main busbar pair",
  procurement: "Purchased",
  priority: "Must · selected main buses",
  description: "One red/black covered pair purchased 26 Aug 2026, ASIN B0B2JGKTFN, selected to replace the AMOMD 600 A pair. The invoice title identifies four 3/8 in studs per bar and a 250 A nominal rating. Before installation, verify the received current-path material, continuous-current rating, stud hardware, covers, allowable lug stacking, required conductor count and mounting clearance. The upcoming physical-layout revision must prove that every positive and negative landing fits without unsafe crowding.",
});
removeBom("dse-joinfworld-250a-busbars");
upsertBom({
  id: "dse-amomd-600a-busbars-unused",
  category: "Purchase discrepancy",
  item: "AMOMD 600 A covered red/black busbar pair · not in design",
  qty: 1,
  unit: "pair",
  unitCost: 89.99,
  currency: "USD",
  totalUsd: 89.99,
  location: "Return",
  procurement: "Purchased · remove from project",
  priority: "Not in design",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "Purchased on 20 Aug 2026, ASIN B0DG4WLVT7, but removed from the project BOM/customs/shipping selection when the Joinfworld 250 A pair was chosen. This excluded history row exists only to keep the private purchase record reconcilable until the item is returned or otherwise disposed of.",
  productUrl: "https://www.amazon.com/dp/B0DG4WLVT7",
  unitWeightKg: 1.2,
  totalWeightKg: 1.2,
  weightBasis: "estimate",
  weightNote: "Excluded from Fiji shipping; retained only as purchase history.",
});

const removedIds = [
  "dse-earth-bus-cover",
  "dse-switched-load-breaker",
  "dse-junction-box",
  "dse-ac-install-enclosure",
  "dse-service-spares",
  "dse-switch-accessories",
];
removedIds.forEach(removeBom);

system.revision = "Design R25 · BOM reconciliation 26 Aug 2026";
system.status = "Receipts and import inventory reconciled · physical-layout revision pending";
system.summary = "DSE/Fiji remains based on the canonical electrical graph, with its next physical-layout revision pending. The import BOM now uses the purchased Joinfworld 250 A positive/negative main-bus pair, records five purchased 1/0 AWG cable pairs and two purchased 2 AWG cable pairs, and assigns two purchased DIHOOL 10 A ground-fault/surge devices as the AC-in and AC-out protection candidates subject to received-marking and installer checks. The unselected main/AC enclosure allowances, CHTAIXI B10 branch-breaker purchase, Blue Sea 2719 cover, generic service spares and switch-accessory allowance have been removed from BOM/customs/shipping. The existing schematic geometry is intentionally unchanged until the next physical-design instructions.";
system.budget.note = "Purchased project equipment and reconciled transaction adjustments through 26 Aug 2026 are included. Thirty-four Amazon project receipts are now reconciled. Five Shirbly 1/0 AWG red/black cable pairs, two Shirbly 2 AWG red/black cable pairs and two DIHOOL 10 A AC-protection candidates are recorded at actual transaction value. The Joinfworld 250 A pair is the selected main-bus purchase; the superseded AMOMD pair is excluded from project/customs/shipping totals but retained as return history. Unselected main- and AC-enclosure placeholders and the generic cover, B10 breaker, service-spares and switch-accessory allowances have been removed rather than carried as fictional shipping weight. The next physical-layout revision must allocate the fixed-length cables, confirm busbar landing capacity and select actual enclosures. The MultiPlus Fiji invoice/deposit, donor-funded Ekrano increment, refunds, freight beyond Nadi, panel mounting and labor still require final reconciliation.";
Object.assign(system.batteryCablePlan, {
  conductor: "Purchased Shirbly 1/0 AWG flexible OFC copper cable with pre-crimped 3/8 in / M10 lugs; conductor tinning and UL 1426 status unverified",
  procurement: "Five fixed-length red/black pairs purchased: 3 × 1.5 ft and 2 × 2 ft; ten individual cables and 17 conductor-feet total.",
  purchasedCableCount: 10,
  purchasedTotalLengthFt: 17,
  purchasedWeightLb: 9.72,
  measurementRule: "Do not assign a purchased cable by length alone. Mock up the received DIHOOL breakers, batteries, SmartShunt, Joinfworld buses and MultiPlus; verify every M10 lug landing, bend radius and paired-path length. Several planned terminals require M8 or clamp landings, so use only approved transitions or obtain correctly terminated additional cables. Never trim strands, drill lugs or assume the purchased cable is UL 1426/tinned-marine conductor without received markings.",
});
system.commissioning = system.commissioning.map((instruction) => {
  if (instruction.startsWith("Before ordering the imported heavy-cable set")) {
    return "Before allocating the purchased fixed-length 1/0 AWG cable pairs, bench-check the received DIHOOL 120 A breaker clamps, battery M8 posts, SmartShunt M10 studs, Joinfworld M10-equivalent studs and MultiPlus M8 posts. Build a full-size layout, reject any forced bend or incompatible lug, and procure correctly terminated supplemental assemblies where needed.";
  }
  if (instruction.startsWith("Build the main DIN rail from the canonical graph")) {
    return "Do not build the main DIN rail from the current schematic until the next physical-design revision removes the no-longer-required CHTAIXI B10 position and revalidates the service-branch protection arrangement.";
  }
  if (instruction.startsWith("Reject the purchased Mollom HT-8")) {
    return "Keep the purchased Mollom HT-8 units out of the installed AC assembly unless the next physical revision proves a compliant use. The two purchased DIHOOL 10 A ground-fault/surge units are AC-in and AC-out candidates only after exact 10 A, 30 mA Type A, SPD classification, L/N/PE arrangement, interrupt rating, 230 V / 50 Hz suitability and qualified-installer acceptance are confirmed. No unselected replacement-enclosure allowance remains in the BOM; add only the actual enclosure selected after a 1:1 fit check.";
  }
  return instruction;
});
system.research = system.research.filter((source) => !source.title.includes("AMOMD covered red/black 600 A"));

const unresolvedOrigin = (sourceUrl) => ({
  origin: "",
  originBasis: "unresolved",
  originSourceUrl: sourceUrl,
  originNote: "Confirm manufacturing country from the received product and packaging before filing.",
  originReviewedOn: "2026-08-26",
});
customs.itemMeta["dse-battery-cable"] = {
  make: "Shirbly",
  model: "Preterminated 1/0 AWG OFC battery cable pairs",
  additionalInfo: "3 × 1.5 ft pairs + 2 × 2 ft pairs · red / black · 3/8 in lugs",
  serialRequired: false,
  defaultCondition: "New",
  ...unresolvedOrigin("https://www.amazon.com/dp/B0F93TT9CW"),
};
customs.itemMeta["dse-shirbly-2awg-cable-pairs"] = {
  make: "Shirbly",
  model: "Preterminated 2 AWG OFC battery cable pairs",
  additionalInfo: "2 × 3 ft pairs · red / black · 3/8 in lugs",
  serialRequired: false,
  defaultCondition: "New",
  ...unresolvedOrigin("https://www.amazon.com/dp/B0CHS3JJ9F"),
};
customs.itemMeta["dse-ac-rcbo"] = {
  make: "DIHOOL",
  model: "Two-pole ground-fault breaker with integrated surge protection",
  additionalInfo: "10 A · 120–240 VAC · received safety markings pending",
  origin: "CN",
  originBasis: "manufacturer/listing",
  originSourceUrl: "https://www.amazon.com/dp/B0CRKNJSRH",
  originNote: "The product-family listing identifies DIHOOL ELECTRIC and China; verify the exact received label before filing.",
  originReviewedOn: "2026-08-26",
  serialRequired: false,
  defaultCondition: "New",
};
customs.itemMeta["dse-main-busbars"] = {
  ...(customs.itemMeta["dse-joinfworld-250a-busbars"] ?? customs.itemMeta["dse-main-busbars"]),
  make: "Joinfworld",
  model: "Covered positive/negative main busbar pair",
  additionalInfo: "250 A · four 3/8 in studs per bar · red / black",
};
for (const id of [...removedIds, "dse-joinfworld-250a-busbars", "dse-amomd-600a-busbars-unused"]) {
  delete customs.itemMeta[id];
}
customs.checkedOn = "2026-08-26";

delivery.items["dse-battery-cable"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · Shirbly 1/0 AWG preterminated cable pairs",
  sourceUrl: "https://www.amazon.com/dp/B0F93TT9CW",
  eta: "Arriving Aug 27",
  time: "3 × 1.5 ft pairs + 2 × 2 ft pairs",
  note: "Ten individual M10-lug cables purchased; physical allocation and received-material verification pending.",
};
delivery.items["dse-shirbly-2awg-cable-pairs"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · Shirbly 2 AWG three-foot cable pairs",
  sourceUrl: "https://www.amazon.com/dp/B0CHS3JJ9F",
  eta: "Arriving Aug 27",
  time: "Two red/black pairs across two orders",
  note: "Integration pending; M10 ring ends do not directly match the SmartSolar screw clamp.",
};
delivery.items["dse-ac-rcbo"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · DIHOOL 10 A ground-fault/surge protection",
  sourceUrl: "https://www.amazon.com/dp/B0CRKNJSRH",
  eta: "Arriving Aug 26",
  time: "Two purchased · $23.99 each",
  note: "Assigned as AC-in and AC-out candidates; exact Type A, 30 mA and SPD markings remain a commissioning hold.",
};
delivery.items["dse-main-busbars"] = {
  ...(delivery.items["dse-joinfworld-250a-busbars"] ?? delivery.items["dse-main-busbars"]),
  sourceLabel: "Amazon · selected Joinfworld 250 A main-bus pair",
  note: "Selected positive/negative main buses; verify received construction and landing capacity in the next physical layout.",
};
delivery.items["dse-amomd-600a-busbars-unused"] = {
  amazonStatus: "return",
  sourceLabel: "Amazon · AMOMD pair removed from project",
  sourceUrl: "https://www.amazon.com/dp/B0DG4WLVT7",
  eta: "Do not ship to Fiji",
  time: "Return or dispose outside project",
  note: "Excluded purchase-history row; replaced by the Joinfworld pair.",
};
for (const id of [...removedIds, "dse-joinfworld-250a-busbars"]) delete delivery.items[id];

const newTax = 371.63;
Object.assign(findBom("dse-us-sales-tax"), {
  item: "U.S. sales tax on thirty-four Amazon project receipts",
  unitCost: newTax,
  totalUsd: newTax,
  description: "Actual U.S. sales tax across thirty-four reconciled Amazon project receipts through 26 Aug 2026, including $21.70 on the three cable/protection orders ingested in this revision.",
});
Object.assign(delivery.items["dse-us-sales-tax"], {
  eta: "Paid through Aug 26",
  time: "Thirty-four reconciled project receipts",
  note: `$${newTax.toFixed(2)} combined U.S. sales tax through the latest cable/protection orders.`,
});
delivery.checkedOn = "2026-08-26";

const remapPriorOrderItems = priorAmazon.orders.map((order) => ({
  ...order,
  items: order.items.map((item) => item.asin === "B0B2JGKTFN"
    ? { ...item, bomId: "dse-main-busbars", bomIds: undefined }
    : item.asin === "B0DG4WLVT7"
      ? { ...item, bomId: "dse-amomd-600a-busbars-unused", bomIds: undefined }
      : item),
}));
const allOrders = [...new Map(
  [...remapPriorOrderItems, ...newOrders].map((order) => [order.orderNumber, order]),
).values()].sort((a, b) => a.date.localeCompare(b.date) || a.orderNumber.localeCompare(b.orderNumber));
allOrders.forEach(validateOrder);

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

const receiptManifest = readJson("data/dse-receipts.json");
const requiredReceiptIds = ["dse-battery-cable", "dse-shirbly-2awg-cable-pairs", "dse-ac-rcbo", "dse-main-busbars"];
const missingReferences = requiredReceiptIds.filter((id) => !receiptManifest.itemInvoices[id]?.length);
if (missingReferences.length) throw new Error(`Missing receipt references: ${missingReferences.join(", ")}`);
if (receiptManifest.purchasedWithoutReceipt.length) {
  throw new Error(`Purchased imports without receipts: ${receiptManifest.purchasedWithoutReceipt.join(", ")}`);
}

console.log(JSON.stringify({
  ingestedReceipts: newOrders.length,
  receiptArithmeticValidated: true,
  receiptInvoices: receiptManifest.invoices.length,
  queueEmpty: true,
  purchasedWithoutReceipt: receiptManifest.purchasedWithoutReceipt,
  removedBomRows: removedIds.length,
  selectedMainBusbars: findBom("dse-main-busbars").item,
  newSalesTaxTotalUsd: newTax,
}, null, 2));
