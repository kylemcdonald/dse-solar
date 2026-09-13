import { graphConnectionDisplayLabel, graphEndpointDisplayLabel, graphWalls } from "./systemGraph";
import type { GraphRuntime, SystemGraph } from "./systemGraph";
import { verifyCurrentProtection } from "./currentSafety";
import { resolveSystemGeometry } from "./physicalLayout";
import {
  renderedGeometryFailureDiagnostics,
  sampledRenderedGeometryConflicts,
  sampledRouteCenterlineConflicts,
  sampledRouteDeviceConflicts,
  sampledRouteSiteConflicts,
  sampledRouteSelfIntersections,
  sampledRouteSweptCableConflicts,
  sampledRouteWallPlaneCrossings,
} from "./routeAudits";
import { routeConnections } from "./voxelRouter";
import type { RouterOptions } from "./voxelRouter";

export { verifyCurrentProtection } from "./currentSafety";
export { resolveSystemGeometry } from "./physicalLayout";
export {
  renderedGeometryFailureDiagnostics,
  sampledRenderedGeometryConflicts,
  sampledResolvedDeviceOverlaps,
  sampledRouteCenterlineConflicts,
  sampledRouteDeviceConflicts,
  sampledRouteSelfIntersections,
  sampledRouteSweptCableConflicts,
  sampledRouteWallPlaneCrossings,
} from "./routeAudits";
export { routeConnections, buildVoxelGrid } from "./voxelRouter";

export const routingFailureDiagnostics: Array<{ owner: string; space: string; expansions: number; reason: string }> = [];
export const routingTargetAssignmentDiagnostics: Array<{
  connectionId: string;
  side: "from" | "to";
  authoredEndpoint: string;
  resolvedEndpoint: string;
}> = [];

export type BuildOptions = RouterOptions & {
  /** Run the exact rounded-tube renderer audit. It is slow (tens of seconds)
   * and only needed as a release gate, so the generator opts in explicitly. */
  renderedAudit?: boolean;
};

let cached: GraphRuntime | undefined;
let cachedInputGraph: SystemGraph | undefined;
let cachedOptionsKey = "";

/**
 * Cold build: validate → place devices → route cables → fast audits → current
 * safety. Every stage is deterministic in the graph alone.
 */
export function buildSystemRuntime(graph: SystemGraph, options: BuildOptions = {}): GraphRuntime {
  const optionsKey = JSON.stringify(options);
  if (cached && cachedInputGraph === graph && cachedOptionsKey === optionsKey) return cached;
  const started = performance.now();
  const geometry = resolveSystemGeometry(graph);
  const routing = routeConnections(graph, geometry.devices, geometry.conductors, geometry.glands, options);
  routingFailureDiagnostics.length = 0;
  routing.diagnostics.failures.forEach((failure) => routingFailureDiagnostics.push({
    owner: failure.connectionId, space: "world", expansions: 0, reason: failure.reason,
  }));
  routingTargetAssignmentDiagnostics.length = 0;
  routingTargetAssignmentDiagnostics.push(...routing.diagnostics.targetAssignments);

  const resolvedGraph: SystemGraph = {
    ...graph,
    connections: routing.routes.map((route) => {
      const original = graph.connections.find((connection) => connection.id === route.id)!;
      return { ...original, from: route.from, to: route.to };
    }),
  };
  const devices = geometry.devices.map((device) => ({
    ...device,
    conductors: device.conductors.map((conductor) => ({
      ...conductor,
      label: graphEndpointDisplayLabel(resolvedGraph, `${device.id}.${conductor.id}`),
    })),
  }));
  const conductors = geometry.conductors.map((conductor) => ({
    ...conductor,
    label: graphEndpointDisplayLabel(resolvedGraph, conductor.key),
  }));
  const routes = routing.routes.map((route) => ({
    ...route,
    label: route.label ?? graphConnectionDisplayLabel(resolvedGraph, route),
  }));
  const routingMs = routing.diagnostics.routingMs;

  const centerlineConflicts = sampledRouteCenterlineConflicts(routes, 0.0005).length;
  const sweptCableConflicts = sampledRouteSweptCableConflicts(routes, resolvedGraph).length;
  const selfIntersections = sampledRouteSelfIntersections(routes).length;
  const deviceConflicts = sampledRouteDeviceConflicts(routes, devices).length + sampledRouteSiteConflicts(routes, graph).length;
  const wallCrossings = sampledRouteWallPlaneCrossings(routes, devices, graphWalls(graph));
  const auditStarted = performance.now();
  renderedGeometryFailureDiagnostics.length = 0;
  const renderedGeometryConflicts = options.renderedAudit
    ? sampledRenderedGeometryConflicts(routes, devices, conductors, resolvedGraph).length
    : 0;
  const renderedAuditMs = performance.now() - auditStarted;
  const currentSafety = verifyCurrentProtection(resolvedGraph);

  const runtime: GraphRuntime = {
    graph: resolvedGraph,
    devices,
    deviceById: new Map(devices.map((device) => [device.id, device])),
    conductors,
    conductorByKey: new Map(conductors.map((conductor) => [conductor.key, conductor])),
    glands: geometry.glands,
    routes,
    routeById: new Map(routes.map((route) => [route.id, route])),
    diagnostics: {
      buildMs: performance.now() - started,
      routingMs,
      renderedAuditMs,
      hydrateMs: 0,
      source: "solver",
      artifactBytes: 0,
      routed: routing.diagnostics.routed,
      fallbacks: routing.diagnostics.fallbacks,
      occupiedCells: routing.diagnostics.occupiedCells,
      centerlineConflicts,
      sweptCableConflicts,
      selfIntersections,
      deviceConflicts,
      renderedGeometryConflicts,
      totalLengthM: Number(routing.diagnostics.totalLengthM.toFixed(4)),
      totalTurns: routing.diagnostics.totalTurns,
      routingOrder: routing.diagnostics.routingOrder,
      routingTargetAssignments: routing.diagnostics.targetAssignments,
      currentSafety,
    },
  };
  if (wallCrossings.length > 0) {
    runtime.diagnostics.deviceConflicts += wallCrossings.length;
    routingFailureDiagnostics.push(...wallCrossings.map((crossing) => ({ owner: String(crossing), space: "wall", expansions: 0, reason: "crosses the equipment wall outside the penetration" })));
  }
  cached = runtime;
  cachedInputGraph = graph;
  cachedOptionsKey = optionsKey;
  return runtime;
}
