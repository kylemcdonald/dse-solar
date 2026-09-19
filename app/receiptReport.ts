import { receiptCents, receiptSummary, type ReceiptLedger } from "./receiptLedger";
import { createGrantReportCsv, createGrantReportPdf, type GrantReportLine, type ReceiptPurchaseReport } from "./grantReport";

const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
const rounded = (amount: number) => receiptCents(amount) / 100;

/** Adapt actual private receipts to the same purchase-ledger layout used by Fiji. */
export function buildReceiptPurchaseReport(ledger: ReceiptLedger, generatedDate = new Date().toISOString().slice(0, 10)): ReceiptPurchaseReport {
  const summary = receiptSummary(ledger.records);
  const sections: ReceiptPurchaseReport["sections"] = [];
  const evidenceNotes: string[] = [];
  let goods = 0, shipping = 0, tax = 0, discounts = 0, refunds = 0;
  ledger.records.forEach((record, index) => {
    const r = record.review;
    if (!r) return;
    const number = index + 1;
    const spending = r.kind === "purchase" || r.kind === "refund";
    const sign = r.kind === "refund" ? -1 : 1;
    const evidence = [{ number, supplier: r.vendor, kind: r.kind, reference: r.orderNumber }];
    const lines: GrantReportLine[] = [];
    const add = (id: string, item: string, qty: number, unit: string, amount: number, note = "") => {
      const sourceAmount = rounded(sign * amount);
      lines.push({
        id, item, qty, unit, sourceCurrency: r.currency, sourceAmount,
        costUsd: spending ? rounded(sourceAmount * r.usdPerCurrency) : 0,
        receiptRefs: [number], evidence, scope: "solar-system", allocations: [], note,
      });
    };
    r.lines.forEach((line, i) => add(`${record.id}-${i}`, line.description, line.quantity, "each",
      rounded(line.quantity * line.unitPrice),
      [line.bomId ? `BOM: ${line.bomId}` : "Unallocated", line.asin ? `ASIN: ${line.asin}` : "",
        line.disposition, line.returnedQuantity ? `Returned quantity: ${line.returnedQuantity}` : ""].filter(Boolean).join("; ")));
    for (const [label, amount] of [["Shipping", r.shipping], ["Tax", r.tax], ["Discount", -r.discount]] as const) {
      if (amount) add(`${record.id}-${label}`, label, 1, "order", amount);
    }
    // Reconcile independently rounded USD rows to the converted document total.
    const net = spending ? rounded(sign * r.total * r.usdPerCurrency) : 0;
    const difference = rounded(net - lines.reduce((sum, line) => sum + line.costUsd, 0));
    if (difference) lines.push({
      id: `${record.id}-rounding`, item: "Currency rounding", qty: 1, unit: "order",
      sourceCurrency: "USD", sourceAmount: difference, costUsd: difference,
      receiptRefs: [number], evidence, scope: "solar-system", allocations: [],
    });
    sections.push({ id: "solar", title: `#${number} ${r.vendor} - ${r.date} (${r.kind})`, lines, subtotalUsd: net });
    evidenceNotes.push(`#${number} ${r.vendor} | ${r.date} | ${r.kind} | Order ${r.orderNumber}. Original: receipts/${record.id}.${record.extension}`);
    if (r.notes) evidenceNotes.push(`#${number} Notes: ${r.notes}`);
    if (r.linkedReceiptId) evidenceNotes.push(`#${number} Linked receipt: ${r.linkedReceiptId}`);
    if (!spending) evidenceNotes.push(`#${number} Supporting evidence only; no new expense counted. Document total: ${r.currency} ${r.total.toFixed(2)}.`);
    if (r.kind === "purchase") {
      goods += net - rounded(r.shipping * r.usdPerCurrency) - rounded(r.tax * r.usdPerCurrency) + rounded(r.discount * r.usdPerCurrency);
      shipping += rounded(r.shipping * r.usdPerCurrency);
      tax += rounded(r.tax * r.usdPerCurrency);
      discounts += rounded(r.discount * r.usdPerCurrency);
    } else if (r.kind === "refund") refunds += -net;
  });
  return {
    title: `${ledger.project === "polowat" ? "Polowat" : "Fiji"} Purchase Report`,
    generatedDate,
    generatedDateLabel: new Date(`${generatedDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    explanation: "Reviewed receipt amounts only; purchases less recorded refunds. Quotes, existing expenses and payment evidence add no new spend. Order confirmation is not proof of bank settlement.",
    sections, grandTotalUsd: summary.netUsd,
    presentation: {
      cards: [["PURCHASES", money(rounded(goods + shipping + tax - discounts))], ["RECORDED REFUNDS", money(rounded(refunds))], ["NET EXPENSES", money(summary.netUsd)]],
      source: { label: "REVIEWED RECEIPT RECORDS", value: `${summary.reviewed} reviewed`, detail: `Pending: ${summary.pending}`, note: "Funding source / advance not recorded" },
      summaryTitle: "EXPENSE RECONCILIATION",
      summaryRows: [["Purchased items", rounded(goods)], ["Shipping", rounded(shipping)], ["Tax", rounded(tax)], ["Discounts / promotions", -rounded(discounts)], ["Recorded refunds", -rounded(refunds)]],
      evidenceNotes,
    },
  };
}

export const createReceiptReportCsv = (ledger: ReceiptLedger) => createGrantReportCsv(buildReceiptPurchaseReport(ledger));
export const createReceiptReportPdf = (ledger: ReceiptLedger) => createGrantReportPdf(buildReceiptPurchaseReport(ledger));
