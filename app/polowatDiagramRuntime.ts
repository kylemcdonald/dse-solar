import { polowatTopology, type PolowatConductorKind } from './polowatTopology';
import { assemblyParts, assemblyPorts, assemblyWires, terminalGroups } from './polowatAssembly';
import type { DiagramRuntime } from './diagramRuntime';
import type { Conductor, ConductorKind, DeviceKind, ResolvedConductor, ResolvedDevice, RoutedConnection, SystemGraph, Gland } from './systemGraph';

const inside = new Set(assemblyParts.map(p=>p.id));
const kind = (k:PolowatConductorKind):ConductorKind => k==='data'?'data':k==='negative'?'negative':k==='usb'||k==='regulated'?'multicore':'positive';
const deviceKinds:Record<string,DeviceKind>={controller:'converter',bus:'busbar',distribution:'connector',enclosure:'junction',monitor:'monitor',shunt:'monitor',fuse:'protection'};
const devices:ResolvedDevice[]=polowatTopology.devices.map(d=>({
 id:d.id,label:d.label,subtitle:d.subtitle,kind:deviceKinds[d.kind]??d.kind as DeviceKind,
 size:d.size,position:d.position,rotation:d.rotation??[0,0,0],status:'planned',
 placement:inside.has(d.id)?{space:'junction',junctionId:'equipmentEnclosure',section:'backplate',order:assemblyParts.findIndex(p=>p.id===d.id)}:{space:'world',surface:d.kind==='battery'?'floor':'wall',position:d.position},
 conductors:[],bomIds:d.bomId?[d.bomId]:[],
}));
const deviceById=new Map(devices.map(d=>[d.id,d]));
const conductors:ResolvedConductor[]=[];
const routes:RoutedConnection[]=polowatTopology.connections.map((c,index)=>{
 const wire=assemblyWires.find(w=>w.id===c.id);
 const endpoints=([c.from,c.to] as const).map((id,side)=>{
  const device=deviceById.get(id)!;
  const landing=wire?[wire.from,wire.to].map(key=>assemblyPorts.find(p=>p.id===key)!).find(p=>p.owner===id):undefined;
  const portKind:ConductorKind=c.kind==='series'&&side===1?'negative':kind(c.kind);
  const source=device.kind==='panel'||device.kind==='battery';
  const portId=landing?landing.id.replace(id+'-',''):source?portKind:device.kind==='breaker'?(side===1?'top-0':'bottom-0'):(side===1?'input':'output');
  const label=landing?.label??(source?(portKind==='negative'?'−':'+'):side===1?'Input':'Output');
  const port:Conductor={id:portId,label,kind:portKind,face:landing?.direction[1]===1?'top':'bottom',gauge:c.gauge,order:source?(portKind==='positive'?0:1):device.conductors.length};
  device.conductors=[...device.conductors,port];
  const key=`${id}.${portId}`;
  conductors.push({...port,key,deviceId:id,position:device.position,direction:[0,-1,0]});
  return key;
 });
 return {id:c.id,label:c.label,from:endpoints[0],to:endpoints[1],kind:kind(c.kind),gauge:c.gauge,cableId:c.id,
  // Physical routing remains the planning scene's responsibility; this graph only drives the schematic.
  points:[],lengthM:0,diameterMm:wire?.diameter??(c.gauge.startsWith('8')?7.9:5),routed:false,routingRank:index};
});
// Only clamps within the same electrical rail group are joined internally.
for(const group of terminalGroups){
 const device=deviceById.get(group.part)!;
 const peers=device.conductors.filter(port=>port.id.startsWith(group.id+'-')).map(port=>port.id);
 device.conductors=device.conductors.map(port=>peers.includes(port.id)?{...port,internalMates:peers.filter(id=>id!==port.id)}:port);
 for(const port of conductors)if(port.deviceId===device.id&&peers.includes(port.id))port.internalMates=peers.filter(id=>id!==port.id);
}
const glands:Gland[]=routes.flatMap(route=>{
 const from=deviceById.get(route.from.split('.')[0])!,to=deviceById.get(route.to.split('.')[0])!;
 if(inside.has(from.id)===inside.has(to.id))return [];
 const external=inside.has(from.id)?to:from;
 return [{id:`entry-${route.id}`,label:`${external.label} · ${route.kind==='negative'?'−':route.kind==='positive'?'+':'cable'}`,junctionId:'equipmentEnclosure',bundleId:route.id,position:[0,0,0],connectionIds:[route.id],face:'bottom'}];
});
const graph:SystemGraph={id:polowatTopology.id,label:'Inowon Polowat',revision:polowatTopology.revision,
 devices,cables:[],connections:routes,junctions:devices.filter(d=>d.kind==='junction').map(d=>({id:d.id,deviceId:d.id,label:d.label,minimumSize:d.size,padding:.015,dinGap:.01,backplateGap:.006,glandSpacing:.036,sizePolicy:'auto'})),currentSources:[]};
export const polowatDiagramRuntime:DiagramRuntime={graph,devices,deviceById,conductors,conductorByKey:new Map(conductors.map(c=>[c.key,c])),glands,routes,routeById:new Map(routes.map(r=>[r.id,r]))};
