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
const amazonPath = resolve("private/amazon-orders-through-2026-08-26.json");
const homeDepotPath = resolve("private/home-depot-orders-through-2026-08-23.json");
const ebayPath = resolve("private/ebay-orders-through-2026-08-25.json");
const swappaPath = resolve("private/swappa-orders-through-2026-08-25.json");

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

if (![amazonPath, homeDepotPath, ebayPath, swappaPath].every((candidate) => fs.existsSync(candidate))) {
  if (!fs.existsSync(resolve(outputPath))) {
    throw new Error("Private reconciliation inputs are unavailable and no committed public receipt manifest exists");
  }
  console.log("Private receipt data unavailable; preserved the committed public receipt-reference manifest.");
  process.exit(0);
}

const amazon = readJson("private/amazon-orders-through-2026-08-26.json");
const homeDepot = readJson("private/home-depot-orders-through-2026-08-23.json");
const ebay = readJson("private/ebay-orders-through-2026-08-25.json");
const swappa = readJson("private/swappa-orders-through-2026-08-25.json");
const orders = [
  ...initialOrders,
  ...amazon.orders.map((order) => ({ ...order, supplier: "Amazon" })),
  ...homeDepot.orders.map((order) => ({ ...order, supplier: "Home Depot" })),
  ...ebay.orders.map((order) => ({ ...order, supplier: "eBay" })),
  ...swappa.orders.map((order) => ({ ...order, supplier: "Swappa" })),
].sort((a, b) =>
  a.date.localeCompare(b.date) || a.supplier.localeCompare(b.supplier) || a.receiptFile.localeCompare(b.receiptFile));

const invoices = orders.map((order, index) => ({
  number: index + 1,
  date: order.date,
  filename: order.receiptFile,
  supplier: order.supplier,
}));
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
  if (row.location !== "Import" || !row.procurement.includes("Purchased")) continue;
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
setSingle("dse-breaker-mnedc100", "3622276-5853868");
setSingle("dse-battery-string-breakers", "3622276-5853868");
setSingle("dse-ac-enclosure", "3546485-7664210");
setSingle("dse-mollom-8-way-enclosure-second", "8727607-1295455");
const oldBreakerInvoices = [invoiceMatching("3957253-6148202"), invoiceMatching("4586976-7908250")]
  .filter(Boolean).sort((a, b) => a - b);
if (oldBreakerInvoices.length !== 2) throw new Error("Missing receipts for superseded CHTAIXI B125 breakers");
itemInvoices["dse-b125-chtaixi-unused"] = oldBreakerInvoices;
setSingle("dse-service-return-bus", "9984111-5737060");
setSingle("dse-service-return-bus-spares", "8660524-3929849");

const purchasedWithoutReceipt = system.bom
  .filter((row) => row.location === "Import" && row.procurement.includes("Purchased") && row.totalWeightKg > 0)
  .filter((row) => !itemInvoices[row.id])
  .map((row) => row.id);

writeJson(outputPath, {
  schemaVersion: 1,
  generatedOn: "2026-08-26",
  privacy: "Public PII-free receipt index. Receipt filenames may be committed; source PDFs remain ignored under private/.",
  invoices,
  itemInvoices,
  itemAsins,
  purchasedWithoutReceipt,
});

console.log(JSON.stringify({ invoices: invoices.length, referencedItems: Object.keys(itemInvoices).length, purchasedWithoutReceipt }, null, 2));
