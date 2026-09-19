import { glandCrossingFailures } from "../app/glandAudit";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { graphWalls, type GraphRuntimeArtifact, type SystemGraph } from "../app/systemGraph";
import { buildSystemRuntime, routingFailureDiagnostics, renderedGeometryFailureDiagnostics, sampledResolvedDeviceOverlaps, sampledRouteWallPlaneCrossings } from "../app/systemGraphRuntime";

/** Shared cache inputs and mandatory physical/rendered gates for every project. */
const generatorVersion="shared-runtime-v2";
export async function runtimeSourceHash(graph:SystemGraph, projectInputs:string[], wallPlanSourceHash:string|null=null) {
 const commonInputs=["systemGraph.ts","systemGraphRuntime.ts","physicalLayout.ts","voxelRouter.ts","routeAudits.ts","currentSafety.ts","renderedCableGeometry.ts","glandAudit.ts","glandGeometry.ts"];
 const hash=createHash("sha256").update(generatorVersion).update(JSON.stringify(graph)).update(wallPlanSourceHash??"");
 for(const name of [...commonInputs.map(n=>"app/"+n),"scripts/runtimeArtifact.ts",...projectInputs])hash.update(name).update(await readFile(name));
 return hash.digest("hex");
}
export async function generateRuntimeArtifact(graph:SystemGraph, outputPath:string, projectInputs:string[], wallPlanSourceHash:string|null=null) {
 const sourceHash=await runtimeSourceHash(graph,projectInputs,wallPlanSourceHash);
 try {
  const previous=JSON.parse(await readFile(outputPath,"utf8")) as GraphRuntimeArtifact;
  if(previous.sourceHash===sourceHash && previous.schemaVersion===2 && previous.graphId===graph.id && previous.graphRevision===graph.revision){console.log(`${outputPath} is current; skipped voxel solve.`);return;}
 } catch { /* Missing or stale artifact is rebuilt. */ }
const started = performance.now();
const runtime = buildSystemRuntime(graph, { renderedAudit: true });
const glandFailures=glandCrossingFailures(runtime);
const invalidDiagnostics = [
  ["gland-bore conflicts",glandFailures.length],
  ["fallbacks", runtime.diagnostics.fallbacks],
  ["centerline conflicts", runtime.diagnostics.centerlineConflicts],
  ["swept-cable conflicts", runtime.diagnostics.sweptCableConflicts],
  ["self-intersections", runtime.diagnostics.selfIntersections],
  ["device conflicts", runtime.diagnostics.deviceConflicts],
  ["rendered-geometry conflicts", runtime.diagnostics.renderedGeometryConflicts],
  ["resolved-device overlaps", sampledResolvedDeviceOverlaps(runtime.devices).length],
  ["wall-volume crossings", sampledRouteWallPlaneCrossings(runtime.routes, runtime.devices, graphWalls(graph)).length],
] as const;
const failures = invalidDiagnostics.filter(([, count]) => count !== 0);
if (failures.length > 0) {
  console.error(JSON.stringify({ routing: routingFailureDiagnostics, rendered: renderedGeometryFailureDiagnostics, glands:glandFailures }, null, 2));
  throw new Error(`Refusing to serialize invalid runtime: ${failures.map(([label, count]) => `${count} ${label}`).join(", ")}`);
}
const artifact: GraphRuntimeArtifact & { wallPlanSourceHash: string | null } = {
  schemaVersion: 2,
  generatorVersion: generatorVersion,
  sourceHash,
  wallPlanSourceHash: wallPlanSourceHash,
  graphId: graph.id,
  graphRevision: graph.revision,
  devices: runtime.devices,
  conductors: runtime.conductors,
  glands: runtime.glands,
  routes: runtime.routes,
  diagnostics: {
    routingMs: runtime.diagnostics.routingMs,
    renderedAuditMs: runtime.diagnostics.renderedAuditMs,
    routed: runtime.diagnostics.routed,
    fallbacks: runtime.diagnostics.fallbacks,
    occupiedCells: runtime.diagnostics.occupiedCells,
    centerlineConflicts: runtime.diagnostics.centerlineConflicts,
    sweptCableConflicts: runtime.diagnostics.sweptCableConflicts,
    selfIntersections: runtime.diagnostics.selfIntersections,
    deviceConflicts: runtime.diagnostics.deviceConflicts,
    renderedGeometryConflicts: runtime.diagnostics.renderedGeometryConflicts,
    totalLengthM: runtime.diagnostics.totalLengthM,
    totalTurns: runtime.diagnostics.totalTurns,
    routingOrder: runtime.diagnostics.routingOrder,
    routingTargetAssignments: runtime.diagnostics.routingTargetAssignments,
    currentSafety: runtime.diagnostics.currentSafety,
  },
};
const encoded = `${JSON.stringify(artifact)}\n`;
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, encoded);
console.log(
  `Generated ${outputPath} in ${((performance.now() - started) / 1000).toFixed(2)} s `
  + `(${Buffer.byteLength(encoded).toLocaleString()} bytes, ${sourceHash.slice(0, 12)}).`,
);

}
