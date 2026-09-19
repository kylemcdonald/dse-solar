import * as THREE from 'three';
import {polowatCableRoutes,cableCurve} from './polowatCableRoutes';
import { polowatAssemblyOrigin } from './polowatEnclosure';
import { assemblyParts, assemblyPorts, assemblyWires, terminalGroups, type Point } from './polowatAssembly';

const colors: Record<string,string>={positive:'#c7493f',negative:'#26343f',pv:'#e08735',regulated:'#326fac',usb:'#6d5aac',data:'#8b68ac'};
const xyz=(p:Point)=>new THREE.Vector3(p[0]-162.5,212-p[1],p[2]);

/** Hardware is authored in mm, then placed in the whole system's metre coordinates. */
export function createPolowatAssembly() {
  const scene=new THREE.Group();
  const picks:THREE.Object3D[]=[];
  const owners=new Map(assemblyParts.map(p=>{const g=new THREE.Group();g.userData.deviceId=p.id;scene.add(g);return [p.id,g] as const;}));
  let owner:THREE.Object3D=scene;
  const box=(size:Point,pos:Point,color:string,info:string,opacity=1,parent:THREE.Object3D=owner)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.65,transparent:opacity<1,opacity}));mesh.position.copy(xyz(pos));mesh.userData.info=info;parent.add(mesh);picks.push(mesh);return mesh;};
  const screw=(point:Point,info:string)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(2.5,2.5,2,16),new THREE.MeshStandardMaterial({color:'#aebfc6',metalness:.8,roughness:.3}));m.rotation.x=Math.PI/2;m.position.copy(xyz(point));m.userData.info=info;owner.add(m);picks.push(m);const slot=box([3.8,.7,.4],[point[0],point[1],point[2]+1.2],'#37434a',info);return [m,slot];};
  const backingWidth=Math.max(325,...assemblyParts.map(p=>p.x+p.width))+10;
  box([backingWidth,424,3],[backingWidth/2,212,-4],'#b6c0c0','Illustrative mounting workspace including both battery isolators; received backing dimensions remain unverified.');
  for(const p of assemblyParts){
   if(p.kind==='terminals')continue;
   owner=owners.get(p.id)!;
   box([p.width,p.height,p.kind==='shunt'?8:p.depth],[p.x+p.width/2,p.y+p.height/2,p.kind==='shunt'?4:p.depth/2],p.kind==='controller'?'#2479ad':p.kind==='breaker'?'#e7e9e5':'#2c3e4b',`${p.label} — ${p.width} × ${p.height} × ${p.depth} mm. ${p.basis}`);
   if(p.kind==='shunt'){
    box([p.width-12,20,8],[p.x+p.width/2,p.y+15,23],'#b99561','500 A / 50 mV calibrated shunt element; not a circuit breaker.');
    for(const x of [p.x+10,p.x+p.width-10]){
     const stud=new THREE.Mesh(new THREE.CylinderGeometry(5,5,16,12),new THREE.MeshStandardMaterial({color:'#b9bfc3',metalness:.8,roughness:.3}));stud.rotation.x=Math.PI/2;stud.position.copy(xyz([x,p.y+15,35]));stud.userData.info=x<p.x+p.width/2?'BATTERY MINUS · M10 · combined battery return':'LOAD AND CHARGER · M10 · MPPT BATT−';owner.add(stud);picks.push(stud);
    }
    box([38,20,3],[p.x+87,p.y+37,22],'#36654f','Shunt PCB with +B1 fused supply and RJ12 display socket.');
   }
   if(p.kind==='monitor'){
    const bezel=new THREE.Mesh(new THREE.CylinderGeometry(31.5,31.5,3,48),new THREE.MeshStandardMaterial({color:'#b8bdbd',roughness:.5}));bezel.rotation.x=Math.PI/2;bezel.position.copy(xyz([p.x+p.width/2,p.y+p.height/2,p.depth+1.5]));bezel.userData.info='BMV-700 round 63 mm face within the optional 69 mm square bezel.';owner.add(bezel);picks.push(bezel);
    box([43,24,2],[p.x+p.width/2,p.y+30,p.depth+4],'#a8bca3','BMV LCD · state of charge, voltage, current and time-to-go. Screen is illustrative, not live telemetry.');
    // Physical LCD segments, with no invented battery reading or floating labels.
    for(const x of [p.x+22,p.x+34,p.x+46])box([7,1.5,1],[x,p.y+30,p.depth+5.5],'#405246','Unconfigured display; synchronize after installation.');
    for(let i=0;i<4;i++)box([7,4,2],[p.x+19+i*10,p.y+51,p.depth+4],'#40494d','BMV setup / select / navigation button.');
   }
   if(p.kind==='fuse')box([p.width-8,6,3],[p.x+p.width/2,p.y+p.height/2,p.depth+1.5],'#202a30','Supplied inline 1 A slow-blow fuse holder; retain factory protection.');
   if(p.kind==='controller')for(let i=0;i<9;i++)box([6,70,4],[p.x+10+i*13,p.y+38,p.depth+2],'#256e9d','Illustrative heatsink ribs; mounting dimensions from Victron.');
   if(p.kind==='breaker'){
    box([p.width-8,18,8],[p.x+p.width/2,p.y+30,p.depth+4],'#303a41','Breaker handle and front service access. Final pole wiring subject to exact device diagram.');
    box([p.width+6,35,1],[p.x+p.width/2,p.y+p.height/2,1],'#9caeb6','35 mm DIN rail; retain end stops.');
   }
  }
  owner=scene;
  // One rail, eight installed blocks; two kit spares are not mounted. No gap in the plastic housings; no electrical bridge crosses a group boundary.
  box([127.8,35,7.5],[68.9,366.6,3.75],'#94a6af','Supplied 7-inch DIN rail cut to the eight-block assembly; confirm stop/end-cover clearance before cutting.');
  for(let i=0;i<8;i++){
   const g=terminalGroups.find(g=>25+i*10>=g.x&&25+i*10<g.x+20);const color=g?.color??(i===8?'#cc493f':'#303940');
   owner=g?owners.get(g.part)!:scene;
   box([10,43.2,49.3],[30+i*10,366.6,24.65],color,`DK10N block ${i+1}: ${g?.label??'unbridged spare'}. One conductor per cage. 12–14 mm strip, 1.3 Nm. 6–20 AWG stranded.`);
   for(const y of [350,383])screw([30+i*10,y,50],`Block ${i+1} screw · ${g?.label??'spare'} · 1.3 Nm; verify received markings.`);
  }
  owner=scene;
  for(const g of terminalGroups) box([17,4,5],[g.x+10,366.6,51],'#e48339',`${g.label}: one DSS10N-02P jumper, joining only these two blocks.`,1,owners.get(g.part)!);
  box([2,43.2,49.3],[106,366.6,24.65],'#747e87','Single supplied end cover closes the exposed last terminal block.');
  for(const x of [18,115])box([12,48,32],[x,366.6,16],'#d4d1bd','SS2 mechanical end stop; does not electrically connect any block.');
  for(const p of assemblyPorts){
   owner=owners.get(p.owner)??scene;
   if(p.owner==='entry'){
    const isUsb=p.id.startsWith('usb');
    const neckRadius=p.id==='usb-c'?9:10;
    const gland=new THREE.Mesh(new THREE.CylinderGeometry(neckRadius,neckRadius,18,isUsb?24:6),new THREE.MeshStandardMaterial({color:isUsb?'#344f60':'#727f82'}));gland.position.copy(xyz(p.point));gland.userData.info=`${p.label}: provisional bottom-wall location. ${p.id==='usb-c'?'18.5 mm cutout per listing.':'Confirm received gland/socket dimensions.'}`;scene.add(gland);picks.push(gland);
    const collar=new THREE.Mesh(new THREE.TorusGeometry(isUsb?12:10,1.5,5,20),new THREE.MeshStandardMaterial({color:'#a7b0ac'}));collar.rotation.x=Math.PI/2;collar.position.copy(xyz([p.point[0],p.point[1]+7,p.point[2]]));scene.add(collar);
   } else {
    const m=new THREE.Mesh(new THREE.SphereGeometry(2.2,10,8),new THREE.MeshStandardMaterial({color:'#d9b95b'}));m.position.copy(xyz(p.point));m.userData.info=`${p.id}: ${p.label}. Position is a planning landing, not a drill coordinate.`;owner.add(m);picks.push(m);
   }
  }
  const wireGroup=new THREE.Group();scene.add(wireGroup);
  for(const w of assemblyWires){
   const route=polowatCableRoutes.routes.find(r=>r.id===w.id)!;
   const local=route.inside.map(p=>[(p[0]-polowatAssemblyOrigin[0])*1000,(p[1]-polowatAssemblyOrigin[1])*1000,(p[2]-polowatAssemblyOrigin[2])*1000]);
   const curve=cableCurve(local);
   const m=new THREE.Mesh(new THREE.TubeGeometry(curve,32,w.diameter/2,8,false),new THREE.MeshStandardMaterial({color:colors[w.kind]??'#826744'}));m.userData.connectionId=w.id;m.userData.info=`${w.label} · ${w.gauge} · ${w.from} → ${w.to}. OD ${w.diameter} mm (${w.gauge.startsWith('10')?'assumed':'planning'}). Full modeled route ${route.modelLengthM.toFixed(2)} m; allowance cut ${route.cutLengthM.toFixed(2)} m. Final bends/terminations require physical verification. Bend target ≥${w.minimumBendRadiusMm.toFixed(0)} mm, not yet certified.`;wireGroup.add(m);picks.push(m);
  }
  // USB-A is a separate physical cable although the system graph groups both factory USB leads.
  const usbA=assemblyPorts.find(p=>p.id==='usb-a')!;const usbOut=assemblyPorts.find(p=>p.id==='usbChargerout')!;
  const extra=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([xyz(usbOut.point),xyz([310,400,90]),xyz(usbA.point)]),40,2.5,8,false),new THREE.MeshStandardMaterial({color:'#568baf'}));extra.userData.info='BATIGE USB-A male → capped external female, 0.3 m; verify plug/strain-relief clearance.';wireGroup.add(extra);picks.push(extra);
  scene.scale.setScalar(.001);
  scene.position.set(...polowatAssemblyOrigin);
  scene.traverse(object=>{
    let parent:THREE.Object3D|null=object;
    while(parent && !parent.userData.deviceId) parent=parent.parent;
    if(parent) object.userData.deviceId=parent.userData.deviceId;
    if(object instanceof THREE.Mesh) { object.castShadow=true;object.receiveShadow=true; }
  });
  return {group:scene,interactive:picks,devices:owners};
}
