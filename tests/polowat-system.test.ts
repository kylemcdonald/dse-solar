import assert from "node:assert/strict";
import test from "node:test";
import system from "../data/polowat-system.json";
import { polowatDeviceById, polowatTopology } from "../app/polowatTopology";

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

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

  assert.equal(system.bom.length, 21);
  assert.equal(total, 2096.87);
  assert.equal(imported, 1326.87);
  assert.equal(local, 770);
  assert.equal(roundMoney(imported + local), total);
  assert.equal(Number(importedKg.toFixed(2)), system.deploymentModel.shipping.importedNetKg);
  assert.equal(Number(localKg.toFixed(1)), system.deploymentModel.shipping.localEquipmentKg);
  assert.equal(system.deploymentModel.shipping.importedPackedKg, 24.7);
  assert.equal(system.deploymentModel.shipping.batteryKg, 84);
  assert.equal(system.deploymentModel.shipping.totalInstalledKg, 107.18);
});

test("three-panel energy model retains margin for the stated direct-DC load", () => {
  const panels = system.bom.find((item) => item.id === "polowat-panels");
  assert.ok(panels);
  assert.equal(panels.qty, 3);
  assert.match(panels.description, /300 W, 62\.1 Vmp, 73\.2 V Voc, 4\.84 A Imp and 5\.16 A Isc/);
  assert.equal(system.powerModel.arrayWatts, 300);
  assert.equal(system.powerModel.averageSolarKwhDay, 0.9);
  assert.equal(system.powerModel.modeledLoadKwhDay, 0.52);
  assert.equal(system.powerModel.peakLoadWatts, 150);
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
  assert.equal(polowatDeviceById.get("equipmentEnclosure")?.size.join("×"), "0.6×0.52×0.18");
  assert.equal(polowatDeviceById.get("mppt")?.size.join("×"), "0.131×0.1×0.06");

  const ids = new Set(polowatTopology.connections.map((connection) => connection.id));
  for (const id of [
    "panel-series-1", "panel-series-2", "pv-home-positive", "pv-home-negative",
    "battery-a-positive", "battery-a-positive-bus", "battery-a-negative",
    "battery-b-positive", "battery-b-positive-bus", "battery-b-negative",
    "mppt-load-positive", "mppt-load-negative", "starlink-regulated", "usb-device-leads",
  ]) assert.ok(ids.has(id), `missing ${id}`);

  assert.equal(polowatDeviceById.get("batteryBreakerA")?.subtitle, "25 A · positive · battery-adjacent");
  assert.equal(polowatDeviceById.get("batteryBreakerB")?.subtitle, "25 A · positive · battery-adjacent");
  assert.equal(polowatDeviceById.get("pvBreaker")?.subtitle, "10 A · two-pole · ≥100 VDC");
  assert.equal(polowatDeviceById.get("controllerBreaker")?.subtitle, "25 A battery-side");
  assert.equal(polowatDeviceById.get("starlinkBreaker")?.subtitle, "10 A breaker");
  assert.equal(polowatDeviceById.get("usbBreaker")?.subtitle, "10 A breaker");

  const labels = polowatTopology.devices.map((device) => `${device.id} ${device.label}`).join(" ").toLowerCase();
  assert.doesNotMatch(labels, /inverter|combiner|shunt|unifi/);
  const fieldGauges = new Set(polowatTopology.connections.map((connection) => connection.gauge)
    .filter((gauge) => !/panel leads|factory/i.test(gauge)));
  assert.deepEqual([...fieldGauges].sort(), ["4 mm² DC", "4 mm² PV"]);
});
