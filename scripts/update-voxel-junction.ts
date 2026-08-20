import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { solveVoxelJunctionRoutes } from "../app/voxelJunctionRouter.ts";

const outputPath = fileURLToPath(new URL("../data/voxel-routing-comparison.json", import.meta.url));
const document = JSON.parse(await readFile(outputPath, "utf8"));
const junctionVoxelAStar = solveVoxelJunctionRoutes();

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
  throw new Error(`Junction voxel publish gate failed: ${JSON.stringify(junctionVoxelAStar)}`);
}

document.junctionVoxelAStar = junctionVoxelAStar;
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, metrics: junctionVoxelAStar.metrics, solveMs: junctionVoxelAStar.solveMs }, null, 2)}\n`);
