import assert from 'node:assert/strict';
import test from 'node:test';
import { polowatRuntime as runtime } from '../app/polowatRuntime';
import { dseRuntime } from '../app/dseRuntime';
import { polowatDiagramRuntime } from '../app/polowatDiagramRuntime';
import { roundedRouteCurve } from '../app/cableCurve3D';
import { roundedRoutePieces,MIN_ROUTE_BEND_SEGMENTS } from '../app/renderedCableGeometry';
import { conductorColor } from '../app/systemGraph';
import { sampledResolvedDeviceOverlaps } from '../app/systemGraphRuntime';

test('both projects use collision-gated precomputed runtimes; Polowat diagram is the same physical graph',()=>{
 assert.equal(polowatDiagramRuntime,runtime);
 for(const r of [runtime,dseRuntime]){
  assert.equal(r.diagnostics.source,'precomputed');
  for(const k of ['fallbacks','centerlineConflicts','sweptCableConflicts','selfIntersections','deviceConflicts','renderedGeometryConflicts'] as const)assert.equal(r.diagnostics[k],0,k);
  assert.equal(sampledResolvedDeviceOverlaps(r.devices).length,0);
  assert.ok(r.routes.every(c=>c.routed&&c.points.length>=2));
 }
});
test('shared cable curves preserve terminal tangents, resolve every bend and use blue data',()=>{
 assert.equal(conductorColor[runtime.routeById.get('monitor-rj12')!.kind],'#2563eb');
 for(const route of runtime.routes){
  const radius=Math.max(.009,route.diameterMm/2000*4.25);
  const pieces=roundedRoutePieces(route.points,radius);
  assert.ok(pieces.filter(p=>p.bend).every(p=>p.divisions>=MIN_ROUTE_BEND_SEGMENTS));
  const curve=roundedRouteCurve(route.points,radius);
  const from=runtime.conductorByKey.get(route.from)!,to=runtime.conductorByKey.get(route.to)!;
  const first=curve.getTangent(0),last=curve.getTangent(1);
  assert.ok(first.toArray().reduce((s,v,i)=>s+v*from.direction[i],0)>.999,route.id+' start');
  assert.ok(last.toArray().reduce((s,v,i)=>s-v*to.direction[i],0)>.999,route.id+' end');
  for(let i=1;i<route.points.length-1;i++){
   const a=route.points[i].map((v,j)=>v-route.points[i-1][j]);
   const b=route.points[i+1].map((v,j)=>v-route.points[i][j]);
   assert.ok(a.reduce((s,v,j)=>s+v*b[j],0)>=-1e-9,route.id+' must not reverse');
  }
 }
});

test('cables stay out of device fronts and the enclosure open face',async()=>{
 const {deviceLocalPoint}=await import('../app/physicalLayout');
 for(const route of runtime.routes){
  const curve=roundedRouteCurve(route.points,Math.max(.009,route.diameterMm/2000*4.25));
  const points=curve.getPoints(Math.max(curve.tubularSegments,Math.ceil(curve.getLength()/.005)));
  for(const d of runtime.devices.filter(d=>d.placement.space==='junction'||d.placement.space==='world'&&d.placement.surface==='wall')){
   for(const point of points){
    const [x,y,z]=deviceLocalPoint(d,point.toArray() as [number,number,number]);
    assert.ok(!(Math.abs(x)<d.size[0]/2-1e-6&&Math.abs(y)<d.size[1]/2-1e-6&&z>d.size[2]/2+.005),`${route.id} crosses in front of ${d.id}`);
   }
  }
 }
});

test('Polowat artifact invalidates when its shared engine or project inputs change',async()=>{
 const {runtimeSourceHash}=await import('../scripts/runtimeArtifact');
 const {polowatGraph}=await import('../app/polowatGraph');
 const {readFile}=await import('node:fs/promises');
 const artifact=JSON.parse(await readFile(new URL('../data/generated/polowat-runtime.json',import.meta.url),'utf8'));
 assert.equal(artifact.sourceHash,await runtimeSourceHash(polowatGraph,['app/polowatGraph.ts','app/polowatTopology.ts','app/polowatHardware.ts']));
});
