import {
  cableClearanceIssues,
  deviceFrontCrossingIssues,
  routeLength,
  type LayoutVector,
  type PhysicalCableRoute,
  type PhysicalLayoutSpecification,
} from "./physicalLayoutSolver.ts";
import { sampleRoundedCableCenterline } from "./cableRouting.ts";

type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type VoxelRouterOptions = {
  cableClearanceM?: number;
  cellSizeM?: number;
  depthMovementPenalty?: number;
  depthPositionPenalty?: number;
  heuristicWeight?: number;
  maximumForwardM?: number;
  maximumPasses?: number;
  portApproachM?: number;
  turnPenaltyM?: number;
};

export type VoxelRouteResult = {
  id: string;
  lengthM: number;
  points: LayoutVector[];
  turns: number;
};

export type VoxelRoutingResult = {
  algorithm: "sequential-adaptive-voxel-a-star";
  cellSizeM: number;
  clearanceIssues: string[];
  failedRouteIds: string[];
  metrics: {
    cableClearanceIssueCount: number;
    deviceFrontViolationCount: number;
    maximumForwardM: number;
    portApproachViolationCount: number;
    roundedDeviceFrontViolationCount: number;
    routeCount: number;
    totalLengthM: number;
    totalTurns: number;
    wallDistanceCostM2: number;
  };
  options: Required<VoxelRouterOptions>;
  passFailures: string[][];
  routeSolveMs: Record<string, number>;
  routingPasses: number;
  routes: Record<string, VoxelRouteResult>;
  solveMs: number;
};

type Grid = {
  cellSizeM: number;
  max: LayoutVector;
  min: LayoutVector;
  nx: number;
  ny: number;
  nz: number;
  xs: number[];
  ys: number[];
  zs: number[];
};

type QueueNode = {
  cost: number;
  index: number;
  state: number;
};

const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const EPSILON = 0.00001;

const round = (value: number, places = 4) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

class MinHeap {
  private costs: number[] = [];
  private positions: Int32Array;
  private states: number[] = [];

  poppedCost = 0;
  poppedIndex = 0;

  constructor(stateCount: number) {
    this.positions = new Int32Array(stateCount);
    this.positions.fill(-1);
  }

  get size() { return this.costs.length; }

  push(value: QueueNode) {
    const existing = this.positions[value.state];
    if (existing >= 0) {
      if (this.costs[existing] <= value.cost) return;
      this.costs[existing] = value.cost;
      let index = existing;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (this.costs[parent] <= value.cost) break;
        this.costs[index] = this.costs[parent];
        this.states[index] = this.states[parent];
        this.positions[this.states[index]] = index;
        index = parent;
      }
      this.costs[index] = value.cost;
      this.states[index] = value.state;
      this.positions[value.state] = index;
      return;
    }
    let index = this.costs.length;
    this.costs.push(value.cost);
    this.states.push(value.state);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.costs[parent] <= value.cost) break;
      this.costs[index] = this.costs[parent];
      this.states[index] = this.states[parent];
      this.positions[this.states[index]] = index;
      index = parent;
    }
    this.costs[index] = value.cost;
    this.states[index] = value.state;
    this.positions[value.state] = index;
  }

  pop() {
    if (this.costs.length === 0) return undefined;
    this.poppedCost = this.costs[0];
    this.poppedIndex = Math.floor(this.states[0] / 7);
    const poppedState = this.states[0];
    const lastCost = this.costs.pop()!;
    const lastState = this.states.pop()!;
    this.positions[poppedState] = -1;
    if (this.costs.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.costs.length && this.costs[left] < (best === index ? lastCost : this.costs[best])) best = left;
        if (right < this.costs.length && this.costs[right] < (best === index ? lastCost : this.costs[best])) best = right;
        if (best === index) break;
        this.costs[index] = this.costs[best];
        this.states[index] = this.states[best];
        this.positions[this.states[index]] = index;
        index = best;
      }
      this.costs[index] = lastCost;
      this.states[index] = lastState;
      this.positions[lastState] = index;
    }
    return poppedState;
  }
}

function voxelRouteRequests(layout: PhysicalLayoutSpecification) {
  return Object.values(layout.routes).filter((route) => {
    if (route.routing !== "automatic-rectilinear" || !route.sourceDeviceId || !route.targetDeviceId) return false;
    const source = layout.devices[route.sourceDeviceId];
    const target = layout.devices[route.targetDeviceId];
    const supportedMountings = new Set(["wall", "floor"]);
    const isArrayHomeRun = route.id.startsWith("pv-home-run-");
    return Boolean(
      source && target && route.sourcePortId && route.targetPortId &&
      layout.portSpecifications[route.sourcePortId] && layout.portSpecifications[route.targetPortId] &&
      (isArrayHomeRun || supportedMountings.has(source.mounting) && supportedMountings.has(target.mounting)),
    );
  });
}

function portApproachPoint(
  route: PhysicalCableRoute,
  endpoint: "source" | "target",
  layout: PhysicalLayoutSpecification,
  options: Required<VoxelRouterOptions>,
): LayoutVector {
  const portId = endpoint === "source" ? route.sourcePortId : route.targetPortId;
  const port = layout.portSpecifications[portId!];
  const distance = Math.max(
    options.portApproachM,
    port.lengthM,
    route.radiusM * 2 + options.cableClearanceM,
  );
  return port.position.map((value, axis) => round(value + port.direction[axis] * distance)) as LayoutVector;
}

function coordinateAxis(minimum: number, maximum: number, step: number, extras: number[]) {
  const values = new Set<number>([round(minimum), round(maximum)]);
  for (let value = minimum; value <= maximum + EPSILON; value += step) {
    values.add(round(Math.min(maximum, value)));
  }
  extras.forEach((value) => {
    if (value >= minimum - EPSILON && value <= maximum + EPSILON) values.add(round(value));
  });
  return [...values].sort((first, second) => first - second);
}

function createGrid(
  layout: PhysicalLayoutSpecification,
  requests: PhysicalCableRoute[],
  options: Required<VoxelRouterOptions>,
  focusRoute?: PhysicalCableRoute,
): Grid {
  const board = layout.surfaces.equipmentBoard;
  const margin = options.cellSizeM * 2;
  const approaches = requests.flatMap((route) => [
    layout.portSpecifications[route.sourcePortId!].position,
    layout.portSpecifications[route.targetPortId!].position,
    portApproachPoint(route, "source", layout, options),
    portApproachPoint(route, "target", layout, options),
  ]);
  const globalMin: LayoutVector = [
    Math.min(board.center[0] - board.size[0] / 2, ...approaches.map((point) => point[0])) - margin,
    Math.min(board.center[1] - board.size[1] / 2, ...approaches.map((point) => point[1])) - margin,
    Math.min(board.frontZ + options.cellSizeM * 0.5, ...approaches.map((point) => point[2] - margin)),
  ];
  const globalMax: LayoutVector = [
    Math.max(board.center[0] + board.size[0] / 2, ...approaches.map((point) => point[0])) + margin,
    Math.max(board.center[1] + board.size[1] / 2, ...approaches.map((point) => point[1])) + margin,
    Math.max(
      board.frontZ + options.maximumForwardM,
      ...approaches.map((point) => point[2] + margin),
    ),
  ];
  const focusPoints = focusRoute ? [
    layout.portSpecifications[focusRoute.sourcePortId!].position,
    layout.portSpecifications[focusRoute.targetPortId!].position,
    portApproachPoint(focusRoute, "source", layout, options),
    portApproachPoint(focusRoute, "target", layout, options),
  ] : approaches;
  // A route cannot benefit from exploring the entire 3.4 m board in both X
  // and Y. Keep a generous local detour apron around its endpoints while
  // retaining the full wall-to-battery depth range. Previously the finer grid
  // spent millions of states proving that distant board corners were worse.
  const detourApronM = 0.32;
  const depthDetourApronM = 0.14;
  const min: LayoutVector = [
    Math.max(globalMin[0], Math.min(...focusPoints.map((point) => point[0])) - detourApronM),
    Math.max(globalMin[1], Math.min(...focusPoints.map((point) => point[1])) - detourApronM),
    Math.max(globalMin[2], Math.min(...focusPoints.map((point) => point[2])) - depthDetourApronM),
  ];
  const max: LayoutVector = [
    Math.min(globalMax[0], Math.max(...focusPoints.map((point) => point[0])) + detourApronM),
    Math.min(globalMax[1], Math.max(...focusPoints.map((point) => point[1])) + detourApronM),
    Math.min(globalMax[2], Math.max(...focusPoints.map((point) => point[2])) + depthDetourApronM),
  ];
  const obstaclePlanes = Object.values(layout.devices)
    .filter((device) => ["wall", "floor"].includes(device.mounting) && device.id !== "equipmentBoard")
    .flatMap((device) => {
      const clearance = 0.01;
      return [
        [device.position[0] - device.size[0] / 2 - clearance, device.position[1], device.position[2]],
        [device.position[0] + device.size[0] / 2 + clearance, device.position[1], device.position[2]],
        [device.position[0], device.position[1] - device.size[1] / 2 - clearance, device.position[2]],
        [device.position[0], device.position[1] + device.size[1] / 2 + clearance, device.position[2] + device.size[2] / 2 + clearance],
      ] as LayoutVector[];
    });
  const extras = [...approaches, ...obstaclePlanes];
  const xs = coordinateAxis(min[0], max[0], options.cellSizeM, extras.map((point) => point[0]));
  const ys = coordinateAxis(min[1], max[1], options.cellSizeM, extras.map((point) => point[1]));
  const zs = coordinateAxis(min[2], max[2], options.cellSizeM, extras.map((point) => point[2]));
  return { cellSizeM: options.cellSizeM, min, max, nx: xs.length, ny: ys.length, nz: zs.length, xs, ys, zs };
}

function coordinate(index: number, grid: Grid) {
  const z = Math.floor(index / (grid.nx * grid.ny));
  const remainder = index - z * grid.nx * grid.ny;
  const y = Math.floor(remainder / grid.nx);
  const x = remainder - y * grid.nx;
  return [x, y, z] as const;
}

function indexOf(x: number, y: number, z: number, grid: Grid) {
  return x + y * grid.nx + z * grid.nx * grid.ny;
}

function nearestIndex(values: number[], value: number) {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  values.forEach((candidate, index) => {
    const next = Math.abs(candidate - value);
    if (next < distance) {
      best = index;
      distance = next;
    }
  });
  return best;
}

function cellFor(point: LayoutVector, grid: Grid) {
  return [
    nearestIndex(grid.xs, point[0]),
    nearestIndex(grid.ys, point[1]),
    nearestIndex(grid.zs, point[2]),
  ] as const;
}

function worldFor(index: number, grid: Grid): LayoutVector {
  const [x, y, z] = coordinate(index, grid);
  return [grid.xs[x], grid.ys[y], grid.zs[z]];
}

function axisRange(values: number[], low: number, high: number) {
  const result: number[] = [];
  values.forEach((value, index) => {
    if (value >= low - EPSILON && value <= high + EPSILON) result.push(index);
  });
  return result;
}

function markDeviceObstacles(
  occupied: Uint8Array,
  grid: Grid,
  layout: PhysicalLayoutSpecification,
  route: PhysicalCableRoute,
) {
  Object.values(layout.devices)
    .filter((device) => ["wall", "floor"].includes(device.mounting) && device.id !== "equipmentBoard")
    .forEach((device) => {
      // The renderer replaces each rectilinear corner with an arc. Inflate the
      // projected device prism by the complete bend envelope, not only by the
      // straight cable radius, so the rounded tube cannot clip across a device
      // face even when the A* centerline itself clears the corner.
      const ownsEndpoint = device.id === route.sourceDeviceId || device.id === route.targetDeviceId;
      const clearance = ownsEndpoint ? 0.008 : Math.max(0.008, route.radiusM * 5.25 + 0.002);
      const xs = axisRange(grid.xs, device.position[0] - device.size[0] / 2 - clearance, device.position[0] + device.size[0] / 2 + clearance);
      const ys = axisRange(grid.ys, device.position[1] - device.size[1] / 2 - clearance, device.position[1] + device.size[1] / 2 + clearance);
      const zs = axisRange(
        grid.zs,
        device.mounting === "wall"
          ? grid.min[2]
          : device.position[2] - device.size[2] / 2 - clearance,
        device.mounting === "wall"
          ? grid.max[2]
          : device.position[2] + device.size[2] / 2 + clearance,
      );
      xs.forEach((x) => ys.forEach((y) => zs.forEach((z) => {
        occupied[indexOf(x, y, z, grid)] = 1;
      })));
    });
}

function heuristic(index: number, goal: number, grid: Grid, depthMovementPenalty: number) {
  const here = worldFor(index, grid);
  const there = worldFor(goal, grid);
  return (
    Math.abs(here[0] - there[0]) +
    Math.abs(here[1] - there[1]) +
    Math.abs(here[2] - there[2]) * depthMovementPenalty
  );
}

function simplifyCells(indices: number[], grid: Grid) {
  if (indices.length < 3) return indices;
  const result = [indices[0]];
  let previousDirection: string | undefined;
  for (let index = 1; index < indices.length; index += 1) {
    const before = coordinate(indices[index - 1], grid);
    const current = coordinate(indices[index], grid);
    const direction = `${Math.sign(current[0] - before[0])},${Math.sign(current[1] - before[1])},${Math.sign(current[2] - before[2])}`;
    if (previousDirection && direction !== previousDirection) result.push(indices[index - 1]);
    previousDirection = direction;
  }
  result.push(indices.at(-1)!);
  return result;
}

function simplifyOrthogonal(points: LayoutVector[]) {
  const unique = points.filter((point, index) => (
    index === 0 || point.some((value, axis) => Math.abs(value - points[index - 1][axis]) > EPSILON)
  ));
  if (unique.length < 3) return unique;
  const result: LayoutVector[] = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = result.at(-1)!;
    const current = unique[index];
    const next = unique[index + 1];
    const beforeAxis = [0, 1, 2].find((axis) => Math.abs(current[axis] - previous[axis]) > EPSILON);
    const afterAxis = [0, 1, 2].find((axis) => Math.abs(next[axis] - current[axis]) > EPSILON);
    const continuesForward = beforeAxis !== undefined && beforeAxis === afterAxis &&
      (current[beforeAxis] - previous[beforeAxis]) * (next[beforeAxis] - current[beforeAxis]) > 0;
    if (continuesForward) continue;
    result.push(current);
  }
  result.push(unique.at(-1)!);
  return result;
}

function pointSegmentDistance(point: LayoutVector, start: LayoutVector, end: LayoutVector) {
  const delta = end.map((value, axis) => value - start[axis]) as LayoutVector;
  const lengthSquared = delta.reduce((sum, value) => sum + value * value, 0);
  const amount = lengthSquared <= EPSILON
    ? 0
    : Math.max(0, Math.min(1, point.reduce((sum, value, axis) => (
        sum + (value - start[axis]) * delta[axis]
      ), 0) / lengthSquared));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + delta[axis] * amount)));
}

type TerminalCorridor = {
  end: LayoutVector;
  radiusM: number;
  routeId: string;
  start: LayoutVector;
};

function terminalCorridors(
  requests: PhysicalCableRoute[],
  layout: PhysicalLayoutSpecification,
  options: Required<VoxelRouterOptions>,
) {
  return requests.flatMap((route) => (["source", "target"] as const).map((endpoint) => {
    const portId = endpoint === "source" ? route.sourcePortId : route.targetPortId;
    return {
      end: portApproachPoint(route, endpoint, layout, options),
      radiusM: route.radiusM,
      routeId: route.id,
      start: layout.portSpecifications[portId!].position,
    } satisfies TerminalCorridor;
  }));
}

/**
 * Future terminal exits are immutable geometry, even though their main A*
 * routes have not been placed yet. Reserve their full rendered radius before
 * routing the first cable so an early route cannot consume a later cable's
 * only legal, straight-on port approach.
 */
function markForeignTerminalCorridors(
  occupied: Uint8Array,
  grid: Grid,
  current: PhysicalCableRoute,
  corridors: TerminalCorridor[],
  clearanceM: number,
) {
  corridors.forEach((corridor) => {
    if (corridor.routeId === current.id) return;
    const clearance = current.radiusM + corridor.radiusM + clearanceM;
    const xs = axisRange(
      grid.xs,
      Math.min(corridor.start[0], corridor.end[0]) - clearance,
      Math.max(corridor.start[0], corridor.end[0]) + clearance,
    );
    const ys = axisRange(
      grid.ys,
      Math.min(corridor.start[1], corridor.end[1]) - clearance,
      Math.max(corridor.start[1], corridor.end[1]) + clearance,
    );
    const zs = axisRange(
      grid.zs,
      Math.min(corridor.start[2], corridor.end[2]) - clearance,
      Math.max(corridor.start[2], corridor.end[2]) + clearance,
    );
    xs.forEach((x) => ys.forEach((y) => zs.forEach((z) => {
      const point: LayoutVector = [grid.xs[x], grid.ys[y], grid.zs[z]];
      if (pointSegmentDistance(point, corridor.start, corridor.end) < clearance - EPSILON) {
        occupied[indexOf(x, y, z, grid)] = 1;
      }
    })));
  });
}

function reserveRoute(
  occupied: Uint8Array,
  grid: Grid,
  points: LayoutVector[],
  radiusM: number,
  otherRadiusM: number,
  clearanceM: number,
) {
  const clearance = radiusM + otherRadiusM + clearanceM;
  points.slice(1).forEach((end, index) => {
    const start = points[index];
    const xs = axisRange(grid.xs, Math.min(start[0], end[0]) - clearance, Math.max(start[0], end[0]) + clearance);
    const ys = axisRange(grid.ys, Math.min(start[1], end[1]) - clearance, Math.max(start[1], end[1]) + clearance);
    const zs = axisRange(grid.zs, Math.min(start[2], end[2]) - clearance, Math.max(start[2], end[2]) + clearance);
    xs.forEach((x) => ys.forEach((y) => zs.forEach((z) => {
      const point: LayoutVector = [grid.xs[x], grid.ys[y], grid.zs[z]];
      if (pointSegmentDistance(point, start, end) < clearance - EPSILON) {
        occupied[indexOf(x, y, z, grid)] = 1;
      }
    })));
  });
}

function routeOne(
  route: PhysicalCableRoute,
  layout: PhysicalLayoutSpecification,
  grid: Grid,
  deviceOccupied: Uint8Array,
  cableOccupied: Uint8Array,
  terminalOccupied: Uint8Array,
  options: Required<VoxelRouterOptions>,
) {
  const source = layout.portSpecifications[route.sourcePortId!].position;
  const target = layout.portSpecifications[route.targetPortId!].position;
  const routedSource = portApproachPoint(route, "source", layout, options);
  const routedTarget = portApproachPoint(route, "target", layout, options);
  const startCell = cellFor(routedSource, grid);
  const goalCell = cellFor(routedTarget, grid);
  const start = indexOf(...startCell, grid);
  const goal = indexOf(...goalCell, grid);
  // The 14.4 mm production grid spans the floor batteries as well
  // as the wall. Sparse maps avoid clearing hundreds of megabytes of dense
  // direction-state arrays for every sequential route.
  const stateCount = grid.nx * grid.ny * grid.nz * 7;
  const distances = new Float32Array(stateCount);
  distances.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount);
  previous.fill(-1);
  const queue = new MinHeap(stateCount);
  const startState = start * 7 + 6;
  const heuristicWeight = options.heuristicWeight;
  distances[startState] = 0;
  queue.push({ cost: heuristic(start, goal, grid, options.depthMovementPenalty) * heuristicWeight, index: start, state: startState });
  let finalState = -1;
  let searchLimitReached = false;
  let discoveredStates = 1;
  while (queue.size > 0) {
    if (searchLimitReached) break;
    const currentState = queue.pop()!;
    const currentIndex = queue.poppedIndex;
    const currentDistance = distances[currentState];
    const currentDirection = currentState % 7 as Direction;
    if (queue.poppedCost > currentDistance + heuristic(currentIndex, goal, grid, options.depthMovementPenalty) * heuristicWeight + EPSILON) continue;
    if (currentIndex === goal) {
      finalState = currentState;
      break;
    }
    const [x, y, z] = coordinate(currentIndex, grid);
    DIRECTIONS.forEach(([dx, dy, dz], directionIndex) => {
      const nextX = x + dx;
      const nextY = y + dy;
      const nextZ = z + dz;
      if (nextX < 0 || nextX >= grid.nx || nextY < 0 || nextY >= grid.ny || nextZ < 0 || nextZ >= grid.nz) return;
      const nextIndex = indexOf(nextX, nextY, nextZ, grid);
      const nextPoint = worldFor(nextIndex, grid);
      if (deviceOccupied[nextIndex] && nextIndex !== start && nextIndex !== goal) return;
      if (terminalOccupied[nextIndex] && nextIndex !== start && nextIndex !== goal) return;
      if (cableOccupied[nextIndex] && nextIndex !== start && nextIndex !== goal) return;
      const point = worldFor(currentIndex, grid);
      const length = Math.abs(nextPoint[0] - point[0]) + Math.abs(nextPoint[1] - point[1]) + Math.abs(nextPoint[2] - point[2]);
      const direction = directionIndex as Direction;
      const movementCost = length * (dz === 0 ? 1 : options.depthMovementPenalty);
      const turnCost = currentDirection === 6 || currentDirection === direction ? 0 : options.turnPenaltyM;
      const forwardM = Math.max(0, nextPoint[2] - layout.surfaces.equipmentBoard.frontZ);
      const forwardCost = length * forwardM * options.depthPositionPenalty;
      const nextDistance = currentDistance + movementCost + turnCost + forwardCost;
      const nextState = nextIndex * 7 + direction;
      if (nextDistance + EPSILON >= distances[nextState]) return;
      // Dense floor-to-wall battery routes occasionally need to explore more
      // than 1.5 M direction states once every foreign connector corridor is
      // reserved. This runs only in the offline publisher; the extra ceiling
      // prevents a valid clear route being mislabeled as geometrically boxed
      // out merely because the safety model is more complete.
      const searchStateLimit = route.id === "junction-to-battery-negative-b" ? 6_000_000 : 3_000_000;
      if (discoveredStates >= searchStateLimit) {
        searchLimitReached = true;
        return;
      }
      if (!Number.isFinite(distances[nextState])) discoveredStates += 1;
      distances[nextState] = nextDistance;
      previous[nextState] = currentState;
      queue.push({
        cost: nextDistance + heuristic(nextIndex, goal, grid, options.depthMovementPenalty) * heuristicWeight,
        index: nextIndex,
        state: nextState,
      });
    });
  }
  if (finalState < 0) return undefined;

  const cells: number[] = [];
  for (let cursor = finalState; cursor >= 0; cursor = previous[cursor]) {
    cells.push(Math.floor(cursor / 7));
  }
  const gridPoints = simplifyCells(cells.reverse(), grid).map((index) => worldFor(index, grid));
  const points = simplifyOrthogonal([source, routedSource, ...gridPoints.slice(1, -1), routedTarget, target]);
  return {
    id: route.id,
    lengthM: routeLength(points),
    points,
    turns: Math.max(0, points.length - 2),
  } satisfies VoxelRouteResult;
}

function portApproachViolationCount(
  routes: Record<string, VoxelRouteResult>,
  requests: PhysicalCableRoute[],
  layout: PhysicalLayoutSpecification,
  options: Required<VoxelRouterOptions>,
) {
  return requests.reduce((violations, request) => {
    const route = routes[request.id];
    if (!route) return violations + 2;
    return violations + (["source", "target"] as const).reduce((count, endpoint) => {
      const portId = endpoint === "source" ? request.sourcePortId : request.targetPortId;
      const port = layout.portSpecifications[portId!];
      const portPoint = endpoint === "source" ? route.points[0] : route.points.at(-1)!;
      const neighbor = endpoint === "source" ? route.points[1] : route.points.at(-2)!;
      const delta = neighbor.map((value, axis) => value - portPoint[axis]);
      const length = Math.hypot(...delta);
      const dot = delta.reduce((sum, value, axis) => sum + value * port.direction[axis], 0) / Math.max(EPSILON, length);
      const requiredLength = Math.max(port.lengthM, request.radiusM * 2 + options.cableClearanceM);
      return count + Number(length < requiredLength - EPSILON || dot < 0.999);
    }, 0);
  }, 0);
}

function segmentIntersectsBounds(
  start: LayoutVector,
  end: LayoutVector,
  minimum: LayoutVector,
  maximum: LayoutVector,
) {
  let near = 0;
  let far = 1;
  for (const axis of [0, 1, 2]) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < EPSILON) {
      if (start[axis] < minimum[axis] || start[axis] > maximum[axis]) return false;
      continue;
    }
    let axisNear = (minimum[axis] - start[axis]) / delta;
    let axisFar = (maximum[axis] - start[axis]) / delta;
    if (axisNear > axisFar) [axisNear, axisFar] = [axisFar, axisNear];
    near = Math.max(near, axisNear);
    far = Math.min(far, axisFar);
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
}

function roundedDeviceFrontIssues(
  routes: PhysicalCableRoute[],
  layout: PhysicalLayoutSpecification,
) {
  const wallDevices = Object.values(layout.devices).filter((device) => (
    device.mounting === "wall" && device.id !== "equipmentBoard"
  ));
  const issues: string[] = [];
  routes.forEach((route) => {
    const centerline = sampleRoundedCableCenterline(
      route.points,
      Math.max(route.radiusM * 4.25, 0.009),
      route.radiusM,
    ).centerline.map((point) => point.toArray() as LayoutVector);
    wallDevices.forEach((device) => {
      // A cable may approach either device it actually terminates on. All
      // unrelated faces remain absolute exclusions through every Z layer.
      if (device.id === route.sourceDeviceId || device.id === route.targetDeviceId) return;
      const clearance = route.radiusM + 0.002;
      const minimum: LayoutVector = [
        device.position[0] - device.size[0] / 2 - clearance,
        device.position[1] - device.size[1] / 2 - clearance,
        device.position[2] - device.size[2] / 2 - clearance,
      ];
      const maximum: LayoutVector = [
        device.position[0] + device.size[0] / 2 + clearance,
        device.position[1] + device.size[1] / 2 + clearance,
        10,
      ];
      centerline.slice(1).forEach((end, index) => {
        if (segmentIntersectsBounds(centerline[index], end, minimum, maximum)) {
          issues.push(`${route.id}:${index}:${device.id}`);
        }
      });
    });
  });
  return [...new Set(issues)];
}

const optionsForAudit: Required<VoxelRouterOptions> = {
  cableClearanceM: 0.003,
  // 14.4 mm is the modeled OD of the largest 1/0 AWG conductors inside the
  // junction box. Exact port and obstacle planes are inserted between these
  // base voxels, so connector alignment is not quantized to this interval.
  cellSizeM: 0.0144,
  depthMovementPenalty: 4,
  depthPositionPenalty: 12,
  heuristicWeight: 2.5,
  maximumForwardM: 0.4,
  maximumPasses: 6,
  portApproachM: 0.006,
  turnPenaltyM: 0.12,
};

export function solveVoxelWallRoutes(
  layout: PhysicalLayoutSpecification,
  requestedOptions: VoxelRouterOptions = {},
  requestedRouteIds?: string[],
): VoxelRoutingResult {
  const options: Required<VoxelRouterOptions> = { ...optionsForAudit, ...requestedOptions };
  const started = performance.now();
  const requestedSet = requestedRouteIds ? new Set(requestedRouteIds) : undefined;
  const constrainedGroupPriority = (route: PhysicalCableRoute) => {
    const touchesFloor = [route.sourceDeviceId, route.targetDeviceId].some((id) => id && layout.devices[id]?.mounting === "floor");
    // The rear battery pair and its balancer are boxed in by the front pair.
    // Reserve that longer, narrower egress before the near-bank harness so a
    // complete solve normally succeeds without four full rip-up passes.
    if (route.id === "junction-to-battery-negative-b") return 9;
    if (route.id === "balancer-b-negative") return 8;
    if (route.id === "balancer-b-midpoint") return 7;
    if (route.id === "balancer-b-positive") return 6;
    if (route.id === "multiplus-battery-temperature") return 4;
    if (route.id.startsWith("balancer-a-") || route.id === "junction-to-battery-negative-a") return 3;
    if (touchesFloor) return 2;
    const touchesUnifi = [route.sourceDeviceId, route.targetDeviceId].includes("unifi");
    return touchesUnifi ? 1 : 0;
  };
  const requests = voxelRouteRequests(layout).filter((route) => !requestedSet || requestedSet.has(route.id)).sort((first, second) => (
    constrainedGroupPriority(second) - constrainedGroupPriority(first) ||
    second.radiusM - first.radiusM || first.lengthM - second.lengthM || first.id.localeCompare(second.id)
  ));
  const corridors = terminalCorridors(requests, layout, options);
  const routeSolveMs: Record<string, number> = {};
  const routePass = (orderedRequests: PhysicalCableRoute[]) => {
    const passRoutes: Record<string, VoxelRouteResult> = {};
    const passFailures: string[] = [];
    const placed: Array<{ request: PhysicalCableRoute; result: VoxelRouteResult }> = [];
    orderedRequests.forEach((request) => {
      const routeStarted = performance.now();
      const grid = createGrid(layout, requests, options, request);
      const deviceOccupied = new Uint8Array(grid.nx * grid.ny * grid.nz);
      const cableOccupied = new Uint8Array(deviceOccupied.length);
      markDeviceObstacles(deviceOccupied, grid, layout, request);
      placed.forEach((other) => reserveRoute(
        cableOccupied,
        grid,
        other.result.points,
        request.radiusM,
        other.request.radiusM,
        options.cableClearanceM,
      ));
      const terminalOccupied = new Uint8Array(deviceOccupied.length);
      markForeignTerminalCorridors(
        terminalOccupied,
        grid,
        request,
        corridors,
        options.cableClearanceM,
      );
      const result = routeOne(
        request,
        layout,
        grid,
        deviceOccupied,
        cableOccupied,
        terminalOccupied,
        options,
      );
      if (!result) {
        passFailures.push(request.id);
        routeSolveMs[request.id] = round((routeSolveMs[request.id] ?? 0) + performance.now() - routeStarted, 2);
        return;
      }
      passRoutes[result.id] = result;
      placed.push({ request, result });
      routeSolveMs[request.id] = round((routeSolveMs[request.id] ?? 0) + performance.now() - routeStarted, 2);
    });
    return { failedRouteIds: passFailures, routes: passRoutes };
  };
  let routingPasses = 1;
  let pass = routePass(requests);
  const passFailures = [pass.failedRouteIds];
  // Sequential routing is intentionally order-sensitive. If a late cable is
  // boxed out, rip up the set once and promote failed routes so they reserve
  // their constrained corridor first; all other cables are then regenerated.
  let retryOrder = [...requests];
  while (pass.failedRouteIds.length > 0 && routingPasses < options.maximumPasses) {
    const failed = new Set(pass.failedRouteIds);
    // Treat each three-wire balancer harness as an inseparable routing group.
    // Promoting only the last wire can make its sibling consume the exact lane
    // it needs on the following pass, causing a two-state ordering oscillation.
    (["balancer-a-", "balancer-b-"] as const).forEach((prefix) => {
      if (![...failed].some((id) => id.startsWith(prefix))) return;
      requests.forEach((route) => {
        if (route.id.startsWith(prefix)) failed.add(route.id);
      });
    });
    retryOrder = [...retryOrder].sort((first, second) => (
      Number(failed.has(second.id)) - Number(failed.has(first.id)) ||
      second.radiusM - first.radiusM || second.lengthM - first.lengthM || first.id.localeCompare(second.id)
    ));
    routingPasses += 1;
    pass = routePass(retryOrder);
    passFailures.push(pass.failedRouteIds);
  }
  const { failedRouteIds, routes } = pass;
  const routeValues = Object.values(routes);
  const renderedRoutes = requests.flatMap((request) => {
    const route = routes[request.id];
    return route ? [{ ...request, points: route.points, lengthM: route.lengthM }] : [];
  });
  const cableIssues = cableClearanceIssues(renderedRoutes, options.cableClearanceM);
  const deviceFrontIssues = deviceFrontCrossingIssues(renderedRoutes, layout.devices);
  const roundedFrontIssues = roundedDeviceFrontIssues(renderedRoutes, layout);
  const boardFrontZ = layout.surfaces.equipmentBoard.frontZ;
  const maximumForwardM = routeValues.length === 0 ? 0 : Math.max(
    ...routeValues.flatMap((route) => route.points.map((point) => point[2] - boardFrontZ)),
  );
  const wallDistanceCostM2 = routeValues.reduce((total, route) => total + route.points.slice(1).reduce((sum, end, index) => {
    const start = route.points[index];
    const length = Math.hypot(...end.map((value, axis) => value - start[axis]));
    const averageForward = Math.max(0, ((start[2] + end[2]) / 2) - boardFrontZ);
    return sum + length * averageForward;
  }, 0), 0);
  return {
    algorithm: "sequential-adaptive-voxel-a-star",
    cellSizeM: options.cellSizeM,
    clearanceIssues: cableIssues,
    failedRouteIds,
    metrics: {
      cableClearanceIssueCount: cableIssues.length,
      deviceFrontViolationCount: deviceFrontIssues.length,
      maximumForwardM: round(maximumForwardM),
      portApproachViolationCount: portApproachViolationCount(routes, requests, layout, options),
      roundedDeviceFrontViolationCount: roundedFrontIssues.length,
      routeCount: routeValues.length,
      totalLengthM: round(routeValues.reduce((sum, route) => sum + route.lengthM, 0)),
      totalTurns: routeValues.reduce((sum, route) => sum + route.turns, 0),
      wallDistanceCostM2: round(wallDistanceCostM2),
    },
    options,
    passFailures,
    routeSolveMs,
    routingPasses,
    routes,
    solveMs: round(performance.now() - started, 2),
  };
}
