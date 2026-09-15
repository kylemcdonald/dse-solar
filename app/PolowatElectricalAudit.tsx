"use client";

import { useState } from "react";
import system from "@/data/polowat-system.json";
import { batteryPathVoltageDrop } from "./polowatElectrical";
import { PolowatEnclosureSizing } from "./PolowatEnclosureSizing";

export function PolowatElectricalAudit() {
  const audit = system.electricalAudit;
  const a = audit.assumptions;
  const [oneWay, setOneWay] = useState(a.batteryBranchOneWayM);
  return <article className="polowat-electrical-audit">
    <p className="eyebrow">Electrical survey · {audit.date}</p>
    <h2>Current limits and wire sizes</h2>
    <p>{audit.summary} <a href={audit.report}>Read the complete audit and remaining checks</a>.</p>
    <p>300 W ÷ 12 V = 25 A, but the SmartSolar limits charging to 20 A. Battery/controller wiring is sized for that current and required 30 A protection. The DIHOOL photos show 12–500 VDC and Icu 6 kA; conflicting listing text and family-page specifications remain unresolved. The 165 W load envelope is about 14 A at the 11.8 V disconnect setting.</p>
    <p>The PV disconnect is already a polarized 10 A CHTAIXI, with normal current flowing from the panels into the MPPT PV input. The MPPT battery connection and both battery branches carry charge and discharge current in opposite directions; those are the three non-polarized DIHOOL positions.</p>
    <div style={{ overflowX: "auto" }}><table>
      <thead><tr><th>Circuit</th><th>Current basis</th><th>Conductor</th><th>One-way length</th><th>Protection / limits</th></tr></thead>
      <tbody>{audit.circuits.map(c => <tr key={c.id}>
        <th>{c.circuit}</th><td>{c.designCurrentA === null ? "Negotiated USB" : `${c.designCurrentA.toFixed(2)} A`}</td>
        <td>{c.gauge}</td><td>{c.oneWayMetres === null ? "Factory" : `${c.oneWayMetres} m`}</td>
        <td>{c.protection}<br /><small>{c.note}</small></td>
      </tr>)}</tbody>
    </table></div>
    <div className="polowat-drop-check">
      <h3>Battery-to-controller voltage drop</h3>
      <label htmlFor="polowat-cable-length">Battery → busbars, one-way route: <strong>{oneWay.toFixed(1)} m</strong></label>
      <input id="polowat-cable-length" type="range" min="0.5" max="6" step="0.1" value={oneWay} onChange={e => setOneWay(Number(e.target.value))} />
      <p>Both conductors included, at 20 A and 75°C copper. The bus-to-controller pair stays at {a.controllerOneWayM} m one way. The owner’s battery route is under 2 m; the calculation uses 2 m as its planning boundary.</p>
      <table><thead><tr><th>Copper size</th><th>Drop</th><th>At 11.8 V</th></tr></thead><tbody>
        {[{ label: "Prior 4 mm² throughout", battery: 4, controller: 4 }, { label: "Prior 10 AWG throughout", battery: 5.26, controller: 5.26 }, { label: "Selected 8 AWG battery + 10 AWG controller", battery: a.batteryAreaMm2, controller: a.controllerAreaMm2 }].map(wire => {
          const drop = batteryPathVoltageDrop(oneWay, a.controllerOneWayM, a.mainCurrentA, wire.battery, wire.controller, a.conductorTemperatureC);
          return <tr key={wire.label}><th>{wire.label}</th><td>{drop.toFixed(3)} V</td><td>{(100 * drop / a.designDisconnectV).toFixed(2)}%{drop / a.designDisconnectV > .03 ? " · exceeds 3% target" : ""}</td></tr>;
        })}
      </tbody></table>
      <p>Wire-only estimate; contacts and breakers add resistance. Ampacity, fault protection and terminal fit require separate checks. A larger conductor may be needed for a longer route and may require an approved transition at the controller.</p>
    </div>
    <PolowatEnclosureSizing />
    <h3>Open installation checks</h3><ul>{audit.holds.map(hold => <li key={hold}>{hold}</li>)}</ul>
    <p>Last cart verification ({system.cartStaging.checkedDate}): {system.cartStaging.retailQuantity} retail units across {system.cartStaging.distinctAsins} Amazon listings, ${system.cartStaging.itemSubtotalUsd.toFixed(2)} item subtotal. Both round USB extensions are staged; the enclosure remains deferred. See the staging report for held and unsourced items. Nothing ordered.</p>
  </article>;
}
