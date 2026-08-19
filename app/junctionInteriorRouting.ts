import optimizedLayoutRaw from "../data/junction-optimized-layout.json" with { type: "json" };

export type JunctionPoint2 = [number, number];
export type JunctionPoint3 = [number, number, number];
export type JunctionWireKind = "positive" | "negative" | "data";

export type JunctionPortSpecification = {
  cableRadiusM: number;
  componentId?: string;
  direction: JunctionPoint3;
  face: JunctionPoint3;
  lengthM: number;
  position: JunctionPoint3;
};

export type JunctionInteriorRoute = {
  bends: number;
  from: string;
  fuse?: {
    position: JunctionPoint3;
    rotationDeg: number;
    size: JunctionPoint3;
  };
  id: string;
  kind: JunctionWireKind;
  lane: number;
  lengthM: number;
  points: JunctionPoint3[];
  radiusM: number;
  to: string;
};

export type JunctionGlandPlacement = {
  conductorPoints: Record<string, JunctionPoint2>;
  diameterM: number;
  exteriorPortIds: string[];
  id: string;
  label: string;
  row: number;
  type: "gland" | "jack";
  x: number;
  zOffset: number;
};

export type JunctionRoutingCandidate = {
  bends: number;
  crossings: number;
  directionReversals: number;
  name: string;
  overlapM: number;
  score: number;
  solidIntersections: number;
  totalLengthM: number;
};

export type JunctionInteriorRouting = {
  candidates: JunctionRoutingCandidate[];
  components: Record<string, { center: JunctionPoint2; size: JunctionPoint2 }>;
  glandRows: string[][];
  glands: Record<string, JunctionGlandPlacement>;
  laneCount: number;
  metrics: {
    backtrackingCorners3d: number;
    bends: number;
    boundaryBreakoutConflicts: number;
    bridgeCount: number;
    coincidentRunOverlapM: number;
    componentOverlapCount: number;
    crossings: number;
    depthOverflowM: number;
    directionReversals: number;
    glandOverflowM: number;
    maximumForwardM: number;
    maximumRouteBends: number;
    overlapM: number;
    portApproachViolations: number;
    routingCost: number;
    score: number;
    serviceCircuitCount: number;
    solidIntersections: number;
    spatialIntersections: number;
    totalLengthM: number;
    turnCount3d: number;
    wallDistanceCostM2: number;
    weightedLengthM: number;
    wireSegmentCount: number;
  };
  optimization: {
    algorithm: string;
    elapsedSeconds: number;
    evaluations: number;
    generatedAt: string;
    generations: number;
    improvementPercent: number;
    requestedTimeBudgetSeconds: number;
    seed: number;
  };
  ports: Record<string, JunctionPortSpecification>;
  routes: Record<string, JunctionInteriorRoute>;
  selectedCandidate: string;
  terminals: Record<string, JunctionPoint2>;
  wireSegments: Record<string, JunctionInteriorRoute>;
};

type OptimizedDocument = {
  algorithm: string;
  elapsedSeconds: number;
  evaluations: number;
  generatedAt: string;
  generations: number;
  improvementPercent: number;
  requestedTimeBudgetSeconds: number;
  seed: number;
  runtime: {
    candidates: JunctionRoutingCandidate[];
    components: JunctionInteriorRouting["components"];
    glands: JunctionInteriorRouting["glands"];
    glandRows: string[][];
    laneCount: number;
    metrics: {
      bridgeCount: number;
      backtrackingCorners3d: number;
      boundaryBreakoutConflicts: number;
      coincidentRunOverlapM: number;
      componentOverlapCount: number;
      depthOverflowM: number;
      directionReversals: number;
      glandOverflowM: number;
      maximumForwardM: number;
      maximumPlanarBends: number;
      planarBends: number;
      portApproachViolations: number;
      routingCost: number;
      score: number;
      solidIntersections: number;
      spatialIntersections: number;
      totalLengthM: number;
      turnCount3d: number;
      wallDistanceCostM2: number;
      weightedLengthM: number;
      wireCrossings: number;
      wireOverlapM: number;
    };
    ports: Record<string, JunctionPortSpecification>;
    routes: Record<string, JunctionInteriorRoute>;
    selectedCandidate: string;
    terminals: Record<string, JunctionPoint2>;
  };
};

const optimizedLayout = optimizedLayoutRaw as unknown as OptimizedDocument;

const samePoint = (first: JunctionPoint3, second: JunctionPoint3) => first.every((value, axis) => (
  Math.abs(value - second[axis]) < 0.000001
));

const mergeFusedRoute = (
  feed: JunctionInteriorRoute,
  output: JunctionInteriorRoute,
  component: { center: JunctionPoint2; size: JunctionPoint2 },
): JunctionInteriorRoute => {
  const points = [...feed.points.map((point) => [...point] as JunctionPoint3)];
  output.points.forEach((point) => {
    const next = [...point] as JunctionPoint3;
    if (!samePoint(points.at(-1)!, next)) points.push(next);
  });
  return {
    ...output,
    bends: feed.bends + output.bends,
    from: feed.from,
    fuse: {
      position: [component.center[0], component.center[1], 0.06],
      rotationDeg: 0,
      size: [component.size[0], component.size[1], 0.018],
    },
    lane: Math.max(feed.lane, output.lane),
    lengthM: feed.lengthM + output.lengthM,
    points,
  };
};

const rawRoutes = optimizedLayout.runtime.routes;
const wireSegments = Object.fromEntries(Object.entries(rawRoutes).map(([id, route]) => [id, {
  ...route,
  points: route.points.map((point) => [...point] as JunctionPoint3),
}]));
const routes = Object.fromEntries(Object.entries(wireSegments).map(([id, route]) => [id, {
  ...route,
  points: route.points.map((point) => [...point] as JunctionPoint3),
}]));

const fusedPairs = [
  ["mppt-positive-feed", "mppt-positive", "mpptFuse"],
  ["ekrano-positive-feed", "ekrano-positive", "ekranoFuse"],
] as const;

fusedPairs.forEach(([feedId, outputId, componentId]) => {
  routes[outputId] = mergeFusedRoute(routes[feedId], routes[outputId], optimizedLayout.runtime.components[componentId]);
  delete routes[feedId];
});

const rawMetrics = optimizedLayout.runtime.metrics;

export const junctionInteriorRouting: JunctionInteriorRouting = {
  candidates: optimizedLayout.runtime.candidates,
  components: optimizedLayout.runtime.components,
  glands: optimizedLayout.runtime.glands,
  glandRows: optimizedLayout.runtime.glandRows,
  laneCount: optimizedLayout.runtime.laneCount,
  metrics: {
    bends: rawMetrics.planarBends,
    backtrackingCorners3d: rawMetrics.backtrackingCorners3d,
    boundaryBreakoutConflicts: rawMetrics.boundaryBreakoutConflicts,
    bridgeCount: rawMetrics.bridgeCount,
    coincidentRunOverlapM: rawMetrics.coincidentRunOverlapM,
    componentOverlapCount: rawMetrics.componentOverlapCount,
    crossings: rawMetrics.wireCrossings,
    depthOverflowM: rawMetrics.depthOverflowM,
    directionReversals: rawMetrics.directionReversals,
    glandOverflowM: rawMetrics.glandOverflowM,
    maximumForwardM: rawMetrics.maximumForwardM,
    maximumRouteBends: rawMetrics.maximumPlanarBends,
    overlapM: rawMetrics.wireOverlapM,
    portApproachViolations: rawMetrics.portApproachViolations,
    routingCost: rawMetrics.routingCost,
    score: rawMetrics.score,
    serviceCircuitCount: Object.keys(routes).length,
    solidIntersections: rawMetrics.solidIntersections,
    spatialIntersections: rawMetrics.spatialIntersections,
    totalLengthM: rawMetrics.totalLengthM,
    turnCount3d: rawMetrics.turnCount3d,
    wallDistanceCostM2: rawMetrics.wallDistanceCostM2,
    weightedLengthM: rawMetrics.weightedLengthM,
    wireSegmentCount: Object.keys(rawRoutes).length,
  },
  optimization: {
    algorithm: optimizedLayout.algorithm,
    elapsedSeconds: optimizedLayout.elapsedSeconds,
    evaluations: optimizedLayout.evaluations,
    generatedAt: optimizedLayout.generatedAt,
    generations: optimizedLayout.generations,
    improvementPercent: optimizedLayout.improvementPercent,
    requestedTimeBudgetSeconds: optimizedLayout.requestedTimeBudgetSeconds,
    seed: optimizedLayout.seed,
  },
  ports: optimizedLayout.runtime.ports,
  routes,
  selectedCandidate: optimizedLayout.runtime.selectedCandidate,
  terminals: optimizedLayout.runtime.terminals,
  wireSegments,
};

export const solveJunctionInteriorRouting = () => junctionInteriorRouting;
