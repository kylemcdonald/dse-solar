import * as THREE from "three";

export type VectorTuple = [number, number, number];
export type CableVisibility = "context" | "junction";
export type PassageAxis = "x" | "y" | "z";

export type CablePassage = {
  axis: PassageAxis;
  center: VectorTuple;
  radius: number;
};

export type CableRoutingReport = {
  automaticCrossovers: number;
  backtrackingCorners: number;
  backtrackingIssues: string[];
  continuousHandoffs: number;
  discontinuousHandoffIssues: string[];
  discontinuousHandoffs: number;
  obstacleIssues: string[];
  obstacleIntersections: number;
  roundedCorners: number;
  routeCount: number;
  unresolvedCableIssues: string[];
  unresolvedCableIntersections: number;
};

type CableRoute = {
  id: string;
  points: THREE.Vector3[];
  radius: number;
  visibility: CableVisibility;
};

type CableObstacle = {
  box: THREE.Box3;
  id: string;
  passages: CablePassage[];
};

type CableHandoff = {
  after: THREE.Vector3;
  before: THREE.Vector3;
  id: string;
  join: THREE.Vector3;
};

type SegmentProximity = {
  candidateT: number;
  distance: number;
  existingT: number;
  pointOnCandidate: THREE.Vector3;
  pointOnExisting: THREE.Vector3;
};

type Crossing = SegmentProximity & {
  candidateSegment: number;
  existingRadius: number;
  existingSegment: number;
  normal: THREE.Vector3;
};

const EPSILON = 1e-5;
const TERMINAL_GRACE = 0.1;
const ROUTE_CLEARANCE = 0.003;

function tuple(point: THREE.Vector3): VectorTuple {
  return [point.x, point.y, point.z];
}

function describeRoute(route: CableRoute) {
  const format = (point: THREE.Vector3) => `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.z.toFixed(3)}`;
  return `${route.id}[${format(route.points[0])}→${format(route.points[route.points.length - 1])}]`;
}

function vector(point: VectorTuple) {
  return new THREE.Vector3(point[0], point[1], point[2]);
}

function axisVector(axis: PassageAxis) {
  if (axis === "x") return new THREE.Vector3(1, 0, 0);
  if (axis === "y") return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

function compactPoints(points: VectorTuple[]) {
  const unique = points.map(vector).filter((point, index, all) => (
    index === 0 || point.distanceToSquared(all[index - 1]) > EPSILON * EPSILON
  ));
  if (unique.length < 3) return unique;

  const compacted: THREE.Vector3[] = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = compacted[compacted.length - 1];
    const current = unique[index];
    const next = unique[index + 1];
    const incoming = current.clone().sub(previous);
    const outgoing = next.clone().sub(current);
    if (
      incoming.lengthSq() > EPSILON &&
      outgoing.lengthSq() > EPSILON &&
      incoming.normalize().dot(outgoing.normalize()) > 0.9999
    ) {
      continue;
    }
    compacted.push(current);
  }
  compacted.push(unique[unique.length - 1]);
  return compacted;
}

function segmentProximity(
  candidateStart: THREE.Vector3,
  candidateEnd: THREE.Vector3,
  existingStart: THREE.Vector3,
  existingEnd: THREE.Vector3,
): SegmentProximity {
  const u = candidateEnd.clone().sub(candidateStart);
  const v = existingEnd.clone().sub(existingStart);
  const w = candidateStart.clone().sub(existingStart);
  const a = u.dot(u);
  const b = u.dot(v);
  const c = v.dot(v);
  const d = u.dot(w);
  const e = v.dot(w);
  const denominator = a * c - b * b;
  let numeratorS: number;
  let denominatorS = denominator;
  let numeratorT: number;
  let denominatorT = denominator;

  if (denominator < EPSILON) {
    numeratorS = 0;
    denominatorS = 1;
    numeratorT = e;
    denominatorT = c;
  } else {
    numeratorS = b * e - c * d;
    numeratorT = a * e - b * d;
    if (numeratorS < 0) {
      numeratorS = 0;
      numeratorT = e;
      denominatorT = c;
    } else if (numeratorS > denominatorS) {
      numeratorS = denominatorS;
      numeratorT = e + b;
      denominatorT = c;
    }
  }

  if (numeratorT < 0) {
    numeratorT = 0;
    if (-d < 0) numeratorS = 0;
    else if (-d > a) numeratorS = denominatorS;
    else {
      numeratorS = -d;
      denominatorS = a;
    }
  } else if (numeratorT > denominatorT) {
    numeratorT = denominatorT;
    if (-d + b < 0) numeratorS = 0;
    else if (-d + b > a) numeratorS = denominatorS;
    else {
      numeratorS = -d + b;
      denominatorS = a;
    }
  }

  const candidateT = Math.abs(numeratorS) < EPSILON ? 0 : numeratorS / denominatorS;
  const existingT = Math.abs(numeratorT) < EPSILON ? 0 : numeratorT / denominatorT;
  const pointOnCandidate = candidateStart.clone().addScaledVector(u, candidateT);
  const pointOnExisting = existingStart.clone().addScaledVector(v, existingT);
  return {
    candidateT,
    distance: pointOnCandidate.distanceTo(pointOnExisting),
    existingT,
    pointOnCandidate,
    pointOnExisting,
  };
}

function isInteriorCrossing(proximity: SegmentProximity) {
  return (
    proximity.candidateT > TERMINAL_GRACE &&
    proximity.candidateT < 1 - TERMINAL_GRACE &&
    proximity.existingT > TERMINAL_GRACE &&
    proximity.existingT < 1 - TERMINAL_GRACE
  );
}

function routesShareTerminal(first: THREE.Vector3[], second: THREE.Vector3[], tolerance: number) {
  const firstTerminals = [first[0], first[first.length - 1]];
  const secondTerminals = [second[0], second[second.length - 1]];
  return firstTerminals.some((firstTerminal) => (
    secondTerminals.some((secondTerminal) => firstTerminal.distanceTo(secondTerminal) <= tolerance)
  ));
}

function preferredNormal(candidateDirection: THREE.Vector3, existingDirection: THREE.Vector3) {
  const normal = candidateDirection.clone().cross(existingDirection).normalize();
  if (normal.lengthSq() < EPSILON) return new THREE.Vector3(0, 0, 1);
  const components = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  const dominant = components.indexOf(Math.max(...components));
  if (
    (dominant === 2 && normal.z < 0) ||
    (dominant === 1 && normal.y < 0) ||
    (dominant === 0 && normal.x < 0)
  ) {
    normal.negate();
  }
  return normal;
}

function segmentIntersectsBox(start: THREE.Vector3, end: THREE.Vector3, box: THREE.Box3) {
  const direction = end.clone().sub(start);
  let minimum = 0;
  let maximum = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const value = direction[axis];
    if (Math.abs(value) < EPSILON) {
      if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) return false;
      continue;
    }
    let near = (box.min[axis] - start[axis]) / value;
    let far = (box.max[axis] - start[axis]) / value;
    if (near > far) [near, far] = [far, near];
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) return false;
  }
  return maximum >= 0 && minimum <= 1;
}

function passageAllowsSegment(
  start: THREE.Vector3,
  end: THREE.Vector3,
  passage: CablePassage,
  cableRadius: number,
) {
  const direction = end.clone().sub(start);
  if (direction.lengthSq() < EPSILON) return false;
  direction.normalize();
  if (Math.abs(direction.dot(axisVector(passage.axis))) < 0.94) return false;
  const center = vector(passage.center);
  const closest = new THREE.Line3(start, end).closestPointToPoint(center, true, new THREE.Vector3());
  return closest.distanceTo(center) + cableRadius <= passage.radius;
}

export function buildRoundedCableCurve(points: VectorTuple[], requestedBendRadius: number) {
  const route = compactPoints(points);
  const path = new THREE.CurvePath<THREE.Vector3>();
  if (route.length < 2) return { curve: path, roundedCorners: 0 };

  let cursor = route[0].clone();
  let roundedCorners = 0;
  for (let index = 1; index < route.length - 1; index += 1) {
    const previous = route[index - 1];
    const corner = route[index];
    const next = route[index + 1];
    const incomingVector = corner.clone().sub(previous);
    const outgoingVector = next.clone().sub(corner);
    const incomingLength = incomingVector.length();
    const outgoingLength = outgoingVector.length();
    if (incomingLength < EPSILON || outgoingLength < EPSILON) continue;
    const incoming = incomingVector.normalize();
    const outgoing = outgoingVector.normalize();
    const deflection = Math.acos(THREE.MathUtils.clamp(incoming.dot(outgoing), -1, 1));
    const turnNormal = incoming.clone().cross(outgoing);
    if (deflection < 0.015 || Math.PI - deflection < 0.015 || turnNormal.lengthSq() < EPSILON) {
      if (cursor.distanceToSquared(corner) > EPSILON) {
        path.add(new THREE.LineCurve3(cursor.clone(), corner.clone()));
      }
      cursor = corner.clone();
      continue;
    }

    const tangentFactor = Math.tan(deflection / 2);
    const maximumTrim = Math.min(incomingLength, outgoingLength) * 0.44;
    const trim = Math.min(requestedBendRadius * tangentFactor, maximumTrim);
    const entry = corner.clone().addScaledVector(incoming, -trim);
    const exit = corner.clone().addScaledVector(outgoing, trim);

    if (cursor.distanceToSquared(entry) > EPSILON) {
      path.add(new THREE.LineCurve3(cursor.clone(), entry));
    }
    // A corner-controlled quadratic is tangent to both adjoining straight
    // runs and remains inside their convex hull. That prevents a 3D bend from
    // visually curling behind its corner when viewed in perspective.
    path.add(new THREE.QuadraticBezierCurve3(entry, corner.clone(), exit));
    cursor = exit;
    roundedCorners += 1;
  }
  const end = route[route.length - 1];
  if (cursor.distanceToSquared(end) > EPSILON) {
    path.add(new THREE.LineCurve3(cursor, end.clone()));
  }
  return { curve: path, roundedCorners };
}

export function buildRoundedCableGeometry(
  points: VectorTuple[],
  requestedBendRadius: number,
  cableRadius: number,
  radialSegments = 8,
) {
  const { curve, roundedCorners } = buildRoundedCableCurve(points, requestedBendRadius);
  const pathLength = curve.getLength();
  if (pathLength < EPSILON) throw new Error("Unable to build zero-length cable geometry");

  // One tube surface owns every straight and bend in a route. The previous
  // implementation merged independent open cylinders and bend tubes. Their
  // polygon rings could rotate relative to one another, leaving visible wedge
  // gaps where two bends were separated by only a short straight section.
  // This variable-density centerline keeps one shared ring at every join, so
  // even back-to-back bends are one connected surface with no internal seams.
  // Straight runs need only their endpoints; curved sections receive enough
  // rings to remain round without tessellating an entire long cable every few
  // millimetres.
  const centerline: THREE.Vector3[] = [];
  const pushCenter = (point: THREE.Vector3) => {
    if ((centerline.at(-1)?.distanceToSquared(point) ?? Number.POSITIVE_INFINITY) < EPSILON * EPSILON) return;
    centerline.push(point.clone());
  };
  curve.curves.forEach((section) => {
    const sectionSegments = section instanceof THREE.LineCurve3
      ? 1
      : Math.max(
        5,
        Math.min(14, Math.ceil(section.getLength() / Math.max(cableRadius * 1.15, 0.003))),
      );
    for (let step = 0; step <= sectionSegments; step += 1) {
      pushCenter(section.getPoint(step / sectionSegments));
    }
  });
  if (centerline.length < 2) throw new Error("Unable to sample cable centerline");

  const tangents = centerline.map((point, index) => {
    if (index === 0) return centerline[1].clone().sub(point).normalize();
    if (index === centerline.length - 1) return point.clone().sub(centerline[index - 1]).normalize();
    return centerline[index + 1].clone().sub(centerline[index - 1]).normalize();
  });
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  const axes = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  const initialAxis = axes.reduce((leastAligned, axis) => (
    Math.abs(tangents[0].dot(axis)) < Math.abs(tangents[0].dot(leastAligned)) ? axis : leastAligned
  ));
  const frameHelper = new THREE.Vector3().crossVectors(tangents[0], initialAxis).normalize();
  normals[0] = new THREE.Vector3().crossVectors(tangents[0], frameHelper).normalize();
  binormals[0] = new THREE.Vector3().crossVectors(tangents[0], normals[0]).normalize();

  for (let index = 1; index < centerline.length; index += 1) {
    const rotationAxis = new THREE.Vector3().crossVectors(tangents[index - 1], tangents[index]);
    normals[index] = normals[index - 1].clone();
    if (rotationAxis.lengthSq() > EPSILON) {
      rotationAxis.normalize();
      const angle = Math.acos(THREE.MathUtils.clamp(tangents[index - 1].dot(tangents[index]), -1, 1));
      normals[index].applyAxisAngle(rotationAxis, angle).normalize();
    }
    binormals[index] = new THREE.Vector3().crossVectors(tangents[index], normals[index]).normalize();
    normals[index].crossVectors(binormals[index], tangents[index]).normalize();
  }

  const positions: number[] = [];
  const vertexNormals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  centerline.forEach((point, ring) => {
    for (let side = 0; side < radialSegments; side += 1) {
      const angle = (side / radialSegments) * Math.PI * 2;
      const radial = normals[ring].clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(binormals[ring], Math.sin(angle));
      const vertex = point.clone().addScaledVector(radial, cableRadius);
      positions.push(vertex.x, vertex.y, vertex.z);
      vertexNormals.push(radial.x, radial.y, radial.z);
      uvs.push(ring / Math.max(1, centerline.length - 1), side / radialSegments);
    }
  });
  for (let ring = 0; ring < centerline.length - 1; ring += 1) {
    for (let side = 0; side < radialSegments; side += 1) {
      const nextSide = (side + 1) % radialSegments;
      const current = ring * radialSegments + side;
      const around = ring * radialSegments + nextSide;
      const forward = (ring + 1) * radialSegments + side;
      const forwardAround = (ring + 1) * radialSegments + nextSide;
      indices.push(current, around, forward, forward, around, forwardAround);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(vertexNormals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.userData.continuousCableSurface = true;
  geometry.userData.internalJoinCount = Math.max(0, centerline.length - 2);
  geometry.computeBoundingSphere();
  return {
    centerline: centerline.map(tuple),
    geometry,
    roundedCorners,
  };
}

export class CableRoutingSystem {
  private automaticCrossovers = 0;
  private handoffs: CableHandoff[] = [];
  private obstacles: CableObstacle[] = [];
  private roundedCorners = 0;
  private routes: CableRoute[] = [];

  registerObstacle(id: string, center: VectorTuple, size: VectorTuple, passages: CablePassage[] = []) {
    const half = vector(size).multiplyScalar(0.5);
    const middle = vector(center);
    this.obstacles.push({
      box: new THREE.Box3(middle.clone().sub(half), middle.clone().add(half)),
      id,
      passages,
    });
  }

  prepareRoute(
    sourcePoints: VectorTuple[],
    radius: number,
    visibility: CableVisibility,
    avoidCrossings = true,
  ) {
    let points = compactPoints(sourcePoints);
    if (avoidCrossings && points.length > 1) {
      for (let pass = 0; pass < 3; pass += 1) {
        const crossingsBefore = this.automaticCrossovers;
        points = this.addCrossovers(points, radius);
        if (this.automaticCrossovers === crossingsBefore) break;
      }
    }
    this.routes.push({
      id: `route-${String(this.routes.length + 1).padStart(3, "0")}`,
      points: points.map((point) => point.clone()),
      radius,
      visibility,
    });
    return points.map(tuple);
  }

  noteRoundedCorners(count: number) {
    this.roundedCorners += count;
  }

  registerTangentHandoff(
    id: string,
    before: VectorTuple,
    join: VectorTuple,
    after: VectorTuple,
  ) {
    this.handoffs.push({
      after: vector(after),
      before: vector(before),
      id,
      join: vector(join),
    });
  }

  report(): CableRoutingReport {
    let backtrackingCorners = 0;
    const backtrackingIssues: string[] = [];
    for (const route of this.routes) {
      for (let index = 1; index < route.points.length - 1; index += 1) {
        const incoming = route.points[index].clone().sub(route.points[index - 1]);
        const outgoing = route.points[index + 1].clone().sub(route.points[index]);
        if (incoming.lengthSq() < EPSILON || outgoing.lengthSq() < EPSILON) continue;
        const alignment = incoming.normalize().dot(outgoing.normalize());
        if (alignment > -0.98) continue;
        backtrackingCorners += 1;
        const corner = route.points[index];
        backtrackingIssues.push(
          `${describeRoute(route)}:${index} reverses at ${corner.x.toFixed(3)},${corner.y.toFixed(3)},${corner.z.toFixed(3)}`,
        );
      }
    }

    let obstacleIntersections = 0;
    const obstacleIssues: string[] = [];
    for (const route of this.routes) {
      for (let index = 0; index < route.points.length - 1; index += 1) {
        const start = route.points[index];
        const end = route.points[index + 1];
        for (const obstacle of this.obstacles) {
          const expanded = obstacle.box.clone().expandByScalar(route.radius + 0.0015);
          if (!segmentIntersectsBox(start, end, expanded)) continue;
          if (obstacle.passages.some((passage) => passageAllowsSegment(start, end, passage, route.radius))) continue;
          obstacleIntersections += 1;
          obstacleIssues.push(`${describeRoute(route)}:${index} intersects ${obstacle.id}`);
        }
      }
    }

    let unresolvedCableIntersections = 0;
    const unresolvedCableIssues: string[] = [];
    for (let firstIndex = 0; firstIndex < this.routes.length; firstIndex += 1) {
      const first = this.routes[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < this.routes.length; secondIndex += 1) {
        const second = this.routes[secondIndex];
        const crossings = this.interiorCrossings(first, second);
        unresolvedCableIntersections += crossings.length;
        if (crossings.length > 0) {
          const point = (value: THREE.Vector3) => `${value.x.toFixed(3)},${value.y.toFixed(3)},${value.z.toFixed(3)}`;
          const segments = crossings.map(([firstSegment, secondSegment]) => (
            `${firstSegment}[${point(first.points[firstSegment])}→${point(first.points[firstSegment + 1])}]` +
            `/${secondSegment}[${point(second.points[secondSegment])}→${point(second.points[secondSegment + 1])}]`
          )).join(",");
          unresolvedCableIssues.push(`${describeRoute(first)} intersects ${describeRoute(second)} (${crossings.length}; segments ${segments})`);
        }
      }
    }
    const discontinuousHandoffIssues = this.handoffs.flatMap((handoff) => {
      const incoming = handoff.join.clone().sub(handoff.before);
      const outgoing = handoff.after.clone().sub(handoff.join);
      if (incoming.lengthSq() < EPSILON || outgoing.lengthSq() < EPSILON) {
        return [`${handoff.id}: zero-length handoff segment`];
      }
      const tangentError = 1 - incoming.normalize().dot(outgoing.normalize());
      if (tangentError > 0.0001) {
        return [`${handoff.id}: tangent error ${tangentError.toFixed(6)}`];
      }
      return [];
    });
    return {
      automaticCrossovers: this.automaticCrossovers,
      backtrackingCorners,
      backtrackingIssues,
      continuousHandoffs: this.handoffs.length - discontinuousHandoffIssues.length,
      discontinuousHandoffIssues,
      discontinuousHandoffs: discontinuousHandoffIssues.length,
      obstacleIssues,
      obstacleIntersections,
      roundedCorners: this.roundedCorners,
      routeCount: this.routes.length,
      unresolvedCableIssues,
      unresolvedCableIntersections,
    };
  }

  private addCrossovers(points: THREE.Vector3[], radius: number) {
    const crossingsBySegment = new Map<number, Crossing[]>();
    points.slice(0, -1).forEach((start, candidateSegment) => {
      const end = points[candidateSegment + 1];
      const candidateDirection = end.clone().sub(start);
      if (candidateDirection.lengthSq() < EPSILON) return;
      for (const route of this.routes) {
        if (routesShareTerminal(points, route.points, radius + route.radius + ROUTE_CLEARANCE)) continue;
        route.points.slice(0, -1).forEach((existingStart, existingSegment) => {
          const existingEnd = route.points[existingSegment + 1];
          const existingDirection = existingEnd.clone().sub(existingStart);
          if (existingDirection.lengthSq() < EPSILON) return;
          const alignment = Math.abs(candidateDirection.clone().normalize().dot(existingDirection.clone().normalize()));
          if (alignment > 0.93) return;
          const proximity = segmentProximity(start, end, existingStart, existingEnd);
          if (!isInteriorCrossing(proximity)) return;
          if (proximity.distance >= radius + route.radius + ROUTE_CLEARANCE) return;
          const crossings = crossingsBySegment.get(candidateSegment) ?? [];
          crossings.push({
            ...proximity,
            candidateSegment,
            existingRadius: route.radius,
            existingSegment,
            normal: preferredNormal(candidateDirection, existingDirection),
          });
          crossingsBySegment.set(candidateSegment, crossings);
        });
      }
    });
    if (crossingsBySegment.size === 0) return points;

    const result: THREE.Vector3[] = [points[0].clone()];
    points.slice(0, -1).forEach((start, segmentIndex) => {
      const end = points[segmentIndex + 1];
      const crossings = (crossingsBySegment.get(segmentIndex) ?? [])
        .sort((first, second) => first.candidateT - second.candidateT);
      if (crossings.length === 0) {
        result.push(end.clone());
        return;
      }
      const segment = end.clone().sub(start);
      const segmentLength = segment.length();
      let lastT = 0;
      for (const crossing of crossings) {
        const lift = radius + crossing.existingRadius + ROUTE_CLEARANCE * 1.6;
        const run = Math.min(
          Math.max(lift * 2.8, radius * 5),
          segmentLength * 0.18,
          crossing.candidateT * segmentLength * 0.72,
          (1 - crossing.candidateT) * segmentLength * 0.72,
        );
        if (run < radius * 1.25) continue;
        const beforeT = Math.max(lastT + 0.01, crossing.candidateT - run / segmentLength);
        const afterT = Math.min(0.99, crossing.candidateT + run / segmentLength);
        if (beforeT >= afterT) continue;
        const before = start.clone().lerp(end, beforeT);
        const after = start.clone().lerp(end, afterT);
        result.push(before);
        result.push(before.clone().addScaledVector(crossing.normal, lift));
        result.push(after.clone().addScaledVector(crossing.normal, lift));
        result.push(after);
        lastT = afterT;
        this.automaticCrossovers += 1;
      }
      result.push(end.clone());
    });
    return compactPoints(result.map(tuple));
  }

  private interiorCrossings(first: CableRoute, second: CableRoute) {
    if (routesShareTerminal(first.points, second.points, first.radius + second.radius + ROUTE_CLEARANCE)) {
      return [];
    }
    const crossings: Array<[number, number]> = [];
    first.points.slice(0, -1).forEach((firstStart, firstIndex) => {
      const firstEnd = first.points[firstIndex + 1];
      const firstDirection = firstEnd.clone().sub(firstStart).normalize();
      second.points.slice(0, -1).forEach((secondStart, secondIndex) => {
        const secondEnd = second.points[secondIndex + 1];
        const secondDirection = secondEnd.clone().sub(secondStart).normalize();
        if (Math.abs(firstDirection.dot(secondDirection)) > 0.93) return;
        const proximity = segmentProximity(firstStart, firstEnd, secondStart, secondEnd);
        if (!isInteriorCrossing(proximity)) return;
        if (proximity.distance < first.radius + second.radius + ROUTE_CLEARANCE) {
          crossings.push([firstIndex, secondIndex]);
        }
      });
    });
    return crossings;
  }
}
