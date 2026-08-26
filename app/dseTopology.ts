import { conductor as p, connection as w, endpoint as ep } from "./systemGraph";
import type { Cable, Connection, Device, Junction, SystemGraph } from "./systemGraph";

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

const breaker = (
  id: string,
  label: string,
  junctionId: "batteryCutoffJunction" | "secondaryJunction",
  order: number,
  options: Partial<Device> = {},
): Device => ({
  id,
  label,
  kind: "breaker",
  size: [0.020, 0.082, 0.07],
  placement: inside(junctionId, "din", order),
  conductors: id === "sharedServicesBreaker" ? [
    p("line", "Supply", "positive", "bottom", {
      order: 0, gauge: "1.5–2.5 mm² · coordinate with selected 10 A device",
      terminal: "Selected 10 A DC breaker line clamp", terminalSize: "Select for 1.5–2.5 mm² fine-stranded copper",
      termination: "Bare fine-stranded copper or maker-approved ferrule", terminalDiameterMm: 5,
      terminalNote: "No breaker is selected yet. Verify DC voltage and interrupt ratings, polarity, conductor range, derating and torque before commissioning.",
    }),
    p("load", "Load", "positive", "top", {
      order: 0, gauge: "1.5–2.5 mm² · coordinate with selected 10 A device",
      terminal: "Selected 10 A DC breaker load clamp", terminalSize: "Select for 1.5–2.5 mm² fine-stranded copper",
      termination: "Bare fine-stranded copper or maker-approved ferrule", terminalDiameterMm: 5,
      terminalNote: "No breaker is selected yet. Verify DC voltage and interrupt ratings, polarity, conductor range, derating and torque before commissioning.",
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
  placement: wall([x, 1.34, 0.055]),
  componentId: "usb",
  layoutGroup: { id: "chargeit-minis", label: "ChargeIT! Mini chargers", columns: 4, order: layoutOrder },
  bomIds: ["dse-chargeit-mini-75"],
  purchaseUrl: CHARGEIT_75,
  status: "purchased",
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
    bomIds: ["dse-pv-protection"],
    status: "planned",
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

const panel = (id: string, label: string, position: readonly [number, number, number], layoutOrder: number): Device => ({
  id,
  label,
  kind: "panel",
  size: [2.279, 1.134, 0.035],
  placement: outside(position, PANEL_ROTATION),
  componentId: id,
  layoutGroup: { id: "pv-panels", label: "PV array", columns: 2, order: layoutOrder },
  bomIds: ["dse-panels"],
  status: "purchased",
  conductors: [
    p("positive", "PV +", "positive", "bottom", {
      diagramSide: "output",
      order: 0, gauge: "Factory 4 mm² lead", terminal: "Factory PV connector",
      terminalSize: "MC4 EVO2 / 01S / STP-XC4 family", termination: "Matching listed PV connector",
      terminalDiameterMm: 6, terminalNote: "Suntech specifies a 4 mm² output lead; verify the connector fitted to the received module before mating.",
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
  conductors: [
    p("positive", "Positive post", "positive", "top", {
      diagramSide: "output",
      order: 0, gauge: "1/0 AWG · 53.5 mm²", terminal: "F-M8 battery terminal",
      terminalSize: "M8 stud", termination: "1/0 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8,
      terminalNote: "EverExceed's ES200-12G table identifies F-M8 terminals; verify the received torque marking.",
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
  { id: "battery53", label: "1/0 AWG battery cable", cores: 1, outsideDiameterMm: 14.5, conductorSize: "53.5 mm²", sheath: "single" },
  { id: "dc35", label: "35 mm² DC cable", cores: 1, outsideDiameterMm: 11.8, conductorSize: "35 mm²", sheath: "single" },
  { id: "dc16", label: "16 mm² DC cable", cores: 1, outsideDiameterMm: 8.6, conductorSize: "16 mm²", sheath: "single" },
  { id: "dc10", label: "10 mm² DC cable", cores: 1, outsideDiameterMm: 7.2, conductorSize: "10 mm²", sheath: "single" },
  { id: "pv4", label: "4 mm² PV cable", cores: 1, outsideDiameterMm: 6.1, conductorSize: "4 mm²", sheath: "single" },
  { id: "service2.5", label: "2.5 mm² service conductor", cores: 1, outsideDiameterMm: 4.2, conductorSize: "2.5 mm²", sheath: "single" },
  { id: "branch5.26", label: "10 AWG protected branch conductor", cores: 1, outsideDiameterMm: 5.6, conductorSize: "10 AWG · 5.26 mm²", sheath: "single" },
  { id: "branch1.5", label: "1.5 mm² branch conductor", cores: 1, outsideDiameterMm: 3.4, conductorSize: "1.5 mm²", sheath: "single" },
  { id: "sense0.75", label: "0.75 mm² control conductor", cores: 1, outsideDiameterMm: 2.4, conductorSize: "0.75 mm²", sheath: "single" },
  { id: "ac3", label: "3-core 10 A AC cable", cores: 3, outsideDiameterMm: 9.8, conductorSize: "3 × 1.5 mm²", sheath: "white" },
  { id: "acCore1.5", label: "Exposed 1.5 mm² AC core", cores: 1, outsideDiameterMm: 3.4, conductorSize: "1.5 mm²", sheath: "single" },
  { id: "earth4", label: "4 mm² protective-earth conductor", cores: 1, outsideDiameterMm: 5.0, conductorSize: "4 mm²", sheath: "single" },
  { id: "pvComb", label: "PV breaker comb link", cores: 1, outsideDiameterMm: 6.5, conductorSize: "Received comb busbar · verify", sheath: "single" },
  { id: "light2", label: "2-core lighting cable", cores: 2, outsideDiameterMm: 6.4, conductorSize: "2 × 1.5 mm²", sheath: "white" },
  { id: "starlinkPower", label: "Starlink Mini two-core factory power cable", cores: 2, outsideDiameterMm: 6.0, conductorSize: "Factory multicore lead", sheath: "white" },
  { id: "usbCFactory", label: "Factory USB-C power cable", cores: 2, outsideDiameterMm: 4.0, conductorSize: "Factory multicore lead", sheath: "white" },
  { id: "socketHarness12", label: "YCIND socket 12 AWG duplex harness", cores: 1, outsideDiameterMm: 4.8, conductorSize: "12 AWG · 3.31 mm²", sheath: "single" },
  { id: "socketPlug", label: "Factory cigarette plug / socket connection", cores: 2, outsideDiameterMm: 8.0, conductorSize: "Factory two-core plug assembly", sheath: "white" },
  { id: "ethernet", label: "Ethernet / Victron data cable", cores: 1, outsideDiameterMm: 6.0, conductorSize: "Data", sheath: "single" },
  { id: "factory", label: "Factory device lead", cores: 1, outsideDiameterMm: 4.0, conductorSize: "Factory lead", sheath: "single" },
];

const dseBaseDevices: readonly Device[] = [
  // Leave one routing cell beyond each frame-junction halo between adjacent
  // modules. The geometry remains the same aligned two-panel array; the small
  // installation gap prevents a frame-bond tangent from entering its neighbour.
  panel("panel1", "PV panel 1 · string A", [-2.14, 0.38, -1.18], 0),
  panel("panel2", "PV panel 2 · string A", [-0.96, 0.75, -1.18], 1),
  panel("panel3", "PV panel 3 · string B", [-2.14, 0.38, 1.18], 2),
  panel("panel4", "PV panel 4 · string B", [-0.96, 0.75, 1.18], 3),

  {
    id: "pvJunction", label: "PV protection / combiner junction box", kind: "junction",
    size: [0.29, 0.38, 0.15], placement: wall([0.56, 1.12, 0.08]), componentId: "pvSafety",
    bomIds: ["dse-pv-protection", "dse-pv-string-breakers"], status: "planned", conductors: [],
  },
  {
    id: "pvBreakerA", label: "String A 20 A PV breaker", kind: "breaker", poles: 2,
    size: [0.040, 0.082, 0.070], placement: inside("pvJunction", "din", 0), componentId: "pvSafety",
    bomIds: ["dse-pv-string-breakers"], purchaseUrl: "https://www.amazon.com/dp/B0D4JR95Y4", status: "purchased", conductors: [
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
    bomIds: ["dse-pv-string-breakers"], purchaseUrl: "https://www.amazon.com/dp/B0D4JR95Y4", status: "purchased", conductors: [
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
      p("positiveOut", "+ out", "positive", "bottom", { order: 0, gauge: "4 mm²", terminal: "Disconnect screw clamp", terminalSize: "Verify received device", termination: "Maker-approved conductor/ferrule", terminalDiameterMm: 5.5 }),
      p("negativeOut", "− out", "negative", "bottom", { order: 1, gauge: "4 mm²", terminal: "Disconnect screw clamp", terminalSize: "Verify received device", termination: "Maker-approved conductor/ferrule", terminalDiameterMm: 5.5 }),
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
    placement: wall([1.36, 1.06, 0.052]), componentId: "solarController", bomIds: ["dse-smartsolar", "dse-mppt-wirebox-xl"],
    status: "purchased", technicalUrl: "https://www.victronenergy.com/solar-charge-controllers/smartsolar-mppt-ve.can", conductors: [
      p("pvPositive", "PV +", "positive", "bottom", { order: 0, diagramSide: "input", gauge: "4 mm²", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded copper; ferrule only if Victron accepts the selected size", terminalDiameterMm: 8 }),
      p("pvNegative", "PV −", "negative", "bottom", { order: 1, diagramSide: "input", gauge: "4 mm²", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded copper; ferrule only if Victron accepts the selected size", terminalDiameterMm: 8 }),
      p("batteryPositive", "Battery +", "positive", "bottom", { order: 2, diagramSide: "output", gauge: "35 mm²", terminal: "Victron screw terminal", terminalSize: "≤35 mm² / AWG 2", termination: "Fine-stranded 35 mm² copper", terminalDiameterMm: 9 }),
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
  breaker("batteryBreakerA", "String A cutoff · 120 A", "batteryCutoffJunction", 0, {
    subtitle: "DIHOOL DZ47X-125", componentId: "batteryBreakerA", bomIds: ["dse-battery-string-breakers"], purchaseUrl: DIHOOL_120, status: "purchased",
  }),
  breaker("batteryBreakerB", "String B cutoff · 120 A", "batteryCutoffJunction", 1, {
    subtitle: "DIHOOL DZ47X-125", componentId: "batteryBreakerB", bomIds: ["dse-battery-string-breakers"], purchaseUrl: DIHOOL_120, status: "purchased",
  }),
  breaker("mpptBreaker", "SmartSolar cutoff · 120 A", "batteryCutoffJunction", 2, {
    subtitle: "DIHOOL DZ47X-125", componentId: "mpptFuse", bomIds: ["dse-breaker-mnedc100"], purchaseUrl: DIHOOL_120, status: "purchased",
  }),
  {
    id: "mainPositiveBus", label: "Main 24 V positive bus · supplied insulating cover", kind: "busbar", size: [0.18, 0.060, 0.040],
    placement: wall([2.34, 0.30, 0.020]), componentId: "mainDistribution", bomIds: ["dse-main-busbars"], status: "purchased", color: "#b93131",
    terminalPitchByFaceM: { top: 0.040 }, conductors: [
      ...Array.from({ length: 4 }, (_, index) => p(`post${index + 1}`, `Positive stud ${index + 1}`, "positive", "top", {
        order: index,
        terminal: "Joinfworld covered high-current stud",
        terminalSize: "3/8 in / M10-class stud",
        termination: "Closed tinned-copper 3/8 in / M10 ring lug",
        terminalDiameterMm: 10,
        terminalNote: index === 3
          ? "The MPPT, held direct 1/0 secondary feeder and factory-fused SmartShunt sense lead share this final stud through the explicit adjacent splits shown. Lug stacking and clearance under the supplied cover are approved; upstream feeder protection coordination remains a separate engineering hold."
          : "Use one field termination per modeled landing and the received busbar torque specification.",
      })),
    ],
  },
  {
    id: "smartShunt", label: "Victron SmartShunt IP65 500 A", kind: "monitor", size: [0.12, 0.055, 0.045],
    placement: wall([0.98, 0.43, 0.025]), componentId: "mainDistribution", bomIds: ["dse-shunt"], status: "purchased", conductors: [
      p("batteryMinus", "Battery minus", "negative", "left", { gauge: "1/0 AWG · 53.5 mm²", terminal: "SmartShunt battery bolt", terminalSize: "M10", termination: "1/0 AWG tinned-copper M10 closed lug", terminalDiameterMm: 10 }),
      p("systemMinus", "System minus", "negative", "right", { gauge: "1/0 AWG · 53.5 mm²", terminal: "SmartShunt system bolt", terminalSize: "M10", termination: "1/0 AWG tinned-copper M10 closed lug", terminalDiameterMm: 10 }),
      p("vBattPlus", "Vbatt+ sense", "positive", "top", { order: 0, gauge: "Factory fused lead", terminal: "SmartShunt auxiliary sense lead", terminalSize: "M10 ring eye supplied", termination: "Factory fused M10 ring-eye lead", terminalDiameterMm: 5 }),
      p("veDirect", "VE.Direct", "data", "front", { order: 0, terminal: "VE.Direct receptacle", terminalSize: "Victron VE.Direct", termination: "Factory VE.Direct cable", terminalDiameterMm: 7 }),
    ],
  },
  {
    id: "mainNegativeBus", label: "Main system-negative bus · supplied insulating cover", kind: "busbar", size: [0.18, 0.060, 0.040],
    placement: wall([1.24, 0.43, 0.020]), componentId: "mainDistribution", bomIds: ["dse-main-busbars"], status: "purchased", color: "#252c32",
    terminalPitchByFaceM: { top: 0.040 }, conductors: [
      ...Array.from({ length: 4 }, (_, index) => p(`post${index + 1}`, `Negative stud ${index + 1}`, "negative", "top", {
        order: index,
        terminal: "Joinfworld covered high-current stud",
        terminalSize: "3/8 in / M10-class stud",
        termination: "Closed tinned-copper 3/8 in / M10 ring lug",
        terminalDiameterMm: 10,
        terminalNote: "This bus is on the SmartShunt SYSTEM MINUS side. Never land a battery negative here or any load on the BATTERY MINUS side.",
      })),
    ],
  },
  {
    id: "secondaryJunction", label: "Secondary 24 V services junction box · verified 302 × 302 × 178 mm", kind: "junction", size: [0.30, 0.30, 0.18],
    physicalSize: [0.302, 0.302, 0.178],
    placement: wall([2.56, 0.70, 0.09]), componentId: "secondaryDistribution",
    bomIds: ["dse-ventilated-ip65-enclosure", "dse-pg11-cable-glands", "dse-din-rail-pack"], status: "purchased", conductors: [],
  },
  breaker("sharedServicesBreaker", "Shared switched services · 10 A · 240 W", "secondaryJunction", 0, {
    componentId: "secondaryDistribution", bomIds: ["dse-switched-load-breaker"], status: "hold",
    holdReason: "The previous B10 geometry had no current selected BOM part. Select a correctly rated DC breaker and verify polarity, interrupt capacity, terminal range and torque before commissioning.",
  }),
  breaker("orionBreaker32", "Orion input · 32 A", "secondaryJunction", 1, {
    componentId: "secondaryDistribution", bomIds: ["dse-orion-input-breaker"], purchaseUrl: CHTAIXI_32, status: "purchased",
  }),
  breaker("chargeItBreaker32", "ChargeIT! branch · 32 A", "secondaryJunction", 2, {
    componentId: "secondaryDistribution", bomIds: ["dse-chargeit-branch-breaker"], purchaseUrl: CHTAIXI_32, status: "purchased",
  }),
  {
    id: "secondaryPositiveBus", label: "Secondary 24 V positive bus · 100 A", kind: "busbar", size: [0.12, 0.040, 0.030],
    placement: inside("secondaryJunction", "power", 1), componentId: "secondaryDistribution", color: "#b93131",
    bomIds: ["dse-service-return-bus-spares"], status: "purchased", conductors: [
      ...Array.from({ length: 7 }, (_, index) => p(`post${index + 1}`, `Secondary positive ${index < 2 ? "stud" : "screw"} ${index + 1}`, "positive", index < 2 ? "bottom" : "top", {
        order: index < 2 ? index : index - 2,
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
    placement: inside("secondaryJunction", "power", 0), componentId: "secondaryDistribution", color: "#252c32", bomIds: ["dse-service-return-bus"], status: "purchased", conductors: [
      ...Array.from({ length: 7 }, (_, index) => p(`post${index + 1}`, `Secondary negative ${index < 2 ? "stud" : "screw"} ${index + 1}`, "negative", index < 2 ? "bottom" : "top", {
        order: index < 2 ? index : index - 2,
        gauge: index === 0 ? "1/0 AWG · 53.5 mm² · field-procured" : undefined,
        terminal: index < 2 ? "Blue Sea 2314 stud" : "Blue Sea 2314 screw",
        terminalSize: index < 2 ? "#10-32 stud" : "#8-32 screw",
        termination: index === 0
          ? "Engineer-approved 1/0 AWG to #10-32 listed transition · selection hold"
          : index < 2 ? "Closed #10 ring terminal" : "Closed #8 ring terminal",
        terminalDiameterMm: index < 2 ? 4.8 : 4.2,
        terminalNote: index === 0
          ? "Direct field-procured 1/0 return landing. Verify the 100 A bus rating, #10-32 hardware, lug/transition fit, torque and enclosure clearance before energizing."
          : undefined,
      })),
    ],
  },
  ...[
    ["serviceReturnSplit", "Secondary service-return split", "lighting", "Lighting returns", "internet", "Internet returns"],
    ["lightingReturnSplit", "Indoor / outdoor light return split", "indoor", "Indoor light −", "outdoor", "Outdoor light −"],
    ["internetReturnSplit", "Starlink / UniFi return split", "starlink", "Starlink −", "unifi", "UniFi converter −"],
  ].map(([id, label, firstId, firstLabel, secondId, secondLabel], order): Device => ({
    id, label, kind: "connector", presentation: "service-splice", diagramPresentation: "join", size: [0.040, 0.024, 0.030],
    placement: inside("secondaryJunction", "backplate", [2, 6, 7][order]), componentId: "secondaryDistribution",
    bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("in", "Secondary negative trunk", "negative", "left", {
        order: 0, gauge: "1.5–2.5 mm²", terminal: "WAGO 221-413 lever splice",
        terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; WAGO does not require a ferrule", terminalDiameterMm: 4,
      }),
      p(firstId, firstLabel, "negative", "right", {
        order: 0, gauge: "1.5–2.5 mm²", terminal: "WAGO 221-413 lever splice",
        terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; WAGO does not require a ferrule", terminalDiameterMm: 4,
      }),
      p(secondId, secondLabel, "negative", "right", {
        order: 1, gauge: "1.5–2.5 mm²", terminal: "WAGO 221-413 lever splice",
        terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; WAGO does not require a ferrule", terminalDiameterMm: 4,
      }),
    ],
  })),
  {
    id: "serviceSplit", label: "Shared service positive split", kind: "connector", presentation: "service-splice", diagramPresentation: "join", size: [0.040, 0.024, 0.030],
    placement: inside("secondaryJunction", "backplate", 0), componentId: "switchedSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("in", "10 A feed", "positive", "left"), p("switches", "Six-gang feed", "positive", "right", { order: 0 }), p("room", "Room-switch feed", "positive", "right", { order: 1 }),
    ],
  },
  {
    id: "internetSplit", label: "Starlink / UniFi positive split", kind: "connector", presentation: "service-splice", diagramPresentation: "join", size: [0.040, 0.024, 0.030],
    placement: inside("secondaryJunction", "backplate", 1), componentId: "internetSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("in", "Switched feed", "positive", "left"), p("starlink", "Starlink +", "positive", "right", { order: 0 }), p("unifi", "UniFi converter +", "positive", "right", { order: 1 }),
    ],
  },
  {
    id: "unifiPower", label: "UniFi 24 V to USB-C converter", kind: "converter", size: [0.075, 0.040, 0.025],
    placement: inside("secondaryJunction", "backplate", 5), componentId: "unifiPower", bomIds: ["dse-unifi-converter", "dse-unifi-usb-cable"], status: "purchased", conductors: [
      p("positiveIn", "24 V + in", "positive", "bottom", { order: 0 }), p("negativeIn", "24 V − in", "negative", "bottom", { order: 1 }),
      p("usbC", "USB-C power out", "multicore", "top", { terminal: "USB-C receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C cable", terminalDiameterMm: 8 }),
    ],
  },
  {
    id: "starlinkBreakout", label: "Starlink factory-lead breakout", kind: "connector", presentation: "cable-breakout", diagramPresentation: "join", size: [0.060, 0.034, 0.022],
    placement: inside("secondaryJunction", "backplate", 3), componentId: "internetSplit", bomIds: ["dse-switch-connectors"], status: "planned", conductors: [
      p("positive", "Starlink + core", "positive", "top", { order: 0, gauge: "Factory lead", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["cable"] }),
      p("negative", "Starlink − core", "negative", "top", { order: 1, gauge: "Factory lead", terminal: "WAGO 221 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["cable"] }),
      p("cable", "Starlink factory power cable", "multicore", "back", { terminal: "Factory two-core cable", terminalSize: "Complete Starlink Mini power lead", termination: "Strain relief / factory connector", terminalDiameterMm: 6, internalMates: ["positive", "negative"] }),
    ],
  },
  twoCoreBreakout("outdoorLightBreakout", "Outdoor-light two-core breakout", inside("secondaryJunction", "backplate", 4)),
  {
    id: "switchPanel", label: "Six-gang service switch panel", subtitle: "1 Internet · 2 outdoor light · 3 Orion H · 4–6 spare", kind: "switch",
    size: [0.19, 0.085, 0.045], placement: inside("secondaryJunction", "backplate", 8), componentId: "loadSwitches", bomIds: ["dse-switch-array"], status: "purchased", conductors: [
      p("common", "Common 24 V feed", "positive", "back", { order: 0 }),
      p("internet", "Switch 1 · Starlink + UniFi", "positive", "back", { order: 1 }), p("outdoor", "Switch 2 · outdoor light", "positive", "back", { order: 2 }),
      p("orionH", "Switch 3 · Orion H remote", "control", "back", { order: 5 }), p("spare4", "Switch 4 · spare", "positive", "back", { order: 3, optional: true }),
      p("spare5", "Switch 5 · spare", "positive", "back", { order: 4, optional: true }), p("spare6", "Switch 6 · spare", "positive", "back", { order: 6, optional: true }),
    ],
  },

  // The two strings stay parallel in plan, but both rows move closer to the
  // equipment wall. Their positive ends align below the cutoff box and their
  // negative ends align below the SmartShunt, minimizing the four unprotected
  // 1/0 AWG battery leads without lengthening either adjacent series jumper.
  battery("battery1", "Battery 1 · string A lower", [1.32, 0.16, 0.28], "battery1", 0),
  battery("battery2", "Battery 2 · string A upper", [1.90, 0.16, 0.28], "battery2", 1),
  battery("battery3", "Battery 3 · string B lower", [1.32, 0.16, 0.54], "battery3", 2),
  battery("battery4", "Battery 4 · string B upper", [1.90, 0.16, 0.54], "battery4", 3),
  {
    id: "balancerA", label: "Victron battery balancer A", kind: "converter", size: [0.113, 0.100, 0.047], placement: wall([0.83, 0.82, 0.024]),
    componentId: "balancers", bomIds: ["dse-balancers"], status: "purchased", conductors: [
      p("positive", "String +", "positive", "bottom", { order: 0 }), p("midpoint", "12 V midpoint", "positive", "bottom", { order: 1 }), p("negative", "String −", "negative", "bottom", { order: 2 }),
    ],
  },
  {
    id: "balancerB", label: "Victron battery balancer B", kind: "converter", size: [0.113, 0.100, 0.047], placement: wall([1.00, 0.82, 0.024]),
    componentId: "balancers", bomIds: ["dse-balancers"], status: "purchased", conductors: [
      p("positive", "String +", "positive", "bottom", { order: 0 }), p("midpoint", "12 V midpoint", "positive", "bottom", { order: 1 }), p("negative", "String −", "negative", "bottom", { order: 2 }),
    ],
  },
  {
    id: "multiPlus", label: "Victron MultiPlus-II 24/3000", kind: "inverter", size: [0.268, 0.499, 0.141], placement: wall([1.84, 1.50, 0.071]),
    componentId: "inverter", bomIds: ["dse-multiplus"], status: "purchased", conductors: [
      p("dcPositive", "Battery +", "positive", "bottom", { order: 0, gauge: "1/0 AWG · 53.5 mm²", terminal: "Victron DC bolt", terminalSize: "M8", termination: "1/0 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8, terminalNote: "Victron specifies 12 N·m for the M8 DC connection." }),
      p("dcNegative", "Battery −", "negative", "bottom", { order: 1, gauge: "1/0 AWG · 53.5 mm²", terminal: "Victron DC bolt", terminalSize: "M8", termination: "1/0 AWG tinned-copper M8 closed lug", terminalDiameterMm: 8, terminalNote: "Victron specifies 12 N·m for the M8 DC connection." }),
      p("acInLine", "AC input L", "ac-line", "bottom", { order: 2, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6 }),
      p("acInNeutral", "AC input N", "ac-neutral", "bottom", { order: 3, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6 }),
      p("acInEarth", "AC input PE", "earth", "bottom", { order: 4, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Green/yellow fine-stranded copper", terminalDiameterMm: 6 }),
      p("acOutLine", "AC output L", "ac-line", "bottom", { order: 5, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6 }),
      p("acOutNeutral", "AC output N", "ac-neutral", "bottom", { order: 6, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Fine-stranded copper; approved ferrule if used", terminalDiameterMm: 6 }),
      p("acOutEarth", "AC output PE", "earth", "bottom", { order: 7, gauge: "1.5 mm²", terminal: "Victron AC screw terminal", terminalSize: "≤13 mm² / 6 AWG", termination: "Green/yellow fine-stranded copper", terminalDiameterMm: 6 }),
      p("chassisEarth", "Chassis PE", "earth", "bottom", { order: 8, gauge: "16 mm²", terminal: "Primary chassis-earth bolt", terminalSize: "M6", termination: "16 mm² tinned-copper M6 closed lug", terminalDiameterMm: 6 }),
      p("veBus", "VE.Bus", "data", "right", { order: 0, terminal: "RJ45 VE.Bus receptacle", terminalSize: "8P8C / RJ45", termination: "Factory Victron RJ45 cable", terminalDiameterMm: 9 }),
    ],
  },
  acBreakout("multiAcInBreakout", "MultiPlus AC-in cable breakout", wall([1.78, 1.10, 0.018]), "bottom", "top"),
  acBreakout("multiAcOutBreakout", "MultiPlus AC-out cable breakout", wall([1.92, 1.10, 0.018]), "bottom", "top"),
  {
    id: "acJunction", label: "AC input / output protection box", kind: "junction", size: [0.52, 0.32, 0.22], placement: wall([0.96, 1.60, 0.115]),
    componentId: "acBoard", bomIds: ["dse-ac-install-enclosure", "dse-ac-rcbo"], status: "hold", conductors: [],
    holdReason: "The purchased 200 × 155 × 92 mm enclosure is too small for this clean backplate layout. Select and mock up a larger IP-rated box; final 10 A / 30 mA Type A RCBO + SPD assemblies require qualified-installer approval.",
  },
  {
    id: "acInputProtection", label: "AC-in 10 A Type A RCBO + SPD", kind: "protection", poles: 4, size: [0.080, 0.085, 0.070], placement: inside("acJunction", "din", 0),
    componentId: "generatorInput", bomIds: ["dse-ac-rcbo"], status: "hold", conductors: [
      p("lineIn", "Generator L", "ac-line", "bottom", { order: 0, gauge: "1.5 mm²", terminal: "DIHOOL line screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("neutralIn", "Generator N", "ac-neutral", "bottom", { order: 1, gauge: "1.5 mm²", terminal: "DIHOOL neutral screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("earth", "SPD protective earth", "earth", "bottom", { order: 2, gauge: "1.5 mm²", terminal: "DIHOOL ground screw clamp", terminalSize: "≤6 mm² per manufacturer page", termination: "Green/yellow core; ferrule only if accepted", terminalDiameterMm: 6, terminalNote: "This is the SPD earth landing, not a switched neutral or an N–PE bond." }),
      p("lineOut", "Protected L", "ac-line", "top", { order: 0, gauge: "1.5 mm²", terminal: "DIHOOL line screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("neutralOut", "Protected N", "ac-neutral", "top", { order: 1, gauge: "1.5 mm²", terminal: "DIHOOL neutral screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
    ],
    holdReason: "Purchased DIHOOL units are marked 30 A and the official Type A page lists residual-current variants beginning at 50 mA. Do not commission until the exact received unit is verified or exchanged for approved 10 A / 30 mA protection.",
  },
  {
    id: "acOutputProtection", label: "AC-out 10 A Type A RCBO + SPD", kind: "protection", poles: 4, size: [0.080, 0.085, 0.070], placement: inside("acJunction", "din", 1),
    componentId: "acBoard", bomIds: ["dse-ac-rcbo"], status: "hold", conductors: [
      p("lineIn", "MultiPlus L", "ac-line", "bottom", { order: 0, gauge: "1.5 mm²", terminal: "DIHOOL line screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("neutralIn", "MultiPlus N", "ac-neutral", "bottom", { order: 1, gauge: "1.5 mm²", terminal: "DIHOOL neutral screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("earth", "SPD protective earth", "earth", "bottom", { order: 2, gauge: "1.5 mm²", terminal: "DIHOOL ground screw clamp", terminalSize: "≤6 mm² per manufacturer page", termination: "Green/yellow core; ferrule only if accepted", terminalDiameterMm: 6, terminalNote: "This is the SPD earth landing; protective earth is continuous through a separate PE splice and is never switched." }),
      p("lineOut", "Socket L", "ac-line", "top", { order: 0, gauge: "1.5 mm²", terminal: "DIHOOL line screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
      p("neutralOut", "Socket N", "ac-neutral", "top", { order: 1, gauge: "1.5 mm²", terminal: "DIHOOL neutral screw clamp", terminalSize: "Verify received device", termination: "Approved 1.5 mm² ferrule if accepted", terminalDiameterMm: 5 }),
    ],
    holdReason: "Purchased DIHOOL units are marked 30 A and the official Type A page lists residual-current variants beginning at 50 mA. Do not commission until the exact received unit is verified or exchanged for approved 10 A / 30 mA protection.",
  },
  acBreakout("generatorAcBreakout", "Generator-input cable breakout", inside("acJunction", "backplate", 0)),
  acBreakout("acInputCableBreakout", "Protected AC-in cable breakout", inside("acJunction", "backplate", 3)),
  acBreakout("acOutputCableBreakout", "MultiPlus-output cable breakout", inside("acJunction", "backplate", 4)),
  acBreakout("toolAcBreakout", "Trailing-tool cable breakout", inside("acJunction", "backplate", 6)),
  {
    id: "acInputPeSpliceA", label: "AC-in PE daisy splice A", kind: "connector", diagramPresentation: "join", size: [0.055, 0.026, 0.022],
    placement: inside("acJunction", "backplate", 1), componentId: "acBoard", bomIds: ["dse-terms"], status: "planned", conductors: [
      ...["incoming", "spd", "onward"].map((id, order) => p(id, id === "incoming" ? "Generator PE" : id === "spd" ? "RCBO/SPD PE" : "PE onward", "earth", order === 0 ? "left" : "right", { order, gauge: "1.5 mm²", terminal: "WAGO 221-413 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["incoming", "spd", "onward"].filter((peer) => peer !== id) })),
    ],
  },
  {
    id: "acInputPeSpliceB", label: "AC-in PE daisy splice B", kind: "connector", diagramPresentation: "join", size: [0.055, 0.026, 0.022],
    placement: inside("acJunction", "backplate", 2), componentId: "acBoard", bomIds: ["dse-terms"], status: "planned", conductors: [
      ...["incoming", "multiplus", "mainBond"].map((id, order) => p(id, id === "incoming" ? "PE from splice A" : id === "multiplus" ? "MultiPlus AC-in PE" : "Main PE bond", "earth", order === 0 ? "left" : "right", { order, gauge: id === "mainBond" ? "4 mm²" : "1.5 mm²", terminal: "WAGO 221-413 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["incoming", "multiplus", "mainBond"].filter((peer) => peer !== id) })),
    ],
  },
  {
    id: "acOutputPeSplice", label: "AC-out PE daisy splice", kind: "connector", diagramPresentation: "join", size: [0.055, 0.026, 0.022],
    placement: inside("acJunction", "backplate", 5), componentId: "acBoard", bomIds: ["dse-terms"], status: "planned", conductors: [
      ...["multiplus", "spd", "tool"].map((id, order) => p(id, id === "multiplus" ? "MultiPlus AC-out PE" : id === "spd" ? "RCBO/SPD PE" : "Tool-outlet PE", "earth", order === 0 ? "left" : "right", { order, gauge: "1.5 mm²", terminal: "WAGO 221-413 lever splice", terminalSize: "0.14–4 mm² fine-stranded", termination: "Bare stripped conductor; no ferrule required", terminalDiameterMm: 4, internalMates: ["multiplus", "spd", "tool"].filter((peer) => peer !== id) })),
    ],
  },
  {
    id: "servicePenetration", label: "Single inside / outside service penetration", kind: "connector", presentation: "wall-passthrough", size: [0.280, 0.180, 0.045], placement: wall([0.30, 0.78, 0]),
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
    id: "generator", label: "Existing Husqvarna G3200P", kind: "generator", presentation: "integrated-cable-breakout",
    size: [0.60, 0.56, 0.48], placement: outside([0.58, 0.30, -0.72]),
    terminalPitchByFaceM: { right: 0.040 },
    componentId: "generator", status: "existing", conductors: [
      p("line", "Internal active core", "ac-line", "right", { order: 0, optional: true, terminal: "Generator active contact", terminalSize: "AS/NZS 3112 / Type I outlet core", termination: "Internal/factory contact", terminalDiameterMm: 5, internalMates: ["cable"] }),
      p("neutral", "Internal neutral core", "ac-neutral", "right", { order: 2, optional: true, terminal: "Generator neutral contact", terminalSize: "AS/NZS 3112 / Type I outlet core", termination: "Internal/factory contact", terminalDiameterMm: 5, internalMates: ["cable"] }),
      p("earth", "Internal protective-earth core", "earth", "right", { order: 3, optional: true, terminal: "Generator earth contact", terminalSize: "AS/NZS 3112 / Type I outlet core", termination: "Internal/factory contact", terminalDiameterMm: 5, internalMates: ["cable"] }),
      // The multicore sheath lands between the three internal cores so the
      // generic ±45°/0° Y fans out monotonically instead of crossing itself.
      p("cable", "Generator 3-core output cable", "multicore", "right", { order: 1, terminal: "Type I plug / three-core flexible cord", terminalSize: "10 A 230 V assembly", termination: "Complete factory or approved trailing lead", terminalDiameterMm: 9.8, internalMates: ["line", "neutral", "earth"] }),
    ],
  },
  {
    id: "toolOutlet", label: "Type I trailing tool outlet", kind: "load", presentation: "integrated-cable-breakout",
    size: [0.085, 0.060, 0.040], placement: wall([1.16, 1.28, 0.025]),
    componentId: "toolOutlet", bomIds: ["dse-tool-lead"], status: "planned", conductors: [
      p("line", "Internal active / L", "ac-line", "top", { order: 0, optional: true, terminal: "Type I active contact", terminalSize: "AS/NZS 3112", termination: "Internal/factory contact", terminalDiameterMm: 5, internalMates: ["cable"] }),
      p("neutral", "Internal neutral / N", "ac-neutral", "top", { order: 1, optional: true, terminal: "Type I neutral contact", terminalSize: "AS/NZS 3112", termination: "Internal/factory contact", terminalDiameterMm: 5, internalMates: ["cable"] }),
      p("earth", "Internal earth / PE", "earth", "top", { order: 2, optional: true, terminal: "Type I earth contact", terminalSize: "AS/NZS 3112", termination: "Internal/factory contact", terminalDiameterMm: 5, internalMates: ["cable"] }),
      p("cable", "White three-core trailing lead", "multicore", "bottom", { order: 3, gauge: "3 × 1.5 mm²", terminal: "Moulded/approved flexible cord", terminalSize: "10 A Type I assembly", termination: "Complete strain-relieved cable", terminalDiameterMm: 9.8, internalMates: ["line", "neutral", "earth"] }),
    ],
  },
  {
    id: "earthBar", label: "Main protective-earth busbar", kind: "earth", size: [0.18, 0.030, 0.030], placement: wall([2.14, 1.16, 0.018]),
    componentId: "earthBus", bomIds: ["dse-earth-busbar"], status: "purchased", conductors: [
      ...Array.from({ length: 8 }, (_, index) => p(`post${index + 1}`, `PE ${index < 2 ? "stud" : "screw"} ${index + 1}`, "earth", index < 4 ? "top" : "bottom", {
        order: index % 4,
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
    id: "ekrano", label: "Victron Ekrano GX", kind: "monitor", size: [0.187, 0.124, 0.030], placement: wall([3.26, 1.66, 0.015]),
    terminalPitchByFaceM: { bottom: 0.040 },
    componentId: "systemMonitor", bomIds: ["dse-ekrano-gx", "dse-vedirect-cables", "dse-vebus-cable", "dse-ekrano-ethernet"], status: "purchased", conductors: [
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
    componentId: "starlink", status: "existing", conductors: [
      p("power", "Factory DC power lead", "multicore", "bottom", { order: 0, terminal: "Starlink Mini DC power connector", terminalSize: "Factory two-core lead", termination: "Complete Starlink power cable", terminalDiameterMm: 6, internalMates: ["positive", "negative"] }),
      p("ethernet", "Ethernet", "data", "bottom", { order: 1, terminal: "RJ45 Ethernet receptacle", terminalSize: "8P8C / RJ45", termination: "Outdoor-rated Ethernet lead", terminalDiameterMm: 9 }),
    ],
  },
  {
    id: "unifi", label: "UniFi Express", kind: "load", size: [0.098, 0.098, 0.030], placement: wall([3.58, 1.66, 0.015]),
    componentId: "router", bomIds: ["dse-router"], status: "purchased", conductors: [
      p("usbC", "USB-C power", "multicore", "bottom", { order: 0, terminal: "USB-C power receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C cable", terminalDiameterMm: 8 }),
      p("ethernetStarlink", "WAN / Starlink", "data", "bottom", { order: 1, terminal: "RJ45 WAN receptacle", terminalSize: "8P8C / RJ45", termination: "Factory Ethernet patch cable", terminalDiameterMm: 9 }),
      p("ethernetEkrano", "LAN / Ekrano", "data", "bottom", { order: 2, terminal: "RJ45 LAN receptacle", terminalSize: "8P8C / RJ45", termination: "Factory Ethernet patch cable", terminalDiameterMm: 9 }),
    ],
  },
  {
    id: "usbOrion", label: "Victron Orion-Tr Smart 24/12-30", kind: "converter", size: [0.130, 0.186, 0.055], placement: wall([2.92, 0.96, 0.028]),
    componentId: "orionUsb", bomIds: ["dse-orion-usb-converter"], status: "purchased", technicalUrl: "https://www.victronenergy.com/dc-dc-converters/orion-tr-smart", conductors: [
      p("remoteH", "Remote H", "control", "bottom", { order: 0, gauge: "0.75 mm²", terminal: "Orion remote H screw clamp", terminalSize: "Verify received remote connector", termination: "0.75 mm² bootlace ferrule if accepted", terminalDiameterMm: 4, terminalNote: "The six-gang switch applies positive to H; L remains unused." }),
      p("positiveIn", "+ input · 24 V", "positive", "bottom", { order: 1, gauge: "6 mm²", terminal: "Orion power screw clamp", terminalSize: "Fine-stranded copper terminal", termination: "Bare fine-stranded copper; ferrule is not required by Victron", terminalDiameterMm: 7, terminalNote: "Victron's 24 V table recommends 6 mm² for a 1–2 m run; terminal torque is 1.6 N·m." }),
      p("ground", "Common ground / −", "negative", "bottom", { order: 2, gauge: "10 mm²", terminal: "Orion common-negative screw clamp", terminalSize: "Fine-stranded copper terminal", termination: "Bare fine-stranded copper; ferrule is not required by Victron", terminalDiameterMm: 8, terminalNote: "This single common negative is shared by input and output in the non-isolated model; terminal torque is 1.6 N·m." }),
      p("positiveOut", "+ output · 12 V", "positive", "bottom", { order: 3, gauge: "10 mm²", terminal: "Orion output screw clamp", terminalSize: "Fine-stranded copper terminal", termination: "Bare fine-stranded copper; ferrule is not required by Victron", terminalDiameterMm: 8, terminalNote: "Victron's 12 V table recommends 10 mm² for a 1–2 m run; terminal torque is 1.6 N·m." }),
    ],
  },
  {
    id: "usbSocketA", label: "12 V cigarette-lighter socket A", kind: "connector", size: [0.052, 0.072, 0.048], placement: wall([3.18, 1.05, 0.024]),
    componentId: "usb", bomIds: ["dse-usb-sockets"], status: "purchased", conductors: [
      p("positive", "Rear centre-positive lead", "positive", "bottom", { order: 0, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory red pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8, terminalNote: "This terminal carries the downstream socket as well as socket A; retain any integral protection and obtain installer approval." }),
      p("negative", "Rear shell-negative lead", "negative", "bottom", { order: 1, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory black pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("socket", "12 V accessory receptacle", "multicore", "front", { terminal: "SAE J563-style accessory socket", terminalSize: "Centre positive / shell negative", termination: "Mating Coolgear cigarette plug", terminalDiameterMm: 21, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
    ],
  },
  {
    id: "usb145A", label: "Coolgear 145 W charger A", kind: "load", size: [0.052, 0.040, 0.092], placement: wall([3.18, 1.05, 0.100]),
    componentId: "usb", layoutGroup: { id: "coolgear-145", label: "Coolgear 145 W chargers", columns: 2, order: 0 },
    bomIds: ["dse-usb"], purchaseUrl: COOLGEAR_145, status: "purchased", conductors: [
      p("plug", "Factory cigarette-lighter plug", "multicore", "back", { terminal: "Cigarette-lighter plug", terminalSize: "Centre positive / shell negative", termination: "Mates directly with wall socket", terminalDiameterMm: 20, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
      p("usbC1", "USB-C 1", "multicore", "front", { order: 0, optional: true, terminal: "USB-C receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C plug", terminalDiameterMm: 8 }),
      p("usbC2", "USB-C 2", "multicore", "front", { order: 1, optional: true, terminal: "USB-C receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C plug", terminalDiameterMm: 8 }),
    ],
  },
  {
    id: "usbSocketB", label: "12 V cigarette-lighter socket B", kind: "connector", size: [0.052, 0.072, 0.048], placement: wall([3.48, 1.05, 0.024]),
    componentId: "usb", bomIds: ["dse-usb-sockets"], status: "purchased", conductors: [
      p("positive", "Rear centre-positive lead", "positive", "bottom", { order: 0, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory red pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("negative", "Rear shell-negative lead", "negative", "bottom", { order: 1, gauge: "12 AWG · 3.31 mm²", terminal: "YCIND factory black pigtail", terminalSize: "12 AWG received harness", termination: "Sealed listed splice after received-part inspection", terminalDiameterMm: 4.8 }),
      p("socket", "12 V accessory receptacle", "multicore", "front", { terminal: "SAE J563-style accessory socket", terminalSize: "Centre positive / shell negative", termination: "Mating Coolgear cigarette plug", terminalDiameterMm: 21, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
    ],
  },
  {
    id: "usb145B", label: "Coolgear 145 W charger B", kind: "load", size: [0.052, 0.040, 0.092], placement: wall([3.48, 1.05, 0.100]),
    componentId: "usb", layoutGroup: { id: "coolgear-145", label: "Coolgear 145 W chargers", columns: 2, order: 1 },
    bomIds: ["dse-usb"], purchaseUrl: COOLGEAR_145, status: "purchased", conductors: [
      p("plug", "Factory cigarette-lighter plug", "multicore", "back", { terminal: "Cigarette-lighter plug", terminalSize: "Centre positive / shell negative", termination: "Mates directly with wall socket", terminalDiameterMm: 20, terminalLengthMm: 14, internalMates: ["positive", "negative"] }),
      p("usbC1", "USB-C 1", "multicore", "front", { order: 0, optional: true, terminal: "USB-C receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C plug", terminalDiameterMm: 8 }),
      p("usbC2", "USB-C 2", "multicore", "front", { order: 1, optional: true, terminal: "USB-C receptacle", terminalSize: "USB Type-C", termination: "Factory USB-C plug", terminalDiameterMm: 8 }),
    ],
  },
  usbMini("usbMiniA", "ChargeIT! Mini 75 W A", 3.18, 0),
  usbMini("usbMiniB", "ChargeIT! Mini 75 W B", 3.30, 1),
  usbMini("usbMiniC", "ChargeIT! Mini 75 W C", 3.42, 2),
  usbMini("usbMiniD", "ChargeIT! Mini 75 W D", 3.54, 3),
  twoCoreBreakout("indoorLightBreakout", "Indoor-light two-core breakout", wall([5.42, 1.36, 0.018])),
  {
    id: "roomSwitch", label: "Indoor-light wall switch", kind: "switch", size: [0.090, 0.090, 0.035], placement: wall([5.60, 1.18, 0.018]),
    componentId: "roomSwitch", bomIds: ["dse-room-switch"], status: "purchased", conductors: [p("in", "24 V feed", "positive", "bottom"), p("out", "Switched light +", "positive", "top")],
  },
  {
    id: "indoorLight", label: "Indoor utility light", kind: "load", size: [0.127, 0.055, 0.055], placement: ceiling([3.05, 3.42, 1.05]),
    componentId: "indoorLight", bomIds: ["dse-indoor-light"], status: "purchased", conductors: [p("power", "Factory two-core light lead", "multicore", "left", { terminal: "Factory light pigtail", terminalSize: "Two-core 24 V lead", termination: "Sealed two-core cable splice", terminalDiameterMm: 6.4, internalMates: ["positive", "negative"] })],
  },
  {
    id: "outdoorLight", label: "Outdoor utility light", kind: "load", size: [0.127, 0.055, 0.055], placement: outsideWall([5.82, 2.30, -0.08]),
    componentId: "outdoorLight", bomIds: ["dse-outdoor-light"], status: "purchased", conductors: [p("power", "Factory two-core light lead", "multicore", "front", { terminal: "Factory light pigtail", terminalSize: "Two-core 24 V lead", termination: "Sealed two-core cable splice", terminalDiameterMm: 6.4, internalMates: ["positive", "negative"] })],
  },
];

export const dseJunctions: readonly Junction[] = [
  { id: "battery-cutoff", deviceId: "batteryCutoffJunction", label: "Battery / MPPT cutoff junction", minimumSize: [0.20, 0.16, 0.10], padding: 0.010, dinGap: 0.020, backplateGap: 0.010, glandSpacing: 0.020, sizePolicy: "verified-fixed" },
  { id: "secondary", deviceId: "secondaryJunction", label: "Secondary 24 V services junction", minimumSize: [0.30, 0.30, 0.18], padding: 0.010, dinGap: 0.020, backplateGap: 0.020, glandSpacing: 0.020, sizePolicy: "verified-fixed", dinPosition: "bottom" },
  { id: "pv", deviceId: "pvJunction", label: "PV junction", minimumSize: [0.29, 0.27, 0.15], padding: 0.020, dinGap: 0, backplateGap: 0.030, glandSpacing: 0.040 },
  { id: "ac", deviceId: "acJunction", label: "AC junction", minimumSize: [0.52, 0.32, 0.22], padding: 0.030, dinGap: 0, backplateGap: 0.030, glandSpacing: 0.040 },
];

const HOLD_SOCKET_OUTPUT = "Verify the Orion output-current limit, retained socket-harness protection and 12 AWG daisy-chain ampacity before energizing the 12 V socket branch.";

const dseBaseConnections: readonly Connection[] = [
  w("pv-a-series", ep("panel1", "positive"), ep("panel2", "negative"), "positive", "pv4"),
  w("pv-b-series", ep("panel3", "positive"), ep("panel4", "negative"), "positive", "pv4"),
  w("pv-a-positive-outside", ep("panel2", "positive"), ep("servicePenetration", "pvAPosOutside"), "positive", "pv4", { bundleId: "pv-string-a" }),
  w("pv-a-positive-inside", ep("servicePenetration", "pvAPosInside"), ep("pvBreakerA", "pvPosIn"), "positive", "pv4", { bundleId: "pv-string-a" }),
  w("pv-a-negative-outside", ep("panel1", "negative"), ep("servicePenetration", "pvANegOutside"), "negative", "pv4", { bundleId: "pv-string-a" }),
  w("pv-a-negative-inside", ep("servicePenetration", "pvANegInside"), ep("pvBreakerA", "pvNegIn"), "negative", "pv4", { bundleId: "pv-string-a" }),
  w("pv-b-positive-outside", ep("panel4", "positive"), ep("servicePenetration", "pvBPosOutside"), "positive", "pv4", { bundleId: "pv-string-b" }),
  w("pv-b-positive-inside", ep("servicePenetration", "pvBPosInside"), ep("pvBreakerB", "pvPosIn"), "positive", "pv4", { bundleId: "pv-string-b" }),
  w("pv-b-negative-outside", ep("panel3", "negative"), ep("servicePenetration", "pvBNegOutside"), "negative", "pv4", { bundleId: "pv-string-b" }),
  w("pv-b-negative-inside", ep("servicePenetration", "pvBNegInside"), ep("pvBreakerB", "pvNegIn"), "negative", "pv4", { bundleId: "pv-string-b" }),
  w("pv-comb-a-b-positive", ep("pvBreakerA", "pvPosOut"), ep("pvCombRails", "positiveBreakerA"), "positive", "pvComb"),
  w("pv-comb-b-tap-positive", ep("pvBreakerB", "pvPosOut"), ep("pvCombRails", "positiveBreakerB"), "positive", "pvComb"),
  w("pv-comb-b-spd-positive", ep("pvSpd", "positive"), ep("pvCombRails", "positiveSpd"), "positive", "pvComb"),
  w("pv-comb-spd-disconnect-positive", ep("pvDisconnect", "positiveIn"), ep("pvCombRails", "positiveDisconnect"), "positive", "pvComb"),
  w("pv-comb-a-b-negative", ep("pvBreakerA", "pvNegOut"), ep("pvCombRails", "negativeBreakerA"), "negative", "pvComb"),
  w("pv-comb-b-tap-negative", ep("pvBreakerB", "pvNegOut"), ep("pvCombRails", "negativeBreakerB"), "negative", "pvComb"),
  w("pv-comb-b-spd-negative", ep("pvSpd", "negative"), ep("pvCombRails", "negativeSpd"), "negative", "pvComb"),
  w("pv-comb-spd-disconnect-negative", ep("pvDisconnect", "negativeIn"), ep("pvCombRails", "negativeDisconnect"), "negative", "pvComb"),
  w("pv-output-positive", ep("pvDisconnect", "positiveOut"), ep("smartSolar", "pvPositive"), "positive", "pv4", { bundleId: "pv-mppt" }),
  w("pv-output-negative", ep("pvDisconnect", "negativeOut"), ep("smartSolar", "pvNegative"), "negative", "pv4", { bundleId: "pv-mppt" }),
  w("pv-spd-earth", ep("pvSpd", "earth"), ep("earthBar", "post3"), "earth", "dc10"),
  w("pv-frame-a-daisy", ep("panel1", "frame"), ep("panel2", "frame"), "earth", "pv4"),
  w("pv-frame-a-outside", ep("panel2", "frame"), ep("servicePenetration", "frameAOutside"), "earth", "earth4"),
  w("pv-frame-a-inside", ep("servicePenetration", "frameAInside"), ep("earthBar", "post4"), "earth", "earth4"),
  w("pv-frame-b-daisy", ep("panel3", "frame"), ep("panel4", "frame"), "earth", "pv4"),
  w("pv-frame-b-outside", ep("panel4", "frame"), ep("servicePenetration", "frameBOutside"), "earth", "earth4"),
  w("pv-frame-b-inside", ep("servicePenetration", "frameBInside"), ep("earthBar", "post6"), "earth", "earth4"),

  w("battery-a-series", ep("battery1", "positive"), ep("battery2", "negative"), "positive", "battery53"),
  w("battery-b-series", ep("battery3", "positive"), ep("battery4", "negative"), "positive", "battery53"),
  w("battery-a-positive-breaker", ep("battery2", "positive"), ep("batteryBreakerA", "line"), "positive", "battery53", { bundleId: "battery-a" }),
  w("battery-a-breaker-bus", ep("batteryBreakerA", "load"), ep("mainPositiveBus", "post1"), "positive", "battery53"),
  w("battery-b-positive-breaker", ep("battery4", "positive"), ep("batteryBreakerB", "line"), "positive", "battery53", { bundleId: "battery-b" }),
  w("battery-b-breaker-bus", ep("batteryBreakerB", "load"), ep("mainPositiveBus", "post2"), "positive", "battery53"),
  w("battery-a-negative-shunt", ep("battery1", "negative"), ep("smartShunt", "batteryMinus"), "negative", "battery53", { bundleId: "battery-a" }),
  w("battery-b-negative-shunt", ep("battery3", "negative"), ep("smartShunt", "batteryMinus"), "negative", "battery53", { bundleId: "battery-b" }),
  w("shunt-negative-bus", ep("smartShunt", "systemMinus"), ep("mainNegativeBus", "post1"), "negative", "battery53"),
  w("shunt-sense", ep("mainPositiveBus", "post4"), ep("smartShunt", "vBattPlus"), "positive", "factory"),
  w("balancer-a-positive", ep("battery2", "positive"), ep("balancerA", "positive"), "positive", "branch1.5"),
  w("balancer-a-mid", ep("battery1", "positive"), ep("balancerA", "midpoint"), "positive", "branch1.5"),
  w("balancer-a-negative", ep("battery1", "negative"), ep("balancerA", "negative"), "negative", "branch1.5"),
  w("balancer-b-positive", ep("battery4", "positive"), ep("balancerB", "positive"), "positive", "branch1.5"),
  w("balancer-b-mid", ep("battery3", "positive"), ep("balancerB", "midpoint"), "positive", "branch1.5"),
  w("balancer-b-negative", ep("battery3", "negative"), ep("balancerB", "negative"), "negative", "branch1.5"),

  w("mppt-positive-breaker", ep("smartSolar", "batteryPositive"), ep("mpptBreaker", "load"), "positive", "dc35", { bundleId: "mppt-dc" }),
  w("mppt-breaker-bus", ep("mpptBreaker", "line"), ep("mainPositiveBus", "post4"), "positive", "dc35"),
  w("mppt-negative-bus", ep("smartSolar", "batteryNegative"), ep("mainNegativeBus", "post2"), "negative", "dc35", { bundleId: "mppt-dc" }),
  w("multiplus-positive", ep("mainPositiveBus", "post3"), ep("multiPlus", "dcPositive"), "positive", "battery53", { bundleId: "multiplus-dc" }),
  w("multiplus-negative", ep("mainNegativeBus", "post3"), ep("multiPlus", "dcNegative"), "negative", "battery53", { bundleId: "multiplus-dc" }),

  w("secondary-feeder-positive", ep("mainPositiveBus", "post4"), ep("secondaryPositiveBus", "post1"), "positive", "battery53", {
    status: "hold", holdReason: "Field-procure a dedicated red 1/0 AWG feeder. Do not energize until upstream overcurrent coordination accounts for every source on the main bus and an engineer approves the 100 A Blue Sea bus, #10-32 landing or listed transition, lug stacking, conductor ampacity, fault current and local acceptance. No secondary incomer breaker is modeled.",
  }),
  w("secondary-feeder-negative", ep("mainNegativeBus", "post4"), ep("secondaryNegativeBus", "post1"), "negative", "battery53", {
    status: "hold", holdReason: "Field-procure the matching black 1/0 AWG return. Do not energize until an engineer approves the 100 A Blue Sea bus, #10-32 landing or listed transition, ring geometry, torque, enclosure clearance and full feeder protection coordination.",
  }),
  w("service-main", ep("secondaryPositiveBus", "post4"), ep("sharedServicesBreaker", "line"), "positive", "service2.5"),
  w("service-split", ep("sharedServicesBreaker", "load"), ep("serviceSplit", "in"), "positive", "branch1.5"),
  w("service-switch-panel", ep("serviceSplit", "switches"), ep("switchPanel", "common"), "positive", "branch1.5"),
  w("service-room-switch", ep("serviceSplit", "room"), ep("roomSwitch", "in"), "positive", "branch1.5"),
  w("service-return-trunk", ep("secondaryNegativeBus", "post5"), ep("serviceReturnSplit", "in"), "negative", "service2.5"),
  w("lighting-return-trunk", ep("serviceReturnSplit", "lighting"), ep("lightingReturnSplit", "in"), "negative", "branch1.5"),
  w("internet-return-trunk", ep("serviceReturnSplit", "internet"), ep("internetReturnSplit", "in"), "negative", "branch1.5"),
  w("room-light-positive", ep("roomSwitch", "out"), ep("indoorLightBreakout", "positive"), "positive", "branch1.5"),
  w("room-light-negative", ep("lightingReturnSplit", "indoor"), ep("indoorLightBreakout", "negative"), "negative", "branch1.5"),
  w("room-light-cable", ep("indoorLightBreakout", "cable"), ep("indoorLight", "power"), "multicore", "light2"),
  w("outdoor-light-positive", ep("switchPanel", "outdoor"), ep("outdoorLightBreakout", "positive"), "positive", "branch1.5"),
  w("outdoor-light-negative", ep("lightingReturnSplit", "outdoor"), ep("outdoorLightBreakout", "negative"), "negative", "branch1.5"),
  w("outdoor-light-cable-inside", ep("outdoorLightBreakout", "cable"), ep("servicePenetration", "lightInside"), "multicore", "light2"),
  w("outdoor-light-cable-outside", ep("servicePenetration", "lightOutside"), ep("outdoorLight", "power"), "multicore", "light2"),
  w("internet-switch-split", ep("switchPanel", "internet"), ep("internetSplit", "in"), "positive", "branch1.5"),
  w("internet-starlink-positive", ep("internetSplit", "starlink"), ep("starlinkBreakout", "positive"), "positive", "branch1.5"),
  w("internet-starlink-negative", ep("internetReturnSplit", "starlink"), ep("starlinkBreakout", "negative"), "negative", "branch1.5"),
  w("starlink-power-cable-inside", ep("starlinkBreakout", "cable"), ep("servicePenetration", "starlinkPowerInside"), "multicore", "starlinkPower"),
  w("starlink-power-cable-outside", ep("servicePenetration", "starlinkPowerOutside"), ep("starlink", "power"), "multicore", "starlinkPower"),
  w("internet-unifi-positive", ep("internetSplit", "unifi"), ep("unifiPower", "positiveIn"), "positive", "branch1.5"),
  w("internet-unifi-negative", ep("internetReturnSplit", "unifi"), ep("unifiPower", "negativeIn"), "negative", "branch1.5"),
  w("unifi-usbc", ep("unifiPower", "usbC"), ep("unifi", "usbC"), "multicore", "usbCFactory"),
  w("ekrano-positive", ep("secondaryPositiveBus", "post5"), ep("ekrano", "positive"), "positive", "factory"),
  w("ekrano-negative", ep("secondaryNegativeBus", "post6"), ep("ekrano", "negative"), "negative", "factory"),

  w("orion-breaker-feed", ep("secondaryPositiveBus", "post2"), ep("orionBreaker32", "line"), "positive", "dc10"),
  w("orion-input-positive", ep("orionBreaker32", "load"), ep("usbOrion", "positiveIn"), "positive", "dc10"),
  w("orion-common-ground", ep("secondaryNegativeBus", "post2"), ep("usbOrion", "ground"), "negative", "dc10"),
  w("orion-remote-h", ep("switchPanel", "orionH"), ep("usbOrion", "remoteH"), "control", "sense0.75"),
  w("orion-output-socket-a", ep("usbOrion", "positiveOut"), ep("usbSocketA", "positive"), "positive", "socketHarness12", { status: "hold", holdReason: HOLD_SOCKET_OUTPUT }),
  w("socket-a-b-positive", ep("usbSocketA", "positive"), ep("usbSocketB", "positive"), "positive", "socketHarness12", { status: "hold", holdReason: HOLD_SOCKET_OUTPUT }),
  w("socket-negative-feed", ep("secondaryNegativeBus", "post3"), ep("usbSocketA", "negative"), "negative", "socketHarness12", { status: "hold", holdReason: HOLD_SOCKET_OUTPUT }),
  w("socket-a-b-negative", ep("usbSocketA", "negative"), ep("usbSocketB", "negative"), "negative", "socketHarness12", { status: "hold", holdReason: HOLD_SOCKET_OUTPUT }),
  w("socket-a-charger-plug", ep("usbSocketA", "socket"), ep("usb145A", "plug"), "multicore", "socketPlug"),
  w("socket-b-charger-plug", ep("usbSocketB", "socket"), ep("usb145B", "plug"), "multicore", "socketPlug"),
  w("chargeit-breaker-feed", ep("secondaryPositiveBus", "post3"), ep("chargeItBreaker32", "line"), "positive", "branch5.26"),
  w("mini-positive-feed", ep("chargeItBreaker32", "load"), ep("usbMiniA", "positive"), "positive", "branch5.26"),
  w("mini-a-b-positive", ep("usbMiniA", "positive"), ep("usbMiniB", "positive"), "positive", "branch5.26"),
  w("mini-b-c-positive", ep("usbMiniB", "positive"), ep("usbMiniC", "positive"), "positive", "branch5.26"),
  w("mini-c-d-positive", ep("usbMiniC", "positive"), ep("usbMiniD", "positive"), "positive", "branch5.26"),
  w("mini-negative-feed", ep("secondaryNegativeBus", "post4"), ep("usbMiniA", "negative"), "negative", "branch5.26"),
  w("mini-a-b-negative", ep("usbMiniA", "negative"), ep("usbMiniB", "negative"), "negative", "branch5.26"),
  w("mini-b-c-negative", ep("usbMiniB", "negative"), ep("usbMiniC", "negative"), "negative", "branch5.26"),
  w("mini-c-d-negative", ep("usbMiniC", "negative"), ep("usbMiniD", "negative"), "negative", "branch5.26"),

  w("generator-white-cable", ep("generator", "cable"), ep("servicePenetration", "acOutside"), "multicore", "ac3"),
  w("generator-cable-inside", ep("servicePenetration", "acInside"), ep("generatorAcBreakout", "cable"), "multicore", "ac3"),
  w("ac-generator-line", ep("generatorAcBreakout", "line"), ep("acInputProtection", "lineIn"), "ac-line", "acCore1.5", { bundleId: "generator-ac-cores" }),
  w("ac-generator-neutral", ep("generatorAcBreakout", "neutral"), ep("acInputProtection", "neutralIn"), "ac-neutral", "acCore1.5", { bundleId: "generator-ac-cores" }),
  w("ac-generator-earth", ep("generatorAcBreakout", "earth"), ep("acInputPeSpliceA", "incoming"), "earth", "acCore1.5", { bundleId: "generator-ac-cores" }),
  w("ac-input-spd-earth", ep("acInputPeSpliceA", "spd"), ep("acInputProtection", "earth"), "earth", "acCore1.5"),
  w("ac-input-pe-daisy", ep("acInputPeSpliceA", "onward"), ep("acInputPeSpliceB", "incoming"), "earth", "acCore1.5"),
  w("ac-input-line", ep("acInputProtection", "lineOut"), ep("acInputCableBreakout", "line"), "ac-line", "acCore1.5", { bundleId: "ac-input-cable-cores" }),
  w("ac-input-neutral", ep("acInputProtection", "neutralOut"), ep("acInputCableBreakout", "neutral"), "ac-neutral", "acCore1.5", { bundleId: "ac-input-cable-cores" }),
  w("ac-input-earth", ep("acInputPeSpliceB", "multiplus"), ep("acInputCableBreakout", "earth"), "earth", "acCore1.5", { bundleId: "ac-input-cable-cores" }),
  w("ac-input-white-cable", ep("acInputCableBreakout", "cable"), ep("multiAcInBreakout", "cable"), "multicore", "ac3"),
  w("multiplus-ac-in-line", ep("multiAcInBreakout", "line"), ep("multiPlus", "acInLine"), "ac-line", "acCore1.5", { bundleId: "multiplus-ac-in-cores" }),
  w("multiplus-ac-in-neutral", ep("multiAcInBreakout", "neutral"), ep("multiPlus", "acInNeutral"), "ac-neutral", "acCore1.5", { bundleId: "multiplus-ac-in-cores" }),
  w("multiplus-ac-in-earth", ep("multiAcInBreakout", "earth"), ep("multiPlus", "acInEarth"), "earth", "acCore1.5", { bundleId: "multiplus-ac-in-cores" }),
  w("multiplus-ac-out-line", ep("multiPlus", "acOutLine"), ep("multiAcOutBreakout", "line"), "ac-line", "acCore1.5", { bundleId: "multiplus-ac-out-cores" }),
  w("multiplus-ac-out-neutral", ep("multiPlus", "acOutNeutral"), ep("multiAcOutBreakout", "neutral"), "ac-neutral", "acCore1.5", { bundleId: "multiplus-ac-out-cores" }),
  w("multiplus-ac-out-earth", ep("multiPlus", "acOutEarth"), ep("multiAcOutBreakout", "earth"), "earth", "acCore1.5", { bundleId: "multiplus-ac-out-cores" }),
  w("ac-output-white-cable", ep("multiAcOutBreakout", "cable"), ep("acOutputCableBreakout", "cable"), "multicore", "ac3"),
  w("ac-output-line", ep("acOutputCableBreakout", "line"), ep("acOutputProtection", "lineIn"), "ac-line", "acCore1.5", { bundleId: "ac-output-cable-cores" }),
  w("ac-output-neutral", ep("acOutputCableBreakout", "neutral"), ep("acOutputProtection", "neutralIn"), "ac-neutral", "acCore1.5", { bundleId: "ac-output-cable-cores" }),
  w("ac-output-earth", ep("acOutputCableBreakout", "earth"), ep("acOutputPeSplice", "multiplus"), "earth", "acCore1.5", { bundleId: "ac-output-cable-cores" }),
  w("ac-output-spd-earth", ep("acOutputPeSplice", "spd"), ep("acOutputProtection", "earth"), "earth", "acCore1.5"),
  w("ac-socket-line", ep("acOutputProtection", "lineOut"), ep("toolAcBreakout", "line"), "ac-line", "acCore1.5", { bundleId: "tool-ac-cores" }),
  w("ac-socket-neutral", ep("acOutputProtection", "neutralOut"), ep("toolAcBreakout", "neutral"), "ac-neutral", "acCore1.5", { bundleId: "tool-ac-cores" }),
  w("ac-socket-earth", ep("acOutputPeSplice", "tool"), ep("toolAcBreakout", "earth"), "earth", "acCore1.5", { bundleId: "tool-ac-cores" }),
  w("tool-white-cable", ep("toolAcBreakout", "cable"), ep("toolOutlet", "cable"), "multicore", "ac3"),
  w("ac-main-earth", ep("earthBar", "post5"), ep("acInputPeSpliceB", "mainBond"), "earth", "earth4"),
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
  const sharedLandings = [...uses.entries()].filter(([, entries]) => entries.length > 1);

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
            label: `Physical landing to ${joinId}`,
            ...(held.length > 0 ? { status: "hold" as const, holdReason } : {}),
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
  const repeated = [...finalUses].filter(([, count]) => count > 1);
  if (repeated.length > 0) throw new Error(`Shared physical landing remained after expansion: ${repeated[0][0]}`);
  return { devices: [...devices, ...joinDevices], connections: expandedConnections };
}

const expandedTopology = expandSharedPhysicalLandings(dseBaseDevices, dseBaseConnections, dseCables);
export const dseDevices: readonly Device[] = expandedTopology.devices;
export const dseConnections: readonly Connection[] = expandedTopology.connections;

export const dseTopology: SystemGraph = {
  id: "dse-fiji",
  label: "DSE Solar System · Fiji",
  revision: "R27 · split battery-cutoff and secondary-services distribution",
  devices: dseDevices,
  cables: dseCables,
  connections: dseConnections,
  junctions: dseJunctions,
};
