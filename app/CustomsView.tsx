"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import customsRaw from "@/data/dse-customs.json";
import receiptsRaw from "@/data/dse-receipts.json";

export type CustomsBomItem = {
  id: string; category: string; item: string; qty: number; unit: string; unitCost: number;
  currency: "USD" | "FJD"; totalUsd: number; location: string; procurement: string;
  totalWeightKg?: number; productUrl?: string;
};
type ItemMeta = {
  defaultCondition?: string; make: string; model: string; additionalInfo?: string; origin: string;
  originBasis?: string; originSourceUrl?: string; originNote?: string; originReviewedOn?: string;
  serialRequired: boolean; defaultSerials?: string; tafPermitRequired?: boolean;
  excludedFromManifest?: boolean; exclusionReason?: string;
};
type CustomsData = {
  checkedOn: string; manifestTitle: string; declaredPurpose: string; defaultConsignee: string;
  defaultConsigneeTin: string; defaultBusinessRegistrationNumber: string; defaultTraveler: string;
  defaultFlight: string; defaultArrivalDate: string; defaultDestination: string; departureDate: string; vatRate: number;
  miscGrouping: { label: string; maximumLineUsd: number; explanation: string };
  itemMeta: Record<string, ItemMeta>;
  sources: Array<{ id: string; title: string; publisher: string; url: string }>;
};
type ReceiptData = {
  invoices: Array<{ number: number; date: string; filename: string; supplier: string }>;
  itemInvoices: Record<string, number[]>; itemAsins: Record<string, string[]>;
  purchasedWithoutReceipt: string[];
};
type ManifestEdit = { qty: string; unitCost: string; origin: string; condition: string; serials: string };
type HeaderFields = {
  consignee: string; tin: string; businessRegistrationNumber: string; traveler: string; flight: string; arrivalDate: string;
  destination: string;
  purpose: string; fjdPerUsd: string; supplierFreight: string; internationalFreight: string; insurance: string;
};
type PrintMode = "full" | "taf";
export type CustomsLine = {
  id: string; make: string; model: string; additionalInfo: string; qty: number; unit: string; unitCost: number; lineTotal: number;
  origin: string; asins: string[]; invoiceRefs: number[]; serialRequired: boolean; tafPermitRequired: boolean;
  serials: string; receiptMissing: boolean; groupedItemIds?: string[];
};

const customs = customsRaw as CustomsData;
const receipts = receiptsRaw as ReceiptData;
const valueOf = (input: string) => Number.isFinite(Number.parseFloat(input)) ? Number.parseFloat(input) : 0;
const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const fjd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "FJD" }).format(value);
export function unitCostInput(item: Pick<CustomsBomItem, "qty" | "totalUsd">) {
  const value = item.totalUsd / item.qty;
  for (const decimals of [2, 3, 4]) {
    const encoded = value.toFixed(decimals);
    if (Math.abs(Number(encoded) * item.qty - item.totalUsd) < 0.000_001) return encoded;
  }
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
export const stripAsinFromDescription = (value: string) => value
  .replace(/\s*[·,;(-]*\s*(?:(?:ASIN|Amazon)\s+)?B[A-Z0-9]{9}(?![A-Z0-9])\)?/gi, "")
  .replace(/\s{2,}/g, " ")
  .trim();
const normalizedDescription = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
export const hasDistinctModel = (item: string, model: string) => Boolean(model) && normalizedDescription(item) !== normalizedDescription(model);

export function isCustomsManifestItem(item: CustomsBomItem, itemMeta = customs.itemMeta) {
  const meta = itemMeta[item.id];
  return item.location === "Import" && Number(item.totalWeightKg) > 0 && Boolean(meta) && !meta.excludedFromManifest;
}

export function sortCustomsItems(items: CustomsBomItem[], itemMeta = customs.itemMeta) {
  return [...items].sort((a, b) =>
    Number(Boolean(itemMeta[b.id]?.tafPermitRequired)) - Number(Boolean(itemMeta[a.id]?.tafPermitRequired)) ||
    a.item.localeCompare(b.item));
}

export function isMiscGroupingCandidate(edit: ManifestEdit) {
  const lineTotal = valueOf(edit.qty) * valueOf(edit.unitCost);
  return lineTotal < customs.miscGrouping.maximumLineUsd;
}

export function buildCustomsLines(items: CustomsBomItem[], edits: Record<string, ManifestEdit>, groupMiscellaneous: boolean): CustomsLine[] {
  const ordinary: CustomsLine[] = [];
  const grouped: CustomsLine[] = [];
  for (const item of sortCustomsItems(items)) {
    const edit = edits[item.id];
    const meta = customs.itemMeta[item.id];
    if (!edit || !meta || meta.excludedFromManifest) continue;
    const line: CustomsLine = {
      id: item.id,
      make: stripAsinFromDescription(meta.make),
      model: stripAsinFromDescription(meta.model),
      additionalInfo: stripAsinFromDescription(meta.additionalInfo ?? ""),
      qty: valueOf(edit.qty), unit: item.unit, unitCost: valueOf(edit.unitCost),
      lineTotal: valueOf(edit.qty) * valueOf(edit.unitCost), origin: edit.origin,
      asins: receipts.itemAsins[item.id] ?? [], invoiceRefs: receipts.itemInvoices[item.id] ?? [],
      serialRequired: meta.serialRequired, tafPermitRequired: Boolean(meta.tafPermitRequired), serials: edit.serials,
      receiptMissing: receipts.purchasedWithoutReceipt.includes(item.id),
    };
    if (groupMiscellaneous && isMiscGroupingCandidate(edit)) grouped.push(line);
    else ordinary.push(line);
  }
  if (grouped.length > 1) {
    const origins = [...new Set(grouped.map((line) => line.origin))];
    ordinary.push({
      id: "miscellaneous-electrical-accessories", make: customs.miscGrouping.label,
      model: grouped.map((line) => `${line.make} / ${line.model}`).join("; "), additionalInfo: "",
      qty: 1, unit: "lot", unitCost: grouped.reduce((sum, line) => sum + line.lineTotal, 0),
      lineTotal: grouped.reduce((sum, line) => sum + line.lineTotal, 0), origin: origins.length === 1 ? origins[0] : "Various",
      asins: [...new Set(grouped.flatMap((line) => line.asins))],
      invoiceRefs: [...new Set(grouped.flatMap((line) => line.invoiceRefs))].sort((a, b) => a - b),
      serialRequired: false, tafPermitRequired: false, serials: "",
      receiptMissing: grouped.some((line) => line.receiptMissing), groupedItemIds: grouped.map((line) => line.id),
    });
  } else ordinary.push(...grouped);
  return ordinary.sort((a, b) =>
    Number(Boolean(a.groupedItemIds)) - Number(Boolean(b.groupedItemIds)) ||
    Number(b.tafPermitRequired) - Number(a.tafPermitRequired) ||
    a.make.localeCompare(b.make) || a.model.localeCompare(b.model));
}

export function customsLineDescription(line: CustomsLine) {
  if (line.groupedItemIds) return `${line.make}\n${line.model}`;
  return `${line.make} / ${line.model}${line.additionalInfo ? `\n${line.additionalInfo}` : ""}`;
}

const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
const csvNumber = (value: number, maximumDecimals = 2) => value.toFixed(maximumDecimals).replace(/\.?0+$/, "");
export function buildCustomsCsv(lines: CustomsLine[], fjdPerUsd: number) {
  const headings = ["No.", "Make / model", "ASIN", "Qty", "Country of origin", "Unit value USD", "Total USD", "Total FJD", "Ref", "Serial number(s)"];
  const rows = lines.map((line, index) => [
    index + 1, customsLineDescription(line), line.asins.join(", ") || "—", `${csvNumber(line.qty, 6)} ${line.unit}`, line.origin || "N/A",
    csvNumber(line.unitCost, 6), csvNumber(line.lineTotal), csvNumber(line.lineTotal * fjdPerUsd),
    line.invoiceRefs.join(", ") || (line.receiptMissing ? "PDF not provided" : "—"), line.serials || "N/A",
  ]);
  return `${[headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function CustomsView({ bom, planningFjdPerUsd }: { bom: CustomsBomItem[]; planningFjdPerUsd: number }) {
  const viewRef = useRef<HTMLElement>(null);
  const manifestItems = useMemo(
    () => bom.filter((item) => isCustomsManifestItem(item)),
    [bom],
  );
  const tafPermitCount = manifestItems.filter((item) => customs.itemMeta[item.id].tafPermitRequired).length;
  const [groupMiscellaneous, setGroupMiscellaneous] = useState(false);
  const [privateMode, setPrivateMode] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/receipts/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ privateMode?: boolean }> : null)
      .then((status) => { if (active) setPrivateMode(Boolean(status?.privateMode)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const [fields, setFields] = useState<HeaderFields>(() => ({
    consignee: customs.defaultConsignee, tin: customs.defaultConsigneeTin,
    businessRegistrationNumber: customs.defaultBusinessRegistrationNumber, traveler: customs.defaultTraveler,
    flight: customs.defaultFlight, arrivalDate: customs.defaultArrivalDate, destination: customs.defaultDestination,
    purpose: customs.declaredPurpose, fjdPerUsd: planningFjdPerUsd.toFixed(2),
    supplierFreight: bom.find((item) => item.id === "dse-supplier-freight")?.totalUsd.toFixed(2) ?? "0.00",
    internationalFreight: bom.find((item) => item.id === "dse-baggage")?.totalUsd.toFixed(2) ?? "0.00", insurance: "0.00",
  }));
  const [edits, setEdits] = useState<Record<string, ManifestEdit>>(() => Object.fromEntries(manifestItems.map((item) => [item.id, {
    qty: String(item.qty), unitCost: unitCostInput(item),
    origin: customs.itemMeta[item.id].origin,
    condition: customs.itemMeta[item.id].defaultCondition ?? "New", serials: customs.itemMeta[item.id].defaultSerials ?? "",
  }])));
  const lines = useMemo(() => buildCustomsLines(manifestItems, edits, groupMiscellaneous), [manifestItems, edits, groupMiscellaneous]);
  const tafLines = lines.filter((line) => line.tafPermitRequired);
  const grossGoodsTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const tafGoodsTotal = tafLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const orderLevelDiscount = bom.find((item) => item.id === "dse-amazon-promotion")?.totalUsd ?? 0;
  const goodsTotal = grossGoodsTotal + orderLevelDiscount;
  const planningCif = goodsTotal + valueOf(fields.supplierFreight) + valueOf(fields.internationalFreight) + valueOf(fields.insurance);
  const fxRate = valueOf(fields.fjdPerUsd);
  const planningVatFloor = planningCif * customs.vatRate;
  const groupedLine = lines.find((line) => line.groupedItemIds);
  const visibleInvoiceRefs = new Set(lines.flatMap((line) => line.invoiceRefs));
  const tafInvoiceRefs = new Set(tafLines.flatMap((line) => line.invoiceRefs));
  const visibleInvoices = receipts.invoices.filter((invoice) => visibleInvoiceRefs.has(invoice.number));
  const updateField = (key: keyof HeaderFields, value: string) => setFields((current) => ({ ...current, [key]: value }));
  const updateEdit = (id: string, key: keyof ManifestEdit, value: string) => setEdits((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  const downloadCsv = () => {
    const url = URL.createObjectURL(new Blob([buildCustomsCsv(lines, fxRate)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "dse-fiji-customs-manifest.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const printManifest = (mode: PrintMode) => {
    const view = viewRef.current;
    if (!view) return;
    view.dataset.printMode = mode;
    window.addEventListener("afterprint", () => { view.dataset.printMode = "full"; }, { once: true });
    window.print();
  };

  return <section ref={viewRef} className="customs-view" aria-label="Fiji customs planning manifest" data-private-mode={privateMode ? "true" : "false"} data-print-mode="full">
    <div className="customs-screen-only">
      <div className="customs-heading"><div><span>Fiji arrival planning · researched {customs.checkedOn}</span><h1>Customs manifest</h1><p>Pre-clear project equipment and retain every numbered invoice referenced below.</p></div>
        <div className="customs-actions">
          <button type="button" className={`customs-secondary-button ${groupMiscellaneous ? "active" : ""}`} aria-pressed={groupMiscellaneous} onClick={() => setGroupMiscellaneous((value) => !value)}>Group low-cost accessories</button>
          {privateMode && <a className="customs-secondary-button" href="/api/receipts/download" download>Download receipts (.zip)</a>}
          <button type="button" className="customs-secondary-button" onClick={downloadCsv}>Export CSV</button>
          <button type="button" className="customs-print-button" onClick={() => printManifest("full")}>Print / save PDF</button>
          <button type="button" className="customs-print-button" onClick={() => printManifest("taf")}>Print / save TAF PDF</button>
        </div></div>
      <div className="customs-alert-grid">
        <article className="customs-alert customs-alert-urgent"><span>Clearance route</span><strong>Licensed agent before arrival</strong><p>FRCS says goods over FJ$1,000 require formal clearance.</p></article>
        <article className="customs-alert"><span>Planning goods value</span><strong>{usd(goodsTotal)}</strong><p>Use actual transaction values and preserve discounts.</p></article>
        <article className="customs-alert"><span>Planning CIF</span><strong>{usd(planningCif)}</strong><p>Goods, freight, and insurance; the agent controls the final basis.</p></article>
        <article className="customs-alert customs-alert-warn"><span>Telecom permit</span><strong>{tafPermitCount} radio models</strong><p>Radio items remain separate and appear first in the manifest.</p></article>
      </div>
      <div className="customs-guidance-grid">
        <article><div className="customs-card-number">01</div><h2>Before the flight</h2><ol><li>Confirm the Fiji consignee and TIN.</li><li>Engage a licensed Nadi customs agent.</li><li>Send the agent this manifest, all numbered invoices, travel details, and donation paperwork.</li><li>Apply to TAF for every flagged radio model.</li></ol></article>
        <article><div className="customs-card-number">02</div><h2>Carry on arrival</h2><ul><li>Signed manifest and a copy</li><li>Invoices and proof of payment</li><li>Donation and beneficiary letters</li><li>TAF permits and Customs Entry/SAD</li></ul><p className="customs-arrival-note">Declare the goods and present them at the Customs Secondary Checkpoint.</p></article>
        <article><div className="customs-card-number">03</div><h2>Relief is not automatic</h2><p>School use alone does not remove duty or VAT. Ask FRCS about Concession Code 215 only if the recipient meets the published requirements.</p></article>
        <article><div className="customs-card-number">04</div><h2>Planning valuation</h2><p>FRCS bases duty on CIF. Fiscal duty and import excise depend on the agent&apos;s HS classification.</p><dl className="customs-fee-preview"><div><dt>CIF in FJD</dt><dd>{fjd(planningCif * fxRate)}</dd></div><div><dt>VAT-only floor</dt><dd>{usd(planningVatFloor)}</dd></div></dl></article>
      </div>
      <section className="customs-sources"><div><span>Official references</span><h2>Fiji government guidance</h2></div><div className="customs-source-links">{customs.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><b>{source.title}</b><small>{source.publisher}</small><em>↗</em></a>)}</div></section>
    </div>

    <section className="customs-manifest-section">
      <div className="customs-manifest-title"><div><h2 className="customs-full-print-copy">{customs.manifestTitle}</h2><h2 className="customs-taf-print-only">{customs.manifestTitle} · TAF radio permit items</h2><p className="customs-full-print-copy">{groupMiscellaneous ? `${customs.miscGrouping.explanation} Optional presentation for broker review; confirm that FRCS accepts aggregation.` : "Detailed item-level declaration"}</p><p className="customs-taf-print-only">Only equipment flagged for a TAF radio permit is included.</p></div><button type="button" className="customs-print-button customs-screen-only" onClick={() => printManifest("full")}>Print / save PDF</button></div>
      <div className="customs-form-grid">
        {([ ["consignee", "Business name / Fiji consignee"], ["businessRegistrationNumber", "Business registration number"], ["tin", "TIN"], ["traveler", "Traveler / importer"], ["flight", "Flight number"], ["arrivalDate", "Arrival date in Fiji"], ["destination", "Final destination"] ] as Array<[keyof HeaderFields, string]>).map(([key, label]) => <label key={key}><span>{label}</span><input type={key === "arrivalDate" ? "date" : "text"} value={fields[key]} onChange={(event) => updateField(key, event.target.value)} /></label>)}
        <label className="customs-field-full customs-purpose-editor"><span>Purpose / end use</span><textarea value={fields.purpose} onChange={(event) => updateField("purpose", event.target.value)} rows={2} /></label>
        <div className="customs-purpose-print"><span>Purpose / end use</span><p>{fields.purpose || "N/A"}</p></div>
      </div>
      <div className="customs-table-wrap"><table className="customs-table">
        <thead><tr><th>No.</th><th>Make / model</th><th>ASIN</th><th>Qty</th><th>Country of origin</th><th>Unit value USD</th><th>Total USD</th><th className="customs-fjd-column">Total FJD</th><th>Ref</th><th className="customs-serial-column">Serial number(s)</th></tr></thead>
        <tbody>{lines.map((line, index) => { const meta = customs.itemMeta[line.id]; return <tr key={line.id} data-customs-id={line.id} data-taf={line.tafPermitRequired ? "true" : "false"} data-receipt-missing={line.receiptMissing ? "true" : "false"}>
          <td>{index + 1}</td><td><strong>{line.groupedItemIds ? line.make : `${line.make} / ${line.model}`}</strong>{line.groupedItemIds ? <span>{line.model}</span> : line.additionalInfo && <span>{line.additionalInfo}</span>}{!line.groupedItemIds && (line.serialRequired || line.serials) && <span className="customs-serial-print">Serial: {line.serials || "N/A"}</span>}{line.tafPermitRequired && <em className="customs-taf-flag">TAF radio permit</em>}</td>
          <td className="customs-asin-cell">{line.asins.length ? line.asins.join(", ") : "—"}</td>
          <td>{line.groupedItemIds ? <>{line.qty}<small> {line.unit}</small></> : <><input aria-label={`${line.make} / ${line.model} quantity`} inputMode="decimal" value={edits[line.id].qty} onChange={(event) => updateEdit(line.id, "qty", event.target.value)} /><small>{line.unit}</small></>}</td>
          <td title={meta?.originNote ?? "Combined origins"}>{line.groupedItemIds ? line.origin || "N/A" : <input aria-label={`${line.make} / ${line.model} country of origin`} value={edits[line.id].origin} onChange={(event) => updateEdit(line.id, "origin", event.target.value)} placeholder="N/A" />}</td>
          <td>{line.groupedItemIds ? usd(line.unitCost) : <input aria-label={`${line.make} / ${line.model} unit value`} inputMode="decimal" value={edits[line.id].unitCost} onChange={(event) => updateEdit(line.id, "unitCost", event.target.value)} />}</td>
          <td className="customs-total-cell">{usd(line.lineTotal)}</td><td className="customs-total-cell customs-fjd-column">{fjd(line.lineTotal * fxRate)}</td><td className="customs-invoice-refs">{line.invoiceRefs.length
            ? line.invoiceRefs.map((ref) => <sup key={ref}>{ref}</sup>)
            : line.receiptMissing ? <span className="customs-receipt-missing">PDF not provided</span> : "—"}</td>
          <td className="customs-serial-column">{line.groupedItemIds ? "N/A" : <input aria-label={`${line.make} / ${line.model} serial numbers`} value={edits[line.id].serials} onChange={(event) => updateEdit(line.id, "serials", event.target.value)} placeholder="N/A" />}</td>
        </tr>; })}</tbody>
        <tfoot><tr className="customs-full-print-copy"><td colSpan={6}>Declared goods line items</td><td>{usd(grossGoodsTotal)}</td><td className="customs-fjd-column">{fjd(grossGoodsTotal * fxRate)}</td><td>Actual transaction values required</td><td className="customs-serial-column" /></tr>{orderLevelDiscount !== 0 && <tr className="customs-full-print-copy"><td colSpan={6}>Order-level commercial discount</td><td>{usd(orderLevelDiscount)}</td><td className="customs-fjd-column">{fjd(orderLevelDiscount * fxRate)}</td><td>Retain matching receipts</td><td className="customs-serial-column" /></tr>}<tr className="customs-full-print-copy"><td colSpan={6}>Net declared goods subtotal</td><td>{usd(goodsTotal)}</td><td className="customs-fjd-column">{fjd(goodsTotal * fxRate)}</td><td>Before freight and insurance</td><td className="customs-serial-column" /></tr><tr className="customs-taf-print-only"><td colSpan={6}>TAF radio permit items subtotal</td><td>{usd(tafGoodsTotal)}</td><td className="customs-fjd-column">{fjd(tafGoodsTotal * fxRate)}</td><td>Displayed TAF items only</td><td className="customs-serial-column" /></tr></tfoot>
      </table></div>
      {groupedLine?.groupedItemIds && <details className="customs-group-disclosure customs-screen-only"><summary>Show {groupedLine.groupedItemIds.length} underlying lines combined for optional broker review</summary><ul>{groupedLine.groupedItemIds.map((id) => { const meta = customs.itemMeta[id]; return <li key={id}>{meta.make} / {meta.model} · {usd(valueOf(edits[id].qty) * valueOf(edits[id].unitCost))} · invoice {(receipts.itemInvoices[id] ?? []).join(", ") || "not identified"}</li>; })}</ul></details>}
      <section className="customs-invoice-index" aria-label="Invoice reference index"><h3>Invoice / receipt references</h3><table><thead><tr><th>No.</th><th>Date</th><th>Filename</th><th>Supplier</th></tr></thead><tbody>{visibleInvoices.map((invoice) => <tr key={invoice.number} data-taf={tafInvoiceRefs.has(invoice.number) ? "true" : "false"}><td><strong>{invoice.number}</strong></td><td>{invoice.date}</td><td>{invoice.filename}</td><td>{invoice.supplier}</td></tr>)}</tbody></table></section>
      <div className="customs-valuation-grid customs-export-excluded"><label><span>Supplier freight to LAX · USD</span><input inputMode="decimal" value={fields.supplierFreight} onChange={(event) => updateField("supplierFreight", event.target.value)} /></label><label><span>International baggage/freight · USD</span><input inputMode="decimal" value={fields.internationalFreight} onChange={(event) => updateField("internationalFreight", event.target.value)} /></label><label><span>Insurance · USD</span><input inputMode="decimal" value={fields.insurance} onChange={(event) => updateField("insurance", event.target.value)} /></label><label><span>Planning FJD per USD</span><input inputMode="decimal" value={fields.fjdPerUsd} onChange={(event) => updateField("fjdPerUsd", event.target.value)} /></label><div><span>Planning CIF · USD</span><strong>{usd(planningCif)}</strong></div><div><span>Planning CIF · FJD</span><strong>{fjd(planningCif * fxRate)}</strong></div></div>
      <div className="customs-manifest-notes customs-export-excluded"><div><h3>Attachments</h3><p>□ Numbered invoices &nbsp; □ Proof of payment &nbsp; □ Donation letter &nbsp; □ Beneficiary acceptance &nbsp; □ TAF permit(s) &nbsp; □ SAD/Customs Entry</p></div><div><h3>Declaration</h3><p>I declare that this manifest is complete and that the values shown are the actual prices paid or payable.</p><div className="customs-signature-lines"><span>Traveler signature</span><span>Date</span><span>Customs agent / witness</span></div></div></div>
    </section>
  </section>;
}
