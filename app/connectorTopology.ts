import { junctionInteriorRouting } from "./junctionInteriorRouting.ts";
import { physicalLayout } from "./physicalLayout.ts";
import {
  junctionCableSpecification,
  physicalCableSpecification,
  type CableSpecification,
} from "./cableSpecifications.ts";

export type ConnectorConnection = {
  kind: string;
  otherConnectorId?: string;
  otherConnectorName: string;
  otherDeviceId?: string;
  otherDeviceName: string;
  routeId: string;
  routeName: string;
  viaDeviceName?: string;
};

export type ConnectorDetails = {
  cable: CableSpecification;
  cableDiameterMm: number;
  connections: ConnectorConnection[];
  deviceId?: string;
  deviceName: string;
  direction: string;
  id: string;
  name: string;
  scope: "System layout" | "Junction-box harness";
};

const DEVICE_NAMES: Record<string, string> = {
  acBoard: "AC output protection",
  arrayFrame: "PV array frame",
  balancerA: "Battery balancer A",
  balancerB: "Battery balancer B",
  battery1: "Battery 1 (string A −)",
  battery2: "Battery 2 (string A +)",
  battery3: "Battery 3 (string B −)",
  battery4: "Battery 4 (string B +)",
  batteryBreakerBox: "Dual 125 A battery-string breaker enclosure",
  earthBar: "Main protective-earth bus",
  earthElectrode: "Earth electrode",
  ekran: "Ekrano GX",
  generator: "G3200P generator",
  indoorLight: "Indoor 24 V utility light",
  junction: "Compact junction box",
  multiPlus: "MultiPlus-II 24/3000",
  outdoorFlood: "Outdoor 24 V utility light",
  pvEntry: "PV protection and combiner",
  smartSolar: "SmartSolar MPPT 150/85",
  solarPanels: "Four-panel PV array",
  starlink: "Starlink Mini",
  trailingSocket: "Trailing tool socket",
  unifi: "UniFi Express",
  unifiPower: "UniFi 5 V converter",
  usb: "Six-port USB charging station",
};

const JUNCTION_COMPONENT_NAMES: Record<string, string> = {
  ekranoFuse: "Ekrano factory-fuse holder",
  fuseBlock: "Resettable DC service-breaker bank",
  mpptFuse: "MidNite MPPT resettable DC breaker",
  negativeBus: "Main negative bus",
  positiveBus: "Main positive bus",
  returnBus: "Low-current return bus",
  shunt: "Victron SmartShunt",
  switchPanel: "External load switches",
  unifiPower: "Dedicated UniFi 5 V converter",
};

function titleCaseIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b(ac|dc|gx|lan|mppt|pe|pv|usb|ve)\b/gi, (word) => word.toUpperCase())
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function directionLabel(direction: [number, number, number]) {
  const [x, y, z] = direction;
  if (Math.abs(x) > 0.9) return x > 0 ? "Cable approaches from the right" : "Cable approaches from the left";
  if (Math.abs(y) > 0.9) return y > 0 ? "Cable approaches from below" : "Cable approaches from above";
  return z > 0 ? "Cable approaches straight out from the mounting surface" : "Cable approaches toward the mounting surface";
}

function deviceName(deviceId?: string) {
  if (!deviceId) return "Unassigned cable termination";
  return DEVICE_NAMES[deviceId] ?? titleCaseIdentifier(deviceId);
}

function logicalPhysicalPeer(routeId: string, endpoint: "source" | "target") {
  if (routeId.startsWith("pv-string-")) return endpoint === "source" ? "pvEntry" : "solarPanels";
  if (routeId.startsWith("pv-home-run-")) return endpoint === "source" ? "pvEntry" : "solarPanels";
  return undefined;
}

function junctionConductorPorts(exteriorPortId: string) {
  const gland = Object.values(junctionInteriorRouting.glands).find((candidate) => (
    candidate.exteriorPortIds.includes(exteriorPortId)
  ));
  if (!gland) return [];

  const conductorPortIds = Object.keys(gland.conductorPoints);
  if (gland.exteriorPortIds.length === 1) return conductorPortIds;

  const exteriorIndex = gland.exteriorPortIds.indexOf(exteriorPortId);
  return conductorPortIds[exteriorIndex] ? [conductorPortIds[exteriorIndex]] : [];
}

function junctionInteriorPeers(exteriorPortId: string) {
  return junctionConductorPorts(exteriorPortId).flatMap((conductorPortId) => (
    Object.values(junctionInteriorRouting.wireSegments).flatMap((route) => {
      const peerPortId = route.from === conductorPortId
        ? route.to
        : route.to === conductorPortId
          ? route.from
          : undefined;
      if (!peerPortId) return [];

      const peerPort = junctionInteriorRouting.ports[peerPortId];
      const peerDeviceId = peerPort?.componentId;
      if (!peerDeviceId) return [];
      return [{
        kind: titleCaseIdentifier(route.kind),
        peerDeviceId,
        peerDeviceName: JUNCTION_COMPONENT_NAMES[peerDeviceId] ?? titleCaseIdentifier(peerDeviceId),
        peerPortId,
        routeId: route.id,
      }];
    })
  ));
}

export function physicalConnectorTopology() {
  const result = new Map<string, ConnectorDetails>();
  Object.entries(physicalLayout.portSpecifications).forEach(([portId, port]) => {
    const attachedRoutes = Object.values(physicalLayout.routes).filter((route) => (
      route.sourcePortId === portId || route.targetPortId === portId
    ));
    const cable = physicalCableSpecification(attachedRoutes[0].id);
    const connections = attachedRoutes.flatMap((route) => {
      const endpoint = route.sourcePortId === portId ? "source" : route.targetPortId === portId ? "target" : undefined;
      if (!endpoint) return [];
      const peerDeviceId = endpoint === "source"
        ? route.targetDeviceId ?? logicalPhysicalPeer(route.id, endpoint)
        : route.sourceDeviceId ?? logicalPhysicalPeer(route.id, endpoint);
      const peerPortId = endpoint === "source" ? route.targetPortId : route.sourcePortId;
      if (peerDeviceId === "junction" && peerPortId) {
        const interiorPeers = junctionInteriorPeers(peerPortId);
        if (interiorPeers.length > 0) {
          return interiorPeers.map((interiorPeer) => ({
            kind: interiorPeer.kind,
            otherConnectorId: interiorPeer.peerPortId,
            otherConnectorName: titleCaseIdentifier(interiorPeer.peerPortId),
            otherDeviceId: interiorPeer.peerDeviceId,
            otherDeviceName: interiorPeer.peerDeviceName,
            routeId: `${route.id} → ${interiorPeer.routeId}`,
            routeName: `${titleCaseIdentifier(route.id)} → ${titleCaseIdentifier(interiorPeer.routeId)}`,
            viaDeviceName: DEVICE_NAMES.junction,
          }));
        }
      }
      return [{
        kind: titleCaseIdentifier(route.kind),
        otherConnectorId: peerPortId,
        otherConnectorName: peerPortId ? titleCaseIdentifier(peerPortId) : "Cable termination",
        otherDeviceId: peerDeviceId,
        otherDeviceName: deviceName(peerDeviceId),
        routeId: route.id,
        routeName: titleCaseIdentifier(route.id),
      }];
    });
    result.set(portId, {
      cable,
      cableDiameterMm: cable.outsideDiameterMm,
      connections,
      deviceId: port.deviceId,
      deviceName: deviceName(port.deviceId),
      direction: directionLabel(port.direction),
      id: `physical:${portId}`,
      name: titleCaseIdentifier(portId),
      scope: "System layout",
    });
  });
  return result;
}

export function junctionConnectorTopology() {
  const result = new Map<string, ConnectorDetails>();
  const glandForPort = (portId: string) => Object.values(junctionInteriorRouting.glands).find((gland) => (
    Object.prototype.hasOwnProperty.call(gland.conductorPoints, portId)
  ));
  Object.entries(junctionInteriorRouting.ports).forEach(([portId, port]) => {
    const ownerGland = glandForPort(portId);
    const ownerId = port.componentId ?? ownerGland?.id;
    const ownerName = port.componentId
      ? JUNCTION_COMPONENT_NAMES[port.componentId] ?? titleCaseIdentifier(port.componentId)
      : ownerGland?.label ?? "Junction-box cable entry";
    const attachedRoutes = Object.values(junctionInteriorRouting.wireSegments).filter((route) => (
      route.from === portId || route.to === portId
    ));
    const cable = junctionCableSpecification(attachedRoutes[0].id);
    const connections = attachedRoutes.flatMap((route) => {
      const peerPortId = route.from === portId ? route.to : route.to === portId ? route.from : undefined;
      if (!peerPortId) return [];
      const peerPort = junctionInteriorRouting.ports[peerPortId];
      const peerGland = glandForPort(peerPortId);
      const peerId = peerPort.componentId ?? peerGland?.id;
      const peerName = peerPort.componentId
        ? JUNCTION_COMPONENT_NAMES[peerPort.componentId] ?? titleCaseIdentifier(peerPort.componentId)
        : peerGland?.label ?? "Junction-box cable entry";
      return [{
        kind: titleCaseIdentifier(route.kind),
        otherConnectorId: peerPortId,
        otherConnectorName: titleCaseIdentifier(peerPortId),
        otherDeviceId: peerId,
        otherDeviceName: peerName,
        routeId: route.id,
        routeName: titleCaseIdentifier(route.id),
      }];
    });
    result.set(portId, {
      cable,
      cableDiameterMm: cable.outsideDiameterMm,
      connections,
      deviceId: ownerId,
      deviceName: ownerName,
      direction: directionLabel(port.direction),
      id: `junction:${portId}`,
      name: titleCaseIdentifier(portId),
      scope: "Junction-box harness",
    });
  });
  return result;
}
