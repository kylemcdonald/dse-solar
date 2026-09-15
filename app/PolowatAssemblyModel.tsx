'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { SVGRenderer, SVGObject } from 'three/examples/jsm/renderers/SVGRenderer.js';
import { GrabPointCameraControls } from './GrabPointCameraControls';
import { assemblyParts, assemblyPorts, assemblyWires, assemblyIssues, terminalGroups, type Point } from './polowatAssembly';
import { polowatEnclosure } from './polowatEnclosure';

const colors: Record<string,string>={positive:'#c7493f',negative:'#26343f',pv:'#e08735',regulated:'#326fac',usb:'#6d5aac'};
const xyz=(p:Point)=>new THREE.Vector3(p[0]-162.5,212-p[1],p[2]);
function label(text:string,width=75) {
 const c=document.createElement('canvas');c.width=768;c.height=96;const ctx=c.getContext('2d')!;ctx.fillStyle='#f4f0e7';ctx.fillRect(0,0,768,96);ctx.fillStyle='#172b33';ctx.font='bold 44px sans-serif';ctx.textAlign='center';ctx.fillText(text,384,64);
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false}));sprite.scale.set(width,width/8,1);return sprite;
}
export function PolowatAssemblyModel(){
 const host=useRef<HTMLDivElement>(null);const api=useRef<{pose:(type:string)=>void; wires:(v:boolean)=>void; shell:(v:boolean)=>void; image:()=>void}|null>(null);
 const [selected,setSelected]=useState('Select a part, terminal or wire to inspect it.');const [wires,setWires]=useState(true);const [shell,setShell]=useState(false);
 useEffect(()=>{
  if(!host.current)return;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#e9e3d7');
  const camera=new THREE.PerspectiveCamera(38,1,1,4000);
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('webgl2',{antialias:true,preserveDrawingBuffer:true});
  const gpu=context?new THREE.WebGLRenderer({canvas,context,antialias:true,preserveDrawingBuffer:true}):null;
  const software=gpu?null:new SVGRenderer();
  const renderer=gpu??software!;
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  const surface=gpu?gpu.domElement:canvas;
  host.current.style.position='relative';
  if(software){surface.style.cssText='position:absolute;inset:0;width:100%;height:100%;touch-action:none';host.current.replaceChildren(software.domElement,surface);}else host.current.replaceChildren(surface);
  const makeLabel=(text:string,width=75):THREE.Object3D=>{
   if(!software)return label(text,width);
   const textNode=document.createElementNS('http://www.w3.org/2000/svg','text');textNode.textContent=text;textNode.setAttribute('font-size','10');textNode.setAttribute('font-family','sans-serif');textNode.setAttribute('font-weight','600');textNode.setAttribute('text-anchor','middle');textNode.setAttribute('fill','#182c36');textNode.setAttribute('paint-order','stroke');textNode.setAttribute('stroke','#eef0e9');textNode.setAttribute('stroke-width','3');return new SVGObject(textNode);
  };
  scene.add(new THREE.HemisphereLight('#ffffff','#64727a',2.6));const light=new THREE.DirectionalLight('#ffffff',software?0.9:3);light.position.set(-250,600,900);scene.add(light);
  const picks:THREE.Object3D[]=[];
  const box=(size:Point,pos:Point,color:string,info:string,opacity=1,parent:THREE.Object3D=scene)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.65,transparent:opacity<1,opacity}));mesh.position.copy(xyz(pos));mesh.userData.info=info;parent.add(mesh);picks.push(mesh);return mesh;};
  const screw=(point:Point,info:string)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(2.5,2.5,2,16),new THREE.MeshStandardMaterial({color:'#aebfc6',metalness:.8,roughness:.3}));m.rotation.x=Math.PI/2;m.position.copy(xyz(point));m.userData.info=info;scene.add(m);picks.push(m);const slot=box([3.8,.7,.4],[point[0],point[1],point[2]+1.2],'#37434a',info);return [m,slot];};
  box([325,424,3],[162.5,212,-4],'#b6c0c0','325 × 424 mm dimensioned assembly workspace; not a selected enclosure or full-size mounting plate.');
  box([141,110,2],[70.5,160,0],'#c7cfd0','Nonflammable aluminum mounting patch under MPPT; cut from staged sheet.');
  const cooling=new THREE.Box3Helper(new THREE.Box3(xyz([5,310,0]),xyz([136,10,85])),'#46a284');scene.add(cooling);
  const coolText=makeLabel('100 mm cooling above / below',120);coolText.position.copy(xyz([75,42,8]));scene.add(coolText);
  for(const p of assemblyParts){
   if(p.kind==='terminals')continue;
   box([p.width,p.height,p.depth],[p.x+p.width/2,p.y+p.height/2,p.depth/2],p.kind==='controller'?'#2479ad':p.kind==='breaker'?'#e7e9e5':'#2c3e4b',`${p.label} — ${p.width} × ${p.height} × ${p.depth} mm. ${p.basis}`);
   const l=makeLabel(p.label,Math.min(p.width,100));l.position.copy(xyz([p.x+p.width/2,p.y+p.height/2,p.depth+3]));scene.add(l);
   if(p.kind==='controller')for(let i=0;i<9;i++)box([6,70,4],[p.x+10+i*13,p.y+38,p.depth+2],'#256e9d','Illustrative heatsink ribs; mounting dimensions from Victron.');
   if(p.kind==='breaker'){
    box([p.width-8,18,8],[p.x+p.width/2,p.y+30,p.depth+4],'#303a41','Breaker handle and front service access. Final pole wiring subject to exact device diagram.');
    box([p.width+6,35,1],[p.x+p.width/2,p.y+p.height/2,1],'#9caeb6','35 mm DIN rail; retain end stops.');
   }
  }
  // One rail, ten blocks. No gap in the plastic housings; no electrical bridge crosses a group boundary.
  box([177.8,35,7.5],[93.9,366.6,3.75],'#94a6af','Supplied 7-inch DIN rail. Cut only after confirming stop/end-cover clearance.');
  for(let i=0;i<10;i++){
   const g=terminalGroups.find(g=>25+i*10>=g.x&&25+i*10<g.x+20);const color=g?.color??(i===8?'#cc493f':'#303940');
   box([10,43.2,49.3],[30+i*10,366.6,24.65],color,`DK10N block ${i+1}: ${g?.label??'unbridged spare'}. One conductor per cage. 12–14 mm strip, 1.3 Nm. 6–20 AWG stranded.`);
   for(const y of [350,383])screw([30+i*10,y,50],`Block ${i+1} screw · ${g?.label??'spare'} · 1.3 Nm; verify received markings.`);
  }
  for(const g of terminalGroups){box([17,4,5],[g.x+10,366.6,51],'#e48339',`${g.label}: one DSS10N-02P jumper, joining only these two blocks.`);const l=makeLabel(g.label.replace('BATT','B').replace('LOAD','L'),24);l.position.copy(xyz([g.x+10,333,62]));scene.add(l);}
  box([2,43.2,49.3],[126,366.6,24.65],'#747e87','Single supplied end cover closes the exposed last terminal block.');
  for(const x of [18,135])box([12,48,32],[x,366.6,16],'#d4d1bd','SS2 mechanical end stop; does not electrically connect any block.');
  for(const p of assemblyPorts){
   if(p.owner==='entry'){
    const isUsb=p.id.startsWith('usb');
    const gland=new THREE.Mesh(new THREE.CylinderGeometry(isUsb?12:10,isUsb?12:10,18,isUsb?24:6),new THREE.MeshStandardMaterial({color:isUsb?'#344f60':'#727f82'}));gland.position.copy(xyz(p.point));gland.userData.info=`${p.label}: provisional bottom-wall location. ${p.id==='usb-c'?'18.5 mm cutout per listing.':'Confirm received gland/socket dimensions.'}`;scene.add(gland);picks.push(gland);
    const collar=new THREE.Mesh(new THREE.TorusGeometry(isUsb?12:10,1.5,5,20),new THREE.MeshStandardMaterial({color:'#a7b0ac'}));collar.rotation.x=Math.PI/2;collar.position.copy(xyz([p.point[0],p.point[1]-7,p.point[2]]));scene.add(collar);
    const l=makeLabel(p.id.replace('pv-in','PV').replace('battery-','B').replace('starlink-out','24V').replace('usb-','USB-').toUpperCase(),28);l.position.copy(xyz([p.point[0],440,65]));scene.add(l);
   } else {
    const m=new THREE.Mesh(new THREE.SphereGeometry(2.2,10,8),new THREE.MeshStandardMaterial({color:'#d9b95b'}));m.position.copy(xyz(p.point));m.userData.info=`${p.id}: ${p.label}. Position is a planning landing, not a drill coordinate.`;scene.add(m);picks.push(m);
   }
  }
  const wireGroup=new THREE.Group();scene.add(wireGroup);
  for(const w of assemblyWires){
   const curve=new THREE.CatmullRomCurve3(w.points.map(xyz),false,'centripetal');
   const m=new THREE.Mesh(new THREE.TubeGeometry(curve,80,w.diameter/2,8,false),new THREE.MeshStandardMaterial({color:colors[w.kind]??'#826744'}));m.userData.info=`${w.label} · ${w.gauge} · ${w.from} → ${w.to}. OD ${w.diameter} mm (${w.gauge.startsWith('10')?'assumed':'planning'}). Service-envelope polyline ${w.lengthM.toFixed(2)} m; not a cut length. Bend target ≥${w.minimumBendRadiusMm.toFixed(0)} mm, not yet certified.`;wireGroup.add(m);picks.push(m);
  }
  // USB-A is a separate physical cable although the system graph groups both factory USB leads.
  const usbA=assemblyPorts.find(p=>p.id==='usb-a')!;const usbOut=assemblyPorts.find(p=>p.id==='usbChargerout')!;
  const extra=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([xyz(usbOut.point),xyz([310,400,90]),xyz(usbA.point)]),40,2.5,8,false),new THREE.MeshStandardMaterial({color:'#568baf'}));extra.userData.info='BATIGE USB-A male → capped external female, 0.3 m; verify plug/strain-relief clearance.';wireGroup.add(extra);picks.push(extra);
  const shellGroup=new THREE.Group();shellGroup.visible=false;scene.add(shellGroup);
  const {width:sw,height:sh,depth:sd}=polowatEnclosure.outer;
  const shellBox=new THREE.Box3Helper(new THREE.Box3(xyz([0,sh,0]),xyz([sw,0,sd])),'#ca4b45');shellGroup.add(shellBox);
  const shellLabel=makeLabel('Reference OUTSIDE limits — not fitted',180);shellLabel.position.copy(xyz([sw/2,-15,sd]));shellGroup.add(shellLabel);
  const widthLabel=makeLabel('325 mm workspace',150);widthLabel.position.copy(xyz([162,480,0]));scene.add(widthLabel);
  const render=()=>renderer.render(scene,camera);const ray=new THREE.Raycaster();const mouse=new THREE.Vector2();
  const hits=(x:number,y:number)=>{const r=surface.getBoundingClientRect();mouse.set((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera);return ray.intersectObjects(picks).filter(h=>h.object.parent!==wireGroup||wireGroup.visible);};
  const controls=new GrabPointCameraControls({camera,domElement:surface,onChange:render,pickSurface:(x,y)=>{const h=hits(x,y)[0];return h?{point:h.point}:null;}});
  const pose=(type:string)=>{const pos:Point=type==='front'?[0,0,860]:type==='rail'?[0,-130,360]:type==='side'?[750,100,220]:[470,300,800];const target:Point=type==='rail'?[-60,-150,35]:[0,0,40];controls.setPose(new THREE.Vector3(...pos),new THREE.Vector3(...target));render();};pose('overview');
  let down=[0,0];const onDown=(e:PointerEvent)=>{down=[e.clientX,e.clientY];};const onUp=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const h=hits(e.clientX,e.clientY)[0];if(h)setSelected(h.object.userData.info??'Assembly workspace');};surface.addEventListener('pointerdown',onDown);surface.addEventListener('pointerup',onUp);
  api.current={pose,wires:v=>{wireGroup.visible=v;render();},shell:v=>{shellGroup.visible=v;render();},image:()=>{render();const a=document.createElement('a');a.download=software?'polowat-assembly-review.svg':'polowat-assembly-review.png';a.href=software?URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(software.domElement)],{type:'image/svg+xml'})):gpu!.domElement.toDataURL('image/png');a.click();if(software)setTimeout(()=>URL.revokeObjectURL(a.href),1000);}};
  const resize=()=>{const w=host.current!.clientWidth,h=host.current!.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render();};const observer=new ResizeObserver(resize);observer.observe(host.current);resize();surface.dataset.model='polowat-terminal-assembly';surface.dataset.renderer=software?'software':'webgl';
  return()=>{observer.disconnect();controls.dispose();surface.removeEventListener('pointerdown',onDown);surface.removeEventListener('pointerup',onUp);scene.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)m.geometry.dispose();if(m.material)for(const mat of Array.isArray(m.material)?m.material:[m.material]){(mat as THREE.MeshStandardMaterial).map?.dispose();mat.dispose();}});gpu?.dispose();renderer.domElement.remove();surface.remove();api.current=null;};
 },[]);
 return <section className="polowat-assembly">
  <div className="model-toolbar"><strong>Terminal-level assembly review</strong>{[['overview','Oblique'],['front','Front'],['rail','DIN terminals'],['side','Depth']].map(([id,title])=><button key={id} onClick={()=>api.current?.pose(id)}>{title}</button>)}<label><input type="checkbox" checked={wires} onChange={e=>{setWires(e.target.checked);api.current?.wires(e.target.checked);}}/> Wiring</label><label><input type="checkbox" checked={shell} onChange={e=>{setShell(e.target.checked);api.current?.shell(e.target.checked);}}/> Reference box limits</label><button onClick={()=>api.current?.image()}>Save image</button></div>
  <p>Dimensioned assembly study · enclosure order deferred. Gold dots are individual landings; orange pieces are the four jumpers. Cable loops illustrate service/depth demand, not a fabrication route. Click a part or wire for details.</p>
  <div ref={host} style={{height:'min(72vh,780px)',minHeight:480,width:'100%',borderRadius:12,overflow:'hidden'}}/><p role="status" style={{padding:12,background:'#e3eadf'}}>{selected}</p>
  <h3>Integration findings</h3><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:12}}>{assemblyIssues.map(issue=><article key={issue.id} style={{padding:16,border:'1px solid #c3ccbf',borderRadius:8}}><small>{issue.status}</small><h4>{issue.title}</h4><p>{issue.detail}</p></article>)}</div>
  <h3>Jumper and terminal schedule</h3><table><thead><tr><th>Isolated group</th><th>Block 1 · opposing clamps</th><th>Block 2 · opposing clamps</th><th>Bridge</th></tr></thead><tbody>{terminalGroups.map(g=><tr key={g.id}><th>{g.label}</th><td>{g.wires[0]} / {g.wires[1]}</td><td>{g.wires[2]} / {g.wires[3]}</td><td>1 × DSS10N-02P</td></tr>)}</tbody></table>
  <details><summary>Point-to-point wiring schedule · {assemblyWires.length} assembly paths</summary><table><thead><tr><th>Circuit</th><th>From → to</th><th>Wire</th></tr></thead><tbody>{assemblyWires.map(w=><tr key={w.id}><td>{w.label}</td><td>{w.from} → {w.to}</td><td>{w.gauge}</td></tr>)}</tbody></table><p>External panel series links and battery-adjacent breakers remain in the whole-system view. USB-A and USB-C are physically separate extensions.</p></details>
 </section>;
}
