import type { SystemGraph } from "./systemGraph";

/**
 * Wall plan: where the wall-mounted equipment goes, derived from the wiring
 * diagram's flow placement (see scripts/generate-wall-plan.ts). The authored
 * topology keeps a position for every device so the graph is complete on its
 * own; the plan overrides the x/y of wall devices and shifts floor equipment
 * sideways to follow them. Everything outside the equipment wall (panels,
 * generator, electrode, lights, the Starlink) stays where the site puts it.
 */
export type WallPlan = {
  schemaVersion: 1;
  generatorVersion: string;
  sourceHash: string;
  /** Wall device centres in metres along and up the wall. */
  positions: Record<string, readonly [number, number]>;
  /** Sideways shift applied to floor equipment so it stays under its feeders. */
  floorShiftX: number;
};

export function applyWallPlan(graph: SystemGraph, plan: WallPlan | undefined): SystemGraph {
  if (!plan) return graph;
  return {
    ...graph,
    devices: graph.devices.map((device) => {
      if (device.placement.space !== "world") return device;
      const planned = plan.positions[device.id];
      if (planned && device.placement.surface === "wall") {
        return { ...device, placement: { ...device.placement, position: [planned[0], planned[1], device.placement.position[2]] as const } };
      }
      if (device.placement.surface === "floor" && plan.floorShiftX !== 0) {
        const [x, y, z] = device.placement.position;
        return { ...device, placement: { ...device.placement, position: [x + plan.floorShiftX, y, z] as const } };
      }
      return device;
    }),
  };
}

/**
 * What the wiring diagram actually reads from the runtime artifact: graph
 * structure, labels, glands — not cable geometry or device positions. Hashing
 * this instead of the whole file lets the runtime be re-solved for new wall
 * positions without forcing the diagram to regenerate.
 */
export function diagramRuntimeSignature(runtime: unknown): string {
  const strip = (value: unknown, drop: ReadonlySet<string>): unknown => {
    if (Array.isArray(value)) return value.map((item) => strip(item, drop));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !drop.has(key))
        .map(([key, item]) => [key, strip(item, drop)]));
    }
    return value;
  };
  const artifact = runtime as Record<string, unknown>;
  const relevant = {
    graphId: artifact.graphId,
    graphRevision: artifact.graphRevision,
    graph: strip(artifact.graph, new Set()),
    devices: strip(artifact.devices, new Set(["position", "rotation", "size"])),
    conductors: strip(artifact.conductors, new Set(["position", "direction", "worldPosition"])),
    glands: strip(artifact.glands, new Set(["position"])),
    routes: strip(artifact.routes, new Set(["points", "lengthM", "routed", "routingRank"])),
  };
  return JSON.stringify(relevant);
}
