import { performance } from "node:perf_hooks";
import { physicalLayout } from "../app/physicalLayout.ts";
import { solveVoxelWallRoutes } from "../app/voxelCableRouter.ts";
import { solveVoxelJunctionRoutes } from "../app/voxelJunctionRouter.ts";

const iterations = Number(process.env.ROUTING_BENCHMARK_ITERATIONS ?? 1);

const benchmark = <Result extends { solveMs: number }>(solve: () => Result) => {
  const wallTimes: number[] = [];
  const elapsedTimes: number[] = [];
  let result = solve();
  wallTimes.push(result.solveMs);
  elapsedTimes.push(result.solveMs);
  for (let index = 1; index < iterations; index += 1) {
    const started = performance.now();
    result = solve();
    elapsedTimes.push(performance.now() - started);
    wallTimes.push(result.solveMs);
  }
  return { result, solveTimesMs: wallTimes, elapsedTimesMs: elapsedTimes };
};
const productionWall = benchmark(() => solveVoxelWallRoutes(physicalLayout));
const optimizationWall = benchmark(() => solveVoxelWallRoutes(physicalLayout, { cellSizeM: 0.0288 }));
const productionJunction = benchmark(() => solveVoxelJunctionRoutes());

const summarize = (values: number[]) => ({
  averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100,
  maximumMs: Math.round(Math.max(...values) * 100) / 100,
  minimumMs: Math.round(Math.min(...values) * 100) / 100,
});

const voxelSummary = <Result extends {
  cellSizeM: number;
  failedRouteIds: string[];
  metrics: unknown;
  routingPasses: number;
  solveMs: number;
}>({ result, solveTimesMs, elapsedTimesMs }: {
  result: Result;
  solveTimesMs: number[];
  elapsedTimesMs: number[];
}) => ({
  cellSizeM: result.cellSizeM,
  failedRouteIds: result.failedRouteIds,
  metrics: result.metrics,
  routingPasses: result.routingPasses,
  timing: {
    reportedSolverMs: summarize(solveTimesMs),
    wallClockMs: summarize(elapsedTimesMs),
  },
});

process.stdout.write(`${JSON.stringify({
  scope: "the sole production Voxel A* wall/floor and junction-box route sets",
  iterations,
  productionWall14_4mm: voxelSummary(productionWall),
  optimizationProbeWall28_8mm: voxelSummary(optimizationWall),
  productionJunction14_4mm: voxelSummary(productionJunction),
  publishGates: {
    wallComplete: productionWall.result.failedRouteIds.length === 0 &&
      productionWall.result.metrics.cableClearanceIssueCount === 0 &&
      productionWall.result.metrics.deviceFrontViolationCount === 0 &&
      productionWall.result.metrics.roundedDeviceFrontViolationCount === 0 &&
      productionWall.result.metrics.portApproachViolationCount === 0,
    junctionComplete: productionJunction.result.failedRouteIds.length === 0 &&
      productionJunction.result.metrics.cableClearanceIssueCount === 0 &&
      productionJunction.result.metrics.connectorCollisionCount === 0 &&
      productionJunction.result.metrics.directionReversalCount === 0 &&
      productionJunction.result.metrics.roundedCableClearanceIssueCount === 0 &&
      productionJunction.result.metrics.protectedFrontViolationCount === 0 &&
      productionJunction.result.metrics.unrelatedDeviceFrontViolationCount === 0 &&
      productionJunction.result.metrics.portApproachViolationCount === 0,
  },
}, null, 2)}\n`);
