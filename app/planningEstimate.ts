export type PlanningTax = {
  ratePercent: number;
  jurisdiction: string;
  taxableLocation: string;
  note: string;
  sourceUrl: string;
};

type PlanningItem = { totalUsd: number; location: string };
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Item prices stay pre-tax. Round the aggregate tax once for the planning estimate. */
export function planningEstimate(items: readonly PlanningItem[], tax?: PlanningTax) {
  const subtotalUsd = cents(items.reduce((sum, item) => sum + item.totalUsd, 0));
  const taxableSubtotalUsd = tax ? cents(items.filter(item => item.location === tax.taxableLocation && item.totalUsd > 0)
    .reduce((sum, item) => sum + item.totalUsd, 0)) : 0;
  const taxUsd = cents(taxableSubtotalUsd * (tax?.ratePercent ?? 0) / 100);
  return { subtotalUsd, taxableSubtotalUsd, taxUsd, totalUsd: cents(subtotalUsd + taxUsd) };
}
