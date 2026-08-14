import { test, expect } from "@playwright/test";

async function openViewer(page) {
  await page.goto("/");
  await expect(page.locator('[data-viewer-ready="true"]')).toBeVisible();
}

async function diagramLabelOverlaps(page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll("[data-edge-id] .edge-label")].map((element) => ({
      id: element.closest("[data-edge-id]")?.getAttribute("data-edge-id"),
      rect: element.getBoundingClientRect(),
    }));
    const nodes = [...document.querySelectorAll("[data-node-id]")].map((element) => ({
      id: element.getAttribute("data-node-id"),
      rect: element.getBoundingClientRect(),
    }));
    const overlaps = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const collisions = [];

    for (const label of labels) {
      for (const node of nodes) {
        if (overlaps(label.rect, node.rect)) collisions.push(`${label.id}:${node.id}`);
      }
    }
    for (let index = 0; index < labels.length; index += 1) {
      for (let other = index + 1; other < labels.length; other += 1) {
        if (overlaps(labels[index].rect, labels[other].rect)) {
          collisions.push(`${labels[index].id}:${labels[other].id}`);
        }
      }
    }
    return collisions;
  });
}

async function labelDistanceToConnection(page, labelEdgeId, pathEdgeId) {
  return page.evaluate(
    ({ labelEdgeId: labelId, pathEdgeId: pathId }) => {
      const label = document.querySelector(`[data-edge-id="${labelId}"] .edge-label`);
      const path = /** @type {SVGPathElement | null} */ (
        document.querySelector(`[data-edge-id="${pathId}"] .edge-line`)
      );
      if (!label || !path) throw new Error(`Missing diagram edge ${labelId} or ${pathId}`);
      const labelRect = label.getBoundingClientRect();
      const labelCenter = {
        x: (labelRect.left + labelRect.right) / 2,
        y: (labelRect.top + labelRect.bottom) / 2,
      };
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error(`Connection ${pathId} has no screen transform`);
      const pathLength = path.getTotalLength();
      let nearest = Number.POSITIVE_INFINITY;

      for (let sample = 0; sample <= 240; sample += 1) {
        const point = path.getPointAtLength((pathLength * sample) / 240);
        const screenPoint = {
          x: point.x * matrix.a + point.y * matrix.c + matrix.e,
          y: point.x * matrix.b + point.y * matrix.d + matrix.f,
        };
        nearest = Math.min(
          nearest,
          Math.hypot(screenPoint.x - labelCenter.x, screenPoint.y - labelCenter.y),
        );
      }
      return nearest;
    },
    { labelEdgeId, pathEdgeId },
  );
}

async function modelLabelOverlaps(page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll('.model-label.view-visible[data-on-screen="true"]')]
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => ({
        id: element.getAttribute("data-model-label"),
        rect: element.getBoundingClientRect(),
      }));
    const collisions = [];
    for (let index = 0; index < labels.length; index += 1) {
      for (let other = index + 1; other < labels.length; other += 1) {
        const a = labels[index].rect;
        const b = labels[other].rect;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          collisions.push(`${labels[index].id}:${labels[other].id}`);
        }
      }
    }
    return collisions;
  });
}

test("DSE diagram, system summary, BOM and field notes are interactive", async ({ page }) => {
  await openViewer(page);
  await expect(page).toHaveTitle(/DSE & PG Solar Systems/);
  await expect(page.getByRole("button", { name: /MultiPlus-II 24\/3000/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /SmartSolar MPPT 150\/85-Tr/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ekrano GX/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /String selector/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /AC output protection/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Trailing tool lead/ })).toBeVisible();
  await expect(page.locator('[data-region-key="junctionBox"]')).toContainText(
    "inside / through compact junction box",
  );
  await expect(page.locator('[data-contained-in="junctionBox"]')).toHaveCount(3);
  await expect(page.locator('[data-node-id="inverter"]')).not.toHaveAttribute(
    "data-contained-in",
    "junctionBox",
  );
  await expect(page.getByRole("dialog", { name: "Component details" })).toHaveCount(0);
  await expect(page.getByText(/^Single-line view:/)).toHaveCount(0);

  expect(await diagramLabelOverlaps(page)).toEqual([]);

  await page.getByRole("button", { name: /MultiPlus-II 24\/3000/ }).click();
  await expect(page.getByRole("dialog", { name: "Component details" })).toBeVisible();
  await expect(page.getByText(/IP22 and 95% non-condensing/)).toBeVisible();
  await page.getByRole("button", { name: "Close component details" }).first().click();
  await expect(page.getByRole("dialog", { name: "Component details" })).toHaveCount(0);

  await page.getByRole("button", { name: "Detailed wiring" }).click();
  await expect(page.getByRole("button", { name: /Panel 1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ekrano GX/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Battery 3/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /2 × battery balancers/ })).toBeVisible();
  await expect(page.locator('[data-edge-id="dt-pv-a"] .edge-label')).toContainText("A · 4 mm² pair");
  await expect(page.locator('[data-edge-id="dt-pv-b"] .edge-label')).toContainText("B · 4 mm² pair");
  await expect(page.locator('[data-edge-id="dt-ac-tools"] .edge-label')).toContainText(
    "3 m flexible lead",
  );
  await expect(page.locator('[data-contained-in="junctionBox"]')).toHaveCount(4);
  expect(await diagramLabelOverlaps(page)).toEqual([]);
  await page.getByRole("button", { name: /Panel 1/ }).click();
  await expect(page.getByRole("heading", { name: "Panel 1" })).toBeVisible();

  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Drua Sailing Experience" })).toBeVisible();
  await expect(page.getByText("System at a glance")).toBeVisible();
  await expect(page.getByText("Scope boundary")).toBeVisible();
  await expect(page.getByText("One string can run")).toBeVisible();
  await expect(page.getByText(/\$251 below target/)).toBeVisible();

  await page.getByRole("button", { name: /Bill of materials/ }).click();
  await expect(page.getByText("$8,758").first()).toBeVisible();
  await expect(page.getByText(/\$607 donor-funded/).first()).toBeVisible();
  await page.getByLabel("Search bill of materials").fill("Ekrano");
  await expect(page.getByText("Victron Ekrano GX BPP900480100")).toBeVisible();
  await page.getByLabel("Search bill of materials").fill("junction box");
  await expect(page.getByText(/Compact IP-rated junction box/)).toBeVisible();
  await page.getByLabel("Search bill of materials").fill("preterminated");
  await expect(page.getByText(/Custom preterminated 1\/0 AWG/)).toBeVisible();

  await page.getByRole("button", { name: "Field notes" }).click();
  await expect(page.getByRole("heading", { name: "Commissioning checklist" })).toBeVisible();
  await expect(page.getByText(/reduce the Ekrano DVCC charge-current limit from 100 A to 50 A/)).toBeVisible();
});

test("DSE 3D model is scale-aware, navigable and connected to component details", async ({ page }) => {
  test.setTimeout(60_000);
  await openViewer(page);
  await page.getByRole("button", { name: "3D model" }).click();
  await expect(page.locator('[data-model-ready="true"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".model-shell")).toHaveAttribute("data-routing-backtracking-corners", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-routing-discontinuous-handoffs", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-routing-obstacle-intersections", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-routing-board-conflicts", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-routing-unresolved-crossings", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-battery-arrangement", "floor-2x2");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-junction-back-routes", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-roof-planes", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-side-walls", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-wall-overlaps", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-shadow-map-size", "4096");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-solver-route-count", /[1-9]\d*/);
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-generated-cable-m", /\d+\.\d+/);

  const canvas = page.getByRole("img", { name: /three-dimensional model of the Drua Sailing Experience/i });
  await expect(canvas).toBeVisible();
  await expect(page.getByText("1 unit = 1 m · verified envelopes / assumed site")).toBeVisible();
  await expect(page.getByText("3-core AC flex")).toBeVisible();
  for (const view of ["Whole site", "Solar array", "Equipment wall", "Battery bank", "Open junction box"]) {
    await expect(page.getByRole("button", { name: view })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Show labels" })).toBeVisible();
  await expect(page.locator(".model-label.view-visible")).toHaveCount(0);
  await page.waitForTimeout(1_100);
  expect(await modelLabelOverlaps(page)).toEqual([]);

  await page.getByRole("button", { name: "Scale notes" }).click();
  await expect(page.getByRole("heading", { name: /Physical envelopes are separated/ })).toBeVisible();
  await expect(page.getByText(/5.8 m back-wall span/)).toBeVisible();
  await expect(page.getByText(/Side walls and roof planes are intentionally omitted/)).toBeVisible();
  await expect(page.getByText(/four batteries form a floor-level 2 × 2 grid/i)).toBeVisible();
  await expect(page.getByText(/Ordinary power conductors begin about 35 mm/)).toBeVisible();
  await expect(page.getByText(/one continuous tube surface, so back-to-back bends share their polygon rings without gaps/i)).toBeVisible();
  await expect(page.getByText(/visible XYZ point below the mouse or touch gesture becomes the grab point/i)).toBeVisible();
  await expect(page.getByText(/0 reverse bends/)).toBeVisible();
  await expect(page.getByText(/14 tangent handoffs · 0 discontinuous handoffs/)).toBeVisible();
  await expect(page.getByText(/0 board-lane conflicts/)).toBeVisible();
  await expect(page.getByText(/0 solid intersections · 0 unresolved cable intersections/)).toBeVisible();
  await page.getByRole("button", { name: "Close scale notes" }).click();
  await page.getByRole("button", { name: "Show labels" }).click();
  await expect(page.getByRole("button", { name: "Hide labels" })).toBeVisible();

  await page.getByRole("button", { name: "Solar array" }).click();
  await page.waitForTimeout(1_100);
  await expect(page.locator('[data-model-label="north"]')).toContainText("18° tilt");
  await expect(page.locator('[data-model-label="panel1"]')).toBeVisible();
  await expect(page.locator('[data-model-label="panel4"]')).toBeVisible();
  await expect(page.locator('[data-model-label^="zone-"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Equipment wall" }).click();
  await page.waitForTimeout(1_100);
  await expect(page.locator('[data-model-label="multiplus"]')).toBeVisible();
  await expect(page.locator('[data-model-label="lights"]')).toContainText("6 × 12 V lights");
  await expect(page.locator('[data-model-label="earth-bar"]')).toContainText("Main PE bar");
  await expect(page.locator('[data-model-label="multiplus"]')).toHaveCSS("pointer-events", "none");
  await expect(page.locator('[data-model-label="multiplus"]')).toHaveCSS("user-select", "none");
  expect(await page.locator('[data-model-label="multiplus"]').evaluate((element) => element.tagName)).toBe("DIV");

  await page.getByRole("button", { name: "Battery bank" }).click();
  await page.waitForTimeout(1_100);
  await expect(page.locator('[data-model-label="battery1"]')).toBeVisible();
  await expect(page.locator('[data-model-label="battery4"]')).toBeVisible();

  await page.getByRole("button", { name: "Open junction box" }).click();
  await page.waitForTimeout(1_100);
  await expect(page.locator('[data-model-label="ekrano"]')).toBeVisible();
  await expect(page.locator('[data-model-label="selector"]')).toBeVisible();
  await expect(page.locator('[data-model-label="shunt-battery"]')).toContainText("BATTERY MINUS");
  await expect(page.locator('[data-model-label="shunt-system"]')).toContainText("SYSTEM MINUS");
  await expect(page.locator('[data-model-label="bus-positive"]')).toContainText("24 V + BUS");
  await expect(page.locator('[data-model-label="bus-negative"]')).toContainText("24 V − BUS");
  await expect(page.locator('[data-model-label="fuse-block"]')).toBeVisible();
  await expect(page.locator('[data-model-label="fuse-block"]')).toContainText("Starlink 10 A");
  await expect(page.locator('[data-model-label="return-bus"]')).toContainText("black wires bypass every fuse");
  await page.getByRole("button", { name: "Hide labels" }).click();
  await expect(page.locator(".model-label.view-visible")).toHaveCount(0);

  const modelStage = page.locator(".model-stage");
  const modelBox = await modelStage.boundingBox();
  if (!modelBox) throw new Error("3D model stage was not rendered");
  const pageScrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(modelBox.x + modelBox.width * 0.6, modelBox.y + modelBox.height * 0.55);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);

  await page.getByRole("button", { name: "Equipment wall" }).click();
  await page.waitForTimeout(1_100);
  await page.mouse.move(modelBox.x + modelBox.width * 0.5, modelBox.y + modelBox.height * 0.52);
  await page.locator(".model-canvas canvas").evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    for (let index = 0; index < 28; index += 1) {
      canvas.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width * 0.5,
        clientY: rect.top + rect.height * 0.52,
        deltaY: -240,
      }));
    }
  });
  await page.waitForTimeout(350);
  const closeCamera = await page.locator(".model-canvas").evaluate((element) => ({
    control: element.dataset.cameraControl,
    distance: Number(element.dataset.cameraDistance),
    panWorldPerPixel: Number(element.dataset.panWorldPerPixel),
    target: (element.dataset.cameraTarget ?? "").split(",").map(Number),
  }));
  expect(closeCamera.control).toBe("grab-point-upright-orbit");
  expect(closeCamera.distance).toBeLessThan(0.35);
  expect(closeCamera.panWorldPerPixel).toBeGreaterThan(0);

  await page.keyboard.down("Shift");
  await page.mouse.down({ button: "left" });
  await page.mouse.move(
    modelBox.x + modelBox.width * 0.68,
    modelBox.y + modelBox.height * 0.52,
    { steps: 10 },
  );
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("Shift");
  await page.waitForTimeout(350);
  const panned = await page.locator(".model-canvas").evaluate((element) => ({
    anchorScreen: (element.dataset.grabAnchorScreen ?? "").split(",").map(Number),
    target: (element.dataset.cameraTarget ?? "").split(",").map(Number),
  }));
  expect(Math.hypot(...panned.target.map((value, index) => value - closeCamera.target[index]))).toBeGreaterThan(0.001);
  expect(Math.hypot(
    panned.anchorScreen[0] - modelBox.width * 0.68,
    panned.anchorScreen[1] - modelBox.height * 0.52,
  )).toBeLessThan(3);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
});

test("3D grab camera keeps the picked XYZ point fixed under cursor for zoom and orbit", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "3D model" }).click();
  await expect(page.locator('[data-model-ready="true"]')).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Equipment wall" }).click();
  await page.waitForTimeout(900);

  const canvas = page.locator(".model-canvas canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("3D model canvas was not rendered");
  const localAnchor = { x: canvasBox.width * 0.55, y: canvasBox.height * 0.42 };
  const pointerAnchor = { x: canvasBox.x + localAnchor.x, y: canvasBox.y + localAnchor.y };
  const cameraState = () => page.locator(".model-canvas").evaluate((element) => ({
    anchorScreen: (element.dataset.grabAnchorScreen ?? "").split(",").map(Number),
    anchorSource: element.dataset.grabAnchorSource,
    anchorWorld: (element.dataset.grabAnchorWorld ?? "").split(",").map(Number),
    control: element.dataset.cameraControl,
    mode: element.dataset.grabMode,
    position: (element.dataset.cameraPosition ?? "").split(",").map(Number),
    quaternion: (element.dataset.cameraQuaternion ?? "").split(",").map(Number),
    uprightError: Number(element.dataset.cameraUprightError),
  }));

  const beforeZoom = await cameraState();
  await page.mouse.move(pointerAnchor.x, pointerAnchor.y);
  await page.mouse.wheel(0, -180);
  await page.waitForTimeout(200);
  const afterZoom = await cameraState();
  expect(afterZoom.control).toBe("grab-point-upright-orbit");
  expect(afterZoom.anchorSource).toBe("surface");
  expect(Math.hypot(
    afterZoom.anchorScreen[0] - localAnchor.x,
    afterZoom.anchorScreen[1] - localAnchor.y,
  )).toBeLessThan(2);
  expect(Math.hypot(...afterZoom.position.map((value, index) => value - beforeZoom.position[index]))).toBeGreaterThan(0.1);

  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(80);
  const grabbed = await cameraState();
  expect(grabbed.mode).toBe("orbit");
  await page.mouse.move(pointerAnchor.x + 100, pointerAnchor.y + 55, { steps: 10 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(200);
  const afterOrbit = await cameraState();
  expect(afterOrbit.mode).toBe("idle");
  expect(Math.hypot(
    afterOrbit.anchorScreen[0] - localAnchor.x,
    afterOrbit.anchorScreen[1] - localAnchor.y,
  )).toBeLessThan(2);
  expect(Math.hypot(...afterOrbit.anchorWorld.map((value, index) => value - grabbed.anchorWorld[index]))).toBeLessThan(0.002);
  expect(Math.hypot(...afterOrbit.quaternion.map((value, index) => value - grabbed.quaternion[index]))).toBeGreaterThan(0.01);
  expect(afterOrbit.uprightError).toBeLessThan(1e-5);
});

test("PG selection does not invent an unverified three-dimensional site layout", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "3D model" }).click();
  await page.getByRole("button", { name: /PG · PNG/ }).click();
  await expect(page.getByRole("heading", { name: /currently represents DSE/ })).toBeVisible();
  await expect(page.getByText(/has not been assigned speculative site geometry/)).toBeVisible();
  await page.getByRole("button", { name: "Open the DSE 3D model" }).click();
  await expect(page.locator('[data-model-ready="true"]')).toBeVisible({ timeout: 15_000 });
});

test("mobile layout fits iPhone Safari and the 3D camera supports one- and two-finger gestures", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openViewer(page);

  const diagramMetrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    headerHeight: document.querySelector(".app-header")?.getBoundingClientRect().height,
  }));
  expect(diagramMetrics.documentWidth).toBeLessThanOrEqual(diagramMetrics.viewportWidth + 1);
  expect(diagramMetrics.headerHeight).toBe(52);
  const modeTabs = page.locator(".mode-tabs");
  for (const mode of ["Diagram", "3D model", "System", /Bill of materials/, "Field notes"]) {
    await expect(modeTabs.getByRole("button", { name: mode, exact: typeof mode === "string" })).toBeVisible();
  }

  await page.getByRole("button", { name: "3D model" }).click();
  await expect(page.locator('[data-model-ready="true"]')).toBeVisible({ timeout: 15_000 });
  const canvas = page.locator(".model-canvas canvas");
  await expect(canvas).toHaveCSS("touch-action", "none");
  await expect(page.locator(".model-canvas")).toHaveAttribute(
    "data-touch-gestures",
    "one-finger-orbit-two-finger-pan-pinch",
  );
  const initial = await page.locator(".model-canvas").evaluate((element) => ({
    distance: Number(element.dataset.cameraDistance),
    position: (element.dataset.cameraPosition ?? "").split(",").map(Number),
    quaternion: (element.dataset.cameraQuaternion ?? "").split(",").map(Number),
    target: (element.dataset.cameraTarget ?? "").split(",").map(Number),
  }));

  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fire = (type, pointerId, x, y, isPrimary) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: "touch",
      isPrimary,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: rect.left + x,
      clientY: rect.top + y,
    }));
    fire("pointerdown", 21, rect.width * 0.52, rect.height * 0.45, true);
    fire("pointermove", 21, rect.width * 0.66, rect.height * 0.52, true);
    fire("pointerup", 21, rect.width * 0.66, rect.height * 0.52, true);
  });
  await page.waitForTimeout(100);
  const afterOrbit = await page.locator(".model-canvas").evaluate((element) => ({
    activeTouches: element.dataset.activeTouchPoints,
    quaternion: (element.dataset.cameraQuaternion ?? "").split(",").map(Number),
  }));
  expect(afterOrbit.activeTouches).toBe("0");
  expect(Math.hypot(...afterOrbit.quaternion.map((value, index) => value - initial.quaternion[index]))).toBeGreaterThan(0.01);

  await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const fire = (type, pointerId, x, y, isPrimary) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: "touch",
      isPrimary,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: rect.left + x,
      clientY: rect.top + y,
    }));
    fire("pointerdown", 31, rect.width * 0.38, rect.height * 0.48, true);
    fire("pointerdown", 32, rect.width * 0.62, rect.height * 0.48, false);
    fire("pointermove", 31, rect.width * 0.29, rect.height * 0.53, true);
    fire("pointermove", 32, rect.width * 0.76, rect.height * 0.53, false);
    fire("pointerup", 31, rect.width * 0.29, rect.height * 0.53, true);
    fire("pointerup", 32, rect.width * 0.76, rect.height * 0.53, false);
  });
  await page.waitForTimeout(100);
  const afterTransform = await page.locator(".model-canvas").evaluate((element) => ({
    activeTouches: element.dataset.activeTouchPoints,
    distance: Number(element.dataset.cameraDistance),
    position: (element.dataset.cameraPosition ?? "").split(",").map(Number),
    target: (element.dataset.cameraTarget ?? "").split(",").map(Number),
  }));
  expect(afterTransform.activeTouches).toBe("0");
  expect(afterTransform.distance).toBeLessThan(initial.distance);
  expect(Math.hypot(...afterTransform.position.map((value, index) => value - initial.position[index]))).toBeGreaterThan(0.1);
  expect(Math.hypot(...afterTransform.target.map((value, index) => value - initial.target[index]))).toBeGreaterThan(0.001);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await modeTabs.getByRole("button", { name: /Bill of materials/ }).click();
  const bomMetrics = await page.evaluate(() => {
    const wrap = document.querySelector(".bom-table-wrap");
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      tableScrollsInternally: Boolean(wrap && wrap.scrollWidth > wrap.clientWidth),
    };
  });
  expect(bomMetrics.documentWidth).toBeLessThanOrEqual(bomMetrics.viewportWidth + 1);
  expect(bomMetrics.tableScrollsInternally).toBe(true);

  await page.setViewportSize({ width: 844, height: 390 });
  await openViewer(page);
  const landscapeMetrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    headerHeight: document.querySelector(".app-header")?.getBoundingClientRect().height,
  }));
  expect(landscapeMetrics.documentWidth).toBeLessThanOrEqual(landscapeMetrics.viewportWidth + 1);
  expect(landscapeMetrics.headerHeight).toBe(52);
  await expect(page.getByRole("button", { name: /DSE · Fiji/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /PG · PNG/ })).toBeVisible();
  await page.getByRole("button", { name: "3D model", exact: true }).click();
  await expect(page.locator('[data-model-ready="true"]')).toBeVisible({ timeout: 15_000 });
  const landscapeModel = await page.locator(".model-shell").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { bottom: rect.bottom, viewportHeight: window.innerHeight, minHeight: getComputedStyle(element).minHeight };
  });
  expect(landscapeModel.bottom).toBeLessThanOrEqual(landscapeModel.viewportHeight + 1);
  expect(landscapeModel.minHeight).toBe("0px");
});

test("PG reference switches projects and preserves its source-grounded topology", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: /PG · PNG/ }).click();
  await expect(page.getByRole("button", { name: /Victron SmartSolar SCC/ })).toBeVisible();
  await page.getByRole("button", { name: "Detailed wiring" }).click();
  await expect(page.getByRole("button", { name: /125 A main breaker/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /12 → 48 V step-up/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /UniFi Express/ })).toBeVisible();
  await page.getByRole("button", { name: /UniFi Express/ }).click();
  await expect(page.getByText("Ethernet from Starlink")).toBeVisible();
});

test("DSE network uses the purchased UniFi Express directly from Starlink", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "Detailed wiring" }).click();
  await expect(page.locator('[data-edge-id="dt-router"]')).toHaveCount(0);
  await expect(page.locator('[data-edge-id="dt-usb-router"] .edge-label')).toContainText(
    "USB-C · 5 V / 3 A",
  );
  await page.getByRole("button", { name: /UniFi Express/ }).click();
  await expect(page.getByText(/Starlink Ethernet connects directly to the WAN port/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Component details" }).getByText("USB-C · 5 V / 3 A", { exact: true })).toBeVisible();
});

test("DSE uses one Ekrano GX for local and remote monitoring", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: /Ekrano GX/ }).click();
  await expect(page.getByText(/7-inch · 1024 × 600 touchscreen/)).toBeVisible();
  await expect(page.getByText(/Front IP54 with steel bracket · rear IP21/)).toBeVisible();
  await expect(page.getByText(/Hardwire Ethernet to the UniFi LAN port/i)).toBeVisible();
});

test("hovering a diagram connection highlights its line and label", async ({ page }) => {
  await openViewer(page);
  const edge = page.locator('[data-edge-id="ov-pv-1"]');
  const hitPath = edge.locator(".edge-hit");
  const labelRect = edge.locator(".edge-label rect");
  const line = edge.locator(".edge-line");
  const restingFill = await labelRect.evaluate((element) => getComputedStyle(element).fill);
  const midpoint = await hitPath.evaluate((element) => {
    const path = /** @type {SVGPathElement} */ (element);
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Connection path has no screen transform");
    return {
      x: point.x * matrix.a + point.y * matrix.c + matrix.e,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    };
  });

  await page.mouse.move(midpoint.x, midpoint.y);
  await expect(edge).toHaveCSS("cursor", "pointer");
  await expect.poll(() => labelRect.evaluate((element) => getComputedStyle(element).fill)).not.toBe(restingFill);
  await expect(labelRect).toHaveCSS("fill", "rgb(23, 109, 105)");
  await expect(line).toHaveCSS("stroke-width", "5px");
  await expect(page.locator(".diagram-edges > .diagram-edge").last()).toHaveAttribute(
    "data-edge-id",
    "ov-pv-1",
  );
});

test("Ekrano power and SmartShunt labels stay with their own connections", async ({ page }) => {
  await openViewer(page);
  for (const prefix of ["ov", "dt"]) {
    if (prefix === "dt") await page.getByRole("button", { name: "Detailed wiring" }).click();
    const shuntId = `${prefix}-gx-shunt`;
    const powerId = `${prefix}-gx-power`;
    expect(await labelDistanceToConnection(page, shuntId, shuntId)).toBeLessThan(
      await labelDistanceToConnection(page, shuntId, powerId),
    );
    expect(await labelDistanceToConnection(page, powerId, powerId)).toBeLessThan(
      await labelDistanceToConnection(page, powerId, shuntId),
    );
  }
});

test("diagram wheel zoom stays under the cursor and does not scroll the page", async ({ page }) => {
  await openViewer(page);
  const stage = page.locator(".diagram-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("Diagram stage was not rendered");

  const pageScrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.34);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(350);

  const zoomPercent = Number.parseInt(await page.locator(".zoom-controls > span").innerText(), 10);
  expect(zoomPercent).toBeGreaterThan(100);
  expect(zoomPercent).toBeLessThanOrEqual(110);
  await expect(page.locator(".diagram-stage svg > g")).not.toHaveAttribute("transform", "translate(0 0) scale(1)");
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
});
