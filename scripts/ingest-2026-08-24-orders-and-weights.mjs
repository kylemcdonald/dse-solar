import crypto from "node:crypto";
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
const priorAmazon = readJson("private/amazon-orders-through-2026-08-23.json");

const authoritativeUrls = {
  orionSpecifications:
    "https://www.victronenergy.com/media/pg/Orion-Tr_Smart_DC-DC_Charger_-_Non-Isolated/en/specifications.html",
  smartShunt:
    "https://www.victronenergy.com/meters-and-sensors/smart-battery-shunt",
  smartSolarSpecifications:
    "https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_150-70_up_to_250-100_VE.Can/en/technical-specifications.html",
  arrivingInFiji:
    "https://frcs.org.fj/our-services/customs/travellers/visiting-fiji/arriving-in-fiji/",
  customsLicensing:
    "https://frcs.org.fj/our-services/customs/trade-business/customs-license/customs-licence-checklist/",
  everExceedDatasheet: "https://pulsar.kiev.ua/uploads/pdf/ES200-12G.pdf",
  marineFiji: "http://marinefiji.com/",
};

function findBom(id) {
  const row = system.bom.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing BOM row: ${id}`);
  return row;
}

function updateBom(id, changes) {
  const row = findBom(id);
  Object.assign(row, changes);
  const unitsPerUsd = row.currency === "FJD" ? system.currency.fjdPerUsd : 1;
  row.totalUsd = money((row.qty * row.unitCost) / unitsPerUsd);
}

function upsertBom(row, beforeId = "dse-home-depot-sales-tax") {
  const existingIndex = system.bom.findIndex((candidate) => candidate.id === row.id);
  if (existingIndex >= 0) system.bom.splice(existingIndex, 1);
  const beforeIndex = system.bom.findIndex((candidate) => candidate.id === beforeId);
  system.bom.splice(beforeIndex >= 0 ? beforeIndex : system.bom.length, 0, {
    ...row,
    totalUsd: money(
      (row.qty * row.unitCost) / (row.currency === "FJD" ? system.currency.fjdPerUsd : 1),
    ),
  });
}

const newOrders = [
  {
    date: "2026-08-24",
    orderNumber: "111-3474952-7497041",
    receiptFile: "amazon-2026-08-24-order-111-3474952-7497041-grounding-busbar.pdf",
    itemsSubtotalUsd: 13.54,
    shippingUsd: 0,
    taxUsd: 1.32,
    grandTotalUsd: 14.86,
    eta: "2026-08-25",
    items: [
      {
        qty: 1,
        item: "Blue Sea 2306 100 A Mini Grounding BusBar, six-gang",
        asin: "B000K2MA9M",
        unitCostUsd: 13.54,
        disposition: "Purchased candidate PE/bonding bar; final allocation requires terminal-count confirmation",
      },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-7720355-6806603",
    receiptFile: "amazon-2026-08-24-order-111-7720355-6806603-battery-terminal-clamps.pdf",
    itemsSubtotalUsd: 55.16,
    promotionUsd: -4.41,
    shippingUsd: 0,
    taxUsd: 4.96,
    grandTotalUsd: 55.71,
    eta: "2026-08-25",
    items: [
      {
        qty: 4,
        item: "Generic automotive battery terminal connector, two-piece pack",
        asin: "B09T75Z1QR",
        unitCostUsd: 13.79,
        disposition: "Additional purchase/customs only — do not install on EverExceed F-M8 threaded inserts",
      },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-4746944-9349806",
    receiptFile: "amazon-2026-08-24-order-111-4746944-9349806-din-rails.pdf",
    itemsSubtotalUsd: 5.99,
    shippingUsd: 0,
    taxUsd: 0.58,
    grandTotalUsd: 6.57,
    eta: "2026-08-25",
    items: [
      {
        qty: 1,
        item: "mxuteuk 4-inch DIN rail, three-pack",
        asin: "B07RFQGVXG",
        unitCostUsd: 5.99,
      },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-2349613-5829811",
    receiptFile: "amazon-2026-08-24-order-111-2349613-5829811-cable-ferrules-lugs.pdf",
    itemsSubtotalUsd: 260.89,
    shippingUsd: 0,
    taxUsd: 25.44,
    grandTotalUsd: 286.33,
    eta: "2026-08-25 to 2026-08-26",
    items: [
      { qty: 1, item: "Preciva 800-piece twin-wire ferrule kit", asin: "B0DS61TQF8", unitCostUsd: 16.99 },
      { qty: 1, item: "Glarks 65-piece heavy copper lug assortment", asin: "B07LBQYGK6", unitCostUsd: 12.99 },
      { qty: 3, item: "iGreely 1/0 AWG one-foot red/black cable pair", asin: "B0FMK1W3T5", unitCostUsd: 18.99 },
      { qty: 1, item: "iGreely 10 AWG red/black wire, 30 ft", asin: "B08HSC5NW5", unitCostUsd: 35.99 },
      { qty: 1, item: "2 AWG five-foot red + five-foot black cable pair", asin: "B0DTNX7S3S", unitCostUsd: 39.99 },
      { qty: 1, item: "iGreely 1/0 AWG two-foot red/black cable pair", asin: "B0GR8WW7J7", unitCostUsd: 28.99 },
      { qty: 1, item: "14 AWG 25-foot red + 25-foot black wire pair", asin: "B0DTPC2RFJ", unitCostUsd: 19.99 },
      { qty: 1, item: "iGreely 6 AWG red/black wire, 10 ft", asin: "B09BFW8NB1", unitCostUsd: 29.99 },
      { qty: 1, item: "18 AWG 50-foot red + 50-foot black wire pair", asin: "B0G6D5GPNH", unitCostUsd: 18.99 },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-0039636-2784221",
    receiptFile: "amazon-2026-08-24-order-111-0039636-2784221-electrical-tools-terminations.pdf",
    itemsSubtotalUsd: 160.61,
    shippingUsd: 2.99,
    freeShippingUsd: -2.99,
    taxUsd: 15.66,
    grandTotalUsd: 176.27,
    eta: "2026-08-25",
    items: [
      { qty: 1, item: "Klein Tools 11061 self-adjusting wire stripper/cutter", asin: "B00CXKOEQ6", unitCostUsd: 22.96 },
      { qty: 1, item: "iGreely 8 AWG red/black wire, 10 ft", asin: "B093R538JV", unitCostUsd: 19.75 },
      { qty: 1, item: "Ferrule crimper with 1,800-piece ferrule kit", asin: "B0DRJ9CDNG", unitCostUsd: 14.99 },
      { qty: 1, item: "TICONN 100-piece insulated spade-terminal kit", asin: "B08BZ972B5", unitCostUsd: 9.95 },
      { qty: 1, item: "RED WOLF 20-piece 8 AWG, 5/16-inch ring-lug kit", asin: "B0FNWQ1H4P", unitCostUsd: 16.99 },
      { qty: 1, item: "50-piece heavy copper-lug assortment", asin: "B089K2RFN1", unitCostUsd: 30.99 },
      { qty: 1, item: "Mutt Tools 10-inch cable cutters", asin: "B099C1DSTQ", unitCostUsd: 17.99 },
      { qty: 1, item: "haisstronica 330-piece ring/fork terminal kit", asin: "B09YCRNGP9", unitCostUsd: 26.99 },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-8660524-3929849",
    receiptFile: "amazon-2026-08-24-order-111-8660524-3929849-service-busbars.pdf",
    itemsSubtotalUsd: 32.7,
    shippingUsd: 0,
    taxUsd: 3.18,
    grandTotalUsd: 35.88,
    items: [
      { qty: 2, item: "Blue Sea 2314 covered 100 A MiniBus", asin: "B000OTJ89Q", unitCostUsd: 16.35 },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-3957253-6148202",
    receiptFile: "amazon-2026-08-24-order-111-3957253-6148202-smartsolar-b125-breaker.pdf",
    itemsSubtotalUsd: 11.97,
    shippingUsd: 0,
    taxUsd: 1.17,
    grandTotalUsd: 13.14,
    items: [
      {
        qty: 1,
        item: "CHTAIXI DZ47NZ-125 B125 125 A single-pole DC breaker",
        asin: "B0B1WC651R",
        unitCostUsd: 11.97,
        disposition: "SmartSolar branch candidate; installation hold remains",
      },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-4586976-7908250",
    receiptFile: "amazon-2026-08-24-order-111-4586976-7908250-battery-b125-breakers-paint-markers.pdf",
    itemsSubtotalUsd: 37.92,
    shippingUsd: 2.99,
    freeShippingUsd: -2.99,
    taxUsd: 3.7,
    grandTotalUsd: 41.62,
    items: [
      {
        qty: 2,
        item: "CHTAIXI DZ47NZ-125 B125 125 A single-pole DC breaker",
        asin: "B0B1WC651R",
        unitCostUsd: 11.97,
        disposition: "Battery-string candidates; installation hold remains",
      },
      { qty: 1, item: "Black oil-based paint-marker two-pack", asin: "B0BLYTMLZN", unitCostUsd: 6.99 },
      { qty: 1, item: "White oil-based paint-marker two-pack", asin: "B0BK81BSJJ", unitCostUsd: 6.99 },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-8048902-1196269",
    receiptFile: "amazon-2026-08-24-order-111-8048902-1196269-mc4-connector-kit.pdf",
    itemsSubtotalUsd: 8.99,
    shippingUsd: 0,
    taxUsd: 0.88,
    grandTotalUsd: 9.87,
    items: [
      { qty: 1, item: "MUYI 22-piece MC4 connector kit", asin: "B0B17FXXL7", unitCostUsd: 8.99 },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-3979619-2780226",
    receiptFile: "amazon-2026-08-24-order-111-3979619-2780226-type-i-notebook-power-cord.pdf",
    itemsSubtotalUsd: 8.99,
    shippingUsd: 0,
    taxUsd: 0.88,
    grandTotalUsd: 9.87,
    items: [
      {
        qty: 1,
        item: "Cable Leader 6 ft AS/NZS 3112 Type I to IEC C5 notebook cord",
        asin: "B074F4959C",
        unitCostUsd: 8.99,
        disposition: "Additional purchase/customs only — portable notebook cord, not the fixed trailing outlet",
      },
    ],
  },
  {
    date: "2026-08-24",
    orderNumber: "111-8905768-7147433",
    receiptFile: "amazon-2026-08-24-order-111-8905768-7147433-shelf-brackets.pdf",
    itemsSubtotalUsd: 12.99,
    shippingUsd: 0,
    taxUsd: 1.27,
    grandTotalUsd: 14.26,
    items: [
      {
        qty: 1,
        item: "Eight-piece shelf-bracket set",
        asin: "B0D8T2XBBL",
        unitCostUsd: 12.99,
        disposition: "Additional purchase/customs; mounting stock not yet allocated to the electrical installation",
      },
    ],
  },
  {
    date: "2026-08-23",
    orderNumber: "111-0348737-9573002",
    receiptFile: "amazon-2026-08-23-order-111-0348737-9573002-laptop-sleeve.pdf",
    itemsSubtotalUsd: 62,
    shippingUsd: 0,
    taxUsd: 6.05,
    grandTotalUsd: 68.05,
    eta: "2026-08-26",
    items: [
      {
        qty: 1,
        item: "Thule Gauntlet 16-inch laptop sleeve",
        asin: "B0FH35VSC5",
        unitCostUsd: 62,
        disposition: "Additional purchase/customs; not part of the electrical installation",
      },
    ],
  },
];

function validateOrder(order) {
  const lineSubtotal = money(
    order.items.reduce((sum, item) => sum + item.qty * item.unitCostUsd, 0),
  );
  if (lineSubtotal !== order.itemsSubtotalUsd) {
    throw new Error(
      `${order.orderNumber}: lines total ${lineSubtotal}, receipt subtotal ${order.itemsSubtotalUsd}`,
    );
  }
  const calculatedGrand = money(
    order.itemsSubtotalUsd +
      (order.promotionUsd ?? 0) +
      (order.shippingUsd ?? 0) +
      (order.freeShippingUsd ?? 0) +
      order.taxUsd,
  );
  if (calculatedGrand !== order.grandTotalUsd) {
    throw new Error(
      `${order.orderNumber}: calculated grand ${calculatedGrand}, receipt grand ${order.grandTotalUsd}`,
    );
  }
}

for (const order of newOrders) validateOrder(order);

const newRows = [
  {
    id: "dse-earth-minibus",
    category: "Safety",
    item: "Blue Sea 2306 100 A six-gang Mini Grounding BusBar",
    qty: 1,
    unit: "ea",
    unitCost: 13.54,
    currency: "USD",
    location: "Import",
    procurement: "Purchased · allocation check",
    priority: "Installer selection",
    description:
      "Purchased 24 Aug 2026, ASIN B000K2MA9M. Candidate compact PE/bonding bar. Confirm that its six #8-32 screw positions accept the complete final conductor count and exact terminals before replacing or reallocating the already-owned Blue Sea 2128; receipt ingestion alone does not change the canonical wiring.",
    productUrl: "https://www.amazon.com/dp/B000K2MA9M",
    specUrl: "https://development.bluesea.com/products/2306/Common_100A_Mini_Grounding_BusBar_-_6_Gang",
  },
  {
    id: "dse-battery-terminal-clamps-additional",
    category: "Additional purchases",
    item: "Generic automotive battery-terminal connector two-piece packs",
    qty: 4,
    unit: "2-pack",
    unitCost: 13.79,
    currency: "USD",
    location: "Import",
    procurement: "Purchased · customs tracking",
    priority: "Do not install",
    description:
      "Four packs purchased 24 Aug 2026, ASIN B09T75Z1QR. Tracked for customs, but these generic automotive post clamps do not match the EverExceed ES200-12G F-M8 threaded inserts and are excluded from the fixed installation.",
    productUrl: "https://www.amazon.com/dp/B09T75Z1QR",
  },
  {
    id: "dse-din-rail-pack",
    category: "Mounting",
    item: "mxuteuk 4-inch DIN rails",
    qty: 1,
    unit: "3-pack",
    unitCost: 5.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock",
    description: "Three short steel DIN rails purchased 24 Aug 2026, ASIN B07RFQGVXG; allocate only after the enclosure layout and fastener clearances are verified.",
    productUrl: "https://www.amazon.com/dp/B07RFQGVXG",
  },
  {
    id: "dse-twin-ferrule-kit",
    category: "Wiring",
    item: "Preciva twin-wire ferrule assortment",
    qty: 1,
    unit: "800-piece kit",
    unitCost: 16.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock · verify fit",
    description: "Purchased 24 Aug 2026, ASIN B0DS61TQF8. Use only the exact conductor/ferrule combinations accepted by the received terminal maker and crimp-tool range; never trim strands to force a fit.",
    productUrl: "https://www.amazon.com/dp/B0DS61TQF8",
  },
  {
    id: "dse-heavy-lug-kit-65",
    category: "Wiring",
    item: "Glarks heavy copper-lug assortment",
    qty: 1,
    unit: "65-piece kit",
    unitCost: 12.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock · verify fit",
    description: "Purchased 24 Aug 2026, ASIN B07LBQYGK6. Confirm cable gauge, stud-hole diameter, material, crimp die and pull-test result for each selected lug.",
    productUrl: "https://www.amazon.com/dp/B07LBQYGK6",
  },
  {
    id: "dse-1-0-battery-cables-1ft",
    category: "Wiring",
    item: "iGreely 1/0 AWG one-foot red/black cable pairs",
    qty: 3,
    unit: "pair",
    unitCost: 18.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased · verify terminals",
    priority: "High-current install candidate",
    description: "Three one-foot red/black pairs purchased 24 Aug 2026, ASIN B0FMK1W3T5. Intended to keep adjacent battery and local high-current connections short; verify conductor material, insulation, lug-hole sizes, crimp quality and exact 1:1 routing before installation.",
    productUrl: "https://www.amazon.com/dp/B0FMK1W3T5",
  },
  {
    id: "dse-10awg-wire-30ft",
    category: "Wiring",
    item: "iGreely 10 AWG red/black wire",
    qty: 1,
    unit: "30 ft pair",
    unitCost: 35.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock",
    description: "Thirty-foot red/black stranded-wire pair purchased 24 Aug 2026, ASIN B08HSC5NW5. Allocate only to branches whose protection, ampacity, insulation and voltage-drop requirements are satisfied.",
    productUrl: "https://www.amazon.com/dp/B08HSC5NW5",
  },
  {
    id: "dse-2awg-wire-pair-5ft",
    category: "Wiring",
    item: "2 AWG five-foot red/black cable pair",
    qty: 1,
    unit: "pair",
    unitCost: 39.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased · verify terminals",
    priority: "High-current install candidate",
    description: "One five-foot red plus five-foot black 2 AWG pair purchased 24 Aug 2026, ASIN B0DTNX7S3S. Verify conductor material, insulation, termination geometry, protection and ampacity before assigning it to a circuit.",
    productUrl: "https://www.amazon.com/dp/B0DTNX7S3S",
  },
  {
    id: "dse-1-0-battery-cables-2ft",
    category: "Wiring",
    item: "iGreely 1/0 AWG two-foot red/black cable pair",
    qty: 1,
    unit: "pair",
    unitCost: 28.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased · verify terminals",
    priority: "High-current install candidate",
    description: "One two-foot red/black pair purchased 24 Aug 2026, ASIN B0GR8WW7J7. Verify conductor material, insulation, lug-hole sizes, crimp quality and exact route before installation.",
    productUrl: "https://www.amazon.com/dp/B0GR8WW7J7",
  },
  {
    id: "dse-14awg-wire-pair-25ft",
    category: "Wiring",
    item: "14 AWG red/black wire pair",
    qty: 1,
    unit: "25 ft pair",
    unitCost: 19.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock",
    description: "One 25-foot red plus 25-foot black stranded-wire pair purchased 24 Aug 2026, ASIN B0DTPC2RFJ. Allocate only after branch protection, ampacity and voltage drop are confirmed.",
    productUrl: "https://www.amazon.com/dp/B0DTPC2RFJ",
  },
  {
    id: "dse-6awg-wire-10ft",
    category: "Wiring",
    item: "iGreely 6 AWG red/black wire",
    qty: 1,
    unit: "10 ft pair",
    unitCost: 29.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock",
    description: "Ten-foot red/black stranded-wire pair purchased 24 Aug 2026, ASIN B09BFW8NB1. Allocate only to a circuit with verified protection, ampacity, insulation and voltage drop.",
    productUrl: "https://www.amazon.com/dp/B09BFW8NB1",
  },
  {
    id: "dse-18awg-wire-pair-50ft",
    category: "Wiring",
    item: "18 AWG red/black wire pair",
    qty: 1,
    unit: "50 ft pair",
    unitCost: 18.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock",
    description: "One 50-foot red plus 50-foot black stranded-wire pair purchased 24 Aug 2026, ASIN B0G6D5GPNH. Reserve for appropriately protected low-current control/service circuits.",
    productUrl: "https://www.amazon.com/dp/B0G6D5GPNH",
  },
  {
    id: "dse-klein-wire-stripper",
    category: "Tools & accessories",
    item: "Klein Tools 11061 self-adjusting wire stripper/cutter",
    qty: 1,
    unit: "ea",
    unitCost: 22.96,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Service tool",
    description: "Purchased 24 Aug 2026, ASIN B00CXKOEQ6. Carried installation/service tool; not part of the fixed electrical topology.",
    productUrl: "https://www.amazon.com/dp/B00CXKOEQ6",
  },
  {
    id: "dse-8awg-wire-10ft",
    category: "Wiring",
    item: "iGreely 8 AWG red/black wire",
    qty: 1,
    unit: "10 ft pair",
    unitCost: 19.75,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock",
    description: "Ten-foot red/black stranded-wire pair purchased 24 Aug 2026, ASIN B093R538JV. Allocate only to a circuit with verified protection, ampacity, insulation and voltage drop.",
    productUrl: "https://www.amazon.com/dp/B093R538JV",
  },
  {
    id: "dse-ferrule-crimper-kit",
    category: "Tools & accessories",
    item: "Ferrule crimper with ferrule assortment",
    qty: 1,
    unit: "1,800-piece kit",
    unitCost: 14.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install tool/stock · verify fit",
    description: "Crimper and 1,800-ferrule assortment purchased 24 Aug 2026, ASIN B0DRJ9CDNG. Verify die range and use only maker-approved conductor/ferrule/terminal combinations.",
    productUrl: "https://www.amazon.com/dp/B0DRJ9CDNG",
  },
  {
    id: "dse-spade-terminals",
    category: "Wiring",
    item: "TICONN insulated spade-terminal assortment",
    qty: 1,
    unit: "100-piece kit",
    unitCost: 9.95,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock · conditional",
    description: "Purchased 24 Aug 2026, ASIN B08BZ972B5. Use only on terminals explicitly rated for a matching spade; these are not substitutes for closed heavy-current ring lugs.",
    productUrl: "https://www.amazon.com/dp/B08BZ972B5",
  },
  {
    id: "dse-8awg-ring-lugs",
    category: "Wiring",
    item: "RED WOLF 8 AWG, 5/16-inch ring lugs",
    qty: 1,
    unit: "20-piece kit",
    unitCost: 16.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock · verify fit",
    description: "Twenty 8 AWG/5-16 ring lugs purchased 24 Aug 2026, ASIN B0FNWQ1H4P. Confirm material, barrel/die match, stud fit and pull-test results before use.",
    productUrl: "https://www.amazon.com/dp/B0FNWQ1H4P",
  },
  {
    id: "dse-heavy-lug-assortment",
    category: "Wiring",
    item: "Heavy copper-lug assortment",
    qty: 1,
    unit: "50-piece kit",
    unitCost: 30.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock · verify fit",
    description: "Fifty-piece lug assortment purchased 24 Aug 2026, ASIN B089K2RFN1. Confirm every gauge, stud, material, crimp-die and pull-test combination before installation.",
    productUrl: "https://www.amazon.com/dp/B089K2RFN1",
  },
  {
    id: "dse-cable-cutters",
    category: "Tools & accessories",
    item: "Mutt Tools 10-inch cable cutters",
    qty: 1,
    unit: "ea",
    unitCost: 17.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Service tool",
    description: "Purchased 24 Aug 2026, ASIN B099C1DSTQ. Carried installation/service tool; not part of the fixed electrical topology.",
    productUrl: "https://www.amazon.com/dp/B099C1DSTQ",
  },
  {
    id: "dse-ring-fork-terminals",
    category: "Wiring",
    item: "haisstronica insulated ring/fork terminal assortment",
    qty: 1,
    unit: "330-piece kit",
    unitCost: 26.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock · conditional",
    description: "Purchased 24 Aug 2026, ASIN B09YCRNGP9. Match conductor, stud and crimp die exactly; fork terminals are allowed only on terminals whose maker explicitly accepts them.",
    productUrl: "https://www.amazon.com/dp/B09YCRNGP9",
  },
  {
    id: "dse-service-return-bus-spares",
    category: "Spares",
    item: "Blue Sea 2314 covered 100 A MiniBus spares",
    qty: 2,
    unit: "ea",
    unitCost: 16.35,
    currency: "USD",
    location: "Import",
    procurement: "Purchased · unallocated",
    priority: "Spare / installer stock",
    description: "Two additional covered Blue Sea 2314 bars purchased 24 Aug 2026, ASIN B000OTJ89Q. The canonical model currently needs only the separately tracked installed service-return bar; retain these as unallocated spares unless a documented terminal-count change requires one.",
    productUrl: "https://www.amazon.com/dp/B000OTJ89Q",
    specUrl: "https://www.bluesea.com/products/2314/",
  },
  {
    id: "dse-paint-markers",
    category: "Tools & accessories",
    item: "Black and white oil-based paint-marker packs",
    qty: 2,
    unit: "2-pack",
    unitCost: 6.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Installation accessory",
    description: "One black two-pack (ASIN B0BLYTMLZN) and one white two-pack (ASIN B0BK81BSJJ) purchased 24 Aug 2026 for durable installation labeling.",
    productUrl: "https://www.amazon.com/dp/B0BLYTMLZN",
  },
  {
    id: "dse-mc4-connector-spares",
    category: "Spares",
    item: "MUYI MC4-compatible connector kit",
    qty: 1,
    unit: "22-piece kit",
    unitCost: 8.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "PV installation stock · compatibility check",
    description: "Purchased 24 Aug 2026, ASIN B0B17FXXL7. Before field use, confirm exact connector-family mating compatibility, conductor range, tooling and environmental rating; do not cross-mate incompatible MC4-style brands.",
    productUrl: "https://www.amazon.com/dp/B0B17FXXL7",
  },
  {
    id: "dse-type-i-notebook-cord-additional",
    category: "Additional purchases",
    item: "AS/NZS 3112 Type I to IEC C5 notebook power cord",
    qty: 1,
    unit: "ea",
    unitCost: 8.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased · customs tracking",
    priority: "Portable accessory",
    description: "Cable Leader six-foot Type I-to-C5 cord purchased 24 Aug 2026, ASIN B074F4959C. Tracked for customs as a portable notebook lead; it is not the fixed Type I trailing outlet shown in the installation.",
    productUrl: "https://www.amazon.com/dp/B074F4959C",
  },
  {
    id: "dse-shelf-brackets-additional",
    category: "Additional purchases",
    item: "Shelf-bracket set",
    qty: 1,
    unit: "8-piece set",
    unitCost: 12.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased · customs tracking",
    priority: "Unallocated mounting stock",
    description: "Eight-piece bracket set purchased 24 Aug 2026, ASIN B0D8T2XBBL. Tracked for customs; not allocated to the fixed electrical installation.",
    productUrl: "https://www.amazon.com/dp/B0D8T2XBBL",
  },
  {
    id: "dse-laptop-sleeve-additional",
    category: "Additional purchases",
    item: "Thule Gauntlet 16-inch laptop sleeve",
    qty: 1,
    unit: "ea",
    unitCost: 62,
    currency: "USD",
    location: "Import",
    procurement: "Purchased · customs tracking",
    priority: "Portable accessory",
    description: "Purchased 23 Aug 2026, ASIN B0FH35VSC5. Tracked for customs even though it is not part of the electrical installation.",
    productUrl: "https://www.amazon.com/dp/B0FH35VSC5",
  },
];

for (const row of newRows) upsertBom(row);

updateBom("dse-battery-string-breakers", {
  procurement: "Purchased · installation hold",
  description:
    "Two CHTAIXI DZ47NZ-125 B125 breakers purchased 24 Aug 2026, ASIN B0B1WC651R. One polarized B125 is planned per 24 V battery string inside the main junction at the positive cable entry. Do not energize until a qualified installer verifies received polarity/markings, terminal capacity, conductor ampacity, DC interrupt capacity and prospective fault current.",
});
updateBom("dse-breaker-mnedc100", {
  procurement: "Purchased · installation hold",
  specUrl: authoritativeUrls.smartSolarSpecifications,
  description:
    "One CHTAIXI DZ47NZ-125 B125 breaker purchased 24 Aug 2026, ASIN B0B1WC651R, for the requested SmartSolar branch substitution. This remains not commission-ready: 125 A exceeds Victron's typical 100 A protection recommendation for the 150/85 and the listed interrupt rating still requires documented prospective-fault-current acceptance.",
});
updateBom("dse-shunt", {
  specUrl: authoritativeUrls.smartShunt,
});
updateBom("dse-customs-vat", {
  productUrl: authoritativeUrls.arrivingInFiji,
});
updateBom("dse-light-install", {
  productUrl: authoritativeUrls.marineFiji,
});
const systemArrivalSource = system.research.find(
  (source) => source.title === "Passenger declarations and allowances",
);
if (!systemArrivalSource) throw new Error("Missing passenger-declaration research source");
systemArrivalSource.url = authoritativeUrls.arrivingInFiji;
const batteryResearchSource = system.research.find(
  (source) => source.title === "ES200-12G published internal resistance and maximum discharge current",
);
if (!batteryResearchSource) throw new Error("Missing ES200-12G research source");
batteryResearchSource.url = authoritativeUrls.everExceedDatasheet;
updateBom("dse-amazon-promotion", {
  unitCost: -90.23,
  description:
    "Actual Amazon order-level promotions through 24 Aug 2026: the previously reconciled $85.82 plus $4.41 from the latest twelve-order batch. Kept as a negative adjustment because receipt promotions are not reliably allocated to individual goods lines.",
});
updateBom("dse-us-sales-tax", {
  item: "U.S. sales tax on twenty-seven Amazon receipts",
  unitCost: 331.42,
  description:
    "Actual U.S. sales tax across twenty-seven reconciled Amazon receipts through 24 Aug 2026: the prior $266.33 plus $65.09 from the latest twelve unique orders.",
});

system.budget.note = system.budget.note
  .replace("through 23 Aug 2026", "through 24 Aug 2026")
  .replace("Fifteen Amazon receipts", "Twenty-seven Amazon receipts")
  .replace(
    "The purchased eight-way AC enclosure is budgeted for two four-module protection assemblies after an exact fit check.",
    "The purchased Mollom eight-way AC enclosure remains in the cost/customs record only as an owned spare; the unselected 24 × 24 × 12 in replacement enclosure remains a separate allowance pending a full-size fit check.",
  );

const rowReceiptMeta = {
  "dse-earth-minibus": ["111-3474952-7497041", "Arriving Aug 25"],
  "dse-battery-terminal-clamps-additional": ["111-7720355-6806603", "Arriving Aug 25"],
  "dse-din-rail-pack": ["111-4746944-9349806", "Arriving Aug 25"],
  "dse-twin-ferrule-kit": ["111-2349613-5829811", "Arriving Aug 25–26"],
  "dse-heavy-lug-kit-65": ["111-2349613-5829811", "Arriving Aug 25–26"],
  "dse-1-0-battery-cables-1ft": ["111-2349613-5829811", "Arriving Aug 25–26"],
  "dse-10awg-wire-30ft": ["111-2349613-5829811", "Arriving Aug 25–26"],
  "dse-2awg-wire-pair-5ft": ["111-2349613-5829811", "Arriving Aug 25–26"],
  "dse-1-0-battery-cables-2ft": ["111-2349613-5829811", "Arriving Aug 25–26"],
  "dse-14awg-wire-pair-25ft": ["111-2349613-5829811", "Arriving Aug 25–26"],
  "dse-6awg-wire-10ft": ["111-2349613-5829811", "Arriving Aug 25–26"],
  "dse-18awg-wire-pair-50ft": ["111-2349613-5829811", "Arriving Aug 25–26"],
  "dse-klein-wire-stripper": ["111-0039636-2784221", "Arriving Aug 25"],
  "dse-8awg-wire-10ft": ["111-0039636-2784221", "Arriving Aug 25"],
  "dse-ferrule-crimper-kit": ["111-0039636-2784221", "Arriving Aug 25"],
  "dse-spade-terminals": ["111-0039636-2784221", "Arriving Aug 25"],
  "dse-8awg-ring-lugs": ["111-0039636-2784221", "Arriving Aug 25"],
  "dse-heavy-lug-assortment": ["111-0039636-2784221", "Arriving Aug 25"],
  "dse-cable-cutters": ["111-0039636-2784221", "Arriving Aug 25"],
  "dse-ring-fork-terminals": ["111-0039636-2784221", "Arriving Aug 25"],
  "dse-service-return-bus-spares": ["111-8660524-3929849", "Check retailer tracking"],
  "dse-paint-markers": ["111-4586976-7908250", "Check retailer tracking"],
  "dse-mc4-connector-spares": ["111-8048902-1196269", "Check retailer tracking"],
  "dse-type-i-notebook-cord-additional": ["111-3979619-2780226", "Check retailer tracking"],
  "dse-shelf-brackets-additional": ["111-8905768-7147433", "Check retailer tracking"],
  "dse-laptop-sleeve-additional": ["111-0348737-9573002", "Arriving Aug 26"],
};

for (const row of newRows) {
  const [orderNumber, eta] = rowReceiptMeta[row.id];
  delivery.items[row.id] = {
    amazonStatus: "purchased",
    sourceLabel: `Amazon · ${row.item}`,
    sourceUrl: row.productUrl,
    eta,
    time: "Purchased Aug 23–24",
    note: `Reconciled to order ${orderNumber}. ${row.priority}.`,
  };
  customs.itemMeta[row.id] = {
    model: row.description.match(/ASIN ([A-Z0-9]+)/)?.[1]
      ? `${row.item} · ASIN ${row.description.match(/ASIN ([A-Z0-9]+)/)[1]}`
      : row.item,
    origin: "Confirm from packaging",
    serialRequired: false,
  };
}

delivery.items["dse-battery-string-breakers"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · two CHTAIXI B125 breakers",
  sourceUrl: "https://www.amazon.com/dp/B0B1WC651R",
  eta: "Check retailer tracking",
  time: "Purchased Aug 24 · $11.97 each",
  note: "Installation hold remains pending received-marking, polarity, conductor and fault-current acceptance.",
};
delivery.items["dse-breaker-mnedc100"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · CHTAIXI B125 breaker",
  sourceUrl: "https://www.amazon.com/dp/B0B1WC651R",
  eta: "Check retailer tracking",
  time: "Purchased Aug 24 · $11.97",
  note: "SmartSolar installation hold remains pending protection-rating and fault-current acceptance.",
};
delivery.items["dse-amazon-promotion"] = {
  amazonStatus: "not-applicable",
  sourceLabel: "Amazon order adjustment",
  eta: "Applied through Aug 24",
  time: "No shipment",
  note: "$90.23 combined promotion/coupon adjustment across all twenty-seven reconciled Amazon receipts.",
};
delivery.items["dse-us-sales-tax"] = {
  amazonStatus: "not-applicable",
  sourceLabel: "Amazon checkout tax",
  eta: "Paid through Aug 24",
  time: "Twenty-seven reconciled receipts",
  note: "$331.42 combined U.S. sales tax across all twenty-seven reconciled Amazon receipts.",
};
delivery.items["dse-customs-vat"].sourceUrl = authoritativeUrls.arrivingInFiji;
delete delivery.items["dse-junction-box"].sourceUrl;
delete delivery.items["dse-usb-station-wiring"].sourceUrl;

const customsBrokerSource = customs.sources.find((source) => source.id === "brokers");
if (!customsBrokerSource) throw new Error("Missing customs broker source metadata");
Object.assign(customsBrokerSource, {
  title: "Customs licensing and agent checklists",
  url: authoritativeUrls.customsLicensing,
});
delivery.checkedOn = "2026-08-25";
customs.checkedOn = "2026-08-25";

const U = {
  suntech: "https://www.suntech-power.com/wp-content/uploads/download/product-specification/EN_Ultra_V_Pro_N-type_STP570S_C72_Vmh.pdf",
  everexceed: authoritativeUrls.everExceedDatasheet,
  multiplus: "https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/technical-specifications-mp-ii-230v.html",
  smartsolar: authoritativeUrls.smartSolarSpecifications,
  orionSpecifications: authoritativeUrls.orionSpecifications,
  balancer: "https://www.victronenergy.com/upload/documents/Manual-Battery-Balancer-EN.pdf",
  ekrano: "https://www.wattuneed.com/en/victron-energy/27205-victron-energy-ekrano-gx-high-resolution-touchscreen-monitoring-system-0768563822926.html",
  shunt: "https://victech.nl/product/smartshunt-500a-50mv-ip65/",
  wireboxTr: "https://www.schrack.com/shop/wirebox-xl-tr-pvbcwirexl.html",
  coolgear145: "https://www.coolgear.com/product/145w-dual-usb-c-pd-3-1-vehicle-charger-with-mountable-flanges",
  coolgear75: "https://www.coolgear.com/wp-content/uploads/2019/03/CG-PD60PPS-Technical-Data-Sheet-v05.220908.pdf",
  blueSea2306: "https://development.bluesea.com/products/2306/Common_100A_Mini_Grounding_BusBar_-_6_Gang",
  blueSea2314: "https://www.bluesea.com/products/2314/",
  blueSea2128: "https://www.bluesea.com/products/compare/2126/2127/2128",
  blueSea2719: "https://www.campingworld.com/blue-sea-systems-maxibus-insulating-cover-part-no.-2719-350565.html",
  midnite125: "https://www.midnitesolar.com/productPhoto.php?act=pc&productCat_ID=16&product_ID=729",
  midnite20: "https://www.midnitesolar.com/productPhoto.php?act=p&productCat_ID=16&product_ID=183&sortOrder=18",
  unifi: "https://techspecs.ui.com/unifi/cloud-gateways/ux?subcategory=cloud-gateways-wifi-integrated",
  starlink: "https://starlink.com/public-files/specification_sheet_mini.pdf",
  knipex: "https://www.knipex.com/products/crimping-pliers/self-adjusting-crimping-pliers-for-wire-ferrules/self-adjusting-crimping-pliers-wire-ferrules/975304",
};

const listing = (unitWeightKg, weightSourceUrl, weightNote) => ({
  unitWeightKg,
  weightBasis: "listing",
  weightSourceUrl,
  weightNote,
});
const datasheet = (unitWeightKg, weightSourceUrl, weightNote) => ({
  unitWeightKg,
  weightBasis: "datasheet",
  weightSourceUrl,
  weightNote,
});
const estimate = (unitWeightKg, weightNote, weightSourceUrl) => ({
  unitWeightKg,
  weightBasis: "estimate",
  ...(weightSourceUrl ? { weightSourceUrl } : {}),
  weightNote,
});
const notApplicable = (weightNote) => ({
  unitWeightKg: 0,
  weightBasis: "not-applicable",
  weightNote,
});

const weights = {
  "dse-panels": datasheet(29.1, U.suntech, "Manufacturer datasheet net mass per module."),
  "dse-batteries": datasheet(65, U.everexceed, "ES200-12G manufacturer datasheet mass per battery."),
  "dse-pv-cable": estimate(0.07, "Per-metre estimate for 4 mm² copper PV cable including insulation."),
  "dse-battery-cable": estimate(3.95, "Planning mass for the complete custom 1/0 AWG cable set; derived from the current 8.7 lb cable-plan allowance."),
  "dse-wall-board": estimate(35, "Estimated plywood board plus ventilated shields and mounting hardware."),
  "dse-chtai-ac-rcbos-rejected": estimate(0.2, "Typical two-module RCBO mass; listing did not publish a reliable item weight."),
  "dse-ac-rcbo": listing(0.3, "https://www.amazon.com/dp/B0DCN7HK57", "Current candidate listing reports 0.3 kg per protection assembly; final selected product may differ."),
  "dse-ac-30a-rejected": listing(0.3, "https://www.amazon.com/dp/B0DCN7HK57", "Amazon listing item weight per purchased DIHOOL assembly."),
  "dse-ac-enclosure": listing(0.5, "https://www.amazon.com/dp/B09XJZDRNM", "Amazon listing item weight for the purchased HT-8 enclosure."),
  "dse-ac-install-enclosure": estimate(
    25,
    "Planning shipment estimate rounded from the comparable VEVOR 24 × 24 × 12 in steel enclosure; that product is not selected and the final shipment may differ.",
    "https://www.vevor.com/electrical-enclosure-c_10749/vevor-24x24x12-carbon-steel-electrical-enclosure-wall-mount-junction-box-ip65-p_010361595893",
  ),
  "dse-tool-lead": estimate(0.9, "Estimated from a 5 m 10 A three-core extension lead and Type I connector set."),
  "dse-gen-input": estimate(2.5, "Estimated combined mass of the two planned three-core generator/input cable assemblies."),
  "dse-switch-array": estimate(0.32, "Estimated mass of a six-gang prewired marine switch panel; listing omitted reliable item mass."),
  "dse-room-switch": estimate(0.12, "Estimated inline weather-resistant switch and short lead mass."),
  "dse-switch-connectors": listing(0.1, "https://www.amazon.com/dp/B0CJ5QF4Z2", "Retail listing package weight for the 12-piece WAGO assortment."),
  "dse-switch-accessories": estimate(0.5, "Small-parts lot estimate including jack, clips, diodes and sealing hardware."),
  "dse-indoor-light": estimate(0.28, "Estimated compact die-cast utility-light mass; listing omitted item mass."),
  "dse-outdoor-light": estimate(0.28, "Estimated compact die-cast utility-light mass; listing omitted item mass."),
  "dse-light-spare": estimate(0.28, "Estimated compact die-cast utility-light mass; listing omitted item mass."),
  "dse-light-install": estimate(1.5, "Estimated cable, brackets, fasteners and weather-sealing hardware lot."),
  "dse-earth": estimate(10, "Estimated grounding rod, conductor, clamps and bonding-hardware package."),
  "dse-mc4-dc-adapters": estimate(0.15, "Estimated mass per 1.5 m 16 AWG adapter cable."),
  "dse-terms": estimate(2, "Estimated total termination/install-hardware allowance before exact takeoff."),
  "dse-battery-rack": estimate(15, "Estimated steel restraint/rack and terminal-cover package."),
  "dse-multiplus": datasheet(19, U.multiplus, "Victron technical specification net weight."),
  "dse-ekrano-gx": listing(1, U.ekrano, "Retailer product listing net weight."),
  "dse-mppt-wirebox-mc4-rejected": listing(0.275, "https://sunraypower.co.za/victron/solar_chargers/", "Victron distributor product table net weight for the XL-MC4 enclosure; the marketplace's 2.46 oz catalog value was rejected as implausible."),
  "dse-mppt-wirebox-tr": listing(0.3, U.wireboxTr, "Distributor listing weight for the XL-Tr product; preferred over an implausibly low marketplace catalog value."),
  "dse-smartsolar": datasheet(4.5, U.smartsolar, "Victron technical specification net weight."),
  "dse-dielectric-grease": listing(0.085, "https://www.amazon.com/dp/B000AL8VD2", "Three-ounce product content mass; packaging excluded."),
  "dse-supplier-freight": notApplicable("Freight charge/allowance, not a physical BOM item."),
  "dse-balancers": datasheet(0.4, U.balancer, "Victron manual net weight per balancer."),
  "dse-shunt": listing(0.42, U.shunt, "Retailer listing product weight for SmartShunt IP65 500 A."),
  "dse-orion-usb-converter": datasheet(1.8, U.orionSpecifications, "Victron published product weight for Orion-Tr Smart 24/12-30 non-isolated."),
  "dse-amazon-promotion": notApplicable("Monetary purchase adjustment, not a physical item."),
  "dse-us-sales-tax": notApplicable("Tax adjustment, not a physical item."),
  "dse-battery-string-breakers": estimate(0.18, "Estimated mass per 125 A single-pole molded-case miniature breaker; listing omitted reliable item weight."),
  "dse-battery-string-breakers-midnite-unused": datasheet(0.454, U.midnite125, "Manufacturer product page lists one pound per breaker."),
  "dse-pv-string-breakers": listing(0.187, "https://www.amazon.com/dp/B0D4JPXT4T", "Marketplace item weight of 6.6 oz for the same two-pole breaker body, converted to kilograms."),
  "dse-pv-breakers-32a-rejected": listing(0.187, "https://www.amazon.com/dp/B0D4JPXT4T", "Amazon listing item weight of 6.6 oz, converted to kilograms."),
  "dse-pv-protection": estimate(2.5, "Estimated complete two-string combiner enclosure with disconnect, SPD and terminals."),
  "dse-breaker-mnedc100": estimate(0.18, "Estimated mass for the purchased 125 A single-pole breaker; listing omitted reliable item weight."),
  "dse-breaker-mnepv20": datasheet(0.091, U.midnite20, "Manufacturer product-page shipping mass allocation of about 0.2 lb per breaker."),
  "dse-switched-load-breaker": listing(0.1, "https://www.amazon.com/dp/B09H4W5HSW", "Amazon listing item weight of 3.52 oz, converted to kilograms."),
  "dse-usb": listing(0.255, U.coolgear145, "Manufacturer listing item weight of 9 oz per charger, converted to kilograms."),
  "dse-usb-sockets": estimate(0.3, "Estimated mass per six-foot 12 AWG socket harness and receptacle."),
  "dse-chargeit-mini-75": datasheet(0.1275, U.coolgear75, "Manufacturer technical-data-sheet mass per module."),
  "dse-usb-output-breaker": listing(0.1, "https://www.amazon.com/dp/B09H4W8CLY", "Amazon listing item weight for the one-pole breaker body."),
  "dse-usb-station-wiring": estimate(2, "Estimated wall-mounting, wire, sleeving and termination hardware lot."),
  "dse-unifi-converter": estimate(0.08, "Estimated potted DC/DC converter and lead mass; listing omitted item weight."),
  "dse-unifi-usb-cable": listing(0.09, "https://www.amazon.com/dp/B085S9XQ2M", "Amazon listing weight for the purchased two-cable pack."),
  "dse-router": datasheet(0.302, U.unifi, "Ubiquiti technical specification product weight."),
  "dse-main-busbars": estimate(1.2, "Estimated combined mass of two covered 600 A copper busbars."),
  "dse-service-return-bus": datasheet(0.08, U.blueSea2314, "Blue Sea product page mass per covered MiniBus."),
  "dse-earth-busbar": datasheet(0.295, U.blueSea2128, "Blue Sea product comparison lists 0.65 lb, converted to kilograms."),
  "dse-earth-bus-cover": listing(0.204, U.blueSea2719, "Retail listing unit weight of 0.45 lb, converted to kilograms."),
  "dse-vedirect-cables": listing(0.0272, "https://www.amazon.com/dp/B01F9ESFZS", "Amazon listing item weight per 0.9 m cable."),
  "dse-vebus-cable": listing(0.136, "https://www.amazon.com/dp/B003OCRW3E", "Amazon listing item weight of 4.8 oz, converted to kilograms."),
  "dse-ekrano-ethernet": listing(0.132, "https://www.amazon.com/dp/B003OCRW34", "Amazon listing item weight of 4.64 oz, converted to kilograms."),
  "dse-cat6-blue-spare": listing(0.132, "https://www.amazon.com/dp/B000KSEJV8", "Amazon listing item weight of 4.64 oz, converted to kilograms."),
  "dse-starlink-ethernet": listing(0.25, "https://www.amazon.com/dp/B0D8J3HC7Z", "Amazon listing item weight for the 15 ft weatherproof cable."),
  "dse-inline-connectors": estimate(0.18, "Estimated total for the four-piece IP68 inline connector pack."),
  "dse-mc4-tool-kit": listing(0.93, "https://www.amazon.com/dp/B0BWRHMHY9", "Amazon listing package weight of 2.05 lb, converted to kilograms."),
  "dse-junction-box": estimate(
    76,
    "Planning shipment estimate based on the comparable Saginaw SCE-244812WFLP 24 × 48 × 12 in steel enclosure plus SCE-48P24 full-size backplate; neither product is selected and the final shipment may differ.",
    "https://www.saginawcontrol.com/partnumber_info/?n=SCE-244812WFLP",
  ),
  "dse-multimeter": listing(0.395, "https://www.amazon.com/dp/B0B57L9FNL", "Amazon listing item weight of 13.92 oz, converted to kilograms."),
  "dse-aa-aaa-charger": estimate(0.18, "Estimated portable charger mass; listing omitted reliable item weight."),
  "dse-10awg-duplex-wire": estimate(0.55, "Copper-area plus insulation estimate for a 10 ft red/black 10 AWG pair."),
  "dse-starlink-portable-usbc-cables": estimate(0.12, "Estimated mass per 6.6 ft USB-C-to-DC cable."),
  "dse-starlink-portable-battery-cable": estimate(0.35, "Estimated mass of 16.4 ft 18 AWG paired lead, lugs, fuse holder and DC plug."),
  "dse-usb-c-cables-240w": listing(0.15, "https://www.amazon.com/dp/B0CPN65CDG", "Amazon listing weight per two-cable retail pack."),
  "dse-usb-c-cables-60w": estimate(0.18, "Estimated mass per three-cable six-foot retail pack; listing omitted reliable item mass."),
  "dse-home-depot-sales-tax": notApplicable("Tax adjustment, not a physical item."),
  "dse-service-spares": estimate(1, "Estimated physical mass of the planned electrical service-spares kit."),
  "dse-amazon-shipping": notApplicable("Supplier shipping charge, not a physical item."),
  "dse-ferrule-crimper-candidate": listing(0.404, U.knipex, "Manufacturer product-page weight for candidate tool."),
  "dse-ferrules-small-candidate": estimate(0.2, "Estimated boxed ferrule-assortment mass; manufacturer page did not state package weight."),
  "dse-ferrules-large-candidate": estimate(0.25, "Estimated boxed ferrule-assortment mass; manufacturer page did not state package weight."),
  "dse-ancor-terminal-kit-candidate": estimate(0.454, "Estimated one-pound mass for the 160-piece heat-shrink terminal kit."),
  "dse-ancor-fork-candidate": estimate(0.023, "Estimated mass of 25 small flanged fork terminals."),
  "dse-baggage": notApplicable("Checked-bag fee/allowance, not the mass of a physical item."),
  "dse-customs-vat": notApplicable("Border-tax allowance, not a physical item."),
  "dse-ex-starlink": datasheet(2.89, U.starlink, "Starlink Mini specification-sheet packaged kit weight."),
  "dse-ex-mount": estimate(60, "Estimated complete local panel mounting structure and hardware mass."),
  "dse-ex-freight": notApplicable("Freight service outside project scope, not a physical item."),
  "dse-ex-labor": notApplicable("Donated labor service, not a physical item."),
  "dse-earth-minibus": datasheet(0.05, U.blueSea2306, "Blue Sea product page lists 0.10 lb, rounded to 0.05 kg."),
  "dse-battery-terminal-clamps-additional": estimate(0.25, "Estimated per two-clamp retail pack; listing omitted reliable item weight."),
  "dse-din-rail-pack": listing(0.04, "https://www.amazon.com/dp/B07RFQGVXG", "Amazon listing package weight for the three short rails."),
  "dse-twin-ferrule-kit": listing(0.23, "https://www.amazon.com/dp/B0DS61TQF8", "Amazon listing item weight of 8.1 oz, converted to kilograms."),
  "dse-heavy-lug-kit-65": estimate(0.45, "Estimated 65-piece copper-lug kit mass; listing omitted reliable item weight."),
  "dse-1-0-battery-cables-1ft": listing(0.45, "https://www.amazon.com/dp/B0FMK1W3T5", "Amazon listing item weight per one-foot red/black pair."),
  "dse-10awg-wire-30ft": estimate(1.45, "Copper-area plus flexible-insulation estimate for a 30 ft red/black 10 AWG pair."),
  "dse-2awg-wire-pair-5ft": estimate(1.15, "Copper-area plus flexible-insulation and terminal estimate for a five-foot red/black 2 AWG pair."),
  "dse-1-0-battery-cables-2ft": estimate(0.82, "Copper-area plus flexible-insulation and lug estimate for a two-foot red/black 1/0 AWG pair."),
  "dse-14awg-wire-pair-25ft": estimate(0.48, "Copper-area plus flexible-insulation estimate for a 25 ft red/black 14 AWG pair."),
  "dse-6awg-wire-10ft": estimate(0.95, "Copper-area plus flexible-insulation estimate for a 10 ft red/black 6 AWG pair."),
  "dse-18awg-wire-pair-50ft": estimate(0.45, "Copper-area plus flexible-insulation estimate for a 50 ft red/black 18 AWG pair."),
  "dse-klein-wire-stripper": listing(0.357, "https://www.amazon.com/dp/B00CXKOEQ6", "Amazon listing item weight of 12.6 oz, converted to kilograms."),
  "dse-8awg-wire-10ft": estimate(0.65, "Copper-area plus flexible-insulation estimate for a 10 ft red/black 8 AWG pair."),
  "dse-ferrule-crimper-kit": listing(0.7, "https://www.amazon.com/dp/B0DRJ9CDNG", "Amazon listing package weight for crimper and ferrule assortment."),
  "dse-spade-terminals": estimate(0.18, "Estimated 100-piece insulated-terminal kit mass."),
  "dse-8awg-ring-lugs": estimate(0.22, "Estimated 20-piece heavy ring-lug kit mass."),
  "dse-heavy-lug-assortment": estimate(0.75, "Estimated 50-piece copper-lug assortment mass."),
  "dse-cable-cutters": estimate(0.35, "Reasoned hand-tool estimate; marketplace catalog weight was rejected as physically implausible."),
  "dse-ring-fork-terminals": estimate(0.45, "Estimated 330-piece insulated-terminal kit mass."),
  "dse-service-return-bus-spares": datasheet(0.08, U.blueSea2314, "Blue Sea product-page mass per covered MiniBus."),
  "dse-paint-markers": listing(0.037, "https://www.amazon.com/dp/B0BLYTMLZN", "Amazon listing item weight of 1.3 oz per two-marker pack, converted to kilograms; applied to both color packs."),
  "dse-mc4-connector-spares": listing(0.221, "https://www.amazon.com/dp/B0B17FXXL7", "Amazon listing package weight of 7.8 oz, converted to kilograms."),
  "dse-type-i-notebook-cord-additional": estimate(0.18, "Estimated six-foot three-core notebook power-cord mass; listing omitted reliable item weight."),
  "dse-shelf-brackets-additional": listing(0.71, "https://www.amazon.com/dp/B0D8T2XBBL", "Amazon listing package weight for the eight-bracket set."),
  "dse-laptop-sleeve-additional": listing(0.5, "https://www.amazon.com/dp/B0FH35VSC5", "Amazon listing item weight for the laptop sleeve."),
};

const bomIds = system.bom.map((row) => row.id);
const duplicateBomIds = bomIds.filter((id, index) => bomIds.indexOf(id) !== index);
if (duplicateBomIds.length) throw new Error(`Duplicate BOM IDs: ${duplicateBomIds.join(", ")}`);
const unmappedWeights = bomIds.filter((id) => !weights[id]);
const staleWeights = Object.keys(weights).filter((id) => !bomIds.includes(id));
if (unmappedWeights.length || staleWeights.length) {
  throw new Error(
    `Weight map mismatch. Missing: ${unmappedWeights.join(", ") || "none"}; stale: ${staleWeights.join(", ") || "none"}`,
  );
}

for (const row of system.bom) {
  const weight = weights[row.id];
  row.unitWeightKg = weight.unitWeightKg;
  row.totalWeightKg = mass(row.qty * weight.unitWeightKg);
  row.weightBasis = weight.weightBasis;
  if (weight.weightSourceUrl) row.weightSourceUrl = weight.weightSourceUrl;
  else delete row.weightSourceUrl;
  row.weightNote = weight.weightNote;
  if (weight.weightBasis === "not-applicable" && row.totalWeightKg !== 0) {
    throw new Error(`Non-physical row has nonzero weight: ${row.id}`);
  }
}

const allOrdersByNumber = new Map(
  [...priorAmazon.orders, ...newOrders].map((order) => [order.orderNumber, order]),
);
const orders = [...allOrdersByNumber.values()].sort(
  (a, b) => a.date.localeCompare(b.date) || a.orderNumber.localeCompare(b.orderNumber),
);
for (const order of orders) validateOrder(order);
const reconciliation = orders.reduce(
  (total, order) => ({
    goodsUsd: money(total.goodsUsd + order.itemsSubtotalUsd),
    promotionsUsd: money(total.promotionsUsd + (order.promotionUsd ?? 0)),
    shippingUsd: money(
      total.shippingUsd + (order.shippingUsd ?? 0) + (order.freeShippingUsd ?? 0),
    ),
    taxUsd: money(total.taxUsd + order.taxUsd),
    grandTotalUsd: money(total.grandTotalUsd + order.grandTotalUsd),
  }),
  { goodsUsd: 0, promotionsUsd: 0, shippingUsd: 0, taxUsd: 0, grandTotalUsd: 0 },
);
const reconciliationCheck = money(
  reconciliation.goodsUsd +
    reconciliation.promotionsUsd +
    reconciliation.shippingUsd +
    reconciliation.taxUsd,
);
if (reconciliationCheck !== reconciliation.grandTotalUsd) {
  throw new Error(`Aggregate arithmetic mismatch: ${reconciliationCheck} vs ${reconciliation.grandTotalUsd}`);
}

const priorAmazonBase = { ...priorAmazon };
delete priorAmazonBase.newOrdersReconciliation;
delete priorAmazonBase.scopedOrdersReconciliation;
const amazonAggregate = {
  ...priorAmazonBase,
  orders,
  scope: `All ${orders.length} unique incremental Amazon orders recorded after the initial 17 Aug equipment/light purchases; duplicate intake PDFs are excluded.`,
  scopedOrdersReconciliation: reconciliation,
  duplicateReceiptAudit: {
    reviewedOn: "2026-08-25",
    intakePdfs: 5,
    exactFileCopies: 3,
    statusUpdateCopies: 2,
    existingUniqueOrdersRepresented: 3,
    note: "All five PDFs were recognized as copies of previously ingested orders and excluded from order and BOM totals. Exact copies and later status-page copies are retained under distinct private filenames for auditability.",
    files: [
      {
        orderNumber: "111-3303443-2964206",
        receiptFile: "amazon-2026-08-23-order-111-3303443-2964206-pv-breakers-exact-duplicate.pdf",
        relationship: "exact file copy",
      },
      {
        orderNumber: "111-3546485-7664210",
        receiptFile: "amazon-2026-08-23-order-111-3546485-7664210-ac-protection-enclosure-exact-duplicate.pdf",
        relationship: "exact file copy",
      },
      {
        orderNumber: "111-5451203-7685830",
        receiptFile: "amazon-2026-08-23-order-111-5451203-7685830-usb-breaker-exact-duplicate.pdf",
        relationship: "exact file copy",
      },
      {
        orderNumber: "111-5451203-7685830",
        receiptFile: "amazon-2026-08-23-order-111-5451203-7685830-usb-breaker-status-update.pdf",
        relationship: "status-page update",
      },
      {
        orderNumber: "111-3546485-7664210",
        receiptFile: "amazon-2026-08-23-order-111-3546485-7664210-ac-protection-enclosure-status-update.pdf",
        relationship: "status-page update",
      },
    ],
  },
};

const receiptMoves = [
  ["Order Details-1.pdf", "amazon-2026-08-23-order-111-3303443-2964206-pv-breakers-exact-duplicate.pdf"],
  ["Order Details-2.pdf", "amazon-2026-08-23-order-111-3546485-7664210-ac-protection-enclosure-exact-duplicate.pdf"],
  ["Order Details-3.pdf", "amazon-2026-08-23-order-111-5451203-7685830-usb-breaker-exact-duplicate.pdf"],
  ["Order Details-4.pdf", "amazon-2026-08-24-order-111-3474952-7497041-grounding-busbar.pdf"],
  ["Order Details-5.pdf", "amazon-2026-08-24-order-111-7720355-6806603-battery-terminal-clamps.pdf"],
  ["Order Details-6.pdf", "amazon-2026-08-24-order-111-4746944-9349806-din-rails.pdf"],
  ["Order Details-7.pdf", "amazon-2026-08-24-order-111-2349613-5829811-cable-ferrules-lugs.pdf"],
  ["Order Details-8.pdf", "amazon-2026-08-24-order-111-0039636-2784221-electrical-tools-terminations.pdf"],
  ["Order Details-9.pdf", "amazon-2026-08-24-order-111-8660524-3929849-service-busbars.pdf"],
  ["Order Details-10.pdf", "amazon-2026-08-24-order-111-3957253-6148202-smartsolar-b125-breaker.pdf"],
  ["Order Details-11.pdf", "amazon-2026-08-24-order-111-4586976-7908250-battery-b125-breakers-paint-markers.pdf"],
  ["Order Details-12.pdf", "amazon-2026-08-24-order-111-8048902-1196269-mc4-connector-kit.pdf"],
  ["Order Details-13.pdf", "amazon-2026-08-24-order-111-3979619-2780226-type-i-notebook-power-cord.pdf"],
  ["Order Details-14.pdf", "amazon-2026-08-24-order-111-8905768-7147433-shelf-brackets.pdf"],
  ["Order Details-15.pdf", "amazon-2026-08-23-order-111-0348737-9573002-laptop-sleeve.pdf"],
  ["Order Details-16.pdf", "amazon-2026-08-23-order-111-5451203-7685830-usb-breaker-status-update.pdf"],
  ["Order Details-17.pdf", "amazon-2026-08-23-order-111-3546485-7664210-ac-protection-enclosure-status-update.pdf"],
];

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function movePrivateFile(sourceName, destinationName) {
  const source = resolve(path.join("private/to-process", sourceName));
  const destination = resolve(path.join("private", destinationName));
  if (!fs.existsSync(source)) {
    if (!fs.existsSync(destination)) {
      throw new Error(`Receipt is missing from both intake and archive: ${sourceName}`);
    }
    return "already archived";
  }
  if (fs.existsSync(destination)) {
    if (sha256(source) === sha256(destination)) {
      throw new Error(
        `Identical intake/archive collision for ${sourceName}; preserve both manually rather than deleting one`,
      );
    }
    throw new Error(`Archive destination already exists with different content: ${destinationName}`);
  }
  fs.renameSync(source, destination);
  return "moved";
}

// Write validated PII-free data before moving source receipts out of intake.
writeJson("data/dse-system.json", system);
writeJson("data/dse-delivery.json", delivery);
writeJson("data/dse-customs.json", customs);
writeJson("private/amazon-orders-through-2026-08-24.json", amazonAggregate);

for (const [source, destination] of receiptMoves) movePrivateFile(source, destination);

// Move any private page images created while reading a receipt, keeping them beside
// the canonical PDF. No image content or private fields enter the public datasets.
for (const [sourcePdf, destinationPdf] of receiptMoves) {
  const sourceStem = sourcePdf.replace(/\.pdf$/i, "");
  const destinationStem = destinationPdf.replace(/\.pdf$/i, "");
  const pageImages = fs
    .readdirSync(resolve("private/to-process"))
    .filter((name) => name.startsWith(`${sourceStem}-`) && name.toLowerCase().endsWith(".jpg"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const [index, sourceImage] of pageImages.entries()) {
    movePrivateFile(sourceImage, `${destinationStem}-page-${index + 1}.jpg`);
  }
}

const exactDuplicatePairs = [
  [
    "amazon-2026-08-23-order-111-3303443-2964206-pv-breakers.pdf",
    "amazon-2026-08-23-order-111-3303443-2964206-pv-breakers-exact-duplicate.pdf",
  ],
  [
    "amazon-2026-08-23-order-111-3546485-7664210-ac-protection-enclosure.pdf",
    "amazon-2026-08-23-order-111-3546485-7664210-ac-protection-enclosure-exact-duplicate.pdf",
  ],
  [
    "amazon-2026-08-23-order-111-5451203-7685830-usb-breaker.pdf",
    "amazon-2026-08-23-order-111-5451203-7685830-usb-breaker-exact-duplicate.pdf",
  ],
];
for (const [canonical, duplicate] of exactDuplicatePairs) {
  if (sha256(resolve(path.join("private", canonical))) !== sha256(resolve(path.join("private", duplicate)))) {
    throw new Error(`Receipt marked exact duplicate does not hash-match: ${duplicate}`);
  }
}

const remainingIntake = fs
  .readdirSync(resolve("private/to-process"))
  .filter((name) => name !== ".DS_Store");
if (remainingIntake.length) {
  throw new Error(`Unprocessed private intake files remain: ${remainingIntake.join(", ")}`);
}

const physicalRows = system.bom.filter((row) => row.weightBasis !== "not-applicable");
const importedPhysicalRows = physicalRows.filter((row) => row.location === "Import");
const purchasedImportedPhysicalRows = importedPhysicalRows.filter((row) =>
  row.procurement.includes("Purchased"),
);
const latestReceiptIds = new Set([
  ...newRows.map((row) => row.id),
  "dse-battery-string-breakers",
  "dse-breaker-mnedc100",
]);
console.log(
  JSON.stringify(
    {
      newUniqueOrders: newOrders.length,
      aggregateUniqueOrders: orders.length,
      duplicateIntakePdfs: 5,
      bomRows: system.bom.length,
      weightRows: system.bom.filter((row) => Number.isFinite(row.totalWeightKg)).length,
      estimatedWeightRows: system.bom.filter((row) => row.weightBasis === "estimate").length,
      notApplicableWeightRows: system.bom.filter((row) => row.weightBasis === "not-applicable").length,
      totalPhysicalBomWeightKg: mass(
        physicalRows.reduce((sum, row) => sum + row.totalWeightKg, 0),
      ),
      importedPhysicalBomWeightKg: mass(
        importedPhysicalRows.reduce((sum, row) => sum + row.totalWeightKg, 0),
      ),
      purchasedImportedPhysicalBomWeightKg: mass(
        purchasedImportedPhysicalRows.reduce((sum, row) => sum + row.totalWeightKg, 0),
      ),
      latestReceiptGoodsWeightKg: mass(
        physicalRows
          .filter((row) => latestReceiptIds.has(row.id))
          .reduce((sum, row) => sum + row.totalWeightKg, 0),
      ),
      reconciliation,
      intakeRemaining: remainingIntake.length,
    },
    null,
    2,
  ),
);

// Keep the public, PII-free customs research and receipt-reference datasets in
// sync after every private receipt ingestion. Both scripts are idempotent; the
// receipt generator preserves its committed public manifest when private inputs
// are intentionally absent from a public checkout.
await import("./update-customs-metadata.mjs");
await import("./generate-public-receipt-manifest.mjs");
