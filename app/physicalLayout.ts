import {
  geometryMetres,
  geometryUnits,
  graphConnectionDisplayLabel,
  graphEndpointDisplayLabel,
  graphEndpointOwnerLabels,
} from "./systemGraph";
import type {
  Conductor,
  Device,
  Face,
  Gland,
  Junction,
  ResolvedConductor,
  ResolvedDevice,
  SystemGraph,
  Vec3,
} from "./systemGraph";

/**
 * Physical layout: resolves every device to a world position, every terminal
 * to a world point and outward direction, and each enclosure's declared
 * gland rows. Everything here is derived from the graph's declared faces,
 * sections and orders; no device ids are special-cased.
 *
 * Lattice conventions (all in metres):
 * - ROUTE_CELL = 0.020 is the cable routing lattice.
 * - Device centres sit on the 20 mm lattice; device sizes are rounded to
 *   20 mm so every face lands on the 10 mm half-lattice and every terminal's
 *   launch cell is either 10 or 20 mm beyond its face.
 * - In-plane terminal offsets are multiples of the routing cell, so a straight
 *   launch always lands on a lattice cell.
 */
export const ROUTE_CELL_M = 0.020;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const magnitude = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const length = magnitude(a);
  return length < 1e-12 ? [0, 0, 0] : scale(a, 1 / length);
};

export const directionByFace: Record<Face, Vec3> = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
};

export const snapCell = (value: number) => geometryMetres(Math.round(value / ROUTE_CELL_M + 1e-9) * 2);
export const ceilCellM = (value: number) => geometryMetres(Math.ceil(value / ROUTE_CELL_M - 1e-9) * 2);
export const snapCellVec = (value: Vec3): Vec3 => [snapCell(value[0]), snapCell(value[1]), snapCell(value[2])];
const snapHalf = (value: number) => geometryMetres(geometryUnits(value));

export const endpointDeviceId = (endpoint: string) => endpoint.slice(0, endpoint.lastIndexOf("."));
export const endpointConductorId = (endpoint: string) => endpoint.slice(endpoint.lastIndexOf(".") + 1);

export function rotateVector(vector: Vec3, rotation: Vec3): Vec3 {
  const [rx, ry, rz] = rotation;
  const cosX = Math.cos(rx); const sinX = Math.sin(rx);
  const cosY = Math.cos(ry); const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz); const sinZ = Math.sin(rz);
  // THREE.Euler "XYZ": a local point is acted on by Z, then Y, then X.
  const afterZ: Vec3 = [
    vector[0] * cosZ - vector[1] * sinZ,
    vector[0] * sinZ + vector[1] * cosZ,
    vector[2],
  ];
  const afterY: Vec3 = [
    afterZ[0] * cosY + afterZ[2] * sinY,
    afterZ[1],
    -afterZ[0] * sinY + afterZ[2] * cosY,
  ];
  const rotated: Vec3 = [
    afterY[0],
    afterY[1] * cosX - afterY[2] * sinX,
    afterY[1] * sinX + afterY[2] * cosX,
  ];
  return rotated.map((value) => Math.abs(value) < 1e-12 ? 0 : value) as unknown as Vec3;
}

export function worldPoint(device: ResolvedDevice, local: Vec3): Vec3 {
  return add(device.position, rotateVector(local, device.rotation));
}

export function deviceLocalPoint(device: ResolvedDevice, point: Vec3): Vec3 {
  const delta = subtract(point, device.position);
  return [
    dot(delta, rotateVector([1, 0, 0], device.rotation)),
    dot(delta, rotateVector([0, 1, 0], device.rotation)),
    dot(delta, rotateVector([0, 0, 1], device.rotation)),
  ];
}

export function worldHalfExtents(device: ResolvedDevice): Vec3 {
  const x = rotateVector([device.size[0] / 2, 0, 0], device.rotation);
  const y = rotateVector([0, device.size[1] / 2, 0], device.rotation);
  const z = rotateVector([0, 0, device.size[2] / 2], device.rotation);
  return [
    Math.abs(x[0]) + Math.abs(y[0]) + Math.abs(z[0]),
    Math.abs(x[1]) + Math.abs(y[1]) + Math.abs(z[1]),
    Math.abs(x[2]) + Math.abs(y[2]) + Math.abs(z[2]),
  ];
}

function rotationForDevice(device: Device): Vec3 {
  if (device.placement.space !== "world") return [0, 0, 0];
  if (device.placement.rotation) return device.placement.rotation;
  if (device.placement.surface === "ceiling") return [Math.PI / 2, 0, 0];
  if (device.placement.surface === "outside-wall") return [0, Math.PI, 0];
  return [0, 0, 0];
}

/** Euler XYZ orientation whose local +X axis exactly follows direction. */
function rotationForXAxis(direction: Vec3): Vec3 {
  const [x, y, z] = normalize(direction);
  const rz = Math.asin(Math.max(-1, Math.min(1, y)));
  const ry = Math.atan2(-z, x);
  return [0, ry, rz];
}

export const isBodyless = (device: Pick<Device, "presentation">) => (
  device.presentation === "cable-breakout"
  || device.presentation === "wire-join"
  || device.presentation === "service-splice"
);

/** Busbars and earth bars carry stud/screw landings on their front face. A
 * cable meets such a post laterally (any in-plane direction), never from the
 * front. Everything else launches straight out of its declared face. */
export const hasLateralPosts = (device: Pick<Device, "kind" | "presentation" | "conductors">) => (
  (device.kind === "busbar" || device.kind === "earth") && device.presentation !== "rigid-rail"
  && device.conductors.some((port) => port.face === "front")
);
/** A stud/screw on the front face of a distribution bar. */
export const isLateralPost = (device: Pick<Device, "kind" | "presentation" | "conductors">, face: Face) => (
  hasLateralPosts(device) && face === "front"
);

/** Terminals that carry a bodyless splice chain. Two such terminals on one
 * face need a double pitch so their 40 mm Y envelopes and stubs clear each
 * other. Set once per graph by resolveDevices. */
let attachedTerminalKeys: ReadonlySet<string> = new Set();

function facePitch(device: Device, face: Face) {
  const declared = device.terminalPitchByFaceM?.[face];
  if (declared !== undefined) {
    const units = geometryUnits(declared);
    if (units % 2 !== 0) throw new Error(`${device.id}: ${face} terminal pitch must be a multiple of 20 mm`);
    return declared;
  }
  const attachedOnFace = device.conductors.filter((port) => port.face === face && attachedTerminalKeys.has(`${device.id}.${port.id}`)).length;
  return attachedOnFace >= 2 ? ROUTE_CELL_M * 2 : ROUTE_CELL_M;
}

export function orderedFacePorts(device: Device, face: Face) {
  return device.conductors
    .filter((candidate) => candidate.face === face)
    .toSorted((first, second) => (first.order ?? 0) - (second.order ?? 0) || first.id.localeCompare(second.id));
}

/** Lattice-aligned even spacing: offsets are integer multiples of the pitch
 * so every in-plane terminal coordinate stays on the routing lattice. */
const symmetricRow = (count: number, pitch: number) => (
  count % 2 === 1 || Math.abs((pitch / 2) / ROUTE_CELL_M - Math.round((pitch / 2) / ROUTE_CELL_M)) < 1e-9
);
const latticeOffset = (index: number, count: number, pitch: number) => {
  if (count <= 1) return 0;
  // Symmetric centring keeps lattice alignment when the row is odd or the
  // pitch is a whole number of double cells; otherwise anchor the row so every
  // terminal still lands on a cell (the row is offset by half a pitch).
  return symmetricRow(count, pitch)
    ? geometryMetres(Math.round((index - (count - 1) / 2) * pitch / 0.01))
    : (index - Math.floor((count - 1) / 2)) * pitch;
};
/** Body extent needed to cover a terminal row on both sides of the centre. */
const rowSpan = (count: number, pitch: number) => (
  count <= 1 ? 0 : symmetricRow(count, pitch) ? (count - 1) * pitch : 2 * Math.ceil((count - 1) / 2) * pitch
);

/** Front/back faces arrange terminals in one row along X when the body is
 * long enough (distribution bars, penetration plates), otherwise in a compact
 * grid. */
function frontFaceGrid(count: number, pitch: number, width: number) {
  const columns = (count - 1) * pitch <= width + 1e-9 ? count : Math.ceil(Math.sqrt(count));
  return { columns, rows: Math.ceil(count / columns) };
}

/** Declared sizes rounded to the 20 mm routing cell; DIN devices are exactly
 * 20 mm per pole; bodies grow to fit their terminal rows. */
function resolvedBodySize(device: Device): Vec3 {
  const units = device.size.map((value) => Math.max(2, Math.round(value / ROUTE_CELL_M) * 2)) as [number, number, number];
  if ((device.kind === "breaker" || device.kind === "protection") && device.poles) units[0] = device.poles * 2;
  const span = (face: Face) => {
    const count = device.conductors.filter((port) => port.face === face).length;
    return geometryUnits(rowSpan(count, facePitch(device, face)));
  };
  units[0] = Math.max(units[0], span("top"), span("bottom"));
  units[1] = Math.max(units[1], span("left"), span("right"));
  for (const face of ["front", "back"] as const) {
    const count = device.conductors.filter((port) => port.face === face).length;
    if (count === 0) continue;
    const pitch = facePitch(device, face);
    const { columns, rows } = frontFaceGrid(count, pitch, geometryMetres(units[0]));
    units[0] = Math.max(units[0], geometryUnits(rowSpan(columns, pitch)) + 2);
    units[1] = Math.max(units[1], geometryUnits(rowSpan(rows, pitch)) + 2);
  }
  // Keep every axis an even 10 mm count so half-extents land on the 10 mm lattice.
  return units.map((value) => geometryMetres(value % 2 === 0 ? value : value + 1)) as unknown as Vec3;
}

export function terminalLocalPosition(device: Device & { size: Vec3 }, conductorId: string): Vec3 {
  const conductor = device.conductors.find((candidate) => candidate.id === conductorId);
  if (!conductor) throw new Error(`Unknown conductor ${device.id}.${conductorId}`);
  const peers = orderedFacePorts(device, conductor.face);
  const index = peers.findIndex((candidate) => candidate.id === conductorId);
  const count = peers.length;
  const [width, height, depth] = device.size;
  const pitch = facePitch(device, conductor.face);
  const offset=device.centeredTerminals?(index-(count-1)/2)*pitch:latticeOffset(index,count,pitch);
  switch (conductor.face) {
    case "top": return [offset, height / 2, 0];
    case "bottom": return [offset, -height / 2, 0];
    case "left": return [-width / 2, -offset, 0];
    case "right": return [width / 2, -offset, 0];
    case "front":
    case "back": {
      const { columns, rows } = frontFaceGrid(count, pitch, width);
      const column = index % columns;
      const row = Math.floor(index / columns);
      return [
        latticeOffset(column, columns, pitch),
        -latticeOffset(row, rows, pitch),
        conductor.face === "front" ? depth / 2 : -depth / 2,
      ];
    }
  }
}

export function terminalPosition(device: ResolvedDevice, conductorId: string): Vec3 {
  const generated = device.resolvedConductorPositions?.[conductorId];
  if (generated) return generated;
  return worldPoint(device, terminalLocalPosition(device, conductorId));
}

/** Connections leaving/entering an enclosure, grouped by the physical cable
 * that crosses its wall. Only a genuine multicore sheath shares a gland. */
export function crossingBundles(graph: SystemGraph, junctionDeviceId: string) {
  const inside = new Set(graph.devices
    .filter((device) => device.placement.space === "junction" && device.placement.junctionId === junctionDeviceId)
    .map((device) => device.id));
  const cableById = new Map(graph.cables.map((cable) => [cable.id, cable]));
  const bundles = new Map<string, string[]>();
  graph.connections.forEach((connection) => {
    const fromInside = inside.has(endpointDeviceId(connection.from));
    const toInside = inside.has(endpointDeviceId(connection.to));
    if (fromInside === toInside) return;
    const cable = cableById.get(connection.cableId);
    const bundleId = cable && cable.cores > 1 && connection.bundleId ? connection.bundleId : connection.id;
    bundles.set(bundleId, [...(bundles.get(bundleId) ?? []), connection.id]);
  });
  return bundles;
}

// ---------------------------------------------------------------------------
// Validation (structural rules that make the rest of the pipeline total)
// ---------------------------------------------------------------------------

export function validateGraph(graph: SystemGraph) {
  const problems: string[] = [];
  const unique = (values: readonly string[], label: string) => {
    const seen = new Set<string>();
    values.forEach((value) => {
      if (seen.has(value)) problems.push(`Duplicate ${label}: ${value}`);
      seen.add(value);
    });
  };
  unique(graph.devices.map((device) => device.id), "device");
  unique(graph.cables.map((cable) => cable.id), "cable");
  unique(graph.connections.map((connection) => connection.id), "connection");
  const conductorByEndpoint = new Map<string, Conductor>(graph.devices.flatMap((device) => (
    device.conductors.map((candidate) => [`${device.id}.${candidate.id}`, candidate] as const)
  )));
  const cableIds = new Set(graph.cables.map((cable) => cable.id));
  const useCount = new Map<string, number>();
  graph.connections.forEach((connection) => {
    if (!conductorByEndpoint.has(connection.from)) problems.push(`${connection.id}: missing source ${connection.from}`);
    if (!conductorByEndpoint.has(connection.to)) problems.push(`${connection.id}: missing target ${connection.to}`);
    if (!cableIds.has(connection.cableId)) problems.push(`${connection.id}: missing cable ${connection.cableId}`);
    [connection.from, connection.to].forEach((endpoint) => useCount.set(endpoint, (useCount.get(endpoint) ?? 0) + 1));
  });
  [...useCount].filter(([, count]) => count > 1).forEach(([endpoint, count]) => {
    const conductor = conductorByEndpoint.get(endpoint);
    if (count > (conductor?.routingCapacity ?? Number.POSITIVE_INFINITY)) {
      problems.push(`${endpoint}: routing capacity ${conductor?.routingCapacity ?? 1} is below ${count} field wires`);
    }
    if (["warning", "approved-stack"].includes(conductor?.sharedConnectionPolicy ?? "expand")) return;
    problems.push(`${endpoint}: one physical conductor has ${count} external wires; add an explicit wire join`);
  });
  graph.devices.forEach((device) => {
    if ((device.kind === "breaker" || device.kind === "protection") && device.poles
      && Math.abs(device.size[0] - device.poles * 0.020) > 1e-9) {
      problems.push(`${device.id}: breaker/protection width must be exactly 20 mm per way`);
    }
    const placement = device.placement;
    if (placement.space === "junction" && !graph.junctions.some((junction) => junction.deviceId === placement.junctionId)) {
      problems.push(`${device.id}: unknown junction ${placement.junctionId}`);
    }
    const groups = Map.groupBy(device.conductors.filter((port) => port.routingGroup), (port) => port.routingGroup!);
    device.conductors.forEach((port) => {
      if (port.routingCapacity === undefined) return;
      if (!port.routingGroup) problems.push(`${device.id}.${port.id}: routing capacity requires a routing group`);
      if (!Number.isSafeInteger(port.routingCapacity) || port.routingCapacity < 1) {
        problems.push(`${device.id}.${port.id}: routing capacity must be a positive integer`);
      }
      if (port.routingCapacity > 1 && !["warning", "approved-stack"].includes(port.sharedConnectionPolicy ?? "expand")) {
        problems.push(`${device.id}.${port.id}: routing capacity above one requires warning or approved-stack policy`);
      }
    });
    groups.forEach((members, group) => {
      if (members.length < 2) problems.push(`${device.id}.${group}: routing group must contain at least two terminals`);
      if (new Set(members.map((port) => port.kind)).size > 1) problems.push(`${device.id}.${group}: routing group crosses conductor kinds`);
      if (new Set(members.map((port) => port.terminalSize ?? "")).size > 1) {
        problems.push(`${device.id}.${group}: routing group crosses physical terminal sizes`);
      }
    });
    if (device.presentation === "wire-join") {
      if (!device.attachment || !conductorByEndpoint.has(device.attachment.endpoint)) problems.push(`${device.id}: invalid wire-join attachment`);
      if (device.conductors.map((port) => port.id).join(",") !== "device,through,branch") {
        problems.push(`${device.id}: wire join must expose device, through and branch arms`);
      }
      const landingKind = device.attachment ? conductorByEndpoint.get(device.attachment.endpoint)?.kind : undefined;
      if (landingKind && device.conductors.some((port) => port.kind !== landingKind)) {
        problems.push(`${device.id}: every splice arm must match attached ${landingKind} conductor kind`);
      }
    }
    if (device.presentation === "rigid-rail" || device.railTargets) {
      problems.push(`${device.id}: rigid-rail devices are not supported by the physical layout engine`);
    }
    const strict = ["wire-join", "cable-breakout", "integrated-cable-breakout", "wall-passthrough"].includes(device.presentation ?? "")
      || (device.conductors.length > 1 && device.conductors.every((port) => (port.internalMates?.length ?? 0) > 0));
    if (strict) {
      device.conductors.forEach((port) => (port.internalMates ?? []).forEach((mateId) => {
        const mate = device.conductors.find((candidate) => candidate.id === mateId);
        if (!mate) problems.push(`${device.id}.${port.id}: missing internal mate ${mateId}`);
        else if (!(mate.internalMates ?? []).includes(port.id)) problems.push(`${device.id}.${port.id}: internal mate ${mateId} is not reciprocal`);
      }));
    }
  });
  graph.junctions.forEach((junction) => {
    if (!graph.devices.some((device) => device.id === junction.deviceId && device.kind === "junction")) {
      problems.push(`${junction.id}: missing junction device ${junction.deviceId}`);
    }
    if (junction.padding <= 0 || junction.dinGap < 0 || junction.backplateGap < 0 || junction.glandSpacing <= 0) {
      problems.push(`${junction.id}: enclosure clearances must be explicit non-negative dimensions`);
    }
  });
  if (problems.length > 0) throw new Error(`Invalid system graph:\n${problems.join("\n")}`);
}

// ---------------------------------------------------------------------------
// Device resolution
// ---------------------------------------------------------------------------

type SizedDevice = Device & { size: Vec3 };
type Section = "din" | "power" | "backplate";

const sectionOf = (device: Device): Section => {
  if (device.placement.space !== "junction") return "backplate";
  return device.placement.section === "din" ? "din" : device.placement.section === "power" ? "power" : "backplate";
};
const orderOf = (device: Device) => device.placement.space === "junction" ? device.placement.order : 0;
const bySectionOrder = (a: Device, b: Device) => orderOf(a) - orderOf(b) || a.id.localeCompare(b.id);

type EnclosurePlan = {
  size: Vec3;
  /** World bottom edge of the shell. */
  bottomY: number;
  /** Member centres relative to the shell's left interior edge and bottom edge. */
  members: Map<string, { dx: number; dy: number }>;
};

/**
 * Compact enclosure packing on exact lattice rows.
 *
 * From the bottom: the gland door row (cables enter here), one lane row for
 * lateral moves, then equipment bands. A band's launch row is the row directly
 * outside each connected face, so a band sits one cell above whatever it must
 * clear. DIN devices tile with their declared gap; every other neighbour pair
 * is separated by the declared gap or the launch cells of facing terminal
 * faces, whichever is larger. Auto-sized shells grow to fit (40 mm quantum so
 * the centre stays on the routing lattice); verified-fixed shells try the
 * compact variant where bottom launches share the door row and otherwise
 * fail loudly.
 */
function planEnclosure(
  graph: SystemGraph,
  junction: Junction,
  container: SizedDevice,
  members: readonly SizedDevice[],
  connected: ReadonlySet<string>,
  extraReach: ReadonlyMap<string, Record<Face, number>>,
  limits: { maxWidth: number; maxHeight: number },
): EnclosurePlan {
  const cell = ROUTE_CELL_M;
  // A photographed installation can declare member centres and orientation.
  // Keep these positions authoritative while checking shell and gland space;
  // ordinary, unmeasured enclosures still use the automatic band packer below.
  if (members.some(device => device.placement.space === "junction" && device.placement.offset)) {
    const half = [junction.minimumSize[0] / 2, junction.minimumSize[1] / 2];
    for (const device of members) {
      if (device.placement.space !== "junction" || !device.placement.offset) throw new Error(`${junction.id}: every installed backplate member needs an offset`);
      const [x, y] = device.placement.offset;
      const extent = worldHalfExtents({ ...device, position: [0, 0, 0], rotation: [0, 0, device.placement.rotationZ ?? 0] });
      half[0] = Math.max(half[0], Math.abs(x) + extent[0] + junction.padding + cell);
      half[1] = Math.max(half[1], Math.abs(y) + extent[1] + junction.padding + cell);
    }
    half[0] = Math.max(half[0], crossingBundles(graph, junction.deviceId).size * junction.glandSpacing / 2 + junction.padding);
    const size: Vec3 = [ceilCellM(half[0]) * 2, ceilCellM(half[1]) * 2, container.size[2]];
    if (size[0] > limits.maxWidth || size[1] > limits.maxHeight) throw new Error(`${junction.id}: installed backplate exceeds free wall space`);
    if (junction.sizePolicy === "verified-fixed" && size.some((value, axis) => value > container.size[axis] + 1e-9)) throw new Error(`${junction.id}: installed backplate does not fit the verified shell`);
    return {
      size,
      bottomY: container.placement.space === "world" ? snapCell(container.placement.position[1] - size[1] / 2) : 0,
      members: new Map(members.map(device => {
        const [x, y] = device.placement.space === "junction" ? device.placement.offset! : [0, 0];
        return [device.id, { dx: size[0] / 2 + x, dy: size[1] / 2 + y }];
      })),
    };
  }
  const din = members.filter((device) => sectionOf(device) === "din").toSorted(bySectionOrder);
  const power = members.filter((device) => sectionOf(device) === "power").toSorted(bySectionOrder);
  const backplate = members.filter((device) => sectionOf(device) === "backplate").toSorted(bySectionOrder);
  const padding = junction.padding;
  const fixed = junction.sizePolicy === "verified-fixed";
  const dinAtBottom = junction.dinPosition === "bottom";
  // A connected face needs its launch cell (up to one cell beyond the face)
  // plus half a cell of body clearance beyond that cell.
  // Distribution bars are met from the rows just above and below them.
  const facesOf = (device: SizedDevice, face: Face): Face[] => (
    hasLateralPosts(device) && (face === "top" || face === "bottom") ? [face, "front"] : [face]
  );
  const reach = (device: SizedDevice, face: Face) => Math.max(
    device.conductors.some((port) => facesOf(device, face).includes(port.face) && connected.has(`${device.id}.${port.id}`)) ? cell * 1.5 : 0,
    extraReach.get(device.id)?.[face] ?? 0,
    device.installationClearanceM?.[face] ?? 0,
  );
  // Facing terminal rows need their two launch rows plus one shared lane row.
  const channel = (below: number, above: number) => (
    below > 0 && above > 0 ? below + above + cell : below + above > 0 ? below + above + cell / 2 : cell
  );
  const horizontalGap = (a: SizedDevice, b: SizedDevice) => {
    const contiguous = (junction.contiguousDin && sectionOf(a) === "din" && sectionOf(b) === "din") || (a.layoutGroup?.contiguous && a.layoutGroup.id === b.layoutGroup?.id);
    const declared = contiguous ? 0 : sectionOf(a) === "din" && sectionOf(b) === "din" ? junction.dinGap : junction.backplateGap;
    const facing = reach(a, "right") + reach(b, "left");
    return Math.max(declared, facing > 0 ? channel(reach(a, "right"), reach(b, "left")) : 0);
  };
  const rowWidth = (row: readonly SizedDevice[]) => {
    if (row.length === 0) return 0;
    return reach(row[0], "left") + reach(row.at(-1)!, "right")
      + row.reduce((sum, device, index) => sum + device.size[0] + (index > 0 ? horizontalGap(row[index - 1], device) : 0), 0);
  };
  const rowReach = (row: readonly SizedDevice[], face: "top" | "bottom") => Math.max(0, ...row.map((device) => reach(device, face)));

  const glandCount = crossingBundles(graph, junction.deviceId).size;
  const glandRowWidth = glandCount > 0 ? Math.ceil(glandCount / (junction.glandFaces === "top-and-bottom" ? 2 : 1)) * junction.glandSpacing : 0;
  const lowRow = dinAtBottom ? [...din, ...power] : power;
  const dinRow = dinAtBottom ? [] : din;
  // Auto-sized shells keep a two-cell vertical wiring channel on each side of
  // the equipment so cables from upper rows can always drop to the glands.
  const sideChannel = fixed ? 0 : cell * 2;
  // The shell must hold its widest single row; beyond that it prefers one
  // equipment row over wrapping only while it stays within the free wall
  // space beside it (and one and a half times its declared minimum width).
  const requiredWidth = Math.max(
    junction.minimumSize[0],
    glandRowWidth + padding * 2,
    rowWidth(lowRow) + padding * 2 + sideChannel * 2,
    rowWidth(dinRow) + padding * 2 + sideChannel * 2,
    ...backplate.map((device) => rowWidth([device]) + padding * 2 + sideChannel * 2),
  );
  const singleRowWidth = rowWidth(backplate) + padding * 2 + sideChannel * 2;
  const widthCeiling = Math.min(limits.maxWidth, junction.minimumSize[0] * 1.5);
  let width = fixed ? container.size[0] : Math.max(requiredWidth, !junction.backplateColumns && singleRowWidth <= widthCeiling ? singleRowWidth : 0);
  width = fixed ? width : geometryMetres(Math.ceil(width / 0.040 - 1e-9) * 4);
  if (!fixed && width > limits.maxWidth + 1e-9) {
    throw new Error(`${junction.id}: ${container.id} needs ${width.toFixed(2)} m of width but only ${limits.maxWidth.toFixed(2)} m is free beside it; move it or its neighbours`);
  }
  const usable = width - padding * 2 - sideChannel * 2;
  const rows: SizedDevice[][] = [];
  if (lowRow.length > 0) rows.push([...lowRow]);
  let current: SizedDevice[] = [];
  backplate.forEach((device) => {
    if (current.length > 0 && (current.length >= (junction.backplateColumns ?? Infinity) || rowWidth([...current, device]) > usable + 1e-9)) {
      rows.push(current);
      current = [];
    }
    current.push(device);
  });
  if (current.length > 0) rows.push(current);
  if (dinRow.length > 0) rows.push([...dinRow]);
  rows.forEach((row) => {
    if (rowWidth(row) > usable + 1e-9) throw new Error(`${junction.id}: ${container.id} is too narrow for ${row.map((device) => device.id).join(", ")}`);
  });

  // Vertical placement in lattice rows measured from the shell bottom edge.
  const bottomAuthored = container.placement.space === "world"
    ? snapCell(container.placement.position[1] - container.size[1] / 2)
    : 0;
  const place = (compact: boolean) => {
    const members = new Map<string, { dx: number; dy: number }>();
    const interiorBottom = padding;
    const doorRow = Math.ceil((interiorBottom - 1e-9) / cell) * cell;
    // Door row, then one lane row for lateral moves; the first band's launch
    // row sits above that lane.
    let floor = compact ? doorRow : doorRow + cell * 2;
    let topLaunch = floor;
    rows.forEach((row, rowIndex) => {
      const below = rowIndex > 0 ? rows[rowIndex - 1] : undefined;
      const bottomReach = rowReach(row, "bottom");
      if (!below) floor = Math.max(floor, padding + Math.max(0, ...row.map(d=>d.installationClearanceM?.bottom ?? 0)));
      if (below) {
        const declared = Math.max(junction.backplateGap, cell);
        floor = Math.max(floor, floor - cell / 2 + Math.max(declared, channel(rowReach(below, "top"), bottomReach)));
      }
      // The band's bottom face sits half a cell above the row that must stay
      // free below it (its own launch row when it has bottom terminals).
      const faceY = floor + cell / 2;
      const rowSpan = rowWidth(row);
      const centered = rowIndex === 0 || row.every((device) => sectionOf(device) === "din");
      let cursor = padding + sideChannel + (centered ? (usable - rowSpan) / 2 : 0) + reach(row[0], "left");
      // Align the first terminal column, then preserve the contiguous module pitch.
      // Centring the body alone puts symmetric two-pole terminals half a cell off-grid.
      const terminalOffsetX=(device:SizedDevice)=>{
        const port=device.conductors.find(p=>p.face==="top"||p.face==="bottom");
        return port?terminalLocalPosition(device,port.id)[0]:0;
      };
      if(junction.contiguousDin && row.every(d=>sectionOf(d)==="din")){
        const terminalX=cursor+row[0].size[0]/2+terminalOffsetX(row[0]);
        cursor+=snapCell(terminalX)-terminalX;
      }
      let rowTop = faceY;
      row.forEach((device, index) => {
        if (index > 0) cursor += horizontalGap(row[index - 1], device);
        let dx = junction.contiguousDin && sectionOf(device) === "din" ? snapHalf(cursor + device.size[0] / 2) : geometryMetres(Math.ceil((cursor + device.size[0] / 2) / cell - 1e-9) * 2);
        if(junction.contiguousDin && device.centeredTerminals && sectionOf(device)!=="din"){
          const offset=terminalOffsetX(device);
          dx=Math.ceil((cursor+device.size[0]/2+offset)/cell-1e-9)*cell-offset;
        }
        const rowHeight=junction.contiguousDin && sectionOf(device)==="din" ? Math.max(...row.map(d=>d.size[1])) : device.size[1];
        const dy = geometryMetres(Math.ceil((faceY + rowHeight / 2) / cell - 1e-9) * 2);
        members.set(device.id, { dx, dy });
        rowTop = Math.max(rowTop, dy + device.size[1] / 2);
        cursor = dx + device.size[0] / 2;
      });
      floor = rowTop + cell / 2;
      topLaunch = Math.max(topLaunch, rowTop + Math.max(rowReach(row, "top") > 0 ? cell : 0, ...row.map(d=>d.installationClearanceM?.top ?? 0), ...row.map(device => extraReach.get(device.id)?.top ?? 0)));
    });
    return { members, height: topLaunch + cell / 2 + padding };
  };
  if (fixed) {
    const [width0, height0, depth0] = container.size;
    const attempts = [place(false), place(true)];
    const fit = attempts.find((attempt) => attempt.height <= height0 + 1e-9);
    if (!fit) {
      throw new Error(`${junction.id}: verified-fixed enclosure ${container.id} (${height0} m tall) cannot hold its contents (${attempts[1].height.toFixed(3)} m needed)`);
    }
    return { size: [width0, height0, depth0], bottomY: snapCell(bottomAuthored), members: fit.members };
  }
  const placed = place(false);
  const height = geometryMetres(Math.ceil(Math.max(junction.minimumSize[1], placed.height) / 0.040 - 1e-9) * 4);
  if (height > limits.maxHeight + 1e-9) {
    throw new Error(`${junction.id}: ${container.id} needs ${height.toFixed(2)} m of height but only ${limits.maxHeight.toFixed(2)} m is free above it; move it or its neighbours`);
  }
  const depth = geometryMetres(Math.ceil(Math.max(junction.minimumSize[2], container.size[2]) / 0.040 - 1e-9) * 4);
  return { size: [width, height, depth], bottomY: bottomAuthored, members: placed.members };
}

/** Resolve every device to world position, size and rotation. */
export function resolveDevices(graph: SystemGraph): ResolvedDevice[] {
  attachedTerminalKeys = new Set(graph.devices.flatMap((device) => device.attachment ? [device.attachment.endpoint] : []));
  const fixedJunctionIds = new Set(graph.junctions.filter((junction) => junction.sizePolicy === "verified-fixed").map((junction) => junction.deviceId));
  const sized: SizedDevice[] = graph.devices.map((device) => ({
    ...device,
    conductors: device.conductors.map((conductor) => ({
      ...conductor,
      label: graphEndpointDisplayLabel(graph, `${device.id}.${conductor.id}`),
    })),
    size: fixedJunctionIds.has(device.id) ? device.size : resolvedBodySize(device),
  }));
  const sizedById = new Map(sized.map((device) => [device.id, device]));
  const connected = new Set(graph.connections.flatMap((connection) => [connection.from, connection.to]));
  const resolved = new Map<string, ResolvedDevice>();

  // 0. Attachment chains (bodyless joins) extend a face's clearance: along the
  //    terminal axis by the chain length, and sideways by the branch arms.
  const attachedTo = new Map<string, SizedDevice[]>();
  sized.filter((device) => device.attachment).forEach((device) => {
    const endpoint = device.attachment!.endpoint;
    attachedTo.set(endpoint, [...(attachedTo.get(endpoint) ?? []), device]);
  });
  const chainAxial = (endpoint: string, visited = new Set<string>()): number => {
    if (visited.has(endpoint)) throw new Error(`Attachment cycle at ${endpoint}`);
    const joins = attachedTo.get(endpoint) ?? [];
    if (joins.length === 0) return 0;
    const next = new Set(visited).add(endpoint);
    return Math.max(...joins.map((join) => ROUTE_CELL_M + join.size[0] + chainAxial(`${join.id}.through`, next)));
  };
  const chainLateral = (endpoint: string, visited = new Set<string>()): number => {
    if (visited.has(endpoint)) return 0;
    const joins = attachedTo.get(endpoint) ?? [];
    if (joins.length === 0) return 0;
    const next = new Set(visited).add(endpoint);
    return Math.max(...joins.map((join) => Math.max(join.size[1] / 2 + ROUTE_CELL_M * 1.5, chainLateral(`${join.id}.through`, next))));
  };
  const extraReach = new Map<string, Record<Face, number>>();
  sized.filter((device) => !device.attachment).forEach((device) => {
    const reach: Record<Face, number> = { top: 0, bottom: 0, left: 0, right: 0, front: 0, back: 0 };
    device.conductors.forEach((conductor) => {
      const endpoint = `${device.id}.${conductor.id}`;
      const axial = chainAxial(endpoint);
      if (axial <= 0) return;
      // Neighbouring terminal joins can occupy successive outward layers.
      // Reserve their stack before sizing the enclosure, not just the first Y.
      const siblings = device.conductors.filter(port => port.face === conductor.face && attachedTo.has(`${device.id}.${port.id}`));
      const stackPitch = Math.max(0, ...siblings.flatMap(port => attachedTo.get(`${device.id}.${port.id}`) ?? []).map(join => join.size[0] + ROUTE_CELL_M * 2));
      reach[conductor.face] = Math.max(reach[conductor.face], axial + ROUTE_CELL_M * 1.5 + Math.max(0, siblings.length - 1) * stackPitch);
      const lateral = chainLateral(endpoint);
      const local = terminalLocalPosition(device, conductor.id);
      if (conductor.face === "top" || conductor.face === "bottom") {
        reach.left = Math.max(reach.left, lateral - (local[0] + device.size[0] / 2));
        reach.right = Math.max(reach.right, lateral - (device.size[0] / 2 - local[0]));
      } else if (conductor.face === "left" || conductor.face === "right") {
        reach.bottom = Math.max(reach.bottom, lateral - (local[1] + device.size[1] / 2));
        reach.top = Math.max(reach.top, lateral - (device.size[1] / 2 - local[1]));
      }
    });
    extraReach.set(device.id, reach);
  });

  // 1. Enclosure plans (size, bottom edge, member offsets). An auto-sized
  //    shell may only grow into wall space that no other authored equipment
  //    occupies: sideways from its centre, upward from its bottom edge.
  const worldBodies = sized.filter((device) => (
    device.placement.space === "world" && !device.attachment && !isBodyless(device) && device.presentation !== "wall-passthrough"
  ));
  const growthLimits = (container: SizedDevice) => {
    if (container.placement.space !== "world") return { maxWidth: Infinity, maxHeight: Infinity };
    const rotation = rotationForDevice(container);
    const xAxis = rotateVector([1, 0, 0], rotation);
    const cx = dot(container.placement.position, xAxis);
    const cy = container.placement.position[1];
    const surface = container.placement.surface;
    const wallId = container.placement.wallId;
    const [w, h] = container.size;
    const bottom = cy - h / 2;
    let maxHalfWidth = Infinity;
    let maxTop = Infinity;
    worldBodies.forEach((other) => {
      if (other.id === container.id || other.placement.space !== "world") return;
      if (other.placement.surface !== surface || other.placement.wallId !== wallId) return;
      const ox = dot(other.placement.position, xAxis);
      const oy = other.placement.position[1];
      const [ow, oh] = other.size;
      const overlapsY = oy + oh / 2 > bottom + 1e-9 && oy - oh / 2 < cy + h / 2 + 1e-9;
      const overlapsX = ox + ow / 2 > cx - w / 2 - 1e-9 && ox - ow / 2 < cx + w / 2 + 1e-9;
      if (overlapsY) {
        if (ox > cx) maxHalfWidth = Math.min(maxHalfWidth, ox - ow / 2 - cx - ROUTE_CELL_M);
        else maxHalfWidth = Math.min(maxHalfWidth, cx - (ox + ow / 2) - ROUTE_CELL_M);
      }
      if (overlapsX && oy - oh / 2 > bottom) maxTop = Math.min(maxTop, oy - oh / 2 - ROUTE_CELL_M);
    });
    return { maxWidth: maxHalfWidth * 2, maxHeight: maxTop - bottom };
  };
  const plans = new Map<string, EnclosurePlan>();
  graph.junctions.forEach((junction) => {
    const container = sizedById.get(junction.deviceId)!;
    const members = sized.filter((device) => (
      !device.attachment && device.placement.space === "junction" && device.placement.junctionId === junction.deviceId
    ));
    const plan = planEnclosure(graph, junction, container, members, connected, extraReach, growthLimits(container));
    plans.set(junction.deviceId, plan);
    container.size = plan.size;
  });

  // 2. World devices (including enclosures) on the routing lattice. Auto-sized
  //    enclosures keep their authored bottom edge so growth never sinks into
  //    floor equipment.
  sized.filter((device) => device.placement.space === "world" && !device.attachment).forEach((device) => {
    if (device.placement.space !== "world") return;
    const plan = plans.get(device.id);
    const position: Vec3 = plan
      ? [snapCell(device.placement.position[0]), snapCell(plan.bottomY + plan.size[1] / 2), snapCell(device.placement.position[2])]
      : snapCellVec(device.placement.position);
    const rotation=rotationForDevice(device);
    const floor=graph.site?.floor;
    const groundedPosition:Vec3=floor && device.placement.surface==="floor"
      ? [position[0],floor.center[1]+floor.size[1]/2+worldHalfExtents({...device,position,rotation})[1],position[2]]
      : position;
    resolved.set(device.id, { ...device, position:groundedPosition, size: device.size, rotation });
  });

  // 3. Enclosure members from their plan offsets.
  graph.junctions.forEach((junction) => {
    const container = resolved.get(junction.deviceId);
    if (!container) throw new Error(`Junction ${junction.id} has no world device ${junction.deviceId}`);
    const plan = plans.get(junction.deviceId)!;
    const left = -container.size[0] / 2;
    const bottom = -container.size[1] / 2;
    const shellBack = -container.size[2] / 2;
    plan.members.forEach(({ dx, dy }, id) => {
      const device = sizedById.get(id)!;
      let z = snapCell(shellBack + ROUTE_CELL_M + device.size[2] / 2);
      if (z - device.size[2] / 2 < shellBack + 0.010 - 1e-9) z += ROUTE_CELL_M;
      if (z + device.size[2] / 2 > container.size[2] / 2 + 1e-9) z -= ROUTE_CELL_M;
      if (z - device.size[2] / 2 < shellBack + 0.010 - 1e-9) throw new Error(`${id}: no lattice mounting depth fits ${container.id}`);
      const position = (junction.contiguousDin && device.placement.space === "junction" && (device.placement.section === "din" || device.centeredTerminals) ? (p:Vec3)=>p.map(snapHalf) as unknown as Vec3 : snapCellVec)(worldPoint(container, [left + dx, bottom + dy, z]));
      const angle = device.placement.space === "junction" ? device.placement.rotationZ ?? 0 : 0;
      resolved.set(id, { ...device, position, size: device.size, rotation: [container.rotation[0], container.rotation[1], container.rotation[2] + angle] });
    });
  });

  // 4. Bodyless attachments (wire joins) hang one cell beyond their landing
  //    and stack outward when siblings on one face would overlap.
  const attachmentsByEndpoint = new Map<string, SizedDevice[]>();
  sized.filter((device) => device.attachment).forEach((device) => {
    const endpoint = device.attachment!.endpoint;
    attachmentsByEndpoint.set(endpoint, [...(attachmentsByEndpoint.get(endpoint) ?? []), device]);
  });
  const axialOffset = new Map<string, number>();
  const faceGroups = new Map<string, Array<{ device: SizedDevice; interval: readonly [number, number]; order: number }>>();
  sized.filter((device) => device.attachment).forEach((device) => {
    const endpoint = device.attachment!.endpoint;
    const owner = sizedById.get(endpointDeviceId(endpoint));
    const landing = owner?.conductors.find((candidate) => candidate.id === endpointConductorId(endpoint));
    if (!owner || !landing || owner.attachment) return;
    const local = terminalLocalPosition(owner, landing.id);
    const transverse = landing.face === "left" || landing.face === "right" ? local[1] : local[0];
    const half = device.size[1] / 2;
    const key = `${owner.id}:${landing.face}`;
    faceGroups.set(key, [...(faceGroups.get(key) ?? []), {
      device, interval: [transverse - half, transverse + half], order: landing.order ?? owner.conductors.indexOf(landing),
    }]);
  });
  faceGroups.forEach((members) => {
    const layers: Array<Array<readonly [number, number]>> = [];
    members.toSorted((a, b) => a.order - b.order || a.device.id.localeCompare(b.device.id)).forEach(({ device, interval }) => {
      // Siblings share a layer only with a clear cell between their envelopes.
      let layer = layers.findIndex((occupied) => occupied.every((other) => (
        interval[1] + ROUTE_CELL_M <= other[0] + 1e-9 || interval[0] - ROUTE_CELL_M >= other[1] - 1e-9
      )));
      if (layer < 0) { layer = layers.length; layers.push([]); }
      layers[layer].push(interval);
      axialOffset.set(device.id, layer * (device.size[0] + ROUTE_CELL_M * 2));
    });
  });
  const joinConnectionsByEndpoint = new Map<string, typeof graph.connections[number][]>();
  graph.connections.forEach((connection) => {
    [connection.from, connection.to].forEach((endpoint) => {
      joinConnectionsByEndpoint.set(endpoint, [...(joinConnectionsByEndpoint.get(endpoint) ?? []), connection]);
    });
  });
  const attachmentRootEndpoint = (initial: string) => {
    let endpoint = initial;
    const visited = new Set<string>();
    while (!visited.has(endpoint)) {
      visited.add(endpoint);
      const device = sizedById.get(endpointDeviceId(endpoint));
      if (!device?.attachment) return endpoint;
      endpoint = device.attachment.endpoint;
    }
    throw new Error(`Attachment cycle at ${initial}`);
  };
  const pending = sized.filter((device) => device.attachment);
  let guard = pending.length + 1;
  while (pending.length > 0 && guard-- > 0) {
    const device = pending.shift()!;
    const target = device.attachment!.endpoint;
    const owner = resolved.get(endpointDeviceId(target));
    if (!owner) { pending.push(device); continue; }
    const conductorId = endpointConductorId(target);
    const targetDefinition = owner.conductors.find((candidate) => candidate.id === conductorId);
    if (!targetDefinition) throw new Error(`${device.id}: attachment terminal ${target} does not exist`);
    const targetPosition = terminalPosition(owner, conductorId);
    const targetDirection = owner.resolvedConductorDirections?.[conductorId]
      ?? rotateVector(directionByFace[targetDefinition.face], owner.rotation);
    const size = device.size;
    const centerDistance = size[0] / 2 + ROUTE_CELL_M + (axialOffset.get(device.id) ?? 0);
    const raw = add(targetPosition, scale(targetDirection, centerDistance));
    const axisAligned = targetDirection.filter((value) => Math.abs(value) > 1e-9).length === 1;
    const position = axisAligned ? snapCellVec(raw) : raw;
    const rotation = rotationForXAxis(targetDirection);
    let conductors = device.conductors;
    let resolvedConductorPositions: Record<string, Vec3> | undefined;
    let resolvedConductorDirections: Record<string, Vec3> | undefined;
    // A downward landing whose two destinations lie on opposite sides becomes
    // an upside-down Y: stem above, one arm left, one arm right.
    if (device.presentation === "wire-join" && axisAligned && targetDirection[1] < -1 + 1e-8) {
      const lateral = rotateVector([0, 1, 0], rotation);
      const targets = (["through", "branch"] as const).flatMap((armId) => {
        const endpoint = `${device.id}.${armId}`;
        const connections = joinConnectionsByEndpoint.get(endpoint) ?? [];
        if (connections.length !== 1) return [];
        const peer = connections[0].from === endpoint ? connections[0].to : connections[0].from;
        const root = attachmentRootEndpoint(peer);
        const rootOwner = resolved.get(endpointDeviceId(root)) ?? sizedById.get(endpointDeviceId(root));
        if (!rootOwner || !("position" in rootOwner)) return [];
        const destination = terminalPosition(rootOwner as ResolvedDevice, endpointConductorId(root));
        return [{ armId, projection: dot(subtract(destination, position), lateral) }];
      });
      const opposite = targets.length === 2 && targets.some((t) => t.projection < -1e-8) && targets.some((t) => t.projection > 1e-8);
      if (opposite) {
        resolvedConductorPositions = Object.fromEntries(targets.map(({ armId, projection }) => [
          armId,
          add(add(position, scale(targetDirection, size[0] / 2)), scale(lateral, Math.sign(projection) * size[1] / 2)),
        ]));
        resolvedConductorDirections = Object.fromEntries(targets.map(({ armId, projection }) => [armId, scale(lateral, Math.sign(projection))]));
        const sideById = new Map(targets.map(({ armId, projection }) => [armId, Math.sign(projection)] as const));
        conductors = device.conductors.map((conductor) => {
          const side = sideById.get(conductor.id as "through" | "branch");
          return side === undefined ? conductor : { ...conductor, face: side > 0 ? "top" as const : "bottom" as const };
        });
      }
    }
    resolved.set(device.id, {
      ...device, conductors, position, size, rotation,
      ...(resolvedConductorPositions ? { resolvedConductorPositions } : {}),
      ...(resolvedConductorDirections ? { resolvedConductorDirections } : {}),
    });
  }
  graph.devices.forEach((device) => {
    if (!resolved.has(device.id)) throw new Error(`Could not resolve ${device.id}`);
  });
  return graph.devices.map((device) => resolved.get(device.id)!);
}

export function resolveConductors(devices: readonly ResolvedDevice[]): ResolvedConductor[] {
  return devices.flatMap((device) => device.conductors.map((candidate): ResolvedConductor => ({
    ...candidate,
    key: `${device.id}.${candidate.id}`,
    deviceId: device.id,
    position: terminalPosition(device, candidate.id),
    direction: device.resolvedConductorDirections?.[candidate.id]
      ?? rotateVector(directionByFace[candidate.face], device.rotation),
  })));
}

/** Preferred routing depth inside an enclosure: one cell in front of the
 * backplate mounting plane. */
export function enclosureRoutingPlaneZ(container: ResolvedDevice) {
  return snapCell(container.position[2] - container.size[2] / 2 + ROUTE_CELL_M * 2);
}

/**
 * Evenly spaced declared gland rows per enclosure. Gland order is the
 * assignment that minimises the summed horizontal offset between each slot
 * and the bundle's internal terminal and external destination.
 */
export function resolveGlands(graph: SystemGraph, devices: readonly ResolvedDevice[]): Gland[] {
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const connectionById = new Map(graph.connections.map((connection) => [connection.id, connection]));
  const conductorPoints = new Map<string, Vec3>(devices.flatMap((device) => device.conductors.map((candidate) => (
    [`${device.id}.${candidate.id}`, terminalPosition(device, candidate.id)] as const
  ))));
  const attachmentRoot = (device: ResolvedDevice) => {
    let current = device;
    const visited = new Set<string>();
    while (current.attachment && !visited.has(current.id)) {
      visited.add(current.id);
      current = deviceById.get(endpointDeviceId(current.attachment.endpoint)) ?? current;
    }
    return current;
  };
  return graph.junctions.flatMap((junction) => {
    const container = deviceById.get(junction.deviceId)!;
    const inside = new Set(devices
      .filter((device) => device.placement.space === "junction" && device.placement.junctionId === junction.deviceId)
      .map((device) => device.id));
    const records = [...crossingBundles(graph, junction.deviceId).entries()].map(([bundleId, connectionIds]) => {
      const insideXs: number[] = [];
      const outsideXs: number[] = [];
      const labels = new Set<string>();
      let bottomFace = false;
      let topFace = false;
      connectionIds.forEach((id) => {
        const connection = connectionById.get(id)!;
        [connection.from, connection.to].forEach((endpoint) => {
          const device = deviceById.get(endpointDeviceId(endpoint));
          if (!device) return;
          if (inside.has(device.id)) {
            insideXs.push(deviceLocalPoint(container, conductorPoints.get(endpoint)!)[0]);
            const face = device.conductors.find((port) => port.id === endpointConductorId(endpoint))?.face;
            if (face === "bottom") bottomFace = true;
            if (face === "top") topFace = true;
          } else {
            outsideXs.push(deviceLocalPoint(container, attachmentRoot(device).position)[0]);
            graphEndpointOwnerLabels(graph, endpoint, new Set([connection.id])).forEach((label) => labels.add(label));
          }
        });
      });
      const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      return {
        bundleId, connectionIds, bottomFace,
        face: junction.glandFaces === "top-and-bottom" && topFace && !bottomFace ? "top" as const : "bottom" as const,
        insideX: mean(insideXs), outsideX: mean(outsideXs),
        label: labels.size > 0 ? [...labels].toSorted().join(" / ")
          : connectionIds.map((id) => graphConnectionDisplayLabel(graph, connectionById.get(id)!)).join(" / "),
      };
    });
    return (["bottom", "top"] as const).flatMap(face => {
    const rowRecords = records.filter(record => record.face === face);
    const spacing = junction.glandSpacing;
    const span = Math.max(0, (rowRecords.length - 1) * spacing);
    const firstSlot = snapCell(-span / 2);
    const slotX = (index: number) => geometryMetres(Math.round((firstSlot + index * spacing) / 0.01));
    const order = rowRecords.toSorted((a, b) => (a.insideX + a.outsideX) - (b.insideX + b.outsideX) || a.bundleId.localeCompare(b.bundleId));
    // A bottom-face terminal owns the slot directly beneath it (its cable drops
    // straight in); every other bundle prefers its inside terminal's x, then
    // its external destination's x.
    const cost = (record: typeof records[number], index: number) => (
      Math.abs(slotX(index) - record.insideX) * (record.bottomFace ? 8 : 2) + Math.abs(slotX(index) - record.outsideX)
    );
    let improved = true;
    let guard = order.length * order.length;
    while (improved && guard-- > 0) {
      improved = false;
      for (let first = 0; first < order.length; first += 1) {
        for (let second = first + 1; second < order.length; second += 1) {
          const before = cost(order[first], first) + cost(order[second], second);
          const after = cost(order[second], first) + cost(order[first], second);
          if (after + 1e-9 < before) {
            [order[first], order[second]] = [order[second], order[first]];
            improved = true;
          }
        }
      }
    }
    const z = snapCell(-container.size[2] / 2 + ROUTE_CELL_M * 2);
    return order.map(({ bundleId, connectionIds, label }, index): Gland => ({
      id: `${junction.id}-${face}-gland-${index + 1}`,
      label,
      junctionId: junction.deviceId,
      bundleId,
      position: worldPoint(container, [slotX(index), snapHalf((face === "top" ? 1 : -1) * container.size[1] / 2), z]),
      connectionIds,
      face,
    }));
    });
  });
}

export function resolveSystemGeometry(graph: SystemGraph) {
  validateGraph(graph);
  const devices = resolveDevices(graph);
  const conductors = resolveConductors(devices);
  const glands = resolveGlands(graph, devices);
  return { devices, conductors, glands };
}
