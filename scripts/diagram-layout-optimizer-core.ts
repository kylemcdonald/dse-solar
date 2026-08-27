export type DiagramOptimizerPoint = Readonly<{ x: number; y: number }>;

export type DiagramMacroSpec = {
  id: string;
  /** Real current center of the assembly anchor. */
  current: DiagramOptimizerPoint;
  /** Real extents from the assembly anchor, including attached diagram nodes. */
  reaches: Readonly<{ left: number; right: number; top: number; bottom: number }>;
  /** Every production macro root in this rigid assembly, relative to the anchor. */
  rootOffsets: Readonly<Record<string, DiagramOptimizerPoint>>;
};

export type DiagramMacroRoot = {
  id: string;
  layoutGroup?: Readonly<{ id: string; order?: number }>;
};

export type DiagramExactCandidate<T> = {
  key: string;
  metrics: DiagramExactMetrics;
  batteryCutoffDistance: number;
  value: T;
};

export type DiagramTrackOptions = {
  columns: number;
  rows: number;
  margin: number;
  columnGap: number;
  rowGap: number;
  emptyColumnHalfWidth: number;
  emptyRowHalfHeight: number;
  snap: number;
};

export type DiagramExactMetrics = {
  nodeCount: number;
  portCount: number;
  wireCount: number;
  width: number;
  height: number;
  routingFallbacks: number;
  coincidentSegments: number;
  nonOrthogonalSegments: number;
  conductorOverlaps: number;
  unbridgedCrossings: number;
  parallelEnvelopeOverlaps: number;
  nodeBodyCrossings: number;
  maskedNodeBodyCrossings: number;
  nodeOverlaps: number;
  minimumParallelWireSeparation: number;
  bridgedCrossings: number;
  wireTurns: number;
  wireLength: number;
  flowViolations: number;
};

const rounded = (value: number, step: number) => Math.round(value / step) * step;

/** Collapse every declared layout family into one rigid macro. Ordering is
 * taken from canonical layoutGroup.order (then id for deterministic ties), so
 * moving a family can never permute its members. Un-grouped roots remain
 * independent macros. */
export function diagramRigidRootGroups(roots: readonly DiagramMacroRoot[]) {
  const byGroup = new Map<string, DiagramMacroRoot[]>();
  roots.forEach((root) => {
    const key = root.layoutGroup ? `layoutGroup:${root.layoutGroup.id}` : `root:${root.id}`;
    const members = byGroup.get(key) ?? [];
    members.push(root);
    byGroup.set(key, members);
  });
  return [...byGroup.entries()].map(([key, members]) => ({
    id: key.startsWith("root:") ? members[0].id : key,
    layoutGroupId: members[0].layoutGroup?.id,
    rootIds: members.toSorted((first, second) => (
      (first.layoutGroup?.order ?? Number.MAX_SAFE_INTEGER)
        - (second.layoutGroup?.order ?? Number.MAX_SAFE_INTEGER)
      || first.id.localeCompare(second.id)
    )).map((member) => member.id),
  })).toSorted((first, second) => first.id.localeCompare(second.id));
}

/** Expand a coarse 20x10 chromosome into production pixel centers using the
 * maximum real asymmetric footprint assigned to each row and column. Empty
 * tracks retain routing-channel width, and rigid members keep exact offsets. */
export function expandDiagramTracks(
  macros: readonly DiagramMacroSpec[],
  genome: readonly number[],
  options: DiagramTrackOptions,
) {
  if (genome.length !== macros.length) throw new Error("Diagram genome/macro cardinality mismatch.");
  const slotCount = options.columns * options.rows;
  if (new Set(genome).size !== genome.length) throw new Error("Diagram macro slots must be unique.");
  if (genome.some((slot) => !Number.isSafeInteger(slot) || slot < 0 || slot >= slotCount)) {
    throw new Error("Diagram macro slot is outside the declared grid.");
  }
  const columnLeft = Array(options.columns).fill(options.emptyColumnHalfWidth) as number[];
  const columnRight = Array(options.columns).fill(options.emptyColumnHalfWidth) as number[];
  const rowTop = Array(options.rows).fill(options.emptyRowHalfHeight) as number[];
  const rowBottom = Array(options.rows).fill(options.emptyRowHalfHeight) as number[];
  macros.forEach((macro, index) => {
    const slot = genome[index];
    const column = slot % options.columns;
    const row = Math.floor(slot / options.columns);
    columnLeft[column] = Math.max(columnLeft[column], macro.reaches.left);
    columnRight[column] = Math.max(columnRight[column], macro.reaches.right);
    rowTop[row] = Math.max(rowTop[row], macro.reaches.top);
    rowBottom[row] = Math.max(rowBottom[row], macro.reaches.bottom);
  });
  const columnCenters: number[] = [];
  let xCursor = options.margin;
  columnLeft.forEach((left, column) => {
    columnCenters[column] = rounded(xCursor + left, options.snap);
    xCursor = columnCenters[column] + columnRight[column] + options.columnGap;
  });
  const rowCenters: number[] = [];
  let yCursor = options.margin;
  rowTop.forEach((top, row) => {
    rowCenters[row] = rounded(yCursor + top, options.snap);
    yCursor = rowCenters[row] + rowBottom[row] + options.rowGap;
  });
  const macroCenters = Object.fromEntries(macros.map((macro, index) => {
    const slot = genome[index];
    return [macro.id, {
      x: columnCenters[slot % options.columns],
      y: rowCenters[Math.floor(slot / options.columns)],
    }];
  }));
  const overrides: Record<string, { x: number; y: number }> = {};
  macros.forEach((macro) => {
    const center = macroCenters[macro.id];
    Object.entries(macro.rootOffsets).forEach(([rootId, offset]) => {
      overrides[rootId] = {
        x: rounded(center.x + offset.x, options.snap),
        y: rounded(center.y + offset.y, options.snap),
      };
    });
  });
  return {
    macroCenters,
    overrides,
    width: rounded(xCursor - options.columnGap + options.margin, options.snap),
    height: rounded(yCursor - options.rowGap + options.margin, options.snap),
    columnCenters,
    rowCenters,
  };
}

const hardGeometryFields = [
  "routingFallbacks",
  "coincidentSegments",
  "nonOrthogonalSegments",
  "conductorOverlaps",
  "unbridgedCrossings",
  "parallelEnvelopeOverlaps",
  "nodeBodyCrossings",
  "maskedNodeBodyCrossings",
  "nodeOverlaps",
] as const satisfies readonly (keyof DiagramExactMetrics)[];

/** Exact publish gate. Current remains the implicit alternative, so an
 * optimizer proposal may not trade any production geometry/flow metric for a
 * lower aggregate score and must improve at least one useful metric. */
export function diagramExactGate(baseline: DiagramExactMetrics, candidate: DiagramExactMetrics) {
  const reasons: string[] = [];
  (["nodeCount", "portCount", "wireCount"] as const).forEach((field) => {
    if (candidate[field] !== baseline[field]) reasons.push(`${field} changed`);
  });
  hardGeometryFields.forEach((field) => {
    if (candidate[field] !== 0) reasons.push(`${field} is ${candidate[field]}`);
  });
  if (candidate.minimumParallelWireSeparation < baseline.minimumParallelWireSeparation) {
    reasons.push("minimum parallel-wire separation regressed");
  }
  (["bridgedCrossings", "wireTurns", "wireLength", "flowViolations", "width", "height"] as const)
    .forEach((field) => {
      if (candidate[field] > baseline[field]) reasons.push(`${field} regressed`);
    });
  const strictImprovement = ([
    "bridgedCrossings",
    "wireTurns",
    "wireLength",
    "flowViolations",
    "width",
    "height",
  ] as const).some((field) => candidate[field] < baseline[field]);
  if (!strictImprovement) reasons.push("no exact metric improved");
  return { valid: reasons.length === 0, strictImprovement, reasons };
}

const exactObjectives = (candidate: Pick<DiagramExactCandidate<unknown>, "metrics" | "batteryCutoffDistance">) => [
  candidate.metrics.bridgedCrossings,
  candidate.metrics.wireTurns,
  candidate.metrics.wireLength,
  candidate.metrics.flowViolations,
  candidate.metrics.width,
  candidate.metrics.height,
  candidate.batteryCutoffDistance,
  -candidate.metrics.minimumParallelWireSeparation,
] as const;

const exactDominates = <T>(first: DiagramExactCandidate<T>, second: DiagramExactCandidate<T>) => {
  const firstObjectives = exactObjectives(first);
  const secondObjectives = exactObjectives(second);
  return firstObjectives.every((value, index) => value <= secondObjectives[index])
    && firstObjectives.some((value, index) => value < secondObjectives[index]);
};

/** Rank the complete exact-validated set by Pareto fronts. The normalized
 * score is used only inside a front; it can never promote a dominated result. */
export function rankDiagramExactCandidates<T>(
  baseline: DiagramExactMetrics,
  baselineBatteryCutoffDistance: number,
  source: readonly DiagramExactCandidate<T>[],
) {
  const remaining = [...new Map(source.map((candidate) => [candidate.key, candidate])).values()];
  const ranked: DiagramExactCandidate<T>[] = [];
  const ratio = (value: number, reference: number) => value / Math.max(1, reference);
  const tieScore = (candidate: DiagramExactCandidate<T>) => (
    ratio(candidate.metrics.bridgedCrossings, baseline.bridgedCrossings) * 3
    + ratio(candidate.metrics.wireTurns, baseline.wireTurns) * 2
    + ratio(candidate.metrics.wireLength, baseline.wireLength) * 3
    + ratio(candidate.metrics.flowViolations, baseline.flowViolations) * 5
    + ratio(candidate.metrics.width, baseline.width)
    + ratio(candidate.metrics.height, baseline.height)
    + ratio(candidate.batteryCutoffDistance, baselineBatteryCutoffDistance) * 3
    + ratio(baseline.minimumParallelWireSeparation,
      candidate.metrics.minimumParallelWireSeparation)
  );
  while (remaining.length > 0) {
    const front = remaining.filter((candidate, index) => !remaining.some((other, otherIndex) => (
      index !== otherIndex && exactDominates(other, candidate)
    ))).toSorted((first, second) => tieScore(first) - tieScore(second) || first.key.localeCompare(second.key));
    if (front.length === 0) throw new Error("Exact diagram Pareto sort failed to make progress.");
    ranked.push(...front);
    const keys = new Set(front.map((candidate) => candidate.key));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (keys.has(remaining[index].key)) remaining.splice(index, 1);
    }
  }
  return ranked;
}
