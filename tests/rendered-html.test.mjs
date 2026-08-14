import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the solar viewer shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(html, /<title>DSE &amp; PG Solar Systems<\/title>/i);
  assert.match(html, /Drua Sailing Experience/);
  assert.match(html, />3D model</);
  assert.match(html, /Bill of materials/);
  assert.match(html, />System</);
  assert.doesNotMatch(html, /Power-flow overview|System connectivity|Fieldline/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("canonical system files contain valid totals, diagram levels and physical envelopes", async () => {
  const [dse, pg, physicalModel] = await Promise.all([
    readFile(new URL("../data/dse-system.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/pg-system.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/dse-model.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  for (const system of [dse, pg]) {
    assert.ok(system.diagram.views.overview.nodes.length > 5);
    assert.ok(system.diagram.views.detail.nodes.length > 10);
    assert.ok(system.bom.length > 20);
    const ids = new Set(system.components.map((component) => component.id));
    for (const view of Object.values(system.diagram.views)) {
      assert.ok(view.nodes.every((node) => ids.has(node.id)));
      const viewIds = new Set(view.nodes.map((node) => node.id));
      assert.ok(view.edges.every((edge) => viewIds.has(edge.from) && viewIds.has(edge.to)));
    }
  }

  const dseTotal = dse.bom
    .filter((item) => item.includedInTotal !== false)
    .reduce((sum, item) => sum + item.totalUsd, 0);
  const pgTotal = pg.bom.reduce((sum, item) => sum + item.totalUsd, 0);
  assert.equal(Number(dseTotal.toFixed(2)), 8758.06);
  assert.equal(pgTotal, 3225);
  assert.equal(dse.powerModel.arrayVmp, 85.12);
  assert.equal(dse.powerModel.arrayColdVoc10C, 104.71);
  assert.equal(dse.powerModel.pvHomeRuns, 2);
  assert.equal(dse.powerModel.pvCableLossPercent, 2.02);
  assert.equal(dse.powerModel.fallbackPvCableLossPercent, undefined);
  assert.doesNotMatch(JSON.stringify(physicalModel), /array-protection-box/);
  assert.match(dse.components.find((item) => item.id === "array").summary, /2S2P/);
  assert.equal(dse.components.find((item) => item.id === "inverter").title, "MultiPlus-II 24/3000");
  assert.equal(dse.components.find((item) => item.id === "systemMonitor").title, "Ekrano GX");
  assert.equal(dse.components.find((item) => item.id === "solarController").title, "SmartSolar MPPT 150/85-Tr");
  assert.equal(dse.components.find((item) => item.id === "acBoard").title, "AC output protection");
  assert.equal(dse.components.find((item) => item.id === "toolOutlet").title, "Trailing tool lead");
  assert.match(dse.components.find((item) => item.id === "fuseBlock").summary, /each red load conductor/i);
  assert.match(dse.components.find((item) => item.id === "fuseBlock").summary, /black load conductor returns unfused/i);
  assert.match(dse.bom.find((item) => item.id === "dse-ac-board").item, /trailing tool lead/i);
  assert.doesNotMatch(JSON.stringify(dse), /workshop outlets/i);
  assert.deepEqual(dse.diagram.views.overview.regions[0].memberIds, [
    "systemMonitor",
    "batterySelector",
    "mainDc",
  ]);
  assert.deepEqual(dse.diagram.views.detail.regions[0].memberIds, [
    "systemMonitor",
    "batterySelector",
    "mainDc",
    "fuseBlock",
  ]);
  assert.equal(dse.components.find((item) => item.id === "router").title, "UniFi Express");
  assert.equal(dse.bom.find((item) => item.id === "dse-router").procurement, "Purchased");
  assert.equal(dse.bom.find((item) => item.id === "dse-ekrano-gx").unitCost, 619.65);
  assert.equal(dse.budget.donorFundedIncrementUsd, 607.11);
  assert.equal(dse.budget.targetBasis, "remaining");
  assert.equal(dse.components.find((item) => item.id === "batteryBank").title, "24 V · 400 Ah GEL bank");
  assert.equal(dse.bom.find((item) => item.id === "dse-pv-cable").qty, 60);
  assert.equal(dse.bom.find((item) => item.id === "dse-pv-cable").location, "Fiji");
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "panel1" && edge.to === "panel2"));
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "panel3" && edge.to === "panel4"));
  assert.ok(!dse.diagram.views.detail.edges.some((edge) => edge.from === "panel2" && edge.to === "panel3"));
  assert.equal(dse.bom.find((item) => item.id === "dse-battery-cable").location, "Import");
  assert.match(dse.bom.find((item) => item.id === "dse-battery-cable").item, /preterminated 1\/0 AWG/i);
  assert.equal(dse.batteryCablePlan.assemblies.reduce((sum, item) => sum + item.qty, 0), 12);
  assert.equal(dse.bom.find((item) => item.id === "dse-balancers").qty, 2);
  assert.ok(dse.bom.some((item) => item.id === "dse-selector"));
  assert.ok(!dse.bom.some((item) => item.id === "dse-bp"));
  assert.ok(!dse.bom.some((item) => /Cerbo GX|GX Touch/i.test(item.item)));
  assert.ok(!dse.bom.some((item) => /Growatt|MikroTik|Mean Well/i.test(item.item)));

  assert.equal(physicalModel.scale, "1 scene unit = 1 metre");
  assert.match(physicalModel.revision, /R14/);
  assert.equal(physicalModel.scene.plannedPvHomeRunM, 15);
  assert.deepEqual(physicalModel.scene.arrayOrientation, { azimuth: "north", tiltDeg: 18 });
  assert.ok(physicalModel.scene.illustratedPvRouteM < physicalModel.scene.plannedPvHomeRunM);
  assert.ok(physicalModel.scene.wallCableStandOffMm <= 40);
  assert.deepEqual(physicalModel.scene.wallCableRoutingEnvelopeMm, [35, 245]);
  assert.equal(physicalModel.scene.batteryRack, false);
  assert.match(physicalModel.scene.batteryArrangement, /floor.*2 × 2/i);
  assert.equal(physicalModel.scene.sideWallPlanes, false);
  assert.equal(physicalModel.scene.roofPlane, false);
  assert.match(physicalModel.scene.classTFuseMounting, /no separate backplate/i);
  assert.match(physicalModel.scene.heavyBatteryCableRoute, /around the outside of the floor battery footprint/i);
  assert.match(physicalModel.scene.junctionCableEntries, /23 continuous inside \/ gland \/ outside/i);
  assert.match(physicalModel.scene.junctionMounting, /zero cable routes behind/i);
  assert.match(physicalModel.scene.layoutSolver, /independently generates/i);
  assert.match(physicalModel.scene.cableGeometry, /continuous tube/i);
  assert.match(physicalModel.scene.cableGeometry, /corner-contained bends/i);
  assert.match(physicalModel.scene.cableGeometry, /seamless adjacent corners/i);
  assert.match(physicalModel.scene.cableGeometry, /tangent render handoffs/i);
  assert.match(physicalModel.scene.ceilingCableRouting, /no perpendicular mesh handoffs/i);
  assert.match(physicalModel.scene.ceilingCableRouting, /no route snaps back/i);
  assert.match(physicalModel.scene.cameraControls, /ofxGrabCam-inspired/i);
  assert.match(physicalModel.scene.cameraControls, /XYZ surface point under mouse or touch/i);
  assert.match(physicalModel.scene.cameraControls, /upright world-Y yaw and pitch/i);
  assert.match(physicalModel.scene.cameraControls, /one touch orbits and two touches pan plus pinch-zoom/i);
  assert.match(physicalModel.connectionAudit.rule, /no 12 V conductor lands directly/i);
  assert.match(physicalModel.connectionAudit.rule, /no protective-earth conductor ends in open space/i);
  assert.equal(physicalModel.connectionAudit.protectiveEarth.connections.length, 6);
  assert.deepEqual(physicalModel.connectionAudit.unifiExpress.ports, ["USB-C power", "WAN", "LAN"]);
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.id === "dt-usb-router"));
  assert.ok(!dse.diagram.views.detail.edges.some((edge) => edge.id === "dt-router"));
  assert.deepEqual(physicalModel.scene.backWallM, [5.8, 3, 0.08]);
  assert.deepEqual(physicalModel.scene.equipmentBoardM, [3.4, 2.5, 0.018]);
  assert.deepEqual(
    physicalModel.envelopes.find((item) => item.id === "suntech-panel").dimensionsMm,
    { width: 2279, height: 1134, depth: 35 },
  );
  assert.deepEqual(
    physicalModel.envelopes.find((item) => item.id === "everexceed-battery").dimensionsMm,
    { width: 520, height: 220, depth: 238 },
  );
  assert.deepEqual(
    physicalModel.envelopes.find((item) => item.id === "multiplus").dimensionsMm,
    { width: 268, height: 499, depth: 141 },
  );
  assert.deepEqual(
    physicalModel.envelopes.find((item) => item.id === "ekrano-junction-box").dimensionsMm,
    { width: 350, height: 247, depth: 150 },
  );
  assert.equal(
    physicalModel.envelopes.find((item) => item.id === "ekrano-junction-box").status,
    "user-specified",
  );
  assert.ok(physicalModel.envelopes.filter((item) => item.status === "verified").length >= 10);
});
