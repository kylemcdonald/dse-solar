import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { solvePhysicalLayout } from "../app/physicalLayoutSolver.ts";

const outputPath = fileURLToPath(new URL("../data/optimized-physical-layout.json", import.meta.url));
const existing = JSON.parse(await readFile(outputPath, "utf8"));
const specification = solvePhysicalLayout({ routingEffort: "optimization" });

const document = {
  ...existing,
  generatedAt: new Date().toISOString(),
  runtime: {
    ...existing.runtime,
    specification,
  },
};

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  outputPath,
  automaticRouteCount: specification.metrics.automaticRouteCount,
  solverRouteCount: specification.metrics.solverRouteCount,
}, null, 2)}\n`);
