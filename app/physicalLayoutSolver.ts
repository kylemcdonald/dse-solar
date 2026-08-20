import { junctionInteriorRouting } from "./junctionInteriorRouting.ts";
import optimizedPhysicalLayoutRaw from "../data/optimized-physical-layout.json" with { type: "json" };

export type LayoutVector = [number, number, number];

export type PhysicalDevice = {
  id: string;
  position: LayoutVector;
  size: LayoutVector;
  mounting: "wall" | "floor" | "array" | "exterior" | "hanging";
};

export type PhysicalPortSpecification = {
  cableRadiusM: number;
  deviceId?: string;
  direction: LayoutVector;
  face: LayoutVector;
  lengthM: number;
  position: LayoutVector;
};

export type PhysicalCableRoute = {
  id: string;
  kind: "dc-positive" | "dc-negative" | "data" | "earth" | "pv-positive" | "pv-negative" | "two-core-dc" | "three-core-ac";
  points: LayoutVector[];
  radiusM: number;
  conductors: number;
  lengthM: number;
  planarDirectionReversals: number;
  routing: "automatic-rectilinear" | "fixed-site";
  sourceDeviceId?: string;
  sourcePortId?: string;
  targetDeviceId?: string;
  targetPortId?: string;
};

export type PhysicalLayoutInput = {
  deviceOverrides?: Record<string, Partial<Pick<PhysicalDevice, "position">>>;
  routingEffort?: "full" | "optimization";
};

type OptimizedPhysicalLayoutDocument = {
  elapsedSeconds?: number;
  evaluations?: number;
  generations?: number;
  improvementPercent?: number;
  requestedTimeBudgetSeconds?: number;
  status?: string;
  runtime?: {
    deviceOverrides?: Record<string, { position: LayoutVector }>;
  };
};

const optimizedPhysicalLayout = optimizedPhysicalLayoutRaw as OptimizedPhysicalLayoutDocument;

export const physicalLayoutOptimization = {
  elapsedSeconds: optimizedPhysicalLayout.elapsedSeconds ?? 0,
  evaluations: optimizedPhysicalLayout.evaluations ?? 0,
  generations: optimizedPhysicalLayout.generations ?? 0,
  improvementPercent: optimizedPhysicalLayout.improvementPercent ?? 0,
  requestedTimeBudgetSeconds: optimizedPhysicalLayout.requestedTimeBudgetSeconds ?? 0,
  status: optimizedPhysicalLayout.status ?? "unavailable",
};

export type PhysicalLayoutSpecification = {
  revision: string;
  coordinateSystem: string;
  devices: Record<string, PhysicalDevice>;
  ports: Record<string, LayoutVector>;
  portSpecifications: Record<string, PhysicalPortSpecification>;
  routes: Record<string, PhysicalCableRoute>;
  surfaces: {
    backWall: { center: LayoutVector; size: LayoutVector };
    equipmentBoard: { center: LayoutVector; size: LayoutVector; frontZ: number };
    floorPlanes: Array<{ center: LayoutVector; size: LayoutVector }>;
    sideWalls: [];
    roofPlanes: [];
  };
  metrics: {
    automaticRouteCount: number;
    totalRenderedCableM: number;
    weightedCableLengthM: number;
    thickCableLengthM: number;
    wallDistanceCostM2: number;
    cableByKindM: Record<string, number>;
    wallDeviceSpanM: number;
    wallAuthoredWaypointCount: 0;
    wallDeviceCount: number;
    wallOverlapCount: number;
    wallOverlapIssues: string[];
    cableClearanceIssueCount: number;
    cableClearanceIssues: string[];
    projectedCableConflictCount: number;
    projectedCableConflictIssues: string[];
    deviceFrontCrossingCount: number;
    deviceFrontCrossingIssues: string[];
    junctionBackRouteCount: number;
    planarDirectionReversals: number;
    planarReversalIssues: string[];
    portApproachIssueCount: number;
    portApproachIssues: string[];
    automaticRouteLengthM: number;
    automaticRouteExcessLengthM: number;
    automaticRouteTurnCount: number;
    junctionEgressTurnCount: number;
    solverRouteCount: number;
    wallSpanPenaltyM: number;
    score: number;
  };
  constraints: {
    batteryArrangement: "floor-2x2";
    batteryRouting: "collision-aware-terminal-derived-bundle";
    junctionBackClearance: "flush-no-cables";
    removableSurfaces: { sideWalls: true; roof: true };
    wallLayout: "stochastic-voxel-a-star-optimized-layout";
    wallRouting: "offline-voxel-a-star-only";
  };
};

const round = (value: number, places = 4) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const distance = (first: LayoutVector, second: LayoutVector) => Math.hypot(
  second[0] - first[0],
  second[1] - first[1],
  second[2] - first[2],
);

const ROUTING_EPSILON = 0.00001;
const WALL_ROUTE_DEPTH_CLEARANCE_M = 0.008;
const WALL_DEVICE_CLEARANCE_M = 0.2;
type PlanarPoint = [number, number];
type RouteAxis = 0 | 1 | 2;

type PlanarObstacle = {
  id: string;
  left: number;
  right: number;
  bottom: number;
  top: number;
};

type AutomaticWallRouteOptions = {
  additionalObstacles?: PlanarObstacle[];
  deferSourceDepthTransition?: boolean;
  deferTargetDepthTransition?: boolean;
  devices: Record<string, PhysicalDevice>;
  equipmentBoardFrontZ: number;
  radiusM: number;
  sourceDeviceId?: string;
  sourceDirection?: LayoutVector;
  targetDeviceId?: string;
  targetDirection?: LayoutVector;
  minimumPlaneZ?: number;
  occupiedRoutes?: RoutedWallFootprint[];
  sourceLateralOffsetM?: number;
  sourceTerminalClearanceM?: number;
  targetLateralOffsetM?: number;
  targetTerminalClearanceM?: number;
};

type RoutedWallFootprint = {
  id: string;
  points: PlanarPoint[];
  planeZ: number;
  radiusM: number;
};

class MinimumQueue<T extends { cost: number; distance: number }> {
  private values: T[] = [];

  get size() {
    return this.values.length;
  }

  push(value: T) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.before(this.values[index], this.values[parent])) break;
      [this.values[index], this.values[parent]] = [this.values[parent], this.values[index]];
      index = parent;
    }
  }

  pop() {
    if (this.values.length === 0) return undefined;
    const first = this.values[0];
    const last = this.values.pop()!;
    if (this.values.length > 0) {
      this.values[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.values.length && this.before(this.values[left], this.values[best])) best = left;
        if (right < this.values.length && this.before(this.values[right], this.values[best])) best = right;
        if (best === index) break;
        [this.values[index], this.values[best]] = [this.values[best], this.values[index]];
        index = best;
      }
    }
    return first;
  }

  private before(first: T, second: T) {
    return first.cost < second.cost ||
      Math.abs(first.cost - second.cost) < ROUTING_EPSILON && first.distance < second.distance;
  }
}

function samePoint(first: LayoutVector, second: LayoutVector) {
  return first.every((value, axis) => Math.abs(value - second[axis]) < ROUTING_EPSILON);
}

function simplifyOrthogonalPoints(points: LayoutVector[]) {
  const unique = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  if (unique.length < 3) return unique;
  const simplified: LayoutVector[] = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = simplified.at(-1)!;
    const current = unique[index];
    const next = unique[index + 1];
    const changedBefore = ([0, 1, 2] as RouteAxis[]).filter((axis) => (
      Math.abs(current[axis] - previous[axis]) > ROUTING_EPSILON
    ));
    const changedAfter = ([0, 1, 2] as RouteAxis[]).filter((axis) => (
      Math.abs(next[axis] - current[axis]) > ROUTING_EPSILON
    ));
    if (changedBefore.length === 1 && changedAfter.length === 1 && changedBefore[0] === changedAfter[0]) {
      const axis = changedBefore[0];
      const incoming = current[axis] - previous[axis];
      const outgoing = next[axis] - current[axis];
      if (incoming * outgoing > 0) continue;
    }
    simplified.push(current);
  }
  simplified.push(unique.at(-1)!);
  return simplified;
}

/**
 * Turns any legacy site path into an axis-aligned path without inventing new
 * absolute coordinates. Automatic wall routes do not use this compatibility
 * helper; they are generated by the visibility graph below.
 */
export function rectilinearizeRoute(points: LayoutVector[]) {
  if (points.length < 2) return points.map((point) => [...point] as LayoutVector);
  const result: LayoutVector[] = [[...points[0]] as LayoutVector];
  points.slice(1).forEach((destination) => {
    let cursor = [...result.at(-1)!] as LayoutVector;
    const deltas = ([0, 1, 2] as RouteAxis[])
      .map((axis) => ({ axis, distance: Math.abs(destination[axis] - cursor[axis]) }))
      .filter(({ distance: axisDistance }) => axisDistance > ROUTING_EPSILON)
      .sort((first, second) => second.distance - first.distance || first.axis - second.axis);
    deltas.forEach(({ axis }) => {
      cursor = [...cursor] as LayoutVector;
      cursor[axis] = destination[axis];
      result.push(cursor);
    });
  });
  return simplifyOrthogonalPoints(result);
}

function pointInsideObstacle(point: PlanarPoint, obstacle: PlanarObstacle) {
  return point[0] > obstacle.left + ROUTING_EPSILON &&
    point[0] < obstacle.right - ROUTING_EPSILON &&
    point[1] > obstacle.bottom + ROUTING_EPSILON &&
    point[1] < obstacle.top - ROUTING_EPSILON;
}

export function segmentBlocked(start: PlanarPoint, end: PlanarPoint, obstacles: PlanarObstacle[]) {
  const vertical = Math.abs(start[0] - end[0]) < ROUTING_EPSILON;
  const horizontal = Math.abs(start[1] - end[1]) < ROUTING_EPSILON;
  if (!vertical && !horizontal) return true;
  return obstacles.some((obstacle) => {
    if (vertical) {
      if (start[0] <= obstacle.left + ROUTING_EPSILON || start[0] >= obstacle.right - ROUTING_EPSILON) return false;
      const low = Math.min(start[1], end[1]);
      const high = Math.max(start[1], end[1]);
      return high > obstacle.bottom + ROUTING_EPSILON && low < obstacle.top - ROUTING_EPSILON;
    }
    if (start[1] <= obstacle.bottom + ROUTING_EPSILON || start[1] >= obstacle.top - ROUTING_EPSILON) return false;
    const low = Math.min(start[0], end[0]);
    const high = Math.max(start[0], end[0]);
    return high > obstacle.left + ROUTING_EPSILON && low < obstacle.right - ROUTING_EPSILON;
  });
}

function usesBottomServiceEdge(device: PhysicalDevice | undefined) {
  return Boolean(device && device.mounting !== "floor" && device.mounting !== "array" && device.id !== "generator");
}

function orientedBreakout(
  port: LayoutVector,
  direction: LayoutVector | undefined,
  device: PhysicalDevice | undefined,
  clearance: number,
): PlanarPoint {
  if (direction && (Math.abs(direction[0]) > ROUTING_EPSILON || Math.abs(direction[1]) > ROUTING_EPSILON)) {
    return [
      round(port[0] + direction[0] * clearance),
      round(port[1] + direction[1] * clearance),
    ];
  }
  if (!usesBottomServiceEdge(device)) return [port[0], port[1]];
  const deviceBottom = device!.position[1] - device!.size[1] / 2;
  return [port[0], round(Math.min(port[1] - clearance, deviceBottom - clearance))];
}

function uniqueSorted(values: number[]) {
  return [...new Set(values.map((value) => round(value, 5)))].sort((first, second) => first - second);
}

export function shortestRectilinearPath(
  start: PlanarPoint,
  end: PlanarPoint,
  obstacles: PlanarObstacle[],
): PlanarPoint[] {
  if (Math.abs(start[0] - end[0]) < ROUTING_EPSILON && !segmentBlocked(start, end, obstacles)) {
    return [start, end];
  }
  if (Math.abs(start[1] - end[1]) < ROUTING_EPSILON && !segmentBlocked(start, end, obstacles)) {
    return [start, end];
  }
  const directCorners: PlanarPoint[] = [
    [start[0], end[1]],
    [end[0], start[1]],
  ];
  const direct = directCorners.find((corner) => (
    !segmentBlocked(start, corner, obstacles) && !segmentBlocked(corner, end, obstacles)
  ));
  if (direct) return [start, direct, end];

  const manhattanDistance = Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);
  const doglegs: PlanarPoint[][] = [
    ...uniqueSorted(obstacles.flatMap((obstacle) => [obstacle.left, obstacle.right])).map((x) => (
      [start, [x, start[1]] as PlanarPoint, [x, end[1]] as PlanarPoint, end]
    )),
    ...uniqueSorted(obstacles.flatMap((obstacle) => [obstacle.bottom, obstacle.top])).map((y) => (
      [start, [start[0], y] as PlanarPoint, [end[0], y] as PlanarPoint, end]
    )),
  ].filter((candidate) => candidate.slice(1).every((point, index) => (
    !segmentBlocked(candidate[index], point, obstacles)
  )));
  const monotonicDogleg = doglegs
    .map((points) => ({
      length: points.slice(1).reduce((sum, point, index) => (
        sum + Math.abs(point[0] - points[index][0]) + Math.abs(point[1] - points[index][1])
      ), 0),
      points,
    }))
    .filter(({ length }) => length <= manhattanDistance + ROUTING_EPSILON)
    .sort((first, second) => first.length - second.length)[0];
  if (monotonicDogleg) return monotonicDogleg.points;

  const xs = uniqueSorted([start[0], end[0], ...obstacles.flatMap((obstacle) => [obstacle.left, obstacle.right])]);
  const ys = uniqueSorted([start[1], end[1], ...obstacles.flatMap((obstacle) => [obstacle.bottom, obstacle.top])]);
  const nodes: PlanarPoint[] = [];
  const nodeIndex = new Map<string, number>();
  const key = (point: PlanarPoint) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
  xs.forEach((x) => ys.forEach((y) => {
    const point: PlanarPoint = [x, y];
    if (obstacles.some((obstacle) => pointInsideObstacle(point, obstacle))) return;
    nodeIndex.set(key(point), nodes.length);
    nodes.push(point);
  }));
  const startIndex = nodeIndex.get(key(start));
  const endIndex = nodeIndex.get(key(end));
  if (startIndex === undefined || endIndex === undefined) return [start, [start[0], end[1]], end];

  const adjacency = new Map<number, Array<{ axis: 0 | 1; distance: number; node: number }>>();
  const connect = (firstIndex: number, secondIndex: number, axis: 0 | 1) => {
    const first = nodes[firstIndex];
    const second = nodes[secondIndex];
    if (segmentBlocked(first, second, obstacles)) return;
    const edge = { axis, distance: Math.abs(second[axis] - first[axis]), node: secondIndex };
    const reverse = { axis, distance: edge.distance, node: firstIndex };
    adjacency.set(firstIndex, [...(adjacency.get(firstIndex) ?? []), edge]);
    adjacency.set(secondIndex, [...(adjacency.get(secondIndex) ?? []), reverse]);
  };
  ys.forEach((y) => {
    const row = xs.flatMap((x) => {
      const index = nodeIndex.get(key([x, y]));
      return index === undefined ? [] : [index];
    });
    row.slice(1).forEach((index, offset) => connect(row[offset], index, 0));
  });
  xs.forEach((x) => {
    const column = ys.flatMap((y) => {
      const index = nodeIndex.get(key([x, y]));
      return index === undefined ? [] : [index];
    });
    column.slice(1).forEach((index, offset) => connect(column[offset], index, 1));
  });

  type SearchState = { axis: -1 | 0 | 1; cost: number; distance: number; node: number; stateKey: string };
  const stateKey = (node: number, axis: -1 | 0 | 1) => `${node}:${axis}`;
  const initialState: SearchState = {
    axis: -1,
    cost: 0,
    distance: 0,
    node: startIndex,
    stateKey: stateKey(startIndex, -1),
  };
  const queue = new MinimumQueue<SearchState>();
  queue.push(initialState);
  const costs = new Map([[initialState.stateKey, 0]]);
  const previous = new Map<string, string>();
  let winningState: SearchState | undefined;
  while (queue.size > 0) {
    const current = queue.pop()!;
    if (current.cost > (costs.get(current.stateKey) ?? Number.POSITIVE_INFINITY) + ROUTING_EPSILON) continue;
    if (current.node === endIndex) {
      winningState = current;
      break;
    }
    for (const edge of adjacency.get(current.node) ?? []) {
      // Cable length is the primary objective. A tiny cumulative tie-breaker
      // removes gratuitous corners between otherwise equal Manhattan paths.
      const bendPenalty = current.axis === -1 || current.axis === edge.axis ? 0 : 0.00001;
      const nextDistance = current.distance + edge.distance;
      const nextCost = current.cost + edge.distance + bendPenalty;
      const nextKey = stateKey(edge.node, edge.axis);
      if (nextCost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY) - ROUTING_EPSILON) continue;
      costs.set(nextKey, nextCost);
      previous.set(nextKey, current.stateKey);
      queue.push({ axis: edge.axis, cost: nextCost, distance: nextDistance, node: edge.node, stateKey: nextKey });
    }
  }
  if (!winningState) {
    const firstCorner: PlanarPoint = [start[0], end[1]];
    const secondCorner: PlanarPoint = [end[0], start[1]];
    if (!segmentBlocked(start, firstCorner, obstacles) && !segmentBlocked(firstCorner, end, obstacles)) {
      return [start, firstCorner, end];
    }
    return [start, secondCorner, end];
  }

  const path: PlanarPoint[] = [];
  let cursor: string | undefined = winningState.stateKey;
  while (cursor) {
    const [node] = cursor.split(":").map(Number);
    path.push(nodes[node]);
    cursor = previous.get(cursor);
  }
  path.reverse();
  const asVectors = path.map(([x, y]) => [x, y, 0] as LayoutVector);
  return simplifyOrthogonalPoints(asVectors).map(([x, y]) => [x, y] as PlanarPoint);
}

function intervalDistance(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number) {
  const firstLow = Math.min(firstStart, firstEnd);
  const firstHigh = Math.max(firstStart, firstEnd);
  const secondLow = Math.min(secondStart, secondEnd);
  const secondHigh = Math.max(secondStart, secondEnd);
  return Math.max(0, Math.max(firstLow, secondLow) - Math.min(firstHigh, secondHigh));
}

function planarSegmentDistance(firstStart: PlanarPoint, firstEnd: PlanarPoint, secondStart: PlanarPoint, secondEnd: PlanarPoint) {
  const firstVertical = Math.abs(firstStart[0] - firstEnd[0]) < ROUTING_EPSILON;
  const secondVertical = Math.abs(secondStart[0] - secondEnd[0]) < ROUTING_EPSILON;
  if (firstVertical !== secondVertical) {
    const verticalStart = firstVertical ? firstStart : secondStart;
    const verticalEnd = firstVertical ? firstEnd : secondEnd;
    const horizontalStart = firstVertical ? secondStart : firstStart;
    const horizontalEnd = firstVertical ? secondEnd : firstEnd;
    const crossingX = verticalStart[0];
    const crossingY = horizontalStart[1];
    const horizontalGap = crossingX < Math.min(horizontalStart[0], horizontalEnd[0])
      ? Math.min(horizontalStart[0], horizontalEnd[0]) - crossingX
      : crossingX > Math.max(horizontalStart[0], horizontalEnd[0])
        ? crossingX - Math.max(horizontalStart[0], horizontalEnd[0])
        : 0;
    const verticalGap = crossingY < Math.min(verticalStart[1], verticalEnd[1])
      ? Math.min(verticalStart[1], verticalEnd[1]) - crossingY
      : crossingY > Math.max(verticalStart[1], verticalEnd[1])
        ? crossingY - Math.max(verticalStart[1], verticalEnd[1])
        : 0;
    return Math.hypot(horizontalGap, verticalGap);
  }
  if (firstVertical) {
    return Math.hypot(
      Math.abs(firstStart[0] - secondStart[0]),
      intervalDistance(firstStart[1], firstEnd[1], secondStart[1], secondEnd[1]),
    );
  }
  return Math.hypot(
    intervalDistance(firstStart[0], firstEnd[0], secondStart[0], secondEnd[0]),
    Math.abs(firstStart[1] - secondStart[1]),
  );
}

function footprintsConflict(first: PlanarPoint[], second: PlanarPoint[], clearance: number) {
  return first.slice(0, -1).some((start, firstIndex) => (
    second.slice(0, -1).some((otherStart, secondIndex) => (
      planarSegmentDistance(start, first[firstIndex + 1], otherStart, second[secondIndex + 1]) < clearance
    ))
  ));
}

function chooseWallPlane(
  footprint: PlanarPoint[],
  radiusM: number,
  minimumPlaneZ: number,
  occupiedRoutes: RoutedWallFootprint[],
) {
  const conflicts = occupiedRoutes.filter((route) => footprintsConflict(
    footprint,
    route.points,
    radiusM + route.radiusM + 0.004,
  ));
  const candidates = uniqueSorted([
    minimumPlaneZ,
    ...conflicts.map((route) => Math.max(
      minimumPlaneZ,
      route.planeZ + route.radiusM + radiusM + WALL_ROUTE_DEPTH_CLEARANCE_M,
    )),
  ]);
  return candidates.find((candidate) => conflicts.every((route) => (
    Math.abs(candidate - route.planeZ) >= route.radiusM + radiusM + WALL_ROUTE_DEPTH_CLEARANCE_M - 0.0005
  ))) ?? candidates.at(-1)!;
}

function adjacentBacktrackingCorners(points: LayoutVector[]) {
  return points.slice(1, -1).reduce((count, point, index) => {
    const previous = points[index];
    const next = points[index + 2];
    const incoming: LayoutVector = [
      point[0] - previous[0],
      point[1] - previous[1],
      point[2] - previous[2],
    ];
    const outgoing: LayoutVector = [
      next[0] - point[0],
      next[1] - point[1],
      next[2] - point[2],
    ];
    const incomingLength = Math.hypot(...incoming);
    const outgoingLength = Math.hypot(...outgoing);
    if (incomingLength < ROUTING_EPSILON || outgoingLength < ROUTING_EPSILON) return count;
    const alignment = (
      incoming[0] * outgoing[0] + incoming[1] * outgoing[1] + incoming[2] * outgoing[2]
    ) / (incomingLength * outgoingLength);
    return count + Number(alignment < -0.98);
  }, 0);
}

/**
 * Computes the shortest obstacle-free route on the equipment wall. The only
 * authored positions are device/port positions; every intermediate point is a
 * visibility-graph result. Service cables leave every modeled bottom edge
 * vertically downward before either changing depth or moving sideways.
 */
export function automaticWallRoute(
  start: LayoutVector,
  end: LayoutVector,
  options: AutomaticWallRouteOptions,
) {
  const clearance = Math.max(0.018, options.radiusM + 0.012);
  const sourceDevice = options.sourceDeviceId ? options.devices[options.sourceDeviceId] : undefined;
  const targetDevice = options.targetDeviceId ? options.devices[options.targetDeviceId] : undefined;
  const startEscape = orientedBreakout(
    start,
    options.sourceDirection,
    sourceDevice,
    options.sourceTerminalClearanceM ?? clearance,
  );
  const startRoutingEscape: PlanarPoint = [
    round(startEscape[0] + (options.sourceLateralOffsetM ?? 0)),
    startEscape[1],
  ];
  const endEscape = orientedBreakout(
    end,
    options.targetDirection,
    targetDevice,
    options.targetTerminalClearanceM ?? clearance,
  );
  const endRoutingEscape: PlanarPoint = [
    round(endEscape[0] + (options.targetLateralOffsetM ?? 0)),
    endEscape[1],
  ];
  const obstacles = Object.values(options.devices)
    .filter((device) => device.mounting === "wall" && device.id !== "equipmentBoard")
    .map((device) => {
      const deviceClearance = device.id === options.sourceDeviceId
        ? options.sourceTerminalClearanceM ?? clearance
        : device.id === options.targetDeviceId
          ? options.targetTerminalClearanceM ?? clearance
          : clearance;
      return {
        id: device.id,
        left: round(device.position[0] - device.size[0] / 2 - deviceClearance),
        right: round(device.position[0] + device.size[0] / 2 + deviceClearance),
        bottom: round(device.position[1] - device.size[1] / 2 - deviceClearance),
        top: round(device.position[1] + device.size[1] / 2 + deviceClearance),
      };
    });
  obstacles.push(...(options.additionalObstacles ?? []));
  const graphPlanarPath = shortestRectilinearPath(startRoutingEscape, endRoutingEscape, obstacles);
  // Both Manhattan L-corners have the same length when they are clear. Score
  // equal-length candidates by reversals so the path remains compact after the
  // mandatory downward terminal breakouts have been applied.
  const directPlanarPaths: PlanarPoint[][] = [
    [startRoutingEscape, [startRoutingEscape[0], endRoutingEscape[1]], endRoutingEscape],
    [startRoutingEscape, [endRoutingEscape[0], startRoutingEscape[1]], endRoutingEscape],
  ].filter((candidate) => candidate.slice(1).every((point, index) => (
    !segmentBlocked(candidate[index], point, obstacles)
  )));
  const planarPath = [graphPlanarPath, ...directPlanarPaths]
    .map((candidate) => simplifyOrthogonalPoints(
      candidate.map(([x, y]) => [x, y, 0] as LayoutVector),
    ))
    .sort((first, second) => {
      const firstRoute = simplifyOrthogonalPoints([
        [start[0], start[1], 0],
        ...first,
        [end[0], end[1], 0],
      ]);
      const secondRoute = simplifyOrthogonalPoints([
        [start[0], start[1], 0],
        ...second,
        [end[0], end[1], 0],
      ]);
      const firstLength = routeLength(firstRoute);
      const secondLength = routeLength(secondRoute);
      return firstLength - secondLength ||
        adjacentBacktrackingCorners(firstRoute) - adjacentBacktrackingCorners(secondRoute) ||
        planarDirectionReversals(firstRoute) - planarDirectionReversals(secondRoute) ||
        firstRoute.length - secondRoute.length;
    })[0]
    .map(([x, y]) => [x, y] as PlanarPoint);
  const footprint: PlanarPoint[] = [
    [start[0], start[1]] as PlanarPoint,
    startEscape,
    startRoutingEscape,
    ...planarPath.slice(1, -1),
    endRoutingEscape,
    endEscape,
    [end[0], end[1]] as PlanarPoint,
  ];
  const basePlaneZ = round(options.equipmentBoardFrontZ + 0.035);
  // Wall-mounted terminals protrude beyond their device faces. Keep the
  // shared routing plane far enough forward that the cable body (not only its
  // centerline) clears both enclosures before it begins moving in X/Y. This is
  // especially important for the short UniFi-to-Ekrano link, whose previous
  // plane sat inside the expanded UniFi front-face obstacle.
  const terminalFacePlaneZ = Math.max(
    sourceDevice?.mounting === "wall"
      ? start[2] + options.radiusM + 0.006
      : Number.NEGATIVE_INFINITY,
    targetDevice?.mounting === "wall"
      ? end[2] + options.radiusM + 0.006
      : Number.NEGATIVE_INFINITY,
  );
  const minimumPlaneZ = Math.max(
    basePlaneZ,
    options.minimumPlaneZ ?? basePlaneZ,
    terminalFacePlaneZ,
  );
  const planeZ = chooseWallPlane(
    footprint,
    options.radiusM,
    minimumPlaneZ,
    options.occupiedRoutes ?? [],
  );
  const firstPlanarStep = planarPath[1];
  const lastPlanarStep = planarPath.at(-2);
  const canDeferSourceDepth = options.deferSourceDepthTransition && firstPlanarStep &&
    Math.abs(firstPlanarStep[0] - startEscape[0]) > ROUTING_EPSILON;
  const canDeferTargetDepth = options.deferTargetDepthTransition && lastPlanarStep &&
    Math.abs(lastPlanarStep[0] - endEscape[0]) > ROUTING_EPSILON;
  const sourceDeparture: LayoutVector[] = canDeferSourceDepth
    ? [
        start,
        [startEscape[0], startEscape[1], start[2]],
        [startRoutingEscape[0], startRoutingEscape[1], start[2]],
        [firstPlanarStep[0], firstPlanarStep[1], start[2]],
        [firstPlanarStep[0], firstPlanarStep[1], planeZ],
      ]
    : [
        start,
        [startEscape[0], startEscape[1], start[2]],
        [startRoutingEscape[0], startRoutingEscape[1], start[2]],
        [startRoutingEscape[0], startRoutingEscape[1], planeZ],
      ];
  const sourcePlanarStart = canDeferSourceDepth ? 2 : 1;
  const targetPlanarEnd = canDeferTargetDepth
    ? Math.max(sourcePlanarStart, planarPath.length - 2)
    : planarPath.length;
  const targetArrival: LayoutVector[] = canDeferTargetDepth
    ? [
        [lastPlanarStep[0], lastPlanarStep[1], planeZ],
        [lastPlanarStep[0], lastPlanarStep[1], end[2]],
        [endEscape[0], endEscape[1], end[2]],
        end,
      ]
    : [
        [endRoutingEscape[0], endRoutingEscape[1], end[2]],
        [endEscape[0], endEscape[1], end[2]],
        end,
      ];
  const points: LayoutVector[] = [
    ...sourceDeparture,
    ...planarPath.slice(sourcePlanarStart, targetPlanarEnd)
      .map(([x, y]) => [x, y, planeZ] as LayoutVector),
    ...targetArrival,
  ];
  return {
    footprint: simplifyOrthogonalPoints(footprint.map(([x, y]) => [x, y, 0] as LayoutVector))
      .map(([x, y]) => [x, y] as PlanarPoint),
    planeZ,
    points: simplifyOrthogonalPoints(points),
  };
}

export function routeLength(points: LayoutVector[]) {
  return round(points.slice(1).reduce(
    (sum, point, index) => sum + distance(points[index], point),
    0,
  ));
}

type SegmentProximity = {
  distanceM: number;
  firstPoint: LayoutVector;
  secondPoint: LayoutVector;
};

const subtract = (first: LayoutVector, second: LayoutVector): LayoutVector => [
  first[0] - second[0],
  first[1] - second[1],
  first[2] - second[2],
];

const dot = (first: LayoutVector, second: LayoutVector) => (
  first[0] * second[0] + first[1] * second[1] + first[2] * second[2]
);

const addScaled = (point: LayoutVector, direction: LayoutVector, scale: number): LayoutVector => [
  point[0] + direction[0] * scale,
  point[1] + direction[1] * scale,
  point[2] + direction[2] * scale,
];

function closestSegmentPoints(
  firstStart: LayoutVector,
  firstEnd: LayoutVector,
  secondStart: LayoutVector,
  secondEnd: LayoutVector,
): SegmentProximity {
  const firstDirection = subtract(firstEnd, firstStart);
  const secondDirection = subtract(secondEnd, secondStart);
  const offset = subtract(firstStart, secondStart);
  const firstLengthSquared = dot(firstDirection, firstDirection);
  const secondLengthSquared = dot(secondDirection, secondDirection);
  const firstOffset = dot(firstDirection, offset);
  const secondOffset = dot(secondDirection, offset);
  let firstT = 0;
  let secondT = 0;

  if (firstLengthSquared <= ROUTING_EPSILON && secondLengthSquared <= ROUTING_EPSILON) {
    // Both segments are points.
  } else if (firstLengthSquared <= ROUTING_EPSILON) {
    secondT = Math.max(0, Math.min(1, secondOffset / secondLengthSquared));
  } else if (secondLengthSquared <= ROUTING_EPSILON) {
    firstT = Math.max(0, Math.min(1, -firstOffset / firstLengthSquared));
  } else {
    const alignment = dot(firstDirection, secondDirection);
    const denominator = firstLengthSquared * secondLengthSquared - alignment * alignment;
    if (Math.abs(denominator) > ROUTING_EPSILON) {
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
      firstT = Math.max(0, Math.min(
        1,
        (alignment - firstOffset) / firstLengthSquared,
      ));
    }
  }

  const firstPoint = addScaled(firstStart, firstDirection, firstT);
  const secondPoint = addScaled(secondStart, secondDirection, secondT);
  return { distanceM: distance(firstPoint, secondPoint), firstPoint, secondPoint };
}

function sharedTerminalContact(
  first: PhysicalCableRoute,
  second: PhysicalCableRoute,
  proximity: SegmentProximity,
  requiredClearanceM: number,
) {
  const firstTerminals = [first.points[0], first.points.at(-1)!];
  const secondTerminals = [second.points[0], second.points.at(-1)!];
  const terminalAllowanceM = Math.max(0.018, requiredClearanceM * 1.5);
  return firstTerminals.some((firstTerminal) => secondTerminals.some((secondTerminal) => (
    distance(firstTerminal, secondTerminal) <= requiredClearanceM &&
    distance(proximity.firstPoint, firstTerminal) <= terminalAllowanceM &&
    distance(proximity.secondPoint, secondTerminal) <= terminalAllowanceM
  )));
}

export function cableRoutePairClearanceIssues(
  first: PhysicalCableRoute,
  second: PhysicalCableRoute,
  clearanceM = 0.003,
) {
  const issues: string[] = [];
  const requiredClearanceM = first.radiusM + second.radiusM + clearanceM;
  first.points.slice(0, -1).forEach((firstStart, firstSegment) => {
    const firstEnd = first.points[firstSegment + 1];
    second.points.slice(0, -1).forEach((secondStart, secondSegment) => {
      const secondEnd = second.points[secondSegment + 1];
      const boundingBoxesOverlap = ([0, 1, 2] as const).every((axis) => (
        Math.max(firstStart[axis], firstEnd[axis]) + requiredClearanceM >=
          Math.min(secondStart[axis], secondEnd[axis]) &&
        Math.max(secondStart[axis], secondEnd[axis]) + requiredClearanceM >=
          Math.min(firstStart[axis], firstEnd[axis])
      ));
      if (!boundingBoxesOverlap) return;
      const proximity = closestSegmentPoints(firstStart, firstEnd, secondStart, secondEnd);
      if (proximity.distanceM >= requiredClearanceM - ROUTING_EPSILON) return;
      if (sharedTerminalContact(first, second, proximity, requiredClearanceM)) return;
      issues.push(
        `${first.id}:${firstSegment} intersects ${second.id}:${secondSegment} ` +
        `(${round(proximity.distanceM * 1000, 1)} mm < ${round(requiredClearanceM * 1000, 1)} mm)`,
      );
    });
  });
  return issues;
}

export function cableClearanceIssues(
  routes: PhysicalCableRoute[],
  clearanceM = 0.003,
) {
  return routes.flatMap((first, firstIndex) => routes.slice(firstIndex + 1).flatMap((second) => (
    cableRoutePairClearanceIssues(first, second, clearanceM)
  )));
}

function projectedCableRoutePairIssues(
  first: PhysicalCableRoute,
  second: PhysicalCableRoute,
  clearanceM = 0.002,
) {
  const issues: string[] = [];
  const requiredClearanceM = first.radiusM + second.radiusM + clearanceM;
  const flatten = (point: LayoutVector): LayoutVector => [point[0], point[1], 0];
  const flattenedFirst = { ...first, points: first.points.map(flatten) };
  const flattenedSecond = { ...second, points: second.points.map(flatten) };
  first.points.slice(0, -1).forEach((firstStart, firstSegment) => {
    const firstEnd = first.points[firstSegment + 1];
    if (Math.hypot(firstEnd[0] - firstStart[0], firstEnd[1] - firstStart[1]) < ROUTING_EPSILON) return;
    second.points.slice(0, -1).forEach((secondStart, secondSegment) => {
      const secondEnd = second.points[secondSegment + 1];
      if (Math.hypot(secondEnd[0] - secondStart[0], secondEnd[1] - secondStart[1]) < ROUTING_EPSILON) return;
      const proximity = closestSegmentPoints(
        flatten(firstStart),
        flatten(firstEnd),
        flatten(secondStart),
        flatten(secondEnd),
      );
      if (proximity.distanceM >= requiredClearanceM - ROUTING_EPSILON) return;
      if (sharedTerminalContact(
        flattenedFirst,
        flattenedSecond,
        proximity,
        requiredClearanceM,
      )) return;
      issues.push(
        `${first.id}:${firstSegment} projects across ${second.id}:${secondSegment} ` +
        `(${round(proximity.distanceM * 1000, 1)} mm < ${round(requiredClearanceM * 1000, 1)} mm)`,
      );
    });
  });
  return issues;
}

export function projectedCableConflictIssues(
  routes: PhysicalCableRoute[],
  clearanceM = 0.002,
) {
  return routes.flatMap((first, firstIndex) => routes.slice(firstIndex + 1).flatMap((second) => (
    projectedCableRoutePairIssues(first, second, clearanceM).slice(0, 1)
  )));
}

export function axisDirectionReversals(points: LayoutVector[], axis: 0 | 1 | 2) {
  const directions = points.slice(1).flatMap((point, index) => {
    const delta = point[axis] - points[index][axis];
    // Treat sub-millimetre grid quantization as the same fabrication lane. It
    // is far below the modeled cable diameters and cannot form a visible bend.
    if (Math.abs(delta) < 0.001) return [];
    return [Math.sign(delta)];
  });
  return directions.slice(1).reduce(
    (count, direction, index) => count + (direction !== directions[index] ? 1 : 0),
    0,
  );
}

export function planarDirectionReversals(points: LayoutVector[]) {
  return axisDirectionReversals(points, 0) + axisDirectionReversals(points, 1);
}

function wallCenterZ(boardFrontZ: number, depth: number, mountingGapM = 0.004) {
  return round(boardFrontZ + mountingGapM + depth / 2);
}

function createDevice(
  id: string,
  position: LayoutVector,
  size: LayoutVector,
  mounting: PhysicalDevice["mounting"],
): PhysicalDevice {
  return { id, position, size, mounting };
}

/**
 * The three through-wall rocker switches protrude from the fixed left side of
 * the junction enclosure. They are routing geometry, not another item in the
 * BOM, but cables and neighboring equipment still have to clear their real
 * envelope. Keeping the envelope derived from the junction pose makes it move
 * with every offline placement candidate.
 */
function createJunctionControlsDevice(junction: PhysicalDevice) {
  const junctionLeft = junction.position[0] - junction.size[0] / 2;
  return createDevice(
    "junctionControls",
    [
      round(junctionLeft - 0.017),
      round(junction.position[1] + 0.063),
      round(junction.position[2] + 0.008),
    ],
    [0.034, 0.116, 0.064],
    "wall",
  );
}

function createRoute(
  id: string,
  kind: PhysicalCableRoute["kind"],
  points: LayoutVector[],
  radiusM: number,
  conductors = 1,
  metadata: Pick<PhysicalCableRoute, "routing" | "sourceDeviceId" | "sourcePortId" | "targetDeviceId" | "targetPortId"> = {
    routing: "fixed-site",
  },
): PhysicalCableRoute {
  const rectilinearPoints = rectilinearizeRoute(points);
  return {
    id,
    kind,
    points: rectilinearPoints,
    radiusM,
    conductors,
    lengthM: routeLength(rectilinearPoints),
    planarDirectionReversals: planarDirectionReversals(rectilinearPoints),
    ...metadata,
  };
}

function bottomPort(device: PhysicalDevice, offsetX: number, protrusion = 0.006): LayoutVector {
  return [
    round(device.position[0] + offsetX),
    round(device.position[1] - device.size[1] / 2 - protrusion),
    round(device.position[2]),
  ];
}

function busbarStud(device: PhysicalDevice, index: number, studCount: number): LayoutVector {
  const spacing = 0.106 / Math.max(1, studCount - 1);
  return bottomPort(device, -0.053 + spacing * index);
}

function physicalPortDirection(portId: string, deviceId?: string): LayoutVector {
  if (portId === "panelStringAPositive" || portId === "panelStringBPositive") return [1, 0, 0];
  if (portId === "panelStringANegative" || portId === "panelStringBNegative") return [0, 0, -1];
  if (portId === "arrayFrameEarth") return [1, 0, 0];
  if (portId === "earthElectrode") return [0, 1, 0];
  if (deviceId === "generator") return [1, 0, 0];
  // The small balancer ring is stacked on the same battery post as a heavy
  // lug. Give it the other physically available departure axis so both
  // connector barrels and straight-on approaches remain distinct.
  if (deviceId?.startsWith("battery") && portId.endsWith("Balancer")) return [0, 0, 1];
  if (deviceId?.startsWith("battery")) return [0, 1, 0];
  return [0, -1, 0];
}

function portApproachPoint(
  port: LayoutVector,
  direction: LayoutVector,
  radiusM: number,
): LayoutVector {
  const lengthM = Math.max(0.018, radiusM * 2 + 0.006);
  return port.map((value, axis) => round(value + direction[axis] * lengthM)) as LayoutVector;
}

function applyOrientedPortApproaches(
  route: PhysicalCableRoute,
  ports: Record<string, LayoutVector>,
) {
  let points = route.points.map((point) => [...point] as LayoutVector);
  if (route.sourcePortId && ports[route.sourcePortId]) {
    const source = ports[route.sourcePortId];
    const direction = physicalPortDirection(route.sourcePortId, route.sourceDeviceId);
    const approach = portApproachPoint(
      source,
      direction,
      route.radiusM,
    );
    const approachLength = distance(source, approach);
    while (points[1]) {
      const delta = points[1].map((value, axis) => value - source[axis]) as LayoutVector;
      const projection = delta.reduce((sum, value, axis) => sum + value * direction[axis], 0);
      const lateral = Math.hypot(...delta.map((value, axis) => value - direction[axis] * projection) as LayoutVector);
      if (projection < -ROUTING_EPSILON || projection > approachLength + ROUTING_EPSILON || lateral > ROUTING_EPSILON) break;
      points.splice(1, 1);
    }
    points = [source, approach, ...points.slice(1)];
  }
  if (route.targetPortId && ports[route.targetPortId]) {
    const target = ports[route.targetPortId];
    const direction = physicalPortDirection(route.targetPortId, route.targetDeviceId);
    const approach = portApproachPoint(
      target,
      direction,
      route.radiusM,
    );
    const approachLength = distance(target, approach);
    while (points.at(-2)) {
      const prior = points.at(-2)!;
      const delta = prior.map((value, axis) => value - target[axis]) as LayoutVector;
      const projection = delta.reduce((sum, value, axis) => sum + value * direction[axis], 0);
      const lateral = Math.hypot(...delta.map((value, axis) => value - direction[axis] * projection) as LayoutVector);
      if (projection < -ROUTING_EPSILON || projection > approachLength + ROUTING_EPSILON || lateral > ROUTING_EPSILON) break;
      points.splice(points.length - 2, 1);
    }
    points = [...points.slice(0, -1), approach, target];
  }
  const normalized = rectilinearizeRoute(points);
  route.points = normalized;
  route.lengthM = routeLength(normalized);
  route.planarDirectionReversals = planarDirectionReversals(normalized);
}

function buildPhysicalPortSpecifications(
  routes: Record<string, PhysicalCableRoute>,
  ports: Record<string, LayoutVector>,
  devices: Record<string, PhysicalDevice>,
) {
  const connections = new Map<string, { deviceId?: string; radiusM: number }>();
  Object.values(routes).forEach((route) => {
    if (route.sourcePortId) {
      const current = connections.get(route.sourcePortId);
      connections.set(route.sourcePortId, {
        deviceId: route.sourceDeviceId,
        radiusM: Math.max(current?.radiusM ?? 0, route.radiusM),
      });
    }
    if (route.targetPortId) {
      const current = connections.get(route.targetPortId);
      connections.set(route.targetPortId, {
        deviceId: route.targetDeviceId,
        radiusM: Math.max(current?.radiusM ?? 0, route.radiusM),
      });
    }
  });
  return Object.fromEntries([...connections].flatMap(([id, connection]) => {
    const position = ports[id];
    if (!position) return [];
    const direction = physicalPortDirection(id, connection.deviceId);
    const device = connection.deviceId ? devices[connection.deviceId] : undefined;
    let lengthM = 0.012;
    if (device) {
      const axis = direction.findIndex((value) => Math.abs(value) > 0.5);
      if (axis >= 0) {
        const faceCoordinate = device.position[axis] + direction[axis] * device.size[axis] / 2;
        const projectedLength = (position[axis] - faceCoordinate) * direction[axis];
        if (projectedLength > 0.002 && projectedLength < 0.08) lengthM = projectedLength;
      }
    }
    const face = position.map((value, axis) => round(value - direction[axis] * lengthM)) as LayoutVector;
    return [[id, {
      cableRadiusM: connection.radiusM,
      deviceId: connection.deviceId,
      direction,
      face,
      lengthM: round(lengthM),
      position,
    } satisfies PhysicalPortSpecification]];
  }));
}

function physicalPortApproachIssues(
  routes: Record<string, PhysicalCableRoute>,
  ports: Record<string, PhysicalPortSpecification>,
) {
  const issues: string[] = [];
  const aligned = (from: LayoutVector, to: LayoutVector, direction: LayoutVector) => {
    const delta = to.map((value, axis) => value - from[axis]) as LayoutVector;
    const length = Math.hypot(...delta);
    if (length < 0.0175) return false;
    const dot = delta.reduce((sum, value, axis) => sum + value * direction[axis], 0) / length;
    const lateral = Math.hypot(...delta.map((value, axis) => value - direction[axis] * length) as LayoutVector);
    return dot > 0.999 && lateral < 0.0005;
  };
  Object.values(routes).forEach((route) => {
    if (route.sourcePortId) {
      const port = ports[route.sourcePortId];
      if (!port || !route.points[1] || !aligned(route.points[0], route.points[1], port.direction)) {
        issues.push(`${route.id}:source:${route.sourcePortId}`);
      }
    }
    if (route.targetPortId) {
      const port = ports[route.targetPortId];
      if (!port || !route.points.at(-2) || !aligned(route.points.at(-1)!, route.points.at(-2)!, port.direction)) {
        issues.push(`${route.id}:target:${route.targetPortId}`);
      }
    }
  });
  return issues;
}

function wallOverlapIssues(devices: Record<string, PhysicalDevice>) {
  const wallDevices = Object.values(devices).filter((device) => device.mounting === "wall");
  const issues: string[] = [];
  const clearance = WALL_DEVICE_CLEARANCE_M;
  for (let firstIndex = 0; firstIndex < wallDevices.length; firstIndex += 1) {
    const first = wallDevices[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < wallDevices.length; secondIndex += 1) {
      const second = wallDevices[secondIndex];
      if (new Set([first.id, second.id]).has("junction") && new Set([first.id, second.id]).has("junctionControls")) {
        continue;
      }
      const overlapX = Math.abs(first.position[0] - second.position[0]) <
        (first.size[0] + second.size[0]) / 2 + clearance;
      const overlapY = Math.abs(first.position[1] - second.position[1]) <
        (first.size[1] + second.size[1]) / 2 + clearance;
      if (overlapX && overlapY) issues.push(`${first.id}:${second.id}`);
    }
  }
  return issues;
}

function withOverrides(
  devices: Record<string, PhysicalDevice>,
  overrides: PhysicalLayoutInput["deviceOverrides"],
) {
  if (!overrides) return devices;
  Object.entries(overrides).forEach(([id, override]) => {
    if (!devices[id] || !override.position) return;
    devices[id] = { ...devices[id], position: [...override.position] as LayoutVector };
  });
  return devices;
}

function routeOccupiesJunctionBack(route: PhysicalCableRoute, junction: PhysicalDevice, boardFrontZ: number) {
  const left = junction.position[0] - junction.size[0] / 2;
  const right = junction.position[0] + junction.size[0] / 2;
  const bottom = junction.position[1] - junction.size[1] / 2;
  const top = junction.position[1] + junction.size[1] / 2;
  const boxBackZ = junction.position[2] - junction.size[2] / 2;
  return route.points.slice(0, -1).some((start, index) => {
    const end = route.points[index + 1];
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      const point: LayoutVector = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t,
      ];
      if (
        point[0] > left && point[0] < right &&
        point[1] > bottom && point[1] < top &&
        point[2] >= boardFrontZ - 0.002 && point[2] <= boxBackZ + route.radiusM
      ) return true;
    }
    return false;
  });
}

function segmentIntersectsBounds(
  start: LayoutVector,
  end: LayoutVector,
  minimum: LayoutVector,
  maximum: LayoutVector,
) {
  let near = 0;
  let far = 1;
  for (const axis of [0, 1, 2] as RouteAxis[]) {
    const direction = end[axis] - start[axis];
    if (Math.abs(direction) < ROUTING_EPSILON) {
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

export function deviceFrontCrossingIssues(
  routes: PhysicalCableRoute[],
  devices: Record<string, PhysicalDevice>,
) {
  const wallDevices = Object.values(devices).filter((device) => (
    device.mounting === "wall" && device.id !== "equipmentBoard"
  ));
  const issues: string[] = [];
  routes.filter((route) => route.routing === "automatic-rectilinear").forEach((route) => {
    route.points.slice(0, -1).forEach((start, segmentIndex) => {
      const end = route.points[segmentIndex + 1];
      wallDevices.forEach((device) => {
        const isSourceTerminal = segmentIndex === 0 && route.sourceDeviceId === device.id;
        const isTargetTerminal = segmentIndex === route.points.length - 2 && route.targetDeviceId === device.id;
        if (isSourceTerminal || isTargetTerminal) return;
        const clearance = route.radiusM + 0.002;
        const minimum: LayoutVector = [
          device.position[0] - device.size[0] / 2 - clearance,
          device.position[1] - device.size[1] / 2 - clearance,
          // Reject the complete device body plus everything in front of it.
          // Using only the front-face Z let a cable centerline pass through a
          // deep enclosure (notably the USB station) while still reporting no
          // "front" crossing.
          device.position[2] - device.size[2] / 2 - clearance,
        ];
        const maximum: LayoutVector = [
          device.position[0] + device.size[0] / 2 + clearance,
          device.position[1] + device.size[1] / 2 + clearance,
          10,
        ];
        if (segmentIntersectsBounds(start, end, minimum, maximum)) {
          issues.push(`${route.id}:${segmentIndex}:${device.id}`);
        }
      });
    });
  });
  return [...new Set(issues)];
}

export function solvePhysicalLayout(input: PhysicalLayoutInput = {}): PhysicalLayoutSpecification {
  const optimizationRouting = input.routingEffort === "optimization";
  const backWall = { center: [4.1, 1.5, -2.2] as LayoutVector, size: [5.8, 3, 0.08] as LayoutVector };
  const equipmentBoard = {
    center: [2.95, 1.5, -2.13] as LayoutVector,
    size: [3.4, 2.5, 0.018] as LayoutVector,
    frontZ: -2.121,
  };
  const z = (depth: number) => wallCenterZ(equipmentBoard.frontZ, depth);
  // These four points are the array-side cable dressing exits. The short
  // panel leads terminate here; from this point all the way to the indoor PV
  // protection enclosure, each complete string conductor is solved by the
  // production Voxel A* router rather than by authored waypoints.
  const pvArrayExitAPositive: LayoutVector = [0.69, 0.68, -1.62];
  const pvArrayExitANegative: LayoutVector = [0.69, 0.58, -1.62];
  const pvArrayExitBPositive: LayoutVector = [0.72, 0.72, -1.55];
  const pvArrayExitBNegative: LayoutVector = [0.69, 0.52, -1.62];

  const defaultDeviceOverrides = optimizedPhysicalLayout.runtime?.deviceOverrides ?? {};
  const deviceOverrides = {
    ...defaultDeviceOverrides,
    ...input.deviceOverrides,
  };
  const devices = withOverrides({
    equipmentBoard: createDevice("equipmentBoard", equipmentBoard.center, equipmentBoard.size, "wall"),
    pvEntry: createDevice("pvEntry", [1.72, 0.5, z(0.12)], [0.25, 0.3, 0.12], "wall"),
    smartSolar: createDevice("smartSolar", [2.15, 0.55, z(0.103)], [0.295, 0.216, 0.103], "wall"),
    multiPlus: createDevice("multiPlus", [2.08, 1.92, z(0.141)], [0.268, 0.499, 0.141], "wall"),
    acBoard: createDevice("acBoard", [2.38, 1.75, z(0.1)], [0.22, 0.18, 0.1], "wall"),
    junction: createDevice("junction", [3.45, 1.68, z(0.15)], [0.49, 0.4, 0.15], "wall"),
    ekran: createDevice("ekran", [3.45, 2.06, z(0.0298)], [0.187, 0.124, 0.0298], "wall"),
    unifi: createDevice("unifi", [3.68, 2.06, z(0.03)], [0.098, 0.098, 0.03], "wall"),
    usb: createDevice("usb", [3.82, 2.06, z(0.075)], [0.18, 0.075, 0.075], "wall"),
    unifiPower: createDevice("unifiPower", [3.68, 1.9, z(0.03)], [0.1, 0.044, 0.03], "wall"),
    balancerA: createDevice("balancerA", [3.9, 0.75, z(0.047)], [0.113, 0.1, 0.047], "wall"),
    balancerB: createDevice("balancerB", [4.08, 0.75, z(0.047)], [0.113, 0.1, 0.047], "wall"),
    classTA: createDevice("classTA", [3.48, 0.53, z(0.06)], [0.15, 0.055, 0.06], "wall"),
    classTB: createDevice("classTB", [3.78, 0.53, z(0.06)], [0.15, 0.055, 0.06], "wall"),
    earthBar: createDevice("earthBar", [2.115, 1.16, z(0.026)], [0.14, 0.025, 0.026], "wall"),
    trailingSocket: createDevice("trailingSocket", [2.54, 1.48, -1.94], [0.09, 0.13, 0.07], "hanging"),
    generator: createDevice("generator", [0.15, 0.28, -2.8], [0.6, 0.56, 0.48], "exterior"),
    battery1: createDevice("battery1", [3.14, 0.11, -1.8], [0.52, 0.22, 0.238], "floor"),
    battery2: createDevice("battery2", [3.7, 0.11, -1.8], [0.52, 0.22, 0.238], "floor"),
    battery3: createDevice("battery3", [3.14, 0.11, -1.47], [0.52, 0.22, 0.238], "floor"),
    battery4: createDevice("battery4", [3.7, 0.11, -1.47], [0.52, 0.22, 0.238], "floor"),
    starlink: createDevice("starlink", [4.45, 3.36, -2.04], [0.2985, 0.0385, 0.259], "exterior"),
    indoorLight: createDevice("indoorLight", [5.15, 2.72, -0.72], [0.127, 0.1, 0.055], "hanging"),
    outdoorFlood: createDevice("outdoorFlood", [5.55, 2.55, -2.03], [0.127, 0.1, 0.055], "exterior"),
    pvArrayExitAPositive: createDevice("pvArrayExitAPositive", pvArrayExitAPositive, [0.012, 0.012, 0.012], "exterior"),
    pvArrayExitANegative: createDevice("pvArrayExitANegative", pvArrayExitANegative, [0.012, 0.012, 0.012], "exterior"),
    pvArrayExitBPositive: createDevice("pvArrayExitBPositive", pvArrayExitBPositive, [0.012, 0.012, 0.012], "exterior"),
    pvArrayExitBNegative: createDevice("pvArrayExitBNegative", pvArrayExitBNegative, [0.012, 0.012, 0.012], "exterior"),
    earthElectrode: createDevice("earthElectrode", [0.72, 0.1, -2.58], [0.03, 0.18, 0.03], "exterior"),
  }, deviceOverrides);
  devices.junctionControls = createJunctionControlsDevice(devices.junction);

  // The short tool lead and socket are accessories of the movable AC output
  // board. Their pose is therefore derived from that device rather than stored
  // as another independent absolute layout coordinate.
  if (!deviceOverrides.trailingSocket?.position) {
    devices.trailingSocket = {
      ...devices.trailingSocket,
      position: [
        round(devices.acBoard.position[0]),
        round(devices.acBoard.position[1] - 0.18),
        round(devices.acBoard.position[2] + 0.127),
      ],
    };
  }

  const ports: Record<string, LayoutVector> = {
    pvEntryStringAPositive: bottomPort(devices.pvEntry, -0.105),
    pvEntryStringANegative: bottomPort(devices.pvEntry, -0.07),
    pvEntryStringBPositive: bottomPort(devices.pvEntry, -0.035),
    pvEntryStringBNegative: bottomPort(devices.pvEntry, 0),
    pvEntryMpptPositive: bottomPort(devices.pvEntry, 0.035),
    pvEntryMpptNegative: bottomPort(devices.pvEntry, 0.07),
    smartSolarPvPositive: bottomPort(devices.smartSolar, -0.115),
    smartSolarPvNegative: bottomPort(devices.smartSolar, -0.069),
    smartSolarBatteryPositive: bottomPort(devices.smartSolar, -0.023),
    smartSolarBatteryNegative: bottomPort(devices.smartSolar, 0.023),
    multiPlusDcPositive: bottomPort(devices.multiPlus, -0.11),
    multiPlusDcNegative: bottomPort(devices.multiPlus, -0.066),
    multiPlusAcInputCable: bottomPort(devices.multiPlus, -0.022),
    multiPlusAcOutputCable: bottomPort(devices.multiPlus, 0.022),
    multiPlusTemperatureSense: bottomPort(devices.multiPlus, 0.088),
    acBoardAcCable: bottomPort(devices.acBoard, -0.06),
    acBoardToolCable: bottomPort(devices.acBoard, 0),
    trailingSocketAcCable: bottomPort(devices.trailingSocket, 0),
    generatorAcCable: [
      round(devices.generator.position[0] + devices.generator.size[0] / 2 + 0.012),
      round(devices.generator.position[1] - devices.generator.size[1] * 0.18),
      devices.generator.position[2],
    ],
    ekranPowerPositive: bottomPort(devices.ekran, -0.084),
    ekranPowerNegative: bottomPort(devices.ekran, -0.063),
    ekranVeDirect1: bottomPort(devices.ekran, -0.042),
    ekranVeDirect2: bottomPort(devices.ekran, -0.021),
    ekranVeBus: bottomPort(devices.ekran, 0),
    ekranEthernet: bottomPort(devices.ekran, 0.021),
    ekranDigitalInput1: bottomPort(devices.ekran, 0.042),
    ekranDigitalInput2: bottomPort(devices.ekran, 0.063),
    unifiPower: bottomPort(devices.unifi, -0.032),
    unifiWan: bottomPort(devices.unifi, 0),
    unifiLan: bottomPort(devices.unifi, 0.032),
    usbPositive: bottomPort(devices.usb, -0.02),
    usbNegative: bottomPort(devices.usb, 0.02),
    unifiConverterPositive: bottomPort(devices.unifiPower, -0.035),
    unifiConverterNegative: bottomPort(devices.unifiPower, 0),
    unifiConverterUsb: bottomPort(devices.unifiPower, 0.035),
    starlinkEthernet: bottomPort(devices.starlink, 0.04),
    starlinkPowerCable: bottomPort(devices.starlink, -0.025),
    indoorLightPositive: bottomPort(devices.indoorLight, -0.018),
    indoorLightNegative: bottomPort(devices.indoorLight, 0.018),
    outdoorFloodPositive: bottomPort(devices.outdoorFlood, -0.022),
    outdoorFloodNegative: bottomPort(devices.outdoorFlood, 0.022),
    earthElectrode: [0.72, 0.1, -2.58],
    arrayFrameEarth: [-1.67, 0.13, -2.28],
    pvEntryEarth: bottomPort(devices.pvEntry, 0.105),
    smartSolarEarth: bottomPort(devices.smartSolar, 0.115),
    smartSolarData: bottomPort(devices.smartSolar, 0.069),
    multiPlusChassisEarth: bottomPort(devices.multiPlus, 0.11),
    multiPlusData: bottomPort(devices.multiPlus, 0.066),
    acBoardEarth: bottomPort(devices.acBoard, 0.06),
    ekranEarth: bottomPort(devices.ekran, 0.084),
    classTAInput: bottomPort(devices.classTA, -0.04),
    classTAOutput: bottomPort(devices.classTA, 0.04),
    classTBInput: bottomPort(devices.classTB, -0.04),
    classTBOutput: bottomPort(devices.classTB, 0.04),
    panelStringAPositive: [0.559, 0.925, -1.18],
    panelStringANegative: [-1.659, 0.205, -1.18],
    panelStringBPositive: [0.559, 0.925, 1.18],
    panelStringBNegative: [-1.659, 0.205, 1.18],
    pvArrayExitAPositive,
    pvArrayExitANegative,
    pvArrayExitBPositive,
    pvArrayExitBNegative,
  };
  for (let index = 0; index < 7; index += 1) {
    ports[`earthBar${index + 1}`] = busbarStud(devices.earthBar, index, 7);
  }

  const junctionBottom = round(devices.junction.position[1] - devices.junction.size[1] / 2 - 0.0145);
  Object.values(junctionInteriorRouting.glands).forEach((gland) => {
    const conductorPoints = Object.values(gland.conductorPoints);
    gland.exteriorPortIds.forEach((id, index) => {
      const xOffset = gland.exteriorPortIds.length === 1
        ? gland.x
        : conductorPoints[index]?.[0] ?? gland.x;
      ports[id] = [
        round(devices.junction.position[0] + xOffset),
        junctionBottom,
        round(devices.junction.position[2] + gland.zOffset),
      ];
    });
  });
  [devices.balancerA, devices.balancerB].forEach((balancer, balancerIndex) => {
    ["Positive", "Midpoint", "Negative", "Alarm"].forEach((terminal, terminalIndex) => {
      ports[`balancer${balancerIndex === 0 ? "A" : "B"}${terminal}`] = bottomPort(
        balancer,
        [-0.045, -0.015, 0.015, 0.045][terminalIndex],
      );
    });
  });
  const routes: Record<string, PhysicalCableRoute> = {};
  const addRoute = (
    id: string,
    kind: PhysicalCableRoute["kind"],
    points: LayoutVector[],
    radiusM: number,
    conductors = 1,
    metadata?: Pick<PhysicalCableRoute, "routing" | "sourceDeviceId" | "sourcePortId" | "targetDeviceId" | "targetPortId">,
  ) => { routes[id] = createRoute(id, kind, points, radiusM, conductors, metadata); };
  const occupiedWallRoutes: RoutedWallFootprint[] = [];
  const addAutomaticWallRoute = (
    id: string,
    kind: PhysicalCableRoute["kind"],
    sourcePortId: string,
    targetPortId: string,
    sourceDeviceId: string,
    targetDeviceId: string,
    radiusM: number,
    conductors = 1,
  ) => {
    const source = ports[sourcePortId];
    const target = ports[targetPortId];
    if (!source || !target) throw new Error(`Unknown automatic route endpoint for ${id}`);
    const sourceIsJunction = sourceDeviceId === "junction";
    const targetIsJunction = targetDeviceId === "junction";
    const junctionTerminalClearance = (port: LayoutVector) => {
      const junction = devices.junction;
      const exitsBelow = port[1] < junction.position[1] - junction.size[1] / 2;
      return exitsBelow
        // Leave a visible straight tail below every gland before the route is
        // allowed to fan sideways or move onto a depth lane. A blanket deep
        // gutter creates a horizontal crossbar that later vertical tails must
        // cross; candidate-selected lateral offsets below this short service
        // tail give the clearance solver a genuinely different topology.
        ? Math.max(0.02, radiusM + 0.012)
        : Math.max(0.012, radiusM + 0.004);
    };
    const junctionFront = round(
      devices.junction.position[2] + devices.junction.size[2] / 2 + 0.018,
    );
    const additionalObstacles: PlanarObstacle[] = [];
    // Dense display/network faces are the two places where a shortest route
    // must also reserve neighboring connector access. Other device terminals
    // sit on open bottom edges and need no extra graph nodes.
    const devicePortPrefixes: Record<string, string[]> = {
      ekran: ["ekran"],
      unifi: ["unifi"],
    };
    [sourceDeviceId, targetDeviceId]
      .filter((deviceId) => deviceId in devicePortPrefixes)
      .forEach((deviceId) => {
        const prefixes = devicePortPrefixes[deviceId] ?? [];
        Object.entries(ports).forEach(([portId, port]) => {
          if (
            portId === sourcePortId || portId === targetPortId ||
            !prefixes.some((prefix) => portId.startsWith(prefix))
          ) return;
          const terminalClearance = Math.max(0.012, radiusM + 0.004);
          additionalObstacles.push({
            id: `terminal-clearance:${portId}`,
            left: round(port[0] - terminalClearance),
            right: round(port[0] + terminalClearance),
            bottom: round(port[1] - terminalClearance),
            top: round(port[1] + terminalClearance),
          });
        });
      });
    const lanePitchM = Math.max(0.014, radiusM * 2 + 0.006);
    const baseTerminalClearanceM = Math.max(0.018, radiusM + 0.012);
    // The left MPPT output must pass beneath the adjacent right-hand output's
    // downward tail before both cables turn right. Assigning the left port the
    // deeper base lane avoids relying on a renderer-time crossover.
    const sourceBaseLane = sourcePortId === "junctionLoadPositive5"
      // This front-row gland sits directly behind the rear-row inside-light
      // pair in projection. Drop below both neighboring tails before changing
      // depth so the transition cannot spear through either conductor.
      ? 3
      : sourcePortId === "pvEntryMpptPositive" || sourcePortId === "junctionLoadPositive4"
        ? 1
        : 0;
    const priorAutomaticRoutes = Object.values(routes).filter((route) => (
      route.routing === "automatic-rectilinear"
    ));
    const candidate = (
      sourceLane: number,
      targetLane: number,
      deferSourceDepthTransition: boolean,
      deferTargetDepthTransition: boolean,
      sourceLateralOffsetM: number,
      targetLateralOffsetM: number,
    ) => {
      const generated = automaticWallRoute(source, target, {
        additionalObstacles,
        // Change depth immediately after the mandatory downward breakout.
        // Deferring that transition until after the first horizontal leg made
        // a left-hand gland sweep through every neighboring gland tail on the
        // enclosure face.  An immediate, lane-selected Z transition preserves
        // the bottom-only service rule while letting the horizontal run pass
        // in front of the other exits without touching them.
        deferSourceDepthTransition,
        deferTargetDepthTransition,
        devices,
        equipmentBoardFrontZ: equipmentBoard.frontZ,
        minimumPlaneZ: sourceIsJunction || targetIsJunction ? junctionFront : undefined,
        occupiedRoutes: occupiedWallRoutes,
        radiusM,
        sourceTerminalClearanceM: (
          sourceIsJunction ? junctionTerminalClearance(source) : baseTerminalClearanceM
        ) + (sourceBaseLane + sourceLane) * lanePitchM,
        sourceLateralOffsetM,
        sourceDeviceId,
        sourceDirection: physicalPortDirection(sourcePortId, sourceDeviceId),
        targetLateralOffsetM,
        targetTerminalClearanceM: (
          targetIsJunction ? junctionTerminalClearance(target) : baseTerminalClearanceM
        ) + targetLane * lanePitchM,
        targetDeviceId,
        targetDirection: physicalPortDirection(targetPortId, targetDeviceId),
      });
      const route = createRoute(id, kind, generated.points, radiusM, conductors, {
        routing: "automatic-rectilinear",
        sourceDeviceId,
        sourcePortId,
        targetDeviceId,
        targetPortId,
      });
      const issueCount = priorAutomaticRoutes.reduce((count, occupied) => (
        count + cableRoutePairClearanceIssues(route, occupied, 0.004).length
      ), 0);
      return {
        backtrackingCorners: adjacentBacktrackingCorners(route.points),
        frontCrossingCount: deviceFrontCrossingIssues([route], devices).length,
        generated,
        issueCount,
        laneCost: sourceLane + targetLane +
          (Math.abs(sourceLateralOffsetM) + Math.abs(targetLateralOffsetM)) / lanePitchM,
        projectedConflictCount: occupiedWallRoutes.filter((occupied) => footprintsConflict(
          generated.footprint,
          occupied.points,
          radiusM + occupied.radiusM + 0.002,
        )).length,
        route,
      };
    };
    const candidates: Array<ReturnType<typeof candidate>> = [];
    const collectCandidates = (
      minimumTotalLane: number,
      maximumTotalLane: number,
      expandedTopologies = false,
    ) => {
      let foundClear = false;
      for (
        let totalLane = minimumTotalLane;
        totalLane <= maximumTotalLane && !foundClear;
        totalLane += 1
      ) {
        for (let sourceLane = 0; sourceLane < (optimizationRouting ? 6 : 24) && !foundClear; sourceLane += 1) {
          const targetLane = totalLane - sourceLane;
          if (targetLane < 0 || targetLane >= 16) continue;
          // A bottom gland may either move onto its selected Z lane directly
          // after dropping, or first fan sideways on the enclosure-face
          // plane and then move forward. Comparing both derived forms gives
          // dense adjacent glands a collision-free escape without authored
          // waypoints.
          const depthStrategies: Array<[boolean, boolean]> = expandedTopologies && sourceIsJunction
            ? [
                [false, false],
                [true, false],
                [false, true],
                [true, true],
              ]
            : [[false, false]];
          const sourceLateralOffsets = id === "unifi-to-ekrano-data"
            ? [0, -lanePitchM * 3, -lanePitchM * 4, -lanePitchM * 5]
            : expandedTopologies && sourceIsJunction
              ? [0, lanePitchM, -lanePitchM]
              : [0];
          const targetDevice = devices[targetDeviceId];
          const targetLateralOffsets = expandedTopologies && targetDevice?.mounting === "wall"
            ? [0, lanePitchM, -lanePitchM]
            : expandedTopologies && targetDevice?.mounting !== "wall"
              ? [0, lanePitchM, -lanePitchM]
              : [0];
          for (const [deferSourceDepth, deferTargetDepth] of depthStrategies) {
            for (const sourceOffset of sourceLateralOffsets) {
              for (const targetOffset of targetLateralOffsets) {
                const next = candidate(
                  sourceLane,
                  targetLane,
                  deferSourceDepth,
                  deferTargetDepth,
                  sourceOffset,
                  targetOffset,
                );
                candidates.push(next);
                if (
                  next.issueCount === 0 && next.frontCrossingCount === 0 &&
                  next.backtrackingCorners === 0
                ) {
                  foundClear = true;
                  break;
                }
              }
              if (foundClear) break;
            }
            if (foundClear) break;
          }
        }
      }
      return foundClear;
    };
    // Always compare several source/target breakouts. A route that is clear in
    // 3D can still make an ugly projected crossing or force every later cable
    // onto a deeper plane. A small deterministic search makes the junction
    // fan-out read like ordered wiring instead of a stack of accidental loops.
    collectCandidates(0, optimizationRouting ? 3 : 7);
    const compareCandidates = (
      first: ReturnType<typeof candidate>,
      second: ReturnType<typeof candidate>,
    ) => (
      first.frontCrossingCount - second.frontCrossingCount ||
      first.issueCount - second.issueCount ||
      first.backtrackingCorners - second.backtrackingCorners ||
      first.projectedConflictCount - second.projectedConflictCount ||
      first.route.lengthM - second.route.lengthM ||
      first.generated.planeZ - second.generated.planeZ ||
      first.laneCost - second.laneCost
    );
    let selected = candidates.sort(compareCandidates)[0];
    if (
      selected.issueCount > 0 || selected.frontCrossingCount > 0 ||
      selected.backtrackingCorners > 0
    ) {
      // Dense bottom-gland fan-outs occasionally need to drop below several
      // already-routed horizontal trunks before changing depth. Search a
      // wider lane range only for those unresolved routes; ordinary links
      // retain the small, fast search above.
      // Only the unresolved route pays for lateral/deferred-depth topology
      // expansion. Ordinary routes keep the fast shortest-path evaluation.
      collectCandidates(0, optimizationRouting ? 7 : 30, !optimizationRouting);
      selected = candidates.sort(compareCandidates)[0];
    }
    occupiedWallRoutes.push({
      id,
      planeZ: selected.generated.planeZ,
      points: selected.generated.footprint,
      radiusM,
    });
    routes[id] = selected.route;
  };
  const addCollisionAwareEndpointBundle = (requests: Array<{
    id: string;
    kind: PhysicalCableRoute["kind"];
    sourcePortId: string;
    targetPortId: string;
    sourceDeviceId: string;
    targetDeviceId: string;
    radiusM: number;
  }>) => {
    // Solve the battery harness as one coherent bundle. Site, PV and wall
    // routes use their own depth-lane pass and do not force this local harness
    // in front of unrelated outdoor geometry.
    const occupiedRoutes = Object.values(routes).filter((route) => (
      route.id === "battery-series-a" || route.id === "battery-series-b"
    ));
    const terminalLeadOptions = (
      port: LayoutVector,
      device: PhysicalDevice,
      portId: string,
      leadM: number,
    ): LayoutVector[] => {
      const direction = physicalPortDirection(portId, device.id);
      return [[
        round(port[0] + direction[0] * leadM),
        round(port[1] + direction[1] * leadM),
        round(port[2] + direction[2] * leadM),
      ]];
    };

    requests.forEach((request) => {
      const source = ports[request.sourcePortId];
      const target = ports[request.targetPortId];
      const sourceDevice = devices[request.sourceDeviceId];
      const targetDevice = devices[request.targetDeviceId];
      if (!source || !target || !sourceDevice || !targetDevice) {
        throw new Error(`Unknown collision-aware endpoint for ${request.id}`);
      }
      const lanePitchM = Math.max(0.014, request.radiusM * 2 + 0.006);
      const junctionCableFrontZ = round(
        devices.junction.position[2] + devices.junction.size[2] / 2 + 0.018,
      );
      const planeBaseZ = Math.max(
        round(equipmentBoard.frontZ + 0.078),
        junctionCableFrontZ,
        round(source[2] + request.radiusM + 0.014),
      );
      let selected: { route: PhysicalCableRoute; laneCost: number } | undefined;
      let fallback: { route: PhysicalCableRoute; laneCost: number } | undefined;
      let fallbackIssueCount = Number.POSITIVE_INFINITY;
      const maximumSourceLane = optimizationRouting ? 3 : 8;
      const maximumTargetLane = optimizationRouting ? 4 : 12;
      const maximumDepthLane = optimizationRouting ? 10 : 32;
      const maximumLaneCost = maximumSourceLane - 1 + maximumTargetLane - 1 + maximumDepthLane - 1;
      const routingClearance = request.radiusM + 0.012;
      const routingObstacles = Object.values(devices)
        .filter((device) => device.mounting === "wall" && device.id !== "equipmentBoard")
        .map((device) => ({
          id: device.id,
          left: round(device.position[0] - device.size[0] / 2 - routingClearance),
          right: round(device.position[0] + device.size[0] / 2 + routingClearance),
          bottom: round(device.position[1] - device.size[1] / 2 - routingClearance),
          top: round(device.position[1] + device.size[1] / 2 + routingClearance),
        }));
      routeSearch:
      for (let totalLane = 0; totalLane <= maximumLaneCost; totalLane += 1) {
        for (let sourceLane = 0; sourceLane < maximumSourceLane; sourceLane += 1) {
          const sourceIsJunction = request.sourceDeviceId === "junction";
          const sourceUsesBackGlandRow = sourceIsJunction && source[2] < sourceDevice.position[2];
          const routesFromJunctionToLowerEquipment = sourceIsJunction && (
            target[1] < source[1] - 0.08
          );
          const baseSourceLeadM = sourceIsJunction
            ? (sourceUsesBackGlandRow ? 0.09 : 0.045)
            : 0.018;
          const lowerEquipmentCorridorY = round(target[1] + Math.max(
            0.03,
            targetDevice.mounting === "floor"
              ? request.radiusM * 3.5
              : request.radiusM * 3,
          ));
          const derivedSourceLeadM = routesFromJunctionToLowerEquipment
            ? Math.max(baseSourceLeadM, source[1] - lowerEquipmentCorridorY)
            : baseSourceLeadM;
          const allSourceLeads = terminalLeadOptions(
            source,
            sourceDevice,
            request.sourcePortId,
            derivedSourceLeadM + sourceLane * lanePitchM,
          );
          for (let targetLane = 0; targetLane < maximumTargetLane; targetLane += 1) {
            const allTargetLeads = terminalLeadOptions(
              target,
              targetDevice,
              request.targetPortId,
              0.018 + targetLane * lanePitchM,
            );
            const targetDirections = [0];
            for (let depthLane = 0; depthLane < maximumDepthLane; depthLane += 1) {
              if (sourceLane + targetLane + depthLane !== totalLane) continue;
              const planeZ = round(planeBaseZ + depthLane * lanePitchM);
              const sourceDirections = [0];
              for (const sourceDirection of sourceDirections) {
                const sourceLead = allSourceLeads[sourceDirection];
                const sourcePlane: LayoutVector = [sourceLead[0], sourceLead[1], planeZ];
                // Every wall-mounted terminal leaves vertically downward
                // before changing depth. Floor battery lugs retain alternate
                // lateral approaches because their real terminals face up.
                const sourceDepartures = [[source, sourceLead, sourcePlane]];
                for (const targetDirection of targetDirections) {
                  const targetLead = allTargetLeads[targetDirection];
                  const targetPlane: LayoutVector = [targetLead[0], targetLead[1], planeZ];
                  const planarPath = shortestRectilinearPath(
                    [sourcePlane[0], sourcePlane[1]],
                    [targetPlane[0], targetPlane[1]],
                    routingObstacles,
                  );
                  for (let departureOrder = 0; departureOrder < sourceDepartures.length; departureOrder += 1) {
                    const sourceDeparture = sourceDepartures[departureOrder];
                    const route = createRoute(
                      request.id,
                      request.kind,
                      [
                        ...sourceDeparture,
                        ...planarPath.slice(1).map(([x, y]) => [x, y, planeZ] as LayoutVector),
                        targetLead,
                        target,
                      ],
                      request.radiusM,
                      1,
                      {
                        routing: "automatic-rectilinear",
                        sourceDeviceId: request.sourceDeviceId,
                        sourcePortId: request.sourcePortId,
                        targetDeviceId: request.targetDeviceId,
                        targetPortId: request.targetPortId,
                      },
                    );
                    let issueCount = 0;
                    for (const occupied of occupiedRoutes) {
                      issueCount += cableRoutePairClearanceIssues(route, occupied, 0.003).length;
                      if (issueCount > fallbackIssueCount) break;
                    }
                    const candidate = {
                      route,
                      laneCost: totalLane + sourceDirection * 0.03 +
                        targetDirections.indexOf(targetDirection) * 0.02 +
                        departureOrder * 0.005,
                    };
                    if (issueCount === 0) {
                      selected = candidate;
                      break routeSearch;
                    }
                    if (
                      issueCount < fallbackIssueCount ||
                      issueCount === fallbackIssueCount &&
                        (!fallback || route.lengthM < fallback.route.lengthM)
                    ) {
                      fallbackIssueCount = issueCount;
                      fallback = candidate;
                    }
                  }
                }
              }
            }
          }
        }
      }
      selected ??= fallback;
      const selectedRoute = selected?.route;
      if (!selectedRoute) {
        throw new Error(`Unable to produce a route candidate for ${request.id}`);
      }
      routes[request.id] = selectedRoute;
      occupiedRoutes.push(selectedRoute);
      occupiedWallRoutes.push({
        id: request.id,
        planeZ: Math.max(...selectedRoute.points.map((point) => point[2])),
        points: selectedRoute.points
          .filter((point, index, points) => index === 0 || (
            Math.abs(point[0] - points[index - 1][0]) > ROUTING_EPSILON ||
            Math.abs(point[1] - points[index - 1][1]) > ROUTING_EPSILON
          ))
          .map(([x, y]) => [x, y] as PlanarPoint),
        radiusM: request.radiusM,
      });
    });
  };

  addRoute("pv-string-a-positive", "pv-positive", [ports.panelStringAPositive, [0.69, 0.925, -1.18], pvArrayExitAPositive], 0.0032, 1, { routing: "fixed-site", sourceDeviceId: "solarPanels", sourcePortId: "panelStringAPositive" });
  addRoute("pv-string-a-negative", "pv-negative", [ports.panelStringANegative, [-1.659, 0.205, -1.55], [-1.659, 0.58, -1.55], pvArrayExitANegative], 0.0032, 1, { routing: "fixed-site", sourceDeviceId: "solarPanels", sourcePortId: "panelStringANegative" });
  addRoute("pv-string-b-positive", "pv-positive", [ports.panelStringBPositive, [0.72, 0.925, 1.18], pvArrayExitBPositive], 0.0032, 1, { routing: "fixed-site", sourceDeviceId: "solarPanels", sourcePortId: "panelStringBPositive" });
  addRoute("pv-string-b-negative", "pv-negative", [ports.panelStringBNegative, [-1.659, 0.205, -1.5], [-1.659, 0.52, -1.5], pvArrayExitBNegative], 0.0032, 1, { routing: "fixed-site", sourceDeviceId: "solarPanels", sourcePortId: "panelStringBNegative" });

  // Each string keeps its own complete red/black 4 mm² home run. All four
  // conductors enter one indoor enclosure, where they are combined behind the
  // DC disconnect and Type 2 SPD. There is no separate array-side box.
  addAutomaticWallRoute("pv-home-run-a-positive", "pv-positive", "pvArrayExitAPositive", "pvEntryStringAPositive", "pvArrayExitAPositive", "pvEntry", 0.0032);
  addAutomaticWallRoute("pv-home-run-a-negative", "pv-negative", "pvArrayExitANegative", "pvEntryStringANegative", "pvArrayExitANegative", "pvEntry", 0.0032);
  addAutomaticWallRoute("pv-home-run-b-positive", "pv-positive", "pvArrayExitBPositive", "pvEntryStringBPositive", "pvArrayExitBPositive", "pvEntry", 0.0032);
  addAutomaticWallRoute("pv-home-run-b-negative", "pv-negative", "pvArrayExitBNegative", "pvEntryStringBNegative", "pvArrayExitBNegative", "pvEntry", 0.0032);

  addAutomaticWallRoute("pv-entry-to-mppt-positive", "pv-positive", "pvEntryMpptPositive", "smartSolarPvPositive", "pvEntry", "smartSolar", 0.0032);
  addAutomaticWallRoute("pv-entry-to-mppt-negative", "pv-negative", "pvEntryMpptNegative", "smartSolarPvNegative", "pvEntry", "smartSolar", 0.0032);

  addAutomaticWallRoute(
    "trailing-tool-flex",
    "three-core-ac",
    "acBoardToolCable",
    "trailingSocketAcCable",
    "acBoard",
    "trailingSocket",
    0.0065,
    3,
  );
  addAutomaticWallRoute("multiplus-to-ac-output-protection", "three-core-ac", "multiPlusAcOutputCable", "acBoardAcCable", "multiPlus", "acBoard", 0.0065, 3);

  const batteryTerminal = (device: PhysicalDevice, offsetX: number, offsetZ = 0): LayoutVector => [
    round(device.position[0] + offsetX),
    round(device.position[1] + device.size[1] / 2 + 0.037),
    round(device.position[2] + 0.055 + offsetZ),
  ];
  const batteryTerminals = {
    aNegative: batteryTerminal(devices.battery1, -0.17),
    aMidLeft: batteryTerminal(devices.battery1, 0.17),
    aMidRight: batteryTerminal(devices.battery2, -0.17),
    aPositive: batteryTerminal(devices.battery2, 0.17),
    bNegative: batteryTerminal(devices.battery3, -0.17),
    bMidLeft: batteryTerminal(devices.battery3, 0.17),
    bMidRight: batteryTerminal(devices.battery4, -0.17),
    bPositive: batteryTerminal(devices.battery4, 0.17),
    // Each balancer ring shares an electrical battery post with a heavy lug,
    // but leaves the stacked post on its inner side. Model that separate lug
    // exit 60 mm away from the heavy-cable centerline; otherwise reserving the
    // two real connector bodies makes either cable's one-way approach occupy
    // the other's only legal voxel corridor.
    aNegativeBalancer: batteryTerminal(devices.battery1, -0.11, 0.025),
    aMidLeftBalancer: batteryTerminal(devices.battery1, 0.11, 0.025),
    aPositiveBalancer: batteryTerminal(devices.battery2, 0.11, 0.025),
    bNegativeBalancer: batteryTerminal(devices.battery3, -0.11, 0.025),
    bMidLeftBalancer: batteryTerminal(devices.battery3, 0.11, 0.025),
    bPositiveBalancer: batteryTerminal(devices.battery4, 0.11, 0.025),
    // The ring-lug temperature sensor shares Battery 1's negative post but
    // leaves on the opposite side of the stacked heavy-cable lug. A distinct
    // nearby port lets both cables obey their straight approach without
    // pretending that their insulation occupies the same volume.
    aNegativeTemperature: batteryTerminal(devices.battery1, -0.184, -0.025),
  };
  Object.assign(ports, batteryTerminals);
  addRoute("battery-series-a", "dc-positive", [batteryTerminals.aMidLeft, batteryTerminals.aMidRight], 0.0065, 1, { routing: "fixed-site", sourceDeviceId: "battery1", sourcePortId: "aMidLeft", targetDeviceId: "battery2", targetPortId: "aMidRight" });
  addRoute("battery-series-b", "dc-positive", [batteryTerminals.bMidLeft, batteryTerminals.bMidRight], 0.0065, 1, { routing: "fixed-site", sourceDeviceId: "battery3", sourcePortId: "bMidLeft", targetDeviceId: "battery4", targetPortId: "bMidRight" });

  // Route the high-current battery harness before the smaller junction
  // branches. Later services can then choose a clean lane around these thick,
  // physically inflexible conductors instead of the battery runs being forced
  // through a finished bundle at the end of the solve.
  addCollisionAwareEndpointBundle([
    { id: "junction-to-battery-negative-a", kind: "dc-negative", sourcePortId: "junctionBatteryNegativeA", targetPortId: "aNegative", sourceDeviceId: "junction", targetDeviceId: "battery1", radiusM: 0.0065 },
    { id: "junction-to-battery-negative-b", kind: "dc-negative", sourcePortId: "junctionBatteryNegativeB", targetPortId: "bNegative", sourceDeviceId: "junction", targetDeviceId: "battery3", radiusM: 0.0065 },
    { id: "junction-to-class-t-a", kind: "dc-positive", sourcePortId: "junctionBatteryPositiveA", targetPortId: "classTAOutput", sourceDeviceId: "junction", targetDeviceId: "classTA", radiusM: 0.0065 },
    { id: "junction-to-class-t-b", kind: "dc-positive", sourcePortId: "junctionBatteryPositiveB", targetPortId: "classTBOutput", sourceDeviceId: "junction", targetDeviceId: "classTB", radiusM: 0.0065 },
    { id: "battery-a-to-class-t", kind: "dc-positive", sourcePortId: "aPositive", targetPortId: "classTAInput", sourceDeviceId: "battery2", targetDeviceId: "classTA", radiusM: 0.0065 },
    { id: "battery-b-to-class-t", kind: "dc-positive", sourcePortId: "bPositive", targetPortId: "classTBInput", sourceDeviceId: "battery4", targetDeviceId: "classTB", radiusM: 0.0065 },
    { id: "balancer-a-positive", kind: "dc-positive", sourcePortId: "balancerAPositive", targetPortId: "aPositiveBalancer", sourceDeviceId: "balancerA", targetDeviceId: "battery2", radiusM: 0.0017 },
    { id: "balancer-a-midpoint", kind: "data", sourcePortId: "balancerAMidpoint", targetPortId: "aMidLeftBalancer", sourceDeviceId: "balancerA", targetDeviceId: "battery1", radiusM: 0.0017 },
    { id: "balancer-a-negative", kind: "dc-negative", sourcePortId: "balancerANegative", targetPortId: "aNegativeBalancer", sourceDeviceId: "balancerA", targetDeviceId: "battery1", radiusM: 0.0017 },
    { id: "balancer-b-positive", kind: "dc-positive", sourcePortId: "balancerBPositive", targetPortId: "bPositiveBalancer", sourceDeviceId: "balancerB", targetDeviceId: "battery4", radiusM: 0.0017 },
    { id: "balancer-b-midpoint", kind: "data", sourcePortId: "balancerBMidpoint", targetPortId: "bMidLeftBalancer", sourceDeviceId: "balancerB", targetDeviceId: "battery3", radiusM: 0.0017 },
    { id: "balancer-b-negative", kind: "dc-negative", sourcePortId: "balancerBNegative", targetPortId: "bNegativeBalancer", sourceDeviceId: "balancerB", targetDeviceId: "battery3", radiusM: 0.0017 },
    { id: "multiplus-battery-temperature", kind: "data", sourcePortId: "multiPlusTemperatureSense", targetPortId: "aNegativeTemperature", sourceDeviceId: "multiPlus", targetDeviceId: "battery1", radiusM: 0.0015 },
  ]);

  // Route the two inverter trunks after the battery harness so their junction
  // breakouts can yield to the adjacent Class-T conductors.
  addAutomaticWallRoute("junction-to-multiplus-negative", "dc-negative", "junctionMultiPlusNegative", "multiPlusDcNegative", "junction", "multiPlus", 0.0065);
  addAutomaticWallRoute("junction-to-multiplus-positive", "dc-positive", "junctionMultiPlusPositive", "multiPlusDcPositive", "junction", "multiPlus", 0.0065);

  // Route the flexible generator lead after all four high-current DC leads so
  // its inexpensive terminal approach yields to the finished battery cables.
  addAutomaticWallRoute("generator-flex", "three-core-ac", "generatorAcCable", "multiPlusAcInputCable", "generator", "multiPlus", 0.0065, 3);

  // Junction exits are ordinary endpoint declarations. The automatic router
  // sees the flush enclosure as an obstacle, escapes through the modeled gland
  // and selects the shortest clear rectilinear path in front of the box.
  addAutomaticWallRoute("junction-to-mppt-positive", "dc-positive", "junctionMpptPositive", "smartSolarBatteryPositive", "junction", "smartSolar", 0.005);
  addAutomaticWallRoute("junction-to-mppt-negative", "dc-negative", "junctionMpptNegative", "smartSolarBatteryNegative", "junction", "smartSolar", 0.005);
  // Route the two right-most front-row light conductors before the immediately
  // adjacent rear-row inside-light pair and service pairs. Later routes then
  // see their depth transitions as occupied and choose a clear breakout lane
  // instead of crossing the unseen future cable beside the gland bank.
  addAutomaticWallRoute("junction-to-outdoor-flood-negative", "dc-negative", "junctionLoadNegative5", "outdoorFloodNegative", "junction", "outdoorFlood", 0.0018);
  addAutomaticWallRoute("junction-to-outdoor-flood-positive", "dc-positive", "junctionLoadPositive5", "outdoorFloodPositive", "junction", "outdoorFlood", 0.0018);
  addAutomaticWallRoute("junction-to-indoor-light-negative", "dc-negative", "junctionLoadNegative4", "indoorLightNegative", "junction", "indoorLight", 0.0018);
  addAutomaticWallRoute("junction-to-indoor-light-positive", "dc-positive", "junctionLoadPositive4", "indoorLightPositive", "junction", "indoorLight", 0.0018);
  addAutomaticWallRoute("junction-to-ekrano-data", "data", "junctionEkranData", "ekranVeDirect1", "junction", "ekran", 0.0017);
  // Route the right-most Ekrano gland first, then work left. Each later lead
  // can drop below the already-finished tail before turning right, so adjacent
  // gland conductors never weave through one another.
  addAutomaticWallRoute("junction-to-ekrano-negative", "dc-negative", "junctionEkranNegative", "ekranPowerNegative", "junction", "ekran", 0.0018);
  addAutomaticWallRoute("junction-to-ekrano-positive", "dc-positive", "junctionEkranPositive", "ekranPowerPositive", "junction", "ekran", 0.0018);
  addAutomaticWallRoute("junction-to-starlink-power-cable", "two-core-dc", "junctionStarlinkCable", "starlinkPowerCable", "junction", "starlink", 0.004, 2);
  addAutomaticWallRoute("junction-to-unifi-converter-positive", "dc-positive", "junctionLoadPositive2", "unifiConverterPositive", "junction", "unifiPower", 0.0018);
  addAutomaticWallRoute("junction-to-unifi-converter-negative", "dc-negative", "junctionLoadNegative2", "unifiConverterNegative", "junction", "unifiPower", 0.0018);
  addAutomaticWallRoute("junction-to-usb-positive", "dc-positive", "junctionLoadPositive3", "usbPositive", "junction", "usb", 0.0022);
  addAutomaticWallRoute("junction-to-usb-negative", "dc-negative", "junctionLoadNegative3", "usbNegative", "junction", "usb", 0.0022);
  addAutomaticWallRoute("unifi-converter-to-unifi-power", "data", "unifiConverterUsb", "unifiPower", "unifiPower", "unifi", 0.0017);
  addAutomaticWallRoute("unifi-to-ekrano-data", "data", "unifiLan", "ekranEthernet", "unifi", "ekran", 0.0017);
  addAutomaticWallRoute("smartsolar-to-ekrano-data", "data", "smartSolarData", "ekranVeDirect2", "smartSolar", "ekran", 0.0017);
  addAutomaticWallRoute("multiplus-to-ekrano-data", "data", "multiPlusData", "ekranVeBus", "multiPlus", "ekran", 0.0017);
  addAutomaticWallRoute("balancer-a-alarm", "data", "balancerAAlarm", "ekranDigitalInput1", "balancerA", "ekran", 0.0015, 2);
  addAutomaticWallRoute("balancer-b-alarm", "data", "balancerBAlarm", "ekranDigitalInput2", "balancerB", "ekran", 0.0015, 2);

  addAutomaticWallRoute(
    "starlink-to-unifi-data",
    "data",
    "starlinkEthernet",
    "unifiWan",
    "starlink",
    "unifi",
    0.0019,
  );

  // Protective earth is a visible terminal-to-terminal topology. The earth
  // electrode and array frame meet at the electrode, while every wall branch
  // lands on a dedicated stud of the main PE bar; no green run ends in space.
  addAutomaticWallRoute(
    "earth-electrode-to-main-bar",
    "earth",
    "earthElectrode",
    "earthBar1",
    "earthElectrode",
    "earthBar",
    0.003,
  );
  addRoute("earth-electrode-to-array-frame", "earth", [
    ports.earthElectrode,
    [0.72, 0.13, -2.58],
    [0.72, 0.13, -2.28],
    ports.arrayFrameEarth,
  ], 0.003, 1, { routing: "fixed-site", sourceDeviceId: "earthElectrode", sourcePortId: "earthElectrode", targetDeviceId: "solarPanels", targetPortId: "arrayFrameEarth" });
  addAutomaticWallRoute("earth-bar-to-pv-entry", "earth", "earthBar2", "pvEntryEarth", "earthBar", "pvEntry", 0.0024);
  addAutomaticWallRoute("earth-bar-to-smartsolar", "earth", "earthBar3", "smartSolarEarth", "earthBar", "smartSolar", 0.0024);
  addAutomaticWallRoute("earth-bar-to-multiplus", "earth", "earthBar4", "multiPlusChassisEarth", "earthBar", "multiPlus", 0.0024);
  addAutomaticWallRoute("earth-bar-to-ac-board", "earth", "earthBar5", "acBoardEarth", "earthBar", "acBoard", 0.0024);
  addAutomaticWallRoute("earth-bar-to-ekrano", "earth", "earthBar6", "ekranEarth", "earthBar", "ekran", 0.0022);

  // The cable centerline starts at the outer face of every cylindrical port.
  // Reassert the port-normal lead after all route construction so fixed site
  // runs and optimized routes obey exactly the same one-direction interface.
  Object.values(routes).forEach((route) => applyOrientedPortApproaches(route, ports));
  const portSpecifications = buildPhysicalPortSpecifications(routes, ports, devices);
  const portApproachIssues = physicalPortApproachIssues(routes, portSpecifications);

  const cableByKindM: Record<string, number> = {};
  Object.values(routes).forEach((route) => {
    cableByKindM[route.kind] = round((cableByKindM[route.kind] ?? 0) + route.lengthM);
  });
  const totalRenderedCableM = round(Object.values(routes).reduce((sum, route) => sum + route.lengthM, 0));
  const thickCableLengthM = round(Object.values(routes).reduce((sum, route) => (
    sum + (route.radiusM >= 0.005 ? route.lengthM : 0)
  ), 0));
  const weightedCableLengthM = round(Object.values(routes).reduce((sum, route) => (
    sum + route.lengthM * (route.radiusM >= 0.005 ? 2 : 1)
  ), 0));
  const wallDevices = Object.values(devices).filter((device) => device.mounting === "wall" && device.id !== "equipmentBoard");
  const wallLeft = Math.min(...wallDevices.map((device) => device.position[0] - device.size[0] / 2));
  const wallRight = Math.max(...wallDevices.map((device) => device.position[0] + device.size[0] / 2));
  const overlapIssues = wallOverlapIssues(devices).filter((issue) => !issue.includes("equipmentBoard"));
  const junctionBackRouteCount = Object.values(routes).filter((route) => (
    routeOccupiesJunctionBack(route, devices.junction, equipmentBoard.frontZ)
  )).length;
  const planarReversalIssues = Object.values(routes)
    .filter((route) => route.planarDirectionReversals > 0)
    .map((route) => `${route.id}:${route.planarDirectionReversals}`);
  const planarReversalCount = Object.values(routes).reduce(
    (sum, route) => sum + route.planarDirectionReversals,
    0,
  );
  const automaticRoutes = Object.values(routes).filter((route) => (
    route.routing === "automatic-rectilinear"
  ));
  const clearanceAuditedRoutes = Object.values(routes).filter((route) => (
    route.routing === "automatic-rectilinear" ||
    route.id === "battery-series-a" || route.id === "battery-series-b"
  ));
  const routeClearanceIssues = cableClearanceIssues(clearanceAuditedRoutes, 0.0015);
  const projectedConflictIssues = projectedCableConflictIssues(automaticRoutes, 0.0015);
  // Automatic centerlines below are endpoint declarations/provisional paths;
  // the browser replaces them with the separately published Voxel A* result.
  // Keep this specification-level audit scoped to geometry that is actually
  // rendered directly, otherwise a discarded provisional path can report a
  // false device-front failure after glands or devices move.
  const frontCrossingIssues = deviceFrontCrossingIssues(
    Object.values(routes).filter((route) => route.routing === "fixed-site"),
    devices,
  );
  const automaticRouteLengthM = round(automaticRoutes.reduce((sum, route) => sum + route.lengthM, 0));
  const automaticRouteExcessLengthM = round(automaticRoutes.reduce((sum, route) => {
    const first = route.points[0];
    const last = route.points.at(-1)!;
    const manhattan = Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1]) +
      Math.abs(last[2] - first[2]);
    return sum + Math.max(0, route.lengthM - manhattan);
  }, 0));
  const automaticRouteTurnCount = automaticRoutes.reduce(
    (sum, route) => sum + Math.max(0, route.points.length - 2),
    0,
  );
  const wallDistanceCostM2 = round(automaticRoutes.reduce((cost, route) => (
    cost + route.points.slice(1).reduce((routeCost, point, index) => {
      const start = route.points[index];
      const segmentLength = distance(start, point);
      const centerDistanceFromWall = (start[2] + point[2]) / 2 - equipmentBoard.frontZ;
      const cableSurfaceDistanceFromWall = Math.max(0, centerDistanceFromWall - route.radiusM);
      return routeCost + segmentLength * cableSurfaceDistanceFromWall;
    }, 0)
  ), 0));
  const junctionEgressTurnCount = automaticRoutes
    .filter((route) => route.sourceDeviceId === "junction" || route.targetDeviceId === "junction")
    .reduce((sum, route) => {
      const points = route.sourceDeviceId === "junction" ? route.points : [...route.points].reverse();
      let travelled = 0;
      let turns = 0;
      for (let index = 1; index < points.length - 1; index += 1) {
        travelled += distance(points[index - 1], points[index]);
        if (travelled <= 0.32) turns += 1;
      }
      return sum + turns;
    }, 0);
  const wallSpanPenaltyM = round((wallRight - wallLeft) * 0.35);
  const score = round(
    weightedCableLengthM + wallDistanceCostM2 * 20 + wallSpanPenaltyM + overlapIssues.length * 100 +
      routeClearanceIssues.length * 500 + frontCrossingIssues.length * 500 +
      portApproachIssues.length * 1000 +
      junctionBackRouteCount * 200 + projectedConflictIssues.length * 4 +
      automaticRouteExcessLengthM * 2 + automaticRouteTurnCount * 0.08,
  );

  return {
    revision: "layout-solver-r12-oriented-device-ports",
    coordinateSystem: "metres; +X right along wall, +Y up, +Z toward viewer/south",
    devices,
    ports,
    portSpecifications,
    routes,
    surfaces: {
      backWall,
      equipmentBoard,
      floorPlanes: [
        { center: [-1.55, -0.03, 0], size: [5.5, 0.04, 8] },
        { center: [4.1, -0.02, 0], size: [5.8, 0.06, 4.4] },
      ],
      sideWalls: [],
      roofPlanes: [],
    },
    metrics: {
      automaticRouteCount: Object.values(routes).filter((route) => route.routing === "automatic-rectilinear").length,
      totalRenderedCableM,
      weightedCableLengthM,
      thickCableLengthM,
      wallDistanceCostM2,
      cableByKindM,
      wallDeviceSpanM: round(wallRight - wallLeft),
      wallDeviceCount: wallDevices.length,
      wallAuthoredWaypointCount: 0,
      wallOverlapCount: overlapIssues.length,
      wallOverlapIssues: overlapIssues,
      cableClearanceIssueCount: routeClearanceIssues.length,
      cableClearanceIssues: routeClearanceIssues,
      projectedCableConflictCount: projectedConflictIssues.length,
      projectedCableConflictIssues: projectedConflictIssues,
      deviceFrontCrossingCount: frontCrossingIssues.length,
      deviceFrontCrossingIssues: frontCrossingIssues,
      junctionBackRouteCount,
      planarDirectionReversals: planarReversalCount,
      planarReversalIssues,
      portApproachIssueCount: portApproachIssues.length,
      portApproachIssues,
      automaticRouteLengthM,
      automaticRouteExcessLengthM,
      automaticRouteTurnCount,
      junctionEgressTurnCount,
      solverRouteCount: Object.keys(routes).length,
      wallSpanPenaltyM,
      score,
    },
    constraints: {
      batteryArrangement: "floor-2x2",
      batteryRouting: "collision-aware-terminal-derived-bundle",
      junctionBackClearance: "flush-no-cables",
      removableSurfaces: { sideWalls: true, roof: true },
      wallLayout: "stochastic-voxel-a-star-optimized-layout",
      wallRouting: "offline-voxel-a-star-only",
    },
  };
}
