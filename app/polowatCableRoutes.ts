import artifact from '../data/generated/polowat-cable-routes.json';
import { roundedRouteCurve } from './cableCurve3D';
import type { Vec3 } from './systemGraph';
export const polowatCableRoutes=artifact;
/** Shared rounded centreline; callers must supply the actual cable diameter. */
export function cableCurve(points:readonly (readonly number[])[], diameterMm=5){
 return roundedRouteCurve(points as readonly Vec3[], Math.max(.009,diameterMm/2000*4.25));
}
