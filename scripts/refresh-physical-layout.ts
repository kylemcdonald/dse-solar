import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { solvePhysicalLayout } from "../app/physicalLayoutSolver.ts";

const outputPath = fileURLToPath(new URL("../data/optimized-physical-layout.json", import.meta.url));
const existing = JSON.parse(await readFile(outputPath, "utf8"));
// Persist the same exhaustive deterministic result that the production
// renderer and specification tests consume. The reduced-search
// "optimization" effort is reserved for evaluating many candidate device
// positions; it can legitimately choose a different cable lane.
const specification = solvePhysicalLayout();
const activeDeviceIds = new Set(Object.keys(specification.devices));
const deviceOverrides = Object.fromEntries(Object.entries(existing.runtime?.deviceOverrides ?? {}).filter(([id]) => (
  activeDeviceIds.has(id)
)));

const document = {
  ...existing,
  generatedAt: new Date().toISOString(),
  runtime: {
    ...existing.runtime,
    deviceOverrides,
    specification,
  },
};

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  automaticRouteCount: specification.metrics.automaticRouteCount,
  solverRouteCount: specification.metrics.solverRouteCount,
}, null, 2)}\n`);
