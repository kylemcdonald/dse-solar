import assert from "node:assert/strict";
import test from "node:test";
import system from "../data/dse-system.json";
import receipts from "../data/dse-receipts.json";
import { remainingAssumedRefundUsd } from "../scripts/reconcile-return-refunds.mjs";
import { buildGrantPurchaseReport, type GrantReportBomItem } from "../app/grantReport";

test("confirmed refunds replace assumptions instead of creating duplicate credits", () => {
  const confirmed = (amount: number) => ({ refundStatus: "confirmed", totalUsd: -amount,
    refundAllocations: [{ bomId: "returned-item", amountUsd: amount }] });
  assert.equal(remainingAssumedRefundUsd([], "returned-item", 135.63), 135.63);
  assert.equal(remainingAssumedRefundUsd([confirmed(35.63)], "returned-item", 135.63), 100);
  assert.equal(remainingAssumedRefundUsd([confirmed(35.63), confirmed(100)], "returned-item", 135.63), 0);
  assert.equal(remainingAssumedRefundUsd([confirmed(140)], "returned-item", 135.63), 0);
  assert.equal(remainingAssumedRefundUsd([confirmed(35.63)], "other-item", 135.63), 135.63);
  assert.equal(remainingAssumedRefundUsd([{ ...confirmed(135.63), refundStatus: "assumed" }], "returned-item", 135.63), 135.63);
});

test("every pending return is offset once, with original purchase evidence and explicit assumptions", () => {
  const assumed = system.bom.filter((row) => "refundStatus" in row && row.refundStatus === "assumed");
  assert.equal(assumed.length, 8);
  for (const credit of assumed) {
    const source = system.bom.find((row) => row.id === credit.refundForBomId)!;
    assert.equal(source.accountingGroup, "returns");
    assert.ok(credit.totalUsd <= 0);
    if (credit.totalUsd < 0) assert.match(credit.grantPaymentNote ?? "", /not confirmed/);
    else assert.match(credit.grantPaymentNote ?? "", /replaces the earlier/);
    const index = receipts.itemInvoices as Record<string, number[]>;
    for (const ref of index[source.id]) assert.ok(index[credit.id].includes(ref));
  }
  const midnite = assumed.find((row) => row.refundForBomId === "dse-battery-string-breakers-midnite-unused")!;
  assert.equal(midnite.totalUsd, -135.63);
  assert.ok(receipts.itemInvoices[midnite.id as keyof typeof receipts.itemInvoices].includes(10));
  assert.equal(assumed.some((row) => row.refundForBomId === "dse-service-return-bus"), false);
  assert.equal(assumed.some((row) => row.refundForBomId === "dse-service-return-bus-spares"), false);
  const report = buildGrantPurchaseReport(system.bom as GrantReportBomItem[], receipts);
  assert.equal(report.assumedRefundsUsd, 239.32);
  assert.equal(report.recordedNetExpensesUsd, 15643.16);
  assert.equal(report.grandTotalUsd, 15403.84);
  assert.equal(report.costReconciliation.creditsUsd, 983.19);
});

test("September return audit preserves gross purchases and deducts each issued refund once", () => {
  const credits = system.bom.filter(row => row.id.endsWith("-confirmed-refund-2026-09-18"));
  assert.equal(credits.length, 8);
  assert.equal(Math.round(credits.reduce((sum, row) => sum - row.totalUsd, 0) * 100), 31899);
  const confirmedIds = new Set(credits.map(row => row.id));
  for (const row of credits) {
    assert.equal(row.refundStatus, "confirmed");
    assert.equal(Math.round(-row.totalUsd * 100), Math.round(row.refundAllocations!.reduce((sum, a) => sum + a.amountUsd, 0) * 100));
    const refs = (receipts.itemInvoices as Record<string, number[]>)[row.id];
    assert.ok(receipts.invoices.some(invoice => refs.includes(invoice.number) && invoice.kind === "Refund confirmation"));
  }
  const replaced = system.bom.filter(row => row.refundStatus === "assumed" && row.totalUsd === 0);
  assert.equal(replaced.length, 3);
  assert.equal(Math.round(replaced.reduce((sum, row) => sum + row.refundExpectedUsd!, 0) * 100), 7569);
  const report = buildGrantPurchaseReport(system.bom as GrantReportBomItem[], receipts);
  assert.equal(report.sections.flatMap(section => section.lines).filter(line => confirmedIds.has(line.id)).length, 8);
  const cable = system.bom.find(row => row.id === "dse-battery-cable")!;
  assert.equal(cable.qty, 5);
  assert.equal(cable.totalUsd, 124.15);
  assert.equal(cable.returnedQuantity, 4);
  assert.equal(cable.retainedQuantity, 1);
  assert.equal(report.grandTotalUsd, 15647.14 - 243.30);
});
