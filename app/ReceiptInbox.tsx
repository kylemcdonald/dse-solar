"use client";
import { useEffect, useRef, useState } from "react";
import { receiptCents, receiptSummary, type ReceiptLedger, type ReceiptLine, type ReceiptProject, type ReceiptRecord, type ReceiptReview } from "./receiptLedger";
type BomChoice = { id: string; item: string; productUrl?: string };
const newLine = (): ReceiptLine => ({ bomId: "", description: "", asin: "", quantity: 1, unitPrice: 0, disposition: "Unallocated — needs BOM matching" });
const blankReview = (): ReceiptReview => ({ kind: "purchase", vendor: "", orderNumber: "", date: "", currency: "USD", usdPerCurrency: 1, shipping: 0, tax: 0, discount: 0, total: 0, linkedReceiptId: "", notes: "", lines: [newLine()] });
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
async function readResponse(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Receipt request failed.");
  return result;
}

function ReceiptEditor({ record, records, bom, saving, onSave, onCancel }: {
  record: ReceiptRecord; records: ReceiptRecord[]; bom: BomChoice[]; saving: boolean;
  onSave: (review: ReceiptReview) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ReceiptReview>(() => record.review ? structuredClone(record.review) : blankReview());
  const update = <K extends keyof ReceiptReview>(key: K, value: ReceiptReview[K]) => setDraft(current => ({ ...current, [key]: value }));
  const lineUpdate = (index: number, value: Partial<ReceiptLine>) => setDraft(current => ({ ...current, lines: current.lines.map((line, i) => i === index ? { ...line, ...value } : line) }));
  const calculated = (draft.lines.reduce((sum, line) => sum + receiptCents(line.quantity * line.unitPrice), 0) + receiptCents(draft.shipping) + receiptCents(draft.tax) - receiptCents(draft.discount)) / 100;
  return <form className="receipt-editor" onSubmit={event => { event.preventDefault(); onSave(draft); }}>
    <h3>Reconcile {record.originalName}</h3>
    <p>Check the original, enter every line, and match purchases to BOM items. Keep addresses, card details and account information out of these fields. Quotes and payment evidence do not add a second expense.</p>
    <div className="receipt-fields">
      <label>Document type<select value={draft.kind} onChange={event => {
        const kind = event.target.value as ReceiptReview["kind"];
        setDraft(current => ({ ...current, kind, lines: current.lines.map(line => ({ ...line, returnedQuantity: kind === "refund" ? line.returnedQuantity ?? 0 : 0 })) }));
      }}>
        <option value="purchase">New purchase</option><option value="existing">Evidence for existing purchase</option><option value="refund">Refund / credit</option><option value="quote">Quote — no purchase yet</option><option value="payment">Payment evidence for recorded purchase</option>
      </select></label>
      <label>Vendor<input required value={draft.vendor} maxLength={150} onChange={event => update("vendor", event.target.value)} /></label>
      <label>Order / receipt number<input required value={draft.orderNumber} maxLength={150} onChange={event => update("orderNumber", event.target.value)} /></label>
      <label>Receipt date<input required type="date" value={draft.date} onChange={event => update("date", event.target.value)} /></label>
      <label>Currency<select value={draft.currency} onChange={event => { update("currency", event.target.value as "USD" | "FJD"); if (event.target.value === "USD") update("usdPerCurrency", 1); }}><option>USD</option><option>FJD</option></select></label>
      {draft.currency === "FJD" && <label>USD per FJD<input required type="number" min="0.000001" step="any" value={draft.usdPerCurrency} onChange={event => update("usdPerCurrency", Number(event.target.value))} /></label>}
      {["refund", "payment"].includes(draft.kind) && <label>Linked purchase<select required value={draft.linkedReceiptId} onChange={event => update("linkedReceiptId", event.target.value)}><option value="">Choose a purchase</option>{records.filter(other => other.id !== record.id && other.review && ["purchase", "existing"].includes(other.review.kind)).map(other => <option key={other.id} value={other.id}>{other.review!.vendor} · {other.review!.orderNumber}</option>)}</select></label>}
    </div>
    {draft.lines.map((line, index) => <fieldset className="receipt-line" key={index}>
      <legend>Receipt line {index + 1}</legend><div className="receipt-fields">
        <label>BOM item<select value={line.bomId} onChange={event => {
          const item = bom.find(item => item.id === event.target.value);
          lineUpdate(index, { bomId: event.target.value, ...(item ? { description: line.description || item.item, asin: line.asin || item.productUrl?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] || "", disposition: "For system — installation not yet confirmed" } : { disposition: "Unallocated — needs BOM matching" }) });
        }}><option value="">Unallocated / outside scope</option>{bom.map(item => <option key={item.id} value={item.id}>{item.item}</option>)}</select></label>
        <label>Description<input required value={line.description} maxLength={500} onChange={event => lineUpdate(index, { description: event.target.value })} /></label>
        <label>ASIN (optional)<input value={line.asin} maxLength={10} onChange={event => lineUpdate(index, { asin: event.target.value.toUpperCase() })} /></label>
        <label>Quantity<input required type="number" min="0.001" step="any" value={line.quantity} onChange={event => lineUpdate(index, { quantity: Number(event.target.value) })} /></label>
        {draft.kind === "refund" && <label>Quantity returned (0 for price credit)<input required type="number" min="0" step="any" max={line.quantity} value={line.returnedQuantity ?? 0} onChange={event => lineUpdate(index, { returnedQuantity: Number(event.target.value) })} /></label>}
        <label>Unit price<input required type="number" min="0" step="0.01" value={line.unitPrice} onChange={event => lineUpdate(index, { unitPrice: Number(event.target.value) })} /></label>
        <label>Disposition / purchase note<input required value={line.disposition} maxLength={250} onChange={event => lineUpdate(index, { disposition: event.target.value })} /></label>
      </div>{draft.lines.length > 1 && <button type="button" disabled={saving} onClick={() => update("lines", draft.lines.filter((_, i) => i !== index))}>Remove line {index + 1}</button>}
    </fieldset>)}
    <button type="button" disabled={saving || draft.lines.length >= 100} onClick={() => update("lines", [...draft.lines, newLine()])}>Add receipt line</button>
    <div className="receipt-fields receipt-totals">
      {(["shipping", "tax", "discount", "total"] as const).map(key => <label key={key}>{key === "total" ? "Receipt grand total" : key[0].toUpperCase() + key.slice(1)}<input required type="number" min="0" step="0.01" value={draft[key]} onChange={event => update(key, Number(event.target.value))} /></label>)}
    </div>
    <p aria-live="polite">Calculated total: {draft.currency} {calculated.toFixed(2)} · {receiptCents(calculated) === receiptCents(draft.total) ? "Totals balance" : "Totals need correction"}</p>
    <label className="receipt-notes">Purchase / grant notes<input value={draft.notes} maxLength={2000} onChange={event => update("notes", event.target.value)} placeholder="Purpose, funding, ETA, returns, or corrections" /></label>
    <div className="receipt-actions"><button disabled={saving} type="submit">{saving ? "Saving…" : "Save reconciliation"}</button><button disabled={saving} type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

export function ReceiptInbox({ project, bom, onRecords }: { project: ReceiptProject; bom: BomChoice[]; onRecords: (records: ReceiptRecord[]) => void }) {
  const [ledger, setLedger] = useState<ReceiptLedger | null>(null);
  const [privateMode, setPrivateMode] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const endpoint = `/api/receipts/inbox?project=${project}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/receipts/status", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const status = await response.json();
      if (!status.privateMode) return;
      setPrivateMode(true);
      const next = await readResponse(await fetch(endpoint, { cache: "no-store", signal: controller.signal }));
      setLedger(next); onRecords(next.records);
    }).catch(error => { if (error.name !== "AbortError") setError("Receipt records could not be loaded. Refresh to retry."); });
    return () => controller.abort();
  }, [endpoint, onRecords]);
  if (!privateMode) return null;
  const records = ledger?.records ?? [], summary = receiptSummary(records);
  const record = records.find(record => record.id === editing);
  async function upload(files: File[]) {
    if (busy || !files.length) return;
    setBusy(true); setError(""); setMessage("");
    const errors: string[] = []; let added = 0, duplicates = 0;
    for (const file of files) {
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error("Exceeds 20 MB.");
        const data = new FormData(); data.append("file", file);
        const result = await readResponse(await fetch(endpoint, { method: "POST", headers: { "X-Receipt-Request": "1" }, body: data }));
        if (result.duplicate) duplicates++; else added++;
      } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : "Upload failed."}`); }
    }
    try { const next = await readResponse(await fetch(endpoint, { cache: "no-store" })); setLedger(next); onRecords(next.records); }
    catch { errors.push("Reload to retrieve the saved receipt list."); }
    setError(errors.join(" ")); setMessage(`${added} receipt${added === 1 ? "" : "s"} saved for review${duplicates ? `; ${duplicates} duplicate${duplicates === 1 ? "" : "s"} already tracked` : ""}.`);
    setBusy(false); if (input.current) input.current.value = "";
  }
  async function save(review: ReceiptReview) {
    if (!record || busy) return;
    setBusy(true); setError("");
    try {
      const saved = await readResponse(await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Receipt-Request": "1" }, body: JSON.stringify({ id: record.id, revision: record.revision, review }) }));
      const nextRecords = records.map(item => item.id === saved.id ? saved : item);
      setLedger(current => current && ({ ...current, records: nextRecords })); onRecords(nextRecords);
      setEditing(null); setMessage("Reconciliation saved. The original, purchase notes and correction history are retained.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save reconciliation."); }
    finally { setBusy(false); }
  }
  return <aside className="receipt-inbox" aria-label="Private receipt tracking">
    <div className={`receipt-drop${dragging ? " dragging" : ""}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); void upload(Array.from(event.dataTransfer.files)); }}>
      <div><p className="eyebrow">Private · {project === "fiji" ? "Fiji" : "Polowat"} purchase records</p><h2>Drop receipts here</h2><p>PDF, PNG or JPEG · up to 20 MB each. Originals are copied to this project’s private receipt folder. Review and match them below to record purchases for the grant report.</p></div>
      <button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Saving receipts…" : "Choose receipts"}</button>
      <input ref={input} type="file" multiple accept="application/pdf,image/png,image/jpeg" aria-label="Upload receipts" hidden onChange={event => void upload(Array.from(event.target.files ?? []))} />
    </div>
    {error && <p role="alert" className="receipt-error">{error}</p>}{message && <p role="status">{message}</p>}
    {ledger && <div className="receipt-actions"><span>{summary.pending} awaiting review · {summary.reviewed} reviewed · {money(summary.netUsd)} new net spend</span></div>}
    {records.length > 0 && <details open={summary.pending > 0 || Boolean(record)}><summary>Purchase reconciliation ({records.length} receipts)</summary>
      <p>Reviewed receipt totals are actual expenses; the equipment estimate below remains a procurement plan. Existing purchases, quotes and duplicate payment evidence add no new spend. Unallocated lines stay visible for later matching.</p>
      <ul className="receipt-records">{records.toReversed().map(item => <li key={item.id}><div><strong>{item.originalName}</strong><small>{item.review ? `${item.review.vendor} · ${item.review.date} · ${item.review.currency} ${item.review.total.toFixed(2)} · ${item.review.kind}${item.review.lines.some(line => !line.bomId) ? " · unmatched lines" : ""}` : "Saved · awaiting reconciliation"}</small></div><button type="button" disabled={busy} onClick={() => { setEditing(item.id); setError(""); }}>{item.review ? "Edit reconciliation" : "Review receipt"}</button></li>)}</ul>
      {record && <ReceiptEditor key={`${record.id}-${record.revision}`} record={record} records={records} bom={bom} saving={busy} onSave={review => void save(review)} onCancel={() => setEditing(null)} />}
    </details>}
  </aside>;
}
