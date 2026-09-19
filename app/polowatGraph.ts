import { selectedPolowatLayout, reversiblePolowatBreakers, selectedPolowatBreakerRouting, type PolowatLayout } from "./polowatLayout";
import { polowatTopology, type PolowatConductorKind } from './polowatTopology';
import { polowatParts as assemblyParts, polowatPorts as assemblyPorts, polowatLandings as assemblyWires, terminalGroups } from './polowatHardware';
import type { Conductor, ConductorKind, DeviceKind, Device, Connection, SystemGraph, Vec3 } from './systemGraph';

const inside = new Set<string>(assemblyParts.map(p=>p.id));
const kind = (k:PolowatConductorKind):ConductorKind => k==='data'?'data':k==='negative'?'negative':k==='usb'||k==='regulated'?'multicore':'positive';
const deviceKinds:Record<string,DeviceKind>={controller:'converter',bus:'busbar',distribution:'connector',enclosure:'junction',monitor:'monitor',shunt:'monitor',fuse:'protection'};
const devices:Device[]=polowatTopology.devices.map(d=>({
 id:d.id,label:d.label,subtitle:d.subtitle,kind:deviceKinds[d.kind]??d.kind as DeviceKind,
 appearance:d.kind==='monitor'?'round-display':d.kind==='shunt'?'current-shunt':d.kind==='bus'?'terminal-pair':d.kind==='fuse'?'inline-fuse':undefined,

 layoutGroup:d.kind==='bus'?{id:'distribution-rail',label:'Four isolated bridged pairs',columns:4,order:0,contiguous:true}:undefined,
 centeredTerminals:d.kind==='bus'||d.kind==='breaker'||d.kind==='fuse',
 size:d.kind==='bus'?[.04,.06,.06]:d.kind==='breaker'?[d.size[0]>.03?.04:.02,d.size[1],d.size[2]]:d.size.map(n=>Math.ceil(n/.02-1e-8)*.02) as unknown as Vec3,physicalSize:d.kind==='enclosure'?undefined:d.size,poles:d.kind==='breaker'?(d.size[0]>.03?2:1):undefined,status:'planned',
 placement:inside.has(d.id)?{space:'junction',junctionId:'equipmentEnclosure',section:d.kind==='breaker'||d.kind==='bus'?'din':'backplate',order:d.kind==='bus'?100+terminalGroups.findIndex(g=>g.part===d.id):assemblyParts.findIndex(p=>p.id===d.id)}:{space:'world',surface:d.kind==='battery'?'floor':'wall',position:d.id==='equipmentEnclosure'?[.3,1.2,.13]:d.kind==='panel'?[d.position[0],3.1,.12]:d.position,rotation:[0,0,0]},
 conductors:[],bomIds:d.bomId?[d.bomId]:[],
}));
const deviceById=new Map(devices.map(d=>[d.id,d]));

const routes:Connection[]=polowatTopology.connections.map(c=>{
 const wire=assemblyWires.find(w=>w.id===c.id);
 const endpoints=([c.from,c.to] as const).map((id,side)=>{
  const device=deviceById.get(id)!;
  const landing=wire?[wire.from,wire.to].map(key=>assemblyPorts.find(p=>p.id===key)!).find(p=>p?.owner===id):undefined;
  const portKind:ConductorKind=c.kind==='series'&&side===1?'negative':kind(c.kind);
  const source=device.kind==='panel'||device.kind==='battery';
  const portId=c.kind==='usb'&&id==='devices'?('input-'+(c.id==='usb-a-device-lead'?'usb-a':'usb-c')):c.id==='usb-a-device-lead'?'usb-a-output':landing?landing.id.replace(id+'-',''):source?portKind:device.kind==='breaker'?(side===1?'top-0':'bottom-0'):(side===1?'input':'output');
  const label=c.id==='usb-a-device-lead'?'USB-A':landing?.label??(source?(portKind==='negative'?'−':'+'):side===1?'Input':'Output');
  const port:Conductor={id:portId,label,kind:portKind,face:c.id==='usb-a-device-lead'&&id==='usbCharger'?'right':landing?landing.face:device.kind==='battery'?'top':'bottom',gauge:c.gauge,terminal:landing?.label.includes('M10')?'stud':c.kind==='data'?'RJ12':c.kind==='usb'?(c.id==='usb-a-device-lead'?'USB-A':'USB-C'):undefined,terminalSize:landing?.label.includes('M10')?'M10':undefined,order:source?(portKind==='positive'?0:1):device.conductors.length};
  device.conductors=[...device.conductors,port];
  const key=`${id}.${portId}`;

  return key;
 });
 return {id:c.id,label:c.label,from:endpoints[0],to:endpoints[1],kind:kind(c.kind),cableId:c.id,seriesLink:c.kind==='series'?true:undefined};
});
for (const device of devices) {
 for (const landing of assemblyPorts.filter(p=>p.owner===device.id)) {
  const id=landing.id.replace(device.id+'-','');
  if(device.conductors.some(p=>p.id===id))continue;
  const peer=device.conductors[0];
  device.conductors=[...device.conductors,{id,label:landing.label,kind:peer?.kind??'positive',face:landing.face,optional:true,order:device.conductors.length}];
 }
}
// Only clamps within the same electrical rail group are joined internally.
for(const group of terminalGroups){
 const device=deviceById.get(group.part)!;
 const peers=device.conductors.filter(port=>port.id.startsWith(group.id+'-')).map(port=>port.id);
 device.conductors=device.conductors.map(port=>peers.includes(port.id)?{...port,internalMates:peers.filter(id=>id!==port.id)}:port);
}
const baseGraph:SystemGraph={orthogonalRoutes:true,id:polowatTopology.id,label:'Inowon Polowat',revision:polowatTopology.revision+'-compact-1',
 site:{walls:[{id:'equipment-wall',center:[0,1.8,-.04],size:[5,3.6,.04],normal:[0,0,1]}],note:'Provisional equipment wall; final mounting and enclosure selection require hand assembly.'},
 devices,cables:polowatTopology.connections.map(c=>({id:c.id,label:c.label,cores:c.kind==='data'?6:c.kind==='usb'||c.kind==='regulated'?2:1,outsideDiameterMm:assemblyWires.find(w=>w.id===c.id)?.diameter??5,conductorSize:c.gauge,sheath:'single'})),connections:routes,
 junctions:devices.filter(d=>d.kind==='junction').map(d=>({id:d.id,deviceId:d.id,label:d.label,minimumSize:[.5,.24,.24] as Vec3,padding:.02,dinGap:0,backplateGap:0,glandSpacing:.04,sizePolicy:'auto',backplateColumns:3,dinPosition:'bottom',contiguousDin:true,centeredGlands:true})),currentSources:[]};

export function buildPolowatGraph(layout:PolowatLayout, reversedBreakers:readonly string[]=[]):SystemGraph {
 for(const id of reversedBreakers)if(!(reversiblePolowatBreakers as readonly string[]).includes(id))throw Error(`Breaker cannot reverse: ${id}`);
 const endpoint=(key:string)=>{const [id,port]=key.split(".");return reversedBreakers.includes(id)?`${id}.${port.replace(/^(top|bottom)-/,side=>side==="top-"?"bottom-":"top-")}`:key;};
 return {...baseGraph,connections:baseGraph.connections.map(c=>({...c,from:endpoint(c.from),to:endpoint(c.to)})),devices:baseGraph.devices.map(device=>{
  if(device.placement.space!=="junction")return device;
  const ids=device.placement.section==='din'?layout.dinOrder:layout.backplateOrder;
  const order=ids.indexOf(device.id);
  if(order<0)throw Error(`Missing layout order for ${device.id}`);
  return {...device,placement:{...device.placement,order}};
 }),junctions:baseGraph.junctions.map(j=>({...j,dinPosition:layout.dinPosition,backplateColumns:layout.columns,minimumSize:[layout.minimumWidth,j.minimumSize[1],j.minimumSize[2]]}))};
}
export const polowatGraph=buildPolowatGraph(selectedPolowatLayout,selectedPolowatBreakerRouting);
