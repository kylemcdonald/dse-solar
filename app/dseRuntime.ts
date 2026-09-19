import artifact from "../data/generated/dse-runtime.json";
import { dseTopology } from "./dseTopology";
import { hydrateGraphRuntime } from "./hydrateGraphRuntime";
import type { GraphRuntimeArtifact } from "./systemGraph";
export const dseRuntime = hydrateGraphRuntime(dseTopology, artifact as unknown as GraphRuntimeArtifact);
