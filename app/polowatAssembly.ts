import { polowatTopology } from './polowatTopology';
import { polowatEnclosure } from './polowatEnclosure';

export type Point = readonly [number, number, number];
export type AssemblyPart = { id: string; label: string; x: number; y: number; width: number; height: number; depth: number; kind: string; basis: string };
export const assemblyParts: AssemblyPart[] = polowatEnclosure.parts.map(p => ({ ...p,
  kind: p.id === 'mppt' ? 'controller' : p.id.includes('Breaker') ? 'breaker' : ['positiveBus','negativeBus','loadSplit'].includes(p.id) ? 'terminals' : 'converter',
  basis: p.id === 'mppt' ? 'Victron published 131 × 100 × 60 mm body; 100 mm clearance above/below.' : p.id === 'usbCharger' ? 'Coolgear published body 88.4 × 50.5 × 26.2 mm; plug/service space is additional.' : ['positiveBus','negativeBus','loadSplit'].includes(p.id) ? 'DK10N: 10 mm pitch, 43.2 mm body length, 49.3 mm rail-mounted height. End stops/rail shown separately.' : 'Conservative installation envelope, not a measured received body. Confirm before drilling.'
}));
export const terminalGroups = [
  { id:'main-positive', part:'positiveBus', label:'BATT +', color:'#cc493f', x:25, y:345, blockCount:2, bridge:true, wires:['Battery A +','Battery B +','MPPT breaker feed','Spare'] },
  { id:'main-negative', part:'negativeBus', label:'BATT −', color:'#303940', x:45, y:345, blockCount:2, bridge:true, wires:['Battery A −','Battery B −','MPPT BATT−','Spare'] },
  { id:'load-positive', part:'loadSplit', label:'LOAD +', color:'#cc493f', x:65, y:345, blockCount:2, bridge:true, wires:['MPPT LOAD+','Starlink breaker','USB breaker','Spare'] },
  { id:'load-negative', part:'loadSplit', label:'LOAD −', color:'#303940', x:85, y:345, blockCount:2, bridge:true, wires:['MPPT LOAD−','Starlink return','USB return','Spare'] },
];
export type AssemblyPort = { id:string; owner:string; label:string; point:Point; direction:Point; };
const ports: AssemblyPort[] = [];
const port=(id:string, owner:string,label:string,point:Point,direction:Point=[0,1,0]) => { ports.push({id,owner,label,point,direction});return id; };
for(const g of terminalGroups) for(let i=0;i<4;i++) port(`${g.id}-${i}`,g.part,`${g.label} · ${g.wires[i]}`,[g.x+5+10*Math.floor(i/2),g.y+(i%2===0?0:43.2),42],[0,i%2===0?-1:1,0]);
const mppt=assemblyParts.find(p=>p.id==='mppt')!;
['pv+','pv-','batt+','batt-','load+','load-'].forEach((name,i)=>port('mppt-'+name,'mppt',name.toUpperCase(),[mppt.x+18+i*19,mppt.y+mppt.height,17]));
for(const part of assemblyParts.filter(p=>p.kind==='breaker')) {
 const poles=part.id==='pvBreaker'||part.id==='controllerBreaker'?2:1;
 for(let i=0;i<poles;i++) {port(`${part.id}-top-${i}`,part.id,`Source clamp ${i+1}`,[part.x+(i+.5)*part.width/poles,part.y,40],[0,-1,0]);port(`${part.id}-bottom-${i}`,part.id,`Load clamp ${i+1}`,[part.x+(i+.5)*part.width/poles,part.y+part.height,40]);}
}
for(const part of assemblyParts.filter(p=>p.kind==='converter')) {
 port(part.id+'+',part.id,'DC input +',[part.x+10,part.y+part.height,12]);port(part.id+'-',part.id,'DC input −',[part.x+25,part.y+part.height,12]);
 port(part.id+'out',part.id,part.id==='usbCharger'?'USB sockets / male extension plugs':'24 V factory output',[part.x+part.width,part.y+part.height/2,14],[1,0,0]);
}
const entries=[['pv-in+','PV array +'],['pv-in-','PV array −'],['battery-a+','Battery A protected +'],['battery-a-','Battery A −'],['battery-b+','Battery B protected +'],['battery-b-','Battery B −'],['starlink-out','Starlink 24 V exit'],['usb-a','Capped USB-A'],['usb-c','Capped USB-C']];
entries.forEach(([id,label],i)=>port(id,'entry',label,[15+i*36,424,60],[0,-1,0]));
export const assemblyPorts=ports;
const pairs: [string,string,string][]=[
 ['pv-home-positive','pv-in+','pvBreaker-top-0'],['pv-home-negative','pv-in-','pvBreaker-top-1'],
 ['pv-breaker-positive','pvBreaker-bottom-0','mppt-pv+'],['pv-breaker-negative','pvBreaker-bottom-1','mppt-pv-'],
 ['mppt-battery-positive','controllerBreaker-bottom-0','mppt-batt+'],['controller-positive-bus','main-positive-2','controllerBreaker-top-0'],['mppt-battery-negative','mppt-batt-','main-negative-2'],
 ['battery-a-positive-bus','battery-a+','main-positive-0'],['battery-a-negative','battery-a-','main-negative-0'],['battery-b-positive-bus','battery-b+','main-positive-1'],['battery-b-negative','battery-b-','main-negative-1'],
 ['mppt-load-positive','mppt-load+','load-positive-0'],['mppt-load-negative','mppt-load-','load-negative-0'],
 ['load-starlink-positive','load-positive-1','starlinkBreaker-top-0'],['starlink-breaker-converter','starlinkBreaker-bottom-0','starlinkConverter+'],['load-starlink-negative','load-negative-1','starlinkConverter-'],
 ['load-usb-positive','load-positive-2','usbBreaker-top-0'],['usb-breaker-charger','usbBreaker-bottom-0','usbCharger+'],['load-usb-negative','load-negative-2','usbCharger-'],['starlink-regulated','starlinkConverterout','starlink-out'],['usb-device-leads','usbChargerout','usb-c'],
];
const byId=new Map(ports.map(p=>[p.id,p]));
export const assemblyWires=pairs.map(([id,from,to],i)=>{
 const connection=polowatTopology.connections.find(c=>c.id===id)!;
 const a=byId.get(from)!;const b=byId.get(to)!;
 const diameter=connection.gauge.startsWith('8 ')?7.9:connection.gauge.startsWith('10 ')?6.5:connection.gauge.startsWith('12 ')?4:5;
 // Front service loops avoid hiding assumed cable bends inside device bodies. These are review envelopes, not a cut list.
 const lift=100+(i%5)*11;
 const points:Point[]=[a.point,[a.point[0],a.point[1]+a.direction[1]*22,a.point[2]],[a.point[0],a.point[1]+a.direction[1]*35,lift],[b.point[0],b.point[1]+b.direction[1]*35,lift],[b.point[0],b.point[1]+b.direction[1]*22,b.point[2]],b.point];
 const lengthM=points.slice(1).reduce((n,p,j)=>n+Math.hypot(...p.map((v,k)=>v-points[j][k])),0)/1000;
 return {id,from,to,label:connection.label,gauge:connection.gauge,kind:connection.kind,diameter,points,lengthM,minimumBendRadiusMm:diameter*6};
});
export const assemblyIssues=[
 {id:'distribution',status:'Fixed',title:'Four isolated electrical groups',detail:'One DK10N kit replaces both Blue Sea buses and DK4N. Eight blocks, four matching two-position bridges. Main battery +/− and switched LOAD +/− remain separate; no bridge crosses a group boundary.'},
 {id:'rings',status:'Fixed',title:'Six bus-end eyelets eliminated',detail:'Bare stranded 8/10/12 AWG fits the DK10N wire cage. Four battery-post lugs are still required; their hole size depends on the locally purchased batteries.'},
 {id:'end-covers',status:'Fixed',title:'One contiguous rail preserves the supplied end hardware',detail:'All ten blocks are on one rail, with four isolated bridged pairs and two unbridged spares. The supplied single end cover and two stops are sufficient for this arrangement. Do not split it into separate rails without adding end covers/stops.'},
 {id:'box',status:'Unresolved',title:'Reference enclosure fit is not established',detail:'This dimensioned 325 × 424 mm review arrangement exceeds even the reference box’s 246.4 × 350.5 mm outside footprint. It is not a fitted mounting drawing. Keep the box out of the order; measure actual converter bodies and test a compact arrangement before selecting it.'},
 {id:'cooling',status:'Reserved',title:'Controller cooling and mounting',detail:'The model keeps 100 mm above/below the 131 × 100 mm controller clear of other component bodies. Mount on the cuttable aluminum stock. Clearance and a vent do not prove full-load thermal performance.'},
 {id:'wires',status:'Unresolved',title:'Cable routes are service envelopes, not approved cuts',detail:'Terminal endpoints and diameters are explicit. Front loops reveal depth demand and tool access, but exact bend radii, collisions and route lengths require the received components and final layout. Do not use these routes as a fabrication cut list.'},
 {id:'converter',status:'Check on assembly',title:'Converter input terminations',detail:'Coolgear’s plug wire range and XTAR factory input lead details are unpublished. Reserve the two unbridged spare DK10N blocks for a short approved Coolgear pigtail if necessary; factory ring leads cannot be clamped as eyelets in a DIN wire cage.'},
 {id:'dihool',status:'Unresolved',title:'DIHOOL battery protection',detail:'The spare pole is deliberately not bridged in this mockup: final manufacturer-approved pole wiring, conflicting short-circuit specifications and parallel-battery fault coordination remain unresolved. Three DIHOOL breakers remain unstaged.'},
 {id:'ports',status:'Check on assembly',title:'Bottom entries and capped USB sockets',detail:'The review includes four battery entries, two PV entries, Starlink output and two capped USB ports. Gland positions and USB-A cutout/plug clearance are provisional. USB-C listing specifies an 18.5 mm hole; cap closed, sheltered while charging. Keep cable bend space and vent airflow.'},
 {id:'pv',status:'Check on assembly',title:'PV connector compatibility',detail:'Use continuous 10 AWG PV leads. Verify the received panel connector family, matching contact/crimp die and cable seal diameter before using the generic MUYI kit connectors.'},
];
