import {
  junctionInteriorRouting,
  type JunctionInteriorRouting,
  type JunctionPoint2,
  type JunctionPoint3,
} from "./junctionInteriorRouting.ts";

export const EXPANDED_JUNCTION_INNER_SIZE_M = [0.46, 0.37, 0.138] as const;
export const EXPANDED_JUNCTION_OUTER_SIZE_M = [0.49, 0.4, 0.15] as const;

const COMPONENT_CENTERS: Record<string, JunctionPoint2> = {
  switchPanel: [-0.2, 0.13],
  selector: [-0.125, 0.14],
  positiveBus: [0.105, 0.135],
  ekranoFuse: [-0.2, 0.04],
  shunt: [-0.1, 0.035],
  mpptFuse: [0.015, 0.035],
  returnBus: [0.15, 0.05],
  negativeBus: [-0.105, -0.085],
  fuseBlock: [0.145, -0.085],
};

const INNER_BOTTOM_M = -EXPANDED_JUNCTION_INNER_SIZE_M[1] / 2;
const GLAND_TERMINAL_Y_M = INNER_BOTTOM_M + 0.0125;
const GLAND_EDGE_CLEARANCE_M = 0.012;

// Keep every enclosure penetration on one readable, drillable row. The order
// follows the horizontal location of the internal destination it serves, which
// gives A* a useful starting topology without authored cable waypoints.
const SINGLE_ROW_GLAND_ORDER = [
  "ekrano-power",
  "battery-a-negative",
  "starlink-jack",
  "battery-b-negative",
  "battery-a-positive",
  "multiplus-negative",
  "battery-b-positive",
  "ekrano-data",
  "mppt-negative",
  "unifi-power",
  "inside-light",
  "outside-light",
  "mppt-positive",
  "multiplus-positive",
  "usb-power",
] as const;

export function buildExpandedJunctionRouting(
  source: JunctionInteriorRouting = junctionInteriorRouting,
): JunctionInteriorRouting {
  const components = Object.fromEntries(Object.entries(source.components).map(([id, component]) => [id, {
    center: [...(COMPONENT_CENTERS[id] ?? component.center)] as JunctionPoint2,
    size: [...component.size] as JunctionPoint2,
  }]));
  const componentDelta = Object.fromEntries(Object.keys(components).map((id) => [id, [
    components[id].center[0] - source.components[id].center[0],
    components[id].center[1] - source.components[id].center[1],
  ] as JunctionPoint2]));
  const totalGlandWidth = SINGLE_ROW_GLAND_ORDER.reduce((sum, id) => (
    sum + source.glands[id].diameterM
  ), 0);
  const usableWidth = EXPANDED_JUNCTION_INNER_SIZE_M[0] - GLAND_EDGE_CLEARANCE_M * 2;
  const interGlandGap = (usableWidth - totalGlandWidth) / (SINGLE_ROW_GLAND_ORDER.length - 1);
  let glandCursor = -EXPANDED_JUNCTION_INNER_SIZE_M[0] / 2 + GLAND_EDGE_CLEARANCE_M;
  const glands = Object.fromEntries(SINGLE_ROW_GLAND_ORDER.map((id) => {
    const sourceGland = source.glands[id];
    const x = glandCursor + sourceGland.diameterM / 2;
    glandCursor += sourceGland.diameterM + interGlandGap;
    const xDelta = x - sourceGland.x;
    return [id, {
      ...sourceGland,
      conductorPoints: Object.fromEntries(Object.entries(sourceGland.conductorPoints).map(([terminalId, point]) => [
        terminalId,
        [point[0] + xDelta, GLAND_TERMINAL_Y_M] as JunctionPoint2,
      ])),
      row: 0,
      x,
      zOffset: 0,
    }];
  }));
  const glandTerminalIds = new Set(Object.values(glands).flatMap((gland) => Object.keys(gland.conductorPoints)));
  const sourceGlandForTerminal = new Map(Object.values(source.glands).flatMap((gland) => (
    Object.keys(gland.conductorPoints).map((terminalId) => [terminalId, gland] as const)
  )));
  const glandForTerminal = new Map(Object.values(glands).flatMap((gland) => (
    Object.keys(gland.conductorPoints).map((terminalId) => [terminalId, gland] as const)
  )));
  const terminals = Object.fromEntries(Object.entries(source.terminals).map(([id, point]) => {
    const port = source.ports[id];
    if (port?.componentId) {
      const delta = componentDelta[port.componentId];
      return [id, [point[0] + delta[0], point[1] + delta[1]] as JunctionPoint2];
    }
    if (glandTerminalIds.has(id)) return [id, [...glandForTerminal.get(id)!.conductorPoints[id]] as JunctionPoint2];
    return [id, [...point] as JunctionPoint2];
  }));
  const ports = Object.fromEntries(Object.entries(source.ports).map(([id, port]) => {
    let delta: JunctionPoint3 = [0, 0, 0];
    if (port.componentId) {
      const componentMove = componentDelta[port.componentId];
      delta = [componentMove[0], componentMove[1], 0];
    } else if (glandTerminalIds.has(id)) {
      const oldGland = sourceGlandForTerminal.get(id)!;
      const newGland = glandForTerminal.get(id)!;
      delta = [
        newGland.conductorPoints[id][0] - port.position[0],
        GLAND_TERMINAL_Y_M - port.position[1],
        -oldGland.zOffset,
      ];
    }
    const move = (point: JunctionPoint3): JunctionPoint3 => point.map((value, axis) => (
      value + delta[axis]
    )) as JunctionPoint3;
    return [id, { ...port, face: move(port.face), position: move(port.position) }];
  }));
  const selector = components.selector;
  const selectorPort = (
    id: "selectorInputA" | "selectorInputB" | "selectorOutput",
    side: "bottom" | "left" | "right",
    crossAxisPosition: number,
  ) => {
    const sourcePort = ports[id];
    const direction: JunctionPoint3 = side === "left" ? [-1, 0, 0]
      : side === "right" ? [1, 0, 0] : [0, -1, 0];
    const face: JunctionPoint3 = [
      side === "bottom" ? crossAxisPosition : selector.center[0] + direction[0] * selector.size[0] / 2,
      side === "bottom" ? selector.center[1] - selector.size[1] / 2 : crossAxisPosition,
      0.042,
    ];
    const position: JunctionPoint3 = [
      face[0] + direction[0] * sourcePort.lengthM,
      face[1] + direction[1] * sourcePort.lengthM,
      face[2],
    ];
    ports[id] = { ...sourcePort, direction, face, position };
    terminals[id] = [position[0], position[1]];
  };
  selectorPort("selectorInputA", "bottom", selector.center[0] - 0.012);
  selectorPort("selectorInputB", "bottom", selector.center[0] + 0.012);
  selectorPort("selectorOutput", "right", selector.center[1]);
  const edgePort = (
    id: string,
    componentId: "fuseBlock" | "mpptFuse",
    side: "bottom" | "left" | "right" | "top",
    crossAxisPosition?: number,
  ) => {
    const sourcePort = ports[id];
    const component = components[componentId];
    const direction: JunctionPoint3 = side === "left" ? [-1, 0, 0]
      : side === "right" ? [1, 0, 0]
        : side === "bottom" ? [0, -1, 0] : [0, 1, 0];
    const face: JunctionPoint3 = [
      direction[0] === 0 ? crossAxisPosition ?? sourcePort.position[0] : component.center[0] + direction[0] * component.size[0] / 2,
      direction[1] === 0 ? crossAxisPosition ?? sourcePort.position[1] : component.center[1] + direction[1] * component.size[1] / 2,
      componentId === "fuseBlock" ? 0.04 : 0.035,
    ];
    const position: JunctionPoint3 = [
      face[0] + direction[0] * sourcePort.lengthM,
      face[1] + direction[1] * sourcePort.lengthM,
      face[2],
    ];
    ports[id] = { ...sourcePort, direction, face, position };
    terminals[id] = [position[0], position[1]];
  };
  edgePort("servicesFuseIn", "fuseBlock", "top", 0.098);
  edgePort("starlinkFuseIn", "fuseBlock", "top", 0.116);
  // One common feed supplies the four adjacent low-current branch breakers;
  // the 20 A services and 5 A Starlink breakers keep independent inputs.
  edgePort("fuseInput", "fuseBlock", "top", 0.161);
  ["servicesFuseOut", "starlinkFuseOut", "fuseOutput1", "fuseOutput2", "fuseOutput3", "fuseOutput4"].forEach((id, index) => (
    edgePort(id, "fuseBlock", "bottom", [0.098, 0.116, 0.134, 0.152, 0.17, 0.188][index])
  ));
  edgePort("mpptFuseIn", "mpptFuse", "left");
  edgePort("mpptFuseOut", "mpptFuse", "right");
  // The two battery-negative lugs share the SmartShunt BATTERY MINUS
  // electrical landing, but the model gives their insulated connector bodies
  // separate adjacent attachment cylinders. Keep those cylinders far enough
  // apart that neither cable has to pass through the neighboring cap.
  ([
    ["shuntBatteryA", -0.154],
    ["shuntBatteryB", -0.128],
  ] as const).forEach(([id, x]) => {
    const sourcePort = ports[id];
    const moveX = (point: JunctionPoint3): JunctionPoint3 => [x, point[1], point[2]];
    ports[id] = { ...sourcePort, face: moveX(sourcePort.face), position: moveX(sourcePort.position) };
    terminals[id] = [x, terminals[id][1]];
  });
  return {
    ...source,
    components,
    glandRows: [[...SINGLE_ROW_GLAND_ORDER]],
    glands,
    ports,
    terminals,
  };
}
