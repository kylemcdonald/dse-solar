import {
  GRID, assignDeclaredOffsets, edgeOffsets, endpointDeviceId, isDiagramJoin, isFlowKind, kindRank,
  nodeDimensions, nodePortPitch, portOffsetPoint, sideCounts, snap, snapUp,
} from "./diagramNodes";
import type { DiagramLayoutHints, DiagramNode, DiagramPort, Point, PortSide, WireSeed } from "./diagramNodes";
import type { ResolvedDevice } from "./systemGraph";

/**
 * Wiring-diagram placement.
 *
 * The graph is placed bottom-up as a tree of *islands* and then top-down as a
 * layered drawing of the islands that remain:
 *
 * 1. Cells. A device and its attached splices form one cell: splices sit
 *    directly beneath the terminal they splice, chained splices continue to
 *    the right. Declared `layoutGroup` families become grid blocks, and every
 *    member of a family gets the same size and the same port slots so one
 *    device type always reads the same way.
 * 2. Islands (constructive, leaf-first placement as in EDA schematic
 *    generators and compound-graph layout). Any island whose wires all go to
 *    one other island — a leaf — or whose wires to one island outnumber all
 *    its others — a satellite, such as a cable breakout with three cores to a
 *    device and one sheath elsewhere — is folded into that hub: to the hub's
 *    right when the hub feeds it, to its left when it feeds the hub, beneath
 *    it when they only share earth or data. Folded islands are laid out
 *    recursively with their connecting ports aligned, so those wires are
 *    straight, and stacked in the hub's port order, so they never cross.
 * 3. Core. The islands left over are the cyclic backbone of the system. They
 *    are drawn with the Sugiyama pipeline: cycles broken by dropping the
 *    lightest edges first (a greedy minimum-weight feedback arc set, so a
 *    breakout stays beside the device receiving its cores), longest-path
 *    layering pulled toward successors, lane dummies for long edges,
 *    barycentre ordering, then port-aligned priority placement that lands
 *    every island where its ports line up with its neighbours' ports.
 */

const BLOCK_COLUMN_GAP = GRID * 6;
const BLOCK_ROW_GAP = GRID * 8;
const BLOCK_JOIN_GAP = GRID * 4;
const SATELLITE_GAP = GRID * 6;
const SATELLITE_STACK_GAP = GRID * 4;
const SATELLITE_DROP_GAP = GRID * 6;
const LANE_HEIGHT = GRID * 2;
const SIDES = ["input", "output", "neutral", "top"] as const;

/** Nodes with centre offsets relative to the layout's top-left corner. */
type Layout = { nodes: DiagramNode[]; offsets: Map<string, Point>; width: number; height: number };

// ---------------------------------------------------------------------------
// Cells and families
// ---------------------------------------------------------------------------

const attachmentTerminal = (node: DiagramNode) => {
  const endpoint = node.device.attachment!.endpoint;
  return endpoint.slice(endpoint.lastIndexOf(".") + 1);
};

function attachedTo(nodes: readonly DiagramNode[], id: string) {
  return nodes.filter((node) => node.device.attachment && endpointDeviceId(node.device.attachment.endpoint) === id)
    .toSorted((a, b) => a.device.id.localeCompare(b.device.id));
}

/**
 * Devices of one model render one canonical way. A declared `layoutGroup`
 * names the family explicitly; otherwise every device of a kind that shares
 * the same bill-of-materials line is the same model.
 */
export function familyKey(device: ResolvedDevice): string | undefined {
  if (device.layoutGroup) return device.layoutGroup.id;
  // Splices and breakouts are symmetric fans: each faces the way its own
  // cable runs, so they never share a canonical side set.
  if (isDiagramJoin(device) || device.attachment) return undefined;
  const bomIds = (device as { bomIds?: readonly string[] }).bomIds;
  if (!bomIds || bomIds.length === 0) return undefined;
  return `model:${device.kind}:${[...bomIds].toSorted().join("+")}`;
}

export function sortFamily(members: readonly DiagramNode[]) {
  return members.toSorted((a, b) => ((a.device.layoutGroup?.order ?? 0) - (b.device.layoutGroup?.order ?? 0)) || a.device.id.localeCompare(b.device.id));
}

function groupFamilies(nodes: readonly DiagramNode[]) {
  const families = new Map<string, DiagramNode[]>();
  nodes.forEach((node) => {
    const key = familyKey(node.device);
    if (key) families.set(key, [...(families.get(key) ?? []), node]);
  });
  return families;
}

/** A device outside any family hangs its spliced terminals from the bottom. */
function faceLoneSplices(owner: DiagramNode, nodes: readonly DiagramNode[]) {
  // A fan's cores always leave together on the side away from its cable; a
  // chain hanging off one of them starts from that core, not from the body.
  if (isFan(owner)) return;
  attachedTo(nodes, owner.device.id).forEach((join) => {
    const terminal = owner.ports.find((port) => port.id === attachmentTerminal(join));
    if (terminal) terminal.side = "neutral";
  });
}

/** A cable breakout: one sheath port and the cores it fans into. */
export const isFan = (node: DiagramNode) => isDiagramJoin(node.device) && node.ports.some((port) => port.id === "cable");

/** Every core on the side opposite the sheath, whatever a later facing pass wanted. */
export function enforceFanSides(node: DiagramNode) {
  if (!isFan(node)) return;
  const cable = node.ports.find((port) => port.id === "cable")!;
  const coreSide: PortSide = cable.side === "input" ? "output" : cable.side === "output" ? "input" : cable.side === "top" ? "neutral" : "top";
  node.ports.forEach((port) => { if (port !== cable) port.side = coreSide; });
}

/**
 * A splice sits just outside the terminal it splices, on whatever edge that
 * terminal is on, with its stem facing the terminal so the stub is one
 * straight segment. Beneath a bottom terminal the other arms keep their flow
 * sides and chained splices hand through to the right; beside a side
 * terminal the feed arrives from outside and the continuation drops down.
 */
function faceSplices(owner: DiagramNode, nodes: readonly DiagramNode[]) {
  const faceChain = (join: DiagramNode) => attachedTo(nodes, join.device.id).forEach((child) => {
    const throughPort = join.ports.find((port) => port.id === "through");
    if (throughPort) throughPort.side = "output";
    const stem = child.ports.find((port) => port.id === "device");
    if (stem) stem.side = "input";
    faceChain(child);
  });
  attachedTo(nodes, owner.device.id).forEach((join) => {
    const terminal = owner.ports.find((port) => port.id === attachmentTerminal(join));
    const side: PortSide = terminal?.side ?? "neutral";
    const stem = join.ports.find((port) => port.id === "device");
    const arms = join.ports.filter((port) => port.id !== "device");
    // A daisy-chain tap is a T: the run continues sideways, the tap leaves
    // perpendicular to it and turns to face whatever it bonds later.
    // A chain of taps is a rail: the run enters each tap on the left and
    // leaves on the right, the tap itself leaves perpendicular and turns to
    // face whatever it bonds once placed. Rails are laid out separately.
    if (join.device.diagramJoinGeometry === "orthogonal-t") {
      const rail = (tap: DiagramNode) => {
        tap.ports.forEach((port) => { port.side = port.id === "device" ? "input" : port.id === "through" ? "output" : "neutral"; });
        attachedTo(nodes, tap.device.id).forEach(rail);
      };
      rail(join);
      return;
    }
    if (side === "neutral") { if (stem) stem.side = "top"; faceChain(join); }
    else if (side === "top") { if (stem) stem.side = "neutral"; faceChain(join); }
    else if (side === "input") {
      if (stem) stem.side = "output";
      arms.forEach((arm) => { arm.side = arm.side === "input" ? "input" : "neutral"; });
    } else {
      if (stem) stem.side = "input";
      arms.forEach((arm) => { arm.side = arm.side === "output" ? "output" : "top"; });
    }
  });
}

function singleLayout(node: DiagramNode): Layout {
  return { nodes: [node], offsets: new Map([[node.device.id, { x: node.width / 2, y: node.height / 2 }]]), width: node.width, height: node.height };
}

function layoutCell(owner: DiagramNode, nodes: readonly DiagramNode[]): Layout {
  const local = new Map<string, Point>([[owner.device.id, { x: 0, y: 0 }]]);
  const cellNodes: DiagramNode[] = [owner];
  const joins = attachedTo(nodes, owner.device.id).map((join) => {
    const terminal = owner.ports.find((port) => port.id === attachmentTerminal(join));
    return { join, side: terminal?.side ?? "neutral", offset: terminal?.offset ?? 0 };
  }).toSorted((a, b) => a.offset - b.offset);
  const placeChain = (join: DiagramNode, x: number, y: number) => {
    local.set(join.device.id, { x, y });
    cellNodes.push(join);
    let cursor = x + join.width / 2;
    attachedTo(nodes, join.device.id).forEach((child) => {
      const childX = cursor + GRID * 4 + child.width / 2;
      placeChain(child, childX, y);
      cursor = childX + child.width / 2;
    });
  };
  // Bottom and top splices: one row per terminal, stepping away from the body
  // so chain wires clear their neighbours.
  (["neutral", "top"] as const).forEach((side) => {
    joins.filter((entry) => entry.side === side).forEach(({ join, offset }, row) => {
      const distance = owner.height / 2 + BLOCK_JOIN_GAP + row * (join.height + GRID * 2) + join.height / 2;
      placeChain(join, offset, side === "neutral" ? distance : -distance);
    });
  });
  // Side splices: one column per terminal, stepping outward so every stem
  // stays a straight stub; anything chained off them stacks beneath.
  const placeStack = (join: DiagramNode, x: number, y: number) => {
    local.set(join.device.id, { x, y });
    cellNodes.push(join);
    let cursor = y + join.height / 2;
    attachedTo(nodes, join.device.id).forEach((child) => {
      const childY = cursor + GRID * 2 + child.height / 2;
      placeStack(child, x, childY);
      cursor = childY + child.height / 2;
    });
  };
  (["input", "output"] as const).forEach((side) => {
    joins.filter((entry) => entry.side === side).forEach(({ join, offset }, column) => {
      const distance = owner.width / 2 + BLOCK_JOIN_GAP + column * (join.width + GRID * 2) + join.width / 2;
      placeStack(join, side === "input" ? -distance : distance, offset);
    });
  });
  return boundedLayout(cellNodes.map((node) => ({ node, point: local.get(node.device.id)! })));
}

/** Layout from centre positions in any frame; offsets become top-left relative. */
function boundedLayout(items: Array<{ node: DiagramNode; point: Point }>): Layout {
  for (const { node, point } of items) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`Non-finite diagram position for ${node.device.id}`);
  }
  const left = Math.min(...items.map(({ node, point }) => point.x - node.width / 2));
  const right = Math.max(...items.map(({ node, point }) => point.x + node.width / 2));
  const top = Math.min(...items.map(({ node, point }) => point.y - node.height / 2));
  const bottom = Math.max(...items.map(({ node, point }) => point.y + node.height / 2));
  const offsets = new Map<string, Point>();
  items.forEach(({ node, point }) => offsets.set(node.device.id, { x: point.x - left, y: point.y - top }));
  return { nodes: items.map(({ node }) => node), offsets, width: snapUp(right - left, GRID), height: snapUp(bottom - top, GRID) };
}

/**
 * Every member of a declared family renders identically: a conductor sits on
 * the same edge in the same slot on every member (an edge that faces a splice
 * on any member faces it on all), and the body takes the family's largest size.
 */
/**
 * Every member of a family renders identically. A conductor's edge is the
 * one its flow role gives it (fed → left, feeding → right; earth and data
 * hang from the bottom), except that a terminal most members splice hangs
 * its splices from the bottom — a daisy chain reads best beneath its row —
 * and storage keeps its posts on the bottom edge.
 */
function unifyFamilies(owners: readonly DiagramNode[], nodes: readonly DiagramNode[]) {
  groupFamilies(owners).forEach((members) => {
    if (members.length < 2) return;
    const ordered = sortFamily(members);
    const conductorIds: string[] = [];
    ordered.forEach((member) => member.ports.forEach((port) => { if (!conductorIds.includes(port.id)) conductorIds.push(port.id); }));
    conductorIds.forEach((id) => {
      const ports = ordered.map((member) => member.ports.find((port) => port.id === id)).filter((port): port is DiagramPort => port !== undefined);
      let chosen: PortSide;
      if (!isFlowKind(ports[0].kind) || ordered[0].device.kind === "battery") chosen = "neutral";
      else {
        const spliced = ordered.filter((member) => attachedTo(nodes, member.device.id).some((join) => attachmentTerminal(join) === id)).length;
        if (spliced * 2 > ordered.length) chosen = "neutral";
        else chosen = ports.filter((port) => port.side === "input").length >= ports.filter((port) => port.side === "output").length ? "input" : "output";
      }
      ports.forEach((port) => { port.side = chosen; });
    });
    lockFamilySlots(ordered);
  });
}

/**
 * Give every member of a family the same body size and the same port slot per
 * conductor: each edge's slots are the union of the conductors any member has
 * there, in declared order, so a member missing one leaves its slot empty.
 */
export function lockFamilySlots(members: readonly DiagramNode[]) {
  const ordered = sortFamily(members);
  const conductorIds: string[] = [];
  ordered.forEach((member) => member.ports.forEach((port) => { if (!conductorIds.includes(port.id)) conductorIds.push(port.id); }));
  const sample = (id: string): DiagramPort => ordered.flatMap((member) => member.ports).find((port) => port.id === id)!;
  const slots = new Map<PortSide, string[]>();
  SIDES.forEach((side) => slots.set(side, conductorIds.filter((id) => sample(id).side === side).toSorted((a, b) => {
    const pa = sample(a); const pb = sample(b);
    return (pa.declaredOrder ?? 0) - (pb.declaredOrder ?? 0) || kindRank[pa.kind] - kindRank[pb.kind] || a.localeCompare(b);
  })));
  const counts = { input: slots.get("input")!.length, output: slots.get("output")!.length, neutral: slots.get("neutral")!.length, top: slots.get("top")!.length };
  const labelLength = Math.max(...ordered.map((member) => member.device.label.length));
  const { width, height } = nodeDimensions(ordered[0].device, counts, ordered[0].abstractJunction, labelLength);
  ordered.forEach((member) => {
    member.width = width; member.height = height; member.lockedPorts = true;
    SIDES.forEach((side) => {
      const ids = slots.get(side)!;
      const offsets = edgeOffsets(ids.length, nodePortPitch(member));
      member.ports.filter((port) => port.side === side).forEach((port) => { port.offset = offsets[ids.indexOf(port.id)]; });
    });
  });
}

function familyBlock(members: DiagramNode[], cellOf: Map<string, Layout>): Layout {
  const ordered = sortFamily(members);
  const columns = Math.max(1, ordered[0].device.layoutGroup?.columns ?? 1);
  const cells = ordered.map((member) => ({ member, cell: cellOf.get(member.device.id)! }));
  // Members align on their bodies, not on their cells: a member with a splice
  // beside it must not shift its body out of the column.
  const bodyLeft = ({ member, cell }: typeof cells[number]) => cell.offsets.get(member.device.id)!.x - member.width / 2;
  const bodyTop = ({ member, cell }: typeof cells[number]) => cell.offsets.get(member.device.id)!.y - member.height / 2;
  const padLeft = Math.max(...cells.map(bodyLeft)); const padTop = Math.max(...cells.map(bodyTop));
  const cellWidth = Math.max(...cells.map((entry) => entry.cell.width + padLeft - bodyLeft(entry)));
  const cellHeight = Math.max(...cells.map((entry) => entry.cell.height + padTop - bodyTop(entry)));
  const items: Array<{ node: DiagramNode; point: Point }> = [];
  cells.forEach((entry, index) => {
    const column = index % columns; const row = Math.floor(index / columns);
    const cellLeft = column * (cellWidth + BLOCK_COLUMN_GAP) + padLeft - bodyLeft(entry);
    const cellTop = row * (cellHeight + BLOCK_ROW_GAP) + padTop - bodyTop(entry);
    entry.cell.nodes.forEach((node) => {
      const offset = entry.cell.offsets.get(node.device.id)!;
      items.push({ node, point: { x: cellLeft + offset.x, y: cellTop + offset.y } });
    });
  });
  return boundedLayout(items);
}

// ---------------------------------------------------------------------------
// Islands
// ---------------------------------------------------------------------------

type Link = { seed: WireSeed; fromNode: string; toNode: string };
type Satellite = { island: Island; hubEndpoints: string[]; leafEndpoints: string[]; /** Beneath the hub, left edges aligned: the next link of a splice chain. */ chained?: boolean };
type Island = {
  id: string;
  kind: "family" | "cell" | "single" | "boundary";
  /** Family members, the cell owner, or the lone node. */
  members: DiagramNode[];
  left: Satellite[];
  right: Satellite[];
  bottom: Satellite[];
  nodeIds: Set<string>;
  size: number;
};

function cellNodes(owner: DiagramNode, nodes: readonly DiagramNode[]): DiagramNode[] {
  return [owner, ...attachedTo(nodes, owner.device.id).flatMap((join) => cellNodes(join, nodes))];
}

/**
 * A family is drawn as one grid block when its members are wired to each
 * other (a series bank, a daisy chain) or all hang off the same equipment;
 * otherwise each member folds into its own hub — two chargers fed by two
 * different sockets land beside their own socket — while still sharing the
 * family's size and port slots.
 */
function familyFormsBlock(members: readonly DiagramNode[], nodes: readonly DiagramNode[], links: readonly Link[]) {
  const cells = members.map((member) => new Set(cellNodes(member, nodes).map((node) => node.device.id)));
  const inFamily = (id: string) => cells.some((cell) => cell.has(id));
  const rootOf = (id: string): string => {
    const node = nodes.find((candidate) => candidate.device.id === id);
    return node?.device.attachment ? rootOf(endpointDeviceId(node.device.attachment.endpoint)) : id;
  };
  if (links.some((link) => inFamily(link.fromNode) && inFamily(link.toNode))) return true;
  const neighbourSets = cells.map((cell) => new Set(links
    .filter((link) => cell.has(link.fromNode) !== cell.has(link.toNode))
    .map((link) => rootOf(cell.has(link.fromNode) ? link.toNode : link.fromNode))));
  const first = [...neighbourSets[0]].toSorted().join("|");
  return neighbourSets.every((set) => [...set].toSorted().join("|") === first);
}

function buildIslands(nodes: DiagramNode[], links: readonly Link[]): Island[] {
  const owners = nodes.filter((node) => !node.device.attachment);
  const families = groupFamilies(owners);
  owners.forEach((owner) => { if ((families.get(familyKey(owner.device) ?? "")?.length ?? 0) < 2) faceLoneSplices(owner, nodes); });
  unifyFamilies(owners, nodes);
  owners.forEach((owner) => faceSplices(owner, nodes));
  const islands: Island[] = [];
  const claimed = new Set<string>();
  const register = (id: string, kind: Island["kind"], members: DiagramNode[], all: DiagramNode[]) => {
    islands.push({ id, kind, members, left: [], right: [], bottom: [], nodeIds: new Set(all.map((node) => node.device.id)), size: all.length });
    all.forEach((node) => claimed.add(node.device.id));
  };
  families.forEach((members, groupId) => {
    if (members.length > 1 && familyFormsBlock(members, nodes, links)) register(`group:${groupId}`, "family", members, members.flatMap((member) => cellNodes(member, nodes)));
  });
  owners.forEach((owner) => { if (!claimed.has(owner.device.id)) register(owner.device.id, "cell", [owner], cellNodes(owner, nodes)); });
  // Attachments whose owner is not in this scope stand alone.
  nodes.forEach((node) => { if (!claimed.has(node.device.id)) register(node.device.id, "single", [node], [node]); });
  return islands;
}

/**
 * Fold leaves and satellites into their hubs until only the cyclic core is
 * left. Smallest islands fold first so chains fold from their far end and a
 * hub is never swallowed by one of its own leaves.
 */
function foldIslands(islands: Island[], links: readonly Link[], allNodes: readonly DiagramNode[]) {
  for (;;) {
    const islandOf = new Map<string, Island>();
    islands.forEach((island) => island.nodeIds.forEach((id) => islandOf.set(id, island)));
    // Where a device is placed is decided by what powers it; its earth and
    // data links only decide for equipment that has no power link at all.
    const adjacency = new Map<Island, Map<Island, Link[]>>();
    const flowAdjacency = new Map<Island, Map<Island, Link[]>>();
    const add = (map: Map<Island, Map<Island, Link[]>>, a: Island, b: Island, link: Link) => {
      const row = map.get(a) ?? new Map<Island, Link[]>();
      row.set(b, [...(row.get(b) ?? []), link]);
      map.set(a, row);
    };
    links.forEach((link) => {
      const a = islandOf.get(link.fromNode); const b = islandOf.get(link.toNode);
      if (!a || !b || a === b) return;
      add(adjacency, a, b, link); add(adjacency, b, a, link);
      if (isFlowKind(link.seed.route.kind)) { add(flowAdjacency, a, b, link); add(flowAdjacency, b, a, link); }
    });
    // Boundary glands are pinned to the canvas edge: they count as neighbours
    // (a bus fed from a gland is not a leaf of its breaker) but nothing ever
    // folds into them.
    const decisive = (island: Island) => flowAdjacency.get(island) ?? adjacency.get(island);
    const hubFor = (island: Island): Island | undefined => {
      const neighbours = decisive(island);
      if (!neighbours || neighbours.size === 0 || island.kind === "boundary") return undefined;
      const ranked = [...neighbours.entries()].toSorted((a, b) => b[1].length - a[1].length || a[0].id.localeCompare(b[0].id));
      const [hub, between] = ranked[0];
      if (hub.kind === "boundary") return undefined;
      const rest = ranked.slice(1).reduce((sum, [, links]) => sum + links.length, 0);
      return neighbours.size === 1 || between.length > rest ? hub : undefined;
    };
    const candidates = islands.filter((island) => hubFor(island) !== undefined)
      .toSorted((a, b) => a.size - b.size || a.id.localeCompare(b.id));
    if (candidates.length === 0) return;
    const leaf = candidates[0];
    const hub = hubFor(leaf)!;
    attachSatellite(hub, leaf, adjacency.get(leaf)!.get(hub)!, allNodes);
    islands.splice(islands.indexOf(leaf), 1);
  }
}

const portOf = (nodes: readonly DiagramNode[], endpointId: string) => nodes
  .find((node) => node.device.id === endpointDeviceId(endpointId))?.ports.find((port) => port.endpointId === endpointId);

/**
 * Hang a satellite off its hub. Earth and data ports carry no flow direction,
 * so the ones joining hub and satellite are turned to face each other: the
 * bond is then a straight wire instead of a loop around the body.
 */
function attachSatellite(hub: Island, leaf: Island, between: readonly Link[], nodes: readonly DiagramNode[] = []) {
  const flow = between.filter((link) => isFlowKind(link.seed.route.kind));
  const hubFeeds = flow.filter((link) => hub.nodeIds.has(link.fromNode)).length;
  let side: "left" | "right" | "bottom" = flow.length === 0 ? "bottom" : hubFeeds >= flow.length - hubFeeds ? "right" : "left";
  const hubEndpoints = between.map((link) => hub.nodeIds.has(link.fromNode) ? link.seed.fromEndpointId : link.seed.toEndpointId);
  const leafEndpoints = between.map((link) => hub.nodeIds.has(link.fromNode) ? link.seed.toEndpointId : link.seed.fromEndpointId);
  // A device of the hub's own kind fed through the splices hanging beneath
  // the hub is the next link of a daisy chain: it goes beneath the hub with
  // left edges aligned, so repeated structure (socket → charger, socket →
  // charger) reads as a grid. Other equipment fed from those splices (a
  // balancer off a battery's posts) still hangs beside the hub.
  const chained = side === "right" && flow.length > 0 && leaf.members[0].device.kind === hub.members[0].device.kind && flow.every((link) => {
    const hubNode = nodes.find((node) => node.device.id === endpointDeviceId(hub.nodeIds.has(link.fromNode) ? link.seed.fromEndpointId : link.seed.toEndpointId));
    return hubNode?.device.attachment !== undefined;
  });
  if (chained) side = "bottom";
  between.forEach((link, index) => {
    if (isFlowKind(link.seed.route.kind)) return;
    // A bond that leaves a splice hanging under the hub is a tap: it keeps its
    // perpendicular arm and the bonded port faces it top/bottom once placed.
    const hubNode = nodes.find((node) => node.device.id === endpointDeviceId(hubEndpoints[index]));
    if (hubNode?.device.attachment) return;
    const hubPort = portOf(nodes, hubEndpoints[index]); const leafPort = portOf(nodes, leafEndpoints[index]);
    if (hubPort) hubPort.side = side === "right" ? "output" : side === "left" ? "input" : "neutral";
    if (leafPort) leafPort.side = side === "right" ? "input" : side === "left" ? "output" : "top";
  });
  hub[side].push({ island: leaf, hubEndpoints, leafEndpoints, chained });
  leaf.nodeIds.forEach((id) => hub.nodeIds.add(id));
  hub.size += leaf.size;
}

/** Sizes and port slots are final only once every fold has faced its ports. */
function finalizeNodes(nodes: readonly DiagramNode[]) {
  const families = new Map<string, DiagramNode[]>();
  nodes.forEach(enforceFanSides);
  nodes.forEach((node) => {
    const key = node.lockedPorts ? familyKey(node.device) : undefined;
    if (key) { families.set(key, [...(families.get(key) ?? []), node]); return; }
    const { width, height } = nodeDimensions(node.device, sideCounts(node.ports), node.abstractJunction);
    node.width = width; node.height = height;
    assignDeclaredOffsets(node);
  });
  families.forEach((members) => lockFamilySlots(members));
}

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
};

function endpointPoint(layout: Layout, endpointId: string): Point | undefined {
  const node = layout.nodes.find((candidate) => candidate.device.id === endpointDeviceId(endpointId));
  const port = node?.ports.find((candidate) => candidate.endpointId === endpointId);
  if (!node || !port) return undefined;
  const offset = layout.offsets.get(node.device.id)!;
  const point = portOffsetPoint(node, port);
  return { x: offset.x + point.x, y: offset.y + point.y };
}

function coreLayout(island: Island, nodes: readonly DiagramNode[]): Layout {
  if (island.kind === "boundary") return { nodes: [], offsets: new Map(), width: 0, height: LANE_HEIGHT };
  if (island.kind === "single") return singleLayout(island.members[0]);
  if (island.kind === "cell") return layoutCell(island.members[0], nodes);
  const cellOf = new Map(island.members.map((member) => [member.device.id, layoutCell(member, nodes)]));
  return familyBlock(island.members, cellOf);
}

/**
 * Recursive island layout: the core at the origin, side satellites in one
 * column per side placed so their connecting ports line up with the hub's
 * (stacked in port order when they would overlap, then re-centred on their
 * targets), bottom satellites in a row beneath everything they would touch.
 */
function layoutIsland(island: Island, nodes: readonly DiagramNode[], links: readonly Link[]): Layout {
  const core = coreLayout(island, nodes);
  if (island.kind === "boundary") return core;
  const placed: Array<{ layout: Layout; x: number; y: number }> = [{ layout: core, x: 0, y: 0 }];
  const sideColumn = (satellites: readonly Satellite[], sign: 1 | -1) => {
    const items = satellites.map((satellite) => {
      const layout = layoutIsland(satellite.island, nodes, links);
      const hubY = mean(satellite.hubEndpoints.map((endpoint) => endpointPoint(core, endpoint)?.y).filter((y): y is number => y !== undefined));
      const leafY = mean(satellite.leafEndpoints.map((endpoint) => endpointPoint(layout, endpoint)?.y).filter((y): y is number => y !== undefined));
      return { satellite, layout, hubY, target: snap(hubY - leafY), y: 0, id: satellite.island.id };
    });
    // Satellites wired to each other stack together, feeder above fed, so
    // their wire never has to cross another satellite's feed; independent
    // groups follow the hub's port order.
    const ownerOf = (nodeId: string) => items.find((item) => item.satellite.island.nodeIds.has(nodeId));
    const pairs = links.flatMap((link) => {
      const a = ownerOf(link.fromNode); const b = ownerOf(link.toNode);
      return a && b && a !== b ? [{ from: a, to: b }] : [];
    });
    const groupOf = new Map(items.map((item) => [item, item]));
    const find = (item: typeof items[number]): typeof items[number] => groupOf.get(item) === item ? item : find(groupOf.get(item)!);
    pairs.forEach(({ from, to }) => { groupOf.set(find(from), find(to)); });
    const groups = new Map<typeof items[number], typeof items>();
    items.forEach((item) => { const root = find(item); groups.set(root, [...(groups.get(root) ?? []), item]); });
    const ordered = [...groups.values()]
      .map((group) => {
        const rank = new Map(group.map((item) => [item, 0]));
        for (let pass = 0; pass < group.length; pass += 1) {
          pairs.forEach(({ from, to }) => { if (rank.has(from) && rank.has(to) && rank.get(to)! <= rank.get(from)!) rank.set(to, rank.get(from)! + 1); });
        }
        return group.toSorted((a, b) => rank.get(a)! - rank.get(b)! || a.hubY - b.hubY || a.id.localeCompare(b.id));
      })
      .toSorted((a, b) => Math.min(...a.map((item) => item.hubY)) - Math.min(...b.map((item) => item.hubY)) || a[0].id.localeCompare(b[0].id))
      .flat();
    items.splice(0, items.length, ...ordered);
    // A satellite fed through another satellite (an enclosure behind a fan)
    // aligns with that satellite's port, which is placed by now, so the wire
    // between them stays straight.
    let cursor = -Infinity;
    const placedItems = new Set<typeof items[number]>();
    items.forEach((item) => {
      const hubYs = item.satellite.hubEndpoints.map((endpoint) => {
        const inCore = endpointPoint(core, endpoint)?.y;
        if (inCore !== undefined) return inCore;
        const via = [...placedItems].find((other) => other.satellite.island.nodeIds.has(endpointDeviceId(endpoint)));
        const point = via ? endpointPoint(via.layout, endpoint) : undefined;
        return via && point ? via.y + point.y : undefined;
      }).filter((y): y is number => y !== undefined);
      const leafY = mean(item.satellite.leafEndpoints.map((endpoint) => endpointPoint(item.layout, endpoint)?.y).filter((y): y is number => y !== undefined));
      if (hubYs.length > 0) item.target = snap(mean(hubYs) - leafY);
      item.y = Math.max(item.target, cursor);
      placedItems.add(item);
      cursor = item.y + item.layout.height + SATELLITE_STACK_GAP;
    });
    const shift = snap(median(items.map((item) => item.target - item.y)));
    items.forEach((item) => {
      item.y += shift;
      const x = sign > 0 ? core.width + SATELLITE_GAP : -SATELLITE_GAP - item.layout.width;
      placed.push({ layout: item.layout, x, y: item.y });
    });
  };
  sideColumn(island.right, 1);
  sideColumn(island.left, -1);
  const bottomItems = island.bottom.map((satellite) => {
    const layout = layoutIsland(satellite.island, nodes, links);
    const hubX = mean(satellite.hubEndpoints.map((endpoint) => endpointPoint(core, endpoint)?.x).filter((x): x is number => x !== undefined));
    const leafX = mean(satellite.leafEndpoints.map((endpoint) => endpointPoint(layout, endpoint)?.x).filter((x): x is number => x !== undefined));
    return { layout, hubX, target: satellite.chained ? 0 : snap(hubX - leafX), id: satellite.island.id };
  }).toSorted((a, b) => a.target - b.target || a.hubX - b.hubX || a.id.localeCompare(b.id));
  let cursor = -Infinity;
  bottomItems.forEach((item) => {
    const x = Math.max(item.target, cursor);
    cursor = x + item.layout.width + SATELLITE_GAP;
    const floor = Math.max(core.height, ...placed
      .filter((other) => other.x < x + item.layout.width && other.x + other.layout.width > x)
      .map((other) => other.y + other.layout.height));
    placed.push({ layout: item.layout, x, y: snap(floor + SATELLITE_DROP_GAP) });
  });
  alignTapRails(core, placed, links);
  const items: Array<{ node: DiagramNode; point: Point }> = [];
  placed.forEach(({ layout, x, y }) => layout.nodes.forEach((node) => {
    const offset = layout.offsets.get(node.device.id)!;
    items.push({ node, point: { x: x + offset.x, y: y + offset.y } });
  }));
  return boundedLayout(items);
}

/**
 * A chain of daisy-chain taps beneath a terminal is an earth rail: each tap
 * slides along its row to sit under whatever it taps, when that lies in this
 * island, so the tap is one vertical wire and the rail stays a straight run.
 * Taps keep their chain order and never land on another node.
 */
function alignTapRails(core: Layout, placed: ReadonlyArray<{ layout: Layout; x: number; y: number }>, links: readonly Link[]) {
  const absolute = new Map<string, { node: DiagramNode; point: Point }>();
  placed.forEach(({ layout, x, y }) => layout.nodes.forEach((node) => {
    const offset = layout.offsets.get(node.device.id)!;
    absolute.set(node.device.id, { node, point: { x: x + offset.x, y: y + offset.y } });
  }));
  const isTap = (node: DiagramNode) => node.device.diagramJoinGeometry === "orthogonal-t" && node.device.attachment !== undefined;
  const chainOf = (first: DiagramNode): DiagramNode[] => {
    const next = core.nodes.find((node) => isTap(node) && node.device.attachment!.endpoint === `${first.device.id}.through`);
    return next ? [first, ...chainOf(next)] : [first];
  };
  const heads = core.nodes.filter((node) => isTap(node) && !isTap(absolute.get(endpointDeviceId(node.device.attachment!.endpoint))?.node ?? node));
  if (heads.length === 0) return;
  // The rail runs beneath everything in the island so every tap rises clear.
  const floor = Math.max(...[...absolute.values()].filter(({ node }) => !isTap(node)).map(({ node, point }) => point.y + node.height / 2));
  const seedsAt = (endpoint: string) => links.filter((link) => link.seed.fromEndpointId === endpoint || link.seed.toEndpointId === endpoint);
  heads.forEach((head) => {
    const chain = chainOf(head);
    const railY = snap(floor + GRID * 3 + head.height / 2);
    // Where each tap wants to be: under the port it bonds, or a cell to the
    // side of it when that port is on a side edge.
    const wanted = chain.map((join, index) => {
      const branch = join.ports.find((port) => port.id === "branch");
      const link = branch && seedsAt(branch.endpointId)[0];
      const otherEnd = link ? (link.seed.fromEndpointId === branch!.endpointId ? link.seed.toEndpointId : link.seed.fromEndpointId) : undefined;
      const target = otherEnd ? absolute.get(endpointDeviceId(otherEnd)) : undefined;
      const port = target?.node.ports.find((candidate) => candidate.endpointId === otherEnd);
      if (!target || !port) return { join, index, x: undefined as number | undefined };
      const point = portOffsetPoint(target.node, port);
      const lead = port.side === "input" ? -GRID * 2 : port.side === "output" ? GRID * 2 : 0;
      return { join, index, x: target.point.x + point.x + lead };
    });
    // Taps are interchangeable along a rail, so order them by their targets;
    // those bonding outside this island trail at the end in chain order.
    const ordered = wanted.toSorted((a, b) => (a.x ?? Infinity) - (b.x ?? Infinity) || a.index - b.index);
    let cursor = -Infinity;
    ordered.forEach(({ join, x }) => {
      const placedX = snap(Math.max(cursor, x ?? core.offsets.get(join.device.id)!.x));
      core.offsets.get(join.device.id)!.x = placedX;
      core.offsets.get(join.device.id)!.y = railY;
      absolute.get(join.device.id)!.point = { x: placedX, y: railY };
      cursor = placedX + join.width + GRID * 2;
    });
    // Re-thread the rail: the run enters the first tap from the head terminal,
    // continues tap to tap, and whatever hung off the old last tap's run now
    // hangs off the new last tap's.
    const terminal = head.device.attachment!.endpoint;
    const runSeeds = [terminal, ...chain.slice(0, -1).map((join) => `${join.device.id}.through`)].map((from, index) => (
      seedsAt(from).find((link) => link.seed.toEndpointId === `${chain[index].device.id}.device` || link.seed.fromEndpointId === `${chain[index].device.id}.device`)
    ));
    const oldTail = `${chain[chain.length - 1].device.id}.through`;
    const newTail = `${ordered[ordered.length - 1].join.device.id}.through`;
    const tailSeeds = seedsAt(oldTail).filter((link) => !runSeeds.includes(link));
    runSeeds.forEach((link, index) => {
      if (!link) return;
      const from = index === 0 ? terminal : `${ordered[index - 1].join.device.id}.through`;
      const to = `${ordered[index].join.device.id}.device`;
      link.seed.fromEndpointId = from; link.seed.toEndpointId = to;
      link.fromNode = endpointDeviceId(from); link.toNode = endpointDeviceId(to);
    });
    if (oldTail !== newTail) tailSeeds.forEach((link) => {
      if (link.seed.fromEndpointId === oldTail) { link.seed.fromEndpointId = newTail; link.fromNode = endpointDeviceId(newTail); }
      if (link.seed.toEndpointId === oldTail) { link.seed.toEndpointId = newTail; link.toNode = endpointDeviceId(newTail); }
    });
    if (process.env.DSE_DIAGRAM_DEBUG) console.warn(`rail ${head.device.id}: ${ordered.map(({ join, x }) => `${join.device.id}@${x ?? "-"}`).join(" → ")}`);
  });
}

// ---------------------------------------------------------------------------
// Layered core
// ---------------------------------------------------------------------------

type Macro = {
  id: string;
  nodes: DiagramNode[];
  /** Node centres relative to the macro centre. */
  offsets: Map<string, Point>;
  width: number;
  height: number;
  x: number;
  y: number;
  dummy: boolean;
};
type MacroEdge = { from: string; to: string; flow: boolean; weight: number; fromPortY: number; toPortY: number };
type Placement = { layerOf: Map<string, number>; layers: string[][] };

function macroFromLayout(id: string, layout: Layout, dummy = false): Macro {
  const offsets = new Map<string, Point>();
  layout.nodes.forEach((node) => {
    const offset = layout.offsets.get(node.device.id)!;
    offsets.set(node.device.id, { x: offset.x - layout.width / 2, y: offset.y - layout.height / 2 });
  });
  return { id, nodes: layout.nodes, offsets, width: layout.width, height: layout.height, x: 0, y: 0, dummy };
}

function macroPortY(macro: Macro, endpointId: string) {
  const node = macro.nodes.find((candidate) => candidate.device.id === endpointDeviceId(endpointId));
  const port = node?.ports.find((candidate) => candidate.endpointId === endpointId);
  if (!node || !port) return 0;
  return macro.offsets.get(node.device.id)!.y + portOffsetPoint(node, port).y;
}

type LayerEdge = { from: string; to: string; flow: boolean; weight: number };

function assignLayers(macros: ReadonlyArray<{ id: string; nodes: readonly DiagramNode[] }>, edges: readonly LayerEdge[], hints: DiagramLayoutHints): Placement {
  const ids = macros.map((macro) => macro.id);
  const succ = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const pred = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const outNeutral = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const inNeutral = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  // Cycles are broken greedily by total wire weight: heavier connections are
  // admitted first and any edge that would close a cycle is demoted to a
  // neutral (non-layering) edge, so a three-core link outranks one sheath.
  const pairs = new Map<string, { from: string; to: string; weight: number }>();
  edges.filter((edge) => edge.flow).forEach((edge) => {
    const key = `${edge.from}>${edge.to}`;
    const pair = pairs.get(key) ?? { from: edge.from, to: edge.to, weight: 0 };
    pair.weight += edge.weight;
    pairs.set(key, pair);
  });
  const reaches = (from: string, to: string) => {
    const stack = [from]; const seen = new Set<string>([from]);
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      succ.get(id)!.forEach((next) => { if (!seen.has(next)) { seen.add(next); stack.push(next); } });
    }
    return false;
  };
  [...pairs.values()].toSorted((a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)).forEach((pair) => {
    if (reaches(pair.to, pair.from)) { outNeutral.get(pair.from)!.add(pair.to); inNeutral.get(pair.to)!.add(pair.from); return; }
    succ.get(pair.from)!.add(pair.to); pred.get(pair.to)!.add(pair.from);
  });
  edges.filter((edge) => !edge.flow).forEach((edge) => { outNeutral.get(edge.from)!.add(edge.to); inNeutral.get(edge.to)!.add(edge.from); });
  // Longest path from sources, then pull every node right toward its
  // successors so a node sits beside what it feeds.
  const layerOf = new Map<string, number>();
  const depth = (id: string): number => {
    const cached = layerOf.get(id);
    if (cached !== undefined) return cached;
    layerOf.set(id, 0);
    const value = Math.max(0, ...[...pred.get(id)!].map((previous) => depth(previous) + 1));
    layerOf.set(id, value);
    return value;
  };
  ids.forEach(depth);
  const topo = [...ids].toSorted((a, b) => layerOf.get(a)! - layerOf.get(b)!);
  for (let pass = 0; pass < 4; pass += 1) {
    [...topo].reverse().forEach((id) => {
      const successors = [...succ.get(id)!];
      if (successors.length === 0) return;
      const target = Math.min(...successors.map((next) => layerOf.get(next)!)) - 1;
      if (target > layerOf.get(id)!) layerOf.set(id, target);
    });
  }
  // Nodes with only earth/data edges hug their neighbours: a pure source sits
  // one layer before them, a pure sink one layer after, otherwise the median.
  ids.forEach((id) => {
    if (pred.get(id)!.size > 0 || succ.get(id)!.size > 0) return;
    const outs = [...outNeutral.get(id)!].map((other) => layerOf.get(other)!);
    const ins = [...inNeutral.get(id)!].map((other) => layerOf.get(other)!);
    const around = [...outs, ...ins].toSorted((a, b) => a - b);
    if (around.length === 0) return;
    if (ins.length === 0) layerOf.set(id, Math.max(0, Math.min(...outs) - 1));
    else if (outs.length === 0) layerOf.set(id, Math.max(...ins) + 1);
    else layerOf.set(id, around[Math.floor((around.length - 1) / 2)]);
  });
  const count = Math.max(0, ...ids.map((id) => layerOf.get(id)! + 1));
  const layers: string[][] = Array.from({ length: count }, () => []);
  ids.forEach((id) => layers[layerOf.get(id)!].push(id));
  const macroById = new Map(macros.map((macro) => [macro.id, macro]));
  const hintY = (id: string) => {
    const macro = macroById.get(id)!;
    const centres = macro.nodes.map((node) => hints.previousCenters?.get(node.device.id)?.y).filter((y): y is number => y !== undefined);
    return centres.length ? centres.reduce((a, b) => a + b, 0) / centres.length : undefined;
  };
  layers.forEach((layer) => layer.sort((a, b) => {
    const pa = hintY(a); const pb = hintY(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    return ids.indexOf(a) - ids.indexOf(b);
  }));
  return { layerOf, layers };
}

/** Replace every edge spanning more than one layer by a chain of dummy lane
 * macros so ordering and alignment see only adjacent-layer edges. */
function insertDummies(macros: Macro[], edges: MacroEdge[], placement: Placement) {
  const expanded: MacroEdge[] = [];
  let counter = 0;
  edges.forEach((edge) => {
    const a = placement.layerOf.get(edge.from)!; const b = placement.layerOf.get(edge.to)!;
    if (Math.abs(a - b) <= 1) { expanded.push(edge); return; }
    const step = Math.sign(b - a);
    let previous = edge.from; let previousPortY = edge.fromPortY;
    for (let layer = a + step; layer !== b; layer += step) {
      const id = `dummy:${counter++}`;
      const macro: Macro = { id, nodes: [], offsets: new Map(), width: 0, height: LANE_HEIGHT, x: 0, y: 0, dummy: true };
      macros.push(macro);
      placement.layerOf.set(id, layer);
      placement.layers[layer].push(id);
      expanded.push({ from: previous, to: id, flow: edge.flow, weight: edge.weight, fromPortY: previousPortY, toPortY: 0 });
      previous = id; previousPortY = 0;
    }
    expanded.push({ from: previous, to: edge.to, flow: edge.flow, weight: edge.weight, fromPortY: previousPortY, toPortY: edge.toPortY });
  });
  return expanded;
}

function orderLayers(placement: Placement, edges: MacroEdge[]) {
  const links = new Map<string, Array<{ other: string; weight: number }>>();
  placement.layerOf.forEach((_, id) => links.set(id, []));
  edges.forEach((edge) => {
    links.get(edge.from)!.push({ other: edge.to, weight: edge.weight });
    links.get(edge.to)!.push({ other: edge.from, weight: edge.weight });
  });
  const position = new Map<string, number>();
  const refresh = () => placement.layers.forEach((layer) => layer.forEach((id, index) => position.set(id, index)));
  refresh();
  const barycentre = (id: string, layerIndex: number, direction: -1 | 1) => {
    const adjacent = links.get(id)!.filter(({ other }) => placement.layerOf.get(other)! === layerIndex + direction);
    if (adjacent.length === 0) return undefined;
    const total = adjacent.reduce((sum, { weight }) => sum + weight, 0);
    return adjacent.reduce((sum, { other, weight }) => sum + position.get(other)! * weight, 0) / total;
  };
  for (let sweep = 0; sweep < 16; sweep += 1) {
    const direction: -1 | 1 = sweep % 2 === 0 ? -1 : 1;
    const order = direction === -1 ? placement.layers.keys() : [...placement.layers.keys()].reverse();
    for (const layerIndex of order) {
      const layer = placement.layers[layerIndex];
      const keys = new Map(layer.map((id) => [id, barycentre(id, layerIndex, direction) ?? position.get(id)!]));
      layer.sort((a, b) => keys.get(a)! - keys.get(b)! || position.get(a)! - position.get(b)!);
      refresh();
    }
  }
}

/** Weighted median; when the half-weight falls exactly between two values
 * (the usual two-neighbour case) the two middle values are averaged. */
function weightedMedian(values: Array<{ y: number; weight: number }>) {
  const sorted = values.toSorted((a, b) => a.y - b.y);
  const total = sorted.reduce((sum, { weight }) => sum + weight, 0);
  let acc = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    acc += sorted[index].weight;
    if (Math.abs(acc - total / 2) < 1e-9 && index + 1 < sorted.length) return (sorted[index].y + sorted[index + 1].y) / 2;
    if (acc > total / 2) return sorted[index].y;
  }
  return sorted.at(-1)!.y;
}

function assignCoordinates(placement: Placement, macros: Macro[], edges: MacroEdge[]) {
  const macroById = new Map(macros.map((macro) => [macro.id, macro]));
  // Each link records where the wire leaves this macro and where it lands on
  // the other, so alignment targets put the two ports level, not the centres.
  const links = new Map<string, Array<{ other: string; weight: number; myPortY: number; otherPortY: number }>>();
  macros.forEach((macro) => links.set(macro.id, []));
  edges.forEach((edge) => {
    links.get(edge.from)!.push({ other: edge.to, weight: edge.weight, myPortY: edge.fromPortY, otherPortY: edge.toPortY });
    links.get(edge.to)!.push({ other: edge.from, weight: edge.weight, myPortY: edge.toPortY, otherPortY: edge.fromPortY });
  });
  const gapBetween = (a: Macro, b: Macro) => a.dummy && b.dummy ? GRID : a.dummy || b.dummy ? GRID * 3 : GRID * 8;
  placement.layers.forEach((layer) => {
    let y = 0;
    layer.forEach((id, index) => {
      const macro = macroById.get(id)!;
      if (index > 0) y += gapBetween(macroById.get(layer[index - 1])!, macro);
      macro.y = snap(y + macro.height / 2);
      y += macro.height;
    });
  });
  // Priority sweeps: each layer is placed against one already-placed
  // neighbouring layer. Nodes are handled in priority order (lane dummies
  // first, then by how many neighbours they have there); each lands as close
  // to the median of its port-aligned targets as the nodes already fixed in
  // this layer allow, pushing only the not-yet-fixed ones aside.
  const placeLayer = (layerIndex: number, referenceLayer: number) => {
    const layer = placement.layers[layerIndex];
    const items = layer.map((id) => macroById.get(id)!);
    const n = items.length;
    const desired: number[] = []; const priority: number[] = [];
    const otherSide = layerIndex + (layerIndex - referenceLayer);
    items.forEach((macro) => {
      const neighbours = (reference: number) => links.get(macro.id)!
        .filter(({ other }) => placement.layerOf.get(other) === reference)
        .map(({ other, weight, myPortY, otherPortY }) => ({ y: macroById.get(other)!.y + otherPortY - myPortY, weight }));
      // A node with nothing on the reference side follows its other side, so
      // sources and leaves track the equipment they connect to.
      const adjacent = neighbours(referenceLayer);
      const fallback = adjacent.length > 0 ? adjacent : neighbours(otherSide);
      desired.push(fallback.length > 0 ? weightedMedian(fallback) : macro.y);
      priority.push(macro.dummy ? 1e6 : adjacent.reduce((sum, { weight }) => sum + weight, 0) + fallback.length * 0.01);
    });
    // Order the layer by its targets (stable for ties) so that placement only
    // ever resolves overlaps and never fights the order.
    const ranking = items.map((_, index) => index).toSorted((a, b) => desired[a] - desired[b] || a - b);
    const sortedItems = ranking.map((index) => items[index]);
    const sortedDesired = ranking.map((index) => desired[index]);
    const sortedPriority = ranking.map((index) => priority[index]);
    items.splice(0, n, ...sortedItems); desired.splice(0, n, ...sortedDesired); priority.splice(0, n, ...sortedPriority);
    placement.layers[layerIndex] = items.map((macro) => macro.id);
    const y = items.map((macro) => macro.y);
    const fixed = new Array<boolean>(n).fill(false);
    const gap = (i: number, j: number) => items[i].height / 2 + gapBetween(items[i], items[j]) + items[j].height / 2;
    const order = items.map((_, index) => index).toSorted((a, b) => priority[b] - priority[a] || a - b);
    order.forEach((k) => {
      let minimum = -Infinity; let maximum = Infinity;
      let span = 0;
      for (let i = k - 1; i >= 0; i -= 1) {
        span += gap(i, i + 1);
        if (fixed[i]) { minimum = Math.max(minimum, y[i] + span); break; }
      }
      span = 0;
      for (let j = k + 1; j < n; j += 1) {
        span += gap(j - 1, j);
        if (fixed[j]) { maximum = Math.min(maximum, y[j] - span); break; }
      }
      let target = Math.max(minimum, Math.min(maximum, desired[k]));
      if (minimum > maximum) target = minimum;
      y[k] = target;
      fixed[k] = true;
      for (let i = k - 1; i >= 0 && !fixed[i]; i -= 1) y[i] = Math.min(y[i], y[i + 1] - gap(i, i + 1));
      for (let j = k + 1; j < n && !fixed[j]; j += 1) y[j] = Math.max(y[j], y[j - 1] + gap(j - 1, j));
    });
    // Recentre the layer on its targets: overlap resolution can only push
    // nodes apart, so without this every sweep would creep downward.
    const anchored = items.map((_, index) => index).filter((index) => priority[index] > 0);
    if (anchored.length > 0) {
      const residuals = anchored.map((index) => desired[index] - y[index]).toSorted((a, b) => a - b);
      const middle = Math.floor((residuals.length - 1) / 2);
      // Average the middle pair for even counts, or the lower one biases every sweep.
      const shift = residuals.length % 2 === 1 ? residuals[middle] : (residuals[middle] + residuals[middle + 1]) / 2;
      items.forEach((_, index) => { y[index] += shift; });
    }
    items.forEach((macro, index) => { macro.y = snap(y[index]); });
  };
  const count = placement.layers.length;
  const dump = (label: string) => {
    if (!process.env.DSE_DIAGRAM_DEBUG) return;
    console.warn(`  ${label}: ` + placement.layers.map((layer, index) => `L${index}[` + layer.map((id) => `${id.replace("group:", "g:").replace("dummy:", "d")}@${macroById.get(id)!.y}`).join(" ") + "]").join(" "));
  };
  dump("initial");
  for (let sweep = 0; sweep < 10; sweep += 1) {
    if (sweep % 2 === 0) for (let layer = 1; layer < count; layer += 1) placeLayer(layer, layer - 1);
    else for (let layer = count - 2; layer >= 0; layer -= 1) placeLayer(layer, layer + 1);
    dump(`sweep ${sweep}`);
  }
  // Column x positions: widest macro per layer plus a routing gap sized by
  // the wires that actually change row between the two layers.
  const layerWidth = placement.layers.map((layer) => Math.max(120, ...layer.map((id) => macroById.get(id)!.width)));
  const jogs = placement.layers.map(() => 0);
  edges.forEach((edge) => {
    const a = macroById.get(edge.from)!; const b = macroById.get(edge.to)!;
    const la = placement.layerOf.get(edge.from)!; const lb = placement.layerOf.get(edge.to)!;
    if (Math.abs(la - lb) !== 1) return;
    if (Math.abs((a.y + edge.fromPortY) - (b.y + edge.toPortY)) > GRID * 2) jogs[Math.min(la, lb)] += 1;
  });
  let cursor = 0;
  placement.layers.forEach((layer, index) => {
    const x = snap(cursor + layerWidth[index] / 2);
    layer.forEach((id) => { macroById.get(id)!.x = x; });
    const gap = Math.max(GRID * 8, Math.min(GRID * 24, GRID * 6 + jogs[index] * GRID * 1.5));
    cursor += layerWidth[index] + gap;
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function describeIsland(island: Island, indent = ""): string {
  const lines = [`${indent}${island.id} ${island.kind}[${island.members.map((node) => node.device.id).join(",")}] n=${island.size}`];
  (["left", "right", "bottom"] as const).forEach((side) => island[side].forEach((satellite) => {
    lines.push(`${indent}  ${side}:`);
    lines.push(describeIsland(satellite.island, `${indent}    `));
  }));
  return lines.join("\n");
}

/**
 * Earth and data wires between core islands face the layer they run to: a
 * bond from an earlier layer enters on the left, one to a later layer leaves
 * on the right. Only wires between islands in the same layer keep hanging
 * from the bottom edge.
 */
function faceCoreLinks(links: readonly Link[], islandOf: ReadonlyMap<string, Island>, layerOf: ReadonlyMap<string, number>, nodes: readonly DiagramNode[]) {
  links.forEach((link) => {
    if (isFlowKind(link.seed.route.kind)) return;
    const from = islandOf.get(link.fromNode)!; const to = islandOf.get(link.toNode)!;
    if (from === to || from.kind === "boundary" || to.kind === "boundary") return;
    const fromLayer = layerOf.get(from.id)!; const toLayer = layerOf.get(to.id)!;
    if (fromLayer === toLayer) return;
    const fromPort = portOf(nodes, link.seed.fromEndpointId); const toPort = portOf(nodes, link.seed.toEndpointId);
    if (fromPort) fromPort.side = fromLayer < toLayer ? "output" : "input";
    if (toPort) toPort.side = fromLayer < toLayer ? "input" : "output";
  });
}

function collectIslands(island: Island): Island[] {
  return [island, ...(["left", "right", "bottom"] as const).flatMap((side) => island[side].flatMap((satellite) => collectIslands(satellite.island)))];
}

/**
 * Full placement: cells → islands → fold → core layers → facing →
 * coordinates → nodes. Returns the move units for compaction: every island
 * with everything folded into it, smallest first, so a leaf can slide toward
 * its hub and a whole cluster can slide toward its peers, but nothing inside
 * a grid or a satellite column ever moves on its own.
 */
export type MoveUnit = { nodes: DiagramNode[]; /** May move for shorter wire alone (islands); otherwise only to remove a jump or a turn. */ lengthMoves: boolean };

/** A subpatch gland on the canvas edge: an input on the left, everything else on the right. */
export type BoundaryAnchor = { endpointId: string; side: PortSide };

export function placeDiagram(nodes: DiagramNode[], seeds: readonly WireSeed[], hints: DiagramLayoutHints, boundary: readonly BoundaryAnchor[] = []): { units: MoveUnit[]; boundaryY: Map<string, number> } {
  const nodeIds = new Set(nodes.map((node) => node.device.id));
  const boundaryIds = new Set(boundary.map((anchor) => anchor.endpointId));
  const keyOf = (endpoint: string) => boundaryIds.has(endpoint) ? endpoint : endpointDeviceId(endpoint);
  const known = (key: string) => nodeIds.has(key) || boundaryIds.has(key);
  const links: Link[] = seeds.flatMap((seed) => {
    const fromNode = keyOf(seed.fromEndpointId); const toNode = keyOf(seed.toEndpointId);
    if (!known(fromNode) || !known(toNode) || fromNode === toNode) return [];
    return [{ seed, fromNode, toNode }];
  });
  const islands = buildIslands(nodes, links);
  // Boundary glands take part in layering and ordering as pinned, zero-width
  // islands: inputs form the first layer, outputs the last, so what a box is
  // fed by sits at its left edge and what it feeds runs to its right edge.
  boundary.forEach((anchor) => islands.push({ id: anchor.endpointId, kind: "boundary", members: [], left: [], right: [], bottom: [], nodeIds: new Set([anchor.endpointId]), size: 0 }));
  foldIslands(islands, links, nodes);
  if (process.env.DSE_DIAGRAM_DEBUG) console.warn(islands.map((island) => describeIsland(island)).join("\n"));
  const islandOf = new Map<string, Island>();
  islands.forEach((island) => island.nodeIds.forEach((id) => islandOf.set(id, island)));
  // Boundary glands take part in layering like any source or sink, so an
  // island fed from a gland is never mistaken for an earth-only orphan; they
  // are then pinned to the first and last layers.
  const layerEdges: LayerEdge[] = links.flatMap((link) => {
    const from = islandOf.get(link.fromNode)!; const to = islandOf.get(link.toNode)!;
    if (from === to) return [];
    const flow = isFlowKind(link.seed.route.kind);
    return [{ from: from.id, to: to.id, flow, weight: flow ? 1 : 0.35 }];
  });
  if (process.env.DSE_DIAGRAM_DEBUG) console.warn("layer edges: " + layerEdges.map((edge) => `${edge.from}${edge.flow ? "->" : "~>"}${edge.to}`).join(" "));
  const placement = assignLayers(islands.map((island) => ({ id: island.id, nodes: nodes.filter((node) => island.nodeIds.has(node.device.id)) })), layerEdges, hints);
  if (boundary.length > 0) {
    const real = islands.filter((island) => island.kind !== "boundary");
    const lowest = Math.min(...real.map((island) => placement.layerOf.get(island.id)!));
    const shift = lowest === 0 ? 1 : 0;
    real.forEach((island) => placement.layerOf.set(island.id, placement.layerOf.get(island.id)! + shift));
    const last = Math.max(...real.map((island) => placement.layerOf.get(island.id)!)) + 1;
    boundary.forEach((anchor) => placement.layerOf.set(anchor.endpointId, anchor.side === "input" ? 0 : last));
    placement.layers = Array.from({ length: last + 1 }, () => []);
    const ids = [...placement.layerOf.keys()];
    islands.forEach((island) => placement.layers[placement.layerOf.get(island.id)!].push(island.id));
    placement.layers.forEach((layer) => layer.sort((a, b) => ids.indexOf(a) - ids.indexOf(b)));
  }
  faceCoreLinks(links, islandOf, placement.layerOf, nodes);
  finalizeNodes(nodes);
  const macros = islands.map((island) => macroFromLayout(island.id, layoutIsland(island, nodes, links), island.kind === "boundary"));
  const macroOf = new Map<string, Macro>();
  islands.forEach((island, index) => island.nodeIds.forEach((id) => macroOf.set(id, macros[index])));
  const edges: MacroEdge[] = [];
  links.forEach((link) => {
    const from = macroOf.get(link.fromNode)!; const to = macroOf.get(link.toNode)!;
    if (from === to) return;
    const flow = isFlowKind(link.seed.route.kind);
    edges.push({
      from: from.id, to: to.id, flow, weight: flow ? 1 : 0.35,
      fromPortY: macroPortY(from, link.seed.fromEndpointId), toPortY: macroPortY(to, link.seed.toEndpointId),
    });
  });
  const expanded = insertDummies(macros, edges, placement);
  orderLayers(placement, expanded);
  assignCoordinates(placement, macros, expanded);
  macros.forEach((macro) => {
    if (macro.dummy) return;
    macro.nodes.forEach((node) => {
      const offset = macro.offsets.get(node.device.id)!;
      node.x = snap(macro.x + offset.x);
      node.y = snap(macro.y + offset.y);
    });
  });
  const boundaryY = new Map(macros.filter((macro) => boundaryIds.has(macro.id)).map((macro) => [macro.id, macro.y]));
  const all = islands.filter((island) => island.kind !== "boundary").flatMap(collectIslands).toSorted((a, b) => a.size - b.size || a.id.localeCompare(b.id));
  // Links of a daisy chain keep their grid: they only move with their hub.
  const pinned = new Set<string>();
  all.forEach((island) => island.bottom.filter((satellite) => satellite.chained)
    .forEach((satellite) => satellite.island.nodeIds.forEach((id) => pinned.add(id))));
  const free = all.filter((island) => ![...island.nodeIds].some((id) => pinned.has(id)) || island.nodeIds.size > island.members.length && !pinned.has(island.members[0].device.id));
  const islandUnits: MoveUnit[] = free.map((island) => ({ nodes: nodes.filter((node) => island.nodeIds.has(node.device.id)), lengthMoves: true }));
  // Devices inside a hub core or a satellite column may still move on their
  // own, but only when that removes a jump or a turn.
  const singles = new Set(all.filter((island) => island.size === island.members.length && island.kind !== "family").map((island) => island.id));
  const cellUnits: MoveUnit[] = nodes
    .filter((node) => !node.device.attachment && !node.device.layoutGroup && !singles.has(node.device.id) && !pinned.has(node.device.id))
    .map((owner) => ({ nodes: cellNodes(owner, nodes), lengthMoves: false }));
  return { units: [...islandUnits, ...cellUnits], boundaryY };
}

export { sideCounts };
