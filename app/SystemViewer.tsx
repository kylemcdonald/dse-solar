"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import dseRaw from "@/data/dse-system.json";
import polowatRaw from "@/data/polowat-system.json";
import { CostView } from "./CostView";
import { planningEstimate, type PlanningTax } from "./planningEstimate";
import { ReceiptInbox } from "./ReceiptInbox";
import { receiptBomPurchases, type ReceiptRecord } from "./receiptLedger";
import { dseRuntime } from "./dseRuntime";
import { GraphInspector } from "./GraphInspector";
import { PolowatSystemDiagram } from "./PolowatSystemDiagram";
import { PolowatElectricalAudit } from "./PolowatElectricalAudit";
import { titleCase } from "./systemGraph";
import type { DevicePowerReading, GraphSelection } from "./systemGraph";
import { OperatorDiagram } from "./OperatorDiagram";
import { UnifiedSystemDiagram } from "./UnifiedSystemDiagram";
import { defaultViewerRoute, tabsForProject, viewerHref, type ProjectMode, type ViewerMode, type ViewerRoute } from "./viewerRoutes";
import { navigateViewer, useViewerRoute } from "./viewerNavigation";

const Model3D = lazy(() => import("./UnifiedSystemModel3D")
  .then((module) => ({ default: module.UnifiedSystemModel3D })));
const CablePlan = lazy(() => import("./CablePlanView")
  .then((module) => ({ default: module.CablePlanView })));
const PolowatModel3D = lazy(() => import("./PolowatSystemModel3D")
  .then((module) => ({ default: module.PolowatSystemModel3D })));

export type BomItem = {
  id: string;
  category: string;
  item: string;
  qty: number;
  unit: string;
  unitCost: number;
  priceStatus?: string;
  priceCheckedDate?: string;
  priceBasis?: string;
  currency: "USD" | "FJD";
  totalUsd: number;
  sourceTotal?: number;
  location: string;
  procurement: string;
  priority: string;
  description: string;
  productUrl?: string;
  specUrl?: string;
  accountingGroup?: BomAccountingGroup;
  includedInTotal?: boolean;
  grantPayer?: "IYOIYO" | "DSE";
  grantSection?: "fiji";
  purchaseDate?: string;
  supplierReference?: string;
  historicalEstimateFjd?: number;
  grantPaymentNote?: string;
  grantFundingSource?: string;
  grantFundingAmountUsd?: number;
  grantFundingTreatment?: string;
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
  id: ProjectMode;
  shortName: string;
  name: string;
  subtitle: string;
  location: string;
  revision: string;
  status: string;
  summary: string;
  currency: { base: string; fjdPerUsd: number; note: string };
  budget: { targetUsd: number; targetBasis?: "total" | "remaining"; donorFundedIncrementUsd?: number; contingencyIncluded: boolean; note: string };
  taxEstimate?: PlanningTax;
  keyFacts: Array<{ label: string; value: string; detail: string }>;
  powerModel: { nominalBatteryKwh: number; usableBatteryKwh: number; averageSolarKwhDay: number | null; peakLoadWatts?: number; assumptions: string };
  deploymentModel?: {
    loadBudget: Array<{ load: string; basis: string; wattHoursPerDay: number; peakWatts: number }>;
    shipping: {
      importedNetKg: number;
      importedPackedKg: number;
      localEquipmentKg: number;
      batteryKg: number;
      totalInstalledKg: number;
      packingAllowancePercent: number;
      note: string;
    };
  };
  bom: BomItem[];
  operatingRules: string[];
  commissioning: string[];
  research: Array<{ title: string; publisher: string; url: string }>;
};

const dseSystem = dseRaw as SystemData;
const polowatSystem = polowatRaw as SystemData;

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

function compactPowerReading(reading: DevicePowerReading) {
  return [
    reading.wattsRange ? `${reading.wattsRange[0]}–${reading.wattsRange[1]} W` : undefined,
    reading.watts !== undefined ? `${reading.watts} W` : undefined,
    reading.wattHours !== undefined ? `${reading.wattHours} Wh` : undefined,
    reading.voltAmps !== undefined ? `${reading.voltAmps} VA` : undefined,
    reading.currentA !== undefined ? `${reading.currentA} A` : undefined,
    reading.percent !== undefined ? `${reading.percent}%` : undefined,
    reading.voltage,
  ].filter(Boolean).join(" · ") || "Measure received unit";
}

function PowerAudit() {
  const devices = dseRuntime.graph.devices.filter((device) => device.power)
    .toSorted((first, second) => first.label.localeCompare(second.label));
  const circuits = dseRuntime.graph.powerCircuits ?? [];
  const passiveCount = dseRuntime.graph.devices.filter((device) => (
    !device.power && device.presentation !== "wire-join" && device.presentation !== "cable-breakout"
  )).length;
  return (
    <section className="system-power-audit" aria-labelledby="power-audit-title">
      <div className="system-power-heading">
        <div><p className="eyebrow">Normal demand ≠ fault current</p><h2 id="power-audit-title">Device power and circuit capacity</h2></div>
        <p>{devices.length} active/source devices checked · {passiveCount} passive devices have no standing load modeled</p>
      </div>
      <div className="power-audit-table-wrap">
        <table className="power-audit-table">
          <thead><tr><th>Device</th><th>Role / evidence</th><th>Published or confirmed power</th></tr></thead>
          <tbody>{devices.map((device) => <tr key={device.id}>
            <th>{device.label}</th>
            <td><span className={`power-evidence power-evidence-${device.power!.verified ? "documented" : "provisional"}`}>{titleCase(device.power!.role)} · {device.power!.verified ? "documented" : "provisional"}</span></td>
            <td>{device.power!.readings.map((reading) => <span key={reading.label}><b>{reading.label}</b> · {compactPowerReading(reading)}</span>)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="circuit-budget-grid">{circuits.map((circuit) => <article key={circuit.id} className={`circuit-budget circuit-normal-${circuit.normalStatus}`}>
        <div><h3>{circuit.label}</h3><span>{titleCase(circuit.normalStatus)}</span></div>
        <dl>
          {circuit.typicalWatts !== undefined && <div><dt>Typical</dt><dd>{circuit.typicalWatts} W</dd></div>}
          {circuit.maximumWatts !== undefined && <div><dt>Maximum</dt><dd>{circuit.maximumWatts} W</dd></div>}
          {circuit.maximumCurrentA !== undefined && <div><dt>Calculated current</dt><dd>{circuit.maximumCurrentA} A</dd></div>}
          {circuit.conductorAmpacityA !== undefined && <div><dt>Path rating</dt><dd>{circuit.conductorAmpacityA} A</dd></div>}
          <div><dt>Fault / OCP</dt><dd className={`fault-status fault-status-${circuit.faultStatus}`}>{titleCase(circuit.faultStatus)}</dd></div>
        </dl>
        <p>{circuit.note}</p>
      </article>)}</div>
    </section>
  );
}

function ModeIcon({ mode }: { mode: ViewerMode }) {
  if (mode === "model") return <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>;
  if (mode === "diagram" || mode === "simple") return <><rect x="3" y="4" width="7" height="6" rx="1" /><rect x="14" y="14" width="7" height="6" rx="1" /><path d="M10 7h5a3 3 0 0 1 3 3v4M6.5 10v5a2 2 0 0 0 2 2H14" /></>;
  if (mode === "system") return <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />;
  if (mode === "bom") return <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />;
  if (mode === "cables") return <><path d="M7 3.5h10v17H7zM10 7h4M10 11h4M10 15h4" /><path d="M4 7h3M17 17h3" /></>;
  if (mode === "cost") return <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 13h8V4M11 9h10M16 9v11" /></>;
  return <path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5" />;
}

function SystemOverview({ system }: { system: SystemData }) {
  const accounting = getBomAccountingTotals(system.bom);
  const isPolowat = system.id === "polowat";
  const estimate = planningEstimate(system.bom, system.taxEstimate);
  return (
    <section className="system-overview-v2">
      <article className="system-hero-v2">
        <div><p className="eyebrow">{system.location} · {system.revision}</p><h1>{system.name}</h1><p>{system.summary}</p></div>
        <span className="system-status-pill">{system.status}</span>
      </article>
      <div className="system-fact-grid">
        {system.keyFacts.map((fact) => <article key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong><p>{fact.detail}</p></article>)}
        <article data-system-total="solar-internet"><small>{isPolowat ? "Estimate incl. California tax" : "Solar + internet BOM"}</small><strong>{money(isPolowat ? estimate.totalUsd : accounting.systemTotal)}</strong><p>{isPolowat
          ? `Includes ${money(estimate.taxUsd)} estimated Los Angeles sales tax (${system.taxEstimate?.ratePercent}%) on imported equipment. Before freight, duty, unpriced scopes or Starlink service. ${money(system.budget.targetUsd)} working ceiling.`
          : `${money(accounting.systemPaid)} paid or committed. ${money(accounting.additionalTotal)} in additional purchases is tracked separately.`}</p></article>
      </div>
      {system.deploymentModel && <div className="polowat-planning-grid">
        <article className="polowat-load-budget">
          <div className="polowat-section-heading"><p className="eyebrow">Daily energy model</p><h2>What the small system is sized to run</h2></div>
          <table><thead><tr><th>Load</th><th>Planning basis</th><th>Peak</th><th>Daily</th></tr></thead>
            <tbody>{system.deploymentModel.loadBudget.map((row) => <tr key={row.load}>
              <th>{row.load}</th><td>{row.basis}</td><td>{row.peakWatts} W</td><td>{row.wattHoursPerDay} Wh</td>
            </tr>)}</tbody>
            <tfoot><tr><th colSpan={2}>Design total</th><td>{system.powerModel.peakLoadWatts ?? 150} W</td><td>{system.deploymentModel.loadBudget.reduce((sum, row) => sum + row.wattHoursPerDay, 0)} Wh/day</td></tr></tfoot>
          </table>
        </article>
        <article className="polowat-shipping-summary">
          <div className="polowat-section-heading"><p className="eyebrow">Logistics split</p><h2>Shipping weight estimate</h2></div>
          <dl>
            <div><dt>Imported equipment</dt><dd>{system.deploymentModel.shipping.importedNetKg.toFixed(1)} kg</dd></div>
            <div><dt>Packed import estimate</dt><dd>{system.deploymentModel.shipping.importedPackedKg.toFixed(1)} kg</dd></div>
            <div><dt>Purchased in Chuuk</dt><dd>{system.deploymentModel.shipping.localEquipmentKg.toFixed(1)} kg</dd></div>
            <div><dt>Of which batteries</dt><dd>{system.deploymentModel.shipping.batteryKg.toFixed(1)} kg</dd></div>
            <div><dt>Deployment total</dt><dd>{system.deploymentModel.shipping.totalInstalledKg.toFixed(1)} kg</dd></div>
          </dl>
          <p>{system.deploymentModel.shipping.note}</p>
        </article>
      </div>}
      {system.id !== "polowat" && <p>Fully installed on Fulaga. Equipment is fixed. Earlier purchase and fabrication plans are historical; the current diagrams record the reported installation and identify details still to be confirmed.</p>}
      <div className="system-columns-v2">
        <article><h2>Operating rules</h2><ol>{system.operatingRules.map((rule) => <li key={rule}>{rule}</li>)}</ol></article>
        <article><h2>{system.id === "dse" ? "Installation record" : "Commissioning"}</h2><ol>{system.commissioning.map((rule) => <li key={rule}>{rule}</li>)}</ol></article>
      </div>
      {isPolowat ? <PolowatElectricalAudit /> : <PowerAudit />}
    </section>
  );
}

function BomView({ system }: { system: SystemData }) {
  const [receiptRecords, setReceiptRecords] = useState<ReceiptRecord[]>([]);
  const purchases = useMemo(() => receiptBomPurchases(receiptRecords), [receiptRecords]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [unpurchasedOnly, setUnpurchasedOnly] = useState(false);
  const [sort, setSort] = useState<{ key: BomSortKey; direction: SortDirection } | null>(null);
  const categories = useMemo(() => ["All", ...new Set(system.bom.map((item) => item.category))], [system.bom]);
  const items = useMemo(() => {
    const filtered = system.bom.filter((item) => (
    (category === "All" || item.category === category) &&
    (!unpurchasedOnly || (isItemToPurchase(item) && (purchases[item.id]?.quantity ?? 0) < item.qty)) &&
    `${item.item} ${item.description} ${item.procurement}`.toLowerCase().includes(query.trim().toLowerCase())
    ));
    return sort ? sortBomItems(filtered, sort.key, sort.direction) : filtered;
  }, [category, query, sort, system.bom, unpurchasedOnly, purchases]);
  const changeSort = (key: BomSortKey) => setSort((current) => current?.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: key === "status" ? "asc" : "desc" });
  const ariaSort = (key: BomSortKey) => sort?.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  const accounting = getBomAccountingTotals(system.bom);
  const physicalWeightKg = system.bom.reduce((sum, item) => sum + (Number.isFinite(item.totalWeightKg) ? item.totalWeightKg! : 0), 0);
  const weightedRows = system.bom.filter((item) => Number.isFinite(item.totalWeightKg)).length;
  const isPolowat = system.id === "polowat";
  const importedCost = system.bom.filter((item) => item.location === "Import to Chuuk").reduce((sum, item) => sum + item.totalUsd, 0);
  const localCost = system.bom.filter((item) => item.location === "Buy in Chuuk").reduce((sum, item) => sum + item.totalUsd, 0);
  const estimate = planningEstimate(system.bom, system.taxEstimate);
  return (
    <section className="bom-v2">
      <ReceiptInbox key={system.id} project={system.id === "dse" ? "fiji" : "polowat"} bom={system.bom} onRecords={setReceiptRecords} />
      <header className="bom-summary-v2">
        <div><p className="eyebrow">{isPolowat ? "Inowon / Polowat deployment plan" : "DSE / Fiji purchase tracking"}</p><h1>Bill of materials</h1><p>{isPolowat
          ? `${system.bom.length} rows. Battery boxes are excluded. The reference junction box is included in this estimate but deferred: order it after hand assembly, and keep it out of the current cart. The Amazon cart was reconciled 15 Sep 2026 with every staged price and quantity verified, including shared PV/controller wire, MC4 kit, unified DK10N distribution and both round USB extensions. DIHOOL's photo, listing text and family-page specifications still need reconciliation. The detailed 3D assembly study exposes unresolved enclosure fit and installation checks. Three scopes are unpriced. Staging does not mean purchased.`
          : `${system.bom.length} tracked rows. Solar/internet materials and additional managed purchases are accounted for separately.`}</p></div>
        <div className="bom-totals-v2">
          <span data-bom-total="design"><small>{isPolowat ? "Estimate incl. California tax" : "Design total"}</small><strong>{money(isPolowat ? estimate.totalUsd : accounting.systemTotal)}</strong><small className="bom-total-detail">{isPolowat ? "Before freight, duty and unpriced scopes" : `Solar + internet only · ${accounting.systemRows} rows`}</small></span>
          {isPolowat ? <>
            <span data-bom-total="tax"><small>Los Angeles tax · {system.taxEstimate?.ratePercent}%</small><strong>{money(estimate.taxUsd)}</strong><small className="bom-total-detail">Estimated on {money(estimate.taxableSubtotalUsd)} imported equipment</small></span>
            <span><small>Import hardware</small><strong>{money(importedCost)}</strong></span>
            <span><small>Buy in Chuuk</small><strong>{money(localCost)}</strong></span>
            <span><small>Imported net weight</small><strong>{system.deploymentModel?.shipping.importedNetKg.toFixed(1)} kg</strong><small className="bom-total-detail">About {system.deploymentModel?.shipping.importedPackedKg.toFixed(1)} kg packed</small></span>
            <span><small>Local equipment</small><strong>{system.deploymentModel?.shipping.localEquipmentKg.toFixed(1)} kg</strong><small className="bom-total-detail">Includes {system.deploymentModel?.shipping.batteryKg.toFixed(1)} kg batteries</small></span>
          </> : <>
            <span><small>Design paid</small><strong>{money(accounting.systemPaid)}</strong></span>
            <span><small>Design remaining</small><strong>{money(accounting.systemRemaining)}</strong></span>
            <span className="bom-total-additional" data-bom-total="additional"><small>Additional purchases</small><strong>{money(accounting.additionalTotal)}</strong><small className="bom-total-detail">{money(accounting.additionalPaid)} paid · {accounting.additionalRows} rows</small></span>
            <span><small>All tracked weight</small><strong>{physicalWeightKg.toFixed(1)} kg</strong><small className="bom-total-detail">{weightedRows}/{system.bom.length} rows</small></span>
          </>}
        </div>
      </header>
      {isPolowat && system.taxEstimate && <p className="bom-tax-note">Item prices below are before tax. {system.taxEstimate.note} <a href={system.taxEstimate.sourceUrl} target="_blank" rel="noreferrer">CDTFA rate source</a>.</p>}
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
              <td>{(purchases[item.id]?.quantity ?? 0) >= item.qty ? <span className="procurement-pill">Purchased · receipt reconciled</span> : <span className={`procurement-pill procurement-${item.procurement.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{item.procurement}</span>}{purchases[item.id] && <small>{purchases[item.id].quantity} {item.unit} net on receipts · {money(purchases[item.id].itemCostUsd)} item cost before order adjustments</small>}</td>
              <td>{item.location}</td>
              <td className="bom-weight-cell">{Number.isFinite(item.totalWeightKg)
                ? <><strong>{item.totalWeightKg!.toFixed(2)} kg</strong>{item.qty > 1 && Number.isFinite(item.unitWeightKg) && <small>{item.unitWeightKg!.toFixed(2)} kg each</small>}</>
                : <span aria-label="Weight pending">Pending</span>}</td>
              <td className="bom-cost-cell"><strong>{item.priceStatus === "unpriced" ? "Unpriced" : money(item.totalUsd)}</strong>{item.priceCheckedDate && <small>Amazon · {item.priceCheckedDate}</small>}{item.priceStatus === "estimate" && <small>Planning allowance</small>}{item.currency === "FJD" && (item.sourceTotal !== undefined || item.totalUsd !== 0) && <small>FJD {(item.sourceTotal ?? item.unitCost * item.qty).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} source{item.grantPayer ? ` · ${item.grantPayer}` : ""}</small>}</td>
              <td><div className="bom-source-links">{item.productUrl && <a href={item.productUrl} target="_blank" rel="noreferrer">Buy</a>}{item.specUrl && <a href={item.specUrl} target="_blank" rel="noreferrer">Technical</a>}{item.weightSourceUrl && <a href={item.weightSourceUrl} target="_blank" rel="noreferrer" title={item.weightNote ?? item.weightBasis}>Weight</a>}</div>{(item.weightNote || item.weightBasis) && <small className="bom-weight-note" title={item.weightNote}>{item.weightNote ?? item.weightBasis}</small>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function FieldNotes({ system }: { system: SystemData }) {
  return (
    <section className="notes-v2">
      <header><p className="eyebrow">{system.id === "polowat" ? "Polowat planning handoff" : "Field handoff"}</p><h1>Operating, commissioning, and source notes</h1></header>
      {system.id !== "polowat" && <p>Fully installed on Fulaga. Equipment is fixed. Earlier purchase and fabrication plans are historical; the current diagrams record the reported installation and identify details still to be confirmed.</p>}
      <div className="system-columns-v2">
        <article><h2>Operating rules</h2><ol>{system.operatingRules.map((rule) => <li key={rule}>{rule}</li>)}</ol></article>
        <article><h2>{system.id === "dse" ? "Installed wiring and open details" : "Commissioning sequence"}</h2><ol>{system.commissioning.map((rule) => <li key={rule}>{rule}</li>)}</ol></article>
      </div>
      <article className="research-v2"><h2>Technical sources</h2>{system.research.map((source) => source.url
        ? <a key={source.title} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}</strong><small>{source.publisher}</small></a>
        : <div key={source.title}><strong>{source.title}</strong><small>{source.publisher} · local reference</small></div>)}</article>
    </section>
  );
}

export function SystemViewer({ initialRoute = defaultViewerRoute }: { initialRoute?: ViewerRoute }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const route = useViewerRoute(initialRoute);
  const { project, mode } = route ?? initialRoute;
  const [modelMounted, setModelMounted] = useState(mode === "model");
  const [fadePurchased, setFadePurchased] = useState(false);
  const [selection, setSelection] = useState<GraphSelection | null>(null);
  const [renderedRoute, setRenderedRoute] = useState({ project, mode });

  // Reset transient inspection before rendering a different route, including Back/Forward.
  if (renderedRoute.project !== project || renderedRoute.mode !== mode) {
    setRenderedRoute({ project, mode });
    setSelection(null);
    if (mode === "model") setModelMounted(true);
  }

  useEffect(() => { shellRef.current?.setAttribute("data-viewer-ready", "true"); }, []);
  useEffect(() => {
    const tab = tabsForProject(project).find(tab => tab.id === mode)!;
    document.title = `${project === "dse" ? "DSE Fiji" : "Inowon Polowat"} · ${tab.label}`;
  }, [project, mode]);
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

  const activeSystem = project === "dse" ? dseSystem : polowatSystem;

  const tabs = tabsForProject(project);
  if (!route) return <main className="notes-v2"><h1>Page not found</h1><a href={viewerHref("dse")}>Open the Fiji viewer</a></main>;

  return (
    <div className="app-shell" data-viewer-ready="false" data-project={project === "dse" ? "dse-fiji" : "inowon-polowat"} data-view={mode} ref={shellRef}>
      <header className="app-header">
        <nav className="mode-tabs" aria-label="Viewer mode">{tabs.map((tab) => <a key={tab.id} href={viewerHref(project, tab.id)} aria-current={mode === tab.id ? "page" : undefined} className={mode === tab.id ? "active" : ""} onClick={navigateViewer}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><ModeIcon mode={tab.id} /></svg>{tab.label}{tab.id === "bom" && <span>{activeSystem.bom.length}</span>}
        </a>)}</nav>
        <div className="project-switcher" aria-label="System design">
          <a href={viewerHref("dse", mode)} aria-current={project === "dse" ? "page" : undefined} className={project === "dse" ? "active" : ""} onClick={navigateViewer}>
            <span>DSE</span><strong>Fiji</strong>
          </a>
          <a href={viewerHref("polowat", mode)} aria-current={project === "polowat" ? "page" : undefined} className={project === "polowat" ? "active" : ""} onClick={navigateViewer}>
            <span>Inowon</span><strong>Polowat</strong>
          </a>
        </div>
      </header>
      <main>
        <div className="hydration-overlay" role="status" aria-live="polite"><span>Loading diagram…</span></div>
        {project === "dse" && mode === "simple" && <OperatorDiagram />}
        {project === "dse" && mode === "diagram" && <UnifiedSystemDiagram fadePurchased={fadePurchased} onFadePurchasedChange={setFadePurchased}
          onSelect={setSelection} onClearSelection={() => setSelection(null)} inspectorOpen={selection !== null} />}
        {project === "polowat" && mode === "diagram" && <PolowatSystemDiagram />}
        {modelMounted && project === "dse" && <div className="model-workspace" hidden={mode !== "model"}>
          <Suspense fallback={<div className="model-loading">Loading precomputed canonical scene…</div>}>
            <Model3D fadePurchased={fadePurchased} onFadePurchasedChange={setFadePurchased} onSelect={setSelection} onClearSelection={() => setSelection(null)} />
          </Suspense>
        </div>}
        {modelMounted && project === "polowat" && <div className="model-workspace" hidden={mode !== "model"}>
          <Suspense fallback={<div className="model-loading">Loading compact Polowat scene…</div>}><PolowatModel3D /></Suspense>
        </div>}
        {mode === "system" && <SystemOverview key={project} system={activeSystem} />}{mode === "bom" && <BomView key={project} system={activeSystem} />}
        {mode === "cost" && <CostView key={project} bom={activeSystem.bom} project={project} taxEstimate={activeSystem.taxEstimate} />}
        {project === "dse" && mode === "cables" && <Suspense fallback={<div className="model-loading">Loading wire cut list…</div>}><CablePlan /></Suspense>}
        {mode === "notes" && <FieldNotes key={project} system={activeSystem} />}
      </main>
      {project === "dse" && selection && <div className="inspector-layer">
        <GraphInspector selection={selection} bom={dseSystem.bom} onClose={() => setSelection(null)} onSelect={setSelection} /></div>}
    </div>
  );
}
