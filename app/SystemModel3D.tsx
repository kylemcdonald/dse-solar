"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import modelRaw from "@/data/dse-model.json";
import voxelRoutingRaw from "@/data/voxel-routing-comparison.json";
import { GrabPointCameraControls } from "@/app/GrabPointCameraControls";
import {
  physicalLayout,
  physicalLayoutOptimization,
} from "@/app/physicalLayout";
import { junctionInteriorRouting } from "@/app/junctionInteriorRouting";
import {
  junctionConnectorTopology,
  physicalConnectorTopology,
  type ConnectorDetails,
} from "@/app/connectorTopology";
import {
  buildRoundedCableGeometry,
  CableRoutingSystem,
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

type StaticPrimitiveBatch = {
  root: THREE.Object3D;
  objects: Array<THREE.Mesh | THREE.LineSegments>;
  matrices: THREE.Matrix4[];
};

type PhysicalModelSystem = {
  id: "dse" | "pg";
  name: string;
};

type CableRoutingVariant = "shared" | "omitted" | "voxel";

type VoxelRoutingDocument = {
  checkedOn: string;
  scope: string;
  voxelAStar: {
    algorithm: string;
    cellSizeM: number;
    failedRouteIds: string[];
    metrics: {
      cableClearanceIssueCount: number;
      deviceFrontViolationCount: number;
      maximumForwardM: number;
      portApproachViolationCount: number;
      roundedDeviceFrontViolationCount: number;
      routeCount: number;
      totalLengthM: number;
      totalTurns: number;
      wallDistanceCostM2: number;
    };
    routingPasses: number;
    routes: Record<string, { id: string; lengthM: number; points: VectorTuple[]; turns: number }>;
  };
  junctionVoxelAStar: {
    algorithm: string;
    cellSizeM: number;
    failedRouteIds: string[];
    metrics: {
      cableClearanceIssueCount: number;
      connectorCollisionCount: number;
      directionReversalCount: number;
      maximumForwardM: number;
      portApproachViolationCount: number;
      protectedFrontViolationCount: number;
      roundedCableClearanceIssueCount: number;
      routeCount: number;
      totalLengthM: number;
      totalTurns: number;
      unrelatedDeviceFrontViolationCount: number;
      wallDistanceCostM2: number;
    };
    routingPasses: number;
    routes: Record<string, {
      from: string;
      id: string;
      kind: "positive" | "negative" | "data";
      lengthM: number;
      points: VectorTuple[];
      radiusM: number;
      to: string;
    }>;
  };
};

const model = modelRaw;
const voxelRouting = voxelRoutingRaw as unknown as VoxelRoutingDocument;
const VOXEL_ROUTE_IDS = new Set(Object.keys(voxelRouting.voxelAStar.routes));
const wallRouteVariant = (routeId: string): CableRoutingVariant => (
  VOXEL_ROUTE_IDS.has(routeId) ? "omitted" : "shared"
);
const PHYSICAL_CONNECTORS = physicalConnectorTopology();
const JUNCTION_CONNECTORS = junctionConnectorTopology();
const CABLE_ROUTERS = new WeakMap<THREE.Object3D, CableRoutingSystem>();
const CABLE_MESH_BATCHES = new WeakMap<THREE.Object3D, Map<string, {
  color: number;
  geometries: THREE.BufferGeometry[];
  routingVariant: CableRoutingVariant;
  visibility: CableVisibility;
}>>();

const FIJI_PANEL_TILT_DEG = 18;
const JUNCTION_INNER_BACK_LOCAL_Z = -0.063;
const JUNCTION_TERMINAL_DEPTH_M = 0.06;
// The selector studs and their short edge-egress leads live behind the rotary
// body. They move forward to the common service plane only after clearing it.
const JUNCTION_SELECTOR_TERMINAL_DEPTH_M = 0.012;
const JUNCTION_CENTER = [...physicalLayout.devices.junction.position] as VectorTuple;
const JUNCTION_WIRE_Z = JUNCTION_CENTER[2] + JUNCTION_INNER_BACK_LOCAL_Z + JUNCTION_TERMINAL_DEPTH_M;
const JUNCTION_TOP_Y = JUNCTION_CENTER[1] + physicalLayout.devices.junction.size[1] / 2;
const JUNCTION_BOTTOM_Y = JUNCTION_CENTER[1] - physicalLayout.devices.junction.size[1] / 2;
const JUNCTION_RIGHT_X = JUNCTION_CENTER[0] + physicalLayout.devices.junction.size[0] / 2;
const JUNCTION_LEFT_X = JUNCTION_CENTER[0] - physicalLayout.devices.junction.size[0] / 2;
const JUNCTION_FOCUS_COMPONENT_IDS = new Set([
  "mounting",
  "systemMonitor",
  "batterySelector",
  "mainDc",
  "fuseBlock",
  "mpptFuse",
  "ekranoFuse",
  "loadSwitches",
]);

type JunctionPenetration = {
  axis: "x" | "y";
  glandCenter: VectorTuple;
  glandId: string;
  glandRadius: number;
  outside: VectorTuple;
  renderGland: boolean;
  terminal: VectorTuple;
  through: VectorTuple[];
};

function bottomJunctionPenetration(
  glandId: string,
  terminalId: string | undefined,
  glandRadius: number,
  renderGland = true,
): JunctionPenetration {
  const gland = junctionInteriorRouting.glands[glandId];
  const xOffset = terminalId ? gland.conductorPoints[terminalId][0] : gland.x;
  const x = JUNCTION_CENTER[0] + xOffset;
  const glandX = JUNCTION_CENTER[0] + gland.x;
  const glandZ = JUNCTION_CENTER[2] + gland.zOffset;
  const terminal: VectorTuple = [x, JUNCTION_BOTTOM_Y + 0.0275, JUNCTION_WIRE_Z];
  const outside: VectorTuple = [x, JUNCTION_BOTTOM_Y - 0.0145, glandZ];
  return {
    axis: "y",
    glandCenter: [glandX, JUNCTION_BOTTOM_Y + 0.0075, glandZ],
    glandId,
    glandRadius,
    outside,
    renderGland,
    terminal,
    through: [terminal, [x, JUNCTION_BOTTOM_Y + 0.0275, glandZ], outside],
  };
}

function createJunctionPorts() {
  return {
    batteryPosA: bottomJunctionPenetration("battery-a-positive", "batteryPosA", 0.014),
    batteryPosB: bottomJunctionPenetration("battery-b-positive", "batteryPosB", 0.014),
    batteryNegA: bottomJunctionPenetration("battery-a-negative", "batteryNegA", 0.014),
    batteryNegB: bottomJunctionPenetration("battery-b-negative", "batteryNegB", 0.014),
    mpptPos: bottomJunctionPenetration("mppt-positive", "mpptPos", 0.0105),
    mpptNeg: bottomJunctionPenetration("mppt-negative", "mpptNeg", 0.0105),
    multiplusPos: bottomJunctionPenetration("multiplus-positive", "multiplusPos", 0.014),
    multiplusNeg: bottomJunctionPenetration("multiplus-negative", "multiplusNeg", 0.014),
    ekranPos: bottomJunctionPenetration("ekrano-power", "ekranPos", 0.008),
    ekranNeg: bottomJunctionPenetration("ekrano-power", "ekranNeg", 0.008, false),
    ekranData: bottomJunctionPenetration("ekrano-data", "ekranData", 0.007),
    starlinkCable: bottomJunctionPenetration("starlink-jack", undefined, 0.009),
    loadPos: [
      ["unifi-power", "loadPos2"],
      ["usb-power", "loadPos3"],
      ["inside-light", "loadPos4"],
      ["outside-light", "loadPos5"],
    ].map(([glandId, terminalId]) => bottomJunctionPenetration(glandId, terminalId, 0.0085)),
    loadNeg: [
      ["unifi-power", "loadNeg2"],
      ["usb-power", "loadNeg3"],
      ["inside-light", "loadNeg4"],
      ["outside-light", "loadNeg5"],
    ].map(([glandId, terminalId]) => bottomJunctionPenetration(glandId, terminalId, 0.0085, false)),
  };
}

const JUNCTION_PORTS = createJunctionPorts();

function createDevicePorts() {
  return {
  starlink: {
    powerCable: physicalLayout.ports.starlinkPowerCable as VectorTuple,
    ethernet: physicalLayout.ports.starlinkEthernet as VectorTuple,
  },
  smartSolar: {
    pvPositive: physicalLayout.ports.smartSolarPvPositive as VectorTuple,
    pvNegative: physicalLayout.ports.smartSolarPvNegative as VectorTuple,
    batteryPositive: physicalLayout.ports.smartSolarBatteryPositive as VectorTuple,
    batteryNegative: physicalLayout.ports.smartSolarBatteryNegative as VectorTuple,
    earth: physicalLayout.ports.smartSolarEarth as VectorTuple,
    data: physicalLayout.ports.smartSolarData as VectorTuple,
  },
  multiPlus: {
    dcPositive: physicalLayout.ports.multiPlusDcPositive as VectorTuple,
    dcNegative: physicalLayout.ports.multiPlusDcNegative as VectorTuple,
    acInputCable: physicalLayout.ports.multiPlusAcInputCable as VectorTuple,
    acOutputCable: physicalLayout.ports.multiPlusAcOutputCable as VectorTuple,
    chassisEarth: physicalLayout.ports.multiPlusChassisEarth as VectorTuple,
    data: physicalLayout.ports.multiPlusData as VectorTuple,
    temperatureSense: physicalLayout.ports.multiPlusTemperatureSense as VectorTuple,
  },
  ekran: {
    powerPositive: physicalLayout.ports.ekranPowerPositive as VectorTuple,
    powerNegative: physicalLayout.ports.ekranPowerNegative as VectorTuple,
    veDirect1: physicalLayout.ports.ekranVeDirect1 as VectorTuple,
    veDirect2: physicalLayout.ports.ekranVeDirect2 as VectorTuple,
    veBus: physicalLayout.ports.ekranVeBus as VectorTuple,
    ethernet: physicalLayout.ports.ekranEthernet as VectorTuple,
    digitalInput1: physicalLayout.ports.ekranDigitalInput1 as VectorTuple,
    digitalInput2: physicalLayout.ports.ekranDigitalInput2 as VectorTuple,
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
  },
  unifiPower: {
    dcPositive: physicalLayout.ports.unifiConverterPositive as VectorTuple,
    dcNegative: physicalLayout.ports.unifiConverterNegative as VectorTuple,
    usb: physicalLayout.ports.unifiConverterUsb as VectorTuple,
  },
  indoorLight: {
    powerPositive: physicalLayout.ports.indoorLightPositive as VectorTuple,
    powerNegative: physicalLayout.ports.indoorLightNegative as VectorTuple,
  },
  outdoorFlood: {
    powerPositive: physicalLayout.ports.outdoorFloodPositive as VectorTuple,
    powerNegative: physicalLayout.ports.outdoorFloodNegative as VectorTuple,
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
    toolCable: physicalLayout.ports.acBoardToolCable as VectorTuple,
    earth: physicalLayout.ports.acBoardEarth as VectorTuple,
  },
  };
}

const DEVICE_PORTS = createDevicePorts();

function junctionInteriorPoint(point: VectorTuple): VectorTuple {
  return [
    JUNCTION_CENTER[0] + point[0],
    JUNCTION_CENTER[1] + point[1],
    JUNCTION_CENTER[2] + JUNCTION_INNER_BACK_LOCAL_Z + point[2],
  ];
}

function junctionComponentLabelPoint(componentId: string, localZ = -0.04): VectorTuple {
  const component = junctionInteriorRouting.components[componentId];
  return [
    JUNCTION_CENTER[0] + component.center[0],
    JUNCTION_CENTER[1] + component.center[1],
    JUNCTION_CENTER[2] + localZ,
  ];
}

function junctionTerminalLabelPoint(terminalId: string, localZ = -0.004): VectorTuple {
  const terminal = junctionInteriorRouting.terminals[terminalId];
  return [
    JUNCTION_CENTER[0] + terminal[0],
    JUNCTION_CENTER[1] + terminal[1],
    JUNCTION_CENTER[2] + localZ,
  ];
}

function junctionInteriorPath(routeId: string): VectorTuple[] {
  const route = junctionInteriorRouting.wireSegments[routeId] ?? junctionInteriorRouting.routes[routeId];
  if (!route) throw new Error(`Unknown junction interior route: ${routeId}`);
  return route.points.map((point) => junctionInteriorPoint(point));
}

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

// Reuse the immutable primitive vertex buffers throughout the scene. Object
// transforms carry the physical dimensions, so hundreds of boxes and studs do
// not each upload identical topology to WebGL on first render.
const UNIT_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const UNIT_BOX_EDGES_GEOMETRY = new THREE.EdgesGeometry(UNIT_BOX_GEOMETRY);
const UNIT_CYLINDER_8_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 8);
const CONNECTOR_HIT_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });
const UNIT_CYLINDER_12_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 12);
const BATCHABLE_PRIMITIVE_GEOMETRIES = new Set([
  UNIT_BOX_GEOMETRY.uuid,
  UNIT_BOX_EDGES_GEOMETRY.uuid,
  UNIT_CYLINDER_8_GEOMETRY.uuid,
  UNIT_CYLINDER_12_GEOMETRY.uuid,
]);

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
    position: [4.15, 2.85, 3.35],
    target: [2.45, 1.35, -2.0],
  },
  {
    id: "batteries",
    label: "Battery bank",
    position: [3.03, 1.25, 1.2],
    target: [
      (physicalLayout.devices.battery1.position[0] + physicalLayout.devices.battery2.position[0]) / 2,
      0.16,
      (physicalLayout.devices.battery1.position[2] + physicalLayout.devices.battery3.position[2]) / 2,
    ],
  },
  {
    id: "junction",
    label: "Open junction box",
    position: [
      physicalLayout.devices.junction.position[0] - 0.17,
      physicalLayout.devices.junction.position[1] + 0.04,
      -0.78,
    ],
    target: [
      physicalLayout.devices.junction.position[0] - 0.15,
      physicalLayout.devices.junction.position[1] + 0.01,
      -1.92,
    ],
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
  { id: "entry-box", componentId: "pvSafety", label: "PV entry protection + combine", detail: "2 string pairs in · 1 combined pair out · 40 A disconnect · Type 2 SPD", position: physicalLayout.devices.pvEntry.position as VectorTuple, offset: [-100, -28], views: ["wall"] },
  { id: "smartsolar", componentId: "solarController", label: "SmartSolar 150/85", detail: "immediately right of PV entry · 295 × 216 × 103 mm", position: physicalLayout.devices.smartSolar.position as VectorTuple, offset: [10, 26], views: ["wall"] },
  { id: "multiplus", componentId: "inverter", label: "MultiPlus-II 24/3000", detail: "high wall · 268 × 499 × 141 mm", position: physicalLayout.devices.multiPlus.position as VectorTuple, offset: [-145, 18], views: ["wall"] },
  { id: "junction", componentId: "mounting", label: "Serviceable junction box", detail: "490 × 400 × 150 mm · shown open", position: physicalLayout.devices.junction.position as VectorTuple, offset: [34, 34], views: ["wall"] },
  { id: "ekrano", componentId: "systemMonitor", label: "Ekrano GX", detail: "wall-mounted above junction box", position: physicalLayout.devices.ekran.position as VectorTuple, offset: [-120, -96], views: ["wall", "junction"] },
  { id: "selector", componentId: "batterySelector", label: "Master battery disconnect", detail: "both strings together · ON / OFF", position: junctionComponentLabelPoint("selector", -0.021), offset: [-225, 76], views: ["junction"] },
  { id: "shunt-battery", componentId: "mainDc", label: "BATTERY MINUS", detail: "two explicit lugs on one electrical landing", position: junctionComponentLabelPoint("shunt"), offset: [-225, -48], views: ["junction"] },
  { id: "shunt-system", componentId: "mainDc", label: "SYSTEM MINUS", detail: "the only path to every load / charger", position: junctionTerminalLabelPoint("shuntSystem"), offset: [-225, 3], views: ["junction"] },
  { id: "bus-positive", componentId: "mainDc", label: "24 V + BLUE SEA 2104", detail: "3 heavy studs + 3 light screws used · 2 spares", position: junctionComponentLabelPoint("positiveBus", -0.05), offset: [96, -82], views: ["junction"] },
  { id: "bus-negative", componentId: "mainDc", label: "24 V − BLUE SEA 2104", detail: "3 heavy studs + 3 light screws used · 2 spares", position: junctionComponentLabelPoint("negativeBus", -0.05), offset: [96, -32], views: ["junction"] },
  { id: "fuse-block", componentId: "fuseBlock", label: "RESETTABLE SERVICE BREAKERS", detail: "Services 20 A · Starlink 5 A · UniFi 2 A · USB 15 A · lights 1 A each", position: junctionComponentLabelPoint("fuseBlock"), offset: [96, 20], views: ["junction"] },
  { id: "return-bus", componentId: "fuseBlock", label: "BLUE SEA 2314 RETURNS", detail: "2 studs + 5 screws · 6 used · 1 spare", position: junctionComponentLabelPoint("returnBus", -0.05), offset: [96, 72], views: ["junction"] },
  { id: "load-switches", componentId: "loadSwitches", label: "EXTERIOR CONTROLS", detail: "INTERNET DPST · INSIDE SPST · OUTSIDE SPST · fixed sidewall", position: [JUNCTION_LEFT_X - 0.009, JUNCTION_CENTER[1] + junctionInteriorRouting.components.switchPanel.center[1], JUNCTION_CENTER[2] + 0.008], offset: [-245, -120], views: ["junction"] },
  { id: "mppt-breaker", componentId: "mpptFuse", label: "MPPT 100 A BREAKER", detail: "MidNite MNEDC100 · resettable", position: junctionComponentLabelPoint("mpptFuse"), offset: [-235, -170], views: ["junction"] },
  { id: "ekrano-fuse", componentId: "ekranoFuse", label: "EKRANO 3.15 A FUSE", detail: "Victron factory-specified lead", position: junctionComponentLabelPoint("ekranoFuse"), offset: [-235, -125], views: ["junction"] },
  { id: "balancer-a", componentId: "balancers", label: "Battery balancer A", detail: "wired to string A − / midpoint / +", position: physicalLayout.devices.balancerA.position as VectorTuple, offset: [-105, -65], views: ["wall", "batteries"] },
  { id: "balancer-b", componentId: "balancers", label: "Battery balancer B", detail: "wired to string B − / midpoint / +", position: physicalLayout.devices.balancerB.position as VectorTuple, offset: [52, -60], views: ["wall", "batteries"] },
  { id: "ac-box", componentId: "acBoard", label: "AC output protection", detail: "beside MultiPlus · 10 A Type A RCBO", position: physicalLayout.devices.acBoard.position as VectorTuple, offset: [8, 25], views: ["wall"] },
  { id: "unifi", componentId: "router", label: "UniFi Express", detail: "next to Ekrano · 98 × 98 × 30 mm", position: physicalLayout.devices.unifi.position as VectorTuple, offset: [-18, 70], views: ["wall"] },
  { id: "unifi-power", componentId: "unifiPower", label: "UniFi 5 V converter", detail: "potted USBbuddy2 · switched with Starlink", position: physicalLayout.devices.unifiPower.position as VectorTuple, offset: [24, -44], views: ["wall"] },
  { id: "usb", componentId: "usb", label: "6-port USB charging", detail: "Scanstrut TILE · 4 × USB-C PD + 2 × USB-A · direct 24 V", position: physicalLayout.devices.usb.position as VectorTuple, offset: [-45, -110], views: ["wall"] },
  { id: "battery1", componentId: "battery1", label: "Battery 1", detail: "String A · floor row · 520 × 238 × 220 mm", position: physicalLayout.devices.battery1.position as VectorTuple, offset: [-55, 0], views: ["batteries"] },
  { id: "battery2", componentId: "battery2", label: "Battery 2", detail: "String A · floor row · 520 × 238 × 220 mm", position: physicalLayout.devices.battery2.position as VectorTuple, offset: [24, 0], views: ["batteries"] },
  { id: "battery3", componentId: "battery3", label: "Battery 3", detail: "String B · floor row · 520 × 238 × 220 mm", position: physicalLayout.devices.battery3.position as VectorTuple, offset: [-55, 8], views: ["batteries"] },
  { id: "battery4", componentId: "battery4", label: "Battery 4", detail: "String B · floor row · 520 × 238 × 220 mm", position: physicalLayout.devices.battery4.position as VectorTuple, offset: [24, 8], views: ["batteries"] },
  { id: "class-t", componentId: "mainDc", label: "2 × Class T holders", detail: "plywood wall · one per string positive", position: [3.63, 0.53, physicalLayout.devices.classTA.position[2]], offset: [-90, -10], views: ["batteries"] },
  { id: "trailing-socket", componentId: "toolOutlet", label: "Trailing tool socket", detail: "short white 3-core lead beside MultiPlus", position: physicalLayout.devices.trailingSocket.position as VectorTuple, offset: [32, 15], views: ["site", "wall"] },
  { id: "indoor-light", componentId: "indoorLight", label: "Warm indoor utility light", detail: "QHLightlux 5 in · 3000 K · 24 V branch", position: physicalLayout.devices.indoorLight.position as VectorTuple, offset: [-85, 0], views: ["site", "wall"] },
  { id: "outdoor-flood", componentId: "outdoorLight", label: "Warm outdoor utility light", detail: "QHLightlux · 3000 K · 900 lm · IP67", position: physicalLayout.devices.outdoorFlood.position as VectorTuple, offset: [30, 0], views: ["site", "wall"] },
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
  return new THREE.MeshLambertMaterial({
    color,
    emissive: options.emissive ?? 0x000000,
    flatShading: true,
    opacity,
    transparent: opacity < 1,
  });
}

function staticMaterialKey(source: THREE.Material) {
  const common = [
    source.type,
    source.opacity,
    source.transparent,
    source.depthTest,
    source.depthWrite,
    source.side,
    source.blending,
    source.vertexColors,
  ];
  if (source instanceof THREE.MeshLambertMaterial) {
    return [...common, source.color.getHex(), source.emissive.getHex(), source.flatShading].join(":");
  }
  if (source instanceof THREE.LineBasicMaterial) {
    return [...common, source.color.getHex(), source.linewidth].join(":");
  }
  return "";
}

function componentBatchRoot(scene: THREE.Scene, object: THREE.Object3D) {
  const componentId = object.userData.componentId as string | undefined;
  if (!componentId) return scene;
  let root = object;
  while (
    root.parent &&
    root.parent !== scene &&
    root.parent.userData.componentId === componentId
  ) root = root.parent;
  return root;
}

/**
 * Collapse repeated transformed cubes, cylinders and outline edges after the
 * authored scene has been assembled. Mesh instances retain the original
 * component root, so raycasting and whole-component hover boxes still work.
 * This turns hundreds of small WebGL draw submissions into a few dozen without
 * changing the layout/routing code or the generated cable geometry. Geometry
 * is merged instead of instanced: these primitives contain very few vertices,
 * and avoiding an instancing shader variant is faster on WebKit and SwiftShader.
 */
function batchStaticPrimitives(scene: THREE.Scene, sourcePickables: THREE.Object3D[]) {
  scene.updateMatrixWorld(true);
  const batches = new Map<string, StaticPrimitiveBatch>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    if (!BATCHABLE_PRIMITIVE_GEOMETRIES.has(object.geometry.uuid)) return;
    if (object.userData.connectorDetails) return;
    if (object.children.length > 0 || Array.isArray(object.material)) return;
    const materialKey = staticMaterialKey(object.material);
    if (!materialKey) return;
    const root = componentBatchRoot(scene, object);
    const localMatrix = new THREE.Matrix4()
      .copy(root.matrixWorld)
      .invert()
      .multiply(object.matrixWorld);
    const key = [
      root.uuid,
      focusMaterialScope(object),
      object instanceof THREE.Mesh ? "mesh" : "lines",
      object.geometry.uuid,
      materialKey,
      object.castShadow,
      object.receiveShadow,
      object.renderOrder,
    ].join("|");
    const batch = batches.get(key) ?? { root, objects: [], matrices: [] };
    batch.objects.push(object);
    batch.matrices.push(localMatrix);
    batches.set(key, batch);
  });

  const removed = new Set<THREE.Object3D>();
  const replacementPickables: THREE.Object3D[] = [];
  let drawCallsSaved = 0;
  let mergedMeshGroups = 0;
  let mergedLineGroups = 0;

  batches.forEach(({ root, objects, matrices }) => {
    if (objects.length < 2) return;
    const first = objects[0];
    let replacement: THREE.Mesh | THREE.LineSegments;
    const transformed = matrices.map((matrix) => first.geometry.clone().applyMatrix4(matrix));
    const merged = mergeGeometries(transformed, false);
    transformed.forEach((geometry) => geometry.dispose());
    if (!merged) return;
    if (first instanceof THREE.Mesh) {
      replacement = new THREE.Mesh(merged, first.material);
      mergedMeshGroups += 1;
    } else {
      replacement = new THREE.LineSegments(merged, first.material);
      mergedLineGroups += 1;
    }
    replacement.castShadow = first.castShadow;
    replacement.receiveShadow = first.receiveShadow;
    replacement.renderOrder = first.renderOrder;
    replacement.userData = { ...first.userData };
    root.add(replacement);
    if (replacement.userData.componentId && replacement instanceof THREE.Mesh) {
      replacementPickables.push(replacement);
    }
    objects.forEach((object) => {
      removed.add(object);
      object.removeFromParent();
    });
    drawCallsSaved += objects.length - 1;
  });

  scene.userData.staticBatching = { drawCallsSaved, mergedMeshGroups, mergedLineGroups };
  return [
    ...sourcePickables.filter((object) => !removed.has(object)),
    ...replacementPickables,
  ];
}

function focusMaterialScope(object: THREE.Object3D) {
  const cableVisibility = object.userData.modelCable as CableVisibility | undefined;
  if (cableVisibility) return `cable-${cableVisibility}`;
  const componentId = object.userData.componentId as string | undefined;
  if (!componentId) return "neutral";
  return JUNCTION_FOCUS_COMPONENT_IDS.has(componentId) ? "junction-component" : "context-component";
}

function deduplicateStaticMaterials(scene: THREE.Scene) {
  const cache = new Map<string, THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
    if (Array.isArray(object.material)) return;
    const key = `${focusMaterialScope(object)}|${staticMaterialKey(object.material)}`;
    if (key.endsWith("|")) return;
    const shared = cache.get(key);
    if (shared) object.material = shared;
    else cache.set(key, object.material);
  });
  scene.userData.deduplicatedMaterialCount = cache.size;
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
    castShadow?: boolean;
    emissive?: number;
    opacity?: number;
    outline?: number;
    componentId?: string;
    pickables?: THREE.Object3D[];
    receiveShadow?: boolean;
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
  const body = new THREE.Mesh(UNIT_BOX_GEOMETRY, material(color, {
    emissive: options.emissive,
    opacity: options.opacity,
  }));
  body.scale.set(...size);
  const dimensions = [...size].sort((first, second) => second - first);
  body.castShadow = options.castShadow ?? dimensions[1] >= 0.05;
  body.receiveShadow = options.receiveShadow ?? true;
  group.add(body);
  const edges = new THREE.LineSegments(
    UNIT_BOX_EDGES_GEOMETRY,
    new THREE.LineBasicMaterial({
      color: options.outline ?? 0x263a3c,
      opacity: options.opacity ? Math.min(1, options.opacity + 0.25) : 0.72,
      transparent: true,
    }),
  );
  edges.scale.set(...size);
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
  const mesh = new THREE.Mesh(UNIT_CYLINDER_12_GEOMETRY, material(color, { metalness: 0.22 }));
  mesh.position.set(...position);
  mesh.scale.set(radius, height, radius);
  mesh.rotation.set(radians(rotation[0]), radians(rotation[1]), radians(rotation[2]));
  mesh.castShadow = Math.max(radius * 2, height) >= 0.08;
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

function queueCableGeometry(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  color: number,
  visibility: CableVisibility,
  routingVariant: CableRoutingVariant = "shared",
) {
  let batches = CABLE_MESH_BATCHES.get(parent);
  if (!batches) {
    batches = new Map();
    CABLE_MESH_BATCHES.set(parent, batches);
  }
  const key = `${visibility}-${routingVariant}-${color.toString(16)}`;
  const batch = batches.get(key) ?? { color, geometries: [], routingVariant, visibility };
  batch.geometries.push(geometry);
  batches.set(key, batch);
}

function flushCableMeshes(parent: THREE.Object3D) {
  const batches = CABLE_MESH_BATCHES.get(parent);
  if (!batches) return;
  batches.forEach((batch) => {
    const geometry = batch.geometries.length === 1
      ? batch.geometries[0]
      : mergeGeometries(batch.geometries, false);
    if (!geometry) {
      batch.geometries.forEach((fallbackGeometry) => {
        const mesh = new THREE.Mesh(fallbackGeometry, material(batch.color, { metalness: 0, roughness: 0.82 }));
        mesh.userData.modelCable = batch.visibility;
        mesh.userData.routingVariant = batch.routingVariant;
        mesh.visible = true;
        mesh.castShadow = true;
        parent.add(mesh);
      });
      return;
    }
    if (batch.geometries.length > 1) batch.geometries.forEach((source) => source.dispose());
    const mesh = new THREE.Mesh(geometry, material(batch.color, { metalness: 0, roughness: 0.82 }));
    mesh.userData.modelCable = batch.visibility;
    mesh.userData.routingVariant = batch.routingVariant;
    mesh.visible = true;
    mesh.castShadow = true;
    parent.add(mesh);
  });
  CABLE_MESH_BATCHES.delete(parent);
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
  const tubularSegments = Math.max(18, plannedPoints.length * 9);
  const geometry = new THREE.TubeGeometry(
    curve,
    tubularSegments,
    radius,
    10,
    false,
  );
  queueCableGeometry(parent, geometry, color, visibility);
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
  const mesh = new THREE.Mesh(UNIT_CYLINDER_8_GEOMETRY, material(color, { metalness: 0, roughness: 0.82 }));
  mesh.position.copy(startVector).add(endVector).multiplyScalar(0.5);
  mesh.scale.set(radius, length, radius);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.userData.modelCable = visibility;
  mesh.castShadow = Math.max(radius * 2, length) >= 0.08;
  parent.add(mesh);
  return mesh;
}

function addOrientedPortCylinder(
  parent: THREE.Object3D,
  face: VectorTuple,
  position: VectorTuple,
  cableRadiusM: number,
  visibility: CableVisibility = "context",
  connectorDetails?: ConnectorDetails,
  pickables?: THREE.Object3D[],
) {
  const start = vector(face);
  const end = vector(position);
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 0.0005) return;
  const axis = direction.clone().normalize();
  const radius = Math.max(0.0026, cableRadiusM * 1.3);
  // The insulating cap and copper barrel have separate axial spans. Leave a
  // sub-millimetre recess between their end faces: even the hidden cylinder
  // caps are then non-coplanar, so depth precision can never make copper
  // flicker through the black collar.
  const collarLength = Math.min(0.0035, Math.max(0.0012, length * 0.28));
  const collarStart = end.clone().addScaledVector(axis, -collarLength);
  const barrelRecess = Math.min(0.0004, Math.max(0.00015, length * 0.035));
  const copperEnd = collarStart.clone().addScaledVector(axis, -barrelRecess);
  const copperLength = copperEnd.distanceTo(start);
  const mesh = new THREE.Mesh(
    UNIT_CYLINDER_12_GEOMETRY,
    material(COLORS.copper, { metalness: 0.55, roughness: 0.32 }),
  );
  mesh.position.copy(start).add(copperEnd).multiplyScalar(0.5);
  mesh.scale.set(radius, copperLength, radius);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  mesh.userData.connectionPort = true;
  mesh.userData.connectionPortPart = "barrel";
  mesh.userData.modelCable = visibility;
  mesh.castShadow = true;
  parent.add(mesh);

  // A dark insulating collar at the cable-facing end makes the one legal
  // attachment direction visually unambiguous even at the whole-wall zoom.
  // Its rear face begins just beyond the recessed copper barrel.
  const collar = addStraightSegment(
    parent,
    collarStart.toArray() as VectorTuple,
    end.toArray() as VectorTuple,
    COLORS.black,
    radius * 1.08,
    visibility,
  );
  if (collar) {
    collar.userData.connectionPort = true;
    collar.userData.connectionPortPart = "cap";
  }
  if (connectorDetails && pickables) {
    // Keep the visible copper/cap primitives batchable. A material-hidden
    // cylinder with the same axis supplies a generous per-connector raycast
    // target without adding a WebGL draw call or losing connector identity in
    // merged geometry.
    const hitTarget = new THREE.Mesh(UNIT_CYLINDER_8_GEOMETRY, CONNECTOR_HIT_MATERIAL);
    hitTarget.position.copy(start).add(end).multiplyScalar(0.5);
    hitTarget.scale.set(radius * 1.8, length, radius * 1.8);
    hitTarget.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    hitTarget.userData.connectionPort = true;
    hitTarget.userData.connectionPortPart = "hit-target";
    hitTarget.userData.connectorDetails = connectorDetails;
    parent.add(hitTarget);
    pickables.push(hitTarget);
  }
}

function addPhysicalConnectionPorts(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  Object.entries(physicalLayout.portSpecifications).forEach(([portId, port]) => {
    addOrientedPortCylinder(
      scene,
      port.face as VectorTuple,
      port.position as VectorTuple,
      port.cableRadiusM,
      "context",
      PHYSICAL_CONNECTORS.get(portId),
      pickables,
    );
  });
}

function addJunctionInteriorConnectionPorts(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  Object.entries(junctionInteriorRouting.ports).forEach(([portId, port]) => {
    addOrientedPortCylinder(
      scene,
      junctionInteriorPoint(port.face as VectorTuple),
      junctionInteriorPoint(port.position as VectorTuple),
      port.cableRadiusM,
      "junction",
      JUNCTION_CONNECTORS.get(portId),
      pickables,
    );
  });
}

function addOrthogonalCable(
  parent: THREE.Object3D,
  points: VectorTuple[],
  color: number,
  radius = 0.006,
  visibility: CableVisibility = "context",
  _avoidCrossings = true,
  routingVariant: CableRoutingVariant = "shared",
) {
  void _avoidCrossings;
  // Automatic wall/floor and junction routes are rendered exclusively from
  // the published Voxel A* artifact. Calls associated with the retired route
  // specification stop here, before any geometry or runtime audit work.
  if (routingVariant === "omitted") return;
  const router = cableRouter(parent);
  // The offline solver owns cable geometry. Runtime routing only registers and
  // audits it; adding detours here could invalidate a straight port approach.
  const plannedPoints = routingVariant === "voxel"
    ? points
    : router.prepareRoute(points, radius, visibility, false);
  const bendRadius = Math.max(radius * 4.25, 0.009);
  const { geometry, roundedCorners } = buildRoundedCableGeometry(
    plannedPoints,
    bendRadius,
    radius,
    9,
  );
  if (routingVariant !== "voxel") router.noteRoundedCorners(roundedCorners);
  queueCableGeometry(parent, geometry, color, visibility, routingVariant);
}

function addBoundarySplitCable(
  parent: THREE.Object3D,
  insidePoints: VectorTuple[],
  exteriorPoints: VectorTuple[],
  penetration: JunctionPenetration,
  color: number,
  radius: number,
  _interiorAvoidCrossings: boolean,
  _exteriorAvoidCrossings: boolean,
  exteriorRoutingVariant: CableRoutingVariant = "shared",
  interiorRoutingVariant: CableRoutingVariant = "omitted",
) {
  void _interiorAvoidCrossings;
  void _exteriorAvoidCrossings;
  if (exteriorRoutingVariant === "omitted" && interiorRoutingVariant === "omitted") return;
  const router = cableRouter(parent);
  const plannedInside = router.prepareRoute(
    [...insidePoints, ...penetration.through.slice(1)],
    radius,
    "junction",
    false,
  );
  const plannedExterior = router.prepareRoute(
    [penetration.outside, ...exteriorPoints],
    radius,
    "context",
    false,
  );
  const plannedPoints = [...plannedInside, ...plannedExterior.slice(1)];
  const { centerline, geometry, roundedCorners } = buildRoundedCableGeometry(
    plannedPoints,
    Math.max(radius * 4.25, 0.009),
    radius,
    9,
  );
  router.noteRoundedCorners(roundedCorners);

  const outside = vector(penetration.outside);
  const boundaryRing = centerline.reduce((closest, point, index) => (
    vector(point).distanceToSquared(outside) < vector(centerline[closest]).distanceToSquared(outside)
      ? index
      : closest
  ), 0);
  const isJunctionSegment = (index: number) => index < Math.max(1, boundaryRing);
  const indicesPerRingSegment = 9 * 6;
  const sourceIndices = geometry.getIndex();
  if (!sourceIndices) throw new Error("Continuous junction cable must be indexed");
  const junctionIndices: number[] = [];
  const contextIndices: number[] = [];
  for (let segment = 0; segment < centerline.length - 1; segment += 1) {
    const target = isJunctionSegment(segment) ? junctionIndices : contextIndices;
    const start = segment * indicesPerRingSegment;
    for (let index = start; index < start + indicesPerRingSegment; index += 1) {
      target.push(sourceIndices.getX(index));
    }
  }
  const splitGeometry = (indices: number[]) => {
    if (indices.length === 0) return undefined;
    const result = geometry.clone();
    result.clearGroups();
    result.setIndex(indices);
    result.computeBoundingSphere();
    return result;
  };
  const junctionGeometry = splitGeometry(junctionIndices);
  const contextGeometry = splitGeometry(contextIndices);
  geometry.dispose();
  if (junctionGeometry && interiorRoutingVariant !== "omitted") queueCableGeometry(parent, junctionGeometry, color, "junction", interiorRoutingVariant);
  else junctionGeometry?.dispose();
  if (contextGeometry && exteriorRoutingVariant !== "omitted") queueCableGeometry(parent, contextGeometry, color, "context", exteriorRoutingVariant);
  else contextGeometry?.dispose();
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

function addContinuousJunctionCable(
  scene: THREE.Scene,
  insidePoints: VectorTuple[],
  penetration: JunctionPenetration,
  exteriorPoints: VectorTuple[],
  color: number,
  radius: number,
  splitVisibility = true,
  avoidCrossings = true,
  exteriorAvoidCrossings = true,
  exteriorRoutingVariant: CableRoutingVariant = "shared",
  interiorRoutingVariant: CableRoutingVariant = "omitted",
) {
  const through = penetration.through;
  if (!splitVisibility) {
    addOrthogonalCable(
      scene,
      [...insidePoints, ...through.slice(1), ...exteriorPoints],
      color,
      radius,
      "junction",
      avoidCrossings,
      interiorRoutingVariant,
    );
    return;
  }
  // One continuous tube owns the interior, gland bend, and exterior route.
  // Geometry groups switch materials at the enclosure boundary so junction
  // focus can fade the wall run without creating a seam or a broken elbow.
  addBoundarySplitCable(
    scene,
    insidePoints,
    exteriorPoints,
    penetration,
    color,
    radius,
    avoidCrossings,
    exteriorAvoidCrossings,
    exteriorRoutingVariant,
    interiorRoutingVariant,
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

function addBottomTerminal(
  scene: THREE.Scene,
  position: VectorTuple,
  color: number,
  radius = 0.007,
) {
  addCylinder(scene, radius + 0.002, 0.005, position, 0x1b2224);
  addCylinder(scene, radius, 0.009, [position[0], position[1] - 0.004, position[2]], color);
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
  [-0.23, 0.23].forEach((x) => {
    [-0.2, 0.2].forEach((z) => {
      const post = new THREE.Mesh(UNIT_CYLINDER_8_GEOMETRY, frameMaterial);
      post.position.set(x, 0, z);
      post.scale.set(0.018, 0.58, 0.018);
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
  // The Mini's OEM 15 m lead is one two-conductor, white-jacketed cable. The
  // red/black conductors are exposed only inside the junction box at the
  // switched 24 V bulkhead jack, never rendered as two rooftop home runs.
  addCylinder(scene, 0.006, 0.014, DEVICE_PORTS.starlink.powerCable, COLORS.white);
  addOutlinedBox(scene, [0.017, 0.009, 0.014], DEVICE_PORTS.starlink.ethernet, COLORS.blue, { outline: 0x244c71 });
}

function addTerminalBusbar(
  parent: THREE.Object3D,
  position: VectorTuple,
  baseColor: number,
  componentId: string,
  pickables: THREE.Object3D[],
  studCount = 5,
  studFace: "front" | "bottom" = "front",
  style: "uniform" | "powerbar2104" | "minibus2314" | "earth2128" = "uniform",
) {
  const group = new THREE.Group();
  group.position.set(...position);
  const bodySize: VectorTuple = style === "powerbar2104"
    ? [0.178, 0.051, 0.026]
    : style === "minibus2314"
      ? [0.107, 0.023, 0.024]
      : style === "earth2128"
        ? [0.149, 0.032, 0.024]
        : [0.14, 0.025, 0.026];
  addOutlinedBox(group, bodySize, [0, 0, 0], baseColor, {
    outline: baseColor === COLORS.red ? 0x7c2623 : 0x111516,
  });
  addOutlinedBox(group, [bodySize[0] - 0.018, Math.max(0.01, bodySize[1] - 0.012), 0.012], [0, 0, 0.018], COLORS.copper, {
    outline: 0x75421f,
  });
  const terminals = style === "powerbar2104"
    ? [
        ...[-0.054, -0.018, 0.018, 0.054].map((x) => ({ x, y: 0.008, radius: 0.007, height: 0.017 })),
        ...[-0.054, -0.018, 0.018, 0.054].map((x) => ({ x, y: -0.012, radius: 0.0034, height: 0.012 })),
      ]
    : style === "minibus2314"
      ? [
          { x: -0.045, y: 0.006, radius: 0.0048, height: 0.014 },
          { x: 0.045, y: 0.006, radius: 0.0048, height: 0.014 },
          ...[-0.032, -0.016, 0, 0.016, 0.032].map((x) => ({ x, y: -0.005, radius: 0.0032, height: 0.011 })),
        ]
      : style === "earth2128"
        ? [
            { x: -0.061, y: 0.006, radius: 0.006, height: 0.016 },
            { x: 0.061, y: 0.006, radius: 0.006, height: 0.016 },
            ...[-0.044, -0.0264, -0.0088, 0.0088, 0.0264, 0.044].map((x) => ({ x, y: -0.007, radius: 0.0035, height: 0.012 })),
          ]
        : Array.from({ length: studCount }, (_, index) => ({
            x: -0.053 + (0.106 / Math.max(1, studCount - 1)) * index,
            y: 0,
            radius: 0.007,
            height: 0.017,
          }));
  terminals.forEach(({ x, y, radius, height }) => {
    if (studFace === "bottom") {
      addCylinder(group, radius, height, [x, -bodySize[1] / 2 - height / 2 + y, 0], 0xd0d2cc);
      addCylinder(group, radius * 0.58, height + 0.004, [x, -bodySize[1] / 2 - height / 2 - 0.002 + y, 0], 0x555e5c);
    } else {
      addCylinder(group, radius, height, [x, y, 0.031], 0xd0d2cc, [90, 0, 0]);
      addCylinder(group, radius * 0.58, height + 0.004, [x, y, 0.035], 0x555e5c, [90, 0, 0]);
    }
  });
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
  rotationDeg = 0,
  resettable = false,
) {
  const holder = addOutlinedBox(scene, size, position, 0xeee8dc, {
    componentId,
    pickables,
    outline: 0x68645c,
    rotation: [0, 0, rotationDeg],
  });
  addOutlinedBox(holder, [size[0] * 0.42, size[1] * (resettable ? 0.56 : 1.05), size[2] * 1.05], [0, 0, 0.001], resettable ? 0x303838 : COLORS.orange, {
    outline: resettable ? 0x151a1a : 0x8c5b1f,
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
  if (penetration.renderGland) {
    const gland = addCylinder(
      scene,
      penetration.glandRadius,
      0.026,
      penetration.glandCenter,
      0x343b3c,
      rotation,
    );
    gland.userData.componentId = "mounting";
    gland.userData.junctionGlandId = penetration.glandId;
    pickables.push(gland);
    addCylinder(
      scene,
      Math.max(cableRadius + 0.0012, penetration.glandRadius * 0.58),
      0.031,
      penetration.glandCenter,
      0xaeb6b3,
      rotation,
    );
  }
  if (renderCable) {
    addOrthogonalCable(scene, penetration.through, color, cableRadius, "junction");
  }
}

function addJunctionBox(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const center = JUNCTION_CENTER;
  const [enclosureWidth, enclosureHeight, enclosureDepth] = physicalLayout.devices.junction.size;
  const sideHeight = enclosureHeight - 0.03;
  const wallHalfWidth = enclosureWidth / 2 - 0.008;
  const wallHalfHeight = enclosureHeight / 2 - 0.0075;
  const interiorComponents = junctionInteriorRouting.components;
  const interiorTerminals = junctionInteriorRouting.terminals;
  const enclosure = new THREE.Group();
  enclosure.position.set(...center);
  addOutlinedBox(enclosure, [enclosureWidth, enclosureHeight, 0.012], [0, 0, -0.069], 0xc8d0cc, { outline: 0x667471 });
  addOutlinedBox(enclosure, [enclosureWidth, 0.015, enclosureDepth], [0, wallHalfHeight, 0], 0xc8d0cc, { outline: 0x667471 });
  addOutlinedBox(enclosure, [enclosureWidth, 0.015, enclosureDepth], [0, -wallHalfHeight, 0], 0xc8d0cc, { outline: 0x667471 });
  addOutlinedBox(enclosure, [0.015, sideHeight, enclosureDepth], [-wallHalfWidth, 0, 0], 0xc8d0cc, { outline: 0x667471 });
  addOutlinedBox(enclosure, [0.015, sideHeight, enclosureDepth], [wallHalfWidth, 0, 0], 0xc8d0cc, { outline: 0x667471 });
  tagObject(enclosure, "mounting", pickables);
  scene.add(enclosure);

  const portCables: Array<[JunctionPenetration, number, number]> = [
    [JUNCTION_PORTS.batteryPosA, COLORS.red, 0.0065],
    [JUNCTION_PORTS.batteryPosB, COLORS.red, 0.0065],
    [JUNCTION_PORTS.batteryNegA, COLORS.black, 0.0065],
    [JUNCTION_PORTS.batteryNegB, COLORS.black, 0.0065],
    [JUNCTION_PORTS.mpptPos, COLORS.red, 0.005],
    [JUNCTION_PORTS.mpptNeg, COLORS.black, 0.005],
    [JUNCTION_PORTS.multiplusPos, COLORS.red, 0.0065],
    [JUNCTION_PORTS.multiplusNeg, COLORS.black, 0.0065],
    [JUNCTION_PORTS.ekranPos, COLORS.red, 0.0018],
    [JUNCTION_PORTS.ekranNeg, COLORS.black, 0.0018],
    [JUNCTION_PORTS.ekranData, COLORS.blue, 0.0017],
    [JUNCTION_PORTS.starlinkCable, COLORS.white, 0.004],
    ...JUNCTION_PORTS.loadPos.map((port, index) => [port, COLORS.red, [0.0018, 0.0024, 0.0018, 0.0018][index]] as [JunctionPenetration, number, number]),
    ...JUNCTION_PORTS.loadNeg.map((port, index) => [port, COLORS.black, [0.0018, 0.0024, 0.0018, 0.0018][index]] as [JunctionPenetration, number, number]),
  ];
  const passages = portCables.map(([port]) => ({
    axis: port.axis,
    center: port.glandCenter,
    radius: port.glandRadius,
  } satisfies CablePassage));
  registerCableObstacle(scene, "junction-back", [JUNCTION_CENTER[0], JUNCTION_CENTER[1], JUNCTION_CENTER[2] - 0.069], [enclosureWidth, enclosureHeight, 0.012]);
  registerCableObstacle(
    scene,
    "junction-top",
    [JUNCTION_CENTER[0], JUNCTION_TOP_Y - 0.0075, JUNCTION_CENTER[2]],
    [enclosureWidth, 0.015, enclosureDepth],
    passages.filter((passage) => passage.axis === "y" && passage.center[1] > JUNCTION_CENTER[1]),
  );
  registerCableObstacle(
    scene,
    "junction-bottom",
    [JUNCTION_CENTER[0], JUNCTION_BOTTOM_Y + 0.0075, JUNCTION_CENTER[2]],
    [enclosureWidth, 0.015, enclosureDepth],
    passages.filter((passage) => passage.axis === "y" && passage.center[1] < JUNCTION_CENTER[1]),
  );
  registerCableObstacle(scene, "junction-left", [JUNCTION_LEFT_X + 0.0075, JUNCTION_CENTER[1], JUNCTION_CENTER[2]], [0.015, sideHeight, enclosureDepth]);
  registerCableObstacle(
    scene,
    "junction-right",
    [JUNCTION_RIGHT_X - 0.0075, JUNCTION_CENTER[1], JUNCTION_CENTER[2]],
    [0.015, sideHeight, enclosureDepth],
    passages.filter((passage) => passage.axis === "x"),
  );
  portCables.forEach(([port, color, cableRadius]) => {
    addJunctionPenetration(scene, port, color, cableRadius, pickables, false);
  });

  // Routine controls pass through the unused fixed left sidewall. Keeping the
  // panel off the hinged door avoids a moving service loop while preserving a
  // sealed, externally reachable interface.
  const switchPanelCenter: VectorTuple = [
    JUNCTION_LEFT_X - 0.009,
    JUNCTION_CENTER[1] + interiorComponents.switchPanel.center[1],
    JUNCTION_CENTER[2] + 0.008,
  ];
  addOutlinedBox(scene, [0.018, 0.096, 0.064], switchPanelCenter, 0x20272a, {
    componentId: "loadSwitches",
    pickables,
    outline: 0x0c1113,
  });
  registerCableObstacle(
    scene,
    "junction-external-switches",
    physicalLayout.devices.junctionControls.position as VectorTuple,
    physicalLayout.devices.junctionControls.size as VectorTuple,
  );
  [0.092, 0.063, 0.034].forEach((yOffset, index) => {
    const rocker = addOutlinedBox(
      scene,
      [0.024, 0.024, 0.046],
      [JUNCTION_LEFT_X - 0.022, JUNCTION_CENTER[1] + yOffset, JUNCTION_CENTER[2] + 0.008],
      0x111719,
      { componentId: "loadSwitches", pickables, outline: 0x4f5b5d },
    );
    addOutlinedBox(
      rocker,
      [0.004, 0.012, 0.026],
      [-0.014, 0, 0],
      [0x62a7c2, 0xffd08a, 0xf3a75b][index],
      { outline: 0x202728 },
    );
  });
  // Switch terminal barrels and collars are rendered from the authoritative
  // oriented port definitions below. The former duplicate copper cylinders
  // used a different depth plane and appeared to float beside the cables.
  const starlinkGland = junctionInteriorRouting.glands["starlink-jack"];
  addOutlinedBox(enclosure, [0.032, 0.018, 0.018], [starlinkGland.x, -0.096, starlinkGland.zOffset], 0x303638, {
    componentId: "mounting",
    pickables,
    outline: 0x121718,
  });
  addCylinder(enclosure, 0.0032, 0.012, [...interiorTerminals.starlinkJackPositive, starlinkGland.zOffset], COLORS.red, [90, 0, 0]);
  addCylinder(enclosure, 0.0032, 0.012, [...interiorTerminals.starlinkJackNegative, starlinkGland.zOffset], COLORS.black, [90, 0, 0]);

  const shunt = addOutlinedBox(enclosure, [0.12, 0.046, 0.054], [...interiorComponents.shunt.center, -0.036], COLORS.blue, {
    componentId: "mainDc",
    pickables,
    outline: 0x173f5b,
  });
  addOutlinedBox(shunt, [0.036, 0.038, 0.01], [0, 0, 0.031], COLORS.white, { outline: 0xb5b7b1 });
  addCylinder(shunt, 0.013, 0.012, [-0.043, 0, 0.032], COLORS.copper, [90, 0, 0]);
  addCylinder(shunt, 0.013, 0.012, [0.043, 0, 0.032], COLORS.copper, [90, 0, 0]);
  addTerminalBusbar(enclosure, [...interiorComponents.positiveBus.center, -0.05], COLORS.red, "mainDc", pickables, 8, "front", "powerbar2104");
  addTerminalBusbar(enclosure, [...interiorComponents.negativeBus.center, -0.05], COLORS.black, "mainDc", pickables, 8, "front", "powerbar2104");

  const fuseBlock = new THREE.Group();
  fuseBlock.position.set(...interiorComponents.fuseBlock.center, -0.04);
  addOutlinedBox(fuseBlock, [interiorComponents.fuseBlock.size[0], interiorComponents.fuseBlock.size[1], 0.044], [0, 0, 0], 0xd9dedb, { outline: 0x566260 });
  const breakerXs = [-0.046, -0.0276, -0.0092, 0.0092, 0.0276, 0.046];
  // Six breaker outputs need only three incoming conductors: a dedicated feed
  // for the 20 A services breaker, a dedicated feed for Starlink's 5 A
  // breaker, and one short copper comb feeding the four low-current branches.
  addOutlinedBox(fuseBlock, [0.012, 0.009, 0.012], [breakerXs[0], 0.034, 0.028], COLORS.copper, { outline: 0x75421f });
  addOutlinedBox(fuseBlock, [0.012, 0.009, 0.012], [breakerXs[1], 0.034, 0.028], COLORS.copper, { outline: 0x75421f });
  addOutlinedBox(fuseBlock, [0.068, 0.009, 0.012], [0.0184, 0.034, 0.028], COLORS.copper, { outline: 0x75421f });
  breakerXs.forEach((x, index) => {
    addOutlinedBox(
      fuseBlock,
      [0.013, 0.063, 0.026],
      [x, -0.004, 0.035],
      0xe8ebe8,
      { outline: 0x566260 },
    );
    addOutlinedBox(fuseBlock, [0.009, 0.016, 0.008], [x, 0.005, 0.052], index === 0 ? 0x454d4c : 0x303838, { outline: 0x151a1a });
    addCylinder(fuseBlock, 0.0032, 0.01, [x, -0.034, 0.029], 0xd0d2cc, [90, 0, 0]);
  });
  tagObject(fuseBlock, "fuseBlock", pickables);
  enclosure.add(fuseBlock);
  addTerminalBusbar(enclosure, [...interiorComponents.returnBus.center, -0.05], COLORS.black, "fuseBlock", pickables, 7, "front", "minibus2314");

  const selector = addCylinder(enclosure, 0.034, 0.078, [...interiorComponents.selector.center, -0.021], 0xc9473e, [90, 0, 0]);
  selector.userData.componentId = "batterySelector";
  pickables.push(selector);
  addCylinder(enclosure, 0.012, 0.055, [...interiorComponents.selector.center, 0.035], 0x252a2c, [90, 0, 0]);
  // The input/output studs are the oriented selectable port cylinders. Do not
  // add a second decorative stud on a different depth plane.
  registerCableObstacle(
    scene,
    "junction-selector",
    [
      JUNCTION_CENTER[0] + interiorComponents.selector.center[0],
      JUNCTION_CENTER[1] + interiorComponents.selector.center[1],
      JUNCTION_CENTER[2] - 0.021,
    ],
    [interiorComponents.selector.size[0], interiorComponents.selector.size[1], 0.084],
    [
      { axis: "x", center: junctionInteriorPoint([...interiorTerminals.selectorInputA, JUNCTION_SELECTOR_TERMINAL_DEPTH_M]), radius: 0.0145 },
      { axis: "x", center: junctionInteriorPoint([...interiorTerminals.selectorInputB, JUNCTION_SELECTOR_TERMINAL_DEPTH_M]), radius: 0.0145 },
      { axis: "x", center: junctionInteriorPoint([...interiorTerminals.selectorOutput, JUNCTION_SELECTOR_TERMINAL_DEPTH_M]), radius: 0.013 },
    ],
  );

  const door = new THREE.Group();
  door.position.set(center[0] - enclosureWidth / 2, center[1], center[2] + 0.078);
  door.rotation.y = radians(-112);
  const doorPanel = addOutlinedBox(door, [enclosureWidth, enclosureHeight, 0.012], [enclosureWidth / 2, 0, 0], 0xd8ded9, { opacity: 0.86, outline: 0x677471 });
  doorPanel.userData.componentId = "mounting";
  tagObject(doorPanel, "mounting", pickables);
  scene.add(door);

  [
    ["selector-to-positive-bus", COLORS.red, false],
    ["shunt-to-negative-bus", COLORS.black, false],
    ["shunt-voltage-sense", COLORS.red, false],
    ["mppt-positive-feed", COLORS.red, false],
    ["services-positive-feed", COLORS.red, false],
    ["services-positive", COLORS.red, false],
    ["services-negative", COLORS.black, false],
    ["ekrano-positive-feed", COLORS.red, false],
    ["starlink-fuse-feed", COLORS.red, false],
    ["starlink-switch-input", COLORS.red, false],
    ["switch-input-2", COLORS.red, false],
    ["switch-input-4", COLORS.red, false],
    ["switch-input-5", COLORS.red, false],
    ["switch-led-negative", COLORS.black, false],
  ].forEach(([routeId, color, avoidCrossings]) => {
    const route = junctionInteriorRouting.wireSegments[routeId as string];
    addOrthogonalCable(
      scene,
      junctionInteriorPath(route.id),
      color as number,
      route.radiusM,
      "junction",
      avoidCrossings as boolean,
      "omitted",
    );
  });

  Object.values(junctionInteriorRouting.routes).forEach((route) => {
    if (!route.fuse) return;
    const componentId = route.id === "mppt-positive" ? "mpptFuse" : "ekranoFuse";
    addInlineFuse(
      scene,
      junctionInteriorPoint(route.fuse.position as VectorTuple),
      componentId,
      pickables,
      route.fuse.size as VectorTuple,
      route.fuse.rotationDeg,
      route.id === "mppt-positive",
    );
  });

  addContinuousJunctionCable(
    scene,
    junctionInteriorPath("ekrano-positive"),
    JUNCTION_PORTS.ekranPos,
    physicalLayout.routes["junction-to-ekrano-positive"].points.slice(1) as VectorTuple[],
    COLORS.red,
    0.0018,
    true,
    false,
    true,
    wallRouteVariant("junction-to-ekrano-positive"),
  );
  addContinuousJunctionCable(
    scene,
    junctionInteriorPath("ekrano-negative"),
    JUNCTION_PORTS.ekranNeg,
    physicalLayout.routes["junction-to-ekrano-negative"].points.slice(1) as VectorTuple[],
    COLORS.black,
    0.0018,
    true,
    false,
    true,
    wallRouteVariant("junction-to-ekrano-negative"),
  );
  addContinuousJunctionCable(
    scene,
    junctionInteriorPath("ekrano-data"),
    JUNCTION_PORTS.ekranData,
    physicalLayout.routes["junction-to-ekrano-data"].points.slice(1) as VectorTuple[],
    COLORS.blue,
    0.0017,
    true,
    false,
    true,
    wallRouteVariant("junction-to-ekrano-data"),
  );
  addJunctionInteriorConnectionPorts(scene, pickables);
}

function addBuilding(scene: THREE.Scene) {
  physicalLayout.surfaces.floorPlanes.forEach((surface, index) => {
    addOutlinedBox(scene, surface.size as VectorTuple, surface.center as VectorTuple, index === 0 ? COLORS.outdoor : COLORS.indoor, {
      castShadow: false,
      outline: index === 0 ? 0xc5bc99 : 0xb9afa0,
    });
  });
  addOutlinedBox(scene, physicalLayout.surfaces.backWall.size as VectorTuple, physicalLayout.surfaces.backWall.center as VectorTuple, 0xe5dfd2, {
    castShadow: false,
    opacity: 0.9,
    outline: 0xada596,
  });
  addOutlinedBox(scene, physicalLayout.surfaces.equipmentBoard.size as VectorTuple, physicalLayout.surfaces.equipmentBoard.center as VectorTuple, 0xc79c63, {
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
  addVictronDevice(scene, "balancers", devices.balancerA.size as VectorTuple, devices.balancerA.position as VectorTuple, pickables);
  addVictronDevice(scene, "balancers", devices.balancerB.size as VectorTuple, devices.balancerB.position as VectorTuple, pickables);
  addProtectionBox(scene, "acBoard", devices.acBoard.position as VectorTuple, pickables, devices.acBoard.size as VectorTuple);
  const ekran = addOutlinedBox(scene, devices.ekran.size as VectorTuple, devices.ekran.position as VectorTuple, 0x273e4b, { componentId: "systemMonitor", pickables, outline: 0x101d24 });
  addOutlinedBox(ekran, [0.164, 0.092, 0.008], [0, 0, devices.ekran.size[2] / 2 + 0.004], 0x69a7ba, { outline: 0xb8d5d6 });
  const unifi = addOutlinedBox(scene, devices.unifi.size as VectorTuple, devices.unifi.position as VectorTuple, 0xf2f1eb, { componentId: "router", pickables, outline: 0x99a2a0 });
  addCylinder(unifi, 0.008, 0.005, [0.035, -0.035, 0.019], 0x72b4c0, [90, 0, 0]);
  const usb = addOutlinedBox(scene, devices.usb.size as VectorTuple, devices.usb.position as VectorTuple, 0x343b3e, { componentId: "usb", pickables, outline: 0x14191b });
  [-0.058, 0, 0.058].forEach((x, moduleIndex) => {
    const chargerModule = addOutlinedBox(usb, [0.046, 0.056, 0.008], [x, 0, devices.usb.size[2] / 2 + 0.004], 0x222b2e, { outline: 0x7e8d8c });
    const portOffsets = moduleIndex === 0 ? [-0.01, 0.01] : [-0.011, 0.011];
    portOffsets.forEach((portX, portIndex) => addOutlinedBox(
      chargerModule,
      [moduleIndex === 0 || portIndex === 1 ? 0.012 : 0.014, 0.006, 0.004],
      [portX, 0, 0.006],
      0xbcc8c7,
      { outline: 0x687270 },
    ));
  });
  const unifiPower = addOutlinedBox(
    scene,
    devices.unifiPower.size as VectorTuple,
    devices.unifiPower.position as VectorTuple,
    0x30383b,
    { componentId: "unifiPower", pickables, outline: 0x12191b },
  );
  addOutlinedBox(unifiPower, [0.055, 0.012, 0.006], [0, 0.006, 0.018], 0xc4c9c5, { outline: 0x687270 });
  addTerminalBusbar(scene, devices.earthBar.position as VectorTuple, COLORS.earth, "earth", pickables, 8, "bottom", "earth2128");

  // Every wall enclosure is a cable obstacle, not only the display and router.
  // Routes may enter through declared bottom passages; crossover geometry is
  // therefore never permitted to solve a wire conflict by lifting over a unit.
  const portsByWallDevice = new Map<string, Map<string, { center: VectorTuple; radius: number }>>();
  Object.values(physicalLayout.routes).forEach((route) => {
    [
      [route.sourceDeviceId, route.sourcePortId],
      [route.targetDeviceId, route.targetPortId],
    ].forEach(([deviceId, portId]) => {
      if (!deviceId || !portId || devices[deviceId]?.mounting !== "wall" || deviceId === "junction") return;
      const port = physicalLayout.ports[portId];
      if (!port) return;
      const passages = portsByWallDevice.get(deviceId) ?? new Map();
      passages.set(portId, {
        center: port as VectorTuple,
        radius: Math.max(passages.get(portId)?.radius ?? 0, route.radiusM + 0.004),
      });
      portsByWallDevice.set(deviceId, passages);
    });
  });
  DEVICE_PORTS.pvEntry.stringInputs.forEach((center, index) => {
    const passages = portsByWallDevice.get("pvEntry") ?? new Map();
    passages.set(`pv-string-${index}`, { center, radius: 0.011 });
    portsByWallDevice.set("pvEntry", passages);
  });
  Object.values(devices)
    .filter((device) => device.mounting === "wall" && !["equipmentBoard", "junction"].includes(device.id))
    .forEach((device) => registerCableObstacle(
      scene,
      `${device.id}-front`,
      device.position as VectorTuple,
      device.size as VectorTuple,
      [...(portsByWallDevice.get(device.id)?.values() ?? [])]
        .map(({ center, radius }) => ({ axis: "y" as const, center, radius })),
    ));

  [
    [DEVICE_PORTS.smartSolar.pvPositive, COLORS.red],
    [DEVICE_PORTS.smartSolar.pvNegative, COLORS.black],
    [DEVICE_PORTS.smartSolar.batteryPositive, COLORS.red],
    [DEVICE_PORTS.smartSolar.batteryNegative, COLORS.black],
  ].forEach(([position, color]) => addBottomTerminal(scene, position as VectorTuple, color as number));
  [
    [DEVICE_PORTS.multiPlus.dcPositive, COLORS.red],
    [DEVICE_PORTS.multiPlus.dcNegative, COLORS.black],
    [DEVICE_PORTS.multiPlus.acInputCable, COLORS.threeCoreAc],
    [DEVICE_PORTS.multiPlus.acOutputCable, COLORS.threeCoreAc],
  ].forEach(([position, color]) => addBottomTerminal(scene, position as VectorTuple, color as number, 0.006));
  [devices.balancerA, devices.balancerB].forEach((balancer) => {
    [-0.045, -0.015, 0.015, 0.045].forEach((offset, index) => addBottomTerminal(
      scene,
      [balancer.position[0] + offset, balancer.position[1] - balancer.size[1] / 2 - 0.006, balancer.position[2]],
      [COLORS.red, COLORS.yellow, COLORS.black, COLORS.blue][index],
      index === 3 ? 0.0015 : 0.0017,
    ));
  });

  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.unifi.power, 0xadb6b5, { outline: 0x384345 });
  addOutlinedBox(scene, [0.017, 0.009, 0.006], DEVICE_PORTS.unifi.wan, COLORS.blue, { outline: 0x244c71 });
  addOutlinedBox(scene, [0.017, 0.009, 0.006], DEVICE_PORTS.unifi.lan, COLORS.teal, { outline: 0x184d49 });
  addBottomTerminal(scene, DEVICE_PORTS.usb.dcPositive, COLORS.red, 0.0024);
  addBottomTerminal(scene, DEVICE_PORTS.usb.dcNegative, COLORS.black, 0.0024);
  addBottomTerminal(scene, DEVICE_PORTS.unifiPower.dcPositive, COLORS.red, 0.0018);
  addBottomTerminal(scene, DEVICE_PORTS.unifiPower.dcNegative, COLORS.black, 0.0018);
  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.unifiPower.usb, 0xadb6b5, { outline: 0x384345 });
  addBottomTerminal(scene, DEVICE_PORTS.ekran.powerPositive, COLORS.red, 0.0018);
  addBottomTerminal(scene, DEVICE_PORTS.ekran.powerNegative, COLORS.black, 0.0018);
  DEVICE_PORTS.pvEntry.stringInputs.forEach((position, index) => addBottomTerminal(
    scene,
    position,
    index % 2 === 0 ? COLORS.red : COLORS.black,
    0.0045,
  ));
  addBottomTerminal(scene, DEVICE_PORTS.pvEntry.mpptPositive, COLORS.red, 0.0032);
  addBottomTerminal(scene, DEVICE_PORTS.pvEntry.mpptNegative, COLORS.black, 0.0032);
  addBottomTerminal(scene, DEVICE_PORTS.pvEntry.earth, COLORS.earth, 0.0024);
  addBottomTerminal(scene, DEVICE_PORTS.smartSolar.earth, COLORS.earth, 0.0024);
  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.smartSolar.data, COLORS.blue, { outline: 0x244c71 });
  addBottomTerminal(scene, DEVICE_PORTS.multiPlus.chassisEarth, COLORS.earth, 0.0024);
  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.multiPlus.data, COLORS.blue, { outline: 0x244c71 });
  addOutlinedBox(scene, [0.012, 0.009, 0.006], DEVICE_PORTS.multiPlus.temperatureSense, COLORS.orange, { outline: 0x8f641f });
  addBottomTerminal(scene, DEVICE_PORTS.acBoard.earth, COLORS.earth, 0.0024);
  addBottomTerminal(scene, DEVICE_PORTS.acBoard.toolCable, COLORS.threeCoreAc, 0.0065);
  addBottomTerminal(scene, DEVICE_PORTS.ekran.earth, COLORS.earth, 0.0022);
  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.ekran.veDirect1, COLORS.orange, { outline: 0x8f641f });
  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.ekran.veDirect2, COLORS.orange, { outline: 0x8f641f });
  addOutlinedBox(scene, [0.014, 0.009, 0.006], DEVICE_PORTS.ekran.veBus, COLORS.blue, { outline: 0x244c71 });
  addOutlinedBox(scene, [0.017, 0.009, 0.006], DEVICE_PORTS.ekran.ethernet, COLORS.blue, { outline: 0x244c71 });
  addOutlinedBox(scene, [0.012, 0.009, 0.006], DEVICE_PORTS.ekran.digitalInput1, COLORS.blue, { outline: 0x244c71 });
  addOutlinedBox(scene, [0.012, 0.009, 0.006], DEVICE_PORTS.ekran.digitalInput2, COLORS.blue, { outline: 0x244c71 });
}

function addAcAndGenerator(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  addGenerator(scene, pickables);
  const devices = physicalLayout.devices;
  const socket = addOutlinedBox(scene, devices.trailingSocket.size as VectorTuple, devices.trailingSocket.position as VectorTuple, 0x303638, { componentId: "toolOutlet", pickables, outline: 0x151a1c, rotation: [0, -18, 0] });
  addCylinder(socket, 0.01, 0.006, [-0.018, 0.015, 0.039], 0xd7ddd9, [90, 0, 0]);
  addCylinder(socket, 0.01, 0.006, [0.018, 0.015, 0.039], 0xd7ddd9, [90, 0, 0]);
  addBottomTerminal(scene, physicalLayout.ports.trailingSocketAcCable as VectorTuple, COLORS.threeCoreAc, 0.0065);
  addOrthogonalCable(scene, physicalLayout.routes["trailing-tool-flex"].points as VectorTuple[], COLORS.threeCoreAc, physicalLayout.routes["trailing-tool-flex"].radiusM);

  addOrthogonalCable(scene, physicalLayout.routes["generator-flex"].points as VectorTuple[], COLORS.threeCoreAc, physicalLayout.routes["generator-flex"].radiusM);
  addBottomTerminal(scene, DEVICE_PORTS.acBoard.acCable, COLORS.threeCoreAc, 0.0065);
  ["multiplus-to-ac-output-protection"].forEach((id) => {
    const route = physicalLayout.routes[id];
    addOrthogonalCable(
      scene,
      route.points as VectorTuple[],
      COLORS.threeCoreAc,
      route.radiusM,
      "context",
      false,
      wallRouteVariant(id),
    );
  });
}

function addLights(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const addUtilityFixture = (
    parent: THREE.Group,
    componentId: string,
    faceDown: boolean,
  ) => {
    const fixture = new THREE.Group();
    if (faceDown) fixture.rotation.x = radians(90);
    const housing = addOutlinedBox(fixture, [0.127, 0.055, 0.055], [0, 0.008, 0], 0x30383a, {
      componentId,
      outline: 0x101719,
      pickables,
    });
    housing.userData.componentId = componentId;
    const lens = addOutlinedBox(fixture, [0.105, 0.038, 0.01], [0, 0.008, 0.032], 0xffd99a, {
      componentId,
      emissive: 0x403015,
      outline: 0x746541,
    });
    lens.userData.componentId = componentId;
    pickables.push(lens);
    addRodBetween(fixture, [-0.048, -0.016, -0.008], [-0.048, -0.052, -0.03], 0.004, 0x89918e);
    addRodBetween(fixture, [0.048, -0.016, -0.008], [0.048, -0.052, -0.03], 0.004, 0x89918e);
    parent.add(fixture);
  };

  const indoor = physicalLayout.devices.indoorLight;
  const indoorGroup = new THREE.Group();
  indoorGroup.position.set(...indoor.position);
  // The same five-inch utility fixture is suspended from a short open bracket
  // indoors, with its lens aimed downward. No ceiling plane is required.
  addRodBetween(indoorGroup, [-0.045, 0.16, 0], [-0.045, 0.035, 0], 0.004, 0x89918e);
  addRodBetween(indoorGroup, [0.045, 0.16, 0], [0.045, 0.035, 0], 0.004, 0x89918e);
  addRodBetween(indoorGroup, [-0.065, 0.16, 0], [0.065, 0.16, 0], 0.005, 0x626b69);
  addUtilityFixture(indoorGroup, "indoorLight", true);
  scene.add(indoorGroup);
  addBottomTerminal(scene, DEVICE_PORTS.indoorLight.powerPositive, COLORS.red, 0.0018);
  addBottomTerminal(scene, DEVICE_PORTS.indoorLight.powerNegative, COLORS.black, 0.0018);

  const outdoor = physicalLayout.devices.outdoorFlood;
  const flood = new THREE.Group();
  flood.position.set(...outdoor.position);
  addUtilityFixture(flood, "outdoorLight", false);
  scene.add(flood);
  addBottomTerminal(scene, DEVICE_PORTS.outdoorFlood.powerPositive, COLORS.red, 0.0018);
  addBottomTerminal(scene, DEVICE_PORTS.outdoorFlood.powerNegative, COLORS.black, 0.0018);
}

function addBatterySystem(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const devices = physicalLayout.devices;
  ["battery1", "battery2", "battery3", "battery4"].forEach((id) => {
    addBattery(scene, id, devices[id].position as VectorTuple, pickables);
  });
  addProtectionBox(scene, "mainDc", devices.classTA.position as VectorTuple, pickables, devices.classTA.size as VectorTuple);
  addProtectionBox(scene, "mainDc", devices.classTB.position as VectorTuple, pickables, devices.classTB.size as VectorTuple);
  Object.values(DEVICE_PORTS.classT).forEach((position) => addBottomTerminal(scene, position, COLORS.red, 0.007));

  const ports = physicalLayout.ports;
  const batteryTerminals = ["aNegative", "aMidLeft", "aMidRight", "aPositive", "bNegative", "bMidLeft", "bMidRight", "bPositive"];
  batteryTerminals.forEach((id) => addFrontTerminal(scene, ports[id] as VectorTuple, id.includes("Negative") ? COLORS.black : COLORS.red, 0.008));
  ["battery-series-a", "battery-series-b", "battery-a-to-class-t", "battery-b-to-class-t"].forEach((id) => {
    addOrthogonalCable(
      scene,
      physicalLayout.routes[id].points as VectorTuple[],
      COLORS.red,
      physicalLayout.routes[id].radiusM,
      "context",
      true,
      wallRouteVariant(id),
    );
  });

  [
    ["junction-to-class-t-a", JUNCTION_PORTS.batteryPosA, junctionInteriorPath("battery-positive-a"), COLORS.red],
    ["junction-to-class-t-b", JUNCTION_PORTS.batteryPosB, junctionInteriorPath("battery-positive-b"), COLORS.red],
    ["junction-to-battery-negative-a", JUNCTION_PORTS.batteryNegA, junctionInteriorPath("battery-negative-a"), COLORS.black],
    ["junction-to-battery-negative-b", JUNCTION_PORTS.batteryNegB, junctionInteriorPath("battery-negative-b"), COLORS.black],
  ].forEach(([routeId, penetration, inside, color]) => addContinuousJunctionCable(
    scene,
    inside as VectorTuple[],
    penetration as JunctionPenetration,
    physicalLayout.routes[routeId as string].points.slice(1) as VectorTuple[],
    color as number,
    0.0065,
    true,
    false,
    true,
    wallRouteVariant(routeId as string),
  ));

  addContinuousJunctionCable(
    scene,
    junctionInteriorPath("multiplus-negative"),
    JUNCTION_PORTS.multiplusNeg,
    physicalLayout.routes["junction-to-multiplus-negative"].points.slice(1) as VectorTuple[],
    COLORS.black,
    0.0065,
    true,
    false,
    true,
    wallRouteVariant("junction-to-multiplus-negative"),
  );
  addContinuousJunctionCable(
    scene,
    junctionInteriorPath("multiplus-positive"),
    JUNCTION_PORTS.multiplusPos,
    physicalLayout.routes["junction-to-multiplus-positive"].points.slice(1) as VectorTuple[],
    COLORS.red,
    0.0065,
    true,
    false,
    true,
    wallRouteVariant("junction-to-multiplus-positive"),
  );

  [
    ["balancer-a-positive", COLORS.red],
    ["balancer-a-midpoint", COLORS.yellow],
    ["balancer-a-negative", COLORS.black],
    ["balancer-b-positive", COLORS.red],
    ["balancer-b-midpoint", COLORS.yellow],
    ["balancer-b-negative", COLORS.black],
  ].forEach(([id, color]) => {
    const route = physicalLayout.routes[id as string];
    addOrthogonalCable(scene, route.points as VectorTuple[], color as number, route.radiusM, "context", true, wallRouteVariant(id as string));
  });
  const temperatureRoute = physicalLayout.routes["multiplus-battery-temperature"];
  addOrthogonalCable(
    scene,
    temperatureRoute.points as VectorTuple[],
    COLORS.orange,
    temperatureRoute.radiusM,
    "context",
    true,
    wallRouteVariant("multiplus-battery-temperature"),
  );
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
    true,
    wallRouteVariant(id),
  ));

  addContinuousJunctionCable(
    scene,
    junctionInteriorPath("mppt-positive"),
    JUNCTION_PORTS.mpptPos,
    physicalLayout.routes["junction-to-mppt-positive"].points.slice(1) as VectorTuple[],
    COLORS.red,
    0.005,
    true,
    false,
    true,
    wallRouteVariant("junction-to-mppt-positive"),
  );
  addContinuousJunctionCable(
    scene,
    junctionInteriorPath("mppt-negative"),
    JUNCTION_PORTS.mpptNeg,
    physicalLayout.routes["junction-to-mppt-negative"].points.slice(1) as VectorTuple[],
    COLORS.black,
    0.005,
    true,
    false,
    true,
    wallRouteVariant("junction-to-mppt-negative"),
  );
}

function addDcLoadsAndData(scene: THREE.Scene) {
  // Starlink leaves through one panel-mounted DC connector and the OEM 15 m
  // white-jacketed lead. Its two conductors are visible only on the inside of
  // the enclosure, where the positive is separately breakered and switched at
  // nominal 24 V while the negative lands on the main negative bus.
  addOrthogonalCable(
    scene,
    junctionInteriorPath("starlink-jack-positive"),
    COLORS.red,
    junctionInteriorRouting.routes["starlink-jack-positive"].radiusM,
    "junction",
    false,
    "omitted",
  );
  addOrthogonalCable(
    scene,
    junctionInteriorPath("starlink-jack-negative"),
    COLORS.black,
    junctionInteriorRouting.routes["starlink-jack-negative"].radiusM,
    "junction",
    false,
    "omitted",
  );
  addOrthogonalCable(
    scene,
    physicalLayout.routes["junction-to-starlink-power-cable"].points as VectorTuple[],
    COLORS.white,
    physicalLayout.routes["junction-to-starlink-power-cable"].radiusM,
    "context",
    true,
    wallRouteVariant("junction-to-starlink-power-cable"),
  );

  const loadCircuits = [
    { number: 2, positive: "junction-to-unifi-converter-positive", negative: "junction-to-unifi-converter-negative", radius: 0.0018 },
    { number: 3, positive: "junction-to-usb-positive", negative: "junction-to-usb-negative", radius: 0.0024 },
    { number: 4, positive: "junction-to-indoor-light-positive", negative: "junction-to-indoor-light-negative", radius: 0.0018 },
    { number: 5, positive: "junction-to-outdoor-flood-positive", negative: "junction-to-outdoor-flood-negative", radius: 0.0018 },
  ];

  loadCircuits.forEach(({ number, positive, negative, radius }, index) => {
    const positivePort = JUNCTION_PORTS.loadPos[index];
    const negativePort = JUNCTION_PORTS.loadNeg[index];
    addContinuousJunctionCable(
      scene,
      junctionInteriorPath(`load-positive-${number}`),
      positivePort,
      physicalLayout.routes[positive].points.slice(1) as VectorTuple[],
      COLORS.red,
      radius,
      true,
      false,
      true,
      wallRouteVariant(positive),
    );
    addContinuousJunctionCable(
      scene,
      junctionInteriorPath(`load-negative-${number}`),
      negativePort,
      physicalLayout.routes[negative].points.slice(1) as VectorTuple[],
      COLORS.black,
      radius,
      true,
      false,
      // The solver has already moved circuit 2 onto a clear breakout lane.
      // A second greedy renderer pass would reintroduce a crossover through
      // the neighboring Ekrano fan-out instead of improving this route.
      number !== 2,
      wallRouteVariant(negative),
    );
  });

  addOrthogonalCable(
    scene,
    physicalLayout.routes["starlink-to-unifi-data"].points as VectorTuple[],
    COLORS.blue,
    physicalLayout.routes["starlink-to-unifi-data"].radiusM,
    "context",
    true,
    wallRouteVariant("starlink-to-unifi-data"),
  );
  [
    ["unifi-to-ekrano-data", 0x3f7cb8],
    ["smartsolar-to-ekrano-data", 0x3f7cb8],
    ["multiplus-to-ekrano-data", 0x3f7cb8],
    ["balancer-a-alarm", 0x3f7cb8],
    ["balancer-b-alarm", 0x3f7cb8],
    ["unifi-converter-to-unifi-power", 0x343a3d],
  ].forEach(([id, color]) => {
    const route = physicalLayout.routes[id as string];
    addOrthogonalCable(
      scene,
      route.points as VectorTuple[],
      color as number,
      route.radiusM,
      "context",
      true,
      wallRouteVariant(id as string),
    );
  });
}

function addEarthing(scene: THREE.Scene, pickables: THREE.Object3D[]) {
  const stake = addCylinder(scene, 0.025, 1.1, [0.72, -0.38, -2.58], COLORS.copper);
  stake.userData.componentId = "earth";
  pickables.push(stake);
  addOutlinedBox(scene, [0.34, 0.035, 0.34], [0.72, 0.015, -2.58], 0x8a7258, { componentId: "earth", pickables, outline: 0x5e4c3c });
  addFrontTerminal(scene, physicalLayout.ports.earthElectrode as VectorTuple, COLORS.earth, 0.003);
  addFrontTerminal(scene, physicalLayout.ports.arrayFrameEarth as VectorTuple, COLORS.earth, 0.003);
  Object.values(physicalLayout.routes)
    .filter((route) => route.kind === "earth")
    .forEach((route) => addOrthogonalCable(
      scene,
      route.points as VectorTuple[],
      COLORS.earth,
      route.radiusM,
      "context",
      true,
      wallRouteVariant(route.id),
    ));
}

function colorForVoxelRoute(routeId: string) {
  if (routeId === "unifi-converter-to-unifi-power") return 0x343a3d;
  switch (physicalLayout.routes[routeId].kind) {
    case "dc-positive":
    case "pv-positive":
      return COLORS.red;
    case "dc-negative":
    case "pv-negative":
      return COLORS.black;
    case "earth":
      return COLORS.earth;
    case "three-core-ac":
    case "two-core-dc":
      return COLORS.white;
    case "data":
      return 0x3f7cb8;
  }
}

function addVoxelWallRouting(scene: THREE.Scene) {
  Object.values(voxelRouting.voxelAStar.routes).forEach((voxelRoute) => {
    const physicalRoute = physicalLayout.routes[voxelRoute.id];
    addOrthogonalCable(
      scene,
      voxelRoute.points,
      colorForVoxelRoute(voxelRoute.id),
      physicalRoute.radiusM,
      "context",
      false,
      "voxel",
    );
  });
}

function addVoxelJunctionRouting(scene: THREE.Scene) {
  Object.values(voxelRouting.junctionVoxelAStar.routes).forEach((route) => {
    const color = route.kind === "positive" ? COLORS.red : route.kind === "negative" ? COLORS.black : COLORS.blue;
    addOrthogonalCable(
      scene,
      route.points.map((point) => junctionInteriorPoint(point)),
      color,
      route.radiusM,
      "junction",
      false,
      "voxel",
    );
  });
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
  let pickables: THREE.Object3D[] = [];
  addBuilding(scene);
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
  addVoxelWallRouting(scene);
  addVoxelJunctionRouting(scene);
  addPhysicalConnectionPorts(scene, pickables);
  flushCableMeshes(scene);

  const grid = new THREE.GridHelper(12, 24, 0x98a19c, 0xc7cbc4);
  grid.position.set(1.2, 0.011, 0);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((gridMaterial) => {
    gridMaterial.opacity = 0.24;
    gridMaterial.transparent = true;
  });
  scene.add(grid);

  const routingReport = cableRouter(scene).report();
  const labelPositions = resolveLabelPositions(scene, pickables);
  pickables = batchStaticPrimitives(scene, pickables);
  deduplicateStaticMaterials(scene);
  return {
    labelPositions,
    pickables,
    routingReport,
  };
}

function DseModel({
  onSelect,
  onSelectConnector,
}: {
  onSelect: (componentId: string) => void;
  onSelectConnector: (connector: ConnectorDetails) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLElement>());
  const cameraActionRef = useRef<(preset: CameraPreset) => void>(() => undefined);
  const [activePreset, setActivePreset] = useState<CameraPresetId>("site");
  const [labelsVisible, setLabelsVisible] = useState(false);
  const [showScaleNotes, setShowScaleNotes] = useState(false);
  const [hovered, setHovered] = useState("Drag to orbit · right/shift-drag to pan · touch: one finger orbit, two fingers pan / pinch");
  const [ready, setReady] = useState(false);
  const [routingReport, setRoutingReport] = useState<CableRoutingReport | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const mountElement = mount;
    const initializationStartedAt = performance.now();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f1e9);
    scene.fog = new THREE.Fog(0xf3f1e9, 22, 41);
    const camera = new THREE.PerspectiveCamera(39, 1, 0.02, 70);
    camera.position.set(...CAMERA_PRESETS[0].position);
    camera.lookAt(vector(CAMERA_PRESETS[0].target));

    const rendererStartedAt = performance.now();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    const rendererCreationMs = performance.now() - rendererStartedAt;
    // The scene uses only Three.js built-in materials. Skipping synchronous
    // shader log queries avoids forcing drivers without parallel compilation
    // to block merely to retrieve empty diagnostics.
    renderer.debug.checkShaderErrors = false;
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
    // Draw a useful first frame before asking the driver for the expensive
    // 4096² static shadow pass. The full-quality map is filled shortly after
    // first paint and then cached for every camera movement.
    sun.castShadow = false;
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

    const sceneBuildStartedAt = performance.now();
    const { labelPositions, pickables, routingReport: sceneRoutingReport } = buildDseScene(scene);
    const sceneBuildMs = performance.now() - sceneBuildStartedAt;
    const sceneStatistics = {
      cableMeshes: 0,
      lineSegments: 0,
      meshes: 0,
      shadowCasters: 0,
    };
    const uniqueGeometries = new Set<string>();
    const uniqueMaterials = new Set<string>();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        sceneStatistics.meshes += 1;
        if (object.castShadow) sceneStatistics.shadowCasters += 1;
        if (object.userData.modelCable) sceneStatistics.cableMeshes += 1;
      } else if (object instanceof THREE.LineSegments) {
        sceneStatistics.lineSegments += 1;
      }
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        uniqueGeometries.add(object.geometry.uuid);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((objectMaterial) => uniqueMaterials.add(objectMaterial.uuid));
      }
    });
    mountElement.dataset.profileRendererCreationMs = rendererCreationMs.toFixed(2);
    mountElement.dataset.profileSceneBuildMs = sceneBuildMs.toFixed(2);
    mountElement.dataset.sceneCableMeshes = String(sceneStatistics.cableMeshes);
    mountElement.dataset.sceneGeometries = String(uniqueGeometries.size);
    mountElement.dataset.sceneLineSegments = String(sceneStatistics.lineSegments);
    mountElement.dataset.sceneMaterials = String(uniqueMaterials.size);
    mountElement.dataset.sceneMeshes = String(sceneStatistics.meshes);
    mountElement.dataset.sceneShadowCasters = String(sceneStatistics.shadowCasters);
    mountElement.dataset.sceneBatchedDrawCalls = String(scene.userData.staticBatching?.drawCallsSaved ?? 0);
    mountElement.dataset.sceneMergedMeshGroups = String(scene.userData.staticBatching?.mergedMeshGroups ?? 0);
    mountElement.dataset.sceneMergedLineGroups = String(scene.userData.staticBatching?.mergedLineGroups ?? 0);
    mountElement.dataset.renderMode = "on-demand-static-shadows";
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
    let disposed = false;
    let frame = 0;
    let renderHeight = 0;
    let renderWidth = 0;
    let readyReported = false;
    let deferredShadowRender = false;
    let shadowTimer = 0;

    function requestSceneRender() {
      if (disposed || frame !== 0) return;
      frame = requestAnimationFrame(renderFrame);
    }

    mountElement.dataset.wallRoutingMode = "voxel-a-star";
    mountElement.dataset.visibleWallRouteCount = String(voxelRouting.voxelAStar.metrics.routeCount);

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
      onChange: requestSceneRender,
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
      const connector = object?.userData.connectorDetails as ConnectorDetails | undefined;
      const componentId = object?.userData.componentId as string | undefined;
      mountElement.dataset.hoveredComponent = componentId ?? "";
      mountElement.dataset.hoveredConnector = connector?.id ?? "";
      renderer.domElement.style.cursor = connector || componentId ? "pointer" : "grab";
      const hoverId = connector?.id ?? componentId ?? null;
      if (hoverId === hoveredId) return;
      hoveredId = hoverId;
      if (object && connector) {
        hoverHelper.setFromObject(object);
        hoverHelper.visible = true;
        setHovered(`${connector.name} · ${connector.deviceName} · click for connection details`);
      } else if (object && componentId) {
        const root = componentRoot(object);
        if (root) hoverHelper.setFromObject(root);
        hoverHelper.visible = true;
        const label = MODEL_LABELS.find((item) => item.componentId === componentId)?.label ?? componentId;
        setHovered(`${label} · click for design values`);
      } else {
        hoverHelper.visible = false;
        setHovered("Drag to orbit · right/shift-drag to pan · touch: one finger orbit, two fingers pan / pinch");
      }
      requestSceneRender();
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
      const connector = object?.userData.connectorDetails as ConnectorDetails | undefined;
      const componentId = object?.userData.componentId as string | undefined;
      if (connector) onSelectConnector(connector);
      else if (componentId) onSelect(componentId);
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
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
        const componentId = object.userData.componentId as string | undefined;
        const isExternalComponent = Boolean(componentId && !JUNCTION_FOCUS_COMPONENT_IDS.has(componentId));
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((objectMaterial) => {
          const cableVisibility = (
            objectMaterial.userData.modelCable ?? object.userData.modelCable
          ) as CableVisibility | undefined;
          const isContextCable = cableVisibility === "context";
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
      requestSceneRender();
    };

    function resize() {
      const width = mountElement.clientWidth;
      const height = mountElement.clientHeight;
      if (width < 2 || height < 2) return;
      if (width === renderWidth && height === renderHeight) return;
      renderWidth = width;
      renderHeight = height;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      if (readyReported) requestSceneRender();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(mountElement);
    resize();

    const projected = new THREE.Vector3();
    function renderFrame() {
      frame = 0;
      const firstRenderStartedAt = readyReported ? 0 : performance.now();
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
        // Keep the unclamped projected object center available for precise
        // hit testing. Labels may be clamped away from a viewport edge, so
        // their DOM rectangle is not always a reliable proxy for the mesh.
        element.dataset.anchorX = screenX.toFixed(2);
        element.dataset.anchorY = screenY.toFixed(2);
        element.dataset.onScreen = onScreen ? "true" : "false";
      });
      renderer.render(scene, camera);
      if (deferredShadowRender) {
        renderer.shadowMap.autoUpdate = false;
        deferredShadowRender = false;
        mountElement.dataset.shadowState = "cached";
        mountElement.dataset.renderCallsWithShadows = String(renderer.info.render.calls);
        mountElement.dataset.renderProgramsWithShadows = String(renderer.info.programs?.length ?? 0);
      }
      if (!readyReported) {
        mountElement.dataset.profileFirstRenderMs = (performance.now() - firstRenderStartedAt).toFixed(2);
        mountElement.dataset.profileInitializationMs = (performance.now() - initializationStartedAt).toFixed(2);
        mountElement.dataset.renderCalls = String(renderer.info.render.calls);
        mountElement.dataset.renderGeometries = String(renderer.info.memory.geometries);
        mountElement.dataset.renderPrograms = String(renderer.info.programs?.length ?? 0);
        mountElement.dataset.renderTriangles = String(renderer.info.render.triangles);
        readyReported = true;
        setReady(true);
        mountElement.dataset.shadowState = "deferred";
        shadowTimer = window.setTimeout(() => {
          if (disposed) return;
          sun.castShadow = true;
          renderer.shadowMap.autoUpdate = true;
          deferredShadowRender = true;
          requestSceneRender();
        }, 250);
      }
      if (cameraGoal.active) requestSceneRender();
    }
    renderFrame();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(shadowTimer);
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
          materials.forEach((item) => {
            if (item !== CONNECTOR_HIT_MATERIAL) item.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onSelect, onSelectConnector]);

  function choosePreset(preset: CameraPreset) {
    setActivePreset(preset.id);
    cameraActionRef.current(preset);
  }

  return (
    <section
      className={`model-shell ${labelsVisible ? "labels-visible" : "labels-hidden"} ${activePreset === "junction" ? "junction-focus" : ""}`}
      data-active-model-view={activePreset}
      data-wall-routing-mode="voxel-a-star"
      data-voxel-routing-clearance-issues={voxelRouting.voxelAStar.metrics.cableClearanceIssueCount}
      data-voxel-routing-device-front-violations={voxelRouting.voxelAStar.metrics.deviceFrontViolationCount}
      data-voxel-routing-rounded-device-front-violations={voxelRouting.voxelAStar.metrics.roundedDeviceFrontViolationCount}
      data-voxel-routing-port-violations={voxelRouting.voxelAStar.metrics.portApproachViolationCount}
      data-voxel-routing-failed-routes={voxelRouting.voxelAStar.failedRouteIds.length}
      data-voxel-junction-clearance-issues={voxelRouting.junctionVoxelAStar.metrics.cableClearanceIssueCount}
      data-voxel-junction-connector-collisions={voxelRouting.junctionVoxelAStar.metrics.connectorCollisionCount}
      data-voxel-junction-direction-reversals={voxelRouting.junctionVoxelAStar.metrics.directionReversalCount}
      data-voxel-junction-port-violations={voxelRouting.junctionVoxelAStar.metrics.portApproachViolationCount}
      data-voxel-junction-protected-front-violations={voxelRouting.junctionVoxelAStar.metrics.protectedFrontViolationCount}
      data-voxel-junction-rounded-clearance-issues={voxelRouting.junctionVoxelAStar.metrics.roundedCableClearanceIssueCount}
      data-voxel-junction-unrelated-front-violations={voxelRouting.junctionVoxelAStar.metrics.unrelatedDeviceFrontViolationCount}
      data-voxel-junction-failed-routes={voxelRouting.junctionVoxelAStar.failedRouteIds.length}
      data-model-ready={ready ? "true" : "false"}
      data-selectable-connector-count={PHYSICAL_CONNECTORS.size + JUNCTION_CONNECTORS.size}
      data-routing-backtracking-corners={routingReport?.backtrackingCorners ?? "pending"}
      data-routing-discontinuous-handoffs={routingReport?.discontinuousHandoffs ?? "pending"}
      data-routing-obstacle-intersections={routingReport?.obstacleIntersections ?? "pending"}
      data-routing-report={routingReport ? JSON.stringify(routingReport) : "pending"}
      data-routing-unresolved-crossings={routingReport?.unresolvedCableIntersections ?? "pending"}
      data-junction-routing-candidate="Voxel A* production"
      data-junction-routing-candidate-count="1"
      data-junction-routing-route-count={voxelRouting.junctionVoxelAStar.metrics.routeCount}
      data-junction-routing-wire-segment-count={voxelRouting.junctionVoxelAStar.metrics.routeCount}
      data-junction-routing-length-m={voxelRouting.junctionVoxelAStar.metrics.totalLengthM}
      data-junction-routing-bends={voxelRouting.junctionVoxelAStar.metrics.totalTurns}
      data-junction-routing-max-bends={Math.max(...Object.values(voxelRouting.junctionVoxelAStar.routes).map((route) => Math.max(0, route.points.length - 2)))}
      data-junction-routing-solid-intersections={voxelRouting.junctionVoxelAStar.metrics.protectedFrontViolationCount + voxelRouting.junctionVoxelAStar.metrics.unrelatedDeviceFrontViolationCount}
      data-junction-routing-spatial-intersections={voxelRouting.junctionVoxelAStar.metrics.roundedCableClearanceIssueCount}
      data-junction-routing-boundary-breakout-conflicts={voxelRouting.junctionVoxelAStar.metrics.portApproachViolationCount}
      data-junction-routing-coincident-overlap-m="0"
      data-junction-routing-wall-distance-cost-m2={voxelRouting.junctionVoxelAStar.metrics.wallDistanceCostM2}
      data-junction-routing-turns-3d={voxelRouting.junctionVoxelAStar.metrics.totalTurns}
      data-junction-port-approach-violations={voxelRouting.junctionVoxelAStar.metrics.portApproachViolationCount}
      data-junction-port-count={Object.keys(junctionInteriorRouting.ports).length}
      data-layout-port-approach-violations={physicalLayout.metrics.portApproachIssueCount}
      data-layout-port-count={Object.keys(physicalLayout.portSpecifications).length}
      data-junction-optimization-evaluations={junctionInteriorRouting.optimization.evaluations}
      data-junction-optimization-seconds={junctionInteriorRouting.optimization.elapsedSeconds}
      data-layout-battery-arrangement={physicalLayout.constraints.batteryArrangement}
      data-layout-battery-routing={physicalLayout.constraints.batteryRouting}
      data-layout-automatic-routes={physicalLayout.metrics.automaticRouteCount}
      data-layout-authored-wall-waypoints={physicalLayout.metrics.wallAuthoredWaypointCount}
      data-layout-junction-back-routes={physicalLayout.metrics.junctionBackRouteCount}
      data-layout-roof-planes={physicalLayout.surfaces.roofPlanes.length}
      data-layout-side-walls={physicalLayout.surfaces.sideWalls.length}
      data-layout-solver-route-count={physicalLayout.metrics.solverRouteCount}
      data-layout-generated-cable-m={voxelRouting.voxelAStar.metrics.totalLengthM}
      data-layout-wall-distance-cost-m2={voxelRouting.voxelAStar.metrics.wallDistanceCostM2}
      data-layout-optimization-status={physicalLayoutOptimization.status}
      data-layout-optimization-evaluations={physicalLayoutOptimization.evaluations}
      data-layout-optimization-seconds={physicalLayoutOptimization.elapsedSeconds}
      data-layout-optimization-improvement-percent={physicalLayoutOptimization.improvementPercent}
      data-layout-wall-overlaps={physicalLayout.metrics.wallOverlapCount}
      data-layout-wall-span-m={physicalLayout.metrics.wallDeviceSpanM}
      data-layout-wall-routing="offline-voxel-a-star-only"
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
            const visibleForView = labelsVisible && (label.views?.includes(activePreset) || !label.views);
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
              <div><dt>Verified</dt><dd>Panels, batteries, MultiPlus, SmartSolar, Ekrano, balancers, SmartShunt, Starlink and UniFi.</dd></div>
              <div><dt>User-sized</dt><dd>490 × 400 × 150 mm junction box (19.3 × 15.7 × 5.9 in), kept inside the roughly 20 × 18 in luggage envelope. The added area creates 20 mm component service aisles required by the protected-face routing rule.</dd></div>
              <div><dt>Assumed</dt><dd>5.8 m back-wall span, 3.4 × 2.5 m wall board, generator envelope and small protection boxes. Side walls and roof planes are intentionally omitted.</dd></div>
              <div><dt>Layout solver</dt><dd>A seeded two-sided stochastic position search evaluated {physicalLayoutOptimization.evaluations.toLocaleString()} complete Voxel A* reroutes in {physicalLayoutOptimization.elapsedSeconds.toFixed(1)} seconds. Gradient probes used a coarser lattice for speed; the selected placement was then solved at the production 14.4 mm cell size. The optimized wall/floor subset uses 51.76 m versus its 53.92 m starting point; the four newly A*-routed PV home runs add 5.34 m, for {voxelRouting.voxelAStar.metrics.totalLengthM.toFixed(2)} m across the complete published set. It has {voxelRouting.voxelAStar.metrics.totalTurns} turns and zero clearance contacts. All {physicalLayout.metrics.wallDeviceCount} wall devices retain the 200 mm planning margin and Ekrano remains at eye level.</dd></div>
              <div><dt>Battery placement</dt><dd>Four batteries form a floor-level 2 × 2 grid at the array-side end of the wall, minimizing the long PV-to-bank transition while keeping every terminal accessible from the front.</dd></div>
              <div><dt>Protective earth</dt><dd>The electrode, array frame and six wall-side bonds terminate at modeled studs. A visible main PE bar replaces the former floating green branch ends.</dd></div>
              <div><dt>Routing</dt><dd>Voxel A* is the sole production automatic router for all {voxelRouting.voxelAStar.metrics.routeCount} protected wall/floor connections and complete PV string home runs, plus all {voxelRouting.junctionVoxelAStar.metrics.routeCount} junction conductors. Every cable terminates on an oriented cylindrical port, meets it straight-on, and reserves its rendered radius plus clearance. Wall-device bodies are extruded through every forward routing layer, so no unrelated cable can pass through or in front of an enclosure. Short site dressings outside that obstacle field retain direct physical paths; there are no renderer-added detours or competing automatic route set.</dd></div>
              <div><dt>Publish gates</dt><dd>The {Math.round(voxelRouting.voxelAStar.cellSizeM * 1000)} mm production solve uses {voxelRouting.voxelAStar.metrics.totalLengthM.toFixed(2)} m / {voxelRouting.voxelAStar.metrics.totalTurns} turns outside and {voxelRouting.junctionVoxelAStar.metrics.totalLengthM.toFixed(2)} m / {voxelRouting.junctionVoxelAStar.metrics.totalTurns} turns inside. The two hard gates jointly report {voxelRouting.voxelAStar.failedRouteIds.length + voxelRouting.junctionVoxelAStar.failedRouteIds.length} failed routes, {voxelRouting.voxelAStar.metrics.cableClearanceIssueCount + voxelRouting.junctionVoxelAStar.metrics.cableClearanceIssueCount} clearance contacts, {voxelRouting.voxelAStar.metrics.portApproachViolationCount + voxelRouting.junctionVoxelAStar.metrics.portApproachViolationCount} invalid port approaches, and {voxelRouting.voxelAStar.metrics.deviceFrontViolationCount + voxelRouting.voxelAStar.metrics.roundedDeviceFrontViolationCount + voxelRouting.junctionVoxelAStar.metrics.protectedFrontViolationCount + voxelRouting.junctionVoxelAStar.metrics.unrelatedDeviceFrontViolationCount} device-front violations after auditing both sharp paths and rendered bend centerlines.</dd></div>
              <div><dt>Battery harness</dt><dd>The two main positive runs, two negative returns and six balancer leads are routed first as a constrained rectilinear bundle. The rear-bank negative egress is reserved before the balancer conductors, eliminating the former multi-pass ordering cycle while preserving zero cable contacts.</dd></div>
              <div><dt>Junction harness</dt><dd>A deterministic service-aisle pack places {Object.keys(junctionInteriorRouting.components).length} components above one evenly spread bottom row of 14 glands and one jack. Voxel A* reserves each rounded cable at full radius plus a 1 mm air gap, every foreign connector and gland body, every future connector&apos;s one-way approach, and the complete projected face of every unrelated device. The production harness contains {voxelRouting.junctionVoxelAStar.metrics.routeCount} conductors, {Object.keys(junctionInteriorRouting.ports).length} selectable ports, {voxelRouting.junctionVoxelAStar.metrics.totalLengthM.toFixed(2)} m of wire and {voxelRouting.junctionVoxelAStar.metrics.totalTurns} turns. Its connector, reversal, protected-face, unrelated-face, rounded-clearance and port-approach audits all report zero.</dd></div>
              <div><dt>Geometry</dt><dd>Each rounded cable follows one continuous sampled centerline, so adjacent bends share polygon rings without gaps. At the enclosure boundary, the junction and faded-context surfaces split on the same ring rather than creating a broken elbow.</dd></div>
              <div><dt>Camera</dt><dd>The visible XYZ point below the mouse or touch gesture becomes the grab point. Upright yaw/pitch rotation orbits around it without roll; scrolling or pinching zooms along its camera vector. One finger rotates, while two fingers pan and pinch-zoom at picked depth.</dd></div>
              <div><dt>Routing audit</dt><dd>{routingReport ? `${voxelRouting.voxelAStar.metrics.routeCount + voxelRouting.junctionVoxelAStar.metrics.routeCount} Voxel A* conductors · 0 device-front violations · 0 rounded-cable clearance contacts · 0 invalid port approaches · ${routingReport.roundedCorners} rendered rounded bends · ${routingReport.discontinuousHandoffs} broken handoffs.` : "Checking rendered cable geometry…"}</dd></div>
              <div><dt>Legibility</dt><dd>Small wires are widened slightly. Final bend radii, gland sizing and clearances still require the actual parts and a full-size mock-up.</dd></div>
            </dl>
          </aside>
        )}
        <div className="model-wire-legend" aria-label="Visible conductor colors">
          <span><i className="wire-red" />DC positive</span>
          <span><i className="wire-black" />DC negative</span>
          <span><i className="wire-blue" />Data / control</span>
          <span><i className="wire-green" />Protective earth</span>
          <span><i className="wire-white" />Sheathed DC / 3-core AC flex</span>
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
  dseMounted,
  onSelect,
  onSelectConnector,
  onOpenDse,
}: {
  system: PhysicalModelSystem;
  dseMounted: boolean;
  onSelect: (componentId: string) => void;
  onSelectConnector: (connector: ConnectorDetails) => void;
  onOpenDse: () => void;
}) {
  return (
    <>
      {dseMounted && (
        <div className="persisted-dse-model" hidden={system.id !== "dse"}>
          <DseModel onSelect={onSelect} onSelectConnector={onSelectConnector} />
        </div>
      )}
      {system.id !== "dse" && (
      <section className="model-unavailable">
        <div>
          <span>Physical fit model</span>
          <h1>The measured 3D layout currently represents DSE.</h1>
          <p>The PG installation remains available in its verified diagram and BOM views; it has not been assigned speculative site geometry.</p>
          <button type="button" onClick={onOpenDse}>Open the DSE 3D model</button>
        </div>
      </section>
      )}
    </>
  );
}
