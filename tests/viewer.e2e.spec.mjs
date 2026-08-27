import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.goto("/", { timeout: 120_000 });
  await expect(page.locator(".app-shell")).toHaveAttribute("data-viewer-ready", "true");
});

test("DSE-only shell exposes only retained tabs", async ({ page }) => {
  await expect(page.getByLabel("Current project")).toContainText("DSEFiji");
  await expect(page.getByRole("button", { name: "Detailed diagram" })).toBeVisible();
  await expect(page.getByRole("button", { name: "3D model" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Fade purchased" })).not.toBeChecked();
  const navigation = page.getByRole("navigation", { name: "Viewer mode" });
  await expect(navigation.getByRole("button", { name: /Junction box/i })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: /AC Junction/i })).toHaveCount(0);
  await expect(page.getByText(/Pasana|PNG|PG solar/i)).toHaveCount(0);
});

test("detailed diagram and canonical counts render", async ({ page }) => {
  const diagram = page.locator(".unified-diagram");
  await expect(diagram).toHaveAttribute("data-device-count", "87");
  await expect(diagram).toHaveAttribute("data-wire-count", "143");
  await expect(diagram).toHaveAttribute("data-layout-source", "build-generated-artifact");
  await expect(diagram).toHaveAttribute("data-junctions-abstracted", "true");
  await expect(diagram).toHaveAttribute("data-visible-device-count", "58");
  await expect(diagram).toHaveAttribute("data-visible-wire-count", "97");
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
  await expect(page.getByRole("status", { name: /Current protection audit incomplete/i })).toBeVisible();
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
  await expect(page.locator('.diagram-wire[data-connection-id="pv-spd-earth"]'))
    .toHaveCSS("stroke", "rgb(74, 242, 135)");
  await expect(page.locator(".diagram-device")).toHaveCount(58);
  await expect(page.locator(".diagram-wire")).toHaveCount(97);
  await expect(page.locator('[data-device-id="servicePenetration"]')).toHaveCount(0);
  await expect(page.locator(".diagram-wire-join-node")).toHaveCount(20);
  await expect(page.locator(".diagram-wire-join-node > rect")).toHaveCount(0);
  await expect(page.locator(".diagram-wire-join-center")).toHaveCount(20);
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
  expect(joinGeometry.filter(({ arms }) => arms === 4)).toHaveLength(2);
  for (const { id, endpoint } of [
    { id: "generator", endpoint: "generator.cable" },
    { id: "toolOutlet", endpoint: "toolOutlet.cable" },
  ]) {
    const integrated = page.locator(`[data-device-id="${id}"] .diagram-integrated-breakout`);
    await expect(integrated).toHaveCount(1);
    await expect(integrated.locator(".diagram-integrated-breakout-arm")).toHaveCount(3);
    await expect(integrated.locator(".diagram-integrated-breakout-center")).toHaveCount(1);
    await expect(page.locator(`.diagram-port[data-endpoint-id="${endpoint}"]`)).toHaveCount(0);
    const whiteRoute = page.locator(
      `.diagram-wire[data-from-endpoint="${endpoint}"], .diagram-wire[data-to-endpoint="${endpoint}"]`,
    );
    await expect(whiteRoute).toHaveCount(1);
    await expect(whiteRoute).toHaveAttribute("data-integrated-fusion-trimmed", endpoint);
    const fusionGap = await whiteRoute.evaluate((path, input) => {
      const center = document.querySelector(
        `[data-device-id="${input.id}"] .diagram-integrated-breakout-center`,
      );
      if (!(path instanceof SVGPathElement) || !(center instanceof SVGCircleElement)) return null;
      const routePoint = path.getPointAtLength(
        path.dataset.fromEndpoint === input.endpoint ? 0 : path.getTotalLength(),
      );
      const routeMatrix = path.getCTM(); const centerMatrix = center.getCTM();
      if (!routeMatrix || !centerMatrix) return null;
      const routeScreen = new DOMPoint(routePoint.x, routePoint.y).matrixTransform(routeMatrix);
      const centerScreen = new DOMPoint(
        center.cx.baseVal.value, center.cy.baseVal.value,
      ).matrixTransform(centerMatrix);
      return Math.hypot(routeScreen.x - centerScreen.x, routeScreen.y - centerScreen.y);
    }, { id, endpoint });
    expect(fusionGap).not.toBeNull();
    expect(fusionGap).toBeLessThan(0.5);
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
  expect(bridgeCount).toBeLessThan(250);
  expect(Number(await diagram.getAttribute("data-wire-turns"))).toBeLessThan(350);
  expect(Number(await diagram.getAttribute("data-wire-length"))).toBeLessThan(125_000);
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
  expect(junctionOutlines).toHaveLength(4);
  expect(new Set(junctionOutlines.map((outline) => JSON.stringify(outline))).size).toBe(1);
  expect(junctionOutlines[0]).toMatchObject({
    rectangles: 1,
    fill: "rgb(29, 48, 57)",
    stroke: "rgb(246, 199, 68)",
  });
  expect(junctionOutlines[0].dash).not.toBe("none");
  const firstPort = page.locator(".diagram-port").first();
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
  await expect(page.locator('[data-boundary-port="true"][data-port-side="input"]')).toHaveCount(1);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="output"]')).toHaveCount(3);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="neutral"]')).toHaveCount(2);
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
  await expect(diagram).toHaveAttribute("data-visible-device-count", "11");
  await expect(diagram).toHaveAttribute("data-visible-wire-count", "27");
  await expect(diagram).toHaveAttribute("data-escape-navigation", "back-to-system");
  await expect(page.locator(".diagram-boundary-glands rect")).toHaveCount(15);
  await expect(page.locator(".diagram-boundary-glands text")).toHaveCount(0);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="input"]')).toHaveCount(2);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="output"]')).toHaveCount(13);
  await expect(page.locator('[data-boundary-port="true"][data-port-side="neutral"]')).toHaveCount(0);
  expect(Number(await diagram.getAttribute("data-bridged-wire-crossings"))).toBeLessThan(100);
  for (const [id, label] of [
    ["secondaryPositiveBus", "Secondary 24 V positive bus · 100 A"],
    ["secondaryNegativeBus", "Secondary 24 V negative bus · 100 A"],
    ["sharedServicesBreaker", "Shared switched services · 10 A · 240 W"],
    ["orionBreaker32", "Orion input · 32 A"],
    ["chargeItBreaker32", "ChargeIT! branch · 32 A"],
    ["switchPanel", "Six-gang service switch panel"],
    ["unifiPower", "UniFi 24 V to 5 V USB-A converter"],
    ["starlinkBreakout", "Starlink factory-lead breakout"],
  ]) {
    await expect(page.locator(`[data-device-id="${id}"]`)).toHaveAttribute("aria-label", label);
  }
  await expect(page.locator(".diagram-wire-join-node")).toHaveCount(4);
  for (const id of [
    "serviceSplit", "internetSplit", "starlinkBreakout", "outdoorLightBreakout",
  ]) {
    const join = page.locator(`[data-device-id="${id}"]`);
    await expect(join).toHaveClass(/diagram-wire-join-node/);
    await expect(join.locator(":scope > rect")).toHaveCount(0);
    await expect(join.locator(":scope > .diagram-wire-join-arm")).toHaveCount(3);
  }
  for (const removedId of ["serviceReturnSplit", "lightingReturnSplit", "internetReturnSplit"]) {
    await expect(page.locator(`[data-device-id="${removedId}"]`)).toHaveCount(0);
  }
  await expect(page.locator('.diagram-port[data-boundary-port="false"][data-endpoint-id="secondaryNegativeBus.post2"]'))
    .toHaveAttribute("aria-label", /Victron Orion/);
  await expect(page.locator('[data-boundary-port="true"][aria-label*="Victron Ekrano GX"]')).toHaveCount(2);
  await expect(page.locator(".diagram-subpatch-frame, .diagram-patcher-background")).toHaveCount(0);
  await expect(page.locator(".graph-inspector")).toHaveCount(0);
  await page.locator('[data-device-id="serviceSplit"]').click();
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
  await page.locator('[aria-label="PV protection / combiner junction box"]').click();
  await expect(diagram).toHaveAttribute("data-junction-id", "pvJunction");
  await expect(diagram).toHaveAttribute("data-visible-device-count", "5");
  await expect(diagram).toHaveAttribute("data-visible-wire-count", "15");
  await expect(page.locator(".diagram-rigid-rail-node")).toHaveCount(1);
  await expect(page.locator(".diagram-rigid-rail-core")).toHaveCount(2);
  await expect(page.locator(".diagram-rigid-rail-tooth")).toHaveCount(8);
  await page.getByRole("button", { name: "Back to full-system diagram" }).click();
  await page.locator('[aria-label="AC input / output protection box"]').click();
  await expect(diagram).toHaveAttribute("data-junction-id", "acJunction");
  await expect(page.locator(".diagram-wire-join-node")).toHaveCount(7);
  for (const id of ["generatorAcBreakout", "acInputCableBreakout", "acOutputCableBreakout", "toolAcBreakout"]) {
    const breakout = page.locator(`[data-device-id="${id}"]`);
    await expect(breakout).toHaveClass(/diagram-wire-join-node/);
    await expect(breakout.locator(":scope > rect")).toHaveCount(0);
    await expect(breakout.locator(":scope > .diagram-wire-join-arm")).toHaveCount(4);
  }
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
  await page.locator(".graph-inspector").getByRole("button", { name: /12 V cigarette-lighter socket A/ }).click();
  await expect(page.locator(".graph-current-safety")).toHaveAttribute("data-current-safety-status", "incomplete");
  await expect(page.locator(".graph-current-safety")).toContainText("30 A declared ampacity");
  await expect(page.locator(".graph-current-safety")).toContainText("60 A prospective fault contribution");
  await page.locator('[aria-label="Victron Orion-Tr Smart 24/12-30"]').click();
  await page.locator(".graph-inspector").getByRole("button", {
    name: /From Six-gang service switch panel/,
  }).click();
  await expect(page.getByText("usbOrion.remoteH", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", {
    name: /Six-gang service switch panel.*To Victron Orion-Tr Smart 24\/12-30/,
  })).toBeVisible();
  await page.locator('[aria-label="PV panel 1 · string A"]').click();
  await expect(page.getByRole("heading", { name: "PV panel 1 · string A" })).toBeVisible();
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
  await expect(sharedServicesBreaker).toContainText("Unselected generic 10 A DC shared switched-services breaker");
  await expect(sharedServicesBreaker).toContainText("Select and buy");
  for (const id of ["dse-junction-box", "dse-ac-install-enclosure", "dse-service-spares", "dse-switch-accessories", "dse-earth-bus-cover"]) {
    await expect(page.locator(`[data-bom-id="${id}"]`)).toHaveCount(0);
  }
  for (const id of ["dse-airic-npt-cable-glands", "dse-ventilated-ip65-enclosure", "dse-pg11-cable-glands", "dse-mollom-8-way-enclosure-second", "dse-shirbly-2awg-cable-pairs"]) {
    const row = page.locator(`[data-bom-id="${id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Purchased");
  }
  for (const id of ["dse-airic-npt-cable-glands", "dse-pg11-cable-glands", "dse-shirbly-2awg-cable-pairs"]) {
    const row = page.locator(`[data-bom-id="${id}"]`);
    await expect(row).toContainText(/unallocated/i);
  }
  for (const id of ["dse-ventilated-ip65-enclosure", "dse-mollom-8-way-enclosure-second"]) {
    const row = page.locator(`[data-bom-id="${id}"]`);
    await expect(row).toContainText(/R28 fit is accepted and verified/i);
  }
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
  await expect(model).toHaveAttribute("data-runtime-source", "precomputed");
  await expect(model).toHaveAttribute("data-route-solve-ms", "0.0");
  await expect(model).toHaveAttribute("data-runtime-hydrate-ms", /\d+\.\d{3}/);
  await expect(model).toHaveAttribute("data-wire-profile", "constant-radius-octagon");
  await expect(model).toHaveAttribute("data-wire-radial-segments", "8");
  await expect(model).toHaveAttribute("data-wire-tessellation", "piece-weighted-minimum-eight-segments-per-bend");
  await expect(model).toHaveAttribute("data-wire-min-bend-segments", "8");
  await expect(model).toHaveAttribute("data-wire-terminal-tangent-errors", "0");
  await expect(model).toHaveAttribute("data-unused-terminal-opacity", "0.5");
  await expect(model).toHaveAttribute("data-unused-terminal-count", "19");
  await expect(model).toHaveAttribute("data-conductor-usage", "field-routes-plus-reciprocal-internal-mates");
  await expect(model).toHaveAttribute("data-pe-bus-rendering", "rectangular-busbar");
  await expect(model).toHaveAttribute("data-breakout-rendering", "true-y-two-way-plus-minus-45-three-way-red-45-black-0-green-minus-45");
  await expect(model).toHaveAttribute("data-cable-breakout-count", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-integrated-cable-breakout-count", "2");
  await expect(model).toHaveAttribute("data-integrated-breakout-rendering",
    "external-fusion-trimmed-depth-tested-core-fan");
  await expect(model).toHaveAttribute("data-usb-outlet-rendering", "metadata-driven-usb-c-pill-usb-a-rectangle");
  await expect(model).toHaveAttribute("data-usb-c-outlet-count", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-usb-a-outlet-count", "5");
  await expect(model).toHaveAttribute("data-wire-join-rendering", "presentation-driven-selectable-y");
  await expect(model).toHaveAttribute("data-wire-join-count", /[1-9]\d*/);
  await expect(model).toHaveAttribute("data-supplied-busbar-cover-count", "4");
  await expect(model).toHaveAttribute("data-smart-shunt-rendering", "uncovered-monitor-body");
  await expect(model).toHaveAttribute("data-wall-shadow", "casts-and-receives");
  await expect(model).toHaveAttribute("data-wall-penetrations", "1");
  await expect(model).toHaveAttribute("data-battery-cutoff-breaker-order",
    "batteryBreakerA,batteryBreakerB,mpptBreaker");
  await expect(model).toHaveAttribute("data-secondary-services-breaker-order",
    "sharedServicesBreaker,orionBreaker32,chargeItBreaker32");
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
  await expect(page.locator('[data-bom-total="design"]')).toContainText("$9,943.15");
  await expect(page.locator('[data-bom-total="design"]')).toContainText("Solar + internet only");
  await expect(page.locator('[data-bom-total="additional"]')).toContainText("$3,338.52");
  await expect(page.locator('[data-bom-total="additional"]')).toContainText("11 rows");
  await expect(page.locator('[data-bom-id="dse-switch-array"]')).toBeVisible();
  await page.getByRole("button", { name: "Show Items To Purchase" }).click();
  await expect(page.locator('[data-bom-id="dse-switch-array"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-ex-labor"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-ex-mount"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-multiplus"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-pv-string-breakers"]')).toHaveCount(0);
  await expect(page.locator('[data-bom-id="dse-switched-load-breaker"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Show All" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^Weight/ }).click();
  await expect(page.getByRole("columnheader", { name: /^Weight/ })).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("button", { name: /^Cost/ }).click();
  await expect(page.getByRole("columnheader", { name: /^Cost/ })).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("button", { name: /^Status/ }).click();
  await expect(page.getByRole("columnheader", { name: /^Status/ })).toHaveAttribute("aria-sort", "ascending");
});

test("Shipping treemap includes every imported physical BOM line", async ({ page }) => {
  await page.getByRole("button", { name: "Shipping" }).click();
  await expect(page.getByRole("heading", { name: "Shipping by weight" })).toBeVisible();
  await expect(page.locator(".shipping-tile")).toHaveCount(82);
  await expect(page.getByText("50.5 kg", { exact: true })).toBeVisible();
  await expect(page.locator(".shipping-legend")).toContainText("Power & control");
});

test("Customs uses concise columns, invoice footnotes, grouping and conditional private receipt download", async ({ page }) => {
  await page.getByRole("button", { name: "Customs" }).click();
  const manifest = page.locator(".customs-table");
  await expect(manifest.getByRole("columnheader")).toHaveCount(9);
  await expect(manifest.getByRole("columnheader", { name: "ASIN" })).toBeVisible();
  await expect(manifest.getByRole("columnheader", { name: "Make / model" })).toBeVisible();
  await expect(manifest.getByRole("columnheader", { name: "Ref" })).toBeVisible();
  await expect(manifest.locator("th.customs-fjd-column")).toBeHidden();
  await expect(manifest.getByRole("columnheader", { name: /Weight|Condition|Bag|Case/i })).toHaveCount(0);
  await expect(page.getByLabel("Business name / Fiji consignee")).toHaveValue("Drua Saing Experiences Pte Limited");
  await expect(page.getByLabel("Business registration number")).toHaveValue("2020RC000914");
  await expect(page.getByLabel("TIN", { exact: true })).toHaveValue("2900306318");
  await expect(page.getByLabel("Traveler / importer")).toHaveValue("Kyle McDonald");
  await expect(page.getByLabel("Flight number")).toHaveValue("FJ811");
  await expect(page.getByLabel("Arrival date in Fiji")).toHaveValue("2026-08-30");
  await expect(page.getByLabel("Final destination")).toHaveValue("Fulaga, Lau Group");
  await expect(page.getByLabel(/Passport number|Licensed customs agent|Customs Entry \/ SAD reference|Concession approval reference|TAF permit reference/i)).toHaveCount(0);
  await expect(page.getByLabel("Ubiquiti / UniFi Express serial numbers")).toHaveValue("942A6F249E89");
  await expect(page.getByLabel("Victron / Ekrano GX serial numbers")).toHaveValue("HQ2509RURDF");
  await expect(page.locator('[data-customs-id="dse-ekrano-gx"] input[aria-label$="country of origin"]')).toHaveValue("");
  await expect(page.locator('[data-customs-id="dse-ekrano-gx"] input[aria-label$="country of origin"]')).toHaveAttribute("placeholder", "N/A");
  const firstEight = manifest.locator("tbody tr").first().locator("xpath=..//tr[position() <= 8]");
  await expect(firstEight).toHaveCount(8);
  for (let index = 0; index < 8; index += 1) await expect(manifest.locator("tbody tr").nth(index)).toHaveAttribute("data-taf", "true");
  await expect(page.locator(".customs-invoice-index tbody tr")).toHaveCount(36);
  await expect(page.locator('[data-customs-id="dse-router"]')).toHaveAttribute("data-receipt-missing", "false");
  await expect(page.locator('[data-customs-id="dse-router"]')).not.toContainText("PDF not provided");
  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toBe("dse-fiji-customs-manifest.csv");
  const csvStream = await csvDownload.createReadStream();
  let csvText = "";
  for await (const chunk of csvStream) csvText += chunk.toString();
  expect(csvText).toContain('"Make / model"');
  expect(csvText).toContain('"Ubiquiti / UniFi Express\nUX-US"');
  for (const id of ["dse-chtai-ac-rcbos-rejected", "dse-ac-30a-rejected", "dse-mppt-wirebox-mc4-rejected", "dse-b125-chtaixi-unused", "dse-battery-string-breakers-midnite-unused", "dse-pv-breakers-32a-rejected", "dse-usb-output-breaker", "dse-starlink-portable-battery-cable", "dse-personal-garmin-montana-710i", "dse-personal-flexsolar-panels", "dse-personal-takoci-hx870-batteries"]) {
    await expect(page.locator(`[data-customs-id="${id}"]`)).toHaveCount(0);
  }
  const typography = await page.locator('[data-customs-id="dse-router"]').evaluate((row) => ({
    asin: getComputedStyle(row.querySelector(".customs-asin-cell")).fontSize,
    total: getComputedStyle(row.querySelector(".customs-total-cell")).fontSize,
    itemDivider: getComputedStyle(row.children[1]).borderBottomColor,
    quantityDivider: getComputedStyle(row.children[3]).borderBottomColor,
    originDivider: getComputedStyle(row.children[4]).borderBottomColor,
    unitValueDivider: getComputedStyle(row.children[5]).borderBottomColor,
  }));
  expect(typography.asin).toBe(typography.total);
  expect(typography.itemDivider).not.toBe("rgba(0, 0, 0, 0)");
  expect(typography.itemDivider).not.toBe("transparent");
  expect([typography.quantityDivider, typography.originDivider, typography.unitValueDivider])
    .toEqual([typography.itemDivider, typography.itemDivider, typography.itemDivider]);
  await page.getByRole("button", { name: "Group low-cost accessories" }).click();
  await expect(page.locator('[data-customs-id="miscellaneous-electrical-accessories"]')).toBeVisible();
  await expect(manifest.locator("tbody tr").last()).toHaveAttribute("data-customs-id", "miscellaneous-electrical-accessories");
  await expect(page.getByText(/Optional presentation for broker review/)).toBeVisible();
  const privateMode = await page.locator(".customs-view").getAttribute("data-private-mode");
  await expect(page.getByRole("link", { name: "Download receipts (.zip)" }))
    .toHaveCount(privateMode === "true" ? 1 : 0);
});

test("Customs print export ends at the invoice table and uses filing columns", async ({ page }) => {
  await page.getByRole("button", { name: "Customs" }).click();
  await page.emulateMedia({ media: "print" });

  const manifest = page.locator(".customs-table");
  await expect(manifest.locator("th.customs-fjd-column")).toBeVisible();
  await expect(manifest.locator("th.customs-fjd-column")).toHaveText("Total FJD");
  await expect(manifest.locator("th.customs-serial-column")).toBeHidden();
  await expect(page.locator('[data-customs-id="dse-ekrano-gx"] .customs-serial-print')).toHaveText("Serial: HQ2509RURDF");
  await expect(page.locator('[data-customs-id="dse-ekrano-gx"] .customs-serial-print')).toBeVisible();
  await expect(page.locator(".customs-purpose-editor")).toBeHidden();
  await expect(page.locator(".customs-purpose-print")).toBeVisible();
  await expect(page.locator(".customs-invoice-index")).toBeVisible();
  await expect(page.locator(".customs-export-excluded")).toHaveCount(2);
  for (const excluded of await page.locator(".customs-export-excluded").all()) await expect(excluded).toBeHidden();
  await expect(page.getByText("Commercial / project equipment · accompanied baggage", { exact: true })).toHaveCount(0);
  const printDividers = await page.locator('[data-customs-id="dse-router"]').evaluate((row) => ({
    itemBorderWidth: getComputedStyle(row.children[1]).borderBottomWidth,
    fieldCellBorderWidths: [3, 4, 5].map((index) => getComputedStyle(row.children[index]).borderBottomWidth),
    fieldInputBorderWidths: [3, 4, 5].map((index) => getComputedStyle(row.children[index].querySelector("input")).borderBottomWidth),
  }));
  expect(printDividers.itemBorderWidth).not.toBe("0px");
  expect(printDividers.fieldCellBorderWidths).toEqual([
    printDividers.itemBorderWidth, printDividers.itemBorderWidth, printDividers.itemBorderWidth,
  ]);
  expect(printDividers.fieldInputBorderWidths).toEqual(["0px", "0px", "0px"]);
});
