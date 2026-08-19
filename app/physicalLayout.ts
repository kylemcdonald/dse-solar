import optimizedPhysicalLayoutRaw from "../data/optimized-physical-layout.json" with { type: "json" };
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

// The browser consumes only this frozen optimizer artifact. It never invokes
// the placement or cable-routing solver and keeps no editable layout state.
export const physicalLayout = optimizedPhysicalLayout.runtime.specification;

export const physicalLayoutOptimization = {
  elapsedSeconds: optimizedPhysicalLayout.elapsedSeconds ?? 0,
  evaluations: optimizedPhysicalLayout.evaluations ?? 0,
  generations: optimizedPhysicalLayout.generations ?? 0,
  improvementPercent: optimizedPhysicalLayout.improvementPercent ?? 0,
  requestedTimeBudgetSeconds: optimizedPhysicalLayout.requestedTimeBudgetSeconds ?? 0,
  status: optimizedPhysicalLayout.status ?? "unavailable",
};
