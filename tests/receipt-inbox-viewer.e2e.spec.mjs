import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { handleReceiptInbox } from "../app/api/receipts/inboxHandler.ts";
test.use({ actionTimeout: 15_000 });

test("private receipt drop, arithmetic review, purchase matching, correction, downloads and refresh persist", async ({ page }) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dse-receipts-browser-"));
  const privateRoot = path.join(temp, "private"), previous = process.env.DSE_PRIVATE_MODE;
  process.env.DSE_PRIVATE_MODE = "1";
  try {
    // Exercise the real filesystem handler with isolated storage; never create test purchases in the owner's ledger.
    await page.route("**/api/receipts/status", route => route.fulfill({ json: { privateMode: true } }));
    await page.route("**/api/receipts/inbox?*", async route => {
      const req = route.request(), bytes = req.postDataBuffer();
      const response = await handleReceiptInbox(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(bytes ? { body: new Uint8Array(bytes) } : {}) }), privateRoot);
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.goto("/polowat/bom");
    await expect(page.getByRole("heading", { name: "Drop receipts here" })).toBeVisible();
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(["%PDF-1.4\nBrowser test receipt only\n%%EOF"], "sample-receipt.pdf", { type: "application/pdf" }));
      return data;
    });
    await page.locator(".receipt-drop").dispatchEvent("drop", { dataTransfer: transfer });
    await expect(page.getByRole("status")).toContainText("1 receipt saved for review");
    await page.locator(".receipt-drop").dispatchEvent("drop", { dataTransfer: transfer });
    await expect(page.getByRole("status")).toContainText("1 duplicate already tracked");
    await page.getByRole("button", { name: "Review receipt", exact: true }).click();
    await page.getByLabel("Vendor", { exact: true }).fill("Test supplier");
    await page.getByLabel("Order / receipt number", { exact: true }).fill("TEST-ONLY-001");
    await page.getByLabel("Receipt date", { exact: true }).fill("2026-09-14");
    await page.getByRole("combobox", { name: "BOM item", exact: true }).selectOption("polowat-panels");
    await page.getByLabel("Quantity", { exact: true }).fill("3");
    await page.getByLabel("Unit price", { exact: true }).fill("100");
    await page.getByLabel("Shipping", { exact: true }).fill("5");
    await page.getByLabel("Tax", { exact: true }).fill("29.25");
    await page.getByLabel("Receipt grand total", { exact: true }).fill("334.24");
    await page.getByRole("button", { name: "Save reconciliation" }).click();
    await expect(page.getByRole("alert")).toContainText("does not balance");
    await page.getByLabel("Receipt grand total", { exact: true }).fill("334.25");
    await page.getByRole("button", { name: "Save reconciliation" }).click();
    await expect(page.getByRole("status")).toContainText("Reconciliation saved");
    await expect(page.locator('.receipt-actions').first()).toContainText("$334.25 new net spend");
    await expect(page.locator('[data-bom-id="polowat-panels"]')).toContainText("Purchased · receipt reconciled");
    await expect(page.locator('[data-bom-total="design"]')).toContainText("$2,354.54");
    await page.getByRole("button", { name: "Show Items To Purchase", exact: true }).click();
    await expect(page.locator('[data-bom-id="polowat-panels"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-bom-id="polowat-panels"]')).toContainText("Purchased · receipt reconciled");
    await page.getByText("Purchase reconciliation (1 receipts)", { exact: true }).click();
    await page.getByRole("button", { name: "Edit reconciliation" }).click();
    await page.getByLabel("Purchase / grant notes", { exact: true }).fill("Corrected grant purpose");
    await page.getByRole("button", { name: "Save reconciliation" }).click();
    await expect(page.getByRole("status")).toContainText("Reconciliation saved");
    const ledger = JSON.parse(fs.readFileSync(path.join(privateRoot, "receipts/polowat/ledger.json"), "utf8"));
    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0].history).toHaveLength(2);
    expect(fs.readdirSync(path.join(privateRoot, "receipts/polowat/to-process"))).toEqual([]);
    expect(fs.readFileSync(path.join(privateRoot, `receipts/polowat/${ledger.records[0].id}.pdf`), "utf8")).toContain("Browser test receipt only");
    const csvDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Purchase ledger CSV" }).click();
    const csv = fs.readFileSync(await (await csvDownload).path(), "utf8");
    expect(csv).toContain("TEST-ONLY-001");
    expect(csv).toContain("Corrected grant purpose");
    const zipDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Receipts + ledger ZIP" }).click();
    const zip = fs.readFileSync(await (await zipDownload).path());
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    expect(zip.toString()).toContain("Browser test receipt only");
    await page.getByRole("link", { name: "DSE Fiji" }).click();
    await expect(page).toHaveURL(/\/fiji\/bom$/);
    await expect(page.locator(".receipt-inbox")).toContainText("0 awaiting review");
    await expect(page.locator(".receipt-inbox")).not.toContainText("sample-receipt.pdf");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DSE_PRIVATE_MODE; else process.env.DSE_PRIVATE_MODE = previous;
  }
});

test("public BOM has no receipt controls and mobile private drop zone fits", async ({ page }) => {
  await page.route("**/api/receipts/status", route => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto("/polowat/bom");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-viewer-ready", "true");
  await expect(page.locator(".receipt-inbox")).toHaveCount(0);
  await page.unroute("**/api/receipts/status");
  await page.route("**/api/receipts/status", route => route.fulfill({ json: { privateMode: true } }));
  await page.route("**/api/receipts/inbox?*", route => route.fulfill({ json: { version: 1, project: "polowat", records: [] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Choose receipts" })).toBeVisible();
  const bounds = await page.locator(".receipt-inbox").boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
});
