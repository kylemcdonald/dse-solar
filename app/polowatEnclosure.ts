import system from "../data/polowat-system.json";

/** The reference shell is deferred. Component positions show an unpacked bench arrangement,
 * not a fitted enclosure layout. Internal dimensions will follow the owner's hand assembly.
 */
export const polowatEnclosure = {
  outer: { width: system.enclosurePlan.outerMm[1], height: system.enclosurePlan.outerMm[0], depth: system.enclosurePlan.outerMm[2] },
  mounting: null,
  layoutStatus: "bench-assembly-pending",
  bench: { width: 325, height: 424 },
  source: system.enclosurePlan.sourceUrl,
  allowanceUsd: system.bom.find(item => item.id === "polowat-enclosure")!.totalUsd,
  controllerClearance: { x: 5, y: 10, width: 131, height: 300 },
  parts: [
    { id: "mppt", label: "SmartSolar", x: 5, y: 110, width: 131, height: 100, depth: 60 },
    { id: "starlinkConverter", label: "24 V converter", x: 175, y: 15, width: 150, height: 90, depth: 55 },
    { id: "pvBreaker", label: "PV 10 A", x: 175, y: 145, width: 54, height: 92, depth: 70 },
    { id: "controllerBreaker", label: "DC 30 A*", x: 250, y: 145, width: 54, height: 92, depth: 77 },
    { id: "starlinkBreaker", label: "10 A", x: 175, y: 260, width: 18, height: 92, depth: 70 },
    { id: "usbBreaker", label: "10 A", x: 209, y: 260, width: 18, height: 92, depth: 70 },
    { id: "loadSplit", label: "DK10N LOAD ±", x: 65, y: 345, width: 40, height: 43.2, depth: 49.3 },
    { id: "usbCharger", label: "USB converter", x: 185, y: 365, width: 89, height: 51, depth: 27 },
    { id: "positiveBus", label: "DK10N BATT +", x: 25, y: 345, width: 20, height: 43.2, depth: 49.3 },
    { id: "negativeBus", label: "DK10N BATT −", x: 45, y: 345, width: 20, height: 43.2, depth: 49.3 },
  ],
};

export function benchDevicePlacement(id: string) {
  const p = polowatEnclosure.parts.find(part => part.id === id);
  if (!p) return null;
  return {
    position: [0.33 + (p.x + p.width / 2 - polowatEnclosure.bench.width / 2) / 1000, 1.47 + (polowatEnclosure.bench.height / 2 - p.y - p.height / 2) / 1000, p.depth / 2000] as const,
    size: [p.width / 1000, p.height / 1000, p.depth / 1000] as const,
  };
}
