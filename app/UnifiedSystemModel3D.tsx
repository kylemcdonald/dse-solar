"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { CurrentSafetySummary } from "./CurrentSafetySummary";
import { dseRuntime } from "./dseRuntime";
import { GrabPointCameraControls } from "./GrabPointCameraControls";
import {
  MIN_ROUTE_BEND_SEGMENTS,
  renderedRoutePoints,
  renderedSemanticCables,
  roundedRoutePieces,
} from "./renderedCableGeometry";
import type { CableCurvePiece } from "./renderedCableGeometry";
import { conductorColor, EQUIPMENT_WALL_VOLUME, isPurchasedDevice } from "./systemGraph";
import type { GraphSelection, ResolvedConductor, ResolvedDevice, Vec3 } from "./systemGraph";

type Props = {
  fadePurchased: boolean;
  onFadePurchasedChange: (fade: boolean) => void;
  onSelect: (selection: GraphSelection) => void;
  onClearSelection: () => void;
};

type CameraPreset = "whole" | "wall" | "dc" | "cutoff" | "services";

type CameraPose = {
  position: Vec3;
  target: Vec3;
};

const BATTERY_CUTOFF_JUNCTION_ID = "batteryCutoffJunction";
const SECONDARY_SERVICES_JUNCTION_ID = "secondaryJunction";
const MAIN_DISTRIBUTION_COMPONENT_ID = "mainDistribution";
const HOVER_HIGHLIGHT = "#fff200";
const DC_CLUSTER_COMPONENT_IDS = new Set([
  MAIN_DISTRIBUTION_COMPONENT_ID,
  "solarController",
  "balancers",
  "inverter",
]);
const cameraPresets: readonly { key: CameraPreset; label: string }[] = [
  { key: "whole", label: "Whole system" },
  { key: "wall", label: "Wall board" },
  { key: "dc", label: "DC distribution" },
  { key: "cutoff", label: "Battery cutoffs" },
  { key: "services", label: "Secondary services" },
];

const WALL_SHADOW_CASTER_LAYER = 1;
const DEVICE_SHADOW_CASTER_LAYER = 2;
const WALL_DEVICE_SHADOW_RECEIVER_LAYER = 3;

function deviceBounds(devices: readonly ResolvedDevice[]) {
  const min = ([0, 1, 2] as const).map((axis) => Math.min(...devices.map((device) => device.position[axis] - device.size[axis] / 2))) as unknown as Vec3;
  const max = ([0, 1, 2] as const).map((axis) => Math.max(...devices.map((device) => device.position[axis] + device.size[axis] / 2))) as unknown as Vec3;
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return { target, size };
}

function belongsToJunction(device: ResolvedDevice, junctionId: string) {
  return device.id === junctionId || (
    device.placement.space === "junction" && device.placement.junctionId === junctionId
  );
}

function junctionDevices(junctionId: string) {
  return dseRuntime.devices.filter((device) => belongsToJunction(device, junctionId));
}

function boundsWithWholeSystemFallback(devices: readonly ResolvedDevice[]) {
  return deviceBounds(devices.length > 0 ? devices : dseRuntime.devices);
}

function frontCameraPose(
  bounds: ReturnType<typeof deviceBounds>,
  framing: { widthScale: number; heightScale: number; minimumDistance: number; xOffset?: number; yOffset?: number },
): CameraPose {
  const distance = Math.max(
    bounds.size[0] * framing.widthScale,
    bounds.size[1] * framing.heightScale,
    framing.minimumDistance,
  );
  return {
    position: [
      bounds.target[0] + bounds.size[0] * (framing.xOffset ?? 0),
      bounds.target[1] + bounds.size[1] * (framing.yOffset ?? 0.16),
      bounds.target[2] + bounds.size[2] / 2 + distance,
    ],
    target: bounds.target,
  };
}

const wholeBounds = deviceBounds(dseRuntime.devices);
const wallBounds = boundsWithWholeSystemFallback(dseRuntime.devices.filter((device) => (
  device.placement.space === "world" && ["wall", "outside-wall"].includes(device.placement.surface)
)));
const batteryCutoffDevices = junctionDevices(BATTERY_CUTOFF_JUNCTION_ID);
const secondaryServicesDevices = junctionDevices(SECONDARY_SERVICES_JUNCTION_ID);
const dcDistributionDevices = dseRuntime.devices.filter((device) => (
  device.kind === "battery"
  || (device.componentId !== undefined && DC_CLUSTER_COMPONENT_IDS.has(device.componentId))
  || belongsToJunction(device, BATTERY_CUTOFF_JUNCTION_ID)
  || belongsToJunction(device, SECONDARY_SERVICES_JUNCTION_ID)
));
const dcDistributionBounds = boundsWithWholeSystemFallback(dcDistributionDevices);
const batteryCutoffBounds = boundsWithWholeSystemFallback(batteryCutoffDevices);
const secondaryServicesBounds = boundsWithWholeSystemFallback(secondaryServicesDevices);
const wholeSpan = Math.max(wholeBounds.size[0], wholeBounds.size[1] * 1.8, wholeBounds.size[2] * 1.6);
const presetPose: Record<CameraPreset, CameraPose> = {
  whole: {
    position: [wholeBounds.target[0] + wholeSpan * 0.50, wholeBounds.target[1] + wholeSpan * 0.48, wholeBounds.target[2] + wholeSpan * 0.76],
    target: wholeBounds.target,
  },
  wall: frontCameraPose(wallBounds, { widthScale: 0.98, heightScale: 1.9, minimumDistance: 2.4 }),
  dc: frontCameraPose(dcDistributionBounds, {
    widthScale: 1.02,
    heightScale: 1.45,
    minimumDistance: 1.2,
    yOffset: 0.35,
  }),
  cutoff: frontCameraPose(batteryCutoffBounds, { widthScale: 1.65, heightScale: 2.1, minimumDistance: 0.45, xOffset: 0.04, yOffset: 0.20 }),
  services: frontCameraPose(secondaryServicesBounds, {
    widthScale: 1.9,
    heightScale: 2.35,
    minimumDistance: 0.90,
    xOffset: 0.02,
    yOffset: 0.12,
  }),
};

const terminalTangentErrors = dseRuntime.routes.filter((route) => {
  if (route.points.length < 2) return true;
  const from = dseRuntime.conductorByKey.get(route.from);
  const to = dseRuntime.conductorByKey.get(route.to);
  if (!from || !to) return true;
  const start = new THREE.Vector3(...route.points[0]);
  const startNext = new THREE.Vector3(...route.points[1]);
  const end = new THREE.Vector3(...route.points.at(-1)!);
  const endPrevious = new THREE.Vector3(...route.points.at(-2)!);
  const startTangent = startNext.sub(start).normalize();
  const endApproach = endPrevious.sub(end).normalize();
  return startTangent.dot(new THREE.Vector3(...from.direction).normalize()) < 0.999999 ||
    endApproach.dot(new THREE.Vector3(...to.direction).normalize()) < 0.999999;
}).length;
const connectedConductorKeys = new Set(dseRuntime.routes.flatMap((route) => [route.from, route.to]));
dseRuntime.conductors.forEach((port) => {
  const hasReciprocalInternalMate = port.internalMates?.some((mateId) => (
    dseRuntime.conductorByKey.get(`${port.deviceId}.${mateId}`)?.internalMates?.includes(port.id)
  ));
  if (hasReciprocalInternalMate) connectedConductorKeys.add(port.key);
});
const unusedConductorCount = dseRuntime.conductors.filter((port) => !connectedConductorKeys.has(port.key)).length;
const routingTargetChangeCount = dseRuntime.diagnostics.routingTargetAssignments.filter((assignment) => (
  assignment.authoredEndpoint !== assignment.resolvedEndpoint
)).length;
const earthBusRouteLengthM = dseRuntime.routes.filter((route) => (
  route.from.startsWith("earthBar.") || route.to.startsWith("earthBar.")
)).reduce((sum, route) => sum + route.lengthM, 0);
const semanticCables = renderedSemanticCables(dseRuntime.devices, dseRuntime.conductors, dseRuntime.routes);
const semanticConductorKeys = new Set(semanticCables.flatMap((cable) => (
  cable.routedCableEndpoint ? [cable.conductorKey, cable.routedCableEndpoint] : [cable.conductorKey]
)));
const cableBreakoutCount = dseRuntime.devices.filter((device) => (
  device.presentation === "cable-breakout" || device.presentation === "integrated-cable-breakout"
)).length;
const integratedCableBreakoutCount = dseRuntime.devices.filter((device) => device.presentation === "integrated-cable-breakout").length;
const wireJoinCount = dseRuntime.devices.filter((device) => device.presentation === "wire-join").length;
const orthogonalWireJoinCount = new Set(semanticCables.filter((cable) => (
  cable.joinGeometry === "orthogonal-t"
)).map((cable) => cable.deviceId)).size;
const serviceSpliceCount = dseRuntime.devices.filter((device) => device.presentation === "service-splice").length;
const rigidRailCount = dseRuntime.devices.filter((device) => device.presentation === "rigid-rail").length;
const suppliedBusbarCoverCount = dseRuntime.devices.filter((device) => (
  device.kind === "busbar" && device.presentation !== "rigid-rail"
)).length;

type UsbOutletKind = "usb-a" | "usb-c";

function usbOutletKind(port: Pick<ResolvedConductor, "terminal" | "terminalSize">): UsbOutletKind | undefined {
  const signature = `${port.terminal ?? ""} ${port.terminalSize ?? ""}`.toLowerCase();
  if (/usb(?:\s+type)?-?c\b/.test(signature)) return "usb-c";
  if (/usb(?:\s+type)?-?a\b/.test(signature)) return "usb-a";
  return undefined;
}

const usbCOutletCount = dseRuntime.conductors.filter((port) => usbOutletKind(port) === "usb-c").length;
const usbAOutletCount = dseRuntime.conductors.filter((port) => usbOutletKind(port) === "usb-a").length;

function junctionBreakerOrder(junctionId: string) {
  return dseRuntime.devices
    .filter((device) => device.kind === "breaker"
      && device.placement.space === "junction"
      && device.placement.junctionId === junctionId)
    .toSorted((first, second) => {
      const firstOrder = first.placement.space === "junction" ? first.placement.order : Number.MAX_SAFE_INTEGER;
      const secondOrder = second.placement.space === "junction" ? second.placement.order : Number.MAX_SAFE_INTEGER;
      return firstOrder - secondOrder || first.position[0] - second.position[0] || first.id.localeCompare(second.id);
    })
    .map((device) => device.id)
    .join(",");
}

const batteryCutoffBreakerOrder = junctionBreakerOrder(BATTERY_CUTOFF_JUNCTION_ID);
const secondaryServicesBreakerOrder = junctionBreakerOrder(SECONDARY_SERVICES_JUNCTION_ID);

const colorByKind: Record<ResolvedDevice["kind"], string> = {
  panel: "#244c86",
  battery: "#44484b",
  breaker: "#f4f2e9",
  busbar: "#a8a39a",
  converter: "#2377a8",
  inverter: "#2377a8",
  monitor: "#2b6688",
  load: "#6e7472",
  switch: "#66706d",
  connector: "#8d918b",
  junction: "#ded8ca",
  protection: "#f4f2e9",
  generator: "#d77932",
  earth: "#6f7d58",
};

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    materials.forEach((material) => material.dispose());
  });
}

function cylinderBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments = 12,
) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 0.0001) return null;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function roundedRectangleShape(width: number, height: number, radius: number) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corner = Math.min(radius, halfWidth, halfHeight);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + corner, -halfHeight);
  shape.lineTo(halfWidth - corner, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + corner);
  shape.lineTo(halfWidth, halfHeight - corner);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - corner, halfHeight);
  shape.lineTo(-halfWidth + corner, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - corner);
  shape.lineTo(-halfWidth, -halfHeight + corner);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + corner, -halfHeight);
  return shape;
}

/** Receptacle geometry is derived from terminal metadata rather than device
 * identity. USB-C receives its symmetric pill opening; USB-A keeps the taller
 * rectangular shell and an offset internal tongue. */
function usbOutletObject(port: ResolvedConductor, kind: UsbOutletKind) {
  const group = new THREE.Group();
  group.name = `${port.key}:${kind}-receptacle`;
  group.userData.conductorKey = port.key;
  group.userData.hoverConductorKey = port.key;
  group.userData.deviceId = port.deviceId;
  group.userData.usbOutletKind = kind;
  const direction = new THREE.Vector3(...port.direction).normalize();
  group.position.copy(new THREE.Vector3(...port.position).addScaledVector(direction, 0.0006));
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

  const dimensions = kind === "usb-c"
    ? { width: 0.0100, height: 0.0042, radius: 0.0021 }
    : { width: 0.0130, height: 0.0060, radius: 0.0007 };
  const shellMaterial = new THREE.MeshStandardMaterial({ color: "#b8bcc0", metalness: 0.72, roughness: 0.28 });
  const apertureMaterial = new THREE.MeshStandardMaterial({ color: "#171a1c", metalness: 0.04, roughness: 0.76 });
  const outer = new THREE.Mesh(
    new THREE.ExtrudeGeometry(
      roundedRectangleShape(dimensions.width, dimensions.height, dimensions.radius),
      { depth: 0.0018, bevelEnabled: false, curveSegments: 10, steps: 1 },
    ),
    shellMaterial,
  );
  outer.name = `${port.key}:${kind}-shell`;
  outer.position.z = -0.0009;
  const innerWidth = dimensions.width - 0.0015;
  const innerHeight = dimensions.height - 0.0015;
  const aperture = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRectangleShape(
      innerWidth,
      innerHeight,
      kind === "usb-c" ? innerHeight / 2 : 0.00035,
    ), 10),
    apertureMaterial,
  );
  aperture.name = `${port.key}:${kind}-aperture`;
  aperture.position.z = 0.0010;
  group.add(outer, aperture);

  if (kind === "usb-a") {
    const tongue = new THREE.Mesh(
      new THREE.BoxGeometry(innerWidth * 0.72, innerHeight * 0.22, 0.0007),
      new THREE.MeshStandardMaterial({ color: "#d7ddd9", metalness: 0.10, roughness: 0.64 }),
    );
    tongue.name = `${port.key}:usb-a-tongue`;
    tongue.position.set(0, -innerHeight * 0.20, 0.0014);
    group.add(tongue);
  }
  return { group, dimensions };
}

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

function tessellatedCableCurve(descriptors: readonly CableCurvePiece[]) {
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

function roundedRouteCurve(points: readonly Vec3[], bendRadius: number) {
  return tessellatedCableCurve(roundedRoutePieces(points, bendRadius));
}

function semanticTubeSegments(curve: THREE.Curve<THREE.Vector3>) {
  return Math.max(12, Math.ceil(curve.getLength() / 0.0025));
}

function addPanelDetails(group: THREE.Group, device: ResolvedDevice, opacity: number) {
  const lineMaterial = new THREE.LineBasicMaterial({ color: "#83add8", transparent: true, opacity: opacity * 0.72 });
  for (let column = 1; column < 8; column += 1) {
    const x = -device.size[0] / 2 + device.size[0] * column / 8;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, -device.size[1] / 2, device.size[2] / 2 + 0.001),
      new THREE.Vector3(x, device.size[1] / 2, device.size[2] / 2 + 0.001),
    ]);
    group.add(new THREE.Line(geometry, lineMaterial));
  }
  for (let row = 1; row < 5; row += 1) {
    const y = -device.size[1] / 2 + device.size[1] * row / 5;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-device.size[0] / 2, y, device.size[2] / 2 + 0.001),
      new THREE.Vector3(device.size[0] / 2, y, device.size[2] / 2 + 0.001),
    ]);
    group.add(new THREE.Line(geometry, lineMaterial));
  }
  const railMaterial = new THREE.MeshStandardMaterial({ color: "#8c9090", metalness: 0.58, roughness: 0.38 });
  [-0.28, 0.28].forEach((fraction) => {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(device.size[0] * 0.93, 0.032, 0.025),
      railMaterial,
    );
    rail.position.set(0, device.size[1] * fraction, -device.size[2] / 2 - 0.020);
    group.add(rail);
  });
}

function addArraySupport(scene: THREE.Scene) {
  const material = new THREE.MeshStandardMaterial({ color: "#777c7a", metalness: 0.56, roughness: 0.42 });
  const addRod = (from: Vec3, to: Vec3, radius = 0.025) => {
    const rod = cylinderBetween(new THREE.Vector3(...from), new THREE.Vector3(...to), radius, material, 12);
    if (rod) {
      rod.castShadow = true;
      scene.add(rod);
    }
  };
  // Same two-rail, three-bay rack geometry as the original array view, shifted
  // with the canonical panel coordinates. It is environmental structure, not
  // an electrical device, so it intentionally has no inspector/diagram node.
  [-2.28, 0, 2.28].forEach((z) => {
    addRod([-2.67, 0.19, z], [-0.43, 0.92, z], 0.027);
    addRod([-2.67, 0.03, z], [-2.67, 0.19, z]);
    addRod([-0.43, 0.03, z], [-0.43, 0.92, z]);
  });
  addRod([-2.67, 0.05, -2.28], [-2.67, 0.05, 2.28]);
  addRod([-0.43, 0.05, -2.28], [-0.43, 0.05, 2.28]);
}

function deviceBody(device: ResolvedDevice) {
  const group = new THREE.Group();
  group.name = `device:${device.id}`;
  group.userData.deviceId = device.id;
  const opacity = 0.97;
  const baseColor = device.color ?? colorByKind[device.kind];

  if (device.presentation === "cable-breakout" || device.presentation === "wire-join" || device.presentation === "service-splice") {
    // Breakouts and wire joins remain selectable graph devices but have no
    // fabricated box; semantic Y geometry is added from conductor metadata.
  } else if (device.presentation === "wall-passthrough") {
    const material = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.72 });
    const boxDepth = device.size[2] * 0.55;
    const geometry = new THREE.BoxGeometry(device.size[0], device.size[1], boxDepth);
    const insideBox = new THREE.Mesh(geometry, material);
    insideBox.position.z = boxDepth / 2 + 0.002;
    const outsideBox = new THREE.Mesh(geometry, material);
    outsideBox.position.z = -0.075;
    group.add(insideBox, outsideBox);
  } else if (device.kind === "junction") {
    // Keep the router's lattice-aligned collision envelope independent from a
    // received shell whose external millimetre dimensions fall between grid
    // cells. The open-front model must show the purchased enclosure itself.
    const [width, height, depth] = device.physicalSize ?? device.size;
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 0.012),
      new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.82, transparent: true, opacity: opacity * 0.58 }),
    );
    back.position.z = -depth / 2 + 0.006;
    group.add(back);
    const borderMaterial = new THREE.MeshStandardMaterial({ color: "#8c877d", roughness: 0.68, transparent: true, opacity });
    const border = 0.012;
    const horizontal = new THREE.BoxGeometry(width + border, border, depth);
    const vertical = new THREE.BoxGeometry(border, height, depth);
    const top = new THREE.Mesh(horizontal, borderMaterial);
    const bottom = new THREE.Mesh(horizontal, borderMaterial);
    const left = new THREE.Mesh(vertical, borderMaterial);
    const right = new THREE.Mesh(vertical, borderMaterial);
    top.position.y = height / 2;
    bottom.position.y = -height / 2;
    left.position.x = -width / 2;
    right.position.x = width / 2;
    group.add(top, bottom, left, right);
  } else if (device.presentation === "rigid-rail") {
    // A two-polarity comb assembly is one selectable purchased device, but it
    // is never one conductive bar. Render the polarity rails on separate
    // insulated tracks and depths so the geometry does not imply a +/− bridge.
    group.name = `rigid-rail:${device.id}`;
    group.userData.presentation = "rigid-rail";
    const localQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...device.rotation)).invert();
    const localTerminal = (conductorId: string) => {
      const resolved = device.resolvedConductorPositions?.[conductorId];
      if (!resolved) return null;
      return new THREE.Vector3(...resolved)
        .sub(new THREE.Vector3(...device.position))
        .applyQuaternion(localQuaternion);
    };
    const insulatorMaterial = new THREE.MeshStandardMaterial({
      color: "#313b40",
      roughness: 0.72,
      metalness: 0.04,
    });
    const materialByKind = {
      positive: new THREE.MeshStandardMaterial({ color: conductorColor.positive, roughness: 0.34, metalness: 0.52 }),
      negative: new THREE.MeshStandardMaterial({ color: conductorColor.negative, roughness: 0.34, metalness: 0.52 }),
    } as const;
    (["positive", "negative"] as const).forEach((kind) => {
      const terminals = device.conductors
        .filter((port) => port.kind === kind)
        .map((port) => localTerminal(port.id))
        .filter((point): point is THREE.Vector3 => point !== null);
      if (terminals.length === 0) return;
      const railY = kind === "positive" ? device.size[1] * 0.18 : -device.size[1] * 0.18;
      const railZ = kind === "positive" ? device.size[2] * 0.14 : -device.size[2] * 0.14;
      const railStart = new THREE.Vector3(Math.min(...terminals.map((point) => point.x)) - 0.008, railY, railZ);
      const railEnd = new THREE.Vector3(Math.max(...terminals.map((point) => point.x)) + 0.008, railY, railZ);
      const insulatedRail = cylinderBetween(railStart, railEnd, 0.0052, insulatorMaterial, 8);
      const conductiveRail = cylinderBetween(railStart, railEnd, 0.0031, materialByKind[kind], 8);
      if (insulatedRail) {
        insulatedRail.name = `${device.id}:${kind}-rail-insulation`;
        group.add(insulatedRail);
      }
      if (conductiveRail) {
        conductiveRail.name = `${device.id}:${kind}-rail`;
        conductiveRail.userData.railKind = kind;
        group.add(conductiveRail);
      }
      terminals.forEach((terminal, index) => {
        const toothEnd = new THREE.Vector3(terminal.x, railY, railZ);
        const insulatedTooth = cylinderBetween(terminal, toothEnd, 0.0045, insulatorMaterial, 8);
        const conductiveTooth = cylinderBetween(terminal, toothEnd, 0.0025, materialByKind[kind], 8);
        if (insulatedTooth) {
          insulatedTooth.name = `${device.id}:${kind}-tooth-${index + 1}-insulation`;
          group.add(insulatedTooth);
        }
        if (conductiveTooth) {
          conductiveTooth.name = `${device.id}:${kind}-tooth-${index + 1}`;
          conductiveTooth.userData.railKind = kind;
          group.add(conductiveTooth);
        }
      });
    });
  } else if (device.kind === "busbar") {
    // The selected main and secondary distribution bars include their own
    // insulating covers. Keep the conductive bar visible through a lightly
    // translucent shell so the model does not imply exposed copper; monitors
    // such as the standalone SmartShunt intentionally use the ordinary device
    // renderer and remain uncovered.
    const conductiveBar = new THREE.Mesh(
      new THREE.BoxGeometry(device.size[0] * 0.90, device.size[1] * 0.46, device.size[2] * 0.44),
      new THREE.MeshStandardMaterial({
        color: "#b88745",
        roughness: 0.24,
        metalness: 0.76,
      }),
    );
    conductiveBar.position.z = -device.size[2] * 0.12;
    conductiveBar.userData.deviceId = device.id;
    group.add(conductiveBar);

    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(...device.size),
      new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.54,
        metalness: 0.02,
        transparent: true,
        opacity: 0.72,
      }),
    );
    cover.name = `${device.id}:supplied-insulating-cover`;
    cover.userData.deviceId = device.id;
    cover.castShadow = true;
    group.add(cover);
  } else if (device.componentId === "earthBus") {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(...device.size),
      new THREE.MeshStandardMaterial({ color: "#b88745", metalness: 0.72, roughness: 0.26, transparent: true, opacity }),
    );
    bar.userData.deviceId = device.id;
    group.add(bar);
    const screwMaterial = new THREE.MeshStandardMaterial({ color: "#d6d2c7", metalness: 0.82, roughness: 0.22, transparent: true, opacity });
    for (let index = 0; index < device.conductors.length; index += 1) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0033, 0.0033, 0.004, 8), screwMaterial);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(
        -device.size[0] / 2 + device.size[0] * ((index + 0.5) / device.conductors.length),
        0,
        device.size[2] / 2 + 0.002,
      );
      group.add(screw);
    }
  } else if (device.kind === "earth") {
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(device.size[0] / 2, device.size[0] / 2, device.size[1], 14),
      new THREE.MeshStandardMaterial({ color: "#8c6a3e", metalness: 0.46, roughness: 0.54, transparent: opacity < 1, opacity }),
    );
    rod.userData.deviceId = device.id;
    group.add(rod);
  } else {
    const material = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.62,
      metalness: 0.05,
      transparent: opacity < 1,
      opacity,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(...device.size), material);
    body.userData.deviceId = device.id;
    body.castShadow = true;
    group.add(body);

    if (device.kind === "breaker" || device.kind === "protection") {
      const poleCount = device.poles ?? Math.max(1, Math.round(device.size[0] / 0.020));
      for (let pole = 0; pole < poleCount; pole += 1) {
        const toggle = new THREE.Mesh(
          new THREE.BoxGeometry(0.015, 0.024, 0.010),
          new THREE.MeshStandardMaterial({ color: "#343638", roughness: 0.48, transparent: opacity < 1, opacity }),
        );
        toggle.position.set(-device.size[0] / 2 + (pole + 0.5) * (device.size[0] / poleCount), 0.006, device.size[2] / 2 + 0.005);
        toggle.rotation.x = -0.18;
        group.add(toggle);
      }
    }

    if (device.kind === "panel") addPanelDetails(group, device, opacity);

    if (device.kind === "generator") {
      const face = new THREE.Mesh(
        new THREE.BoxGeometry(device.size[0] * 0.72, device.size[1] * 0.42, 0.012),
        new THREE.MeshStandardMaterial({ color: "#3f4443", roughness: 0.66 }),
      );
      face.position.z = device.size[2] / 2 + 0.007;
      group.add(face);
    }

    if (device.id === "switchPanel") {
      const faceplate = new THREE.Mesh(
        new THREE.BoxGeometry(device.size[0] * 0.94, device.size[1] * 0.82, 0.006),
        new THREE.MeshStandardMaterial({ color: "#3e4545", roughness: 0.58, metalness: 0.04 }),
      );
      faceplate.position.z = device.size[2] / 2 + 0.004;
      group.add(faceplate);
      const gangPitch = device.size[0] * 0.145;
      for (let gang = 0; gang < 6; gang += 1) {
        const rocker = new THREE.Mesh(
          new THREE.BoxGeometry(gangPitch * 0.68, device.size[1] * 0.56, 0.009),
          new THREE.MeshStandardMaterial({ color: "#171a1b", roughness: 0.46 }),
        );
        rocker.position.set(
          (gang - 2.5) * gangPitch,
          0,
          device.size[2] / 2 + 0.011,
        );
        rocker.rotation.x = -0.08;
        group.add(rocker);
      }
    }

    if (device.id === "toolOutlet") {
      const slotMaterial = new THREE.MeshBasicMaterial({ color: "#252728" });
      const slotGeometry = new THREE.BoxGeometry(0.007, 0.022, 0.004);
      const active = new THREE.Mesh(slotGeometry, slotMaterial);
      active.position.set(-0.013, 0.006, device.size[2] / 2 + 0.003);
      active.rotation.z = -0.48;
      const neutral = new THREE.Mesh(slotGeometry, slotMaterial);
      neutral.position.set(0.013, 0.006, device.size[2] / 2 + 0.003);
      neutral.rotation.z = 0.48;
      const earth = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.020, 0.004), slotMaterial);
      earth.position.set(0, -0.018, device.size[2] / 2 + 0.003);
      group.add(active, neutral, earth);
    }

    if (device.id === "indoorLight" || device.id === "outdoorLight") {
      const lens = new THREE.Mesh(
        new THREE.BoxGeometry(device.size[0] * 0.78, device.size[1] * 0.72, 0.006),
        new THREE.MeshStandardMaterial({ color: "#fff0bd", emissive: "#ffc45c", emissiveIntensity: 0.34, roughness: 0.35 }),
      );
      lens.position.z = device.size[2] / 2 + 0.004;
      group.add(lens);
    }
  }

  group.position.set(...device.position);
  group.rotation.set(...device.rotation);
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return group;
}

export function UnifiedSystemModel3D({ fadePurchased, onFadePurchasedChange, onSelect, onClearSelection }: Props) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<GrabPointCameraControls | null>(null);
  const fadePurchasedRef = useRef(fadePurchased);
  const onSelectRef = useRef(onSelect);
  const onClearSelectionRef = useRef(onClearSelection);
  const applyFadeRef = useRef<((fade: boolean) => void) | null>(null);
  const [preset, setPreset] = useState<CameraPreset>("whole");

  useEffect(() => {
    const host = canvasHostRef.current;
    const tooltip = tooltipRef.current;
    if (!host || !tooltip) return;
    tooltip.style.removeProperty("left");
    tooltip.style.removeProperty("top");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#efe8d8");
    scene.fog = new THREE.Fog("#efe8d8", 17, 34);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.01, 80);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#fffdf4", "#b9aa91", 2.35));
    const keyLight = new THREE.DirectionalLight("#fff7e8", 2.65);
    keyLight.position.set(4, 7, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.camera.left = -7;
    keyLight.shadow.camera.right = 7;
    keyLight.shadow.camera.top = 7;
    keyLight.shadow.camera.bottom = -7;
    keyLight.shadow.bias = -0.00025;
    keyLight.shadow.normalBias = 0.012;
    keyLight.shadow.camera.layers.set(WALL_SHADOW_CASTER_LAYER);
    scene.add(keyLight);
    const deviceShadowLight = new THREE.DirectionalLight("#fff7e8", 0.70);
    deviceShadowLight.position.copy(keyLight.position);
    deviceShadowLight.castShadow = true;
    deviceShadowLight.layers.set(WALL_DEVICE_SHADOW_RECEIVER_LAYER);
    deviceShadowLight.shadow.mapSize.set(1024, 1024);
    deviceShadowLight.shadow.camera.near = 0.1;
    deviceShadowLight.shadow.camera.far = 20;
    deviceShadowLight.shadow.camera.left = -7;
    deviceShadowLight.shadow.camera.right = 7;
    deviceShadowLight.shadow.camera.top = 7;
    deviceShadowLight.shadow.camera.bottom = -7;
    deviceShadowLight.shadow.bias = -0.00025;
    deviceShadowLight.shadow.normalBias = 0.012;
    deviceShadowLight.shadow.camera.layers.set(DEVICE_SHADOW_CASTER_LAYER);
    scene.add(deviceShadowLight);
    const fillLight = new THREE.DirectionalLight("#d8e9ed", 0.72);
    fillLight.position.set(-4, 3, -5);
    scene.add(fillLight);

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(...EQUIPMENT_WALL_VOLUME.size),
      new THREE.MeshStandardMaterial({ color: "#d8cfbd", roughness: 0.94 }),
    );
    wall.position.set(...EQUIPMENT_WALL_VOLUME.center);
    wall.layers.enable(WALL_SHADOW_CASTER_LAYER);
    wall.layers.enable(WALL_DEVICE_SHADOW_RECEIVER_LAYER);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.cameraSurface = true;
    scene.add(wall);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(12.5, 0.035, 5.5),
      new THREE.MeshStandardMaterial({ color: "#e3d7c1", roughness: 0.97 }),
    );
    floor.position.set(0.5, -0.025, 0.15);
    floor.receiveShadow = true;
    floor.userData.cameraSurface = true;
    scene.add(floor);
    addArraySupport(scene);

    const interactive: THREE.Object3D[] = [];
    const deviceObjects = new Map<string, THREE.Object3D>();
    const conductorObjects = new Map<string, THREE.Object3D>();
    const purchasedMaterials: Array<{
      material: THREE.Material;
      opacity: number;
      transparent: boolean;
      depthWrite: boolean;
    }> = [];
    dseRuntime.devices.forEach((device) => {
      const object = deviceBody(device);
      object.traverse((child) => {
        child.userData.deviceId ??= device.id;
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.layers.enable(DEVICE_SHADOW_CASTER_LAYER);
          interactive.push(child);
          if (isPurchasedDevice(device)) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => purchasedMaterials.push({
              material,
              opacity: material.opacity,
              transparent: material.transparent,
              depthWrite: material.depthWrite,
            }));
          }
        }
      });
      deviceObjects.set(device.id, object);
      scene.add(object);
    });

    dseRuntime.glands.forEach((gland) => {
      const diameterMm = Math.max(...gland.connectionIds.map((id) => dseRuntime.routeById.get(id)?.diameterMm ?? 6));
      const radius = Math.max(0.007, diameterMm / 1800);
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, 0.018, 14),
        new THREE.MeshStandardMaterial({ color: "#454846", roughness: 0.52, metalness: 0.30 }),
      );
      ring.position.set(...gland.position);
      ring.layers.enable(DEVICE_SHADOW_CASTER_LAYER);
      ring.castShadow = true;
      scene.add(ring);
    });

    const cableById = new Map(dseRuntime.graph.cables.map((cable) => [cable.id, cable]));
    let renderedTubeSegments = 0;
    let renderedBends = 0;
    dseRuntime.routes.forEach((route) => {
      const cable = cableById.get(route.cableId)!;
      const sheathColor = cable.sheath === "white" ? "#f8f6ef" : conductorColor[route.kind];
      const radius = Math.max(0.0012, route.diameterMm / 2000);
      const curve = roundedRouteCurve(
        renderedRoutePoints(route, semanticCables),
        Math.max(0.009, radius * 4.25),
      );
      if (curve.tubularSegments === 0) return;
      renderedTubeSegments += curve.tubularSegments;
      renderedBends += curve.bendCount;
      const geometry = new THREE.TubeGeometry(curve, curve.tubularSegments, radius, 8, false);
      const material = new THREE.MeshStandardMaterial({ color: sheathColor, roughness: 0.58 });
      const wire = new THREE.Mesh(geometry, material);
      wire.userData.conductorKey = route.from;
      wire.userData.connectionId = route.id;
      wire.userData.radialSegments = 8;
      wire.userData.constantRadiusM = radius;
      wire.userData.tubularSegments = curve.tubularSegments;
      wire.userData.minimumBendSegments = MIN_ROUTE_BEND_SEGMENTS;
      wire.layers.enable(DEVICE_SHADOW_CASTER_LAYER);
      wire.castShadow = true;
      wire.receiveShadow = true;
      interactive.push(wire);
      scene.add(wire);

      const hit = new THREE.Mesh(
        new THREE.TubeGeometry(curve, curve.tubularSegments, Math.max(0.006, radius * 1.7), 5, false),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hit.userData.conductorKey = route.from;
      hit.userData.connectionId = route.id;
      interactive.push(hit);
      scene.add(hit);
    });
    renderer.domElement.dataset.wireTubeSegments = String(renderedTubeSegments);
    renderer.domElement.dataset.wireRenderedBends = String(renderedBends);

    const conductorOpacity = (port: ResolvedConductor) => connectedConductorKeys.has(port.key) ? 1 : 0.5;
    const conductorMaterial = (port: ResolvedConductor, color = conductorColor[port.kind], roughness = 0.42) => {
      const opacity = conductorOpacity(port);
      return new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness: roughness < 0.5 ? 0.22 : 0.04,
        transparent: opacity < 1,
        opacity,
      });
    };
    const addSelectableTube = (
      group: THREE.Group,
      curve: THREE.Curve<THREE.Vector3>,
      port: ResolvedConductor,
      radius: number,
      color = conductorColor[port.kind],
      branchAngleDegrees?: number,
    ) => {
      const segments = semanticTubeSegments(curve);
      const visible = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments, radius, 8, false),
        conductorMaterial(port, color, 0.58),
      );
      visible.userData.conductorKey = port.key;
      visible.userData.hoverConductorKey = port.key;
      visible.userData.deviceId = port.deviceId;
      visible.userData.branchAngleDegrees = branchAngleDegrees;
      visible.userData.radialSegments = 8;
      visible.layers.enable(DEVICE_SHADOW_CASTER_LAYER);
      visible.castShadow = true;
      interactive.push(visible);
      conductorObjects.set(port.key, visible);
      group.add(visible);

      const hit = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments, Math.max(0.006, radius * 1.65), 5, false),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hit.userData.conductorKey = port.key;
      hit.userData.hoverConductorKey = port.key;
      hit.userData.deviceId = port.deviceId;
      hit.userData.branchAngleDegrees = branchAngleDegrees;
      interactive.push(hit);
      group.add(hit);
    };

    dseRuntime.conductors.forEach((port) => {
      if (semanticConductorKeys.has(port.key)) return;
      const outletKind = usbOutletKind(port);
      if (outletKind) {
        const { group, dimensions } = usbOutletObject(port, outletKind);
        group.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.userData.conductorKey = port.key;
          mesh.userData.hoverConductorKey = port.key;
          mesh.userData.deviceId = port.deviceId;
          mesh.userData.usbOutletKind = outletKind;
          mesh.layers.enable(DEVICE_SHADOW_CASTER_LAYER);
          mesh.castShadow = true;
          interactive.push(mesh);
        });
        const hit = new THREE.Mesh(
          new THREE.BoxGeometry(dimensions.width + 0.005, dimensions.height + 0.005, 0.008),
          new THREE.MeshBasicMaterial({ visible: false }),
        );
        hit.position.z = 0.002;
        hit.userData.conductorKey = port.key;
        hit.userData.hoverConductorKey = port.key;
        hit.userData.deviceId = port.deviceId;
        hit.userData.usbOutletKind = outletKind;
        interactive.push(hit);
        group.add(hit);
        conductorObjects.set(port.key, group);
        scene.add(group);
        return;
      }
      const length = Math.max(0.010, (port.terminalLengthMm ?? 10) / 1000);
      const radius = Math.max(0.0025, (port.terminalDiameterMm ?? 5) / 2000);
      const start = new THREE.Vector3(...port.position);
      const direction = new THREE.Vector3(...port.direction).normalize();
      const end = start.clone().addScaledVector(direction, length);
      const visible = cylinderBetween(
        start,
        end,
        radius,
        conductorMaterial(port),
        14,
      );
      if (!visible) return;
      visible.userData.conductorKey = port.key;
      visible.userData.hoverConductorKey = port.key;
      visible.userData.deviceId = port.deviceId;
      visible.layers.enable(DEVICE_SHADOW_CASTER_LAYER);
      visible.castShadow = true;
      interactive.push(visible);
      conductorObjects.set(port.key, visible);
      scene.add(visible);

      const hit = cylinderBetween(
        start,
        start.clone().addScaledVector(direction, Math.max(length, 0.024)),
        Math.max(0.008, radius * 1.55),
        new THREE.MeshBasicMaterial({ visible: false }),
        8,
      );
      if (hit) {
        hit.userData.conductorKey = port.key;
        hit.userData.hoverConductorKey = port.key;
        hit.userData.deviceId = port.deviceId;
        interactive.push(hit);
        scene.add(hit);
      }
    });

    const semanticGroups = new Map<string, THREE.Group>();
    semanticCables.forEach((semantic) => {
      const owner = dseRuntime.deviceById.get(semantic.deviceId)!;
      const port = dseRuntime.conductorByKey.get(semantic.conductorKey)!;
      const group = semanticGroups.get(owner.id) ?? (() => {
        const created = new THREE.Group();
        created.name = owner.presentation === "wire-join"
          ? `wire-join:${owner.id}`
          : owner.presentation === "service-splice" ? `service-splice:${owner.id}` : `breakout:${owner.id}`;
        semanticGroups.set(owner.id, created);
        return created;
      })();
      addSelectableTube(
        group,
        tessellatedCableCurve(semantic.pieces),
        port,
        semantic.radiusM,
        semantic.color === "white" ? "#f8f6ef" : conductorColor[semantic.color],
        semantic.branchAngleDegrees,
      );
    });
    semanticGroups.forEach((group, deviceId) => {
      scene.add(group);
      if (dseRuntime.deviceById.get(deviceId)?.presentation !== "integrated-cable-breakout") {
        deviceObjects.set(deviceId, group);
      }
    });

    renderer.domElement.dataset.unusedConductorOpacity = "0.5";
    renderer.domElement.dataset.hoverHighlight = HOVER_HIGHLIGHT;
    renderer.domElement.dataset.unusedConductorCount = String(unusedConductorCount);
    renderer.domElement.dataset.cableBreakoutCount = String(cableBreakoutCount);
    renderer.domElement.dataset.wireJoinCount = String(wireJoinCount);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const intersections = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(interactive, false);
    };
    const pick = (clientX: number, clientY: number) => intersections(clientX, clientY)[0];

    let hoveredTargetKey: string | undefined;
    let hoverHelper: THREE.Box3Helper | undefined;
    const controlsSlot: { current?: GrabPointCameraControls } = {};
    const renderScene = () => {
      controlsSlot.current?.writeDiagnostics(renderer.domElement);
      renderer.render(scene, camera);
    };
    const applyPurchasedFade = (fade: boolean, requestRender = true) => {
      purchasedMaterials.forEach(({ material, opacity, transparent, depthWrite }) => {
        material.opacity = opacity * (fade ? 0.23 : 1);
        material.transparent = fade || transparent;
        material.depthWrite = fade ? false : depthWrite;
        material.needsUpdate = true;
      });
      renderer.domElement.dataset.fadePurchased = String(fade);
      if (requestRender) renderScene();
    };
    applyFadeRef.current = applyPurchasedFade;
    applyPurchasedFade(fadePurchasedRef.current, false);

    const setHoveredTarget = (target?: { type: "device"; id: string } | { type: "conductor"; key: string }) => {
      const targetKey = target ? `${target.type}:${target.type === "device" ? target.id : target.key}` : undefined;
      if (targetKey === hoveredTargetKey) return;
      if (hoverHelper) {
        scene.remove(hoverHelper);
        hoverHelper.geometry.dispose();
        (Array.isArray(hoverHelper.material) ? hoverHelper.material : [hoverHelper.material])
          .forEach((material) => material.dispose());
        hoverHelper = undefined;
      }
      hoveredTargetKey = targetKey;
      const conductor = target?.type === "conductor" ? dseRuntime.conductorByKey.get(target.key) : undefined;
      const deviceId = target?.type === "device" ? target.id : conductor?.deviceId;
      renderer.domElement.dataset.hoveredDevice = deviceId ?? "";
      renderer.domElement.dataset.hoveredConductor = conductor?.key ?? "";
      renderer.domElement.dataset.hoverTarget = targetKey ?? "";
      renderer.domElement.dataset.hoverBounds = target ? "visible" : "hidden";
      renderer.domElement.dataset.hoverBoundsKind = target?.type ?? "";
      if (!target) {
        tooltip.hidden = true;
        tooltip.textContent = "";
        return;
      }
      const object = target.type === "device" ? deviceObjects.get(target.id) : conductorObjects.get(target.key);
      const device = deviceId ? dseRuntime.deviceById.get(deviceId) : undefined;
      if (!object || !device) return;
      const bounds = new THREE.Box3().setFromObject(object);
      if (conductor) {
        const size = bounds.getSize(new THREE.Vector3());
        bounds.expandByScalar(Math.max(0.004, Math.max(size.x, size.y, size.z) * 0.25));
      }
      hoverHelper = new THREE.Box3Helper(bounds, HOVER_HIGHLIGHT);
      (Array.isArray(hoverHelper.material) ? hoverHelper.material : [hoverHelper.material])
        .forEach((material) => { material.depthTest = false; });
      hoverHelper.renderOrder = 80;
      scene.add(hoverHelper);
      tooltip.textContent = conductor ? `${device.label} · ${conductor.label}` : device.label;
      tooltip.hidden = false;
      renderScene();
    };

    const controls = new GrabPointCameraControls({
      camera,
      domElement: renderer.domElement,
      onChange: renderScene,
      pickSurface: (clientX, clientY) => {
        const hit = pick(clientX, clientY);
        return hit ? { point: hit.point } : null;
      },
    });
    controlsSlot.current = controls;
    controlsRef.current = controls;
    const pose = presetPose.whole;
    controls.setPose(new THREE.Vector3(...pose.position), new THREE.Vector3(...pose.target));
    controls.writeDiagnostics(renderer.domElement);

    let pointerDown = { x: 0, y: 0, button: 0 };
    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointerDown.button !== 0 || event.button !== 0) return;
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
      const hit = pick(event.clientX, event.clientY);
      if (!hit) {
        onClearSelectionRef.current();
        return;
      }
      const conductorKey = hit.object.userData.conductorKey as string | undefined;
      const connectionId = hit.object.userData.connectionId as string | undefined;
      const deviceId = hit.object.userData.deviceId as string | undefined;
      if (conductorKey) onSelectRef.current({ type: "conductor", conductorKey, connectionId });
      else if (deviceId) onSelectRef.current({ type: "device", deviceId });
    };
    const onMove = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      const hits = intersections(event.clientX, event.clientY);
      const conductorKey = hits.map((hit) => hit.object.userData.hoverConductorKey as string | undefined).find(Boolean);
      const deviceId = hits.map((hit) => hit.object.userData.deviceId as string | undefined).find(Boolean);
      setHoveredTarget(conductorKey
        ? { type: "conductor", key: conductorKey }
        : deviceId ? { type: "device", id: deviceId } : undefined);
      renderer.domElement.style.cursor = hits[0] ? "pointer" : "grab";
    };
    const onLeave = () => {
      setHoveredTarget(undefined);
      renderer.domElement.style.cursor = "grab";
      renderScene();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderScene();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    return () => {
      observer.disconnect();
      controls.dispose();
      controlsRef.current = null;
      if (applyFadeRef.current === applyPurchasedFade) applyFadeRef.current = null;
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    fadePurchasedRef.current = fadePurchased;
    applyFadeRef.current?.(fadePurchased);
  }, [fadePurchased]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onClearSelectionRef.current = onClearSelection;
  }, [onClearSelection]);

  const choosePreset = (next: CameraPreset) => {
    setPreset(next);
    const controls = controlsRef.current;
    if (!controls) return;
    const pose = presetPose[next];
    controls.setPose(new THREE.Vector3(...pose.position), new THREE.Vector3(...pose.target));
  };

  return (
    <section
      className="unified-model"
      data-model="canonical-graph"
      data-route-fallbacks={dseRuntime.diagnostics.fallbacks}
      data-route-centerline-conflicts={dseRuntime.diagnostics.centerlineConflicts}
      data-route-swept-conflicts={dseRuntime.diagnostics.sweptCableConflicts}
      data-route-device-conflicts={dseRuntime.diagnostics.deviceConflicts}
      data-route-total-length-m={dseRuntime.diagnostics.totalLengthM.toFixed(2)}
      data-route-turns={dseRuntime.diagnostics.totalTurns}
      data-routing-target-assignments={dseRuntime.diagnostics.routingTargetAssignments.length}
      data-routing-target-changes={routingTargetChangeCount}
      data-earth-bus-route-length-m={earthBusRouteLengthM.toFixed(2)}
      data-route-solve-ms={dseRuntime.diagnostics.buildMs.toFixed(1)}
      data-runtime-source={dseRuntime.diagnostics.source}
      data-runtime-hydrate-ms={dseRuntime.diagnostics.hydrateMs.toFixed(3)}
      data-runtime-artifact-bytes={dseRuntime.diagnostics.artifactBytes}
      data-wire-profile="constant-radius-octagon"
      data-wire-radial-segments="8"
      data-wire-tessellation="piece-weighted-minimum-eight-segments-per-bend"
      data-wire-min-bend-segments={MIN_ROUTE_BEND_SEGMENTS}
      data-wire-terminal-tangent-errors={terminalTangentErrors}
      data-unused-terminal-opacity="0.5"
      data-unused-terminal-count={unusedConductorCount}
      data-pe-bus-rendering="rectangular-busbar"
      data-breakout-rendering="true-y-two-way-plus-minus-45-three-way-red-45-black-0-green-minus-45"
      data-cable-breakout-count={cableBreakoutCount}
      data-integrated-cable-breakout-count={integratedCableBreakoutCount}
      data-integrated-breakout-rendering="external-fusion-trimmed-tangent-continuous-20mm-core-fan"
      data-usb-outlet-rendering="metadata-driven-usb-c-pill-usb-a-rectangle"
      data-usb-c-outlet-count={usbCOutletCount}
      data-usb-a-outlet-count={usbAOutletCount}
      data-conductor-usage="field-routes-plus-reciprocal-internal-mates"
      data-wire-join-rendering="presentation-driven-selectable-y-or-straight-orthogonal-t"
      data-wire-join-count={wireJoinCount}
      data-orthogonal-wire-join-count={orthogonalWireJoinCount}
      data-orthogonal-wire-join-bends="0"
      data-service-splice-count={serviceSpliceCount}
      data-rigid-rail-rendering="insulated-separated-dual-polarity"
      data-rigid-rail-count={rigidRailCount}
      data-supplied-busbar-cover-count={suppliedBusbarCoverCount}
      data-smart-shunt-rendering="uncovered-monitor-body"
      data-wall-shadow="casts-and-receives"
      data-device-shadow-floor="excluded-by-light-layer"
      data-wall-penetrations="1"
      data-battery-cutoff-breaker-order={batteryCutoffBreakerOrder}
      data-secondary-services-breaker-order={secondaryServicesBreakerOrder}
      data-current-safety-status={dseRuntime.diagnostics.currentSafety.status}
      data-current-safety-errors={dseRuntime.diagnostics.currentSafety.errors.length}
      data-current-safety-warnings={dseRuntime.diagnostics.currentSafety.warnings.length}
    >
      <div className="model-toolbar" aria-label="3D model controls">
        <div className="model-preset-buttons">
          {cameraPresets.map(({ key, label }) => (
            <button key={key} type="button" className={preset === key ? "active" : ""} onClick={() => choosePreset(key)}>
              {label}
            </button>
          ))}
        </div>
        <label className="fade-toggle">
          <input type="checkbox" checked={fadePurchased} onChange={(event) => onFadePurchasedChange(event.target.checked)} />
          Fade purchased
        </label>
        <CurrentSafetySummary />
        <span className="route-runtime">
          {dseRuntime.devices.length} devices · {dseRuntime.routes.length} cables · precomputed · {dseRuntime.diagnostics.hydrateMs.toFixed(2)} ms hydrate
        </span>
      </div>
      <div className="unified-model-stage">
        <div className="unified-model-canvas" ref={canvasHostRef} />
        <div ref={tooltipRef} className="model-hover-tooltip" role="tooltip" hidden />
      </div>
    </section>
  );
}
