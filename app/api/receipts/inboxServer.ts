import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { receiptCents, receiptNetUsd, validateReceiptReview, type ReceiptLedger, type ReceiptProject, type ReceiptRecord } from "../../receiptLedger";
import fiji from "../../../data/dse-system.json" with { type: "json" };
import polowat from "../../../data/polowat-system.json" with { type: "json" };
import { createStoredZip } from "./receiptServer";

export const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;
const idPattern = /^[a-f0-9]{64}$/;
export function receiptProject(value: unknown): ReceiptProject {
  if (value !== "fiji" && value !== "polowat") throw new Error("Unknown receipt project.");
  return value;
}
function directory(parent: string, name: string) {
  const target = path.join(parent, name);
  try { fs.mkdirSync(target, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isDirectory()) throw new Error("Receipt storage must use real directories.");
  return target;
}
function rootFor(project: ReceiptProject, privateRoot = path.resolve(process.cwd(), "private")) {
  receiptProject(project);
  const base = directory(path.dirname(privateRoot), path.basename(privateRoot));
  const root = directory(directory(base, "receipts"), project);
  directory(root, "to-process");
  return root;
}
function readFile(filename: string) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("Receipt storage entry must be a regular file.");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function atomicJson(filename: string, value: unknown) {
  const temp = `${filename}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, filename);
}
function readLedger(root: string, project: ReceiptProject): ReceiptLedger {
  try {
    const ledger = JSON.parse(readFile(path.join(root, "ledger.json")).toString("utf8")) as ReceiptLedger;
    if (ledger.version !== 1 || ledger.project !== project || !Array.isArray(ledger.records)) throw new Error("Invalid receipt ledger.");
    return ledger;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, project, records: [] };
    throw error;
  }
}
/** Cross-process lock: both local production ports share this folder. */
async function locked<T>(root: string, action: () => T): Promise<T> {
  const filename = path.join(root, ".ledger.lock");
  for (let attempt = 0; attempt < 100; attempt++) {
    let fd: number;
    try { fd = fs.openSync(filename, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await delay(25); continue;
    }
    try { return action(); }
    finally { fs.closeSync(fd); fs.unlinkSync(filename); }
  }
  throw new Error("Receipt storage is busy. Retry shortly; a stale .ledger.lock needs local recovery after a server crash.");
}
export function loadInbox(project: ReceiptProject, privateRoot?: string) {
  return readLedger(rootFor(project, privateRoot), project);
}
function extensionFor(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpg";
  throw new Error("Use a PDF, PNG, or JPEG receipt.");
}
export async function addReceipt(project: ReceiptProject, originalName: string, bytes: Buffer, privateRoot?: string) {
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) throw new Error("Receipts must be between 1 byte and 20 MB.");
  const extension = extensionFor(bytes), id = createHash("sha256").update(bytes).digest("hex");
  const root = rootFor(project, privateRoot);
  return locked(root, () => {
    const ledger = readLedger(root, project), existing = ledger.records.find(record => record.id === id);
    if (existing) return { record: existing, duplicate: true };
    // Keep originals immutable and content-addressed; filenames never become paths.
    const filename = path.join(root, "to-process", `${id}.${extension}`);
    try { fs.writeFileSync(filename, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !readFile(filename).equals(bytes)) throw error;
    }
    const record: ReceiptRecord = { id, extension, bytes: bytes.length,
      originalName: [...originalName.replace(/\\/g, "/").split("/").at(-1)!].filter(char => char.charCodeAt(0) >= 32).join("").slice(0, 200) || `receipt.${extension}`,
      uploadedAt: new Date().toISOString(), revision: 0, review: null, history: [] };
    ledger.records.push(record);
    atomicJson(path.join(root, "ledger.json"), ledger);
    return { record, duplicate: false };
  });
}
function originalAt(root: string, record: ReceiptRecord) {
  if (!idPattern.test(record.id) || !["pdf", "png", "jpg"].includes(record.extension)) throw new Error("Invalid receipt identifier.");
  // A crash between committing the ledger and archival move is recoverable.
  const archived = path.join(root, `${record.id}.${record.extension}`);
  return fs.existsSync(archived) ? archived : path.join(root, "to-process", `${record.id}.${record.extension}`);
}
export function loadOriginal(project: ReceiptProject, id: string, privateRoot?: string) {
  const root = rootFor(project, privateRoot), record = readLedger(root, project).records.find(record => record.id === id);
  if (!record) throw new Error("Receipt not found.");
  return { record, bytes: readFile(originalAt(root, record)) };
}
export async function reviewReceipt(project: ReceiptProject, id: string, revision: number, input: unknown, privateRoot?: string) {
  const root = rootFor(project, privateRoot);
  const bom = project === "fiji" ? fiji.bom : polowat.bom;
  const review = validateReceiptReview(input, new Set(bom.map(item => item.id)));
  return locked(root, () => {
    const ledger = readLedger(root, project), record = ledger.records.find(record => record.id === id);
    if (!record) throw new Error("Receipt not found.");
    if (record.revision !== revision) throw new Error("This receipt changed in another window. Reload before editing.");
    if (["purchase", "existing"].includes(review.kind) && ledger.records.some(other => other.id !== id && other.review && ["purchase", "existing"].includes(other.review.kind)
      && other.review.vendor.toLowerCase() === review.vendor.toLowerCase() && other.review.orderNumber.toLowerCase() === review.orderNumber.toLowerCase())) {
      throw new Error("This vendor/order is already reconciled. Use payment evidence linked to that receipt; do not count the order twice.");
    }
    const linked = ledger.records.find(other => other.id === review.linkedReceiptId && other.id !== id);
    if (["refund", "payment"].includes(review.kind) && (!linked?.review || !["purchase", "existing"].includes(linked.review.kind))) throw new Error("Link this document to a reviewed purchase receipt.");
    if (review.kind === "refund") {
      const prior = ledger.records.filter(other => other.id !== id && other.review?.kind === "refund" && other.review.linkedReceiptId === review.linkedReceiptId)
        .reduce((sum, other) => sum + Math.abs(receiptCents(receiptNetUsd(other.review!))), 0);
      if (prior + Math.abs(receiptCents(receiptNetUsd(review))) > receiptCents(linked!.review!.total * linked!.review!.usdPerCurrency)) throw new Error("Refunds exceed the linked purchase total.");
    }
    // Existing Fiji costs stay authoritative; uploads can attach evidence without duplicating them.
    if (project === "fiji" && review.kind === "purchase" && review.lines.some(line => {
      const row = fiji.bom.find(item => item.id === line.bomId);
      return row && /Purchased|Deposit paid/.test(row.procurement);
    })) throw new Error("This Fiji BOM item is already accounted for. Choose evidence for an existing purchase, or an unallocated new purchase with an explanatory note.");
    const dependents = ledger.records.filter(other => other.review?.linkedReceiptId === id);
    if (dependents.length && (!["purchase", "existing"].includes(review.kind) || dependents.filter(other => other.review?.kind === "refund").reduce((sum, other) => sum + Math.abs(receiptCents(receiptNetUsd(other.review!))), 0) > receiptCents(review.total * review.usdPerCurrency))) throw new Error("This edit would invalidate linked refunds or payment evidence.");
    // Check the proposed ledger, including corrections to a purchase after a return.
    const proposed = ledger.records.map(other => other.id === id ? { ...other, review } : other);
    for (const purchase of proposed.filter(other => other.review && ["purchase", "existing"].includes(other.review.kind))) {
      const quantities = new Map<string, number>();
      for (const line of purchase.review!.lines) if (line.bomId) quantities.set(line.bomId, (quantities.get(line.bomId) ?? 0) + line.quantity);
      for (const refund of proposed.filter(other => other.review?.kind === "refund" && other.review.linkedReceiptId === purchase.id)) {
        for (const line of refund.review!.lines) if (line.bomId) quantities.set(line.bomId, (quantities.get(line.bomId) ?? 0) - (line.returnedQuantity ?? 0));
      }
      if ([...quantities.values()].some(quantity => quantity < -1e-9)) throw new Error("Returned BOM quantities exceed the linked purchase quantities.");
    }
    const original = originalAt(root, record);
    readFile(original); // Do not record a reconciled purchase without its evidence.
    record.review = review;
    record.revision++;
    record.history.push({ at: new Date().toISOString(), review });
    atomicJson(path.join(root, "ledger.json"), ledger);
    fs.renameSync(original, path.join(root, `${id}.${record.extension}`));
    return record;
  });
}
export function purchaseCsv(ledger: ReceiptLedger) {
  const rows: (string | number)[][] = [["Project", "Receipt SHA256", "Document", "Date", "Vendor", "Order", "Currency", "USD per currency", "BOM ID", "Description", "ASIN", "Quantity", "Quantity returned", "Unit price", "Line subtotal", "Disposition", "Shipping", "Tax", "Discount", "Receipt total", "New net spend USD", "Linked receipt", "Notes"]];
  for (const record of ledger.records) {
    const r = record.review;
    if (!r) continue;
    r.lines.forEach((line, index) => rows.push([ledger.project, record.id, r.kind, r.date, r.vendor, r.orderNumber, r.currency, r.usdPerCurrency, line.bomId, line.description, line.asin, line.quantity, line.returnedQuantity ?? 0, line.unitPrice, receiptCents(line.quantity * line.unitPrice) / 100, line.disposition,
      ...(index === 0 ? [r.shipping, r.tax, r.discount, r.total, receiptNetUsd(r), r.linkedReceiptId, r.notes] : ["", "", "", "", "", "", ""])]));
  }
  return rows.map(row => row.map(value => {
    const text = String(value);
    return `"${(typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}
export function inboxArchive(project: ReceiptProject, privateRoot?: string) {
  const root = rootFor(project, privateRoot), ledger = readLedger(root, project), now = new Date();
  return createStoredZip([
    { name: "purchase-ledger.csv", data: Buffer.from(purchaseCsv(ledger)), modified: now },
    { name: "ledger.json", data: Buffer.from(JSON.stringify(ledger, null, 2)), modified: now },
    ...ledger.records.map(record => ({ name: `${record.review ? "receipts" : "pending"}/${record.id}.${record.extension}`, data: readFile(originalAt(root, record)), modified: new Date(record.uploadedAt) })),
  ]);
}
