import {
  EQUIPMENT_WALL_VOLUME,
  GEOMETRY_UNIT_M,
  JUNCTION_ROUTING_STEP_UNITS,
  WORLD_ROUTING_STEP_UNITS,
  graphConnectionDisplayLabel,
  graphEndpointDisplayLabel,
  graphEndpointOwnerLabels,
  currentSourcesFromDevices,
  geometryMetres,
  geometryUnits,
  snapGeometry,
  snapGeometryVec,
} from "./systemGraph";
import {
  MAX_SEMANTIC_SECTION_M,
  renderedSemanticCables,
  roundedRoutePieces,
  sampleCableCurve,
} from "./renderedCableGeometry";
import type {
  CurrentSafetyChannel,
  CurrentSafetyConnectionCheck,
  CurrentSafetyDeviceCheck,
  CurrentSafetyIssue,
  CurrentSafetyReport,
  Device,
  Face,
  Gland,
  GraphRuntime,
  ResolvedConductor,
  ResolvedDevice,
  RoutedConnection,
  SystemGraph,
  Vec3,
} from "./systemGraph";

type GridPoint = readonly [number, number, number];
type DeviceObstacleMap = Map<string, Set<string>>;
type BlockedVoxels = { columns: DeviceObstacleMap; cells: DeviceObstacleMap };
type EndpointFaceAccess = {
  position: Vec3;
  direction: Vec3;
  clearance: number;
};
type EndpointAccessMap = ReadonlyMap<string, readonly EndpointFaceAccess[]>;
type WorldRoutingRegion = "inside" | "outside";
type RoutingSpace = {
  /** Metre convenience value; always cellUnits × the canonical lattice. */
  cell: number;
  cellUnits: number;
  key: string;
  min: Vec3;
  max: Vec3;
  minUnits: GridPoint;
  maxUnits: GridPoint;
  occupied: Map<string, string>;
  /** Future terminal escape stubs. Lower-priority/thinner owners may not displace thicker routes. */
  reserved: Map<string, Set<string>>;
  /** Fixed physical apertures such as gland throats; these remain unavailable at every priority. */
  fixedReserved: Map<string, Set<string>>;
  ownerDiameterMm: Map<string, number>;
  blockedByRadius: Map<string, BlockedVoxels>;
  /** Shell-to-routing clearance already removed from min/max. */
  edgeInset: number;
  /** Present only for the two independently solved world-side regions. */
  worldRegion?: WorldRoutingRegion;
};

export const routingFailureDiagnostics: Array<{ owner: string; space: string; expansions: number; reason: string }> = [];
export const renderedGeometryFailureDiagnostics: string[] = [];

const directionByFace: Record<Face, Vec3> = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
};

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const gridKey = (point: GridPoint) => `${point[0]},${point[1]},${point[2]}`;
const emptyBlockedVoxels = (): BlockedVoxels => ({ columns: new Map(), cells: new Map() });
const addDeviceObstacle = (map: DeviceObstacleMap, key: string, deviceId: string) => {
  const owners = map.get(key) ?? new Set<string>();
  owners.add(deviceId);
  map.set(key, owners);
};
const blockingDeviceIds = (blocked: BlockedVoxels, point: GridPoint) => new Set([
  ...(blocked.columns.get(`${point[0]},${point[1]}`) ?? []),
  ...(blocked.cells.get(gridKey(point)) ?? []),
]);
const isBlockedByDevice = (
  blocked: BlockedVoxels,
  point: GridPoint,
  space: RoutingSpace,
  endpointAccess: EndpointAccessMap = new Map(),
) => {
  const world = fromGrid(point, space);
  return [...blockingDeviceIds(blocked, point)].some((deviceId) => {
    const accesses = endpointAccess.get(deviceId) ?? [];
    return !accesses.some((access) => dot([
      world[0] - access.position[0],
      world[1] - access.position[1],
      world[2] - access.position[2],
    ], access.direction) + 1e-9 >= access.clearance);
  });
};
const blockedDeviceLabels = (
  blocked: BlockedVoxels,
  point: GridPoint,
  space: RoutingSpace,
  endpointAccess: EndpointAccessMap,
) => [...blockingDeviceIds(blocked, point)].filter((deviceId) => {
  const singleton = new Map([[deviceId, endpointAccess.get(deviceId) ?? []]]);
  return isBlockedByDevice({ columns: new Map([[`${point[0]},${point[1]}`, new Set([deviceId])]]), cells: new Map() }, point, space, singleton);
});
const endpointDeviceId = (endpoint: string) => endpoint.slice(0, endpoint.lastIndexOf("."));
const isWorldRoutingSpace = (space: RoutingSpace) => space.worldRegion !== undefined;
const deviceWorldRegion = (device: Device): WorldRoutingRegion => (
  device.placement.space === "world"
    && (device.placement.surface === "outside" || device.placement.surface === "outside-wall")
    ? "outside"
    : "inside"
);
const conductorWorldRegion = (device: ResolvedDevice, conductor: ResolvedConductor): WorldRoutingRegion => {
  if (device.presentation === "wall-passthrough") {
    return conductor.face === "back" ? "outside" : "inside";
  }
  return deviceWorldRegion(device);
};
const deviceBelongsToRoutingSpace = (device: ResolvedDevice, space: RoutingSpace) => {
  if (!isWorldRoutingSpace(space)) {
    return device.placement.space === "junction" && device.placement.junctionId === space.key;
  }
  if (device.placement.space !== "world") return false;
  return device.presentation === "wall-passthrough" || deviceWorldRegion(device) === space.worldRegion;
};
const isAxisAlignedVector = (value: Vec3) => value.filter((component) => Math.abs(component) > 1e-9).length === 1;
const vectorUnits = (point: Vec3): GridPoint => point.map(geometryUnits) as unknown as GridPoint;
const vectorMetres = (point: GridPoint): Vec3 => point.map(geometryMetres) as unknown as Vec3;
const isBodylessPresentation = (device: Device) => (
  device.presentation === "cable-breakout"
  || device.presentation === "wire-join"
  || device.presentation === "service-splice"
);
const ROUTING_STEP_UNITS = WORLD_ROUTING_STEP_UNITS;
const BODY_SIZE_QUANTUM_UNITS = ROUTING_STEP_UNITS * 2;
const snapRoutingScalar = (value: number) => geometryMetres(
  Math.round(geometryUnits(value) / ROUTING_STEP_UNITS) * ROUTING_STEP_UNITS,
);
const ceilRoutingScalar = (value: number) => geometryMetres(
  Math.ceil((geometryUnits(value) - 1e-9) / ROUTING_STEP_UNITS) * ROUTING_STEP_UNITS,
);
const snapRoutingVec = (value: Vec3): Vec3 => value.map(snapRoutingScalar) as unknown as Vec3;
const terminalPitchUnits = (device: Device, face: Face) => {
  const declared = device.terminalPitchByFaceM?.[face];
  if (declared !== undefined) {
    const units = geometryUnits(declared);
    if (units % ROUTING_STEP_UNITS !== 0) {
      throw new Error(`${device.id}: ${face} terminal pitch must use the global 20 mm route cell`);
    }
    return units;
  }
  return face === "front" || face === "back" || device.presentation === "cable-breakout"
    ? ROUTING_STEP_UNITS * 2
    : ROUTING_STEP_UNITS;
};

function resolvedBodySize(device: Device): Vec3 {
  const roundBodyAxis = (value: number) => {
    const units = geometryUnits(value);
    return Math.max(BODY_SIZE_QUANTUM_UNITS, Math.round(units / BODY_SIZE_QUANTUM_UNITS) * BODY_SIZE_QUANTUM_UNITS);
  };
  const units = device.size.map(roundBodyAxis) as [number, number, number];
  // A pole is one exact 20 mm model way on the canonical grid. Adjacent DIN
  // devices therefore tile without fractional widths or visual slivers.
  if ((device.kind === "breaker" || device.kind === "protection") && device.poles) {
    units[0] = device.poles * ROUTING_STEP_UNITS;
  }
  const requiredSpan = (count: number, pitchUnits = ROUTING_STEP_UNITS) => count <= 1 ? 0 : (count - 1) * pitchUnits;
  const faceCount = (face: Face) => device.conductors.filter((port) => port.face === face).length;
  // A real distribution bar may be longer than its populated terminal row.
  // Preserve that authored envelope while still growing a too-small body until
  // every landing has a half-pitch end margin.
  if (device.kind === "busbar" && device.presentation !== "rigid-rail") {
    const topPitch = terminalPitchUnits(device, "top");
    const bottomPitch = terminalPitchUnits(device, "bottom");
    units[0] = Math.max(
      units[0], BODY_SIZE_QUANTUM_UNITS,
      faceCount("top") * topPitch,
      faceCount("bottom") * bottomPitch,
    );
  }
  units[0] = Math.max(
    units[0],
    requiredSpan(faceCount("top"), terminalPitchUnits(device, "top")),
    requiredSpan(faceCount("bottom"), terminalPitchUnits(device, "bottom")),
  );
  units[1] = Math.max(
    units[1],
    requiredSpan(faceCount("left"), terminalPitchUnits(device, "left")),
    requiredSpan(faceCount("right"), terminalPitchUnits(device, "right")),
  );
  for (const face of ["front", "back"] as const) {
    const count = faceCount(face);
    if (count === 0) continue;
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    // Front/back face arrays fan out on a two-cell pitch. They remain on the
    // same 20 mm route lattice while leaving an empty routing column between
    // adjacent protected terminal launches.
    const facePitchUnits = terminalPitchUnits(device, face);
    units[0] = Math.max(units[0], requiredSpan(columns, facePitchUnits));
    units[1] = Math.max(units[1], requiredSpan(rows, facePitchUnits));
  }
  // Every face-bearing dimension is a multiple of 40 mm, so its half extent
  // is itself a 20 mm route cell. Pole width is the sole safe exception: these
  // components expose only top/bottom terminals and therefore never use ±X.
  [0, 1, 2].forEach((axis) => {
    if (axis === 0 && (device.kind === "breaker" || device.kind === "protection") && device.poles) return;
    units[axis] = Math.max(
      BODY_SIZE_QUANTUM_UNITS,
      Math.ceil(units[axis] / BODY_SIZE_QUANTUM_UNITS) * BODY_SIZE_QUANTUM_UNITS,
    );
  });
  return vectorMetres(units);
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
  const length = Math.hypot(...direction);
  if (length < 1e-12) throw new Error("Cannot orient an attachment along a zero vector");
  const [x, y, z] = direction.map((value) => value / length);
  const rz = Math.asin(Math.max(-1, Math.min(1, y)));
  const ry = Math.atan2(-z, x);
  return [0, ry, rz];
}

function rotateVector(vector: Vec3, rotation: Vec3): Vec3 {
  const [rx, ry, rz] = rotation;
  const cosX = Math.cos(rx); const sinX = Math.sin(rx);
  const cosY = Math.cos(ry); const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz); const sinZ = Math.sin(rz);
  // THREE.Euler's default "XYZ" convention composes the matrix as Rx·Ry·Rz
  // for column vectors, so a local point is acted on by Z, then Y, then X.
  // Keeping this helper bit-for-bit equivalent is essential: the router uses
  // it for terminals/OBBs while Three.js uses the Euler on the rendered body.
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
  // Exact axis components matter at terminal tangencies. In particular a 180°
  // battery rotation otherwise leaves ~1e-16 components that turn a straight
  // post lead into a visibly sheared diagonal in downstream geometry.
  return rotated.map((value) => Math.abs(value) < 1e-12 ? 0 : value) as unknown as Vec3;
}

function worldPoint(device: ResolvedDevice, local: Vec3): Vec3 {
  return add(device.position, rotateVector(local, device.rotation));
}

function worldHalfExtents(device: ResolvedDevice): Vec3 {
  const [halfX, halfY, halfZ] = device.size.map((value) => value / 2) as unknown as Vec3;
  const xAxis = rotateVector([halfX, 0, 0], device.rotation);
  const yAxis = rotateVector([0, halfY, 0], device.rotation);
  const zAxis = rotateVector([0, 0, halfZ], device.rotation);
  return [
    Math.abs(xAxis[0]) + Math.abs(yAxis[0]) + Math.abs(zAxis[0]),
    Math.abs(xAxis[1]) + Math.abs(yAxis[1]) + Math.abs(zAxis[1]),
    Math.abs(xAxis[2]) + Math.abs(yAxis[2]) + Math.abs(zAxis[2]),
  ];
}

function deviceLocalPoint(device: ResolvedDevice, point: Vec3): Vec3 {
  const delta: Vec3 = [
    point[0] - device.position[0],
    point[1] - device.position[1],
    point[2] - device.position[2],
  ];
  const xAxis = rotateVector([1, 0, 0], device.rotation);
  const yAxis = rotateVector([0, 1, 0], device.rotation);
  const zAxis = rotateVector([0, 0, 1], device.rotation);
  return [dot(delta, xAxis), dot(delta, yAxis), dot(delta, zAxis)];
}

function blocksRoutingColumn(device: ResolvedDevice, devices: readonly ResolvedDevice[]) {
  if (device.presentation === "wall-passthrough") return false;
  if (device.placement.space === "world") {
    return ["wall", "outside-wall"].includes(device.placement.surface);
  }
  // Enclosure routing is genuinely three-dimensional. The shell already
  // removes the unusable volume behind the backplate, while exact body voxels
  // prevent a cable from passing through mounted equipment. Projecting every
  // internal device through the full enclosure depth would make verified
  // cover/intermediate mounting planes impossible to route.
  void devices;
  return false;
}

function orderedFacePorts(device: ResolvedDevice, face: Face) {
  return device.conductors
    .filter((candidate) => candidate.face === face)
    .toSorted((first, second) => (first.order ?? 0) - (second.order ?? 0));
}

function terminalLocalPosition(device: ResolvedDevice, conductorId: string): Vec3 {
  const conductor = device.conductors.find((candidate) => candidate.id === conductorId);
  if (!conductor) throw new Error(`Unknown conductor ${device.id}.${conductorId}`);
  const peers = orderedFacePorts(device, conductor.face);
  const index = peers.findIndex((candidate) => candidate.id === conductorId);
  const count = peers.length;
  const [width, height, depth] = vectorUnits(device.size);
  const stepUnits = device.placement.space === "junction"
    ? JUNCTION_ROUTING_STEP_UNITS
    : WORLD_ROUTING_STEP_UNITS;
  const evenlySpaced = (_lengthUnits: number, itemIndex: number, itemCount: number, pitchUnits = stepUnits) => {
    if (itemCount <= 1) return 0;
    // Every 20 mm pitch and half-pitch is an integer 10 mm enclosure cell, so
    // even enclosure groups remain physically centred. In the 20 mm field
    // space an even group stays on that coarser route lattice.
    return pitchUnits === stepUnits
      ? (itemIndex - Math.floor((itemCount - 1) / 2)) * pitchUnits
      : Math.round((itemIndex - (itemCount - 1) / 2) * pitchUnits);
  };
  const facePitchUnits = terminalPitchUnits(device, conductor.face);

  switch (conductor.face) {
    case "top": return vectorMetres([evenlySpaced(width, index, count, facePitchUnits), height / 2, 0]);
    case "bottom": return vectorMetres([evenlySpaced(width, index, count, facePitchUnits), -height / 2, 0]);
    case "left": return vectorMetres([-width / 2, -evenlySpaced(height, index, count, facePitchUnits), 0]);
    case "right": return vectorMetres([width / 2, -evenlySpaced(height, index, count, facePitchUnits), 0]);
    case "front": {
      const columns = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / columns);
      const column = index % columns;
      const row = Math.floor(index / columns);
      return vectorMetres([
        evenlySpaced(width, column, columns, facePitchUnits),
        -evenlySpaced(height, row, rows, facePitchUnits),
        depth / 2,
      ]);
    }
    case "back": {
      const columns = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / columns);
      const column = index % columns;
      const row = Math.floor(index / columns);
      return vectorMetres([
        evenlySpaced(width, column, columns, facePitchUnits),
        -evenlySpaced(height, row, rows, facePitchUnits),
        -depth / 2,
      ]);
    }
  }
}

function terminalPosition(device: ResolvedDevice, conductorId: string): Vec3 {
  const generated = device.resolvedConductorPositions?.[conductorId];
  if (generated) return generated;
  return worldPoint(device, terminalLocalPosition(device, conductorId));
}

function crossingBundles(graph: SystemGraph, junctionDeviceId: string) {
  const inside = new Set(graph.devices
    .filter((device) => device.placement.space === "junction" && device.placement.junctionId === junctionDeviceId)
    .map((device) => device.id));
  const bundles = new Map<string, string[]>();
  const cableById = new Map(graph.cables.map((cable) => [cable.id, cable]));
  graph.connections.forEach((connection) => {
    const fromInside = inside.has(endpointDeviceId(connection.from));
    const toInside = inside.has(endpointDeviceId(connection.to));
    if (fromInside === toInside) return;
    // A circuit label is not permission to squeeze two independent single-core
    // conductors through the same gland. Only a genuinely multicore cable may
    // share a physical gland/trunk.
    const cable = cableById.get(connection.cableId);
    const bundleId = cable && cable.cores > 1 && connection.bundleId
      ? connection.bundleId
      : connection.id;
    const existing = bundles.get(bundleId) ?? [];
    existing.push(connection.id);
    bundles.set(bundleId, existing);
  });
  return bundles;
}

function resolveDevices(graph: SystemGraph) {
  const verifiedFixedJunctionIds = new Set(graph.junctions
    .filter((junction) => junction.sizePolicy === "verified-fixed")
    .map((junction) => junction.deviceId));
  const layoutDevices = graph.devices.map((device): Device => ({
    ...device,
    conductors: device.conductors.map((conductor) => ({
      ...conductor,
      label: graphEndpointDisplayLabel(graph, `${device.id}.${conductor.id}`),
    })),
    // Verified enclosure shells are already real external measurements. Their
    // 20 mm-grid dimensions must not be rounded to the generic 40 mm body
    // quantum used for routable equipment bodies.
    size: verifiedFixedJunctionIds.has(device.id) ? device.size : resolvedBodySize(device),
  }));
  const sizeById = new Map(layoutDevices.map((device) => [device.id, device.size]));
  const connectedEndpoints = new Set(graph.connections.flatMap((connection) => [connection.from, connection.to]));
  const attachmentsByEndpoint = new Map<string, Device[]>();
  layoutDevices.filter((device) => device.attachment).forEach((device) => {
    const endpoint = device.attachment!.endpoint;
    attachmentsByEndpoint.set(endpoint, [...(attachmentsByEndpoint.get(endpoint) ?? []), device]);
  });
  const attachmentAxialOffsetById = new Map<string, number>();
  const attachmentFaceGroups = new Map<string, Array<{
    device: Device;
    interval: readonly [number, number];
    order: number;
  }>>();
  layoutDevices.filter((device) => device.attachment).forEach((device) => {
    const endpoint = device.attachment!.endpoint;
    const separator = endpoint.lastIndexOf(".");
    const owner = layoutDevices.find((candidate) => candidate.id === endpoint.slice(0, separator));
    const conductorId = endpoint.slice(separator + 1);
    const landing = owner?.conductors.find((candidate) => candidate.id === conductorId);
    if (!owner || !landing) return;
    const localOwner: ResolvedDevice = { ...owner, position: [0, 0, 0], rotation: [0, 0, 0] };
    const local = terminalLocalPosition(localOwner, conductorId);
    // Project the bodyless Y envelope onto the primary transverse face axis.
    // Greedy interval colouring lets disjoint joins share the nearest layer;
    // only physically overlapping envelopes move farther out from the owner.
    const transverse = landing.face === "left" || landing.face === "right" ? local[1] : local[0];
    const transverseHalf = device.size[1] / 2;
    const key = `${owner.id}:${landing.face}`;
    attachmentFaceGroups.set(key, [
      ...(attachmentFaceGroups.get(key) ?? []),
      {
        device,
        interval: [transverse - transverseHalf, transverse + transverseHalf],
        order: landing.order ?? owner.conductors.indexOf(landing),
      },
    ]);
  });
  attachmentFaceGroups.forEach((members) => {
    const layers: Array<Array<readonly [number, number]>> = [];
    members.toSorted((first, second) => first.order - second.order || first.device.id.localeCompare(second.device.id))
      .forEach(({ device, interval }) => {
        let layer = layers.findIndex((occupied) => occupied.every((other) => (
          interval[1] <= other[0] + 1e-9 || interval[0] >= other[1] - 1e-9
        )));
        if (layer < 0) {
          layer = layers.length;
          layers.push([]);
        }
        layers[layer].push(interval);
        attachmentAxialOffsetById.set(
          device.id,
          // A farther sibling begins only after the nearer Y body, its full
          // two-cell protected through launch, and one empty route cell.
          layer * (device.size[0] + geometryMetres(ROUTING_STEP_UNITS * 3)),
        );
      });
  });
  type AttachmentClearance = { left: number; right: number; top: number; bottom: number };
  const attachmentClearanceByDevice = new Map<string, AttachmentClearance>();
  const attachmentChainReach = (endpoint: string, visited = new Set<string>()): number => {
    if (visited.has(endpoint)) throw new Error(`Attachment cycle at ${endpoint}`);
    const attached = attachmentsByEndpoint.get(endpoint) ?? [];
    if (attached.length === 0) return 0;
    const nextVisited = new Set(visited).add(endpoint);
    return Math.max(...attached.map((join) => (
      geometryMetres(ROUTING_STEP_UNITS) + join.size[0]
      + (attachmentAxialOffsetById.get(join.id) ?? 0)
      + attachmentChainReach(`${join.id}.through`, nextVisited)
    )));
  };
  layoutDevices.filter((device) => !device.attachment).forEach((device) => {
    const clearance: AttachmentClearance = { left: 0, right: 0, top: 0, bottom: 0 };
    device.conductors.forEach((conductor) => {
      const reach = attachmentChainReach(`${device.id}.${conductor.id}`);
      if (reach <= 0 || !["left", "right", "top", "bottom"].includes(conductor.face)) return;
      clearance[conductor.face as keyof AttachmentClearance] = Math.max(
        clearance[conductor.face as keyof AttachmentClearance],
        reach,
      );
    });
    attachmentClearanceByDevice.set(device.id, clearance);
  });
  const attachmentClearance = (device: Device) => attachmentClearanceByDevice.get(device.id)
    ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const faceLaunchReach = (device: Device, face: Face) => {
    const connectedOnFace = device.conductors.filter((port) => (
      port.face === face && connectedEndpoints.has(`${device.id}.${port.id}`)
    ));
    if (connectedOnFace.length === 0) return 0;
    // Every connected terminal owns one ingress cell beyond its mandatory
    // tangent. Front/back faces need two tangent cells before that ingress;
    // side/top/bottom faces need one. Earlier serial routes therefore cannot
    // cage a future A* endpoint.
    const cells = face === "front" || face === "back" ? 3 : 2;
    return geometryMetres(ROUTING_STEP_UNITS * cells);
  };
  const routingReach = (device: Device, face: keyof AttachmentClearance) => Math.max(
    faceLaunchReach(device, face),
    attachmentClearance(device)[face] > 0
      ? attachmentClearance(device)[face] + geometryMetres(ROUTING_STEP_UNITS * 2)
      : 0,
  );
  const rowGap = (first: Device, second: Device, base: number) => {
    const facingReach = routingReach(first, "right") + routingReach(second, "left");
    // Include one empty route cell between the complete protected terminal
    // launches. This same face-derived rule applies to ordinary terminals and
    // attached joins; no owner/device IDs participate in the spacing rule.
    return Math.max(
      base,
      facingReach > 0 ? facingReach + geometryMetres(ROUTING_STEP_UNITS) : 0,
    );
  };
  const rowSpan = (devices: readonly Device[], baseGap: number) => {
    if (devices.length === 0) return 0;
    return routingReach(devices[0], "left")
      + devices.reduce((sum, device) => sum + device.size[0], 0)
      + devices.slice(1).reduce((sum, device, index) => sum + rowGap(devices[index], device, baseGap), 0)
      + routingReach(devices.at(-1)!, "right");
  };
  const rowSpanWithGaps = (
    devices: readonly Device[],
    gap: (first: Device, second: Device) => number,
  ) => {
    if (devices.length === 0) return 0;
    return routingReach(devices[0], "left")
      + devices.reduce((sum, device) => sum + device.size[0], 0)
      + devices.slice(1).reduce((sum, device, index) => sum + gap(devices[index], device), 0)
      + routingReach(devices.at(-1)!, "right");
  };
  const verticalGap = (upper: readonly Device[], lower: readonly Device[], base: number) => {
    if (upper.length === 0 || lower.length === 0) return 0;
    const facingReach = Math.max(0, ...upper.map((device) => routingReach(device, "bottom")))
      + Math.max(0, ...lower.map((device) => routingReach(device, "top")));
    return Math.max(base, facingReach > 0 ? facingReach + geometryMetres(ROUTING_STEP_UNITS) : 0);
  };
  const flowRows = (devices: readonly Device[], width: number, padding: number, baseGap: number) => {
    const rows: Device[][] = [];
    let current: Device[] = [];
    devices.forEach((device) => {
      const candidate = [...current, device];
      if (current.length > 0 && rowSpan(candidate, baseGap) > width - padding * 2 + 1e-9) {
        rows.push(current);
        current = [device];
      } else {
        current.push(device);
      }
    });
    if (current.length > 0) rows.push(current);
    return rows;
  };
  const rowsHeight = (rows: readonly (readonly Device[])[], baseGap: number) => rows.reduce((sum, row, index) => (
    sum
      + Math.max(0, ...row.map((device) => device.size[1]))
      + (index < rows.length - 1 ? verticalGap(row, rows[index + 1], baseGap) : 0)
  ), 0);

  graph.junctions.forEach((junction) => {
    const effectivePadding = junction.padding;
    const members = layoutDevices.filter((device) => (
      !device.attachment && !device.railTargets
      &&
      device.placement.space === "junction" && device.placement.junctionId === junction.deviceId
    ));
    const din = members.filter((device) => device.placement.space === "junction" && device.placement.section === "din")
      .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
    const power = members
      .filter((device) => device.placement.space === "junction" && device.placement.section === "power")
      .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
    const backplate = members
      .filter((device) => device.placement.space === "junction" && device.placement.section !== "din" && device.placement.section !== "power")
      .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
    const effectiveDinGap = junction.dinGap;
    const effectiveBackplateGap = junction.backplateGap;
    const dinWidth = rowSpan(din, effectiveDinGap);
    const crossingCount = crossingBundles(graph, junction.deviceId).size;
    const effectiveGlandSpacing = junction.glandSpacing;
    const glandWidth = crossingCount > 0
      ? (crossingCount - 1) * effectiveGlandSpacing + effectivePadding * 2 + 0.020
      : 0;
    const powerGap = effectiveBackplateGap;
    const powerWidth = rowSpan(power, powerGap);
    const lowRow = junction.dinPosition === "bottom" ? [...din, ...power] : [];
    const lowGap = (first: Device, second: Device) => {
      const firstIsDin = first.placement.space === "junction" && first.placement.section === "din";
      const secondIsDin = second.placement.space === "junction" && second.placement.section === "din";
      return rowGap(first, second, firstIsDin && secondIsDin ? effectiveDinGap : effectiveBackplateGap);
    };
    const lowWidth = rowSpanWithGaps(lowRow, lowGap);
    const widestBackplate = Math.max(0, ...backplate.map((device) => rowSpan([device], effectiveBackplateGap)));
    let width = Math.max(
      junction.minimumSize[0], dinWidth + effectivePadding * 2, glandWidth,
      powerWidth + effectivePadding * 2, lowWidth + effectivePadding * 2,
      widestBackplate + effectivePadding * 2,
    );

    // A deterministic flow layout replaces hand-tuned positions. Widen once if
    // that materially reduces backplate rows, then let enclosure height grow.
    const requiredArea = backplate.reduce((sum, device) => (
      sum + (device.size[0] + effectiveBackplateGap) * (device.size[1] + effectiveBackplateGap)
    ), 0);
    const usefulWidth = Math.max(0.05, width - effectivePadding * 2);
    if (requiredArea / usefulWidth > junction.minimumSize[1] * 1.25) {
      width = Math.max(width, Math.sqrt(requiredArea * 1.65) + effectivePadding * 2);
    }

    const backplateRows = flowRows(backplate, width, effectivePadding, effectiveBackplateGap);
    const backplateHeight = rowsHeight(backplateRows, effectiveBackplateGap);
    const dinHeight = Math.max(0, ...din.map((device) => device.size[1]));
    const powerHeight = Math.max(0, ...power.map((device) => device.size[1]));
    const lowHeight = Math.max(dinHeight, powerHeight);
    const backplatePowerGap = verticalGap(backplateRows.at(-1) ?? [], power, effectiveBackplateGap);
    const dinBackplateGap = verticalGap(din, backplateRows[0] ?? [], effectiveBackplateGap);
    const backplateLowGap = verticalGap(backplateRows.at(-1) ?? [], lowRow, effectiveBackplateGap);
    const bandGaps = junction.dinPosition === "bottom"
      ? (lowRow.length && backplate.length ? backplateLowGap : 0)
      : (din.length && backplate.length ? dinBackplateGap : 0) + (power.length && backplate.length ? backplatePowerGap : 0);
    const unsnappedHeight = Math.max(
      junction.minimumSize[1],
      effectivePadding * 2
        + (junction.dinPosition === "bottom" ? lowHeight : dinHeight + powerHeight)
        + bandGaps
        + backplateHeight
        + effectiveGlandSpacing,
    );
    const snapUp = (value: number, increment: number) => Math.ceil((value - 1e-9) / increment) * increment;
    const junctionDevice = layoutDevices.find((device) => device.id === junction.deviceId)!;
    sizeById.set(junction.deviceId, junction.sizePolicy === "verified-fixed"
      ? junctionDevice.size
      : resolvedBodySize({
        ...junctionDevice,
        size: [snapUp(width, 0.040), snapUp(unsnappedHeight, 0.040), junction.minimumSize[2]],
      }));
  });

  const worldDevices = layoutDevices.flatMap((device): ResolvedDevice[] => {
    if (device.placement.space !== "world" || device.attachment || device.railTargets) return [];
    const size = sizeById.get(device.id) ?? device.size;
    const authoredSize = resolvedBodySize(device);
    // Autosized wall enclosures retain their authored bottom datum. Growing a
    // box symmetrically around its old centre can silently descend into floor
    // equipment and its protected terminal launches.
    const position: Vec3 = device.kind === "junction" && !verifiedFixedJunctionIds.has(device.id)
      ? [device.placement.position[0], device.placement.position[1] + (size[1] - authoredSize[1]) / 2, device.placement.position[2]]
      : device.placement.position;
    return [{
      ...device,
      position: verifiedFixedJunctionIds.has(device.id) ? position : snapRoutingVec(position),
      size,
      rotation: rotationForDevice(device),
    }];
  });
  const resolvedById = new Map(worldDevices.map((device) => [device.id, device]));

  graph.junctions.forEach((junction) => {
    const container = resolvedById.get(junction.deviceId);
    if (!container) throw new Error(`Junction ${junction.id} has no world device ${junction.deviceId}`);
    const members = layoutDevices.filter((device) => (
      !device.attachment && !device.railTargets
      &&
      device.placement.space === "junction" && device.placement.junctionId === junction.deviceId
    ));
    const din = members.filter((device) => device.placement.space === "junction" && device.placement.section === "din")
      .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
    const power = members.filter((device) => device.placement.space === "junction" && device.placement.section === "power")
      .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
    const backplate = members.filter((device) => device.placement.space === "junction" && device.placement.section !== "din" && device.placement.section !== "power")
      .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
    const [cx, cy, cz] = container.position;
    const [width, height, depth] = container.size;
    const effectivePadding = junction.padding;
    const layoutGap = junction.backplateGap;
    const dinLayoutGap = junction.dinGap;
    const left = cx - width / 2 + effectivePadding;
    const dinHeight = Math.max(0, ...din.map((device) => device.size[1]));
    // A junction is a grouping shell around equipment fixed to its backplate,
    // not a display case with the equipment floating on its front edge.
    // Keep the mounting plane on the same 20 mm lattice as device centres,
    // terminal faces, and router cells. A nominal 12 mm standoff was rounded
    // later by snapRoutingVec, leaving the authored plane and resolved bodies
    // disagreeing by 8 mm.
    const backplateFaceZ = cz - depth / 2 + geometryMetres(ROUTING_STEP_UNITS);
    // All fit clearances are explicit in the junction definition. This keeps a
    // physically verified enclosure from silently acquiring an extra hidden
    // margin in the renderer or router.
    const routingHeadroom = junction.sizePolicy === "verified-fixed" ? 0 : effectivePadding;
    const enclosureTop = cy + height / 2 - effectivePadding - routingHeadroom;
    const glandReserve = junction.glandSpacing;
    const dinAtBottom = junction.dinPosition === "bottom";
    const lowBandBottom = cy - height / 2 + effectivePadding + glandReserve;
    const dinTop = dinAtBottom
      ? lowBandBottom + dinHeight
      : backplate.length === 0 ? cy + dinHeight / 2 : enclosureTop;
    const dinWidth = rowSpan(din, dinLayoutGap);
    // Low rails start at the installation margin. Centering a short rail
    // directly beneath a shunt/bus band made independent gland drops share
    // the same narrow vertical corridor.
    let cursorX: number;
    if (dinAtBottom && junction.sizePolicy === "verified-fixed") {
      const powerWidth = rowSpan(power, layoutGap);
      const verifiedPowerPlaneZ = backplateFaceZ + geometryMetres(ROUTING_STEP_UNITS * 6)
        + Math.max(0, ...power.map((device) => device.size[2])) / 2;
      cursorX = cx - powerWidth / 2 + (power[0] ? routingReach(power[0], "left") : 0);
      power.forEach((device, index) => {
        resolvedById.set(device.id, {
          ...device,
          position: snapRoutingVec([
            cursorX + device.size[0] / 2,
            lowBandBottom + device.size[1] / 2,
            verifiedPowerPlaneZ,
          ]),
          size: device.size,
          rotation: [0, 0, 0],
        });
        const next = power[index + 1];
        cursorX += device.size[0] + (next ? rowGap(device, next, layoutGap) : 0);
      });
      const dinBottom = lowBandBottom + Math.max(0, ...power.map((device) => device.size[1]))
        + (power.length && din.length ? layoutGap : 0);
      cursorX = cx - dinWidth / 2 + (din[0] ? routingReach(din[0], "left") : 0);
      din.forEach((device, index) => {
        resolvedById.set(device.id, {
          ...device,
          position: snapRoutingVec([
            cursorX + device.size[0] / 2,
            dinBottom + device.size[1] / 2,
            backplateFaceZ + device.size[2] / 2,
          ]),
          size: device.size,
          rotation: [0, 0, 0],
        });
        const next = din[index + 1];
        cursorX += device.size[0] + (next ? rowGap(device, next, dinLayoutGap) : 0);
      });
    } else if (dinAtBottom) {
      // One generic low equipment band: zero-gap DIN ways tile at the left,
      // followed by conductor-fit power bars in their declared order. This
      // keeps the high-current topology legible without device-ID coordinates.
      const lowRow = [...din, ...power];
      const lowGap = (first: Device, second: Device) => {
        const firstIsDin = first.placement.space === "junction" && first.placement.section === "din";
        const secondIsDin = second.placement.space === "junction" && second.placement.section === "din";
        return rowGap(first, second, firstIsDin && secondIsDin ? dinLayoutGap : layoutGap);
      };
      cursorX = left + (lowRow[0] ? routingReach(lowRow[0], "left") : 0);
      lowRow.forEach((device, index) => {
        resolvedById.set(device.id, {
          ...device,
          position: snapRoutingVec([
            cursorX + device.size[0] / 2,
            lowBandBottom + device.size[1] / 2,
            backplateFaceZ + device.size[2] / 2,
          ]),
          size: device.size,
          rotation: [0, 0, 0],
        });
        const next = lowRow[index + 1];
        cursorX += device.size[0] + (next ? lowGap(device, next) : 0);
      });
    } else {
      cursorX = cx - dinWidth / 2 + (din[0] ? routingReach(din[0], "left") : 0);
      din.forEach((device, index) => {
        resolvedById.set(device.id, {
          ...device,
          position: snapRoutingVec([cursorX + device.size[0] / 2, dinTop - device.size[1] / 2, backplateFaceZ + device.size[2] / 2]),
          size: device.size,
          rotation: [0, 0, 0],
        });
        const next = din[index + 1];
        cursorX += device.size[0] + (next ? rowGap(device, next, dinLayoutGap) : 0);
      });

      const powerGap = layoutGap;
      const powerWidth = rowSpan(power, powerGap);
      cursorX = cx - powerWidth / 2 + (power[0] ? routingReach(power[0], "left") : 0);
      power.forEach((device, index) => {
        resolvedById.set(device.id, {
          ...device,
          position: snapRoutingVec([cursorX + device.size[0] / 2, lowBandBottom + device.size[1] / 2, backplateFaceZ + device.size[2] / 2]),
          size: device.size,
          rotation: [0, 0, 0],
        });
        const next = power[index + 1];
        cursorX += device.size[0] + (next ? rowGap(device, next, powerGap) : 0);
      });
    }

    if (junction.sizePolicy === "verified-fixed") {
      // A physically checked enclosure must not be enlarged merely because a
      // conservative planar layout wants more routing aisles. Use the real
      // enclosure depth as independent mounting layers: compact physical rows
      // share X/Y only when their solid bodies are separated along Z. The
      // voxel router still validates every conductor and rejects a layer plan
      // that cannot be wired without a collision.
      const backplateRows = flowRows(backplate, width, effectivePadding, layoutGap);
      const shellEdgeInset = Math.max(0.012, Math.min(0.020, junction.padding - 0.008));
      const safeMinimumUnits: GridPoint = [
        geometryUnits(cx - width / 2 + shellEdgeInset),
        geometryUnits(cy - height / 2 + shellEdgeInset),
        0,
      ].map((value) => Math.ceil(value / JUNCTION_ROUTING_STEP_UNITS) * JUNCTION_ROUTING_STEP_UNITS) as unknown as GridPoint;
      const safeMaximumUnits: GridPoint = [
        geometryUnits(cx + width / 2 - shellEdgeInset),
        geometryUnits(cy + height / 2 - shellEdgeInset),
        0,
      ].map((value) => Math.floor(value / JUNCTION_ROUTING_STEP_UNITS) * JUNCTION_ROUTING_STEP_UNITS) as unknown as GridPoint;
      const safeMinimum = vectorMetres(safeMinimumUnits);
      const safeMaximum = vectorMetres(safeMaximumUnits);
      const tangentReach = (device: Device, face: "left" | "right" | "top" | "bottom") => Math.max(
        device.conductors.some((port) => port.face === face && connectedEndpoints.has(`${device.id}.${port.id}`))
          ? geometryMetres(ROUTING_STEP_UNITS)
          : 0,
        attachmentClearance(device)[face],
      );
      const insideSafeShell = (device: ResolvedDevice) => (
        device.position[0] - device.size[0] / 2 - tangentReach(device, "left") >= safeMinimum[0] - 1e-9
        && device.position[0] + device.size[0] / 2 + tangentReach(device, "right") <= safeMaximum[0] + 1e-9
        && device.position[1] - device.size[1] / 2 - tangentReach(device, "bottom") >= safeMinimum[1] - 1e-9
        && device.position[1] + device.size[1] / 2 + tangentReach(device, "top") <= safeMaximum[1] + 1e-9
      );
      const shellClampedDeviceIds = new Set<string>();
      const topBoundary = dinAtBottom
        ? enclosureTop
        : dinTop - dinHeight - (din.length && backplateRows.length ? layoutGap : 0);
      const powerTop = power.length > 0
        ? lowBandBottom + Math.max(...power.map((device) => device.size[1]))
        : cy - height / 2 + effectivePadding + glandReserve;
      const bottomBoundary = dinAtBottom
        ? lowBandBottom
          + (junction.sizePolicy === "verified-fixed"
            ? Math.max(0, ...power.map((device) => device.size[1]))
              + (power.length && din.length ? layoutGap : 0)
              + dinHeight
            : Math.max(dinHeight, Math.max(0, ...power.map((device) => device.size[1]))))
          + (backplateRows.length ? layoutGap : 0)
        : powerTop + (power.length && backplateRows.length ? layoutGap : 0);
      const availableHeight = topBoundary - bottomBoundary;
      const depthLayers: Device[][][] = [];
      backplateRows.forEach((row) => {
        const layer = depthLayers.find((candidate) => (
          rowsHeight([...candidate, row], 0) <= availableHeight + 1e-9
        ));
        if (layer) layer.push(row);
        else depthLayers.push([row]);
      });
      // Keep one route cell behind the first layer as a shared rear wiring
      // channel. Compatible rows may share a depth layer at different heights;
      // incompatible terminal approaches receive independent layers.
      let depthCursor = backplateFaceZ + geometryMetres(ROUTING_STEP_UNITS * 2);
      const frontBoundary = cz + depth / 2;
      depthLayers.forEach((layer, layerIndex) => {
        // A bodyless splice needs one cable layer, not the 40 mm placeholder
        // envelope used to distribute its selectable terminals.
        const layerDepth = Math.max(0, ...layer.flat().map((device) => (
          isBodylessPresentation(device) ? geometryMetres(ROUTING_STEP_UNITS) : device.size[2]
        )));
        const layerHeight = rowsHeight(layer, 0);
        if (layerHeight > availableHeight + 1e-9
          || depthCursor + layerDepth > frontBoundary + 1e-9) {
          throw new Error(`${junction.id}: verified enclosure packing exceeds the checked shell`);
        }
        const layerCenterZ = depthCursor + layerDepth / 2;
        let layerCursorY = layer.length > 1 || layerIndex % 2 === 0
          ? bottomBoundary
          : topBoundary - layerHeight;
        layer.forEach((row, rowIndex) => {
          const rowWidth = rowSpan(row, layoutGap);
          const rowHeight = Math.max(0, ...row.map((device) => device.size[1]));
          if (rowWidth > width - effectivePadding * 2 + 1e-9) {
            throw new Error(`${junction.id}: verified enclosure row exceeds the checked shell`);
          }
          cursorX = cx - rowWidth / 2 + routingReach(row[0], "left");
          row.forEach((device, index) => {
            const baseY = layerCursorY + rowHeight / 2;
            const safeY = Math.max(
              safeMinimum[1] + device.size[1] / 2 + tangentReach(device, "bottom"),
              Math.min(
                baseY,
                safeMaximum[1] - device.size[1] / 2 - tangentReach(device, "top"),
              ),
            );
            const resolvedY = snapRoutingScalar(safeY);
            if (Math.abs(resolvedY - snapRoutingScalar(baseY)) > 1e-9) shellClampedDeviceIds.add(device.id);
            resolvedById.set(device.id, {
              ...device,
              position: snapRoutingVec([
                cursorX + device.size[0] / 2,
                resolvedY,
                layerCenterZ,
              ]),
              size: device.size,
              rotation: [0, 0, 0],
            });
            const next = row[index + 1];
            cursorX += device.size[0] + (next ? rowGap(device, next, layoutGap) : 0);
          });
          const nextRow = layer[rowIndex + 1];
          layerCursorY += rowHeight + (nextRow ? verticalGap(row, nextRow, 0) : 0);
        });
        depthCursor += layerDepth;
      });

      // A boundary clamp can bring an arm into contact with a device on a
      // neighbouring depth layer. Resolve only that newly introduced local
      // conflict, using the nearest one-cell X/Y placement that preserves the
      // shell/tangent envelope. This is a generic fit pass; no component IDs
      // or authored coordinates participate.
      const memberIds = new Set(members.map((device) => device.id));
      const placedMembers = () => [...memberIds].map((id) => resolvedById.get(id)!);
      for (let attempt = 0; attempt < members.length * 4; attempt += 1) {
        const overlap = sampledResolvedDeviceOverlaps(placedMembers())[0];
        if (!overlap) break;
        const [firstId, secondId] = overlap.split(" ↔ ");
        const movable = [resolvedById.get(firstId), resolvedById.get(secondId)]
          .filter((device): device is ResolvedDevice => Boolean(device) && memberIds.has(device!.id))
          .toSorted((first, second) => (
            Number(shellClampedDeviceIds.has(first.id)) - Number(shellClampedDeviceIds.has(second.id))
            || ((second.placement.space === "junction" ? second.placement.order : 0)
              - (first.placement.space === "junction" ? first.placement.order : 0))
          ));
        let moved = false;
        for (const device of movable) {
          if (shellClampedDeviceIds.has(device.id) || device.placement.space !== "junction" || device.placement.section !== "backplate") continue;
          for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
            const trial: ResolvedDevice = {
              ...device,
              position: [
                device.position[0] + geometryMetres(ROUTING_STEP_UNITS * dx),
                device.position[1] + geometryMetres(ROUTING_STEP_UNITS * dy),
                device.position[2],
              ],
            };
            if (!insideSafeShell(trial)) continue;
            const trialMembers = placedMembers().map((candidate) => candidate.id === trial.id ? trial : candidate);
            if (sampledResolvedDeviceOverlaps(trialMembers).length > 0) continue;
            resolvedById.set(trial.id, trial);
            moved = true;
            break;
          }
          if (moved) break;
        }
        if (!moved) break;
      }
    } else {
      const backplateRows = flowRows(backplate, width, effectivePadding, layoutGap);
      let cursorY = dinAtBottom
        ? enclosureTop
        : dinTop - dinHeight - (din.length && backplateRows.length
          ? verticalGap(din, backplateRows[0], layoutGap)
          : 0);
      backplateRows.forEach((row, rowIndex) => {
        cursorX = left + routingReach(row[0], "left");
        row.forEach((device, index) => {
          const resolved: ResolvedDevice = {
            ...device,
            position: snapRoutingVec([cursorX + device.size[0] / 2, cursorY - device.size[1] / 2, backplateFaceZ + device.size[2] / 2]),
            size: device.size,
            rotation: [0, 0, 0],
          };
          resolvedById.set(device.id, resolved);
          const next = row[index + 1];
          cursorX += device.size[0] + (next ? rowGap(device, next, layoutGap) : 0);
        });
        const rowHeight = Math.max(0, ...row.map((device) => device.size[1]));
        const nextRow = backplateRows[rowIndex + 1];
        cursorY -= rowHeight + (nextRow ? verticalGap(row, nextRow, layoutGap) : 0);
      });
    }
  });

  // Rigid rails are geometry-derived continuous devices, not flexible routes.
  // Every named tap is exactly one route cell above a declared collinear target
  // and faces back toward it, so each short tooth is a validated direct mate.
  layoutDevices.filter((device) => device.railTargets).forEach((device) => {
    const targets = Object.entries(device.railTargets!).map(([conductorId, endpoint]) => {
      const owner = resolvedById.get(endpointDeviceId(endpoint));
      if (!owner) throw new Error(`${device.id}.${conductorId}: unresolved rail target ${endpoint}`);
      const targetId = endpoint.slice(endpoint.lastIndexOf(".") + 1);
      const definition = owner.conductors.find((port) => port.id === targetId);
      if (!definition) throw new Error(`${device.id}.${conductorId}: missing rail target ${endpoint}`);
      const position = terminalPosition(owner, targetId);
      const direction = rotateVector(directionByFace[definition.face], owner.rotation);
      return { conductorId, endpoint, position, direction };
    });
    const direction = targets[0]?.direction;
    if (!direction || targets.some((target) => distance(target.direction, direction) > 1e-8)) {
      throw new Error(`${device.id}: rigid rail targets must have one parallel terminal direction`);
    }
    if (Math.abs(direction[1] - 1) > 1e-8 || targets.some((target) => (
      Math.abs(target.position[1] - targets[0].position[1]) > 1e-8
      || Math.abs(target.position[2] - targets[0].position[2]) > 1e-8
    ))) {
      throw new Error(`${device.id}: rigid rail targets must be collinear top terminals`);
    }
    const tapPositions = Object.fromEntries(targets.map((target) => [
      target.conductorId,
      add(target.position, scale(direction, geometryMetres(ROUTING_STEP_UNITS))),
    ])) as Record<string, Vec3>;
    const tapDirections = Object.fromEntries(targets.map((target) => [
      target.conductorId,
      scale(direction, -1),
    ])) as Record<string, Vec3>;
    const xValues = Object.values(tapPositions).map((position) => position[0]);
    const centerX = snapRoutingScalar((Math.min(...xValues) + Math.max(...xValues)) / 2);
    const halfWidth = ceilRoutingScalar(Math.max(...xValues.map((x) => Math.abs(x - centerX))) + 0.020);
    const size = [halfWidth * 2, 0.040, 0.040] as Vec3;
    resolvedById.set(device.id, {
      ...device,
      position: snapRoutingVec([centerX, Object.values(tapPositions)[0][1] + size[1] / 2, Object.values(tapPositions)[0][2]]),
      size,
      rotation: [0, 0, 0],
      resolvedConductorPositions: tapPositions,
      resolvedConductorDirections: tapDirections,
    });
  });

  // Resolve bodyless joins only after their owners. The join's left terminal
  // sits one 20 mm routing-cell lead beyond the physical landing; local +X follows
  // the owner's conductor axis. No placement coordinates or per-device rules
  // are required, and moving the owner moves the complete splice.
  layoutDevices.filter((device) => device.attachment).forEach((device) => {
    const targetEndpoint = device.attachment!.endpoint;
    const owner = resolvedById.get(endpointDeviceId(targetEndpoint));
    if (!owner) throw new Error(`${device.id}: attachment owner ${targetEndpoint} is unresolved`);
    const separator = targetEndpoint.lastIndexOf(".");
    const conductorId = targetEndpoint.slice(separator + 1);
    const targetDefinition = owner.conductors.find((candidate) => candidate.id === conductorId);
    if (!targetDefinition) throw new Error(`${device.id}: attachment terminal ${targetEndpoint} does not exist`);
    const targetPosition = terminalPosition(owner, conductorId);
    const targetDirection = rotateVector(directionByFace[targetDefinition.face], owner.rotation);
    const size = device.size;
    const lead = geometryMetres(ROUTING_STEP_UNITS);
    const centerDistance = size[0] / 2 + lead + (attachmentAxialOffsetById.get(device.id) ?? 0);
    const rawPosition = add(targetPosition, scale(targetDirection, centerDistance));
    const axisAligned = targetDirection.filter((value) => Math.abs(value) > 1e-9).length === 1;
    resolvedById.set(device.id, {
      ...device,
      position: axisAligned ? snapRoutingVec(rawPosition) : rawPosition,
      size,
      rotation: rotationForXAxis(targetDirection),
    });
  });

  graph.devices.forEach((device) => {
    if (!resolvedById.has(device.id)) {
      const owner = device.placement.space === "junction" ? device.placement.junctionId : "world";
      throw new Error(`Could not resolve ${device.id} in ${owner}`);
    }
  });
  return graph.devices.map((device) => resolvedById.get(device.id)!);
}

function resolveConductors(devices: readonly ResolvedDevice[]) {
  return devices.flatMap((device) => device.conductors.map((candidate): ResolvedConductor => ({
    ...candidate,
    key: `${device.id}.${candidate.id}`,
    deviceId: device.id,
    position: terminalPosition(device, candidate.id),
    direction: device.resolvedConductorDirections?.[candidate.id]
      ?? rotateVector(directionByFace[candidate.face], device.rotation),
  })));
}

function resolveGlands(graph: SystemGraph, devices: readonly ResolvedDevice[]): Gland[] {
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const connectionById = new Map(graph.connections.map((connection) => [connection.id, connection]));
  const cableById = new Map(graph.cables.map((cable) => [cable.id, cable]));
  const conductorX = new Map<string, number>(devices.flatMap((device) => device.conductors.map((candidate) => (
    [`${device.id}.${candidate.id}`, terminalPosition(device, candidate.id)[0]] as const
  ))));
  return graph.junctions.flatMap((junction) => {
    const container = deviceById.get(junction.deviceId)!;
    const inside = new Set(devices
      .filter((device) => device.placement.space === "junction" && device.placement.junctionId === junction.deviceId)
      .map((device) => device.id));
    const attachmentRoot = (device: ResolvedDevice) => {
      const visited = new Set<string>();
      let current = device;
      while (current.attachment && !visited.has(current.id)) {
        visited.add(current.id);
        const root = deviceById.get(endpointDeviceId(current.attachment.endpoint));
        if (!root) break;
        current = root;
      }
      return current;
    };
    const bundleInsideX = (connectionIds: readonly string[]) => {
      const positions = connectionIds.flatMap((id) => {
        const connection = connectionById.get(id)!;
        return [connection.from, connection.to].flatMap((endpoint) => {
          const device = deviceById.get(endpointDeviceId(endpoint));
          return device?.placement.space === "junction" && device.placement.junctionId === junction.deviceId
            ? [conductorX.get(endpoint)!]
            : [];
        });
      });
      return positions.length > 0
        ? positions.reduce((sum, value) => sum + value, 0) / positions.length
        : container.position[0];
    };
    const bundleInsideFaceOrder = (connectionIds: readonly string[]) => {
      const faces = connectionIds.flatMap((id) => {
        const connection = connectionById.get(id)!;
        return [connection.from, connection.to].flatMap((endpoint) => {
          const device = deviceById.get(endpointDeviceId(endpoint));
          if (device?.placement.space !== "junction" || device.placement.junctionId !== junction.deviceId) return [];
          const conductorId = endpoint.slice(endpoint.lastIndexOf(".") + 1);
          return device.conductors.find((port) => port.id === conductorId)?.face ?? [];
        });
      });
      return faces.includes("bottom") ? 0 : faces.includes("top") ? 1 : 2;
    };
    const bundleExternalX = (connectionIds: readonly string[]) => {
      const positions = connectionIds.flatMap((id) => {
        const connection = connectionById.get(id)!;
        return [connection.from, connection.to].flatMap((endpoint) => {
          const device = deviceById.get(endpointDeviceId(endpoint));
          return device && !inside.has(device.id) ? [attachmentRoot(device).position[0]] : [];
        });
      });
      return positions.length > 0
        ? positions.reduce((sum, value) => sum + value, 0) / positions.length
        : container.position[0];
    };
    const bundleLabel = (connectionIds: readonly string[]) => {
      const labels = new Set<string>();
      connectionIds.forEach((id) => {
        const connection = connectionById.get(id)!;
        [connection.from, connection.to].forEach((endpoint) => {
          if (inside.has(endpointDeviceId(endpoint))) return;
          graphEndpointOwnerLabels(graph, endpoint, new Set([connection.id])).forEach((label) => labels.add(label));
        });
      });
      if (labels.size > 0) return [...labels].toSorted().join(" / ");
      return connectionIds.map((id) => graphConnectionDisplayLabel(graph, connectionById.get(id)!)).join(" / ");
    };
    // Lay glands out in the same left-to-right order as their internal
    // terminals. Alphabetical gland ordering made large conductors swap sides
    // inside the enclosure (notably MultiPlus +/−) even though both endpoint
    // layouts were individually clean.
    const bundleRecords = [...crossingBundles(graph, junction.deviceId).entries()].map(([bundleId, connectionIds]) => ({
      bundleId,
      connectionIds,
      insideX: bundleInsideX(connectionIds),
      outsideX: bundleExternalX(connectionIds),
      faceOrder: bundleInsideFaceOrder(connectionIds),
      diameterMm: Math.max(...connectionIds.map((id) => cableById.get(connectionById.get(id)!.cableId)?.outsideDiameterMm ?? 0)),
    }));
    const normalizedRank = (key: "insideX" | "outsideX") => {
      const values = [...new Set(bundleRecords.map((record) => Number(record[key].toFixed(7))))].toSorted((a, b) => a - b);
      return new Map(bundleRecords.map((record) => {
        const rank = values.indexOf(Number(record[key].toFixed(7)));
        return [record.bundleId, values.length <= 1 ? 0 : rank / (values.length - 1)] as const;
      }));
    };
    const outsideRank = normalizedRank("outsideX");
    const externalTarget = (record: (typeof bundleRecords)[number]) => {
      const absolute = 0.5 + (record.outsideX - container.position[0]) / Math.max(container.size[0], junction.glandSpacing);
      const ranked = outsideRank.get(record.bundleId) ?? 0.5;
      // Absolute side is authoritative; normalized rank deterministically
      // orders peers that all clamp to the same enclosure edge.
      return Math.max(0, Math.min(1, absolute)) * 0.9 + ranked * 0.1;
    };
    // Start with the collision-safe internal order, then apply only a bounded
    // number of pair exchanges that strictly reduce normalized external
    // cross-over. This keeps the one bottom row and its spacing invariant while
    // allowing several independent left/right inversions to be corrected in a
    // dense fixed enclosure (rather than fixing only the single worst pair).
    const bundles = bundleRecords.toSorted((first, second) => (
      first.insideX - second.insideX
      || first.faceOrder - second.faceOrder
      || first.bundleId.localeCompare(second.bundleId)
    ));
    if (junction.sizePolicy === "verified-fixed" && bundles.length >= 8) {
      const maximumSwaps = Math.ceil(bundles.length / 4);
      for (let swap = 0; swap < maximumSwaps; swap += 1) {
        let best: { first: number; second: number; improvement: number } | undefined;
        for (let first = 0; first < bundles.length; first += 1) {
          for (let second = first + 1; second < bundles.length; second += 1) {
            const firstSlot = first / (bundles.length - 1);
            const secondSlot = second / (bundles.length - 1);
            const firstExternal = externalTarget(bundles[first]);
            const secondExternal = externalTarget(bundles[second]);
            const before = Math.abs(firstSlot - firstExternal) + Math.abs(secondSlot - secondExternal);
            const after = Math.abs(secondSlot - firstExternal) + Math.abs(firstSlot - secondExternal);
            const improvement = before - after;
            if (improvement > (best?.improvement ?? 0) + 1e-9) best = { first, second, improvement };
          }
        }
        if (!best || best.improvement < 0.01) break;
        [bundles[best.first], bundles[best.second]] = [bundles[best.second], bundles[best.first]];
      }
    }
    const glandSpacing = junction.glandSpacing;
    const width = Math.max(0, (bundles.length - 1) * glandSpacing);
    return bundles.map(({ bundleId, connectionIds }, index): Gland => ({
      id: `${junction.id}-gland-${index + 1}`,
      label: bundleLabel(connectionIds),
      junctionId: junction.deviceId,
      bundleId,
      position: snapRoutingVec([
        container.position[0] - width / 2 + index * glandSpacing,
        container.position[1] - container.size[1] / 2,
        container.position[2],
      ]),
      connectionIds,
    }));
  });
}

class MinHeap<T> {
  private entries: Array<{ score: number; value: T }> = [];

  push(value: T, score: number) {
    const entry = { score, value };
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.entries[parent].score <= score) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop() {
    if (this.entries.length === 0) return undefined;
    const first = this.entries[0];
    const last = this.entries.pop()!;
    if (this.entries.length > 0) {
      let index = 0;
      this.entries[0] = last;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let next = index;
        if (left < this.entries.length && this.entries[left].score < this.entries[next].score) next = left;
        if (right < this.entries.length && this.entries[right].score < this.entries[next].score) next = right;
        if (next === index) break;
        [this.entries[index], this.entries[next]] = [this.entries[next], this.entries[index]];
        index = next;
      }
    }
    return first.value;
  }

  get size() { return this.entries.length; }
}

function nearestGrid(point: Vec3, space: RoutingSpace): GridPoint {
  const units = vectorUnits(point);
  return [
    Math.round((units[0] - space.minUnits[0]) / space.cellUnits),
    Math.round((units[1] - space.minUnits[1]) / space.cellUnits),
    Math.round((units[2] - space.minUnits[2]) / space.cellUnits),
  ];
}

function toGrid(point: Vec3, space: RoutingSpace): GridPoint {
  const units = vectorUnits(point);
  const latticePoint = vectorMetres(units);
  if (distance(point, latticePoint) > 1e-7) {
    throw new Error(`${space.key}: ${point.join(",")} is off the 10 mm geometry lattice`);
  }
  const delta = units.map((value, axis) => value - space.minUnits[axis]);
  if (delta.some((value) => value % space.cellUnits !== 0)) {
    throw new Error(`${space.key}: ${point.join(",")} is off the 20 mm route lattice`);
  }
  return delta.map((value) => value / space.cellUnits) as unknown as GridPoint;
}

function isRouteGridPoint(point: Vec3, space: RoutingSpace) {
  const units = vectorUnits(point);
  return distance(point, vectorMetres(units)) <= 1e-7
    && units.every((value, axis) => (value - space.minUnits[axis]) % space.cellUnits === 0);
}

function fromGrid(point: GridPoint, space: RoutingSpace): Vec3 {
  return vectorMetres([
    space.minUnits[0] + point[0] * space.cellUnits,
    space.minUnits[1] + point[1] * space.cellUnits,
    space.minUnits[2] + point[2] * space.cellUnits,
  ]);
}

function outwardGridAdapter(point: Vec3, direction: Vec3, space: RoutingSpace) {
  const nearest = nearestGrid(point, space);
  const bounds = gridBounds(space);
  const candidates: Vec3[] = [];
  for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) {
    const grid: GridPoint = [nearest[0] + x, nearest[1] + y, nearest[2] + z];
    if (grid.some((value, axis) => value < 0 || value > bounds[axis])) continue;
    const candidate = fromGrid(grid, space);
    const delta: Vec3 = [candidate[0] - point[0], candidate[1] - point[1], candidate[2] - point[2]];
    if (dot(delta, direction) < -1e-9) continue;
    candidates.push(candidate);
  }
  return candidates.toSorted((first, second) => (
    distance(point, first) - distance(point, second)
    || dot([
      second[0] - point[0], second[1] - point[1], second[2] - point[2],
    ], direction) - dot([
      first[0] - point[0], first[1] - point[1], first[2] - point[2],
    ], direction)
  ))[0] ?? fromGrid(nearest, space);
}

const ROUTING_CABLE_CLEARANCE_M = 0.0005;
const MAX_CABLE_DIAMETER_MM = 14.5;

function hasNearbyCableConflict(
  point: GridPoint,
  space: RoutingSpace,
  candidateDiameterMm: number,
  owner: string,
  sources: "occupied" | "reserved" | "both" = "both",
  ignoredOwners: ReadonlySet<string> = new Set(),
) {
  const maximumRequiredM = candidateDiameterMm / 2000
    + MAX_CABLE_DIAMETER_MM / 2000
    + ROUTING_CABLE_CLEARANCE_M;
  const range = Math.max(0, Math.floor((maximumRequiredM - 1e-9) / space.cell));
  for (let x = -range; x <= range; x += 1) {
    for (let y = -range; y <= range; y += 1) {
      for (let z = -range; z <= range; z += 1) {
        const centreDistanceM = Math.hypot(x, y, z) * space.cell;
        if (centreDistanceM > maximumRequiredM) continue;
        const key = gridKey([point[0] + x, point[1] + y, point[2] + z]);
        if (sources !== "reserved") {
          const occupiedBy = space.occupied.get(key);
          if (occupiedBy && occupiedBy !== owner && !ignoredOwners.has(occupiedBy)) {
            const requiredM = candidateDiameterMm / 2000
              + (space.ownerDiameterMm.get(occupiedBy) ?? MAX_CABLE_DIAMETER_MM) / 2000
              + ROUTING_CABLE_CLEARANCE_M;
            if (centreDistanceM + 1e-9 < requiredM) return true;
          }
        }
        if (sources !== "occupied") {
          const fixedFor = space.fixedReserved.get(key);
          if (fixedFor) {
            for (const fixedOwner of fixedFor) {
              if (fixedOwner === owner || ignoredOwners.has(fixedOwner)) continue;
              const requiredM = candidateDiameterMm / 2000
                + (space.ownerDiameterMm.get(fixedOwner) ?? MAX_CABLE_DIAMETER_MM) / 2000
                + ROUTING_CABLE_CLEARANCE_M;
              if (centreDistanceM + 1e-9 < requiredM) return true;
            }
          }
          const reservedFor = space.reserved.get(key);
          if (!reservedFor) continue;
          for (const reservedOwner of reservedFor) {
            if (reservedOwner === owner || ignoredOwners.has(reservedOwner)) continue;
            const reservedDiameterMm = space.ownerDiameterMm.get(reservedOwner) ?? MAX_CABLE_DIAMETER_MM;
            const requiredM = candidateDiameterMm / 2000
              + reservedDiameterMm / 2000
              + ROUTING_CABLE_CLEARANCE_M;
            if (centreDistanceM + 1e-9 < requiredM) return true;
          }
        }
      }
    }
  }
  return false;
}

function gridBounds(space: RoutingSpace): GridPoint {
  return [
    Math.floor((space.maxUnits[0] - space.minUnits[0]) / space.cellUnits),
    Math.floor((space.maxUnits[1] - space.minUnits[1]) / space.cellUnits),
    Math.floor((space.maxUnits[2] - space.minUnits[2]) / space.cellUnits),
  ];
}

function createRoutingSpace(
  key: string,
  cellUnits: number,
  rawMin: Vec3,
  rawMax: Vec3,
  edgeInset: number,
  worldRegion?: WorldRoutingRegion,
): RoutingSpace {
  const requestedMin = vectorUnits(snapGeometryVec(rawMin));
  const requestedMax = vectorUnits(snapGeometryVec(rawMax));
  const minUnits = requestedMin.map((value) => Math.ceil(value / cellUnits) * cellUnits) as unknown as GridPoint;
  const maxUnits = requestedMax.map((value, axis) => Math.max(
    minUnits[axis] + cellUnits,
    Math.floor(value / cellUnits) * cellUnits,
  )) as unknown as GridPoint;
  return {
    key,
    cellUnits,
    cell: geometryMetres(cellUnits),
    minUnits,
    maxUnits,
    min: vectorMetres(minUnits),
    max: vectorMetres(maxUnits),
    occupied: new Map(),
    reserved: new Map(),
    fixedReserved: new Map(),
    ownerDiameterMm: new Map(),
    blockedByRadius: new Map(),
    edgeInset: snapGeometry(edgeInset),
    worldRegion,
  };
}

function simplify(points: readonly Vec3[]) {
  const loopErased: Vec3[] = [];
  const indexByPoint = new Map<string, number>();
  points.forEach((point) => {
    const key = point.map((value) => Math.round(value * 1e7)).join(",");
    const previousIndex = indexByPoint.get(key);
    if (previousIndex !== undefined) {
      loopErased.splice(previousIndex + 1);
      indexByPoint.clear();
      loopErased.forEach((candidate, index) => {
        indexByPoint.set(candidate.map((value) => Math.round(value * 1e7)).join(","), index);
      });
      return;
    }
    indexByPoint.set(key, loopErased.length);
    loopErased.push(point);
  });
  const distinct = loopErased.filter((point, index) => index === 0 || distance(point, loopErased[index - 1]) > 1e-9);
  if (distinct.length <= 2) return [...distinct];
  const result: Vec3[] = [];
  distinct.forEach((point) => {
    while (result.length >= 2) {
      const a = result[result.length - 2];
      const b = result[result.length - 1];
      const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const bc: Vec3 = [point[0] - b[0], point[1] - b[1], point[2] - b[2]];
      const cross = Math.hypot(
        ab[1] * bc[2] - ab[2] * bc[1],
        ab[2] * bc[0] - ab[0] * bc[2],
        ab[0] * bc[1] - ab[1] * bc[0],
      );
      if (cross > 1e-10) break;
      // Collapse both straight continuations and immediate collinear
      // overshoots. The latter were responsible for tiny out-and-back hooks at
      // thick battery terminals after a sub-grid endpoint joined the A* grid.
      result.pop();
    }
    if (result.length === 0 || distance(result.at(-1)!, point) > 1e-9) result.push(point);
  });
  return result;
}

/** Remove an orthogonal detour that returns through an earlier segment. The
 * replacement follows only geometry already occupied by the same route: up
 * to the first intersection, then from that intersection along the later
 * segment. Terminal tangents therefore remain intact while a visible loop can
 * no longer fold through itself after approach and A* sections are joined. */
function eraseOrthogonalSelfLoops(input: readonly Vec3[]) {
  const eraseRepeatedVertices = (source: readonly Vec3[]) => {
    const result: Vec3[] = [];
    const indexByPoint = new Map<string, number>();
    source.forEach((point) => {
      const key = point.map((value) => Math.round(value * 1e7)).join(",");
      const prior = indexByPoint.get(key);
      if (prior !== undefined) {
        result.splice(prior + 1);
        indexByPoint.clear();
        result.forEach((candidate, index) => {
          indexByPoint.set(candidate.map((value) => Math.round(value * 1e7)).join(","), index);
        });
        return;
      }
      if (result.length > 0 && distance(result.at(-1)!, point) <= 1e-9) return;
      indexByPoint.set(key, result.length);
      result.push(point);
    });
    return result;
  };
  let points = eraseRepeatedVertices(input);
  const segmentAxis = (start: Vec3, end: Vec3) => {
    const axes = [0, 1, 2].filter((axis) => Math.abs(end[axis] - start[axis]) > 1e-9);
    return axes.length === 1 ? axes[0] : undefined;
  };
  const within = (value: number, first: number, second: number) => (
    value >= Math.min(first, second) - 1e-9 && value <= Math.max(first, second) + 1e-9
  );
  for (let pass = 0; pass < input.length * input.length; pass += 1) {
    let replacement: Vec3[] | undefined;
    search: for (let first = 0; first < points.length - 1; first += 1) {
      const firstAxis = segmentAxis(points[first], points[first + 1]);
      if (firstAxis === undefined) continue;
      for (let second = first + 2; second < points.length - 1; second += 1) {
        const secondAxis = segmentAxis(points[second], points[second + 1]);
        if (secondAxis === undefined || secondAxis === firstAxis) continue;
        const remainingAxis = [0, 1, 2].find((axis) => axis !== firstAxis && axis !== secondAxis)!;
        if (Math.abs(points[first][remainingAxis] - points[second][remainingAxis]) > 1e-9) continue;
        const intersection = [...points[first]] as [number, number, number];
        intersection[firstAxis] = points[second][firstAxis];
        intersection[secondAxis] = points[first][secondAxis];
        if (
          !within(intersection[firstAxis], points[first][firstAxis], points[first + 1][firstAxis])
          || !within(intersection[secondAxis], points[second][secondAxis], points[second + 1][secondAxis])
        ) continue;
        replacement = [
          ...points.slice(0, first + 1),
          intersection,
          points[second + 1],
          ...points.slice(second + 2),
        ];
        break search;
      }
    }
    if (!replacement) break;
    points = eraseRepeatedVertices(replacement);
  }
  return points;
}

const AXIS_ORDERS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

function orthogonalCandidates(start: Vec3, end: Vec3) {
  return AXIS_ORDERS.map((order) => {
    const cursor = [...start] as [number, number, number];
    const points: Vec3[] = [start];
    order.forEach((axis) => {
      if (Math.abs(cursor[axis] - end[axis]) < 1e-9) return;
      cursor[axis] = end[axis];
      points.push([...cursor] as Vec3);
    });
    if (distance(points.at(-1)!, end) > 1e-9) points.push(end);
    return simplify(points);
  });
}

function pathClear(
  points: readonly Vec3[],
  space: RoutingSpace,
  diameterMm: number,
  owner: string,
  endpointAccess: EndpointAccessMap = new Map(),
  ignoredCableOwners: ReadonlySet<string> = new Set(),
) {
  const radiusM = Math.max(space.cell * 0.15, diameterMm / 2000);
  const blocked = space.blockedByRadius.get(radiusM.toFixed(6)) ?? emptyBlockedVoxels();
  const bounds = gridBounds(space);
  for (let segment = 1; segment < points.length; segment += 1) {
    const start = toGrid(points[segment - 1], space);
    const end = toGrid(points[segment], space);
    const steps = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]), Math.abs(end[2] - start[2]), 1);
    for (let step = 0; step <= steps; step += 1) {
      if (segment === 1 && step === 0) continue;
      if (segment === points.length - 1 && step === steps) continue;
      const fraction = step / steps;
      const point: GridPoint = [
        Math.round(start[0] + (end[0] - start[0]) * fraction),
        Math.round(start[1] + (end[1] - start[1]) * fraction),
        Math.round(start[2] + (end[2] - start[2]) * fraction),
      ];
      if (point.some((value, axis) => value < 0 || value > bounds[axis])) return false;
      if (
        isBlockedByDevice(blocked, point, space, endpointAccess)
        || hasNearbyCableConflict(point, space, diameterMm, owner, "both", ignoredCableOwners)
      ) return false;
    }
  }
  return true;
}

function stringPullOrthogonal(
  points: readonly Vec3[],
  space: RoutingSpace,
  diameterMm: number,
  owner: string,
  preferredDepthM: number,
  endpointAccess: EndpointAccessMap = new Map(),
  startDirection?: Vec3,
  goalDirection?: Vec3,
  terminalNeighborhoods: readonly { point: Vec3; direction: Vec3 }[] = [],
) {
  if (points.length <= 3) return simplify(points);
  const result: Vec3[] = [points[0]];
  let startIndex = 0;
  while (startIndex < points.length - 1) {
    let selectedEnd = startIndex + 1;
    let selected: Vec3[] = [points[startIndex], points[selectedEnd]];
    for (let endIndex = points.length - 1; endIndex > startIndex; endIndex -= 1) {
      const candidates = orthogonalCandidates(points[startIndex], points[endIndex])
        .filter((candidate) => pathClear(candidate, space, diameterMm, owner, endpointAccess))
        .filter((candidate) => candidate.every((point) => terminalNeighborhoods.every((terminal) => (
          distance(point, terminal.point) >= space.cell * 3 - 1e-9
          || dot(subtract(point, terminal.point), terminal.direction) >= -1e-9
        ))))
        .filter((candidate) => {
          const firstStep: Vec3 = candidate.length > 1 ? [
            candidate[1][0] - candidate[0][0], candidate[1][1] - candidate[0][1], candidate[1][2] - candidate[0][2],
          ] : [0, 0, 0];
          const lastStep: Vec3 = candidate.length > 1 ? [
            candidate.at(-1)![0] - candidate.at(-2)![0],
            candidate.at(-1)![1] - candidate.at(-2)![1],
            candidate.at(-1)![2] - candidate.at(-2)![2],
          ] : [0, 0, 0];
          return (!(startIndex === 0 && startDirection) || dot(firstStep, startDirection) >= -1e-9)
            && (!(endIndex === points.length - 1 && goalDirection) || dot(lastStep, goalDirection) <= 1e-9);
        })
        .toSorted((first, second) => {
          const score = (candidate: readonly Vec3[]) => candidate.reduce((sum, point) => (
            sum + Math.abs(point[2] - preferredDepthM) * (isWorldRoutingSpace(space) ? 72 : 18)
          ), 0);
          const length = (candidate: readonly Vec3[]) => candidate.slice(1)
            .reduce((sum, point, index) => sum + distance(candidate[index], point), 0);
          return length(first) - length(second)
            || first.length - second.length
            || score(first) - score(second);
        });
      if (candidates.length === 0) continue;
      selectedEnd = endIndex;
      selected = candidates[0];
      break;
    }
    result.push(...selected.slice(1));
    startIndex = selectedEnd;
  }
  return simplify(result);
}

function buildBlockedVoxels(
  devices: readonly ResolvedDevice[],
  space: RoutingSpace,
  radiusM: number,
) {
  const { columns, cells } = emptyBlockedVoxels();
  const bounds = gridBounds(space);
  devices.forEach((device) => {
    if (isBodylessPresentation(device)) return;
    if (!deviceBelongsToRoutingSpace(device, space)) return;
    const half = worldHalfExtents(device);
    if (device.position[0] + half[0] < space.min[0] || device.position[0] - half[0] > space.max[0]) return;
    if (device.position[1] + half[1] < space.min[1] || device.position[1] - half[1] > space.max[1]) return;
    // Grid coordinates represent cable centre points, not voxel volumes. Mark
    // exactly the centres inside the radius-expanded body. floor(min)/ceil(max)
    // added a whole cell on every face and made a geometrically clear 20 mm
    // terminal escape appear embedded in its neighbour.
    const minX = Math.max(0, Math.ceil((device.position[0] - half[0] - radiusM - space.min[0] - 1e-9) / space.cell));
    const maxX = Math.min(bounds[0], Math.floor((device.position[0] + half[0] + radiusM - space.min[0] + 1e-9) / space.cell));
    const minY = Math.max(0, Math.ceil((device.position[1] - half[1] - radiusM - space.min[1] - 1e-9) / space.cell));
    const maxY = Math.min(bounds[1], Math.floor((device.position[1] + half[1] + radiusM - space.min[1] + 1e-9) / space.cell));
    const blocksWholeColumn = blocksRoutingColumn(device, devices);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        if (blocksWholeColumn) addDeviceObstacle(columns, `${x},${y}`, device.id);
      }
    }
    if (!blocksWholeColumn) {
      const minZ = Math.max(0, Math.ceil((device.position[2] - half[2] - radiusM - space.min[2] - 1e-9) / space.cell));
      const maxZ = Math.min(bounds[2], Math.floor((device.position[2] + half[2] + radiusM - space.min[2] + 1e-9) / space.cell));
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            const point = fromGrid([x, y, z], space);
            const local = deviceLocalPoint(device, point);
            if (
              Math.abs(local[0]) <= device.size[0] / 2 + radiusM
              && Math.abs(local[1]) <= device.size[1] / 2 + radiusM
              && Math.abs(local[2]) <= device.size[2] / 2 + radiusM
            ) addDeviceObstacle(cells, gridKey([x, y, z]), device.id);
          }
        }
      }
    }
  });

  if (isWorldRoutingSpace(space)) {
    const wallHalf = EQUIPMENT_WALL_VOLUME.size.map((value) => value / 2) as unknown as Vec3;
    const minimum = EQUIPMENT_WALL_VOLUME.center.map((value, axis) => value - wallHalf[axis] - radiusM) as unknown as Vec3;
    const maximum = EQUIPMENT_WALL_VOLUME.center.map((value, axis) => value + wallHalf[axis] + radiusM) as unknown as Vec3;
    const minimumGrid = minimum.map((value, axis) => Math.max(
      0,
      Math.ceil((value - space.min[axis] - 1e-9) / space.cell),
    )) as unknown as GridPoint;
    const maximumGrid = maximum.map((value, axis) => Math.min(
      bounds[axis],
      Math.floor((value - space.min[axis] + 1e-9) / space.cell),
    )) as unknown as GridPoint;
    const apertures = devices.filter((device) => (
      device.placement.space === "world" && device.presentation === "wall-passthrough"
    ));
    for (let x = minimumGrid[0]; x <= maximumGrid[0]; x += 1) {
      for (let y = minimumGrid[1]; y <= maximumGrid[1]; y += 1) {
        for (let z = minimumGrid[2]; z <= maximumGrid[2]; z += 1) {
          const point = fromGrid([x, y, z], space);
          const throughAperture = apertures.some((aperture) => {
            const local = deviceLocalPoint(aperture, point);
            return Math.abs(local[0]) <= Math.max(0, aperture.size[0] / 2 - radiusM)
              && Math.abs(local[1]) <= Math.max(0, aperture.size[1] / 2 - radiusM);
          });
          if (!throughAperture) addDeviceObstacle(cells, gridKey([x, y, z]), "equipment-wall");
        }
      }
    }
  }
  return { columns, cells };
}

function aStar(
  startPoint: Vec3,
  endPoint: Vec3,
  space: RoutingSpace,
  diameterMm: number,
  occupancyOwner = "route",
  preferredDepthOverride?: number,
  floorPreference = 1,
  endpointAccess: EndpointAccessMap = new Map(),
  startDirection?: Vec3,
  goalDirection?: Vec3,
  terminalNeighborhoods: readonly { point: Vec3; direction: Vec3 }[] = [],
) {
  const start = toGrid(startPoint, space);
  const goal = toGrid(endPoint, space);
  const bounds = gridBounds(space);
  const searchMargin = isWorldRoutingSpace(space)
    ? Math.max(32, Math.ceil(Math.abs(startPoint[2] - endPoint[2]) / space.cell) + 24)
    : Math.max(bounds[0], bounds[1]);
  const preferredDepthM = preferredDepthOverride ?? (isWorldRoutingSpace(space)
    ? space.worldRegion === "outside" ? -0.080 : 0.020
    : space.min[2] + space.cell);
  const preferredPlane = toGrid([0, 0, preferredDepthM], space)[2];
  const searchMin: GridPoint = [
    Math.max(0, Math.min(start[0], goal[0]) - searchMargin),
    Math.max(0, Math.min(start[1], goal[1]) - searchMargin),
    isWorldRoutingSpace(space)
      ? Math.max(0, Math.min(start[2], goal[2], preferredPlane) - 20)
      : 0,
  ];
  const searchMax: GridPoint = [
    Math.min(bounds[0], Math.max(start[0], goal[0]) + searchMargin),
    Math.min(bounds[1], Math.max(start[1], goal[1]) + searchMargin),
    isWorldRoutingSpace(space)
      ? Math.min(bounds[2], Math.max(start[2], goal[2], preferredPlane) + 20)
      : bounds[2],
  ];
  const radiusM = Math.max(space.cell * 0.15, diameterMm / 2000);
  const blocked = space.blockedByRadius.get(radiusM.toFixed(6)) ?? emptyBlockedVoxels();
  // A turn may not immediately follow another turn when the shared leg is too
  // short to carry two radius-safe fillets. Run length is part of the state so
  // this remains a routing rule rather than a post-route repair.
  const requiredRenderedRadiusM = diameterMm / 2000 * 1.1 + ROUTING_CABLE_CLEARANCE_M;
  const minimumRunCells = Math.max(1, Math.ceil(requiredRenderedRadiusM / 0.48 / space.cell - 1e-9));
  type SearchNode = { point: GridPoint; direction: number; run: number };
  const open = new MinHeap<SearchNode>();
  const startKey = gridKey(start);
  const goalKey = gridKey(goal);
  const cameFrom = new Map<string, string>();
  const nodeKey = (node: SearchNode) => `${gridKey(node.point)}|${node.direction}|${node.run}`;
  const startNode: SearchNode = { point: start, direction: -1, run: minimumRunCells };
  const startNodeKey = nodeKey(startNode);
  const nodeByKey = new Map<string, SearchNode>([[startNodeKey, startNode]]);
  const cost = new Map<string, number>([[startNodeKey, 0]]);
  const closed = new Set<string>();
  const heuristic = (point: GridPoint) => (
    Math.abs(point[0] - goal[0]) + Math.abs(point[1] - goal[1]) + Math.abs(point[2] - goal[2]) * 5
  );
  open.push(startNode, heuristic(start));
  const neighbors: readonly GridPoint[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const startUnavailable = isBlockedByDevice(blocked, start, space, endpointAccess)
    || hasNearbyCableConflict(start, space, diameterMm, occupancyOwner, "both");
  const goalUnavailable = isBlockedByDevice(blocked, goal, space, endpointAccess)
    || hasNearbyCableConflict(goal, space, diameterMm, occupancyOwner, "both");
  if (startUnavailable || goalUnavailable) {
    const unavailablePoint = startUnavailable ? start : goal;
    const unavailableKey = gridKey(unavailablePoint);
    const conflictDetails = [
      ...blockedDeviceLabels(blocked, unavailablePoint, space, endpointAccess).map((deviceId) => `device:${deviceId}`),
      ...(space.occupied.get(unavailableKey) && space.occupied.get(unavailableKey) !== occupancyOwner
        ? [`wire:${space.occupied.get(unavailableKey)}`] : []),
      ...[...(space.reserved.get(unavailableKey) ?? [])].filter((owner) => owner !== occupancyOwner).map((owner) => `reserved:${owner}`),
      ...[...(space.fixedReserved.get(unavailableKey) ?? [])].filter((owner) => owner !== occupancyOwner).map((owner) => `fixed:${owner}`),
    ];
    routingFailureDiagnostics.push({
      owner: occupancyOwner,
      space: space.key,
      expansions: 0,
      reason: `${startUnavailable ? `start ${startKey}` : `goal ${goalKey}`} conflicts with ${conflictDetails.join("+") || "nearby swept cable clearance"}`,
    });
    return null;
  }
  let expansions = 0;
  // Enclosure solves are offline and now use a true-radius routing margin.
  // A compact, populated box can have many valid depth states; cap generously
  // so the precompute finds one instead of falling back (the browser never
  // pays this cost).
  const maxExpansions = isWorldRoutingSpace(space) ? 2_000_000 : 900_000;

  while (open.size > 0 && expansions < maxExpansions) {
    const currentNode = open.pop()!;
    const current = currentNode.point;
    const currentNodeKey = nodeKey(currentNode);
    const currentPointKey = gridKey(current);
    if (closed.has(currentNodeKey)) continue;
    closed.add(currentNodeKey);
    if (currentPointKey === goalKey) {
      const reversed: GridPoint[] = [current];
      let cursor = currentNodeKey;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        reversed.push(nodeByKey.get(cursor)!.point);
      }
      const gridPoints = reversed.reverse().map((point) => fromGrid(point, space));
      // Callers hand A* integer-grid escape points. The returned path therefore
      // needs no sub-voxel bridge or endpoint repair.
      // On the 10 mm enclosure grid the search state already certifies the
      // minimum straight run between turns. Preserve that proof; a later
      // string-pull could reintroduce an uncertified one-cell elbow.
      return space.cell <= GEOMETRY_UNIT_M + 1e-9
        ? simplify(gridPoints)
        : stringPullOrthogonal(
          gridPoints,
          space,
          diameterMm,
          occupancyOwner,
          preferredDepthM,
          endpointAccess,
          startDirection,
          goalDirection,
          terminalNeighborhoods,
        );
    }
    expansions += 1;
    for (let direction = 0; direction < neighbors.length; direction += 1) {
      const delta = neighbors[direction];
      const next: GridPoint = [current[0] + delta[0], current[1] + delta[1], current[2] + delta[2]];
      if (next[0] < searchMin[0] || next[1] < searchMin[1] || next[2] < searchMin[2] || next[0] > searchMax[0] || next[1] > searchMax[1] || next[2] > searchMax[2]) continue;
      const nextPointKey = gridKey(next);
      if (currentPointKey === startKey && startDirection && dot(delta as Vec3, startDirection) < -1e-9) continue;
      if (nextPointKey === goalKey && goalDirection && dot(delta as Vec3, goalDirection) > 1e-9) continue;
      if (currentNode.direction >= 0 && currentNode.direction !== direction && currentNode.run < minimumRunCells) continue;
      if (
        isBlockedByDevice(blocked, next, space, endpointAccess) ||
        hasNearbyCableConflict(
          next,
          space,
          diameterMm,
          occupancyOwner,
          "both",
        )
      ) continue;
      const world = fromGrid(next, space);
      if (isWorldRoutingSpace(space)) {
        const noReverseRadius = space.cell * 3;
        if (
          startDirection
          && dot(subtract(world, startPoint), startDirection) < -1e-9
          && distance(world, startPoint) < noReverseRadius - 1e-9
        ) continue;
        if (
          goalDirection
          && dot(subtract(world, endPoint), goalDirection) < -1e-9
          && distance(world, endPoint) < noReverseRadius - 1e-9
        ) continue;
        if (terminalNeighborhoods.some((terminal) => (
          distance(world, terminal.point) < noReverseRadius - 1e-9
          && dot(subtract(world, terminal.point), terminal.direction) < -1e-9
        ))) continue;
      }
      // Long runs hug the mounting plane. Height is only a tie-breaker, so a
      // cable still rises directly when that is the shortest unobstructed run.
      const depthPenalty = isWorldRoutingSpace(space)
        ? 1 + Math.abs(world[2] - preferredDepthM) * 72
        : 1 + Math.abs(world[2] - preferredDepthM) * 18;
      const floorPenalty = isWorldRoutingSpace(space)
        ? Math.max(0, world[1] - Math.max(0, space.min[1])) * 0.018 * floorPreference
        : Math.max(0, world[1] - space.min[1]) * 0.010;
      // Direction is part of the search state, so this is a true bend cost—not
      // a post-process guess. Six movement units makes a clean depth-lane
      // transition preferable to dozens of small lateral dodges without
      // overwhelming device clearance or the mounting-plane preference.
      const turnPenalty = currentNode.direction >= 0 && currentNode.direction !== direction ? 6 : 0;
      const movement = (delta[2] === 0 ? depthPenalty : 8 + depthPenalty) + floorPenalty + turnPenalty;
      const tentative = (cost.get(currentNodeKey) ?? Number.POSITIVE_INFINITY) + movement;
      const nextNode: SearchNode = {
        point: next,
        direction,
        run: currentNode.direction === direction
          ? Math.min(minimumRunCells, currentNode.run + 1)
          : 1,
      };
      const nextNodeKey = nodeKey(nextNode);
      if (tentative >= (cost.get(nextNodeKey) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(nextNodeKey, currentNodeKey);
      nodeByKey.set(nextNodeKey, nextNode);
      cost.set(nextNodeKey, tentative);
      // Weighted A* is intentional here: the cost field still strongly prefers
      // the wall plane, while the weight prevents long roof/ceiling drops from
      // spending seconds exploring equivalent lateral voxels.
      open.push(nextNode, tentative + heuristic(next) * 8);
    }
  }
  routingFailureDiagnostics.push({
    owner: occupancyOwner,
    space: space.key,
    expansions,
    reason: open.size === 0
      ? `no open voxel from ${startKey}; ${neighbors.map((delta) => {
        const next: GridPoint = [start[0] + delta[0], start[1] + delta[1], start[2] + delta[2]];
        const key = gridKey(next);
        const flags = [
          isBlockedByDevice(blocked, next, space, endpointAccess)
            ? `device:${blockedDeviceLabels(blocked, next, space, endpointAccess).join("+")}`
            : "",
          space.occupied.get(key) ? `wire:${space.occupied.get(key)}` : "",
          space.reserved.get(key) && !space.reserved.get(key)!.has(occupancyOwner) ? "reserved" : "",
        ].filter(Boolean).join("+");
        return `${key}=${flags || "search-bound"}`;
      }).join(", ")}${startDirection ? `; ingress-neighbours ${neighbors.map((delta) => {
        const ingress: GridPoint = [
          start[0] + Math.round(startDirection[0]),
          start[1] + Math.round(startDirection[1]),
          start[2] + Math.round(startDirection[2]),
        ];
        const next: GridPoint = [ingress[0] + delta[0], ingress[1] + delta[1], ingress[2] + delta[2]];
        const key = gridKey(next);
        const flags = [
          isBlockedByDevice(blocked, next, space, endpointAccess)
            ? `device:${blockedDeviceLabels(blocked, next, space, endpointAccess).join("+")}` : "",
          space.occupied.get(key) ? `wire:${space.occupied.get(key)}` : "",
          space.reserved.get(key) && !space.reserved.get(key)!.has(occupancyOwner) ? "reserved" : "",
          space.fixedReserved.get(key) && !space.fixedReserved.get(key)!.has(occupancyOwner) ? "fixed" : "",
        ].filter(Boolean).join("+");
        return `${key}=${flags || "open"}`;
      }).join(", ")}` : ""}; goal-neighbours ${neighbors.map((delta) => {
        const next: GridPoint = [goal[0] + delta[0], goal[1] + delta[1], goal[2] + delta[2]];
        const key = gridKey(next);
        const flags = [
          isBlockedByDevice(blocked, next, space, endpointAccess)
            ? `device:${blockedDeviceLabels(blocked, next, space, endpointAccess).join("+")}` : "",
          space.occupied.get(key) ? `wire:${space.occupied.get(key)}` : "",
          space.reserved.get(key) && !space.reserved.get(key)!.has(occupancyOwner) ? "reserved" : "",
          space.fixedReserved.get(key) && !space.fixedReserved.get(key)!.has(occupancyOwner) ? "fixed" : "",
        ].filter(Boolean).join("+");
        return `${key}=${flags || "open"}`;
      }).join(", ")}`
      : `expansion limit; goal-neighbours ${neighbors.map((delta) => {
        const next: GridPoint = [goal[0] + delta[0], goal[1] + delta[1], goal[2] + delta[2]];
        const key = gridKey(next);
        const flags = [
          isBlockedByDevice(blocked, next, space, endpointAccess)
            ? `device:${blockedDeviceLabels(blocked, next, space, endpointAccess).join("+")}`
            : "",
          space.occupied.get(key) ? `wire:${space.occupied.get(key)}` : "",
          space.reserved.get(key) && !space.reserved.get(key)!.has(occupancyOwner) ? "reserved" : "",
          space.fixedReserved.get(key) && !space.fixedReserved.get(key)!.has(occupancyOwner) ? "fixed" : "",
        ].filter(Boolean).join("+");
        return `${key}=${flags || "open"}`;
      }).join(", ")}`,
  });
  return null;
}

/**
 * Decompose a world route around the mounting plane before invoking A*. This
 * is not a device exception: every wall/ceiling/outdoor cable uses the same
 * rule. It removes a large volume of equivalent high-depth states while still
 * letting each leg avoid already-routed cables and every blocked device cell.
 */
function aStarWorld(
  start: Vec3,
  end: Vec3,
  space: RoutingSpace,
  diameterMm: number,
  owner: string,
  preferredWallDepth = 0.020,
  endpointAccess: EndpointAccessMap = new Map(),
  startDirection?: Vec3,
  endDirection?: Vec3,
) {
  const terminalNeighborhoods = [
    ...(startDirection ? [{ point: start, direction: startDirection }] : []),
    ...(endDirection ? [{ point: end, direction: endDirection }] : []),
  ];
  const respectsTerminalNeighborhood = (
    points: readonly Vec3[],
    reference: Vec3,
    outwardDirection?: Vec3,
  ) => !outwardDirection || points.every((point) => (
    distance(point, reference) >= space.cell * 3 - 1e-9
    || dot(subtract(point, reference), outwardDirection) >= -1e-9
  ));
  const bothRemoteOnOneSurface = Math.abs(start[2]) > 0.20
    && Math.abs(end[2]) > 0.20
    && Math.sign(start[2]) === Math.sign(end[2]);
  if (bothRemoteOnOneSurface) {
    // Nearby floor-mounted terminals stay in their shared depth plane. This
    // naturally produces an up-over-down series jumper instead of saving a
    // few cost units by diving toward the wall and returning.
    const remotePlane = snapRoutingScalar(Math.abs(start[2] - end[2]) < 0.06
      ? (start[2] + end[2]) / 2
      : start[2] < 0
        ? Math.max(start[2], end[2]) + 0.10
        : Math.min(start[2], end[2]) - 0.10);
    return aStar(
      start,
      end,
      space,
      diameterMm,
      owner,
      remotePlane,
      space.worldRegion === "outside" ? 120 : 1,
      endpointAccess,
      startDirection,
      endDirection,
      terminalNeighborhoods,
    );
  }
  const outsideRoute = space.worldRegion === "outside";
  const plane = outsideRoute
    ? -ceilRoutingScalar(preferredWallDepth)
    : snapRoutingScalar(preferredWallDepth);
  const outsideFloorPreference = outsideRoute ? 120 : 1;
  const fieldPathCost = (points: readonly Vec3[]) => {
    let total = 0;
    let previousAxis = -1;
    for (let index = 1; index < points.length; index += 1) {
      const startPoint = points[index - 1];
      const endPoint = points[index];
      const axis = [0, 1, 2].find((candidate) => Math.abs(endPoint[candidate] - startPoint[candidate]) > 1e-9);
      if (axis === undefined) continue;
      const steps = Math.max(1, Math.round(distance(startPoint, endPoint) / space.cell));
      for (let step = 1; step <= steps; step += 1) {
        const fraction = step / steps;
        const world: Vec3 = [0, 1, 2].map((coordinate) => (
          startPoint[coordinate] + (endPoint[coordinate] - startPoint[coordinate]) * fraction
        )) as unknown as Vec3;
        const depthPenalty = 1 + Math.abs(world[2] - plane) * 72;
        const floorPenalty = Math.max(0, world[1] - Math.max(0, space.min[1])) * 0.018 * outsideFloorPreference;
        total += (axis === 2 ? 8 + depthPenalty : depthPenalty) + floorPenalty;
      }
      if (previousAxis >= 0 && previousAxis !== axis) total += 6;
      previousAxis = axis;
    }
    return total;
  };
  const localCandidates = orthogonalCandidates(start, end)
    .filter((candidate) => pathClear(candidate, space, diameterMm, owner, endpointAccess))
    .filter((candidate) => respectsTerminalNeighborhood(candidate, start, startDirection))
    .filter((candidate) => respectsTerminalNeighborhood(candidate, end, endDirection))
    .filter((candidate) => {
      const firstStep: Vec3 = candidate.length > 1 ? [
        candidate[1][0] - candidate[0][0],
        candidate[1][1] - candidate[0][1],
        candidate[1][2] - candidate[0][2],
      ] : [0, 0, 0];
      const lastStep: Vec3 = candidate.length > 1 ? [
        candidate.at(-1)![0] - candidate.at(-2)![0],
        candidate.at(-1)![1] - candidate.at(-2)![1],
        candidate.at(-1)![2] - candidate.at(-2)![2],
      ] : [0, 0, 0];
      return (!startDirection || dot(firstStep, startDirection) >= -1e-9)
        && (!endDirection || dot(lastStep, endDirection) <= 1e-9);
    })
    .toSorted((first, second) => fieldPathCost(first) - fieldPathCost(second) || first.length - second.length);
  if (localCandidates.length > 0) {
    const startOnPlane: Vec3 = [start[0], start[1], plane];
    const endOnPlane: Vec3 = [end[0], end[1], plane];
    const wallLowerBound = Math.min(...orthogonalCandidates(startOnPlane, endOnPlane).map((middle) => (
      fieldPathCost(simplify([start, startOnPlane, ...middle.slice(1, -1), endOnPlane, end]))
    )));
    if (fieldPathCost(localCandidates[0]) <= wallLowerBound + 1e-9) return localCandidates[0];
  }
  const selectClearPlaneAnchor = (reference: Vec3, outwardDirection?: Vec3): Vec3 => {
    const base = toGrid([reference[0], reference[1], plane], space);
    const bounds = gridBounds(space);
    const radiusM = Math.max(space.cell * 0.15, diameterMm / 2000);
    const blocked = space.blockedByRadius.get(radiusM.toFixed(6)) ?? emptyBlockedVoxels();
    const offsets: Array<readonly [number, number]> = [];
    for (let radius = 0; radius <= 6; radius += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        for (let y = -radius; y <= radius; y += 1) {
          if (Math.abs(x) + Math.abs(y) !== radius) continue;
          offsets.push([x, y]);
        }
      }
    }
    offsets.sort((first, second) => (
      Math.abs(first[0]) + Math.abs(first[1]) - Math.abs(second[0]) - Math.abs(second[1])
      // At equal distance, prefer the route closer to the floor.
      || (first[1] > 0 ? 1 : 0) - (second[1] > 0 ? 1 : 0)
      || Math.abs(first[0]) - Math.abs(second[0])
      || first[0] - second[0]
    ));
    for (const [offsetX, offsetY] of offsets) {
      const point: GridPoint = [base[0] + offsetX, base[1] + offsetY, base[2]];
      if (point[0] < 0 || point[1] < 0 || point[2] < 0 || point[0] > bounds[0] || point[1] > bounds[1] || point[2] > bounds[2]) continue;
      const world = fromGrid(point, space);
      if (outwardDirection && dot([
        world[0] - reference[0],
        world[1] - reference[1],
        world[2] - reference[2],
      ], outwardDirection) < -1e-9) continue;
      if (
        isBlockedByDevice(blocked, point, space, endpointAccess)
        || hasNearbyCableConflict(point, space, diameterMm, owner)
      ) continue;
      return world;
    }
    // If every preferred-plane candidate would reverse through the mandatory
    // terminal launch (or is physically blocked), keep the already-clear
    // escape point. The following shared leg can transition depth elsewhere;
    // inventing a blocked fallback anchor would recreate an out-and-back kink.
    return reference;
  };
  const startAnchor = selectClearPlaneAnchor(start, startDirection);
  const endAnchor = selectClearPlaneAnchor(end, endDirection);
  const legs: Array<readonly [Vec3, Vec3]> = [];
  if (distance(start, startAnchor) > space.cell * 0.25) legs.push([start, startAnchor]);
  if (distance(startAnchor, endAnchor) > space.cell * 0.25) legs.push([startAnchor, endAnchor]);
  if (distance(endAnchor, end) > space.cell * 0.25) legs.push([endAnchor, end]);
  if (legs.length === 0) return [start, end];
  const routed: Vec3[] = [];
  for (let legIndex = 0; legIndex < legs.length; legIndex += 1) {
    const [legStart, legEnd] = legs[legIndex];
    const reverseRemoteArrival = Math.abs(legEnd[2] - plane) > 0.20 && Math.abs(legStart[2] - plane) <= 0.20;
    const directLeg = orthogonalCandidates(legStart, legEnd)
      .filter((candidate) => pathClear(candidate, space, diameterMm, owner, endpointAccess))
      .filter((candidate) => respectsTerminalNeighborhood(candidate, start, startDirection))
      .filter((candidate) => respectsTerminalNeighborhood(candidate, end, endDirection))
      .filter((candidate) => respectsTerminalNeighborhood(
        candidate,
        legStart,
        legIndex === 0 ? startDirection : undefined,
      ))
      .filter((candidate) => respectsTerminalNeighborhood(
        candidate,
        legEnd,
        legIndex === legs.length - 1 ? endDirection : undefined,
      ))
      .filter((candidate) => {
        const terminalStartDirection = legIndex === 0 ? startDirection : undefined;
        const terminalEndDirection = legIndex === legs.length - 1 ? endDirection : undefined;
        const firstStep: Vec3 = candidate.length > 1 ? [
          candidate[1][0] - candidate[0][0], candidate[1][1] - candidate[0][1], candidate[1][2] - candidate[0][2],
        ] : [0, 0, 0];
        const lastStep: Vec3 = candidate.length > 1 ? [
          candidate.at(-1)![0] - candidate.at(-2)![0],
          candidate.at(-1)![1] - candidate.at(-2)![1],
          candidate.at(-1)![2] - candidate.at(-2)![2],
        ] : [0, 0, 0];
        return (!terminalStartDirection || dot(firstStep, terminalStartDirection) >= -1e-9)
          && (!terminalEndDirection || dot(lastStep, terminalEndDirection) <= 1e-9);
      })
      .toSorted((first, second) => {
        const length = (candidate: readonly Vec3[]) => candidate.slice(1)
          .reduce((sum, point, index) => sum + distance(candidate[index], point), 0);
        return length(first) - length(second) || first.length - second.length;
      })[0];
    const solvedLeg = directLeg ?? (reverseRemoteArrival
      ? aStar(
        legEnd, legStart, space, diameterMm, owner, plane, outsideFloorPreference, endpointAccess,
        legIndex === legs.length - 1 ? endDirection : undefined,
        undefined,
        terminalNeighborhoods,
      )
      : aStar(
        legStart, legEnd, space, diameterMm, owner, plane, outsideFloorPreference, endpointAccess,
        legIndex === 0 ? startDirection : undefined,
        legIndex === legs.length - 1 ? endDirection : undefined,
        terminalNeighborhoods,
      ));
    const leg = directLeg ? directLeg : reverseRemoteArrival ? solvedLeg?.toReversed() ?? null : solvedLeg;
    if (!leg) {
      const failure = routingFailureDiagnostics.at(-1);
      if (failure?.owner === owner) {
        failure.reason = `world leg ${legIndex + 1}/${legs.length} ${legStart.map((value) => value.toFixed(3)).join(",")} → ${legEnd.map((value) => value.toFixed(3)).join(",")}: ${failure.reason}`;
      }
      return null;
    }
    routed.push(...(routed.length === 0 ? leg : leg.slice(1)));
  }
  return simplify(routed);
}

/** Small public seam used by the fast graph tests and routing benchmark. */
export function routeVoxelForTest(start: Vec3, end: Vec3, cell = 0.045) {
  const margin = Math.max(0.18, cell * 4);
  const space = createRoutingSpace(
    "test",
    Math.max(1, geometryUnits(cell)),
    [Math.min(start[0], end[0]) - margin, Math.min(start[1], end[1]) - margin, Math.min(start[2], end[2]) - margin],
    [Math.max(start[0], end[0]) + margin, Math.max(start[1], end[1]) + margin, Math.max(start[2], end[2]) + margin],
    0,
  );
  return aStar(start, end, space, 3);
}

function markOccupied(
  points: readonly Vec3[],
  space: RoutingSpace,
  diameterMm: number,
  occupancyOwner: string,
  rotatedTerminalAdapter = false,
) {
  const radius = 0;
  space.ownerDiameterMm.set(occupancyOwner, diameterMm);
  for (let index = 1; index < points.length; index += 1) {
    const start = isRouteGridPoint(points[index - 1], space)
      ? toGrid(points[index - 1], space)
      : rotatedTerminalAdapter ? nearestGrid(points[index - 1], space) : toGrid(points[index - 1], space);
    const end = isRouteGridPoint(points[index], space)
      ? toGrid(points[index], space)
      : rotatedTerminalAdapter ? nearestGrid(points[index], space) : toGrid(points[index], space);
    const steps = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]), Math.abs(end[2] - start[2]), 1);
    for (let step = 0; step <= steps; step += 1) {
      const fraction = step / steps;
      const point: GridPoint = [
        Math.round(start[0] + (end[0] - start[0]) * fraction),
        Math.round(start[1] + (end[1] - start[1]) * fraction),
        Math.round(start[2] + (end[2] - start[2]) * fraction),
      ];
      for (let x = -radius; x <= radius; x += 1) for (let y = -radius; y <= radius; y += 1) for (let z = -radius; z <= radius; z += 1) {
        const key = gridKey([point[0] + x, point[1] + y, point[2] + z]);
        if (!space.occupied.has(key)) space.occupied.set(key, occupancyOwner);
      }
    }
  }
}

function reserveLine(
  points: readonly Vec3[],
  space: RoutingSpace,
  owner: string,
  diameterMm = 0,
  fixed = false,
  rotatedTerminalAdapter = false,
) {
  const radius = 0;
  space.ownerDiameterMm.set(owner, diameterMm);
  for (let index = 1; index < points.length; index += 1) {
    const start = isRouteGridPoint(points[index - 1], space)
      ? toGrid(points[index - 1], space)
      : rotatedTerminalAdapter ? nearestGrid(points[index - 1], space) : toGrid(points[index - 1], space);
    const end = isRouteGridPoint(points[index], space)
      ? toGrid(points[index], space)
      : rotatedTerminalAdapter ? nearestGrid(points[index], space) : toGrid(points[index], space);
    const steps = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]), Math.abs(end[2] - start[2]), 1);
    for (let step = 0; step <= steps; step += 1) {
      const fraction = step / steps;
      const key = gridKey([
        Math.round(start[0] + (end[0] - start[0]) * fraction),
        Math.round(start[1] + (end[1] - start[1]) * fraction),
        Math.round(start[2] + (end[2] - start[2]) * fraction),
      ]);
      const [cx, cy, cz] = key.split(",").map(Number);
      for (let x = -radius; x <= radius; x += 1) for (let y = -radius; y <= radius; y += 1) for (let z = -radius; z <= radius; z += 1) {
        const expandedKey = gridKey([cx + x, cy + y, cz + z]);
        const reservations = fixed ? space.fixedReserved : space.reserved;
        const owners = reservations.get(expandedKey) ?? new Set<string>();
        owners.add(owner);
        reservations.set(expandedKey, owners);
      }
    }
  }
}

function terminalApproach(
  conductor: ResolvedConductor,
  device: ResolvedDevice,
  clearance: number,
  space: RoutingSpace,
): Vec3[] {
  let effectiveClearance = ceilRoutingScalar(clearance);
  if (!isWorldRoutingSpace(space)) {
    for (let axis = 0; axis < 3; axis += 1) {
      const direction = conductor.direction[axis];
      if (Math.abs(direction) < 1e-8) continue;
      const distanceToBoundary = direction > 0
        ? (space.max[axis] - conductor.position[axis]) / direction
        : (space.min[axis] - conductor.position[axis]) / direction;
      const availableCells = Math.floor((distanceToBoundary - space.cell + 1e-9) / space.cell);
      effectiveClearance = Math.min(effectiveClearance, Math.max(space.cell, availableCells * space.cell));
    }
  }
  const localTerminal = deviceLocalPoint(device, conductor.position);
  const axialLocal = add(localTerminal, scale(directionByFace[conductor.face], effectiveClearance));
  const axial = worldPoint(device, axialLocal);
  const points: Vec3[] = [conductor.position, axial];
  const escape = axial;

  const axisAligned = conductor.direction.filter((value) => Math.abs(value) > 1e-9).length === 1;
  if (axisAligned) {
    // Ordinary equipment begins and ends on the exact 20 mm A* lattice, which
    // is an integer stride over the shared 10 mm geometry coordinates. No
    // correction bridge exists.
    toGrid(conductor.position, space);
    toGrid(axial, space);
    toGrid(escape, space);
    return simplify(points);
  }

  // A genuinely rotated roof/ceiling terminal cannot share a Cartesian voxel
  // while still touching its oriented device face. It gets one explicit clean
  // adapter after the exact tangent lead; every subsequent point is on-grid.
  const gridEscape = outwardGridAdapter(escape, conductor.direction, space);
  if (distance(escape, gridEscape) > 1e-9) points.push(gridEscape);
  return simplify(points);
}

function terminalClearance(device: ResolvedDevice, conductor: ResolvedConductor, outsideDiameterMm: number) {
  // The explicit terminal-to-A* seam is one exact route cell for side/top/
  // bottom faces and two for a projected front/back wall column.
  const cells = device.placement.space === "junction"
    ? 1
    : conductor.face === "front" || conductor.face === "back" ? 2 : 1;
  return ceilRoutingScalar(Math.max(
    geometryMetres(ROUTING_STEP_UNITS * cells),
    outsideDiameterMm / 2000 + ROUTING_CABLE_CLEARANCE_M,
  ));
}

function protectedTerminalClearance(device: ResolvedDevice, conductor: ResolvedConductor, outsideDiameterMm: number) {
  return terminalClearance(device, conductor, outsideDiameterMm) + geometryMetres(ROUTING_STEP_UNITS);
}

function protectedTerminalLaunch(
  conductor: ResolvedConductor,
  device: ResolvedDevice,
  space: RoutingSpace,
  outsideDiameterMm: number,
) {
  const approach = terminalApproach(
    conductor,
    device,
    terminalClearance(device, conductor, outsideDiameterMm),
    space,
  );
  const escape = approach.at(-1)!;
  if (isAxisAlignedVector(conductor.direction)) {
    const ingress = add(escape, scale(conductor.direction, geometryMetres(ROUTING_STEP_UNITS)));
    const insideRoutingBounds = ingress.every((value, axis) => (
      value >= space.min[axis] - 1e-9 && value <= space.max[axis] + 1e-9
    ));
    return insideRoutingBounds ? [...approach, ingress] : approach;
  }
  // Rotated roof terminals already use their one tangent→grid adapter. Extend
  // that adapter by one grid cell along the dominant positive tangent axis so
  // the future route still owns a legal serial ingress cell.
  const dominantAxis = [0, 1, 2].toSorted((first, second) => (
    Math.abs(conductor.direction[second]) - Math.abs(conductor.direction[first])
  ))[0];
  const ingress = [...escape] as [number, number, number];
  ingress[dominantAxis] += Math.sign(conductor.direction[dominantAxis]) * space.cell;
  return [...approach, ingress as Vec3];
}

function routingIngressDirection(
  conductor: ResolvedConductor,
  space: RoutingSpace,
  escape: Vec3,
): Vec3 | undefined {
  let direction: Vec3;
  if (isAxisAlignedVector(conductor.direction)) direction = conductor.direction;
  else {
  const dominantAxis = [0, 1, 2].toSorted((first, second) => (
    Math.abs(conductor.direction[second]) - Math.abs(conductor.direction[first])
  ))[0];
  const result: [number, number, number] = [0, 0, 0];
  result[dominantAxis] = Math.sign(conductor.direction[dominantAxis]);
    direction = result;
  }
  const next = add(escape, scale(direction, space.cell));
  return next.every((value, axis) => (
    value >= space.min[axis] - 1e-9 && value <= space.max[axis] + 1e-9
  )) ? direction : undefined;
}

function terminalApproachDeviceConflict(
  points: readonly Vec3[],
  owner: ResolvedDevice,
  devices: readonly ResolvedDevice[],
  outsideDiameterMm: number,
  space: RoutingSpace,
  allowedBodylessDeviceIds: ReadonlySet<string> = new Set(),
) {
  const radius = outsideDiameterMm / 2000 + ROUTING_CABLE_CLEARANCE_M;
  const sharesRoutingSpace = (device: ResolvedDevice) => {
    return deviceBelongsToRoutingSpace(device, space);
  };
  for (const device of devices) {
    if (device.id === owner.id || device.kind === "junction" || !sharesRoutingSpace(device)) continue;
    if (isBodylessPresentation(device) && allowedBodylessDeviceIds.has(device.id)) continue;
    if (isBodylessPresentation(device)) {
      for (const port of device.conductors) {
        const armEnd = terminalPosition(device, port.id);
        const required = radius + (port.terminalDiameterMm ?? 1) / 2000;
        for (let segment = 1; segment < points.length; segment += 1) {
          if (closestSegmentPoints(points[segment - 1], points[segment], device.position, armEnd).distance + 1e-9 < required) {
            return device.id;
          }
        }
      }
      continue;
    }
    const projectedColumn = blocksRoutingColumn(device, devices);
    for (let segment = 1; segment < points.length; segment += 1) {
      const start = points[segment - 1];
      const end = points[segment];
      const steps = Math.max(1, Math.ceil(distance(start, end) / (GEOMETRY_UNIT_M / 2)));
      for (let step = 1; step <= steps; step += 1) {
        const fraction = step / steps;
        const point = [0, 1, 2].map((axis) => start[axis] + (end[axis] - start[axis]) * fraction) as unknown as Vec3;
        const local = deviceLocalPoint(device, point);
        if (
          Math.abs(local[0]) <= device.size[0] / 2 + radius
          && Math.abs(local[1]) <= device.size[1] / 2 + radius
          && (projectedColumn || Math.abs(local[2]) <= device.size[2] / 2 + radius)
        ) return device.id;
      }
    }
  }
  return null;
}

function directMatingPath(from: ResolvedConductor, to: ResolvedConductor) {
  const length = distance(from.position, to.position);
  if (length < 1e-6 || length > 0.080 + 1e-7) return null;
  const direction: Vec3 = [
    (to.position[0] - from.position[0]) / length,
    (to.position[1] - from.position[1]) / length,
    (to.position[2] - from.position[2]) / length,
  ];
  return dot(direction, from.direction) > 0.995 && dot(direction, to.direction) < -0.995
    ? [from.position, to.position] as const
    : null;
}

function glandExternalApproach(
  gland: Gland,
  junction: ResolvedDevice,
  launchDepth: number,
  outsideDiameterMm: number,
): Vec3[] {
  const junctionBottom = snapRoutingScalar(junction.position[1] - junction.size[1] / 2);
  const sweptCells = Math.max(1, Math.ceil(
    (outsideDiameterMm / 2000 + ROUTING_CABLE_CLEARANCE_M) / geometryMetres(ROUTING_STEP_UNITS),
  ));
  // The launch owns the swept-radius clearance below the resolved shell, one
  // completely free routing cell, and one serial ingress cell. Deriving every
  // point from the autosized enclosure bottom prevents a later box resize from
  // leaving a fixed launch trapped in the projected wall obstacle.
  const clearY = junctionBottom - geometryMetres(ROUTING_STEP_UNITS * (sweptCells + 1));
  const ingressY = clearY - geometryMetres(ROUTING_STEP_UNITS);
  return [
    [gland.position[0], junctionBottom - geometryMetres(ROUTING_STEP_UNITS), gland.position[2]],
    [gland.position[0], junctionBottom - geometryMetres(ROUTING_STEP_UNITS), launchDepth],
    [gland.position[0], clearY, launchDepth],
    [gland.position[0], ingressY, launchDepth],
  ];
}

function buildRoutes(
  graph: SystemGraph,
  devices: readonly ResolvedDevice[],
  conductors: readonly ResolvedConductor[],
  glands: readonly Gland[],
) {
  const cableById = new Map(graph.cables.map((cable) => [cable.id, cable]));
  const conductorByKey = new Map(conductors.map((candidate) => [candidate.key, candidate]));
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const glandByConnection = new Map(glands.flatMap((gland) => gland.connectionIds.map((id) => [id, gland] as const)));
  const worldDevices = devices.filter((device) => device.placement.space === "world");
  const worldMin = ([0, 1, 2] as const).map((axis) => Math.min(...worldDevices.map((device) => {
    const half = worldHalfExtents(device);
    return device.position[axis] - half[axis];
  }))) as unknown as Vec3;
  const worldMax = ([0, 1, 2] as const).map((axis) => Math.max(...worldDevices.map((device) => {
    const half = worldHalfExtents(device);
    return device.position[axis] + half[axis];
  }))) as unknown as Vec3;
  const worldMargin: Vec3 = [0.30, 0.20, 0.45];
  const alignedWorldMinUnits = ([0, 1, 2] as const).map((axis) => (
    Math.floor(geometryUnits(worldMin[axis] - worldMargin[axis]) / WORLD_ROUTING_STEP_UNITS) * WORLD_ROUTING_STEP_UNITS
  )) as unknown as GridPoint;
  const alignedWorldMaxUnits = ([0, 1, 2] as const).map((axis) => (
    Math.ceil(geometryUnits(worldMax[axis] + worldMargin[axis]) / WORLD_ROUTING_STEP_UNITS) * WORLD_ROUTING_STEP_UNITS
  )) as unknown as GridPoint;
  const worldSpaceByRegion = new Map<WorldRoutingRegion, RoutingSpace>([
    ["inside", createRoutingSpace(
      "world-inside",
      WORLD_ROUTING_STEP_UNITS,
      vectorMetres(alignedWorldMinUnits),
      vectorMetres(alignedWorldMaxUnits),
      0,
      "inside",
    )],
    ["outside", createRoutingSpace(
      "world-outside",
      WORLD_ROUTING_STEP_UNITS,
      vectorMetres(alignedWorldMinUnits),
      vectorMetres(alignedWorldMaxUnits),
      0,
      "outside",
    )],
  ]);
  const junctionSpaces = new Map(graph.junctions.map((junction) => {
    const container = deviceById.get(junction.deviceId)!;
    // Keep the swept cable body away from the shell, not merely its
    // centreline. The definition's installation padding remains available to
    // devices; this second, generic inset defines the actual routing volume.
    const edgeInset = Math.max(0.012, Math.min(0.020, junction.padding - 0.008));
    const minimum = [
        container.position[0] - container.size[0] / 2 + edgeInset,
        container.position[1] - container.size[1] / 2 + edgeInset,
        container.position[2] - container.size[2] / 2 + 0.010,
      ] as Vec3;
    const maximum = [
        container.position[0] + container.size[0] / 2 - edgeInset,
        container.position[1] + container.size[1] / 2 - edgeInset,
        container.position[2] + container.size[2] / 2 - 0.006,
      ] as Vec3;
    return [junction.deviceId, createRoutingSpace(
      junction.deviceId,
      JUNCTION_ROUTING_STEP_UNITS,
      minimum,
      maximum,
      edgeInset,
    )] as const;
  }));
  const allRoutingSpaces = [...worldSpaceByRegion.values(), ...junctionSpaces.values()];
  allRoutingSpaces.forEach((space) => {
    graph.cables.forEach((cable) => {
      const radius = Math.max(space.cell * 0.15, cable.outsideDiameterMm / 2000);
      const key = radius.toFixed(6);
      if (!space.blockedByRadius.has(key)) space.blockedByRadius.set(key, buildBlockedVoxels(devices, space, radius));
    });
  });
  const routes: RoutedConnection[] = [];
  const preferredWorldDepth = (space: RoutingSpace) => space.worldRegion === "outside" ? -0.080 : 0.020;
  const routingSpaceFor = (port: ResolvedConductor, device: ResolvedDevice) => (
    device.placement.space === "junction"
      ? junctionSpaces.get(device.placement.junctionId)!
      : worldSpaceByRegion.get(conductorWorldRegion(device, port))!
  );
  const connectionById = new Map(graph.connections.map((connection) => [connection.id, connection]));
  const connectionsByEndpoint = new Map<string, SystemGraph["connections"][number][]>();
  graph.connections.forEach((connection) => [connection.from, connection.to].forEach((endpoint) => {
    connectionsByEndpoint.set(endpoint, [...(connectionsByEndpoint.get(endpoint) ?? []), connection]);
  }));
  const sharedLaunchByConnectionEndpoint = new Map<string, Vec3[]>();
  const launchKey = (connectionId: string, endpoint: string) => `${connectionId}|${endpoint}`;

  // A declared stacked/over-capacity terminal is one physical contact, but
  // its cables must become distinct immediately outside the terminal body.
  // Keep the thickest cable on-axis and assign the remaining cables to unique
  // orthogonal tangents. This is derived solely from endpoint multiplicity,
  // cable diameter and available routing bounds—never a device-id exception.
  [...connectionsByEndpoint].filter(([, entries]) => entries.length > 1).forEach(([endpoint, entries]) => {
    const port = conductorByKey.get(endpoint)!;
    const device = deviceById.get(port.deviceId)!;
    const space = routingSpaceFor(port, device);
    const ordered = [...entries].toSorted((first, second) => (
      (cableById.get(second.cableId)?.outsideDiameterMm ?? 0) - (cableById.get(first.cableId)?.outsideDiameterMm ?? 0)
      || first.id.localeCompare(second.id)
    ));
    const normalAxis = [0, 1, 2].toSorted((first, second) => (
      Math.abs(port.direction[second]) - Math.abs(port.direction[first])
    ))[0];
    const tangentAxes = [2, 0, 1].filter((axis) => axis !== normalAxis);
    const tangentDirections = tangentAxes.flatMap((axis) => ([1, -1].map((sign) => {
      const direction: [number, number, number] = [0, 0, 0];
      direction[axis] = sign;
      return direction as Vec3;
    })));
    const usedDirections = new Set<string>();
    ordered.forEach((connection, index) => {
      const cable = cableById.get(connection.cableId)!;
      const base = protectedTerminalLaunch(port, device, space, cable.outsideDiameterMm);
      if (index === 0) {
        sharedLaunchByConnectionEndpoint.set(launchKey(connection.id, endpoint), base);
        return;
      }
      const otherEndpoint = connection.from === endpoint ? connection.to : connection.from;
      const allowedBodyless = new Set([device.id, endpointDeviceId(otherEndpoint)]);
      const fork = base.at(-2)!;
      const ingress = base.at(-1)!;
      const candidate = tangentDirections.map((direction) => {
        const key = direction.join(",");
        const fan = add(fork, scale(direction, space.cell));
        const escape = add(ingress, scale(direction, space.cell));
        const points = [...base.slice(0, -1), fan, escape];
        const inside = points.every((point) => point.every((value, axis) => (
          value >= space.min[axis] - 1e-9 && value <= space.max[axis] + 1e-9
        )));
        const conflict = inside ? terminalApproachDeviceConflict(
          points, device, devices, cable.outsideDiameterMm, space, allowedBodyless,
        ) : "routing-bounds";
        return { key, points, conflict };
      }).find((choice) => !usedDirections.has(choice.key) && !choice.conflict);
      if (!candidate) throw new Error(`${endpoint}: no generic shared-terminal fan direction for ${connection.id}`);
      usedDirections.add(candidate.key);
      sharedLaunchByConnectionEndpoint.set(launchKey(connection.id, endpoint), candidate.points);
    });
  });
  const connectionsByBundle = new Map<string, SystemGraph["connections"][number][]>();
  graph.connections.forEach((connection) => {
    if (!connection.bundleId) return;
    connectionsByBundle.set(connection.bundleId, [...(connectionsByBundle.get(connection.bundleId) ?? []), connection]);
  });
  const crowdedBundleLaunch = (
    connection: SystemGraph["connections"][number],
    port: ResolvedConductor,
    device: ResolvedDevice,
    space: RoutingSpace,
    outsideDiameterMm: number,
  ) => {
    const base = protectedTerminalLaunch(port, device, space, outsideDiameterMm);
    const bundle = connection.bundleId ? connectionsByBundle.get(connection.bundleId) ?? [] : [];
    if (!isWorldRoutingSpace(space) || bundle.length < 2 || base.length < 3) return base;
    const peerPorts = bundle.flatMap((peerConnection) => [peerConnection.from, peerConnection.to])
      .map((endpoint) => conductorByKey.get(endpoint))
      .filter((peer): peer is ResolvedConductor => Boolean(
        peer && peer.deviceId === port.deviceId && peer.face === port.face,
      ));
    if (peerPorts.length < 3) return base;
    const ranges = [0, 1, 2].map((axis) => (
      Math.max(...peerPorts.map((peer) => peer.position[axis])) - Math.min(...peerPorts.map((peer) => peer.position[axis]))
    ));
    const tangentAxis = [0, 1, 2]
      .filter((axis) => Math.abs(port.direction[axis]) < 1e-9)
      .toSorted((first, second) => ranges[second] - ranges[first])[0];
    if (tangentAxis === undefined || ranges[tangentAxis] < space.cell - 1e-9) return base;
    const centre = peerPorts.reduce((sum, peer) => sum + peer.position[tangentAxis], 0) / peerPorts.length;
    const side = Math.sign(port.position[tangentAxis] - centre);
    if (side === 0) return base;
    const fork = base.at(-2)!;
    const ingress = base.at(-1)!;
    const directionCandidates = [
      [tangentAxis, side] as const,
      ...[2, 0, 1].filter((axis) => axis !== tangentAxis && Math.abs(port.direction[axis]) < 1e-9)
        .flatMap((axis) => [[axis, 1] as const, [axis, -1] as const]),
    ];
    for (const [axis, sign] of directionCandidates) {
      const direction: [number, number, number] = [0, 0, 0];
      direction[axis] = sign;
      const blockedByAdjacentOwnerTerminal = device.conductors.some((peer) => {
        if (peer.id === port.id || peerPorts.some((bundlePeer) => bundlePeer.id === peer.id)) return false;
        const position = terminalPosition(device, peer.id);
        const delta = subtract(position, port.position);
        const axial = dot(delta, direction);
        const transverse = Math.hypot(...subtract(delta, scale(direction, axial)));
        return axial > 1e-9 && axial <= space.cell * 1.6 && transverse <= space.cell * 0.75;
      });
      if (blockedByAdjacentOwnerTerminal) continue;
      const points = [
        ...base.slice(0, -1),
        add(fork, scale(direction, space.cell)),
        add(ingress, scale(direction, space.cell)),
      ];
      const inside = points.every((point) => point.every((value, candidateAxis) => (
        value >= space.min[candidateAxis] - 1e-9 && value <= space.max[candidateAxis] + 1e-9
      )));
      if (inside) return points;
    }
    return base;
  };
  const terminalLaunchFor = (
    connection: SystemGraph["connections"][number],
    port: ResolvedConductor,
    device: ResolvedDevice,
    space: RoutingSpace,
    outsideDiameterMm: number,
  ) => sharedLaunchByConnectionEndpoint.get(launchKey(connection.id, port.key))
    ?? crowdedBundleLaunch(connection, port, device, space, outsideDiameterMm);
  const launchGeometry = new Map<string, Vec3[][]>();
  const fixedGeometry = new Map<string, Vec3[][]>();
  const geometryKey = (space: RoutingSpace, owner: string) => `${space.key}|${owner}`;
  const recordGeometry = (target: Map<string, Vec3[][]>, space: RoutingSpace, owner: string, points: readonly Vec3[]) => {
    const key = geometryKey(space, owner);
    target.set(key, [...(target.get(key) ?? []), [...points]]);
  };

  // A rendered Y has no rectangular body. Reserve the actual centre-to-port
  // capsules instead: this protects the selectable internal splice from
  // unrelated wiring without inventing a phantom 40 mm cube around it.
  // External arms begin at the port and move outward, so their A* endpoints
  // remain one full cell beyond this protected internal geometry.
  devices.filter(isBodylessPresentation).forEach((device) => {
    const space = device.placement.space === "junction"
      ? junctionSpaces.get(device.placement.junctionId)!
      : worldSpaceByRegion.get(deviceWorldRegion(device))!;
    const owner = `internal-y:${device.id}`;
    const diameterMm = Math.max(1, ...device.conductors.map((port) => port.terminalDiameterMm ?? 1));
    const rotatedAdapter = !isRouteGridPoint(device.position, space);
    device.conductors.forEach((port) => {
      const internalArm = [device.position, terminalPosition(device, port.id)] as const;
      recordGeometry(fixedGeometry, space, owner, internalArm);
      reserveLine(
        internalArm,
        space,
        owner,
        diameterMm,
        true,
        rotatedAdapter,
      );
    });
  });

  // Before the first solve reserve only each physical tangent plus its one
  // protected ingress cell—not a speculative full route or lane. Completed
  // approaches are occupied immediately after each serial solve, so diameter-
  // descending precedence remains real rather than nominal.
  graph.connections.forEach((connection) => {
    const from = conductorByKey.get(connection.from)!;
    const to = conductorByKey.get(connection.to)!;
    const fromDevice = deviceById.get(from.deviceId)!;
    const toDevice = deviceById.get(to.deviceId)!;
    const cable = cableById.get(connection.cableId)!;
    const owner = connection.id;
    const endpointDeviceIds = new Set([fromDevice.id, toDevice.id]);
    const fromSpace = routingSpaceFor(from, fromDevice);
    const toSpace = routingSpaceFor(to, toDevice);
    const direct = directMatingPath(from, to);
    if (direct && fromSpace === toSpace) {
      recordGeometry(launchGeometry, fromSpace, owner, direct);
      reserveLine(direct, fromSpace, owner, cable.outsideDiameterMm, false, !isAxisAlignedVector(from.direction));
      return;
    }
    const stub = (port: ResolvedConductor, space: RoutingSpace): Vec3[] => {
      const ownerDevice = deviceById.get(port.deviceId)!;
      const approach = terminalLaunchFor(connection, port, ownerDevice, space, cable.outsideDiameterMm);
      const conflict = terminalApproachDeviceConflict(
        approach,
        ownerDevice,
        devices,
        cable.outsideDiameterMm,
        space,
        endpointDeviceIds,
      );
      if (conflict) throw new Error(`${connection.id}: ${port.key} tangent approach intersects ${conflict}`);
      return approach;
    };
    // A bodyless Y is still a physical splice with a routing envelope. Reserve
    // every external arm just like an ordinary terminal; only its own route is
    // allowed through that throat. Rendering style never weakens collision
    // semantics.
    const fromStub = stub(from, fromSpace);
    const toStub = stub(to, toSpace);
    recordGeometry(launchGeometry, fromSpace, owner, fromStub);
    recordGeometry(launchGeometry, toSpace, owner, toStub);
    reserveLine(fromStub, fromSpace, owner, cable.outsideDiameterMm, false, !isAxisAlignedVector(from.direction));
    reserveLine(toStub, toSpace, owner, cable.outsideDiameterMm, false, !isAxisAlignedVector(to.direction));
    const gland = glandByConnection.get(connection.id);
    if (gland) {
      const localSpace = junctionSpaces.get(gland.junctionId)!;
      const junction = deviceById.get(gland.junctionId)!;
      const junctionDefinition = graph.junctions.find((candidate) => candidate.deviceId === gland.junctionId)!;
      const glandIngressCells = junctionDefinition.sizePolicy === "verified-fixed" ? 1 : 2;
      const externalSpace = isWorldRoutingSpace(fromSpace) ? fromSpace : toSpace;
      const glandInside = snapRoutingVec([
        gland.position[0],
        gland.position[1] + geometryMetres(ROUTING_STEP_UNITS * glandIngressCells),
        gland.position[2],
      ]);
      // A gland is another fixed physical terminal. Reserve only its short
      // throat on each side of the shell; the future cable's enclosure/world
      // lanes remain entirely unreserved and cannot displace thick routes.
      const insideThroat = [gland.position, glandInside] as const;
      const outsideThroat = glandExternalApproach(gland, junction, preferredWorldDepth(externalSpace), cable.outsideDiameterMm);
      recordGeometry(fixedGeometry, localSpace, owner, insideThroat);
      recordGeometry(fixedGeometry, externalSpace, owner, outsideThroat);
      reserveLine(insideThroat, localSpace, owner, cable.outsideDiameterMm, true);
      reserveLine(
        outsideThroat,
        externalSpace,
        owner,
        cable.outsideDiameterMm,
        true,
      );
    }
  });

  // Mandatory terminal launches are physical geometry, not suggestions. Two
  // future field wires may never reserve the same cell; the only allowed fixed
  // contact is a route touching its own declared bodyless Y arm endpoint.
  allRoutingSpaces.forEach((space) => {
    const exactGeometryConflict = (
      first: readonly Vec3[][],
      firstDiameterMm: number,
      second: readonly Vec3[][],
      secondDiameterMm: number,
    ) => {
      const required = firstDiameterMm / 2000 + secondDiameterMm / 2000 + ROUTING_CABLE_CLEARANCE_M;
      return first.some((firstPath) => firstPath.slice(1).some((firstEnd, firstIndex) => (
        second.some((secondPath) => secondPath.slice(1).some((secondEnd, secondIndex) => (
          closestSegmentPoints(firstPath[firstIndex], firstEnd, secondPath[secondIndex], secondEnd).distance + 1e-9 < required
        )))
      )));
    };
    for (const [key, owners] of space.reserved) {
      const sharedBodylessEndpoint = devices.find((device) => isBodylessPresentation(device) && (
        [...owners].every((owner) => {
          const connection = connectionById.get(owner);
          return connection && [connection.from, connection.to].some((endpoint) => endpointDeviceId(endpoint) === device.id);
        })
      ));
      const commonEndpoint = owners.size > 1
        ? [...(connectionById.get([...owners][0]) ? [connectionById.get([...owners][0])!.from, connectionById.get([...owners][0])!.to] : [])]
          .find((endpoint) => [...owners].every((owner) => {
            const connection = connectionById.get(owner);
            return connection && (connection.from === endpoint || connection.to === endpoint);
          }))
        : undefined;
      const commonPort = commonEndpoint ? conductorByKey.get(commonEndpoint) : undefined;
      const declaredSharedTerminal = commonPort
        && ["warning", "approved-stack"].includes(commonPort.sharedConnectionPolicy ?? "expand");
      if (owners.size > 1 && !sharedBodylessEndpoint && !declaredSharedTerminal) {
        throw new Error(`${space.key}: mandatory terminal launches overlap at ${key}: ${[...owners].join(", ")}`);
      }
      const fixedOwners = space.fixedReserved.get(key) ?? new Set<string>();
      owners.forEach((owner) => {
        const connection = connectionById.get(owner);
        const allowedFixed = new Set(connection ? [connection.from, connection.to].flatMap((endpoint) => {
          const endpointDevice = deviceById.get(endpointDeviceId(endpoint));
          return endpointDevice && isBodylessPresentation(endpointDevice) ? [`internal-y:${endpointDevice.id}`] : [];
        }) : []);
        fixedOwners.forEach((fixedOwner) => {
          const ownerGeometry = launchGeometry.get(geometryKey(space, owner)) ?? [];
          const obstacleGeometry = fixedGeometry.get(geometryKey(space, fixedOwner)) ?? [];
          const exactConflict = ownerGeometry.length === 0 || obstacleGeometry.length === 0 || exactGeometryConflict(
            ownerGeometry,
            space.ownerDiameterMm.get(owner) ?? 1,
            obstacleGeometry,
            space.ownerDiameterMm.get(fixedOwner) ?? 1,
          );
          if (fixedOwner !== owner && !allowedFixed.has(fixedOwner) && exactConflict) {
            throw new Error(`${space.key}: terminal launch ${owner} intersects fixed geometry ${fixedOwner} at ${key}`);
          }
        });
      });
    }
    for (const [key, owners] of space.fixedReserved) {
      if (owners.size > 1) {
        const orderedOwners = [...owners];
        for (let first = 0; first < orderedOwners.length; first += 1) {
          for (let second = first + 1; second < orderedOwners.length; second += 1) {
            const firstOwner = orderedOwners[first];
            const secondOwner = orderedOwners[second];
            const firstGeometry = fixedGeometry.get(geometryKey(space, firstOwner)) ?? [];
            const secondGeometry = fixedGeometry.get(geometryKey(space, secondOwner)) ?? [];
            if (firstGeometry.length === 0 || secondGeometry.length === 0 || exactGeometryConflict(
              firstGeometry,
              space.ownerDiameterMm.get(firstOwner) ?? 1,
              secondGeometry,
              space.ownerDiameterMm.get(secondOwner) ?? 1,
            )) throw new Error(`${space.key}: fixed routing geometry overlaps at ${key}: ${firstOwner}, ${secondOwner}`);
          }
        }
      }
    }
  });

  const isDirectConnection = (connection: SystemGraph["connections"][number]) => (
    Boolean(directMatingPath(conductorByKey.get(connection.from)!, conductorByKey.get(connection.to)!))
  );
  const terminalCrowding = (connection: SystemGraph["connections"][number]) => (
    [connection.from, connection.to].reduce((sum, endpoint) => {
      const port = conductorByKey.get(endpoint)!;
      const owner = deviceById.get(port.deviceId)!;
      return sum + owner.conductors.filter((peer) => (
        peer.id !== port.id
        && peer.face === port.face
        && distance(terminalPosition(owner, peer.id), port.position) <= 0.050 + 1e-9
      )).length;
    }, 0)
  );
  const sorted = [...graph.connections].toSorted((first, second) => (
    (cableById.get(second.cableId)?.outsideDiameterMm ?? 0) - (cableById.get(first.cableId)?.outsideDiameterMm ?? 0)
    || Number(isDirectConnection(second)) - Number(isDirectConnection(first))
    || terminalCrowding(second) - terminalCrowding(first)
    || first.id.localeCompare(second.id)
  ));

  sorted.forEach((connection, routingIndex) => {
    const from = conductorByKey.get(connection.from)!;
    const to = conductorByKey.get(connection.to)!;
    const fromDevice = deviceById.get(from.deviceId)!;
    const toDevice = deviceById.get(to.deviceId)!;
    const fromJunction = fromDevice.placement.space === "junction" ? fromDevice.placement.junctionId : undefined;
    const toJunction = toDevice.placement.space === "junction" ? toDevice.placement.junctionId : undefined;
    const cable = cableById.get(connection.cableId)!;
    const fromSpace = routingSpaceFor(from, fromDevice);
    const toSpace = routingSpaceFor(to, toDevice);
    // Connections are solved and locked strictly one at a time. A bundle is a
    // procurement/gland concept; it never permits two separately rendered
    // conductors to reuse a voxel.
    const occupancyOwner = connection.id;
    // A front/back route may use only its endpoint owner's outward half-space,
    // beginning after the complete mandatory tangent. It never gains a hidden
    // tunnel through the body's interior or opposite side.
    const endpointAccess = new Map<string, EndpointFaceAccess[]>();
    ([
      [from, fromDevice],
      [to, toDevice],
    ] as const).forEach(([port, device]) => {
      if (port.face !== "front" && port.face !== "back") return;
      endpointAccess.set(device.id, [
        ...(endpointAccess.get(device.id) ?? []),
        {
          position: port.position,
          direction: port.direction,
          clearance: protectedTerminalClearance(device, port, cable.outsideDiameterMm),
        },
      ]);
    });
    const direct = directMatingPath(from, to);
    if (direct) {
      if (fromSpace !== toSpace) {
        throw new Error(`${connection.id}: direct physical mate spans ${fromSpace.key}/${toSpace.key}`);
      }
      const directSpace = fromSpace;
      const axisAligned = isAxisAlignedVector(from.direction);
      const ownInternalSymbols = new Set([fromDevice, toDevice]
        .filter(isBodylessPresentation)
        .map((device) => `internal-y:${device.id}`));
      if (axisAligned && !pathClear(
        direct,
        directSpace,
        cable.outsideDiameterMm,
        occupancyOwner,
        endpointAccess,
        ownInternalSymbols,
      )) {
        throw new Error(`Direct attached join ${connection.id} is obstructed`);
      }
      markOccupied(direct, directSpace, cable.outsideDiameterMm, occupancyOwner, !axisAligned);
      const lengthM = direct.slice(1).reduce((sum, point, index) => sum + distance(direct[index], point), 0);
      routes.push({
        ...connection,
        label: connection.label ?? graphConnectionDisplayLabel(graph, connection),
        points: direct,
        lengthM,
        diameterMm: cable.outsideDiameterMm,
        routed: true,
        routingRank: routingIndex,
      });
      return;
    }
    const fromApproach = terminalLaunchFor(connection, from, fromDevice, fromSpace, cable.outsideDiameterMm);
    const toApproach = terminalLaunchFor(connection, to, toDevice, toSpace, cable.outsideDiameterMm);
    const fromEscape = fromApproach.at(-1)!;
    const toEscape = toApproach.at(-1)!;
    const fromIngressDirection = routingIngressDirection(from, fromSpace, fromEscape);
    const toIngressDirection = routingIngressDirection(to, toSpace, toEscape);
    let middle: Vec3[] | null = null;
    let routeSpace = fromSpace;
    const gland = glandByConnection.get(connection.id);

    if (fromJunction && fromJunction === toJunction) {
      routeSpace = junctionSpaces.get(fromJunction)!;
      middle = aStar(fromEscape, toEscape, routeSpace, cable.outsideDiameterMm, occupancyOwner, undefined, 1, endpointAccess, fromIngressDirection, toIngressDirection);
    } else if (gland && (fromJunction || toJunction)) {
      const insideJunction = fromJunction ?? toJunction!;
      const insideStart = fromJunction ? fromEscape : toEscape;
      const outsideStart = fromJunction ? toEscape : fromEscape;
      const localSpace = junctionSpaces.get(insideJunction)!;
      const externalSpace = fromJunction ? toSpace : fromSpace;
      if (!isWorldRoutingSpace(externalSpace)) {
        throw new Error(`${connection.id}: generated gland has no world-side endpoint`);
      }
      const junction = deviceById.get(insideJunction)!;
      const junctionDefinition = graph.junctions.find((candidate) => candidate.deviceId === insideJunction)!;
      const glandIngressCells = junctionDefinition.sizePolicy === "verified-fixed" ? 1 : 2;
      const glandInside = snapRoutingVec([
        gland.position[0],
        gland.position[1] + geometryMetres(ROUTING_STEP_UNITS * glandIngressCells),
        gland.position[2],
      ]);
      const externalApproach = glandExternalApproach(
        gland,
        junction,
        preferredWorldDepth(externalSpace),
        cable.outsideDiameterMm,
      );
      const glandOutside = externalApproach.at(-1)!;
      const insideDirection = fromJunction ? fromIngressDirection : toIngressDirection;
      const outsideDirection = fromJunction ? toIngressDirection : fromIngressDirection;
      const local = aStar(insideStart, glandInside, localSpace, cable.outsideDiameterMm, occupancyOwner, undefined, 1, endpointAccess, insideDirection);
      const external = aStarWorld(
        glandOutside,
        outsideStart,
        externalSpace,
        cable.outsideDiameterMm,
        occupancyOwner,
        Math.abs(preferredWorldDepth(externalSpace)),
        endpointAccess,
        undefined,
        outsideDirection,
      );
      if (local && external) {
        markOccupied(local, localSpace, cable.outsideDiameterMm, occupancyOwner);
        markOccupied(external, externalSpace, cable.outsideDiameterMm, occupancyOwner);
        markOccupied([glandInside, gland.position], localSpace, cable.outsideDiameterMm, occupancyOwner);
        markOccupied(externalApproach, externalSpace, cable.outsideDiameterMm, occupancyOwner);
        middle = fromJunction
          ? [...local, gland.position, ...externalApproach, ...external]
          : [...external.toReversed(), ...externalApproach.toReversed(), gland.position, ...local.toReversed()];
      }
    } else if (fromJunction !== toJunction && fromJunction && toJunction) {
      throw new Error(`${connection.id}: inter-junction cables require a declared pair of enclosure glands`);
    } else {
      if (fromSpace !== toSpace) {
        throw new Error(`${connection.id}: visible route spans semantic regions ${fromSpace.key}/${toSpace.key}; use reciprocal wall-passthrough mates`);
      }
      routeSpace = fromSpace;
      middle = aStarWorld(
        fromEscape,
        toEscape,
        routeSpace,
        cable.outsideDiameterMm,
        occupancyOwner,
        Math.abs(preferredWorldDepth(routeSpace)),
        endpointAccess,
        fromIngressDirection,
        toIngressDirection,
      );
    }

    if (!middle) {
      const failure = routingFailureDiagnostics.at(-1);
      throw new Error(`Voxel A* could not route ${connection.id}${failure ? ` in ${failure.space}: ${failure.reason} after ${failure.expansions} expansions` : ""}`);
    } else if (!(gland && (fromJunction || toJunction))) {
      markOccupied(middle, routeSpace, cable.outsideDiameterMm, occupancyOwner);
    }
    // Once this route is committed its complete approaches become occupied.
    // Unrelated later routes see the complete committed cable radius.
    markOccupied(fromApproach, fromSpace, cable.outsideDiameterMm, occupancyOwner, !isAxisAlignedVector(from.direction));
    markOccupied(toApproach, toSpace, cable.outsideDiameterMm, occupancyOwner, !isAxisAlignedVector(to.direction));
    // Simplify the solved middle independently. Simplifying across the two
    // approach boundaries can treat the intentional terminal lead as a tiny
    // collinear overshoot and replace it with a segment entering the device at
    // an angle. Keep both generated approaches verbatim and remove only their
    // duplicate join points.
    const compactMiddle = simplify(middle);
    const points = eraseOrthogonalSelfLoops([
      ...fromApproach,
      ...compactMiddle.slice(1, -1),
      ...toApproach.toReversed(),
    ].filter((point, index, all) => index === 0 || distance(point, all[index - 1]) > 1e-9));
    const lengthM = points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
    routes.push({
      ...connection,
      label: connection.label ?? graphConnectionDisplayLabel(graph, connection),
      points,
      lengthM,
      diameterMm: cable.outsideDiameterMm,
      routed: true,
      routingRank: routingIndex,
    });
  });

  return {
    routes: graph.connections.map((connection) => routes.find((route) => route.id === connection.id)!),
    fallbackCount: 0,
    occupiedCells: allRoutingSpaces.reduce((sum, space) => sum + space.occupied.size, 0),
  };
}

const UNBOUNDED_CURRENT_A = 1_000_000_000;
type CurrentNetworkEdge = {
  first: string;
  second: string;
  capacityA: number;
  protectionId?: string;
};

function currentVertex(endpoint: string, channel: CurrentSafetyChannel) {
  return `${channel}|endpoint|${endpoint}`;
}

function currentConnectionVertex(connectionId: string, channel: CurrentSafetyChannel) {
  return `${channel}|connection|${connectionId}`;
}

function maximumCurrentFlow(
  edges: readonly CurrentNetworkEdge[],
  sources: readonly { id: string; vertex: string; capacityA: number }[],
  targets: ReadonlySet<string>,
) {
  const sourceNode = "__current_super_source__";
  const sinkNode = "__current_target__";
  const nodes = new Set<string>([sourceNode, sinkNode]);
  edges.forEach((edge) => { nodes.add(edge.first); nodes.add(edge.second); });
  sources.forEach((source) => nodes.add(source.vertex));
  targets.forEach((target) => nodes.add(target));
  const indexByNode = new Map([...nodes].map((node, index) => [node, index]));
  type FlowEdge = { to: number; reverse: number; capacity: number };
  const adjacency: FlowEdge[][] = Array.from({ length: nodes.size }, () => []);
  const addDirected = (from: string, to: string, capacity: number) => {
    const fromIndex = indexByNode.get(from)!;
    const toIndex = indexByNode.get(to)!;
    const forward: FlowEdge = { to: toIndex, reverse: adjacency[toIndex].length, capacity };
    const reverse: FlowEdge = { to: fromIndex, reverse: adjacency[fromIndex].length, capacity: 0 };
    adjacency[fromIndex].push(forward);
    adjacency[toIndex].push(reverse);
  };
  edges.forEach((edge) => {
    addDirected(edge.first, edge.second, edge.capacityA);
    addDirected(edge.second, edge.first, edge.capacityA);
  });
  sources.forEach((source) => addDirected(sourceNode, source.vertex, source.capacityA));
  targets.forEach((target) => addDirected(target, sinkNode, UNBOUNDED_CURRENT_A));
  const sourceIndex = indexByNode.get(sourceNode)!;
  const sinkIndex = indexByNode.get(sinkNode)!;
  let total = 0;
  while (total < UNBOUNDED_CURRENT_A) {
    const level = Array(nodes.size).fill(-1);
    level[sourceIndex] = 0;
    const queue = [sourceIndex];
    while (queue.length > 0) {
      const current = queue.shift()!;
      adjacency[current].forEach((edge) => {
        if (edge.capacity > 1e-9 && level[edge.to] < 0) {
          level[edge.to] = level[current] + 1;
          queue.push(edge.to);
        }
      });
    }
    if (level[sinkIndex] < 0) break;
    const nextEdge = Array(nodes.size).fill(0);
    const send = (node: number, available: number): number => {
      if (node === sinkIndex) return available;
      for (; nextEdge[node] < adjacency[node].length; nextEdge[node] += 1) {
        const edge = adjacency[node][nextEdge[node]];
        if (edge.capacity <= 1e-9 || level[edge.to] !== level[node] + 1) continue;
        const sent = send(edge.to, Math.min(available, edge.capacity));
        if (sent <= 1e-9) continue;
        edge.capacity -= sent;
        adjacency[edge.to][edge.reverse].capacity += sent;
        return sent;
      }
      return 0;
    };
    while (total < UNBOUNDED_CURRENT_A) {
      const sent = send(sourceIndex, UNBOUNDED_CURRENT_A - total);
      if (sent <= 1e-9) break;
      total += sent;
    }
  }
  const residualReachable = new Set<number>([sourceIndex]);
  const residualQueue = [sourceIndex];
  while (residualQueue.length > 0) {
    const current = residualQueue.shift()!;
    adjacency[current].forEach((edge) => {
      if (edge.capacity <= 1e-9 || residualReachable.has(edge.to)) return;
      residualReachable.add(edge.to);
      residualQueue.push(edge.to);
    });
  }
  const crossesResidualCut = (first: string, second: string) => (
    residualReachable.has(indexByNode.get(first)!) !== residualReachable.has(indexByNode.get(second)!)
  );
  return {
    currentA: total,
    cutProtectionIds: edges
      .filter((edge) => edge.protectionId && crossesResidualCut(edge.first, edge.second))
      .map((edge) => edge.protectionId!)
      .toSorted(),
    cutSourceIds: sources
      .filter((source) => crossesResidualCut(sourceNode, source.vertex))
      .map((source) => source.id)
      .toSorted(),
  };
}

const R28_ACTIVE_CHANNELS = ["positive", "ac-line"] as const;
const R28_RETURN_CHANNELS = ["negative", "ac-neutral"] as const;

type R28ActiveChannel = (typeof R28_ACTIVE_CHANNELS)[number];
type R28NetworkEdge = { first: string; second: string; protectionId?: string };
type R28Protection = NonNullable<Device["currentProtection"]>;
type R28Source = NonNullable<SystemGraph["currentSources"]>[number];
type R28ProtectionCredit = "none" | "provisional" | "verified";
type R28CreditedProtection = { protection: R28Protection; credit: R28ProtectionCredit };

const r28SourceAssemblyPathKey = (deviceId: string, index: number) => `${deviceId}|${index}`;

function r28ConnectionCarries(
  graph: SystemGraph,
  connection: SystemGraph["connections"][number],
  channel: CurrentSafetyChannel,
) {
  if (connection.kind === channel) return true;
  if (connection.kind !== "multicore") return false;
  return Boolean(graph.cables.find((cable) => cable.id === connection.cableId)?.carriedChannels?.includes(channel));
}

function r28ConnectionSupportsChannel(
  graph: SystemGraph,
  connection: SystemGraph["connections"][number],
  channel: CurrentSafetyChannel,
) {
  if (!r28ConnectionCarries(graph, connection, channel)) return false;
  const port = (endpoint: string) => {
    const separator = endpoint.lastIndexOf(".");
    const device = graph.devices.find((candidate) => candidate.id === endpoint.slice(0, separator));
    return device?.conductors.find((candidate) => candidate.id === endpoint.slice(separator + 1));
  };
  const device = (endpoint: string) => {
    const separator = endpoint.lastIndexOf(".");
    let resolved = graph.devices.find((candidate) => candidate.id === endpoint.slice(0, separator));
    const visited = new Set<string>();
    while (resolved?.attachment && !visited.has(resolved.id)) {
      visited.add(resolved.id);
      const ownerId = resolved.attachment.endpoint.slice(0, resolved.attachment.endpoint.lastIndexOf("."));
      resolved = graph.devices.find((candidate) => candidate.id === ownerId);
    }
    return resolved;
  };
  const expectedKind = connection.kind === "multicore" ? "multicore" : channel;
  const fromKind = port(connection.from)?.kind;
  const toKind = port(connection.to)?.kind;
  if (fromKind === expectedKind && toKind === expectedKind) return true;
  return channel === "positive" && connection.seriesLink === true
    && fromKind === "positive" && toKind === "negative"
    && ["battery", "panel"].includes(device(connection.from)?.kind ?? "")
    && device(connection.from)?.kind === device(connection.to)?.kind;
}

function r28IsIntrinsicTerminalJoin(
  graph: SystemGraph,
  connection: SystemGraph["connections"][number],
) {
  if (connection.topologyRole !== "terminal-join") return false;
  return ([
    [connection.from, connection.to],
    [connection.to, connection.from],
  ] as const).some(([physicalEndpoint, joinEndpoint]) => {
    const separator = joinEndpoint.lastIndexOf(".");
    const owner = graph.devices.find((candidate) => candidate.id === joinEndpoint.slice(0, separator));
    return owner?.presentation === "wire-join"
      && owner.attachment?.endpoint === physicalEndpoint
      && joinEndpoint.slice(separator + 1) === "device";
  });
}

function buildR28CurrentNetwork(
  graph: SystemGraph,
  channel: R28ActiveChannel,
  protectionCreditById: ReadonlyMap<string, R28ProtectionCredit>,
  validSourceAssemblyPathKeys: ReadonlySet<string>,
) {
  const edges: R28NetworkEdge[] = [];
  const protections = new Map<string, R28CreditedProtection>();
  const supportedEndpoints = new Set<string>();
  graph.connections.filter((connection) => r28ConnectionSupportsChannel(graph, connection, channel)).forEach((connection) => {
    supportedEndpoints.add(connection.from);
    supportedEndpoints.add(connection.to);
  });
  graph.currentSources.filter((source) => source.channel === channel).forEach((source) => {
    supportedEndpoints.add(source.endpoint);
  });
  graph.devices.forEach((device) => device.currentSourceAssemblyPaths?.forEach((path, index) => {
    if (path.activeChannel !== channel || !validSourceAssemblyPathKeys.has(r28SourceAssemblyPathKey(device.id, index))) return;
    path.terminalPair.forEach((terminalId) => supportedEndpoints.add(`${device.id}.${terminalId}`));
  }));
  const addEdge = (first: string, second: string, protectionId?: string) => {
    if (first !== second) edges.push({ first, second, protectionId });
  };

  graph.connections.forEach((connection) => {
    if (!r28ConnectionSupportsChannel(graph, connection, channel)) return;
    const middle = currentConnectionVertex(connection.id, channel);
    const authoredProtectionId = connection.currentProtection ? `connection:${connection.id}` : undefined;
    const protectionId = authoredProtectionId && protectionCreditById.get(authoredProtectionId) !== "none"
      ? authoredProtectionId
      : undefined;
    if (protectionId) protections.set(protectionId, {
      protection: connection.currentProtection!,
      credit: protectionCreditById.get(protectionId) ?? "none",
    });
    // Integrated lead protection is directional: canonical connections run
    // source -> load, and the connection midpoint represents its protected
    // conductor body. A reverse-fed path is intentionally not credited.
    addEdge(currentVertex(connection.from, channel), middle, protectionId);
    addEdge(middle, currentVertex(connection.to, channel));
  });

  graph.devices.forEach((device) => {
    const endpoints = device.conductors
      .map((port) => `${device.id}.${port.id}`)
      .filter((endpoint) => supportedEndpoints.has(endpoint));
    const endpointSet = new Set(endpoints);
    const paired = new Set<string>();
    const addPair = (first: string, second: string, protectionId?: string) => {
      const key = [first, second].toSorted().join("|");
      if (paired.has(key)) return;
      paired.add(key);
      addEdge(currentVertex(first, channel), currentVertex(second, channel), protectionId);
    };
    device.conductors.forEach((port) => {
      const first = `${device.id}.${port.id}`;
      if (!endpointSet.has(first)) return;
      (port.internalMates ?? []).forEach((mateId) => {
        const second = `${device.id}.${mateId}`;
        if (endpointSet.has(second)) addPair(first, second);
      });
    });
    device.currentSourceAssemblyPaths?.forEach((path, index) => {
      if (path.activeChannel !== channel || !validSourceAssemblyPathKeys.has(r28SourceAssemblyPathKey(device.id, index))) return;
      const [firstId, secondId] = path.terminalPair;
      const first = `${device.id}.${firstId}`;
      const second = `${device.id}.${secondId}`;
      if (endpointSet.has(first) && endpointSet.has(second)) addPair(first, second);
    });
    const passivelyCommon = device.kind === "busbar"
      || device.kind === "switch"
      || device.presentation === "service-splice"
      || ((device.kind === "breaker" || device.kind === "protection") && !device.currentProtection);
    if (passivelyCommon) endpoints.forEach((first, index) => {
      endpoints.slice(index + 1).forEach((second) => addPair(first, second));
    });
    if (device.currentProtection?.terminalPairs) {
      const authoredProtectionId = `device:${device.id}`;
      const protectionId = protectionCreditById.get(authoredProtectionId) !== "none"
        ? authoredProtectionId
        : undefined;
      if (protectionId) protections.set(protectionId, {
        protection: device.currentProtection,
        credit: protectionCreditById.get(protectionId) ?? "none",
      });
      device.currentProtection.terminalPairs.forEach(([firstId, secondId]) => {
        const first = `${device.id}.${firstId}`;
        const second = `${device.id}.${secondId}`;
        const firstPort = device.conductors.find((port) => port.id === firstId);
        const secondPort = device.conductors.find((port) => port.id === secondId);
        if (endpointSet.has(first) && endpointSet.has(second)
          && firstPort?.kind === channel && secondPort?.kind === channel) {
          addPair(first, second, protectionId);
        }
      });
    }
  });
  return {
    edges,
    protections,
    sources: graph.currentSources.filter((source) => source.channel === channel),
  };
}

function r28Reachable(
  start: string,
  targets: ReadonlySet<string>,
  edges: readonly R28NetworkEdge[],
  excludedProtectionId?: string,
) {
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (excludedProtectionId !== undefined && edge.protectionId === excludedProtectionId) return;
    adjacency.set(edge.first, [...(adjacency.get(edge.first) ?? []), edge.second]);
    adjacency.set(edge.second, [...(adjacency.get(edge.second) ?? []), edge.first]);
  });
  const queue = [start];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    if (targets.has(current)) return true;
    visited.add(current);
    (adjacency.get(current) ?? []).forEach((next) => queue.push(next));
  }
  return false;
}

function r28ProtectionEnvelope(
  network: ReturnType<typeof buildR28CurrentNetwork>,
  sources: readonly R28Source[],
  targets: ReadonlySet<string>,
  verifiedOnly: boolean,
): { currentA: number | "unbounded"; protectedBy: readonly string[] } {
  const edges: CurrentNetworkEdge[] = network.edges.map((edge) => {
    const credited = edge.protectionId ? network.protections.get(edge.protectionId) : undefined;
    const receivesCredit = credited && (credited.credit === "verified"
      || (!verifiedOnly && credited.credit === "provisional"));
    return {
      ...edge,
      capacityA: receivesCredit
        ? credited.protection.ratedCurrentA
        : UNBOUNDED_CURRENT_A,
    };
  });
  const flowSources = sources.map((source) => ({
    id: source.id,
    vertex: currentVertex(source.endpoint, source.channel),
    capacityA: source.inherentCurrentLimit && (!verifiedOnly || source.inherentCurrentLimit.verified)
      ? source.inherentCurrentLimit.currentLimitA
      : UNBOUNDED_CURRENT_A,
  }));
  const result = maximumCurrentFlow(edges, flowSources, targets);
  return {
    currentA: result.currentA >= UNBOUNDED_CURRENT_A - 1
      ? "unbounded"
      : Number(result.currentA.toFixed(3)),
    protectedBy: [
      ...result.cutProtectionIds,
      ...result.cutSourceIds.map((sourceId) => `source:${sourceId}`),
    ].toSorted(),
  };
}

function r28ProspectiveFaultEnvelope(
  network: ReturnType<typeof buildR28CurrentNetwork>,
  sources: readonly R28Source[],
  targets: ReadonlySet<string>,
  excludedProtectionId?: string,
): number | "unbounded" {
  const edges: CurrentNetworkEdge[] = network.edges
    .filter((edge) => excludedProtectionId === undefined || edge.protectionId !== excludedProtectionId)
    .map((edge) => {
      const credited = edge.protectionId ? network.protections.get(edge.protectionId) : undefined;
      return {
        ...edge,
        // A breaker/fuse trip rating never limits prospective fault current.
        // Only a verified hard-current-limit is a physical source bound.
        capacityA: credited?.protection.kind === "hard-current-limit" && credited.credit === "verified"
          ? credited.protection.ratedCurrentA
          : UNBOUNDED_CURRENT_A,
      };
    });
  const result = maximumCurrentFlow(edges, sources.map((source) => {
    const publishedFault = source.shortCircuitCurrentA === "unbounded"
      ? UNBOUNDED_CURRENT_A
      : source.shortCircuitCurrentA;
    const inherent = source.inherentCurrentLimit?.verified
      ? source.inherentCurrentLimit.currentLimitA
      : UNBOUNDED_CURRENT_A;
    return {
      id: source.id,
      vertex: currentVertex(source.endpoint, source.channel),
      capacityA: Math.min(publishedFault, inherent),
    };
  }), targets);
  return result.currentA >= UNBOUNDED_CURRENT_A - 1
    ? "unbounded"
    : Number(result.currentA.toFixed(3));
}

/**
 * Fail-closed graph audit for current-path/OCP coordination.
 *
 * This deliberately does not infer load current from source capacity. A
 * breaker/fuse rating is per-source cut-set evidence against conductor
 * ampacity, never a cap on prospective fault current. Only an explicit,
 * verified inherent or series hard-current-limit can cap a contribution.
 */
export function verifyCurrentProtection(graph: SystemGraph): CurrentSafetyReport {
  const issues: CurrentSafetyIssue[] = [];
  const connectionChecks: CurrentSafetyConnectionCheck[] = [];
  const deviceChecks: CurrentSafetyDeviceCheck[] = [];
  const deviceById = new Map(graph.devices.map((device) => [device.id, device]));
  const cableById = new Map(graph.cables.map((cable) => [cable.id, cable]));
  const endpointById = new Map<string, Device["conductors"][number]>(graph.devices.flatMap((device) => (
    device.conductors.map((port) => [`${device.id}.${port.id}`, port] as const)
  )));
  const endpointSet = new Set(endpointById.keys());
  const issue = (finding: CurrentSafetyIssue) => issues.push(finding);

  const sourceSignature = (source: R28Source) => JSON.stringify([
    source.id,
    source.label,
    source.endpoint,
    source.channel,
    source.continuousCapacityA,
    source.peakCapacity?.currentA,
    source.peakCapacity?.durationSeconds,
    source.shortCircuitCurrentA,
    source.inherentCurrentLimit?.currentLimitA,
    source.inherentCurrentLimit?.verified,
    source.inherentCurrentLimit?.note,
    source.verified,
    source.basis,
    source.note,
  ]);
  const terminalSources = currentSourcesFromDevices(graph.devices);
  const terminalSourcesById = new Map<string, R28Source[]>();
  terminalSources.forEach((source) => terminalSourcesById.set(
    source.id,
    [...(terminalSourcesById.get(source.id) ?? []), source],
  ));
  terminalSources.forEach((terminalSource) => {
    const authoredMatches = graph.currentSources.filter((source) => (
      sourceSignature(source) === sourceSignature(terminalSource)
    ));
    if (authoredMatches.length === 1) return;
    issue({
      severity: "error",
      code: "invalid-current-metadata",
      sourceIds: [terminalSource.id],
      endpoint: terminalSource.endpoint,
      channel: terminalSource.channel,
      message: `${terminalSource.endpoint}: terminal-declared supply ${terminalSource.id} is missing or differs from the graph source inventory`,
    });
  });

  const endpointUseCount = new Map<string, number>();
  graph.connections.forEach((connection) => [connection.from, connection.to].forEach((endpoint) => {
    endpointUseCount.set(endpoint, (endpointUseCount.get(endpoint) ?? 0) + 1);
  }));
  graph.devices.forEach((device) => {
    const required = device.conductors.reduce((sum, port) => (
      sum + (endpointUseCount.get(`${device.id}.${port.id}`) ?? 0)
    ), 0);
    device.conductors.forEach((port) => {
      const endpoint = `${device.id}.${port.id}`;
      const landingUses = endpointUseCount.get(endpoint) ?? 0;
      if (port.sharedConnectionPolicy !== "warning" || landingUses <= 1) return;
      issue({
        severity: "warning", code: "terminal-over-capacity", deviceId: device.id, endpoint,
        message: `${endpoint}: ${landingUses} field connections share one warning-policy landing; ${device.id}: terminal capacity exceeded: ${required} required / ${device.conductors.length} available`,
      });
    });
  });

  graph.connections.forEach((connection) => {
    const cable = cableById.get(connection.cableId);
    if (connection.topologyRole === "terminal-join" && !r28IsIntrinsicTerminalJoin(graph, connection)) {
      issue({
        severity: "error", code: "invalid-current-metadata", connectionId: connection.id,
        message: `${connection.id}: terminal-join topology role does not connect a host landing to its attached wire-join device arm`,
      });
    }
    if (connection.kind === "multicore" && (!cable?.carriedChannels || cable.carriedChannels.length === 0)
      && !connection.deenergizedReason) {
      issue({
        severity: "error", code: "invalid-current-metadata", connectionId: connection.id,
        message: `${connection.id}: multicore power channels are not declared; add Cable.carriedChannels or an explicit de-energized reason`,
      });
    }
    const channels = connection.kind === "multicore"
      ? (cable?.carriedChannels ?? []).filter((kind): kind is CurrentSafetyChannel => (
        [...R28_ACTIVE_CHANNELS, ...R28_RETURN_CHANNELS].includes(kind as CurrentSafetyChannel)
      ))
      : [...R28_ACTIVE_CHANNELS, ...R28_RETURN_CHANNELS].includes(connection.kind as CurrentSafetyChannel)
        ? [connection.kind as CurrentSafetyChannel]
        : [];
    channels.filter((channel) => !r28ConnectionSupportsChannel(graph, connection, channel)).forEach((channel) => issue({
      severity: "error", code: "invalid-current-metadata", connectionId: connection.id, channel,
      message: `${connection.id}: connection endpoints do not both support the declared ${channel} power channel`,
    }));
  });

  const sourceIdCounts = new Map<string, number>();
  graph.currentSources.forEach((source) => sourceIdCounts.set(source.id, (sourceIdCounts.get(source.id) ?? 0) + 1));
  const validSourceIds = new Set<string>();
  graph.currentSources.forEach((source) => {
    const duplicate = (sourceIdCounts.get(source.id) ?? 0) > 1;
    const finiteContinuous = Number.isFinite(source.continuousCapacityA) && source.continuousCapacityA > 0;
    const peakCurrentA = source.peakCapacity?.currentA ?? source.continuousCapacityA;
    const validFault = source.shortCircuitCurrentA === "unbounded"
      || (Number.isFinite(source.shortCircuitCurrentA) && source.shortCircuitCurrentA > 0
        && source.shortCircuitCurrentA + 1e-9 >= peakCurrentA);
    const validPeak = !source.peakCapacity
      || (Number.isFinite(source.peakCapacity.currentA)
        && source.peakCapacity.currentA + 1e-9 >= source.continuousCapacityA
        && Number.isFinite(source.peakCapacity.durationSeconds) && source.peakCapacity.durationSeconds > 0);
    const validLimit = !source.inherentCurrentLimit
      || (Number.isFinite(source.inherentCurrentLimit.currentLimitA)
        && source.inherentCurrentLimit.currentLimitA + 1e-9 >= peakCurrentA
        && (source.shortCircuitCurrentA === "unbounded"
          || source.inherentCurrentLimit.currentLimitA <= source.shortCircuitCurrentA + 1e-9));
    const sourcePort = endpointById.get(source.endpoint);
    const validChannel = sourcePort?.kind === source.channel
      || (sourcePort?.kind === "multicore" && graph.connections.some((connection) => (
        (connection.from === source.endpoint || connection.to === source.endpoint)
        && r28ConnectionSupportsChannel(graph, connection, source.channel)
      )));
    const terminalDefinitions = terminalSourcesById.get(source.id) ?? [];
    const validTerminalInventory = terminalDefinitions.length === 1
      && sourceSignature(terminalDefinitions[0]) === sourceSignature(source);
    if (duplicate || !endpointSet.has(source.endpoint) || !validChannel || !finiteContinuous || !validFault || !validPeak || !validLimit
      || !validTerminalInventory) {
      issue({
        severity: "error", code: "invalid-current-metadata", sourceIds: [source.id], endpoint: source.endpoint, channel: source.channel,
        message: `${source.id}: invalid${duplicate ? " duplicate" : ""} source ratings, endpoint, or terminal-owned inventory`,
      });
    } else validSourceIds.add(source.id);
    if (!source.verified) issue({
      severity: "warning", code: "unverified-current-source", sourceIds: [source.id], endpoint: source.endpoint, channel: source.channel,
      prospectiveFaultCurrentA: source.shortCircuitCurrentA,
      message: `${source.id}: ${source.label} source envelope is not verified`,
    });
  });

  const returnChannelForActive = { positive: "negative", "ac-line": "ac-neutral" } as const;
  const sourceAssemblyRecords = graph.devices.flatMap((device) => (
    (device.currentSourceAssemblyPaths ?? []).map((path, index) => ({ device, path, index }))
  ));
  const assemblyMembersById = new Map<string, Set<string>>();
  sourceAssemblyRecords.forEach(({ device, path }) => {
    const members = assemblyMembersById.get(path.assemblyId) ?? new Set<string>();
    members.add(device.id);
    assemblyMembersById.set(path.assemblyId, members);
  });
  const sourceAssemblyMemberCounts = new Map<string, number>();
  sourceAssemblyRecords.forEach(({ device, path }) => {
    const memberKey = `${device.id}|${path.assemblyId}`;
    sourceAssemblyMemberCounts.set(memberKey, (sourceAssemblyMemberCounts.get(memberKey) ?? 0) + 1);
  });
  const validSourceAssemblyPathKeys = new Set<string>();
  sourceAssemblyRecords.forEach(({ device, path, index }) => {
    const [firstId, secondId] = path.terminalPair;
    const first = device.conductors.find((port) => port.id === firstId);
    const second = device.conductors.find((port) => port.id === secondId);
    const expectedReturn = returnChannelForActive[path.activeChannel];
    const validChannelPair = Boolean(expectedReturn) && Boolean(first) && Boolean(second)
      && firstId !== secondId
      && ((first!.kind === path.activeChannel && second!.kind === expectedReturn)
        || (second!.kind === path.activeChannel && first!.kind === expectedReturn));
    const members = assemblyMembersById.get(path.assemblyId) ?? new Set<string>();
    const hasValidAssemblySource = graph.currentSources.some((source) => (
      validSourceIds.has(source.id)
      && source.channel === path.activeChannel
      && members.has(source.endpoint.slice(0, source.endpoint.lastIndexOf(".")))
    ));
    const memberKey = `${device.id}|${path.assemblyId}`;
    const valid = path.assemblyId.trim().length > 0
      && (sourceAssemblyMemberCounts.get(memberKey) ?? 0) === 1
      && validChannelPair
      && hasValidAssemblySource;
    if (valid) {
      validSourceAssemblyPathKeys.add(r28SourceAssemblyPathKey(device.id, index));
      return;
    }
    issue({
      severity: "error", code: "invalid-current-metadata", deviceId: device.id,
      endpoint: first ? `${device.id}.${first.id}` : undefined,
      channel: path.activeChannel,
      message: `${device.id}: invalid or source-less ${path.assemblyId || "unnamed"} source-assembly path ${firstId}/${secondId}`,
    });
  });

  const currentDomainRecords = graph.devices.flatMap((device) => device.conductors.flatMap((port) => (
    port.currentDomain ? [{ device, port, endpoint: `${device.id}.${port.id}`, domain: port.currentDomain }] : []
  )));
  const currentDomainRecordsById = new Map<string, typeof currentDomainRecords>();
  currentDomainRecords.forEach((record) => currentDomainRecordsById.set(
    record.domain.id,
    [...(currentDomainRecordsById.get(record.domain.id) ?? []), record],
  ));
  const validCurrentDomains = new Map<string, {
    activeChannel: R28ActiveChannel;
    activeEndpoints: readonly string[];
    returnEndpoints: ReadonlySet<string>;
  }>();
  currentDomainRecordsById.forEach((records, domainId) => {
    const active = records.filter((record) => record.domain.role === "active");
    const returns = records.filter((record) => record.domain.role === "return");
    const activeChannels = new Set(active.map((record) => record.port.kind).filter((kind): kind is R28ActiveChannel => (
      R28_ACTIVE_CHANNELS.includes(kind as R28ActiveChannel)
    )));
    const activeChannel = activeChannels.size === 1 ? [...activeChannels][0] : undefined;
    const expectedReturn = activeChannel ? returnChannelForActive[activeChannel] : undefined;
    const valid = domainId.trim().length > 0
      && active.length > 0
      && returns.length > 0
      && records.length === active.length + returns.length
      && activeChannels.size === 1
      && active.every((record) => record.port.kind === activeChannel)
      && returns.every((record) => record.port.kind === expectedReturn);
    if (valid && activeChannel) {
      validCurrentDomains.set(domainId, {
        activeChannel,
        activeEndpoints: active.map((record) => record.endpoint).toSorted(),
        returnEndpoints: new Set(returns.map((record) => record.endpoint)),
      });
      return;
    }
    issue({
      severity: "error", code: "invalid-current-metadata",
      deviceId: records[0]?.device.id, endpoint: records[0]?.endpoint,
      message: `${domainId || "unnamed current domain"}: current domain requires matching active and return anchors in one DC or AC channel family`,
    });
  });

  const attachmentRootEndpoint = (initialEndpoint: string) => {
    let endpoint = initialEndpoint;
    const visited = new Set<string>();
    while (!visited.has(endpoint)) {
      visited.add(endpoint);
      const separator = endpoint.lastIndexOf(".");
      const device = deviceById.get(endpoint.slice(0, separator));
      if (!device?.attachment) break;
      endpoint = device.attachment.endpoint;
    }
    return endpoint;
  };
  const validAssemblyIdsAtEndpoint = (initialEndpoint: string, channel: CurrentSafetyChannel) => {
    const endpoint = attachmentRootEndpoint(initialEndpoint);
    const separator = endpoint.lastIndexOf(".");
    const device = deviceById.get(endpoint.slice(0, separator));
    const terminalId = endpoint.slice(separator + 1);
    if (!device || endpointById.get(endpoint)?.kind !== channel) return new Set<string>();
    return new Set((device.currentSourceAssemblyPaths ?? []).flatMap((path, index) => (
      validSourceAssemblyPathKeys.has(r28SourceAssemblyPathKey(device.id, index))
        && path.terminalPair.includes(terminalId)
        && (path.activeChannel === channel || returnChannelForActive[path.activeChannel] === channel)
        ? [path.assemblyId]
        : []
    )));
  };
  const validDomainIdsAtEndpoint = (
    initialEndpoint: string,
    role: "active" | "return",
    activeChannel: R28ActiveChannel,
  ) => {
    const endpoint = attachmentRootEndpoint(initialEndpoint);
    const terminal = endpointById.get(endpoint)?.currentDomain;
    if (!terminal || terminal.role !== role) return new Set<string>();
    const domain = validCurrentDomains.get(terminal.id);
    if (!domain || domain.activeChannel !== activeChannel) return new Set<string>();
    const declaredEndpoints = role === "active" ? new Set(domain.activeEndpoints) : domain.returnEndpoints;
    return declaredEndpoints.has(endpoint) ? new Set([terminal.id]) : new Set<string>();
  };
  const transparentPresentations = new Set([
    "cable-breakout",
    "wire-join",
    "service-splice",
    "rigid-rail",
    "wall-passthrough",
  ]);
  const connectionsByEndpoint = new Map<string, SystemGraph["connections"]>();
  graph.connections.forEach((connection) => [connection.from, connection.to].forEach((endpoint) => {
    connectionsByEndpoint.set(endpoint, [...(connectionsByEndpoint.get(endpoint) ?? []), connection]);
  }));
  const electricalOwnerIdsAtEndpoint = (
    initialEndpoint: string,
    channel: CurrentSafetyChannel,
    excludedConnectionIds: ReadonlySet<string>,
  ) => {
    const owners = new Set<string>();
    const queue = [initialEndpoint];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const endpoint = queue.shift()!;
      if (visited.has(endpoint)) continue;
      visited.add(endpoint);
      const separator = endpoint.lastIndexOf(".");
      const device = deviceById.get(endpoint.slice(0, separator));
      const terminalId = endpoint.slice(separator + 1);
      const terminal = device?.conductors.find((candidate) => candidate.id === terminalId);
      if (!device || !terminal) continue;
      const transparent = Boolean(device.attachment)
        || transparentPresentations.has(device.presentation ?? "");
      if (!transparent) {
        owners.add(device.id);
        continue;
      }
      if (device.attachment) queue.push(device.attachment.endpoint);
      const internalPeers = terminal.internalMates?.length
        ? terminal.internalMates
        : device.presentation === "service-splice"
          ? device.conductors.filter((candidate) => candidate.kind === terminal.kind).map((candidate) => candidate.id)
          : [];
      internalPeers.forEach((peerId) => {
        const peer = device.conductors.find((candidate) => candidate.id === peerId);
        if (!peer) return;
        const supportsChannel = (terminal.kind === channel || terminal.kind === "multicore")
          && (peer.kind === channel || peer.kind === "multicore");
        if (supportsChannel) queue.push(`${device.id}.${peer.id}`);
      });
      (connectionsByEndpoint.get(endpoint) ?? []).forEach((connection) => {
        if (excludedConnectionIds.has(connection.id)
          || !r28ConnectionSupportsChannel(graph, connection, channel)) return;
        queue.push(connection.from === endpoint ? connection.to : connection.from);
      });
    }
    return owners;
  };
  const setsIntersect = (first: ReadonlySet<string>, second: ReadonlySet<string>) => (
    [...first].some((entry) => second.has(entry))
  );
  const structurallyPairsReturn = (
    active: SystemGraph["connections"][number],
    returned: SystemGraph["connections"][number],
    activeChannel: R28ActiveChannel,
    returnChannel: (typeof R28_RETURN_CHANNELS)[number],
  ) => {
    const excluded = new Set([active.id, returned.id]);
    const endpointPair = (activeEndpoint: string, returnEndpoint: string) => (
      setsIntersect(
        electricalOwnerIdsAtEndpoint(activeEndpoint, activeChannel, excluded),
        electricalOwnerIdsAtEndpoint(returnEndpoint, returnChannel, excluded),
      )
      || setsIntersect(
        validAssemblyIdsAtEndpoint(activeEndpoint, activeChannel),
        validAssemblyIdsAtEndpoint(returnEndpoint, returnChannel),
      )
    );
    if (endpointPair(active.from, returned.from) || endpointPair(active.to, returned.to)) return true;
    const sameDomain = (activeEndpoint: string, returnEndpoint: string) => setsIntersect(
      validDomainIdsAtEndpoint(activeEndpoint, "active", activeChannel),
      validDomainIdsAtEndpoint(returnEndpoint, "return", activeChannel),
    );
    return sameDomain(active.from, returned.from) && sameDomain(active.to, returned.to);
  };

  const protectors: Array<{
    id: string;
    protection: R28Protection;
    deviceId?: string;
    connectionId?: string;
  }> = [
    ...graph.devices.flatMap((device) => device.currentProtection ? [{
      id: `device:${device.id}`, protection: device.currentProtection, deviceId: device.id,
    }] : []),
    ...graph.connections.flatMap((connection) => connection.currentProtection ? [{
      id: `connection:${connection.id}`, protection: connection.currentProtection, connectionId: connection.id,
    }] : []),
  ];
  const protectionCreditById = new Map<string, R28ProtectionCredit>();
  protectors.forEach(({ id, protection, deviceId, connectionId }) => {
    const validRating = Number.isFinite(protection.ratedCurrentA) && protection.ratedCurrentA > 0;
    const validInterrupt = protection.interruptRatingA === undefined
      || (Number.isFinite(protection.interruptRatingA) && protection.interruptRatingA > 0);
    const device = deviceId ? graph.devices.find((candidate) => candidate.id === deviceId) : undefined;
    const validPairs = !device || Boolean(protection.terminalPairs?.length)
      && protection.terminalPairs!.every(([first, second]) => {
        const firstPort = device.conductors.find((port) => port.id === first);
        const secondPort = device.conductors.find((port) => port.id === second);
        return first !== second && Boolean(firstPort) && Boolean(secondPort)
          && firstPort!.kind === secondPort!.kind
          && R28_ACTIVE_CHANNELS.includes(firstPort!.kind as R28ActiveChannel);
      });
    const metadataValid = validRating && validInterrupt && validPairs;
    const hasRequiredInterruptEvidence = protection.kind === "hard-current-limit"
      || protection.interruptRatingA !== undefined;
    protectionCreditById.set(id, !metadataValid
      ? "none"
      : protection.verified && hasRequiredInterruptEvidence ? "verified" : "provisional");
    if (!metadataValid) issue({
      severity: "error", code: "invalid-current-metadata", deviceId, connectionId, ratingA: protection.ratedCurrentA,
      message: `${id}: invalid protective rating, interrupt rating, or explicit terminal-pair metadata`,
    });
    if (!protection.verified) issue({
      severity: "warning", code: "unverified-protective-element", deviceId, connectionId, ratingA: protection.ratedCurrentA,
      message: `${id}: modeled ${protection.ratedCurrentA} A ${protection.kind} remains unverified`,
    });
    if (protection.kind !== "hard-current-limit" && protection.interruptRatingA === undefined) issue({
      severity: "warning", code: "missing-interrupt-rating", deviceId, connectionId, ratingA: protection.ratedCurrentA,
      message: `${id}: interrupt rating is not declared; fault-clearing capability remains outside this proof`,
    });
  });

  protectors.forEach(({ id, protection, deviceId, connectionId }) => {
    if (protection.kind === "hard-current-limit" || protection.interruptRatingA === undefined) return;
    R28_ACTIVE_CHANNELS.forEach((channel) => {
      const network = buildR28CurrentNetwork(graph, channel, protectionCreditById, validSourceAssemblyPathKeys);
      const protectedEdges = network.edges.filter((edge) => edge.protectionId === id);
      if (protectedEdges.length === 0) return;
      const prospectiveFaultCurrentA = r28ProspectiveFaultEnvelope(
        network,
        network.sources.filter((source) => validSourceIds.has(source.id)),
        new Set(protectedEdges.flatMap((edge) => [edge.first, edge.second])),
        id,
      );
      if (prospectiveFaultCurrentA === "unbounded"
        || prospectiveFaultCurrentA > protection.interruptRatingA! + 1e-9) {
        if (protectionCreditById.get(id) === "verified") protectionCreditById.set(id, "provisional");
        issue({
          severity: "error", code: "interrupt-rating-insufficient", deviceId, connectionId, channel,
          prospectiveFaultCurrentA, ratingA: protection.interruptRatingA,
          message: `${id}: ${protection.interruptRatingA} A interrupt rating is below the ${prospectiveFaultCurrentA === "unbounded" ? "unbounded" : `${prospectiveFaultCurrentA} A`} prospective ${channel} contribution`,
        });
      }
    });
  });

  type ActiveTrace = {
    reachableSources: readonly R28Source[];
    evidence: readonly {
      source: R28Source;
      contribution: number | "unbounded";
      verifiedEnvelope: ReturnType<typeof r28ProtectionEnvelope>;
      provisionalEnvelope: ReturnType<typeof r28ProtectionEnvelope>;
    }[];
    verifiedProtectionEnvelopeA: number | "unbounded";
    provisionalProtectionEnvelopeA: number | "unbounded";
    prospectiveFaultCurrentA: number | "unbounded";
  };
  const activeTraces = new Map<string, ActiveTrace>();
  const traceTargets = (
    targets: ReadonlySet<string>,
    channel: R28ActiveChannel,
    network: ReturnType<typeof buildR28CurrentNetwork>,
  ): ActiveTrace => {
    const reachableSources = network.sources.filter((source) => (
      validSourceIds.has(source.id)
      && r28Reachable(currentVertex(source.endpoint, channel), targets, network.edges)
    ));
    const evidence = reachableSources.map((source) => ({
      source,
      contribution: r28ProspectiveFaultEnvelope(network, [source], targets),
      verifiedEnvelope: r28ProtectionEnvelope(network, [source], targets, true),
      provisionalEnvelope: r28ProtectionEnvelope(network, [source], targets, false),
    }));
    const verifiedEnvelope = r28ProtectionEnvelope(network, reachableSources, targets, true);
    const provisionalEnvelope = r28ProtectionEnvelope(network, reachableSources, targets, false);
    return {
      reachableSources,
      evidence,
      verifiedProtectionEnvelopeA: verifiedEnvelope.currentA,
      provisionalProtectionEnvelopeA: provisionalEnvelope.currentA,
      prospectiveFaultCurrentA: r28ProspectiveFaultEnvelope(network, reachableSources, targets),
    };
  };
  const traceActive = (
    connection: SystemGraph["connections"][number],
    channel: R28ActiveChannel,
    network: ReturnType<typeof buildR28CurrentNetwork>,
  ) => traceTargets(new Set([currentConnectionVertex(connection.id, channel)]), channel, network);

  const evaluate = (
    connection: SystemGraph["connections"][number],
    channel: CurrentSafetyChannel,
    trace: ActiveTrace,
    pairedActiveConnectionId?: string,
    pairedActiveEndpointIds?: readonly string[],
  ): CurrentSafetyConnectionCheck => {
    const ampacityA = cableById.get(connection.cableId)?.ampacityA;
    const protectionBySource = trace.evidence.map(({ source, contribution, verifiedEnvelope, provisionalEnvelope }) => {
      const verifiedBy = ampacityA !== undefined && verifiedEnvelope.currentA !== "unbounded"
        && verifiedEnvelope.currentA <= ampacityA + 1e-9 ? verifiedEnvelope.protectedBy : [];
      const provisionalBy = ampacityA !== undefined && provisionalEnvelope.currentA !== "unbounded"
        && provisionalEnvelope.currentA <= ampacityA + 1e-9 ? provisionalEnvelope.protectedBy : [];
      return { sourceId: source.id, prospectiveFaultCurrentA: contribution, verifiedBy, provisionalBy };
    });
    const verifiedEnvelopeFits = ampacityA !== undefined && trace.verifiedProtectionEnvelopeA !== "unbounded"
      && trace.verifiedProtectionEnvelopeA <= ampacityA + 1e-9;
    const provisionalEnvelopeFits = ampacityA !== undefined && trace.provisionalProtectionEnvelopeA !== "unbounded"
      && trace.provisionalProtectionEnvelopeA <= ampacityA + 1e-9;
    const status = ampacityA === undefined || !provisionalEnvelopeFits
      || protectionBySource.some((entry) => entry.verifiedBy.length === 0 && entry.provisionalBy.length === 0)
      ? "incomplete" as const
      : !verifiedEnvelopeFits || protectionBySource.some((entry) => entry.verifiedBy.length === 0)
        ? "provisional" as const
        : "verified" as const;
    return {
      connectionId: connection.id,
      channel,
      sourceIds: trace.reachableSources.map((source) => source.id).toSorted(),
      pairedActiveConnectionId,
      pairedActiveEndpointIds,
      prospectiveFaultCurrentA: trace.prospectiveFaultCurrentA,
      verifiedProtectionEnvelopeA: trace.verifiedProtectionEnvelopeA,
      provisionalProtectionEnvelopeA: trace.provisionalProtectionEnvelopeA,
      ampacityA,
      status,
      protectionBySource,
    };
  };

  const reportCheck = (check: CurrentSafetyConnectionCheck, connection: SystemGraph["connections"][number]) => {
    const cable = cableById.get(connection.cableId);
    if (connection.sourceLeadReason) issue({
      severity: "warning", code: "unprotected-source-lead", connectionId: connection.id, channel: check.channel,
      sourceIds: check.sourceIds, prospectiveFaultCurrentA: check.prospectiveFaultCurrentA, ratingA: check.ampacityA,
      message: `${connection.id} (${check.channel}): deliberately short source-side lead · ${connection.sourceLeadReason}`,
    });
    if (check.ampacityA === undefined) issue({
      severity: "error", code: "invalid-current-metadata", connectionId: connection.id, channel: check.channel,
      sourceIds: check.sourceIds, prospectiveFaultCurrentA: check.prospectiveFaultCurrentA,
      message: `${connection.id} (${check.channel}): ${cable?.label ?? connection.cableId} has no numeric ampacity`,
    });
    else if (check.status === "incomplete") issue({
      severity: "error", code: "conductor-protection-incomplete", connectionId: connection.id, channel: check.channel,
      sourceIds: check.sourceIds, prospectiveFaultCurrentA: check.prospectiveFaultCurrentA, ratingA: check.ampacityA,
      message: `${connection.id} (${check.channel}): no per-source OCP/current-limit cut set coordinates every source with the ${check.ampacityA} A conductor`,
    });
    else if (check.status === "provisional") issue({
      severity: "warning", code: "conductor-protection-provisional", connectionId: connection.id, channel: check.channel,
      sourceIds: check.sourceIds, prospectiveFaultCurrentA: check.prospectiveFaultCurrentA, ratingA: check.ampacityA,
      message: `${connection.id} (${check.channel}): conductor coordination relies on at least one unverified or interrupt-unproved protective element`,
    });
  };

  const reportDevice = (
    device: Device,
    channel: CurrentSafetyChannel,
    trace: ActiveTrace,
  ) => {
    // Breaker/fuse trip values coordinate downstream conductors and are not
    // body ratings. Protective devices without an explicit body/input rating
    // are already covered by their terminal-pair and interrupt audit.
    const ratingA = device.currentRatingA;
    if (ratingA === undefined && (device.kind === "breaker" || device.kind === "protection")) return;
    const protectionBySource = trace.evidence.map(({ source, contribution, verifiedEnvelope, provisionalEnvelope }) => ({
      sourceId: source.id,
      prospectiveFaultCurrentA: contribution,
      verifiedBy: ratingA !== undefined && verifiedEnvelope.currentA !== "unbounded"
        && verifiedEnvelope.currentA <= ratingA + 1e-9 ? verifiedEnvelope.protectedBy : [],
      provisionalBy: ratingA !== undefined && provisionalEnvelope.currentA !== "unbounded"
        && provisionalEnvelope.currentA <= ratingA + 1e-9 ? provisionalEnvelope.protectedBy : [],
    }));
    const provisionalFits = ratingA !== undefined && trace.provisionalProtectionEnvelopeA !== "unbounded"
      && trace.provisionalProtectionEnvelopeA <= ratingA + 1e-9;
    const verifiedFits = ratingA !== undefined && trace.verifiedProtectionEnvelopeA !== "unbounded"
      && trace.verifiedProtectionEnvelopeA <= ratingA + 1e-9;
    const status = ratingA === undefined || !provisionalFits
      || protectionBySource.some((entry) => entry.verifiedBy.length === 0 && entry.provisionalBy.length === 0)
      ? "incomplete" as const
      : !verifiedFits || protectionBySource.some((entry) => entry.verifiedBy.length === 0)
        ? "provisional" as const
        : "verified" as const;
    deviceChecks.push({
      deviceId: device.id, channel,
      sourceIds: trace.reachableSources.map((source) => source.id).toSorted(), ratingA, status,
      verifiedProtectionEnvelopeA: trace.verifiedProtectionEnvelopeA,
      provisionalProtectionEnvelopeA: trace.provisionalProtectionEnvelopeA,
      protectionBySource,
    });
    if (ratingA === undefined && !["connector", "junction", "breaker", "protection"].includes(device.kind)) issue({
      severity: "warning", code: "missing-device-rating", deviceId: device.id, channel,
      sourceIds: trace.reachableSources.map((source) => source.id).toSorted(),
      message: `${device.id}: energized ${channel} input/device rating is not declared`,
    }); else if (ratingA !== undefined && status === "incomplete") issue({
      severity: "error", code: "device-protection-incomplete", deviceId: device.id, channel, ratingA,
      sourceIds: trace.reachableSources.map((source) => source.id).toSorted(),
      message: `${device.id}: aggregate upstream protection envelope is not coordinated with the ${ratingA} A device/input rating`,
    }); else if (ratingA !== undefined && status === "provisional") issue({
      severity: "warning", code: "device-protection-provisional", deviceId: device.id, channel, ratingA,
      sourceIds: trace.reachableSources.map((source) => source.id).toSorted(),
      message: `${device.id}: device/input coordination relies on unverified protection metadata`,
    });
  };

  R28_ACTIVE_CHANNELS.forEach((channel) => {
    const network = buildR28CurrentNetwork(graph, channel, protectionCreditById, validSourceAssemblyPathKeys);
    graph.connections.forEach((connection) => {
      if (r28IsIntrinsicTerminalJoin(graph, connection)) return;
      if (!r28ConnectionCarries(graph, connection, channel)) return;
      const trace = traceActive(connection, channel, network);
      activeTraces.set(`${connection.id}:${channel}`, trace);
      if (trace.reachableSources.length === 0) {
        if (!connection.deenergizedReason) issue({
          severity: "error", code: "untraced-active-conductor", connectionId: connection.id, channel,
          message: `${connection.id}: energized ${channel} conductor is unreachable from every declared source`,
        });
        return;
      }
      const check = evaluate(connection, channel, trace);
      connectionChecks.push(check);
      reportCheck(check, connection);
    });

    graph.devices.forEach((device) => {
      const targets = new Set(graph.connections.filter((connection) => (
        r28ConnectionSupportsChannel(graph, connection, channel)
        && (connection.from.startsWith(`${device.id}.`) || connection.to.startsWith(`${device.id}.`))
      )).map((connection) => currentVertex(
        connection.from.startsWith(`${device.id}.`) ? connection.from : connection.to,
        channel,
      )));
      if (targets.size === 0) return;
      const trace = traceTargets(targets, channel, network);
      if (trace.reachableSources.length === 0) return;
      reportDevice(device, channel, trace);
    });
  });

  const activeForReturn = { negative: "positive", "ac-neutral": "ac-line" } as const;
  const connectionById = new Map(graph.connections.map((connection) => [connection.id, connection]));
  R28_RETURN_CHANNELS.forEach((channel) => {
    const activeChannel = activeForReturn[channel];
    const network = buildR28CurrentNetwork(graph, activeChannel, protectionCreditById, validSourceAssemblyPathKeys);
    const ratedReturnDeviceTargets = new Map<string, Set<string>>();
    graph.connections.forEach((connection) => {
      if (r28IsIntrinsicTerminalJoin(graph, connection)) return;
      if (!r28ConnectionCarries(graph, connection, channel)) return;
      const cable = cableById.get(connection.cableId);
      const selfPairedMulticore = connection.kind === "multicore"
        && cable?.carriedChannels?.includes(activeChannel)
        && r28ConnectionSupportsChannel(graph, connection, channel)
        && r28ConnectionSupportsChannel(graph, connection, activeChannel);
      const pairedActiveConnectionId = selfPairedMulticore ? connection.id : connection.returnFor;
      const pairedActive = pairedActiveConnectionId ? connectionById.get(pairedActiveConnectionId) : undefined;
      const validCircuitPair = selfPairedMulticore || Boolean(
        pairedActive
        && r28ConnectionSupportsChannel(graph, pairedActive, activeChannel)
        && connection.circuitId
        && connection.circuitId === pairedActive.circuitId
        && structurallyPairsReturn(pairedActive, connection, activeChannel, channel),
      );
      const domainMatches = new Map<string, (typeof validCurrentDomains extends Map<string, infer Value> ? Value : never)>();
      [connection.from, connection.to].forEach((endpoint) => {
        const domainTerminal = endpointById.get(endpoint)?.currentDomain;
        if (!domainTerminal || domainTerminal.role !== "return") return;
        const domain = validCurrentDomains.get(domainTerminal.id);
        if (domain?.activeChannel === activeChannel && domain.returnEndpoints.has(endpoint)) {
          domainMatches.set(domainTerminal.id, domain);
        }
      });
      const domain = domainMatches.size === 1 ? [...domainMatches.values()][0] : undefined;
      const validDomainPair = !pairedActiveConnectionId && domainMatches.size === 1;
      const activeTargets = validDomainPair && domain
        ? new Set(domain.activeEndpoints.map((endpoint) => currentVertex(endpoint, activeChannel)))
        : pairedActiveConnectionId && validCircuitPair
          ? new Set([currentConnectionVertex(pairedActiveConnectionId, activeChannel)])
          : new Set<string>();
      const trace = activeTargets.size > 0
        ? traceTargets(activeTargets, activeChannel, network)
        : undefined;
      if ((!validCircuitPair && !validDomainPair) || !trace || trace.reachableSources.length === 0) {
        if (!connection.deenergizedReason) issue({
          severity: "error", code: "unpaired-return-conductor", connectionId: connection.id, channel,
          message: `${connection.id}: ${channel} conductor has no traced ${activeChannel} pairing with matching circuit identity and structural endpoint ownership, source assembly, or current-domain evidence`,
        });
        return;
      }
      const pairedActiveEndpointIds = validDomainPair ? domain?.activeEndpoints : undefined;
      const check = evaluate(connection, channel, trace, pairedActiveConnectionId, pairedActiveEndpointIds);
      connectionChecks.push(check);
      reportCheck(check, connection);
      [connection.from, connection.to].forEach((endpoint) => {
        const separator = endpoint.lastIndexOf(".");
        const deviceId = endpoint.slice(0, separator);
        if (graph.devices.find((device) => device.id === deviceId)?.currentRatingA === undefined) return;
        const key = `${deviceId}|${channel}`;
        const targets = ratedReturnDeviceTargets.get(key) ?? new Set<string>();
        activeTargets.forEach((target) => targets.add(target));
        ratedReturnDeviceTargets.set(key, targets);
      });
    });
    ratedReturnDeviceTargets.forEach((targets, key) => {
      const [deviceId] = key.split("|");
      const device = graph.devices.find((candidate) => candidate.id === deviceId);
      if (!device) return;
      const trace = traceTargets(targets, activeChannel, network);
      if (trace.reachableSources.length > 0) reportDevice(device, channel, trace);
    });
  });

  const issueOrder = (first: CurrentSafetyIssue, second: CurrentSafetyIssue) => (
    first.code.localeCompare(second.code)
    || (first.connectionId ?? "").localeCompare(second.connectionId ?? "")
    || (first.deviceId ?? "").localeCompare(second.deviceId ?? "")
    || (first.endpoint ?? "").localeCompare(second.endpoint ?? "")
    || (first.channel ?? "").localeCompare(second.channel ?? "")
    || first.message.localeCompare(second.message)
  );
  const warnings = issues.filter((finding) => finding.severity === "warning").toSorted(issueOrder);
  const errors = issues.filter((finding) => finding.severity === "error").toSorted(issueOrder);
  const hasIncompleteEvidence = connectionChecks.some((check) => check.status === "incomplete")
    || deviceChecks.some((check) => check.status === "incomplete");
  return {
    scope: "supply-active-and-explicitly-paired-returns",
    status: errors.length > 0 || hasIncompleteEvidence
      ? "incomplete"
      : warnings.length > 0 ? "provisional" : "verified",
    excludedConductorKinds: ["earth", "data", "control", "multicore"],
    limitations: [
      "Normal load current is not inferred from source capacity; this report proves only per-source OCP/current-limit path coordination against declared conductor ampacity.",
      "Prospective fault contribution is separate and is never capped by a breaker/fuse trip rating. Interrupt capacity, time-current curves, selectivity and let-through energy remain engineering inputs unless explicitly declared.",
      "A breaker/fuse can receive verified coordination credit only with valid, verified trip metadata and a declared adequate interrupt rating; otherwise it remains provisional or receives no credit.",
      "Negative and neutral conductors are checked only when returnFor has matching circuit identity plus structural endpoint/source-assembly evidence, when both route sides share validated typed current domains, when one typed domain anchors the return directly, or when a multicore explicitly carries both active and return channels.",
      "Multicore channels come only from Cable.carriedChannels; a sheath never implicitly merges DC, AC, return or neutral networks.",
      "Device checks use currentRatingA only for a single electrical domain. Multi-domain converters and inverters remain unrated until terminal-group ratings are explicitly modeled.",
    ],
    sources: [...graph.currentSources],
    connections: connectionChecks.toSorted((first, second) => (
      first.connectionId.localeCompare(second.connectionId) || first.channel.localeCompare(second.channel)
    )),
    devices: deviceChecks.toSorted((first, second) => (
      first.deviceId.localeCompare(second.deviceId) || first.channel.localeCompare(second.channel)
    )),
    warnings,
    errors,
  };
}

function validateGraph(graph: SystemGraph) {
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
  const conductorDefinitionByEndpoint = new Map<string, Device["conductors"][number]>(graph.devices.flatMap((device) => device.conductors.map((candidate) => (
    [`${device.id}.${candidate.id}`, candidate] as const
  ))));
  const endpoints = new Set(conductorDefinitionByEndpoint.keys());
  const cableIds = new Set(graph.cables.map((cable) => cable.id));
  const endpointUseCount = new Map<string, number>();
  graph.connections.forEach((connection) => {
    if (!endpoints.has(connection.from)) problems.push(`${connection.id}: missing source ${connection.from}`);
    if (!endpoints.has(connection.to)) problems.push(`${connection.id}: missing target ${connection.to}`);
    if (!cableIds.has(connection.cableId)) problems.push(`${connection.id}: missing cable ${connection.cableId}`);
    [connection.from, connection.to].forEach((endpoint) => (
      endpointUseCount.set(endpoint, (endpointUseCount.get(endpoint) ?? 0) + 1)
    ));
  });
  [...endpointUseCount].filter(([, count]) => count > 1).forEach(([endpoint, count]) => {
    if (["warning", "approved-stack"].includes(conductorDefinitionByEndpoint.get(endpoint)?.sharedConnectionPolicy ?? "expand")) return;
    problems.push(`${endpoint}: one physical conductor has ${count} external wires; add an explicit wire join`);
  });
  graph.devices.forEach((device) => {
    if ((device.kind === "breaker" || device.kind === "protection") && device.poles && Math.abs(device.size[0] - device.poles * 0.020) > 1e-9) {
      problems.push(`${device.id}: breaker/protection width must be exactly 20 mm per way`);
    }
    const placement = device.placement;
    if (placement.space === "junction" && !graph.junctions.some((junction) => junction.deviceId === placement.junctionId)) {
      problems.push(`${device.id}: unknown junction ${placement.junctionId}`);
    }
    if (device.presentation === "wire-join") {
      if (!device.attachment || !endpoints.has(device.attachment.endpoint)) problems.push(`${device.id}: invalid wire-join attachment`);
      if (device.conductors.map((port) => port.id).join(",") !== "device,through,branch") {
        problems.push(`${device.id}: wire join must expose device, through and branch arms`);
      }
      device.conductors.forEach((port) => {
        const expected = ["device", "through", "branch"].filter((id) => id !== port.id).toSorted();
        if ([...(port.internalMates ?? [])].toSorted().join(",") !== expected.join(",")) {
          problems.push(`${device.id}.${port.id}: incomplete internal join mates`);
        }
      });
      const landingKind = device.attachment ? conductorDefinitionByEndpoint.get(device.attachment.endpoint)?.kind : undefined;
      if (landingKind && device.conductors.some((port) => port.kind !== landingKind)) {
        problems.push(`${device.id}: every splice arm must match attached ${landingKind} conductor kind`);
      }
    }
    const strictInternalTopology = ["wire-join", "rigid-rail", "cable-breakout", "integrated-cable-breakout", "wall-passthrough"].includes(device.presentation ?? "")
      || (device.conductors.length > 1 && device.conductors.every((port) => (port.internalMates?.length ?? 0) > 0));
    if (strictInternalTopology) {
      device.conductors.forEach((port) => {
        (port.internalMates ?? []).forEach((mateId) => {
          const mate = device.conductors.find((candidate) => candidate.id === mateId);
          if (!mate) {
            problems.push(`${device.id}.${port.id}: missing internal mate ${mateId}`);
            return;
          }
          if (!(mate.internalMates ?? []).includes(port.id)) {
            problems.push(`${device.id}.${port.id}: internal mate ${mateId} is not reciprocal`);
          }
          if (device.presentation === "rigid-rail" && mate.kind !== port.kind) {
            problems.push(`${device.id}.${port.id}: rigid rail mate ${mateId} crosses ${port.kind}/${mate.kind}`);
          }
        });
      });
    }
    if (device.presentation === "rigid-rail") {
      const targets = device.railTargets ?? {};
      device.conductors.forEach((port) => {
        const targetEndpoint = targets[port.id];
        const target = targetEndpoint ? conductorDefinitionByEndpoint.get(targetEndpoint) : undefined;
        if (!targetEndpoint || !target) problems.push(`${device.id}.${port.id}: missing rigid-rail target`);
        else if (target.kind !== port.kind) {
          problems.push(`${device.id}.${port.id}: rigid-rail target ${targetEndpoint} crosses ${port.kind}/${target.kind}`);
        }
      });
      Object.keys(targets).filter((portId) => !device.conductors.some((port) => port.id === portId)).forEach((portId) => {
        problems.push(`${device.id}: rigid-rail target key ${portId} has no conductor`);
      });
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

export function sampledRouteCenterlineConflicts(routes: readonly RoutedConnection[], cellM = 0.004) {
  const occupied = new Map<string, { owner: string; routeId: string; endpoints: readonly string[] }>();
  const conflicts = new Set<string>();
  [...routes].toSorted((first, second) => second.diameterMm - first.diameterMm).forEach((route) => {
    const owner = route.id;
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1];
      const end = route.points[index];
      const segmentLength = distance(start, end);
      const steps = Math.max(1, Math.ceil(segmentLength / cellM));
      for (let step = 0; step <= steps; step += 1) {
        const fraction = step / steps;
        const key = [0, 1, 2].map((axis) => Math.round((start[axis] + (end[axis] - start[axis]) * fraction) / cellM)).join(",");
        const previous = occupied.get(key);
        if (
          previous && previous.owner !== owner &&
          !previous.endpoints.some((endpoint) => endpoint === route.from || endpoint === route.to)
        ) {
          conflicts.add([previous.routeId, route.id].toSorted().join(" ↔ "));
        } else if (!previous) {
          occupied.set(key, { owner, routeId: route.id, endpoints: [route.from, route.to] });
        }
      }
    }
  });
  return [...conflicts];
}

/** No rendered route may intersect the finite equipment-wall slab anywhere
 * except a declared wall-passthrough aperture. Roof hardware is semantically
 * outside even when its display coordinate uses positive Z, so an infinite
 * sign plane would reject legitimate routes around the physical wall edge. */
export function sampledRouteWallPlaneCrossings(
  routes: readonly RoutedConnection[],
  devices: readonly ResolvedDevice[] = [],
) {
  const crossings = new Set<string>();
  const apertures = devices.filter((device) => (
    device.placement.space === "world" && device.presentation === "wall-passthrough"
  ));
  routes.forEach((route) => {
    const radiusM = route.diameterMm / 2000;
    const minimum = EQUIPMENT_WALL_VOLUME.center.map((value, axis) => (
      value - EQUIPMENT_WALL_VOLUME.size[axis] / 2 - radiusM
    )) as unknown as Vec3;
    const maximum = EQUIPMENT_WALL_VOLUME.center.map((value, axis) => (
      value + EQUIPMENT_WALL_VOLUME.size[axis] / 2 + radiusM
    )) as unknown as Vec3;
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1];
      const end = route.points[index];
      let near = 0;
      let far = 1;
      for (let axis = 0; axis < 3; axis += 1) {
        const delta = end[axis] - start[axis];
        if (Math.abs(delta) < 1e-10) {
          if (start[axis] < minimum[axis] || start[axis] > maximum[axis]) {
            near = 1;
            far = 0;
            break;
          }
          continue;
        }
        const first = (minimum[axis] - start[axis]) / delta;
        const second = (maximum[axis] - start[axis]) / delta;
        near = Math.max(near, Math.min(first, second));
        far = Math.min(far, Math.max(first, second));
        if (near > far) break;
      }
      if (near > far) continue;
      const sampleAt = (fraction: number): Vec3 => [0, 1, 2].map((axis) => (
        start[axis] + (end[axis] - start[axis]) * fraction
      )) as unknown as Vec3;
      const samples = [sampleAt(near), sampleAt((near + far) / 2), sampleAt(far)];
      const whollyInsideAperture = apertures.some((aperture) => samples.every((point) => {
        const local = deviceLocalPoint(aperture, point);
        return Math.abs(local[0]) <= Math.max(0, aperture.size[0] / 2 - radiusM)
          && Math.abs(local[1]) <= Math.max(0, aperture.size[1] / 2 - radiusM);
      }));
      if (!whollyInsideAperture) {
        crossings.add(`${route.id} · segment ${index} · ${start.join(",")} → ${end.join(",")}`);
      }
    }
  });
  return [...crossings];
}

type SegmentClosest = { distance: number; first: Vec3; second: Vec3 };

function closestSegmentPoints(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): SegmentClosest {
  const subtractPoint = (first: Vec3, second: Vec3): Vec3 => [
    first[0] - second[0], first[1] - second[1], first[2] - second[2],
  ];
  const addScaled = (point: Vec3, vector: Vec3, amount: number): Vec3 => [
    point[0] + vector[0] * amount,
    point[1] + vector[1] * amount,
    point[2] + vector[2] * amount,
  ];
  const u = subtractPoint(q1, p1);
  const v = subtractPoint(q2, p2);
  const w = subtractPoint(p1, p2);
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w);
  const e = dot(v, w);
  const denominator = a * c - b * b;
  let sN = 0; let sD = denominator;
  let tN = 0; let tD = denominator;
  if (denominator < 1e-12) {
    sN = 0; sD = 1; tN = e; tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) { sN = 0; tN = e; tD = c; }
    else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0;
    else if (-d > a) sN = sD;
    else { sN = -d; sD = a; }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) sN = 0;
    else if (-d + b > a) sN = sD;
    else { sN = -d + b; sD = a; }
  }
  const firstT = Math.abs(sN) < 1e-12 ? 0 : sN / Math.max(sD, 1e-12);
  const secondT = Math.abs(tN) < 1e-12 ? 0 : tN / Math.max(tD, 1e-12);
  const first = addScaled(p1, u, firstT);
  const second = addScaled(p2, v, secondT);
  return { distance: distance(first, second), first, second };
}

function resolvedDeviceAxes(device: ResolvedDevice) {
  return [
    rotateVector([1, 0, 0], device.rotation),
    rotateVector([0, 1, 0], device.rotation),
    rotateVector([0, 0, 1], device.rotation),
  ] as const;
}

/** Exact oriented-box overlap test used before routing. Surface contact is
 * permitted; positive-volume overlap is not. */
function obbOverlaps(first: ResolvedDevice, second: ResolvedDevice) {
  const firstAxes = resolvedDeviceAxes(first);
  const secondAxes = resolvedDeviceAxes(second);
  const firstHalf = first.size.map((value) => value / 2);
  const secondHalf = second.size.map((value) => value / 2);
  const rotation = firstAxes.map((axis) => secondAxes.map((other) => dot(axis, other)));
  const absolute = rotation.map((row) => row.map((value) => Math.abs(value) + 1e-12));
  const delta: Vec3 = [
    second.position[0] - first.position[0],
    second.position[1] - first.position[1],
    second.position[2] - first.position[2],
  ];
  const translated = firstAxes.map((axis) => dot(delta, axis));
  const separated = (distanceOnAxis: number, firstRadius: number, secondRadius: number) => (
    Math.abs(distanceOnAxis) >= firstRadius + secondRadius - 1e-9
  );
  for (let axis = 0; axis < 3; axis += 1) {
    const secondRadius = secondHalf.reduce((sum, half, index) => sum + half * absolute[axis][index], 0);
    if (separated(translated[axis], firstHalf[axis], secondRadius)) return false;
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const firstRadius = firstHalf.reduce((sum, half, index) => sum + half * absolute[index][axis], 0);
    const distanceOnAxis = translated.reduce((sum, value, index) => sum + value * rotation[index][axis], 0);
    if (separated(distanceOnAxis, firstRadius, secondHalf[axis])) return false;
  }
  for (let firstAxis = 0; firstAxis < 3; firstAxis += 1) {
    for (let secondAxis = 0; secondAxis < 3; secondAxis += 1) {
      const firstRadius = firstHalf[(firstAxis + 1) % 3] * absolute[(firstAxis + 2) % 3][secondAxis]
        + firstHalf[(firstAxis + 2) % 3] * absolute[(firstAxis + 1) % 3][secondAxis];
      const secondRadius = secondHalf[(secondAxis + 1) % 3] * absolute[firstAxis][(secondAxis + 2) % 3]
        + secondHalf[(secondAxis + 2) % 3] * absolute[firstAxis][(secondAxis + 1) % 3];
      const distanceOnAxis = translated[(firstAxis + 2) % 3] * rotation[(firstAxis + 1) % 3][secondAxis]
        - translated[(firstAxis + 1) % 3] * rotation[(firstAxis + 2) % 3][secondAxis];
      if (separated(distanceOnAxis, firstRadius, secondRadius)) return false;
    }
  }
  return true;
}

function segmentIntersectsDevice(start: Vec3, end: Vec3, device: ResolvedDevice, radiusM: number) {
  const localStart = deviceLocalPoint(device, start);
  const localEnd = deviceLocalPoint(device, end);
  let near = 0;
  let far = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = -device.size[axis] / 2 - radiusM;
    const maximum = device.size[axis] / 2 + radiusM;
    const delta = localEnd[axis] - localStart[axis];
    if (Math.abs(delta) < 1e-10) {
      if (localStart[axis] < minimum || localStart[axis] > maximum) return false;
      continue;
    }
    const first = (minimum - localStart[axis]) / delta;
    const second = (maximum - localStart[axis]) / delta;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return true;
}

/** Pre-route physical geometry audit. Junction members compare within their
 * enclosure routing space; world devices compare in world space. Bodyless Y
 * presentations are audited as their real centre-to-arm capsules, never as a
 * phantom rectangular box. */
export function sampledResolvedDeviceOverlaps(devices: readonly ResolvedDevice[]) {
  const conflicts = new Set<string>();
  const sharesSemanticSpace = (first: ResolvedDevice, second: ResolvedDevice) => {
    if (first.placement.space !== second.placement.space) return false;
    if (first.placement.space === "junction" && second.placement.space === "junction") {
      return first.placement.junctionId === second.placement.junctionId;
    }
    return first.presentation === "wall-passthrough"
      || second.presentation === "wall-passthrough"
      || deviceWorldRegion(first) === deviceWorldRegion(second);
  };
  const declaredAttachmentPair = (first: ResolvedDevice, second: ResolvedDevice) => (
    first.attachment?.endpoint.startsWith(`${second.id}.`)
    || second.attachment?.endpoint.startsWith(`${first.id}.`)
  );
  const arms = (device: ResolvedDevice) => device.conductors.map((port) => ({
    start: device.position,
    end: terminalPosition(device, port.id),
    radiusM: (port.terminalDiameterMm ?? 1) / 2000,
  }));
  for (let firstIndex = 0; firstIndex < devices.length; firstIndex += 1) {
    const first = devices[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < devices.length; secondIndex += 1) {
      const second = devices[secondIndex];
      if (!sharesSemanticSpace(first, second) || declaredAttachmentPair(first, second)) continue;
      const firstBodyless = isBodylessPresentation(first);
      const secondBodyless = isBodylessPresentation(second);
      let overlaps = false;
      if (!firstBodyless && !secondBodyless) overlaps = obbOverlaps(first, second);
      else if (firstBodyless && secondBodyless) {
        overlaps = arms(first).some((firstArm) => arms(second).some((secondArm) => (
          closestSegmentPoints(firstArm.start, firstArm.end, secondArm.start, secondArm.end).distance + 1e-9
            < firstArm.radiusM + secondArm.radiusM
        )));
      } else {
        const bodyless = firstBodyless ? first : second;
        const body = firstBodyless ? second : first;
        overlaps = arms(bodyless).some((arm) => segmentIntersectsDevice(arm.start, arm.end, body, arm.radiusM));
      }
      if (overlaps) conflicts.add(`${first.id} ↔ ${second.id}`);
    }
  }
  return [...conflicts];
}

/** Detect a cable folding back through its own swept body. Adjacent segments
 * are one continuous bend and are intentionally ignored; all separated runs
 * must clear one full cable diameter plus the normal routing clearance. */
export function sampledRouteSelfIntersections(
  routes: readonly RoutedConnection[],
  clearanceM = ROUTING_CABLE_CLEARANCE_M,
) {
  const conflicts = new Set<string>();
  routes.forEach((route) => {
    const required = route.diameterMm / 1000 + clearanceM;
    selfSearch: for (let firstSegment = 1; firstSegment < route.points.length; firstSegment += 1) {
      for (let secondSegment = firstSegment + 2; secondSegment < route.points.length; secondSegment += 1) {
        const closest = closestSegmentPoints(
          route.points[firstSegment - 1], route.points[firstSegment],
          route.points[secondSegment - 1], route.points[secondSegment],
        );
        if (closest.distance + 1e-9 < required) {
          conflicts.add(`${route.id} · segments ${firstSegment}/${secondSegment}`);
          break selfSearch;
        }
      }
    }
  });
  return [...conflicts];
}

function routePairHasSweptConflict(
  firstRoute: RoutedConnection,
  secondRoute: RoutedConnection,
  graph: SystemGraph,
  clearanceM = 0,
) {
  const required = firstRoute.diameterMm / 2000 + secondRoute.diameterMm / 2000 + clearanceM;
  const sharedEndpoint = [firstRoute.from, firstRoute.to].find((endpoint) => (
    endpoint === secondRoute.from || endpoint === secondRoute.to
  ));
  const sharedDefinition = sharedEndpoint
    ? graph.devices.flatMap((device) => device.conductors.map((port) => ({ device, port })))
      .find(({ device, port }) => `${device.id}.${port.id}` === sharedEndpoint)?.port
    : undefined;
  const sharedContact = sharedEndpoint && sharedDefinition
    && ["warning", "approved-stack"].includes(sharedDefinition.sharedConnectionPolicy ?? "expand")
    ? (firstRoute.from === sharedEndpoint ? firstRoute.points[0] : firstRoute.points.at(-1)!)
    : undefined;
  // Both cable cylinders necessarily occupy the stacked stud/clamp throat.
  // Permit only the connected local fusion envelope needed to fan out one
  // route cell beyond that contact; every later crossing remains audited.
  const sharedContactReach = geometryMetres(ROUTING_STEP_UNITS) + required * 2 + MAX_SEMANTIC_SECTION_M;
  for (let firstSegment = 1; firstSegment < firstRoute.points.length; firstSegment += 1) {
    for (let secondSegment = 1; secondSegment < secondRoute.points.length; secondSegment += 1) {
      const closest = closestSegmentPoints(
        firstRoute.points[firstSegment - 1], firstRoute.points[firstSegment],
        secondRoute.points[secondSegment - 1], secondRoute.points[secondSegment],
      );
      if (closest.distance + 1e-9 < required) {
        if (sharedContact
          && distance(closest.first, sharedContact) <= sharedContactReach + 1e-9
          && distance(closest.second, sharedContact) <= sharedContactReach + 1e-9) continue;
        return true;
      }
    }
  }
  return false;
}

/** Radius-aware audit; unlike a sampled centerline check this catches visibly
 * touching cylinders in adjacent voxels. */
export function sampledRouteSweptCableConflicts(
  routes: readonly RoutedConnection[],
  graph: SystemGraph,
  clearanceM = ROUTING_CABLE_CLEARANCE_M,
) {
  const conflicts = new Set<string>();
  for (let firstRouteIndex = 0; firstRouteIndex < routes.length; firstRouteIndex += 1) {
    const firstRoute = routes[firstRouteIndex];
    for (let secondRouteIndex = firstRouteIndex + 1; secondRouteIndex < routes.length; secondRouteIndex += 1) {
      const secondRoute = routes[secondRouteIndex];
      if (routePairHasSweptConflict(firstRoute, secondRoute, graph, clearanceM)) {
        conflicts.add([firstRoute.id, secondRoute.id].toSorted().join(" ↔ "));
      }
    }
  }
  return [...conflicts];
}

function routeTurnCount(route: RoutedConnection) {
  let turns = 0;
  for (let index = 1; index < route.points.length - 1; index += 1) {
    const before: Vec3 = [
      Math.sign(route.points[index][0] - route.points[index - 1][0]),
      Math.sign(route.points[index][1] - route.points[index - 1][1]),
      Math.sign(route.points[index][2] - route.points[index - 1][2]),
    ];
    const after: Vec3 = [
      Math.sign(route.points[index + 1][0] - route.points[index][0]),
      Math.sign(route.points[index + 1][1] - route.points[index][1]),
      Math.sign(route.points[index + 1][2] - route.points[index][2]),
    ];
    if (before[0] !== after[0] || before[1] !== after[1] || before[2] !== after[2]) turns += 1;
  }
  return turns;
}

export function sampledRouteDeviceConflicts(
  routes: readonly RoutedConnection[],
  devices: readonly ResolvedDevice[],
) {
  const intersectsBounds = (start: Vec3, end: Vec3, min: Vec3, max: Vec3, dimensions: 2 | 3) => {
    let near = 0;
    let far = 1;
    for (let axis = 0; axis < dimensions; axis += 1) {
      const delta = end[axis] - start[axis];
      if (Math.abs(delta) < 1e-10) {
        if (start[axis] < min[axis] || start[axis] > max[axis]) return false;
        continue;
      }
      const first = (min[axis] - start[axis]) / delta;
      const second = (max[axis] - start[axis]) / delta;
      near = Math.max(near, Math.min(first, second));
      far = Math.min(far, Math.max(first, second));
      if (near > far) return false;
    }
    return true;
  };
  const conflicts = new Set<string>();
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const conductorByEndpoint = new Map<string, ResolvedDevice["conductors"][number]>(devices.flatMap((device) => device.conductors.map((port) => (
    [`${device.id}.${port.id}`, port] as const
  ))));
  const isDeclaredDinSeamTerminal = (
    route: RoutedConnection,
    obstacle: ResolvedDevice,
    start: Vec3,
    end: Vec3,
  ) => [route.from, route.to].some((endpoint) => {
    const owner = deviceById.get(endpointDeviceId(endpoint));
    const definition = conductorByEndpoint.get(endpoint);
    if (
      !owner || !definition
      || owner.placement.space !== "junction"
      || obstacle.placement.space !== "junction"
      || owner.placement.junctionId !== obstacle.placement.junctionId
      || owner.placement.section !== "din"
      || obstacle.placement.section !== "din"
      || (definition.face !== "top" && definition.face !== "bottom")
    ) return false;
    const touchingAlongX = Math.abs(
      Math.abs(owner.position[0] - obstacle.position[0]) - (owner.size[0] + obstacle.size[0]) / 2,
    ) < 1e-8;
    if (!touchingAlongX) return false;
    const conductorId = endpoint.slice(endpoint.lastIndexOf(".") + 1);
    const terminal = terminalPosition(owner, conductorId);
    const obstacleEdgeX = obstacle.position[0]
      + Math.sign(terminal[0] - obstacle.position[0]) * obstacle.size[0] / 2;
    if (Math.abs(terminal[0] - obstacleEdgeX) > 1e-8) return false;
    const direction = rotateVector(directionByFace[definition.face], owner.rotation);
    return [start, end].every((point) => (
      distance(point, terminal) <= 0.050 + 1e-9
      && dot(subtract(point, terminal), direction) >= -1e-9
    ));
  });
  routes.forEach((route) => {
    const endpointDevices = new Set([endpointDeviceId(route.from), endpointDeviceId(route.to)]);
    const endpointDefinitions = [route.from, route.to].map((endpoint) => deviceById.get(endpointDeviceId(endpoint))!);
    const routeJunctions = new Set(endpointDefinitions.flatMap((device) => (
      device.placement.space === "junction" ? [device.placement.junctionId] : []
    )));
    const hasWorldSegment = endpointDefinitions.some((device) => device.placement.space === "world");
    const routeRegions = [route.from, route.to].flatMap((endpoint) => {
      const device = deviceById.get(endpointDeviceId(endpoint));
      const port = conductorByEndpoint.get(endpoint);
      return device?.placement.space === "world" && port
        ? [device.presentation === "wall-passthrough"
          ? port.face === "back" ? "outside" as const : "inside" as const
          : deviceWorldRegion(device)]
        : [];
    });
    const routeRegion: WorldRoutingRegion = routeRegions[0] ?? "inside";
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1];
      const end = route.points[index];
      devices.forEach((device) => {
        if (device.kind === "junction" || isBodylessPresentation(device) || endpointDevices.has(device.id)) return;
        if (device.placement.space === "junction" && !routeJunctions.has(device.placement.junctionId)) return;
        if (device.placement.space === "world" && !hasWorldSegment) return;
        if (routeRegion === "outside") {
          if (device.placement.space === "junction") return;
          if (device.placement.space === "world"
            && device.presentation !== "wall-passthrough"
            && deviceWorldRegion(device) !== "outside") return;
        } else if (device.placement.space === "world"
          && device.presentation !== "wall-passthrough"
          && deviceWorldRegion(device) !== "inside") return;
        const blocksWholeColumn = blocksRoutingColumn(device, devices);
        const routeRadiusM = route.diameterMm / 2000;
        const localStart = deviceLocalPoint(device, start);
        const localEnd = deviceLocalPoint(device, end);
        const min: Vec3 = [
          -device.size[0] / 2 - routeRadiusM,
          -device.size[1] / 2 - routeRadiusM,
          -device.size[2] / 2 - routeRadiusM,
        ];
        const max: Vec3 = [
          device.size[0] / 2 + routeRadiusM,
          device.size[1] / 2 + routeRadiusM,
          device.size[2] / 2 + routeRadiusM,
        ];
        // Audit the same oriented body the router blocks. The previous world
        // AABB treated a cable beside a tilted PV frame as if it passed through
        // the entire diagonal bounding box.
        if (
          intersectsBounds(localStart, localEnd, min, max, blocksWholeColumn ? 2 : 3)
          && !isDeclaredDinSeamTerminal(route, device, start, end)
        ) {
          conflicts.add(`${route.id} ↔ ${device.id}`);
        }
      });
    }
  });
  return [...conflicts];
}

/**
 * Audit the exact centreline authority consumed by TubeGeometry: quadratic
 * route bends plus the selectable cubic Y/breakout arms. This is deliberately
 * offline; the browser only hydrates the already-certified artifact.
 */
export function sampledRenderedGeometryConflicts(
  routes: readonly RoutedConnection[],
  devices: readonly ResolvedDevice[],
  conductors: readonly ResolvedConductor[],
  graph: SystemGraph,
) {
  const conflicts = new Set<string>();
  const piecesByRoute = new Map<string, ReturnType<typeof roundedRoutePieces>>();
  const renderedRoutes = routes.map((route): RoutedConnection => {
    const radiusM = Math.max(0.0012, route.diameterMm / 2000);
    const pieces = roundedRoutePieces(route.points, Math.max(0.009, radiusM * 4.25));
    piecesByRoute.set(route.id, pieces);
    return {
      ...route,
      points: sampleCableCurve(pieces),
    };
  });
  sampledRouteSweptCableConflicts(renderedRoutes, graph).forEach((conflict) => conflicts.add(`route-swept · ${conflict}`));
  sampledRouteDeviceConflicts(renderedRoutes, devices).forEach((conflict) => conflicts.add(`route-device · ${conflict}`));
  sampledRouteWallPlaneCrossings(renderedRoutes, devices).forEach((conflict) => conflicts.add(`route-wall · ${conflict}`));

  const hasNonlocalSelfConflict = (
    pieces: ReturnType<typeof roundedRoutePieces>,
    radiusM: number,
  ) => {
    const required = radiusM * 2 + ROUTING_CABLE_CLEARANCE_M;
    const sampledPieces = pieces.map((piece) => {
      const points = sampleCableCurve([piece]);
      const cumulative = [0];
      for (let index = 1; index < points.length; index += 1) {
        cumulative.push(cumulative.at(-1)! + distance(points[index - 1], points[index]));
      }
      return { points, cumulative };
    });
    const pieceStarts = pieces.map((_, index) => pieces.slice(0, index).reduce((sum, piece) => sum + piece.lengthM, 0));
    // Same and adjacent curve pieces are one topologically local TubeGeometry
    // neighbourhood and necessarily share overlapping cross-sections. Compare
    // only pieces separated by at least one complete source piece; this keeps
    // provenance instead of guessing locality from dense sample indices.
    for (let firstPiece = 0; firstPiece < pieces.length; firstPiece += 1) {
      const firstPoints = sampledPieces[firstPiece].points;
      // line/bend/line is one complete local elbow neighbourhood. The first
      // independent run begins only after that three-piece provenance span.
      for (let secondPiece = firstPiece + 3; secondPiece < pieces.length; secondPiece += 1) {
        const secondPoints = sampledPieces[secondPiece].points;
        for (let first = 1; first < firstPoints.length; first += 1) {
          for (let second = 1; second < secondPoints.length; second += 1) {
            const alongCurveGap = pieceStarts[secondPiece] + sampledPieces[secondPiece].cumulative[second - 1]
              - (pieceStarts[firstPiece] + sampledPieces[firstPiece].cumulative[first]);
            // Consecutive thick elbows can be separated by only a short
            // straight yet remain one local manifold neighbourhood. One swept
            // circumference is a conservative local-curvature reach; folds
            // farther apart along the cable remain fully audited.
            if (alongCurveGap <= required * Math.PI + 1e-9) continue;
            if (closestSegmentPoints(
              firstPoints[first - 1], firstPoints[first], secondPoints[second - 1], secondPoints[second],
            ).distance + 1e-9 < required) return true;
          }
        }
      }
    }
    return false;
  };
  renderedRoutes.forEach((route) => {
    const radiusM = Math.max(0.0012, route.diameterMm / 2000);
    const pieces = piecesByRoute.get(route.id)!;
    if (hasNonlocalSelfConflict(pieces, radiusM)) {
      conflicts.add(`route-self · ${route.id}`);
    }
    pieces.filter((piece) => piece.bend).forEach((piece, bendIndex) => {
      const points = sampleCableCurve([piece]);
      let minimumRadius = Number.POSITIVE_INFINITY;
      for (let index = 1; index < points.length - 1; index += 1) {
        const first = points[index - 1];
        const middle = points[index];
        const last = points[index + 1];
        const firstVector: Vec3 = [middle[0] - first[0], middle[1] - first[1], middle[2] - first[2]];
        const secondVector: Vec3 = [last[0] - middle[0], last[1] - middle[1], last[2] - middle[2]];
        const chordVector: Vec3 = [last[0] - first[0], last[1] - first[1], last[2] - first[2]];
        const cross: Vec3 = [
          firstVector[1] * secondVector[2] - firstVector[2] * secondVector[1],
          firstVector[2] * secondVector[0] - firstVector[0] * secondVector[2],
          firstVector[0] * secondVector[1] - firstVector[1] * secondVector[0],
        ];
        const doubleArea = Math.hypot(...cross);
        if (doubleArea < 1e-12) continue;
        const circumradius = Math.hypot(...firstVector) * Math.hypot(...secondVector) * Math.hypot(...chordVector)
          / (2 * doubleArea);
        minimumRadius = Math.min(minimumRadius, circumradius);
      }
      if (minimumRadius + 1e-6 < radiusM * 1.1 + ROUTING_CABLE_CLEARANCE_M) {
        conflicts.add(`route-curvature · ${route.id} bend ${bendIndex + 1} radius ${minimumRadius.toFixed(5)}m`);
      }
    });
  });

  const semantic = renderedSemanticCables(devices, conductors, routes).map((cable) => ({
    ...cable,
    points: sampleCableCurve(cable.pieces),
  }));
  const conductorByKey = new Map(conductors.map((port) => [port.key, port]));
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const pairConflicts = (
    firstPoints: readonly Vec3[],
    firstRadius: number,
    secondPoints: readonly Vec3[],
    secondRadius: number,
    allowedContact?: Vec3,
    allowedContactRadius?: number,
  ) => {
    const required = firstRadius + secondRadius + ROUTING_CABLE_CLEARANCE_M;
    for (let first = 1; first < firstPoints.length; first += 1) {
      for (let second = 1; second < secondPoints.length; second += 1) {
        const closest = closestSegmentPoints(
          firstPoints[first - 1], firstPoints[first], secondPoints[second - 1], secondPoints[second],
        );
        if (closest.distance + 1e-9 >= required) continue;
        const contactRadius = allowedContactRadius ?? required;
        if (allowedContact
          && distance(closest.first, allowedContact) <= contactRadius + 1e-6
          && distance(closest.second, allowedContact) <= contactRadius + 1e-6) continue;
        return true;
      }
    }
    return false;
  };
  const directionAwayFromContact = (points: readonly Vec3[], contact: Vec3) => {
    const fromStart = distance(points[0], contact) <= distance(points.at(-1)!, contact);
    const near = fromStart ? points[0] : points.at(-1)!;
    const next = fromStart ? points[1] : points.at(-2)!;
    const delta: Vec3 = [next[0] - near[0], next[1] - near[1], next[2] - near[2]];
    const length = Math.max(1e-12, Math.hypot(...delta));
    return scale(delta, 1 / length);
  };
  const sharedJointEnvelope = (
    firstPoints: readonly Vec3[],
    firstRadius: number,
    secondPoints: readonly Vec3[],
    secondRadius: number,
    contact: Vec3,
  ) => {
    const firstDirection = directionAwayFromContact(firstPoints, contact);
    const secondDirection = directionAwayFromContact(secondPoints, contact);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(firstDirection, secondDirection))));
    if (angle < 1e-6) return undefined;
    const required = firstRadius + secondRadius + ROUTING_CABLE_CLEARANCE_M;
    // For acute rays, the closest point on the peer ray stays ahead of the
    // split and overlap extends required/sin(theta). At 90° or more, the split
    // itself is closest. One sampled semantic section covers tessellation.
    const rayEnvelope = (angle < Math.PI / 2
      ? required / Math.max(1e-6, Math.sin(angle))
      : required) + MAX_SEMANTIC_SECTION_M;
    // Cubic Y arms follow those tangents but can remain fused slightly beyond
    // the ideal-ray envelope. Find only the connected overlap component that
    // begins at the declared split. A later crossing after the curves have
    // separated is a different component and still fails pairConflicts.
    const oriented = (points: readonly Vec3[]) => (
      distance(points[0], contact) <= distance(points.at(-1)!, contact) ? [...points] : [...points].reverse()
    );
    const firstOriented = oriented(firstPoints);
    const secondOriented = oriented(secondPoints);
    const localContacts = new Map<string, number>();
    for (let first = 1; first < firstOriented.length; first += 1) {
      for (let second = 1; second < secondOriented.length; second += 1) {
        const closest = closestSegmentPoints(
          firstOriented[first - 1], firstOriented[first], secondOriented[second - 1], secondOriented[second],
        );
        if (closest.distance + 1e-9 >= required) continue;
        localContacts.set(`${first}:${second}`, Math.max(
          distance(closest.first, contact), distance(closest.second, contact),
        ));
      }
    }
    const pending: Array<[number, number]> = localContacts.has("1:1") ? [[1, 1]] : [];
    const visited = new Set<string>();
    let connectedFusionReach = 0;
    while (pending.length > 0) {
      const [first, second] = pending.pop()!;
      const key = `${first}:${second}`;
      if (visited.has(key) || !localContacts.has(key)) continue;
      visited.add(key);
      connectedFusionReach = Math.max(connectedFusionReach, localContacts.get(key)!);
      for (let firstOffset = -1; firstOffset <= 1; firstOffset += 1) {
        for (let secondOffset = -1; secondOffset <= 1; secondOffset += 1) {
          if (firstOffset === 0 && secondOffset === 0) continue;
          pending.push([first + firstOffset, second + secondOffset]);
        }
      }
    }
    const fusionReachesTerminal = [...visited].some((key) => {
      const [first, second] = key.split(":").map(Number);
      return first >= firstOriented.length - 1 || second >= secondOriented.length - 1;
    });
    // A valid Y must become distinct conductors before both field terminals.
    // If its connected overlap component reaches either final segment, retain
    // only the ideal-ray allowance so pairConflicts reports the fused arms.
    if (fusionReachesTerminal) return rayEnvelope;
    return Math.max(rayEnvelope, connectedFusionReach + MAX_SEMANTIC_SECTION_M);
  };

  semantic.forEach((cable) => {
    if (hasNonlocalSelfConflict([...cable.pieces], cable.radiusM)) conflicts.add(`semantic-self · ${cable.id}`);
    const owner = devices.find((device) => device.id === cable.deviceId)!;
    if (owner.presentation === "integrated-cable-breakout") {
      // Integrated breakouts deliberately leave the body envelope: their
      // coloured cores begin at real device contacts and fuse into the routed
      // multicore cable in free space. Audit that physical contract directly
      // instead of applying the bodyless-symbol OBB rule to outside geometry.
      const semanticPort = conductorByKey.get(cable.conductorKey)!;
      const multicorePort = owner.conductors.find((port) => (
        port.kind === "multicore"
        && port.internalMates?.includes(semanticPort.id)
        && semanticPort.internalMates?.includes(port.id)
      ));
      const resolvedMulticore = multicorePort
        ? conductorByKey.get(`${owner.id}.${multicorePort.id}`)
        : undefined;
      const outwardLength = resolvedMulticore ? Math.hypot(...resolvedMulticore.direction) : 0;
      const outward = resolvedMulticore && outwardLength > 1e-12
        ? scale(resolvedMulticore.direction, 1 / outwardLength)
        : undefined;
      const beginsAtDeclaredContact = distance(cable.points[0], semanticPort.position) <= 1e-7;
      const endsAtDeclaredSplit = distance(cable.points.at(-1)!, cable.splitPoint) <= 1e-7;
      const splitIsOutside = Boolean(resolvedMulticore && outward
        && dot(subtract(cable.splitPoint, resolvedMulticore.position), outward)
          > cable.radiusM + ROUTING_CABLE_CLEARANCE_M);
      const staysOutsideFace = Boolean(outward && cable.points.every((point) => (
        dot(subtract(point, semanticPort.position), outward) >= -1e-7
      )));
      if (!beginsAtDeclaredContact || !endsAtDeclaredSplit || !splitIsOutside || !staysOutsideFace) {
        conflicts.add(`semantic-integrated-face · ${cable.id}`);
      }
    } else {
      // Bodyless semantic symbols must remain in their declared envelope. Port
      // centres lie on the symbol face, so expand the OBB by its largest arm.
      const envelopePadding = Math.max(...semantic
        .filter((peer) => peer.deviceId === cable.deviceId)
        .map((peer) => peer.radiusM));
      const leavesDeclaredEnvelope = cable.points.some((point) => {
        const local = deviceLocalPoint(owner, point);
        return local.some((value, axis) => (
          Math.abs(value) + cable.radiusM > owner.size[axis] / 2 + envelopePadding + 1e-7
        ));
      });
      if (leavesDeclaredEnvelope) conflicts.add(`semantic-envelope · ${cable.id}`);
    }
    const pseudo: RoutedConnection = {
      id: `semantic:${cable.id}`,
      from: cable.conductorKey,
      to: cable.conductorKey,
      kind: conductorByKey.get(cable.conductorKey)!.kind,
      cableId: "rendered-semantic",
      points: cable.points,
      lengthM: cable.points.slice(1).reduce((sum, point, index) => sum + distance(cable.points[index], point), 0),
      diameterMm: cable.radiusM * 2000,
      routed: true,
      routingRank: -1,
    };
    sampledRouteDeviceConflicts([pseudo], devices).forEach((conflict) => conflicts.add(`semantic-device · ${conflict}`));
    sampledRouteWallPlaneCrossings([pseudo], devices).forEach((conflict) => conflicts.add(`semantic-wall · ${conflict}`));
    renderedRoutes.forEach((route) => {
      const semanticPort = conductorByKey.get(cable.conductorKey)!;
      const directSharedEndpoint = [route.from, route.to].find((endpoint) => endpoint === cable.conductorKey);
      const internallySharedEndpoint = [route.from, route.to].find((endpoint) => {
        const routePort = conductorByKey.get(endpoint);
        return routePort?.deviceId === semanticPort.deviceId
          && semanticPort.internalMates?.includes(routePort.id)
          && routePort.internalMates?.includes(semanticPort.id);
      });
      const contactPort = conductorByKey.get(directSharedEndpoint ?? internallySharedEndpoint ?? "");
      const semanticOwner = deviceById.get(cable.deviceId);
      const contact = internallySharedEndpoint && semanticOwner?.presentation === "integrated-cable-breakout"
        ? cable.splitPoint
        : contactPort?.position;
      const routeRadius = Math.max(0.0012, route.diameterMm / 2000);
      const jointEnvelope = contact
        ? sharedJointEnvelope(cable.points, cable.radiusM, route.points, routeRadius, contact)
        : undefined;
      if (pairConflicts(
        cable.points,
        cable.radiusM,
        route.points,
        routeRadius,
        contact,
        jointEnvelope,
      )) conflicts.add(`semantic-route · ${cable.id} ↔ ${route.id}`);
    });
  });
  for (let first = 0; first < semantic.length; first += 1) {
    for (let second = first + 1; second < semantic.length; second += 1) {
      const firstCable = semantic[first];
      const secondCable = semantic[second];
      const sameDevice = firstCable.deviceId === secondCable.deviceId
        && distance(firstCable.splitPoint, secondCable.splitPoint) < 1e-7;
      let contact: Vec3 | undefined;
      let jointEnvelope: number | undefined;
      if (sameDevice) {
        contact = firstCable.splitPoint;
        jointEnvelope = sharedJointEnvelope(
          firstCable.points, firstCable.radiusM, secondCable.points, secondCable.radiusM, contact,
        );
      }
      if (pairConflicts(
        firstCable.points, firstCable.radiusM, secondCable.points, secondCable.radiusM,
        contact, jointEnvelope,
      )) conflicts.add(`semantic-swept · ${firstCable.id} ↔ ${secondCable.id}`);
    }
  }
  const result = [...conflicts];
  renderedGeometryFailureDiagnostics.splice(0, renderedGeometryFailureDiagnostics.length, ...result);
  return result;
}

let cached: GraphRuntime | undefined;

/** Geometry-only seam for enclosure sizing and placement audits. It does not
 * invoke the router, so a placement problem can be inspected even when it has
 * made the route graph unsatisfiable. */
export function resolveSystemGeometry(
  graph: SystemGraph,
  options: { auditOverlaps?: boolean } = {},
) {
  validateGraph(graph);
  const devices = resolveDevices(graph);
  const conductors = resolveConductors(devices);
  const glands = resolveGlands(graph, devices);
  const axisAlignedDevice = (device: ResolvedDevice) => ([
    rotateVector([1, 0, 0], device.rotation),
    rotateVector([0, 1, 0], device.rotation),
    rotateVector([0, 0, 1], device.rotation),
  ].every((basis) => basis.filter((value) => Math.abs(value) > 1e-9).length === 1));
  devices.filter(axisAlignedDevice).forEach((device) => {
    const exactPosition = vectorMetres(vectorUnits(device.position));
    if (distance(device.position, exactPosition) > 1e-7) throw new Error(`${device.id}: position is off the 10 mm geometry lattice`);
    const stepUnits = device.placement.space === "junction"
      ? JUNCTION_ROUTING_STEP_UNITS
      : WORLD_ROUTING_STEP_UNITS;
    // An enclosure with an even number of 10 mm geometry units can have its
    // centre half a 20 mm route cell from the wall grid while both shell faces
    // and every mounted terminal remain grid-aligned.
    if (device.kind !== "junction" && vectorUnits(device.position).some((value) => value % stepUnits !== 0)) {
      throw new Error(`${device.id}: centre is off its integer route lattice`);
    }
    if (device.size.some((value) => Math.abs(value - geometryMetres(geometryUnits(value))) > 1e-7)) {
      throw new Error(`${device.id}: size is off the 10 mm geometry lattice`);
    }
  });
  conductors.forEach((conductor) => {
    const axisAligned = conductor.direction.filter((value) => Math.abs(value) > 1e-9).length === 1;
    if (!axisAligned) return;
    const exact = vectorMetres(vectorUnits(conductor.position));
    if (distance(conductor.position, exact) > 1e-7) throw new Error(`${conductor.key}: off the 10 mm geometry lattice`);
    const owner = devices.find((device) => device.id === conductor.deviceId)!;
    const stepUnits = owner.placement.space === "junction"
      ? JUNCTION_ROUTING_STEP_UNITS
      : WORLD_ROUTING_STEP_UNITS;
    if (vectorUnits(conductor.position).some((value) => value % stepUnits !== 0)) {
      throw new Error(`${conductor.key}: off its integer route lattice`);
    }
  });
  const deviceOverlaps = options.auditOverlaps === false ? [] : sampledResolvedDeviceOverlaps(devices);
  if (deviceOverlaps.length > 0) {
    throw new Error(`Resolved device geometry overlaps:\n${deviceOverlaps.join("\n")}`);
  }
  return {
    devices,
    deviceById: new Map(devices.map((device) => [device.id, device])),
    conductors,
    conductorByKey: new Map(conductors.map((candidate) => [candidate.key, candidate])),
    glands,
  };
}

export function buildSystemRuntime(graph: SystemGraph): GraphRuntime {
  if (cached?.graph === graph) return cached;
  const started = typeof performance === "undefined" ? Date.now() : performance.now();
  routingFailureDiagnostics.length = 0;
  validateGraph(graph);
  const { devices, conductors, glands } = resolveSystemGeometry(graph);
  const routed = buildRoutes(graph, devices, conductors, glands);
  const routedAt = typeof performance === "undefined" ? Date.now() : performance.now();
  // The serial, radius-aware A* result is final. There is deliberately no
  // post-route nudge/repair stage that can add local kinks or violate solve
  // precedence after a route has been committed.
  const resolvedRoutes = routed.routes;
  const centerlineConflicts = sampledRouteCenterlineConflicts(resolvedRoutes, 0.0005);
  const sweptCableConflicts = sampledRouteSweptCableConflicts(resolvedRoutes, graph);
  const selfIntersections = sampledRouteSelfIntersections(resolvedRoutes);
  const deviceConflicts = sampledRouteDeviceConflicts(resolvedRoutes, devices);
  const wallPlaneCrossings = sampledRouteWallPlaneCrossings(resolvedRoutes, devices);
  if (wallPlaneCrossings.length > 0) {
    throw new Error(`Routes cross the inside/outside wall plane:\n${wallPlaneCrossings.join("\n")}`);
  }
  const renderedAuditStarted = typeof performance === "undefined" ? Date.now() : performance.now();
  const renderedGeometryConflicts = sampledRenderedGeometryConflicts(
    resolvedRoutes,
    devices,
    conductors,
    graph,
  );
  const currentSafety = verifyCurrentProtection(graph);
  const finished = typeof performance === "undefined" ? Date.now() : performance.now();
  cached = {
    graph,
    devices,
    deviceById: new Map(devices.map((device) => [device.id, device])),
    conductors,
    conductorByKey: new Map(conductors.map((candidate) => [candidate.key, candidate])),
    glands,
    routes: resolvedRoutes,
    routeById: new Map(resolvedRoutes.map((route) => [route.id, route])),
    diagnostics: {
      buildMs: finished - started,
      routingMs: routedAt - started,
      renderedAuditMs: finished - renderedAuditStarted,
      hydrateMs: 0,
      source: "solver",
      artifactBytes: 0,
      routed: routed.routes.length - routed.fallbackCount,
      fallbacks: routed.fallbackCount,
      occupiedCells: routed.occupiedCells,
      centerlineConflicts: centerlineConflicts.length,
      sweptCableConflicts: sweptCableConflicts.length,
      selfIntersections: selfIntersections.length,
      deviceConflicts: deviceConflicts.length,
      renderedGeometryConflicts: renderedGeometryConflicts.length,
      totalLengthM: resolvedRoutes.reduce((sum, route) => sum + route.lengthM, 0),
      totalTurns: resolvedRoutes.reduce((sum, route) => sum + routeTurnCount(route), 0),
      routingOrder: [...resolvedRoutes]
        .toSorted((first, second) => first.routingRank - second.routingRank)
        .map((route) => route.id),
      currentSafety,
    },
  };
  return cached;
}
