import fs from "node:fs";

import { expect, test } from "@playwright/test";

function storedZipEntryNames(archive) {
  const names = [];
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    names.push(archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + size;
  }
  return names;
}

test("costs page downloads payer-aware grant PDF and CSV reports plus the receipt archive", async ({ page }) => {
  await page.goto("/", { timeout: 120_000 });
  await expect(page.locator(".app-shell")).toHaveAttribute("data-viewer-ready", "true");
  await page.getByRole("button", { name: /Bill of materials/ }).click();
  await expect(page.getByRole("button", { name: "Export grant report PDF" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export grant report CSV" })).toHaveCount(0);
  await page.getByRole("button", { name: "Costs" }).click();

  const exportButton = page.getByRole("button", { name: "Export grant report PDF" });
  await expect(exportButton).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^dse-grant-purchase-report-\d{4}-\d{2}-\d{2}\.pdf$/);

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const pdf = fs.readFileSync(downloadPath, "latin1");
  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  expect(pdf).toContain("DSE Grant Purchase Report");
  expect(pdf).toContain("Items purchased in Fiji");
  expect(pdf).toContain("Items purchased for personal use");
  expect(pdf).toContain("Items purchased for HVTA");
  expect(pdf).toContain("Items purchased for DSE");
  expect(pdf).toContain("Purchases made by IYOIYO");
  expect(pdf).toContain("Purchases made by DSE");
  expect(pdf).toContain("$252.63 remaining from $8,000.00 PTS check");
  expect(pdf).toContain("Erik Godo donation to Pacific Traditions Society");
  expect(pdf).toContain("GRAND TOTAL - DSE + IYOIYO");
  expect(Number(pdf.match(/\/Type \/Pages .*\/Count (\d+)/)?.[1])).toBeGreaterThan(1);
  const xrefOffset = Number(pdf.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  expect(pdf.slice(xrefOffset, xrefOffset + 4)).toBe("xref");

  const csvButton = page.getByRole("button", { name: "Export grant report CSV" });
  await expect(csvButton).toBeVisible();
  const csvDownloadPromise = page.waitForEvent("download");
  await csvButton.click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/^dse-grant-purchase-report-\d{4}-\d{2}-\d{2}\.csv$/);
  const csvDownloadPath = await csvDownload.path();
  expect(csvDownloadPath).toBeTruthy();
  const csv = fs.readFileSync(csvDownloadPath, "utf8").replace(/^\uFEFF/, "");
  expect(csv).toContain('"Row type","Section","Item","Quantity","Unit","Receipt reference","Paid by","Amount (USD)","Note"');
  expect(csv.split("\r\n").filter((row) => row.startsWith('"Item",')).length).toBe(115);
  expect(csv).toContain('"Section subtotal","Items purchased in Fiji","Items purchased in Fiji subtotal",,,,,3252.72,');
  expect(csv).toContain('"Payer subtotal","Payer summary","Purchases made by IYOIYO",,,,"IYOIYO",7747.37,');
  expect(csv).toContain('"Payer subtotal","Payer summary","Purchases made by DSE",,,,"DSE",4529.32,');
  expect(csv).toContain('"Grand total","Payer summary","GRAND TOTAL - DSE + IYOIYO",,,,,12276.69,');
  expect(csv).toContain("Erik Godo donation to Pacific Traditions Society (PTS); remains included in IYOIYO purchases");
  expect(csv.indexOf("EverExceed 12 V 200 Ah GEL batteries · superseded by Victron design"))
    .toBeLessThan(csv.indexOf("Suntech Ultra V Pro 565 W panels · superseded by AIKO design"));

  const receiptStatus = await page.request.get("/api/receipts/status");
  const receiptLink = page.getByRole("link", { name: "Download all receipts (.zip)" });
  if (receiptStatus.ok()) {
    await expect(receiptLink).toBeVisible();
    const receiptDownloadPromise = page.waitForEvent("download");
    await receiptLink.click();
    const receiptDownload = await receiptDownloadPromise;
    expect(receiptDownload.suggestedFilename()).toBe("dse-fiji-receipts.zip");
    const receiptDownloadPath = await receiptDownload.path();
    expect(receiptDownloadPath).toBeTruthy();
    const entryNames = storedZipEntryNames(fs.readFileSync(receiptDownloadPath));
    expect(entryNames.length).toBeGreaterThanOrEqual(44);
    expect(entryNames).toContain("01-amazon-2026-07-01-order-113-3097966-7412218-takoci-batteries.pdf");
    expect(entryNames).toContain("44-extreme-customs-clearance-2026-08-28-invoice-00070037-drua-sailing.pdf");
    expect(entryNames.every((name) => /^\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/.test(name))).toBe(true);
  } else {
    await expect(receiptLink).toHaveCount(0);
  }
});
