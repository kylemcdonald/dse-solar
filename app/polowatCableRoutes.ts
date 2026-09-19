import * as THREE from 'three';
import artifact from '../data/generated/polowat-cable-routes.json';
export const polowatCableRoutes=artifact;
/** The measurement and both rendering paths use the same piecewise-linear centreline. */
export function cableCurve(points:readonly (readonly number[])[]){
 const curve=new THREE.CurvePath<THREE.Vector3>();
 for(let i=1;i<points.length;i++){
  const a=new THREE.Vector3(...points[i-1] as [number,number,number]),b=new THREE.Vector3(...points[i] as [number,number,number]);
  if(a.distanceTo(b)>1e-9)curve.add(new THREE.LineCurve3(a,b));
 }
 return curve;
}
