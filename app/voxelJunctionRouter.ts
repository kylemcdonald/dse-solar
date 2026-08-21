import {
  cableClearanceIssues,
  routeLength,
  type LayoutVector,
  type PhysicalCableRoute,
} from "./physicalLayoutSolver.ts";
import {
  junctionInteriorRouting,
  type JunctionInteriorRoute,
  type JunctionInteriorRouting,
  type JunctionPoint3,
} from "./junctionInteriorRouting.ts";
import { sampleRoundedCableCenterline } from "./cableRouting.ts";

type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type QueueEntry = { cost: number; node: number; state: number };

export type VoxelJunctionRoutingResult = {
  algorithm: "protected-front-sequential-adaptive-voxel-a-star";
  cellSizeM: number;
  connectorCollisionIssues: string[];
  enclosureInnerDimensionsM: [number, number, number];
  failedRouteIds: string[];
  frontViolationIssues: string[];
  metrics: {
    cableClearanceIssueCount: number;
    connectorCollisionCount: number;
    directionReversalCount: number;
    maximumForwardM: number;
    portApproachViolationCount: number;
    protectedFrontViolationCount: number;
    roundedCableClearanceIssueCount: number;
    routeCount: number;
    totalLengthM: number;
    totalTurns: number;
    unrelatedDeviceFrontViolationCount: number;
    wallDistanceCostM2: number;
  };
  routingPasses: number;
  routes: Record<string, JunctionInteriorRoute>;
  solveMs: number;
};

export type VoxelJunctionRouterOptions = {
  cellSizeM?: number;
  depthMovementPenalty?: number;
  depthPositionPenalty?: number;
  heuristicWeight?: number;
  maximumPasses?: number;
  maximumSearchStates?: number;
  turnPenaltyM?: number;
};

type Grid = {
  nx: number;
  ny: number;
  nz: number;
  xs: number[];
  ys: number[];
  zs: number[];
};

type EndpointLead = {
  escape: JunctionPoint3;
  points: JunctionPoint3[];
};

const DEFAULT_OPTIONS: Required<VoxelJunctionRouterOptions> = {
  cellSizeM: 0.0144,
  depthMovementPenalty: 3,
  depthPositionPenalty: 14,
  heuristicWeight: 3.5,
  maximumPasses: 6,
  maximumSearchStates: 20_000,
  turnPenaltyM: 0.03,
};
const CABLE_CLEARANCE_M = 0.001;
const COMPONENT_CLEARANCE_M = 0.0015;
const INNER_WIDTH_M = 0.46;
const INNER_HEIGHT_M = 0.37;
const INNER_DEPTH_M = 0.138;
const MAXIMUM_FORWARD_M = 0.13;
const EPSILON = 0.000001;
const DIRECTIONS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;

function routeDirection(start: JunctionPoint3, end: JunctionPoint3) {
  const axis = start.findIndex((value, index) => Math.abs(value - end[index]) > EPSILON);
  if (axis < 0) return 6;
  return axis * 2 + Number(end[axis] < start[axis]);
}

function oppositeDirection(direction: number) {
  return direction >= 6 ? 6 : direction % 2 === 0 ? direction + 1 : direction - 1;
}

const PROTECTED_FRONT_COMPONENTS = new Set(["fuseBlock", "mpptFuse"]);

const PROTECTED_ESCAPE_SIDE: Record<string, "bottom" | "left" | "right" | "top"> = {
  servicesFuseIn: "top",
  servicesFuseOut: "top",
  fuseInput: "top",
  starlinkFuseIn: "top",
  starlinkFuseOut: "top",
  fuseOutput1: "bottom",
  fuseOutput2: "bottom",
  fuseOutput3: "bottom",
  fuseOutput4: "bottom",
  mpptFuseIn: "left",
  mpptFuseOut: "right",
};

const round = (value: number, places = 6) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

class MinimumHeap {
  private costs: number[] = [];
  private positions: Int32Array;
  private states: number[] = [];

  poppedCost = 0;
  poppedNode = 0;

  constructor(stateCount: number) {
    this.positions = new Int32Array(stateCount);
    this.positions.fill(-1);
  }

  get size() { return this.costs.length; }

  push(entry: QueueEntry) {
    const existing = this.positions[entry.state];
    if (existing >= 0) {
      if (this.costs[existing] <= entry.cost) return;
      this.costs[existing] = entry.cost;
      let index = existing;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (this.costs[parent] <= entry.cost) break;
        this.costs[index] = this.costs[parent];
        this.states[index] = this.states[parent];
        this.positions[this.states[index]] = index;
        index = parent;
      }
      this.costs[index] = entry.cost;
      this.states[index] = entry.state;
      this.positions[entry.state] = index;
      return;
    }
    let index = this.costs.length;
    this.costs.push(entry.cost);
    this.states.push(entry.state);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.costs[parent] <= entry.cost) break;
      this.costs[index] = this.costs[parent];
      this.states[index] = this.states[parent];
      this.positions[this.states[index]] = index;
      index = parent;
    }
    this.costs[index] = entry.cost;
    this.states[index] = entry.state;
    this.positions[entry.state] = index;
  }

  pop() {
    if (this.costs.length === 0) return undefined;
    const poppedState = this.states[0];
    this.poppedCost = this.costs[0];
    this.poppedNode = Math.floor(poppedState / 7);
    const lastCost = this.costs.pop()!;
    const lastState = this.states.pop()!;
    this.positions[poppedState] = -1;
    if (this.costs.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let child = -1;
        if (left < this.costs.length && this.costs[left] < lastCost) child = left;
        if (right < this.costs.length && this.costs[right] < (child >= 0 ? this.costs[child] : lastCost)) child = right;
        if (child < 0) break;
        this.costs[index] = this.costs[child];
        this.states[index] = this.states[child];
        this.positions[this.states[index]] = index;
        index = child;
      }
      this.costs[index] = lastCost;
      this.states[index] = lastState;
      this.positions[lastState] = index;
    }
    return poppedState;
  }
}

function axis(minimum: number, maximum: number, step: number, extras: number[]) {
  const values = new Set<number>([round(minimum), round(maximum)]);
  for (let value = minimum; value <= maximum + EPSILON; value += step) {
    values.add(round(Math.min(maximum, value)));
  }
  extras.forEach((value) => {
    if (value >= minimum - EPSILON && value <= maximum + EPSILON) values.add(round(value));
  });
  return [...values].sort((first, second) => first - second);
}

function nearestEdgeSide(
  point: JunctionPoint3,
  component: JunctionInteriorRouting["components"][string],
) {
  const distances = [
    { side: "left" as const, value: point[0] - (component.center[0] - component.size[0] / 2) },
    { side: "right" as const, value: component.center[0] + component.size[0] / 2 - point[0] },
    { side: "bottom" as const, value: point[1] - (component.center[1] - component.size[1] / 2) },
    { side: "top" as const, value: component.center[1] + component.size[1] / 2 - point[1] },
  ];
  return distances.sort((first, second) => first.value - second.value)[0].side;
}

function endpointLead(
  terminalId: string,
  route: JunctionInteriorRoute,
  routing: JunctionInteriorRouting,
): EndpointLead {
  const port = routing.ports[terminalId];
  const axialLength = Math.max(port.lengthM, route.radiusM * 2 + CABLE_CLEARANCE_M);
  const axial = port.position.map((value, index) => (
    round(value + port.direction[index] * axialLength)
  )) as JunctionPoint3;
  if (!port.componentId) return { escape: axial, points: [port.position, axial] };
  // Side- and edge-facing ports already point out of their component. Let the
  // cable continue in that one legal direction instead of choosing a second
  // escape edge that can reverse directly back across the connector.
  if (Math.abs(port.direction[0]) > 0.9 || Math.abs(port.direction[1]) > 0.9) {
    return { escape: axial, points: [port.position, axial] };
  }
  const component = routing.components[port.componentId];
  const clearance = route.radiusM + COMPONENT_CLEARANCE_M;
  const nearest = nearestEdgeSide(axial, component);
  const preferred = PROTECTED_ESCAPE_SIDE[terminalId];
  const candidates = (["left", "right", "bottom", "top"] as const).map((side) => {
    const escape = [...axial] as JunctionPoint3;
    if (side === "left") escape[0] = round(Math.min(axial[0], component.center[0] - component.size[0] / 2 - clearance));
    if (side === "right") escape[0] = round(Math.max(axial[0], component.center[0] + component.size[0] / 2 + clearance));
    if (side === "bottom") escape[1] = round(Math.min(axial[1], component.center[1] - component.size[1] / 2 - clearance));
    if (side === "top") escape[1] = round(Math.max(axial[1], component.center[1] + component.size[1] / 2 + clearance));
    const obstructed = Object.entries(routing.components).some(([otherId, other]) => {
      if (otherId === port.componentId) return false;
      const margin = route.radiusM + COMPONENT_CLEARANCE_M;
      return Math.max(axial[0], escape[0]) > other.center[0] - other.size[0] / 2 - margin + EPSILON &&
        Math.min(axial[0], escape[0]) < other.center[0] + other.size[0] / 2 + margin - EPSILON &&
        Math.max(axial[1], escape[1]) > other.center[1] - other.size[1] / 2 - margin + EPSILON &&
        Math.min(axial[1], escape[1]) < other.center[1] + other.size[1] / 2 + margin - EPSILON;
    });
    const distance = Math.abs(escape[0] - axial[0]) + Math.abs(escape[1] - axial[1]);
    const preferenceCost = side === preferred ? 0 : side === nearest ? 0.002 : 0.006;
    return { escape, score: Number(obstructed) * 10 + distance + preferenceCost, side };
  }).sort((first, second) => first.score - second.score);
  const { escape } = candidates[0];
  return { escape, points: [port.position, axial, escape] };
}

function allEndpointLeads(routing: JunctionInteriorRouting) {
  return Object.values(routing.wireSegments).flatMap((route) => [
    { route, terminalId: route.from, ...endpointLead(route.from, route, routing) },
    { route, terminalId: route.to, ...endpointLead(route.to, route, routing) },
  ]);
}

type CylindricalObstacle = {
  end: JunctionPoint3;
  id: string;
  radiusM: number;
  start: JunctionPoint3;
};

function foreignConnectorObstacles(
  route: JunctionInteriorRoute,
  routing: JunctionInteriorRouting,
): CylindricalObstacle[] {
  const ownTerminals = new Set([route.from, route.to]);
  const portObstacles = Object.entries(routing.ports).flatMap(([id, port]) => {
    if (ownTerminals.has(id)) return [];
    return [{
      end: port.position,
      id: `port:${id}`,
      // Matches the visible copper barrel and dark cap, not merely the wire.
      radiusM: Math.max(0.0026, port.cableRadiusM * 1.3) * 1.08,
      start: port.face,
    } satisfies CylindricalObstacle];
  });
  const glandObstacles = Object.values(routing.glands).flatMap((gland) => {
    const terminalIds = Object.keys(gland.conductorPoints);
    if (terminalIds.some((id) => ownTerminals.has(id))) return [];
    const portDepths = terminalIds.map((id) => routing.ports[id]?.face[2]).filter((value): value is number => value !== undefined);
    const z = portDepths.length > 0
      ? portDepths.reduce((sum, value) => sum + value, 0) / portDepths.length
      : INNER_DEPTH_M / 2 + gland.zOffset;
    return [{
      end: [gland.x, -INNER_HEIGHT_M / 2 + 0.034, z],
      id: `gland:${gland.id}`,
      radiusM: gland.diameterM / 2,
      start: [gland.x, -INNER_HEIGHT_M / 2, z],
    } satisfies CylindricalObstacle];
  });
  return [...portObstacles, ...glandObstacles];
}

function createGrid(
  route: JunctionInteriorRoute,
  source: EndpointLead,
  target: EndpointLead,
  options: Required<VoxelJunctionRouterOptions>,
) {
  const minimum: JunctionPoint3 = [
    -INNER_WIDTH_M / 2 + route.radiusM + CABLE_CLEARANCE_M,
    -INNER_HEIGHT_M / 2 + route.radiusM + CABLE_CLEARANCE_M,
    route.radiusM + CABLE_CLEARANCE_M,
  ];
  const maximum: JunctionPoint3 = [
    INNER_WIDTH_M / 2 - route.radiusM - CABLE_CLEARANCE_M,
    INNER_HEIGHT_M / 2 - route.radiusM - CABLE_CLEARANCE_M,
    MAXIMUM_FORWARD_M - route.radiusM,
  ];
  // Keep the lattice genuinely voxel-sized. Earlier prototypes injected every
  // obstacle edge, lead and prior cable coordinate into every axis; their
  // Cartesian product silently turned a ~7k-cell grid into nearly a million
  // cells. Exact source/target escapes are the only adaptive coordinates the
  // search needs because collision tests still use the true continuous cable
  // radius against every segment and device envelope.
  return {
    minimum,
    maximum,
    xs: axis(minimum[0], maximum[0], options.cellSizeM, [
      source.escape[0], target.escape[0],
    ]),
    ys: axis(minimum[1], maximum[1], options.cellSizeM, [
      source.escape[1], target.escape[1],
    ]),
    zs: axis(minimum[2], maximum[2], options.cellSizeM, [
      source.escape[2], target.escape[2],
    ]),
  };
}

function pointSegmentDistance(point: JunctionPoint3, start: JunctionPoint3, end: JunctionPoint3) {
  const delta = end.map((value, axisIndex) => value - start[axisIndex]) as JunctionPoint3;
  const lengthSquared = delta.reduce((sum, value) => sum + value * value, 0);
  const amount = lengthSquared <= EPSILON ? 0 : Math.max(0, Math.min(1,
    point.reduce((sum, value, axisIndex) => (
      sum + (value - start[axisIndex]) * delta[axisIndex]
    ), 0) / lengthSquared,
  ));
  return Math.hypot(...point.map((value, axisIndex) => (
    value - (start[axisIndex] + delta[axisIndex] * amount)
  )));
}

function closestSegmentDistance(
  firstStart: JunctionPoint3,
  firstEnd: JunctionPoint3,
  secondStart: JunctionPoint3,
  secondEnd: JunctionPoint3,
) {
  // All generated edges are rectilinear. Sampling each endpoint against the
  // opposite segment plus the possible orthogonal crossing is exact for this
  // restricted geometry.
  let result = Math.min(
    pointSegmentDistance(firstStart, secondStart, secondEnd),
    pointSegmentDistance(firstEnd, secondStart, secondEnd),
    pointSegmentDistance(secondStart, firstStart, firstEnd),
    pointSegmentDistance(secondEnd, firstStart, firstEnd),
  );
  const firstAxis = firstStart.findIndex((value, index) => Math.abs(value - firstEnd[index]) > EPSILON);
  const secondAxis = secondStart.findIndex((value, index) => Math.abs(value - secondEnd[index]) > EPSILON);
  if (firstAxis >= 0 && secondAxis >= 0 && firstAxis !== secondAxis) {
    const fixedAxis = [0, 1, 2].find((axisIndex) => axisIndex !== firstAxis && axisIndex !== secondAxis)!;
    const firstContains = (value: number, axisIndex: number) => value >= Math.min(firstStart[axisIndex], firstEnd[axisIndex]) - EPSILON &&
      value <= Math.max(firstStart[axisIndex], firstEnd[axisIndex]) + EPSILON;
    const secondContains = (value: number, axisIndex: number) => value >= Math.min(secondStart[axisIndex], secondEnd[axisIndex]) - EPSILON &&
      value <= Math.max(secondStart[axisIndex], secondEnd[axisIndex]) + EPSILON;
    if (firstContains(secondStart[firstAxis], firstAxis) && secondContains(firstStart[secondAxis], secondAxis)) {
      result = Math.min(result, Math.abs(firstStart[fixedAxis] - secondStart[fixedAxis]));
    }
  }
  return result;
}

function compact(points: JunctionPoint3[]) {
  const unique = points.filter((point, index) => index === 0 || point.some((value, axisIndex) => (
    Math.abs(value - points[index - 1][axisIndex]) > EPSILON
  )));
  if (unique.length < 3) return unique;
  const result = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = result.at(-1)!;
    const current = unique[index];
    const next = unique[index + 1];
    const before = current.findIndex((value, axisIndex) => Math.abs(value - previous[axisIndex]) > EPSILON);
    const after = next.findIndex((value, axisIndex) => Math.abs(value - current[axisIndex]) > EPSILON);
    const forward = before >= 0 && before === after &&
      (current[before] - previous[before]) * (next[before] - current[before]) > 0;
    if (!forward) result.push(current);
  }
  result.push(unique.at(-1)!);
  return result;
}

function solveOne(
  route: JunctionInteriorRoute,
  routing: JunctionInteriorRouting,
  placed: JunctionInteriorRoute[],
  options: Required<VoxelJunctionRouterOptions>,
  reserveFutureLeads = true,
) {
  const source = endpointLead(route.from, route, routing);
  const target = endpointLead(route.to, route, routing);
  const rawGrid = createGrid(route, source, target, options);
  const grid: Grid = {
    ...rawGrid,
    nx: rawGrid.xs.length,
    ny: rawGrid.ys.length,
    nz: rawGrid.zs.length,
  };
  const indexOf = (x: number, y: number, z: number) => x + y * grid.nx + z * grid.nx * grid.ny;
  const coordinate = (index: number) => {
    const z = Math.floor(index / (grid.nx * grid.ny));
    const remainder = index - z * grid.nx * grid.ny;
    const y = Math.floor(remainder / grid.nx);
    return [remainder - y * grid.nx, y, z] as const;
  };
  const world = (index: number): JunctionPoint3 => {
    const [x, y, z] = coordinate(index);
    return [grid.xs[x], grid.ys[y], grid.zs[z]];
  };
  const nearest = (values: number[], value: number) => values.reduce((best, candidate, index) => (
    Math.abs(candidate - value) < Math.abs(values[best] - value) ? index : best
  ), 0);
  const sourceNode = indexOf(nearest(grid.xs, source.escape[0]), nearest(grid.ys, source.escape[1]), nearest(grid.zs, source.escape[2]));
  const targetNode = indexOf(nearest(grid.xs, target.escape[0]), nearest(grid.ys, target.escape[1]), nearest(grid.zs, target.escape[2]));
  const sourceLeadDirection = routeDirection(source.points.at(-2)!, source.escape);
  const targetDepartureDirection = routeDirection(target.escape, target.points.at(-2)!);
  const allLeads = reserveFutureLeads
    ? allEndpointLeads(routing).filter((lead) => lead.route.id !== route.id)
    : [];
  const connectorObstacles = foreignConnectorObstacles(route, routing);
  const nodeCount = grid.nx * grid.ny * grid.nz;
  const blockedNodeCache = new Int8Array(nodeCount);
  blockedNodeCache.fill(-1);
  const pointBlocked = (point: JunctionPoint3) => {
    const outside = point[0] < rawGrid.minimum[0] - EPSILON || point[0] > rawGrid.maximum[0] + EPSILON ||
      point[1] < rawGrid.minimum[1] - EPSILON || point[1] > rawGrid.maximum[1] + EPSILON ||
      point[2] < rawGrid.minimum[2] - EPSILON || point[2] > rawGrid.maximum[2] + EPSILON;
    if (outside) return true;
    const deviceHit = Object.values(routing.components).some((component) => {
      const clearance = route.radiusM + COMPONENT_CLEARANCE_M;
      return point[0] > component.center[0] - component.size[0] / 2 - clearance + EPSILON &&
        point[0] < component.center[0] + component.size[0] / 2 + clearance - EPSILON &&
        point[1] > component.center[1] - component.size[1] / 2 - clearance + EPSILON &&
        point[1] < component.center[1] + component.size[1] / 2 + clearance - EPSILON;
    });
    if (deviceHit) return true;
    const connectorHit = connectorObstacles.some((obstacle) => (
      pointSegmentDistance(point, obstacle.start, obstacle.end) <
        route.radiusM + obstacle.radiusM + CABLE_CLEARANCE_M - EPSILON
    ));
    if (connectorHit) return true;
    const cableHit = placed.some((other) => other.points.slice(1).some((end, index) => (
      pointSegmentDistance(point, other.points[index], end) <
        route.radiusM + other.radiusM + CABLE_CLEARANCE_M - EPSILON
    )));
    if (cableHit) return true;
    return allLeads.some((lead) => lead.points.slice(1).some((end, index) => (
      pointSegmentDistance(point, lead.points[index], end) <
        route.radiusM + lead.route.radiusM + CABLE_CLEARANCE_M - EPSILON
    )));
  };
  const nodeBlocked = (node: number) => {
    const cached = blockedNodeCache[node];
    if (cached >= 0) return cached === 1;
    const blocked = pointBlocked(world(node));
    blockedNodeCache[node] = blocked ? 1 : 0;
    return blocked;
  };
  // Collision status depends only on a grid edge, not on the A* arrival
  // direction. Cache it once instead of repeating continuous-radius checks for
  // as many as seven direction states at the same node.
  const blockedEdgeCache = new Int8Array(nodeCount * 6);
  blockedEdgeCache.fill(-1);
  const segmentBlocked = (startNode: number, endNode: number, direction: number) => {
    const key = startNode * 6 + direction;
    const cached = blockedEdgeCache[key];
    if (cached >= 0) return cached === 1;
    if (nodeBlocked(endNode)) {
      blockedEdgeCache[key] = 1;
      return true;
    }
    const start = world(startNode);
    const end = world(endNode);
    const blocked = placed.some((other) => other.points.slice(1).some((otherEnd, index) => (
      closestSegmentDistance(start, end, other.points[index], otherEnd) <
        route.radiusM + other.radiusM + CABLE_CLEARANCE_M - EPSILON
    ))) || allLeads.some((lead) => lead.points.slice(1).some((leadEnd, index) => (
      closestSegmentDistance(start, end, lead.points[index], leadEnd) <
        route.radiusM + lead.route.radiusM + CABLE_CLEARANCE_M - EPSILON
    ))) || connectorObstacles.some((obstacle) => (
      closestSegmentDistance(start, end, obstacle.start, obstacle.end) <
        route.radiusM + obstacle.radiusM + CABLE_CLEARANCE_M - EPSILON
    ));
    blockedEdgeCache[key] = blocked ? 1 : 0;
    const reverseDirection = direction % 2 === 0 ? direction + 1 : direction - 1;
    blockedEdgeCache[endNode * 6 + reverseDirection] = blocked ? 1 : 0;
    return blocked;
  };
  const distances = new Float64Array(nodeCount * 7);
  distances.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(distances.length);
  previous.fill(-1);
  const heap = new MinimumHeap(distances.length);
  const startState = sourceNode * 7 + 6;
  distances[startState] = 0;
  const heuristic = (node: number) => {
    const point = world(node);
    return Math.abs(point[0] - target.escape[0]) + Math.abs(point[1] - target.escape[1]) +
      Math.abs(point[2] - target.escape[2]) * 4;
  };
  heap.push({ cost: heuristic(sourceNode) * options.heuristicWeight, node: sourceNode, state: startState });
  let finalState = -1;
  let expandedStates = 0;
  while (heap.size > 0 && expandedStates < options.maximumSearchStates) {
    const currentState = heap.pop()!;
    expandedStates += 1;
    const currentNode = heap.poppedNode;
    const currentDistance = distances[currentState];
    if (heap.poppedCost > currentDistance + heuristic(currentNode) * options.heuristicWeight + EPSILON) continue;
    if (
      currentNode === targetNode &&
      currentState % 7 !== oppositeDirection(targetDepartureDirection)
    ) {
      finalState = currentState;
      break;
    }
    if (currentNode === targetNode) continue;
    const [x, y, z] = coordinate(currentNode);
    DIRECTIONS.forEach(([dx, dy, dz], nextDirection) => {
      if (currentNode === sourceNode && nextDirection === oppositeDirection(sourceLeadDirection)) return;
      const nextX = x + dx;
      const nextY = y + dy;
      const nextZ = z + dz;
      if (nextX < 0 || nextX >= grid.nx || nextY < 0 || nextY >= grid.ny || nextZ < 0 || nextZ >= grid.nz) return;
      const nextNode = indexOf(nextX, nextY, nextZ);
      if (nextNode !== targetNode && segmentBlocked(currentNode, nextNode, nextDirection)) return;
      const from = world(currentNode);
      const to = world(nextNode);
      const length = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]) + Math.abs(to[2] - from[2]);
      const previousDirection = currentState % 7 as Direction;
      const turnCost = previousDirection === 6 || previousDirection === nextDirection ? 0 : options.turnPenaltyM;
      const depthMovementCost = dz === 0 ? 0 : length * options.depthMovementPenalty;
      const depthPositionCost = length * ((from[2] + to[2]) / 2) * options.depthPositionPenalty;
      const nextDistance = currentDistance + length + turnCost + depthMovementCost + depthPositionCost;
      const nextState = nextNode * 7 + nextDirection;
      if (nextDistance + EPSILON >= distances[nextState]) return;
      distances[nextState] = nextDistance;
      previous[nextState] = currentState;
      heap.push({ cost: nextDistance + heuristic(nextNode) * options.heuristicWeight, node: nextNode, state: nextState });
    });
  }
  if (finalState < 0) return undefined;
  const nodes: number[] = [];
  for (let state = finalState; state >= 0; state = previous[state]) nodes.push(Math.floor(state / 7));
  const core = compact(nodes.reverse().map(world));
  const points = compact([
    ...source.points,
    ...core.slice(1, -1),
    ...[...target.points].reverse(),
  ]);
  return {
    ...route,
    bends: Math.max(0, points.length - 2),
    lane: Math.round(Math.max(...points.map((point) => point[2])) / options.cellSizeM),
    lengthM: routeLength(points as LayoutVector[]),
    points,
  } satisfies JunctionInteriorRoute;
}

function asPhysicalRoutes(routes: JunctionInteriorRoute[]): PhysicalCableRoute[] {
  return routes.map((route) => ({
    conductors: 1,
    id: route.id,
    kind: route.kind === "positive" ? "dc-positive" : route.kind === "negative" ? "dc-negative" : "data",
    lengthM: route.lengthM,
    planarDirectionReversals: 0,
    points: route.points as LayoutVector[],
    radiusM: route.radiusM,
    routing: "automatic-rectilinear",
  }));
}

function roundedCableClearanceIssues(routes: JunctionInteriorRoute[]) {
  const sampled = routes.map((route) => ({
    ...route,
    points: sampleRoundedCableCenterline(
      route.points,
      Math.max(route.radiusM * 4.25, 0.009),
      route.radiusM,
    ).centerline.map((point) => point.toArray() as LayoutVector),
  }));
  return cableClearanceIssues(asPhysicalRoutes(sampled), CABLE_CLEARANCE_M);
}

function connectorCollisionIssues(
  routes: JunctionInteriorRoute[],
  routing: JunctionInteriorRouting,
) {
  return routes.flatMap((route) => {
    const centerline = sampleRoundedCableCenterline(
      route.points,
      Math.max(route.radiusM * 4.25, 0.009),
      route.radiusM,
    ).centerline.map((point) => point.toArray() as JunctionPoint3);
    return foreignConnectorObstacles(route, routing).flatMap((obstacle) => {
      const hit = centerline.slice(1).some((end, index) => (
        closestSegmentDistance(centerline[index], end, obstacle.start, obstacle.end) <
          route.radiusM + obstacle.radiusM + CABLE_CLEARANCE_M - EPSILON
      ));
      return hit ? [`${route.id} intersects ${obstacle.id}`] : [];
    });
  });
}

function directionReversalCount(routes: JunctionInteriorRoute[]) {
  return routes.reduce((total, route) => total + route.points.slice(2).reduce((count, point, index) => {
    const first = route.points[index];
    const corner = route.points[index + 1];
    const beforeAxis = first.findIndex((value, axis) => Math.abs(value - corner[axis]) > EPSILON);
    const afterAxis = corner.findIndex((value, axis) => Math.abs(value - point[axis]) > EPSILON);
    const reverses = beforeAxis >= 0 && beforeAxis === afterAxis &&
      (corner[beforeAxis] - first[beforeAxis]) * (point[beforeAxis] - corner[beforeAxis]) < 0;
    return count + Number(reverses);
  }, 0), 0);
}

function terminalApproachViolations(routes: JunctionInteriorRoute[], routing: JunctionInteriorRouting) {
  return routes.reduce((violations, route) => violations + ([route.from, route.to] as const).reduce((count, terminalId, endpoint) => {
    const port = routing.ports[terminalId];
    const point = endpoint === 0 ? route.points[0] : route.points.at(-1)!;
    const neighbor = endpoint === 0 ? route.points[1] : route.points.at(-2)!;
    const delta = neighbor.map((value, index) => value - point[index]) as JunctionPoint3;
    const length = Math.hypot(...delta);
    const dot = delta.reduce((sum, value, index) => sum + value * port.direction[index], 0) / Math.max(EPSILON, length);
    return count + Number(length < port.lengthM - EPSILON || dot < 0.999);
  }, 0), 0);
}

function deviceFrontViolations(routes: JunctionInteriorRoute[], routing: JunctionInteriorRouting) {
  let protectedFrontViolationCount = 0;
  let unrelatedDeviceFrontViolationCount = 0;
  const issues: string[] = [];
  routes.forEach((route) => Object.entries(routing.components).forEach(([componentId, component]) => {
    const sourceOwner = routing.ports[route.from].componentId;
    const targetOwner = routing.ports[route.to].componentId;
    route.points.slice(1).forEach((end, index) => {
      const allowedSourceLead = componentId === sourceOwner && index < endpointLead(route.from, route, routing).points.length - 1;
      const targetLeadCount = endpointLead(route.to, route, routing).points.length - 1;
      const allowedTargetLead = componentId === targetOwner && index >= route.points.length - 1 - targetLeadCount;
      const protectedFront = PROTECTED_FRONT_COMPONENTS.has(componentId);
      const protectedSidePortLead = protectedFront && (
        componentId === sourceOwner && index === 0 && Math.abs(routing.ports[route.from].direction[2]) < 0.1 ||
        componentId === targetOwner && index === route.points.length - 2 && Math.abs(routing.ports[route.to].direction[2]) < 0.1
      );
      if (protectedSidePortLead) return;
      if ((allowedSourceLead || allowedTargetLead) && !protectedFront) return;
      const clearance = route.radiusM + COMPONENT_CLEARANCE_M;
      const minimumX = component.center[0] - component.size[0] / 2 - clearance;
      const maximumX = component.center[0] + component.size[0] / 2 + clearance;
      const minimumY = component.center[1] - component.size[1] / 2 - clearance;
      const maximumY = component.center[1] + component.size[1] / 2 + clearance;
      const start = route.points[index];
      const crosses = Math.max(start[0], end[0]) > minimumX + EPSILON && Math.min(start[0], end[0]) < maximumX - EPSILON &&
        Math.max(start[1], end[1]) > minimumY + EPSILON && Math.min(start[1], end[1]) < maximumY - EPSILON;
      if (!crosses) return;
      if (protectedFront) protectedFrontViolationCount += 1;
      if (componentId !== sourceOwner && componentId !== targetOwner) unrelatedDeviceFrontViolationCount += 1;
      issues.push(`${route.id}:${index} crosses ${componentId}`);
    });
  }));
  return { issues, protectedFrontViolationCount, unrelatedDeviceFrontViolationCount };
}

export function solveVoxelJunctionRoutes(
  routing: JunctionInteriorRouting = junctionInteriorRouting,
  inputOptions: VoxelJunctionRouterOptions = {},
): VoxelJunctionRoutingResult {
  const started = performance.now();
  const options = { ...DEFAULT_OPTIONS, ...inputOptions };
  const requests = Object.values(routing.wireSegments).sort((first, second) => (
    second.radiusM - first.radiusM || first.lengthM - second.lengthM || first.id.localeCompare(second.id)
  ));
  const routePass = (ordered: JunctionInteriorRoute[]) => {
    const routes: Record<string, JunctionInteriorRoute> = {};
    const failedRouteIds: string[] = [];
    const placed: JunctionInteriorRoute[] = [];
    ordered.forEach((request) => {
      const solved = solveOne(request, routing, placed, options);
      if (!solved) {
        failedRouteIds.push(request.id);
        return;
      }
      routes[solved.id] = solved;
      placed.push(solved);
    });
    return { failedRouteIds, routes };
  };
  let order = requests;
  let routingPasses = 1;
  let pass = routePass(order);
  let roundedIssues = roundedCableClearanceIssues(Object.values(pass.routes));
  while ((pass.failedRouteIds.length > 0 || roundedIssues.length > 0) && routingPasses < options.maximumPasses) {
    const failed = new Set(pass.failedRouteIds);
    roundedIssues.forEach((issue) => {
      const match = issue.match(/^([^:]+):.* intersects ([^:]+):/);
      if (match) {
        failed.add(match[1]);
        failed.add(match[2]);
      }
    });
    const coupledGroups = [
      ["battery-positive-a", "battery-positive-b"],
      ["starlink-switch-input", "switch-input-2", "switch-input-4", "switch-input-5"],
    ];
    coupledGroups.forEach((group) => {
      if (!group.some((id) => failed.has(id))) return;
      group.forEach((id) => failed.add(id));
    });
    order = [...order].sort((first, second) => (
      Number(failed.has(second.id)) - Number(failed.has(first.id)) ||
      second.radiusM - first.radiusM || second.lengthM - first.lengthM || first.id.localeCompare(second.id)
    ));
    routingPasses += 1;
    pass = routePass(order);
    roundedIssues = roundedCableClearanceIssues(Object.values(pass.routes));
  }
  const routes = Object.values(pass.routes);
  const deviceViolations = deviceFrontViolations(routes, routing);
  const connectorIssues = connectorCollisionIssues(routes, routing);
  const maximumForwardM = routes.length === 0 ? 0 : Math.max(...routes.flatMap((route) => (
    route.points.map((point) => point[2] + route.radiusM)
  )));
  const wallDistanceCostM2 = routes.reduce((sum, route) => sum + route.points.slice(1).reduce((routeSum, end, index) => {
    const start = route.points[index];
    const length = Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]) + Math.abs(end[2] - start[2]);
    return routeSum + length * Math.max(0, (start[2] + end[2]) / 2 - route.radiusM);
  }, 0), 0);
  return {
    algorithm: "protected-front-sequential-adaptive-voxel-a-star",
    cellSizeM: options.cellSizeM,
    connectorCollisionIssues: connectorIssues,
    enclosureInnerDimensionsM: [INNER_WIDTH_M, INNER_HEIGHT_M, INNER_DEPTH_M],
    failedRouteIds: pass.failedRouteIds,
    frontViolationIssues: deviceViolations.issues,
    metrics: {
      cableClearanceIssueCount: cableClearanceIssues(asPhysicalRoutes(routes), CABLE_CLEARANCE_M).length,
      connectorCollisionCount: connectorIssues.length,
      directionReversalCount: directionReversalCount(routes),
      maximumForwardM: round(maximumForwardM),
      portApproachViolationCount: terminalApproachViolations(routes, routing),
      protectedFrontViolationCount: deviceViolations.protectedFrontViolationCount,
      roundedCableClearanceIssueCount: roundedIssues.length,
      routeCount: routes.length,
      totalLengthM: round(routes.reduce((sum, route) => sum + route.lengthM, 0)),
      totalTurns: routes.reduce((sum, route) => sum + Math.max(0, compact(route.points).length - 2), 0),
      unrelatedDeviceFrontViolationCount: deviceViolations.unrelatedDeviceFrontViolationCount,
      wallDistanceCostM2: round(wallDistanceCostM2),
    },
    routingPasses,
    routes: pass.routes,
    solveMs: round(performance.now() - started, 2),
  };
}

export function solveVoxelJunctionRoute(
  routeId: string,
  routing: JunctionInteriorRouting = junctionInteriorRouting,
  inputOptions: VoxelJunctionRouterOptions = {},
  reserveFutureLeads = false,
) {
  const route = routing.wireSegments[routeId];
  if (!route) throw new Error(`Unknown junction route: ${routeId}`);
  return solveOne(route, routing, [], { ...DEFAULT_OPTIONS, ...inputOptions }, reserveFutureLeads);
}

export function voxelJunctionRouteEndpoints(
  routeId: string,
  routing: JunctionInteriorRouting = junctionInteriorRouting,
) {
  const route = routing.wireSegments[routeId];
  if (!route) throw new Error(`Unknown junction route: ${routeId}`);
  return {
    source: endpointLead(route.from, route, routing),
    target: endpointLead(route.to, route, routing),
  };
}
