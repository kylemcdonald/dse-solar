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
const AIKO_490 = "https://aikosolar.com/static/pdfjs/web/viewer.html?file=%2Fwp-content%2Fuploads%2F2026%2F04%2FNeostar-3P54_193-AIKO-A-MCE54Mw_470-500W-1762%C3%971134%C3%9730_202601_V1.1_EN.pdf";
const VICTRON_GEL_220 = "https://www.victronenergy.com/upload/documents/Datasheet-GEL-and-AGM-Batteries-EN.pdf";
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
      order: 0, gauge: "6 mm² consolidated branch conductor · terminal fit hold",
      terminal: "Removable Phoenix 2-pin screw plug", terminalSize: "Received plug range must be measured",
      termination: "Single or twin bootlace ferrule only after plug approval", terminalDiameterMm: 4,
      terminalNote: "Coolgear identifies a Phoenix 2-pin input but does not publish its conductor range. Verify that the received plug accepts one 6 mm² field lead; otherwise use an approved 6 mm²-to-terminal pigtail transition without trimming strands.",
    }),
    p("negative", "24 V input −", "negative", "bottom", {
      order: 1, gauge: "6 mm² consolidated branch conductor · terminal fit hold",
      terminal: "Removable Phoenix 2-pin screw plug", terminalSize: "Received plug range must be measured",
      termination: "Single or twin bootlace ferrule only after plug approval", terminalDiameterMm: 4,
      terminalNote: "Coolgear identifies a Phoenix 2-pin input but does not publish its conductor range. Verify that the received plug accepts one 6 mm² field lead; otherwise use an approved 6 mm²-to-terminal pigtail transition without trimming strands.",
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

const PANEL_ROTATION = [-Math.PI / 2, -Math.PI / 10, -Math.PI / 2] as const;

const pvStringSource = (id: string, label: string): TerminalCurrentSource => ({
  id,
  label,
  channel: "positive",
  continuousCapacityA: 14.88,
  shortCircuitCurrentA: 14.88,
  inherentCurrentLimit: {
    currentLimitA: 14.88,
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
  continuousCapacityA: 220,
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
  size: [1.762, 1.134, 0.030],
  placement: outside(position, PANEL_ROTATION),
  componentId: id,
  layoutGroup: { id: "pv-panels", label: "PV array", columns: 3, order: layoutOrder },
  bomIds: ["dse-panels"],
  status: "planned",
  power: {
    role: "source", basis: "manufacturer", verified: true, sourceUrl: AIKO_490,
    readings: [
      { label: "Maximum output at STC", watts: 490, voltage: "34.70 Vmp", currentA: 14.13 },
      { label: "Short-circuit current", currentA: 14.88, voltage: "41.10 Voc" },
    ],
    note: "The AIKO-A490-MCE54Mw Neostar 3P54 mono-glass data sheet is the design basis. Confirm the complete received model suffix before installation; AIKO specifies a 25 A maximum series-fuse rating.",
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
      terminalSize: "Original MC4-EVO2A", termination: "Matching listed PV connector",
      terminalDiameterMm: 6, terminalNote: "AIKO specifies 4 mm² / 12 AWG factory leads with original MC4-EVO2A connectors; verify every received connector before mating.",
      ...(currentSource ? { currentSource } : {}),
    }),
    p("negative", "PV −", "negative", "bottom", {
      diagramSide: "output",
      order: 1, gauge: "Factory 4 mm² lead", terminal: "Factory PV connector",
      terminalSize: "Original MC4-EVO2A", termination: "Matching listed PV connector",
      terminalDiameterMm: 6, terminalNote: "AIKO specifies 4 mm² / 12 AWG factory leads with original MC4-EVO2A connectors; verify every received connector before mating.",
    }),
    p("frame", "Frame bond", "earth", "bottom", {
      diagramSide: "output",
      order: 2, gauge: "4 mm² minimum design bond", terminal: "Module grounding hole",
      terminalSize: "Ø4.3 mm designated grounding hole · verify hardware", termination: "Closed ring + listed bonding hardware",
      terminalDiameterMm: 4.3, terminalNote: "Use one of AIKO's designated grounding holes with corrosion-compatible listed hardware; confirm the received frame drawing before selecting the ring.",
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
  size: [0.522, 0.238, 0.240],
  // Both batteries in each string face the same way: the lower battery's + and
  // upper battery's - posts are the two adjacent posts. This makes the series
  // jumper a short local 1/0 lead instead of a long cable between the far ends.
  placement: floor(position, [0, Math.PI, 0]),
  terminalPitchByFaceM: { top: 0.440 },
  componentId,
  layoutGroup: { id: "battery-bank", label: "24 V battery bank", columns: 2, order: layoutOrder },
  bomIds: ["dse-batteries"],
  status: "planned",
  power: {
    role: "storage", basis: "manufacturer", verified: true,
    sourceUrl: VICTRON_GEL_220,
    readings: [{ label: "Nominal stored energy", wattHours: 2640, voltage: "12 V nominal", currentA: 220 }],
    note: "Each BAT412201104 is a nominal 12 V, 220 Ah Victron GEL Deep Cycle battery. Capacity is rated at the 20-hour rate and is not a safe fault-current bound; confirm matched received units and obtain prospective-fault-current evidence for breaker-AIC verification.",
  },
  currentSourceAssemblyPaths: [{
    assemblyId: sourceAssemblyId,
    activeChannel: "positive",
    terminalPair: ["positive", "negative"],
  }],
  conductors: [
    p("positive", "Positive post", "positive", "top", {
      diagramSide: "output",
      order: 0, gauge: "1/0 AWG · 53.5 mm²", terminal: "Victron drilled flat-copper terminal",
      terminalSize: "M8 stud", termination: "1/0 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8,
      terminalNote: "Victron specifies M8 drilled flat-copper terminals; verify the supplied hardware and torque instructions on the received battery.",
      ...(currentSource ? { currentSource } : {}),
    }),
    p("negative", "Negative post", "negative", "top", {
      diagramSide: "output",
      order: 1, gauge: "1/0 AWG · 53.5 mm²", terminal: "Victron drilled flat-copper terminal",
      terminalSize: "M8 stud", termination: "1/0 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8,
      terminalNote: "Victron specifies M8 drilled flat-copper terminals; verify the supplied hardware and torque instructions on the received battery.",
    }),
  ],
});

export const dseCables: readonly Cable[] = [
  { id: "battery53", label: "1/0 AWG battery cable", cores: 1, outsideDiameterMm: 14.5, conductorSize: "53.5 mm²", sheath: "single", ampacityA: 120 },
  { id: "dc35", label: "35 mm² SmartSolar battery cable", cores: 1, outsideDiameterMm: 11.8, conductorSize: "35 mm²", sheath: "single", ampacityA: 120, notes: "Victron's exact SmartSolar 150/85 installation table pairs 35 mm² battery cable with 100–120 A protection. This 120 A coordination envelope remains conditional on received cable insulation, route length, bundling and temperature correction." },
  { id: "dc16", label: "16 mm² DC cable", cores: 1, outsideDiameterMm: 8.6, conductorSize: "16 mm²", sheath: "single", ampacityA: 75 },
  { id: "dc6", label: "6 mm² protected DC branch cable", cores: 1, outsideDiameterMm: 6.8, conductorSize: "6 mm²", sheath: "single", ampacityA: 32, notes: "Common consolidated size for the two 32 A USB supply branches. Verify hot-enclosure ampacity, breaker curve and every received terminal before commissioning." },
  { id: "pv4", label: "4 mm² PV / service cable", cores: 1, outsideDiameterMm: 6.1, conductorSize: "4 mm²", sheath: "single", ampacityA: 20, notes: "The single AIKO 3S string carries 14.13 A at maximum power and 14.88 A short-circuit current. Use PV-rated insulation outdoors and installation-appropriate insulation for enclosed service conductors." },
  { id: "branch1.5", label: "1.5 mm² branch conductor", cores: 1, outsideDiameterMm: 3.4, conductorSize: "1.5 mm²", sheath: "single", ampacityA: 10 },
  { id: "ac3", label: "3-core 10 A AC cable", cores: 3, outsideDiameterMm: 9.8, conductorSize: "3 × 1.5 mm²", sheath: "white", ampacityA: 10, carriedChannels: ["ac-line", "ac-neutral", "earth"] },
  { id: "acCore1.5", label: "Exposed 1.5 mm² AC core", cores: 1, outsideDiameterMm: 3.4, conductorSize: "1.5 mm²", sheath: "single", ampacityA: 10 },
  { id: "earth4", label: "4 mm² protective-earth conductor", cores: 1, outsideDiameterMm: 5.0, conductorSize: "4 mm²", sheath: "single" },
  { id: "light2", label: "2-core lighting cable", cores: 2, outsideDiameterMm: 6.4, conductorSize: "2 × 1.5 mm²", sheath: "white", ampacityA: 10, carriedChannels: ["positive", "negative"] },
  { id: "starlinkPower", label: "Starlink Mini two-core factory power cable", cores: 2, outsideDiameterMm: 6.0, conductorSize: "Factory multicore lead", sheath: "white", ampacityA: 10, carriedChannels: ["positive", "negative"] },
  { id: "usbAToCFactory", label: "Factory USB-A-to-USB-C power cable", cores: 2, outsideDiameterMm: 4.0, conductorSize: "Factory multicore lead", sheath: "white", ampacityA: 5, carriedChannels: ["positive", "negative"] },
  { id: "socketHarness12", label: "YCIND socket 12 AWG duplex harness", cores: 1, outsideDiameterMm: 4.8, conductorSize: "12 AWG · 3.31 mm²", sheath: "single", ampacityA: 30 },
  { id: "socketPlug", label: "Factory cigarette plug / socket connection", cores: 2, outsideDiameterMm: 8.0, conductorSize: "Factory two-core plug assembly", sheath: "white", ampacityA: 15, carriedChannels: ["positive", "negative"] },
  { id: "ethernet", label: "Ethernet / Victron data cable", cores: 1, outsideDiameterMm: 6.0, conductorSize: "Data", sheath: "single" },
  { id: "factory", label: "Factory device lead", cores: 1, outsideDiameterMm: 4.0, conductorSize: "Factory lead", sheath: "single", ampacityA: 5 },
];

const dseBaseDevices: readonly Device[] = [
  // Three Neostar modules form one electrical series string. The 2 + 1 physical
  // arrangement leaves routing cells around every frame so the factory leads
  // and frame bonds clear neighbouring modules without hand-routed exceptions.
  panel("panel1", "AIKO panel 1 · 3S string", [-2.14, 0.38, -1.18], 0, "pv-string"),
  panel("panel2", "AIKO panel 2 · 3S string", [-0.96, 0.75, -1.18], 1, "pv-string"),
  panel("panel3", "AIKO panel 3 · 3S string", [-2.14, 0.38, 1.18], 2, "pv-string",
    pvStringSource("pv-string-source", "AIKO 3S PV string")),

  {
    id: "pvJunction", label: "Single-string PV cutoff junction box", kind: "junction",
    size: [0.32, 0.28, 0.15], placement: wall([0.38, 0.74, 0.08]), componentId: "pvSafety",
    bomIds: ["dse-pv-protection", "dse-pv-string-breakers"], status: "planned", conductors: [],
  },
  {
    id: "pvCutoff", label: "3S array cutoff · 20 A · two-pole", kind: "breaker", poles: 2,
    size: [0.040, 0.082, 0.070], placement: inside("pvJunction", "din", 0), componentId: "pvSafety",
    bomIds: ["dse-pv-string-breakers"], purchaseUrl: "https://www.amazon.com/dp/B0D4JR95Y4", status: "purchased",
    currentProtection: { kind: "breaker", ratedCurrentA: 20, verified: false, terminalPairs: [["positiveIn", "positiveOut"]] }, conductors: [
      p("positiveIn", "3S array + in", "positive", "bottom", {
        order: 0, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
        terminalNote: "Verify at least 150 VDC operating voltage, the received 20 A marking, polarity diagram, interrupt rating, torque and common-trip operation before commissioning.",
      }),
      p("negativeIn", "3S array − in", "negative", "bottom", {
        order: 1, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
      p("positiveOut", "Protected PV + out", "positive", "top", {
        order: 0, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
      p("negativeOut", "Switched PV − out", "negative", "top", {
        order: 1, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
    ],
  },
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
      note: "The 1.47 kW AIKO array is within the controller's published 2.4 kW nominal-PV limit at 24 V. The array normally limits charge power to roughly 60 A near 24 V, but the controller and battery circuit retain their full 85 A / 35 mm² manufacturer envelope.",
      internalProtection: { verified: true, features: ["PV reverse-polarity", "output short-circuit", "over-temperature"] },
    },
    conductors: [
      p("pvPositive", "PV +", "positive", "bottom", { order: 0, diagramSide: "input", gauge: "4 mm² single-string PV lead", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded copper; ferrule only if Victron accepts the selected size", terminalDiameterMm: 8 }),
      p("pvNegative", "PV −", "negative", "bottom", { order: 1, diagramSide: "input", gauge: "4 mm² single-string PV lead", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded copper; ferrule only if Victron accepts the selected size", terminalDiameterMm: 8 }),
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
    id: "secondaryJunction", label: "Secondary 24 V services junction box · larger enclosure required", kind: "junction", size: [0.60, 0.64, 0.24],
    placement: wall([2.56, 0.88, 0.12]), componentId: "secondaryDistribution",
    bomIds: ["dse-secondary-enclosure-larger", "dse-pg11-cable-glands", "dse-din-rail-pack"], status: "hold", conductors: [],
    holdReason: "The purchased 302 × 302 × 178 mm shell cannot keep both secondary busbars, the six-gang panel and the UniFi converter on one rear mounting plane with unobstructed front-projection routing. Select and mock up the larger enclosure represented by this planar routed envelope before installation.",
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
    placement: inside("secondaryJunction", "backplate", 4), componentId: "switchedSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("in", "10 A feed", "positive", "left"), p("switches", "Six-gang feed", "positive", "right", { order: 0 }), p("room", "Room-switch feed", "positive", "right", { order: 1 }),
    ],
  },
  {
    id: "internetSplit", label: "Starlink / UniFi positive split", kind: "connector", presentation: "service-splice", diagramPresentation: "join", size: [0.040, 0.024, 0.030],
    placement: inside("secondaryJunction", "backplate", 3), componentId: "internetSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("in", "Switched feed", "positive", "left"), p("starlink", "Starlink +", "positive", "right", { order: 0 }), p("unifi", "UniFi converter +", "positive", "right", { order: 1 }),
    ],
  },
  {
    id: "unifiPower", label: "UniFi 24 V to 5 V USB-A converter", kind: "converter", size: [0.075, 0.040, 0.025],
    placement: inside("secondaryJunction", "backplate", 0), componentId: "unifiPower", bomIds: ["dse-unifi-converter", "dse-unifi-usb-cable"], status: "purchased",
    power: {
      role: "converter", basis: "retailer", verified: false, sourceUrl: "https://www.amazon.com/dp/B0G1W6JTX8",
      readings: [{ label: "Claimed maximum 5 V output", watts: 25, voltage: "5 V", currentA: 5 }],
      note: "The UniFi Express itself is limited to 10 W. Bench-test converter temperature, efficiency and repeated cold starts; no reliable maker data sheet was found.",
      internalProtection: { verified: false, features: ["Over-current", "short-circuit", "over-temperature", "over/under-voltage"], note: "Retail-listing claims only; not credited as verified field-wire protection." },
    },
    conductors: [
      p("positiveIn", "24 V + in", "positive", "bottom", { order: 0 }), p("negativeIn", "24 V − in", "negative", "bottom", { order: 1 }),
      p("usbA", "USB-A power out", "multicore", "bottom", { order: 2,
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
    placement: inside("secondaryJunction", "backplate", 5), componentId: "internetSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("positive", "Starlink + core", "positive", "top", { order: 0, gauge: "Factory lead", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["cable"] }),
      p("negative", "Starlink − core", "negative", "top", { order: 1, gauge: "Factory lead", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["cable"] }),
      p("cable", "Starlink factory power cable", "multicore", "bottom", { terminal: "Factory two-core cable", terminalSize: "Complete Starlink Mini power lead", termination: "Strain relief / factory connector", terminalDiameterMm: 6, internalMates: ["positive", "negative"] }),
    ],
  },
  twoCoreBreakout("outdoorLightBreakout", "Outdoor-light two-core breakout", inside("secondaryJunction", "backplate", 6)),
  {
    id: "switchPanel", label: "Six-gang service switch panel", subtitle: "1 Internet · 2 outdoor light · 3 Orion H · 4–6 spare", kind: "switch",
    size: [0.19, 0.085, 0.045], placement: inside("secondaryJunction", "backplate", 0), terminalPitchByFaceM: { bottom: 0.040 },
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
      p("acInEarth", "AC input PE", "earth", "bottom", {
        order: 4, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG",
        termination: "Green/yellow fine-stranded copper", terminalDiameterMm: 6,
        internalMates: ["acOutEarth", "chassisEarth"],
        terminalNote: "Victron connection overview H identifies one internal earth busbar shared by AC input PE, AC output PE and the M6 chassis-earth connection.",
      }),
      p("acOutLine", "AC output L", "ac-line", "bottom", {
        order: 5, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6,
        currentSource: {
          id: "multiplus-ac-output-source", label: "MultiPlus AC output", channel: "ac-line",
          continuousCapacityA: 13, shortCircuitCurrentA: "unbounded", verified: false, basis: "regulated-output",
          note: "The downstream 10 A RCBO is modeled; confirm the inverter short-circuit envelope and source-lead coordination.",
        },
      }),
      p("acOutNeutral", "AC output N", "ac-neutral", "bottom", { order: 6, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6 }),
      p("acOutEarth", "AC output PE", "earth", "bottom", {
        order: 7, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG",
        termination: "Green/yellow fine-stranded copper", terminalDiameterMm: 6,
        internalMates: ["acInEarth", "chassisEarth"],
        terminalNote: "Internally common with AC input PE and the M6 chassis-earth connection on the MultiPlus earth busbar.",
      }),
      p("chassisEarth", "Chassis PE", "earth", "bottom", {
        order: 8, gauge: "16 mm²", terminal: "Primary chassis-earth bolt", terminalSize: "M6",
        termination: "16 mm² tinned-copper M6 closed lug", terminalDiameterMm: 6,
        internalMates: ["acInEarth", "acOutEarth"],
        terminalNote: "Internally common with both AC protective-earth terminals on the MultiPlus earth busbar.",
      }),
      p("veBus", "VE.Bus", "data", "bottom", { order: 9, terminal: "RJ45 VE.Bus receptacle", terminalSize: "8P8C / RJ45", termination: "Factory Victron RJ45 cable", terminalDiameterMm: 9 }),
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
      p("pvPosOutside", "PV 3S string + · outside", "positive", "back", { order: 2, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvPosInside"] }),
      p("pvNegOutside", "PV 3S string − · outside", "negative", "back", { order: 3, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvNegInside"] }),
      p("frameOutside", "PV frame bond · outside", "earth", "back", { order: 4, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² bond-conductor gland", termination: "Continuous insulated copper bond", terminalDiameterMm: 5, internalMates: ["frameInside"] }),
      p("lightOutside", "Outdoor-light cable · outside", "multicore", "back", { order: 5, gauge: "2 × 1.5 mm²", terminal: "Sealed wall penetration", terminalSize: "Two-core cable gland", termination: "Strain-relieved white cable", terminalDiameterMm: 6.4, internalMates: ["lightInside"] }),
      p("starlinkPowerOutside", "Starlink power · outside", "multicore", "back", { order: 6, gauge: "Factory lead", terminal: "Sealed wall penetration", terminalSize: "Starlink power-cable gland", termination: "Strain-relieved factory cable", terminalDiameterMm: 6, internalMates: ["starlinkPowerInside"] }),
      p("starlinkDataOutside", "Starlink Ethernet · outside", "data", "back", { order: 7, gauge: "Outdoor Ethernet", terminal: "Sealed wall penetration", terminalSize: "Ethernet cable gland", termination: "Outdoor-rated continuous data cable", terminalDiameterMm: 6, internalMates: ["starlinkDataInside"] }),
      p("acInside", "Generator cable · inside", "multicore", "front", { order: 0, terminal: "Sealed wall penetration", terminalSize: "3-core cable gland", termination: "Strain-relieved white cable", terminalDiameterMm: 9.8, internalMates: ["acOutside"] }),
      p("earthInside", "Electrode bond · inside", "earth", "front", { order: 1, gauge: "16 mm²", terminal: "Sealed wall penetration", terminalSize: "16 mm² conductor gland", termination: "Continuous insulated earth conductor", terminalDiameterMm: 8.6, internalMates: ["earthOutside"] }),
      p("pvPosInside", "PV 3S string + · inside", "positive", "front", { order: 2, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvPosOutside"] }),
      p("pvNegInside", "PV 3S string − · inside", "negative", "front", { order: 3, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² PV conductor gland", termination: "Continuous PV conductor", terminalDiameterMm: 6.1, internalMates: ["pvNegOutside"] }),
      p("frameInside", "PV frame bond · inside", "earth", "front", { order: 4, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² bond-conductor gland", termination: "Continuous insulated copper bond", terminalDiameterMm: 5, internalMates: ["frameOutside"] }),
      p("lightInside", "Outdoor-light cable · inside", "multicore", "front", { order: 5, gauge: "2 × 1.5 mm²", terminal: "Sealed wall penetration", terminalSize: "Two-core cable gland", termination: "Strain-relieved white cable", terminalDiameterMm: 6.4, internalMates: ["lightOutside"] }),
      p("starlinkPowerInside", "Starlink power · inside", "multicore", "front", { order: 6, gauge: "Factory lead", terminal: "Sealed wall penetration", terminalSize: "Starlink power-cable gland", termination: "Strain-relieved factory cable", terminalDiameterMm: 6, internalMates: ["starlinkPowerOutside"] }),
      p("starlinkDataInside", "Starlink Ethernet · inside", "data", "front", { order: 7, gauge: "Outdoor Ethernet", terminal: "Sealed wall penetration", terminalSize: "Ethernet cable gland", termination: "Outdoor-rated continuous data cable", terminalDiameterMm: 6, internalMates: ["starlinkDataOutside"] }),
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
        { label: "Posted one-tool operating limit", watts: 1200, voltage: "230 VAC", currentA: 5.22 },
        { label: "10 A outlet hardware ceiling", watts: 2300, voltage: "230 VAC", currentA: 10 },
      ],
      note: "The 2.3 kW figure is only the outlet/nameplate ceiling. The revised operating profile is one corded tool at a time with a nameplate at or below 1.2 kW; motor starting current is transient and must pass the warm-condition commissioning test without nuisance trips or excessive voltage sag.",
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
    id: "usbOrion", label: "Victron Orion-Tr Smart 24/12-30", kind: "converter", size: [0.130, 0.186, 0.055], placement: wall([3.00, 0.66, 0.028]),
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
      p("remoteH", "Remote H", "control", "bottom", { order: 0, gauge: "1.5 mm²", terminal: "Orion remote H screw clamp", terminalSize: "Verify received remote connector", termination: "1.5 mm² bootlace ferrule if accepted", terminalDiameterMm: 4, terminalNote: "The six-gang switch applies positive to H; L remains unused. Confirm the received removable connector accepts the consolidated 1.5 mm² control conductor." }),
      p("positiveIn", "+ input · 24 V", "positive", "bottom", { order: 1, gauge: "6 mm²", terminal: "Orion power screw clamp", terminalSize: "Fine-stranded copper terminal", termination: "Bare fine-stranded copper; ferrule is not required by Victron", terminalDiameterMm: 7, terminalNote: "Victron's 24 V table recommends 6 mm² for a 1–2 m run; terminal torque is 1.6 N·m." }),
      p("ground", "Common ground / −", "negative", "bottom", { order: 2, gauge: "6 mm²", terminal: "Orion common-negative screw clamp", terminalSize: "Fine-stranded copper terminal", termination: "Bare fine-stranded copper; ferrule is not required by Victron", terminalDiameterMm: 7, terminalNote: "This single common negative is shared by input and output in the non-isolated model; Victron's 1–2 m table uses 6 mm² and specifies 1.6 N·m terminal torque." }),
      p("positiveOut", "+ output · 12 V", "positive", "bottom", {
        order: 3, gauge: "6 mm²", terminal: "Orion output screw clamp", terminalSize: "Fine-stranded copper terminal", termination: "Bare fine-stranded copper; ferrule is not required by Victron", terminalDiameterMm: 7,
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
    id: "usbSocketA", label: "12 V cigarette-lighter socket A", kind: "connector", size: [0.052, 0.072, 0.048], placement: wall([3.18, 0.82, 0.024]),
    componentId: "usb", bomIds: ["dse-usb-sockets"], status: "purchased", conductors: [
      p("positive", "Rear centre-positive lead", "positive", "bottom", { order: 0, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory red pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8, terminalNote: "This terminal carries the downstream socket as well as socket A; retain any integral protection and obtain installer approval." }),
      p("negative", "Rear shell-negative lead", "negative", "bottom", { order: 1, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory black pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("socket", "12 V accessory receptacle", "multicore", "front", { terminal: "SAE J563-style accessory socket", terminalSize: "Centre positive / shell negative", termination: "Mating Coolgear cigarette plug", terminalDiameterMm: 21, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
    ],
  },
  {
    id: "usb145A", label: "Coolgear 145 W charger A", kind: "load", size: [0.052, 0.040, 0.092], placement: wall([3.18, 0.82, 0.100]),
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
  twoCoreBreakout("indoorLightBreakout", "Indoor-light two-core breakout", wall([3.18, 0.42, 0.018])),
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
  { id: "secondary", deviceId: "secondaryJunction", label: "Secondary 24 V services junction", minimumSize: [0.60, 0.64, 0.24], padding: 0.010, dinGap: 0.020, backplateGap: 0.020, glandSpacing: 0.040, sizePolicy: "auto", dinPosition: "bottom", powerBandFractionFromBottom: 1 / 3, backplatePosition: "top" },
  { id: "pv", deviceId: "pvJunction", label: "Single-string PV cutoff", minimumSize: [0.32, 0.28, 0.15], padding: 0.020, dinGap: 0, backplateGap: 0.020, glandSpacing: 0.040, sizePolicy: "verified-fixed" },
  { id: "ac", deviceId: "acJunction", label: "AC junction", minimumSize: [0.36, 0.44, 0.12], padding: 0.020, dinGap: 0, backplateGap: 0, glandSpacing: 0.040 },
];

const dseBaseConnections: readonly Connection[] = [
  w("pv-series-1-2", ep("panel1", "positive"), ep("panel2", "negative"), "positive", "pv4", { seriesLink: true }),
  w("pv-series-2-3", ep("panel2", "positive"), ep("panel3", "negative"), "positive", "pv4", { seriesLink: true }),
  w("pv-positive-outside", ep("panel3", "positive"), ep("servicePenetration", "pvPosOutside"), "positive", "pv4", { bundleId: "pv-string", circuitId: "pv-outside" }),
  w("pv-positive-inside", ep("servicePenetration", "pvPosInside"), ep("pvCutoff", "positiveIn"), "positive", "pv4", { bundleId: "pv-string", circuitId: "pv-inside" }),
  w("pv-negative-outside", ep("panel1", "negative"), ep("servicePenetration", "pvNegOutside"), "negative", "pv4", { bundleId: "pv-string", returnFor: "pv-positive-outside", circuitId: "pv-outside" }),
  w("pv-negative-inside", ep("servicePenetration", "pvNegInside"), ep("pvCutoff", "negativeIn"), "negative", "pv4", { bundleId: "pv-string", returnFor: "pv-positive-inside", circuitId: "pv-inside" }),
  w("pv-output-positive", ep("pvCutoff", "positiveOut"), ep("smartSolar", "pvPositive"), "positive", "pv4", { bundleId: "pv-mppt", circuitId: "pv-output" }),
  w("pv-output-negative", ep("pvCutoff", "negativeOut"), ep("smartSolar", "pvNegative"), "negative", "pv4", { bundleId: "pv-mppt", returnFor: "pv-output-positive", circuitId: "pv-output" }),
  w("pv-frame-1-2", ep("panel1", "frame"), ep("panel2", "frame"), "earth", "earth4"),
  w("pv-frame-2-3", ep("panel2", "frame"), ep("panel3", "frame"), "earth", "earth4"),
  w("pv-frame-outside", ep("panel3", "frame"), ep("servicePenetration", "frameOutside"), "earth", "earth4"),
  w("pv-frame-inside", ep("servicePenetration", "frameInside"), ep("earthBar", "post4"), "earth", "earth4"),

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
    holdReason: "Controlled normal demand fits the modeled 120 A envelope: one tool at or below 1,200 W, both high-power USB branches off during tool use, and the Ekrano DVCC charge-current limit at 88 A for the 440 Ah GEL bank. The hold remains for fault/OCP coordination and received conductor, lug and termination evidence; do not treat the SmartShunt's 500 A body rating as cable ampacity.",
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
  w("service-main", ep("secondaryPositiveBus", "post4"), ep("sharedServicesBreaker", "line"), "positive", "pv4", {
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

  w("orion-breaker-feed", ep("secondaryPositiveBus", "post2"), ep("orionBreaker32", "line"), "positive", "dc6", {
    sourceLeadReason: "Short enclosed bus-to-breaker tap; final coordination and physical protection remain required.",
  }),
  w("orion-input-positive", ep("orionBreaker32", "load"), ep("usbOrion", "positiveIn"), "positive", "dc6", { circuitId: "orion-input" }),
  w("orion-common-ground", ep("secondaryNegativeBus", "post2"), ep("usbOrion", "ground"), "negative", "dc6", { returnFor: "orion-input-positive", circuitId: "orion-input" }),
  w("orion-remote-h", ep("switchPanel", "orionH"), ep("usbOrion", "remoteH"), "control", "branch1.5"),
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
  w("chargeit-breaker-feed", ep("secondaryPositiveBus", "post3"), ep("chargeItBreaker32", "line"), "positive", "dc6", {
    sourceLeadReason: "Short enclosed bus-to-breaker tap; final coordination and physical protection remain required.",
  }),
  w("mini-positive-feed", ep("chargeItBreaker32", "load"), ep("usbMiniA", "positive"), "positive", "dc6", { circuitId: "mini-feed" }),
  w("mini-a-b-positive", ep("usbMiniA", "positive"), ep("usbMiniB", "positive"), "positive", "dc6", { circuitId: "mini-a-b" }),
  w("mini-b-c-positive", ep("usbMiniB", "positive"), ep("usbMiniC", "positive"), "positive", "dc6", { circuitId: "mini-b-c" }),
  w("mini-c-d-positive", ep("usbMiniC", "positive"), ep("usbMiniD", "positive"), "positive", "dc6", { circuitId: "mini-c-d" }),
  w("mini-negative-feed", ep("secondaryNegativeBus", "post4"), ep("usbMiniA", "negative"), "negative", "dc6", { returnFor: "mini-positive-feed", circuitId: "mini-feed" }),
  w("mini-a-b-negative", ep("usbMiniA", "negative"), ep("usbMiniB", "negative"), "negative", "dc6", { returnFor: "mini-a-b-positive", circuitId: "mini-a-b" }),
  w("mini-b-c-negative", ep("usbMiniB", "negative"), ep("usbMiniC", "negative"), "negative", "dc6", { returnFor: "mini-b-c-positive", circuitId: "mini-b-c" }),
  w("mini-c-d-negative", ep("usbMiniC", "negative"), ep("usbMiniD", "negative"), "negative", "dc6", { returnFor: "mini-c-d-positive", circuitId: "mini-c-d" }),

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
  w("ac-earth-continuity", ep("generatorAcBreakout", "earth"), ep("acOutputCableBreakout", "earth"), "earth", "acCore1.5", {
    label: "Unswitched AC-in / AC-out protective-earth continuity",
  }),
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
          diagramJoinGeometry: landing.kind === "earth" ? "orthogonal-t" : "y",
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
    id: "pv-array", label: "Three-panel AIKO series string", deviceIds: ["panel1", "panel2", "panel3", "pvCutoff", "smartSolar"],
    nominalVoltageV: 104.1, maximumWatts: 1470, maximumCurrentA: 14.13, protectionDeviceId: "pvCutoff", conductorAmpacityA: 20,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "The one 3S string carries 14.13 A Imp / 14.88 A Isc on one 20 A-rated 4 mm² pair from the array through the two-pole cutoff to the SmartSolar. Array Vmp is 104.1 V, Voc is 123.3 V at 25 °C and the 10 °C cold estimate is 127.37 V, below the SmartSolar's 145 V operating / 150 V absolute limits. The 20 A breaker remains below AIKO's 25 A maximum series-fuse rating; verify received DC voltage, polarity, interrupt and local-acceptance markings.",
  },
  {
    id: "mppt-battery", label: "SmartSolar battery output", deviceIds: ["smartSolar", "mpptBreaker"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 1470, maximumCurrentA: 75.8, protectionDeviceId: "mpptBreaker", conductorAmpacityA: 120,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "At the deliberately conservative 19 V floor, 1.47 kW at 98% conversion is about 75.8 A; around nominal battery voltage the array is roughly a 60 A source. The cable remains 35 mm² because Victron's 150/85 table pairs that terminal size with 100–120 A battery-side protection and the battery can backfeed a cable fault. Confirm installation/temperature ampacity and received breaker AIC, terminal and torque evidence.",
  },
  {
    id: "multiplus-dc", label: "MultiPlus 24 V DC input/charger branch", deviceIds: ["multiPlus"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 1200, maximumCurrentA: 67.2, conductorAmpacityA: 120,
    normalStatus: "within-capacity", faultStatus: "incomplete",
    note: "The revised one-tool rule caps normal AC load at 1.2 kW. At the conservative 19 V input floor and 94% efficiency, that is about 67.2 A DC (about 53.2 A at 24 V). The cable stays 1/0 AWG because Victron still requires a dedicated 300 A external DC protector and at least 50 mm² copper for this model's 0–5 m battery run; that protection/bus coordination remains a genuine hold.",
  },
  {
    id: "secondary-feeder", label: "Main bus to secondary-services enclosure", deviceIds: ["secondaryPositiveBus", "secondaryNegativeBus", "smartSolar", "multiPlus", "usbOrion", "ekrano"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 907, maximumCurrentA: 47.8, conductorAmpacityA: 100,
    normalStatus: "within-capacity", faultStatus: "incomplete",
    note: "Even a conservative simultaneous device-limit budget remains below the 100 A secondary-bus rating. The feeder is still unsafe to commission because it has no source-side OCP and the proposed 1/0-to-#10 terminal transition is unselected.",
  },
  {
    id: "main-negative-trunk", label: "SmartShunt SYSTEM MINUS to main negative bus", deviceIds: ["smartShunt", "mainNegativeBus", "multiPlus", "secondaryNegativeBus", "smartSolar"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 1385, maximumCurrentA: 72.9, conductorAmpacityA: 120,
    normalStatus: "conditional", faultStatus: "incomplete",
    note: "Under the posted controls, the 1.2 kW tool draws about 67.2 A at 19 V / 94% efficiency and essential shared services plus Ekrano add about 5.7 A, for a controlled 72.9 A maximum below the 120 A 1/0 envelope. Solar is not credited to this discharge limit. This remains conditional on ORION REMOTE H being off and the ChargeIT branch breaker being open during tool use; every installed DC branch at published maximum with the tool could reach about 115.0 A. Ekrano DVCC limits net battery charging to 88 A, the preferred 0.2 C ceiling for the 440 Ah bank. Fault/OCP and received termination evidence remain genuine holds.",
  },
  {
    id: "shared-services", label: "Shared lights + Starlink + UniFi services", deviceIds: ["indoorLight", "outdoorLight", "starlink", "unifi", "unifiPower", "switchPanel", "roomSwitch"],
    nominalVoltageV: 24, minimumVoltageV: 20, typicalWatts: 60, maximumWatts: 100, maximumCurrentA: 5, protectionDeviceId: "sharedServicesBreaker", conductorAmpacityA: 10,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "Typical worst case is 60 W (two 5 W lights, 10 W UniFi, 40 W Starlink). The 100 W conservative ceiling uses Starlink's 60 W input rating, the converter's 25 W output claim, both lights and 5 W reserve. A 10 A breaker is appropriate; do not plan on 240 W continuous expansion because low battery voltage, ambient derating and breaker curve reduce usable headroom.",
  },
  {
    id: "orion-input", label: "Orion 24 V input", deviceIds: ["usbOrion", "orionBreaker32"],
    nominalVoltageV: 24, minimumVoltageV: 16, maximumWatts: 489, maximumCurrentA: 30.6, protectionDeviceId: "orionBreaker32", conductorAmpacityA: 32,
    normalStatus: "conditional", faultStatus: "provisional",
    note: "The consolidated 6 mm² route follows Victron's 1–2 m recommendation and the purchased 32 A breaker fits the calculated worst published 25 °C output/88% efficiency/16 V input case, but with little thermal or trip margin. Review the exact breaker curve, hot-enclosure derating and operating setpoint.",
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
    nominalVoltageV: 230, maximumWatts: 1200, maximumCurrentA: 5.22, protectionDeviceId: "acOutputProtection", conductorAmpacityA: 10,
    normalStatus: "within-capacity", faultStatus: "provisional",
    note: "The posted one-tool operating rule limits the connected nameplate to 1.2 kW, or about 5.22 A at 230 V, below the 10 A outlet/lead/RCBO envelope and the inverter's 2.2 kW continuous rating at 40 °C. Motor starting current is a short transient; verify it with the specified warm-condition test and reject excessive sag, heating or nuisance trip.",
  },
];

export const dseTopology: SystemGraph = {
  id: "dse-fiji",
  label: "DSE Solar System · Fiji",
  revision: "R30 · 3S AIKO array, 440 Ah Victron GEL bank and consolidated cable schedule",
  devices: dseDevices,
  cables: dseCables,
  connections: dseConnections,
  junctions: dseJunctions,
  currentSources: dseCurrentSources,
  powerCircuits: dsePowerCircuits,
};
