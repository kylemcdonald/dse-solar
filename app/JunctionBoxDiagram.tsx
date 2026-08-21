"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import junctionWiringMapRaw from "../data/junction-wiring-map.json";

type Point = [number, number];
type WireKind = "positive24" | "negative24" | "data";

type PreparedJunctionMap = {
  schemaVersion: number;
  source: {
    algorithm: string;
    optimizationGeneratedAt: string;
    selectedCandidate: string;
  };
  viewBox: { height: number; width: number };
  enclosure: { height: number; width: number; x: number; y: number };
  zones: {
    bottom: { label: string; x: number; y: number };
    glandLabelY: number;
    top: { label: string; x: number; y: number };
  };
  metrics: {
    glandCount: number;
    glandRowCount: number;
    jackCount: number;
    serviceCircuitCount: number;
    wireCount: number;
  };
  components: Array<{
    detail: string;
    height: number;
    id: string;
    kind?: string;
    label: string;
    width: number;
    x: number;
    y: number;
  }>;
  terminals: Array<{
    componentId?: string;
    escape: Point;
    id: string;
    point: Point;
    radius: number;
  }>;
  glands: Array<{
    id: string;
    label: string;
    radius: number;
    row: number;
    type: "gland" | "jack";
    x: number;
    y: number;
  }>;
  pairSheaths: Array<{ id: string; path: string }>;
  wires: Array<{
    circuit: string;
    from: string;
    gauge: string;
    id: string;
    kind: WireKind;
    points: Point[];
    radius: number;
    to: string;
  }>;
};

const junctionWiringMap = junctionWiringMapRaw as unknown as PreparedJunctionMap;
const { components, enclosure, glands, metrics, pairSheaths, terminals, viewBox, wires, zones } = junctionWiringMap;

const kindLabels: Record<WireKind, string> = {
  positive24: "24 V positive / protected positive",
  negative24: "24 V negative / return",
  data: "Data",
};

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const squared = dx * dx + dy * dy;
  const amount = squared === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / squared));
  return Math.hypot(point[0] - start[0] - amount * dx, point[1] - start[1] - amount * dy);
}

export function JunctionBoxDiagram() {
  const [activeWire, setActiveWire] = useState<string | null>(null);
  const trackNearestWire = (event: ReactPointerEvent<SVGSVGElement>) => {
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    let nearest: { distance: number; id: string } | undefined;
    wires.forEach((wire) => wire.points.slice(1).forEach((end, index) => {
      const distance = pointToSegmentDistance([local.x, local.y], wire.points[index], end);
      if (!nearest || distance < nearest.distance) nearest = { distance, id: wire.id };
    }));
    setActiveWire(nearest && nearest.distance <= 20 ? nearest.id : null);
  };

  return (
    <section className="junction-page" aria-labelledby="junction-page-title">
      <header className="junction-page-heading">
        <div><p>Compact DC enclosure · physical placement / clarity-first routing</p><h1 id="junction-page-title">Junction box wiring</h1></div>
        <div className="junction-page-summary"><b>{metrics.wireCount} terminal-to-terminal wires · {metrics.serviceCircuitCount} service circuits</b><span>{metrics.glandCount} cable glands + {metrics.jackCount} Starlink jack · one spread bottom row</span></div>
      </header>
      <p className="junction-page-intro">Component positions correspond to the optimized 3D enclosure. Every conductor below was prepared in advance with an offline 2D rectilinear A* pass; the browser only renders the saved result and never solves routing during page load. Component bodies and foreign connectors are blocked, completed wires are strongly penalized, and each terminal retains its one-way straight approach. It is a tracing aid, not a drilling template.</p>

      <div className="junction-schematic-scroll">
        <svg
          className="junction-schematic junction-schematic-logical"
          viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
          role="img"
          aria-label="Precomputed A-star-routed terminal-level wiring diagram of the DSE compact junction box"
          onPointerMove={trackNearestWire}
          onPointerLeave={() => setActiveWire(null)}
          data-junction-a-star="precomputed"
          data-junction-map-source="offline-artifact"
          data-junction-runtime-routing="false"
          data-junction-gland-rows={metrics.glandRowCount}
        >
          <rect className="junction-enclosure" x={enclosure.x} y={enclosure.y} width={enclosure.width} height={enclosure.height} rx="24" />
          <text className="junction-zone-label" x={zones.top.x} y={zones.top.y}>{zones.top.label}</text>
          <line className="junction-bottom-face" x1={enclosure.x + 15} y1={enclosure.y + enclosure.height} x2={enclosure.x + enclosure.width - 15} y2={enclosure.y + enclosure.height} />

          {wires.map((wire) => {
            const points = wire.points.map((point) => point.join(",")).join(" ");
            return <g key={wire.id}><polyline className={`junction-wire-halo ${activeWire && activeWire !== wire.id ? "is-muted" : ""}`} points={points} /><polyline className={`junction-wire wire-${wire.kind} ${activeWire === wire.id ? "is-active" : ""} ${activeWire && activeWire !== wire.id ? "is-muted" : ""}`} data-junction-wire={wire.id} points={points} /></g>;
          })}

          {pairSheaths.map((sheath) => <path key={sheath.id} className="junction-pair-sheath" d={sheath.path} />)}

          {components.map((component) => <g key={component.id} className={`junction-component logical-component ${component.kind ?? ""}`} data-junction-component={component.id}><rect x={component.x} y={component.y} width={component.width} height={component.height} rx="12" /><text x={component.x + component.width / 2} y={component.y + component.height / 2 - 8}>{component.label}</text><text className="sub" x={component.x + component.width / 2} y={component.y + component.height / 2 + 24}>{component.detail}</text></g>)}

          {terminals.map((terminal) => <circle key={terminal.id} className="junction-terminal" data-junction-terminal={terminal.id} cx={terminal.point[0]} cy={terminal.point[1]} r={terminal.radius} />)}
          {glands.map((gland) => (
            <g key={gland.id} className={`junction-boundary connection-${gland.type}`} data-junction-gland={gland.id}>
              {gland.type === "jack"
                ? <rect x={gland.x - 15} y={gland.y - 12} width="30" height="25" rx="5" />
                : <circle cx={gland.x} cy={gland.y} r={gland.radius} />}
              <text x={gland.x} y={zones.glandLabelY} textAnchor="middle">{gland.label}</text>
            </g>
          ))}
          <text className="junction-zone-label" x={zones.bottom.x} y={zones.bottom.y}>{zones.bottom.label}</text>
        </svg>
      </div>

      <div className="junction-legend" aria-label="Wire color legend">{Object.entries(kindLabels).map(([kind, label]) => <span key={kind}><i className={`wire-${kind}`} />{label}</span>)}</div>
      <div className="junction-run-table-wrap"><table className="junction-run-table"><thead><tr><th>Run</th><th>Circuit</th><th>From</th><th>To</th><th>Planning conductor</th></tr></thead><tbody>{wires.map((wire, index) => <tr key={wire.id} className={activeWire === wire.id ? "is-active" : ""} onMouseEnter={() => setActiveWire(wire.id)} onMouseLeave={() => setActiveWire(null)} data-junction-wire-row={wire.id}><td><span className={`junction-wire-chip wire-${wire.kind}`} />{String(index + 1).padStart(2, "0")}</td><td>{wire.circuit}</td><td>{wire.from}</td><td>{wire.to}</td><td>{wire.gauge}</td></tr>)}</tbody></table></div>
      <aside className="junction-boundary-note"><b>Breaker-bank topology:</b> the six visible breaker positions do not require six independent supply wires. One dedicated 20 A MidNite services breaker has its own input/output, one dedicated 6 A CHTAIXI Starlink breaker has its own input/output, and one common positive comb supplies four CHTAIXI branch breakers for UniFi, USB, inside light and outside light. That is why the physical bank has three supply-side connections and six protected outputs.</aside>
    </section>
  );
}

export default JunctionBoxDiagram;
