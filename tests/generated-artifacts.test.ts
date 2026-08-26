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
    glands: Array<{ junctionId: string }>;
    routes: unknown[];
    diagnostics: {
      fallbacks: number;
      centerlineConflicts: number;
      sweptCableConflicts: number;
      selfIntersections: number;
      deviceConflicts: number;
      renderedGeometryConflicts: number;
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
  assert.equal(artifact.devices.length, 92);
  assert.equal(artifact.conductors.length, 322);
  assert.equal(artifact.routes.length, 148);
  const expectedEnclosures = new Map([
    ["batteryCutoffJunction", { size: [0.20, 0.16, 0.10], physicalSize: [0.200, 0.155, 0.092], glands: 6 }],
    ["secondaryJunction", { size: [0.30, 0.30, 0.18], physicalSize: [0.302, 0.302, 0.178], glands: 15 }],
    ["pvJunction", { size: [0.32, 0.28, 0.16], glands: 7 }],
    ["acJunction", { size: [0.52, 0.60, 0.24], glands: 5 }],
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
  assert.ok(artifact.layouts.system.wireLength < 120_000, "system wire-length budget");
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
