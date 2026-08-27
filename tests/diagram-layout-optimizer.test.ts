import assert from "node:assert/strict";
import test from "node:test";
import { SeededRandom } from "../scripts/layout-optimizer-core";
import {
  diagramExactGate,
  diagramRigidRootGroups,
  expandDiagramTracks,
  rankDiagramExactCandidates,
  type DiagramExactMetrics,
  type DiagramMacroSpec,
  type DiagramTrackOptions,
} from "../scripts/diagram-layout-optimizer-core";

const options: DiagramTrackOptions = {
  columns: 3,
  rows: 2,
  margin: 12,
  columnGap: 12,
  rowGap: 24,
  emptyColumnHalfWidth: 6,
  emptyRowHalfHeight: 6,
  snap: 6,
};

const macros: readonly DiagramMacroSpec[] = [
  {
    id: "source-family",
    current: { x: 100, y: 100 },
    reaches: { left: 30, right: 42, top: 18, bottom: 24 },
    rootOffsets: {
      sourceA: { x: 0, y: 0 },
      sourceB: { x: 24, y: 12 },
    },
  },
  {
    id: "load",
    current: { x: 200, y: 200 },
    reaches: { left: 18, right: 18, top: 30, bottom: 30 },
    rootOffsets: { load: { x: 0, y: 0 } },
  },
];

test("real-track expansion is deterministic and retains rigid root offsets", () => {
  const genome = [0, 5];
  const first = expandDiagramTracks(macros, genome, options);
  const second = expandDiagramTracks(macros, genome, options);
  assert.deepEqual(first, second);
  assert.deepEqual(first.macroCenters, {
    "source-family": { x: 42, y: 30 },
    load: { x: 138, y: 108 },
  });
  assert.deepEqual(first.overrides.sourceB, {
    x: first.overrides.sourceA.x + 24,
    y: first.overrides.sourceA.y + 12,
  });
  assert.equal(first.columnCenters[0] + macros[0].reaches.right + options.columnGap
    <= first.columnCenters[1] - options.emptyColumnHalfWidth, true);
});

test("seeded chromosomes expand byte-for-byte deterministically", () => {
  const sample = () => {
    const random = new SeededRandom(20260829);
    const genome = random.shuffle([0, 1, 2, 3, 4, 5]).slice(0, macros.length);
    return JSON.stringify({ genome, expanded: expandDiagramTracks(macros, genome, options) });
  };
  assert.equal(sample(), sample());
});

test("real-track expansion rejects duplicate and out-of-grid macro slots", () => {
  assert.throws(() => expandDiagramTracks(macros, [0, 0], options), /must be unique/);
  assert.throws(() => expandDiagramTracks(macros, [0, 6], options), /outside the declared grid/);
  assert.throws(() => expandDiagramTracks(macros, [0], options), /cardinality mismatch/);
});

test("layoutGroup roots form one deterministic rigid macro in declared order", () => {
  const groups = diagramRigidRootGroups([
    { id: "battery3", layoutGroup: { id: "battery-bank", order: 2 } },
    { id: "cutoff" },
    { id: "battery1", layoutGroup: { id: "battery-bank", order: 0 } },
    { id: "battery4", layoutGroup: { id: "battery-bank", order: 3 } },
    { id: "battery2", layoutGroup: { id: "battery-bank", order: 1 } },
  ]);
  assert.deepEqual(groups, [
    { id: "cutoff", layoutGroupId: undefined, rootIds: ["cutoff"] },
    {
      id: "layoutGroup:battery-bank",
      layoutGroupId: "battery-bank",
      rootIds: ["battery1", "battery2", "battery3", "battery4"],
    },
  ]);
});

const baseline: DiagramExactMetrics = {
  nodeCount: 60,
  portCount: 200,
  wireCount: 97,
  width: 5700,
  height: 4800,
  routingFallbacks: 0,
  coincidentSegments: 0,
  nonOrthogonalSegments: 0,
  conductorOverlaps: 0,
  unbridgedCrossings: 0,
  parallelEnvelopeOverlaps: 0,
  nodeBodyCrossings: 0,
  maskedNodeBodyCrossings: 0,
  nodeOverlaps: 0,
  minimumParallelWireSeparation: 12,
  bridgedCrossings: 210,
  wireTurns: 296,
  wireLength: 110_916,
  flowViolations: 6,
};

test("exact diagram gate accepts only strict all-no-worse improvements", () => {
  const shorter = { ...baseline, wireLength: baseline.wireLength - 12 };
  assert.deepEqual(diagramExactGate(baseline, shorter), {
    valid: true,
    strictImprovement: true,
    reasons: [],
  });
  const tradeoff = { ...shorter, bridgedCrossings: baseline.bridgedCrossings + 1 };
  assert.equal(diagramExactGate(baseline, tradeoff).valid, false);
  assert.ok(diagramExactGate(baseline, tradeoff).reasons.includes("bridgedCrossings regressed"));
  const flowRegression = { ...shorter, flowViolations: baseline.flowViolations + 1 };
  assert.equal(diagramExactGate(baseline, flowRegression).valid, false);
  assert.ok(diagramExactGate(baseline, flowRegression).reasons.includes("flowViolations regressed"));
  const geometryFailure = { ...shorter, nodeBodyCrossings: 1 };
  assert.equal(diagramExactGate(baseline, geometryFailure).valid, false);
  assert.ok(diagramExactGate(baseline, geometryFailure).reasons.includes("nodeBodyCrossings is 1"));
});

test("exact diagram gate rejects stale cardinality, reduced spacing, and unchanged candidates", () => {
  const shorter = { ...baseline, wireLength: baseline.wireLength - 12 };
  assert.equal(diagramExactGate(baseline, { ...shorter, wireCount: baseline.wireCount - 1 }).valid, false);
  assert.equal(diagramExactGate(baseline, {
    ...shorter,
    minimumParallelWireSeparation: baseline.minimumParallelWireSeparation - 6,
  }).valid, false);
  const unchanged = diagramExactGate(baseline, baseline);
  assert.equal(unchanged.valid, false);
  assert.deepEqual(unchanged.reasons, ["no exact metric improved"]);
});

test("all exact survivors are Pareto-ranked before deterministic selection", () => {
  const candidates = [
    {
      key: "dominated",
      metrics: { ...baseline, wireLength: baseline.wireLength - 12 },
      batteryCutoffDistance: 570,
      value: "dominated",
    },
    {
      key: "shortest",
      metrics: { ...baseline, wireLength: baseline.wireLength - 36 },
      batteryCutoffDistance: 570,
      value: "shortest",
    },
    {
      key: "fewest-crossings",
      metrics: { ...baseline, bridgedCrossings: baseline.bridgedCrossings - 2 },
      batteryCutoffDistance: 570,
      value: "fewest-crossings",
    },
  ] as const;
  const forward = rankDiagramExactCandidates(baseline, 570, candidates);
  const reverse = rankDiagramExactCandidates(baseline, 570, [...candidates].reverse());
  assert.deepEqual(forward.map((candidate) => candidate.key), reverse.map((candidate) => candidate.key));
  assert.deepEqual(new Set(forward.slice(0, 2).map((candidate) => candidate.key)),
    new Set(["shortest", "fewest-crossings"]));
  assert.equal(forward.at(-1)?.key, "dominated");
});
