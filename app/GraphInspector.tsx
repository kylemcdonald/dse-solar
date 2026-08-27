"use client";

import type { ReactNode } from "react";
import { dseRuntime } from "./dseRuntime";
import { titleCase } from "./systemGraph";
import type {
  CurrentSafetyConnectionCheck,
  CurrentSafetyDeviceCheck,
  CurrentSafetyIssue,
  GraphSelection,
} from "./systemGraph";

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

const currentSafety = dseRuntime.diagnostics.currentSafety;
const currentSourceLabelById = new Map(currentSafety.sources.map((source) => [source.id, source.label]));

function protectionEvidenceLabel(id: string) {
  const separator = id.indexOf(":");
  const kind = separator < 0 ? "" : id.slice(0, separator);
  const target = separator < 0 ? id : id.slice(separator + 1);
  if (kind === "source") return currentSourceLabelById.get(target) ?? titleCase(target);
  if (kind === "device") return dseRuntime.deviceById.get(target)?.label ?? titleCase(target);
  if (kind === "connection") return dseRuntime.routeById.get(target)?.label ?? titleCase(target);
  return titleCase(id);
}

function CurrentSafetyDetails({
  checks,
  issues,
}: {
  checks: readonly (CurrentSafetyConnectionCheck | CurrentSafetyDeviceCheck)[];
  issues: readonly CurrentSafetyIssue[];
}) {
  if (checks.length === 0 && issues.length === 0) return null;
  const status = checks.some((check) => check.status === "incomplete") || issues.some((issue) => issue.severity === "error")
    ? "incomplete"
    : checks.some((check) => check.status === "provisional") || issues.length > 0 ? "provisional" : "verified";
  return (
    <div className={`graph-current-safety graph-current-safety-${status}`} data-current-safety-status={status}>
      <strong>Programmatic current-protection audit · {status}</strong>
      {checks.map((check) => (
        <div className="graph-current-check"
          key={`${"connectionId" in check ? `connection:${check.connectionId}` : `device:${check.deviceId}`}:${check.channel}`}>
          <b>{titleCase(check.channel)} · {check.status}</b>
          {"connectionId" in check
            ? <small>{check.ampacityA === undefined ? "Ampacity missing" : `${check.ampacityA} A declared ampacity`}
              {check.pairedActiveConnectionId ? ` · paired with ${dseRuntime.routeById.get(check.pairedActiveConnectionId)?.label ?? titleCase(check.pairedActiveConnectionId)}` : ""}</small>
            : <small>{check.ratingA === undefined ? "Device/input rating missing" : `${check.ratingA} A declared device/input rating`}</small>}
          <small>Aggregate protection envelope · verified {check.verifiedProtectionEnvelopeA === "unbounded" ? "unbounded" : `${check.verifiedProtectionEnvelopeA} A`}
            {` · including provisional ${check.provisionalProtectionEnvelopeA === "unbounded" ? "unbounded" : `${check.provisionalProtectionEnvelopeA} A`}`}</small>
          {check.protectionBySource.map((evidence) => {
            const source = currentSourceLabelById.get(evidence.sourceId) ?? titleCase(evidence.sourceId);
            const protection = evidence.verifiedBy.length > 0
              ? `verified current-envelope coordination via ${evidence.verifiedBy.map(protectionEvidenceLabel).join(" / ")}`
              : evidence.provisionalBy.length > 0
                ? `provisional via ${evidence.provisionalBy.map(protectionEvidenceLabel).join(" / ")}`
                : "no coordinating cut set";
            const fault = evidence.prospectiveFaultCurrentA === "unbounded"
              ? "unbounded prospective fault contribution"
              : `${evidence.prospectiveFaultCurrentA} A prospective fault contribution`;
            return <small key={evidence.sourceId}>{source} · {protection} · {fault}</small>;
          })}
        </div>
      ))}
      {issues.length > 0 && <ul>{issues.map((issue, index) => (
        <li key={`${issue.code}:${issue.connectionId ?? issue.deviceId ?? issue.endpoint ?? index}:${issue.channel ?? "all"}`}>
          <b>{issue.severity === "error" ? "Error" : "Warning"}</b> · {issue.message}
        </li>
      ))}</ul>}
    </div>
  );
}

export function GraphInspector({ selection, bom, onClose, onSelect }: Props) {
  const bomById = new Map(bom.map((item) => [item.id, item]));
  if (selection.type === "device") {
    const device = dseRuntime.deviceById.get(selection.deviceId);
    if (!device) return null;
    const items = (device.bomIds ?? []).flatMap((id) => bomById.get(id) ?? []);
    const safetyIssues = [...currentSafety.errors, ...currentSafety.warnings].filter((issue) => (
      issue.deviceId === device.id || issue.endpoint?.startsWith(`${device.id}.`)
    ));
    const safetyChecks = currentSafety.devices.filter((check) => check.deviceId === device.id);
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
        <CurrentSafetyDetails checks={safetyChecks} issues={safetyIssues} />
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
  const safetyChecks = selectedRoute
    ? currentSafety.connections.filter((check) => check.connectionId === selectedRoute.id)
    : [];
  const safetyIssues = selectedRoute
    ? [...currentSafety.errors, ...currentSafety.warnings].filter((issue) => issue.connectionId === selectedRoute.id)
    : [];
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
      <CurrentSafetyDetails checks={safetyChecks} issues={safetyIssues} />
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
              <span><strong>{peerDevice.label}</strong><small>{peer.label} · {route.label ?? route.id}</small></span>
            </button>
          );
        })}
      </div>
      {(selectedRoute?.holdReason || device.holdReason) && <div className="graph-hold"><strong>Installation hold</strong><p>{selectedRoute?.holdReason ?? device.holdReason}</p></div>}
    </aside>
  );
}
