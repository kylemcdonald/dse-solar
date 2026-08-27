import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolve = (relativePath) => path.join(root, relativePath);
const readJson = (relativePath) => JSON.parse(fs.readFileSync(resolve(relativePath), "utf8"));
const writeJson = (relativePath, value) =>
  fs.writeFileSync(resolve(relativePath), `${JSON.stringify(value, null, 2)}\n`);

const system = readJson("data/dse-system.json");
const findBom = (id) => {
  const row = system.bom.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing BOM row: ${id}`);
  return row;
};
const upsertBom = (row, beforeId = "dse-amazon-promotion") => {
  const existing = system.bom.findIndex((candidate) => candidate.id === row.id);
  if (existing >= 0) system.bom.splice(existing, 1);
  const before = system.bom.findIndex((candidate) => candidate.id === beforeId);
  system.bom.splice(before >= 0 ? before : system.bom.length, 0, row);
};

upsertBom({
  id: "dse-existing-generator",
  category: "Existing equipment",
  item: "Husqvarna G3200P petrol generator",
  qty: 1,
  unit: "ea",
  unitCost: 0,
  currency: "USD",
  totalUsd: 0,
  location: "Fiji",
  procurement: "Purchased · pre-existing",
  priority: "Existing backup source · verify nameplate",
  accountingGroup: "excluded",
  includedInTotal: false,
  description: "Already owned before this solar project and now explicitly recorded as purchased/pre-existing equipment. Husqvarna publishes approximately 2.8 kW rated output for the 230 V / 50 Hz G3200P family, while model-family maximum ratings vary. Confirm the actual unit nameplate, Fiji receptacle, resettable outlet-breaker rating, protective-earth continuity and neutral-earth arrangement before connecting the held 10 A generator-input circuit.",
  productUrl: "https://www.husqvarna.com/my/generators/g3200p/",
  specUrl: "https://www-static-nw.husqvarna.com/hbd/tdrdownload/v2/pub000092074/doc000221989/OM/67_v-w4tEgqdgrxTerwPMkodyk8?httproute=True",
  unitWeightKg: 49,
  totalWeightKg: 49,
  weightBasis: "manufacturer",
  weightSourceUrl: "https://www.husqvarna.com/my/generators/g3200p/",
  weightNote: "Manufacturer product-family net weight. Existing in Fiji and excluded from import shipping/budget totals.",
});

upsertBom({
  id: "dse-existing-pv-comb-rails",
  category: "PV safety",
  item: "Pre-existing insulated positive/negative PV comb rails",
  qty: 1,
  unit: "pair",
  unitCost: 0,
  currency: "USD",
  totalUsd: 0,
  location: "Fiji",
  procurement: "Existing · already owned",
  priority: "Must · verify rating and fit",
  accountingGroup: "excluded",
  includedInTotal: false,
  description: "The insulated positive and negative comb rails are already existing/owned hardware, not a future purchase. The combined two-string path carries 26.56 A at maximum-power current, so verify at least 32 A continuous capacity, insulation, tooth pitch, breaker/SPD/disconnect compatibility, creepage/clearance and retention before use. Existing ownership does not remove this received-part safety check.",
  unitWeightKg: 0,
  totalWeightKg: 0,
  weightBasis: "not-applicable",
  weightNote: "Existing Fiji inventory; not part of imported shipping weight.",
});

Object.assign(findBom("dse-pv-protection"), {
  description: "Purchased on 21 Aug 2026. Retain the SPD and common disconnect only if a qualified installer approves the rebuilt entry assembly. The canonical backplate layout resolves a 320 × 280 × 150 mm usable enclosure with one evenly spaced seven-gland bottom row. The pre-existing insulated positive/negative comb rails connect the two common-trip 20 A string breakers, SPD and disconnect. Each string remains on 4 mm² conductors; after combining, use the revised 6 mm² / 32 A-rated positive and negative pair to the SmartSolar. Verify every rail/device rating and terminal fit. Do not install the supplied 32 A fuse links.",
});

Object.assign(findBom("dse-multiplus"), {
  priority: "Must · DC branch redesign hold",
  description: `${findBom("dse-multiplus").description.split(" The normal system budget")[0].split(" The exact 24/3000/70 installation table")[0]} The normal system budget applies the posted one-tool limit of 1,800 W rather than assuming the inverter's full 2.4 kW rating is a continuous load. At the conservative 19 V input floor and 94% efficiency, 1,800 W is about 100.8 A DC and fits the modeled 120 A branch-cable envelope. The exact 24/3000/70 installation table still requires a 300 A external DC protective device and at least 50 mm² copper for a 0–5 m run. The canonical graph therefore keeps its direct main-bus DC branch on a genuine fault-protection hold: select a resettable DC breaker with adequate interrupt capacity and coordinate it with the final conductor, 250 A bus architecture, battery-string protection and installer requirements before energizing.`,
});

Object.assign(findBom("dse-balancers"), {
  description: `${findBom("dse-balancers").description.split(" Victron publishes 0.7 A")[0]} Victron publishes 0.7 A maximum balance current, 0.7 mA off current and a 0.75 mm² minimum lead size. The modeled 1.5 mm² leads are ample in normal operation, but the battery-adjacent positive/midpoint leads still need accepted fault protection; Victron specifies 10 A near-battery fuses when UL compliance is required, so use locally accepted resettable protection where possible or obtain installer approval for an alternative.`,
});

system.schemaVersion = "r29-power-and-fault-audit";
system.revision = "Design R29 · researched power budgets and fault-risk classification · 26 Aug 2026";
system.status = "Normal-load budgets checked · genuine fault/installation holds remain";
system.summary = "DSE/Fiji R29 separates normal operating power from fault-clearing evidence. The 10 A shared-services breaker is now purchased and is comfortably sized for roughly 60 W expected / 100 W conservative demand; Starlink Mini is recorded as purchased, the Husqvarna generator as purchased pre-existing equipment, and the insulated PV comb rails as existing inventory. Manufacturer power limits are attached to every active/source device and thirteen circuit budgets now apply the real operating envelope: one tool at or below 1,800 W, high-power USB branches off during heavy tool use, and a 100 A Ekrano DVCC charge-current limit. No circuit is knowingly over capacity in that controlled normal mode; conditional modes are labeled separately from fault-clearing evidence. Genuine holds remain explicit: MultiPlus external DC protection/cable coordination, common SmartShunt-trunk fault and received-installation evidence, the unprotected secondary feeder, balancer taps, Orion's 60 A fault envelope versus the 30 A socket harness, received breaker/AIC evidence and the held AC enclosure/protection assembly.";
system.budget.note = system.budget.note
  .replace("Thirty-four Amazon project receipts are now reconciled.", "Thirty-five Amazon project receipts are now reconciled.")
  .replace("R28 retains the verified HT-8 cutoff-box", "The retained layout uses the verified HT-8 cutoff-box")
  .replace("The generic 10 A shared-services breaker still requires selection.", "The purchased CHTAIXI 10 A shared-services breaker is linked to receipt 43 and remains on a received-marking/AIC commissioning hold.");

Object.assign(findBom("dse-ventilated-ip65-enclosure"), {
  description: findBom("dse-ventilated-ip65-enclosure").description
    .replace("the generic 10 A shared-services breaker", "the purchased CHTAIXI 10 A shared-services breaker"),
});

delete system.powerModel.mainNegativeTrunkMaximumDischargeA;
delete system.powerModel.mainNegativeTrunkMaximumChargeA;
delete system.powerModel.sharedServiceCapacityWatts;
Object.assign(system.powerModel, {
  sharedServiceTypicalWatts: 60,
  sharedServiceConservativeWatts: 100,
  sharedServiceMinimumVoltageV: 20,
  sharedServiceMaximumCalculatedCurrentA: 5,
  sharedServiceBreakerNameplateWattsAt24V: 240,
  sharedServicePlanningCeilingWatts: 160,
  pvCombinedConductorAreaMm2: 6,
  pvCombinedConductorAmpacityA: 32,
  toolOperatingLimitWatts: 1800,
  toolDcCurrentAt19VAnd94PercentA: 100.8,
  mainNegativeTrunkControlledDischargeA: 106.5,
  mainNegativeTrunkChargeLimitA: 100,
  mainNegativeTrunkUnmanagedAllLoadsA: 148.6,
  mainNegativeTrunkModeledAmpacityA: 120,
  activePowerProfiles: 30,
  circuitPowerBudgets: 13,
});
const assumptionsBase = system.powerModel.assumptions
  .split(" R28 retains the purchased dedicated")[0]
  .split(" R29 power audit:")[0];
system.powerModel.assumptions = `${assumptionsBase} R29 power audit: normal demand is separate from fault current and uses the actual posted operating rules, not every device's theoretical maximum at once. Shared services use 60 W expected and 100 W conservative demand (Starlink 60 W rated ceiling, UniFi converter 25 W claimed ceiling, two 5 W lights and 5 W reserve), equal to 5 A at a conservative 20 V bank voltage. Keep 160 W as the project planning ceiling rather than treating 10 A × 24 V = 240 W as a continuous expansion promise; received breaker curve, enclosure temperature and minimum operating voltage govern. The two PV strings deliver 26.56 A after combining, so the combined disconnect-to-SmartSolar pair is revised from 4 mm² / 20 A to 6 mm² / 32 A. The posted one-tool limit is 1,800 W: at the MultiPlus's conservative 19 V input floor and 94% efficiency that is about 100.8 A DC, or about 79.8 A at 24 V, within the modeled 120 A branch envelope. With ORION REMOTE H off and the ChargeIT breaker open during heavy tool use, essential services bring the common SmartShunt trunk to about 106.5 A. Available solar reduces that net battery discharge, but the safety budget deliberately does not depend on sunshine; the array's 2,260 W maximum is a source rating, not an added load. Without the load-shedding rule, the tool plus every installed DC branch at its published maximum could reach about 148.6 A, so the common trunk remains conditional rather than unconditionally clear. Ekrano DVCC limits net battery charging through that trunk to 100 A. Tool starting surge is transient and must pass the warm-condition bench test. MultiPlus external DC protection/cable coordination and common-trunk fault/received-installation evidence remain genuine holds.`;

const sharedFact = {
  label: "Shared services",
  value: "60 W expected · 100 W ceiling",
  detail: "Purchased 10 A B10 · 5 A calculated at 20 V",
};
const existingSharedFact = system.keyFacts.findIndex((fact) => fact.label === sharedFact.label);
if (existingSharedFact >= 0) system.keyFacts[existingSharedFact] = sharedFact;
else system.keyFacts.splice(Math.min(8, system.keyFacts.length), 0, sharedFact);
const trunkFact = {
  label: "Main negative trunk",
  value: "106.5 A controlled · 120 A modeled",
  detail: "Conditional: USB branches off · DVCC charge limit 100 A",
};
const existingTrunkFact = system.keyFacts.findIndex((fact) => fact.label === trunkFact.label);
if (existingTrunkFact >= 0) system.keyFacts[existingTrunkFact] = trunkFact;
else system.keyFacts.splice(Math.min(9, system.keyFacts.length), 0, trunkFact);

system.operatingRules = [
  ...system.operatingRules.filter((rule) => (
    !rule.startsWith("Treat the 10 A shared-services breaker")
    && !rule.startsWith("Before running a high-load corded tool")
  )),
  "Treat the 10 A shared-services breaker as a 160 W planning ceiling, not a promise of 240 W continuous expansion. The current 60 W expected / 100 W conservative load is appropriate. Before adding anything, recompute demand at 20 V, preserve the 10 A conductor limit and verify enclosure-temperature/curve margin.",
  "Before running a high-load corded tool, switch ORION REMOTE H off and open the ChargeIT 32 A branch breaker; keep only the Ekrano and shared essential services running. Together with the one-tool 1,800 W limit, this keeps the modeled common battery-return current near 106.5 A at the conservative 19 V floor, below its 120 A envelope. Do not defeat the Ekrano DVCC 100 A system charge-current limit.",
];

system.commissioning = system.commissioning.map((instruction) => {
  if (instruction.startsWith("Secure two genuine WAGO 221-413")) {
    return instruction.replace("selected generic 10 A shared-services positive branch", "purchased CHTAIXI 10 A shared-services positive branch");
  }
  if (instruction.startsWith("Build the R28 secondary-services rail")) {
    return "Build the secondary-services rail with exactly three branch positions: purchased CHTAIXI B09H4W5HSW 10 A shared services, purchased 32 A Orion input and purchased 32 A ChargeIT. Do not add a separate 80 A incomer. Verify the received B10 12–110 VDC/polarity/curve/6 kA/terminal/torque markings and bound battery prospective fault current before energizing it. The direct secondary feeder remains a separate hold until source-side overcurrent protection, its ampacity and both 100 A bus interfaces are accepted.";
  }
  return instruction;
});
system.commissioning = system.commissioning.filter((instruction) => (
  !instruction.startsWith("Redesign the single SmartShunt SYSTEM MINUS-to-main-negative-bus trunk")
  && !instruction.startsWith("Verify the SmartShunt SYSTEM MINUS-to-main-negative-bus trunk under the controlled operating envelope")
));
const commissioningAdditions = [
  "Before commissioning the MultiPlus DC branch, follow the exact 24/3000/70 manual: select a resettable external DC breaker with a manufacturer-accepted trip characteristic and adequate interrupt rating, use at least the specified 50 mm² copper for a 0–5 m run (or the final engineer-sized conductor), and re-check the 250 A buses and two 120 A string-breaker architecture. Do not rely on MultiPlus internal electronic protection to protect the field cable.",
  "After the PV string breakers/rails/disconnect, use the canonical 6 mm² positive and negative combined-array leads to the SmartSolar. At 26.56 A Imp, the former 4 mm² / 20 A combined lead was undersized. Confirm received rail, disconnect and terminal capacity before uncovering the array.",
  "Measure every active device during bench commissioning: record Starlink average/peak, UniFi converter input and temperature, both switch-indicator draws, Coolgear 145 W idle draw, and actual ChargeIT idle draw. Compare results with the device-power table and lower operating limits if measured values exceed it.",
  "Verify the SmartShunt SYSTEM MINUS-to-main-negative-bus trunk under the controlled operating envelope before commissioning. Confirm the actual 1/0 conductor, insulation, support, lugs and terminations sustain the modeled 120 A envelope; enforce one tool at or below 1,800 W, ORION REMOTE H off and the ChargeIT breaker open during heavy tool use, and the Ekrano DVCC charge-current limit at 100 A. The controlled discharge budget is about 106.5 A, but every installed DC branch at maximum could reach about 148.6 A if the load-shedding rule is ignored. Test and record SmartShunt current and temperature during the 30-minute saw run. Fault/OCP coordination remains a separate hold; do not infer cable ampacity from the SmartShunt's 500 A body rating.",
];
for (const instruction of commissioningAdditions) {
  if (!system.commissioning.includes(instruction)) system.commissioning.push(instruction);
}

const research = [
  { title: "Fiji Electricity Regulations 2019 · wiring rules and licensed installation", publisher: "Laws of Fiji", url: "https://www.laws.gov.fj/Acts/DisplayAct/2619" },
  { title: "MultiPlus-II 24/3000 DC cable and 300 A protection table", publisher: "Victron Energy", url: "https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/installation.html" },
  { title: "Orion-Tr Smart cable, fuse and terminal installation table", publisher: "Victron Energy", url: "https://www.victronenergy.com/media/pg/Orion-Tr_Smart_DC-DC_Charger_-_Non-Isolated/en/installation.html" },
  { title: "Orion-Tr Smart 24/12-30 output, efficiency and idle specifications", publisher: "Victron Energy", url: "https://www.victronenergy.com/media/pg/Orion-Tr_Smart_DC-DC_Charger_-_Non-Isolated/en/specifications.html" },
  { title: "Battery Balancer current, cable and optional 10 A fuse guidance", publisher: "Victron Energy", url: "https://www.victronenergy.com/upload/documents/Manual-Battery-Balancer-EN.pdf" },
  { title: "SmartShunt IP65 draw and supplied 1 A fused lead", publisher: "Victron Energy", url: "https://www.victronenergy.com/upload/documents/Datasheet-SmartShunt-IP65-EN.pdf" },
  { title: "Suntech STP565S-C72/Vmh electrical and 25 A series-fuse limits", publisher: "Suntech", url: "https://www.suntech-power.com/wp-content/uploads/download/product-specification/EN_Ultra_V_Pro_N-type_STP570S_C72_Vmh.pdf" },
  { title: "Husqvarna G3200P rated output and operating manual", publisher: "Husqvarna", url: "https://www-static-nw.husqvarna.com/hbd/tdrdownload/v2/pub000092074/doc000221989/OM/67_v-w4tEgqdgrxTerwPMkodyk8?httproute=True" },
  { title: "CHTAIXI B09H4W5HSW 10 A DC breaker purchase listing", publisher: "Amazon / CHTAIXI", url: "https://www.amazon.com/dp/B09H4W5HSW" },
];
for (const source of research) {
  const existing = system.research.findIndex((candidate) => candidate.title === source.title);
  if (existing >= 0) system.research[existing] = source;
  else system.research.push(source);
}

writeJson("data/dse-system.json", system);
console.log(JSON.stringify({
  revision: system.revision,
  activePowerProfiles: system.powerModel.activePowerProfiles,
  circuitPowerBudgets: system.powerModel.circuitPowerBudgets,
  existingEquipmentRows: ["dse-existing-generator", "dse-existing-pv-comb-rails"],
}, null, 2));
