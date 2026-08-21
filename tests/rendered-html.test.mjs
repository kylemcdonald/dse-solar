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
  assert.match(html, />Junction box</);
  assert.match(html, /Bill of materials/);
  assert.match(html, />Customs</);
  assert.match(html, />System</);
  assert.doesNotMatch(html, /Power-flow overview|System connectivity|Fieldline/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("canonical system files contain valid totals, diagram levels and physical envelopes", async () => {
  const [dse, pg, physicalModel, delivery, customs] = await Promise.all([
    readFile(new URL("../data/dse-system.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/pg-system.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/dse-model.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/dse-delivery.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../data/dse-customs.json", import.meta.url), "utf8").then(JSON.parse),
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
  assert.equal(Number(dseTotal.toFixed(2)), 8993.73);
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
  assert.equal(dse.components.find((item) => item.id === "batteryProtection").title, "Dual battery-string breaker enclosure");
  assert.match(dse.components.find((item) => item.id === "batteryProtection").summary, /two separately purchased resettable breakers/i);
  assert.equal(dse.components.find((item) => item.id === "acBoard").title, "AC output protection");
  assert.equal(dse.components.find((item) => item.id === "toolOutlet").title, "Trailing tool lead");
  assert.match(dse.components.find((item) => item.id === "generatorInput").summary, /directly.*MultiPlus AC-in/i);
  assert.match(dse.components.find((item) => item.id === "generatorInput").summary, /no fixed wall inlet box/i);
  assert.match(dse.components.find((item) => item.id === "pvSafety").specs.join(" "), /2 complete string-pair inputs/i);
  assert.match(dse.components.find((item) => item.id === "pvSafety").specs.join(" "), /1 combined positive\/negative output pair/i);
  assert.match(dse.components.find((item) => item.id === "starlink").summary, /single OEM 15 m white DC power cable/i);
  assert.match(dse.components.find((item) => item.id === "fuseBlock").summary, /MidNite 20 A high-interrupt service feeder/i);
  assert.match(dse.components.find((item) => item.id === "fuseBlock").summary, /five lower-cost CHTAIXI breakers/i);
  assert.match(dse.components.find((item) => item.id === "fuseBlock").summary, /black load conductors return unswitched and unbroken/i);
  assert.match(dse.bom.find((item) => item.id === "dse-tool-lead").item, /trailing tool lead/i);
  assert.doesNotMatch(JSON.stringify(dse), /workshop outlets/i);
  assert.deepEqual(dse.diagram.views.overview.regions[0].memberIds, ["mainDc", "mounting"]);
  assert.deepEqual(dse.diagram.views.detail.regions[0].memberIds, [
    "positiveBus",
    "mpptFuse",
    "smartShunt",
    "negativeBus",
    "returnBus",
    "fuseBlock",
    "ekranoFuse",
    "loadSwitches",
    "unifiPower",
    "mounting",
  ]);
  assert.ok(dse.diagram.views.detail.nodes.some((node) => node.id === "smartShunt"));
  assert.ok(dse.diagram.views.detail.nodes.some((node) => node.id === "positiveBus"));
  assert.ok(dse.diagram.views.detail.nodes.some((node) => node.id === "negativeBus"));
  assert.ok(dse.diagram.views.detail.nodes.some((node) => node.id === "returnBus"));
  assert.ok(dse.diagram.views.detail.nodes.some((node) => node.id === "earthBus"));
  assert.ok(dse.diagram.views.detail.nodes.some((node) => node.id === "batteryBreakerA"));
  assert.ok(dse.diagram.views.detail.nodes.some((node) => node.id === "batteryBreakerB"));
  assert.ok(dse.diagram.views.detail.nodes.some((node) => node.id === "mpptFuse"));
  assert.ok(dse.diagram.views.detail.nodes.some((node) => node.id === "ekranoFuse"));
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "solarController" && edge.to === "mpptFuse"));
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "mpptFuse" && edge.to === "positiveBus"));
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "positiveBus" && edge.to === "ekranoFuse"));
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "ekranoFuse" && edge.to === "systemMonitor"));
  assert.ok(!dse.diagram.views.detail.edges.some((edge) => /100 A breaker|3\.15 A fuse/i.test(edge.label)));
  const detailNodeIds = new Set(dse.diagram.views.detail.nodes.map((node) => node.id));
  const aggregateComponentIds = new Set(["array", "batteryBank", "batteryProtection", "mainDc", "essentialLoads"]);
  assert.deepEqual(
    dse.components
      .filter((component) => !aggregateComponentIds.has(component.id) && !detailNodeIds.has(component.id))
      .map((component) => component.id),
    [],
  );
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "smartShunt" && edge.to === "negativeBus"));
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "negativeBus" && edge.to === "returnBus"));
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "earth" && edge.to === "earthBus"));
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.from === "smartShunt" && edge.to === "systemMonitor"));
  assert.ok(!dse.diagram.views.detail.nodes.some((node) => node.id === "mainDc"));
  assert.equal(dse.components.find((item) => item.id === "router").title, "UniFi Express");
  assert.equal(dse.bom.find((item) => item.id === "dse-router").procurement, "Purchased");
  assert.equal(dse.bom.find((item) => item.id === "dse-ekrano-gx").unitCost, 563.55);
  assert.equal(dse.bom.find((item) => item.id === "dse-ekrano-gx").procurement, "Purchased");
  assert.equal(dse.bom.find((item) => item.id === "dse-smartsolar").unitCost, 476);
  assert.equal(dse.bom.find((item) => item.id === "dse-smartsolar").procurement, "Purchased");
  assert.equal(dse.bom.find((item) => item.id === "dse-dielectric-grease").unitCost, 10.49);
  assert.equal(dse.bom.find((item) => item.id === "dse-dielectric-grease").productUrl, "https://www.amazon.com/dp/B000AL8VD2");
  assert.ok(!dse.bom.some((item) => item.id === "dse-mppt-wirebox"));
  assert.equal(dse.bom.find((item) => item.id === "dse-shunt").unitCost, 98.93);
  assert.match(dse.bom.find((item) => item.id === "dse-shunt").item, /IP65/);
  assert.equal(dse.bom.find((item) => item.id === "dse-orion-spare").totalUsd, 174.87);
  assert.match(dse.bom.find((item) => item.id === "dse-orion-spare").description, /uninstalled spare/i);
  assert.equal(dse.bom.find((item) => item.id === "dse-light-spare").totalUsd, 23.99);
  assert.equal(dse.bom.find((item) => item.id === "dse-amazon-promotion").totalUsd, -85.82);
  assert.equal(dse.bom.find((item) => item.id === "dse-us-sales-tax").totalUsd, 191.07);
  assert.equal(dse.bom.find((item) => item.id === "dse-amazon-shipping").totalUsd, 11.61);
  assert.deepEqual(
    {
      qty: dse.bom.find((item) => item.id === "dse-main-busbars").qty,
      total: dse.bom.find((item) => item.id === "dse-main-busbars").totalUsd,
      url: dse.bom.find((item) => item.id === "dse-main-busbars").productUrl,
    },
    { qty: 1, total: 89.99, url: "https://www.amazon.com/dp/B0DG4WLVT7" },
  );
  assert.ok(!dse.bom.some((item) => item.id === "dse-main-busbar-covers"));
  assert.equal(dse.bom.find((item) => item.id === "dse-service-return-bus").qty, 1);
  assert.equal(dse.bom.find((item) => item.id === "dse-earth-busbar").productUrl, "https://www.amazon.com/dp/B00821YF1E");
  assert.equal(dse.bom.find((item) => item.id === "dse-pv-protection").productUrl, "https://www.amazon.com/dp/B0FSQB97T2");
  assert.equal(dse.bom.find((item) => item.id === "dse-pv-protection").procurement, "Purchased");
  assert.equal(dse.bom.find((item) => item.id === "dse-switch-internet").productUrl, "https://www.amazon.com/dp/B000MMC8OM");
  assert.equal(dse.bom.find((item) => item.id === "dse-switch-lights").productUrl, "https://www.amazon.com/dp/B000Y87W54");
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
  assert.equal(dse.batteryCablePlan.assemblies.reduce((sum, item) => sum + item.qty, 0), 11);
  assert.equal(dse.bom.find((item) => item.id === "dse-balancers").qty, 2);
  assert.ok(dse.bom.some((item) => item.id === "dse-battery-string-breakers"));
  assert.ok(dse.bom.some((item) => item.id === "dse-battery-breaker-enclosure"));
  assert.ok(!dse.bom.some((item) => item.id === "dse-selector"));
  assert.ok(!dse.bom.some((item) => /Class T/i.test(item.item)));
  assert.ok(!dse.bom.some((item) => item.id === "dse-bp"));
  assert.ok(!dse.bom.some((item) => /Cerbo GX|GX Touch/i.test(item.item)));
  assert.ok(!dse.bom.some((item) => /Growatt|MikroTik|Mean Well/i.test(item.item)));

  assert.equal(delivery.checkedOn, "2026-08-21");
  assert.equal(delivery.destination, "Los Angeles, CA 90065");
  assert.deepEqual(Object.keys(delivery.items).sort(), dse.bom.map((item) => item.id).sort());
  assert.equal(delivery.items["dse-ekrano-gx"].amazonStatus, "purchased");
  assert.equal(delivery.items["dse-multiplus"].amazonStatus, "not-applicable");
  assert.match(delivery.items["dse-multiplus"].note, /purchased in Fiji/i);
  assert.equal(dse.bom.find((item) => item.id === "dse-multiplus").location, "Fiji");
  assert.equal(dse.bom.find((item) => item.id === "dse-multiplus").procurement, "Deposit paid");
  assert.equal(dse.bom.find((item) => item.id === "dse-multiplus").paidFraction, 0.2);
  assert.equal(delivery.items["dse-battery-cable"].sourceLabel, "BatteryCablesUSA");
  assert.equal(delivery.items["dse-battery-string-breakers"].amazonStatus, "purchased");
  assert.equal(delivery.items["dse-battery-string-breakers"].eta, "Aug 26–28");
  assert.equal(delivery.items["dse-ex-labor"].amazonStatus, "not-applicable");
  assert.equal(delivery.items["dse-smartsolar"].amazonStatus, "purchased");
  assert.equal(delivery.items["dse-smartsolar"].eta, "Expected Aug 24");
  assert.equal(delivery.items["dse-dielectric-grease"].amazonStatus, "purchased");
  assert.equal(delivery.items["dse-dielectric-grease"].eta, "Aug 22");
  assert.equal(delivery.items["dse-orion-spare"].amazonStatus, "purchased");
  assert.equal(delivery.items["dse-pv-protection"].amazonStatus, "purchased");

  const customsItems = dse.bom.filter(
    (item) => item.location === "Import" && customs.itemMeta[item.id],
  );
  const customsGrossGoodsTotal = customsItems.reduce((sum, item) => sum + item.totalUsd, 0);
  const customsOrderDiscount = dse.bom.find((item) => item.id === "dse-amazon-promotion").totalUsd;
  assert.equal(Number(customsGrossGoodsTotal.toFixed(2)), 3072.88);
  assert.equal(Number((customsGrossGoodsTotal + customsOrderDiscount).toFixed(2)), 2987.06);
  assert.equal(customs.vatRate, 0.125);
  assert.equal(
    Object.values(customs.itemMeta).filter((item) => item.tafPermitRequired).length,
    5,
  );
  assert.equal(customs.itemMeta["dse-multiplus"].model, "PMP242305010");
  assert.equal(customs.itemMeta["dse-router"].model, "Ubiquiti UniFi Express UX-US");
  assert.ok(customs.sources.some((source) => source.id === "taf-permit" && /taf\.org\.fj/.test(source.url)));
  assert.ok(customs.sources.some((source) => source.id === "charity-concession"));

  assert.equal(physicalModel.scale, "1 scene unit = 1 metre");
  assert.match(physicalModel.revision, /R15/);
  assert.equal(physicalModel.scene.plannedPvHomeRunM, 15);
  assert.deepEqual(physicalModel.scene.arrayOrientation, { azimuth: "north", tiltDeg: 18 });
  assert.ok(physicalModel.scene.illustratedPvRouteM < physicalModel.scene.plannedPvHomeRunM);
  assert.ok(physicalModel.scene.wallCableStandOffMm <= 40);
  assert.deepEqual(physicalModel.scene.wallCableRoutingEnvelopeMm, [35, 245]);
  assert.equal(physicalModel.scene.batteryRack, false);
  assert.match(physicalModel.scene.batteryArrangement, /floor.*2 × 2/i);
  assert.equal(physicalModel.scene.sideWallPlanes, false);
  assert.equal(physicalModel.scene.roofPlane, false);
  assert.match(physicalModel.scene.batteryBreakerMounting, /finger-safe enclosure/i);
  assert.match(physicalModel.scene.heavyBatteryCableRoute, /cable-clearance solver/i);
  assert.match(physicalModel.scene.junctionCableEntries, /14 cable glands plus one Starlink bulkhead DC jack/i);
  assert.match(physicalModel.scene.junctionCableEntries, /33 service circuits comprise 35 optimized/i);
  assert.match(physicalModel.scene.junctionCableEntries, /bottom face/i);
  assert.match(physicalModel.scene.junctionMounting, /zero cable routes behind/i);
  assert.match(physicalModel.scene.layoutSolver, /independently generates/i);
  assert.match(physicalModel.scene.layoutSolver, /collision-aware.*bundle/i);
  assert.match(physicalModel.scene.cableGeometry, /continuous tube/i);
  assert.match(physicalModel.scene.cableGeometry, /corner-contained bends/i);
  assert.match(physicalModel.scene.cableGeometry, /seamless adjacent corners/i);
  assert.match(physicalModel.scene.cableGeometry, /tangent render handoffs/i);
  assert.match(physicalModel.scene.ceilingCableRouting, /one thin white two-conductor Starlink OEM cable/i);
  assert.match(physicalModel.scene.ceilingCableRouting, /source-side switching/i);
  assert.match(physicalModel.scene.cameraControls, /ofxGrabCam-inspired/i);
  assert.match(physicalModel.scene.cameraControls, /XYZ surface point under mouse or touch/i);
  assert.match(physicalModel.scene.cameraControls, /upright world-Y yaw and pitch/i);
  assert.match(physicalModel.scene.cameraControls, /one touch orbits and two touches pan plus pinch-zoom/i);
  assert.match(physicalModel.connectionAudit.rule, /no nominal-24 V conductor lands directly/i);
  assert.match(physicalModel.connectionAudit.rule, /no protective-earth conductor ends in open space/i);
  assert.equal(physicalModel.connectionAudit.protectiveEarth.connections.length, 6);
  assert.deepEqual(physicalModel.connectionAudit.unifiExpress.ports, ["USB-C power", "WAN", "LAN"]);
  assert.ok(dse.diagram.views.detail.edges.some((edge) => edge.id === "dt-unifi-usbc"));
  assert.deepEqual(dse.diagram.views.detail.canvas, { width: 3456, height: 2059 });
  assert.ok(dse.diagram.views.detail.nodes.find((node) => node.id === "systemMonitor").x >= 2200);
  assert.ok(!dse.diagram.views.detail.edges.some((edge) => edge.id === "dt-usb-router"));
  assert.ok(!dse.diagram.views.detail.edges.some((edge) => edge.id === "dt-router"));
  assert.match(dse.components.find((item) => item.id === "loadSwitches").summary, /fixed left sidewall/i);
  assert.match(dse.components.find((item) => item.id === "loadSwitches").note, /load negatives bypass/i);
  assert.equal(dse.bom.find((item) => item.id === "dse-indoor-light").unitCost, 23.99);
  assert.equal(dse.bom.find((item) => item.id === "dse-outdoor-light").unitCost, 23.99);
  assert.equal(dse.bom.find((item) => item.id === "dse-indoor-light").productUrl, "https://www.amazon.com/dp/B0F1V59NXC");
  assert.equal(dse.bom.find((item) => item.id === "dse-outdoor-light").productUrl, "https://www.amazon.com/dp/B0F1V59NXC");
  assert.equal(delivery.items["dse-indoor-light"].amazonStatus, "purchased");
  assert.equal(delivery.items["dse-outdoor-light"].amazonStatus, "purchased");
  assert.equal(physicalModel.connectionAudit.orion, undefined);
  assert.equal(dse.bom.find((item) => item.id === "dse-usb").unitCost, 51.01);
  assert.equal(dse.bom.find((item) => item.id === "dse-usb-mixed").qty, 2);
  assert.match(dse.bom.find((item) => item.id === "dse-usb-mixed").description, /4 × USB-C PD and 2 × USB-A/i);
  assert.equal(dse.bom.find((item) => item.id === "dse-unifi-converter").unitCost, 8.99);
  assert.equal(dse.bom.find((item) => item.id === "dse-unifi-converter").productUrl, "https://www.amazon.com/dp/B0G1W6JTX8");
  assert.equal(dse.bom.find((item) => item.id === "dse-unifi-usb-cable").unitCost, 4.88);
  assert.equal(dse.bom.find((item) => item.id === "dse-vedirect-cables").qty, 2);
  assert.equal(dse.bom.find((item) => item.id === "dse-vedirect-cables").unitCost, 17.8);
  assert.equal(dse.bom.find((item) => item.id === "dse-vebus-cable").unitCost, 9.99);
  assert.equal(dse.bom.find((item) => item.id === "dse-ekrano-ethernet").unitCost, 9.99);
  assert.equal(dse.bom.find((item) => item.id === "dse-vedirect-cables").productUrl, "https://www.amazon.com/dp/B01F9ESFZS");
  assert.equal(dse.bom.find((item) => item.id === "dse-vebus-cable").productUrl, "https://www.amazon.com/dp/B003OCRW3E");
  assert.equal(dse.bom.find((item) => item.id === "dse-ekrano-ethernet").productUrl, "https://www.amazon.com/dp/B003OCRW34");
  assert.equal(dse.bom.find((item) => item.id === "dse-starlink-ethernet").productUrl, "https://www.amazon.com/dp/B0D8J3HC7Z");
  assert.equal(dse.bom.find((item) => item.id === "dse-cat6-blue-spare").productUrl, "https://www.amazon.com/dp/B000KSEJV8");
  assert.ok(!dse.bom.some((item) => item.id === "dse-victron-data"));
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
  assert.deepEqual(
    physicalModel.envelopes.find((item) => item.id === "battery-breaker-enclosure").dimensionsMm,
    { width: 172, height: 200, depth: 110 },
  );
  assert.equal(
    physicalModel.envelopes.find((item) => item.id === "ekrano-junction-box").status,
    "user-specified",
  );
  assert.ok(physicalModel.envelopes.filter((item) => item.status === "verified").length >= 9);
});
