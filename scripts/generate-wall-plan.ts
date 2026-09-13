import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dseTopology } from "../app/dseTopology";
import { EQUIPMENT_WALL_VOLUME } from "../app/systemGraph";
import type { WallPlan } from "../app/wallPlan";

/**
 * Derive the wall layout from the wiring diagram.
 *
 * The system-scope diagram already places every device by electrical flow:
 * sources left, loads right, everything beside what it is wired to, islands
 * of leaves hugging their hub. The wall follows the same picture. Each
 * wall-mounted device takes its diagram centre scaled onto the equipment
 * wall (flow runs along the wall, the diagram's top is the top of the wall),
 * then real bodies are pushed apart until nothing overlaps or comes within a
 * cable's clearance of a neighbour, and everything snaps to the routing
 * lattice. Floor equipment slides sideways as a group to stay under its
 * feeders; outside, ceiling and outside-wall equipment stays where the site
 * puts it.
 */
const SCHEMA_VERSION = 1;
const GENERATOR_VERSION = "dse-wall-plan-v1-diagram-flow";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const diagramPath = path.join(root, "data", "generated", "diagram-layouts.json");
const runtimePath = path.join(root, "data", "generated", "dse-runtime.json");
const outputPath = path.join(root, "data", "generated", "wall-plan.json");

const CELL = 0.02;
/** Usable band of the wall: above the floor equipment's cable dive, below arm's reach. */
const USABLE = { left: 0.35, right: EQUIPMENT_WALL_VOLUME.center[0] + EQUIPMENT_WALL_VOLUME.size[0] / 2 - 0.35, bottom: 0.32, top: 1.95 };
/** Metres per diagram pixel before fitting: compact, so the heavy runs stay
 * short; the push-apart pass makes the room real bodies need. */
const SCALE = { x: 0.0006, y: 0.0004 };
/** Air between neighbouring bodies for cables to run in. */
const CLEARANCE = 0.10;
const ENCLOSURE_CLEARANCE = 0.16;

type Node = { deviceId: string; x: number; y: number; width: number; height: number };
type Device = {
  id: string; kind: string; presentation?: string; attachment?: unknown;
  placement: { space: string; surface?: string; position?: readonly [number, number, number] };
  size: readonly [number, number, number];
};

const diagram = JSON.parse(await readFile(diagramPath, "utf8")) as { layouts: { system: { nodes: Node[] } } };
const solved = JSON.parse(await readFile(runtimePath, "utf8")) as { devices: Device[]; routes: Array<{ from: string; to: string; diameterMm?: number }> };
// Positions always come from the authored topology, never from a runtime that
// already had a plan applied, so successive passes converge instead of drifting.
const authoredPlacement = new Map(dseTopology.devices.map((device) => [device.id, device.placement as Device["placement"]]));
const runtime = { ...solved, devices: solved.devices.map((device) => ({ ...device, placement: authoredPlacement.get(device.id) ?? device.placement })) };
const nodes = new Map(diagram.layouts.system.nodes.map((node) => [node.deviceId, node]));
const snap = (value: number) => Math.round(value / CELL) * CELL;
const round = (value: number) => Number(value.toFixed(3));

const wallDevices = runtime.devices.filter((device) => device.placement.space === "world" && device.placement.surface === "wall"
  && !device.attachment && device.presentation !== "wall-passthrough" && nodes.has(device.id));
// A device authored on top of another it is wired to is mounted on it (a
// charger plugged into its socket): it rides along with its host.
const deviceKey = (endpoint: string) => endpoint.slice(0, endpoint.lastIndexOf("."));
const wired = new Set(runtime.routes.flatMap((route) => [`${deviceKey(route.from)}|${deviceKey(route.to)}`, `${deviceKey(route.to)}|${deviceKey(route.from)}`]));
const mountedOn = new Map<string, Device>();
wallDevices.forEach((device) => {
  const host = wallDevices.find((candidate) => candidate !== device && wired.has(`${device.id}|${candidate.id}`)
    && Math.hypot(candidate.placement.position![0] - device.placement.position![0], candidate.placement.position![1] - device.placement.position![1]) < 0.05
    && device.placement.position![2] > candidate.placement.position![2]);
  if (host) mountedOn.set(device.id, host);
});
const movable = wallDevices.filter((device) => !mountedOn.has(device.id));
const fixed = runtime.devices.filter((device) => device.placement.space === "world" && device.placement.surface === "wall" && !wallDevices.includes(device) && !device.attachment);

// 1. Scale the diagram onto the wall band, then shrink if it would not fit.
const minX = Math.min(...movable.map((device) => nodes.get(device.id)!.x));
const maxX = Math.max(...movable.map((device) => nodes.get(device.id)!.x));
const minY = Math.min(...movable.map((device) => nodes.get(device.id)!.y));
const maxY = Math.max(...movable.map((device) => nodes.get(device.id)!.y));
const sx = Math.min(SCALE.x, (USABLE.right - USABLE.left - 0.6) / Math.max(1, maxX - minX));
const sy = Math.min(SCALE.y, (USABLE.top - USABLE.bottom - 0.4) / Math.max(1, maxY - minY));
const spanX = (maxX - minX) * sx; const spanY = (maxY - minY) * sy;
// Anchor the cluster to what it cannot move — wall penetrations and outside
// equipment — by the median offset over the wires between them, so the
// runs to the site's fixed points stay short; then keep it on the wall.
const deviceKeyOf = (endpoint: string) => endpoint.slice(0, endpoint.lastIndexOf("."));
const anchored = new Map(runtime.devices.filter((device) => device.placement.space === "world" && !wallDevices.includes(device) && !device.attachment && device.placement.position)
  .map((device) => [device.id, device.placement.position!]));
const mappedX = (id: string) => (nodes.get(id)!.x - minX) * sx;
const mappedY = (id: string) => -(nodes.get(id)!.y - minY) * sy;
const offsets = runtime.routes.flatMap((route) => {
  const a = deviceKeyOf(route.from); const b = deviceKeyOf(route.to);
  const movableEnd = nodes.has(a) && wallDevices.some((device) => device.id === a) ? a : nodes.has(b) && wallDevices.some((device) => device.id === b) ? b : undefined;
  const fixedEnd = anchored.has(a) ? a : anchored.has(b) ? b : undefined;
  if (!movableEnd || !fixedEnd) return [];
  return [{ dx: anchored.get(fixedEnd)![0] - mappedX(movableEnd), dy: anchored.get(fixedEnd)![1] - mappedY(movableEnd) }];
});
const median = (values: number[]) => values.length ? values.toSorted((a, b) => a - b)[Math.floor((values.length - 1) / 2)] : 0;
const originX = Math.min(USABLE.right - spanX - 0.3, Math.max(USABLE.left + 0.3, offsets.length ? median(offsets.map(({ dx }) => dx)) : USABLE.left + ((USABLE.right - USABLE.left) - spanX) / 2));
const originY = Math.min(USABLE.top - 0.2, Math.max(USABLE.bottom + spanY + 0.2, offsets.length ? median(offsets.map(({ dy }) => dy)) : USABLE.top - ((USABLE.top - USABLE.bottom) - spanY) / 2));
type Body = { id: string; x: number; y: number; w: number; h: number; clearance: number; fixed: boolean; floor?: boolean };
const bodies: Body[] = [
  ...movable.map((device) => ({
    id: device.id,
    x: originX + (nodes.get(device.id)!.x - minX) * sx,
    y: originY - (nodes.get(device.id)!.y - minY) * sy,
    w: device.size[0], h: device.size[1],
    // Splices hanging off a terminal reach beyond the body; give them room.
    clearance: (device.kind === "junction" ? ENCLOSURE_CLEARANCE : CLEARANCE)
      + (runtime.devices.some((other) => (other.attachment as { endpoint: string } | undefined)?.endpoint.startsWith(`${device.id}.`)) ? 0.12 : 0),
    fixed: false,
  })),
  ...fixed.map((device) => ({ id: device.id, x: device.placement.position![0], y: device.placement.position![1], w: device.size[0], h: device.size[1], clearance: CLEARANCE, fixed: true })),
  // Floor equipment stands in front of the wall: it pulls its feeders down
  // and along, slides only sideways, and never collides with wall bodies.
  ...runtime.devices.filter((device) => device.placement.space === "world" && device.placement.surface === "floor" && !device.attachment && nodes.has(device.id))
    .map((device) => ({ id: device.id, x: device.placement.position![0], y: device.placement.position![1], w: device.size[0], h: device.size[1], clearance: 0, fixed: false, floor: true })),
];

// 2. Heavy cable pulls hard: every wire between two bodies attracts them with
//    the square of its diameter (a 2 AWG battery lead pulls an order of
//    magnitude harder than a data lead), so the heavy-current cluster closes
//    up while light services keep the diagram's spread; then overlapping
//    bodies are pushed apart along the axis that needs the smaller move. A
//    fixed body never moves.
const bodyById = new Map(bodies.map((body) => [body.id, body]));
const rootBody = (endpoint: string): Body | undefined => {
  const id = endpoint.slice(0, endpoint.lastIndexOf("."));
  const device = runtime.devices.find((candidate) => candidate.id === id);
  const attachment = device?.attachment as { endpoint: string } | undefined;
  return attachment ? rootBody(attachment.endpoint) : bodyById.get(id);
};
const pulls = runtime.routes.flatMap((route) => {
  const a = rootBody(route.from); const b = rootBody(route.to);
  if (!a || !b || a === b) return [];
  // Fourth power: a battery lead must win outright over a handful of data leads.
  return [{ a, b, weight: ((route.diameterMm ?? 4) / 4) ** 4 }];
});
for (let pass = 0; pass < 400; pass += 1) {
  let moved = false;
  if (pass < 300) {
    pulls.forEach(({ a, b, weight }) => {
      const strength = Math.min(1, weight / 100) * 0.2;
      const dx = b.x - a.x; const dy = b.y - a.y;
      const slack = Math.max(0, Math.hypot(dx, dy) - ((a.w + b.w) / 2 + Math.max(a.clearance, b.clearance)));
      if (slack <= 0) return;
      const step = Math.min(slack, strength);
      const ux = dx / Math.max(1e-6, Math.hypot(dx, dy)); const uy = dy / Math.max(1e-6, Math.hypot(dx, dy));
      if (!a.fixed) { a.x += ux * step * (b.fixed ? 1 : 0.5); if (!a.floor) a.y += uy * step * (b.fixed ? 1 : 0.5); }
      if (!b.fixed) { b.x -= ux * step * (a.fixed ? 1 : 0.5); if (!b.floor) b.y -= uy * step * (a.fixed ? 1 : 0.5); }
    });
    // Floor equipment moves as one group.
    const floorBodies = bodies.filter((body) => body.floor);
    if (floorBodies.length) {
      const drift = floorBodies.reduce((sum, body) => sum + (body.x - authoredPlacement.get(body.id)!.position![0]), 0) / floorBodies.length;
      floorBodies.forEach((body) => { body.x = authoredPlacement.get(body.id)!.position![0] + drift; });
    }
  }
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const a = bodies[i]; const b = bodies[j];
      if ((a.fixed && b.fixed) || a.floor || b.floor) continue;
      const gap = Math.max(a.clearance, b.clearance);
      const overlapX = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x);
      const overlapY = (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y);
      if (overlapX <= 0 || overlapY <= 0) continue;
      moved = true;
      const alongX = overlapX <= overlapY;
      const amount = (alongX ? overlapX : overlapY) + CELL;
      const sign = alongX ? Math.sign(b.x - a.x) || 1 : Math.sign(b.y - a.y) || 1;
      const shareA = a.fixed ? 0 : b.fixed ? 1 : 0.5; const shareB = 1 - shareA;
      if (alongX) { a.x -= sign * amount * shareA; b.x += sign * amount * shareB; }
      else { a.y -= sign * amount * shareA; b.y += sign * amount * shareB; }
    }
  }
  bodies.filter((body) => !body.fixed && !body.floor).forEach((body) => {
    body.x = Math.min(USABLE.right - body.w / 2, Math.max(USABLE.left + body.w / 2, body.x));
    body.y = Math.min(USABLE.top - body.h / 2, Math.max(USABLE.bottom + body.h / 2, body.y));
  });
  if (!moved) break;
}
// Heavy links run straight: two bodies joined by a heavy cable share a
// mounting row when they are already close, the lighter body moving.
pulls.filter(({ weight, a, b }) => weight >= 40 && !a.floor && !b.floor && !a.fixed && !b.fixed && Math.abs(a.y - b.y) < 0.3)
  .forEach(({ a, b }) => {
    const [mover, anchor] = a.w * a.h <= b.w * b.h ? [a, b] : [b, a];
    const y = anchor.y;
    const collides = bodies.some((other) => other !== mover && other !== anchor && !other.floor
      && Math.abs(other.x - mover.x) < (other.w + mover.w) / 2 + CLEARANCE && Math.abs(other.y - y) < (other.h + mover.h) / 2 + CLEARANCE);
    if (!collides) mover.y = y;
  });

// 3. Floor equipment sits under the wall equipment it is wired to (its heavy
//    cables are the shortest ones): the group shifts so its centre lands under
//    the mean of those neighbours' planned positions.
const floorDevices = runtime.devices.filter((device) => device.placement.space === "world" && device.placement.surface === "floor" && !device.attachment && nodes.has(device.id));
const rootOf = (id: string): string => {
  const device = runtime.devices.find((candidate) => candidate.id === id);
  const attachment = device?.attachment as { endpoint: string } | undefined;
  return attachment ? rootOf(attachment.endpoint.slice(0, attachment.endpoint.lastIndexOf("."))) : id;
};
const floorIds = new Set(floorDevices.map((device) => device.id));
const plannedX = new Map(bodies.filter((body) => !body.fixed && !body.floor).map((body) => [body.id, body.x]));
const neighbourXs = runtime.routes.flatMap((route) => {
  const from = rootOf(route.from.slice(0, route.from.lastIndexOf("."))); const to = rootOf(route.to.slice(0, route.to.lastIndexOf(".")));
  const other = floorIds.has(from) && !floorIds.has(to) ? to : floorIds.has(to) && !floorIds.has(from) ? from : undefined;
  return other !== undefined && plannedX.has(other) ? [plannedX.get(other)!] : [];
});
const floorAuthoredX = floorDevices.reduce((sum, device) => sum + device.placement.position![0], 0) / Math.max(1, floorDevices.length);
const floorPulledX = bodies.filter((body) => body.floor).reduce((sum, body) => sum + body.x, 0) / Math.max(1, floorDevices.length);
const floorTargetX = floorDevices.length ? floorPulledX : neighbourXs.length ? neighbourXs.reduce((sum, x) => sum + x, 0) / neighbourXs.length : floorAuthoredX;
const floorShiftX = floorDevices.length ? snap(Math.min(Math.max(floorTargetX, 0.8), USABLE.right - 1.0) - floorAuthoredX) : 0;

const positions: Record<string, readonly [number, number]> = Object.fromEntries(bodies.filter((body) => !body.fixed && !body.floor).map((body) => [body.id, [round(snap(body.x)), round(snap(body.y))] as const]));
mountedOn.forEach((host, id) => {
  const device = runtime.devices.find((candidate) => candidate.id === id)!;
  const planned = positions[host.id];
  positions[id] = [round(snap(planned[0] + device.placement.position![0] - host.placement.position![0])), round(snap(planned[1] + device.placement.position![1] - host.placement.position![1]))];
});
const hash = createHash("sha256");
hash.update(`${SCHEMA_VERSION}:${GENERATOR_VERSION}\n`);
hash.update(await readFile(fileURLToPath(import.meta.url)));
hash.update(JSON.stringify({ positions, floorShiftX }));
const plan: WallPlan = { schemaVersion: SCHEMA_VERSION, generatorVersion: GENERATOR_VERSION, sourceHash: hash.digest("hex"), positions, floorShiftX: round(floorShiftX) };

try {
  const existing = JSON.parse(await readFile(outputPath, "utf8")) as WallPlan;
  if (existing.sourceHash === plan.sourceHash) {
    console.log(`Wall plan is current (${existing.sourceHash.slice(0, 12)}); ${Object.keys(positions).length} wall devices, floor shift ${existing.floorShiftX} m.`);
    process.exit(0);
  }
} catch {
  // Missing or stale: write a fresh plan.
}
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(`Generated ${path.relative(root, outputPath)}: ${Object.keys(positions).length} wall devices at ${(sx * 1000).toFixed(2)}×${(sy * 1000).toFixed(2)} mm/px, floor shift ${plan.floorShiftX} m (${plan.sourceHash.slice(0, 12)}).`);
