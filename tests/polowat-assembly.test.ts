import assert from 'node:assert/strict';
import test from 'node:test';
import {assemblyParts,assemblyPorts,assemblyWires,terminalGroups,assemblyIssues} from '../app/polowatAssembly';
import system from '../data/polowat-system.json';
import {polowatTopology} from '../app/polowatTopology';

test('DIN assembly has four isolated bridged pairs on one contiguous kit',()=>{
 assert.equal(terminalGroups.length,4);
 assert.equal(terminalGroups.reduce((n,g)=>n+g.blockCount,0),8);
 for(let i=1;i<4;i++)assert.equal(terminalGroups[i].x,terminalGroups[i-1].x+20);
 assert.equal(new Set(terminalGroups.map(g=>g.y)).size,1);
 assert.equal(system.assemblyReview.endCovers,1);
 assert.equal(system.assemblyReview.usedJumpers,4);
 const groupTerminals=terminalGroups.flatMap(g=>assemblyPorts.filter(p=>p.id.startsWith(g.id+'-')).map(p=>p.id));
 assert.equal(groupTerminals.length,16);
 assert.equal(new Set(groupTerminals).size,16);
 for(const g of terminalGroups)assert.equal(assemblyWires.filter(w=>w.from.startsWith(g.id+'-')||w.to.startsWith(g.id+'-')).length,g.id==='main-positive'?4:3);
 for(const asin of ['B000OTJ89Q','B06XPZG45K','B09YCRNGP9'])assert.ok(!system.cartStaging.items.some(r=>r.asin===asin));
});
test('every internal graph connection has explicit unique wire landings',()=>{
 const partIds=new Set(assemblyParts.map(p=>p.id));
 const internal=polowatTopology.connections.filter(c=>partIds.has(c.from)&&partIds.has(c.to));
 for(const c of internal)assert.equal(assemblyWires.filter(w=>w.id===c.id).length,1,c.id);
 const occupied=assemblyWires.flatMap(w=>[w.from,w.to]);assert.equal(new Set(occupied).size,occupied.length,'one field conductor per clamp');
 for(const w of assemblyWires){assert.ok(assemblyPorts.some(p=>p.id===w.from));assert.ok(assemblyPorts.some(p=>p.id===w.to));assert.ok(Number.isFinite(w.lengthM)&&w.lengthM>0);}
 assert.ok(!assemblyWires.some(w=>(w.from.startsWith('main-negative')&&w.to.startsWith('load-negative'))||(w.to.startsWith('main-negative')&&w.from.startsWith('load-negative'))));
});
test('unmeasured fit and cable routing cannot be mistaken for fabrication release',()=>{
 assert.equal(system.assemblyReview.referenceBoxFits,false);
 assert.equal(system.assemblyReview.status,'dimensioned-study-not-fabrication-release');
 assert.ok(assemblyIssues.some(i=>i.id==='box'&&i.status==='Unresolved'));
 assert.ok(assemblyIssues.some(i=>i.id==='wires'&&i.status==='Unresolved'));
 assert.ok(!system.cartStaging.items.some(r=>r.asin==='B0CT5LRGRF'));
});
