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
    date: "2026-08-26",
    orderNumber: "111-8677249-8379458",
    receiptFile: "amazon-2026-08-26-order-111-8677249-8379458-glands-busbars-enclosure.pdf",
    itemsSubtotalUsd: 80.53,
    shippingUsd: 2.99,
    freeShippingUsd: -2.99,
    taxUsd: 7.85,
    grandTotalUsd: 88.38,
    eta: "2026-08-27 04:00–08:00",
    items: [
      {
        bomId: "dse-airic-npt-cable-glands",
        qty: 1,
        item: "AIRIC 3/4 in NPT waterproof cable-gland set",
        asin: "B0D8VS9ZGF",
        unitCostUsd: 7.99,
        disposition: "Purchased inventory; integration pending",
      },
      {
        bomId: "dse-joinfworld-250a-busbars",
        qty: 1,
        item: "Joinfworld 250 A four-stud positive/negative busbar pair",
        asin: "B0B2JGKTFN",
        unitCostUsd: 21.55,
        disposition: "Purchased inventory; integration pending",
      },
      {
        bomId: "dse-ventilated-ip65-enclosure",
        qty: 1,
        item: "Ventilated IP65 ABS enclosure with mounting panel, 11.9 × 11.9 × 7 in",
        asin: "B0DJNJ53MN",
        unitCostUsd: 50.99,
        disposition: "Purchased inventory; integration pending",
      },
    ],
  },
  {
    date: "2026-08-26",
    orderNumber: "111-8727607-1295455",
    receiptFile: "amazon-2026-08-26-order-111-8727607-1295455-glands-and-din-enclosure.pdf",
    itemsSubtotalUsd: 26.98,
    shippingUsd: 0,
    taxUsd: 2.63,
    grandTotalUsd: 29.61,
    eta: "2026-08-27–2026-08-28",
    items: [
      {
        bomId: "dse-pg11-cable-glands",
        qty: 1,
        item: "Oimyalsi PG11 waterproof nylon cable-gland kit, 25 pack",
        asin: "B0H2V2JNPS",
        unitCostUsd: 8.99,
        disposition: "Purchased inventory; integration pending",
      },
      {
        bomId: "dse-mollom-8-way-enclosure-second",
        qty: 1,
        item: "Mollom HT-8 eight-way MCB distribution enclosure",
        asin: "B09XJZDRNM",
        unitCostUsd: 17.99,
        disposition: "Second purchased unit; integration pending",
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
  ["Order Details-2.pdf", newOrders[0].receiptFile],
  ["Order Details-2-1_1.jpg", newOrders[0].receiptFile.replace(".pdf", "-page-1.jpg")],
  ["Order Details-2-1_2.jpg", newOrders[0].receiptFile.replace(".pdf", "-page-2.jpg")],
  ["Order Details-2-1_3.jpg", newOrders[0].receiptFile.replace(".pdf", "-page-3.jpg")],
  ["Order Details.pdf", newOrders[1].receiptFile],
  ["Order Details-1_1.jpg", newOrders[1].receiptFile.replace(".pdf", "-page-1.jpg")],
  ["Order Details-1_2.jpg", newOrders[1].receiptFile.replace(".pdf", "-page-2.jpg")],
];
for (const [sourceName, archivedName] of receiptMoves) {
  const source = resolve(path.join("private/to-process", sourceName));
  const archived = resolve(path.join("private", archivedName));
  if (!fs.existsSync(source) && !fs.existsSync(archived)) {
    throw new Error(`Missing receipt input: ${sourceName}`);
  }
}

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
const findBom = (id) => {
  const row = system.bom.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing BOM row: ${id}`);
  return row;
};
const importedPending = {
  currency: "USD",
  location: "Import",
  procurement: "Purchased",
  priority: "Integration pending",
};

upsertBom({
  ...importedPending,
  id: "dse-airic-npt-cable-glands",
  category: "Wiring",
  item: "AIRIC 3/4 in NPT waterproof cable-gland set",
  qty: 1, unit: "set", unitCost: 7.99,
  description: "One retail set ordered 26 Aug 2026, ASIN B0D8VS9ZGF. The invoice does not state the piece count or clamping range. Keep unallocated until the enclosure and cable-entry plan is supplied; verify the received thread, cable range, seals and environmental rating before drilling.",
  productUrl: "https://www.amazon.com/dp/B0D8VS9ZGF",
  unitWeightKg: 0.2, weightBasis: "estimate",
  weightNote: "Planning estimate for one retail cable-gland set pending receipt and weighing.",
});
upsertBom({
  ...importedPending,
  id: "dse-joinfworld-250a-busbars",
  category: "DC distribution",
  item: "Joinfworld 250 A four-stud covered positive/negative busbar pair",
  qty: 1, unit: "pair", unitCost: 21.55,
  description: "One red/black pair ordered 26 Aug 2026, ASIN B0B2JGKTFN. The invoice title identifies four 3/8 in studs and a 250 A nominal rating. Keep unallocated pending design instructions; inspect the received current-path material, stud hardware, covers, ratings and mounting clearances before use.",
  productUrl: "https://www.amazon.com/dp/B0B2JGKTFN",
  unitWeightKg: 0.59, weightBasis: "estimate",
  weightNote: "Planning estimate for the covered positive/negative pair pending receipt and weighing.",
});
upsertBom({
  ...importedPending,
  id: "dse-ventilated-ip65-enclosure",
  category: "Mounting",
  item: "Ventilated IP65 ABS electrical enclosure with mounting panel · grey · 11.9 × 11.9 × 7 in",
  qty: 1, unit: "ea", unitCost: 50.99,
  description: "One enclosure ordered 26 Aug 2026, ASIN B0DJNJ53MN. The invoice title identifies an IP65 indoor/outdoor ABS body, ventilated design, cable grommets, mounting panel and nominal 11.9 × 11.9 × 7 in size. Keep unallocated pending design instructions; measure the received usable backplate, depth, vent construction and sealing before assigning equipment or drilling entries.",
  productUrl: "https://www.amazon.com/dp/B0DJNJ53MN",
  unitWeightKg: 2, weightBasis: "estimate",
  weightNote: "Planning estimate for a roughly 12 × 12 × 7 in ABS enclosure and mounting panel pending receipt and weighing.",
});
upsertBom({
  ...importedPending,
  id: "dse-pg11-cable-glands",
  category: "Wiring",
  item: "Oimyalsi PG11 IP68 waterproof nylon cable-gland kit · 25 pack",
  qty: 1, unit: "25-pack", unitCost: 8.99,
  description: "One 25-pack ordered 26 Aug 2026, ASIN B0H2V2JNPS. Keep unallocated pending the enclosure-entry plan; verify the received PG11 thread, cable clamping range, locknuts, seals and IP68 marking before drilling or installation.",
  productUrl: "https://www.amazon.com/dp/B0H2V2JNPS",
  unitWeightKg: 0.28, weightBasis: "estimate",
  weightNote: "Planning estimate for 25 nylon PG11 glands pending receipt and weighing.",
});
upsertBom({
  ...importedPending,
  id: "dse-mollom-8-way-enclosure-second",
  category: "Mounting",
  item: "Mollom HT-8 eight-way MCB distribution enclosure · second unit",
  qty: 1, unit: "ea", unitCost: 17.99,
  description: "A second Mollom eight-way enclosure was ordered 26 Aug 2026, ASIN B09XJZDRNM. It is tracked separately from the 23 Aug unit so the new purchase can be assigned without changing the existing AC-enclosure decision. Keep this unit unallocated until design instructions are supplied; measure the received usable rail, cover and cable-entry space before use.",
  productUrl: "https://www.amazon.com/dp/B09XJZDRNM",
  unitWeightKg: 0.5, weightBasis: "listing",
  weightSourceUrl: "https://www.amazon.com/dp/B09XJZDRNM",
  weightNote: "Amazon listing item weight used for the matching HT-8 enclosure.",
});

const unresolvedOrigin = (sourceUrl) => ({
  origin: "", originBasis: "unresolved", originSourceUrl: sourceUrl,
  originNote: "Confirm the manufacturing country from the received product and packaging before filing.",
  originReviewedOn: "2026-08-26",
});
const metadata = {
  "dse-airic-npt-cable-glands": ["AIRIC", "Waterproof cable-gland set", "3/4 in NPT", "https://www.amazon.com/dp/B0D8VS9ZGF"],
  "dse-joinfworld-250a-busbars": ["Joinfworld", "Covered power-distribution busbar pair", "250 A · four 3/8 in studs · red / black", "https://www.amazon.com/dp/B0B2JGKTFN"],
  "dse-ventilated-ip65-enclosure": ["Unbranded", "Ventilated ABS electrical enclosure", "IP65 · grey cover · 11.9 × 11.9 × 7 in", "https://www.amazon.com/dp/B0DJNJ53MN"],
  "dse-pg11-cable-glands": ["Oimyalsi", "Waterproof nylon cable-gland kit", "PG11 · 25 pack", "https://www.amazon.com/dp/B0H2V2JNPS"],
  "dse-mollom-8-way-enclosure-second": ["Mollom", "HT-8 DIN enclosure", "8-way · integration pending", "https://www.amazon.com/dp/B09XJZDRNM"],
};
for (const [id, [make, model, additionalInfo, sourceUrl]] of Object.entries(metadata)) {
  customs.itemMeta[id] = {
    make, model, additionalInfo, serialRequired: false, defaultCondition: "New",
    ...unresolvedOrigin(sourceUrl),
  };
}

const deliveryRows = {
  "dse-airic-npt-cable-glands": ["Amazon · AIRIC B0D8VS9ZGF", "Overnight Aug 27", "Purchased set; integration pending."],
  "dse-joinfworld-250a-busbars": ["Amazon · Joinfworld B0B2JGKTFN", "Overnight Aug 27", "Purchased positive/negative pair; integration pending."],
  "dse-ventilated-ip65-enclosure": ["Amazon · B0DJNJ53MN", "Overnight Aug 27", "Purchased ABS enclosure; integration pending."],
  "dse-pg11-cable-glands": ["Amazon · Oimyalsi B0H2V2JNPS", "Arriving Aug 27", "Purchased 25-pack; integration pending."],
  "dse-mollom-8-way-enclosure-second": ["Amazon · Mollom B09XJZDRNM", "Arriving Aug 28", "Second purchased enclosure; integration pending."],
};
for (const [id, [sourceLabel, time, note]] of Object.entries(deliveryRows)) {
  delivery.items[id] = {
    amazonStatus: "purchased", sourceLabel, sourceUrl: findBom(id).productUrl,
    eta: "Arriving", time, note,
  };
}

const tax = findBom("dse-us-sales-tax");
Object.assign(tax, {
  item: "U.S. sales tax on thirty-one Amazon project receipts",
  unitCost: 349.93,
  totalUsd: 349.93,
  description: "Actual U.S. sales tax across thirty-one reconciled Amazon project receipts through 26 Aug 2026, including $10.48 on the two unallocated enclosure/distribution orders ingested after the breaker orders.",
});
Object.assign(delivery.items["dse-us-sales-tax"], {
  eta: "Paid through Aug 26", time: "Thirty-one reconciled project receipts",
  note: "$349.93 combined U.S. sales tax through the four 26 Aug orders.",
});

system.budget.note = system.budget.note.replace("Twenty-nine Amazon project receipts", "Thirty-one Amazon project receipts");
const pendingNote = "Five additional electrical items ordered 26 Aug—two gland sets, one 250 A busbar pair and two enclosures—are included in BOM/customs as purchased inventory but remain unallocated until their design integration is specified.";
if (!system.budget.note.includes(pendingNote)) system.budget.note = `${system.budget.note} ${pendingNote}`;
delivery.checkedOn = "2026-08-26";
customs.checkedOn = "2026-08-26";

const mergeOrders = (prior, additions) => [...new Map(
  [...prior, ...additions].map((order) => [order.orderNumber, order]),
).values()].sort((a, b) => a.date.localeCompare(b.date) || a.orderNumber.localeCompare(b.orderNumber));
const allOrders = mergeOrders(priorAmazon.orders, newOrders);
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
const newIds = Object.keys(metadata);
const missingReferences = newIds.filter((id) => !receiptManifest.itemInvoices[id]?.length);
if (missingReferences.length) throw new Error(`Missing receipt references: ${missingReferences.join(", ")}`);

console.log(JSON.stringify({
  ingestedReceipts: newOrders.length,
  ingestedBomRows: newIds.length,
  receiptArithmeticValidated: true,
  receiptInvoices: receiptManifest.invoices.length,
  purchasedWithoutReceipt: receiptManifest.purchasedWithoutReceipt,
  queueEmpty: true,
  bomRows: system.bom.length,
}, null, 2));
