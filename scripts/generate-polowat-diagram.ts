import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createDiagramLayoutBuilder} from '../app/diagramLayout';
import {polowatDiagramRuntime as runtime} from '../app/polowatDiagramRuntime';
const output=new URL('../data/generated/polowat-diagram-layouts.json',import.meta.url);
const hash=createHash('sha256');
for(const name of ['diagramLayout.ts','diagramPlacement.ts','diagramNodes.ts','polowatDiagramRuntime.ts','polowatGraph.ts','polowatTopology.ts','polowatHardware.ts'])hash.update(readFileSync(new URL('../app/'+name,import.meta.url)));
hash.update(readFileSync(new URL('../data/generated/polowat-runtime.json',import.meta.url)));
hash.update(readFileSync(new URL(import.meta.url)));
const sourceHash=hash.digest('hex');
if(existsSync(output)&&JSON.parse(readFileSync(output,'utf8')).sourceHash===sourceHash){console.log('Polowat diagram is current.');process.exit(0);}
const builder=createDiagramLayoutBuilder(runtime);
const layouts=Object.fromEntries(['system',...runtime.graph.junctions.map(j=>j.deviceId)].map(key=>{
 const layout=builder.buildDiagramLayout(key==='system'?undefined:key);
 const checks={routingFallbacks:layout.routingFallbacks,coincidentSegments:layout.coincidentSegments,nonOrthogonalSegments:layout.nonOrthogonalSegments,unbridgedCrossings:layout.unbridgedCrossings,conductorOverlaps:layout.conductorOverlaps,parallelEnvelopeOverlaps:layout.parallelEnvelopeOverlaps,nodeBodyCrossings:layout.nodeBodyCrossings,nodeOverlaps:layout.nodeOverlaps};
 console.log(key,checks);
 if(Object.values(checks).some(n=>n!==0))throw Error('Invalid Polowat diagram '+key);
 return [key,{...layout,layoutMs:0,routingMs:0,compactionMs:0,junction:undefined,junctionId:layout.junction?.id,
  nodes:layout.nodes.map(({device,...node})=>({...node,deviceId:device.id,device})),
  wires:layout.wires.map(({route,...wire})=>({...wire,routeId:route.id,route}))}];
}));
writeFileSync(output,JSON.stringify({graphId:runtime.graph.id,graphRevision:runtime.graph.revision,sourceHash,layouts},null,2)+'\n');
