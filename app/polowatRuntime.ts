import artifact from "../data/generated/polowat-runtime.json";
import { polowatGraph } from "./polowatGraph";
import { hydrateGraphRuntime } from "./hydrateGraphRuntime";
import type { GraphRuntimeArtifact } from "./systemGraph";
export const polowatRuntime = hydrateGraphRuntime(polowatGraph, artifact as unknown as GraphRuntimeArtifact);
