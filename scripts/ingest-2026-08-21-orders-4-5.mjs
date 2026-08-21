import fs from "node:fs";

const paths = {
  system: new URL("../data/dse-system.json", import.meta.url),
  delivery: new URL("../data/dse-delivery.json", import.meta.url),
  customs: new URL("../data/dse-customs.json", import.meta.url),
  model: new URL("../data/dse-model.json", import.meta.url),
  orders: new URL("../private/amazon-orders-through-2026-08-21.json", import.meta.url),
};

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const write = (path, value) => fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const system = read(paths.system);
const delivery = read(paths.delivery);
const customs = read(paths.customs);
const model = read(paths.model);
const orders = read(paths.orders);

function bom(id) {
  const row = system.bom.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing BOM row: ${id}`);
  return row;
}

function component(id) {
  const row = system.components.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing component: ${id}`);
  return row;
}

function setBom(id, changes) {
  const row = bom(id);
  Object.assign(row, changes);
  row.totalUsd = money(row.qty * row.unitCost);
}

function upsertBom(row, beforeId) {
  const existing = system.bom.findIndex((candidate) => candidate.id === row.id);
  if (existing >= 0) system.bom.splice(existing, 1);
  const before = system.bom.findIndex((candidate) => candidate.id === beforeId);
  system.bom.splice(before >= 0 ? before : system.bom.length, 0, {
    ...row,
    totalUsd: money(row.qty * row.unitCost),
  });
}

function replaceText(value, replacements) {
  if (typeof value === "string") {
    return replacements.reduce((text, [from, to]) => text.replaceAll(from, to), value);
  }
  if (Array.isArray(value)) return value.map((item) => replaceText(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceText(item, replacements)]),
    );
  }
  return value;
}

const purchasedRcbos = {
  id: "dse-chtai-ac-rcbos-rejected",
  category: "AC safety",
  item: "CHTAIXI 10 A / 30 mA 120 V Type AC RCBOs · not for DSE installation",
  qty: 2,
  unit: "ea",
  unitCost: 16.38,
  currency: "USD",
  location: "Import",
  procurement: "Purchased",
  priority: "Do not install",
  description:
    "Purchased from Amazon on 21 Aug 2026, order 111-9142760-2257055; ETA Aug 22. Exact ASIN B0CSV93CTN is marked 120 VAC, 1P+N, 30 mA and earth-leakage Type AC. It is not suitable for the DSE 230 V / 50 Hz system and does not meet the design's Type A residual-current requirement. Keep out of the installation and return if practical; both units still appear on the cost and customs records while owned.",
  productUrl: "https://www.amazon.com/dp/B0CSV93CTN",
  specUrl: "https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/installation.html",
};
upsertBom(purchasedRcbos, "dse-ac-rcbo");

setBom("dse-ac-rcbo", {
  item: "230 V two-pole 10 A / 30 mA Type A RCBO",
  procurement: "Buy",
  priority: "Must",
  description:
    "Required downstream protection for MultiPlus AC-out. Buy a genuine 230 V, two-pole, 10 A, 30 mA Type A RCBO from a Fiji electrical supplier; the two purchased CHTAIXI B0CSV93CTN units are 120 V Type AC devices and must not be installed. A qualified electrical person must verify neutral switching, fault protection, trip performance and Fiji/AS-NZS compliance.",
  productUrl: undefined,
});
delete bom("dse-ac-rcbo").productUrl;

setBom("dse-unifi-converter", {
  procurement: "Purchased",
  description:
    "Purchased from Amazon on 21 Aug 2026, order 111-9142760-2257055; ETA Aug 22. ASIN B0G1W6JTX8 is a compact 12–32 VDC to fixed-5 V USB-A converter claiming up to 5 A / 25 W and multiple electrical/thermal protections. Mount inside the junction box on the protected INTERNET pole-B branch and bench-test repeated UniFi Express cold starts before travel.",
});
setBom("dse-indoor-light", {
  description:
    "Purchased from Amazon on 17 Aug 2026 and delivered 19 Aug. ASIN B0F1V59NXC: compact 12–28 V, 900 lm, 3000 K warm-white, IP67 utility light. Suspend it inside from a short dry bracket with its lens facing down. Feed its positive from the 6 A CHTAIXI B-curve breaker through the INSIDE rocker and two series silicon diodes, then run one 2-core 1.5 mm² cable to the fixture; negative returns directly to the 24 V return bus.",
});
setBom("dse-outdoor-light", {
  description:
    "Purchased from Amazon on 17 Aug 2026 and delivered 19 Aug. ASIN B0F1V59NXC: compact 12–28 V, 900 lm, 3000 K warm-white, IP67 down-angle exterior light with die-cast aluminum housing and a simple red/black input. Feed its positive from the 6 A CHTAIXI B-curve breaker through the OUTSIDE rocker and two series silicon diodes, then run one 2-core 1.5 mm² cable to the fixture. Mount under an eave, use 316 stainless fasteners and sealed bedding, and inspect periodically for salt corrosion.",
});

const accessoryRows = [
  {
    id: "dse-multimeter",
    category: "Tools & accessories",
    item: "Klein Tools MM325 digital multimeter",
    qty: 1,
    unit: "ea",
    unitCost: 29.98,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Service tool",
    description:
      "Purchased from Amazon on 21 Aug 2026, order 111-9142760-2257055; ETA Aug 22. Manual-ranging meter for battery/string diagnosis, polarity, continuity, resistance and AC/DC voltage checks. It is a carried commissioning/service accessory and is intentionally not shown in the fixed wiring diagrams or 3D installation.",
    productUrl: "https://www.amazon.com/dp/B0B57L9FNL",
  },
  {
    id: "dse-aa-aaa-charger",
    category: "Tools & accessories",
    item: "EBL universal AA/AAA rechargeable-battery charger",
    qty: 1,
    unit: "ea",
    unitCost: 13.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Portable accessory",
    description:
      "Purchased from Amazon on 21 Aug 2026, order 111-9142760-2257055; ETA Aug 22. USB-C-powered independent-slot charger for 1.2 V Ni-MH/Ni-Cd and compatible 1.5 V rechargeable AA/AAA cells. This is portable school equipment, not a charger for the solar battery bank, and is not shown in the fixed system diagrams.",
    productUrl: "https://www.amazon.com/dp/B0FZR3HX62",
  },
  {
    id: "dse-10awg-duplex-wire",
    category: "Wiring",
    item: "10 AWG red/black duplex copper wire · 10 ft",
    qty: 1,
    unit: "roll",
    unitCost: 19.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Install stock",
    description:
      "Purchased from Amazon on 21 Aug 2026, order 111-6868471-0482610; ETA Aug 22. Ten-foot red/black pair of stranded oxygen-free copper conductors. Use only on a circuit whose measured route, ampacity, insulation rating, temperature rating and terminal fit are compatible; it is not large enough for the 85–100 A SmartSolar branch or the 1/0 AWG battery circuits.",
    productUrl: "https://www.amazon.com/dp/B0DGL7QVVF",
  },
  {
    id: "dse-starlink-portable-usbc-cables",
    category: "Network accessories",
    item: "Starlink Mini USB-C PD power cables · 6.6 ft",
    qty: 2,
    unit: "ea",
    unitCost: 9.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Portable accessory",
    description:
      "Two Genioss USB-C-to-Starlink-Mini DC cables purchased from Amazon on 21 Aug 2026, order 111-6868471-0482610; ETA Aug 22. Intended only for portable use with a verified 100 W USB-C PD source; they are not part of the fixed DSE power route and therefore do not appear in the wiring diagram or 3D model.",
    productUrl: "https://www.amazon.com/dp/B0DD12LJNF",
  },
  {
    id: "dse-starlink-portable-battery-cable",
    category: "Network accessories",
    item: "Starlink Mini direct-battery portable power cable · 16.4 ft",
    qty: 1,
    unit: "ea",
    unitCost: 21.97,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Portable accessory",
    description:
      "SegurVelo 18 AWG O-ring-to-Starlink-Mini lead with inline ATC/ATO holder purchased from Amazon on 21 Aug 2026, order 111-6868471-0482610; ETA Aug 22. This is for separately supervised portable operation, not the fixed DSE system. Confirm polarity, fit the correct fuse, protect the battery terminals and never attach it to one 12 V monobloc while that monobloc remains series-connected in the 24 V bank.",
    productUrl: "https://www.amazon.com/dp/B0F7LDGP2P",
  },
];

for (const row of accessoryRows) upsertBom(row, "dse-service-spares");

setBom("dse-starlink-ethernet", {
  item: "CHGRNLF 15 ft weatherproof Starlink Mini Ethernet cable",
  qty: 1,
  unit: "ea",
  unitCost: 25.98,
  procurement: "Purchased",
  priority: "Must",
  description:
    "Purchased from Amazon on 21 Aug 2026, order 111-6868471-0482610; ETA Aug 22. Purpose-built 15 ft weatherproof Starlink Mini Ethernet cable from the roof unit to the UniFi Express WAN connection. Bench-test the complete path and preserve the weather seal at the Mini.",
  productUrl: "https://www.amazon.com/dp/B0D8J3HC7Z",
});

upsertBom(
  {
    id: "dse-cat6-blue-spare",
    category: "Network accessories",
    item: "StarTech 10 ft blue Cat6 patch cable · spare",
    qty: 1,
    unit: "ea",
    unitCost: 8.99,
    currency: "USD",
    location: "Import",
    procurement: "Purchased",
    priority: "Spare",
    description:
      "Purchased from Amazon on 20 Aug 2026, ASIN B000KSEJV8. Superseded in the roof-to-UniFi route by the purpose-built weatherproof CHGRNLF Starlink Mini cable; retain this ordinary straight-through Cat6 lead as an indoor network spare.",
    productUrl: "https://www.amazon.com/dp/B000KSEJV8",
  },
  "dse-starlink-ethernet",
);

setBom("dse-amazon-promotion", {
  unitCost: -85.82,
  description:
    "Actual order-level promotions and coupon savings across the seven reconciled Amazon orders through 21 Aug 2026. Kept as one negative adjustment because the receipts do not allocate every discount cleanly to individual items.",
});
setBom("dse-us-sales-tax", {
  item: "U.S. sales tax on seven Amazon orders",
  unitCost: 191.07,
  description:
    "Actual U.S. sales tax across the seven reconciled Amazon orders through 21 Aug 2026, including $8.36 on order 111-9142760-2257055 and $8.31 on order 111-6868471-0482610.",
});

// CHTAIXI's low-current B-curve range starts at 6 A. Use it only on
// downstream branches whose conductors safely carry 6 A. Keep the two
// battery-bus-fed breakers at MidNite's verified 10 kA interrupt rating:
// the ES200-12G bank can theoretically exceed the CHTAIXI line's 6 kA claim.
setBom("dse-breaker-mnedc100", {
  procurement: "Specialist buy",
  description:
    "Retain the resettable, non-polarized MidNite MNEDC100: 150 VDC and 10 kA interrupt rating for the battery-bus-fed SmartSolar branch. The CHTAIXI B0B1WDDC75 candidate is only 6 kA and its listing calls the range suitable for low-short-circuit-current circuits; two parallel ES200-12G strings can theoretically exceed 6 kA from the published 2.8 mΩ battery resistance, so it is not an appropriate substitution without a documented prospective-fault-current study.",
});
setBom("dse-breaker-mnepv20", {
  procurement: "Specialist buy",
  description:
    "Retain the non-polarized MidNite MNEPV20, rated 150 VDC / 10 kA, as the direct battery-bus service feeder. It gives the lower-cost downstream CHTAIXI branch bank a verified high-interrupt upstream device. Do not substitute CHTAIXI B09H4WNK3S here without a documented fault-current and series-coordination assessment.",
});
setBom("dse-breaker-mnepv15", {
  item: "CHTAIXI B15 15 A DC USB-station breaker",
  unitCost: 8.99,
  procurement: "Buy",
  description:
    "Polarized single-pole B-curve breaker for the USB charging-station branch, used only downstream of the retained 20 A / 10 kA MidNite service feeder. Amazon claims 12–110 VDC operation and IEC 60947-2. Observe marked polarity and have the qualified installer verify the received rating, conductor size, series coordination and Fiji acceptance before commissioning.",
  productUrl: "https://www.amazon.com/dp/B09H4WQ1QJ",
  specUrl: "https://www.amazon.com/stores/page/0C1264F8-9BBA-45D7-BDFB-B1A21EF78729",
});
setBom("dse-breaker-mnepv5", {
  item: "CHTAIXI B6 6 A DC Starlink breakers",
  qty: 2,
  unitCost: 8.99,
  procurement: "Buy",
  description:
    "One polarized 6 A B-curve breaker for the Starlink branch plus one exact field spare. CHTAIXI does not sell a 5 A unit in this range; 6 A remains below the planned conductor ampacity and is used only downstream of the retained 20 A / 10 kA MidNite feeder. Observe marked polarity and obtain installer approval.",
  productUrl: "https://www.amazon.com/dp/B09H4XZLCR",
  specUrl: "https://www.amazon.com/stores/page/0C1264F8-9BBA-45D7-BDFB-B1A21EF78729",
});
setBom("dse-breaker-mnepv2", {
  item: "CHTAIXI B6 6 A DC UniFi-converter breaker",
  unitCost: 8.99,
  procurement: "Buy",
  description:
    "Polarized 6 A B-curve breaker for the short UniFi converter branch, downstream of the retained 20 A / 10 kA MidNite feeder. CHTAIXI does not offer a 2 A model in this range; use conductors rated for at least 6 A, observe polarity and bench-test converter fault protection before commissioning.",
  productUrl: "https://www.amazon.com/dp/B09H4XZLCR",
  specUrl: "https://www.amazon.com/stores/page/0C1264F8-9BBA-45D7-BDFB-B1A21EF78729",
});
setBom("dse-breaker-mnepv1", {
  item: "CHTAIXI B6 6 A DC light breakers",
  qty: 2,
  unitCost: 8.99,
  procurement: "Buy",
  description:
    "One polarized 6 A B-curve breaker per 1.5 mm² light branch, downstream of the retained 20 A / 10 kA MidNite feeder. CHTAIXI does not offer a 1 A model in this range; 6 A protects the specified 1.5 mm² conductors but is not intended as internal fixture protection. Observe marked polarity and obtain installer approval.",
  productUrl: "https://www.amazon.com/dp/B09H4XZLCR",
  specUrl: "https://www.amazon.com/stores/page/0C1264F8-9BBA-45D7-BDFB-B1A21EF78729",
});
setBom("dse-usb-breakers", {
  item: "CHTAIXI B10 10 A DC USB-module breakers",
  qty: 3,
  unit: "ea",
  unitCost: 8.99,
  procurement: "Buy",
  description:
    "Three polarized 10 A B-curve DIN breakers provide one resettable branch per Scanstrut charging module inside the charging-station enclosure. They are downstream of both the junction's retained 20 A / 10 kA MidNite feeder and the 15 A CHTAIXI station breaker. Observe marked polarity and confirm enclosure fit, conductor ampacity and installer acceptance.",
  productUrl: "https://www.amazon.com/dp/B09H4W5HSW",
  specUrl: "https://www.amazon.com/stores/page/0C1264F8-9BBA-45D7-BDFB-B1A21EF78729",
});

const distribution = component("fuseBlock");
distribution.kicker = "High-interrupt feeder · resettable branch bank";
distribution.summary =
  "A MidNite 100 A SmartSolar breaker and MidNite 20 A high-interrupt service feeder protect the two battery-bus-fed circuits; five lower-cost CHTAIXI breakers protect the downstream positive branches. Black load conductors return unswitched and unbroken to the negative bus.";
distribution.specs = [
  "MidNite MNEDC100 · 100 A SmartSolar output · 10 kA",
  "MidNite MNEPV20 · 20 A service feeder · 10 kA",
  "CHTAIXI B6 · 6 A Starlink",
  "CHTAIXI B6 · 6 A UniFi converter",
  "CHTAIXI B15 · 15 A six-port USB panel",
  "2 × CHTAIXI B6 · 6 A indoor / outdoor lights",
  "Six-breaker service bank · 3 inputs / 6 protected outputs",
  "CHTAIXI branches are polarized · observe marked line/load direction",
  "Blue Sea 2314 return bus · 6 used landings + 1 spare",
];
distribution.note =
  "The six-breaker service bank has three incoming positive conductors and six outgoing protected conductors. The retained MidNite 20 A service feeder and 6 A Starlink breaker each have an independent input and output; one short common-input comb supplies the adjacent UniFi, USB, inside-light and outside-light CHTAIXI breakers. Only positives pass through breakers and switches. The CHTAIXI devices are allowed only downstream of the 10 kA MidNite feeder, must be wired in their marked DC polarity, and require installer verification of series coordination and Fiji acceptance.";
distribution.sourceUrl = "https://www.amazon.com/stores/page/0C1264F8-9BBA-45D7-BDFB-B1A21EF78729";

component("starlink").specs = component("starlink").specs.map((spec) =>
  spec === "5 A resettable DC breaker at nominal 24 V"
    ? "6 A CHTAIXI B-curve DC breaker at nominal 24 V"
    : spec,
);
component("unifiPower").specs = component("unifiPower").specs.map((spec) =>
  spec === "2 A breakered nominal-24 V input"
    ? "6 A CHTAIXI B-curve breakered nominal-24 V input"
    : spec,
);
for (const id of ["indoorLight", "outdoorLight"]) {
  component(id).specs = component(id).specs.map((spec) =>
    spec === "1 A breakered source-side switch"
      ? "6 A CHTAIXI B-curve breaker · source-side switch"
      : spec,
  );
}
component("usb").specs = component("usb").specs.map((spec) =>
  spec === "Local 3 × 10 A resettable module breakers"
    ? "Local 3 × CHTAIXI B10 resettable DC breakers"
    : spec,
);

for (const view of Object.values(system.diagram.views)) {
  for (const edge of view.edges) {
    if (edge.id === "ov-starlink-24") edge.label = "Starlink · switched 24 V / 6 A";
    if (edge.id === "dt-star-feed") edge.label = "Starlink 24 V · 6 A breaker → INTERNET A";
  }
}

system.summary = system.summary.replace(
  "The SmartSolar output and every service positive also use resettable MidNite Solar DC breakers.",
  "The battery-bus-fed SmartSolar and service-feeder circuits retain high-interrupt MidNite DC breakers; lower-current downstream services use polarized CHTAIXI B-curve breakers after the MidNite feeder.",
);
system.budget.note =
  "Panels, batteries, the UniFi Express, three QHLightlux fixtures, the Amazon Victron order and all additional Amazon electrical/accessory orders through 21 Aug 2026 are included in the project total as purchased. A 20% deposit has also been paid toward the MultiPlus-II, which will be supplied in Fiji; its $939 row remains a USD planning value until the Fiji invoice total and deposit amount are entered. The estimated $607.11 Ekrano GX increment remains donor-funded pending the final border-cost reconciliation. Two QHLightlux fixtures are installed and the third is a carried spare. The purchased Orion 24/12-30A and portable Starlink power leads are carried accessories rather than installed loads. Seven Amazon receipts are reconciled through separate promotion, supplier-shipping and U.S.-sales-tax adjustment rows. Freight beyond Nadi, panel mounting, Starlink hardware and labor are excluded.";

system.operatingRules = system.operatingRules.map((rule) =>
  rule.startsWith("Install the resettable DC breaker map exactly as documented:")
    ? "Install the resettable DC breaker map exactly as documented: MidNite MNEDC100 SmartSolar and MNEPV20 service feeder; downstream CHTAIXI B6 Starlink, B6 UniFi, B15 USB panel and 2 × B6 lights. Feed Starlink from its 6 A breaker into INTERNET pole A and return it to the main negative bus; INTERNET pole B switches UniFi, and the two SPST rockers switch only their light positives. Wire every CHTAIXI DC breaker in its marked polarity, use conductors rated for the selected breaker and have the qualified installer verify series coordination and Fiji acceptance."
    : rule,
);
system.commissioning = system.commissioning.map((step) => {
  if (step.startsWith("Install the resettable DC breaker map exactly as documented:")) {
    return "Install the resettable DC breaker map exactly as documented: MidNite MNEDC100 SmartSolar and MNEPV20 service feeder; downstream CHTAIXI B6 Starlink, B6 UniFi, B15 USB panel and 2 × B6 lights. Feed Starlink from its 6 A breaker into INTERNET pole A and return it to the main negative bus; INTERNET pole B switches UniFi, and the two SPST rockers switch only their light positives. Wire every CHTAIXI DC breaker in its marked polarity, use conductors rated for the selected breaker and have the qualified installer verify series coordination and Fiji acceptance.";
  }
  if (step.startsWith("Build the six-port charging station")) {
    return "Build the six-port charging station from one Scanstrut SC-TILE-20 and two SC-TILE-10 modules in one dry interior faceplate/back box. Feed one 15 A protected 24 V pair from the junction box, split it locally through three CHTAIXI B10 resettable 10 A DC breakers, label the four USB-C and two USB-A ports, and load-test all modules simultaneously before travel.";
  }
  return step;
});

system.research = system.research.filter(
  (entry) => !entry.title.startsWith("CHTAIXI ") && entry.title !== "ES200-12G published internal resistance and maximum discharge current",
);
system.research.push(
  {
    title: "CHTAIXI 120 V Type AC RCBO · purchased but rejected for DSE",
    publisher: "Amazon / CHTAIXI",
    url: "https://www.amazon.com/dp/B0CSV93CTN",
  },
  {
    title: "CHTAIXI 12–110 VDC B-curve branch-breaker range",
    publisher: "Amazon / CHTAIXI",
    url: "https://www.amazon.com/stores/page/0C1264F8-9BBA-45D7-BDFB-B1A21EF78729",
  },
  {
    title: "ES200-12G published internal resistance and maximum discharge current",
    publisher: "EverExceed datasheet mirror",
    url: "https://jelakum.com/picture/dosya/everexceed-solar-gel-range-vrla_v20pdf17.pdf",
  },
);

const modelReplacements = [
  ["local split through 3 × Blue Sea 2132 resettable 10 A module breakers", "local split through 3 × CHTAIXI B10 resettable 10 A DC breakers"],
  ["2 A resettable-breaker branch through INTERNET pole B", "6 A CHTAIXI B-curve breaker through INTERNET pole B"],
  ["dedicated 24 V / 5 A resettable-breaker branch through INTERNET pole A", "dedicated 24 V / 6 A CHTAIXI B-curve breaker through INTERNET pole A"],
  ["1 A resettable-breaker positive through INSIDE rocker", "6 A CHTAIXI B-curve positive through INSIDE rocker"],
  ["1 A resettable-breaker positive through OUTSIDE rocker", "6 A CHTAIXI B-curve positive through OUTSIDE rocker"],
];
Object.assign(model, replaceText(model, modelReplacements));
const breakerModel = model.envelopes.find((item) => item.id === "breaker-block");
if (breakerModel) {
  breakerModel.status = "mixed verified-envelope / exact breaker fit to confirm";
  breakerModel.sourceUrl = "https://www.amazon.com/stores/page/0C1264F8-9BBA-45D7-BDFB-B1A21EF78729";
}

Object.assign(delivery.items, {
  "dse-chtai-ac-rcbos-rejected": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased CHTAIXI B0CSV93CTN",
    sourceUrl: "https://www.amazon.com/dp/B0CSV93CTN",
    eta: "Aug 22",
    time: "Purchased Aug 21",
    note: "Do not install: exact listing is 120 VAC, 1P+N and Type AC, not the required 230 V Type A device. Return if practical.",
  },
  "dse-multimeter": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased Klein MM325",
    sourceUrl: "https://www.amazon.com/dp/B0B57L9FNL",
    eta: "Aug 22",
    time: "Purchased Aug 21",
    note: "Portable commissioning and service tool; not a fixed system component.",
  },
  "dse-aa-aaa-charger": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased EBL AA/AAA charger",
    sourceUrl: "https://www.amazon.com/dp/B0FZR3HX62",
    eta: "Aug 22",
    time: "Purchased Aug 21",
    note: "Portable accessory; not a solar-bank charger.",
  },
  "dse-10awg-duplex-wire": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased 10 AWG duplex wire",
    sourceUrl: "https://www.amazon.com/dp/B0DGL7QVVF",
    eta: "Aug 22",
    time: "Purchased Aug 21",
    note: "Unassigned installation stock pending final measured routes; not suitable for 85–100 A circuits.",
  },
  "dse-starlink-portable-usbc-cables": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased Genioss cables",
    sourceUrl: "https://www.amazon.com/dp/B0DD12LJNF",
    eta: "Aug 22",
    time: "Purchased Aug 21",
    note: "Two portable-use 100 W USB-C PD power leads; not installed in DSE fixed wiring.",
  },
  "dse-starlink-portable-battery-cable": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased SegurVelo battery lead",
    sourceUrl: "https://www.amazon.com/dp/B0F7LDGP2P",
    eta: "Aug 22",
    time: "Purchased Aug 21",
    note: "Portable-use direct-battery cable; not installed in the fixed 24 V system.",
  },
  "dse-cat6-blue-spare": {
    amazonStatus: "purchased",
    sourceLabel: "Amazon · purchased StarTech blue Cat6",
    sourceUrl: "https://www.amazon.com/dp/B000KSEJV8",
    eta: "Delivered / prior order",
    time: "Purchased Aug 20",
    note: "Retained as an indoor spare after the purpose-built weatherproof Starlink Mini cable became primary.",
  },
});

delivery.items["dse-ac-rcbo"] = {
  amazonStatus: "unavailable",
  sourceLabel: "Fiji electrical supplier · genuine 230 V Type A RCBO",
  eta: "Buy in Fiji",
  time: "Confirm exact compliant stock before commissioning",
  note: "The purchased CHTAIXI B0CSV93CTN is 120 V Type AC and cannot substitute. Use a two-pole 230 V, 10 A, 30 mA Type A RCBO selected and tested by the qualified installer.",
};
delivery.items["dse-unifi-converter"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · purchased YRDZXG B0G1W6JTX8",
  sourceUrl: "https://www.amazon.com/dp/B0G1W6JTX8",
  eta: "Aug 22",
  time: "Purchased Aug 21",
  note: "Mount inside the junction box and bench-test repeated UniFi Express cold starts before travel.",
};
delivery.items["dse-starlink-ethernet"] = {
  amazonStatus: "purchased",
  sourceLabel: "Amazon · purchased CHGRNLF Starlink Mini cable",
  sourceUrl: "https://www.amazon.com/dp/B0D8J3HC7Z",
  eta: "Aug 22",
  time: "Purchased Aug 21",
  note: "Purpose-built 15 ft weatherproof Mini-to-UniFi Ethernet route; preserve the Mini weather seal.",
};
delivery.items["dse-breaker-mnedc100"].note =
  "Retain the exact 10 kA MidNite MNEDC100. The $11.97 CHTAIXI B0B1WDDC75 is only 6 kA and is rejected for this direct battery-bus branch because the published ES200-12G resistance permits a theoretical bank fault above 6 kA.";
delivery.items["dse-breaker-mnedc100"].secondaryLabel = "Rejected CHTAIXI 100 A candidate";
delivery.items["dse-breaker-mnedc100"].secondaryUrl = "https://www.amazon.com/dp/B0B1WDDC75";
delivery.items["dse-breaker-mnepv20"].note =
  "Retain the exact 10 kA MidNite MNEPV20 on the direct battery bus. The $8.99 CHTAIXI B20 is listed for low-short-circuit-current applications and lacks documented series coordination for this role.";
delivery.items["dse-breaker-mnepv20"].secondaryLabel = "Rejected CHTAIXI 20 A direct-bus candidate";
delivery.items["dse-breaker-mnepv20"].secondaryUrl = "https://www.amazon.com/dp/B09H4WNK3S";

for (const [id, label, url, count] of [
  ["dse-breaker-mnepv15", "Amazon · CHTAIXI B15", "https://www.amazon.com/dp/B09H4WQ1QJ", "Buy 1"],
  ["dse-breaker-mnepv5", "Amazon · CHTAIXI B6", "https://www.amazon.com/dp/B09H4XZLCR", "Buy 2; one is spare"],
  ["dse-breaker-mnepv2", "Amazon · CHTAIXI B6", "https://www.amazon.com/dp/B09H4XZLCR", "Buy 1"],
  ["dse-breaker-mnepv1", "Amazon · CHTAIXI B6", "https://www.amazon.com/dp/B09H4XZLCR", "Buy 2"],
  ["dse-usb-breakers", "Amazon · CHTAIXI B10", "https://www.amazon.com/dp/B09H4W5HSW", "Buy 3"],
]) {
  delivery.items[id] = {
    amazonStatus: "available",
    sourceLabel: label,
    sourceUrl: url,
    eta: "Aug 26",
    time: `${count} · $8.99 each when checked Aug 21`,
    note: "Polarized 12–110 VDC B-curve breaker. Use only in the documented downstream position, observe marked polarity and obtain qualified-installer approval before commissioning.",
  };
}

Object.assign(customs.itemMeta, {
  "dse-chtai-ac-rcbos-rejected": {
    model: "2 × CHTAIXI TXB7sLE-63 / sLE-1PN C10 RCBO · ASIN B0CSV93CTN · not for installation",
    origin: "Confirm from packaging",
    serialRequired: false,
    defaultCondition: "New — purchased but rejected for DSE installation",
  },
  "dse-multimeter": {
    model: "Klein Tools MM325 digital multimeter · ASIN B0B57L9FNL",
    origin: "Confirm from product label",
    serialRequired: false,
  },
  "dse-aa-aaa-charger": {
    model: "EBL universal AA/AAA USB-C charger · ASIN B0FZR3HX62",
    origin: "Confirm from product label",
    serialRequired: false,
  },
  "dse-10awg-duplex-wire": {
    model: "10 AWG red/black duplex copper wire, 10 ft · ASIN B0DGL7QVVF",
    origin: "Confirm from packaging",
    serialRequired: false,
  },
  "dse-starlink-portable-usbc-cables": {
    model: "2 × Genioss Starlink Mini USB-C PD power cable, 6.6 ft · ASIN B0DD12LJNF",
    origin: "Confirm from packaging",
    serialRequired: false,
  },
  "dse-starlink-portable-battery-cable": {
    model: "SegurVelo Starlink Mini direct-battery cable, 16.4 ft · ASIN B0F7LDGP2P",
    origin: "Confirm from packaging",
    serialRequired: false,
  },
  "dse-cat6-blue-spare": {
    model: "StarTech N6PATCH10BL 10 ft blue Cat6 patch cable",
    origin: "Confirm from packaging",
    serialRequired: false,
  },
});
customs.itemMeta["dse-starlink-ethernet"] = {
  model: "CHGRNLF Starlink Mini weatherproof Ethernet cable, 15 ft · ASIN B0D8J3HC7Z",
  origin: "Confirm from packaging",
  serialRequired: false,
};
customs.itemMeta["dse-unifi-converter"] = {
  model: "YRDZXG B0G1W6JTX8 12/24 V-to-5 V USB converter",
  origin: "Confirm from product label",
  serialRequired: false,
};
for (const [id, modelName] of [
  ["dse-breaker-mnepv15", "CHTAIXI 12–110 VDC B15 single-pole breaker · ASIN B09H4WQ1QJ"],
  ["dse-breaker-mnepv5", "2 × CHTAIXI 12–110 VDC B6 single-pole breakers · ASIN B09H4XZLCR"],
  ["dse-breaker-mnepv2", "CHTAIXI 12–110 VDC B6 single-pole breaker · ASIN B09H4XZLCR"],
  ["dse-breaker-mnepv1", "2 × CHTAIXI 12–110 VDC B6 single-pole breakers · ASIN B09H4XZLCR"],
  ["dse-usb-breakers", "3 × CHTAIXI 12–110 VDC B10 single-pole breakers · ASIN B09H4W5HSW"],
]) {
  customs.itemMeta[id] = {
    model: modelName,
    origin: "Confirm from packaging",
    serialRequired: false,
  };
}

const latestOrders = [
  {
    date: "2026-08-21",
    orderNumber: "111-9142760-2257055",
    receiptFile: "amazon-2026-08-21-order-111-9142760-2257055-ac-breakers-converter-tools.pdf",
    itemsSubtotalUsd: 85.72,
    shippingUsd: 0,
    taxUsd: 8.36,
    grandTotalUsd: 94.08,
    items: [
      { qty: 2, item: "CHTAIXI 10 A / 30 mA 120 V Type AC RCBO", asin: "B0CSV93CTN", unitCostUsd: 16.38, disposition: "Do not install in DSE" },
      { qty: 1, item: "YRDZXG 12/24 V-to-5 V 5 A USB converter", asin: "B0G1W6JTX8", unitCostUsd: 8.99 },
      { qty: 1, item: "Klein Tools MM325 digital multimeter", asin: "B0B57L9FNL", unitCostUsd: 29.98 },
      { qty: 1, item: "EBL universal AA/AAA rechargeable-battery charger", asin: "B0FZR3HX62", unitCostUsd: 13.99 },
    ],
  },
  {
    date: "2026-08-21",
    orderNumber: "111-6868471-0482610",
    receiptFile: "amazon-2026-08-21-order-111-6868471-0482610-wire-starlink-accessories.pdf",
    itemsSubtotalUsd: 87.92,
    shippingUsd: 2.99,
    freeShippingUsd: -2.99,
    promotionUsd: -2.6,
    taxUsd: 8.31,
    grandTotalUsd: 93.63,
    items: [
      { qty: 1, item: "10 AWG red/black duplex copper wire, 10 ft", asin: "B0DGL7QVVF", unitCostUsd: 19.99 },
      { qty: 1, item: "CHGRNLF Starlink Mini weatherproof Ethernet cable, 15 ft", asin: "B0D8J3HC7Z", unitCostUsd: 25.98 },
      { qty: 2, item: "Genioss Starlink Mini USB-C PD power cable, 6.6 ft", asin: "B0DD12LJNF", unitCostUsd: 9.99 },
      { qty: 1, item: "SegurVelo Starlink Mini direct-battery cable, 16.4 ft", asin: "B0F7LDGP2P", unitCostUsd: 21.97 },
    ],
  },
];
const latestNumbers = new Set(latestOrders.map((order) => order.orderNumber));
orders.orders = [...orders.orders.filter((order) => !latestNumbers.has(order.orderNumber)), ...latestOrders];
orders.newOrdersReconciliation = {
  goodsUsd: 556.52,
  promotionsUsd: -7.88,
  shippingUsd: 11.61,
  taxUsd: 54.62,
  grandTotalUsd: 614.87,
};

write(paths.system, system);
write(paths.delivery, delivery);
write(paths.customs, customs);
write(paths.model, model);
write(paths.orders, orders);

console.log("Ingested Amazon orders 111-9142760-2257055 and 111-6868471-0482610.");
