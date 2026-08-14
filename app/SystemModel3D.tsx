"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import modelRaw from "@/data/dse-model.json";
import { GrabPointCameraControls } from "@/app/GrabPointCameraControls";
import { physicalLayout } from "@/app/physicalLayoutSolver";
import {
  buildRoundedCableGeometry,
  CableRoutingSystem,
  PlanarCableLanePlanner,
  type CablePassage,
  type CableRoutingReport,
  type CableVisibility,
  type VectorTuple,
} from "@/app/cableRouting";

type CameraPresetId = "site" | "array" | "wall" | "batteries" | "junction";

type ModelLabel = {
  id: string;
  componentId?: string;
  label: string;
  detail: string;
  position: VectorTuple;
  offset?: [number, number];
  key?: boolean;
  zone?: boolean;
  views?: CameraPresetId[];
};

type CameraPreset = {
  id: CameraPresetId;
  label: string;
  position: VectorTuple;
  target: VectorTuple;
};

type SceneBuild = {
  labelPositions: Map<string, THREE.Vector3>;
  pickables: THREE.Object3D[];
  routingReport: CableRoutingReport;
};

type PhysicalModelSystem = {
  id: "dse" | "pg";
  name: string;
};

const model = modelRaw;
const CABLE_ROUTERS = new WeakMap<THREE.Object3D, CableRoutingSystem>();
const WALL_LANE_PLANNERS = new WeakMap<THREE.Scene, PlanarCableLanePlanner>();

const FIJI_PANEL_TILT_DEG = 18;
const WALL_CABLE_Z = -2.086;
const STARLINK_CEILING_Y = 2.94;
const LIGHTING_TRUNK_Y = 2.86;
const JUNCTION_CENTER = physicalLayout.devices.junction.position as VectorTuple;
const JUNCTION_WIRE_Z = JUNCTION_CENTER[2] + 0.105;
const JUNCTION_FRONT_INTERNAL_Z = JUNCTION_CENTER[2] + 0.143;
const JUNCTION_GLAND_Z = JUNCTION_CENTER[2];
const JUNCTION_FRONT_CABLE_Z = JUNCTION_CENTER[2] + physicalLayout.devices.junction.size[2] / 2 + 0.018;
const JUNCTION_TOP_Y = JUNCTION_CENTER[1] + physicalLayout.devices.junction.size[1] / 2;
const JUNCTION_BOTTOM_Y = JUNCTION_CENTER[1] - physicalLayout.devices.junction.size[1] / 2;
const JUNCTION_RIGHT_X = JUNCTION_CENTER[0] + physicalLayout.devices.junction.size[0] / 2;
const JUNCTION_LEFT_X = JUNCTION_CENTER[0] - physicalLayout.devices.junction.size[0] / 2;

type JunctionPenetration = {
  axis: "x" | "y";
  glandCenter: VectorTuple;
  glandRadius: number;
  outside: VectorTuple;
  terminal: VectorTuple;
  through: VectorTuple[];
};

function rightJunctionPenetration(y: number, glandRadius: number): JunctionPenetration {
  const terminal: VectorTuple = [3.598, y, JUNCTION_WIRE_Z];
  const outside: VectorTuple = [3.642, y, JUNCTION_GLAND_Z];
  return {
    axis: "x",
    glandCenter: [3.6175, y, JUNCTION_GLAND_Z],
    glandRadius,
    outside,
    terminal,
    through: [terminal, [3.598, y, JUNCTION_GLAND_Z], outside],
  };
}

function bottomJunctionPenetration(x: number, glandRadius: number): JunctionPenetration {
  const terminal: VectorTuple = [x, 1.584, JUNCTION_WIRE_Z];
  const outside: VectorTuple = [x, 1.542, JUNCTION_GLAND_Z];
  return {
    axis: "y",
    glandCenter: [x, 1.564, JUNCTION_GLAND_Z],
    glandRadius,
    outside,
    terminal,
    through: [terminal, [x, 1.584, JUNCTION_GLAND_Z], outside],
  };
}

function topJunctionPenetration(x: number, glandRadius: number): JunctionPenetration {
  const terminal: VectorTuple = [x, JUNCTION_TOP_Y - 0.028, JUNCTION_WIRE_Z];
  const outside: VectorTuple = [x, JUNCTION_TOP_Y + 0.032, JUNCTION_GLAND_Z];
  return {
    axis: "y",
    glandCenter: [x, JUNCTION_TOP_Y + 0.008, JUNCTION_GLAND_Z],
    glandRadius,
    outside,
    terminal,
    through: [terminal, [x, JUNCTION_TOP_Y - 0.028, JUNCTION_GLAND_Z], outside],
  };
}

const JUNCTION_PORTS = {
  batteryPosA: bottomJunctionPenetration(3.31, 0.013),
  batteryPosB: bottomJunctionPenetration(3.342, 0.013),
  batteryNegA: bottomJunctionPenetration(3.374, 0.013),
  batteryNegB: bottomJunctionPenetration(3.406, 0.013),
  mpptPos: rightJunctionPenetration(1.772, 0.0095),
  mpptNeg: rightJunctionPenetration(1.746, 0.0095),
  multiplusPos: rightJunctionPenetration(1.716, 0.013),
  multiplusNeg: rightJunctionPenetration(1.682, 0.013),
  orion24Pos: rightJunctionPenetration(1.652, 0.009),
  orion24Neg: rightJunctionPenetration(1.627, 0.009),
  orion12Pos: rightJunctionPenetration(1.603, 0.008),
  orion12Neg: rightJunctionPenetration(1.582, 0.008),
  ekranPos: topJunctionPenetration(3.41, 0.006),
  ekranNeg: topJunctionPenetration(3.45, 0.006),
  ekranData: topJunctionPenetration(3.49, 0.0055),
  loadPos: [
    bottomJunctionPenetration(3.438, 0.007),
    bottomJunctionPenetration(3.482, 0.007),
    bottomJunctionPenetration(3.526, 0.007),
    bottomJunctionPenetration(3.57, 0.007),
  ],
  loadNeg: [
    bottomJunctionPenetration(3.46, 0.007),
    bottomJunctionPenetration(3.504, 0.007),
    bottomJunctionPenetration(3.548, 0.007),
    bottomJunctionPenetration(3.592, 0.007),
  ],
};

const DEVICE_PORTS = {
  starlink: {
    powerPositive: [physicalLayout.devices.starlink.position[0] - 0.04, physicalLayout.devices.starlink.position[1] - 0.05, physicalLayout.devices.starlink.position[2]] as VectorTuple,
    powerNegative: [physicalLayout.devices.starlink.position[0], physicalLayout.devices.starlink.position[1] - 0.05, physicalLayout.devices.starlink.position[2]] as VectorTuple,
    ethernet: [physicalLayout.devices.starlink.position[0] + 0.04, physicalLayout.devices.starlink.position[1] - 0.05, physicalLayout.devices.starlink.position[2]] as VectorTuple,
  },
  smartSolar: {
    pvPositive: physicalLayout.ports.smartSolarPvPositive as VectorTuple,
    pvNegative: physicalLayout.ports.smartSolarPvNegative as VectorTuple,
    batteryPositive: physicalLayout.ports.smartSolarBatteryPositive as VectorTuple,
    batteryNegative: physicalLayout.ports.smartSolarBatteryNegative as VectorTuple,
    earth: physicalLayout.ports.smartSolarEarth as VectorTuple,
  },
  multiPlus: {
    dcPositive: physicalLayout.ports.multiPlusDcPositive as VectorTuple,
    dcNegative: physicalLayout.ports.multiPlusDcNegative as VectorTuple,
    acInputCable: physicalLayout.ports.multiPlusAcInputCable as VectorTuple,
    acOutputCable: physicalLayout.ports.multiPlusAcOutputCable as VectorTuple,
    chassisEarth: physicalLayout.ports.multiPlusChassisEarth as VectorTuple,
  },
  orion: {
    inputPositive: physicalLayout.ports.orionInputPositive as VectorTuple,
    inputNegative: physicalLayout.ports.orionInputNegative as VectorTuple,
    outputPositive: physicalLayout.ports.orionOutputPositive as VectorTuple,
    outputNegative: physicalLayout.ports.orionOutputNegative as VectorTuple,
  },
  ekran: {
    powerPositive: physicalLayout.ports.ekranPowerPositive as VectorTuple,
    powerNegative: physicalLayout.ports.ekranPowerNegative as VectorTuple,
    veDirect: physicalLayout.ports.ekranVeDirect as VectorTuple,
    veCan: physicalLayout.ports.ekranVeCan as VectorTuple,
    veBus: physicalLayout.ports.ekranVeBus as VectorTuple,
    ethernet: physicalLayout.ports.ekranEthernet as VectorTuple,
    earth: physicalLayout.ports.ekranEarth as VectorTuple,
  },
  unifi: {
    power: physicalLayout.ports.unifiPower as VectorTuple,
    wan: physicalLayout.ports.unifiWan as VectorTuple,
    lan: physicalLayout.ports.unifiLan as VectorTuple,
  },
  usb: {
    dcPositive: physicalLayout.ports.usbPositive as VectorTuple,
    dcNegative: physicalLayout.ports.usbNegative as VectorTuple,
    reservedUsbC: physicalLayout.ports.usbReservedUsbC as VectorTuple,
  },
  classT: {
    stringAInput: physicalLayout.ports.classTAInput as VectorTuple,
    stringAOutput: physicalLayout.ports.classTAOutput as VectorTuple,
    stringBInput: physicalLayout.ports.classTBInput as VectorTuple,
    stringBOutput: physicalLayout.ports.classTBOutput as VectorTuple,
  },
  pvEntry: {
    stringInputs: [
      physicalLayout.ports.pvEntryStringAPositive,
      physicalLayout.ports.pvEntryStringANegative,
      physicalLayout.ports.pvEntryStringBPositive,
      physicalLayout.ports.pvEntryStringBNegative,
    ] as VectorTuple[],
    mpptPositive: physicalLayout.ports.pvEntryMpptPositive as VectorTuple,
    mpptNegative: physicalLayout.ports.pvEntryMpptNegative as VectorTuple,
    earth: physicalLayout.ports.pvEntryEarth as VectorTuple,
  },
  acBoard: {
    acCable: physicalLayout.ports.acBoardAcCable as VectorTuple,
    earth: physicalLayout.ports.acBoardEarth as VectorTuple,
  },
  generatorInlet: {
    acCable: physicalLayout.ports.generatorInletAcCable as VectorTuple,
  },
};

const COLORS = {
  battery: 0x315f68,
  black: 0x20262a,
  blue: 0x3e73a5,
  copper: 0xb96d33,
  earth: 0x4d8a5e,
  frame: 0xaeb8b5,
  generator: 0x76589b,
  indoor: 0xe8e2d4,
  orange: 0xe69a35,
  outdoor: 0xd8cfaa,
  panel: 0x234b66,
  red: 0xc83f38,
  teal: 0x287a73,
  victron: 0x2d6e9f,
  white: 0xf5f3e9,
  threeCoreAc: 0xf2f1ec,
  yellow: 0xe4bb42,
};

const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: "site",
    label: "Whole site",
    position: [-5.8, 6.25, 9.2],
    target: [1.45, 1.15, -0.15],
  },
  {
    id: "array",
    label: "Solar array",
    position: [-4.4, 3.25, 5.7],
    target: [-0.45, 0.6, -0.05],
  },
  {
    id: "wall",
    label: "Equipment wall",
    position: [4.7, 3.0, 3.35],
    target: [2.85, 1.45, -2.0],
  },
  {
    id: "batteries",
    label: "Battery bank",
    position: [4.55, 1.25, 1.2],
    target: [3.42, 0.16, -1.62],
  },
  {
    id: "junction",
    label: "Open junction box",
    position: [3.28, 1.72, -0.78],
    target: [3.3, 1.69, -1.92],
  },
];

const MODEL_LABELS: ModelLabel[] = [
  { id: "north", label: "NORTH", detail: "array faces north · 18° tilt", position: [-2.55, 0.14, 2.85], zone: true, views: ["site", "array"] },
  { id: "panel1", componentId: "panel1", label: "Panel 1", detail: "2.279 × 1.134 m · string A", position: [-1.12, 1.02, -1.18], offset: [-145, 0], views: ["array"] },
  { id: "panel2", componentId: "panel2", label: "Panel 2", detail: "2.279 × 1.134 m · string A", position: [0.02, 1.38, -1.18], offset: [-110, -12], views: ["array"] },
  { id: "panel3", componentId: "panel3", label: "Panel 3", detail: "2.279 × 1.134 m · string B", position: [-1.12, 1.02, 1.18], offset: [20, 10], views: ["array"] },
  { id: "panel4", componentId: "panel4", label: "Panel 4", detail: "2.279 × 1.134 m · string B", position: [0.02, 1.38, 1.18], offset: [26, 0], views: ["array"] },
  { id: "pv-runs", label: "Two complete PV pairs", detail: "four conductors run directly to indoor entry protection · 15 m design allowance", position: [1.05, 0.52, -1.75], offset: [-360, 65], views: ["site"] },
  { id: "starlink", componentId: "starlink", label: "Starlink Mini", detail: "high back-wall mount · 298.5 × 259 mm", position: physicalLayout.devices.starlink.position as VectorTuple, offset: [-120, -10], views: ["site"] },
  { id: "generator", componentId: "generator", label: "G3200P", detail: "backup · opposite / cable-entry side of array", position: physicalLayout.devices.generator.position as VectorTuple, offset: [-120, 25], views: ["site"] },
  { id: "generator-inlet", componentId: "generatorInput", label: "Generator inlet", detail: "low wall · single 3-core flex outside", position: physicalLayout.devices.generatorInlet.position as VectorTuple, offset: [-125, 10], views: ["wall"] },
  { id: "entry-box", componentId: "pvSafety", label: "PV entry protection + combine", detail: "four string inputs · 40 A disconnect · Type 2 SPD", position: physicalLayout.devices.pvEntry.position as VectorTuple, offset: [-100, -28], views: ["wall"] },
  { id: "smartsolar", componentId: "solarController", label: "SmartSolar 150/85", detail: "immediately right of PV entry · 295 × 216 × 103 mm", position: physicalLayout.devices.smartSolar.position as VectorTuple, offset: [10, 26], views: ["wall"] },
  { id: "multiplus", componentId: "inverter", label: "MultiPlus-II 24/3000", detail: "high wall · 268 × 499 × 141 mm", position: physicalLayout.devices.multiPlus.position as VectorTuple, offset: [-145, 18], views: ["wall"] },
  { id: "junction", componentId: "mounting", label: "Compact junction box", detail: "350 × 247 × 150 mm · shown open", position: [3.49, 1.94, -1.87], offset: [34, 34], views: ["wall"] },
  { id: "ekrano", componentId: "systemMonitor", label: "Ekrano GX", detail: "wall-mounted above junction box", position: physicalLayout.devices.ekran.position as VectorTuple, offset: [-120, -96], views: ["wall", "junction"] },
  { id: "selector", componentId: "batterySelector", label: "Positive string selector", detail: "A / B / BOTH / OFF · no negative switching", position: [3.335, 1.615, -1.8], offset: [-225, 76], views: ["junction"] },
  { id: "shunt-battery", componentId: "mainDc", label: "BATTERY MINUS", detail: "both string negatives land here", position: [3.352, 1.748, -1.8], offset: [-225, -48], views: ["junction"] },
  { id: "shunt-system", componentId: "mainDc", label: "SYSTEM MINUS", detail: "the only path to every load / charger", position: [3.438, 1.748, -1.8], offset: [-225, 3], views: ["junction"] },
  { id: "bus-positive", componentId: "mainDc", label: "24 V + BUS", detail: "selected positive · covered M10 busbar", position: [3.54, 1.788, -1.8], offset: [96, -82], views: ["junction"] },
  { id: "bus-negative", componentId: "mainDc", label: "24 V − BUS", detail: "system side of SmartShunt only", position: [3.54, 1.724, -1.8], offset: [96, -32], views: ["junction"] },
  { id: "fuse-block", componentId: "fuseBlock", label: "12 V + FUSES", detail: "1 Starlink 10 A · 2 USB / UniFi 15 A · 3 lights 10 A · 4–6 spare", position: [3.54, 1.642, -1.8], offset: [96, 20], views: ["junction"] },
  { id: "return-bus", componentId: "fuseBlock", label: "12 V − RETURNS", detail: "black wires bypass every fuse", position: [3.54, 1.584, -1.8], offset: [96, 72], views: ["junction"] },
  { id: "branch-fuses", componentId: "mainDc", label: "INLINE BRANCH FUSES", detail: "MPPT 100 A · Orion input 30 A · Orion output 35 A · GX 3.15 A", position: [3.59, 1.7, -1.79], offset: [-255, -180], views: ["junction"] },
  { id: "balancer-a", componentId: "balancers", label: "Battery balancer A", detail: "wired to string A − / midpoint / +", position: physicalLayout.devices.balancerA.position as VectorTuple, offset: [-105, -65], views: ["wall", "batteries"] },
  { id: "balancer-b", componentId: "balancers", label: "Battery balancer B", detail: "wired to string B − / midpoint / +", position: physicalLayout.devices.balancerB.position as VectorTuple, offset: [52, -60], views: ["wall", "batteries"] },
  { id: "orion", componentId: "dcConverter", label: "Orion-Tr 24/12-30", detail: "immediately right of junction box · 186 × 130 × 80 mm", position: physicalLayout.devices.orion.position as VectorTuple, offset: [10, -18], views: ["wall"] },
  { id: "ac-box", componentId: "acBoard", label: "AC output protection", detail: "beside MultiPlus · 10 A Type A RCBO", position: physicalLayout.devices.acBoard.position as VectorTuple, offset: [8, 25], views: ["wall"] },
  { id: "unifi", componentId: "router", label: "UniFi Express", detail: "next to Ekrano · 98 × 98 × 30 mm", position: physicalLayout.devices.unifi.position as VectorTuple, offset: [-18, 70], views: ["wall"] },
  { id: "usb", componentId: "usb", label: "USB charging", detail: "UniFi USB-C + device charging", position: physicalLayout.devices.usb.position as VectorTuple, offset: [-45, -110], views: ["wall"] },
  { id: "battery1", componentId: "battery1", label: "Battery 1", detail: "String A · floor row · 520 × 238 × 220 mm", position: physicalLayout.devices.battery1.position as VectorTuple, offset: [-55, 0], views: ["batteries"] },
  { id: "battery2", componentId: "battery2", label: "Battery 2", detail: "String A · floor row · 520 × 238 × 220 mm", position: physicalLayout.devices.battery2.position as VectorTuple, offset: [24, 0], views: ["batteries"] },
  { id: "battery3", componentId: "battery3", label: "Battery 3", detail: "String B · floor row · 520 × 238 × 220 mm", position: physicalLayout.devices.battery3.position as VectorTuple, offset: [-55, 8], views: ["batteries"] },
  { id: "battery4", componentId: "battery4", label: "Battery 4", detail: "String B · floor row · 520 × 238 × 220 mm", position: physicalLayout.devices.battery4.position as VectorTuple, offset: [24, 8], views: ["batteries"] },
  { id: "class-t", componentId: "mainDc", label: "2 × Class T holders", detail: "plywood wall · one per string positive", position: [3.63, 0.53, physicalLayout.devices.classTA.position[2]], offset: [-90, -10], views: ["batteries"] },
  { id: "trailing-socket", componentId: "toolOutlet", label: "Trailing tool socket", detail: "short white 3-core lead beside MultiPlus", position: physicalLayout.devices.trailingSocket.position as VectorTuple, offset: [32, 15], views: ["site", "wall"] },
  { id: "lights", componentId: "lights", label: "6 × 12 V lights", detail: "two rows of three ceiling fixtures", position: [5.72, 2.94, 0.62], offset: [30, 0], views: ["wall"] },
  { id: "earth-bar", componentId: "earth", label: "Main PE bar", detail: "electrode + array + equipment bonds", position: physicalLayout.devices.earthBar.position as VectorTuple, offset: [12, -34], views: ["wall"] },
  { id: "earth", componentId: "earth", label: "Earth electrode", detail: "array + chassis + AC protective earth", position: [0.72, 0.44, -2.58], offset: [-245, 8], views: ["site"] },
];

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function vector(value: VectorTuple) {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function material(
  color: number,
  options: { opacity?: number; metalness?: number; roughness?: number; emissive?: number } = {},
) {
  const opacity = options.opacity ?? 1;
  return new THREE.MeshStandardMaterial({
    color,
    emissive: options.emissive ?? 0x000000,
    flatShading: true,
    metalness: options.metalness ?? 0.08,
    opacity,
    roughness: options.roughness ?? 0.72,
    transparent: opacity < 1,
  });
}

function tagObject(root: THREE.Object3D, componentId: string, pickables: THREE.Object3D[]) {
  root.userData.componentId = componentId;
  root.traverse((child) => {
    child.userData.componentId = componentId;
    if (child instanceof THREE.Mesh) pickables.push(child);
  });
}

function addOutlinedBox(
  parent: THREE.Object3D,
  size: VectorTuple,
  position: VectorTuple,
  color: number,
  options: {
    opacity?: number;
    outline?: number;
    componentId?: string;
    pickables?: THREE.Object3D[];
    rotation?: VectorTuple;
  } = {},
) {
  const group = new THREE.Group();
  group.position.set(...position);
  if (options.rotation) {
    group.rotation.set(
      radians(options.rotation[0]),
      radians(options.rotation[1]),
      radians(options.rotation[2]),
    );
  }
  const geometry = new THREE.BoxGeometry(...size);
  const body = new THREE.Mesh(geometry, material(color, { opacity: options.opacity }));
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: options.outline ?? 0x263a3c,
      opacity: options.opacity ? Math.min(1, options.opacity + 0.25) : 0.72,
      transparent: true,
    }),
  );
  group.add(edges);
  parent.add(group);
  if (options.componentId && options.pickables) {
    tagObject(group, options.componentId, options.pickables);
  }
  return group;
}

function addCylinder(
  parent: THREE.Object3D,
  radius: number,
  height: number,
  position: VectorTuple,
  color: number,
  rotation: VectorTuple = [0, 0, 0],
) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 12);
  const mesh = new THREE.Mesh(geometry, material(color, { metalness: 0.22 }));
  mesh.position.set(...position);
  mesh.rotation.set(radians(rotation[0]), radians(rotation[1]), radians(rotation[2]));
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function cableRouter(parent: THREE.Object3D) {
  let router = CABLE_ROUTERS.get(parent);
  if (!router) {
    router = new CableRoutingSystem();
    CABLE_ROUTERS.set(parent, router);
  }
  return router;
}

function registerCableObstacle(
  parent: THREE.Object3D,
  id: string,
  center: VectorTuple,
  size: VectorTuple,
  passages: CablePassage[] = [],
) {
  cableRouter(parent).registerObstacle(id, center, size, passages);
}

function addCable(
  parent: THREE.Object3D,
  points: VectorTuple[],
  color: number,
  radius = 0.008,
  visibility: CableVisibility = "context",
) {
  const plannedPoints = cableRouter(parent).prepareRoute(points, radius, visibility, false);
  const curve = new THREE.CatmullRomCurve3(plannedPoints.map(vector), false, "centripetal", 0.45);
  const geometry = new THREE.TubeGeometry(
    curve,
    Math.max(18, plannedPoints.length * 9),
    radius,
    10,
    false,
  );
  const mesh = new THREE.Mesh(
    geometry,
    material(color, { metalness: 0, roughness: 0.82 }),
  );
  mesh.userData.modelCable = visibility;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function addStraightSegment(
  parent: THREE.Object3D,
  start: VectorTuple,
  end: VectorTuple,
  color: number,
  radius: number,
  visibility: CableVisibility = "context",
) {
  const startVector = vector(start);
  const endVector = vector(end);
  const direction = endVector.clone().sub(startVector);
  const length = direction.length();
  if (length < 0.0001) return undefined;
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
  const mesh = new THREE.Mesh(geometry, material(color, { metalness: 0, roughness: 0.82 }));
  mesh.position.copy(startVector).add(endVector).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.userData.modelCable = visibility;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function addOrthogonalCable(
  parent: THREE.Object3D,
  points: VectorTuple[],
  color: number,
  radius = 0.006,
  visibility: CableVisibility = "context",
  avoidCrossings = true,
) {
  const router = cableRouter(parent);
  const plannedPoints = router.prepareRoute(points, radius, visibility, avoidCrossings);
  const bendRadius = Math.max(radius * 4.25, 0.009);
  const { geometry, roundedCorners } = buildRoundedCableGeometry(
    plannedPoints,
    bendRadius,
    radius,
    9,
  );
  router.noteRoundedCorners(roundedCorners);
  const mesh = new THREE.Mesh(
    geometry,
    material(color, { metalness: 0, roughness: 0.82 }),
  );
  mesh.userData.modelCable = visibility;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function addRodBetween(
  parent: THREE.Object3D,
  start: VectorTuple,
  end: VectorTuple,
  radius = 0.025,
  color = 0x737f7d,
) {
  const rod = addStraightSegment(parent, start, end, color, radius);
  if (rod) delete rod.userData.modelCable;
  return rod;
}

function wallLanePlanner(scene: THREE.Scene) {
  let planner = WALL_LANE_PLANNERS.get(scene);
  if (!planner) {
    planner = new PlanarCableLanePlanner();
    WALL_LANE_PLANNERS.set(scene, planner);
  }
  return planner;
}

function wallPlaneRoutePoints(
  scene: THREE.Scene,
  footprint: Array<[number, number]>,
  radius: number,
  preferredPlaneOffset = 0,
) {
  const planeOffset = wallLanePlanner(scene).assign(footprint, radius, preferredPlaneOffset);
  const planeZ = WALL_CABLE_Z + planeOffset;
  return footprint.map(([x, y]) => [x, y, planeZ] as VectorTuple);
}

function orthogonalWallFootprint(anchors: Array<[number, number]>) {
  return anchors.flatMap((point, index) => {
    if (index === 0) return [point];
    const previous = anchors[index - 1];
    if (Math.abs(previous[0] - point[0]) < 0.0001 || Math.abs(previous[1] - point[1]) < 0.0001) return [point];
    return [[point[0], previous[1]] as [number, number], point];
  });
}

function wallRoutedPoints(
  scene: THREE.Scene,
  start: VectorTuple,
  route: Array<[number, number]>,
  end: VectorTuple,
  radius: number,
  preferredPlaneOffset = 0,
) {
  const footprint = orthogonalWallFootprint([
    [start[0], start[1]],
    ...route,
    [end[0], end[1]],
  ]);
  const points: VectorTuple[] = [
    start,
    ...wallPlaneRoutePoints(scene, footprint, radius, preferredPlaneOffset),
    end,
  ];
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return point.some((value, axis) => Math.abs(value - previous[axis]) > 0.0001);
  });
}

function addWallRoutedCable(
  scene: THREE.Scene,
  start: VectorTuple,
  route: Array<[number, number]>,
  end: VectorTuple,
  color: number,
  radius = 0.005,
  visibility: CableVisibility = "context",
  preferredPlaneOffset = 0,
) {
  const points = wallRoutedPoints(scene, start, route, end, radius, preferredPlaneOffset);
  addOrthogonalCable(scene, points, color, radius, visibility, false);
}

function wallPathFromPenetration(
  scene: THREE.Scene,
  penetration: JunctionPenetration,
  route: Array<[number, number]>,
  end: VectorTuple,
  radius = 0.005,
  preferredPlaneOffset = 0,
) {
  const anchors: Array<[number, number]> = [
    [penetration.outside[0], penetration.outside[1]],
    ...route,
    [end[0], end[1]],
  ];
  const footprint = orthogonalWallFootprint(anchors);
  return [
    ...wallPlaneRoutePoints(scene, footprint, radius, preferredPlaneOffset),
    end,
  ];
}

function wallPathFromPenetrationToDeparture(
  scene: THREE.Scene,
  penetration: JunctionPenetration,
  route: Array<[number, number]>,
  radius: number,
  preferredPlaneOffset = 0,
) {
  // A cable leaving the plywood for the ceiling must depart directly from its
  // assigned clearance lane. Snapping to WALL_CABLE_Z first creates a short
  // 180-degree backtrack for every lane that sits proud of that datum.
  return wallPlaneRoutePoints(
    scene,
    orthogonalWallFootprint([[penetration.outside[0], penetration.outside[1]], ...route]),
    radius,
    preferredPlaneOffset,
  );
}

function addContinuousJunctionCable(
  scene: THREE.Scene,
  insidePoints: VectorTuple[],
  penetration: JunctionPenetration,
  exteriorPoints: VectorTuple[],
  color: number,
  radius: number,
  splitVisibility = true,
) {
  const through = penetration.through;
  if (!splitVisibility) {
    addOrthogonalCable(
      scene,
      [...insidePoints, ...through.slice(1), ...exteriorPoints],
      color,
      radius,
      "junction",
      false,
    );
    return;
  }
  const prefix: VectorTuple[] = [
    ...insidePoints,
    ...through.slice(1),
    exteriorPoints[0],
  ];
  const remaining = exteriorPoints.slice(1);
  // Keep every enclosure-exit bend in one mesh. The visibility handoff happens
  // well down a straight run, where two tangent tube sections are imperceptible.
  const minimumHandoffRun = Math.max(0.22, radius * 12);
  let cursor = prefix[prefix.length - 1];
  let splitIndex = -1;
  let handoff: VectorTuple | null = null;

  for (let index = 0; index < remaining.length; index += 1) {
    const next = remaining[index];
    const start = vector(cursor);
    const end = vector(next);
    const length = start.distanceTo(end);
    if (length > minimumHandoffRun * 1.8) {
      const splitDistance = Math.min(minimumHandoffRun, length * 0.42);
      handoff = start.lerp(end, splitDistance / length).toArray() as VectorTuple;
      splitIndex = index;
      break;
    }
    prefix.push(next);
    cursor = next;
  }

  if (!handoff || splitIndex < 0) {
    addOrthogonalCable(scene, [...prefix, ...remaining], color, radius, "junction", false);
    return;
  }

  const handoffBefore = prefix[prefix.length - 1];
  prefix.push(handoff);
  cableRouter(scene).registerTangentHandoff(
    `junction-${penetration.axis}-${penetration.glandCenter.join("-")}`,
    handoffBefore,
    handoff,
    remaining[splitIndex],
  );
  addOrthogonalCable(scene, prefix, color, radius, "junction", false);
  addOrthogonalCable(
    scene,
    [handoff, remaining[splitIndex], ...remaining.slice(splitIndex + 1)],
    color,
    radius,
    "context",
    false,
  );
}

function addPanel(
  scene: THREE.Scene,
  id: string,
  position: VectorTuple,
  pickables: THREE.Object3D[],
) {
  const group = new THREE.Group();
  group.position.set(...position);
  const tilt = radians(FIJI_PANEL_TILT_DEG);
  const panelWidthAxis = new THREE.Vector3(0, 0, 1);
  const panelSlopeAxis = new THREE.Vector3(Math.cos(tilt), Math.sin(tilt), 0);
  const panelFaceAxis = new THREE.Vector3().crossVectors(panelWidthAxis, panelSlopeAxis);
  group.setRotationFromMatrix(
    new THREE.Matrix4().makeBasis(panelWidthAxis, panelSlopeAxis, panelFaceAxis),
  );
  const body = addOutlinedBox(group, [2.279, 1.134, 0.035], [0, 0, 0], COLORS.panel, {
    outline: 0xd7dddd,
  });
  const cellMaterial = new THREE.LineBasicMaterial({ color: 0x8db2bf, opacity: 0.6, transparent: true });
  const points: THREE.Vector3[] = [];
  for (let column = 1; column < 12; column += 1) {
    const x = -1.1395 + (2.279 * column) / 12;
    points.push(new THREE.Vector3(x, -0.56, 0.021), new THREE.Vector3(x, 0.56, 0.021));
  }
  for (let row = 1; row < 6; row += 1) {
    const y = -0.567 + (1.134 * row) / 6;
    points.push(new THREE.Vector3(-1.13, y, 0.021), new THREE.Vector3(1.13, y, 0.021));
  }
  const gridGeometry = new THREE.BufferGeometry().setFromPoints(points);
  body.add(new THREE.LineSegments(gridGeometry, cellMaterial));
  tagObject(group, id, pickables);
  scene.add(group);
  return group;
}

function addBattery(
  scene: THREE.Scene,
  id: string,
  position: VectorTuple,
  pickables: THREE.Object3D[],
) {
  const group = addOutlinedBox(scene, [0.52, 0.22, 0.238], position, COLORS.battery, {
    componentId: id,
    pickables,
    outline: 0x19383e,
  });
  addOutlinedBox(group, [0.5, 0.025, 0.218], [0, 0.122, 0], 0x244950, { outline: 0x19383e });
  addCylinder(group, 0.025, 0.035, [-0.17, 0.147, 0.055], COLORS.black);
  addCylinder(group, 0.025, 0.035, [0.17, 0.147, 0.055], COLORS.red);
  const ventPositions = [-0.12, -0.04, 0.04, 0.12];
  ventPositions.forEach((x) => addCylinder(group, 0.012, 0.01, [x, 0.14, -0.06], 0xbac7c6));
  return group;
}

function addVictronDevice(
  scene: THREE.Scene,
  id: string,
  size: VectorTuple,
  position: VectorTuple,
  pickables: THREE.Object3D[],
  options: { color?: number; darkBottom?: boolean } = {},
) {
  const group = addOutlinedBox(scene, size, position, options.color ?? COLORS.victron, {
    componentId: id,
    pickables,
    outline: 0x164568,
  });
  addOutlinedBox(
    group,
    [size[0] * 0.72, Math.min(0.035, size[1] * 0.16), size[2] + 0.004],
    [0, size[1] * 0.23, 0.003],
    COLORS.white,
    { outline: 0xd6d7cf },
  );
  addCylinder(group, Math.min(0.016, size[0] * 0.07), 0.006, [size[0] * 0.32, size[1] * 0.25, size[2] * 0.52], COLORS.orange, [90, 0, 0]);
  if (options.darkBottom) {
    addOutlinedBox(group, [size[0] * 0.96, size[1] * 0.17, size[2] * 1.02], [0, -size[1] * 0.41, 0], 0x24353b, { outline: 0x16262a });
  }
  return group;
}

function addFrontTerminal(
  scene: THREE.Scene,
  position: VectorTuple,
  color: number,
  radius = 0.007,
) {
  addCylinder(scene, radius + 0.002, 0.005, position, 0x1b2224, [90, 0, 0]);
  addCylinder(scene, radius, 0.009, [position[0], position[1], position[2] + 0.004], color, [90, 0, 0]);
}

function addProtectionBox(
  scene: THREE.Scene,
  id: string,
  position: VectorTuple,
  pickables: THREE.Object3D[],
  size: VectorTuple = [0.25, 0.3, 0.12],
) {
  const group = addOutlinedBox(scene, size, position, 0xd9dcd6, {
    componentId: id,
    pickables,
    opacity: 0.78,
    outline: 0x64716e,
  });
  [-0.065, 0, 0.065].forEach((x, index) => {
    addOutlinedBox(group, [0.04, size[1] * 0.55, 0.025], [x, 0, size[2] * 0.5], index === 2 ? COLORS.orange : COLORS.white, { outline: 0x6e7775 });
  });
  return group;
}

function addGenerator(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const group = new THREE.Group();
  group.position.set(...physicalLayout.devices.generator.position);
  addOutlinedBox(group, [0.48, 0.32, 0.36], [0, 0, 0], COLORS.generator, { outline: 0x3d2f52 });
  addOutlinedBox(group, [0.2, 0.22, 0.22], [-0.08, 0, 0.19], 0x2e3435, { outline: 0x161b1d });
  const frameMaterial = material(0x343a3c, { metalness: 0.4 });
  const frameGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.58, 8);
  [-0.23, 0.23].forEach((x) => {
    [-0.2, 0.2].forEach((z) => {
      const post = new THREE.Mesh(frameGeometry, frameMaterial);
      post.position.set(x, 0, z);
      group.add(post);
    });
  });
  [-0.22, 0.22].forEach((x) => addCylinder(group, 0.085, 0.035, [x, -0.17, 0.19], 0x242829, [90, 0, 0]));
  tagObject(group, "generator", pickables);
  scene.add(group);
}

function addStarlink(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const position = physicalLayout.devices.starlink.position as VectorTuple;
  addOutlinedBox(scene, [0.34, 0.035, 0.34], [position[0], position[1] - 0.24, position[2]], 0x8b9694, {
    outline: 0x596462,
  });
  addCylinder(scene, 0.025, 0.2, [position[0], position[1] - 0.13, position[2]], 0x7e8988);
  const dish = addOutlinedBox(scene, [0.2985, 0.0385, 0.259], position, 0xe9e9e4, {
    componentId: "starlink",
    pickables,
    outline: 0x6b7675,
    rotation: [0, 0, -10],
  });
  addOutlinedBox(dish, [0.18, 0.02, 0.12], [0, -0.05, 0], 0x929b99, { outline: 0x5c6664 });
  addCylinder(scene, 0.006, 0.014, DEVICE_PORTS.starlink.powerPositive, COLORS.red);
  addCylinder(scene, 0.006, 0.014, DEVICE_PORTS.starlink.powerNegative, COLORS.black);
  addOutlinedBox(scene, [0.017, 0.009, 0.014], DEVICE_PORTS.starlink.ethernet, COLORS.blue, { outline: 0x244c71 });
}

function addTerminalBusbar(
  parent: THREE.Object3D,
  position: VectorTuple,
  baseColor: number,
  componentId: string,
  pickables: THREE.Object3D[],
  studCount = 5,
) {
  const group = new THREE.Group();
  group.position.set(...position);
  addOutlinedBox(group, [0.14, 0.025, 0.026], [0, 0, 0], baseColor, {
    outline: baseColor === COLORS.red ? 0x7c2623 : 0x111516,
  });
  addOutlinedBox(group, [0.122, 0.012, 0.012], [0, 0, 0.018], COLORS.copper, {
    outline: 0x75421f,
  });
  const spacing = 0.106 / Math.max(1, studCount - 1);
  for (let index = 0; index < studCount; index += 1) {
    const x = -0.053 + spacing * index;
    addCylinder(group, 0.007, 0.017, [x, 0, 0.031], 0xd0d2cc, [90, 0, 0]);
    addCylinder(group, 0.004, 0.021, [x, 0, 0.035], 0x555e5c, [90, 0, 0]);
  }
  tagObject(group, componentId, pickables);
  parent.add(group);
  return group;
}

function addInlineFuse(
  scene: THREE.Scene,
  position: VectorTuple,
  componentId: string,
  pickables: THREE.Object3D[],
  size: VectorTuple = [0.038, 0.018, 0.018],
) {
  const holder = addOutlinedBox(scene, size, position, 0xeee8dc, {
    componentId,
    pickables,
    outline: 0x68645c,
  });
  addOutlinedBox(holder, [size[0] * 0.42, size[1] * 1.05, size[2] * 1.05], [0, 0, 0.001], COLORS.orange, {
    outline: 0x8c5b1f,
  });
  return holder;
}

function addJunctionPenetration(
  scene: THREE.Scene,
  penetration: JunctionPenetration,
  color: number,
  cableRadius: number,
  pickables: THREE.Object3D[],
  renderCable = true,
) {
  const rotation: VectorTuple = penetration.axis === "x" ? [0, 0, 90] : [0, 0, 0];
  const gland = addCylinder(
    scene,
    penetration.glandRadius,
    0.026,
    penetration.glandCenter,
    0x343b3c,
    rotation,
  );
  gland.userData.componentId = "mounting";
  pickables.push(gland);
  addCylinder(
    scene,
    Math.max(cableRadius + 0.0012, penetration.glandRadius * 0.58),
    0.031,
    penetration.glandCenter,
    0xaeb6b3,
    rotation,
  );
  if (renderCable) {
    addOrthogonalCable(scene, penetration.through, color, cableRadius, "junction");
  }
}

function addJunctionBox(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const center = JUNCTION_CENTER;
  const enclosure = new THREE.Group();
  enclosure.position.set(...center);
  addOutlinedBox(enclosure, [0.35, 0.247, 0.012], [0, 0, -0.069], 0xc8d0cc, { outline: 0x667471 });
  addOutlinedBox(enclosure, [0.35, 0.015, 0.15], [0, 0.116, 0], 0xc8d0cc, { outline: 0x667471 });
  addOutlinedBox(enclosure, [0.35, 0.015, 0.15], [0, -0.116, 0], 0xc8d0cc, { outline: 0x667471 });
  addOutlinedBox(enclosure, [0.015, 0.217, 0.15], [-0.167, 0, 0], 0xc8d0cc, { outline: 0x667471 });
  addOutlinedBox(enclosure, [0.015, 0.217, 0.15], [0.167, 0, 0], 0xc8d0cc, { outline: 0x667471 });
  tagObject(enclosure, "mounting", pickables);
  scene.add(enclosure);

  const portCables: Array<[JunctionPenetration, number, number]> = [
    [JUNCTION_PORTS.batteryPosA, COLORS.red, 0.0085],
    [JUNCTION_PORTS.batteryPosB, COLORS.red, 0.0085],
    [JUNCTION_PORTS.batteryNegA, COLORS.black, 0.0085],
    [JUNCTION_PORTS.batteryNegB, COLORS.black, 0.0085],
    [JUNCTION_PORTS.mpptPos, COLORS.red, 0.0065],
    [JUNCTION_PORTS.mpptNeg, COLORS.black, 0.0065],
    [JUNCTION_PORTS.multiplusPos, COLORS.red, 0.0085],
    [JUNCTION_PORTS.multiplusNeg, COLORS.black, 0.0085],
    [JUNCTION_PORTS.orion24Pos, COLORS.red, 0.0055],
    [JUNCTION_PORTS.orion24Neg, COLORS.black, 0.0055],
    [JUNCTION_PORTS.orion12Pos, COLORS.red, 0.0048],
    [JUNCTION_PORTS.orion12Neg, COLORS.black, 0.0048],
    [JUNCTION_PORTS.ekranPos, COLORS.red, 0.0038],
    [JUNCTION_PORTS.ekranNeg, COLORS.black, 0.0038],
    [JUNCTION_PORTS.ekranData, COLORS.blue, 0.0032],
    ...JUNCTION_PORTS.loadPos.map((port) => [port, COLORS.red, 0.0045] as [JunctionPenetration, number, number]),
    ...JUNCTION_PORTS.loadNeg.map((port) => [port, COLORS.black, 0.0045] as [JunctionPenetration, number, number]),
  ];
  const passages = portCables.map(([port]) => ({
    axis: port.axis,
    center: port.glandCenter,
    radius: port.glandRadius,
  } satisfies CablePassage));
  registerCableObstacle(scene, "junction-back", [JUNCTION_CENTER[0], JUNCTION_CENTER[1], JUNCTION_CENTER[2] - 0.069], [0.35, 0.247, 0.012]);
  registerCableObstacle(
    scene,
    "junction-top",
    [JUNCTION_CENTER[0], JUNCTION_TOP_Y - 0.0075, JUNCTION_CENTER[2]],
    [0.35, 0.015, 0.15],
    passages.filter((passage) => passage.axis === "y" && passage.center[1] > JUNCTION_CENTER[1]),
  );
  registerCableObstacle(
    scene,
    "junction-bottom",
    [JUNCTION_CENTER[0], JUNCTION_BOTTOM_Y + 0.0075, JUNCTION_CENTER[2]],
    [0.35, 0.015, 0.15],
    passages.filter((passage) => passage.axis === "y" && passage.center[1] < JUNCTION_CENTER[1]),
  );
  registerCableObstacle(scene, "junction-left", [JUNCTION_LEFT_X + 0.0075, JUNCTION_CENTER[1], JUNCTION_CENTER[2]], [0.015, 0.217, 0.15]);
  registerCableObstacle(
    scene,
    "junction-right",
    [JUNCTION_RIGHT_X - 0.0075, JUNCTION_CENTER[1], JUNCTION_CENTER[2]],
    [0.015, 0.217, 0.15],
    passages.filter((passage) => passage.axis === "x"),
  );
  portCables.forEach(([port, color, cableRadius]) => {
    addJunctionPenetration(scene, port, color, cableRadius, pickables, false);
  });

  const shunt = addOutlinedBox(enclosure, [0.12, 0.046, 0.054], [-0.055, 0.068, 0.066], COLORS.blue, {
    componentId: "mainDc",
    pickables,
    outline: 0x173f5b,
  });
  addOutlinedBox(shunt, [0.036, 0.038, 0.01], [0, 0, 0.031], COLORS.white, { outline: 0xb5b7b1 });
  addCylinder(shunt, 0.013, 0.012, [-0.043, 0, 0.032], COLORS.copper, [90, 0, 0]);
  addCylinder(shunt, 0.013, 0.012, [0.043, 0, 0.032], COLORS.copper, [90, 0, 0]);
  addTerminalBusbar(enclosure, [0.085, 0.095, 0.071], COLORS.red, "mainDc", pickables);
  addTerminalBusbar(enclosure, [0.085, 0.055, 0.071], COLORS.black, "mainDc", pickables);

  const fuseBlock = new THREE.Group();
  fuseBlock.position.set(0.07, -0.025, 0.071);
  addOutlinedBox(fuseBlock, [0.145, 0.066, 0.032], [0, 0, 0], 0xe0e5e0, { outline: 0x64716e });
  addOutlinedBox(fuseBlock, [0.126, 0.009, 0.012], [0, 0.024, 0.022], COLORS.red, { outline: 0x81302b });
  const fuseXs = [-0.0525, -0.0315, -0.0105, 0.0105, 0.0315, 0.0525];
  fuseXs.forEach((x, index) => {
    addOutlinedBox(
      fuseBlock,
      [0.014, 0.028, 0.014],
      [x, 0.003, 0.023],
      index < 3 ? [COLORS.red, 0x4e8ec0, COLORS.orange][index] : 0xc6cbc7,
      { outline: 0x716a5f },
    );
    addCylinder(fuseBlock, 0.0045, 0.012, [x, -0.023, 0.024], 0xd0d2cc, [90, 0, 0]);
  });
  addCylinder(fuseBlock, 0.007, 0.016, [-0.067, 0.024, 0.025], COLORS.copper, [90, 0, 0]);
  tagObject(fuseBlock, "fuseBlock", pickables);
  enclosure.add(fuseBlock);
  addTerminalBusbar(enclosure, [0.07, -0.094, 0.071], COLORS.black, "fuseBlock", pickables, 6);

  const selector = addCylinder(enclosure, 0.0375, 0.084, [-0.115, -0.045, 0.09], 0xc9473e, [90, 0, 0]);
  selector.userData.componentId = "batterySelector";
  pickables.push(selector);
  addCylinder(enclosure, 0.012, 0.055, [-0.115, -0.045, 0.14], 0x252a2c, [90, 0, 0]);
  [[-0.145, -0.075], [-0.115, -0.083], [-0.078, -0.025]].forEach(([x, y]) => {
    addCylinder(enclosure, 0.007, 0.018, [x, y, 0.143], COLORS.copper, [90, 0, 0]);
  });

  const door = new THREE.Group();
  door.position.set(center[0] - 0.175, center[1], center[2] + 0.078);
  door.rotation.y = radians(-112);
  const doorPanel = addOutlinedBox(door, [0.35, 0.247, 0.012], [0.175, 0, 0], 0xd8ded9, { opacity: 0.86, outline: 0x677471 });
  doorPanel.userData.componentId = "mounting";
  tagObject(doorPanel, "mounting", pickables);
  scene.add(door);

  const z = JUNCTION_WIRE_Z;
  const shuntSystem: VectorTuple = [3.438, 1.748, z];
  const positiveStuds = [3.482, 3.509, 3.536, 3.563, 3.59].map((x) => [x, 1.775, z] as VectorTuple);
  const negativeStuds = [3.482, 3.509, 3.536, 3.563, 3.59].map((x) => [x, 1.735, z] as VectorTuple);

  addOrthogonalCable(scene, [[3.372, 1.655, z], [3.445, 1.655, z], [3.445, 1.775, z], positiveStuds[0]], COLORS.red, 0.007, "junction");

  addCable(scene, [shuntSystem, negativeStuds[0]], COLORS.black, 0.007, "junction");

  addInlineFuse(scene, [3.582, 1.797, z], "mainDc", pickables);
  addOrthogonalCable(scene, [positiveStuds[2], [3.536, 1.797, z], [3.563, 1.797, z]], COLORS.red, 0.0055, "junction");

  addInlineFuse(scene, [3.592, 1.755, z], "mainDc", pickables, [0.028, 0.018, 0.018]);
  addOrthogonalCable(scene, [positiveStuds[3], [3.563, 1.755, z], [3.578, 1.755, z]], COLORS.red, 0.005, "junction");

  addInlineFuse(scene, [3.588, 1.665, z], "fuseBlock", pickables);
  addOrthogonalCable(scene, [[3.569, 1.665, z], [3.455, 1.665, z], [3.455, 1.679, z]], COLORS.red, 0.0045, "junction");

  addInlineFuse(scene, [3.5, 1.812, z], "mainDc", pickables, [0.04, 0.018, 0.016]);
  addOrthogonalCable(scene, [positiveStuds[4], [3.59, 1.812, z], [3.52, 1.812, z]], COLORS.red, 0.0038, "junction");
  const ekranExterior = (
    penetration: JunctionPenetration,
    destination: VectorTuple,
    cableRadius: number,
    lane: number,
  ): VectorTuple[] => {
    const wallLaneZ = WALL_CABLE_Z + 0.012 + lane * (cableRadius * 2 + 0.006);
    const approachY = 1.91 - lane * 0.018;
    return [
      // The three light-gauge GX leads are installed first and turn straight
      // back to their shallow wall lanes as soon as they clear the top glands.
      [penetration.outside[0], penetration.outside[1], wallLaneZ],
      [penetration.outside[0], approachY, wallLaneZ],
      [destination[0], approachY, wallLaneZ],
      [destination[0], destination[1], wallLaneZ],
      destination,
    ];
  };

  addContinuousJunctionCable(
    scene,
    [[3.48, 1.812, z], [3.41, 1.812, z], JUNCTION_PORTS.ekranPos.terminal],
    JUNCTION_PORTS.ekranPos,
    ekranExterior(JUNCTION_PORTS.ekranPos, DEVICE_PORTS.ekran.powerPositive, 0.0038, 0),
    COLORS.red,
    0.0038,
  );
  addContinuousJunctionCable(
    scene,
    [negativeStuds[4], [3.59, 1.825, z + 0.025], [3.45, 1.825, z + 0.025], JUNCTION_PORTS.ekranNeg.terminal],
    JUNCTION_PORTS.ekranNeg,
    ekranExterior(JUNCTION_PORTS.ekranNeg, DEVICE_PORTS.ekran.powerNegative, 0.0038, 1),
    COLORS.black,
    0.0038,
  );
  addContinuousJunctionCable(
    scene,
    [[3.395, 1.748, z + 0.04], [3.395, 1.825, z + 0.04], [3.49, 1.825, z + 0.04], JUNCTION_PORTS.ekranData.terminal],
    JUNCTION_PORTS.ekranData,
    ekranExterior(JUNCTION_PORTS.ekranData, DEVICE_PORTS.ekran.veDirect, 0.0032, 2),
    COLORS.blue,
    0.0032,
  );
}

function addBuilding(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  physicalLayout.surfaces.floorPlanes.forEach((surface, index) => {
    addOutlinedBox(scene, surface.size as VectorTuple, surface.center as VectorTuple, index === 0 ? COLORS.outdoor : COLORS.indoor, {
      outline: index === 0 ? 0xc5bc99 : 0xb9afa0,
    });
  });
  addOutlinedBox(scene, physicalLayout.surfaces.backWall.size as VectorTuple, physicalLayout.surfaces.backWall.center as VectorTuple, 0xe5dfd2, { opacity: 0.9, outline: 0xada596 });
  addOutlinedBox(scene, physicalLayout.surfaces.equipmentBoard.size as VectorTuple, physicalLayout.surfaces.equipmentBoard.center as VectorTuple, 0xc79c63, {
    componentId: "mounting",
    pickables,
    outline: 0x785e3e,
  });

  addOutlinedBox(scene, [0.72, 0.025, 0.06], [-2.58, 0.035, 2.85], COLORS.teal, {
    outline: 0x164e4c,
  });
  const northTip = new THREE.Mesh(
    new THREE.ConeGeometry(0.15, 0.32, 8),
    material(COLORS.teal, { roughness: 0.7 }),
  );
  northTip.position.set(-3.04, 0.05, 2.85);
  northTip.rotation.z = radians(90);
  northTip.castShadow = true;
  scene.add(northTip);
}

function addArrayStructure(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  addPanel(scene, "panel1", [-1.12, 0.38, -1.18], pickables);
  addPanel(scene, "panel2", [0.02, 0.75, -1.18], pickables);
  addPanel(scene, "panel3", [-1.12, 0.38, 1.18], pickables);
  addPanel(scene, "panel4", [0.02, 0.75, 1.18], pickables);

  [-2.28, 0, 2.28].forEach((z) => {
    addRodBetween(scene, [-1.67, 0.19, z], [0.57, 0.92, z], 0.027);
    addRodBetween(scene, [-1.67, 0.03, z], [-1.67, 0.19, z], 0.025);
    addRodBetween(scene, [0.57, 0.03, z], [0.57, 0.92, z], 0.025);
  });
  addRodBetween(scene, [-1.67, 0.05, -2.28], [-1.67, 0.05, 2.28], 0.025);
  addRodBetween(scene, [0.57, 0.05, -2.28], [0.57, 0.05, 2.28], 0.025);

}

function addWallEquipment(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const devices = physicalLayout.devices;
  addProtectionBox(scene, "pvSafety", devices.pvEntry.position as VectorTuple, pickables, devices.pvEntry.size as VectorTuple);
  addVictronDevice(scene, "solarController", devices.smartSolar.size as VectorTuple, devices.smartSolar.position as VectorTuple, pickables, { darkBottom: true });
  addVictronDevice(scene, "inverter", devices.multiPlus.size as VectorTuple, devices.multiPlus.position as VectorTuple, pickables, { darkBottom: true });
  addVictronDevice(scene, "dcConverter", devices.orion.size as VectorTuple, devices.orion.position as VectorTuple, pickables, { darkBottom: true });
  addVictronDevice(scene, "balancers", devices.balancerA.size as VectorTuple, devices.balancerA.position as VectorTuple, pickables);
  addVictronDevice(scene, "balancers", devices.balancerB.size as VectorTuple, devices.balancerB.position as VectorTuple, pickables);
  addProtectionBox(scene, "acBoard", devices.acBoard.position as VectorTuple, pickables, devices.acBoard.size as VectorTuple);
  const ekran = addOutlinedBox(scene, devices.ekran.size as VectorTuple, devices.ekran.position as VectorTuple, 0x273e4b, { componentId: "systemMonitor", pickables, outline: 0x101d24 });
  addOutlinedBox(ekran, [0.164, 0.092, 0.008], [0, 0, devices.ekran.size[2] / 2 + 0.004], 0x69a7ba, { outline: 0xb8d5d6 });
  const unifi = addOutlinedBox(scene, devices.unifi.size as VectorTuple, devices.unifi.position as VectorTuple, 0xf2f1eb, { componentId: "router", pickables, outline: 0x99a2a0 });
  addCylinder(unifi, 0.008, 0.005, [0.035, -0.035, 0.019], 0x72b4c0, [90, 0, 0]);
  const usb = addOutlinedBox(scene, devices.usb.size as VectorTuple, devices.usb.position as VectorTuple, 0x343b3e, { componentId: "usb", pickables, outline: 0x14191b });
  [-0.022, 0, 0.022].forEach((x) => addOutlinedBox(usb, [0.012, 0.016, 0.005], [x, 0, 0.023], 0xbcc8c7, { outline: 0x687270 }));
  addTerminalBusbar(scene, devices.earthBar.position as VectorTuple, COLORS.earth, "earth", pickables, 7);

  // These two front faces are routing obstacles. Every modeled lead approaches
  // a registered edge port, so no cable is allowed to cross the display or the
  // UniFi enclosure simply because it is shorter in projection.
  registerCableObstacle(
    scene,
    "ekrano-front",
    devices.ekran.position as VectorTuple,
    devices.ekran.size as VectorTuple,
    [
      DEVICE_PORTS.ekran.powerPositive,
      DEVICE_PORTS.ekran.powerNegative,
      DEVICE_PORTS.ekran.veDirect,
      DEVICE_PORTS.ekran.veCan,
      DEVICE_PORTS.ekran.veBus,
      DEVICE_PORTS.ekran.ethernet,
      DEVICE_PORTS.ekran.earth,
    ].map((center) => ({ axis: "z" as const, center, radius: 0.012 })),
  );
  registerCableObstacle(
    scene,
    "unifi-front",
    devices.unifi.position as VectorTuple,
    devices.unifi.size as VectorTuple,
    [DEVICE_PORTS.unifi.power, DEVICE_PORTS.unifi.wan, DEVICE_PORTS.unifi.lan]
      .map((center) => ({ axis: "z" as const, center, radius: 0.014 })),
  );

  [
    [DEVICE_PORTS.smartSolar.pvPositive, COLORS.red],
    [DEVICE_PORTS.smartSolar.pvNegative, COLORS.black],
    [DEVICE_PORTS.smartSolar.batteryPositive, COLORS.red],
    [DEVICE_PORTS.smartSolar.batteryNegative, COLORS.black],
  ].forEach(([position, color]) => addFrontTerminal(scene, position as VectorTuple, color as number));
  [
    [DEVICE_PORTS.multiPlus.dcPositive, COLORS.red],
    [DEVICE_PORTS.multiPlus.dcNegative, COLORS.black],
    [DEVICE_PORTS.multiPlus.acInputCable, COLORS.threeCoreAc],
    [DEVICE_PORTS.multiPlus.acOutputCable, COLORS.threeCoreAc],
  ].forEach(([position, color]) => addFrontTerminal(scene, position as VectorTuple, color as number, 0.006));
  [
    [DEVICE_PORTS.orion.inputPositive, COLORS.red],
    [DEVICE_PORTS.orion.inputNegative, COLORS.black],
    [DEVICE_PORTS.orion.outputPositive, COLORS.red],
    [DEVICE_PORTS.orion.outputNegative, COLORS.black],
  ].forEach(([position, color]) => addFrontTerminal(scene, position as VectorTuple, color as number, 0.006));
  [devices.balancerA, devices.balancerB].forEach((balancer) => {
    [-0.04, 0, 0.04].forEach((offset, index) => addFrontTerminal(
      scene,
      [balancer.position[0] + offset, balancer.position[1] - balancer.size[1] / 2 - 0.006, balancer.position[2] + balancer.size[2] / 2 + 0.006],
      [COLORS.red, COLORS.yellow, COLORS.black][index],
      0.0045,
    ));
  });

  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.unifi.power, 0xadb6b5, { outline: 0x384345 });
  addOutlinedBox(scene, [0.017, 0.009, 0.006], DEVICE_PORTS.unifi.wan, COLORS.blue, { outline: 0x244c71 });
  addOutlinedBox(scene, [0.017, 0.009, 0.006], DEVICE_PORTS.unifi.lan, COLORS.teal, { outline: 0x184d49 });
  addFrontTerminal(scene, DEVICE_PORTS.usb.dcPositive, COLORS.red, 0.0045);
  addFrontTerminal(scene, DEVICE_PORTS.usb.dcNegative, COLORS.black, 0.0045);
  addFrontTerminal(scene, DEVICE_PORTS.ekran.powerPositive, COLORS.red, 0.004);
  addFrontTerminal(scene, DEVICE_PORTS.ekran.powerNegative, COLORS.black, 0.004);
  DEVICE_PORTS.pvEntry.stringInputs.forEach((position, index) => addFrontTerminal(
    scene,
    position,
    index % 2 === 0 ? COLORS.red : COLORS.black,
    0.0045,
  ));
  addFrontTerminal(scene, DEVICE_PORTS.pvEntry.mpptPositive, COLORS.red, 0.0045);
  addFrontTerminal(scene, DEVICE_PORTS.pvEntry.mpptNegative, COLORS.black, 0.0045);
  addFrontTerminal(scene, DEVICE_PORTS.pvEntry.earth, COLORS.earth, 0.0045);
  addFrontTerminal(scene, DEVICE_PORTS.smartSolar.earth, COLORS.earth, 0.0045);
  addFrontTerminal(scene, DEVICE_PORTS.multiPlus.chassisEarth, COLORS.earth, 0.0045);
  addFrontTerminal(scene, DEVICE_PORTS.acBoard.earth, COLORS.earth, 0.0045);
  addFrontTerminal(scene, DEVICE_PORTS.ekran.earth, COLORS.earth, 0.0042);
  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.ekran.veDirect, COLORS.orange, { outline: 0x8f641f });
  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.ekran.veCan, COLORS.blue, { outline: 0x244c71 });
  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.ekran.veBus, COLORS.blue, { outline: 0x244c71 });
  addOutlinedBox(scene, [0.017, 0.009, 0.006], DEVICE_PORTS.ekran.ethernet, COLORS.blue, { outline: 0x244c71 });
}

function addAcAndGenerator(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  addGenerator(scene, pickables);
  const devices = physicalLayout.devices;
  addProtectionBox(scene, "generatorInput", devices.generatorInlet.position as VectorTuple, pickables, devices.generatorInlet.size as VectorTuple);
  const socket = addOutlinedBox(scene, devices.trailingSocket.size as VectorTuple, devices.trailingSocket.position as VectorTuple, 0x303638, { componentId: "toolOutlet", pickables, outline: 0x151a1c, rotation: [0, -18, 0] });
  addCylinder(socket, 0.01, 0.006, [-0.018, 0.015, 0.039], 0xd7ddd9, [90, 0, 0]);
  addCylinder(socket, 0.01, 0.006, [0.018, 0.015, 0.039], 0xd7ddd9, [90, 0, 0]);
  addOrthogonalCable(scene, physicalLayout.routes["trailing-tool-flex"].points as VectorTuple[], COLORS.threeCoreAc, physicalLayout.routes["trailing-tool-flex"].radiusM);

  addOrthogonalCable(scene, physicalLayout.routes["generator-flex"].points as VectorTuple[], COLORS.threeCoreAc, physicalLayout.routes["generator-flex"].radiusM);
  addFrontTerminal(scene, DEVICE_PORTS.generatorInlet.acCable, COLORS.threeCoreAc, 0.009);
  addFrontTerminal(scene, DEVICE_PORTS.acBoard.acCable, COLORS.threeCoreAc, 0.009);
  ["generator-inlet-to-multiplus-ac", "multiplus-to-ac-output-protection"].forEach((id) => {
    const route = physicalLayout.routes[id];
    addOrthogonalCable(
      scene,
      route.points as VectorTuple[],
      COLORS.threeCoreAc,
      route.radiusM,
      "context",
      false,
    );
  });
}

function addLights(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const positions: VectorTuple[] = [
    [2.25, 2.92, -0.75], [4.1, 2.92, -0.75], [5.95, 2.92, -0.75],
    [2.25, 2.92, 0.8], [4.1, 2.92, 0.8], [5.95, 2.92, 0.8],
  ];
  positions.forEach((position) => {
    const fixture = addOutlinedBox(scene, [0.52, 0.035, 0.075], position, 0xfff3c3, { componentId: "lights", pickables, outline: 0xa69d75 });
    const glow = new THREE.PointLight(0xffe0a1, 0.35, 2.3, 2);
    glow.position.set(position[0], position[1] - 0.05, position[2]);
    fixture.add(glow);
  });
}

function addBatterySystem(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const devices = physicalLayout.devices;
  ["battery1", "battery2", "battery3", "battery4"].forEach((id) => {
    addBattery(scene, id, devices[id].position as VectorTuple, pickables);
  });
  addProtectionBox(scene, "mainDc", devices.classTA.position as VectorTuple, pickables, devices.classTA.size as VectorTuple);
  addProtectionBox(scene, "mainDc", devices.classTB.position as VectorTuple, pickables, devices.classTB.size as VectorTuple);
  Object.values(DEVICE_PORTS.classT).forEach((position) => addFrontTerminal(scene, position, COLORS.red, 0.007));

  const ports = physicalLayout.ports;
  const batteryTerminals = ["aNegative", "aMidLeft", "aMidRight", "aPositive", "bNegative", "bMidLeft", "bMidRight", "bPositive"];
  batteryTerminals.forEach((id) => addFrontTerminal(scene, ports[id] as VectorTuple, id.includes("Negative") ? COLORS.black : COLORS.red, 0.008));
  ["battery-series-a", "battery-series-b", "battery-a-to-class-t", "battery-b-to-class-t"].forEach((id) => {
    addOrthogonalCable(scene, physicalLayout.routes[id].points as VectorTuple[], COLORS.red, physicalLayout.routes[id].radiusM);
  });

  const positiveA = wallPathFromPenetration(scene, JUNCTION_PORTS.batteryPosA, [[3.31, 0.82], [DEVICE_PORTS.classT.stringAOutput[0], 0.82]], DEVICE_PORTS.classT.stringAOutput, 0.0085);
  const positiveB = wallPathFromPenetration(scene, JUNCTION_PORTS.batteryPosB, [[3.342, 0.88], [DEVICE_PORTS.classT.stringBOutput[0], 0.88]], DEVICE_PORTS.classT.stringBOutput, 0.0085);
  const negativeA = [
    ...wallPathFromPenetration(scene, JUNCTION_PORTS.batteryNegA, [[3.374, 0.78], [2.78, 0.78]], [2.78, 0.28, -1.96], 0.0085),
    [2.78, 0.28, ports.aNegative[2]] as VectorTuple,
    ports.aNegative as VectorTuple,
  ];
  const negativeB = [
    ...wallPathFromPenetration(scene, JUNCTION_PORTS.batteryNegB, [[3.406, 0.84], [2.73, 0.84]], [2.73, 0.24, -1.94], 0.0085),
    [2.73, 0.24, ports.bNegative[2]] as VectorTuple,
    ports.bNegative as VectorTuple,
  ];

  [
    [JUNCTION_PORTS.batteryPosA, [[3.305, 1.605, JUNCTION_FRONT_INTERNAL_Z], [3.305, 1.605, JUNCTION_WIRE_Z], JUNCTION_PORTS.batteryPosA.terminal], positiveA, COLORS.red],
    [JUNCTION_PORTS.batteryPosB, [[3.335, 1.597, JUNCTION_FRONT_INTERNAL_Z], [3.335, 1.597, JUNCTION_WIRE_Z], JUNCTION_PORTS.batteryPosB.terminal], positiveB, COLORS.red],
    [JUNCTION_PORTS.batteryNegA, [[3.352, 1.748, JUNCTION_WIRE_Z], [3.32, 1.748, JUNCTION_WIRE_Z], [3.32, 1.584, JUNCTION_WIRE_Z], JUNCTION_PORTS.batteryNegA.terminal], negativeA, COLORS.black],
    [JUNCTION_PORTS.batteryNegB, [[3.352, 1.748, JUNCTION_WIRE_Z + 0.008], [3.33, 1.748, JUNCTION_WIRE_Z + 0.008], [3.33, 1.584, JUNCTION_WIRE_Z + 0.008], JUNCTION_PORTS.batteryNegB.terminal], negativeB, COLORS.black],
  ].forEach(([penetration, inside, outside, color]) => addContinuousJunctionCable(
    scene,
    inside as VectorTuple[],
    penetration as JunctionPenetration,
    outside as VectorTuple[],
    color as number,
    0.0085,
  ));

  addContinuousJunctionCable(
    scene,
    [[3.509, 1.775, JUNCTION_WIRE_Z], [3.509, 1.716, JUNCTION_WIRE_Z + 0.024], [3.598, 1.716, JUNCTION_WIRE_Z + 0.024], JUNCTION_PORTS.multiplusPos.terminal],
    JUNCTION_PORTS.multiplusPos,
    physicalLayout.routes["junction-to-multiplus-positive"].points.slice(1) as VectorTuple[],
    COLORS.red,
    0.0085,
  );
  addContinuousJunctionCable(
    scene,
    [[3.509, 1.735, JUNCTION_WIRE_Z], [3.509, 1.682, JUNCTION_WIRE_Z + 0.034], [3.598, 1.682, JUNCTION_WIRE_Z + 0.034], JUNCTION_PORTS.multiplusNeg.terminal],
    JUNCTION_PORTS.multiplusNeg,
    physicalLayout.routes["junction-to-multiplus-negative"].points.slice(1) as VectorTuple[],
    COLORS.black,
    0.0085,
  );

  const balancers = [devices.balancerA, devices.balancerB];
  const stringPorts = [
    [ports.aPositive, ports.aMidLeft, ports.aNegative],
    [ports.bPositive, ports.bMidLeft, ports.bNegative],
  ] as VectorTuple[][];
  balancers.forEach((balancer, stringIndex) => {
    [-0.04, 0, 0.04].forEach((offset, leadIndex) => {
      const start: VectorTuple = [balancer.position[0] + offset, balancer.position[1] - balancer.size[1] / 2 - 0.006, balancer.position[2] + balancer.size[2] / 2 + 0.006];
      const end = stringPorts[stringIndex][leadIndex];
      const routeIndex = stringIndex * 3 + leadIndex;
      // Positives stay outside the right edge, midpoint yellows use the clear
      // central channel, and negatives use the left channel. Keeping those
      // domains disjoint prevents the former yellow/red crossing on the right.
      const sideX = leadIndex === 0
        ? 4.18 + stringIndex * 0.07
        : leadIndex === 1
          ? 3.54 + stringIndex * 0.045
          : 2.62 - stringIndex * 0.055;
      const laneY = leadIndex === 2
        ? 0.42 - stringIndex * 0.045
        : start[1] - 0.045 - routeIndex * 0.022;
      const lowerY = 0.285 + routeIndex * 0.009;
      const preferredPlane = leadIndex === 1
        ? 0.072 + stringIndex * 0.014
        : 0.012 + routeIndex * 0.009;
      addOrthogonalCable(scene, wallRoutedPoints(scene, start, [[start[0], laneY], [sideX, laneY], [sideX, lowerY]], [sideX, lowerY, -1.92], 0.0035, preferredPlane).concat([
        [sideX, lowerY, end[2]],
        end,
      ]), [COLORS.red, COLORS.yellow, COLORS.black][leadIndex], 0.0035, "context", false);
    });
  });
}

function addPvWiring(scene: THREE.Scene) {
  addCable(scene, [[-0.581, 0.555, -1.18], [-0.55, 0.63, -1.18], [-0.519, 0.575, -1.18]], COLORS.red, 0.006);
  addCable(scene, [[-0.581, 0.555, 1.18], [-0.55, 0.63, 1.18], [-0.519, 0.575, 1.18]], COLORS.red, 0.006);

  const pvRoutes: Array<[string, number]> = [
    ["pv-string-a-positive", COLORS.red],
    ["pv-string-a-negative", COLORS.black],
    ["pv-string-b-positive", COLORS.red],
    ["pv-string-b-negative", COLORS.black],
    ["pv-home-run-a-positive", COLORS.red],
    ["pv-home-run-a-negative", COLORS.black],
    ["pv-home-run-b-positive", COLORS.red],
    ["pv-home-run-b-negative", COLORS.black],
    ["pv-entry-to-mppt-positive", COLORS.red],
    ["pv-entry-to-mppt-negative", COLORS.black],
  ];
  pvRoutes.forEach(([id, color]) => addOrthogonalCable(
    scene,
    physicalLayout.routes[id].points as VectorTuple[],
    color,
    physicalLayout.routes[id].radiusM,
    "context",
    false,
  ));

  addContinuousJunctionCable(
    scene,
    [[3.601, 1.797, JUNCTION_WIRE_Z], [3.608, 1.797, JUNCTION_WIRE_Z], [3.608, 1.772, JUNCTION_WIRE_Z], JUNCTION_PORTS.mpptPos.terminal],
    JUNCTION_PORTS.mpptPos,
    physicalLayout.routes["junction-to-mppt-positive"].points.slice(1) as VectorTuple[],
    COLORS.red,
    0.0065,
  );
  addContinuousJunctionCable(
    scene,
    [[3.536, 1.735, JUNCTION_WIRE_Z], [3.536, 1.746, JUNCTION_WIRE_Z], JUNCTION_PORTS.mpptNeg.terminal],
    JUNCTION_PORTS.mpptNeg,
    physicalLayout.routes["junction-to-mppt-negative"].points.slice(1) as VectorTuple[],
    COLORS.black,
    0.0065,
  );
}

function addDcLoadsAndData(scene: THREE.Scene) {
  const orionFrontPath = (
    penetration: JunctionPenetration,
    destination: VectorTuple,
    radius: number,
    lane: number,
  ): VectorTuple[] => {
    const frontZ = JUNCTION_FRONT_CABLE_Z + 0.1 + lane * (radius * 2 + 0.007);
    const escapeX = JUNCTION_RIGHT_X + 0.042 + lane * 0.014;
    const approachY = JUNCTION_BOTTOM_Y - 0.055 - lane * 0.032;
    return [
      [penetration.outside[0], penetration.outside[1], frontZ],
      [escapeX, penetration.outside[1], frontZ],
      [escapeX, approachY, frontZ],
      [destination[0], approachY, frontZ],
      [destination[0], destination[1], frontZ],
      destination,
    ];
  };

  addContinuousJunctionCable(
    scene,
    [[3.606, 1.755, JUNCTION_WIRE_Z], [3.57, 1.755, JUNCTION_WIRE_Z + 0.052], [3.57, 1.652, JUNCTION_WIRE_Z + 0.052], [3.598, 1.652, JUNCTION_WIRE_Z + 0.052], JUNCTION_PORTS.orion24Pos.terminal],
    JUNCTION_PORTS.orion24Pos,
    orionFrontPath(JUNCTION_PORTS.orion24Pos, DEVICE_PORTS.orion.inputPositive, 0.0055, 0),
    COLORS.red,
    0.0055,
    false,
  );
  addContinuousJunctionCable(
    scene,
    [[3.563, 1.735, JUNCTION_WIRE_Z], [3.552, 1.735, JUNCTION_WIRE_Z + 0.064], [3.552, 1.627, JUNCTION_WIRE_Z + 0.064], [3.598, 1.627, JUNCTION_WIRE_Z + 0.064], JUNCTION_PORTS.orion24Neg.terminal],
    JUNCTION_PORTS.orion24Neg,
    orionFrontPath(JUNCTION_PORTS.orion24Neg, DEVICE_PORTS.orion.inputNegative, 0.0055, 1),
    COLORS.black,
    0.0055,
    false,
  );
  addContinuousJunctionCable(
    scene,
    [[3.607, 1.665, JUNCTION_WIRE_Z], [3.607, 1.665, JUNCTION_WIRE_Z + 0.1], [3.535, 1.665, JUNCTION_WIRE_Z + 0.1], [3.535, 1.603, JUNCTION_WIRE_Z + 0.1], [3.598, 1.603, JUNCTION_WIRE_Z + 0.1], JUNCTION_PORTS.orion12Pos.terminal],
    JUNCTION_PORTS.orion12Pos,
    orionFrontPath(JUNCTION_PORTS.orion12Pos, DEVICE_PORTS.orion.outputPositive, 0.0048, 2),
    COLORS.red,
    0.0048,
    false,
  );
  addContinuousJunctionCable(
    scene,
    [[3.59, 1.591, JUNCTION_WIRE_Z], [3.59, 1.582, JUNCTION_WIRE_Z], JUNCTION_PORTS.orion12Neg.terminal],
    JUNCTION_PORTS.orion12Neg,
    orionFrontPath(JUNCTION_PORTS.orion12Neg, DEVICE_PORTS.orion.outputNegative, 0.0048, 3),
    COLORS.black,
    0.0048,
    false,
  );

  const loadRadii = [0.0045, 0.0042, 0.0045];
  const fuseOutputs = [3.4675, 3.4885, 3.5095];
  const returnStuds = [3.467, 3.488, 3.509];
  const positiveExteriors: VectorTuple[][] = [
    [
      ...wallPathFromPenetrationToDeparture(
        scene,
        JUNCTION_PORTS.loadPos[0],
        [[3.438, 1.32], [DEVICE_PORTS.starlink.powerPositive[0], 1.32], [DEVICE_PORTS.starlink.powerPositive[0], STARLINK_CEILING_Y]],
        loadRadii[0],
      ),
      [DEVICE_PORTS.starlink.powerPositive[0], STARLINK_CEILING_Y, DEVICE_PORTS.starlink.powerPositive[2]],
      DEVICE_PORTS.starlink.powerPositive,
    ],
    wallPathFromPenetration(scene, JUNCTION_PORTS.loadPos[1], [[3.482, 1.36], [DEVICE_PORTS.usb.dcPositive[0], 1.36]], DEVICE_PORTS.usb.dcPositive, loadRadii[1]),
    [
      ...wallPathFromPenetrationToDeparture(scene, JUNCTION_PORTS.loadPos[2], [[3.526, 1.4], [5.58, 1.4], [5.58, LIGHTING_TRUNK_Y]], loadRadii[2]),
      [5.58, LIGHTING_TRUNK_Y, 0.94],
      [2.15, LIGHTING_TRUNK_Y, 0.94],
      [2.15, LIGHTING_TRUNK_Y, -0.9],
      [5.95, LIGHTING_TRUNK_Y, -0.9],
    ],
  ];
  const negativeExteriors: VectorTuple[][] = [
    [
      ...wallPathFromPenetrationToDeparture(
        scene,
        JUNCTION_PORTS.loadNeg[0],
        [[3.46, 1.34], [DEVICE_PORTS.starlink.powerNegative[0], 1.34], [DEVICE_PORTS.starlink.powerNegative[0], STARLINK_CEILING_Y - 0.03]],
        loadRadii[0],
      ),
      [DEVICE_PORTS.starlink.powerNegative[0], STARLINK_CEILING_Y - 0.03, DEVICE_PORTS.starlink.powerNegative[2]],
      DEVICE_PORTS.starlink.powerNegative,
    ],
    wallPathFromPenetration(scene, JUNCTION_PORTS.loadNeg[1], [[3.504, 1.38], [DEVICE_PORTS.usb.dcNegative[0], 1.38]], DEVICE_PORTS.usb.dcNegative, loadRadii[1]),
    [
      ...wallPathFromPenetrationToDeparture(scene, JUNCTION_PORTS.loadNeg[2], [[3.548, 1.42], [5.61, 1.42], [5.61, LIGHTING_TRUNK_Y - 0.03]], loadRadii[2]),
      [5.61, LIGHTING_TRUNK_Y - 0.03, 0.98],
      [2.11, LIGHTING_TRUNK_Y - 0.03, 0.98],
      [2.11, LIGHTING_TRUNK_Y - 0.03, -0.94],
      [5.95, LIGHTING_TRUNK_Y - 0.03, -0.94],
    ],
  ];

  loadRadii.forEach((radius, index) => {
    const positivePort = JUNCTION_PORTS.loadPos[index];
    const negativePort = JUNCTION_PORTS.loadNeg[index];
    addContinuousJunctionCable(
      scene,
      [[fuseOutputs[index], 1.632, JUNCTION_WIRE_Z], [fuseOutputs[index], 1.605, JUNCTION_WIRE_Z], [positivePort.terminal[0], 1.605, JUNCTION_WIRE_Z], positivePort.terminal],
      positivePort,
      positiveExteriors[index],
      COLORS.red,
      radius,
    );
    addContinuousJunctionCable(
      scene,
      [[returnStuds[index], 1.586, JUNCTION_WIRE_Z + 0.012], [negativePort.terminal[0], 1.586, JUNCTION_WIRE_Z + 0.012], negativePort.terminal],
      negativePort,
      negativeExteriors[index],
      COLORS.black,
      radius,
    );
  });

  addOrthogonalCable(
    scene,
    physicalLayout.routes["starlink-to-unifi-data"].points as VectorTuple[],
    COLORS.blue,
    physicalLayout.routes["starlink-to-unifi-data"].radiusM,
    "context",
    false,
  );
  addWallRoutedCable(scene, DEVICE_PORTS.unifi.lan, [[DEVICE_PORTS.unifi.lan[0], 1.93], [DEVICE_PORTS.ekran.ethernet[0], 1.93]], DEVICE_PORTS.ekran.ethernet, 0x3f7cb8, 0.0032, "context", 0.075);
  addWallRoutedCable(
    scene,
    [physicalLayout.devices.smartSolar.position[0] + 0.08, physicalLayout.devices.smartSolar.position[1] + 0.1, DEVICE_PORTS.smartSolar.pvPositive[2]],
    [[2.3, 0.65], [2.3, 2.25], [3.3, 2.25], [3.3, 1.89], [DEVICE_PORTS.ekran.veCan[0], 1.89]],
    DEVICE_PORTS.ekran.veCan,
    0x3f7cb8,
    0.0032,
    "context",
    0.09,
  );
  addWallRoutedCable(
    scene,
    [physicalLayout.devices.multiPlus.position[0] + 0.1, physicalLayout.devices.multiPlus.position[1], DEVICE_PORTS.multiPlus.dcPositive[2]],
    [[2.32, 1.92], [2.32, 2.21], [3.32, 2.21], [3.32, 1.87], [DEVICE_PORTS.ekran.veBus[0], 1.87]],
    DEVICE_PORTS.ekran.veBus,
    0x3f7cb8,
    0.0032,
    "context",
    0.105,
  );
  addWallRoutedCable(scene, DEVICE_PORTS.usb.reservedUsbC, [[DEVICE_PORTS.usb.reservedUsbC[0], 1.91], [DEVICE_PORTS.unifi.power[0], 1.91]], DEVICE_PORTS.unifi.power, 0x343a3d, 0.0035, "context", 0.085);
}

function addEarthing(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const stake = addCylinder(scene, 0.025, 1.1, [0.72, -0.38, -2.58], COLORS.copper);
  stake.userData.componentId = "earth";
  pickables.push(stake);
  addOutlinedBox(scene, [0.34, 0.035, 0.34], [0.72, 0.015, -2.58], 0x8a7258, { componentId: "earth", pickables, outline: 0x5e4c3c });
  addFrontTerminal(scene, physicalLayout.ports.earthElectrode as VectorTuple, COLORS.earth, 0.0055);
  addFrontTerminal(scene, physicalLayout.ports.arrayFrameEarth as VectorTuple, COLORS.earth, 0.0055);
  Object.values(physicalLayout.routes)
    .filter((route) => route.kind === "earth")
    .forEach((route) => addOrthogonalCable(
      scene,
      route.points as VectorTuple[],
      COLORS.earth,
      route.radiusM,
      "context",
      false,
    ));
}

function resolveLabelPositions(
  scene: THREE.Scene,
  pickables: THREE.Object3D[],
) {
  scene.updateMatrixWorld(true);
  const roots = new Set<THREE.Object3D>();
  pickables.forEach((object) => {
    const componentId = object.userData.componentId as string | undefined;
    if (!componentId) return;
    let root = object;
    while (
      root.parent &&
      root.parent !== scene &&
      root.parent.userData.componentId === componentId
    ) root = root.parent;
    roots.add(root);
  });
  const candidates = [...roots].flatMap((root) => {
    const componentId = root.userData.componentId as string | undefined;
    if (!componentId) return [];
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return [];
    return [{ componentId, center: box.getCenter(new THREE.Vector3()) }];
  });
  return new Map(MODEL_LABELS.map((label) => {
    const fallback = vector(label.position);
    const matching = candidates
      .filter((candidate) => candidate.componentId === label.componentId)
      .sort((first, second) => (
        first.center.distanceToSquared(fallback) - second.center.distanceToSquared(fallback)
      ));
    return [label.id, matching[0]?.center.clone() ?? fallback] as const;
  }));
}

function buildDseScene(scene: THREE.Scene) : SceneBuild {
  const pickables: THREE.Object3D[] = [];
  addBuilding(scene, pickables);
  addArrayStructure(scene, pickables);
  addStarlink(scene, pickables);
  addWallEquipment(scene, pickables);
  addJunctionBox(scene, pickables);
  addBatterySystem(scene, pickables);
  addAcAndGenerator(scene, pickables);
  addLights(scene, pickables);
  addPvWiring(scene);
  addDcLoadsAndData(scene);
  addEarthing(scene, pickables);

  const grid = new THREE.GridHelper(12, 24, 0x98a19c, 0xc7cbc4);
  grid.position.set(1.2, 0.011, 0);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((gridMaterial) => {
    gridMaterial.opacity = 0.24;
    gridMaterial.transparent = true;
  });
  scene.add(grid);

  const routingReport = {
    ...cableRouter(scene).report(),
    ...wallLanePlanner(scene).report(),
  };
  return {
    labelPositions: resolveLabelPositions(scene, pickables),
    pickables,
    routingReport,
  };
}

function DseModel({
  onSelect,
}: {
  onSelect: (componentId: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLElement>());
  const cameraActionRef = useRef<(preset: CameraPreset) => void>(() => undefined);
  const [activePreset, setActivePreset] = useState<CameraPreset["id"]>("site");
  const [labelsVisible, setLabelsVisible] = useState(false);
  const [showScaleNotes, setShowScaleNotes] = useState(false);
  const [hovered, setHovered] = useState("Drag to orbit · right/shift-drag to pan · touch: one finger orbit, two fingers pan / pinch");
  const [ready, setReady] = useState(false);
  const [routingReport, setRoutingReport] = useState<CableRoutingReport | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const mountElement = mount;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f1e9);
    scene.fog = new THREE.Fog(0xf3f1e9, 22, 41);
    const camera = new THREE.PerspectiveCamera(39, 1, 0.02, 70);
    camera.position.set(...CAMERA_PRESETS[0].position);
    camera.lookAt(vector(CAMERA_PRESETS[0].target));

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "Interactive true-scale three-dimensional model of the Drua Sailing Experience solar installation");
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.style.cursor = "grab";
    mountElement.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe9f3f2, 0x887c63, 2.15));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(-6, 12, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -5;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 35;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.015;
    sun.shadow.radius = 1.5;
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xaac8d4, 0.65);
    fill.position.set(8, 4, -8);
    scene.add(fill);

    const { labelPositions, pickables, routingReport: sceneRoutingReport } = buildDseScene(scene);
    setRoutingReport(sceneRoutingReport);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const cameraPickables: THREE.Mesh[] = [];
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) cameraPickables.push(object);
    });
    const hoverHelper = new THREE.BoxHelper(new THREE.Object3D(), COLORS.orange);
    hoverHelper.visible = false;
    hoverHelper.material.depthTest = false;
    hoverHelper.renderOrder = 20;
    scene.add(hoverHelper);
    let hoveredId: string | null = null;
    let pointerStart = { x: 0, y: 0 };
    const activeTouchPointers = new Set<number>();
    let touchWasMultiPointer = false;
    let cameraGoal = {
      position: vector(CAMERA_PRESETS[0].position),
      target: vector(CAMERA_PRESETS[0].target),
      quaternion: camera.quaternion.clone(),
      active: false,
      startedAt: 0,
    };

    function setPointer(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    }

    function cameraSurfaceAt(clientX: number, clientY: number) {
      setPointer(clientX, clientY);
      const intersection = raycaster.intersectObjects(cameraPickables, false).find(({ object }) => {
        if (!(object instanceof THREE.Mesh) || !object.visible) return false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        return materials.some((item) => item.visible && item.opacity > 0.04 && item.depthWrite);
      });
      return intersection ? { point: intersection.point.clone() } : null;
    }

    const grabControls = new GrabPointCameraControls({
      camera,
      domElement: renderer.domElement,
      pickSurface: cameraSurfaceAt,
      onInteractionStart: () => {
        cameraGoal.active = false;
      },
    });
    grabControls.setFocusPoint(vector(CAMERA_PRESETS[0].target));
    grabControls.syncFallbackDepth();

    function componentRoot(object: THREE.Object3D) {
      let current: THREE.Object3D | null = object;
      while (current?.parent && current.parent !== scene && current.parent.userData.componentId === current.userData.componentId) {
        current = current.parent;
      }
      return current;
    }

    function hitAt(event: PointerEvent) {
      setPointer(event.clientX, event.clientY);
      return raycaster.intersectObjects(pickables, false)[0]?.object ?? null;
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      if (event.buttons !== 0) return;
      const object = hitAt(event);
      const componentId = object?.userData.componentId as string | undefined;
      renderer.domElement.style.cursor = componentId ? "pointer" : "grab";
      if (componentId === hoveredId) return;
      hoveredId = componentId ?? null;
      if (object && componentId) {
        const root = componentRoot(object);
        if (root) hoverHelper.setFromObject(root);
        hoverHelper.visible = true;
        const label = MODEL_LABELS.find((item) => item.componentId === componentId)?.label ?? componentId;
        setHovered(`${label} · click for design values`);
      } else {
        hoverHelper.visible = false;
        setHovered("Drag to orbit · right/shift-drag to pan · touch: one finger orbit, two fingers pan / pinch");
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType === "touch") {
        activeTouchPointers.add(event.pointerId);
        touchWasMultiPointer ||= activeTouchPointers.size > 1;
        if (activeTouchPointers.size === 1) pointerStart = { x: event.clientX, y: event.clientY };
        cameraGoal.active = false;
        return;
      }
      pointerStart = { x: event.clientX, y: event.clientY };
      cameraGoal.active = false;
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.pointerType === "touch") {
        activeTouchPointers.delete(event.pointerId);
        if (touchWasMultiPointer) {
          if (activeTouchPointers.size === 0) touchWasMultiPointer = false;
          return;
        }
      }
      if (event.button !== 0 || event.shiftKey) return;
      const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      if (moved > 5) return;
      const object = hitAt(event);
      const componentId = object?.userData.componentId as string | undefined;
      if (componentId) onSelect(componentId);
    }

    function handlePointerCancel(event: PointerEvent) {
      if (event.pointerType !== "touch") return;
      activeTouchPointers.delete(event.pointerId);
      if (activeTouchPointers.size === 0) touchWasMultiPointer = false;
    }

    function preventCanvasMenu(event: MouseEvent) {
      event.preventDefault();
    }

    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    renderer.domElement.addEventListener("contextmenu", preventCanvasMenu);

    cameraActionRef.current = (preset) => {
      const isolateJunction = preset.id === "junction";
      const junctionComponentIds = new Set(["mounting", "systemMonitor", "batterySelector", "mainDc", "fuseBlock"]);
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
        const componentId = object.userData.componentId as string | undefined;
        const isExternalComponent = Boolean(componentId && !junctionComponentIds.has(componentId));
        const isContextCable = object.userData.modelCable === "context";
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((objectMaterial) => {
          if (objectMaterial.userData.modelBaseOpacity === undefined) {
            objectMaterial.userData.modelBaseOpacity = objectMaterial.opacity;
          }
          const baseOpacity = objectMaterial.userData.modelBaseOpacity as number;
          const fadeForFocus = isolateJunction && (isContextCable || isExternalComponent);
          objectMaterial.opacity = fadeForFocus ? Math.min(baseOpacity, isContextCable ? 0.2 : 0.12) : baseOpacity;
          objectMaterial.transparent = objectMaterial.opacity < 1;
          objectMaterial.depthWrite = objectMaterial.opacity >= 0.5;
          objectMaterial.needsUpdate = true;
        });
      });
      cameraGoal = {
        position: vector(preset.position),
        target: vector(preset.target),
        quaternion: new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(
            vector(preset.position),
            vector(preset.target),
            new THREE.Vector3(0, 1, 0),
          ),
        ),
        active: true,
        startedAt: performance.now(),
      };
    };

    function resize() {
      const width = mountElement.clientWidth;
      const height = mountElement.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(mountElement);
    resize();

    const projected = new THREE.Vector3();
    let frame = 0;
    function animate() {
      frame = requestAnimationFrame(animate);
      if (cameraGoal.active) {
        camera.position.lerp(cameraGoal.position, 0.2);
        camera.quaternion.slerp(cameraGoal.quaternion, 0.2);
        grabControls.focusPoint.lerp(cameraGoal.target, 0.2);
        if (
          performance.now() - cameraGoal.startedAt > 650 ||
          camera.position.distanceTo(cameraGoal.position) < 0.015 &&
          grabControls.focusPoint.distanceTo(cameraGoal.target) < 0.015 &&
          camera.quaternion.angleTo(cameraGoal.quaternion) < 0.002
        ) {
          camera.position.copy(cameraGoal.position);
          camera.quaternion.copy(cameraGoal.quaternion);
          grabControls.setFocusPoint(cameraGoal.target);
          grabControls.syncFallbackDepth();
          cameraGoal.active = false;
        }
      }
      grabControls.writeDiagnostics(mountElement);
      MODEL_LABELS.forEach((label) => {
        const element = labelRefs.current.get(label.id);
        if (!element) return;
        projected.copy(labelPositions.get(label.id) ?? vector(label.position)).project(camera);
        const onScreen = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.16 && Math.abs(projected.y) < 1.12;
        const screenX = (projected.x * 0.5 + 0.5) * mountElement.clientWidth;
        const screenY = (-projected.y * 0.5 + 0.5) * mountElement.clientHeight;
        const labelX = Math.round(Math.min(mountElement.clientWidth - 112, Math.max(112, screenX)));
        const labelY = Math.round(Math.min(mountElement.clientHeight - 42, Math.max(42, screenY)));
        element.style.setProperty("--model-label-x", `${labelX}px`);
        element.style.setProperty("--model-label-y", `${labelY}px`);
        element.dataset.onScreen = onScreen ? "true" : "false";
      });
      renderer.render(scene, camera);
    }
    animate();
    setReady(true);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      grabControls.dispose();
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
      renderer.domElement.removeEventListener("contextmenu", preventCanvasMenu);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((item) => item.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onSelect]);

  function choosePreset(preset: CameraPreset) {
    setActivePreset(preset.id);
    cameraActionRef.current(preset);
  }

  return (
    <section
      className={`model-shell ${labelsVisible ? "labels-visible" : "labels-hidden"} ${activePreset === "junction" ? "junction-focus" : ""}`}
      data-active-model-view={activePreset}
      data-model-ready={ready ? "true" : "false"}
      data-routing-backtracking-corners={routingReport?.backtrackingCorners ?? "pending"}
      data-routing-discontinuous-handoffs={routingReport?.discontinuousHandoffs ?? "pending"}
      data-routing-obstacle-intersections={routingReport?.obstacleIntersections ?? "pending"}
      data-routing-board-conflicts={routingReport?.boardLaneConflicts ?? "pending"}
      data-routing-board-lanes={routingReport?.boardLaneCount ?? "pending"}
      data-routing-report={routingReport ? JSON.stringify(routingReport) : "pending"}
      data-routing-unresolved-crossings={routingReport?.unresolvedCableIntersections ?? "pending"}
      data-layout-battery-arrangement={physicalLayout.constraints.batteryArrangement}
      data-layout-junction-back-routes={physicalLayout.metrics.junctionBackRouteCount}
      data-layout-roof-planes={physicalLayout.surfaces.roofPlanes.length}
      data-layout-side-walls={physicalLayout.surfaces.sideWalls.length}
      data-layout-solver-route-count={physicalLayout.metrics.solverRouteCount}
      data-layout-generated-cable-m={physicalLayout.metrics.totalRenderedCableM}
      data-layout-wall-overlaps={physicalLayout.metrics.wallOverlapCount}
      data-layout-wall-span-m={physicalLayout.metrics.wallDeviceSpanM}
      data-shadow-map-size="4096"
    >
      <div className="model-toolbar">
        <div className="model-view-buttons" aria-label="3D camera views">
          {CAMERA_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={activePreset === preset.id ? "active" : ""}
              onClick={() => choosePreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="model-toolbar-meta">
          <button type="button" className={labelsVisible ? "active" : ""} onClick={() => setLabelsVisible((current) => !current)} aria-pressed={labelsVisible}>
            {labelsVisible ? "Hide labels" : "Show labels"}
          </button>
          <button type="button" className={showScaleNotes ? "active" : ""} onClick={() => setShowScaleNotes((current) => !current)} aria-expanded={showScaleNotes}>
            Scale notes
          </button>
          <span>1 unit = 1 m · verified envelopes / assumed site</span>
        </div>
      </div>
      <div className="model-stage">
        <div ref={mountRef} className="model-canvas" />
        <div className="model-label-layer" aria-label="3D model components" aria-hidden={!labelsVisible}>
          {MODEL_LABELS.map((label) => {
            const visibleForView =
              labelsVisible && (label.views?.includes(activePreset) || !label.views);
            const common = {
              className: `model-label ${visibleForView ? "view-visible" : "view-hidden"} ${label.zone ? "zone-label" : ""}`,
              "data-model-label": label.id,
              "data-on-screen": "false",
            };
            return (
              <div
                {...common}
                key={label.id}
                ref={(element) => {
                  if (element) labelRefs.current.set(label.id, element);
                  else labelRefs.current.delete(label.id);
                }}
              >
                <strong>{label.label}</strong>
                <span>{label.detail}</span>
              </div>
            );
          })}
        </div>
        {showScaleNotes && (
          <aside className="model-scale-notes" aria-label="3D model scale notes">
            <div>
              <span>Scale confidence</span>
              <button type="button" onClick={() => setShowScaleNotes(false)} aria-label="Close scale notes">×</button>
            </div>
            <h2>Physical envelopes are separated from site assumptions.</h2>
            <dl>
              <div><dt>Verified</dt><dd>Panels, batteries, MultiPlus, SmartSolar, Ekrano, Orion, balancers, SmartShunt, Starlink and UniFi.</dd></div>
              <div><dt>User-sized</dt><dd>350 × 247 × 150 mm compact junction box.</dd></div>
              <div><dt>Assumed</dt><dd>5.8 m back-wall span, 3.4 × 2.5 m wall board, generator envelope and small protection boxes. Side walls and roof planes are intentionally omitted.</dd></div>
              <div><dt>Layout solver</dt><dd>{physicalLayout.metrics.wallDeviceCount} wall devices occupy a {physicalLayout.metrics.wallDeviceSpanM.toFixed(2)} m span with {physicalLayout.metrics.wallOverlapCount} envelope overlaps. The four batteries form a floor-level 2 × 2 grid. Generated major routes total {physicalLayout.metrics.totalRenderedCableM.toFixed(1)} m before procurement allowances.</dd></div>
              <div><dt>Protective earth</dt><dd>The electrode, array frame and six wall-side bonds terminate at modeled studs. A visible main PE bar replaces the former floating green branch ends.</dd></div>
              <div><dt>Routing</dt><dd>Ordinary power conductors begin about 35 mm off the plywood. Complete board routes receive stable depth lanes. The three GX leads leave the junction top and return to shallow wall lanes immediately; four heavy side leads stay in front of the enclosure, while the adjacent Orion leads take direct short routes. Nothing passes behind the flush-mounted enclosure.</dd></div>
              <div><dt>Geometry</dt><dd>Each cable route is one continuous tube surface, so back-to-back bends share their polygon rings without gaps. Tangent, corner-contained bends cannot curl behind the intended turn. A minimum-conflict greedy planner selects one stable depth lane per board route instead of adding a hump at every crossing.</dd></div>
              <div><dt>Camera</dt><dd>The visible XYZ point below the mouse or touch gesture becomes the grab point. Upright yaw/pitch rotation orbits around it without roll; scrolling or pinching zooms along its camera vector. One finger rotates, while two fingers pan and pinch-zoom at picked depth.</dd></div>
              <div><dt>Routing audit</dt><dd>{routingReport ? `${routingReport.routeCount} route sections · ${routingReport.roundedCorners} rounded bends · ${routingReport.backtrackingCorners} reverse bends · ${routingReport.continuousHandoffs} tangent handoffs · ${routingReport.discontinuousHandoffs} discontinuous handoffs · ${routingReport.boardLaneAssignments} board routes across ${routingReport.boardLaneCount} lanes · ${routingReport.boardLaneConflicts} board-lane conflicts · ${routingReport.obstacleIntersections} solid intersections · ${routingReport.unresolvedCableIntersections} unresolved cable intersections.` : "Checking cable clearances…"}</dd></div>
              <div><dt>Legibility</dt><dd>Small wires are widened slightly. Final bend radii, gland sizing and clearances still require the actual parts and a full-size mock-up.</dd></div>
            </dl>
          </aside>
        )}
        <div className="model-wire-legend" aria-label="Visible conductor colors">
          <span><i className="wire-red" />DC positive</span>
          <span><i className="wire-black" />DC negative</span>
          <span><i className="wire-blue" />Data / control</span>
          <span><i className="wire-green" />Protective earth</span>
          <span><i className="wire-white" />3-core AC flex</span>
        </div>
        <div className="model-status">
          <span>{activePreset === "junction" && hovered.startsWith("Drag") ? "Focus view · surrounding cable runs faded; topology unchanged" : hovered}</span>
          <b>{model.revision}</b>
        </div>
      </div>
    </section>
  );
}

export function SystemModel3D({
  system,
  onSelect,
  onOpenDse,
}: {
  system: PhysicalModelSystem;
  onSelect: (componentId: string) => void;
  onOpenDse: () => void;
}) {
  if (system.id !== "dse") {
    return (
      <section className="model-unavailable">
        <div>
          <span>Physical fit model</span>
          <h1>The measured 3D layout currently represents DSE.</h1>
          <p>The PG installation remains available in its verified diagram and BOM views; it has not been assigned speculative site geometry.</p>
          <button type="button" onClick={onOpenDse}>Open the DSE 3D model</button>
        </div>
      </section>
    );
  }
  return <DseModel onSelect={onSelect} />;
}
