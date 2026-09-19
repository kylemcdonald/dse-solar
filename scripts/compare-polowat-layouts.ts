import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {glandCrossingFailures} from "../app/glandAudit";
import {readFileSync,writeFileSync} from 'node:fs';
import {buildPolowatGraph} from '../app/polowatGraph';
import {polowatLayoutCandidates,selectedPolowatLayout,type PolowatLayout} from '../app/polowatLayout';
import {buildSystemRuntime,routingFailureDiagnostics,renderedGeometryFailureDiagnostics,sampledResolvedDeviceOverlaps} from '../app/systemGraphRuntime';
import {roundedRoutePieces} from '../app/renderedCableGeometry';
const objective='Reject every collision and routing/gland failure. Prefer lower DIN. Compare footprint, cable length and battery source-lead length; score = area m² + 0.01 × cable m + 0.02 × battery source-lead m (lower is better).';
type ComparisonResult={layout:PolowatLayout;valid:boolean;sizeMm?:number[];totalLengthM?:number;batterySourceLeadM?:number;score?:number;error?:string;failures?:Record<string,number>};
function writeReport(results:ComparisonResult[]) {
 const chosen=results.find(r=>r.layout.id===selectedPolowatLayout.id);
 if(!chosen?.valid)throw Error('Selected layout did not pass the comparison');
 const rows=results.map(r=>`| ${r.layout.id}${r===chosen?' **selected**':''} | ${r.valid?'Pass':r.error?'Solver rejected':'Audit rejected'} | ${r.sizeMm?.join(' × ')??'—'} | ${r.totalLengthM??'—'} | ${r.batterySourceLeadM??'—'} | ${r.valid?r.score:'—'} |`);
 writeFileSync('public/polowat-layout-comparison.md',[
  '# Polowat enclosure layout comparison',
  '',
  'Eight deterministic layouts were tested on the shared 20 mm router. Only Polowat opts into touching DIN components and centered gland bores. Fiji’s device, terminal, gland and route geometry is protected by a saved SHA-256 regression fixture.',
  '',
  objective,
  '',
  '| Layout | Result | Envelope W × H × D (mm) | Cable (m) | Battery source leads (m) | Score |',
  '| --- | --- | --- | --- | --- | --- |',...rows,
  '',
  `Selected **${chosen.layout.id}**: ${chosen.sizeMm?.join(' × ')} mm. The lower rail holds all six breakers and four terminal-pair devices edge-to-edge. Space under the rail remains for gland entries and cable bends. Backplate order from lower rows upward: ${chosen.layout.backplateOrder.join(', ')}.`,
  '',
  'The previous 100 mm controller-layout constraint and declared inter-device gaps are removed. Functional space for terminal exits, cable radii and routing lanes remains. Cables go around the continuous DIN row. All nine entries have hollow sleeves, matching panel openings and straight approaches; their complete rounded centerlines pass the bore audit.',
  '',
  'This is the best score among these tested candidates, not a proof of a globally optimal layout. Dimensions are routing envelopes, not a fabrication template or a new enclosure purchase. The generated cable schedule supersedes previous length estimates.',
  '',
  'Reproduce with `npm run compare:polowat-layouts`. Raw results, including rejected candidates, are in `data/generated/polowat-layout-comparison.json`. Each solve has a 45-second budget; timed-out or invalid candidates cannot be selected.',
  ''
 ].join('\n'));
}
if(process.argv[2]==='--report'){
 writeReport(JSON.parse(readFileSync('data/generated/polowat-layout-comparison.json','utf8')).results);
 process.exit(0);
}
if(!process.argv[2]) {
 const results=[];
 for(const layout of polowatLayoutCandidates){
  const child=spawnSync(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),layout.id],{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
  const result=child.status===0?JSON.parse(child.stdout.trim()):{layout,valid:false,error:child.error?.message??child.stderr.trim()};
  results.push(result);console.log(JSON.stringify(result));
  writeFileSync('data/generated/polowat-layout-comparison.json',JSON.stringify({objective,timeoutSeconds:45,results},null,2)+'\n');
 }
 writeReport(results);
 process.exit(0);
}
const results=[];
for(const layout of polowatLayoutCandidates.filter(p=>p.id===process.argv[2])){
 const start=performance.now();
 try {
  const runtime=buildSystemRuntime(buildPolowatGraph(layout),{renderedAudit:true});
  const d=runtime.diagnostics;
  const failures=Object.fromEntries(['fallbacks','centerlineConflicts','sweptCableConflicts','selfIntersections','deviceConflicts','renderedGeometryConflicts'].map(k=>[k,d[k as keyof typeof d]]));
  failures.glandBoreConflicts=glandCrossingFailures(runtime).length;
  failures.deviceOverlaps=sampledResolvedDeviceOverlaps(runtime.devices).length;
  const box=runtime.deviceById.get('equipmentEnclosure')!;
  const length=(id:string)=>{const r=runtime.routeById.get(id)!;return roundedRoutePieces(r.points,Math.max(.009,r.diameterMm/2000*4.25)).reduce((s,p)=>s+p.lengthM,0);};
  const result={layout,valid:Object.values(failures).every(n=>n===0),failures,sizeMm:box.size.map(n=>Math.round(n*1000)),areaM2:Number((box.size[0]*box.size[1]).toFixed(4)),totalLengthM:Number(runtime.routes.reduce((n,r)=>n+length(r.id),0).toFixed(3)),batterySourceLeadM:Number((length('battery-a-positive')+length('battery-b-positive')).toFixed(3)),score:Number((box.size[0]*box.size[1]+runtime.routes.reduce((n,r)=>n+length(r.id),0)*.01+(length('battery-a-positive')+length('battery-b-positive'))*.02).toFixed(5)),turns:d.totalTurns,seconds:Math.round((performance.now()-start)/1000),details:[...routingFailureDiagnostics,...renderedGeometryFailureDiagnostics,...glandCrossingFailures(runtime)]};
  results.push(result);console.log(JSON.stringify(result));
 }catch(error){const result={layout,valid:false,error:String(error)};results.push(result);console.log(JSON.stringify(result));}
}
