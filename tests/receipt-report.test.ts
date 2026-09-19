import test from "node:test";
import assert from "node:assert/strict";
import { buildReceiptPurchaseReport, createReceiptReportCsv, createReceiptReportPdf } from "../app/receiptReport";
import type { ReceiptLedger, ReceiptReview } from "../app/receiptLedger";

test("shared receipt format reconciles refunds, supporting evidence and currency rounding", () => {
  const purchase: ReceiptReview = {
    kind: "purchase", vendor: "Test supplier", orderNumber: "TEST-001", date: "2026-09-15",
    currency: "FJD", usdPerCurrency: 0.454545, shipping: 1, tax: 2, discount: 0.5, total: 5.5,
    linkedReceiptId: "", notes: "Grant purpose",
    lines: [{ bomId: "", description: "Test part", asin: "", quantity: 3, unitPrice: 1, disposition: "installed" }],
  };
  const reviews = [purchase, { ...purchase, kind: "refund" as const }, { ...purchase, kind: "payment" as const }];
  const ledger: ReceiptLedger = { version: 1, project: "polowat", records: reviews.map((review, i) => ({
    id: String(i).repeat(64), originalName: "private-name.pdf", extension: "pdf", bytes: 1,
    uploadedAt: "", revision: 1, history: [], review,
  })) };
  const report = buildReceiptPurchaseReport(ledger, "2026-09-16");
  assert.equal(report.grandTotalUsd, 0);
  assert.deepEqual(report.sections.map(s => s.subtotalUsd), [2.5, -2.5, 0]);
  for (const section of report.sections) assert.equal(Math.round(section.lines.reduce((sum, l) => sum + l.costUsd, 0) * 100), section.subtotalUsd * 100);
  assert.equal(Math.round(report.presentation.summaryRows.reduce((sum, [, amount]) => sum + amount, 0) * 100), 0);
  const csv = createReceiptReportCsv(ledger);
  const pdf = new TextDecoder().decode(createReceiptReportPdf(ledger));
  assert.match(csv, /"Quantity","Unit","Evidence","Original currency","Original amount","USD equivalent","Note"/);
  assert.match(csv, /TEST-001/);
  assert.match(csv, /Grant purpose/);
  assert.match(pdf, /Helvetica-Bold/);
  assert.match(pdf, /EXPENSE RECONCILIATION/);
  assert.match(pdf, /COMBINED TOTAL/);
  assert.doesNotMatch(csv + pdf, /IYOIYO|PTS ADVANCE|VERIFIED FIJI|private-name/);
});
