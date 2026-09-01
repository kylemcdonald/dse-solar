import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolve = (relativePath) => path.join(root, relativePath);
const readJson = (relativePath) => JSON.parse(fs.readFileSync(resolve(relativePath), "utf8"));
const writeJson = (relativePath, value) =>
  fs.writeFileSync(resolve(relativePath), `${JSON.stringify(value, null, 2)}\n`);

const system = readJson("data/dse-system.json");
const outputPath = "data/dse-receipts.json";
const amazonPath = resolve("private/amazon-orders-through-2026-08-30.json");
const homeDepotPath = resolve("private/home-depot-orders-through-2026-08-23.json");
const ebayPath = resolve("private/ebay-orders-through-2026-08-25.json");
const swappaPath = resolve("private/swappa-orders-through-2026-08-25.json");
const customsAgentPath = resolve("private/extreme-customs-clearance-invoices-through-2026-08-28.json");

// The first two receipts predate the private, PII-free reconciliation JSON. This
// public description intentionally contains only the invoice metadata needed by
// the customs manifest; names, addresses, payment details and order totals stay
// in the ignored private source PDFs.
const initialOrders = [
  {
    date: "2026-08-17",
    supplier: "Amazon",
    receiptFile: "amazon-2026-08-17-order-111-1277449-5699436-qhlightlux-lights.pdf",
    bomIds: ["dse-indoor-light", "dse-outdoor-light", "dse-light-spare"],
    items: [],
  },
  {
    date: "2026-08-17",
    supplier: "Amazon",
    receiptFile: "amazon-2026-08-17-order-111-1878550-7816240-victron-equipment.pdf",
    bomIds: ["dse-balancers", "dse-smartsolar", "dse-shunt", "dse-ekrano-gx", "dse-orion-usb-converter"],
    items: [],
  },
];

if (![amazonPath, homeDepotPath, ebayPath, swappaPath, customsAgentPath].every((candidate) => fs.existsSync(candidate))) {
  if (!fs.existsSync(resolve(outputPath))) {
    throw new Error("Private reconciliation inputs are unavailable and no committed public receipt manifest exists");
  }
  console.log("Private receipt data unavailable; preserved the committed public receipt-reference manifest.");
  process.exit(0);
}

const amazon = readJson("private/amazon-orders-through-2026-08-30.json");
const homeDepot = readJson("private/home-depot-orders-through-2026-08-23.json");
const ebay = readJson("private/ebay-orders-through-2026-08-25.json");
const swappa = readJson("private/swappa-orders-through-2026-08-25.json");
const customsAgent = readJson("private/extreme-customs-clearance-invoices-through-2026-08-28.json");
const orders = [
  ...initialOrders,
  ...amazon.orders.map((order) => ({ ...order, supplier: "Amazon" })),
  ...homeDepot.orders.map((order) => ({ ...order, supplier: "Home Depot" })),
  ...ebay.orders.map((order) => ({ ...order, supplier: "eBay" })),
  ...swappa.orders.map((order) => ({ ...order, supplier: "Swappa" })),
  ...customsAgent.invoices.map((invoice) => ({
    ...invoice,
    bomIds: invoice.bomAllocations.map((allocation) => allocation.bomId),
    items: [],
  })),
].sort((a, b) =>
  a.date.localeCompare(b.date) || a.supplier.localeCompare(b.supplier) || a.receiptFile.localeCompare(b.receiptFile));

// Receipt references are durable document identifiers used by the grant report
// and customs filing. Preserve every existing filename-to-number allocation and
// append newly discovered receipts, even when an older purchase is reconciled
// after a newer invoice. This prevents a late Amazon audit from renumbering the
// already-issued receipt archive.
const priorManifest = fs.existsSync(resolve(outputPath)) ? readJson(outputPath) : { invoices: [] };
const priorNumberByFile = new Map((priorManifest.invoices ?? []).map((invoice) => [invoice.filename, invoice.number]));
const priorNumbers = [...priorNumberByFile.values()].filter((number) => Number.isInteger(number) && number > 0);
let nextInvoiceNumber = Math.max(0, ...priorNumbers) + 1;
const invoices = orders.map((order) => ({
  number: priorNumberByFile.get(order.receiptFile) ?? nextInvoiceNumber++,
  date: order.date,
  filename: order.receiptFile,
  supplier: order.supplier,
})).sort((a, b) => a.number - b.number);
if (new Set(invoices.map((invoice) => invoice.number)).size !== invoices.length) {
  throw new Error("Duplicate receipt numbers in the public manifest");
}
const invoiceNumberByFile = new Map(invoices.map((invoice) => [invoice.filename, invoice.number]));
const invoiceNumbersByAsin = new Map();
for (const order of orders) {
  const number = invoiceNumberByFile.get(order.receiptFile);
  for (const item of order.items ?? []) {
    if (!item.asin) continue;
    const numbers = invoiceNumbersByAsin.get(item.asin) ?? [];
    if (!numbers.includes(number)) numbers.push(number);
    invoiceNumbersByAsin.set(item.asin, numbers);
  }
}

const asinsFor = (row) => [...new Set(
  JSON.stringify(row).match(/\bB0[A-Z0-9]{8}\b|\bB[A-Z0-9]{9}\b/g) ?? [],
)];
const itemInvoices = {};
const itemAsins = {};
for (const row of system.bom) {
  const asins = asinsFor(row);
  if (asins.length) itemAsins[row.id] = asins;
  if (!row.procurement.includes("Purchased")) continue;
  const refs = new Set();
  for (const asin of asins) {
    for (const number of invoiceNumbersByAsin.get(asin) ?? []) refs.add(number);
  }
  for (const order of initialOrders) {
    if (order.bomIds.includes(row.id)) refs.add(invoiceNumberByFile.get(order.receiptFile));
  }
  for (const order of orders) {
    const explicitBomIds = new Set([
      ...(order.bomIds ?? []),
      ...(order.items ?? []).flatMap((item) => item.bomId ? [item.bomId] : item.bomIds ?? []),
    ]);
    if (explicitBomIds.has(row.id)) refs.add(invoiceNumberByFile.get(order.receiptFile));
  }
  if (row.id === "dse-ex-starlink") {
    const order = orders.find((candidate) => candidate.supplier === "Home Depot");
    if (order) refs.add(invoiceNumberByFile.get(order.receiptFile));
  }
  if (refs.size) itemInvoices[row.id] = [...refs].sort((a, b) => a - b);
}

// A shared ASIN appears on separate one- and two-breaker orders, and the 2314
// busbar appears on the installed-unit and spare orders. Resolve those known
// invoice allocations without putting order contents or PII into application code.
const invoiceMatching = (needle) => invoices.find((invoice) => invoice.filename.includes(needle))?.number;
const setSingle = (id, needle) => {
  const number = invoiceMatching(needle);
  if (!number) throw new Error(`Missing receipt reference for ${id}: ${needle}`);
  itemInvoices[id] = [number];
};
const setMatching = (id, predicate) => {
  const numbers = invoices.filter(predicate).map((invoice) => invoice.number);
  if (!numbers.length) throw new Error(`Missing receipt references for ${id}`);
  itemInvoices[id] = numbers;
};
setSingle("dse-breaker-mnedc100", "3622276-5853868");
setSingle("dse-battery-string-breakers", "3622276-5853868");
setSingle("dse-extra-dihool-120a-breaker", "2867728-3833823");
setSingle("dse-ac-rcbo", "3438994-8490617");
setSingle("dse-extra-ac-rcbo-pair", "5742285-9167436");
setSingle("dse-kerwinn-shared-services-breaker-alternate", "7441385-7705847");
setSingle("dse-refund-igreely-1-0-cables", "2349613-5829811");
setSingle("dse-refund-dihool-30a-ac-protection", "3546485-7664210");
setSingle("dse-refund-amomd-600a-busbars", "9047773-1321830");
setSingle("dse-refund-chtaixi-ac-rcbos", "9142760-2257055");
setSingle("dse-refund-victron-wirebox-mc4", "0054377-1529833");
setSingle("dse-ac-enclosure", "3546485-7664210");
setSingle("dse-mollom-8-way-enclosure-second", "8727607-1295455");
const oldBreakerInvoices = [invoiceMatching("3957253-6148202"), invoiceMatching("4586976-7908250")]
  .filter(Boolean).sort((a, b) => a - b);
if (oldBreakerInvoices.length !== 2) throw new Error("Missing receipts for superseded CHTAIXI B125 breakers");
itemInvoices["dse-b125-chtaixi-unused"] = oldBreakerInvoices;
setSingle("dse-service-return-bus", "9984111-5737060");
setSingle("dse-service-return-bus-spares", "8660524-3929849");
setSingle("dse-amazon-shipping", "2775226-7205039");
setMatching("dse-home-depot-sales-tax", (invoice) => invoice.supplier === "Home Depot");
setMatching("dse-ebay-sales-tax", (invoice) => invoice.supplier === "eBay");
setMatching("dse-unused-swappa-sales-tax", (invoice) => invoice.supplier === "Swappa");
setMatching("dse-personal-amazon-promotions", (invoice) =>
  invoice.supplier === "Amazon" && invoice.date < "2026-08-17");
setMatching("dse-personal-amazon-sales-tax", (invoice) =>
  invoice.supplier === "Amazon" && invoice.date < "2026-08-17");
setMatching("dse-amazon-promotion", (invoice) =>
  invoice.supplier === "Amazon" && invoice.date >= "2026-08-17");
setMatching("dse-us-sales-tax", (invoice) =>
  invoice.supplier === "Amazon" && invoice.date >= "2026-08-17");

const purchasedWithoutReceipt = system.bom
  .filter((row) => row.location === "Import" && row.procurement.includes("Purchased") && row.totalWeightKg > 0)
  .filter((row) => !itemInvoices[row.id])
  .map((row) => row.id);

writeJson(outputPath, {
  schemaVersion: 1,
  generatedOn: invoices.reduce((latest, invoice) => invoice.date > latest ? invoice.date : latest, "2026-08-28"),
  privacy: "Public PII-free receipt index. Receipt filenames may be committed; source PDFs remain ignored under private/.",
  invoices,
  itemInvoices,
  itemAsins,
  purchasedWithoutReceipt,
});

console.log(JSON.stringify({ invoices: invoices.length, referencedItems: Object.keys(itemInvoices).length, purchasedWithoutReceipt }, null, 2));
