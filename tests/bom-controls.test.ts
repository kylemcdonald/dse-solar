import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { getBomAccountingGroup, getBomAccountingTotals, isItemToPurchase, sortBomItems, type BomItem } from "../app/SystemViewer";

const row = (id: string, procurement: string, totalUsd: number, totalWeightKg?: number): BomItem => ({
  id, category: "Test", item: id, qty: 1, unit: "ea", unitCost: totalUsd, currency: "USD", totalUsd,
  location: "Import", procurement, priority: "Test", description: "Test row", ...(totalWeightKg === undefined ? {} : { totalWeightKg }),
});

test("items-to-purchase filter hides every requested completed/out-of-scope status", () => {
  assert.equal(isItemToPurchase(row("purchased", "Purchased", 1)), false);
  assert.equal(isItemToPurchase(row("variant", "Purchased · allocation check", 1)), false);
  assert.equal(isItemToPurchase(row("donated", "Donated", 1)), false);
  assert.equal(isItemToPurchase(row("outside", "Outside scope", 1)), false);
  assert.equal(isItemToPurchase(row("deposit", "Deposit paid", 1)), false);
  assert.equal(isItemToPurchase(row("buy", "Buy", 1)), true);
  assert.equal(isItemToPurchase(row("allowance", "Allowance", 1)), true);
});

test("BOM rows sort by weight, cost and status in both directions", () => {
  const rows = [row("b", "Buy", 20, 2), row("a", "Allowance", 10, 1), row("pending", "Research candidate", 30)];
  assert.deepEqual(sortBomItems(rows, "weight", "desc").map((item) => item.id), ["b", "a", "pending"]);
  assert.deepEqual(sortBomItems(rows, "weight", "asc").map((item) => item.id), ["a", "b", "pending"]);
  assert.deepEqual(sortBomItems(rows, "cost", "desc").map((item) => item.id), ["pending", "b", "a"]);
  assert.deepEqual(sortBomItems(rows, "status", "asc").map((item) => item.id), ["a", "b", "pending"]);
});

test("BOM accounting keeps additional purchases and exclusions out of the solar/internet design total", () => {
  const designPurchased = row("design-purchased", "Purchased", 100);
  const designDeposit = { ...row("design-deposit", "Deposit paid", 40), paidFraction: 0.5 };
  const additionalPurchased = { ...row("phone", "Purchased · outside scope", 80), accountingGroup: "additional" as const, includedInTotal: false };
  const additionalPlanned = { ...row("laptop", "Buy", 20), accountingGroup: "additional" as const, includedInTotal: false };
  const additionalPromotion = { ...row("promotion", "Purchased · personal use", -5), accountingGroup: "additional" as const, includedInTotal: false };
  const returned = { ...row("return", "Purchased · return pending", 30), includedInTotal: false };

  assert.equal(getBomAccountingGroup(designPurchased), "system");
  assert.equal(getBomAccountingGroup(additionalPurchased), "additional");
  assert.equal(getBomAccountingGroup(returned), "excluded");
  assert.deepEqual(getBomAccountingTotals([
    designPurchased, designDeposit, additionalPurchased, additionalPlanned, additionalPromotion, returned,
  ]), {
    systemTotal: 140,
    systemPaid: 120,
    systemRemaining: 20,
    systemRows: 2,
    additionalTotal: 95,
    additionalPaid: 75,
    additionalRemaining: 20,
    additionalRows: 3,
  });
});

test("BOM filter labels and sortable headings are exposed in the UI", () => {
  const source = fs.readFileSync("app/SystemViewer.tsx", "utf8");
  assert.ok(source.includes('"Show Items To Purchase"'));
  assert.ok(source.includes('"Show All"'));
  assert.ok(source.includes('changeSort("weight")'));
  assert.ok(source.includes('changeSort("cost")'));
  assert.ok(source.includes('changeSort("status")'));
  assert.ok(source.includes('data-bom-total="design"'));
  assert.ok(source.includes('data-bom-total="additional"'));
});
