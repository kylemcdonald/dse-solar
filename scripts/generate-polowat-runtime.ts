import { polowatGraph } from "../app/polowatGraph";
import { generateRuntimeArtifact } from "./runtimeArtifact";
await generateRuntimeArtifact(polowatGraph,"data/generated/polowat-runtime.json",["app/polowatGraph.ts","app/polowatTopology.ts","app/polowatHardware.ts","app/polowatLayout.ts"]);
