import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {createPolowatAssembly} from '../app/polowatAssemblyGeometry';
import {assemblyParts,assemblyWires,assemblyPorts} from '../app/polowatAssembly';
import {polowatAssemblyOrigin,polowatPlanningEnvelope,polowatEnclosure} from '../app/polowatEnclosure';
import {createPolowatShell} from '../app/polowatShellGeometry';
import {polowatDeviceById} from '../app/polowatTopology';

test('detailed hardware shares whole-system metre coordinates and device identities',()=>{
 const assembly=createPolowatAssembly();assembly.group.updateMatrixWorld(true);
 assert.equal(assembly.devices.size,assemblyParts.length);
 for(const part of assemblyParts){
  const object=assembly.devices.get(part.id)!;
  const body=object.children.find(child=>child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry)!;
  const point=body.getWorldPosition(new THREE.Vector3());
  const expected=polowatDeviceById.get(part.id)!;
  // Multi-block terminal groups are centered on their combined envelope.
  if(!['terminals','shunt'].includes(part.kind)) assert.ok(point.distanceTo(new THREE.Vector3(...expected.position))<1e-9,part.id);
  assert.ok(object.children.every(child=>child.userData.deviceId===part.id),part.id);
 }
 assert.equal(assembly.interactive.filter(object=>String(object.userData.info).startsWith('DK10N block')).length,8);
 assert.equal(assembly.interactive.filter(object=>String(object.userData.info).includes('one DSS10N-02P')).length,4);
 for(const wire of assemblyWires)assert.equal(assembly.interactive.filter(object=>object.userData.connectionId===wire.id).length,1,wire.id);
 let labels=0;assembly.group.traverse(object=>{if(object instanceof THREE.Sprite)labels++;});assert.equal(labels,0);
});

test('planning shell contains installed bodies and cable curves with openings at every entry',()=>{
 const assembly=createPolowatAssembly();assembly.group.updateMatrixWorld(true);
 const e=polowatPlanningEnvelope;
 const world=(x:number,y:number,z:number)=>new THREE.Vector3(polowatAssemblyOrigin[0]+(x-polowatEnclosure.bench.width/2)/1000,polowatAssemblyOrigin[1]+(polowatEnclosure.bench.height/2-y)/1000,polowatAssemblyOrigin[2]+z/1000);
 const inner=new THREE.Box3(world(e.left,e.bottom,e.back),world(e.right,e.top,e.front));
 for(const [id,object] of assembly.devices)assert.ok(inner.containsBox(new THREE.Box3().setFromObject(object)),id+' fits inside shell');
 for(const object of assembly.interactive.filter(o=>o instanceof THREE.Mesh && o.geometry instanceof THREE.TubeGeometry)){
  const mesh=object as THREE.Mesh;const positions=mesh.geometry.getAttribute('position');
  for(let i=0;i<positions.count;i++){
   const point=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
   if(inner.containsPoint(point))continue;
   // Cable ends may leave the wall only through their entry openings.
   const entry=assemblyPorts.filter(p=>p.owner==='entry').some(p=>{
    const center=world(...p.point);return Math.hypot(point.x-center.x,point.z-center.z)<.00925&&Math.abs(point.y-center.y)<.012;
   });
   assert.ok(entry,object.userData.connectionId+' intersects shell away from an entry');
  }
 }
 const device=polowatDeviceById.get('equipmentEnclosure')!;
 const shell=createPolowatShell(device);const bottom=shell.children.find(o=>o.userData.entryOpenings)!;
 assert.equal(bottom.userData.entryOpenings.length,9);
 assert.equal(bottom.userData.entryOpenings.find((o:{id:string})=>o.id==='usb-c').radius,.00925);
 assert.ok(device.size[0]>polowatEnclosure.outer.width/1000);
 assert.ok(device.size[1]>polowatEnclosure.outer.height/1000);
});
