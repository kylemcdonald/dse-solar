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

test("chart reconciliation explains estimates, missing evidence, and documented credits", () => {
  const row = (id: string, totalUsd: number, procurement = "Purchased"): GrantReportBomItem => ({
    id, item: id, totalUsd, procurement, qty: 1, unit: "ea", unitCost: totalUsd, currency: "USD",
  });
  const example = buildGrantPurchaseReport([
    row("paid", 100), row("refund", -20), row("allowance", 30, "Allowance"),
    row("missing-receipt", 15), row("unknown-reference", 5), row("unverified-credit", -7),
    row("zero", 0), row("invalid", Number.NaN),
  ], {
    invoices: [{ number: 1, date: "2026-08-21", supplier: "Supplier", filename: "receipt.pdf" }],
    itemInvoices: { paid: [1, 1], refund: [1], "unknown-reference": [99] },
  });
  assert.equal(example.grandTotalUsd, 80);
  assert.deepEqual(example.costReconciliation, {
    positiveTotalUsd: 150, omittedPositiveTotalUsd: 50, creditsUsd: 20,
    omittedLines: [
      { id: "allowance", item: "allowance", costUsd: 30, reason: "Not recorded as a completed purchase: Allowance" },
      { id: "missing-receipt", item: "missing-receipt", costUsd: 15, reason: "Purchase recorded; supporting receipt is missing" },
      { id: "unknown-reference", item: "unknown-reference", costUsd: 5, reason: "Purchase recorded; supporting receipt is missing" },
    ],
  });
  assert.match(createGrantReportCsv(example), /"IYOIYO net expenses",,,,,,80.00/);
  assert.match(new TextDecoder().decode(createGrantReportPdf(example)), /COST CHART TO GRANT REPORT/);
});

test("the live chart and grant report reconcile to the cent", () => {
  const { positiveTotalUsd, omittedPositiveTotalUsd, creditsUsd } = report.costReconciliation;
  assert.equal(cents(positiveTotalUsd - omittedPositiveTotalUsd - creditsUsd), report.grandTotalUsd);
  assert.equal(creditsUsd, 983.19);
  assert.equal(positiveTotalUsd, 16_387.03);
  assert.equal(omittedPositiveTotalUsd, 0);
  assert.equal(system.bom.some((item) => item.procurement.includes("Allowance")), false);
});

test("all three MultiPlus payments are one fully paid IYOIYO expense using actual bank debits", () => {
  const item = system.bom.find((row) => row.id === "dse-multiplus")!;
  const lines = section("fiji").lines.filter((line) => line.id === item.id);
  assert.equal(lines.length, 1);
  assert.equal(item.grantPayer, "IYOIYO");
  assert.match(item.procurement, /paid in full/);
  assert.equal("paidFraction" in item, false);
  assert.deepEqual(lines[0].receiptRefs, [51, 52, 53]);
  assert.equal(lines[0].sourceAmount, 2_971);
  assert.equal(lines[0].costUsd, cents(273.28 + 942.33 + 167.11));
  assert.notEqual(lines[0].costUsd, cents(2_971 / 2.2));
  assert.match(lines[0].note ?? "", /No balance remains due/);
});

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
  assert.equal(section("fiji").lines.length, 32);
  assert.ok(section("fiji").lines.every((line) => line.sourceCurrency === "FJD"));
  assert.equal(report.fijiPurchasesSourceFjd, 15_193);
  assert.equal(report.fijiPurchasesSubtotalUsd, 6_938.18);

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
  assert.equal(new Set(reportLines.map((line) => line.id)).size, 158);
  assert.ok(reportLines.every((line) => line.receiptRefs.length > 0));

  assert.equal(section("fiji").subtotalUsd, 6_938.18);
  assert.equal(section("solar").subtotalUsd, 3_766.56);
  assert.equal(section("customs").subtotalUsd, 1_276.60);
  assert.equal(section("outside").subtotalUsd, 3_422.50);
  assert.equal(report.iyoyioPurchasesSubtotalUsd, 15_403.84);
  assert.equal(report.solarSystemSubtotalUsd, 11_981.34);
  assert.equal(report.outsideScopeSubtotalUsd, 3_422.50);
  assert.equal(report.inowonAllocationUsd, 179.98);
  assert.equal(report.iyoyioCheckAmountUsd, 8_000);
  assert.equal(report.iyoyioCheckBalanceUsd, -7_403.84);
  assert.equal(report.grandTotalUsd, 15_403.84);
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
  assert.match(pdf, /IYOIYO paid the documented purchases and customs costs/);
  assert.match(pdf, /Fiji customs and clearance costs/);
  assert.match(pdf, /VERIFIED FIJI SOURCE TOTAL/);
  assert.match(pdf, /FJD 15,193\.00/);
  assert.match(pdf, /Net expenses beyond PTS advance/);
  assert.match(pdf, /\$7,403\.84/);
  assert.match(pdf, /PURCHASE SCOPE SUMMARY/);
  assert.match(pdf, /Solar system/);
  assert.match(pdf, /\$11,981\.34/);
  assert.match(pdf, /Outside scope/);
  assert.match(pdf, /\$3,422\.50/);
  assert.match(pdf, /of which Inowon in Polowat/);
  assert.match(pdf, /\$179\.98/);
  assert.match(pdf, /COMBINED TOTAL/);
  assert.match(pdf, /\$15,403\.84/);
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
  assert.equal(csv.split("\r\n").filter((row) => row.startsWith("\"Item\",")).length, 158);
  assert.ok(csv.includes("\"Item\",\"On-site Fiji purchases\",\"AIKO Neostar 3P54 490 W panel · AIKO-A490-MCE54Mw\",3,\"ea\",\"#49 Quote TP260901-V2 (Solar Fiji); #50 Payment confirmation Solar Fiji wire (Bank of America)\",\"FJD\",1650.00,750.00,"));
  assert.ok(csv.includes("\"Section subtotal\",\"On-site Fiji purchases\",\"On-site Fiji purchases subtotal\",,,,\"FJD\",15193.00,6938.18,"));
  assert.ok(csv.includes("\"Source reconciliation\",\"Funding summary\",\"Verified on-site Fiji purchases\",,,\"#48-53\",\"FJD\",15193.00,6938.18,"));
  assert.ok(csv.includes("\"Purchase subtotal\",\"Funding summary\",\"Net IYOIYO expenses after refunds\",,,,,,15403.84,"));
  assert.ok(csv.includes("\"Funding balance\",\"Funding summary\",\"PTS advance less IYOIYO purchases\",,,,\"USD\",-7403.84,-7403.84,\"$7,403.84 net expenses beyond the $8,000.00 PTS advance\""));
  assert.ok(csv.includes("\"Scope subtotal\",\"Purchase scope summary\",\"Solar system\",,,,,,11981.34,"));
  assert.ok(csv.includes("\"Scope subtotal\",\"Purchase scope summary\",\"Outside scope\",,,,,,3422.50,"));
  assert.ok(csv.includes("\"Allocation detail\",\"Purchase scope summary\",\"Inowon in Polowat\",,,,,,179.98,"));
  assert.ok(csv.includes("\"Grand total\",\"Purchase scope summary\",\"COMBINED TOTAL\",,,,,,15403.84,"));
  assert.match(csv, /Allocation: 1 of 2 SSDs \(\$164\.99 item price\) is for Inowon in Polowat/);
  assert.match(csv, /Allocation: 1 of 2 SD card readers \(\$14\.99 item price\) is for Inowon in Polowat/);
  assert.ok(csv.endsWith("\r\n"));
});
