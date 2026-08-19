"use client";

import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { junctionInteriorRouting } from "./junctionInteriorRouting";

type Point = [number, number];
type WireKind = "positive24" | "negative24" | "data";

type Terminal = {
  escape: Point;
  point: Point;
};

type SchematicWire = {
  circuit: string;
  from: string;
  fromTerminal: string;
  gauge: string;
  id: string;
  kind: WireKind;
  to: string;
  toTerminal: string;
};

type LogicalComponent = {
  detail: string;
  h: number;
  id: string;
  kind?: "bus-positive" | "bus-negative" | "fuse" | "switches";
  label: string;
  w: number;
  x: number;
  y: number;
};

type PairEntry = {
  id: string;
  label: string;
  negativeTerminal: string;
  positiveTerminal: string;
  type: "gland" | "jack";
  x: number;
};

const components: LogicalComponent[] = [
  { id: "selector", label: "MASTER BATTERY DISCONNECT", detail: "BOTH STRINGS TOGETHER · ON / OFF", x: 120, y: 120, w: 300, h: 180 },
  { id: "shunt", label: "SMARTSHUNT 500 A", detail: "BATTERY −  →  SYSTEM −", x: 120, y: 400, w: 300, h: 150 },
  { id: "positiveBus", label: "24 V POSITIVE BUS · BLUE SEA 2104", detail: "3 studs + 4 screws used · 1 stud spare", x: 520, y: 120, w: 650, h: 90, kind: "bus-positive" },
  { id: "negativeBus", label: "24 V NEGATIVE BUS · BLUE SEA 2104", detail: "3 studs + 3 screws used · system side of shunt", x: 1350, y: 120, w: 650, h: 90, kind: "bus-negative" },
  { id: "mpptFuse", label: "100 A BREAKER", detail: "MNEDC100 · MPPT branch", x: 560, y: 300, w: 150, h: 60, kind: "fuse" },
  { id: "servicesFuse", label: "20 A BREAKER", detail: "MNEPV20 · services", x: 860, y: 300, w: 150, h: 60, kind: "fuse" },
  { id: "ekranoFuse", label: "3.15 A FUSE", detail: "Victron supplied · retained", x: 1040, y: 300, w: 150, h: 60, kind: "fuse" },
  { id: "starlinkFuse", label: "5 A BREAKER", detail: "MNEPV5 · Starlink", x: 1220, y: 300, w: 150, h: 60, kind: "fuse" },
  { id: "fuseBlock", label: "RESETTABLE SERVICE BREAKERS", detail: "UniFi 2 A · USB 15 A · inside 1 A · outside 1 A", x: 700, y: 650, w: 470, h: 260 },
  { id: "returnBus", label: "BLUE SEA 2314 SERVICE RETURN BUS", detail: "2 studs + 5 screws · 6 used · 1 spare", x: 700, y: 1030, w: 470, h: 90, kind: "bus-negative" },
  { id: "switchPanel", label: "EXTERIOR CONTROLS", detail: "INTERNET DPST · INSIDE SPST · OUTSIDE SPST", x: 1350, y: 650, w: 340, h: 260, kind: "switches" },
];

const terminal = (point: Point, escape: Point = point): Terminal => ({ point, escape });

const terminals: Record<string, Terminal> = {
  selectorInputA: terminal([120, 185], [90, 185]),
  selectorInputB: terminal([120, 285], [90, 285]),
  selectorOutput: terminal([420, 235], [450, 235]),
  shuntBatteryA: terminal([120, 440], [90, 440]),
  shuntBatteryB: terminal([120, 485], [90, 485]),
  shuntSystem: terminal([420, 455], [450, 455]),
  shuntData: terminal([270, 550], [270, 580]),
  shuntVbattPositive: terminal([330, 550], [330, 580]),

  positiveStud1: terminal([575, 210], [575, 240]),
  positiveStud2: terminal([675, 210], [675, 240]),
  positiveStud3: terminal([775, 210], [775, 240]),
  positiveStud4: terminal([875, 210], [875, 240]),
  positiveStud5: terminal([975, 210], [975, 240]),
  positiveStud6: terminal([1075, 210], [1075, 240]),
  positiveStud7: terminal([1135, 210], [1135, 240]),
  negativeStud1: terminal([1405, 210], [1405, 240]),
  negativeStud2: terminal([1505, 210], [1505, 240]),
  negativeStud3: terminal([1605, 210], [1605, 240]),
  negativeStud4: terminal([1705, 210], [1705, 240]),
  negativeStud5: terminal([1805, 210], [1805, 240]),
  negativeStud6: terminal([1905, 210], [1905, 240]),

  mpptFuseIn: terminal([600, 300], [600, 280]),
  mpptFuseOut: terminal([670, 360], [670, 390]),
  servicesFuseIn: terminal([900, 300], [900, 280]),
  servicesFuseOut: terminal([970, 360], [970, 390]),
  ekranoFuseIn: terminal([1080, 300], [1080, 280]),
  ekranoFuseOut: terminal([1150, 360], [1150, 390]),
  starlinkFuseIn: terminal([1260, 300], [1260, 280]),
  starlinkFuseOut: terminal([1330, 360], [1330, 390]),

  fuseInput: terminal([820, 650], [820, 620]),
  fuseOutput1: terminal([1170, 700], [1200, 700]),
  fuseOutput2: terminal([1170, 760], [1200, 760]),
  fuseOutput3: terminal([1170, 820], [1200, 820]),
  fuseOutput4: terminal([1170, 880], [1200, 880]),
  returnStud1: terminal([760, 1120], [760, 1150]),
  returnStud2: terminal([840, 1120], [840, 1150]),
  returnStud3: terminal([920, 1120], [920, 1150]),
  returnStud4: terminal([1000, 1120], [1000, 1150]),
  returnStud5: terminal([1080, 1120], [1080, 1150]),
  returnStud6: terminal([1170, 1075], [1200, 1075]),

  switchInput1: terminal([1470, 650], [1470, 620]),
  switchOutput1: terminal([1690, 700], [1720, 700]),
  switchInput2: terminal([1350, 750], [1320, 750]),
  switchOutput2: terminal([1690, 750], [1720, 750]),
  switchInput4: terminal([1350, 820], [1320, 820]),
  switchOutput4: terminal([1690, 820], [1720, 820]),
  switchInput5: terminal([1350, 890], [1320, 890]),
  switchOutput5: terminal([1690, 890], [1720, 890]),
  switchLedNegative: terminal([1520, 910], [1520, 940]),

  batteryPosA: terminal([130, 1580], [130, 1540]),
  batteryPosB: terminal([230, 1580], [230, 1540]),
  batteryNegA: terminal([330, 1580], [330, 1540]),
  batteryNegB: terminal([430, 1580], [430, 1540]),
  mpptPos: terminal([570, 1580], [570, 1540]),
  mpptNeg: terminal([670, 1580], [670, 1540]),
  multiplusPos: terminal([770, 1580], [770, 1540]),
  multiplusNeg: terminal([870, 1580], [870, 1540]),
  ekranData: terminal([970, 1580], [970, 1540]),
  ekranPos: terminal([1072, 1460]),
  ekranNeg: terminal([1088, 1460]),
  loadPos2: terminal([1812, 1460]),
  loadNeg2: terminal([1828, 1460]),
  loadPos3: terminal([1952, 1460]),
  loadNeg3: terminal([1968, 1460]),
  loadPos4: terminal([2092, 1460]),
  loadNeg4: terminal([2108, 1460]),
  loadPos5: terminal([2232, 1460]),
  loadNeg5: terminal([2248, 1460]),
  starlinkJackPositive: terminal([2412, 1460]),
  starlinkJackNegative: terminal([2428, 1460]),
};

const pairEntries: PairEntry[] = [
  { id: "ekrano-power", label: "EKRANO POWER PAIR", positiveTerminal: "ekranPos", negativeTerminal: "ekranNeg", x: 1080, type: "gland" },
  { id: "unifi-power", label: "UNIFI 24 V PAIR", positiveTerminal: "loadPos2", negativeTerminal: "loadNeg2", x: 1820, type: "gland" },
  { id: "usb-power", label: "USB 24 V PAIR", positiveTerminal: "loadPos3", negativeTerminal: "loadNeg3", x: 1960, type: "gland" },
  { id: "inside-light", label: "INSIDE LIGHT PAIR", positiveTerminal: "loadPos4", negativeTerminal: "loadNeg4", x: 2100, type: "gland" },
  { id: "outside-light", label: "OUTSIDE LIGHT PAIR", positiveTerminal: "loadPos5", negativeTerminal: "loadNeg5", x: 2240, type: "gland" },
  { id: "starlink-jack", label: "STARLINK OEM CABLE", positiveTerminal: "starlinkJackPositive", negativeTerminal: "starlinkJackNegative", x: 2420, type: "jack" },
];

const singleEntries = [
  ["batteryPosA", "STRING A +"], ["batteryPosB", "STRING B +"],
  ["batteryNegA", "STRING A −"], ["batteryNegB", "STRING B −"],
  ["mpptPos", "MPPT +"], ["mpptNeg", "MPPT −"],
  ["multiplusPos", "MULTIPLUS +"], ["multiplusNeg", "MULTIPLUS −"],
  ["ekranData", "VE.DIRECT"],
] as const;

const wires: SchematicWire[] = [
  { id: "battery-positive-a", circuit: "Battery string A", from: "String A + gland", to: "Master input · stacked lug A", gauge: "1/0 AWG", kind: "positive24", fromTerminal: "batteryPosA", toTerminal: "selectorInputA" },
  { id: "battery-positive-b", circuit: "Battery string B", from: "String B + gland", to: "Master input · stacked lug B", gauge: "1/0 AWG", kind: "positive24", fromTerminal: "batteryPosB", toTerminal: "selectorInputB" },
  { id: "battery-negative-a", circuit: "Battery string A", from: "String A − gland", to: "SmartShunt BATTERY − A lug", gauge: "1/0 AWG", kind: "negative24", fromTerminal: "batteryNegA", toTerminal: "shuntBatteryA" },
  { id: "battery-negative-b", circuit: "Battery string B", from: "String B − gland", to: "SmartShunt BATTERY − B lug", gauge: "1/0 AWG", kind: "negative24", fromTerminal: "batteryNegB", toTerminal: "shuntBatteryB" },
  { id: "selector-to-positive-bus", circuit: "Main 24 V", from: "Master-disconnect output", to: "Positive bus stud 1", gauge: "1/0 AWG", kind: "positive24", fromTerminal: "selectorOutput", toTerminal: "positiveStud1" },
  { id: "shunt-to-negative-bus", circuit: "Main 24 V", from: "SmartShunt SYSTEM −", to: "Negative bus stud 1", gauge: "1/0 AWG", kind: "negative24", fromTerminal: "shuntSystem", toTerminal: "negativeStud1" },
  { id: "shunt-voltage-sense", circuit: "Battery voltage sense", from: "Positive bus screw 4", to: "SmartShunt Vbatt+", gauge: "supplied 1 A fused lead", kind: "positive24", fromTerminal: "positiveStud7", toTerminal: "shuntVbattPositive" },
  { id: "mppt-positive-feed", circuit: "SmartSolar battery", from: "Positive bus stud 2", to: "100 A breaker input", gauge: "25 mm²", kind: "positive24", fromTerminal: "positiveStud2", toTerminal: "mpptFuseIn" },
  { id: "mppt-positive", circuit: "SmartSolar battery", from: "100 A breaker output", to: "MPPT + gland", gauge: "25 mm²", kind: "positive24", fromTerminal: "mpptFuseOut", toTerminal: "mpptPos" },
  { id: "mppt-negative", circuit: "SmartSolar battery", from: "Negative bus stud 2", to: "MPPT − gland", gauge: "25 mm²", kind: "negative24", fromTerminal: "negativeStud2", toTerminal: "mpptNeg" },
  { id: "multiplus-positive", circuit: "MultiPlus DC", from: "Positive bus stud 3", to: "MultiPlus + gland", gauge: "1/0 AWG", kind: "positive24", fromTerminal: "positiveStud3", toTerminal: "multiplusPos" },
  { id: "multiplus-negative", circuit: "MultiPlus DC", from: "Negative bus stud 3", to: "MultiPlus − gland", gauge: "1/0 AWG", kind: "negative24", fromTerminal: "negativeStud3", toTerminal: "multiplusNeg" },
  { id: "services-positive-feed", circuit: "24 V services", from: "Positive bus screw 1", to: "20 A breaker input", gauge: "4 mm²", kind: "positive24", fromTerminal: "positiveStud4", toTerminal: "servicesFuseIn" },
  { id: "services-positive", circuit: "24 V services", from: "20 A breaker output", to: "Service-breaker common", gauge: "4 mm²", kind: "positive24", fromTerminal: "servicesFuseOut", toTerminal: "fuseInput" },
  { id: "services-negative", circuit: "24 V services", from: "Negative bus stud 4", to: "Service return bus", gauge: "4 mm²", kind: "negative24", fromTerminal: "negativeStud4", toTerminal: "returnStud6" },
  { id: "ekrano-positive-feed", circuit: "Ekrano GX", from: "Positive bus stud 5", to: "3.15 A fuse input", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "positiveStud5", toTerminal: "ekranoFuseIn" },
  { id: "ekrano-positive", circuit: "Ekrano GX", from: "3.15 A fuse output", to: "Ekrano pair · +", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "ekranoFuseOut", toTerminal: "ekranPos" },
  { id: "ekrano-negative", circuit: "Ekrano GX", from: "Negative bus stud 5", to: "Ekrano pair · −", gauge: "1.5 mm²", kind: "negative24", fromTerminal: "negativeStud5", toTerminal: "ekranNeg" },
  { id: "ekrano-data", circuit: "Battery monitor", from: "SmartShunt VE.Direct", to: "VE.Direct gland", gauge: "VE.Direct", kind: "data", fromTerminal: "shuntData", toTerminal: "ekranData" },
  { id: "starlink-fuse-feed", circuit: "Internet · Starlink", from: "Positive bus screw 3", to: "5 A breaker input", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "positiveStud6", toTerminal: "starlinkFuseIn" },
  { id: "starlink-switch-input", circuit: "Internet · Starlink", from: "5 A breaker output", to: "INTERNET pole A input", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "starlinkFuseOut", toTerminal: "switchInput1" },
  { id: "starlink-jack-positive", circuit: "Internet · Starlink", from: "INTERNET pole A output", to: "Starlink jack · +", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "switchOutput1", toTerminal: "starlinkJackPositive" },
  { id: "starlink-jack-negative", circuit: "Internet · Starlink", from: "Negative bus stud 6", to: "Starlink jack · −", gauge: "1.5 mm²", kind: "negative24", fromTerminal: "negativeStud6", toTerminal: "starlinkJackNegative" },
  { id: "switch-input-2", circuit: "Internet · UniFi", from: "2 A breaker", to: "INTERNET pole B input", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "fuseOutput1", toTerminal: "switchInput2" },
  { id: "load-positive-2", circuit: "Internet · UniFi", from: "INTERNET pole B output", to: "UniFi pair · +", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "switchOutput2", toTerminal: "loadPos2" },
  { id: "load-negative-2", circuit: "Internet · UniFi", from: "Return stud 1", to: "UniFi pair · −", gauge: "1.5 mm²", kind: "negative24", fromTerminal: "returnStud1", toTerminal: "loadNeg2" },
  { id: "load-positive-3", circuit: "USB charging", from: "15 A breaker", to: "USB pair · +", gauge: "2.5 mm²", kind: "positive24", fromTerminal: "fuseOutput2", toTerminal: "loadPos3" },
  { id: "load-negative-3", circuit: "USB charging", from: "Return stud 2", to: "USB pair · −", gauge: "2.5 mm²", kind: "negative24", fromTerminal: "returnStud2", toTerminal: "loadNeg3" },
  { id: "switch-input-4", circuit: "Inside light", from: "1 A breaker", to: "INSIDE switch input", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "fuseOutput3", toTerminal: "switchInput4" },
  { id: "load-positive-4", circuit: "Inside light", from: "INSIDE output · diode pack", to: "Inside-light pair · +", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "switchOutput4", toTerminal: "loadPos4" },
  { id: "load-negative-4", circuit: "Inside light", from: "Return stud 3", to: "Inside-light pair · −", gauge: "1.5 mm²", kind: "negative24", fromTerminal: "returnStud3", toTerminal: "loadNeg4" },
  { id: "switch-input-5", circuit: "Outside light", from: "1 A breaker", to: "OUTSIDE switch input", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "fuseOutput4", toTerminal: "switchInput5" },
  { id: "load-positive-5", circuit: "Outside light", from: "OUTSIDE output · diode pack", to: "Outside-light pair · +", gauge: "1.5 mm²", kind: "positive24", fromTerminal: "switchOutput5", toTerminal: "loadPos5" },
  { id: "load-negative-5", circuit: "Outside light", from: "Return stud 4", to: "Outside-light pair · −", gauge: "1.5 mm²", kind: "negative24", fromTerminal: "returnStud4", toTerminal: "loadNeg5" },
  { id: "switch-led-negative", circuit: "Control indicators", from: "Return stud 5", to: "Three rocker indicator returns", gauge: "0.75 mm²", kind: "negative24", fromTerminal: "returnStud5", toTerminal: "switchLedNegative" },
];

const GRID = 10;
const ROUTE_BOUNDS = { left: 70, top: 80, right: 2510, bottom: 1540 };
const obstaclePadding = 14;
const obstacles = components.map((component) => ({
  left: component.x - obstaclePadding,
  top: component.y - obstaclePadding,
  right: component.x + component.w + obstaclePadding,
  bottom: component.y + component.h + obstaclePadding,
}));

const stateKey = (x: number, y: number, direction: number) => `${x},${y},${direction}`;
const pointKey = (x: number, y: number) => `${x},${y}`;
const snap = (value: number) => Math.round(value / GRID) * GRID;

class MinHeap<T extends { score: number }> {
  values: T[] = [];
  push(value: T) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].score <= value.score) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }
  pop() {
    if (this.values.length === 0) return undefined;
    const root = this.values[0];
    const tail = this.values.pop()!;
    if (this.values.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.values.length) break;
        const child = right < this.values.length && this.values[right].score < this.values[left].score ? right : left;
        if (this.values[child].score >= tail.score) break;
        this.values[index] = this.values[child];
        index = child;
      }
      this.values[index] = tail;
    }
    return root;
  }
}

function insideObstacle(point: Point) {
  return obstacles.some((obstacle) => point[0] > obstacle.left && point[0] < obstacle.right && point[1] > obstacle.top && point[1] < obstacle.bottom);
}

function compact(points: Point[]) {
  const unique = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
  const result: Point[] = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = result.at(-1)!;
    const point = unique[index];
    const next = unique[index + 1];
    if ((previous[0] === point[0] && point[0] === next[0]) || (previous[1] === point[1] && point[1] === next[1])) continue;
    result.push(point);
  }
  result.push(unique.at(-1)!);
  return result;
}

function routeLogicalWires() {
  const occupied = new Map<string, number>();
  const routed: Record<string, Point[]> = {};
  const directions = [[GRID, 0], [0, GRID], [-GRID, 0], [0, -GRID]] as const;

  for (const wire of wires) {
    const from = terminals[wire.fromTerminal];
    const to = terminals[wire.toTerminal];
    const start: Point = [snap(from.escape[0]), snap(from.escape[1])];
    const goal: Point = [snap(to.escape[0]), snap(to.escape[1])];
    const queue = new MinHeap<{ cost: number; direction: number; score: number; x: number; y: number }>();
    const costs = new Map<string, number>();
    const previous = new Map<string, string>();
    const startKey = stateKey(start[0], start[1], 4);
    costs.set(startKey, 0);
    queue.push({ x: start[0], y: start[1], direction: 4, cost: 0, score: Math.abs(goal[0] - start[0]) + Math.abs(goal[1] - start[1]) });
    let found: string | undefined;

    while (queue.values.length > 0) {
      const current = queue.pop()!;
      const currentKey = stateKey(current.x, current.y, current.direction);
      if (current.cost !== costs.get(currentKey)) continue;
      if (current.x === goal[0] && current.y === goal[1]) {
        found = currentKey;
        break;
      }
      directions.forEach(([dx, dy], direction) => {
        const x = current.x + dx;
        const y = current.y + dy;
        if (x < ROUTE_BOUNDS.left || x > ROUTE_BOUNDS.right || y < ROUTE_BOUNDS.top || y > ROUTE_BOUNDS.bottom) return;
        const candidate: Point = [x, y];
        if ((x !== goal[0] || y !== goal[1]) && insideObstacle(candidate)) return;
        const occupancy = occupied.get(pointKey(x, y)) ?? 0;
        const nearby = directions.reduce((sum, [nearX, nearY]) => sum + (occupied.get(pointKey(x + nearX, y + nearY)) ?? 0), 0);
        const turn = current.direction !== 4 && current.direction !== direction ? 10 : 0;
        // In the clarity-first map, a longer dedicated lane is strongly
        // preferable to a crossing or coincident run. This is intentionally
        // much more conservative than the physical 3D harness, where depth
        // bridges can separate conductors safely.
        const nextCost = current.cost + GRID + turn + occupancy * 5_000 + nearby * 80;
        const key = stateKey(x, y, direction);
        if (nextCost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) return;
        costs.set(key, nextCost);
        previous.set(key, currentKey);
        queue.push({
          x,
          y,
          direction,
          cost: nextCost,
          score: nextCost + Math.abs(goal[0] - x) + Math.abs(goal[1] - y),
        });
      });
    }

    const gridPoints: Point[] = [];
    let cursor = found;
    while (cursor) {
      const [x, y] = cursor.split(",").slice(0, 2).map(Number);
      gridPoints.push([x, y]);
      cursor = previous.get(cursor);
    }
    gridPoints.reverse();
    if (gridPoints.length === 0) gridPoints.push(start, goal);
    gridPoints.forEach(([x, y]) => occupied.set(pointKey(x, y), (occupied.get(pointKey(x, y)) ?? 0) + 1));
    routed[wire.id] = compact([from.point, from.escape, ...gridPoints, to.escape, to.point]);
  }
  return routed;
}

const logicalRoutes = routeLogicalWires();

const kindLabels: Record<WireKind, string> = {
  positive24: "24 V positive / protected positive",
  negative24: "24 V negative / return",
  data: "Data",
};

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const amount = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - start[0] - amount * dx, point[1] - start[1] - amount * dy);
}

function PairGland({ entry }: { entry: PairEntry }) {
  const positive = terminals[entry.positiveTerminal].point;
  const negative = terminals[entry.negativeTerminal].point;
  return (
    <g className={`junction-boundary connection-${entry.type}`} data-junction-gland={entry.id}>
      <path className="junction-pair-sheath" d={`M ${positive[0]} ${positive[1]} L ${entry.x} 1490 M ${negative[0]} ${negative[1]} L ${entry.x} 1490 L ${entry.x} 1572`} />
      {entry.type === "jack" ? <rect x={entry.x - 14} y="1566" width="28" height="22" rx="5" /> : <circle cx={entry.x} cy="1578" r="11" />}
      <text x={entry.x} y="1640" textAnchor="middle">{entry.label}</text>
    </g>
  );
}

export function JunctionBoxDiagram() {
  const [activeWire, setActiveWire] = useState<string | null>(null);
  const wirePoints = useMemo(() => wires.map((wire) => ({ id: wire.id, points: logicalRoutes[wire.id] })), []);
  const trackNearestWire = (event: ReactPointerEvent<SVGSVGElement>) => {
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    let nearest: { distance: number; id: string } | undefined;
    wirePoints.forEach((wire) => wire.points.slice(1).forEach((end, index) => {
      const distance = pointToSegmentDistance([local.x, local.y], wire.points[index], end);
      if (!nearest || distance < nearest.distance) nearest = { distance, id: wire.id };
    }));
    setActiveWire(nearest && nearest.distance <= 18 ? nearest.id : null);
  };

  return (
    <section className="junction-page" aria-labelledby="junction-page-title">
      <header className="junction-page-heading">
        <div>
          <p>Compact DC enclosure · clarity-first logical map</p>
          <h1 id="junction-page-title">Junction box wiring</h1>
        </div>
        <div className="junction-page-summary">
          <b>{wires.length} terminal-to-terminal segments · {junctionInteriorRouting.metrics.serviceCircuitCount} service circuits</b>
          <span>14 cable glands · 1 Starlink jack · every cable entry on the bottom face</span>
        </div>
      </header>
      <p className="junction-page-intro">
        This view deliberately expands the enclosure and shrinks the hardware to make every conductor traceable. It is a terminal-level wiring map, not a drilling template. Wires are routed on a rectilinear grid around component envelopes; paired low-current cables remain in one sheath through their gland and split into red and black conductors only inside.
      </p>

      <div className="junction-schematic-scroll">
        <svg
          className="junction-schematic junction-schematic-logical"
          viewBox="0 0 2600 1700"
          role="img"
          aria-label="Clarity-first terminal-level wiring diagram of the DSE compact junction box"
          onPointerMove={trackNearestWire}
          onPointerLeave={() => setActiveWire(null)}
        >
          <rect className="junction-enclosure" x="55" y="55" width="2490" height="1480" rx="22" />
          <text className="junction-zone-label" x="80" y="42">LOGICAL INTERIOR · COMPONENTS AND CABLES NOT DRAWN TO PHYSICAL SCALE</text>
          <line className="junction-bottom-face" x1="70" y1="1535" x2="2530" y2="1535" />
          <text className="junction-zone-label" x="80" y="1680">BOTTOM FACE · LOGICAL ORDER ONLY · FINAL GLAND ORDER COMES FROM THE OFFLINE PHYSICAL OPTIMIZER</text>

          {wirePoints.map((wire) => {
            const metadata = wires.find((item) => item.id === wire.id)!;
            const points = wire.points.map((point) => point.join(",")).join(" ");
            return (
              <g key={wire.id}>
                <polyline className={`junction-wire-halo ${activeWire && activeWire !== wire.id ? "is-muted" : ""}`} points={points} />
                <polyline
                  className={`junction-wire wire-${metadata.kind} ${activeWire === wire.id ? "is-active" : ""} ${activeWire && activeWire !== wire.id ? "is-muted" : ""}`}
                  data-junction-wire={wire.id}
                  points={points}
                />
              </g>
            );
          })}

          {components.map((component) => (
            <g key={component.id} className={`junction-component logical-component ${component.kind ?? ""}`} data-junction-component={component.id}>
              <rect x={component.x} y={component.y} width={component.w} height={component.h} rx="12" />
              <text x={component.x + component.w / 2} y={component.y + component.h / 2 - 7}>{component.label}</text>
              <text className="sub" x={component.x + component.w / 2} y={component.y + component.h / 2 + 22}>{component.detail}</text>
            </g>
          ))}

          {Object.values(terminals).map((value, index) => (
            <circle key={index} className="junction-terminal" cx={value.point[0]} cy={value.point[1]} r="5" />
          ))}

          {singleEntries.map(([terminalId, label]) => {
            const value = terminals[terminalId].point;
            return (
              <g key={terminalId} className="junction-boundary connection-gland" data-junction-gland={terminalId}>
                <circle cx={value[0]} cy={value[1]} r="11" />
                <text x={value[0]} y="1640" textAnchor="middle">{label}</text>
              </g>
            );
          })}
          {pairEntries.map((entry) => <PairGland key={entry.id} entry={entry} />)}
        </svg>
      </div>

      <div className="junction-legend" aria-label="Wire color legend">
        {Object.entries(kindLabels).map(([kind, label]) => <span key={kind}><i className={`wire-${kind}`} />{label}</span>)}
        <span><i className="wire-pair" />paired cable sheath through one gland</span>
      </div>

      <div className="junction-run-table-wrap">
        <table className="junction-run-table">
          <thead><tr><th>Run</th><th>Circuit</th><th>From</th><th>To</th><th>Planning conductor</th></tr></thead>
          <tbody>
            {wires.map((wire, index) => (
              <tr
                key={wire.id}
                className={activeWire === wire.id ? "is-active" : ""}
                onMouseEnter={() => setActiveWire(wire.id)}
                onMouseLeave={() => setActiveWire(null)}
                data-junction-wire-row={wire.id}
              >
                <td><span className={`junction-wire-chip wire-${wire.kind}`} />{String(index + 1).padStart(2, "0")}</td>
                <td>{wire.circuit}</td><td>{wire.from}</td><td>{wire.to}</td><td>{wire.gauge}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="junction-boundary-note">
        <b>Voltage note:</b> the QHLightlux fixtures are published for 12–28 V input, while this GEL bank may reach 28.2–28.8 V during absorption. Each 1 A light branch therefore includes a two-diode series voltage-margin pack after its rocker. UniFi’s potted USBbuddy2 and all three Scanstrut TILE modules accept the nominal-24 V bank directly, so no Orion converter is required.
      </aside>
    </section>
  );
}
