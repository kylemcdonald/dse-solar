import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPolowatGraph,polowatGraph} from '../app/polowatGraph';
import {selectedPolowatLayout,reversiblePolowatBreakers,selectedPolowatBreakerRouting} from '../app/polowatLayout';
import {polowatRuntime} from '../app/polowatRuntime';
import comparison from '../data/generated/polowat-breaker-comparison.json';
import {roundedRoutePieces} from '../app/renderedCableGeometry';

test('reversible breakers exchange physical terminal connections, never pole identities or body placement',()=>{
 const base=buildPolowatGraph(selectedPolowatLayout);
 for(const id of reversiblePolowatBreakers)for(const port of base.devices.find(d=>d.id===id)!.conductors)assert.match(port.label,/^(Top|Bottom) clamp [12]$/);
 for(let mask=0;mask<8;mask++){
  const reversed=reversiblePolowatBreakers.filter((_,i)=>mask&(1<<i));
  const graph=buildPolowatGraph(selectedPolowatLayout,reversed);
  assert.deepEqual(graph.devices,base.devices);
  for(let i=0;i<base.connections.length;i++)for(const side of ['from','to'] as const){
   const before=base.connections[i][side],after=graph.connections[i][side];
   const [device,terminal]=before.split('.');
   if(reversed.includes(device as typeof reversed[number])){
    assert.equal(after,`${device}.${terminal.replace(/^(top|bottom)-/,s=>s==='top-'?'bottom-':'top-')}`);
   }else assert.equal(after,before);
  }
 }
 for(const id of ['pvBreaker','starlinkBreaker','usbBreaker'])assert.throws(()=>buildPolowatGraph(selectedPolowatLayout,[id]),/cannot reverse/);
});

test('selected breaker routing minimizes the measured score and matches the generated model',()=>{
 assert.deepEqual(comparison.results.map(r=>r.mask),[0,1,2,3,4,5,6,7]);
 const valid=comparison.results.filter(r=>r.valid);
 const winner=valid.toSorted((a,b)=>a.score!-b.score!)[0];
 assert.deepEqual(selectedPolowatBreakerRouting,winner.reversed);
 assert.deepEqual(polowatGraph.connections,buildPolowatGraph(selectedPolowatLayout,winner.reversed).connections);
 const total=polowatRuntime.routes.reduce((n,r)=>n+roundedRoutePieces(r.points,Math.max(.009,r.diameterMm/2000*4.25)).reduce((n,p)=>n+p.lengthM,0),0);
 assert.equal(+total.toFixed(3),winner.totalLengthM);
});
