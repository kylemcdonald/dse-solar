import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolve = (relativePath) => path.join(root, relativePath);
const readJson = (relativePath) => JSON.parse(fs.readFileSync(resolve(relativePath), "utf8"));
const writeJson = (relativePath, value) =>
  fs.writeFileSync(resolve(relativePath), `${JSON.stringify(value, null, 2)}\n`);
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const system = readJson("data/dse-system.json");
const delivery = readJson("data/dse-delivery.json");
const customs = readJson("data/dse-customs.json");
const amazon = readJson("private/amazon-orders-through-2026-08-26.json");

const order = {
  date: "2026-08-26",
  orderNumber: "111-8797353-2770618",
  receiptFile: "amazon-2026-08-26-order-111-8797353-2770618-chtaixi-10a-shared-services-breaker.pdf",
  itemsSubtotalUsd: 8.99,
  shippingUsd: 0,
  taxUsd: 0.88,
  // Project cost before the checkout payment instrument was applied. Payment
  // details are deliberately excluded from the PII-free aggregate.
  grandTotalUsd: 9.87,
  eta: "2026-08-27",
  items: [{
    bomId: "dse-switched-load-breaker",
    qty: 1,
    item: "CHTAIXI 12–110 VDC 10 A single-pole miniature circuit breaker",
    asin: "B09H4W5HSW",
    unitCostUsd: 8.99,
    disposition: "Shared switched-services branch breaker; received-label and fault-current verification required before commissioning",
  }],
};

function validateOrder(candidate) {
  const subtotal = money(candidate.items.reduce((sum, item) => sum + item.qty * item.unitCostUsd, 0));
  if (subtotal !== candidate.itemsSubtotalUsd) {
    throw new Error(`${candidate.orderNumber}: line subtotal ${subtotal} != ${candidate.itemsSubtotalUsd}`);
  }
  const total = money(candidate.itemsSubtotalUsd + (candidate.shippingUsd ?? 0)
    + (candidate.freeShippingUsd ?? 0) + (candidate.promotionUsd ?? 0) + candidate.taxUsd);
  if (total !== candidate.grandTotalUsd) {
    throw new Error(`${candidate.orderNumber}: calculated project cost ${total} != ${candidate.grandTotalUsd}`);
  }
}
validateOrder(order);

const sourceReceipt = resolve("private/to-process/Order Details.pdf");
const archivedReceipt = resolve(path.join("private", order.receiptFile));
if (!fs.existsSync(sourceReceipt) && !fs.existsSync(archivedReceipt)) {
  throw new Error("Missing shared-services breaker receipt input");
}

const findBom = (id) => {
  const row = system.bom.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing BOM row: ${id}`);
  return row;
};

Object.assign(findBom("dse-switched-load-breaker"), {
  item: "CHTAIXI 10 A single-pole DC shared switched-services breaker",
  qty: 1,
  unit: "ea",
  unitCost: 8.99,
  totalUsd: 8.99,
  procurement: "Purchased · commissioning verification hold",
  priority: "Must · verify received markings",
  description: "Purchased from Amazon on 26 Aug 2026, ASIN B09H4W5HSW, for the shared lights, Starlink Mini and UniFi branch. The listing identifies a single-pole 10 A thermal-magnetic B-curve breaker for 12–110 VDC and claims IEC 60947-2 compliance and 6 kA breaking capacity. Those listing claims are provisional: before commissioning, confirm the received DC voltage and polarity markings, interrupt rating, terminal range, torque, temperature derating and local acceptance. The known branch load is 60 W in normal use and no more than 100 W from published/user-confirmed device limits plus reserve, so 10 A leaves substantial normal-load headroom while still matching the modeled 10 A branch conductors.",
  productUrl: "https://www.amazon.com/dp/B09H4W5HSW",
  unitWeightKg: 0.1,
  totalWeightKg: 0.1,
  weightBasis: "listing",
  weightSourceUrl: "https://www.amazon.com/dp/B09H4W5HSW",
  weightNote: "Amazon listing item weight of 3.52 oz, converted to approximately 0.10 kg; weigh the received breaker before final filing.",
});

system.budget.note = system.budget.note
  .replace("Thirty-four Amazon project receipts are now reconciled.", "Thirty-five Amazon project receipts are now reconciled.")
  .replace("The generic 10 A shared-services breaker still requires selection.", "The purchased CHTAIXI 10 A shared-services breaker is linked to receipt 43 and remains on a received-marking/AIC commissioning hold.");

const tax = findBom("dse-us-sales-tax");
Object.assign(tax, {
  item: "U.S. sales tax on thirty-five Amazon project receipts",
  unitCost: 372.51,
  totalUsd: 372.51,
  description: "Actual U.S. sales tax across thirty-five reconciled Amazon project receipts through 26 Aug 2026, including $0.88 on the shared-services breaker order. The separate personal/outside-scope tax row remains excluded from the solar-system total.",
});

delivery.items["dse-switched-load-breaker"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · purchased CHTAIXI B10 breaker",
  sourceUrl: "https://www.amazon.com/dp/B09H4W5HSW",
  eta: "Arriving Aug 27",
  time: "Purchased Aug 26 · $8.99",
  note: "Allocated to the shared lights/internet branch. Keep de-energized until the received 12–110 VDC, polarity, 10 A, interrupt, terminal and torque markings are verified.",
};
Object.assign(delivery.items["dse-us-sales-tax"], {
  eta: "Paid through Aug 26",
  time: "Thirty-five reconciled project receipts",
  note: "$372.51 combined U.S. sales tax through the shared-services breaker order.",
});
delivery.checkedOn = "2026-08-26";

customs.itemMeta["dse-switched-load-breaker"] = {
  make: "CHTAIXI",
  model: "Single-pole B-curve DC miniature circuit breaker",
  additionalInfo: "10 A · 12–110 VDC · listing claims 6 kA",
  origin: "CN",
  originBasis: "manufacturer/listing",
  originSourceUrl: "https://www.amazon.com/dp/B09H4W5HSW",
  originNote: "CHTAIXI identifies its manufacturing operation in Zhejiang, China; verify the received product and packaging before filing.",
  originReviewedOn: "2026-08-26",
  serialRequired: false,
  defaultCondition: "New",
};
customs.checkedOn = "2026-08-26";

const allOrders = [...new Map(
  [...amazon.orders, order].map((candidate) => [candidate.orderNumber, candidate]),
).values()].sort((first, second) => first.date.localeCompare(second.date)
  || first.orderNumber.localeCompare(second.orderNumber));
allOrders.forEach(validateOrder);

writeJson("data/dse-system.json", system);
writeJson("data/dse-delivery.json", delivery);
writeJson("data/dse-customs.json", customs);
writeJson("private/amazon-orders-through-2026-08-26.json", {
  privacy: amazon.privacy,
  scope: "Incremental Amazon orders through 26 Aug 2026, reconciled without names, addresses or payment details.",
  orders: allOrders,
});

if (fs.existsSync(sourceReceipt)) fs.renameSync(sourceReceipt, archivedReceipt);
const finderMetadata = resolve("private/to-process/.DS_Store");
if (fs.existsSync(finderMetadata)) fs.rmSync(finderMetadata);
const remainingQueue = fs.readdirSync(resolve("private/to-process"));
if (remainingQueue.length) throw new Error(`Receipt queue is not empty: ${remainingQueue.join(", ")}`);

console.log(JSON.stringify({
  orderNumber: order.orderNumber,
  receiptArithmeticValidated: true,
  projectCostUsd: order.grandTotalUsd,
  taxUsd: order.taxUsd,
  queueEmpty: true,
}, null, 2));
