import { performance } from "node:perf_hooks";
import { dseTopology } from "../app/dseTopology";
import {
  buildSystemRuntime,
  renderedGeometryFailureDiagnostics,
  sampledResolvedDeviceOverlaps,
  sampledRouteCenterlineConflicts,
  sampledRouteDeviceConflicts,
  sampledRouteSelfIntersections,
  sampledRouteSweptCableConflicts,
  sampledRouteWallPlaneCrossings,
} from "../app/systemGraphRuntime";

const started = performance.now();
const last = buildSystemRuntime(dseTopology);
const elapsedMs = performance.now() - started;
console.log(JSON.stringify({
  algorithm: "serial radius-aware weighted voxel A* with turn penalty",
  devices: last.devices.length,
  conductors: last.conductors.length,
  routes: last.routes.length,
  fallbacks: last.diagnostics.fallbacks,
  centerlineConflicts: last.diagnostics.centerlineConflicts,
  sweptCableConflicts: last.diagnostics.sweptCableConflicts,
  selfIntersections: last.diagnostics.selfIntersections,
  deviceConflicts: last.diagnostics.deviceConflicts,
  renderedGeometryConflicts: last.diagnostics.renderedGeometryConflicts,
  resolvedDeviceOverlaps: sampledResolvedDeviceOverlaps(last.devices).length,
  wallVolumeCrossings: sampledRouteWallPlaneCrossings(last.routes, last.devices).length,
  conflictDetails: {
    centerline: sampledRouteCenterlineConflicts(last.routes, 0.0005),
    swept: sampledRouteSweptCableConflicts(last.routes, dseTopology),
    self: sampledRouteSelfIntersections(last.routes),
    device: sampledRouteDeviceConflicts(last.routes, last.devices),
    resolvedDevices: sampledResolvedDeviceOverlaps(last.devices),
    wallVolume: sampledRouteWallPlaneCrossings(last.routes, last.devices),
    renderedGeometry: renderedGeometryFailureDiagnostics,
  },
  totalLengthM: Number(last.diagnostics.totalLengthM.toFixed(3)),
  totalTurns: last.diagnostics.totalTurns,
  routingMs: Number(last.diagnostics.routingMs.toFixed(1)),
  renderedAuditMs: Number(last.diagnostics.renderedAuditMs.toFixed(1)),
  totalBuildMs: Number(last.diagnostics.buildMs.toFixed(1)),
  commandMs: Number(elapsedMs.toFixed(1)),
}, null, 2));
if (
  last.diagnostics.fallbacks !== 0
  || last.diagnostics.centerlineConflicts !== 0
  || last.diagnostics.sweptCableConflicts !== 0
  || last.diagnostics.selfIntersections !== 0
  || last.diagnostics.deviceConflicts !== 0
  || last.diagnostics.renderedGeometryConflicts !== 0
  || sampledResolvedDeviceOverlaps(last.devices).length !== 0
  || sampledRouteWallPlaneCrossings(last.routes, last.devices).length !== 0
  || last.diagnostics.buildMs > 60_000
) process.exitCode = 1;
