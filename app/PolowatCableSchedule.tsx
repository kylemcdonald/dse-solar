import {polowatCableRoutes as plan} from './polowatCableRoutes';
export function PolowatCableSchedule(){return <section>
 <h3>Routed cable purchase estimate</h3>
 <p>Lengths come from the same routes displayed in the 3D model. Cuts include 15% slack plus 50 mm per end, rounded up to 50 mm. Corresponding battery branches are equalized. This is a starting point for stock purchases; measure the final installation before cutting. The roof-to-box distance is not surveyed: verify it fits the remaining shared 10 AWG coil after controller cuts.</p>
 <table><thead><tr><th>Circuit</th><th>Wire</th><th>Model</th><th>Cut allowance</th></tr></thead><tbody>{plan.routes.filter(r=>r.fieldCut).map(r=><tr key={r.id}><th>{r.label}</th><td>{r.gauge} · {r.color}</td><td>{r.modelLengthM.toFixed(2)} m</td><td>{r.cutLengthM.toFixed(2)} m</td></tr>)}</tbody></table>
 <p>Terminal stubs, actual bend radii and cable-to-cable clearances need a bench check. The routed layout is longer than earlier straight-run assumptions; the electrical audit retains a voltage-drop hold until the physical layout is shortened or the conductor plan is revised.</p>
</section>;}
