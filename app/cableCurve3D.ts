import * as THREE from "three";
import { roundedRoutePieces } from "./renderedCableGeometry";
import type { CableCurvePiece } from "./renderedCableGeometry";
import type { Vec3 } from "./systemGraph";
type RouteCurvePiece = {
  curve: THREE.Curve<THREE.Vector3>;
  divisions: number;
  length: number;
  bend: boolean;
  startDivision: number;
};

/**
 * TubeGeometry samples a curve at one global interval. On a long cable that
 * can leave a short terminal bend with only one or two rings, even when the
 * route has hundreds of segments overall. This curve gives every straight and
 * bend an integer share of that interval so every piece boundary is sampled
 * exactly and every bend keeps enough rings to remain round.
 */
class TessellatedRouteCurve extends THREE.Curve<THREE.Vector3> {
  readonly pieces: readonly RouteCurvePiece[];
  readonly tubularSegments: number;
  readonly bendCount: number;
  private readonly totalLength: number;

  constructor(source: readonly Omit<RouteCurvePiece, "startDivision">[]) {
    super();
    let startDivision = 0;
    this.pieces = source.map((piece) => {
      const withStart = { ...piece, startDivision };
      startDivision += piece.divisions;
      return withStart;
    });
    this.tubularSegments = startDivision;
    this.bendCount = source.filter((piece) => piece.bend).length;
    this.totalLength = source.reduce((sum, piece) => sum + piece.length, 0);
  }

  private sample(t: number, target: THREE.Vector3, tangent: boolean) {
    if (this.pieces.length === 0 || this.tubularSegments === 0) return target.set(0, 0, 0);
    const scaled = THREE.MathUtils.clamp(t, 0, 1) * this.tubularSegments;
    const piece = scaled >= this.tubularSegments
      ? this.pieces.at(-1)!
      : this.pieces.find((candidate) => scaled <= candidate.startDivision + candidate.divisions) ?? this.pieces.at(-1)!;
    const localT = THREE.MathUtils.clamp((scaled - piece.startDivision) / piece.divisions, 0, 1);
    return tangent
      ? piece.curve.getTangent(localT, target)
      : piece.curve.getPoint(localT, target);
  }

  getPoint(t: number, optionalTarget = new THREE.Vector3()) {
    return this.sample(t, optionalTarget, false);
  }

  getPointAt(u: number, optionalTarget = new THREE.Vector3()) {
    return this.sample(u, optionalTarget, false);
  }

  getTangent(t: number, optionalTarget = new THREE.Vector3()) {
    return this.sample(t, optionalTarget, true);
  }

  getTangentAt(u: number, optionalTarget = new THREE.Vector3()) {
    return this.sample(u, optionalTarget, true);
  }

  getLength() {
    return this.totalLength;
  }
}

export function tessellatedCableCurve(descriptors: readonly CableCurvePiece[]) {
  const pieces = descriptors.map((piece): Omit<RouteCurvePiece, "startDivision"> => {
    const vectors = piece.points.map((point) => new THREE.Vector3(...point));
    const curve = piece.kind === "line"
      ? new THREE.LineCurve3(vectors[0], vectors[1])
      : piece.kind === "quadratic"
        ? new THREE.QuadraticBezierCurve3(vectors[0], vectors[1], vectors[2])
        : new THREE.CubicBezierCurve3(vectors[0], vectors[1], vectors[2], vectors[3]);
    return { curve, divisions: piece.divisions, length: piece.lengthM, bend: piece.bend };
  });
  return new TessellatedRouteCurve(pieces);
}

export function roundedRouteCurve(points: readonly Vec3[], bendRadius: number) {
  return tessellatedCableCurve(roundedRoutePieces(points, bendRadius));
}

