import system from "../data/polowat-system.json";
import { polowatRuntime } from "./polowatRuntime";
const shell=polowatRuntime.deviceById.get("equipmentEnclosure")!;
const [width,height,depth]=shell.size.map(n=>n*1000);
const parts=polowatRuntime.devices.filter(d=>d.placement.space==='junction').map(d=>({
 id:d.id,label:d.label,x:(d.position[0]-shell.position[0]-d.size[0]/2)*1000+width/2,
 y:height/2-(d.position[1]-shell.position[1]+d.size[1]/2)*1000,
 width:d.size[0]*1000,height:d.size[1]*1000,depth:d.size[2]*1000,
}));
const mppt=parts.find(p=>p.id==='mppt')!;
/** Every planning view reads the same solved enclosure and equipment positions. */
export const polowatEnclosure={
 outer:{width:system.enclosurePlan.outerMm[1],height:system.enclosurePlan.outerMm[0],depth:system.enclosurePlan.outerMm[2]},
 mounting:null,layoutStatus:'bench-assembly-pending',bench:{width,height},
 source:system.enclosurePlan.sourceUrl,allowanceUsd:system.bom.find(b=>b.id==='polowat-enclosure')!.totalUsd,
 parts,controllerClearance:{x:mppt.x,y:mppt.y-100,width:mppt.width,height:mppt.height+200},
};
export const polowatPlanningShell={position:shell.position,size:shell.size};
export const polowatPlanningEnvelope={left:0,right:width,top:0,bottom:height,back:0,front:depth,wallMm:3};
