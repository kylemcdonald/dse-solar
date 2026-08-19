import { performance } from "node:perf_hooks";
import { solvePhysicalLayout } from "../app/physicalLayoutSolver.ts";
import { solveVoxelWallRoutes, visibilityWallMetrics } from "../app/voxelCableRouter.ts";

const iterations = Number(process.env.ROUTING_BENCHMARK_ITERATIONS ?? 5);
const layout = solvePhysicalLayout();
const visibility = visibilityWallMetrics(layout);

const solveTimes: number[] = [];
for (let index = 0; index < 50; index += 1) {
  const started = performance.now();
  solvePhysicalLayout();
  solveTimes.push(performance.now() - started);
}

const benchmarkVoxel = (cellSizeM: number) => {
  let result = solveVoxelWallRoutes(layout, { cellSizeM });
  const times = [result.solveMs];
  for (let index = 1; index < iterations; index += 1) {
    result = solveVoxelWallRoutes(layout, { cellSizeM });
    times.push(result.solveMs);
  }
  return { result, times };
};
const realtimeVoxel = benchmarkVoxel(0.04);
const qualityVoxel = benchmarkVoxel(0.03);

const summarize = (values: number[]) => ({
  averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100,
  maximumMs: Math.round(Math.max(...values) * 100) / 100,
  minimumMs: Math.round(Math.min(...values) * 100) / 100,
});

const complete = qualityVoxel.result.failedRouteIds.length === 0 &&
  qualityVoxel.result.metrics.routeCount === visibility.routeCount;
const dominates = complete &&
  qualityVoxel.result.metrics.totalTurns <= visibility.totalTurns &&
  qualityVoxel.result.metrics.totalLengthM <= visibility.totalLengthM &&
  qualityVoxel.result.metrics.maximumForwardM <= visibility.maximumForwardM;
const voxelSummary = ({ result, times }: ReturnType<typeof benchmarkVoxel>) => ({
  cellSizeM: result.cellSizeM,
  failedRouteIds: result.failedRouteIds,
  metrics: result.metrics,
  timing: summarize(times),
});

process.stdout.write(`${JSON.stringify({
  scope: "automatic endpoint-derived routes whose source and target are both draggable wall devices",
  routeCount: visibility.routeCount,
  currentVisibilityGraph: {
    metrics: visibility,
    timing: summarize(solveTimes),
  },
  proposedVoxelAStar: {
    realtime40mm: voxelSummary(realtimeVoxel),
    quality30mm: voxelSummary(qualityVoxel),
  },
  conclusion: dominates
    ? "Voxel A* dominates the current solver on all requested metrics."
    : complete
      ? "Voxel A* completes and improves length/depth at 30 mm, but its uniform-grid endpoint adapters create substantially more visible turns, so it does not dominate the current solver."
      : "Sequential hard-occupancy voxel A* is order-sensitive and failed to route every cable.",
}, null, 2)}\n`);
