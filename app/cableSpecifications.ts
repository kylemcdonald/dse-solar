export type CableDiameterBasis = "manufacturer" | "representative" | "planning-estimate";

export type CableSpecification = {
  awg: string;
  conductorSize: string;
  diameterBasis: CableDiameterBasis;
  id: string;
  label: string;
  outsideDiameterMm: number;
};

export const CABLE_SPECIFICATIONS = {
  battery1_0: {
    id: "battery1_0",
    label: "UL 1426 tinned marine battery cable",
    conductorSize: "53.5 mm²",
    awg: "1/0 AWG",
    outsideDiameterMm: 14.4,
    diameterBasis: "manufacturer",
  },
  mppt25: {
    id: "mppt25",
    label: "Flexible battery cable",
    conductorSize: "25 mm²",
    awg: "≈3 AWG",
    outsideDiameterMm: 11,
    diameterBasis: "representative",
  },
  pv4: {
    id: "pv4",
    label: "H1Z2Z2-K / UV-rated PV cable",
    conductorSize: "4 mm²",
    awg: "≈11 AWG",
    outsideDiameterMm: 5.6,
    diameterBasis: "manufacturer",
  },
  ac3g1: {
    id: "ac3g1",
    label: "Three-core flexible AC cord",
    conductorSize: "3 × 1.0 mm²",
    awg: "≈17 AWG per conductor",
    outsideDiameterMm: 8,
    diameterBasis: "representative",
  },
  cat6_24: {
    id: "cat6_24",
    label: "Standard Cat6 patch cable",
    conductorSize: "8 × 24 AWG",
    awg: "24 AWG",
    outsideDiameterMm: 5.8,
    diameterBasis: "manufacturer",
  },
  balancer075: {
    id: "balancer075",
    label: "Battery-balancer sense conductor",
    conductorSize: "0.75 mm²",
    awg: "≈18 AWG",
    outsideDiameterMm: 3,
    diameterBasis: "representative",
  },
  alarmPair: {
    id: "alarmPair",
    label: "Two-core dry-contact alarm cable",
    conductorSize: "Final conductor size TBD",
    awg: "TBD",
    outsideDiameterMm: 3,
    diameterBasis: "planning-estimate",
  },
  temperatureSensor: {
    id: "temperatureSensor",
    label: "Victron factory temperature-sensor lead",
    conductorSize: "Factory cable",
    awg: "Not published",
    outsideDiameterMm: 3,
    diameterBasis: "planning-estimate",
  },
  veDirect: {
    id: "veDirect",
    label: "Victron VE.Direct cable",
    conductorSize: "Factory data cable",
    awg: "Not published",
    outsideDiameterMm: 3.4,
    diameterBasis: "planning-estimate",
  },
  starlinkOem: {
    id: "starlinkOem",
    label: "Starlink Mini OEM two-core DC cable",
    conductorSize: "Factory two-core cable",
    awg: "Not published",
    outsideDiameterMm: 8,
    diameterBasis: "planning-estimate",
  },
  usbFactory: {
    id: "usbFactory",
    label: "Amazon Basics USB-A to USB-C cable, 3 ft",
    conductorSize: "USB-A to USB-C molded cable",
    awg: "Not published",
    outsideDiameterMm: 4.4,
    diameterBasis: "planning-estimate",
  },
  service4: {
    id: "service4",
    label: "24 V service feeder",
    conductorSize: "4 mm²",
    awg: "≈11 AWG",
    outsideDiameterMm: 5.6,
    diameterBasis: "representative",
  },
  load4: {
    id: "load4",
    label: "USB charging-station branch conductor",
    conductorSize: "4 mm²",
    awg: "≈11 AWG",
    outsideDiameterMm: 4.6,
    diameterBasis: "representative",
  },
  light15: {
    id: "light15",
    label: "Lighting-circuit conductor",
    conductorSize: "1.5 mm²",
    awg: "≈15–16 AWG",
    outsideDiameterMm: 3.2,
    diameterBasis: "representative",
  },
  starlinkInternal15: {
    id: "starlinkInternal15",
    label: "Internal Starlink branch conductor",
    conductorSize: "1.5 mm²",
    awg: "≈15–16 AWG",
    outsideDiameterMm: 3.2,
    diameterBasis: "representative",
  },
  lowCurrent075: {
    id: "lowCurrent075",
    label: "Low-current 24 V branch conductor",
    conductorSize: "0.75 mm²",
    awg: "≈18 AWG",
    outsideDiameterMm: 3,
    diameterBasis: "representative",
  },
  smallSignal05: {
    id: "smallSignal05",
    label: "Small signal/sense conductor",
    conductorSize: "0.5 mm²",
    awg: "≈20 AWG",
    outsideDiameterMm: 2.4,
    diameterBasis: "representative",
  },
  ekranoPower: {
    id: "ekranoPower",
    label: "Victron Ekrano GX power lead",
    conductorSize: "Factory power lead",
    awg: "Not published",
    outsideDiameterMm: 3.6,
    diameterBasis: "planning-estimate",
  },
  earthMain: {
    id: "earthMain",
    label: "Main earthing/bonding conductor",
    conductorSize: "Not yet specified",
    awg: "TBD",
    outsideDiameterMm: 6,
    diameterBasis: "planning-estimate",
  },
  earthChassis: {
    id: "earthChassis",
    label: "Chassis bonding conductor",
    conductorSize: "Not yet specified",
    awg: "TBD",
    outsideDiameterMm: 4.8,
    diameterBasis: "planning-estimate",
  },
  earthEkrano: {
    id: "earthEkrano",
    label: "Ekrano chassis bonding conductor",
    conductorSize: "Not yet specified",
    awg: "TBD",
    outsideDiameterMm: 4.4,
    diameterBasis: "planning-estimate",
  },
} as const satisfies Record<string, CableSpecification>;

export type CableSpecificationId = keyof typeof CABLE_SPECIFICATIONS;

const assignRoutes = (target: Record<string, CableSpecificationId>, ids: string[], specificationId: CableSpecificationId) => {
  ids.forEach((id) => { target[id] = specificationId; });
};

export const PHYSICAL_ROUTE_CABLE_SPECIFICATIONS: Record<string, CableSpecificationId> = {};
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, [
  "battery-series-a", "battery-series-b", "junction-to-battery-negative-a", "junction-to-battery-negative-b",
  "breaker-a-to-junction", "breaker-b-to-junction", "battery-a-to-breaker", "battery-b-to-breaker",
  "junction-to-multiplus-negative", "junction-to-multiplus-positive",
], "battery1_0");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, [
  "junction-to-mppt-positive", "junction-to-mppt-negative",
], "mppt25");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, [
  "pv-string-a-positive", "pv-string-a-negative", "pv-string-b-positive", "pv-string-b-negative",
  "pv-home-run-a-positive", "pv-home-run-a-negative", "pv-home-run-b-positive", "pv-home-run-b-negative",
  "pv-entry-to-mppt-positive", "pv-entry-to-mppt-negative",
], "pv4");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, [
  "trailing-tool-flex", "multiplus-to-ac-output-protection", "generator-flex",
], "ac3g1");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, [
  "unifi-to-ekrano-data", "multiplus-to-ekrano-data", "starlink-to-unifi-data",
], "cat6_24");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, [
  "balancer-a-positive", "balancer-a-midpoint", "balancer-a-negative",
  "balancer-b-positive", "balancer-b-midpoint", "balancer-b-negative",
], "balancer075");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, ["balancer-a-alarm", "balancer-b-alarm"], "alarmPair");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, ["multiplus-battery-temperature"], "temperatureSensor");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, ["junction-to-ekrano-data", "smartsolar-to-ekrano-data"], "veDirect");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, ["junction-to-starlink-power-cable"], "starlinkOem");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, ["junction-to-unifi-power-usb"], "usbFactory");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, ["junction-to-usb-positive", "junction-to-usb-negative"], "load4");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, [
  "junction-to-indoor-light-positive", "junction-to-indoor-light-negative",
  "junction-to-outdoor-flood-positive", "junction-to-outdoor-flood-negative",
], "light15");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, ["junction-to-ekrano-positive", "junction-to-ekrano-negative"], "ekranoPower");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, ["earth-electrode-to-main-bar", "earth-electrode-to-array-frame"], "earthMain");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, [
  "earth-bar-to-pv-entry", "earth-bar-to-smartsolar", "earth-bar-to-multiplus", "earth-bar-to-ac-board",
], "earthChassis");
assignRoutes(PHYSICAL_ROUTE_CABLE_SPECIFICATIONS, ["earth-bar-to-ekrano"], "earthEkrano");

export const JUNCTION_ROUTE_CABLE_SPECIFICATIONS: Record<string, CableSpecificationId> = {};
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, [
  "battery-positive-a", "battery-positive-b", "battery-negative-a", "battery-negative-b",
  "shunt-to-negative-bus", "multiplus-positive", "multiplus-negative",
], "battery1_0");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, ["mppt-positive-feed", "mppt-positive", "mppt-negative"], "mppt25");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, ["services-positive-feed", "services-positive", "services-negative"], "service4");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, ["load-positive-3", "load-negative-3"], "load4");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, [
  "load-positive-4", "load-negative-4", "switch-input-4",
  "load-positive-5", "load-negative-5", "switch-input-5",
], "light15");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, [
  "starlink-fuse-feed", "starlink-switch-input", "starlink-jack-positive", "starlink-jack-negative",
], "starlinkInternal15");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, ["load-positive-2", "load-negative-2", "switch-input-2"], "lowCurrent075");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, ["ekrano-positive-feed", "ekrano-positive", "ekrano-negative"], "ekranoPower");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, ["ekrano-data"], "veDirect");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, ["unifi-usb-output"], "usbFactory");
assignRoutes(JUNCTION_ROUTE_CABLE_SPECIFICATIONS, ["shunt-voltage-sense", "switch-led-negative"], "smallSignal05");

function requiredSpecification(
  routeId: string,
  lookup: Record<string, CableSpecificationId>,
  scope: string,
) {
  const specificationId = lookup[routeId];
  if (!specificationId) throw new Error(`No cable specification for ${scope} route ${routeId}`);
  return CABLE_SPECIFICATIONS[specificationId];
}

export const physicalCableSpecification = (routeId: string) => requiredSpecification(
  routeId,
  PHYSICAL_ROUTE_CABLE_SPECIFICATIONS,
  "physical",
);

export const junctionCableSpecification = (routeId: string) => requiredSpecification(
  routeId,
  JUNCTION_ROUTE_CABLE_SPECIFICATIONS,
  "junction",
);

export const cableRadiusM = (specification: CableSpecification) => specification.outsideDiameterMm / 2000;

export const physicalCableRadiusM = (routeId: string) => cableRadiusM(physicalCableSpecification(routeId));
export const junctionCableRadiusM = (routeId: string) => cableRadiusM(junctionCableSpecification(routeId));

export function diameterBasisLabel(basis: CableDiameterBasis) {
  if (basis === "manufacturer") return "Manufacturer dimension";
  if (basis === "representative") return "Representative product dimension";
  return "Planning estimate—measure the purchased cable";
}
