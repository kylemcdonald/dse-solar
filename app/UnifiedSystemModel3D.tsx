"use client";
import { createSystemModel3D } from "./SystemModel3D";
import { CurrentSafetySummary } from "./CurrentSafetySummary";
import { dseRuntime } from "./dseRuntime";
import { worldHalfExtents } from "./physicalLayout";
import type { ResolvedDevice, Vec3 } from "./systemGraph";
type CameraPreset = "whole" | "wall" | "west" | "north" | "dc" | "cutoff" | "services";

type CameraPose = {
  position: Vec3;
  target: Vec3;
};

const BATTERY_CUTOFF_JUNCTION_ID = "batteryCutoffJunction";
const SECONDARY_SERVICES_JUNCTION_ID = "secondaryJunction";
const MAIN_DISTRIBUTION_COMPONENT_ID = "mainDistribution";

const DC_CLUSTER_COMPONENT_IDS = new Set([
  MAIN_DISTRIBUTION_COMPONENT_ID,
  "solarController",
  "balancers",
  "inverter",
]);
const cameraPresets: readonly { key: CameraPreset; label: string }[] = [
  { key: "whole", label: "Whole system" },
  { key: "wall", label: "Northwest corner" },
  { key: "west", label: "West wall" },
  { key: "north", label: "North wall" },
  { key: "dc", label: "DC distribution" },
  { key: "cutoff", label: "Battery cutoffs" },
  { key: "services", label: "Secondary services" },
];



function deviceBounds(devices: readonly ResolvedDevice[]) {
  const min = ([0, 1, 2] as const).map((axis) => Math.min(...devices.map((device) => device.position[axis] - worldHalfExtents(device)[axis]))) as unknown as Vec3;
  const max = ([0, 1, 2] as const).map((axis) => Math.max(...devices.map((device) => device.position[axis] + worldHalfExtents(device)[axis]))) as unknown as Vec3;
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
  wall: { position: [4.5, 2.8, 4.8], target: [0.65, 1.45, 0.80] },
  west: { position: [4.2, 1.65, 1.10], target: [0, 1.45, 1.10] },
  north: { position: [1.0, 1.85, 4.2], target: [1.0, 1.50, 0] },
  dc: { position: [3.2, 1.65, 3.4], target: dcDistributionBounds.target },
  cutoff: { position: [batteryCutoffBounds.target[0] + 0.9, batteryCutoffBounds.target[1] + 0.1, batteryCutoffBounds.target[2]], target: batteryCutoffBounds.target },
  services: frontCameraPose(secondaryServicesBounds, {
    widthScale: 1.9,
    heightScale: 2.35,
    minimumDistance: 0.90,
    xOffset: 0.02,
    yOffset: 0.12,
  }),
};

export const UnifiedSystemModel3D = createSystemModel3D(dseRuntime, {
  attributes: {"data-earth-topology":"pv-spd-chassis-rod",...Object.fromEntries([["data-battery-cutoff-breaker-order",BATTERY_CUTOFF_JUNCTION_ID],["data-secondary-services-breaker-order",SECONDARY_SERVICES_JUNCTION_ID]].map(([attribute,id])=>[attribute,junctionDevices(id).filter(d=>d.kind==='breaker').toSorted((a,b)=>(a.placement.space==='junction'?a.placement.order:0)-(b.placement.space==='junction'?b.placement.order:0)).map(d=>d.id).join(',')]))},
  presets: cameraPresets.map(view => ({ ...view, pose: presetPose[view.key] })),
  toolbar: <CurrentSafetySummary />,
  siteNote: "Northwest corner · panels on the roof · batteries north to south: A1, A2, B1, B2. Positions and routing envelopes are illustrative; installed cable lengths are not measured.",
});
