import { viewerHref } from './viewerRoutes';
import { polowatEnclosure as plan } from './polowatEnclosure';
export function PolowatEnclosureSizing() {
 const {width,height}=plan.outer;
 const studyWidth=plan.bench.width;
 const studyHeight=plan.bench.height;
 return <section className="polowat-enclosure-sizing" data-layout-status={plan.layoutStatus}>
  <h3>Dimensioned assembly study · enclosure order deferred</h3>
  <p>The <a href={plan.source}>ANIMACYN 13.8 × 9.7 × 5.9 inch reference box</a> remains a ${plan.allowanceUsd.toFixed(2)} allowance. <strong>Keep it out of the order.</strong> The shared solver’s component and routing envelopes exceed its outside footprint; this does not establish whether a different compact arrangement fits received parts.</p>
  <div className="polowat-enclosure-layout"><svg viewBox={`-15 -20 ${studyWidth+40} ${studyHeight+65}`} role="img" aria-label="Dimensioned bench assembly compared with reference enclosure outside limits; fit unresolved">
   <rect width={studyWidth} height={studyHeight} fill="#eef0e9" stroke="#a4b1ac"/>
   <rect x={plan.controllerClearance.x} y={plan.controllerClearance.y} width={plan.controllerClearance.width} height={plan.controllerClearance.height} fill="#d9eadf" stroke="#4c8963" strokeDasharray="4 3"/>
   {plan.parts.map(p=><g key={p.id}><rect x={p.x} y={p.y} width={p.width} height={p.height} rx="2" fill={p.id==='mppt'?'#b1d5e3':'#d9ded8'} stroke="#56695f"/><text x={p.x+p.width/2} y={p.y+p.height/2} textAnchor="middle" fontSize={p.width<45?6:9}>{p.label}</text></g>)}
   <rect width={width} height={height} fill="none" stroke="#be5048" strokeWidth="2" strokeDasharray="7 4"/>
   <text x={studyWidth/2} y={studyHeight+24} textAnchor="middle" fontSize="11">{studyWidth} × {studyHeight} mm study · red: box OUTSIDE limits</text>
  </svg><div><p><a href={viewerHref("polowat", "model")}>Open the 3D model</a> for individual clamps, four isolated jumper groups, cable endpoints, and bottom entries. Click a component or wire to inspect it.</p><p>Keep the eight installed DK10N blocks contiguous on one rail. Four within-pair jumpers create BATT+, BATT−, LOAD+ and LOAD−; two unused kit blocks stay off the mounted assembly as spares. The supplied single end cover and two rail stops serve this arrangement.</p><p>Controller body and cooling clearances are manufacturer-based. Converter bodies, connector access and cable bends use provisional envelopes. Hand-assemble and measure before ordering the box. Modeled cables pass the shared collision and bend checks; actual installation dimensions still require verification.</p><p><a href="/polowat-assembly-review.md">Read the assembly review and unresolved checks</a>. Battery protection, thermal performance and final weather sealing remain installation checks.</p></div></div>
 </section>;
}
