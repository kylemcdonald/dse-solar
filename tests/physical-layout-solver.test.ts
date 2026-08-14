import assert from "node:assert/strict";
import test from "node:test";
import {
  axisDirectionReversals,
  physicalLayout,
  routeLength,
  solvePhysicalLayout,
} from "../app/physicalLayoutSolver.ts";

test("physical layout is a renderer-independent deterministic specification", () => {
  const rerun = solvePhysicalLayout();
  assert.deepEqual(rerun, physicalLayout);
  assert.equal(physicalLayout.surfaces.sideWalls.length, 0);
  assert.equal(physicalLayout.surfaces.roofPlanes.length, 0);
  assert.equal(physicalLayout.constraints.batteryArrangement, "floor-2x2");
  assert.equal(physicalLayout.metrics.wallOverlapCount, 0);
  assert.equal(physicalLayout.metrics.junctionBackRouteCount, 0);
  assert.ok(physicalLayout.metrics.wallDeviceSpanM < 2.8);
  assert.equal(physicalLayout.devices.earthBar.mounting, "wall");
});

test("Starlink Ethernet takes the direct leftward path to UniFi", () => {
  const route = physicalLayout.routes["starlink-to-unifi-data"];
  assert.deepEqual(route.points[0], physicalLayout.ports.starlinkEthernet);
  assert.deepEqual(route.points.at(-1), physicalLayout.ports.unifiWan);
  assert.equal(axisDirectionReversals(route.points, 0), 0);
  assert.equal(route.planarDirectionReversals, 0);
  assert.equal(Math.max(...route.points.map((point) => point[0])), physicalLayout.ports.starlinkEthernet[0]);
  assert.ok(route.lengthM < 2.3);
});

test("every protective-earth route terminates on a modeled stud or lug", () => {
  const expected: Record<string, [string, string]> = {
    "earth-electrode-to-main-bar": ["earthElectrode", "earthBar1"],
    "earth-electrode-to-array-frame": ["earthElectrode", "arrayFrameEarth"],
    "earth-bar-to-pv-entry": ["earthBar2", "pvEntryEarth"],
    "earth-bar-to-smartsolar": ["earthBar3", "smartSolarEarth"],
    "earth-bar-to-multiplus": ["earthBar4", "multiPlusChassisEarth"],
    "earth-bar-to-ac-board": ["earthBar5", "acBoardEarth"],
    "earth-bar-to-ekrano": ["earthBar6", "ekranEarth"],
  };
  const earthRoutes = Object.values(physicalLayout.routes).filter((route) => route.kind === "earth");
  assert.equal(earthRoutes.length, Object.keys(expected).length);
  for (const route of earthRoutes) {
    const [startPort, endPort] = expected[route.id];
    assert.ok(startPort && endPort, `unexpected earth route ${route.id}`);
    assert.deepEqual(route.points[0], physicalLayout.ports[startPort]);
    assert.deepEqual(route.points.at(-1), physicalLayout.ports[endPort]);
  }
});

test("battery bank is a floor-level two-by-two footprint", () => {
  const batteries = [1, 2, 3, 4].map((index) => physicalLayout.devices[`battery${index}`]);
  assert.ok(batteries.every((battery) => battery.mounting === "floor" && battery.position[1] === 0.11));
  assert.equal(new Set(batteries.map((battery) => battery.position[0])).size, 2);
  assert.equal(new Set(batteries.map((battery) => battery.position[2])).size, 2);
});

test("generated cable lengths and constrained routes are internally consistent", () => {
  Object.values(physicalLayout.routes).forEach((route) => {
    assert.equal(route.lengthM, routeLength(route.points));
    assert.ok(route.lengthM > 0);
  });
  assert.equal(physicalLayout.routes["generator-flex"].kind, "three-core-ac");
  assert.equal(physicalLayout.routes["generator-flex"].conductors, 3);
  assert.equal(physicalLayout.routes["trailing-tool-flex"].kind, "three-core-ac");
  assert.equal(physicalLayout.routes["trailing-tool-flex"].conductors, 3);
  assert.ok(physicalLayout.devices.generator.position[2] < -2.3);
  assert.ok(Math.max(...physicalLayout.routes["pv-string-b-positive"].points.map((point) => point[2])) <= 1.18);
  for (const id of [
    "junction-to-mppt-positive",
    "junction-to-mppt-negative",
    "junction-to-multiplus-positive",
    "junction-to-multiplus-negative",
  ]) {
    const route = physicalLayout.routes[id];
    const frontOfBox = physicalLayout.devices.junction.position[2] + physicalLayout.devices.junction.size[2] / 2;
    assert.ok(route.points.slice(1, 4).every((point) => point[2] > frontOfBox));
    assert.ok(Math.max(...route.points.map((point) => point[1])) > 1.8);
  }
});

test("position overrides regenerate ports, routes, lengths and score", () => {
  const moved = solvePhysicalLayout({
    deviceOverrides: { smartSolar: { position: [2.35, 0.8, physicalLayout.devices.smartSolar.position[2]] } },
  });
  assert.equal(moved.devices.smartSolar.position[0], 2.35);
  assert.notDeepEqual(moved.ports.smartSolarPvPositive, physicalLayout.ports.smartSolarPvPositive);
  assert.notEqual(moved.routes["pv-entry-to-mppt-positive"].lengthM, physicalLayout.routes["pv-entry-to-mppt-positive"].lengthM);
  assert.notEqual(moved.metrics.score, physicalLayout.metrics.score);
});
