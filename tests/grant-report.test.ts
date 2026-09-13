import assert from "node:assert/strict";
import test from "node:test";

import receipts from "../data/dse-receipts.json";
import system from "../data/dse-system.json";
import {
  buildGrantPurchaseReport,
  compactReceiptReferences,
  createGrantReportCsv,
  createGrantReportPdf,
  describeEvidence,
  grantReportCsvFilename,
  grantReportFilename,
  type GrantReportBomItem,
  type GrantReportReceiptIndex,
  type GrantReportSectionId,
} from "../app/grantReport";

const report = buildGrantPurchaseReport(
  system.bom as GrantReportBomItem[],
  receipts as GrantReportReceiptIndex,
  new Date(2026, 8, 3, 12),
);
const section = (id: GrantReportSectionId) => report.sections.find((candidate) => candidate.id === id)!;
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

test("new Fiji source documents reconcile without exposing bank details", () => {
  const invoiceByNumber = new Map(receipts.invoices.map((invoice) => [invoice.number, invoice]));
  assert.deepEqual(invoiceByNumber.get(48), {
    number: 48,
    date: "2026-09-01",
    filename: "rc-manubhai-2026-09-01-invoice-12185922-site-supplies.pdf",
    supplier: "R.C. Manubhai",
    kind: "Tax invoice",
    reference: "12185922",
  });
  assert.equal(invoiceByNumber.get(49)?.kind, "Quote");
  assert.equal(invoiceByNumber.get(49)?.reference, "TP260901-V2");
  assert.equal(invoiceByNumber.get(50)?.kind, "Payment confirmation");
  assert.equal(invoiceByNumber.get(50)?.reference, "Solar Fiji wire");
  assert.doesNotMatch(JSON.stringify(receipts), /confirmation number|account number|routing number/i);

  const solarLineIds = Object.entries(receipts.itemInvoices)
    .filter(([, refs]) => refs.includes(49) || refs.includes(50));
  assert.equal(solarLineIds.length, 22);
  assert.ok(solarLineIds.every(([, refs]) => refs.includes(49) && refs.includes(50)));
  const hardwareLineIds = Object.entries(receipts.itemInvoices).filter(([, refs]) => refs.includes(48));
  assert.equal(hardwareLineIds.length, 9);
});

test("grant report makes Fiji source currency, evidence, and IYOIYO funding explicit", () => {
  assert.deepEqual(report.sections.map((candidate) => candidate.title), [
    "On-site Fiji purchases",
    "Other solar-system purchases",
    "Fiji customs and clearance costs",
    "Outside-scope purchases",
  ]);
  assert.equal(section("fiji").lines.length, 31);
  assert.ok(section("fiji").lines.every((line) => line.sourceCurrency === "FJD"));
  assert.equal(report.fijiPurchasesSourceFjd, 12_222);
  assert.equal(report.fijiPurchasesSubtotalUsd, 5_555.46);

  const panels = section("fiji").lines.find((line) => line.id === "dse-panels")!;
  assert.equal(panels.sourceAmount, 1_650);
  assert.equal(panels.costUsd, 750);
  assert.deepEqual(panels.receiptRefs, [49, 50]);
  assert.equal(describeEvidence(panels.evidence),
    "#49 Quote TP260901-V2 (Solar Fiji); #50 Payment confirmation Solar Fiji wire (Bank of America)");
  const hardware = section("fiji").lines.find((line) => line.id === "dse-fiji-3m-extension-cords")!;
  assert.equal(hardware.sourceAmount, 22);
  assert.deepEqual(hardware.receiptRefs, [48]);

  const reportIds = new Set(report.sections.flatMap((candidate) => candidate.lines.map((line) => line.id)));
  assert.equal(reportIds.has("dse-suntech-panels-superseded"), false);
  assert.equal(reportIds.has("dse-everexceed-batteries-superseded"), false);
});

test("every supported purchase appears exactly once and IYOIYO total reconciles", () => {
  const expectedReceiptBackedIds = system.bom
    .filter((item) => item.procurement.includes("Purchased"))
    .filter((item) => Number.isFinite(item.totalUsd) && item.totalUsd !== 0)
    .filter((item) => receipts.itemInvoices[item.id as keyof typeof receipts.itemInvoices]?.length)
    .map((item) => item.id)
    .sort();
  const reportLines = report.sections.flatMap((candidate) => candidate.lines);
  assert.deepEqual(reportLines.map((line) => line.id).sort(), expectedReceiptBackedIds);
  assert.equal(new Set(reportLines.map((line) => line.id)).size, 144);
  assert.ok(reportLines.every((line) => line.receiptRefs.length > 0));

  assert.equal(section("fiji").subtotalUsd, 5_555.46);
  assert.equal(section("solar").subtotalUsd, 4_324.87);
  assert.equal(section("customs").subtotalUsd, 1_276.60);
  assert.equal(section("outside").subtotalUsd, 3_422.50);
  assert.equal(report.iyoyioPurchasesSubtotalUsd, 14_579.43);
  assert.equal(report.solarSystemSubtotalUsd, 11_156.93);
  assert.equal(report.outsideScopeSubtotalUsd, 3_422.50);
  assert.equal(report.inowonAllocationUsd, 179.98);
  assert.equal(report.iyoyioCheckAmountUsd, 8_000);
  assert.equal(report.iyoyioCheckBalanceUsd, -6_579.43);
  assert.equal(report.grandTotalUsd, 14_579.43);
  assert.equal(report.grandTotalUsd, report.iyoyioPurchasesSubtotalUsd);
  assert.equal(report.grandTotalUsd, cents(report.solarSystemSubtotalUsd + report.outsideScopeSubtotalUsd));
  assert.equal(report.grandTotalUsd, cents(report.sections.reduce((sum, candidate) => sum + candidate.subtotalUsd, 0)));

  const customs = section("customs").lines;
  assert.deepEqual(customs.map((line) => [line.id, line.receiptRefs]), [
    ["dse-customs-vat", [44]],
    ["dse-customs-agent-costs", [44]],
  ]);
  assert.equal(cents(customs.reduce((sum, line) => sum + line.sourceAmount, 0)), 2_808.53);
  assert.ok(system.bom
    .filter((item) => ["dse-customs-vat", "dse-customs-agent-costs"].includes(item.id))
    .every((item) => item.grantPayer === "IYOIYO"));
  const outsideIds = new Set(section("outside").lines.map((line) => line.id));
  assert.ok([
    "dse-unused-macbook-air-15-m4",
    "dse-unused-galaxy-s24-pair",
    "dse-unused-sandisk-portable-ssd",
    "dse-laptop-sleeve-additional",
    "dse-personal-garmin-montana-710i",
    "dse-personal-flexsolar-panels",
    "dse-personal-takoci-hx870-batteries",
    "dse-unused-acer-card-readers",
  ].every((id) => outsideIds.has(id)));
  assert.ok(section("outside").lines.every((line) => line.scope === "outside-scope"));
  const recipientAllocations = section("outside").lines.flatMap((line) => line.allocations);
  assert.deepEqual(recipientAllocations.map(({ recipientOrganization, location, qty, amountUsd }) =>
    [recipientOrganization, location, qty, amountUsd]), [
    ["Inowon", "Polowat", 1, 164.99],
    ["Inowon", "Polowat", 1, 14.99],
  ]);
  const ekrano = section("solar").lines.find((line) => line.id === "dse-ekrano-gx")!;
  assert.match(ekrano.note ?? "", /Erik Godo donation to Pacific Traditions Society/);

  for (const reportSection of report.sections) {
    assert.deepEqual(reportSection.lines.map((line) => line.costUsd),
      reportSection.lines.map((line) => line.costUsd).sort((first, second) => second - first));
  }
});

test("grant PDF leads with the IYOIYO and source-currency reconciliation", () => {
  assert.equal(compactReceiptReferences([1, 2, 3, 7, 9, 10]), "#1-3, #7, #9-10");
  assert.equal(report.generatedDate, "2026-09-03");
  assert.equal(grantReportFilename(report), "dse-grant-purchase-report-2026-09-03.pdf");

  const pdf = new TextDecoder().decode(createGrantReportPdf(report));
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /Funding reconciliation & purchase ledger/);
  assert.match(pdf, /Generated September 3, 2026/);
  assert.match(pdf, /All documented purchase and customs costs in this report were paid by IYOIYO/);
  assert.match(pdf, /Fiji customs and clearance costs/);
  assert.match(pdf, /VERIFIED FIJI SOURCE TOTAL/);
  assert.match(pdf, /FJD 12,222\.00/);
  assert.match(pdf, /IYOIYO paid beyond PTS advance/);
  assert.match(pdf, /\$6,579\.43/);
  assert.match(pdf, /PURCHASE SCOPE SUMMARY/);
  assert.match(pdf, /Solar system/);
  assert.match(pdf, /\$11,156\.93/);
  assert.match(pdf, /Outside scope/);
  assert.match(pdf, /\$3,422\.50/);
  assert.match(pdf, /of which Inowon in Polowat/);
  assert.match(pdf, /\$179\.98/);
  assert.match(pdf, /COMBINED TOTAL/);
  assert.match(pdf, /\$14,579\.43/);
  assert.doesNotMatch(pdf, /PAID BY/);
  assert.doesNotMatch(pdf, /DSE PAID|Costs paid directly by DSE/);
  assert.ok(Number(pdf.match(/\/Type \/Pages .*\/Count (\d+)/)?.[1]) > 1);
  assert.ok(pdf.endsWith("%%EOF\n"));
});

test("grant CSV is an evidence-rich, dual-currency accounting ledger", () => {
  assert.equal(grantReportCsvFilename(report), "dse-grant-purchase-report-2026-09-03.csv");
  const csv = createGrantReportCsv(report);
  assert.ok(csv.startsWith("\uFEFF\"Report\",\"DSE Grant Purchase Report\""));
  assert.ok(csv.includes("\"Row type\",\"Section\",\"Item\",\"Quantity\",\"Unit\",\"Evidence\",\"Original currency\",\"Original amount\",\"USD equivalent\",\"Note\""));
  assert.doesNotMatch(csv, /"Paid by"|"DSE"/);
  assert.equal(csv.split("\r\n").filter((row) => row.startsWith("\"Item\",")).length, 144);
  assert.ok(csv.includes("\"Item\",\"On-site Fiji purchases\",\"AIKO Neostar 3P54 490 W panel · AIKO-A490-MCE54Mw\",3,\"ea\",\"#49 Quote TP260901-V2 (Solar Fiji); #50 Payment confirmation Solar Fiji wire (Bank of America)\",\"FJD\",1650.00,750.00,"));
  assert.ok(csv.includes("\"Section subtotal\",\"On-site Fiji purchases\",\"On-site Fiji purchases subtotal\",,,,\"FJD\",12222.00,5555.46,"));
  assert.ok(csv.includes("\"Source reconciliation\",\"Funding summary\",\"Verified on-site Fiji purchases\",,,\"#48-50\",\"FJD\",12222.00,5555.46,"));
  assert.ok(csv.includes("\"Purchase subtotal\",\"Funding summary\",\"All purchases paid by IYOIYO\",,,,,,14579.43,"));
  assert.ok(csv.includes("\"Funding balance\",\"Funding summary\",\"PTS advance less IYOIYO purchases\",,,,\"USD\",-6579.43,-6579.43,\"$6,579.43 paid by IYOIYO beyond the $8,000.00 PTS advance\""));
  assert.ok(csv.includes("\"Scope subtotal\",\"Purchase scope summary\",\"Solar system\",,,,,,11156.93,"));
  assert.ok(csv.includes("\"Scope subtotal\",\"Purchase scope summary\",\"Outside scope\",,,,,,3422.50,"));
  assert.ok(csv.includes("\"Allocation detail\",\"Purchase scope summary\",\"Inowon in Polowat\",,,,,,179.98,"));
  assert.ok(csv.includes("\"Grand total\",\"Purchase scope summary\",\"COMBINED TOTAL\",,,,,,14579.43,"));
  assert.match(csv, /Allocation: 1 of 2 SSDs \(\$164\.99 item price\) is for Inowon in Polowat/);
  assert.match(csv, /Allocation: 1 of 2 SD card readers \(\$14\.99 item price\) is for Inowon in Polowat/);
  assert.ok(csv.endsWith("\r\n"));
});
