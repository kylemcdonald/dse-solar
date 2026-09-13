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

test("costs page downloads grant PDF and CSV reports plus the receipt archive", async ({ page }) => {
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
  expect(pdf).toContain("Funding reconciliation & purchase ledger");
  expect(pdf).toContain("On-site Fiji purchases");
  expect(pdf).toContain("Other solar-system purchases");
  expect(pdf).toContain("Fiji customs and clearance costs");
  expect(pdf).toContain("Outside-scope purchases");
  expect(pdf).toContain("All documented purchase and customs costs in this report were paid by");
  expect(pdf).toContain("IYOIYO. The final summary separates");
  expect(pdf).toContain("FJD 15,193.00");
  expect(pdf).toContain("IYOIYO paid beyond PTS advance");
  expect(pdf).toContain("$7,962.15");
  expect(pdf).toContain("Funding attribution: Erik Godo donation to Pacific Traditions");
  expect(pdf).toContain("\\(PTS\\); remains included in IYOIYO purchases");
  expect(pdf).toContain("PURCHASE SCOPE SUMMARY");
  expect(pdf).toContain("$12,539.65");
  expect(pdf).toContain("$3,422.50");
  expect(pdf).toContain("of which Inowon in Polowat");
  expect(pdf).toContain("$179.98");
  expect(pdf).toContain("COMBINED TOTAL");
  expect(pdf).toContain("$15,962.15");
  expect(pdf).not.toContain("PAID BY");
  expect(pdf).not.toContain("DSE PAID");
  expect(pdf).not.toContain("Costs paid directly by DSE");
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
  expect(csv).toContain('"Row type","Section","Item","Quantity","Unit","Evidence","Original currency","Original amount","USD equivalent","Note"');
  expect(csv).not.toContain('"Paid by"');
  expect(csv).not.toContain('"DSE"');
  expect(csv.split("\r\n").filter((row) => row.startsWith('"Item",')).length).toBe(145);
  expect(csv).toContain('"Section subtotal","On-site Fiji purchases","On-site Fiji purchases subtotal",,,,"FJD",15193.00,6938.18,');
  expect(csv).toContain('"Source reconciliation","Funding summary","Verified on-site Fiji purchases",,,"#48-53","FJD",15193.00,6938.18,');
  expect(csv).toContain('"Purchase subtotal","Funding summary","All purchases paid by IYOIYO",,,,,,15962.15,');
  expect(csv).toContain('"Scope subtotal","Purchase scope summary","Solar system",,,,,,12539.65,');
  expect(csv).toContain('"Scope subtotal","Purchase scope summary","Outside scope",,,,,,3422.50,');
  expect(csv).toContain('"Allocation detail","Purchase scope summary","Inowon in Polowat",,,,,,179.98,');
  expect(csv).toContain('"Grand total","Purchase scope summary","COMBINED TOTAL",,,,,,15962.15,');
  expect(csv).toContain("Allocation: 1 of 2 SSDs ($164.99 item price) is for Inowon in Polowat");
  expect(csv).toContain("Allocation: 1 of 2 SD card readers ($14.99 item price) is for Inowon in Polowat");
  expect(csv).toContain("Erik Godo donation to Pacific Traditions Society (PTS); remains included in IYOIYO purchases");
  expect(csv).toContain("#49 Quote TP260901-V2 (Solar Fiji); #50 Payment confirmation Solar Fiji wire (Bank of America)");
  expect(csv).not.toContain("EverExceed 12 V 200 Ah GEL batteries · superseded by Victron design");

  const receiptStatus = await page.request.get("/api/receipts/status");
  const receiptLink = page.getByRole("link", { name: "Download all receipts (.zip)" });
  const privateMode = receiptStatus.ok() && receiptStatus.headers()["content-type"]?.includes("application/json")
    && (await receiptStatus.json()).privateMode;
  if (privateMode) {
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
    expect(entryNames).toContain("48-rc-manubhai-2026-09-01-invoice-12185922-site-supplies.pdf");
    expect(entryNames).toContain("49-solar-fiji-2026-09-01-quote-TP260901-V2-solar-system.pdf");
    expect(entryNames).toContain("50-bank-of-america-2026-09-02-wire-solar-fiji.pdf");
    expect(entryNames).toContain("51-bank-of-america-2026-08-20-wire-wind-solar-battery-pacific.pdf");
    expect(entryNames).toContain("52-bank-of-america-2026-08-21-wire-wind-solar-battery-pacific.pdf");
    expect(entryNames).toContain("53-bank-of-america-2026-08-25-wire-wind-solar-battery-pacific.pdf");
    expect(entryNames.every((name) => /^\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/.test(name))).toBe(true);
  } else {
    await expect(receiptLink).toHaveCount(0);
  }
});
