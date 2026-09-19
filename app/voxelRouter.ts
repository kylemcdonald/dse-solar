import { graphWalls } from "./systemGraph";
import type {
  Connection,
  Gland,
  ResolvedConductor,
  ResolvedDevice,
  RoutedConnection,
  SystemGraph,
  Vec3,
} from "./systemGraph";
import {
  ROUTE_CELL_M,
  add,
  deviceLocalPoint,
  distance,
  dot,
  hasLateralPosts,
  isBodyless,
  isLateralPost,
  normalize,
  scale,
  subtract,
  worldHalfExtents,
  worldPoint,
  rotateVector,
} from "./physicalLayout";

/**
 * Voxel cable router.
 *
 * One 20 mm lattice covers the whole installation. Every cell is either free,
 * part of a device body (including the mounting gap behind it), in the
 * open-front column of a rear-mounted device, an enclosure shell, or an
 * enclosure gland "door". Cables are solved one at a time, thickest first,
 * with an exact turn-aware A* (state = cell × heading) under an admissible
 * heuristic, then improved by rip-up-and-reroute passes. Because the lattice
 * pitch exceeds the largest cable diameter, exclusive cell occupancy alone
 * guarantees that no two cables touch.
 *
 * Terminals launch straight out of their declared face into one lattice cell.
 * Distribution-bar posts instead land in the routing plane just above or just
 * below the bar (a short ring-lug lead joins the screw to that cell), so a bar
 * is met from any in-plane direction and never from the front.
 */

const DIRS: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const AXIS_OF_DIR = [0, 0, 1, 1, 2, 2];

const FLAG_BLOCKED = 1;
const FLAG_COLUMN = 2;
const FLAG_DOOR = 4;

export type RouterOptions = {
  /** Cost of a heading change, in cells. */
  turnCost?: number;
  /** Extra cost of moving along the depth axis, in cells. */
  depthStepCost?: number;
  /** Cost per cell per cell of distance from the preferred routing plane. */
  planeCost?: number;
  /** Rip-up-and-reroute improvement passes after the serial solve. */
  improvementPasses?: number;
  /** Initial half-size of the per-route search box, in cells. */
  searchMargin?: number;
};

export type RouterDiagnostics = {
  routingMs: number;
  routed: number;
  fallbacks: number;
  occupiedCells: number;
  totalLengthM: number;
  totalTurns: number;
  expansions: number;
  routingOrder: string[];
  failures: Array<{ connectionId: string; reason: string }>;
  targetAssignments: Array<{ connectionId: string; side: "from" | "to"; authoredEndpoint: string; resolvedEndpoint: string }>;
};

type Launch = {
  cell: number;
  /** Heading of a cable leaving the device through this cell. */
  outDir: number;
  /** Lead from the terminal to this cell is under one cell, so a thick cable
   * must continue straight through the cell before it may bend. */
  shortLead: boolean;
};

type Endpoint = {
  key: string;
  device: ResolvedDevice;
  conductor: ResolvedConductor;
  /** Terminal point on the device surface. */
  point: Vec3;
  /** Unit outward direction of the terminal. */
  direction: Vec3;
  /** Candidate first cells in the field (resolved lazily). */
  launches: Launch[];
  /** Interchangeable-post group key when this landing may be exchanged. */
  groupKey?: string;
};

type RouteJob = {
  index: number;
  connection: Connection;
  diameterMm: number;
  fromCandidates: Endpoint[];
  toCandidates: Endpoint[];
  from?: Endpoint;
  to?: Endpoint;
  fromLaunch?: Launch;
  toLaunch?: Launch;
  regions: Set<number>;
  glands: Set<number>;
  /** Cells holding this cable's own terminal leads; never part of its field path. */
  stubCells: Set<number>;
  /** Device indices whose open-front column this cable may use near the face. */
  deviceIndices: Set<number>;
  cells: number[];
  points: Vec3[];
  cost: number;
  routed: boolean;
  direct: boolean;
};

class MinHeap {
  keys = new Float64Array(1024);
  ids = new Int32Array(1024);
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

export class VoxelGrid {
  readonly cell = ROUTE_CELL_M;
  readonly min: Vec3;
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly flags: Uint8Array;
  readonly region: Int16Array;
  readonly doorGland: Int16Array;
  /** Committed path cells: route index + 1. */
  readonly occupant: Int32Array;
  /** Cells held for one route regardless of its path: launches, doors, stubs. */
  readonly reserved: Int32Array;
  /** Additional routes sharing a cell during negotiation (never in a final solution). */
  readonly extras = new Map<number, Set<number>>();
  /** Open-front column ownership: device index + 1 and cells beyond its face. */
  readonly columnDevice: Int16Array;
  readonly columnDepth: Uint8Array;
  /** Landing cells of interchangeable-post groups. */
  readonly postGroup = new Map<number, string>();
  readonly postOfCell = new Map<number, string>();
  readonly postUsage = new Map<string, { capacity: number; used: number }>();
  readonly planes: Map<number, { axis: number; coordinate: number }>;
  readonly walls: ReturnType<typeof graphWalls>;

  constructor(min: Vec3, max: Vec3, planes: Map<number, { axis: number; coordinate: number }>, walls: ReturnType<typeof graphWalls>) {
    this.min = min;
    this.nx = Math.round((max[0] - min[0]) / this.cell) + 1;
    this.ny = Math.round((max[1] - min[1]) / this.cell) + 1;
    this.nz = Math.round((max[2] - min[2]) / this.cell) + 1;
    const count = this.nx * this.ny * this.nz;
    this.flags = new Uint8Array(count);
    this.region = new Int16Array(count);
    this.doorGland = new Int16Array(count);
    this.occupant = new Int32Array(count);
    this.reserved = new Int32Array(count);
    this.columnDevice = new Int16Array(count);
    this.columnDepth = new Uint8Array(count);
    this.planes = planes;
    this.walls = walls;
  }
  index(ix: number, iy: number, iz: number) { return (ix * this.ny + iy) * this.nz + iz; }
  coords(index: number): [number, number, number] {
    const iz = index % this.nz; const rest = (index - iz) / this.nz;
    const iy = rest % this.ny; const ix = (rest - iy) / this.ny;
    return [ix, iy, iz];
  }
  toCell(point: Vec3): [number, number, number] {
    return [
      Math.round((point[0] - this.min[0]) / this.cell),
      Math.round((point[1] - this.min[1]) / this.cell),
      Math.round((point[2] - this.min[2]) / this.cell),
    ];
  }
  inBounds(ix: number, iy: number, iz: number) {
    return ix >= 0 && iy >= 0 && iz >= 0 && ix < this.nx && iy < this.ny && iz < this.nz;
  }
  world(index: number): Vec3 {
    const [ix, iy, iz] = this.coords(index);
    return [
      Number((this.min[0] + ix * this.cell).toFixed(7)),
      Number((this.min[1] + iy * this.cell).toFixed(7)),
      Number((this.min[2] + iz * this.cell).toFixed(7)),
    ];
  }
  cellAt(point: Vec3) {
    const cell = this.toCell(point);
    return this.inBounds(cell[0], cell[1], cell[2]) ? this.index(cell[0], cell[1], cell[2]) : -1;
  }
  planeDistance(index: number) {
    const coordinate = (axis: number) => this.min[axis] + (axis === 2 ? index % this.nz
      : axis === 0 ? Math.floor(index / (this.ny * this.nz)) : Math.floor(index / this.nz) % this.ny) * this.cell;
    const plane = this.planes.get(this.region[index]);
    if (plane) return Math.abs(coordinate(plane.axis) - plane.coordinate);
    return Math.min(...this.walls.map((wall) => {
      const axis = wall.normal.findIndex((n) => Math.abs(n) > 0.5);
      const at = coordinate(axis);
      const direction = at >= wall.center[axis] ? 1 : -1;
      return Math.abs(at - (wall.center[axis] + direction * (wall.size[axis] / 2 + this.cell * 2)));
    }));
  }
}

function forEachCellInBox(grid: VoxelGrid, lo: Vec3, hi: Vec3, visit: (index: number, point: Vec3) => void) {
  const [x0, y0, z0] = grid.toCell([lo[0], lo[1], lo[2]]).map((v) => Math.max(0, v - 1));
  const [x1, y1, z1] = grid.toCell([hi[0], hi[1], hi[2]]);
  for (let ix = x0; ix <= Math.min(grid.nx - 1, x1 + 1); ix += 1) {
    const x = grid.min[0] + ix * grid.cell;
    if (x < lo[0] - 1e-9 || x > hi[0] + 1e-9) continue;
    for (let iy = y0; iy <= Math.min(grid.ny - 1, y1 + 1); iy += 1) {
      const y = grid.min[1] + iy * grid.cell;
      if (y < lo[1] - 1e-9 || y > hi[1] + 1e-9) continue;
      for (let iz = z0; iz <= Math.min(grid.nz - 1, z1 + 1); iz += 1) {
        const z = grid.min[2] + iz * grid.cell;
        if (z < lo[2] - 1e-9 || z > hi[2] + 1e-9) continue;
        visit(grid.index(ix, iy, iz), [x, y, z]);
      }
    }
  }
}

/** A cell touches a body when its centre lies inside the body expanded by a
 * small margin; on the 10 mm face lattice this exactly captures every cell
 * whose 20 mm envelope would intersect the body. */
const BODY_MARGIN = 0.005;

function insideDevice(device: ResolvedDevice, point: Vec3, margin = BODY_MARGIN) {
  const local = deviceLocalPoint(device, point);
  return Math.abs(local[0]) <= device.size[0] / 2 + margin
    && Math.abs(local[1]) <= device.size[1] / 2 + margin
    && Math.abs(local[2]) <= device.size[2] / 2 + margin;
}

function deviceAabb(device: ResolvedDevice) {
  const half = worldHalfExtents(device);
  return { lo: subtract(device.position, half), hi: add(device.position, half) };
}

const pad = (point: Vec3, amount: number): Vec3 => [point[0] + amount, point[1] + amount, point[2] + amount];

/** Gland door column: two cells outside the shell and exactly the first
 * interior row inside it, so the interior lane row stays free for lateral
 * moves. */
const doorReach = (padding: number): [number, number] => [
  ROUTE_CELL_M * 2 + BODY_MARGIN,
  Math.ceil((padding - 1e-9) / ROUTE_CELL_M) * ROUTE_CELL_M + BODY_MARGIN,
];

/** Axis-aligned wall frames also cover rotated north/west enclosure interiors. */
function localBox(grid: VoxelGrid, device: ResolvedDevice, lo: Vec3, hi: Vec3, visit: (index: number, point: Vec3) => void) {
  const corners = [lo[0], hi[0]].flatMap((x) => [lo[1], hi[1]].flatMap((y) => [lo[2], hi[2]].map((z) => worldPoint(device, [x, y, z]))));
  const minimum = [0, 1, 2].map((axis) => Math.min(...corners.map((p) => p[axis]))) as unknown as Vec3;
  const maximum = [0, 1, 2].map((axis) => Math.max(...corners.map((p) => p[axis]))) as unknown as Vec3;
  forEachCellInBox(grid, minimum, maximum, visit);
}

export function buildVoxelGrid(graph: SystemGraph, devices: readonly ResolvedDevice[], glands: readonly Gland[]) {
  const walls = graphWalls(graph);
  const margin = 0.30;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const include = (point: Vec3) => {
    for (let axis = 0; axis < 3; axis += 1) {
      lo[axis] = Math.min(lo[axis], point[axis]);
      hi[axis] = Math.max(hi[axis], point[axis]);
    }
  };
  devices.forEach((device) => { const box = deviceAabb(device); include(box.lo); include(box.hi); });
  walls.forEach((wall) => { include(subtract(wall.center, scale(wall.size, 0.5))); include(add(wall.center, scale(wall.size, 0.5))); });
  const snapDown = (value: number) => Math.floor((value - margin) / ROUTE_CELL_M) * ROUTE_CELL_M;
  const snapUp = (value: number) => Math.ceil((value + margin) / ROUTE_CELL_M) * ROUTE_CELL_M;
  const junctionIndex = new Map(graph.junctions.map((junction, index) => [junction.deviceId, index + 1]));
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const planes = new Map<number, { axis: number; coordinate: number }>();
  graph.junctions.forEach((junction) => {
    const device = deviceById.get(junction.deviceId)!;
    const normal = rotateVector([0, 0, 1], device.rotation);
    const axis = normal.findIndex((n) => Math.abs(n) > 0.5);
    const point = worldPoint(device, [0, 0, -device.size[2] / 2 + ROUTE_CELL_M * 2]);
    planes.set(junctionIndex.get(junction.deviceId)!, { axis, coordinate: point[axis] });
  });
  const grid = new VoxelGrid([snapDown(lo[0]), snapDown(lo[1]), snapDown(lo[2])], [snapUp(hi[0]), snapUp(hi[1]), snapUp(hi[2])], planes, walls);
  // The charging shelf is solid equipment, including the cable's radius.
  if (graph.site?.shelf) {
    const { center, size } = graph.site.shelf;
    const clearance = Math.max(BODY_MARGIN, ...graph.cables.map(cable => cable.outsideDiameterMm / 2000));
    forEachCellInBox(grid, pad(subtract(center, scale(size, 0.5)), -clearance), pad(add(center, scale(size, 0.5)), clearance), index => { grid.flags[index] |= FLAG_BLOCKED; });
  }
  const reach = Math.max(...hi.map((value, axis) => value - lo[axis])) + 1;
  const passthroughs = devices.filter((device) => device.presentation === "wall-passthrough");
  walls.forEach((wall) => {
    const wallLo = subtract(wall.center, scale(wall.size, 0.5));
    const wallHi = add(wall.center, scale(wall.size, 0.5));
    forEachCellInBox(grid, pad(wallLo, -BODY_MARGIN), pad(wallHi, BODY_MARGIN), (index, point) => {
      const aperture = passthroughs.some((device) => {
        if (device.placement.space === "world" && device.placement.wallId && device.placement.wallId !== wall.id) return false;
        const local = deviceLocalPoint(device, point);
        return Math.abs(local[0]) <= device.size[0] / 2 - BODY_MARGIN && Math.abs(local[1]) <= device.size[1] / 2 - BODY_MARGIN;
      });
      if (!aperture) grid.flags[index] |= FLAG_BLOCKED;
    });
  });
  graph.junctions.forEach((junction) => {
    const container = deviceById.get(junction.deviceId)!;
    const regionId = junctionIndex.get(junction.deviceId)!;
    const box = deviceAabb(container);
    const inset = junction.padding;
    const [w, h, d] = container.size.map((size) => size / 2);
    forEachCellInBox(grid, pad(box.lo, -BODY_MARGIN), pad(box.hi, BODY_MARGIN), (index, point) => {
      const local = deviceLocalPoint(container, point);
      const interior = Math.abs(local[0]) <= w - inset + 1e-9 && Math.abs(local[1]) <= h - inset + 1e-9
        && local[2] >= -d + inset - 1e-9 && local[2] <= d + 1e-9;
      if (interior) grid.region[index] = regionId;
      else grid.flags[index] |= FLAG_BLOCKED;
    });
    localBox(grid, container, [-w, -h, d + ROUTE_CELL_M / 2], [w, h, reach], (index) => { grid.flags[index] |= FLAG_COLUMN; });
  });
  glands.forEach((gland, glandIndex) => {
    const junction = graph.junctions.find((candidate) => candidate.deviceId === gland.junctionId)!;
    const container = deviceById.get(gland.junctionId)!;
    const [x, y, z] = deviceLocalPoint(container, gland.position);
    const [below, defaultAbove] = doorReach(junction.padding);
    const above=junction.centeredGlands?Math.max(defaultAbove,ROUTE_CELL_M*2):defaultAbove;
    localBox(grid, container, [x, y - (gland.face === "top" ? above : below), z], [x, y + (gland.face === "top" ? below : above), z + (junction.centeredGlands ? 0 : ROUTE_CELL_M * 2)], (index) => {
      grid.flags[index] = (grid.flags[index] & ~FLAG_BLOCKED) | FLAG_DOOR;
      grid.doorGland[index] = glandIndex + 1;
    });
  });
  devices.forEach((device, deviceIndex) => {
    if (device.kind === "junction") return;
    const box = deviceAabb(device);
    forEachCellInBox(grid, pad(box.lo, -BODY_MARGIN), pad(box.hi, BODY_MARGIN), (index, point) => {
      if (insideDevice(device, point, isBodyless(device) ? -0.001 : BODY_MARGIN)) grid.flags[index] |= FLAG_BLOCKED;
    });
    if (isBodyless(device) || device.presentation === "wall-passthrough") return;
    const enclosed = device.placement.space === "junction";
    const wallMounted = device.placement.space === "world" && ["wall", "outside-wall"].includes(device.placement.surface);
    if (!wallMounted && !enclosed) return;
    const container = device.placement.space === "junction" ? deviceById.get(device.placement.junctionId)! : undefined;
    const wallId = device.placement.space === "world" ? device.placement.wallId : undefined;
    const wall = walls.find((wall) => wall.id === wallId) ?? walls[0];
    const mountingPoint = container ? worldPoint(container, [0, 0, -container.size[2] / 2]) : wall!.center;
    const mountingZ = deviceLocalPoint(device, mountingPoint)[2];
    const [w, h, d] = device.size.map((size) => size / 2);
    if (mountingZ < -d) localBox(grid, device, [-w - BODY_MARGIN, -h - BODY_MARGIN, mountingZ - BODY_MARGIN], [w + BODY_MARGIN, h + BODY_MARGIN, -d + BODY_MARGIN], (index) => { grid.flags[index] |= FLAG_BLOCKED; });
    if (hasLateralPosts(device)) return;
    const far = container ? deviceLocalPoint(device, worldPoint(container, [0, 0, container.size[2] / 2]))[2] : reach;
    const regionLimit = container ? junctionIndex.get(container.id)! : 0;
    localBox(grid, device, [-w - BODY_MARGIN, -h - BODY_MARGIN, d + ROUTE_CELL_M / 2], [w + BODY_MARGIN, h + BODY_MARGIN, far], (index, point) => {
      if (regionLimit && grid.region[index] !== regionLimit) return;
      grid.flags[index] |= FLAG_COLUMN;
      grid.columnDevice[index] = deviceIndex + 1;
      grid.columnDepth[index] = Math.min(255, Math.round(Math.abs(deviceLocalPoint(device, point)[2] - d) / ROUTE_CELL_M));
    });
  });
  return grid;
}

function axisDirection(direction: Vec3) {
  let best = 0; let bestValue = -Infinity;
  DIRS.forEach((candidate, index) => {
    const value = dot(candidate, direction);
    if (value > bestValue) { bestValue = value; best = index; }
  });
  return best;
}

function isAxisAligned(direction: Vec3) {
  return direction.filter((value) => Math.abs(value) > 1e-9).length === 1;
}

/** First lattice cell beyond a terminal along its outward direction. */
function faceLaunch(grid: VoxelGrid, conductor: ResolvedConductor, device: ResolvedDevice): Launch {
  const direction = normalize(conductor.direction);
  const aligned = isAxisAligned(direction);
  const reasons: string[] = [];
  // A tilted terminal launches three cells out so its exact-axis lead and the
  // short adapter to the lattice keep a gentle bend radius.
  for (let step = aligned ? 1 : 3; step <= (aligned ? 4 : 6); step += 1) {
    const probe = add(conductor.position, scale(direction, aligned ? step * ROUTE_CELL_M / 2 : step * ROUTE_CELL_M));
    const index = grid.cellAt(probe);
    if (index < 0) { reasons.push(`${probe}: out of bounds`); continue; }
    const point = grid.world(index);
    const along = dot(subtract(point, conductor.position), direction);
    if (along < ROUTE_CELL_M / 2 - 1e-6) continue;
    if (aligned) {
      const lateral = subtract(subtract(point, conductor.position), scale(direction, along));
      if (Math.hypot(...lateral) > 1e-6) { reasons.push(`${point}: off-lattice terminal`); continue; }
    }
    if (insideDevice(device, point, 0.0005)) { reasons.push(`${point}: inside own body`); continue; }
    if (grid.flags[index] & FLAG_BLOCKED) { reasons.push(`${point}: blocked (region ${grid.region[index]})`); continue; }
    return { cell: index, outDir: axisDirection(direction), shortLead: along < ROUTE_CELL_M - 1e-6 };
  }
  throw new Error(`${conductor.key}: no free launch cell beyond the ${conductor.face} face of ${device.id} at ${conductor.position} (size ${device.size}, centre ${device.position}): ${reasons.join("; ")}`);
}

/** Landing cells for a bar post: the routing-plane cells just above and just
 * below the bar at the post's x. */
function postLaunches(grid: VoxelGrid, conductor: ResolvedConductor, device: ResolvedDevice): Launch[] {
  const launches: Launch[] = [];
  const localPost = deviceLocalPoint(device, conductor.position);
  for (const sign of [1, -1]) {
    const edge = sign * device.size[1] / 2;
    const outDir = axisDirection(rotateVector([0, sign, 0], device.rotation));
    for (let step = 1; step <= 3; step += 1) {
      const y = edge + sign * (ROUTE_CELL_M / 2) * step;
      const target = worldPoint(device, [localPost[0], y, 0]);
      const index = grid.cellAt(target);
      if (index < 0) continue;
      const point = grid.world(index);
      const local = deviceLocalPoint(device, point);
      if (Math.abs(local[0] - localPost[0]) > 1e-6 || Math.abs(local[2]) > 1e-6) continue;
      if (sign * (local[1] - edge) < ROUTE_CELL_M / 2 - 1e-6) continue;
      if (grid.flags[index] & FLAG_BLOCKED) break;
      launches.push({ cell: index, outDir, shortLead: false });
      break;
    }
  }
  if (launches.length === 0) throw new Error(`${conductor.key}: no free landing cell above or below ${device.id}`);
  return launches;
}

export function routeConnections(
  graph: SystemGraph,
  devices: readonly ResolvedDevice[],
  conductors: readonly ResolvedConductor[],
  glands: readonly Gland[],
  options: RouterOptions = {},
) {
  const started = performance.now();
  const turnCost = options.turnCost ?? 4;
  const depthStepCost = options.depthStepCost ?? (graph.site ? 0 : 1);
  const planeCost = options.planeCost ?? 0.15;
  const improvementPasses = options.improvementPasses ?? 2;
  const baseMargin = options.searchMargin ?? 20;

  const grid = buildVoxelGrid(graph, devices, glands);
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const deviceIndexById = new Map(devices.map((device, index) => [device.id, index]));
  const conductorByKey = new Map(conductors.map((conductor) => [conductor.key, conductor]));
  const cableById = new Map(graph.cables.map((cable) => [cable.id, cable]));
  const junctionIndex = new Map(graph.junctions.map((junction, index) => [junction.deviceId, index + 1]));
  const centeredGlandJunctions = new Set(graph.junctions.filter(j=>j.centeredGlands).map(j=>j.deviceId));
  const glandIndexByConnection = new Map<string, number[]>();
  glands.forEach((gland, index) => gland.connectionIds.forEach((id) => glandIndexByConnection.set(id, [...(glandIndexByConnection.get(id) ?? []), index])));
  const diagnostics: RouterDiagnostics = {
    routingMs: 0, routed: 0, fallbacks: 0, occupiedCells: 0, totalLengthM: 0, totalTurns: 0, expansions: 0,
    routingOrder: [], failures: [], targetAssignments: [],
  };

  const regionOf = (device: ResolvedDevice) => (
    device.placement.space === "junction" ? junctionIndex.get(device.placement.junctionId)! : 0
  );
  const endpointCache = new Map<string, Endpoint>();
  const endpointFor = (key: string): Endpoint => {
    const cached = endpointCache.get(key);
    if (cached) return cached;
    const conductor = conductorByKey.get(key);
    if (!conductor) throw new Error(`Unknown endpoint ${key}`);
    const device = deviceById.get(conductor.deviceId)!;
    const endpoint: Endpoint = {
      key, device, conductor, point: conductor.position, direction: normalize(conductor.direction), launches: [],
      groupKey: conductor.routingGroup ? `${device.id}:${conductor.routingGroup}` : undefined,
    };
    endpointCache.set(key, endpoint);
    return endpoint;
  };
  const withLaunches = (endpoint: Endpoint) => {
    if (endpoint.launches.length === 0) {
      endpoint.launches = isLateralPost(endpoint.device, endpoint.conductor.face)
        ? postLaunches(grid, endpoint.conductor, endpoint.device)
        : [faceLaunch(grid, endpoint.conductor, endpoint.device)];
    }
    return endpoint;
  };
  const groupMembers = (endpoint: Endpoint) => {
    if (!endpoint.groupKey) return [endpoint];
    return endpoint.device.conductors
      .filter((port) => port.routingGroup === endpoint.conductor.routingGroup)
      .map((port) => endpointFor(`${endpoint.device.id}.${port.id}`));
  };

  // Jobs, thickest cable first, then longest straight-line span first.
  const jobs: RouteJob[] = graph.connections.map((connection, index) => {
    const from = endpointFor(connection.from);
    const to = endpointFor(connection.to);
    const regions = new Set<number>([0, regionOf(from.device), regionOf(to.device)]);
    if (regionOf(from.device) !== 0 && regionOf(from.device) === regionOf(to.device)) regions.delete(0);
    const glandSet = new Set<number>();
    glandIndexByConnection.get(connection.id)?.forEach((index) => glandSet.add(index));
    return {
      index, connection, diameterMm: cableById.get(connection.cableId)?.outsideDiameterMm ?? 4,
      fromCandidates: groupMembers(from), toCandidates: groupMembers(to),
      regions, glands: glandSet, stubCells: new Set(),
      // Only actual front-face terminals need the short face-approach exception.
      // A cable ending at a top/bottom/side clamp must not cross that device's front.
      deviceIndices: new Set([from,to].filter(endpoint=>endpoint.conductor.face==='front').map(endpoint=>deviceIndexById.get(endpoint.device.id)!)),
      cells: [], points: [], cost: Infinity, routed: false, direct: false,
    };
  });
  const spanOf = (job: RouteJob) => distance(job.fromCandidates[0].point, job.toCandidates[0].point);
  // Straight links: direct mates (socket/plug) and terminal-to-join stubs.
  const directLink = (job: RouteJob) => {
    const from = job.fromCandidates[0]; const to = job.toCandidates[0];
    if (job.fromCandidates.length > 1 || job.toCandidates.length > 1) return false;
    if (isLateralPost(from.device, from.conductor.face) || isLateralPost(to.device, to.conductor.face)) return false;
    const gap = subtract(to.point, from.point);
    const span = Math.hypot(...gap);
    if (span > 0.081) return false;
    if (dot(from.direction, to.direction) > -0.995) return false;
    if (span > 1e-9 && Math.abs(dot(normalize(gap), from.direction)) < 0.995) return false;
    job.from = from; job.to = to;
    job.points = span > 1e-9 ? [from.point, to.point] : [from.point, add(from.point, scale(from.direction, 0.001))];
    job.cells = [];
    job.cost = span / ROUTE_CELL_M;
    job.routed = true; job.direct = true;
    return true;
  };
  jobs.forEach((job) => {
    if (directLink(job)) return;
    job.fromCandidates.forEach(withLaunches);
    job.toCandidates.forEach(withLaunches);
  });
  const order = jobs.toSorted((a, b) => b.diameterMm - a.diameterMm || spanOf(b) - spanOf(a) || a.connection.id.localeCompare(b.connection.id));

  // Use the same tilted lead for reservations and final geometry. Reserving
  // only its endpoint lets an unrelated grid edge cut across the adapter.
  const lead = (endpoint: Endpoint, launch: Launch): Vec3[] => {
    const launchPoint = grid.world(launch.cell);
    if (isAxisAligned(endpoint.direction)) return [endpoint.point];
    const along = dot(subtract(launchPoint, endpoint.point), endpoint.direction);
    return [endpoint.point, add(endpoint.point, scale(endpoint.direction, Math.min(ROUTE_CELL_M, along * 0.5)))];
  };
  const reserveTiltedLead = (endpoint: Endpoint, job: RouteJob) => {
    if (isAxisAligned(endpoint.direction)) return;
    const clearance = ROUTE_CELL_M / 2 + job.diameterMm / 2000 + Math.max(...jobs.map(candidate => candidate.diameterMm)) / 2000;
    endpoint.launches.forEach(launch => {
      const points = [...lead(endpoint, launch), grid.world(launch.cell)];
      points.slice(1).forEach((end, i) => {
        const start = points[i], delta = subtract(end, start);
        const lo = start.map((value, axis) => Math.min(value, end[axis]) - clearance) as unknown as Vec3;
        const hi = start.map((value, axis) => Math.max(value, end[axis]) + clearance) as unknown as Vec3;
        forEachCellInBox(grid, lo, hi, (index, point) => {
          // Leave the outward half-space at the launch open so the routed
          // cable can continue away from its own reserved adapter.
          if (dot(subtract(point, grid.world(launch.cell)), endpoint.direction) > 1e-9) return;
          const fraction = Math.max(0, Math.min(1, dot(subtract(point, start), delta) / dot(delta, delta)));
          if (distance(point, add(start, scale(delta, fraction))) > clearance) return;
          const owner = grid.reserved[index];
          if (owner && owner !== job.index + 1) throw new Error(`${endpoint.key}: tilted lead conflicts with ${jobs[owner - 1].connection.id}`);
          grid.reserved[index] = job.index + 1;
          if (index !== launch.cell) job.stubCells.add(index);
        });
      });
    });
  };

  // Reservations: launch cells, post groups, gland doors, bodyless interiors,
  // bodyless terminal cells and straight stubs.
  const reserveLaunches = (endpoint: Endpoint, job: RouteJob) => {
    if (endpoint.groupKey) {
      if (!grid.postUsage.has(endpoint.key)) {
        grid.postUsage.set(endpoint.key, { capacity: endpoint.conductor.routingCapacity ?? 1, used: 0 });
      }
      endpoint.launches.forEach((launch) => {
        grid.postGroup.set(launch.cell, endpoint.groupKey!);
        grid.postOfCell.set(launch.cell, endpoint.key);
      });
      return;
    }
    endpoint.launches.forEach((launch) => {
      const current = grid.reserved[launch.cell];
      if (current !== 0 && current !== job.index + 1) {
        throw new Error(`${endpoint.key}: launch cell is already reserved by ${jobs[current - 1].connection.id}`);
      }
      grid.reserved[launch.cell] = job.index + 1;
    });
  };
  const cellsAlong = (from: Vec3, to: Vec3) => {
    const cells: number[] = [];
    const span = distance(from, to);
    if (span < 1e-9) return cells;
    const steps = Math.ceil(span / (ROUTE_CELL_M / 4));
    for (let step = 0; step <= steps; step += 1) {
      const point = add(from, scale(subtract(to, from), step / steps));
      const index = grid.cellAt(point);
      if (index < 0) continue;
      if (distance(grid.world(index), point) > ROUTE_CELL_M / 2 - 1e-6) continue;
      if (!cells.includes(index)) cells.push(index);
    }
    return cells;
  };
  const reserveTerminalCell = (endpoint: Endpoint, job: RouteJob) => {
    if (!isBodyless(endpoint.device)) return;
    const index = grid.cellAt(endpoint.point);
    if (index < 0 || (grid.flags[index] & FLAG_BLOCKED)) return;
    if (grid.reserved[index] === 0) grid.reserved[index] = job.index + 1;
    if (!endpoint.launches.some((launch) => launch.cell === index)) job.stubCells.add(index);
  };
  const doorCells = (job: RouteJob, visit: (index: number) => void) => {
    job.glands.forEach((glandIndex) => {
      const gland = glands[glandIndex];
      const junction=graph.junctions.find(j=>j.deviceId===gland.junctionId)!;
      const [below, defaultAbove] = doorReach(junction.padding);
      const above=junction.centeredGlands?Math.max(defaultAbove,ROUTE_CELL_M*2):defaultAbove;
      const container = devices.find(device => device.id === gland.junctionId)!;
      const [x, y, z] = deviceLocalPoint(container, gland.position);
      localBox(grid, container, [x, y - (gland.face === "top" ? above : below), z], [x, y + (gland.face === "top" ? below : above), z + (junction.centeredGlands ? 0 : ROUTE_CELL_M * 2)], visit);
    });
  };
  jobs.forEach((job) => {
    [job.fromCandidates[0], job.toCandidates[0]].forEach((endpoint) => reserveTerminalCell(endpoint, job));
    if (job.direct) {
      cellsAlong(job.points[0], job.points[1]).forEach((index) => {
        if (grid.reserved[index] === 0) grid.reserved[index] = job.index + 1;
        job.cells.push(index);
      });
      return;
    }
    job.fromCandidates.forEach((endpoint) => reserveLaunches(endpoint, job));
    job.toCandidates.forEach((endpoint) => reserveLaunches(endpoint, job));
    job.fromCandidates.forEach(endpoint => reserveTiltedLead(endpoint, job));
    job.toCandidates.forEach(endpoint => reserveTiltedLead(endpoint, job));
    doorCells(job, (index) => {
      if (grid.reserved[index] === 0) grid.reserved[index] = job.index + 1;
      // A throat passing a bar landing cell takes that landing away from the bar.
      if (grid.postGroup.has(index)) {
        const post = grid.postOfCell.get(index)!;
        grid.postGroup.delete(index); grid.postOfCell.delete(index);
        jobs.forEach((other) => [...other.fromCandidates, ...other.toCandidates].forEach((endpoint) => {
          if (endpoint.key === post) endpoint.launches = endpoint.launches.filter((launch) => launch.cell !== index);
        }));
      }
    });
  });

  const heap = new MinHeap();
  /** Negotiation memory: cells that stayed contested accumulate cost for every cable. */
  const history = new Map<number, number>();
  let gScore = new Float32Array(0);
  let parent = new Int32Array(0);
  let closed = new Uint8Array(0);
  let lastExplanation = "";

  type Landing = { endpoint: Endpoint; launch: Launch };
  type SearchResult = { cells: number[]; cost: number; from: Endpoint; to: Endpoint; fromLaunch: Launch; toLaunch: Launch };

  const searchOnce = (job: RouteJob, margin: number, fixedTargets: boolean, explain = false, overlapPenalty = 0): SearchResult | undefined => {
    const starts = fixedTargets && job.from ? [job.from] : job.fromCandidates;
    const goals = fixedTargets && job.to ? [job.to] : job.toCandidates;
    const usable = (endpoint: Endpoint) => {
      if (!endpoint.groupKey) return true;
      const usage = grid.postUsage.get(endpoint.key)!;
      return usage.used < usage.capacity;
    };
    const firstWire = (candidates: Endpoint[]) => {
      const free = candidates.filter(usable);
      const untouched = free.filter((endpoint) => (grid.postUsage.get(endpoint.key)?.used ?? 0) === 0);
      return untouched.length > 0 ? untouched : free;
    };
    const startSet = firstWire(starts);
    const goalSet = firstWire(goals);
    if (startSet.length === 0 || goalSet.length === 0) return undefined;
    const jobId = job.index + 1;
    // A half-cell terminal stub leaves at most 0.48 × 10 mm for a
    // fillet (with a small cubic approximation margin). Include the swept
    // clearance used by the rendered audit, rather than rounding OD to 8 mm.
    const thick = job.diameterMm / 2000 * 1.1 + 0.0005 > ROUTE_CELL_M * 0.235;
    const own = (index: number) => grid.occupant[index] === jobId || grid.reserved[index] === jobId;
    const launchFree = (launch: Launch) => grid.postGroup.has(launch.cell) || grid.reserved[launch.cell] === jobId;

    // Search box.
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const includeCell = (index: number, padCells: number) => {
      const c = grid.coords(index);
      for (let axis = 0; axis < 3; axis += 1) { lo[axis] = Math.min(lo[axis], c[axis] - padCells); hi[axis] = Math.max(hi[axis], c[axis] + padCells); }
    };
    startSet.forEach((endpoint) => endpoint.launches.forEach((launch) => includeCell(launch.cell, margin)));
    goalSet.forEach((endpoint) => endpoint.launches.forEach((launch) => includeCell(launch.cell, margin)));
    job.glands.forEach((glandIndex) => {
      const index = grid.cellAt(glands[glandIndex].position);
      if (index >= 0) includeCell(index, margin);
    });
    job.regions.forEach((regionId) => {
      if (regionId === 0) return;
      const container = devices.find((device) => junctionIndex.get(device.id) === regionId)!;
      const box = deviceAabb(container);
      const a = grid.toCell(box.lo); const b = grid.toCell(box.hi);
      includeCell(grid.index(Math.max(0, a[0]), Math.max(0, a[1]), Math.max(0, a[2])), 2);
      includeCell(grid.index(Math.min(grid.nx - 1, b[0]), Math.min(grid.ny - 1, b[1]), Math.min(grid.nz - 1, b[2])), 2);
    });
    const bx0 = Math.max(0, lo[0]); const by0 = Math.max(0, lo[1]); const bz0 = Math.max(0, lo[2]);
    const bx1 = Math.min(grid.nx - 1, hi[0]); const by1 = Math.min(grid.ny - 1, hi[1]); const bz1 = Math.min(grid.nz - 1, hi[2]);
    const sx = bx1 - bx0 + 1; const sy = by1 - by0 + 1; const sz = bz1 - bz0 + 1;
    const stateCount = sx * sy * sz * 6;
    if (gScore.length < stateCount) {
      gScore = new Float32Array(stateCount);
      parent = new Int32Array(stateCount);
      closed = new Uint8Array(stateCount);
    }
    gScore.fill(Infinity, 0, stateCount);
    closed.fill(0, 0, stateCount);
    const toLocal = (index: number) => {
      const [ix, iy, iz] = grid.coords(index);
      return ((ix - bx0) * sy + (iy - by0)) * sz + (iz - bz0);
    };
    const toGlobal = (local: number) => {
      const iz = local % sz; const rest = (local - iz) / sz;
      const iy = rest % sy; const ix = (rest - iy) / sy;
      return grid.index(ix + bx0, iy + by0, iz + bz0);
    };
    const goalByCell = new Map<number, Landing>();
    goalSet.forEach((endpoint) => endpoint.launches.forEach((launch) => {
      if (launchFree(launch)) goalByCell.set(launch.cell, { endpoint, launch });
    }));
    if (goalByCell.size === 0) return undefined;
    const rejection = (fromIndex: number, toIndex: number, dir: number): string | undefined => {
      if (centeredGlandJunctions.size && AXIS_OF_DIR[dir] !== 1) {
        for (const index of [fromIndex,toIndex]) {
          const glandIndex=grid.doorGland[index]-1;
          if(glandIndex<0)continue;
          const gland=glands[glandIndex];
          if(!centeredGlandJunctions.has(gland.junctionId))continue;
          const container=deviceById.get(gland.junctionId)!;
          const a=deviceLocalPoint(container,grid.world(index)),b=deviceLocalPoint(container,gland.position);
          if(Math.abs(a[1]-b[1])<ROUTE_CELL_M*2-1e-8)return "gland straight approach";
        }
      }
      const flags = grid.flags[toIndex];
      if (flags & FLAG_BLOCKED) return "blocked";
      if (job.stubCells.has(toIndex)) return "own terminal lead";
      const region = grid.region[toIndex];
      if (!job.regions.has(region)) return `region ${region}`;
      if (flags & FLAG_DOOR) {
        if (!job.glands.has(grid.doorGland[toIndex] - 1)) return `foreign door ${glands[grid.doorGland[toIndex] - 1]?.connectionIds[0]}`;
      }
      if (region !== grid.region[fromIndex]) {
        if (AXIS_OF_DIR[dir] !== 1) return "non-vertical shell crossing";
        const door = (grid.flags[fromIndex] & FLAG_DOOR) ? grid.doorGland[fromIndex] - 1 : (flags & FLAG_DOOR) ? grid.doorGland[toIndex] - 1 : -1;
        if (door < 0 || !job.glands.has(door)) return "shell crossing outside own door";
      }
      if ((flags & FLAG_COLUMN) && !own(toIndex)) {
        if (!job.deviceIndices.has(grid.columnDevice[toIndex] - 1) || grid.columnDepth[toIndex] > 2) return `column of ${devices[grid.columnDevice[toIndex] - 1]?.id}`;
      }
      if (grid.postGroup.has(toIndex)) {
        // A lug stack: several cables may share a post's landing cell up to
        // the post's declared capacity, but nothing passes through it.
        const goal = goalByCell.get(toIndex);
        if (!goal) return "foreign post landing";
        const usage = grid.postUsage.get(goal.endpoint.key)!;
        if (usage.used >= usage.capacity) return "post at capacity";
      } else {
        const reserved = grid.reserved[toIndex];
        if (reserved !== 0 && reserved !== jobId) return `reserved by ${jobs[reserved - 1].connection.id}`;
        const occupant = grid.occupant[toIndex];
        if (occupant !== 0 && occupant !== jobId && overlapPenalty <= 0) return `occupied by ${jobs[occupant - 1].connection.id}`;
      }
      return undefined;
    };
    const enterable = (fromIndex: number, toIndex: number, dir: number) => rejection(fromIndex, toIndex, dir) === undefined;
    const overlapCost = (toIndex: number) => {
      if (overlapPenalty <= 0) return 0;
      const occupant = grid.occupant[toIndex];
      const extras = grid.extras.get(toIndex)?.size ?? 0;
      return ((occupant !== 0 && occupant !== jobId ? 1 : 0) + extras) * overlapPenalty + (history.get(toIndex) ?? 0);
    };
    const goalCoords = [...goalByCell.keys()].map((cell) => grid.coords(cell));
    const heuristic = (index: number) => {
      const [ix, iy, iz] = grid.coords(index);
      let best = Infinity;
      for (const [gx, gy, gz] of goalCoords) {
        const dx = Math.abs(gx - ix); const dy = Math.abs(gy - iy); const dz = Math.abs(gz - iz);
        const axes = (dx > 0 ? 1 : 0) + (dy > 0 ? 1 : 0) + (dz > 0 ? 1 : 0);
        const value = dx + dy + dz + dz * depthStepCost + Math.max(0, axes - 1) * turnCost;
        if (value < best) best = value;
      }
      return best;
    };
    heap.size = 0;
    const startByState = new Map<number, Landing>();
    startSet.forEach((endpoint) => endpoint.launches.forEach((launch) => {
      if (!launchFree(launch)) return;
      const state = toLocal(launch.cell) * 6 + launch.outDir;
      gScore[state] = 0; parent[state] = -1;
      startByState.set(state, { endpoint, launch });
      heap.push(heuristic(launch.cell), state);
    }));
    if (startByState.size === 0) return undefined;
    let expansions = 0;
    let bestGoal: { state: number; cost: number; goal: Landing } | undefined;
    while (heap.size > 0) {
      const state = heap.pop();
      if (state < 0) break;
      if (closed[state]) continue;
      closed[state] = 1;
      expansions += 1;
      const local = (state - state % 6) / 6;
      const dir = state % 6;
      const g = gScore[state];
      const index = toGlobal(local);
      const goal = goalByCell.get(index);
      if (goal) {
        const straight = dir === (goal.launch.outDir ^ 1);
        if (!straight && goal.launch.shortLead && thick) continue;
        const total = g + (straight ? 0 : turnCost);
        if (!bestGoal || total < bestGoal.cost) bestGoal = { state, cost: total, goal };
        heap.push(total, -1);
        continue;
      }
      const startLaunch = startByState.get(state)?.launch;
      const [ix, iy, iz] = grid.coords(index);
      for (let next = 0; next < 6; next += 1) {
        if (next === (dir ^ 1)) continue;
        if (startLaunch?.shortLead && thick && next !== dir) continue;
        const d = DIRS[next];
        const nx = ix + d[0]; const ny = iy + d[1]; const nz = iz + d[2];
        if (nx < bx0 || ny < by0 || nz < bz0 || nx > bx1 || ny > by1 || nz > bz1) continue;
        const nextIndex = grid.index(nx, ny, nz);
        if (!enterable(index, nextIndex, next)) continue;
        const nextLocal = ((nx - bx0) * sy + (ny - by0)) * sz + (nz - bz0);
        const nextState = nextLocal * 6 + next;
        if (closed[nextState]) continue;
        const plane = grid.planeDistance(nextIndex) / grid.cell;
        const stepCost = 1 + (next !== dir ? turnCost : 0) + (AXIS_OF_DIR[next] === 2 ? depthStepCost : 0) + plane * planeCost + overlapCost(nextIndex);
        const tentative = g + stepCost;
        if (tentative >= gScore[nextState]) continue;
        gScore[nextState] = tentative;
        parent[nextState] = state;
        heap.push(tentative + heuristic(nextIndex), nextState);
      }
    }
    diagnostics.expansions += expansions;
    if (!bestGoal) {
      if (explain) {
        // Explain: the expanded cell nearest a goal and every rejected exit.
        let nearest = -1; let nearestValue = Infinity;
        for (let local = 0; local < sx * sy * sz; local += 1) {
          for (let dir = 0; dir < 6; dir += 1) {
            if (!closed[local * 6 + dir]) continue;
            const index = toGlobal(local);
            const value = heuristic(index);
            if (value < nearestValue) { nearestValue = value; nearest = index; }
          }
        }
        if (nearest >= 0) {
          const [ix, iy, iz] = grid.coords(nearest);
          const exits = DIRS.map((d, dir) => {
            const nx = ix + d[0]; const ny = iy + d[1]; const nz = iz + d[2];
            if (!grid.inBounds(nx, ny, nz)) return `${dir}: out of bounds`;
            return `${["+x", "-x", "+y", "-y", "+z", "-z"][dir]}: ${rejection(nearest, grid.index(nx, ny, nz), dir) ?? "open"}`;
          });
          lastExplanation = `nearest reachable cell ${grid.world(nearest)} (h=${nearestValue.toFixed(1)}): ${exits.join(", ")}`;
        }
        const wasClosed = (index: number) => {
          const [ix, iy, iz] = grid.coords(index);
          if (ix < bx0 || iy < by0 || iz < bz0 || ix > bx1 || iy > by1 || iz > bz1) return false;
          const local = ((ix - bx0) * sy + (iy - by0)) * sz + (iz - bz0);
          for (let dir = 0; dir < 6; dir += 1) if (closed[local * 6 + dir]) return true;
          return false;
        };
        const doorReport: string[] = [];
        doorCells(job, (index) => {
          const [ix, iy, iz] = grid.coords(index);
          const exits = DIRS.map((d, dir) => {
            const nx = ix + d[0]; const ny = iy + d[1]; const nz = iz + d[2];
            if (!grid.inBounds(nx, ny, nz)) return "oob";
            return rejection(index, grid.index(nx, ny, nz), dir) ?? "open";
          });
          doorReport.push(`${grid.world(index)} ${wasClosed(index) ? "REACHED" : "unreached"} [${exits.join("|")}]`);
        });
        if (doorReport.length > 0) lastExplanation += `; doors: ${doorReport.join("; ")}`;
        const probe = process.env.DSE_ROUTER_PROBE;
        if (probe) {
          const points = probe.split(";").map((entry) => entry.split(",").map(Number) as unknown as Vec3);
          const report = points.slice(1).map((point, step) => {
            const from = grid.cellAt(points[step]); const to = grid.cellAt(point);
            if (from < 0 || to < 0) return `${point}: out of grid`;
            const [fx, fy, fz] = grid.coords(from); const [tx, ty, tz] = grid.coords(to);
            const dir = DIRS.findIndex((d) => d[0] === Math.sign(tx - fx) && d[1] === Math.sign(ty - fy) && d[2] === Math.sign(tz - fz));
            const inBox = tx >= bx0 && ty >= by0 && tz >= bz0 && tx <= bx1 && ty <= by1 && tz <= bz1;
            return `${point}: ${inBox ? "" : "OUTSIDE BOX "}${dir < 0 ? "non-adjacent" : rejection(from, to, dir) ?? "open"}${wasClosed(to) ? " (reached)" : ""}`;
          });
          lastExplanation += `; probe: ${report.join(" -> ")}`;
        }
      }
      return undefined;
    }
    const cells: number[] = [];
    let cursor = bestGoal.state;
    let startState = cursor;
    while (cursor >= 0) {
      cells.push(toGlobal((cursor - cursor % 6) / 6));
      startState = cursor;
      cursor = parent[cursor];
    }
    cells.reverse();
    const start = startByState.get(startState)!;
    return { cells, cost: bestGoal.cost, from: start.endpoint, to: bestGoal.goal.endpoint, fromLaunch: start.launch, toLaunch: bestGoal.goal.launch };
  };

  // One retry with a doubled search box; anything still unroutable is
  // handed to negotiated rerouting rather than an ever-larger blind search.
  const search = (job: RouteJob, fixedTargets: boolean, overlapPenalty = 0) => {
    let margin = baseMargin;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = searchOnce(job, margin, fixedTargets, attempt === 1, overlapPenalty);
      if (result) return result;
      margin *= 2;
    }
    return undefined;
  };

  const commit = (job: RouteJob, result: SearchResult) => {
    job.cells = result.cells; job.cost = result.cost;
    job.from = result.from; job.to = result.to; job.fromLaunch = result.fromLaunch; job.toLaunch = result.toLaunch;
    job.routed = true;
    const id = job.index + 1;
    result.cells.forEach((index) => {
      if (grid.postGroup.has(index)) return;
      const current = grid.occupant[index];
      if (current === 0 || current === id) grid.occupant[index] = id;
      else grid.extras.set(index, new Set([...(grid.extras.get(index) ?? []), job.index]));
    });
    [result.from, result.to].forEach((endpoint) => {
      if (endpoint.groupKey) grid.postUsage.get(endpoint.key)!.used += 1;
    });
  };
  const release = (job: RouteJob) => {
    const id = job.index + 1;
    job.cells.forEach((index) => {
      const extras = grid.extras.get(index);
      if (grid.occupant[index] === id) {
        const promoted = extras ? [...extras][0] : undefined;
        if (promoted !== undefined) {
          grid.occupant[index] = promoted + 1;
          extras!.delete(promoted);
          if (extras!.size === 0) grid.extras.delete(index);
        } else grid.occupant[index] = 0;
      } else if (extras?.has(job.index)) {
        extras.delete(job.index);
        if (extras.size === 0) grid.extras.delete(index);
      }
    });
    ([[job.from, job.fromLaunch], [job.to, job.toLaunch]] as const).forEach(([endpoint, launch]) => {
      if (!endpoint || !launch) return;
      if (endpoint.groupKey) grid.postUsage.get(endpoint.key)!.used -= 1;
    });
    job.routed = false;
    job.cells = [];
  };
  const conflictedJobs = () => {
    const set = new Set<number>();
    grid.extras.forEach((extras, index) => {
      set.add(grid.occupant[index] - 1);
      extras.forEach((extra) => set.add(extra));
    });
    return order.filter((job) => set.has(job.index));
  };

  // Serial solve.
  const unrouted: RouteJob[] = [];
  order.forEach((job) => {
    diagnostics.routingOrder.push(job.connection.id);
    if (job.direct) return;
    const result = search(job, false);
    if (!result) { unrouted.push(job); return; }
    commit(job, result);
  });

  // Negotiated rerouting for anything the serial pass could not place: the
  // cable may cross other cables' cells at a penalty, every cable it overlaps
  // is ripped up and re-solved under a rising penalty, until no cell is shared.
  let pending = unrouted;
  let penalty = 24;
  const serialMs = performance.now() - started;
  if (process.env.DSE_ROUTER_LOG) console.warn(`router: serial pass ${serialMs.toFixed(0)} ms, ${diagnostics.expansions} expansions, unrouted ${unrouted.map((job) => job.connection.id).join(", ") || "none"}`);
  for (let round = 0; round < 24 && pending.length > 0; round += 1) {
    if (process.env.DSE_ROUTER_LOG) console.warn(`router: negotiation round ${round} penalty ${penalty.toFixed(0)} pending ${pending.map((job) => job.connection.id).join(", ")}`);
    pending.forEach((job) => {
      if (job.routed) release(job);
      const result = search(job, false, penalty);
      if (result) commit(job, result);
    });
    const conflicted = conflictedJobs();
    const stillUnrouted = pending.filter((job) => !job.routed);
    if (conflicted.length === 0 && stillUnrouted.length === 0) { pending = []; break; }
    grid.extras.forEach((_extras, index) => history.set(index, (history.get(index) ?? 0) + 6));
    conflicted.forEach((job) => release(job));
    pending = [...new Set([...conflicted, ...stillUnrouted])].toSorted((a, b) => order.indexOf(a) - order.indexOf(b));
    penalty *= 1.3;
  }
  // Anything still overlapping is torn up and left unrouted; anything unrouted gets a straight fallback.
  const finalConflicts = conflictedJobs();
  finalConflicts.forEach((job) => release(job));
  order.forEach((job) => {
    if (job.routed || job.direct) return;
    search(job, false);
    const describe = (endpoint: Endpoint) => endpoint.launches.map((launch) => (
      `${endpoint.key}@${grid.world(launch.cell)} flags=${grid.flags[launch.cell]} region=${grid.region[launch.cell]} occupant=${grid.occupant[launch.cell]} reserved=${grid.reserved[launch.cell]} group=${grid.postGroup.get(launch.cell) ?? "-"}`
    )).join(" | ");
    diagnostics.failures.push({
      connectionId: job.connection.id,
      reason: `no path; ${lastExplanation}; from ${job.fromCandidates.map(describe).join(" | ")}; to ${job.toCandidates.map(describe).join(" | ")}`,
    });
    job.from = job.fromCandidates[0]; job.to = job.toCandidates[0];
    job.points = [job.from.point, job.to.point];
  });

  // Rip-up-and-reroute: each cable is re-solved against the final field.
  if (process.env.DSE_ROUTER_LOG) console.warn(`router: after negotiation ${(performance.now() - started).toFixed(0)} ms, ${diagnostics.expansions} expansions`);
  for (let pass = 0; pass < improvementPasses; pass += 1) {
    let improved = false;
    order.forEach((job) => {
      if (!job.routed || job.direct) return;
      const previous: SearchResult = { cells: job.cells, cost: job.cost, from: job.from!, to: job.to!, fromLaunch: job.fromLaunch!, toLaunch: job.toLaunch! };
      release(job);
      job.from = previous.from; job.to = previous.to;
      const result = search(job, true);
      if (result && result.cost + 1e-6 < previous.cost) {
        commit(job, result);
        improved = true;
      } else {
        commit(job, previous);
      }
    });
    if (!improved) break;
  }

  if (process.env.DSE_ROUTER_LOG) console.warn(`router: after improvement ${(performance.now() - started).toFixed(0)} ms, ${diagnostics.expansions} expansions`);
  // Materialise polylines.
  const simplify = (points: Vec3[]) => points.filter((point, index) => {
    if (index === 0 || index === points.length - 1) return true;
    const before = normalize(subtract(point, points[index - 1]));
    const after = normalize(subtract(points[index + 1], point));
    return dot(before, after) < 0.999999;
  });
  // A tilted terminal (rotated roof equipment) keeps an exact lead along its
  // own axis before a short adapter reaches the lattice launch cell.
  const routes: RoutedConnection[] = jobs.map((job) => {
    if (!job.direct && job.routed) {
      const middle = job.cells.map((index) => grid.world(index));
      job.points = simplify([...lead(job.from!, job.fromLaunch!), ...middle, ...lead(job.to!, job.toLaunch!).reverse()]);
    }
    const points = job.points.filter((point, index) => index === 0 || distance(point, job.points[index - 1]) > 1e-9);
    const lengthM = points.slice(1).reduce((sum, point, index) => sum + distance(point, points[index]), 0);
    const from = job.from ?? job.fromCandidates[0];
    const to = job.to ?? job.toCandidates[0];
    if (job.fromCandidates.length > 1 || from.key !== job.connection.from) {
      diagnostics.targetAssignments.push({ connectionId: job.connection.id, side: "from", authoredEndpoint: job.connection.from, resolvedEndpoint: from.key });
    }
    if (job.toCandidates.length > 1 || to.key !== job.connection.to) {
      diagnostics.targetAssignments.push({ connectionId: job.connection.id, side: "to", authoredEndpoint: job.connection.to, resolvedEndpoint: to.key });
    }
    const turns = Math.max(0, points.length - 2);
    diagnostics.totalLengthM += lengthM;
    diagnostics.totalTurns += turns;
    if (job.routed) diagnostics.routed += 1; else diagnostics.fallbacks += 1;
    diagnostics.occupiedCells += job.cells.length;
    return {
      ...job.connection,
      from: from.key,
      to: to.key,
      points,
      lengthM: Number(lengthM.toFixed(4)),
      diameterMm: job.diameterMm,
      routed: job.routed,
      routingRank: order.indexOf(job),
    };
  });
  diagnostics.routingMs = performance.now() - started;
  return { routes, diagnostics, grid };
}
