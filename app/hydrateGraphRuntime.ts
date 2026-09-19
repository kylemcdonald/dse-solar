import type { SystemGraph, GraphRuntime, GraphRuntimeArtifact } from "./systemGraph";
export function hydrateGraphRuntime(graph: SystemGraph, artifact: GraphRuntimeArtifact): GraphRuntime {
const started = typeof performance === "undefined" ? Date.now() : performance.now();

if (artifact.schemaVersion !== 2) {
  throw new Error(`Unsupported precomputed runtime schema ${artifact.schemaVersion}`);
}
if (artifact.graphId !== graph.id || artifact.graphRevision !== graph.revision) {
  throw new Error(
    `Stale precomputed runtime ${artifact.graphId}@${artifact.graphRevision}; expected ${graph.id}@${graph.revision}. Run npm run generate:runtime.`,
  );
}
if (
  artifact.devices.length !== graph.devices.length
  || artifact.routes.length !== graph.connections.length
) {
  throw new Error("Precomputed runtime cardinality does not match the canonical graph. Run npm run generate:runtime.");
}

const deviceById = new Map(artifact.devices.map((device) => [device.id, device]));
const conductorByKey = new Map(artifact.conductors.map((candidate) => [candidate.key, candidate]));
const routeById = new Map(artifact.routes.map((route) => [route.id, route]));
const resolvedConnections = graph.connections.map((connection) => {
  const route = routeById.get(connection.id);
  if (!route) throw new Error(`Precomputed runtime is missing route ${connection.id}.`);
  return { ...connection, from: route.from, to: route.to };
});
const resolvedTopology = { ...graph, connections: resolvedConnections };
const finished = typeof performance === "undefined" ? Date.now() : performance.now();

/** One statically solved graph shared by the diagram and 3D scene. Hydration
 * only rebuilds three indexes and never imports or runs voxel A*. */
return {
  graph: resolvedTopology,
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

}
