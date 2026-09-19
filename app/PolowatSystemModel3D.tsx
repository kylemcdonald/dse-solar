"use client";
import { useEffect, useState } from "react";
import { createSystemModel3D } from "./SystemModel3D";
import { polowatRuntime } from "./polowatRuntime";
import { PolowatModelInspector, type PolowatModelSelection } from "./PolowatModelInspector";
const Model = createSystemModel3D(polowatRuntime, {
  compact: true,
  initialPose: {position:[2.3,2.3,6.3],target:[-.3,1.8,.1]},
  siteNote: "Planning layout · final enclosure, cooling and cable lengths require hand assembly.",
});
export function PolowatSystemModel3D() {
 const [selection,setSelection] = useState<PolowatModelSelection|null>(null);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setSelection(null);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[]);
 return <div className="polowat-model" data-model="polowat-planning-topology" data-device-count={polowatRuntime.devices.length} data-connection-count={polowatRuntime.routes.length}>
  <Model fadePurchased={false} onFadePurchasedChange={()=>{}} onClearSelection={()=>setSelection(null)} onSelect={s=>setSelection(s.type==='device'?{deviceId:s.deviceId}:s.connectionId?{connectionId:s.connectionId}:{deviceId:s.conductorKey.split('.')[0]})}/>
  {selection && <div className="inspector-layer"><PolowatModelInspector selection={selection} onClose={()=>setSelection(null)} onSelect={setSelection}/></div>}
 </div>;
}
