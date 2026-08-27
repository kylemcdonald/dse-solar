import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import runtimeJson from "../data/generated/dse-runtime.json";
import {
  buildDiagramLayout,
  type DiagramMacroCenterOverrides,
} from "../app/UnifiedSystemDiagram";
import { dseRuntime } from "../app/dseRuntime";
import type { GraphRuntimeArtifact } from "../app/systemGraph";
import {
  nonDominatedFronts,
  rankCandidates,
  SeededRandom,
  uniqueCandidates,
  type OptimizerCandidate,
} from "./layout-optimizer-core";
import {
  diagramExactGate,
  diagramRigidRootGroups,
  expandDiagramTracks,
  rankDiagramExactCandidates,
  type DiagramExactCandidate,
  type DiagramExactMetrics,
  type DiagramMacroSpec,
  type DiagramTrackOptions,
} from "./diagram-layout-optimizer-core";

type PortSide = "input" | "output" | "neutral";
type Genome = readonly number[];
type EdgeSpec = {
  id: string;
  from: string;
  to: string;
  fromSide: PortSide;
  toSide: PortSide;
  weight: number;
};
type CoarseMetrics = {
  failures: number;
  reusedEdges: number;
  crossings: number;
  turns: number;
  length: number;
  weightedLength: number;
  flowViolations: number;
  width: number;
  height: number;
};
type Evaluated = OptimizerCandidate<Genome, CoarseMetrics>;

const OPTIMIZER_VERSION = "r28-diagram-layout-proposal-v1";
const COLUMNS = 20;
const ROWS = 10;
const FINE = 3;
const ROUTING_MARGIN = 4;
const DEFAULT_SEED = 20260829;
const DEFAULT_RESTARTS = 2;
const DEFAULT_GENERATIONS = 6;
const DEFAULT_EXACT_FINALISTS = 2;
const DEFAULT_EXACT_TIMEOUT_SECONDS = 90;
const MAX_COLUMN_MOVE = 3;
const MAX_ROW_MOVE = 2;
const PROJECTED_COLUMN_SPAN = 12;
const EPSILON = 1e-9;
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const SIDE_DIRECTION: Readonly<Record<PortSide, number>> = { input: 2, output: 0, neutral: 1 };
const trackOptions: DiagramTrackOptions = {
  columns: COLUMNS,
  rows: ROWS,
  margin: 144,
  columnGap: 36,
  rowGap: 120,
  emptyColumnHalfWidth: 0,
  emptyRowHalfHeight: 36,
  snap: 12,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const runtimeArtifact = runtimeJson as unknown as GraphRuntimeArtifact;

async function hashFiles(prefix: string, relativePaths: readonly string[]) {
  const hash = createHash("sha256");
  hash.update(prefix);
  hash.update("\n");
  for (const relativePath of relativePaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const runtimeSourcePaths = [
  "app/dseTopology.ts",
  "app/systemGraph.ts",
  "app/systemGraphRuntime.ts",
  "app/renderedCableGeometry.ts",
  "scripts/generate-runtime.ts",
] as const;
const computedRuntimeSourceHash = await hashFiles(
  `${runtimeArtifact.schemaVersion}:${runtimeArtifact.generatorVersion}`,
  runtimeSourcePaths,
);
if (computedRuntimeSourceHash !== runtimeArtifact.sourceHash) {
  throw new Error(
    `Runtime artifact ${runtimeArtifact.sourceHash.slice(0, 12)} is stale for source `
    + `${computedRuntimeSourceHash.slice(0, 12)}. Run npm run generate:runtime before proposing a diagram layout.`,
  );
}
if (runtimeArtifact.graphId !== dseRuntime.graph.id || runtimeArtifact.graphRevision !== dseRuntime.graph.revision) {
  throw new Error("Runtime artifact graph identity does not match the canonical diagram graph.");
}

const endpointDeviceId = (endpoint: string) => endpoint.slice(0, endpoint.indexOf("."));
const pointKey = (point: readonly [number, number]) => `${point[0]},${point[1]}`;
const edgeKey = (first: readonly [number, number], second: readonly [number, number]) => {
  const firstKey = pointKey(first);
  const secondKey = pointKey(second);
  return firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
};
const slotPoint = (slot: number): readonly [number, number] => [
  (slot % COLUMNS) * FINE + ROUTING_MARGIN + 1,
  Math.floor(slot / COLUMNS) * FINE + ROUTING_MARGIN + 1,
];

class MinHeap {
  private values: Array<{ state: number; priority: number }> = [];

  get length() { return this.values.length; }

  push(value: { state: number; priority: number }) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].priority <= value.priority) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }

  pop() {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].priority < this.values[left].priority
        ? right : left;
      if (this.values[child].priority >= last.priority) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function simplify(points: readonly (readonly [number, number])[]) {
  const result: Array<readonly [number, number]> = [];
  points.forEach((point) => {
    const previous = result.at(-1);
    const before = result.at(-2);
    if (previous?.[0] === point[0] && previous[1] === point[1]) return;
    if (before && previous && (before[0] === previous[0] && previous[0] === point[0]
      || before[1] === previous[1] && previous[1] === point[1])) result.pop();
    result.push(point);
  });
  return result;
}

function routeOne(
  start: readonly [number, number],
  end: readonly [number, number],
  startDirection: number,
  endDirection: number,
  blocked: ReadonlySet<string>,
  usedEdges: ReadonlyMap<string, number>,
  horizontalCells: ReadonlyMap<string, number>,
  verticalCells: ReadonlyMap<string, number>,
) {
  const width = COLUMNS * FINE + ROUTING_MARGIN * 2 + 2;
  const height = ROWS * FINE + ROUTING_MARGIN * 2 + 2;
  const stateCount = width * height * 4;
  const costs = new Float64Array(stateCount);
  costs.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount);
  previous.fill(-1);
  const encode = (x: number, y: number, direction: number) => ((y * width + x) * 4 + direction);
  const decode = (state: number): [number, number, number] => {
    const direction = state % 4;
    const cell = (state - direction) / 4;
    return [cell % width, Math.floor(cell / width), direction];
  };
  const heuristic = (x: number, y: number, direction: number) => (
    Math.abs(end[0] - x) + Math.abs(end[1] - y) + (direction === endDirection ? 0 : 2)
  );
  const initial = encode(start[0], start[1], startDirection);
  costs[initial] = 0;
  const heap = new MinHeap();
  heap.push({ state: initial, priority: heuristic(start[0], start[1], startDirection) });
  let goal = -1;
  while (heap.length > 0) {
    const entry = heap.pop()!;
    const [x, y, direction] = decode(entry.state);
    const cost = costs[entry.state];
    if (entry.priority > cost + heuristic(x, y, direction) + EPSILON) continue;
    if (x === end[0] && y === end[1] && direction === endDirection) {
      goal = entry.state;
      break;
    }
    DIRECTIONS.forEach(([dx, dy], nextDirection) => {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) return;
      if (blocked.has(`${nextX},${nextY}`) && !(nextX === end[0] && nextY === end[1])) return;
      const current: readonly [number, number] = [x, y];
      const next: readonly [number, number] = [nextX, nextY];
      const reused = usedEdges.get(edgeKey(current, next)) ?? 0;
      const crossings = nextDirection % 2 === 0
        ? verticalCells.get(pointKey(next)) ?? 0
        : horizontalCells.get(pointKey(next)) ?? 0;
      const turn = nextDirection === direction ? 0 : 2.5;
      const reverse = (nextDirection + 2) % 4 === direction ? 8 : 0;
      const nextCost = cost + 1 + turn + reverse + reused * 35 + crossings * 12;
      const nextState = encode(nextX, nextY, nextDirection);
      if (nextCost >= costs[nextState]) return;
      costs[nextState] = nextCost;
      previous[nextState] = entry.state;
      heap.push({ state: nextState, priority: nextCost + heuristic(nextX, nextY, nextDirection) });
    });
  }
  if (goal < 0) return undefined;
  const reverse: Array<readonly [number, number]> = [];
  for (let state = goal; state >= 0; state = previous[state]) {
    const [x, y] = decode(state);
    reverse.push([x, y]);
  }
  return simplify(reverse.reverse());
}

const optionInteger = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
};

const seed = optionInteger("--seed", DEFAULT_SEED);
const restarts = optionInteger("--restarts", DEFAULT_RESTARTS);
const generations = optionInteger("--generations", DEFAULT_GENERATIONS);
const exactFinalists = optionInteger("--exact-finalists", DEFAULT_EXACT_FINALISTS);
const exactTimeoutSeconds = optionInteger("--exact-timeout-seconds", DEFAULT_EXACT_TIMEOUT_SECONDS);

// The source artifact becomes stale when the evaluation seam itself changes,
// so the proposal establishes a fresh exact current candidate in memory. It
// never writes the resulting layout or mutates the canonical topology.
const baselineLayout = buildDiagramLayout();
const baselineNodeById = new Map(baselineLayout.nodes.map((node) => [node.device.id, node]));
const rootByNodeId = new Map<string, string>();
const macroRoot = (nodeId: string) => {
  const cached = rootByNodeId.get(nodeId);
  if (cached) return cached;
  const visited = new Set<string>();
  let current = nodeId;
  while (!visited.has(current)) {
    visited.add(current);
    const attachment = baselineNodeById.get(current)?.device.attachment;
    if (!attachment) {
      visited.forEach((id) => rootByNodeId.set(id, current));
      return current;
    }
    const owner = endpointDeviceId(attachment.endpoint);
    if (!baselineNodeById.has(owner)) {
      visited.forEach((id) => rootByNodeId.set(id, current));
      return current;
    }
    current = owner;
  }
  throw new Error(`Diagram attachment cycle includes ${nodeId}.`);
};
baselineLayout.nodes.forEach((node) => macroRoot(node.device.id));
const visibleRootIds = [...new Set(baselineLayout.nodes.map((node) => macroRoot(node.device.id)))].toSorted();
// Attached wire-join chains follow their visible owner. Canonical layoutGroup
// families are additionally collapsed into one multi-root rigid macro so no
// mutation can change their declared order or relative grid arrangement.
const rigidRootGroups = diagramRigidRootGroups(visibleRootIds.map((rootId) => {
  const group = baselineNodeById.get(rootId)?.device.layoutGroup;
  return {
    id: rootId,
    layoutGroup: group ? { id: group.id, order: group.order } : undefined,
  };
}));
const macroSpecs: DiagramMacroSpec[] = rigidRootGroups.map((group) => {
  const orderedRoots = group.rootIds;
  const anchorId = orderedRoots[0];
  const anchorNode = baselineNodeById.get(anchorId)!;
  const nodeMembers = baselineLayout.nodes.filter((node) => orderedRoots.includes(macroRoot(node.device.id)));
  const left = Math.min(...nodeMembers.map((node) => node.x - node.width / 2));
  const right = Math.max(...nodeMembers.map((node) => node.x + node.width / 2));
  const top = Math.min(...nodeMembers.map((node) => node.y - node.height / 2));
  const bottom = Math.max(...nodeMembers.map((node) => node.y + node.height / 2));
  return {
    id: group.id,
    current: { x: anchorNode.x, y: anchorNode.y },
    reaches: {
      left: anchorNode.x - left,
      right: right - anchorNode.x,
      top: anchorNode.y - top,
      bottom: bottom - anchorNode.y,
    },
    rootOffsets: Object.fromEntries(orderedRoots.map((rootId) => {
      const node = baselineNodeById.get(rootId)!;
      return [rootId, { x: node.x - anchorNode.x, y: node.y - anchorNode.y }];
    })),
  };
}).toSorted((first, second) => first.id.localeCompare(second.id));
const assemblyByRoot = new Map(macroSpecs.flatMap((macro) => (
  Object.keys(macro.rootOffsets).map((rootId) => [rootId, macro.id] as const)
)));
const endpointOwner = new Map(baselineLayout.nodes.flatMap((node) => node.ports.map((port) => [
  port.endpointId,
  { macroId: assemblyByRoot.get(macroRoot(node.device.id))!, side: port.side },
] as const)));
const edges: EdgeSpec[] = baselineLayout.wires.flatMap((wire) => {
  const from = endpointOwner.get(wire.fromEndpointId);
  const to = endpointOwner.get(wire.toEndpointId);
  if (!from || !to || from.macroId === to.macroId) return [];
  return [{
    id: wire.route.id,
    from: from.macroId,
    to: to.macroId,
    fromSide: from.side,
    toSide: to.side,
    weight: Math.max(1, wire.width / 2.5),
  }];
});
const degree = new Map(macroSpecs.map((macro) => [macro.id, 0]));
edges.forEach((edge) => {
  degree.set(edge.from, degree.get(edge.from)! + 1);
  degree.set(edge.to, degree.get(edge.to)! + 1);
});

function projectedCurrentGenome(): Genome {
  const minX = Math.min(...macroSpecs.map((macro) => macro.current.x));
  const maxX = Math.max(...macroSpecs.map((macro) => macro.current.x));
  const minY = Math.min(...macroSpecs.map((macro) => macro.current.y));
  const maxY = Math.max(...macroSpecs.map((macro) => macro.current.y));
  const available = new Set(Array.from({ length: COLUMNS * ROWS }, (_, index) => index));
  const genome = Array<number>(macroSpecs.length);
  macroSpecs.map((macro, index) => ({ macro, index })).toSorted((first, second) => (
    degree.get(second.macro.id)! - degree.get(first.macro.id)! || first.macro.id.localeCompare(second.macro.id)
  )).forEach(({ macro, index }) => {
    // Existing logical stages occupy thirteen of the twenty global tracks.
    // The remaining tracks are deliberate search capacity, not a reason to
    // double the current canvas before the first mutation.
    const targetColumn = maxX === minX ? 0
      : (macro.current.x - minX) / (maxX - minX) * PROJECTED_COLUMN_SPAN;
    const targetRow = maxY === minY ? 0 : (macro.current.y - minY) / (maxY - minY) * (ROWS - 1);
    const selected = [...available].toSorted((first, second) => {
      const firstCost = (first % COLUMNS - targetColumn) ** 2
        + (Math.floor(first / COLUMNS) - targetRow) ** 2;
      const secondCost = (second % COLUMNS - targetColumn) ** 2
        + (Math.floor(second / COLUMNS) - targetRow) ** 2;
      return firstCost - secondCost || first - second;
    })[0];
    genome[index] = selected;
    available.delete(selected);
  });
  return genome;
}

const currentGenome = projectedCurrentGenome();
const currentSlotByMacro = new Map(macroSpecs.map((macro, index) => [macro.id, currentGenome[index]]));
const domainByMacro = new Map(macroSpecs.map((macro) => {
  const current = currentSlotByMacro.get(macro.id)!;
  const currentColumn = current % COLUMNS;
  const currentRow = Math.floor(current / COLUMNS);
  return [macro.id, Array.from({ length: COLUMNS * ROWS }, (_, slot) => slot).filter((slot) => (
    Math.abs(slot % COLUMNS - currentColumn) <= MAX_COLUMN_MOVE
      && Math.abs(Math.floor(slot / COLUMNS) - currentRow) <= MAX_ROW_MOVE
  ))] as const;
}));

function repairGenome(source: Genome, random?: SeededRandom): Genome {
  const result = Array<number>(macroSpecs.length);
  const available = new Set(Array.from({ length: COLUMNS * ROWS }, (_, index) => index));
  macroSpecs.map((macro, index) => ({ macro, index })).toSorted((first, second) => {
    const firstExtent = first.macro.reaches.left + first.macro.reaches.right
      + first.macro.reaches.top + first.macro.reaches.bottom;
    const secondExtent = second.macro.reaches.left + second.macro.reaches.right
      + second.macro.reaches.top + second.macro.reaches.bottom;
    return secondExtent - firstExtent || first.macro.id.localeCompare(second.macro.id);
  }).forEach(({ macro, index }) => {
    const desired = source[index];
    const desiredColumn = desired % COLUMNS;
    const desiredRow = Math.floor(desired / COLUMNS);
    let candidates = domainByMacro.get(macro.id)!.filter((slot) => available.has(slot)).toSorted((first, second) => (
      Math.abs(first % COLUMNS - desiredColumn) + Math.abs(Math.floor(first / COLUMNS) - desiredRow)
        - Math.abs(second % COLUMNS - desiredColumn) - Math.abs(Math.floor(second / COLUMNS) - desiredRow)
        || first - second
    ));
    if (random && candidates.length > 1) {
      const near = candidates.slice(0, Math.min(8, candidates.length));
      candidates = [...random.shuffle(near), ...candidates.slice(near.length)];
    }
    const selected = candidates[0];
    if (selected === undefined) throw new Error(`No legal 20x10 slot remains for ${macro.id}.`);
    result[index] = selected;
    available.delete(selected);
  });
  return result;
}

function mutateGenome(source: Genome, random: SeededRandom, generation: number, child: number): Genome {
  if (child === 0) return [...source];
  const genome = [...source];
  const moveCount = child < 4 ? child : Math.max(1, 4 - Math.floor(generation / 3));
  for (let move = 0; move < moveCount; move += 1) {
    const index = random.integer(macroSpecs.length);
    const current = genome[index];
    const coolingRadius = Math.max(1, 4 - Math.floor(generation / 2));
    const nearby = domainByMacro.get(macroSpecs[index].id)!.filter((slot) => (
      Math.abs(slot % COLUMNS - current % COLUMNS)
        + Math.abs(Math.floor(slot / COLUMNS) - Math.floor(current / COLUMNS)) <= coolingRadius
    ));
    genome[index] = nearby[random.integer(nearby.length)];
  }
  return repairGenome(genome);
}

function randomGenome(random: SeededRandom) {
  return repairGenome(macroSpecs.map((macro) => {
    const domain = domainByMacro.get(macro.id)!;
    return domain[random.integer(domain.length)];
  }), random);
}

const coarseCache = new Map<string, CoarseMetrics>();
function evaluateCoarse(genome: Genome): CoarseMetrics {
  const key = genome.join(",");
  const cached = coarseCache.get(key);
  if (cached) return cached;
  const slotByMacro = new Map(macroSpecs.map((macro, index) => [macro.id, genome[index]]));
  const nodeCells = new Set(genome.map((slot) => pointKey(slotPoint(slot))));
  const usedEdges = new Map<string, number>();
  const horizontalCells = new Map<string, number>();
  const verticalCells = new Map<string, number>();
  let failures = 0;
  let reusedEdges = 0;
  let crossings = 0;
  let turns = 0;
  let length = 0;
  let weightedLength = 0;
  edges.toSorted((first, second) => second.weight - first.weight || first.id.localeCompare(second.id))
    .forEach((edge) => {
      const fromCenter = slotPoint(slotByMacro.get(edge.from)!);
      const toCenter = slotPoint(slotByMacro.get(edge.to)!);
      const fromDirection = SIDE_DIRECTION[edge.fromSide];
      const toOutward = SIDE_DIRECTION[edge.toSide];
      const fromVector = DIRECTIONS[fromDirection];
      const toVector = DIRECTIONS[toOutward];
      const start: readonly [number, number] = [fromCenter[0] + fromVector[0], fromCenter[1] + fromVector[1]];
      const end: readonly [number, number] = [toCenter[0] + toVector[0], toCenter[1] + toVector[1]];
      const blocked = new Set(nodeCells);
      blocked.delete(pointKey(fromCenter));
      blocked.delete(pointKey(toCenter));
      const core = routeOne(start, end, fromDirection, (toOutward + 2) % 4,
        blocked, usedEdges, horizontalCells, verticalCells);
      if (!core) {
        failures += 1;
        return;
      }
      const points = simplify([fromCenter, start, ...core.slice(1, -1), end, toCenter]);
      const leadEdges = new Set([edgeKey(fromCenter, start), edgeKey(end, toCenter)]);
      let routeLength = 0;
      let previousDirection = -1;
      points.slice(1).forEach((point, pointIndex) => {
        const previous = points[pointIndex];
        const direction = DIRECTIONS.findIndex(([x, y]) => (
          x === Math.sign(point[0] - previous[0]) && y === Math.sign(point[1] - previous[1])
        ));
        if (previousDirection >= 0 && direction !== previousDirection) turns += 1;
        previousDirection = direction;
        routeLength += Math.abs(point[0] - previous[0]) + Math.abs(point[1] - previous[1]);
        const deltaX = Math.sign(point[0] - previous[0]);
        const deltaY = Math.sign(point[1] - previous[1]);
        let cursor = previous;
        while (cursor[0] !== point[0] || cursor[1] !== point[1]) {
          const next: readonly [number, number] = [cursor[0] + deltaX, cursor[1] + deltaY];
          const segmentKey = edgeKey(cursor, next);
          if (!leadEdges.has(segmentKey)) {
            const previousUse = usedEdges.get(segmentKey) ?? 0;
            if (previousUse > 0) reusedEdges += 1;
            usedEdges.set(segmentKey, previousUse + 1);
            const cell = pointKey(next);
            const own = deltaX === 0 ? verticalCells : horizontalCells;
            const other = deltaX === 0 ? horizontalCells : verticalCells;
            crossings += other.get(cell) ?? 0;
            own.set(cell, (own.get(cell) ?? 0) + 1);
          }
          cursor = next;
        }
      });
      length += routeLength;
      weightedLength += routeLength * edge.weight;
    });
  const flowViolations = edges.filter((edge) => {
    const fromColumn = slotByMacro.get(edge.from)! % COLUMNS;
    const toColumn = slotByMacro.get(edge.to)! % COLUMNS;
    if (edge.fromSide === "output" && edge.toSide === "input") return fromColumn > toColumn;
    if (edge.fromSide === "input" && edge.toSide === "output") return toColumn > fromColumn;
    return false;
  }).length;
  const expanded = expandDiagramTracks(macroSpecs, genome, trackOptions);
  const metrics = {
    failures,
    reusedEdges,
    crossings,
    turns,
    length,
    weightedLength: Number(weightedLength.toFixed(3)),
    flowViolations,
    width: expanded.width,
    height: expanded.height,
  };
  coarseCache.set(key, metrics);
  return metrics;
}

const baselineCoarse = evaluateCoarse(currentGenome);
const ratio = (value: number, baseline: number) => value / Math.max(1, baseline);
function candidate(genome: Genome): Evaluated {
  const metrics = evaluateCoarse(genome);
  const constraints = [
    Math.max(0, metrics.failures - baselineCoarse.failures),
    Math.max(0, metrics.reusedEdges - baselineCoarse.reusedEdges),
    Math.max(0, metrics.flowViolations - baselineCoarse.flowViolations),
    Math.max(0, metrics.width - baselineCoarse.width),
    Math.max(0, metrics.height - baselineCoarse.height),
  ];
  const objectives = [
    metrics.failures,
    metrics.reusedEdges,
    metrics.flowViolations,
    metrics.crossings,
    metrics.turns,
    metrics.weightedLength,
    metrics.length,
    metrics.width * metrics.height,
  ];
  const tieScore = constraints.reduce((sum, value) => sum + value * 1e8, 0)
    + ratio(metrics.reusedEdges, baselineCoarse.reusedEdges) * 5
    + ratio(metrics.flowViolations, baselineCoarse.flowViolations) * 5
    + ratio(metrics.crossings, baselineCoarse.crossings) * 3
    + ratio(metrics.turns, baselineCoarse.turns) * 2
    + ratio(metrics.weightedLength, baselineCoarse.weightedLength) * 2
    + ratio(metrics.length, baselineCoarse.length);
  return { key: genome.join(","), genome, metrics, constraints, objectives, tieScore };
}

function searchRestart(restartSeed: number) {
  const random = new SeededRandom(restartSeed);
  let population: Genome[] = [
    currentGenome,
    ...Array.from({ length: 4 }, (_, index) => mutateGenome(currentGenome, random, 0, index + 1)),
    ...Array.from({ length: 5 }, () => randomGenome(random)),
  ];
  let evaluated = uniqueCandidates(population.map(candidate));
  const archive = [...evaluated];
  const convergence: Array<{ generation: number; frontSize: number; bestKey: string; metrics: CoarseMetrics }> = [];
  for (let generation = 0; generation <= generations; generation += 1) {
    const ranked = rankCandidates(evaluated);
    convergence.push({
      generation,
      frontSize: nonDominatedFronts(evaluated)[0].length,
      bestKey: ranked[0].key,
      metrics: ranked[0].metrics,
    });
    if (generation === generations) break;
    const parents = ranked.slice(0, 2);
    population = parents.flatMap((parent) => Array.from({ length: 5 }, (_, child) => (
      mutateGenome(parent.genome, random, generation + 1, child)
    )));
    evaluated = uniqueCandidates(population.map(candidate));
    archive.push(...evaluated);
  }
  return { archive: uniqueCandidates(archive), convergence };
}

function flowViolationCount(layout: ReturnType<typeof buildDiagramLayout>) {
  const ownerByEndpoint = new Map(layout.nodes.flatMap((node) => node.ports.map((port) => [
    port.endpointId,
    { node, port },
  ] as const)));
  return layout.wires.filter((wire) => {
    const from = ownerByEndpoint.get(wire.fromEndpointId);
    const to = ownerByEndpoint.get(wire.toEndpointId);
    if (!from || !to) return false;
    if (from.port.side === "output" && to.port.side === "input") return from.node.x > to.node.x;
    if (from.port.side === "input" && to.port.side === "output") return to.node.x > from.node.x;
    return false;
  }).length;
}

function exactMetrics(layout: ReturnType<typeof buildDiagramLayout>): DiagramExactMetrics {
  return {
    nodeCount: layout.nodes.length,
    portCount: layout.nodes.reduce((sum, node) => sum + node.ports.length, 0),
    wireCount: layout.wires.length,
    width: layout.width,
    height: layout.height,
    routingFallbacks: layout.routingFallbacks,
    coincidentSegments: layout.coincidentSegments,
    nonOrthogonalSegments: layout.nonOrthogonalSegments,
    conductorOverlaps: layout.conductorOverlaps,
    unbridgedCrossings: layout.unbridgedCrossings,
    parallelEnvelopeOverlaps: layout.parallelEnvelopeOverlaps,
    nodeBodyCrossings: layout.nodeBodyCrossings,
    maskedNodeBodyCrossings: layout.maskedNodeBodyCrossings,
    nodeOverlaps: layout.nodeOverlaps,
    minimumParallelWireSeparation: layout.minimumParallelWireSeparation,
    bridgedCrossings: layout.bridgedCrossings,
    wireTurns: layout.wireTurns,
    wireLength: layout.wireLength,
    flowViolations: flowViolationCount(layout),
  };
}

function batteryCutoffDistance(layout: ReturnType<typeof buildDiagramLayout>) {
  const cutoff = layout.nodes.find((node) => node.device.componentId === "batteryCutoff");
  const batteries = layout.nodes.filter((node) => node.device.kind === "battery");
  if (!cutoff || batteries.length === 0) return Number.POSITIVE_INFINITY;
  const center = {
    x: batteries.reduce((sum, node) => sum + node.x, 0) / batteries.length,
    y: batteries.reduce((sum, node) => sum + node.y, 0) / batteries.length,
  };
  return Math.abs(cutoff.x - center.x) + Math.abs(cutoff.y - center.y);
}

const baselineExact = exactMetrics(baselineLayout);
const baselineBatteryCutoffDistance = batteryCutoffDistance(baselineLayout);
const runs = Array.from({ length: restarts }, (_, index) => searchRestart(seed + index * 7919));
const archive = uniqueCandidates(runs.flatMap((run) => run.archive));
if (!archive.some((entry) => entry.key === currentGenome.join(","))) {
  throw new Error("Diagram optimizer invariant failed: projected current seed was discarded.");
}
const paretoFront = nonDominatedFronts(archive)[0];
// Exact validation is allowed to sample later Pareto fronts: the coarse grid
// is only a predictor, and an apparently dominated Manhattan sketch can route
// better once real ports and footprints reach the production solver.
const finalists = rankCandidates(archive).filter((entry) => (
  entry.constraints.every((value) => value <= 0)
    && (entry.metrics.crossings < baselineCoarse.crossings
      || entry.metrics.turns < baselineCoarse.turns
      || entry.metrics.length < baselineCoarse.length
      || entry.metrics.weightedLength < baselineCoarse.weightedLength)
)).slice(0, exactFinalists);

const attempts: Array<Record<string, unknown>> = [];
type ExactProposalValue = {
  candidateHash: string;
  coarseMetrics: CoarseMetrics;
  macroCenterOverrides: DiagramMacroCenterOverrides;
};
const exactSurvivors: Array<DiagramExactCandidate<ExactProposalValue>> = [];
for (let rank = 0; rank < finalists.length; rank += 1) {
  const finalist = finalists[rank];
  const expanded = expandDiagramTracks(macroSpecs, finalist.genome, trackOptions);
  const candidateHash = createHash("sha256").update(finalist.key).digest("hex");
  try {
    const exact = spawnSync(
      path.join(root, "node_modules", ".bin", "tsx"),
      [path.join(root, "scripts", "evaluate-diagram-layout-candidate.ts")],
      {
        input: JSON.stringify(expanded.overrides satisfies DiagramMacroCenterOverrides),
        encoding: "utf8",
        timeout: exactTimeoutSeconds * 1000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (exact.error) {
      const timedOut = "code" in exact.error && exact.error.code === "ETIMEDOUT";
      throw new Error(timedOut
        ? `exact validation exceeded the ${exactTimeoutSeconds} s finalist budget`
        : `exact evaluator failed: ${exact.error.message}`);
    }
    if (exact.status !== 0) {
      const errorLines = exact.stderr.trim().split("\n").filter(Boolean);
      throw new Error(`exact evaluator exited ${exact.status}: ${errorLines.at(-1) ?? "unknown error"}`);
    }
    const evaluated = JSON.parse(exact.stdout) as {
      metrics: DiagramExactMetrics;
      batteryCutoffDistance: number;
    };
    const metrics = evaluated.metrics;
    const gate = diagramExactGate(baselineExact, metrics);
    const cutoffDistance = evaluated.batteryCutoffDistance;
    const cutoffRegressed = cutoffDistance > baselineBatteryCutoffDistance + EPSILON;
    const accepted = gate.valid && !cutoffRegressed;
    attempts.push({
      rank: rank + 1,
      candidateHash,
      coarseMetrics: finalist.metrics,
      exactMetrics: metrics,
      gate: {
        valid: accepted,
        reasons: [...gate.reasons, ...(cutoffRegressed ? ["battery-to-cutoff distance regressed"] : [])],
        batteryCutoffDistance: cutoffDistance,
      },
      accepted,
    });
    if (!accepted) continue;
    exactSurvivors.push({
      key: finalist.key,
      metrics,
      batteryCutoffDistance: cutoffDistance,
      value: {
        candidateHash,
        coarseMetrics: finalist.metrics,
        macroCenterOverrides: expanded.overrides,
      },
    });
  } catch (error) {
    attempts.push({
      rank: rank + 1,
      candidateHash,
      accepted: false,
      rejectionReasons: [error instanceof Error ? error.message.split("\n")[0] : String(error)],
    });
  }
}
const exactRanked = rankDiagramExactCandidates(
  baselineExact,
  baselineBatteryCutoffDistance,
  exactSurvivors,
);
const selected = exactRanked[0];
if (selected) {
  attempts.find((attempt) => attempt.candidateHash === selected.value.candidateHash)!.selected = true;
}
const proposal: Record<string, unknown> | null = selected ? {
  candidateHash: selected.value.candidateHash,
  exactParetoRank: 1,
  exactMetrics: selected.metrics,
  changes: {
    wireLength: selected.metrics.wireLength - baselineExact.wireLength,
    wireTurns: selected.metrics.wireTurns - baselineExact.wireTurns,
    bridgedCrossings: selected.metrics.bridgedCrossings - baselineExact.bridgedCrossings,
    flowViolations: selected.metrics.flowViolations - baselineExact.flowViolations,
    width: selected.metrics.width - baselineExact.width,
    height: selected.metrics.height - baselineExact.height,
    batteryCutoffDistance: selected.batteryCutoffDistance - baselineBatteryCutoffDistance,
  },
  macroCenterOverrides: selected.value.macroCenterOverrides,
} : null;

const evaluatorSourceHash = await hashFiles(OPTIMIZER_VERSION, [
  "app/UnifiedSystemDiagram.tsx",
  "data/generated/dse-runtime.json",
  "scripts/generate-diagram-layouts.ts",
]);
const optimizerSourceHash = await hashFiles(OPTIMIZER_VERSION, [
  "scripts/propose-diagram-layout.ts",
  "scripts/evaluate-diagram-layout-candidate.ts",
  "scripts/diagram-layout-optimizer-core.ts",
  "scripts/layout-optimizer-core.ts",
]);

console.log(JSON.stringify({
  schemaVersion: 1,
  optimizerVersion: OPTIMIZER_VERSION,
  source: {
    graphId: dseRuntime.graph.id,
    graphRevision: dseRuntime.graph.revision,
    runtimeSourceHash: runtimeArtifact.sourceHash,
    evaluatorSourceHash,
    optimizerSourceHash,
  },
  grid: {
    columns: COLUMNS,
    rows: ROWS,
    maximumMovement: { columns: MAX_COLUMN_MOVE, rows: MAX_ROW_MOVE },
    projectedCurrentColumnSpan: PROJECTED_COLUMN_SPAN,
    realTrackExpansion: trackOptions,
  },
  constraints: {
    macroAssemblyCount: macroSpecs.length,
    rigidAssemblies: macroSpecs.filter((macro) => Object.keys(macro.rootOffsets).length > 1).map((macro) => ({
      id: macro.id,
      rootIds: Object.keys(macro.rootOffsets).toSorted(),
    })),
    layoutGroupAssemblies: rigidRootGroups.filter((group) => group.layoutGroupId).map((group) => ({
      id: group.id,
      layoutGroupId: group.layoutGroupId,
      orderedRootIds: group.rootIds,
    })),
    attachedNodeGroups: visibleRootIds.map((rootId) => ({
      rootId,
      memberIds: baselineLayout.nodes.filter((node) => macroRoot(node.device.id) === rootId)
        .map((node) => node.device.id).toSorted(),
    })).filter((group) => group.memberIds.length > 1),
    layoutGroupOrderIsRigid: true,
    attachmentsMoveWithOwners: true,
    batteryCutoffDistanceMayIncrease: false,
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
    exactTimeoutSeconds,
    exactFinalistsAttempted: attempts.length,
    exactGateSurvivors: exactSurvivors.length,
    convergence: runs.map((run, index) => ({ restart: index, history: run.convergence })),
  },
  baseline: {
    currentCandidateRetained: true,
    coarse: baselineCoarse,
    exact: baselineExact,
    batteryCutoffDistance: baselineBatteryCutoffDistance,
  },
  status: proposal ? "exact-improvement-found" : "current-layout-retained",
  proposal,
  exactAttempts: attempts,
}, null, 2));
