import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
import {buildPolowatGraph} from '../app/polowatGraph';
import {selectedPolowatLayout,reversiblePolowatBreakers} from '../app/polowatLayout';
import {buildSystemRuntime,sampledResolvedDeviceOverlaps,sampledRouteWallPlaneCrossings} from '../app/systemGraphRuntime';
import {graphWalls} from '../app/systemGraph';
import {glandCrossingFailures} from '../app/glandAudit';
import {roundedRoutePieces} from '../app/renderedCableGeometry';
const breakerLabels:Record<string,string>={batteryBreakerA:'Battery A',batteryBreakerB:'Battery B',controllerBreaker:'Controller'};
const label=(id:string)=>breakerLabels[id]??id;
const objective='Same enclosure and device positions; minimize the existing layout score: area m² + 0.01 × total rounded cable m + 0.02 × upstream battery-positive lead m. This is a routing score, not a dollar price. Reject every geometry or routing failure.';
if(process.argv[2]===undefined){
 const results=[];
 for(let mask=0;mask<8;mask++){
  const child=spawnSync(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),String(mask)],{encoding:'utf8',timeout:90000,maxBuffer:4e6});
  const result=child.status===0?JSON.parse(child.stdout.trim()):{mask,valid:false,error:child.error?.message??child.stderr.trim()};
  results.push(result);console.log(JSON.stringify(result));
  writeFileSync('data/generated/polowat-breaker-comparison.json',JSON.stringify({objective,layout:selectedPolowatLayout.id,results},null,2)+'\n');
 }
 const valid=results.filter(r=>r.valid).sort((a,b)=>a.score-b.score);
 const winner=valid[0];if(!winner)throw Error('No valid breaker routing');
 const baseline=results.find(r=>r.mask===0);
 writeFileSync('public/polowat-breaker-comparison.md',[
  '# Polowat non-polarized breaker routing', '',objective,'',
  'Only the three declared non-polarized 30 A breakers can exchange top/bottom connections. Physical terminal IDs, pole identities, device positions and polarized PV/load breakers stay fixed. All eight combinations are tested.', '',
  '| Reversed connections | Valid | Rounded cable (m) | Battery source leads (m) | Turns | Score |',
  '| --- | --- | --- | --- | --- | --- |',
  ...results.map(r=>`| ${r.reversed?.map(label).join(', ')||'None (baseline)'} | ${r.valid?'Yes':'Rejected'} | ${r.totalLengthM??'—'} | ${r.batterySourceLeadM??'—'} | ${r.turns??'—'} | ${r.valid?r.score:'—'} |`), '',
  `Lowest valid score: **${winner.reversed.map(label).join(', ')||'baseline'}**, ${winner.score}, versus ${baseline.score} before. Total modeled cable changes by ${(winner.totalLengthM-baseline.totalLengthM).toFixed(3)} m; upstream battery-positive leads change by ${(winner.batterySourceLeadM-baseline.batterySourceLeadM).toFixed(3)} m.`, '',
  'These are modeled route lengths. Pack quantities and procurement prices are unchanged. Reproduce with `npm run compare:polowat-breakers`; rejected candidates and audit counts are retained in `data/generated/polowat-breaker-comparison.json`.', ''
 ].join('\n'));
 process.exit(0);
}
const mask=Number(process.argv[2]);
const reversed=reversiblePolowatBreakers.filter((_,i)=>mask&(1<<i));
try{
 const graph=buildPolowatGraph(selectedPolowatLayout,reversed);
 const runtime=buildSystemRuntime(graph,{renderedAudit:true});
 const d=runtime.diagnostics;
 const failures=Object.fromEntries(['fallbacks','centerlineConflicts','sweptCableConflicts','selfIntersections','deviceConflicts','renderedGeometryConflicts'].map(k=>[k,d[k as keyof typeof d]]));
 failures.glandBoreConflicts=glandCrossingFailures(runtime).length;
 failures.deviceOverlaps=sampledResolvedDeviceOverlaps(runtime.devices).length;
 failures.wallCrossings=sampledRouteWallPlaneCrossings(runtime.routes,runtime.devices,graphWalls(graph)).length;
 failures.reversals=runtime.routes.filter(r=>r.points.some((p,i,a)=>i>0&&i<a.length-1&&p.reduce((n,v,j)=>n+(v-a[i-1][j])*(a[i+1][j]-v),0)<-1e-9)).length;
 const length=(id:string)=>{const r=runtime.routeById.get(id)!;return roundedRoutePieces(r.points,Math.max(.009,r.diameterMm/2000*4.25)).reduce((n,p)=>n+p.lengthM,0);};
 const total=runtime.routes.reduce((n,r)=>n+length(r.id),0),battery=length('battery-a-positive')+length('battery-b-positive');
 const box=runtime.deviceById.get('equipmentEnclosure')!;
 console.log(JSON.stringify({mask,reversed,valid:Object.values(failures).every(n=>n===0),failures,totalLengthM:+total.toFixed(3),batterySourceLeadM:+battery.toFixed(3),turns:d.totalTurns,score:+(box.size[0]*box.size[1]+total*.01+battery*.02).toFixed(5)}));
}catch(error){console.log(JSON.stringify({mask,reversed,valid:false,error:String(error)}));}
