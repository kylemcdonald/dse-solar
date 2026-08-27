import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dseTopology } from "../app/dseTopology";
import {
  buildSystemRuntime,
  sampledResolvedDeviceOverlaps,
  sampledRouteWallPlaneCrossings,
} from "../app/systemGraphRuntime";
import type { GraphRuntimeArtifact } from "../app/systemGraph";

const SCHEMA_VERSION = 2 as const;
const GENERATOR_VERSION = "dse-runtime-v3-current-safety";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outputPath = path.join(root, "data", "generated", "dse-runtime.json");
const inputPaths = [
  path.join(root, "app", "dseTopology.ts"),
  path.join(root, "app", "systemGraph.ts"),
  path.join(root, "app", "systemGraphRuntime.ts"),
  path.join(root, "app", "renderedCableGeometry.ts"),
  fileURLToPath(import.meta.url),
];

const hash = createHash("sha256");
hash.update(`${SCHEMA_VERSION}:${GENERATOR_VERSION}\n`);
for (const inputPath of inputPaths) {
  hash.update(path.relative(root, inputPath));
  hash.update("\0");
  hash.update(await readFile(inputPath));
  hash.update("\0");
}
const sourceHash = hash.digest("hex");

try {
  const existing = JSON.parse(await readFile(outputPath, "utf8")) as Partial<GraphRuntimeArtifact>;
  if (
    existing.schemaVersion === SCHEMA_VERSION
    && existing.generatorVersion === GENERATOR_VERSION
    && existing.sourceHash === sourceHash
    && existing.graphId === dseTopology.id
    && existing.graphRevision === dseTopology.revision
  ) {
    console.log(`Runtime artifact is current (${sourceHash.slice(0, 12)}); skipped voxel solve.`);
    process.exit(0);
  }
} catch {
  // A missing, malformed, or old artifact simply triggers a fresh solve.
}

const started = performance.now();
const runtime = buildSystemRuntime(dseTopology);
const invalidDiagnostics = [
  ["fallbacks", runtime.diagnostics.fallbacks],
  ["centerline conflicts", runtime.diagnostics.centerlineConflicts],
  ["swept-cable conflicts", runtime.diagnostics.sweptCableConflicts],
  ["self-intersections", runtime.diagnostics.selfIntersections],
  ["device conflicts", runtime.diagnostics.deviceConflicts],
  ["rendered-geometry conflicts", runtime.diagnostics.renderedGeometryConflicts],
  ["resolved-device overlaps", sampledResolvedDeviceOverlaps(runtime.devices).length],
  ["wall-volume crossings", sampledRouteWallPlaneCrossings(runtime.routes, runtime.devices).length],
] as const;
const failures = invalidDiagnostics.filter(([, count]) => count !== 0);
if (failures.length > 0) {
  throw new Error(`Refusing to serialize invalid runtime: ${failures.map(([label, count]) => `${count} ${label}`).join(", ")}`);
}
const artifact: GraphRuntimeArtifact = {
  schemaVersion: SCHEMA_VERSION,
  generatorVersion: GENERATOR_VERSION,
  sourceHash,
  graphId: dseTopology.id,
  graphRevision: dseTopology.revision,
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
    currentSafety: runtime.diagnostics.currentSafety,
  },
};
const encoded = `${JSON.stringify(artifact)}\n`;
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, encoded);
console.log(
  `Generated ${path.relative(root, outputPath)} in ${((performance.now() - started) / 1000).toFixed(2)} s `
  + `(${Buffer.byteLength(encoded).toLocaleString()} bytes, ${sourceHash.slice(0, 12)}).`,
);
