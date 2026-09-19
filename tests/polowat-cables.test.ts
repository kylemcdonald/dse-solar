import test from 'node:test';
import assert from 'node:assert/strict';
import {polowatCableRoutes as plan,cableCurve} from '../app/polowatCableRoutes';
import {polowatTopology} from '../app/polowatTopology';
import system from '../data/polowat-system.json';

test('displayed cable centreline lengths, cut allowances and purchased packs agree',()=>{
 assert.equal(plan.revision,polowatTopology.revision);
 assert.deepEqual(plan.routes.map(r=>r.id),polowatTopology.connections.map(c=>c.id));
 for(const r of plan.routes){
  assert.ok(Math.abs(cableCurve(r.points,r.diameterMm).getLength()-r.modelLengthM)<1e-8,r.id);
  assert.ok(Math.abs((r.inside.length?cableCurve(r.inside,r.diameterMm).getLength():0)+(r.outside.length?cableCurve(r.outside,r.diameterMm).getLength():0)-r.modelLengthM)<1e-8,r.id+' segments are counted once');
  if(r.fieldCut)assert.ok(r.cutLengthM+1e-8>=r.modelLengthM*1.15+.10,r.id+' includes slack and ends');
 }
 for(const awg of [8,10,12])for(const color of ['red','black']){
  const demand=plan.routes.filter(r=>r.fieldCut&&r.gauge.startsWith(awg+' AWG')&&r.color===color).reduce((s,r)=>s+r.cutLengthM,0);
  const stock=system.bom.filter(r=>'wireStock' in r&&r.wireStock?.awg===awg&&[color,'red-and-black'].includes(r.wireStock.color)).reduce((s,r)=>s+r.wireStock!.lengthM*r.qty,0);
  const reported=plan.stock.find(s=>s.awg===awg&&s.color===color)!;
  assert.equal(reported.availableM,stock);
  assert.ok(Math.abs(reported.requiredM-demand)<1e-8);
  assert.ok(Math.abs(reported.shortfallM-Math.max(0,demand-stock))<1e-8);
 }
 const branch=(letter:string,suffix:string[])=>plan.routes.filter(r=>suffix.some(s=>r.id===`battery-${letter}-${s}`)).reduce((s,r)=>s+r.cutLengthM,0);
 assert.ok(Math.abs(branch('a',['positive','positive-bus'])-branch('b',['positive','positive-bus']))<1e-8);
 assert.equal(branch('a',['negative']),branch('b',['negative']));
 assert.ok(system.routedCablePlan.allowanceBatteryControllerDropPercent>3);
 assert.ok(!system.bom.some(b=>b.item.includes('Ancor')));
 assert.ok(system.bom.some(b=>b.amazonAsin==='B00CXKOEQ6'&&b.description.includes('outside the published range')));
});

test('PV and monitor/controller returns share one 10 AWG stock pack without double counting it',()=>{
 for(const color of ['red','black']){
  const demand=plan.routes.filter(r=>r.fieldCut&&r.gauge.startsWith('10 AWG')&&r.color===color).reduce((sum,r)=>sum+r.cutLengthM,0);
  const stock=system.bom.filter(r=>'wireStock' in r&&r.wireStock?.awg===10&&[color,'red-and-black'].includes(r.wireStock.color)).reduce((sum,r)=>sum+r.wireStock!.lengthM*r.qty,0);
  const reported=plan.stock.find(s=>s.awg===10&&s.color===color)!;
  assert.ok(Math.abs(reported.requiredM-demand)<1e-8);
  assert.ok(Math.abs(reported.shortfallM-Math.max(0,demand-stock))<1e-8);
 }
 assert.deepEqual(system.routedCablePlan.totals,plan.totals);
 assert.equal(system.routedCablePlan.includesShuntResistanceOhms,.0001);
 const supplied=plan.routes.filter(r=>r.gauge==='Factory fused lead').reduce((sum,r)=>sum+r.modelLengthM,0);
 assert.ok(supplied<2,'supplied positive lead spans both sides of the inline fuse');
 assert.ok(plan.routes.find(r=>r.id==='monitor-rj12')!.modelLengthM<10,'included display cable reaches');
});
