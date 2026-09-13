import { expect, test } from "@playwright/test";
import runtime from "../data/generated/dse-runtime.json" with { type: "json" };
import diagrams from "../data/generated/diagram-layouts.json" with { type: "json" };
import system from "../data/dse-system.json" with { type: "json" };

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.goto("/", { timeout: 120_000 });
  await expect(page.locator(".app-shell")).toHaveAttribute("data-viewer-ready", "true");
});

test("shell starts in DSE mode and exposes the explicit project switch", async ({ page }) => {
  await expect(page.locator(".app-shell")).toHaveAttribute("data-project", "dse-fiji");
  await expect(page.getByLabel("System design")).toContainText("DSEFiji");
  await expect(page.getByRole("button", { name: /DSE.*Fiji/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Inowon.*Polowat/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Detailed diagram" })).toBeVisible();
  await expect(page.getByRole("button", { name: "3D model" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Wire cut list" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Shipping" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Customs" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Fade purchased" })).not.toBeChecked();
  const navigation = page.getByRole("navigation", { name: "Viewer mode" });
  await expect(navigation.getByRole("button", { name: /Junction box/i })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: /AC Junction/i })).toHaveCount(0);
  await expect(page.getByText(/Pasana|PNG|PG solar/i)).toHaveCount(0);
});

test("phone toolbar stays reachable and Fit shows the whole wiring diagram", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-viewer-ready", "true");
  const fit = page.getByRole("button", { name: "Fit diagram", exact: true });
  await fit.click();
  for (const name of ["Zoom out", "Fit diagram", "Zoom in"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  const viewport = await page.locator(".unified-diagram-viewport").boundingBox();
  // Hover labels intentionally extend beyond the drawing while hidden. Check
  // the actual device bodies and routed wires that Fit must keep on screen.
  const geometry = await page.locator(".diagram-device > rect, .diagram-wire").evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().toJSON()));
  for (const drawing of geometry) {
    expect(drawing.x).toBeGreaterThanOrEqual(viewport.x);
    expect(drawing.right).toBeLessThanOrEqual(viewport.x + viewport.width);
    expect(drawing.y).toBeGreaterThanOrEqual(viewport.y);
    expect(drawing.bottom).toBeLessThanOrEqual(viewport.y + viewport.height);
  }
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect(Number(await page.locator(".unified-diagram").getAttribute("data-view-scale"))).toBeGreaterThanOrEqual(0.025);
});

test("Polowat mode exposes its independent wiring, model, energy, BOM, shipping, and cost plan", async ({ page }) => {
  await page.getByRole("button", { name: /Inowon.*Polowat/ }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-project", "inowon-polowat");
  await expect(page.getByRole("button", { name: /Inowon.*Polowat/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Wiring diagram" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Wire cut list" })).toHaveCount(0);

  const diagram = page.locator(".polowat-diagram");
  await expect(diagram).toHaveAttribute("data-system", "inowon-polowat");
  await expect(diagram).toHaveAttribute("data-device-count", "20");
  await expect(diagram).toHaveAttribute("data-connection-count", "25");
  await expect(diagram.locator(".polowat-diagram-device")).toHaveCount(19);
  await expect(diagram.locator(".polowat-wire")).toHaveCount(25);
  await expect(page.getByRole("heading", { name: "Compact system wiring" })).toBeVisible();
  await expect(page.getByText("300 W · 3S", { exact: true })).toBeVisible();
  await expect(page.getByText("12 V · 300 Ah", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inowon Sailing School compact solar network" })).toBeVisible();
  await expect(page.getByText("0.52 kWh/day", { exact: true })).toBeVisible();
  await expect(page.getByText("0.90 kWh/day", { exact: true })).toBeVisible();
  await expect(page.getByText("520 Wh/day", { exact: true })).toBeVisible();
  await expect(page.getByText("21.5 kg", { exact: true })).toBeVisible();
  await expect(page.getByText("24.7 kg", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Bill of materials/ }).click();
  await expect(page.locator("[data-bom-id]")).toHaveCount(21);
  await expect(page.locator('[data-bom-total="design"]')).toContainText("$2,096.87");
  await expect(page.locator(".bom-summary-v2")).toContainText("$1,326.87");
  await expect(page.locator(".bom-summary-v2")).toContainText("$770.00");
  await expect(page.locator('[data-bom-id="polowat-batteries"]')).toContainText("Buy in Chuuk");
  await expect(page.locator('[data-bom-id="polowat-pv-cable"]')).toContainText("Buy in Chuuk");

  await page.getByRole("button", { name: "Costs" }).click();
  await expect(page.locator(".cost-tile")).toHaveCount(21);
  await expect(page.locator(".cost-total strong")).toHaveText("$2,096.87");
  await expect(page.locator(".cost-total")).toContainText("Import hardware: $1,326.87 · buy in Chuuk: $770.00");
  await expect(page.getByRole("button", { name: /Export grant report/ })).toHaveCount(0);
  await expect(page.getByLabel("Show costs for").locator("option")).toHaveCount(2);

  await page.getByRole("button", { name: "3D model" }).click();
  const model = page.locator('.polowat-model[data-model="polowat-planning-topology"]');
  await expect(model).toHaveAttribute("data-device-count", "20", { timeout: 45_000 });
  await expect(model).toHaveAttribute("data-connection-count", "25");
  const canvas = model.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-system", "inowon-polowat");
  await expect(canvas).toHaveAttribute("data-model-status", "planning-site-inputs-pending");
});

test("wire-cut tab opens the consolidated R32 schedule in the viewer", async ({ page }) => {
  await page.getByRole("button", { name: "Wire cut list" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Wire cut list", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Field wire by size and construction" })).toBeVisible();
  await expect(page.getByText("1/0 AWG · 53.5 mm²", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("2 AWG · 33.6 mm²", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("8 AWG · 8.37 mm²", { exact: true }).first()).toBeVisible();
  // The heavy-DC plan is derived from the routed artifact, so the expected
  // totals come from the same data the page renders.
  const plan = system.batteryCablePlan;
  const gaugeTotal = (gauge) => `${plan.assemblies.filter((assembly) => assembly.gauge === gauge)
    .reduce((sum, assembly) => sum + assembly.planningLengthM * assembly.qty, 0).toFixed(2)} m`;
  await expect(page.getByText(gaugeTotal("1/0 AWG · 53.5 mm²"), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(gaugeTotal("2 AWG · 33.6 mm²"), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(gaugeTotal("8 AWG · 8.37 mm²"), { exact: true }).first()).toBeVisible();
  await expect(page.getByText("35.00 m", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Heavy-DC assembly cuts and eyelets" })).toBeVisible();
  for (const pairedRunId of ["battery-string-a-source", "battery-string-b-source", "smartsolar-dc", "multiplus-dc", "secondary-feeder"]) {
    const members = plan.assemblies.filter((assembly) => assembly.pairedRunId === pairedRunId);
    const length = `${Math.round(members[0].planningLengthM * 1000)} mm`;
    const pair = page.locator(`[data-paired-run="${pairedRunId}"]`);
    await expect(pair).toHaveCount(2);
    await expect(pair.nth(0).getByText(length, { exact: true })).toBeVisible();
    await expect(pair.nth(1).getByText(length, { exact: true })).toBeVisible();
  }
  const cutoffLink = plan.assemblies.find((assembly) => assembly.route === "smartsolar-cutoff-to-main-positive");
  await expect(page.locator('[data-cable-route="smartsolar-cutoff-to-main-positive"]'))
    .toContainText(`${Math.round(cutoffLink.planningLengthM * 1000)} mm`);
  await expect(page.getByRole("columnheader", { name: "3D route" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Order status" })).toHaveCount(0);
  await expect(page.getByText("Field conductor sizes", { exact: true })).toHaveCount(0);
  await expect(page.getByText("DIHOOL", { exact: false })).toHaveCount(0);
});

test("detailed diagram and canonical counts render", async ({ page }) => {
  const diagram = page.locator(".unified-diagram");
  await expect(diagram).toHaveAttribute("data-device-count", String(runtime.devices.length));
  await expect(diagram).toHaveAttribute("data-wire-count", String(runtime.routes.length));
  await expect(diagram).toHaveAttribute("data-layout-source", "build-generated-artifact");
  await expect(diagram).toHaveAttribute("data-junctions-abstracted", "true");
  // 57 world devices plus one bodyless fan per supply pair that enters an enclosure.
  await expect(diagram).toHaveAttribute("data-visible-device-count", String(diagrams.layouts.system.nodes.length));
  await expect(diagram).toHaveAttribute("data-visible-wire-count", String(diagrams.layouts.system.wires.length));
  await expect(diagram).toHaveAttribute("data-routing-fallbacks", "0");
  await expect(diagram).toHaveAttribute("data-coincident-wire-segments", "0");
  await expect(diagram).toHaveAttribute("data-non-orthogonal-wire-segments", "0");
  await expect(diagram).toHaveAttribute("data-conductor-overlaps", "0");
  await expect(diagram).toHaveAttribute("data-unbridged-wire-crossings", "0");
  await expect(diagram).toHaveAttribute("data-parallel-wire-envelope-overlaps", "0");
  await expect(diagram).toHaveAttribute("data-minimum-parallel-wire-separation", "12");
  await expect(diagram).toHaveAttribute("data-routing-lane-spacing", "12");
  await expect(diagram).toHaveAttribute("data-wire-node-body-crossings", "0");
  await expect(diagram).toHaveAttribute("data-node-overlaps", "0");
  await expect(diagram).toHaveAttribute("data-wire-crossing-rendering", "arched-jumps");
  await expect(diagram).toHaveAttribute("data-wire-continuity", "single-path-with-integrated-jumps");
  await expect(diagram).toHaveAttribute("data-port-layout", "inputs-left-outputs-right-storage-signals-bottom");
  await expect(diagram).toHaveAttribute("data-touch-navigation", "pinch-zoom-two-finger-pan");
  await expect(diagram).toHaveAttribute("data-wire-geometry", "orthogonal-grid");
  await expect(diagram).toHaveAttribute("data-page-zoom-captured", "true");
  await expect(diagram).toHaveAttribute("data-zoom-rendering", "raf-transform-idle-react-reconcile");
  await expect(diagram).toHaveAttribute("data-view-memory", "per-layout-preserved");
  await expect(diagram).toHaveAttribute("data-earth-color", "#4af287");
  await expect(diagram).toHaveAttribute("data-current-safety-status", "incomplete");
  await expect(diagram).toHaveAttribute("data-current-safety-errors", /[1-9]\d*/);
  await expect(diagram).toHaveAttribute("data-current-safety-warnings", /[1-9]\d*/);
  const powerStatus = page.getByRole("status", { name: /Normal power audit.*Circuit-level fault audit/i });
  await expect(powerStatus).toBeVisible();
  await expect(powerStatus).toHaveAttribute("data-power-circuits", "12");
  await expect(powerStatus).toHaveAttribute("data-power-within-capacity", "8");
  await expect(powerStatus).toHaveAttribute("data-power-conditional-capacity", "4");
  await expect(powerStatus).toHaveAttribute("data-power-over-capacity", "0");
  await expect(page.locator(".diagram-wire-layer[mask]")).toHaveCount(0);
  const viewport = page.locator(".unified-diagram-viewport");
  await expect(viewport).toHaveCSS("background-color", "rgb(133, 139, 144)");
  const beforePanX = await diagram.getAttribute("data-view-x");
  const beforePanY = await diagram.getAttribute("data-view-y");
  const beforePanScale = await diagram.getAttribute("data-view-scale");
  await viewport.dispatchEvent("wheel", { deltaX: 36, deltaY: 24, ctrlKey: false });
  await expect.poll(() => diagram.getAttribute("data-view-x")).not.toBe(beforePanX);
  await expect.poll(() => diagram.getAttribute("data-view-y")).not.toBe(beforePanY);
  await expect(diagram).toHaveAttribute("data-view-scale", beforePanScale);
  const pageScaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  const capturedPinch = await viewport.evaluate((element) => {
    const event = new WheelEvent("wheel", { deltaY: -8, ctrlKey: true, clientX: 500, clientY: 400,
      bubbles: true, cancelable: true });
    const dispatchResult = element.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatchResult };
  });
  expect(capturedPinch).toEqual({ defaultPrevented: true, dispatchResult: false });
  await expect.poll(() => diagram.getAttribute("data-view-scale")).not.toBe(beforePanScale);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(pageScaleBefore);
  const rememberedSystemView = {
    x: await diagram.getAttribute("data-view-x"),
    y: await diagram.getAttribute("data-view-y"),
    scale: await diagram.getAttribute("data-view-scale"),
  };
  await expect(page.locator('.diagram-wire[data-connection-id="pv-frame-inside"]'))
    .toHaveCSS("stroke", "rgb(74, 242, 135)");
  await expect(page.locator(".diagram-device")).toHaveCount(diagrams.layouts.system.nodes.length);
  await expect(page.locator(".diagram-wire")).toHaveCount(diagrams.layouts.system.wires.length);
  await expect(page.locator('[data-device-id="servicePenetration"]')).toHaveCount(0);
  // 25 splices and breakouts plus 4 pair-sheath fans.
  await expect(page.locator(".diagram-wire-join-node")).toHaveCount(29);
  await expect(page.locator(".diagram-wire-join-node > rect")).toHaveCount(0);
  await expect(page.locator(".diagram-wire-join-center")).toHaveCount(29);
  await expect(page.locator(".diagram-wire-join-node .diagram-conductor")).toHaveCount(0);
  const joinGeometry = await page.locator(".diagram-wire-join-node").evaluateAll((joins) => joins.map((join) => {
    const center = join.querySelector(":scope > .diagram-wire-join-center");
    const arms = [...join.querySelectorAll(":scope > .diagram-wire-join-arm")];
    return {
      deviceId: join.getAttribute("data-device-id") ?? "",
      centers: center ? 1 : 0,
      arms: arms.length,
      colorMatched: center ? arms.every((arm) => getComputedStyle(arm).stroke === getComputedStyle(center).fill) : false,
      vectorEffects: arms.map((arm) => getComputedStyle(arm).vectorEffect),
      widthMatched: arms.every((arm) => {
        const endpoint = arm.getAttribute("data-endpoint-id");
        const wire = document.querySelector(`.diagram-wire[data-from-endpoint="${endpoint}"], .diagram-wire[data-to-endpoint="${endpoint}"]`);
        return wire && Number.parseFloat(arm.style.strokeWidth) === Number.parseFloat(wire.style.strokeWidth);
      }),
    };
  }));
  expect(joinGeometry.every(({ deviceId, centers, arms, colorMatched, vectorEffects, widthMatched }) => centers === 1
    && (arms === 3 || arms === 4)
    && (!deviceId.startsWith("join-") || colorMatched)
    && widthMatched && vectorEffects.every((effect) => effect === "none"))).toBe(true);
  expect(joinGeometry.filter(({ arms }) => arms === 4)).toHaveLength(4);
  for (const { id, breakoutId, diagramRouteId } of [
    { id: "generator", breakoutId: "generatorLeadBreakout", diagramRouteId: "generator-white-cable" },
    { id: "toolOutlet", breakoutId: "toolOutletLeadBreakout", diagramRouteId: "tool-white-cable" },
  ]) {
    const device = page.locator(`[data-device-id="${id}"]`);
    await expect(device.locator(".diagram-integrated-breakout")).toHaveCount(0);
    await expect(page.locator(`.diagram-port[data-endpoint-id="${id}.cable"]`)).toHaveCount(0);
    for (const conductorId of ["line", "neutral", "earth"]) {
      await expect(page.locator(`.diagram-port[data-endpoint-id="${id}.${conductorId}"]`)).toHaveCount(1);
    }
    const breakout = page.locator(`[data-device-id="${breakoutId}"]`);
    await expect(breakout).toHaveClass(/diagram-wire-join-node/);
    await expect(breakout.locator(":scope > .diagram-wire-join-arm")).toHaveCount(4);
    const whiteRoute = page.locator(`.diagram-wire[data-connection-id="${diagramRouteId}"]`);
    await expect(whiteRoute).toHaveCount(1);
    await expect(whiteRoute).not.toHaveAttribute("data-integrated-fusion-trimmed", /.+/);
    const endpoints = await whiteRoute.evaluate((path) => [path.dataset.fromEndpoint, path.dataset.toEndpoint]);
    expect(endpoints).toContain(`${breakoutId}.cable`);
    expect(endpoints.some((endpoint) => endpoint?.startsWith(`${id}.`))).toBe(false);
  }
  for (const routeId of [
    "generator-lead-line", "generator-lead-neutral", "generator-lead-earth", "generator-white-cable",
    "tool-white-cable", "tool-outlet-line", "tool-outlet-neutral", "tool-outlet-earth",
  ]) {
    await expect(page.locator(`.diagram-wire[data-connection-id="${routeId}"]`)).toHaveCount(1);
  }
  await expect(page.locator(".diagram-device-kind")).toHaveCount(0);
  const deviceFontSizes = await page.locator(".diagram-device-title").evaluateAll((labels) => (
    labels.map((label) => Number.parseFloat(getComputedStyle(label).fontSize))
  ));
  expect(Math.min(...deviceFontSizes)).toBeGreaterThanOrEqual(15);
  const fittedScale = Number(await diagram.getAttribute("data-view-scale"));
  expect(Math.min(...deviceFontSizes) * fittedScale).toBeGreaterThanOrEqual(7.95);
  const overflowingLabels = await page.locator(".diagram-device-title").evaluateAll((labels) => labels.flatMap((label) => {
    const body = label.parentElement?.querySelector(":scope > rect");
    if (!body) return [];
    const textBounds = label.getBoundingClientRect(); const bodyBounds = body.getBoundingClientRect();
    return textBounds.left < bodyBounds.left - 1 || textBounds.right > bodyBounds.right + 1
      || textBounds.top < bodyBounds.top - 1 || textBounds.bottom > bodyBounds.bottom + 1
      ? [label.textContent] : [];
  }));
  expect(overflowingLabels).toEqual([]);
  await expect(page.locator(".diagram-patcher-background, .diagram-subpatch-frame")).toHaveCount(0);
  const bridgeCount = Number(await diagram.getAttribute("data-bridged-wire-crossings"));
  expect(bridgeCount).toBeGreaterThan(0);
  expect(bridgeCount).toBeLessThan(180);
  expect(Number(await diagram.getAttribute("data-wire-turns"))).toBeLessThan(290);
  expect(Number(await diagram.getAttribute("data-wire-length"))).toBeLessThan(110_000);
  // Bars draw only the posts something lands on: four of the earth bar's eight.
  await expect(page.locator('.diagram-port[data-endpoint-id^="earthBar."]')).toHaveCount(0);
  const bridgeGroups = page.locator(".diagram-local-bridge-layer > g");
  const bridgeGroupCount = await bridgeGroups.count();
  expect(bridgeGroupCount).toBeGreaterThan(0);
  expect(bridgeGroupCount).toBeLessThanOrEqual(bridgeCount);
  expect(await bridgeGroups.evaluateAll((groups) => groups.reduce((sum, group) => (
    sum + Number(group.getAttribute("data-crossing-count"))
  ), 0))).toBe(bridgeCount);
  await expect(page.locator(".diagram-wire-local-underlay")).toHaveCount(bridgeGroupCount);
  await expect(page.locator(".diagram-wire-local-overpass")).toHaveCount(bridgeGroupCount);
  const bridgeGeometry = await bridgeGroups.evaluateAll((groups) => groups.map((group) => {
    const underlay = group.querySelector(".diagram-wire-local-underlay");
    const overpass = group.querySelector(".diagram-wire-local-overpass");
    return {
      underlayPath: underlay?.getAttribute("d") ?? "",
      overpassPath: overpass?.getAttribute("d") ?? "",
      underlayLineCap: underlay ? getComputedStyle(underlay).strokeLinecap : "",
    };
  }));
  expect(bridgeGeometry.every(({ underlayPath, overpassPath, underlayLineCap }) => (
    underlayPath === overpassPath
      && (overpassPath.match(/C/g) ?? []).length === 2
      && underlayLineCap === "butt"
  ))).toBe(true);
  const wireGeometry = await page.locator(".diagram-wire").evaluateAll((paths) => paths.map((path) => ({
    path: path.getAttribute("d") ?? "",
    crossings: Number(path.getAttribute("data-crossing-count")),
    jumps: Number(path.getAttribute("data-jump-count")),
  })));
  expect(wireGeometry.reduce((sum, wire) => sum + wire.crossings, 0)).toBe(bridgeCount);
  expect(wireGeometry.every(({ path, crossings, jumps }) => (
    (path.match(/M/g) ?? []).length === 1
      && !/[QSA]/.test(path)
      && (path.match(/C/g) ?? []).length === jumps * 2
      && (crossings === 0 ? jumps === 0 : jumps > 0)
  ))).toBe(true);
  const jumpedWire = page.locator('.diagram-wire:not([data-jump-count="0"])').first();
  const jumpedWireGeometry = await jumpedWire.evaluate((wire) => ({
    connectionId: wire.getAttribute("data-connection-id"),
    path: wire.getAttribute("d"),
    jumps: Number(wire.getAttribute("data-jump-count")),
  }));
  await jumpedWire.dispatchEvent("pointerover");
  const foregroundLayer = page.locator(".diagram-wire-hover-layer");
  await expect(foregroundLayer).toHaveCount(1);
  await expect(foregroundLayer).toHaveAttribute("data-connection-id", jumpedWireGeometry.connectionId);
  await expect(foregroundLayer).toHaveAttribute("data-jump-count", String(jumpedWireGeometry.jumps));
  const foregroundGeometry = await foregroundLayer.evaluate((layer) => {
    const clearance = layer.querySelector(".diagram-wire-hover-clearance");
    const conductor = layer.querySelector(".diagram-wire-foreground");
    return {
      isLastWireLayerChild: layer === layer.parentElement?.lastElementChild,
      clearanceWidth: clearance ? Number.parseFloat(getComputedStyle(clearance).strokeWidth) : 0,
      conductorWidth: conductor ? Number.parseFloat(getComputedStyle(conductor).strokeWidth) : 0,
      path: conductor?.getAttribute("d"),
    };
  });
  expect(foregroundGeometry).toEqual({
    isLastWireLayerChild: true,
    clearanceWidth: 16,
    conductorWidth: 10,
    path: jumpedWireGeometry.path,
  });
  expect((foregroundGeometry.path?.match(/C/g) ?? []).length).toBe(jumpedWireGeometry.jumps * 2);
  await jumpedWire.dispatchEvent("pointerout");
  await expect(foregroundLayer).toHaveCount(0);
  const junctionOutlines = await page.locator(".diagram-subpatch-node").evaluateAll((nodes) => nodes.map((node) => {
    const outline = node.querySelector(":scope > rect");
    return {
      rectangles: node.querySelectorAll(":scope > rect").length,
      fill: outline ? getComputedStyle(outline).fill : "",
      stroke: outline ? getComputedStyle(outline).stroke : "",
      dash: outline ? getComputedStyle(outline).strokeDasharray : "",
    };
  }));
  expect(junctionOutlines).toHaveLength(5);
  expect(new Set(junctionOutlines.map((outline) => JSON.stringify(outline))).size).toBe(1);
  expect(junctionOutlines[0]).toMatchObject({
    rectangles: 1,
    fill: "rgb(29, 48, 57)",
    stroke: "rgb(246, 199, 68)",
  });
  expect(junctionOutlines[0].dash).not.toBe("none");
  const visiblePortIndex = await page.locator(".diagram-port").evaluateAll(ports => ports.findIndex(port => {
    const box = port.getBoundingClientRect();
    return box.left > 50 && box.right < innerWidth - 50 && box.top > 150 && box.bottom < innerHeight - 50;
  }));
  expect(visiblePortIndex).toBeGreaterThanOrEqual(0);
  const firstPort = page.locator(".diagram-port").nth(visiblePortIndex);
  await firstPort.hover();
  const hoverLabel = firstPort.locator("xpath=following-sibling::*[contains(@class,'diagram-port-label')]");
  await expect(hoverLabel).toHaveCSS("opacity", "1");
  const hoverBounds = await hoverLabel.boundingBox();
  expect(hoverBounds.width).toBeGreaterThan(70);
  expect(hoverBounds.height).toBeGreaterThan(20);

  await page.locator('[data-device-id="batteryCutoffJunction"]').click();
  await expect(diagram).toHaveAttribute("data-diagram-scope", "junction");
  await expect(diagram).toHaveAttribute("data-junction-id", "batteryCutoffJunction");
  await expect(diagram).toHaveAttribute("data-visible-device-count", "3");
  await expect(diagram).toHaveAttribute("data-visible-wire-count", "6");
  await expect(page.getByRole("button", { name: "Back to full-system diagram" })).toBeVisible();
  await expect(diagram).toHaveAttribute("data-escape-navigation", "back-to-system");
  await expect(page.locator(".diagram-boundary-glands rect")).toHaveCount(6);
  await expect(page.locator(".diagram-boundary-glands text")).toHaveCount(0);
  // Three battery/controller feeds enter on the left, three protected leads leave on the right.
  await expect(page.locator('[data-boundary-port="true"]')).toHaveCount(6);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="input"]')).toHaveCount(3);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="output"]')).toHaveCount(3);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="neutral"]')).toHaveCount(0);
  for (const [id, label] of [
    ["batteryBreakerA", "String A cutoff · 120 A"],
    ["batteryBreakerB", "String B cutoff · 120 A"],
    ["mpptBreaker", "SmartSolar cutoff · 120 A"],
  ]) {
    await expect(page.locator(`[data-device-id="${id}"]`)).toHaveAttribute("aria-label", label);
  }
  await expect(page.locator(".diagram-wire-join-node")).toHaveCount(0);
  await expect(page.locator(".diagram-subpatch-frame, .diagram-patcher-background")).toHaveCount(0);

  await page.getByRole("button", { name: "Back to full-system diagram" }).click();
  await expect(diagram).toHaveAttribute("data-view-x", rememberedSystemView.x);
  await expect(diagram).toHaveAttribute("data-view-y", rememberedSystemView.y);
  await expect(diagram).toHaveAttribute("data-view-scale", rememberedSystemView.scale);
  await page.locator('[data-device-id="secondaryJunction"]').click();
  await expect(diagram).toHaveAttribute("data-diagram-scope", "junction");
  await expect(diagram).toHaveAttribute("data-junction-id", "secondaryJunction");
  await expect(diagram).toHaveAttribute("data-visible-device-count", String(diagrams.layouts.secondaryJunction.nodes.length));
  await expect(diagram).toHaveAttribute("data-visible-wire-count", String(diagrams.layouts.secondaryJunction.wires.length));
  await expect(diagram).toHaveAttribute("data-escape-navigation", "back-to-system");
  await expect(page.locator(".diagram-boundary-glands rect")).toHaveCount(diagrams.layouts.secondaryJunction.boundaryPorts.length);
  await expect(page.locator(".diagram-boundary-glands text")).toHaveCount(0);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="input"]')).toHaveCount(3);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="output"]')).toHaveCount(diagrams.layouts.secondaryJunction.boundaryPorts.filter(port => port.side === "output").length);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="neutral"]')).toHaveCount(0);
  // Compaction trades wire length for jumps and turns, in that order.
  expect(Number(await diagram.getAttribute("data-bridged-wire-crossings"))).toBeLessThanOrEqual(16);
  expect(Number(await diagram.getAttribute("data-wire-turns"))).toBeLessThanOrEqual(70);
  expect(Number(await diagram.getAttribute("data-wire-length"))).toBeLessThanOrEqual(30_000);
  for (const routeId of ["service-main", "orion-breaker-feed", "chargeit-breaker-feed", "ekrano-positive"]) {
    await expect(page.locator(`.diagram-wire[data-connection-id="${routeId}"]`))
      .toHaveAttribute("data-from-endpoint", /^secondaryPositiveBus\.post[1-7]$/);
  }
  for (const [id, label] of [
    ["secondaryPositiveBus", "Secondary 24 V positive bus · 100 A"],
    ["secondaryNegativeBus", "Secondary 24 V negative bus · 100 A"],
    ["sharedServicesBreaker", "Shared switched services · 10 A"],
    ["orionBreaker32", "Orion input · 32 A"],
    ["chargeItBreaker32", "ChargeIT! branch · 32 A"],
    ["unifiPower", "UniFi 24 V to 5 V USB-A converter"],
    ["starlinkBreakout", "Starlink factory-lead breakout"],
  ]) {
    await expect(page.locator(`[data-device-id="${id}"]`)).toHaveAttribute("aria-label", label);
  }
  await expect(page.locator(".diagram-wire-join-node")).toHaveCount(2);
  for (const id of [
    "internetSplit", "starlinkBreakout",
  ]) {
    const join = page.locator(`[data-device-id="${id}"]`);
    await expect(join).toHaveClass(/diagram-wire-join-node/);
    await expect(join.locator(":scope > rect")).toHaveCount(0);
    await expect(join.locator(":scope > .diagram-wire-join-arm")).toHaveCount(3);
  }
  for (const removedId of ["serviceReturnSplit", "lightingReturnSplit", "internetReturnSplit"]) {
    await expect(page.locator(`[data-device-id="${removedId}"]`)).toHaveCount(0);
  }
  await expect(page.locator('.diagram-port[data-boundary-port="false"][data-endpoint-id^="secondaryNegativeBus."][aria-label*="Victron Orion"]'))
    .toHaveCount(1);
  await expect(page.locator('[data-boundary-port="true"][aria-label*="Victron Ekrano GX"]')).toHaveCount(2);
  await expect(page.locator(".diagram-subpatch-frame, .diagram-patcher-background")).toHaveCount(0);
  await expect(page.locator(".graph-inspector")).toHaveCount(0);
  await page.locator('[data-device-id="internetSplit"]').click();
  await expect(page.locator(".graph-inspector")).toBeVisible();
  await expect(diagram).toHaveAttribute("data-escape-navigation", "close-inspector");
  await page.keyboard.press("Escape");
  await expect(page.locator(".graph-inspector")).toHaveCount(0);
  await expect(diagram).toHaveAttribute("data-diagram-scope", "junction");
  await expect(diagram).toHaveAttribute("data-escape-navigation", "back-to-system");
  await page.keyboard.press("Escape");
  await expect(diagram).toHaveAttribute("data-diagram-scope", "system");
  await expect(diagram).toHaveAttribute("data-view-x", rememberedSystemView.x);
  await expect(diagram).toHaveAttribute("data-view-y", rememberedSystemView.y);
  await expect(diagram).toHaveAttribute("data-view-scale", rememberedSystemView.scale);
  await expect(diagram).toHaveAttribute("data-escape-navigation", "inactive");
  await expect(page.getByRole("button", { name: "Back to full-system diagram" })).toHaveCount(0);
  await page.locator('[data-device-id="pvJunction"]').click();
  await expect(diagram).toHaveAttribute("data-junction-id", "pvJunction");
  await expect(diagram).toHaveAttribute("data-visible-device-count", String(diagrams.layouts.pvJunction.nodes.length));
  await expect(diagram).toHaveAttribute("data-visible-wire-count", String(diagrams.layouts.pvJunction.wires.length));
  await expect(page.locator(".diagram-rigid-rail-node")).toHaveCount(0);
  await expect(page.locator(".diagram-rigid-rail-core")).toHaveCount(0);
  await expect(page.locator(".diagram-rigid-rail-tooth")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to full-system diagram" }).click();
  await page.locator('[aria-label="AC input / output protection box"]').click();
  await expect(diagram).toHaveAttribute("data-junction-id", "acJunction");
  await expect(diagram).toHaveAttribute("data-orthogonal-t-join-count", "2");
  await expect(page.locator(".diagram-wire-join-node")).toHaveCount(6);
  for (const id of ["generatorAcBreakout", "acInputCableBreakout", "acOutputCableBreakout", "toolAcBreakout"]) {
    const breakout = page.locator(`[data-device-id="${id}"]`);
    await expect(breakout).toHaveClass(/diagram-wire-join-node/);
    await expect(breakout.locator(":scope > rect")).toHaveCount(0);
    await expect(breakout.locator(":scope > .diagram-wire-join-arm")).toHaveCount(4);
  }
  const earthTees = page.locator('.diagram-wire-join-orthogonal-t[data-join-geometry="orthogonal-t"]');
  await expect(earthTees).toHaveCount(2);
  expect(await earthTees.evaluateAll((tees) => tees.every((tee) => {
    const arms = [...tee.querySelectorAll(":scope > .diagram-wire-join-arm")];
    return arms.length === 3 && arms.every((arm) => /^M[^CQSA]+ L0,0$/.test(arm.getAttribute("d") ?? ""));
  }))).toBe(true);
  expect(Number(await diagram.getAttribute("data-unbridged-wire-crossings"))).toBe(0);
  expect(Number(await diagram.getAttribute("data-bridged-wire-crossings"))).toBeLessThanOrEqual(12);
  expect(Number(await diagram.getAttribute("data-wire-turns"))).toBeLessThanOrEqual(70);
  for (const id of ["acInputProtection", "acOutputProtection"]) {
    await expect(page.locator(`[data-device-id="${id}"]`)).toHaveClass(/hold/);
    await expect(page.locator(`[data-device-id="${id}"]`)).not.toHaveClass(/faded/);
  }
  await page.getByRole("checkbox", { name: "Fade purchased" }).check();
  for (const id of ["acInputProtection", "acOutputProtection"]) {
    await expect(page.locator(`[data-device-id="${id}"]`)).toHaveClass(/hold/);
    await expect(page.locator(`[data-device-id="${id}"]`)).toHaveClass(/faded/);
  }
});

test("device and conductor inspection use graph data", async ({ page }) => {
  await page.locator('[aria-label="Victron Orion-Tr Smart 24/12-30"]').click();
  await expect(page.getByRole("heading", { name: "Victron Orion-Tr Smart 24/12-30" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conductors" })).toBeVisible();
  await page.locator(".graph-inspector").getByRole("button", { name: /^To 12 V cigarette-lighter socket A/ }).click();
  await expect(page.locator(".graph-current-safety")).toHaveAttribute("data-current-safety-status", "incomplete");
  await expect(page.locator(".graph-current-safety")).toContainText("30 A declared ampacity");
  await expect(page.locator(".graph-current-safety")).toContainText("60 A prospective fault contribution");
  // Close the inspector first: the open panel may cover the node on screen.
  await page.keyboard.press("Escape");
  await expect(page.locator(".graph-inspector")).toHaveCount(0);
  await page.locator('[aria-label="Victron Orion-Tr Smart 24/12-30"]').click();
  await page.locator(".graph-inspector").getByRole("button", {
    name: /From Middle · Orion remote H/,
  }).click();
  await expect(page.getByText("usbOrion.remoteH", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", {
    name: /Middle · Orion remote H.*To Victron Orion-Tr Smart 24\/12-30/,
  })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".graph-inspector")).toHaveCount(0);
  await page.locator('[aria-label="AIKO panel 1 · 3S string"]').click();
  await expect(page.getByRole("heading", { name: "AIKO panel 1 · 3S string" })).toBeVisible();
  await page.locator(".unified-diagram-viewport").click({ position: { x: 8, y: 8 } });
  await expect(page.locator(".graph-inspector")).toHaveCount(0);
});

test("BOM reflects purchased protection and cables, selected busbars and current architecture rows", async ({ page }) => {
  await page.getByRole("button", { name: /Bill of materials/ }).click();
  await expect(page.getByText("DIHOOL DZ47X-125-frame non-polarized 120 A battery-string disconnect breakers", { exact: true })).toBeVisible();
  await expect(page.getByText("DIHOOL DZ47X-125-frame non-polarized 120 A SmartSolar 24 V disconnect breaker", { exact: true })).toBeVisible();
  await expect(page.getByText("CHTAIXI 32 A single-pole Orion input branch breaker", { exact: true })).toBeVisible();
  await expect(page.getByText("CHTAIXI 32 A single-pole ChargeIT! branch breaker", { exact: true })).toBeVisible();
  await expect(page.getByText("CHTAIXI two-pole 600 VDC 20 A PV string breakers", { exact: true })).toBeVisible();
  await expect(page.getByText("DIHOOL 10 A two-pole Type A ground-fault breakers with integrated surge protection", { exact: true })).toBeVisible();
  await expect(page.getByText("Shirbly preterminated 1/0 AWG OFC battery cable pairs · 3/8 in lugs", { exact: true })).toBeVisible();
  await expect(page.getByText("Shirbly preterminated 2 AWG OFC battery cable pairs · 3 ft · 3/8 in lugs", { exact: true })).toBeVisible();
  await expect(page.getByText(/Ordinary services · 20 A/, { exact: true })).toHaveCount(0);
  const sharedServicesBreaker = page.locator('[data-bom-id="dse-switched-load-breaker"]');
  await expect(sharedServicesBreaker).toBeVisible();
  await expect(sharedServicesBreaker).toContainText("CHTAIXI 10 A single-pole DC shared switched-services breaker");
  await expect(sharedServicesBreaker).toContainText("Purchased · commissioning verification hold");
  for (const id of ["dse-junction-box", "dse-ac-install-enclosure", "dse-service-spares", "dse-switch-accessories", "dse-earth-bus-cover"]) {
    await expect(page.locator(`[data-bom-id="${id}"]`)).toHaveCount(0);
  }
  for (const id of ["dse-airic-npt-cable-glands", "dse-ventilated-ip65-enclosure", "dse-pg11-cable-glands", "dse-mollom-8-way-enclosure-second", "dse-shirbly-2awg-cable-pairs"]) {
    const row = page.locator(`[data-bom-id="${id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Purchased");
  }
  for (const id of ["dse-airic-npt-cable-glands", "dse-pg11-cable-glands"]) {
    const row = page.locator(`[data-bom-id="${id}"]`);
    await expect(row).toContainText(/unallocated/i);
  }
  await expect(page.locator('[data-bom-id="dse-shirbly-2awg-cable-pairs"]'))
    .toContainText(/not automatically compatible.*Allocate only after final metric measurement/is);
  const ownedSecondarySpare = page.locator('[data-bom-id="dse-ventilated-ip65-enclosure"]');
  await expect(ownedSecondarySpare).toContainText(/Historical purchase record/i);
  await expect(ownedSecondarySpare).toContainText(/earlier six-gang layout is superseded/i);
  const cutoffEnclosure = page.locator('[data-bom-id="dse-mollom-8-way-enclosure-second"]');
  await expect(cutoffEnclosure).toContainText(/R32 fit is accepted and verified/i);
  const largerSecondaryEnclosure = page.locator('[data-bom-id="dse-secondary-enclosure-larger"]');
  await expect(largerSecondaryEnclosure).toBeVisible();
  await expect(largerSecondaryEnclosure).toContainText(/Historical planning allowance retained for accounting/i);
  await expect(largerSecondaryEnclosure).toContainText(/Outside scope · historical enclosure plan/i);
  const mainBusbars = page.locator('[data-bom-id="dse-main-busbars"]');
  await expect(mainBusbars).toBeVisible();
  await expect(mainBusbars).toContainText("Joinfworld 250 A");
  await expect(mainBusbars).toContainText("selected to replace the AMOMD 600 A pair");
  const removedBusbars = page.locator('[data-bom-id="dse-amomd-600a-busbars-unused"]');
  await expect(removedBusbars).toContainText("not in design");
  await expect(removedBusbars).toContainText("Return");
});

test("3D model uses canonical router and has no removed controls", async ({ page }) => {
  await page.getByRole("button", { name: "3D model" }).click();
  const model = page.locator(".unified-model");
  await expect(model).toHaveAttribute("data-route-fallbacks", "0", { timeout: 45_000 });
  await expect(model).toHaveAttribute("data-route-centerline-conflicts", "0");
  await expect(model).toHaveAttribute("data-route-swept-conflicts", "0");
  await expect(model).toHaveAttribute("data-route-device-conflicts", "0");
  expect(Number(await model.getAttribute("data-route-total-length-m"))).toBeLessThan(150);
  expect(Number(await model.getAttribute("data-route-turns"))).toBeLessThan(800);
  await expect(model).toHaveAttribute("data-routing-target-assignments", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-routing-target-changes", /\d+/);
  await expect(model).toHaveAttribute("data-earth-chain-route-length-m", /\d+\.\d{2}/);
  await expect(model).toHaveAttribute("data-runtime-source", "precomputed");
  await expect(model).toHaveAttribute("data-route-solve-ms", "0.0");
  await expect(model).toHaveAttribute("data-runtime-hydrate-ms", /\d+\.\d{3}/);
  await expect(model).toHaveAttribute("data-wire-profile", "constant-radius-octagon");
  await expect(model).toHaveAttribute("data-wire-radial-segments", "8");
  await expect(model).toHaveAttribute("data-wire-tessellation", "piece-weighted-minimum-eight-segments-per-bend");
  await expect(model).toHaveAttribute("data-wire-min-bend-segments", "8");
  await expect(model).toHaveAttribute("data-wire-terminal-tangent-errors", "0");
  await expect(model).toHaveAttribute("data-unused-terminal-opacity", "0.5");
  await expect(model).toHaveAttribute("data-unused-terminal-count", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-conductor-usage", "field-routes-plus-reciprocal-internal-mates");
  await expect(model).toHaveAttribute("data-earth-topology", "pv-spd-chassis-rod");
  await expect(model).toHaveAttribute("data-breakout-rendering", "true-y-two-way-plus-minus-45-three-way-red-45-black-0-green-minus-45");
  await expect(model).toHaveAttribute("data-cable-breakout-count", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-integrated-cable-breakout-count", "0");
  await expect(model).toHaveAttribute("data-usb-outlet-rendering", "metadata-driven-usb-c-pill-usb-a-rectangle");
  await expect(model).toHaveAttribute("data-usb-c-outlet-count", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-usb-a-outlet-count", "5");
  await expect(model).toHaveAttribute("data-wire-join-rendering",
    "presentation-driven-selectable-y-or-straight-orthogonal-t");
  await expect(model).toHaveAttribute("data-wire-join-count", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-orthogonal-wire-join-count", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-orthogonal-wire-join-bends", "0");
  await expect(model).toHaveAttribute("data-supplied-busbar-cover-count", "5");
  await expect(model).toHaveAttribute("data-smart-shunt-rendering", "uncovered-monitor-body");
  await expect(model).toHaveAttribute("data-wall-shadow", "casts-and-receives");
  await expect(model).toHaveAttribute("data-wall-penetrations", "2");
  await expect(model).toHaveAttribute("data-battery-cutoff-breaker-order",
    "batteryBreakerA,batteryBreakerB,mpptBreaker");
  await expect(model).toHaveAttribute("data-secondary-services-breaker-order",
    "orionBreaker32,chargeItBreaker32,sharedServicesBreaker");
  await expect(model).toHaveAttribute("data-current-safety-status", "incomplete");
  await expect(model).toHaveAttribute("data-current-safety-errors", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-current-safety-warnings", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-device-shadow-floor", "excluded-by-light-layer");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(model).toHaveCSS("background-color", "rgb(239, 232, 216)");
  await expect(page.locator(".model-hover-tooltip")).toBeHidden();
  const canvas = page.locator(".unified-model canvas");
  await expect(canvas).toHaveAttribute("data-mouse-gestures", "left-orbit-right-pan-wheel-zoom-ctrl-wheel-pinch-zoom");
  await expect(canvas).toHaveAttribute("data-wheel-gestures", "wheel-and-two-finger-scroll-zoom-1x");
  await expect(canvas).toHaveAttribute("data-touch-gestures", "one-finger-orbit-two-finger-pan");
  await expect(canvas).toHaveAttribute("data-native-gesture-capture", "local-pinch-zoom");
  await expect(canvas).toHaveAttribute("data-hover-highlight", "#fff200");
  await expect(canvas).toHaveAttribute("data-unused-conductor-opacity", "0.5");
  await expect(canvas).toHaveAttribute("data-wire-rendered-bends", /[1-9]\d*/);
  await expect(page.getByRole("button", { name: "DC distribution" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Battery cutoffs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Secondary services" })).toBeVisible();
  await page.getByRole("button", { name: "DC distribution" }).click();
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  let hovered = "";
  let hoveredPoint;
  for (let row = 2; row < 18 && !hovered; row += 1) {
    for (let column = 2; column < 28 && !hovered; column += 1) {
      const point = {
        x: canvasBounds.x + canvasBounds.width * (column / 30),
        y: canvasBounds.y + canvasBounds.height * (row / 20),
      };
      await page.mouse.move(point.x, point.y);
      hovered = await canvas.getAttribute("data-hovered-device") ?? "";
      if (hovered) hoveredPoint = point;
    }
  }
  expect(hovered).not.toBe("");
  expect(hoveredPoint).toBeDefined();
  await expect(canvas).toHaveAttribute("data-hover-bounds", "visible");
  await expect(page.locator(".model-hover-tooltip")).toBeVisible();
  await page.mouse.click(hoveredPoint.x, hoveredPoint.y);
  await expect(page.locator(".graph-inspector")).toBeVisible();
  // An orbit gesture is not an empty click and must retain the selection.
  await page.mouse.move(hoveredPoint.x, hoveredPoint.y);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(hoveredPoint.x + 30, hoveredPoint.y + 18, { steps: 3 });
  await page.mouse.up({ button: "left" });
  await expect(page.locator(".graph-inspector")).toBeVisible();
  // A true empty left-click clears immediately.
  const emptyPoint = { x: canvasBounds.x + 8, y: canvasBounds.y + 8 };
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await expect(canvas).toHaveAttribute("data-hovered-device", "");
  await expect(canvas).toHaveAttribute("data-hovered-conductor", "");
  await page.mouse.click(emptyPoint.x, emptyPoint.y);
  await expect(page.locator(".graph-inspector")).toHaveCount(0);
  let hoveredConductor = await canvas.getAttribute("data-hovered-conductor") ?? "";
  for (let row = 2; row < 18 && !hoveredConductor; row += 1) {
    for (let column = 2; column < 28 && !hoveredConductor; column += 1) {
      await page.mouse.move(
        canvasBounds.x + canvasBounds.width * column / 30,
        canvasBounds.y + canvasBounds.height * row / 20,
      );
      hoveredConductor = await canvas.getAttribute("data-hovered-conductor") ?? "";
    }
  }
  expect(hoveredConductor).not.toBe("");
  await expect(canvas).toHaveAttribute("data-hover-bounds-kind", "conductor");
  const tooltipBounds = await page.locator(".model-hover-tooltip").boundingBox();
  const stageBounds = await page.locator(".unified-model-stage").boundingBox();
  expect(tooltipBounds).not.toBeNull();
  expect(stageBounds).not.toBeNull();
  expect(stageBounds.x + stageBounds.width - (tooltipBounds.x + tooltipBounds.width)).toBeLessThan(30);
  expect(stageBounds.y + stageBounds.height - (tooltipBounds.y + tooltipBounds.height)).toBeLessThan(30);
  const centerX = canvasBounds.x + canvasBounds.width / 2;
  const centerY = canvasBounds.y + canvasBounds.height / 2;
  const parseVector = (value) => value.split(",").map(Number);

  // An ordinary wheel/two-finger trackpad scroll uses the original local
  // exponent. A zero-delta event first establishes the exact picked
  // surface used as the distance reference for the coefficient assertion.
  await page.getByRole("button", { name: "DC distribution" }).click();
  const dispatchWheel = (deltaY) => canvas.evaluate((element, input) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: input.x,
      clientY: input.y,
      deltaY: input.deltaY,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    });
    const dispatchResult = element.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatchResult };
  }, { x: centerX, y: centerY, deltaY });
  expect(await dispatchWheel(0)).toEqual({ defaultPrevented: true, dispatchResult: false });
  const wheelBeforeDistance = Number(await canvas.getAttribute("data-camera-distance"));
  const wheelBeforeQuaternion = parseVector(await canvas.getAttribute("data-camera-quaternion"));
  expect(await dispatchWheel(-20)).toEqual({ defaultPrevented: true, dispatchResult: false });
  await expect(canvas).toHaveAttribute("data-last-wheel-mode", "zoom");
  const wheelAfterDistance = Number(await canvas.getAttribute("data-camera-distance"));
  expect(wheelAfterDistance / wheelBeforeDistance).toBeCloseTo(Math.exp(-20 * 0.0014), 3);
  const wheelAfterQuaternion = parseVector(await canvas.getAttribute("data-camera-quaternion"));
  wheelAfterQuaternion.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(wheelBeforeQuaternion[index], 6));
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  // Right-drag remains a pure pan: it translates the pose without changing
  // either camera distance or orientation.
  await page.getByRole("button", { name: "DC distribution" }).click();
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: "right" });
  const rightDragBeforePosition = parseVector(await canvas.getAttribute("data-camera-position"));
  const rightDragBeforeDistance = Number(await canvas.getAttribute("data-camera-distance"));
  const rightDragBeforeQuaternion = parseVector(await canvas.getAttribute("data-camera-quaternion"));
  await page.mouse.move(centerX + 72, centerY + 36);
  await page.mouse.up({ button: "right" });
  const rightDragPosition = parseVector(await canvas.getAttribute("data-camera-position"));
  expect(rightDragPosition.some((coordinate, index) => Math.abs(coordinate - rightDragBeforePosition[index]) > 0.001)).toBe(true);
  expect(Number(await canvas.getAttribute("data-camera-distance"))).toBeCloseTo(rightDragBeforeDistance, 3);
  const rightDragQuaternion = parseVector(await canvas.getAttribute("data-camera-quaternion"));
  rightDragQuaternion.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(rightDragBeforeQuaternion[index], 6));

  // Direct touch pointer events exercise the mobile mapping independently of
  // browser trackpad wheel synthesis: one contact orbits; two contacts pan.
  const dispatchTouchPointer = (type, pointerId, x, y) => canvas.evaluate((element, input) => {
    const event = new PointerEvent(input.type, {
      bubbles: true,
      cancelable: true,
      pointerId: input.pointerId,
      pointerType: "touch",
      isPrimary: input.pointerId === 101 || input.pointerId === 201,
      button: input.type === "pointerup" ? -1 : 0,
      buttons: input.type === "pointerup" ? 0 : 1,
      clientX: input.x,
      clientY: input.y,
    });
    element.dispatchEvent(event);
  }, { type, pointerId, x, y });

  await page.getByRole("button", { name: "DC distribution" }).click();
  await dispatchTouchPointer("pointerdown", 101, centerX, centerY);
  const oneTouchBeforeQuaternion = parseVector(await canvas.getAttribute("data-camera-quaternion"));
  await dispatchTouchPointer("pointermove", 101, centerX + 32, centerY + 16);
  await dispatchTouchPointer("pointerup", 101, centerX + 32, centerY + 16);
  const oneTouchQuaternion = parseVector(await canvas.getAttribute("data-camera-quaternion"));
  expect(oneTouchQuaternion.some((coordinate, index) => Math.abs(coordinate - oneTouchBeforeQuaternion[index]) > 0.0001)).toBe(true);

  await page.getByRole("button", { name: "DC distribution" }).click();
  await dispatchTouchPointer("pointerdown", 201, centerX - 30, centerY);
  await dispatchTouchPointer("pointerdown", 202, centerX + 30, centerY);
  const twoTouchBeforePosition = parseVector(await canvas.getAttribute("data-camera-position"));
  const twoTouchBeforeDistance = Number(await canvas.getAttribute("data-camera-distance"));
  const twoTouchBeforeQuaternion = parseVector(await canvas.getAttribute("data-camera-quaternion"));
  await dispatchTouchPointer("pointermove", 201, centerX, centerY + 16);
  await dispatchTouchPointer("pointermove", 202, centerX + 60, centerY + 16);
  const twoTouchPosition = parseVector(await canvas.getAttribute("data-camera-position"));
  expect(twoTouchPosition.some((coordinate, index) => Math.abs(coordinate - twoTouchBeforePosition[index]) > 0.001)).toBe(true);
  expect(Number(await canvas.getAttribute("data-camera-distance"))).toBeCloseTo(twoTouchBeforeDistance, 3);
  const twoTouchQuaternion = parseVector(await canvas.getAttribute("data-camera-quaternion"));
  twoTouchQuaternion.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(twoTouchBeforeQuaternion[index], 6));
  await dispatchTouchPointer("pointerup", 201, centerX, centerY + 16);
  await dispatchTouchPointer("pointerup", 202, centerX + 60, centerY + 16);

  // Chromium reports a trackpad pinch as ctrl+wheel. The model cancels the
  // browser gesture and changes only its own camera distance.
  await page.getByRole("button", { name: "DC distribution" }).click();
  const pinchBeforeDistance = Number(await canvas.getAttribute("data-camera-distance"));
  const pinchCapture = await canvas.evaluate((element, point) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      ctrlKey: true,
      deltaY: -64,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    });
    const dispatchResult = element.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatchResult };
  }, { x: centerX, y: centerY });
  expect(pinchCapture).toEqual({ defaultPrevented: true, dispatchResult: false });
  await expect(canvas).toHaveAttribute("data-last-wheel-mode", "pinch-zoom");
  expect(Number(await canvas.getAttribute("data-camera-distance"))).not.toBeCloseTo(pinchBeforeDistance, 3);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  // Safari/WebKit exposes trackpad pinch as native GestureEvents rather than
  // ctrl+wheel. These events must also stay local to the canvas.
  await page.getByRole("button", { name: "DC distribution" }).click();
  const nativeBeforeDistance = Number(await canvas.getAttribute("data-camera-distance"));
  const nativeBeforeCount = Number(await canvas.getAttribute("data-native-gesture-pinch-events"));
  const nativeCapture = await canvas.evaluate((element, point) => {
    const dispatch = (type, scale) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: point.x }, clientY: { value: point.y }, scale: { value: scale },
      });
      const dispatchResult = element.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented, dispatchResult };
    };
    return {
      start: dispatch("gesturestart", 1), change: dispatch("gesturechange", 1.2), end: dispatch("gestureend", 1.2),
    };
  }, { x: centerX, y: centerY });
  expect(nativeCapture).toEqual({
    start: { defaultPrevented: true, dispatchResult: false },
    change: { defaultPrevented: true, dispatchResult: false },
    end: { defaultPrevented: true, dispatchResult: false },
  });
  await expect(canvas).toHaveAttribute("data-native-gesture-pinch-events", String(nativeBeforeCount + 1));
  expect(Number(await canvas.getAttribute("data-camera-distance"))).not.toBeCloseTo(nativeBeforeDistance, 3);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  const beforeFade = await canvas.getAttribute("data-camera-position");
  await page.getByRole("checkbox", { name: "Fade purchased" }).check();
  await expect(canvas).toHaveAttribute("data-fade-purchased", "true");
  await expect(canvas).toHaveAttribute("data-camera-position", beforeFade);
  await expect(page.getByText(/Scale notes/i)).toHaveCount(0);
  await expect(page.getByText(/Show labels|Hide labels/i)).toHaveCount(0);
});

test("BOM can show only items to purchase and sort by status, weight and cost", async ({ page }) => {
  await page.getByRole("button", { name: /Bill of materials/ }).click();
  await expect(page.locator('[data-bom-total="design"]')).toContainText("$12,292.48");
  await expect(page.locator('[data-bom-total="design"]')).toContainText("Solar + internet only");
  await expect(page.locator('[data-bom-total="additional"]')).toContainText("$3,422.50");
  await expect(page.locator('[data-bom-total="additional"]')).toContainText("14 rows");
  await expect(page.locator('[data-bom-id="dse-switch-array"]')).toBeVisible();
  await page.getByRole("button", { name: "Show Items To Purchase" }).click();
  await expect(page.locator('[data-bom-id="dse-switch-array"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-ex-labor"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-ex-mount"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-multiplus"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-pv-string-breakers"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-switched-load-breaker"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show All" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^Weight/ }).click();
  await expect(page.getByRole("columnheader", { name: /^Weight/ })).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("button", { name: "Cost", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: /^Cost/ })).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("button", { name: /^Status/ }).click();
  await expect(page.getByRole("columnheader", { name: /^Status/ })).toHaveAttribute("aria-sort", "ascending");
});

test("Costs treemap includes every positive-cost BOM line", async ({ page }) => {
  await page.getByRole("button", { name: "Costs" }).click();
  await expect(page.getByRole("heading", { name: "Cost by item" })).toBeVisible();
  await expect(page.locator(".cost-tile")).toHaveCount(138);
  await expect(page.locator(".cost-total strong")).toHaveText("$16,387.03");
  await page.locator(".cost-reconciliation summary").click();
  await expect(page.locator(".cost-reconciliation")).toContainText("$15,962.15");
  await expect(page.locator(".cost-reconciliation")).toContainText("$424.88");
  await expect(page.locator(".cost-reconciliation li")).toHaveCount(0);
  await expect(page.locator(".cost-total")).toContainText("On-site Fiji purchases: FJD 15,193.00 · $6,938.18 · paid by IYOIYO");
  await expect(page.locator('[data-source-currency="FJD"]')).toHaveCount(34);
  await expect(page.locator(".cost-legend")).toContainText("Power & generation");
  await expect(page.locator('.cost-tile[data-accounting-scope="Solar + internet"]')).not.toHaveCount(0);
  await expect(page.locator('.cost-tile[data-accounting-scope="Additional purchases"]')).not.toHaveCount(0);
  await expect(page.locator('.cost-tile[data-accounting-scope="Excluded / returns"]')).not.toHaveCount(0);
  const scope = page.getByLabel("Show costs for");
  await scope.selectOption("Solar + internet");
  await expect(page.locator(".cost-tile")).toHaveCount(111);
  await expect(page.locator(".cost-total strong")).toHaveText("$12,382.71");
  await expect(page.locator(".cost-total")).toContainText("$90.23 across 1 credit row stays");
  await scope.selectOption("Additional purchases");
  await expect(page.locator(".cost-tile")).toHaveCount(13);
  await expect(page.locator(".cost-total strong")).toHaveText("$3,432.20");
  await expect(page.locator(".cost-reconciliation")).toContainText("$15,962.15");
  await scope.selectOption("Excluded / returns");
  await expect(page.locator(".cost-tile")).toHaveCount(14);
  await expect(page.locator(".cost-total strong")).toHaveText("$572.12");
  await expect(page.locator(".cost-total")).toContainText("$324.95 across 5 credit rows stay");
  await scope.selectOption("All items");
  await expect(page.locator(".cost-tile")).toHaveCount(138);
});

test('installed wall controls and grouped operator diagram are usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Simple diagram', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Power at a glance' })).toBeVisible();
  await expect(page.locator('.operator-controls button')).toHaveCount(3);
  const middle = page.locator('.operator-controls button').nth(1);
  await middle.click(); await expect(middle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.operator-canvas path[data-connections]')).toHaveCount(14);
  await expect(page.locator('.operator-canvas path[stroke-dasharray]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Detailed diagram', exact: true }).click();
  await page.locator('[data-device-id="wallSwitchJunction"]').click();
  await expect(page.locator('.unified-diagram')).toHaveAttribute('data-junction-id', 'wallSwitchJunction');
  const ys = [];
  for (const id of ['switchInternet', 'switchOrion', 'switchLights']) {
    const rocker = page.locator(`[data-device-id="${id}"]`);
    await expect(rocker).toBeVisible(); ys.push((await rocker.boundingBox()).y);
    await expect(page.locator(`[data-endpoint-id="${id}.loop"]`)).toHaveCount(1);
  }
  expect(ys[0]).toBeLessThan(ys[1]); expect(ys[1]).toBeLessThan(ys[2]);
  await page.keyboard.press('Escape');
  await page.locator('[data-device-id="pvJunction"]').click();
  const xs = [];
  for (const id of ['pvCutoff', 'pvSpare', 'pvCombiner', 'pvSurge']) {
    const device = page.locator(`[data-device-id="${id}"]`);
    await expect(device).toBeVisible(); xs.push((await device.boundingBox()).x);
  }
  expect(xs.every((x, index) => !index || x > xs[index - 1])).toBe(true);
});
