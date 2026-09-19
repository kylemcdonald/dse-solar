import * as THREE from 'three';
import {assemblyPorts} from './polowatAssembly';
import {polowatAssemblyOrigin,polowatEnclosure} from './polowatEnclosure';
import type {PolowatDevice} from './polowatTopology';

/** Open-front planning shell with actual openings at the modeled entry centers. */
export function createPolowatShell(device:PolowatDevice){
 const group=new THREE.Group();const [width,height,depth]=device.size;const wall=.003;
 const material=new THREE.MeshStandardMaterial({color:'#aaa596',roughness:.78});
 const box=(size:[number,number,number],position:[number,number,number])=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size,6,6,1),material);mesh.position.set(...position);group.add(mesh);return mesh;};
 box([width,height,wall],[0,0,-depth/2+wall/2]);
 box([width,wall,depth],[0,(height-wall)/2,0]);
 box([wall,height-2*wall,depth],[-(width-wall)/2,0,0]);
 box([wall,height-2*wall,depth],[(width-wall)/2,0,0]);
 const shape=new THREE.Shape();shape.moveTo(-width/2,-depth/2);shape.lineTo(width/2,-depth/2);shape.lineTo(width/2,depth/2);shape.lineTo(-width/2,depth/2);shape.closePath();
 const openings=assemblyPorts.filter(port=>port.owner==='entry').map(port=>{
  const x=polowatAssemblyOrigin[0]+(port.point[0]-polowatEnclosure.bench.width/2)/1000-device.position[0];
  const z=polowatAssemblyOrigin[2]+port.point[2]/1000-device.position[2];
  const radius=port.id==='usb-c'?.00925:.0106;
  const hole=new THREE.Path();hole.absarc(x,z,radius,0,Math.PI*2,true);shape.holes.push(hole);
  return {id:port.id,x,z,radius};
 });
 const bottom=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:wall,bevelEnabled:false,curveSegments:20}),material);
 bottom.rotation.x=Math.PI/2;bottom.position.y=-height/2+wall;bottom.userData.entryOpenings=openings;group.add(bottom);
 return group;
}
