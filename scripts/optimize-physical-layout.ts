import fs from "node:fs";
import path from "node:path";
import {
  solvePhysicalLayout,
  type LayoutVector,
  type PhysicalDevice,
  type PhysicalLayoutSpecification,
} from "../app/physicalLayoutSolver.ts";

type Point2 = [number, number];

type Genome = {
  batteryAnchor: [number, number];
  indoorLight: Point2;
  outdoorFlood: Point2;
  starlink: Point2;
  wall: Record<string, Point2>;
};

type LayoutMetrics = {
  batteryForwardExcursionM: number;
  cableClearanceIssueCount: number;
  deviceFrontCrossingCount: number;
  forwardExcursionM: number;
  junctionBackRouteCount: number;
  junctionEgressTurnCount: number;
  maximumForwardExcursionM: number;
  planarDirectionReversals: number;
  portApproachIssueCount: number;
  projectedCableConflictCount: number;
  score: number;
  automaticRouteExcessLengthM: number;
  automaticRouteLengthM: number;
  automaticRouteTurnCount: number;
  thickCableLengthM: number;
  totalRenderedCableM: number;
  unfusedBatteryPositiveLengthM: number;
  wallDistanceCostM2: number;
  wallBoundingAreaM2: number;
  wallDeviceSpanM: number;
  wallVerticalSpanM: number;
  wallRightEdgeM: number;
  wallMeanXM: number;
  wallOverlapCount: number;
  weightedCableLengthM: number;
};

type Evaluation = {
  genome: Genome;
  metrics: LayoutMetrics;
  specification?: PhysicalLayoutSpecification;
};

type Bounds = {
  maximumX: number;
  maximumY: number;
  minimumX: number;
  minimumY: number;
};

const WALL_DEVICE_IDS = [
  "pvEntry",
  "smartSolar",
  "multiPlus",
  "acBoard",
  "junction",
  "ekran",
  "unifi",
  "usb",
  "balancerA",
  "balancerB",
  "batteryBreakerBox",
  "earthBar",
] as const;

const BATTERY_ROUTE_IDS = new Set([
  "junction-to-battery-negative-a",
  "junction-to-battery-negative-b",
  "battery-a-to-breaker",
  "battery-b-to-breaker",
  "balancer-a-positive",
  "balancer-a-midpoint",
  "balancer-a-negative",
  "balancer-b-positive",
  "balancer-b-midpoint",
  "balancer-b-negative",
  "multiplus-battery-temperature",
]);

const EKRANO_EYE_LEVEL_M = 1.58;
const WALL_DEVICE_SPACING_M = 0.2;
const BOARD_EDGE_CLEARANCE_M = 0.03;
const TARGET_WALL_RIGHT_EDGE_M = 3.85;
const BATTERY_COLUMN_SPACING_M = 0.56;
const BATTERY_ROW_SPACING_M = 0.33;
const DEFAULT_SEED = 20260817;
const DEFAULT_SECONDS = 60;
const DEFAULT_POPULATION_SIZE = 10;
const ALGORITHM = "time-bounded seeded generational evolutionary placement search with tournament selection, blend crossover, Gaussian mutation, fast deterministic oriented-port route scoring, and one full-lane deterministic route finalization";

class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  next() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }

  gaussian() {
    const first = Math.max(this.next(), Number.EPSILON);
    const second = this.next();
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  }

  integer(maximum: number) {
    return Math.floor(this.next() * maximum);
  }
}

const round = (value: number, places = 6) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function cloneGenome(genome: Genome): Genome {
  return {
    batteryAnchor: [...genome.batteryAnchor],
    indoorLight: [...genome.indoorLight],
    outdoorFlood: [...genome.outdoorFlood],
    starlink: [...genome.starlink],
    wall: Object.fromEntries(Object.entries(genome.wall).map(([id, point]) => [id, [...point]])),
  };
}

function commandValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const requestedSeconds = Number(commandValue("--seconds") ?? DEFAULT_SECONDS);
const seed = Number(commandValue("--seed") ?? DEFAULT_SEED);
const populationSize = Math.max(6, Math.floor(Number(commandValue("--population") ?? DEFAULT_POPULATION_SIZE)));
const eliteCount = Math.max(2, Math.min(4, Math.floor(populationSize / 4)));
const outputPath = path.resolve(commandValue("--output") ?? "data/optimized-physical-layout.json");
const resumePath = commandValue("--resume");
const finalizeOnly = process.argv.includes("--finalize");

if (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) {
  throw new Error("--seconds must be a positive number");
}
if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");
if (!Number.isFinite(populationSize)) throw new Error("--population must be a positive integer");

const baseSpecification = solvePhysicalLayout({ routingEffort: "optimization" });
const board = baseSpecification.surfaces.equipmentBoard;
const wallZ = Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, baseSpecification.devices[id].position[2]]));

const verticalRanges: Partial<Record<(typeof WALL_DEVICE_IDS)[number], [number, number]>> = {
  pvEntry: [0.43, 0.95],
  smartSolar: [0.43, 1.15],
  multiPlus: [0.85, 2.35],
  acBoard: [0.75, 2.25],
  junction: [0.9, 2.15],
  ekran: [EKRANO_EYE_LEVEL_M, EKRANO_EYE_LEVEL_M],
  unifi: [1.3, 1.9],
  usb: [1.2, 1.95],
  balancerA: [0.43, 1.2],
  balancerB: [0.43, 1.2],
  batteryBreakerBox: [0.43, 1.15],
  earthBar: [0.4, 1.4],
};

const horizontalRanges: Partial<Record<(typeof WALL_DEVICE_IDS)[number], [number, number]>> = {
  pvEntry: [1.4, 1.95],
  smartSolar: [1.45, 2.5],
  batteryBreakerBox: [1.35, 2.85],
  balancerA: [1.4, 2.9],
  balancerB: [1.4, 2.9],
  ekran: [1.75, 2.95],
};

function deviceBounds(id: (typeof WALL_DEVICE_IDS)[number]): Bounds {
  const device = baseSpecification.devices[id];
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampGenome(genome: Genome) {
  WALL_DEVICE_IDS.forEach((id) => {
    const limit = bounds[id];
    genome.wall[id][0] = clamp(genome.wall[id][0], limit.minimumX, limit.maximumX);
    genome.wall[id][1] = clamp(genome.wall[id][1], limit.minimumY, limit.maximumY);
  });
  genome.wall.ekran[1] = EKRANO_EYE_LEVEL_M;
  genome.batteryAnchor[0] = clamp(genome.batteryAnchor[0], 1.48, 1.62);
  genome.batteryAnchor[1] = clamp(genome.batteryAnchor[1], -1.86, -1.64);
  genome.indoorLight[0] = clamp(genome.indoorLight[0], 2.65, 3.25);
  genome.indoorLight[1] = clamp(genome.indoorLight[1], 2.58, 2.74);
  genome.outdoorFlood[0] = clamp(genome.outdoorFlood[0], 2.8, 3.4);
  genome.outdoorFlood[1] = clamp(genome.outdoorFlood[1], 2.4, 2.68);
  genome.starlink[0] = clamp(genome.starlink[0], 2.65, 3.45);
  genome.starlink[1] = clamp(genome.starlink[1], 3.3, 3.42);
}

function overlap(
  firstId: string,
  first: PhysicalDevice,
  firstPoint: Point2,
  secondId: string,
  second: PhysicalDevice,
  secondPoint: Point2,
) {
  const footprint = (id: string, device: PhysicalDevice, point: Point2) => id === "junction"
    ? { point: [point[0] - 0.017, point[1]] as Point2, size: [device.size[0] + 0.034, device.size[1]] as Point2 }
    : { point, size: [device.size[0], device.size[1]] as Point2 };
  const firstFootprint = footprint(firstId, first, firstPoint);
  const secondFootprint = footprint(secondId, second, secondPoint);
  return {
    x: (firstFootprint.size[0] + secondFootprint.size[0]) / 2 + WALL_DEVICE_SPACING_M -
      Math.abs(firstFootprint.point[0] - secondFootprint.point[0]),
    y: (firstFootprint.size[1] + secondFootprint.size[1]) / 2 + WALL_DEVICE_SPACING_M -
      Math.abs(firstFootprint.point[1] - secondFootprint.point[1]),
  };
}

function repairGenome(source: Genome) {
  const genome = cloneGenome(source);
  clampGenome(genome);
  for (let pass = 0; pass < 240; pass += 1) {
    let changed = false;
    WALL_DEVICE_IDS.forEach((firstId, firstIndex) => WALL_DEVICE_IDS.slice(firstIndex + 1).forEach((secondId) => {
      const firstPoint = genome.wall[firstId];
      const secondPoint = genome.wall[secondId];
      const intrusion = overlap(
        firstId,
        baseSpecification.devices[firstId],
        firstPoint,
        secondId,
        baseSpecification.devices[secondId],
        secondPoint,
      );
      if (intrusion.x <= 0 || intrusion.y <= 0) return;
      changed = true;
      const firstLockedY = firstId === "ekran";
      const secondLockedY = secondId === "ekran";
      const useHorizontal = intrusion.x <= intrusion.y || firstLockedY || secondLockedY;
      const axis = useHorizontal ? 0 : 1;
      const amount = (useHorizontal ? intrusion.x : intrusion.y) + 0.001;
      const direction = firstPoint[axis] <= secondPoint[axis] ? 1 : -1;
      if (axis === 1 && firstLockedY) secondPoint[axis] += direction * amount;
      else if (axis === 1 && secondLockedY) firstPoint[axis] -= direction * amount;
      else {
        firstPoint[axis] -= direction * amount / 2;
        secondPoint[axis] += direction * amount / 2;
      }
      clampGenome(genome);
    }));
    const junctionPoint = genome.wall.junction;
    const junction = baseSpecification.devices.junction;
    const corridorLeft = junctionPoint[0] - junction.size[0] / 2 - BOARD_EDGE_CLEARANCE_M;
    const corridorRight = junctionPoint[0] + junction.size[0] / 2 + BOARD_EDGE_CLEARANCE_M;
    const corridorTop = junctionPoint[1] - junction.size[1] / 2 - BOARD_EDGE_CLEARANCE_M;
    WALL_DEVICE_IDS.filter((id) => id !== "junction").forEach((id) => {
      const point = genome.wall[id];
      const device = baseSpecification.devices[id];
      const deviceLeft = point[0] - device.size[0] / 2;
      const deviceRight = point[0] + device.size[0] / 2;
      const deviceBottom = point[1] - device.size[1] / 2;
      const deviceTop = point[1] + device.size[1] / 2;
      const blocksCorridor = deviceRight > corridorLeft && deviceLeft < corridorRight &&
        deviceTop > 0.24 && deviceBottom < corridorTop;
      if (!blocksCorridor) return;
      const leftCandidate = corridorLeft - device.size[0] / 2 - 0.001;
      const rightCandidate = corridorRight + device.size[0] / 2 + 0.001;
      const limit = bounds[id];
      const candidates = [leftCandidate, rightCandidate]
        .filter((x) => x >= limit.minimumX && x <= limit.maximumX)
        .sort((first, second) => Math.abs(first - point[0]) - Math.abs(second - point[0]));
      if (candidates.length > 0) {
        point[0] = candidates[0];
        changed = true;
      }
    });
    clampGenome(genome);
    if (!changed) break;
  }
  return genome;
}

function heuristicGenome(): Genome {
  return repairGenome({
    batteryAnchor: [1.48, -1.8],
    indoorLight: [2.9, 2.72],
    outdoorFlood: [3.1, 2.55],
    starlink: [3.08, 3.36],
    wall: {
      pvEntry: [1.43, 0.48],
      smartSolar: [1.78, 0.5],
      multiPlus: [2.02, 1.82],
      acBoard: [2.38, 1.7],
      junction: [2.45, 1.25],
      ekran: [2.75, EKRANO_EYE_LEVEL_M],
      unifi: [2.98, 1.68],
      usb: [2.98, 1.48],
      balancerA: [2, 0.78],
      balancerB: [2.18, 0.78],
      batteryBreakerBox: [1.58, 0.78],
      earthBar: [2.25, 1.08],
    },
  });
}

function genomeFromSpecification(specification: PhysicalLayoutSpecification): Genome {
  return repairGenome({
    batteryAnchor: [specification.devices.battery1.position[0], specification.devices.battery1.position[2]],
    indoorLight: specification.devices.indoorLight.position.slice(0, 2) as Point2,
    outdoorFlood: specification.devices.outdoorFlood.position.slice(0, 2) as Point2,
    starlink: specification.devices.starlink.position.slice(0, 2) as Point2,
    wall: Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, specification.devices[id].position.slice(0, 2)])),
  });
}

function overridesForGenome(genome: Genome) {
  const [batteryX, batteryZ] = genome.batteryAnchor;
  return {
    ...Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, {
      position: [genome.wall[id][0], genome.wall[id][1], wallZ[id]] as LayoutVector,
    }])),
    battery1: { position: [batteryX, 0.11, batteryZ] as LayoutVector },
    battery2: { position: [batteryX + BATTERY_COLUMN_SPACING_M, 0.11, batteryZ] as LayoutVector },
    battery3: { position: [batteryX, 0.11, batteryZ + BATTERY_ROW_SPACING_M] as LayoutVector },
    battery4: { position: [batteryX + BATTERY_COLUMN_SPACING_M, 0.11, batteryZ + BATTERY_ROW_SPACING_M] as LayoutVector },
    indoorLight: { position: [genome.indoorLight[0], genome.indoorLight[1], -0.72] as LayoutVector },
    outdoorFlood: { position: [genome.outdoorFlood[0], genome.outdoorFlood[1], -2.03] as LayoutVector },
    starlink: { position: [genome.starlink[0], genome.starlink[1], -2.04] as LayoutVector },
  };
}

function routeForwardExcursion(points: LayoutVector[]) {
  const endpointForward = Math.max(points[0][2], points.at(-1)![2]);
  return Math.max(0, Math.max(...points.map((point) => point[2])) - endpointForward);
}

const invalidMetrics = (): LayoutMetrics => ({
  batteryForwardExcursionM: 99,
  cableClearanceIssueCount: 999,
  deviceFrontCrossingCount: 999,
  forwardExcursionM: 999,
  junctionBackRouteCount: 999,
  junctionEgressTurnCount: 999,
  maximumForwardExcursionM: 99,
  planarDirectionReversals: 999,
  portApproachIssueCount: 999,
  projectedCableConflictCount: 999,
  score: Number.MAX_SAFE_INTEGER,
  automaticRouteExcessLengthM: 999,
  automaticRouteLengthM: 999,
  automaticRouteTurnCount: 999,
  thickCableLengthM: 999,
  totalRenderedCableM: 999,
  unfusedBatteryPositiveLengthM: 999,
  wallDistanceCostM2: 999,
  wallBoundingAreaM2: 999,
  wallDeviceSpanM: 999,
  wallVerticalSpanM: 999,
  wallMeanXM: 999,
  wallRightEdgeM: 999,
  wallOverlapCount: 999,
  weightedCableLengthM: 999,
});

function evaluate(genome: Genome, includeSpecification = false): Evaluation {
  let specification: PhysicalLayoutSpecification;
  try {
    specification = solvePhysicalLayout({
      deviceOverrides: overridesForGenome(genome),
      routingEffort: includeSpecification ? "full" : "optimization",
    });
  } catch {
    return { genome, metrics: invalidMetrics() };
  }
  const automaticRoutes = Object.values(specification.routes).filter((route) => (
    route.routing === "automatic-rectilinear"
  ));
  const excursions = automaticRoutes.map((route) => ({
    id: route.id,
    value: routeForwardExcursion(route.points),
  }));
  const batteryForwardExcursionM = Math.max(
    0,
    ...excursions.filter((route) => BATTERY_ROUTE_IDS.has(route.id)).map((route) => route.value),
  );
  const forwardExcursionM = excursions.reduce((sum, route) => sum + route.value, 0);
  const maximumForwardExcursionM = Math.max(0, ...excursions.map((route) => route.value));
  const wallDevices = WALL_DEVICE_IDS.map((id) => specification.devices[id]);
  const wallRightEdgeM = Math.max(...wallDevices.map((device) => (
    device.position[0] + device.size[0] / 2
  )));
  const wallLeftEdgeM = Math.min(...wallDevices.map((device) => (
    device.position[0] - device.size[0] / 2
  )));
  const wallTopEdgeM = Math.max(...wallDevices.map((device) => (
    device.position[1] + device.size[1] / 2
  )));
  const wallBottomEdgeM = Math.min(...wallDevices.map((device) => (
    device.position[1] - device.size[1] / 2
  )));
  const wallVerticalSpanM = wallTopEdgeM - wallBottomEdgeM;
  const wallBoundingAreaM2 = (wallRightEdgeM - wallLeftEdgeM) * wallVerticalSpanM;
  const wallMeanXM = wallDevices.reduce((sum, device) => sum + device.position[0], 0) / wallDevices.length;
  const unfusedBatteryPositiveLengthM = ["battery-a-to-breaker", "battery-b-to-breaker"]
    .reduce((sum, id) => sum + (specification.routes[id]?.lengthM ?? 0), 0);
  const hardViolation =
    specification.metrics.wallOverlapCount * 1_000_000_000_000_000 +
    specification.metrics.deviceFrontCrossingCount * 100_000_000_000_000 +
    specification.metrics.junctionBackRouteCount * 100_000_000_000_000 +
    specification.metrics.portApproachIssueCount * 100_000_000_000_000 +
    Math.max(0, batteryForwardExcursionM - 0.08) * 100_000_000_000 +
    Math.max(0, maximumForwardExcursionM - 0.28) * 10_000_000_000;
  const score = hardViolation +
    specification.metrics.cableClearanceIssueCount * 2_000_000_000 +
    specification.metrics.projectedCableConflictCount * 30_000_000 +
    specification.metrics.weightedCableLengthM * 12_000 +
    specification.metrics.wallDistanceCostM2 * 80_000 +
    unfusedBatteryPositiveLengthM * 24_000 +
    specification.metrics.automaticRouteLengthM * 1_000 +
    specification.metrics.automaticRouteExcessLengthM * 8_000 +
    specification.metrics.automaticRouteTurnCount * 900 +
    specification.metrics.junctionEgressTurnCount * 650 +
    forwardExcursionM * 3_000 +
    maximumForwardExcursionM * 1_500 +
    specification.metrics.wallDeviceSpanM * 500 +
    wallVerticalSpanM * 350 +
    wallBoundingAreaM2 * 1_200 +
    wallRightEdgeM * 2_000 +
    wallMeanXM * 1_000 +
    specification.metrics.planarDirectionReversals * 10;
  const metrics: LayoutMetrics = {
    batteryForwardExcursionM: round(batteryForwardExcursionM),
    cableClearanceIssueCount: specification.metrics.cableClearanceIssueCount,
    deviceFrontCrossingCount: specification.metrics.deviceFrontCrossingCount,
    forwardExcursionM: round(forwardExcursionM),
    junctionBackRouteCount: specification.metrics.junctionBackRouteCount,
    junctionEgressTurnCount: specification.metrics.junctionEgressTurnCount,
    maximumForwardExcursionM: round(maximumForwardExcursionM),
    planarDirectionReversals: specification.metrics.planarDirectionReversals,
    portApproachIssueCount: specification.metrics.portApproachIssueCount,
    projectedCableConflictCount: specification.metrics.projectedCableConflictCount,
    score: round(score),
    automaticRouteExcessLengthM: specification.metrics.automaticRouteExcessLengthM,
    automaticRouteLengthM: specification.metrics.automaticRouteLengthM,
    automaticRouteTurnCount: specification.metrics.automaticRouteTurnCount,
    thickCableLengthM: specification.metrics.thickCableLengthM,
    totalRenderedCableM: specification.metrics.totalRenderedCableM,
    unfusedBatteryPositiveLengthM: round(unfusedBatteryPositiveLengthM),
    wallDistanceCostM2: specification.metrics.wallDistanceCostM2,
    wallBoundingAreaM2: round(wallBoundingAreaM2),
    wallDeviceSpanM: specification.metrics.wallDeviceSpanM,
    wallVerticalSpanM: round(wallVerticalSpanM),
    wallMeanXM: round(wallMeanXM),
    wallRightEdgeM: round(wallRightEdgeM),
    wallOverlapCount: specification.metrics.wallOverlapCount,
    weightedCableLengthM: specification.metrics.weightedCableLengthM,
  };
  return { genome, metrics, ...(includeSpecification ? { specification } : {}) };
}

function crossover(first: Genome, second: Genome, random: Random) {
  const blendPoint = (left: Point2, right: Point2): Point2 => {
    const blend = random.next();
    return [
      left[0] * blend + right[0] * (1 - blend),
      random.next() < 0.5 ? left[1] : right[1],
    ];
  };
  return repairGenome({
    batteryAnchor: blendPoint(first.batteryAnchor, second.batteryAnchor),
    indoorLight: blendPoint(first.indoorLight, second.indoorLight),
    outdoorFlood: blendPoint(first.outdoorFlood, second.outdoorFlood),
    starlink: blendPoint(first.starlink, second.starlink),
    wall: Object.fromEntries(WALL_DEVICE_IDS.map((id) => [id, blendPoint(first.wall[id], second.wall[id])])),
  });
}

function mutate(source: Genome, random: Random, scale = 1) {
  const genome = cloneGenome(source);
  WALL_DEVICE_IDS.forEach((id) => {
    if (random.next() < 0.42) genome.wall[id][0] += random.gaussian() * 0.12 * scale;
    if (id !== "ekran" && random.next() < 0.42) genome.wall[id][1] += random.gaussian() * 0.11 * scale;
    if (random.next() < 0.025 * scale) {
      const limit = bounds[id];
      genome.wall[id] = [
        limit.minimumX + random.next() * (limit.maximumX - limit.minimumX),
        limit.minimumY + random.next() * (limit.maximumY - limit.minimumY),
      ];
    }
  });
  if (random.next() < 0.3) genome.batteryAnchor[0] += random.gaussian() * 0.025 * scale;
  if (random.next() < 0.3) genome.batteryAnchor[1] += random.gaussian() * 0.04 * scale;
  if (random.next() < 0.35) genome.indoorLight[0] += random.gaussian() * 0.1 * scale;
  if (random.next() < 0.2) genome.indoorLight[1] += random.gaussian() * 0.04 * scale;
  if (random.next() < 0.35) genome.outdoorFlood[0] += random.gaussian() * 0.1 * scale;
  if (random.next() < 0.2) genome.outdoorFlood[1] += random.gaussian() * 0.05 * scale;
  if (random.next() < 0.38) genome.starlink[0] += random.gaussian() * 0.13 * scale;
  if (random.next() < 0.14) genome.starlink[1] += random.gaussian() * 0.025 * scale;
  return repairGenome(genome);
}

function tournament(population: Evaluation[], random: Random) {
  const candidates = Array.from({ length: 3 }, () => population[random.integer(population.length)]);
  return candidates.sort((first, second) => first.metrics.score - second.metrics.score)[0];
}

function readResumeGenome() {
  if (!resumePath) return undefined;
  const document = JSON.parse(fs.readFileSync(path.resolve(resumePath), "utf8")) as { bestGenome?: Partial<Genome> };
  if (!document.bestGenome) return undefined;
  // Older saved genomes predate movable Starlink placement. Upgrade them
  // deterministically from the frozen specification so a schema addition does
  // not make a completed ten-minute run unusable as a warm start.
  const source = document.bestGenome;
  const upgraded: Genome = {
    batteryAnchor: [...(source.batteryAnchor ?? [1.55, -1.75])],
    indoorLight: [...(source.indoorLight ?? [baseSpecification.devices.indoorLight.position[0], baseSpecification.devices.indoorLight.position[1]])],
    outdoorFlood: [...(source.outdoorFlood ?? [baseSpecification.devices.outdoorFlood.position[0], baseSpecification.devices.outdoorFlood.position[1]])],
    starlink: [...(source.starlink ?? [baseSpecification.devices.starlink.position[0], baseSpecification.devices.starlink.position[1]])],
    wall: Object.fromEntries(WALL_DEVICE_IDS.map((id) => [
      id,
      [...(source.wall?.[id] ?? [baseSpecification.devices[id].position[0], baseSpecification.devices[id].position[1]])],
    ])),
  };
  return repairGenome(upgraded);
}

function routeDepthsFor(specification: PhysicalLayoutSpecification) {
  return Object.fromEntries(Object.values(specification.routes)
    .filter((route) => route.routing === "automatic-rectilinear")
    .map((route) => [route.id, {
      forwardExcursionM: round(routeForwardExcursion(route.points)),
      lengthM: route.lengthM,
      maximumZ: round(Math.max(...route.points.map((point) => point[2]))),
    }]));
}

const random = new Random(seed);
const heuristic = heuristicGenome();
const constrainedCurrent = genomeFromSpecification(baseSpecification);
const resumed = readResumeGenome();

if (finalizeOnly) {
  const sourcePath = path.resolve(resumePath ?? outputPath);
  const existing = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as Record<string, unknown> & {
    bestGenome?: Genome;
  };
  if (!existing.bestGenome) throw new Error(`No bestGenome found in ${sourcePath}`);
  const finalizedBaseline = evaluate(heuristic);
  const finalized = evaluate(repairGenome(existing.bestGenome), true);
  if (!finalized.specification) throw new Error("The saved physical layout could not be regenerated");
  const finalizedImprovementPercent = round(
    (finalizedBaseline.metrics.score - finalized.metrics.score) /
      finalizedBaseline.metrics.score * 100,
    2,
  );
  const updated = {
    ...existing,
    status: "evolutionary-optimized-finalized",
    finalizedAt: new Date().toISOString(),
    baseline: finalizedBaseline.metrics,
    bestMetrics: finalized.metrics,
    improvementPercent: finalizedImprovementPercent,
    bestGenome: finalized.genome,
    runtime: {
      deviceOverrides: overridesForGenome(finalized.genome),
      metrics: finalized.specification.metrics,
      routeDepths: routeDepthsFor(finalized.specification),
      specification: finalized.specification,
    },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(updated, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    preservedEvaluations: existing.evaluations,
    preservedTimeBudgetSeconds: existing.requestedTimeBudgetSeconds,
    improvementPercent: finalizedImprovementPercent,
    metrics: finalized.metrics,
  }, null, 2)}\n`);
  process.exit(0);
}

const initialGenomes: Genome[] = [heuristic, constrainedCurrent, ...(resumed ? [resumed] : [])];
while (initialGenomes.length < populationSize) {
  initialGenomes.push(mutate(heuristic, random, 0.65 + random.next() * 1.5));
}

const startedAt = new Date();
const started = performance.now();
const deadline = started + requestedSeconds * 1000;
let evaluations = 0;
let generation = 0;
let stagnation = 0;
let lastProgress = started;
let population = initialGenomes.map((genome) => {
  evaluations += 1;
  return evaluate(genome);
}).sort((first, second) => first.metrics.score - second.metrics.score);
let best = population[0];
const baseline = evaluate(heuristic);
const convergence = [{ elapsedSeconds: 0, evaluations, score: best.metrics.score }];

while (performance.now() < deadline) {
  generation += 1;
  const progress = (performance.now() - started) / Math.max(1, requestedSeconds * 1000);
  const mutationScale = Math.max(0.22, 1.15 - progress * 0.85);
  const nextGenomes = population.slice(0, eliteCount).map((candidate) => cloneGenome(candidate.genome));
  while (nextGenomes.length < populationSize && performance.now() < deadline) {
    const first = tournament(population, random).genome;
    const second = tournament(population, random).genome;
    nextGenomes.push(mutate(crossover(first, second, random), random, mutationScale));
  }
  if (nextGenomes.length === 0) break;
  const evaluatedNext: Evaluation[] = [];
  for (const genome of nextGenomes) {
    if (performance.now() >= deadline) break;
    evaluations += 1;
    evaluatedNext.push(evaluate(genome));
  }
  if (evaluatedNext.length === 0) break;
  population = [...population.slice(0, eliteCount), ...evaluatedNext]
    .sort((first, second) => first.metrics.score - second.metrics.score)
    .slice(0, populationSize);
  if (population[0].metrics.score + 0.0001 < best.metrics.score) {
    best = population[0];
    stagnation = 0;
  } else {
    stagnation += 1;
  }
  if (stagnation >= 18) {
    const restart = [cloneGenome(best.genome)];
    while (restart.length < populationSize) restart.push(mutate(best.genome, random, 1.8));
    const evaluatedRestart: Evaluation[] = [];
    for (const genome of restart) {
      if (performance.now() >= deadline) break;
      evaluations += 1;
      evaluatedRestart.push(evaluate(genome));
    }
    if (evaluatedRestart.length > 0) {
      population = [...population.slice(0, 1), ...evaluatedRestart]
        .sort((first, second) => first.metrics.score - second.metrics.score)
        .slice(0, populationSize);
    }
    if (population[0].metrics.score < best.metrics.score) best = population[0];
    stagnation = 0;
  }
  const now = performance.now();
  if (now - lastProgress >= 30_000) {
    convergence.push({
      elapsedSeconds: round((now - started) / 1000, 3),
      evaluations,
      score: best.metrics.score,
    });
    process.stderr.write(
      `${((now - started) / 1000).toFixed(1)}s · gen ${generation} · ${evaluations} eval · ` +
      `${best.metrics.totalRenderedCableM.toFixed(2)} m cable · ${best.metrics.forwardExcursionM.toFixed(3)} m forward sum · ` +
      `${best.metrics.batteryForwardExcursionM.toFixed(3)} m battery excursion · score ${best.metrics.score.toFixed(1)}\n`,
    );
    lastProgress = now;
  }
}

const searchElapsedSeconds = round((performance.now() - started) / 1000, 3);
convergence.push({ elapsedSeconds: searchElapsedSeconds, evaluations, score: best.metrics.score });
const finalizationStarted = performance.now();
const final = evaluate(best.genome, true);
if (!final.specification) throw new Error("The selected physical layout could not be regenerated");
const finalizationSeconds = round((performance.now() - finalizationStarted) / 1000, 3);
const totalProcessSeconds = round((performance.now() - started) / 1000, 3);
const improvementPercent = round((baseline.metrics.score - final.metrics.score) / baseline.metrics.score * 100, 2);
const routeDepths = routeDepthsFor(final.specification);
const document = {
  schemaVersion: 1,
  status: "evolutionary-optimized-finalized",
  generatedAt: new Date().toISOString(),
  algorithm: ALGORITHM,
  seed,
  requestedTimeBudgetSeconds: requestedSeconds,
  elapsedSeconds: searchElapsedSeconds,
  finalizationSeconds,
  totalProcessSeconds,
  populationSize,
  evaluations,
  generations: generation,
  startedAt: startedAt.toISOString(),
  constraints: {
    batteryArrangement: "floor-level 2x2; left column center X 1.48–1.62 m beside the array-side end of the building",
    indoorLight: "X 2.65–3.25 m; kept on the compact array-side half of the building",
    outdoorFlood: "X 2.80–3.40 m; kept on the compact array-side half of the building",
    ekranCenterHeightM: EKRANO_EYE_LEVEL_M,
    maximumWallEquipmentRightEdgeM: TARGET_WALL_RIGHT_EDGE_M,
    wallDeviceClearanceM: WALL_DEVICE_SPACING_M,
    boardEdgeClearanceM: BOARD_EDGE_CLEARANCE_M,
    routing: "all routes regenerated from device terminals for every candidate; battery harness solved independently from unrelated outdoor geometry",
  },
  objective: {
    priority: [
      "zero wall component overlaps",
      "zero cable centerlines or cable bodies routed across any device front",
      "every device connection uses an explicit cylindrical port and a straight approach aligned to its outward normal",
      "zero audited battery-harness cable conflicts",
      "zero cables behind the flush junction box",
      "floor-bank battery leads do not move more than 60 mm forward of their most-forward endpoint",
      "no automatic cable makes an excessive forward excursion",
      "thick cable length costs 2× thin cable length",
      "minimum integrated cable distance from the wall",
      "minimum unprotected battery-positive lead length to the dual 125 A breaker enclosure",
      "every cable turn adds cost",
      "compact wall span",
      "left-biased wall centroid and minimum absolute right edge",
      "few planar direction reversals",
    ],
  },
  baseline: baseline.metrics,
  bestMetrics: final.metrics,
  improvementPercent,
  bestGenome: final.genome,
  convergence,
  runtime: {
    deviceOverrides: overridesForGenome(final.genome),
    metrics: final.specification.metrics,
    routeDepths,
    specification: final.specification,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  output: outputPath,
  elapsedSeconds: searchElapsedSeconds,
  finalizationSeconds,
  totalProcessSeconds,
  evaluations,
  generations: generation,
  improvementPercent,
  metrics: final.metrics,
}, null, 2)}\n`);
