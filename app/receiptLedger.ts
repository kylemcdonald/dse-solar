/** Shared, PII-free purchase fields. Originals and the ledger are private server files. */
export type ReceiptProject = "fiji" | "polowat";
export type ReceiptLine = { bomId: string; description: string; asin: string; quantity: number; unitPrice: number; disposition: string; returnedQuantity?: number };
export type ReceiptReview = {
  kind: "purchase" | "existing" | "refund" | "quote" | "payment";
  vendor: string; orderNumber: string; date: string; currency: "USD" | "FJD";
  usdPerCurrency: number; shipping: number; tax: number; discount: number; total: number;
  linkedReceiptId: string; notes: string; lines: ReceiptLine[];
};
export type ReceiptRecord = {
  id: string; originalName: string; extension: string; bytes: number; uploadedAt: string;
  revision: number; review: ReceiptReview | null;
  history: Array<{ at: string; review: ReceiptReview }>;
};
export type ReceiptLedger = { version: 1; project: ReceiptProject; records: ReceiptRecord[] };
export const receiptCents = (value: number) => Math.round((value + Number.EPSILON) * 100);
export function receiptNetUsd(review: ReceiptReview) {
  return ["purchase", "refund"].includes(review.kind)
    ? receiptCents(review.total * review.usdPerCurrency) / 100 * (review.kind === "refund" ? -1 : 1) : 0;
}
export function receiptSummary(records: ReceiptRecord[]) {
  return {
    pending: records.filter(record => !record.review).length,
    reviewed: records.filter(record => record.review).length,
    netUsd: records.reduce((sum, record) => sum + (record.review ? receiptCents(receiptNetUsd(record.review)) : 0), 0) / 100,
  };
}
export function receiptBomPurchases(records: ReceiptRecord[]) {
  const result: Record<string, { quantity: number; itemCostUsd: number }> = {};
  for (const record of records) {
    const r = record.review;
    if (!r || !["purchase", "refund"].includes(r.kind)) continue;
    // Existing purchases already live in the canonical ledger, outside this quantity overlay.
    if (r.kind === "refund" && records.find(other => other.id === r.linkedReceiptId)?.review?.kind !== "purchase") continue;
    const sign = r.kind === "refund" ? -1 : 1;
    for (const line of r.lines) {
      if (!line.bomId) continue;
      const tally = result[line.bomId] ??= { quantity: 0, itemCostUsd: 0 };
      tally.quantity += r.kind === "refund" ? -(line.returnedQuantity ?? 0) : line.quantity;
      tally.itemCostUsd = (receiptCents(tally.itemCostUsd) + sign * receiptCents(line.quantity * line.unitPrice * r.usdPerCurrency)) / 100;
    }
  }
  return result;
}
export function validateReceiptReview(input: unknown, bomIds: Set<string>): ReceiptReview {
  const fail = (message: string): never => { throw new Error(message); };
  if (!input || typeof input !== "object") fail("A receipt review is required.");
  const r = input as Record<string, unknown>;
  function string(value: unknown, label: string, max = 250, required = false) {
    if (typeof value !== "string" || value.length > max || [...value].some(char => char.charCodeAt(0) < 32)) fail(`${label} is invalid.`);
    const result = (value as string).trim();
    if (required && !result) fail(`${label} is required.`);
    return result;
  }
  function money(value: unknown, label: string) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000_000 || Math.abs(value * 100 - receiptCents(value)) > .0001) fail(`${label} must be a nonnegative amount with at most two decimal places.`);
    return value as number;
  }
  const kind = r.kind as ReceiptReview["kind"];
  if (!["purchase", "existing", "refund", "quote", "payment"].includes(kind)) fail("Choose a document type.");
  const date = string(r.date, "Date", 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail("Use a valid receipt date.");
  const currency = r.currency as ReceiptReview["currency"];
  if (!["USD", "FJD"].includes(currency)) fail("Currency must be USD or FJD.");
  const rate = r.usdPerCurrency;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > 100 || (currency === "USD" && rate !== 1)) fail("Enter the documented USD conversion rate (1 for USD).");
  if (!Array.isArray(r.lines) || !r.lines.length || r.lines.length > 100) fail("Add 1–100 receipt lines.");
  const lines = (r.lines as Record<string, unknown>[]).map((line): ReceiptLine => {
    if (!line || typeof line !== "object") fail("Invalid receipt line.");
    const bomId = string(line.bomId, "BOM item", 150);
    if (bomId && !bomIds.has(bomId)) fail("A selected BOM item does not belong to this project.");
    const disposition = string(line.disposition, "Disposition", 250, true);
    if (!bomId && !/outside scope|unallocated/i.test(disposition)) fail("Match each line to a BOM item, or mark its disposition as outside scope / unallocated.");
    const quantity = line.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) fail("Each quantity must be positive.");
    const returnedQuantity = line.returnedQuantity ?? 0;
    if (typeof returnedQuantity !== "number" || !Number.isFinite(returnedQuantity) || returnedQuantity < 0 || returnedQuantity > (quantity as number) || (kind !== "refund" && returnedQuantity !== 0)) fail("Returned quantity must be between zero and the refund line quantity; other document types must use zero.");
    const asin = string(line.asin, "ASIN", 10);
    if (asin && !/^[A-Z0-9]{10}$/.test(asin)) fail("ASINs must have 10 uppercase letters or digits.");
    return { bomId, disposition, asin, quantity: quantity as number, returnedQuantity: returnedQuantity as number, description: string(line.description, "Description", 500, true), unitPrice: money(line.unitPrice, "Unit price") };
  });
  const shipping = money(r.shipping, "Shipping"), tax = money(r.tax, "Tax"), discount = money(r.discount, "Discount"), total = money(r.total, "Total");
  const calculated = lines.reduce((sum, line) => sum + receiptCents(line.unitPrice * line.quantity), 0) + receiptCents(shipping) + receiptCents(tax) - receiptCents(discount);
  if (calculated !== receiptCents(total)) fail(`Receipt arithmetic does not balance: lines + shipping + tax − discount = ${(calculated / 100).toFixed(2)}, receipt total = ${total.toFixed(2)}.`);
  return { kind, date, currency, usdPerCurrency: rate as number, lines, shipping, tax, discount, total,
    vendor: string(r.vendor, "Vendor", 150, true), orderNumber: string(r.orderNumber, "Order / receipt number", 150, true),
    linkedReceiptId: string(r.linkedReceiptId, "Linked receipt", 64), notes: string(r.notes, "Notes", 2000) };
}
