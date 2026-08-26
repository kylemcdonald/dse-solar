"use client";

import type { ReactNode } from "react";
import { dseRuntime } from "./dseRuntime";
import { titleCase } from "./systemGraph";
import type { GraphSelection } from "./systemGraph";

export type InspectorBomItem = {
  id: string;
  item: string;
  procurement: string;
  productUrl?: string;
  specUrl?: string;
  description?: string;
};

type Props = {
  selection: GraphSelection;
  bom: readonly InspectorBomItem[];
  onClose: () => void;
  onSelect: (selection: GraphSelection) => void;
};

function ExternalLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return null;
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

export function GraphInspector({ selection, bom, onClose, onSelect }: Props) {
  const bomById = new Map(bom.map((item) => [item.id, item]));
  if (selection.type === "device") {
    const device = dseRuntime.deviceById.get(selection.deviceId);
    if (!device) return null;
    const items = (device.bomIds ?? []).flatMap((id) => bomById.get(id) ?? []);
    return (
      <aside className="inspector graph-inspector" aria-label="Device details">
        <button type="button" className="inspector-close" onClick={onClose} aria-label="Close details">×</button>
        <p className="inspector-kicker">{titleCase(device.kind)} · {device.status ?? "planned"}</p>
        <h2>{device.label}</h2>
        {device.subtitle && <p>{device.subtitle}</p>}
        <dl className="graph-detail-list">
          <div><dt>Size</dt><dd>{(device.physicalSize ?? device.size).map((value) => `${Math.round(value * 1000)} mm`).join(" × ")}</dd></div>
          <div><dt>Location</dt><dd>{device.placement.space === "junction" ? `Inside ${dseRuntime.deviceById.get(device.placement.junctionId)?.label ?? device.placement.junctionId}` : titleCase(device.placement.surface)}</dd></div>
          {device.poles && <div><dt>Breaker width</dt><dd>{device.poles} way · {Math.round(device.size[0] * 1000)} mm</dd></div>}
        </dl>
        {device.holdReason && <div className="graph-hold"><strong>Installation hold</strong><p>{device.holdReason}</p></div>}
        <div className="graph-inspector-links">
          <ExternalLink href={device.purchaseUrl ?? items[0]?.productUrl}>Purchase source</ExternalLink>
          <ExternalLink href={device.technicalUrl ?? items[0]?.specUrl}>Technical source</ExternalLink>
        </div>
        <h3>Conductors</h3>
        <div className="graph-conductor-list">
          {device.conductors.map((port) => {
            const key = `${device.id}.${port.id}`;
            const count = dseRuntime.routes.filter((route) => route.from === key || route.to === key).length;
            return (
              <button key={port.id} type="button" onClick={() => onSelect({ type: "conductor", conductorKey: key })}>
                <span className={`conductor-dot conductor-${port.kind}`} />
                <span><strong>{port.label}</strong><small>{port.gauge ?? titleCase(port.kind)} · {count || "no"} connection{count === 1 ? "" : "s"}</small></span>
              </button>
            );
          })}
        </div>
        {items.length > 0 && <>
          <h3>Bill of materials</h3>
          <div className="graph-bom-list">{items.map((item) => <div key={item.id}><strong>{item.item}</strong><small>{item.procurement}</small></div>)}</div>
        </>}
      </aside>
    );
  }

  const conductor = dseRuntime.conductorByKey.get(selection.conductorKey);
  if (!conductor) return null;
  const device = dseRuntime.deviceById.get(conductor.deviceId)!;
  const attached = dseRuntime.routes.filter((route) => route.from === conductor.key || route.to === conductor.key);
  const selectedRoute = selection.connectionId ? dseRuntime.routeById.get(selection.connectionId) : attached[0];
  const cable = selectedRoute ? dseRuntime.graph.cables.find((candidate) => candidate.id === selectedRoute.cableId) : undefined;
  const internalMates = (conductor.internalMates ?? []).map((id) => (
    dseRuntime.conductorByKey.get(`${device.id}.${id}`)?.label ?? id
  ));
  return (
    <aside className="inspector graph-inspector" aria-label="Conductor details">
      <button type="button" className="inspector-close" onClick={onClose} aria-label="Close details">×</button>
      <p className="inspector-kicker">Conductor · {titleCase(conductor.kind)}</p>
      <h2>{conductor.label}</h2>
      <button type="button" className="graph-parent-device" onClick={() => onSelect({ type: "device", deviceId: device.id })}>{device.label}</button>
      <dl className="graph-detail-list">
        <div><dt>Conductor ID</dt><dd><code>{conductor.key}</code></dd></div>
        <div><dt>Terminal type</dt><dd>{conductor.terminal ?? "Device terminal"}</dd></div>
        <div><dt>Terminal size</dt><dd>{conductor.terminalSize ?? "Verify on received device"}</dd></div>
        <div><dt>Termination</dt><dd>{conductor.termination ?? "Match the received terminal"}</dd></div>
        <div><dt>Approach</dt><dd>{titleCase(conductor.face)} face · wire meets in terminal orientation</dd></div>
        {conductor.gauge && <div><dt>Specified lead</dt><dd>{conductor.gauge}</dd></div>}
        {cable && <div><dt>Cable</dt><dd>{cable.label}</dd></div>}
        {cable && <div><dt>Cable makeup</dt><dd>{cable.conductorSize} · {cable.cores} core{cable.cores === 1 ? "" : "s"} · {cable.outsideDiameterMm} mm OD · {cable.sheath === "white" ? "white multicore sheath" : "single insulated conductor"}</dd></div>}
        {selectedRoute && <div><dt>Routed length</dt><dd>{selectedRoute.lengthM.toFixed(2)} m · serial weighted voxel A*</dd></div>}
        {internalMates.length > 0 && <div><dt>Internal cores</dt><dd>{internalMates.join(" · ")}</dd></div>}
      </dl>
      {conductor.terminalNote && <div className="graph-hold graph-terminal-note"><strong>Terminal note</strong><p>{conductor.terminalNote}</p></div>}
      <h3>Attached to</h3>
      <div className="graph-conductor-list">
        {attached.length === 0 && <p>Unconnected device outlet / spare terminal.</p>}
        {attached.map((route) => {
          const peerKey = route.from === conductor.key ? route.to : route.from;
          const peer = dseRuntime.conductorByKey.get(peerKey)!;
          const peerDevice = dseRuntime.deviceById.get(peer.deviceId)!;
          return (
            <button key={route.id} type="button" onClick={() => onSelect({ type: "conductor", conductorKey: peerKey, connectionId: route.id })}>
              <span className={`conductor-dot conductor-${route.kind}`} />
              <span><strong>{peerDevice.label}</strong><small>{peer.label} · {route.id}</small></span>
            </button>
          );
        })}
      </div>
      {(selectedRoute?.holdReason || device.holdReason) && <div className="graph-hold"><strong>Installation hold</strong><p>{selectedRoute?.holdReason ?? device.holdReason}</p></div>}
    </aside>
  );
}
