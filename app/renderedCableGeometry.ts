import type {
  ConductorKind,
  ResolvedConductor,
  ResolvedDevice,
  RoutedConnection,
  Vec3,
} from "./systemGraph";

export const MIN_ROUTE_BEND_SEGMENTS = 8;
export const MAX_ROUTE_STRAIGHT_SECTION_M = 0.10;
export const MAX_ROUTE_BEND_SECTION_M = 0.0035;
export const MAX_SEMANTIC_SECTION_M = 0.0025;

export type CableCurvePiece = {
  kind: "line" | "quadratic" | "cubic";
  points: readonly Vec3[];
  divisions: number;
  lengthM: number;
  bend: boolean;
};

export type RenderedSemanticCable = {
  id: string;
  deviceId: string;
  conductorKey: string;
  radiusM: number;
  color: ConductorKind | "white";
  /** Common physical fusion point for every arm of one declared Y symbol. */
  splitPoint: Vec3;
  branchAngleDegrees?: number;
  pieces: readonly CableCurvePiece[];
};

const add = (first: Vec3, second: Vec3): Vec3 => [
  first[0] + second[0], first[1] + second[1], first[2] + second[2],
];
const subtract = (first: Vec3, second: Vec3): Vec3 => [
  first[0] - second[0], first[1] - second[1], first[2] - second[2],
];
const scale = (value: Vec3, amount: number): Vec3 => [
  value[0] * amount, value[1] * amount, value[2] * amount,
];
const dot = (first: Vec3, second: Vec3) => (
  first[0] * second[0] + first[1] * second[1] + first[2] * second[2]
);
const magnitude = (value: Vec3) => Math.hypot(...value);
const distance = (first: Vec3, second: Vec3) => magnitude(subtract(first, second));
const normalize = (value: Vec3): Vec3 => {
  const length = magnitude(value);
  return length < 1e-12 ? [0, 0, 0] : scale(value, 1 / length);
};
const lerp = (first: Vec3, second: Vec3, amount: number): Vec3 => add(
  scale(first, 1 - amount),
  scale(second, amount),
);

export function cableCurvePoint(piece: CableCurvePiece, amount: number): Vec3 {
  const t = Math.max(0, Math.min(1, amount));
  if (piece.kind === "line") return lerp(piece.points[0], piece.points[1], t);
  if (piece.kind === "quadratic") {
    const oneMinus = 1 - t;
    return add(
      add(scale(piece.points[0], oneMinus * oneMinus), scale(piece.points[1], 2 * oneMinus * t)),
      scale(piece.points[2], t * t),
    );
  }
  const oneMinus = 1 - t;
  return add(
    add(
      scale(piece.points[0], oneMinus ** 3),
      scale(piece.points[1], 3 * oneMinus * oneMinus * t),
    ),
    add(
      scale(piece.points[2], 3 * oneMinus * t * t),
      scale(piece.points[3], t ** 3),
    ),
  );
}

function estimatedCurveLength(
  kind: CableCurvePiece["kind"],
  points: readonly Vec3[],
) {
  if (kind === "line") return distance(points[0], points[1]);
  const provisional: CableCurvePiece = { kind, points, divisions: 1, lengthM: 0, bend: true };
  let length = 0;
  let previous = cableCurvePoint(provisional, 0);
  for (let index = 1; index <= 96; index += 1) {
    const point = cableCurvePoint(provisional, index / 96);
    length += distance(previous, point);
    previous = point;
  }
  return length;
}

function curvePiece(
  kind: CableCurvePiece["kind"],
  points: readonly Vec3[],
  mode: "route" | "semantic",
): CableCurvePiece {
  const lengthM = estimatedCurveLength(kind, points);
  const bend = kind !== "line";
  const divisions = mode === "semantic"
    ? Math.max(12, Math.ceil(lengthM / MAX_SEMANTIC_SECTION_M))
    : bend
      ? Math.max(MIN_ROUTE_BEND_SEGMENTS, Math.ceil(lengthM / MAX_ROUTE_BEND_SECTION_M))
      : Math.max(1, Math.ceil(lengthM / MAX_ROUTE_STRAIGHT_SECTION_M));
  return { kind, points, divisions, lengthM, bend };
}

/** Exact renderer authority for the rounded route centreline. */
export function roundedRoutePieces(points: readonly Vec3[], bendRadius: number) {
  const unique = points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 1e-7);
  const source = unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const incoming = normalize(subtract(point, unique[index - 1]));
    const outgoing = normalize(subtract(unique[index + 1], point));
    return dot(incoming, outgoing) < 0.999999;
  });
  const pieces: CableCurvePiece[] = [];
  if (source.length < 2) return pieces;
  let cursor = source[0];
  for (let index = 1; index < source.length - 1; index += 1) {
    const previous = source[index - 1];
    const corner = source[index];
    const next = source[index + 1];
    const incomingVector = subtract(corner, previous);
    const outgoingVector = subtract(next, corner);
    const incomingLength = magnitude(incomingVector);
    const outgoingLength = magnitude(outgoingVector);
    if (incomingLength < 1e-7 || outgoingLength < 1e-7) continue;
    const incoming = scale(incomingVector, 1 / incomingLength);
    const outgoing = scale(outgoingVector, 1 / outgoingLength);
    if (Math.abs(dot(incoming, outgoing)) > 0.9995) {
      if (distance(cursor, corner) > 1e-7) pieces.push(curvePiece("line", [cursor, corner], "route"));
      cursor = corner;
      continue;
    }
    // A tangent cubic circular fillet avoids the curvature pinch created by a
    // quadratic corner-control curve. Leave a small straight remainder when
    // consecutive 20 mm-grid corners share one leg, while using nearly the
    // complete leg when a thick cable needs the radius.
    const turnAngle = Math.acos(Math.max(-1, Math.min(1, dot(incoming, outgoing))));
    const desiredTrim = bendRadius * Math.tan(turnAngle / 2);
    const trim = Math.min(desiredTrim, incomingLength * 0.48, outgoingLength * 0.48);
    const bendStart = add(corner, scale(incoming, -trim));
    const bendEnd = add(corner, scale(outgoing, trim));
    if (distance(cursor, bendStart) > 1e-7) pieces.push(curvePiece("line", [cursor, bendStart], "route"));
    const filletRadius = trim / Math.max(1e-9, Math.tan(turnAngle / 2));
    const handle = 4 / 3 * Math.tan(turnAngle / 4) * filletRadius;
    pieces.push(curvePiece("cubic", [
      bendStart,
      add(bendStart, scale(incoming, handle)),
      add(bendEnd, scale(outgoing, -handle)),
      bendEnd,
    ], "route"));
    cursor = bendEnd;
  }
  const end = source.at(-1)!;
  if (distance(cursor, end) > 1e-7) pieces.push(curvePiece("line", [cursor, end], "route"));
  return pieces;
}

export function sampleCableCurve(pieces: readonly CableCurvePiece[]) {
  const result: Vec3[] = [];
  pieces.forEach((piece, pieceIndex) => {
    for (let division = pieceIndex === 0 ? 0 : 1; division <= piece.divisions; division += 1) {
      result.push(cableCurvePoint(piece, division / piece.divisions));
    }
  });
  return result;
}

function semanticLine(start: Vec3, end: Vec3) {
  return curvePiece("line", [start, end], "semantic");
}

function semanticBranch(
  split: Vec3,
  initialDirection: Vec3,
  terminal: Vec3,
  terminalDirection: Vec3,
) {
  const span = Math.max(0.001, distance(split, terminal));
  const handleLength = Math.max(0.004, Math.min(0.024, span * 0.34));
  return curvePiece("cubic", [
    split,
    add(split, scale(initialDirection, handleLength)),
    add(terminal, scale(terminalDirection, -handleLength)),
    terminal,
  ], "semantic");
}

function breakoutAngles(mates: readonly ResolvedConductor[]) {
  const result = new Map<string, number>();
  const unused = mates.length === 3 ? [45, 0, -45] : [45, -45];
  const preferred = (mate: ResolvedConductor) => {
    if (mate.kind === "positive" || mate.kind === "ac-line") return 45;
    if (mate.kind === "negative" || mate.kind === "ac-neutral") return mates.length === 3 ? 0 : -45;
    if (mate.kind === "earth") return -45;
    return undefined;
  };
  mates.forEach((mate) => {
    const angle = preferred(mate);
    if (angle === undefined || !unused.includes(angle)) return;
    result.set(mate.key, angle);
    unused.splice(unused.indexOf(angle), 1);
  });
  mates.filter((mate) => !result.has(mate.key)).toSorted((first, second) => first.key.localeCompare(second.key))
    .forEach((mate) => result.set(mate.key, unused.shift() ?? 0));
  return result;
}

function stableLateral(
  forward: Vec3,
  split: Vec3,
  mates: readonly ResolvedConductor[],
  angleByKey: ReadonlyMap<string, number>,
) {
  const positiveArm = mates.find((mate) => angleByKey.get(mate.key) === 45);
  if (positiveArm) {
    const projected = subtract(positiveArm.position, split);
    const lateral = subtract(projected, scale(forward, dot(projected, forward)));
    if (magnitude(lateral) > 1e-10) return normalize(lateral);
  }
  const fallbackAxis = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[])
    .toSorted((first, second) => Math.abs(dot(first, forward)) - Math.abs(dot(second, forward)))[0];
  return normalize(subtract(fallbackAxis, scale(forward, dot(fallbackAxis, forward))));
}

/** Exact renderer authority for selectable Y joins and multicore breakouts. */
export function renderedSemanticCables(
  devices: readonly ResolvedDevice[],
  conductors: readonly ResolvedConductor[],
  routes: readonly RoutedConnection[],
) {
  const conductorByKey = new Map(conductors.map((port) => [port.key, port]));
  const rendered: RenderedSemanticCable[] = [];
  devices.filter((device) => (
    device.presentation === "cable-breakout" || device.presentation === "integrated-cable-breakout"
  )).forEach((device) => {
    device.conductors.filter((port) => port.kind === "multicore" && (port.internalMates?.length ?? 0) >= 2)
      .forEach((port) => {
        const resolved = conductorByKey.get(`${device.id}.${port.id}`)!;
        const direction = normalize(resolved.direction);
        const mates = port.internalMates!.flatMap((id) => conductorByKey.get(`${device.id}.${id}`) ?? [])
          .filter((mate) => mate.kind !== "multicore");
        if (mates.length < 2) return;
        const integrated = device.presentation === "integrated-cable-breakout";
        const centerDistance = dot(subtract(device.position, resolved.position), scale(direction, -1));
        const trunkLength = Math.max(0.012, Math.min(0.050, centerDistance));
        // An integrated device's routed multicore cable already is the visible
        // white trunk. Split its internal colored cores exactly at that field
        // terminal rather than drawing a duplicate white tube over the route.
        const split = integrated ? resolved.position : add(resolved.position, scale(direction, -trunkLength));
        if (!integrated) {
          rendered.push({
            id: `${device.id}:trunk`, deviceId: device.id, conductorKey: resolved.key,
            radiusM: Math.max(0.0024, (resolved.terminalDiameterMm ?? 6) / 2400),
            color: "white", splitPoint: split, pieces: [semanticLine(resolved.position, split)],
          });
        }
        const forward = scale(direction, -1);
        const angleByKey = breakoutAngles(mates);
        const lateral = stableLateral(forward, split, mates, angleByKey);
        mates.forEach((mate) => {
          const angleDegrees = angleByKey.get(mate.key) ?? 0;
          const angle = angleDegrees * Math.PI / 180;
          const initialDirection = normalize(add(scale(forward, Math.cos(angle)), scale(lateral, Math.sin(angle))));
          rendered.push({
            id: `${device.id}:${mate.id}`, deviceId: device.id, conductorKey: mate.key,
            radiusM: Math.max(0.0017, (mate.terminalDiameterMm ?? 4) / 2400),
            color: mate.kind, splitPoint: split, branchAngleDegrees: angleDegrees,
            pieces: [semanticBranch(split, initialDirection, mate.position, normalize(mate.direction))],
          });
        });
      });
  });
  const routeRadiusByEndpoint = new Map<string, number>();
  routes.forEach((route) => {
    const radius = Math.max(0.0012, route.diameterMm / 2000);
    routeRadiusByEndpoint.set(route.from, radius);
    routeRadiusByEndpoint.set(route.to, radius);
  });
  const wireRadius = (port: ResolvedConductor) => routeRadiusByEndpoint.get(port.key)
    ?? Math.max(0.0012, (port.terminalDiameterMm ?? 4) / 2000);
  devices.filter((device) => device.presentation === "wire-join").forEach((device) => {
    const attachmentEndpoint = device.attachment?.endpoint;
    const attachmentRoute = attachmentEndpoint
      ? routes.find((route) => route.from === attachmentEndpoint || route.to === attachmentEndpoint)
      : undefined;
    const attachedJoinKey = attachmentRoute
      ? attachmentRoute.from === attachmentEndpoint ? attachmentRoute.to : attachmentRoute.from
      : undefined;
    const devicePort = attachedJoinKey?.startsWith(`${device.id}.`) ? conductorByKey.get(attachedJoinKey) : undefined;
    if (!devicePort) return;
    const split = device.position;
    const forward = scale(normalize(devicePort.direction), -1);
    const arms = device.conductors.flatMap((port) => conductorByKey.get(`${device.id}.${port.id}`) ?? [])
      .filter((port) => port.key !== devicePort.key)
      .toSorted((first, second) => dot(second.direction, forward) - dot(first.direction, forward));
    const [throughPort, branchPort] = arms;
    if (!throughPort || !branchPort) return;
    const branchOffset = subtract(branchPort.position, split);
    const projected = subtract(branchOffset, scale(forward, dot(branchOffset, forward)));
    let lateral = magnitude(projected) < 1e-10
      ? stableLateral(forward, split, [throughPort, branchPort], new Map([[throughPort.key, 45], [branchPort.key, -45]]))
      : scale(normalize(projected), -1);
    lateral = normalize(lateral);
    rendered.push({
      id: `${device.id}:trunk`, deviceId: device.id, conductorKey: devicePort.key,
      radiusM: wireRadius(devicePort),
      color: devicePort.kind, splitPoint: split, pieces: [semanticLine(devicePort.position, split)],
    });
    ([{ port: throughPort, angle: 45 }, { port: branchPort, angle: -45 }] as const).forEach(({ port, angle }) => {
      const radians = angle * Math.PI / 180;
      const initialDirection = normalize(add(scale(forward, Math.cos(radians)), scale(lateral, Math.sin(radians))));
      rendered.push({
        id: `${device.id}:${port.id}`, deviceId: device.id, conductorKey: port.key,
        radiusM: wireRadius(port),
        color: port.kind, splitPoint: split, branchAngleDegrees: angle,
        pieces: [semanticBranch(split, initialDirection, port.position, normalize(port.direction))],
      });
    });
  });
  devices.filter((device) => device.presentation === "service-splice").forEach((device) => {
    const split = device.position;
    device.conductors.forEach((port) => {
      const resolved = conductorByKey.get(`${device.id}.${port.id}`);
      if (!resolved) return;
      rendered.push({
        id: `${device.id}:${port.id}`,
        deviceId: device.id,
        conductorKey: resolved.key,
        radiusM: wireRadius(resolved),
        color: resolved.kind,
        splitPoint: split,
        pieces: [semanticLine(split, resolved.position)],
      });
    });
  });
  return rendered;
}
