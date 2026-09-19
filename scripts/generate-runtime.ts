import { readFile } from "node:fs/promises";
import { dseTopology } from "../app/dseTopology";
import { applyWallPlan, type WallPlan } from "../app/wallPlan";
import { generateRuntimeArtifact } from "./runtimeArtifact";
// Authored, installed positions remain the default.
const wallPlan = process.env.DSE_WALL_PLAN === "1" ? JSON.parse(await readFile("data/generated/wall-plan.json","utf8")) as WallPlan : undefined;
await generateRuntimeArtifact(applyWallPlan(dseTopology,wallPlan),"data/generated/dse-runtime.json",["app/dseTopology.ts","app/wallPlan.ts"],wallPlan?.sourceHash??null);
