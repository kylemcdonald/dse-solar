import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildExpandedJunctionRouting,
  EXPANDED_JUNCTION_INNER_SIZE_M,
} from "../app/expandedJunctionLayout.ts";
import { solveVoxelJunctionRoutes } from "../app/voxelJunctionRouter.ts";
import { CableRoutingSystem } from "../app/cableRouting.ts";

const outputPath = fileURLToPath(new URL("../data/junction-optimized-layout.json", import.meta.url));
const existing = JSON.parse(await readFile(outputPath, "utf8"));
const expanded = buildExpandedJunctionRouting();
const baseline = solveVoxelJunctionRoutes(expanded, {
  depthMovementPenalty: 0.5,
  depthPositionPenalty: 1.5,
  heuristicWeight: 3.5,
  turnPenaltyM: 0.02,
});

if (
  baseline.failedRouteIds.length > 0 ||
  baseline.metrics.routeCount !== Object.keys(expanded.wireSegments).length ||
  baseline.metrics.cableClearanceIssueCount > 0 ||
  baseline.metrics.connectorCollisionCount > 0 ||
  baseline.metrics.directionReversalCount > 0 ||
  baseline.metrics.portApproachViolationCount > 0 ||
  baseline.metrics.protectedFrontViolationCount > 0 ||
  baseline.metrics.roundedCableClearanceIssueCount > 0 ||
  baseline.metrics.unrelatedDeviceFrontViolationCount > 0
) {
  throw new Error(`Expanded junction baseline failed its publish gate: ${JSON.stringify(baseline)}`);
}

const routes = baseline.routes;
const routeValues = Object.values(routes);
const maximumRouteBends = Math.max(...routeValues.map((route) => route.bends));
const rendererAudit = new CableRoutingSystem();
routeValues.forEach((route) => rendererAudit.prepareRoute(route.points, route.radiusM, "junction", false));
const rendererReport = rendererAudit.report();
const weightedLengthM = routeValues.reduce((sum, route) => (
  sum + route.lengthM * (route.radiusM >= 0.005 ? 2 : 1)
), 0);
const metrics = {
  ...existing.runtime.metrics,
  backtrackingCorners3d: rendererReport.backtrackingCorners,
  boundaryBreakoutConflicts: 0,
  bridgeCount: 0,
  coincidentRunOverlapM: 0,
  connectorCollisionCount: baseline.metrics.connectorCollisionCount,
  componentOverlapAreaM2: 0,
  componentOverlapCount: 0,
  depthOverflowM: 0,
  directionReversals: baseline.metrics.directionReversalCount,
  glandOverflowM: 0,
  laneCount: Math.max(...routeValues.map((route) => route.lane)) + 1,
  maximumForwardM: baseline.metrics.maximumForwardM,
  maximumPlanarBends: maximumRouteBends,
  planarBends: baseline.metrics.totalTurns,
  portApproachViolations: 0,
  routingCost: baseline.metrics.totalLengthM + baseline.metrics.totalTurns * 0.02,
  score: baseline.metrics.totalLengthM + baseline.metrics.totalTurns * 0.02,
  solidIntersections: 0,
  spatialIntersections: 0,
  totalLengthM: baseline.metrics.totalLengthM,
  turnCount3d: baseline.metrics.totalTurns,
  unbridgeableConflicts: 0,
  unsatisfiedBridgeConstraints: 0,
  wallDistanceCostM2: baseline.metrics.wallDistanceCostM2,
  weightedLengthM,
  wireCrossings: 0,
  wireOverlapM: 0,
};
const candidate = {
  bends: baseline.metrics.totalTurns,
  crossings: 0,
  directionReversals: 0,
  name: "Expanded protected-face baseline",
  overlapM: 0,
  score: metrics.score,
  solidIntersections: 0,
  totalLengthM: baseline.metrics.totalLengthM,
};
const generatedAt = new Date().toISOString();
const document = {
  ...existing,
  generatedAt,
  algorithm: "deterministic service-aisle repack followed by protected-front sequential voxel A* baseline routing",
  requestedTimeBudgetSeconds: 0,
  elapsedSeconds: baseline.solveMs / 1000,
  evaluations: 1,
  generations: 0,
  enclosure: {
    ...existing.enclosure,
    innerDimensionsM: EXPANDED_JUNCTION_INNER_SIZE_M,
    bottomRoutingGutterTopY: -EXPANDED_JUNCTION_INNER_SIZE_M[1] / 2 + 0.0335,
    minimumComponentGapM: 0.02,
  },
  bestMetrics: metrics,
  improvementPercent: 0,
  runtime: {
    ...existing.runtime,
    candidates: [candidate],
    components: expanded.components,
    glands: expanded.glands,
    glandRows: expanded.glandRows,
    laneCount: metrics.laneCount,
    metrics,
    ports: expanded.ports,
    routes,
    selectedCandidate: candidate.name,
    terminals: expanded.terminals,
  },
};

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, baseline: baseline.metrics, solveMs: baseline.solveMs }, null, 2)}\n`);
