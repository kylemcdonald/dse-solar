import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addReceipt, loadInbox, loadOriginal, reviewReceipt, purchaseCsv } from "../app/api/receipts/inboxServer";
import { handleReceiptInbox } from "../app/api/receipts/inboxHandler";
import { receiptSummary, receiptBomPurchases, validateReceiptReview, type ReceiptReview } from "../app/receiptLedger";

function fixture(t: { after: (fn: () => void) => void }) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "dse-receipt-test-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return path.join(parent, "private");
}
const pdf = (suffix = "") => Buffer.from(`%PDF-1.4\nTest receipt ${suffix}\n%%EOF`);
const review = (order = "test-123"): ReceiptReview => ({ kind: "purchase", vendor: "Amazon", orderNumber: order, date: "2026-09-14", currency: "USD", usdPerCurrency: 1, shipping: 2, tax: 1.95, discount: 0, total: 23.95, linkedReceiptId: "", notes: "Grant equipment", lines: [{ bomId: "polowat-panels", description: "Test material", asin: "B07BMNGVV3", quantity: 2, unitPrice: 10, disposition: "For installation" }] });

test("receipt originals persist, duplicate hashes deduplicate, projects remain separate and review archives originals", async t => {
  const root = fixture(t);
  const [first, second] = await Promise.all([addReceipt("polowat", "../../receipt.pdf", pdf(), root), addReceipt("polowat", "copy.pdf", pdf(), root)]);
  assert.equal(Number(first.duplicate) + Number(second.duplicate), 1);
  assert.equal(loadInbox("polowat", root).records.length, 1);
  const receipt = loadInbox("polowat", root).records[0];
  assert.equal(receipt.originalName, "receipt.pdf");
  assert.equal(loadOriginal("polowat", receipt.id, root).bytes.toString(), pdf().toString());
  await addReceipt("fiji", "same.pdf", pdf(), root);
  assert.equal(loadInbox("fiji", root).records.length, 1);
  const saved = await reviewReceipt("polowat", receipt.id, 0, review(), root);
  assert.equal(saved.revision, 1);
  assert.deepEqual(fs.readdirSync(path.join(root, "receipts/polowat/to-process")), []);
  assert.equal(receiptSummary(loadInbox("polowat", root).records).netUsd, 23.95);
  assert.equal(receiptSummary(loadInbox("fiji", root).records).pending, 1);
  await assert.rejects(reviewReceipt("polowat", receipt.id, 0, review(), root), /another window/);
  await reviewReceipt("polowat", receipt.id, 1, { ...review(), notes: "Corrected funding note" }, root);
  assert.equal(loadInbox("polowat", root).records[0].history.length, 2);
});

test("reconciliation rejects unbalanced totals, cross-project BOM IDs and duplicate order spend", async t => {
  const root = fixture(t);
  const first = await addReceipt("polowat", "one.pdf", pdf("one"), root);
  await assert.rejects(reviewReceipt("polowat", first.record.id, 0, { ...review(), total: 23.94 }, root), /does not balance/);
  const invalid = review(); invalid.lines[0].bomId = "fiji-item";
  await assert.rejects(reviewReceipt("polowat", first.record.id, 0, invalid, root), /does not belong/);
  await reviewReceipt("polowat", first.record.id, 0, review(), root);
  const second = await addReceipt("polowat", "two.pdf", pdf("two"), root);
  await assert.rejects(reviewReceipt("polowat", second.record.id, 0, review(), root), /already reconciled/);
  await reviewReceipt("polowat", second.record.id, 0, { ...review(), kind: "payment", linkedReceiptId: first.record.id }, root);
  assert.equal(receiptSummary(loadInbox("polowat", root).records).netUsd, 23.95);
  const credit = await addReceipt("polowat", "refund.pdf", pdf("refund"), root);
  await reviewReceipt("polowat", credit.record.id, 0, { ...review("refund-123"), kind: "refund", linkedReceiptId: first.record.id }, root);
  assert.equal(receiptSummary(loadInbox("polowat", root).records).netUsd, 0);
  assert.equal(receiptBomPurchases(loadInbox("polowat", root).records)["polowat-panels"].quantity, 2, "a price credit does not remove retained stock");
  const oversizedReturn = { ...review("refund-123"), kind: "refund" as const, linkedReceiptId: first.record.id };
  oversizedReturn.lines[0] = { ...oversizedReturn.lines[0], quantity: 4, unitPrice: 5, returnedQuantity: 4 };
  await assert.rejects(reviewReceipt("polowat", credit.record.id, 1, oversizedReturn, root), /quantities exceed/);
  const returned = { ...review("refund-123"), kind: "refund" as const, linkedReceiptId: first.record.id };
  returned.lines[0].returnedQuantity = 2;
  await reviewReceipt("polowat", credit.record.id, 1, returned, root);
  assert.equal(receiptBomPurchases(loadInbox("polowat", root).records)["polowat-panels"].quantity, 0);
  const extra = await addReceipt("polowat", "extra-refund.pdf", pdf("extra-refund"), root);
  await assert.rejects(reviewReceipt("polowat", extra.record.id, 0, { ...review("refund-456"), kind: "refund", linkedReceiptId: first.record.id }, root), /exceed/);
});

test("receipt arithmetic uses rounded lines and exports order-level amounts once", () => {
  const r = review(); r.lines.push({ ...r.lines[0], description: "=1+1", quantity: 1, unitPrice: .05 }); r.total = 24;
  assert.equal(validateReceiptReview(r, new Set(["polowat-panels"])).total, 24);
  assert.throws(() => validateReceiptReview({ ...r, tax: -1 }, new Set()), /does not belong|nonnegative/);
  const csv = purchaseCsv({ version: 1, project: "polowat", records: [{ id: "a".repeat(64), originalName: "private-address.pdf", extension: "pdf", bytes: 1, uploadedAt: "", revision: 1, review: r, history: [] }] });
  assert.equal(csv.split('"24"').length - 1, 2, "receipt total and net spend occur only on first line");
  assert.match(csv, /'=1\+1/);
  assert.doesNotMatch(csv, /private-address/);
});

test("uploads reject unsupported content, invalid projects and symlink storage escapes", async t => {
  const root = fixture(t);
  await assert.rejects(addReceipt("polowat", "fake.pdf", Buffer.from("<html>not a PDF</html>"), root), /PDF, PNG, or JPEG/);
  assert.throws(() => loadInbox("../escape" as "polowat", root), /Unknown/);
  fs.mkdirSync(root); fs.symlinkSync(path.dirname(root), path.join(root, "receipts"));
  await assert.rejects(addReceipt("polowat", "test.pdf", pdf(), root), /real directories/);
});

test("public mode gates all receipt operations; private mutations enforce origin and support multipart upload", async t => {
  const root = fixture(t), previous = process.env.DSE_PRIVATE_MODE;
  t.after(() => { if (previous === undefined) delete process.env.DSE_PRIVATE_MODE; else process.env.DSE_PRIVATE_MODE = previous; });
  delete process.env.DSE_PRIVATE_MODE;
  const url = "http://vibecheck.local:3001/api/receipts/inbox?project=polowat";
  for (const method of ["GET", "POST", "PATCH"]) assert.equal((await handleReceiptInbox(new Request(url, { method }), root)).status, 404);
  assert.equal(fs.existsSync(root), false);
  process.env.DSE_PRIVATE_MODE = "1";
  assert.equal((await handleReceiptInbox(new Request(url, { method: "POST", headers: { Origin: "https://untrusted.example", "X-Receipt-Request": "1" } }), root)).status, 403);
  const form = new FormData(); form.append("file", new Blob([new Uint8Array(pdf())], { type: "application/pdf" }), "test.pdf");
  const uploaded = await handleReceiptInbox(new Request(url, { method: "POST", headers: { Origin: "http://vibecheck.local:3001", "X-Receipt-Request": "1" }, body: form }), root);
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.headers.get("cache-control"), "no-store");
  assert.equal(loadInbox("polowat", root).records.length, 1);
});
