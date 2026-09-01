import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

type GeneratedArtifact = {
  schemaVersion: number;
  generatorVersion: string;
  sourceHash: string;
  graphId: string;
  graphRevision: string;
};

const root = path.resolve(import.meta.dirname, "..");

async function readJson<T>(relativePath: string) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as T;
}

async function sourceHash(artifact: GeneratedArtifact, relativePaths: readonly string[]) {
  const hash = createHash("sha256");
  hash.update(`${artifact.schemaVersion}:${artifact.generatorVersion}\n`);
  for (const relativePath of relativePaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function orthogonalCrossingCount(first: readonly { x: number; y: number }[],
  second: readonly { x: number; y: number }[]) {
  let crossings = 0;
  first.slice(1).forEach((firstEnd, firstIndex) => {
    const firstStart = first[firstIndex]; const firstHorizontal = firstStart.y === firstEnd.y;
    second.slice(1).forEach((secondEnd, secondIndex) => {
      const secondStart = second[secondIndex]; const secondHorizontal = secondStart.y === secondEnd.y;
      if (firstHorizontal === secondHorizontal) return;
      const [horizontalStart, horizontalEnd, verticalStart, verticalEnd] = firstHorizontal
        ? [firstStart, firstEnd, secondStart, secondEnd]
        : [secondStart, secondEnd, firstStart, firstEnd];
      if (verticalStart.x >= Math.min(horizontalStart.x, horizontalEnd.x)
        && verticalStart.x <= Math.max(horizontalStart.x, horizontalEnd.x)
        && horizontalStart.y >= Math.min(verticalStart.y, verticalEnd.y)
        && horizontalStart.y <= Math.max(verticalStart.y, verticalEnd.y)) crossings += 1;
    });
  });
  return crossings;
}

function dominantVerticalTrunkX(points: readonly { x: number; y: number }[]) {
  const trunks = points.slice(1).flatMap((end, index) => {
    const start = points[index];
    return start.x === end.x ? [{ x: start.x, length: Math.abs(end.y - start.y) }] : [];
  }).toSorted((first, second) => second.length - first.length || first.x - second.x);
  assert.ok(trunks.length > 0, "route has a vertical trunk");
  return trunks[0].x;
}

test("precomputed 3D runtime artifact is current and conflict-free", async () => {
  const artifact = await readJson<GeneratedArtifact & {
    devices: Array<{ id: string; size: [number, number, number]; physicalSize?: [number, number, number] }>;
    conductors: unknown[];
    glands: Array<{ id: string; junctionId: string; label: string; connectionIds: string[] }>;
    routes: unknown[];
    diagnostics: {
      fallbacks: number;
      centerlineConflicts: number;
      sweptCableConflicts: number;
      selfIntersections: number;
      deviceConflicts: number;
      renderedGeometryConflicts: number;
      totalLengthM: number;
      totalTurns: number;
      routingTargetAssignments: Array<{
        connectionId: string;
        side: "from" | "to";
        authoredEndpoint: string;
        resolvedEndpoint: string;
      }>;
      currentSafety: {
        scope: string;
        status: "verified" | "provisional" | "incomplete";
        sources: Array<{ id: string }>;
        connections: Array<{
          connectionId: string;
          prospectiveFaultCurrentA: number | "unbounded";
          verifiedProtectionEnvelopeA: number | "unbounded";
          ampacityA?: number;
          status: "verified" | "provisional" | "incomplete";
        }>;
        errors: Array<{ code: string; connectionId?: string; deviceId?: string }>;
        warnings: Array<{ code: string; connectionId?: string; deviceId?: string }>;
      };
    };
  }>("data/generated/dse-runtime.json");
  assert.equal(artifact.sourceHash, await sourceHash(artifact, [
    "app/dseTopology.ts",
    "app/systemGraph.ts",
    "app/systemGraphRuntime.ts",
    "app/renderedCableGeometry.ts",
    "scripts/generate-runtime.ts",
  ]));
  assert.deepEqual({
    fallbacks: artifact.diagnostics.fallbacks,
    centerline: artifact.diagnostics.centerlineConflicts,
    swept: artifact.diagnostics.sweptCableConflicts,
    self: artifact.diagnostics.selfIntersections,
    devices: artifact.diagnostics.deviceConflicts,
    rendered: artifact.diagnostics.renderedGeometryConflicts,
  }, { fallbacks: 0, centerline: 0, swept: 0, self: 0, devices: 0, rendered: 0 });
  assert.equal(artifact.devices.length, 86);
  assert.equal(artifact.conductors.length, 291);
  assert.equal(artifact.routes.length, 137);
  assert.ok(artifact.diagnostics.routingTargetAssignments.length > 0);
  assert.ok(artifact.diagnostics.routingTargetAssignments.some((assignment) => (
    assignment.authoredEndpoint !== assignment.resolvedEndpoint
  )));
  assert.ok(artifact.diagnostics.totalLengthM < 149);
  assert.ok(artifact.diagnostics.totalTurns < 860);
  const expectedEnclosures = new Map([
    ["batteryCutoffJunction", { size: [0.20, 0.16, 0.10], physicalSize: [0.200, 0.155, 0.092], glands: 6 }],
    ["secondaryJunction", { size: [0.60, 0.64, 0.24], glands: 15 }],
    ["pvJunction", { size: [0.32, 0.28, 0.15], glands: 4 }],
    ["acJunction", { size: [0.36, 0.48, 0.12], glands: 5 }],
  ] as const);
  for (const [id, expected] of expectedEnclosures) {
    assert.deepEqual(artifact.devices.find((device) => device.id === id)?.size, expected.size, `${id} size`);
    if ("physicalSize" in expected) assert.deepEqual(
      artifact.devices.find((device) => device.id === id)?.physicalSize,
      expected.physicalSize,
      `${id} physical size`,
    );
    assert.equal(artifact.glands.filter((gland) => gland.junctionId === id).length, expected.glands, `${id} glands`);
  }
  const safety = artifact.diagnostics.currentSafety;
  assert.equal(safety.scope, "supply-active-and-explicitly-paired-returns");
  assert.equal(safety.status, "incomplete", "unresolved design evidence must remain fail-closed");
  assert.equal(safety.sources.length, 9);
  assert.ok(safety.errors.length > 0);
  assert.ok(safety.warnings.length > 0);
  const orionOutput = safety.connections.find((check) => check.connectionId === "orion-output-socket-a")!;
  assert.deepEqual({
    prospectiveFaultCurrentA: orionOutput.prospectiveFaultCurrentA,
    envelopeA: orionOutput.verifiedProtectionEnvelopeA,
    ampacityA: orionOutput.ampacityA,
    status: orionOutput.status,
  }, { prospectiveFaultCurrentA: 60, envelopeA: 60, ampacityA: 30, status: "incomplete" });
  assert.ok(safety.warnings.some((issue) => (
    issue.code === "terminal-over-capacity" && issue.deviceId === "secondaryNegativeBus"
  )), "the seven-position negative bus retains its direct-return capacity warning");
  const ekranoGland = artifact.glands.find((gland) => gland.connectionIds.includes("ekrano-positive"));
  assert.equal(ekranoGland?.label, "Victron Ekrano GX");
  assert.ok(artifact.glands.every((gland) => gland.label && !gland.label.includes("gland-")),
    "gland labels are derived from meaningful graph owners");
});

test("precomputed diagram artifact is current and has audited visible geometry", async () => {
  const artifact = await readJson<GeneratedArtifact & {
    layouts: Record<string, {
      width: number;
      height: number;
      routingFallbacks: number;
      coincidentSegments: number;
      conductorOverlaps: number;
      parallelEnvelopeOverlaps: number;
      minimumParallelWireSeparation: number;
      nodeBodyCrossings: number;
      nodeOverlaps: number;
      bridgedCrossings: number;
      wireTurns: number;
      wireLength: number;
      interchangeableTapCandidates: number;
      interchangeableTapReassignments: number;
      busbarLandingCandidates: number;
      busbarLandingReassignments: number;
      peerOrderedBusbarIds: string[];
      tapRoutingOrderCandidates: number;
      selectedRoutingOrder: "diameter-short-first" | "short-first";
      boundaryPorts: Array<{ side: "input" | "output" | "neutral"; point: { x: number; y: number } }>;
      nodes: Array<{ deviceId: string; x: number; y: number; width: number; height: number;
        ports: Array<{ id: string; side: "input" | "output" | "neutral" | "top"; declaredOrder?: number }> }>;
      wires: Array<{ routeId: string; fromEndpointId: string; toEndpointId: string;
        points: Array<{ x: number; y: number }>;
        bridges: Array<{ point: { x: number; y: number }; axis: "horizontal" | "vertical" }> }>;
    }>;
  }>("data/generated/diagram-layouts.json");
  assert.equal(artifact.sourceHash, await sourceHash(artifact, [
    "app/UnifiedSystemDiagram.tsx",
    "app/dseTopology.ts",
    "data/generated/dse-runtime.json",
    "scripts/generate-diagram-layouts.ts",
  ]));
  assert.deepEqual(Object.keys(artifact.layouts).sort(), [
    "acJunction", "batteryCutoffJunction", "pvJunction", "secondaryJunction", "system",
  ]);
  for (const [scope, layout] of Object.entries(artifact.layouts)) {
    assert.equal(layout.routingFallbacks, 0, `${scope} fallbacks`);
    assert.equal(layout.coincidentSegments, 0, `${scope} coincident segments`);
    assert.equal(layout.conductorOverlaps, 0, `${scope} conductor overlaps`);
    assert.equal(layout.parallelEnvelopeOverlaps, 0, `${scope} parallel cable-envelope overlaps`);
    assert.ok(layout.minimumParallelWireSeparation >= 12, `${scope} doubled parallel wire spacing`);
    assert.equal(layout.nodeBodyCrossings, 0, `${scope} visible node crossings`);
    assert.equal(layout.nodeOverlaps, 0, `${scope} node overlaps`);
  }
  assert.ok(artifact.layouts.system.bridgedCrossings < 240, "system crossing budget");
  assert.ok(artifact.layouts.system.wireTurns < 340, "system turn budget");
  assert.ok(artifact.layouts.system.wireLength < 130_000, "system wire-length budget");
  assert.ok(artifact.layouts.batteryCutoffJunction.bridgedCrossings < 20, "cutoff-junction crossing budget");
  assert.ok(artifact.layouts.batteryCutoffJunction.wireTurns < 20, "cutoff-junction turn budget");
  assert.ok(artifact.layouts.secondaryJunction.bridgedCrossings <= 47, "secondary-junction crossing budget");
  assert.ok(artifact.layouts.secondaryJunction.wireTurns <= 80, "secondary-junction turn budget");
  assert.ok(artifact.layouts.secondaryJunction.wireLength <= 31_560, "secondary-junction wire-length budget");
  assert.ok(artifact.layouts.pvJunction.bridgedCrossings < 20, "PV-junction crossing budget");
  assert.equal(artifact.layouts.acJunction.bridgedCrossings, 3,
    "the two PE trunks bridge the protected cable crossings without false connections");
  assert.ok(artifact.layouts.acJunction.wireTurns <= 10,
    "connected PE routing remains well below the preceding 37-turn layout");
  assert.ok(artifact.layouts.acJunction.wireLength <= 4_776,
    "connected PE routing remains compact relative to the preceding 7,440-unit layout");
  assert.ok(artifact.layouts.acJunction.height <= 1_008,
    "the complete PE topology still compacts the preceding 1,320-unit canvas");
  assert.deepEqual(Object.fromEntries(["batteryCutoffJunction", "secondaryJunction", "pvJunction", "acJunction"].map((scope) => [scope,
    Object.fromEntries(Object.entries(Object.groupBy(artifact.layouts[scope].boundaryPorts, (port) => port.side))
      .map(([side, ports]) => [side, ports?.length ?? 0])),
  ])), {
    batteryCutoffJunction: { input: 1, output: 3, neutral: 2 },
    secondaryJunction: { input: 2, output: 13 },
    pvJunction: { input: 2, output: 2 },
    acJunction: { input: 2, output: 2, neutral: 1 },
  });
  for (const scope of ["batteryCutoffJunction", "secondaryJunction", "pvJunction", "acJunction"]) {
    const layout = artifact.layouts[scope];
    layout.boundaryPorts.forEach((port) => assert.equal(
      port.side === "input" ? port.point.x : port.side === "output" ? port.point.x : port.point.y,
      port.side === "input" ? 0 : port.side === "output" ? layout.width : layout.height,
      `${scope} ${port.side} gland must sit on the enclosure edge`,
    ));
    layout.wires.flatMap((wire) => wire.points).forEach((point) => {
      assert.ok(point.x >= 0 && point.x <= layout.width, `${scope} wire x=${point.x} stays bounded`);
      assert.ok(point.y >= 0 && point.y <= layout.height, `${scope} wire y=${point.y} stays bounded`);
    });
  }
  const systemNodes = artifact.layouts.system.nodes;
  assert.equal(systemNodes.some((node) => node.deviceId === "servicePenetration"), false,
    "inside/outside service penetration is collapsed out of the schematic");
  const systemNodeById = new Map(systemNodes.map((node) => [node.deviceId, node]));
  const systemLayout = artifact.layouts.system;
  assert.deepEqual({
    candidates: systemLayout.busbarLandingCandidates,
    reassignments: systemLayout.busbarLandingReassignments,
    buses: systemLayout.peerOrderedBusbarIds,
    crossings: systemLayout.bridgedCrossings,
    turns: systemLayout.wireTurns,
    length: systemLayout.wireLength,
  }, {
    candidates: 2,
    reassignments: 0,
    buses: [],
    crossings: 178,
    turns: 293,
    length: 101_088,
  }, "the R30 single-string layout remains deterministic across crossings, turns and length");
  const earthBar = systemNodeById.get("earthBar")!;
  assert.deepEqual(earthBar.ports.map((port) => port.id), [
    "post1", "post5", "post2", "post6", "post3", "post7", "post4", "post8",
  ], "the earth-bar fan interleaves the four assigned R30 landings with its four spare screws");
  const systemWireById = new Map(systemLayout.wires.map((wire) => [wire.routeId, wire]));
  assert.deepEqual([
    systemWireById.get("pv-frame-inside")?.toEndpointId,
    systemWireById.get("earth-electrode-inside")?.toEndpointId,
    systemWireById.get("multiplus-chassis-earth")?.toEndpointId,
    systemWireById.get("ac-main-earth")?.fromEndpointId,
  ], [
    "earthBar.post5", "earthBar.post1", "earthBar.post2", "earthBar.post4",
  ], "diagram slot optimization preserves every mechanically valid physical earth-bar landing");
  const generator = systemNodeById.get("generator")!;
  const generatorBreakout = systemNodeById.get("generatorLeadBreakout")!;
  const acJunction = systemNodeById.get("acJunction")!;
  const toolOutlet = systemNodeById.get("toolOutlet")!;
  const toolOutletBreakout = systemNodeById.get("toolOutletLeadBreakout")!;
  const externalAcChain = [generator, generatorBreakout, acJunction, toolOutletBreakout, toolOutlet];
  assert.deepEqual(externalAcChain.map((node) => node.y), Array(5).fill(acJunction.y),
    "generator, AC box and tool outlet occupy one uninterrupted external-AC row");
  externalAcChain.slice(1).forEach((node, index) => {
    const previous = externalAcChain[index];
    const expectedGap = previous.deviceId === "generatorLeadBreakout"
      || previous.deviceId === "acJunction" ? 144 : 72;
    assert.equal(previous.x + previous.width / 2 + expectedGap, node.x - node.width / 2,
      `${previous.deviceId} and ${node.deviceId} retain their dedicated routing corridor`);
  });
  assert.equal(acJunction.x, systemNodeById.get("unifi")!.x,
    "the complete external-AC chain is centered on the UniFi service column");
  const multiAcInBreakout = systemNodeById.get("multiAcInBreakout")!;
  const multiPlus = systemNodeById.get("multiPlus")!;
  const multiAcOutBreakout = systemNodeById.get("multiAcOutBreakout")!;
  for (const id of ["multiAcInBreakout", "multiPlus", "multiAcOutBreakout"]) {
    assert.ok(systemNodeById.get(id)!.y > acJunction.y,
      `${id} stays in the lower conversion row, outside the external AC chain`);
  }
  assert.deepEqual([multiAcInBreakout.y, multiAcOutBreakout.y], [multiPlus.y, multiPlus.y]);
  assert.equal(multiAcInBreakout.x + multiAcInBreakout.width / 2 + 96,
    multiPlus.x - multiPlus.width / 2, "AC-in breakout immediately flanks the MultiPlus on the left");
  assert.equal(multiPlus.x + multiPlus.width / 2 + 96,
    multiAcOutBreakout.x - multiAcOutBreakout.width / 2,
    "AC-out breakout immediately flanks the MultiPlus on the right");
  for (const routeId of ["mppt-positive-breaker", "mppt-negative-bus", "pv-frame-inside"]) {
    assert.ok(dominantVerticalTrunkX(systemWireById.get(routeId)!.points)
      < multiAcInBreakout.x - multiAcInBreakout.width / 2,
    `${routeId} trunk stays left of the AC-in breakout`);
  }
  for (const routeId of ["multiplus-negative", "data-mppt"]) {
    assert.ok(dominantVerticalTrunkX(systemWireById.get(routeId)!.points)
      > multiAcOutBreakout.x + multiAcOutBreakout.width / 2,
    `${routeId} trunk stays right of the AC-out breakout`);
  }
  const externalAcRouteIds = new Set([
    "generator-lead-line", "generator-lead-neutral", "generator-lead-earth", "generator-cable-inside",
    "tool-white-cable", "tool-outlet-line", "tool-outlet-neutral", "tool-outlet-earth",
  ]);
  const externalAcWires = systemLayout.wires.filter((wire) => externalAcRouteIds.has(wire.routeId));
  assert.equal(externalAcWires.length, externalAcRouteIds.size);
  externalAcWires.forEach((wire) => {
    assert.equal(wire.bridges.length, 0, `${wire.routeId} has no jump arcs`);
    systemLayout.wires.filter((peer) => !externalAcRouteIds.has(peer.routeId)).forEach((peer) => {
      assert.equal(orthogonalCrossingCount(wire.points, peer.points), 0,
        `${peer.routeId} does not cross protected external-AC route ${wire.routeId}`);
    });
  });
  const secondaryLayout = artifact.layouts.secondaryJunction;
  assert.deepEqual({
    candidates: secondaryLayout.busbarLandingCandidates,
    reassignments: secondaryLayout.busbarLandingReassignments,
    buses: secondaryLayout.peerOrderedBusbarIds,
  }, { candidates: 4, reassignments: 4, buses: ["secondaryPositiveBus"] });
  const secondaryWireById = new Map(secondaryLayout.wires.map((wire) => [wire.routeId, wire]));
  assert.deepEqual(Object.fromEntries([
    "service-main", "orion-breaker-feed", "chargeit-breaker-feed", "ekrano-positive",
  ].map((routeId) => [routeId, secondaryWireById.get(routeId)?.fromEndpointId])), {
    "service-main": "secondaryPositiveBus.post1",
    "orion-breaker-feed": "secondaryPositiveBus.post4",
    "chargeit-breaker-feed": "secondaryPositiveBus.post6",
    "ekrano-positive": "secondaryPositiveBus.post7",
  }, "positive-bus landings follow their crossing-minimal peer order");
  const acNodeById = new Map(artifact.layouts.acJunction.nodes.map((node) => [node.deviceId, node]));
  assert.deepEqual(acNodeById.get("join-generatorAcBreakout-earth-1")?.ports.map((port) => port.side).toSorted(),
    ["neutral", "output", "top"], "the first generator tee retains its vertical trunk");
  for (const id of ["join-generatorAcBreakout-earth-2", "join-acOutputCableBreakout-earth-2"]) {
    assert.deepEqual(acNodeById.get(id)?.ports.map((port) => port.side).toSorted(),
      ["input", "output", "top"], `${id} absorbs an upward branch corner`);
  }
  assert.deepEqual(acNodeById.get("join-generatorAcBreakout-earth-3")?.ports.map((port) => port.side).toSorted(),
    ["input", "neutral", "output"], "the final generator tee sends PE down to the AC-output chain");
  assert.deepEqual(acNodeById.get("join-acOutputCableBreakout-earth-1")?.ports.map((port) => port.side).toSorted(),
    ["neutral", "output", "top"], "the first output tee retains its vertical trunk");
  const acLayout = artifact.layouts.acJunction;
  assert.deepEqual({
    assignments: acLayout.interchangeableTapCandidates,
    reassignedRoutes: acLayout.interchangeableTapReassignments,
    routeOrders: acLayout.tapRoutingOrderCandidates,
    selectedOrder: acLayout.selectedRoutingOrder,
  }, { assignments: 144, reassignedRoutes: 4, routeOrders: 2, selectedOrder: "diameter-short-first" });
  const acWireById = new Map(acLayout.wires.map((wire) => [wire.routeId, wire]));
  assert.deepEqual([
    acWireById.get("ac-generator-earth")?.fromEndpointId,
    acWireById.get("ac-generator-earth")?.toEndpointId,
  ], ["join-generatorAcBreakout-earth-2.branch", "acInputProtection.earth"]);
  assert.deepEqual([
    acWireById.get("ac-input-earth")?.fromEndpointId,
    acWireById.get("ac-input-earth")?.toEndpointId,
  ], ["join-generatorAcBreakout-earth-3.through", "acInputCableBreakout.earth"]);
  assert.deepEqual([
    acWireById.get("ac-output-spd-earth")?.fromEndpointId,
    acWireById.get("ac-socket-earth")?.fromEndpointId,
  ], ["join-acOutputCableBreakout-earth-2.through", "join-acOutputCableBreakout-earth-1.through"]);
  assert.deepEqual([
    acWireById.get("ac-earth-continuity")?.fromEndpointId,
    acWireById.get("ac-earth-continuity")?.toEndpointId,
  ], ["join-generatorAcBreakout-earth-3.branch", "join-acOutputCableBreakout-earth-2.branch"]);
  const firstDeviceLink = acWireById.get("join-generatorAcBreakout-earth-1-device-link")!.points;
  assert.equal(firstDeviceLink.length, 3, "the generator breakout link retains one right/down turn");
  assert.ok(firstDeviceLink[1].x > firstDeviceLink[0].x && firstDeviceLink[1].y === firstDeviceLink[0].y);
  assert.ok(firstDeviceLink[2].x === firstDeviceLink[1].x && firstDeviceLink[2].y > firstDeviceLink[1].y);
  const interJoinLink = acWireById.get("join-generatorAcBreakout-earth-2-device-link")!.points;
  assert.equal(interJoinLink.length, 2, "the generator tees meet with one straight horizontal cylinder");
  assert.equal(interJoinLink[0].y, interJoinLink[1].y);
  for (const routeId of ["join-generatorAcBreakout-earth-3-device-link", "join-acOutputCableBreakout-earth-2-device-link"]) {
    const points = acWireById.get(routeId)!.points;
    assert.deepEqual(points[0], points[1], `${routeId} is the intentional touching-cylinder join`);
  }
  for (const routeId of ["ac-generator-earth", "ac-earth-continuity"]) {
    const points = acWireById.get(routeId)!.points;
    assert.equal(points.length, 2, `${routeId} is one straight PE segment`);
    assert.equal(points[0].x, points[1].x);
  }
  const mainEarth = acWireById.get("ac-main-earth")!;
  assert.equal(mainEarth.points.length, 2, "the bottom PE trunk is one straight segment");
  assert.equal(mainEarth.points[0].x, mainEarth.points[1].x, "the bottom PE trunk stays in one vertical lane");
  const outputWhite = acWireById.get("ac-output-white-cable")!;
  assert.deepEqual(outputWhite.bridges.map((bridge) => bridge.point), [{
    x: mainEarth.points[0].x,
    y: outputWhite.points[0].y,
  }], "the straight PE trunk crosses only the incoming protected-AC-out cable");
  for (const routeId of [
    "ac-generator-line", "ac-generator-neutral", "ac-input-line", "ac-input-neutral",
    "ac-output-line", "ac-output-neutral", "ac-socket-line", "ac-socket-neutral",
  ]) assert.equal(acWireById.get(routeId)?.points.length, 2, `${routeId} is one straight segment`);
  for (const id of ["panel1", "panel2", "panel3"]) {
    assert.deepEqual(systemNodeById.get(id)?.ports.map((port) => [port.id, port.side, port.declaredOrder]), [
      ["positive", "output", 0], ["negative", "output", 1], ["frame", "output", 2],
    ], `${id} right-edge red/black/frame order`);
  }
  for (const id of ["battery1", "battery2", "battery3", "battery4"]) {
    assert.deepEqual(systemNodeById.get(id)?.ports.map((port) => [port.id, port.side, port.declaredOrder]), [
      ["positive", "output", 0], ["negative", "output", 1],
    ], `${id} right-edge positive/negative order`);
  }
  assert.deepEqual(systemNodeById.get("smartSolar")?.ports.map((port) => [port.id, port.side, port.declaredOrder]), [
    ["pvPositive", "input", 0], ["pvNegative", "input", 1],
    ["batteryPositive", "output", 2], ["batteryNegative", "output", 3],
    ["veDirect", "neutral", 4],
  ]);
  const assertGrid = (ids: readonly string[], columns: number, rows: number) => {
    const members = systemNodes.filter((node) => ids.includes(node.deviceId));
    assert.equal(members.length, ids.length, `${ids.join(", ")} member count`);
    assert.equal(new Set(members.map((node) => node.x)).size, columns, `${ids.join(", ")} columns`);
    assert.equal(new Set(members.map((node) => node.y)).size, rows, `${ids.join(", ")} rows`);
  };
  assertGrid(["panel1", "panel2", "panel3"], 3, 1);
  assertGrid(["battery1", "battery2", "battery3", "battery4"], 2, 2);
  assertGrid(["usbMiniA", "usbMiniB", "usbMiniC", "usbMiniD"], 4, 1);
  assertGrid(["usb145A", "usb145B"], 2, 2);
});
