"use client";

import { useEffect, useMemo, useState } from "react";
import receiptsRaw from "@/data/dse-receipts.json";
import {
  buildGrantPurchaseReport,
  createGrantReportCsv,
  createGrantReportPdf,
  grantReportCsvFilename,
  grantReportFilename,
} from "./grantReport";
import type { GrantReportReceiptIndex } from "./grantReport";
import { buildTreemap } from "./ShippingView";

export type CostBomItem = {
  id: string;
  category: string;
  item: string;
  qty: number;
  unit: string;
  totalUsd: number;
  location: string;
  procurement: string;
  accountingGroup?: string;
  includedInTotal?: boolean;
  grantPayer?: "IYOIYO" | "DSE";
  grantPaymentNote?: string;
  grantFundingSource?: string;
  grantFundingAmountUsd?: number;
  grantFundingTreatment?: string;
};

export type CostScope = "Solar + internet" | "Additional purchases" | "Excluded / returns";
export type CostGroup = "Power & generation" | "Protection & distribution" | "Wiring & terminations" |
  "Enclosures & mounting" | "Network & loads" | "Tools & spares" | "Travel & adjustments" |
  "Additional purchases" | "Excluded / returns";

export const costColors: Record<CostGroup, string> = {
  "Power & generation": "#2f6f73",
  "Protection & distribution": "#b95f42",
  "Wiring & terminations": "#d39a3b",
  "Enclosures & mounting": "#6c7f55",
  "Network & loads": "#526e9e",
  "Tools & spares": "#7c6492",
  "Travel & adjustments": "#977443",
  "Additional purchases": "#8a7560",
  "Excluded / returns": "#697779",
};

export function costScopeFor(item: Pick<CostBomItem, "accountingGroup" | "includedInTotal">): CostScope {
  if (item.accountingGroup === "additional") return "Additional purchases";
  if (item.accountingGroup === "system" || !item.accountingGroup && item.includedInTotal !== false) {
    return "Solar + internet";
  }
  return "Excluded / returns";
}

export function costGroupFor(item: Pick<CostBomItem, "category" | "accountingGroup" | "includedInTotal">): CostGroup {
  const scope = costScopeFor(item);
  if (scope === "Additional purchases") return scope;
  if (scope === "Excluded / returns") return scope;
  if (["Storage", "Generation", "Power electronics", "Power-electronics accessories", "Battery care",
    "DC conversion", "Monitoring", "Backup"].includes(item.category)) return "Power & generation";
  if (["AC safety", "DC safety", "PV safety", "Electrical protection", "DC distribution",
    "Purchase discrepancy", "Safety"].includes(item.category)) return "Protection & distribution";
  if (["Wiring", "Network accessories"].includes(item.category)) return "Wiring & terminations";
  if (item.category === "Mounting") return "Enclosures & mounting";
  if (["Network", "DC loads", "DC controls", "Portable accessories"].includes(item.category)) return "Network & loads";
  if (["Tools", "Tools & accessories", "Spares"].includes(item.category)) return "Tools & spares";
  return "Travel & adjustments";
}

export type CostedItem = CostBomItem & { costGroup: CostGroup; costScope: CostScope };
export type CostScopeFilter = "All items" | CostScope;

export function costTreemapItems(bom: readonly CostBomItem[]) {
  return bom.filter((item) => Number.isFinite(item.totalUsd) && item.totalUsd > 0)
    .map((item): CostedItem => ({ ...item, costGroup: costGroupFor(item), costScope: costScopeFor(item) }));
}

export function buildCostTreemap(items: readonly CostedItem[]) {
  return buildTreemap(items, (item) => item.totalUsd);
}

export function filterCostTreemapItems(items: readonly CostedItem[], scope: CostScopeFilter) {
  return scope === "All items" ? [...items] : items.filter((item) => item.costScope === scope);
}

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(value);
const receipts = receiptsRaw as GrantReportReceiptIndex;

function downloadGrantPurchaseReportPdf(bom: readonly CostBomItem[]) {
  const report = buildGrantPurchaseReport(bom, receipts);
  const pdf = createGrantReportPdf(report);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = grantReportFilename(report);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function downloadGrantPurchaseReportCsv(bom: readonly CostBomItem[]) {
  const report = buildGrantPurchaseReport(bom, receipts);
  const csv = createGrantReportCsv(report);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = grantReportCsvFilename(report);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function CostView({ bom }: { bom: CostBomItem[] }) {
  const [privateMode, setPrivateMode] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/receipts/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ privateMode?: boolean }> : null)
      .then((status) => { if (active) setPrivateMode(Boolean(status?.privateMode)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const allItems = useMemo(() => costTreemapItems(bom), [bom]);
  const [scope, setScope] = useState<CostScopeFilter>("All items");
  const items = useMemo(() => filterCostTreemapItems(allItems, scope), [allItems, scope]);
  const tiles = useMemo(() => buildCostTreemap(items), [items]);
  const positiveTotal = items.reduce((sum, item) => sum + item.totalUsd, 0);
  const credits = bom.filter((item) => Number.isFinite(item.totalUsd) && item.totalUsd < 0
    && (scope === "All items" || costScopeFor(item) === scope));
  const creditTotal = Math.abs(credits.reduce((sum, item) => sum + item.totalUsd, 0));
  const groupTotals = useMemo(() => Object.keys(costColors).map((name) => ({
    name: name as CostGroup,
    cost: items.filter((item) => item.costGroup === name).reduce((sum, item) => sum + item.totalUsd, 0),
  })).filter((group) => group.cost > 0), [items]);
  const [hovered, setHovered] = useState<CostedItem | null>(null);

  return <section className="shipping-view cost-view" aria-label="Bill of materials cost treemap">
    <header className="shipping-heading cost-heading"><div><p className="eyebrow">DSE / Fiji purchase tracking</p>
      <h1>Cost by item</h1><p>Every positive-cost BOM row. Rectangle area is proportional to total item cost in USD.</p>
    </div><div className="shipping-total cost-total"><small>Positive item value</small>
      <strong>{money(positiveTotal)}</strong><span>{items.length} of {allItems.length} positive-cost rows · {credits.length > 0
        ? `${money(creditTotal)} across ${credits.length} credit ${credits.length === 1 ? "row stays" : "rows stay"} in accounting totals`
        : "no credit rows in this subset"}</span>
    </div></header>
    <div className="cost-controls" aria-label="Cost treemap filters">
      <label htmlFor="cost-scope-filter">Show costs for</label>
      <select id="cost-scope-filter" value={scope}
        onChange={(event) => setScope(event.target.value as CostScopeFilter)}>
        <option value="All items">All positive-cost items</option>
        <option value="Solar + internet">Solar + internet</option>
        <option value="Additional purchases">Additional purchases</option>
        <option value="Excluded / returns">Excluded / returns</option>
      </select>
      <button type="button" className="grant-report-export" onClick={() => downloadGrantPurchaseReportPdf(bom)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" /></svg>
        Export grant report PDF
      </button>
      <button type="button" className="grant-report-export" onClick={() => downloadGrantPurchaseReportCsv(bom)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" /></svg>
        Export grant report CSV
      </button>
      {privateMode && <a className="receipt-archive-download" href="/api/receipts/download" download>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" /></svg>
        Download all receipts (.zip)
      </a>}
      <span>{items.length} rows shown</span>
    </div>
    <div className="shipping-legend cost-legend" aria-label="Cost categories">{groupTotals.map((group) => <span key={group.name}>
      <i style={{ backgroundColor: costColors[group.name] }} />{group.name}<b>{money(group.cost)}</b>
    </span>)}</div>
    <div className="shipping-treemap cost-treemap" role="img"
      aria-label={`Treemap of ${items.length} positive-cost BOM items totaling ${money(positiveTotal)}`}>
      {tiles.map((tile) => {
        const area = tile.width * tile.height / 10_000;
        const title = `${tile.item.item}\n${tile.item.qty} ${tile.item.unit} · ${money(tile.item.totalUsd)}\n${tile.item.costGroup} · ${tile.item.costScope}\n${tile.item.procurement}`;
        return <button key={tile.item.id} type="button" className="shipping-tile cost-tile"
          data-small={area < 0.007 ? "true" : "false"} data-accounting-scope={tile.item.costScope}
          data-cost-usd={tile.item.totalUsd.toFixed(2)}
          style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.width}%`, height: `${tile.height}%`,
            backgroundColor: costColors[tile.item.costGroup] }} title={title} aria-label={title.replaceAll("\n", ", ")}
          onMouseEnter={() => setHovered(tile.item)} onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(tile.item)} onBlur={() => setHovered(null)}>
          <strong>{tile.item.item}</strong><span>{money(tile.item.totalUsd)}</span>
        </button>;
      })}
    </div>
    <div className="shipping-hover cost-hover" aria-live="polite">{hovered ? <>
      <i style={{ backgroundColor: costColors[hovered.costGroup] }} /><strong>{hovered.item}</strong>
      <span>{hovered.qty} {hovered.unit} · {money(hovered.totalUsd)} · {hovered.costGroup}</span>
      <small>{hovered.costScope} · {hovered.procurement} · {hovered.location}</small>
    </> : <span>Hover or focus a rectangle for item cost and accounting details.</span>}</div>
  </section>;
}
