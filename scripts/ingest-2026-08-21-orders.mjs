import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const writeJson = (relativePath, value) =>
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
const byId = (items, id) => items.find((item) => item.id === id);
const replaceById = (items, id, replacement) => {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Missing ${id}`);
  items.splice(index, 1, replacement);
};
const removeIds = (items, ids) => {
  const rejected = new Set(ids);
  return items.filter((item) => !rejected.has(item.id));
};
const insertBefore = (items, targetId, additions) => {
  const index = items.findIndex((item) => item.id === targetId);
  if (index < 0) throw new Error(`Missing insertion target ${targetId}`);
  items.splice(index, 0, ...additions);
};

const dse = readJson("data/dse-system.json");
dse.revision = "Design R15 · 21 Aug 2026";
dse.subtitle = "Serviceable 24 V solar workshop with two independently breakered battery strings";
dse.budget.note = "Panels, batteries, the UniFi Express, three QHLightlux fixtures, the Amazon Victron order and the additional Amazon electrical orders through 21 Aug 2026 are included in the project total as purchased. A 20% deposit has also been paid toward the MultiPlus-II, which will be supplied in Fiji; its $939 row remains a USD planning value until the Fiji invoice total is entered. The estimated $607.11 Ekrano GX increment remains donor-funded pending the final border-cost reconciliation. Two QHLightlux fixtures are installed and the third is a carried spare. The purchased Orion 24/12-30A is carried as an uninstalled spare. Five Amazon receipts are reconciled through separate promotion, supplier-shipping and U.S.-sales-tax adjustment rows. Freight beyond Nadi, panel mounting, Starlink hardware and labor are excluded.";
dse.summary = "Four 565 W panels form two matched two-panel series strings (2S2P) and feed a Victron SmartSolar 150/85 through two separate 4 mm² positive/negative home runs. The purchased indoor 2-in/1-out PV entry box combines the strings through a two-pole disconnect and surge protection; its supplied 32 A string fuses must be replaced with correctly listed 20 A gPV links before commissioning because the Suntech module maximum series-fuse rating is 25 A. Four 12 V GEL batteries form two 24 V series strings. Each positive leaves its string through a purchased non-polarized MidNite Solar MNEPV125-80-1PNP 125 A / 80 VDC breaker in a compact finger-safe enclosure, then lands independently on the covered main positive bus. The two breakers provide string isolation and whole-bank shutdown, so no battery selector or additional master switch is fitted. Both breakers remain ON during normal service. A non-GX Victron MultiPlus-II provides AC and generator charging, while the Ekrano GX coordinates charge current, local monitoring and VRM reporting. The SmartSolar output and every service positive also use resettable MidNite Solar DC breakers. Starlink uses its single OEM 15 m white DC lead. UniFi, a six-port Scanstrut USB-C/A charging panel and two identical warm-white utility lights use protected nominal-24 V branches.";

const switchingFact = dse.keyFacts.find((fact) => fact.label === "Battery switching");
switchingFact.value = "Dual string breakers";
switchingFact.detail = "2 × 125 A · normally both ON";

dse.batteryCablePlan.planningTotalLengthFt = 23;
dse.batteryCablePlan.planningWeightLb = 9.8;
dse.batteryCablePlan.measurementRule = "Buy only after a 1:1 layout using the two received MidNite breakers and their enclosure. Measure along the supported route, preserve broad bend radii, keep the paired A/B paths equal, and confirm every battery, breaker, busbar and MultiPlus termination before ordering. The breaker is specified for 14 AWG through 1/0 AWG conductors; match the factory-prepared breaker end to the terminal geometry and instructions on the received product.";
dse.batteryCablePlan.assemblies = [
  {
    qty: 2,
    planningLengthIn: 12,
    color: "black",
    from: "Battery 1/3 negative",
    to: "Battery 2/4 positive",
    lugs: "M8–M8 assumed; confirm battery terminals",
    purpose: "series links",
  },
  {
    qty: 2,
    planningLengthIn: 12,
    color: "red",
    from: "String A/B positive",
    to: "MidNite 125 A breaker A/B input",
    lugs: "M8 ring at battery; factory-prepared breaker end to match received terminal",
    purpose: "short unprotected battery-to-breaker leads",
  },
  {
    qty: 2,
    planningLengthIn: 36,
    color: "red",
    from: "MidNite 125 A breaker A/B output",
    to: "separate M10 main-positive-bus studs",
    lugs: "factory-prepared breaker end–M10",
    purpose: "equal independently protected positive string paths",
  },
  {
    qty: 2,
    planningLengthIn: 36,
    color: "black",
    from: "String A/B negative",
    to: "SmartShunt BATTERY MINUS",
    lugs: "M8–M10 assumed; confirm battery terminals",
    purpose: "equal negative string paths",
  },
  {
    qty: 1,
    planningLengthIn: 12,
    color: "black",
    from: "SmartShunt SYSTEM MINUS",
    to: "negative busbar",
    lugs: "M10–M10",
    purpose: "shunt-to-bus",
  },
  {
    qty: 2,
    planningLengthIn: 36,
    color: "red / black",
    from: "positive / negative busbars",
    to: "MultiPlus-II",
    lugs: "M10–M8",
    purpose: "inverter positive and negative",
  },
];

for (const id of ["battery2", "battery4"]) {
  const battery = byId(dse.components, id);
  battery.specs = battery.specs.map((spec) =>
    spec.includes("string fuse") ? "125 A resettable string breaker at positive" : spec,
  );
}
const bank = byId(dse.components, "batteryBank");
bank.kicker = "Two independently breakered 2S strings · normally paralleled";
bank.note = "Fully charge and voltage-match all four units separately before assembly. Use equal-length positive and negative string leads, and keep both 125 A breakers ON during normal service so both strings charge and discharge together. For a suspected fault, stop AC loads and charging, switch both string breakers OFF, diagnose with a meter, disconnect and insulate the failed string, then restore only the verified good string if emergency service is required.";

const mainDc = byId(dse.components, "mainDc");
mainDc.summary = "One covered AMOMD red/black 600 A busbar pair combines the two independently breakered string positives and collects all system negatives; all negative current crosses the SmartShunt.";
mainDc.specs = [
  "2 × purchased MidNite MNEPV125-80-1PNP 125 A string breakers",
  "One compact finger-safe two-breaker enclosure",
  "Positive bus · 8 conductors across 12 separate positions",
  "Negative bus · 6 conductors across 12 separate positions",
  "AMOMD pair · each bar has four M10 studs + eight M4 screws",
  "SmartShunt IP65 500 A · supplied 1 A fused Vbatt+ lead",
  "1/0 AWG / 53.5 mm² Cu to MultiPlus",
  "Target ≤1.0 m one-way",
  "11 factory-prepared heavy-cable assemblies",
];
mainDc.note = "Mount the two battery-string breakers in their own finger-safe enclosure close to the batteries. Each breaker output gets its own main-positive-bus landing; do not combine the strings on a breaker terminal and do not use the enclosure's small accessory busbars for battery current. Both equal-length string negatives land on SmartShunt BATTERY MINUS. Nothing else connects on the BATTERY MINUS side. The positive bar uses eight of twelve positions and the negative bar uses six of twelve, so no circuit lugs need to share a terminal.";

const breakerComponents = [
  {
    id: "batteryProtection",
    title: "Dual battery-string breaker enclosure",
    kicker: "2 × MidNite 125 A · finger-safe",
    kind: "protection",
    summary: "Two separately purchased resettable breakers protect and isolate the two 24 V battery strings before their positive conductors join at the main bus.",
    specs: [
      "2 × MNEPV125-80-1PNP",
      "125 A · 80 VDC · non-polarized",
      "UL 489A listed · 14 AWG–1/0 AWG",
      "35 in-lb / 4 N·m terminal torque",
      "Both handles ON in normal operation",
      "Compact IP65 finger-safe outer enclosure",
    ],
    note: "These two breakers replace both Class T fuse assemblies and the Blue Sea battery switch. Switch both OFF before servicing the main DC box; isolate a single string only after all loads and charging are stopped. Verify received terminal geometry, conductor preparation, enclosure fit and bend radius with a 1:1 mock-up.",
    sourceUrl: "https://www.midnitesolar.com/productPhoto.php?productCat_ID=16&product_ID=729",
  },
  {
    id: "batteryBreakerA",
    title: "String A 125 A breaker",
    kicker: "MidNite MNEPV125-80-1PNP",
    kind: "protection",
    summary: "Resettable 80 VDC protection and isolation for battery string A before it reaches the main positive bus.",
    specs: ["125 A · non-polarized", "14 AWG–1/0 AWG", "Normally ON", "Shared finger-safe enclosure"],
    sourceUrl: "https://www.midnitesolar.com/productPhoto.php?productCat_ID=16&product_ID=729",
  },
  {
    id: "batteryBreakerB",
    title: "String B 125 A breaker",
    kicker: "MidNite MNEPV125-80-1PNP",
    kind: "protection",
    summary: "Resettable 80 VDC protection and isolation for battery string B before it reaches the main positive bus.",
    specs: ["125 A · non-polarized", "14 AWG–1/0 AWG", "Normally ON", "Shared finger-safe enclosure"],
    sourceUrl: "https://www.midnitesolar.com/productPhoto.php?productCat_ID=16&product_ID=729",
  },
];
const componentIndex = dse.components.findIndex((item) => item.id === "classTFuseA");
dse.components = removeIds(dse.components, ["classTFuseA", "classTFuseB", "batterySelector"]);
dse.components.splice(componentIndex, 0, ...breakerComponents);
const positiveBus = byId(dse.components, "positiveBus");
positiveBus.summary = "Each 125 A battery-string breaker lands on a separate high-current position; protected feeds then leave for the MultiPlus, SmartSolar, services, Starlink and Ekrano/sense circuits.";
positiveBus.specs = [
  "4 × M10 (3/8 in) studs + 8 × M4 screws",
  "8 conductors used",
  "4 positions spare",
  "Red insulating cover included",
];
positiveBus.note = "High-current landings are breaker A, breaker B, MultiPlus and SmartSolar. Small positions serve the service feeder, Starlink, Ekrano and SmartShunt Vbatt+ sense lead. No lug doubling is required.";

const overview = dse.diagram.views.overview;
overview.regions[0].memberIds = overview.regions[0].memberIds.filter((id) => id !== "batterySelector");
overview.nodes = overview.nodes.filter((node) => node.id !== "batterySelector");
overview.nodes.push({ id: "batteryProtection", x: 380, y: 650 });
for (const edge of overview.edges) {
  if (edge.id === "ov-bat-pos") {
    edge.to = "batteryProtection";
    edge.label = "2 independent + leads";
  }
  if (edge.id === "ov-selector") {
    edge.id = "ov-breakers-positive";
    edge.from = "batteryProtection";
    edge.label = "2 × 125 A · normally ON";
  }
}

const detail = dse.diagram.views.detail;
detail.regions[0].memberIds = detail.regions[0].memberIds.filter((id) => id !== "batterySelector");
detail.nodes = detail.nodes.filter((node) => node.id !== "batterySelector");
for (const node of detail.nodes) {
  if (node.id === "classTFuseA") node.id = "batteryBreakerA";
  if (node.id === "classTFuseB") node.id = "batteryBreakerB";
}
detail.edges = detail.edges.filter((edge) => edge.id !== "dt-selector-positive");
for (const edge of detail.edges) {
  if (edge.id === "dt-a-class-t") {
    edge.id = "dt-a-breaker";
    edge.to = "batteryBreakerA";
    edge.label = "A + · short 1/0 AWG";
  }
  if (edge.id === "dt-a-pos") {
    edge.from = "batteryBreakerA";
    edge.to = "positiveBus";
    edge.label = "125 A protected A + · 1/0 AWG";
  }
  if (edge.id === "dt-b-class-t") {
    edge.id = "dt-b-breaker";
    edge.to = "batteryBreakerB";
    edge.label = "B + · short 1/0 AWG";
  }
  if (edge.id === "dt-b-pos") {
    edge.from = "batteryBreakerB";
    edge.to = "positiveBus";
    edge.label = "125 A protected B + · 1/0 AWG";
    edge.waypoints = [
      { x: 930, y: 1639 },
      { x: 1370, y: 1639 },
      { x: 1370, y: 1098 },
    ];
  }
}

dse.bom = removeIds(dse.bom, ["dse-class-t-holders", "dse-class-t-fuses", "dse-selector"]);
const batteryCable = byId(dse.bom, "dse-battery-cable");
batteryCable.unit = "11-cable set";
batteryCable.unitCost = 250;
batteryCable.totalUsd = 250;
batteryCable.description = "Factory-prepared UL 1426 flexible tinned-copper 1/0 AWG (53.5 mm²) assemblies with adhesive heat-shrink. Planning set: 2 × M8–M8 series links; 2 × battery-to-MidNite-breaker leads; 2 × MidNite-breaker-to-separate-M10-positive-bus leads; 2 × battery-negative-to-SmartShunt leads; 1 × shunt-to-negative-bus link; and 2 × buses-to-MultiPlus leads. Breaker ends must match the received MNEPV125-80-1PNP terminal instructions; do not assume a ring lug. Eleven assemblies total, about 23 ft planned. Finalize every route and termination from a 1:1 mock-up before ordering.";

const grease = byId(dse.bom, "dse-dielectric-grease");
Object.assign(grease, {
  unitCost: 10.49,
  totalUsd: 10.49,
  procurement: "Purchased",
  description: "Purchased from Amazon on 20 Aug 2026; Permatex 22058, 3 oz, ASIN B000AL8VD2. Use a thin film only on compatible, already-tightened exposed connections; never put grease between a lug and its current-carrying contact surface.",
});

const promotion = byId(dse.bom, "dse-amazon-promotion");
promotion.item = "Amazon order promotions";
promotion.unitCost = -83.22;
promotion.totalUsd = -83.22;
promotion.description = "Actual unallocated promotions across the Amazon orders through 21 Aug 2026: $77.94 on the 17 Aug Victron order and $5.28 on the 21 Aug PV-combiner order. Omitted from customs goods lines.";
const tax = byId(dse.bom, "dse-us-sales-tax");
tax.item = "U.S. sales tax on five Amazon orders";
tax.unitCost = 174.4;
tax.totalUsd = 174.4;
tax.description = "Actual U.S. sales tax across the five ingested Amazon orders through 21 Aug 2026: prior $136.45 plus $19.97, $12.06 and $5.92. Included in project cost; omitted from customs goods lines.";

const breakerRows = [
  {
    id: "dse-battery-string-breakers",
    category: "DC safety",
    item: "MidNite Solar MNEPV125-80-1PNP 125 A battery-string breakers",
    qty: 2,
    unit: "ea",
    unitCost: 55.98,
    currency: "USD",
    totalUsd: 111.96,
    location: "Import",
    procurement: "Purchased",
    priority: "Must",
    description: "Purchased from Amazon on 20 Aug 2026, order 111-2775226-7205039; ETA Aug 26–28. Two non-polarized 125 A / 80 VDC MidNite MNEPV125-80-1PNP breakers replace both Class T fuse assemblies and the battery selector. MidNite specifies UL 489A listing, 14 AWG–1/0 AWG conductor range and 35 in-lb / 4 N·m torque. Both remain ON in normal service; both switch OFF for whole-bank isolation.",
    productUrl: "https://www.amazon.com/dp/B0CFX5PW79",
    specUrl: "https://www.midnitesolar.com/productPhoto.php?productCat_ID=16&product_ID=729",
  },
  {
    id: "dse-battery-breaker-enclosure",
    category: "DC safety",
    item: "Compact finger-safe two-breaker enclosure",
    qty: 1,
    unit: "ea",
    unitCost: 25.99,
    currency: "USD",
    totalUsd: 25.99,
    location: "Import",
    procurement: "Buy",
    priority: "Must",
    description: "QILIPSU QL-VBB-6W six-way IP65 / UL94-V0 enclosure, 172 × 200 × 110 mm, used as a compact dead-front housing for both MidNite breakers. Remove or leave unused its small included busbars: each 1/0 AWG breaker output must run independently to a separate main-positive-bus stud. Confirm rail fit, terminal access and 1/0 AWG bend radius with the received breakers before drilling glands.",
    productUrl: "https://www.amazon.com/dp/B0CPV9NQ2M",
    specUrl: "https://qilipsu.com/product-265.html",
  },
];
insertBefore(dse.bom, "dse-pv-protection", breakerRows);

const pvProtection = byId(dse.bom, "dse-pv-protection");
Object.assign(pvProtection, {
  item: "CXCESNS 2-string / 1-output PV combiner, disconnect + SPD",
  unit: "ea",
  unitCost: 65.99,
  totalUsd: 65.99,
  procurement: "Purchased",
  description: "Purchased from Amazon on 21 Aug 2026, order 111-5362611-6708229; ETA Aug 22. ASIN B0FSQB97T2 is a true 2-in/1-out IP65 combiner with a 40 A / 600 VDC breaker and Type 2-style PV surge protector. Safety hold: its supplied 32 A string fuses exceed the Suntech module's 25 A maximum series-fuse rating. Do not commission it with those links; fit two correctly listed 20 A 10×38 mm gPV links and carry two matching spares, or have a qualified installer approve a listed equivalent.",
  productUrl: "https://www.amazon.com/dp/B0FSQB97T2",
});

const mainBusbars = byId(dse.bom, "dse-main-busbars");
mainBusbars.procurement = "Purchased";
mainBusbars.description = "Purchased from Amazon on 20 Aug 2026, ASIN B0DG4WLVT7: one red and one black covered 600 A / 48 VDC busbar, each with four M10 studs and eight M4 screws. The positive bar now uses eight positions and the negative bar six; no lug doubling is required. Inspect the received nickel-plated copper bars, covers and hardware before use.";
const vedirect = byId(dse.bom, "dse-vedirect-cables");
Object.assign(vedirect, {
  unitCost: 17.8,
  totalUsd: 35.6,
  procurement: "Purchased",
  description: "Two exact Victron ASS030530209 0.9 m VE.Direct cables purchased from Amazon on 20 Aug 2026 at $17.85 and $17.75. One connects SmartSolar to Ekrano and one connects SmartShunt to Ekrano.",
});
const vebus = byId(dse.bom, "dse-vebus-cable");
Object.assign(vebus, {
  item: "StarTech 10 ft yellow Cat6 VE.Bus patch lead",
  unitCost: 9.99,
  totalUsd: 9.99,
  procurement: "Purchased",
  description: "Purchased from Amazon on 20 Aug 2026, ASIN B003OCRW3E. Standard straight-through unshielded Cat6 lead from MultiPlus-II VE.Bus to Ekrano VE.Bus; the yellow jacket identifies the Victron control link. Bench-test before travel.",
  productUrl: "https://www.amazon.com/dp/B003OCRW3E",
});
const ethernet = byId(dse.bom, "dse-ekrano-ethernet");
Object.assign(ethernet, {
  item: "StarTech 10 ft red Cat6 Ekrano LAN patch lead",
  unitCost: 9.99,
  totalUsd: 9.99,
  procurement: "Purchased",
  description: "Purchased from Amazon on 20 Aug 2026, ASIN B003OCRW34. Unshielded Cat6 lead from Ekrano Ethernet to UniFi LAN; red identifies the monitoring LAN link.",
  productUrl: "https://www.amazon.com/dp/B003OCRW34",
});

insertBefore(dse.bom, "dse-junction-box", [
  {
    id: "dse-starlink-ethernet",
    category: "Network",
    item: "StarTech 10 ft blue Cat6 Starlink WAN patch lead",
    qty: 1,
    unit: "ea",
    unitCost: 8.99,
    currency: "USD",
    totalUsd: 8.99,
    location: "Import",
    procurement: "Purchased",
    priority: "Must",
    description: "Purchased from Amazon on 20 Aug 2026, ASIN B000KSEJV8. Blue straight-through Cat6 link from Starlink Ethernet to UniFi WAN. Protect any exterior transition and bench-test the complete network path before travel.",
    productUrl: "https://www.amazon.com/dp/B000KSEJV8",
  },
  {
    id: "dse-inline-connectors",
    category: "AC safety",
    item: "Oyviny IP68 three-pole inline junction connectors",
    qty: 1,
    unit: "4-pack",
    unitCost: 16.89,
    currency: "USD",
    totalUsd: 16.89,
    location: "Import",
    procurement: "Purchased",
    priority: "Should",
    description: "Four three-pole IP68 inline connectors purchased from Amazon on 20 Aug 2026, ASIN B0DZWYVYP8. Use only where the conductor size, voltage/current rating, strain relief and Fiji/AS-NZS installation requirements are verified by a qualified electrical person; these do not replace the AC-out RCBO or its enclosure.",
    productUrl: "https://www.amazon.com/dp/B0DZWYVYP8",
  },
  {
    id: "dse-mc4-tool-kit",
    category: "Tools",
    item: "MUYI 47-piece MC4 assembly tool kit",
    qty: 1,
    unit: "kit",
    unitCost: 22.99,
    currency: "USD",
    totalUsd: 22.99,
    location: "Import",
    procurement: "Purchased",
    priority: "Must",
    description: "Purchased from Amazon on 20 Aug 2026, ASIN B0BWRHMHY9. Includes the small-contact crimper and MC4 assembly tools for field PV work; test-crimp and pull-test representative 4 mm² cable before departure.",
    productUrl: "https://www.amazon.com/dp/B0BWRHMHY9",
  },
]);
const junction = byId(dse.bom, "dse-junction-box");
junction.description = junction.description.replace(/the whole-bank disconnect mounts on a fixed internal faceplate; /, "");
const spares = byId(dse.bom, "dse-service-spares");
spares.description = "Two spare 3.15 A Ekrano lead fuses, any Victron-required balancer sense fuses, two installed plus two spare correctly listed 20 A 10×38 mm gPV links for the purchased combiner, spare MC4 pair, corrosion inhibitor, replacement filter media and printed breaker/wiring labels. The main battery protection is resettable and needs no field fuse links.";
insertBefore(dse.bom, "dse-baggage", [
  {
    id: "dse-amazon-shipping",
    category: "Purchase adjustments",
    item: "Amazon supplier shipping on MidNite breakers",
    qty: 1,
    unit: "order",
    unitCost: 11.61,
    currency: "USD",
    totalUsd: 11.61,
    location: "Import",
    procurement: "Purchased",
    priority: "Reference",
    description: "Actual supplier shipping charged on Amazon order 111-2775226-7205039 for the two MidNite breakers. Included in project cost and in the customs landed-value working basis, but not a goods line on the packing manifest.",
  },
]);
const baggage = byId(dse.bom, "dse-baggage");
baggage.description = baggage.description.replace("24 ft 1/0 AWG cable set", "about 23 ft 1/0 AWG cable set").replace("4.6 kg / 10.2 lb", "4.4 kg / 9.8 lb");
const vat = byId(dse.bom, "dse-customs-vat");
vat.description = "Conservative rounded allowance pending the final Fiji concession decision and broker/customs valuation. Professional/technical equipment and goods above the passenger allowance must be declared; include all receipts and supplier shipping, and seek any renewable-energy or school-donation concession approval before travel.";

for (const sentence of dse.commissioning ?? []) {
  // The array is replaced below only through targeted string substitutions.
}
dse.commissioning = (dse.commissioning ?? []).map((line) =>
  line
    .replace(/buy or fix the exact Class T holders, Blue Sea 6006 disconnect, /g, "receive and bench-check both MidNite 125 A breakers and their finger-safe enclosure, ")
    .replace(/Order the 12 UL 1426/g, "Order the 11 UL 1426")
    .replace(/Fit a 150 A Class T fuse close to each string positive\.[^\n]*/g, "Fit one 125 A MidNite breaker close to each string positive in the separate finger-safe enclosure. Keep both breakers ON in normal operation, use both OFF for whole-bank isolation, and land the two protected outputs separately on the main positive bus. A faulted string may be isolated only after all loads and charging are stopped and the bank is diagnosed with a multimeter.")
);

// Remove superseded selector/Class-T references from research and add the actual breaker/enclosure sources.
dse.research = (dse.research ?? []).filter((entry) =>
  !/Class T|5114|6006 whole-bank|fuse-holder/i.test(entry.title),
);
dse.research.push(
  {
    title: "MNEPV125-80-1PNP 125 A / 80 VDC non-polarized breaker specifications",
    publisher: "MidNite Solar",
    url: "https://www.midnitesolar.com/productPhoto.php?productCat_ID=16&product_ID=729",
  },
  {
    title: "QL-VBB-6W IP65 enclosure dimensions and material",
    publisher: "QILIPSU",
    url: "https://qilipsu.com/product-265.html",
  },
);
writeJson("data/dse-system.json", dse);

const model = readJson("data/dse-model.json");
model.revision = "Design R15 · 21 Aug 2026";
delete model.scene.classTFuseMounting;
model.scene.batteryBreakerMounting = "one compact finger-safe enclosure holds both 125 A MidNite breakers close to the floor battery bank; no selector or Class T holders remain";
model.scene.junctionCableEntries = model.scene.junctionCableEntries
  .replace("only the two battery Class T devices and Victron-specified small inline fuses remain non-resettable", "battery-string protection is resettable in a separate enclosure; only Victron-specified small inline fuses and the purchased combiner's correctly downsized 20 A gPV links remain non-resettable")
  .replace("seventh positive-bus connection", "eighth positive-bus connection");
model.assumptions = model.assumptions.map((line) =>
  line.replace(/The two Class T holders mount directly to the plywood and heavy conductors route around the battery footprint\./, "A compact finger-safe enclosure holding both 125 A MidNite breakers mounts close to the batteries, and heavy conductors route around the battery footprint."),
);
model.connectionAudit.batteryStringProtection = {
  ports: ["String A breaker input", "String A breaker output", "String B breaker input", "String B breaker output"],
  connections: [
    "each string positive to its own MNEPV125-80-1PNP 125 A breaker",
    "each protected output to a separate main-positive-bus stud",
    "both breakers ON in normal service; both OFF for whole-bank isolation",
  ],
  mounting: "both breakers share one compact finger-safe IP65 enclosure close to the floor batteries",
};
model.envelopes = model.envelopes.filter((entry) => entry.id !== "battery-disconnect");
model.envelopes.push({
  id: "battery-breaker-enclosure",
  componentIds: ["batteryBreakerA", "batteryBreakerB"],
  quantity: 1,
  dimensionsMm: { width: 172, height: 200, depth: 110 },
  status: "verified enclosure envelope; breaker fit requires 1:1 check",
  sourceUrl: "https://qilipsu.com/product-265.html",
});
writeJson("data/dse-model.json", model);

const customs = readJson("data/dse-customs.json");
customs.checkedOn = "2026-08-21";
delete customs.itemMeta["dse-class-t-holders"];
delete customs.itemMeta["dse-class-t-fuses"];
delete customs.itemMeta["dse-selector"];
Object.assign(customs.itemMeta, {
  "dse-battery-string-breakers": {
    model: "2 × MidNite Solar MNEPV125-80-1PNP 125 A / 80 VDC breakers",
    origin: "Confirm from packaging",
    serialRequired: false,
  },
  "dse-battery-breaker-enclosure": {
    model: "QILIPSU QL-VBB-6W IP65 six-way enclosure",
    origin: "Confirm from packaging",
    serialRequired: false,
  },
  "dse-pv-protection": {
    model: "CXCESNS DC600V 40 A 2-string / 1-output PV combiner · ASIN B0FSQB97T2",
    origin: "Confirm from product label",
    serialRequired: false,
  },
  "dse-starlink-ethernet": {
    model: "StarTech N6PATCH10BL 10 ft blue Cat6 patch cable",
    origin: "Confirm from packaging",
    serialRequired: false,
  },
  "dse-inline-connectors": {
    model: "Oyviny IP68 three-pole inline connectors · 4-pack",
    origin: "Confirm from packaging",
    serialRequired: false,
  },
  "dse-mc4-tool-kit": {
    model: "MUYI 47-piece MC4 assembly tool kit",
    origin: "Confirm from packaging",
    serialRequired: false,
  },
});
customs.itemMeta["dse-vebus-cable"].model = "StarTech N6PATCH10YL 10 ft yellow Cat6 patch cable";
customs.itemMeta["dse-ekrano-ethernet"].model = "StarTech N6PATCH10RD 10 ft red Cat6 patch cable";
writeJson("data/dse-customs.json", customs);

const delivery = readJson("data/dse-delivery.json");
delivery.checkedOn = "2026-08-21";
for (const id of ["dse-class-t-holders", "dse-class-t-fuses", "dse-selector"]) delete delivery.items[id];
Object.assign(delivery.items, {
  "dse-battery-string-breakers": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased exact MidNite model",
    sourceUrl: "https://www.amazon.com/dp/B0CFX5PW79",
    eta: "Aug 26–28",
    time: "Purchased Aug 20",
    note: "Two MNEPV125-80-1PNP breakers purchased at $55.98 each; $11.61 supplier shipping and $12.06 sales tax are recorded separately.",
  },
  "dse-battery-breaker-enclosure": {
    amazonStatus: "available",
    sourceLabel: "Amazon · QILIPSU six-way enclosure",
    sourceUrl: "https://www.amazon.com/dp/B0CPV9NQ2M",
    eta: "Check at checkout",
    time: "$25.99 when researched",
    note: "Compact 172 × 200 × 110 mm IP65 / UL94-V0 enclosure. Confirm both received MidNite breakers, dead-front clearance and 1/0 AWG bend radius before purchase.",
  },
  "dse-pv-protection": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased CXCESNS 2-in/1-out combiner",
    sourceUrl: "https://www.amazon.com/dp/B0FSQB97T2",
    eta: "Aug 22",
    time: "Purchased Aug 21",
    note: "Purchased at $65.99 before a $5.28 order promotion. Replace its supplied 32 A string fuses with listed 20 A gPV links before commissioning; the Suntech module maximum series-fuse rating is 25 A.",
  },
  "dse-main-busbars": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased AMOMD pair",
    sourceUrl: "https://www.amazon.com/dp/B0DG4WLVT7",
    eta: "Aug 22",
    time: "Purchased Aug 20",
    note: "Purchased red/black pair for $89.99. Inspect the received current-path material, hardware and covers before assembly.",
  },
  "dse-vedirect-cables": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased Victron VE.Direct 0.9 m",
    sourceUrl: "https://www.amazon.com/dp/B01F9ESFZS",
    eta: "Aug 22",
    time: "Purchased Aug 20",
    note: "Two exact cables purchased at $17.85 and $17.75.",
  },
  "dse-vebus-cable": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased StarTech yellow Cat6",
    sourceUrl: "https://www.amazon.com/dp/B003OCRW3E",
    eta: "Aug 22",
    time: "Purchased Aug 20",
    note: "10 ft yellow unshielded Cat6 cable purchased for $9.99 and assigned to MultiPlus VE.Bus ↔ Ekrano VE.Bus.",
  },
  "dse-ekrano-ethernet": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased StarTech red Cat6",
    sourceUrl: "https://www.amazon.com/dp/B003OCRW34",
    eta: "Aug 22",
    time: "Purchased Aug 20",
    note: "10 ft red unshielded Cat6 cable purchased for $9.99 and assigned to Ekrano LAN ↔ UniFi LAN.",
  },
  "dse-starlink-ethernet": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased StarTech blue Cat6",
    sourceUrl: "https://www.amazon.com/dp/B000KSEJV8",
    eta: "Aug 22",
    time: "Purchased Aug 20",
    note: "10 ft blue Cat6 cable purchased for $8.99 and assigned to Starlink Ethernet ↔ UniFi WAN.",
  },
  "dse-inline-connectors": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased Oyviny 4-pack",
    sourceUrl: "https://www.amazon.com/dp/B0DZWYVYP8",
    eta: "Aug 22",
    time: "Purchased Aug 20",
    note: "Four IP68 three-pole connectors purchased for $16.89; use only after a qualified person verifies ratings and installation suitability.",
  },
  "dse-mc4-tool-kit": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased MUYI kit",
    sourceUrl: "https://www.amazon.com/dp/B0BWRHMHY9",
    eta: "Aug 22",
    time: "Purchased Aug 20",
    note: "47-piece MC4 tool kit purchased for $22.99.",
  },
  "dse-amazon-shipping": {
    amazonStatus: "not-applicable",
    sourceLabel: "Amazon supplier-shipping adjustment",
    eta: "Paid Aug 20",
    time: "No separate shipment",
    note: "$11.61 actual shipping on the MidNite breaker order.",
  },
});
delivery.items["dse-dielectric-grease"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · purchased exact 3 oz tube",
  sourceUrl: "https://www.amazon.com/dp/B000AL8VD2",
  eta: "Aug 22",
  time: "Purchased Aug 20",
  note: "Permatex 22058, 3 oz purchased for $10.49.",
};
delivery.items["dse-amazon-promotion"].eta = "Applied through Aug 21";
delivery.items["dse-amazon-promotion"].note = "Actual unallocated promotions across the Amazon receipts through Aug 21.";
delivery.items["dse-us-sales-tax"].eta = "Paid through Aug 21";
delivery.items["dse-us-sales-tax"].note = "Combined U.S. sales tax across all five ingested Amazon orders.";
writeJson("data/dse-delivery.json", delivery);
