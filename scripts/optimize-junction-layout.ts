import { performance } from "node:perf_hooks";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CableRoutingSystem, sampleRoundedCableCenterline } from "../app/cableRouting.ts";

type Point2 = [number, number];
type Point3 = [number, number, number];
type WireKind = "positive" | "negative" | "data";

type ComponentSpec = {
  center: Point2;
  fixedX?: number;
  id: string;
  size: Point2;
};

type TerminalSpec = {
  componentId: string;
  escape?: "bottom" | "left" | "right" | "top";
  offset: Point2;
};

type PortDirection = [number, number, number];

type PortSpecification = {
  cableRadiusM: number;
  componentId?: string;
  direction: PortDirection;
  face: Point3;
  lengthM: number;
  position: Point3;
};

type RouteDefinition = {
  from: string;
  id: string;
  kind: WireKind;
  radiusM: number;
  to: string;
};

type GlandSpec = {
  conductorOffsetsM: number[];
  diameterM: number;
  exteriorPortIds: string[];
  id: string;
  label: string;
  terminals: string[];
  type: "gland" | "jack";
};

type Genome = {
  componentCenters: Record<string, Point2>;
  glandOrder: string[];
  routeOrder: string[];
  rowBreak: number;
};

type RoutedWire = {
  bends: number;
  from: string;
  id: string;
  kind: WireKind;
  lane: number;
  lengthM: number;
  points: Point3[];
  radiusM: number;
  to: string;
};

type GlandPlacement = {
  conductorPoints: Record<string, Point2>;
  diameterM: number;
  exteriorPortIds: string[];
  id: string;
  label: string;
  row: number;
  type: GlandSpec["type"];
  x: number;
  zOffset: number;
};

type EvaluationMetrics = {
  backtrackingCorners3d: number;
  boundaryBreakoutConflicts: number;
  bridgeCount: number;
  cableGlandCount: number;
  coincidentRunOverlapM: number;
  componentOverlapAreaM2: number;
  componentOverlapCount: number;
  depthOverflowM: number;
  directionReversals: number;
  glandCount: number;
  glandOverflowM: number;
  jackCount: number;
  laneCount: number;
  maximumForwardM: number;
  maximumPlanarBends: number;
  planarBends: number;
  portApproachViolations: number;
  routingCost: number;
  score: number;
  solidIntersections: number;
  spatialIntersections: number;
  totalLengthM: number;
  turnCount3d: number;
  unbridgeableConflicts: number;
  unsatisfiedBridgeConstraints: number;
  wallDistanceCostM2: number;
  weightedLengthM: number;
  wireCrossings: number;
  wireOverlapM: number;
};

type Evaluation = {
  components?: Record<string, { center: Point2; size: Point2 }>;
  glands?: Record<string, GlandPlacement>;
  metrics: EvaluationMetrics;
  ports?: Record<string, PortSpecification>;
  routes?: Record<string, RoutedWire>;
  terminals?: Record<string, Point2>;
};

function metricScore(metrics: Omit<EvaluationMetrics, "score"> | EvaluationMetrics) {
  // Search selection is lexicographic (see compareMetrics); this scalar is a
  // human-readable progress/reporting projection with the same broad order.
  return (
    metrics.componentOverlapCount * 1e28 +
    metrics.componentOverlapAreaM2 * 1e26 +
    metrics.glandOverflowM * 1e25 +
    (metrics.boundaryBreakoutConflicts ?? 0) * 1e24 +
    metrics.solidIntersections * 1e24 +
    metrics.portApproachViolations * 1e26 +
    metrics.spatialIntersections * 1e25 +
    metrics.coincidentRunOverlapM * 1e24 +
    metrics.backtrackingCorners3d * 1e20 +
    metrics.unbridgeableConflicts * 1e11 +
    metrics.unsatisfiedBridgeConstraints * 1e8 +
    metrics.depthOverflowM * 1e9 +
    metrics.directionReversals * 1e5 +
    metrics.routingCost * 1e3 +
    metrics.bridgeCount +
    metrics.wireCrossings * 0.01 +
    metrics.wireOverlapM
  );
}

type Candidate = {
  evaluation: Evaluation;
  genome: Genome;
};

const OUTPUT_SCHEMA_VERSION = 6;
const ALGORITHM_DESCRIPTION = "budget-safe steady-state evolutionary placement strategy followed by deterministic sequential 3D A* routing with finite-radius cable reservations, future-port approach reservations, hard component keep-outs, explicit oriented cylindrical ports with mandatory straight-on approaches, renderer-equivalent rounded-tube clearance auditing, and a zero-contact publish gate";
// The original PG-sized 320 × 217 mm interior cannot accommodate all nine DSE
// devices plus switch-body keep-outs and a device-free gland gutter without
// overlap. A 340 × 235 mm interior corresponds to an approximately
// 370 × 265 mm (14.6 × 10.4 in) exterior and remains comfortably inside the
// user's 20 × 18 in luggage limit.
const INNER_WIDTH_M = 0.34;
const INNER_HEIGHT_M = 0.235;
const INNER_LEFT = -INNER_WIDTH_M / 2;
const INNER_RIGHT = INNER_WIDTH_M / 2;
const INNER_BOTTOM = -INNER_HEIGHT_M / 2;
const INNER_TOP = INNER_HEIGHT_M / 2;
const INNER_BACK_Z = -0.063;
const COMPONENT_EDGE_CLEARANCE_M = 0.002;
// Most front-stud components can move directly onto a safe Z service plane;
// a compact 3 mm packing gap is sufficient between their bodies. The selector
// is different: its 1/0 lugs escape laterally behind the rotary body, so pairs
// involving it need a full finite-radius portal aisle.
const COMPONENT_GAP_M = 0.003;
// The 14.4 mm-OD Class-T conductors need 7.2 mm radius plus the 2.5 mm
// terminal-escape margin. Eleven millimetres is a real service aisle; the old
// 19 mm pairwise border consumed too much of the compact enclosure.
const SELECTOR_PORTAL_GAP_M = 0.011;
const GLAND_EDGE_CLEARANCE_M = 0.007;
const GLAND_GAP_M = 0.003;
const GLAND_TERMINAL_Y = INNER_BOTTOM + 0.0125;
const BOTTOM_ROUTING_GUTTER_TOP_Y = INNER_BOTTOM + 0.0335;
// The largest 14.4 mm-OD conductor needs a radius-safe vertical approach
// between the component field and its bottom gland.
const COMPONENT_TO_BREAKOUT_GUTTER_GAP_M = 0.006;
const GLAND_ROW_Z = [-0.034, 0.034] as const;
const WIRE_TERMINAL_Z = 0.06;
// All conductors leave their studs on one service plane.  This avoids a short
// axial move at every terminal (which can itself cut through a nearby cable).
// Local bridges move forward only where another routed conductor requires it.
const DATA_WIRE_PLANE_Z = 0.018;
const POSITIVE_WIRE_PLANE_Z = 0.018;
const NEGATIVE_WIRE_PLANE_Z = 0.018;
const WIRE_PLANE_Z = POSITIVE_WIRE_PLANE_Z;
const ROUTING_PLANES_M = [0.014, 0.025, 0.036, 0.047, 0.058, 0.069, 0.08, 0.091, 0.102, 0.113, 0.122] as const;
// The master-disconnect studs are on the rear of the rotary body. Keep their
// short terminal leads close to the back panel, then transition to the service
// plane only after the cable has cleared the switch's projected envelope.
const SELECTOR_TERMINAL_Z = 0.012;
const DEPTH_LEVEL_STEP_M = 0.011;
const MAXIMUM_ALLOWED_FORWARD_M = 0.13;
const EPSILON = 1e-7;
const PORT_MINIMUM_LENGTH_M = 0.008;
const PORT_STRAIGHT_APPROACH_M = 0.012;

const round = (value: number, places = 6) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const COMPONENT_SPECS: ComponentSpec[] = [
  { id: "selector", center: [-0.0602, 0.078], size: [0.075, 0.075] },
  { id: "shunt", center: [-0.058, 0.0053], size: [0.12, 0.046] },
  { id: "positiveBus", center: [0.079, 0.09], size: [0.178, 0.051] },
  { id: "negativeBus", center: [-0.079, -0.0555], size: [0.178, 0.051] },
  { id: "fuseBlock", center: [0.114, -0.0187], size: [0.108, 0.087] },
  { id: "returnBus", center: [0.1013, 0.0427], size: [0.107, 0.023] },
  { id: "switchPanel", center: [INNER_LEFT + 0.019, 0.0725], fixedX: INNER_LEFT + 0.019, size: [0.036, 0.086] },
  { id: "mpptFuse", center: [0.0359, -0.0217], size: [0.034, 0.063] },
  { id: "ekranoFuse", center: [-0.148, -0.0088], size: [0.04, 0.018] },
];

const componentById = Object.fromEntries(COMPONENT_SPECS.map((component) => [component.id, component]));

// Body-to-body spacing must also leave room for the thickest conductor to
// move forward from a front-face terminal without entering its neighbor's
// radius-inflated solid. These are conductor radii plus the 1.5 mm solid-audit
// margin; the selector retains its larger lateral bend/egress aisle.
const COMPONENT_TERMINAL_CLEARANCE_M: Record<string, number> = {
  selector: SELECTOR_PORTAL_GAP_M,
  shunt: 0.0087,
  positiveBus: 0.0087,
  negativeBus: 0.0087,
  fuseBlock: 0.0043,
  returnBus: 0.0043,
  switchPanel: 0.0033,
  mpptFuse: 0.007,
  ekranoFuse: 0.0033,
};

// The rocker panel is mounted through the enclosure side rather than flat on
// the backplate, but its switch bodies still project into the same interior
// volume. Treat that projection as a real keep-out instead of allowing a
// backplate component (and its conductors) to occupy the space behind it.
const sharesBackplatePlane = (firstId: string, secondId: string) => (
  firstId.length > 0 && secondId.length > 0
);

const TERMINAL_SPECS: Record<string, TerminalSpec> = {
  // Both Class-T-protected positive lugs stack on one master-disconnect input
  // stud. The two modeled lug centers are separated by 4 mm only so both
  // cable surfaces stay visible; electrically they are one stud. The other
  // stud is the whole-bank output.
  selectorInputA: { componentId: "selector", escape: "left", offset: [-0.022, -0.010] },
  selectorInputB: { componentId: "selector", escape: "left", offset: [-0.022, 0.010] },
  selectorOutput: { componentId: "selector", escape: "right", offset: [0.022, 0] },
  // The two string-negative lugs share the SmartShunt battery-side copper
  // landing electrically, but are rendered as two explicit attachment ports
  // on that landing so two finite-diameter cables never occupy one volume.
  shuntBatteryA: { componentId: "shunt", offset: [-0.050, 0] },
  shuntBatteryB: { componentId: "shunt", offset: [-0.032, 0] },
  shuntSystem: { componentId: "shunt", offset: [0.043, 0] },
  shuntData: { componentId: "shunt", offset: [0, 0] },
  shuntVbattPositive: { componentId: "shunt", offset: [0.018, -0.014] },
  servicesFuseIn: { componentId: "fuseBlock", offset: [-0.046, 0.034] },
  servicesFuseOut: { componentId: "fuseBlock", offset: [-0.026, 0.034] },
  fuseInput: { componentId: "fuseBlock", offset: [-0.006, 0.034] },
  starlinkFuseIn: { componentId: "fuseBlock", offset: [0.014, 0.034] },
  starlinkFuseOut: { componentId: "fuseBlock", offset: [0.034, 0.034] },
  switchInput1: { componentId: "switchPanel", offset: [-0.009, 0.035] },
  switchOutput1: { componentId: "switchPanel", offset: [0.019, 0.035] },
  switchInput2: { componentId: "switchPanel", offset: [-0.009, 0.02] },
  switchOutput2: { componentId: "switchPanel", offset: [0.019, 0.02] },
  switchInput4: { componentId: "switchPanel", offset: [-0.009, -0.007] },
  switchOutput4: { componentId: "switchPanel", offset: [0.019, -0.007] },
  switchInput5: { componentId: "switchPanel", offset: [-0.009, -0.029] },
  switchOutput5: { componentId: "switchPanel", offset: [0.019, -0.029] },
  switchLedNegative: { componentId: "switchPanel", offset: [-0.009, -0.047] },
};

const mainBusTerminalOffsets: Point2[] = [
  [-0.054, 0.008], [-0.018, 0.008], [0.018, 0.008],
  [-0.054, -0.012], [-0.018, -0.012], [0.018, -0.012],
];
mainBusTerminalOffsets.forEach((offset, index) => {
  TERMINAL_SPECS[`positiveStud${index + 1}`] = { componentId: "positiveBus", offset };
  TERMINAL_SPECS[`negativeStud${index + 1}`] = { componentId: "negativeBus", offset };
});
// The SmartShunt's supplied fused Vbatt+ sense lead uses the fourth small
// terminal on the positive PowerBar. The corresponding fourth large stud
// remains spare for future service work.
TERMINAL_SPECS.positiveStud7 = { componentId: "positiveBus", offset: [0.054, -0.012] };
const returnBusOffsets: Point2[] = [
  [-0.045, 0.006], [-0.032, -0.005], [-0.016, -0.005], [0, -0.005], [0.016, -0.005], [0.032, -0.005],
];
returnBusOffsets.forEach((offset, index) => {
  TERMINAL_SPECS[`returnStud${index + 1}`] = { componentId: "returnBus", offset };
});
[-0.034, -0.012, 0.012, 0.034].forEach((offset, index) => {
  TERMINAL_SPECS[`fuseOutput${index + 1}`] = { componentId: "fuseBlock", offset: [offset, -0.034] };
});

for (const component of ["mpptFuse", "ekranoFuse"]) {
  const halfWidth = componentById[component].size[0] / 2;
  TERMINAL_SPECS[`${component}In`] = { componentId: component, offset: [-halfWidth, 0] };
  TERMINAL_SPECS[`${component}Out`] = { componentId: component, offset: [halfWidth, 0] };
}

const GLAND_SPECS: GlandSpec[] = [
  { id: "battery-a-positive", label: "STRING A +", diameterM: 0.028, type: "gland", terminals: ["batteryPosA"], conductorOffsetsM: [0], exteriorPortIds: ["junctionBatteryPositiveA"] },
  { id: "battery-b-positive", label: "STRING B +", diameterM: 0.028, type: "gland", terminals: ["batteryPosB"], conductorOffsetsM: [0], exteriorPortIds: ["junctionBatteryPositiveB"] },
  { id: "battery-a-negative", label: "STRING A −", diameterM: 0.028, type: "gland", terminals: ["batteryNegA"], conductorOffsetsM: [0], exteriorPortIds: ["junctionBatteryNegativeA"] },
  { id: "battery-b-negative", label: "STRING B −", diameterM: 0.028, type: "gland", terminals: ["batteryNegB"], conductorOffsetsM: [0], exteriorPortIds: ["junctionBatteryNegativeB"] },
  { id: "mppt-positive", label: "MPPT +", diameterM: 0.021, type: "gland", terminals: ["mpptPos"], conductorOffsetsM: [0], exteriorPortIds: ["junctionMpptPositive"] },
  { id: "mppt-negative", label: "MPPT −", diameterM: 0.021, type: "gland", terminals: ["mpptNeg"], conductorOffsetsM: [0], exteriorPortIds: ["junctionMpptNegative"] },
  { id: "multiplus-positive", label: "MULTIPLUS +", diameterM: 0.028, type: "gland", terminals: ["multiplusPos"], conductorOffsetsM: [0], exteriorPortIds: ["junctionMultiPlusPositive"] },
  { id: "multiplus-negative", label: "MULTIPLUS −", diameterM: 0.028, type: "gland", terminals: ["multiplusNeg"], conductorOffsetsM: [0], exteriorPortIds: ["junctionMultiPlusNegative"] },
  { id: "ekrano-power", label: "EKRANO POWER", diameterM: 0.016, type: "gland", terminals: ["ekranPos", "ekranNeg"], conductorOffsetsM: [-0.0035, 0.0035], exteriorPortIds: ["junctionEkranPositive", "junctionEkranNegative"] },
  { id: "ekrano-data", label: "VE.DIRECT", diameterM: 0.014, type: "gland", terminals: ["ekranData"], conductorOffsetsM: [0], exteriorPortIds: ["junctionEkranData"] },
  { id: "unifi-power", label: "UNIFI 24 V PAIR", diameterM: 0.016, type: "gland", terminals: ["loadPos2", "loadNeg2"], conductorOffsetsM: [-0.0035, 0.0035], exteriorPortIds: ["junctionLoadPositive2", "junctionLoadNegative2"] },
  { id: "usb-power", label: "USB 24 V PAIR", diameterM: 0.017, type: "gland", terminals: ["loadPos3", "loadNeg3"], conductorOffsetsM: [-0.004, 0.004], exteriorPortIds: ["junctionLoadPositive3", "junctionLoadNegative3"] },
  { id: "inside-light", label: "INSIDE LIGHT", diameterM: 0.016, type: "gland", terminals: ["loadPos4", "loadNeg4"], conductorOffsetsM: [-0.0035, 0.0035], exteriorPortIds: ["junctionLoadPositive4", "junctionLoadNegative4"] },
  { id: "outside-light", label: "OUTSIDE LIGHT", diameterM: 0.016, type: "gland", terminals: ["loadPos5", "loadNeg5"], conductorOffsetsM: [-0.0035, 0.0035], exteriorPortIds: ["junctionLoadPositive5", "junctionLoadNegative5"] },
  { id: "starlink-jack", label: "STARLINK 24 V", diameterM: 0.018, type: "jack", terminals: ["starlinkJackPositive", "starlinkJackNegative"], conductorOffsetsM: [-0.004, 0.004], exteriorPortIds: ["junctionStarlinkCable"] },
];

const glandById = Object.fromEntries(GLAND_SPECS.map((gland) => [gland.id, gland]));

const EXTERIOR_BREAKOUT_RADIUS_M: Record<string, number> = {
  "battery-a-negative": 0.0072,
  "battery-a-positive": 0.0072,
  "battery-b-negative": 0.0072,
  "battery-b-positive": 0.0072,
};

const ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: "battery-positive-a", from: "selectorInputA", to: "batteryPosA", kind: "positive", radiusM: 0.0072 },
  { id: "battery-positive-b", from: "selectorInputB", to: "batteryPosB", kind: "positive", radiusM: 0.0072 },
  { id: "battery-negative-a", from: "shuntBatteryA", to: "batteryNegA", kind: "negative", radiusM: 0.0072 },
  { id: "battery-negative-b", from: "shuntBatteryB", to: "batteryNegB", kind: "negative", radiusM: 0.0072 },
  { id: "selector-to-positive-bus", from: "selectorOutput", to: "positiveStud1", kind: "positive", radiusM: 0.0072 },
  { id: "shunt-to-negative-bus", from: "shuntSystem", to: "negativeStud1", kind: "negative", radiusM: 0.0072 },
  { id: "shunt-voltage-sense", from: "positiveStud7", to: "shuntVbattPositive", kind: "positive", radiusM: 0.0012 },
  { id: "mppt-positive-feed", from: "positiveStud3", to: "mpptFuseIn", kind: "positive", radiusM: 0.0055 },
  { id: "mppt-positive", from: "mpptFuseOut", to: "mpptPos", kind: "positive", radiusM: 0.0055 },
  { id: "mppt-negative", from: "negativeStud3", to: "mpptNeg", kind: "negative", radiusM: 0.0055 },
  { id: "multiplus-positive", from: "positiveStud2", to: "multiplusPos", kind: "positive", radiusM: 0.0072 },
  { id: "multiplus-negative", from: "negativeStud2", to: "multiplusNeg", kind: "negative", radiusM: 0.0072 },
  { id: "services-positive-feed", from: "positiveStud4", to: "servicesFuseIn", kind: "positive", radiusM: 0.0028 },
  { id: "services-positive", from: "servicesFuseOut", to: "fuseInput", kind: "positive", radiusM: 0.0028 },
  { id: "services-negative", from: "negativeStud5", to: "returnStud6", kind: "negative", radiusM: 0.0028 },
  { id: "ekrano-positive-feed", from: "positiveStud5", to: "ekranoFuseIn", kind: "positive", radiusM: 0.0018 },
  { id: "ekrano-positive", from: "ekranoFuseOut", to: "ekranPos", kind: "positive", radiusM: 0.0018 },
  { id: "ekrano-negative", from: "negativeStud4", to: "ekranNeg", kind: "negative", radiusM: 0.0018 },
  { id: "ekrano-data", from: "shuntData", to: "ekranData", kind: "data", radiusM: 0.0016 },
  { id: "starlink-fuse-feed", from: "positiveStud6", to: "starlinkFuseIn", kind: "positive", radiusM: 0.0018 },
  { id: "starlink-switch-input", from: "starlinkFuseOut", to: "switchInput1", kind: "positive", radiusM: 0.0018 },
  { id: "starlink-jack-positive", from: "switchOutput1", to: "starlinkJackPositive", kind: "positive", radiusM: 0.0018 },
  { id: "starlink-jack-negative", from: "negativeStud6", to: "starlinkJackNegative", kind: "negative", radiusM: 0.0018 },
  { id: "switch-input-2", from: "fuseOutput1", to: "switchInput2", kind: "positive", radiusM: 0.0018 },
  { id: "load-positive-2", from: "switchOutput2", to: "loadPos2", kind: "positive", radiusM: 0.0018 },
  { id: "load-negative-2", from: "returnStud1", to: "loadNeg2", kind: "negative", radiusM: 0.0018 },
  { id: "load-positive-3", from: "fuseOutput2", to: "loadPos3", kind: "positive", radiusM: 0.0023 },
  { id: "load-negative-3", from: "returnStud2", to: "loadNeg3", kind: "negative", radiusM: 0.0023 },
  { id: "switch-input-4", from: "fuseOutput3", to: "switchInput4", kind: "positive", radiusM: 0.0016 },
  { id: "load-positive-4", from: "switchOutput4", to: "loadPos4", kind: "positive", radiusM: 0.0016 },
  { id: "load-negative-4", from: "returnStud3", to: "loadNeg4", kind: "negative", radiusM: 0.0016 },
  { id: "switch-input-5", from: "fuseOutput4", to: "switchInput5", kind: "positive", radiusM: 0.0016 },
  { id: "load-positive-5", from: "switchOutput5", to: "loadPos5", kind: "positive", radiusM: 0.0016 },
  { id: "load-negative-5", from: "returnStud4", to: "loadNeg5", kind: "negative", radiusM: 0.0016 },
  { id: "switch-led-negative", from: "returnStud5", to: "switchLedNegative", kind: "negative", radiusM: 0.0012 },
];

const routeById = Object.fromEntries(ROUTE_DEFINITIONS.map((route) => [route.id, route]));
const terminalOwner = (terminalId: string) => TERMINAL_SPECS[terminalId]?.componentId;

class Random {
  private spareGaussian: number | undefined;
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  integer(minimum: number, maximum: number) {
    return minimum + Math.floor(this.next() * (maximum - minimum + 1));
  }

  gaussian() {
    if (this.spareGaussian !== undefined) {
      const value = this.spareGaussian;
      this.spareGaussian = undefined;
      return value;
    }
    let first = 0;
    let second = 0;
    while (first <= Number.EPSILON) first = this.next();
    while (second <= Number.EPSILON) second = this.next();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    this.spareGaussian = magnitude * Math.sin(2 * Math.PI * second);
    return magnitude * Math.cos(2 * Math.PI * second);
  }
}

function shuffle<T>(values: T[], random: Random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = random.integer(0, index);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function cloneGenome(genome: Genome): Genome {
  return {
    componentCenters: Object.fromEntries(Object.entries(genome.componentCenters).map(([id, center]) => [id, [...center] as Point2])),
    glandOrder: [...genome.glandOrder],
    routeOrder: [...genome.routeOrder],
    rowBreak: genome.rowBreak,
  };
}

function clampComponent(component: ComponentSpec, point: Point2): Point2 {
  const halfWidth = component.size[0] / 2;
  const halfHeight = component.size[1] / 2;
  // Reserve the entire lower band for independent gland breakout columns.
  // Previously the breaker block and negative bus could be packed over a
  // gland; every possible Z transition then had to pass through that device.
  const minimumCenterY = BOTTOM_ROUTING_GUTTER_TOP_Y +
    Math.max(
      COMPONENT_TO_BREAKOUT_GUTTER_GAP_M,
      COMPONENT_TERMINAL_CLEARANCE_M[component.id] ?? 0,
    ) + halfHeight;
  return [
    component.fixedX ?? Math.max(INNER_LEFT + halfWidth + COMPONENT_EDGE_CLEARANCE_M, Math.min(INNER_RIGHT - halfWidth - COMPONENT_EDGE_CLEARANCE_M, point[0])),
    Math.max(
      minimumCenterY,
      Math.min(INNER_TOP - halfHeight - COMPONENT_EDGE_CLEARANCE_M, point[1]),
    ),
  ];
}

function inflatedOverlap(
  first: { center: Point2; size: Point2 },
  second: { center: Point2; size: Point2 },
  gap = COMPONENT_GAP_M,
) {
  const x = Math.min(first.center[0] + first.size[0] / 2, second.center[0] + second.size[0] / 2) -
    Math.max(first.center[0] - first.size[0] / 2, second.center[0] - second.size[0] / 2) + gap;
  const y = Math.min(first.center[1] + first.size[1] / 2, second.center[1] + second.size[1] / 2) -
    Math.max(first.center[1] - first.size[1] / 2, second.center[1] - second.size[1] / 2) + gap;
  return x > 0.000001 && y > 0.000001 ? { area: x * y, x, y } : undefined;
}

const componentPairGap = (firstId: string, secondId: string) => (
  Math.max(
    COMPONENT_GAP_M,
    COMPONENT_TERMINAL_CLEARANCE_M[firstId] ?? 0,
    COMPONENT_TERMINAL_CLEARANCE_M[secondId] ?? 0,
  )
);

function repairComponents(genome: Genome) {
  // Saved optimizer genomes are intentionally reusable across design edits.
  // Reconcile ordered ID lists before routing so a newly added circuit or
  // gland is appended once, while stale IDs from an older schema disappear.
  const reconcileOrder = (current: string[] | undefined, valid: string[]) => {
    const allowed = new Set(valid);
    const seen = new Set<string>();
    const reconciled = (current ?? []).filter((id) => {
      if (!allowed.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    valid.forEach((id) => {
      if (!seen.has(id)) reconciled.push(id);
    });
    return reconciled;
  };
  genome.glandOrder = reconcileOrder(genome.glandOrder, GLAND_SPECS.map((gland) => gland.id));
  genome.routeOrder = reconcileOrder(genome.routeOrder, ROUTE_DEFINITIONS.map((route) => route.id));
  genome.rowBreak = Math.max(1, Math.min(genome.glandOrder.length - 1, genome.rowBreak));
  COMPONENT_SPECS.forEach((component) => {
    genome.componentCenters[component.id] ??= [...component.center];
    genome.componentCenters[component.id] = clampComponent(component, genome.componentCenters[component.id]);
  });
  for (let pass = 0; pass < 120; pass += 1) {
    let moved = false;
    for (let firstIndex = 0; firstIndex < COMPONENT_SPECS.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < COMPONENT_SPECS.length; secondIndex += 1) {
        const firstSpec = COMPONENT_SPECS[firstIndex];
        const secondSpec = COMPONENT_SPECS[secondIndex];
        if (!sharesBackplatePlane(firstSpec.id, secondSpec.id)) continue;
        const first = { center: genome.componentCenters[firstSpec.id], size: firstSpec.size };
        const second = { center: genome.componentCenters[secondSpec.id], size: secondSpec.size };
        const overlap = inflatedOverlap(first, second, componentPairGap(firstSpec.id, secondSpec.id));
        if (!overlap) continue;
        moved = true;
        const moveFirst = firstSpec.fixedX === undefined;
        const moveSecond = secondSpec.fixedX === undefined;
        const share = moveFirst && moveSecond ? 0.51 : 1;
        if (overlap.x < overlap.y && (moveFirst || moveSecond)) {
          const direction = first.center[0] <= second.center[0] ? -1 : 1;
          if (moveFirst) first.center[0] += direction * overlap.x * share;
          if (moveSecond) second.center[0] -= direction * overlap.x * share;
        } else {
          const direction = first.center[1] <= second.center[1] ? -1 : 1;
          if (firstSpec.id !== "switchPanel") first.center[1] += direction * overlap.y * share;
          if (secondSpec.id !== "switchPanel") second.center[1] -= direction * overlap.y * share;
          else first.center[1] += direction * overlap.y;
        }
        genome.componentCenters[firstSpec.id] = clampComponent(firstSpec, first.center);
        genome.componentCenters[secondSpec.id] = clampComponent(secondSpec, second.center);
      }
    }
    if (!moved) break;
  }
}

function randomPackedCenters(random: Random) {
  for (let restart = 0; restart < 120; restart += 1) {
    const centers: Record<string, Point2> = {};
    const ordered = [...COMPONENT_SPECS].sort((first, second) => (
      second.size[0] * second.size[1] - first.size[0] * first.size[1]
    ));
    let failed = false;
    for (const component of ordered) {
      let placed = false;
      for (let attempt = 0; attempt < 900; attempt += 1) {
        const center = clampComponent(component, [
          INNER_LEFT + component.size[0] / 2 + random.next() * (INNER_WIDTH_M - component.size[0]),
          INNER_BOTTOM + component.size[1] / 2 + random.next() * (INNER_HEIGHT_M - component.size[1]),
        ]);
        const candidate = { center, size: component.size };
        if (Object.entries(centers).some(([id, otherCenter]) => sharesBackplatePlane(component.id, id) && inflatedOverlap(
          candidate,
          { center: otherCenter, size: componentById[id].size },
          componentPairGap(component.id, id),
        ))) continue;
        centers[component.id] = center;
        placed = true;
        break;
      }
      if (!placed) {
        failed = true;
        break;
      }
    }
    if (!failed) return centers;
  }
  const fallback = Object.fromEntries(COMPONENT_SPECS.map((component) => [component.id, [...component.center] as Point2]));
  const genome = { componentCenters: fallback, glandOrder: [], routeOrder: [], rowBreak: 8 } satisfies Genome;
  repairComponents(genome);
  return genome.componentCenters;
}

function createGenome(random: Random): Genome {
  return {
    componentCenters: randomPackedCenters(random),
    glandOrder: shuffle(GLAND_SPECS.map((gland) => gland.id), random),
    routeOrder: shuffle(ROUTE_DEFINITIONS.map((route) => route.id), random),
    rowBreak: random.integer(7, 8),
  };
}

function orderCrossover(first: string[], second: string[], random: Random) {
  const start = random.integer(0, first.length - 2);
  const end = random.integer(start + 1, first.length - 1);
  const result = Array<string>(first.length);
  const fixed = new Set(first.slice(start, end + 1));
  for (let index = start; index <= end; index += 1) result[index] = first[index];
  const remaining = second.filter((id) => !fixed.has(id));
  let cursor = 0;
  for (let index = 0; index < result.length; index += 1) {
    if (result[index]) continue;
    result[index] = remaining[cursor++];
  }
  return result;
}

function crossover(first: Genome, second: Genome, random: Random): Genome {
  const componentCenters = Object.fromEntries(COMPONENT_SPECS.map((component) => {
    const amount = -0.15 + random.next() * 1.3;
    const firstPoint = first.componentCenters[component.id];
    const secondPoint = second.componentCenters[component.id];
    return [component.id, clampComponent(component, [
      firstPoint[0] * amount + secondPoint[0] * (1 - amount),
      firstPoint[1] * amount + secondPoint[1] * (1 - amount),
    ])];
  }));
  return {
    componentCenters,
    glandOrder: orderCrossover(first.glandOrder, second.glandOrder, random),
    routeOrder: orderCrossover(first.routeOrder, second.routeOrder, random),
    rowBreak: random.next() < 0.5 ? first.rowBreak : second.rowBreak,
  };
}

function swapMutation(values: string[], random: Random) {
  const first = random.integer(0, values.length - 1);
  const second = random.integer(0, values.length - 1);
  [values[first], values[second]] = [values[second], values[first]];
}

function insertionMutation(values: string[], random: Random) {
  const from = random.integer(0, values.length - 1);
  const [value] = values.splice(from, 1);
  values.splice(random.integer(0, values.length), 0, value);
}

function mutateRouteOrder(values: string[], random: Random, strength = 1) {
  for (let index = 0; index < strength; index += 1) {
    if (random.next() < 0.55) insertionMutation(values, random);
    else swapMutation(values, random);
  }
  if (random.next() < 0.18) {
    const start = random.integer(0, values.length - 2);
    const end = random.integer(start + 1, values.length - 1);
    values.splice(start, end - start + 1, ...values.slice(start, end + 1).reverse());
  }
}

function mutate(genome: Genome, random: Random, scale: number) {
  for (const component of COMPONENT_SPECS) {
    if (random.next() > 0.34) continue;
    const center = genome.componentCenters[component.id];
    genome.componentCenters[component.id] = clampComponent(component, [
      center[0] + random.gaussian() * scale,
      center[1] + random.gaussian() * scale,
    ]);
  }
  if (random.next() < 0.8) swapMutation(genome.glandOrder, random);
  if (random.next() < 0.18) {
    const start = random.integer(0, genome.glandOrder.length - 2);
    const end = random.integer(start + 1, genome.glandOrder.length - 1);
    genome.glandOrder.splice(start, end - start + 1, ...genome.glandOrder.slice(start, end + 1).reverse());
  }
  if (random.next() < 0.72) mutateRouteOrder(genome.routeOrder, random, random.next() < 0.18 ? 2 : 1);
  if (random.next() < 0.2) genome.rowBreak += random.next() < 0.5 ? -1 : 1;
  genome.rowBreak = Math.max(6, Math.min(GLAND_SPECS.length - 6, genome.rowBreak));
  repairComponents(genome);
}

function placeGlands(genome: Genome) {
  const rows = [genome.glandOrder.slice(0, genome.rowBreak), genome.glandOrder.slice(genome.rowBreak)];
  const glands: Record<string, GlandPlacement> = {};
  let overflowM = 0;
  rows.forEach((row, rowIndex) => {
    const occupied = row.reduce((sum, id) => sum + glandById[id].diameterM, 0) + Math.max(0, row.length - 1) * GLAND_GAP_M;
    const available = INNER_WIDTH_M - GLAND_EDGE_CLEARANCE_M * 2;
    overflowM += Math.max(0, occupied - available);
    let cursor = -occupied / 2;
    row.forEach((id) => {
      const gland = glandById[id];
      const x = cursor + gland.diameterM / 2;
      const conductorPoints = Object.fromEntries(gland.terminals.map((terminal, index) => [
        terminal,
        [round(x + gland.conductorOffsetsM[index]), GLAND_TERMINAL_Y] as Point2,
      ]));
      glands[id] = {
        conductorPoints,
        diameterM: gland.diameterM,
        exteriorPortIds: gland.exteriorPortIds,
        id,
        label: gland.label,
        row: rowIndex,
        type: gland.type,
        x: round(x),
        zOffset: GLAND_ROW_Z[rowIndex],
      };
      cursor += gland.diameterM + GLAND_GAP_M;
    });
  });
  return { glands, overflowM: round(overflowM), rows };
}

function boundaryBreakoutConflicts(glands: Record<string, GlandPlacement>) {
  const batteryGlands = ["battery-a-negative", "battery-a-positive", "battery-b-negative", "battery-b-positive"];
  return batteryGlands.reduce((conflicts, batteryId, index) => (
    conflicts + batteryGlands.slice(index + 1).filter((otherId) => {
      const battery = glands[batteryId];
      const other = glands[otherId];
      if (battery.row === other.row) return false;
      const clearance = EXTERIOR_BREAKOUT_RADIUS_M[batteryId] +
        EXTERIOR_BREAKOUT_RADIUS_M[otherId] + 0.003;
      return Math.abs(battery.x - other.x) < clearance - EPSILON;
    }).length
  ), 0);
}

const terminalCableRadiusM = Object.fromEntries(Object.keys({
  ...TERMINAL_SPECS,
  ...Object.fromEntries(GLAND_SPECS.flatMap((gland) => gland.terminals.map((id) => [id, true]))),
}).map((terminalId) => [terminalId, Math.max(
  0.0012,
  ...ROUTE_DEFINITIONS
    .filter((route) => route.from === terminalId || route.to === terminalId)
    .map((route) => route.radiusM),
)]));

function terminalPortLength(terminalId: string) {
  return Math.max(PORT_MINIMUM_LENGTH_M, (terminalCableRadiusM[terminalId] ?? 0.0018) * 1.5);
}

function terminalEscapeDirection(terminalId: string): "bottom" | "front" | "left" | "right" | "top" {
  const specification = TERMINAL_SPECS[terminalId];
  if (!specification) return "top";
  // Every internal device terminal is a front-face port. The old inferred
  // left/right exits allowed a route to attach sideways or hide behind the
  // selector and switch bodies. Glands remain upward-facing bottom ports.
  return "front";
}

function terminalDirection(terminalId: string): PortDirection {
  if (!TERMINAL_SPECS[terminalId]) return [0, 1, 0];
  const direction = terminalEscapeDirection(terminalId);
  if (direction === "front") return [0, 0, 1];
  if (direction === "left") return [-1, 0, 0];
  if (direction === "right") return [1, 0, 0];
  if (direction === "bottom") return [0, -1, 0];
  return [0, 1, 0];
}

function buildTerminals(genome: Genome, glands: Record<string, GlandPlacement>) {
  const terminals: Record<string, Point2> = {};
  Object.entries(TERMINAL_SPECS).forEach(([id, terminal]) => {
    const center = genome.componentCenters[terminal.componentId];
    const component = componentById[terminal.componentId];
    const direction = terminalDirection(id);
    const lengthM = terminalPortLength(id);
    const face: Point2 = [
      direction[0] < 0
        ? center[0] - component.size[0] / 2
        : direction[0] > 0
          ? center[0] + component.size[0] / 2
          : center[0] + terminal.offset[0],
      direction[1] < 0
        ? center[1] - component.size[1] / 2
        : direction[1] > 0
          ? center[1] + component.size[1] / 2
          : center[1] + terminal.offset[1],
    ];
    terminals[id] = [
      round(face[0] + direction[0] * lengthM),
      round(face[1] + direction[1] * lengthM),
    ];
  });
  Object.values(glands).forEach((gland) => Object.assign(terminals, gland.conductorPoints));
  return terminals;
}

function terminalEscapePoint(
  terminalId: string,
  route: RouteDefinition,
  terminals: Record<string, Point2>,
) {
  const terminal = terminals[terminalId];
  const specification = TERMINAL_SPECS[terminalId];
  if (!specification) {
    // Every bottom gland owns one straight breakout column. The core router
    // stops at the top of this reserved gutter instead of weaving horizontal
    // runs through the dense gland fan-out zone.
    if (Math.abs(terminal[1] - GLAND_TERMINAL_Y) < EPSILON) {
      return [terminal[0], BOTTOM_ROUTING_GUTTER_TOP_Y];
    }
    return terminal;
  }
  // Front-facing ports leave only in +Z. After the mandatory straight axial
  // approach, fan every conductor vertically down past its owning device
  // before it may change depth or enter a shared routing channel. This creates
  // a deterministic, device-free portal and prevents a low-depth route from
  // cutting back through the face of the component it serves.
  if (terminalEscapeDirection(terminalId) === "front") {
    const component = componentById[specification.componentId];
    const routeClearance = route.radiusM + 0.003;
    const inferredCenterX = terminal[0] - specification.offset[0];
    const inferredCenterY = terminal[1] - specification.offset[1];
    if (terminalId === "shuntBatteryA") {
      return [round(inferredCenterX - component.size[0] / 2 - routeClearance), terminal[1]];
    }
    if (terminalId === "shuntBatteryB") {
      return [round(inferredCenterX + component.size[0] / 2 + routeClearance), terminal[1]];
    }
    if (terminalId === "selectorInputA") {
      return [round(inferredCenterX - component.size[0] / 2 - routeClearance), terminal[1]];
    }
    if (terminalId === "selectorInputB") {
      return [round(inferredCenterX + component.size[0] / 2 + routeClearance), terminal[1]];
    }
    // buildTerminals already applies the component center. Recover it from
    // the terminal and declared offset so this function remains genome-local.
    return [
      terminal[0],
      round(inferredCenterY - component.size[1] / 2 - routeClearance),
    ];
  }
  const direction = terminalDirection(terminalId);
  const approach = Math.max(PORT_STRAIGHT_APPROACH_M, route.radiusM * 2 + 0.003);
  return [
    round(terminal[0] + direction[0] * approach),
    round(terminal[1] + direction[1] * approach),
  ];
}

function routeGeometryContext(
  route: RouteDefinition,
  terminals: Record<string, Point2>,
  components: Record<string, { center: Point2; size: Point2 }>,
) {
  const actualStart = terminals[route.from];
  const actualEnd = terminals[route.to];
  const start = terminalEscapePoint(route.from, route, terminals);
  const end = terminalEscapePoint(route.to, route, terminals);
  const sourceOwner = terminalOwner(route.from);
  const targetOwner = terminalOwner(route.to);
  const sourceEscaped = !samePoint(actualStart, start);
  const targetEscaped = !samePoint(actualEnd, end);
  const obstacles = Object.entries(components).filter(([id]) => (
    !(id === sourceOwner && !sourceEscaped) &&
    !(id === targetOwner && !targetEscaped)
  ));
  const attachTerminalLeads = (core: Point2[]) => [actualStart, ...core, actualEnd]
    .filter((point, index, points) => index === 0 || !samePoint(point, points[index - 1]));
  return {
    actualEnd,
    actualStart,
    attachTerminalLeads,
    end,
    obstacles,
    sourceEscaped,
    sourceOwner,
    start,
    targetEscaped,
    targetOwner,
  };
}

function samePoint(first: Point2, second: Point2) {
  return Math.abs(first[0] - second[0]) < EPSILON && Math.abs(first[1] - second[1]) < EPSILON;
}

function compact2(points: Point2[]) {
  const unique = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  if (unique.length < 3) return unique;
  const result: Point2[] = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = result.at(-1)!;
    const current = unique[index];
    const next = unique[index + 1];
    if (
      Math.abs(previous[0] - current[0]) < EPSILON && Math.abs(current[0] - next[0]) < EPSILON ||
      Math.abs(previous[1] - current[1]) < EPSILON && Math.abs(current[1] - next[1]) < EPSILON
    ) continue;
    result.push(current);
  }
  result.push(unique.at(-1)!);
  return result;
}

function compact3(points: Point3[]) {
  return points.filter((point, index) => index === 0 || point.some((value, axis) => (
    Math.abs(value - points[index - 1][axis]) > EPSILON
  )));
}

function compactRendered3(points: Point3[]) {
  const unique = compact3(points);
  if (unique.length < 3) return unique;
  const compacted: Point3[] = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = compacted.at(-1)!;
    const current = unique[index];
    const next = unique[index + 1];
    const incomingAxes = current.map((value, axis) => Math.abs(value - previous[axis]) > EPSILON);
    const outgoingAxes = next.map((value, axis) => Math.abs(value - current[axis]) > EPSILON);
    const incomingAxis = incomingAxes.findIndex(Boolean);
    const outgoingAxis = outgoingAxes.findIndex(Boolean);
    if (
      incomingAxis >= 0 && incomingAxis === outgoingAxis &&
      incomingAxes.filter(Boolean).length === 1 && outgoingAxes.filter(Boolean).length === 1 &&
      (current[incomingAxis] - previous[incomingAxis]) * (next[outgoingAxis] - current[outgoingAxis]) > 0
    ) continue;
    compacted.push(current);
  }
  compacted.push(unique.at(-1)!);
  return compacted;
}

function planarLength(points: Point2[]) {
  return points.slice(1).reduce((sum, point, index) => (
    sum + Math.abs(point[0] - points[index][0]) + Math.abs(point[1] - points[index][1])
  ), 0);
}

function directionReversals(points: Point2[]) {
  return ([0, 1] as const).reduce<number>((total, axis) => {
    const signs = points.slice(1).map((point, index) => Math.sign(point[axis] - points[index][axis])).filter(Boolean);
    return total + signs.slice(1).filter((sign, index) => sign !== signs[index]).length;
  }, 0);
}

type Segment = { end: Point2; start: Point2 };

function segments(points: Point2[]): Segment[] {
  return points.slice(1).map((end, index) => ({ start: points[index], end }));
}

function intervalOverlap(firstA: number, firstB: number, secondA: number, secondB: number) {
  return Math.max(0, Math.min(Math.max(firstA, firstB), Math.max(secondA, secondB)) -
    Math.max(Math.min(firstA, firstB), Math.min(secondA, secondB)));
}

function segmentRelationship(first: Segment, second: Segment) {
  const firstVertical = Math.abs(first.start[0] - first.end[0]) < EPSILON;
  const secondVertical = Math.abs(second.start[0] - second.end[0]) < EPSILON;
  if (firstVertical === secondVertical) {
    const sameAxis = firstVertical
      ? Math.abs(first.start[0] - second.start[0]) < EPSILON
      : Math.abs(first.start[1] - second.start[1]) < EPSILON;
    if (!sameAxis) return { crossings: 0, overlapM: 0 };
    const overlapM = firstVertical
      ? intervalOverlap(first.start[1], first.end[1], second.start[1], second.end[1])
      : intervalOverlap(first.start[0], first.end[0], second.start[0], second.end[0]);
    return { crossings: 0, overlapM };
  }
  const vertical = firstVertical ? first : second;
  const horizontal = firstVertical ? second : first;
  const point: Point2 = [vertical.start[0], horizontal.start[1]];
  const within = point[0] >= Math.min(horizontal.start[0], horizontal.end[0]) - EPSILON &&
    point[0] <= Math.max(horizontal.start[0], horizontal.end[0]) + EPSILON &&
    point[1] >= Math.min(vertical.start[1], vertical.end[1]) - EPSILON &&
    point[1] <= Math.max(vertical.start[1], vertical.end[1]) + EPSILON;
  if (!within) return { crossings: 0, overlapM: 0 };
  const sharedEndpoint = (samePoint(point, first.start) || samePoint(point, first.end)) &&
    (samePoint(point, second.start) || samePoint(point, second.end));
  return { crossings: sharedEndpoint ? 0 : 1, overlapM: 0 };
}

function routeRelationship(first: Point2[], second: Point2[]) {
  let crossings = 0;
  let overlapM = 0;
  segments(first).forEach((firstSegment) => segments(second).forEach((secondSegment) => {
    const relationship = segmentRelationship(firstSegment, secondSegment);
    crossings += relationship.crossings;
    overlapM += relationship.overlapM;
  }));
  return { crossings, overlapM };
}

function segmentCrossesRectangle(segment: Segment, center: Point2, size: Point2) {
  const left = center[0] - size[0] / 2;
  const right = center[0] + size[0] / 2;
  const bottom = center[1] - size[1] / 2;
  const top = center[1] + size[1] / 2;
  const vertical = Math.abs(segment.start[0] - segment.end[0]) < EPSILON;
  if (vertical) {
    if (segment.start[0] <= left || segment.start[0] >= right) return false;
    return Math.max(segment.start[1], segment.end[1]) > bottom && Math.min(segment.start[1], segment.end[1]) < top;
  }
  if (segment.start[1] <= bottom || segment.start[1] >= top) return false;
  return Math.max(segment.start[0], segment.end[0]) > left && Math.min(segment.start[0], segment.end[0]) < right;
}

const COMPONENT_FRONT_Z_M: Record<string, number> = {
  selector: 0.084,
  shunt: 0.054,
  positiveBus: 0.057,
  negativeBus: 0.057,
  fuseBlock: 0.071,
  returnBus: 0.056,
  switchPanel: 0.1,
  mpptFuse: 0.06,
  ekranoFuse: 0.06,
};

function segmentIntersectsPrism(
  start: Point3,
  end: Point3,
  minimum: Point3,
  maximum: Point3,
) {
  let near = 0;
  let far = 1;
  for (const axis of [0, 1, 2] as const) {
    const direction = end[axis] - start[axis];
    if (Math.abs(direction) < EPSILON) {
      if (start[axis] < minimum[axis] || start[axis] > maximum[axis]) return false;
      continue;
    }
    let axisNear = (minimum[axis] - start[axis]) / direction;
    let axisFar = (maximum[axis] - start[axis]) / direction;
    if (axisNear > axisFar) [axisNear, axisFar] = [axisFar, axisNear];
    near = Math.max(near, axisNear);
    far = Math.min(far, axisFar);
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
}

function componentSolidIntersectionIds(
  points: Point3[],
  route: RouteDefinition,
  components: Record<string, { center: Point2; size: Point2 }>,
) {
  const sourceOwner = terminalOwner(route.from);
  const targetOwner = terminalOwner(route.to);
  return Object.entries(components).flatMap(([componentId, component]) => {
    // The device's own short lead lands on a front-face terminal and is allowed
    // inside that owner's projection. Other routes must clear the full solid.
    if (componentId === sourceOwner || componentId === targetOwner) return [];
    const clearance = route.radiusM + 0.0015;
    const minimum: Point3 = [
      component.center[0] - component.size[0] / 2 - clearance,
      component.center[1] - component.size[1] / 2 - clearance,
      0,
    ];
    const maximum: Point3 = [
      component.center[0] + component.size[0] / 2 + clearance,
      component.center[1] + component.size[1] / 2 + clearance,
      (COMPONENT_FRONT_Z_M[componentId] ?? 0.06) + clearance,
    ];
    const intersects = points.slice(1).some((end, index) => {
      return segmentIntersectsPrism(points[index], end, minimum, maximum);
    });
    return intersects ? [componentId] : [];
  });
}

function componentSolidIntersections(
  points: Point3[],
  route: RouteDefinition,
  components: Record<string, { center: Point2; size: Point2 }>,
) {
  return componentSolidIntersectionIds(points, route, components).length;
}

const terminalGroup = (terminalId: string) => terminalId;

function closestSegmentPoints3d(
  firstStart: Point3,
  firstEnd: Point3,
  secondStart: Point3,
  secondEnd: Point3,
) {
  const subtract3 = (first: Point3, second: Point3): Point3 => [
    first[0] - second[0], first[1] - second[1], first[2] - second[2],
  ];
  const dot3 = (first: Point3, second: Point3) => (
    first[0] * second[0] + first[1] * second[1] + first[2] * second[2]
  );
  const add3 = (point: Point3, direction: Point3, scale: number): Point3 => [
    point[0] + direction[0] * scale,
    point[1] + direction[1] * scale,
    point[2] + direction[2] * scale,
  ];
  const firstDirection = subtract3(firstEnd, firstStart);
  const secondDirection = subtract3(secondEnd, secondStart);
  const offset = subtract3(firstStart, secondStart);
  const firstLengthSquared = dot3(firstDirection, firstDirection);
  const secondLengthSquared = dot3(secondDirection, secondDirection);
  const firstOffset = dot3(firstDirection, offset);
  const secondOffset = dot3(secondDirection, offset);
  let firstT = 0;
  let secondT = 0;
  if (firstLengthSquared <= EPSILON && secondLengthSquared <= EPSILON) {
    // Both are points.
  } else if (firstLengthSquared <= EPSILON) {
    secondT = Math.max(0, Math.min(1, secondOffset / secondLengthSquared));
  } else if (secondLengthSquared <= EPSILON) {
    firstT = Math.max(0, Math.min(1, -firstOffset / firstLengthSquared));
  } else {
    const alignment = dot3(firstDirection, secondDirection);
    const denominator = firstLengthSquared * secondLengthSquared - alignment * alignment;
    if (Math.abs(denominator) > EPSILON) {
      firstT = Math.max(0, Math.min(
        1,
        (alignment * secondOffset - firstOffset * secondLengthSquared) / denominator,
      ));
    }
    secondT = (alignment * firstT + secondOffset) / secondLengthSquared;
    if (secondT < 0) {
      secondT = 0;
      firstT = Math.max(0, Math.min(1, -firstOffset / firstLengthSquared));
    } else if (secondT > 1) {
      secondT = 1;
      firstT = Math.max(0, Math.min(1, (alignment - firstOffset) / firstLengthSquared));
    }
  }
  const firstPoint = add3(firstStart, firstDirection, firstT);
  const secondPoint = add3(secondStart, secondDirection, secondT);
  return {
    distanceM: Math.hypot(
      firstPoint[0] - secondPoint[0],
      firstPoint[1] - secondPoint[1],
      firstPoint[2] - secondPoint[2],
    ),
    firstPoint,
    secondPoint,
  };
}

function routePairHasClearanceConflict(
  points: Point3[],
  route: RouteDefinition,
  other: PlacedWire,
) {
  const clearance = route.radiusM + other.route.radiusM + 0.001;
  const routeTerminals = [route.from, route.to];
  const otherTerminals = [other.route.from, other.route.to];
  const shared = routeTerminals.flatMap((terminal, routeIndex) => otherTerminals.flatMap((otherTerminal, otherIndex) => (
    terminalGroup(terminal) === terminalGroup(otherTerminal)
      ? [{ routePoint: points[routeIndex === 0 ? 0 : points.length - 1], otherPoint: other.collisionPoints3[otherIndex === 0 ? 0 : other.collisionPoints3.length - 1] }]
      : []
  )));
  const fanoutM = Math.max(0.02, clearance * 2);
  return points.slice(1).some((firstEnd, firstIndex) => (
    other.collisionPoints3.slice(1).some((secondEnd, secondIndex) => {
      const proximity = closestSegmentPoints3d(
        points[firstIndex], firstEnd, other.collisionPoints3[secondIndex], secondEnd,
      );
      if (proximity.distanceM >= clearance) return false;
      return !shared.some(({ routePoint, otherPoint }) => (
        Math.hypot(...proximity.firstPoint.map((value, axis) => value - routePoint[axis]) as Point3) <= fanoutM &&
        Math.hypot(...proximity.secondPoint.map((value, axis) => value - otherPoint[axis]) as Point3) <= fanoutM
      ));
    })
  ));
}

type HeapEntry = { cost: number; state: number };

class MinimumHeap {
  private values: HeapEntry[] = [];

  get size() {
    return this.values.length;
  }

  push(entry: HeapEntry) {
    this.values.push(entry);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].cost <= entry.cost) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = entry;
  }

  pop() {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].cost < this.values[left].cost ? right : left;
      if (this.values[child].cost >= last.cost) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function visibilityPath(
  route: RouteDefinition,
  terminals: Record<string, Point2>,
  components: Record<string, { center: Point2; size: Point2 }>,
  placed: Array<{ points: Point2[]; route: RouteDefinition }>,
  congestionWeight: number,
) {
  const context = routeGeometryContext(route, terminals, components);
  const { end, start } = context;
  const wallClearance = route.radiusM + 0.002;
  const leftLimit = INNER_LEFT + wallClearance;
  const rightLimit = INNER_RIGHT - wallClearance;
  const bottomLimit = BOTTOM_ROUTING_GUTTER_TOP_Y;
  const topLimit = INNER_TOP - wallClearance;
  const obstacles = context.obstacles
    .map(([, obstacle]) => {
      const clearance = route.radiusM + 0.002;
      return {
        center: obstacle.center,
        size: [obstacle.size[0] + clearance * 2, obstacle.size[1] + clearance * 2] as Point2,
      };
    });
  const xValues = new Set<number>([start[0], end[0], leftLimit, rightLimit]);
  const yValues = new Set<number>([start[1], end[1], BOTTOM_ROUTING_GUTTER_TOP_Y, topLimit]);
  obstacles.forEach((obstacle) => {
    xValues.add(round(Math.max(leftLimit, obstacle.center[0] - obstacle.size[0] / 2)));
    xValues.add(round(Math.min(rightLimit, obstacle.center[0] + obstacle.size[0] / 2)));
    yValues.add(round(Math.max(bottomLimit, obstacle.center[1] - obstacle.size[1] / 2)));
    yValues.add(round(Math.min(topLimit, obstacle.center[1] + obstacle.size[1] / 2)));
  });
  const xs = [...xValues].sort((first, second) => first - second);
  const ys = [...yValues].sort((first, second) => first - second);
  const xCount = xs.length;
  const nodePoint = (node: number): Point2 => [xs[node % xCount], ys[Math.floor(node / xCount)]];
  const pointBlocked = (point: Point2) => obstacles.some((obstacle) => {
    const left = obstacle.center[0] - obstacle.size[0] / 2;
    const right = obstacle.center[0] + obstacle.size[0] / 2;
    const bottom = obstacle.center[1] - obstacle.size[1] / 2;
    const top = obstacle.center[1] + obstacle.size[1] / 2;
    return point[0] > left + EPSILON && point[0] < right - EPSILON &&
      point[1] > bottom + EPSILON && point[1] < top - EPSILON;
  });
  const valid = Array.from({ length: xs.length * ys.length }, (_, node) => !pointBlocked(nodePoint(node)));
  const findCoordinate = (values: number[], target: number) => values.findIndex((value) => Math.abs(value - target) < EPSILON);
  const sourceNode = findCoordinate(xs, start[0]) + findCoordinate(ys, start[1]) * xCount;
  const targetNode = findCoordinate(xs, end[0]) + findCoordinate(ys, end[1]) * xCount;
  valid[sourceNode] = true;
  valid[targetNode] = true;
  const stateCount = valid.length * 3;
  const distance = new Float64Array(stateCount);
  distance.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount);
  previous.fill(-1);
  const sourceState = sourceNode * 3;
  distance[sourceState] = 0;
  const heap = new MinimumHeap();
  heap.push({ cost: 0, state: sourceState });
  const relationshipCache = new Map<string, { crossings: number; overlapM: number }>();
  let finalState = -1;
  while (heap.size > 0) {
    const current = heap.pop()!;
    if (current.cost > distance[current.state] + EPSILON) continue;
    const node = Math.floor(current.state / 3);
    const incomingDirection = current.state % 3;
    if (node === targetNode) {
      finalState = current.state;
      break;
    }
    const xIndex = node % xCount;
    const yIndex = Math.floor(node / xCount);
    const neighbors = [
      xIndex > 0 ? node - 1 : -1,
      xIndex + 1 < xs.length ? node + 1 : -1,
      yIndex > 0 ? node - xCount : -1,
      yIndex + 1 < ys.length ? node + xCount : -1,
    ].filter((candidate) => candidate >= 0 && valid[candidate]);
    const from = nodePoint(node);
    for (const neighbor of neighbors) {
      const to = nodePoint(neighbor);
      const segment = { start: from, end: to };
      if (obstacles.some((obstacle) => segmentCrossesRectangle(segment, obstacle.center, obstacle.size))) continue;
      const direction = xIndex !== neighbor % xCount ? 1 : 2;
      const edgeKey = node < neighbor ? `${node}:${neighbor}` : `${neighbor}:${node}`;
      let relationship = relationshipCache.get(edgeKey);
      if (!relationship) {
        relationship = placed.reduce((sum, other) => {
          const next = routeRelationship([from, to], other.points);
          return { crossings: sum.crossings + next.crossings, overlapM: sum.overlapM + next.overlapM };
        }, { crossings: 0, overlapM: 0 });
        relationshipCache.set(edgeKey, relationship);
      }
      const edgeLength = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]);
      const cost = current.cost +
        edgeLength * 1000 +
        (incomingDirection !== 0 && incomingDirection !== direction ? 4 : 0) +
        relationship.crossings * congestionWeight +
        relationship.overlapM * congestionWeight * 80;
      const nextState = neighbor * 3 + direction;
      if (cost + EPSILON >= distance[nextState]) continue;
      distance[nextState] = cost;
      previous[nextState] = current.state;
      heap.push({ cost, state: nextState });
    }
  }
  if (finalState < 0) return undefined;
  const reversed: Point2[] = [];
  let state = finalState;
  while (state >= 0) {
    reversed.push(nodePoint(Math.floor(state / 3)));
    state = previous[state];
  }
  const points = compact2(reversed.reverse());
  return {
    bends: Math.max(0, points.length - 2),
    lengthM: planarLength(points),
    points,
    reversals: directionReversals(points),
    solidIntersections: 0,
  };
}

function candidatePaths(
  route: RouteDefinition,
  terminals: Record<string, Point2>,
  components: Record<string, { center: Point2; size: Point2 }>,
  placed: Array<{ points: Point2[]; route: RouteDefinition }>,
) {
  const context = routeGeometryContext(route, terminals, components);
  const { end, obstacles, start } = context;
  const wallClearance = route.radiusM + 0.002;
  const leftLimit = INNER_LEFT + wallClearance;
  const rightLimit = INNER_RIGHT - wallClearance;
  const bottomLimit = BOTTOM_ROUTING_GUTTER_TOP_Y;
  const topLimit = INNER_TOP - wallClearance;
  const xChannels = new Set<number>([start[0], end[0], round((start[0] + end[0]) / 2), leftLimit, rightLimit]);
  const yChannels = new Set<number>([start[1], end[1], round((start[1] + end[1]) / 2), BOTTOM_ROUTING_GUTTER_TOP_Y, bottomLimit, topLimit]);
  obstacles.forEach(([, obstacle]) => {
    const clearance = route.radiusM + 0.003;
    const laneSpacing = route.radiusM * 2 + 0.004;
    const left = obstacle.center[0] - obstacle.size[0] / 2 - clearance;
    const right = obstacle.center[0] + obstacle.size[0] / 2 + clearance;
    const bottom = obstacle.center[1] - obstacle.size[1] / 2 - clearance;
    const top = obstacle.center[1] + obstacle.size[1] / 2 + clearance;
    [left, left - laneSpacing, left - laneSpacing * 2, right, right + laneSpacing, right + laneSpacing * 2]
      .forEach((value) => xChannels.add(round(value)));
    [bottom, bottom - laneSpacing, bottom - laneSpacing * 2, top, top + laneSpacing, top + laneSpacing * 2]
      .forEach((value) => yChannels.add(round(value)));
  });
  // Offer lanes immediately beside already-routed conductors. The previous
  // candidate set knew only component edges, so unrelated cables repeatedly
  // selected one identical obstacle boundary and produced coincident tubes.
  placed.forEach((other) => segments(other.points).forEach((segment) => {
    const clearance = route.radiusM + other.route.radiusM + 0.0035;
    if (Math.abs(segment.start[0] - segment.end[0]) < EPSILON) {
      xChannels.add(round(segment.start[0] - clearance));
      xChannels.add(round(segment.start[0] + clearance));
    } else if (Math.abs(segment.start[1] - segment.end[1]) < EPSILON) {
      yChannels.add(round(segment.start[1] - clearance));
      yChannels.add(round(segment.start[1] + clearance));
    }
  }));
  const coreCandidates: Point2[][] = [
    compact2([start, [end[0], start[1]], end]),
    compact2([start, [start[0], end[1]], end]),
  ];
  xChannels.forEach((x) => {
    if (x < leftLimit - EPSILON || x > rightLimit + EPSILON) return;
    coreCandidates.push(compact2([start, [x, start[1]], [x, end[1]], end]));
  });
  yChannels.forEach((y) => {
    if (y < bottomLimit - EPSILON || y > topLimit + EPSILON) return;
    coreCandidates.push(compact2([start, [start[0], y], [end[0], y], end]));
  });
  [500].forEach((congestionWeight) => {
    const path = visibilityPath(route, terminals, components, placed, congestionWeight);
    if (path) coreCandidates.push(path.points);
  });
  const unique = new Map<string, Point2[]>();
  coreCandidates.forEach((candidate) => unique.set(candidate.map((point) => point.join(",")).join(" "), candidate));
  return [...unique.values()].map((corePoints) => {
    const points = context.attachTerminalLeads(corePoints);
    const solidIntersections = 0;
    let projectedComponentCrossings = 0;
    const solidIntersectionIds: string[] = [];
    obstacles.forEach(([obstacleId, obstacle]) => {
      const expanded: Point2 = [obstacle.size[0] + route.radiusM * 2 + 0.004, obstacle.size[1] + route.radiusM * 2 + 0.004];
      const pathSegments = segments(points);
      const hitCount = pathSegments.filter((segment, index) => {
        const allowedSourceLead = obstacleId === context.sourceOwner && context.sourceEscaped && index === 0;
        const allowedTargetLead = obstacleId === context.targetOwner && context.targetEscaped && index === pathSegments.length - 1;
        return !allowedSourceLead && !allowedTargetLead &&
          segmentCrossesRectangle(segment, obstacle.center, expanded);
      }).length;
      // Prefer going around every device, but let a candidate use a forward
      // depth plane when the compact enclosure has no planar aisle. Treating
      // the breaker block as an infinitely deep 2D wall duplicated the exact
      // prism audit and forced thick gland routes into other real solids. The
      // finite 3D audit below remains authoritative for every component.
      projectedComponentCrossings += hitCount;
    });
    return {
      bends: Math.max(0, points.length - 2),
      corePoints,
      lengthM: planarLength(points),
      points,
      projectedComponentCrossings,
      reversals: directionReversals(points),
      solidIntersectionIds,
      solidIntersections,
    };
  }).sort((first, second) => (
    first.solidIntersections - second.solidIntersections ||
    first.projectedComponentCrossings - second.projectedComponentCrossings ||
    first.reversals - second.reversals ||
    first.lengthM - second.lengthM ||
    first.bends - second.bends
  ));
}

function terminalZ(terminalId: string, glands: Record<string, GlandPlacement>) {
  const gland = glandForTerminal(terminalId, glands);
  if (gland) return gland.zOffset - INNER_BACK_Z;
  const owner = terminalOwner(terminalId);
  const direction = terminalDirection(terminalId);
  const componentFront = COMPONENT_FRONT_Z_M[owner ?? ""] ?? WIRE_TERMINAL_Z;
  // Side-mounted lugs sit midway through their device body. Front-facing
  // terminals end at the tip of a cylinder whose base touches the front face.
  if (Math.abs(direction[2]) < EPSILON) {
    if (owner === "selector") return Math.max(SELECTOR_TERMINAL_Z, componentFront * 0.55);
    return componentFront * 0.55;
  }
  return componentFront + terminalPortLength(terminalId);
}

function routePlaneZ(route: RouteDefinition) {
  if (route.kind === "negative") return NEGATIVE_WIRE_PLANE_Z;
  if (route.kind === "data") return DATA_WIRE_PLANE_Z;
  return POSITIVE_WIRE_PLANE_Z;
}

function routePlaneCandidates(route: RouteDefinition) {
  const preferred = routePlaneZ(route);
  return [...ROUTING_PLANES_M]
    .filter((plane) => (
      plane - route.radiusM >= 0.003 &&
      plane + route.radiusM <= MAXIMUM_ALLOWED_FORWARD_M
    ))
    .sort((first, second) => Math.abs(first - preferred) - Math.abs(second - preferred));
}

function glandForTerminal(terminalId: string, glands: Record<string, GlandPlacement>) {
  return Object.values(glands).find((gland) => terminalId in gland.conductorPoints);
}

function buildPortSpecifications(
  terminals: Record<string, Point2>,
  glands: Record<string, GlandPlacement>,
): Record<string, PortSpecification> {
  return Object.fromEntries(Object.entries(terminals).map(([terminalId, point]) => {
    const gland = glandForTerminal(terminalId, glands);
    const direction = terminalDirection(terminalId);
    const lengthM = gland
      ? Math.max(0.004, GLAND_TERMINAL_Y - INNER_BOTTOM)
      : terminalPortLength(terminalId);
    const position: Point3 = [point[0], point[1], terminalZ(terminalId, glands)];
    const face: Point3 = gland
      ? [point[0], INNER_BOTTOM, position[2]]
      : [
          round(position[0] - direction[0] * lengthM),
          round(position[1] - direction[1] * lengthM),
          round(position[2] - direction[2] * lengthM),
        ];
    return [terminalId, {
      cableRadiusM: terminalCableRadiusM[terminalId] ?? 0.0018,
      componentId: TERMINAL_SPECS[terminalId]?.componentId,
      direction,
      face,
      lengthM: round(lengthM),
      position,
    }];
  }));
}

type PlacedWire = {
  collisionPoints3: Point3[];
  points: Point2[];
  points3: Point3[];
  route: RouteDefinition;
};

type BridgeInterval = {
  constraints: Array<{ clearance: number; maximumZ: number; minimumZ: number }>;
  end: number;
  start: number;
  z: number;
};

function pointWithinSegment(point: Point2, segment: Segment) {
  return point[0] >= Math.min(segment.start[0], segment.end[0]) - EPSILON &&
    point[0] <= Math.max(segment.start[0], segment.end[0]) + EPSILON &&
    point[1] >= Math.min(segment.start[1], segment.end[1]) - EPSILON &&
    point[1] <= Math.max(segment.start[1], segment.end[1]) + EPSILON;
}

function projectedZRangeAt(points: Point3[], point: Point2) {
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;
  points.slice(1).forEach((end, index) => {
    const start = points[index];
    const projected: Segment = { start: [start[0], start[1]], end: [end[0], end[1]] };
    if (!pointWithinSegment(point, projected)) return;
    const stationaryProjection = samePoint(projected.start, projected.end);
    const axisAlignedProjection = stationaryProjection ||
      Math.abs(projected.start[0] - projected.end[0]) < EPSILON ||
      Math.abs(projected.start[1] - projected.end[1]) < EPSILON;
    if (!axisAlignedProjection) return;
    minimumZ = Math.min(minimumZ, start[2], end[2]);
    maximumZ = Math.max(maximumZ, start[2], end[2]);
  });
  return Number.isFinite(minimumZ)
    ? { maximumZ, minimumZ }
    : { maximumZ: WIRE_PLANE_Z, minimumZ: WIRE_PLANE_Z };
}

function interpolateSegment(segment: Segment, amount: number): Point2 {
  return [
    segment.start[0] + (segment.end[0] - segment.start[0]) * amount,
    segment.start[1] + (segment.end[1] - segment.start[1]) * amount,
  ];
}

function clearanceInterval(
  segment: Segment,
  otherSegment: Segment,
  clearanceM: number,
) {
  const vertical = Math.abs(segment.start[0] - segment.end[0]) < EPSILON;
  const otherVertical = Math.abs(otherSegment.start[0] - otherSegment.end[0]) < EPSILON;
  const axis = vertical ? 1 : 0;
  const perpendicularAxis = vertical ? 0 : 1;
  const delta = segment.end[axis] - segment.start[axis];
  if (Math.abs(delta) < EPSILON) return undefined;

  let rangeStart: number;
  let rangeEnd: number;
  if (vertical === otherVertical) {
    const perpendicularDistance = Math.abs(segment.start[perpendicularAxis] - otherSegment.start[perpendicularAxis]);
    if (perpendicularDistance >= clearanceM) return undefined;
    const alongReach = Math.sqrt(Math.max(0, clearanceM ** 2 - perpendicularDistance ** 2));
    rangeStart = Math.min(otherSegment.start[axis], otherSegment.end[axis]) - alongReach;
    rangeEnd = Math.max(otherSegment.start[axis], otherSegment.end[axis]) + alongReach;
  } else {
    const otherPerpendicularStart = Math.min(otherSegment.start[perpendicularAxis], otherSegment.end[perpendicularAxis]);
    const otherPerpendicularEnd = Math.max(otherSegment.start[perpendicularAxis], otherSegment.end[perpendicularAxis]);
    const fixed = segment.start[perpendicularAxis];
    const perpendicularDistance = fixed < otherPerpendicularStart
      ? otherPerpendicularStart - fixed
      : fixed > otherPerpendicularEnd
        ? fixed - otherPerpendicularEnd
        : 0;
    if (perpendicularDistance >= clearanceM) return undefined;
    const alongReach = Math.sqrt(Math.max(0, clearanceM ** 2 - perpendicularDistance ** 2));
    const crossingAxisValue = otherSegment.start[axis];
    rangeStart = crossingAxisValue - alongReach;
    rangeEnd = crossingAxisValue + alongReach;
  }

  const segmentMinimum = Math.min(segment.start[axis], segment.end[axis]);
  const segmentMaximum = Math.max(segment.start[axis], segment.end[axis]);
  const clippedStart = Math.max(segmentMinimum, rangeStart);
  const clippedEnd = Math.min(segmentMaximum, rangeEnd);
  if (clippedEnd - clippedStart <= EPSILON) return undefined;
  const first = (clippedStart - segment.start[axis]) / delta;
  const second = (clippedEnd - segment.start[axis]) / delta;
  const point = interpolateSegment(segment, (first + second) / 2);
  const otherPoint: Point2 = [
    Math.max(Math.min(otherSegment.start[0], otherSegment.end[0]), Math.min(Math.max(otherSegment.start[0], otherSegment.end[0]), point[0])),
    Math.max(Math.min(otherSegment.start[1], otherSegment.end[1]), Math.min(Math.max(otherSegment.start[1], otherSegment.end[1]), point[1])),
  ];
  return {
    end: Math.max(first, second),
    otherPoint,
    point,
    start: Math.min(first, second),
  };
}

function bridgePlanarPath(
  points: Point2[],
  baseZ: number,
  route: RouteDefinition,
  placed: PlacedWire[],
) {
  const routeSegments = segments(points);
  const segmentLengths = routeSegments.map((segment) => planarLength([segment.start, segment.end]));
  const segmentOffsets: number[] = [];
  segmentLengths.reduce((offset, length) => {
    segmentOffsets.push(offset);
    return offset + length;
  }, 0);
  const routeLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  const intervals: BridgeInterval[] = [];

  routeSegments.forEach((segment, segmentIndex) => {
    const segmentLength = segmentLengths[segmentIndex];
    placed.forEach((other) => segments(other.points).forEach((otherSegment) => {
      const clearance = route.radiusM + other.route.radiusM + 0.0035;
      const conflict = clearanceInterval(segment, otherSegment, clearance);
      if (!conflict) return;
      let intervalStart = Math.max(
        0,
        segmentOffsets[segmentIndex] + conflict.start * segmentLength - 0.001,
      );
      let intervalEnd = Math.min(
        routeLength,
        segmentOffsets[segmentIndex] + conflict.end * segmentLength + 0.001,
      );
      // Cables attached to one stud may meet at the stud, but sharing that
      // terminal does not exempt their entire routes from clearance checks.
      // Preserve only a short fan-out allowance, then separate any continued
      // parallel run in depth like every other conflict.
      const terminalFanoutM = Math.max(0.012, clearance * 1.2);
      const sharedTerminals = [route.from, route.to].filter((terminal) => (
        terminal === other.route.from || terminal === other.route.to
      ));
      if (sharedTerminals.includes(route.from)) intervalStart = Math.max(intervalStart, terminalFanoutM);
      if (sharedTerminals.includes(route.to)) intervalEnd = Math.min(intervalEnd, routeLength - terminalFanoutM);
      if (intervalEnd - intervalStart <= EPSILON) return;
      const otherRange = projectedZRangeAt(other.points3, conflict.otherPoint);
      if (process.env.DSE_TRACE_CONFLICT === `${route.id}:${other.route.id}`) {
        process.stderr.write(`${JSON.stringify({ route: route.id, other: other.route.id, segment, otherSegment, conflict, baseZ, otherRange, clearance })}\n`);
      }
      intervals.push({
        constraints: [{ clearance, maximumZ: otherRange.maximumZ, minimumZ: otherRange.minimumZ }],
        start: intervalStart,
        end: intervalEnd,
        z: baseZ,
      });
    }));
  });

  intervals.sort((first, second) => first.start - second.start || first.end - second.end);
  const merged: BridgeInterval[] = [];
  intervals.forEach((interval) => {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end + EPSILON) {
      merged.push({ ...interval, constraints: [...interval.constraints] });
      return;
    }
    previous.end = Math.max(previous.end, interval.end);
    previous.constraints.push(...interval.constraints);
  });

  merged.forEach((interval) => {
    const minimumZ = route.radiusM + 0.003;
    const maximumZ = MAXIMUM_ALLOWED_FORWARD_M - route.radiusM;
    const candidates = new Set<number>([baseZ]);
    interval.constraints.forEach((constraint) => {
      candidates.add(constraint.minimumZ - constraint.clearance - 0.0005);
      candidates.add(constraint.maximumZ + constraint.clearance + 0.0005);
    });
    const safe = [...candidates].filter((candidate) => (
      candidate >= minimumZ && candidate <= maximumZ &&
      interval.constraints.every((constraint) => (
        candidate + constraint.clearance <= constraint.minimumZ ||
        candidate - constraint.clearance >= constraint.maximumZ
      ))
    ));
    interval.z = (safe.length > 0 ? safe : [...candidates]).sort((first, second) => (
      Math.abs(first - baseZ) - Math.abs(second - baseZ) || first - second
    ))[0];
  });

  const active = merged.filter((interval) => Math.abs(interval.z - baseZ) > EPSILON);

  const pointAtDistance = (distance: number) => {
    const clamped = Math.max(0, Math.min(routeLength, distance));
    let segmentIndex = segmentLengths.length - 1;
    for (let index = 0; index < segmentLengths.length; index += 1) {
      if (clamped <= segmentOffsets[index] + segmentLengths[index] + EPSILON) {
        segmentIndex = index;
        break;
      }
    }
    const local = segmentLengths[segmentIndex] < EPSILON
      ? 0
      : (clamped - segmentOffsets[segmentIndex]) / segmentLengths[segmentIndex];
    return interpolateSegment(routeSegments[segmentIndex], Math.max(0, Math.min(1, local)));
  };
  const appendPlanarRange = (output: Point3[], start: number, end: number, z: number) => {
    if (end - start <= EPSILON) return;
    const from = pointAtDistance(start);
    output.push([from[0], from[1], z]);
    points.slice(1, -1).forEach((point, index) => {
      const distance = segmentOffsets[index + 1];
      if (distance > start + EPSILON && distance < end - EPSILON) output.push([point[0], point[1], z]);
    });
    const to = pointAtDistance(end);
    output.push([to[0], to[1], z]);
  };

  const output: Point3[] = [[points[0][0], points[0][1], baseZ]];
  let cursor = 0;
  active.forEach((interval) => {
    appendPlanarRange(output, cursor, interval.start, baseZ);
    const start = pointAtDistance(interval.start);
    output.push([start[0], start[1], interval.z]);
    appendPlanarRange(output, interval.start, interval.end, interval.z);
    const end = pointAtDistance(interval.end);
    output.push([end[0], end[1], baseZ]);
    cursor = interval.end;
  });
  appendPlanarRange(output, cursor, routeLength, baseZ);
  const unbridgeableConflicts = active.filter((interval) => (
    interval.start <= EPSILON || interval.end >= routeLength - EPSILON
  )).length;
  const unsatisfiedBridgeConstraints = merged.filter((interval) => interval.constraints.some((constraint) => !(
    interval.z + constraint.clearance <= constraint.minimumZ ||
    interval.z - constraint.clearance >= constraint.maximumZ
  ))).length;
  return { bridgeCount: active.length, points: compact3(output), unbridgeableConflicts, unsatisfiedBridgeConstraints };
}

function spatialLength(points: Point3[]) {
  return points.slice(1).reduce((sum, point, index) => (
    sum + Math.abs(point[0] - points[index][0]) +
      Math.abs(point[1] - points[index][1]) +
      Math.abs(point[2] - points[index][2])
  ), 0);
}

const cableLengthMultiplier = (radiusM: number) => radiusM >= 0.005 ? 2 : 1;

function routeTurnCount3d(points: Point3[]) {
  const compacted = compactRendered3(points);
  return compacted.slice(1, -1).reduce((turns, point, index) => {
    const previous = compacted[index];
    const next = compacted[index + 2];
    const incoming = point.map((value, axis) => Math.sign(value - previous[axis])) as Point3;
    const outgoing = next.map((value, axis) => Math.sign(value - point[axis])) as Point3;
    return turns + Number(incoming.some((value, axis) => value !== outgoing[axis]));
  }, 0);
}

function routeBacktrackingCorners3d(points: Point3[]) {
  const compacted = compactRendered3(points);
  return compacted.slice(1, -1).reduce((backtracks, point, index) => {
    const previous = compacted[index];
    const next = compacted[index + 2];
    const incoming = point.map((value, axis) => Math.sign(value - previous[axis])) as Point3;
    const outgoing = next.map((value, axis) => Math.sign(value - point[axis])) as Point3;
    const incomingAxis = incoming.findIndex((value) => value !== 0);
    const outgoingAxis = outgoing.findIndex((value) => value !== 0);
    return backtracks + Number(
      incomingAxis >= 0 && incomingAxis === outgoingAxis &&
      incoming[incomingAxis] === -outgoing[outgoingAxis],
    );
  }, 0);
}

function routeWallDistanceCost(points: Point3[], radiusM: number) {
  return points.slice(1).reduce((cost, point, index) => {
    const start = points[index];
    const length = Math.abs(point[0] - start[0]) + Math.abs(point[1] - start[1]) + Math.abs(point[2] - start[2]);
    const cableSurfaceDistanceFromWall = Math.max(0, (start[2] + point[2]) / 2 - radiusM);
    return cost + length * cableSurfaceDistanceFromWall;
  }, 0);
}

function routingCostSummary(routes: Record<string, RoutedWire>) {
  const values = Object.values(routes);
  const totalLengthM = values.reduce((sum, route) => sum + route.lengthM, 0);
  const weightedLengthM = values.reduce((sum, route) => (
    sum + route.lengthM * cableLengthMultiplier(route.radiusM)
  ), 0);
  const wallDistanceCostM2 = values.reduce((sum, route) => (
    sum + routeWallDistanceCost(route.points, route.radiusM)
  ), 0);
  const turnCount3d = values.reduce((sum, route) => sum + routeTurnCount3d(route.points), 0);
  return {
    routingCost: weightedLengthM + wallDistanceCostM2 * 20 + turnCount3d * 0.015,
    totalLengthM,
    turnCount3d,
    wallDistanceCostM2,
    weightedLengthM,
  };
}

function portApproachViolations(
  routes: Record<string, RoutedWire>,
  ports: Record<string, PortSpecification>,
) {
  const alignedOutward = (from: Point3, to: Point3, direction: PortDirection) => {
    const delta = to.map((value, axis) => value - from[axis]) as Point3;
    const length = Math.hypot(...delta);
    if (length < PORT_STRAIGHT_APPROACH_M - 0.0005) return false;
    const dot = delta.reduce((sum, value, axis) => sum + value * direction[axis], 0) / length;
    const lateral = Math.hypot(...delta.map((value, axis) => value - direction[axis] * length) as Point3);
    return dot > 0.999 && lateral < 0.0005;
  };
  return Object.values(routes).reduce((violations, route) => {
    const source = ports[route.from];
    const target = ports[route.to];
    const sourceClear = Boolean(source && route.points[1] && alignedOutward(
      route.points[0], route.points[1], source.direction,
    ));
    const targetClear = Boolean(target && route.points.at(-2) && alignedOutward(
      route.points.at(-1)!, route.points.at(-2)!, target.direction,
    ));
    return violations + Number(!sourceClear) + Number(!targetClear);
  }, 0);
}

function coincidentRunOverlap(routes: Record<string, RoutedWire>) {
  const values = Object.values(routes);
  let overlapM = 0;
  const segmentAxis = (start: Point3, end: Point3) => {
    const changed = start.map((value, axis) => Math.abs(value - end[axis]) > EPSILON);
    return changed.filter(Boolean).length === 1 ? changed.findIndex(Boolean) : -1;
  };
  const endpointFor = (route: RoutedWire, terminal: string) => (
    terminal === route.from ? route.points[0] : route.points.at(-1)!
  );

  values.forEach((first, firstIndex) => values.slice(firstIndex + 1).forEach((second) => {
    const sharedTerminals = [first.from, first.to].filter((terminal) => (
      terminal === second.from || terminal === second.to
    ));
    const fanoutAllowanceM = Math.max(0.012, (first.radiusM + second.radiusM + 0.0035) * 1.2);
    first.points.slice(1).forEach((firstEnd, firstSegmentIndex) => {
      const firstStart = first.points[firstSegmentIndex];
      const axis = segmentAxis(firstStart, firstEnd);
      if (axis < 0) return;
      second.points.slice(1).forEach((secondEnd, secondSegmentIndex) => {
        const secondStart = second.points[secondSegmentIndex];
        if (segmentAxis(secondStart, secondEnd) !== axis) return;
        const fixedAxes = [0, 1, 2].filter((candidate) => candidate !== axis);
        if (fixedAxes.some((candidate) => (
          Math.abs(firstStart[candidate] - secondStart[candidate]) > EPSILON
        ))) return;
        const low = Math.max(
          Math.min(firstStart[axis], firstEnd[axis]),
          Math.min(secondStart[axis], secondEnd[axis]),
        );
        const high = Math.min(
          Math.max(firstStart[axis], firstEnd[axis]),
          Math.max(secondStart[axis], secondEnd[axis]),
        );
        if (high - low <= EPSILON) return;

        // Two lugs may leave one stud together for the short fan-out distance
        // reserved by bridgePlanarPath. Ignore only that local, hidden bundle;
        // any continued same-depth centerline is a visible coincident run and
        // would produce the flicker/z-fighting seen in the rendered harness.
        let remaining: Array<[number, number]> = [[low, high]];
        sharedTerminals.forEach((terminal) => {
          const terminalPoint = endpointFor(first, terminal);
          if (fixedAxes.some((candidate) => (
            Math.abs(terminalPoint[candidate] - firstStart[candidate]) > EPSILON
          ))) return;
          const cutLow = terminalPoint[axis] - fanoutAllowanceM;
          const cutHigh = terminalPoint[axis] + fanoutAllowanceM;
          remaining = remaining.flatMap(([start, end]) => {
            if (cutHigh <= start || cutLow >= end) return [[start, end]];
            const pieces: Array<[number, number]> = [];
            if (cutLow > start + EPSILON) pieces.push([start, Math.min(end, cutLow)]);
            if (cutHigh < end - EPSILON) pieces.push([Math.max(start, cutHigh), end]);
            return pieces;
          });
        });
        overlapM += remaining.reduce((sum, [start, end]) => sum + end - start, 0);
      });
    });
  }));
  return round(overlapM);
}

type HardPlacedWire = {
  centerline: Point3[];
  route: RouteDefinition;
};

function pointSegmentDistance3d(point: Point3, start: Point3, end: Point3) {
  const direction: Point3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const lengthSquared = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  const amount = lengthSquared < EPSILON
    ? 0
    : Math.max(0, Math.min(1, (
        (point[0] - start[0]) * direction[0] +
        (point[1] - start[1]) * direction[1] +
        (point[2] - start[2]) * direction[2]
      ) / lengthSquared));
  return Math.hypot(
    point[0] - (start[0] + direction[0] * amount),
    point[1] - (start[1] + direction[1] * amount),
    point[2] - (start[2] + direction[2] * amount),
  );
}

function hardClearanceAxialPoint(port: PortSpecification, route: RouteDefinition): Point3 {
  const approach = Math.max(PORT_STRAIGHT_APPROACH_M, route.radiusM * 2 + 0.003);
  const available = port.direction[2] > 0.5
    ? MAXIMUM_ALLOWED_FORWARD_M - route.radiusM - port.position[2]
    : approach;
  const length = Math.max(port.lengthM, Math.min(approach, available));
  const axial = port.position.map((value, axis) => round(value + port.direction[axis] * length)) as Point3;
  return axial;
}

function coordinateAxis(minimum: number, maximum: number, step: number, extras: number[]) {
  const values = new Set<number>([round(minimum), round(maximum)]);
  for (let value = minimum; value <= maximum + EPSILON; value += step) values.add(round(Math.min(maximum, value)));
  extras.forEach((value) => {
    if (value >= minimum - EPSILON && value <= maximum + EPSILON) values.add(round(value));
  });
  return [...values].sort((first, second) => first - second);
}

function hardClearanceRoute(
  route: RouteDefinition,
  ports: Record<string, PortSpecification>,
  components: Record<string, { center: Point2; size: Point2 }>,
  placed: HardPlacedWire[],
  cableGridPaddingM = 0.001,
) {
  const sourcePort = ports[route.from];
  const targetPort = ports[route.to];
  if (!sourcePort || !targetPort) throw new Error(`Missing port specification for ${route.id}`);
  const source = hardClearanceAxialPoint(sourcePort, route);
  const target = hardClearanceAxialPoint(targetPort, route);
  const cellSizeM = 0.005;
  const wallGapM = 0.001;
  const endpointOwners = new Set([terminalOwner(route.from), terminalOwner(route.to)].filter(Boolean));
  const minimum: Point3 = [
    INNER_LEFT + route.radiusM,
    INNER_BOTTOM + route.radiusM,
    route.radiusM + wallGapM,
  ];
  const maximum: Point3 = [
    INNER_RIGHT - route.radiusM,
    INNER_TOP - route.radiusM,
    MAXIMUM_ALLOWED_FORWARD_M - route.radiusM,
  ];
  if ([source, target].some((point) => point.some((value, axis) => (
    value < minimum[axis] - EPSILON || value > maximum[axis] + EPSILON
  )))) return undefined;
  const obstacleCoordinates = Object.entries(components).flatMap(([id, component]) => {
    const clearance = route.radiusM + 0.0015 + (endpointOwners.has(id) ? 0 : cellSizeM);
    return [
      [component.center[0] - component.size[0] / 2 - clearance, component.center[1], 0],
      [component.center[0] + component.size[0] / 2 + clearance, component.center[1], 0],
      [component.center[0], Math.max(BOTTOM_ROUTING_GUTTER_TOP_Y, component.center[1] - component.size[1] / 2 - clearance), 0],
      [component.center[0], component.center[1] + component.size[1] / 2 + clearance, (COMPONENT_FRONT_Z_M[id] ?? 0.06) + clearance],
    ] as Point3[];
  });
  const xs = coordinateAxis(minimum[0], maximum[0], cellSizeM, [source[0], target[0], ...obstacleCoordinates.map((point) => point[0])]);
  const ys = coordinateAxis(minimum[1], maximum[1], cellSizeM, [source[1], target[1], ...obstacleCoordinates.map((point) => point[1])]);
  const zs = coordinateAxis(minimum[2], maximum[2], cellSizeM, [source[2], target[2], ...obstacleCoordinates.map((point) => point[2])]);
  const nx = xs.length;
  const ny = ys.length;
  const nodeCount = nx * ny * zs.length;
  const nodeIndex = (x: number, y: number, z: number) => x + y * nx + z * nx * ny;
  const coordinates = (index: number) => {
    const z = Math.floor(index / (nx * ny));
    const remainder = index - z * nx * ny;
    const y = Math.floor(remainder / nx);
    return [remainder - y * nx, y, z] as const;
  };
  const world = (index: number): Point3 => {
    const [x, y, z] = coordinates(index);
    return [xs[x], ys[y], zs[z]];
  };
  const coordinateIndex = (values: number[], value: number) => values.findIndex((candidate) => Math.abs(candidate - value) < EPSILON);
  const start = nodeIndex(coordinateIndex(xs, source[0]), coordinateIndex(ys, source[1]), coordinateIndex(zs, source[2]));
  const goal = nodeIndex(coordinateIndex(xs, target[0]), coordinateIndex(ys, target[1]), coordinateIndex(zs, target[2]));
  const blocked = new Uint8Array(nodeCount);
  const indexRange = (values: number[], low: number, high: number) => {
    const result: number[] = [];
    values.forEach((value, index) => {
      if (value >= low - EPSILON && value <= high + EPSILON) result.push(index);
    });
    return result;
  };
  const markBlockedAroundSegment = (begin: Point3, end: Point3, clearance: number) => {
    const xRange = indexRange(xs, Math.min(begin[0], end[0]) - clearance, Math.max(begin[0], end[0]) + clearance);
    const yRange = indexRange(ys, Math.min(begin[1], end[1]) - clearance, Math.max(begin[1], end[1]) + clearance);
    const zRange = indexRange(zs, Math.min(begin[2], end[2]) - clearance, Math.max(begin[2], end[2]) + clearance);
    xRange.forEach((x) => yRange.forEach((y) => zRange.forEach((z) => {
      const point: Point3 = [xs[x], ys[y], zs[z]];
      if (pointSegmentDistance3d(point, begin, end) < clearance - EPSILON) blocked[nodeIndex(x, y, z)] = 1;
    })));
  };
  Object.entries(components).forEach(([id, component]) => {
    const clearance = route.radiusM + 0.0015 + (endpointOwners.has(id) ? 0 : cellSizeM);
    const xRange = indexRange(xs, component.center[0] - component.size[0] / 2 - clearance, component.center[0] + component.size[0] / 2 + clearance);
    const yRange = indexRange(
      ys,
      Math.max(BOTTOM_ROUTING_GUTTER_TOP_Y, component.center[1] - component.size[1] / 2 - clearance),
      component.center[1] + component.size[1] / 2 + clearance,
    );
    const zRange = indexRange(zs, 0, (COMPONENT_FRONT_Z_M[id] ?? 0.06) + clearance);
    xRange.forEach((x) => yRange.forEach((y) => zRange.forEach((z) => { blocked[nodeIndex(x, y, z)] = 1; })));
  });
  placed.forEach((other) => {
    // Inflate occupied samples by half a cell beyond the requested 1 mm air
    // gap. This makes every grid edge conservative, then the exact rounded
    // centerline audit below remains the final authority.
    const clearance = route.radiusM + other.route.radiusM + 0.001 + cableGridPaddingM;
    other.centerline.slice(1).forEach((end, index) => {
      const begin = other.centerline[index];
      markBlockedAroundSegment(begin, end, clearance);
    });
  });
  // Reserve the one-way straight attachment corridor of every other port
  // before any cable is laid. Earlier routes therefore cannot consume the
  // only legal approach to a connector that will be routed later.
  Object.entries(ports).forEach(([terminalId, port]) => {
    if (terminalId === route.from || terminalId === route.to) return;
    const axial = hardClearanceAxialPoint(port, {
      from: terminalId,
      id: `reserved-${terminalId}`,
      kind: "data",
      radiusM: port.cableRadiusM,
      to: terminalId,
    });
    if (process.env.DSE_TRACE_CONFLICT) {
      const clearance = route.radiusM + port.cableRadiusM + 0.001;
      if (pointSegmentDistance3d(source, port.position, axial) < clearance - EPSILON) {
        process.stderr.write(`${route.id}: source approach conflicts reserved ${terminalId}\n`);
      }
      if (pointSegmentDistance3d(target, port.position, axial) < clearance - EPSILON) {
        process.stderr.write(`${route.id}: target approach conflicts reserved ${terminalId}\n`);
      }
    }
    markBlockedAroundSegment(
      port.position,
      axial,
      route.radiusM + port.cableRadiusM + 0.001,
    );
  });
  const insideExactComponent = (point: Point3) => Object.entries(components).some(([id, component]) => {
    const clearance = route.radiusM + 0.0015;
    return point[0] >= component.center[0] - component.size[0] / 2 - clearance &&
      point[0] <= component.center[0] + component.size[0] / 2 + clearance &&
      point[1] >= component.center[1] - component.size[1] / 2 - clearance &&
      point[1] <= component.center[1] + component.size[1] / 2 + clearance &&
      point[2] <= (COMPONENT_FRONT_Z_M[id] ?? 0.06) + clearance;
  });
  // A bend-clearance halo may touch a legal gland/terminal approach even
  // though the actual finite-radius cable clears the device. Preserve the
  // exact endpoint in that case; all neighboring cells and the final rounded
  // audit remain protected.
  if (!insideExactComponent(source)) blocked[start] = 0;
  if (!insideExactComponent(target)) blocked[goal] = 0;
  if (blocked[start] || blocked[goal]) {
    if (process.env.DSE_TRACE_CONFLICT) {
      const componentHits = (point: Point3) => Object.entries(components).filter(([id, component]) => {
        const clearance = route.radiusM + 0.0015 + (endpointOwners.has(id) ? 0 : cellSizeM);
        return point[0] >= component.center[0] - component.size[0] / 2 - clearance &&
          point[0] <= component.center[0] + component.size[0] / 2 + clearance &&
          point[1] >= component.center[1] - component.size[1] / 2 - clearance &&
          point[1] <= component.center[1] + component.size[1] / 2 + clearance &&
          point[2] <= (COMPONENT_FRONT_Z_M[id] ?? 0.06) + clearance;
      }).map(([id]) => id);
      process.stderr.write(`${route.id}: blocked hard-route endpoint ${JSON.stringify({ source: blocked[start], target: blocked[goal], sourceComponents: componentHits(source), targetComponents: componentHits(target) })}\n`);
    }
    return undefined;
  }

  const stateCount = nodeCount * 7;
  const distances = new Float64Array(stateCount);
  distances.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount);
  previous.fill(-1);
  const heap = new MinimumHeap();
  const startState = start * 7 + 6;
  distances[startState] = 0;
  const heuristic = (index: number) => {
    const here = world(index);
    return Math.abs(here[0] - target[0]) + Math.abs(here[1] - target[1]) + Math.abs(here[2] - target[2]);
  };
  heap.push({ cost: heuristic(start), state: startState });
  let finalState = -1;
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  while (heap.size > 0) {
    const current = heap.pop()!;
    const node = Math.floor(current.state / 7);
    const distance = distances[current.state];
    if (current.cost > distance + heuristic(node) + EPSILON) continue;
    if (node === goal) {
      finalState = current.state;
      break;
    }
    const [x, y, z] = coordinates(node);
    directions.forEach(([dx, dy, dz], direction) => {
      const nextX = x + dx;
      const nextY = y + dy;
      const nextZ = z + dz;
      if (nextX < 0 || nextX >= nx || nextY < 0 || nextY >= ny || nextZ < 0 || nextZ >= zs.length) return;
      const next = nodeIndex(nextX, nextY, nextZ);
      if (blocked[next]) return;
      const nextPoint = world(next);
      const point = world(node);
      const length = Math.abs(nextPoint[0] - point[0]) + Math.abs(nextPoint[1] - point[1]) + Math.abs(nextPoint[2] - point[2]);
      const priorDirection = current.state % 7;
      const turnCost = priorDirection === 6 || priorDirection === direction ? 0 : 0.012;
      const depthCost = dz === 0 ? nextPoint[2] * length * 0.45 : length * 0.15;
      const nextDistance = distance + length + turnCost + depthCost;
      const nextState = next * 7 + direction;
      if (nextDistance + EPSILON >= distances[nextState]) return;
      distances[nextState] = nextDistance;
      previous[nextState] = current.state;
      heap.push({ cost: nextDistance + heuristic(next), state: nextState });
    });
  }
  if (finalState < 0) {
    if (process.env.DSE_TRACE_CONFLICT) process.stderr.write(`${route.id}: A* exhausted the clearance grid\n`);
    return undefined;
  }
  const nodes: number[] = [];
  for (let state = finalState; state >= 0; state = previous[state]) nodes.push(Math.floor(state / 7));
  const gridPoints = nodes.reverse().map(world);
  const points = compactRendered3([
    [...sourcePort.position] as Point3,
    ...gridPoints,
    [...targetPort.position] as Point3,
  ]);
  const centerline = sampleRoundedCableCenterline(
    points,
    Math.max(route.radiusM * 4.25, 0.009),
    route.radiusM,
  ).centerline.map((point) => [point.x, point.y, point.z] as Point3);
  if (componentSolidIntersections(centerline, route, components) > 0) {
    if (process.env.DSE_TRACE_CONFLICT) process.stderr.write(`${route.id}: rounded result contacted a component\n`);
    return undefined;
  }
  const cableContacts = placed.filter((other) => routePairHasClearanceConflict(centerline, route, {
    collisionPoints3: other.centerline,
    points: [],
    points3: [],
    route: other.route,
  }));
  if (cableContacts.length > 0) {
    if (process.env.DSE_TRACE_CONFLICT) {
      const details = cableContacts.map((other) => {
        let closest = { distanceM: Number.POSITIVE_INFINITY, firstPoint: [0, 0, 0] as Point3, secondPoint: [0, 0, 0] as Point3 };
        centerline.slice(1).forEach((end, index) => other.centerline.slice(1).forEach((otherEnd, otherIndex) => {
          const next = closestSegmentPoints3d(centerline[index], end, other.centerline[otherIndex], otherEnd);
          if (next.distanceM < closest.distanceM) closest = next;
        }));
        return { id: other.route.id, closest, otherPoints: other.centerline };
      });
      process.stderr.write(`${route.id}: rounded result contacts ${JSON.stringify({ details, points })}\n`);
    }
    return undefined;
  }
  return { centerline, points };
}

function routeAllWithHardClearance(
  evaluation: Evaluation,
): Record<string, RoutedWire> | undefined {
  if (!evaluation.ports || !evaluation.components) return undefined;
  const thickPriority = (route: RouteDefinition) => (
    route.id === "switch-led-negative" ? -1 :
    route.id.startsWith("multiplus-") ? 0 :
    route.id.startsWith("battery-") ? 1 :
    route.id === "selector-to-positive-bus" || route.id === "shunt-to-negative-bus" ? 2 : 3
  );
  const ordered = [...ROUTE_DEFINITIONS].sort((first, second) => (
    second.radiusM - first.radiusM || thickPriority(first) - thickPriority(second) || first.id.localeCompare(second.id)
  ));
  const placed: HardPlacedWire[] = [];
  const routes: Record<string, RoutedWire> = {};
  for (const route of ordered) {
    let solved: ReturnType<typeof hardClearanceRoute> = undefined;
    for (const paddingM of [0.001, 0.002, 0.003, 0.004]) {
      solved = hardClearanceRoute(route, evaluation.ports, evaluation.components, placed, paddingM);
      if (solved) break;
    }
    if (!solved) {
      if (process.env.DSE_TRACE_CONFLICT) {
        process.stderr.write(`Hard-clearance A* failed at ${route.id} after ${placed.length} routes\n`);
      }
      return undefined;
    }
    const points = solved.points.map((point) => point.map((value) => round(value)) as Point3);
    routes[route.id] = {
      bends: Math.max(0, points.length - 2),
      from: route.from,
      id: route.id,
      kind: route.kind,
      lane: Math.max(0, Math.round(Math.max(...points.map((point) => point[2])) / DEPTH_LEVEL_STEP_M)),
      lengthM: round(spatialLength(points)),
      points,
      radiusM: route.radiusM,
      to: route.to,
    };
    placed.push({ centerline: solved.centerline, route });
  }
  return Object.fromEntries(ROUTE_DEFINITIONS.map((route) => [route.id, routes[route.id]]));
}

function auditSpatialRoutes(routes: Record<string, RoutedWire>) {
  const audit = new CableRoutingSystem();
  Object.values(routes).forEach((route) => {
    audit.prepareRoute(route.points, route.radiusM, "junction", false);
  });
  const report = audit.report();
  if (process.env.DSE_TRACE_CABLES && report.unresolvedCableIssues.length > 0) {
    process.stderr.write(`${report.unresolvedCableIssues.join("\n")}\n`);
  }
  return {
    backtrackingCorners3d: report.backtrackingCorners,
    coincidentRunOverlapM: coincidentRunOverlap(routes),
    spatialIntersections: report.unresolvedCableIntersections,
  };
}

function auditRoundedComponentSolids(
  routes: Record<string, RoutedWire>,
  components: Record<string, { center: Point2; size: Point2 }>,
) {
  return Object.values(routes).reduce((hits, route) => {
    const centerline = sampleRoundedCableCenterline(
      route.points,
      Math.max(route.radiusM * 4.25, 0.009),
      route.radiusM,
    ).centerline.map((point) => [point.x, point.y, point.z] as Point3);
    return hits + componentSolidIntersections(centerline, routeById[route.id], components);
  }, 0);
}

function finalizeDetailedEvaluation(evaluation: Evaluation): Evaluation {
  if (!evaluation.routes) return evaluation;
  const clearanceSolved = routeAllWithHardClearance(evaluation);
  if (!clearanceSolved) {
    throw new Error("Hard-clearance junction routing failed: no collision-free route set exists for this component/gland placement");
  }
  const routes = Object.fromEntries(Object.entries(clearanceSolved).map(([id, route]) => {
    // Route generation and crossover repair are already radius-aware at the
    // enclosure limits. Mutating individual coordinates here used to detach
    // gland endpoints and could turn the final short segment diagonal.
    const points = compactRendered3(route.points.map((point) => [...point] as Point3));
    return [id, { ...route, lengthM: round(spatialLength(points)), points }];
  }));
  const audit = auditSpatialRoutes(routes);
  const cost = routingCostSummary(routes);
  const maximumForwardM = round(Math.max(...Object.values(routes).flatMap((route) => (
    route.points.map((point) => point[2] + route.radiusM)
  ))));
  const roundedSolidIntersections = evaluation.components
    ? auditRoundedComponentSolids(routes, evaluation.components)
    : evaluation.metrics.solidIntersections;
  const portViolations = evaluation.ports
    ? portApproachViolations(routes, evaluation.ports)
    : evaluation.metrics.portApproachViolations;
  if (
    audit.spatialIntersections > 0 ||
    roundedSolidIntersections > 0 ||
    portViolations > 0
  ) {
    throw new Error(
      `Junction publish gate failed: ${audit.spatialIntersections} cable contacts, ` +
      `${roundedSolidIntersections} device contacts, ${portViolations} port-approach violations`,
    );
  }
  const metrics: EvaluationMetrics = {
    ...evaluation.metrics,
    backtrackingCorners3d: audit.backtrackingCorners3d,
    coincidentRunOverlapM: audit.coincidentRunOverlapM,
    maximumForwardM,
    portApproachViolations: portViolations,
    routingCost: round(cost.routingCost),
    score: 0,
    solidIntersections: roundedSolidIntersections,
    spatialIntersections: audit.spatialIntersections,
    totalLengthM: round(cost.totalLengthM),
    turnCount3d: cost.turnCount3d,
    wallDistanceCostM2: round(cost.wallDistanceCostM2),
    weightedLengthM: round(cost.weightedLengthM),
  };
  metrics.score = round(metricScore(metrics));
  return { ...evaluation, metrics, routes };
}

function routeWires(
  genome: Genome,
  terminals: Record<string, Point2>,
  components: Record<string, { center: Point2; size: Point2 }>,
  glands: Record<string, GlandPlacement>,
) {
  const placed: PlacedWire[] = [];
  const routed = new Map<string, RoutedWire>();
  let planarBends = 0;
  let bridgeCount = 0;
  let directionReversalCount = 0;
  let solidIntersections = 0;
  let wireCrossings = 0;
  let wireOverlapM = 0;
  let maximumPlanarBends = 0;
  let spatialIntersections = 0;
  let unbridgeableConflicts = 0;
  let unsatisfiedBridgeConstraints = 0;

  for (const routeId of genome.routeOrder) {
    const route = routeById[routeId];
    let closestRejected: { count: number; ids: string[]; points3: Point3[] } | undefined;
    // The channel generator can produce hundreds of near-equivalent paths as
    // the placed bundle grows. Keep the best obstacle-aware shortlist, then
    // run the expensive rounded-tube and finite-radius pair audit on every
    // depth plane in that shortlist. This preserves exact final acceptance
    // while keeping one evolutionary evaluation practical.
    const paths = candidatePaths(route, terminals, components, placed).slice(0, 32);
    let selected: {
      bends: number;
      backtrackingCorners3d: number;
      bridgeCount: number;
      cableClearanceConflicts: number;
      corePoints: Point2[];
      crossings: number;
      lengthM: number;
      maximumForwardM: number;
      overlapM: number;
      planeZ: number;
      points: Point2[];
      points3: Point3[];
      collisionPoints3: Point3[];
      projectedComponentCrossings: number;
      reversals: number;
      score: number;
      solidIntersections: number;
      solidIntersectionIds: string[];
      unbridgeableConflicts: number;
      unsatisfiedBridgeConstraints: number;
    } | undefined;
    for (const path of paths) {
      const allRelationships = placed.map((other) => ({ other, ...routeRelationship(path.points, other.points) }));
      const crossings = allRelationships.reduce((sum, relationship) => sum + relationship.crossings, 0);
      const overlapM = allRelationships.reduce((sum, relationship) => sum + relationship.overlapM, 0);
      const context = routeGeometryContext(route, terminals, components);
      for (const planeZ of routePlaneCandidates(route)) {
        // Bridge only the portal-to-portal run. A selector terminal first
        // travels behind its rotary body to the assigned edge portal; its
        // depth change happens outside that body, never through its face.
        const bridgedPath = bridgePlanarPath(path.corePoints, planeZ, route, placed);
        const bridgeCandidates = [
          {
            bridgeCount: 0,
            points: path.corePoints.map((point) => [point[0], point[1], planeZ] as Point3),
            unbridgeableConflicts: 0,
            unsatisfiedBridgeConstraints: 0,
          },
          ...(bridgedPath.unbridgeableConflicts === 0 ? [bridgedPath] : []),
        ];
        for (const bridged of bridgeCandidates) {
        const startZ = terminalZ(route.from, glands);
        const endZ = terminalZ(route.to, glands);
        const sourceGland = glandForTerminal(route.from, glands);
        const targetGland = glandForTerminal(route.to, glands);
        const straightApproachM = Math.max(PORT_STRAIGHT_APPROACH_M, route.radiusM * 2 + 0.003);
        const sourceDirection = terminalDirection(route.from);
        const targetDirection = terminalDirection(route.to);
        const sourcePortalZ = sourceDirection[2] > 0.5
          ? MAXIMUM_ALLOWED_FORWARD_M - route.radiusM
          : startZ;
        const targetPortalZ = targetDirection[2] > 0.5
          ? MAXIMUM_ALLOWED_FORWARD_M - route.radiusM
          : endZ;
        const sourceGlandApproach: Point2 = [
          context.actualStart[0],
          round(Math.min(context.start[1], context.actualStart[1] + straightApproachM)),
        ];
        const targetGlandApproach: Point2 = [
          context.actualEnd[0],
          round(Math.min(context.end[1], context.actualEnd[1] + straightApproachM)),
        ];
        const core = compact3(bridged.points);
        const sourceTransferIndex = sourceDirection[2] > 0.5 && core.length > 1 ? 1 : 0;
        const targetTransferIndex = targetDirection[2] > 0.5 && core.length > 1
          ? Math.max(sourceTransferIndex, core.length - 2)
          : core.length - 1;
        const assembled: Point3[] = [[context.actualStart[0], context.actualStart[1], startZ]];
        if (sourceGland) {
          assembled.push(
            [sourceGlandApproach[0], sourceGlandApproach[1], startZ],
            [sourceGlandApproach[0], sourceGlandApproach[1], core[0][2]],
          );
        } else if (sourceDirection[2] > 0.5) {
          assembled.push([context.actualStart[0], context.actualStart[1], sourcePortalZ]);
          if (
            Math.abs(context.start[0] - context.actualStart[0]) > EPSILON &&
            Math.abs(context.start[1] - context.actualStart[1]) > EPSILON
          ) {
            assembled.push([context.start[0], context.actualStart[1], sourcePortalZ]);
          }
          for (let index = 0; index <= sourceTransferIndex; index += 1) {
            assembled.push([core[index][0], core[index][1], sourcePortalZ]);
          }
          assembled.push([...core[sourceTransferIndex]] as Point3);
        } else if (context.sourceEscaped) {
          assembled.push([context.start[0], context.start[1], startZ]);
        }
        core.slice(sourceTransferIndex, targetTransferIndex + 1).forEach((point) => assembled.push([...point] as Point3));
        if (targetGland) {
          const last = core.at(-1)!;
          if (targetTransferIndex < core.length - 1) {
            core.slice(targetTransferIndex + 1).forEach((point) => assembled.push([...point] as Point3));
          }
          assembled.push(
            [targetGlandApproach[0], targetGlandApproach[1], last[2]],
            [targetGlandApproach[0], targetGlandApproach[1], endZ],
          );
        } else if (targetDirection[2] > 0.5) {
          assembled.push([core[targetTransferIndex][0], core[targetTransferIndex][1], targetPortalZ]);
          for (let index = targetTransferIndex + 1; index < core.length; index += 1) {
            assembled.push([core[index][0], core[index][1], targetPortalZ]);
          }
          if (
            Math.abs(context.end[0] - context.actualEnd[0]) > EPSILON &&
            Math.abs(context.end[1] - context.actualEnd[1]) > EPSILON
          ) {
            assembled.push([context.end[0], context.actualEnd[1], targetPortalZ]);
          }
          assembled.push([context.actualEnd[0], context.actualEnd[1], targetPortalZ]);
        } else if (context.targetEscaped) {
          assembled.push([context.end[0], context.end[1], endZ]);
        }
        assembled.push([context.actualEnd[0], context.actualEnd[1], endZ]);
        const points3 = compactRendered3(assembled);
        // Candidate acceptance must inspect the same rounded centerline that
        // Three.js renders. A rectilinear centerline can be clear while its
        // bend arc cuts inside a component corner or another cable envelope.
        const collisionPoints3 = sampleRoundedCableCenterline(
          points3,
          Math.max(route.radiusM * 4.25, 0.009),
          route.radiusM,
        ).centerline.map((point) => [point.x, point.y, point.z] as Point3);
        const lengthM = spatialLength(points3);
        const physicalSolidIntersectionIds = [
          ...path.solidIntersectionIds,
          ...componentSolidIntersectionIds(collisionPoints3, route, components),
        ];
        const physicalSolidIntersections = physicalSolidIntersectionIds.length;
        const conflictingPlaced = placed.filter((other) => (
          routePairHasClearanceConflict(collisionPoints3, route, other)
        ));
        const cableClearanceConflicts = conflictingPlaced.length;
        if (!closestRejected || cableClearanceConflicts < closestRejected.count) {
          closestRejected = {
            count: cableClearanceConflicts,
            ids: conflictingPlaced.map((other) => other.route.id),
            points3,
          };
        }
        if (process.env.DSE_REQUIRE_CLEARANCE && cableClearanceConflicts > 0) continue;
        const backtrackingCorners3d = routeBacktrackingCorners3d(points3);
        const turnCount3d = routeTurnCount3d(points3);
        const wallDistanceCostM2 = routeWallDistanceCost(points3, route.radiusM);
        const weightedLengthM = lengthM * cableLengthMultiplier(route.radiusM);
        const routingCost = weightedLengthM + wallDistanceCostM2 * 20 + turnCount3d * 0.015;
        const candidateMaximumForwardM = Math.max(...points3.map((point) => point[2] + route.radiusM));
        const depthOverflowM = Math.max(0, candidateMaximumForwardM - MAXIMUM_ALLOWED_FORWARD_M);
        const score =
          // No number of cable-to-cable conflicts can justify routing through
          // a component body; component clearance is an absolute constraint.
          physicalSolidIntersections * 1_000_000_000_000_000 +
          backtrackingCorners3d * 100_000_000_000_000_000_000_000 +
          cableClearanceConflicts * 10_000_000_000_000 +
          path.projectedComponentCrossings * 1_000_000 +
          bridged.unsatisfiedBridgeConstraints * 100_000_000_000 +
          bridged.unbridgeableConflicts * 10_000_000_000 +
          depthOverflowM * 100_000_000 +
          path.reversals * 1_000 +
          routingCost * 10_000 +
          crossings * 100 +
          overlapM * 1_000_000_000 +
          bridged.bridgeCount * 100;
        if (!selected || score < selected.score) {
          selected = {
            ...path,
            backtrackingCorners3d,
            solidIntersectionIds: physicalSolidIntersectionIds,
            solidIntersections: physicalSolidIntersections,
            bridgeCount: bridged.bridgeCount,
            cableClearanceConflicts,
            crossings,
            lengthM,
            maximumForwardM: candidateMaximumForwardM,
            overlapM,
            planeZ,
            points3,
            collisionPoints3,
            score,
            unbridgeableConflicts: bridged.unbridgeableConflicts,
            unsatisfiedBridgeConstraints: bridged.unsatisfiedBridgeConstraints,
          };
        }
        }
      }
    }
    if (!selected) {
      if (process.env.DSE_TRACE_CONFLICT && closestRejected) {
        process.stderr.write(`${JSON.stringify({
          route: route.id,
          closestRejected,
          conflicts: placed.filter((other) => closestRejected.ids.includes(other.route.id)).map((other) => ({
            id: other.route.id,
            points3: other.points3,
          })),
        }, null, 2)}\n`);
      }
      const detail = closestRejected
        ? `; closest candidate contacts ${closestRejected.count}: ${closestRejected.ids.join(", ")}`
        : "";
      throw new Error(`No route candidate generated for ${route.id}${detail}`);
    }
    if (process.env.DSE_TRACE_SOLIDS && selected.solidIntersections > 0) {
      process.stderr.write(`${route.id}: ${selected.solidIntersectionIds.join(", ")}\n`);
    }
    const depthLevel = Math.max(0, Math.ceil((selected.maximumForwardM - WIRE_PLANE_Z) / DEPTH_LEVEL_STEP_M));
    routed.set(route.id, {
      bends: selected.bends,
      from: route.from,
      id: route.id,
      kind: route.kind,
      lane: depthLevel,
      lengthM: round(selected.lengthM),
      points: selected.points3.map((point) => point.map((value) => round(value)) as Point3),
      radiusM: route.radiusM,
      to: route.to,
    });
    placed.push({
      collisionPoints3: selected.collisionPoints3,
      points: selected.points,
      points3: selected.points3,
      route,
    });
    planarBends += selected.bends;
    bridgeCount += selected.bridgeCount;
    unbridgeableConflicts += selected.unbridgeableConflicts;
    unsatisfiedBridgeConstraints += selected.unsatisfiedBridgeConstraints;
    directionReversalCount += selected.reversals;
    solidIntersections += selected.solidIntersections;
    wireCrossings += selected.crossings;
    wireOverlapM += selected.overlapM;
    maximumPlanarBends = Math.max(maximumPlanarBends, selected.bends);
    spatialIntersections += selected.cableClearanceConflicts;
  }
  // Keep the optimizer's finite-radius bridge solution authoritative. The old
  // renderer-side crossover pass repeatedly repaired its own repairs, creating
  // the long black serpentine route at the bottom of the enclosure. All cable
  // contacts are now evaluated after bend rounding and fed back into selection,
  // so there is no second geometry-mutating subsystem.
  const repairedRoutes = Object.fromEntries(ROUTE_DEFINITIONS.map((route) => {
    const result = routed.get(route.id)!;
    const points = compactRendered3(result.points);
    return [route.id, { ...result, lengthM: round(spatialLength(points)), points }];
  }));
  const repairedTotalLengthM = Object.values(repairedRoutes).reduce((sum, route) => sum + route.lengthM, 0);
  const repairedMaximumForwardM = Math.max(...Object.values(repairedRoutes).flatMap((route) => (
    route.points.map((point) => point[2] + route.radiusM)
  )));
  return {
    bridgeCount,
    directionReversals: directionReversalCount,
    laneCount: Math.max(1, Math.ceil((repairedMaximumForwardM - WIRE_PLANE_Z) / DEPTH_LEVEL_STEP_M) + 1),
    maximumForwardM: repairedMaximumForwardM,
    maximumPlanarBends,
    planarBends,
    routes: repairedRoutes,
    solidIntersections,
    spatialIntersections,
    totalLengthM: repairedTotalLengthM,
    unbridgeableConflicts,
    unsatisfiedBridgeConstraints,
    wireCrossings,
    wireOverlapM,
  };
}

function componentPackingMetrics(genome: Genome) {
  const components = Object.fromEntries(COMPONENT_SPECS.map((component) => [component.id, {
    center: genome.componentCenters[component.id],
    size: component.size,
  }]));
  let componentOverlapCount = 0;
  let componentOverlapAreaM2 = 0;
  COMPONENT_SPECS.forEach((component, index) => COMPONENT_SPECS.slice(index + 1).forEach((other) => {
    if (!sharesBackplatePlane(component.id, other.id)) return;
    const overlap = inflatedOverlap(
      components[component.id],
      components[other.id],
      componentPairGap(component.id, other.id),
    );
    if (!overlap) return;
    componentOverlapCount += 1;
    componentOverlapAreaM2 += overlap.area;
  }));
  return { components, componentOverlapAreaM2, componentOverlapCount };
}

function evaluateGenome(genome: Genome, details = false): Evaluation {
  const { components, componentOverlapAreaM2, componentOverlapCount } = componentPackingMetrics(genome);
  const { glands, overflowM } = placeGlands(genome);
  const breakoutConflicts = boundaryBreakoutConflicts(glands);
  const terminals = buildTerminals(genome, glands);
  const ports = buildPortSpecifications(terminals, glands);
  const routing = routeWires(genome, terminals, components, glands);
  const roundedSolidIntersections = auditRoundedComponentSolids(routing.routes, components);
  const cost = routingCostSummary(routing.routes);
  const depthOverflowM = Math.max(0, routing.maximumForwardM - MAXIMUM_ALLOWED_FORWARD_M);
  const metricValues: Omit<EvaluationMetrics, "score"> = {
    backtrackingCorners3d: Object.values(routing.routes).reduce((sum, route) => (
      sum + routeBacktrackingCorners3d(route.points)
    ), 0),
    boundaryBreakoutConflicts: breakoutConflicts,
    bridgeCount: routing.bridgeCount,
    cableGlandCount: GLAND_SPECS.filter((gland) => gland.type === "gland").length,
    coincidentRunOverlapM: coincidentRunOverlap(routing.routes),
    componentOverlapAreaM2: round(componentOverlapAreaM2, 8),
    componentOverlapCount,
    depthOverflowM: round(depthOverflowM),
    directionReversals: routing.directionReversals,
    glandCount: GLAND_SPECS.length,
    glandOverflowM: overflowM,
    jackCount: GLAND_SPECS.filter((gland) => gland.type === "jack").length,
    laneCount: routing.laneCount,
    maximumForwardM: round(routing.maximumForwardM),
    maximumPlanarBends: routing.maximumPlanarBends,
    planarBends: routing.planarBends,
    portApproachViolations: portApproachViolations(routing.routes, ports),
    routingCost: round(cost.routingCost),
    solidIntersections: roundedSolidIntersections,
    // Candidate construction already compares each newly selected rounded
    // tube against every previously placed rounded tube using full radii and
    // the 3 mm service gap. Reuse that exact pair count during search; the
    // independent CableRoutingSystem audit still runs once for the finalist.
    spatialIntersections: routing.spatialIntersections,
    totalLengthM: round(cost.totalLengthM),
    turnCount3d: cost.turnCount3d,
    unbridgeableConflicts: routing.unbridgeableConflicts,
    unsatisfiedBridgeConstraints: routing.unsatisfiedBridgeConstraints,
    wallDistanceCostM2: round(cost.wallDistanceCostM2),
    weightedLengthM: round(cost.weightedLengthM),
    wireCrossings: routing.wireCrossings,
    wireOverlapM: round(routing.wireOverlapM),
  };
  const metrics: EvaluationMetrics = { ...metricValues, score: round(metricScore(metricValues)) };
  return {
    components: details ? Object.fromEntries(Object.entries(components).map(([id, component]) => [id, {
      center: component.center.map((value) => round(value)) as Point2,
      size: component.size,
    }])) : undefined,
    glands: details ? glands : undefined,
    metrics,
    ports: details ? ports : undefined,
    routes: details ? routing.routes : undefined,
    terminals: details ? terminals : undefined,
  };
}

function tournament(population: Candidate[], random: Random) {
  let selected = population[random.integer(0, population.length - 1)];
  for (let index = 1; index < 5; index += 1) {
    const candidate = population[random.integer(0, population.length - 1)];
    if (compareMetrics(candidate.evaluation.metrics, selected.evaluation.metrics) < 0) selected = candidate;
  }
  return selected;
}

function compareMetrics(first: EvaluationMetrics, second: EvaluationMetrics) {
  const ordered: Array<[number, number]> = [
    [first.componentOverlapCount, second.componentOverlapCount],
    [first.componentOverlapAreaM2, second.componentOverlapAreaM2],
    [first.glandOverflowM, second.glandOverflowM],
    [first.boundaryBreakoutConflicts, second.boundaryBreakoutConflicts],
    [first.solidIntersections, second.solidIntersections],
    [first.portApproachViolations, second.portApproachViolations],
    [first.backtrackingCorners3d, second.backtrackingCorners3d],
    [first.spatialIntersections, second.spatialIntersections],
    [first.coincidentRunOverlapM, second.coincidentRunOverlapM],
    [first.unbridgeableConflicts, second.unbridgeableConflicts],
    [first.unsatisfiedBridgeConstraints, second.unsatisfiedBridgeConstraints],
    [first.depthOverflowM, second.depthOverflowM],
    [first.directionReversals, second.directionReversals],
    [first.routingCost, second.routingCost],
    [first.weightedLengthM, second.weightedLengthM],
    [first.wallDistanceCostM2, second.wallDistanceCostM2],
    [first.turnCount3d, second.turnCount3d],
    [first.totalLengthM, second.totalLengthM],
    [first.bridgeCount, second.bridgeCount],
    [first.wireCrossings, second.wireCrossings],
    [first.wireOverlapM, second.wireOverlapM],
    [first.maximumForwardM, second.maximumForwardM],
  ];
  for (const [firstValue, secondValue] of ordered) {
    if (Math.abs(firstValue - secondValue) > EPSILON) return firstValue - secondValue;
  }
  return first.score - second.score;
}

const compareCandidates = (first: Candidate, second: Candidate) => (
  compareMetrics(first.evaluation.metrics, second.evaluation.metrics)
);

function parseArguments() {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const seconds = Number(value("--seconds") ?? Number(value("--minutes") ?? 1) * 60);
  const seed = Number(value("--seed") ?? 20260817);
  const population = Number(value("--population") ?? 10);
  const output = value("--output") ?? fileURLToPath(new URL("../data/junction-optimized-layout.json", import.meta.url));
  const resumeValue = value("--resume");
  return {
    evaluateOnly: args.includes("--evaluate-only"),
    finalize: args.includes("--finalize"),
    output,
    packOnly: args.includes("--pack-only"),
    population: Math.max(8, Math.floor(population)),
    quiet: args.includes("--quiet"),
    resume: args.includes("--fresh")
      ? undefined
      : resumeValue && !resumeValue.startsWith("--")
        ? resumeValue
        : output,
    seconds: Math.max(0.25, seconds),
    seed: seed >>> 0,
    thickFirst: args.includes("--thick-first"),
  };
}

async function readResumeDocument(path: string | undefined) {
  if (!path) return undefined;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeAtomic(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function outputDocument(
  args: ReturnType<typeof parseArguments>,
  best: Candidate,
  baseline: EvaluationMetrics,
  startedAt: string,
  elapsedSeconds: number,
  evaluations: number,
  generations: number,
  convergence: Array<{ elapsedSeconds: number; evaluations: number; score: number }>,
  finalAudit = true,
) {
  const detailed = best.evaluation.routes
    ? best.evaluation
    : evaluateGenome(best.genome, true);
  const final = finalAudit ? finalizeDetailedEvaluation(detailed) : detailed;
  return {
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    algorithm: ALGORITHM_DESCRIPTION,
    seed: args.seed,
    requestedTimeBudgetSeconds: args.seconds,
    elapsedSeconds: round(elapsedSeconds, 3),
    populationSize: args.population,
    evaluations,
    generations,
    startedAt,
    enclosure: {
      innerDimensionsM: [INNER_WIDTH_M, INNER_HEIGHT_M, 0.138],
      bottomFaceGlandRowsZ: [...GLAND_ROW_Z],
      routingDepthOrigin: "metres forward from the inner back-panel surface",
      maximumAllowedRoutingDepthM: MAXIMUM_ALLOWED_FORWARD_M,
      bottomRoutingGutterTopY: BOTTOM_ROUTING_GUTTER_TOP_Y,
      componentToBreakoutGutterGapM: COMPONENT_TO_BREAKOUT_GUTTER_GAP_M,
      minimumComponentGapM: COMPONENT_GAP_M,
      selectorPortalGapM: SELECTOR_PORTAL_GAP_M,
      glandEdgeClearanceM: GLAND_EDGE_CLEARANCE_M,
      glandGapM: GLAND_GAP_M,
    },
    objective: {
      priority: ["zero component overlap", "zero gland overflow", "zero boundary breakout conflicts", "zero radius-inflated device intersections", "zero renderer-equivalent rounded-tube cable intersections", "zero visible coincident cable runs", "zero reverse bends", "stay within the allowed enclosure depth", "minimum weighted cable cost", "minimum distance from the back wall", "few 3D turns", "few local depth bridges"],
      note: "Hard physical violations dominate. Every component has a radius-inflated keep-out envelope and an explicit terminal egress portal; cables may attach to their own terminal but may not cross any device face. The lower enclosure band is reserved exclusively for gland breakout columns, and the through-wall switch bodies are interior keep-outs. Every gland conductor changes depth at the enclosure floor, then rises through its reserved breakout column. The same rounded centerline and realistic insulated-conductor radii used by the Three.js renderer drive final acceptance, with a 1 mm cable-to-cable air gap. Cable length is weighted 2× for conductors at least 10 mm in modeled outside diameter. Integrated distance from the back wall and every 3D turn add cost.",
    },
    baseline,
    bestMetrics: final.metrics,
    improvementPercent: round((baseline.score - final.metrics.score) / baseline.score * 100, 3),
    bestGenome: best.genome,
    convergence,
    runtime: {
      candidates: [
        { name: "initial-population-best", score: baseline.score, totalLengthM: baseline.totalLengthM, bends: baseline.planarBends, crossings: baseline.wireCrossings, overlapM: baseline.wireOverlapM, directionReversals: baseline.directionReversals, solidIntersections: baseline.solidIntersections },
        { name: "evolutionary-optimized", score: final.metrics.score, totalLengthM: final.metrics.totalLengthM, bends: final.metrics.planarBends, crossings: final.metrics.wireCrossings, overlapM: final.metrics.wireOverlapM, directionReversals: final.metrics.directionReversals, solidIntersections: final.metrics.solidIntersections },
      ],
      components: final.components,
      glands: final.glands,
      glandRows: [best.genome.glandOrder.slice(0, best.genome.rowBreak), best.genome.glandOrder.slice(best.genome.rowBreak)],
      laneCount: final.metrics.laneCount,
      metrics: final.metrics,
      ports: final.ports,
      routes: final.routes,
      selectedCandidate: "evolutionary-optimized",
      terminals: final.terminals,
    },
  };
}

async function main() {
  const args = parseArguments();
  const random = new Random(args.seed);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const deadline = started + args.seconds * 1000;
  const resumeDocument = await readResumeDocument(args.resume);
  const resumed = resumeDocument?.bestGenome as Genome | undefined;
  if (resumed && args.thickFirst) {
    resumed.routeOrder.sort((firstId, secondId) => (
      routeById[secondId].radiusM - routeById[firstId].radiusM ||
      firstId.localeCompare(secondId)
    ));
  }
  if (args.finalize) {
    if (!resumed || !resumeDocument) throw new Error("--finalize requires a readable saved result (use --resume PATH when it is not --output)");
    repairComponents(resumed);
    const savedRuntime = resumeDocument.runtime;
    const refreshedComponents = componentPackingMetrics(resumed).components;
    const refreshedGlands = placeGlands(resumed).glands;
    const refreshedTerminals = buildTerminals(resumed, refreshedGlands);
    const refreshedPorts = buildPortSpecifications(refreshedTerminals, refreshedGlands);
    const savedEvaluation: Evaluation | undefined = savedRuntime?.routes && savedRuntime?.ports && savedRuntime?.components
      ? {
          components: refreshedComponents,
          glands: refreshedGlands,
          metrics: savedRuntime.metrics,
          ports: refreshedPorts,
          routes: savedRuntime.routes,
          terminals: refreshedTerminals,
        }
      : undefined;
    const final = finalizeDetailedEvaluation(savedEvaluation ?? evaluateGenome(resumed, true));
    const selectedCandidate = "evolutionary-optimized-finalized";
    const recordedBaseline = resumeDocument.baseline as EvaluationMetrics | undefined;
    const normalizedBaseline = recordedBaseline
      ? {
          ...recordedBaseline,
          boundaryBreakoutConflicts: recordedBaseline.boundaryBreakoutConflicts ?? 0,
          score: round(metricScore(recordedBaseline)),
        }
      : undefined;
    const initialCandidate = resumeDocument.runtime?.candidates?.[0]
      ? {
          ...resumeDocument.runtime.candidates[0],
          ...(normalizedBaseline ? { score: normalizedBaseline.score } : {}),
        }
      : undefined;
    const finalized = {
      ...resumeDocument,
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      algorithm: ALGORITHM_DESCRIPTION,
      generatedAt: new Date().toISOString(),
      objective: {
        ...(resumeDocument.objective ?? {}),
        priority: ["zero component overlap", "zero gland overflow", "zero boundary breakout conflicts", "zero radius-inflated device intersections", "zero renderer-equivalent rounded-tube cable intersections", "zero visible coincident cable runs", "zero reverse bends", "stay within the allowed enclosure depth", "minimum weighted cable cost", "minimum distance from the back wall", "few 3D turns", "few local depth bridges"],
        note: "The evolutionary search owns component positions and gland order; a deterministic sequential 3D A* finalizer derives every route. Every component terminal uses an explicit one-way axial approach, future approach corridors are reserved before routing, the lower enclosure band is a device-free breakout gutter, and every accepted cable centerline is reserved at its full rendered radius plus a 1 mm air gap. A renderer-equivalent rounded-tube audit is a hard publish gate: any cable contact, component contact, coincident run or invalid port approach rejects the generated artifact.",
      },
      ...(normalizedBaseline ? {
        baseline: normalizedBaseline,
        improvementPercent: round((normalizedBaseline.score - final.metrics.score) / normalizedBaseline.score * 100, 3),
      } : {}),
      bestMetrics: final.metrics,
      bestGenome: cloneGenome(resumed),
      postProcessing: {
        kind: "deterministic direction-preserving polyline compaction and renderer-equivalent rounded-tube audit",
        preservesEvolutionaryRunStatistics: true,
        finalizedAt: new Date().toISOString(),
        backtrackingCorners3d: final.metrics.backtrackingCorners3d,
        coincidentRunOverlapM: final.metrics.coincidentRunOverlapM,
        conservativeSpatialIntersections: final.metrics.spatialIntersections,
      },
      runtime: {
        ...resumeDocument.runtime,
        candidates: [
          ...(initialCandidate ? [initialCandidate] : []),
          {
            name: selectedCandidate,
            score: final.metrics.score,
            totalLengthM: final.metrics.totalLengthM,
            bends: final.metrics.planarBends,
            crossings: final.metrics.wireCrossings,
            overlapM: final.metrics.wireOverlapM,
            directionReversals: final.metrics.directionReversals,
            solidIntersections: final.metrics.solidIntersections,
          },
        ],
        components: final.components,
        glands: final.glands,
        glandRows: [resumed.glandOrder.slice(0, resumed.rowBreak), resumed.glandOrder.slice(resumed.rowBreak)],
        laneCount: final.metrics.laneCount,
        metrics: final.metrics,
        ports: final.ports,
        routes: final.routes,
        selectedCandidate,
        terminals: final.terminals,
      },
    };
    await writeAtomic(args.output, finalized);
    process.stdout.write(`${JSON.stringify({ output: args.output, finalized: true, preservedElapsedSeconds: resumeDocument.elapsedSeconds, preservedEvaluations: resumeDocument.evaluations, metrics: final.metrics }, null, 2)}\n`);
    return;
  }
  if (args.evaluateOnly) {
    if (!resumed) throw new Error("--evaluate-only requires a readable saved result (use --resume PATH when it is not --output)");
    repairComponents(resumed);
    const evaluation = finalizeDetailedEvaluation(evaluateGenome(resumed, true));
    // This mode is intentionally read-only: it is safe to use as a CI or
    // preflight audit without destroying the recorded evolutionary run,
    // convergence history, or renderer-ready finalized paths.
    process.stdout.write(`${JSON.stringify({ input: args.resume, evaluateOnly: true, metrics: evaluation.metrics }, null, 2)}\n`);
    return;
  }
  if (args.packOnly) {
    const samples = 100;
    const results = Array.from({ length: samples }, () => {
      const genome = createGenome(random);
      return componentPackingMetrics(genome);
    });
    const feasible = results.filter((result) => result.componentOverlapCount === 0).length;
    process.stdout.write(`${JSON.stringify({
      samples,
      feasible,
      minimumOverlapCount: Math.min(...results.map((result) => result.componentOverlapCount)),
      maximumOverlapCount: Math.max(...results.map((result) => result.componentOverlapCount)),
    }, null, 2)}\n`);
    return;
  }
  const population: Candidate[] = [];
  let evaluations = 0;
  const evaluationDurationsMs: number[] = [];
  const addCandidate = (genome: Genome) => {
    repairComponents(genome);
    const evaluationStarted = performance.now();
    population.push({ genome: cloneGenome(genome), evaluation: evaluateGenome(genome, true) });
    evaluationDurationsMs.push(performance.now() - evaluationStarted);
    evaluations += 1;
  };
  if (resumed && performance.now() < deadline) {
    repairComponents(resumed);
    addCandidate(resumed);
    // Seed one physically informed ordering in addition to mutations of the
    // prior winner. The sequential finite-radius router should reserve broad,
    // low-depth corridors for the least flexible conductors before asking the
    // small service wires to use the remaining channels.
    if (population.length < args.population && performance.now() < deadline) {
      const thickFirst = cloneGenome(resumed);
      thickFirst.routeOrder.sort((firstId, secondId) => (
        routeById[secondId].radiusM - routeById[firstId].radiusM ||
        firstId.localeCompare(secondId)
      ));
      addCandidate(thickFirst);
    }
  }
  // Establish only the minimum viable population before selection. The old
  // fixed eight-candidate bootstrap could overrun a ten-minute budget before
  // producing its first checkpoint when exact swept-radius auditing was slow.
  while (population.length < Math.min(2, args.population) && performance.now() < deadline) {
    const genome = createGenome(random);
    addCandidate(genome);
  }
  // A very short requested budget still completes one valid candidate rather
  // than writing an empty result. This is the only allowed budget overrun.
  if (population.length === 0) addCandidate(createGenome(random));
  population.sort(compareCandidates);
  const baseline = { ...population[0].evaluation.metrics };
  let best: Candidate = { genome: cloneGenome(population[0].genome), evaluation: population[0].evaluation };
  let generation = 0;
  let stagnant = 0;
  let lastReport = started;
  let lastCheckpoint = started;
  const convergence = [{ elapsedSeconds: 0, evaluations, score: best.evaluation.metrics.score }];

  const checkpoint = async (finalAudit = false) => {
    const now = performance.now();
    const document = outputDocument(
      args,
      best,
      baseline,
      startedAt,
      (now - started) / 1000,
      evaluations,
      generation,
      convergence,
      finalAudit,
    );
    await writeAtomic(args.output, document);
    return document;
  };

  // Steady-state replacement makes every expensive completed candidate useful
  // immediately and checks the deadline between candidates. It is both more
  // budget-predictable and better suited to this small, constrained search
  // than waiting for an entire generation to finish.
  while (performance.now() < deadline) {
    if (evaluationDurationsMs.length >= 2) {
      const expectedEvaluationMs = evaluationDurationsMs.reduce((sum, value) => sum + value, 0) /
        evaluationDurationsMs.length;
      if (performance.now() + expectedEvaluationMs > deadline) break;
    }
    population.sort(compareCandidates);
    const mutationScale = stagnant > 4 ? 0.018 : stagnant > 1 ? 0.012 : 0.006;
    let genome: Genome;
    if (population.length < args.population && random.next() < 0.42 || stagnant > 12) {
      genome = createGenome(random);
    } else if (population.length === 1 || random.next() < 0.32) {
      genome = cloneGenome(tournament(population, random).genome);
      mutateRouteOrder(genome.routeOrder, random, random.integer(1, 3));
      if (random.next() < 0.35) swapMutation(genome.glandOrder, random);
      mutate(genome, random, mutationScale);
    } else {
      genome = crossover(tournament(population, random).genome, tournament(population, random).genome, random);
      mutate(genome, random, mutationScale);
    }
    addCandidate(genome);
    population.sort(compareCandidates);
    if (population.length > args.population) population.length = args.population;
    generation += 1;
    if (compareCandidates(population[0], best) < 0) {
      best = { genome: cloneGenome(population[0].genome), evaluation: population[0].evaluation };
      stagnant = 0;
      convergence.push({
        elapsedSeconds: round((performance.now() - started) / 1000, 3),
        evaluations,
        score: best.evaluation.metrics.score,
      });
      if (convergence.length > 500) convergence.splice(1, convergence.length - 500);
    } else stagnant += 1;

    const now = performance.now();
    if (!args.quiet && now - lastReport >= 5000) {
      const metrics = best.evaluation.metrics;
      process.stdout.write(
        `${((now - started) / 1000).toFixed(1)}s · gen ${generation} · ${evaluations} eval · score ${metrics.score.toFixed(1)} · ${metrics.totalLengthM.toFixed(3)} m · ${metrics.planarBends} bends · ${metrics.laneCount} lanes · ${metrics.componentOverlapCount} overlaps · ${metrics.solidIntersections} solid hits · ${metrics.spatialIntersections} cable hits · ${metrics.coincidentRunOverlapM.toFixed(3)} m coincident · ${metrics.backtrackingCorners3d} reverse bends\n`,
      );
      lastReport = now;
    }
    if (now - lastCheckpoint >= 30_000) {
      await checkpoint(false);
      lastCheckpoint = performance.now();
    }
  }
  const finalDocument = await checkpoint(true);
  const elapsed = (performance.now() - started) / 1000;
  process.stdout.write(`${JSON.stringify({
    output: args.output,
    seed: args.seed,
    requestedSeconds: args.seconds,
    elapsedSeconds: round(elapsed, 3),
    evaluations,
    generations: generation,
    baseline,
    best: finalDocument.bestMetrics,
    improvementPercent: round((baseline.score - finalDocument.bestMetrics.score) / baseline.score * 100, 3),
  }, null, 2)}\n`);
}

await main();
