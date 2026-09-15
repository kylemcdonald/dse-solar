import { expect, test } from "@playwright/test";

const tabs = [
  ["simple", "simple", "Simple diagram"], ["diagram", "diagram", "Detailed diagram"],
  ["model", "model", "3D model"], ["system", "system", "System"],
  ["bom", "bom", "Bill of materials"], ["costs", "cost", "Costs"],
  ["cables", "cables", "Wire cut list"], ["notes", "notes", "Field notes"],
];

test.describe("Viewer routes", () => {
  for (const project of ["fiji", "polowat"]) {
    for (const [slug, mode, label] of tabs) {
      if (project === "polowat" && ["simple", "cables"].includes(slug)) continue;
      test(`${project}/${slug} loads directly and survives refresh`, async ({ page }) => {
        const path = `/${project}/${slug}`;
        const projectId = project === "fiji" ? "dse-fiji" : "inowon-polowat";
        const response = await page.goto(path);
        expect(response.status()).toBe(200);
        expect(await response.text()).toContain(`data-project="${projectId}"`);
        await expect(page.locator(".app-shell")).toHaveAttribute("data-viewer-ready", "true");
        await expect(page.locator(".app-shell")).toHaveAttribute("data-view", mode);
        await page.reload();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.locator(".app-shell")).toHaveAttribute("data-project", projectId);
        await expect(page.locator(".app-shell")).toHaveAttribute("data-view", mode);
        const tabLabel = project === "polowat" && mode === "diagram" ? "Wiring diagram" : label;
        await expect(page.getByRole("navigation", { name: "Viewer mode" }).getByRole("link", { name: tabLabel }))
          .toHaveAttribute("aria-current", "page");
        if (mode === "model") await expect(page.locator(".model-workspace canvas")).toBeVisible();
      });
    }
  }

  test("project and tab links support history, refresh and new tabs", async ({ page, context }) => {
    await page.goto("/polowat/bom");
    await expect(page.locator(".app-shell")).toHaveAttribute("data-viewer-ready", "true");
    await page.getByRole("link", { name: "Costs", exact: true }).click();
    await expect(page).toHaveURL(/\/polowat\/costs$/);
    await page.getByRole("link", { name: /DSE.*Fiji/ }).click();
    await expect(page).toHaveURL(/\/fiji\/costs$/);
    await expect(page.locator(".app-shell")).toHaveAttribute("data-project", "dse-fiji");
    await page.goBack();
    await expect(page).toHaveURL(/\/polowat\/costs$/);
    await expect(page.locator(".app-shell")).toHaveAttribute("data-project", "inowon-polowat");
    await expect(page.locator(".cost-total strong")).toHaveText("$2,354.54");
    await page.goBack();
    await expect(page).toHaveURL(/\/polowat\/bom$/);
    await expect(page.locator(".bom-v2")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/polowat\/costs$/);
    await page.reload();
    await expect(page.locator(".cost-view")).toBeVisible();
    const opened = context.waitForEvent("page");
    await page.getByRole("link", { name: /Bill of materials/ }).click({ modifiers: ["Control"] });
    const newTab = await opened;
    await expect(newTab).toHaveURL(/\/polowat\/bom$/);
    await expect(newTab.locator(".bom-v2")).toBeVisible();
    await expect(page).toHaveURL(/\/polowat\/costs$/);
    await newTab.close();
  });

  test("project roots redirect and unsupported routes return 404", async ({ page, request }) => {
    for (const [path, destination] of [["/", "/fiji/diagram"], ["/fiji", "/fiji/diagram"], ["/polowat", "/polowat/diagram"]]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${destination}$`));
    }
    for (const path of ["/polowat/simple", "/polowat/cables", "/fiji/unknown", "/unknown/bom", "/fiji/bom/extra"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
    }
  });

  test("switching from a Fiji-only tab opens Polowat's wiring diagram", async ({ page }) => {
    await page.goto("/fiji/simple");
    await expect(page.locator(".app-shell")).toHaveAttribute("data-viewer-ready", "true");
    await page.getByRole("link", { name: /Inowon.*Polowat/ }).click();
    await expect(page).toHaveURL(/\/polowat\/diagram$/);
    await expect(page.locator(".polowat-diagram")).toBeVisible();
  });
});
