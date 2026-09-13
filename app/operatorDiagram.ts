import { dseTopology } from './dseTopology';
import type { SystemGraph } from './systemGraph';

export const operatorBlocks = [
  { id: 'solar', label: 'Solar panels', detail: 'All three roof panels', devices: ['panel1', 'panel2', 'panel3', 'solarRailUpper', 'solarRailLower'], x: 30, y: 30 },
  { id: 'pv', label: 'PV cutoff box', detail: 'PV 1 + combiner · PV 2 unused', devices: ['pvCutoff', 'pvSpare', 'pvCombiner', 'pvSurge'], x: 300, y: 30 },
  { id: 'mppt', label: 'Solar charger', detail: 'MPPT + its battery-side cutoff', devices: ['smartSolar', 'mpptBreaker'], x: 570, y: 30 },
  { id: 'generator', label: 'Generator', detail: 'AC input protection', devices: ['generator', 'acInputProtection'], x: 840, y: 30 },
  { id: 'battery', label: 'Battery bank', detail: 'A1 + A2 / B1 + B2 · A/B cutoffs', devices: ['battery1', 'battery2', 'battery3', 'battery4', 'batteryBreakerA', 'batteryBreakerB', 'balancerA', 'balancerB', 'smartShunt'], x: 30, y: 220 },
  { id: 'distribution', label: '24 V distribution', detail: 'Main buses + services breakers', devices: ['mainPositiveBus', 'mainNegativeBus', 'secondaryPositiveBus', 'secondaryNegativeBus', 'sharedServicesBreaker', 'switchedServicesBus', 'orionBreaker32', 'chargeItBreaker32'], x: 300, y: 220 },
  { id: 'multiplus', label: 'MultiPlus', detail: 'Inverter / generator battery charger', devices: ['multiPlus'], x: 570, y: 220 },
  { id: 'ac', label: 'Tool outlet', detail: 'AC output protection · one tool', devices: ['toolOutlet', 'acOutputProtection'], x: 840, y: 220 },
  { id: 'chargeit', label: 'ChargeIT chargers', detail: 'All four · controlled by 32 A breaker', devices: ['usbMiniA', 'usbMiniB', 'usbMiniC', 'usbMiniD'], x: 30, y: 420 },
  { id: 'switches', label: 'Three-gang wall switch', detail: 'Top Internet / middle Orion / bottom lights', devices: ['switchInternet', 'switchOrion', 'switchLights'], x: 300, y: 420 },
  { id: 'monitor', label: 'Ekrano display', detail: 'Check battery and system status', devices: ['ekrano'], x: 840, y: 420 },
  { id: 'fast', label: 'Fast charging', detail: 'Orion + sockets + both fast chargers', devices: ['usbOrion', 'usbSocketA', 'usbSocketB', 'usb145A', 'usb145B'], x: 30, y: 640 },
  { id: 'internet', label: 'Internet', detail: 'Starlink + UniFi', devices: ['starlink', 'unifi', 'unifiPower', 'internetSplit'], x: 570, y: 640 },
  { id: 'lights', label: 'Indoor lights', detail: 'Both lights on one shared string', devices: ['indoorLight', 'indoorLight2', 'indoorLightBreakout', 'lightSplice'], x: 840, y: 640 },
] as const;

export type OperatorEdge = { from: string; to: string; control: boolean; connectionIds: string[] };
/** Collapse physical breakouts and terminal joins. Every visible link retains
 * its actual connection IDs; this is a projection of the detailed graph. */
export function operatorEdges(graph: SystemGraph = dseTopology): OperatorEdge[] {
  const groups = new Map<string, string>(operatorBlocks.flatMap(block => block.devices.map(id => [id, block.id])));
  const deviceById = new Map(graph.devices.map(device => [device.id, device]));
  const groupFor = (id: string): string | undefined => {
    const own = groups.get(id); if (own) return own;
    const attachment = deviceById.get(id)?.attachment;
    return attachment ? groupFor(attachment.endpoint.split('.')[0]) : undefined;
  };
  const owner = (endpoint: string) => groupFor(endpoint.split('.')[0]);
  const links = new Map<string, { to: string; id?: string; control: boolean }[]>();
  const link = (from: string, to: string, control: boolean, id?: string) => {
    links.set(from, [...(links.get(from) ?? []), { to, control, id }]);
    links.set(to, [...(links.get(to) ?? []), { to: from, control, id }]);
  };
  graph.connections.filter(wire => ['positive', 'ac-line', 'multicore', 'control'].includes(wire.kind)
    && !wire.seriesLink && (wire.kind !== 'control' || owner(wire.from) === 'switches')).forEach(wire => link(wire.from, wire.to, wire.kind === 'control', wire.id));
  graph.devices.filter(device => !groupFor(device.id)).forEach(device => device.conductors.forEach(port => {
    (port.internalMates ?? []).forEach(mate => link(`${device.id}.${port.id}`, `${device.id}.${mate}`, false));
  }));
  const result = new Map<string, OperatorEdge>();
  for (const [endpoint] of links) {
    const from = owner(endpoint); if (!from) continue;
    const pending = [{ endpoint, ids: [] as string[], control: false }]; const seen = new Set<string>();
    while (pending.length) {
      const step = pending.pop()!; if (seen.has(step.endpoint)) continue; seen.add(step.endpoint);
      const to = owner(step.endpoint);
      if (to && to !== from) {
        const pair = [from, to].sort(); const key = `${pair.join(':')}:${step.control}`;
        const old = result.get(key);
        result.set(key, { from: pair[0], to: pair[1], control: step.control, connectionIds: [...new Set([...(old?.connectionIds ?? []), ...step.ids])] });
        continue;
      }
      if (step.endpoint !== endpoint && to) continue;
      for (const next of links.get(step.endpoint) ?? []) pending.push({ endpoint: next.to, ids: next.id ? [...step.ids, next.id] : step.ids, control: step.control || next.control });
    }
  }
  return [...result.values()];
}

// Presentation routes only. Electrical links are still supplied exclusively by
// operatorEdges; separate lanes prevent a crossing from implying a junction.
const flowPaths: Record<string, { from: string; points: readonly (readonly [number, number])[] }> = {
  'pv:solar': { from: 'solar', points: [[260,75],[300,75]] },
  'mppt:pv': { from: 'pv', points: [[530,75],[570,75]] },
  'distribution:mppt': { from: 'mppt', points: [[685,120],[685,160],[415,160],[415,220]] },
  'generator:multiplus': { from: 'generator', points: [[955,120],[955,180],[685,180],[685,220]] },
  'battery:distribution': { from: 'battery', points: [[260,265],[300,265]] },
  'distribution:multiplus': { from: 'distribution', points: [[530,265],[570,265]] },
  'ac:multiplus': { from: 'multiplus', points: [[800,265],[840,265]] },
  'distribution:switches': { from: 'distribution', points: [[415,310],[415,420]] },
  'chargeit:distribution': { from: 'distribution', points: [[365,310],[365,350],[145,350],[145,420]] },
  'distribution:monitor': { from: 'distribution', points: [[465,310],[465,370],[955,370],[955,420]] },
  'distribution:fast': { from: 'distribution', points: [[315,310],[315,330],[10,330],[10,685],[30,685]] },
  'fast:switches': { from: 'switches', points: [[365,510],[365,560],[145,560],[145,640]] },
  'internet:switches': { from: 'switches', points: [[415,510],[415,580],[685,580],[685,640]] },
  'lights:switches': { from: 'switches', points: [[465,510],[465,540],[955,540],[955,640]] },
};
export function operatorPath(edge: OperatorEdge) {
  const path = flowPaths[[edge.from, edge.to].sort().join(':')];
  if (!path) throw new Error(`Missing operator layout for ${edge.from} / ${edge.to}`);
  return path;
}
