import { readFileSync } from "node:fs";
import {
  buildDiagramLayout,
  type DiagramMacroCenterOverrides,
} from "../app/UnifiedSystemDiagram";
import type { DiagramExactMetrics } from "./diagram-layout-optimizer-core";

const overrides = JSON.parse(readFileSync(0, "utf8")) as DiagramMacroCenterOverrides;
const layout = buildDiagramLayout(undefined, overrides);
const ownerByEndpoint = new Map(layout.nodes.flatMap((node) => node.ports.map((port) => [
  port.endpointId,
  { node, port },
] as const)));
const flowViolations = layout.wires.filter((wire) => {
  const from = ownerByEndpoint.get(wire.fromEndpointId);
  const to = ownerByEndpoint.get(wire.toEndpointId);
  if (!from || !to) return false;
  if (from.port.side === "output" && to.port.side === "input") return from.node.x > to.node.x;
  if (from.port.side === "input" && to.port.side === "output") return to.node.x > from.node.x;
  return false;
}).length;
const metrics: DiagramExactMetrics = {
  nodeCount: layout.nodes.length,
  portCount: layout.nodes.reduce((sum, node) => sum + node.ports.length, 0),
  wireCount: layout.wires.length,
  width: layout.width,
  height: layout.height,
  routingFallbacks: layout.routingFallbacks,
  coincidentSegments: layout.coincidentSegments,
  nonOrthogonalSegments: layout.nonOrthogonalSegments,
  conductorOverlaps: layout.conductorOverlaps,
  unbridgedCrossings: layout.unbridgedCrossings,
  parallelEnvelopeOverlaps: layout.parallelEnvelopeOverlaps,
  nodeBodyCrossings: layout.nodeBodyCrossings,
  maskedNodeBodyCrossings: layout.maskedNodeBodyCrossings,
  nodeOverlaps: layout.nodeOverlaps,
  minimumParallelWireSeparation: layout.minimumParallelWireSeparation,
  bridgedCrossings: layout.bridgedCrossings,
  wireTurns: layout.wireTurns,
  wireLength: layout.wireLength,
  flowViolations,
};
const cutoff = layout.nodes.find((node) => node.device.componentId === "batteryCutoff");
const batteries = layout.nodes.filter((node) => node.device.kind === "battery");
const batteryCenter = batteries.length === 0 ? undefined : {
  x: batteries.reduce((sum, node) => sum + node.x, 0) / batteries.length,
  y: batteries.reduce((sum, node) => sum + node.y, 0) / batteries.length,
};
const batteryCutoffDistance = cutoff && batteryCenter
  ? Math.abs(cutoff.x - batteryCenter.x) + Math.abs(cutoff.y - batteryCenter.y)
  : Number.POSITIVE_INFINITY;

console.log(JSON.stringify({ metrics, batteryCutoffDistance }));
