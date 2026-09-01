"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import diagramLayoutsArtifact from "../data/generated/diagram-layouts.json";
import { CurrentSafetySummary } from "./CurrentSafetySummary";
import { dseRuntime } from "./dseRuntime";
import { conductorColor, isPurchasedDevice } from "./systemGraph";
import type {
  ConductorKind,
  GraphSelection,
  ResolvedDevice,
  RoutedConnection,
} from "./systemGraph";

type Props = {
  fadePurchased: boolean;
  onFadePurchasedChange: (fade: boolean) => void;
  onSelect: (selection: GraphSelection) => void;
  onClearSelection?: () => void;
  inspectorOpen?: boolean;
};

type Point = { x: number; y: number };
type PortSide = "input" | "output" | "neutral" | "top";
type EndpointPosition = {
  point: Point;
  side: PortSide;
  selectionKey: string;
  ownerDeviceId?: string;
  boundary?: boolean;
};
type DiagramPort = {
  id: string;
  endpointId: string;
  label: string;
  kind: ConductorKind;
  side: PortSide;
  selectionKey: string;
  connectionId?: string;
  glandId?: string;
  /** Canonical order on the selected schematic edge. */
  declaredOrder?: number;
  /** Diagram-only position along its assigned node edge. */
  offset?: number;
};
type DiagramNode = {
  device: ResolvedDevice;
  ports: DiagramPort[];
  x: number;
  y: number;
  width: number;
  height: number;
  abstractJunction: boolean;
};
type BoundaryPort = DiagramPort & { point: Point };
type WireSeed = {
  route: RoutedConnection;
  fromEndpointId: string;
  toEndpointId: string;
};
type RoutedWire = WireSeed & {
  points: readonly Point[];
  bridges: readonly { point: Point; axis: "horizontal" | "vertical" }[];
  color: string;
  width: number;
  fromNodeId?: string;
  toNodeId?: string;
};
type DiagramLayout = {
  key: string;
  scope: "system" | "junction";
  junction?: ResolvedDevice;
  nodes: DiagramNode[];
  boundaryPorts: BoundaryPort[];
  wires: RoutedWire[];
  width: number;
  height: number;
  routingMs: number;
  coincidentSegments: number;
  nonOrthogonalSegments: number;
  conductorOverlaps: number;
  routingFallbacks: number;
  fallbackRouteIds: readonly string[];
  bridgedCrossings: number;
  unbridgedCrossings: number;
  parallelEnvelopeOverlaps: number;
  minimumParallelWireSeparation: number;
  nodeBodyCrossings: number;
  maskedNodeBodyCrossings: number;
  nodeOverlaps: number;
  wireTurns: number;
  wireLength: number;
  interchangeableTapCandidates: number;
  interchangeableTapReassignments: number;
  busbarLandingCandidates: number;
  busbarLandingReassignments: number;
  peerOrderedBusbarIds: readonly string[];
  tapRoutingOrderCandidates: number;
  selectedRoutingOrder: DiagramRouteOrdering;
  layoutMs: number;
  precomputedLayoutMs?: number;
};
type ViewTransform = { x: number; y: number; scale: number };

export type DiagramMacroCenterOverrides = Readonly<Record<string, Readonly<{
  x: number;
  y: number;
}>>>;

const GRID = 12;
const ROUTE_GRID = 6;
const MIN_WIRE_LANE_SPACING = ROUTE_GRID * 2;
const PARALLEL_LANE_OFFSETS = Array.from(
  { length: Math.ceil(MIN_WIRE_LANE_SPACING / ROUTE_GRID) },
  (_, index) => (index + 1) * ROUTE_GRID,
).flatMap((distance) => [-distance, distance]);
// Keep every node, port, and route lane on the same integer diagram grid.  A
// 48 px pitch is divisible by GRID even when an even number of ports is
// centered around a node, so conductors never need a diagonal "last mile."
const PORT_PITCH = 48;
const PORT_RADIUS = 7;
const ROUTE_LEAD = 30;
const LAYOUT_MARGIN = 144;
const ABSTRACT_GLAND_PITCH = 36;
const WORLD_COLUMN_GAP = 168;
const WORLD_LANE_GAP = 192;
const WORLD_STAGE_STACK_GAP = 96;
const AC_CONVERSION_ROW_OFFSET = 360;
const ATTACHED_JOIN_GAP = 72;
const EXTERNAL_AC_JUNCTION_GAP = 144;
const INVERTER_BREAKOUT_GAP = 96;
const BATTERY_JOIN_GAP = 84;
const JUNCTION_COLUMN_GAP = 168;
const JUNCTION_ROW_GAP = 108;
const JUNCTION_ATTACHED_JOIN_GAP = ROUTE_LEAD * 2 + GRID;
const BOUNDARY_PORT_PITCH = 42;
const WIRE_LANE_CLEARANCE = 0.05;
const MIN_SCALE = 0.16;
const MAX_SCALE = 2.4;
const diagramConductorColor: Record<ConductorKind, string> = {
  ...conductorColor,
  // The shared graph color is intentionally conservative for the light 3D
  // scene. The diagram sits on a mid-grey field, where a brighter PE green is
  // needed to keep protective earth distinct from black returns at fit scale.
  earth: "#4af287",
};

const snap = (value: number, step = GRID) => Math.round(value / step) * step;
const snapUp = (value: number, step = GRID * 2) => Math.ceil(value / step) * step;
const endpointDeviceId = (endpoint: string) => endpoint.slice(0, endpoint.indexOf("."));

const baseSizeByKind: Record<ResolvedDevice["kind"], readonly [number, number]> = {
  panel: [156, 108], battery: [156, 84], breaker: [96, 84], busbar: [168, 72],
  converter: [156, 96], inverter: [180, 132], monitor: [156, 96], load: [144, 84],
  switch: [156, 96], connector: [156, 84], junction: [216, 108], protection: [108, 84],
  generator: [168, 108], earth: [144, 72],
};

function connectionsFor(conductorKey: string) {
  return dseRuntime.graph.connections.filter((connection) => (
    connection.from === conductorKey || connection.to === conductorKey
  ));
}

function isDiagramJoin(device: ResolvedDevice) {
  return device.presentation === "wire-join" || device.diagramPresentation === "join";
}

/** Infer edge placement from graph direction. Label semantics apply only to an unconnected spare/receptacle. */
function sideForConductor(device: ResolvedDevice, conductorId: string, kind: ConductorKind): PortSide {
  const candidate = device.conductors.find((conductor) => conductor.id === conductorId)!;
  if (candidate.diagramSide) return candidate.diagramSide;
  if (kind === "earth" || kind === "data") return "neutral";
  const key = `${device.id}.${conductorId}`;
  const attached = connectionsFor(key);
  const outgoing = attached.filter((connection) => connection.from === key).length;
  const incoming = attached.filter((connection) => connection.to === key).length;
  if (outgoing > 0 || incoming > 0) {
    if (outgoing > incoming) return "output";
    if (incoming > outgoing) return "input";
    return outgoing > 0 ? "output" : "neutral";
  }
  if (/\b(out|output|socket|receptacle|usb(?:-|\s)?[ac])\b/i.test(candidate.label)) return "output";
  if (/\b(in|input|supply)\b/i.test(candidate.label)) return "input";
  return "neutral";
}

/** Bodyless fans use electrical flow for every core, including PE. A breakout
 * therefore presents its white sheath on one side and all colored cores on
 * the other instead of dropping earth to an unrelated bottom edge. */
function joinSideForConductor(device: ResolvedDevice, conductorId: string): PortSide {
  const conductor = device.conductors.find((candidate) => candidate.id === conductorId)!;
  if (conductor.diagramSide) return conductor.diagramSide;
  const key = `${device.id}.${conductorId}`;
  const attached = connectionsFor(key);
  const outgoing = attached.filter((connection) => connection.from === key).length;
  const incoming = attached.filter((connection) => connection.to === key).length;
  if (outgoing > incoming) return "output";
  if (incoming > outgoing) return "input";
  return conductor.face === "left" ? "input" : conductor.face === "right" ? "output" : "neutral";
}

function devicePorts(device: ResolvedDevice): DiagramPort[] {
  const ports = device.conductors.map((conductor) => ({
    id: conductor.id,
    endpointId: `${device.id}.${conductor.id}`,
    label: conductor.label,
    kind: conductor.kind,
    side: device.presentation === "rigid-rail" ? "neutral"
      : isDiagramJoin(device) ? joinSideForConductor(device, conductor.id)
        : sideForConductor(device, conductor.id, conductor.kind),
    selectionKey: `${device.id}.${conductor.id}`,
    declaredOrder: conductor.order,
  }));
  return device.presentation === "rigid-rail" ? ports.toSorted((first, second) => (
    (first.kind === "positive" ? 0 : 1) - (second.kind === "positive" ? 0 : 1)
      || first.id.localeCompare(second.id)
  )) : ports;
}

function nodeDimensions(device: ResolvedDevice, ports: readonly DiagramPort[], abstractJunction: boolean) {
  if (isDiagramJoin(device)) {
    if (device.diagramJoinGeometry === "orthogonal-t") return { width: 72, height: 72 };
    const edgeCount = Math.max(1,
      ports.filter((port) => port.side === "input").length,
      ports.filter((port) => port.side === "output").length);
    return { width: 96, height: snapUp(Math.max(72, (edgeCount - 1) * 36 + 48)) };
  }
  if (device.presentation === "rigid-rail") {
    return { width: snapUp(Math.max(216, ports.length * PORT_PITCH + 48)), height: 72 };
  }
  const [baseWidth, baseHeight] = baseSizeByKind[device.kind];
  const inputCount = ports.filter((port) => port.side === "input").length;
  const outputCount = ports.filter((port) => port.side === "output").length;
  const bottomCount = ports.filter((port) => port.side === "neutral").length;
  const topCount = ports.filter((port) => port.side === "top").length;
  const longestText = device.label.length;
  const densityWidth = 120 + Math.ceil(Math.sqrt(Math.max(1, ports.length))) * 36;
  const sidePitch = abstractJunction || device.presentation === "wall-passthrough"
    ? ABSTRACT_GLAND_PITCH : PORT_PITCH;
  return {
    width: snapUp(Math.max(baseWidth, longestText * 7.2 + 48,
      Math.max(bottomCount, topCount) * (abstractJunction ? ABSTRACT_GLAND_PITCH : PORT_PITCH) + 48,
      densityWidth, abstractJunction ? 264 : 0)),
    height: snapUp(Math.max(baseHeight, Math.max(inputCount, outputCount) * sidePitch + 60)),
  };
}

function nodePortPitch(node: DiagramNode) {
  if (isDiagramJoin(node.device)) return 36;
  return node.abstractJunction || node.device.presentation === "wall-passthrough"
    ? ABSTRACT_GLAND_PITCH : PORT_PITCH;
}

function portPoint(node: DiagramNode, port: DiagramPort): Point {
  const peers = node.ports.filter((candidate) => candidate.side === port.side);
  const index = peers.findIndex((candidate) => candidate.id === port.id);
  const pitch = nodePortPitch(node);
  const offset = port.offset ?? (index - (peers.length - 1) / 2) * pitch;
  if (port.side === "input") return { x: node.x - node.width / 2, y: node.y + offset };
  if (port.side === "output") return { x: node.x + node.width / 2, y: node.y + offset };
  if (port.side === "top") return { x: node.x + offset, y: node.y - node.height / 2 };
  return { x: node.x + offset, y: node.y + node.height / 2 };
}

function outwardVector(side: PortSide): Point {
  if (side === "input") return { x: -1, y: 0 };
  if (side === "output") return { x: 1, y: 0 };
  if (side === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function prepareWorldNode(device: ResolvedDevice, ports: DiagramPort[]) {
  const abstractJunction = device.kind === "junction";
  const { width, height } = nodeDimensions(device, ports, abstractJunction);
  return {
    device, ports, width, height, abstractJunction,
    x: 0,
    y: 0,
  } satisfies DiagramNode;
}

type WorldLane = "pv" | "ac" | "earth" | "dc" | "network" | "lighting" | "usb12" | "usb24" | "misc" | "battery" | "core";
type DcRole = "cutoff" | "main-distribution" | "secondary-distribution";

const WORLD_LANES: readonly WorldLane[] = ["pv", "ac", "earth", "dc", "battery", "network", "lighting", "usb12", "usb24", "misc"];
const DC_ROLE_BY_COMPONENT = new Map<string, DcRole>([
  ["batteryCutoff", "cutoff"],
  ["mainDistribution", "main-distribution"],
  ["secondaryDistribution", "secondary-distribution"],
]);
const DC_STAGE_BY_ROLE: Readonly<Record<DcRole, number>> = {
  cutoff: 5,
  "main-distribution": 6,
  "secondary-distribution": 7,
};

function attachedDevice(device: ResolvedDevice) {
  if (!device.attachment) return undefined;
  return dseRuntime.deviceById.get(endpointDeviceId(device.attachment.endpoint));
}

function dcRole(device: ResolvedDevice): DcRole | undefined {
  const ownRole = device.componentId ? DC_ROLE_BY_COMPONENT.get(device.componentId) : undefined;
  if (ownRole) return ownRole;
  const attached = attachedDevice(device);
  return attached ? dcRole(attached) : undefined;
}

/** Logical circuit bands come from canonical component roles, never from the
 * physical wall coordinates. This keeps the patcher electrical: generation is
 * left/top, consumers are right, and the storage bank is below the core. */
function worldLane(device: ResolvedDevice): WorldLane {
  const attached = attachedDevice(device);
  if (attached) return worldLane(attached);
  if (device.kind === "battery" || device.componentId === "balancers") return "battery";
  if (device.kind === "panel" || device.componentId === "pvSafety" || device.componentId === "solarController") return "pv";
  if (["generator", "acBoard", "inverter", "toolOutlet"].includes(device.componentId ?? "")) return "ac";
  if (["earth", "earthBus"].includes(device.componentId ?? "")) return "earth";
  if (dcRole(device)) return "dc";
  if (["systemMonitor", "starlink", "router"].includes(device.componentId ?? "")) return "network";
  if (["switchedSplit", "roomSwitch", "indoorLight", "outdoorLight"].includes(device.componentId ?? "")) return "lighting";
  if (device.componentId === "orionUsb" || device.componentId === "usb") {
    return device.layoutGroup?.id === "chargeit-minis" ? "usb24" : "usb12";
  }
  if (device.componentId === "mounting" || device.presentation === "wall-passthrough") return "core";
  return "misc";
}

function groupedOrder(device: ResolvedDevice) {
  return device.layoutGroup?.order ?? Number.MAX_SAFE_INTEGER;
}

/** Return the one device receiving every individual core from a breakout.
 * The sheath route is deliberately excluded: it belongs on the other side of
 * the transition and may terminate at a junction boundary. */
function exclusiveBreakoutCorePeer(device: ResolvedDevice) {
  if (device.presentation !== "cable-breakout") return undefined;
  const coreEndpointIds = device.conductors.filter((conductor) => conductor.kind !== "multicore")
    .map((conductor) => `${device.id}.${conductor.id}`);
  const peerIds = coreEndpointIds.flatMap((endpointId) => connectionsFor(endpointId).flatMap((route) => {
    const peerEndpoint = route.from === endpointId ? route.to : route.from;
    return [endpointDeviceId(peerEndpoint)];
  }));
  if (peerIds.length !== coreEndpointIds.length || new Set(peerIds).size !== 1) return undefined;
  return dseRuntime.deviceById.get(peerIds[0]);
}

function worldStage(device: ResolvedDevice) {
  const lane = worldLane(device);
  if (device.presentation === "wall-passthrough") return 3;
  if (lane === "core") return device.kind === "junction" ? 6 : 5;
  const role = dcRole(device);
  if (role) return DC_STAGE_BY_ROLE[role];
  if (lane === "pv") {
    if (device.kind === "panel") return groupedOrder(device) % (device.layoutGroup?.columns ?? 2);
    if (device.componentId === "pvSafety") return 4;
    if (device.componentId === "solarController") return 5;
  }
  if (lane === "ac") {
    if (device.kind === "generator") return 0;
    if (device.presentation === "cable-breakout" && dseRuntime.routes.some((route) => {
      const endpoints = [route.from, route.to];
      if (!endpoints.some((endpoint) => endpointDeviceId(endpoint) === device.id)) return false;
      return endpoints.some((endpoint) => (
        dseRuntime.deviceById.get(endpointDeviceId(endpoint))?.kind === "generator"
      ));
    })) return 1;
    // The protected external-AC assembly shares the late-service column with
    // network loads. Keeping its junction at that stage centers the complete
    // generator -> protection -> outlet corridor over the same X datum as the
    // router instead of exiling the assembly beyond the rest of the drawing.
    if (device.kind === "junction") return 8;
    if (device.kind === "inverter") return 6;
    if (device.componentId === "toolOutlet") return 9;
    if (device.presentation === "cable-breakout") {
      const peer = exclusiveBreakoutCorePeer(device);
      const load = peer?.kind === "load" ? peer : undefined;
      return load ? Math.max(0, worldStage(load) - 1) : /AC-out/i.test(device.label) ? 7 : 5;
    }
  }
  if (lane === "earth") return device.kind === "earth" && device.conductors.length === 1 ? 0 : 5;
  if (lane === "network") {
    if (device.componentId === "systemMonitor") return 7;
    if (device.componentId === "router") return 8;
    if (device.componentId === "starlink") return 10;
  }
  if (lane === "lighting") {
    if (device.componentId === "roomSwitch") return 7;
    if (device.componentId === "switchedSplit") return 8;
    return device.componentId === "outdoorLight" ? 10 : 9;
  }
  if (lane === "usb12") {
    if (device.componentId === "orionUsb") return 7;
    if (device.layoutGroup?.id === "coolgear-145") return 9 + groupedOrder(device);
    if (device.kind === "connector") return /\bB\b/.test(device.label) ? 9 : 8;
  }
  if (lane === "usb24") return 7 + groupedOrder(device);
  if (lane === "battery") {
    if (device.kind === "battery") return 5 + (groupedOrder(device) % 2) * 2;
    return 6;
  }
  return device.kind === "load" ? 9 : device.kind === "converter" ? 6 : 7;
}

function familyRowOffset(device: ResolvedDevice, nodeHeight: number) {
  const group = device.layoutGroup;
  if (!group || ["battery-bank", "chargeit-minis", "coolgear-145"].includes(group.id)) return 0;
  const members = dseRuntime.devices.filter((candidate) => candidate.layoutGroup?.id === group.id);
  const memberCount = members.length;
  const rows = Math.ceil(memberCount / group.columns);
  const row = Math.floor(group.order / group.columns);
  const rowPitch = Math.max(nodeHeight, ...members.map((member) => {
    const ports = devicePorts(member); return nodeDimensions(member, ports, member.kind === "junction").height;
  })) + 84;
  return (row - (rows - 1) / 2) * rowPitch;
}

function preferredLaneOffset(node: DiagramNode) {
  if (node.device.layoutGroup?.id === "coolgear-145") return 156;
  if (worldLane(node.device) === "usb12") return -60;
  const breakoutPeer = exclusiveBreakoutCorePeer(node.device);
  if (worldLane(node.device) === "ac"
    && (node.device.kind === "inverter" || breakoutPeer?.kind === "inverter")) {
    return AC_CONVERSION_ROW_OFFSET;
  }
  return familyRowOffset(node.device, node.height);
}

type ExternalAcCorridorArm = { breakout: DiagramNode; peer: DiagramNode };
type ExternalAcCorridor = {
  junction: DiagramNode;
  source: ExternalAcCorridorArm;
  load: ExternalAcCorridorArm;
};

function externalAcCorridors(nodes: readonly DiagramNode[], seeds: readonly WireSeed[]) {
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  return nodes.filter((node) => worldLane(node.device) === "ac" && node.device.kind === "junction")
    .flatMap((junction): ExternalAcCorridor[] => {
      const connectedBreakouts = nodes.flatMap((breakout) => {
        const peer = exclusiveBreakoutCorePeer(breakout.device);
        const peerNode = peer ? nodeById.get(peer.id) : undefined;
        const cableEndpoint = `${breakout.device.id}.cable`;
        const reachesJunction = seeds.some((seed) => (
          (seed.fromEndpointId === cableEndpoint && seed.toEndpointId.startsWith(`${junction.device.id}::`))
          || (seed.toEndpointId === cableEndpoint && seed.fromEndpointId.startsWith(`${junction.device.id}::`))
        ));
        return peerNode && reachesJunction ? [{ breakout, peer: peerNode }] : [];
      });
      const source = connectedBreakouts.find((entry) => entry.peer.device.kind === "generator");
      const load = connectedBreakouts.find((entry) => entry.peer.device.kind === "load");
      return source && load ? [{ junction, source, load }] : [];
    });
}

/** Keep the two three-core MultiPlus transitions immediately beside the
 * inverter. The core-facing side tells us which flank owns the breakout, so
 * this remains topology-derived rather than depending on device IDs. */
function placeInverterAcBreakouts(nodes: readonly DiagramNode[]) {
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  nodes.forEach((breakout) => {
    const peer = exclusiveBreakoutCorePeer(breakout.device);
    const inverter = peer?.kind === "inverter" ? nodeById.get(peer.id) : undefined;
    if (!inverter) return;
    const coreSides = new Set(breakout.ports.filter((port) => port.kind !== "multicore")
      .map((port) => port.side));
    const direction = coreSides.size === 1 && coreSides.has("output") ? -1
      : coreSides.size === 1 && coreSides.has("input") ? 1 : undefined;
    if (!direction) return;
    breakout.x = snap(inverter.x + direction * (
      inverter.width / 2 + INVERTER_BREAKOUT_GAP + breakout.width / 2
    ));
    breakout.y = inverter.y;
  });
}

function mean(values: readonly number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function attachedNodeDirection(owner: DiagramNode, attached: DiagramNode) {
  const batteryJoin = worldLane(owner.device) === "battery";
  const negative = /\.negative$/i.test(attached.device.attachment!.endpoint);
  return batteryJoin && negative ? -1 : 1;
}

function attachedNodeGap(owner: DiagramNode) {
  return worldLane(owner.device) === "battery" ? BATTERY_JOIN_GAP : ATTACHED_JOIN_GAP;
}

/** Devices with one logical role often share a diagram stage. Keep their
 * preferred family offsets when they already fit, and otherwise spread the
 * colliding peers as one centered stack. This is deliberately lane/stage and
 * conductor driven: exposed busbars, monitors, or future repeated equipment
 * do not need device-ID placement exceptions. */
function collisionFreeLaneOffsets(members: readonly DiagramNode[]) {
  const preferredById = new Map(members.map((node) => [node.device.id, preferredLaneOffset(node)]));
  const offsetById = new Map(preferredById);
  const electricalOrder = (node: DiagramNode) => {
    const kinds = new Set(node.ports.map((port) => port.kind));
    const positive = kinds.has("positive"); const negative = kinds.has("negative");
    if (positive && !negative) return 0;
    if (positive && negative) return 1;
    if (negative && !positive) return 2;
    return 3;
  };
  Map.groupBy(members, (node) => worldStage(node.device)).forEach((stageMembers) => {
    if (stageMembers.length < 2) return;
    const ordered = stageMembers.toSorted((first, second) => (
      preferredById.get(first.device.id)! - preferredById.get(second.device.id)!
      || electricalOrder(first) - electricalOrder(second)
      || first.device.label.localeCompare(second.device.label)
      || first.device.id.localeCompare(second.device.id)
    ));
    const gap = WORLD_STAGE_STACK_GAP;
    const collides = ordered.slice(1).some((node, index) => (
      preferredById.get(node.device.id)! - node.height / 2
      < preferredById.get(ordered[index].device.id)! + ordered[index].height / 2 + gap
    ));
    if (!collides) return;
    const centers: number[] = [];
    ordered.forEach((node, index) => {
      const preferred = preferredById.get(node.device.id)!;
      centers[index] = index === 0 ? preferred : Math.max(
        preferred,
        centers[index - 1] + ordered[index - 1].height / 2 + gap + node.height / 2,
      );
    });
    const centerShift = mean(ordered.map((node) => preferredById.get(node.device.id)!)) - mean(centers);
    ordered.forEach((node, index) => offsetById.set(node.device.id, snap(centers[index] + centerShift)));
  });
  return members.map((node) => offsetById.get(node.device.id)!);
}

function layoutWorldNodes(nodes: DiagramNode[], seeds: readonly WireSeed[]) {
  const primary = nodes.filter((node) => !(node.device.presentation === "wire-join" && node.device.attachment));
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  const attachedNodesByOwner = Map.groupBy(nodes.filter((node) => node.device.presentation === "wire-join"), (node) => (
    endpointDeviceId(node.device.attachment!.endpoint)
  ));
  const attachedReach = (ownerId: string, direction: -1 | 1, visited = new Set<string>()): number => {
    if (visited.has(ownerId)) return 0;
    const owner = nodeById.get(ownerId);
    if (!owner) return 0;
    const nextVisited = new Set(visited); nextVisited.add(ownerId);
    return Math.max(0, ...(attachedNodesByOwner.get(ownerId) ?? []).flatMap((attached) => (
      attachedNodeDirection(owner, attached) === direction
        ? [attachedNodeGap(owner) + attached.width + attachedReach(attached.device.id, direction, nextVisited)]
        : []
    )));
  };
  // The battery bank is a compact local assembly below the DC distribution
  // sequence, not another set of global flow columns. Excluding it here keeps
  // battery attachments from needlessly widening every stage-to-stage gap.
  const flowNodes = primary.filter((node) => worldLane(node.device) !== "battery");
  const stageById = new Map(flowNodes.map((node) => [node.device.id, worldStage(node.device)]));
  const maxStage = Math.max(...stageById.values());
  const columnWidths = Array.from({ length: maxStage + 1 }, (_, stage) => Math.max(144,
    ...flowNodes.filter((node) => stageById.get(node.device.id) === stage).map((node) => node.width)));
  const columnCenters: number[] = [];
  columnWidths.reduce((cursor, width, stage) => {
    columnCenters[stage] = cursor + width / 2;
    const baseGap = stage >= 7 && stage <= 9 ? 240 : WORLD_COLUMN_GAP;
    const rightReach = Math.max(0, ...flowNodes
      .filter((node) => stageById.get(node.device.id) === stage)
      .map((node) => attachedReach(node.device.id, 1)));
    const gap = Math.max(baseGap, rightReach + ROUTE_LEAD + GRID * 4);
    return cursor + width + gap;
  }, LAYOUT_MARGIN);
  flowNodes.forEach((node) => { node.x = snap(columnCenters[stageById.get(node.device.id)!]); });
  externalAcCorridors(flowNodes, seeds).forEach(({ junction, source, load }) => {
      source.breakout.x = snap(junction.x - junction.width / 2
        - EXTERNAL_AC_JUNCTION_GAP - source.breakout.width / 2);
      source.peer.x = snap(source.breakout.x - source.breakout.width / 2
        - ATTACHED_JOIN_GAP - source.peer.width / 2);
      load.breakout.x = snap(junction.x + junction.width / 2
        + EXTERNAL_AC_JUNCTION_GAP + load.breakout.width / 2);
      load.peer.x = snap(load.breakout.x + load.breakout.width / 2
        + ATTACHED_JOIN_GAP + load.peer.width / 2);
    });

  const laneCenters = new Map<WorldLane, number>();
  let cursor = LAYOUT_MARGIN;
  WORLD_LANES.forEach((lane) => {
    const members = primary.filter((node) => worldLane(node.device) === lane);
    if (!members.length) return;
    if (lane === "battery") {
      const gridMembers = members.filter((node) => node.device.kind === "battery")
        .toSorted((first, second) => groupedOrder(first.device) - groupedOrder(second.device));
      const auxiliaryMembers = members.filter((node) => node.device.kind !== "battery")
        .toSorted((first, second) => first.device.label.localeCompare(second.device.label)
          || first.device.id.localeCompare(second.device.id));
      const columns = Math.max(1, Math.min(
        gridMembers.length,
        gridMembers[0]?.device.layoutGroup?.columns ?? Math.ceil(Math.sqrt(gridMembers.length)),
      ));
      const rows = Math.max(1, Math.ceil(gridMembers.length / columns));
      const cellByNode = new Map(gridMembers.map((node, index) => [node.device.id, {
        column: index % columns,
        row: Math.floor(index / columns),
      }]));
      const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(0,
        ...gridMembers.filter((node) => cellByNode.get(node.device.id)!.column === column)
          .map((node) => node.width)));
      const columnLeftReach = Array.from({ length: columns }, (_, column) => Math.max(0,
        ...gridMembers.filter((node) => cellByNode.get(node.device.id)!.column === column)
          .map((node) => attachedReach(node.device.id, -1))));
      const columnRightReach = Array.from({ length: columns }, (_, column) => Math.max(0,
        ...gridMembers.filter((node) => cellByNode.get(node.device.id)!.column === column)
          .map((node) => attachedReach(node.device.id, 1))));
      const columnCenters: number[] = [];
      columnCenters[0] = columnLeftReach[0] + columnWidths[0] / 2;
      for (let column = 1; column < columns; column += 1) {
        columnCenters[column] = columnCenters[column - 1]
          + columnWidths[column - 1] / 2 + columnRightReach[column - 1]
          + WORLD_STAGE_STACK_GAP + columnLeftReach[column] + columnWidths[column] / 2;
      }

      const auxiliariesByRow = Array.from({ length: rows }, () => [] as DiagramNode[]);
      auxiliaryMembers.forEach((node, index) => auxiliariesByRow[index % rows].push(node));
      const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(0,
        ...gridMembers.filter((node) => cellByNode.get(node.device.id)!.row === row).map((node) => node.height),
        ...auxiliariesByRow[row].map((node) => node.height)));
      const rowCenters: number[] = [];
      rowCenters[0] = rowHeights[0] / 2;
      for (let row = 1; row < rows; row += 1) {
        rowCenters[row] = rowCenters[row - 1]
          + rowHeights[row - 1] / 2 + WORLD_STAGE_STACK_GAP + rowHeights[row] / 2;
      }

      const localPositionById = new Map<string, Point>();
      gridMembers.forEach((node) => {
        const cell = cellByNode.get(node.device.id)!;
        localPositionById.set(node.device.id, { x: columnCenters[cell.column], y: rowCenters[cell.row] });
      });
      const bankRight = Math.max(0, ...gridMembers.map((node) => {
        const cell = cellByNode.get(node.device.id)!;
        return columnCenters[cell.column] + node.width / 2 + attachedReach(node.device.id, 1);
      }));
      auxiliariesByRow.forEach((rowMembers, row) => {
        // Leave a full terminal-lead corridor between the bank's attached
        // joins and row auxiliaries. The extra pitch lets multiple conductors
        // turn independently instead of sharing the only twelve-pixel lane.
        let rowCursor = bankRight + WORLD_STAGE_STACK_GAP + GRID * 2;
        rowMembers.forEach((node) => {
          const leftReach = attachedReach(node.device.id, -1);
          const rightReach = attachedReach(node.device.id, 1);
          const x = rowCursor + leftReach + node.width / 2;
          localPositionById.set(node.device.id, { x, y: rowCenters[row] });
          rowCursor = x + node.width / 2 + rightReach + WORLD_STAGE_STACK_GAP;
        });
      });

      const localLeft = Math.min(...members.map((node) => {
        const local = localPositionById.get(node.device.id)!;
        return local.x - node.width / 2 - attachedReach(node.device.id, -1);
      }));
      const localRight = Math.max(...members.map((node) => {
        const local = localPositionById.get(node.device.id)!;
        return local.x + node.width / 2 + attachedReach(node.device.id, 1);
      }));
      const dcMembers = primary.filter((node) => worldLane(node.device) === "dc");
      const dcLeft = Math.min(...dcMembers.map((node) => (
        node.x - node.width / 2 - attachedReach(node.device.id, -1)
      )));
      const dcRight = Math.max(...dcMembers.map((node) => (
        node.x + node.width / 2 + attachedReach(node.device.id, 1)
      )));
      const horizontalShift = snap((dcLeft + dcRight - localLeft - localRight) / 2);
      const verticalShift = snap(cursor);
      const gridLocalLeft = Math.min(...gridMembers.map((node) => {
        const local = localPositionById.get(node.device.id)!;
        return local.x - node.width / 2 - attachedReach(node.device.id, -1);
      }));
      const gridLocalRight = Math.max(...gridMembers.map((node) => {
        const local = localPositionById.get(node.device.id)!;
        return local.x + node.width / 2 + attachedReach(node.device.id, 1);
      }));
      const cutoffMembers = dcMembers.filter((node) => dcRole(node.device) === "cutoff");
      const cutoffCenter = cutoffMembers.length > 0
        ? mean(cutoffMembers.map((node) => node.x))
        : (dcLeft + dcRight) / 2;
      const gridHorizontalShift = snap(cutoffCenter - (gridLocalLeft + gridLocalRight) / 2);
      const dcBottom = Math.max(...dcMembers.map((node) => node.y + node.height / 2));
      const attachmentHalfHeight = Math.max(0, ...gridMembers.map((node) => (
        Math.max(0, ...(attachedNodesByOwner.get(node.device.id) ?? []).map((join) => join.height / 2))
      )));
      const gridVerticalShift = snap(dcBottom + attachmentHalfHeight + GRID - rowCenters[0]);
      members.forEach((node) => {
        const local = localPositionById.get(node.device.id)!;
        const isBattery = node.device.kind === "battery";
        node.x = snap((isBattery ? gridHorizontalShift : horizontalShift) + local.x);
        node.y = snap((isBattery ? gridVerticalShift : verticalShift) + local.y);
      });
      const laneBottom = Math.max(...members.map((node) => node.y + node.height / 2));
      laneCenters.set(lane, snap((verticalShift + laneBottom) / 2));
      cursor = laneBottom + WORLD_LANE_GAP;
      return;
    }
    const offsets = collisionFreeLaneOffsets(members);
    const top = Math.min(...members.map((node, index) => offsets[index] - node.height / 2));
    const bottom = Math.max(...members.map((node, index) => offsets[index] + node.height / 2));
    const center = snap(cursor - top);
    laneCenters.set(lane, center);
    members.forEach((node, index) => { node.y = snap(center + offsets[index]); });
    cursor = center + bottom + (lane === "dc" ? GRID * 8 : WORLD_LANE_GAP);
  });

  const service = primary.find((node) => node.device.presentation === "wall-passthrough");
  if (service) service.y = snap(mean(["pv", "ac", "earth"].flatMap((lane) => {
    const center = laneCenters.get(lane as WorldLane); return center === undefined ? [] : [center];
  })));
  const main = primary.find((node) => worldLane(node.device) === "core" && node.device.kind === "junction");
  if (main) main.y = snap(mean(["network", "lighting", "usb12", "usb24"].flatMap((lane) => {
    const center = laneCenters.get(lane as WorldLane); return center === undefined ? [] : [center];
  })));
  primary.filter((node) => worldLane(node.device) === "core" && node !== service && node !== main)
    .forEach((node) => { node.y = laneCenters.get("misc") ?? main?.y ?? cursor; });

  attachedNodesByOwner.forEach((joins, ownerId) => {
    const owner = nodeById.get(ownerId);
    if (!owner) return;
    const ordered = joins.toSorted((first, second) => first.device.attachment!.endpoint.localeCompare(second.device.attachment!.endpoint));
    const byDirection = Map.groupBy(ordered, (join) => attachedNodeDirection(owner, join));
    byDirection.forEach((directionJoins, direction) => {
      const gapY = GRID * 2;
      const totalHeight = directionJoins.reduce((sum, join) => sum + join.height, 0)
        + Math.max(0, directionJoins.length - 1) * gapY;
      let top = owner.y - totalHeight / 2;
      directionJoins.forEach((join) => {
        const gap = attachedNodeGap(owner);
        join.x = snap(owner.x + direction * (owner.width / 2 + gap + join.width / 2));
        join.y = snap(top + join.height / 2);
        top += join.height + gapY;
      });
    });
  });

  placeInverterAcBreakouts(nodes);
  externalAcCorridors(nodes, seeds).forEach(({ junction, source, load }) => {
    [source.peer, source.breakout, load.breakout, load.peer].forEach((node) => {
      node.y = junction.y;
    });
  });
  nodes.forEach((node) => { node.x = snap(node.x); node.y = snap(node.y); });
  orientAttachedJoinPorts(nodes);
  return normalizeNodes(nodes);
}

function normalizeNodes(nodes: DiagramNode[], margin = LAYOUT_MARGIN) {
  const minX = Math.min(...nodes.map((node) => node.x - node.width / 2));
  const minY = Math.min(...nodes.map((node) => node.y - node.height / 2));
  const shiftX = snap(margin - minX);
  const shiftY = snap(LAYOUT_MARGIN - minY);
  nodes.forEach((node) => { node.x += shiftX; node.y += shiftY; });
  return nodes;
}

function layoutJunctionNodes(devices: readonly ResolvedDevice[], seeds: readonly WireSeed[]) {
  const orderedDevices = devices.toSorted((first, second) => {
    const firstSection = first.placement.space === "junction" && first.placement.section === "din" ? 1 : 0;
    const secondSection = second.placement.space === "junction" && second.placement.section === "din" ? 1 : 0;
    const firstOrder = first.placement.space === "junction" ? first.placement.order : 0;
    const secondOrder = second.placement.space === "junction" ? second.placement.order : 0;
    return firstSection - secondSection || firstOrder - secondOrder || first.id.localeCompare(second.id);
  });
  const nodes = orderedDevices.map((device): DiagramNode => {
    const ports = devicePorts(device);
    return { device, ports, ...nodeDimensions(device, ports, false), x: 0, y: 0, abstractJunction: false };
  });
  const attachedNodes = nodes.filter((node) => node.device.presentation === "wire-join"
    && node.device.diagramJoinGeometry === "orthogonal-t" && node.device.attachment);
  const layoutNodes = nodes.filter((node) => !attachedNodes.includes(node));
  const nodeIds = new Set(layoutNodes.map((node) => node.device.id));
  const adjacency = new Map(layoutNodes.map((node) => [node.device.id, new Set<string>()]));
  const reverse = new Map(layoutNodes.map((node) => [node.device.id, new Set<string>()]));
  seeds.filter((seed) => seed.route.kind !== "earth" && seed.route.kind !== "data").forEach((seed) => {
    const from = endpointDeviceId(seed.fromEndpointId); const to = endpointDeviceId(seed.toEndpointId);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return;
    adjacency.get(from)!.add(to); reverse.get(to)!.add(from);
  });

  // Collapse any real electrical loop before assigning left-to-right ranks.
  // The ranker is generic for every enclosure and does not encode device IDs.
  let nextIndex = 0;
  const indexById = new Map<string, number>(); const lowById = new Map<string, number>();
  const stack: string[] = []; const stacked = new Set<string>(); const components: string[][] = [];
  const visit = (id: string) => {
    indexById.set(id, nextIndex); lowById.set(id, nextIndex); nextIndex += 1;
    stack.push(id); stacked.add(id);
    adjacency.get(id)!.forEach((neighbor) => {
      if (!indexById.has(neighbor)) { visit(neighbor); lowById.set(id, Math.min(lowById.get(id)!, lowById.get(neighbor)!)); }
      else if (stacked.has(neighbor)) lowById.set(id, Math.min(lowById.get(id)!, indexById.get(neighbor)!));
    });
    if (lowById.get(id) !== indexById.get(id)) return;
    const component: string[] = [];
    while (stack.length) {
      const member = stack.pop()!; stacked.delete(member); component.push(member);
      if (member === id) break;
    }
    components.push(component);
  };
  layoutNodes.forEach((node) => { if (!indexById.has(node.device.id)) visit(node.device.id); });
  const componentById = new Map<string, number>();
  components.forEach((component, index) => component.forEach((id) => componentById.set(id, index)));
  const componentEdges = components.map(() => new Set<number>()); const indegree = components.map(() => 0);
  adjacency.forEach((targets, from) => targets.forEach((to) => {
    const fromComponent = componentById.get(from)!; const toComponent = componentById.get(to)!;
    if (fromComponent === toComponent || componentEdges[fromComponent].has(toComponent)) return;
    componentEdges[fromComponent].add(toComponent); indegree[toComponent] += 1;
  }));
  const componentRank = components.map(() => 0);
  const queue = indegree.map((value, index) => ({ value, index })).filter(({ value }) => value === 0).map(({ index }) => index);
  while (queue.length) {
    const component = queue.shift()!;
    componentEdges[component].forEach((target) => {
      componentRank[target] = Math.max(componentRank[target], componentRank[component] + 1);
      indegree[target] -= 1; if (indegree[target] === 0) queue.push(target);
    });
  }
  const rankById = new Map(layoutNodes.map((node) => [node.device.id, componentRank[componentById.get(node.device.id)!]]));
  const rankCount = Math.max(...rankById.values()) + 1;
  const columns = Array.from({ length: rankCount }, (_, rank) => layoutNodes.filter((node) => rankById.get(node.device.id) === rank));
  const physicalOrder = new Map(orderedDevices.map((device, index) => [device.id, index]));
  const position = new Map<string, number>();
  const refreshPositions = () => columns.forEach((column) => column.forEach((node, index) => position.set(node.device.id, index)));
  refreshPositions();
  const barycenter = (ids: ReadonlySet<string>) => mean([...ids].flatMap((id) => {
    const value = position.get(id); return value === undefined ? [] : [value];
  }));
  for (let iteration = 0; iteration < 8; iteration += 1) {
    for (let rank = 1; rank < columns.length; rank += 1) {
      columns[rank].sort((first, second) => barycenter(reverse.get(first.device.id)!) - barycenter(reverse.get(second.device.id)!)
        || physicalOrder.get(first.device.id)! - physicalOrder.get(second.device.id)!);
      refreshPositions();
    }
    for (let rank = columns.length - 2; rank >= 0; rank -= 1) {
      columns[rank].sort((first, second) => barycenter(adjacency.get(first.device.id)!) - barycenter(adjacency.get(second.device.id)!)
        || physicalOrder.get(first.device.id)! - physicalOrder.get(second.device.id)!);
      refreshPositions();
    }
  }
  const columnWidths = columns.map((column) => Math.max(...column.map((node) => node.width)));
  if (attachedNodes.length > 0) {
    const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
    const childrenByOwner = Map.groupBy(attachedNodes, (node) => endpointDeviceId(node.device.attachment!.endpoint));
    const verticalOffsetById = new Map<string, number>();
    const subtreeBottom = (owner: DiagramNode, ownerOffset: number, visited = new Set<string>()): number => {
      if (visited.has(owner.device.id)) throw new Error(`Junction attachment cycle includes ${owner.device.id}.`);
      const nextVisited = new Set(visited); nextVisited.add(owner.device.id);
      let cursor = ownerOffset + owner.height / 2;
      (childrenByOwner.get(owner.device.id) ?? [])
        .toSorted((first, second) => first.device.id.localeCompare(second.device.id))
        .forEach((child) => {
          const center = cursor + JUNCTION_ATTACHED_JOIN_GAP + child.height / 2;
          verticalOffsetById.set(child.device.id, center);
          cursor = subtreeBottom(child, center, nextVisited);
        });
      return cursor;
    };
    const macroBounds = new Map(layoutNodes.map((node) => {
      verticalOffsetById.set(node.device.id, 0);
      return [node.device.id, { top: -node.height / 2, bottom: subtreeBottom(node, 0) }] as const;
    }));
    const columnCenters: number[] = [];
    columnWidths.reduce((cursor, width, rank) => {
      columnCenters[rank] = cursor + width / 2; return cursor + width + JUNCTION_COLUMN_GAP;
    }, LAYOUT_MARGIN);
    columns.forEach((column, rank) => column.forEach((node) => { node.x = snap(columnCenters[rank]); }));

    // If a tap chain receives a bottom-edge earth trunk, keep its spine in a
    // dedicated lane between two source rows. The upstream breakout moves to
    // the minimum terminal-lead margin; later breakout macros move beyond the
    // spine. The trunk can then cross only their incoming cable, rather than
    // detouring around the breakout body, L/N conductors, and another tee.
    const tapRoots = layoutNodes.filter((node) => childrenByOwner.has(node.device.id));
    const trunkRootIds = new Set(seeds.filter((seed) => seed.route.kind === "earth"
      && (seed.fromEndpointId.startsWith("boundary::") || seed.toEndpointId.startsWith("boundary::")))
      .flatMap((seed) => {
        const internalEndpoint = seed.fromEndpointId.startsWith("boundary::")
          ? seed.toEndpointId : seed.fromEndpointId;
        const owner = nodeById.get(endpointDeviceId(internalEndpoint));
        return owner?.device.attachment ? [attachmentRoot(owner.device).id] : [];
      }));
    let compactLeftMargin = false;
    trunkRootIds.forEach((trunkRootId) => {
      const trunkRoot = nodeById.get(trunkRootId);
      if (!trunkRoot) return;
      const rank = rankById.get(trunkRootId);
      const column = rank === undefined ? undefined : columns[rank];
      if (!column || !column.every((node) => tapRoots.includes(node))) return;
      trunkRoot.x = snap(ROUTE_LEAD * 2 + trunkRoot.width / 2);
      const firstAttached = childrenByOwner.get(trunkRootId)![0];
      const attachmentPort = trunkRoot.ports.find((port) => (
        port.endpointId === firstAttached.device.attachment!.endpoint
      ))!;
      const attachmentPoint = portPoint(trunkRoot, attachmentPort);
      const attachmentOutward = outwardVector(attachmentPort.side);
      const trunkX = snap(attachmentPoint.x + attachmentOutward.x * ROUTE_LEAD);
      let nextLeft = trunkX + GRID * 2;
      column.filter((node) => node !== trunkRoot).forEach((node) => {
        node.x = snap(nextLeft + node.width / 2);
        nextLeft = node.x + node.width / 2 + JUNCTION_COLUMN_GAP;
      });
      compactLeftMargin = true;
    });

    columns.forEach((column, rank) => {
      let cursor = LAYOUT_MARGIN;
      column.forEach((node) => {
        const bounds = macroBounds.get(node.device.id)!;
        const positionedPredecessors = [...reverse.get(node.device.id)!]
          .flatMap((id) => nodeById.get(id)?.y ? [nodeById.get(id)!.y] : []);
        const desired = positionedPredecessors.length ? mean(positionedPredecessors) : cursor - bounds.top;
        node.y = snap(Math.max(desired, cursor - bounds.top));
        cursor = node.y + bounds.bottom + JUNCTION_ROW_GAP;
      });
      // A source column establishes row coordinates. Later ranks inherit the
      // barycenter of their already positioned predecessors, so an enclosure
      // with two independent L/N paths becomes two aligned rows instead of
      // three independently centered stacks.
      if (rank > 0) {
        column.forEach((node) => {
          const predecessors = [...reverse.get(node.device.id)!].flatMap((id) => {
            const predecessor = nodeById.get(id); return predecessor ? [predecessor.y] : [];
          });
          if (predecessors.length) node.y = snap(mean(predecessors));
        });
        cursor = LAYOUT_MARGIN;
        column.forEach((node) => {
          const bounds = macroBounds.get(node.device.id)!;
          node.y = snap(Math.max(node.y, cursor - bounds.top));
          cursor = node.y + bounds.bottom + JUNCTION_ROW_GAP;
        });
      }
    });
    attachedNodes.forEach((node) => {
      const root = attachmentRoot(node.device);
      const rootNode = nodeById.get(root.id);
      if (!rootNode) throw new Error(`${node.device.id}: attached junction root ${root.id} is outside the subpatch.`);
      const firstAttached = (childrenByOwner.get(root.id) ?? [])[0];
      const attachmentPort = firstAttached && rootNode.ports.find((port) => (
        port.endpointId === firstAttached.device.attachment!.endpoint
      ));
      const attachmentPoint = attachmentPort ? portPoint(rootNode, attachmentPort) : { x: rootNode.x, y: rootNode.y };
      const attachmentOutward = attachmentPort ? outwardVector(attachmentPort.side) : { x: 0, y: 1 };
      node.x = snap(attachmentPoint.x + attachmentOutward.x * ROUTE_LEAD);
      node.y = snap(rootNode.y + verticalOffsetById.get(node.device.id)!);
    });
    // An attached orthogonal tee can absorb the bend of an upward branch:
    // move the deepest tee in its continuous chain onto the X coordinate of
    // the peer's bottom/top port. In a multi-tee chain it shares its parent's
    // row, turning the inter-tee link into the horizontal cylinder while the
    // branch becomes the short vertical cylinder at the former wire corner.
    const ownerByEndpoint = new Map(nodes.flatMap((node) => node.ports.map((port) => (
      [port.endpointId, { node, port }] as const
    ))));
    const tapGroups = Map.groupBy(attachedNodes, (node) => attachmentRoot(node.device).id);
    tapGroups.forEach((group) => {
      const chain = group.toSorted((first, second) => (
        (verticalOffsetById.get(first.device.id) ?? 0) - (verticalOffsetById.get(second.device.id) ?? 0)
          || first.device.id.localeCompare(second.device.id)
      ));
      const firstJoin = chain[0];
      const groupIds = new Set(group.map((node) => node.device.id));
      const groupEndpoints = new Set(group.flatMap((node) => node.ports
        .filter((port) => port.id !== "device").map((port) => port.endpointId)));
      const upwardCorners = seeds.flatMap((seed) => {
        const tapEndpoint = groupEndpoints.has(seed.fromEndpointId) ? seed.fromEndpointId
          : groupEndpoints.has(seed.toEndpointId) ? seed.toEndpointId : undefined;
        if (!tapEndpoint) return [];
        const peerEndpoint = tapEndpoint === seed.fromEndpointId ? seed.toEndpointId : seed.fromEndpointId;
        if (groupIds.has(endpointDeviceId(peerEndpoint))) return [];
        const peer = ownerByEndpoint.get(peerEndpoint);
        if (!peer || (peer.port.side !== "neutral" && peer.port.side !== "top")) return [];
        const point = portPoint(peer.node, peer.port);
        const halfExtent = peer.node.width / 2 - GRID;
        const tapNode = nodeById.get(endpointDeviceId(tapEndpoint));
        if (!tapNode) return [];
        point.x = peer.node.x + snap(Math.max(-halfExtent, Math.min(halfExtent, tapNode.x - peer.node.x)), ROUTE_GRID);
        return point.y < tapNode.y ? [{ point, routeId: seed.route.id, tapNode }] : [];
      }).toSorted((first, second) => (
        Math.abs(first.point.x - first.tapNode.x) - Math.abs(second.point.x - second.tapNode.x)
          || first.routeId.localeCompare(second.routeId)
      ));
      const corner = upwardCorners[0];
      if (!corner) return;
      const direction = corner.point.x < firstJoin.x ? -1 : 1;
      let previous = firstJoin;
      chain.slice(1).forEach((join) => {
        const minimumX = previous.x + direction * (previous.width + join.width) / 2;
        join.x = join === corner.tapNode ? snap(direction > 0
          ? Math.max(corner.point.x, minimumX)
          : Math.min(corner.point.x, minimumX)) : snap(minimumX);
        join.y = firstJoin.y;
        previous = join;
      });
      const attachmentOwner = nodeById.get(endpointDeviceId(corner.tapNode.device.attachment!.endpoint));
      if (attachmentOwner?.device.presentation === "wire-join") {
        chain.forEach((join) => { join.y = firstJoin.y; });
      }
      const portGap = corner.tapNode.y - corner.tapNode.height / 2 - corner.point.y;
      if (portGap < PORT_RADIUS * 2 + 2) {
        const shift = snapUp(PORT_RADIUS * 2 + 2 - portGap, GRID);
        corner.tapNode.y += shift;
        if (attachmentOwner?.device.presentation === "wire-join") attachmentOwner.y += shift;
      }
    });
    // Turn absorption can collapse a multi-tee vertical subtree into one
    // horizontal row after the initial rank layout has reserved its former
    // height. Compact complete electrical rows using the actual final macro
    // bounds while preserving cross-column alignment and the routing gap.
    const macroMembers = Map.groupBy(nodes, (node) => attachmentRoot(node.device).id);
    const rows = [...Map.groupBy(layoutNodes, (node) => node.y).entries()]
      .toSorted(([first], [second]) => first - second);
    let previousBottom: number | undefined;
    rows.forEach(([, rowRoots]) => {
      const members = rowRoots.flatMap((root) => macroMembers.get(root.device.id) ?? [root]);
      const top = Math.min(...members.map((node) => node.y - node.height / 2));
      const bottom = Math.max(...members.map((node) => node.y + node.height / 2));
      const targetTop = previousBottom === undefined ? top : previousBottom + JUNCTION_ROW_GAP;
      const shift = Math.min(0, targetTop - top);
      if (shift < 0) members.forEach((node) => { node.y += shift; });
      previousBottom = bottom + shift;
    });
    // When one canonical earth conductor joins two independent tap chains,
    // their aligned tee centers define the shortest vertical trunk. Move only
    // intervening ordinary device macros far enough aside to preserve one
    // routing lane; active/neutral rows retain their Y alignment.
    seeds.filter((seed) => seed.route.kind === "earth").forEach((seed) => {
      const from = nodeById.get(endpointDeviceId(seed.fromEndpointId));
      const to = nodeById.get(endpointDeviceId(seed.toEndpointId));
      if (from?.device.presentation !== "wire-join" || to?.device.presentation !== "wire-join") return;
      const fromRoot = attachmentRoot(from.device).id; const toRoot = attachmentRoot(to.device).id;
      if (fromRoot === toRoot) return;
      const upper = from.y <= to.y ? from : to; const lower = upper === from ? to : from;
      const lowerRoot = upper === from ? toRoot : fromRoot;
      const alignmentShift = snap(upper.x - lower.x);
      (tapGroups.get(lowerRoot) ?? []).forEach((join) => { join.x += alignmentShift; });
      const trunkX = upper.x;
      const top = Math.min(from.y, to.y); const bottom = Math.max(from.y, to.y);
      layoutNodes.forEach((node) => {
        if (node.y + node.height / 2 <= top || node.y - node.height / 2 >= bottom) return;
        const left = node.x - node.width / 2; const right = node.x + node.width / 2;
        if (left >= trunkX + MIN_WIRE_LANE_SPACING || right <= trunkX - MIN_WIRE_LANE_SPACING) return;
        const direction = node.x < trunkX ? -1 : 1;
        const targetX = trunkX + direction * (node.width / 2 + MIN_WIRE_LANE_SPACING + GRID);
        const shift = snap(targetX - node.x);
        (macroMembers.get(node.device.id) ?? [node]).forEach((member) => { member.x += shift; });
      });
    });
    nodes.forEach((node) => { node.x = snap(node.x); node.y = snap(node.y); });
    orientAttachedJoinPorts(nodes, seeds);
    return normalizeNodes(nodes, compactLeftMargin ? ROUTE_LEAD * 2 : LAYOUT_MARGIN);
  }
  const columnHeights = columns.map((column) => column.reduce((total, node) => total + node.height, 0)
    + Math.max(0, column.length - 1) * JUNCTION_ROW_GAP);
  const contentHeight = Math.max(...columnHeights);
  const columnCenters: number[] = [];
  columnWidths.reduce((cursor, width, rank) => {
    columnCenters[rank] = cursor + width / 2; return cursor + width + JUNCTION_COLUMN_GAP;
  }, LAYOUT_MARGIN);
  columns.forEach((column, rank) => {
    let y = LAYOUT_MARGIN + (contentHeight - columnHeights[rank]) / 2;
    column.forEach((node) => {
      node.x = snap(columnCenters[rank]); node.y = snap(y + node.height / 2); y += node.height + JUNCTION_ROW_GAP;
    });
  });
  return normalizeNodes(nodes);
}

function junctionOwner(deviceId: string) {
  const device = dseRuntime.deviceById.get(deviceId);
  return device?.placement.space === "junction" ? device.placement.junctionId : undefined;
}

/** An attached three-way splice points its single device arm toward its owner.
 * Ordinary joins fan away; an orthogonal tee continues straight through and
 * puts the branch on the perpendicular edge. */
function orientAttachedJoinPorts(nodes: readonly DiagramNode[], seeds: readonly WireSeed[] = [],
  boundaryPorts: readonly BoundaryPort[] = []) {
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  const boundaryByEndpoint = new Map(boundaryPorts.map((port) => [port.endpointId, port.point]));
  const peerPoint = (endpointId: string) => {
    const seed = seeds.find((candidate) => (
      candidate.fromEndpointId === endpointId || candidate.toEndpointId === endpointId
    ));
    if (!seed) return undefined;
    const peerEndpoint = seed.fromEndpointId === endpointId ? seed.toEndpointId : seed.fromEndpointId;
    const peer = nodeById.get(endpointDeviceId(peerEndpoint));
    return peer ? { x: peer.x, y: peer.y } : boundaryByEndpoint.get(peerEndpoint);
  };
  nodes.filter((node) => node.device.presentation === "wire-join" && node.device.attachment)
    .forEach((node) => {
      const owner = nodeById.get(endpointDeviceId(node.device.attachment!.endpoint));
      if (node.device.diagramJoinGeometry === "orthogonal-t") {
        const ownerIsVertical = owner && Math.abs(owner.y - node.y) > Math.abs(owner.x - node.x);
        if (ownerIsVertical) {
          const ownerAbove = owner!.y < node.y;
          const branch = node.ports.find((port) => port.id === "branch");
          const branchPeer = branch ? peerPoint(branch.endpointId) : undefined;
          const branchSide: PortSide = branchPeer && branchPeer.x < node.x ? "input" : "output";
          node.ports.forEach((port) => {
            port.side = port.id === "device" ? ownerAbove ? "top" : "neutral"
              : port.id === "through" ? ownerAbove ? "neutral" : "top"
                : branchSide;
          });
        } else {
          const towardOwner: PortSide = !owner || node.x < owner.x ? "output" : "input";
          const branch = node.ports.find((port) => port.id === "branch");
          const branchPeer = branch ? peerPoint(branch.endpointId) : undefined;
          const branchSide: PortSide = branchPeer && branchPeer.y < node.y ? "top" : "neutral";
          node.ports.forEach((port) => {
            port.side = port.id === "device" ? towardOwner
              : port.id === "through" ? towardOwner === "output" ? "input" : "output"
                : branchSide;
          });
        }
        return;
      }
      const towardOwner: PortSide = !owner || node.x < owner.x ? "output" : "input";
      node.ports.forEach((port) => {
        port.side = port.id === "device" ? towardOwner : towardOwner === "output" ? "input" : "output";
      });
      node.ports.sort((first, second) => (
        (first.side === "input" ? 0 : 1) - (second.side === "input" ? 0 : 1)
          || (first.id === "through" ? 0 : first.id === "branch" ? 1 : 2)
            - (second.id === "through" ? 0 : second.id === "branch" ? 1 : 2)
      ));
    });
}

/** When an attached tee moves beside its parent tee, put their structural
 * terminal-join link on the parent arm that actually faces the child. Swap the
 * displaced non-structural seed onto the vacated arm; the continuous
 * conductor is unchanged, but the rendered tee-to-tee cylinder is straight. */
function alignAttachedTerminalJoinArms(nodes: readonly DiagramNode[], seeds: readonly WireSeed[]) {
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  const aligned = seeds.map((seed) => ({ ...seed }));
  nodes.filter((node) => node.device.presentation === "wire-join"
    && node.device.diagramJoinGeometry === "orthogonal-t" && node.device.attachment)
    .forEach((child) => {
      const parent = nodeById.get(endpointDeviceId(child.device.attachment!.endpoint));
      if (parent?.device.presentation !== "wire-join"
        || parent.device.diagramJoinGeometry !== "orthogonal-t") return;
      const childDeviceEndpoint = `${child.device.id}.device`;
      const linkIndex = aligned.findIndex((seed) => seed.route.topologyRole === "terminal-join"
        && (seed.fromEndpointId === childDeviceEndpoint || seed.toEndpointId === childDeviceEndpoint));
      if (linkIndex < 0) return;
      const link = aligned[linkIndex];
      const currentParentEndpoint = link.fromEndpointId === childDeviceEndpoint
        ? link.toEndpointId : link.fromEndpointId;
      const delta = { x: child.x - parent.x, y: child.y - parent.y };
      const magnitude = Math.max(1, Math.hypot(delta.x, delta.y));
      const desiredPort = parent.ports.filter((port) => port.id !== "device")
        .toSorted((first, second) => {
          const firstVector = outwardVector(first.side); const secondVector = outwardVector(second.side);
          const firstScore = (firstVector.x * delta.x + firstVector.y * delta.y) / magnitude;
          const secondScore = (secondVector.x * delta.x + secondVector.y * delta.y) / magnitude;
          return secondScore - firstScore || first.id.localeCompare(second.id);
        })[0];
      if (!desiredPort || desiredPort.endpointId === currentParentEndpoint) return;
      const displacedIndex = aligned.findIndex((seed, index) => index !== linkIndex && (
        seed.fromEndpointId === desiredPort.endpointId || seed.toEndpointId === desiredPort.endpointId
      ));
      if (displacedIndex < 0) throw new Error(`${desiredPort.endpointId}: no seed to exchange with terminal join.`);
      const replaceEndpoint = (seed: WireSeed, from: string, to: string): WireSeed => (
        seed.fromEndpointId === from ? { ...seed, fromEndpointId: to }
          : seed.toEndpointId === from ? { ...seed, toEndpointId: to }
            : (() => { throw new Error(`${seed.route.id}: endpoint ${from} is not attached.`); })()
      );
      aligned[linkIndex] = replaceEndpoint(link, currentParentEndpoint, desiredPort.endpointId);
      aligned[displacedIndex] = replaceEndpoint(aligned[displacedIndex], desiredPort.endpointId, currentParentEndpoint);
    });
  return aligned;
}

/** Order each edge's conductors toward their peer device. This is the usual
 * barycentric pass used by patcher/graph layouts: it preserves input/output/
 * earth sides but removes avoidable braiding immediately outside a device. */
function orderPortsTowardPeers(nodes: readonly DiagramNode[], seeds: readonly WireSeed[],
  boundaryPorts: readonly BoundaryPort[] = []) {
  const ownerByEndpoint = new Map<string, DiagramNode>();
  nodes.forEach((node) => node.ports.forEach((port) => ownerByEndpoint.set(port.endpointId, node)));
  const boundaryByEndpoint = new Map(boundaryPorts.map((port) => [port.endpointId, port.point]));
  const peerByEndpoint = new Map<string, string>();
  seeds.forEach((seed) => {
    peerByEndpoint.set(seed.fromEndpointId, seed.toEndpointId);
    peerByEndpoint.set(seed.toEndpointId, seed.fromEndpointId);
  });
  const targetPoint = (endpointId: string) => {
    const peer = peerByEndpoint.get(endpointId);
    if (!peer) return undefined;
    const owner = ownerByEndpoint.get(peer);
    return owner ? { x: owner.x, y: owner.y } : boundaryByEndpoint.get(peer);
  };
  const sideOrder: Record<PortSide, number> = { input: 0, output: 1, top: 2, neutral: 3 };
  nodes.forEach((node) => node.ports.sort((first, second) => {
    if (first.side !== second.side) return sideOrder[first.side] - sideOrder[second.side];
    if (first.declaredOrder !== undefined || second.declaredOrder !== undefined) {
      const orderDifference = (first.declaredOrder ?? Number.MAX_SAFE_INTEGER)
        - (second.declaredOrder ?? Number.MAX_SAFE_INTEGER);
      if (orderDifference !== 0) return orderDifference;
    }
    const firstTarget = targetPoint(first.endpointId); const secondTarget = targetPoint(second.endpointId);
    if (!firstTarget || !secondTarget) return first.id.localeCompare(second.id);
    const coordinate = first.side === "neutral" || first.side === "top" ? "x" : "y";
    return firstTarget[coordinate] - secondTarget[coordinate] || first.id.localeCompare(second.id);
  }));
}

/** Let tall logical hubs use their full edge. A source near the top of a
 * junction now lands near the top instead of taking a long vertical detour to
 * an arbitrarily centered terminal block. */
function alignHubPortsTowardPeers(nodes: readonly DiagramNode[], seeds: readonly WireSeed[],
  boundaryPorts: readonly BoundaryPort[] = [], alignFlexibleDevices = false) {
  const ownerByEndpoint = new Map<string, { node: DiagramNode; port: DiagramPort }>();
  nodes.forEach((node) => node.ports.forEach((port) => ownerByEndpoint.set(port.endpointId, { node, port })));
  const boundaryByEndpoint = new Map(boundaryPorts.map((port) => [port.endpointId, port.point]));
  const peersByEndpoint = new Map<string, string[]>();
  seeds.forEach((seed) => {
    const fromPeers = peersByEndpoint.get(seed.fromEndpointId) ?? [];
    fromPeers.push(seed.toEndpointId); peersByEndpoint.set(seed.fromEndpointId, fromPeers);
    const toPeers = peersByEndpoint.get(seed.toEndpointId) ?? [];
    toPeers.push(seed.fromEndpointId); peersByEndpoint.set(seed.toEndpointId, toPeers);
  });
  const target = (endpointId: string, exactPort: boolean) => {
    const peers = peersByEndpoint.get(endpointId) ?? [];
    const points = peers.flatMap((peer) => {
      const owner = ownerByEndpoint.get(peer);
      const point = owner
        ? exactPort ? portPoint(owner.node, owner.port) : { x: owner.node.x, y: owner.node.y }
        : boundaryByEndpoint.get(peer);
      return point ? [point] : [];
    });
    return points.length ? { x: mean(points.map((point) => point.x)), y: mean(points.map((point) => point.y)) } : undefined;
  };
  nodes.filter((node) => node.abstractJunction || node.device.presentation === "wall-passthrough"
    || alignFlexibleDevices && !isDiagramJoin(node.device)).forEach((node) => {
    const logicalHub = node.abstractJunction || node.device.presentation === "wall-passthrough";
    (["input", "output", "neutral"] as const).forEach((side) => {
      const ports = node.ports.filter((port) => port.side === side);
      if (!ports.length) return;
      const horizontal = side === "neutral";
      const ownExtent = horizontal ? node.width : node.height;
      const peerExtents = ports.flatMap((port) => (peersByEndpoint.get(port.endpointId) ?? []).flatMap((peer) => {
        const owner = ownerByEndpoint.get(peer);
        if (!owner) return [];
        return [horizontal ? owner.node.width : owner.node.height];
      }));
      const exactPort = !logicalHub && peerExtents.length > 0 && ownExtent > Math.max(...peerExtents);
      if (!logicalHub && !exactPort) return;
      const halfExtent = ownExtent / 2 - (logicalHub ? 48 : GRID);
      const pitch = logicalHub ? nodePortPitch(node) : ABSTRACT_GLAND_PITCH;
      const desired = ports.map((port) => {
        const point = target(port.endpointId, exactPort);
        return snap(Math.max(-halfExtent, Math.min(halfExtent,
          (point ? (horizontal ? point.x - node.x : point.y - node.y) : 0))), ROUTE_GRID);
      });
      const offsets = [...desired];
      for (let index = 1; index < offsets.length; index += 1) {
        offsets[index] = Math.max(offsets[index], offsets[index - 1] + pitch);
      }
      if (offsets.at(-1)! > halfExtent) {
        const shift = offsets.at(-1)! - halfExtent; offsets.forEach((value, index) => { offsets[index] = value - shift; });
      }
      for (let index = offsets.length - 2; index >= 0; index -= 1) {
        offsets[index] = Math.min(offsets[index], offsets[index + 1] - pitch);
      }
      if (offsets[0] < -halfExtent) {
        const shift = -halfExtent - offsets[0]; offsets.forEach((value, index) => { offsets[index] = value + shift; });
      }
      ports.forEach((port, index) => { port.offset = snap(offsets[index], ROUTE_GRID); });
    });
  });
}

function glandMaps() {
  const glandByConnection = new Map<string, typeof dseRuntime.glands[number]>();
  const glandOrder = new Map<string, number>();
  dseRuntime.glands.forEach((gland, index) => {
    glandOrder.set(gland.id, index);
    gland.connectionIds.forEach((connectionId) => glandByConnection.set(connectionId, gland));
  });
  return { glandByConnection, glandOrder };
}

function attachmentRoot(device: ResolvedDevice): ResolvedDevice {
  const attached = attachedDevice(device);
  return attached ? attachmentRoot(attached) : device;
}

function junctionEdgeSide(route: RoutedConnection, junctionId: string, externalEndpoint: string): PortSide {
  const external = dseRuntime.deviceById.get(endpointDeviceId(externalEndpoint));
  if (external && attachmentRoot(external).kind === "battery") return "neutral";
  if (route.kind === "earth" || route.kind === "data") return "neutral";
  return junctionOwner(endpointDeviceId(route.from)) === junctionId ? "output" : "input";
}

function diagramMacroRootId(deviceId: string, nodeById: ReadonlyMap<string, DiagramNode>) {
  const visited = new Set<string>();
  let current = deviceId;
  while (!visited.has(current)) {
    visited.add(current);
    const attachment = nodeById.get(current)?.device.attachment;
    if (!attachment) return current;
    const ownerId = endpointDeviceId(attachment.endpoint);
    if (!nodeById.has(ownerId)) return current;
    current = ownerId;
  }
  throw new Error(`Diagram attachment cycle includes ${deviceId}.`);
}

/** Apply optimizer proposals only after the canonical layout has established
 * every real node size and local attachment fan. An override names a macro
 * root; all attached join descendants receive the same snapped translation.
 * The production port ordering and router still run on the resulting nodes. */
function applyDiagramMacroCenterOverrides(
  nodes: DiagramNode[],
  overrides: DiagramMacroCenterOverrides,
) {
  const entries = Object.entries(overrides);
  if (entries.length === 0) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  const rootById = new Map(nodes.map((node) => [
    node.device.id,
    diagramMacroRootId(node.device.id, nodeById),
  ]));
  const deltaByRoot = new Map<string, Point>();
  entries.toSorted(([first], [second]) => first.localeCompare(second)).forEach(([deviceId, center]) => {
    const node = nodeById.get(deviceId);
    if (!node) throw new Error(`Unknown system-diagram macro root ${deviceId}.`);
    const rootId = rootById.get(deviceId)!;
    if (rootId !== deviceId) {
      throw new Error(`${deviceId} is attached to ${rootId}; override the macro root instead.`);
    }
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      throw new Error(`${deviceId}: diagram macro center must contain finite x/y coordinates.`);
    }
    deltaByRoot.set(deviceId, {
      x: snap(center.x) - node.x,
      y: snap(center.y) - node.y,
    });
  });
  nodes.forEach((node) => {
    const delta = deltaByRoot.get(rootById.get(node.device.id)!);
    if (!delta) return;
    node.x += delta.x;
    node.y += delta.y;
  });
  return nodes;
}

function systemProjection(macroCenterOverrides: DiagramMacroCenterOverrides = {}) {
  const { glandByConnection, glandOrder } = glandMaps();
  const portSets = new Map<string, DiagramPort[]>();
  const passthroughs = dseRuntime.devices.filter((device) => device.presentation === "wall-passthrough");
  const passthroughIds = new Set(passthroughs.map((device) => device.id));
  const worldDevices = dseRuntime.devices.filter((device) => (
    device.placement.space === "world" && !passthroughIds.has(device.id)
  ));
  worldDevices
    .forEach((device) => portSets.set(device.id, device.kind === "junction" ? [] : devicePorts(device)));
  const seeds: WireSeed[] = [];
  const projectedEndpoint = (endpoint: string, owner: string | undefined, physicalRoute: RoutedConnection) => {
      if (!owner) return endpoint;
      const gland = glandByConnection.get(physicalRoute.id);
      if (!gland) return undefined;
      const id = `${owner}::${physicalRoute.id}`;
      const ports = portSets.get(owner)!;
      if (!ports.some((port) => port.endpointId === id)) {
        const externalEndpoint = endpoint === physicalRoute.from ? physicalRoute.to : physicalRoute.from;
        const side = junctionEdgeSide(physicalRoute, owner, externalEndpoint);
        ports.push({ id: `${gland.id}-${physicalRoute.id}`, endpointId: id,
          label: gland.label, kind: physicalRoute.kind, side,
          selectionKey: endpoint, connectionId: physicalRoute.id, glandId: gland.id });
      }
      return id;
  };
  const addProjectedSeed = (route: RoutedConnection, from: string, to: string,
    fromPhysicalRoute = route, toPhysicalRoute = route) => {
    const fromOwner = junctionOwner(endpointDeviceId(from));
    const toOwner = junctionOwner(endpointDeviceId(to));
    if (fromOwner && fromOwner === toOwner) return;
    const fromEndpointId = projectedEndpoint(from, fromOwner, fromPhysicalRoute);
    const toEndpointId = projectedEndpoint(to, toOwner, toPhysicalRoute);
    if (!fromEndpointId || !toEndpointId || fromEndpointId === toEndpointId) return;
    seeds.push({ route, fromEndpointId, toEndpointId });
  };

  dseRuntime.routes.forEach((route) => {
    if (passthroughIds.has(endpointDeviceId(route.from)) || passthroughIds.has(endpointDeviceId(route.to))) return;
    addProjectedSeed(route, route.from, route.to);
  });

  // A sealed penetration remains two physical route solves (inside/outside),
  // but its intrinsically mated ports collapse to one schematic conductor.
  // This removes the artificial wall box and its eleven pairs of stubs without
  // changing the 3D installation or canonical physical graph.
  const routeByEndpoint = new Map<string, RoutedConnection>();
  dseRuntime.routes.forEach((route) => {
    if (passthroughIds.has(endpointDeviceId(route.from))) routeByEndpoint.set(route.from, route);
    if (passthroughIds.has(endpointDeviceId(route.to))) routeByEndpoint.set(route.to, route);
  });
  passthroughs.forEach((device) => {
    const conductorById = new Map(device.conductors.map((conductor) => [conductor.id, conductor]));
    const seenPairs = new Set<string>();
    device.conductors.forEach((conductor) => (conductor.internalMates ?? []).forEach((mateId) => {
      if (!conductorById.has(mateId)) return;
      const pairKey = [conductor.id, mateId].toSorted().join("|");
      if (seenPairs.has(pairKey)) return;
      seenPairs.add(pairKey);
      const firstKey = `${device.id}.${conductor.id}`; const secondKey = `${device.id}.${mateId}`;
      const firstRoute = routeByEndpoint.get(firstKey); const secondRoute = routeByEndpoint.get(secondKey);
      if (!firstRoute || !secondRoute) return;
      const firstOther = firstRoute.from === firstKey ? firstRoute.to : firstRoute.from;
      const secondOther = secondRoute.from === secondKey ? secondRoute.to : secondRoute.from;
      if (firstRoute.to === firstKey && secondRoute.from === secondKey) {
        addProjectedSeed(secondRoute, firstOther, secondOther, firstRoute, secondRoute);
      } else if (secondRoute.to === secondKey && firstRoute.from === firstKey) {
        addProjectedSeed(firstRoute, secondOther, firstOther, secondRoute, firstRoute);
      } else {
        addProjectedSeed(firstRoute, firstOther, secondOther, firstRoute, secondRoute);
      }
    }));
  });
  portSets.forEach((ports) => ports.sort((first, second) => {
    if (!first.glandId || !second.glandId) return 0;
    return (glandOrder.get(first.glandId) ?? 0) - (glandOrder.get(second.glandId) ?? 0)
      || (first.connectionId ?? "").localeCompare(second.connectionId ?? "");
  }));
  const nodes = applyDiagramMacroCenterOverrides(
    layoutWorldNodes(worldDevices.map((device) => prepareWorldNode(device, portSets.get(device.id)!)), seeds),
    macroCenterOverrides,
  );
  orderPortsTowardPeers(nodes, seeds);
  alignHubPortsTowardPeers(nodes, seeds);
  return { nodes, seeds };
}

function fitCoordinates(desired: readonly number[], minimum: number, maximum: number, pitch: number) {
  if (!desired.length) return [];
  const values = desired.map((value) => snap(Math.max(minimum, Math.min(maximum, value)), ROUTE_GRID));
  for (let index = 1; index < values.length; index += 1) values[index] = Math.max(values[index], values[index - 1] + pitch);
  if (values.at(-1)! > maximum) {
    const shift = values.at(-1)! - maximum; values.forEach((value, index) => { values[index] = value - shift; });
  }
  for (let index = values.length - 2; index >= 0; index -= 1) values[index] = Math.min(values[index], values[index + 1] - pitch);
  if (values[0] < minimum) {
    const shift = minimum - values[0]; values.forEach((value, index) => { values[index] = value + shift; });
  }
  return values.map((value) => snap(value, ROUTE_GRID));
}

function junctionProjection(junctionId: string) {
  const junction = dseRuntime.deviceById.get(junctionId)!;
  const members = dseRuntime.devices.filter((device) => (
    device.placement.space === "junction" && device.placement.junctionId === junctionId
  ));
  const memberIds = new Set(members.map((device) => device.id));
  const { glandByConnection, glandOrder } = glandMaps();
  const crossing = dseRuntime.routes
    .filter((route) => memberIds.has(endpointDeviceId(route.from)) !== memberIds.has(endpointDeviceId(route.to)))
    .toSorted((first, second) => {
      const firstGland = glandByConnection.get(first.id);
      const secondGland = glandByConnection.get(second.id);
      return (glandOrder.get(firstGland?.id ?? "") ?? 0) - (glandOrder.get(secondGland?.id ?? "") ?? 0)
        || first.id.localeCompare(second.id);
    });
  const boundaryPorts: BoundaryPort[] = crossing.map((route) => {
    const internalEndpoint = memberIds.has(endpointDeviceId(route.from)) ? route.from : route.to;
    const externalEndpoint = internalEndpoint === route.from ? route.to : route.from;
    const externalConductor = dseRuntime.conductorByKey.get(externalEndpoint)!;
    const gland = glandByConnection.get(route.id);
    return { id: `boundary-${route.id}`, endpointId: `boundary::${route.id}`,
      label: gland?.label ?? externalConductor.label, kind: route.kind,
      side: junctionEdgeSide(route, junctionId, externalEndpoint), selectionKey: internalEndpoint, connectionId: route.id,
      glandId: gland?.id, point: { x: 0, y: 0 } };
  });
  const boundaryByConnection = new Map(boundaryPorts.map((port) => [port.connectionId!, port]));
  const seeds = dseRuntime.routes.flatMap((route): WireSeed[] => {
    const fromInside = memberIds.has(endpointDeviceId(route.from));
    const toInside = memberIds.has(endpointDeviceId(route.to));
    if (!fromInside && !toInside) return [];
    if (fromInside && toInside) return [{ route, fromEndpointId: route.from, toEndpointId: route.to }];
    const boundary = boundaryByConnection.get(route.id)!;
    return [{ route, fromEndpointId: fromInside ? route.from : boundary.endpointId,
      toEndpointId: toInside ? route.to : boundary.endpointId }];
  });
  const nodes = layoutJunctionNodes(members, seeds);
  orientAttachedJoinPorts(nodes, seeds, boundaryPorts);
  const alignedSeeds = alignAttachedTerminalJoinArms(nodes, seeds);
  orientAttachedJoinPorts(nodes, alignedSeeds, boundaryPorts);
  const nodeRight = nodes.length ? Math.max(...nodes.map((node) => node.x + node.width / 2)) : 720;
  const nodeBottom = nodes.length ? Math.max(...nodes.map((node) => node.y + node.height / 2)) : 540;
  const neutralCount = boundaryPorts.filter((port) => port.side === "neutral").length;
  const sideCount = Math.max(boundaryPorts.filter((port) => port.side === "input").length,
    boundaryPorts.filter((port) => port.side === "output").length);
  const width = snapUp(Math.max(900, nodeRight + LAYOUT_MARGIN * 2,
    Math.max(0, neutralCount - 1) * BOUNDARY_PORT_PITCH + LAYOUT_MARGIN * 2));
  const height = snapUp(Math.max(720, nodeBottom + LAYOUT_MARGIN * 2,
    Math.max(0, sideCount - 1) * BOUNDARY_PORT_PITCH + LAYOUT_MARGIN));
  const pointByInternalEndpoint = new Map(nodes.flatMap((node) => node.ports.map((port) => [
    port.endpointId, portPoint(node, port),
  ] as const)));
  (["input", "output", "neutral"] as const).forEach((side) => {
    const ports = boundaryPorts.filter((port) => port.side === side).sort((first, second) => {
      const firstTarget = pointByInternalEndpoint.get(first.selectionKey); const secondTarget = pointByInternalEndpoint.get(second.selectionKey);
      const coordinate = side === "neutral" ? "x" : "y";
      return (firstTarget?.[coordinate] ?? 0) - (secondTarget?.[coordinate] ?? 0)
        || (glandOrder.get(first.glandId ?? "") ?? 0) - (glandOrder.get(second.glandId ?? "") ?? 0)
        || first.id.localeCompare(second.id);
    });
    const coordinate = side === "neutral" ? "x" : "y";
    const fitted = fitCoordinates(ports.map((port) => pointByInternalEndpoint.get(port.selectionKey)?.[coordinate] ?? 0),
      36, (side === "neutral" ? width : height) - 36, BOUNDARY_PORT_PITCH);
    ports.forEach((port, index) => {
      port.point = side === "input" ? { x: 0, y: fitted[index] }
        : side === "output" ? { x: width, y: fitted[index] }
          : { x: fitted[index], y: height };
    });
  });
  orderPortsTowardPeers(nodes, alignedSeeds, boundaryPorts);
  alignHubPortsTowardPeers(nodes, alignedSeeds, boundaryPorts);
  return { junction, nodes, boundaryPorts, seeds: alignedSeeds, width, height };
}

function endpointPositions(nodes: readonly DiagramNode[], boundaryPorts: readonly BoundaryPort[]) {
  const positions = new Map<string, EndpointPosition>();
  nodes.forEach((node) => node.ports.forEach((port) => positions.set(port.endpointId, {
    point: portPoint(node, port), side: port.side, selectionKey: port.selectionKey, ownerDeviceId: node.device.id,
  })));
  boundaryPorts.forEach((port) => positions.set(port.endpointId, {
    point: port.point, side: port.side, selectionKey: port.selectionKey, boundary: true,
  }));
  return positions;
}

/** Keep unrelated routes out of the four short gaps in each external AC
 * source/junction/load chain. Core fans reserve the complete inter-device
 * opening; junction cable stubs reserve only their narrow white-sheath lane so
 * the other AC-box ports can still turn toward the lower conversion row. */
function externalAcCorridorRouteZones(nodes: readonly DiagramNode[], seeds: readonly WireSeed[]) {
  const endpointRef = new Map(nodes.flatMap((node) => node.ports.map((port) => (
    [port.endpointId, { node, port }] as const
  ))));
  const endpointOwner = (endpointId: string) => endpointRef.get(endpointId)?.node.device.id;
  return externalAcCorridors(nodes, seeds).flatMap(({ junction, source, load }) => {
    const deviceIds = new Set([
      junction.device.id,
      source.peer.device.id, source.breakout.device.id,
      load.breakout.device.id, load.peer.device.id,
    ]);
    const protectedSeeds = seeds.filter((seed) => {
      const from = endpointOwner(seed.fromEndpointId); const to = endpointOwner(seed.toEndpointId);
      return Boolean(from && to && deviceIds.has(from) && deviceIds.has(to));
    });
    const corridorRouteIds = new Set(protectedSeeds.map((seed) => seed.route.id));
    return [...Map.groupBy(protectedSeeds, (seed) => [
      endpointOwner(seed.fromEndpointId)!, endpointOwner(seed.toEndpointId)!,
    ].toSorted().join("|")).values()].flatMap((pairSeeds) => {
      const first = endpointRef.get(pairSeeds[0].fromEndpointId)!.node;
      const second = endpointRef.get(pairSeeds[0].toEndpointId)!.node;
      const [leftNode, rightNode] = first.x <= second.x ? [first, second] : [second, first];
      const points = pairSeeds.flatMap((seed) => [seed.fromEndpointId, seed.toEndpointId].map((endpointId) => {
        const reference = endpointRef.get(endpointId)!;
        return portPoint(reference.node, reference.port);
      }));
      const touchesJunction = first === junction || second === junction;
      const junctionFacingSide: PortSide | undefined = !touchesJunction ? undefined
        : junction === rightNode ? "input" : "output";
      const junctionEdgeRouteIds = !junctionFacingSide ? [] : seeds.flatMap((seed) => {
        const junctionEndpointId = [seed.fromEndpointId, seed.toEndpointId].find((endpointId) => (
          endpointOwner(endpointId) === junction.device.id
        ));
        const reference = junctionEndpointId ? endpointRef.get(junctionEndpointId) : undefined;
        return reference?.port.side === junctionFacingSide ? [seed.route.id] : [];
      });
      const allowedRouteIds = new Set([...corridorRouteIds, ...junctionEdgeRouteIds]);
      const left = touchesJunction
        ? leftNode.x + leftNode.width / 2
        : leftNode.x - leftNode.width / 2;
      const right = touchesJunction
        ? rightNode.x - rightNode.width / 2
        : rightNode.x + rightNode.width / 2;
      if (right <= left) return [];
      return [{
        left,
        right,
        top: touchesJunction
          ? Math.min(...points.map((point) => point.y)) - MIN_WIRE_LANE_SPACING
          : Math.min(first.y - first.height / 2, second.y - second.height / 2) - ROUTE_LEAD,
        bottom: touchesJunction
          ? Math.max(...points.map((point) => point.y)) + MIN_WIRE_LANE_SPACING
          : Math.max(first.y + first.height / 2, second.y + second.height / 2) + ROUTE_LEAD * 2,
        allowedRouteIds,
      }];
    });
  });
}

/** Route each complete AC assembly before unrelated system trunks. The set is
 * topology-derived from both endpoint owners, so adding or moving an AC core,
 * sheath, breakout, source, protector, inverter, or load automatically keeps
 * the assembly's scarce shared corridors coherent. */
function systemAcAssemblyRouteIds(nodes: readonly DiagramNode[], seeds: readonly WireSeed[]) {
  const ownerByEndpoint = new Map(nodes.flatMap((node) => node.ports.map((port) => (
    [port.endpointId, node] as const
  ))));
  return new Set(seeds.filter((seed) => {
    const from = ownerByEndpoint.get(seed.fromEndpointId);
    const to = ownerByEndpoint.get(seed.toEndpointId);
    return Boolean(from && to && worldLane(from.device) === "ac" && worldLane(to.device) === "ac");
  }).map((seed) => seed.route.id));
}

/** The SmartSolar VE.Direct run descends past the MultiPlus assembly. Keep its
 * vertical trunk outside the AC-out breakout so the visual order remains
 * MultiPlus, breakout, DC-negative trunk, data trunk from left to right. */
function multiPlusBreakoutRouteExclusionZones(nodes: readonly DiagramNode[], seeds: readonly WireSeed[]) {
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  const dataSeed = seeds.find((seed) => (
    seed.route.from === "smartSolar.veDirect" || seed.route.to === "smartSolar.veDirect"
  ));
  if (!dataSeed) return [];
  return nodes.flatMap((breakout): DiagramRouteExclusionZone[] => {
    const peer = exclusiveBreakoutCorePeer(breakout.device);
    const inverter = peer?.kind === "inverter" ? nodeById.get(peer.id) : undefined;
    if (!inverter || breakout.x <= inverter.x) return [];
    return [{
      left: 0,
      right: breakout.x + breakout.width / 2 + MIN_WIRE_LANE_SPACING,
      top: breakout.y - breakout.height / 2 - ROUTE_LEAD,
      bottom: breakout.y + breakout.height / 2 + ROUTE_LEAD,
      blockedRouteIds: new Set([dataSeed.route.id]),
    }];
  });
}

function pointInsideNode(point: Point, node: DiagramNode, padding = 9) {
  return point.x > node.x - node.width / 2 - padding && point.x < node.x + node.width / 2 + padding
    && point.y > node.y - node.height / 2 - padding && point.y < node.y + node.height / 2 + padding;
}

function segmentIntersectsSegment(a: Point, b: Point, c: Point, d: Point) {
  const cross = (first: Point, second: Point, third: Point) => (
    (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
  );
  const first = cross(a, b, c); const second = cross(a, b, d);
  const third = cross(c, d, a); const fourth = cross(c, d, b);
  return ((first >= 0 && second <= 0) || (first <= 0 && second >= 0))
    && ((third >= 0 && fourth <= 0) || (third <= 0 && fourth >= 0));
}

function segmentIntersectsNode(first: Point, second: Point, node: DiagramNode) {
  if (pointInsideNode(first, node) || pointInsideNode(second, node)) return true;
  const left = node.x - node.width / 2 - 9; const right = node.x + node.width / 2 + 9;
  const top = node.y - node.height / 2 - 9; const bottom = node.y + node.height / 2 + 9;
  const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  return corners.some((corner, index) => segmentIntersectsSegment(first, second, corner, corners[(index + 1) % 4]));
}

function patchCordHitsNode(points: readonly Point[], node: DiagramNode) {
  return points.slice(1).some((second, index) => segmentIntersectsNode(points[index], second, node));
}

const ROUTE_DIRECTIONS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
] as const;

type SearchState = { x: number; y: number; direction: number; cost: number; score: number; key: string };

class MinHeap {
  private values: SearchState[] = [];
  get length() { return this.values.length; }
  push(value: SearchState) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].score <= value.score) break;
      this.values[index] = this.values[parent]; index = parent;
    }
    this.values[index] = value;
  }
  pop() {
    const first = this.values[0]; const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1; const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].score < this.values[left].score ? right : left;
      if (this.values[child].score >= last.score) break;
      this.values[index] = this.values[child]; index = child;
    }
    this.values[index] = last;
    return first;
  }
}

const cellKey = (x: number, y: number) => `${x},${y}`;
const stateKey = (x: number, y: number, direction: number) => `${x},${y},${direction}`;
const edgeKey = (first: Point, second: Point) => {
  const firstKey = cellKey(first.x, first.y); const secondKey = cellKey(second.x, second.y);
  return firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
};
const directionIndex = (vector: Point) => ROUTE_DIRECTIONS.findIndex((candidate) => (
  candidate.x === vector.x && candidate.y === vector.y
));

function simplifyOrthogonal(points: readonly Point[]) {
  const deduplicated = points.filter((point, index) => index === 0
    || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  const simplified: Point[] = [];
  deduplicated.forEach((point) => {
    const previous = simplified.at(-1); const before = simplified.at(-2);
    if (before && previous
      && (before.x === previous.x && previous.x === point.x
        || before.y === previous.y && previous.y === point.y)) simplified.pop();
    simplified.push(point);
  });
  return simplified;
}

function blockedRouteCells(nodes: readonly DiagramNode[], bounds: { width: number; height: number }) {
  const blocked = new Set<string>();
  nodes.forEach((node) => {
    const left = Math.max(GRID * 2, snap(node.x - node.width / 2 - GRID));
    const right = Math.min(bounds.width - GRID * 2, snap(node.x + node.width / 2 + GRID));
    const top = Math.max(GRID * 2, snap(node.y - node.height / 2 - GRID));
    const bottom = Math.min(bounds.height - GRID * 2, snap(node.y + node.height / 2 + GRID));
    for (let x = left; x <= right; x += ROUTE_GRID) {
      for (let y = top; y <= bottom; y += ROUTE_GRID) blocked.add(cellKey(x, y));
    }
  });
  return blocked;
}

function orthogonalPath(start: Point, end: Point, startDirection: number, endDirection: number | undefined,
  blocked: ReadonlySet<string>, usedEdges: ReadonlyMap<string, number>, occupiedCells: ReadonlyMap<string, number>,
  bounds: { width: number; height: number }, wireWidth: number) {
  const startKey = stateKey(start.x, start.y, startDirection);
  const open = new MinHeap();
  const costs = new Map([[startKey, 0]]); const previous = new Map<string, string>();
  const states = new Map<string, SearchState>();
  const heuristic = (x: number, y: number, direction: number) => (
    (Math.abs(end.x - x) + Math.abs(end.y - y)) / ROUTE_GRID
      + (endDirection === undefined || direction === endDirection ? 0 : 3)
  );
  const initial: SearchState = { x: start.x, y: start.y, direction: startDirection,
    cost: 0, score: heuristic(start.x, start.y, startDirection), key: startKey };
  open.push(initial); states.set(startKey, initial);
  let goalKey: string | undefined;
  while (open.length) {
    const current = open.pop()!;
    if (current.cost !== costs.get(current.key)) continue;
    if (current.x === end.x && current.y === end.y
      && (endDirection === undefined || current.direction === endDirection)) {
      goalKey = current.key; break;
    }
    ROUTE_DIRECTIONS.forEach((direction, nextDirection) => {
      const x = current.x + direction.x * ROUTE_GRID; const y = current.y + direction.y * ROUTE_GRID;
      if (x < ROUTE_GRID * 2 || y < ROUTE_GRID * 2
        || x > bounds.width - ROUTE_GRID * 2 || y > bounds.height - ROUTE_GRID * 2) return;
      const positionKey = cellKey(x, y);
      if (blocked.has(positionKey) && !(x === end.x && y === end.y)) return;
      const segmentKey = edgeKey({ x: current.x, y: current.y }, { x, y });
      // Exact segment reuse is visually ambiguous. Perpendicular crossings
      // remain legal, but receive a cost so the build prefers open lanes.
      if (usedEdges.has(segmentKey)) return;
      const horizontal = current.y === y;
      const nearbyParallelConflict = PARALLEL_LANE_OFFSETS.some((offset) => {
        const distance = Math.abs(offset);
        const first = horizontal
          ? { x: current.x, y: current.y + offset }
          : { x: current.x + offset, y: current.y };
        const second = horizontal ? { x, y: y + offset } : { x: x + offset, y };
        const adjacentWidth = usedEdges.get(edgeKey(first, second));
        return adjacentWidth !== undefined
          && distance < Math.max(MIN_WIRE_LANE_SPACING,
            wireWidth / 2 + adjacentWidth / 2 + WIRE_LANE_CLEARANCE);
      });
      if (nearbyParallelConflict) return;
      const turnCost = nextDirection === current.direction ? 0 : 5;
      const reverseCost = (nextDirection + 2) % 4 === current.direction ? 18 : 0;
      // A bridge is legible, but a long detour through an open channel is much
      // easier to follow than a dense patch of repeated crossings. Keep
      // crossings legal for topologies that require them while making them an
      // order of magnitude more expensive than a normal step or turn.
      const crossingCost = (occupiedCells.get(positionKey) ?? 0) * 48;
      const cost = current.cost + 1 + turnCost + reverseCost + crossingCost;
      const key = stateKey(x, y, nextDirection);
      if (cost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) return;
      const state: SearchState = { x, y, direction: nextDirection, cost,
        score: cost + heuristic(x, y, nextDirection), key };
      costs.set(key, cost); previous.set(key, current.key); states.set(key, state); open.push(state);
    });
  }
  if (!goalKey) return undefined;
  const reversed: Point[] = [];
  for (let key: string | undefined = goalKey; key; key = previous.get(key)) {
    const state = states.get(key)!; reversed.push({ x: state.x, y: state.y });
  }
  return simplifyOrthogonal(reversed.reverse());
}

function reserveRoute(points: readonly Point[], width: number,
  usedEdges: Map<string, number>, occupiedCells: Map<string, number>) {
  points.slice(1).forEach((end, index) => {
    const start = points[index];
    const step = { x: Math.sign(end.x - start.x) * ROUTE_GRID,
      y: Math.sign(end.y - start.y) * ROUTE_GRID };
    let current = start;
    while (current.x !== end.x || current.y !== end.y) {
      const next = { x: current.x + step.x, y: current.y + step.y };
      const key = edgeKey(current, next);
      usedEdges.set(key, Math.max(width, usedEdges.get(key) ?? 0));
      const positionKey = cellKey(next.x, next.y);
      occupiedCells.set(positionKey, (occupiedCells.get(positionKey) ?? 0) + 1);
      current = next;
    }
  });
}

const routeStrokeWidth = (route: RoutedConnection) => (
  Math.max(2.5, Math.min(8, route.diameterMm / 2.2))
);

type DiagramRouteOrdering = "diameter-short-first" | "short-first";
const TAP_ROUTE_ORDERINGS: readonly DiagramRouteOrdering[] = [
  "diameter-short-first", "short-first",
];
type DiagramTerminalLead = {
  outward: Point;
  point: Point;
  terminalPath: Point[];
};
type DiagramExclusiveRouteZone = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  allowedRouteIds: ReadonlySet<string>;
};
type DiagramRouteExclusionZone = Omit<DiagramExclusiveRouteZone, "allowedRouteIds"> & {
  blockedRouteIds: ReadonlySet<string>;
};
type DiagramRouteOptions = {
  terminalLeadByRouteEndpoint?: ReadonlyMap<string, DiagramTerminalLead>;
  exclusiveRouteZones?: readonly DiagramExclusiveRouteZone[];
  routeExclusionZones?: readonly DiagramRouteExclusionZone[];
  priorityRouteIds?: ReadonlySet<string>;
};
const terminalLeadKey = (routeId: string, endpointId: string) => `${routeId}|${endpointId}`;

function wireJoinArmWidth(node: DiagramNode, port: DiagramPort) {
  const endpoint = `${node.device.id}.${port.id}`;
  const route = dseRuntime.routes.find((candidate) => candidate.from === endpoint || candidate.to === endpoint);
  return route ? routeStrokeWidth(route) : 4;
}

/** Deterministic, build-time-only Manhattan routing. The ordinary pass keeps
 * diameter priority; interchangeable-tap scopes also evaluate a short-first
 * pass so an early long trunk cannot create crossings that only become visible
 * after later local wires are laid. Every pass locks routes one at a time:
 * later wires may cross a lane but cannot reuse it or violate separation. */
function routeWires(nodes: readonly DiagramNode[], boundaryPorts: readonly BoundaryPort[], seeds: readonly WireSeed[],
  bounds: { width: number; height: number }, ordering: DiagramRouteOrdering = "diameter-short-first",
  options: DiagramRouteOptions = {}) {
  const started = performance.now();
  const endpoints = endpointPositions(nodes, boundaryPorts);
  const endpointOutward = (endpoint: EndpointPosition) => endpoint.boundary
    ? endpoint.side === "input" ? { x: 1, y: 0 }
      : endpoint.side === "output" ? { x: -1, y: 0 }
        : { x: 0, y: -1 }
    : outwardVector(endpoint.side);
  const shortFacingPath = (seed: WireSeed) => {
    const from = endpoints.get(seed.fromEndpointId)!; const to = endpoints.get(seed.toEndpointId)!;
    const delta = { x: to.point.x - from.point.x, y: to.point.y - from.point.y };
    if (delta.x !== 0 && delta.y !== 0) return undefined;
    const distance = Math.abs(delta.x) + Math.abs(delta.y);
    if (distance === 0) return seed.route.topologyRole === "terminal-join"
      ? [from.point, to.point] : undefined;
    if (distance > ROUTE_LEAD * 2) return undefined;
    const direction = { x: Math.sign(delta.x), y: Math.sign(delta.y) };
    const fromOutward = endpointOutward(from); const toOutward = endpointOutward(to);
    return fromOutward.x === direction.x && fromOutward.y === direction.y
      && toOutward.x === -direction.x && toOutward.y === -direction.y
      ? [from.point, to.point] : undefined;
  };
  const attachmentRoutes = new Map<string, string[]>();
  seeds.forEach((seed) => [seed.fromEndpointId, seed.toEndpointId].forEach((endpointId) => {
    const ids = attachmentRoutes.get(endpointId) ?? []; ids.push(seed.route.id); attachmentRoutes.set(endpointId, ids);
  }));
  const routeById = new Map(seeds.map((seed) => [seed.route.id, seed.route]));
  attachmentRoutes.forEach((ids, endpointId) => {
    ids.sort((first, second) => (
      routeById.get(second)!.diameterMm - routeById.get(first)!.diameterMm
      || first.localeCompare(second)
    ));
    if (ids.length > 3) {
      throw new Error(`${endpointId}: a diagram terminal supports at most three direct fan directions`);
    }
  });
  const routeSpan = (seed: WireSeed) => {
    const from = endpoints.get(seed.fromEndpointId)!.point; const to = endpoints.get(seed.toEndpointId)!.point;
    return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  };
  const sortedSeeds = seeds.toSorted((first, second) => {
    const priorityDifference = Number(!options.priorityRouteIds?.has(first.route.id))
      - Number(!options.priorityRouteIds?.has(second.route.id));
    if (priorityDifference !== 0) return priorityDifference;
    if (ordering === "short-first") return routeSpan(first) - routeSpan(second)
      || second.route.diameterMm - first.route.diameterMm || first.route.id.localeCompare(second.route.id);
    return second.route.diameterMm - first.route.diameterMm
      || routeSpan(first) - routeSpan(second)
      || first.route.id.localeCompare(second.route.id);
  });
  const blocked = blockedRouteCells(nodes, bounds);
  const exclusiveBlockedByRouteId = new Map<string, ReadonlySet<string>>();
  const blockedForRoute = (routeId: string) => {
    const cached = exclusiveBlockedByRouteId.get(routeId);
    if (cached) return cached;
    const zones = [
      ...(options.exclusiveRouteZones ?? []).filter((zone) => !zone.allowedRouteIds.has(routeId)),
      ...(options.routeExclusionZones ?? []).filter((zone) => zone.blockedRouteIds.has(routeId)),
    ];
    if (zones.length === 0) return blocked;
    const routeBlocked = new Set(blocked);
    zones.forEach((zone) => {
      const firstX = Math.ceil(zone.left / ROUTE_GRID) * ROUTE_GRID;
      const lastX = Math.floor(zone.right / ROUTE_GRID) * ROUTE_GRID;
      const firstY = Math.ceil(zone.top / ROUTE_GRID) * ROUTE_GRID;
      const lastY = Math.floor(zone.bottom / ROUTE_GRID) * ROUTE_GRID;
      for (let x = firstX; x <= lastX; x += ROUTE_GRID) {
        for (let y = firstY; y <= lastY; y += ROUTE_GRID) routeBlocked.add(cellKey(x, y));
      }
    });
    exclusiveBlockedByRouteId.set(routeId, routeBlocked);
    return routeBlocked;
  };
  const usedEdges = new Map<string, number>(); const occupiedCells = new Map<string, number>();
  const endpointLead = (seed: WireSeed, endpointId: string, endpoint: EndpointPosition) => {
    const prepared = options.terminalLeadByRouteEndpoint?.get(terminalLeadKey(seed.route.id, endpointId));
    if (prepared) return prepared;
    const ids = attachmentRoutes.get(endpointId)!; const fanIndex = ids.indexOf(seed.route.id);
    const outward = endpointOutward(endpoint);
    const tangentBase = { x: -outward.y, y: outward.x };
    const peerPoint = (routeId: string) => {
      const candidate = seeds.find((entry) => entry.route.id === routeId)!;
      const peerId = candidate.fromEndpointId === endpointId ? candidate.toEndpointId : candidate.fromEndpointId;
      return endpoints.get(peerId)!.point;
    };
    const fanCost = (routeId: string, sign: -1 | 1) => {
      const peer = peerPoint(routeId);
      const lead = {
        x: endpoint.point.x + tangentBase.x * sign * MIN_WIRE_LANE_SPACING + outward.x * ROUTE_LEAD,
        y: endpoint.point.y + tangentBase.y * sign * MIN_WIRE_LANE_SPACING + outward.y * ROUTE_LEAD,
      };
      return Math.abs(peer.x - lead.x) + Math.abs(peer.y - lead.y);
    };
    let fanSign: -1 | 1 | undefined;
    if (fanIndex > 0 && ids.length === 2) {
      const peer = peerPoint(seed.route.id);
      const projection = (peer.x - endpoint.point.x) * tangentBase.x
        + (peer.y - endpoint.point.y) * tangentBase.y;
      fanSign = projection < 0 ? -1 : 1;
    } else if (fanIndex > 0) {
      const positiveFirst = fanCost(ids[1], 1) + fanCost(ids[2], -1);
      const negativeFirst = fanCost(ids[1], -1) + fanCost(ids[2], 1);
      const firstSign: -1 | 1 = positiveFirst <= negativeFirst ? 1 : -1;
      fanSign = fanIndex === 1 ? firstSign : firstSign === 1 ? -1 : 1;
    }
    const tangent = fanSign === undefined ? undefined : {
      x: tangentBase.x * fanSign,
      y: tangentBase.y * fanSign,
    };
    const fork = tangent ? {
      x: endpoint.point.x + tangent.x * MIN_WIRE_LANE_SPACING,
      y: endpoint.point.y + tangent.y * MIN_WIRE_LANE_SPACING,
    } : endpoint.point;
    const point = {
      x: snap(fork.x + outward.x * ROUTE_LEAD, ROUTE_GRID),
      y: snap(fork.y + outward.y * ROUTE_LEAD, ROUTE_GRID),
    };
    return { outward, point, terminalPath: simplifyOrthogonal([endpoint.point, fork, point]) };
  };
  // Reserve every terminal's straight approach before routing any middle
  // section. This prevents an early cable from consuming the only legal
  // conductor approach needed by a later cable.
  seeds.forEach((seed) => {
    const direct = shortFacingPath(seed);
    const width = routeStrokeWidth(seed.route);
    if (direct) {
      reserveRoute(direct, width, usedEdges, occupiedCells);
      return;
    }
    const from = endpoints.get(seed.fromEndpointId)!; const to = endpoints.get(seed.toEndpointId)!;
    const fromLead = endpointLead(seed, seed.fromEndpointId, from);
    const toLead = endpointLead(seed, seed.toEndpointId, to);
    reserveRoute(fromLead.terminalPath, width, usedEdges, occupiedCells);
    reserveRoute(toLead.terminalPath, width, usedEdges, occupiedCells);
  });
  const fallbackRouteIds: string[] = [];
  const routed = sortedSeeds.map((seed): RoutedWire => {
    const from = endpoints.get(seed.fromEndpointId)!; const to = endpoints.get(seed.toEndpointId)!;
    const direct = shortFacingPath(seed);
    const cable = dseRuntime.graph.cables.find((candidate) => candidate.id === seed.route.cableId)!;
    const width = routeStrokeWidth(seed.route);
    if (direct) return { ...seed, points: direct, bridges: [], fromNodeId: from.ownerDeviceId,
      toNodeId: to.ownerDeviceId, color: cable.sheath === "white" ? "#f8fafc" : diagramConductorColor[seed.route.kind],
      width };
    const fromLead = endpointLead(seed, seed.fromEndpointId, from);
    const toLead = endpointLead(seed, seed.toEndpointId, to);
    const routeBlocked = blockedForRoute(seed.route.id);
    let middle = orthogonalPath(fromLead.point, toLead.point, directionIndex(fromLead.outward),
      directionIndex({ x: -toLead.outward.x, y: -toLead.outward.y }), routeBlocked,
      usedEdges, occupiedCells, bounds, width);
    middle ??= orthogonalPath(fromLead.point, toLead.point, directionIndex(fromLead.outward),
      undefined, routeBlocked, usedEdges, occupiedCells, bounds, width);
    if (!middle) {
      fallbackRouteIds.push(seed.route.id);
      const bend = { x: fromLead.point.x, y: toLead.point.y };
      middle = simplifyOrthogonal([fromLead.point, bend, toLead.point]);
    }
    reserveRoute(middle, width, usedEdges, occupiedCells);
    const selectedPoints = simplifyOrthogonal([
      ...fromLead.terminalPath,
      ...middle,
      ...[...toLead.terminalPath].reverse(),
    ]);
    return { ...seed, points: selectedPoints, bridges: [], fromNodeId: from.ownerDeviceId, toNodeId: to.ownerDeviceId,
      color: cable.sheath === "white" ? "#f8fafc" : diagramConductorColor[seed.route.kind],
      width };
  });
  const crossings = annotateLocalBridges(routed);
  return { routed: crossings.wires, routingMs: performance.now() - started,
    routingFallbacks: fallbackRouteIds.length, fallbackRouteIds,
    bridgedCrossings: crossings.bridgedCrossings, unbridgedCrossings: crossings.unbridgedCrossings };
}

function wireSegments(wire: RoutedWire) {
  return wire.points.slice(1).map((second, index) => ({ first: wire.points[index], second }));
}
function intervalOverlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
}
function coincidentSegmentCount(wires: readonly RoutedWire[]) {
  let count = 0;
  for (let firstWire = 0; firstWire < wires.length; firstWire += 1) {
    for (let secondWire = firstWire + 1; secondWire < wires.length; secondWire += 1) {
      const first = wires[firstWire]; const second = wires[secondWire];
      wireSegments(first).forEach((firstSegment) => wireSegments(second).forEach((secondSegment) => {
        const firstVector = { x: firstSegment.second.x - firstSegment.first.x, y: firstSegment.second.y - firstSegment.first.y };
        const secondVector = { x: secondSegment.second.x - secondSegment.first.x, y: secondSegment.second.y - secondSegment.first.y };
        const between = { x: secondSegment.first.x - firstSegment.first.x, y: secondSegment.first.y - firstSegment.first.y };
        const parallel = firstVector.x * secondVector.y - firstVector.y * secondVector.x === 0;
        const collinear = between.x * firstVector.y - between.y * firstVector.x === 0;
        if (!parallel || !collinear) return;
        const useX = Math.abs(firstVector.x) >= Math.abs(firstVector.y);
        if (intervalOverlap(
          useX ? firstSegment.first.x : firstSegment.first.y,
          useX ? firstSegment.second.x : firstSegment.second.y,
          useX ? secondSegment.first.x : secondSegment.first.y,
          useX ? secondSegment.second.x : secondSegment.second.y,
        ) > 0.5) count += 1;
      }));
    }
  }
  return count;
}

function parallelEnvelopeOverlapCount(wires: readonly RoutedWire[]) {
  let count = 0;
  for (let firstWire = 0; firstWire < wires.length; firstWire += 1) {
    for (let secondWire = firstWire + 1; secondWire < wires.length; secondWire += 1) {
      const first = wires[firstWire]; const second = wires[secondWire];
      wireSegments(first).forEach((firstSegment) => wireSegments(second).forEach((secondSegment) => {
        const firstHorizontal = firstSegment.first.y === firstSegment.second.y;
        const secondHorizontal = secondSegment.first.y === secondSegment.second.y;
        if (firstHorizontal !== secondHorizontal) return;
        const firstAxis = firstHorizontal ? firstSegment.first.y : firstSegment.first.x;
        const secondAxis = secondHorizontal ? secondSegment.first.y : secondSegment.first.x;
        if (firstAxis === secondAxis || Math.abs(firstAxis - secondAxis) >= (first.width + second.width) / 2) return;
        const overlap = intervalOverlap(
          firstHorizontal ? firstSegment.first.x : firstSegment.first.y,
          firstHorizontal ? firstSegment.second.x : firstSegment.second.y,
          secondHorizontal ? secondSegment.first.x : secondSegment.first.y,
          secondHorizontal ? secondSegment.second.x : secondSegment.second.y,
        );
        if (overlap > 0.5) count += 1;
      }));
    }
  }
  return count;
}

function minimumParallelWireSeparation(wires: readonly RoutedWire[]) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let firstWire = 0; firstWire < wires.length; firstWire += 1) {
    for (let secondWire = firstWire + 1; secondWire < wires.length; secondWire += 1) {
      wireSegments(wires[firstWire]).forEach((firstSegment) => wireSegments(wires[secondWire]).forEach((secondSegment) => {
        const firstHorizontal = firstSegment.first.y === firstSegment.second.y;
        const secondHorizontal = secondSegment.first.y === secondSegment.second.y;
        if (firstHorizontal !== secondHorizontal) return;
        const firstAxis = firstHorizontal ? firstSegment.first.y : firstSegment.first.x;
        const secondAxis = secondHorizontal ? secondSegment.first.y : secondSegment.first.x;
        if (firstAxis === secondAxis) return;
        const overlap = intervalOverlap(
          firstHorizontal ? firstSegment.first.x : firstSegment.first.y,
          firstHorizontal ? firstSegment.second.x : firstSegment.second.y,
          secondHorizontal ? secondSegment.first.x : secondSegment.first.y,
          secondHorizontal ? secondSegment.second.x : secondSegment.second.y,
        );
        if (overlap > 0.5) minimum = Math.min(minimum, Math.abs(firstAxis - secondAxis));
      }));
    }
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function nonOrthogonalSegmentCount(wires: readonly RoutedWire[]) {
  return wires.reduce((total, wire) => total + wireSegments(wire).filter(({ first, second }) => (
    first.x !== second.x && first.y !== second.y
  )).length, 0);
}

function sampledSegments(wire: RoutedWire) {
  return wireSegments(wire);
}

function orthogonalIntersection(first: { first: Point; second: Point }, second: { first: Point; second: Point }) {
  const firstHorizontal = first.first.y === first.second.y;
  const secondHorizontal = second.first.y === second.second.y;
  if (firstHorizontal === secondHorizontal) return undefined;
  const horizontal = firstHorizontal ? first : second; const vertical = firstHorizontal ? second : first;
  const point = { x: vertical.first.x, y: horizontal.first.y };
  const between = (value: number, start: number, end: number) => (
    value >= Math.min(start, end) && value <= Math.max(start, end)
  );
  return between(point.x, horizontal.first.x, horizontal.second.x)
    && between(point.y, vertical.first.y, vertical.second.y) ? point : undefined;
}

function annotateLocalBridges(wires: readonly RoutedWire[]) {
  const annotated = wires.map((wire) => ({ ...wire, bridges: [] as Array<{ point: Point; axis: "horizontal" | "vertical" }> }));
  let bridgedCrossings = 0; let unbridgedCrossings = 0;
  for (let firstWire = 0; firstWire < annotated.length; firstWire += 1) {
    for (let secondWire = firstWire + 1; secondWire < annotated.length; secondWire += 1) {
      const seen = new Set<string>();
      sampledSegments(annotated[firstWire]).forEach((firstSegment) => (
        sampledSegments(annotated[secondWire]).forEach((secondSegment) => {
          const point = orthogonalIntersection(firstSegment, secondSegment);
          if (!point) return;
          const crossingKey = cellKey(point.x, point.y);
          if (seen.has(crossingKey)) return;
          seen.add(crossingKey);
          const firstEndpoints = [annotated[firstWire].points[0], annotated[firstWire].points.at(-1)!];
          const secondEndpoints = [annotated[secondWire].points[0], annotated[secondWire].points.at(-1)!];
          const isSharedTerminal = firstEndpoints.some((firstPoint) => secondEndpoints.some((secondPoint) => (
            firstPoint.x === point.x && firstPoint.y === point.y
              && secondPoint.x === point.x && secondPoint.y === point.y
          )));
          if (isSharedTerminal) return;
          const firstHorizontal = firstSegment.first.y === firstSegment.second.y;
          const secondHorizontal = secondSegment.first.y === secondSegment.second.y;
          if (firstHorizontal === secondHorizontal) { unbridgedCrossings += 1; return; }
          const firstIsTop = annotated[firstWire].width > annotated[secondWire].width
            || annotated[firstWire].width === annotated[secondWire].width
              && annotated[firstWire].route.id.localeCompare(annotated[secondWire].route.id) < 0;
          const topIndex = firstIsTop ? firstWire : secondWire;
          const topHorizontal = firstIsTop ? firstHorizontal : secondHorizontal;
          const bridges = annotated[topIndex].bridges;
          if (!bridges.some((bridge) => bridge.point.x === point.x && bridge.point.y === point.y)) {
            bridges.push({ point, axis: topHorizontal ? "horizontal" : "vertical" });
            bridgedCrossings += 1;
          }
        })
      ));
    }
  }
  return { wires: annotated, bridgedCrossings, unbridgedCrossings };
}

function conductorOverlapCount(nodes: readonly DiagramNode[], boundaryPorts: readonly BoundaryPort[],
  seeds: readonly WireSeed[] = []) {
  const points = [...nodes.flatMap((node) => node.ports.map((port) => ({
    endpointId: port.endpointId,
    point: portPoint(node, port),
  }))), ...boundaryPorts.map((port) => ({ endpointId: port.endpointId, point: port.point }))];
  const structuralPairs = new Set(seeds.filter((seed) => seed.route.topologyRole === "terminal-join")
    .map((seed) => [seed.fromEndpointId, seed.toEndpointId].toSorted().join("|")));
  let overlaps = 0;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      if (structuralPairs.has([points[first].endpointId, points[second].endpointId].toSorted().join("|"))) continue;
      if (Math.hypot(points[first].point.x - points[second].point.x,
        points[first].point.y - points[second].point.y) < PORT_RADIUS * 2 + 2) overlaps += 1;
    }
  }
  return overlaps;
}

function nodeBodyCrossingCount(nodes: readonly DiagramNode[], wires: readonly RoutedWire[]) {
  return wires.reduce((total, wire) => {
    return total + nodes.filter((node) => node.device.id !== wire.fromNodeId && node.device.id !== wire.toNodeId
      && patchCordHitsNode(wire.points, node)).length;
  }, 0);
}

function nodeOverlapCount(nodes: readonly DiagramNode[]) {
  let overlaps = 0;
  for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
      const first = nodes[firstIndex]; const second = nodes[secondIndex];
      const directJoinAttachment = first.device.presentation === "wire-join"
        && second.device.presentation === "wire-join"
        && (endpointDeviceId(first.device.attachment?.endpoint ?? "") === second.device.id
          || endpointDeviceId(second.device.attachment?.endpoint ?? "") === first.device.id);
      if (directJoinAttachment) continue;
      const overlapX = (first.width + second.width) / 2 + GRID - Math.abs(first.x - second.x);
      const overlapY = (first.height + second.height) / 2 + GRID - Math.abs(first.y - second.y);
      if (overlapX > 0 && overlapY > 0) overlaps += 1;
    }
  }
  return overlaps;
}

function wireTurnCount(wires: readonly RoutedWire[]) {
  return wires.reduce((total, wire) => total + Math.max(0, wire.points.length - 2), 0);
}

function wireLength(wires: readonly RoutedWire[]) {
  return wires.reduce((total, wire) => total + wire.points.slice(1).reduce((length, point, index) => (
    length + Math.abs(point.x - wire.points[index].x) + Math.abs(point.y - wire.points[index].y)
  ), 0), 0);
}

type BusbarSlotOrderPlan = {
  busbarId: string;
  portIds: string[];
  movedConnections: number;
};

type Rectangle = { left: number; right: number; top: number; bottom: number };

function busbarFanRectangle(node: DiagramNode): Rectangle {
  return {
    left: node.x - node.width * 1.5,
    right: node.x + node.width * 1.5,
    top: node.y - node.height * 1.5,
    bottom: node.y + node.height * 1.5,
  };
}

function pointInRectangle(point: Point, rectangle: Rectangle) {
  return point.x >= rectangle.left && point.x <= rectangle.right
    && point.y >= rectangle.top && point.y <= rectangle.bottom;
}

function segmentRectangleIntersections(first: Point, second: Point, rectangle: Rectangle) {
  const intersections: Point[] = [];
  if (first.y === second.y) {
    for (const x of [rectangle.left, rectangle.right]) {
      if (x >= Math.min(first.x, second.x) && x <= Math.max(first.x, second.x)
        && first.y >= rectangle.top && first.y <= rectangle.bottom) {
        intersections.push({ x, y: first.y });
      }
    }
  } else if (first.x === second.x) {
    for (const y of [rectangle.top, rectangle.bottom]) {
      if (y >= Math.min(first.y, second.y) && y <= Math.max(first.y, second.y)
        && first.x >= rectangle.left && first.x <= rectangle.right) {
        intersections.push({ x: first.x, y });
      }
    }
  }
  return [...new Map(intersections.map((point) => [cellKey(point.x, point.y), point])).values()]
    .toSorted((firstPoint, secondPoint) => (
      Math.abs(firstPoint.x - first.x) + Math.abs(firstPoint.y - first.y)
        - Math.abs(secondPoint.x - first.x) - Math.abs(secondPoint.y - first.y)
    ));
}

/** Trace a routed conductor toward a busbar and record where it first enters
 * a device-centred fan envelope. Ordering those entries around the envelope
 * is the planar equivalent of routing to one virtual device target: physical
 * endpoint identities and routing-group validity remain unchanged, while the
 * schematic may choose whichever display slot lets the incoming trunks reach
 * the equipotential bar without braiding at its edge. */
function busbarApproachEntry(wire: RoutedWire, endpointId: string, rectangle: Rectangle) {
  const points = wire.toEndpointId === endpointId ? wire.points : [...wire.points].reverse();
  if (pointInRectangle(points[0], rectangle)) return points[0];
  for (let index = 1; index < points.length; index += 1) {
    const intersections = segmentRectangleIntersections(points[index - 1], points[index], rectangle);
    if (intersections.length > 0) return intersections[0];
  }
  return undefined;
}

function rectanglePerimeterPosition(point: Point, rectangle: Rectangle) {
  const width = rectangle.right - rectangle.left;
  const height = rectangle.bottom - rectangle.top;
  if (point.y === rectangle.top) return rectangle.right - point.x;
  if (point.x === rectangle.left) return width + point.y - rectangle.top;
  if (point.y === rectangle.bottom) return width + height + point.x - rectangle.left;
  return width * 2 + height + rectangle.bottom - point.y;
}

function circularMedian(values: readonly number[], period: number) {
  return values.toSorted((first, second) => {
    const score = (candidate: number) => values.reduce((total, value) => {
      const distance = Math.abs(candidate - value);
      return total + Math.min(distance, period - distance);
    }, 0);
    return score(first) - score(second) || first - second;
  })[0];
}

function virtualBusbarSlotOrderPlans(nodes: readonly DiagramNode[], seeds: readonly WireSeed[],
  routedWires: readonly RoutedWire[]) {
  const wiresByEndpoint = new Map<string, RoutedWire[]>();
  routedWires.forEach((wire) => [wire.fromEndpointId, wire.toEndpointId].forEach((endpointId) => {
    wiresByEndpoint.set(endpointId, [...(wiresByEndpoint.get(endpointId) ?? []), wire]);
  }));
  const seedCountByEndpoint = new Map<string, number>();
  seeds.forEach((seed) => [seed.fromEndpointId, seed.toEndpointId].forEach((endpointId) => {
    seedCountByEndpoint.set(endpointId, (seedCountByEndpoint.get(endpointId) ?? 0) + 1);
  }));
  const sideOrder: readonly PortSide[] = ["input", "output", "top", "neutral"];
  return nodes.flatMap((node): BusbarSlotOrderPlan[] => {
    const routingGroups = new Set(node.device.conductors.flatMap((conductor) => (
      conductor.routingGroup ? [conductor.routingGroup] : []
    )));
    if (routingGroups.size === 0 || node.ports.length < 2) return [];
    const rectangle = busbarFanRectangle(node);
    const perimeter = 2 * ((rectangle.right - rectangle.left) + (rectangle.bottom - rectangle.top));
    let movedConnections = 0;
    const orderedBySide = new Map<PortSide, DiagramPort[]>();
    sideOrder.forEach((side) => {
      const original = node.ports.filter((port) => port.side === side);
      const entries = original.flatMap((port) => {
        const endpointId = port.endpointId;
        const positions = (wiresByEndpoint.get(endpointId) ?? []).flatMap((wire) => {
          const entry = busbarApproachEntry(wire, endpointId, rectangle);
          return entry ? [rectanglePerimeterPosition(entry, rectangle)] : [];
        });
        return positions.length > 0 ? [{ port, position: circularMedian(positions, perimeter) }] : [];
      });
      const spare = original.filter((port) => !entries.some((entry) => entry.port.id === port.id));
      if (entries.length < 2 || entries.length < 3 && spare.length === 0) {
        orderedBySide.set(side, original);
        return;
      }
      const ascending = side === "input" || side === "neutral";
      const normalized = entries.map((entry) => ({
        ...entry,
        position: ascending ? entry.position : (perimeter - entry.position) % perimeter,
      })).toSorted((first, second) => first.position - second.position || first.port.id.localeCompare(second.port.id));
      let insertAfter = normalized.length - 1;
      let largestGap = Number.NEGATIVE_INFINITY;
      normalized.forEach((entry, index) => {
        const next = normalized[(index + 1) % normalized.length];
        const gap = (next.position - entry.position + perimeter) % perimeter;
        if (gap > largestGap) {
          largestGap = gap;
          insertAfter = index;
        }
      });
      const connected = normalized.map((entry) => entry.port);
      const ordered = [
        ...connected.slice(0, insertAfter + 1),
        ...spare,
        ...connected.slice(insertAfter + 1),
      ];
      const originalIndex = new Map(original.map((port, index) => [port.id, index]));
      ordered.forEach((port, index) => {
        if (index !== originalIndex.get(port.id)) {
          movedConnections += seedCountByEndpoint.get(port.endpointId) ?? 0;
        }
      });
      orderedBySide.set(side, ordered);
    });
    const portIds = sideOrder.flatMap((side) => orderedBySide.get(side) ?? []);
    if (portIds.every((port, index) => port.id === node.ports[index].id)) return [];
    return [{ busbarId: node.device.id, portIds: portIds.map((port) => port.id), movedConnections }];
  }).toSorted((first, second) => first.busbarId.localeCompare(second.busbarId));
}

function applyBusbarSlotOrderPlans(nodes: readonly DiagramNode[], plans: readonly BusbarSlotOrderPlan[]) {
  const planByBusbar = new Map(plans.map((plan) => [plan.busbarId, plan]));
  return nodes.map((node): DiagramNode => {
    const plan = planByBusbar.get(node.device.id);
    if (!plan) return node;
    const portById = new Map(node.ports.map((port) => [port.id, port]));
    return {
      ...node,
      ports: plan.portIds.map((id) => ({ ...portById.get(id)!, offset: undefined })),
    };
  });
}

function baselineBusbarLane(wire: RoutedWire, endpointId: string, rectangle: Rectangle) {
  const points = wire.toEndpointId === endpointId ? wire.points : [...wire.points].reverse();
  for (let index = points.length - 1; index > 0; index -= 1) {
    const first = points[index - 1]; const second = points[index];
    if (first.y !== second.y || Math.abs(first.x - second.x) < ROUTE_LEAD) continue;
    if (Math.max(first.x, second.x) < rectangle.left || Math.min(first.x, second.x) > rectangle.right) continue;
    return first.y;
  }
  return rectangle.bottom;
}

/** Once the virtual target has established a planar cyclic slot order, build
 * one generic, crossing-free terminal fan inside that target envelope. The
 * ordinary A* router still owns everything outside the envelope and reserves
 * these leads before any middle path, so unrelated wires cannot reuse them. */
function virtualBusbarTerminalLeads(nodes: readonly DiagramNode[], plans: readonly BusbarSlotOrderPlan[],
  baselineWires: readonly RoutedWire[]) {
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  const wiresByEndpoint = new Map<string, RoutedWire[]>();
  baselineWires.forEach((wire) => [wire.fromEndpointId, wire.toEndpointId].forEach((endpointId) => {
    wiresByEndpoint.set(endpointId, [...(wiresByEndpoint.get(endpointId) ?? []), wire]);
  }));
  const leads = new Map<string, DiagramTerminalLead>();
  plans.forEach((plan) => {
    const node = nodeById.get(plan.busbarId)!;
    const rectangle = busbarFanRectangle(node);
    const portById = new Map(node.ports.map((port) => [port.id, port]));
    const connected = plan.portIds.flatMap((portId) => {
      const port = portById.get(portId)!;
      const endpointId = port.endpointId;
      const wires = wiresByEndpoint.get(endpointId) ?? [];
      if (port.side !== "neutral" || wires.length !== 1) return [];
      const entry = busbarApproachEntry(wires[0], endpointId, rectangle);
      if (!entry) return [];
      const side = entry.y === rectangle.top ? "top"
        : entry.x === rectangle.left ? "left"
          : entry.y === rectangle.bottom ? "bottom" : "right";
      return [{ port, endpointId, wire: wires[0], entry, side,
        desiredLane: baselineBusbarLane(wires[0], endpointId, rectangle) }];
    });
    if (connected.length < 3) return;
    const routedBelow = connected.filter((entry) => entry.side !== "right" && entry.side !== "bottom");
    let previousLane = node.y + node.height / 2 + ROUTE_LEAD - MIN_WIRE_LANE_SPACING;
    const laneByEndpoint = new Map(routedBelow.map((entry) => {
      const lane = snap(Math.max(entry.desiredLane, previousLane + MIN_WIRE_LANE_SPACING), ROUTE_GRID);
      previousLane = lane;
      return [entry.endpointId, lane] as const;
    }));
    const leftEntries = routedBelow.filter((entry) => entry.side === "left");
    const leftIndexByEndpoint = new Map(leftEntries.map((entry, index) => [entry.endpointId, index]));
    connected.forEach((entry) => {
      const terminal = portPoint(node, entry.port);
      let terminalPath: Point[];
      if (entry.side === "right") {
        terminalPath = simplifyOrthogonal([
          terminal,
          { x: terminal.x, y: entry.entry.y },
          entry.entry,
        ]);
      } else if (entry.side === "left") {
        const lane = laneByEndpoint.get(entry.endpointId)!;
        const leftIndex = leftIndexByEndpoint.get(entry.endpointId)!;
        const stageX = rectangle.left + (leftEntries.length - leftIndex) * MIN_WIRE_LANE_SPACING;
        terminalPath = simplifyOrthogonal([
          terminal,
          { x: terminal.x, y: lane },
          { x: stageX, y: lane },
          { x: stageX, y: entry.entry.y },
          entry.entry,
        ]);
      } else if (entry.side === "top") {
        const lane = laneByEndpoint.get(entry.endpointId)!;
        terminalPath = simplifyOrthogonal([
          terminal,
          { x: terminal.x, y: lane },
          { x: entry.entry.x, y: lane },
          entry.entry,
        ]);
      } else {
        return;
      }
      const beforeExit = terminalPath.at(-2)!;
      const exit = terminalPath.at(-1)!;
      const outward = { x: Math.sign(exit.x - beforeExit.x), y: Math.sign(exit.y - beforeExit.y) };
      leads.set(terminalLeadKey(entry.wire.route.id, entry.endpointId), {
        outward,
        point: exit,
        terminalPath,
      });
    });
  });
  return leads;
}

function diagramGeometryAudit(nodes: readonly DiagramNode[], boundaryPorts: readonly BoundaryPort[],
  seeds: readonly WireSeed[], routed: RoutedWireResult) {
  return {
    coincidentSegments: coincidentSegmentCount(routed.routed),
    nonOrthogonalSegments: nonOrthogonalSegmentCount(routed.routed),
    conductorOverlaps: conductorOverlapCount(nodes, boundaryPorts, seeds),
    parallelEnvelopeOverlaps: parallelEnvelopeOverlapCount(routed.routed),
    minimumParallelWireSeparation: minimumParallelWireSeparation(routed.routed),
    nodeBodyCrossings: nodeBodyCrossingCount(nodes, routed.routed),
    nodeOverlaps: nodeOverlapCount(nodes),
    wireTurns: wireTurnCount(routed.routed),
    wireLength: wireLength(routed.routed),
  };
}

type JunctionProjection = ReturnType<typeof junctionProjection>;
type RoutedWireResult = ReturnType<typeof routeWires>;
type TapAssignmentCandidate = {
  key: string;
  seeds: WireSeed[];
};
type DiagramAssignmentCandidate = TapAssignmentCandidate & {
  tapKey: string;
  tapReassignments: number;
  busbarLandingReassignments: number;
  peerOrderedBusbarIds: ReadonlySet<string>;
};
type EvaluatedTapAssignment = DiagramAssignmentCandidate & {
  routeOrdering: DiagramRouteOrdering;
  nodes: DiagramNode[];
  boundaryPorts: BoundaryPort[];
  routed: RoutedWireResult;
  coincidentSegments: number;
  nonOrthogonalSegments: number;
  conductorOverlaps: number;
  parallelEnvelopeOverlaps: number;
  minimumParallelWireSeparation: number;
  nodeBodyCrossings: number;
  nodeOverlaps: number;
  wireTurns: number;
  wireLength: number;
};

const MAX_EXACT_TAP_ASSIGNMENTS = 720;
const MAX_EXACT_BUSBAR_ORDER_CANDIDATES = 64;

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length < 2) return [[...values]];
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index), ...values.slice(index + 1),
  ]).map((tail) => [value, ...tail]));
}

/** A serial chain of attached orthogonal tees is one continuous conductor.
 * Its uncommitted branch/terminal arms therefore have no intrinsic electrical
 * identity: assigning a downstream connection to tee 1 or tee 2 is a
 * diagram-layout decision. The arm that continues into another tee remains
 * structural and is not part of the permutation.
 * Enumerate those equivalent assignments before routing instead of forcing
 * A* to detour around the arbitrary order produced by topology expansion. */
function interchangeableTapAssignmentCandidates(
  nodes: readonly DiagramNode[],
  seeds: readonly WireSeed[],
): TapAssignmentCandidate[] {
  const joins = new Map(nodes.filter((node) => (
    node.device.presentation === "wire-join"
      && node.device.diagramJoinGeometry === "orthogonal-t"
      && node.device.attachment
  )).map((node) => [node.device.id, node]));
  const rootEndpoint = (node: DiagramNode) => {
    const visited = new Set<string>();
    let endpoint = node.device.attachment!.endpoint;
    while (true) {
      const ownerId = endpointDeviceId(endpoint);
      if (visited.has(ownerId)) throw new Error(`Orthogonal tap attachment cycle includes ${ownerId}.`);
      visited.add(ownerId);
      const owner = joins.get(ownerId);
      if (!owner) return endpoint;
      endpoint = owner.device.attachment!.endpoint;
    }
  };
  const groups = Map.groupBy([...joins.values()], rootEndpoint);
  const assignmentGroups = [...groups.entries()].flatMap(([root, group]) => {
    const entries = group.flatMap((node) => node.ports.filter((port) => port.id !== "device").flatMap((port) => {
      const attachedSeeds = seeds.filter((candidate) => (
        candidate.fromEndpointId === port.endpointId || candidate.toEndpointId === port.endpointId
      ));
      if (attachedSeeds.length !== 1) {
        throw new Error(`${node.device.id}.${port.id}: orthogonal tee arm must have exactly one route.`);
      }
      const seed = attachedSeeds[0];
      return seed.route.topologyRole === "terminal-join"
        ? [] : [{
          tapEndpointId: port.endpointId,
          routeId: seed.route.id,
          side: seed.fromEndpointId === port.endpointId ? "from" as const : "to" as const,
        }];
    })).toSorted((first, second) => first.routeId.localeCompare(second.routeId) || first.side.localeCompare(second.side));
    if (entries.length < 2) return [];
    const kinds = new Set(entries.map(({ routeId }) => seeds.find((seed) => seed.route.id === routeId)!.route.kind));
    if (kinds.size !== 1) throw new Error(`${root}: interchangeable tap chain mixes conductor kinds.`);
    return [{ root, entries }];
  }).toSorted((first, second) => first.root.localeCompare(second.root));

  let assignments: Array<Map<string, string>> = [new Map()];
  assignmentGroups.forEach(({ root, entries }) => {
    const tapPermutations = permutations(entries.map((entry) => entry.tapEndpointId));
    if (assignments.length * tapPermutations.length > MAX_EXACT_TAP_ASSIGNMENTS) {
      throw new Error(`${root}: more than ${MAX_EXACT_TAP_ASSIGNMENTS} exact tap assignments; split the chain.`);
    }
    assignments = assignments.flatMap((existing) => tapPermutations.map((tapEndpoints) => {
      const expanded = new Map(existing);
      entries.forEach((entry, index) => expanded.set(`${entry.routeId}:${entry.side}`, tapEndpoints[index]));
      return expanded;
    }));
  });

  const candidates = assignments.map((assignment): TapAssignmentCandidate => {
    const candidateSeeds = seeds.map((seed): WireSeed => {
      const fromEndpointId = assignment.get(`${seed.route.id}:from`) ?? seed.fromEndpointId;
      const toEndpointId = assignment.get(`${seed.route.id}:to`) ?? seed.toEndpointId;
      return fromEndpointId === seed.fromEndpointId && toEndpointId === seed.toEndpointId
        ? seed : { ...seed, fromEndpointId, toEndpointId };
    });
    const key = [...assignment.entries()].toSorted(([first], [second]) => first.localeCompare(second))
      .map(([routeSide, endpointId]) => `${routeSide}=${endpointId}`).join("|");
    return { key, seeds: candidateSeeds };
  });
  return [...new Map(candidates.map((candidate) => [candidate.key, candidate])).values()];
}

type BusbarLandingPlan = {
  busbarId: string;
  replacements: Array<{ routeId: string; endpointId: string }>;
};

/** A busbar is equipotential, so equally occupied diagram landings on one edge
 * can be reassigned in peer order. This is the crossing-minimal matching for
 * the fixed port and peer coordinates. One-wire landings move only among
 * one-wire landings, while two-wire stacks move only as intact two-wire
 * bundles, preserving every modeled stack count. Every subset of eligible
 * busbars is still exact-routed and must dominate its canonical baseline. */
function peerOrderedBusbarLandingCandidates(projection: JunctionProjection) {
  const ownerByEndpoint = new Map(projection.nodes.flatMap((node) => node.ports.map((port) => (
    [port.endpointId, node] as const
  ))));
  const boundaryByEndpoint = new Map(projection.boundaryPorts.map((port) => [port.endpointId, port.point]));
  const seedsByEndpoint = new Map<string, WireSeed[]>();
  projection.seeds.forEach((seed) => {
    seedsByEndpoint.set(seed.fromEndpointId, [...(seedsByEndpoint.get(seed.fromEndpointId) ?? []), seed]);
    seedsByEndpoint.set(seed.toEndpointId, [...(seedsByEndpoint.get(seed.toEndpointId) ?? []), seed]);
  });
  const peerPoint = (seed: WireSeed, busbarId: string) => {
    const peer = endpointDeviceId(seed.fromEndpointId) === busbarId ? seed.toEndpointId : seed.fromEndpointId;
    const owner = ownerByEndpoint.get(peer);
    return owner ? { x: owner.x, y: owner.y } : boundaryByEndpoint.get(peer);
  };
  const plans = projection.nodes.flatMap((node): BusbarLandingPlan[] => {
    if (node.device.kind !== "busbar") return [];
    const replacements: BusbarLandingPlan["replacements"] = [];
    (["input", "output", "top", "neutral"] as const).forEach((side) => {
      const usedPorts = node.ports.filter((port) => (
        port.side === side && (seedsByEndpoint.get(port.endpointId)?.length ?? 0) > 0
      ));
      const coordinate = side === "neutral" || side === "top" ? "x" : "y";
      Object.values(Object.groupBy(usedPorts, (port) => seedsByEndpoint.get(port.endpointId)!.length))
        .forEach((occupancyPeers) => {
          if (!occupancyPeers || occupancyPeers.length < 2) return;
          const ports = occupancyPeers.toSorted((first, second) => (
            (first.declaredOrder ?? Number.MAX_SAFE_INTEGER) - (second.declaredOrder ?? Number.MAX_SAFE_INTEGER)
              || first.id.localeCompare(second.id)
          ));
          const bundles = occupancyPeers.map((port) => ({
            port,
            seeds: seedsByEndpoint.get(port.endpointId)!.toSorted((first, second) => (
              first.route.id.localeCompare(second.route.id)
            )),
          })).toSorted((first, second) => (
            mean(first.seeds.map((seed) => peerPoint(seed, node.device.id)?.[coordinate] ?? 0))
              - mean(second.seeds.map((seed) => peerPoint(seed, node.device.id)?.[coordinate] ?? 0))
              || first.port.id.localeCompare(second.port.id)
          ));
          bundles.forEach((bundle, index) => bundle.seeds.forEach((seed) => {
            const endpointId = ports[index].endpointId;
            const currentEndpoint = endpointDeviceId(seed.fromEndpointId) === node.device.id
              ? seed.fromEndpointId : seed.toEndpointId;
            if (currentEndpoint !== endpointId) replacements.push({ routeId: seed.route.id, endpointId });
          }));
        });
      });
    return replacements.length === 0 ? [] : [{ busbarId: node.device.id, replacements }];
  }).toSorted((first, second) => first.busbarId.localeCompare(second.busbarId));
  const candidateCount = 2 ** plans.length;
  if (candidateCount > MAX_EXACT_BUSBAR_ORDER_CANDIDATES) {
    throw new Error(`Junction has ${candidateCount} busbar landing candidates; cap is ${MAX_EXACT_BUSBAR_ORDER_CANDIDATES}.`);
  }
  return Array.from({ length: candidateCount }, (_, mask) => {
    const selectedPlans = plans.filter((_, index) => (mask & (1 << index)) !== 0);
    return {
      peerOrderedBusbarIds: new Set(selectedPlans.map((plan) => plan.busbarId)),
      replacements: selectedPlans.flatMap((plan) => plan.replacements.map((replacement) => ({
        ...replacement, busbarId: plan.busbarId,
      }))),
    };
  });
}

function prepareTapAssignmentCandidate(projection: JunctionProjection, candidate: DiagramAssignmentCandidate,
  alignFlexibleDevices: boolean) {
  const nodes = projection.nodes.map((node): DiagramNode => ({
    ...node,
    ports: devicePorts(node.device).map((port) => ({ ...port })),
  }));
  const boundaryPorts = projection.boundaryPorts.map((port): BoundaryPort => ({
    ...port, point: { ...port.point },
  }));
  orientAttachedJoinPorts(nodes, candidate.seeds, boundaryPorts);
  const seedByRoute = new Map(candidate.seeds.map((seed) => [seed.route.id, seed]));
  boundaryPorts.forEach((port) => {
    const seed = seedByRoute.get(port.connectionId!);
    if (!seed) return;
    port.selectionKey = seed.fromEndpointId === port.endpointId ? seed.toEndpointId : seed.fromEndpointId;
  });
  const pointByInternalEndpoint = new Map(nodes.flatMap((node) => node.ports.map((port) => [
    port.endpointId, portPoint(node, port),
  ] as const)));
  (["input", "output", "neutral"] as const).forEach((side) => {
    const coordinate = side === "neutral" ? "x" : "y";
    const ports = boundaryPorts.filter((port) => port.side === side).sort((first, second) => (
      (pointByInternalEndpoint.get(first.selectionKey)?.[coordinate] ?? 0)
        - (pointByInternalEndpoint.get(second.selectionKey)?.[coordinate] ?? 0)
        || first.id.localeCompare(second.id)
    ));
    const fitted = fitCoordinates(ports.map((port) => (
      pointByInternalEndpoint.get(port.selectionKey)?.[coordinate] ?? 0
    )), 36, (side === "neutral" ? projection.width : projection.height) - 36, BOUNDARY_PORT_PITCH);
    ports.forEach((port, index) => {
      port.point = side === "input" ? { x: 0, y: fitted[index] }
        : side === "output" ? { x: projection.width, y: fitted[index] }
          : { x: fitted[index], y: projection.height };
    });
  });
  orderPortsTowardPeers(nodes, candidate.seeds, boundaryPorts);
  alignHubPortsTowardPeers(nodes, candidate.seeds, boundaryPorts, alignFlexibleDevices);
  return { nodes, boundaryPorts };
}

function evaluateTapAssignment(projection: JunctionProjection, candidate: DiagramAssignmentCandidate,
  routeOrdering: DiagramRouteOrdering, prepareCandidate: boolean,
  alignFlexibleDevices: boolean): EvaluatedTapAssignment {
  const prepared = prepareCandidate
    ? prepareTapAssignmentCandidate(projection, candidate, alignFlexibleDevices)
    : { nodes: projection.nodes, boundaryPorts: projection.boundaryPorts };
  const routed = routeWires(prepared.nodes, prepared.boundaryPorts, candidate.seeds, {
    width: projection.width, height: projection.height,
  }, routeOrdering);
  return {
    ...candidate,
    routeOrdering,
    ...prepared,
    routed,
    ...diagramGeometryAudit(prepared.nodes, prepared.boundaryPorts, candidate.seeds, routed),
  };
}

function diagramRoutingObjectives(routed: RoutedWireResult,
  audit: ReturnType<typeof diagramGeometryAudit>) {
  return [routed.routingFallbacks, audit.coincidentSegments, audit.nonOrthogonalSegments,
    audit.conductorOverlaps, routed.unbridgedCrossings, audit.parallelEnvelopeOverlaps,
    audit.nodeBodyCrossings, audit.nodeOverlaps,
    Math.max(0, MIN_WIRE_LANE_SPACING - audit.minimumParallelWireSeparation),
    routed.bridgedCrossings, audit.wireTurns, audit.wireLength];
}

const HARD_DIAGRAM_OBJECTIVE_COUNT = 9;

/** A display-slot candidate may never buy a cleaner drawing by weakening a
 * geometry or clearance audit. Once those invariants are no worse, compare
 * the visible routing objectives in priority order: crossings, then turns,
 * then length. */
function isSafeDiagramRoutingImprovement(baseline: readonly number[], candidate: readonly number[]) {
  if (!candidate.slice(0, HARD_DIAGRAM_OBJECTIVE_COUNT)
    .every((objective, index) => objective <= baseline[index])) return false;
  for (let index = HARD_DIAGRAM_OBJECTIVE_COUNT; index < candidate.length; index += 1) {
    if (candidate[index] !== baseline[index]) return candidate[index] < baseline[index];
  }
  return false;
}

function diagramAssignmentObjectives(candidate: EvaluatedTapAssignment) {
  return diagramRoutingObjectives(candidate.routed, candidate);
}

function compareTapAssignments(first: EvaluatedTapAssignment, second: EvaluatedTapAssignment) {
  const firstObjectives = diagramAssignmentObjectives(first);
  const secondObjectives = diagramAssignmentObjectives(second);
  for (let index = 0; index < firstObjectives.length; index += 1) {
    if (firstObjectives[index] !== secondObjectives[index]) return firstObjectives[index] - secondObjectives[index];
  }
  return first.key.localeCompare(second.key) || first.routeOrdering.localeCompare(second.routeOrdering);
}

export function buildDiagramLayout(
  activeJunctionId?: string,
  systemMacroCenterOverrides: DiagramMacroCenterOverrides = {},
): DiagramLayout {
  const layoutStarted = performance.now();
  if (activeJunctionId) {
    if (Object.keys(systemMacroCenterOverrides).length > 0) {
      throw new Error("System macro-center overrides cannot be applied to a junction subpatch.");
    }
    const projection = junctionProjection(activeJunctionId);
    const width = snapUp(projection.width); const height = snapUp(projection.height);
    const canonicalEndpointByRoute = new Map(projection.seeds.map((seed) => [seed.route.id,
      `${seed.fromEndpointId}->${seed.toEndpointId}`]));
    const tapCandidates = interchangeableTapAssignmentCandidates(projection.nodes, projection.seeds);
    const busbarLandingCandidates = peerOrderedBusbarLandingCandidates(projection);
    const candidates: DiagramAssignmentCandidate[] = tapCandidates.flatMap((tapCandidate) => (
      busbarLandingCandidates.map(({ peerOrderedBusbarIds, replacements }) => {
        const replacementsByRoute = Map.groupBy(replacements, (replacement) => replacement.routeId);
        const seeds = tapCandidate.seeds.map((seed) => (
          (replacementsByRoute.get(seed.route.id) ?? []).reduce((updated, replacement): WireSeed => {
            if (endpointDeviceId(updated.fromEndpointId) === replacement.busbarId) {
              return { ...updated, fromEndpointId: replacement.endpointId };
            }
            if (endpointDeviceId(updated.toEndpointId) === replacement.busbarId) {
              return { ...updated, toEndpointId: replacement.endpointId };
            }
            throw new Error(`${seed.route.id}: busbar replacement owner ${replacement.busbarId} is not an endpoint.`);
          }, seed)
        ));
        const tapReassignments = tapCandidate.seeds.filter((seed) => (
          canonicalEndpointByRoute.get(seed.route.id) !== `${seed.fromEndpointId}->${seed.toEndpointId}`
        )).length;
        return {
          ...tapCandidate,
          seeds,
          tapKey: tapCandidate.key,
          tapReassignments,
          busbarLandingReassignments: replacements.length,
          peerOrderedBusbarIds,
          key: `tap=${tapCandidate.key}|bus=${replacements.map((replacement) => (
            `${replacement.routeId}=${replacement.endpointId}`
          )).join(",")}`,
        };
      })
    ));
    const routeOrderings = tapCandidates.length > 1 ? TAP_ROUTE_ORDERINGS : TAP_ROUTE_ORDERINGS.slice(0, 1);
    const alignFlexibleDevices = tapCandidates.length > 1;
    const evaluated = candidates.flatMap((candidate) => routeOrderings.map((routeOrdering) => (
      evaluateTapAssignment(projection, candidate, routeOrdering,
        alignFlexibleDevices || candidate.peerOrderedBusbarIds.size > 0, alignFlexibleDevices)
    )));
    const baselineByTapAndOrder = new Map(evaluated.filter((candidate) => (
      candidate.peerOrderedBusbarIds.size === 0
    )).map((candidate) => [`${candidate.tapKey}|${candidate.routeOrdering}`, candidate]));
    const safeEvaluated = evaluated.filter((candidate) => {
      if (candidate.peerOrderedBusbarIds.size === 0) return true;
      const baseline = baselineByTapAndOrder.get(`${candidate.tapKey}|${candidate.routeOrdering}`)!;
      const objectives = diagramAssignmentObjectives(candidate);
      const baselineObjectives = diagramAssignmentObjectives(baseline);
      return objectives.every((objective, index) => objective <= baselineObjectives[index])
        && objectives.some((objective, index) => objective < baselineObjectives[index]);
    });
    const selected = safeEvaluated.toSorted(compareTapAssignments)[0];
    const routed = selected.routed;
    return { key: `junction:${activeJunctionId}`, scope: "junction", junction: projection.junction,
      nodes: selected.nodes, boundaryPorts: selected.boundaryPorts, wires: routed.routed, width, height,
      routingMs: evaluated.reduce((total, candidate) => total + candidate.routed.routingMs, 0),
      coincidentSegments: selected.coincidentSegments,
      nonOrthogonalSegments: selected.nonOrthogonalSegments,
      conductorOverlaps: selected.conductorOverlaps,
      routingFallbacks: routed.routingFallbacks, fallbackRouteIds: routed.fallbackRouteIds,
      bridgedCrossings: routed.bridgedCrossings, unbridgedCrossings: routed.unbridgedCrossings,
      parallelEnvelopeOverlaps: selected.parallelEnvelopeOverlaps,
      minimumParallelWireSeparation: selected.minimumParallelWireSeparation,
      nodeBodyCrossings: selected.nodeBodyCrossings,
      maskedNodeBodyCrossings: 0, nodeOverlaps: selected.nodeOverlaps,
      wireTurns: selected.wireTurns, wireLength: selected.wireLength,
      interchangeableTapCandidates: tapCandidates.length,
      interchangeableTapReassignments: selected.tapReassignments,
      busbarLandingCandidates: busbarLandingCandidates.length,
      busbarLandingReassignments: selected.busbarLandingReassignments,
      peerOrderedBusbarIds: [...selected.peerOrderedBusbarIds].toSorted(),
      tapRoutingOrderCandidates: routeOrderings.length, selectedRoutingOrder: selected.routeOrdering,
      layoutMs: performance.now() - layoutStarted };
  }
  const projection = systemProjection(systemMacroCenterOverrides);
  const width = snapUp(Math.max(...projection.nodes.map((node) => node.x + node.width / 2)) + LAYOUT_MARGIN);
  const height = snapUp(Math.max(...projection.nodes.map((node) => node.y + node.height / 2)) + LAYOUT_MARGIN);
  const systemRouteOptions: DiagramRouteOptions = {
    exclusiveRouteZones: externalAcCorridorRouteZones(projection.nodes, projection.seeds),
    routeExclusionZones: multiPlusBreakoutRouteExclusionZones(projection.nodes, projection.seeds),
    priorityRouteIds: systemAcAssemblyRouteIds(projection.nodes, projection.seeds),
  };
  const baselineRouted = routeWires(projection.nodes, [], projection.seeds, { width, height },
    "diameter-short-first", systemRouteOptions);
  const baselineAudit = diagramGeometryAudit(projection.nodes, [], projection.seeds, baselineRouted);
  const busbarPlans = virtualBusbarSlotOrderPlans(projection.nodes, projection.seeds, baselineRouted.routed);
  const candidateNodes = applyBusbarSlotOrderPlans(projection.nodes, busbarPlans);
  const terminalLeadByRouteEndpoint = virtualBusbarTerminalLeads(
    candidateNodes, busbarPlans, baselineRouted.routed,
  );
  const candidateRouted = busbarPlans.length > 0
    ? routeWires(candidateNodes, [], projection.seeds, { width, height }, "diameter-short-first", {
      ...systemRouteOptions,
      terminalLeadByRouteEndpoint,
    })
    : baselineRouted;
  const candidateAudit = busbarPlans.length > 0
    ? diagramGeometryAudit(candidateNodes, [], projection.seeds, candidateRouted)
    : baselineAudit;
  const baselineObjectives = diagramRoutingObjectives(baselineRouted, baselineAudit);
  const candidateObjectives = diagramRoutingObjectives(candidateRouted, candidateAudit);
  const candidateIsStrictImprovement = busbarPlans.length > 0
    && isSafeDiagramRoutingImprovement(baselineObjectives, candidateObjectives);
  const nodes = candidateIsStrictImprovement ? candidateNodes : projection.nodes;
  const routed = candidateIsStrictImprovement ? candidateRouted : baselineRouted;
  const audit = candidateIsStrictImprovement ? candidateAudit : baselineAudit;
  const selectedBusbarPlans = candidateIsStrictImprovement ? busbarPlans : [];
  return { key: "system", scope: "system", nodes, boundaryPorts: [], wires: routed.routed,
    width, height, routingMs: baselineRouted.routingMs + (busbarPlans.length > 0 ? candidateRouted.routingMs : 0),
    coincidentSegments: audit.coincidentSegments,
    nonOrthogonalSegments: audit.nonOrthogonalSegments,
    conductorOverlaps: audit.conductorOverlaps, routingFallbacks: routed.routingFallbacks,
    fallbackRouteIds: routed.fallbackRouteIds, bridgedCrossings: routed.bridgedCrossings,
    unbridgedCrossings: routed.unbridgedCrossings,
    parallelEnvelopeOverlaps: audit.parallelEnvelopeOverlaps,
    minimumParallelWireSeparation: audit.minimumParallelWireSeparation,
    nodeBodyCrossings: audit.nodeBodyCrossings,
    maskedNodeBodyCrossings: 0, nodeOverlaps: audit.nodeOverlaps,
    wireTurns: audit.wireTurns, wireLength: audit.wireLength,
    interchangeableTapCandidates: 1, interchangeableTapReassignments: 0,
    busbarLandingCandidates: busbarPlans.length > 0 ? 2 : 1,
    busbarLandingReassignments: selectedBusbarPlans.reduce((total, plan) => total + plan.movedConnections, 0),
    peerOrderedBusbarIds: selectedBusbarPlans.map((plan) => plan.busbarId).toSorted(),
    tapRoutingOrderCandidates: 1, selectedRoutingOrder: "diameter-short-first",
    layoutMs: performance.now() - layoutStarted };
}

type SerializedDiagramLayout = Omit<DiagramLayout, "junction" | "nodes" | "wires"> & {
  junctionId?: string;
  nodes: Array<Omit<DiagramNode, "device"> & { deviceId: string }>;
  wires: Array<Omit<RoutedWire, "route"> & { routeId: string }>;
};

const generatedLayouts = diagramLayoutsArtifact as unknown as {
  graphId: string;
  graphRevision: string;
  layouts: Record<string, SerializedDiagramLayout>;
};
const hydratedLayoutCache = new Map<string, DiagramLayout>();

function hydrateDiagramLayout(activeJunctionId?: string) {
  const key = activeJunctionId ?? "system";
  const cached = hydratedLayoutCache.get(key);
  if (cached) return cached;
  if (generatedLayouts.graphId !== dseRuntime.graph.id || generatedLayouts.graphRevision !== dseRuntime.graph.revision) {
    throw new Error("Generated diagram geometry is stale; run npm run generate:diagram-layouts.");
  }
  const started = performance.now();
  const serialized = generatedLayouts.layouts[key];
  if (!serialized) throw new Error(`Generated diagram geometry has no ${key} scope.`);
  const layout: DiagramLayout = {
    ...serialized,
    junction: serialized.junctionId ? dseRuntime.deviceById.get(serialized.junctionId) : undefined,
    nodes: serialized.nodes.map(({ deviceId, ...node }) => ({
      ...node,
      device: dseRuntime.deviceById.get(deviceId)!,
    })),
    wires: serialized.wires.map(({ routeId, ...wire }) => ({
      ...wire,
      route: dseRuntime.routeById.get(routeId)!,
    })),
    precomputedLayoutMs: serialized.layoutMs,
    layoutMs: performance.now() - started,
  };
  hydratedLayoutCache.set(key, layout);
  return layout;
}

const WIRE_JUMP_HALF_LENGTH = 12;
const WIRE_JUMP_GROUP_GAP = WIRE_JUMP_HALF_LENGTH * 2;
const WIRE_JUMP_RISE = 10;
const HOVERED_WIRE_WIDTH = 10;
const HOVERED_WIRE_CLEARANCE = 6;

type WireJumpGeometry = {
  axis: "horizontal" | "vertical";
  start: Point;
  end: Point;
  rise: number;
  crossingCount: number;
};

function segmentAxis(first: Point, second: Point) {
  if (first.y === second.y && first.x !== second.x) return "horizontal" as const;
  if (first.x === second.x && first.y !== second.y) return "vertical" as const;
  return undefined;
}

function axisCoordinate(point: Point, axis: WireJumpGeometry["axis"]) {
  return axis === "horizontal" ? point.x : point.y;
}

function pointOnAxis(axis: WireJumpGeometry["axis"], coordinate: number, fixedCoordinate: number): Point {
  return axis === "horizontal"
    ? { x: coordinate, y: fixedCoordinate }
    : { x: fixedCoordinate, y: coordinate };
}

function bridgeIsOnSegment(bridge: RoutedWire["bridges"][number], first: Point, second: Point) {
  const axis = segmentAxis(first, second);
  if (!axis || bridge.axis !== axis) return false;
  const coordinate = axisCoordinate(bridge.point, axis);
  const firstCoordinate = axisCoordinate(first, axis); const secondCoordinate = axisCoordinate(second, axis);
  const fixedCoordinate = axis === "horizontal" ? first.y : first.x;
  return (axis === "horizontal" ? bridge.point.y : bridge.point.x) === fixedCoordinate
    && coordinate >= Math.min(firstCoordinate, secondCoordinate)
    && coordinate <= Math.max(firstCoordinate, secondCoordinate);
}

function jumpCurveCommands(jump: WireJumpGeometry) {
  const vector = { x: jump.end.x - jump.start.x, y: jump.end.y - jump.start.y };
  const normal = jump.axis === "horizontal" ? { x: 0, y: -jump.rise } : { x: jump.rise, y: 0 };
  const apex = {
    x: (jump.start.x + jump.end.x) / 2 + normal.x,
    y: (jump.start.y + jump.end.y) / 2 + normal.y,
  };
  const firstControl = { x: jump.start.x + vector.x * 0.22, y: jump.start.y + vector.y * 0.22 };
  const secondControl = { x: apex.x - vector.x * 0.12, y: apex.y - vector.y * 0.12 };
  const thirdControl = { x: apex.x + vector.x * 0.12, y: apex.y + vector.y * 0.12 };
  const fourthControl = { x: jump.end.x - vector.x * 0.22, y: jump.end.y - vector.y * 0.22 };
  return `C${firstControl.x},${firstControl.y} ${secondControl.x},${secondControl.y} ${apex.x},${apex.y} `
    + `C${thirdControl.x},${thirdControl.y} ${fourthControl.x},${fourthControl.y} ${jump.end.x},${jump.end.y}`;
}

function localJumpPath(jump: WireJumpGeometry) {
  return `M${jump.start.x},${jump.start.y} ${jumpCurveCommands(jump)}`;
}

const INTEGRATED_FUSION_OFFSET = 22;

function isIntegratedCableEndpoint(endpointId: string) {
  const port = dseRuntime.conductorByKey.get(endpointId);
  const owner = port ? dseRuntime.deviceById.get(port.deviceId) : undefined;
  return owner?.presentation === "integrated-cable-breakout"
    && port?.kind === "multicore" && (port.internalMates?.length ?? 0) >= 2;
}

function trimDiagramPolyline(points: readonly Point[], fromStart: boolean, trimDistance: number) {
  const ordered = fromStart ? [...points] : [...points].reverse();
  let remaining = trimDistance;
  let segmentIndex = 0;
  for (; segmentIndex < ordered.length - 1; segmentIndex += 1) {
    const first = ordered[segmentIndex]; const second = ordered[segmentIndex + 1];
    const length = Math.hypot(second.x - first.x, second.y - first.y);
    if (remaining < length) {
      const amount = remaining / length;
      const fusion = { x: first.x + (second.x - first.x) * amount, y: first.y + (second.y - first.y) * amount };
      const trimmed = [fusion, ...ordered.slice(segmentIndex + 1)];
      return fromStart ? trimmed : trimmed.reverse();
    }
    remaining -= length;
  }
  return [...points];
}

function wireRenderGeometry(wire: RoutedWire) {
  const trimmedEndpoints: string[] = [];
  let visiblePoints = [...wire.points];
  if (isIntegratedCableEndpoint(wire.fromEndpointId)) {
    visiblePoints = trimDiagramPolyline(visiblePoints, true, INTEGRATED_FUSION_OFFSET);
    trimmedEndpoints.push(wire.fromEndpointId);
  }
  if (isIntegratedCableEndpoint(wire.toEndpointId)) {
    visiblePoints = trimDiagramPolyline(visiblePoints, false, INTEGRATED_FUSION_OFFSET);
    trimmedEndpoints.push(wire.toEndpointId);
  }
  const segmentBridges = visiblePoints.slice(0, -1).map(() => [] as Array<RoutedWire["bridges"][number]>);
  wire.bridges.forEach((bridge) => {
    const candidates = visiblePoints.slice(0, -1).flatMap((first, segmentIndex) => {
      const second = visiblePoints[segmentIndex + 1];
      if (!bridgeIsOnSegment(bridge, first, second)) return [];
      const coordinate = axisCoordinate(bridge.point, bridge.axis);
      const clearance = Math.min(
        Math.abs(coordinate - axisCoordinate(first, bridge.axis)),
        Math.abs(coordinate - axisCoordinate(second, bridge.axis)),
      );
      return [{ segmentIndex, clearance }];
    });
    const selected = candidates.toSorted((first, second) => second.clearance - first.clearance)[0];
    if (selected) segmentBridges[selected.segmentIndex].push(bridge);
  });

  const jumpsBySegment = segmentBridges.map((bridges, segmentIndex) => {
    const first = visiblePoints[segmentIndex]; const second = visiblePoints[segmentIndex + 1];
    const axis = segmentAxis(first, second);
    if (!axis || bridges.length === 0) return [];
    const firstCoordinate = axisCoordinate(first, axis); const secondCoordinate = axisCoordinate(second, axis);
    const segmentLow = Math.min(firstCoordinate, secondCoordinate);
    const segmentHigh = Math.max(firstCoordinate, secondCoordinate);
    const coordinates = bridges.map((bridge) => axisCoordinate(bridge.point, axis)).toSorted((a, b) => a - b);
    const groups: number[][] = [];
    coordinates.forEach((coordinate) => {
      const group = groups.at(-1);
      if (!group || coordinate - group.at(-1)! > WIRE_JUMP_GROUP_GAP) groups.push([coordinate]);
      else group.push(coordinate);
    });
    const fixedCoordinate = axis === "horizontal" ? first.y : first.x;
    const direction = Math.sign(secondCoordinate - firstCoordinate);
    const jumps = groups.map((group): WireJumpGeometry => {
      const low = Math.max(segmentLow, group[0] - WIRE_JUMP_HALF_LENGTH);
      const high = Math.min(segmentHigh, group.at(-1)! + WIRE_JUMP_HALF_LENGTH);
      const startCoordinate = direction > 0 ? low : high; const endCoordinate = direction > 0 ? high : low;
      return {
        axis,
        start: pointOnAxis(axis, startCoordinate, fixedCoordinate),
        end: pointOnAxis(axis, endCoordinate, fixedCoordinate),
        rise: Math.min(WIRE_JUMP_RISE, Math.max(4, Math.abs(high - low) * 0.42)),
        crossingCount: group.length,
      };
    });
    return direction > 0 ? jumps : jumps.reverse();
  });

  const path = [`M${visiblePoints[0].x},${visiblePoints[0].y}`];
  visiblePoints.slice(0, -1).forEach((_, segmentIndex) => {
    jumpsBySegment[segmentIndex].forEach((jump) => {
      path.push(`L${jump.start.x},${jump.start.y}`, jumpCurveCommands(jump));
    });
    const end = visiblePoints[segmentIndex + 1];
    path.push(`L${end.x},${end.y}`);
  });
  return { path: path.join(" "), jumps: jumpsBySegment.flat(), trimmedEndpoints };
}

function wrappedLabel(label: string, maxCharacters: number, maxLines: number) {
  const words = label.trim().split(/\s+/); const lines: string[] = [];
  for (const word of words) {
    if (word.length > maxCharacters) return undefined;
    const candidate = lines.length ? `${lines.at(-1)} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      if (lines.length) lines[lines.length - 1] = candidate;
      else lines.push(candidate);
    } else if (lines.length < maxLines) lines.push(word);
    else return undefined;
  }
  return lines;
}

function truncatedLabel(label: string, maxCharacters: number, maxLines: number) {
  const lines: string[] = []; let remaining = label.trim().replace(/\s+/g, " ");
  while (remaining && lines.length < maxLines) {
    if (remaining.length <= maxCharacters) { lines.push(remaining); break; }
    const lastLine = lines.length === maxLines - 1;
    const limit = Math.max(2, maxCharacters - (lastLine ? 1 : 0));
    const wordBoundary = remaining.lastIndexOf(" ", limit);
    const cut = wordBoundary >= Math.ceil(limit * 0.5) ? wordBoundary : limit;
    lines.push(`${remaining.slice(0, cut).trim()}${lastLine ? "…" : ""}`);
    remaining = remaining.slice(cut).trim();
  }
  return lines;
}

function deviceLabelLayout(label: string, width: number, height: number, viewScale: number) {
  const minimumFontSize = Math.max(15, 8 / Math.max(MIN_SCALE, viewScale));
  const maximumFontSize = Math.max(28, minimumFontSize);
  for (let fontSize = maximumFontSize; fontSize >= minimumFontSize; fontSize -= 0.5) {
    const maxCharacters = Math.max(3, Math.floor((width - 30) / (fontSize * 0.59)));
    const maxLines = Math.max(1, Math.min(3, Math.floor((height - 22) / (fontSize * 1.16))));
    const lines = wrappedLabel(label, maxCharacters, maxLines);
    if (lines) return { lines, fontSize, lineHeight: fontSize * 1.16 };
  }
  const fontSize = minimumFontSize;
  const maxCharacters = Math.max(3, Math.floor((width - 30) / (fontSize * 0.59)));
  const maxLines = Math.max(1, Math.min(3, Math.floor((height - 22) / (fontSize * 1.16))));
  return { lines: truncatedLabel(label, maxCharacters, maxLines), fontSize, lineHeight: fontSize * 1.16 };
}

function PortGraphic({ port, point, ownerLabel, viewScale, onSelect, boundary = false }: {
  port: DiagramPort; point: Point; ownerLabel: string; viewScale: number;
  onSelect: (selection: GraphSelection) => void;
  boundary?: boolean;
}) {
  const textWidth = Math.max(74, Math.min(310, port.label.length * 6.7 + 20));
  const inverseScale = 1 / Math.max(MIN_SCALE, viewScale);
  const labelX = (port.side === "input" ? boundary ? 12 : -textWidth - 12
    : port.side === "output" ? boundary ? -textWidth - 12 : 12 : -textWidth / 2) * inverseScale;
  const labelY = (port.side === "neutral" ? boundary ? -40 : 15 : port.side === "top" ? -40 : -14) * inverseScale;
  return (
    <g className="diagram-port-anchor" transform={`translate(${point.x} ${point.y})`}>
      <g className={`diagram-port diagram-port-${port.side}`}
        data-port-side={port.side} data-boundary-port={boundary ? "true" : "false"}
        data-endpoint-id={port.selectionKey}
        role="button" tabIndex={0} aria-label={`${ownerLabel} · ${port.label}`}
        onClick={(event) => { event.stopPropagation(); onSelect({ type: "conductor", conductorKey: port.selectionKey, connectionId: port.connectionId }); }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation(); onSelect({ type: "conductor", conductorKey: port.selectionKey, connectionId: port.connectionId });
        } }}>
        <circle r={PORT_RADIUS + 6} className="diagram-port-hit" />
        <circle r={PORT_RADIUS} className="diagram-conductor" style={{ fill: diagramConductorColor[port.kind] }} />
        <title>{port.label}</title>
      </g>
      <g className="diagram-port-label" transform={`translate(${labelX} ${labelY}) scale(${inverseScale})`}>
        <rect width={textWidth} height="25" rx="5" /><text x="10" y="17">{port.label}</text>
      </g>
    </g>
  );
}

function centroid(points: readonly Point[]) {
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: center.x / points.length, y: center.y / points.length };
}

export function UnifiedSystemDiagram({ fadePurchased, onFadePurchasedChange, onSelect, onClearSelection,
  inspectorOpen = false }: Props) {
  const [activeJunctionId, setActiveJunctionId] = useState<string>();
  const [hoveredWireId, setHoveredWireId] = useState<string>();
  const [view, setViewState] = useState<ViewTransform>({ x: 0, y: 0, scale: 0.5 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const diagramRef = useRef<HTMLElement>(null); const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<SVGGElement>(null); const viewRef = useRef(view);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: ViewTransform; center: Point; distance: number; world: Point } | undefined>(undefined);
  const nativeGesture = useRef<{ view: ViewTransform; scale: number; world: Point } | undefined>(undefined);
  const moved = useRef(false); const suppressClickUntil = useRef(0);
  const viewFrame = useRef<number | undefined>(undefined);
  const viewCommitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rememberedViews = useRef(new Map<string, ViewTransform>());
  const mountedLayoutKey = useRef<string | undefined>(undefined);
  const layout = useMemo(() => hydrateDiagramLayout(activeJunctionId), [activeJunctionId]);
  const renderedWires = useMemo(() => layout.wires.map((wire) => ({
    wire,
    ...wireRenderGeometry(wire),
  })), [layout]);
  const hoveredWire = renderedWires.find(({ wire }) => wire.route.id === hoveredWireId);
  const applyViewToDom = useCallback((value: ViewTransform) => {
    contentRef.current?.setAttribute("transform", `translate(${value.x} ${value.y}) scale(${value.scale})`);
    if (diagramRef.current) {
      diagramRef.current.dataset.viewX = value.x.toFixed(2);
      diagramRef.current.dataset.viewY = value.y.toFixed(2);
      diagramRef.current.dataset.viewScale = value.scale.toFixed(4);
    }
  }, []);
  const setView = useCallback((next: ViewTransform | ((previous: ViewTransform) => ViewTransform)) => {
    const value = typeof next === "function" ? next(viewRef.current) : next;
    viewRef.current = value;
    if (viewCommitTimer.current !== undefined) clearTimeout(viewCommitTimer.current);
    // Reconcile label sizing and toolbar text only after the gesture becomes
    // idle. During a pinch, Chromium receives one transform mutation per RAF
    // instead of reconciling the full SVG tree for every wheel event.
    viewCommitTimer.current = setTimeout(() => {
      viewCommitTimer.current = undefined; setViewState(viewRef.current);
    }, 90);
    if (viewFrame.current === undefined) viewFrame.current = requestAnimationFrame(() => {
      viewFrame.current = undefined; applyViewToDom(viewRef.current);
    });
  }, [applyViewToDom]);
  const setViewImmediately = useCallback((value: ViewTransform) => {
    viewRef.current = value;
    if (viewCommitTimer.current !== undefined) {
      clearTimeout(viewCommitTimer.current);
      viewCommitTimer.current = undefined;
    }
    if (viewFrame.current !== undefined) {
      cancelAnimationFrame(viewFrame.current);
      viewFrame.current = undefined;
    }
    applyViewToDom(value);
    setViewState(value);
  }, [applyViewToDom]);
  const fitLayout = useCallback((target = layout) => {
    if (!viewportSize.width || !viewportSize.height) return;
    const padding = 46;
    const scale = Math.max(MIN_SCALE, Math.min(1.18,
      (viewportSize.width - padding * 2) / target.width, (viewportSize.height - padding * 2) / target.height));
    setViewImmediately({ scale, x: (viewportSize.width - target.width * scale) / 2,
      y: (viewportSize.height - target.height * scale) / 2 });
  }, [layout, setViewImmediately, viewportSize]);
  const rememberCurrentView = useCallback(() => {
    rememberedViews.current.set(layout.key, { ...viewRef.current });
  }, [layout.key]);
  const enterJunction = useCallback((junctionId: string) => {
    rememberCurrentView();
    onClearSelection?.();
    setActiveJunctionId(junctionId);
  }, [onClearSelection, rememberCurrentView]);
  const exitJunction = useCallback(() => {
    rememberCurrentView();
    onClearSelection?.();
    setActiveJunctionId(undefined);
  }, [onClearSelection, rememberCurrentView]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(viewport); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!viewportSize.width || mountedLayoutKey.current === layout.key) return;
    mountedLayoutKey.current = layout.key;
    const remembered = rememberedViews.current.get(layout.key);
    if (remembered) setViewImmediately(remembered);
    else fitLayout(layout);
  }, [fitLayout, layout, setViewImmediately, viewportSize]);
  useLayoutEffect(() => { applyViewToDom(viewRef.current); }, [applyViewToDom, layout, view]);
  useEffect(() => () => {
    if (viewFrame.current !== undefined) cancelAnimationFrame(viewFrame.current);
    if (viewCommitTimer.current !== undefined) clearTimeout(viewCommitTimer.current);
  }, []);
  useEffect(() => {
    if (!activeJunctionId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (inspectorOpen) return;
      event.preventDefault();
      event.stopPropagation();
      exitJunction();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeJunctionId, exitJunction, inspectorOpen]);
  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect(); return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);
  const beginGesture = useCallback(() => {
    const values = [...pointers.current.values()];
    if (values.length === 0) { gesture.current = undefined; return; }
    const center = centroid(values);
    const distance = values.length > 1 ? Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) : 0;
    const current = viewRef.current;
    gesture.current = { view: current, center, distance,
      world: { x: (center.x - current.x) / current.scale, y: (center.y - current.y) / current.scale } };
  }, []);
  const zoomAt = useCallback((point: Point, factor: number) => {
    setView((current) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
      const world = { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale };
      return { scale, x: point.x - world.x * scale, y: point.y - world.y * scale };
    });
  }, [setView]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // React delegates wheel events at the document root, where Chromium may
    // treat the listener as passive. A native non-passive listener on the
    // patcher itself guarantees that trackpad pinch never escapes to browser
    // page zoom. Plain two-finger scroll remains screen-space pan.
    const handleWheel = (rawEvent: Event) => {
      const event = rawEvent as WheelEvent;
      event.preventDefault(); event.stopPropagation();
      if (event.ctrlKey) {
        zoomAt(localPoint(event.clientX, event.clientY), Math.exp(-event.deltaY * 0.012));
        return;
      }
      setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    type NativeGestureEvent = Event & { clientX?: number; clientY?: number; scale?: number };
    const gesturePoint = (event: NativeGestureEvent) => event.clientX === undefined || event.clientY === undefined
      ? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }
      : localPoint(event.clientX, event.clientY);
    const handleGestureStart = (rawEvent: Event) => {
      const event = rawEvent as NativeGestureEvent; event.preventDefault(); event.stopPropagation();
      const point = gesturePoint(event); const current = viewRef.current;
      nativeGesture.current = { view: current, scale: event.scale ?? 1,
        world: { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale } };
    };
    const handleGestureChange = (rawEvent: Event) => {
      const event = rawEvent as NativeGestureEvent; event.preventDefault(); event.stopPropagation();
      const initial = nativeGesture.current;
      if (!initial) return;
      const point = gesturePoint(event);
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
        initial.view.scale * (event.scale ?? 1) / Math.max(0.01, initial.scale)));
      setView({ scale, x: point.x - initial.world.x * scale, y: point.y - initial.world.y * scale });
    };
    const handleGestureEnd = (event: Event) => {
      event.preventDefault(); event.stopPropagation(); nativeGesture.current = undefined;
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("gesturestart", handleGestureStart, { passive: false });
    viewport.addEventListener("gesturechange", handleGestureChange, { passive: false });
    viewport.addEventListener("gestureend", handleGestureEnd, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("gesturestart", handleGestureStart);
      viewport.removeEventListener("gesturechange", handleGestureChange);
      viewport.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [localPoint, setView, zoomAt]);

  return (
    <section ref={diagramRef} className="unified-diagram" data-diagram="canonical-graph-subpatch" data-diagram-scope={layout.scope}
      data-junction-id={activeJunctionId ?? ""} data-device-count={dseRuntime.devices.length}
      data-wire-count={dseRuntime.routes.length} data-visible-device-count={layout.nodes.length}
      data-visible-wire-count={layout.wires.length} data-junctions-abstracted={layout.scope === "system" ? "true" : "false"}
      data-orthogonal-t-join-count={layout.nodes.filter((node) => node.device.diagramJoinGeometry === "orthogonal-t").length}
      data-junction-internals-visible={layout.scope === "junction" ? "true" : "false"}
      data-coincident-wire-segments={layout.coincidentSegments} data-conductor-overlaps={layout.conductorOverlaps}
      data-non-orthogonal-wire-segments={layout.nonOrthogonalSegments}
      data-unbridged-wire-crossings={layout.unbridgedCrossings} data-bridged-wire-crossings={layout.bridgedCrossings}
      data-parallel-wire-envelope-overlaps={layout.parallelEnvelopeOverlaps}
      data-minimum-parallel-wire-separation={layout.minimumParallelWireSeparation}
      data-routing-lane-spacing={MIN_WIRE_LANE_SPACING}
      data-wire-node-body-crossings={layout.nodeBodyCrossings}
      data-masked-wire-node-body-crossings={layout.maskedNodeBodyCrossings}
      data-node-overlaps={layout.nodeOverlaps} data-wire-turns={layout.wireTurns}
      data-wire-length={layout.wireLength}
      data-interchangeable-tap-candidates={layout.interchangeableTapCandidates}
      data-interchangeable-tap-reassignments={layout.interchangeableTapReassignments}
      data-busbar-landing-candidates={layout.busbarLandingCandidates}
      data-busbar-landing-reassignments={layout.busbarLandingReassignments}
      data-peer-ordered-busbars={layout.peerOrderedBusbarIds.join(",")}
      data-tap-routing-order-candidates={layout.tapRoutingOrderCandidates}
      data-selected-routing-order={layout.selectedRoutingOrder}
      data-routing-fallbacks={layout.routingFallbacks} data-layout-hydration="index-only"
      data-current-safety-status={dseRuntime.diagnostics.currentSafety.status}
      data-current-safety-errors={dseRuntime.diagnostics.currentSafety.errors.length}
      data-current-safety-warnings={dseRuntime.diagnostics.currentSafety.warnings.length}
      data-precomputed-layout-ms={layout.precomputedLayoutMs?.toFixed(1)}
      data-diagram-routing-ms="0.0" data-layout-source="build-generated-artifact"
      data-wire-geometry="orthogonal-grid" data-wire-crossing-rendering="arched-jumps"
      data-wire-continuity="single-path-with-integrated-jumps"
      data-port-layout="inputs-left-outputs-right-storage-signals-bottom" data-page-zoom-captured="true"
      data-zoom-rendering="raf-transform-idle-react-reconcile"
      data-view-memory="per-layout-preserved" data-earth-color={diagramConductorColor.earth}
      data-escape-navigation={inspectorOpen ? "close-inspector" : activeJunctionId ? "back-to-system" : "inactive"}
      data-view-x={view.x.toFixed(2)} data-view-y={view.y.toFixed(2)} data-view-scale={view.scale.toFixed(4)}
      data-touch-navigation="pinch-zoom-two-finger-pan">
      <div className="diagram-unified-toolbar">
        <div className="diagram-title-stack">
          <div className="diagram-breadcrumbs">
            {activeJunctionId && <button type="button" className="diagram-back-button"
              onClick={exitJunction}
              aria-label="Back to full-system diagram"><span aria-hidden="true">←</span> System</button>}
            <strong>{layout.junction?.label ?? "Detailed wiring diagram"}</strong>
          </div>
          <span>{layout.scope === "system"
            ? `PV / sources → protection & conversion → loads · batteries below · ${layout.nodes.length} devices`
            : `${layout.boundaryPorts.filter((port) => port.side === "input").length} incoming left · `
              + `${layout.boundaryPorts.filter((port) => port.side === "output").length} outgoing right · `
              + `${layout.boundaryPorts.filter((port) => port.side === "neutral").length} battery / earth / data below`}</span>
        </div>
        <div className="diagram-zoom-controls" aria-label="Diagram zoom">
          <CurrentSafetySummary />
          <button type="button" onClick={() => zoomAt({ x: viewportSize.width / 2, y: viewportSize.height / 2 }, 0.82)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => fitLayout()} aria-label="Fit diagram">{Math.round(view.scale * 100)}%</button>
          <button type="button" onClick={() => zoomAt({ x: viewportSize.width / 2, y: viewportSize.height / 2 }, 1.22)} aria-label="Zoom in">+</button>
          <label className="fade-toggle"><input type="checkbox" checked={fadePurchased}
            onChange={(event) => onFadePurchasedChange(event.target.checked)} />Fade purchased</label>
        </div>
      </div>
      <div ref={viewportRef} className="unified-diagram-viewport"
        role="button" tabIndex={0} aria-label="Interactive wiring diagram canvas"
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && inspectorOpen) onClearSelection?.();
        }}
        onClick={() => {
          if (performance.now() < suppressClickUntil.current) return;
          onClearSelection?.();
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1) return;
          event.preventDefault();
          // Pointer capture retargets the eventual mouse click to the viewport
          // in Chromium. Touch needs capture for a stable two-finger gesture;
          // mouse clicks must remain targeted at nodes and conductors.
          if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, localPoint(event.clientX, event.clientY)); moved.current = false; beginGesture();
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, localPoint(event.clientX, event.clientY));
          const values = [...pointers.current.values()];
          if (!(event.pointerType === "mouse" || values.length >= 2) || !gesture.current) return;
          const center = centroid(values);
          if (Math.hypot(center.x - gesture.current.center.x, center.y - gesture.current.center.y) > 3) moved.current = true;
          const distance = values.length > 1 ? Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) : gesture.current.distance;
          const scale = values.length > 1 && gesture.current.distance > 4
            ? Math.max(MIN_SCALE, Math.min(MAX_SCALE, gesture.current.view.scale * distance / gesture.current.distance))
            : gesture.current.view.scale;
          event.preventDefault(); setView({ scale, x: center.x - gesture.current.world.x * scale,
            y: center.y - gesture.current.world.y * scale });
        }}
        onPointerUp={(event) => { pointers.current.delete(event.pointerId);
          if (moved.current) suppressClickUntil.current = performance.now() + 180; beginGesture(); }}
        onPointerCancel={(event) => { pointers.current.delete(event.pointerId); beginGesture(); }}>
        <svg className="unified-diagram-svg" width="100%" height="100%" role="img"
          aria-label={layout.scope === "system" ? "Detailed DSE Fiji electrical wiring diagram"
            : `${layout.junction!.label} internal wiring subpatch`}>
          <g ref={contentRef} key={layout.key} className="diagram-content"
            transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <g className="diagram-wire-layer">
              {renderedWires.map(({ wire, path, jumps, trimmedEndpoints }) => <g key={wire.route.id}>
                <path d={path}
                  className={`diagram-wire ${wire.route.status === "hold" ? "hold" : ""}`}
                  style={{ stroke: wire.color, strokeWidth: wire.width }} data-connection-id={wire.route.id}
                  data-from-endpoint={wire.fromEndpointId} data-to-endpoint={wire.toEndpointId}
                  data-integrated-fusion-trimmed={trimmedEndpoints.length > 0
                    ? trimmedEndpoints.join(" ") : undefined}
                  data-crossing-count={wire.bridges.length} data-jump-count={jumps.length}
                  onPointerEnter={() => setHoveredWireId(wire.route.id)}
                  onPointerLeave={() => setHoveredWireId((current) => current === wire.route.id ? undefined : current)}
                  onClick={(event) => { event.stopPropagation();
                    const conductorKey = dseRuntime.conductorByKey.has(wire.fromEndpointId)
                      ? wire.fromEndpointId : wire.route.from;
                    onSelect({ type: "conductor", conductorKey, connectionId: wire.route.id }); }}>
                  <title>{wire.route.label ?? wire.route.id}</title>
                </path>
              </g>)}
              <g className="diagram-local-bridge-layer" aria-hidden="true">
                {renderedWires.flatMap(({ wire, jumps }) => jumps.map((jump, index) => <g
                  key={`${wire.route.id}-bridge-${index}`} data-connection-id={wire.route.id}
                  data-crossing-count={jump.crossingCount}>
                  <path d={localJumpPath(jump)} className="diagram-wire-local-underlay"
                    style={{ strokeWidth: wire.width + 6 }} />
                  <path d={localJumpPath(jump)} className="diagram-wire-local-overpass"
                    style={{ stroke: wire.color, strokeWidth: wire.width }} />
                </g>))}
              </g>
            </g>
            {layout.nodes.map((node) => {
              const faded = fadePurchased && isPurchasedDevice(node.device);
              const label = deviceLabelLayout(node.device.label, node.width, node.height, view.scale);
              const wireJoin = isDiagramJoin(node.device);
              const rigidRail = node.device.presentation === "rigid-rail";
              const integratedCable = node.device.presentation === "integrated-cable-breakout"
                ? node.device.conductors.find((conductor) => (
                  conductor.kind === "multicore" && (conductor.internalMates?.length ?? 0) >= 2
                ))
                : undefined;
              const integratedCablePort = integratedCable
                ? node.ports.find((port) => port.id === integratedCable.id)
                : undefined;
              const integratedCablePoint = integratedCablePort ? portPoint(node, integratedCablePort) : undefined;
              const integratedFusion = integratedCablePort && integratedCablePoint ? (() => {
                const local = { x: integratedCablePoint.x - node.x, y: integratedCablePoint.y - node.y };
                if (integratedCablePort.side === "input") return { x: -node.width / 2 - 22, y: local.y };
                if (integratedCablePort.side === "output") return { x: node.width / 2 + 22, y: local.y };
                return { x: local.x, y: node.height / 2 + 22 };
              })() : undefined;
              const joinArmWidths = wireJoin ? node.ports.map((port) => wireJoinArmWidth(node, port)) : [];
              const railGroups = rigidRail
                ? Object.values(Object.groupBy(node.ports, (port) => port.kind)).filter(Boolean)
                : [];
              return <g key={node.device.id}
                className={`diagram-device diagram-device-${node.device.kind}${node.abstractJunction ? " diagram-subpatch-node" : ""}${wireJoin ? " diagram-wire-join-node" : ""}${node.device.diagramJoinGeometry === "orthogonal-t" ? " diagram-wire-join-orthogonal-t" : ""}${rigidRail ? " diagram-rigid-rail-node" : ""}${faded ? " faded" : ""}${node.device.status === "hold" ? " hold" : ""}`}
                transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={node.device.label}
                data-device-id={node.device.id} data-join-geometry={node.device.diagramJoinGeometry ?? ""}
                onClick={(event) => { event.stopPropagation(); if (performance.now() < suppressClickUntil.current) return;
                  if (node.abstractJunction) { enterJunction(node.device.id); return; }
                  onSelect({ type: "device", deviceId: node.device.id }); }}
                onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return;
                  if (node.abstractJunction) { enterJunction(node.device.id); return; }
                  onSelect({ type: "device", deviceId: node.device.id }); }}>
                {wireJoin ? <>
                  <circle className="diagram-wire-join-hit" r={node.width / 2} />
                  {node.ports.map((port) => {
                    const point = portPoint(node, port);
                    return <path key={port.id} className="diagram-wire-join-arm"
                      data-endpoint-id={`${node.device.id}.${port.id}`}
                      d={`M${point.x - node.x},${point.y - node.y} L0,0`}
                      style={{ stroke: diagramConductorColor[port.kind], strokeWidth: wireJoinArmWidth(node, port) }} />;
                  })}
                  <circle className="diagram-wire-join-center"
                    r={Math.max(5, ...joinArmWidths.map((width) => width / 2 + 2))}
                    style={{ fill: diagramConductorColor[node.ports[0]?.kind ?? "data"] }} />
                </> : rigidRail ? <>
                  <rect className="diagram-rigid-rail-hit" x={-node.width / 2} y={-node.height / 2}
                    width={node.width} height={node.height} rx="8" />
                  {railGroups.map((ports) => {
                    const present = ports!; const points = present.map((port) => portPoint(node, port));
                    const left = Math.min(...points.map((point) => point.x - node.x)) - 12;
                    const right = Math.max(...points.map((point) => point.x - node.x)) + 12;
                    return <g key={present[0].kind}>
                      <path className="diagram-rigid-rail-backbone" d={`M${left},0 H${right}`} />
                      <path className="diagram-rigid-rail-core" d={`M${left},0 H${right}`}
                        style={{ stroke: diagramConductorColor[present[0].kind] }} />
                      {present.map((port, index) => <path key={port.id} className="diagram-rigid-rail-tooth"
                        d={`M${points[index].x - node.x},${points[index].y - node.y} V0`}
                        style={{ stroke: diagramConductorColor[port.kind] }} />)}
                    </g>;
                  })}
                  <text className="diagram-rigid-rail-label" textAnchor="middle" y="-15">{node.device.label}</text>
                </> : <>
                  <rect x={-node.width / 2} y={-node.height / 2} width={node.width} height={node.height}
                    rx={node.device.kind === "breaker" ? 5 : 11} />
                  {integratedCable && integratedFusion && <g className="diagram-integrated-breakout"
                    data-integrated-cable-endpoint={`${node.device.id}.${integratedCable.id}`}>
                    {integratedCable.internalMates?.map((mateId) => {
                      const mate = node.ports.find((port) => port.id === mateId);
                      if (!mate) return null;
                      const point = portPoint(node, mate);
                      return <path key={mate.id} className="diagram-integrated-breakout-arm"
                        data-endpoint-id={`${node.device.id}.${mate.id}`}
                        d={`M${point.x - node.x},${point.y - node.y} L${integratedFusion.x},${integratedFusion.y}`}
                        style={{ stroke: diagramConductorColor[mate.kind], strokeWidth: wireJoinArmWidth(node, mate) }} />;
                    })}
                    <circle className="diagram-integrated-breakout-center" cx={integratedFusion.x}
                      cy={integratedFusion.y} r="5" />
                  </g>}
                  {node.abstractJunction && <>
                    <path className="diagram-subpatch-arrow" d={`M${node.width / 2 - 42},${-node.height / 2 + 27} h18 m-7,-7 7,7 -7,7`} />
                    {node.ports.some((port) => port.side === "input") && <text className="diagram-junction-edge-label"
                      x={-node.width / 2 + 20} y={-node.height / 2 + 30}>INPUTS</text>}
                    {node.ports.some((port) => port.side === "output") && <text className="diagram-junction-edge-label"
                      textAnchor="end" x={node.width / 2 - 52} y={-node.height / 2 + 30}>OUTPUTS</text>}
                  </>}
                  <text className="diagram-device-title" textAnchor="middle"
                    style={{ fontSize: label.fontSize }}
                    y={-(label.lines.length - 1) * label.lineHeight / 2 + label.fontSize * 0.34}>
                    {label.lines.map((line, index) => <tspan key={`${line}-${index}`} x="0"
                      dy={index === 0 ? 0 : label.lineHeight}>{line}</tspan>)}
                  </text>
                </>}
                <title>{node.device.label}</title>
              </g>;
            })}
            {layout.nodes.flatMap((node) => isDiagramJoin(node.device) ? [] : node.ports
              .filter((port) => !isIntegratedCableEndpoint(port.selectionKey))
              .map((port) => <PortGraphic key={`${node.device.id}-${port.id}`} port={port} point={portPoint(node, port)}
                ownerLabel={node.device.label} viewScale={view.scale} onSelect={onSelect} />))}
            {layout.scope === "junction" && <g className="diagram-boundary-glands">
              {Object.entries(Object.groupBy(layout.boundaryPorts, (port) => port.glandId ?? port.id)).map(([glandId, ports]) => {
                const present = ports!; const vertical = present[0].side !== "neutral";
                const minimum = Math.min(...present.map((port) => vertical ? port.point.y : port.point.x));
                const maximum = Math.max(...present.map((port) => vertical ? port.point.y : port.point.x));
                const anchor = present[0].point;
                return <g key={glandId}><rect x={vertical ? anchor.x - 13 : minimum - 15}
                  y={vertical ? minimum - 15 : anchor.y - 13}
                  width={vertical ? 26 : maximum - minimum + 30}
                  height={vertical ? maximum - minimum + 30 : 26} rx="13" />
                </g>;
              })}
            </g>}
            {layout.boundaryPorts.map((port) => <PortGraphic key={port.id} port={port} point={port.point}
              ownerLabel={layout.junction!.label} viewScale={view.scale} onSelect={onSelect} boundary />)}
            {hoveredWire && <g className="diagram-wire-hover-layer" aria-hidden="true"
              data-connection-id={hoveredWire.wire.route.id} data-jump-count={hoveredWire.jumps.length}>
              <path d={hoveredWire.path} className="diagram-wire-hover-clearance"
                style={{ strokeWidth: HOVERED_WIRE_WIDTH + HOVERED_WIRE_CLEARANCE }} />
              <path d={hoveredWire.path}
                className={`diagram-wire-foreground ${hoveredWire.wire.route.status === "hold" ? "hold" : ""}`}
                style={{ stroke: hoveredWire.wire.color, strokeWidth: HOVERED_WIRE_WIDTH }} />
            </g>}
          </g>
        </svg>
      </div>
    </section>
  );
}
