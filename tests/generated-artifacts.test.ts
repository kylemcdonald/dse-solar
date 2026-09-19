import type { GraphRuntimeArtifact } from "../app/systemGraph";
import { deviceLocalPoint, worldHalfExtents } from "../app/physicalLayout";
import assert from "node:assert/strict";
import { diagramRuntimeSignature } from "../app/wallPlan";
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

async function sourceHash(artifact: GeneratedArtifact, relativePaths: readonly string[], extra: ReadonlyArray<readonly [string, string]> = []) {
  const hash = createHash("sha256");
  hash.update(`${artifact.schemaVersion}:${artifact.generatorVersion}\n`);
  for (const relativePath of relativePaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relativePath)));
    hash.update("\0");
  }
  for (const [label, content] of extra) {
    hash.update(`${label}\0`);
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

type Point = { x: number; y: number };

function orthogonalCrossingCount(first: readonly Point[], second: readonly Point[]) {
  let crossings = 0;
  first.slice(1).forEach((firstEnd, firstIndex) => {
    const firstStart = first[firstIndex]; const firstHorizontal = firstStart.y === firstEnd.y;
    second.slice(1).forEach((secondEnd, secondIndex) => {
      const secondStart = second[secondIndex]; const secondHorizontal = secondStart.y === secondEnd.y;
      if (firstHorizontal === secondHorizontal) return;
      const [horizontalStart, horizontalEnd, verticalStart, verticalEnd] = firstHorizontal
        ? [firstStart, firstEnd, secondStart, secondEnd]
        : [secondStart, secondEnd, firstStart, firstEnd];
      if (verticalStart.x > Math.min(horizontalStart.x, horizontalEnd.x)
        && verticalStart.x < Math.max(horizontalStart.x, horizontalEnd.x)
        && horizontalStart.y > Math.min(verticalStart.y, verticalEnd.y)
        && horizontalStart.y < Math.max(verticalStart.y, verticalEnd.y)) crossings += 1;
    });
  });
  return crossings;
}

test("precomputed 3D runtime artifact is current, complete and conflict-free", async () => {
  const artifact = await readJson<GraphRuntimeArtifact>("data/generated/dse-runtime.json");
  const { dseTopology } = await import("../app/dseTopology");
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.graphId, dseTopology.id);
  assert.equal(artifact.graphRevision, dseTopology.revision);
  const { runtimeSourceHash } = await import("../scripts/runtimeArtifact");
  const { applyWallPlan } = await import("../app/wallPlan");
  const planHash=(artifact as GraphRuntimeArtifact & {wallPlanSourceHash?:string|null}).wallPlanSourceHash;
  const plan=planHash ? await readJson<import("../app/wallPlan").WallPlan>("data/generated/wall-plan.json") : undefined;
  assert.equal(artifact.sourceHash,await runtimeSourceHash(applyWallPlan(dseTopology,plan),["app/dseTopology.ts","app/wallPlan.ts"],planHash??null),"runtime artifact must be regenerated whenever its inputs change");

  // Completeness: every device, conductor and connection is represented once.
  assert.equal(artifact.devices.length, dseTopology.devices.length);
  assert.equal(artifact.conductors.length, dseTopology.devices.reduce((sum, device) => sum + device.conductors.length, 0));
  assert.equal(artifact.routes.length, dseTopology.connections.length);
  assert.deepEqual(artifact.routes.map((route) => route.id).toSorted(), dseTopology.connections.map((connection) => connection.id).toSorted());

  // Every cable solved, no fallbacks, every audit clean including the exact rendered tubes.
  assert.deepEqual({
    routed: artifact.diagnostics.routed,
    fallbacks: artifact.diagnostics.fallbacks,
    centerline: artifact.diagnostics.centerlineConflicts,
    swept: artifact.diagnostics.sweptCableConflicts,
    self: artifact.diagnostics.selfIntersections,
    device: artifact.diagnostics.deviceConflicts,
    rendered: artifact.diagnostics.renderedGeometryConflicts,
  }, { routed: artifact.routes.length, fallbacks: 0, centerline: 0, swept: 0, self: 0, device: 0, rendered: 0 });
  assert.ok(artifact.routes.every((route) => route.routed && route.points.length >= 2));

  // Corner-layout regression budgets include the roof and the second wall.
  assert.ok(artifact.diagnostics.totalLengthM < 150, `total length ${artifact.diagnostics.totalLengthM} m`);
  assert.ok(artifact.diagnostics.totalTurns < 800, `total turns ${artifact.diagnostics.totalTurns}`);
  assert.ok(artifact.diagnostics.routingMs < 60_000, `routing took ${artifact.diagnostics.routingMs} ms`);

  // Interchangeable bar landings were assigned by the router.
  assert.ok(artifact.diagnostics.routingTargetAssignments.length > 0);
  const conductorByKey = new Map(artifact.conductors.map((conductor) => [conductor.key, conductor]));
  artifact.diagnostics.routingTargetAssignments.forEach((assignment) => {
    assert.ok(conductorByKey.has(assignment.resolvedEndpoint), `${assignment.connectionId} lands on a real terminal`);
  });

  // Every route starts and ends exactly on its resolved terminals.
  artifact.routes.forEach((route) => {
    const from = conductorByKey.get(route.from)!; const to = conductorByKey.get(route.to)!;
    assert.deepEqual(route.points[0], from.position, `${route.id} starts at ${route.from}`);
    assert.deepEqual(route.points.at(-1), to.position, `${route.id} ends at ${route.to}`);
  });

  // Declared top/bottom gland rows per enclosure with every crossing cable represented.
  const deviceById = new Map(artifact.devices.map((device) => [device.id, device]));
  dseTopology.junctions.forEach((junction) => {
    const container = deviceById.get(junction.deviceId)!;
    const glands = artifact.glands.filter((gland) => gland.junctionId === junction.deviceId);
    assert.ok(glands.length > 0, `${junction.id} has glands`);

    glands.forEach((gland) => {
      assert.ok(Math.abs(deviceLocalPoint(container, gland.position)[1] - (gland.face === "top" ? 1 : -1) * container.size[1] / 2) < 1e-6, `${gland.id} sits on its declared edge`);
      assert.ok(Math.abs(deviceLocalPoint(container, gland.position)[0]) <= container.size[0] / 2, `${gland.id} within the shell`);
      assert.ok(gland.label && !gland.label.includes("gland-"), `${gland.id} has a graph-derived label`);
    });
    for (const face of ["top", "bottom"]) {
    const xs = glands.filter(gland => (gland.face ?? "bottom") === face).map((gland) => deviceLocalPoint(container, gland.position)[0]).toSorted((a, b) => a - b);
    xs.slice(1).forEach((x, index) => assert.ok(Math.abs(x - xs[index] - junction.glandSpacing) < 1e-6, `${junction.id} glands evenly spaced`));
    }
    const members = new Set(artifact.devices.filter((device) => device.placement.space === "junction" && device.placement.junctionId === junction.deviceId).map((device) => device.id));
    const crossing = artifact.routes.filter((route) => members.has(route.from.slice(0, route.from.lastIndexOf("."))) !== members.has(route.to.slice(0, route.to.lastIndexOf("."))));
    assert.equal(new Set(glands.flatMap((gland) => gland.connectionIds)).size, crossing.length, `${junction.id} gland row covers every crossing cable`);
  });

  // Verified-fixed shells keep their declared size; every enclosure member lies inside its shell.
  dseTopology.junctions.filter((junction) => junction.sizePolicy === "verified-fixed").forEach((junction) => {
    const authored = dseTopology.devices.find((device) => device.id === junction.deviceId)!;
    assert.deepEqual(deviceById.get(junction.deviceId)!.size, authored.size, `${junction.id} keeps its verified size`);
  });
  artifact.devices.filter((device) => device.placement.space === "junction").forEach((device) => {
    if (device.placement.space !== "junction") return;
    const container = deviceById.get(device.placement.junctionId)!;
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(deviceLocalPoint(container, device.position)[axis]) + worldHalfExtents({ ...device, rotation: [0, 0, device.rotation[2] - container.rotation[2]] })[axis] <= container.size[axis] / 2 + 1e-6, `${device.id} inside ${container.id} on axis ${axis}`);
    }
  });

  const safety = artifact.diagnostics.currentSafety;
  assert.equal(safety.scope, "supply-active-and-explicitly-paired-returns");
  assert.equal(safety.status, "incomplete", "unresolved design evidence must remain fail-closed");
  assert.equal(safety.sources.length, 9);
  assert.ok(safety.errors.length > 0);
  assert.ok(safety.warnings.length > 0);
});

test("precomputed diagram artifact is current and has audited visible geometry", async () => {
  const artifact = await readJson<GeneratedArtifact & {
    layouts: Record<string, {
      scope: string; width: number; height: number;
      layoutMs: number; routingMs: number; compactionMs: number;
      nodes: Array<{ deviceId: string; x: number; y: number; width: number; height: number; ports: Array<{ id: string; side: string; kind: string; declaredOrder?: number; offset?: number }> }>;
      boundaryPorts: Array<{ side: string; point: Point; glandId?: string }>;
      wires: Array<{ routeId: string; fromEndpointId: string; toEndpointId: string; points: Point[]; bridges: Array<{ point: Point; axis: string }> }>;
      routingFallbacks: number; coincidentSegments: number; nonOrthogonalSegments: number; conductorOverlaps: number;
      unbridgedCrossings: number; bridgedCrossings: number; parallelEnvelopeOverlaps: number; minimumParallelWireSeparation: number;
      nodeBodyCrossings: number; nodeOverlaps: number; wireTurns: number; wireLength: number;
    }>;
  }>("data/generated/diagram-layouts.json");
  const { dseTopology } = await import("../app/dseTopology");
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.graphId, dseTopology.id);
  assert.equal(artifact.graphRevision, dseTopology.revision);
  assert.equal(artifact.sourceHash, await sourceHash(artifact, [
    "app/diagramLayout.ts",
    "app/diagramNodes.ts",
    "app/diagramPlacement.ts",
    "app/dseTopology.ts",
    "app/wallPlan.ts",
    "app/systemGraph.ts",
    "app/dseRuntime.ts",
    "scripts/generate-diagram-layouts.ts",
  ], [["runtime-signature", diagramRuntimeSignature(await readJson("data/generated/dse-runtime.json"))]]), "diagram artifact must be regenerated whenever its inputs change");
  assert.deepEqual(Object.keys(artifact.layouts).sort(), ["acJunction", "batteryCutoffJunction", "pvJunction", "secondaryJunction", "system", "wallSwitchJunction"]);

  for (const [scope, layout] of Object.entries(artifact.layouts)) {
    assert.deepEqual([layout.layoutMs, layout.routingMs, layout.compactionMs], [0, 0, 0], `${scope} excludes machine-dependent timings`);
    assert.equal(layout.routingFallbacks, 0, `${scope} fallbacks`);
    assert.equal(layout.coincidentSegments, 0, `${scope} coincident segments`);
    assert.equal(layout.nonOrthogonalSegments, 0, `${scope} diagonal segments`);
    assert.equal(layout.conductorOverlaps, 0, `${scope} conductor overlaps`);
    assert.equal(layout.unbridgedCrossings, 0, `${scope} unbridged crossings`);
    assert.equal(layout.parallelEnvelopeOverlaps, 0, `${scope} parallel cable-envelope overlaps`);
    assert.ok(layout.minimumParallelWireSeparation >= 12, `${scope} parallel wire spacing`);
    assert.equal(layout.nodeBodyCrossings, 0, `${scope} visible node crossings`);
    assert.equal(layout.nodeOverlaps, 0, `${scope} node overlaps`);
    // Everything on the 12 px grid, inside the canvas, and every crossing bridged.
    layout.nodes.forEach((node) => {
      assert.ok(node.x % 12 === 0 && node.y % 12 === 0 && node.width % 24 === 0 && node.height % 24 === 0, `${scope} ${node.deviceId} on the grid`);
      assert.ok(node.x - node.width / 2 >= 0 && node.x + node.width / 2 <= layout.width, `${scope} ${node.deviceId} within width`);
      assert.ok(node.y - node.height / 2 >= 0 && node.y + node.height / 2 <= layout.height, `${scope} ${node.deviceId} within height`);
    });
    layout.wires.forEach((wire) => {
      wire.points.forEach((point) => {
        assert.ok(point.x >= 0 && point.x <= layout.width && point.y >= 0 && point.y <= layout.height, `${scope} ${wire.routeId} stays on the canvas`);
      });
      wire.bridges.forEach((bridge) => {
        assert.ok(wire.points.slice(1).some((end, index) => {
          const start = wire.points[index];
          return start.y === end.y && bridge.point.y === start.y && bridge.point.x > Math.min(start.x, end.x) && bridge.point.x < Math.max(start.x, end.x);
        }), `${scope} ${wire.routeId} bridge lies on a horizontal segment`);
      });
    });
    let crossings = 0;
    for (let first = 0; first < layout.wires.length; first += 1) {
      for (let second = first + 1; second < layout.wires.length; second += 1) {
        crossings += orthogonalCrossingCount(layout.wires[first].points, layout.wires[second].points);
      }
    }
    assert.equal(crossings, layout.bridgedCrossings, `${scope} every crossing carries a jump`);
    // Flow: wires leave output ports rightward and enter input ports leftward.
    const portSide = new Map<string, string>(layout.nodes.flatMap((node) => node.ports.map((port) => [`${node.deviceId}.${port.id}`, port.side])));
    layout.wires.forEach((wire) => {
      const from = portSide.get(wire.fromEndpointId); const to = portSide.get(wire.toEndpointId);
      if (from === "output") assert.ok(wire.points[1].x > wire.points[0].x, `${scope} ${wire.routeId} leaves an output to the right`);
      if (to === "input") assert.ok(wire.points.at(-2)!.x < wire.points.at(-1)!.x, `${scope} ${wire.routeId} enters an input from the left`);
    });
  }

  // Devices of one family expose identical port order: positive before negative.
  const system = artifact.layouts.system;
  const nodeById = new Map(system.nodes.map((node) => [node.deviceId, node]));
  const portOrder = (id: string) => nodeById.get(id)!.ports.map((port) => `${port.side}:${port.id}`).join(",");
  assert.equal(portOrder("usbMiniA"), portOrder("usbMiniB"));
  assert.equal(portOrder("usbMiniB"), portOrder("usbMiniC"));
  assert.equal(portOrder("battery1"), portOrder("battery3"));
  assert.equal(portOrder("balancerA"), portOrder("balancerB"));
  // Terminals spliced by an attached join face that join beneath the device:
  // positive left of negative along the bottom edge, each splice directly below.
  const miniPorts = nodeById.get("usbMiniA")!.ports.filter((port) => port.side === "neutral");
  assert.deepEqual(miniPorts.map((port) => port.id), ["positive", "negative"]);
  assert.ok((miniPorts[0].offset ?? 0) < (miniPorts[1].offset ?? 0));
  const mini = nodeById.get("usbMiniA")!;
  ["positive", "negative"].forEach((terminal) => {
    const join = nodeById.get(`join-usbMiniA-${terminal}`)!;
    const port = miniPorts.find((candidate) => candidate.id === terminal)!;
    assert.equal(join.x, mini.x + (port.offset ?? 0), `${terminal} splice sits under its terminal`);
    assert.ok(join.y > mini.y + mini.height / 2, `${terminal} splice sits below the device`);
  });
  assert.equal(system.nodes.some((node) => node.deviceId === "servicePenetration"), false, "the wall penetration collapses to continuous wires");

  // Quality budgets: below the pre-rewrite baseline (178 crossings, 289 turns, 100,476 px).
  assert.ok(system.bridgedCrossings < 180, "system crossing budget");
  assert.ok(system.wireTurns < 290, "system turn budget");
  assert.ok(system.wireLength < 110_000, "system wire-length budget");
  assert.ok(artifact.layouts.secondaryJunction.bridgedCrossings < 47, "secondary-junction crossing budget");
  assert.ok(artifact.layouts.secondaryJunction.wireTurns < 80, "secondary-junction turn budget");

  // Subpatch boundary ports sit on the canvas edges by side.
  (["batteryCutoffJunction", "secondaryJunction", "pvJunction", "acJunction"] as const).forEach((scope) => {
    const layout = artifact.layouts[scope];
    layout.boundaryPorts.forEach((port) => {
      if (port.side === "input") assert.equal(port.point.x, 0, `${scope} inputs on the left edge`);
      else if (port.side === "output") assert.equal(port.point.x, layout.width, `${scope} outputs on the right edge`);
      else assert.equal(port.point.y, layout.height, `${scope} neutral ports on the bottom edge`);
      assert.ok(port.glandId, `${scope} boundary port carries its gland`);
    });
  });
});
