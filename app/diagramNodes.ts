import type { ConductorKind, ResolvedDevice, RoutedConnection } from "./systemGraph";

/**
 * Shared wiring-diagram primitives: node and port types, the 12 px lattice,
 * port geometry. Both the placement engine and the router build on these.
 */

export type Point = { x: number; y: number };
export type PortSide = "input" | "output" | "neutral" | "top";
export type DiagramPort = {
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
export type DiagramNode = {
  device: ResolvedDevice;
  ports: DiagramPort[];
  x: number;
  y: number;
  width: number;
  height: number;
  abstractJunction: boolean;
  /** Port slots fixed by a family so every member reads identically. */
  lockedPorts?: boolean;
};
export type BoundaryPort = DiagramPort & { point: Point };
export type WireSeed = {
  route: RoutedConnection;
  fromEndpointId: string;
  toEndpointId: string;
  /** One sheath standing for a conductor pair; drawn white. */
  sheath?: boolean;
};

/** Optional hints from a previously generated layout so regeneration keeps
 * the same vertical order wherever the graph still allows it. */
export type DiagramLayoutHints = {
  previousCenters?: ReadonlyMap<string, Point>;
};

export const GRID = 12;
export const PORT_PITCH = 48;
export const PORT_RADIUS = 7;
export const ABSTRACT_GLAND_PITCH = 36;
export const JOIN_PORT_PITCH = 48;

export const snap = (value: number, step = GRID) => Math.round(value / step) * step;
export const snapUp = (value: number, step = GRID * 2) => Math.ceil(value / step) * step;

/** Owning node of a schematic endpoint: `device.conductor`, an abstract
 * enclosure port `enclosure::route`, or a canvas boundary port. */
export const endpointDeviceId = (endpoint: string) => {
  const abstract = endpoint.indexOf("::");
  if (abstract >= 0) return endpoint.slice(0, abstract);
  return endpoint.slice(0, endpoint.lastIndexOf("."));
};

export const isFlowKind = (kind: ConductorKind) => kind !== "earth" && kind !== "data";

export function isDiagramJoin(device: ResolvedDevice) {
  return device.presentation === "wire-join" || device.diagramPresentation === "join";
}

export const kindRank: Record<ConductorKind, number> = {
  positive: 0, "ac-line": 0, negative: 1, "ac-neutral": 1, control: 2, multicore: 3, data: 4, earth: 5,
};

const baseSizeByKind: Record<ResolvedDevice["kind"], readonly [number, number]> = {
  panel: [156, 108], battery: [156, 84], breaker: [96, 84], busbar: [168, 72],
  converter: [156, 96], inverter: [180, 132], monitor: [156, 96], load: [144, 84],
  switch: [156, 96], connector: [156, 84], junction: [216, 108], protection: [108, 84],
  generator: [168, 108], earth: [144, 72],
};

export type SideCounts = Record<PortSide, number>;

export function sideCounts(ports: readonly DiagramPort[]): SideCounts {
  return {
    input: ports.filter((port) => port.side === "input").length,
    output: ports.filter((port) => port.side === "output").length,
    neutral: ports.filter((port) => port.side === "neutral").length,
    top: ports.filter((port) => port.side === "top").length,
  };
}

export function nodeDimensions(device: ResolvedDevice, counts: SideCounts, abstractJunction: boolean, labelLength = device.label.length) {
  if (isDiagramJoin(device)) {
    const edgeCount = Math.max(1, counts.input, counts.output);
    // A three-way splice is a compact 48 px Y; cable breakouts keep a wider fan.
    return { width: device.presentation === "wire-join" ? 48 : 96, height: snapUp(Math.max(72, (edgeCount - 1) * JOIN_PORT_PITCH + 48)) };
  }
  const [baseWidth, baseHeight] = baseSizeByKind[device.kind];
  const sidePitch = abstractJunction ? ABSTRACT_GLAND_PITCH : PORT_PITCH;
  const bottomPitch = abstractJunction ? ABSTRACT_GLAND_PITCH : PORT_PITCH;
  return {
    width: snapUp(Math.max(baseWidth, labelLength * 6.4 + 48,
      Math.max(counts.neutral, counts.top) * bottomPitch + 48, abstractJunction ? 264 : 0)),
    height: snapUp(Math.max(baseHeight, Math.max(counts.input, counts.output) * sidePitch + 60)),
  };
}

/** Declared order within one edge: conductor order, then positive before
 * negative, then id. Hubs re-sort by peer position later. */
export function sortedSidePorts(node: DiagramNode, side: PortSide) {
  return node.ports.filter((port) => port.side === side).toSorted((a, b) => (
    (a.declaredOrder ?? 0) - (b.declaredOrder ?? 0) || kindRank[a.kind] - kindRank[b.kind] || a.id.localeCompare(b.id)
  ));
}

export function nodePortPitch(node: DiagramNode) {
  if (isDiagramJoin(node.device)) return JOIN_PORT_PITCH;
  return node.abstractJunction ? ABSTRACT_GLAND_PITCH : PORT_PITCH;
}

/** Lattice-aligned offsets along an edge: multiples of the pitch, centred
 * when the count is odd and anchored at the centre otherwise. */
export function edgeOffsets(count: number, pitch: number) {
  const symmetric = count % 2 === 1 || (pitch / 2) % GRID === 0;
  return Array.from({ length: count }, (_, index) => (
    symmetric ? (index - (count - 1) / 2) * pitch : (index - Math.floor((count - 1) / 2)) * pitch
  ));
}

/** Give every port its declared-order slot. Locked (family) nodes keep theirs. */
export function assignDeclaredOffsets(node: DiagramNode) {
  if (node.lockedPorts) return;
  (["input", "output", "neutral", "top"] as const).forEach((side) => {
    const ports = sortedSidePorts(node, side);
    const offsets = edgeOffsets(ports.length, nodePortPitch(node));
    ports.forEach((port, index) => { port.offset = offsets[index]; });
  });
}

export function portPoint(node: DiagramNode, port: DiagramPort): Point {
  const peers = node.ports.filter((candidate) => candidate.side === port.side);
  const index = peers.findIndex((candidate) => candidate.id === port.id);
  const offset = port.offset ?? edgeOffsets(peers.length, nodePortPitch(node))[index];
  if (port.side === "input") return { x: node.x - node.width / 2, y: node.y + offset };
  if (port.side === "output") return { x: node.x + node.width / 2, y: node.y + offset };
  if (port.side === "top") return { x: node.x + offset, y: node.y - node.height / 2 };
  return { x: node.x + offset, y: node.y + node.height / 2 };
}

/** Port position relative to the node's centre. */
export function portOffsetPoint(node: DiagramNode, port: DiagramPort): Point {
  const point = portPoint({ ...node, x: 0, y: 0 }, port);
  return point;
}

export function outwardVector(side: PortSide): Point {
  if (side === "input") return { x: -1, y: 0 };
  if (side === "output") return { x: 1, y: 0 };
  if (side === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}
