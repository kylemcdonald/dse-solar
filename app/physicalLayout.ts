import optimizedPhysicalLayoutRaw from "../data/optimized-physical-layout.json" with { type: "json" };
import { physicalCableRadiusM } from "./cableSpecifications.ts";
import type { PhysicalLayoutSpecification } from "./physicalLayoutSolver";

type OptimizedPhysicalLayoutDocument = {
  elapsedSeconds?: number;
  evaluations?: number;
  generations?: number;
  improvementPercent?: number;
  requestedTimeBudgetSeconds?: number;
  status?: string;
  runtime?: {
    specification?: PhysicalLayoutSpecification;
  };
};

const optimizedPhysicalLayout = optimizedPhysicalLayoutRaw as OptimizedPhysicalLayoutDocument;

if (!optimizedPhysicalLayout.runtime?.specification) {
  throw new Error("The offline physical-layout optimizer has not produced a static specification");
}

// Device positions and route centerlines remain the frozen optimizer artifact,
// while cable radii come from the separately audited product specification.
// This prevents a stale optimizer run from silently restoring old illustrative
// diameters, and keeps both ends of every route on the same physical OD.
const rawSpecification = optimizedPhysicalLayout.runtime.specification;
const normalizedRoutes = Object.fromEntries(Object.entries(rawSpecification.routes).map(([id, route]) => [id, {
  ...route,
  radiusM: physicalCableRadiusM(id),
}]));
const radiusByPort = new Map<string, number>();
Object.values(normalizedRoutes).forEach((route) => {
  [route.sourcePortId, route.targetPortId].forEach((portId) => {
    if (!portId) return;
    radiusByPort.set(portId, Math.max(radiusByPort.get(portId) ?? 0, route.radiusM));
  });
});

export const physicalLayout: PhysicalLayoutSpecification = {
  ...rawSpecification,
  routes: normalizedRoutes,
  portSpecifications: Object.fromEntries(Object.entries(rawSpecification.portSpecifications).map(([id, port]) => [id, {
    ...port,
    cableRadiusM: radiusByPort.get(id) ?? port.cableRadiusM,
  }])),
};

export const physicalLayoutOptimization = {
  elapsedSeconds: optimizedPhysicalLayout.elapsedSeconds ?? 0,
  evaluations: optimizedPhysicalLayout.evaluations ?? 0,
  generations: optimizedPhysicalLayout.generations ?? 0,
  improvementPercent: optimizedPhysicalLayout.improvementPercent ?? 0,
  requestedTimeBudgetSeconds: optimizedPhysicalLayout.requestedTimeBudgetSeconds ?? 0,
  status: optimizedPhysicalLayout.status ?? "unavailable",
};
