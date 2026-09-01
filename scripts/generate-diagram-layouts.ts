import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDiagramLayout } from "../app/UnifiedSystemDiagram";
import { dseRuntime } from "../app/dseRuntime";

const SCHEMA_VERSION = 1 as const;
const GENERATOR_VERSION = "dse-diagram-layout-v18-routing-derived-busbar-slots";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outputPath = path.join(root, "data", "generated", "diagram-layouts.json");
const sourcePaths = [
  path.join(root, "app", "UnifiedSystemDiagram.tsx"),
  path.join(root, "app", "dseTopology.ts"),
  path.join(root, "data", "generated", "dse-runtime.json"),
  fileURLToPath(import.meta.url),
];
const hash = createHash("sha256");
hash.update(`${SCHEMA_VERSION}:${GENERATOR_VERSION}\n`);
for (const sourcePath of sourcePaths) {
  hash.update(path.relative(root, sourcePath));
  hash.update("\0");
  hash.update(await readFile(sourcePath));
  hash.update("\0");
}
const sourceHash = hash.digest("hex");

try {
  const existing = JSON.parse(await readFile(outputPath, "utf8")) as {
    schemaVersion?: number;
    generatorVersion?: string;
    sourceHash?: string;
    graphId?: string;
    graphRevision?: string;
  };
  if (existing.schemaVersion === SCHEMA_VERSION
    && existing.generatorVersion === GENERATOR_VERSION
    && existing.sourceHash === sourceHash
    && existing.graphId === dseRuntime.graph.id
    && existing.graphRevision === dseRuntime.graph.revision) {
    console.log(`Diagram layout artifact is current (${sourceHash.slice(0, 12)}); skipped generation.`);
    process.exit(0);
  }
} catch {
  // A missing, malformed, or old artifact triggers deterministic regeneration.
}

type SerializedNode = Omit<ReturnType<typeof buildDiagramLayout>["nodes"][number], "device"> & { deviceId: string };
type SerializedWire = Omit<ReturnType<typeof buildDiagramLayout>["wires"][number], "route"> & { routeId: string };

const serializeLayout = (junctionId?: string) => {
  const layout = buildDiagramLayout(junctionId);
  if (layout.routingFallbacks !== 0 || layout.coincidentSegments !== 0 || layout.nonOrthogonalSegments !== 0
    || layout.unbridgedCrossings !== 0
    || layout.conductorOverlaps !== 0 || layout.parallelEnvelopeOverlaps !== 0 || layout.nodeBodyCrossings !== 0
    || layout.nodeOverlaps !== 0 || layout.minimumParallelWireSeparation < 12) {
    const fallbackIds = new Set(layout.fallbackRouteIds);
    if (fallbackIds.size > 0) console.error("Diagram fallback geometry:", JSON.stringify({
      nodes: layout.nodes.filter((node) => [
        "acJunction", "multiAcInBreakout", "multiPlus", "multiAcOutBreakout", "unifi",
      ].includes(node.device.id)).map((node) => ({
        id: node.device.id, x: node.x, y: node.y, width: node.width, height: node.height,
        ports: node.ports.map((port) => ({ id: port.endpointId, side: port.side, offset: port.offset })),
      })),
      wires: layout.wires.filter((wire) => fallbackIds.has(wire.route.id)).map((wire) => ({
        id: wire.route.id, from: wire.fromEndpointId, to: wire.toEndpointId, points: wire.points,
      })),
    }));
    throw new Error(`${layout.key}: invalid diagram geometry (${layout.routingFallbacks} fallbacks`
      + `${layout.fallbackRouteIds.length ? ` [${layout.fallbackRouteIds.join(", ")}]` : ""}, `
      + `${layout.coincidentSegments} coincident segments, ${layout.nonOrthogonalSegments} diagonal segments, `
      + `${layout.unbridgedCrossings} unbridged crossings, ${layout.conductorOverlaps} overlapping conductors, `
      + `${layout.parallelEnvelopeOverlaps} parallel cable-envelope overlaps, `
      + `${layout.minimumParallelWireSeparation}px minimum parallel wire separation, `
      + `${layout.nodeBodyCrossings} node-body crossings, ${layout.nodeOverlaps} node overlaps)`);
  }
  return {
    ...layout,
    routingMs: 0,
    layoutMs: 0,
    junction: undefined,
    junctionId: layout.junction?.id,
    nodes: layout.nodes.map(({ device, ...node }): SerializedNode => ({ ...node, deviceId: device.id })),
    wires: layout.wires.map(({ route, ...wire }): SerializedWire => ({ ...wire, routeId: route.id })),
  };
};

const junctionIds = dseRuntime.graph.junctions.map((junction) => junction.deviceId);
const started = performance.now();
const artifact = {
  schemaVersion: SCHEMA_VERSION,
  generatorVersion: GENERATOR_VERSION,
  sourceHash,
  graphId: dseRuntime.graph.id,
  graphRevision: dseRuntime.graph.revision,
  layouts: Object.fromEntries([
    ["system", serializeLayout()],
    ...junctionIds.map((junctionId) => [junctionId, serializeLayout(junctionId)] as const),
  ]),
};
const encoded = `${JSON.stringify(artifact)}\n`;
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, encoded);
console.log(`Generated ${path.relative(root, outputPath)} in ${(performance.now() - started).toFixed(1)} ms `
  + `(${Buffer.byteLength(encoded).toLocaleString()} bytes, ${sourceHash.slice(0, 12)}).`);
