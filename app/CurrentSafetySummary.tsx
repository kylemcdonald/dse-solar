"use client";

import { dseRuntime } from "./dseRuntime";

/** Compact, view-independent result from the deterministic protection audit.
 * Procurement and commissioning state remain separate from this graph result. */
export function CurrentSafetySummary() {
  const report = dseRuntime.diagnostics.currentSafety;
  const circuits = dseRuntime.graph.powerCircuits ?? [];
  const withinCapacity = circuits.filter((circuit) => circuit.normalStatus === "within-capacity").length;
  const overCapacity = circuits.filter((circuit) => circuit.normalStatus === "over-capacity").length;
  const conditionalCapacity = circuits.filter((circuit) => (
    circuit.normalStatus === "conditional" || circuit.normalStatus === "variable"
  )).length;
  const faultHolds = circuits.filter((circuit) => circuit.faultStatus === "incomplete").length;
  const faultChecks = circuits.filter((circuit) => circuit.faultStatus === "provisional").length;
  const detail = report.limitations.length > 0
    ? report.limitations.join(" ")
    : "Every energized active conductor and explicitly paired return was traversed from its declared supply.";
  return (
    <span
      className={`current-safety-summary current-safety-${report.status}`}
      role="status"
      aria-label={`Normal power audit: ${withinCapacity} circuits within capacity, ${conditionalCapacity} conditional or variable, and ${overCapacity} over capacity. Circuit-level fault audit: ${faultHolds} design holds and ${faultChecks} verification items. Detailed conductor audit ${report.status}.`}
      title={`Normal load and fault protection are separate. ${detail}`}
      data-current-safety-status={report.status}
      data-current-safety-errors={report.errors.length}
      data-current-safety-warnings={report.warnings.length}
      data-power-circuits={circuits.length}
      data-power-within-capacity={withinCapacity}
      data-power-over-capacity={overCapacity}
      data-power-conditional-capacity={conditionalCapacity}
      data-fault-circuit-holds={faultHolds}
      data-fault-circuit-checks={faultChecks}
    >
      <span className="current-safety-dot" aria-hidden="true" />
      Normal {withinCapacity} clear / {conditionalCapacity} conditional / {overCapacity} over · Fault {faultHolds} holds / {faultChecks} verify
    </span>
  );
}
