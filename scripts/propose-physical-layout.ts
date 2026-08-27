import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import runtimeJson from "../data/generated/dse-runtime.json";
import { dseTopology } from "../app/dseTopology";
import {
  buildSystemRuntime,
  sampledResolvedDeviceOverlaps,
  sampledRouteWallPlaneCrossings,
} from "../app/systemGraphRuntime";
import {
  EQUIPMENT_WALL_VOLUME,
  type Device,
  type GraphRuntimeArtifact,
  type ResolvedDevice,
  type SystemGraph,
  type Vec3,
} from "../app/systemGraph";
import {
  nonDominatedFronts,
  preservesSafetyFindings,
  rankCandidates,
  SeededRandom,
  uniqueCandidates,
  type OptimizerCandidate,
} from "./layout-optimizer-core";

type Point = readonly [number, number];
type Genome = readonly Point[];

type Assembly = {
  id: string;
  anchorId: string;
  memberIds: readonly string[];
  fixed: boolean;
  current: Point;
  domain: readonly Point[];
};

type Rectangle = {
  left: number;
  right: number;
  bottom: number;
  top: number;
  assemblyId: string;
};

type CoarseMetrics = {
  boundaryViolations: number;
  deviceOverlaps: number;
  nodeCrossings: number;
  routeOverlapM: number;
  crossings: number;
  turns: number;
  directLengthM: number;
  weightedLengthM: number;
  highCurrentLengthM: number;
  unprotectedBatteryPositiveM: number;
};

type Evaluated = OptimizerCandidate<Genome, CoarseMetrics>;

type Segment = {
  first: Point;
  second: Point;
};

const OPTIMIZER_VERSION = "r28-physical-layout-proposal-v1";
const COLUMNS = 20;
const ROWS = 10;
const GRID_STEP_M = 0.30;
const WALL_EDGE_MARGIN_M = 0.20;
const DEVICE_CLEARANCE_M = 0.04;
const MAX_HORIZONTAL_MOVE_M = 2.40;
const MAX_VERTICAL_MOVE_M = 1.20;
const HIGH_CURRENT_DIAMETER_MM = 14;
const EPSILON = 1e-9;
const DEFAULT_SEED = 20260828;
const DEFAULT_RESTARTS = 4;
const DEFAULT_GENERATIONS = 8;
const DEFAULT_EXACT_FINALISTS = 4;

const wallBounds = {
  left: EQUIPMENT_WALL_VOLUME.center[0] - EQUIPMENT_WALL_VOLUME.size[0] / 2,
  right: EQUIPMENT_WALL_VOLUME.center[0] + EQUIPMENT_WALL_VOLUME.size[0] / 2,
  bottom: EQUIPMENT_WALL_VOLUME.center[1] - EQUIPMENT_WALL_VOLUME.size[1] / 2,
  top: EQUIPMENT_WALL_VOLUME.center[1] + EQUIPMENT_WALL_VOLUME.size[1] / 2,
};

const gridOrigin: Point = [
  Number((Math.ceil((wallBounds.left + WALL_EDGE_MARGIN_M) / 0.02) * 0.02).toFixed(2)),
  Number((Math.ceil((wallBounds.bottom + WALL_EDGE_MARGIN_M) / 0.02) * 0.02).toFixed(2)),
];

const runtimeArtifact = runtimeJson as unknown as GraphRuntimeArtifact;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

async function runtimeSourceHash() {
  const hash = createHash("sha256");
  hash.update(`${runtimeArtifact.schemaVersion}:${runtimeArtifact.generatorVersion}\n`);
  const inputs = [
    "app/dseTopology.ts",
    "app/systemGraph.ts",
    "app/systemGraphRuntime.ts",
    "app/renderedCableGeometry.ts",
    "scripts/generate-runtime.ts",
  ];
  for (const relative of inputs) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const computedRuntimeSourceHash = await runtimeSourceHash();
if (computedRuntimeSourceHash !== runtimeArtifact.sourceHash) {
  throw new Error(
    `Runtime artifact ${runtimeArtifact.sourceHash.slice(0, 12)} is stale for source `
    + `${computedRuntimeSourceHash.slice(0, 12)}. Run npm run generate:runtime before proposing a layout.`,
  );
}
if (runtimeArtifact.graphId !== dseTopology.id || runtimeArtifact.graphRevision !== dseTopology.revision) {
  throw new Error("Runtime artifact graph identity does not match the canonical topology.");
}

const topologyDeviceById = new Map(dseTopology.devices.map((device) => [device.id, device]));
const runtimeDeviceById = new Map(runtimeArtifact.devices.map((device) => [device.id, device]));
const conductorByKey = new Map(runtimeArtifact.conductors.map((conductor) => [conductor.key, conductor]));
const cableById = new Map(dseTopology.cables.map((cable) => [cable.id, cable]));

const endpointDeviceId = (endpoint: string) => endpoint.slice(0, endpoint.indexOf("."));

class DisjointSet {
  private readonly parent = new Map<string, string>();

  constructor(ids: readonly string[]) {
    ids.forEach((id) => this.parent.set(id, id));
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent) throw new Error(`Unknown assembly member ${id}.`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(first: string, second: string) {
    if (!this.parent.has(first) || !this.parent.has(second)) return;
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);
    if (firstRoot === secondRoot) return;
    const [root, child] = [firstRoot, secondRoot].toSorted();
    this.parent.set(child, root);
  }
}

const wallDeviceIds = dseTopology.devices.filter((device) => (
  device.placement.space === "world" && device.placement.surface === "wall"
)).map((device) => device.id);
const wallDeviceIdSet = new Set(wallDeviceIds);
const disjoint = new DisjointSet(wallDeviceIds);

// Bodyless attachments always follow their owning physical landing.
dseTopology.devices.forEach((device) => {
  if (!device.attachment || !wallDeviceIdSet.has(device.id)) return;
  disjoint.union(device.id, endpointDeviceId(device.attachment.endpoint));
});

// A declared layout family is a rigid ordered assembly during macro search.
const layoutFamilies = Map.groupBy(
  dseTopology.devices.filter((device) => wallDeviceIdSet.has(device.id) && device.layoutGroup),
  (device) => device.layoutGroup!.id,
);
layoutFamilies.forEach((members) => {
  const ordered = members.toSorted((first, second) => (
    first.layoutGroup!.order - second.layoutGroup!.order || first.id.localeCompare(second.id)
  ));
  ordered.slice(1).forEach((member) => disjoint.union(ordered[0].id, member.id));
});

// Directly mated plugs and receptacles are one physical assembly. This is
// inferred from terminal semantics and a multicore mating lead, not device IDs.
const conductorByEndpoint = new Map<string, Device["conductors"][number]>(dseTopology.devices.flatMap((device) => (
  device.conductors.map((conductor) => [`${device.id}.${conductor.id}`, conductor] as const)
)));
const matingTerminal = /(plug|socket|receptacle|mates directly)/i;
dseTopology.connections.forEach((connection) => {
  const first = conductorByEndpoint.get(connection.from);
  const second = conductorByEndpoint.get(connection.to);
  const cable = cableById.get(connection.cableId);
  if (!first || !second || !cable || cable.cores < 2 || connection.kind !== "multicore") return;
  const firstText = `${first.terminal ?? ""} ${first.terminalSize ?? ""} ${first.termination ?? ""}`;
  const secondText = `${second.terminal ?? ""} ${second.terminalSize ?? ""} ${second.termination ?? ""}`;
  if (matingTerminal.test(firstText) && matingTerminal.test(secondText)) {
    disjoint.union(endpointDeviceId(connection.from), endpointDeviceId(connection.to));
  }
});

// These two assemblies encode verified/user-directed geometry that must not
// become independent genes. They are also frozen below.
const explicitRigidAssemblies = [
  ["multiPlus", "multiAcInBreakout", "multiAcOutBreakout"],
  ["balancerA", "balancerB"],
] as const;
explicitRigidAssemblies.forEach(([anchor, ...members]) => {
  members.forEach((member) => disjoint.union(anchor, member));
});

const explicitlyFixedIds = new Set([
  "servicePenetration",
  "batteryCutoffJunction",
  "mainPositiveBus",
  "mainNegativeBus",
  "smartShunt",
  "balancerA",
  "balancerB",
  "multiPlus",
  "multiAcInBreakout",
  "multiAcOutBreakout",
]);
dseTopology.devices.filter((device) => device.kind === "battery").forEach((device) => (
  explicitlyFixedIds.add(device.id)
));

const rawAssemblyMembers = Map.groupBy(wallDeviceIds, (id) => disjoint.find(id));

const currentPosition = (deviceId: string): Point => {
  const device = runtimeDeviceById.get(deviceId);
  if (!device) throw new Error(`Runtime artifact is missing device ${deviceId}.`);
  return [device.position[0], device.position[1]];
};

const rotatedHalfExtents = (device: ResolvedDevice): Point => {
  const angle = device.rotation[2];
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  return [
    (device.size[0] * cosine + device.size[1] * sine) / 2,
    (device.size[0] * sine + device.size[1] * cosine) / 2,
  ];
};

const assemblyRectanglesAt = (
  memberIds: readonly string[],
  anchorCurrent: Point,
  anchorTarget: Point,
  assemblyId: string,
): Rectangle[] => {
  const delta: Point = [anchorTarget[0] - anchorCurrent[0], anchorTarget[1] - anchorCurrent[1]];
  return memberIds.flatMap((id) => {
    const device = runtimeDeviceById.get(id);
    if (!device) throw new Error(`Runtime artifact is missing device ${id}.`);
    if (device.presentation === "wire-join") return [];
    const [halfWidth, halfHeight] = rotatedHalfExtents(device);
    const x = device.position[0] + delta[0];
    const y = device.position[1] + delta[1];
    return [{
      left: x - halfWidth,
      right: x + halfWidth,
      bottom: y - halfHeight,
      top: y + halfHeight,
      assemblyId,
    }];
  });
};

const insideWall = (rectangle: Rectangle) => (
  rectangle.left >= wallBounds.left + EPSILON
  && rectangle.right <= wallBounds.right - EPSILON
  && rectangle.bottom >= wallBounds.bottom + EPSILON
  && rectangle.top <= wallBounds.top - EPSILON
);

const gridPoints = Array.from({ length: COLUMNS * ROWS }, (_, slot): Point => [
  Number((gridOrigin[0] + (slot % COLUMNS) * GRID_STEP_M).toFixed(2)),
  Number((gridOrigin[1] + Math.floor(slot / COLUMNS) * GRID_STEP_M).toFixed(2)),
]);

const anchorPriority = (member: Device) => {
  if (member.id === "multiPlus" || member.id === "balancerA") return -3;
  if (member.layoutGroup) return -2 + member.layoutGroup.order / 1000;
  if (member.kind === "junction") return -1;
  return 0;
};

const assemblies: readonly Assembly[] = [...rawAssemblyMembers.values()].map((memberIds) => {
  const orderedMembers = memberIds.map((id) => topologyDeviceById.get(id)!)
    .toSorted((first, second) => anchorPriority(first) - anchorPriority(second) || first.id.localeCompare(second.id));
  const anchorId = orderedMembers[0].id;
  const current = currentPosition(anchorId);
  const fixed = memberIds.some((id) => explicitlyFixedIds.has(id));
  const family = orderedMembers.find((device) => device.layoutGroup)?.layoutGroup;
  const id = family ? `family:${family.id}` : memberIds.length > 1 ? `assembly:${anchorId}` : anchorId;
  const domain = fixed ? [current] : [
    current,
    ...gridPoints.filter((point) => (
      Math.abs(point[0] - current[0]) <= MAX_HORIZONTAL_MOVE_M + EPSILON
      && Math.abs(point[1] - current[1]) <= MAX_VERTICAL_MOVE_M + EPSILON
      && assemblyRectanglesAt(memberIds, current, point, id).every(insideWall)
    )),
  ].filter((point, index, source) => source.findIndex((other) => (
    other[0] === point[0] && other[1] === point[1]
  )) === index);
  if (domain.length === 0) throw new Error(`Assembly ${id} has no legal placement domain.`);
  return { id, anchorId, memberIds: [...memberIds].toSorted(), fixed, current, domain };
}).toSorted((first, second) => first.id.localeCompare(second.id));

const directAssemblyByDevice = new Map(assemblies.flatMap((assembly) => (
  assembly.memberIds.map((id) => [id, assembly.id] as const)
)));

function assemblyForDevice(deviceId: string, visited = new Set<string>()): string | undefined {
  if (visited.has(deviceId)) return undefined;
  const direct = directAssemblyByDevice.get(deviceId);
  if (direct) return direct;
  const device = topologyDeviceById.get(deviceId);
  if (!device) return undefined;
  const nextVisited = new Set(visited);
  nextVisited.add(deviceId);
  if (device.attachment) return assemblyForDevice(endpointDeviceId(device.attachment.endpoint), nextVisited);
  if (device.placement.space === "junction") return assemblyForDevice(device.placement.junctionId, nextVisited);
  return undefined;
}

const currentGenome = (): Genome => assemblies.map((assembly) => assembly.current);
const pointDistance = (first: Point, second: Point) => (
  Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1])
);

const rectanglesOverlap = (first: Rectangle, second: Rectangle) => (
  first.left < second.right + DEVICE_CLEARANCE_M - EPSILON
  && first.right + DEVICE_CLEARANCE_M > second.left + EPSILON
  && first.bottom < second.top + DEVICE_CLEARANCE_M - EPSILON
  && first.top + DEVICE_CLEARANCE_M > second.bottom + EPSILON
);

const rectanglesFor = (assembly: Assembly, target: Point) => (
  assemblyRectanglesAt(assembly.memberIds, assembly.current, target, assembly.id)
);

function repair(source: Genome, random?: SeededRandom): Genome {
  const genome = source.map((point) => [...point] as Point);
  assemblies.forEach((assembly, index) => {
    if (assembly.fixed) genome[index] = assembly.current;
  });
  const ordered = assemblies.map((assembly, index) => ({ assembly, index }))
    .filter(({ assembly }) => !assembly.fixed)
    .toSorted((first, second) => {
      const firstArea = rectanglesFor(first.assembly, first.assembly.current)
        .reduce((sum, rectangle) => sum + (rectangle.right - rectangle.left) * (rectangle.top - rectangle.bottom), 0);
      const secondArea = rectanglesFor(second.assembly, second.assembly.current)
        .reduce((sum, rectangle) => sum + (rectangle.right - rectangle.left) * (rectangle.top - rectangle.bottom), 0);
      return secondArea - firstArea || first.assembly.id.localeCompare(second.assembly.id);
    });
  const placed = new Set(assemblies.map((assembly, index) => assembly.fixed ? index : -1).filter((index) => index >= 0));
  ordered.forEach(({ assembly, index }) => {
    const desired = genome[index];
    let candidates = assembly.domain.toSorted((first, second) => (
      pointDistance(first, desired) - pointDistance(second, desired)
      || first[1] - second[1]
      || first[0] - second[0]
    ));
    if (random) {
      const near = candidates.slice(0, Math.min(12, candidates.length));
      candidates = [...random.shuffle(near), ...candidates.slice(near.length)];
    }
    const selected = candidates.find((point) => {
      const rectangles = rectanglesFor(assembly, point);
      return rectangles.every(insideWall) && [...placed].every((otherIndex) => (
        rectangles.every((rectangle) => rectanglesFor(assemblies[otherIndex], genome[otherIndex])
          .every((other) => !rectanglesOverlap(rectangle, other)))
      ));
    });
    genome[index] = selected ?? assembly.current;
    placed.add(index);
  });
  return genome;
}

function randomGenome(random: SeededRandom): Genome {
  return repair(assemblies.map((assembly) => (
    assembly.fixed ? assembly.current : assembly.domain[random.integer(assembly.domain.length)]
  )), random);
}

function mutate(source: Genome, random: SeededRandom, generation: number, child: number): Genome {
  const genome = source.map((point) => [...point] as Point);
  const movableIndexes = assemblies.map((assembly, index) => assembly.fixed ? -1 : index).filter((index) => index >= 0);
  const coolingRadius = Math.max(0.60, 1.80 - generation * 0.12);
  const moveCount = child <= 3 ? child : 1 + random.integer(Math.max(2, 5 - Math.floor(generation / 3)));
  for (let move = 0; move < moveCount; move += 1) {
    const index = movableIndexes[random.integer(movableIndexes.length)];
    const assembly = assemblies[index];
    const nearby = assembly.domain.filter((point) => pointDistance(point, genome[index]) <= coolingRadius + EPSILON);
    genome[index] = nearby[random.integer(nearby.length)];
  }
  return repair(genome);
}

function placementViolations(genome: Genome) {
  const rectangles = assemblies.flatMap((assembly, index) => rectanglesFor(assembly, genome[index]));
  const boundaryViolations = rectangles.filter((rectangle) => !insideWall(rectangle)).length;
  let deviceOverlaps = 0;
  for (let first = 0; first < rectangles.length; first += 1) {
    for (let second = first + 1; second < rectangles.length; second += 1) {
      if (rectangles[first].assemblyId === rectangles[second].assemblyId) continue;
      if (rectanglesOverlap(rectangles[first], rectangles[second])) deviceOverlaps += 1;
    }
  }
  return { boundaryViolations, deviceOverlaps, rectangles };
}

const segmentList = (points: readonly Point[]): Segment[] => points.slice(1).flatMap((point, index) => (
  point[0] === points[index][0] && point[1] === points[index][1]
    ? [] : [{ first: points[index], second: point }]
));

const strictlyBetween = (value: number, first: number, second: number) => (
  value > Math.min(first, second) + EPSILON && value < Math.max(first, second) - EPSILON
);

function segmentRelationship(first: Segment, second: Segment) {
  const firstHorizontal = Math.abs(first.first[1] - first.second[1]) <= EPSILON;
  const secondHorizontal = Math.abs(second.first[1] - second.second[1]) <= EPSILON;
  if (firstHorizontal === secondHorizontal) {
    const sameLine = firstHorizontal
      ? Math.abs(first.first[1] - second.first[1]) <= EPSILON
      : Math.abs(first.first[0] - second.first[0]) <= EPSILON;
    if (!sameLine) return { overlap: 0, crossing: 0 };
    const axis = firstHorizontal ? 0 : 1;
    return {
      overlap: Math.max(0,
        Math.min(Math.max(first.first[axis], first.second[axis]), Math.max(second.first[axis], second.second[axis]))
        - Math.max(Math.min(first.first[axis], first.second[axis]), Math.min(second.first[axis], second.second[axis]))),
      crossing: 0,
    };
  }
  const horizontal = firstHorizontal ? first : second;
  const vertical = firstHorizontal ? second : first;
  return {
    overlap: 0,
    crossing: strictlyBetween(vertical.first[0], horizontal.first[0], horizontal.second[0])
      && strictlyBetween(horizontal.first[1], vertical.first[1], vertical.second[1]) ? 1 : 0,
  };
}

function segmentHitsRectangle(segment: Segment, rectangle: Rectangle) {
  if (Math.abs(segment.first[0] - segment.second[0]) <= EPSILON) {
    return segment.first[0] > rectangle.left + EPSILON && segment.first[0] < rectangle.right - EPSILON
      && Math.max(segment.first[1], segment.second[1]) > rectangle.bottom + EPSILON
      && Math.min(segment.first[1], segment.second[1]) < rectangle.top - EPSILON;
  }
  return segment.first[1] > rectangle.bottom + EPSILON && segment.first[1] < rectangle.top - EPSILON
    && Math.max(segment.first[0], segment.second[0]) > rectangle.left + EPSILON
    && Math.min(segment.first[0], segment.second[0]) < rectangle.right - EPSILON;
}

function attachedPhysicalRoot(deviceId: string, visited = new Set<string>()): Device | undefined {
  if (visited.has(deviceId)) return undefined;
  const device = topologyDeviceById.get(deviceId);
  if (!device?.attachment) return device;
  const nextVisited = new Set(visited);
  nextVisited.add(deviceId);
  return attachedPhysicalRoot(endpointDeviceId(device.attachment.endpoint), nextVisited);
}

const unprotectedBatteryPositiveIds = new Set(dseTopology.connections.filter((connection) => {
  if (connection.kind !== "positive") return false;
  const first = attachedPhysicalRoot(endpointDeviceId(connection.from));
  const second = attachedPhysicalRoot(endpointDeviceId(connection.to));
  const firstBattery = first?.kind === "battery";
  const secondBattery = second?.kind === "battery";
  if (!firstBattery && !secondBattery) return false;
  const peer = firstBattery ? second : first;
  return Boolean(connection.sourceLeadReason)
    || peer?.kind === "breaker"
    || peer?.kind === "protection";
}).map((connection) => connection.id));

function evaluateRaw(genome: Genome): CoarseMetrics {
  const { boundaryViolations, deviceOverlaps, rectangles } = placementViolations(genome);
  const deltaByAssembly = new Map(assemblies.map((assembly, index) => [assembly.id, [
    genome[index][0] - assembly.current[0],
    genome[index][1] - assembly.current[1],
  ] as Point]));
  const translated = (endpoint: string): Vec3 => {
    const conductor = conductorByKey.get(endpoint);
    if (!conductor) throw new Error(`Runtime artifact is missing conductor ${endpoint}.`);
    const assemblyId = assemblyForDevice(conductor.deviceId);
    const delta = assemblyId ? deltaByAssembly.get(assemblyId) ?? [0, 0] : [0, 0];
    return [conductor.position[0] + delta[0], conductor.position[1] + delta[1], conductor.position[2]];
  };
  let directLengthM = 0;
  let weightedLengthM = 0;
  let highCurrentLengthM = 0;
  let unprotectedBatteryPositiveM = 0;
  let turns = 0;
  runtimeArtifact.routes.forEach((route) => {
    const from = translated(route.from);
    const to = translated(route.to);
    const differences = from.map((value, axis) => Math.abs(value - to[axis]));
    const length = differences.reduce((sum, value) => sum + value, 0);
    directLengthM += length;
    weightedLengthM += length * Math.max(1, route.diameterMm / 5);
    if (route.diameterMm >= HIGH_CURRENT_DIAMETER_MM) highCurrentLengthM += length;
    if (unprotectedBatteryPositiveIds.has(route.id)) unprotectedBatteryPositiveM += length;
    turns += Math.max(0, differences.filter((value) => value > EPSILON).length - 1);
  });

  const routedSegments: Segment[] = [];
  let nodeCrossings = 0;
  let routeOverlapM = 0;
  let crossings = 0;
  runtimeArtifact.routes.toSorted((first, second) => (
    second.diameterMm - first.diameterMm || first.id.localeCompare(second.id)
  )).forEach((route) => {
    const fromAssembly = assemblyForDevice(endpointDeviceId(route.from));
    const toAssembly = assemblyForDevice(endpointDeviceId(route.to));
    if (!fromAssembly || !toAssembly || fromAssembly === toAssembly) return;
    const from3 = translated(route.from);
    const to3 = translated(route.to);
    const from: Point = [from3[0], from3[1]];
    const to: Point = [to3[0], to3[1]];
    const candidates = [
      [from, [to[0], from[1]] as Point, to],
      [from, [from[0], to[1]] as Point, to],
    ].map((points) => {
      const candidateSegments = segmentList(points);
      const hits = candidateSegments.reduce((sum, segment) => sum + rectangles.filter((rectangle) => (
        rectangle.assemblyId !== fromAssembly && rectangle.assemblyId !== toAssembly
        && segmentHitsRectangle(segment, rectangle)
      )).length, 0);
      const relationships = candidateSegments.flatMap((segment) => (
        routedSegments.map((other) => segmentRelationship(segment, other))
      ));
      const overlap = relationships.reduce((sum, item) => sum + item.overlap, 0);
      const crossing = relationships.reduce((sum, item) => sum + item.crossing, 0);
      return {
        candidateSegments,
        hits,
        overlap,
        crossing,
        score: hits * 1e6 + overlap * 1e4 + crossing * 100,
      };
    }).toSorted((first, second) => first.score - second.score);
    const selected = candidates[0];
    nodeCrossings += selected.hits;
    routeOverlapM += selected.overlap;
    crossings += selected.crossing;
    routedSegments.push(...selected.candidateSegments);
  });
  return {
    boundaryViolations,
    deviceOverlaps,
    nodeCrossings,
    routeOverlapM: Number(routeOverlapM.toFixed(3)),
    crossings,
    turns,
    directLengthM: Number(directLengthM.toFixed(3)),
    weightedLengthM: Number(weightedLengthM.toFixed(3)),
    highCurrentLengthM: Number(highCurrentLengthM.toFixed(3)),
    unprotectedBatteryPositiveM: Number(unprotectedBatteryPositiveM.toFixed(3)),
  };
}

const genomeKey = (genome: Genome) => genome.map((point) => (
  `${point[0].toFixed(3)},${point[1].toFixed(3)}`
)).join(";");

const ratio = (value: number, reference: number) => value / Math.max(0.001, reference);

function asCandidate(genome: Genome, baseline: CoarseMetrics): Evaluated {
  const metrics = evaluateRaw(genome);
  const constraints = [
    Math.max(0, metrics.boundaryViolations - baseline.boundaryViolations),
    Math.max(0, metrics.deviceOverlaps - baseline.deviceOverlaps),
    Math.max(0, metrics.unprotectedBatteryPositiveM - baseline.unprotectedBatteryPositiveM),
    Math.max(0, metrics.highCurrentLengthM - baseline.highCurrentLengthM),
  ];
  const objectives = [
    metrics.unprotectedBatteryPositiveM,
    metrics.highCurrentLengthM,
    metrics.weightedLengthM,
    metrics.directLengthM,
    metrics.nodeCrossings,
    metrics.routeOverlapM,
    metrics.crossings,
    metrics.turns,
  ];
  const tieScore = constraints.reduce((sum, value) => sum + value * 1e6, 0)
    + ratio(metrics.unprotectedBatteryPositiveM, baseline.unprotectedBatteryPositiveM) * 16
    + ratio(metrics.highCurrentLengthM, baseline.highCurrentLengthM) * 10
    + ratio(metrics.weightedLengthM, baseline.weightedLengthM) * 4
    + ratio(metrics.directLengthM, baseline.directLengthM) * 3
    + ratio(metrics.nodeCrossings, baseline.nodeCrossings) * 2
    + ratio(metrics.routeOverlapM, baseline.routeOverlapM) * 2
    + ratio(metrics.crossings, baseline.crossings)
    + ratio(metrics.turns, baseline.turns);
  return { key: genomeKey(genome), genome, metrics, constraints, objectives, tieScore };
}

function searchRestart(seed: number, generations: number, baseline: CoarseMetrics) {
  const random = new SeededRandom(seed);
  const current = currentGenome();
  let population: Genome[] = [
    current,
    ...Array.from({ length: 4 }, (_, index) => mutate(current, random, 0, index + 1)),
    ...Array.from({ length: 5 }, () => randomGenome(random)),
  ];
  let evaluations = uniqueCandidates(population.map((genome) => asCandidate(genome, baseline)));
  const archive = [...evaluations];
  const convergence: Array<{ generation: number; frontSize: number; bestKey: string; metrics: CoarseMetrics }> = [];
  for (let generation = 0; generation <= generations; generation += 1) {
    const ranked = rankCandidates(evaluations);
    const frontSize = nonDominatedFronts(evaluations)[0].length;
    convergence.push({ generation, frontSize, bestKey: ranked[0].key, metrics: ranked[0].metrics });
    if (generation === generations) break;
    const parents = ranked.slice(0, 2);
    population = parents.flatMap((parent) => Array.from({ length: 5 }, (_, child) => (
      child === 0 ? parent.genome : mutate(parent.genome, random, generation + 1, child)
    )));
    evaluations = uniqueCandidates(population.map((genome) => asCandidate(genome, baseline)));
    archive.push(...evaluations);
  }
  return { archive: uniqueCandidates(archive), convergence };
}

const routeTurns = (points: readonly Vec3[]) => points.slice(1, -1).filter((point, index) => {
  const previous = points[index];
  const next = points[index + 2];
  const before = point.map((value, axis) => Math.sign(value - previous[axis]));
  const after = next.map((value, axis) => Math.sign(value - point[axis]));
  return before.some((value, axis) => value !== after[axis]);
}).length;

function candidateGraph(genome: Genome): SystemGraph {
  const deltaByDevice = new Map<string, Point>();
  assemblies.forEach((assembly, index) => {
    const delta: Point = [
      genome[index][0] - assembly.current[0],
      genome[index][1] - assembly.current[1],
    ];
    assembly.memberIds.forEach((id) => deltaByDevice.set(id, delta));
  });
  const movedDevices = dseTopology.devices.map((device): Device => {
    const delta = deltaByDevice.get(device.id);
    if (!delta || device.placement.space !== "world" || (Math.abs(delta[0]) <= EPSILON && Math.abs(delta[1]) <= EPSILON)) {
      return device;
    }
    return {
      ...device,
      placement: {
        ...device.placement,
        position: [
          Number((device.placement.position[0] + delta[0]).toFixed(7)),
          Number((device.placement.position[1] + delta[1]).toFixed(7)),
          device.placement.position[2],
        ],
      },
    };
  });
  return { ...dseTopology, devices: movedDevices };
}

const sumRouteLengths = (
  routes: readonly GraphRuntimeArtifact["routes"][number][],
  predicate: (route: GraphRuntimeArtifact["routes"][number]) => boolean,
) => Number(routes.filter(predicate).reduce((sum, route) => sum + route.lengthM, 0).toFixed(3));

const baselineSafetyFindings = [
  ...runtimeArtifact.diagnostics.currentSafety.errors,
  ...runtimeArtifact.diagnostics.currentSafety.warnings,
];

const diagnosticGate = (runtime: ReturnType<typeof buildSystemRuntime>) => {
  const resolvedOverlaps = sampledResolvedDeviceOverlaps(runtime.devices).length;
  const wallCrossings = sampledRouteWallPlaneCrossings(runtime.routes, runtime.devices).length;
  const candidateSafetyFindings = [
    ...runtime.diagnostics.currentSafety.errors,
    ...runtime.diagnostics.currentSafety.warnings,
  ];
  const safetyFindingsPreserved = preservesSafetyFindings(baselineSafetyFindings, candidateSafetyFindings);
  const counts = {
    fallbacks: runtime.diagnostics.fallbacks,
    centerlineConflicts: runtime.diagnostics.centerlineConflicts,
    sweptCableConflicts: runtime.diagnostics.sweptCableConflicts,
    selfIntersections: runtime.diagnostics.selfIntersections,
    deviceConflicts: runtime.diagnostics.deviceConflicts,
    renderedGeometryConflicts: runtime.diagnostics.renderedGeometryConflicts,
    resolvedDeviceOverlaps: resolvedOverlaps,
    wallVolumeCrossings: wallCrossings,
    currentSafetyRegressions: safetyFindingsPreserved ? 0 : 1,
  };
  return {
    valid: Object.values(counts).every((count) => count === 0),
    counts,
    currentSafety: {
      baselineFindingCount: baselineSafetyFindings.length,
      candidateFindingCount: candidateSafetyFindings.length,
      findingsPreserved: safetyFindingsPreserved,
    },
  };
};

function exactMetrics(runtime: ReturnType<typeof buildSystemRuntime>) {
  return {
    totalLengthM: Number(runtime.diagnostics.totalLengthM.toFixed(3)),
    totalTurns: runtime.diagnostics.totalTurns,
    occupiedCells: runtime.diagnostics.occupiedCells,
    highCurrentLengthM: sumRouteLengths(runtime.routes, (route) => route.diameterMm >= HIGH_CURRENT_DIAMETER_MM),
    unprotectedBatteryPositiveM: sumRouteLengths(runtime.routes, (route) => unprotectedBatteryPositiveIds.has(route.id)),
  };
}

const baselineExact = {
  totalLengthM: Number(runtimeArtifact.diagnostics.totalLengthM.toFixed(3)),
  totalTurns: runtimeArtifact.diagnostics.totalTurns,
  occupiedCells: runtimeArtifact.diagnostics.occupiedCells,
  highCurrentLengthM: sumRouteLengths(runtimeArtifact.routes, (route) => route.diameterMm >= HIGH_CURRENT_DIAMETER_MM),
  unprotectedBatteryPositiveM: sumRouteLengths(runtimeArtifact.routes, (route) => unprotectedBatteryPositiveIds.has(route.id)),
};

const stableJsonHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function optionInteger(name: string, fallback: number) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

const seed = optionInteger("--seed", DEFAULT_SEED);
const restarts = optionInteger("--restarts", DEFAULT_RESTARTS);
const generations = optionInteger("--generations", DEFAULT_GENERATIONS);
const exactFinalists = optionInteger("--exact-finalists", DEFAULT_EXACT_FINALISTS);

const baselineConflictCount = runtimeArtifact.diagnostics.fallbacks
  + runtimeArtifact.diagnostics.centerlineConflicts
  + runtimeArtifact.diagnostics.sweptCableConflicts
  + runtimeArtifact.diagnostics.selfIntersections
  + runtimeArtifact.diagnostics.deviceConflicts
  + runtimeArtifact.diagnostics.renderedGeometryConflicts;
if (baselineConflictCount !== 0) throw new Error("Refusing to optimize an invalid production runtime artifact.");
if (unprotectedBatteryPositiveIds.size === 0) {
  throw new Error("No unprotected battery-positive source leads were derived; refusing to weaken the safety gate.");
}

const baselineCoarse = evaluateRaw(currentGenome());
const runs = Array.from({ length: restarts }, (_, index) => (
  searchRestart(seed + index * 7919, generations, baselineCoarse)
));
const archive = uniqueCandidates(runs.flatMap((run) => run.archive));
const currentKey = genomeKey(currentGenome());
if (!archive.some((candidate) => candidate.key === currentKey)) {
  throw new Error("Optimizer invariant failed: current layout was discarded.");
}
const paretoFront = nonDominatedFronts(archive)[0];
const finalists = paretoFront.filter((candidate) => (
  candidate.key !== currentKey && candidate.constraints.every((value) => value <= 0)
)).slice(0, exactFinalists);

const baselineRouteById = new Map(runtimeArtifact.routes.map((route) => [route.id, route]));
const attempts: Array<Record<string, unknown>> = [];
const acceptedExact: Array<{
  candidateHash: string;
  metrics: ReturnType<typeof exactMetrics>;
  proposal: Record<string, unknown>;
}> = [];
for (let rank = 0; rank < finalists.length; rank += 1) {
  const finalist = finalists[rank];
  try {
    const built = buildSystemRuntime(candidateGraph(finalist.genome));
    const gate = diagnosticGate(built);
    const metrics = exactMetrics(built);
    const routeDeltas = built.routes.map((route) => {
      const baselineRoute = baselineRouteById.get(route.id);
      if (!baselineRoute) throw new Error(`Exact candidate introduced unknown route ${route.id}.`);
      return {
        id: route.id,
        diameterMm: route.diameterMm,
        baselineLengthM: Number(baselineRoute.lengthM.toFixed(3)),
        candidateLengthM: Number(route.lengthM.toFixed(3)),
        deltaLengthM: Number((route.lengthM - baselineRoute.lengthM).toFixed(3)),
        baselineTurns: routeTurns(baselineRoute.points),
        candidateTurns: routeTurns(route.points),
      };
    });
    const improvesTotal = metrics.totalLengthM < baselineExact.totalLengthM - EPSILON;
    // High-current geometry is a protected objective: a proposal may retain
    // the already compact battery/DC cluster while reducing the much larger
    // ordinary-cable network. Requiring a strict high-current reduction here
    // discarded exact, conflict-free Pareto improvements that left every
    // >=14 mm route and both battery-positive source leads unchanged.
    const protectsHighCurrent = metrics.highCurrentLengthM
      <= baselineExact.highCurrentLengthM + EPSILON;
    const protectsBatteryLeads = metrics.unprotectedBatteryPositiveM
      <= baselineExact.unprotectedBatteryPositiveM + EPSILON;
    const accepted = gate.valid && improvesTotal && protectsHighCurrent && protectsBatteryLeads;
    const attempt = {
      rank: rank + 1,
      candidateHash: stableJsonHash(finalist.genome),
      coarseMetrics: finalist.metrics,
      exactMetrics: metrics,
      gate: { ...gate.counts, currentSafety: gate.currentSafety },
      accepted,
      rejectionReasons: [
        ...(!gate.valid ? ["exact geometry/current-safety gate failed"] : []),
        ...(!improvesTotal ? ["total routed length did not improve"] : []),
        ...(!protectsHighCurrent ? ["high-current routed length increased"] : []),
        ...(!protectsBatteryLeads ? ["unprotected battery-positive length increased"] : []),
      ],
    };
    attempts.push(attempt);
    if (!accepted) continue;
    const movedAssemblies = assemblies.flatMap((assembly, index) => {
      const target = finalist.genome[index];
      if (Math.abs(target[0] - assembly.current[0]) <= EPSILON
        && Math.abs(target[1] - assembly.current[1]) <= EPSILON) return [];
      const delta: Point = [target[0] - assembly.current[0], target[1] - assembly.current[1]];
      return [{
        id: assembly.id,
        anchorId: assembly.anchorId,
        memberIds: assembly.memberIds,
        currentAnchorM: assembly.current,
        proposedAnchorM: target,
        memberPositionsM: Object.fromEntries(assembly.memberIds.map((id) => {
          const device = runtimeDeviceById.get(id)!;
          return [id, [
            Number((device.position[0] + delta[0]).toFixed(3)),
            Number((device.position[1] + delta[1]).toFixed(3)),
            device.position[2],
          ]];
        })),
      }];
    });
    const candidateHash = stableJsonHash(finalist.genome);
    const candidateProposal = {
      exactRank: rank + 1,
      candidateHash,
      exactMetrics: metrics,
      changes: {
        totalLengthM: Number((metrics.totalLengthM - baselineExact.totalLengthM).toFixed(3)),
        highCurrentLengthM: Number((metrics.highCurrentLengthM - baselineExact.highCurrentLengthM).toFixed(3)),
        unprotectedBatteryPositiveM: Number((metrics.unprotectedBatteryPositiveM
          - baselineExact.unprotectedBatteryPositiveM).toFixed(3)),
        turns: metrics.totalTurns - baselineExact.totalTurns,
      },
      movedAssemblies,
      largestLengthReductions: routeDeltas.toSorted((first, second) => (
        first.deltaLengthM - second.deltaLengthM || first.id.localeCompare(second.id)
      )).slice(0, 12),
      largestLengthIncreases: routeDeltas.toSorted((first, second) => (
        second.deltaLengthM - first.deltaLengthM || first.id.localeCompare(second.id)
      )).slice(0, 8),
    };
    acceptedExact.push({ candidateHash, metrics, proposal: candidateProposal });
  } catch (error) {
    attempts.push({
      rank: rank + 1,
      candidateHash: stableJsonHash(finalist.genome),
      accepted: false,
      rejectionReasons: [error instanceof Error ? error.message.split("\n")[0] : String(error)],
    });
  }
}

// Exact validation can reorder the surrogate Pareto front substantially. Keep
// every accepted finalist, Pareto-rank the real solver metrics, then use a
// deterministic normalized tie score inside the best exact front. This avoids
// publishing the first routable candidate when a later one also reduces turns
// or occupied routing cells.
const selectedExact = acceptedExact.length === 0 ? undefined : rankCandidates(acceptedExact.map((candidate) => ({
  key: candidate.candidateHash,
  genome: candidate,
  metrics: candidate.metrics,
  constraints: [0],
  objectives: [
    candidate.metrics.unprotectedBatteryPositiveM,
    candidate.metrics.highCurrentLengthM,
    candidate.metrics.totalLengthM,
    candidate.metrics.totalTurns,
    candidate.metrics.occupiedCells,
  ],
  tieScore: candidate.metrics.totalLengthM / baselineExact.totalLengthM * 5
    + candidate.metrics.totalTurns / baselineExact.totalTurns * 2
    + candidate.metrics.occupiedCells / baselineExact.occupiedCells,
})))[0].genome;
const proposal = selectedExact?.proposal ?? null;

const optimizerSourceHash = createHash("sha256")
  .update(await readFile(fileURLToPath(import.meta.url)))
  .update(await readFile(path.join(here, "layout-optimizer-core.ts")))
  .digest("hex");

console.log(JSON.stringify({
  schemaVersion: 1,
  optimizerVersion: OPTIMIZER_VERSION,
  source: {
    graphId: dseTopology.id,
    graphRevision: dseTopology.revision,
    runtimeSourceHash: runtimeArtifact.sourceHash,
    topologyContentHash: stableJsonHash(dseTopology),
    optimizerSourceHash,
  },
  grid: {
    columns: COLUMNS,
    rows: ROWS,
    originM: gridOrigin,
    stepM: GRID_STEP_M,
    wallBoundsM: wallBounds,
    maximumMovementM: [MAX_HORIZONTAL_MOVE_M, MAX_VERTICAL_MOVE_M],
  },
  constraints: {
    assemblyCount: assemblies.length,
    movableAssemblyCount: assemblies.filter((assembly) => !assembly.fixed).length,
    fixedDeviceIds: [...explicitlyFixedIds].toSorted(),
    fixedAssemblyIds: assemblies.filter((assembly) => assembly.fixed).map((assembly) => assembly.id),
    rigidAssemblies: assemblies.filter((assembly) => assembly.memberIds.length > 1).map((assembly) => ({
      id: assembly.id,
      anchorId: assembly.anchorId,
      memberIds: assembly.memberIds,
      fixed: assembly.fixed,
    })),
    unprotectedBatteryPositiveRouteIds: [...unprotectedBatteryPositiveIds].toSorted(),
  },
  search: {
    seed,
    restarts,
    generations,
    population: 10,
    evaluations: restarts * (10 + generations * 10),
    uniqueCandidates: archive.length,
    paretoFrontSize: paretoFront.length,
    exactFinalistBudget: exactFinalists,
    exactFinalistsAttempted: attempts.length,
    convergence: runs.map((run, index) => ({ restart: index, history: run.convergence })),
  },
  baseline: {
    candidateRetained: true,
    coarse: baselineCoarse,
    exact: baselineExact,
  },
  status: proposal ? "exact-improvement-found" : "current-layout-retained",
  proposal,
  exactAttempts: attempts,
}, null, 2));
