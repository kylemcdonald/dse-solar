import {polowatCableRoutes} from './polowatCableRoutes';
import polowatSystem from '../data/polowat-system.json';
import { polowatDeviceById, polowatTopology } from './polowatTopology';
import { polowatEnclosure } from './polowatEnclosure';
import { assemblyParts, assemblyWires } from './polowatAssembly';

export type PolowatModelSelection = { deviceId?: string; connectionId?: string; info?: string };

export function PolowatModelInspector({selection,onClose,onSelect}:{selection:PolowatModelSelection;onClose:()=>void;onSelect:(selection:PolowatModelSelection)=>void}) {
  const device = polowatDeviceById.get(selection.deviceId ?? '');
  const connection = polowatTopology.connections.find(item => item.id === selection.connectionId);
  const part = assemblyParts.find(item => item.id === device?.id);
  const wire = assemblyWires.find(item => item.id === connection?.id);
  const routed = polowatCableRoutes.routes.find(r=>r.id===connection?.id);
  const bom = polowatSystem.bom.find(item => item.id === device?.bomId);
  const connections = device ? polowatTopology.connections.filter(item => item.from === device.id || item.to === device.id) : [];
  return <aside className="inspector graph-inspector" aria-label="Model item details">
    <button type="button" className="inspector-close" onClick={onClose} aria-label="Close details">×</button>
    <p className="inspector-kicker">{device?.kind ?? (connection ? 'Conductor' : 'Assembly hardware')} · planned</p>
    <h2>{device?.label ?? connection?.label ?? 'Assembly detail'}</h2>
    {device && <p>{device.subtitle}</p>}
    {selection.info && <p>{selection.info}</p>}
    <dl className="graph-detail-list">
      {device && <div><dt>Size</dt><dd>{device.size.map(value => `${Math.round(value * 1000)} mm`).join(' × ')}</dd></div>}
      {connection && <><div><dt>Wire</dt><dd>{connection.gauge}</dd></div><div><dt>From</dt><dd><button onClick={()=>onSelect({deviceId:connection.from})}>{polowatDeviceById.get(connection.from)?.label}</button></dd></div><div><dt>To</dt><dd><button onClick={()=>onSelect({deviceId:connection.to})}>{polowatDeviceById.get(connection.to)?.label}</button></dd></div></>}
      {routed && <><div><dt>Modeled route</dt><dd>{routed.modelLengthM.toFixed(2)} m</dd></div>{routed.fieldCut && <div><dt>Planning cut with allowance</dt><dd>{routed.cutLengthM.toFixed(2)} m</dd></div>}</>}
      {wire && <div><dt>Landings</dt><dd>{wire.from} → {wire.to}</dd></div>}
    </dl>
    {part && <p>{part.basis}</p>}
    {device?.kind === 'enclosure' && <p>Modeled shell includes the current component footprint and cable clearance. It is not a selected product. The deferred reference box is {polowatEnclosure.outer.width} × {polowatEnclosure.outer.height} × {polowatEnclosure.outer.depth} mm outside and is smaller than this planning envelope; select the final box after hand assembly.</p>}
    {connection && <p>Planning route; final bend clearance and cut length require the received parts and layout.</p>}
    {bom && <><h3>Bill of materials</h3><div className="graph-bom-list"><strong>{bom.item}</strong><small>{bom.procurement}</small></div><div className="graph-inspector-links">{bom.productUrl && <a href={bom.productUrl} target="_blank" rel="noreferrer">Purchase source</a>}{bom.specUrl && <a href={bom.specUrl} target="_blank" rel="noreferrer">Technical source</a>}</div></>}
    {connections.length > 0 && <><h3>Conductors</h3><div className="graph-conductor-list">{connections.map(item=><button key={item.id} onClick={()=>onSelect({connectionId:item.id})}><span><strong>{item.label}</strong><small>{item.gauge}</small></span></button>)}</div></>}
  </aside>;
}
