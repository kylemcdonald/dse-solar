'use client';
import {useEffect,useState,type ComponentProps} from 'react';
import {UnifiedSystemDiagram} from './UnifiedSystemDiagram';
import {polowatDiagramRuntime as runtime} from './polowatDiagramRuntime';
import layoutsArtifact from '../data/generated/polowat-diagram-layouts.json';
import {PolowatModelInspector,type PolowatModelSelection} from './PolowatModelInspector';
import type {GraphSelection} from './systemGraph';
const layouts=layoutsArtifact as unknown as ComponentProps<typeof UnifiedSystemDiagram>['layouts'];

export function PolowatSystemDiagram(){
 const [selection,setSelection]=useState<PolowatModelSelection|null>(null);
 const [fadePurchased,setFadePurchased]=useState(false);
 useEffect(()=>{
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelection(null);};
  window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
 },[]);
 const select=(picked:GraphSelection)=>{
  if(picked.type==='device'){
   setSelection(runtime.deviceById.has(picked.deviceId)?{deviceId:picked.deviceId}:{info:'Supply cable breakout · diagram grouping of the paired conductors.'});
  }else{
   const wire=runtime.routes.find(r=>r.from===picked.conductorKey||r.to===picked.conductorKey);
   setSelection(wire?{connectionId:wire.id}:{deviceId:runtime.conductorByKey.get(picked.conductorKey)?.deviceId});
  }
 };
 return <div className="polowat-diagram-workspace" data-system="inowon-polowat">
  <UnifiedSystemDiagram runtime={runtime} layouts={layouts} fadePurchased={fadePurchased} onFadePurchasedChange={setFadePurchased} onSelect={select} onClearSelection={()=>setSelection(null)} inspectorOpen={selection!==null}/>
  {selection&&<div className="inspector-layer"><PolowatModelInspector selection={selection} onClose={()=>setSelection(null)} onSelect={setSelection}/></div>}
 </div>;
}
