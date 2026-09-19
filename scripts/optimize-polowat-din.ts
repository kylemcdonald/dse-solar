import {runtimeSourceHash} from './runtimeArtifact';
import {execFile} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolveDevices,resolveConductors,resolveGlands} from '../app/physicalLayout';
import {buildPolowatGraph} from '../app/polowatGraph';
import {baselinePolowatLayout,baselinePolowatBreakerRouting} from '../app/polowatLayout';
import {barycentricDinOrder,dinEndpointMeans,dinArrangementKey,normalizeDinArrangement,improvesDin,refineDinArrangement,type DinArrangement,type DinEvaluation} from '../app/dinRailOptimization';
import {buildSystemRuntime,sampledResolvedDeviceOverlaps,sampledRouteWallPlaneCrossings} from '../app/systemGraphRuntime';
import {nonOrthogonalRouteSegments} from '../app/routeAudits';
import {graphWalls} from '../app/systemGraph';
import {glandCrossingFailures} from '../app/glandAudit';
import {roundedRoutePieces} from '../app/renderedCableGeometry';

const output='data/generated/polowat-din-optimization.json';
const metricLabels={totalLengthM:'Rounded cable (m)',batterySourceLeadM:'Battery source leads (m)',turns:'Bends',score:'Routing score'};
const objective='Minimize enclosure area m² + 0.01 × rounded cable m + 0.02 × upstream battery-positive lead m. All physical, gland, orthogonality and rendered audits are mandatory. Scores are routing comparisons, not dollar prices.';
type Result=DinEvaluation&{phase:string; glandMeans?:Record<string,number>};
if(process.argv[2]==='--candidate'){
 const arrangement=normalizeDinArrangement(JSON.parse(process.argv[3]));
 try{
  const graph=buildPolowatGraph({...baselinePolowatLayout,dinOrder:arrangement.order,dinSpacesAfter:arrangement.spacesAfter},baselinePolowatBreakerRouting);
  const runtime=buildSystemRuntime(graph,{renderedAudit:true}),d=runtime.diagnostics;
  const failures:Record<string,number>=Object.fromEntries(['fallbacks','centerlineConflicts','sweptCableConflicts','selfIntersections','deviceConflicts','renderedGeometryConflicts'].map(k=>[k,d[k as keyof typeof d] as number]));
  failures.diagonalSegments=nonOrthogonalRouteSegments(runtime.routes).length;
  failures.glandBoreConflicts=glandCrossingFailures(runtime).length;
  failures.deviceOverlaps=sampledResolvedDeviceOverlaps(runtime.devices).length;
  failures.wallCrossings=sampledRouteWallPlaneCrossings(runtime.routes,runtime.devices,graphWalls(graph)).length;
  failures.reversals=runtime.routes.filter(r=>r.points.some((p,i,a)=>i>0&&i<a.length-1&&p.reduce((n,v,j)=>n+(v-a[i-1][j])*(a[i+1][j]-v),0)<-1e-9)).length;
  const length=(id:string)=>{const r=runtime.routeById.get(id)!;return roundedRoutePieces(r.points,Math.max(.009,r.diameterMm/2000*4.25)).reduce((n,p)=>n+p.lengthM,0);};
  const total=runtime.routes.reduce((n,r)=>n+length(r.id),0),battery=length('battery-a-positive')+length('battery-b-positive'),box=runtime.deviceById.get('equipmentEnclosure')!;
  console.log(JSON.stringify({arrangement,valid:Object.values(failures).every(n=>n===0),failures,totalLengthM:total,batterySourceLeadM:battery,turns:d.totalTurns,sizeMm:box.size.map(n=>Math.round(n*1000)),score:box.size[0]*box.size[1]+total*.01+battery*.02,means:dinEndpointMeans(graph,runtime,arrangement.order),glandMeans:dinEndpointMeans(graph,runtime,arrangement.order,true)}));
 }catch(error){console.log(JSON.stringify({arrangement,valid:false,error:String(error)}));}
 process.exit(0);
}
const sourceHash=await runtimeSourceHash(buildPolowatGraph(baselinePolowatLayout,baselinePolowatBreakerRouting),['app/polowatGraph.ts','app/polowatHardware.ts','app/polowatTopology.ts']);
const results:Result[]=[];
const cache=new Map<string,Result>();
// Resuming is explicit; discard this cache whenever solver source or input topology changes.
const previous=process.argv.includes('--resume')?JSON.parse(readFileSync(output,'utf8')):undefined;
if(previous&&previous.sourceHash!==sourceHash)throw Error('DIN search cache is stale; rerun without --resume');
for(const result of (previous?.results??[]) as Result[]){
 if(result.valid){
  const graph=buildPolowatGraph({...baselinePolowatLayout,dinOrder:result.arrangement.order,dinSpacesAfter:result.arrangement.spacesAfter},baselinePolowatBreakerRouting);
  const devices=resolveDevices(graph),geometry={devices,conductors:resolveConductors(devices),glands:resolveGlands(graph,devices)};
  result.means=dinEndpointMeans(graph,geometry,result.arrangement.order);
  result.glandMeans=dinEndpointMeans(graph,geometry,result.arrangement.order,true);
 }
 results.push(result);cache.set(dinArrangementKey(result.arrangement),result);
}
let selected:DinEvaluation|undefined;
const write=(extra={})=>writeFileSync(output,JSON.stringify({sourceHash,objective,baselineLayout:baselinePolowatLayout,reversedBreakers:baselinePolowatBreakerRouting,selected,results,...extra},null,2)+'\n');
const evaluate=async(a:DinArrangement,phase:string):Promise<Result>=>{
 const arrangement=normalizeDinArrangement(a),key=dinArrangementKey(arrangement);
 const existing=cache.get(key);if(existing)return existing;
 const child=await new Promise<{status:number;stdout:string;stderr:string;error?:Error}>(resolve=>{
  execFile(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),'--candidate',key],{encoding:'utf8',timeout:90000,killSignal:'SIGKILL',maxBuffer:4e6},(error,stdout,stderr)=>resolve({status:error?1:0,stdout,stderr,error:error??undefined}));
 });
 const result:Result={...(child.status===0?JSON.parse(child.stdout.trim()):{arrangement,valid:false,error:child.error?.message??child.stderr.trim()}),phase};
 cache.set(key,result);results.push(result);if(!selected||improvesDin(result,selected))selected=result;
 console.log(JSON.stringify({n:results.length,phase,valid:result.valid,length:result.totalLengthM,score:result.score,best:selected?.score,error:result.error,order:arrangement.order,gaps:arrangement.spacesAfter}));write();return result;
};
const baseline=await evaluate({order:baselinePolowatLayout.dinOrder,spacesAfter:{}},'baseline');
if(!baseline.valid)throw Error('Baseline must pass');
selected=baseline;
const trajectories=[];
for(const gap of [0,.02,.04])for(const mode of ['endpoints','glands'] as const){
 let current=await evaluate({order:baseline.arrangement.order,spacesAfter:Object.fromEntries(baseline.arrangement.order.slice(0,-1).map(id=>[id,gap]))},`seed-${gap}`);
 const seen=new Set<string>();let reason='iteration-limit';
 for(let iteration=0;iteration<12&&current.valid;iteration++){
  const key=dinArrangementKey(current.arrangement);if(seen.has(key)){reason='cycle';break;}seen.add(key);
  const means=mode==='glands'?current.glandMeans!:current.means!;
  const next={...current.arrangement,order:barycentricDinOrder(current.arrangement.order,means)};
  if(dinArrangementKey(next)===key){reason='fixed-point';break;}
  current=await evaluate(next,`barycentric-${mode}-${gap}-${iteration}`);
  if(!current.valid)reason='invalid';
 }
 trajectories.push({gap,mode,reason,visited:[...seen]});
}
// Compact each spaced basin, not only the global incumbent: a wide seed may get good after collapse.
for(const seed of [...results].filter(r=>r.valid&&Object.keys(r.arrangement.spacesAfter).length>0).sort((a,b)=>a.totalLengthM!-b.totalLengthM!).slice(0,4)){
 await evaluate({order:seed.arrangement.order,spacesAfter:{}},'collapse-all');
}
selected=results.filter(r=>r.valid).sort((a,b)=>a.score!-b.score!)[0];
const refinement=await refineDinArrangement(selected,evaluate);
selected=refinement.best;
write({trajectories,converged:refinement.converged,sweeps:refinement.sweeps});
writeFileSync('data/generated/polowat-din-selected.json',JSON.stringify(selected.arrangement,null,2)+'\n');
writeFileSync('public/polowat-din-optimization.md',[
 '# Polowat DIN rail optimization','',objective,'',
 'Connected clamps vote at the far end of each wire (all connected poles on breakers and all 3–4 used clamps on terminal pairs). Stable mean-x ordering is rerouted repeatedly until a fixed point, cycle, invalid route or 12 iterations. A second seed uses enclosure glands as local anchors. Uniform 0/20/40 mm spacing seeds explore routing aisles. The best basins are compacted, then adjacent swaps and ±20 mm aisle changes undergo full rerouting until no neighbor improves the score. Gaps are capped at 60 mm. This is a local search, not proof of the global optimum.','',
 `Evaluated ${results.length} distinct arrangements; ${results.filter(r=>r.valid).length} valid. Refinement ${refinement.converged?'converged':'hit its sweep limit'} after ${refinement.sweeps} sweeps. Each candidate has a 90-second solve budget; failures/timeouts cannot be selected.`, '',
 '| Metric | Previous layout | Selected layout |','| --- | ---: | ---: |',
 ...(['totalLengthM','batterySourceLeadM','turns','score'] as const).map(k=>`| ${metricLabels[k]} | ${baseline[k]?.toFixed(k==='turns'?0:5)} | ${selected![k]?.toFixed(k==='turns'?0:5)} |`),
 `| Enclosure mm | ${baseline.sizeMm?.join(' × ')} | ${selected.sizeMm?.join(' × ')} |`, '',
 `Left to right: ${selected.arrangement.order.join(', ')}.`,
 `Explicit aisles after devices (metres): ${JSON.stringify(selected.arrangement.spacesAfter)}. Other neighbors touch; wires may use only actual open aisles and must clear all bodies and their front/rear exclusion volumes.`, '',
 'This rail search holds the pre-search breaker direction assignment fixed (Battery A and Battery B reversed). The subsequent [breaker-direction comparison](polowat-breaker-comparison.md) retests all eight assignments on this rail; its totals and the cable schedule describe the final model. Separating terminal pairs requires checking the received end covers and rail stops. Electrical topology, procurement and Fiji installation remain unchanged. Run a fresh search with `npm run optimize:polowat-din`, or continue from the best recorded trials with `npm run optimize:polowat-din -- --resume`. Resume rejects changed physical inputs; a fresh local search can follow a different path. Raw rejected/valid candidates and endpoint means are retained in `data/generated/polowat-din-optimization.json`. The selected arrangement is a generated input to the shared layout engine.',''
].join('\n'));
console.log('SELECTED',JSON.stringify(selected));
