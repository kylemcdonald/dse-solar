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
type PortSide = "input" | "output" | "neutral";
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
const ATTACHED_JOIN_GAP = 72;
const BATTERY_JOIN_GAP = 84;
const JUNCTION_COLUMN_GAP = 168;
const JUNCTION_ROW_GAP = 108;
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
  const longestText = device.label.length;
  const densityWidth = 120 + Math.ceil(Math.sqrt(Math.max(1, ports.length))) * 36;
  const sidePitch = abstractJunction || device.presentation === "wall-passthrough"
    ? ABSTRACT_GLAND_PITCH : PORT_PITCH;
  return {
    width: snapUp(Math.max(baseWidth, longestText * 7.2 + 48,
      bottomCount * (abstractJunction ? ABSTRACT_GLAND_PITCH : PORT_PITCH) + 48,
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
  return { x: node.x + offset, y: node.y + node.height / 2 };
}

function outwardVector(side: PortSide): Point {
  if (side === "input") return { x: -1, y: 0 };
  if (side === "output") return { x: 1, y: 0 };
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
    if (device.kind === "junction") return 4;
    if (device.kind === "inverter") return 6;
    if (device.componentId === "toolOutlet") return 9;
    if (device.presentation === "cable-breakout") return /AC-out/i.test(device.label) ? 7 : 5;
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
  return familyRowOffset(node.device, node.height);
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

function layoutWorldNodes(nodes: DiagramNode[]) {
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

  nodes.forEach((node) => { node.x = snap(node.x); node.y = snap(node.y); });
  orientAttachedJoinPorts(nodes);
  return normalizeNodes(nodes);
}

function normalizeNodes(nodes: DiagramNode[]) {
  const minX = Math.min(...nodes.map((node) => node.x - node.width / 2));
  const minY = Math.min(...nodes.map((node) => node.y - node.height / 2));
  const shiftX = snap(LAYOUT_MARGIN - minX);
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
  const nodeIds = new Set(nodes.map((node) => node.device.id));
  const adjacency = new Map(nodes.map((node) => [node.device.id, new Set<string>()]));
  const reverse = new Map(nodes.map((node) => [node.device.id, new Set<string>()]));
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
  nodes.forEach((node) => { if (!indexById.has(node.device.id)) visit(node.device.id); });
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
  const rankById = new Map(nodes.map((node) => [node.device.id, componentRank[componentById.get(node.device.id)!]]));
  const rankCount = Math.max(...rankById.values()) + 1;
  const columns = Array.from({ length: rankCount }, (_, rank) => nodes.filter((node) => rankById.get(node.device.id) === rank));
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

/** An attached three-way splice points its single device arm toward its owner
 * and fans the other two arms diagonally away. Sides—not point coordinates—are
 * the only input, so every Y remains automatic after a layout rerun. */
function orientAttachedJoinPorts(nodes: readonly DiagramNode[]) {
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  nodes.filter((node) => node.device.presentation === "wire-join" && node.device.attachment)
    .forEach((node) => {
      const owner = nodeById.get(endpointDeviceId(node.device.attachment!.endpoint));
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
  const sideOrder: Record<PortSide, number> = { input: 0, output: 1, neutral: 2 };
  nodes.forEach((node) => node.ports.sort((first, second) => {
    if (first.side !== second.side) return sideOrder[first.side] - sideOrder[second.side];
    if (first.declaredOrder !== undefined || second.declaredOrder !== undefined) {
      const orderDifference = (first.declaredOrder ?? Number.MAX_SAFE_INTEGER)
        - (second.declaredOrder ?? Number.MAX_SAFE_INTEGER);
      if (orderDifference !== 0) return orderDifference;
    }
    const firstTarget = targetPoint(first.endpointId); const secondTarget = targetPoint(second.endpointId);
    if (!firstTarget || !secondTarget) return first.id.localeCompare(second.id);
    const coordinate = first.side === "neutral" ? "x" : "y";
    return firstTarget[coordinate] - secondTarget[coordinate] || first.id.localeCompare(second.id);
  }));
}

/** Let tall logical hubs use their full edge. A source near the top of a
 * junction now lands near the top instead of taking a long vertical detour to
 * an arbitrarily centered terminal block. */
function alignHubPortsTowardPeers(nodes: readonly DiagramNode[], seeds: readonly WireSeed[],
  boundaryPorts: readonly BoundaryPort[] = []) {
  const ownerByEndpoint = new Map<string, DiagramNode>();
  nodes.forEach((node) => node.ports.forEach((port) => ownerByEndpoint.set(port.endpointId, node)));
  const boundaryByEndpoint = new Map(boundaryPorts.map((port) => [port.endpointId, port.point]));
  const peersByEndpoint = new Map<string, string[]>();
  seeds.forEach((seed) => {
    const fromPeers = peersByEndpoint.get(seed.fromEndpointId) ?? [];
    fromPeers.push(seed.toEndpointId); peersByEndpoint.set(seed.fromEndpointId, fromPeers);
    const toPeers = peersByEndpoint.get(seed.toEndpointId) ?? [];
    toPeers.push(seed.fromEndpointId); peersByEndpoint.set(seed.toEndpointId, toPeers);
  });
  const target = (endpointId: string) => {
    const peers = peersByEndpoint.get(endpointId) ?? [];
    const points = peers.flatMap((peer) => {
      const owner = ownerByEndpoint.get(peer); const point = owner ? { x: owner.x, y: owner.y } : boundaryByEndpoint.get(peer);
      return point ? [point] : [];
    });
    return points.length ? { x: mean(points.map((point) => point.x)), y: mean(points.map((point) => point.y)) } : undefined;
  };
  nodes.filter((node) => node.abstractJunction || node.device.presentation === "wall-passthrough").forEach((node) => {
    (["input", "output", "neutral"] as const).forEach((side) => {
      const ports = node.ports.filter((port) => port.side === side);
      if (!ports.length) return;
      const horizontal = side === "neutral";
      const halfExtent = (horizontal ? node.width : node.height) / 2 - 48;
      const pitch = nodePortPitch(node);
      const desired = ports.map((port) => {
        const point = target(port.endpointId);
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
    layoutWorldNodes(worldDevices.map((device) => prepareWorldNode(device, portSets.get(device.id)!))),
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
  orientAttachedJoinPorts(nodes);
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
  orderPortsTowardPeers(nodes, seeds, boundaryPorts);
  alignHubPortsTowardPeers(nodes, seeds, boundaryPorts);
  return { junction, nodes, boundaryPorts, seeds, width, height };
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

function wireJoinArmWidth(node: DiagramNode, port: DiagramPort) {
  const endpoint = `${node.device.id}.${port.id}`;
  const route = dseRuntime.routes.find((candidate) => candidate.from === endpoint || candidate.to === endpoint);
  return route ? routeStrokeWidth(route) : 4;
}

/**
 * Deterministic, build-time-only Manhattan routing. Short constrained runs
 * reserve their local channels first; equally short runs put thick conductors
 * first. Later routes can cross those lanes but cannot reuse a segment or
 * enter a parallel lane inside the minimum separation. A small turn cost
 * keeps every path legible without per-device routing exceptions.
 */
function routeWires(nodes: readonly DiagramNode[], boundaryPorts: readonly BoundaryPort[], seeds: readonly WireSeed[],
  bounds: { width: number; height: number }) {
  const started = performance.now();
  const endpoints = endpointPositions(nodes, boundaryPorts);
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
  const sortedSeeds = seeds.toSorted((first, second) => (
    second.route.diameterMm - first.route.diameterMm
      || routeSpan(first) - routeSpan(second)
      || first.route.id.localeCompare(second.route.id)));
  const blocked = blockedRouteCells(nodes, bounds);
  const usedEdges = new Map<string, number>(); const occupiedCells = new Map<string, number>();
  const endpointLead = (seed: WireSeed, endpointId: string, endpoint: EndpointPosition) => {
    const ids = attachmentRoutes.get(endpointId)!; const fanIndex = ids.indexOf(seed.route.id);
    const outward = endpoint.boundary
      ? endpoint.side === "input" ? { x: 1, y: 0 }
        : endpoint.side === "output" ? { x: -1, y: 0 }
          : { x: 0, y: -1 }
      : outwardVector(endpoint.side);
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
    const from = endpoints.get(seed.fromEndpointId)!; const to = endpoints.get(seed.toEndpointId)!;
    const fromLead = endpointLead(seed, seed.fromEndpointId, from);
    const toLead = endpointLead(seed, seed.toEndpointId, to);
    const width = routeStrokeWidth(seed.route);
    reserveRoute(fromLead.terminalPath, width, usedEdges, occupiedCells);
    reserveRoute(toLead.terminalPath, width, usedEdges, occupiedCells);
  });
  const fallbackRouteIds: string[] = [];
  const routed = sortedSeeds.map((seed): RoutedWire => {
    const from = endpoints.get(seed.fromEndpointId)!; const to = endpoints.get(seed.toEndpointId)!;
    const fromLead = endpointLead(seed, seed.fromEndpointId, from);
    const toLead = endpointLead(seed, seed.toEndpointId, to);
    const width = routeStrokeWidth(seed.route);
    let middle = orthogonalPath(fromLead.point, toLead.point, directionIndex(fromLead.outward),
      directionIndex({ x: -toLead.outward.x, y: -toLead.outward.y }), blocked, usedEdges, occupiedCells, bounds, width);
    middle ??= orthogonalPath(fromLead.point, toLead.point, directionIndex(fromLead.outward),
      undefined, blocked, usedEdges, occupiedCells, bounds, width);
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
    const cable = dseRuntime.graph.cables.find((candidate) => candidate.id === seed.route.cableId)!;
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

function conductorOverlapCount(nodes: readonly DiagramNode[], boundaryPorts: readonly BoundaryPort[]) {
  const points = [...nodes.flatMap((node) => node.ports.map((port) => portPoint(node, port))),
    ...boundaryPorts.map((port) => port.point)];
  let overlaps = 0;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      if (Math.hypot(points[first].x - points[second].x, points[first].y - points[second].y) < PORT_RADIUS * 2 + 2) overlaps += 1;
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
    const routed = routeWires(projection.nodes, projection.boundaryPorts, projection.seeds, { width, height });
    return { key: `junction:${activeJunctionId}`, scope: "junction", junction: projection.junction,
      nodes: projection.nodes, boundaryPorts: projection.boundaryPorts, wires: routed.routed, width, height,
      routingMs: routed.routingMs, coincidentSegments: coincidentSegmentCount(routed.routed),
      nonOrthogonalSegments: nonOrthogonalSegmentCount(routed.routed),
      conductorOverlaps: conductorOverlapCount(projection.nodes, projection.boundaryPorts),
      routingFallbacks: routed.routingFallbacks, fallbackRouteIds: routed.fallbackRouteIds,
      bridgedCrossings: routed.bridgedCrossings, unbridgedCrossings: routed.unbridgedCrossings,
      parallelEnvelopeOverlaps: parallelEnvelopeOverlapCount(routed.routed),
      minimumParallelWireSeparation: minimumParallelWireSeparation(routed.routed),
      nodeBodyCrossings: nodeBodyCrossingCount(projection.nodes, routed.routed),
      maskedNodeBodyCrossings: 0, nodeOverlaps: nodeOverlapCount(projection.nodes),
      wireTurns: wireTurnCount(routed.routed), wireLength: wireLength(routed.routed),
      layoutMs: performance.now() - layoutStarted };
  }
  const projection = systemProjection(systemMacroCenterOverrides);
  const width = snapUp(Math.max(...projection.nodes.map((node) => node.x + node.width / 2)) + LAYOUT_MARGIN);
  const height = snapUp(Math.max(...projection.nodes.map((node) => node.y + node.height / 2)) + LAYOUT_MARGIN);
  const routed = routeWires(projection.nodes, [], projection.seeds, { width, height });
  return { key: "system", scope: "system", nodes: projection.nodes, boundaryPorts: [], wires: routed.routed,
    width, height, routingMs: routed.routingMs, coincidentSegments: coincidentSegmentCount(routed.routed),
    nonOrthogonalSegments: nonOrthogonalSegmentCount(routed.routed),
    conductorOverlaps: conductorOverlapCount(projection.nodes, []), routingFallbacks: routed.routingFallbacks,
    fallbackRouteIds: routed.fallbackRouteIds, bridgedCrossings: routed.bridgedCrossings,
    unbridgedCrossings: routed.unbridgedCrossings,
    parallelEnvelopeOverlaps: parallelEnvelopeOverlapCount(routed.routed),
    minimumParallelWireSeparation: minimumParallelWireSeparation(routed.routed),
    nodeBodyCrossings: nodeBodyCrossingCount(projection.nodes, routed.routed),
    maskedNodeBodyCrossings: 0, nodeOverlaps: nodeOverlapCount(projection.nodes),
    wireTurns: wireTurnCount(routed.routed), wireLength: wireLength(routed.routed),
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
  const labelY = (port.side === "neutral" ? boundary ? -40 : 15 : -14) * inverseScale;
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
                className={`diagram-device diagram-device-${node.device.kind}${node.abstractJunction ? " diagram-subpatch-node" : ""}${wireJoin ? " diagram-wire-join-node" : ""}${rigidRail ? " diagram-rigid-rail-node" : ""}${faded ? " faded" : ""}${node.device.status === "hold" ? " hold" : ""}`}
                transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={node.device.label}
                data-device-id={node.device.id}
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
