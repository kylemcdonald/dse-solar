import type {SystemGraph, GraphRuntime} from './systemGraph';
import {deviceLocalPoint} from './physicalLayout';

export type DinArrangement = {order:readonly string[]; spacesAfter:Readonly<Record<string,number>>};
export type DinEvaluation = {arrangement:DinArrangement; valid:boolean; score?:number; totalLengthM?:number; batterySourceLeadM?:number; turns?:number; sizeMm?:number[]; means?:Record<string,number>; failures?:Record<string,number>; error?:string};

/** Each connected clamp gets one vote at the far end of its wire. Unused clamps get none.
 * External wires may instead vote at their assigned enclosure gland, the local routing anchor. */
export function dinEndpointMeans(graph:SystemGraph, runtime:Pick<GraphRuntime,'conductors'|'glands'|'devices'>, order:readonly string[], useGlands=false):Record<string,number>{
 const ports=new Map(runtime.conductors.map(p=>[p.key,p]));
 const devices=new Map(runtime.devices.map(d=>[d.id,d]));
 return Object.fromEntries(order.map(id=>{
  const device=devices.get(id)!;
  const container=device.placement.space==='junction'?devices.get(device.placement.junctionId):undefined;
  const x=(p:typeof device.position)=>container?deviceLocalPoint(container,p)[0]:p[0];
  const points:number[]=[];
  for(const connection of graph.connections){
   const from=ports.get(connection.from)!,to=ports.get(connection.to)!;
   if(from.deviceId!==id&&to.deviceId!==id)continue;
   const peer=from.deviceId===id?to:from;
   const gland=useGlands?runtime.glands.find(g=>g.connectionIds.includes(connection.id)):undefined;
   points.push(x(gland?.position??peer.position));
  }
  return [id,points.length?points.reduce((a,b)=>a+b,0)/points.length:x(device.position)];
 }));
}
export function barycentricDinOrder(order:readonly string[], means:Readonly<Record<string,number>>):string[]{
 const rank=new Map(order.map((id,i)=>[id,i]));
 return [...order].sort((a,b)=>Math.abs(means[a]-means[b])<1e-8?rank.get(a)!-rank.get(b)!:means[a]-means[b]);
}
export function normalizeDinArrangement(a:DinArrangement):DinArrangement {
 if(new Set(a.order).size!==a.order.length)throw Error('Duplicate DIN device');
 for(const [id,gap] of Object.entries(a.spacesAfter)){
  if(!a.order.includes(id))throw Error('Unknown DIN aisle device: '+id);
  if(!Number.isFinite(gap)||gap<0||Math.abs(gap/.02-Math.round(gap/.02))>1e-8)throw Error('DIN aisles must be nonnegative whole routing cells');
 }
 const spacesAfter=Object.fromEntries(a.order.slice(0,-1).filter(id=>(a.spacesAfter[id]??0)>0).map(id=>[id,Math.round(a.spacesAfter[id]/.02)*.02]));
 return {order:[...a.order],spacesAfter};
}
export const dinArrangementKey=(a:DinArrangement)=>JSON.stringify(normalizeDinArrangement(a));
export const improvesDin=(a:DinEvaluation,b:DinEvaluation)=>a.valid&&(!b.valid||a.score!<b.score!-1e-8);

/** Route-guided coordinate descent. Cached evaluations make cycles finite; only audited
 * improvements replace the incumbent. A whole neighborhood must fail before stopping. */
export async function refineDinArrangement(initial:DinEvaluation,evaluate:(a:DinArrangement,phase:string)=>Promise<DinEvaluation>,maxSweeps=20){
 let best=initial;
 for(let sweep=0;sweep<maxSweeps;sweep++){
  const before=best;
  const order=best.arrangement.order;
  const candidates:DinArrangement[]=[];
  if(best.means)candidates.push({...best.arrangement,order:barycentricDinOrder(order,best.means)});
  for(let i=0;i<order.length-1;i++){
   const swapped=[...order];[swapped[i],swapped[i+1]]=[swapped[i+1],swapped[i]];
   candidates.push({...best.arrangement,order:swapped});
  }
  for(const id of order.slice(0,-1)){
   const gap=best.arrangement.spacesAfter[id]??0;
   for(const next of [gap-.02,gap+.02])if(next>=-1e-8&&next<=.06000001)candidates.push({...best.arrangement,spacesAfter:{...best.arrangement.spacesAfter,[id]:Math.max(0,next)}});
  }
  const unique=[...new Map(candidates.map(a=>[dinArrangementKey(a),a])).values()];
  // Evaluations are independent; callers isolate stateful routers in child processes.
  for(let i=0;i<unique.length;i+=4){
   const results=await Promise.all(unique.slice(i,i+4).map(a=>evaluate(a,`refine-${sweep}`)));
   for(const result of results)if(improvesDin(result,best))best=result;
  }
  if(best===before)return {best,converged:true,sweeps:sweep+1};
 }
 return {best,converged:false,sweeps:maxSweeps};
}
