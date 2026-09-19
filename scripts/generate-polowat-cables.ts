import fs from 'node:fs';
import { polowatRuntime } from '../app/polowatRuntime';
import { polowatTopology } from '../app/polowatTopology';
import { roundedRouteCurve } from '../app/cableCurve3D';
const routes=polowatRuntime.routes.map(r=>{
 const gauge=polowatRuntime.graph.cables.find(c=>c.id===r.cableId)!.conductorSize;
 const modelLengthM=roundedRouteCurve(r.points,Math.max(.009,r.diameterMm/2000*4.25)).getLength();
 const field=/^(8|10|12) AWG/.test(gauge);
 return {id:r.id,label:r.label,gauge:gauge,color:r.kind==='negative'?'black':r.kind==='data'?'blue':'red',fieldCut:field,points:r.points,inside:[],outside:r.points,modelLengthM,cutLengthM:field?Math.ceil((modelLengthM*1.15+.10)/.05)*.05:0,diameterMm:r.diameterMm};
});
// Parallel batteries use equal corresponding finished branch lengths, with the
// positive total split between source-to-breaker and breaker-to-bus pieces.
const round=(n:number)=>Math.ceil((n-1e-9)/.05)*.05;
const get=(id:string)=>routes.find(r=>r.id===id)!;
const positiveTotal=Math.max(...['a','b'].map(l=>get(`battery-${l}-positive`).cutLengthM+get(`battery-${l}-positive-bus`).cutLengthM));
const negativeTotal=Math.max(...['a','b'].map(l=>get(`battery-${l}-negative`).cutLengthM));
for(const l of ['a','b']){get(`battery-${l}-positive`).cutLengthM=round(positiveTotal-get(`battery-${l}-positive-bus`).cutLengthM);get(`battery-${l}-negative`).cutLengthM=negativeTotal;}
const totals=Object.fromEntries(['8 AWG DC','10 AWG PV','10 AWG DC','12 AWG DC'].map(gauge=>[gauge,Object.fromEntries(['red','black'].map(color=>[color,Number(routes.filter(r=>r.gauge===gauge&&r.color===color).reduce((s,r)=>s+r.cutLengthM,0).toFixed(3))]))]));
const stock=([8,10,12] as const).flatMap(awg=>['red','black'].map(color=>{
 const system=JSON.parse(fs.readFileSync('data/polowat-system.json','utf8'));
 const availableM=system.bom.filter((b:{wireStock?:{awg:number;color:string}})=>b.wireStock?.awg===awg&&[color,'red-and-black'].includes(b.wireStock.color)).reduce((n:number,b:{wireStock:{lengthM:number};qty:number})=>n+b.wireStock.lengthM*b.qty,0);
 const requiredM=Number(routes.filter(r=>r.fieldCut&&r.gauge.startsWith(awg+' AWG')&&r.color===color).reduce((n,r)=>n+r.cutLengthM,0).toFixed(3));
 return {awg,color,availableM,requiredM,shortfallM:Math.max(0,Number((requiredM-availableM).toFixed(3)))};
}));
const result={stock,revision:polowatTopology.revision,method:'Shared 20 mm physical layout and turn-aware A*; device-front exclusion, negotiated cable clearance and exact rounded-geometry audits; lengths measured on the rendered curves',allowance:'15% plus 50 mm per end, each cut rounded up to 50 mm; corresponding parallel battery branch lengths equalized',limits:'Planning geometry, not surveyed site distances or a fabrication release. All modeled routes pass the shared device, cable, wall, self-intersection and rounded-geometry checks. Received hardware and installation clearances still require physical verification. PV span in scene is illustrative, not a surveyed roof run. Check the remaining shared 10 AWG stock after controller cuts before installation.',routes,totals};
fs.writeFileSync('data/generated/polowat-cable-routes.json',JSON.stringify(result));
console.log(JSON.stringify(totals,null,2));

// Keep the published schedule and electrical summary tied to the rendered routes.
const systemFile='data/polowat-system.json';
const system=JSON.parse(fs.readFileSync(systemFile,'utf8'));
const pathDrop=(field:'modelLengthM'|'cutLengthM')=>{
 const rho=.0175*(1+.00393*(75-20));
 const branch=Math.max(...['a','b'].map(letter=>['positive','positive-bus','negative'].reduce((sum,suffix)=>sum+get(`battery-${letter}-${suffix}`)[field],0)));
 const controller=['mppt-battery-positive','controller-positive-bus','mppt-battery-negative','battery-bus-shunt'].reduce((sum,id)=>sum+get(id)[field],0);
 return 20*rho*(branch/8.37+controller/5.26)+20*(.05/500);
};
const modelDrop=pathDrop('modelLengthM'),cutDrop=pathDrop('cutLengthM');
const dropPercent=Number((cutDrop/11.8*100).toFixed(2));
system.routedCablePlan={...system.routedCablePlan,method:result.method,limits:result.limits,totals,modelBatteryControllerDropV:Number(modelDrop.toFixed(3)),allowanceBatteryControllerDropV:Number(cutDrop.toFixed(3)),allowanceBatteryControllerDropPercent:dropPercent,includesShuntResistanceOhms:.0001};
system.electricalAudit.holds=system.electricalAudit.holds.map((note:string)=>note.startsWith('Routed cut allowances give')?`Routed cut allowances give ${dropPercent}% battery/controller drop at 20 A and 11.8 V, including the BMV shunt, versus the 3% target. Scene route lengths give ${(modelDrop/11.8*100).toFixed(2)}%, before terminal/contact resistance. Shorten the actual layout or revise the conductor plan before fabrication; older compact-route assumptions are not a pass.`:note);
const controllerReserve=Math.max(totals['10 AWG DC'].red,totals['10 AWG DC'].black);
const pvReserve=Number((system.cableStockPlan.lengthPerColourM-controllerReserve-system.cableStockPlan.reservePerColourM).toFixed(3));
system.cableStockPlan.controllerRoutePerColourM=controllerReserve;
system.cableStockPlan.pvRoutePerColourM=pvReserve;
system.cableStockPlan.note=`Shared 9.144 m per colour: reserve ${controllerReserve.toFixed(2)} m for controller/shunt, ${pvReserve.toFixed(2)} m for PV including disconnect tails, and 0.244 m trim margin. Both negative shunt legs are included. Measure the real rooftop route; illustrative scene distances do not prove the pack covers the site.`;
const cableRow=system.bom.find((row:{id:string})=>row.id==='polowat-pv-cable');
cableRow.description=cableRow.description.replace(/ Per colour allocate .*? Offcuts replace/, ' Offcuts replace').replace(/ P14 routed controller cuts.*$/, '').replace(/ Shared 9\.144 m per colour:.*$/, '')+' '+system.cableStockPlan.note;
system.assemblyReview.revision='P16';
system.assemblyReview.workspaceMm=polowatRuntime.deviceById.get('equipmentEnclosure')!.size.slice(0,2).map(m=>Math.round(m*1000));
fs.writeFileSync(systemFile,JSON.stringify(system,null,2)+'\n');
const rows=routes.filter(r=>r.fieldCut).map(r=>`| ${r.label} | ${r.gauge} / ${r.color} | ${r.modelLengthM.toFixed(3)} m | ${r.cutLengthM.toFixed(2)} m |`).join('\n');
fs.writeFileSync('public/polowat-cable-routing.md',`# Polowat cable routing and stock estimate — ${polowatTopology.revision}

${result.method}. ${result.allowance}.

${result.limits}

| Gauge / use | Red cuts | Black cuts | Stock per colour |
|---|---:|---:|---:|
${Object.entries(totals).map(([g,v])=>`| ${g} | ${v.red.toFixed(2)} m | ${v.black.toFixed(2)} m | ${g.startsWith('10')?'9.144 m shared PV/controller':'7.620 m'} |`).join('\n')}

The shared 10 AWG stock must cover PV, controller and both shunt legs together: ${(totals['10 AWG PV'].red+totals['10 AWG DC'].red).toFixed(2)} m red and ${(totals['10 AWG PV'].black+totals['10 AWG DC'].black).toFixed(2)} m black in this illustrative layout. Measure the actual roof run before cutting. The BMV kit supplies its 2 m fused positive lead and 10 m RJ12 cable; these are not extra field-wire purchases. Add two 10 AWG × M10 closed lugs for the shunt studs.

## Electrical limits

At 20 A, 11.8 V and 75°C copper, modeled battery/controller drop is ${modelDrop.toFixed(3)} V (${(modelDrop/11.8*100).toFixed(2)}%); cut allowances give ${cutDrop.toFixed(3)} V (${dropPercent}%). Both include the 500 A / 50 mV shunt's 2 mV drop at 20 A; terminal/contact resistance is additional. The 3% target remains unresolved. Shorten and measure the physical arrangement or revise the conductor plan before fabrication. Battery-to-box positives remain upstream of their in-box isolators; source-end protection remains unresolved.

| Circuit | Gauge / colour | Model length | Cut with allowance |
|---|---|---:|---:|
${rows}
`);
