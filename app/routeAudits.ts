import { EQUIPMENT_WALL_VOLUME, graphWalls } from "./systemGraph";
import type {
  ResolvedConductor,
  ResolvedDevice,
  RoutedConnection,
  SystemGraph,
  Vec3,
} from "./systemGraph";
import {
  MAX_SEMANTIC_SECTION_M,
  renderedRoutePoints,
  renderedSemanticCables,
  roundedRoutePieces,
  sampleCableCurve,
} from "./renderedCableGeometry";
import {
  deviceLocalPoint,
  distance,
  dot,
  endpointDeviceId,
  isBodyless,
  hasLateralPosts,
  ROUTE_CELL_M,
  rotateVector,
  scale,
  subtract,
  terminalPosition,
  directionByFace,
  worldHalfExtents,
} from "./physicalLayout";

type WorldRoutingRegion = "inside" | "outside";
const ROUTING_CABLE_CLEARANCE_M = 0.0005;
const deviceWorldRegion = (device: ResolvedDevice): WorldRoutingRegion => (
  device.placement.space === "world"
    && (device.placement.surface === "outside" || device.placement.surface === "outside-wall" || device.placement.surface === "roof")
    ? "outside"
    : "inside"
);

export const renderedGeometryFailureDiagnostics: string[] = [];

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
  walls: ReturnType<typeof graphWalls> = [{ ...EQUIPMENT_WALL_VOLUME, id: "north", normal: [0, 0, 1] }],
) {
  const crossings = new Set<string>();
  const apertures = devices.filter((device) => (
    device.placement.space === "world" && device.presentation === "wall-passthrough"
  ));
  walls.forEach((wall) => routes.forEach((route) => {
    const radiusM = route.diameterMm / 2000;
    const minimum = wall.center.map((value, axis) => (
      value - wall.size[axis] / 2 - radiusM
    )) as unknown as Vec3;
    const maximum = wall.center.map((value, axis) => (
      value + wall.size[axis] / 2 + radiusM
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
      const whollyInsideAperture = apertures.some((aperture) => (aperture.placement.space !== "world" || !aperture.placement.wallId || aperture.placement.wallId === wall.id) && samples.every((point) => {
        const local = deviceLocalPoint(aperture, point);
        return Math.abs(local[0]) <= Math.max(0, aperture.size[0] / 2 - radiusM)
          && Math.abs(local[1]) <= Math.max(0, aperture.size[1] / 2 - radiusM);
      }));
      if (!whollyInsideAperture) {
        crossings.add(`${route.id} · segment ${index} · ${start.join(",")} → ${end.join(",")}`);
      }
    }
  }));
  return [...crossings];
}

type SegmentClosest = { distance: number; first: Vec3; second: Vec3 };

export function closestSegmentPoints(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): SegmentClosest {
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
      // Parallel axes have a zero cross product, not a separating plane.
      if (1 - rotation[firstAxis][secondAxis] ** 2 < 1e-12) continue;
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
  // Broad phase across all world regions, followed by oriented boxes. Tilted
  // panels and the rails beneath them overlap in projection, not in volume.
  const solid = devices.filter((device) => (
    device.placement.space === "world" && !device.attachment && !isBodyless(device) && device.presentation !== "wall-passthrough"
  ));
  for (let first = 0; first < solid.length; first += 1) {
    for (let second = first + 1; second < solid.length; second += 1) {
      const a = solid[first]; const b = solid[second];
      const ha = worldHalfExtents(a); const hb = worldHalfExtents(b);
      const overlapping = [0, 1, 2].every((axis) => (
        Math.abs(a.position[axis] - b.position[axis]) < ha[axis] + hb[axis] - 0.001
      ));
      if (overlapping && obbOverlaps(a, b)) conflicts.add(`${a.id} ↔ ${b.id}`);
    }
  }
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
      const firstBodyless = isBodyless(first);
      const secondBodyless = isBodyless(second);
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
  // The shared lead runs from the stud to the landing cell just beyond the bar edge.
  const sharedContactReach = ROUTE_CELL_M * 2.5 + required * 2 + MAX_SEMANTIC_SECTION_M;
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

/** Swept cable clearance against the solid charging shelf. */
export function sampledRouteSiteConflicts(routes: readonly RoutedConnection[], graph: Pick<SystemGraph, "site">) {
  if (!graph.site?.shelf) return [];
  const { center, size } = graph.site.shelf;
  return routes.filter(route => route.points.slice(1).some((end, index) => {
    const start = route.points[index];
    const radius = route.diameterMm / 2000;
    let near = 0, far = 1;
    for (let axis = 0; axis < 3; axis += 1) {
      const lo = center[axis] - size[axis] / 2 - radius;
      const hi = center[axis] + size[axis] / 2 + radius;
      const delta = end[axis] - start[axis];
      if (Math.abs(delta) < 1e-10) {
        if (start[axis] < lo || start[axis] > hi) return false;
      } else {
        const a = (lo - start[axis]) / delta, b = (hi - start[axis]) / delta;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
        if (near > far) return false;
      }
    }
    return true;
  })).map(route => `${route.id} ↔ charging shelf`);
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
      Math.abs(deviceLocalPoint(obstacle, owner.position)[0]) - (owner.size[0] + obstacle.size[0]) / 2,
    ) < 1e-8;
    if (!touchingAlongX) return false;
    const conductorId = endpoint.slice(endpoint.lastIndexOf(".") + 1);
    const terminal = terminalPosition(owner, conductorId);
    const localTerminal = deviceLocalPoint(obstacle, terminal);
    const obstacleEdgeX = Math.sign(localTerminal[0]) * obstacle.size[0] / 2;
    if (Math.abs(localTerminal[0] - obstacleEdgeX) > 1e-8) return false;
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
        if (device.kind === "junction" || isBodyless(device) || endpointDevices.has(device.id)) return;
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
        const blocksWholeColumn = blocksRoutingColumn(device);
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
        // An enclosure member reserves the space from its backplate to the
        // open front, not an infinite column through the room behind the box.
        // This matters when a route continues along the other corner wall.
        const container = device.placement.space === "junction" ? deviceById.get(device.placement.junctionId) : undefined;
        const columnMin: Vec3 = blocksWholeColumn && container
          ? [min[0], min[1], deviceLocalPoint(device, subtract(container.position, scale(rotateVector([0, 0, 1], container.rotation), container.size[2] / 2)))[2] - routeRadiusM] : min;
        const columnMax: Vec3 = blocksWholeColumn && container
          ? [max[0], max[1], deviceLocalPoint(device, subtract(container.position, scale(rotateVector([0, 0, -1], container.rotation), container.size[2] / 2)))[2] + routeRadiusM] : max;
        if (
          intersectsBounds(localStart, localEnd, columnMin, columnMax, blocksWholeColumn && !container ? 2 : 3)
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
 * route bends plus selectable cubic Y/breakout arms and straight orthogonal
 * T joins. This is deliberately
 * offline; the browser only hydrates the already-certified artifact.
 */
export function sampledRenderedGeometryConflicts(
  routes: readonly RoutedConnection[],
  devices: readonly ResolvedDevice[],
  conductors: readonly ResolvedConductor[],
  graph: SystemGraph,
) {
  const conflicts = new Set<string>();
  const renderedSemantic = renderedSemanticCables(devices, conductors, routes);
  const piecesByRoute = new Map<string, ReturnType<typeof roundedRoutePieces>>();
  const renderedRoutes = routes.map((route): RoutedConnection => {
    const radiusM = Math.max(0.0012, route.diameterMm / 2000);
    const visiblePoints = renderedRoutePoints(route, renderedSemantic);
    const pieces = roundedRoutePieces(visiblePoints, Math.max(0.009, radiusM * 4.25));
    piecesByRoute.set(route.id, pieces);
    return {
      ...route,
      points: sampleCableCurve(pieces),
    };
  });
  sampledRouteSweptCableConflicts(renderedRoutes, graph).forEach((conflict) => conflicts.add(`route-swept · ${conflict}`));
  sampledRouteDeviceConflicts(renderedRoutes, devices).forEach((conflict) => conflicts.add(`route-device · ${conflict}`));
  sampledRouteSiteConflicts(renderedRoutes, graph).forEach((conflict) => conflicts.add(`route-site · ${conflict}`));
  sampledRouteWallPlaneCrossings(renderedRoutes, devices, graphWalls(graph)).forEach((conflict) => conflicts.add(`route-wall · ${conflict}`));

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

  const semantic = renderedSemantic.map((cable) => ({
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
    // A valid multi-arm join must become distinct conductors before both field terminals.
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
    sampledRouteWallPlaneCrossings([pseudo], devices, graphWalls(graph)).forEach((conflict) => conflicts.add(`semantic-wall · ${conflict}`));
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


/** Rear-mounted equipment keeps its open-front column clear of unrelated
 * cables: wall devices and enclosure members, except penetration plates and
 * distribution bars whose posts are met laterally. */
function blocksRoutingColumn(device: ResolvedDevice) {
  if (device.presentation === "wall-passthrough" || hasLateralPosts(device)) return false;
  if (device.placement.space === "world") return ["wall", "outside-wall"].includes(device.placement.surface);
  return true;
}

/** Check the routing skeleton, not tessellation chords along a rounded elbow. */
export function nonOrthogonalRouteSegments(routes:readonly Pick<RoutedConnection,'id'|'points'>[]):string[] {
 return routes.flatMap(route=>route.points.slice(1).flatMap((point,i)=>
  point.filter((v,axis)=>Math.abs(v-route.points[i][axis])>1e-8).length>1?[`${route.id}: segment ${i}`]:[]));
}
