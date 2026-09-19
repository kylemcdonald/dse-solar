import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalGroups } from '../app/polowatHardware';
import { polowatRuntime as runtime } from '../app/polowatRuntime';
import system from '../data/polowat-system.json';
test('four isolated terminal pairs share one contiguous rail and preserve the purchased kit',()=>{
 assert.equal(terminalGroups.length,4);
 assert.equal(terminalGroups.reduce((n,g)=>n+g.blockCount,0),8);
 const blocks=terminalGroups.map(g=>runtime.deviceById.get(g.part)!);
 for(let i=1;i<blocks.length;i++){
  assert.ok(Math.abs(blocks[i].position[0]-blocks[i-1].position[0]-(blocks[i].size[0]+blocks[i-1].size[0])/2)<1e-8);
  assert.equal(blocks[i].position[1],blocks[i-1].position[1]);
 }
 for(const b of blocks){assert.equal(b.conductors.length,4);for(const p of b.conductors)assert.equal(p.internalMates?.length,3);}
 assert.equal(system.assemblyReview.endCovers,1);assert.equal(system.assemblyReview.usedJumpers,4);
 assert.equal(system.assemblyReview.referenceBoxFits,false);
 assert.ok(!system.cartStaging.items.some(r=>r.asin==='B0CT5LRGRF'));
});
