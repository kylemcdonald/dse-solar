import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dseRuntime } from "../app/dseRuntime";
import { dseTopology } from "../app/dseTopology";
import {
  sampledRouteDeviceConflicts,
  sampledRouteWallPlaneCrossings,
} from "../app/systemGraphRuntime";
import { deviceLocalPoint, rotateVector, worldHalfExtents } from "../app/physicalLayout";
import { GEOMETRY_UNIT_M, WORLD_ROUTING_STEP_UNITS, graphWalls } from "../app/systemGraph";
import { renderedSemanticCables } from "../app/renderedCableGeometry";
import type { Vec3 } from "../app/systemGraph";

const runtime = dseRuntime;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const magnitude = (a: Vec3) => Math.hypot(...a);
const endpointDeviceId = (endpoint: string) => endpoint.split(".", 1)[0];
const attachmentRootEndpoint = (initialEndpoint: string) => {
  let endpoint = initialEndpoint;
  const visited = new Set<string>();
  while (!visited.has(endpoint)) {
    visited.add(endpoint);
    const attachment = runtime.deviceById.get(endpointDeviceId(endpoint))?.attachment?.endpoint;
    if (!attachment) return endpoint;
    endpoint = attachment;
  }
  throw new Error(`Attachment cycle at ${initialEndpoint}`);
};
const attachmentRootDeviceId = (endpoint: string) => endpointDeviceId(attachmentRootEndpoint(endpoint));
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

test("rear-mounted enclosure devices block wires across their complete front projection", () => {
  const enclosure = runtime.deviceById.get("secondaryJunction")!;
  const panel = runtime.deviceById.get("unifiPower")!;
  const probeZ = enclosure.position[2] + enclosure.size[2] / 2 - GEOMETRY_UNIT_M;
  const probe = {
    ...runtime.routeById.get("secondary-feeder-positive")!,
    id: "front-projection-probe",
    from: "secondaryPositiveBus.post1",
    to: "secondaryNegativeBus.post1",
    points: [
      [panel.position[0], panel.position[1] - panel.size[1], probeZ],
      [panel.position[0], panel.position[1] + panel.size[1], probeZ],
    ] as readonly Vec3[],
  };

  assert.deepEqual(sampledRouteDeviceConflicts([probe], runtime.devices), [
    "front-projection-probe ↔ unifiPower",
  ], "a cable floating ahead of a rear-mounted device is still a device conflict");
  assert.deepEqual(sampledRouteDeviceConflicts(runtime.routes, runtime.devices), [],
    "the accepted routes go around every unrelated enclosure device");
});

test("voxel routing assigns each bus connection to the shortest compatible free landing", () => {
  const assignments = runtime.diagnostics.routingTargetAssignments;
  assert.ok(assignments.length > 0);
  assert.ok(assignments.some((assignment) => assignment.authoredEndpoint !== assignment.resolvedEndpoint));

  for (const assignment of assignments) {
    const authored = runtime.conductorByKey.get(assignment.authoredEndpoint)!;
    const resolved = runtime.conductorByKey.get(assignment.resolvedEndpoint)!;
    const route = runtime.routeById.get(assignment.connectionId)!;
    assert.equal(resolved.deviceId, authored.deviceId, assignment.connectionId);
    assert.equal(resolved.kind, authored.kind, assignment.connectionId);
    assert.equal(resolved.routingGroup, authored.routingGroup, assignment.connectionId);
    assert.equal(resolved.terminalSize, authored.terminalSize, assignment.connectionId);
    assert.equal(route[assignment.side], assignment.resolvedEndpoint, assignment.connectionId);
  }

  for (const device of runtime.devices) {
    for (const port of device.conductors.filter((candidate) => candidate.routingGroup)) {
      const uses = runtime.routes.filter((route) => route.from === `${device.id}.${port.id}` || route.to === `${device.id}.${port.id}`).length;
      assert.ok(uses <= (port.routingCapacity ?? 1), `${device.id}.${port.id} capacity`);
    }
  }

  const earthRoutes = runtime.routes.filter((route) => (
    route.from.startsWith("earthBar.") || route.to.startsWith("earthBar.")
  ));
  const earthLengthM = earthRoutes.reduce((sum, route) => sum + route.lengthM, 0);
  assert.ok(earthLengthM <= 5.6, `route-aware PE landings total ${earthLengthM.toFixed(3)} m`);
  assert.ok(runtime.diagnostics.totalLengthM < 156.14);
  assert.ok(runtime.diagnostics.totalTurns < 887);
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

test("cutoff retains its verified shell while secondary services uses the larger routed enclosure", () => {
  const cutoff = topologyDeviceById("batteryCutoffJunction");
  const cutoffDefinition = dseTopology.junctions.find((candidate) => candidate.id === "battery-cutoff");
  assert.equal(cutoff.label, "Battery / MPPT cutoff junction box · verified 200 × 155 × 92 mm");
  assert.equal(cutoff.status, "purchased");
  assert.ok(cutoff.bomIds?.includes("dse-mollom-8-way-enclosure-second"));
  assert.deepEqual(cutoff.physicalSize, [0.200, 0.155, 0.092]);
  assert.deepEqual(cutoff.size, [0.20, 0.16, 0.10]);
  assert.equal(cutoffDefinition?.sizePolicy, "verified-fixed");
  assert.deepEqual(runtime.deviceById.get(cutoff.id)?.size, cutoff.size);
  assert.deepEqual(runtime.deviceById.get(cutoff.id)?.physicalSize, cutoff.physicalSize);

  const secondary = topologyDeviceById("secondaryJunction");
  const secondaryDefinition = dseTopology.junctions.find((candidate) => candidate.id === "secondary");
  assert.equal(secondary.label, "Secondary services junction box");
  assert.equal(secondary.status, "hold");
  assert.equal(secondary.physicalSize, undefined);
  assert.ok(secondary.bomIds?.includes("dse-secondary-enclosure-larger"));
  assert.ok(!secondary.bomIds?.includes("dse-ventilated-ip65-enclosure"));
  assert.deepEqual(secondary.size, [0.40, 0.44, 0.20]);
  assert.equal(secondaryDefinition?.sizePolicy, "auto");
  assert.deepEqual(secondaryDefinition?.minimumSize, [0.40, 0.44, 0.20]);
  const resolvedSecondary = runtime.deviceById.get(secondary.id)!.size;
  resolvedSecondary.forEach((value, axis) => {
    assert.ok(value >= secondaryDefinition!.minimumSize[axis] - 1e-9, `secondary axis ${axis} respects its minimum`);
    assert.ok(Math.abs(value / 0.040 - Math.round(value / 0.040)) < 1e-9, `secondary axis ${axis} on the 40 mm shell quantum`);
  });
});

test("secondary services has exactly the three requested branch breakers and no incomer device", () => {
  const rail = runtime.devices
    .filter((device) => device.kind === "breaker"
      && device.placement.space === "junction"
      && device.placement.junctionId === "secondaryJunction"
      && device.placement.section === "din")
    .toSorted((a, b) => (a.placement.space === "junction" ? a.placement.order : 0) - (b.placement.space === "junction" ? b.placement.order : 0));
  assert.deepEqual(rail.map((device) => device.id), [
    "orionBreaker32", "chargeItBreaker32", "sharedServicesBreaker",
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

test("R32 records ownership, device power and circuit-level capacity separately from accepted protection and fault holds", async () => {
  const activeKinds = new Set(["panel", "battery", "controller", "monitor", "converter", "inverter", "generator", "outlet", "display", "router", "load"]);
  const activeDevices = dseTopology.devices.filter((device) => (
    activeKinds.has(device.kind) || device.power?.role === "source" || ["switchPanel", "roomSwitch"].includes(device.id)
  ));
  assert.equal(activeDevices.length, 27);
  assert.deepEqual(activeDevices.filter((device) => !device.power).map((device) => device.id), []);
  assert.equal(dseTopology.powerCircuits?.length, 12);

  const shared = (dseTopology.powerCircuits ?? []).find((circuit) => circuit.id === "shared-services");
  assert.ok(shared);
  assert.deepEqual({
    typicalWatts: shared.typicalWatts,
    maximumWatts: shared.maximumWatts,
    maximumCurrentA: shared.maximumCurrentA,
    conductorAmpacityA: shared.conductorAmpacityA,
    normalStatus: shared.normalStatus,
  }, {
    typicalWatts: 60,
    maximumWatts: 100,
    maximumCurrentA: 5,
    conductorAmpacityA: 10,
    normalStatus: "within-capacity",
  });
  const multiplus = (dseTopology.powerCircuits ?? []).find((circuit) => circuit.id === "multiplus-dc");
  assert.ok(multiplus);
  assert.equal(multiplus.normalStatus, "within-capacity");
  assert.equal(multiplus.faultStatus, "accepted");
  assert.deepEqual([multiplus.maximumWatts, multiplus.maximumCurrentA, multiplus.conductorAmpacityA], [1200, 67.2, 120]);
  assert.ok((multiplus.maximumCurrentA ?? Infinity) < (multiplus.conductorAmpacityA ?? 0));
  const disconnectIds = new Set(["batteryBreakerA", "batteryBreakerB", "mpptBreaker"]);
  const disconnectConnections = dseTopology.connections.filter((connection) => (
    disconnectIds.has(endpointDeviceId(connection.from)) || disconnectIds.has(endpointDeviceId(connection.to))
  ));
  assert.equal(disconnectConnections.length, 6);
  const cableById = new Map(dseTopology.cables.map((cable) => [cable.id, cable]));
  assert.ok(disconnectConnections.every((connection) => (
    cableById.get(connection.cableId)?.conductorSize === "2 AWG · 33.6 mm²"
  )));
  for (const breakerId of disconnectIds) {
    assert.ok(topologyDeviceById(breakerId).conductors.every((terminal) => terminal.terminalSize === "2 AWG / 33.6 mm² maximum"));
  }
  const secondaryFeeder = (dseTopology.powerCircuits ?? []).find((circuit) => circuit.id === "secondary-feeder");
  assert.ok(secondaryFeeder);
  assert.deepEqual({
    maximumWatts: secondaryFeeder.maximumWatts,
    maximumCurrentA: secondaryFeeder.maximumCurrentA,
    conductorAmpacityA: secondaryFeeder.conductorAmpacityA,
    normalStatus: secondaryFeeder.normalStatus,
    faultStatus: secondaryFeeder.faultStatus,
  }, {
    maximumWatts: 990,
    maximumCurrentA: 52.2,
    conductorAmpacityA: 80,
    normalStatus: "within-capacity",
    faultStatus: "incomplete",
  });
  for (const connectionId of ["multiplus-positive", "multiplus-negative"]) {
    const connection = dseTopology.connections.find((candidate) => candidate.id === connectionId)!;
    assert.notEqual(connection.status, "hold");
    assert.equal(connection.protectionApproval?.status, "accepted");
    assert.deepEqual(connection.protectionApproval?.protectionDeviceIds, ["batteryBreakerA", "batteryBreakerB", "mpptBreaker"]);
    assert.equal(runtime.diagnostics.currentSafety.connections.find((check) => check.connectionId === connectionId)?.status, "accepted");
    assert.equal(runtime.diagnostics.currentSafety.errors.some((issue) => issue.connectionId === connectionId), false);
  }
  const negativeTrunk = (dseTopology.powerCircuits ?? []).find((circuit) => circuit.id === "main-negative-trunk");
  assert.ok(negativeTrunk);
  assert.deepEqual({
    maximumCurrentA: negativeTrunk.maximumCurrentA,
    conductorAmpacityA: negativeTrunk.conductorAmpacityA,
    normalStatus: negativeTrunk.normalStatus,
    faultStatus: negativeTrunk.faultStatus,
  }, {
    maximumCurrentA: 72.9,
    conductorAmpacityA: 120,
    normalStatus: "conditional",
    faultStatus: "incomplete",
  });

  const tool = (dseTopology.powerCircuits ?? []).find((circuit) => circuit.id === "tool-ac");
  assert.ok(tool);
  assert.deepEqual({
    maximumWatts: tool.maximumWatts,
    maximumCurrentA: tool.maximumCurrentA,
    conductorAmpacityA: tool.conductorAmpacityA,
    normalStatus: tool.normalStatus,
  }, {
    maximumWatts: 1200,
    maximumCurrentA: 5.22,
    conductorAmpacityA: 10,
    normalStatus: "within-capacity",
  });

  assert.deepEqual(dseTopology.connections.filter((connection) => connection.cableId === "dc6")
    .map((connection) => connection.id).toSorted(), [
    "chargeit-breaker-feed",
    "join-usbMiniA-negative-device-link", "join-usbMiniA-positive-device-link",
    "join-usbMiniB-negative-device-link", "join-usbMiniB-positive-device-link",
    "join-usbMiniC-negative-device-link", "join-usbMiniC-positive-device-link",
    "join-usbOrion-ground-device-link",
    "mini-a-b-negative", "mini-a-b-positive", "mini-b-c-negative", "mini-b-c-positive",
    "mini-c-d-negative", "mini-c-d-positive", "mini-negative-feed", "mini-positive-feed",
    "orion-breaker-feed", "orion-common-ground", "orion-input-positive",
  ]);
  assert.equal(dseTopology.cables.find((cable) => cable.id === "dc6")?.ampacityA, 32);

  const starlink = topologyDeviceById("starlink");
  assert.deepEqual([starlink.status, starlink.procurementStatus, starlink.bomIds], ["purchased", "purchased", ["dse-ex-starlink"]]);
  const generator = topologyDeviceById("generator");
  assert.deepEqual([generator.status, generator.procurementStatus, generator.bomIds], ["purchased", "existing", ["dse-existing-generator"]]);
  const pvCutoff = topologyDeviceById("pvCutoff");
  assert.deepEqual([pvCutoff.status, pvCutoff.poles, pvCutoff.currentProtection?.ratedCurrentA], ["purchased", 2, 20]);
  assert.ok(["pvCombRails", "pvBreakerA", "pvBreakerB", "pvSpd", "pvDisconnect"]
    .every((id) => !dseTopology.devices.some((device) => device.id === id)));

  const system = JSON.parse(await readFile(new URL("../data/dse-system.json", import.meta.url), "utf8")) as {
    powerModel: Record<string, number | string>;
    operatingRules: string[];
  };
  assert.deepEqual({
    toolOperatingLimitWatts: system.powerModel.toolOperatingLimitWatts,
    toolDcCurrentAt19VAnd94PercentA: system.powerModel.toolDcCurrentAt19VAnd94PercentA,
    mainNegativeTrunkControlledDischargeA: system.powerModel.mainNegativeTrunkControlledDischargeA,
    mainNegativeTrunkChargeLimitA: system.powerModel.mainNegativeTrunkChargeLimitA,
    mainNegativeTrunkUnmanagedAllLoadsA: system.powerModel.mainNegativeTrunkUnmanagedAllLoadsA,
    mainNegativeTrunkModeledAmpacityA: system.powerModel.mainNegativeTrunkModeledAmpacityA,
  }, {
    toolOperatingLimitWatts: 1200,
    toolDcCurrentAt19VAnd94PercentA: 67.2,
    mainNegativeTrunkControlledDischargeA: 72.9,
    mainNegativeTrunkChargeLimitA: 88,
    mainNegativeTrunkUnmanagedAllLoadsA: 115,
    mainNegativeTrunkModeledAmpacityA: 120,
  });
  assert.ok(system.operatingRules.some((rule) => (
    /corded tool/i.test(rule) && /Orion off/.test(rule) && /ChargeIT branch breaker/.test(rule)
  )));
});

test("Orion and ChargeIT inputs use their dedicated 32 A breakers without output-side breaker devices", () => {
  const orion = runtime.deviceById.get("usbOrion")!;
  assert.deepEqual(orion.conductors.map((port) => port.id), ["remoteH", "positiveIn", "ground", "positiveOut"]);
  assert.deepEqual([
    attachmentRootDeviceId(runtime.routeById.get("orion-breaker-feed")!.from),
    runtime.routeById.get("orion-breaker-feed")?.to,
  ], ["secondaryPositiveBus", "orionBreaker32.line"]);
  assert.deepEqual([runtime.routeById.get("orion-input-positive")?.from, runtime.routeById.get("orion-input-positive")?.to],
    ["orionBreaker32.load", "usbOrion.positiveIn"]);
  assert.deepEqual([
    attachmentRootDeviceId(runtime.routeById.get("chargeit-breaker-feed")!.from),
    runtime.routeById.get("chargeit-breaker-feed")?.to,
  ], ["secondaryPositiveBus", "chargeItBreaker32.line"]);
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

test("wire joins use true Y fans or straight orthogonal T cylinders with route-exact widths", () => {
  const semantic = renderedSemanticCables(runtime.devices, runtime.conductors, runtime.routes);
  const routeRadiusByEndpoint = new Map(runtime.routes.flatMap((route) => [
    [route.from, Math.max(0.0012, route.diameterMm / 2000)] as const,
    [route.to, Math.max(0.0012, route.diameterMm / 2000)] as const,
  ]));
  for (const join of runtime.devices.filter((device) => device.presentation === "wire-join")) {
    const arms = semantic.filter((cable) => cable.deviceId === join.id);
    assert.equal(arms.length, 3, join.id);
    assert.equal(new Set(arms.map((arm) => arm.joinGeometry)).size, 1, `${join.id} geometry`);
    if (arms[0].joinGeometry === "orthogonal-t") {
      assert.ok(arms.every((arm) => (
        arm.branchAngleDegrees === undefined
        && arm.pieces.length === 1
        && arm.pieces[0].kind === "line"
        && arm.pieces[0].bend === false
      )), `${join.id} T arms remain straight`);
      const directions = arms.map((arm) => {
        const offset = subtract(arm.pieces[0].points[0], arm.splitPoint);
        return offset.map((value) => value / magnitude(offset)) as unknown as Vec3;
      });
      const dots = [
        dot(directions[0], directions[1]),
        dot(directions[0], directions[2]),
        dot(directions[1], directions[2]),
      ].toSorted((first, second) => first - second);
      assert.ok(Math.abs(dots[0] + 1) < 1e-9, `${join.id} has one continuous cylinder axis`);
      assert.ok(Math.abs(dots[1]) < 1e-9 && Math.abs(dots[2]) < 1e-9,
        `${join.id} tap cylinder is orthogonal`);
    } else {
      assert.equal(arms[0].joinGeometry, "y", join.id);
      assert.deepEqual(arms.filter((arm) => arm.branchAngleDegrees !== undefined)
        .map((arm) => arm.branchAngleDegrees).toSorted(), [-45, 45], join.id);
    }
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

test("AC PE daisy taps render as curve-free orthogonal cylinders", () => {
  const semantic = renderedSemanticCables(runtime.devices, runtime.conductors, runtime.routes);
  const peJoinIds = runtime.devices.filter((device) => (
    device.presentation === "wire-join"
    && /^(?:join-generatorAcBreakout-earth|join-acOutputCableBreakout-earth)/.test(device.id)
  )).map((device) => device.id);
  assert.deepEqual(peJoinIds.toSorted(), [
    "join-acOutputCableBreakout-earth",
    "join-generatorAcBreakout-earth",
  ]);
  for (const deviceId of peJoinIds) {
    const arms = semantic.filter((cable) => cable.deviceId === deviceId);
    assert.equal(arms.length, 3, deviceId);
    assert.ok(arms.every((arm) => arm.joinGeometry === "orthogonal-t"), deviceId);
    assert.ok(arms.flatMap((arm) => arm.pieces).every((piece) => piece.kind === "line" && !piece.bend),
      `${deviceId} has no curved semantic pieces`);
  }
});

test("AC output protective earth reaches the main PE bus through explicit and MultiPlus continuity", () => {
  const multiPlus = topologyDeviceById("multiPlus");
  const mates = (id: string) => [...(multiPlus.conductors.find((port) => port.id === id)?.internalMates ?? [])].toSorted();
  assert.deepEqual(mates("acInEarth"), ["acOutEarth", "chassisEarth"]);
  assert.deepEqual(mates("acOutEarth"), ["acInEarth", "chassisEarth"]);
  assert.deepEqual(mates("chassisEarth"), ["acInEarth", "acOutEarth"]);

  assert.ok(!dseTopology.connections.some(connection => connection.id === "ac-earth-continuity"));
  assert.ok(!runtime.deviceById.has("earthBar"));
  const cableById = new Map(dseTopology.cables.map((cable) => [cable.id, cable]));
  const devices = new Map(dseTopology.devices.map((device) => [device.id, device]));
  const adjacency = new Map<string, Set<string>>();
  const connect = (first: string, second: string) => {
    adjacency.set(first, new Set([...(adjacency.get(first) ?? []), second]));
    adjacency.set(second, new Set([...(adjacency.get(second) ?? []), first]));
  };
  dseTopology.connections.forEach((connection) => {
    if (connection.kind === "earth"
      || connection.kind === "multicore" && cableById.get(connection.cableId)?.carriedChannels?.includes("earth")) {
      connect(connection.from, connection.to);
    }
  });
  dseTopology.devices.forEach((device) => device.conductors.forEach((port) => {
    if (port.kind !== "earth" && port.kind !== "multicore") return;
    (port.internalMates ?? []).forEach((mateId) => {
      const mate = devices.get(device.id)?.conductors.find((candidate) => candidate.id === mateId);
      if (mate && (mate.kind === "earth" || mate.kind === "multicore")) {
        connect(`${device.id}.${port.id}`, `${device.id}.${mate.id}`);
      }
    });
  }));
  const queue = ["toolOutlet.earth"];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const endpoint = queue.shift()!;
    if (visited.has(endpoint)) continue;
    visited.add(endpoint);
    (adjacency.get(endpoint) ?? []).forEach((peer) => queue.push(peer));
  }
  assert.ok([...visited].some((endpoint) => endpoint === "earthElectrode.clamp"),
    "Provisional PE continuity reaches the rod through MultiPlus chassis");
  for (const endpoint of ["multiPlus.acInEarth", "multiPlus.acOutEarth", "multiPlus.chassisEarth"] as const) {
    assert.ok(visited.has(endpoint), `${endpoint} must share the outlet/main-PE component`);
  }
});

test("USB branch joins retain all three physical arms after corner routing", () => {
  const semantic = renderedSemanticCables(runtime.devices, runtime.conductors, runtime.routes);
  for (const join of runtime.devices.filter(device => device.presentation === "wire-join" && /join-usb/.test(device.id))) {
    const arms = semantic.filter(cable => cable.deviceId === join.id);
    assert.equal(arms.length, 3, join.id);
    assert.ok(arms.every(arm => arm.pieces.length > 0));
  }
});

test("three-core AC breakouts use a 45-degree outer fan with one straight centre core", () => {
  const semantic = renderedSemanticCables(runtime.devices, runtime.conductors, runtime.routes);
  const usbReferenceArm = semantic.find((candidate) => (
    candidate.deviceId === "join-usbMiniB-positive" && candidate.branchAngleDegrees === 45
  ))!;
  const usbOuterLengthM = usbReferenceArm.pieces[0].lengthM;
  const breakoutIds = [
    "multiAcInBreakout", "multiAcOutBreakout",
    "generatorLeadBreakout", "generatorAcBreakout",
    "acInputCableBreakout", "acOutputCableBreakout",
    "toolAcBreakout", "toolOutletLeadBreakout",
  ];
  for (const deviceId of breakoutIds) {
    const device = runtime.deviceById.get(deviceId)!;
    assert.equal(device.presentation, "cable-breakout");
    assert.deepEqual(device.size.slice(0, 2), [0.08, 0.04], `${deviceId} retained routing envelope`);
    const cable = runtime.conductorByKey.get(`${deviceId}.cable`)!;
    const cableLength = magnitude(cable.direction);
    const forward = cable.direction.map((value) => -value / cableLength) as unknown as Vec3;
    const arms = semantic.filter((candidate) => (
      candidate.deviceId === deviceId && candidate.branchAngleDegrees !== undefined
    ));
    assert.deepEqual(arms.map((arm) => arm.branchAngleDegrees).toSorted(), [-45, 0, 45], deviceId);
    const splitOffset = subtract(arms[0].splitPoint, cable.position);
    assert.ok(Math.abs(magnitude(splitOffset) - 0.020) < 1e-9, `${deviceId} sheath stem matches the USB Y stem`);
    arms.forEach((arm) => {
      const port = runtime.conductorByKey.get(arm.conductorKey)!;
      const offset = subtract(port.position, arm.splitPoint);
      const axial = dot(offset, forward);
      const transverse = subtract(offset, forward.map((value) => value * axial) as unknown as Vec3);
      const transverseLength = magnitude(transverse);
      assert.ok(Math.abs(axial - 0.020) < 1e-9, `${arm.id} matches the USB Y arm depth`);
      if (arm.branchAngleDegrees === 0) {
        assert.ok(transverseLength < 1e-9, `${arm.id} is the straight centre core`);
        assert.ok(dot(port.direction, forward) > 0.999999, `${arm.id} launches forward`);
      } else {
        assert.ok(Math.abs(transverseLength - 0.020) < 1e-9, `${arm.id} matches the USB Y arm width`);
      }
      assert.equal(arm.pieces.length, 1, `${arm.id} uses one uninterrupted fan arm`);
      assert.equal(arm.pieces[0].kind, arm.branchAngleDegrees === 0 ? "line" : "cubic",
        `${arm.id} uses the matching centre/outer Y geometry`);
      if (arm.pieces[0].kind === "cubic") {
        assert.ok(Math.abs(arm.pieces[0].lengthM - usbOuterLengthM) < 1e-12,
          `${arm.id} matches the USB Y curve length`);
        const points = arm.pieces[0].points;
        const arrival = subtract(points.at(-1)!, points.at(-2)!);
        assert.ok(dot(arrival, port.direction) / magnitude(arrival) > 0.999999,
          `${arm.id} meets its routed wire with the centre-core tangent`);
      }
    });
  }
});

test("every exterior circuit uses a declared service or electrode penetration", () => {
  const outsideIds = new Set([
    "panel1", "panel2", "panel3",
    "earthElectrode", "starlink",
  ]);
  for (const id of outsideIds) {
    const device = runtime.deviceById.get(id)!;
    assert.equal(device.placement.space, "world");
    if (device.placement.space === "world") assert.ok(
      device.placement.surface === "outside" || device.placement.surface === "outside-wall" || device.placement.surface === "roof",
      id,
    );
  }
  const visibleRegion = (endpoint: string) => {
    const [deviceId, conductorId] = endpoint.split(".");
    const device = runtime.deviceById.get(deviceId)!;
    const conductor = runtime.conductorByKey.get(`${deviceId}.${conductorId}`)!;
    if (device.presentation === "wall-passthrough") return conductor.face === "back" ? "outside" : "inside";
    return device.placement.space === "world"
      && (device.placement.surface === "outside" || device.placement.surface === "outside-wall" || device.placement.surface === "roof")
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
    "pvCable", "frame", "starlinkPower", "starlinkData",
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

  assert.ok(shunt.position[1] < negative.position[1]);
  assert.ok(Math.abs(shunt.position[2] - negative.position[2]) < 0.02);
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

test("west-wall equipment follows the installed vertical order", () => {
  const y = (id: string) => runtime.deviceById.get(id)!.position[1];
  assert.ok(y("balancerA") < y("batteryCutoffJunction"));
  assert.ok(y("batteryCutoffJunction") < y("mainPositiveBus"));
  assert.ok(y("mainPositiveBus") < y("smartSolar"));
  assert.ok(y("smartSolar") < y("pvJunction"));
  assert.ok(y("ekrano") < y("multiPlus"));
});

test("one held 8 AWG M10-to-#10 feeder pair directly connects main and secondary distribution", () => {
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
  assert.match(positiveIngress[0].holdReason ?? "", /120 A battery-string breaker curves.*100 A Blue Sea bus/i);

  const negativeIngress = dseTopology.connections.filter((connection) => connection.kind === "negative"
    && attachmentRootDeviceId(connection.from) === "mainNegativeBus"
    && attachmentRootDeviceId(connection.to) === "secondaryNegativeBus");
  assert.equal(negativeIngress.length, 1);
  assert.equal(negativeIngress[0].id, "secondary-feeder-negative");
  assert.equal(negativeIngress[0].status, "hold");
  assert.match(negativeIngress[0].holdReason ?? "", /matching black 8 AWG M10-to-#10 return.*100 A Blue Sea bus/i);
  assert.deepEqual([...positiveIngress, ...negativeIngress].map((connection) => connection.cableId), ["dc8Feeder", "dc8Feeder"]);
  assert.deepEqual([...positiveIngress, ...negativeIngress].map((connection) => (
    dseTopology.cables.find((cable) => cable.id === connection.cableId)?.conductorSize
  )), ["8 AWG · 8.37 mm²", "8 AWG · 8.37 mm²"]);
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
    "internet-starlink-negative",
    "internet-unifi-negative",
    "ekrano-negative",
    "orion-common-ground",
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
  assert.ok(totalLengthM < 6.58,
    `battery source leads total ${totalLengthM.toFixed(2)} m; installed-corner geometry remains below the retired 6.58 m route`);
});

test("historical cable lengths remain unchanged and are explicitly not field measurements", async () => {
  const read = async (file: string) => JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
  const current = (await read("../data/dse-system.json")).batteryCablePlan;
  const previous = (await read("../archive/pre-installation-2026-08-31.json")).batteryCablePlan;
  assert.deepEqual(current.assemblies, previous.assemblies);
  assert.match(current.note, /not measurements/);
});

test("repeated equipment families declare canonical layout grouping", () => {
  const expected = new Map([
    ["pv-panels", { columns: 3, count: 3 }],
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

test("battery series jumpers retain A1–A2 and B1–B2 connectivity", () => {
  for (const [id, from, to] of [["battery-a-series", "battery1.positive", "battery2.negative"], ["battery-b-series", "battery3.positive", "battery4.negative"]]) {
    const route = runtime.routeById.get(id)!;
    assert.equal(attachmentRootEndpoint(route.from), from);
    assert.equal(attachmentRootEndpoint(route.to), to);
    assert.equal(route.routed, true);
  }
});

test("PV is one three-module series string through one two-pole cutoff", () => {
  assert.deepEqual(runtime.devices.filter((device) => device.kind === "panel").map((device) => device.id), [
    "panel1", "panel2", "panel3",
  ]);
  const cutoff = runtime.deviceById.get("pvCutoff")!;
  assert.equal(cutoff.poles, 2);
  assert.deepEqual(cutoff.conductors.map((conductor) => conductor.id), [
    "positiveIn", "negativeIn", "positiveOut", "negativeOut",
  ]);
  assert.equal(runtime.devices.filter((device) => device.presentation === "rigid-rail").length, 0);
  assert.ok(["pvCombRails", "pvBreakerA", "pvBreakerB", "pvSpd", "pvDisconnect"]
    .every((id) => !runtime.deviceById.has(id)));
  assert.deepEqual([
    runtime.routeById.get("pv-series-1-2")?.cableId,
    runtime.routeById.get("pv-series-2-3")?.cableId,
    runtime.routeById.get("pv-output-positive")?.cableId,
    runtime.routeById.get("pv-output-negative")?.cableId,
  ], ["pvWhite4", "pvWhite4", "pv4", "pv4"]);
});

test("AC protection has terminals on top and bottom only", () => {
  for (const id of ["acInputProtection", "acOutputProtection"]) {
    const device = runtime.deviceById.get(id)!;
    assert.equal(device.conductors.length, 5);
    assert.ok(device.conductors.every((port) => port.face === "top" || port.face === "bottom"), id);
  }
});

test("AC enclosure retains the compact low-profile backplate order and bodyless PE daisy chain", () => {
  const junctionId = "acJunction";
  const memberIds = new Set(dseTopology.devices.filter((device) => (
    device.placement.space === "junction" && device.placement.junctionId === junctionId
  )).map((device) => device.id));
  const orderedBackplateIds = dseTopology.devices.filter((device) => (
    !device.attachment && device.placement.space === "junction"
    && device.placement.junctionId === junctionId
    && device.placement.section === "backplate"
  )).toSorted((first, second) => (
    (first.placement.space === "junction" ? first.placement.order : 0)
    - (second.placement.space === "junction" ? second.placement.order : 0)
  )).map((device) => device.id);
  assert.deepEqual(orderedBackplateIds, [
    "generatorAcBreakout", "acInputCableBreakout", "acOutputCableBreakout", "toolAcBreakout",
  ]);
  const peJoins = dseTopology.devices.filter((device) => [
    "join-generatorAcBreakout-earth",
    "join-acOutputCableBreakout-earth",
  ].includes(device.id));
  assert.deepEqual(peJoins.map((device) => device.id).toSorted(), [
    "join-acOutputCableBreakout-earth",
    "join-generatorAcBreakout-earth",
  ]);
  assert.ok(peJoins.every((device) => device.presentation === "wire-join" && device.attachment));
  assert.equal(dseTopology.devices.some((device) => /ac(?:Input|Output)PeSplice/.test(device.id)), false);

  const enclosure = runtime.deviceById.get(junctionId)!;
  assert.ok(enclosure.size[0] <= 0.36 * 1.5 + 1e-9, `AC enclosure width ${enclosure.size[0]}`);
  assert.ok(enclosure.size[1] <= 0.64 + 1e-9, `AC enclosure height ${enclosure.size[1]}`);
  const bounds = {
    left: enclosure.position[0] - enclosure.size[0] / 2,
    right: enclosure.position[0] + enclosure.size[0] / 2,
    bottom: enclosure.position[1] - enclosure.size[1] / 2,
    top: enclosure.position[1] + enclosure.size[1] / 2,
  };
  const routes = runtime.routes.filter((route) => (
    memberIds.has(endpointDeviceId(route.from)) || memberIds.has(endpointDeviceId(route.to))
  ));
  let inBoxLengthM = 0;
  let inBoxTurns = 0;
  const horizontal: Array<{ routeId: string; fixed: number; low: number; high: number }> = [];
  const vertical: Array<{ routeId: string; fixed: number; low: number; high: number }> = [];
  routes.forEach((route) => {
    route.points.slice(1, -1).forEach((point, index) => {
      if (point[0] < bounds.left - 1e-9 || point[0] > bounds.right + 1e-9
        || point[1] < bounds.bottom - 1e-9 || point[1] > bounds.top + 1e-9) return;
      const previous = route.points[index];
      const next = route.points[index + 2];
      const before = point.map((value, axis) => Math.sign(value - previous[axis]));
      const after = next.map((value, axis) => Math.sign(value - point[axis]));
      if (before.some((value, axis) => value !== after[axis])) inBoxTurns += 1;
    });
    route.points.slice(1).forEach((point, index) => {
      const previous = route.points[index];
      const delta = point.map((value, axis) => value - previous[axis]);
      const axis = delta.findIndex((value) => Math.abs(value) > 1e-9);
      if (axis === 0 && previous[1] >= bounds.bottom - 1e-9 && previous[1] <= bounds.top + 1e-9) {
        const low = Math.max(bounds.left, Math.min(previous[0], point[0]));
        const high = Math.min(bounds.right, Math.max(previous[0], point[0]));
        if (high > low + 1e-9) {
          inBoxLengthM += high - low;
          horizontal.push({ routeId: route.id, fixed: previous[1], low, high });
        }
      } else if (axis === 1 && previous[0] >= bounds.left - 1e-9 && previous[0] <= bounds.right + 1e-9) {
        const low = Math.max(bounds.bottom, Math.min(previous[1], point[1]));
        const high = Math.min(bounds.top, Math.max(previous[1], point[1]));
        if (high > low + 1e-9) {
          inBoxLengthM += high - low;
          vertical.push({ routeId: route.id, fixed: previous[0], low, high });
        }
      } else if (axis === 2 && previous[0] >= bounds.left - 1e-9 && previous[0] <= bounds.right + 1e-9
        && previous[1] >= bounds.bottom - 1e-9 && previous[1] <= bounds.top + 1e-9) {
        inBoxLengthM += Math.abs(delta[2]);
      }
    });
  });
  const crossings = new Set<string>();
  horizontal.forEach((first) => vertical.forEach((second) => {
    if (first.routeId === second.routeId) return;
    if (second.fixed > first.low + 1e-9 && second.fixed < first.high - 1e-9
      && first.fixed > second.low + 1e-9 && first.fixed < second.high - 1e-9) {
      crossings.add(`${[first.routeId, second.routeId].toSorted().join("|")}@${second.fixed},${first.fixed}`);
    }
  }));
  assert.ok(crossings.size <= 24, `AC enclosure projected crossings: ${crossings.size}`);
  assert.ok(inBoxTurns <= 80, `AC enclosure turns: ${inBoxTurns}`);
  assert.ok(inBoxLengthM <= 6.5 + 1e-9, `AC enclosure routed length: ${inBoxLengthM.toFixed(3)} m`);
});

test("generator and Type I outlet expose only three posts behind explicit cable breakouts", () => {
  const cases = [
    {
      deviceId: "generator", breakoutId: "generatorLeadBreakout", whiteRouteId: "generator-white-cable",
      coreRouteIds: ["generator-lead-line", "generator-lead-neutral", "generator-lead-earth"],
    },
    {
      deviceId: "toolOutlet", breakoutId: "toolOutletLeadBreakout", whiteRouteId: "tool-white-cable",
      coreRouteIds: ["tool-outlet-line", "tool-outlet-neutral", "tool-outlet-earth"],
    },
  ] as const;
  for (const { deviceId, breakoutId, whiteRouteId, coreRouteIds } of cases) {
    const device = runtime.deviceById.get(deviceId)!;
    const breakout = runtime.deviceById.get(breakoutId)!;
    assert.notEqual(device.presentation, "integrated-cable-breakout");
    assert.equal(breakout.presentation, "cable-breakout");
    assert.deepEqual(device.conductors.map((port) => port.id), ["line", "neutral", "earth"]);
    assert.equal(device.conductors.some((port) => port.kind === "multicore"), false,
      `${deviceId} has no hidden sheath anchor`);
    const posts = device.conductors.map((port) => runtime.conductorByKey.get(`${deviceId}.${port.id}`)!);
    assert.ok(Math.abs(magnitude(subtract(posts[0].position, posts[1].position)) - 0.020) < 1e-9,
      `${deviceId} L/N pitch`);
    assert.ok(Math.abs(magnitude(subtract(posts[1].position, posts[2].position)) - 0.020) < 1e-9,
      `${deviceId} N/PE pitch`);
    assert.equal(device.terminalPitchByFaceM?.[posts[0].face], 0.020,
      `${deviceId} declares the shared three-core pitch`);
    coreRouteIds.forEach((routeId, index) => {
      const route = runtime.routeById.get(routeId)!;
      assert.deepEqual(new Set([route.from, route.to]), new Set([
        `${deviceId}.${posts[index].id}`,
        `${breakoutId}.${posts[index].id}`,
      ]), `${routeId} joins one breakout core directly to its device post`);
    });
    const whiteRoute = runtime.routeById.get(whiteRouteId)!;
    assert.ok([whiteRoute.from, whiteRoute.to].includes(`${breakoutId}.cable`));
    assert.ok(![whiteRoute.from, whiteRoute.to].some((endpoint) => endpoint.startsWith(`${deviceId}.`)),
      `${whiteRouteId} terminates at the explicit breakout, not the device`);
  }
  assert.equal(runtime.devices.some((device) => device.presentation === "integrated-cable-breakout"), false);

  const toolOutlet = topologyDeviceById("toolOutlet");
  assert.deepEqual(toolOutlet.conductors.map((port) => [port.id, port.face, port.order]), [
    ["line", "bottom", 0],
    ["neutral", "bottom", 1],
    ["earth", "bottom", 2],
  ]);
  const resolvedToolOutlet = runtime.deviceById.get("toolOutlet")!;
  const resolvedToolBreakout = runtime.deviceById.get("toolOutletLeadBreakout")!;
  assert.equal(resolvedToolOutlet.position[0], resolvedToolBreakout.position[0],
    "tool-outlet breakout is centered directly beneath the outlet");
  assert.ok(resolvedToolOutlet.position[1] > resolvedToolBreakout.position[1]);
  for (const routeId of ["tool-outlet-line", "tool-outlet-neutral", "tool-outlet-earth"]) {
    const route = runtime.routeById.get(routeId)!;
    assert.ok(route.lengthM <= 0.35 + 1e-9, `${routeId} remains a short breakout core`);
    assert.ok(route.points.every((point) => Math.abs(point[0] - route.points[0][0]) < 1e-9),
      `${routeId} does not loop sideways`);
    assert.ok(route.points.every((point, index) => index === 0 || point[1] >= route.points[index - 1][1] - 1e-9),
      `${routeId} rises monotonically into the outlet`);
  }
  assert.equal(toolOutlet.placement.space, "world");
  const acJunction = topologyDeviceById("acJunction");
  if (toolOutlet.placement.space === "world" && acJunction.placement.space === "world") {
    const toolRight = toolOutlet.placement.position[0] + toolOutlet.size[0] / 2;
    const enclosureLeft = acJunction.placement.position[0] - acJunction.size[0] / 2;
    assert.ok(toolRight > enclosureLeft + acJunction.size[0], "tool outlet is mounted to the right of the AC enclosure");
  }
});

test("source topology references only the purchased MPPT wirebox and AC protection BOM rows", () => {
  assert.deepEqual(topologyDeviceById("smartSolar").bomIds, ["dse-smartsolar", "dse-mppt-wirebox-tr"]);
  assert.deepEqual(topologyDeviceById("acJunction").bomIds, ["dse-ac-rcbo"]);
});

test("SmartShunt bolts leave left and right while its sense and VE.Direct leads leave the bottom", () => {
  const shunt = topologyDeviceById("smartShunt");
  const ordered = ["vBattPlus", "veDirect"].map((id) => {
    const terminal = shunt.conductors.find((port) => port.id === id)!;
    return [terminal.id, terminal.face, terminal.order];
  });
  assert.deepEqual(ordered, [
    ["vBattPlus", "bottom", 0],
    ["veDirect", "bottom", 1],
  ]);
  assert.equal(shunt.conductors.find((port) => port.id === "batteryMinus")?.face, "left");
  assert.equal(shunt.conductors.find((port) => port.id === "systemMinus")?.face, "right");
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

test("three-gang plate has separate rockers with unused loop terminals", () => {
  const switches = ["switchInternet", "switchOrion", "switchLights"].map(id => topologyDeviceById(id));
  assert.ok(!runtime.deviceById.has("switchPanel"));
  switches.forEach(device => {
    assert.deepEqual(device.conductors.map(port => port.id), ["common", "on", "loop"]);
    assert.ok(device.conductors.find(port => port.id === "loop")!.optional);
    assert.deepEqual(device.placement.space === "junction" && device.placement.junctionId, "wallSwitchJunction");
  });
  const ys = switches.map(device => runtime.deviceById.get(device.id)!.position[1]);
  assert.ok(ys[0] > ys[1] && ys[1] > ys[2]);
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
  // In-plane terminal coordinates sit on the 20 mm route lattice; the face
  // coordinate itself may sit on the 10 mm half-lattice.
  const onHalfGrid = (value: number) => Math.abs(value / GEOMETRY_UNIT_M - Math.round(value / GEOMETRY_UNIT_M)) < 1e-8;
  for (const port of runtime.conductors) {
    if (port.direction.filter((value) => Math.abs(value) > 1e-8).length !== 1) continue;
    port.position.forEach((value, axis) => {
      assert.ok(Math.abs(port.direction[axis]) > 1e-8 ? onHalfGrid(value) : onRouteGrid(value), `${port.key} axis ${axis}`);
    });
  }
});

test("visible routes never intersect the finite wall outside the one passthrough aperture", () => {
  assert.deepEqual(sampledRouteWallPlaneCrossings(runtime.routes, runtime.devices, graphWalls(runtime.graph)), []);
});

test("roof-panel terminals use the same XYZ rotation as the 3D renderer", () => {
  const panels = ["panel1", "panel2", "panel3"].map(id => runtime.deviceById.get(id)!);
  assert.ok(panels.every(panel => panel.placement.space === "world" && panel.placement.surface === "roof" && panel.position[1] > 3));
  assert.ok(panels[0].position[0] < panels[1].position[0] && panels[1].position[0] < panels[2].position[0]);
  for (const panel of panels) {
    const lead = runtime.conductorByKey.get(`${panel.id}.positive`)!;
    assert.ok(magnitude(subtract(lead.direction, rotateVector([0, 0, -1], panel.rotation))) < 1e-8);
  }
});

test("every routed wire meets both terminals on their declared axes", () => {
  // A distribution-bar stud is met by a short ring-lug lead from the routing
  // plane just beyond the bar edge: never head-on from the front. Every other
  // terminal is met exactly along its own axis.
  const isBarPost = (key: string) => {
    const port = runtime.conductorByKey.get(key)!;
    const owner = runtime.deviceById.get(port.deviceId)!;
    return (owner.kind === "busbar" || owner.kind === "earth") && port.face === "front";
  };
  const checkLead = (key: string, lead: Vec3, label: string) => {
    const port = runtime.conductorByKey.get(key)!;
    const cosine = dot(lead, port.direction) / magnitude(lead);
    if (isBarPost(key)) {
      // `lead` points away from the stud; the cable must come from beside or
      // behind the stud plane (never head-on from the front) within one cell.
      const inPlane = Math.hypot(...subtract(lead, port.direction.map((value) => value * dot(lead, port.direction)) as unknown as Vec3));
      assert.ok(cosine <= 0 && inPlane > GEOMETRY_UNIT_M, `${label} meets the stud laterally`);
      assert.ok(Math.abs(dot(lead, port.direction)) <= GEOMETRY_UNIT_M * WORLD_ROUTING_STEP_UNITS + 1e-8, `${label} lead stays within one cell of the stud plane`);
    } else {
      assert.ok(cosine > 0.999999999, label);
    }
  };
  for (const route of runtime.routes) {
    checkLead(route.from, subtract(route.points[1], route.points[0]), `${route.id} source`);
    checkLead(route.to, subtract(route.points.at(-2)!, route.points.at(-1)!), `${route.id} target`);
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

test("glands and members fit each enclosure in its own wall coordinate frame", () => {
  for (const definition of dseTopology.junctions) {
    const enclosure = runtime.deviceById.get(definition.deviceId)!;
    for (const face of ['bottom', 'top']) {
      const glands = runtime.glands.filter(gland => gland.junctionId === enclosure.id && (gland.face ?? 'bottom') === face)
        .map(gland => deviceLocalPoint(enclosure, gland.position)).sort((a, b) => a[0] - b[0]);
      if (face === 'bottom' || definition.glandFaces === 'top-and-bottom') assert.ok(glands.length > 0);
      else assert.equal(glands.length, 0);
      glands.forEach((point, index) => {
        assert.ok(Math.abs(point[1] - (face === 'top' ? 1 : -1) * enclosure.size[1] / 2) <= GEOMETRY_UNIT_M + 1e-8);
        if (index) assert.ok(Math.abs(point[0] - glands[index - 1][0] - definition.glandSpacing) < 1e-8);
      });
    }
    for (const member of runtime.devices.filter(device => device.placement.space === "junction" && device.placement.junctionId === enclosure.id && !device.attachment)) {
      const local = deviceLocalPoint(enclosure, member.position);
      const angle = member.placement.space === "junction" ? member.placement.rotationZ ?? 0 : 0;
      assert.deepEqual(member.rotation, [enclosure.rotation[0], enclosure.rotation[1], enclosure.rotation[2] + angle]);
      local.forEach((value, axis) => assert.ok(Math.abs(value) + worldHalfExtents({ ...member, rotation: [0, 0, member.rotation[2] - enclosure.rotation[2]] })[axis] <= enclosure.size[axis] / 2 + 1e-8, `${member.id} axis ${axis}`));
    }
  }
});
