"use client";

import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import dseRaw from "@/data/dse-system.json";
import { CustomsView } from "./CustomsView";
import { GraphInspector } from "./GraphInspector";
import { ShippingView } from "./ShippingView";
import type { GraphSelection } from "./systemGraph";
import { UnifiedSystemDiagram } from "./UnifiedSystemDiagram";

const loadSystemModel3D = () => import("./UnifiedSystemModel3D")
  .then((module) => ({ default: module.UnifiedSystemModel3D }));

type ViewerMode = "diagram" | "model" | "system" | "bom" | "shipping" | "customs" | "notes";

export type BomItem = {
  id: string;
  category: string;
  item: string;
  qty: number;
  unit: string;
  unitCost: number;
  currency: "USD" | "FJD";
  totalUsd: number;
  location: string;
  procurement: string;
  priority: string;
  description: string;
  productUrl?: string;
  specUrl?: string;
  accountingGroup?: BomAccountingGroup;
  includedInTotal?: boolean;
  paidFraction?: number;
  unitWeightKg?: number;
  totalWeightKg?: number;
  weightBasis?: string;
  weightSourceUrl?: string;
  weightNote?: string;
};

export type BomAccountingGroup = "system" | "additional" | "excluded";

export type BomAccountingTotals = {
  systemTotal: number;
  systemPaid: number;
  systemRemaining: number;
  systemRows: number;
  additionalTotal: number;
  additionalPaid: number;
  additionalRemaining: number;
  additionalRows: number;
};

type SystemData = {
  id: "dse";
  shortName: string;
  name: string;
  subtitle: string;
  location: string;
  revision: string;
  status: string;
  summary: string;
  currency: { base: string; fjdPerUsd: number; note: string };
  budget: { targetUsd: number; targetBasis?: "total" | "remaining"; donorFundedIncrementUsd?: number; contingencyIncluded: boolean; note: string };
  keyFacts: Array<{ label: string; value: string; detail: string }>;
  powerModel: { nominalBatteryKwh: number; usableBatteryKwh: number; averageSolarKwhDay: number | null; assumptions: string };
  bom: BomItem[];
  operatingRules: string[];
  commissioning: string[];
  research: Array<{ title: string; publisher: string; url: string }>;
};

const system = dseRaw as SystemData;

function paidAmount(item: BomItem) {
  if (isPurchased(item)) return item.totalUsd;
  return item.totalUsd * Math.max(0, Math.min(1, item.paidFraction ?? 0));
}
export function isPurchased(item: Pick<BomItem, "procurement">) {
  return item.procurement.includes("Purchased");
}
export function isItemToPurchase(item: Pick<BomItem, "procurement">) {
  return !/(?:Purchased|Donated|Outside scope|Deposit paid)/i.test(item.procurement);
}
export function getBomAccountingGroup(item: Pick<BomItem, "accountingGroup" | "includedInTotal">): BomAccountingGroup {
  if (item.accountingGroup) return item.accountingGroup;
  return item.includedInTotal === false ? "excluded" : "system";
}
function roundUsd(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
export function getBomAccountingTotals(items: BomItem[]): BomAccountingTotals {
  const totals = items.reduce((result, item) => {
    const group = getBomAccountingGroup(item);
    if (group === "system") {
      result.systemTotal += item.totalUsd;
      result.systemPaid += paidAmount(item);
      result.systemRows += 1;
    } else if (group === "additional") {
      result.additionalTotal += item.totalUsd;
      result.additionalPaid += paidAmount(item);
      result.additionalRows += 1;
    }
    return result;
  }, {
    systemTotal: 0,
    systemPaid: 0,
    systemRows: 0,
    additionalTotal: 0,
    additionalPaid: 0,
    additionalRows: 0,
  });
  const systemTotal = roundUsd(totals.systemTotal);
  const systemPaid = roundUsd(totals.systemPaid);
  const additionalTotal = roundUsd(totals.additionalTotal);
  const additionalPaid = roundUsd(totals.additionalPaid);
  return {
    ...totals,
    systemTotal,
    systemPaid,
    systemRemaining: roundUsd(Math.max(0, systemTotal - systemPaid)),
    additionalTotal,
    additionalPaid,
    additionalRemaining: roundUsd(Math.max(0, additionalTotal - additionalPaid)),
  };
}
export type BomSortKey = "weight" | "cost" | "status";
export type SortDirection = "asc" | "desc";
export function sortBomItems(items: BomItem[], key: BomSortKey, direction: SortDirection) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (key === "status") {
      const comparison = a.procurement.localeCompare(b.procurement);
      return comparison * multiplier || a.item.localeCompare(b.item);
    }
    const aValue = key === "weight" && !Number.isFinite(a.totalWeightKg) ? null : key === "weight" ? a.totalWeightKg! : a.totalUsd;
    const bValue = key === "weight" && !Number.isFinite(b.totalWeightKg) ? null : key === "weight" ? b.totalWeightKg! : b.totalUsd;
    if (aValue === null) return bValue === null ? a.item.localeCompare(b.item) : 1;
    if (bValue === null) return -1;
    return (aValue - bValue) * multiplier || a.item.localeCompare(b.item);
  });
}
function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function ModeIcon({ mode }: { mode: ViewerMode }) {
  if (mode === "model") return <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>;
  if (mode === "diagram") return <><rect x="3" y="4" width="7" height="6" rx="1" /><rect x="14" y="14" width="7" height="6" rx="1" /><path d="M10 7h5a3 3 0 0 1 3 3v4M6.5 10v5a2 2 0 0 0 2 2H14" /></>;
  if (mode === "system") return <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />;
  if (mode === "bom") return <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />;
  if (mode === "shipping") return <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 12h11M14 4v16M14 13h7" /></>;
  if (mode === "customs") return <path d="M5 3h10l4 4v14H5zM15 3v5h5M8 12h8M8 16h8" />;
  return <path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5" />;
}

function SystemOverview() {
  const accounting = getBomAccountingTotals(system.bom);
  return (
    <section className="system-overview-v2">
      <article className="system-hero-v2">
        <div><p className="eyebrow">{system.location} · {system.revision}</p><h1>{system.name}</h1><p>{system.summary}</p></div>
        <span className="system-status-pill">{system.status}</span>
      </article>
      <div className="system-fact-grid">
        {system.keyFacts.map((fact) => <article key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong><p>{fact.detail}</p></article>)}
        <article data-system-total="solar-internet"><small>Solar + internet BOM</small><strong>{money(accounting.systemTotal)}</strong><p>{money(accounting.systemPaid)} paid or committed. {money(accounting.additionalTotal)} in additional purchases is tracked separately.</p></article>
      </div>
      <div className="system-columns-v2">
        <article><h2>Operating rules</h2><ol>{system.operatingRules.map((rule) => <li key={rule}>{rule}</li>)}</ol></article>
        <article><h2>Commissioning</h2><ol>{system.commissioning.map((rule) => <li key={rule}>{rule}</li>)}</ol></article>
      </div>
    </section>
  );
}

function BomView() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [unpurchasedOnly, setUnpurchasedOnly] = useState(false);
  const [sort, setSort] = useState<{ key: BomSortKey; direction: SortDirection } | null>(null);
  const categories = useMemo(() => ["All", ...new Set(system.bom.map((item) => item.category))], []);
  const items = useMemo(() => {
    const filtered = system.bom.filter((item) => (
    (category === "All" || item.category === category) &&
    (!unpurchasedOnly || isItemToPurchase(item)) &&
    `${item.item} ${item.description} ${item.procurement}`.toLowerCase().includes(query.trim().toLowerCase())
    ));
    return sort ? sortBomItems(filtered, sort.key, sort.direction) : filtered;
  }, [category, query, sort, unpurchasedOnly]);
  const changeSort = (key: BomSortKey) => setSort((current) => current?.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: key === "status" ? "asc" : "desc" });
  const ariaSort = (key: BomSortKey) => sort?.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  const accounting = getBomAccountingTotals(system.bom);
  const physicalWeightKg = system.bom.reduce((sum, item) => sum + (Number.isFinite(item.totalWeightKg) ? item.totalWeightKg! : 0), 0);
  const weightedRows = system.bom.filter((item) => Number.isFinite(item.totalWeightKg)).length;
  return (
    <section className="bom-v2">
      <header className="bom-summary-v2">
        <div><p className="eyebrow">DSE / Fiji purchase tracking</p><h1>Bill of materials</h1><p>{system.bom.length} tracked rows. Solar/internet materials and additional managed purchases are accounted for separately.</p></div>
        <div className="bom-totals-v2">
          <span data-bom-total="design"><small>Design total</small><strong>{money(accounting.systemTotal)}</strong><small className="bom-total-detail">Solar + internet only · {accounting.systemRows} rows</small></span>
          <span><small>Design paid</small><strong>{money(accounting.systemPaid)}</strong></span>
          <span><small>Design remaining</small><strong>{money(accounting.systemRemaining)}</strong></span>
          <span className="bom-total-additional" data-bom-total="additional"><small>Additional purchases</small><strong>{money(accounting.additionalTotal)}</strong><small className="bom-total-detail">{money(accounting.additionalPaid)} paid · {accounting.additionalRows} rows</small></span>
          <span><small>All tracked weight</small><strong>{physicalWeightKg.toFixed(1)} kg</strong><small className="bom-total-detail">{weightedRows}/{system.bom.length} rows</small></span>
        </div>
      </header>
      <div className="bom-filters-v2">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search equipment, status, or notes" aria-label="Search bill of materials" />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter bill of materials by category">
          {categories.map((value) => <option key={value}>{value}</option>)}
        </select>
        <button type="button" className={unpurchasedOnly ? "active" : ""} aria-pressed={unpurchasedOnly} onClick={() => setUnpurchasedOnly((value) => !value)}>
          {unpurchasedOnly ? "Show All" : "Show Items To Purchase"}
        </button>
        <span className="bom-filter-count">{items.length} rows</span>
      </div>
      <div className="bom-table-wrap-v2">
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th aria-sort={ariaSort("status")}><button type="button" className="bom-sort-button" onClick={() => changeSort("status")}>Status<span aria-hidden="true">{sort?.key === "status" ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th><th>Location</th><th aria-sort={ariaSort("weight")}><button type="button" className="bom-sort-button" onClick={() => changeSort("weight")}>Weight<span aria-hidden="true">{sort?.key === "weight" ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th><th aria-sort={ariaSort("cost")}><button type="button" className="bom-sort-button" onClick={() => changeSort("cost")}>Cost<span aria-hidden="true">{sort?.key === "cost" ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th><th>Sources</th></tr></thead>
          <tbody>{items.map((item) => (
            <tr key={item.id} data-bom-id={item.id}>
              <td><strong>{item.item}</strong><small>{item.description}</small></td><td>{item.qty} {item.unit}</td>
              <td><span className={`procurement-pill procurement-${item.procurement.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{item.procurement}</span></td>
              <td>{item.location}</td>
              <td className="bom-weight-cell">{Number.isFinite(item.totalWeightKg)
                ? <><strong>{item.totalWeightKg!.toFixed(2)} kg</strong>{item.qty > 1 && Number.isFinite(item.unitWeightKg) && <small>{item.unitWeightKg!.toFixed(2)} kg each</small>}</>
                : <span aria-label="Weight pending">Pending</span>}</td>
              <td>{money(item.totalUsd)}</td>
              <td><div className="bom-source-links">{item.productUrl && <a href={item.productUrl} target="_blank" rel="noreferrer">Buy</a>}{item.specUrl && <a href={item.specUrl} target="_blank" rel="noreferrer">Technical</a>}{item.weightSourceUrl && <a href={item.weightSourceUrl} target="_blank" rel="noreferrer" title={item.weightNote ?? item.weightBasis}>Weight</a>}</div>{(item.weightNote || item.weightBasis) && <small className="bom-weight-note" title={item.weightNote}>{item.weightNote ?? item.weightBasis}</small>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function FieldNotes() {
  return (
    <section className="notes-v2">
      <header><p className="eyebrow">Field handoff</p><h1>Operating, commissioning, and source notes</h1></header>
      <div className="system-columns-v2">
        <article><h2>Operating rules</h2><ol>{system.operatingRules.map((rule) => <li key={rule}>{rule}</li>)}</ol></article>
        <article><h2>Commissioning sequence</h2><ol>{system.commissioning.map((rule) => <li key={rule}>{rule}</li>)}</ol></article>
      </div>
      <article className="research-v2"><h2>Technical sources</h2>{system.research.map((source) => source.url
        ? <a key={source.title} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}</strong><small>{source.publisher}</small></a>
        : <div key={source.title}><strong>{source.title}</strong><small>{source.publisher} · local reference</small></div>)}</article>
    </section>
  );
}

export function SystemViewer() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ViewerMode>("diagram");
  const [modelMounted, setModelMounted] = useState(false);
  const [Model3D, setModel3D] = useState<ComponentType<{
    fadePurchased: boolean;
    onFadePurchasedChange: (fade: boolean) => void;
    onSelect: (selection: GraphSelection) => void;
    onClearSelection: () => void;
  }> | null>(null);
  const [fadePurchased, setFadePurchased] = useState(false);
  const [selection, setSelection] = useState<GraphSelection | null>(null);

  useEffect(() => { shellRef.current?.setAttribute("data-viewer-ready", "true"); }, []);
  useEffect(() => {
    if (!selection) return;
    const closeInspector = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSelection(null);
    };
    window.addEventListener("keydown", closeInspector);
    return () => window.removeEventListener("keydown", closeInspector);
  }, [selection]);

  const changeMode = (nextMode: ViewerMode) => {
    if (nextMode === "model") {
      setModelMounted(true);
      if (!Model3D) void loadSystemModel3D().then(({ default: component }) => setModel3D(() => component));
    }
    setMode(nextMode);
    setSelection(null);
    window.scrollTo({ top: 0 });
  };

  const tabs: Array<{ id: ViewerMode; label: string }> = [
    { id: "diagram", label: "Detailed diagram" }, { id: "model", label: "3D model" },
    { id: "system", label: "System" }, { id: "bom", label: "Bill of materials" },
    { id: "shipping", label: "Shipping" }, { id: "customs", label: "Customs" }, { id: "notes", label: "Field notes" },
  ];

  return (
    <div className="app-shell" data-viewer-ready="false" data-project="dse-fiji" ref={shellRef}>
      <header className="app-header">
        <nav className="mode-tabs" aria-label="Viewer mode">{tabs.map((tab) => <button key={tab.id} type="button" className={mode === tab.id ? "active" : ""} onClick={() => changeMode(tab.id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><ModeIcon mode={tab.id} /></svg>{tab.label}{tab.id === "bom" && <span>{system.bom.length}</span>}
        </button>)}</nav>
        <div className="project-lockup" aria-label="Current project"><span>DSE</span><strong>Fiji</strong></div>
      </header>
      <main>
        {mode === "diagram" && <UnifiedSystemDiagram fadePurchased={fadePurchased} onFadePurchasedChange={setFadePurchased}
          onSelect={setSelection} onClearSelection={() => setSelection(null)} inspectorOpen={selection !== null} />}
        {modelMounted && <div className="model-workspace" hidden={mode !== "model"}>{Model3D
          ? <Model3D fadePurchased={fadePurchased} onFadePurchasedChange={setFadePurchased} onSelect={setSelection} onClearSelection={() => setSelection(null)} />
          : <div className="model-loading">Loading precomputed canonical scene…</div>}</div>}
        {mode === "system" && <SystemOverview />}{mode === "bom" && <BomView />}
        {mode === "shipping" && <ShippingView bom={system.bom} />}
        {mode === "customs" && <CustomsView bom={system.bom} planningFjdPerUsd={system.currency.fjdPerUsd} />}
        {mode === "notes" && <FieldNotes />}
      </main>
      {selection && <div className="inspector-layer">
        <GraphInspector selection={selection} bom={system.bom} onClose={() => setSelection(null)} onSelect={setSelection} /></div>}
    </div>
  );
}
