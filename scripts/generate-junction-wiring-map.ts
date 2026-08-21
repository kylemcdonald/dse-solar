import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  junctionInteriorRouting,
  type JunctionInteriorRoute,
} from "../app/junctionInteriorRouting.ts";
import { junctionCableSpecification } from "../app/cableSpecifications.ts";

type Point = [number, number];
type WireKind = "positive24" | "negative24" | "data";

const outputPath = fileURLToPath(new URL("../data/junction-wiring-map.json", import.meta.url));
const VIEW_W = 3200;
const VIEW_H = 2200;
const BOX = { x: 105, y: 105, width: 2990, height: 1780 };
const GRID = 24;
const ROUTE_BOUNDS = { left: 125, top: 125, right: 3075, bottom: 1870 };
const PHYSICAL_W = 0.49;
const PHYSICAL_H = 0.4;
const DRAW_INSET_X = 175;
const DRAW_INSET_TOP = 145;
const DRAW_INSET_BOTTOM = 240;

const componentCopy: Record<string, { detail: string; label: string; kind?: string }> = {
  shunt: { label: "SMARTSHUNT 500 A", detail: "BATTERY − → SYSTEM −", kind: "bus-negative" },
  positiveBus: { label: "24 V POSITIVE BUS", detail: "AMOMD covered red bus · 8 of 12 positions used", kind: "bus-positive" },
  negativeBus: { label: "24 V NEGATIVE BUS", detail: "AMOMD covered black bus · 6 of 12 positions used", kind: "bus-negative" },
  fuseBlock: { label: "24 V BREAKER DISTRIBUTION", detail: "2 dedicated inputs + 1 common four-way comb", kind: "fuse" },
  returnBus: { label: "BLUE SEA 2314 SERVICE RETURN BUS", detail: "6 used / 1 spare", kind: "bus-negative" },
  switchPanel: { label: "EXTERNAL SWITCHES", detail: "Internet · inside · outside", kind: "switches" },
  mpptFuse: { label: "MPPT 100 A BREAKER", detail: "MidNite MNEDC100", kind: "fuse" },
  ekranoFuse: { label: "EKRANO 3.15 A FUSE", detail: "Victron supplied", kind: "fuse" },
  unifiPower: { label: "UNIFI 5 V CONVERTER", detail: "12–32 V in · USB-A out · inside box", kind: "conversion" },
};

const mapX = (x: number) => BOX.x + DRAW_INSET_X + (x + PHYSICAL_W / 2) / PHYSICAL_W * (BOX.width - DRAW_INSET_X * 2);
const mapY = (y: number) => BOX.y + DRAW_INSET_TOP + (PHYSICAL_H / 2 - y) / PHYSICAL_H * (BOX.height - DRAW_INSET_TOP - DRAW_INSET_BOTTOM);
const snap = (value: number) => Math.round(value / GRID) * GRID;
const pointKey = (x: number, y: number) => `${x},${y}`;
const stateKey = (x: number, y: number, direction: number) => `${x},${y},${direction}`;

const components = Object.entries(junctionInteriorRouting.components).map(([id, component]) => ({
  id,
  x: mapX(component.center[0] - component.size[0] / 2),
  y: mapY(component.center[1] + component.size[1] / 2),
  width: component.size[0] / PHYSICAL_W * (BOX.width - DRAW_INSET_X * 2),
  height: component.size[1] / PHYSICAL_H * (BOX.height - DRAW_INSET_TOP - DRAW_INSET_BOTTOM),
  ...(componentCopy[id] ?? { label: id, detail: "Junction component" }),
}));

const terminals = Object.fromEntries(Object.entries(junctionInteriorRouting.ports).map(([id, port]) => {
  let point: Point = [mapX(port.position[0]), mapY(port.position[1])];
  let direction: Point = [port.direction[0], -port.direction[1]];
  if (direction[0] === 0 && direction[1] === 0 && port.componentId) {
    const owner = junctionInteriorRouting.components[port.componentId];
    if (owner) {
      const relativeX = (port.position[0] - owner.center[0]) / owner.size[0];
      const relativeY = (port.position[1] - owner.center[1]) / owner.size[1];
      direction = Math.abs(relativeX) >= Math.abs(relativeY)
        ? [Math.sign(relativeX) || 1, 0]
        : [0, -Math.sign(relativeY) || 1];
    }
  }
  const ownerDrawing = port.componentId ? components.find((component) => component.id === port.componentId) : undefined;
  if (ownerDrawing) {
    if (direction[0] > 0) point = [ownerDrawing.x + ownerDrawing.width, Math.max(ownerDrawing.y, Math.min(ownerDrawing.y + ownerDrawing.height, point[1]))];
    else if (direction[0] < 0) point = [ownerDrawing.x, Math.max(ownerDrawing.y, Math.min(ownerDrawing.y + ownerDrawing.height, point[1]))];
    else if (direction[1] > 0) point = [Math.max(ownerDrawing.x, Math.min(ownerDrawing.x + ownerDrawing.width, point[0])), ownerDrawing.y + ownerDrawing.height];
    else if (direction[1] < 0) point = [Math.max(ownerDrawing.x, Math.min(ownerDrawing.x + ownerDrawing.width, point[0])), ownerDrawing.y];
  }
  const lead = Math.max(34, port.cableRadiusM * 5200);
  const escape: Point = [point[0] + direction[0] * lead, point[1] + direction[1] * lead];
  return [id, {
    componentId: port.componentId,
    escape,
    point,
    radius: Math.max(7, port.cableRadiusM * 1700),
  }];
}));

type DiagramWire = {
  circuit: string;
  from: string;
  gauge: string;
  id: string;
  kind: WireKind;
  radius: number;
  route: JunctionInteriorRoute;
  to: string;
};

const kindFor = (route: JunctionInteriorRoute): WireKind => route.kind === "positive" ? "positive24" : route.kind === "negative" ? "negative24" : "data";
const gaugeFor = (route: JunctionInteriorRoute) => {
  const cable = junctionCableSpecification(route.id);
  return `${cable.conductorSize} · ${cable.awg}`;
};
const words = (id: string) => id.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const wireInputs: DiagramWire[] = Object.values(junctionInteriorRouting.wireSegments).map((route) => ({
  id: route.id,
  circuit: words(route.id),
  from: words(route.from),
  to: words(route.to),
  gauge: gaugeFor(route),
  kind: kindFor(route),
  radius: route.radiusM,
  route,
}));

const obstacles = components.map((component) => ({
  left: component.x - 20,
  top: component.y - 20,
  right: component.x + component.width + 20,
  bottom: component.y + component.height + 20,
}));

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

function compact(points: Point[]) {
  const unique = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
  if (unique.length <= 2) return unique;
  const result: Point[] = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = result.at(-1)!;
    const point = unique[index];
    const next = unique[index + 1];
    if (previous[0] === point[0] && point[0] === next[0] || previous[1] === point[1] && point[1] === next[1]) continue;
    result.push(point);
  }
  result.push(unique.at(-1)!);
  return result;
}

function segmentCrossesComponent(start: Point, end: Point) {
  return components.some((component) => {
    const vertical = start[0] === end[0];
    return vertical
      ? start[0] > component.x && start[0] < component.x + component.width &&
          Math.max(start[1], end[1]) > component.y && Math.min(start[1], end[1]) < component.y + component.height
      : start[1] > component.y && start[1] < component.y + component.height &&
          Math.max(start[0], end[0]) > component.x && Math.min(start[0], end[0]) < component.x + component.width;
  });
}

function clearFallback(start: Point, goal: Point) {
  const candidates: Point[][] = [
    [start, [goal[0], start[1]], goal],
    [start, [start[0], goal[1]], goal],
    [start, [start[0], ROUTE_BOUNDS.top], [goal[0], ROUTE_BOUNDS.top], goal],
    [start, [start[0], ROUTE_BOUNDS.bottom], [goal[0], ROUTE_BOUNDS.bottom], goal],
    [start, [ROUTE_BOUNDS.left, start[1]], [ROUTE_BOUNDS.left, goal[1]], goal],
    [start, [ROUTE_BOUNDS.right, start[1]], [ROUTE_BOUNDS.right, goal[1]], goal],
  ].map(compact);
  const valid = candidates.filter((candidate) => candidate.slice(1).every((end, index) => (
    !segmentCrossesComponent(candidate[index], end)
  )));
  const length = (points: Point[]) => points.slice(1).reduce((sum, point, index) => (
    sum + Math.abs(point[0] - points[index][0]) + Math.abs(point[1] - points[index][1])
  ), 0);
  return (valid.length ? valid : candidates).sort((first, second) => length(first) - length(second))[0];
}

function routeLogicalWires() {
  const occupied = new Map<string, number>();
  const routed: Record<string, Point[]> = {};
  const directions = [[GRID, 0], [0, GRID], [-GRID, 0], [0, -GRID]] as const;
  const ordered = [...wireInputs].sort((a, b) => b.radius - a.radius || a.id.localeCompare(b.id));

  ordered.forEach((wire) => {
    const from = terminals[wire.route.from];
    const to = terminals[wire.route.to];
    if (!from || !to) throw new Error(`Missing terminal for ${wire.id}`);
    const start: Point = [snap(from.escape[0]), snap(from.escape[1])];
    const goal: Point = [snap(to.escape[0]), snap(to.escape[1])];
    const queue = new MinHeap<{ cost: number; direction: number; score: number; x: number; y: number }>();
    const costs = new Map<string, number>();
    const previous = new Map<string, string>();
    const startKey = stateKey(start[0], start[1], 4);
    costs.set(startKey, 0);
    queue.push({ x: start[0], y: start[1], direction: 4, cost: 0, score: Math.abs(goal[0] - start[0]) + Math.abs(goal[1] - start[1]) });
    let found: string | undefined;
    const blocked = ([x, y]: Point) => {
      if (obstacles.some((box) => x > box.left && x < box.right && y > box.top && y < box.bottom)) return true;
      return Object.entries(terminals).some(([id, terminal]) => (
        id !== wire.route.from && id !== wire.route.to &&
        terminal.componentId !== from.componentId && terminal.componentId !== to.componentId &&
        Math.hypot(x - terminal.point[0], y - terminal.point[1]) < terminal.radius + 12
      ));
    };

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
        if ((x !== goal[0] || y !== goal[1]) && blocked([x, y])) return;
        const overlap = occupied.get(pointKey(x, y)) ?? 0;
        const nearby = directions.reduce((sum, [offsetX, offsetY]) => sum + (occupied.get(pointKey(x + offsetX, y + offsetY)) ?? 0), 0);
        const turn = current.direction !== 4 && current.direction !== direction ? 38 : 0;
        const nextCost = current.cost + GRID + turn + overlap * 12_000 + nearby * 180;
        const key = stateKey(x, y, direction);
        if (nextCost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) return;
        costs.set(key, nextCost);
        previous.set(key, currentKey);
        queue.push({ x, y, direction, cost: nextCost, score: nextCost + Math.abs(goal[0] - x) + Math.abs(goal[1] - y) });
      });
    }

    const gridPoints: Point[] = [];
    for (let cursor = found; cursor; cursor = previous.get(cursor)) {
      const [x, y] = cursor.split(",").slice(0, 2).map(Number);
      gridPoints.push([x, y]);
    }
    gridPoints.reverse();
    if (gridPoints.length === 0) gridPoints.push(...clearFallback(start, goal));
    gridPoints.forEach(([x, y]) => occupied.set(pointKey(x, y), (occupied.get(pointKey(x, y)) ?? 0) + 1));
    const sourceGridJoin: Point = [start[0], from.escape[1]];
    const targetGridJoin: Point = [goal[0], to.escape[1]];
    routed[wire.id] = compact([
      from.point,
      from.escape,
      sourceGridJoin,
      ...gridPoints,
      targetGridJoin,
      to.escape,
      to.point,
    ]);
  });
  return routed;
}

const startedAt = performance.now();
const routes = routeLogicalWires();
const wires = wireInputs.map((wire) => ({
  circuit: wire.circuit,
  from: wire.from,
  gauge: wire.gauge,
  id: wire.id,
  kind: wire.kind,
  points: routes[wire.id],
  radius: wire.radius,
  to: wire.to,
}));
const glands = junctionInteriorRouting.glandRows.flatMap((row, rowIndex) => row.map((id) => {
  const gland = junctionInteriorRouting.glands[id];
  return {
    id,
    label: gland.label,
    type: gland.type,
    row: rowIndex,
    x: mapX(gland.x),
    y: BOX.y + BOX.height,
    radius: Math.max(10, gland.diameterM * 650),
  };
}));
const pairSheaths = Object.values(junctionInteriorRouting.glands).flatMap((gland) => {
  const conductorPoints = Object.values(gland.conductorPoints).map((point) => [mapX(point[0]), mapY(point[1])] as Point);
  if (conductorPoints.length !== 2) return [];
  const x = mapX(gland.x);
  const splitY = conductorPoints[0][1] + 18;
  return [{
    id: `${gland.id}-sheath`,
    path: `M ${x} ${BOX.y + BOX.height + 2} L ${x} ${splitY} M ${x} ${splitY} L ${conductorPoints[0][0]} ${conductorPoints[0][1]} M ${x} ${splitY} L ${conductorPoints[1][0]} ${conductorPoints[1][1]}`,
  }];
});

const document = {
  schemaVersion: 1,
  source: {
    algorithm: "offline 2D rectilinear A* with occupied-route penalties",
    optimizationGeneratedAt: junctionInteriorRouting.optimization.generatedAt,
    selectedCandidate: junctionInteriorRouting.selectedCandidate,
  },
  viewBox: { width: VIEW_W, height: VIEW_H },
  enclosure: BOX,
  zones: {
    top: { x: BOX.x + 20, y: 70, label: "PHYSICAL COMPONENT ORDER · EXPANDED ROUTING AISLES" },
    bottom: { x: BOX.x + 20, y: 2160, label: "BOTTOM FACE · SINGLE PHYSICAL GLAND ROW · LEFT-TO-RIGHT ORDER MATCHES THE 3D MODEL" },
    glandLabelY: 2045,
  },
  metrics: {
    wireCount: wires.length,
    serviceCircuitCount: junctionInteriorRouting.metrics.serviceCircuitCount,
    glandCount: glands.filter((gland) => gland.type === "gland").length,
    jackCount: glands.filter((gland) => gland.type === "jack").length,
    glandRowCount: junctionInteriorRouting.glandRows.length,
  },
  components,
  terminals: Object.entries(terminals).map(([id, terminal]) => ({ id, ...terminal })),
  glands,
  pairSheaths,
  wires,
};

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  solveMs: Math.round((performance.now() - startedAt) * 10) / 10,
  wires: wires.length,
  glands: glands.length,
}, null, 2)}\n`);
