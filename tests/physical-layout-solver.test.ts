import assert from "node:assert/strict";
import test from "node:test";
import {
  axisDirectionReversals,
  cableClearanceIssues,
  cableRoutePairClearanceIssues,
  type PhysicalCableRoute,
  routeLength,
  segmentBlocked,
  shortestRectilinearPath,
  solvePhysicalLayout,
} from "../app/physicalLayoutSolver.ts";
import { physicalLayout, physicalLayoutOptimization } from "../app/physicalLayout.ts";
import { buildRoundedCableGeometry, CableRoutingSystem } from "../app/cableRouting.ts";
import {
  junctionInteriorRouting,
  solveJunctionInteriorRouting,
} from "../app/junctionInteriorRouting.ts";
import voxelRoutingRaw from "../data/voxel-routing-comparison.json" with { type: "json" };

function changedAxisCount(
  first: [number, number, number],
  second: [number, number, number],
) {
  return first.reduce((count, value, axis) => (
    count + (Math.abs(value - second[axis]) > 0.00001 ? 1 : 0)
  ), 0);
}

test("physical layout is a renderer-independent deterministic specification", () => {
  const rerun = solvePhysicalLayout({ routingEffort: "optimization" });
  assert.deepEqual(rerun, physicalLayout);
  assert.equal(physicalLayout.surfaces.sideWalls.length, 0);
  assert.equal(physicalLayout.surfaces.roofPlanes.length, 0);
  assert.equal(physicalLayout.constraints.batteryArrangement, "floor-2x2");
  assert.equal(physicalLayout.constraints.batteryRouting, "collision-aware-terminal-derived-bundle");
  assert.match(physicalLayout.revision, /r12-oriented-device-ports/);
  assert.equal(physicalLayout.metrics.wallOverlapCount, 0);
  assert.equal(physicalLayout.metrics.junctionBackRouteCount, 0);
  assert.equal(physicalLayout.metrics.wallAuthoredWaypointCount, 0);
  assert.ok(physicalLayout.metrics.cableClearanceIssueCount >= 0);
  assert.equal(
    physicalLayout.metrics.cableClearanceIssues.length,
    physicalLayout.metrics.cableClearanceIssueCount,
  );
  assert.equal(physicalLayout.metrics.deviceFrontCrossingCount, 0);
  assert.deepEqual(physicalLayout.metrics.deviceFrontCrossingIssues, []);
  assert.equal(physicalLayout.metrics.portApproachIssueCount, 0);
  assert.deepEqual(physicalLayout.metrics.portApproachIssues, []);
  assert.ok(Object.keys(physicalLayout.portSpecifications).length >= 100);
  assert.ok(physicalLayout.metrics.automaticRouteCount >= 25);
  assert.ok(Math.abs(
    physicalLayout.metrics.weightedCableLengthM -
    physicalLayout.metrics.totalRenderedCableM -
    physicalLayout.metrics.thickCableLengthM
  ) < 0.001);
  assert.ok(physicalLayout.metrics.wallDistanceCostM2 > 0);
  assert.equal(physicalLayout.constraints.wallRouting, "offline-voxel-a-star-only");
  assert.ok(physicalLayout.metrics.wallDeviceSpanM < 2.8);
  assert.equal(physicalLayout.devices.earthBar.mounting, "wall");
});

test("every wall connection uses a bottom port and leaves vertically downward", () => {
  const automatic = Object.values(physicalLayout.routes).filter((route) => (
    route.routing === "automatic-rectilinear"
  ));
  for (const route of automatic) {
    for (const endpoint of ["source", "target"] as const) {
      const deviceId = endpoint === "source" ? route.sourceDeviceId : route.targetDeviceId;
      const portId = endpoint === "source" ? route.sourcePortId : route.targetPortId;
      const device = deviceId ? physicalLayout.devices[deviceId] : undefined;
      if (!device || device.mounting !== "wall") continue;
      const port = physicalLayout.ports[portId!];
      const bottom = device.position[1] - device.size[1] / 2;
      assert.ok(port[1] < bottom, `${route.id} ${endpoint} port is not below ${deviceId}`);
      assert.ok(
        port[2] >= device.position[2] - device.size[2] / 2 &&
          port[2] <= device.position[2] + device.size[2] / 2,
        `${route.id} ${endpoint} port is not on the bottom face depth of ${deviceId}`,
      );
      const terminal = endpoint === "source" ? route.points[0] : route.points.at(-1)!;
      const breakout = endpoint === "source" ? route.points[1] : route.points.at(-2)!;
      assert.equal(breakout[0], terminal[0], `${route.id} ${endpoint} moves sideways before dropping`);
      assert.equal(breakout[2], terminal[2], `${route.id} ${endpoint} changes depth before dropping`);
      assert.ok(breakout[1] < terminal[1], `${route.id} ${endpoint} does not drop first`);
    }
  }
});

test("Victron sensing and alarm links terminate on the intended interfaces", () => {
  const smartSolar = physicalLayout.routes["smartsolar-to-ekrano-data"];
  const temperature = physicalLayout.routes["multiplus-battery-temperature"];
  const balancerA = physicalLayout.routes["balancer-a-alarm"];
  const balancerB = physicalLayout.routes["balancer-b-alarm"];
  assert.equal(smartSolar.targetPortId, "ekranVeDirect2");
  assert.equal(physicalLayout.routes["junction-to-ekrano-data"].targetPortId, "ekranVeDirect1");
  assert.equal(temperature.sourcePortId, "multiPlusTemperatureSense");
  assert.equal(temperature.targetPortId, "aNegativeTemperature");
  assert.equal(balancerA.targetPortId, "ekranDigitalInput1");
  assert.equal(balancerB.targetPortId, "ekranDigitalInput2");
  assert.equal(balancerA.conductors, 2);
  assert.equal(balancerB.conductors, 2);
  assert.ok(junctionInteriorRouting.wireSegments["shunt-voltage-sense"]);
  assert.deepEqual(junctionInteriorRouting.metrics.portApproachViolations, 0);
});

test("every physical device port is cylindrical-axis compatible and approached straight-on", () => {
  const alignedOutward = (
    from: [number, number, number],
    to: [number, number, number],
    direction: [number, number, number],
  ) => {
    const delta = to.map((value, axis) => value - from[axis]);
    const length = Math.hypot(...delta);
    const dot = delta.reduce((sum, value, axis) => sum + value * direction[axis], 0) / length;
    return length >= 0.0175 && dot > 0.999;
  };
  Object.values(physicalLayout.routes).forEach((route) => {
    if (route.sourcePortId) {
      const port = physicalLayout.portSpecifications[route.sourcePortId];
      assert.ok(port, `${route.id} source port is missing`);
      assert.deepEqual(route.points[0], port.position);
      assert.ok(alignedOutward(route.points[0], route.points[1], port.direction), `${route.id} source approach is not axial`);
    }
    if (route.targetPortId) {
      const port = physicalLayout.portSpecifications[route.targetPortId];
      assert.ok(port, `${route.id} target port is missing`);
      assert.deepEqual(route.points.at(-1), port.position);
      assert.ok(alignedOutward(route.points.at(-1)!, route.points.at(-2)!, port.direction), `${route.id} target approach is not axial`);
    }
  });
});

test("physical layout loads the completed Voxel A-star stochastic placement result", () => {
  assert.equal(physicalLayoutOptimization.status, "voxel-a-star-stochastic-gradient-optimized-finalized");
  assert.ok(physicalLayoutOptimization.requestedTimeBudgetSeconds >= 180);
  assert.ok(physicalLayoutOptimization.elapsedSeconds >= 180);
  assert.equal(physicalLayoutOptimization.evaluations, 54);
  assert.equal(physicalLayoutOptimization.generations, 24);
  assert.ok(physicalLayoutOptimization.improvementPercent >= 1.9);
  assert.equal(physicalLayout.devices.ekran.position[1], 1.58);
  assert.ok(physicalLayout.devices.battery1.position[0] <= 1.62);
  assert.ok(physicalLayout.devices.battery2.position[0] <= 2.18);
  assert.ok(physicalLayout.devices.indoorLight.position[0] <= 3.25);
  assert.ok(physicalLayout.devices.outdoorFlood.position[0] <= 3.4);
  const wallRightEdge = Math.max(...Object.values(physicalLayout.devices)
    .filter((device) => device.mounting === "wall" && device.id !== "equipmentBoard")
    .map((device) => device.position[0] + device.size[0] / 2));
  assert.ok(wallRightEdge <= 3.85001);
  assert.ok(physicalLayout.metrics.totalRenderedCableM < 125);
});

test("junction harness loads the saved protected-face baseline", () => {
  assert.deepEqual(solveJunctionInteriorRouting(), junctionInteriorRouting);
  assert.deepEqual(
    junctionInteriorRouting.candidates.map((candidate) => candidate.name),
    ["Expanded protected-face baseline"],
  );
  assert.equal(junctionInteriorRouting.selectedCandidate, "Expanded protected-face baseline");
  const selected = junctionInteriorRouting.candidates.find((candidate) => (
    candidate.name === junctionInteriorRouting.selectedCandidate
  ));
  assert.ok(selected);
  assert.equal(selected.score, Math.min(...junctionInteriorRouting.candidates.map((candidate) => candidate.score)));
  assert.equal(Object.keys(junctionInteriorRouting.routes).length, 33);
  assert.equal(Object.keys(junctionInteriorRouting.wireSegments).length, 35);
  assert.equal(junctionInteriorRouting.metrics.serviceCircuitCount, 33);
  assert.equal(junctionInteriorRouting.metrics.wireSegmentCount, 35);
  assert.equal(Object.keys(junctionInteriorRouting.components).length, 9);
  assert.equal(Object.keys(junctionInteriorRouting.glands).length, 15);
  assert.equal(Object.values(junctionInteriorRouting.glands).filter((gland) => gland.type === "gland").length, 14);
  assert.deepEqual(new Set(Object.values(junctionInteriorRouting.glands).map((gland) => gland.row)), new Set([0]));
  assert.equal(junctionInteriorRouting.glandRows.length, 1);
  assert.equal(junctionInteriorRouting.glandRows[0].length, 15);
  assert.equal(junctionInteriorRouting.metrics.componentOverlapCount, 0);
  assert.equal(junctionInteriorRouting.metrics.glandOverflowM, 0);
  assert.equal(junctionInteriorRouting.metrics.boundaryBreakoutConflicts, 0);
  assert.equal(junctionInteriorRouting.metrics.depthOverflowM, 0);
  assert.ok(junctionInteriorRouting.metrics.maximumForwardM <= 0.13);
  assert.equal(junctionInteriorRouting.metrics.bridgeCount, 0);
  assert.equal(junctionInteriorRouting.metrics.solidIntersections, 0);
  assert.equal(junctionInteriorRouting.metrics.spatialIntersections, 0);
  assert.equal(junctionInteriorRouting.metrics.coincidentRunOverlapM, 0);
  assert.equal(junctionInteriorRouting.metrics.portApproachViolations, 0);
  assert.equal(Object.keys(junctionInteriorRouting.ports).length, 70);
  assert.ok(junctionInteriorRouting.ports.shuntBatteryA);
  assert.ok(junctionInteriorRouting.ports.shuntBatteryB);
  assert.ok(junctionInteriorRouting.metrics.weightedLengthM > junctionInteriorRouting.metrics.totalLengthM);
  assert.ok(junctionInteriorRouting.metrics.wallDistanceCostM2 > 0);
  assert.ok(junctionInteriorRouting.metrics.turnCount3d > 0);
  assert.equal(junctionInteriorRouting.optimization.requestedTimeBudgetSeconds, 0);
  assert.ok(junctionInteriorRouting.optimization.elapsedSeconds > 0);
  assert.equal(junctionInteriorRouting.optimization.evaluations, 1);
});

test("every optimized enclosure interface exits through the single bottom-face row", () => {
  const junction = physicalLayout.devices.junction;
  const bottom = junction.position[1] - junction.size[1] / 2;
  for (const gland of Object.values(junctionInteriorRouting.glands)) {
    for (const portId of gland.exteriorPortIds) {
      const port = physicalLayout.ports[portId];
      assert.ok(port, `${portId} is missing from the physical layout`);
      assert.ok(port[1] < bottom, `${portId} does not exit below the junction box`);
      assert.ok(Math.abs(port[2] - (junction.position[2] + gland.zOffset)) < 0.0001);
    }
  }
});

test("every optimized junction wire remains attached and rectilinear", () => {
  const pointsAlmostEqual = (first: number[], second: number[]) => (
    first.length === second.length && first.every((value, axis) => Math.abs(value - second[axis]) < 1e-9)
  );
  for (const route of Object.values(junctionInteriorRouting.wireSegments)) {
    assert.deepEqual(route.points[0].slice(0, 2), junctionInteriorRouting.terminals[route.from]);
    assert.deepEqual(route.points.at(-1)!.slice(0, 2), junctionInteriorRouting.terminals[route.to]);
    route.points.slice(1).forEach((point, index) => {
      assert.equal(changedAxisCount(route.points[index], point), 1, `${route.id} contains a diagonal`);
    });
    const sourcePort = junctionInteriorRouting.ports[route.from];
    const targetPort = junctionInteriorRouting.ports[route.to];
    assert.ok(pointsAlmostEqual(route.points[0], sourcePort.position), `${route.id} is detached from its source port`);
    assert.ok(pointsAlmostEqual(route.points.at(-1)!, targetPort.position), `${route.id} is detached from its target port`);
    const sourceDelta = route.points[1].map((value, axis) => value - route.points[0][axis]);
    const targetDelta = route.points.at(-2)!.map((value, axis) => value - route.points.at(-1)![axis]);
    assert.ok(sourceDelta.reduce((sum, value, axis) => sum + value * sourcePort.direction[axis], 0) > 0);
    assert.ok(targetDelta.reduce((sum, value, axis) => sum + value * targetPort.direction[axis], 0) > 0);
  }
});

test("rendered junction routes clear the selector and match the conservative cable audit", () => {
  const audit = new CableRoutingSystem();
  const selector = junctionInteriorRouting.components.selector;
  audit.registerObstacle(
    "selector",
    [selector.center[0], selector.center[1], 0.042],
    [selector.size[0], selector.size[1], 0.084],
    [],
  );
  Object.values(junctionInteriorRouting.wireSegments).forEach((route) => {
    audit.prepareRoute(route.points, route.radiusM, "junction", false);
  });
  const report = audit.report();
  assert.equal(report.obstacleIntersections, 0, report.obstacleIssues.join("\n"));
  assert.equal(
    report.unresolvedCableIntersections,
    junctionInteriorRouting.metrics.spatialIntersections,
    report.unresolvedCableIssues.join("\n"),
  );
  assert.equal(report.backtrackingCorners, junctionInteriorRouting.metrics.backtrackingCorners3d);
});

test("junction components retain service clearance inside the luggage-sized enclosure", () => {
  const components = Object.entries(junctionInteriorRouting.components);
  for (const [id, component] of components) {
    const [x, y] = component.center;
    const [width, height] = component.size;
    assert.ok(x - width / 2 >= -0.23, `${id} crosses the left inner wall`);
    assert.ok(x + width / 2 <= 0.23, `${id} crosses the right inner wall`);
    assert.ok(y - height / 2 >= -0.185, `${id} crosses the bottom inner wall`);
    assert.ok(y + height / 2 <= 0.185, `${id} crosses the top inner wall`);
  }
  components.forEach(([id, component], index) => components.slice(index + 1).forEach(([otherId, other]) => {
    const horizontalOverlap = Math.min(
      component.center[0] + component.size[0] / 2,
      other.center[0] + other.size[0] / 2,
    ) - Math.max(
      component.center[0] - component.size[0] / 2,
      other.center[0] - other.size[0] / 2,
    );
    const verticalOverlap = Math.min(
      component.center[1] + component.size[1] / 2,
      other.center[1] + other.size[1] / 2,
    ) - Math.max(
      component.center[1] - component.size[1] / 2,
      other.center[1] - other.size[1] / 2,
    );
    assert.ok(horizontalOverlap <= 0 || verticalOverlap <= 0, `${id} overlaps ${otherId}`);
  }));
});

test("rectilinear visibility graph routes around a flush enclosure instead of falling back through it", () => {
  const obstacle = { left: 2.9, right: 3.65, bottom: 1.45, top: 1.85 };
  const path = shortestRectilinearPath([3.675, 1.716], [1.965, 1.662], [obstacle]);
  assert.ok(path.length >= 3);
  path.slice(1).forEach((point, index) => {
    assert.equal(segmentBlocked(path[index], point, [obstacle]), false);
  });
});

test("Starlink Ethernet takes the direct leftward path to UniFi", () => {
  const route = physicalLayout.routes["starlink-to-unifi-data"];
  assert.deepEqual(route.points[0], physicalLayout.ports.starlinkEthernet);
  assert.deepEqual(route.points.at(-1), physicalLayout.ports.unifiWan);
  assert.equal(axisDirectionReversals(route.points, 0), 0);
  assert.ok(route.planarDirectionReversals <= 1);
  const source = route.points[0];
  const target = route.points.at(-1)!;
  assert.equal(Math.max(...route.points.map((point) => point[0])), Math.max(source[0], target[0]));
  assert.equal(Math.min(...route.points.map((point) => point[0])), Math.min(source[0], target[0]));
  const directRectilinearLength = source.reduce((sum, value, axis) => (
    sum + Math.abs(value - target[axis])
  ), 0);
  assert.ok(route.lengthM <= directRectilinearLength + 0.4);
});

test("wall placement keeps the service devices compact and cable-efficient", () => {
  const { devices } = physicalLayout;
  assert.ok(devices.balancerA.position[1] < 1.2);
  assert.ok(devices.balancerB.position[1] < 1.2);
  assert.ok(physicalLayout.metrics.wallDeviceSpanM < 2.8);
  assert.equal(physicalLayout.metrics.wallOverlapCount, 0);
  assert.equal(physicalLayout.metrics.deviceFrontCrossingCount, 0);
});

test("wall devices retain the requested 200 mm service border", () => {
  const devices = Object.values(physicalLayout.devices).filter((device) => (
    device.mounting === "wall" && !["equipmentBoard", "junctionControls"].includes(device.id)
  ));
  devices.forEach((first, index) => devices.slice(index + 1).forEach((second) => {
    const horizontalGap = Math.abs(first.position[0] - second.position[0]) -
      (first.size[0] + second.size[0]) / 2;
    const verticalGap = Math.abs(first.position[1] - second.position[1]) -
      (first.size[1] + second.size[1]) / 2;
    assert.ok(
      horizontalGap >= 0.1999 || verticalGap >= 0.1999,
      `${first.id} is too close to ${second.id}: ${horizontalGap.toFixed(3)} m × ${verticalGap.toFixed(3)} m`,
    );
  }));
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
    "generator-flex",
    "multiplus-to-ac-output-protection",
  ]) {
    assert.equal(physicalLayout.routes[routeId].kind, "three-core-ac");
    assert.equal(physicalLayout.routes[routeId].conductors, 3);
  }
});

test("Starlink uses one thin two-conductor OEM cable from the junction to the Mini", () => {
  const route = physicalLayout.routes["junction-to-starlink-power-cable"];
  assert.equal(route.kind, "two-core-dc");
  assert.equal(route.conductors, 2);
  assert.deepEqual(route.points[0], physicalLayout.ports.junctionStarlinkCable);
  assert.deepEqual(route.points.at(-1), physicalLayout.ports.starlinkPowerCable);
  assert.equal(physicalLayout.routes["junction-to-starlink-positive"], undefined);
  assert.equal(physicalLayout.routes["junction-to-starlink-negative"], undefined);
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

test("cable clearance audit catches parallel overlaps and endpoint-to-interior crossings", () => {
  const route = (
    id: string,
    points: PhysicalCableRoute["points"],
  ): PhysicalCableRoute => ({
    id,
    kind: "dc-positive",
    points,
    radiusM: 0.01,
    conductors: 1,
    lengthM: routeLength(points),
    planarDirectionReversals: 0,
    routing: "automatic-rectilinear",
  });
  const horizontal = route("horizontal", [[0, 0, 0], [1, 0, 0]]);
  const parallelOverlap = route("parallel", [[0.25, 0, 0], [0.75, 0, 0]]);
  const endpointOnInterior = route("endpoint", [[0.5, 0, 0], [0.5, 1, 0]]);

  assert.ok(cableRoutePairClearanceIssues(horizontal, parallelOverlap, 0.004).length > 0);
  assert.ok(cableRoutePairClearanceIssues(horizontal, endpointOnInterior, 0.004).length > 0);
});

test("battery power and balancer leads form one intersection-free routed bundle", () => {
  const batteryHarnessRouteIds = new Set([
    "battery-series-a",
    "battery-series-b",
    "junction-to-class-t-a",
    "junction-to-class-t-b",
    "battery-a-to-class-t",
    "battery-b-to-class-t",
    "junction-to-battery-negative-a",
    "junction-to-battery-negative-b",
    "balancer-a-positive",
    "balancer-a-midpoint",
    "balancer-a-negative",
    "balancer-b-positive",
    "balancer-b-midpoint",
    "balancer-b-negative",
  ]);
  const harness = Object.values(physicalLayout.routes).filter((route) => (
    batteryHarnessRouteIds.has(route.id)
  )).map((route) => ({
    ...route,
    lengthM: voxelRoutingRaw.voxelAStar.routes[route.id as keyof typeof voxelRoutingRaw.voxelAStar.routes]?.lengthM ?? route.lengthM,
    points: voxelRoutingRaw.voxelAStar.routes[route.id as keyof typeof voxelRoutingRaw.voxelAStar.routes]?.points ?? route.points,
  }));

  assert.equal(harness.length, batteryHarnessRouteIds.size);
  assert.deepEqual(cableClearanceIssues(harness, 0.003), []);
  for (const route of harness.filter((candidate) => candidate.id.startsWith("balancer-"))) {
    assert.equal(route.routing, "automatic-rectilinear");
    assert.deepEqual(route.points[0], physicalLayout.ports[route.sourcePortId!]);
    assert.deepEqual(route.points.at(-1), physicalLayout.ports[route.targetPortId!]);
    assert.ok(route.points.length >= 6, `${route.id} should include solved lead-out and depth lanes`);
  }
});

test("compact junction breakout lanes separate Ekrano and UniFi depth transitions", () => {
  const ekranNegative = physicalLayout.routes["junction-to-ekrano-negative"];
  const unifiNegative = physicalLayout.routes["junction-to-unifi-converter-negative"];
  assert.deepEqual(cableRoutePairClearanceIssues(ekranNegative, unifiNegative, 0.003), []);
});

test("battery cables never take a depth lane in front of the battery bank", () => {
  for (const id of [
    "junction-to-battery-negative-a",
    "junction-to-battery-negative-b",
    "battery-a-to-class-t",
    "battery-b-to-class-t",
  ]) {
    const route = physicalLayout.routes[id];
    const endpointMaximumZ = Math.max(route.points[0][2], route.points.at(-1)![2]);
    const routeMaximumZ = Math.max(...route.points.map((point) => point[2]));
    assert.ok(routeMaximumZ - endpointMaximumZ <= 0.024, `${id} moves unnecessarily forward`);
  }
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
    assert.equal(route.routing, "automatic-rectilinear");
  }
  assert.equal(physicalLayout.metrics.junctionBackRouteCount, 0);
});

test("position overrides regenerate ports, routes, lengths and score", () => {
  const moved = solvePhysicalLayout({
    routingEffort: "optimization",
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
    routingEffort: "optimization",
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
    routingEffort: "optimization",
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
    routingEffort: "optimization",
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
    "generator-flex",
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

test("the generator uses one direct flex with no intermediate inlet box", () => {
  assert.equal(physicalLayout.devices.generatorInlet, undefined);
  assert.equal(physicalLayout.ports.generatorInletAcCable, undefined);
  assert.deepEqual(physicalLayout.routes["generator-flex"].points[0], physicalLayout.ports.generatorAcCable);
  assert.deepEqual(physicalLayout.routes["generator-flex"].points.at(-1), physicalLayout.ports.multiPlusAcInputCable);

  const inverter = physicalLayout.devices.multiPlus;
  const moved = solvePhysicalLayout({
    routingEffort: "optimization",
    deviceOverrides: {
      multiPlus: {
        position: [inverter.position[0] + 0.25, inverter.position[1] + 0.2, inverter.position[2]],
      },
    },
  });
  assert.deepEqual(moved.routes["generator-flex"].points.at(-1), moved.ports.multiPlusAcInputCable);
  assert.notDeepEqual(moved.routes["generator-flex"].points.at(-1), physicalLayout.ports.multiPlusAcInputCable);
});

test("saved adaptive voxel A-star artifact is the complete production wall and junction harness", () => {
  const voxel = voxelRoutingRaw.voxelAStar;
  const junction = voxelRoutingRaw.junctionVoxelAStar;
  assert.equal("current" in voxelRoutingRaw, false);
  assert.equal(voxel.cellSizeM, 0.0144);
  assert.deepEqual(voxel.failedRouteIds, []);
  assert.equal(voxel.metrics.routeCount, 42);
  assert.ok(voxel.metrics.totalLengthM < 58);
  assert.equal(voxel.metrics.cableClearanceIssueCount, 0);
  assert.equal(voxel.metrics.deviceFrontViolationCount, 0);
  assert.equal(voxel.metrics.roundedDeviceFrontViolationCount, 0);
  assert.equal(voxel.metrics.portApproachViolationCount, 0);
  assert.equal(voxel.routingPasses, 1);
  assert.ok(voxel.solveMs < 45_000);
  assert.deepEqual(junction.failedRouteIds, []);
  assert.equal(junction.cellSizeM, 0.0144);
  assert.equal(junction.metrics.routeCount, 35);
  assert.equal(junction.metrics.cableClearanceIssueCount, 0);
  assert.equal(junction.metrics.connectorCollisionCount, 0);
  assert.equal(junction.metrics.directionReversalCount, 0);
  assert.equal(junction.metrics.portApproachViolationCount, 0);
  assert.equal(junction.metrics.protectedFrontViolationCount, 0);
  assert.equal(junction.metrics.roundedCableClearanceIssueCount, 0);
  assert.equal(junction.metrics.unrelatedDeviceFrontViolationCount, 0);
  assert.ok(junction.solveMs < 30_000);
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
