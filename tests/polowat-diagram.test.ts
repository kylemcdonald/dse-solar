import assert from 'node:assert/strict';
import test from 'node:test';
import {polowatDiagramRuntime as runtime} from '../app/polowatDiagramRuntime';
import {selectedPolowatBreakerRouting} from '../app/polowatLayout';
import {polowatTopology} from '../app/polowatTopology';
import {polowatParts as assemblyParts,terminalGroups} from '../app/polowatHardware';
import layouts from '../data/generated/polowat-diagram-layouts.json';

test('Polowat shared schematic represents every canonical device and circuit without combining rail groups',()=>{
 assert.deepEqual(runtime.devices.map(d=>d.id),polowatTopology.devices.map(d=>d.id));
 assert.deepEqual(runtime.routes.map(r=>r.id),polowatTopology.connections.map(c=>c.id));
 for(const route of runtime.routes){assert.ok(runtime.conductorByKey.has(route.from));assert.ok(runtime.conductorByKey.has(route.to));}
 const endpoints=runtime.routes.flatMap(r=>[r.from,r.to]);assert.equal(new Set(endpoints).size,endpoints.length);
 for(const group of terminalGroups){
  const ports=runtime.deviceById.get(group.part)!.conductors.filter(p=>p.id.startsWith(group.id+'-'));
  assert.equal(ports.length,4);for(const port of ports)assert.ok(port.internalMates!.every(id=>id.startsWith(group.id+'-')));
 }
 assert.equal(runtime.graph.junctions.length,1);
 assert.deepEqual(runtime.devices.filter(d=>d.kind==='busbar').map(d=>d.id),['positiveBus','negativeBus','loadPositiveBus','loadNegativeBus']);
 for(const id of ['batteryBreakerA','batteryBreakerB']){
  assert.equal(runtime.deviceById.get(id)!.placement.space,'junction');
  assert.ok(assemblyParts.some(p=>p.id===id));
 }
 for(const [letter,id] of [['a','batteryBreakerA'],['b','batteryBreakerB']]){
  assert.equal(runtime.routes.find(r=>r.id===`battery-${letter}-positive`)!.to,`${id}.${selectedPolowatBreakerRouting.includes(id)?"bottom":"top"}-0`);
  assert.equal(runtime.routes.find(r=>r.id===`battery-${letter}-positive-bus`)!.from,`${id}.${selectedPolowatBreakerRouting.includes(id)?"top":"bottom"}-0`);
 }
});

test('both generated Polowat scopes use the shared orthogonal router without geometry violations',()=>{
 assert.equal(layouts.graphId,runtime.graph.id);assert.equal(layouts.graphRevision,runtime.graph.revision);
 const inside=new Set<string>(assemblyParts.map(p=>p.id));
 assert.ok(layouts.layouts.system.nodes.some(n=>n.deviceId==='equipmentEnclosure'&&n.abstractJunction));
 assert.ok(layouts.layouts.system.nodes.every(n=>!inside.has(n.deviceId)));
 assert.deepEqual(layouts.layouts.equipmentEnclosure.nodes.map(n=>n.deviceId).sort(),[...inside].sort());
 for(const layout of Object.values(layouts.layouts)){
  for(const key of ['routingFallbacks','coincidentSegments','nonOrthogonalSegments','unbridgedCrossings','conductorOverlaps','parallelEnvelopeOverlaps','nodeBodyCrossings','nodeOverlaps'] as const)assert.equal(layout[key],0,key);
  for(const wire of layout.wires)assert.ok(wire.points.slice(1).every((p,i)=>p.x===wire.points[i].x||p.y===wire.points[i].y));
 }
 assert.equal(layouts.layouts.equipmentEnclosure.wires.length,28);
});


test('the BMV shunt is the only high-current path from combined batteries to MPPT BATT minus',()=>{
 const connections=polowatTopology.connections;
 const negative=connections.filter(c=>c.kind==='negative');
 assert.deepEqual(negative.filter(c=>c.from==='negativeBus'||c.to==='negativeBus').map(c=>c.id).sort(),['battery-a-negative','battery-b-negative','battery-bus-shunt']);
 assert.equal(runtime.routeById.get('battery-bus-shunt')!.to,'batteryShunt.shunt-battery');
 assert.equal(runtime.routeById.get('mppt-battery-negative')!.to,'batteryShunt.shunt-system');
 assert.ok(!negative.some(c=>[c.from,c.to].includes('loadNegativeBus')&&[c.from,c.to].some(id=>['batteryShunt','negativeBus'].includes(id))));
 assert.equal(runtime.routeById.get('monitor-rj12')!.kind,'data');
 assert.equal(connections.find(c=>c.id==='monitor-positive-fuse')!.to,'monitorFuse');
 assert.equal(connections.find(c=>c.id==='monitor-fuse-shunt')!.from,'monitorFuse');
 const purchased=polowatTopology.devices.filter(d=>d.bomId==='polowat-battery-monitor');
 assert.deepEqual(purchased.map(d=>d.id),['batteryShunt','batteryMonitor','monitorFuse']);
});
