"use client";

import { useMemo, useState } from "react";
import polowatRaw from "@/data/polowat-system.json";
import {
  polowatDeviceById,
  polowatTopology,
  type PolowatConnection,
  type PolowatDevice,
} from "./polowatTopology";

type Point = { x: number; y: number };
type PolowatBomItem = { id: string; item: string; description: string; procurement: string };

const bomById = new Map((polowatRaw.bom as PolowatBomItem[]).map((item) => [item.id, item]));

function connectionPoints(connection: PolowatConnection): Point[] {
  if (connection.diagramRoute) return connection.diagramRoute.map(([x, y]) => ({ x, y }));
  const from = polowatDeviceById.get(connection.from)?.diagram;
  const to = polowatDeviceById.get(connection.to)?.diagram;
  if (!from || !to) return [];
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const horizontal = Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y);
  if (horizontal) {
    const direction = Math.sign(toCenter.x - fromCenter.x) || 1;
    const start = { x: fromCenter.x + direction * from.width / 2, y: fromCenter.y };
    const end = { x: toCenter.x - direction * to.width / 2, y: toCenter.y };
    const middleX = (start.x + end.x) / 2;
    return [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
  }
  const direction = Math.sign(toCenter.y - fromCenter.y) || 1;
  const start = { x: fromCenter.x, y: fromCenter.y + direction * from.height / 2 };
  const end = { x: toCenter.x, y: toCenter.y - direction * to.height / 2 };
  const middleY = (start.y + end.y) / 2;
  return [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end];
}

function pathData(points: readonly Point[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
}

function connectionLabelPoint(connection: PolowatConnection, points: readonly Point[]) {
  if (connection.labelAt) return { x: connection.labelAt[0], y: connection.labelAt[1] };
  const middle = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
  return middle;
}

function kindLabel(device: PolowatDevice) {
  if (device.kind === "panel") return "PV MODULE";
  if (device.kind === "battery") return "LOCAL BATTERY";
  if (device.kind === "breaker") return "CIRCUIT PROTECTION";
  if (device.kind === "controller") return "CHARGE + LOAD CONTROL";
  if (device.kind === "bus") return "BALANCED DISTRIBUTION";
  if (device.kind === "converter") return "DC CONVERSION";
  if (device.kind === "distribution") return "LOAD DISTRIBUTION";
  return "LOAD";
}

export function PolowatSystemDiagram() {
  const [selectedId, setSelectedId] = useState("mppt");
  const selected = polowatDeviceById.get(selectedId) ?? polowatTopology.devices[0];
  const selectedBom = selected.bomId ? bomById.get(selected.bomId) : undefined;
  const routes = useMemo(() => polowatTopology.connections.map((connection) => ({
    connection,
    points: connectionPoints(connection),
  })), []);

  return (
    <section className="polowat-diagram" data-system="inowon-polowat" data-device-count={polowatTopology.devices.length}
      data-connection-count={polowatTopology.connections.length} aria-labelledby="polowat-diagram-title">
      <header className="polowat-view-heading">
        <div>
          <p className="eyebrow">Polowat P1 · direct DC · no inverter</p>
          <h1 id="polowat-diagram-title">Compact system wiring</h1>
          <p>Three panels in series, two independently protected batteries, and two controlled load branches.</p>
        </div>
        <div className="polowat-design-badges" aria-label="Design ratings">
          <span><small>PV</small><strong>300 W · 3S</strong></span>
          <span><small>Bank</small><strong>12 V · 300 Ah</strong></span>
          <span><small>Peak load</small><strong>150 W</strong></span>
        </div>
      </header>

      <div className="polowat-diagram-frame">
        <svg viewBox="0 0 1600 930" role="img" aria-label="Detailed Polowat solar, battery, Starlink and USB wiring diagram">
          <defs>
            <filter id="polowat-node-shadow" x="-20%" y="-20%" width="140%" height="150%">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#173336" floodOpacity="0.13" />
            </filter>
            <marker id="polowat-arrow-blue" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0 0 8 4 0 8Z" fill="#3b6ea8" />
            </marker>
          </defs>

          <rect className="polowat-region polowat-region-array" x="34" y="42" width="572" height="184" rx="18" />
          <text className="polowat-region-label" x="54" y="69">ROOF / SOLAR ARRAY · 3S · NO COMBINER</text>
          <rect className="polowat-region polowat-region-core" x="628" y="42" width="460" height="632" rx="18" />
          <text className="polowat-region-label" x="648" y="69">SHELTERED EQUIPMENT ENCLOSURE</text>
          <rect className="polowat-region polowat-region-loads" x="1092" y="42" width="464" height="858" rx="18" />
          <text className="polowat-region-label" x="1112" y="69">CONTROLLED LOADS · 20 A MAXIMUM</text>
          <rect className="polowat-region polowat-region-battery" x="34" y="446" width="568" height="454" rx="18" />
          <text className="polowat-region-label" x="54" y="473">BATTERY AREA · VENTILATED / TERMINALS GUARDED</text>

          <g className="polowat-wire-layer">
            {routes.map(({ connection, points }) => points.length > 0 && (
              <g key={connection.id} className={`polowat-wire polowat-wire-${connection.kind}`}
                data-connection-id={connection.id} data-gauge={connection.gauge}>
                <path d={pathData(points)} markerEnd={connection.kind === "regulated" ? "url(#polowat-arrow-blue)" : undefined} />
                {connection.labelAt && <g className="polowat-wire-label" transform={`translate(${connectionLabelPoint(connection, points).x} ${connectionLabelPoint(connection, points).y})`}>
                  <rect x={-Math.max(58, connection.label.length * 3.35 + 9)} y={-13}
                    width={Math.max(116, connection.label.length * 6.7 + 18)} height="25" rx="7" />
                  <text textAnchor="middle" dominantBaseline="middle">{connection.label}</text>
                </g>}
              </g>
            ))}
          </g>

          <g className="polowat-device-layer">
            {polowatTopology.devices.filter((device) => device.diagram).map((device) => {
              const box = device.diagram!;
              const selectedNode = device.id === selected.id;
              return (
                <g key={device.id} role="button" tabIndex={0} aria-label={`${device.label}: ${device.subtitle}`}
                  className={`polowat-diagram-device polowat-device-${device.kind}${selectedNode ? " selected" : ""}`}
                  data-device-id={device.id} onClick={() => setSelectedId(device.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setSelectedId(device.id);
                  }}>
                  <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="12" filter="url(#polowat-node-shadow)" />
                  {device.kind === "panel" && <g className="polowat-panel-grid">
                    {[1, 2, 3].map((column) => <line key={`c${column}`} x1={box.x + box.width * column / 4} y1={box.y + 9} x2={box.x + box.width * column / 4} y2={box.y + 30} />)}
                    <line x1={box.x + 9} y1={box.y + 20} x2={box.x + box.width - 9} y2={box.y + 20} />
                  </g>}
                  <text className="polowat-device-kicker" x={box.x + 13} y={box.y + 21}>{kindLabel(device)}</text>
                  <text className="polowat-device-label" x={box.x + 13} y={box.y + box.height / 2 + 7}>{device.label}</text>
                  <text className="polowat-device-subtitle" x={box.x + 13} y={box.y + box.height - 14}>{device.subtitle}</text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="polowat-diagram-footer">
        <div className="polowat-wire-legend" aria-label="Conductor legend">
          <span><i className="positive" />Positive / PV+</span>
          <span><i className="negative" />Negative / PV−</span>
          <span><i className="regulated" />Regulated 24 V / USB</span>
          <span><b>All field power wire: 4 mm²</b></span>
        </div>
        <article className="polowat-selected-device" aria-live="polite">
          <div><small>{kindLabel(selected)}</small><strong>{selected.label}</strong><span>{selected.subtitle}</span></div>
          {selectedBom && <p>{selectedBom.description}</p>}
        </article>
      </div>

      <aside className="polowat-design-note">
        <strong>Protection boundary</strong>
        <p>The battery and controller breaker interrupt ratings, conductor ampacity, battery chemistry, and panel attachment remain installer holds until the exact Chuuk hardware and Polowat site are known.</p>
      </aside>
    </section>
  );
}
