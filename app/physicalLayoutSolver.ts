export type LayoutVector = [number, number, number];

export type PhysicalDevice = {
  id: string;
  position: LayoutVector;
  size: LayoutVector;
  mounting: "wall" | "floor" | "array" | "exterior" | "hanging";
};

export type PhysicalCableRoute = {
  id: string;
  kind: "dc-positive" | "dc-negative" | "data" | "earth" | "pv-positive" | "pv-negative" | "three-core-ac";
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
};

export type PhysicalLayoutSpecification = {
  revision: string;
  coordinateSystem: string;
  devices: Record<string, PhysicalDevice>;
  ports: Record<string, LayoutVector>;
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
    cableByKindM: Record<string, number>;
    wallDeviceSpanM: number;
    wallAuthoredWaypointCount: 0;
    wallDeviceCount: number;
    wallOverlapCount: number;
    wallOverlapIssues: string[];
    junctionBackRouteCount: number;
    planarDirectionReversals: number;
    planarReversalIssues: string[];
    solverRouteCount: number;
    wallSpanPenaltyM: number;
    score: number;
  };
  constraints: {
    batteryArrangement: "floor-2x2";
    junctionBackClearance: "flush-no-cables";
    removableSurfaces: { sideWalls: true; roof: true };
    wallLayout: "compact-review-layout";
    wallRouting: "shortest-rectilinear-visibility-graph";
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
  devices: Record<string, PhysicalDevice>;
  equipmentBoardFrontZ: number;
  radiusM: number;
  sourceDeviceId?: string;
  targetDeviceId?: string;
  minimumPlaneZ?: number;
  occupiedRoutes?: RoutedWallFootprint[];
  sourceTerminalClearanceM?: number;
  targetTerminalClearanceM?: number;
};

type RoutedWallFootprint = {
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

function segmentBlocked(start: PlanarPoint, end: PlanarPoint, obstacles: PlanarObstacle[]) {
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

function terminalEscape(port: LayoutVector, device: PhysicalDevice | undefined, clearance: number): PlanarPoint {
  if (!device) return [port[0], port[1]];
  const halfWidth = device.size[0] / 2;
  const halfHeight = device.size[1] / 2;
  const deltaX = port[0] - device.position[0];
  const deltaY = port[1] - device.position[1];
  if (Math.abs(deltaX) >= halfWidth + clearance || Math.abs(deltaY) >= halfHeight + clearance) {
    return [port[0], port[1]];
  }
  const xWeight = Math.abs(deltaX) / Math.max(halfWidth, ROUTING_EPSILON);
  const yWeight = Math.abs(deltaY) / Math.max(halfHeight, ROUTING_EPSILON);
  if (xWeight >= yWeight) {
    return [
      round(device.position[0] + (Math.sign(deltaX) || 1) * (halfWidth + clearance)),
      port[1],
    ];
  }
  return [
    port[0],
    round(device.position[1] + (Math.sign(deltaY) || 1) * (halfHeight + clearance)),
  ];
}

function uniqueSorted(values: number[]) {
  return [...new Set(values.map((value) => round(value, 5)))].sort((first, second) => first - second);
}

function shortestRectilinearPath(
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
      route.planeZ + route.radiusM + radiusM + 0.004,
    )),
  ]);
  return candidates.find((candidate) => conflicts.every((route) => (
    Math.abs(candidate - route.planeZ) >= route.radiusM + radiusM + 0.0035
  ))) ?? candidates.at(-1)!;
}

/**
 * Computes the shortest obstacle-free route on the equipment wall. The only
 * authored positions are device/port positions; every intermediate point is a
 * visibility-graph result or a perpendicular terminal escape.
 */
export function automaticWallRoute(
  start: LayoutVector,
  end: LayoutVector,
  options: AutomaticWallRouteOptions,
) {
  const clearance = Math.max(0.018, options.radiusM + 0.012);
  const sourceDevice = options.sourceDeviceId ? options.devices[options.sourceDeviceId] : undefined;
  const targetDevice = options.targetDeviceId ? options.devices[options.targetDeviceId] : undefined;
  const startEscape = terminalEscape(
    start,
    sourceDevice,
    options.sourceTerminalClearanceM ?? clearance,
  );
  const endEscape = terminalEscape(
    end,
    targetDevice,
    options.targetTerminalClearanceM ?? clearance,
  );
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
  const planarPath = shortestRectilinearPath(startEscape, endEscape, obstacles);
  const footprint: PlanarPoint[] = [
    [start[0], start[1]] as PlanarPoint,
    startEscape,
    ...planarPath.slice(1, -1),
    endEscape,
    [end[0], end[1]] as PlanarPoint,
  ];
  const basePlaneZ = round(options.equipmentBoardFrontZ + 0.035);
  const minimumPlaneZ = Math.max(basePlaneZ, options.minimumPlaneZ ?? basePlaneZ);
  const planeZ = chooseWallPlane(
    footprint,
    options.radiusM,
    minimumPlaneZ,
    options.occupiedRoutes ?? [],
  );
  const points: LayoutVector[] = [
    start,
    [start[0], start[1], planeZ],
    ...footprint.slice(1, -1).map(([x, y]) => [x, y, planeZ] as LayoutVector),
    [end[0], end[1], planeZ],
    end,
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

export function axisDirectionReversals(points: LayoutVector[], axis: 0 | 1 | 2) {
  const directions = points.slice(1).flatMap((point, index) => {
    const delta = point[axis] - points[index][axis];
    if (Math.abs(delta) < 0.0001) return [];
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

function frontPort(device: PhysicalDevice, offsetX: number, offsetY: number, protrusion = 0.006): LayoutVector {
  return [
    round(device.position[0] + offsetX),
    round(device.position[1] + offsetY),
    round(device.position[2] + device.size[2] / 2 + protrusion),
  ];
}

function busbarStud(device: PhysicalDevice, index: number, studCount: number): LayoutVector {
  const spacing = 0.106 / Math.max(1, studCount - 1);
  return [
    round(device.position[0] - 0.053 + spacing * index),
    device.position[1],
    round(device.position[2] + 0.035),
  ];
}

function wallOverlapIssues(devices: Record<string, PhysicalDevice>) {
  const wallDevices = Object.values(devices).filter((device) => device.mounting === "wall");
  const issues: string[] = [];
  const clearance = 0.025;
  for (let firstIndex = 0; firstIndex < wallDevices.length; firstIndex += 1) {
    const first = wallDevices[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < wallDevices.length; secondIndex += 1) {
      const second = wallDevices[secondIndex];
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

export function solvePhysicalLayout(input: PhysicalLayoutInput = {}): PhysicalLayoutSpecification {
  const backWall = { center: [4.1, 1.5, -2.2] as LayoutVector, size: [5.8, 3, 0.08] as LayoutVector };
  const equipmentBoard = {
    center: [2.95, 1.5, -2.13] as LayoutVector,
    size: [3.4, 2.5, 0.018] as LayoutVector,
    frontZ: -2.121,
  };
  const z = (depth: number) => wallCenterZ(equipmentBoard.frontZ, depth);

  const devices = withOverrides({
    equipmentBoard: createDevice("equipmentBoard", equipmentBoard.center, equipmentBoard.size, "wall"),
    generatorInlet: createDevice("generatorInlet", [1.42, 0.42, z(0.1)], [0.14, 0.18, 0.1], "wall"),
    pvEntry: createDevice("pvEntry", [1.72, 0.5, z(0.12)], [0.25, 0.3, 0.12], "wall"),
    smartSolar: createDevice("smartSolar", [2.15, 0.55, z(0.103)], [0.295, 0.216, 0.103], "wall"),
    multiPlus: createDevice("multiPlus", [2.08, 1.92, z(0.141)], [0.268, 0.499, 0.141], "wall"),
    acBoard: createDevice("acBoard", [2.38, 1.75, z(0.1)], [0.22, 0.18, 0.1], "wall"),
    junction: createDevice("junction", [3.45, 1.68, z(0.15)], [0.35, 0.247, 0.15], "wall"),
    ekran: createDevice("ekran", [3.45, 2.06, z(0.0298)], [0.187, 0.124, 0.0298], "wall"),
    unifi: createDevice("unifi", [3.68, 2.06, z(0.03)], [0.098, 0.098, 0.03], "wall"),
    usb: createDevice("usb", [3.82, 2.06, z(0.04)], [0.08, 0.04, 0.04], "wall"),
    orion: createDevice("orion", [3.77, 1.68, z(0.08)], [0.186, 0.13, 0.08], "wall"),
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
    light1: createDevice("light1", [2.25, 2.92, -0.75], [0.52, 0.035, 0.075], "hanging"),
    light2: createDevice("light2", [4.1, 2.92, -0.75], [0.52, 0.035, 0.075], "hanging"),
    light3: createDevice("light3", [5.95, 2.92, -0.75], [0.52, 0.035, 0.075], "hanging"),
    light4: createDevice("light4", [2.25, 2.92, 0.8], [0.52, 0.035, 0.075], "hanging"),
    light5: createDevice("light5", [4.1, 2.92, 0.8], [0.52, 0.035, 0.075], "hanging"),
    light6: createDevice("light6", [5.95, 2.92, 0.8], [0.52, 0.035, 0.075], "hanging"),
  }, input.deviceOverrides);

  // The short tool lead and socket are accessories of the movable AC output
  // board. Their pose is therefore derived from that device rather than stored
  // as another independent absolute layout coordinate.
  if (!input.deviceOverrides?.trailingSocket?.position) {
    devices.trailingSocket = {
      ...devices.trailingSocket,
      position: [
        round(devices.acBoard.position[0] + 0.16),
        round(devices.acBoard.position[1] - 0.27),
        round(devices.acBoard.position[2] + 0.127),
      ],
    };
  }

  const ports: Record<string, LayoutVector> = {
    pvEntryStringAPositive: frontPort(devices.pvEntry, -0.09, -0.156),
    pvEntryStringANegative: frontPort(devices.pvEntry, -0.045, -0.156),
    pvEntryStringBPositive: frontPort(devices.pvEntry, 0, -0.156),
    pvEntryStringBNegative: frontPort(devices.pvEntry, 0.045, -0.156),
    pvEntryMpptPositive: frontPort(devices.pvEntry, 0.06, -0.08),
    pvEntryMpptNegative: frontPort(devices.pvEntry, 0.1, -0.08),
    smartSolarPvPositive: frontPort(devices.smartSolar, -0.1, -0.114),
    smartSolarPvNegative: frontPort(devices.smartSolar, -0.065, -0.114),
    smartSolarBatteryPositive: frontPort(devices.smartSolar, -0.015, -0.114),
    smartSolarBatteryNegative: frontPort(devices.smartSolar, 0.03, -0.114),
    multiPlusDcPositive: frontPort(devices.multiPlus, -0.115, -0.258),
    multiPlusDcNegative: frontPort(devices.multiPlus, -0.083, -0.258),
    generatorInletAcCable: frontPort(devices.generatorInlet, 0.076, 0),
    multiPlusAcInputCable: frontPort(devices.multiPlus, -0.019, -0.258),
    multiPlusAcOutputCable: frontPort(devices.multiPlus, 0.077, -0.258),
    acBoardAcCable: frontPort(devices.acBoard, -0.045, -0.096),
    acBoardToolCable: frontPort(devices.acBoard, 0.055, -0.096),
    trailingSocketAcCable: [
      round(devices.trailingSocket.position[0] - 0.03),
      round(devices.trailingSocket.position[1] + devices.trailingSocket.size[1] / 2 + 0.006),
      round(devices.trailingSocket.position[2] + devices.trailingSocket.size[2] / 2),
    ],
    generatorAcCable: [
      round(devices.generator.position[0] + devices.generator.size[0] * 0.4),
      round(devices.generator.position[1] - devices.generator.size[1] * 0.18),
      devices.generator.position[2],
    ],
    orionInputPositive: frontPort(devices.orion, -0.06, -0.07),
    orionInputNegative: frontPort(devices.orion, -0.02, -0.07),
    orionOutputPositive: frontPort(devices.orion, 0.02, -0.07),
    orionOutputNegative: frontPort(devices.orion, 0.06, -0.07),
    ekranPowerPositive: frontPort(devices.ekran, -0.07, -0.07),
    ekranPowerNegative: frontPort(devices.ekran, -0.042, -0.07),
    ekranVeDirect: frontPort(devices.ekran, -0.014, -0.07),
    ekranVeCan: frontPort(devices.ekran, 0.014, -0.07),
    ekranVeBus: frontPort(devices.ekran, 0.042, -0.07),
    ekranEthernet: frontPort(devices.ekran, 0.07, -0.07),
    unifiPower: frontPort(devices.unifi, -0.035, -0.06),
    unifiWan: frontPort(devices.unifi, 0.005, -0.06),
    unifiLan: frontPort(devices.unifi, 0.04, -0.06),
    usbPositive: frontPort(devices.usb, -0.02, -0.022),
    usbNegative: frontPort(devices.usb, 0.02, -0.022),
    usbReservedUsbC: frontPort(devices.usb, -0.022, 0),
    starlinkEthernet: [
      round(devices.starlink.position[0] + 0.04),
      round(devices.starlink.position[1] - 0.05),
      devices.starlink.position[2],
    ],
    starlinkPowerPositive: [
      round(devices.starlink.position[0] - 0.04),
      round(devices.starlink.position[1] - 0.05),
      devices.starlink.position[2],
    ],
    starlinkPowerNegative: [
      devices.starlink.position[0],
      round(devices.starlink.position[1] - 0.05),
      devices.starlink.position[2],
    ],
    lightingFeedPositive: [
      round(devices.light6.position[0] - 0.37),
      round(devices.light6.position[1] - 0.06),
      round(devices.light6.position[2] + 0.14),
    ],
    lightingFeedNegative: [
      round(devices.light6.position[0] - 0.34),
      round(devices.light6.position[1] - 0.09),
      round(devices.light6.position[2] + 0.18),
    ],
    earthElectrode: [0.72, 0.1, -2.58],
    arrayFrameEarth: [-1.67, 0.13, -2.28],
    pvEntryEarth: frontPort(devices.pvEntry, 0.08, -0.156),
    smartSolarEarth: frontPort(devices.smartSolar, 0.1, -0.114),
    smartSolarData: frontPort(
      devices.smartSolar,
      devices.smartSolar.size[0] * 0.27,
      devices.smartSolar.size[1] * 0.35,
    ),
    multiPlusChassisEarth: frontPort(devices.multiPlus, 0.12, -0.19),
    multiPlusData: frontPort(devices.multiPlus, devices.multiPlus.size[0] * 0.34, 0),
    acBoardEarth: frontPort(devices.acBoard, 0.05, -0.096),
    ekranEarth: frontPort(devices.ekran, 0.101, 0),
    classTAInput: frontPort(devices.classTA, -0.055, 0),
    classTAOutput: frontPort(devices.classTA, 0.055, 0),
    classTBInput: frontPort(devices.classTB, -0.055, 0),
    classTBOutput: frontPort(devices.classTB, 0.055, 0),
  };
  for (let index = 0; index < 7; index += 1) {
    ports[`earthBar${index + 1}`] = busbarStud(devices.earthBar, index, 7);
  }

  const junctionRight = round(devices.junction.position[0] + devices.junction.size[0] / 2 + 0.017);
  const junctionTop = round(devices.junction.position[1] + devices.junction.size[1] / 2 + 0.032);
  const junctionBottom = round(devices.junction.position[1] - devices.junction.size[1] / 2 - 0.0145);
  const junctionPortZ = devices.junction.position[2];
  const rightJunctionPorts: Record<string, number> = {
    junctionMpptPositive: 0.092,
    junctionMpptNegative: 0.066,
    junctionMultiPlusPositive: 0.036,
    junctionMultiPlusNegative: 0.002,
    junctionOrionInputPositive: -0.028,
    junctionOrionInputNegative: -0.053,
    junctionOrionOutputPositive: -0.077,
    junctionOrionOutputNegative: -0.098,
  };
  Object.entries(rightJunctionPorts).forEach(([id, yOffset]) => {
    ports[id] = [junctionRight, round(devices.junction.position[1] + yOffset), junctionPortZ];
  });
  ["junctionEkranPositive", "junctionEkranNegative", "junctionEkranData"]
    .forEach((id, index) => {
      ports[id] = [
        round(devices.junction.position[0] + [-0.04, 0, 0.04][index]),
        junctionTop,
        junctionPortZ,
      ];
    });
  const bottomOffsets = {
    junctionBatteryPositiveA: -0.14,
    junctionBatteryPositiveB: -0.108,
    junctionBatteryNegativeA: -0.076,
    junctionBatteryNegativeB: -0.044,
    junctionLoadPositive1: -0.012,
    junctionLoadNegative1: 0.01,
    junctionLoadPositive2: 0.032,
    junctionLoadNegative2: 0.054,
    junctionLoadPositive3: 0.076,
    junctionLoadNegative3: 0.098,
  };
  Object.entries(bottomOffsets).forEach(([id, xOffset]) => {
    ports[id] = [round(devices.junction.position[0] + xOffset), junctionBottom, junctionPortZ];
  });
  [devices.balancerA, devices.balancerB].forEach((balancer, balancerIndex) => {
    ["Positive", "Midpoint", "Negative"].forEach((terminal, terminalIndex) => {
      ports[`balancer${balancerIndex === 0 ? "A" : "B"}${terminal}`] = frontPort(
        balancer,
        [-0.04, 0, 0.04][terminalIndex],
        -balancer.size[1] / 2 - 0.006,
      );
    });
  });

  const wallZ = -2.086;
  const routes: Record<string, PhysicalCableRoute> = {};
  const addRoute = (
    id: string,
    kind: PhysicalCableRoute["kind"],
    points: LayoutVector[],
    radiusM: number,
    conductors = 1,
  ) => { routes[id] = createRoute(id, kind, points, radiusM, conductors); };
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
    const generated = automaticWallRoute(source, target, {
      additionalObstacles,
      devices,
      equipmentBoardFrontZ: equipmentBoard.frontZ,
      minimumPlaneZ: sourceIsJunction || targetIsJunction ? junctionFront : undefined,
      occupiedRoutes: occupiedWallRoutes,
      radiusM,
      sourceTerminalClearanceM: sourceIsJunction ? 0.05 : undefined,
      sourceDeviceId,
      targetTerminalClearanceM: targetIsJunction ? 0.05 : undefined,
      targetDeviceId,
    });
    occupiedWallRoutes.push({
      planeZ: generated.planeZ,
      points: generated.footprint,
      radiusM,
    });
    routes[id] = createRoute(id, kind, generated.points, radiusM, conductors, {
      routing: "automatic-rectilinear",
      sourceDeviceId,
      sourcePortId,
      targetDeviceId,
      targetPortId,
    });
  };
  const addAutomaticEndpointRoute = (
    id: string,
    kind: PhysicalCableRoute["kind"],
    sourcePortId: string,
    targetPortId: string,
    sourceDeviceId: string,
    targetDeviceId: string,
    radiusM: number,
    conductors = 1,
  ) => {
    routes[id] = createRoute(id, kind, [ports[sourcePortId], ports[targetPortId]], radiusM, conductors, {
      routing: "automatic-rectilinear",
      sourceDeviceId,
      sourcePortId,
      targetDeviceId,
      targetPortId,
    });
  };

  const stringAHomePositive: LayoutVector = [0.69, 0.68, -1.62];
  const stringAHomeNegative: LayoutVector = [0.69, 0.58, -1.62];
  const stringBHomePositive: LayoutVector = [0.72, 0.72, -1.55];
  const stringBHomeNegative: LayoutVector = [0.69, 0.52, -1.62];
  addRoute("pv-string-a-positive", "pv-positive", [[0.559, 0.925, -1.18], [0.69, 0.925, -1.18], stringAHomePositive], 0.0055);
  addRoute("pv-string-a-negative", "pv-negative", [[-1.659, 0.205, -1.18], [-1.659, 0.14, -1.55], [0.66, 0.14, -1.55], stringAHomeNegative], 0.0055);
  addRoute("pv-string-b-positive", "pv-positive", [[0.559, 0.925, 1.18], [0.72, 0.925, 1.18], stringBHomePositive], 0.0055);
  addRoute("pv-string-b-negative", "pv-negative", [[-1.659, 0.205, 1.18], [-1.76, 0.12, 1.18], [-1.76, 0.12, -1.5], [0.63, 0.12, -1.5], stringBHomeNegative], 0.0055);

  // Each string keeps its own complete red/black 4 mm² home run. All four
  // conductors enter one indoor enclosure, where they are combined behind the
  // DC disconnect and Type 2 SPD. There is no separate array-side box.
  addRoute("pv-home-run-a-positive", "pv-positive", [stringAHomePositive, [1.06, 0.68, -1.62], [1.06, 0.18, -1.86], [1.28, 0.18, wallZ], [1.28, 0.36, wallZ], [ports.pvEntryStringAPositive[0], 0.36, wallZ], ports.pvEntryStringAPositive], 0.005);
  addRoute("pv-home-run-a-negative", "pv-negative", [stringAHomeNegative, [1.09, 0.58, -1.62], [1.09, 0.21, -1.84], [1.31, 0.21, wallZ + 0.016], [1.31, 0.33, wallZ + 0.016], [ports.pvEntryStringANegative[0], 0.33, wallZ + 0.016], ports.pvEntryStringANegative], 0.005);
  addRoute("pv-home-run-b-positive", "pv-positive", [stringBHomePositive, [1.12, 0.72, -1.55], [1.12, 0.24, -1.82], [1.34, 0.24, wallZ + 0.032], [1.34, 0.3, wallZ + 0.032], [ports.pvEntryStringBPositive[0], 0.3, wallZ + 0.032], ports.pvEntryStringBPositive], 0.005);
  addRoute("pv-home-run-b-negative", "pv-negative", [stringBHomeNegative, [1.15, 0.52, -1.62], [1.15, 0.27, -1.8], [1.37, 0.27, wallZ + 0.048], [ports.pvEntryStringBNegative[0], 0.27, wallZ + 0.048], ports.pvEntryStringBNegative], 0.005);

  addAutomaticWallRoute("pv-entry-to-mppt-positive", "pv-positive", "pvEntryMpptPositive", "smartSolarPvPositive", "pvEntry", "smartSolar", 0.0055);
  addAutomaticWallRoute("pv-entry-to-mppt-negative", "pv-negative", "pvEntryMpptNegative", "smartSolarPvNegative", "pvEntry", "smartSolar", 0.0055);

  addAutomaticEndpointRoute("generator-flex", "three-core-ac", "generatorAcCable", "generatorInletAcCable", "generator", "generatorInlet", 0.011, 3);
  addAutomaticEndpointRoute("trailing-tool-flex", "three-core-ac", "acBoardToolCable", "trailingSocketAcCable", "acBoard", "trailingSocket", 0.011, 3);
  addAutomaticWallRoute("generator-inlet-to-multiplus-ac", "three-core-ac", "generatorInletAcCable", "multiPlusAcInputCable", "generatorInlet", "multiPlus", 0.011, 3);
  addAutomaticWallRoute("multiplus-to-ac-output-protection", "three-core-ac", "multiPlusAcOutputCable", "acBoardAcCable", "multiPlus", "acBoard", 0.011, 3);

  const batteryTerminal = (device: PhysicalDevice, offsetX: number): LayoutVector => [
    round(device.position[0] + offsetX),
    round(device.position[1] + device.size[1] / 2 + 0.037),
    round(device.position[2] + 0.055),
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
  };
  Object.assign(ports, batteryTerminals);
  addRoute("battery-series-a", "dc-positive", [batteryTerminals.aMidLeft, batteryTerminals.aMidRight], 0.009);
  addRoute("battery-series-b", "dc-positive", [batteryTerminals.bMidLeft, batteryTerminals.bMidRight], 0.009);
  addAutomaticEndpointRoute("battery-a-to-class-t", "dc-positive", "aPositive", "classTAInput", "battery2", "classTA", 0.009);
  addAutomaticEndpointRoute("battery-b-to-class-t", "dc-positive", "bPositive", "classTBInput", "battery4", "classTB", 0.009);
  addAutomaticEndpointRoute("junction-to-battery-negative-a", "dc-negative", "junctionBatteryNegativeA", "aNegative", "junction", "battery1", 0.0085);
  addAutomaticEndpointRoute("junction-to-battery-negative-b", "dc-negative", "junctionBatteryNegativeB", "bNegative", "junction", "battery3", 0.0085);
  addAutomaticEndpointRoute("balancer-a-positive", "dc-positive", "balancerAPositive", "aPositive", "balancerA", "battery2", 0.0035);
  addAutomaticEndpointRoute("balancer-a-midpoint", "data", "balancerAMidpoint", "aMidLeft", "balancerA", "battery1", 0.0035);
  addAutomaticEndpointRoute("balancer-a-negative", "dc-negative", "balancerANegative", "aNegative", "balancerA", "battery1", 0.0035);
  addAutomaticEndpointRoute("balancer-b-positive", "dc-positive", "balancerBPositive", "bPositive", "balancerB", "battery4", 0.0035);
  addAutomaticEndpointRoute("balancer-b-midpoint", "data", "balancerBMidpoint", "bMidLeft", "balancerB", "battery3", 0.0035);
  addAutomaticEndpointRoute("balancer-b-negative", "dc-negative", "balancerBNegative", "bNegative", "balancerB", "battery3", 0.0035);
  addAutomaticWallRoute("junction-to-class-t-a", "dc-positive", "junctionBatteryPositiveA", "classTAOutput", "junction", "classTA", 0.0085);
  addAutomaticWallRoute("junction-to-class-t-b", "dc-positive", "junctionBatteryPositiveB", "classTBOutput", "junction", "classTB", 0.0085);

  // Junction exits are ordinary endpoint declarations. The automatic router
  // sees the flush enclosure as an obstacle, escapes through the modeled gland
  // and selects the shortest clear rectilinear path in front of the box.
  addAutomaticWallRoute("junction-to-mppt-positive", "dc-positive", "junctionMpptPositive", "smartSolarBatteryPositive", "junction", "smartSolar", 0.0065);
  addAutomaticWallRoute("junction-to-mppt-negative", "dc-negative", "junctionMpptNegative", "smartSolarBatteryNegative", "junction", "smartSolar", 0.0065);
  addAutomaticWallRoute("junction-to-multiplus-positive", "dc-positive", "junctionMultiPlusPositive", "multiPlusDcPositive", "junction", "multiPlus", 0.0085);
  addAutomaticWallRoute("junction-to-multiplus-negative", "dc-negative", "junctionMultiPlusNegative", "multiPlusDcNegative", "junction", "multiPlus", 0.0085);
  addAutomaticWallRoute("junction-to-orion-input-positive", "dc-positive", "junctionOrionInputPositive", "orionInputPositive", "junction", "orion", 0.0055);
  addAutomaticWallRoute("junction-to-orion-input-negative", "dc-negative", "junctionOrionInputNegative", "orionInputNegative", "junction", "orion", 0.0055);
  addAutomaticWallRoute("junction-to-orion-output-positive", "dc-positive", "junctionOrionOutputPositive", "orionOutputPositive", "junction", "orion", 0.0048);
  addAutomaticWallRoute("junction-to-orion-output-negative", "dc-negative", "junctionOrionOutputNegative", "orionOutputNegative", "junction", "orion", 0.0048);
  addAutomaticWallRoute("junction-to-ekrano-positive", "dc-positive", "junctionEkranPositive", "ekranPowerPositive", "junction", "ekran", 0.0038);
  addAutomaticWallRoute("junction-to-ekrano-negative", "dc-negative", "junctionEkranNegative", "ekranPowerNegative", "junction", "ekran", 0.0038);
  addAutomaticWallRoute("junction-to-ekrano-data", "data", "junctionEkranData", "ekranVeDirect", "junction", "ekran", 0.0032);
  addAutomaticWallRoute("junction-to-usb-positive", "dc-positive", "junctionLoadPositive2", "usbPositive", "junction", "usb", 0.0042);
  addAutomaticWallRoute("junction-to-usb-negative", "dc-negative", "junctionLoadNegative2", "usbNegative", "junction", "usb", 0.0042);
  addAutomaticWallRoute("junction-to-starlink-positive", "dc-positive", "junctionLoadPositive1", "starlinkPowerPositive", "junction", "starlink", 0.0045);
  addAutomaticWallRoute("junction-to-starlink-negative", "dc-negative", "junctionLoadNegative1", "starlinkPowerNegative", "junction", "starlink", 0.0045);
  addAutomaticWallRoute("junction-to-lighting-positive", "dc-positive", "junctionLoadPositive3", "lightingFeedPositive", "junction", "light6", 0.0045);
  addAutomaticWallRoute("junction-to-lighting-negative", "dc-negative", "junctionLoadNegative3", "lightingFeedNegative", "junction", "light6", 0.0045);
  addAutomaticWallRoute("usb-to-unifi-power", "data", "usbReservedUsbC", "unifiPower", "usb", "unifi", 0.0035);
  addAutomaticWallRoute("unifi-to-ekrano-data", "data", "unifiLan", "ekranEthernet", "unifi", "ekran", 0.0032);
  addAutomaticWallRoute("smartsolar-to-ekrano-data", "data", "smartSolarData", "ekranVeCan", "smartSolar", "ekran", 0.0032);
  addAutomaticWallRoute("multiplus-to-ekrano-data", "data", "multiPlusData", "ekranVeBus", "multiPlus", "ekran", 0.0032);

  addAutomaticWallRoute(
    "starlink-to-unifi-data",
    "data",
    "starlinkEthernet",
    "unifiWan",
    "starlink",
    "unifi",
    0.0038,
  );

  // Protective earth is a visible terminal-to-terminal topology. The earth
  // electrode and array frame meet at the electrode, while every wall branch
  // lands on a dedicated stud of the main PE bar; no green run ends in space.
  addRoute("earth-electrode-to-main-bar", "earth", [
    ports.earthElectrode,
    [1.08, 0.1, -2.58],
    [1.08, 0.1, -2.055],
    [1.18, 0.1, -2.055],
    [1.18, devices.earthBar.position[1], -2.055],
    [ports.earthBar1[0], devices.earthBar.position[1], -2.055],
    ports.earthBar1,
  ], 0.0055);
  addRoute("earth-electrode-to-array-frame", "earth", [
    ports.earthElectrode,
    [0.58, 0.1, -2.58],
    [0.58, 0.13, -2.28],
    ports.arrayFrameEarth,
  ], 0.0055);
  addAutomaticWallRoute("earth-bar-to-pv-entry", "earth", "earthBar2", "pvEntryEarth", "earthBar", "pvEntry", 0.0045);
  addAutomaticWallRoute("earth-bar-to-smartsolar", "earth", "earthBar3", "smartSolarEarth", "earthBar", "smartSolar", 0.0045);
  addAutomaticWallRoute("earth-bar-to-multiplus", "earth", "earthBar4", "multiPlusChassisEarth", "earthBar", "multiPlus", 0.0045);
  addAutomaticWallRoute("earth-bar-to-ac-board", "earth", "earthBar5", "acBoardEarth", "earthBar", "acBoard", 0.0045);
  addAutomaticWallRoute("earth-bar-to-ekrano", "earth", "earthBar6", "ekranEarth", "earthBar", "ekran", 0.0042);

  const cableByKindM: Record<string, number> = {};
  Object.values(routes).forEach((route) => {
    cableByKindM[route.kind] = round((cableByKindM[route.kind] ?? 0) + route.lengthM);
  });
  const totalRenderedCableM = round(Object.values(routes).reduce((sum, route) => sum + route.lengthM, 0));
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
  const wallSpanPenaltyM = round((wallRight - wallLeft) * 0.35);
  const score = round(
    totalRenderedCableM + wallSpanPenaltyM + overlapIssues.length * 100 + junctionBackRouteCount * 200,
  );

  return {
    revision: "layout-solver-r5-shortest-rectilinear",
    coordinateSystem: "metres; +X right along wall, +Y up, +Z toward viewer/south",
    devices,
    ports,
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
      cableByKindM,
      wallDeviceSpanM: round(wallRight - wallLeft),
      wallDeviceCount: wallDevices.length,
      wallAuthoredWaypointCount: 0,
      wallOverlapCount: overlapIssues.length,
      wallOverlapIssues: overlapIssues,
      junctionBackRouteCount,
      planarDirectionReversals: planarReversalCount,
      planarReversalIssues,
      solverRouteCount: Object.keys(routes).length,
      wallSpanPenaltyM,
      score,
    },
    constraints: {
      batteryArrangement: "floor-2x2",
      junctionBackClearance: "flush-no-cables",
      removableSurfaces: { sideWalls: true, roof: true },
      wallLayout: "compact-review-layout",
      wallRouting: "shortest-rectilinear-visibility-graph",
    },
  };
}

export const physicalLayout = solvePhysicalLayout();
