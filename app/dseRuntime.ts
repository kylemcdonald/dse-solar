import artifactJson from "../data/generated/dse-runtime.json";
import { dseTopology } from "./dseTopology";
import type { GraphRuntime, GraphRuntimeArtifact } from "./systemGraph";

const artifact = artifactJson as unknown as GraphRuntimeArtifact;
const started = typeof performance === "undefined" ? Date.now() : performance.now();

if (artifact.schemaVersion !== 1) {
  throw new Error(`Unsupported precomputed runtime schema ${artifact.schemaVersion}`);
}
if (artifact.graphId !== dseTopology.id || artifact.graphRevision !== dseTopology.revision) {
  throw new Error(
    `Stale precomputed runtime ${artifact.graphId}@${artifact.graphRevision}; expected ${dseTopology.id}@${dseTopology.revision}. Run npm run generate:runtime.`,
  );
}
if (
  artifact.devices.length !== dseTopology.devices.length
  || artifact.routes.length !== dseTopology.connections.length
) {
  throw new Error("Precomputed runtime cardinality does not match the canonical graph. Run npm run generate:runtime.");
}

const deviceById = new Map(artifact.devices.map((device) => [device.id, device]));
const conductorByKey = new Map(artifact.conductors.map((candidate) => [candidate.key, candidate]));
const routeById = new Map(artifact.routes.map((route) => [route.id, route]));
const finished = typeof performance === "undefined" ? Date.now() : performance.now();

/** One statically solved graph shared by the diagram and 3D scene. Hydration
 * only rebuilds three indexes and never imports or runs voxel A*. */
export const dseRuntime: GraphRuntime = {
  graph: dseTopology,
  devices: artifact.devices,
  deviceById,
  conductors: artifact.conductors,
  conductorByKey,
  glands: artifact.glands,
  routes: artifact.routes,
  routeById,
  diagnostics: {
    ...artifact.diagnostics,
    buildMs: 0,
    hydrateMs: finished - started,
    source: "precomputed",
    artifactBytes: JSON.stringify(artifact).length,
  },
};
