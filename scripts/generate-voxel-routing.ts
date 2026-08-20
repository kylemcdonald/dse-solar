import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { physicalLayout } from "../app/physicalLayout.ts";
import {
  solveVoxelWallRoutes,
} from "../app/voxelCableRouter.ts";
import { solveVoxelJunctionRoutes } from "../app/voxelJunctionRouter.ts";

const outputPath = fileURLToPath(new URL("../data/voxel-routing-comparison.json", import.meta.url));
const voxelAStar = solveVoxelWallRoutes(physicalLayout);
const junctionVoxelAStar = solveVoxelJunctionRoutes();

if (
  voxelAStar.failedRouteIds.length > 0 ||
  voxelAStar.metrics.routeCount !== 42 ||
  voxelAStar.metrics.cableClearanceIssueCount > 0 ||
  voxelAStar.metrics.deviceFrontViolationCount > 0 ||
  voxelAStar.metrics.roundedDeviceFrontViolationCount > 0 ||
  voxelAStar.metrics.portApproachViolationCount > 0
) {
  throw new Error(
    `Refusing to publish an incomplete voxel route set: ${JSON.stringify({
      failedRouteIds: voxelAStar.failedRouteIds,
      clearanceIssues: voxelAStar.clearanceIssues,
      metrics: voxelAStar.metrics,
    })}`,
  );
}

if (
  junctionVoxelAStar.failedRouteIds.length > 0 ||
  junctionVoxelAStar.metrics.routeCount !== 35 ||
  junctionVoxelAStar.metrics.cableClearanceIssueCount > 0 ||
  junctionVoxelAStar.metrics.connectorCollisionCount > 0 ||
  junctionVoxelAStar.metrics.directionReversalCount > 0 ||
  junctionVoxelAStar.metrics.portApproachViolationCount > 0 ||
  junctionVoxelAStar.metrics.protectedFrontViolationCount > 0 ||
  junctionVoxelAStar.metrics.roundedCableClearanceIssueCount > 0 ||
  junctionVoxelAStar.metrics.unrelatedDeviceFrontViolationCount > 0
) {
  throw new Error(
    `Refusing to publish an incomplete junction-box voxel route set: ${JSON.stringify({
      failedRouteIds: junctionVoxelAStar.failedRouteIds,
      metrics: junctionVoxelAStar.metrics,
    })}`,
  );
}

const document = {
  checkedOn: "2026-08-20",
  scope: "The promoted production routing: every protected endpoint-derived wall/floor route, all four PV string home runs, and the complete junction-box harness. Short array dressings and other fixed site cables retain their direct physical paths.",
  voxelAStar,
  junctionVoxelAStar,
};

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(
  `Wrote ${outputPath}\n` +
  `Voxel A*: ${voxelAStar.metrics.totalLengthM} m / ${voxelAStar.metrics.totalTurns} turns / ` +
  `${voxelAStar.metrics.cableClearanceIssueCount} clearance issues\n` +
  `Junction voxel A*: ${junctionVoxelAStar.metrics.totalLengthM} m / ` +
  `${junctionVoxelAStar.metrics.totalTurns} turns / ${junctionVoxelAStar.metrics.cableClearanceIssueCount} clearance issues\n`,
);
