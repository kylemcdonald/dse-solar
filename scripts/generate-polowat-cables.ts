import fs from 'node:fs';
import * as THREE from 'three';
import {assemblyParts,assemblyPorts,assemblyWires,type Point} from '../app/polowatAssembly';
import {polowatAssemblyOrigin as origin,polowatPlanningEnvelope as envelope} from '../app/polowatEnclosure';
import {polowatTopology,polowatDeviceById} from '../app/polowatTopology';

// Fine DIN terminal pitch requires a smaller grid than Fiji's 20 mm lattice.
// Route the front service zone in 10 mm cells; retain explicit terminal escape stubs.
const pitch=10;
const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const key=(p:readonly number[])=>p.join(',');
const snap=(p:Point)=>p.map(v=>Math.round(v/pitch));
const mm=(p:number[])=>p.map(v=>v*pitch) as [number,number,number];
const occupied=new Set<string>();
const reserved=new Map<string,string>();
const portById=new Map(assemblyPorts.map(p=>[p.id,p]));
const world=(p:Point):[number,number,number]=>[origin[0]+(p[0]-162.5)/1000,origin[1]+(212-p[1])/1000,origin[2]+p[2]/1000];
const jobs=assemblyWires.map(w=>{
 const stubs=[w.from,w.to].map(id=>{
  const p=portById.get(id)!;
  const escape=p.point.map((v,i)=>v+p.direction[i]*25) as [number,number,number];
  const front:[number,number,number]=[escape[0],escape[1],100];
  return [p.point,escape,front,mm(snap(front))] as Point[];
 });
 return {w,stubs,start:snap(stubs[0][3]),goal:snap(stubs[1][3])};
});
for(const job of jobs)for(const p of [job.start,job.goal]){
 if(reserved.has(key(p)))throw Error('Terminal launch collision '+job.w.id);
 // Preserve vertical escape above each terminal so earlier routes cannot seal a later landing.
 for(let z=p[2];z<=Math.floor((envelope.front-15)/pitch);z++)reserved.set(key([p[0],p[1],z]),job.w.id);
}
// Binary heap keeps the deterministic A* solve quick enough for build generation.
class Heap{
 items:{p:number[];g:number;f:number}[]=[];
 push(v:{p:number[];g:number;f:number}){let i=this.items.length;this.items.push(v);while(i){const j=(i-1)>>1;if(this.items[j].f<=v.f)break;this.items[i]=this.items[j];i=j;}this.items[i]=v;}
 pop(){const result=this.items[0],last=this.items.pop()!;if(this.items.length){let i=0;while(i*2+1<this.items.length){let j=i*2+1;if(j+1<this.items.length&&this.items[j+1].f<this.items[j].f)j++;if(this.items[j].f>=last.f)break;this.items[i]=this.items[j];i=j;}this.items[i]=last;}return result;}
}
function route(start:number[],goal:number[],id:string){
 const distance=(p:number[])=>p.reduce((s,v,i)=>s+Math.abs(v-goal[i]),0);
 const open=new Heap();open.push({p:start,g:0,f:distance(start)});
 const cost=new Map([[key(start),0]]),previous=new Map<string,number[]>();
 while(open.items.length){
  const cur=open.pop(),k=key(cur.p);if(cur.g!==cost.get(k))continue;
  if(k===key(goal)){const path=[goal];let p=goal;while(key(p)!==key(start)){p=previous.get(key(p))!;path.push(p);}return path.reverse();}
  for(const d of dirs){const p=cur.p.map((v,i)=>v+d[i]),k2=key(p),[x,y,z]=mm(p);
   if(x<envelope.left+5||x>envelope.right-5||y<envelope.top+5||y>envelope.bottom-10||z<90||z>envelope.front-15)continue;
   if(occupied.has(k2)||(reserved.has(k2)&&reserved.get(k2)!==id))continue;
   const radius=5;
   if(assemblyParts.some(b=>x>b.x-radius&&x<b.x+b.width+radius&&y>b.y-radius&&y<b.y+b.height+radius&&z<b.depth+radius))continue;
   const prev=previous.get(k);
   const turn=prev&&cur.p.some((v,i)=>v-prev[i]!==d[i])?.4:0;
   const g=cur.g+1+turn+(d[2]?0.15:0)+(z-90)*.001;
   if(g>=(cost.get(k2)??Infinity))continue;cost.set(k2,g);previous.set(k2,cur.p);open.push({p,g,f:g+distance(p)});
  }
 }
 throw Error('No cable route for '+id);
}
function simplify(points:Point[]){return points.filter((p,i)=>{
 if(i===0||i===points.length-1)return true;const a=points[i-1],b=points[i+1];
 const u=p.map((v,j)=>v-a[j]),v=b.map((n,j)=>n-p[j]);
 return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-7;
});}
const internal=new Map<string,Point[]>();
for(const {w,stubs,start,goal} of jobs.sort((a,b)=>b.w.diameter-a.w.diameter||a.w.id.localeCompare(b.w.id))){
 const cells=route(start,goal,w.id);for(const p of cells)occupied.add(key(p));
 internal.set(w.id,simplify([...stubs[0],...cells.slice(1,-1).map(mm),...stubs[1].toReversed()]));
}
const detailed=new Set(assemblyParts.map(p=>p.id));
const vector=(p:Point)=>new THREE.Vector3(...p);
const routes=polowatTopology.connections.map(c=>{
 const w=assemblyWires.find(w=>w.id===c.id);
 let inside:Point[]=w?internal.get(c.id)!.map(world):[];
 let outside:Point[]=[];
 if(w){
  const a=portById.get(w.from)!,b=portById.get(w.to)!;
  // Assembly endpoint order need not match electrical graph direction.
  const firstOwner=a.owner==='entry'?(detailed.has(c.from)?c.to:c.from):a.owner;
  if(firstOwner!==c.from)inside=inside.toReversed();
  const entry=[a,b].find(p=>p.owner==='entry');
  if(entry){
   const external=polowatDeviceById.get(detailed.has(c.from)?c.to:c.from)!;
   const landing=world(entry.point);
   // Battery post positions are provisional at the upper front corners, not body centres.
   const sign=c.kind==='negative'?-1:1;
   const endpoint:Point=external.kind==='battery'?[external.position[0]+sign*external.size[0]*.3,external.position[1]+external.size[1]/2,external.position[2]+external.size[2]/2]:[external.position[0],external.position[1],external.position[2]+external.size[2]/2+.012];
   const z=Math.max(endpoint[2],landing[2])+.05;
   outside=[endpoint,[endpoint[0],endpoint[1],z],[landing[0],endpoint[1],z],[landing[0],landing[1]-.07,z],[landing[0],landing[1]-.07,landing[2]],landing];
   if(detailed.has(c.from))outside=outside.toReversed();
  }
 }else{
  const a=polowatDeviceById.get(c.from)!,b=polowatDeviceById.get(c.to)!;
  outside=[[a.position[0],a.position[1],a.position[2]+a.size[2]/2+.012],[b.position[0],b.position[1],b.position[2]+b.size[2]/2+.012]];
 }
 const points:Point[]=inside.length&&outside.length?(detailed.has(c.from)?[...inside,...outside.slice(1)]:[...outside,...inside.slice(1)]):inside.length?inside:outside;
 const length=(p:Point[])=>p.slice(1).reduce((s,v,i)=>s+vector(v).distanceTo(vector(p[i])),0);
 const modelLengthM=length(points);
 const field=/^(8|10|12) AWG/.test(c.gauge);
 // 15% route/slack allowance plus 50 mm per end; round each cut up to 50 mm.
 const cutLengthM=field?Math.ceil((modelLengthM*1.15+.10)/.05)*.05:0;
 return {id:c.id,label:c.label,gauge:c.gauge,color:c.kind==='negative'?'black':'red',fieldCut:field,points,inside,outside,modelLengthM,cutLengthM,diameterMm:w?.diameter??5};
});
// Parallel batteries use equal corresponding finished branch lengths, with the
// positive total split between source-to-breaker and breaker-to-bus pieces.
const round=(n:number)=>Math.ceil((n-1e-9)/.05)*.05;
const get=(id:string)=>routes.find(r=>r.id===id)!;
const positiveTotal=Math.max(...['a','b'].map(l=>get(`battery-${l}-positive`).cutLengthM+get(`battery-${l}-positive-bus`).cutLengthM));
const negativeTotal=Math.max(...['a','b'].map(l=>get(`battery-${l}-negative`).cutLengthM));
for(const l of ['a','b']){get(`battery-${l}-positive`).cutLengthM=round(positiveTotal-get(`battery-${l}-positive-bus`).cutLengthM);get(`battery-${l}-negative`).cutLengthM=negativeTotal;}
const totals=Object.fromEntries(['8 AWG DC','10 AWG PV','10 AWG DC','12 AWG DC'].map(gauge=>[gauge,Object.fromEntries(['red','black'].map(color=>[color,Number(routes.filter(r=>r.gauge===gauge&&r.color===color).reduce((s,r)=>s+r.cutLengthM,0).toFixed(3))]))]));
const result={revision:polowatTopology.revision,method:'10 mm 3D A* service-zone grid; exclusive grid cells; exact terminal and entry stubs; piecewise-linear rendered centreline lengths',allowance:'15% plus 50 mm per end, each cut rounded up to 50 mm; corresponding parallel battery branch lengths equalized',limits:'Planning geometry, not surveyed site distances or a fabrication release. Grid paths avoid component bodies in the front service zone; terminal stubs, rounded bends, cable-to-cable swept clearance and received glands still require physical verification. PV span in scene is illustrative, not a surveyed roof run. Check the remaining shared 10 AWG stock after controller cuts before installation.',routes,totals};
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
system.routedCablePlan={...system.routedCablePlan,totals,modelBatteryControllerDropV:Number(modelDrop.toFixed(3)),allowanceBatteryControllerDropV:Number(cutDrop.toFixed(3)),allowanceBatteryControllerDropPercent:dropPercent,includesShuntResistanceOhms:.0001};
system.electricalAudit.holds=system.electricalAudit.holds.map((note:string)=>note.startsWith('Routed cut allowances give')?`Routed cut allowances give ${dropPercent}% battery/controller drop at 20 A and 11.8 V, including the BMV shunt, versus the 3% target. Scene route lengths give ${(modelDrop/11.8*100).toFixed(2)}%, before terminal/contact resistance. Shorten the actual layout or revise the conductor plan before fabrication; older compact-route assumptions are not a pass.`:note);
const controllerReserve=Math.max(totals['10 AWG DC'].red,totals['10 AWG DC'].black);
const pvReserve=Number((system.cableStockPlan.lengthPerColourM-controllerReserve-system.cableStockPlan.reservePerColourM).toFixed(3));
system.cableStockPlan.controllerRoutePerColourM=controllerReserve;
system.cableStockPlan.pvRoutePerColourM=pvReserve;
system.cableStockPlan.note=`Shared 9.144 m per colour: reserve ${controllerReserve.toFixed(2)} m for controller/shunt, ${pvReserve.toFixed(2)} m for PV including disconnect tails, and 0.244 m trim margin. Both negative shunt legs are included. Measure the real rooftop route; illustrative scene distances do not prove the pack covers the site.`;
const cableRow=system.bom.find((row:{id:string})=>row.id==='polowat-pv-cable');
cableRow.description=cableRow.description.replace(/ Per colour allocate .*? Offcuts replace/, ' Offcuts replace').replace(/ P14 routed controller cuts.*$/, '')+' '+system.cableStockPlan.note;
system.assemblyReview.revision='P16';
system.assemblyReview.workspaceMm=[Math.max(...assemblyParts.map(p=>p.x+p.width))+10,424];
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
