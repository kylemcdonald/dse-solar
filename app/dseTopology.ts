import { conductor as p, connection as w, currentSourcesFromDevices, endpoint as ep } from "./systemGraph";
import type { Cable, CircuitPowerBudget, Connection, Device, Junction, SystemGraph, TerminalCurrentSource } from "./systemGraph";

const wall = (position: readonly [number, number, number]) => ({
  space: "world" as const,
  surface: "wall" as const,
  position,
});
const outside = (
  position: readonly [number, number, number],
  rotation?: readonly [number, number, number],
) => ({
  space: "world" as const,
  surface: "outside" as const,
  position,
  ...(rotation ? { rotation } : {}),
});
const outsideWall = (position: readonly [number, number, number]) => ({
  space: "world" as const,
  surface: "outside-wall" as const,
  position,
});
const ceiling = (position: readonly [number, number, number]) => ({
  space: "world" as const,
  surface: "ceiling" as const,
  position,
});
const floor = (
  position: readonly [number, number, number],
  rotation?: readonly [number, number, number],
) => ({
  space: "world" as const,
  surface: "floor" as const,
  position,
  ...(rotation ? { rotation } : {}),
});
const inside = (junctionId: string, section: "din" | "power" | "backplate" | "sidewall", order: number) => ({
  space: "junction" as const,
  junctionId,
  section,
  order,
});

const DIHOOL_120 = "https://www.amazon.com/dp/B0BFF7F46Y";
const CHTAIXI_32 = "https://www.amazon.com/dp/B09H4X8K1C";
const CHARGEIT_75 = "https://www.coolgear.com/product/chargeit-mini-75w-dual-port-usb-type-c-pd-charger";
const COOLGEAR_145 = "https://www.coolgear.com/product/145w-dual-usb-c-pd-3-1-vehicle-charger-with-mountable-flanges";
const SUNTECH_565 = "https://www.suntech-power.com/wp-content/uploads/download/product-specification/EN_Ultra_V_Pro_N-type_STP570S_C72_Vmh.pdf";
const SMARTSOLAR_SPEC = "https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_150-70_up_to_250-100_VE.Can/en/technical-specifications.html";
const MULTIPLUS_SPEC = "https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/technical-specifications-mp-ii-230v.html";
const EKRANO_SPEC = "https://www.victronenergy.com/media/pg/Ekrano_GX/en/technical-specifications.html";
const SMARTSHUNT_SPEC = "https://www.victronenergy.com/upload/documents/Datasheet-SmartShunt-IP65-EN.pdf";
const BALANCER_SPEC = "https://www.victronenergy.com/upload/documents/Datasheet-Battery-Balancer-EN.pdf";
const ORION_SPEC = "https://www.victronenergy.com/media/pg/Orion-Tr_Smart_DC-DC_Charger_-_Non-Isolated/en/specifications.html";
const STARLINK_SPEC = "https://www.starlink.com/public-files/specification_sheet_mini.pdf";
const UNIFI_SPEC = "https://techspecs.ui.com/unifi/cloud-gateways/ux";
const HUSQVARNA_G3200P = "https://www.husqvarna.com/my/generators/g3200p/";
const AC_CORE_PITCH_M = 0.020;

const breaker = (
  id: string,
  label: string,
  junctionId: "batteryCutoffJunction" | "secondaryJunction",
  order: number,
  ratedCurrentA: number,
  options: Partial<Device> = {},
): Device => ({
  id,
  label,
  kind: "breaker",
  size: [0.020, 0.082, 0.07],
  placement: inside(junctionId, "din", order),
  conductors: id === "sharedServicesBreaker" ? [
    p("line", "Supply", "positive", "bottom", {
      order: 0, gauge: "1.5–2.5 mm² · 10 A branch",
      terminal: "CHTAIXI B10 miniature-breaker screw clamp", terminalSize: "M5 screw clamp per listing · verify received range",
      termination: "Bare fine-stranded copper or maker-approved ferrule", terminalDiameterMm: 5,
      terminalNote: "Purchased B09H4W5HSW listing claims 12–110 VDC, B curve, 6 kA and 2.5 N·m. Verify every marking, polarity diagram and conductor range on the received breaker.",
    }),
    p("load", "Load", "positive", "top", {
      order: 0, gauge: "1.5–2.5 mm² · 10 A branch",
      terminal: "CHTAIXI B10 miniature-breaker screw clamp", terminalSize: "M5 screw clamp per listing · verify received range",
      termination: "Bare fine-stranded copper or maker-approved ferrule", terminalDiameterMm: 5,
      terminalNote: "Purchased B09H4W5HSW listing claims 12–110 VDC, B curve, 6 kA and 2.5 N·m. Verify every marking, polarity diagram and conductor range on the received breaker.",
    }),
  ] : id === "orionBreaker32" || id === "chargeItBreaker32" ? [
    p("line", "24 V bus supply", "positive", "bottom", {
      order: 0, terminal: "CHTAIXI miniature-breaker screw clamp", terminalSize: "Verify received 32 A device",
      termination: "Bare fine-stranded copper or maker-approved ferrule", terminalDiameterMm: 5,
      terminalNote: "Use the received breaker marking, polarity diagram and torque specification.",
    }),
    p("load", "Protected branch", "positive", "top", {
      order: 0, terminal: "CHTAIXI miniature-breaker screw clamp", terminalSize: "Verify received 32 A device",
      termination: "Bare fine-stranded copper or maker-approved ferrule", terminalDiameterMm: 5,
      terminalNote: "Use the received breaker marking, polarity diagram and torque specification.",
    }),
  ] : [
    p("line", "Supply", "positive", "bottom", {
      order: 0, terminal: "DIHOOL DZ47X-125 screw clamp", terminalSize: "Verify received 120 A device",
      termination: "Received-device-approved 1/0 AWG landing or listed transition", terminalDiameterMm: 10,
      terminalNote: "Non-polarized 120 A breaker ordered in a DZ47X-125 frame. Confirm the received clamp range and torque without trimming strands.",
    }),
    p("load", "Load", "positive", "top", {
      order: 0, terminal: "DIHOOL DZ47X-125 screw clamp", terminalSize: "Verify received 120 A device",
      termination: "Received-device-approved 1/0 AWG landing or listed transition", terminalDiameterMm: 10,
      terminalNote: "Non-polarized 120 A breaker ordered in a DZ47X-125 frame. Confirm the received clamp range and torque without trimming strands.",
    }),
  ],
  poles: 1,
  status: "planned",
  currentProtection: {
    kind: "breaker",
    ratedCurrentA,
    verified: false,
    terminalPairs: [["line", "load"]],
    note: "Use only after received DC markings, interrupt capacity, polarity where applicable, terminal range and torque are verified.",
  },
  ...options,
});

const acBreakout = (
  id: string,
  label: string,
  placement: Device["placement"],
  cableFace: "top" | "bottom" | "left" | "right" = "bottom",
  coreFace: "top" | "bottom" | "left" | "right" = "top",
): Device => ({
  id,
  label,
  subtitle: "Three insulated cores transition to one routed white sheath",
  kind: "connector",
  presentation: "cable-breakout",
  diagramPresentation: "join",
  size: [0.072, 0.040, 0.025],
  placement,
  terminalPitchByFaceM: { [coreFace]: AC_CORE_PITCH_M },
  componentId: "acBoard",
  bomIds: ["dse-terms"],
  status: "planned",
  conductors: [
    p("cable", "3-core cable sheath", "multicore", cableFace, {
      order: 0, gauge: "3 × 1.5 mm²", terminal: "Strain-relieved cable breakout",
      terminalSize: "9.8 mm nominal cable OD", termination: "Gland / jacket restraint; cores remain continuous",
      terminalDiameterMm: 9.8, terminalLengthMm: 12, internalMates: ["line", "neutral", "earth"],
      terminalNote: "The white cylinder is the complete cable; colored core markers identify the conductors inside it.",
    }),
    p("line", "Active core / L", "ac-line", coreFace, {
      order: 0, gauge: "1.5 mm²", terminal: "Exposed cable core", terminalSize: "1.5 mm² fine-stranded",
      termination: "Maker-approved bootlace ferrule where required", terminalDiameterMm: 3.4, internalMates: ["cable"],
    }),
    p("neutral", "Neutral core / N", "ac-neutral", coreFace, {
      order: 1, gauge: "1.5 mm²", terminal: "Exposed cable core", terminalSize: "1.5 mm² fine-stranded",
      termination: "Maker-approved bootlace ferrule where required", terminalDiameterMm: 3.4, internalMates: ["cable"],
    }),
    p("earth", "Protective-earth core / PE", "earth", coreFace, {
      order: 2, gauge: "1.5 mm²", terminal: "Exposed cable core", terminalSize: "1.5 mm² green/yellow core",
      termination: "Maker-approved bootlace ferrule where required", terminalDiameterMm: 3.4, internalMates: ["cable"],
    }),
  ],
});

const twoCoreBreakout = (
  id: string,
  label: string,
  placement: Device["placement"],
): Device => ({
  id, label, kind: "connector", presentation: "cable-breakout", diagramPresentation: "join", size: [0.060, 0.034, 0.022], placement,
  componentId: "switchedSplit", bomIds: ["dse-switch-connectors"], status: "planned",
  conductors: [
    p("positive", "Positive core", "positive", "top", {
      order: 0, gauge: "1.5 mm²", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded",
      termination: "Bare stripped conductor; WAGO does not require a ferrule", terminalDiameterMm: 4, internalMates: ["cable"],
    }),
    p("negative", "Negative core", "negative", "top", {
      order: 1, gauge: "1.5 mm²", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded",
      termination: "Bare stripped conductor; WAGO does not require a ferrule", terminalDiameterMm: 4, internalMates: ["cable"],
    }),
    p("cable", "Two-core cable", "multicore", "bottom", {
      terminal: "Strain-relieved two-core breakout", terminalSize: "Complete two-core cable",
      termination: "Gland / jacket restraint", terminalDiameterMm: 6.4, terminalLengthMm: 10,
      internalMates: ["positive", "negative"],
    }),
  ],
});

const usbMini = (id: string, label: string, x: number, layoutOrder: number): Device => ({
  id,
  label,
  subtitle: "ChargeIT! Mini 75 W · protected by shared 32 A branch breaker",
  kind: "load",
  size: [0.088, 0.051, 0.028],
  // The shared row clears the socket/145 W row by the complete interval-packed
  // pair of Y joins plus each join's tangent and protected ingress cell.
  placement: wall([x, 1.12, 0.055]),
  componentId: "usb",
  layoutGroup: { id: "chargeit-minis", label: "ChargeIT! Mini chargers", columns: 4, order: layoutOrder },
  bomIds: ["dse-chargeit-mini-75"],
  purchaseUrl: CHARGEIT_75,
  status: "purchased",
  power: {
    role: "load", basis: "manufacturer", verified: true, sourceUrl: CHARGEIT_75,
    readings: [
      { label: "Maximum input draw", watts: 78, voltage: "9–28 VDC" },
      { label: "Idle input", watts: 0.06, voltage: "12 V", note: "5 mA published idle current." },
      { label: "Named USB output capacity", watts: 75 },
    ],
    note: "Coolgear publishes 78 W maximum input draw for each 75 W module. No device-level electrical protection is documented in its data sheet, so the 32 A branch breaker remains necessary.",
    internalProtection: { verified: true, features: [], note: "Manufacturer data sheet lists electrical protections as N/A." },
  },
  conductors: [
    p("positive", "24 V input +", "positive", "bottom", {
      order: 0, gauge: "2.5 mm² daisy-chain conductor",
      terminal: "Removable Phoenix 2-pin screw plug", terminalSize: "Received plug range must be measured",
      termination: "Single or twin bootlace ferrule only after plug approval", terminalDiameterMm: 4,
      terminalNote: "Coolgear identifies a Phoenix 2-pin input but does not publish its conductor range. A two-wire daisy landing is a commissioning hold.",
    }),
    p("negative", "24 V input −", "negative", "bottom", {
      order: 1, gauge: "2.5 mm² daisy-chain conductor",
      terminal: "Removable Phoenix 2-pin screw plug", terminalSize: "Received plug range must be measured",
      termination: "Single or twin bootlace ferrule only after plug approval", terminalDiameterMm: 4,
      terminalNote: "Coolgear identifies a Phoenix 2-pin input but does not publish its conductor range. A two-wire daisy landing is a commissioning hold.",
    }),
    p("usbC", "USB-C output", "multicore", "front", {
      order: 0, optional: true, terminal: "USB-C receptacle", terminalSize: "USB Type-C",
      termination: "Factory USB-C plug", terminalDiameterMm: 8, terminalLengthMm: 10,
    }),
    p("usbA", "USB-A output", "multicore", "front", {
      order: 1, optional: true, terminal: "USB-A receptacle", terminalSize: "USB Type-A",
      termination: "Factory USB-A plug", terminalDiameterMm: 9, terminalLengthMm: 10,
    }),
  ],
});

const rigidRail = (
  id: string,
  label: string,
  taps: readonly { id: string; label: string; kind: "positive" | "negative"; endpoint: string }[],
): Device => {
  return {
    id,
    label,
    subtitle: "Continuous rigid comb rail across protection-device tops",
    kind: "busbar",
    presentation: "rigid-rail",
    railTargets: Object.fromEntries(taps.map((tap) => [tap.id, tap.endpoint])),
    size: [0.200, 0.040, 0.020],
    placement: inside("pvJunction", "backplate", 0),
    componentId: "pvSafety",
    bomIds: ["dse-existing-pv-comb-rails", "dse-pv-protection"],
    status: "existing",
    procurementStatus: "existing",
    holdReason: "The insulated positive and negative comb rails are pre-existing hardware. Before energizing, verify at least 32 A continuous current capacity, insulation, tooth pitch, terminal compatibility, creepage/clearance and enclosure retention against the received devices.",
    conductors: taps.map((tap, order) => p(tap.id, tap.label, tap.kind, "bottom", {
      order,
      gauge: "Received comb busbar · verify",
      terminal: "Rigid comb-rail tooth",
      terminalSize: "Match received breaker terminal pitch",
      termination: "Factory rail tooth / approved rigid link",
      terminalDiameterMm: 6.5,
      terminalLengthMm: 4,
      internalMates: taps.filter((peer) => peer.kind === tap.kind && peer.id !== tap.id).map((peer) => peer.id),
      terminalNote: "Each insulated polarity rail is continuous; every device terminal still receives one physical tooth.",
    })),
  };
};

const PANEL_ROTATION = [-Math.PI / 2, -Math.PI / 10, -Math.PI / 2] as const;

const pvStringSource = (id: string, label: string): TerminalCurrentSource => ({
  id,
  label,
  channel: "positive",
  continuousCapacityA: 14.2,
  shortCircuitCurrentA: 14.2,
  inherentCurrentLimit: {
    currentLimitA: 14.2,
    verified: true,
    note: "Module Isc bounds the series-string contribution.",
  },
  verified: true,
  basis: "photovoltaic-source",
  note: "Series-string current is bounded by the module short-circuit-current envelope.",
});

const batteryStringSource = (id: string, label: string): TerminalCurrentSource => ({
  id,
  label,
  channel: "positive",
  continuousCapacityA: 200,
  shortCircuitCurrentA: "unbounded",
  verified: true,
  basis: "electrochemical-source",
  note: "Prospective battery fault current is deliberately unbounded until the graph reaches the string breaker.",
});

const panel = (
  id: string,
  label: string,
  position: readonly [number, number, number],
  layoutOrder: number,
  sourceAssemblyId: string,
  currentSource?: TerminalCurrentSource,
): Device => ({
  id,
  label,
  kind: "panel",
  size: [2.279, 1.134, 0.035],
  placement: outside(position, PANEL_ROTATION),
  componentId: id,
  layoutGroup: { id: "pv-panels", label: "PV array", columns: 2, order: layoutOrder },
  bomIds: ["dse-panels"],
  status: "purchased",
  power: {
    role: "source", basis: "manufacturer", verified: false, sourceUrl: SUNTECH_565,
    readings: [
      { label: "Maximum output at STC", watts: 565, voltage: "42.56 Vmp", currentA: 13.28 },
      { label: "Short-circuit current", currentA: 14.2, voltage: "50.39 Voc" },
    ],
    note: "The STP565S-C72/Vmh data sheet is the design basis; confirm every received module nameplate. Suntech's maximum series-fuse rating is 25 A.",
  },
  currentSourceAssemblyPaths: [{
    assemblyId: sourceAssemblyId,
    activeChannel: "positive",
    terminalPair: ["positive", "negative"],
  }],
  conductors: [
    p("positive", "PV +", "positive", "bottom", {
      diagramSide: "output",
      order: 0, gauge: "Factory 4 mm² lead", terminal: "Factory PV connector",
      terminalSize: "MC4 EVO2 / 01S / STP-XC4 family", termination: "Matching listed PV connector",
      terminalDiameterMm: 6, terminalNote: "Suntech specifies a 4 mm² output lead; verify the connector fitted to the received module before mating.",
      ...(currentSource ? { currentSource } : {}),
    }),
    p("negative", "PV −", "negative", "bottom", {
      diagramSide: "output",
      order: 1, gauge: "Factory 4 mm² lead", terminal: "Factory PV connector",
      terminalSize: "MC4 EVO2 / 01S / STP-XC4 family", termination: "Matching listed PV connector",
      terminalDiameterMm: 6, terminalNote: "Suntech specifies a 4 mm² output lead; verify the connector fitted to the received module before mating.",
    }),
    p("frame", "Frame bond", "earth", "bottom", {
      diagramSide: "output",
      order: 2, gauge: "4 mm² minimum design bond", terminal: "Module grounding hole",
      terminalSize: "Ø5.1 mm hole · M5 hardware", termination: "M5 closed ring + listed bonding hardware",
      terminalDiameterMm: 5.1, terminalNote: "Use one of Suntech's designated grounding holes and corrosion-compatible hardware.",
    }),
  ],
});

const battery = (
  id: string,
  label: string,
  position: readonly [number, number, number],
  componentId: string,
  layoutOrder: number,
  sourceAssemblyId: string,
  currentSource?: TerminalCurrentSource,
): Device => ({
  id,
  label,
  kind: "battery",
  size: [0.522, 0.240, 0.220],
  // Both batteries in each string face the same way: the lower battery's + and
  // upper battery's - posts are the two adjacent posts. This makes the series
  // jumper a short local 1/0 lead instead of a long cable between the far ends.
  placement: floor(position, [0, Math.PI, 0]),
  terminalPitchByFaceM: { top: 0.440 },
  componentId,
  layoutGroup: { id: "battery-bank", label: "24 V battery bank", columns: 2, order: layoutOrder },
  bomIds: ["dse-batteries"],
  status: "purchased",
  power: {
    role: "storage", basis: "manufacturer", verified: false,
    sourceUrl: "https://www.everexceed.com/es200-12g-gel-battery_p363.html",
    readings: [{ label: "Nominal stored energy", wattHours: 2400, voltage: "12 V nominal", currentA: 200 }],
    note: "Each ES200-12G is a nominal 12 V, 200 Ah GEL battery. This is energy capacity, not a safe fault-current bound; confirm the received labels and obtain battery short-circuit/internal-resistance data for breaker-AIC verification.",
  },
  currentSourceAssemblyPaths: [{
    assemblyId: sourceAssemblyId,
    activeChannel: "positive",
    terminalPair: ["positive", "negative"],
  }],
  conductors: [
    p("positive", "Positive post", "positive", "top", {
      diagramSide: "output",
      order: 0, gauge: "1/0 AWG · 53.5 mm²", terminal: "F-M8 battery terminal",
      terminalSize: "M8 stud", termination: "1/0 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8,
      terminalNote: "EverExceed's ES200-12G table identifies F-M8 terminals; verify the received torque marking.",
      ...(currentSource ? { currentSource } : {}),
    }),
    p("negative", "Negative post", "negative", "top", {
      diagramSide: "output",
      order: 1, gauge: "1/0 AWG · 53.5 mm²", terminal: "F-M8 battery terminal",
      terminalSize: "M8 stud", termination: "1/0 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8,
      terminalNote: "EverExceed's ES200-12G table identifies F-M8 terminals; verify the received torque marking.",
    }),
  ],
});

export const dseCables: readonly Cable[] = [
  { id: "battery53", label: "1/0 AWG battery cable", cores: 1, outsideDiameterMm: 14.5, conductorSize: "53.5 mm²", sheath: "single", ampacityA: 120 },
  { id: "dc35", label: "35 mm² SmartSolar battery cable", cores: 1, outsideDiameterMm: 11.8, conductorSize: "35 mm²", sheath: "single", ampacityA: 120, notes: "Victron's exact SmartSolar 150/85 installation table pairs 35 mm² battery cable with 100–120 A protection. This 120 A coordination envelope remains conditional on received cable insulation, route length, bundling and temperature correction." },
  { id: "dc16", label: "16 mm² DC cable", cores: 1, outsideDiameterMm: 8.6, conductorSize: "16 mm²", sheath: "single", ampacityA: 75 },
  { id: "dc10", label: "10 mm² DC cable", cores: 1, outsideDiameterMm: 7.2, conductorSize: "10 mm²", sheath: "single", ampacityA: 50 },
  { id: "dc6", label: "6 mm² combined-PV DC cable", cores: 1, outsideDiameterMm: 6.8, conductorSize: "6 mm²", sheath: "single", ampacityA: 32, notes: "Carries both 13.28 A PV strings after the combiner; final installation ampacity and temperature correction must be verified." },
  { id: "pv4", label: "4 mm² PV cable", cores: 1, outsideDiameterMm: 6.1, conductorSize: "4 mm²", sheath: "single", ampacityA: 20 },
  { id: "service2.5", label: "2.5 mm² service conductor", cores: 1, outsideDiameterMm: 4.2, conductorSize: "2.5 mm²", sheath: "single", ampacityA: 20 },
  { id: "branch5.26", label: "10 AWG protected branch conductor", cores: 1, outsideDiameterMm: 5.6, conductorSize: "10 AWG · 5.26 mm²", sheath: "single", ampacityA: 32 },
  { id: "branch1.5", label: "1.5 mm² branch conductor", cores: 1, outsideDiameterMm: 3.4, conductorSize: "1.5 mm²", sheath: "single", ampacityA: 10 },
  { id: "sense0.75", label: "0.75 mm² control conductor", cores: 1, outsideDiameterMm: 2.4, conductorSize: "0.75 mm²", sheath: "single", ampacityA: 6 },
  { id: "ac3", label: "3-core 10 A AC cable", cores: 3, outsideDiameterMm: 9.8, conductorSize: "3 × 1.5 mm²", sheath: "white", ampacityA: 10, carriedChannels: ["ac-line", "ac-neutral", "earth"] },
  { id: "acCore1.5", label: "Exposed 1.5 mm² AC core", cores: 1, outsideDiameterMm: 3.4, conductorSize: "1.5 mm²", sheath: "single", ampacityA: 10 },
  { id: "earth4", label: "4 mm² protective-earth conductor", cores: 1, outsideDiameterMm: 5.0, conductorSize: "4 mm²", sheath: "single" },
  { id: "pvComb", label: "PV breaker comb link", cores: 1, outsideDiameterMm: 6.5, conductorSize: "Received comb busbar · verify", sheath: "single", ampacityA: 40 },
  { id: "light2", label: "2-core lighting cable", cores: 2, outsideDiameterMm: 6.4, conductorSize: "2 × 1.5 mm²", sheath: "white", ampacityA: 10, carriedChannels: ["positive", "negative"] },
  { id: "starlinkPower", label: "Starlink Mini two-core factory power cable", cores: 2, outsideDiameterMm: 6.0, conductorSize: "Factory multicore lead", sheath: "white", ampacityA: 10, carriedChannels: ["positive", "negative"] },
  { id: "usbAToCFactory", label: "Factory USB-A-to-USB-C power cable", cores: 2, outsideDiameterMm: 4.0, conductorSize: "Factory multicore lead", sheath: "white", ampacityA: 5, carriedChannels: ["positive", "negative"] },
  { id: "socketHarness12", label: "YCIND socket 12 AWG duplex harness", cores: 1, outsideDiameterMm: 4.8, conductorSize: "12 AWG · 3.31 mm²", sheath: "single", ampacityA: 30 },
  { id: "socketPlug", label: "Factory cigarette plug / socket connection", cores: 2, outsideDiameterMm: 8.0, conductorSize: "Factory two-core plug assembly", sheath: "white", ampacityA: 15, carriedChannels: ["positive", "negative"] },
  { id: "ethernet", label: "Ethernet / Victron data cable", cores: 1, outsideDiameterMm: 6.0, conductorSize: "Data", sheath: "single" },
  { id: "factory", label: "Factory device lead", cores: 1, outsideDiameterMm: 4.0, conductorSize: "Factory lead", sheath: "single", ampacityA: 5 },
];

const dseBaseDevices: readonly Device[] = [
  // Leave one routing cell beyond each frame-junction halo between adjacent
  // modules. The geometry remains the same aligned two-panel array; the small
  // installation gap prevents a frame-bond tangent from entering its neighbour.
  panel("panel1", "PV panel 1 · string A", [-2.14, 0.38, -1.18], 0, "pv-string-a"),
  panel("panel2", "PV panel 2 · string A", [-0.96, 0.75, -1.18], 1, "pv-string-a",
    pvStringSource("pv-string-a-source", "PV string A")),
  panel("panel3", "PV panel 3 · string B", [-2.14, 0.38, 1.18], 2, "pv-string-b"),
  panel("panel4", "PV panel 4 · string B", [-0.96, 0.75, 1.18], 3, "pv-string-b",
    pvStringSource("pv-string-b-source", "PV string B")),

  {
    id: "pvJunction", label: "PV protection / combiner junction box", kind: "junction",
    size: [0.32, 0.28, 0.16], placement: wall([0.38, 0.70, 0.08]), componentId: "pvSafety",
    bomIds: ["dse-pv-protection", "dse-pv-string-breakers"], status: "planned", conductors: [],
  },
  {
    id: "pvBreakerA", label: "String A 20 A PV breaker", kind: "breaker", poles: 2,
    size: [0.040, 0.082, 0.070], placement: inside("pvJunction", "din", 0), componentId: "pvSafety",
    bomIds: ["dse-pv-string-breakers"], purchaseUrl: "https://www.amazon.com/dp/B0D4JR95Y4", status: "purchased",
    currentProtection: { kind: "breaker", ratedCurrentA: 20, verified: false, terminalPairs: [["pvPosIn", "pvPosOut"]] }, conductors: [
      p("pvPosIn", "String A + in", "positive", "bottom", {
        order: 0, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
        terminalNote: "Verify the received 20 A marking, polarity diagram, torque and common-trip operation before commissioning.",
      }),
      p("pvNegIn", "String A − in", "negative", "bottom", {
        order: 1, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
      p("pvPosOut", "String A + comb tooth", "positive", "top", {
        order: 0, gauge: "Comb link", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Approved insulated comb/link only", terminalDiameterMm: 5.5,
      }),
      p("pvNegOut", "String A − comb tooth", "negative", "top", {
        order: 1, gauge: "Comb link", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Approved insulated comb/link only", terminalDiameterMm: 5.5,
      }),
    ],
  },
  {
    id: "pvBreakerB", label: "String B 20 A PV breaker", kind: "breaker", poles: 2,
    size: [0.040, 0.082, 0.070], placement: inside("pvJunction", "din", 1), componentId: "pvSafety",
    bomIds: ["dse-pv-string-breakers"], purchaseUrl: "https://www.amazon.com/dp/B0D4JR95Y4", status: "purchased",
    currentProtection: { kind: "breaker", ratedCurrentA: 20, verified: false, terminalPairs: [["pvPosIn", "pvPosOut"]] }, conductors: [
      p("pvPosIn", "String B + in", "positive", "bottom", { order: 0, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device", termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5 }),
      p("pvNegIn", "String B − in", "negative", "bottom", { order: 1, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device", termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5 }),
      p("pvPosOut", "String B + comb tooth", "positive", "top", { order: 0, gauge: "Comb link", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device", termination: "Approved insulated comb/link only", terminalDiameterMm: 5.5 }),
      p("pvNegOut", "String B − comb tooth", "negative", "top", { order: 1, gauge: "Comb link", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device", termination: "Approved insulated comb/link only", terminalDiameterMm: 5.5 }),
    ],
  },
  {
    id: "pvSpd", label: "PV Type 2 surge protector", kind: "protection", poles: 2, size: [0.040, 0.082, 0.07],
    placement: inside("pvJunction", "din", 2), componentId: "pvSafety", status: "purchased", conductors: [
      p("positive", "PV + comb tooth", "positive", "top", { order: 0, gauge: "Comb link", terminal: "SPD line clamp", terminalSize: "Verify received SPD", termination: "Approved comb/link", terminalDiameterMm: 5.5 }),
      p("negative", "PV − comb tooth", "negative", "top", { order: 1, gauge: "Comb link", terminal: "SPD line clamp", terminalSize: "Verify received SPD", termination: "Approved comb/link", terminalDiameterMm: 5.5 }),
      p("earth", "PE", "earth", "bottom", { order: 0, gauge: "10 mm²", terminal: "SPD PE clamp", terminalSize: "Verify received SPD", termination: "Maker-approved conductor/ferrule", terminalDiameterMm: 6 }),
    ],
  },
  {
    id: "pvDisconnect", label: "PV 2-pole disconnect", kind: "breaker", poles: 2, size: [0.040, 0.082, 0.07],
    placement: inside("pvJunction", "din", 3), componentId: "pvSafety", status: "purchased", conductors: [
      p("positiveIn", "+ comb tooth", "positive", "top", { order: 0, gauge: "Comb link", terminal: "Disconnect screw clamp", terminalSize: "Verify received device", termination: "Approved comb/link", terminalDiameterMm: 5.5 }),
      p("negativeIn", "− comb tooth", "negative", "top", { order: 1, gauge: "Comb link", terminal: "Disconnect screw clamp", terminalSize: "Verify received device", termination: "Approved comb/link", terminalDiameterMm: 5.5 }),
      p("positiveOut", "+ out", "positive", "bottom", { order: 0, gauge: "6 mm²", terminal: "Disconnect screw clamp", terminalSize: "Verify received device accepts 6 mm²", termination: "Maker-approved conductor/ferrule", terminalDiameterMm: 6.8 }),
      p("negativeOut", "− out", "negative", "bottom", { order: 1, gauge: "6 mm²", terminal: "Disconnect screw clamp", terminalSize: "Verify received device accepts 6 mm²", termination: "Maker-approved conductor/ferrule", terminalDiameterMm: 6.8 }),
    ],
  },
  rigidRail("pvCombRails", "Insulated positive / negative PV comb rails", [
    { id: "positiveBreakerA", label: "Positive rail · string A tooth", kind: "positive", endpoint: ep("pvBreakerA", "pvPosOut") },
    { id: "negativeBreakerA", label: "Negative rail · string A tooth", kind: "negative", endpoint: ep("pvBreakerA", "pvNegOut") },
    { id: "positiveBreakerB", label: "Positive rail · string B tooth", kind: "positive", endpoint: ep("pvBreakerB", "pvPosOut") },
    { id: "negativeBreakerB", label: "Negative rail · string B tooth", kind: "negative", endpoint: ep("pvBreakerB", "pvNegOut") },
    { id: "positiveSpd", label: "Positive rail · SPD tooth", kind: "positive", endpoint: ep("pvSpd", "positive") },
    { id: "negativeSpd", label: "Negative rail · SPD tooth", kind: "negative", endpoint: ep("pvSpd", "negative") },
    { id: "positiveDisconnect", label: "Positive rail · disconnect tooth", kind: "positive", endpoint: ep("pvDisconnect", "positiveIn") },
    { id: "negativeDisconnect", label: "Negative rail · disconnect tooth", kind: "negative", endpoint: ep("pvDisconnect", "negativeIn") },
  ]),
  {
    id: "smartSolar", label: "Victron SmartSolar MPPT 150/85-Tr", kind: "converter", size: [0.295, 0.257, 0.103],
    placement: wall([1.28, 0.70, 0.052]), componentId: "solarController", bomIds: ["dse-smartsolar", "dse-mppt-wirebox-tr"],
    status: "purchased", technicalUrl: SMARTSOLAR_SPEC,
    power: {
      role: "converter", basis: "manufacturer", verified: true, sourceUrl: SMARTSOLAR_SPEC,
      readings: [
        { label: "Maximum PV capacity at 24 V", watts: 2400 },
        { label: "Maximum battery output", currentA: 85, voltage: "24 V nominal" },
        { label: "Peak conversion efficiency", percent: 98 },
        { label: "Self-consumption ceiling", watts: 0.84, voltage: "24 V", note: "Conservative conversion of the published <35 mA 12 V value." },
      ],
      note: "The 2.26 kW array is within the controller's published 2.4 kW nominal-PV limit at 24 V.",
      internalProtection: { verified: true, features: ["PV reverse-polarity", "output short-circuit", "over-temperature"] },
    },
    conductors: [
      p("pvPositive", "PV +", "positive", "bottom", { order: 0, diagramSide: "input", gauge: "6 mm² combined-array lead", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded copper; ferrule only if Victron accepts the selected size", terminalDiameterMm: 8 }),
      p("pvNegative", "PV −", "negative", "bottom", { order: 1, diagramSide: "input", gauge: "6 mm² combined-array lead", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded copper; ferrule only if Victron accepts the selected size", terminalDiameterMm: 8 }),
      p("batteryPositive", "Battery +", "positive", "bottom", {
        order: 2, diagramSide: "output", gauge: "35 mm²", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded 35 mm² copper", terminalDiameterMm: 9,
        currentSource: {
          id: "smartsolar-output-source", label: "SmartSolar 150/85 battery output", channel: "positive",
          continuousCapacityA: 85, shortCircuitCurrentA: 85,
          inherentCurrentLimit: { currentLimitA: 85, verified: true, note: "Published 85 A maximum regulated battery current and output short-circuit protection." },
          verified: true, basis: "regulated-output",
        },
      }),
      p("batteryNegative", "Battery −", "negative", "bottom", { order: 3, diagramSide: "output", gauge: "35 mm²", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded 35 mm² copper", terminalDiameterMm: 9 }),
      p("veDirect", "VE.Direct", "data", "bottom", { order: 4, diagramSide: "neutral", terminal: "VE.Direct receptacle", terminalSize: "Victron VE.Direct", termination: "Factory VE.Direct cable", terminalDiameterMm: 7 }),
    ],
  },

  {
    id: "batteryCutoffJunction", label: "Battery / MPPT cutoff junction box · verified 200 × 155 × 92 mm", kind: "junction", size: [0.20, 0.16, 0.10],
    physicalSize: [0.200, 0.155, 0.092],
    placement: wall([2.12, 0.48, 0.05]), componentId: "batteryCutoff",
    bomIds: ["dse-mollom-8-way-enclosure-second", "dse-airic-npt-cable-glands"], status: "purchased", conductors: [],
  },
  breaker("batteryBreakerA", "String A cutoff · 120 A", "batteryCutoffJunction", 0, 120, {
    subtitle: "DIHOOL DZ47X-125", componentId: "batteryBreakerA", bomIds: ["dse-battery-string-breakers"], purchaseUrl: DIHOOL_120, status: "purchased",
  }),
  breaker("batteryBreakerB", "String B cutoff · 120 A", "batteryCutoffJunction", 1, 120, {
    subtitle: "DIHOOL DZ47X-125", componentId: "batteryBreakerB", bomIds: ["dse-battery-string-breakers"], purchaseUrl: DIHOOL_120, status: "purchased",
  }),
  breaker("mpptBreaker", "SmartSolar cutoff · 120 A", "batteryCutoffJunction", 2, 120, {
    subtitle: "DIHOOL DZ47X-125", componentId: "mpptFuse", bomIds: ["dse-breaker-mnedc100"], purchaseUrl: DIHOOL_120, status: "purchased",
  }),
  {
    id: "mainPositiveBus", label: "Main 24 V positive bus · supplied insulating cover", kind: "busbar", size: [0.18, 0.060, 0.040],
    placement: wall([2.34, 0.30, 0.020]), componentId: "mainDistribution", bomIds: ["dse-main-busbars"], status: "purchased", color: "#b93131",
    currentRatingA: 250, terminalPitchByFaceM: { top: 0.040 }, conductors: [
      ...Array.from({ length: 4 }, (_, index) => p(`post${index + 1}`, `Positive stud ${index + 1}`, "positive", "top", {
        order: index,
        routingGroup: "power-studs",
        routingCapacity: index === 3 ? 3 : 1,
        currentDomain: { id: "main-dc", role: "active" },
        sharedConnectionPolicy: index === 3 ? "approved-stack" : undefined,
        terminal: "Joinfworld covered high-current stud",
        terminalSize: "3/8 in / M10-class stud",
        termination: "Closed tinned-copper 3/8 in / M10 ring lug",
        terminalDiameterMm: 10,
        terminalNote: index === 3
          ? "The MPPT, held direct 1/0 secondary feeder and factory-fused SmartShunt sense lead stack directly on this final stud. Lug stacking and clearance under the supplied cover are approved; upstream feeder protection coordination remains a separate engineering hold."
          : "Use one field termination per modeled landing and the received busbar torque specification.",
      })),
    ],
  },
  {
    id: "smartShunt", label: "Victron SmartShunt IP65 500 A", kind: "monitor", size: [0.12, 0.055, 0.045],
    placement: wall([0.98, 0.43, 0.025]), componentId: "mainDistribution", bomIds: ["dse-shunt"], status: "purchased",
    power: {
      role: "monitor", basis: "manufacturer", verified: true, sourceUrl: SMARTSHUNT_SPEC,
      readings: [{ label: "Current draw", watts: 0.024, voltage: "24 V", note: "Upper bound from the published <1 mA draw." }],
      note: "The 500 A shunt rating is measurement-path capacity, not standing consumption. The supplied positive sense lead uses a 1 A fuse.",
      internalProtection: { verified: true, features: ["Factory 1 A fused positive sense lead"] },
    },
    conductors: [
      p("batteryMinus", "Battery minus", "negative", "left", { gauge: "1/0 AWG · 53.5 mm²", terminal: "SmartShunt battery bolt", terminalSize: "M10", termination: "1/0 AWG tinned-copper M10 closed lug", terminalDiameterMm: 10 }),
      p("systemMinus", "System minus", "negative", "right", {
        gauge: "1/0 AWG · 53.5 mm²", terminal: "SmartShunt system bolt", terminalSize: "M10",
        termination: "1/0 AWG tinned-copper M10 closed lug", terminalDiameterMm: 10,
        currentDomain: { id: "main-dc", role: "return" },
      }),
      p("vBattPlus", "Vbatt+ sense", "positive", "top", { order: 0, gauge: "Factory fused lead", terminal: "SmartShunt auxiliary sense lead", terminalSize: "M10 ring eye supplied", termination: "Factory fused M10 ring-eye lead", terminalDiameterMm: 5 }),
      p("veDirect", "VE.Direct", "data", "top", { order: 1, terminal: "VE.Direct receptacle", terminalSize: "Victron VE.Direct", termination: "Factory VE.Direct cable", terminalDiameterMm: 7 }),
    ],
  },
  {
    id: "mainNegativeBus", label: "Main system-negative bus · supplied insulating cover", kind: "busbar", size: [0.18, 0.060, 0.040],
    placement: wall([1.24, 0.43, 0.020]), componentId: "mainDistribution", bomIds: ["dse-main-busbars"], status: "purchased", color: "#252c32",
    currentRatingA: 250, terminalPitchByFaceM: { top: 0.040 }, conductors: [
      ...Array.from({ length: 4 }, (_, index) => p(`post${index + 1}`, `Negative stud ${index + 1}`, "negative", "top", {
        order: index,
        routingGroup: "power-studs",
        currentDomain: { id: "main-dc", role: "return" },
        terminal: "Joinfworld covered high-current stud",
        terminalSize: "3/8 in / M10-class stud",
        termination: "Closed tinned-copper 3/8 in / M10 ring lug",
        terminalDiameterMm: 10,
        terminalNote: "This bus is on the SmartShunt SYSTEM MINUS side. Never land a battery negative here or any load on the BATTERY MINUS side.",
      })),
    ],
  },
  {
    id: "secondaryJunction", label: "Secondary 24 V services junction box · larger enclosure required", kind: "junction", size: [0.48, 0.40, 0.24],
    placement: wall([2.56, 0.76, 0.12]), componentId: "secondaryDistribution",
    bomIds: ["dse-secondary-enclosure-larger", "dse-pg11-cable-glands", "dse-din-rail-pack"], status: "hold", conductors: [],
    holdReason: "The purchased 302 × 302 × 178 mm shell cannot keep both secondary busbars and the six-gang panel on one rear mounting plane. Select and mock up the larger enclosure represented by this planar routed envelope before installation.",
  },
  breaker("sharedServicesBreaker", "Shared switched services · 10 A · 240 W", "secondaryJunction", 0, 10, {
    subtitle: "CHTAIXI B10 · purchased 26 Aug",
    componentId: "secondaryDistribution", bomIds: ["dse-switched-load-breaker"], purchaseUrl: "https://www.amazon.com/dp/B09H4W5HSW",
    status: "hold", procurementStatus: "purchased",
    currentProtection: {
      kind: "breaker", ratedCurrentA: 10, interruptRatingA: 6000, verified: false,
      terminalPairs: [["line", "load"]],
      note: "Retail listing claims 12–110 VDC, thermal-magnetic B curve and 6 kA breaking capacity; received markings and installation conditions still govern.",
    },
    holdReason: "The 10 A rating is appropriate for the 60 W expected load and 100 W conservative device-limit load. Keep the purchased breaker de-energized until its received DC voltage/polarity, 10 A curve, 6 kA claim, terminal range, torque, ambient derating and local acceptance are verified, and until the battery-bank prospective fault current is bounded below its interrupt rating.",
  }),
  breaker("orionBreaker32", "Orion input · 32 A", "secondaryJunction", 1, 32, {
    componentId: "secondaryDistribution", bomIds: ["dse-orion-input-breaker"], purchaseUrl: CHTAIXI_32, status: "purchased",
  }),
  breaker("chargeItBreaker32", "ChargeIT! branch · 32 A", "secondaryJunction", 2, 32, {
    componentId: "secondaryDistribution", bomIds: ["dse-chargeit-branch-breaker"], purchaseUrl: CHTAIXI_32, status: "purchased",
  }),
  {
    id: "secondaryPositiveBus", label: "Secondary 24 V positive bus · 100 A", kind: "busbar", size: [0.12, 0.040, 0.030],
    placement: inside("secondaryJunction", "power", 0), componentId: "secondaryDistribution", color: "#b93131",
    terminalPitchByFaceM: { front: 0.040 },
    bomIds: ["dse-service-return-bus-spares"], status: "purchased", currentRatingA: 100, conductors: [
      ...Array.from({ length: 7 }, (_, index) => p(`post${index + 1}`, `Secondary positive ${index < 2 ? "stud" : "screw"} ${index + 1}`, "positive", "front", {
        order: index,
        routingGroup: index < 2 ? "studs" : "branch-screws",
        currentDomain: { id: "secondary-dc", role: "active" },
        gauge: index === 0 ? "1/0 AWG · 53.5 mm² · field-procured" : undefined,
        terminal: index < 2 ? "Blue Sea 2314 stud" : "Blue Sea 2314 screw",
        terminalSize: index < 2 ? "#10-32 stud" : "#8-32 screw",
        termination: index === 0
          ? "Engineer-approved 1/0 AWG to #10-32 listed transition · selection hold"
          : index < 2 ? "Closed #10 ring terminal" : "Closed #8 ring terminal",
        terminalDiameterMm: index < 2 ? 4.8 : 4.2,
        terminalNote: index === 0
          ? "Direct field-procured 1/0 feeder landing. Do not energize until upstream protection, the 100 A bus rating, #10-32 hardware, lug/transition fit, torque and enclosure clearance receive engineering approval."
          : "One of the two previously unallocated Blue Sea 2314 bars is promoted to the covered secondary-positive bus. Verify conductor size and ring fit against the received 100 A bar.",
      })),
    ],
  },
  {
    id: "secondaryNegativeBus", label: "Secondary 24 V negative bus · 100 A", kind: "busbar", size: [0.12, 0.040, 0.030],
    placement: inside("secondaryJunction", "power", 1), componentId: "secondaryDistribution", color: "#252c32", terminalPitchByFaceM: { front: 0.040 },
    bomIds: ["dse-service-return-bus"], status: "purchased", currentRatingA: 100, conductors: [
      ...Array.from({ length: 7 }, (_, index) => p(`post${index + 1}`, `Secondary negative ${index < 2 ? "stud" : "screw"} ${index + 1}`, "negative", "front", {
        order: index,
        routingGroup: index < 2 ? "studs" : "branch-screws",
        routingCapacity: index === 4 || index === 6 ? 2 : 1,
        currentDomain: { id: "secondary-dc", role: "return" },
        gauge: index === 0 ? "1/0 AWG · 53.5 mm² · field-procured" : undefined,
        terminal: index < 2 ? "Blue Sea 2314 stud" : "Blue Sea 2314 screw",
        terminalSize: index < 2 ? "#10-32 stud" : "#8-32 screw",
        termination: index === 0
          ? "Engineer-approved 1/0 AWG to #10-32 listed transition · selection hold"
          : index < 2 ? "Closed #10 ring terminal" : "Closed #8 ring terminal",
        terminalDiameterMm: index < 2 ? 4.8 : 4.2,
        sharedConnectionPolicy: index === 4 || index === 6 ? "warning" : undefined,
        terminalNote: index === 0
          ? "Direct field-procured 1/0 return landing. Verify the 100 A bus rating, #10-32 hardware, lug/transition fit, torque and enclosure clearance before energizing."
          : undefined,
      })),
    ],
  },
  {
    id: "serviceSplit", label: "Shared service positive split", kind: "connector", presentation: "service-splice", diagramPresentation: "join", size: [0.040, 0.024, 0.030],
    placement: inside("secondaryJunction", "backplate", 1), componentId: "switchedSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("in", "10 A feed", "positive", "left"), p("switches", "Six-gang feed", "positive", "right", { order: 0 }), p("room", "Room-switch feed", "positive", "right", { order: 1 }),
    ],
  },
  {
    id: "internetSplit", label: "Starlink / UniFi positive split", kind: "connector", presentation: "service-splice", diagramPresentation: "join", size: [0.040, 0.024, 0.030],
    placement: inside("secondaryJunction", "backplate", 0), componentId: "internetSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("in", "Switched feed", "positive", "left"), p("starlink", "Starlink +", "positive", "right", { order: 0 }), p("unifi", "UniFi converter +", "positive", "right", { order: 1 }),
    ],
  },
  {
    id: "unifiPower", label: "UniFi 24 V to 5 V USB-A converter", kind: "converter", size: [0.075, 0.040, 0.025],
    placement: inside("secondaryJunction", "backplate", 5), componentId: "unifiPower", bomIds: ["dse-unifi-converter", "dse-unifi-usb-cable"], status: "purchased",
    power: {
      role: "converter", basis: "retailer", verified: false, sourceUrl: "https://www.amazon.com/dp/B0G1W6JTX8",
      readings: [{ label: "Claimed maximum 5 V output", watts: 25, voltage: "5 V", currentA: 5 }],
      note: "The UniFi Express itself is limited to 10 W. Bench-test converter temperature, efficiency and repeated cold starts; no reliable maker data sheet was found.",
      internalProtection: { verified: false, features: ["Over-current", "short-circuit", "over-temperature", "over/under-voltage"], note: "Retail-listing claims only; not credited as verified field-wire protection." },
    },
    conductors: [
      p("positiveIn", "24 V + in", "positive", "bottom", { order: 0 }), p("negativeIn", "24 V − in", "negative", "bottom", { order: 1 }),
      p("usbA", "USB-A power out", "multicore", "top", {
        terminal: "USB-A receptacle", terminalSize: "USB Type-A", termination: "Factory USB-A-to-USB-C cable", terminalDiameterMm: 9,
        currentSource: {
          id: "unifi-converter-output-source", label: "YRDZXG 5 V converter output", channel: "positive",
          continuousCapacityA: 5, shortCircuitCurrentA: "unbounded",
          inherentCurrentLimit: { currentLimitA: 5, verified: false, note: "Retail listing claims a 5 A regulated output and over-current/short-circuit protection." },
          verified: false, basis: "regulated-output",
          note: "The purchased converter claims 5 A output and protection features; verify the received output connector and short-circuit envelope.",
        },
      }),
    ],
  },
  {
    id: "starlinkBreakout", label: "Starlink factory-lead breakout", kind: "connector", presentation: "cable-breakout", diagramPresentation: "join", size: [0.060, 0.034, 0.022],
    placement: inside("secondaryJunction", "backplate", 3), componentId: "internetSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("positive", "Starlink + core", "positive", "top", { order: 0, gauge: "Factory lead", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["cable"] }),
      p("negative", "Starlink − core", "negative", "top", { order: 1, gauge: "Factory lead", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["cable"] }),
      p("cable", "Starlink factory power cable", "multicore", "bottom", { terminal: "Factory two-core cable", terminalSize: "Complete Starlink Mini power lead", termination: "Strain relief / factory connector", terminalDiameterMm: 6, internalMates: ["positive", "negative"] }),
    ],
  },
  twoCoreBreakout("outdoorLightBreakout", "Outdoor-light two-core breakout", inside("secondaryJunction", "backplate", 4)),
  {
    id: "switchPanel", label: "Six-gang service switch panel", subtitle: "1 Internet · 2 outdoor light · 3 Orion H · 4–6 spare", kind: "switch",
    size: [0.19, 0.085, 0.045], placement: inside("secondaryJunction", "backplate", 8), terminalPitchByFaceM: { bottom: 0.040 },
    componentId: "loadSwitches", bomIds: ["dse-switch-array"], status: "purchased",
    power: {
      role: "control-load", basis: "retailer", verified: false, sourceUrl: "https://www.amazon.com/dp/B0DM87L1Q3",
      readings: [{ label: "Rocker indicator LEDs", note: "Standing draw is not published; measure the received prewired panel." }],
      note: "The service devices dominate this branch; reserve 5 W in the circuit budget for switch/indicator and converter uncertainty.",
    },
    conductors: [
      p("common", "Common 24 V feed", "positive", "bottom", { order: 0 }),
      p("internet", "Switch 1 · Starlink + UniFi", "positive", "bottom", { order: 1 }), p("outdoor", "Switch 2 · outdoor light", "positive", "bottom", { order: 2 }),
      p("orionH", "Switch 3 · Orion H remote", "control", "bottom", { order: 3 }), p("spare4", "Switch 4 · spare", "positive", "bottom", { order: 4, optional: true }),
      p("spare5", "Switch 5 · spare", "positive", "bottom", { order: 5, optional: true }),
      p("spare6", "Switch 6 · spare", "positive", "bottom", { order: 6, optional: true }),
    ],
  },

  // The two strings stay parallel in plan, but both rows move closer to the
  // equipment wall. Their positive ends align below the cutoff box and their
  // negative ends align below the SmartShunt, minimizing the four unprotected
  // 1/0 AWG battery leads without lengthening either adjacent series jumper.
  battery("battery1", "Battery 1 · string A lower", [1.32, 0.16, 0.28], "battery1", 0, "battery-string-a"),
  battery("battery2", "Battery 2 · string A upper", [1.90, 0.16, 0.28], "battery2", 1, "battery-string-a",
    batteryStringSource("battery-string-a-source", "24 V battery string A")),
  battery("battery3", "Battery 3 · string B lower", [1.32, 0.16, 0.54], "battery3", 2, "battery-string-b"),
  battery("battery4", "Battery 4 · string B upper", [1.90, 0.16, 0.54], "battery4", 3, "battery-string-b",
    batteryStringSource("battery-string-b-source", "24 V battery string B")),
  {
    id: "balancerA", label: "Victron battery balancer A", kind: "converter", size: [0.113, 0.100, 0.047], placement: wall([0.83, 0.82, 0.024]),
    componentId: "balancers", bomIds: ["dse-balancers"], status: "purchased",
    power: {
      role: "converter", basis: "manufacturer", verified: true, sourceUrl: BALANCER_SPEC,
      readings: [
        { label: "Maximum balance current", currentA: 0.7, voltage: "24 V bank" },
        { label: "Off-state draw", watts: 0.017, voltage: "24 V", note: "0.7 mA published off current." },
      ],
      note: "Balancing current is transferred between series batteries, not an additional 16.8 W continuous house load.",
      internalProtection: { verified: true, features: ["Over-temperature protection"] },
    },
    conductors: [
      p("positive", "String +", "positive", "bottom", { order: 0 }), p("midpoint", "12 V midpoint", "positive", "bottom", { order: 1 }), p("negative", "String −", "negative", "bottom", { order: 2 }),
    ],
  },
  {
    id: "balancerB", label: "Victron battery balancer B", kind: "converter", size: [0.113, 0.100, 0.047], placement: wall([1.00, 0.82, 0.024]),
    componentId: "balancers", bomIds: ["dse-balancers"], status: "purchased",
    power: {
      role: "converter", basis: "manufacturer", verified: true, sourceUrl: BALANCER_SPEC,
      readings: [
        { label: "Maximum balance current", currentA: 0.7, voltage: "24 V bank" },
        { label: "Off-state draw", watts: 0.017, voltage: "24 V", note: "0.7 mA published off current." },
      ],
      note: "Victron calls for at least 0.75 mm² leads; the modeled 1.5 mm² leads satisfy normal current, but their battery-adjacent fault protection remains a separate hold.",
      internalProtection: { verified: true, features: ["Over-temperature protection"] },
    },
    conductors: [
      p("positive", "String +", "positive", "bottom", { order: 0 }), p("midpoint", "12 V midpoint", "positive", "bottom", { order: 1 }), p("negative", "String −", "negative", "bottom", { order: 2 }),
    ],
  },
  {
    id: "multiPlus", label: "Victron MultiPlus-II 24/3000", kind: "inverter", size: [0.268, 0.499, 0.141], placement: wall([1.70, 0.82, 0.071]),
    componentId: "inverter", bomIds: ["dse-multiplus"], status: "purchased", technicalUrl: MULTIPLUS_SPEC,
    power: {
      role: "converter", basis: "manufacturer", verified: true, sourceUrl: MULTIPLUS_SPEC,
      readings: [
        { label: "Continuous AC output at 25 °C", watts: 2400, voltAmps: 3000, voltage: "230 VAC" },
        { label: "Continuous AC output at 40 °C", watts: 2200, voltage: "230 VAC" },
        { label: "Peak AC output", watts: 5500 },
        { label: "Maximum battery-charge current", currentA: 70, voltage: "24 V nominal" },
        { label: "Idle draw", watts: 13 },
        { label: "AES / search draw", wattsRange: [3, 9] },
      ],
      note: "The exact 24/3000/70-32 manual requires a dedicated 300 A external DC protective device and 50 mm² copper for a 0–5 m run. The current direct bus connection lacks that protector and remains a genuine design hold.",
      internalProtection: {
        verified: true,
        features: ["AC-output short-circuit", "overload", "battery high/low voltage", "over-temperature", "input-ripple"],
        note: "Internal equipment protection does not replace the required external DC protection or downstream AC RCBO.",
      },
    },
    conductors: [
      p("dcPositive", "Battery +", "positive", "bottom", {
        order: 0, gauge: "1/0 AWG · 53.5 mm²", terminal: "Victron DC bolt", terminalSize: "M8", termination: "1/0 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8,
        terminalNote: "Victron specifies 12 N·m for the M8 DC connection. This bidirectional terminal is also the 70 A charger output.",
        currentSource: {
          id: "multiplus-dc-charger-source", label: "MultiPlus 70 A DC charger output", channel: "positive",
          continuousCapacityA: 70, shortCircuitCurrentA: "unbounded",
          inherentCurrentLimit: { currentLimitA: 70, verified: true, note: "Published maximum regulated battery-charge current." },
          verified: true, basis: "regulated-output",
          note: "The regulated charger contribution is bounded at 70 A. This does not limit reverse battery current into the bidirectional DC terminal.",
        },
      }),
      p("dcNegative", "Battery −", "negative", "bottom", { order: 1, gauge: "1/0 AWG · 53.5 mm²", terminal: "Victron DC bolt", terminalSize: "M8", termination: "1/0 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8, terminalNote: "Victron specifies 12 N·m for the M8 DC connection." }),
      p("acInLine", "AC input L", "ac-line", "bottom", { order: 2, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6 }),
      p("acInNeutral", "AC input N", "ac-neutral", "bottom", { order: 3, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6 }),
      p("acInEarth", "AC input PE", "earth", "bottom", { order: 4, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Green/yellow fine-stranded copper", terminalDiameterMm: 6 }),
      p("acOutLine", "AC output L", "ac-line", "bottom", {
        order: 5, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6,
        currentSource: {
          id: "multiplus-ac-output-source", label: "MultiPlus AC output", channel: "ac-line",
          continuousCapacityA: 13, shortCircuitCurrentA: "unbounded", verified: false, basis: "regulated-output",
          note: "The downstream 10 A RCBO is modeled; confirm the inverter short-circuit envelope and source-lead coordination.",
        },
      }),
      p("acOutNeutral", "AC output N", "ac-neutral", "bottom", { order: 6, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6 }),
      p("acOutEarth", "AC output PE", "earth", "bottom", { order: 7, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Green/yellow fine-stranded copper", terminalDiameterMm: 6 }),
      p("chassisEarth", "Chassis PE", "earth", "bottom", { order: 8, gauge: "16 mm²", terminal: "Primary chassis-earth bolt", terminalSize: "M6", termination: "16 mm² tinned-copper M6 closed lug", terminalDiameterMm: 6 }),
      p("veBus", "VE.Bus", "data", "right", { order: 0, terminal: "RJ45 VE.Bus receptacle", terminalSize: "8P8C / RJ45", termination: "Factory Victron RJ45 cable", terminalDiameterMm: 9 }),
    ],
  },
  acBreakout("multiAcInBreakout", "MultiPlus AC-in cable breakout", wall([1.68, 0.42, 0.018]), "bottom", "top"),
  acBreakout("multiAcOutBreakout", "MultiPlus AC-out cable breakout", wall([1.74, 0.42, 0.018]), "bottom", "top"),
  {
    id: "acJunction", label: "AC input / output protection box", kind: "junction", size: [0.36, 0.44, 0.12], placement: wall([0.96, 1.58, 0.06]),
    componentId: "acBoard", bomIds: ["dse-ac-rcbo"], status: "hold", conductors: [],
    holdReason: "The purchased 200 × 155 × 92 mm enclosure is too small for this clean backplate layout. Select and mock up a larger IP-rated box; final 10 A / 30 mA Type A RCBO + SPD assemblies require qualified-installer approval.",
  },
  {
    id: "acInputProtection", label: "AC-in 10 A Type A RCBO + SPD", kind: "protection", poles: 4, size: [0.080, 0.085, 0.070], placement: inside("acJunction", "din", 0),
    componentId: "generatorInput", bomIds: ["dse-ac-rcbo"], status: "hold", procurementStatus: "purchased",
    currentProtection: { kind: "breaker", ratedCurrentA: 10, verified: false, terminalPairs: [["lineIn", "lineOut"]] }, conductors: [
      p("lineIn", "Generator L", "ac-line", "bottom", { order: 0, gauge: "1.5 mm²", terminal: "DIHOOL line screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("neutralIn", "Generator N", "ac-neutral", "bottom", { order: 1, gauge: "1.5 mm²", terminal: "DIHOOL neutral screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("earth", "SPD protective earth", "earth", "bottom", { order: 2, gauge: "1.5 mm²", terminal: "DIHOOL ground screw clamp", terminalSize: "≤6 mm² per manufacturer page", termination: "Green/yellow core; ferrule only if accepted", terminalDiameterMm: 6, terminalNote: "This is the SPD earth landing, not a switched neutral or an N–PE bond." }),
      p("lineOut", "Protected L", "ac-line", "top", { order: 0, gauge: "1.5 mm²", terminal: "DIHOOL line screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("neutralOut", "Protected N", "ac-neutral", "top", { order: 1, gauge: "1.5 mm²", terminal: "DIHOOL neutral screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
    ],
    holdReason: "Two B0CRKNJSRH 10 A candidates are purchased. Do not commission until each exact received unit is verified as 10 A, 30 mA Type A and two-pole, and its interrupt capacity, N–PE behavior, voltage/frequency rating, SPD classification and local acceptance are confirmed. The earlier B0DCN7HK57 30 A pair is return-only.",
  },
  {
    id: "acOutputProtection", label: "AC-out 10 A Type A RCBO + SPD", kind: "protection", poles: 4, size: [0.080, 0.085, 0.070], placement: inside("acJunction", "din", 1),
    componentId: "acBoard", bomIds: ["dse-ac-rcbo"], status: "hold", procurementStatus: "purchased",
    currentProtection: { kind: "breaker", ratedCurrentA: 10, verified: false, terminalPairs: [["lineIn", "lineOut"]] }, conductors: [
      p("lineIn", "MultiPlus L", "ac-line", "bottom", { order: 0, gauge: "1.5 mm²", terminal: "DIHOOL line screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("neutralIn", "MultiPlus N", "ac-neutral", "bottom", { order: 1, gauge: "1.5 mm²", terminal: "DIHOOL neutral screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("earth", "SPD protective earth", "earth", "bottom", { order: 2, gauge: "1.5 mm²", terminal: "DIHOOL ground screw clamp", terminalSize: "≤6 mm² per manufacturer page", termination: "Green/yellow core; ferrule only if accepted", terminalDiameterMm: 6, terminalNote: "This is the SPD earth landing; protective earth remains continuous through the bodyless daisy-chain join and is never switched." }),
      p("lineOut", "Socket L", "ac-line", "top", { order: 0, gauge: "1.5 mm²", terminal: "DIHOOL line screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("neutralOut", "Socket N", "ac-neutral", "top", { order: 1, gauge: "1.5 mm²", terminal: "DIHOOL neutral screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
    ],
    holdReason: "Two B0CRKNJSRH 10 A candidates are purchased. Do not commission until each exact received unit is verified as 10 A, 30 mA Type A and two-pole, and its interrupt capacity, N–PE behavior, voltage/frequency rating, SPD classification and local acceptance are confirmed. The earlier B0DCN7HK57 30 A pair is return-only.",
  },
  acBreakout("generatorAcBreakout", "Generator-input cable breakout", inside("acJunction", "backplate", 0)),
  acBreakout("acInputCableBreakout", "Protected AC-in cable breakout", inside("acJunction", "backplate", 1)),
  acBreakout("acOutputCableBreakout", "MultiPlus-output cable breakout", inside("acJunction", "backplate", 2)),
  acBreakout("toolAcBreakout", "Trailing-tool cable breakout", inside("acJunction", "backplate", 3)),
  {
    id: "servicePenetration", label: "Single inside / outside service penetration", kind: "connector", presentation: "wall-passthrough", size: [0.280, 0.180, 0.045], placement: wall([0.30, 0.40, 0]),
    componentId: "mounting", bomIds: ["dse-terms"], status: "planned", conductors: [
      p("acOutside", "Generator cable · outside", "multicore", "back", { order: 0, terminal: "Sealed wall penetration", terminalSize: "3-core cable gland", termination: "Strain-relieved white cable", terminalDiameterMm: 9.8, internalMates: ["acInside"] }),
      p("earthOutside", "Electrode bond · outside", "earth", "back", { order: 1, gauge: "16 mm²", terminal: "Sealed wall penetration", terminalSize: "16 mm² conductor gland", termination: "Continuous insulated earth conductor", terminalDiameterMm: 8.6, internalMates: ["earthInside"] }),
      p("pvAPosOutside", "PV string A + · outside", "positive", "back", { order: 2, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvAPosInside"] }),
      p("pvANegOutside", "PV string A − · outside", "negative", "back", { order: 3, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvANegInside"] }),
      p("pvBPosOutside", "PV string B + · outside", "positive", "back", { order: 4, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvBPosInside"] }),
      p("pvBNegOutside", "PV string B − · outside", "negative", "back", { order: 5, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvBNegInside"] }),
      p("frameAOutside", "PV frame bond A · outside", "earth", "back", { order: 6, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² bond-conductor gland", termination: "Continuous insulated copper bond", terminalDiameterMm: 5, internalMates: ["frameAInside"] }),
      p("frameBOutside", "PV frame bond B · outside", "earth", "back", { order: 7, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² bond-conductor gland", termination: "Continuous insulated copper bond", terminalDiameterMm: 5, internalMates: ["frameBInside"] }),
      p("lightOutside", "Outdoor-light cable · outside", "multicore", "back", { order: 8, gauge: "2 × 1.5 mm²", terminal: "Sealed wall penetration", terminalSize: "Two-core cable gland", termination: "Strain-relieved white cable", terminalDiameterMm: 6.4, internalMates: ["lightInside"] }),
      p("starlinkPowerOutside", "Starlink power · outside", "multicore", "back", { order: 9, gauge: "Factory lead", terminal: "Sealed wall penetration", terminalSize: "Starlink power-cable gland", termination: "Strain-relieved factory cable", terminalDiameterMm: 6, internalMates: ["starlinkPowerInside"] }),
      p("starlinkDataOutside", "Starlink Ethernet · outside", "data", "back", { order: 10, gauge: "Outdoor Ethernet", terminal: "Sealed wall penetration", terminalSize: "Ethernet cable gland", termination: "Outdoor-rated continuous data cable", terminalDiameterMm: 6, internalMates: ["starlinkDataInside"] }),
      p("acInside", "Generator cable · inside", "multicore", "front", { order: 0, terminal: "Sealed wall penetration", terminalSize: "3-core cable gland", termination: "Strain-relieved white cable", terminalDiameterMm: 9.8, internalMates: ["acOutside"] }),
      p("earthInside", "Electrode bond · inside", "earth", "front", { order: 1, gauge: "16 mm²", terminal: "Sealed wall penetration", terminalSize: "16 mm² conductor gland", termination: "Continuous insulated earth conductor", terminalDiameterMm: 8.6, internalMates: ["earthOutside"] }),
      p("pvAPosInside", "PV string A + · inside", "positive", "front", { order: 2, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvAPosOutside"] }),
      p("pvANegInside", "PV string A − · inside", "negative", "front", { order: 3, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvANegOutside"] }),
      p("pvBPosInside", "PV string B + · inside", "positive", "front", { order: 4, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvBPosOutside"] }),
      p("pvBNegInside", "PV string B − · inside", "negative", "front", { order: 5, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvBNegOutside"] }),
      p("frameAInside", "PV frame bond A · inside", "earth", "front", { order: 6, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² bond-conductor gland", termination: "Continuous insulated copper bond", terminalDiameterMm: 5, internalMates: ["frameAOutside"] }),
      p("frameBInside", "PV frame bond B · inside", "earth", "front", { order: 7, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² bond-conductor gland", termination: "Continuous insulated copper bond", terminalDiameterMm: 5, internalMates: ["frameBOutside"] }),
      p("lightInside", "Outdoor-light cable · inside", "multicore", "front", { order: 8, gauge: "2 × 1.5 mm²", terminal: "Sealed wall penetration", terminalSize: "Two-core cable gland", termination: "Strain-relieved white cable", terminalDiameterMm: 6.4, internalMates: ["lightOutside"] }),
      p("starlinkPowerInside", "Starlink power · inside", "multicore", "front", { order: 9, gauge: "Factory lead", terminal: "Sealed wall penetration", terminalSize: "Starlink power-cable gland", termination: "Strain-relieved factory cable", terminalDiameterMm: 6, internalMates: ["starlinkPowerOutside"] }),
      p("starlinkDataInside", "Starlink Ethernet · inside", "data", "front", { order: 10, gauge: "Outdoor Ethernet", terminal: "Sealed wall penetration", terminalSize: "Ethernet cable gland", termination: "Outdoor-rated continuous data cable", terminalDiameterMm: 6, internalMates: ["starlinkDataOutside"] }),
    ],
  },
  {
    id: "generator", label: "Existing Husqvarna G3200P", kind: "generator",
    size: [0.60, 0.56, 0.48], placement: outside([0.58, 0.30, -0.72]),
    terminalPitchByFaceM: { right: AC_CORE_PITCH_M },
    componentId: "generator", bomIds: ["dse-existing-generator"], status: "purchased", procurementStatus: "existing", technicalUrl: HUSQVARNA_G3200P,
    power: {
      role: "source", basis: "manufacturer", verified: false, sourceUrl: HUSQVARNA_G3200P,
      readings: [
        { label: "Rated 50 Hz AC output", watts: 2800, voltage: "230 VAC" },
        { label: "Model-family maximum output", wattsRange: [3000, 3200], note: "Published manuals/product variants differ; received nameplate governs." },
      ],
      note: "Pre-existing/purchased equipment. The planned 10 A input circuit intentionally limits usable transfer to 2.3 kW; confirm the exact Fiji receptacle, outlet breaker and neutral-earth arrangement on the actual unit.",
      internalProtection: { verified: false, features: ["Resettable outlet circuit breaker"], note: "The model-family manual documents a circuit breaker, but its exact received rating and fault capability are not yet recorded." },
    },
    conductors: [
      p("line", "Active / L post", "ac-line", "right", {
        order: 0, terminal: "Generator active contact", terminalSize: "AS/NZS 3112 / Type I outlet core", termination: "Internal/factory contact", terminalDiameterMm: 5,
        currentSource: {
          id: "generator-active-source", label: "Husqvarna generator active output", channel: "ac-line",
          continuousCapacityA: 10, shortCircuitCurrentA: "unbounded", verified: false, basis: "upstream-protected-source",
          note: "Confirm the generator's received outlet breaker and fault-current envelope.",
        },
      }),
      p("neutral", "Neutral / N post", "ac-neutral", "right", { order: 1, terminal: "Generator neutral contact", terminalSize: "AS/NZS 3112 / Type I outlet core", termination: "Internal/factory contact", terminalDiameterMm: 5 }),
      p("earth", "Protective-earth / PE post", "earth", "right", { order: 2, terminal: "Generator earth contact", terminalSize: "AS/NZS 3112 / Type I outlet core", termination: "Internal/factory contact", terminalDiameterMm: 5 }),
    ],
  },
  acBreakout(
    "generatorLeadBreakout",
    "Generator trailing-lead breakout",
    outside([0.96, 0.30, -0.72], [0, 0, -Math.PI / 2]),
    "top",
    "bottom",
  ),
  {
    id: "toolOutlet", label: "Type I trailing tool outlet", kind: "load",
    size: [0.085, 0.060, 0.040], placement: wall([0.38, 1.40, 0.025]),
    terminalPitchByFaceM: { bottom: AC_CORE_PITCH_M },
    componentId: "toolOutlet", bomIds: ["dse-tool-lead"], status: "planned",
    power: {
      role: "variable-load", basis: "calculated", verified: true,
      readings: [
        { label: "Posted one-tool operating limit", watts: 1800, voltage: "230 VAC", currentA: 7.83 },
        { label: "10 A outlet hardware ceiling", watts: 2300, voltage: "230 VAC", currentA: 10 },
      ],
      note: "The 2.3 kW figure is only the outlet/nameplate ceiling. Normal operation is one corded tool at a time with a nameplate at or below 1.8 kW; motor starting current is transient and must pass the warm-condition commissioning test without nuisance trips or excessive voltage sag.",
    },
    conductors: [
      p("line", "Active / L post", "ac-line", "bottom", { order: 0, terminal: "Type I active contact", terminalSize: "AS/NZS 3112", termination: "Internal/factory contact", terminalDiameterMm: 5 }),
      p("neutral", "Neutral / N post", "ac-neutral", "bottom", { order: 1, terminal: "Type I neutral contact", terminalSize: "AS/NZS 3112", termination: "Internal/factory contact", terminalDiameterMm: 5 }),
      p("earth", "Earth / PE post", "earth", "bottom", { order: 2, terminal: "Type I earth contact", terminalSize: "AS/NZS 3112", termination: "Internal/factory contact", terminalDiameterMm: 5 }),
    ],
  },
  acBreakout("toolOutletLeadBreakout", "Tool-outlet trailing-lead breakout", wall([0.38, 1.24, 0.018])),
  {
    id: "earthBar", label: "Main protective-earth busbar", kind: "earth", size: [0.18, 0.030, 0.030], placement: wall([0.68, 0.52, 0.018]),
    componentId: "earthBus", bomIds: ["dse-earth-busbar"], status: "purchased", conductors: [
      ...Array.from({ length: 8 }, (_, index) => p(`post${index + 1}`, `PE ${index < 2 ? "stud" : "screw"} ${index + 1}`, "earth", index < 4 ? "top" : "bottom", {
        order: index % 4,
        routingGroup: index < 2 ? "high-current-studs" : "branch-screws",
        terminal: index < 2 ? "Blue Sea 2128 high-current stud" : "Blue Sea 2128 branch screw",
        terminalSize: index < 2 ? "5/16-18 stud" : "#10-24 screw",
        termination: index < 2 ? "Closed 5/16-inch tinned-copper ring" : "Closed #10 tinned-copper ring",
        terminalDiameterMm: index < 2 ? 7.94 : 4.8,
        terminalNote: "Blue Sea permits no more than four terminals per stud; this graph assigns one route to each landing.",
      })),
    ],
  },
  {
    id: "earthElectrode", label: "Earth electrode", kind: "earth", size: [0.035, 0.70, 0.035], placement: outside([0.14, 0.35, -0.35]),
    componentId: "earth", bomIds: ["dse-earth"], status: "planned", conductors: [p("clamp", "Electrode clamp", "earth", "top", { gauge: "16 mm²", terminal: "Listed earth-electrode clamp", terminalSize: "Match received rod and 16 mm² conductor", termination: "Continuous insulated copper bond", terminalDiameterMm: 10 })],
  },
  {
    id: "ekrano", label: "Victron Ekrano GX", kind: "monitor", size: [0.187, 0.124, 0.030], placement: wall([1.34, 1.42, 0.015]),
    terminalPitchByFaceM: { bottom: 0.040 },
    componentId: "systemMonitor", bomIds: ["dse-ekrano-gx", "dse-vedirect-cables", "dse-vebus-cable", "dse-ekrano-ethernet"], status: "purchased", technicalUrl: EKRANO_SPEC,
    power: {
      role: "monitor", basis: "manufacturer", verified: true, sourceUrl: EKRANO_SPEC,
      readings: [
        { label: "Display off", watts: 3, voltage: "24 V" },
        { label: "Display on", watts: 6.6, voltage: "24 V" },
      ],
      note: "Two unused USB host ports could add up to 7.5 W combined; no USB loads are modeled on the Ekrano. The supplied power lead is fused at 3.15 A.",
      internalProtection: { verified: true, features: ["Factory 3.15 A fused positive supply lead"] },
    },
    conductors: [
      p("positive", "Power +", "positive", "bottom", { order: 0, gauge: "Factory fused lead", terminal: "Ekrano power connector", terminalSize: "Factory mating plug with M8 battery ring", termination: "Supplied 3.15 A fused power lead", terminalDiameterMm: 5 }),
      p("veDirectSolar", "VE.Direct · SmartSolar", "data", "bottom", { order: 1, terminal: "VE.Direct receptacle", terminalSize: "Victron VE.Direct", termination: "Factory VE.Direct cable", terminalDiameterMm: 7 }),
      p("veDirectShunt", "VE.Direct · SmartShunt", "data", "bottom", { order: 2, terminal: "VE.Direct receptacle", terminalSize: "Victron VE.Direct", termination: "Factory VE.Direct cable", terminalDiameterMm: 7 }),
      p("veBus", "VE.Bus · MultiPlus", "data", "bottom", { order: 3, terminal: "RJ45 VE.Bus receptacle", terminalSize: "8P8C / RJ45", termination: "Factory Victron RJ45 cable", terminalDiameterMm: 9 }),
      p("ethernet", "Ethernet", "data", "bottom", { order: 4, terminal: "RJ45 Ethernet receptacle", terminalSize: "8P8C / RJ45", termination: "Factory Ethernet patch cable", terminalDiameterMm: 9 }),
      p("negative", "Power −", "negative", "bottom", { order: 5, gauge: "Factory lead", terminal: "Ekrano power connector", terminalSize: "Factory mating plug with M8 battery ring", termination: "Supplied power lead", terminalDiameterMm: 5 }),
    ],
  },
  {
    id: "starlink", label: "Starlink Mini", kind: "load", size: [0.299, 0.039, 0.259], placement: outside([3.55, 3.35, 0.10]),
    componentId: "starlink", bomIds: ["dse-ex-starlink"], status: "purchased", procurementStatus: "purchased", technicalUrl: STARLINK_SPEC,
    power: {
      role: "load", basis: "manufacturer", verified: true, sourceUrl: STARLINK_SPEC,
      readings: [
        { label: "Average input", wattsRange: [25, 40], voltage: "12–48 VDC" },
        { label: "Rated input ceiling", watts: 60, voltage: "12–48 VDC" },
      ],
      note: "The 40 W planning value is the top of Starlink's published average range; 60 W is used for conservative branch capacity.",
    },
    conductors: [
      p("power", "Factory DC power lead", "multicore", "bottom", { order: 0, terminal: "Starlink Mini DC power connector", terminalSize: "Factory two-core lead", termination: "Complete Starlink power cable", terminalDiameterMm: 6, internalMates: ["positive", "negative"] }),
      p("ethernet", "Ethernet", "data", "bottom", { order: 1, terminal: "RJ45 Ethernet receptacle", terminalSize: "8P8C / RJ45", termination: "Outdoor-rated Ethernet lead", terminalDiameterMm: 9 }),
    ],
  },
  {
    id: "unifi", label: "UniFi Express", kind: "load", size: [0.098, 0.098, 0.030], placement: wall([2.48, 1.42, 0.015]),
    componentId: "router", bomIds: ["dse-router"], status: "purchased", technicalUrl: UNIFI_SPEC,
    power: {
      role: "load", basis: "manufacturer", verified: true, sourceUrl: UNIFI_SPEC,
      readings: [{ label: "Maximum input", watts: 10, voltage: "USB-C 5 V / 3 A supply" }],
      note: "The 10 W manufacturer maximum, rather than the converter's 25 W capability, is the expected UniFi load.",
    },
    conductors: [
      p("usbC", "USB-C power", "multicore", "bottom", { order: 0, terminal: "USB-C power receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C cable", terminalDiameterMm: 8 }),
      p("ethernetStarlink", "WAN / Starlink", "data", "bottom", { order: 1, terminal: "RJ45 WAN receptacle", terminalSize: "8P8C / RJ45", termination: "Factory Ethernet patch cable", terminalDiameterMm: 9 }),
      p("ethernetEkrano", "LAN / Ekrano", "data", "bottom", { order: 2, terminal: "RJ45 LAN receptacle", terminalSize: "8P8C / RJ45", termination: "Factory Ethernet patch cable", terminalDiameterMm: 9 }),
    ],
  },
  {
    id: "usbOrion", label: "Victron Orion-Tr Smart 24/12-30", kind: "converter", size: [0.130, 0.186, 0.055], placement: wall([2.92, 0.66, 0.028]),
    componentId: "orionUsb", bomIds: ["dse-orion-usb-converter"], status: "purchased", technicalUrl: ORION_SPEC,
    power: {
      role: "converter", basis: "manufacturer", verified: true, sourceUrl: ORION_SPEC,
      readings: [
        { label: "Continuous output at 40 °C", watts: 360, currentA: 30, voltage: "12 V nominal" },
        { label: "Output at 25 °C", watts: 430 },
        { label: "Ten-second output", currentA: 45, durationSeconds: 10 },
        { label: "Short-circuit output", currentA: 60 },
        { label: "No-load input ceiling", watts: 2.4, voltage: "24 V", note: "Derived from <100 mA." },
        { label: "Remote-off ceiling", watts: 0.024, voltage: "24 V", note: "Derived from <1 mA." },
      ],
      note: "Efficiency is 88%. Victron's installation table recommends a 30 A external protective device and 6 mm² cable for a 24 V, 1–2 m run; the purchased 32 A breaker is close and may need ambient/curve review.",
      internalProtection: { verified: true, features: ["60 A hard short-circuit output limit", "over-temperature derating"] },
    },
    conductors: [
      p("remoteH", "Remote H", "control", "bottom", { order: 0, gauge: "0.75 mm²", terminal: "Orion remote H screw clamp", terminalSize: "Verify received remote connector", termination: "0.75 mm² bootlace ferrule if accepted", terminalDiameterMm: 4, terminalNote: "The six-gang switch applies positive to H; L remains unused." }),
      p("positiveIn", "+ input · 24 V", "positive", "bottom", { order: 1, gauge: "6 mm²", terminal: "Orion power screw clamp", terminalSize: "Fine-stranded copper terminal", termination: "Bare fine-stranded copper; ferrule is not required by Victron", terminalDiameterMm: 7, terminalNote: "Victron's 24 V table recommends 6 mm² for a 1–2 m run; terminal torque is 1.6 N·m." }),
      p("ground", "Common ground / −", "negative", "bottom", { order: 2, gauge: "10 mm²", terminal: "Orion common-negative screw clamp", terminalSize: "Fine-stranded copper terminal", termination: "Bare fine-stranded copper; ferrule is not required by Victron", terminalDiameterMm: 8, terminalNote: "This single common negative is shared by input and output in the non-isolated model; terminal torque is 1.6 N·m." }),
      p("positiveOut", "+ output · 12 V", "positive", "bottom", {
        order: 3, gauge: "10 mm²", terminal: "Orion output screw clamp", terminalSize: "Fine-stranded copper terminal", termination: "Bare fine-stranded copper; ferrule is not required by Victron", terminalDiameterMm: 8,
        terminalNote: "Official 2026 data: 30 A continuous, 45 A for 10 s and 60 A short-circuit output. The verified regulator enables the authored branch, but its 60 A fault envelope does not prove 12 AWG harness protection.",
        currentSource: {
          id: "orion-output-source", label: "Orion-Tr Smart 24/12-30 output", channel: "positive",
          continuousCapacityA: 30, peakCapacity: { currentA: 45, durationSeconds: 10 }, shortCircuitCurrentA: 60,
          inherentCurrentLimit: { currentLimitA: 60, verified: true, note: "Official 2026 short-circuit output limit; not a 30 A conductor-protection limit." },
          verified: true, basis: "regulated-output",
          note: "Official 2026 specification: 30 A continuous, 45 A maximum for 10 s and 60 A short-circuit output.",
        },
      }),
    ],
  },
  {
    id: "usbSocketA", label: "12 V cigarette-lighter socket A", kind: "connector", size: [0.052, 0.072, 0.048], placement: wall([3.08, 0.82, 0.024]),
    componentId: "usb", bomIds: ["dse-usb-sockets"], status: "purchased", conductors: [
      p("positive", "Rear centre-positive lead", "positive", "bottom", { order: 0, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory red pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8, terminalNote: "This terminal carries the downstream socket as well as socket A; retain any integral protection and obtain installer approval." }),
      p("negative", "Rear shell-negative lead", "negative", "bottom", { order: 1, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory black pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("socket", "12 V accessory receptacle", "multicore", "front", { terminal: "SAE J563-style accessory socket", terminalSize: "Centre positive / shell negative", termination: "Mating Coolgear cigarette plug", terminalDiameterMm: 21, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
    ],
  },
  {
    id: "usb145A", label: "Coolgear 145 W charger A", kind: "load", size: [0.052, 0.040, 0.092], placement: wall([3.08, 0.82, 0.100]),
    componentId: "usb", layoutGroup: { id: "coolgear-145", label: "Coolgear 145 W chargers", columns: 2, order: 0 },
    bomIds: ["dse-usb"], purchaseUrl: COOLGEAR_145, status: "purchased",
    power: {
      role: "load", basis: "manufacturer", verified: true, sourceUrl: COOLGEAR_145,
      readings: [
        { label: "Maximum USB output", watts: 145 },
        { label: "Rated input current", currentA: 15, voltage: "12–24 V nominal / 9–32 V extended" },
      ],
      note: "Coolgear does not publish idle draw; measure the received charger. Two units can use the Orion's complete 30 A continuous output allowance.",
      internalProtection: { verified: true, features: ["Output over-current", "short-circuit", "over-temperature"], note: "These protect charger/output behavior; they do not prove protection of the upstream 12 AWG socket daisy chain." },
    },
    conductors: [
      p("plug", "Factory cigarette-lighter plug", "multicore", "back", { terminal: "Cigarette-lighter plug", terminalSize: "Centre positive / shell negative", termination: "Mates directly with wall socket", terminalDiameterMm: 20, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
      p("usbC1", "USB-C 1", "multicore", "front", { order: 0, optional: true, terminal: "USB-C receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C plug", terminalDiameterMm: 8 }),
      p("usbC2", "USB-C 2", "multicore", "front", { order: 1, optional: true, terminal: "USB-C receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C plug", terminalDiameterMm: 8 }),
    ],
  },
  {
    id: "usbSocketB", label: "12 V cigarette-lighter socket B", kind: "connector", size: [0.052, 0.072, 0.048], placement: wall([3.38, 0.82, 0.024]),
    componentId: "usb", bomIds: ["dse-usb-sockets"], status: "purchased", conductors: [
      p("positive", "Rear centre-positive lead", "positive", "bottom", { order: 0, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory red pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("negative", "Rear shell-negative lead", "negative", "bottom", { order: 1, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory black pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("socket", "12 V accessory receptacle", "multicore", "front", { terminal: "SAE J563-style accessory socket", terminalSize: "Centre positive / shell negative", termination: "Mating Coolgear cigarette plug", terminalDiameterMm: 21, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
    ],
  },
  {
    id: "usb145B", label: "Coolgear 145 W charger B", kind: "load", size: [0.052, 0.040, 0.092], placement: wall([3.38, 0.82, 0.100]),
    componentId: "usb", layoutGroup: { id: "coolgear-145", label: "Coolgear 145 W chargers", columns: 2, order: 1 },
    bomIds: ["dse-usb"], purchaseUrl: COOLGEAR_145, status: "purchased",
    power: {
      role: "load", basis: "manufacturer", verified: true, sourceUrl: COOLGEAR_145,
      readings: [
        { label: "Maximum USB output", watts: 145 },
        { label: "Rated input current", currentA: 15, voltage: "12–24 V nominal / 9–32 V extended" },
      ],
      note: "Coolgear does not publish idle draw; measure the received charger. Two units can use the Orion's complete 30 A continuous output allowance.",
      internalProtection: { verified: true, features: ["Output over-current", "short-circuit", "over-temperature"], note: "These protect charger/output behavior; they do not prove protection of the upstream 12 AWG socket daisy chain." },
    },
    conductors: [
      p("plug", "Factory cigarette-lighter plug", "multicore", "back", { terminal: "Cigarette-lighter plug", terminalSize: "Centre positive / shell negative", termination: "Mates directly with wall socket", terminalDiameterMm: 20, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
      p("usbC1", "USB-C 1", "multicore", "front", { order: 0, optional: true, terminal: "USB-C receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C plug", terminalDiameterMm: 8 }),
      p("usbC2", "USB-C 2", "multicore", "front", { order: 1, optional: true, terminal: "USB-C receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C plug", terminalDiameterMm: 8 }),
    ],
  },
  usbMini("usbMiniA", "ChargeIT! Mini 75 W A", 3.38, 0),
  usbMini("usbMiniB", "ChargeIT! Mini 75 W B", 3.50, 1),
  usbMini("usbMiniC", "ChargeIT! Mini 75 W C", 3.62, 2),
  usbMini("usbMiniD", "ChargeIT! Mini 75 W D", 3.74, 3),
  twoCoreBreakout("indoorLightBreakout", "Indoor-light two-core breakout", wall([4.88, 0.52, 0.018])),
  {
    id: "roomSwitch", label: "Indoor-light wall switch", kind: "switch", size: [0.090, 0.090, 0.035], placement: wall([4.58, 0.82, 0.018]),
    componentId: "roomSwitch", bomIds: ["dse-room-switch"], status: "purchased",
    power: {
      role: "control-load", basis: "retailer", verified: false, sourceUrl: "https://www.amazon.com/dp/B0FCYKC4R7",
      readings: [{ label: "Red indicator", note: "Standing draw is not published; measure it energized at the commissioned bank voltage." }],
    },
    conductors: [p("in", "24 V feed", "positive", "bottom"), p("out", "Switched light +", "positive", "top")],
  },
  {
    id: "indoorLight", label: "Indoor utility light", kind: "load", size: [0.127, 0.055, 0.055], placement: ceiling([3.05, 3.42, 1.05]),
    componentId: "indoorLight", bomIds: ["dse-indoor-light"], status: "purchased",
    power: { role: "load", basis: "user-confirmed", verified: true, readings: [{ label: "Input", watts: 5, voltage: "12–28 VDC" }], note: "5 W value confirmed by the system owner; verify received label/current during bench commissioning." },
    conductors: [p("power", "Factory two-core light lead", "multicore", "left", { terminal: "Factory light pigtail", terminalSize: "Two-core 24 V lead", termination: "Sealed two-core cable splice", terminalDiameterMm: 6.4, internalMates: ["positive", "negative"] })],
  },
  {
    id: "outdoorLight", label: "Outdoor utility light", kind: "load", size: [0.127, 0.055, 0.055], placement: outsideWall([5.82, 2.30, -0.08]),
    componentId: "outdoorLight", bomIds: ["dse-outdoor-light"], status: "purchased",
    power: { role: "load", basis: "user-confirmed", verified: true, readings: [{ label: "Input", watts: 5, voltage: "12–28 VDC" }], note: "5 W value confirmed by the system owner; verify received label/current during bench commissioning." },
    conductors: [p("power", "Factory two-core light lead", "multicore", "front", { terminal: "Factory light pigtail", terminalSize: "Two-core 24 V lead", termination: "Sealed two-core cable splice", terminalDiameterMm: 6.4, internalMates: ["positive", "negative"] })],
  },
];

export const dseJunctions: readonly Junction[] = [
  { id: "battery-cutoff", deviceId: "batteryCutoffJunction", label: "Battery / MPPT cutoff junction", minimumSize: [0.20, 0.16, 0.10], padding: 0.010, dinGap: 0.020, backplateGap: 0.010, glandSpacing: 0.020, sizePolicy: "verified-fixed" },
  { id: "secondary", deviceId: "secondaryJunction", label: "Secondary 24 V services junction", minimumSize: [0.48, 0.40, 0.24], padding: 0.010, dinGap: 0.020, backplateGap: 0.020, glandSpacing: 0.020, sizePolicy: "auto", dinPosition: "bottom" },
  { id: "pv", deviceId: "pvJunction", label: "PV junction", minimumSize: [0.29, 0.27, 0.15], padding: 0.020, dinGap: 0, backplateGap: 0.030, glandSpacing: 0.040 },
  { id: "ac", deviceId: "acJunction", label: "AC junction", minimumSize: [0.36, 0.44, 0.12], padding: 0.020, dinGap: 0, backplateGap: 0, glandSpacing: 0.040 },
];

const dseBaseConnections: readonly Connection[] = [
  w("pv-a-series", ep("panel1", "positive"), ep("panel2", "negative"), "positive", "pv4", { seriesLink: true }),
  w("pv-b-series", ep("panel3", "positive"), ep("panel4", "negative"), "positive", "pv4", { seriesLink: true }),
  w("pv-a-positive-outside", ep("panel2", "positive"), ep("servicePenetration", "pvAPosOutside"), "positive", "pv4", { bundleId: "pv-string-a", circuitId: "pv-a-outside" }),
  w("pv-a-positive-inside", ep("servicePenetration", "pvAPosInside"), ep("pvBreakerA", "pvPosIn"), "positive", "pv4", { bundleId: "pv-string-a", circuitId: "pv-a-inside" }),
  w("pv-a-negative-outside", ep("panel1", "negative"), ep("servicePenetration", "pvANegOutside"), "negative", "pv4", { bundleId: "pv-string-a", returnFor: "pv-a-positive-outside", circuitId: "pv-a-outside" }),
  w("pv-a-negative-inside", ep("servicePenetration", "pvANegInside"), ep("pvBreakerA", "pvNegIn"), "negative", "pv4", { bundleId: "pv-string-a", returnFor: "pv-a-positive-inside", circuitId: "pv-a-inside" }),
  w("pv-b-positive-outside", ep("panel4", "positive"), ep("servicePenetration", "pvBPosOutside"), "positive", "pv4", { bundleId: "pv-string-b", circuitId: "pv-b-outside" }),
  w("pv-b-positive-inside", ep("servicePenetration", "pvBPosInside"), ep("pvBreakerB", "pvPosIn"), "positive", "pv4", { bundleId: "pv-string-b", circuitId: "pv-b-inside" }),
  w("pv-b-negative-outside", ep("panel3", "negative"), ep("servicePenetration", "pvBNegOutside"), "negative", "pv4", { bundleId: "pv-string-b", returnFor: "pv-b-positive-outside", circuitId: "pv-b-outside" }),
  w("pv-b-negative-inside", ep("servicePenetration", "pvBNegInside"), ep("pvBreakerB", "pvNegIn"), "negative", "pv4", { bundleId: "pv-string-b", returnFor: "pv-b-positive-inside", circuitId: "pv-b-inside" }),
  w("pv-comb-a-b-positive", ep("pvBreakerA", "pvPosOut"), ep("pvCombRails", "positiveBreakerA"), "positive", "pvComb", { circuitId: "pv-comb-a" }),
  w("pv-comb-b-tap-positive", ep("pvBreakerB", "pvPosOut"), ep("pvCombRails", "positiveBreakerB"), "positive", "pvComb", { circuitId: "pv-comb-b" }),
  w("pv-comb-b-spd-positive", ep("pvSpd", "positive"), ep("pvCombRails", "positiveSpd"), "positive", "pvComb", { circuitId: "pv-comb-spd" }),
  w("pv-comb-spd-disconnect-positive", ep("pvDisconnect", "positiveIn"), ep("pvCombRails", "positiveDisconnect"), "positive", "pvComb", { circuitId: "pv-comb-disconnect" }),
  w("pv-comb-a-b-negative", ep("pvBreakerA", "pvNegOut"), ep("pvCombRails", "negativeBreakerA"), "negative", "pvComb", { returnFor: "pv-comb-a-b-positive", circuitId: "pv-comb-a" }),
  w("pv-comb-b-tap-negative", ep("pvBreakerB", "pvNegOut"), ep("pvCombRails", "negativeBreakerB"), "negative", "pvComb", { returnFor: "pv-comb-b-tap-positive", circuitId: "pv-comb-b" }),
  w("pv-comb-b-spd-negative", ep("pvSpd", "negative"), ep("pvCombRails", "negativeSpd"), "negative", "pvComb", { returnFor: "pv-comb-b-spd-positive", circuitId: "pv-comb-spd" }),
  w("pv-comb-spd-disconnect-negative", ep("pvDisconnect", "negativeIn"), ep("pvCombRails", "negativeDisconnect"), "negative", "pvComb", { returnFor: "pv-comb-spd-disconnect-positive", circuitId: "pv-comb-disconnect" }),
  w("pv-output-positive", ep("pvDisconnect", "positiveOut"), ep("smartSolar", "pvPositive"), "positive", "dc6", { bundleId: "pv-mppt", circuitId: "pv-output" }),
  w("pv-output-negative", ep("pvDisconnect", "negativeOut"), ep("smartSolar", "pvNegative"), "negative", "dc6", { bundleId: "pv-mppt", returnFor: "pv-output-positive", circuitId: "pv-output" }),
  w("pv-spd-earth", ep("pvSpd", "earth"), ep("earthBar", "post3"), "earth", "dc10"),
  w("pv-frame-a-daisy", ep("panel1", "frame"), ep("panel2", "frame"), "earth", "pv4"),
  w("pv-frame-a-outside", ep("panel2", "frame"), ep("servicePenetration", "frameAOutside"), "earth", "earth4"),
  w("pv-frame-a-inside", ep("servicePenetration", "frameAInside"), ep("earthBar", "post4"), "earth", "earth4"),
  w("pv-frame-b-daisy", ep("panel3", "frame"), ep("panel4", "frame"), "earth", "pv4"),
  w("pv-frame-b-outside", ep("panel4", "frame"), ep("servicePenetration", "frameBOutside"), "earth", "earth4"),
  w("pv-frame-b-inside", ep("servicePenetration", "frameBInside"), ep("earthBar", "post6"), "earth", "earth4"),

  w("battery-a-series", ep("battery1", "positive"), ep("battery2", "negative"), "positive", "battery53", {
    seriesLink: true, sourceLeadReason: "Unfused battery-string series jumper; keep it shortest-practical, supported, guarded and separated from grounded metal throughout its route.",
  }),
  w("battery-b-series", ep("battery3", "positive"), ep("battery4", "negative"), "positive", "battery53", {
    seriesLink: true, sourceLeadReason: "Unfused battery-string series jumper; keep it shortest-practical, supported, guarded and separated from grounded metal throughout its route.",
  }),
  w("battery-a-positive-breaker", ep("battery2", "positive"), ep("batteryBreakerA", "line"), "positive", "battery53", {
    bundleId: "battery-a", circuitId: "battery-a", sourceLeadReason: "Battery-adjacent lead to the first string overcurrent device; keep it mechanically protected and as short as practicable.",
  }),
  w("battery-a-breaker-bus", ep("batteryBreakerA", "load"), ep("mainPositiveBus", "post1"), "positive", "battery53", {
    sourceLeadReason: "Short guarded common-bus-to-string-breaker link; every other bus source can feed a cable fault, so minimize and protect this segment physically.",
  }),
  w("battery-b-positive-breaker", ep("battery4", "positive"), ep("batteryBreakerB", "line"), "positive", "battery53", {
    bundleId: "battery-b", circuitId: "battery-b", sourceLeadReason: "Battery-adjacent lead to the first string overcurrent device; keep it mechanically protected and as short as practicable.",
  }),
  w("battery-b-breaker-bus", ep("batteryBreakerB", "load"), ep("mainPositiveBus", "post2"), "positive", "battery53", {
    sourceLeadReason: "Short guarded common-bus-to-string-breaker link; every other bus source can feed a cable fault, so minimize and protect this segment physically.",
  }),
  w("battery-a-negative-shunt", ep("battery1", "negative"), ep("smartShunt", "batteryMinus"), "negative", "battery53", {
    bundleId: "battery-a", returnFor: "battery-a-positive-breaker", circuitId: "battery-a",
    sourceLeadReason: "Battery-adjacent unfused return to SmartShunt BATTERY MINUS; route beside the protected positive lead and keep it shortest-practical, guarded and supported.",
  }),
  w("battery-b-negative-shunt", ep("battery3", "negative"), ep("smartShunt", "batteryMinus"), "negative", "battery53", {
    bundleId: "battery-b", returnFor: "battery-b-positive-breaker", circuitId: "battery-b",
    sourceLeadReason: "Battery-adjacent unfused return to SmartShunt BATTERY MINUS; route beside the protected positive lead and keep it shortest-practical, guarded and supported.",
  }),
  w("shunt-negative-bus", ep("smartShunt", "systemMinus"), ep("mainNegativeBus", "post1"), "negative", "battery53", {
    status: "hold",
    holdReason: "Controlled normal demand fits the modeled 120 A envelope: one tool at or below 1,800 W, both high-power USB branches off during tool use, and the Ekrano DVCC charge-current limit at 100 A. The hold remains for fault/OCP coordination and received conductor, lug and termination evidence; do not treat the SmartShunt's 500 A body rating as cable ampacity.",
  }),
  w("shunt-sense", ep("mainPositiveBus", "post4"), ep("smartShunt", "vBattPlus"), "positive", "factory", {
    currentProtection: { kind: "fuse", ratedCurrentA: 1, verified: true, note: "Victron supplies a 1 A fused positive sense lead; carry the exact maker-specified spare." },
  }),
  w("balancer-a-positive", ep("battery2", "positive"), ep("balancerA", "positive"), "positive", "branch1.5", { circuitId: "balancer-a" }),
  w("balancer-a-mid", ep("battery1", "positive"), ep("balancerA", "midpoint"), "positive", "branch1.5"),
  w("balancer-a-negative", ep("battery1", "negative"), ep("balancerA", "negative"), "negative", "branch1.5", { returnFor: "balancer-a-positive", circuitId: "balancer-a" }),
  w("balancer-b-positive", ep("battery4", "positive"), ep("balancerB", "positive"), "positive", "branch1.5", { circuitId: "balancer-b" }),
  w("balancer-b-mid", ep("battery3", "positive"), ep("balancerB", "midpoint"), "positive", "branch1.5"),
  w("balancer-b-negative", ep("battery3", "negative"), ep("balancerB", "negative"), "negative", "branch1.5", { returnFor: "balancer-b-positive", circuitId: "balancer-b" }),

  w("mppt-positive-breaker", ep("smartSolar", "batteryPositive"), ep("mpptBreaker", "load"), "positive", "dc35", {
    bundleId: "mppt-dc", circuitId: "mppt-output", sourceLeadReason: "Short controller-output lead to the battery-side SmartSolar cutoff.",
  }),
  w("mppt-breaker-bus", ep("mpptBreaker", "line"), ep("mainPositiveBus", "post4"), "positive", "dc35", {
    sourceLeadReason: "Short guarded common-bus-to-SmartSolar-breaker link; keep the first-protector segment mechanically protected and as short as practicable.",
  }),
  w("mppt-negative-bus", ep("smartSolar", "batteryNegative"), ep("mainNegativeBus", "post2"), "negative", "dc35", { bundleId: "mppt-dc", returnFor: "mppt-positive-breaker", circuitId: "mppt-output" }),
  w("multiplus-positive", ep("mainPositiveBus", "post3"), ep("multiPlus", "dcPositive"), "positive", "battery53", {
    bundleId: "multiplus-dc", circuitId: "multiplus-dc", status: "hold",
    holdReason: "Genuine design hold: the exact MultiPlus-II 24/3000/70 manual calls for a dedicated 300 A external DC protective device and at least 50 mm² copper for a 0–5 m run. Select a resettable DC breaker with adequate interrupt capacity, coordinate it with the final cable and 250 A bus architecture, and obtain installer approval before energizing.",
  }),
  w("multiplus-negative", ep("mainNegativeBus", "post3"), ep("multiPlus", "dcNegative"), "negative", "battery53", {
    bundleId: "multiplus-dc", returnFor: "multiplus-positive", circuitId: "multiplus-dc", status: "hold",
    holdReason: "Match the final MultiPlus negative conductor to the accepted protected positive branch, manufacturer cable table, supported routing and M8 termination.",
  }),

  w("secondary-feeder-positive", ep("mainPositiveBus", "post4"), ep("secondaryPositiveBus", "post1"), "positive", "battery53", {
    circuitId: "secondary-feeder",
    status: "hold", holdReason: "Field-procure a dedicated red 1/0 AWG feeder. Do not energize until upstream overcurrent coordination accounts for every source on the main bus and an engineer approves the 100 A Blue Sea bus, #10-32 landing or listed transition, lug stacking, conductor ampacity, fault current and local acceptance. No secondary incomer breaker is modeled.",
  }),
  w("secondary-feeder-negative", ep("mainNegativeBus", "post4"), ep("secondaryNegativeBus", "post1"), "negative", "battery53", {
    returnFor: "secondary-feeder-positive", circuitId: "secondary-feeder",
    status: "hold", holdReason: "Field-procure the matching black 1/0 AWG return. Do not energize until an engineer approves the 100 A Blue Sea bus, #10-32 landing or listed transition, ring geometry, torque, enclosure clearance and full feeder protection coordination.",
  }),
  w("service-main", ep("secondaryPositiveBus", "post4"), ep("sharedServicesBreaker", "line"), "positive", "service2.5", {
    sourceLeadReason: "Short enclosed bus-to-breaker tap; final coordination and physical protection remain required.",
  }),
  w("service-split", ep("sharedServicesBreaker", "load"), ep("serviceSplit", "in"), "positive", "branch1.5"),
  w("service-switch-panel", ep("serviceSplit", "switches"), ep("switchPanel", "common"), "positive", "branch1.5"),
  w("service-room-switch", ep("serviceSplit", "room"), ep("roomSwitch", "in"), "positive", "branch1.5"),
  w("room-light-positive", ep("roomSwitch", "out"), ep("indoorLightBreakout", "positive"), "positive", "branch1.5", { circuitId: "room-light" }),
  w("room-light-negative", ep("secondaryNegativeBus", "post5"), ep("indoorLightBreakout", "negative"), "negative", "branch1.5", { returnFor: "room-light-positive", circuitId: "room-light" }),
  w("room-light-cable", ep("indoorLightBreakout", "cable"), ep("indoorLight", "power"), "multicore", "light2"),
  w("outdoor-light-positive", ep("switchPanel", "outdoor"), ep("outdoorLightBreakout", "positive"), "positive", "branch1.5", { circuitId: "outdoor-light" }),
  w("outdoor-light-negative", ep("secondaryNegativeBus", "post5"), ep("outdoorLightBreakout", "negative"), "negative", "branch1.5", { returnFor: "outdoor-light-positive", circuitId: "outdoor-light" }),
  w("outdoor-light-cable-inside", ep("outdoorLightBreakout", "cable"), ep("servicePenetration", "lightInside"), "multicore", "light2"),
  w("outdoor-light-cable-outside", ep("servicePenetration", "lightOutside"), ep("outdoorLight", "power"), "multicore", "light2"),
  w("internet-switch-split", ep("switchPanel", "internet"), ep("internetSplit", "in"), "positive", "branch1.5"),
  w("internet-starlink-positive", ep("internetSplit", "starlink"), ep("starlinkBreakout", "positive"), "positive", "branch1.5", { circuitId: "starlink-input" }),
  w("internet-starlink-negative", ep("secondaryNegativeBus", "post7"), ep("starlinkBreakout", "negative"), "negative", "branch1.5", { returnFor: "internet-starlink-positive", circuitId: "starlink-input" }),
  w("starlink-power-cable-inside", ep("starlinkBreakout", "cable"), ep("servicePenetration", "starlinkPowerInside"), "multicore", "starlinkPower"),
  w("starlink-power-cable-outside", ep("servicePenetration", "starlinkPowerOutside"), ep("starlink", "power"), "multicore", "starlinkPower"),
  w("internet-unifi-positive", ep("internetSplit", "unifi"), ep("unifiPower", "positiveIn"), "positive", "branch1.5", { circuitId: "unifi-input" }),
  w("internet-unifi-negative", ep("secondaryNegativeBus", "post7"), ep("unifiPower", "negativeIn"), "negative", "branch1.5", { returnFor: "internet-unifi-positive", circuitId: "unifi-input" }),
  w("unifi-usb-a-to-c", ep("unifiPower", "usbA"), ep("unifi", "usbC"), "multicore", "usbAToCFactory"),
  w("ekrano-positive", ep("secondaryPositiveBus", "post5"), ep("ekrano", "positive"), "positive", "factory", {
    circuitId: "ekrano-power",
    currentProtection: { kind: "fuse", ratedCurrentA: 3.15, verified: true, note: "Factory 3.15 A slow-blow fused Ekrano supply lead." },
  }),
  w("ekrano-negative", ep("secondaryNegativeBus", "post6"), ep("ekrano", "negative"), "negative", "factory", { returnFor: "ekrano-positive", circuitId: "ekrano-power" }),

  w("orion-breaker-feed", ep("secondaryPositiveBus", "post2"), ep("orionBreaker32", "line"), "positive", "dc10", {
    sourceLeadReason: "Short enclosed bus-to-breaker tap; final coordination and physical protection remain required.",
  }),
  w("orion-input-positive", ep("orionBreaker32", "load"), ep("usbOrion", "positiveIn"), "positive", "dc10", { circuitId: "orion-input" }),
  w("orion-common-ground", ep("secondaryNegativeBus", "post2"), ep("usbOrion", "ground"), "negative", "dc10", { returnFor: "orion-input-positive", circuitId: "orion-input" }),
  w("orion-remote-h", ep("switchPanel", "orionH"), ep("usbOrion", "remoteH"), "control", "sense0.75"),
  w("orion-output-socket-a", ep("usbOrion", "positiveOut"), ep("usbSocketA", "positive"), "positive", "socketHarness12", { circuitId: "orion-output-a" }),
  w("socket-a-b-positive", ep("usbSocketA", "positive"), ep("usbSocketB", "positive"), "positive", "socketHarness12", { circuitId: "socket-a-b" }),
  w("socket-negative-feed", ep("secondaryNegativeBus", "post3"), ep("usbSocketA", "negative"), "negative", "socketHarness12", { returnFor: "orion-output-socket-a", circuitId: "orion-output-a" }),
  w("socket-a-b-negative", ep("usbSocketA", "negative"), ep("usbSocketB", "negative"), "negative", "socketHarness12", { returnFor: "socket-a-b-positive", circuitId: "socket-a-b" }),
  w("socket-a-charger-plug", ep("usbSocketA", "socket"), ep("usb145A", "plug"), "multicore", "socketPlug", {
    currentProtection: { kind: "fuse", ratedCurrentA: 15, verified: false, note: "Verify the retained charger-plug fuse." },
  }),
  w("socket-b-charger-plug", ep("usbSocketB", "socket"), ep("usb145B", "plug"), "multicore", "socketPlug", {
    currentProtection: { kind: "fuse", ratedCurrentA: 15, verified: false, note: "Verify the retained charger-plug fuse." },
  }),
  w("chargeit-breaker-feed", ep("secondaryPositiveBus", "post3"), ep("chargeItBreaker32", "line"), "positive", "branch5.26", {
    sourceLeadReason: "Short enclosed bus-to-breaker tap; final coordination and physical protection remain required.",
  }),
  w("mini-positive-feed", ep("chargeItBreaker32", "load"), ep("usbMiniA", "positive"), "positive", "branch5.26", { circuitId: "mini-feed" }),
  w("mini-a-b-positive", ep("usbMiniA", "positive"), ep("usbMiniB", "positive"), "positive", "branch5.26", { circuitId: "mini-a-b" }),
  w("mini-b-c-positive", ep("usbMiniB", "positive"), ep("usbMiniC", "positive"), "positive", "branch5.26", { circuitId: "mini-b-c" }),
  w("mini-c-d-positive", ep("usbMiniC", "positive"), ep("usbMiniD", "positive"), "positive", "branch5.26", { circuitId: "mini-c-d" }),
  w("mini-negative-feed", ep("secondaryNegativeBus", "post4"), ep("usbMiniA", "negative"), "negative", "branch5.26", { returnFor: "mini-positive-feed", circuitId: "mini-feed" }),
  w("mini-a-b-negative", ep("usbMiniA", "negative"), ep("usbMiniB", "negative"), "negative", "branch5.26", { returnFor: "mini-a-b-positive", circuitId: "mini-a-b" }),
  w("mini-b-c-negative", ep("usbMiniB", "negative"), ep("usbMiniC", "negative"), "negative", "branch5.26", { returnFor: "mini-b-c-positive", circuitId: "mini-b-c" }),
  w("mini-c-d-negative", ep("usbMiniC", "negative"), ep("usbMiniD", "negative"), "negative", "branch5.26", { returnFor: "mini-c-d-positive", circuitId: "mini-c-d" }),

  w("generator-lead-line", ep("generator", "line"), ep("generatorLeadBreakout", "line"), "ac-line", "acCore1.5", {
    bundleId: "generator-lead-cores", circuitId: "generator-ac",
    sourceLeadReason: "Short generator-contact lead into the trailing cable ahead of the held AC-input protective assembly.",
  }),
  w("generator-lead-neutral", ep("generator", "neutral"), ep("generatorLeadBreakout", "neutral"), "ac-neutral", "acCore1.5", {
    bundleId: "generator-lead-cores", returnFor: "generator-lead-line", circuitId: "generator-ac",
    sourceLeadReason: "Short generator-contact lead into the trailing cable ahead of the held AC-input protective assembly.",
  }),
  w("generator-lead-earth", ep("generator", "earth"), ep("generatorLeadBreakout", "earth"), "earth", "acCore1.5", {
    bundleId: "generator-lead-cores",
  }),
  w("generator-white-cable", ep("generatorLeadBreakout", "cable"), ep("servicePenetration", "acOutside"), "multicore", "ac3", {
    sourceLeadReason: "Generator-side lead ahead of the held AC-input protective assembly.",
  }),
  w("generator-cable-inside", ep("servicePenetration", "acInside"), ep("generatorAcBreakout", "cable"), "multicore", "ac3", {
    sourceLeadReason: "Generator-side lead ahead of the held AC-input protective assembly.",
  }),
  w("ac-generator-line", ep("generatorAcBreakout", "line"), ep("acInputProtection", "lineIn"), "ac-line", "acCore1.5", {
    bundleId: "generator-ac-cores", circuitId: "generator-ac", sourceLeadReason: "Final enclosed source lead into the held AC-input protective assembly.",
  }),
  w("ac-generator-neutral", ep("generatorAcBreakout", "neutral"), ep("acInputProtection", "neutralIn"), "ac-neutral", "acCore1.5", { bundleId: "generator-ac-cores", returnFor: "ac-generator-line", circuitId: "generator-ac" }),
  w("ac-generator-earth", ep("generatorAcBreakout", "earth"), ep("acInputProtection", "earth"), "earth", "acCore1.5", { bundleId: "generator-ac-cores" }),
  w("ac-input-line", ep("acInputProtection", "lineOut"), ep("acInputCableBreakout", "line"), "ac-line", "acCore1.5", { bundleId: "ac-input-cable-cores", circuitId: "ac-input" }),
  w("ac-input-neutral", ep("acInputProtection", "neutralOut"), ep("acInputCableBreakout", "neutral"), "ac-neutral", "acCore1.5", { bundleId: "ac-input-cable-cores", returnFor: "ac-input-line", circuitId: "ac-input" }),
  w("ac-input-earth", ep("generatorAcBreakout", "earth"), ep("acInputCableBreakout", "earth"), "earth", "acCore1.5", { bundleId: "ac-input-cable-cores" }),
  w("ac-input-white-cable", ep("acInputCableBreakout", "cable"), ep("multiAcInBreakout", "cable"), "multicore", "ac3"),
  w("multiplus-ac-in-line", ep("multiAcInBreakout", "line"), ep("multiPlus", "acInLine"), "ac-line", "acCore1.5", { bundleId: "multiplus-ac-in-cores", circuitId: "multiplus-ac-input" }),
  w("multiplus-ac-in-neutral", ep("multiAcInBreakout", "neutral"), ep("multiPlus", "acInNeutral"), "ac-neutral", "acCore1.5", { bundleId: "multiplus-ac-in-cores", returnFor: "multiplus-ac-in-line", circuitId: "multiplus-ac-input" }),
  w("multiplus-ac-in-earth", ep("multiAcInBreakout", "earth"), ep("multiPlus", "acInEarth"), "earth", "acCore1.5", { bundleId: "multiplus-ac-in-cores" }),
  w("multiplus-ac-out-line", ep("multiPlus", "acOutLine"), ep("multiAcOutBreakout", "line"), "ac-line", "acCore1.5", {
    bundleId: "multiplus-ac-out-cores", circuitId: "multiplus-ac-output", sourceLeadReason: "MultiPlus output lead ahead of the held AC-output protective assembly.",
  }),
  w("multiplus-ac-out-neutral", ep("multiPlus", "acOutNeutral"), ep("multiAcOutBreakout", "neutral"), "ac-neutral", "acCore1.5", { bundleId: "multiplus-ac-out-cores", returnFor: "multiplus-ac-out-line", circuitId: "multiplus-ac-output" }),
  w("multiplus-ac-out-earth", ep("multiPlus", "acOutEarth"), ep("multiAcOutBreakout", "earth"), "earth", "acCore1.5", { bundleId: "multiplus-ac-out-cores" }),
  w("ac-output-white-cable", ep("multiAcOutBreakout", "cable"), ep("acOutputCableBreakout", "cable"), "multicore", "ac3", {
    sourceLeadReason: "MultiPlus output lead ahead of the held AC-output protective assembly.",
  }),
  w("ac-output-line", ep("acOutputCableBreakout", "line"), ep("acOutputProtection", "lineIn"), "ac-line", "acCore1.5", {
    bundleId: "ac-output-cable-cores", circuitId: "ac-output", sourceLeadReason: "Final enclosed source lead into the held AC-output protective assembly.",
  }),
  w("ac-output-neutral", ep("acOutputCableBreakout", "neutral"), ep("acOutputProtection", "neutralIn"), "ac-neutral", "acCore1.5", { bundleId: "ac-output-cable-cores", returnFor: "ac-output-line", circuitId: "ac-output" }),
  w("ac-output-spd-earth", ep("acOutputCableBreakout", "earth"), ep("acOutputProtection", "earth"), "earth", "acCore1.5"),
  w("ac-socket-line", ep("acOutputProtection", "lineOut"), ep("toolAcBreakout", "line"), "ac-line", "acCore1.5", { bundleId: "tool-ac-cores", circuitId: "tool-ac" }),
  w("ac-socket-neutral", ep("acOutputProtection", "neutralOut"), ep("toolAcBreakout", "neutral"), "ac-neutral", "acCore1.5", { bundleId: "tool-ac-cores", returnFor: "ac-socket-line", circuitId: "tool-ac" }),
  w("ac-socket-earth", ep("acOutputCableBreakout", "earth"), ep("toolAcBreakout", "earth"), "earth", "acCore1.5", { bundleId: "tool-ac-cores" }),
  w("tool-white-cable", ep("toolAcBreakout", "cable"), ep("toolOutletLeadBreakout", "cable"), "multicore", "ac3"),
  w("tool-outlet-line", ep("toolOutletLeadBreakout", "line"), ep("toolOutlet", "line"), "ac-line", "acCore1.5", {
    bundleId: "tool-outlet-cores", circuitId: "tool-ac",
  }),
  w("tool-outlet-neutral", ep("toolOutletLeadBreakout", "neutral"), ep("toolOutlet", "neutral"), "ac-neutral", "acCore1.5", {
    bundleId: "tool-outlet-cores", returnFor: "tool-outlet-line", circuitId: "tool-ac",
  }),
  w("tool-outlet-earth", ep("toolOutletLeadBreakout", "earth"), ep("toolOutlet", "earth"), "earth", "acCore1.5", {
    bundleId: "tool-outlet-cores",
  }),
  w("ac-main-earth", ep("earthBar", "post5"), ep("generatorAcBreakout", "earth"), "earth", "earth4"),
  w("multiplus-chassis-earth", ep("multiPlus", "chassisEarth"), ep("earthBar", "post1"), "earth", "dc16"),
  w("earth-electrode-outside", ep("earthElectrode", "clamp"), ep("servicePenetration", "earthOutside"), "earth", "dc16"),
  w("earth-electrode-inside", ep("servicePenetration", "earthInside"), ep("earthBar", "post2"), "earth", "dc16"),

  w("data-mppt", ep("smartSolar", "veDirect"), ep("ekrano", "veDirectSolar"), "data", "ethernet"),
  w("data-shunt", ep("smartShunt", "veDirect"), ep("ekrano", "veDirectShunt"), "data", "ethernet"),
  w("data-multiplus", ep("multiPlus", "veBus"), ep("ekrano", "veBus"), "data", "ethernet"),
  w("data-starlink-outside", ep("starlink", "ethernet"), ep("servicePenetration", "starlinkDataOutside"), "data", "ethernet"),
  w("data-starlink-inside", ep("servicePenetration", "starlinkDataInside"), ep("unifi", "ethernetStarlink"), "data", "ethernet"),
  w("data-ekrano", ep("ekrano", "ethernet"), ep("unifi", "ethernetEkrano"), "data", "ethernet"),
] as const;

/**
 * A screw, stud or clamp is one physical landing, so it may have exactly one
 * field-installed conductor. Where the electrical design branches at a
 * landing, materialize the splice as its own selectable three-way join rather
 * than drawing two cables into the same terminal. The join is attached to the
 * original terminal and therefore follows layout changes without coordinates
 * or device-ID rendering rules.
 */
function expandSharedPhysicalLandings(
  devices: readonly Device[],
  connections: readonly Connection[],
  cables: readonly Cable[],
) {
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const cableById = new Map(cables.map((cable) => [cable.id, cable]));
  const uses = new Map<string, Array<{ connection: Connection; side: "from" | "to" }>>();
  connections.forEach((connection) => {
    (["from", "to"] as const).forEach((side) => {
      const endpoint = connection[side];
      uses.set(endpoint, [...(uses.get(endpoint) ?? []), { connection, side }]);
    });
  });

  const joinDevices: Device[] = [];
  const physicalLinks: Connection[] = [];
  const replacement = new Map<string, string>();
  const landingForEndpoint = (endpoint: string) => {
    const separator = endpoint.lastIndexOf(".");
    const owner = deviceById.get(endpoint.slice(0, separator));
    return owner?.conductors.find((conductor) => conductor.id === endpoint.slice(separator + 1));
  };
  const sharedLandings = [...uses.entries()].filter(([endpoint, entries]) => (
    entries.length > 1 && !["warning", "approved-stack"].includes(landingForEndpoint(endpoint)?.sharedConnectionPolicy ?? "expand")
  ));

  sharedLandings
    .toSorted(([first], [second]) => first.localeCompare(second))
    .forEach(([physicalEndpoint, entries]) => {
      const separator = physicalEndpoint.lastIndexOf(".");
      const deviceId = physicalEndpoint.slice(0, separator);
      const conductorId = physicalEndpoint.slice(separator + 1);
      const owner = deviceById.get(deviceId);
      const landing = owner?.conductors.find((conductor) => conductor.id === conductorId);
      if (!owner || !landing) throw new Error(`Cannot attach wire join to ${physicalEndpoint}`);

      const ordered = entries.toSorted((first, second) => {
        const firstDiameter = cableById.get(first.connection.cableId)?.outsideDiameterMm ?? 0;
        const secondDiameter = cableById.get(second.connection.cableId)?.outsideDiameterMm ?? 0;
        return secondDiameter - firstDiameter || first.connection.id.localeCompare(second.connection.id);
      });
      const linkCable = ordered[0].connection.cableId;
      const held = ordered.filter(({ connection }) => connection.status === "hold");
      const holdReason = [...new Set(held.map(({ connection }) => connection.holdReason).filter(Boolean))].join(" ");
      const sourceLeadReason = [...new Set(ordered.map(({ connection }) => connection.sourceLeadReason).filter(Boolean))].join(" ");
      let attachmentEndpoint = physicalEndpoint;
      for (let joinIndex = 0; joinIndex < ordered.length - 1; joinIndex += 1) {
        const isLast = joinIndex === ordered.length - 2;
        const joinId = ordered.length === 2
          ? `join-${deviceId}-${conductorId}`
          : `join-${deviceId}-${conductorId}-${joinIndex + 1}`;
        const branchEntry = isLast ? ordered[1] : ordered[ordered.length - 1 - joinIndex];
        const throughEntry = isLast ? ordered[0] : undefined;
        const arm = (
          id: "device" | "through" | "branch",
          face: "left" | "right" | "bottom",
          entry?: { connection: Connection; side: "from" | "to" },
        ) => {
          const kind = entry?.connection.kind ?? landing.kind;
          const cable = entry ? cableById.get(entry.connection.cableId) : cableById.get(linkCable);
          const mates = (["device", "through", "branch"] as const).filter((candidate) => candidate !== id);
          return p(id, id === "device" ? landing.label : `${kind} splice arm`, kind, face, {
            gauge: cable?.conductorSize ?? landing.gauge,
            terminal: "Insulated three-way wire join",
            terminalSize: cable?.conductorSize ?? landing.terminalSize,
            termination: "Approved same-circuit three-way splice",
            terminalDiameterMm: cable?.outsideDiameterMm ?? landing.terminalDiameterMm,
            terminalLengthMm: 4,
            internalMates: mates,
            terminalNote: `Selectable bodyless join attached to ${attachmentEndpoint}; no device terminal receives two field wires.`,
          });
        };
        joinDevices.push({
          id: joinId,
          label: `${owner.label} · ${landing.label} wire join${ordered.length > 2 ? ` ${joinIndex + 1}` : ""}`,
          subtitle: "Explicit 2-in / 1-out field splice",
          kind: "connector",
          presentation: "wire-join",
          attachment: { endpoint: attachmentEndpoint },
          size: [0.040, 0.040, 0.040],
          placement: owner.placement,
          status: held.length > 0 ? "hold" : owner.status,
          holdReason: holdReason || undefined,
          conductors: [arm("device", "left"), arm("through", "right", throughEntry), arm("branch", "bottom", branchEntry)],
        });
        replacement.set(`${branchEntry.connection.id}:${branchEntry.side}`, ep(joinId, "branch"));
        if (throughEntry) replacement.set(`${throughEntry.connection.id}:${throughEntry.side}`, ep(joinId, "through"));
        physicalLinks.push(w(
          `${joinId}-device-link`,
          attachmentEndpoint,
          ep(joinId, "device"),
          landing.kind,
          linkCable,
          {
            topologyRole: "terminal-join",
            ...(held.length > 0 ? { status: "hold" as const, holdReason } : {}),
            ...(sourceLeadReason ? { sourceLeadReason } : {}),
          },
        ));
        attachmentEndpoint = ep(joinId, "through");
      }
    });

  const rewired = connections.map((connection): Connection => ({
    ...connection,
    from: replacement.get(`${connection.id}:from`) ?? connection.from,
    to: replacement.get(`${connection.id}:to`) ?? connection.to,
  }));
  const expandedConnections = [...rewired, ...physicalLinks];
  const finalUses = new Map<string, number>();
  expandedConnections.forEach((connection) => {
    [connection.from, connection.to].forEach((endpoint) => finalUses.set(endpoint, (finalUses.get(endpoint) ?? 0) + 1));
  });
  const repeated = [...finalUses].filter(([endpoint, count]) => (
    count > 1 && !["warning", "approved-stack"].includes(landingForEndpoint(endpoint)?.sharedConnectionPolicy ?? "expand")
  ));
  if (repeated.length > 0) throw new Error(`Shared physical landing remained after expansion: ${repeated[0][0]}`);
  return { devices: [...devices, ...joinDevices], connections: expandedConnections };
}

const expandedTopology = expandSharedPhysicalLandings(dseBaseDevices, dseBaseConnections, dseCables);
export const dseDevices: readonly Device[] = expandedTopology.devices;
export const dseConnections: readonly Connection[] = expandedTopology.connections;
export const dseCurrentSources = currentSourcesFromDevices(dseDevices);

export const dsePowerCircuits: readonly CircuitPowerBudget[] = [
  {
    id: "pv-strings", label: "Two independent 2-panel PV strings", deviceIds: ["panel1", "panel2", "panel3", "panel4", "pvBreakerA", "pvBreakerB"],
    nominalVoltageV: 85.12, maximumWatts: 2260, maximumCurrentA: 13.28, protectionDeviceId: "pvBreakerA", conductorAmpacityA: 20,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "Each home run carries one 13.28 A operating string (14.20 A Isc) on a 20 A-rated 4 mm² path. Each 20 A breaker is below Suntech's 25 A maximum series-fuse rating, but received voltage, polarity and interrupt markings remain unverified.",
  },
  {
    id: "pv-combined", label: "Combined PV comb rails to SmartSolar", deviceIds: ["pvCombRails", "pvSpd", "pvDisconnect", "smartSolar"],
    nominalVoltageV: 85.12, maximumWatts: 2260, maximumCurrentA: 26.56, conductorAmpacityA: 32,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "The prior 20 A/4 mm² combined lead was too small for both strings. The canonical plan now uses a 32 A-rated 6 mm² positive/negative pair; verify the pre-existing rails, disconnect and terminals accept that current and conductor.",
  },
  {
    id: "mppt-battery", label: "SmartSolar battery output", deviceIds: ["smartSolar", "mpptBreaker"],
    nominalVoltageV: 24, maximumWatts: 2448, maximumCurrentA: 85, protectionDeviceId: "mpptBreaker", conductorAmpacityA: 120,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "Victron's exact table pairs 35 mm² battery cable with 100–120 A protection, so the 85 A regulated output and purchased 120 A breaker fit the manufacturer envelope. Confirm the final cable installation/temperature rating and received breaker AIC, terminal and torque evidence; keep the common-bus-to-breaker segment shortest-practical and guarded.",
  },
  {
    id: "multiplus-dc", label: "MultiPlus 24 V DC input/charger branch", deviceIds: ["multiPlus"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 1800, maximumCurrentA: 100.8, conductorAmpacityA: 120,
    normalStatus: "within-capacity", faultStatus: "incomplete",
    note: "The posted one-tool rule caps normal AC load at 1.8 kW. At the conservative 19 V input floor and 94% efficiency, that is about 100.8 A DC (about 79.8 A at 24 V), within the modeled 120 A cable envelope. Tool starting surge is transient, not a continuous 2.4 kW load. The genuine hold remains: Victron requires a dedicated 300 A external DC protector and at least 50 mm² cable, coordinated with the final conductor and buses.",
  },
  {
    id: "secondary-feeder", label: "Main bus to secondary-services enclosure", deviceIds: ["secondaryPositiveBus", "secondaryNegativeBus", "smartSolar", "multiPlus", "usbOrion", "ekrano"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 907, maximumCurrentA: 47.8, conductorAmpacityA: 100,
    normalStatus: "within-capacity", faultStatus: "incomplete",
    note: "Even a conservative simultaneous device-limit budget remains below the 100 A secondary-bus rating. The feeder is still unsafe to commission because it has no source-side OCP and the proposed 1/0-to-#10 terminal transition is unselected.",
  },
  {
    id: "main-negative-trunk", label: "SmartShunt SYSTEM MINUS to main negative bus", deviceIds: ["smartShunt", "mainNegativeBus", "multiPlus", "secondaryNegativeBus", "smartSolar"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 2024, maximumCurrentA: 106.5, conductorAmpacityA: 120,
    normalStatus: "conditional", faultStatus: "incomplete",
    note: "Under the posted operating controls, the 1.8 kW tool draws about 100.8 A at 19 V / 94% efficiency and essential shared services plus Ekrano add about 5.7 A, for a controlled 106.5 A maximum below the modeled 120 A envelope. Available solar reduces net battery discharge but is deliberately not credited, so the tool budget remains valid under cloud; the array's 2,260 W rating is not an added load. This is conditional on ORION REMOTE H being off and the ChargeIT branch breaker being open during heavy tool use; otherwise all installed DC branches at their published maxima could reach about 148.6 A. Ekrano DVCC limits net battery charging through this shunt trunk to 100 A. Fault/OCP coordination and received conductor/termination evidence remain genuine holds.",
  },
  {
    id: "shared-services", label: "Shared lights + Starlink + UniFi services", deviceIds: ["indoorLight", "outdoorLight", "starlink", "unifi", "unifiPower", "switchPanel", "roomSwitch"],
    nominalVoltageV: 24, minimumVoltageV: 20, typicalWatts: 60, maximumWatts: 100, maximumCurrentA: 5, protectionDeviceId: "sharedServicesBreaker", conductorAmpacityA: 10,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "Typical worst case is 60 W (two 5 W lights, 10 W UniFi, 40 W Starlink). The 100 W conservative ceiling uses Starlink's 60 W input rating, the converter's 25 W output claim, both lights and 5 W reserve. A 10 A breaker is appropriate; do not plan on 240 W continuous expansion because low battery voltage, ambient derating and breaker curve reduce usable headroom.",
  },
  {
    id: "orion-input", label: "Orion 24 V input", deviceIds: ["usbOrion", "orionBreaker32"],
    nominalVoltageV: 24, minimumVoltageV: 16, maximumWatts: 489, maximumCurrentA: 30.6, protectionDeviceId: "orionBreaker32", conductorAmpacityA: 50,
    normalStatus: "conditional", faultStatus: "provisional",
    note: "The 32 A breaker and 6–10 mm² route fit the calculated worst published 25 °C output/88% efficiency/16 V input case, but with little trip margin. Victron recommends 30 A protection at 24 V; review the exact breaker curve, hot-enclosure derating and operating setpoint.",
  },
  {
    id: "orion-output", label: "Orion 12 V socket / 145 W charger chain", deviceIds: ["usbOrion", "usbSocketA", "usbSocketB", "usb145A", "usb145B"],
    nominalVoltageV: 12.2, maximumWatts: 360, maximumCurrentA: 30, conductorAmpacityA: 30,
    normalStatus: "conditional", faultStatus: "incomplete",
    note: "Two chargers can consume the Orion's complete 30 A continuous allowance, leaving no conductor headroom. The Orion permits 45 A for 10 seconds and 60 A into a short, so its regulator and charger output protections do not prove the 30 A socket harness can clear a fault; add suitable resettable output protection or replace the harness architecture.",
  },
  {
    id: "chargeit", label: "Four ChargeIT! Mini modules", deviceIds: ["usbMiniA", "usbMiniB", "usbMiniC", "usbMiniD", "chargeItBreaker32"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 312, maximumCurrentA: 16.5, protectionDeviceId: "chargeItBreaker32", conductorAmpacityA: 32,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "Four manufacturer-published 78 W maximum input draws total 312 W, well below the 32 A trunk capacity at the battery's operating voltage. Coolgear documents no internal electrical protection for these modules, so the received branch breaker and every three-way join remain essential.",
  },
  {
    id: "balancers", label: "Battery-balancer leads", deviceIds: ["balancerA", "balancerB"],
    nominalVoltageV: 24, maximumCurrentA: 0.7, conductorAmpacityA: 10,
    normalStatus: "within-capacity", faultStatus: "incomplete",
    note: "Normal balance current is only 0.7 A and 1.5 mm² conductors exceed Victron's 0.75 mm² minimum. The leads still connect directly to high-energy battery points; Victron specifies 10 A near-battery fuses for UL installations, so choose locally accepted resettable protection or obtain installer approval for an alternative.",
  },
  {
    id: "generator-ac", label: "Generator to MultiPlus AC input", deviceIds: ["generator", "acInputProtection", "multiPlus"],
    nominalVoltageV: 230, maximumWatts: 2300, maximumCurrentA: 10, protectionDeviceId: "acInputProtection", conductorAmpacityA: 10,
    normalStatus: "conditional", faultStatus: "provisional",
    note: "The G3200P can supply more than this circuit, so configure the MultiPlus input limit at or below 10 A. The source lead and purchased AC protector remain held until the actual generator outlet breaker, neutral-earth arrangement, RCBO markings, enclosure and local installation are verified.",
  },
  {
    id: "tool-ac", label: "MultiPlus AC output / tool outlet", deviceIds: ["multiPlus", "acOutputProtection", "toolOutlet"],
    nominalVoltageV: 230, maximumWatts: 1800, maximumCurrentA: 7.83, protectionDeviceId: "acOutputProtection", conductorAmpacityA: 10,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "The posted one-tool operating rule limits the connected nameplate to 1.8 kW, or about 7.83 A at 230 V, below the 10 A outlet/lead/RCBO envelope and the inverter's 2.2 kW continuous rating at 40 °C. Motor starting current is a short transient; verify it with the specified 30-minute warm-condition saw test and reject any excessive sag, heating or nuisance trip.",
  },
];

export const dseTopology: SystemGraph = {
  id: "dse-fiji",
  label: "DSE Solar System · Fiji",
  revision: "R29 · researched device power and circuit-level fault classification",
  devices: dseDevices,
  cables: dseCables,
  connections: dseConnections,
  junctions: dseJunctions,
  currentSources: dseCurrentSources,
  powerCircuits: dsePowerCircuits,
};
