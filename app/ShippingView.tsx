"use client";

import { useMemo, useState } from "react";

export type ShippingBomItem = {
  id: string;
  category: string;
  item: string;
  qty: number;
  unit: string;
  location: string;
  procurement: string;
  unitWeightKg?: number;
  totalWeightKg?: number;
  weightBasis?: string;
};

export type ShippingGroup = "Power & control" | "Protection & distribution" | "Wiring & terminations" |
  "Enclosures & mounting" | "Network & loads" | "Tools & spares" | "Additional purchases";

export const shippingColors: Record<ShippingGroup, string> = {
  "Power & control": "#2f6f73",
  "Protection & distribution": "#b95f42",
  "Wiring & terminations": "#d39a3b",
  "Enclosures & mounting": "#6c7f55",
  "Network & loads": "#526e9e",
  "Tools & spares": "#7c6492",
  "Additional purchases": "#8a7560",
};

export function shippingGroupFor(category: string): ShippingGroup {
  if (["Power electronics", "Power-electronics accessories", "Battery care", "DC conversion", "Monitoring"].includes(category)) return "Power & control";
  if (["AC safety", "DC safety", "PV safety", "Electrical protection", "DC distribution", "Purchase discrepancy", "Safety"].includes(category)) return "Protection & distribution";
  if (["Wiring", "Network accessories"].includes(category)) return "Wiring & terminations";
  if (category === "Mounting") return "Enclosures & mounting";
  if (["Network", "DC loads", "DC controls", "Portable accessories"].includes(category)) return "Network & loads";
  if (["Tools", "Tools & accessories", "Spares"].includes(category)) return "Tools & spares";
  return "Additional purchases";
}

type WeightedItem = ShippingBomItem & { totalWeightKg: number; shippingGroup: ShippingGroup };
export type TreemapTile = { item: WeightedItem; x: number; y: number; width: number; height: number };

export function buildWeightTreemap(items: WeightedItem[], x = 0, y = 0, width = 100, height = 100): TreemapTile[] {
  if (!items.length) return [];
  if (items.length === 1) return [{ item: items[0], x, y, width, height }];
  const sorted = [...items].sort((a, b) => b.totalWeightKg - a.totalWeightKg);
  const total = sorted.reduce((sum, item) => sum + item.totalWeightKg, 0);
  let splitIndex = 1;
  let firstWeight = sorted[0].totalWeightKg;
  while (splitIndex < sorted.length - 1 && firstWeight + sorted[splitIndex].totalWeightKg <= total / 2) {
    firstWeight += sorted[splitIndex].totalWeightKg;
    splitIndex += 1;
  }
  const ratio = firstWeight / total;
  const first = sorted.slice(0, splitIndex);
  const second = sorted.slice(splitIndex);
  if (width >= height) {
    const firstWidth = width * ratio;
    return [...buildWeightTreemap(first, x, y, firstWidth, height), ...buildWeightTreemap(second, x + firstWidth, y, width - firstWidth, height)];
  }
  const firstHeight = height * ratio;
  return [...buildWeightTreemap(first, x, y, width, firstHeight), ...buildWeightTreemap(second, x, y + firstHeight, width, height - firstHeight)];
}

export function ShippingView({ bom }: { bom: ShippingBomItem[] }) {
  const items = useMemo<WeightedItem[]>(() => bom
    .filter((item) => item.location === "Import" && Number(item.totalWeightKg) > 0)
    .map((item) => ({ ...item, totalWeightKg: Number(item.totalWeightKg), shippingGroup: shippingGroupFor(item.category) })), [bom]);
  const totalKg = items.reduce((sum, item) => sum + item.totalWeightKg, 0);
  const tiles = useMemo(() => buildWeightTreemap(items), [items]);
  const groupTotals = useMemo(() => Object.keys(shippingColors).map((name) => ({
    name: name as ShippingGroup,
    weight: items.filter((item) => item.shippingGroup === name).reduce((sum, item) => sum + item.totalWeightKg, 0),
  })).filter((group) => group.weight > 0), [items]);
  const [hovered, setHovered] = useState<WeightedItem | null>(null);
  return <section className="shipping-view" aria-label="Fiji import shipping weight treemap">
    <header className="shipping-heading"><div><p className="eyebrow">Fiji import planning</p><h1>Shipping by weight</h1><p>Every physical BOM line marked Import. Rectangle area is proportional to total item weight.</p></div><div className="shipping-total"><small>Total imported equipment</small><strong>{totalKg.toFixed(1)} kg</strong><span>{items.length} physical BOM rows</span></div></header>
    <div className="shipping-legend" aria-label="Shipping categories">{groupTotals.map((group) => <span key={group.name}><i style={{ backgroundColor: shippingColors[group.name] }} />{group.name}<b>{group.weight.toFixed(1)} kg</b></span>)}</div>
    <div className="shipping-treemap" role="img" aria-label={`Treemap of ${items.length} imported physical BOM items totaling ${totalKg.toFixed(1)} kilograms`}>
      {tiles.map((tile) => {
        const area = tile.width * tile.height / 10_000;
        const title = `${tile.item.item}\n${tile.item.qty} ${tile.item.unit} · ${tile.item.totalWeightKg.toFixed(3)} kg\n${tile.item.shippingGroup}\n${tile.item.procurement}`;
        return <button key={tile.item.id} type="button" className="shipping-tile" data-small={area < 0.007 ? "true" : "false"}
          style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.width}%`, height: `${tile.height}%`, backgroundColor: shippingColors[tile.item.shippingGroup] }}
          title={title} aria-label={title.replaceAll("\n", ", ")} onMouseEnter={() => setHovered(tile.item)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(tile.item)} onBlur={() => setHovered(null)}>
          <strong>{tile.item.item}</strong><span>{tile.item.totalWeightKg.toFixed(2)} kg</span>
        </button>;
      })}
    </div>
    <div className="shipping-hover" aria-live="polite">{hovered ? <><i style={{ backgroundColor: shippingColors[hovered.shippingGroup] }} /><strong>{hovered.item}</strong><span>{hovered.qty} {hovered.unit} · {hovered.totalWeightKg.toFixed(3)} kg · {hovered.shippingGroup}</span><small>{hovered.procurement} · weight basis: {hovered.weightBasis ?? "estimate"}</small></> : <span>Hover or focus a rectangle for item details.</span>}</div>
  </section>;
}
