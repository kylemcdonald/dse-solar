'use client';

import { useState } from 'react';
import { operatorBlocks, operatorEdges, operatorPath } from './operatorDiagram';

const edges = operatorEdges();
const width = 230, height = 90;

export function OperatorDiagram() {
  const [selected, setSelected] = useState<string | null>(null);
  const highlighted = new Set(edges.filter(edge => edge.from === selected || edge.to === selected).flatMap(edge => [edge.from, edge.to]));
  return <section className="operator-guide" aria-label="Simple system diagram">
    <div className="operator-intro"><div><p className="eyebrow">DSE · Fulaga · installed system</p><h1>Power at a glance</h1>
      <p>Follow the connections to see what powers what. Select a block to highlight its connections.</p></div>
      <p className="operator-key">Solid arrow: power · dashed arrow: remote control<br />Double arrow: charging and battery power</p></div>
    <div className="operator-controls" aria-label="Wall switch guide">
      {[
        ['internet', '1 · Top rocker', 'Internet', 'Switches Starlink and UniFi on or off together.'],
        ['fast', '2 · Middle rocker', 'Fast charging', 'Enables or disables the Orion using remote H.'],
        ['lights', '3 · Bottom rocker', 'Indoor lights', 'Switches both indoor lights together.'],
      ].map(([id, position, label, detail]) => <button key={id} type="button" aria-pressed={selected === id} onClick={() => setSelected(selected === id ? null : id)}>
        <span className="operator-rocker" aria-hidden="true" /><span><small>{position}</small><strong>{label}</strong><span>{detail}</span></span>
      </button>)}
    </div>
    <p className="operator-switch-note">These are labels for the physical wall switches. The shared 10 A services breaker supplies all three rockers. ChargeIT chargers have their own 32 A breaker; the middle rocker controls the Orion only.</p>
    <div className="operator-canvas"><svg viewBox="0 0 1100 770" role="group" aria-label="Power flow from roof panels, batteries and generator to the installed loads">
      <defs><marker id="operator-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0L8 4L0 8Z" fill="context-stroke" /></marker></defs>
      {edges.map(edge => {
        const route = operatorPath(edge);
        const a = operatorBlocks.find(block => block.id === route.from)!;
        const b = operatorBlocks.find(block => block.id === (edge.from === route.from ? edge.to : edge.from))!;
        const path = route.points.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ');
        const active = !selected || edge.from === selected || edge.to === selected;
        const bidirectional = [a.id, b.id].includes('distribution') && [a.id, b.id].some(id => id === 'battery' || id === 'multiplus');
        return <path key={`${edge.from}-${edge.to}-${edge.control}`} d={path} fill="none" stroke={edge.control ? '#a56f19' : '#478179'} strokeWidth={active ? 2.5 : 1.5} opacity={active ? 1 : .14} strokeDasharray={edge.control ? '7 5' : undefined} markerEnd="url(#operator-arrow)" markerStart={bidirectional ? 'url(#operator-arrow)' : undefined} data-connections={edge.connectionIds.join(',')}><title>{a.label} → {b.label}{edge.control ? ' · remote control' : ''}</title></path>;
      })}
      {operatorBlocks.map(block => <g key={block.id} role="button" tabIndex={0} aria-label={`${block.label}: ${block.detail}`} aria-pressed={selected === block.id} onClick={() => setSelected(selected === block.id ? null : block.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(selected === block.id ? null : block.id); } }} opacity={!selected || selected === block.id || highlighted.has(block.id) ? 1 : .35} className="operator-block">
        <rect x={block.x} y={block.y} width={width} height={height} rx={12} fill={selected === block.id ? '#dcebe6' : '#fafbf8'} stroke={selected === block.id ? '#1c6458' : '#c7d3cd'} strokeWidth={selected === block.id ? 2.5 : 1} />
        <text x={block.x + 14} y={block.y + 34} fontSize="17" fontWeight="650">{block.label}</text>
        <foreignObject x={block.x + 14} y={block.y + 46} width={width - 28} height={40}><div className="operator-block-detail">{block.detail}</div></foreignObject>
      </g>)}
    </svg></div>
    <div className="operator-reference">
      <div><h2>Everyday controls</h2><p>Use the three wall rockers for Internet, fast charging and lights. Use the ChargeIT branch breaker for the four shelf chargers. Check the Ekrano for battery and system status.</p></div>
      <div><h2>AC tools</h2><p>The MultiPlus controls AC power. Its Off position does not turn off the DC services or roof panels. Keep the existing one-tool limit of 1,200 W; switch Orion fast charging off and open the ChargeIT breaker during tool use.</p></div>
      <div><h2>Solar and battery isolation</h2><p>The active solar path uses PV breaker 1 and the combiner breaker. PV breaker 2 is disconnected. Battery-string cutoffs A and B and the MPPT battery-side cutoff are separate controls. This block diagram is not an isolation procedure.</p></div>
    </div>
  </section>;
}
