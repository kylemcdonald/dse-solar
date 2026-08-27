"use client";

import { dseRuntime } from "./dseRuntime";

/** Compact, view-independent result from the deterministic protection audit.
 * Procurement and commissioning state remain separate from this graph result. */
export function CurrentSafetySummary() {
  const report = dseRuntime.diagnostics.currentSafety;
  const issueCount = report.errors.length + report.warnings.length;
  const detail = report.limitations.length > 0
    ? report.limitations.join(" ")
    : "Every energized active conductor and explicitly paired return was traversed from its declared supply.";
  return (
    <span
      className={`current-safety-summary current-safety-${report.status}`}
      role="status"
      aria-label={`Current protection audit ${report.status}: ${report.errors.length} errors and ${report.warnings.length} warnings`}
      title={detail}
      data-current-safety-status={report.status}
      data-current-safety-errors={report.errors.length}
      data-current-safety-warnings={report.warnings.length}
    >
      <span className="current-safety-dot" aria-hidden="true" />
      OCP {report.status}{issueCount > 0 ? ` · ${report.errors.length}E ${report.warnings.length}W` : ""}
    </span>
  );
}
