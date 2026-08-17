import assert from "node:assert/strict";
import test from "node:test";
import {
  axisDirectionReversals,
  physicalLayout,
  routeLength,
  solvePhysicalLayout,
} from "../app/physicalLayoutSolver.ts";
import { buildRoundedCableGeometry } from "../app/cableRouting.ts";

function changedAxisCount(
  first: [number, number, number],
  second: [number, number, number],
) {
  return first.reduce((count, value, axis) => (
    count + (Math.abs(value - second[axis]) > 0.00001 ? 1 : 0)
  ), 0);
}

test("physical layout is a renderer-independent deterministic specification", () => {
  const rerun = solvePhysicalLayout();
  assert.deepEqual(rerun, physicalLayout);
  assert.equal(physicalLayout.surfaces.sideWalls.length, 0);
  assert.equal(physicalLayout.surfaces.roofPlanes.length, 0);
  assert.equal(physicalLayout.constraints.batteryArrangement, "floor-2x2");
  assert.equal(physicalLayout.metrics.wallOverlapCount, 0);
  assert.equal(physicalLayout.metrics.junctionBackRouteCount, 0);
  assert.equal(physicalLayout.metrics.wallAuthoredWaypointCount, 0);
  assert.ok(physicalLayout.metrics.automaticRouteCount >= 25);
  assert.equal(physicalLayout.constraints.wallRouting, "shortest-rectilinear-visibility-graph");
  assert.ok(physicalLayout.metrics.wallDeviceSpanM < 2.8);
  assert.equal(physicalLayout.devices.earthBar.mounting, "wall");
});

test("Starlink Ethernet takes the direct leftward path to UniFi", () => {
  const route = physicalLayout.routes["starlink-to-unifi-data"];
  assert.deepEqual(route.points[0], physicalLayout.ports.starlinkEthernet);
  assert.deepEqual(route.points.at(-1), physicalLayout.ports.unifiWan);
  assert.equal(axisDirectionReversals(route.points, 0), 0);
  assert.ok(route.planarDirectionReversals <= 1);
  assert.equal(Math.max(...route.points.map((point) => point[0])), physicalLayout.ports.starlinkEthernet[0]);
  assert.ok(route.lengthM < 2.5);
});

test("wall placement keeps the service devices compact and cable-efficient", () => {
  const { devices } = physicalLayout;
  const junctionRight = devices.junction.position[0] + devices.junction.size[0] / 2;
  const orionLeft = devices.orion.position[0] - devices.orion.size[0] / 2;
  assert.ok(orionLeft > junctionRight);
  assert.ok(orionLeft - junctionRight < 0.06);
  assert.ok(devices.balancerA.position[1] < 0.8);
  assert.ok(devices.balancerB.position[1] < 0.8);
  assert.ok(devices.balancerA.position[0] > devices.junction.position[0]);
  assert.ok(devices.earthBar.position[0] < 2.2);
});

test("the PV pair lands in one indoor enclosure and AC trios are modeled as cable", () => {
  assert.equal(physicalLayout.devices.arrayFuseBox, undefined);
  for (const [routeId, portId] of [
    ["pv-home-run-a-positive", "pvEntryStringAPositive"],
    ["pv-home-run-a-negative", "pvEntryStringANegative"],
    ["pv-home-run-b-positive", "pvEntryStringBPositive"],
    ["pv-home-run-b-negative", "pvEntryStringBNegative"],
  ]) {
    assert.deepEqual(physicalLayout.routes[routeId].points.at(-1), physicalLayout.ports[portId]);
  }
  for (const routeId of [
    "generator-inlet-to-multiplus-ac",
    "multiplus-to-ac-output-protection",
  ]) {
    assert.equal(physicalLayout.routes[routeId].kind, "three-core-ac");
    assert.equal(physicalLayout.routes[routeId].conductors, 3);
  }
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
    route.points.slice(1).forEach((point, index) => {
      assert.equal(
        changedAxisCount(route.points[index], point),
        1,
        `${route.id} segment ${index} must be rectilinear`,
      );
    });
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
    assert.ok(route.points.slice(1, -1).every((point) => point[2] > frontOfBox));
    assert.equal(route.routing, "automatic-rectilinear");
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

test("moving the junction regenerates every automatic gland origin", () => {
  const junction = physicalLayout.devices.junction;
  const delta = [0.24, -0.18] as const;
  const moved = solvePhysicalLayout({
    deviceOverrides: {
      junction: {
        position: [
          junction.position[0] + delta[0],
          junction.position[1] + delta[1],
          junction.position[2],
        ],
      },
    },
  });
  for (const id of [
    "junction-to-mppt-positive",
    "junction-to-mppt-negative",
    "junction-to-multiplus-positive",
    "junction-to-multiplus-negative",
  ]) {
    const originalStart = physicalLayout.routes[id].points[0];
    const movedStart = moved.routes[id].points[0];
    assert.ok(Math.abs(movedStart[0] - originalStart[0] - delta[0]) < 1e-9);
    assert.ok(Math.abs(movedStart[1] - originalStart[1] - delta[1]) < 1e-9);
  }
  assert.equal(moved.metrics.junctionBackRouteCount, 0);
});

test("automatic routes are declared only by ports and stay attached after arbitrary device moves", () => {
  const moved = solvePhysicalLayout({
    deviceOverrides: {
      acBoard: { position: [2.56, 1.56, physicalLayout.devices.acBoard.position[2]] },
      balancerA: { position: [3.72, 0.92, physicalLayout.devices.balancerA.position[2]] },
      ekran: { position: [3.2, 2.18, physicalLayout.devices.ekran.position[2]] },
      pvEntry: { position: [1.62, 0.72, physicalLayout.devices.pvEntry.position[2]] },
    },
  });
  const automatic = Object.values(moved.routes).filter((route) => route.routing === "automatic-rectilinear");
  assert.ok(automatic.length >= 25);
  automatic.forEach((route) => {
    assert.ok(route.sourcePortId && route.targetPortId, `${route.id} must name both terminal ports`);
    assert.deepEqual(route.points[0], moved.ports[route.sourcePortId!], `${route.id} source detached`);
    assert.deepEqual(route.points.at(-1), moved.ports[route.targetPortId!], `${route.id} target detached`);
    route.points.slice(1).forEach((point, index) => {
      assert.equal(changedAxisCount(route.points[index], point), 1, `${route.id} contains a diagonal`);
    });
  });
});

test("AC output board owns the trailing socket and both ends of its flexible lead", () => {
  const originalBoard = physicalLayout.devices.acBoard;
  const moved = solvePhysicalLayout({
    deviceOverrides: {
      acBoard: {
        position: [originalBoard.position[0] + 0.31, originalBoard.position[1] - 0.22, originalBoard.position[2]],
      },
    },
  });
  assert.ok(Math.abs(
    moved.devices.trailingSocket.position[0] - physicalLayout.devices.trailingSocket.position[0] - 0.31,
  ) < 1e-9);
  assert.ok(Math.abs(
    moved.devices.trailingSocket.position[1] - physicalLayout.devices.trailingSocket.position[1] + 0.22,
  ) < 1e-9);
  assert.deepEqual(moved.routes["trailing-tool-flex"].points[0], moved.ports.acBoardToolCable);
  assert.deepEqual(moved.routes["trailing-tool-flex"].points.at(-1), moved.ports.trailingSocketAcCable);
});

test("the formerly forced routes are shortest-path generated without endpoint loops", () => {
  for (const id of [
    "generator-inlet-to-multiplus-ac",
    "pv-entry-to-mppt-positive",
    "pv-entry-to-mppt-negative",
    "earth-bar-to-ekrano",
  ]) {
    const route = physicalLayout.routes[id];
    assert.equal(route.routing, "automatic-rectilinear");
    assert.ok(axisDirectionReversals(route.points, 0) <= 1, `${id} loops horizontally`);
    assert.ok(axisDirectionReversals(route.points, 1) <= 1, `${id} loops vertically`);
  }
});

test("moving the generator inlet keeps both AC cables attached to its port", () => {
  const inlet = physicalLayout.devices.generatorInlet;
  const moved = solvePhysicalLayout({
    deviceOverrides: {
      generatorInlet: {
        position: [inlet.position[0] + 0.25, inlet.position[1] + 0.2, inlet.position[2]],
      },
    },
  });
  assert.deepEqual(moved.routes["generator-flex"].points.at(-1), moved.ports.generatorInletAcCable);
  assert.deepEqual(moved.routes["generator-inlet-to-multiplus-ac"].points[0], moved.ports.generatorInletAcCable);
});

test("tube generation exposes the exact sampled centerline used by the wall projection", () => {
  const points: Array<[number, number, number]> = [
    [0, 0, 0],
    [0.5, 0, 0],
    [0.5, 0.4, 0],
    [0.8, 0.4, 0.1],
  ];
  const { centerline, geometry } = buildRoundedCableGeometry(points, 0.05, 0.008, 9);
  assert.deepEqual(centerline[0], points[0]);
  assert.deepEqual(centerline.at(-1), points.at(-1));
  assert.ok(centerline.length > points.length);
  assert.ok(centerline.every((point) => point.every(Number.isFinite)));
  assert.equal(geometry.userData.continuousCableSurface, true);
  geometry.dispose();
});
