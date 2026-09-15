import assert from "node:assert/strict";
import test from "node:test";
import system from "../data/polowat-system.json";
import { polowatDeviceById, polowatTopology } from "../app/polowatTopology";
import { copperVoltageDrop, batteryPathVoltageDrop } from "../app/polowatElectrical";
import { planningEstimate } from "../app/planningEstimate";
import { polowatEnclosure } from "../app/polowatEnclosure";

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

test("Los Angeles tax applies to priced imports while preserving pre-tax cart and item prices", () => {
  assert.equal(system.taxEstimate.ratePercent, 9.75);
  assert.equal(system.taxEstimate.jurisdiction, "City of Los Angeles, California");
  assert.deepEqual(planningEstimate(system.bom, system.taxEstimate), {
    subtotalUsd: 2033.09, taxableSubtotalUsd: 1333.09, taxUsd: 129.98, totalUsd: 2163.07,
  });
  const local = system.bom.filter(item => item.location === "Buy in Chuuk");
  assert.deepEqual(planningEstimate(local, system.taxEstimate), {
    subtotalUsd: 700, taxableSubtotalUsd: 0, taxUsd: 0, totalUsd: 700,
  });
  const cart = system.cartStaging.items.map(item => ({ totalUsd: item.totalUsd, location: "Import to Chuuk" }));
  assert.deepEqual(planningEstimate(cart, system.taxEstimate), {
    subtotalUsd: 907.15, taxableSubtotalUsd: 907.15, taxUsd: 88.45, totalUsd: 995.60,
  });
});

test("planning tax rounds the aggregate base and leaves projects without a tax policy unchanged", () => {
  const items = [{ totalUsd: .06, location: "Import to Chuuk" }, { totalUsd: .06, location: "Import to Chuuk" },
    { totalUsd: 20, location: "Buy in Chuuk" }, { totalUsd: 0, location: "Import to Chuuk" }];
  assert.deepEqual(planningEstimate(items, system.taxEstimate), {
    subtotalUsd: 20.12, taxableSubtotalUsd: .12, taxUsd: .01, totalUsd: 20.13,
  });
  assert.deepEqual(planningEstimate(items), {
    subtotalUsd: 20.12, taxableSubtotalUsd: 0, taxUsd: 0, totalUsd: 20.12,
  });
});

test("compact Polowat planning totals reconcile by procurement location", () => {
  const total = roundMoney(system.bom.reduce((sum, item) => sum + item.totalUsd, 0));
  const imported = roundMoney(system.bom.filter((item) => item.location === "Import to Chuuk")
    .reduce((sum, item) => sum + item.totalUsd, 0));
  const local = roundMoney(system.bom.filter((item) => item.location === "Buy in Chuuk")
    .reduce((sum, item) => sum + item.totalUsd, 0));
  const importedKg = system.bom.filter((item) => item.location === "Import to Chuuk")
    .reduce((sum, item) => sum + item.totalWeightKg, 0);
  const localKg = system.bom.filter((item) => item.location === "Buy in Chuuk")
    .reduce((sum, item) => sum + item.totalWeightKg, 0);

  for (const item of system.bom) assert.equal(roundMoney(item.qty * item.unitCost), item.totalUsd);
  assert.equal(system.bom.filter(item => item.priceBasis.startsWith("Unpriced")).length, 3);
  assert.equal(new Set(system.bom.map(item => item.id)).size, system.bom.length);
  assert.equal(roundMoney(imported + local), total);
  assert.equal(Number(importedKg.toFixed(2)), system.deploymentModel.shipping.importedNetKg);
  assert.equal(Number(localKg.toFixed(2)), system.deploymentModel.shipping.localEquipmentKg);
  assert.equal(system.deploymentModel.shipping.importedPackedKg, Number((importedKg * 1.15).toFixed(1)));
  assert.equal(system.deploymentModel.shipping.batteryKg, 84);
  assert.equal(system.deploymentModel.shipping.totalInstalledKg, roundMoney(importedKg + localKg));
});

test("three-panel energy model retains margin for the stated direct-DC load", () => {
  const panels = system.bom.find((item) => item.id === "polowat-panels");
  assert.ok(panels);
  assert.equal(panels.qty, 3);
  assert.match(panels.description, /300 W, 62\.1 Vmp, 73\.2 V Voc, 4\.84 A Imp and 5\.16 A Isc/);
  assert.equal(system.powerModel.arrayWatts, 300);
  assert.equal(system.powerModel.averageSolarKwhDay, 0.9);
  assert.equal(system.powerModel.modeledLoadKwhDay, 0.52);
  assert.equal(system.powerModel.peakLoadWatts, 165);
  assert.equal(system.powerModel.usableBatteryKwh, 1.8);
  assert.equal(system.powerModel.oneBatteryUsableKwh, 0.9);
  assert.equal(system.deploymentModel.loadBudget.reduce((sum, row) => sum + row.wattHoursPerDay, 0), 520);
  assert.equal(2 * 100 * 4 * 0.75 - 520, 80, "two panels leave only 80 Wh/day of modeled margin");
  assert.equal(3 * 100 * 4 * 0.75 - 520, 380);
});

test("Polowat diagram and 3D model share one minimal protected topology", () => {
  assert.equal(polowatTopology.devices.length, 20);
  assert.equal(polowatTopology.connections.length, 25);
  assert.equal(polowatDeviceById.size, polowatTopology.devices.length);
  assert.ok(polowatTopology.connections.every((connection) => (
    polowatDeviceById.has(connection.from) && polowatDeviceById.has(connection.to)
  )));
  assert.ok(polowatTopology.connections.every((connection) => connection.diagramRoute));

  assert.deepEqual(polowatTopology.devices.filter((device) => device.kind === "panel").map((device) => device.id),
    ["panel1", "panel2", "panel3"]);
  assert.equal(polowatTopology.devices.filter((device) => device.kind === "battery").length, 2);
  assert.deepEqual(polowatDeviceById.get("equipmentEnclosure")?.size.map(value => Number(value.toFixed(5))), [.24638, .35052, .14986]);
  assert.equal(polowatDeviceById.get("mppt")?.size.join("×"), "0.131×0.1×0.06");

  const ids = new Set(polowatTopology.connections.map((connection) => connection.id));
  for (const id of [
    "panel-series-1", "panel-series-2", "pv-home-positive", "pv-home-negative",
    "battery-a-positive", "battery-a-positive-bus", "battery-a-negative",
    "battery-b-positive", "battery-b-positive-bus", "battery-b-negative",
    "mppt-load-positive", "mppt-load-negative", "starlink-regulated", "usb-device-leads",
  ]) assert.ok(ids.has(id), `missing ${id}`);

  assert.equal(polowatDeviceById.get("batteryBreakerA")?.subtitle, "30 A non-polarized · at battery");
  assert.equal(polowatDeviceById.get("batteryBreakerB")?.subtitle, "30 A non-polarized · at battery");
  assert.equal(polowatDeviceById.get("pvBreaker")?.subtitle, "10 A polarized · two-pole");
  assert.equal(polowatDeviceById.get("controllerBreaker")?.subtitle, "30 A non-polarized · bus end");
  assert.equal(polowatDeviceById.get("starlinkBreaker")?.subtitle, "10 A breaker");
  assert.equal(polowatDeviceById.get("usbBreaker")?.subtitle, "10 A breaker");

  const labels = polowatTopology.devices.map((device) => `${device.id} ${device.label}`).join(" ").toLowerCase();
  assert.doesNotMatch(labels, /inverter|combiner|shunt|unifi/);
  const fieldGauges = new Set(polowatTopology.connections.map((connection) => connection.gauge)
    .filter((gauge) => !/panel leads|factory/i.test(gauge)));
  assert.deepEqual([...fieldGauges].sort(), ["10 AWG DC", "10 AWG PV", "12 AWG DC", "8 AWG DC"]);
});


test("every modeled conductor is covered once by the electrical survey", () => {
  const surveyed = system.electricalAudit.circuits.flatMap(circuit => circuit.connectionIds);
  assert.equal(new Set(surveyed).size, surveyed.length);
  assert.deepEqual([...surveyed].sort(), polowatTopology.connections.map(c => c.id).sort());
  for (const circuit of system.electricalAudit.circuits) {
    if (!circuit.areaMm2) continue;
    for (const id of circuit.connectionIds) {
      assert.equal(polowatTopology.connections.find(c => c.id === id)?.gauge, circuit.gauge);
    }
  }
});

test("owner route limits use mixed battery/controller gauges and short converter branches", () => {
  const { assumptions: a, circuits } = system.electricalAudit;
  const power = system.powerModel;
  assert.equal(power.chargeCurrentLimitA, 20);
  assert.equal(power.loadOutputLimitA, 20);
  assert.ok(power.arrayWatts / a.designDisconnectV > power.chargeCurrentLimitA, "controller clipping is required at low battery voltage");
  assert.ok(72 / a.converterEfficiency + 78 < power.peakLoadWatts);
  assert.ok(power.peakLoadWatts / a.designDisconnectV < power.loadOutputLimitA);
  for (const id of ["starlink-input", "usb-input"]) {
    const c = circuits.find(c => c.id === id)!;
    assert.ok(c.designCurrentA! < .8 * 10, `${id} stays below 80% of its 10 A breaker under the declared assumptions`);
  }
  const path = a.batteryBranchOneWayM + a.controllerOneWayM;
  const drop = batteryPathVoltageDrop(a.batteryBranchOneWayM, a.controllerOneWayM, 20, a.batteryAreaMm2, a.controllerAreaMm2);
  assert.ok(drop / a.designDisconnectV < .03);
  assert.ok(copperVoltageDrop(path, 20, 5.26) / a.designDisconnectV > .03, "10 AWG throughout no longer meets the longer route target");
  assert.ok(batteryPathVoltageDrop(4, a.controllerOneWayM, 20, a.batteryAreaMm2, a.controllerAreaMm2) / a.designDisconnectV > .03);
  assert.equal(a.batteryBranchOneWayM, 2);
  assert.ok(a.sharedLoadOneWayM + a.branchOneWayM <= 1);
  const sharedDrop = copperVoltageDrop(a.sharedLoadOneWayM, 20, a.loadAreaMm2);
  const worstBranch = circuits.find(c => c.id === "starlink-input")!;
  assert.ok(a.designDisconnectV - sharedDrop - copperVoltageDrop(a.branchOneWayM, worstBranch.designCurrentA!, a.loadAreaMm2) > a.minimumConverterInputV);
  assert.ok(a.controllerAreaMm2 <= 6, "controller terminal area limit");
  assert.ok(a.mainProtectionA >= 25 && a.mainProtectionA <= 30, "Victron protection interval");
  assert.match(system.electricalAudit.holds.join(" "), /backfeed/);
  for (const connection of polowatTopology.connections.filter(c => c.from === "loadSplit" || c.to === "loadSplit")) {
    assert.equal(connection.gauge, "12 AWG DC", "LOAD distribution retains 12 AWG");
    assert.notEqual(connection.to, "negativeBus", "LOAD return must not bypass output switching");
  }
});

test("round-trip voltage-drop calculation scales with length/current and inverse area", () => {
  assert.equal(copperVoltageDrop(1, 20, 4, 20), .17500000000000002);
  assert.equal(copperVoltageDrop(0, 20, 4), 0);
  assert.equal(copperVoltageDrop(2, 20, 4), 2 * copperVoltageDrop(1, 20, 4));
  assert.equal(copperVoltageDrop(1, 20, 8), copperVoltageDrop(1, 20, 4) / 2);
  assert.throws(() => copperVoltageDrop(1, 20, 0), RangeError);
});

test("cart snapshot reconciles exact packages and never marks staging as paid", () => {
  const expected = new Map<string, number>();
  let subtotal = 0;
  for (const row of system.bom) {
    assert.doesNotMatch(row.procurement, /Purchased/);
    const asin = "amazonAsin" in row ? row.amazonAsin : undefined;
    if (!row.cartQuantity) continue;
    assert.ok(asin);
    assert.equal(row.productUrl, `https://www.amazon.com/dp/${asin}`);
    expected.set(asin, (expected.get(asin) ?? 0) + row.cartQuantity);
    const staged = system.cartStaging.items.find(item => item.asin === asin)!;
    assert.equal(row.unitCost, staged.unitPriceUsd);
    subtotal += staged.unitPriceUsd * row.cartQuantity;
  }
  assert.deepEqual(system.cartStaging.pendingChanges.remove, []);
  assert.deepEqual(system.cartStaging.pendingChanges.add, []);
  assert.deepEqual(Object.fromEntries(expected), Object.fromEntries(system.cartStaging.items.map(row => [row.asin, row.quantity])));
  assert.equal(roundMoney(subtotal), system.cartStaging.itemSubtotalUsd);
  assert.equal(expected.size, system.cartStaging.distinctAsins);
  assert.equal([...expected.values()].reduce((sum, q) => sum + q, 0), system.cartStaging.retailQuantity);
  assert.ok(!system.bom.some(r => r.id === "polowat-terminal-guard"));
  assert.equal(system.bom.find(r => r.id === "polowat-controller-breaker")?.cartQuantity, 0);
  assert.ok(!expected.has("B09H4WPKJW"), "superseded battery breakers removed");
  assert.ok(!expected.has("B0H2V2JNPS"), "superseded PG11-only pack removed");
});

test("reference enclosure is deferred and bench spacing does not claim a fitted mounting layout", () => {
  const { parts, bench: mounting, controllerClearance: clearance } = polowatEnclosure;
  assert.equal(polowatEnclosure.mounting, null);
  assert.equal(polowatEnclosure.layoutStatus, "bench-assembly-pending");
  assert.deepEqual(system.enclosurePlan.outerInches, [13.8, 9.7, 5.9]);
  const enclosure = system.bom.find(row => row.id === "polowat-enclosure")!;
  assert.equal(enclosure.amazonAsin, "B0CT5LRGRF");
  assert.equal(enclosure.cartQuantity, 0);
  assert.equal(enclosure.excludeFromCart, true);
  assert.match(enclosure.procurement, /Deferred/);
  assert.ok(!system.cartStaging.items.some(row => row.asin === enclosure.amazonAsin));
  assert.ok(!system.cartStaging.recheck.targetItems.some(row => ["B0CT5LRGRF", "B092QL1745", "B09N3RK1KG"].includes(row.asin)));
  assert.deepEqual(system.cartStaging.pendingChanges.deferredBomIds, [enclosure.id]);
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const part of parts) {
    assert.ok(part.x >= 0 && part.y >= 0 && part.x + part.width <= mounting.width && part.y + part.height <= mounting.height, part.id);
    if (part.id !== "mppt") assert.ok(!overlaps(part, clearance), `${part.id} intrudes into controller cooling column`);
    for (const other of parts.filter(other => other.id !== part.id)) assert.ok(!overlaps(part, other), `${part.id} / ${other.id}`);
  }
  const mppt = parts.find(p => p.id === "mppt")!;
  assert.equal(mppt.y - clearance.y, 100);
  assert.equal(clearance.y + clearance.height - mppt.y - mppt.height, 100);
  assert.ok(!system.bom.some(r => /MidNite|MNEDC/.test(r.item)));
  assert.ok(!system.bom.some(r => r.id === "polowat-vents"));
  assert.match(system.bom.find(r => r.id === "polowat-battery-breakers")!.procurement, /Hold/);
  assert.match(system.bom.find(r => r.id === "polowat-usb-a-extension")!.procurement, /Staged/);
});


test("staged DC coils cover both batteries and both short loads without local DC allowances", () => {
  const rows = system.bom.filter(row => "wireStock" in row && row.wireStock);
  for (const color of ["red", "black"]) {
    const stock = (awg: number) => rows.filter(row => row.wireStock?.awg === awg && [color, "red-and-black"].includes(row.wireStock?.color ?? ""))
      .reduce((sum, row) => sum + (row.wireStock?.lengthM ?? 0) * row.qty, 0);
    assert.ok(stock(8) >= 2 * system.electricalAudit.assumptions.batteryBranchOneWayM);
    assert.ok(stock(10) >= system.electricalAudit.assumptions.pvOneWayM + system.electricalAudit.assumptions.controllerOneWayM + system.cableStockPlan.reservePerColourM);
    assert.ok(stock(12) >= system.electricalAudit.assumptions.sharedLoadOneWayM + 2 * system.electricalAudit.assumptions.branchOneWayM);
  }
  assert.equal(rows.length, 5);
  assert.ok(rows.every(row => row.location === "Import to Chuuk" && row.cartQuantity === 1));
  assert.deepEqual(system.bom.filter(row => row.location === "Buy in Chuuk").map(row => row.id).sort(), ["polowat-batteries"]);
});


test("shared PV stock covers both circuits once and removed splice purchases stay absent", () => {
  const plan = system.cableStockPlan;
  assert.equal(Number((plan.pvRoutePerColourM + plan.controllerRoutePerColourM + plan.reservePerColourM).toFixed(3)), plan.lengthPerColourM);
  assert.equal(plan.areaForCalculationsMm2, 5.26);
  assert.equal(system.electricalAudit.circuits.find(c => c.id === "pv-home")?.areaMm2, plan.areaForCalculationsMm2);
  for (const asin of ["B00DGXVO80", "B0CJ5QF4Z2", "B01MEE7KL3", "B000NV2CV6", "B000NV0D08"]) {
    assert.ok(!system.cartStaging.items.some(row => row.asin === asin));
  }
  assert.equal(polowatDeviceById.get("loadSplit")?.bomId, "polowat-din-distribution");
  assert.ok(!system.bom.some(row => row.id === "polowat-pv-splice-housing"));
});
