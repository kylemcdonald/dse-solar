import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dseRuntime } from "../app/dseRuntime";
import { dseTopology } from "../app/dseTopology";
import { routeVoxelForTest, sampledRouteWallPlaneCrossings } from "../app/systemGraphRuntime";
import { GEOMETRY_UNIT_M, WORLD_ROUTING_STEP_UNITS } from "../app/systemGraph";
import {
  renderedRoutePoints,
  renderedSemanticCables,
  sampleCableCurve,
} from "../app/renderedCableGeometry";
import type { Vec3 } from "../app/systemGraph";

const runtime = dseRuntime;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const magnitude = (a: Vec3) => Math.hypot(...a);
const endpointDeviceId = (endpoint: string) => endpoint.split(".", 1)[0];
const attachmentRootDeviceId = (endpoint: string) => {
  let deviceId = endpointDeviceId(endpoint);
  const visited = new Set<string>();
  while (!visited.has(deviceId)) {
    visited.add(deviceId);
    const attachment = runtime.deviceById.get(deviceId)?.attachment?.endpoint;
    if (!attachment) return deviceId;
    deviceId = endpointDeviceId(attachment);
  }
  throw new Error(`Attachment cycle at ${endpoint}`);
};
const topologyDeviceById = (id: string) => {
  const device = dseTopology.devices.find((candidate) => candidate.id === id);
  assert.ok(device, `missing topology device ${id}`);
  return device;
};

test("canonical graph resolves every device, conductor and connection", () => {
  assert.equal(runtime.devices.length, dseTopology.devices.length);
  assert.equal(runtime.routes.length, dseTopology.connections.length);
  assert.equal(runtime.diagnostics.fallbacks, 0);
  assert.equal(runtime.diagnostics.routed, dseTopology.connections.length);
  assert.equal(runtime.diagnostics.centerlineConflicts, 0);
  assert.equal(runtime.diagnostics.sweptCableConflicts, 0);
  assert.equal(runtime.diagnostics.selfIntersections, 0);
  assert.equal(runtime.diagnostics.deviceConflicts, 0);
  assert.equal(runtime.diagnostics.renderedGeometryConflicts, 0);
  assert.equal(runtime.diagnostics.source, "precomputed");
  assert.equal(runtime.diagnostics.buildMs, 0);
  assert.ok(runtime.diagnostics.hydrateMs < 50, `artifact hydration took ${runtime.diagnostics.hydrateMs.toFixed(1)} ms`);
  assert.ok(runtime.diagnostics.artifactBytes > 100_000);
});

test("browser runtime hydrates the committed artifact without importing the solver", async () => {
  const source = await readFile(new URL("../app/dseRuntime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /buildSystemRuntime|systemGraphRuntime/);
  const artifact = JSON.parse(await readFile(new URL("../data/generated/dse-runtime.json", import.meta.url), "utf8"));
  assert.match(artifact.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(artifact.graphId, dseTopology.id);
  assert.equal(artifact.graphRevision, dseTopology.revision);
});

test("battery cutoff enclosure contains exactly the A, B and MPPT single-pole cutoffs", () => {
  const members = runtime.devices
    .filter((device) => device.placement.space === "junction" && device.placement.junctionId === "batteryCutoffJunction")
    .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
  assert.deepEqual(members.map((device) => device.id), ["batteryBreakerA", "batteryBreakerB", "mpptBreaker"]);
  assert.ok(members.every((device) => device.kind === "breaker" && device.poles === 1));
  assert.equal(runtime.devices.some((device) => /usb.*breaker|breaker.*usb/i.test(device.id)), false);
});

test("purchased cutoff and secondary enclosures retain their exact received dimensions", () => {
  const expected = [
    {
      id: "batteryCutoffJunction",
      junctionId: "battery-cutoff",
      label: "Battery / MPPT cutoff junction box · verified 200 × 155 × 92 mm",
      physicalSize: [0.200, 0.155, 0.092],
      latticeSize: [0.20, 0.16, 0.10],
      bomId: "dse-mollom-8-way-enclosure-second",
    },
    {
      id: "secondaryJunction",
      junctionId: "secondary",
      label: "Secondary 24 V services junction box · verified 302 × 302 × 178 mm",
      physicalSize: [0.302, 0.302, 0.178],
      latticeSize: [0.30, 0.30, 0.18],
      bomId: "dse-ventilated-ip65-enclosure",
    },
  ] as const;

  for (const specification of expected) {
    const source = topologyDeviceById(specification.id);
    const definition = dseTopology.junctions.find((candidate) => candidate.id === specification.junctionId);
    assert.equal(source.label, specification.label);
    assert.equal(source.status, "purchased");
    assert.ok(source.bomIds?.includes(specification.bomId));
    assert.deepEqual(source.physicalSize, specification.physicalSize,
      `${specification.id} received external dimensions`);
    assert.deepEqual(source.size, specification.latticeSize, `${specification.id} modeled lattice envelope`);
    assert.equal(definition?.sizePolicy, "verified-fixed");
    assert.deepEqual(definition?.minimumSize, specification.latticeSize, `${specification.id} fixed definition`);
    assert.deepEqual(runtime.deviceById.get(specification.id)?.size, specification.latticeSize,
      `${specification.id} precomputed geometry must not auto-grow`);
    assert.deepEqual(runtime.deviceById.get(specification.id)?.physicalSize, specification.physicalSize,
      `${specification.id} precomputed rendering must use received dimensions`);
  }
});

test("secondary services has exactly the three requested branch breakers and no incomer device", () => {
  const rail = runtime.devices
    .filter((device) => device.kind === "breaker"
      && device.placement.space === "junction"
      && device.placement.junctionId === "secondaryJunction"
      && device.placement.section === "din")
    .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
  assert.deepEqual(rail.map((device) => device.id), [
    "sharedServicesBreaker", "orionBreaker32", "chargeItBreaker32",
  ]);
  assert.ok(rail.every((device) => device.kind === "breaker" && device.poles === 1));
  assert.equal(runtime.deviceById.has("secondaryFeederBreaker"), false);
  const sourceMembers = dseTopology.devices.filter((device) => (
    device.placement.space === "junction" && device.placement.junctionId === "secondaryJunction"
  ));
  const sourceRail = sourceMembers
    .filter((device) => device.kind === "breaker" && device.placement.space === "junction" && device.placement.section === "din")
    .toSorted((first, second) => (
      (first.placement.space === "junction" ? first.placement.order : 0)
      - (second.placement.space === "junction" ? second.placement.order : 0)
    ));
  assert.deepEqual(sourceRail.map((device) => device.id), rail.map((device) => device.id));
  assert.equal(sourceMembers.some((device) => /\b80\s*A\b|incomer/i.test(`${device.id} ${device.label} ${device.subtitle ?? ""}`)), false);
  assert.equal(dseTopology.connections.some((connection) => connection.id === "secondary-feeder-positive-protected"), false);
});

test("Orion and ChargeIT inputs use their dedicated 32 A breakers without output-side breaker devices", () => {
  const orion = runtime.deviceById.get("usbOrion")!;
  assert.deepEqual(orion.conductors.map((port) => port.id), ["remoteH", "positiveIn", "ground", "positiveOut"]);
  assert.deepEqual([runtime.routeById.get("orion-breaker-feed")?.from, runtime.routeById.get("orion-breaker-feed")?.to],
    ["secondaryPositiveBus.post2", "orionBreaker32.line"]);
  assert.deepEqual([runtime.routeById.get("orion-input-positive")?.from, runtime.routeById.get("orion-input-positive")?.to],
    ["orionBreaker32.load", "usbOrion.positiveIn"]);
  assert.deepEqual([runtime.routeById.get("chargeit-breaker-feed")?.from, runtime.routeById.get("chargeit-breaker-feed")?.to],
    ["secondaryPositiveBus.post3", "chargeItBreaker32.line"]);
  assert.deepEqual([runtime.routeById.get("mini-positive-feed")?.from, runtime.routeById.get("mini-positive-feed")?.to],
    ["chargeItBreaker32.load", "join-usbMiniA-positive.branch"]);
  assert.equal(runtime.devices.some((device) => /output.*breaker|breaker.*output/i.test(device.id)), false);
  const usbRoutes = runtime.routes.filter((route) => /orion|socket-|mini-/.test(route.id));
  assert.equal(usbRoutes.filter((route) => route.status === "hold").length, 0);
});

test("USB power is explicitly daisy chained without distribution buses", () => {
  assert.equal(runtime.devices.some((device) => /usb.*bus|bus.*usb|orion.*bus/i.test(device.id)), false);
  const expected = new Map([
    ["socket-a-b-positive", ["join-usbSocketA-positive.branch", "usbSocketB.positive"]],
    ["socket-a-b-negative", ["join-usbSocketA-negative.through", "usbSocketB.negative"]],
    ["mini-a-b-positive", ["join-usbMiniA-positive.through", "join-usbMiniB-positive.through"]],
    ["mini-b-c-positive", ["join-usbMiniB-positive.branch", "join-usbMiniC-positive.through"]],
    ["mini-c-d-positive", ["join-usbMiniC-positive.branch", "usbMiniD.positive"]],
    ["mini-a-b-negative", ["join-usbMiniA-negative.through", "join-usbMiniB-negative.through"]],
    ["mini-b-c-negative", ["join-usbMiniB-negative.branch", "join-usbMiniC-negative.through"]],
    ["mini-c-d-negative", ["join-usbMiniC-negative.branch", "usbMiniD.negative"]],
  ]);
  for (const [id, endpoints] of expected) {
    const route = runtime.routeById.get(id)!;
    assert.deepEqual([route.from, route.to], endpoints, id);
  }
});

test("only warning-policy and approved-stack landings may retain multiple direct field wires", () => {
  const uses = new Map<string, number>();
  dseTopology.connections.forEach((connection) => {
    for (const endpoint of [connection.from, connection.to]) uses.set(endpoint, (uses.get(endpoint) ?? 0) + 1);
  });
  const repeated = [...uses].filter(([, count]) => count > 1).toSorted(([first], [second]) => first.localeCompare(second));
  assert.deepEqual(repeated, [
    ["mainPositiveBus.post4", 3],
    ["secondaryNegativeBus.post5", 2],
    ["secondaryNegativeBus.post7", 2],
  ]);
  repeated.forEach(([endpoint]) => {
    const [deviceId, portId] = endpoint.split(".");
    const policy = topologyDeviceById(deviceId).conductors.find((port) => port.id === portId)?.sharedConnectionPolicy;
    assert.ok(policy === "warning" || policy === "approved-stack", endpoint);
  });
  const joins = runtime.devices.filter((device) => device.presentation === "wire-join");
  assert.equal(joins.length, dseTopology.devices.filter((device) => device.presentation === "wire-join").length);
  joins.forEach((join) => {
    assert.ok(join.attachment, join.id);
    assert.deepEqual(join.conductors.map((port) => port.id), ["device", "through", "branch"]);
    assert.equal(new Set(join.conductors.map((port) => port.kind)).size, 1, `${join.id} polarity`);
    join.conductors.forEach((port) => {
      const expected = join.conductors.filter((peer) => peer.id !== port.id).map((peer) => peer.id).sort();
      assert.deepEqual([...(port.internalMates ?? [])].sort(), expected, `${join.id}.${port.id}`);
    });
  });
});

test("wire joins are true Y symbols with route-exact arm widths", () => {
  const semantic = renderedSemanticCables(runtime.devices, runtime.conductors, runtime.routes);
  const routeRadiusByEndpoint = new Map(runtime.routes.flatMap((route) => [
    [route.from, Math.max(0.0012, route.diameterMm / 2000)] as const,
    [route.to, Math.max(0.0012, route.diameterMm / 2000)] as const,
  ]));
  for (const join of runtime.devices.filter((device) => device.presentation === "wire-join")) {
    const arms = semantic.filter((cable) => cable.deviceId === join.id);
    assert.equal(arms.length, 3, join.id);
    assert.deepEqual(arms.filter((arm) => arm.branchAngleDegrees !== undefined)
      .map((arm) => arm.branchAngleDegrees).toSorted(), [-45, 45], join.id);
    arms.forEach((arm) => assert.equal(arm.radiusM, routeRadiusByEndpoint.get(arm.conductorKey), arm.id));
    const device = arms.find((arm) => arm.conductorKey.endsWith(".device"))!;
    const through = arms.find((arm) => arm.conductorKey.endsWith(".through"))!;
    const branch = arms.find((arm) => arm.conductorKey.endsWith(".branch"))!;
    assert.ok(device.radiusM >= branch.radiusM, `${join.id} physical-terminal trunk`);
    assert.ok(through.radiusM >= branch.radiusM, `${join.id} through arm must carry the larger wire`);
  }
  const batteryPostJoin = semantic.filter((cable) => cable.deviceId === "join-battery1-positive");
  assert.ok(Math.max(...batteryPostJoin.map((cable) => cable.radiusM))
    > Math.min(...batteryPostJoin.map((cable) => cable.radiusM)), "stacked balancer lead remains visibly smaller");
});

test("every exterior circuit crosses only at the one service penetration", () => {
  const outsideIds = new Set([
    "panel1", "panel2", "panel3", "panel4",
    "generator", "earthElectrode", "outdoorLight", "starlink",
  ]);
  for (const id of outsideIds) {
    const device = runtime.deviceById.get(id)!;
    assert.equal(device.placement.space, "world");
    if (device.placement.space === "world") assert.ok(
      device.placement.surface === "outside" || device.placement.surface === "outside-wall",
      id,
    );
  }
  const visibleRegion = (endpoint: string) => {
    const [deviceId, conductorId] = endpoint.split(".");
    const device = runtime.deviceById.get(deviceId)!;
    const conductor = runtime.conductorByKey.get(`${deviceId}.${conductorId}`)!;
    if (device.presentation === "wall-passthrough") return conductor.face === "back" ? "outside" : "inside";
    return device.placement.space === "world"
      && (device.placement.surface === "outside" || device.placement.surface === "outside-wall")
      ? "outside"
      : "inside";
  };
  dseTopology.connections.forEach((connection) => assert.equal(
    visibleRegion(connection.from),
    visibleRegion(connection.to),
    `${connection.id} renders across semantic inside/outside regions`,
  ));
  const penetration = runtime.deviceById.get("servicePenetration")!;
  const expectedPairs = [
    "ac", "earth", "pvAPos", "pvANeg", "pvBPos", "pvBNeg",
    "frameA", "frameB", "light", "starlinkPower", "starlinkData",
  ];
  assert.equal(penetration.conductors.length, expectedPairs.length * 2);
  for (const prefix of expectedPairs) {
    const outside = penetration.conductors.find((port) => port.id === `${prefix}Outside`)!;
    const inside = penetration.conductors.find((port) => port.id === `${prefix}Inside`)!;
    assert.deepEqual(outside.internalMates, [inside.id], `${prefix} outside mate`);
    assert.deepEqual(inside.internalMates, [outside.id], `${prefix} inside mate`);
  }
});

test("main positive and negative buses and SmartShunt are exposed wall equipment with the shunt beside system negative", () => {
  const positive = runtime.deviceById.get("mainPositiveBus")!;
  const negative = runtime.deviceById.get("mainNegativeBus")!;
  const shunt = runtime.deviceById.get("smartShunt")!;
  assert.deepEqual([positive.kind, negative.kind, shunt.kind], ["busbar", "busbar", "monitor"]);
  for (const device of [positive, negative, shunt]) {
    assert.equal(device.placement.space, "world", device.id);
    if (device.placement.space === "world") assert.equal(device.placement.surface, "wall", device.id);
  }

  const shuntToNegativeGap = negative.position[0] - negative.size[0] / 2
    - (shunt.position[0] + shunt.size[0] / 2);
  assert.ok(shuntToNegativeGap >= 0 && shuntToNegativeGap <= 0.12,
    `SmartShunt/system-negative edge gap is ${shuntToNegativeGap.toFixed(2)} m`);
  assert.ok(Math.abs(shunt.position[1] - negative.position[1]) <= 0.020,
    "SmartShunt and main negative bus must share the short-link mounting row");
  const systemNegativeLink = runtime.routeById.get("shunt-negative-bus")!;
  assert.deepEqual([attachmentRootDeviceId(systemNegativeLink.from), attachmentRootDeviceId(systemNegativeLink.to)],
    ["smartShunt", "mainNegativeBus"]);

  for (const id of ["mainPositiveBus", "mainNegativeBus"]) {
    const source = topologyDeviceById(id);
    assert.equal(source.status, "purchased");
    assert.deepEqual(source.bomIds, ["dse-main-busbars"]);
    assert.match(source.label, /supplied insulating cover/i);
  }
  const sourceShunt = topologyDeviceById("smartShunt");
  assert.equal(sourceShunt.status, "purchased");
  assert.deepEqual(sourceShunt.bomIds, ["dse-shunt"]);
  assert.match(sourceShunt.label, /SmartShunt IP65 500 A/);
  assert.doesNotMatch(sourceShunt.label, /cover/i);
});

test("main-bus covers, uncovered SmartShunt and approved positive-lug stacking remain explicit", async () => {
  const system = JSON.parse(await readFile(new URL("../data/dse-system.json", import.meta.url), "utf8")) as {
    bom: Array<{ id: string; item: string; procurement: string; description: string }>;
  };
  const bomById = new Map(system.bom.map((item) => [item.id, item]));
  const mainBars = bomById.get("dse-main-busbars")!;
  const shunt = bomById.get("dse-shunt")!;
  assert.equal(mainBars.procurement, "Purchased");
  assert.match(mainBars.item, /covered positive\/negative main busbar pair/i);
  assert.match(mainBars.description, /supplied covers installed/i);
  assert.match(mainBars.description, /main-positive lug stacking is approved/i);
  assert.match(shunt.description, /leave it uncovered as accepted/i);
  assert.match(shunt.description, /do not add a separate shunt cover/i);

  const positivePost4 = topologyDeviceById("mainPositiveBus").conductors.find((port) => port.id === "post4");
  assert.ok(positivePost4);
  assert.equal(positivePost4.sharedConnectionPolicy, "approved-stack");
  assert.match(positivePost4.terminalNote ?? "", /lug stacking and clearance under the supplied cover are approved/i);
  assert.equal(dseTopology.devices.filter((device) => (
    device.attachment?.endpoint === "mainPositiveBus.post4"
    || device.attachment?.endpoint.startsWith("join-mainPositiveBus-post4-")
  )).length, 0, "approved hardware stacking does not invent join devices");
  assert.deepEqual(dseTopology.connections.filter((connection) => (
    connection.from === "mainPositiveBus.post4" || connection.to === "mainPositiveBus.post4"
  )).map((connection) => connection.id).toSorted(), [
    "mppt-breaker-bus", "secondary-feeder-positive", "shunt-sense",
  ]);
});

test("MultiPlus rigid assembly is aligned with the balancers between main negative and battery cutoffs", () => {
  const mainNegative = topologyDeviceById("mainNegativeBus");
  const multiPlus = topologyDeviceById("multiPlus");
  const cutoff = topologyDeviceById("batteryCutoffJunction");
  const balancers = [topologyDeviceById("balancerA"), topologyDeviceById("balancerB")];
  const acBreakouts = [topologyDeviceById("multiAcInBreakout"), topologyDeviceById("multiAcOutBreakout")];
  for (const device of [mainNegative, multiPlus, cutoff, ...balancers, ...acBreakouts]) {
    assert.equal(device.placement.space, "world", device.id);
    if (device.placement.space === "world") assert.equal(device.placement.surface, "wall", device.id);
  }
  if (mainNegative.placement.space !== "world" || multiPlus.placement.space !== "world" || cutoff.placement.space !== "world") return;
  const mainNegativeRight = mainNegative.placement.position[0] + mainNegative.size[0] / 2;
  const multiPlusLeft = multiPlus.placement.position[0] - multiPlus.size[0] / 2;
  const multiPlusRight = multiPlus.placement.position[0] + multiPlus.size[0] / 2;
  const cutoffLeft = cutoff.placement.position[0] - cutoff.size[0] / 2;
  const multiPlusY = multiPlus.placement.position[1];
  assert.ok(mainNegativeRight < multiPlusLeft, "MultiPlus must remain right of main negative without overlap");
  assert.ok(multiPlusRight < cutoffLeft, "MultiPlus must remain left of the battery-cutoff enclosure without overlap");
  assert.ok(balancers.every((balancer) => (
    balancer.placement.space === "world"
    && Math.abs(balancer.placement.position[1] - multiPlusY) < 1e-9
  )), "MultiPlus and both balancers share the fixed y=0.82 mounting row");
  assert.deepEqual(multiPlus.placement.position, [1.70, 0.82, 0.071]);
  assert.deepEqual(acBreakouts.map((breakout) => (
    breakout.placement.space === "world" ? breakout.placement.position : undefined
  )), [[1.64, 0.42, 0.018], [1.78, 0.42, 0.018]]);

  const multiPlusBottom = multiPlus.placement.position[1] - multiPlus.size[1] / 2;
  for (const breakout of acBreakouts) {
    if (breakout.placement.space !== "world") continue;
    const breakoutTop = breakout.placement.position[1] + breakout.size[1] / 2;
    const breakoutLeft = breakout.placement.position[0] - breakout.size[0] / 2;
    const breakoutRight = breakout.placement.position[0] + breakout.size[0] / 2;
    assert.ok(breakoutTop < multiPlusBottom, `${breakout.id} must remain below the inverter body`);
    assert.ok(breakoutLeft >= multiPlusLeft && breakoutRight <= multiPlusRight,
      `${breakout.id} must remain beneath the inverter footprint`);
  }
});

test("one held 1/0 feeder pair directly connects main and secondary distribution", () => {
  const isSecondaryMember = (endpoint: string) => {
    const placement = runtime.deviceById.get(endpointDeviceId(endpoint))?.placement;
    return placement?.space === "junction" && placement.junctionId === "secondaryJunction";
  };
  const positiveIngress = dseTopology.connections.filter((connection) => connection.kind === "positive"
    && attachmentRootDeviceId(connection.from) === "mainPositiveBus"
    && isSecondaryMember(connection.to));
  assert.equal(positiveIngress.length, 1);
  assert.equal(positiveIngress[0].id, "secondary-feeder-positive");
  assert.equal(attachmentRootDeviceId(positiveIngress[0].to), "secondaryPositiveBus");
  assert.equal(positiveIngress[0].status, "hold");
  assert.match(positiveIngress[0].holdReason ?? "", /upstream overcurrent coordination.*100 A Blue Sea bus/i);

  const negativeIngress = dseTopology.connections.filter((connection) => connection.kind === "negative"
    && attachmentRootDeviceId(connection.from) === "mainNegativeBus"
    && attachmentRootDeviceId(connection.to) === "secondaryNegativeBus");
  assert.equal(negativeIngress.length, 1);
  assert.equal(negativeIngress[0].id, "secondary-feeder-negative");
  assert.equal(negativeIngress[0].status, "hold");
  assert.match(negativeIngress[0].holdReason ?? "", /matching black 1\/0 AWG return.*100 A Blue Sea bus/i);
  assert.deepEqual([...positiveIngress, ...negativeIngress].map((connection) => connection.cableId), ["battery53", "battery53"]);
  assert.equal(runtime.routeById.has("secondary-feeder-positive-protected"), false);
});

test("secondary service branches take positive sources and negative returns from the secondary buses", () => {
  const positiveBranches = [
    ["service-main", "sharedServicesBreaker"],
    ["orion-breaker-feed", "orionBreaker32"],
    ["chargeit-breaker-feed", "chargeItBreaker32"],
  ] as const;
  for (const [routeId, breakerId] of positiveBranches) {
    const route = runtime.routeById.get(routeId)!;
    assert.equal(attachmentRootDeviceId(route.from), "secondaryPositiveBus", `${routeId} source`);
    assert.equal(route.to, `${breakerId}.line`, `${routeId} branch breaker`);
  }

  const negativeReturns = [
    "secondary-feeder-negative",
    "room-light-negative",
    "outdoor-light-negative",
    "internet-starlink-negative",
    "internet-unifi-negative",
    "ekrano-negative",
    "orion-common-ground",
    "socket-negative-feed",
    "mini-negative-feed",
  ];
  for (const routeId of negativeReturns) {
    const route = runtime.routeById.get(routeId)!;
    const roots = [attachmentRootDeviceId(route.from), attachmentRootDeviceId(route.to)];
    assert.ok(roots.includes("secondaryNegativeBus"), `${routeId} lands directly on the secondary-negative bus`);
    if (routeId !== "secondary-feeder-negative") {
      assert.equal(attachmentRootDeviceId(route.from), "secondaryNegativeBus", `${routeId} return source`);
    }
  }
  assert.equal(dseTopology.devices.some((device) => /serviceReturn|internetReturn/i.test(device.id)), false);
});

test("the socket return leaves secondary-negative post 3 through the right-hand gland approach", () => {
  const enclosure = runtime.deviceById.get("secondaryJunction")!;
  const port = runtime.conductorByKey.get("secondaryNegativeBus.post3")!;
  const route = runtime.routeById.get("socket-negative-feed")!;
  const gland = runtime.glands.find((candidate) => candidate.connectionIds.includes(route.id))!;
  const enclosureBottom = enclosure.position[1] - enclosure.size[1] / 2;
  const exteriorPoints = route.points.filter((point) => point[1] < enclosureBottom - 1e-8);

  assert.ok(port.position[0] > enclosure.position[0], "post 3 is on the bus's right half");
  assert.ok(gland.position[0] >= enclosure.position[0], "socket return uses a right-half gland");
  assert.ok(exteriorPoints.length > 0);
  assert.ok(exteriorPoints.every((point) => point[0] >= gland.position[0] - 1e-8),
    "the exterior run never detours around the enclosure's left side");
});

test("battery source leads remain materially shorter than the retired 6.58 m arrangement", () => {
  const sourceLeadIds = [
    "battery-a-positive-breaker",
    "battery-b-positive-breaker",
    "battery-a-negative-shunt",
    "battery-b-negative-shunt",
  ];
  const sourceLeads = sourceLeadIds.map((id) => runtime.routeById.get(id)!);
  assert.deepEqual(sourceLeads.map((route) => attachmentRootDeviceId(route.from)),
    ["battery2", "battery4", "battery1", "battery3"]);
  assert.deepEqual(sourceLeads.map((route) => attachmentRootDeviceId(route.to)),
    ["batteryBreakerA", "batteryBreakerB", "smartShunt", "smartShunt"]);
  const totalLengthM = sourceLeads.reduce((sum, route) => sum + route.lengthM, 0);
  assert.ok(totalLengthM < 4.0,
    `battery source leads total ${totalLengthM.toFixed(2)} m; split layout budget is under 4.00 m`);
});

test("published 1/0 cable plan is derived from the current compact routed geometry", async () => {
  const system = JSON.parse(await readFile(new URL("../data/dse-system.json", import.meta.url), "utf8")) as {
    batteryCablePlan: {
      routedTotalLengthM: number;
      planningTotalLengthM: number;
      planningTotalLengthFt: number;
      sourceLeadComparison: { currentRoutedTotalM: number };
      assemblies: Array<{ route: string; qty: number; routedLengthM: number; planningLengthM: number }>;
    };
  };
  const routeIds = new Map([
    ["series-a", "battery-a-series"],
    ["series-b", "battery-b-series"],
    ["battery-a-positive-to-cutoff", "battery-a-positive-breaker"],
    ["battery-b-positive-to-cutoff", "battery-b-positive-breaker"],
    ["cutoff-a-to-main-positive", "battery-a-breaker-bus"],
    ["cutoff-b-to-main-positive", "battery-b-breaker-bus"],
    ["battery-a-negative-to-shunt", "battery-a-negative-shunt"],
    ["battery-b-negative-to-shunt", "battery-b-negative-shunt"],
    ["shunt-to-main-negative", "shunt-negative-bus"],
    ["main-positive-to-multiplus", "multiplus-positive"],
    ["main-negative-to-multiplus", "multiplus-negative"],
    ["main-positive-to-secondary-positive", "secondary-feeder-positive"],
    ["main-negative-to-secondary-negative", "secondary-feeder-negative"],
  ]);
  const plan = system.batteryCablePlan;
  assert.deepEqual(plan.assemblies.map((assembly) => assembly.route), [...routeIds.keys()]);
  plan.assemblies.forEach((assembly) => {
    const route = runtime.routeById.get(routeIds.get(assembly.route)!)!;
    const routed = Number(route.lengthM.toFixed(2));
    const planned = Number((Math.ceil((route.lengthM * 1.10 - 1e-9) / 0.05) * 0.05).toFixed(2));
    assert.equal(assembly.routedLengthM, routed, assembly.route);
    assert.equal(assembly.planningLengthM, planned, `${assembly.route} allowance`);
  });
  const routedTotal = Number(plan.assemblies.reduce((sum, assembly) => (
    sum + assembly.routedLengthM * assembly.qty
  ), 0).toFixed(2));
  const planningTotal = Number(plan.assemblies.reduce((sum, assembly) => (
    sum + assembly.planningLengthM * assembly.qty
  ), 0).toFixed(2));
  assert.equal(plan.routedTotalLengthM, routedTotal);
  assert.equal(plan.planningTotalLengthM, planningTotal);
  assert.equal(plan.planningTotalLengthFt, Number((planningTotal * 3.280839895).toFixed(2)));
  const sourceLeadIds = new Set([
    "battery-a-positive-to-cutoff",
    "battery-b-positive-to-cutoff",
    "battery-a-negative-to-shunt",
    "battery-b-negative-to-shunt",
  ]);
  assert.equal(plan.sourceLeadComparison.currentRoutedTotalM, Number(plan.assemblies
    .filter((assembly) => sourceLeadIds.has(assembly.route))
    .reduce((sum, assembly) => sum + assembly.routedLengthM * assembly.qty, 0)
    .toFixed(2)));
});

test("repeated equipment families declare canonical layout grouping", () => {
  const expected = new Map([
    ["pv-panels", { columns: 2, count: 4 }],
    ["battery-bank", { columns: 2, count: 4 }],
    ["chargeit-minis", { columns: 4, count: 4 }],
    ["coolgear-145", { columns: 2, count: 2 }],
  ]);
  for (const [id, spec] of expected) {
    const members = runtime.devices.filter((device) => device.layoutGroup?.id === id)
      .toSorted((first, second) => first.layoutGroup!.order - second.layoutGroup!.order);
    assert.equal(members.length, spec.count, id);
    assert.ok(members.every((device) => device.layoutGroup?.columns === spec.columns), id);
    assert.deepEqual(members.map((device) => device.layoutGroup?.order), Array.from({ length: spec.count }, (_, index) => index));
  }
});

test("Ekrano uses its factory-fused cable without a separate fuse device", () => {
  assert.equal(runtime.deviceById.has("ekranoFuse"), false);
  const feed = runtime.routeById.get("ekrano-positive")!;
  const returnRoute = runtime.routeById.get("ekrano-negative")!;
  assert.equal(attachmentRootDeviceId(feed.from), "secondaryPositiveBus");
  assert.equal(feed.to, "ekrano.positive");
  assert.equal(attachmentRootDeviceId(returnRoute.from), "secondaryNegativeBus");
  assert.equal(returnRoute.to, "ekrano.negative");
});

test("battery series jumpers join the adjacent posts", () => {
  for (const id of ["battery-a-series", "battery-b-series"]) {
    const route = runtime.routeById.get(id)!;
    const from = runtime.conductorByKey.get(route.from)!.position;
    const to = runtime.conductorByKey.get(route.to)!.position;
    assert.ok(magnitude(subtract(to, from)) < 0.20, `${id} endpoints are not adjacent`);
    assert.ok(route.lengthM < 0.30, `${id} routed jumper is unexpectedly long`);
  }
});

test("PV combination is one selectable dual-polarity rigid rail assembly", () => {
  assert.equal(runtime.devices.some((device) => device.id === "pvCombiner"), false);
  const rail = runtime.deviceById.get("pvCombRails")!;
  assert.equal(rail.presentation, "rigid-rail");
  assert.equal(runtime.devices.filter((device) => device.presentation === "rigid-rail").length, 1);
  assert.equal(Object.keys(rail.railTargets ?? {}).length, 8);
  const combRoutes = runtime.routes.filter((route) => route.cableId === "pvComb");
  assert.equal(combRoutes.length, 8);
  assert.deepEqual(combRoutes.map((route) => route.id), [
    "pv-comb-a-b-positive", "pv-comb-b-tap-positive",
    "pv-comb-b-spd-positive", "pv-comb-spd-disconnect-positive",
    "pv-comb-a-b-negative", "pv-comb-b-tap-negative",
    "pv-comb-b-spd-negative", "pv-comb-spd-disconnect-negative",
  ]);
  assert.ok(combRoutes.every((route) => (
    runtime.conductorByKey.get(route.from)?.face === "top"
    && runtime.conductorByKey.get(route.to)?.deviceId === "pvCombRails"
    && route.lengthM <= 0.021
  )));
});

test("AC protection has terminals on top and bottom only", () => {
  for (const id of ["acInputProtection", "acOutputProtection"]) {
    const device = runtime.deviceById.get(id)!;
    assert.equal(device.conductors.length, 5);
    assert.ok(device.conductors.every((port) => port.face === "top" || port.face === "bottom"), id);
  }
});

test("generator and Type I outlet retain their bodies and expose integrated three-core Y breakouts", () => {
  const semantic = renderedSemanticCables(runtime.devices, runtime.conductors, runtime.routes);
  for (const deviceId of ["generator", "toolOutlet"]) {
    const device = runtime.deviceById.get(deviceId)!;
    assert.equal(device.presentation, "integrated-cable-breakout");
    const arms = semantic.filter((cable) => cable.deviceId === deviceId);
    assert.equal(arms.length, 3, `${deviceId} three colored cores use the routed multicore cable as their white trunk`);
    assert.deepEqual(new Set(arms.map((arm) => arm.conductorKey)), new Set([
      `${deviceId}.line`, `${deviceId}.neutral`, `${deviceId}.earth`,
    ]));
    const cablePort = runtime.conductorByKey.get(`${deviceId}.cable`)!;
    const outwardScale = 1 / magnitude(cablePort.direction);
    const outward = cablePort.direction.map((value) => value * outwardScale) as unknown as Vec3;
    arms.forEach((arm) => {
      const conductor = runtime.conductorByKey.get(arm.conductorKey)!;
      const points = sampleCableCurve(arm.pieces);
      assert.deepEqual(points[0], conductor.position, `${arm.id} begins at its real colored post`);
      assert.deepEqual(points.at(-1), arm.splitPoint, `${arm.id} terminates at the common white-cable split`);
      assert.ok(dot(subtract(arm.splitPoint, cablePort.position), outward) > 0.020,
        `${arm.id} split is outside the device body`);
      assert.ok(points.slice(1).every((point) => dot(subtract(point, conductor.position), outward) >= -1e-9),
        `${arm.id} remains outside its terminal face`);
    });
    assert.equal(new Set(arms.map((arm) => arm.splitPoint.join(","))).size, 1,
      `${deviceId} cores combine at one external point`);
    assert.ok(arms.every((arm) => arm.routedCableEndpoint === `${deviceId}.cable`),
      `${deviceId} arms identify the routed white sheath they replace`);
    const whiteRoute = runtime.routes.find((route) => (
      route.from === `${deviceId}.cable` || route.to === `${deviceId}.cable`
    ));
    assert.ok(whiteRoute, `${deviceId} has one routed white multicore sheath`);
    const canonicalPoints = whiteRoute.points.map((point) => [...point] as Vec3);
    const cableAtStart = whiteRoute.from === `${deviceId}.cable`;
    const cableRouteEndpoint = cableAtStart ? whiteRoute.points[0] : whiteRoute.points.at(-1)!;
    assert.deepEqual(cableRouteEndpoint, cablePort.position,
      `${deviceId} graph route retains its physical terminal endpoint`);
    const visiblePoints = renderedRoutePoints(whiteRoute, semantic);
    const visibleCableEndpoint = cableAtStart ? visiblePoints[0] : visiblePoints.at(-1)!;
    assert.deepEqual(visibleCableEndpoint, arms[0].splitPoint,
      `${deviceId} visible white route begins at the external three-core fusion`);
    assert.ok(!visiblePoints.some((point) => point.every((coordinate, index) => (
      Math.abs(coordinate - cablePort.position[index]) < 1e-9
    ))), `${deviceId} duplicate white terminal segment is hidden`);
    assert.deepEqual(whiteRoute.points, canonicalPoints,
      `${deviceId} visible trimming does not mutate canonical graph geometry`);
    device.conductors.forEach((port) => {
      assert.ok((port.internalMates?.length ?? 0) > 0, `${deviceId}.${port.id} has internal continuity`);
      port.internalMates!.forEach((mateId) => {
        assert.ok(device.conductors.find((candidate) => candidate.id === mateId)?.internalMates?.includes(port.id),
          `${deviceId}.${port.id}/${mateId} reciprocal`);
      });
    });
  }
  const toolOutlet = topologyDeviceById("toolOutlet");
  assert.deepEqual(toolOutlet.conductors.map((port) => [port.id, port.face, port.order]), [
    ["line", "bottom", 0],
    ["cable", "bottom", 1],
    ["neutral", "bottom", 2],
    ["earth", "bottom", 3],
  ]);
  assert.equal(toolOutlet.placement.space, "world");
  const acJunction = topologyDeviceById("acJunction");
  if (toolOutlet.placement.space === "world" && acJunction.placement.space === "world") {
    const toolRight = toolOutlet.placement.position[0] + toolOutlet.size[0] / 2;
    const enclosureLeft = acJunction.placement.position[0] - acJunction.size[0] / 2;
    assert.ok(toolRight < enclosureLeft, "tool outlet remains left of and outside the AC enclosure footprint");
  }
});

test("source topology references only the purchased MPPT wirebox and AC protection BOM rows", () => {
  assert.deepEqual(topologyDeviceById("smartSolar").bomIds, ["dse-smartsolar", "dse-mppt-wirebox-tr"]);
  assert.deepEqual(topologyDeviceById("acJunction").bomIds, ["dse-ac-rcbo"]);
});

test("SmartShunt sense and VE.Direct terminals share the ordered top face", () => {
  const shunt = topologyDeviceById("smartShunt");
  const ordered = ["vBattPlus", "veDirect"].map((id) => {
    const terminal = shunt.conductors.find((port) => port.id === id)!;
    return [terminal.id, terminal.face, terminal.order];
  });
  assert.deepEqual(ordered, [
    ["vBattPlus", "top", 0],
    ["veDirect", "top", 1],
  ]);
});

test("every conductor has selectable physical terminal metadata", () => {
  for (const conductor of runtime.conductors) {
    assert.ok(conductor.terminal, `${conductor.key} terminal`);
    assert.ok(conductor.terminalSize, `${conductor.key} terminal size`);
    assert.ok(conductor.termination, `${conductor.key} termination`);
    assert.ok((conductor.terminalDiameterMm ?? 0) > 0, `${conductor.key} diameter`);
    assert.ok((conductor.terminalLengthMm ?? 0) > 0, `${conductor.key} length`);
  }
});

test("serial route order is thickest cable first", () => {
  const cableById = new Map(dseTopology.cables.map((cable) => [cable.id, cable]));
  const connectionById = new Map(dseTopology.connections.map((connection) => [connection.id, connection]));
  const diameters = runtime.diagnostics.routingOrder.map((id) => (
    cableById.get(connectionById.get(id)!.cableId)!.outsideDiameterMm
  ));
  diameters.slice(1).forEach((diameter, index) => assert.ok(diameters[index] >= diameter));
});

test("purchased six-gang panel has the three assigned controls and three spares", () => {
  const panel = runtime.deviceById.get("switchPanel")!;
  assert.equal(panel.status, "purchased");
  assert.deepEqual(panel.conductors.slice(1).map((port) => port.label), [
    "To Starlink Mini / UniFi 24 V to 5 V USB-A converter",
    "To Outdoor utility light",
    "To Victron Orion-Tr Smart 24/12-30",
    "Switch 4 · spare",
    "Switch 5 · spare",
    "Switch 6 · spare",
  ]);
});

test("all conductors touch the declared device face", () => {
  for (const port of runtime.conductors) {
    const device = runtime.deviceById.get(port.deviceId)!;
    if (device.presentation === "rigid-rail") {
      const target = runtime.conductorByKey.get(device.railTargets?.[port.id] ?? "")!;
      assert.ok(Math.abs(magnitude(subtract(port.position, target.position)) - 0.020) < 1e-8, port.key);
      assert.ok(dot(port.direction, target.direction) < -0.999999, port.key);
      continue;
    }
    const delta = subtract(port.position, device.position);
    const expected = port.face === "top" || port.face === "bottom"
      ? device.size[1] / 2
      : port.face === "left" || port.face === "right" ? device.size[0] / 2 : device.size[2] / 2;
    assert.ok(Math.abs(dot(delta, port.direction) - expected) < 1e-8, port.key);
  }
});

test("axis-aligned geometry lands directly on the one global 20 mm route lattice", () => {
  const routeCell = GEOMETRY_UNIT_M * WORLD_ROUTING_STEP_UNITS;
  const onRouteGrid = (value: number) => Math.abs(value / routeCell - Math.round(value / routeCell)) < 1e-8;
  for (const device of runtime.devices) {
    const axisAligned = device.rotation.every((value) => Math.abs(value / (Math.PI / 2) - Math.round(value / (Math.PI / 2))) < 1e-8);
    if (!axisAligned) continue;
    if (device.kind !== "junction") assert.ok(device.position.every(onRouteGrid), `${device.id} centre`);
    assert.ok(device.size.every((value) => Math.abs(value / GEOMETRY_UNIT_M - Math.round(value / GEOMETRY_UNIT_M)) < 1e-8), `${device.id} size`);
  }
  for (const port of runtime.conductors) {
    if (port.direction.filter((value) => Math.abs(value) > 1e-8).length !== 1) continue;
    assert.ok(port.position.every(onRouteGrid), port.key);
  }
});

test("visible routes never intersect the finite wall outside the one passthrough aperture", () => {
  assert.deepEqual(sampledRouteWallPlaneCrossings(runtime.routes, runtime.devices), []);
});

test("panel terminal transforms match the Three.js XYZ mounting basis", () => {
  const lead = runtime.conductorByKey.get("panel1.positive")!;
  const tilt = Math.PI / 10;
  const expected: Vec3 = [-Math.cos(tilt), -Math.sin(tilt), 0];
  assert.ok(magnitude(subtract(lead.direction, expected)) < 1e-8);
});

test("every routed wire meets both terminals on their declared axes", () => {
  for (const route of runtime.routes) {
    const source = runtime.conductorByKey.get(route.from)!;
    const target = runtime.conductorByKey.get(route.to)!;
    const sourceLead = subtract(route.points[1], route.points[0]);
    const targetLead = subtract(route.points.at(-2)!, route.points.at(-1)!);
    assert.ok(dot(sourceLead, source.direction) / magnitude(sourceLead) > 0.999999999, `${route.id} source`);
    assert.ok(dot(targetLead, target.direction) / magnitude(targetLead) > 0.999999999, `${route.id} target`);
    // Terminal leads on explicitly rotated roof/ceiling equipment follow the
    // physical terminal axis. Once clear of each endpoint, voxel legs remain
    // axis-aligned.
    for (let index = 2; index < route.points.length - 1; index += 1) {
      const delta = subtract(route.points[index], route.points[index - 1]);
      const axes = delta.filter((value) => Math.abs(value) > 1e-8).length;
      assert.ok(axes >= 1 && axes <= 3, `${route.id} segment ${index}`);
    }
  }
});

test("each enclosure generates one evenly spaced bottom gland row and grows to contain members", () => {
  for (const definition of dseTopology.junctions) {
    const enclosure = runtime.deviceById.get(definition.deviceId)!;
    const glands = runtime.glands.filter((gland) => gland.junctionId === definition.deviceId).toSorted((a, b) => a.position[0] - b.position[0]);
    assert.ok(glands.length > 0);
    assert.equal(new Set(glands.map((gland) => gland.position[1].toFixed(8))).size, 1);
    const enclosureBottom = enclosure.position[1] - enclosure.size[1] / 2;
    assert.ok(glands.every((gland) => (
      gland.position[1] >= enclosureBottom - 1e-8
      && gland.position[1] - enclosureBottom <= GEOMETRY_UNIT_M + 1e-8
    )), `${definition.id} gland row remains on the shell's snapped bottom edge`);
    const spacings = glands.slice(1).map((gland, index) => gland.position[0] - glands[index].position[0]);
    if (spacings.length > 0) {
      assert.ok(Math.max(...spacings) - Math.min(...spacings) < 1e-8);
      assert.ok(spacings.every((spacing) => Math.abs(spacing - definition.glandSpacing) < 1e-8));
    }
    const rail = runtime.devices
      .filter((device) => device.placement.space === "junction" && device.placement.junctionId === definition.deviceId && device.placement.section === "din")
      .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
    rail.slice(1).forEach((device, index) => {
      const previous = rail[index];
      const gap = device.position[0] - device.size[0] / 2 - (previous.position[0] + previous.size[0] / 2);
      assert.ok(Math.abs(gap - definition.dinGap) < 1e-8, `${definition.id} DIN gap`);
    });
    for (const member of runtime.devices.filter((device) => device.placement.space === "junction" && device.placement.junctionId === definition.deviceId)) {
      assert.ok(member.position[0] - member.size[0] / 2 >= enclosure.position[0] - enclosure.size[0] / 2, member.id);
      assert.ok(member.position[0] + member.size[0] / 2 <= enclosure.position[0] + enclosure.size[0] / 2, member.id);
      assert.ok(member.position[1] - member.size[1] / 2 >= enclosure.position[1] - enclosure.size[1] / 2, member.id);
      assert.ok(member.position[1] + member.size[1] / 2 <= enclosure.position[1] + enclosure.size[1] / 2, member.id);
      assert.ok(member.position[2] - member.size[2] / 2 >= enclosure.position[2] - enclosure.size[2] / 2, `${member.id} rear depth`);
      assert.ok(member.position[2] + member.size[2] / 2 <= enclosure.position[2] + enclosure.size[2] / 2, `${member.id} front depth`);
      const backplateFace = enclosure.position[2] - enclosure.size[2] / 2 + 0.020;
      if (!member.attachment && !member.railTargets) {
        const rearFace = member.position[2] - member.size[2] / 2;
        if (definition.sizePolicy === "verified-fixed") {
          assert.ok(rearFace >= backplateFace - 1e-8, `${member.id} verified depth layer`);
        } else {
          assert.ok(Math.abs(rearFace - backplateFace) < 1e-8, `${member.id} backplate`);
        }
      }
    }
  }
});

test("standalone voxel seam produces an orthogonal path", () => {
  const route = routeVoxelForTest([0, 0, 0], [0.4, 0.24, 0.1], 0.020);
  assert.ok(route && route.length >= 2);
  for (let index = 1; index < route.length; index += 1) {
    const delta = subtract(route[index], route[index - 1]);
    assert.equal(delta.filter((value) => Math.abs(value) > 1e-9).length, 1);
  }
});
