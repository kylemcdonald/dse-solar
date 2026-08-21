import fs from "node:fs";
import path from "node:path";
import currentOptimization from "../data/optimized-physical-layout.json" with { type: "json" };
import { physicalLayout as startingSpecification } from "../app/physicalLayout.ts";
import {
  solvePhysicalLayout,
  type LayoutVector,
  type PhysicalDevice,
  type PhysicalLayoutSpecification,
} from "../app/physicalLayoutSolver.ts";
import { solveVoxelWallRoutes, type VoxelRoutingResult } from "../app/voxelCableRouter.ts";

type Point2 = [number, number];
type Bounds = { maximumX: number; maximumY: number; minimumX: number; minimumY: number };
type Candidate = {
  loss: number;
  positions: Record<string, Point2>;
  specification: PhysicalLayoutSpecification;
  voxel: VoxelRoutingResult;
};

const WALL_DEVICE_IDS = [
  "pvEntry", "smartSolar", "multiPlus", "acBoard", "junction", "ekran", "unifi",
  "usb", "balancerA", "balancerB", "batteryBreakerBox", "earthBar",
] as const;
const FIXED_POSITION_IDS = [
  "battery1", "battery2", "battery3", "battery4", "indoorLight", "outdoorFlood", "starlink",
] as const;
const EKRANO_EYE_LEVEL_M = 1.58;
const WALL_DEVICE_SPACING_M = 0.2;
const BOARD_EDGE_CLEARANCE_M = 0.03;
const TARGET_WALL_RIGHT_EDGE_M = 3.85;
const DEFAULT_ITERATIONS = 12;
const DEFAULT_SEED = 20260819;
const COARSE_CELL_SIZE_M = 0.0288;

class Random {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 1; }
  next() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }
}

const round = (value: number, places = 6) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function argument(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const iterations = Math.max(1, Math.floor(Number(argument("--iterations") ?? DEFAULT_ITERATIONS)));
const seed = Math.floor(Number(argument("--seed") ?? DEFAULT_SEED));
const outputPath = path.resolve(argument("--output") ?? "data/optimized-physical-layout.json");
const tracePath = path.resolve(argument("--trace") ?? "data/voxel-layout-optimization.json");
const board = startingSpecification.surfaces.equipmentBoard;
const wallZ = Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, startingSpecification.devices[id].position[2]]));

const verticalRanges: Partial<Record<(typeof WALL_DEVICE_IDS)[number], [number, number]>> = {
  pvEntry: [0.43, 0.95], smartSolar: [0.43, 1.15], multiPlus: [0.85, 2.35],
  acBoard: [0.75, 2.25], junction: [0.9, 2.15], ekran: [EKRANO_EYE_LEVEL_M, EKRANO_EYE_LEVEL_M],
  unifi: [1.3, 1.9], usb: [1.2, 1.95], balancerA: [0.43, 1.2],
  balancerB: [0.43, 1.2], batteryBreakerBox: [0.43, 1.15], earthBar: [0.4, 1.4],
};
const horizontalRanges: Partial<Record<(typeof WALL_DEVICE_IDS)[number], [number, number]>> = {
  pvEntry: [1.4, 1.95], smartSolar: [1.45, 2.5], batteryBreakerBox: [1.35, 2.85],
  balancerA: [1.4, 2.9], balancerB: [1.4, 2.9], ekran: [1.75, 2.95],
};

function deviceBounds(id: (typeof WALL_DEVICE_IDS)[number]): Bounds {
  const device = startingSpecification.devices[id];
  const boardLeft = board.center[0] - board.size[0] / 2 + BOARD_EDGE_CLEARANCE_M + device.size[0] / 2;
  const boardRight = board.center[0] + board.size[0] / 2 - BOARD_EDGE_CLEARANCE_M - device.size[0] / 2;
  const boardBottom = board.center[1] - board.size[1] / 2 + BOARD_EDGE_CLEARANCE_M + device.size[1] / 2;
  const boardTop = board.center[1] + board.size[1] / 2 - BOARD_EDGE_CLEARANCE_M - device.size[1] / 2;
  const horizontal = horizontalRanges[id] ?? [boardLeft, boardRight];
  const vertical = verticalRanges[id] ?? [boardBottom, boardTop];
  return {
    minimumX: Math.max(boardLeft, horizontal[0]),
    maximumX: Math.min(boardRight, horizontal[1], TARGET_WALL_RIGHT_EDGE_M - device.size[0] / 2),
    minimumY: Math.max(boardBottom, vertical[0]),
    maximumY: Math.min(boardTop, vertical[1]),
  };
}

const bounds = Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, deviceBounds(id)])) as Record<string, Bounds>;
const clonePositions = (positions: Record<string, Point2>) => Object.fromEntries(
  Object.entries(positions).map(([id, point]) => [id, [...point] as Point2]),
) as Record<string, Point2>;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function footprint(id: string, device: PhysicalDevice, point: Point2) {
  return id === "junction"
    ? { point: [point[0] - 0.017, point[1]] as Point2, size: [device.size[0] + 0.034, device.size[1]] as Point2 }
    : { point, size: [device.size[0], device.size[1]] as Point2 };
}

function intrusion(firstId: string, firstPoint: Point2, secondId: string, secondPoint: Point2) {
  const first = footprint(firstId, startingSpecification.devices[firstId], firstPoint);
  const second = footprint(secondId, startingSpecification.devices[secondId], secondPoint);
  return {
    x: (first.size[0] + second.size[0]) / 2 + WALL_DEVICE_SPACING_M - Math.abs(first.point[0] - second.point[0]),
    y: (first.size[1] + second.size[1]) / 2 + WALL_DEVICE_SPACING_M - Math.abs(first.point[1] - second.point[1]),
  };
}

function clampPositions(positions: Record<string, Point2>) {
  WALL_DEVICE_IDS.forEach((id) => {
    positions[id][0] = clamp(positions[id][0], bounds[id].minimumX, bounds[id].maximumX);
    positions[id][1] = clamp(positions[id][1], bounds[id].minimumY, bounds[id].maximumY);
  });
  positions.ekran[1] = EKRANO_EYE_LEVEL_M;
}

function repairPositions(source: Record<string, Point2>) {
  const positions = clonePositions(source);
  clampPositions(positions);
  for (let pass = 0; pass < 260; pass += 1) {
    let changed = false;
    WALL_DEVICE_IDS.forEach((firstId, firstIndex) => WALL_DEVICE_IDS.slice(firstIndex + 1).forEach((secondId) => {
      const overlap = intrusion(firstId, positions[firstId], secondId, positions[secondId]);
      if (overlap.x <= 0 || overlap.y <= 0) return;
      changed = true;
      const firstLockedY = firstId === "ekran";
      const secondLockedY = secondId === "ekran";
      const axis = overlap.x <= overlap.y || firstLockedY || secondLockedY ? 0 : 1;
      const amount = (axis === 0 ? overlap.x : overlap.y) + 0.001;
      const direction = positions[firstId][axis] <= positions[secondId][axis] ? 1 : -1;
      if (axis === 1 && firstLockedY) positions[secondId][axis] += direction * amount;
      else if (axis === 1 && secondLockedY) positions[firstId][axis] -= direction * amount;
      else {
        positions[firstId][axis] -= direction * amount / 2;
        positions[secondId][axis] += direction * amount / 2;
      }
      clampPositions(positions);
    }));
    if (!changed) break;
  }
  return positions;
}

function marginViolations(positions: Record<string, Point2>) {
  const issues: string[] = [];
  WALL_DEVICE_IDS.forEach((firstId, firstIndex) => WALL_DEVICE_IDS.slice(firstIndex + 1).forEach((secondId) => {
    const overlap = intrusion(firstId, positions[firstId], secondId, positions[secondId]);
    if (overlap.x > 0 && overlap.y > 0) issues.push(`${firstId}:${secondId}`);
  }));
  return issues;
}

function overridesFor(positions: Record<string, Point2>) {
  return Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, {
    position: [positions[id][0], positions[id][1], wallZ[id]] as LayoutVector,
  }]));
}

function evaluate(positions: Record<string, Point2>, exact = false): Candidate {
  const repaired = repairPositions(positions);
  const spacingIssues = marginViolations(repaired);
  const specification = solvePhysicalLayout({
    deviceOverrides: overridesFor(repaired),
    routingEffort: "optimization",
  });
  const voxel = solveVoxelWallRoutes(specification, {
    cellSizeM: exact ? 0.0144 : COARSE_CELL_SIZE_M,
    maximumPasses: exact ? 6 : 1,
  });
  const incomplete = voxel.failedRouteIds.length + voxel.metrics.portApproachViolationCount +
    voxel.metrics.deviceFrontViolationCount + voxel.metrics.roundedDeviceFrontViolationCount + spacingIssues.length;
  const loss = incomplete > 0
    ? 1_000_000 + incomplete * 100_000 + (40 - voxel.metrics.routeCount) * 10_000
    : voxel.metrics.totalLengthM +
      voxel.metrics.cableClearanceIssueCount * (exact ? 100_000 : 35) +
      voxel.metrics.wallDistanceCostM2 * 0.025 + voxel.metrics.totalTurns * 0.0005;
  return { loss: round(loss), positions: repaired, specification, voxel };
}

const started = performance.now();
const random = new Random(seed);
const initialPositions = Object.fromEntries(WALL_DEVICE_IDS.map((id) => [
  id,
  startingSpecification.devices[id].position.slice(0, 2) as Point2,
])) as Record<string, Point2>;
let current = evaluate(initialPositions);
let best = current;
let evaluations = 1;
const convergence = [{ iteration: 0, loss: current.loss, cableM: current.voxel.metrics.totalLengthM }];

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const perturbationM = 0.045 * Math.pow(iteration + 2, -0.18);
  const signs = Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, [
    random.next() < 0.5 ? -1 : 1,
    id === "ekran" ? 0 : random.next() < 0.5 ? -1 : 1,
  ] as Point2])) as Record<string, Point2>;
  const offset = (direction: number) => repairPositions(Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, [
    current.positions[id][0] + signs[id][0] * perturbationM * direction,
    current.positions[id][1] + signs[id][1] * perturbationM * direction,
  ]])) as Record<string, Point2>);
  const positive = evaluate(offset(1));
  const negative = evaluate(offset(-1));
  evaluations += 2;
  const preferred = positive.loss <= negative.loss ? positive : negative;
  if (preferred.loss + 0.0001 < current.loss) current = preferred;
  if (preferred.loss + 0.0001 < best.loss) best = preferred;
  convergence.push({
    iteration,
    loss: best.loss,
    cableM: best.voxel.metrics.totalLengthM,
    positiveLoss: positive.loss,
    negativeLoss: negative.loss,
  });
  process.stderr.write(
    `iteration ${iteration}/${iterations} · ${evaluations} evaluations · ` +
    `${best.voxel.metrics.totalLengthM.toFixed(3)} m · loss ${best.loss.toFixed(3)}\n`,
  );
}

const exactBaseline = evaluate(initialPositions, true);
const exactCandidate = evaluate(best.positions, true);
evaluations += 2;
const candidatePasses = exactCandidate.voxel.failedRouteIds.length === 0 &&
  exactCandidate.voxel.metrics.routeCount === exactBaseline.voxel.metrics.routeCount &&
  exactCandidate.voxel.metrics.cableClearanceIssueCount === 0 &&
  exactCandidate.voxel.metrics.deviceFrontViolationCount === 0 &&
  exactCandidate.voxel.metrics.roundedDeviceFrontViolationCount === 0 &&
  exactCandidate.voxel.metrics.portApproachViolationCount === 0 &&
  marginViolations(exactCandidate.positions).length === 0;
const selected = candidatePasses && exactCandidate.voxel.metrics.totalLengthM < exactBaseline.voxel.metrics.totalLengthM
  ? exactCandidate
  : exactBaseline;
const improved = selected === exactCandidate;
const elapsedSeconds = round((performance.now() - started) / 1000, 3);
const existing = currentOptimization as Record<string, unknown> & { bestGenome?: Record<string, unknown> };
const previousVoxelOptimization = existing.voxelOptimization as undefined | {
  baseline?: VoxelRoutingResult["metrics"];
  evaluations?: number;
  iterations?: number;
  searchRuns?: unknown[];
  totalElapsedSeconds?: number;
  totalEvaluations?: number;
  totalIterations?: number;
};
const cumulativeBaseline = previousVoxelOptimization?.baseline ?? exactBaseline.voxel.metrics;
const totalElapsedSeconds = round((previousVoxelOptimization?.totalElapsedSeconds ?? 0) + elapsedSeconds, 3);
const totalEvaluations = (previousVoxelOptimization?.totalEvaluations ?? previousVoxelOptimization?.evaluations ?? 0) + evaluations;
const totalIterations = (previousVoxelOptimization?.totalIterations ?? previousVoxelOptimization?.iterations ?? 0) + iterations;
const selectedOverrides = {
  ...Object.fromEntries(FIXED_POSITION_IDS.map((id) => [id, {
    position: [...startingSpecification.devices[id].position] as LayoutVector,
  }])),
  ...overridesFor(selected.positions),
};
const bestGenome = {
  ...(existing.bestGenome ?? {}),
  wall: Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, selected.positions[id]])),
};
const document = {
  ...existing,
  schemaVersion: 2,
  status: "voxel-a-star-stochastic-gradient-optimized-finalized",
  generatedAt: new Date().toISOString(),
  algorithm: "seeded two-sided simultaneous-perturbation stochastic descent evaluated by complete voxel A* rerouting",
  seed,
  requestedTimeBudgetSeconds: totalElapsedSeconds,
  elapsedSeconds: totalElapsedSeconds,
  evaluations: totalEvaluations,
  generations: totalIterations,
  improvementPercent: round(
    (cumulativeBaseline.totalLengthM - selected.voxel.metrics.totalLengthM) /
      cumulativeBaseline.totalLengthM * 100,
    3,
  ),
  bestGenome,
  voxelOptimization: {
    approximateCellSizeM: COARSE_CELL_SIZE_M,
    exactCellSizeM: 0.0144,
    iterations: totalIterations,
    evaluations: totalEvaluations,
    totalElapsedSeconds,
    totalIterations,
    totalEvaluations,
    candidateAccepted: selected.voxel.metrics.totalLengthM < cumulativeBaseline.totalLengthM,
    baseline: cumulativeBaseline,
    selected: selected.voxel.metrics,
    convergence,
    searchRuns: [
      ...(previousVoxelOptimization?.searchRuns ?? []),
      {
        elapsedSeconds,
        iterations,
        evaluations,
        localCandidateAccepted: improved,
        localBaseline: exactBaseline.voxel.metrics,
        localSelected: selected.voxel.metrics,
      },
    ],
  },
  runtime: {
    deviceOverrides: selectedOverrides,
    metrics: selected.specification.metrics,
    specification: selected.specification,
  },
};
const trace = {
  generatedAt: document.generatedAt,
  algorithm: document.algorithm,
  seed,
  elapsedSeconds,
  candidateAccepted: improved,
  baselinePositions: initialPositions,
  selectedPositions: selected.positions,
  baselineMetrics: exactBaseline.voxel.metrics,
  selectedMetrics: selected.voxel.metrics,
  convergence,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
fs.writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  tracePath,
  elapsedSeconds,
  evaluations,
  candidateAccepted: improved,
  baselineMetrics: exactBaseline.voxel.metrics,
  selectedMetrics: selected.voxel.metrics,
}, null, 2)}\n`);
