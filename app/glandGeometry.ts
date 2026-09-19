import * as THREE from 'three';

/** Shared bore dimensions for the sleeve, panel opening and crossing audit. */
export function glandDimensions(diameterMm:number) {
 const boreRadius=diameterMm/2000+.0008;
 return {boreRadius,outerRadius:Math.max(.007,boreRadius+.002),length:.024};
}
export function glandSleeveGeometry(diameterMm:number) {
 const {boreRadius,outerRadius,length}=glandDimensions(diameterMm);
 const shape=new THREE.Shape();shape.absarc(0,0,outerRadius,0,Math.PI*2,false);
 const hole=new THREE.Path();hole.absarc(0,0,boreRadius,0,Math.PI*2,true);shape.holes.push(hole);
 return new THREE.ExtrudeGeometry(shape,{depth:length,bevelEnabled:false,curveSegments:24}).rotateX(Math.PI/2).translate(0,length/2,0);
}
export function entryPanelGeometry(width:number,depth:number,thickness:number,holes:readonly {x:number;z:number;radius:number}[]) {
 const shape=new THREE.Shape();shape.moveTo(-width/2,-depth/2);shape.lineTo(width/2,-depth/2);shape.lineTo(width/2,depth/2);shape.lineTo(-width/2,depth/2);shape.closePath();
 for(const {x,z,radius} of holes){const hole=new THREE.Path();hole.absarc(x,z,radius,0,Math.PI*2,true);shape.holes.push(hole);}
 return new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,curveSegments:24}).rotateX(Math.PI/2).translate(0,thickness/2,0);
}
