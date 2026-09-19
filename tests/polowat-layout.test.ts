import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import fiji from '../data/generated/dse-runtime.json';
import baseline from './fixtures/fiji-physical-layout.json';
import comparison from '../data/generated/polowat-layout-comparison.json';
import breakerComparison from '../data/generated/polowat-breaker-comparison.json';
import {selectedPolowatLayout} from '../app/polowatLayout';
import {polowatRuntime as runtime} from '../app/polowatRuntime';
import {dseTopology} from '../app/dseTopology';
import {glandCrossingFailures} from '../app/glandAudit';
import {entryPanelGeometry,glandDimensions,glandSleeveGeometry} from '../app/glandGeometry';
import {roundedRoutePieces,sampleCableCurve} from '../app/renderedCableGeometry';
import {deviceLocalPoint} from '../app/physicalLayout';
import type {Vec3} from '../app/systemGraph';

test('Fiji geometry stays byte-for-byte identical to the pre-compact-layout baseline',()=>{
 const geometry={devices:fiji.devices,conductors:fiji.conductors,glands:fiji.glands,routes:fiji.routes};
 assert.equal(createHash('sha256').update(JSON.stringify(geometry)).digest('hex'),baseline.sha256);
 assert.ok(dseTopology.junctions.every(j=>!j.contiguousDin&&!j.centeredGlands));
});

test('Polowat removes blanket clearances and packs all DIN devices on one continuous lower rail',()=>{
 const j=runtime.graph.junctions[0];
 assert.equal(j.dinPosition,'bottom');assert.equal(j.dinGap,0);assert.equal(j.backplateGap,0);
 assert.ok(runtime.devices.every(d=>!d.installationClearanceM));
 const rail=runtime.devices.filter(d=>d.placement.space==='junction'&&d.placement.section==='din').toSorted((a,b)=>a.position[0]-b.position[0]);
 assert.equal(rail.length,10);
 for(let i=1;i<rail.length;i++){
  assert.equal(rail[i].position[1],rail[0].position[1]);
  assert.ok(Math.abs(rail[i].position[0]-rail[i-1].position[0]-(rail[i].size[0]+rail[i-1].size[0])/2)<1e-8,rail[i].id+' must touch its neighbour');
 }
 const shell=runtime.deviceById.get(j.deviceId)!;
 assert.ok(rail[0].position[1]-rail[0].size[1]/2-(shell.position[1]-shell.size[1]/2)<.10);
 const lowX=rail[0].position[0]-rail[0].size[0]/2,highX=rail.at(-1)!.position[0]+rail.at(-1)!.size[0]/2;
 const halfHeight=Math.min(...rail.map(d=>d.size[1]/2));
 for(const route of runtime.routes){
  const points=sampleCableCurve(roundedRoutePieces(route.points,Math.max(.009,route.diameterMm/2000*4.25)));
  assert.ok(points.every(p=>!(p[0]>lowX+1e-6&&p[0]<highX-1e-6&&Math.abs(p[1]-rail[0].position[1])<halfHeight-1e-6&&Math.abs(p[2]-shell.position[2])<shell.size[2]/2)),route.id+' tunnels through the rail');
 }
});

test('every external cable traverses its own gland bore and the rendered hole is actually open',()=>{
 assert.equal(runtime.glands.length,9);
 assert.deepEqual(glandCrossingFailures(runtime),[]);
 const shell=runtime.deviceById.get('equipmentEnclosure')!;
 const holes=runtime.glands.map(g=>{const [x,,z]=deviceLocalPoint(shell,g.position);const diameter=Math.max(...g.connectionIds.map(id=>runtime.routeById.get(id)!.diameterMm));return {x,z,radius:glandDimensions(diameter).boreRadius};});
 const panel=new THREE.Mesh(entryPanelGeometry(shell.size[0]+.012,shell.size[2],.012,holes),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
 panel.updateMatrixWorld();
 for(const h of holes){const ray=new THREE.Raycaster(new THREE.Vector3(h.x,-.1,h.z),new THREE.Vector3(0,1,0));assert.equal(ray.intersectObject(panel).length,0);}
 const sleeve=new THREE.Mesh(glandSleeveGeometry(7.9),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));sleeve.updateMatrixWorld();
 assert.equal(new THREE.Raycaster(new THREE.Vector3(0,-.1,0),new THREE.Vector3(0,1,0)).intersectObject(sleeve).length,0);
 assert.ok(new THREE.Raycaster(new THREE.Vector3(.006,-.1,0),new THREE.Vector3(0,1,0)).intersectObject(sleeve).length>0);
 panel.geometry.dispose();panel.material.dispose();sleeve.geometry.dispose();sleeve.material.dispose();
});

test('gland audit rejects a cable passing in front of its assigned opening',()=>{
 const route=runtime.routeById.get('battery-a-positive')!;
 const routes=new Map(runtime.routeById);
 routes.set(route.id,{...route,points:route.points.map(([x,y,z])=>[x,y,z+.04] as Vec3)});
 assert.ok(glandCrossingFailures({...runtime,routeById:routes}).some(message=>message.startsWith(route.id+':')));
});

test('selected Polowat configuration has the best score among eight tested valid layouts',()=>{
 assert.equal(comparison.results.length,8);
 const valid=comparison.results.filter(r=>r.valid);
 const selected=valid.find(r=>r.layout.id===selectedPolowatLayout.id)!;
 assert.ok(selected);
 assert.equal(selected.score,Math.min(...valid.map(r=>r.score!)));
 assert.deepEqual(selected.sizeMm,runtime.deviceById.get('equipmentEnclosure')!.size.map(n=>Math.round(n*1000)));
 // The layout sweep precedes the separate terminal-direction optimization.
 assert.equal(selected.totalLengthM,breakerComparison.results.find(r=>r.mask===0)!.totalLengthM);
});
