import test from 'node:test';
import assert from 'node:assert/strict';
import {breakerFace,breakerVisualSpec} from '../app/breakerGeometry';
import {resolveDevices,validateGraph} from '../app/physicalLayout';
import {buildPolowatGraph} from '../app/polowatGraph';
import {selectedPolowatLayout} from '../app/polowatLayout';
import type {Device} from '../app/systemGraph';

test('one-pole narrow, one-pole wide and two-pole wide use distinct casing and handle geometry',()=>{
 for(const [poles,modules,style] of [[1,1,'single-pole'],[1,2,'wide-single-pole'],[2,2,'linked-poles']] as const){
  const device:Pick<Device,'poles'|'dinModules'|'size'>={poles,dinModules:modules,size:[modules*.02,.1,.08]};
  const face=breakerFace(device);
  assert.equal(breakerVisualSpec(device).style,style);
  assert.equal(face.children.filter(c=>c.name.startsWith('toggle:')).length,poles);
  assert.equal(face.children.filter(c=>c.name.startsWith('pole-face:')).length,poles);
  assert.equal(!!face.getObjectByName('common-handle'),poles===2);
  assert.equal(!!face.getObjectByName('single-handle-bezel'),poles===1&&modules===2);
  if(poles===1)assert.equal(face.getObjectByName('toggle:1')!.position.x,0);
 }
 assert.equal(breakerVisualSpec({size:[.04,.1,.08],poles:1}).poles,1,'width must never invent a second pole');
});

test('a wide single-pole casing retains its two-module layout width',()=>{
 const graph=buildPolowatGraph(selectedPolowatLayout);
 const wide={...graph,devices:graph.devices.map(d=>d.id==='pvBreaker'?{...d,poles:1 as const,dinModules:2 as const}:d)};
 assert.doesNotThrow(()=>validateGraph(wide));
 const before=resolveDevices(graph),after=resolveDevices(wide);
 for(let i=0;i<before.length;i++){
  assert.deepEqual(after[i].size,before[i].size,before[i].id);
  assert.deepEqual(after[i].position,before[i].position,before[i].id);
 }
});
