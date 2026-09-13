import { performance } from "node:perf_hooks";
import { buildDiagramLayout } from "../app/diagramLayout";
import { dseRuntime } from "../app/dseRuntime";
const ids = [undefined, ...dseRuntime.graph.junctions.map((j) => j.deviceId)];
const t0 = performance.now();
for (const id of ids) {
  const t = performance.now();
  const l = buildDiagramLayout(id);
  console.log(JSON.stringify({ scope: id ?? "system", ms: Math.round(performance.now() - t), nodes: l.nodes.length, wires: l.wires.length, w: l.width, h: l.height,
    crossings: l.bridgedCrossings, unbridged: l.unbridgedCrossings, turns: l.wireTurns, length: l.wireLength, fallbacks: l.routingFallbacks, fallbackIds: l.fallbackRouteIds,
    coincident: l.coincidentSegments, diagonal: l.nonOrthogonalSegments, overlaps: l.conductorOverlaps, nodeBody: l.nodeBodyCrossings, nodeOverlaps: l.nodeOverlaps, minSep: l.minimumParallelWireSeparation }));
}
console.log("total ms", Math.round(performance.now() - t0));
