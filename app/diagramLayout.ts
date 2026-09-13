import { dseRuntime } from "./dseRuntime";
import { conductorColor } from "./systemGraph";
import type { ConductorKind, ResolvedDevice, RoutedConnection } from "./systemGraph";
import {
  GRID, PORT_RADIUS, edgeOffsets, endpointDeviceId, isDiagramJoin, isFlowKind, kindRank,
  nodeDimensions, nodePortPitch, outwardVector, portPoint, sideCounts, snap, snapUp,
} from "./diagramNodes";
import type { BoundaryPort, DiagramLayoutHints, DiagramNode, DiagramPort, Point, PortSide, WireSeed } from "./diagramNodes";
import { familyKey, isFan, lockFamilySlots, placeDiagram } from "./diagramPlacement";
import type { MoveUnit } from "./diagramPlacement";

/**
 * Wiring-diagram layout engine (build time only).
 *
 * Placement (see diagramPlacement.ts) folds leaves and satellites into
 * islands laid out with aligned ports, then draws the remaining core as a
 * layered flow: sources on the left, loads on the right, earth and data
 * hanging from the bottom edge.
 *
 * Wires are routed one at a time on a 12 px orthogonal grid with an exact
 * turn-aware A* whose costs rank a crossing above a turn above length: a
 * crossing is rendered as an arched jump, overlapping a parallel wire is
 * impossible by construction, and every route is re-solved against the
 * finished field in improvement passes.
 *
 * Finally a compaction pass (after the post-layout compaction of ELK layered)
 * slides every device toward its peers — aligning a port with the port it
 * feeds, or closing the gap to it — and keeps the move only when the wires it
 * touches re-route with fewer jumps, then fewer turns, then less length.
 */

export type { BoundaryPort, DiagramLayoutHints, DiagramNode, DiagramPort, Point, PortSide, WireSeed } from "./diagramNodes";
export { GRID, PORT_PITCH, PORT_RADIUS, endpointDeviceId, isDiagramJoin, nodePortPitch, portPoint, sortedSidePorts } from "./diagramNodes";

export type RoutedWire = WireSeed & {
  points: readonly Point[];
  bridges: readonly { point: Point; axis: "horizontal" | "vertical" }[];
  color: string;
  width: number;
  fromNodeId?: string;
  toNodeId?: string;
};
export type DiagramLayout = {
  key: string;
  scope: "system" | "junction";
  junction?: ResolvedDevice;
  nodes: DiagramNode[];
  boundaryPorts: BoundaryPort[];
  wires: RoutedWire[];
  width: number;
  height: number;
  routingMs: number;
  layoutMs: number;
  precomputedLayoutMs?: number;
  compactionMs?: number;
  compactionMoves?: number;
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
};

const LAYOUT_MARGIN = 144;
const BOUNDARY_PORT_PITCH = 48;
const MIN_WIRE_LANE_SPACING = GRID;
export { MIN_WIRE_LANE_SPACING };
/** Bound search work, not elapsed time: identical inputs must place identically. */
const COMPACTION_TRIALS = 2000;

export const diagramConductorColor: Record<ConductorKind, string> = {
  ...conductorColor,
  // The diagram sits on a mid-grey field; protective earth needs a brighter
  // green than the 3D scene to stay distinct from black returns.
  earth: "#4af287",
};

export function routeStrokeWidth(route: RoutedConnection) {
  return Math.max(2.5, Math.min(8, route.diameterMm / 2.2));
}

/**
 * Schematic flow directions. Graph connections are authored supply-to-load,
 * except the geometry-only stub between a device terminal and its bodyless
 * splice, which always starts at the terminal. Electrically the splice feeds a
 * load terminal and is fed by a source terminal, so the stub is oriented by
 * the splice's other arms: if anything flows into the splice, the splice
 * feeds the device.
 */
const diagramConnections = (() => {
  const connections = dseRuntime.graph.connections;
  const joinById = new Map(dseRuntime.devices.filter((device) => device.presentation === "wire-join").map((device) => [device.id, device]));
  return connections.map((connection) => {
    if (connection.topologyRole !== "terminal-join") return connection;
    const joinId = endpointDeviceId(connection.to);
    if (!joinById.has(joinId)) return connection;
    const fedFromOutside = connections.some((other) => other.id !== connection.id && endpointDeviceId(other.to) === joinId);
    return fedFromOutside ? { ...connection, from: connection.to, to: connection.from } : connection;
  });
})();
const diagramRouteFlow = new Map(diagramConnections.map((connection) => [connection.id, { from: connection.from, to: connection.to }]));

function connectionsFor(conductorKey: string) {
  return diagramConnections.filter((connection) => (
    connection.from === conductorKey || connection.to === conductorKey
  ));
}

/** A route's schematic endpoints in flow order. */
function flowEnds(route: RoutedConnection) {
  const flow = diagramRouteFlow.get(route.id);
  const flipped = flow !== undefined && flow.from === route.to && flow.to === route.from;
  return flipped ? { from: route.to, to: route.from } : { from: route.from, to: route.to };
}

/** Edge placement follows electrical direction: what a device is fed by
 * enters on the left, what it feeds leaves on the right, and earth/data hang
 * from the bottom. Unconnected spare ports read as outputs. */
function sideForConductor(device: ResolvedDevice, conductorId: string, kind: ConductorKind): PortSide {
  if (!isFlowKind(kind)) return "neutral";
  const key = `${device.id}.${conductorId}`;
  const attached = connectionsFor(key);
  const outgoing = attached.filter((connection) => connection.from === key).length;
  const incoming = attached.filter((connection) => connection.to === key).length;
  if (outgoing > incoming) return "output";
  if (incoming > outgoing) return "input";
  return "output";
}

function joinSideForConductor(device: ResolvedDevice, conductorId: string): PortSide {
  const conductor = device.conductors.find((candidate) => candidate.id === conductorId)!;
  const key = `${device.id}.${conductorId}`;
  const attached = connectionsFor(key);
  const outgoing = attached.filter((connection) => connection.from === key).length;
  const incoming = attached.filter((connection) => connection.to === key).length;
  if (outgoing > incoming) return "output";
  if (incoming > outgoing) return "input";
  return conductor.face === "left" ? "input" : "output";
}

export function devicePorts(device: ResolvedDevice): DiagramPort[] {
  return device.conductors.map((conductor) => ({
    id: conductor.id,
    endpointId: `${device.id}.${conductor.id}`,
    label: conductor.label,
    kind: conductor.kind,
    side: isDiagramJoin(device) ? joinSideForConductor(device, conductor.id) : sideForConductor(device, conductor.id, conductor.kind),
    selectionKey: `${device.id}.${conductor.id}`,
    declaredOrder: conductor.order,
  }));
}

/** Bars show only the posts something lands on; a spare post is not drawn. */
function connectedPorts(device: ResolvedDevice, ports: DiagramPort[], seeds: readonly WireSeed[]) {
  if (device.kind !== "busbar" && device.kind !== "earth") return ports;
  const used = new Set(seeds.flatMap((seed) => [seed.fromEndpointId, seed.toEndpointId]));
  return ports.filter((port) => used.has(port.endpointId));
}

function makeNode(device: ResolvedDevice, ports: DiagramPort[]): DiagramNode {
  const abstractJunction = device.kind === "junction";
  const { width, height } = nodeDimensions(device, sideCounts(ports), abstractJunction);
  return { device, ports, width, height, abstractJunction, x: 0, y: 0 };
}

// ---------------------------------------------------------------------------
// Scope projections
// ---------------------------------------------------------------------------

function junctionOwner(deviceId: string) {
  const device = dseRuntime.deviceById.get(deviceId);
  return device?.placement.space === "junction" ? device.placement.junctionId : undefined;
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

function junctionEdgeSide(route: RoutedConnection, junctionId: string): PortSide {
  if (route.kind === "earth" || route.kind === "data") return "neutral";
  return junctionOwner(endpointDeviceId(flowEnds(route).from)) === junctionId ? "output" : "input";
}

function systemProjection() {
  const { glandByConnection } = glandMaps();
  const portSets = new Map<string, DiagramPort[]>();
  const passthroughs = dseRuntime.devices.filter((device) => device.presentation === "wall-passthrough");
  const passthroughIds = new Set(passthroughs.map((device) => device.id));
  const worldDevices = dseRuntime.devices.filter((device) => device.placement.space === "world" && !passthroughIds.has(device.id));
  worldDevices.forEach((device) => portSets.set(device.id, device.kind === "junction" ? [] : devicePorts(device)));
  const seeds: WireSeed[] = [];
  const projectedEndpoint = (endpoint: string, owner: string | undefined, physicalRoute: RoutedConnection) => {
    if (!owner) return endpoint;
    const gland = glandByConnection.get(physicalRoute.id);
    if (!gland) return undefined;
    const id = `${owner}::${physicalRoute.id}`;
    const ports = portSets.get(owner)!;
    if (!ports.some((port) => port.endpointId === id)) {
      ports.push({
        id: `${gland.id}-${physicalRoute.id}`, endpointId: id, label: gland.label, kind: physicalRoute.kind,
        side: junctionEdgeSide(physicalRoute, owner),
        selectionKey: endpoint, connectionId: physicalRoute.id, glandId: gland.id,
      });
    }
    return id;
  };
  const addSeed = (route: RoutedConnection, from: string, to: string, fromPhysical = route, toPhysical = route) => {
    const fromOwner = junctionOwner(endpointDeviceId(from));
    const toOwner = junctionOwner(endpointDeviceId(to));
    if (fromOwner && fromOwner === toOwner) return;
    const fromEndpointId = projectedEndpoint(from, fromOwner, fromPhysical);
    const toEndpointId = projectedEndpoint(to, toOwner, toPhysical);
    if (!fromEndpointId || !toEndpointId || fromEndpointId === toEndpointId) return;
    seeds.push({ route, fromEndpointId, toEndpointId });
  };
  dseRuntime.routes.forEach((route) => {
    if (passthroughIds.has(endpointDeviceId(route.from)) || passthroughIds.has(endpointDeviceId(route.to))) return;
    const ends = flowEnds(route);
    addSeed(route, ends.from, ends.to);
  });
  // A sealed penetration is two physical routes but one schematic conductor.
  const routeByEndpoint = new Map<string, RoutedConnection>();
  dseRuntime.routes.forEach((route) => {
    if (passthroughIds.has(endpointDeviceId(route.from))) routeByEndpoint.set(route.from, route);
    if (passthroughIds.has(endpointDeviceId(route.to))) routeByEndpoint.set(route.to, route);
  });
  passthroughs.forEach((device) => {
    const seen = new Set<string>();
    device.conductors.forEach((conductor) => (conductor.internalMates ?? []).forEach((mateId) => {
      const pairKey = [conductor.id, mateId].toSorted().join("|");
      if (seen.has(pairKey)) return;
      seen.add(pairKey);
      const firstKey = `${device.id}.${conductor.id}`; const secondKey = `${device.id}.${mateId}`;
      const firstRoute = routeByEndpoint.get(firstKey); const secondRoute = routeByEndpoint.get(secondKey);
      if (!firstRoute || !secondRoute) return;
      const firstOther = firstRoute.from === firstKey ? firstRoute.to : firstRoute.from;
      const secondOther = secondRoute.from === secondKey ? secondRoute.to : secondRoute.from;
      if (firstRoute.to === firstKey && secondRoute.from === secondKey) addSeed(secondRoute, firstOther, secondOther, firstRoute, secondRoute);
      else if (secondRoute.to === secondKey && firstRoute.from === firstKey) addSeed(firstRoute, secondOther, firstOther, secondRoute, firstRoute);
      else addSeed(firstRoute, firstOther, secondOther, firstRoute, secondRoute);
    }));
  });
  const nodes = worldDevices.map((device) => makeNode(device, connectedPorts(device, portSets.get(device.id)!, seeds)));
  nodes.push(...sheathPairs(seeds, portSets));
  return { junction: undefined as ResolvedDevice | undefined, nodes, seeds, boundaryPorts: [] as BoundaryPort[] };
}

const PAIR_KINDS = new Set<ConductorKind>(["positive", "negative", "ac-line", "ac-neutral"]);

/**
 * A supply pair between one device and one enclosure is one cable, not two
 * conductors: the enclosure shows a single sheath port and the pair fans out
 * only at the device, on a bodyless breakout beside it. Conductors are kept
 * for devices; enclosures take sheaths. The seed list and the enclosure's
 * port set are rewritten in place; the new fan nodes are returned.
 */
function sheathPairs(seeds: WireSeed[], portSets: Map<string, DiagramPort[]>): DiagramNode[] {
  const rootOf = (id: string): string => {
    const device = dseRuntime.deviceById.get(id);
    return device?.attachment ? rootOf(endpointDeviceId(device.attachment.endpoint)) : id;
  };
  const groups = new Map<string, WireSeed[]>();
  seeds.forEach((seed) => {
    const fromAbstract = seed.fromEndpointId.includes("::"); const toAbstract = seed.toEndpointId.includes("::");
    if (fromAbstract === toAbstract || !PAIR_KINDS.has(seed.route.kind)) return;
    const owner = endpointDeviceId(fromAbstract ? seed.fromEndpointId : seed.toEndpointId);
    const deviceEnd = fromAbstract ? seed.toEndpointId : seed.fromEndpointId;
    const key = `${owner}|${rootOf(endpointDeviceId(deviceEnd))}|${fromAbstract ? "out" : "in"}`;
    groups.set(key, [...(groups.get(key) ?? []), seed]);
  });
  const template = dseRuntime.devices.find((device) => device.presentation === "wire-join")!;
  const fans: DiagramNode[] = [];
  groups.forEach((members, key) => {
    if (members.length < 2 || new Set(members.map((member) => member.route.kind)).size < 2) return;
    const [owner, root, direction] = key.split("|");
    const boxFeeds = direction === "out";
    const rootDevice = dseRuntime.deviceById.get(root)!;
    const fanId = `sheath:${owner}:${root}`;
    const leads = members.map((member) => {
      const deviceEnd = boxFeeds ? member.toEndpointId : member.fromEndpointId;
      return { member, deviceEnd, id: deviceEnd.replace(/[^A-Za-z0-9]+/g, "-"), kind: member.route.kind };
    });
    const fanDevice: ResolvedDevice = {
      ...template,
      id: fanId, label: `${rootDevice.label} supply cable`, subtitle: "Pair sheath fanning out at the device",
      attachment: undefined, diagramJoinGeometry: undefined, placement: rootDevice.placement, status: rootDevice.status,
      conductors: [
        { ...template.conductors[0], id: "cable", label: `${rootDevice.label} supply sheath`, kind: "multicore" },
        ...leads.map((lead, index) => ({ ...template.conductors[0], id: lead.id, label: lead.member.route.label ?? lead.kind, kind: lead.kind, order: index })),
      ],
    };
    const fanPorts: DiagramPort[] = fanDevice.conductors.map((conductor) => ({
      id: conductor.id, endpointId: `${fanId}.${conductor.id}`, label: conductor.label, kind: conductor.kind,
      side: conductor.id === "cable" ? (boxFeeds ? "input" : "output") : (boxFeeds ? "output" : "input"),
      selectionKey: conductor.id === "cable" ? members[0].route.id : leads.find((lead) => lead.id === conductor.id)!.deviceEnd,
      declaredOrder: conductor.order,
    }));
    fans.push(makeNode(fanDevice, fanPorts));
    // The enclosure's separate conductor ports collapse into one sheath port.
    const ports = portSets.get(owner)!;
    const abstractIds = new Set(members.map((member) => boxFeeds ? member.fromEndpointId : member.toEndpointId));
    const first = ports.find((port) => abstractIds.has(port.endpointId))!;
    const sheathEndpoint = `${owner}::${fanId}`;
    ports.splice(0, ports.length, ...ports.filter((port) => !abstractIds.has(port.endpointId)), {
      ...first, id: `sheath-${root}`, endpointId: sheathEndpoint, label: rootDevice.label, kind: "multicore", declaredOrder: first.declaredOrder,
    });
    const sheathRoute: RoutedConnection = {
      ...members[0].route, id: fanId, kind: "multicore", label: `${rootDevice.label} supply cable`,
      diameterMm: Math.max(...members.map((member) => member.route.diameterMm)) * 1.5,
    };
    const replacement: WireSeed[] = [
      { route: sheathRoute, fromEndpointId: boxFeeds ? sheathEndpoint : `${fanId}.cable`, toEndpointId: boxFeeds ? `${fanId}.cable` : sheathEndpoint, sheath: true },
      ...leads.map((lead) => ({ route: lead.member.route, fromEndpointId: boxFeeds ? `${fanId}.${lead.id}` : lead.deviceEnd, toEndpointId: boxFeeds ? lead.deviceEnd : `${fanId}.${lead.id}` })),
    ];
    const at = seeds.indexOf(members[0]);
    members.forEach((member) => seeds.splice(seeds.indexOf(member), 1));
    seeds.splice(Math.min(at, seeds.length), 0, ...replacement);
  });
  return fans;
}

function junctionProjection(junctionId: string) {
  const junction = dseRuntime.deviceById.get(junctionId)!;
  const members = dseRuntime.devices.filter((device) => device.placement.space === "junction" && device.placement.junctionId === junctionId);
  const memberIds = new Set(members.map((device) => device.id));
  const { glandByConnection } = glandMaps();
  const crossing = dseRuntime.routes.filter((route) => memberIds.has(endpointDeviceId(route.from)) !== memberIds.has(endpointDeviceId(route.to)));
  const boundaryPorts: BoundaryPort[] = crossing.map((route) => {
    const internalEndpoint = memberIds.has(endpointDeviceId(route.from)) ? route.from : route.to;
    const externalEndpoint = internalEndpoint === route.from ? route.to : route.from;
    const externalConductor = dseRuntime.conductorByKey.get(externalEndpoint)!;
    const gland = glandByConnection.get(route.id);
    return {
      id: `boundary-${route.id}`, endpointId: `boundary::${route.id}`,
      label: gland?.label ?? externalConductor.label, kind: route.kind,
      side: junctionEdgeSide(route, junctionId), selectionKey: internalEndpoint, connectionId: route.id,
      glandId: gland?.id, point: { x: 0, y: 0 },
    };
  });
  const boundaryByConnection = new Map(boundaryPorts.map((port) => [port.connectionId!, port]));
  const seeds = dseRuntime.routes.flatMap((route): WireSeed[] => {
    const fromInside = memberIds.has(endpointDeviceId(route.from));
    const toInside = memberIds.has(endpointDeviceId(route.to));
    if (!fromInside && !toInside) return [];
    const ends = flowEnds(route);
    if (fromInside && toInside) return [{ route, fromEndpointId: ends.from, toEndpointId: ends.to }];
    const boundary = boundaryByConnection.get(route.id)!;
    const endsFromInside = memberIds.has(endpointDeviceId(ends.from));
    return [{ route, fromEndpointId: endsFromInside ? ends.from : boundary.endpointId, toEndpointId: endsFromInside ? boundary.endpointId : ends.to }];
  });
  const nodes = members.map((device) => makeNode(device, connectedPorts(device, devicePorts(device), seeds)));
  return { junction, nodes, seeds, boundaryPorts };
}

// ---------------------------------------------------------------------------
// Port ordering and canvas fitting
// ---------------------------------------------------------------------------

/** Ports on many-conductor hubs (bars, enclosures, earth bars) are ordered
 * by where their peers sit; every other device keeps its declared order so
 * one device type always reads the same way. Family members keep the slots
 * placement locked for them. */
function orderPorts(nodes: DiagramNode[], seeds: readonly WireSeed[], boundaryPorts: readonly BoundaryPort[]) {
  const nodeById = new Map(nodes.map((node) => [node.device.id, node]));
  const boundaryByEndpoint = new Map(boundaryPorts.map((port) => [port.endpointId, port]));
  const peerPoint = (endpointId: string): Point | undefined => {
    const boundary = boundaryByEndpoint.get(endpointId);
    if (boundary) return boundary.point;
    const node = nodeById.get(endpointDeviceId(endpointId));
    if (!node) return undefined;
    return { x: node.x, y: node.y };
  };
  const peersOf = new Map<string, string[]>();
  seeds.forEach((seed) => {
    peersOf.set(seed.fromEndpointId, [...(peersOf.get(seed.fromEndpointId) ?? []), seed.toEndpointId]);
    peersOf.set(seed.toEndpointId, [...(peersOf.get(seed.toEndpointId) ?? []), seed.fromEndpointId]);
  });
  const spliced = splicedEndpoints(nodes);
  // Earth and data ports face the side their peers are on: a bar hanging
  // beneath the equipment it bonds takes its wires on top. Family members
  // flip together or not at all.
  const facing = (node: DiagramNode, port: DiagramPort): PortSide | undefined => {
    if (port.side !== "neutral" && port.side !== "top") return undefined;
    const points = (peersOf.get(port.endpointId) ?? []).map(peerPoint).filter((point): point is Point => point !== undefined);
    if (points.length === 0) return undefined;
    if (points.every((point) => point.y < node.y - node.height / 2)) return "top";
    if (points.every((point) => point.y > node.y + node.height / 2)) return "neutral";
    return undefined;
  };
  const families = new Map<string, DiagramNode[]>();
  nodes.forEach((node) => {
    const key = node.lockedPorts ? familyKey(node.device) : undefined;
    if (key) { families.set(key, [...(families.get(key) ?? []), node]); return; }
    if (isFan(node)) return;
    node.ports.forEach((port) => { const side = facing(node, port); if (side) port.side = side; });
  });
  families.forEach((members) => {
    const ids = new Set(members.flatMap((member) => member.ports.map((port) => port.id)));
    ids.forEach((id) => {
      const decisions = members.map((member) => { const port = member.ports.find((candidate) => candidate.id === id); return port ? facing(member, port) : undefined; });
      const agreed = decisions[0];
      if (agreed && decisions.every((decision) => decision === agreed)) members.forEach((member) => { const port = member.ports.find((candidate) => candidate.id === id); if (port) port.side = agreed; });
    });
    lockFamilySlots(members);
  });
  nodes.forEach((node) => {
    // Hubs and splices order their ports by where the peers sit; a splice's
    // arms in particular swap so the thin branch never crosses the thick run.
    const flexible = node.abstractJunction || node.device.kind === "busbar" || node.device.kind === "earth"
      || node.device.presentation === "wall-passthrough" || isDiagramJoin(node.device);
    const peerKey = (port: DiagramPort, axis: "x" | "y") => {
      const points = (peersOf.get(port.endpointId) ?? []).map(peerPoint).filter((point): point is Point => point !== undefined);
      if (points.length === 0) return undefined;
      return points.reduce((sum, point) => sum + point[axis], 0) / points.length;
    };
    if (!node.lockedPorts) {
      (["input", "output", "neutral", "top"] as const).forEach((side) => {
        const ports = node.ports.filter((port) => port.side === side);
        const axis = side === "input" || side === "output" ? "y" : "x";
        // A terminal with a splice hanging off it stays put: the splice was
        // placed under that slot.
        const pinned = ports.some((port) => spliced.has(port.endpointId));
        ports.sort((a, b) => {
          if (flexible && !pinned) {
            const ka = peerKey(a, axis); const kb = peerKey(b, axis);
            if (ka !== undefined && kb !== undefined && ka !== kb) return ka - kb;
          }
          return (a.declaredOrder ?? 0) - (b.declaredOrder ?? 0) || kindRank[a.kind] - kindRank[b.kind] || a.id.localeCompare(b.id);
        });
        const offsets = edgeOffsets(ports.length, nodePortPitch(node));
        ports.forEach((port, index) => { port.offset = offsets[index]; });
      });
    }
    node.ports = (["input", "output", "neutral", "top"] as const).flatMap((side) => (
      node.ports.filter((port) => port.side === side).toSorted((a, b) => (a.offset ?? 0) - (b.offset ?? 0))
    ));
  });
}

/** Terminals that carry an attached splice; their slot fixes the splice's place. */
function splicedEndpoints(nodes: readonly DiagramNode[]) {
  return new Set(nodes.flatMap((node) => node.device.attachment ? [node.device.attachment.endpoint] : []));
}

function normalizeNodes(nodes: DiagramNode[], margin: number) {
  if (nodes.length === 0) return;
  const minX = Math.min(...nodes.map((node) => node.x - node.width / 2));
  const minY = Math.min(...nodes.map((node) => node.y - node.height / 2));
  const dx = snap(margin - minX); const dy = snap(margin - minY);
  nodes.forEach((node) => { node.x += dx; node.y += dy; });
}

function fitCoordinates(desired: readonly number[], minimum: number, maximum: number, pitch: number) {
  if (!desired.length) return [];
  const values = desired.map((value) => snap(Math.max(minimum, Math.min(maximum, value))));
  for (let index = 1; index < values.length; index += 1) values[index] = Math.max(values[index], values[index - 1] + pitch);
  if (values.at(-1)! > maximum) {
    const shift = values.at(-1)! - maximum; values.forEach((value, index) => { values[index] = snap(value - shift); });
  }
  for (let index = values.length - 2; index >= 0; index -= 1) values[index] = Math.min(values[index], values[index + 1] - pitch);
  if (values[0] < minimum) {
    const shift = minimum - values[0]; values.forEach((value, index) => { values[index] = snap(value + shift); });
  }
  return values;
}

// ---------------------------------------------------------------------------
// Orthogonal grid routing
// ---------------------------------------------------------------------------

type EndpointPosition = { point: Point; side: PortSide; boundary?: boolean };

class MinHeap {
  keys = new Float64Array(4096);
  ids = new Int32Array(4096);
  size = 0;
  push(key: number, id: number) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.keys.length * 2); keys.set(this.keys); this.keys = keys;
      const ids = new Int32Array(this.ids.length * 2); ids.set(this.ids); this.ids = ids;
    }
    let index = this.size++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[index] = this.keys[parent]; this.ids[index] = this.ids[parent];
      index = parent;
    }
    this.keys[index] = key; this.ids[index] = id;
  }
  pop() {
    const id = this.ids[0];
    this.size -= 1;
    if (this.size > 0) {
      const key = this.keys[this.size]; const moved = this.ids[this.size];
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        if (left >= this.size) break;
        const right = left + 1;
        const child = right < this.size && this.keys[right] < this.keys[left] ? right : left;
        if (this.keys[child] >= key) break;
        this.keys[index] = this.keys[child]; this.ids[index] = this.ids[child];
        index = child;
      }
      this.keys[index] = key; this.ids[index] = moved;
    }
    return id;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const AXIS = [0, 0, 1, 1];
/** Route costs per 12 px cell. A crossing (rendered as a jump) outranks a
 * turn, which outranks length: a wire will detour up to two dozen cells to
 * avoid one jump, and up to eight to avoid one corner. */
const TURN = 8; const CROSS = 24;

type WireJob = {
  index: number;
  seed: WireSeed;
  from: EndpointPosition;
  to: EndpointPosition;
  fromCell: number;
  toCell: number;
  fromDir: number;
  toDir: number;
  cells: number[];
  cost: number;
  routed: boolean;
};

export type WireObjective = { jumps: number; turns: number; length: number };

const betterObjective = (a: WireObjective, b: WireObjective, lengthCounts = true) => (
  a.jumps < b.jumps || (a.jumps === b.jumps && (a.turns < b.turns || (lengthCounts && a.turns === b.turns && a.length < b.length - 1e-6)))
);

/**
 * The routing field: node footprints, per-axis wire occupancy and port launch
 * cells on the 12 px lattice. It is re-entrant so the compaction pass can
 * move a node, re-route only the wires that touched it or its new footprint,
 * and put everything back if the move did not pay.
 */
class WireField {
  readonly nx: number;
  readonly ny: number;
  private readonly blocked: Uint16Array;
  private readonly horizontal: Int32Array;
  private readonly vertical: Int32Array;
  private readonly reserved: Uint16Array;
  private readonly launchOwners = new Map<number, Set<number>>();
  private readonly endpoints = new Map<string, EndpointPosition>();
  private readonly endpointNode = new Map<string, DiagramNode>();
  readonly jobs: WireJob[];
  readonly order: WireJob[];
  private readonly heap = new MinHeap();
  private readonly gScore: Float32Array;
  private readonly parent: Int32Array;
  /** Generation stamps replace clearing the whole grid before each search. */
  private readonly seen: Int32Array;
  private readonly closed: Int32Array;
  private generation = 0;
  searchCount = 0;
  searchMs = 0;
  trialCount = 0;

  constructor(readonly nodes: readonly DiagramNode[], boundaryPorts: readonly BoundaryPort[], seeds: readonly WireSeed[], readonly bounds: { width: number; height: number }) {
    this.nx = Math.floor(bounds.width / GRID) + 1;
    this.ny = Math.floor(bounds.height / GRID) + 1;
    const size = this.nx * this.ny;
    this.blocked = new Uint16Array(size);
    this.horizontal = new Int32Array(size);
    this.vertical = new Int32Array(size);
    this.reserved = new Uint16Array(size);
    this.gScore = new Float32Array(size * 4);
    this.parent = new Int32Array(size * 4);
    this.seen = new Int32Array(size * 4);
    this.closed = new Int32Array(size * 4);
    nodes.forEach((node) => this.blockNode(node, 1));
    nodes.forEach((node) => node.ports.forEach((port) => {
      this.endpoints.set(port.endpointId, { point: portPoint(node, port), side: port.side });
      this.endpointNode.set(port.endpointId, node);
    }));
    boundaryPorts.forEach((port) => this.endpoints.set(port.endpointId, { point: port.point, side: port.side, boundary: true }));
    this.jobs = seeds.map((seed, index) => {
      const from = this.endpoints.get(seed.fromEndpointId); const to = this.endpoints.get(seed.toEndpointId);
      if (!from || !to) throw new Error(`${seed.route.id}: missing diagram endpoint`);
      return { index, seed, from, to, fromCell: 0, toCell: 0, fromDir: 0, toDir: 0, cells: [], cost: Infinity, routed: false };
    });
    this.jobs.forEach((job) => this.attachJob(job));
    this.order = this.jobs.toSorted((a, b) => b.seed.route.diameterMm - a.seed.route.diameterMm
      || (Math.abs(b.to.point.x - b.from.point.x) + Math.abs(b.to.point.y - b.from.point.y))
        - (Math.abs(a.to.point.x - a.from.point.x) + Math.abs(a.to.point.y - a.from.point.y))
      || a.seed.route.id.localeCompare(b.seed.route.id));
  }

  cellIndex(cx: number, cy: number) { return cx * this.ny + cy; }
  cellOf(point: Point) { return this.cellIndex(Math.round(point.x / GRID), Math.round(point.y / GRID)); }
  toPoint(cell: number): Point { return { x: Math.floor(cell / this.ny) * GRID, y: (cell % this.ny) * GRID }; }

  private footprint(node: DiagramNode) {
    const x0 = Math.ceil((node.x - node.width / 2 - GRID / 2) / GRID); const x1 = Math.floor((node.x + node.width / 2 + GRID / 2) / GRID);
    const y0 = Math.ceil((node.y - node.height / 2 - GRID / 2) / GRID); const y1 = Math.floor((node.y + node.height / 2 + GRID / 2) / GRID);
    const cells: number[] = [];
    for (let cx = Math.max(0, x0); cx <= Math.min(this.nx - 1, x1); cx += 1) {
      for (let cy = Math.max(0, y0); cy <= Math.min(this.ny - 1, y1); cy += 1) cells.push(this.cellIndex(cx, cy));
    }
    return cells;
  }
  private blockNode(node: DiagramNode, delta: 1 | -1) {
    this.footprint(node).forEach((cell) => { this.blocked[cell] += delta; });
  }
  /** Launch cells are shared by every wire of one port (a fan) and closed to others. */
  private attachJob(job: WireJob) {
    const outward = (endpoint: EndpointPosition) => {
      const vector = outwardVector(endpoint.side);
      return endpoint.boundary ? { x: -vector.x, y: -vector.y } : vector;
    };
    const dirIndex = (vector: Point) => DIRS.findIndex(([dx, dy]) => dx === vector.x && dy === vector.y);
    job.from = this.endpoints.get(job.seed.fromEndpointId)!; job.to = this.endpoints.get(job.seed.toEndpointId)!;
    const fromOut = outward(job.from); const toOut = outward(job.to);
    job.fromCell = this.cellOf({ x: job.from.point.x + fromOut.x * GRID, y: job.from.point.y + fromOut.y * GRID });
    job.toCell = this.cellOf({ x: job.to.point.x + toOut.x * GRID, y: job.to.point.y + toOut.y * GRID });
    job.fromDir = dirIndex(fromOut); job.toDir = dirIndex(toOut);
    [job.fromCell, job.toCell].forEach((cell) => {
      this.launchOwners.set(cell, new Set([...(this.launchOwners.get(cell) ?? []), job.index]));
      this.reserved[cell] += 1;
    });
  }
  private detachJob(job: WireJob) {
    [job.fromCell, job.toCell].forEach((cell) => {
      const owners = this.launchOwners.get(cell);
      owners?.delete(job.index);
      if (owners && owners.size === 0) this.launchOwners.delete(cell);
      this.reserved[cell] -= 1;
    });
  }

  private passesStraight(other: WireJob, cell: number) {
    const at = other.cells.indexOf(cell);
    if (at <= 0 || at >= other.cells.length - 1) return false;
    const before = other.cells[at - 1]; const after = other.cells[at + 1];
    return Math.floor(before / this.ny) === Math.floor(after / this.ny) || before % this.ny === after % this.ny;
  }

  /** Exact turn-aware A* from the wire's launch cell to its landing cell.
   * The search is first confined to a window around the two ends (almost
   * every wire is local); only if that fails is the whole canvas searched. */
  search(job: WireJob): { cells: number[]; cost: number } | undefined {
    const started = performance.now();
    this.searchCount += 1;
    const result = this.searchWithin(job, 40) ?? this.searchWithin(job, Infinity);
    this.searchMs += performance.now() - started;
    return result;
  }
  private searchWithin(job: WireJob, window: number): { cells: number[]; cost: number } | undefined {
    const { nx, ny, blocked, reserved, horizontal, vertical, jobs, heap, gScore, parent, seen, closed } = this;
    const generation = ++this.generation;
    heap.size = 0;
    const id = job.index + 1;
    const own = (cell: number) => this.launchOwners.get(cell)?.has(job.index) ?? false;
    const goalX = Math.floor(job.toCell / ny); const goalY = job.toCell % ny;
    const startX = Math.floor(job.fromCell / ny); const startY = job.fromCell % ny;
    const minX = Math.max(0, Math.min(startX, goalX) - window); const maxX = Math.min(nx - 1, Math.max(startX, goalX) + window);
    const minY = Math.max(0, Math.min(startY, goalY) - window); const maxY = Math.min(ny - 1, Math.max(startY, goalY) + window);
    const g0 = (state: number) => seen[state] === generation ? gScore[state] : Infinity;
    const heuristic = (cx: number, cy: number) => {
      const dx = Math.abs(goalX - cx); const dy = Math.abs(goalY - cy);
      return dx + dy + (dx > 0 && dy > 0 ? TURN : 0);
    };
    const start = job.fromCell * 4 + job.fromDir;
    gScore[start] = 0; parent[start] = -1; seen[start] = generation;
    heap.push(heuristic(startX, startY), start);
    let goalState = -1;
    while (heap.size > 0) {
      const state = heap.pop();
      if (state < 0) break;
      if (closed[state] === generation) continue;
      closed[state] = generation;
      const cell = state >> 2; const dir = state & 3;
      const g = gScore[state];
      if (cell === job.toCell) {
        const total = g + (dir === (job.toDir ^ 1) ? 0 : TURN);
        if (goalState < 0 || total < gScore[goalState]) { goalState = state; }
        heap.push(total, -1);
        continue;
      }
      const cx = Math.floor(cell / ny); const cy = cell % ny;
      for (let next = 0; next < 4; next += 1) {
        if (next === (dir ^ 1)) continue;
        const ncx = cx + DIRS[next][0]; const ncy = cy + DIRS[next][1];
        if (ncx < minX || ncy < minY || ncx > maxX || ncy > maxY) continue;
        const nextCell = this.cellIndex(ncx, ncy);
        if (blocked[nextCell] && !own(nextCell)) continue;
        if (reserved[nextCell] && !own(nextCell)) continue;
        const axis = AXIS[next];
        const turning = next !== dir;
        // Wires of one port share its lead cell as a fan; everywhere else a cell
        // carries at most one wire per axis, a turn takes both axes, and a
        // crossing needs both wires to pass straight through.
        if (turning && !own(cell)) {
          const h = horizontal[cell]; const v = vertical[cell];
          if ((h !== 0 && h !== id) || (v !== 0 && v !== id)) continue;
        }
        const sharedNext = own(nextCell);
        const along = axis === 0 ? horizontal[nextCell] : vertical[nextCell];
        if (!sharedNext && along !== 0 && along !== id) continue;
        const across = axis === 0 ? vertical[nextCell] : horizontal[nextCell];
        let crossCost = 0;
        if (!sharedNext && across !== 0 && across !== id) {
          if (!this.passesStraight(jobs[across - 1], nextCell)) continue;
          crossCost = CROSS;
        }
        const tentative = g + 1 + (turning ? TURN : 0) + crossCost;
        const nextState = nextCell * 4 + next;
        if (closed[nextState] === generation || tentative >= g0(nextState)) continue;
        gScore[nextState] = tentative; seen[nextState] = generation;
        parent[nextState] = state;
        heap.push(tentative + heuristic(ncx, ncy), nextState);
      }
    }
    if (goalState < 0) return undefined;
    const cells: number[] = [];
    let cursor = goalState;
    while (cursor >= 0) { cells.push(cursor >> 2); cursor = parent[cursor]; }
    cells.reverse();
    return { cells, cost: gScore[goalState] + ((goalState & 3) === (job.toDir ^ 1) ? 0 : TURN) };
  }

  private occupy(job: WireJob, cells: readonly number[], set: boolean) {
    const { ny, horizontal, vertical } = this;
    const id = set ? job.index + 1 : 0;
    cells.forEach((cell, index) => {
      const previous = cells[index - 1]; const next = cells[index + 1];
      const axes = new Set<number>();
      if (previous !== undefined) axes.add(Math.floor(previous / ny) === Math.floor(cell / ny) ? 1 : 0);
      if (next !== undefined) axes.add(Math.floor(next / ny) === Math.floor(cell / ny) ? 1 : 0);
      if (axes.size === 0) axes.add(0);
      axes.forEach((axis) => {
        if (axis === 0) { if (set || horizontal[cell] === job.index + 1) horizontal[cell] = id; }
        else if (set || vertical[cell] === job.index + 1) vertical[cell] = id;
      });
    });
  }
  commit(job: WireJob, result: { cells: number[]; cost: number }) {
    job.cells = result.cells; job.cost = result.cost; job.routed = true;
    this.occupy(job, job.cells, true);
  }
  release(job: WireJob) { if (job.routed) this.occupy(job, job.cells, false); job.routed = false; }

  /** Initial routing with rip-up improvement passes. */
  routeAll() {
    this.order.forEach((job) => {
      const result = this.search(job);
      if (result) this.commit(job, result);
    });
    this.improve();
    const fallbackIds: string[] = [];
    this.order.forEach((job) => {
      if (job.routed) return;
      const result = this.search(job);
      if (result) { this.commit(job, result); return; }
      fallbackIds.push(job.seed.route.id);
    });
    return fallbackIds;
  }
  improve(candidates: readonly WireJob[] = this.order) {
    for (let pass = 0; pass < 3; pass += 1) {
      let improved = false;
      candidates.forEach((job) => {
        if (!job.routed) return;
        const previous = { cells: job.cells, cost: job.cost };
        this.release(job);
        const result = this.search(job);
        if (result && result.cost + 1e-6 < previous.cost) { this.commit(job, result); improved = true; }
        else this.commit(job, previous);
      });
      if (!improved) break;
    }
  }

  /** Wire polyline from the routed cells, collinear points removed. */
  polyline(job: WireJob): Point[] {
    const raw = job.routed
      ? [job.from.point, ...job.cells.map((cell) => this.toPoint(cell)), job.to.point]
      : [job.from.point, { x: job.to.point.x, y: job.from.point.y }, job.to.point];
    return raw.filter((point, index) => {
      if (index === 0 || index === raw.length - 1) return true;
      const a = raw[index - 1]; const b = raw[index + 1];
      return !((a.x === point.x && point.x === b.x) || (a.y === point.y && point.y === b.y));
    }).filter((point, index, array) => index === 0 || point.x !== array[index - 1].x || point.y !== array[index - 1].y);
  }
  private isFan(cell: number, h: number, v: number) {
    const owners = this.launchOwners.get(cell);
    return owners !== undefined && owners.has(h - 1) && owners.has(v - 1);
  }
  objective(): WireObjective {
    let jumps = 0;
    for (let cell = 0; cell < this.horizontal.length; cell += 1) {
      const h = this.horizontal[cell]; const v = this.vertical[cell];
      if (h !== 0 && v !== 0 && h !== v && !this.isFan(cell, h, v)) jumps += 1;
    }
    let turns = 0; let length = 0;
    this.jobs.forEach((job) => {
      const points = this.polyline(job);
      turns += Math.max(0, points.length - 2);
      for (let index = 1; index < points.length; index += 1) length += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
      if (!job.routed) { jumps += 1000; turns += 1000; }
    });
    return { jumps, turns, length };
  }

  /** Can this set of nodes shift by (dx, dy) without leaving the canvas or
   * touching another node's routing margin? */
  canMove(unit: readonly DiagramNode[], dx: number, dy: number) {
    const unitIds = new Set(unit.map((node) => node.device.id));
    const margin = GRID * 3;
    return unit.every((node) => {
      const left = node.x + dx - node.width / 2; const right = node.x + dx + node.width / 2;
      const top = node.y + dy - node.height / 2; const bottom = node.y + dy + node.height / 2;
      if (left < GRID * 3 || top < GRID * 3 || right > this.bounds.width - GRID * 3 || bottom > this.bounds.height - GRID * 3) return false;
      return this.nodes.every((other) => unitIds.has(other.device.id)
        || right + margin <= other.x - other.width / 2 || left - margin >= other.x + other.width / 2
        || bottom + margin <= other.y - other.height / 2 || top - margin >= other.y + other.height / 2);
    });
  }

  private shift(unit: readonly DiagramNode[], dx: number, dy: number) {
    unit.forEach((node) => this.blockNode(node, -1));
    unit.forEach((node) => { node.x += dx; node.y += dy; });
    unit.forEach((node) => this.blockNode(node, 1));
    this.refreshEndpoints(unit, []);
  }
  private refreshEndpoints(nodes: readonly DiagramNode[], boundary: readonly BoundaryPort[]) {
    nodes.forEach((node) => node.ports.forEach((port) => {
      this.endpoints.set(port.endpointId, { point: portPoint(node, port), side: port.side });
    }));
    boundary.forEach((port) => this.endpoints.set(port.endpointId, { point: port.point, side: port.side, boundary: true }));
  }

  /**
   * Trial port change: `apply` re-slots ports on the given nodes (or moves
   * boundary ports); every wire on those ports is re-routed and the change is
   * kept only if the field scores better. Returns the new objective when kept.
   */
  tryPortChange(nodes: readonly DiagramNode[], boundary: readonly BoundaryPort[], apply: () => void, revert: () => void, current: WireObjective): WireObjective | undefined {
    const endpointIds = new Set([...nodes.flatMap((node) => node.ports.map((port) => port.endpointId)), ...boundary.map((port) => port.endpointId)]);
    const touches = (job: WireJob) => endpointIds.has(job.seed.fromEndpointId) || endpointIds.has(job.seed.toEndpointId);
    const affected = this.order.filter(touches);
    if (affected.length === 0 || affected.length > 14) return undefined;
    this.trialCount += 1;
    const saved = affected.map((job) => ({ job, cells: job.cells, cost: job.cost, routed: job.routed }));
    affected.forEach((job) => this.release(job));
    affected.forEach((job) => this.detachJob(job));
    apply();
    this.refreshEndpoints(nodes, boundary);
    affected.forEach((job) => this.attachJob(job));
    let ok = true;
    for (const job of affected) {
      const result = this.search(job);
      if (!result) { ok = false; break; }
      this.commit(job, result);
    }
    if (ok) {
      const next = this.objective();
      if (betterObjective(next, current)) return next;
    }
    affected.forEach((job) => this.release(job));
    affected.forEach((job) => this.detachJob(job));
    revert();
    this.refreshEndpoints(nodes, boundary);
    affected.forEach((job) => this.attachJob(job));
    saved.forEach(({ job, cells, cost, routed }) => { if (routed) this.commit(job, { cells, cost }); });
    return undefined;
  }

  /**
   * Trial move: shift the unit, re-route every wire that touched it or now
   * runs through its footprint, and keep the result only if the whole field
   * scores better. Returns the new objective when kept.
   */
  tryMove(unit: readonly DiagramNode[], dx: number, dy: number, current: WireObjective, lengthCounts = true): WireObjective | undefined {
    const unitIds = new Set(unit.map((node) => node.device.id));
    const newFootprint = new Set<number>();
    unit.forEach((node) => this.footprint({ ...node, x: node.x + dx, y: node.y + dy }).forEach((cell) => newFootprint.add(cell)));
    const touches = (job: WireJob) => unitIds.has(this.endpointNode.get(job.seed.fromEndpointId)?.device.id ?? "")
      || unitIds.has(this.endpointNode.get(job.seed.toEndpointId)?.device.id ?? "");
    const affected = this.order.filter((job) => touches(job) || job.cells.some((cell) => newFootprint.has(cell)) || newFootprint.has(job.fromCell) || newFootprint.has(job.toCell));
    if (affected.length > 14) return undefined;
    this.trialCount += 1;
    const saved = affected.map((job) => ({ job, cells: job.cells, cost: job.cost, routed: job.routed, fromCell: job.fromCell, toCell: job.toCell }));
    affected.forEach((job) => this.release(job));
    affected.filter(touches).forEach((job) => this.detachJob(job));
    this.shift(unit, dx, dy);
    affected.filter(touches).forEach((job) => this.attachJob(job));
    let ok = true;
    for (const job of affected) {
      const result = this.search(job);
      if (!result) { ok = false; break; }
      this.commit(job, result);
    }
    if (ok) {
      const next = this.objective();
      if (betterObjective(next, current, lengthCounts)) return next;
    }
    affected.forEach((job) => this.release(job));
    affected.filter(touches).forEach((job) => this.detachJob(job));
    this.shift(unit, -dx, -dy);
    affected.filter(touches).forEach((job) => this.attachJob(job));
    saved.forEach(({ job, cells, cost, routed }) => { if (routed) this.commit(job, { cells, cost }); });
    return undefined;
  }

  /** Move candidates for a unit: align each of its ports with the port it is
   * wired to, close the gap to that peer, and short slides on both axes. */
  candidates(unit: readonly DiagramNode[]) {
    const unitIds = new Set(unit.map((node) => node.device.id));
    const moves: Array<{ dx: number; dy: number; rank: number }> = [];
    const push = (dx: number, dy: number, rank: number) => {
      dx = snap(dx); dy = snap(dy);
      if (dx === 0 && dy === 0) return;
      if (!moves.some((move) => move.dx === dx && move.dy === dy)) moves.push({ dx, dy, rank });
    };
    this.jobs.forEach((job) => {
      const fromInside = unitIds.has(this.endpointNode.get(job.seed.fromEndpointId)?.device.id ?? "");
      const toInside = unitIds.has(this.endpointNode.get(job.seed.toEndpointId)?.device.id ?? "");
      if (fromInside === toInside) return;
      const own = fromInside ? job.from : job.to; const peer = fromInside ? job.to : job.from;
      const horizontalPort = own.side === "input" || own.side === "output";
      const gapX = peer.point.x - own.point.x; const gapY = peer.point.y - own.point.y;
      if (horizontalPort) {
        push(0, gapY, 0);
        const approach = own.side === "output" ? gapX - GRID * 6 : gapX + GRID * 6;
        if (Math.sign(approach) === Math.sign(gapX) && Math.abs(approach) < Math.abs(gapX)) { push(approach, 0, 1); push(approach, gapY, 1); }
      } else {
        push(gapX, 0, 0);
        const approach = own.side === "neutral" ? gapY - GRID * 6 : gapY + GRID * 6;
        if (Math.sign(approach) === Math.sign(gapY) && Math.abs(approach) < Math.abs(gapY)) { push(0, approach, 1); push(gapX, approach, 1); }
      }
    });
    [2, 4, 8].forEach((steps) => { push(-GRID * steps, 0, 2); push(GRID * steps, 0, 2); push(0, -GRID * steps, 2); push(0, GRID * steps, 2); });
    return moves.toSorted((a, b) => a.rank - b.rank || Math.abs(a.dx) + Math.abs(a.dy) - Math.abs(b.dx) - Math.abs(b.dy));
  }

  materialize(): RoutedWire[] {
    const wires: RoutedWire[] = this.jobs.map((job) => ({
      ...job.seed, points: this.polyline(job), bridges: [],
      color: job.seed.sheath || dseRuntime.graph.cables.find((cable) => cable.id === job.seed.route.cableId)?.sheath === "white" ? "#f8f6ef" : diagramConductorColor[job.seed.route.kind],
      width: routeStrokeWidth(job.seed.route),
      fromNodeId: endpointDeviceId(job.seed.fromEndpointId), toNodeId: endpointDeviceId(job.seed.toEndpointId),
    }));
    // Bridges: every cell carrying one straight horizontal and one straight vertical wire.
    const bridgesByWire = new Map<number, { point: Point; axis: "horizontal" | "vertical" }[]>();
    for (let cell = 0; cell < this.horizontal.length; cell += 1) {
      const h = this.horizontal[cell]; const v = this.vertical[cell];
      if (h === 0 || v === 0 || h === v || this.isFan(cell, h, v)) continue;
      const hop = bridgesByWire.get(h - 1) ?? [];
      hop.push({ point: this.toPoint(cell), axis: "horizontal" });
      bridgesByWire.set(h - 1, hop);
    }
    wires.forEach((wire, index) => { wire.bridges = bridgesByWire.get(index) ?? []; });
    return wires;
  }
}

/**
 * Conductor ordering: every edge of every node — and every model family as
 * one, so its members keep reading the same way — tries swapping each pair
 * of neighbouring slots, and boundary glands try swapping places; a swap is
 * kept when the wires on those ports re-route with fewer jumps, then fewer
 * turns, then less wire. Repeats until no swap pays.
 */
function reorderConductors(field: WireField, nodes: readonly DiagramNode[], boundaryPorts: readonly BoundaryPort[], trialBudget: number) {
  const started = performance.now();
  const firstTrial = field.trialCount;
  let objective = field.objective();
  let swaps = 0;
  const groups = new Map<string, DiagramNode[]>();
  nodes.forEach((node) => {
    const key = (node.lockedPorts ? familyKey(node.device) : undefined) ?? node.device.id;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  });
  const swapSlots = (members: readonly DiagramNode[], a: string, b: string) => members.forEach((member) => {
    const first = member.ports.find((port) => port.id === a); const second = member.ports.find((port) => port.id === b);
    if (first && second) { const offset = first.offset; first.offset = second.offset; second.offset = offset; }
  });
  // A terminal with a splice hanging off it keeps its slot; the splice sits there.
  const spliced = splicedEndpoints(nodes);
  const pairs = <T>(items: readonly T[]) => items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as const));
  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false;
    for (const members of groups.values()) {
      if (field.trialCount - firstTrial >= trialBudget) return { objective, swaps, reorderMs: performance.now() - started };
      const sample = members[0];
      for (const side of ["input", "output", "neutral", "top"] as const) {
        const slots = sample.ports.filter((port) => port.side === side && !members.some((member) => spliced.has(`${member.device.id}.${port.id}`)))
          .toSorted((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
        // Every pair, not only neighbours: two slots apart may be the only swap that pays.
        for (const [first, second] of pairs(slots)) {
          const a = first.id; const b = second.id;
          const next = field.tryPortChange(members, [], () => swapSlots(members, a, b), () => swapSlots(members, a, b), objective);
          if (next) { objective = next; swaps += 1; improved = true; }
        }
      }
    }
    for (const side of ["input", "output", "neutral"] as const) {
      const ports = boundaryPorts.filter((port) => port.side === side).toSorted((a, b) => side === "neutral" ? a.point.x - b.point.x : a.point.y - b.point.y);
      for (const [a, b] of pairs(ports)) {
        const swap = () => { const point = a.point; a.point = b.point; b.point = point; };
        const next = field.tryPortChange([], [a, b], swap, swap, objective);
        if (next) { objective = next; swaps += 1; improved = true; }
      }
    }
    if (!improved) break;
  }
  if (process.env.DSE_DIAGRAM_DEBUG) console.warn(`reorder: ${swaps} swaps in ${(performance.now() - started).toFixed(0)} ms`);
  return { objective, swaps, reorderMs: performance.now() - started };
}

/**
 * Compaction: every move unit — an island with everything folded into it,
 * smallest first — tries the moves that would straighten or shorten its
 * wires, in order of promise, and keeps the first that improves the field.
 * Repeats until nothing moves or the budget runs out. Units whose wires are
 * already straight and unbridged are skipped.
 */
function compactLayout(field: WireField, units: readonly MoveUnit[], trialBudget: number) {
  const started = performance.now();
  const firstTrial = field.trialCount;
  let objective = field.objective();
  let moves = 0;
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const { nodes: unit, lengthMoves } of units) {
      if (field.trialCount - firstTrial >= trialBudget) return { objective, moves, compactionMs: performance.now() - started };
      const unitIds = new Set(unit.map((node) => node.device.id));
      const slack = field.jobs.some((job) => {
        const inside = unitIds.has(endpointDeviceId(job.seed.fromEndpointId)) || unitIds.has(endpointDeviceId(job.seed.toEndpointId));
        return inside && (field.polyline(job).length > 2 || !job.routed);
      });
      if (!slack) continue;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const candidates = field.candidates(unit).filter(({ dx, dy }) => field.canMove(unit, dx, dy)).slice(0, 10);
        let accepted = false;
        for (const { dx, dy } of candidates) {
          const next = field.tryMove(unit, dx, dy, objective, lengthMoves);
          if (next) { objective = next; moves += 1; accepted = true; moved = true; break; }
        }
        if (!accepted) break;
      }
    }
    if (!moved) break;
  }
  // Final polish: every wire re-solved against the compacted field.
  field.improve();
  objective = field.objective();
  if (process.env.DSE_DIAGRAM_DEBUG) console.warn(`compaction: ${moves} moves, ${field.trialCount} trials, ${field.searchCount} searches (${field.searchMs.toFixed(0)} ms) in ${(performance.now() - started).toFixed(0)} ms`);
  return { objective, moves, compactionMs: performance.now() - started };
}

// ---------------------------------------------------------------------------
// Audits and metrics
// ---------------------------------------------------------------------------

function segmentsOf(points: readonly Point[]) {
  return points.slice(1).map((point, index) => [points[index], point] as const);
}

function coincidentSegmentCount(wires: readonly RoutedWire[]) {
  let count = 0;
  for (let first = 0; first < wires.length; first += 1) {
    for (let second = first + 1; second < wires.length; second += 1) {
      const a = wires[first]; const b = wires[second];
      const shared = new Set([a.fromEndpointId, a.toEndpointId].filter((endpoint) => endpoint === b.fromEndpointId || endpoint === b.toEndpointId));
      segmentsOf(a.points).forEach(([a0, a1]) => segmentsOf(b.points).forEach(([b0, b1]) => {
        if (a0.y === a1.y && b0.y === b1.y && a0.y === b0.y) {
          const overlap = Math.min(Math.max(a0.x, a1.x), Math.max(b0.x, b1.x)) - Math.max(Math.min(a0.x, a1.x), Math.min(b0.x, b1.x));
          if (overlap > 0.5 && !(shared.size > 0 && overlap <= GRID + 0.5)) count += 1;
        } else if (a0.x === a1.x && b0.x === b1.x && a0.x === b0.x) {
          const overlap = Math.min(Math.max(a0.y, a1.y), Math.max(b0.y, b1.y)) - Math.max(Math.min(a0.y, a1.y), Math.min(b0.y, b1.y));
          if (overlap > 0.5 && !(shared.size > 0 && overlap <= GRID + 0.5)) count += 1;
        }
      }));
    }
  }
  return count;
}

function nonOrthogonalSegmentCount(wires: readonly RoutedWire[]) {
  return wires.reduce((sum, wire) => sum + segmentsOf(wire.points).filter(([a, b]) => a.x !== b.x && a.y !== b.y).length, 0);
}

function crossingCounts(wires: readonly RoutedWire[]) {
  let bridged = 0; let unbridged = 0;
  for (let first = 0; first < wires.length; first += 1) {
    for (let second = first + 1; second < wires.length; second += 1) {
      const a = wires[first]; const b = wires[second];
      segmentsOf(a.points).forEach(([a0, a1]) => segmentsOf(b.points).forEach(([b0, b1]) => {
        const aHorizontal = a0.y === a1.y; const bHorizontal = b0.y === b1.y;
        if (aHorizontal === bHorizontal) return;
        const [h0, h1, v0, v1] = aHorizontal ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
        const x = v0.x; const y = h0.y;
        if (x <= Math.min(h0.x, h1.x) || x >= Math.max(h0.x, h1.x)) return;
        if (y <= Math.min(v0.y, v1.y) || y >= Math.max(v0.y, v1.y)) return;
        const horizontalWire = aHorizontal ? a : b;
        if (horizontalWire.bridges.some((bridge) => bridge.point.x === x && bridge.point.y === y)) bridged += 1;
        else unbridged += 1;
      }));
    }
  }
  return { bridged, unbridged };
}

function nodeBodyCrossingCount(nodes: readonly DiagramNode[], wires: readonly RoutedWire[]) {
  let count = 0;
  wires.forEach((wire) => segmentsOf(wire.points).forEach(([a, b]) => nodes.forEach((node) => {
    const left = node.x - node.width / 2 + 1; const right = node.x + node.width / 2 - 1;
    const top = node.y - node.height / 2 + 1; const bottom = node.y + node.height / 2 - 1;
    const minX = Math.min(a.x, b.x); const maxX = Math.max(a.x, b.x); const minY = Math.min(a.y, b.y); const maxY = Math.max(a.y, b.y);
    if (maxX < left || minX > right || maxY < top || minY > bottom) return;
    if (wire.fromNodeId === node.device.id || wire.toNodeId === node.device.id) {
      // Only the terminal lead may touch its own node edge.
      if ((a.x === b.x && (a.x === left - 1 || a.x === right + 1)) || (a.y === b.y && (a.y === top - 1 || a.y === bottom + 1))) return;
      if (maxX - minX <= GRID && maxY - minY <= GRID) return;
    }
    count += 1;
  })));
  return count;
}

function nodeOverlapCount(nodes: readonly DiagramNode[]) {
  let count = 0;
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      const a = nodes[first]; const b = nodes[second];
      if (Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2) count += 1;
    }
  }
  return count;
}

function minimumParallelSeparation(wires: readonly RoutedWire[]) {
  let minimum = Infinity;
  for (let first = 0; first < wires.length; first += 1) {
    for (let second = first + 1; second < wires.length; second += 1) {
      segmentsOf(wires[first].points).forEach(([a0, a1]) => segmentsOf(wires[second].points).forEach(([b0, b1]) => {
        if (a0.y === a1.y && b0.y === b1.y && a0.y !== b0.y) {
          const overlap = Math.min(Math.max(a0.x, a1.x), Math.max(b0.x, b1.x)) - Math.max(Math.min(a0.x, a1.x), Math.min(b0.x, b1.x));
          if (overlap > 0) minimum = Math.min(minimum, Math.abs(a0.y - b0.y));
        } else if (a0.x === a1.x && b0.x === b1.x && a0.x !== b0.x) {
          const overlap = Math.min(Math.max(a0.y, a1.y), Math.max(b0.y, b1.y)) - Math.max(Math.min(a0.y, a1.y), Math.min(b0.y, b1.y));
          if (overlap > 0) minimum = Math.min(minimum, Math.abs(a0.x - b0.x));
        }
      }));
    }
  }
  return Number.isFinite(minimum) ? minimum : GRID * 4;
}

function conductorOverlapCount(nodes: readonly DiagramNode[], boundaryPorts: readonly BoundaryPort[]) {
  const points = [
    ...nodes.flatMap((node) => node.ports.map((port) => portPoint(node, port))),
    ...boundaryPorts.map((port) => port.point),
  ];
  let count = 0;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      if (Math.hypot(points[first].x - points[second].x, points[first].y - points[second].y) < PORT_RADIUS * 2) count += 1;
    }
  }
  return count;
}


// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Place and route one scope; the previous-order hint is optional. */
function placeAndRoute(activeJunctionId: string | undefined, hints: DiagramLayoutHints) {
  const projection = activeJunctionId ? junctionProjection(activeJunctionId) : systemProjection();
  const { nodes, seeds, boundaryPorts } = projection;
  const placed = placeDiagram(nodes, seeds, hints, boundaryPorts.map((port) => ({ endpointId: port.endpointId, side: port.side })));
  const topBefore = Math.min(...nodes.map((node) => node.y - node.height / 2));
  normalizeNodes(nodes, LAYOUT_MARGIN);
  const boundaryShift = nodes.length ? Math.min(...nodes.map((node) => node.y - node.height / 2)) - topBefore : 0;
  let width = snapUp(Math.max(...nodes.map((node) => node.x + node.width / 2), 600) + LAYOUT_MARGIN);
  let height = snapUp(Math.max(...nodes.map((node) => node.y + node.height / 2), 480) + LAYOUT_MARGIN);
  if (activeJunctionId) {
    const neutralCount = boundaryPorts.filter((port) => port.side === "neutral").length;
    const sideCount = Math.max(boundaryPorts.filter((port) => port.side === "input").length, boundaryPorts.filter((port) => port.side === "output").length);
    width = snapUp(Math.max(width, neutralCount * BOUNDARY_PORT_PITCH + LAYOUT_MARGIN * 2));
    height = snapUp(Math.max(height, sideCount * BOUNDARY_PORT_PITCH + LAYOUT_MARGIN * 2));
    // Boundary ports sit on the canvas edges where the layered placement put
    // their pinned islands (level with their peers, ordered with them).
    orderPorts(nodes, seeds, boundaryPorts);
    const pointByEndpoint = new Map(nodes.flatMap((node) => node.ports.map((port) => [port.endpointId, portPoint(node, port)] as const)));
    (["input", "output", "neutral"] as const).forEach((side) => {
      const ports = boundaryPorts.filter((port) => port.side === side);
      const axis = side === "neutral" ? "x" : "y";
      const desired = (port: BoundaryPort) => axis === "y" && placed.boundaryY.has(port.endpointId)
        ? placed.boundaryY.get(port.endpointId)! + boundaryShift
        : pointByEndpoint.get(port.selectionKey)?.[axis] ?? 0;
      ports.sort((a, b) => desired(a) - desired(b) || a.id.localeCompare(b.id));
      const fitted = fitCoordinates(ports.map(desired), GRID * 6, (side === "neutral" ? width : height) - GRID * 6, BOUNDARY_PORT_PITCH);
      ports.forEach((port, index) => {
        port.point = side === "input" ? { x: 0, y: fitted[index] } : side === "output" ? { x: width, y: fitted[index] } : { x: fitted[index], y: height };
      });
    });
  }
  orderPorts(nodes, seeds, boundaryPorts);
  const routingStarted = performance.now();
  const field = new WireField(nodes, boundaryPorts, seeds, { width, height });
  const fallbackIds = field.routeAll();
  const routingMs = performance.now() - routingStarted;
  return { projection, nodes, seeds, boundaryPorts, placed, width, height, field, fallbackIds, routingMs };
}

export function buildDiagramLayout(activeJunctionId?: string, hints: DiagramLayoutHints = {}): DiagramLayout {
  const started = performance.now();
  // The previous artifact's order is a hint, never a constraint: the scope
  // is also laid out from scratch and the better of the two is kept, hinted
  // on ties, so a stale order cannot trap the layout.
  let attempt = placeAndRoute(activeJunctionId, {});
  if (hints.previousCenters) {
    const hinted = placeAndRoute(activeJunctionId, hints);
    const fresh = attempt.field.objective(); const remembered = hinted.field.objective();
    if (!betterObjective(fresh, remembered)) attempt = hinted;
  }
  const { projection, nodes, boundaryPorts, field, fallbackIds, routingMs, placed } = attempt;
  let { width, height } = attempt;
  const reordered = reorderConductors(field, nodes, boundaryPorts, COMPACTION_TRIALS / 4);
  const compaction = compactLayout(field, placed.units, COMPACTION_TRIALS);
  const reorderedAgain = reorderConductors(field, nodes, boundaryPorts, COMPACTION_TRIALS / 4);
  if (reorderedAgain.swaps > 0) field.improve();
  nodes.forEach((node) => { node.ports = node.ports.toSorted((a, b) => (["input", "output", "neutral", "top"].indexOf(a.side) - ["input", "output", "neutral", "top"].indexOf(b.side)) || (a.offset ?? 0) - (b.offset ?? 0)); });
  const wires = field.materialize();
  if (!activeJunctionId) {
    // Trim the canvas to what compaction left in use.
    const minX = Math.min(...nodes.map((node) => node.x - node.width / 2), ...wires.flatMap((wire) => wire.points.map((point) => point.x)));
    const minY = Math.min(...nodes.map((node) => node.y - node.height / 2), ...wires.flatMap((wire) => wire.points.map((point) => point.y)));
    const dx = snap(LAYOUT_MARGIN - minX); const dy = snap(LAYOUT_MARGIN - minY);
    nodes.forEach((node) => { node.x += dx; node.y += dy; });
    wires.forEach((wire) => {
      wire.points = wire.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      wire.bridges = wire.bridges.map((bridge) => ({ ...bridge, point: { x: bridge.point.x + dx, y: bridge.point.y + dy } }));
    });
    width = snapUp(Math.max(...nodes.map((node) => node.x + node.width / 2), ...wires.flatMap((wire) => wire.points.map((point) => point.x)), 600) + LAYOUT_MARGIN);
    height = snapUp(Math.max(...nodes.map((node) => node.y + node.height / 2), ...wires.flatMap((wire) => wire.points.map((point) => point.y)), 480) + LAYOUT_MARGIN);
  }
  const crossings = crossingCounts(wires);
  return {
    key: activeJunctionId ?? "system",
    scope: activeJunctionId ? "junction" : "system",
    junction: activeJunctionId ? projection.junction : undefined,
    nodes, boundaryPorts, wires, width, height,
    routingMs,
    layoutMs: performance.now() - started,
    compactionMs: compaction.compactionMs + reordered.reorderMs + reorderedAgain.reorderMs,
    compactionMoves: compaction.moves + reordered.swaps + reorderedAgain.swaps,
    coincidentSegments: coincidentSegmentCount(wires),
    nonOrthogonalSegments: nonOrthogonalSegmentCount(wires),
    conductorOverlaps: conductorOverlapCount(nodes, boundaryPorts),
    routingFallbacks: fallbackIds.length,
    fallbackRouteIds: fallbackIds,
    bridgedCrossings: crossings.bridged,
    unbridgedCrossings: crossings.unbridged,
    parallelEnvelopeOverlaps: 0,
    minimumParallelWireSeparation: minimumParallelSeparation(wires),
    nodeBodyCrossings: nodeBodyCrossingCount(nodes, wires),
    maskedNodeBodyCrossings: 0,
    nodeOverlaps: nodeOverlapCount(nodes),
    wireTurns: wires.reduce((sum, wire) => sum + Math.max(0, wire.points.length - 2), 0),
    wireLength: wires.reduce((sum, wire) => sum + segmentsOf(wire.points).reduce((length, [a, b]) => length + Math.abs(b.x - a.x) + Math.abs(b.y - a.y), 0), 0),
  };
}
