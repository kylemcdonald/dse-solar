import { test, expect } from "@playwright/test";

async function openViewer(page) {
  await page.goto("/");
  await expect(page.locator('[data-viewer-ready="true"]')).toBeVisible({ timeout: 15_000 });
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

async function diagramEdgeNodeOverlaps(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll("[data-node-id]")].map((element) => ({
      id: element.getAttribute("data-node-id"),
      x: Number(element.getAttribute("x")),
      y: Number(element.getAttribute("y")),
      width: Number(element.getAttribute("width")),
      height: Number(element.getAttribute("height")),
    }));
    const overlaps = [];

    for (const group of document.querySelectorAll("[data-edge-id]")) {
      const path = /** @type {SVGPathElement | null} */ (group.querySelector(".edge-line"));
      if (!path) continue;
      const edgeId = group.getAttribute("data-edge-id");
      const endpoints = new Set([
        group.getAttribute("data-edge-from"),
        group.getAttribute("data-edge-to"),
      ]);
      const length = path.getTotalLength();
      const samples = Math.max(1, Math.ceil(length / 3));

      for (const node of nodes) {
        if (endpoints.has(node.id)) continue;
        let intersects = false;
        for (let index = 0; index <= samples; index += 1) {
          const point = path.getPointAtLength((length * index) / samples);
          if (
            point.x > node.x - 5 &&
            point.x < node.x + node.width + 5 &&
            point.y > node.y - 5 &&
            point.y < node.y + node.height + 5
          ) {
            intersects = true;
            break;
          }
        }
        if (intersects) overlaps.push(`${edgeId}:${node.id}`);
      }
    }
    return overlaps;
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

async function clickProjectedModelComponent(page, labelId, componentId) {
  const label = page.locator(`[data-model-label="${labelId}"]`);
  const labelBox = await label.boundingBox();
  if (!labelBox) throw new Error(`${labelId} projection label did not render`);
  const anchorX = Number(await label.getAttribute("data-anchor-x"));
  const anchorY = Number(await label.getAttribute("data-anchor-y"));
  const hit = await page.locator(".model-canvas").evaluate((mount, target) => {
    const canvas = mount.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    const centerX = Number.isFinite(target.anchorX) ? target.anchorX : rect.width / 2;
    const centerY = Number.isFinite(target.anchorY) ? target.anchorY : rect.height / 2;
    const left = Math.max(0, centerX - 220);
    const right = Math.min(rect.width, centerX + 220);
    const top = Math.max(0, centerY - 160);
    const bottom = Math.min(rect.height, centerY + 160);
    // Raycast in page context so locating a small visible mesh does not spend
    // tens of seconds on one cross-process mouse move per sample. The final
    // click remains a native Playwright mouse action through the real canvas.
    for (let y = top; y <= bottom; y += 4) {
      for (let x = left; x <= right; x += 4) {
        const clientX = rect.left + x;
        const clientY = rect.top + y;
        canvas.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          clientX,
          clientY,
          pointerType: "mouse",
        }));
        if (mount.dataset.hoveredComponent === target.componentId) {
          return { x: clientX, y: clientY };
        }
      }
    }
    return null;
  }, { anchorX, anchorY, componentId });
  if (!hit) throw new Error(`Could not find the rendered ${componentId} near its projected label`);
  await page.mouse.click(hit.x, hit.y);
}

test("DSE diagram, system summary, BOM and field notes are interactive", async ({ page }) => {
  await openViewer(page);
  await expect(page).toHaveTitle(/DSE & PG Solar Systems/);
  await expect(page.getByRole("button", { name: /MultiPlus-II 24\/3000/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /SmartSolar MPPT 150\/85-Tr/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ekrano GX/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Master battery disconnect/ })).toBeVisible();
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
  await expect(page.locator(".diagram-stage > svg")).toHaveAttribute("viewBox", "0 0 3456 2059");
  await expect(page.getByRole("button", { name: /Panel 1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ekrano GX/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Battery 3/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /2 × battery balancers/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /SmartShunt 500 A/ })).toBeVisible();
  await expect(page.locator('[data-node-id="mainDc"]')).toHaveCount(0);
  await expect(page.locator('[data-edge-id="dt-pv-a"] .edge-label')).toContainText("A · 4 mm² pair");
  await expect(page.locator('[data-edge-id="dt-pv-b"] .edge-label')).toContainText("B · 4 mm² pair");
  await expect(page.locator('[data-edge-id="dt-ac-tools"] .edge-label')).toContainText(
    "5 m Type I lead",
  );
  await expect(page.locator('[data-contained-in="junctionBox"]')).toHaveCount(7);
  expect(await diagramLabelOverlaps(page)).toEqual([]);
  expect(await diagramEdgeNodeOverlaps(page)).toEqual([]);
  await page.getByRole("button", { name: /Panel 1/ }).click();
  await expect(page.getByRole("heading", { name: "Panel 1" })).toBeVisible();

  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Drua Sailing Experience" })).toBeVisible();
  await expect(page.getByText("System at a glance")).toBeVisible();
  await expect(page.getByText("Scope boundary")).toBeVisible();
  await expect(page.getByText("Whole bank only")).toBeVisible();
  await expect(page.getByText(/\+\$60 remaining/)).toBeVisible();

  await page.getByRole("button", { name: /Bill of materials/ }).click();
  await expect(page.getByText("$9,068").first()).toBeVisible();
  await expect(page.getByText(/\$607 donor-funded/).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "LA delivery" })).toBeVisible();
  await page.getByLabel("Search bill of materials").fill("Ekrano");
  const ekranoRow = page.getByRole("row").filter({ hasText: "Victron Ekrano GX BPP900480100" });
  await expect(ekranoRow).toBeVisible();
  await expect(ekranoRow.getByText("Aug 16", { exact: true })).toBeVisible();
  await expect(ekranoRow.getByRole("link", { name: /Amazon · exact model/ })).toBeVisible();
  await expect(ekranoRow.getByRole("link", { name: /eBay · exact BPP900480100/ })).toBeVisible();
  await expect(ekranoRow.getByText("$619.65 · New · United States", { exact: true })).toBeVisible();
  await page.getByLabel("Search bill of materials").fill("PMP242305010");
  await expect(page.getByText(/Victron MultiPlus-II 24\/3000\/70-32/)).toBeVisible();
  await expect(page.getByText("Not on Amazon", { exact: true })).toBeVisible();
  await expect(page.getByText("Aug 19–28", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Off-Grid Source · exact model/ })).toBeVisible();
  await expect(page.getByText("No eBay match", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /No exact U.S. listing/ })).toBeVisible();
  await page.getByLabel("Search bill of materials").fill("junction box");
  await expect(page.getByText(/Compact IP-rated junction box/)).toBeVisible();
  await page.getByLabel("Search bill of materials").fill("preterminated");
  await expect(page.getByText(/Custom preterminated 1\/0 AWG/)).toBeVisible();
  await page.getByLabel("Search bill of materials").fill("indoor utility light");
  const indoorLightRow = page.getByRole("row").filter({ hasText: "QHLightlux 12–28 V 3000 K indoor" });
  await expect(indoorLightRow.getByRole("link", { name: /Amazon · QHLightlux/ })).toBeVisible();
  await expect(indoorLightRow.getByText("Aug 19", { exact: true })).toBeVisible();
  await page.getByLabel("Search bill of materials").fill("outdoor utility light");
  const outdoorLightRow = page.getByRole("row").filter({ hasText: "QHLightlux 12–28 V 3000 K outdoor" });
  await expect(outdoorLightRow.getByRole("link", { name: /Amazon · QHLightlux/ })).toBeVisible();
  await expect(outdoorLightRow.getByText("Aug 19", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Customs" }).click();
  await expect(page.getByRole("heading", { name: "Customs & packing manifest" })).toBeVisible();
  await expect(page.getByText("Licensed agent before arrival", { exact: true })).toBeVisible();
  await expect(page.getByText(/goods over FJ\$1,000 will be detained/i)).toBeVisible();
  await expect(page.getByText("Four radio models", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /School status is not automatic relief/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Description / model" })).toBeVisible();
  await expect(page.getByLabel("Consignee TIN")).toBeVisible();
  await expect(page.getByLabel(/Victron MultiPlus-II 24\/3000.*unit value/)).toHaveValue("939.00");
  await expect(page.getByText("$4,282.48", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("PMP242305010", { exact: true })).toBeVisible();
  await expect(page.getByText("Ubiquiti UniFi Express UX-US", { exact: true })).toBeVisible();
  await expect(page.getByText("TAF radio permit", { exact: true })).toHaveCount(4);
  await page.getByLabel("Consignee TIN").fill("TIN TO CONFIRM");
  await expect(page.getByLabel("Consignee TIN")).toHaveValue("TIN TO CONFIRM");

  await page.getByRole("button", { name: "Field notes" }).click();
  await expect(page.getByRole("heading", { name: "Commissioning checklist" })).toBeVisible();
  await expect(page.getByText(/Reduce the Ekrano DVCC charge-current limit from 100 A to 50 A/)).toBeVisible();
});

test("junction-box tab exposes every wire, bus and enclosure crossing", async ({ page }) => {
  await openViewer(page);
  const tabs = page.locator(".mode-tabs").getByRole("button");
  await expect(tabs.nth(1)).toHaveText("3D model");
  await expect(tabs.nth(2)).toHaveText("Junction box");
  await expect(tabs.nth(3)).toHaveText("System");

  await page.getByRole("button", { name: "Junction box", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Junction box wiring" })).toBeVisible();
  await expect(page.getByText(/35 terminal-to-terminal wires · 33 service circuits/)).toBeVisible();
  await expect(page.getByText(/14 cable glands \+ 1 Starlink jack · one spread bottom row/)).toBeVisible();
  await expect(page.locator("[data-junction-wire]")).toHaveCount(35);
  await expect(page.locator("[data-junction-gland]")).toHaveCount(15);
  await expect(page.locator(".junction-pair-sheath")).toHaveCount(6);
  await expect(page.locator("[data-junction-wire-row]")).toHaveCount(35);
  await expect(page.getByText(/24 V POSITIVE BUS/)).toBeVisible();
  await expect(page.getByText(/BLUE SEA 2314 SERVICE RETURN BUS/)).toBeVisible();

  const schematicAudit = await page.locator(".junction-schematic").evaluate((svg) => {
    const components = [...svg.querySelectorAll("[data-junction-component] rect")].map((element) => ({
      id: element.parentElement.dataset.junctionComponent,
      x: Number(element.getAttribute("x")),
      y: Number(element.getAttribute("y")),
      width: Number(element.getAttribute("width")),
      height: Number(element.getAttribute("height")),
    }));
    const routes = [...svg.querySelectorAll("[data-junction-wire]")].map((element) => ({
      id: element.dataset.junctionWire,
      points: element.getAttribute("points").split(" ").map((entry) => entry.split(",").map(Number)),
    }));
    const diagonals = [];
    const deviceCrossings = [];
    routes.forEach((route) => route.points.slice(1).forEach((end, index) => {
      const start = route.points[index];
      const vertical = start[0] === end[0];
      const horizontal = start[1] === end[1];
      if (!vertical && !horizontal) diagonals.push(`${route.id}:${index}`);
      components.forEach((component) => {
        const crosses = vertical
          ? start[0] > component.x && start[0] < component.x + component.width &&
            Math.max(start[1], end[1]) > component.y && Math.min(start[1], end[1]) < component.y + component.height
          : horizontal && start[1] > component.y && start[1] < component.y + component.height &&
            Math.max(start[0], end[0]) > component.x && Math.min(start[0], end[0]) < component.x + component.width;
        if (crosses) deviceCrossings.push(`${route.id}:${component.id}`);
      });
    }));
    return { diagonals, deviceCrossings };
  });
  expect(schematicAudit.diagonals).toEqual([]);
  expect(schematicAudit.deviceCrossings).toEqual([]);

  const wire = page.locator('[data-junction-wire="starlink-switch-input"]');
  const row = page.locator('[data-junction-wire-row="starlink-switch-input"]');
  // The optimized physical projection deliberately allows conductors to share
  // the same X/Y gutter at separate Z depths. Hovering the unambiguous run row
  // verifies the bidirectional highlight without depending on SVG paint order
  // where those projected centerlines overlap.
  await row.hover();
  await expect(wire).toHaveClass(/is-active/);
  await expect(row).toHaveClass(/is-active/);
  await expect(page.getByText(/six visible breaker positions do not require six independent supply wires/)).toBeVisible();
  await expect(page.getByText(/one common positive comb supplies four individual branch breakers/)).toBeVisible();
});

test("customs manifest is complete and print-ready on A4 landscape", async ({ page }) => {
  await openViewer(page);
  await page.getByRole("button", { name: "Customs" }).click();
  await page.getByLabel("Consignee TIN").fill("TEST-TIN-123");
  await page.getByLabel("Traveler / importer").fill("Test Traveler");

  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".app-header")).toBeHidden();
  await expect(page.locator(".customs-screen-only").first()).toBeHidden();
  await expect(page.locator(".customs-manifest-section")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Description / model" })).toBeVisible();
  await expect(page.getByLabel("Consignee TIN")).toHaveValue("TEST-TIN-123");
  await expect(page.getByLabel("Traveler / importer")).toHaveValue("Test Traveler");

  const pdf = await page.pdf({
    format: "A4",
    landscape: true,
    printBackground: true,
    preferCSSPageSize: true,
  });
  expect(pdf.byteLength).toBeGreaterThan(25_000);
});

test("DSE 3D model is scale-aware, navigable and connected to component details", async ({ page }) => {
  test.setTimeout(60_000);
  await openViewer(page);
  await page.getByRole("button", { name: "3D model" }).click();
  await expect(page.locator('[data-model-ready="true"]')).toBeVisible({ timeout: 15_000 });
  const modelShell = page.locator(".model-shell");
  await expect(modelShell).toHaveAttribute("data-routing-backtracking-corners", /\d+/);
  await expect(modelShell).toHaveAttribute("data-routing-discontinuous-handoffs", "0");
  const routingAudit = await modelShell.evaluate((element) => ({
    obstacleIntersections: Number(element.dataset.routingObstacleIntersections),
    unresolvedCrossings: Number(element.dataset.routingUnresolvedCrossings),
    junctionSolidIntersections: Number(element.dataset.junctionRoutingSolidIntersections),
    junctionSpatialIntersections: Number(element.dataset.junctionRoutingSpatialIntersections),
    junctionCoincidentOverlapM: Number(element.dataset.junctionRoutingCoincidentOverlapM),
  }));
  // The whole-site audit includes separate exterior cable bundles. The compact
  // junction has a stricter offline publish gate and may not contain any
  // rounded-tube contact, coincident run, or component contact.
  expect(routingAudit.obstacleIntersections).toBeLessThanOrEqual(100);
  expect(routingAudit.unresolvedCrossings).toBeLessThanOrEqual(59);
  expect(routingAudit.junctionSolidIntersections).toBe(0);
  expect(routingAudit.junctionSpatialIntersections).toBe(0);
  expect(routingAudit.junctionCoincidentOverlapM).toBe(0);
  await expect(modelShell).toHaveAttribute("data-junction-routing-candidate", "Voxel A* production");
  await expect(modelShell).toHaveAttribute("data-junction-routing-candidate-count", "1");
  await expect(modelShell).toHaveAttribute("data-junction-routing-route-count", "35");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-junction-routing-boundary-breakout-conflicts", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-junction-port-approach-violations", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-junction-port-count", "70");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-port-approach-violations", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-port-count", "111");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-junction-routing-max-bends", /\d+/);
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-battery-arrangement", "floor-2x2");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-battery-routing", "collision-aware-terminal-derived-bundle");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-authored-wall-waypoints", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-automatic-routes", /[2-9]\d/);
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-wall-routing", "offline-voxel-a-star-only");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-junction-back-routes", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-roof-planes", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-side-walls", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-wall-overlaps", "0");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-shadow-map-size", "4096");
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-solver-route-count", /[1-9]\d*/);
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-generated-cable-m", /\d+\.\d+/);
  await expect(page.locator(".model-shell")).toHaveAttribute("data-layout-optimization-status", "voxel-a-star-stochastic-gradient-optimized-finalized");
  expect(Number(await page.locator(".model-shell").getAttribute("data-layout-optimization-evaluations"))).toBe(54);
  expect(Number(await page.locator(".model-shell").getAttribute("data-layout-optimization-improvement-percent"))).toBeGreaterThanOrEqual(1.9);
  await expect(page.getByRole("button", { name: "Edit wall layout" })).toHaveCount(0);
  await expect(page.locator(".model-shell")).not.toHaveAttribute("data-layout-storage-ready", /.+/);
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-render-mode", "on-demand-static-shadows");
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-shadow-state", "cached");
  const renderProfile = await page.locator(".model-canvas").evaluate((element) => ({
    batchedDrawCalls: Number(element.dataset.sceneBatchedDrawCalls),
    cableMeshes: Number(element.dataset.sceneCableMeshes),
    renderCalls: Number(element.dataset.renderCalls),
  }));
  expect(renderProfile.batchedDrawCalls).toBeGreaterThan(250);
  // The single Starlink sheath, two two-conductor light runs and cylindrical
  // port collars remain batched except for a small fixed set of dynamic runs.
  // The promoted Voxel A* routes are the only automatic cable set built.
  // Selectable connector hit targets use hidden materials.
  expect(renderProfile.cableMeshes).toBeLessThanOrEqual(22);
  expect(renderProfile.renderCalls).toBeLessThanOrEqual(220);

  const canvas = page.getByRole("img", { name: /three-dimensional model of the Drua Sailing Experience/i });
  await expect(canvas).toBeVisible();
  await expect(page.locator(".model-routing-summary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Current .* wall/ })).toHaveCount(0);
  await expect(modelShell).toHaveAttribute("data-wall-routing-mode", "voxel-a-star");
  await expect(modelShell).toHaveAttribute("data-voxel-routing-failed-routes", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-routing-clearance-issues", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-routing-device-front-violations", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-routing-rounded-device-front-violations", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-routing-port-violations", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-junction-failed-routes", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-junction-clearance-issues", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-junction-connector-collisions", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-junction-direction-reversals", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-junction-rounded-clearance-issues", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-junction-port-violations", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-junction-protected-front-violations", "0");
  await expect(modelShell).toHaveAttribute("data-voxel-junction-unrelated-front-violations", "0");
  await expect(modelShell).toHaveAttribute("data-selectable-connector-count", "181");
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-wall-routing-mode", "voxel-a-star");
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
  await expect(page.getByText(/two main positive runs, two negative returns and six balancer leads/i)).toBeVisible();
  await expect(page.getByText(/rear-bank negative egress is reserved before the balancer conductors/i)).toBeVisible();
  await expect(page.getByText(/no unrelated cable can pass through or in front of an enclosure/i)).toBeVisible();
  await expect(page.getByText(/no renderer-added detours or competing automatic route set/i)).toBeVisible();
  await expect(page.getByText(/14 mm production solve/i)).toBeVisible();
  await expect(page.getByText(/14 mm production solve uses 57\.09 m \/ 259 turns outside/i)).toBeVisible();
  await expect(page.getByText(/jointly report 0 failed routes, 0 clearance contacts, 0 invalid port approaches, and 0 device-front violations/i)).toBeVisible();
  await expect(page.getByText(/each rounded cable follows one continuous sampled centerline/i)).toBeVisible();
  await expect(page.getByText(/seeded two-sided stochastic position search evaluated 54 complete Voxel A\* reroutes/i)).toBeVisible();
  await expect(page.getByText(/production harness contains 35 conductors, 70 selectable ports/i)).toBeVisible();
  await expect(page.getByText(/visible XYZ point below the mouse or touch gesture becomes the grab point/i)).toBeVisible();
  await expect(page.getByText(/0 broken handoffs/)).toBeVisible();
  await expect(page.getByText(/77 Voxel A\* conductors/i)).toBeVisible();
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
  await expect(page.locator('[data-model-label="indoor-light"]')).toContainText("Warm indoor utility light");
  await expect(page.locator('[data-model-label="outdoor-flood"]')).toContainText("Warm outdoor utility light");
  await expect(page.locator('[data-model-label="earth-bar"]')).toContainText("Main PE bar");
  await expect(page.locator('[data-model-label="multiplus"]')).toHaveCSS("pointer-events", "none");
  await expect(page.locator('[data-model-label="multiplus"]')).toHaveCSS("user-select", "none");
  expect(await page.locator('[data-model-label="multiplus"]').evaluate((element) => element.tagName)).toBe("DIV");

  const equipmentCanvasBox = await page.locator(".model-canvas").boundingBox();
  if (!equipmentCanvasBox) throw new Error("3D equipment-wall canvas did not render");
  const cameraBeforeSelection = await page.locator(".model-canvas").evaluate((element) => ({
    position: element.dataset.cameraPosition,
    quaternion: element.dataset.cameraQuaternion,
  }));
  // The Ekrano is unobscured in the fixed equipment-wall camera. Clicking the
  // rendered device verifies the complete Three.js pick -> inspector -> BOM
  // delivery-data path, rather than opening the drawer through a DOM shortcut.
  await clickProjectedModelComponent(page, "ekrano", "systemMonitor");
  const modelInspector = page.getByRole("dialog", { name: "Component details" });
  await expect(modelInspector.getByRole("heading", { name: "Ekrano GX" })).toBeVisible();
  const cameraAfterSelection = await page.locator(".model-canvas").evaluate((element) => ({
    position: element.dataset.cameraPosition,
    quaternion: element.dataset.cameraQuaternion,
  }));
  expect(cameraAfterSelection).toEqual(cameraBeforeSelection);
  await expect(modelInspector.locator('[data-model-procurement="systemMonitor"]')).toBeVisible();
  await expect(modelInspector.getByText("Amazon & purchasing", { exact: true })).toBeVisible();
  await expect(modelInspector.getByText("Amazon", { exact: true })).toBeVisible();
  await expect(
    modelInspector.getByRole("link", {
      name: /Open Amazon listing for Victron Ekrano GX BPP900480100/,
    }),
  ).toHaveAttribute("href", "https://www.amazon.com/dp/B0C9N42K9Z");
  await modelInspector.getByRole("button", { name: "Close component details" }).click();

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
  await expect(page.locator('[data-model-label="bus-positive"]')).toContainText("24 V + BLUE SEA 2104");
  await expect(page.locator('[data-model-label="bus-negative"]')).toContainText("24 V − BLUE SEA 2104");
  await expect(page.locator('[data-model-label="fuse-block"]')).toBeVisible();
  await expect(page.locator('[data-model-label="fuse-block"]')).toContainText("UniFi 2 A");
  await expect(page.locator('[data-model-label="fuse-block"]')).toContainText("Starlink 5 A");
  await expect(page.locator('[data-model-label="mppt-breaker"]')).toContainText("MPPT 100 A BREAKER");
  await expect(page.locator('[data-model-label="ekrano-fuse"]')).toContainText("EKRANO 3.15 A FUSE");
  await expect(page.locator('[data-model-label="load-switches"]')).toContainText("INTERNET DPST");
  await expect(page.locator('[data-model-label="return-bus"]')).toContainText("6 used · 1 spare");
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

test("every modeled connector exposes its circuit topology", async ({ page }) => {
  test.setTimeout(45_000);
  await openViewer(page);
  await page.getByRole("button", { name: "3D model" }).click();
  const modelShell = page.locator(".model-shell");
  await expect(modelShell).toHaveAttribute("data-model-ready", "true", { timeout: 15_000 });
  await expect(modelShell).toHaveAttribute("data-selectable-connector-count", "181");
  await page.getByRole("button", { name: "Open junction box" }).click();
  await page.waitForTimeout(1_200);

  const canvas = page.locator(".model-canvas canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  let connectorId = "";
  let hit;
  for (let y = bounds.y + bounds.height * 0.24; y < bounds.y + bounds.height * 0.78 && !connectorId; y += 9) {
    for (let x = bounds.x + bounds.width * 0.4; x < bounds.x + bounds.width * 0.84; x += 9) {
      await page.mouse.move(x, y);
      connectorId = await page.locator(".model-canvas").getAttribute("data-hovered-connector") ?? "";
      if (connectorId.startsWith("junction:")) {
        hit = { x, y };
        break;
      }
      connectorId = "";
    }
  }
  expect(connectorId).toMatch(/^junction:/);
  await page.mouse.click(hit.x, hit.y);
  const inspector = page.getByRole("dialog", { name: "Connector details" });
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText("Junction-box harness");
  await expect(inspector).toContainText("Other connector");
  await expect(inspector).toContainText("Circuit");
  await expect(inspector).toContainText("Route ID");
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
  await expect(page.locator('[data-model-ready="true"]')).toBeVisible({ timeout: 15_000 });
  await page.locator(".model-canvas").evaluate((element) => {
    element.dataset.persistenceProbe = "original-renderer";
  });
  await page.getByRole("button", { name: /PG · PNG/ }).click();
  await expect(page.getByRole("heading", { name: /currently represents DSE/ })).toBeVisible();
  await expect(page.getByText(/has not been assigned speculative site geometry/)).toBeVisible();
  await page.getByRole("button", { name: "Open the DSE 3D model" }).click();
  await expect(page.locator('[data-model-ready="true"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".model-canvas")).toHaveAttribute("data-persistence-probe", "original-renderer");
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
  for (const mode of ["Diagram", "3D model", "Junction box", "System", /Bill of materials/, "Customs", "Field notes"]) {
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

  await modeTabs.getByRole("button", { name: "Customs" }).click();
  const customsMetrics = await page.evaluate(() => {
    const wrap = document.querySelector(".customs-table-wrap");
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      tableScrollsInternally: Boolean(wrap && wrap.scrollWidth > wrap.clientWidth),
    };
  });
  expect(customsMetrics.documentWidth).toBeLessThanOrEqual(customsMetrics.viewportWidth + 1);
  expect(customsMetrics.tableScrollsInternally).toBe(true);

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
  await expect(page.locator('[data-edge-id="dt-unifi-usbc"] .edge-label')).toContainText(
    "5 V / 3 A",
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
