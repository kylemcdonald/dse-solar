import {
  type LayoutVector,
  type PhysicalCableRoute,
  type PhysicalLayoutSpecification,
} from "./physicalLayoutSolver.ts";

type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type VoxelRouterOptions = {
  cellSizeM?: number;
  depthMovementPenalty?: number;
  depthPositionPenalty?: number;
  maximumForwardM?: number;
  turnPenalty?: number;
};

export type VoxelRouteResult = {
  id: string;
  lengthM: number;
  points: LayoutVector[];
  turns: number;
};

export type VoxelRoutingResult = {
  algorithm: "sequential-voxel-a-star";
  cellSizeM: number;
  failedRouteIds: string[];
  metrics: {
    maximumForwardM: number;
    routeCount: number;
    totalLengthM: number;
    totalTurns: number;
  };
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
};

type QueueNode = {
  cost: number;
  index: number;
  state: number;
};

const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

const round = (value: number, places = 4) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

class MinHeap {
  private values: QueueNode[] = [];

  get size() { return this.values.length; }

  push(value: QueueNode) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].cost <= this.values[index].cost) break;
      [this.values[parent], this.values[index]] = [this.values[index], this.values[parent]];
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
        if (left < this.values.length && this.values[left].cost < this.values[best].cost) best = left;
        if (right < this.values.length && this.values[right].cost < this.values[best].cost) best = right;
        if (best === index) break;
        [this.values[index], this.values[best]] = [this.values[best], this.values[index]];
        index = best;
      }
    }
    return first;
  }
}

function createGrid(layout: PhysicalLayoutSpecification, options: Required<VoxelRouterOptions>): Grid {
  const board = layout.surfaces.equipmentBoard;
  const margin = options.cellSizeM * 2;
  const min: LayoutVector = [
    board.center[0] - board.size[0] / 2 - margin,
    board.center[1] - board.size[1] / 2 - margin,
    board.frontZ + options.cellSizeM * 0.5,
  ];
  const max: LayoutVector = [
    board.center[0] + board.size[0] / 2 + margin,
    board.center[1] + board.size[1] / 2 + margin,
    board.frontZ + options.maximumForwardM,
  ];
  return {
    cellSizeM: options.cellSizeM,
    min,
    max,
    nx: Math.floor((max[0] - min[0]) / options.cellSizeM) + 1,
    ny: Math.floor((max[1] - min[1]) / options.cellSizeM) + 1,
    nz: Math.floor((max[2] - min[2]) / options.cellSizeM) + 1,
  };
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

function cellFor(point: LayoutVector, grid: Grid) {
  return [
    Math.max(0, Math.min(grid.nx - 1, Math.round((point[0] - grid.min[0]) / grid.cellSizeM))),
    Math.max(0, Math.min(grid.ny - 1, Math.round((point[1] - grid.min[1]) / grid.cellSizeM))),
    Math.max(0, Math.min(grid.nz - 1, Math.round((point[2] - grid.min[2]) / grid.cellSizeM))),
  ] as const;
}

function worldFor(index: number, grid: Grid): LayoutVector {
  const [x, y, z] = coordinate(index, grid);
  return [
    round(grid.min[0] + x * grid.cellSizeM),
    round(grid.min[1] + y * grid.cellSizeM),
    round(grid.min[2] + z * grid.cellSizeM),
  ];
}

function wallRouteRequests(layout: PhysicalLayoutSpecification) {
  return Object.values(layout.routes).filter((route) => {
    if (route.routing !== "automatic-rectilinear" || !route.sourceDeviceId || !route.targetDeviceId) return false;
    return layout.devices[route.sourceDeviceId]?.mounting === "wall" &&
      layout.devices[route.targetDeviceId]?.mounting === "wall";
  });
}

function markDeviceObstacles(
  occupied: Uint8Array,
  grid: Grid,
  layout: PhysicalLayoutSpecification,
) {
  Object.values(layout.devices)
    .filter((device) => device.mounting === "wall" && device.id !== "equipmentBoard")
    .forEach((device) => {
      const clearance = 0.008;
      const minimum = cellFor([
        device.position[0] - device.size[0] / 2 - clearance,
        device.position[1] - device.size[1] / 2 - clearance,
        grid.min[2],
      ], grid);
      const maximum = cellFor([
        device.position[0] + device.size[0] / 2 + clearance,
        device.position[1] + device.size[1] / 2 + clearance,
        device.position[2] + device.size[2] / 2,
      ], grid);
      for (let z = minimum[2]; z <= maximum[2]; z += 1) {
        for (let y = minimum[1]; y <= maximum[1]; y += 1) {
          for (let x = minimum[0]; x <= maximum[0]; x += 1) {
            occupied[indexOf(x, y, z, grid)] = 1;
          }
        }
      }
    });
}

function heuristic(index: number, goal: number, grid: Grid, depthPenalty: number) {
  const here = coordinate(index, grid);
  const there = coordinate(goal, grid);
  return (
    Math.abs(here[0] - there[0]) +
    Math.abs(here[1] - there[1]) +
    Math.abs(here[2] - there[2]) * depthPenalty
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
    index === 0 || point.some((value, axis) => Math.abs(value - points[index - 1][axis]) > 0.0001)
  ));
  if (unique.length < 3) return unique;
  const result: LayoutVector[] = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = result.at(-1)!;
    const current = unique[index];
    const next = unique[index + 1];
    const beforeAxis = [0, 1, 2].find((axis) => Math.abs(current[axis] - previous[axis]) > 0.0001);
    const afterAxis = [0, 1, 2].find((axis) => Math.abs(next[axis] - current[axis]) > 0.0001);
    if (beforeAxis === afterAxis) continue;
    result.push(current);
  }
  result.push(unique.at(-1)!);
  return result;
}

function routeOne(
  route: PhysicalCableRoute,
  layout: PhysicalLayoutSpecification,
  grid: Grid,
  occupied: Uint8Array,
  options: Required<VoxelRouterOptions>,
) {
  const source = layout.ports[route.sourcePortId!];
  const target = layout.ports[route.targetPortId!];
  const terminalEscape = (point: LayoutVector, deviceId: string | undefined): LayoutVector => {
    const device = deviceId ? layout.devices[deviceId] : undefined;
    const deviceFront = device
      ? device.position[2] + device.size[2] / 2
      : layout.surfaces.equipmentBoard.frontZ;
    return [point[0], point[1], Math.max(point[2], deviceFront) + grid.cellSizeM * 1.5];
  };
  // Device bodies remain solid. Every connector first receives a short normal
  // escape stub to a free routing plane, matching how glands and front-facing
  // terminals work physically and preventing coarse voxels from trapping a
  // route inside its own source enclosure.
  const routedSource = terminalEscape(source, route.sourceDeviceId);
  const routedTarget = terminalEscape(target, route.targetDeviceId);
  const startCell = cellFor(routedSource, grid);
  const goalCell = cellFor(routedTarget, grid);
  const start = indexOf(...startCell, grid);
  const goal = indexOf(...goalCell, grid);
  const stateCount = occupied.length * 7;
  const distances = new Float64Array(stateCount);
  distances.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount);
  previous.fill(-1);
  const queue = new MinHeap();
  const startState = start * 7 + 6;
  distances[startState] = 0;
  queue.push({ cost: heuristic(start, goal, grid, options.depthMovementPenalty), index: start, state: startState });
  let finalState = -1;

  while (queue.size > 0) {
    const current = queue.pop()!;
    const currentDistance = distances[current.state];
    const currentDirection = current.state % 7 as Direction;
    if (current.cost > currentDistance + heuristic(current.index, goal, grid, options.depthMovementPenalty) + 0.0001) continue;
    if (current.index === goal) {
      finalState = current.state;
      break;
    }
    const [x, y, z] = coordinate(current.index, grid);
    DIRECTIONS.forEach(([dx, dy, dz], directionIndex) => {
      const nextX = x + dx;
      const nextY = y + dy;
      const nextZ = z + dz;
      if (nextX < 0 || nextX >= grid.nx || nextY < 0 || nextY >= grid.ny || nextZ < 0 || nextZ >= grid.nz) return;
      const nextIndex = indexOf(nextX, nextY, nextZ, grid);
      const nearTerminal = (terminal: number) => {
        const [terminalX, terminalY, terminalZ] = coordinate(terminal, grid);
        return Math.abs(nextX - terminalX) + Math.abs(nextY - terminalY) + Math.abs(nextZ - terminalZ) <= 2;
      };
      // Several Ekrano and UniFi connectors intentionally occupy one coarse
      // 30–40 mm fan-out neighborhood. Permit reuse only inside those two-cell
      // terminal bubbles; the rest of every completed route remains occupied.
      if (occupied[nextIndex] && nextIndex !== start && nextIndex !== goal && !nearTerminal(start) && !nearTerminal(goal)) return;
      const direction = directionIndex as Direction;
      const movementCost = dz === 0 ? 1 : options.depthMovementPenalty;
      const turnCost = currentDirection === 6 || currentDirection === direction ? 0 : options.turnPenalty;
      const forwardCost = nextZ * options.depthPositionPenalty;
      const nextDistance = currentDistance + movementCost + turnCost + forwardCost;
      const nextState = nextIndex * 7 + direction;
      if (nextDistance + 0.0001 >= distances[nextState]) return;
      distances[nextState] = nextDistance;
      previous[nextState] = current.state;
      queue.push({
        cost: nextDistance + heuristic(nextIndex, goal, grid, options.depthMovementPenalty),
        index: nextIndex,
        state: nextState,
      });
    });
  }
  if (finalState < 0) return undefined;

  const cells: number[] = [];
  let cursor = finalState;
  while (cursor >= 0) {
    cells.push(Math.floor(cursor / 7));
    cursor = previous[cursor];
  }
  cells.reverse();
  cells.forEach((index) => { occupied[index] = 1; });
  const simplified = simplifyCells(cells, grid);
  const gridPoints = simplified.map((index) => worldFor(index, grid));
  const firstGrid = gridPoints[0];
  const lastGrid = gridPoints.at(-1)!;
  const points = simplifyOrthogonal([
    source,
    [source[0], source[1], firstGrid[2]],
    [firstGrid[0], source[1], firstGrid[2]],
    firstGrid,
    ...gridPoints.slice(1, -1),
    lastGrid,
    [target[0], lastGrid[1], lastGrid[2]],
    [target[0], target[1], lastGrid[2]],
    target,
  ]);
  const lengthM = points.slice(1).reduce((sum, point, index) => (
    sum + Math.abs(point[0] - points[index][0]) +
      Math.abs(point[1] - points[index][1]) +
      Math.abs(point[2] - points[index][2])
  ), 0);
  return {
    id: route.id,
    lengthM: round(lengthM),
    points,
    turns: Math.max(0, points.length - 2),
  } satisfies VoxelRouteResult;
}

export function solveVoxelWallRoutes(
  layout: PhysicalLayoutSpecification,
  requestedOptions: VoxelRouterOptions = {},
): VoxelRoutingResult {
  const options: Required<VoxelRouterOptions> = {
    cellSizeM: requestedOptions.cellSizeM ?? 0.04,
    depthMovementPenalty: requestedOptions.depthMovementPenalty ?? 1.45,
    depthPositionPenalty: requestedOptions.depthPositionPenalty ?? 0.018,
    maximumForwardM: requestedOptions.maximumForwardM ?? 0.4,
    turnPenalty: requestedOptions.turnPenalty ?? 0.28,
  };
  const started = performance.now();
  const grid = createGrid(layout, options);
  const occupied = new Uint8Array(grid.nx * grid.ny * grid.nz);
  markDeviceObstacles(occupied, grid, layout);
  const routingPriorityRadius = (route: PhysicalCableRoute) => (
    route.radiusM + (route.id.startsWith("junction-to-ekrano-") ? 0.0002 : 0)
  );
  const requests = wallRouteRequests(layout).sort((first, second) => (
    routingPriorityRadius(second) - routingPriorityRadius(first) ||
    first.lengthM - second.lengthM || first.id.localeCompare(second.id)
  ));
  const routes: Record<string, VoxelRouteResult> = {};
  const failedRouteIds: string[] = [];
  requests.forEach((request) => {
    const result = routeOne(request, layout, grid, occupied, options);
    if (result) routes[result.id] = result;
    else failedRouteIds.push(request.id);
  });
  const routeValues = Object.values(routes);
  const maximumForwardM = routeValues.length === 0 ? 0 : Math.max(
    ...routeValues.flatMap((route) => route.points.map((point) => point[2] - layout.surfaces.equipmentBoard.frontZ)),
  );
  return {
    algorithm: "sequential-voxel-a-star",
    cellSizeM: options.cellSizeM,
    failedRouteIds,
    metrics: {
      maximumForwardM: round(maximumForwardM),
      routeCount: routeValues.length,
      totalLengthM: round(routeValues.reduce((sum, route) => sum + route.lengthM, 0)),
      totalTurns: routeValues.reduce((sum, route) => sum + route.turns, 0),
    },
    routes,
    solveMs: round(performance.now() - started, 2),
  };
}

export function visibilityWallMetrics(layout: PhysicalLayoutSpecification) {
  const routes = wallRouteRequests(layout);
  const boardFrontZ = layout.surfaces.equipmentBoard.frontZ;
  const direction = (first: LayoutVector, second: LayoutVector) => (
    [0, 1, 2].find((axis) => Math.abs(first[axis] - second[axis]) > 0.0001) ?? -1
  );
  return {
    maximumForwardM: round(Math.max(...routes.flatMap((route) => route.points.map((point) => point[2] - boardFrontZ)))),
    routeCount: routes.length,
    totalLengthM: round(routes.reduce((sum, route) => sum + route.lengthM, 0)),
    totalTurns: routes.reduce((sum, route) => sum + route.points.slice(2).filter((point, index) => (
      direction(route.points[index], route.points[index + 1]) !== direction(route.points[index + 1], point)
    )).length, 0),
  };
}
