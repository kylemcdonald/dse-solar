import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Derive the published heavy-DC cable plan from the routed 3D artifact.
 *
 * Refresh measured model lengths and totals without changing the agreed field
 * assembly lengths. DSE is on Fulaga with fixed equipment and cable inventory.
 * Refuse a route longer than its scheduled assembly so the model cannot quietly
 * outgrow the material on site.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const systemPath = path.join(root, "data", "dse-system.json");
const runtimePath = path.join(root, "data", "generated", "dse-runtime.json");

const routeIds = new Map([
  ["series-a", "battery-a-series"],
  ["series-b", "battery-b-series"],
  ["battery-a-positive-to-cutoff", "battery-a-positive-breaker"],
  ["battery-b-positive-to-cutoff", "battery-b-positive-breaker"],
  ["cutoff-a-to-main-positive", "battery-a-breaker-bus"],
  ["cutoff-b-to-main-positive", "battery-b-breaker-bus"],
  ["battery-a-negative-to-shunt", "battery-a-negative-shunt"],
  ["battery-b-negative-to-shunt", "battery-b-negative-shunt"],
  ["smartsolar-positive-to-cutoff", "mppt-positive-breaker"],
  ["smartsolar-negative-to-main-negative", "mppt-negative-bus"],
  ["smartsolar-cutoff-to-main-positive", "mppt-breaker-bus"],
  ["shunt-to-main-negative", "shunt-negative-bus"],
  ["main-positive-to-multiplus", "multiplus-positive"],
  ["main-negative-to-multiplus", "multiplus-negative"],
  ["main-positive-to-secondary-positive", "secondary-feeder-positive"],
  ["main-negative-to-secondary-negative", "secondary-feeder-negative"],
]);
const sourceLeadIds = new Set([
  "battery-a-positive-to-cutoff",
  "battery-b-positive-to-cutoff",
  "battery-a-negative-to-shunt",
  "battery-b-negative-to-shunt",
]);

type Assembly = { route: string; pairedRunId?: string; qty: number; routedLengthM: number; planningLengthM: number };
type SystemData = {
  batteryCablePlan: {
    routedTotalLengthM: number;
    planningTotalLengthM: number;
    planningTotalLengthFt: number;
    sourceLeadComparison: { currentRoutedTotalM: number };
    assemblies: Assembly[];
  };
};

const raw = await readFile(systemPath, "utf8");
const system = JSON.parse(raw) as SystemData;
const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { routes: Array<{ id: string; lengthM: number }> };
const lengthById = new Map(runtime.routes.map((route) => [route.id, route.lengthM]));
const round2 = (value: number) => Number(value.toFixed(2));
const plan = system.batteryCablePlan;
plan.assemblies.forEach((assembly) => {
  const routeId = routeIds.get(assembly.route);
  const lengthM = routeId ? lengthById.get(routeId) : undefined;
  if (lengthM === undefined) throw new Error(`No routed length for cable-plan assembly ${assembly.route}`);
  assembly.routedLengthM = round2(lengthM);
  if (lengthM > assembly.planningLengthM + 1e-9) {
    throw new Error(`${assembly.route}: modeled route exceeds the fixed ${assembly.planningLengthM} m assembly`);
  }
});
plan.routedTotalLengthM = round2(plan.assemblies.reduce((sum, assembly) => sum + assembly.routedLengthM * assembly.qty, 0));
plan.planningTotalLengthM = round2(plan.assemblies.reduce((sum, assembly) => sum + assembly.planningLengthM * assembly.qty, 0));
plan.planningTotalLengthFt = round2(plan.planningTotalLengthM * 3.280839895);
plan.sourceLeadComparison.currentRoutedTotalM = round2(plan.assemblies
  .filter((assembly) => sourceLeadIds.has(assembly.route))
  .reduce((sum, assembly) => sum + assembly.routedLengthM * assembly.qty, 0));
await writeFile(systemPath, `${JSON.stringify(system, null, 2)}\n`);
console.log(`Cable plan: ${plan.routedTotalLengthM} m routed, ${plan.planningTotalLengthM} m planned, ${plan.sourceLeadComparison.currentRoutedTotalM} m of unprotected battery leads.`);
