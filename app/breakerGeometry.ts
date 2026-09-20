import * as THREE from 'three';
import type {Device} from './systemGraph';

/** Pole count describes the switching mechanism, never the casing width. */
export function breakerVisualSpec(device:Pick<Device,'poles'|'dinModules'|'size'>){
 const poles=device.poles??1;
 const modules=device.dinModules??Math.max(1,Math.round(device.size[0]/.02));
 return {poles,modules,style:poles>1?'linked-poles':modules>1?'wide-single-pole':'single-pole'} as const;
}

export function breakerFace(device:Pick<Device,'poles'|'dinModules'|'size'>){
 const group=new THREE.Group();
 const {poles,style}=breakerVisualSpec(device);
 const [width,height,depth]=device.size;
 group.name=`breaker-face:${style}`;
 const casing=new THREE.MeshStandardMaterial({color:'#e8e5db',roughness:.62});
 const dark=new THREE.MeshStandardMaterial({color:'#343638',roughness:.48});
 const mesh=(name:string,size:[number,number,number],position:[number,number,number],material:THREE.Material)=>{
  const part=new THREE.Mesh(new THREE.BoxGeometry(...size),material);
  part.name=name;part.position.set(...position);group.add(part);return part;
 };
 // One unbroken face on a wide single-pole case; separate faces on linked poles.
 for(let pole=0;pole<poles;pole++){
  const x=-width/2+(pole+.5)*width/poles;
  mesh(`pole-face:${pole+1}`,[width/poles-.0015,height-.008,.002],[x,0,depth/2+.001],casing);
  if(style==='wide-single-pole')mesh('single-handle-bezel',[.022,.034,.003],[x,.006,depth/2+.003],new THREE.MeshStandardMaterial({color:'#a5a398',roughness:.7}));
  const toggle=mesh(`toggle:${pole+1}`,[.015,.024,.010],[x,.006,depth/2+.006],dark);
  toggle.rotation.x=-.18;
 }
 if(poles>1){
  const tie=mesh('common-handle',[width-.006,.009,.006],[0,.008,depth/2+.014],dark);
  tie.rotation.x=-.18;
 }
 return group;
}
