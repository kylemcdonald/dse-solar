import { conductor as p, connection as w, currentSourcesFromDevices, endpoint as ep } from "./systemGraph";
import type { Cable, CircuitPowerBudget, Connection, Device, Junction, SystemGraph, TerminalCurrentSource } from "./systemGraph";

const wall = (position: readonly [number, number, number]) => ({
  space: "world" as const,
  surface: "wall" as const,
  wallId: "north",
  position,
});
const west = ([south, height, depth]: readonly [number, number, number]) => ({
  ...wall([depth, height, south]), wallId: "west", rotation: [0, Math.PI / 2, 0] as const,
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
const MULTIPLUS_UPSTREAM_APPROVAL = "Installation approval has been received to omit a dedicated MultiPlus DC branch breaker. The accepted scheme uses the two independently protected 120 A battery strings, plus the 120 A SmartSolar cutoff for that source, as the upstream protection for the direct 1/0 AWG MultiPlus run. Preserve this exact topology and the received-device commissioning checks.";

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
      order: 0, terminal: "120 A DC-disconnect screw clamp", terminalSize: "2 AWG / 33.6 mm² maximum",
      termination: "2 AWG fine-stranded copper using the received-device-approved clamp preparation", terminalDiameterMm: 9,
      terminalNote: "The received high-current disconnect accepts no conductor larger than 2 AWG. Confirm its DC markings, clamp preparation and torque without trimming strands.",
    }),
    p("load", "Load", "positive", "top", {
      order: 0, terminal: "120 A DC-disconnect screw clamp", terminalSize: "2 AWG / 33.6 mm² maximum",
      termination: "2 AWG fine-stranded copper using the received-device-approved clamp preparation", terminalDiameterMm: 9,
      terminalNote: "The received high-current disconnect accepts no conductor larger than 2 AWG. Confirm its DC markings, clamp preparation and torque without trimming strands.",
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
  bomIds: [],
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
  placement: wall([x, 1.46, 0.055]),
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

// Landscape-to-portrait quarter-turn on the same 18° rack plane: the long
// 1.762 m module axis now runs up the slope, while the short 1.134 m edges form
// one side-by-side three-module row across the rack.
const PANEL_ROTATION = [-Math.PI / 2 - Math.PI / 10, 0, Math.PI / 2] as const;

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
  placement: { ...outside(position, PANEL_ROTATION), surface: "roof" },
  componentId: id,
  layoutGroup: { id: "pv-panels", label: "PV array", columns: 3, order: layoutOrder },
  terminalPitchByFaceM: { back: 0.080 },
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
    p("positive", "PV +", "positive", "back", {
      order: 0, gauge: "Factory 4 mm² lead", terminal: "Factory PV connector",
      terminalSize: "Original MC4-EVO2A", termination: "Matching listed PV connector",
      terminalDiameterMm: 6, terminalNote: "AIKO specifies 4 mm² / 12 AWG factory leads with original MC4-EVO2A connectors; verify every received connector before mating.",
      ...(currentSource ? { currentSource } : {}),
    }),
    p("negative", "PV −", "negative", "back", {
      order: 1, gauge: "Factory 4 mm² lead", terminal: "Factory PV connector",
      terminalSize: "Original MC4-EVO2A", termination: "Matching listed PV connector",
      terminalDiameterMm: 6, terminalNote: "AIKO specifies 4 mm² / 12 AWG factory leads with original MC4-EVO2A connectors; verify every received connector before mating.",
    }),

  ],
});

// A two-core sheath fans into two insulated PV ends; it is not an electrical
// parallel Y connector. Each polarity remains a separate graph channel.
const pvCableBreakout = (id: string, label: string, placement: Device["placement"], whiteBranches = false): Device => ({
  id, label, kind: "connector", presentation: "cable-breakout", diagramPresentation: "join",
  size: [0.06, 0.04, 0.03], placement, componentId: "pvSafety", status: "purchased",
  conductors: [
    p("positive", "PV positive end", "positive", "top", { order: 0, gauge: "4 mm²", insulationColor: whiteBranches ? "white" : undefined,
      terminal: "PV cable positive core", termination: "Continuous insulated positive conductor", terminalDiameterMm: 6.1, internalMates: ["cable"] }),
    p("negative", "PV negative end", "negative", "top", { order: 1, gauge: "4 mm²", insulationColor: whiteBranches ? "white" : undefined,
      terminal: "PV cable negative core", termination: "Continuous insulated negative conductor", terminalDiameterMm: 6.1, internalMates: ["cable"] }),
    p("cable", "White PV two-core cable", "multicore", "bottom", { gauge: "2 × 4 mm²", terminal: "PV two-core sheath",
      termination: "Continuous white jacket; separate positive and negative cores", terminalDiameterMm: 10, internalMates: ["positive", "negative"] }),
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
  // Long side parallel to the north wall; terminal polarity follows the
  // existing series-string wiring. Distances are illustrative.
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
      order: 0, gauge: "2 AWG · 33.6 mm²", terminal: "Victron drilled flat-copper terminal",
      terminalSize: "M8 stud", termination: "2 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8,
      terminalNote: "Victron specifies M8 drilled flat-copper terminals; verify the supplied hardware and torque instructions on the received battery.",
      ...(currentSource ? { currentSource } : {}),
    }),
    p("negative", "Negative post", "negative", "top", {
      order: 1, gauge: "2 AWG · 33.6 mm²", terminal: "Victron drilled flat-copper terminal",
      terminalSize: "M8 stud", termination: "2 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8,
      terminalNote: "Victron specifies M8 drilled flat-copper terminals; verify the supplied hardware and torque instructions on the received battery.",
    }),
  ],
});

export const dseCables: readonly Cable[] = [
  { id: "battery53", label: "1/0 AWG battery cable", cores: 1, outsideDiameterMm: 14.5, conductorSize: "53.5 mm²", sheath: "single", ampacityA: 120 },
  { id: "dc2", label: "2 AWG high-current DC cable", cores: 1, outsideDiameterMm: 11.8, conductorSize: "2 AWG · 33.6 mm²", sheath: "single", ampacityA: 120, notes: "Exact maximum size accepted by the received 120 A DC disconnects. Its 120 A coordination remains conditional on the selected flexible-copper cable, insulation rating, route length, bundling and temperature correction." },
  { id: "dc2Battery", label: "2 AWG flexible battery assembly", cores: 1, outsideDiameterMm: 14.5, conductorSize: "2 AWG · 33.6 mm²", sheath: "single", ampacityA: 120, notes: "Exact 2 AWG copper in the conservative routed outside-diameter envelope for the selected flexible battery assembly, insulation and strain protection. Verify the fabricated cable's actual jacket diameter and bend radius." },
  { id: "dc8Feeder", label: "8 AWG secondary-feeder cable", cores: 1, outsideDiameterMm: 8.5, conductorSize: "8 AWG · 8.37 mm²", sheath: "single", ampacityA: 80, notes: "Flexible copper feeder sized for the roughly 48–52 A conservative secondary-services envelope, with additional normal-load headroom. Fabricate each assembly with an M10-class closed ring at the main bus and a direct #10 closed ring at the Blue Sea 2314 bus. Verify the selected cable's hot/bundled ampacity, jacket diameter and bend radius before fabrication; the retained upstream-protection scheme remains a commissioning hold." },
  { id: "dc16", label: "16 mm² DC cable", cores: 1, outsideDiameterMm: 8.6, conductorSize: "16 mm²", sheath: "single", ampacityA: 75 },
  { id: "dc6", label: "6 mm² protected DC branch cable", cores: 1, outsideDiameterMm: 6.8, conductorSize: "6 mm²", sheath: "single", ampacityA: 32, notes: "Common consolidated size for the two 32 A USB supply branches. Verify hot-enclosure ampacity, breaker curve and every received terminal before commissioning." },
  { id: "pvWhite4", label: "White 4 mm² panel power cable", cores: 1, outsideDiameterMm: 6.1, conductorSize: "4 mm²", sheath: "white", ampacityA: 20, notes: "Installed white panel-to-panel links and separate ends of the array's two-core Y breakout. Electrical polarity remains explicit." },
  { id: "pvWhitePair", label: "White two-core PV downlead", cores: 2, outsideDiameterMm: 10, conductorSize: "2 × 4 mm²", sheath: "white", ampacityA: 20, carriedChannels: ["positive", "negative"], notes: "One physical downlead from the array-end Y breakout to the PV input breaker. Jacket diameter is an illustrative routing envelope." },
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
  // Three quarter-turned Neostar modules form one side-by-side 3 × 1 physical
  // row and one electrical series string. Adjacent centres retain a 106 mm
  // frame gap for factory connectors, frame bonds and mounting hardware.
  panel("panel1", "AIKO panel 1 · 3S string", [0.65, 3.40, 1.5], 0, "pv-string"),
  panel("panel2", "AIKO panel 2 · 3S string", [1.9, 3.40, 1.5], 1, "pv-string"),
  panel("panel3", "AIKO panel 3 · 3S string", [3.15, 3.40, 1.5], 2, "pv-string",
    pvStringSource("pv-string-source", "AIKO 3S PV string")),

  // Two continuous east–west rails span the whole array, one at each end
  // of the panels' long axis. The single earth conductor lands on the railwork.
  {
    id: "solarRailUpper", label: "Solar mounting rail · upper", kind: "connector", size: [3.70, 0.04, 0.04],
    placement: { ...outside([1.90, 3.52, 2.04], [PANEL_ROTATION[0], 0, 0]), surface: "roof" },
    componentId: "solarMounting", color: "#8c9090", status: "purchased", conductors: [],
  },
  {
    id: "solarRailLower", label: "Solar mounting rails · earth landing", kind: "connector", size: [3.70, 0.04, 0.04],
    placement: { ...outside([1.90, 3.18, 0.98], [PANEL_ROTATION[0], 0, 0]), surface: "roof" },
    componentId: "solarMounting", color: "#8c9090", status: "purchased", conductors: [
      p("earth", "Solar rail earth clamp", "earth", "left", { gauge: "4 mm²", terminal: "Mounting-rail earth clamp",
        termination: "Installed rail bonding connection", terminalDiameterMm: 5, terminalNote: "The owner reports earthing at the mounting rails; the illustrated clamp position is not a measured attachment point." }),
    ],
  },
  pvCableBreakout("pvArrayBreakout", "PV array ends · white cable Y", { ...outside([1.90, 3.00, 1.50]), surface: "roof" }, true),
  pvCableBreakout("pvInputBreakout", "PV downlead · breaker-end breakout", inside("pvJunction", "backplate", 0)),

  {
    id: "pvJunction", label: "PV cutoff box · four DIN devices", kind: "junction",
    size: [0.44, 0.36, 0.20], placement: west([1.45, 2.20, 0.12]), componentId: "pvSafety",
    bomIds: ["dse-pv-protection", "dse-pv-string-breakers"], status: "planned", conductors: [],
  },
  {
    id: "pvCutoff", layoutGroup: { id: "pv-din", label: "PV DIN rail", columns: 4, order: 0 }, label: "PV breaker 1 · active · 20 A", kind: "breaker", poles: 2,
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
    placement: west([1.40, 1.48, 0.10]), componentId: "solarController", bomIds: ["dse-smartsolar", "dse-mppt-wirebox-tr"],
    status: "purchased", technicalUrl: SMARTSOLAR_SPEC,
    power: {
      role: "converter", basis: "manufacturer", verified: true, sourceUrl: SMARTSOLAR_SPEC,
      readings: [
        { label: "Maximum PV capacity at 24 V", watts: 2400 },
        { label: "Maximum battery output", currentA: 85, voltage: "24 V nominal" },
        { label: "Peak conversion efficiency", percent: 98 },
        { label: "Self-consumption ceiling", watts: 0.84, voltage: "24 V", note: "Conservative conversion of the published <35 mA 12 V value." },
      ],
      note: "The 1.47 kW AIKO array is within the controller's published 2.4 kW nominal-PV limit at 24 V. The array normally limits charge power to roughly 60 A near 24 V; the battery circuit uses exact 2 AWG / 33.6 mm² copper so it fits both the controller's AWG 2 terminal limit and the received DC disconnect.",
      internalProtection: { verified: true, features: ["PV reverse-polarity", "output short-circuit", "over-temperature"] },
    },
    conductors: [
      p("pvPositive", "PV +", "positive", "bottom", { order: 0, gauge: "4 mm² single-string PV lead", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded copper; ferrule only if Victron accepts the selected size", terminalDiameterMm: 8 }),
      p("pvNegative", "PV −", "negative", "bottom", { order: 1, gauge: "4 mm² single-string PV lead", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded copper; ferrule only if Victron accepts the selected size", terminalDiameterMm: 8 }),
      p("batteryPositive", "Battery +", "positive", "bottom", {
        order: 2, gauge: "2 AWG · 33.6 mm²", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded 2 AWG copper", terminalDiameterMm: 9,
        currentSource: {
          id: "smartsolar-output-source", label: "SmartSolar 150/85 battery output", channel: "positive",
          continuousCapacityA: 85, shortCircuitCurrentA: 85,
          inherentCurrentLimit: { currentLimitA: 85, verified: true, note: "Published 85 A maximum regulated battery current and output short-circuit protection." },
          verified: true, basis: "regulated-output",
        },
      }),
      p("batteryNegative", "Battery −", "negative", "bottom", { order: 3, gauge: "2 AWG · 33.6 mm²", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded 2 AWG copper", terminalDiameterMm: 9 }),
      p("veDirect", "VE.Direct", "data", "bottom", { order: 4, terminal: "VE.Direct receptacle", terminalSize: "Victron VE.Direct", termination: "Factory VE.Direct cable", terminalDiameterMm: 7 }),
    ],
  },

  {
    id: "batteryCutoffJunction", label: "Battery / MPPT cutoff junction box · verified 200 × 155 × 92 mm", kind: "junction", size: [0.20, 0.16, 0.10],
    physicalSize: [0.200, 0.155, 0.092],
    placement: west([1.48, 0.65, 0.08]), componentId: "batteryCutoff",
    bomIds: ["dse-mollom-8-way-enclosure-second", "dse-airic-npt-cable-glands"], status: "purchased", conductors: [],
  },
  breaker("batteryBreakerA", "String A cutoff · 120 A", "batteryCutoffJunction", 0, 120, {
    subtitle: "Non-polarized battery disconnect", componentId: "batteryBreakerA", bomIds: ["dse-battery-string-breakers"], purchaseUrl: DIHOOL_120, status: "purchased",
  }),
  breaker("batteryBreakerB", "String B cutoff · 120 A", "batteryCutoffJunction", 1, 120, {
    subtitle: "Non-polarized battery disconnect", componentId: "batteryBreakerB", bomIds: ["dse-battery-string-breakers"], purchaseUrl: DIHOOL_120, status: "purchased",
  }),
  breaker("mpptBreaker", "SmartSolar cutoff · 120 A", "batteryCutoffJunction", 2, 120, {
    subtitle: "Non-polarized controller disconnect", componentId: "mpptFuse", bomIds: ["dse-breaker-mnedc100"], purchaseUrl: DIHOOL_120, status: "purchased",
  }),
  {
    id: "mainPositiveBus", label: "Main 24 V positive bus · supplied insulating cover", kind: "busbar", size: [0.18, 0.060, 0.040],
    placement: west([1.45, 1.04, 0.06]), componentId: "mainDistribution", bomIds: ["dse-main-busbars"], status: "purchased", color: "#b93131",
    currentRatingA: 250, terminalPitchByFaceM: { front: 0.040 }, conductors: [
      ...Array.from({ length: 4 }, (_, index) => p(`post${index + 1}`, `Positive stud ${index + 1}`, "positive", "front", {
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
          ? "The MPPT, held direct 8 AWG secondary feeder and factory-fused SmartShunt sense lead stack directly on this final stud. Lug stacking and clearance under the supplied cover are approved; upstream feeder protection coordination remains a separate engineering hold."
          : "Use one field termination per modeled landing and the received busbar torque specification.",
      })),
    ],
  },
  {
    id: "smartShunt", label: "Victron SmartShunt IP65 500 A", kind: "monitor", size: [0.12, 0.055, 0.045],
    placement: west([0.90, 0.76, 0.06]), componentId: "mainDistribution", bomIds: ["dse-shunt"], status: "purchased",
    power: {
      role: "monitor", basis: "manufacturer", verified: true, sourceUrl: SMARTSHUNT_SPEC,
      readings: [{ label: "Current draw", watts: 0.024, voltage: "24 V", note: "Upper bound from the published <1 mA draw." }],
      note: "The 500 A shunt rating is measurement-path capacity, not standing consumption. The supplied positive sense lead uses a 1 A fuse.",
      internalProtection: { verified: true, features: ["Factory 1 A fused positive sense lead"] },
    },
    conductors: [
      p("batteryMinus", "Battery minus", "negative", "left", {
        gauge: "2 AWG · 33.6 mm² per string", terminal: "SmartShunt battery bolt", terminalSize: "M10",
        termination: "Two 2 AWG tinned-copper M10 closed lugs", terminalDiameterMm: 10,
        terminalNote: "Both string negatives terminate only on BATTERY MINUS; no load or system return may land here. Confirm the final lug arrangement, full thread engagement and Victron torque.",
      }),
      p("systemMinus", "System minus", "negative", "right", {
        gauge: "1/0 AWG · 53.5 mm²", terminal: "SmartShunt system bolt", terminalSize: "M10",
        termination: "1/0 AWG tinned-copper M10 closed lug", terminalDiameterMm: 10,
        currentDomain: { id: "main-dc", role: "return" },
      }),
      p("vBattPlus", "Vbatt+ sense", "positive", "bottom", { order: 0, gauge: "Factory fused lead", terminal: "SmartShunt auxiliary sense lead", terminalSize: "M10 ring eye supplied", termination: "Factory fused M10 ring-eye lead", terminalDiameterMm: 5 }),
      p("veDirect", "VE.Direct", "data", "bottom", { order: 1, terminal: "VE.Direct receptacle", terminalSize: "Victron VE.Direct", termination: "Factory VE.Direct cable", terminalDiameterMm: 7 }),
    ],
  },
  {
    id: "mainNegativeBus", label: "Main system-negative bus · supplied insulating cover", kind: "busbar", size: [0.18, 0.060, 0.040],
    placement: west([0.90, 1.04, 0.06]), componentId: "mainDistribution", bomIds: ["dse-main-busbars"], status: "purchased", color: "#252c32",
    currentRatingA: 250, terminalPitchByFaceM: { front: 0.040 }, conductors: [
      ...Array.from({ length: 4 }, (_, index) => p(`post${index + 1}`, `Negative stud ${index + 1}`, "negative", "front", {
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
    id: "secondaryJunction", label: "Secondary services junction box", kind: "junction", size: [0.40, 0.44, 0.20],
    placement: wall([0.86, 2.52, 0.16]), componentId: "secondaryDistribution",
    bomIds: ["dse-secondary-enclosure-larger", "dse-pg11-cable-glands", "dse-din-rail-pack"], status: "hold", conductors: [],
    holdReason: "Installed on the north wall. Exact enclosure measurements are not recorded; the solver envelope is illustrative and is not a replacement-hardware requirement.",
  },
  breaker("sharedServicesBreaker", "Shared switched services · 10 A", "secondaryJunction", 2, 10, {
    placement: { ...inside("secondaryJunction", "din", 2), offset: [-0.04, 0] },
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
  breaker("orionBreaker32", "Orion input · 32 A", "secondaryJunction", 0, 32, {
    placement: { ...inside("secondaryJunction", "din", 0), offset: [-0.12, 0] },
    componentId: "secondaryDistribution", bomIds: ["dse-orion-input-breaker"], purchaseUrl: CHTAIXI_32, status: "purchased",
  }),
  breaker("chargeItBreaker32", "ChargeIT! branch · 32 A", "secondaryJunction", 1, 32, {
    placement: { ...inside("secondaryJunction", "din", 1), offset: [-0.08, 0] },
    componentId: "secondaryDistribution", bomIds: ["dse-chargeit-branch-breaker"], purchaseUrl: CHTAIXI_32, status: "purchased",
  }),
  {
    id: "secondaryPositiveBus", label: "Secondary 24 V positive bus · 100 A", kind: "busbar", size: [0.12, 0.040, 0.030],
    placement: { ...inside("secondaryJunction", "power", 0), offset: [-0.10, -0.12] }, componentId: "secondaryDistribution", color: "#b93131",
    bomIds: ["dse-service-return-bus-spares"], status: "purchased", currentRatingA: 100, conductors: [
      ...Array.from({ length: 7 }, (_, index) => p(`post${index + 1}`, `Secondary positive ${index < 2 ? "stud" : "screw"} ${index + 1}`, "positive", "front", {
        order: index,
        routingGroup: index < 2 ? "studs" : "branch-screws",
        currentDomain: { id: "secondary-dc", role: "active" },
        gauge: index === 0 ? "8 AWG · 8.37 mm² · field-procured" : undefined,
        terminal: index < 2 ? "Blue Sea 2314 stud" : "Blue Sea 2314 screw",
        terminalSize: index < 2 ? "#10-32 stud" : "#8-32 screw",
        termination: index === 0
          ? "8 AWG closed tinned-copper #10 ring lug"
          : index < 2 ? "Closed #10 ring terminal" : "Closed #8 ring terminal",
        terminalDiameterMm: index < 2 ? 4.8 : 4.2,
        terminalNote: index === 0
          ? "Direct field-procured 8 AWG feeder landing with a #10 closed ring. Verify the ring shoulder, full thread engagement, 18 in-lb stud torque, cover clearance, cable ampacity and retained upstream-protection basis before energizing."
          : "One of the two previously unallocated Blue Sea 2314 bars is promoted to the covered secondary-positive bus. Verify conductor size and ring fit against the received 100 A bar.",
      })),
    ],
  },
  {
    id: "secondaryNegativeBus", label: "Secondary 24 V negative bus · 100 A", kind: "busbar", size: [0.12, 0.040, 0.030],
    placement: { ...inside("secondaryJunction", "power", 1), offset: [0.10, -0.12] }, componentId: "secondaryDistribution", color: "#252c32",
    bomIds: ["dse-service-return-bus"], status: "purchased", currentRatingA: 100, conductors: [
      ...Array.from({ length: 7 }, (_, index) => p(`post${index + 1}`, `Secondary negative ${index < 2 ? "stud" : "screw"} ${index + 1}`, "negative", "front", {
        order: index,
        routingGroup: index < 2 ? "studs" : "branch-screws",
        routingCapacity: index === 4 || index === 6 ? 2 : 1,
        currentDomain: { id: "secondary-dc", role: "return" },
        gauge: index === 0 ? "8 AWG · 8.37 mm² · field-procured" : undefined,
        terminal: index < 2 ? "Blue Sea 2314 stud" : "Blue Sea 2314 screw",
        terminalSize: index < 2 ? "#10-32 stud" : "#8-32 screw",
        termination: index === 0
          ? "8 AWG closed tinned-copper #10 ring lug"
          : index < 2 ? "Closed #10 ring terminal" : "Closed #8 ring terminal",
        terminalDiameterMm: index < 2 ? 4.8 : 4.2,
        sharedConnectionPolicy: index === 4 || index === 6 ? "warning" : undefined,
        terminalNote: index === 0
          ? "Direct field-procured 8 AWG return landing with a #10 closed ring. Verify the ring shoulder, full thread engagement, 18 in-lb stud torque, cover clearance, cable ampacity and retained upstream-protection basis before energizing."
          : undefined,
      })),
    ],
  },

  {
    id: "switchedServicesBus", label: "10 A services output · Blue Sea bus", kind: "busbar", size: [0.12, 0.040, 0.030],
    placement: { ...inside("secondaryJunction", "power", 2), offset: [0.06, 0], rotationZ: Math.PI / 2 },
    componentId: "secondaryDistribution", color: "#252c32", bomIds: ["dse-service-return-bus-spares"], status: "purchased", currentRatingA: 100,
    subtitle: "Vertical installed bar · one outgoing tap to the rocker commons; remaining positions unused",
    conductors: Array.from({ length: 7 }, (_, index) => p(`post${index + 1}`, `10 A output ${index < 2 ? "stud" : "screw"} ${index + 1}`, "positive", "front", {
      order: index, optional: ![0, 2].includes(index),
      currentDomain: { id: "secondary-dc", role: "active" },
      terminal: index < 2 ? "Blue Sea 2314 stud" : "Blue Sea 2314 screw",
      terminalSize: index < 2 ? "#10-32 stud" : "#8-32 screw",
      termination: index < 2 ? "Closed #10 ring terminal" : "Closed #8 ring terminal",
      terminalDiameterMm: index < 2 ? 4.8 : 4.2,
    })),
  },

  {
    id: "internetSplit", label: "Starlink / UniFi · three-way WAGO", kind: "connector", presentation: "service-splice", diagramPresentation: "join", size: [0.040, 0.024, 0.030],
    placement: { ...inside("secondaryJunction", "backplate", 3), offset: [-0.02, 0.16] }, componentId: "internetSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("in", "Switched feed", "positive", "left"), p("starlink", "Starlink +", "positive", "right", { order: 0 }), p("unifi", "UniFi converter +", "positive", "right", { order: 1 }),
    ],
  },
  {
    id: "unifiPower", label: "UniFi 24 V to 5 V USB-A converter", kind: "converter", size: [0.075, 0.040, 0.025],
    placement: { ...inside("secondaryJunction", "backplate", 0), offset: [0.12, 0.14] }, componentId: "unifiPower", bomIds: ["dse-unifi-converter", "dse-unifi-usb-cable"], status: "purchased",
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
    placement: { ...inside("secondaryJunction", "backplate", 5), offset: [-0.14, 0.16] }, componentId: "internetSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("positive", "Starlink + core", "positive", "top", { order: 0, gauge: "Factory lead", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["cable"] }),
      p("negative", "Starlink − core", "negative", "top", { order: 1, gauge: "Factory lead", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["cable"] }),
      p("cable", "Starlink factory power cable", "multicore", "bottom", { terminal: "Factory two-core cable", terminalSize: "Complete Starlink Mini power lead", termination: "Strain relief / factory connector", terminalDiameterMm: 6, internalMates: ["positive", "negative"] }),
    ],
  },


  // Installed north-to-south order along the west wall; long sides run east–west.
  battery("battery1", "A1", [0.38, 0.15, 0.35], "battery1", 0, "battery-string-a"),
  battery("battery2", "A2", [0.38, 0.15, 0.6499999999999999], "battery2", 1, "battery-string-a",
    batteryStringSource("battery-string-a-source", "24 V battery string A")),
  battery("battery3", "B1", [0.38, 0.15, 0.95], "battery3", 2, "battery-string-b"),
  battery("battery4", "B2", [0.38, 0.15, 1.25], "battery4", 3, "battery-string-b",
    batteryStringSource("battery-string-b-source", "24 V battery string B")),
  {
    id: "balancerA", label: "Victron battery balancer A", kind: "converter", size: [0.113, 0.100, 0.047], placement: west([0.35, 0.54, 0.06]),
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
    id: "balancerB", label: "Victron battery balancer B", kind: "converter", size: [0.113, 0.100, 0.047], placement: west([1.86, 0.37, 0.06]),
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
    id: "multiPlus", label: "Victron MultiPlus-II 24/3000", kind: "inverter", size: [0.268, 0.499, 0.141], placement: west([0.65, 2.12, 0.12]),
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
      note: `The manufacturer table calls for a dedicated 300 A external DC protective device and 50 mm² copper for a 0–5 m run. ${MULTIPLUS_UPSTREAM_APPROVAL}`,
      internalProtection: {
        verified: true,
        features: ["AC-output short-circuit", "overload", "battery high/low voltage", "over-temperature", "input-ripple"],
        note: "Internal equipment protection remains separate from the accepted upstream battery-string breaker scheme and the required downstream AC RCBO.",
      },
    },
    conductors: [
      p("voltageSenseNegative", "V-sense − · A1−", "control", "bottom", { order: 12, terminal: "MultiPlus voltage-sense negative", terminalNote: "Negative sense lead reported installed. Positive sense connection is not yet recorded." }),
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
  acBreakout("multiAcInBreakout", "MultiPlus AC-in cable breakout", west([0.50, 1.69, 0.08]), "bottom", "top"),
  acBreakout("multiAcOutBreakout", "MultiPlus AC-out cable breakout", west([0.73, 1.69, 0.08]), "bottom", "top"),
  {
    id: "acJunction", label: "AC input / output protection box", kind: "junction", size: [0.36, 0.44, 0.12], placement: wall([0.53, 0.91, 0.10]),
    componentId: "acBoard", bomIds: ["dse-ac-rcbo"], status: "hold", conductors: [],
    holdReason: "Installed AC box on the north wall. Its dimensions and exact PE/N bridge terminals have not yet been recorded; the displayed routing envelope is illustrative.",
  },
  {
    id: "acInputProtection", label: "AC-in 10 A Type A RCBO + SPD", kind: "protection", poles: 4, size: [0.080, 0.085, 0.070], placement: inside("acJunction", "din", 0),
    componentId: "generatorInput", bomIds: ["dse-ac-rcbo"], status: "hold", procurementStatus: "purchased",
    currentProtection: { kind: "breaker", ratedCurrentA: 10, verified: false, terminalPairs: [["lineIn", "lineOut"]] }, conductors: [
      p("lineIn", "Generator L", "ac-line", "bottom", { order: 0, gauge: "1.5 mm²", terminal: "DIHOOL line screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("neutralIn", "Generator N", "ac-neutral", "bottom", { order: 1, gauge: "1.5 mm²", terminal: "DIHOOL neutral screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("earth", "SPD protective earth", "earth", "top", { order: 2, gauge: "1.5 mm²", terminal: "DIHOOL ground screw clamp", terminalSize: "≤6 mm² per manufacturer page", termination: "Green/yellow core; ferrule only if accepted", terminalDiameterMm: 6, terminalNote: "This is the SPD earth landing, not a switched neutral or an N–PE bond." }),
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
      p("earth", "SPD protective earth", "earth", "top", { order: 2, gauge: "1.5 mm²", terminal: "DIHOOL ground screw clamp", terminalSize: "≤6 mm² per manufacturer page", termination: "Green/yellow core; ferrule only if accepted", terminalDiameterMm: 6, terminalNote: "This is the SPD earth landing; protective earth remains continuous through the bodyless daisy-chain join and is never switched." }),
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
    id: "servicePenetration", label: "Inside / outside service penetration", kind: "connector", presentation: "wall-passthrough", size: [0.280, 0.180, 0.045], placement: west([1.33, 2.65, 0]),
    componentId: "mounting", bomIds: [], status: "planned", conductors: [
      p("pvCableOutside", "White PV cable · outside", "multicore", "back", { order: 2, terminal: "Sealed wall penetration", terminalSize: "Two-core PV cable gland", termination: "Continuous white PV cable", terminalDiameterMm: 10, internalMates: ["pvCableInside"] }),
      p("pvCableInside", "White PV cable · inside", "multicore", "front", { order: 2, terminal: "Sealed wall penetration", terminalSize: "Two-core PV cable gland", termination: "Continuous white PV cable", terminalDiameterMm: 10, internalMates: ["pvCableOutside"] }),
      p("frameOutside", "PV frame bond · outside", "earth", "back", { order: 4, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² bond-conductor gland", termination: "Continuous insulated copper bond", terminalDiameterMm: 5, internalMates: ["frameInside"] }),
      p("starlinkPowerOutside", "Starlink power · outside", "multicore", "back", { order: 6, gauge: "Factory lead", terminal: "Sealed wall penetration", terminalSize: "Starlink power-cable gland", termination: "Strain-relieved factory cable", terminalDiameterMm: 6, internalMates: ["starlinkPowerInside"] }),
      p("starlinkDataOutside", "Starlink Ethernet · outside", "data", "back", { order: 7, gauge: "Outdoor Ethernet", terminal: "Sealed wall penetration", terminalSize: "Ethernet cable gland", termination: "Outdoor-rated continuous data cable", terminalDiameterMm: 6, internalMates: ["starlinkDataInside"] }),
      p("frameInside", "PV frame bond · inside", "earth", "front", { order: 4, gauge: "4 mm²", terminal: "Sealed wall penetration", terminalSize: "4 mm² bond-conductor gland", termination: "Continuous insulated copper bond", terminalDiameterMm: 5, internalMates: ["frameOutside"] }),
      p("starlinkPowerInside", "Starlink power · inside", "multicore", "front", { order: 6, gauge: "Factory lead", terminal: "Sealed wall penetration", terminalSize: "Starlink power-cable gland", termination: "Strain-relieved factory cable", terminalDiameterMm: 6, internalMates: ["starlinkPowerOutside"] }),
      p("starlinkDataInside", "Starlink Ethernet · inside", "data", "front", { order: 7, gauge: "Outdoor Ethernet", terminal: "Sealed wall penetration", terminalSize: "Ethernet cable gland", termination: "Outdoor-rated continuous data cable", terminalDiameterMm: 6, internalMates: ["starlinkDataOutside"] }),
    ],
  },
  {
    id: "generator", appearance: "ac-plug", label: "Generator input · Type I male plug", kind: "connector",
    size: [0.065, 0.065, 0.045], placement: wall([1.28, 0.91, 0.06]),
    terminalPitchByFaceM: { bottom: AC_CORE_PITCH_M },
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
      p("line", "Active / L post", "ac-line", "bottom", {
        order: 0, terminal: "Type I plug active contact", terminalSize: "AS/NZS 3112 / Type I male plug", termination: "Internal/factory contact", terminalDiameterMm: 5,
        currentSource: {
          id: "generator-active-source", label: "Husqvarna generator active output", channel: "ac-line",
          continuousCapacityA: 10, shortCircuitCurrentA: "unbounded", verified: false, basis: "upstream-protected-source",
          note: "Confirm the generator's received outlet breaker and fault-current envelope.",
        },
      }),
      p("neutral", "Neutral / N post", "ac-neutral", "bottom", { order: 1, terminal: "Type I plug neutral contact", terminalSize: "AS/NZS 3112 / Type I male plug", termination: "Internal/factory contact", terminalDiameterMm: 5 }),
      p("earth", "Protective-earth / PE post", "earth", "bottom", { order: 2, terminal: "Type I plug earth contact", terminalSize: "AS/NZS 3112 / Type I male plug", termination: "Internal/factory contact", terminalDiameterMm: 5 }),
    ],
  },
  acBreakout(
    "generatorLeadBreakout",
    "Generator trailing-lead breakout",
    wall([1.28, 0.73, 0.04]),
    "top",
    "bottom",
  ),
  {
    id: "toolOutlet", appearance: "ac-socket", label: "Type I trailing tool outlet", kind: "load",
    size: [0.085, 0.060, 0.040], placement: wall([1.10, 0.91, 0.06]),
    terminalPitchByFaceM: { bottom: AC_CORE_PITCH_M },
    componentId: "toolOutlet", bomIds: ["dse-fiji-10a-surface-socket"], status: "planned",
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
  acBreakout("toolOutletLeadBreakout", "Tool-outlet trailing-lead breakout", wall([1.10, 0.73, 0.04])),

  {
    id: "earthPenetration", label: "Electrode cable · floor penetration near A1", kind: "connector", presentation: "wall-passthrough",
    size: [0.08, 0.08, 0.04], placement: { ...floor([0.16, 0, 0.12], [-Math.PI / 2, 0, 0]), wallId: "floor" },
    componentId: "mounting", status: "purchased", conductors: [
      p("inside", "Electrode bond · above floor", "earth", "front", { gauge: "16 mm²", internalMates: ["outside"], terminal: "Floor cable penetration", termination: "Continuous insulated earth conductor", terminalDiameterMm: 8.6 }),
      p("outside", "Electrode bond · below floor", "earth", "back", { gauge: "16 mm²", internalMates: ["inside"], terminal: "Floor cable penetration", termination: "Continuous insulated earth conductor", terminalDiameterMm: 8.6 }),
    ],
  },
  {
    id: "earthElectrode", label: "Earth electrode", kind: "earth", size: [0.035, 0.70, 0.035], placement: outside([0.16, -0.43, 0.12]),
    componentId: "earth", bomIds: ["dse-solar-fiji-earth-rod"], status: "planned", conductors: [p("clamp", "Electrode clamp", "earth", "top", { gauge: "16 mm²", terminal: "Listed earth-electrode clamp", terminalSize: "Match received rod and 16 mm² conductor", termination: "Continuous insulated copper bond", terminalDiameterMm: 10 })],
  },
  {
    id: "ekrano", label: "Victron Ekrano GX", kind: "monitor", size: [0.187, 0.124, 0.030], placement: west([0.78, 1.48, 0.06]),
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
    id: "starlink", label: "Starlink Mini", kind: "load", size: [0.299, 0.039, 0.259], placement: outside([0.20, 3.35, 0.20]),
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
    id: "unifi", label: "UniFi Express", kind: "load", size: [0.098, 0.098, 0.030], placement: { space: "world", surface: "shelf", position: [0.86, 2.76, 0.16], rotation: [-Math.PI / 2, 0, 0] },
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
    id: "usbOrion", label: "Victron Orion-Tr Smart 24/12-30", kind: "converter", size: [0.130, 0.186, 0.055], placement: wall([0.45, 1.90, 0.10]),
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
      p("remoteH", "Remote H", "control", "bottom", { order: 0, gauge: "1.5 mm²", terminal: "Orion remote H screw clamp", terminalSize: "Verify received remote connector", termination: "1.5 mm² bootlace ferrule if accepted", terminalDiameterMm: 4, terminalNote: "The middle rocker of the three-gang wall switch applies positive to H; L remains unused. Confirm the received removable connector accepts the consolidated 1.5 mm² control conductor." }),
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
    id: "usbSocketA", label: "12 V cigarette-lighter socket A", kind: "connector", size: [0.052, 0.072, 0.048], placement: wall([1.47, 1.45, 0.06]),
    componentId: "usb", bomIds: ["dse-usb-sockets"], status: "purchased", conductors: [
      p("positive", "Rear centre-positive lead", "positive", "bottom", { order: 0, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory red pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8, terminalNote: "This terminal carries the downstream socket as well as socket A; retain any integral protection and obtain installer approval." }),
      p("negative", "Rear shell-negative lead", "negative", "bottom", { order: 1, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory black pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("socket", "12 V accessory receptacle", "multicore", "front", { terminal: "SAE J563-style accessory socket", terminalSize: "Centre positive / shell negative", termination: "Mating Coolgear cigarette plug", terminalDiameterMm: 21, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
    ],
  },
  {
    id: "usb145A", label: "Coolgear 145 W charger A", kind: "load", size: [0.052, 0.040, 0.092], placement: wall([1.47, 1.45, 0.14]),
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
    id: "usbSocketB", label: "12 V cigarette-lighter socket B", kind: "connector", size: [0.052, 0.072, 0.048], placement: wall([1.69, 1.45, 0.06]),
    componentId: "usb", bomIds: ["dse-usb-sockets"], status: "purchased", conductors: [
      p("positive", "Rear centre-positive lead", "positive", "bottom", { order: 0, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory red pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("negative", "Rear shell-negative lead", "negative", "bottom", { order: 1, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory black pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("socket", "12 V accessory receptacle", "multicore", "front", { terminal: "SAE J563-style accessory socket", terminalSize: "Centre positive / shell negative", termination: "Mating Coolgear cigarette plug", terminalDiameterMm: 21, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
    ],
  },
  {
    id: "usb145B", label: "Coolgear 145 W charger B", kind: "load", size: [0.052, 0.040, 0.092], placement: wall([1.69, 1.45, 0.14]),
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
  usbMini("usbMiniA", "ChargeIT! Mini 75 W A", 0.6, 0),
  usbMini("usbMiniB", "ChargeIT! Mini 75 W B", 0.82, 1),
  usbMini("usbMiniC", "ChargeIT! Mini 75 W C", 1.04, 2),
  usbMini("usbMiniD", "ChargeIT! Mini 75 W D", 1.26, 3),
  twoCoreBreakout("indoorLightBreakout", "Indoor-light two-core breakout", wall([1.28, 1.85, 0.05])),

  {
    id: "indoorLight", appearance: "light", label: "Indoor light 1", kind: "load", size: [0.127, 0.055, 0.055], placement: ceiling([1.4, 3.05, 1.3]),
    componentId: "indoorLight", bomIds: ["dse-indoor-light"], status: "purchased",
    power: { role: "load", basis: "user-confirmed", verified: true, readings: [{ label: "Input", watts: 5, voltage: "12–28 VDC" }], note: "5 W value confirmed by the system owner; verify received label/current during bench commissioning." },
    conductors: [p("power", "Factory two-core light lead", "multicore", "left", { terminal: "Factory light pigtail", terminalSize: "Two-core 24 V lead", termination: "Sealed two-core cable splice", terminalDiameterMm: 6.4, internalMates: ["positive", "negative"] })],
  },
  {
    id: "indoorLight2", appearance: "light", label: "Indoor light 2", kind: "load", size: [0.127, 0.055, 0.055], placement: ceiling([2.6, 3.05, 1.3]),
    componentId: "indoorLight2", bomIds: ["dse-outdoor-light"], status: "purchased",
    power: { role: "load", basis: "user-confirmed", verified: true, readings: [{ label: "Input", watts: 5, voltage: "12–28 VDC" }], note: "5 W value confirmed by the system owner; verify received label/current during bench commissioning." },
    conductors: [p("power", "Factory two-core light lead", "multicore", "front", { terminal: "Factory light pigtail", terminalSize: "Two-core 24 V lead", termination: "Sealed two-core cable splice", terminalDiameterMm: 6.4, internalMates: ["positive", "negative"] })],
  },
  {
    id: "pvSpare", layoutGroup: { id: "pv-din", label: "PV DIN rail", columns: 4, order: 1 }, label: "PV breaker 2 · unused / disconnected", kind: "breaker", poles: 2,
    size: [0.040, 0.082, 0.070], placement: inside("pvJunction", "din", 1), componentId: "pvSafety",
    bomIds: ["dse-pv-string-breakers"], purchaseUrl: "https://www.amazon.com/dp/B0D4JR95Y4", status: "purchased",
    currentProtection: { kind: "breaker", ratedCurrentA: 20, verified: false, terminalPairs: [["positiveIn", "positiveOut"]] }, conductors: [
      p("positiveIn", "3S array + in", "positive", "bottom", {
        optional: true, order: 0, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
        terminalNote: "Verify at least 150 VDC operating voltage, the received 20 A marking, polarity diagram, interrupt rating, torque and common-trip operation before commissioning.",
      }),
      p("negativeIn", "3S array − in", "negative", "bottom", {
        optional: true, order: 1, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
      p("positiveOut", "Protected PV + out", "positive", "top", {
        optional: true, order: 0, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
      p("negativeOut", "Switched PV − out", "negative", "top", {
        optional: true, order: 1, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 20 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
    ],
  },
  {
    id: "pvCombiner", layoutGroup: { id: "pv-din", label: "PV DIN rail", columns: 4, order: 2 }, label: "PV combiner breaker · 40 A · DC 600 V", kind: "breaker", poles: 2,
    size: [0.040, 0.082, 0.070], placement: inside("pvJunction", "din", 2), componentId: "pvSafety",
    bomIds: ["dse-pv-string-breakers"],  status: "purchased",
    currentProtection: { kind: "breaker", ratedCurrentA: 40, verified: false, terminalPairs: [["positiveIn", "positiveOut"]] }, conductors: [
      p("positiveIn", "3S array + in", "positive", "bottom", {
        order: 0, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 40 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
        terminalNote: "Verify at least 150 VDC operating voltage, the received 40 A marking, polarity diagram, interrupt rating, torque and common-trip operation before commissioning.",
      }),
      p("negativeIn", "3S array − in", "negative", "bottom", {
        order: 1, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 40 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
      p("positiveOut", "Protected PV + out", "positive", "top", {
        order: 0, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 40 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
      p("negativeOut", "Switched PV − out", "negative", "top", {
        order: 1, gauge: "4 mm²", terminal: "CHTAIXI two-pole breaker screw clamp", terminalSize: "Verify received 40 A device",
        termination: "Bare fine-stranded PV conductor or maker-approved ferrule", terminalDiameterMm: 5.5,
      }),
    ],
  },
  {
    id: "pvSurge", layoutGroup: { id: "pv-din", label: "PV DIN rail", columns: 4, order: 3 }, label: "PV surge protector · DC 600 V · 40 kA", kind: "protection",
    size: [0.060, 0.082, 0.070], placement: inside("pvJunction", "din", 3), componentId: "pvSafety", status: "purchased",
    subtitle: "Shunt surge protection; earth continues to MultiPlus chassis",
    conductors: [p("positive", "+", "positive", "top", { order: 0 }), p("negative", "−", "negative", "top", { order: 1 }),
      p("earth", "PV frame / chassis earth", "earth", "bottom", {})],
  },
  {
    id: "wallSwitchJunction", label: "Three-gang wall switch", subtitle: "Top: Internet · middle: Orion · bottom: lights",
    kind: "junction", size: [0.24, 0.42, 0.14], placement: wall([0.96, 1.88, 0.10]), componentId: "loadSwitches", status: "purchased", conductors: [],
  },
  ...([
    ["switchInternet", "Top · Starlink / UniFi", 2, "positive"],
    ["switchOrion", "Middle · Orion remote H", 1, "control"],
    ["switchLights", "Bottom · indoor lights", 0, "positive"],
  ] as const).map(([id, label, order, kind]): Device => ({
    id, label, layoutGroup: { id: "wall-rockers", label: "Three-gang wall switch", columns: 1, order: 2 - order }, kind: "switch", size: [0.06, 0.05, 0.04], placement: inside("wallSwitchJunction", "backplate", order),
    componentId: "loadSwitches", status: "purchased", subtitle: "Australian rocker · common / on / loop",
    conductors: [p("common", "Common", "positive", "left", { internalMates: ["on"] }),
      p("on", "On", kind, "right", { internalMates: ["common"] }), p("loop", "Loop · unused", "positive", "bottom", { optional: true })],
  })),
  {
    id: "lightSplice", label: "Two-core lighting string · middle splice", kind: "connector", presentation: "service-splice", diagramPresentation: "join",
    size: [0.06, 0.04, 0.03], placement: ceiling([1.4, 3.05, 1.10]), componentId: "indoorLight", status: "purchased",
    conductors: [p("in", "String in · + / −", "multicore", "bottom", { internalMates: ["out", "branch"] }),
      p("out", "String continuation · + / −", "multicore", "right", { internalMates: ["in", "branch"] }),
      p("branch", "Middle light splice · + / −", "multicore", "top", { internalMates: ["in", "out"] })],
  },

];

export const dseJunctions: readonly Junction[] = [
  { id: "wall-switch", deviceId: "wallSwitchJunction", label: "Three-gang wall switch", minimumSize: [0.24, 0.42, 0.14], padding: 0.02, dinGap: 0, backplateGap: 0.04, glandSpacing: 0.02, backplateColumns: 1 },
  { id: "battery-cutoff", deviceId: "batteryCutoffJunction", label: "Battery / MPPT cutoff junction", minimumSize: [0.20, 0.16, 0.10], padding: 0.010, dinGap: 0.020, backplateGap: 0.010, glandSpacing: 0.020, glandFaces: "top-and-bottom", sizePolicy: "verified-fixed" },
  { id: "secondary", deviceId: "secondaryJunction", label: "Secondary 24 V services junction", minimumSize: [0.40, 0.44, 0.20], padding: 0.010, dinGap: 0.020, backplateGap: 0.020, glandSpacing: 0.020, sizePolicy: "auto" },
  { id: "pv", deviceId: "pvJunction", label: "Installed PV cutoff box", minimumSize: [0.44, 0.36, 0.20], padding: 0.020, dinGap: 0, backplateGap: 0.020, glandSpacing: 0.040, sizePolicy: "auto" },
  { id: "ac", deviceId: "acJunction", label: "AC junction", minimumSize: [0.36, 0.44, 0.12], padding: 0.020, dinGap: 0, backplateGap: 0, glandSpacing: 0.040 },
];

const dseBaseConnections: readonly Connection[] = [
  w("pv-cutoff-combiner-positive", ep("pvCutoff", "positiveOut"), ep("pvCombiner", "positiveIn"), "positive", "pv4", { circuitId: "pv-combiner-link" }),
  w("pv-cutoff-combiner-negative", ep("pvCutoff", "negativeOut"), ep("pvCombiner", "negativeIn"), "negative", "pv4", { returnFor: "pv-cutoff-combiner-positive", circuitId: "pv-combiner-link" }),
  w("pv-spd-positive", ep("pvCombiner", "positiveOut"), ep("pvSurge", "positive"), "positive", "pv4", { circuitId: "pv-spd-tap" }),
  w("pv-spd-negative", ep("pvCombiner", "negativeOut"), ep("pvSurge", "negative"), "negative", "pv4", { returnFor: "pv-spd-positive", circuitId: "pv-spd-tap" }),
  w("switch-common-top-middle", ep("switchInternet", "common"), ep("switchOrion", "common"), "positive", "branch1.5"),
  w("switch-common-middle-bottom", ep("switchOrion", "common"), ep("switchLights", "common"), "positive", "branch1.5"),
  w("light-string-continuation", ep("lightSplice", "out"), ep("indoorLight2", "power"), "multicore", "light2"),
  w("light-middle-branch", ep("lightSplice", "branch"), ep("indoorLight", "power"), "multicore", "light2"),
  w("multiplus-v-sense-negative", ep("battery1", "negative"), ep("multiPlus", "voltageSenseNegative"), "control", "factory", { label: "V-sense − · A1 negative" }),
  w("pv-series-1-2", ep("panel1", "positive"), ep("panel2", "negative"), "positive", "pvWhite4", { seriesLink: true }),
  w("pv-series-2-3", ep("panel2", "positive"), ep("panel3", "negative"), "positive", "pvWhite4", { seriesLink: true }),
  w("pv-downlead-outside", ep("pvArrayBreakout", "cable"), ep("servicePenetration", "pvCableOutside"), "multicore", "pvWhitePair"),
  w("pv-downlead-inside", ep("servicePenetration", "pvCableInside"), ep("pvInputBreakout", "cable"), "multicore", "pvWhitePair"),
  w("pv-positive-outside", ep("panel3", "positive"), ep("pvArrayBreakout", "positive"), "positive", "pvWhite4", { bundleId: "pv-string", circuitId: "pv-outside" }),
  w("pv-positive-inside", ep("pvInputBreakout", "positive"), ep("pvCutoff", "positiveIn"), "positive", "pv4", { bundleId: "pv-string", circuitId: "pv-inside" }),
  w("pv-negative-outside", ep("panel1", "negative"), ep("pvArrayBreakout", "negative"), "negative", "pvWhite4", { bundleId: "pv-string", returnFor: "pv-positive-outside", circuitId: "pv-outside" }),
  w("pv-negative-inside", ep("pvInputBreakout", "negative"), ep("pvCutoff", "negativeIn"), "negative", "pv4", { bundleId: "pv-string", returnFor: "pv-positive-inside", circuitId: "pv-inside" }),
  w("pv-output-positive", ep("pvCombiner", "positiveOut"), ep("smartSolar", "pvPositive"), "positive", "pv4", { bundleId: "pv-mppt", circuitId: "pv-output" }),
  w("pv-output-negative", ep("pvCombiner", "negativeOut"), ep("smartSolar", "pvNegative"), "negative", "pv4", { bundleId: "pv-mppt", returnFor: "pv-output-positive", circuitId: "pv-output" }),
  w("pv-frame-outside", ep("solarRailLower", "earth"), ep("servicePenetration", "frameOutside"), "earth", "earth4"),
  w("pv-frame-inside", ep("servicePenetration", "frameInside"), ep("pvSurge", "earth"), "earth", "earth4"),

  w("battery-a-series", ep("battery1", "positive"), ep("battery2", "negative"), "positive", "dc2Battery", {
    seriesLink: true, sourceLeadReason: "Unfused battery-string series jumper; keep it shortest-practical, supported, guarded and separated from grounded metal throughout its route.",
  }),
  w("battery-b-series", ep("battery3", "positive"), ep("battery4", "negative"), "positive", "dc2Battery", {
    seriesLink: true, sourceLeadReason: "Unfused battery-string series jumper; keep it shortest-practical, supported, guarded and separated from grounded metal throughout its route.",
  }),
  w("battery-a-positive-breaker", ep("battery2", "positive"), ep("batteryBreakerA", "line"), "positive", "dc2Battery", {
    bundleId: "battery-a", circuitId: "battery-a", sourceLeadReason: "Battery-adjacent lead to the first string overcurrent device; keep it mechanically protected and as short as practicable.",
  }),
  w("battery-a-breaker-bus", ep("batteryBreakerA", "load"), ep("mainPositiveBus", "post1"), "positive", "dc2Battery", {
    sourceLeadReason: "Short guarded common-bus-to-string-breaker link; every other bus source can feed a cable fault, so minimize and protect this segment physically.",
  }),
  w("battery-b-positive-breaker", ep("battery4", "positive"), ep("batteryBreakerB", "line"), "positive", "dc2Battery", {
    bundleId: "battery-b", circuitId: "battery-b", sourceLeadReason: "Battery-adjacent lead to the first string overcurrent device; keep it mechanically protected and as short as practicable.",
  }),
  w("battery-b-breaker-bus", ep("batteryBreakerB", "load"), ep("mainPositiveBus", "post2"), "positive", "dc2Battery", {
    sourceLeadReason: "Short guarded common-bus-to-string-breaker link; every other bus source can feed a cable fault, so minimize and protect this segment physically.",
  }),
  w("battery-a-negative-shunt", ep("battery1", "negative"), ep("smartShunt", "batteryMinus"), "negative", "dc2Battery", {
    bundleId: "battery-a", returnFor: "battery-a-positive-breaker", circuitId: "battery-a",
    sourceLeadReason: "Battery-adjacent unfused return to SmartShunt BATTERY MINUS; route beside the protected positive lead and keep it shortest-practical, guarded and supported.",
  }),
  w("battery-b-negative-shunt", ep("battery3", "negative"), ep("smartShunt", "batteryMinus"), "negative", "dc2Battery", {
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

  w("mppt-positive-breaker", ep("smartSolar", "batteryPositive"), ep("mpptBreaker", "load"), "positive", "dc2", {
    bundleId: "mppt-dc", circuitId: "mppt-output", sourceLeadReason: "Short controller-output lead to the battery-side SmartSolar cutoff.",
  }),
  w("mppt-breaker-bus", ep("mpptBreaker", "line"), ep("mainPositiveBus", "post4"), "positive", "dc2", {
    sourceLeadReason: "Short guarded common-bus-to-SmartSolar-breaker link; keep the first-protector segment mechanically protected and as short as practicable.",
  }),
  w("mppt-negative-bus", ep("smartSolar", "batteryNegative"), ep("mainNegativeBus", "post2"), "negative", "dc2", { bundleId: "mppt-dc", returnFor: "mppt-positive-breaker", circuitId: "mppt-output" }),
  w("multiplus-positive", ep("mainPositiveBus", "post3"), ep("multiPlus", "dcPositive"), "positive", "battery53", {
    bundleId: "multiplus-dc", circuitId: "multiplus-dc",
    protectionApproval: { status: "accepted", basis: "approved-upstream-scheme", protectionDeviceIds: ["batteryBreakerA", "batteryBreakerB", "mpptBreaker"], note: MULTIPLUS_UPSTREAM_APPROVAL },
  }),
  w("multiplus-negative", ep("mainNegativeBus", "post3"), ep("multiPlus", "dcNegative"), "negative", "battery53", {
    bundleId: "multiplus-dc", returnFor: "multiplus-positive", circuitId: "multiplus-dc",
    protectionApproval: { status: "accepted", basis: "approved-upstream-scheme", protectionDeviceIds: ["batteryBreakerA", "batteryBreakerB", "mpptBreaker"], note: MULTIPLUS_UPSTREAM_APPROVAL },
  }),

  w("secondary-feeder-positive", ep("mainPositiveBus", "post4"), ep("secondaryPositiveBus", "post1"), "positive", "dc8Feeder", {
    circuitId: "secondary-feeder",
    status: "hold", holdReason: "Recorded red 8 AWG feeder with an M10 main-bus ring and direct #10 secondary-bus ring. No dedicated feeder breaker is modeled. Do not energize until an installer approves the retained upstream-protection scheme using both 120 A battery-string breaker curves and every contributing source, plus the 8 AWG hot/bundled ampacity, fault current, 100 A Blue Sea bus, lug fit, torque and local acceptance.",
  }),
  w("secondary-feeder-negative", ep("mainNegativeBus", "post4"), ep("secondaryNegativeBus", "post1"), "negative", "dc8Feeder", {
    returnFor: "secondary-feeder-positive", circuitId: "secondary-feeder",
    status: "hold", holdReason: "Recorded matching black 8 AWG M10-to-#10 return. Do not energize until an installer approves the 100 A Blue Sea bus, direct #10 ring geometry, torque, enclosure clearance, hot/bundled ampacity and full feeder protection coordination.",
  }),
  w("service-main", ep("secondaryPositiveBus", "post4"), ep("sharedServicesBreaker", "line"), "positive", "pv4", {
    sourceLeadReason: "Short enclosed bus-to-breaker tap; final coordination and physical protection remain required.",
  }),
  w("service-breaker-bus", ep("sharedServicesBreaker", "load"), ep("switchedServicesBus", "post1"), "positive", "branch1.5"),
  w("service-split", ep("switchedServicesBus", "post3"), ep("switchInternet", "common"), "positive", "branch1.5"),

  w("room-light-positive", ep("switchLights", "on"), ep("indoorLightBreakout", "positive"), "positive", "branch1.5", { circuitId: "room-light" }),
  w("room-light-negative", ep("secondaryNegativeBus", "post5"), ep("indoorLightBreakout", "negative"), "negative", "branch1.5", { returnFor: "room-light-positive", circuitId: "room-light" }),
  w("room-light-cable", ep("indoorLightBreakout", "cable"), ep("lightSplice", "in"), "multicore", "light2"),



  w("internet-switch-split", ep("switchInternet", "on"), ep("internetSplit", "in"), "positive", "branch1.5"),
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
  w("orion-remote-h", ep("switchOrion", "on"), ep("usbOrion", "remoteH"), "control", "branch1.5"),
  w("orion-output-socket-a", ep("usbOrion", "positiveOut"), ep("usbSocketA", "positive"), "positive", "socketHarness12", { circuitId: "orion-output-a" }),
  w("socket-a-b-positive", ep("usbSocketA", "positive"), ep("usbSocketB", "positive"), "positive", "socketHarness12", { circuitId: "socket-a-b" }),
  w("socket-negative-feed", ep("usbOrion", "ground"), ep("usbSocketA", "negative"), "negative", "socketHarness12", { returnFor: "orion-output-socket-a", circuitId: "orion-output-a" }),
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
  w("generator-white-cable", ep("generatorLeadBreakout", "cable"), ep("generatorAcBreakout", "cable"), "multicore", "ac3", {
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

  w("multiplus-chassis-earth", ep("multiPlus", "chassisEarth"), ep("pvSurge", "earth"), "earth", "dc16"),
  w("earth-electrode-outside", ep("earthElectrode", "clamp"), ep("earthPenetration", "outside"), "earth", "dc16"),
  w("earth-electrode-inside", ep("earthPenetration", "inside"), ep("multiPlus", "chassisEarth"), "earth", "dc16"),

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
          const kind = landing.kind;
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
    note: "At the deliberately conservative 19 V floor, 1.47 kW at 98% conversion is about 75.8 A; around nominal battery voltage the array is roughly a 60 A source. Exact 2 AWG / 33.6 mm² copper is the common high-current size and fits the AWG 2 maximum at both the SmartSolar and received 120 A cutoff. Confirm installation/temperature ampacity and received breaker AIC, terminal and torque evidence.",
  },
  {
    id: "multiplus-dc", label: "MultiPlus 24 V DC input/charger branch", deviceIds: ["multiPlus"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 1200, maximumCurrentA: 67.2, conductorAmpacityA: 120,
    normalStatus: "within-capacity", faultStatus: "accepted",
    note: `The revised one-tool rule caps normal AC load at 1.2 kW. At the conservative 19 V input floor and 94% efficiency, that is about 67.2 A DC (about 53.2 A at 24 V). The direct run remains 1/0 AWG. ${MULTIPLUS_UPSTREAM_APPROVAL}`,
  },
  {
    id: "secondary-feeder", label: "Main bus to secondary-services enclosure", deviceIds: ["secondaryPositiveBus", "secondaryNegativeBus", "smartSolar", "multiPlus", "usbOrion", "ekrano"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 990, maximumCurrentA: 52.2, conductorAmpacityA: 80,
    normalStatus: "within-capacity", faultStatus: "incomplete",
    note: "The user-selected 990 W future-work ceiling is about 41.3 A at 24 V and 52.2 A at the conservative 19 V floor, within the 80 A planning ampacity assigned to the 8 AWG feeder and below the 100 A secondary-bus rating. Both assemblies use direct M10-to-#10 closed rings. Commissioning remains held because no dedicated feeder breaker is modeled: approval must address both 120 A battery-string breaker curves, all contributing sources, hot/bundled cable ampacity, fault current and local acceptance.",
  },
  {
    id: "main-negative-trunk", label: "SmartShunt SYSTEM MINUS to main negative bus", deviceIds: ["smartShunt", "mainNegativeBus", "multiPlus", "secondaryNegativeBus", "smartSolar"],
    nominalVoltageV: 24, minimumVoltageV: 19, maximumWatts: 1385, maximumCurrentA: 72.9, conductorAmpacityA: 120,
    normalStatus: "conditional", faultStatus: "incomplete",
    note: "Under the posted controls, the 1.2 kW tool draws about 67.2 A at 19 V / 94% efficiency and essential shared services plus Ekrano add about 5.7 A, for a controlled 72.9 A maximum below the 120 A 1/0 envelope. Solar is not credited to this discharge limit. This remains conditional on ORION REMOTE H being off and the ChargeIT branch breaker being open during tool use; every installed DC branch at published maximum with the tool could reach about 115.0 A. Ekrano DVCC limits net battery charging to 88 A, the preferred 0.2 C ceiling for the 440 Ah bank. Fault/OCP and received termination evidence remain genuine holds.",
  },
  {
    id: "shared-services", label: "Shared lights + Starlink + UniFi services", deviceIds: ["indoorLight", "indoorLight2", "starlink", "unifi", "unifiPower", "switchInternet", "switchOrion", "switchLights"],
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
    note: "Two chargers can consume the Orion's complete 30 A continuous allowance, leaving no conductor headroom. The Orion permits 45 A for 10 seconds and 60 A into a short, so its regulator and charger output protections do not prove the 30 A socket harness can clear a fault; installed output-fault protection evidence is not recorded.",
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
    note: "Normal balance current is only 0.7 A and 1.5 mm² conductors exceed Victron's 0.75 mm² minimum. The leads still connect directly to high-energy battery points; Victron specifies 10 A near-battery fuses for UL installations, but the installed lead-protection evidence is not recorded.",
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
  revision: "R35 · Fulaga solar cable and rail record · 12 September 2026",
  site: {
    walls: [
      { id: "west", center: [-0.04, 1.60, 1.65], size: [0.035, 3.20, 3.30], normal: [1, 0, 0] },
      { id: "north", center: [1.90, 1.60, -0.04], size: [3.80, 3.20, 0.035], normal: [0, 0, 1] },
    ],
    roof: { center: [1.90, 3.24, 1.65], size: [3.80, 0.04, 3.30] },
    shelf: { center: [1.08, 1.20, 0.23], size: [1.50, 0.035, 0.46] },
    note: "Northwest installation corner. Arrangement follows the installed-system report and IMG_1402; distances, roof pitch and obscured positions are illustrative, not a measured survey.",
  },
  devices: dseDevices,
  cables: dseCables,
  connections: dseConnections,
  junctions: dseJunctions,
  currentSources: dseCurrentSources,
  powerCircuits: dsePowerCircuits,
};
