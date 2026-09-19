import system from "../data/polowat-system.json";

/** The reference shell is deferred. Component positions show an unpacked bench arrangement,
 * not a fitted enclosure layout. Internal dimensions will follow the owner's hand assembly.
 */
export const polowatAssemblyOrigin = [0.33, 1.47, 0] as const;

export const polowatEnclosure = {
  outer: { width: system.enclosurePlan.outerMm[1], height: system.enclosurePlan.outerMm[0], depth: system.enclosurePlan.outerMm[2] },
  mounting: null,
  layoutStatus: "bench-assembly-pending",
  bench: { width: 325, height: 424 },
  source: system.enclosurePlan.sourceUrl,
  allowanceUsd: system.bom.find(item => item.id === "polowat-enclosure")!.totalUsd,
  controllerClearance: { x: 5, y: 10, width: 131, height: 300 },
  parts: [
    { id: "batteryShunt", label: "BMV 500 A shunt", x: 345, y: 15, width: 120, height: 50, depth: 65 },
    { id: "monitorFuse", label: "BMV supplied 1 A fuse", x: 345, y: 90, width: 40, height: 15, depth: 15 },
    { id: "batteryMonitor", label: "BMV-700 display", x: 260, y: 260, width: 69, height: 69, depth: 31 },
    { id: "mppt", label: "SmartSolar", x: 5, y: 110, width: 131, height: 100, depth: 60 },
    { id: "starlinkConverter", label: "24 V converter", x: 175, y: 15, width: 150, height: 90, depth: 55 },
    { id: "pvBreaker", label: "PV 10 A", x: 175, y: 145, width: 54, height: 92, depth: 70 },
    { id: "controllerBreaker", label: "DC 30 A*", x: 250, y: 145, width: 54, height: 92, depth: 77 },
    { id: "starlinkBreaker", label: "10 A", x: 175, y: 260, width: 18, height: 92, depth: 70 },
    { id: "usbBreaker", label: "10 A", x: 209, y: 260, width: 18, height: 92, depth: 70 },
    { id: "loadPositiveBus", label: "DK10N LOAD +", x: 65, y: 345, width: 20, height: 43.2, depth: 49.3 },
    { id: "loadNegativeBus", label: "DK10N LOAD −", x: 85, y: 345, width: 20, height: 43.2, depth: 49.3 },
    { id: "batteryBreakerA", label: "Battery A 30 A", x: 345, y: 145, width: 54, height: 92, depth: 77 },
    { id: "batteryBreakerB", label: "Battery B 30 A", x: 345, y: 260, width: 54, height: 92, depth: 77 },
    { id: "usbCharger", label: "USB converter", x: 185, y: 365, width: 89, height: 51, depth: 27 },
    { id: "positiveBus", label: "DK10N BATT +", x: 25, y: 345, width: 20, height: 43.2, depth: 49.3 },
    { id: "negativeBus", label: "DK10N BATT −", x: 45, y: 345, width: 20, height: 43.2, depth: 49.3 },
  ],
};

export function benchDevicePlacement(id: string) {
  const p = polowatEnclosure.parts.find(part => part.id === id);
  if (!p) return null;
  return {
    position: [polowatAssemblyOrigin[0] + (p.x + p.width / 2 - polowatEnclosure.bench.width / 2) / 1000, polowatAssemblyOrigin[1] + (polowatEnclosure.bench.height / 2 - p.y - p.height / 2) / 1000, polowatAssemblyOrigin[2] + p.depth / 2000] as const,
    size: [p.width / 1000, p.height / 1000, p.depth / 1000] as const,
  };
}

/** Planning shell encloses the current layout and service loops, not the deferred retail box. */
const wallMm = 3;
const edgeMm = 35; // Side-facing shunt studs need a 25 mm terminal escape plus cable clearance.
const wireTurnMm = 35;
const wireSmoothingMm = 15;
const lowestPart = Math.max(...polowatEnclosure.parts.map(p => p.y + p.height));
export const polowatPlanningEnvelope = {
  left: -edgeMm,
  right: Math.max(polowatEnclosure.bench.width, ...polowatEnclosure.parts.map(p => p.x + p.width)) + edgeMm,
  top: Math.min(polowatEnclosure.controllerClearance.y, ...polowatEnclosure.parts.map(p => p.y)) - edgeMm,
  bottom: Math.ceil((lowestPart + wireTurnMm + wireSmoothingMm + edgeMm) / 10) * 10,
  back: -6,
  front: 200, // 144 mm service loops + conductor radius, curve overshoot and lid clearance.
  wallMm,
};
const shell = polowatPlanningEnvelope;
export const polowatPlanningShell = {
  size: [(shell.right-shell.left+2*wallMm)/1000, (shell.bottom-shell.top+2*wallMm)/1000, (shell.front-shell.back+wallMm)/1000] as const,
  position: [polowatAssemblyOrigin[0]+((shell.left+shell.right)/2-polowatEnclosure.bench.width/2)/1000,
    polowatAssemblyOrigin[1]+(polowatEnclosure.bench.height/2-(shell.top+shell.bottom)/2)/1000,
    polowatAssemblyOrigin[2]+(shell.front+shell.back-wallMm)/2000] as const,
};
