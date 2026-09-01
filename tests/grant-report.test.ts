import assert from "node:assert/strict";
import test from "node:test";

import receipts from "../data/dse-receipts.json";
import system from "../data/dse-system.json";
import {
  buildGrantPurchaseReport,
  compactReceiptReferences,
  createGrantReportCsv,
  createGrantReportPdf,
  grantReportCsvFilename,
  grantReportFilename,
  type GrantReportReceiptIndex,
} from "../app/grantReport";

const report = buildGrantPurchaseReport(
  system.bom,
  receipts as GrantReportReceiptIndex,
  new Date(2026, 7, 30, 12),
);
const section = (id: "fiji" | "personal" | "hvta" | "dse") => report.sections.find((candidate) => candidate.id === id)!;

test("customs invoice and Ekrano funding flows remain explicit in source data", () => {
  const bomById = new Map(system.bom.map((item) => [item.id, item]));
  const customsRows = [bomById.get("dse-customs-vat")!, bomById.get("dse-customs-agent-costs")!];
  assert.equal(customsRows.reduce((sum, item) => sum + item.unitCost, 0), 2_808.53);
  assert.equal(customsRows.reduce((sum, item) => Math.round((sum + item.totalUsd) * 100) / 100, 0), 1_276.6);
  assert.ok(customsRows.every((item) => item.currency === "FJD" && item.grantPayer === "DSE"));
  assert.ok(customsRows.every((item) => item.grantPaymentNote === "Paid directly by Seta on behalf of DSE."));

  const ekrano = bomById.get("dse-ekrano-gx")!;
  assert.equal(ekrano.grantPayer, "IYOIYO");
  assert.equal(ekrano.grantFundingSource, "Erik Godo donation to Pacific Traditions Society (PTS)");
  assert.equal(ekrano.grantFundingAmountUsd, 563.55);
  assert.match(ekrano.grantFundingTreatment, /does not reduce IYOIYO purchases/);
});

test("grant report applies the requested Fiji, personal, HVTA, and DSE breakdown", () => {
  assert.deepEqual(report.sections.map((candidate) => candidate.title), [
    "Items purchased in Fiji",
    "Items purchased for personal use",
    "Items purchased for HVTA",
    "Items purchased for DSE",
  ]);
  assert.deepEqual(section("fiji").lines.map((line) => line.id), [
    "dse-everexceed-batteries-superseded", "dse-suntech-panels-superseded",
  ]);
  assert.deepEqual(section("personal").lines.map((line) => line.id), [
    "dse-personal-garmin-montana-710i",
    "dse-personal-flexsolar-panels",
  ]);
  assert.deepEqual(section("hvta").lines.map((line) => line.id), ["dse-personal-takoci-hx870-batteries"]);
  assert.ok(section("dse").lines.some((line) => line.id === "dse-router"));
  assert.ok(section("dse").lines.some((line) => line.id === "dse-us-sales-tax"));
  assert.deepEqual(section("dse").lines.filter((line) => line.id.startsWith("dse-customs"))
    .map((line) => [line.id, line.receiptRefs, line.payer]), [
    ["dse-customs-vat", [44], "DSE"],
    ["dse-customs-agent-costs", [44], "DSE"],
  ]);
  const refundLines = section("dse").lines.filter((line) => line.id.startsWith("dse-refund-"));
  assert.equal(refundLines.length, 5);
  assert.equal(refundLines.reduce((sum, line) => Math.round((sum + line.costUsd) * 100) / 100, 0), -324.95);
  assert.ok(refundLines.every((line) => line.receiptRefs.length === 1));

  for (const reportSection of report.sections) {
    assert.deepEqual(
      reportSection.lines.map((line) => line.costUsd),
      reportSection.lines.map((line) => line.costUsd).sort((first, second) => second - first),
      `${reportSection.title} should be sorted from highest to lowest cost`,
    );
  }
});

test("every numbered-receipt purchase appears once and payer totals partition DSE from IYOIYO", () => {
  const expectedReceiptBackedIds = system.bom
    .filter((item) => item.procurement.includes("Purchased"))
    .filter((item) => Number.isFinite(item.totalUsd) && item.totalUsd !== 0)
    .filter((item) => receipts.itemInvoices[item.id as keyof typeof receipts.itemInvoices]?.length)
    .map((item) => item.id)
    .sort();
  const receiptBackedLines = report.sections.filter((candidate) => candidate.id !== "fiji").flatMap((candidate) => candidate.lines);
  assert.deepEqual(receiptBackedLines.map((line) => line.id).sort(), expectedReceiptBackedIds);
  assert.ok(receiptBackedLines.every((line) => line.receiptRefs.length > 0));
  assert.ok(section("fiji").lines.every((line) => line.receiptRefs.length === 0));
  assert.ok(section("fiji").lines.every((line) => line.payer === "DSE"));
  assert.equal(new Set(report.sections.flatMap((candidate) => candidate.lines.map((line) => line.id))).size, 115);

  assert.equal(section("fiji").subtotalUsd, 3_252.72);
  assert.equal(section("personal").subtotalUsd, 857.95);
  assert.equal(section("hvta").subtotalUsd, 32.99);
  assert.equal(section("dse").subtotalUsd, 8_133.03);
  assert.equal(report.iyoyioPurchasesSubtotalUsd, 7_747.37);
  assert.equal(report.dsePurchasesSubtotalUsd, 4_529.32);
  assert.equal(report.iyoyioCheckAmountUsd, 8_000);
  assert.equal(report.iyoyioCheckBalanceUsd, 252.63);
  assert.equal(report.grandTotalUsd, 12_276.69);
  assert.equal(report.grandTotalUsd,
    Math.round((report.iyoyioPurchasesSubtotalUsd + report.dsePurchasesSubtotalUsd) * 100) / 100);
  assert.equal(report.grandTotalUsd,
    report.sections.reduce((sum, candidate) => Math.round((sum + candidate.subtotalUsd) * 100) / 100, 0));

  const ekrano = section("dse").lines.find((line) => line.id === "dse-ekrano-gx")!;
  assert.equal(ekrano.payer, "IYOIYO");
  assert.match(ekrano.note ?? "", /Erik Godo donation to Pacific Traditions Society/);
  assert.match(ekrano.note ?? "", /remains included in IYOIYO purchases/);
});

test("grant PDF is a dated, multipage download with compact receipt ranges", () => {
  assert.equal(compactReceiptReferences([1, 2, 3, 7, 9, 10]), "#1-3, #7, #9-10");
  assert.equal(report.generatedDate, "2026-08-30");
  assert.equal(grantReportFilename(report), "dse-grant-purchase-report-2026-08-30.pdf");

  const pdf = new TextDecoder().decode(createGrantReportPdf(report));
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /DSE Grant Purchase Report/);
  assert.match(pdf, /Generated August 30, 2026/);
  assert.match(pdf, /Items purchased in Fiji/);
  assert.match(pdf, /Purchases made by IYOIYO/);
  assert.match(pdf, /Purchases made by DSE/);
  assert.match(pdf, /\$252\.63 remaining from \$8,000\.00 PTS check/);
  assert.match(pdf, /Erik Godo donation to Pacific Traditions Society/);
  assert.match(pdf, /GRAND TOTAL - DSE \+ IYOIYO/);
  assert.ok(Number(pdf.match(/\/Type \/Pages .*\/Count (\d+)/)?.[1]) > 1);
  assert.ok(pdf.endsWith("%%EOF\n"));
});

test("grant CSV mirrors the PDF sections, receipt references, payer summaries, and totals", () => {
  assert.equal(grantReportCsvFilename(report), "dse-grant-purchase-report-2026-08-30.csv");
  const csv = createGrantReportCsv(report);
  assert.ok(csv.startsWith("\uFEFF\"Report\",\"DSE Grant Purchase Report\""));
  assert.ok(csv.includes('"Generated date","2026-08-30"'));
  assert.ok(csv.includes('"Row type","Section","Item","Quantity","Unit","Receipt reference","Paid by","Amount (USD)","Note"'));
  assert.equal(csv.split("\r\n").filter((row) => row.startsWith("\"Item\",")).length, 115);

  const batteries = csv.indexOf("\"EverExceed 12 V 200 Ah GEL batteries · superseded by Victron design\"");
  const panels = csv.indexOf("\"Suntech Ultra V Pro 565 W panels · superseded by AIKO design\"");
  assert.ok(batteries > 0 && panels > batteries);
  assert.ok(csv.includes('"Item","Items purchased in Fiji","EverExceed 12 V 200 Ah GEL batteries · superseded by Victron design",4,"ea","Fiji receipt - not indexed","DSE",2345.45,'));
  assert.ok(csv.includes('"Section subtotal","Items purchased in Fiji","Items purchased in Fiji subtotal",,,,,3252.72,'));
  assert.ok(csv.includes('"Item","Items purchased for DSE","Fiji import VAT as per customs entry",1,"invoice charge","#44","DSE",789.39,"Paid directly by Seta on behalf of DSE."'));
  assert.ok(csv.includes("Erik Godo donation to Pacific Traditions Society (PTS); remains included in IYOIYO purchases"));
  assert.ok(csv.includes('"Payer subtotal","Payer summary","Purchases made by IYOIYO",,,,"IYOIYO",7747.37,'));
  assert.ok(csv.includes('"Check balance","Payer summary","PTS check balance",,,,"IYOIYO",252.63,"$252.63 remaining from $8,000.00 PTS check"'));
  assert.ok(csv.includes('"Payer subtotal","Payer summary","Purchases made by DSE",,,,"DSE",4529.32,'));
  assert.ok(csv.includes('"Grand total","Payer summary","GRAND TOTAL - DSE + IYOIYO",,,,,12276.69,'));
  assert.ok(csv.endsWith("\r\n"));
});
