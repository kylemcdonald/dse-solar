import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Settled credits replace the matching assumption, including partial refunds.
// Match explicit item allocations, never words such as "return" in a cable name.
export function remainingAssumedRefundUsd(bom, bomId, expectedUsd) {
  const confirmedCents = bom.filter((row) => row.refundStatus === "confirmed" && row.totalUsd < 0)
    .flatMap((row) => row.refundAllocations ?? [])
    .filter((allocation) => allocation.bomId === bomId)
    .reduce((sum, allocation) => sum + Math.round(allocation.amountUsd * 100), 0);
  return Math.max(0, Math.round(expectedUsd * 100) - confirmedCents) / 100;
}

function reconcile() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
  const system = read("data/dse-system.json");
  const delivery = read("data/dse-delivery.json");
  const customs = read("data/dse-customs.json");
  const assumptionsPath = "private/amazon-return-assumptions-2026-09-13.json";
  const assumptions = fs.existsSync(path.join(root, assumptionsPath)) ? read(assumptionsPath).assumptions : [];
  const existing = new Map(system.bom.map((item) => [item.id, item]));
  for (const entry of assumptions) {
    const item = existing.get(entry.bomId);
    if (!item) throw new Error(`Missing return purchase ${entry.bomId}`);
    const totalCents = entry.orders.reduce((sum, order) => {
      const calculated = ["itemAmountUsd", "shippingUsd", "freeShippingUsd", "promotionUsd", "taxUsd"]
        .reduce((subtotal, key) => subtotal + Math.round((order[key] ?? 0) * 100), 0);
      if (calculated !== Math.round(order.refundAmountUsd * 100)) throw new Error("Return allocation does not reconcile");
      return sum + calculated;
    }, 0);
    if (totalCents !== Math.round(entry.amountUsd * 100)) throw new Error("Return total does not reconcile");
    const note = `Assumed refund under the owner's 13 Sep 2026 instruction; Amazon processing is not confirmed. ${entry.orders.some((order) => order.basis.startsWith("Order-level"))
      ? "Includes proportional allocation of order-level tax and discounts."
      : "Assumes the full order amount, including tax and any original shipping, is refunded."} Original purchase evidence supports the amount, not a completed refund.`;
    item.accountingGroup = "returns";
    item.includedInTotal = false;
    item.returnAccounting = "assumed";
    item.procurement = "Purchased · treated as returned · refund assumed";
    item.grantPaymentNote = `Offset by a separately listed assumed refund. ${note}`;
    if (!existing.has(entry.refundId)) {
      const credit = {
        id: entry.refundId, category: "Purchase adjustments", item: `Assumed Amazon refund · ${entry.item}`,
        qty: 1, unit: "refund credit", currency: "USD", location: "Return",
        procurement: "Purchased · assumed refund · Amazon confirmation pending", priority: "Accounting assumption",
        accountingGroup: "returns", includedInTotal: false, grantPayer: "IYOIYO",
        refundStatus: "assumed", refundForBomId: entry.bomId, refundExpectedUsd: entry.amountUsd,
        description: note, grantPaymentNote: note,
        unitWeightKg: 0, totalWeightKg: 0, weightBasis: "not-applicable", weightNote: "Refund credit; no physical item.",
      };
      system.bom.push(credit); existing.set(credit.id, credit);
    }
    delivery.items[entry.bomId] = { ...delivery.items[entry.bomId],
      amazonStatus: "refund-assumed", eta: "Treated as returned for accounting", time: "Amazon refund not confirmed", note };
    customs.itemMeta[entry.bomId] = { ...customs.itemMeta[entry.bomId],
      excludedFromManifest: true, exclusionReason: "Return item, excluded from installed/import inventory; refund assumed for accounting under owner instruction." };
  }
  // These allocations come from the previously reconciled Amazon refund records.
  const confirmed = {
    "dse-refund-igreely-1-0-cables": [["dse-1-0-battery-cables-1ft", 62.52], ["dse-1-0-battery-cables-2ft", 31.82]],
    "dse-refund-dihool-30a-ac-protection": [["dse-ac-30a-rejected", 57.04]],
    "dse-refund-amomd-600a-busbars": [["dse-amomd-600a-busbars-unused", 98.76]],
    "dse-refund-chtaixi-ac-rcbos": [["dse-chtai-ac-rcbos-rejected", 35.96]],
    "dse-refund-victron-wirebox-mc4": [["dse-mppt-wirebox-mc4-rejected", 38.85]],
  };
  for (const [id, allocations] of Object.entries(confirmed)) {
    const credit = existing.get(id);
    if (!credit) throw new Error(`Missing recorded refund ${id}`);
    credit.refundStatus = "confirmed";
    credit.refundAllocations = allocations.map(([bomId, amountUsd]) => ({ bomId, amountUsd }));
  }
  for (const credit of system.bom.filter((row) => row.refundStatus === "confirmed")) {
    if (credit.totalUsd >= 0 || Math.round(-credit.totalUsd * 100) !== (credit.refundAllocations ?? [])
      .reduce((sum, allocation) => sum + Math.round(allocation.amountUsd * 100), 0)) {
      throw new Error(`Confirmed refund allocations must reconcile: ${credit.id}`);
    }
  }
  const seen = new Set();
  for (const credit of system.bom.filter((row) => row.refundStatus === "assumed")) {
    if (seen.has(credit.refundForBomId)) throw new Error("Duplicate refund assumption for one purchase");
    seen.add(credit.refundForBomId);
    credit.totalUsd = -remainingAssumedRefundUsd(system.bom, credit.refundForBomId, credit.refundExpectedUsd);
    credit.unitCost = credit.totalUsd;
    credit.refundAllocations = [{ bomId: credit.refundForBomId, amountUsd: -credit.totalUsd }];
    if (credit.totalUsd === 0) {
      const item = existing.get(credit.refundForBomId);
      const note = "Amazon-issued refund replaces the earlier accounting assumption; no additional assumed credit remains. Original purchase and confirmed refund are retained separately.";
      credit.grantPaymentNote = note;
      credit.description = note;
      credit.procurement = "Purchased · refund assumption superseded by confirmed credit";
      item.returnAccounting = "confirmed";
      item.procurement = "Purchased · returned · refund issued";
      item.grantPaymentNote = note;
      delivery.items[item.id] = { ...delivery.items[item.id],
        amazonStatus: "refunded", eta: "Returned", time: "Amazon refund issued", note };
      customs.itemMeta[item.id] = { ...customs.itemMeta[item.id],
        excludedFromManifest: true, exclusionReason: "Returned item; Amazon-issued refund confirmed." };
    }
  }
  write("data/dse-system.json", system);
  write("data/dse-delivery.json", delivery);
  write("data/dse-customs.json", customs);
  console.log(`Reconciled ${seen.size} assumed return credits against explicitly allocated confirmed refunds.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) reconcile();
