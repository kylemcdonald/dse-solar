import test from 'node:test';
import assert from 'node:assert/strict';
import {barycentricDinOrder,dinEndpointMeans,dinArrangementKey,normalizeDinArrangement,refineDinArrangement,type DinEvaluation} from '../app/dinRailOptimization';
import type {Vec3} from '../app/systemGraph';
import {buildPolowatGraph} from '../app/polowatGraph';
import {baselinePolowatLayout,selectedPolowatBreakerRouting} from '../app/polowatLayout';
import {resolveDevices,resolveConductors,deviceLocalPoint} from '../app/physicalLayout';

test('endpoint averages include every connected clamp and preserve ties without oscillation',()=>{
 const graph=buildPolowatGraph(baselinePolowatLayout,selectedPolowatBreakerRouting);
 const devices=resolveDevices(graph),conductors=resolveConductors(devices);
 const means=dinEndpointMeans(graph,{devices,conductors,glands:[]},baselinePolowatLayout.dinOrder);
 for(const id of baselinePolowatLayout.dinOrder){
  const peers=graph.connections.flatMap(c=>c.from.startsWith(id+'.')?[c.to]:c.to.startsWith(id+'.')?[c.from]:[]);
  assert.ok(peers.length>=2);
  if(id.endsWith('Bus'))assert.ok(peers.length>=3&&peers.length<=4);
  const expected=peers.reduce((sum,key)=>sum+deviceLocalPoint(devices.find(d=>d.id==='equipmentEnclosure')!,conductors.find(p=>p.key===key)!.position)[0],0)/peers.length;
  assert.equal(means[id],expected);
 }
 assert.deepEqual(barycentricDinOrder(['b','a','c'],{a:0,b:0,c:-1}),['c','b','a']);
 const rotate=([x,y,z]:Vec3):Vec3=>[-y,x,z];
 const rotated={devices:devices.map(d=>({...d,position:rotate(d.position),rotation:[0,0,Math.PI/2] as Vec3})),conductors:conductors.map(p=>({...p,position:rotate(p.position)})),glands:[]};
 const localMeans=dinEndpointMeans(graph,rotated,baselinePolowatLayout.dinOrder);
 for(const id of baselinePolowatLayout.dinOrder)assert.ok(Math.abs(localMeans[id]-means[id])<1e-8,'mean must follow rail axis, not world x');
});

test('declared DIN aisles preserve terminal-grid phase and absent boundaries remain closed',()=>{
 const order=baselinePolowatLayout.dinOrder;
 const graph=buildPolowatGraph({...baselinePolowatLayout,dinSpacesAfter:{[order[2]]:.04,[order[5]]:.02}},selectedPolowatBreakerRouting);
 const devices=resolveDevices(graph),ports=resolveConductors(devices);
 const row=order.map(id=>devices.find(d=>d.id===id)!);
 for(let i=0;i<row.length-1;i++){
  const gap=row[i+1].position[0]-row[i].position[0]-(row[i].size[0]+row[i+1].size[0])/2;
  assert.ok(Math.abs(gap-(graph.junctions[0].dinSpacesAfter?.[row[i].id]??0))<1e-8);
 }
 for(const port of ports.filter(p=>order.includes(p.deviceId)))assert.ok(Math.abs(port.position[0]/.02-Math.round(port.position[0]/.02))<1e-8,port.key);
 assert.throws(()=>resolveDevices(buildPolowatGraph({...baselinePolowatLayout,dinSpacesAfter:{[order[0]]:.01}})),/whole routing cell/);
});

test('route-guided refinement rejects cheaper invalid routes and stops at a local fixed point',async()=>{
 const start:DinEvaluation={arrangement:{order:['b','a','c'],spacesAfter:{}},valid:true,score:10};
 const visited=new Set<string>();
 const result=await refineDinArrangement(start,async arrangement=>{
  visited.add(dinArrangementKey(arrangement));
  const valid=Object.keys(arrangement.spacesAfter).length===0;
  return {arrangement,valid,score:valid?(arrangement.order.join('')==='abc'?5:10):0};
 });
 assert.equal(result.converged,true);
 assert.deepEqual(result.best.arrangement,{order:['a','b','c'],spacesAfter:{}});
 assert.ok(visited.size>3);
});

test('DIN aisle inputs reject negative, off-grid, unknown and nonfinite spaces',()=>{
 const invalid:Record<string,number>[]=[{a:-.02},{a:.01},{unknown:.02},{a:Infinity}];
 for(const spacesAfter of invalid)assert.throws(()=>normalizeDinArrangement({order:['a','b'],spacesAfter}));
 assert.equal(dinArrangementKey({order:['a','b'],spacesAfter:{a:.06-.02}}),dinArrangementKey({order:['a','b'],spacesAfter:{a:.04}}));
 assert.deepEqual(normalizeDinArrangement({order:['a','b'],spacesAfter:{a:0,b:.02}}),{order:['a','b'],spacesAfter:{}});
});

test('fixed-direction DIN search improves the baseline and exhausts its audited local neighborhood',async()=>{
 const {readFileSync}=await import('node:fs');
 const {selectedPolowatLayout}=await import('../app/polowatLayout');
 const report=JSON.parse(readFileSync('data/generated/polowat-din-optimization.json','utf8')) as {converged:boolean;selected:DinEvaluation;results:DinEvaluation[]};
 assert.equal(report.converged,true);
 assert.ok(report.selected.score!<report.results[0].score!);
 assert.ok(report.selected.totalLengthM!<report.results[0].totalLengthM!);
 assert.deepEqual(selectedPolowatLayout.dinOrder,report.selected.arrangement.order);
 assert.deepEqual(selectedPolowatLayout.dinSpacesAfter,report.selected.arrangement.spacesAfter);
 const cache=new Map(report.results.map(r=>[dinArrangementKey(r.arrangement),r]));
 const check=await refineDinArrangement(report.selected,async arrangement=>{
  const result=cache.get(dinArrangementKey(arrangement));
  assert.ok(result,'final neighborhood must be fully evaluated');
  return result;
 },1);
 assert.equal(check.converged,true);
 assert.equal(check.best.score,report.selected.score);
 assert.ok(Object.values(report.selected.failures!).every(n=>n===0));
});
