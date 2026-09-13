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
    assert.ok(credit.totalUsd < 0);
    assert.match(credit.grantPaymentNote ?? "", /not confirmed/);
    const index = receipts.itemInvoices as Record<string, number[]>;
    assert.deepEqual(index[credit.id], index[source.id]);
  }
  const midnite = assumed.find((row) => row.refundForBomId === "dse-battery-string-breakers-midnite-unused")!;
  assert.equal(midnite.totalUsd, -135.63);
  assert.deepEqual(receipts.itemInvoices[midnite.id as keyof typeof receipts.itemInvoices], [10]);
  assert.equal(assumed.some((row) => row.refundForBomId === "dse-service-return-bus"), false);
  assert.equal(assumed.some((row) => row.refundForBomId === "dse-service-return-bus-spares"), false);
  const report = buildGrantPurchaseReport(system.bom as GrantReportBomItem[], receipts);
  assert.equal(report.assumedRefundsUsd, 315.01);
  assert.equal(report.recordedNetExpensesUsd, 15962.15);
  assert.equal(report.grandTotalUsd, 15647.14);
  assert.equal(report.costReconciliation.creditsUsd, 739.89);
});
