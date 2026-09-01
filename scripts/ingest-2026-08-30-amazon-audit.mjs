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
    orderNumber: "111-2867728-3833823",
    receiptFile: "amazon-2026-08-26-order-111-2867728-3833823-extra-dihool-120a-breaker.pdf",
    itemsSubtotalUsd: 11.99,
    shippingUsd: 0,
    taxUsd: 1.17,
    grandTotalUsd: 13.16,
    eta: "Delivered 2026-08-28",
    items: [{
      bomId: "dse-extra-dihool-120a-breaker",
      qty: 1,
      item: "DIHOOL DZ47X-125-frame non-polarized 120 A single-pole AC/DC breaker",
      asin: "B0BFF7F46Y",
      unitCostUsd: 11.99,
      disposition: "Surplus fourth unit; exclude from the design and decide whether to return or retain as an uninstalled spare",
    }],
  },
  {
    date: "2026-08-26",
    orderNumber: "111-5742285-9167436",
    receiptFile: "amazon-2026-08-26-order-111-5742285-9167436-duplicate-dihool-10a-ac-protection.pdf",
    itemsSubtotalUsd: 47.98,
    shippingUsd: 0,
    taxUsd: 4.68,
    grandTotalUsd: 52.66,
    eta: "Delivered 2026-08-28",
    items: [{
      bomId: "dse-extra-ac-rcbo-pair",
      qty: 2,
      item: "DIHOOL 10 A two-pole ground-fault circuit breaker with integrated surge protection",
      asin: "B0CRKNJSRH",
      unitCostUsd: 23.99,
      disposition: "Exact duplicate of the two selected AC-in/out candidates; exclude from the design and decide whether to return",
    }],
  },
  {
    date: "2026-08-28",
    orderNumber: "111-7441385-7705847",
    receiptFile: "amazon-2026-08-28-order-111-7441385-7705847-kerwinn-10a-shared-services-breaker.pdf",
    itemsSubtotalUsd: 8.99,
    shippingUsd: 0,
    taxUsd: 0.88,
    grandTotalUsd: 9.87,
    eta: "Delivered 2026-08-29",
    items: [{
      bomId: "dse-kerwinn-shared-services-breaker-alternate",
      qty: 1,
      item: "KERWINN 12–110 VDC 10 A single-pole miniature circuit breaker",
      asin: "B0BYSCXBH9",
      unitCostUsd: 8.99,
      disposition: "Unselected alternate for the delayed CHTAIXI B10; do not substitute without received-marking, fault-current, terminal and local-acceptance verification",
    }],
  },
];

const returnEvidence = {
  "111-2349613-5829811": {
    returnStatusFiles: ["amazon-2026-08-24-order-111-2349613-5829811-cable-ferrules-lugs-return-status-2026-08-30.pdf"],
    returns: [
      {
        asin: "B0FMK1W3T5",
        qty: 3,
        status: "Return in transit; refund issued",
        refundUsd: 62.52,
        refundIssuedOn: "2026-08-27",
        disposition: "All three one-foot red/black pairs returned; exclude from available cable inventory",
      },
      {
        asin: "B0GR8WW7J7",
        qty: 1,
        status: "Return complete; refund credited",
        refundUsd: 31.82,
        refundIssuedOn: "2026-08-27",
        refundDestination: "Amazon account balance",
        disposition: "Two-foot red/black pair returned; exclude from available cable inventory",
      },
    ],
  },
  "111-3546485-7664210": {
    returnStatusFiles: ["amazon-2026-08-23-order-111-3546485-7664210-ac-protection-enclosure-return-status-2026-08-30.pdf"],
    returns: [{
      asin: "B0DCN7HK57",
      qty: 2,
      status: "Return in transit; refund issued",
      refundUsd: 57.04,
      refundIssuedOn: "2026-08-26",
      disposition: "Both incompatible 30 A AC-protection assemblies returned; keep out of the installation",
    }],
  },
  "111-9047773-1321830": {
    returnStatusFiles: ["amazon-2026-08-20-order-111-9047773-1321830-cables-busbars-tools-grease-return-status-2026-08-30.pdf"],
    returns: [{
      asin: "B0DG4WLVT7",
      qty: 1,
      status: "Return complete; refund credited",
      refundUsd: 98.76,
      refundIssuedOn: "2026-08-26",
      refundDestination: "Amazon account balance",
      disposition: "Superseded AMOMD busbar pair returned; keep out of the installation and Fiji manifest",
    }],
  },
  "111-9142760-2257055": {
    returnStatusFiles: ["amazon-2026-08-21-order-111-9142760-2257055-ac-breakers-converter-tools-return-status-2026-08-30.pdf"],
    returns: [{
      asin: "B0CSV93CTN",
      qty: 2,
      status: "Two one-unit returns in transit; both refunds issued",
      refundUsd: 35.96,
      refundIssuedOn: "2026-08-26",
      disposition: "Both incompatible 120 V Type AC RCBOs returned; keep out of the installation",
    }],
  },
  "111-0054377-1529833": {
    returnStatusFiles: ["amazon-2026-08-22-order-111-0054377-1529833-victron-mppt-wirebox-mc4-return-status-2026-08-30.pdf"],
    returns: [{
      asin: "B08LBWWV47",
      qty: 1,
      status: "Refund issued; original-payment settlement pending",
      refundUsd: 38.85,
      refundIssuedOn: "2026-08-26",
      expectedSettlementBy: "2026-09-02",
      disposition: "Incompatible MC4 WireBox removed from project inventory; monitor settlement through 2 Sep",
    }],
  },
};

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

const refundTotalUsd = money(Object.values(returnEvidence)
  .flatMap((record) => record.returns)
  .reduce((sum, record) => sum + record.refundUsd, 0));
if (refundTotalUsd !== 324.95) throw new Error(`Unexpected refund total: ${refundTotalUsd}`);

const receiptFiles = [
  ...newOrders.map((order) => order.receiptFile),
  ...Object.values(returnEvidence).flatMap((record) => record.returnStatusFiles),
];
const expectedQueueFiles = new Set(receiptFiles);
const initialQueue = fs.readdirSync(resolve("private/to-process"))
  .filter((name) => name !== ".DS_Store");
const unexpectedQueue = initialQueue.filter((name) => !expectedQueueFiles.has(name));
if (unexpectedQueue.length) {
  throw new Error(`Unreconciled receipt inputs appeared in the queue: ${unexpectedQueue.join(", ")}`);
}
const validatePdf = (absolutePath) => {
  const stat = fs.statSync(absolutePath);
  if (stat.size < 1_000) throw new Error(`Receipt PDF is unexpectedly small: ${absolutePath}`);
  const header = fs.readFileSync(absolutePath, { encoding: "utf8", flag: "r" }).slice(0, 4);
  if (header !== "%PDF") throw new Error(`Receipt input is not a PDF: ${absolutePath}`);
};
for (const receiptFile of receiptFiles) {
  const queued = resolve(path.join("private/to-process", receiptFile));
  const archived = resolve(path.join("private", receiptFile));
  if (fs.existsSync(queued) && fs.existsSync(archived)) {
    throw new Error(`Receipt exists in both queue and archive: ${receiptFile}`);
  }
  const candidate = fs.existsSync(queued) ? queued : archived;
  if (!fs.existsSync(candidate)) throw new Error(`Missing receipt input: ${receiptFile}`);
  validatePdf(candidate);
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

Object.assign(findBom("dse-1-0-battery-cables-1ft"), {
  location: "Return",
  procurement: "Purchased · return in transit · refund issued",
  priority: "Returned · do not import",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "Three one-foot red/black pairs purchased 24 Aug 2026, ASIN B0FMK1W3T5, were all returned. Amazon showed the return in transit and a $62.52 refund issued on 27 Aug 2026. These pairs are purchase/return history only and are not available for installation, shipping or customs.",
});
Object.assign(findBom("dse-1-0-battery-cables-2ft"), {
  location: "Return",
  procurement: "Purchased · returned · refund credited",
  priority: "Returned · do not import",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "One two-foot red/black pair purchased 24 Aug 2026, ASIN B0GR8WW7J7, was returned. Amazon showed the return complete and a $31.82 refund credited to the Amazon account balance on 27 Aug 2026. This pair is purchase/return history only and is not available for installation, shipping or customs.",
});
Object.assign(findBom("dse-chtai-ac-rcbos-rejected"), {
  procurement: "Purchased · return in transit · refund issued",
  priority: "Returned · do not install",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "Two incompatible 120 VAC Type AC units purchased 21 Aug 2026 were returned as two one-unit returns. Amazon showed both returns in transit and two $17.98 refunds issued on 26 Aug 2026 ($35.96 total including tax). Keep them out of the 230 V / 50 Hz Type A installation and Fiji manifest.",
});
Object.assign(findBom("dse-ac-30a-rejected"), {
  procurement: "Purchased · return in transit · refund issued",
  priority: "Returned · do not install",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "Two incompatible 30 A assemblies purchased 23 Aug 2026 were returned because they cannot protect the planned 10 A input lead and outlet circuits. Amazon showed the return in transit and a $57.04 refund issued on 26 Aug 2026, including tax. Keep both de-energized and out of the Fiji manifest.",
});
Object.assign(findBom("dse-mppt-wirebox-mc4-rejected"), {
  procurement: "Purchased · refund issued · settlement pending",
  priority: "Returned · monitor refund through 2 Sep",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "The incompatible SCC950400300 MC4 WireBox purchased 22 Aug 2026 was removed from project inventory. Amazon issued a $38.85 refund on 26 Aug 2026, including tax, and stated that settlement to the original payment method was expected by 2 Sep 2026. Keep it out of the Fiji manifest and verify settlement after that date.",
});
Object.assign(findBom("dse-amomd-600a-busbars-unused"), {
  procurement: "Purchased · returned · refund credited",
  priority: "Returned · not in design",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "The AMOMD 600 A pair purchased 20 Aug 2026, ASIN B0DG4WLVT7, was superseded by the selected Joinfworld pair and returned. Amazon showed the return complete and a $98.76 refund credited to the Amazon account balance on 26 Aug 2026, including tax. Retain this row only as excluded purchase/return history.",
});

upsertBom({
  id: "dse-extra-dihool-120a-breaker",
  category: "Purchase discrepancy",
  item: "Surplus fourth DIHOOL 120 A non-polarized breaker · not in design",
  qty: 1,
  unit: "ea",
  unitCost: 11.99,
  currency: "USD",
  totalUsd: 11.99,
  location: "Return",
  procurement: "Purchased · delivered · return decision pending",
  priority: "Surplus · do not install",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "A fourth B0BFF7F46Y unit was ordered separately on 26 Aug 2026 and delivered 28 Aug. The canonical installation uses exactly three units from order 111-3622276-5853868: two battery-string cutoffs and one SmartSolar cutoff. Do not add this surplus unit to the topology; decide whether to return it or retain it as an explicitly uninstalled spare.",
  productUrl: "https://www.amazon.com/dp/B0BFF7F46Y",
  unitWeightKg: 0.18,
  totalWeightKg: 0.18,
  weightBasis: "estimate",
  weightNote: "Estimated single-pole breaker mass; excluded from shipping pending the return/spare decision.",
});
upsertBom({
  id: "dse-extra-ac-rcbo-pair",
  category: "Purchase discrepancy",
  item: "Duplicate DIHOOL 10 A two-pole ground-fault/surge units · not in design",
  qty: 2,
  unit: "ea",
  unitCost: 23.99,
  currency: "USD",
  totalUsd: 47.98,
  location: "Return",
  procurement: "Purchased · delivered · return decision pending",
  priority: "Exact duplicate · do not install",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "Two B0CRKNJSRH units ordered 26 Aug 2026 and delivered 28 Aug exactly duplicate the two AC-in/out candidates already purchased in order 111-3438994-8490617. The electrical model still uses only the original two candidates, each on the same received-marking and installer-verification hold. Exclude this second pair from the topology and Fiji manifest pending a return decision.",
  productUrl: "https://www.amazon.com/dp/B0CRKNJSRH",
  unitWeightKg: 0.34,
  totalWeightKg: 0.68,
  weightBasis: "listing",
  weightSourceUrl: "https://www.amazon.com/dp/B0CRKNJSRH",
  weightNote: "Product-family listing mass; excluded from shipping pending the return decision.",
});
upsertBom({
  id: "dse-kerwinn-shared-services-breaker-alternate",
  category: "Purchase discrepancy",
  item: "KERWINN 10 A single-pole DC breaker · unselected alternate",
  qty: 1,
  unit: "ea",
  unitCost: 8.99,
  currency: "USD",
  totalUsd: 8.99,
  location: "Return",
  procurement: "Purchased · delivered · selection/return decision pending",
  priority: "Alternate only · commissioning hold",
  accountingGroup: "returns",
  includedInTotal: false,
  description: "One B0BYSCXBH9 unit ordered 28 Aug 2026 and delivered 29 Aug is an alternate for the delayed CHTAIXI B09H4W5HSW shared-services breaker. It is not silently substituted into the canonical model. Before any selection, verify the received DC voltage/polarity markings, B10 curve, interrupt rating, terminal range, torque, temperature derating and local acceptance, then explicitly choose either this unit or the CHTAIXI unit and decide the other's disposition.",
  productUrl: "https://www.amazon.com/dp/B0BYSCXBH9",
  unitWeightKg: 0.1,
  totalWeightKg: 0.1,
  weightBasis: "estimate",
  weightSourceUrl: "https://www.amazon.com/dp/B0BYSCXBH9",
  weightNote: "Estimated miniature-breaker mass; excluded from shipping until an explicit selection is made.",
});

const refundRows = [
  {
    id: "dse-refund-igreely-1-0-cables",
    item: "Amazon refund · returned iGreely 1/0 AWG cable pairs",
    totalUsd: -94.34,
    productUrl: "https://www.amazon.com/dp/B0FMK1W3T5",
    description: "Combined tax-inclusive refund for all three one-foot B0FMK1W3T5 pairs ($62.52) and the one two-foot B0GR8WW7J7 pair ($31.82), issued/credited 27 Aug 2026.",
  },
  {
    id: "dse-refund-dihool-30a-ac-protection",
    item: "Amazon refund · returned DIHOOL 30 A AC-protection pair",
    totalUsd: -57.04,
    productUrl: "https://www.amazon.com/dp/B0DCN7HK57",
    description: "Tax-inclusive refund issued 26 Aug 2026 for both returned B0DCN7HK57 assemblies; Amazon still labeled the physical return in transit on 30 Aug.",
  },
  {
    id: "dse-refund-amomd-600a-busbars",
    item: "Amazon refund · returned AMOMD 600 A busbar pair",
    totalUsd: -98.76,
    productUrl: "https://www.amazon.com/dp/B0DG4WLVT7",
    description: "Tax-inclusive refund credited to the Amazon account balance on 26 Aug 2026 after the B0DG4WLVT7 return completed.",
  },
  {
    id: "dse-refund-chtaixi-ac-rcbos",
    item: "Amazon refund · returned CHTAIXI 120 V Type AC RCBOs",
    totalUsd: -35.96,
    productUrl: "https://www.amazon.com/dp/B0CSV93CTN",
    description: "Two tax-inclusive $17.98 refunds issued 26 Aug 2026 for the two B0CSV93CTN one-unit returns; Amazon still labeled both physical returns in transit on 30 Aug.",
  },
  {
    id: "dse-refund-victron-wirebox-mc4",
    item: "Amazon refund · incompatible Victron MPPT WireBox-XL MC4",
    totalUsd: -38.85,
    productUrl: "https://www.amazon.com/dp/B08LBWWV47",
    description: "Tax-inclusive refund issued 26 Aug 2026 for B08LBWWV47; Amazon stated settlement to the original payment method was expected by 2 Sep 2026.",
  },
];
for (const refund of refundRows) {
  upsertBom({
    ...refund,
    category: "Purchase adjustments",
    qty: 1,
    unit: "refund credit",
    unitCost: refund.totalUsd,
    currency: "USD",
    location: "Return",
    procurement: "Purchased · refund issued",
    priority: "Reference",
    accountingGroup: "returns",
    includedInTotal: false,
    unitWeightKg: 0,
    totalWeightKg: 0,
    weightBasis: "not-applicable",
    weightNote: "Refund adjustment, not a physical item.",
  });
}

Object.assign(findBom("dse-us-sales-tax"), {
  item: "U.S. sales tax on thirty-eight Amazon project receipts",
  unitCost: 379.24,
  totalUsd: 379.24,
  description: "Gross U.S. sales tax across thirty-eight reconciled Amazon project receipts through 28 Aug 2026. The $6.73 increment covers the three newly reconciled orders. Five separate tax-inclusive refund-credit rows preserve the complete purchase/refund transaction trail.",
});

Object.assign(system.batteryCablePlan, {
  conductor: "Purchased Shirbly 1/0 AWG flexible OFC cable assemblies with pre-crimped 3/8 in / M10 lugs; conductor tinning and UL 1426 status unverified",
  procurement: "Five retained fixed-length red/black pairs purchased: 3 × 1.5 ft and 2 × 2 ft; ten individual cables and 17 conductor-feet total. All four iGreely pairs were returned and are excluded from usable inventory.",
  purchasedPairCount: 5,
  purchasedCableCount: 10,
  purchasedTotalLengthFt: 17,
  purchasedWeightLb: 9.72,
});
system.budget.note = "Purchased project equipment and reconciled transaction adjustments through 30 Aug 2026 are included. Thirty-eight Amazon project receipts and Extreme Customs Clearance invoice 00070037 are reconciled. The customs invoice totals FJD 2,808.53 and was paid directly by Seta on behalf of DSE. IYOIYO's Ekrano GX purchase remains charged against the $8,000 Pacific Traditions Society check; Erik Godo's donation reimburses PTS and is attribution only, so it does not reduce IYOIYO's recorded purchases. The Amazon return audit records $324.95 in issued or credited refunds across the iGreely 1/0 cable pairs, DIHOOL 30 A AC-protection pair, AMOMD busbars, CHTAIXI 120 V Type AC RCBOs and incompatible Victron MC4 WireBox; confirm the WireBox refund settles by 2 Sep 2026. The actual imported 1/0 AWG inventory is five Shirbly red/black pairs (ten individual cables and 17 conductor-feet); all four iGreely pairs are returned and excluded. Two Shirbly 2 AWG pairs and two selected DIHOOL 10 A AC-in/out protection units remain recorded at actual transaction value. A separately ordered fourth DIHOOL 120 A breaker and an exact duplicate pair of DIHOOL 10 A AC-protection units are excluded pending return/spare decisions. The delivered KERWINN B10 is an unselected alternate; the selected CHTAIXI B10 order was delayed and not yet shipped as of 30 Aug. The Joinfworld 250 A pair remains the selected main-bus purchase; its supplied covers and required main-positive lug stacking are accepted. The retained layout uses the verified HT-8 cutoff box, requires a larger secondary-services enclosure so its two buses and six-gang panel can share the rear mounting plane, uses exactly three secondary branch-breaker positions, omits a separate 80 A incomer, and records supplemental correctly terminated 1/0 AWG cable as an onsite Fiji purchase. The purchased 302 × 302 × 178 mm shell remains owned but is no longer the installed secondary enclosure. Selected AC and DC protection remain on received-device, AIC and installer-verification holds. The MultiPlus Fiji invoice/deposit, freight beyond Nadi, panel mounting and labor still require final reconciliation.";

const baggage = findBom("dse-baggage");
baggage.description = baggage.description.replace(
  "The imported about 23 ft 1/0 AWG cable set adds about 4.4 kg / 9.8 lb",
  "The retained imported 17 conductor-ft Shirbly 1/0 AWG cable set adds about 4.4 kg / 9.7 lb",
);
system.commissioning = system.commissioning.map((instruction) => {
  if (instruction.startsWith("Allocate the nine purchased fixed-length 1/0 AWG")) {
    return "Allocate the five retained Shirbly fixed-length 1/0 AWG red/black pairs (ten individual cables, 17 conductor-feet) only where received length, conductor markings and lug geometry match the verified route. Do not count the four returned iGreely pairs as inventory. Purchase the remaining correctly terminated red and black 1/0 AWG cable onsite in Fiji, including both MultiPlus feeds. Bench-check the DIHOOL clamps, battery M8 posts, SmartShunt M10 studs, Joinfworld studs and MultiPlus M8 posts; reject any forced bend or incompatible lug.";
  }
  if (instruction.startsWith("Return or exchange the incompatible SCC950400300 / MC4 WireBox")) {
    return "Keep the returned SCC950400300 / MC4 WireBox out of project inventory and confirm its $38.85 refund settles by 2 Sep 2026. Obtain SCC950400210 WireBox-XL Tr for the purchased SmartSolar 150/85-Tr VE.Can, verify both part-number labels and install per Victron's quick guide.";
  }
  return instruction;
});

delivery.items["dse-battery-cable"] = {
  ...delivery.items["dse-battery-cable"],
  note: "This retained receipt row covers all five usable Shirbly pairs: ten individual cables and 17 conductor-feet. The four iGreely pairs were returned and must not be counted. Allocate compatible assemblies onsite and purchase the remaining correctly terminated cable in Fiji.",
};
delivery.items["dse-1-0-battery-cables-1ft"] = {
  amazonStatus: "refund-issued",
  sourceLabel: "Amazon · returned iGreely one-foot cable pairs",
  sourceUrl: "https://www.amazon.com/dp/B0FMK1W3T5",
  eta: "Return in transit as of Aug 30",
  time: "3 of 3 returned · $62.52 refund issued Aug 27",
  note: "Exclude all three pairs from usable inventory, shipping and customs.",
};
delivery.items["dse-1-0-battery-cables-2ft"] = {
  amazonStatus: "return-complete",
  sourceLabel: "Amazon · returned iGreely two-foot cable pair",
  sourceUrl: "https://www.amazon.com/dp/B0GR8WW7J7",
  eta: "Return complete",
  time: "1 of 1 returned · $31.82 credited Aug 27",
  note: "Exclude the pair from usable inventory, shipping and customs.",
};
delivery.items["dse-chtai-ac-rcbos-rejected"] = {
  amazonStatus: "refund-issued",
  sourceLabel: "Amazon · returned CHTAIXI B0CSV93CTN",
  sourceUrl: "https://www.amazon.com/dp/B0CSV93CTN",
  eta: "Two returns in transit as of Aug 30",
  time: "2 of 2 returned · $35.96 refunds issued Aug 26",
  note: "Both one-unit returns are excluded from the installation and Fiji manifest.",
};
delivery.items["dse-ac-30a-rejected"] = {
  amazonStatus: "refund-issued",
  sourceLabel: "Amazon · returned DIHOOL 30 A B0DCN7HK57 pair",
  sourceUrl: "https://www.amazon.com/dp/B0DCN7HK57",
  eta: "Return in transit as of Aug 30",
  time: "2 of 2 returned · $57.04 refund issued Aug 26",
  note: "Both units remain excluded from the installation and Fiji manifest.",
};
delivery.items["dse-mppt-wirebox-mc4-rejected"] = {
  amazonStatus: "refund-issued",
  sourceLabel: "Amazon · returned Victron B08LBWWV47",
  sourceUrl: "https://www.amazon.com/dp/B08LBWWV47",
  eta: "Settlement expected by Sep 2",
  time: "$38.85 refund issued Aug 26",
  note: "Removed from project inventory; confirm the original-payment refund settles by 2 Sep.",
};
delivery.items["dse-amomd-600a-busbars-unused"] = {
  amazonStatus: "return-complete",
  sourceLabel: "Amazon · returned AMOMD B0DG4WLVT7 pair",
  sourceUrl: "https://www.amazon.com/dp/B0DG4WLVT7",
  eta: "Return complete",
  time: "$98.76 credited Aug 26",
  note: "Excluded purchase/return history; replaced by the selected Joinfworld pair.",
};
delivery.items["dse-extra-dihool-120a-breaker"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · surplus fourth DIHOOL 120 A breaker",
  sourceUrl: "https://www.amazon.com/dp/B0BFF7F46Y",
  eta: "Delivered Aug 28",
  time: "1 surplus unit · $11.99 before tax",
  note: "Not in the canonical three-breaker design; return/spare decision pending.",
};
delivery.items["dse-extra-ac-rcbo-pair"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · duplicate DIHOOL 10 A AC-protection pair",
  sourceUrl: "https://www.amazon.com/dp/B0CRKNJSRH",
  eta: "Delivered Aug 28",
  time: "2 duplicate units · $47.98 before tax",
  note: "Exact duplicate of the two selected candidates; return decision pending.",
};
delivery.items["dse-kerwinn-shared-services-breaker-alternate"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · KERWINN 10 A DC-breaker alternate",
  sourceUrl: "https://www.amazon.com/dp/B0BYSCXBH9",
  eta: "Delivered Aug 29",
  time: "1 alternate unit · $8.99 before tax",
  note: "Unselected alternate; do not substitute for the CHTAIXI unit without explicit electrical verification and selection.",
};
delivery.items["dse-switched-load-breaker"] = {
  ...delivery.items["dse-switched-load-breaker"],
  amazonStatus: "delayed",
  eta: "Delayed · not yet shipped as of Aug 30",
  time: "Purchased Aug 26 · $8.99",
  note: "Still the canonical shared-services selection, but not received. The delivered KERWINN unit is tracked separately as an unselected alternate; verify and explicitly select before any substitution.",
};
delivery.items["dse-us-sales-tax"] = {
  ...delivery.items["dse-us-sales-tax"],
  eta: "Paid through Aug 28",
  time: "Thirty-eight reconciled project receipts",
  note: "$379.24 gross U.S. sales tax; tax-inclusive refunds are recorded as five separate credit rows.",
};
for (const refund of refundRows) {
  delivery.items[refund.id] = {
    amazonStatus: "refund-issued",
    sourceLabel: refund.item,
    sourceUrl: refund.productUrl,
    eta: refund.id === "dse-refund-victron-wirebox-mc4" ? "Settlement expected by Sep 2" : "Issued or credited",
    time: `$${Math.abs(refund.totalUsd).toFixed(2)} credit`,
    note: refund.description,
  };
}
delivery.checkedOn = "2026-08-30";

const markExcluded = (id, exclusionReason) => {
  const meta = customs.itemMeta[id];
  if (!meta) throw new Error(`Missing customs metadata for returned item: ${id}`);
  Object.assign(meta, { excludedFromManifest: true, exclusionReason });
};
markExcluded("dse-1-0-battery-cables-1ft", "All three pairs were returned; $62.52 refund issued 27 Aug 2026. Do not import.");
markExcluded("dse-1-0-battery-cables-2ft", "Pair was returned and $31.82 credited 27 Aug 2026. Do not import.");
markExcluded("dse-chtai-ac-rcbos-rejected", "Both units were returned; $35.96 in refunds issued 26 Aug 2026. Do not import.");
markExcluded("dse-ac-30a-rejected", "Both units were returned; $57.04 refund issued 26 Aug 2026. Do not import.");
markExcluded("dse-mppt-wirebox-mc4-rejected", "Item was returned; $38.85 refund issued 26 Aug 2026. Do not import.");
customs.itemMeta["dse-amomd-600a-busbars-unused"] = {
  make: "AMOMD",
  model: "Covered 600 A positive/negative busbar pair",
  additionalInfo: "Returned · not in design",
  origin: "",
  originBasis: "unresolved",
  originSourceUrl: "https://www.amazon.com/dp/B0DG4WLVT7",
  originNote: "Returned outside the import scope; manufacturing country was not required for filing.",
  originReviewedOn: "2026-08-30",
  serialRequired: false,
  defaultCondition: "Returned",
  excludedFromManifest: true,
  exclusionReason: "Return complete and $98.76 credited 26 Aug 2026. Do not import.",
};
customs.itemMeta["dse-extra-dihool-120a-breaker"] = {
  ...customs.itemMeta["dse-battery-string-breakers"],
  model: "DZ47X-125-frame single-pole breaker",
  additionalInfo: "120 A · surplus fourth unit",
  defaultCondition: "New — surplus purchase",
  excludedFromManifest: true,
  exclusionReason: "Not in the canonical three-breaker design; return/spare decision pending.",
};
customs.itemMeta["dse-extra-ac-rcbo-pair"] = {
  ...customs.itemMeta["dse-ac-rcbo"],
  additionalInfo: "10 A · two duplicate units · received markings pending",
  defaultCondition: "New — duplicate purchase",
  excludedFromManifest: true,
  exclusionReason: "Exact duplicate of the selected AC-in/out pair; return decision pending.",
};
customs.itemMeta["dse-kerwinn-shared-services-breaker-alternate"] = {
  make: "KERWINN",
  model: "Single-pole B-curve DC miniature circuit breaker",
  additionalInfo: "10 A · 12–110 VDC · unselected alternate",
  origin: "",
  originBasis: "unresolved",
  originSourceUrl: "https://www.amazon.com/dp/B0BYSCXBH9",
  originNote: "Confirm manufacturing country and all safety markings from the received product before any selection or filing.",
  originReviewedOn: "2026-08-30",
  serialRequired: false,
  defaultCondition: "New — unselected alternate",
  excludedFromManifest: true,
  exclusionReason: "Not selected for the canonical design; verification and return/selection decision pending.",
};
customs.checkedOn = "2026-08-30";

const bomIdByReturnedAsin = new Map([
  ["B0FMK1W3T5", "dse-1-0-battery-cables-1ft"],
  ["B0GR8WW7J7", "dse-1-0-battery-cables-2ft"],
  ["B0CSV93CTN", "dse-chtai-ac-rcbos-rejected"],
  ["B0DCN7HK57", "dse-ac-30a-rejected"],
  ["B08LBWWV47", "dse-mppt-wirebox-mc4-rejected"],
  ["B0DG4WLVT7", "dse-amomd-600a-busbars-unused"],
]);
const auditedPriorOrders = priorAmazon.orders.map((order) => {
  const evidence = returnEvidence[order.orderNumber];
  const items = order.items.map((item) => bomIdByReturnedAsin.has(item.asin)
    ? { ...item, bomId: bomIdByReturnedAsin.get(item.asin), bomIds: undefined }
    : item);
  return { ...order, items, ...(evidence ?? {}) };
});
const allOrders = [...new Map(
  [...auditedPriorOrders, ...newOrders].map((order) => [order.orderNumber, order]),
).values()].sort((first, second) => first.date.localeCompare(second.date)
  || first.orderNumber.localeCompare(second.orderNumber));
allOrders.forEach(validateOrder);
if (allOrders.length !== priorAmazon.orders.length + newOrders.length) {
  throw new Error(`Unexpected Amazon order count: ${allOrders.length}`);
}

writeJson("data/dse-system.json", system);
writeJson("data/dse-delivery.json", delivery);
writeJson("data/dse-customs.json", customs);
writeJson("private/amazon-orders-through-2026-08-30.json", {
  privacy: priorAmazon.privacy,
  scope: "Incremental Amazon orders and project return outcomes through 30 Aug 2026, reconciled without names, addresses or payment details.",
  orders: allOrders,
});

execFileSync(process.execPath, [resolve("scripts/normalize-customs-descriptions.mjs")], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [resolve("scripts/generate-public-receipt-manifest.mjs")], { cwd: root, stdio: "inherit" });

for (const receiptFile of receiptFiles) {
  const queued = resolve(path.join("private/to-process", receiptFile));
  const archived = resolve(path.join("private", receiptFile));
  if (fs.existsSync(queued)) fs.renameSync(queued, archived);
}
const finderMetadata = resolve("private/to-process/.DS_Store");
if (fs.existsSync(finderMetadata)) fs.rmSync(finderMetadata);
const remainingQueue = fs.readdirSync(resolve("private/to-process"));
if (remainingQueue.length) throw new Error(`Receipt queue is not empty: ${remainingQueue.join(", ")}`);

const receiptManifest = readJson("data/dse-receipts.json");
const requiredReceiptIds = [
  "dse-extra-dihool-120a-breaker",
  "dse-extra-ac-rcbo-pair",
  "dse-kerwinn-shared-services-breaker-alternate",
  ...refundRows.map((row) => row.id),
];
const missingReferences = requiredReceiptIds.filter((id) => !receiptManifest.itemInvoices[id]?.length);
if (missingReferences.length) throw new Error(`Missing receipt references: ${missingReferences.join(", ")}`);
if (receiptManifest.purchasedWithoutReceipt.length) {
  throw new Error(`Purchased imports without receipts: ${receiptManifest.purchasedWithoutReceipt.join(", ")}`);
}
const customsInvoice = receiptManifest.invoices.find((invoice) =>
  invoice.filename === "extreme-customs-clearance-2026-08-28-invoice-00070037-drua-sailing.pdf");
if (customsInvoice?.number !== 44) throw new Error("Existing customs receipt reference was renumbered");
if (receiptManifest.invoices.length !== 47) throw new Error(`Unexpected public invoice count: ${receiptManifest.invoices.length}`);

console.log(JSON.stringify({
  auditedOrders: allOrders.length,
  newProjectOrders: newOrders.length,
  documentedRefunds: refundRows.length,
  refundTotalUsd,
  retainedBatteryCablePairs: system.batteryCablePlan.purchasedPairCount,
  grossProjectSalesTaxUsd: findBom("dse-us-sales-tax").totalUsd,
  publicReceiptInvoices: receiptManifest.invoices.length,
  stableCustomsReceiptNumber: customsInvoice.number,
  purchasedWithoutReceipt: receiptManifest.purchasedWithoutReceipt,
  queueEmpty: true,
}, null, 2));
