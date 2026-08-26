import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const write = (name, value) => {
  const target = path.join(root, name);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.readFileSync(target, "utf8") !== serialized) fs.writeFileSync(target, serialized);
};
const amazon125 = "https://www.amazon.com/dp/B0B1WC651R";

const system = read("data/dse-system.json");
system.schemaVersion = "r22-canonical-graph";
system.revision = "Design R22 · 24 Aug 2026";
system.status = "Canonical graph rebuild · commissioning holds open";
system.summary = "DSE/Fiji has one canonical device–conductor–connection graph behind both the detailed diagram and routed 3D model. Four 565 W panels feed the SmartSolar through two resettable 20 A common-trip PV string breakers and breaker-top positive/negative comb rails, then the SPD and two-pole disconnect. Two 24 V battery strings land through selected CHTAIXI B125 breakers before the covered positive bus, and the SmartSolar branch uses the same selected B125 style; all three substitutions remain installation holds until interrupt capacity, polarity and conductor protection are accepted. The main junction has one DIN rail with exactly five breakers: two battery-string B125 devices, one SmartSolar B125 device, one 20 A ordinary-service feeder and one 10 A shared switched-service breaker. All USB breakers and dedicated USB busbars are removed: the two cigarette sockets are daisy chained from Orion +OUT/common return and the four ChargeIT Minis are daisy chained from the main 24 V buses. These unprotected branches remain visibly marked DO NOT ENERGIZE until a qualified installer resolves supply-conductor protection. The six-gang panel controls Starlink + UniFi, outdoor light and Orion H remote, with three spares. AC protection remains in the canonical graph, but the purchased eight-way cover is too small for the clean separated routing envelope and is no longer the selected installation enclosure.";
system.budget.note = system.budget.note.replace(
  "The purchased eight-way AC enclosure is budgeted for two four-module protection assemblies after an exact fit check.",
  "The purchased Mollom eight-way AC enclosure remains in the cost/customs record only as an owned spare; the unselected 24 × 24 × 12 in replacement enclosure remains a separate allowance pending a full-size fit check.",
);
delete system.diagram;

if (Array.isArray(system.components)) {
  const componentById = new Map(system.components.map((component) => [component.id, component]));
  Object.assign(componentById.get("batteryProtection"), {
  title: "Internal dual CHTAIXI B125 battery-string breakers",
  kicker: "2 × selected 125 A · installation hold",
  sourceUrl: amazon125,
  });
  for (const id of ["batteryBreakerA", "batteryBreakerB"]) Object.assign(componentById.get(id), {
  title: `${id.endsWith("A") ? "String A" : "String B"} 125 A B125 breaker`,
  kicker: "CHTAIXI DZ47NZ-125 · 1-pole · 6 kA claim · hold",
  sourceUrl: amazon125,
  });
  Object.assign(componentById.get("mpptFuse"), {
  title: "SmartSolar 125 A B125 breaker candidate",
  kicker: "CHTAIXI DZ47NZ-125 · installation hold",
  sourceUrl: amazon125,
  });
  Object.assign(componentById.get("essentialLoads"), {
  kicker: "Ordinary protected services + requested direct-bus USB branches on hold",
  });
  Object.assign(componentById.get("orionUsb"), {
  kicker: "Victron Orion 24/12-30 · direct 24 V input requested · hold",
  });
  Object.assign(componentById.get("usb"), {
  kicker: "590 W nominal · 8 USB-C + 4 USB-A · direct-bus branches on hold",
  });
}
delete system.components;

if (system.batteryCablePlan) {
  system.batteryCablePlan.measurementRule = "Buy only after a 1:1 layout using the received CHTAIXI B125 sample and the auto-sized main junction. Verify that the B125 terminal accepts the selected 1/0 AWG conductor or specify a listed transition; do not trim strands. Place the junction immediately above the battery bank, preserve broad bend radii, keep paired A/B paths equal and confirm every termination before ordering.";
  system.batteryCablePlan.assemblies = system.batteryCablePlan.assemblies.map((assembly) => ({
    ...assembly,
    from: assembly.from === "Battery 1/3 negative" ? "Battery 1/3 positive" : assembly.from.replaceAll("MidNite", "CHTAIXI B125"),
    to: assembly.to === "Battery 2/4 positive" ? "Battery 2/4 negative" : assembly.to.replaceAll("MidNite", "CHTAIXI B125"),
    lugs: assembly.lugs.replaceAll("MNEPV125-80-1PNP", "received B125").replaceAll("MidNite", "CHTAIXI B125"),
  }));
}

const bomById = new Map(system.bom.map((item) => [item.id, item]));
const wallBoard = bomById.get("dse-wall-board");
if (wallBoard) {
  wallBoard.description = wallBoard.description.replace(
    "around the imported compact junction box",
    "around the imported main junction enclosure",
  );
}
const previousBattery = bomById.get("dse-battery-string-breakers");
if (previousBattery && !bomById.has("dse-battery-string-breakers-midnite-unused")) {
  const index = system.bom.indexOf(previousBattery);
  system.bom.splice(index + 1, 0, {
    ...previousBattery,
    id: "dse-battery-string-breakers-midnite-unused",
    item: "Owned MidNite MNEPV125 battery breakers · no longer selected in R22",
    location: "Import",
    priority: "Not in design",
    includedInTotal: false,
    description: `${previousBattery.description} R22 replaces these in the modeled installation with the lower-cost CHTAIXI B125 selection. Keep this row because the two MidNite breakers were already purchased and remain part of the receipt/customs record; return them if practical or retain them only as qualified alternates.`,
  });
}
const ownedMidniteBattery = system.bom.find((item) => item.id === "dse-battery-string-breakers-midnite-unused");
if (ownedMidniteBattery) Object.assign(ownedMidniteBattery, {
  location: "Import",
  priority: "Not in design · return / alternate",
  includedInTotal: false,
});
Object.assign(previousBattery, {
  item: "CHTAIXI DZ47NZ-125 B125 125 A single-pole battery-string breakers",
  qty: 2,
  unitCost: 11.97,
  totalUsd: 23.94,
  procurement: "Buy · installation hold",
  priority: "Must · verify",
  productUrl: amazon125,
  specUrl: "https://m.media-amazon.com/images/I/81SNSe8ULbL.pdf",
  description: "R22 selection from the supplied Amazon link, ASIN B0B1WC651R: one polarized B125 breaker per 24 V battery string inside the main junction at the positive cable entry. The listing identifies the DZ47NZ-125 family as thermal-magnetic, B-curve and 6 kA Ics/Icu. Do not order or energize until a qualified installer verifies received polarity/markings, terminal capacity, conductor ampacity, DC interrupt capacity and the prospective fault current of one ES200-12G string.",
});
Object.assign(bomById.get("dse-breaker-mnedc100"), {
  item: "CHTAIXI DZ47NZ-125 B125 125 A single-pole SmartSolar branch breaker",
  unitCost: 11.97,
  totalUsd: 11.97,
  procurement: "Buy · installation hold",
  priority: "Must · verify",
  productUrl: amazon125,
  specUrl: "https://www.victronenergy.com/upload/documents/Manual-SmartSolar-MPPT-150-70-up-to-250-100-VE.Can/29694-MPPT_solar_charger_manual-pdf-en.pdf",
  description: "R22 substitution requested from supplied Amazon link/ASIN B0B1WC651R. The selected B125 is shown between the SmartSolar battery-positive terminal and the main positive bus. This is not commission-ready: 125 A exceeds Victron's typical 100 A protection recommendation for the 150/85, and the listing's 6 kA claim is below the approximately 8.6–9.6 kA simple upper-bound obtained from two parallel strings using the batteries' published 2.8 mΩ resistance. Obtain a documented conductor/fault-current/series-coordination study or use a suitably rated alternative.",
});
Object.assign(bomById.get("dse-switched-load-breaker"), {
  item: "CHTAIXI B10 10 A shared switched-load breaker",
  qty: 1,
  totalUsd: 8.99,
  description: "One polarized B10 breaker is installed downstream of the retained MidNite 20 A / 10 kA feeder and protects the combined ordinary switch array, remote room-light circuit, internet loads, outdoor light and low-current Orion remote-enable signal. USB charging power bypasses this branch entirely.",
});
Object.assign(bomById.get("dse-battery-cable"), {
  description: "Factory-prepared UL 1426 flexible tinned-copper 1/0 AWG (53.5 mm²) assemblies with adhesive heat-shrink. Planning set: 2 × M8–M8 series links; 2 × battery-to-CHTAIXI-B125 leads; 2 × B125-to-separate-M10-positive-bus leads; 2 × battery-negative-to-SmartShunt leads; 1 × shunt-to-negative-bus link; and 2 × buses-to-MultiPlus leads. Breaker ends must match the received B125 terminal instructions; never trim strands to fit. Eleven assemblies total, 20 ft planned from the individual allowances. Finalize every route and termination from the canonical 1:1 model and a physical mock-up before ordering.",
});
Object.assign(bomById.get("dse-junction-box"), {
  item: "IP-rated main junction enclosure allowance · nominal 48 × 24 × 12 in",
  unitCost: 1000,
  totalUsd: 1000,
  procurement: "Allowance · size before purchase",
  description: "The canonical layout resolves a 1040 × 440 × 220 mm usable envelope for the five-device DIN rail, SmartShunt, covered main/service buses, service splits, converters, wiring clearances and one evenly spaced 24-gland bottom row. Source an unselected nominal 48 × 24 × 12 in / 1219 × 610 × 305 mm enclosure whose usable backplate is at least 1040 × 440 mm and whose usable depth is at least 220 mm. The $1,000 and 76 kg values are conservative planning allowances based on the comparable enclosure-plus-panel size class, not a product selection. Confirm received internal dimensions in the canonical graph before purchase approval or drilling. Mount directly above the batteries, keep breaker handles accessible and guard high-fault-current terminals.",
  unitWeightKg: 76,
  totalWeightKg: 76,
  weightBasis: "estimate",
  weightSourceUrl: "https://www.saginawcontrol.com/partnumber_info/?n=SCE-244812WFLP",
  weightNote: "Planning shipment estimate based on the comparable Saginaw SCE-244812WFLP 24 × 48 × 12 in steel enclosure plus SCE-48P24 full-size backplate; neither product is selected and the final shipment may differ.",
});
const pvProtection = bomById.get("dse-pv-protection");
Object.assign(pvProtection, {
  description: "Purchased on 21 Aug 2026. Retain the SPD and common disconnect only if a qualified installer approves the rebuilt entry assembly. The canonical backplate layout resolves a 320 × 280 × 150 mm usable enclosure with one evenly spaced seven-gland bottom row. It has no standalone combiner component: insulated positive and negative comb rails run across the top terminals of both common-trip 20 A string breakers, the SPD and the disconnect. Measure the received box and replace it if its usable envelope is smaller. Do not install the supplied 32 A fuse links.",
});
delete pvProtection.specUrl;

const ownedAcEnclosure = bomById.get("dse-ac-enclosure");
if (ownedAcEnclosure) Object.assign(ownedAcEnclosure, {
  item: "Owned Mollom HT-8 eight-way DIN cover · too small for canonical AC box",
  priority: "Not in design · owned spare",
  description: "Purchased on 23 Aug 2026, ASIN B09XJZDRNM. Its advertised 200 × 155 × 92 mm shell consumes all eight nominal ways with the two four-module protection assemblies and does not provide the canonical conductor separation, bend space and five-gland bottom row. Keep it in the cost/customs record as an owned spare; do not install it for this AC assembly.",
});
if (ownedAcEnclosure) delete ownedAcEnclosure.specUrl;
if (!bomById.has("dse-ac-install-enclosure")) {
  const acIndex = system.bom.findIndex((item) => item.id === "dse-ac-enclosure");
  const acInstallEnclosure = {
    id: "dse-ac-install-enclosure",
    category: "AC safety",
    item: "IP66/NEMA 4X AC protection enclosure allowance · nominal 24 × 24 × 12 in",
    qty: 1,
    unit: "ea",
    unitCost: 250,
    currency: "USD",
    totalUsd: 250,
    location: "Import",
    procurement: "Allowance · source after fit check",
    priority: "Must",
    description: "The canonical clean-routing envelope is 520 × 360 × 220 mm with a back-mounted DIN rail, two four-module RCBO/SPD devices, PE daisy splices and one five-gland bottom row. Source an unselected corrosion-resistant nominal 24 × 24 × 12 in / 610 × 610 × 305 mm enclosure whose usable backplate is at least 520 × 360 mm and whose usable depth is at least 220 mm. The $250 and 25 kg values are conservative planning allowances for this size class, not a product selection. Use a 1:1 backplate mock-up and received-dimension check before purchase approval or drilling.",
    unitWeightKg: 25,
    totalWeightKg: 25,
    weightBasis: "estimate",
    weightSourceUrl: "https://www.vevor.com/electrical-enclosure-c_10749/vevor-24x24x12-carbon-steel-electrical-enclosure-wall-mount-junction-box-ip65-p_010361595893",
    weightNote: "Planning shipment estimate rounded from the comparable VEVOR 24 × 24 × 12 in steel enclosure; that product is not selected and the final shipment may differ.",
  };
  system.bom.splice(acIndex + 1, 0, acInstallEnclosure);
  bomById.set(acInstallEnclosure.id, acInstallEnclosure);
}
const acInstallEnclosure = bomById.get("dse-ac-install-enclosure");
Object.assign(acInstallEnclosure, {
  item: "IP66/NEMA 4X AC protection enclosure allowance · nominal 24 × 24 × 12 in",
  unitCost: 250,
  totalUsd: 250,
  procurement: "Allowance · source after fit check",
  priority: "Must",
  description: "The canonical clean-routing envelope is 520 × 360 × 220 mm with a back-mounted DIN rail, two four-module RCBO/SPD devices, PE daisy splices and one five-gland bottom row. Source an unselected corrosion-resistant nominal 24 × 24 × 12 in / 610 × 610 × 305 mm enclosure whose usable backplate is at least 520 × 360 mm and whose usable depth is at least 220 mm. The $250 and 25 kg values are conservative planning allowances for this size class, not a product selection. Use a 1:1 backplate mock-up and received-dimension check before purchase approval or drilling.",
  unitWeightKg: 25,
  totalWeightKg: 25,
  weightBasis: "estimate",
  weightSourceUrl: "https://www.vevor.com/electrical-enclosure-c_10749/vevor-24x24x12-carbon-steel-electrical-enclosure-wall-mount-junction-box-ip65-p_010361595893",
  weightNote: "Planning shipment estimate rounded from the comparable VEVOR 24 × 24 × 12 in steel enclosure; that product is not selected and the final shipment may differ.",
});
delete acInstallEnclosure.productUrl;
delete acInstallEnclosure.specUrl;

const removeBomIds = new Set(["dse-usb-socket-breakers", "dse-usb-orion-breaker", "dse-usb-module-breakers", "dse-usb-distribution-buses"]);
system.bom = system.bom.filter((item) => !removeBomIds.has(item.id));
Object.assign(bomById.get("dse-usb-output-breaker"), {
  item: "Owned CHTAIXI B60 breaker · removed from USB topology",
  location: "Import",
  priority: "Not in design",
  includedInTotal: false,
  description: "Purchased on 23 Aug 2026, ASIN B09H4W8CLY. R22 removes this breaker from between the Orion and cigarette-lighter sockets. Keep it out of the installed USB circuit; retain as an owned spare or return it. It remains in the BOM and customs record because it was purchased.",
});
Object.assign(bomById.get("dse-usb"), {
  description: "Two purchased on 21 Aug 2026, order 111-6534905-1228221. Keep each factory cigarette-lighter plug intact in its secured female socket. The two sockets are daisy chained from Orion +OUT and the common negative return, with no upstream USB breaker; do not energize this branch until conductor protection is accepted.",
});
Object.assign(bomById.get("dse-usb-sockets"), {
  description: "Two purchased on 21 Aug 2026, order 111-6534905-1228221. Secure both ends and keep any listed/integral lead protection intact unless the manufacturer and installer approve a sealed retermination. Orion +OUT/common return feed socket A, then positive and negative daisy conductors continue to socket B. There is no discrete breaker, so the entire branch remains an installation hold.",
});
Object.assign(bomById.get("dse-chargeit-mini-75"), {
  description: "Four purchased on 21 Aug 2026, order 111-6534905-1228221. One positive and one negative feed leave the main 24 V buses for module A, then both polarities daisy chain A→B→C→D. There are no discrete USB breakers or USB busbars. Confirm the received Phoenix-plug landing capacity—including whether a twin ferrule is accepted—and obtain documented supply-conductor protection before energizing; the graph marks the chain on hold.",
});
Object.assign(bomById.get("dse-usb-station-wiring"), {
  description: "Allowance for the wall-mounted Orion, two secured socket/145 W charger pairs and four wall-mounted ChargeIT modules. The Orion uses four conductors (+IN, common GND, +OUT and H remote); +OUT/common return daisy chain socket A→B, while one 24 V positive/negative pair daisy chains ChargeIT A→B→C→D. There is no separate station box, gland bank, USB busbar or USB breaker. Include wall clips, strain relief, maker-approved single/twin ferrules or pigtail splices after received-terminal checks, ring terminals at the main buses and durable labels.",
});
Object.assign(bomById.get("dse-service-return-bus"), {
  description: "Purchased on 23 Aug 2026, order 111-9984111-5737060, ASIN B000OTJ89Q. Use this one covered Blue Sea 2314 only as the low-current service-return bus. It provides two #10-32 studs and five #8-32 screw positions. No additional 2314 bars are required because the USB distribution buses were removed.",
});
Object.assign(bomById.get("dse-terms"), {
  description: "Exact-fit termination allowance driven by the canonical conductor metadata: M8 heavy closed lugs at ES200-12G and MultiPlus DC; M10 heavy closed lugs at SmartShunt and the main buses; M6 closed lug at MultiPlus chassis; 5/16 and #10 rings at Blue Sea 2128; #10 and #8 rings at Blue Sea 2314; M5 rings at PV frames; MC4-family PV mates; bare fine-strand copper or maker-approved ferrules at WAGO/Victron/screw clamps; and received-plug-approved single/twin bootlace ferrules or pigtails at ChargeIT daisy landings. Never trim strands. Fork/Y terminals are permitted only at a terminal explicitly rated for them after measurement; heavy cables remain custom preterminated.",
});

const usbFact = system.keyFacts.find((fact) => fact.label === "USB charging");
if (usbFact) usbFact.detail = "8 × USB-C · 4 × USB-A · no USB breakers · hold";
const breakerFact = system.keyFacts.find((fact) => fact.label === "Battery switching");
if (breakerFact) breakerFact.detail = "2 × selected B125 · verify 6 kA claim";
const acOutputFact = system.keyFacts.find((fact) => fact.label === "AC output");
if (acOutputFact) acOutputFact.detail = "3 kVA · dedicated AC protection enclosure";

if (system.powerModel?.assumptions) {
  const assumptionsBeforeUsbIdle = system.powerModel.assumptions.split("Coolgear does not publish")[0].trimEnd();
  system.powerModel.assumptions = `${assumptionsBeforeUsbIdle} Coolgear does not publish the 145 W charger's idle draw, so measure each received unit. The requested R22 topology has no USB breakers; use ORION REMOTE H to shut down the daisy-chained 145 W socket branch, and keep both USB supply chains de-energized until their conductor-protection holds are resolved.`;
}

system.operatingRules = system.operatingRules.map((rule) => {
  if (rule.startsWith("Keep the AC inverter off")) return "Keep the AC inverter off when no AC loads are required. Use STARLINK + UNIFI to shut down Starlink and UniFi overnight, and use ORION REMOTE H to put the Orion below 1 mA remote-off standby. The four daisy-chained ChargeIT Minis have no remote shutoff; measure their combined idle draw only after their protection hold is resolved. Until then, leave both unprotected USB supply chains de-energized.";
  if (rule.startsWith("Keep both internal 125 A")) return "Keep both internal 125 A battery-string breakers ON in normal service only after the selected CHTAIXI devices pass the documented fault-current, polarity, terminal and acceptance checks. Switch both OFF after AC loads, MultiPlus, PV and generator charging are shut down. Nominal 24 V is touch-safe by project policy, but battery fault energy remains substantial.";
  return rule;
});
system.commissioning = system.commissioning
  .filter((rule) => (
    !rule.startsWith("Install the resettable DC breaker map exactly") &&
    !rule.startsWith("Build the USB wall as individually") &&
    !rule.startsWith("Build the main DIN rail from the canonical graph") &&
    !rule.startsWith("Treat every direct-bus USB connection") &&
    !rule.startsWith("Treat both daisy-chained USB supplies") &&
    !rule.startsWith("Use the canonical graph as the wiring authority")
  ))
  .map((rule) => {
    if (rule.startsWith("Fit both 125 A MidNite")) return "Fit the two selected 125 A CHTAIXI B125 breakers on the single main-junction DIN rail immediately adjacent to their battery-positive entries, but do not energize until the received markings, polarity, 6 kA interrupt claim, terminal capacity and site prospective fault current are accepted. Land the two outputs separately on the covered positive bus and guard all terminals.";
    if (rule.startsWith("With the 24 V bank isolated")) return "With the 24 V bank isolated, make a full-size enclosure and wall-layout mock-up. The canonical main layout resolves a 1040 × 440 × 220 mm usable envelope and 24 bottom glands. Source an unselected nominal 48 × 24 × 12 in / 1219 × 610 × 305 mm enclosure with at least a 1040 × 440 mm usable backplate and at least 220 mm usable depth. Mount it directly above the batteries so both unprotected positive entries are as short as practical; preserve access to the five breaker handles, cable bends and terminal guards.";
    if (rule.startsWith("Have a qualified electrical person make a full-size fit check of the purchased HT-8") || rule.startsWith("Reject the purchased Mollom HT-8")) return "Reject the purchased Mollom HT-8 for the installed AC assembly: keep it only as a customs-tracked owned spare. Before ordering or drilling its replacement, have a qualified electrical person make a full-size backplate and five-gland-row fit check. The canonical AC layout needs a 520 × 360 mm usable backplate and at least 220 mm usable depth, so plan around an unselected nominal 24 × 24 × 12 in / 610 × 610 × 305 mm enclosure for the two independently accepted four-way 10 A / 30 mA Type A RCBO + Type 2 SPD assemblies. Keep both purchased 30 A DIHOOL units de-energized until exchanged/refunded or backed by separate correctly rated 10 A overcurrent protection in the accepted replacement enclosure. Verify exact markings, 230 V / 50 Hz suitability, L/N polarity, trip operation and generator/bypass behavior.";
    return rule;
  });
system.commissioning.push(
  "Build the main DIN rail from the canonical graph in this exact left-to-right order: string A B125; string B B125; SmartSolar B125; ordinary-services 20 A; shared switched-services 10 A. There are no USB breakers on this rail or elsewhere in R22.",
  "Treat both daisy-chained USB supplies as commissioning holds. Before energizing the Orion input/socket chain or the ChargeIT A→B→C→D chain, have the qualified installer document how every source and onward conductor is protected against the available battery fault current and verify all two-conductor landings. Integral load protection alone does not protect an upstream supply lead.",
  "Use the canonical graph as the wiring authority: every physical device and conductor in the detailed diagram is the same object rendered in 3D. Resolve graph validation or A* routing failures in code; do not add hand-positioned glands, routing exceptions or undocumented wires.",
);

write("data/dse-system.json", system);

const delivery = read("data/dse-delivery.json");
if (delivery.items["dse-battery-string-breakers"] && !delivery.items["dse-battery-string-breakers-midnite-unused"]) {
  delivery.items["dse-battery-string-breakers-midnite-unused"] = {
    ...delivery.items["dse-battery-string-breakers"],
    note: "Already purchased MidNite pair; no longer selected in R22. Return if practical or retain only as qualified alternates.",
  };
}
delivery.items["dse-battery-string-breakers"] = {
  amazonStatus: "available",
  sourceLabel: "Amazon · CHTAIXI B125 B0B1WC651R",
  sourceUrl: amazon125,
  eta: "Verify before order",
  time: "$11.97 each when checked 24 Aug",
  note: "R22 selected style; installation hold pending prospective-fault-current and received-marking checks.",
};
delivery.items["dse-breaker-mnedc100"] = {
  amazonStatus: "available",
  sourceLabel: "Amazon · CHTAIXI B125 B0B1WC651R",
  sourceUrl: amazon125,
  eta: "Verify before order",
  time: "$11.97 when checked 24 Aug",
  note: "R22 SmartSolar substitution; do not commission without 125 A conductor and 6 kA fault-current acceptance.",
};
if (delivery.items["dse-junction-box"]) Object.assign(delivery.items["dse-junction-box"], {
  amazonStatus: "not-found",
  sourceLabel: "Unselected 48 × 24 × 12 in enclosure class",
  eta: "Source after 1:1 mock-up",
  time: "$1,000 planning allowance · no product selected",
  note: "Needs at least a 1040 × 440 mm usable backplate, at least 220 mm usable depth and one 24-gland bottom row. Confirm received usable internal dimensions—not only advertised outer dimensions—before purchase approval.",
});
if (delivery.items["dse-junction-box"]) delete delivery.items["dse-junction-box"].sourceUrl;
delivery.items["dse-ac-install-enclosure"] = {
  amazonStatus: "not-found",
  sourceLabel: "Unselected 24 × 24 × 12 in IP66/NEMA 4X enclosure class",
  eta: "Source after 1:1 fit check",
  time: "$250 planning allowance · no product selected",
  note: "Needs at least a 520 × 360 mm usable backplate, at least 220 mm usable depth and five bottom glands. The owned Mollom HT-8 is only a customs-tracked spare.",
};
if (delivery.items["dse-ac-enclosure"]) delivery.items["dse-ac-enclosure"].note = "Purchased and retained in the cost/customs record, but too small for the canonical AC routing envelope; owned spare, not selected for installation.";
if (delivery.items["dse-service-return-bus"]) delivery.items["dse-service-return-bus"].note = "Allocated as the only low-current service-return bus. No additional 2314 USB distribution bars are required.";
delivery.items["dse-switched-load-breaker"] = {
  amazonStatus: "available",
  sourceLabel: "Amazon · CHTAIXI B10",
  sourceUrl: "https://www.amazon.com/dp/B09H4W5HSW",
  eta: "Verify before order",
  time: "Buy 1 · $8.99 when checked",
  note: "The single installed B10 protects the combined switched-load group downstream of the 20 A / 10 kA MidNite feeder. Observe marked DC polarity.",
};
for (const id of removeBomIds) delete delivery.items[id];
if (delivery.items["dse-usb-output-breaker"]) delivery.items["dse-usb-output-breaker"].note = "Purchased but removed from the R22 USB topology; return or retain as an uninstalled spare.";
write("data/dse-delivery.json", delivery);

const customs = read("data/dse-customs.json");
if (customs.itemMeta["dse-battery-string-breakers"] && !customs.itemMeta["dse-battery-string-breakers-midnite-unused"]) {
  customs.itemMeta["dse-battery-string-breakers-midnite-unused"] = customs.itemMeta["dse-battery-string-breakers"];
}
Object.assign(customs.itemMeta["dse-battery-string-breakers"] ??= {}, {
  model: "2 × CHTAIXI DZ47NZ-125 B125 125 A / 1P breaker · ASIN B0B1WC651R",
  serialRequired: false,
});
Object.assign(customs.itemMeta["dse-breaker-mnedc100"] ??= {}, {
  model: "CHTAIXI DZ47NZ-125 B125 125 A / 1P breaker · ASIN B0B1WC651R",
  serialRequired: false,
});
Object.assign(customs.itemMeta["dse-junction-box"] ??= { origin: "" }, {
  model: "Unselected IP-rated main enclosure · nominal 48 × 24 × 12 in / 1219 × 610 × 305 mm · minimum usable 1040 × 440 × 220 mm",
  serialRequired: false,
});
Object.assign(customs.itemMeta["dse-ac-install-enclosure"] ??= { origin: "" }, {
  model: "Unselected IP66/NEMA 4X AC enclosure · nominal 24 × 24 × 12 in / 610 × 610 × 305 mm · minimum usable 520 × 360 × 220 mm",
  serialRequired: false,
});
Object.assign(customs.itemMeta["dse-switched-load-breaker"] ??= {}, {
  model: "CHTAIXI 12–110 VDC B10 single-pole breaker · ASIN B09H4W5HSW",
  serialRequired: false,
});
for (const id of removeBomIds) delete customs.itemMeta[id];
write("data/dse-customs.json", customs);

console.log("Updated R22 system, delivery and customs data from the canonical topology.");
