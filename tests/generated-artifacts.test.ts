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

test("precomputed 3D runtime artifact is current and conflict-free", async () => {
  const artifact = await readJson<GeneratedArtifact & {
    devices: Array<{ id: string; size: [number, number, number] }>;
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
  assert.equal(artifact.devices.length, 89);
  assert.equal(artifact.conductors.length, 313);
  assert.equal(artifact.routes.length, 149);
  assert.ok(artifact.diagnostics.routingTargetAssignments.length > 0);
  assert.ok(artifact.diagnostics.routingTargetAssignments.some((assignment) => (
    assignment.authoredEndpoint !== assignment.resolvedEndpoint
  )));
  assert.ok(artifact.diagnostics.totalLengthM < 156.14);
  assert.ok(artifact.diagnostics.totalTurns < 887);
  const expectedEnclosures = new Map([
    ["batteryCutoffJunction", { size: [0.20, 0.16, 0.10], physicalSize: [0.200, 0.155, 0.092], glands: 6 }],
    ["secondaryJunction", { size: [0.48, 0.52, 0.24], glands: 15 }],
    ["pvJunction", { size: [0.32, 0.28, 0.16], glands: 7 }],
    ["acJunction", { size: [0.36, 0.44, 0.12], glands: 5 }],
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
  assert.equal(safety.sources.length, 10);
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
      boundaryPorts: Array<{ side: "input" | "output" | "neutral"; point: { x: number; y: number } }>;
      nodes: Array<{ deviceId: string; x: number; y: number;
        ports: Array<{ id: string; side: "input" | "output" | "neutral"; declaredOrder?: number }> }>;
      wires: Array<{ fromEndpointId: string; toEndpointId: string; points: Array<{ x: number; y: number }> }>;
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
  assert.ok(artifact.layouts.secondaryJunction.bridgedCrossings < 100, "secondary-junction crossing budget");
  assert.ok(artifact.layouts.secondaryJunction.wireTurns < 120, "secondary-junction turn budget");
  assert.ok(artifact.layouts.pvJunction.bridgedCrossings < 20, "PV-junction crossing budget");
  assert.ok(artifact.layouts.acJunction.bridgedCrossings < 20, "AC-junction crossing budget");
  assert.deepEqual(Object.fromEntries(["batteryCutoffJunction", "secondaryJunction", "pvJunction", "acJunction"].map((scope) => [scope,
    Object.fromEntries(Object.entries(Object.groupBy(artifact.layouts[scope].boundaryPorts, (port) => port.side))
      .map(([side, ports]) => [side, ports?.length ?? 0])),
  ])), {
    batteryCutoffJunction: { input: 1, output: 3, neutral: 2 },
    secondaryJunction: { input: 2, output: 13 },
    pvJunction: { input: 4, output: 2, neutral: 1 },
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
  for (const id of ["panel1", "panel2", "panel3", "panel4"]) {
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
  assertGrid(["panel1", "panel2", "panel3", "panel4"], 2, 2);
  assertGrid(["battery1", "battery2", "battery3", "battery4"], 2, 2);
  assertGrid(["usbMiniA", "usbMiniB", "usbMiniC", "usbMiniD"], 4, 1);
  assertGrid(["usb145A", "usb145B"], 2, 2);
});
