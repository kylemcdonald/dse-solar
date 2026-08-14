export type LayoutVector = [number, number, number];

export type PhysicalDevice = {
  id: string;
  position: LayoutVector;
  size: LayoutVector;
  mounting: "wall" | "floor" | "array" | "exterior" | "hanging";
};

export type PhysicalCableRoute = {
  id: string;
  kind: "dc-positive" | "dc-negative" | "data" | "earth" | "pv-positive" | "pv-negative" | "three-core-ac";
  points: LayoutVector[];
  radiusM: number;
  conductors: number;
  lengthM: number;
  planarDirectionReversals: number;
};

export type PhysicalLayoutInput = {
  deviceOverrides?: Record<string, Partial<Pick<PhysicalDevice, "position">>>;
};

export type PhysicalLayoutSpecification = {
  revision: string;
  coordinateSystem: string;
  devices: Record<string, PhysicalDevice>;
  ports: Record<string, LayoutVector>;
  routes: Record<string, PhysicalCableRoute>;
  surfaces: {
    backWall: { center: LayoutVector; size: LayoutVector };
    equipmentBoard: { center: LayoutVector; size: LayoutVector; frontZ: number };
    floorPlanes: Array<{ center: LayoutVector; size: LayoutVector }>;
    sideWalls: [];
    roofPlanes: [];
  };
  metrics: {
    totalRenderedCableM: number;
    cableByKindM: Record<string, number>;
    wallDeviceSpanM: number;
    wallDeviceCount: number;
    wallOverlapCount: number;
    wallOverlapIssues: string[];
    junctionBackRouteCount: number;
    planarDirectionReversals: number;
    planarReversalIssues: string[];
    solverRouteCount: number;
    wallSpanPenaltyM: number;
    score: number;
  };
  constraints: {
    batteryArrangement: "floor-2x2";
    junctionBackClearance: "flush-no-cables";
    removableSurfaces: { sideWalls: true; roof: true };
    wallLayout: "compact-review-layout";
  };
};

const round = (value: number, places = 4) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const distance = (first: LayoutVector, second: LayoutVector) => Math.hypot(
  second[0] - first[0],
  second[1] - first[1],
  second[2] - first[2],
);

export function routeLength(points: LayoutVector[]) {
  return round(points.slice(1).reduce(
    (sum, point, index) => sum + distance(points[index], point),
    0,
  ));
}

export function axisDirectionReversals(points: LayoutVector[], axis: 0 | 1 | 2) {
  const directions = points.slice(1).flatMap((point, index) => {
    const delta = point[axis] - points[index][axis];
    if (Math.abs(delta) < 0.0001) return [];
    return [Math.sign(delta)];
  });
  return directions.slice(1).reduce(
    (count, direction, index) => count + (direction !== directions[index] ? 1 : 0),
    0,
  );
}

export function planarDirectionReversals(points: LayoutVector[]) {
  return axisDirectionReversals(points, 0) + axisDirectionReversals(points, 1);
}

function wallCenterZ(boardFrontZ: number, depth: number, mountingGapM = 0.004) {
  return round(boardFrontZ + mountingGapM + depth / 2);
}

function createDevice(
  id: string,
  position: LayoutVector,
  size: LayoutVector,
  mounting: PhysicalDevice["mounting"],
): PhysicalDevice {
  return { id, position, size, mounting };
}

function createRoute(
  id: string,
  kind: PhysicalCableRoute["kind"],
  points: LayoutVector[],
  radiusM: number,
  conductors = 1,
): PhysicalCableRoute {
  return {
    id,
    kind,
    points,
    radiusM,
    conductors,
    lengthM: routeLength(points),
    planarDirectionReversals: planarDirectionReversals(points),
  };
}

function frontPort(device: PhysicalDevice, offsetX: number, offsetY: number, protrusion = 0.006): LayoutVector {
  return [
    round(device.position[0] + offsetX),
    round(device.position[1] + offsetY),
    round(device.position[2] + device.size[2] / 2 + protrusion),
  ];
}

function busbarStud(device: PhysicalDevice, index: number, studCount: number): LayoutVector {
  const spacing = 0.106 / Math.max(1, studCount - 1);
  return [
    round(device.position[0] - 0.053 + spacing * index),
    device.position[1],
    round(device.position[2] + 0.035),
  ];
}

function wallOverlapIssues(devices: Record<string, PhysicalDevice>) {
  const wallDevices = Object.values(devices).filter((device) => device.mounting === "wall");
  const issues: string[] = [];
  const clearance = 0.025;
  for (let firstIndex = 0; firstIndex < wallDevices.length; firstIndex += 1) {
    const first = wallDevices[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < wallDevices.length; secondIndex += 1) {
      const second = wallDevices[secondIndex];
      const overlapX = Math.abs(first.position[0] - second.position[0]) <
        (first.size[0] + second.size[0]) / 2 + clearance;
      const overlapY = Math.abs(first.position[1] - second.position[1]) <
        (first.size[1] + second.size[1]) / 2 + clearance;
      if (overlapX && overlapY) issues.push(`${first.id}:${second.id}`);
    }
  }
  return issues;
}

function withOverrides(
  devices: Record<string, PhysicalDevice>,
  overrides: PhysicalLayoutInput["deviceOverrides"],
) {
  if (!overrides) return devices;
  Object.entries(overrides).forEach(([id, override]) => {
    if (!devices[id] || !override.position) return;
    devices[id] = { ...devices[id], position: [...override.position] as LayoutVector };
  });
  return devices;
}

function routeOccupiesJunctionBack(route: PhysicalCableRoute, junction: PhysicalDevice, boardFrontZ: number) {
  const left = junction.position[0] - junction.size[0] / 2;
  const right = junction.position[0] + junction.size[0] / 2;
  const bottom = junction.position[1] - junction.size[1] / 2;
  const top = junction.position[1] + junction.size[1] / 2;
  const boxBackZ = junction.position[2] - junction.size[2] / 2;
  return route.points.slice(0, -1).some((start, index) => {
    const end = route.points[index + 1];
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      const point: LayoutVector = [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t,
      ];
      if (
        point[0] > left && point[0] < right &&
        point[1] > bottom && point[1] < top &&
        point[2] >= boardFrontZ - 0.002 && point[2] <= boxBackZ + route.radiusM
      ) return true;
    }
    return false;
  });
}

export function solvePhysicalLayout(input: PhysicalLayoutInput = {}): PhysicalLayoutSpecification {
  const backWall = { center: [4.1, 1.5, -2.2] as LayoutVector, size: [5.8, 3, 0.08] as LayoutVector };
  const equipmentBoard = {
    center: [2.95, 1.5, -2.13] as LayoutVector,
    size: [3.4, 2.5, 0.018] as LayoutVector,
    frontZ: -2.121,
  };
  const z = (depth: number) => wallCenterZ(equipmentBoard.frontZ, depth);

  const devices = withOverrides({
    equipmentBoard: createDevice("equipmentBoard", equipmentBoard.center, equipmentBoard.size, "wall"),
    generatorInlet: createDevice("generatorInlet", [1.42, 0.42, z(0.1)], [0.14, 0.18, 0.1], "wall"),
    pvEntry: createDevice("pvEntry", [1.72, 0.5, z(0.12)], [0.25, 0.3, 0.12], "wall"),
    smartSolar: createDevice("smartSolar", [2.15, 0.55, z(0.103)], [0.295, 0.216, 0.103], "wall"),
    multiPlus: createDevice("multiPlus", [2.08, 1.92, z(0.141)], [0.268, 0.499, 0.141], "wall"),
    acBoard: createDevice("acBoard", [2.38, 1.75, z(0.1)], [0.22, 0.18, 0.1], "wall"),
    junction: createDevice("junction", [3.45, 1.68, z(0.15)], [0.35, 0.247, 0.15], "wall"),
    ekran: createDevice("ekran", [3.45, 2.06, z(0.0298)], [0.187, 0.124, 0.0298], "wall"),
    unifi: createDevice("unifi", [3.68, 2.06, z(0.03)], [0.098, 0.098, 0.03], "wall"),
    usb: createDevice("usb", [3.82, 2.06, z(0.04)], [0.08, 0.04, 0.04], "wall"),
    orion: createDevice("orion", [3.77, 1.68, z(0.08)], [0.186, 0.13, 0.08], "wall"),
    balancerA: createDevice("balancerA", [3.9, 0.75, z(0.047)], [0.113, 0.1, 0.047], "wall"),
    balancerB: createDevice("balancerB", [4.08, 0.75, z(0.047)], [0.113, 0.1, 0.047], "wall"),
    classTA: createDevice("classTA", [3.48, 0.53, z(0.06)], [0.15, 0.055, 0.06], "wall"),
    classTB: createDevice("classTB", [3.78, 0.53, z(0.06)], [0.15, 0.055, 0.06], "wall"),
    earthBar: createDevice("earthBar", [2.115, 1.16, z(0.026)], [0.14, 0.025, 0.026], "wall"),
    trailingSocket: createDevice("trailingSocket", [2.54, 1.48, -1.94], [0.09, 0.13, 0.07], "hanging"),
    generator: createDevice("generator", [0.15, 0.28, -2.8], [0.6, 0.56, 0.48], "exterior"),
    battery1: createDevice("battery1", [3.14, 0.11, -1.8], [0.52, 0.22, 0.238], "floor"),
    battery2: createDevice("battery2", [3.7, 0.11, -1.8], [0.52, 0.22, 0.238], "floor"),
    battery3: createDevice("battery3", [3.14, 0.11, -1.47], [0.52, 0.22, 0.238], "floor"),
    battery4: createDevice("battery4", [3.7, 0.11, -1.47], [0.52, 0.22, 0.238], "floor"),
    starlink: createDevice("starlink", [4.45, 3.36, -2.04], [0.2985, 0.0385, 0.259], "exterior"),
  }, input.deviceOverrides);

  const ports: Record<string, LayoutVector> = {
    pvEntryStringAPositive: frontPort(devices.pvEntry, -0.09, -0.156),
    pvEntryStringANegative: frontPort(devices.pvEntry, -0.045, -0.156),
    pvEntryStringBPositive: frontPort(devices.pvEntry, 0, -0.156),
    pvEntryStringBNegative: frontPort(devices.pvEntry, 0.045, -0.156),
    pvEntryMpptPositive: frontPort(devices.pvEntry, 0.06, -0.08),
    pvEntryMpptNegative: frontPort(devices.pvEntry, 0.1, -0.08),
    smartSolarPvPositive: frontPort(devices.smartSolar, -0.1, -0.114),
    smartSolarPvNegative: frontPort(devices.smartSolar, -0.065, -0.114),
    smartSolarBatteryPositive: frontPort(devices.smartSolar, -0.015, -0.114),
    smartSolarBatteryNegative: frontPort(devices.smartSolar, 0.03, -0.114),
    multiPlusDcPositive: frontPort(devices.multiPlus, -0.115, -0.258),
    multiPlusDcNegative: frontPort(devices.multiPlus, -0.083, -0.258),
    generatorInletAcCable: frontPort(devices.generatorInlet, 0.076, 0),
    multiPlusAcInputCable: frontPort(devices.multiPlus, -0.019, -0.258),
    multiPlusAcOutputCable: frontPort(devices.multiPlus, 0.077, -0.258),
    acBoardAcCable: frontPort(devices.acBoard, 0, -0.096),
    orionInputPositive: frontPort(devices.orion, -0.06, -0.07),
    orionInputNegative: frontPort(devices.orion, -0.02, -0.07),
    orionOutputPositive: frontPort(devices.orion, 0.02, -0.07),
    orionOutputNegative: frontPort(devices.orion, 0.06, -0.07),
    ekranPowerPositive: frontPort(devices.ekran, -0.07, -0.07),
    ekranPowerNegative: frontPort(devices.ekran, -0.042, -0.07),
    ekranVeDirect: frontPort(devices.ekran, -0.014, -0.07),
    ekranVeCan: frontPort(devices.ekran, 0.014, -0.07),
    ekranVeBus: frontPort(devices.ekran, 0.042, -0.07),
    ekranEthernet: frontPort(devices.ekran, 0.07, -0.07),
    unifiPower: frontPort(devices.unifi, -0.035, -0.06),
    unifiWan: frontPort(devices.unifi, 0.005, -0.06),
    unifiLan: frontPort(devices.unifi, 0.04, -0.06),
    usbPositive: frontPort(devices.usb, -0.02, -0.022),
    usbNegative: frontPort(devices.usb, 0.02, -0.022),
    usbReservedUsbC: frontPort(devices.usb, -0.022, 0),
    starlinkEthernet: [
      round(devices.starlink.position[0] + 0.04),
      round(devices.starlink.position[1] - 0.05),
      devices.starlink.position[2],
    ],
    earthElectrode: [0.72, 0.1, -2.58],
    arrayFrameEarth: [-1.67, 0.13, -2.28],
    pvEntryEarth: frontPort(devices.pvEntry, 0.08, -0.156),
    smartSolarEarth: frontPort(devices.smartSolar, 0.1, -0.114),
    multiPlusChassisEarth: frontPort(devices.multiPlus, 0.12, -0.19),
    acBoardEarth: frontPort(devices.acBoard, 0.05, -0.096),
    ekranEarth: frontPort(devices.ekran, 0.101, 0),
    classTAInput: frontPort(devices.classTA, -0.055, 0),
    classTAOutput: frontPort(devices.classTA, 0.055, 0),
    classTBInput: frontPort(devices.classTB, -0.055, 0),
    classTBOutput: frontPort(devices.classTB, 0.055, 0),
  };
  for (let index = 0; index < 7; index += 1) {
    ports[`earthBar${index + 1}`] = busbarStud(devices.earthBar, index, 7);
  }

  const wallZ = -2.086;
  const routes: Record<string, PhysicalCableRoute> = {};
  const addRoute = (
    id: string,
    kind: PhysicalCableRoute["kind"],
    points: LayoutVector[],
    radiusM: number,
    conductors = 1,
  ) => { routes[id] = createRoute(id, kind, points, radiusM, conductors); };

  const stringAHomePositive: LayoutVector = [0.69, 0.68, -1.62];
  const stringAHomeNegative: LayoutVector = [0.69, 0.58, -1.62];
  const stringBHomePositive: LayoutVector = [0.72, 0.72, -1.55];
  const stringBHomeNegative: LayoutVector = [0.69, 0.52, -1.62];
  addRoute("pv-string-a-positive", "pv-positive", [[0.559, 0.925, -1.18], [0.69, 0.925, -1.18], stringAHomePositive], 0.0055);
  addRoute("pv-string-a-negative", "pv-negative", [[-1.659, 0.205, -1.18], [-1.659, 0.14, -1.55], [0.66, 0.14, -1.55], stringAHomeNegative], 0.0055);
  addRoute("pv-string-b-positive", "pv-positive", [[0.559, 0.925, 1.18], [0.72, 0.925, 1.18], stringBHomePositive], 0.0055);
  addRoute("pv-string-b-negative", "pv-negative", [[-1.659, 0.205, 1.18], [-1.76, 0.12, 1.18], [-1.76, 0.12, -1.5], [0.63, 0.12, -1.5], stringBHomeNegative], 0.0055);

  // Each string keeps its own complete red/black 4 mm² home run. All four
  // conductors enter one indoor enclosure, where they are combined behind the
  // DC disconnect and Type 2 SPD. There is no separate array-side box.
  addRoute("pv-home-run-a-positive", "pv-positive", [stringAHomePositive, [1.06, 0.68, -1.62], [1.06, 0.18, -1.86], [1.28, 0.18, wallZ], [1.28, 0.36, wallZ], [ports.pvEntryStringAPositive[0], 0.36, wallZ], ports.pvEntryStringAPositive], 0.005);
  addRoute("pv-home-run-a-negative", "pv-negative", [stringAHomeNegative, [1.09, 0.58, -1.62], [1.09, 0.21, -1.84], [1.31, 0.21, wallZ + 0.016], [1.31, 0.33, wallZ + 0.016], [ports.pvEntryStringANegative[0], 0.33, wallZ + 0.016], ports.pvEntryStringANegative], 0.005);
  addRoute("pv-home-run-b-positive", "pv-positive", [stringBHomePositive, [1.12, 0.72, -1.55], [1.12, 0.24, -1.82], [1.34, 0.24, wallZ + 0.032], [1.34, 0.3, wallZ + 0.032], [ports.pvEntryStringBPositive[0], 0.3, wallZ + 0.032], ports.pvEntryStringBPositive], 0.005);
  addRoute("pv-home-run-b-negative", "pv-negative", [stringBHomeNegative, [1.15, 0.52, -1.62], [1.15, 0.27, -1.8], [1.37, 0.27, wallZ + 0.048], [ports.pvEntryStringBNegative[0], 0.27, wallZ + 0.048], ports.pvEntryStringBNegative], 0.005);

  addRoute("pv-entry-to-mppt-positive", "pv-positive", [ports.pvEntryMpptPositive, [1.96, 0.42, wallZ], [ports.smartSolarPvPositive[0], 0.42, wallZ], ports.smartSolarPvPositive], 0.0055);
  addRoute("pv-entry-to-mppt-negative", "pv-negative", [ports.pvEntryMpptNegative, [1.99, 0.45, wallZ], [ports.smartSolarPvNegative[0], 0.45, wallZ], ports.smartSolarPvNegative], 0.0055);

  addRoute("generator-flex", "three-core-ac", [[0.39, 0.18, -2.8], [0.86, 0.12, -2.8], [0.86, 0.12, -2.35], [1.14, 0.12, -2.35], [1.14, 0.42, -2.18], [1.25, 0.42, -2.18], [1.25, 0.42, -2.02], [1.33, 0.42, -2.02]], 0.011, 3);
  addRoute("trailing-tool-flex", "three-core-ac", [[2.49, 1.72, -2.01], [2.49, 1.6, -1.99], [2.51, 1.48, -1.97]], 0.011, 3);
  addRoute("generator-inlet-to-multiplus-ac", "three-core-ac", [ports.generatorInletAcCable, [1.56, 0.42, wallZ + 0.07], [1.56, 1.58, wallZ + 0.07], [ports.multiPlusAcInputCable[0], 1.58, wallZ + 0.07], ports.multiPlusAcInputCable], 0.011, 3);
  addRoute("multiplus-to-ac-output-protection", "three-core-ac", [ports.multiPlusAcOutputCable, [ports.multiPlusAcOutputCable[0], 1.62, wallZ + 0.15], [ports.acBoardAcCable[0], 1.62, wallZ + 0.15], ports.acBoardAcCable], 0.011, 3);

  const batteryTerminalY = 0.257;
  const batteryTerminals = {
    aNegative: [2.97, batteryTerminalY, -1.745] as LayoutVector,
    aMidLeft: [3.31, batteryTerminalY, -1.745] as LayoutVector,
    aMidRight: [3.53, batteryTerminalY, -1.745] as LayoutVector,
    aPositive: [3.87, batteryTerminalY, -1.745] as LayoutVector,
    bNegative: [2.97, batteryTerminalY, -1.415] as LayoutVector,
    bMidLeft: [3.31, batteryTerminalY, -1.415] as LayoutVector,
    bMidRight: [3.53, batteryTerminalY, -1.415] as LayoutVector,
    bPositive: [3.87, batteryTerminalY, -1.415] as LayoutVector,
  };
  Object.assign(ports, batteryTerminals);
  addRoute("battery-series-a", "dc-positive", [batteryTerminals.aMidLeft, batteryTerminals.aMidRight], 0.009);
  addRoute("battery-series-b", "dc-positive", [batteryTerminals.bMidLeft, batteryTerminals.bMidRight], 0.009);
  addRoute("battery-a-to-class-t", "dc-positive", [batteryTerminals.aPositive, [4.08, batteryTerminalY, -1.745], [4.08, 0.53, -1.93], [ports.classTAInput[0], 0.53, -1.93], ports.classTAInput], 0.009);
  addRoute("battery-b-to-class-t", "dc-positive", [batteryTerminals.bPositive, [4.13, batteryTerminalY, -1.415], [4.13, 0.48, -1.91], [ports.classTBInput[0], 0.48, -1.91], ports.classTBInput], 0.009);

  // These four 24 V routes leave the right-side glands, stay in front of the
  // flush enclosure, clear its top edge, and only then settle into wall lanes.
  // Their explicit front-bypass is a hard layout constraint: no conductor may
  // occupy the inaccessible space between junction box and plywood.
  const junctionFrontZ = round(devices.junction.position[2] + devices.junction.size[2] / 2 + 0.018);
  const junctionRightX = round(devices.junction.position[0] + devices.junction.size[0] / 2 + 0.045);
  const junctionTopY = round(devices.junction.position[1] + devices.junction.size[1] / 2);
  const junctionGlands: Record<string, LayoutVector> = {
    mpptPositive: [3.642, 1.772, devices.junction.position[2]],
    mpptNegative: [3.642, 1.746, devices.junction.position[2]],
    multiPlusPositive: [3.642, 1.716, devices.junction.position[2]],
    multiPlusNegative: [3.642, 1.682, devices.junction.position[2]],
  };
  const frontBypass = (
    gland: LayoutVector,
    lane: number,
    destination: LayoutVector,
    routeX: number,
    approachY: number,
  ): LayoutVector[] => {
    const clearY = round(junctionTopY + 0.055 + lane * 0.03);
    const clearX = round(junctionRightX + lane * 0.022);
    const frontZ = round(junctionFrontZ + lane * 0.021);
    return [
      gland,
      [gland[0], gland[1], frontZ],
      [clearX, gland[1], frontZ],
      [clearX, clearY, frontZ],
      [routeX, clearY, frontZ],
      [routeX, approachY, frontZ],
      [destination[0], approachY, frontZ],
      [destination[0], destination[1], frontZ],
      destination,
    ];
  };
  addRoute("junction-to-mppt-positive", "dc-positive", frontBypass(junctionGlands.mpptPositive, 0, ports.smartSolarBatteryPositive, 2.58, 0.75), 0.0065);
  addRoute("junction-to-mppt-negative", "dc-negative", frontBypass(junctionGlands.mpptNegative, 1, ports.smartSolarBatteryNegative, 2.64, 0.79), 0.0065);
  addRoute("junction-to-multiplus-positive", "dc-positive", frontBypass(junctionGlands.multiPlusPositive, 2, ports.multiPlusDcPositive, 1.86, 1.54), 0.0085);
  addRoute("junction-to-multiplus-negative", "dc-negative", frontBypass(junctionGlands.multiPlusNegative, 3, ports.multiPlusDcNegative, 1.82, 1.5), 0.0085);

  // The Starlink data cable descends on the Starlink side, moves into one
  // clear plane in front of the wall wiring, and then travels directly left to
  // the UniFi WAN port. It never overshoots UniFi and doubles back.
  addRoute("starlink-to-unifi-data", "data", [
    ports.starlinkEthernet,
    [ports.starlinkEthernet[0], 2.48, ports.starlinkEthernet[2]],
    [ports.starlinkEthernet[0], 2.48, -1.99],
    [3.79, 2.48, -1.99],
    [3.79, 1.94, -1.99],
    [ports.unifiWan[0], 1.94, -1.99],
    [ports.unifiWan[0], ports.unifiWan[1], -1.99],
    ports.unifiWan,
  ], 0.0038);

  // Protective earth is a visible terminal-to-terminal topology. The earth
  // electrode and array frame meet at the electrode, while every wall branch
  // lands on a dedicated stud of the main PE bar; no green run ends in space.
  addRoute("earth-electrode-to-main-bar", "earth", [
    ports.earthElectrode,
    [1.08, 0.1, -2.58],
    [1.08, 0.1, -2.055],
    [1.18, 0.1, -2.055],
    [1.18, devices.earthBar.position[1], -2.055],
    [ports.earthBar1[0], devices.earthBar.position[1], -2.055],
    ports.earthBar1,
  ], 0.0055);
  addRoute("earth-electrode-to-array-frame", "earth", [
    ports.earthElectrode,
    [0.58, 0.1, -2.58],
    [0.58, 0.13, -2.28],
    ports.arrayFrameEarth,
  ], 0.0055);
  addRoute("earth-bar-to-pv-entry", "earth", [
    ports.earthBar2,
    [ports.earthBar2[0], 0.93, -2.045],
    [ports.pvEntryEarth[0], 0.93, -2.045],
    [ports.pvEntryEarth[0], ports.pvEntryEarth[1], -2.045],
    ports.pvEntryEarth,
  ], 0.0045);
  addRoute("earth-bar-to-smartsolar", "earth", [
    ports.earthBar3,
    [ports.earthBar3[0], 0.87, -2.04],
    [ports.smartSolarEarth[0], 0.87, -2.04],
    [ports.smartSolarEarth[0], ports.smartSolarEarth[1], -2.04],
    ports.smartSolarEarth,
  ], 0.0045);
  addRoute("earth-bar-to-multiplus", "earth", [
    ports.earthBar4,
    [ports.earthBar4[0], 1.34, -2.035],
    [ports.multiPlusChassisEarth[0], 1.34, -2.035],
    [ports.multiPlusChassisEarth[0], ports.multiPlusChassisEarth[1], -2.035],
    ports.multiPlusChassisEarth,
  ], 0.0045);
  addRoute("earth-bar-to-ac-board", "earth", [
    ports.earthBar5,
    [ports.earthBar5[0], 1.29, -2.03],
    [ports.acBoardEarth[0], 1.29, -2.03],
    [ports.acBoardEarth[0], ports.acBoardEarth[1], -2.03],
    ports.acBoardEarth,
  ], 0.0045);
  addRoute("earth-bar-to-ekrano", "earth", [
    ports.earthBar6,
    [2.98, ports.earthBar6[1], -2.025],
    [2.98, 2.26, -2.025],
    [3.59, 2.26, -2.025],
    [3.59, ports.ekranEarth[1], -2.025],
    ports.ekranEarth,
  ], 0.0042);

  const cableByKindM: Record<string, number> = {};
  Object.values(routes).forEach((route) => {
    cableByKindM[route.kind] = round((cableByKindM[route.kind] ?? 0) + route.lengthM);
  });
  const totalRenderedCableM = round(Object.values(routes).reduce((sum, route) => sum + route.lengthM, 0));
  const wallDevices = Object.values(devices).filter((device) => device.mounting === "wall" && device.id !== "equipmentBoard");
  const wallLeft = Math.min(...wallDevices.map((device) => device.position[0] - device.size[0] / 2));
  const wallRight = Math.max(...wallDevices.map((device) => device.position[0] + device.size[0] / 2));
  const overlapIssues = wallOverlapIssues(devices).filter((issue) => !issue.includes("equipmentBoard"));
  const junctionBackRouteCount = Object.values(routes).filter((route) => (
    routeOccupiesJunctionBack(route, devices.junction, equipmentBoard.frontZ)
  )).length;
  const planarReversalIssues = Object.values(routes)
    .filter((route) => route.planarDirectionReversals > 0)
    .map((route) => `${route.id}:${route.planarDirectionReversals}`);
  const planarReversalCount = Object.values(routes).reduce(
    (sum, route) => sum + route.planarDirectionReversals,
    0,
  );
  const wallSpanPenaltyM = round((wallRight - wallLeft) * 0.35);
  const score = round(
    totalRenderedCableM + wallSpanPenaltyM + overlapIssues.length * 100 + junctionBackRouteCount * 200,
  );

  return {
    revision: "layout-solver-r4",
    coordinateSystem: "metres; +X right along wall, +Y up, +Z toward viewer/south",
    devices,
    ports,
    routes,
    surfaces: {
      backWall,
      equipmentBoard,
      floorPlanes: [
        { center: [-1.55, -0.03, 0], size: [5.5, 0.04, 8] },
        { center: [4.1, -0.02, 0], size: [5.8, 0.06, 4.4] },
      ],
      sideWalls: [],
      roofPlanes: [],
    },
    metrics: {
      totalRenderedCableM,
      cableByKindM,
      wallDeviceSpanM: round(wallRight - wallLeft),
      wallDeviceCount: wallDevices.length,
      wallOverlapCount: overlapIssues.length,
      wallOverlapIssues: overlapIssues,
      junctionBackRouteCount,
      planarDirectionReversals: planarReversalCount,
      planarReversalIssues,
      solverRouteCount: Object.keys(routes).length,
      wallSpanPenaltyM,
      score,
    },
    constraints: {
      batteryArrangement: "floor-2x2",
      junctionBackClearance: "flush-no-cables",
      removableSurfaces: { sideWalls: true, roof: true },
      wallLayout: "compact-review-layout",
    },
  };
}

export const physicalLayout = solvePhysicalLayout();
