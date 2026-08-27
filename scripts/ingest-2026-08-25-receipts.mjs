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
const priorAmazon = readJson("private/amazon-orders-through-2026-08-24.json");

const amazonOrders = [
  {
    date: "2026-07-01",
    orderNumber: "113-3097966-7412218",
    receiptFile: "amazon-2026-07-01-order-113-3097966-7412218-takoci-batteries.pdf",
    itemsSubtotalUsd: 32.99,
    shippingUsd: 0,
    taxUsd: 3.22,
    grandTotalUsd: 36.21,
    eta: "Delivered 2026-07-13",
    items: [
      {
        bomId: "dse-personal-takoci-hx870-batteries",
        qty: 1,
        item: "TAKOCI two-battery replacement pack for Standard Horizon HX870/HX870E",
        asin: "B0C7ZQNDFK",
        unitCostUsd: 32.99,
        disposition: "Personal use; outside the solar system and project customs manifest",
      },
    ],
  },
  {
    date: "2026-07-31",
    orderNumber: "113-9991885-2413009",
    receiptFile: "amazon-2026-07-31-order-113-9991885-2413009-garmin-case.pdf",
    itemsSubtotalUsd: 717.96,
    shippingUsd: 0,
    taxUsd: 70,
    grandTotalUsd: 787.96,
    eta: "Delivered 2026-08-01",
    items: [
      {
        bomId: "dse-personal-garmin-montana-710i",
        qty: 1,
        item: "Garmin Montana 710i GPS handheld navigator with inReach",
        asin: "B0DQQVG24P",
        unitCostUsd: 693.97,
        disposition: "Personal use; outside the solar system and project customs manifest; TAF review required",
      },
      {
        bomId: "dse-unused-galaxy-s24-case",
        qty: 1,
        item: "Lanhiem waterproof case for Samsung Galaxy S24",
        asin: "B0CPS8G2XB",
        unitCostUsd: 23.99,
        disposition: "Imported accessory; not used in the solar system",
      },
    ],
  },
  {
    date: "2026-07-31",
    orderNumber: "113-5949244-9850620",
    receiptFile: "amazon-2026-07-31-order-113-5949244-9850620-storage-panels-card-readers.pdf",
    itemsSubtotalUsd: 523.94,
    promotionUsd: -9.7,
    promotionsUsd: [-1.5, -8.2],
    shippingUsd: 2.99,
    freeShippingUsd: -2.99,
    taxUsd: 50.14,
    grandTotalUsd: 564.38,
    eta: "Delivered 2026-07-31",
    items: [
      {
        bomId: "dse-unused-sandisk-portable-ssd",
        qty: 2,
        item: "SanDisk 1 TB Portable SSD, updated-firmware model",
        asin: "B0C5JQ68FY",
        unitCostUsd: 164.99,
        disposition: "Imported storage; not used in the solar system",
      },
      {
        bomId: "dse-personal-flexsolar-panels",
        qty: 2,
        item: "FlexSolar 100 W foldable portable solar panel",
        asin: "B0DX25J31F",
        unitCostUsd: 81.99,
        disposition: "Personal use; outside the fixed solar system and project customs manifest",
      },
      {
        bomId: "dse-unused-acer-card-readers",
        qty: 2,
        item: "Acer three-in-one USB-C SD card reader",
        asin: "B0F1G2HRQ6",
        unitCostUsd: 14.99,
        disposition: "Imported accessory; not used in the solar system",
      },
    ],
  },
];

const ebayOrders = [
  {
    date: "2026-07-04",
    orderNumber: "22-14835-56417",
    receiptFile: "ebay-2026-07-04-order-22-14835-56417-unifi-express.pdf",
    itemsSubtotalUsd: 175,
    shippingUsd: 0,
    taxUsd: 17.06,
    grandTotalUsd: 192.06,
    items: [
      {
        bomId: "dse-router",
        qty: 1,
        item: "Ubiquiti UniFi Express cloud gateway and Wi-Fi 6 access point, UX-US, new in box",
        unitCostUsd: 175,
        disposition: "Installed solar-system network gateway",
      },
    ],
  },
];

const swappaOrders = [
  {
    date: "2026-07-31",
    orderNumber: "SAID17517",
    receiptFile: "swappa-2026-07-31-sale-SAID17517-galaxy-s24.pdf",
    itemsSubtotalUsd: 399.64,
    shippingUsd: 0,
    taxUsd: 38.96,
    grandTotalUsd: 438.6,
    items: [
      {
        bomId: "dse-unused-galaxy-s24-pair",
        qty: 1,
        item: "Samsung Galaxy S24, SM-S921U1, 256 GB, black, unlocked, used-good",
        unitCostUsd: 399.64,
        disposition: "Imported equipment; not used in the solar system",
      },
    ],
  },
  {
    date: "2026-07-31",
    orderNumber: "SAID21905",
    receiptFile: "swappa-2026-07-31-sale-SAID21905-macbook-air.pdf",
    itemsSubtotalUsd: 978.5,
    shippingUsd: 0,
    taxUsd: 95.4,
    grandTotalUsd: 1073.9,
    items: [
      {
        bomId: "dse-unused-macbook-air-15-m4",
        qty: 1,
        item: "Apple 15-inch MacBook Air (M4, 2025), 512 GB, midnight, used-good",
        unitCostUsd: 978.5,
        disposition: "Imported equipment; not used in the solar system",
      },
    ],
  },
  {
    date: "2026-07-31",
    orderNumber: "SAID94445",
    receiptFile: "swappa-2026-07-31-sale-SAID94445-galaxy-s24.pdf",
    itemsSubtotalUsd: 398.61,
    shippingUsd: 0,
    taxUsd: 38.86,
    grandTotalUsd: 437.47,
    items: [
      {
        bomId: "dse-unused-galaxy-s24-pair",
        qty: 1,
        item: "Samsung Galaxy S24, SM-S921U1, 256 GB, black, unlocked, used-good",
        unitCostUsd: 398.61,
        disposition: "Imported equipment; not used in the solar system",
      },
    ],
  },
];

function validateOrder(order) {
  const lineSubtotal = money(order.items.reduce((sum, item) => sum + item.qty * item.unitCostUsd, 0));
  if (lineSubtotal !== order.itemsSubtotalUsd) {
    throw new Error(`${order.orderNumber}: lines ${lineSubtotal} do not match subtotal ${order.itemsSubtotalUsd}`);
  }
  const calculatedGrand = money(
    order.itemsSubtotalUsd + (order.promotionUsd ?? 0) + (order.shippingUsd ?? 0) +
      (order.freeShippingUsd ?? 0) + order.taxUsd,
  );
  if (calculatedGrand !== order.grandTotalUsd) {
    throw new Error(`${order.orderNumber}: arithmetic ${calculatedGrand} does not match total ${order.grandTotalUsd}`);
  }
}

for (const order of [...amazonOrders, ...ebayOrders, ...swappaOrders]) validateOrder(order);

const receiptMoves = [
  ["Order Details-takoci.pdf", amazonOrders[0].receiptFile],
  ["Order Details-garmin.pdf", amazonOrders[1].receiptFile],
  ["Order Details-solar.pdf", amazonOrders[2].receiptFile],
  ["Order details _ eBay.pdf", ebayOrders[0].receiptFile],
  ["swappa.com_sale_SAID17517_invoice.pdf", swappaOrders[0].receiptFile],
  ["swappa.com_sale_SAID21905_invoice.pdf", swappaOrders[1].receiptFile],
  ["swappa.com_sale_SAID94445_invoice.pdf", swappaOrders[2].receiptFile],
];
for (const [sourceName, archivedName] of receiptMoves) {
  const source = resolve(path.join("private/to-process", sourceName));
  const archived = resolve(path.join("private", archivedName));
  if (!fs.existsSync(source) && !fs.existsSync(archived)) throw new Error(`Missing receipt input: ${sourceName}`);
}

const findBom = (id) => {
  const row = system.bom.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing BOM row: ${id}`);
  return row;
};
const upsertBom = (row, beforeId = "dse-amazon-promotion") => {
  const existingIndex = system.bom.findIndex((candidate) => candidate.id === row.id);
  if (existingIndex >= 0) system.bom.splice(existingIndex, 1);
  const beforeIndex = system.bom.findIndex((candidate) => candidate.id === beforeId);
  system.bom.splice(beforeIndex >= 0 ? beforeIndex : system.bom.length, 0, {
    ...row,
    totalUsd: money(row.qty * row.unitCost),
    totalWeightKg: mass(row.qty * row.unitWeightKg),
  });
};

Object.assign(findBom("dse-router"), {
  unitCost: 175,
  totalUsd: 175,
  description: "Purchased new on eBay on 4 Jul 2026. This UX-US is the only item in the 25 Aug receipt batch assigned to the canonical diagram and 3D model. Starlink Ethernet connects to its WAN port; it provides the UniFi Network application and Wi-Fi 6 gateway for the fixed system.",
});

const outsideScope = {
  category: "Additional purchases",
  currency: "USD",
  location: "Import",
  procurement: "Purchased · outside scope",
  priority: "Not used in solar system",
  accountingGroup: "additional",
  includedInTotal: false,
};
const personalUse = {
  category: "Personal items",
  currency: "USD",
  location: "Personal baggage",
  procurement: "Purchased · personal use",
  priority: "Personal use · not part of solar system",
  accountingGroup: "additional",
  includedInTotal: false,
};

const physicalRows = [
  {
    ...personalUse,
    id: "dse-personal-garmin-montana-710i",
    item: "Garmin Montana 710i GPS handheld navigator with inReach",
    qty: 1, unit: "ea", unitCost: 693.97,
    description: "Personal-use item from the 31 Jul 2026 Amazon order. Excluded from the project customs manifest and canonical solar topology. Because it transmits on satellite and 2.4 GHz bands, confirm TAF import/type-approval treatment before travel; personal use does not itself waive radio requirements.",
    productUrl: "https://www.amazon.com/dp/B0DQQVG24P",
    specUrl: "https://www.garmin.com/en-US/p/1436461/",
    unitWeightKg: 0.41,
    weightBasis: "manufacturer",
    weightSourceUrl: "https://support.garmin.com/en-MY/?faq=TV4yJVv7eM3LDCfLjjIxZ7",
    weightNote: "Garmin support lists 410 g with the included lithium-ion battery pack.",
  },
  {
    ...outsideScope,
    id: "dse-unused-galaxy-s24-case",
    item: "Lanhiem waterproof case for Samsung Galaxy S24",
    qty: 1, unit: "ea", unitCost: 23.99,
    description: "Purchased on Amazon on 31 Jul 2026. Additional imported accessory only; it is not a solar-system component and is not referenced by the canonical topology.",
    productUrl: "https://www.amazon.com/dp/B0CPS8G2XB",
    unitWeightKg: 0.056,
    weightBasis: "listing",
    weightSourceUrl: "https://www.amazon.com/dp/B0CPS8G2XB",
    weightNote: "Purchased listing specifies 1.97 oz / 56 g.",
  },
  {
    ...outsideScope,
    id: "dse-unused-sandisk-portable-ssd",
    item: "SanDisk 1 TB Portable SSD",
    qty: 2, unit: "ea", unitCost: 164.99,
    description: "Purchased on Amazon on 31 Jul 2026. Additional imported data storage only; neither drive is used by the fixed solar system or canonical topology.",
    productUrl: "https://www.amazon.com/dp/B0C5JQ68FY",
    specUrl: "https://www.sandisk.com/en-il/products/ssd/external-ssd/sandisk-usb-3-2-ssd?sku=SDSSDE30-1T00-G26",
    unitWeightKg: 0.04,
    weightBasis: "manufacturer",
    weightSourceUrl: "https://www.sandisk.com/en-il/products/ssd/external-ssd/sandisk-usb-3-2-ssd?sku=SDSSDE30-1T00-G26",
    weightNote: "SanDisk lists 40 g per SDSSDE30-1T00-G26 drive.",
  },
  {
    ...personalUse,
    id: "dse-personal-flexsolar-panels",
    item: "FlexSolar 100 W foldable portable solar panels",
    qty: 2, unit: "ea", unitCost: 81.99,
    description: "Personal-use portable panels from the 31 Jul 2026 Amazon order. Excluded from the project customs manifest and from the fixed Suntech array, diagram and 3D model.",
    productUrl: "https://www.amazon.com/dp/B0DX25J31F",
    unitWeightKg: 1.85,
    weightBasis: "listing",
    weightSourceUrl: "https://www.amazon.com/dp/B0DX25J31F",
    weightNote: "Purchased listing specifies 4.1 lb / 1.85 kg per foldable panel.",
  },
  {
    ...outsideScope,
    id: "dse-unused-acer-card-readers",
    item: "Acer three-in-one USB-C SD card readers",
    qty: 2, unit: "ea", unitCost: 14.99,
    description: "Purchased on Amazon on 31 Jul 2026. Additional imported computer accessories only; they are not used by the fixed solar system or canonical topology.",
    productUrl: "https://www.amazon.com/dp/B0F1G2HRQ6",
    unitWeightKg: 0.059,
    weightBasis: "listing",
    weightSourceUrl: "https://www.amazon.com/dp/B0F1G2HRQ6",
    weightNote: "Purchased catalog entry specifies 59 g per reader.",
  },
  {
    ...personalUse,
    id: "dse-personal-takoci-hx870-batteries",
    item: "TAKOCI replacement batteries for Standard Horizon HX870/HX870E",
    qty: 1, unit: "2-battery pack", unitCost: 32.99,
    description: "Personal-use spare lithium-ion battery pack from the 1 Jul 2026 Amazon order. Excluded from the project customs manifest and canonical solar topology. Carry both protected from short circuit in hand baggage and confirm the airline's current spare-battery rules before travel.",
    productUrl: "https://www.amazon.com/dp/B0C7ZQNDFK",
    unitWeightKg: 0.118,
    weightBasis: "listing",
    weightSourceUrl: "https://www.newegg.com/p/3C6-005Y-02648",
    weightNote: "Listing specifies 59 g per 8.14 Wh replacement battery; row weight covers both batteries.",
  },
  {
    ...outsideScope,
    id: "dse-unused-galaxy-s24-pair",
    item: "Samsung Galaxy S24 smartphones",
    qty: 2, unit: "ea", unitCost: 399.125,
    description: "Two unlocked SM-S921U1 256 GB phones purchased used in good condition on separate Swappa invoices. Imported and customs-tracked, but not used by or shown in the solar-system topology.",
    specUrl: "https://www.samsung.com/ph/smartphones/galaxy-s24/specs/",
    unitWeightKg: 0.167,
    weightBasis: "manufacturer",
    weightSourceUrl: "https://www.samsung.com/ph/smartphones/galaxy-s24/specs/",
    weightNote: "Samsung lists 167 g per Galaxy S24 handset.",
  },
  {
    ...outsideScope,
    id: "dse-unused-macbook-air-15-m4",
    item: "Apple 15-inch MacBook Air (M4, 2025)",
    qty: 1, unit: "ea", unitCost: 978.5,
    description: "A 512 GB Midnight MacBook Air purchased used in good condition on Swappa. Imported and customs-tracked, but not used by or shown in the solar-system topology.",
    specUrl: "https://support.apple.com/en-us/122210",
    unitWeightKg: 1.51,
    weightBasis: "manufacturer",
    weightSourceUrl: "https://support.apple.com/en-us/122210",
    weightNote: "Apple lists 1.51 kg for the 15-inch M4 MacBook Air.",
  },
];
for (const row of physicalRows) upsertBom(row);

const adjustmentRows = [
  {
    id: "dse-ebay-sales-tax", category: "Purchase adjustments", item: "eBay sales tax on UniFi Express",
    qty: 1, unit: "order", unitCost: 17.06, currency: "USD", location: "Import", procurement: "Purchased",
    priority: "Reference", description: "Actual sales tax on the 4 Jul 2026 eBay UniFi Express order.",
    unitWeightKg: 0, weightBasis: "not-applicable", weightNote: "Tax adjustment, not a physical item.",
  },
  {
    id: "dse-unused-swappa-sales-tax", category: "Purchase adjustments", item: "Swappa sales tax on outside-scope electronics",
    qty: 1, unit: "lot", unitCost: 173.22, currency: "USD", location: "Import", procurement: "Purchased · outside scope",
    priority: "Reference", accountingGroup: "additional", includedInTotal: false,
    description: "Actual sales tax across the three 31 Jul 2026 Swappa invoices. The associated electronics are not part of the solar system.",
    unitWeightKg: 0, weightBasis: "not-applicable", weightNote: "Tax adjustment, not a physical item.",
  },
  {
    id: "dse-personal-amazon-promotions", category: "Purchase adjustments", item: "Amazon promotions on personal/outside-scope items",
    qty: 1, unit: "lot", unitCost: -9.7, currency: "USD", location: "Personal baggage", procurement: "Purchased · personal use",
    priority: "Reference", accountingGroup: "additional", includedInTotal: false,
    description: "Two order-level promotions on the 31 Jul 2026 mixed personal/outside-scope Amazon order.",
    unitWeightKg: 0, weightBasis: "not-applicable", weightNote: "Monetary adjustment, not a physical item.",
  },
  {
    id: "dse-personal-amazon-sales-tax", category: "Purchase adjustments", item: "Amazon sales tax on personal/outside-scope items",
    qty: 1, unit: "lot", unitCost: 123.36, currency: "USD", location: "Personal baggage", procurement: "Purchased · personal use",
    priority: "Reference", accountingGroup: "additional", includedInTotal: false,
    description: "Actual sales tax across the three newly ingested Amazon orders, whose goods are personal or outside the solar-system scope.",
    unitWeightKg: 0, weightBasis: "not-applicable", weightNote: "Tax adjustment, not a physical item.",
  },
];
for (const row of adjustmentRows) upsertBom(row, "dse-baggage");

const returnUpdates = {
  "dse-chtai-ac-rcbos-rejected": "Purchased 21 Aug 2026. The 120 VAC Type AC units are unsuitable for the 230 V / 50 Hz design and its Type A residual-current requirement. Marked for return; keep out of the installation and exclude from the Fiji import/customs manifest.",
  "dse-ac-30a-rejected": "Purchased 23 Aug 2026. The 30 A overcurrent elements do not protect the planned 10 A input lead and outlet circuits. Marked for return/exchange; keep de-energized and exclude from the Fiji import/customs manifest.",
  "dse-mppt-wirebox-mc4-rejected": "Purchased 22 Aug 2026. SCC950400300 does not fit the purchased 150/85-Tr VE.Can controller. Marked for return; keep unopened and exclude from the Fiji import/customs manifest.",
  "dse-battery-string-breakers-midnite-unused": "Purchased 20 Aug 2026, then superseded in R22 by the selected CHTAIXI B125 candidates. Marked for return; do not model or import them, and retain the row only for purchase/refund accounting.",
  "dse-pv-breakers-32a-rejected": "Purchased 23 Aug 2026. Their 32 A rating exceeds the Suntech module's 25 A maximum series-protection rating. Marked for return/exchange; do not install or import them.",
  "dse-usb-output-breaker": "Purchased 23 Aug 2026 and removed from the R22 USB topology. Marked for return; keep it out of the installed circuit and exclude it from the Fiji import/customs manifest.",
  "dse-starlink-portable-battery-cable": "Purchased portable Starlink Mini battery lead with an inline ATC/ATO holder. It conflicts with the remote-site breaker-first policy and is not part of the fixed system. Marked for return; do not import or connect it.",
};
for (const [id, description] of Object.entries(returnUpdates)) {
  Object.assign(findBom(id), { location: "Return", procurement: "Purchased · return pending", includedInTotal: false, description });
  const meta = customs.itemMeta[id];
  if (!meta) throw new Error(`Missing customs metadata for return item ${id}`);
  meta.excludedFromManifest = true;
  meta.exclusionReason = "Return pending; item will not be imported into Fiji.";
  if (delivery.items[id]) {
    delivery.items[id].amazonStatus = "return-pending";
    delivery.items[id].note = "Marked for return and excluded from the Fiji import/customs manifest.";
  }
}

const unresolvedOrigin = (sourceUrl) => ({
  origin: "",
  originBasis: "unresolved",
  originSourceUrl: sourceUrl,
  originNote: "Confirm manufacturing country from the received label or packaging before filing.",
  originReviewedOn: "2026-08-25",
});
Object.assign(customs.itemMeta, {
  "dse-unused-galaxy-s24-case": {
    make: "Lanhiem", model: "Waterproof case for Galaxy S24", additionalInfo: "IP68 · 6.2 in · light blue",
    serialRequired: false, defaultCondition: "New", ...unresolvedOrigin("https://www.amazon.com/dp/B0CPS8G2XB"),
  },
  "dse-unused-sandisk-portable-ssd": {
    make: "SanDisk", model: "Portable SSD", additionalInfo: "SDSSDE30-1T00-G26 · 1 TB · USB-C · USB 3.2 Gen 2",
    serialRequired: true, defaultCondition: "New", ...unresolvedOrigin("https://www.sandisk.com/en-il/products/ssd/external-ssd/sandisk-usb-3-2-ssd?sku=SDSSDE30-1T00-G26"),
  },
  "dse-unused-acer-card-readers": {
    make: "Acer", model: "Three-in-one USB-C SD card reader", additionalInfo: "ODK4H0 · dual card slots · USB 3.0",
    serialRequired: false, defaultCondition: "New", ...unresolvedOrigin("https://www.amazon.com/dp/B0F1G2HRQ6"),
  },
  "dse-unused-galaxy-s24-pair": {
    make: "Samsung", model: "Galaxy S24", additionalInfo: "SM-S921U1 · 256 GB · black · unlocked",
    serialRequired: true, tafPermitRequired: true, defaultCondition: "Used · good",
    defaultSerials: "RFCWC04EX2V (IMEI 1: 353690625019873; IMEI 2: 354376945019871); RFCWCOXMNKK (IMEI 1: 353690625388534; IMEI 2: 354376945388532)",
    ...unresolvedOrigin("https://www.samsung.com/ph/smartphones/galaxy-s24/specs/"),
  },
  "dse-unused-macbook-air-15-m4": {
    make: "Apple", model: "15-inch MacBook Air (M4, 2025)", additionalInfo: "512 GB · Midnight",
    serialRequired: true, tafPermitRequired: true, defaultCondition: "Used · good",
    defaultSerials: "LKQVK4R7LF; Wi-Fi MAC: 1c:f6:4c:a8:14:70",
    ...unresolvedOrigin("https://support.apple.com/en-us/122210"),
  },
});

const deliveryRows = {
  "dse-router": ["eBay · Ubiquiti UniFi Express UX-US", "Purchased Jul 4 · $175.00", "Receipt reconciled; canonical network gateway."],
  "dse-personal-garmin-montana-710i": ["Amazon · B0DQQVG24P", "Delivered Aug 1", "Personal use; outside project customs. Confirm TAF treatment before travel."],
  "dse-unused-galaxy-s24-case": ["Amazon · B0CPS8G2XB", "Delivered Aug 1", "Imported outside-scope accessory; not in topology."],
  "dse-unused-sandisk-portable-ssd": ["Amazon · B0C5JQ68FY", "Delivered Jul 31", "Imported outside-scope storage; not in topology."],
  "dse-personal-flexsolar-panels": ["Amazon · B0DX25J31F", "Delivered Jul 31", "Personal use; excluded from project customs and topology."],
  "dse-unused-acer-card-readers": ["Amazon · B0F1G2HRQ6", "Delivered Jul 31", "Imported outside-scope accessories; not in topology."],
  "dse-personal-takoci-hx870-batteries": ["Amazon · B0C7ZQNDFK", "Delivered Jul 13", "Personal-use spare lithium batteries; carry protected in hand baggage."],
  "dse-unused-galaxy-s24-pair": ["Swappa · two Galaxy S24 handsets", "Purchased Jul 31", "Imported outside-scope equipment; not in topology."],
  "dse-unused-macbook-air-15-m4": ["Swappa · 15-inch M4 MacBook Air", "Purchased Jul 31", "Imported outside-scope equipment; not in topology."],
};
for (const [id, [sourceLabel, time, note]] of Object.entries(deliveryRows)) {
  const row = findBom(id);
  delivery.items[id] = {
    amazonStatus: "purchased", sourceLabel, ...(row.productUrl ? { sourceUrl: row.productUrl } : {}),
    eta: time.startsWith("Delivered") ? time : "Purchased", time, note,
  };
}
for (const row of adjustmentRows) {
  delivery.items[row.id] = {
    amazonStatus: "not-applicable", sourceLabel: row.item, eta: "Applied", time: "No shipment", note: row.description,
  };
}

const mergeOrders = (prior, additions) => [...new Map(
  [...prior, ...additions].map((order) => [order.orderNumber, order]),
).values()].sort((a, b) => a.date.localeCompare(b.date) || a.orderNumber.localeCompare(b.orderNumber));
const allAmazonOrders = mergeOrders(priorAmazon.orders, amazonOrders);
for (const order of allAmazonOrders) validateOrder(order);
writeJson("private/amazon-orders-through-2026-08-25.json", {
  privacy: priorAmazon.privacy,
  scope: "Incremental Amazon orders after the initial 17 Aug equipment/light purchases, plus personal and outside-scope orders explicitly requested for BOM tracking.",
  orders: allAmazonOrders,
});
writeJson("private/ebay-orders-through-2026-08-25.json", {
  privacy: "Private, PII-free purchase reconciliation derived from receipts. Do not commit; source PDFs contain personal information.",
  scope: "eBay purchases tracked in the DSE BOM.", orders: ebayOrders,
});
writeJson("private/swappa-orders-through-2026-08-25.json", {
  privacy: "Private, PII-free purchase reconciliation derived from receipts. Do not commit; source PDFs contain personal information.",
  scope: "Swappa purchases tracked in the DSE BOM; device serials are intentionally not extracted.", orders: swappaOrders,
});

delivery.checkedOn = "2026-08-25";
customs.checkedOn = "2026-08-25";
writeJson("data/dse-system.json", system);
writeJson("data/dse-delivery.json", delivery);
writeJson("data/dse-customs.json", customs);

for (const [sourceName, archivedName] of receiptMoves) {
  const source = resolve(path.join("private/to-process", sourceName));
  const archived = resolve(path.join("private", archivedName));
  if (fs.existsSync(source)) fs.renameSync(source, archived);
}
const finderMetadata = resolve("private/to-process/.DS_Store");
if (fs.existsSync(finderMetadata)) fs.rmSync(finderMetadata);
const remainingQueue = fs.readdirSync(resolve("private/to-process"));
if (remainingQueue.length) throw new Error(`Receipt queue is not empty: ${remainingQueue.join(", ")}`);

execFileSync(process.execPath, [resolve("scripts/normalize-customs-descriptions.mjs")], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(process.execPath, [resolve("scripts/generate-public-receipt-manifest.mjs")], {
  cwd: root,
  stdio: "inherit",
});
console.log(JSON.stringify({ ingestedReceipts: receiptMoves.length, bomRows: system.bom.length, queueEmpty: true }, null, 2));
