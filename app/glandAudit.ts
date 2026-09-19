import type {GraphRuntime,Vec3} from './systemGraph';
import {deviceLocalPoint} from './physicalLayout';
import {roundedRoutePieces,sampleCableCurve} from './renderedCableGeometry';
import {glandDimensions} from './glandGeometry';

/** Check the rendered centreline through the full sleeve, not just an A* door cell. */
export function glandCrossingFailures(runtime:Pick<GraphRuntime,'graph'|'glands'|'deviceById'|'routeById'>):string[] {
 const failures:string[]=[];
 for(const gland of runtime.glands){
  if(!runtime.graph.junctions.find(j=>j.deviceId===gland.junctionId)?.centeredGlands)continue;
  const container=runtime.deviceById.get(gland.junctionId)!;
  const centre=deviceLocalPoint(container,gland.position);
  const diameter=Math.max(...gland.connectionIds.map(id=>runtime.routeById.get(id)!.diameterMm));
  const sleeve=glandDimensions(diameter);
  for(const id of gland.connectionIds){
   const route=runtime.routeById.get(id)!;
   const points=sampleCableCurve(roundedRoutePieces(route.points,Math.max(.009,route.diameterMm/2000*4.25))).map(p=>deviceLocalPoint(container,p));
   const inPanel=(p:Vec3)=>Math.abs(p[0])<=container.size[0]/2+1e-8&&Math.abs(p[2])<=container.size[2]/2+1e-8;
   let crossings=0;let bad=false;
   for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if((a[1]<centre[1]&&b[1]>=centre[1])||(b[1]<centre[1]&&a[1]>=centre[1])){
     const t=(centre[1]-a[1])/(b[1]-a[1]);
     if(inPanel([a[0]+t*(b[0]-a[0]),centre[1],a[2]+t*(b[2]-a[2])]))crossings++;
    }
    const probes:Vec3[]=[a,b].filter(p=>Math.abs(p[1]-centre[1])<=sleeve.length/2+1e-8);
    for(const y of [centre[1]-sleeve.length/2,centre[1],centre[1]+sleeve.length/2]){
     if(Math.abs(a[1]-b[1])<1e-9)continue;
     const t=(y-a[1])/(b[1]-a[1]);
     if(t>=0&&t<=1)probes.push([a[0]+t*(b[0]-a[0]),y,a[2]+t*(b[2]-a[2])]);
    }
    if(probes.filter(inPanel).some(p=>Math.hypot(p[0]-centre[0],p[2]-centre[2])+route.diameterMm/2000>sleeve.boreRadius+1e-7))bad=true;
   }
   if(crossings!==1||bad)failures.push(`${id}: ${crossings} shell crossings; ${bad?'cable leaves sleeve bore':'bore aligned'} (${gland.id})`);
  }
 }
 return failures;
}
