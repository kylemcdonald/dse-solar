import { solvePhysicalLayout } from "../app/physicalLayoutSolver.ts";

const specification = solvePhysicalLayout();

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(specification, null, 2)}\n`);
} else {
  const summary = {
    revision: specification.revision,
    wallDeviceSpanM: specification.metrics.wallDeviceSpanM,
    wallDeviceCount: specification.metrics.wallDeviceCount,
    solverRouteCount: specification.metrics.solverRouteCount,
    totalRenderedCableM: specification.metrics.totalRenderedCableM,
    cableByKindM: specification.metrics.cableByKindM,
    wallOverlapCount: specification.metrics.wallOverlapCount,
    junctionBackRouteCount: specification.metrics.junctionBackRouteCount,
    planarDirectionReversals: specification.metrics.planarDirectionReversals,
    planarReversalIssues: specification.metrics.planarReversalIssues,
    wallSpanPenaltyM: specification.metrics.wallSpanPenaltyM,
    score: specification.metrics.score,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
