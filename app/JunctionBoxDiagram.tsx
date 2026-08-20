"use client";

import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { junctionInteriorRouting, type JunctionInteriorRoute } from "./junctionInteriorRouting";

type Point = [number, number];
type WireKind = "positive24" | "negative24" | "data";

const VIEW_W = 3200;
const VIEW_H = 2200;
const BOX = { x: 105, y: 105, w: 2990, h: 1780 };
const GRID = 24;
const ROUTE_BOUNDS = { left: 125, top: 125, right: 3075, bottom: 1870 };
const PHYSICAL_W = 0.49;
const PHYSICAL_H = 0.4;
const DRAW_INSET_X = 175;
const DRAW_INSET_TOP = 145;
const DRAW_INSET_BOTTOM = 240;

const componentCopy: Record<string, { detail: string; label: string; kind?: string }> = {
  selector: { label: "MASTER DISCONNECT", detail: "Whole bank · ON / OFF" },
  shunt: { label: "SMARTSHUNT 500 A", detail: "BATTERY − → SYSTEM −", kind: "bus-negative" },
  positiveBus: { label: "24 V POSITIVE BUS", detail: "Blue Sea 2104 · 7 connections", kind: "bus-positive" },
  negativeBus: { label: "24 V NEGATIVE BUS", detail: "Blue Sea 2104 · system side", kind: "bus-negative" },
  fuseBlock: { label: "24 V BREAKER DISTRIBUTION", detail: "2 dedicated inputs + 1 common four-way comb", kind: "fuse" },
  returnBus: { label: "BLUE SEA 2314 SERVICE RETURN BUS", detail: "6 used / 1 spare", kind: "bus-negative" },
  switchPanel: { label: "EXTERNAL SWITCHES", detail: "Internet · inside · outside", kind: "switches" },
  mpptFuse: { label: "MPPT 100 A BREAKER", detail: "MidNite MNEDC100", kind: "fuse" },
  ekranoFuse: { label: "EKRANO 3.15 A FUSE", detail: "Victron supplied", kind: "fuse" },
};

const mapX = (x: number) => BOX.x + DRAW_INSET_X + (x + PHYSICAL_W / 2) / PHYSICAL_W * (BOX.w - DRAW_INSET_X * 2);
const mapY = (y: number) => BOX.y + DRAW_INSET_TOP + (PHYSICAL_H / 2 - y) / PHYSICAL_H * (BOX.h - DRAW_INSET_TOP - DRAW_INSET_BOTTOM);
const snap = (value: number) => Math.round(value / GRID) * GRID;
const pointKey = (x: number, y: number) => `${x},${y}`;
const stateKey = (x: number, y: number, direction: number) => `${x},${y},${direction}`;

const components = Object.entries(junctionInteriorRouting.components).map(([id, component]) => ({
  id,
  x: mapX(component.center[0] - component.size[0] / 2),
  y: mapY(component.center[1] + component.size[1] / 2),
  w: component.size[0] / PHYSICAL_W * (BOX.w - DRAW_INSET_X * 2),
  h: component.size[1] / PHYSICAL_H * (BOX.h - DRAW_INSET_TOP - DRAW_INSET_BOTTOM),
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
    if (direction[0] > 0) point = [ownerDrawing.x + ownerDrawing.w, Math.max(ownerDrawing.y, Math.min(ownerDrawing.y + ownerDrawing.h, point[1]))];
    else if (direction[0] < 0) point = [ownerDrawing.x, Math.max(ownerDrawing.y, Math.min(ownerDrawing.y + ownerDrawing.h, point[1]))];
    else if (direction[1] > 0) point = [Math.max(ownerDrawing.x, Math.min(ownerDrawing.x + ownerDrawing.w, point[0])), ownerDrawing.y + ownerDrawing.h];
    else if (direction[1] < 0) point = [Math.max(ownerDrawing.x, Math.min(ownerDrawing.x + ownerDrawing.w, point[0])), ownerDrawing.y];
  }
  const lead = Math.max(34, port.cableRadiusM * 5200);
  const escape: Point = [point[0] + direction[0] * lead, point[1] + direction[1] * lead];
  return [id, { componentId: port.componentId, escape, point, radius: Math.max(7, port.cableRadiusM * 1700) }];
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
const gaugeFor = (route: JunctionInteriorRoute) => route.radiusM >= 0.006 ? "1/0 AWG" : route.radiusM >= 0.0045 ? "25 mm²" : route.radiusM >= 0.002 ? "4 mm²" : route.kind === "data" ? "data / signal" : "0.75–2.5 mm²";
const words = (id: string) => id.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const wires: DiagramWire[] = Object.values(junctionInteriorRouting.wireSegments).map((route) => ({
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
  id: component.id,
  left: component.x - 20,
  top: component.y - 20,
  right: component.x + component.w + 20,
  bottom: component.y + component.h + 20,
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
      ? start[0] > component.x && start[0] < component.x + component.w &&
          Math.max(start[1], end[1]) > component.y && Math.min(start[1], end[1]) < component.y + component.h
      : start[1] > component.y && start[1] < component.y + component.h &&
          Math.max(start[0], end[0]) > component.x && Math.min(start[0], end[0]) < component.x + component.w;
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
  return (valid.length ? valid : candidates).sort((first, second) => {
    const length = (points: Point[]) => points.slice(1).reduce((sum, point, index) => (
      sum + Math.abs(point[0] - points[index][0]) + Math.abs(point[1] - points[index][1])
    ), 0);
    return length(first) - length(second);
  })[0];
}

function routeLogicalWires() {
  const occupied = new Map<string, number>();
  const routed: Record<string, Point[]> = {};
  const directions = [[GRID, 0], [0, GRID], [-GRID, 0], [0, -GRID]] as const;
  const ordered = [...wires].sort((a, b) => b.radius - a.radius || a.id.localeCompare(b.id));

  ordered.forEach((wire) => {
    const from = terminals[wire.route.from];
    const to = terminals[wire.route.to];
    if (!from || !to) return;
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
      // Port escapes are already 34+ px beyond the component face, farther
      // than the 20 px keepout. Once A* begins, even the route's own device is
      // solid; this prevents a later dogleg from re-entering its face.
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
      if (current.x === goal[0] && current.y === goal[1]) { found = currentKey; break; }
      directions.forEach(([dx, dy], direction) => {
        const x = current.x + dx;
        const y = current.y + dy;
        if (x < ROUTE_BOUNDS.left || x > ROUTE_BOUNDS.right || y < ROUTE_BOUNDS.top || y > ROUTE_BOUNDS.bottom) return;
        if ((x !== goal[0] || y !== goal[1]) && blocked([x, y])) return;
        const overlap = occupied.get(pointKey(x, y)) ?? 0;
        const nearby = directions.reduce((sum, [ox, oy]) => sum + (occupied.get(pointKey(x + ox, y + oy)) ?? 0), 0);
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
    // Exact physical ports do not generally land on the clarity grid. Join
    // each escape to its nearest voxel with two orthogonal micro-segments so
    // snapping can never introduce a diagonal at either end of the route.
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

const kindLabels: Record<WireKind, string> = {
  positive24: "24 V positive / protected positive",
  negative24: "24 V negative / return",
  data: "Data",
};

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const squared = dx * dx + dy * dy;
  const amount = squared === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / squared));
  return Math.hypot(point[0] - start[0] - amount * dx, point[1] - start[1] - amount * dy);
}

export function JunctionBoxDiagram() {
  const [activeWire, setActiveWire] = useState<string | null>(null);
  const logicalRoutes = useMemo(() => routeLogicalWires(), []);
  const wirePoints = useMemo(() => wires.flatMap((wire) => logicalRoutes[wire.id] ? [{ id: wire.id, points: logicalRoutes[wire.id] }] : []), [logicalRoutes]);
  const trackNearestWire = (event: ReactPointerEvent<SVGSVGElement>) => {
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    let nearest: { distance: number; id: string } | undefined;
    wirePoints.forEach((wire) => wire.points.slice(1).forEach((end, index) => {
      const distance = pointToSegmentDistance([local.x, local.y], wire.points[index], end);
      if (!nearest || distance < nearest.distance) nearest = { distance, id: wire.id };
    }));
    setActiveWire(nearest && nearest.distance <= 20 ? nearest.id : null);
  };

  return (
    <section className="junction-page" aria-labelledby="junction-page-title">
      <header className="junction-page-heading">
        <div><p>Compact DC enclosure · physical placement / clarity-first routing</p><h1 id="junction-page-title">Junction box wiring</h1></div>
        <div className="junction-page-summary"><b>{wires.length} terminal-to-terminal wires · {junctionInteriorRouting.metrics.serviceCircuitCount} service circuits</b><span>14 cable glands + 1 Starlink jack · one spread bottom row</span></div>
      </header>
      <p className="junction-page-intro">Component positions correspond to the optimized 3D enclosure. This expanded view then re-routes every conductor with a separate 2D rectilinear A* pass: component bodies and foreign connectors are blocked, completed wires are strongly penalized, and each terminal retains its one-way straight approach. It is a tracing aid, not a drilling template.</p>

      <div className="junction-schematic-scroll">
        <svg className="junction-schematic junction-schematic-logical" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="A-star routed terminal-level wiring diagram of the DSE compact junction box" onPointerMove={trackNearestWire} onPointerLeave={() => setActiveWire(null)} data-junction-a-star="true" data-junction-gland-rows={junctionInteriorRouting.glandRows.length}>
          <rect className="junction-enclosure" x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h} rx="24" />
          <text className="junction-zone-label" x={BOX.x + 20} y={70}>PHYSICAL COMPONENT ORDER · EXPANDED ROUTING AISLES</text>
          <line className="junction-bottom-face" x1={BOX.x + 15} y1={BOX.y + BOX.h} x2={BOX.x + BOX.w - 15} y2={BOX.y + BOX.h} />

          {wirePoints.map((wire) => {
            const metadata = wires.find((item) => item.id === wire.id)!;
            const points = wire.points.map((point) => point.join(",")).join(" ");
            return <g key={wire.id}><polyline className={`junction-wire-halo ${activeWire && activeWire !== wire.id ? "is-muted" : ""}`} points={points} /><polyline className={`junction-wire wire-${metadata.kind} ${activeWire === wire.id ? "is-active" : ""} ${activeWire && activeWire !== wire.id ? "is-muted" : ""}`} data-junction-wire={wire.id} points={points} /></g>;
          })}

          {Object.values(junctionInteriorRouting.glands).filter((gland) => Object.keys(gland.conductorPoints).length === 2).map((gland) => {
            const x = mapX(gland.x);
            const conductorPoints = Object.values(gland.conductorPoints).map((point) => [mapX(point[0]), mapY(point[1])] as Point);
            return <path key={`${gland.id}-sheath`} className="junction-pair-sheath" d={`M ${x} ${BOX.y + BOX.h + 2} L ${x} ${conductorPoints[0][1] + 18} M ${x} ${conductorPoints[0][1] + 18} L ${conductorPoints[0][0]} ${conductorPoints[0][1]} M ${x} ${conductorPoints[0][1] + 18} L ${conductorPoints[1][0]} ${conductorPoints[1][1]}`} />;
          })}

          {components.map((component) => <g key={component.id} className={`junction-component logical-component ${component.kind ?? ""}`} data-junction-component={component.id}><rect x={component.x} y={component.y} width={component.w} height={component.h} rx="12" /><text x={component.x + component.w / 2} y={component.y + component.h / 2 - 8}>{component.label}</text><text className="sub" x={component.x + component.w / 2} y={component.y + component.h / 2 + 24}>{component.detail}</text></g>)}

          {Object.entries(terminals).map(([id, terminal]) => <circle key={id} className="junction-terminal" data-junction-terminal={id} cx={terminal.point[0]} cy={terminal.point[1]} r={terminal.radius} />)}
          {junctionInteriorRouting.glandRows[0].map((glandId) => {
            const gland = junctionInteriorRouting.glands[glandId];
            const x = mapX(gland.x);
            return <g key={glandId} className={`junction-boundary connection-${gland.type}`} data-junction-gland={glandId}>{gland.type === "jack" ? <rect x={x - 15} y={BOX.y + BOX.h - 12} width="30" height="25" rx="5" /> : <circle cx={x} cy={BOX.y + BOX.h} r={Math.max(10, gland.diameterM * 650)} />}<text x={x} y={2045} textAnchor="middle">{gland.label}</text></g>;
          })}
          <text className="junction-zone-label" x={BOX.x + 20} y={2160}>BOTTOM FACE · SINGLE PHYSICAL GLAND ROW · LEFT-TO-RIGHT ORDER MATCHES THE 3D MODEL</text>
        </svg>
      </div>

      <div className="junction-legend" aria-label="Wire color legend">{Object.entries(kindLabels).map(([kind, label]) => <span key={kind}><i className={`wire-${kind}`} />{label}</span>)}</div>
      <div className="junction-run-table-wrap"><table className="junction-run-table"><thead><tr><th>Run</th><th>Circuit</th><th>From</th><th>To</th><th>Planning conductor</th></tr></thead><tbody>{wires.map((wire, index) => <tr key={wire.id} className={activeWire === wire.id ? "is-active" : ""} onMouseEnter={() => setActiveWire(wire.id)} onMouseLeave={() => setActiveWire(null)} data-junction-wire-row={wire.id}><td><span className={`junction-wire-chip wire-${wire.kind}`} />{String(index + 1).padStart(2, "0")}</td><td>{wire.circuit}</td><td>{wire.from}</td><td>{wire.to}</td><td>{wire.gauge}</td></tr>)}</tbody></table></div>
      <aside className="junction-boundary-note"><b>Breaker-bank topology:</b> the six visible breaker positions do not require six independent supply wires. One dedicated 20 A services breaker has its own input/output, one dedicated 5 A Starlink breaker has its own input/output, and one common positive comb supplies four individual branch breakers for UniFi, USB, inside light and outside light. That is why the physical bank has three supply-side connections and six protected outputs.</aside>
    </section>
  );
}

export default JunctionBoxDiagram;
