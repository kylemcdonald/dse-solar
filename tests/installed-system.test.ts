import assert from 'node:assert/strict';
import test from 'node:test';
import { dseTopology } from '../app/dseTopology';
import { dseRuntime } from '../app/dseRuntime';
import { deviceLocalPoint, rotateVector, worldHalfExtents } from '../app/physicalLayout';
import { renderedSemanticCables } from '../app/renderedCableGeometry';
import { sampledRouteSiteConflicts, sampledResolvedDeviceOverlaps } from '../app/routeAudits';
import { operatorBlocks, operatorEdges, operatorPath } from '../app/operatorDiagram';

const devices = new Map(dseTopology.devices.map(device => [device.id, device]));
const root = (endpoint: string): string => {
  const attachment = devices.get(endpoint.split('.')[0])?.attachment;
  return attachment ? root(attachment.endpoint) : endpoint;
};
const wire = (id: string) => {
  const connection = dseTopology.connections.find(wire => wire.id === id)!;
  assert.ok(connection, id);
  return [root(connection.from), root(connection.to)];
};

test('installed PV rail includes the disconnected spare, combiner and SPD in order', () => {
  const rail = ['pvCutoff', 'pvSpare', 'pvCombiner', 'pvSurge'];
  const box = dseRuntime.deviceById.get('pvJunction')!;
  const x = rail.map(id => deviceLocalPoint(box, dseRuntime.deviceById.get(id)!.position)[0]);
  assert.ok(x.every((value, index) => !index || value > x[index - 1]));
  assert.equal(devices.get('pvCombiner')!.currentProtection!.ratedCurrentA, 40);
  assert.match(devices.get('pvCombiner')!.label, /600 V/);
  assert.match(devices.get('pvSurge')!.label, /600 V.*40 kA/);
  assert.ok(!dseTopology.connections.some(wire => [wire.from, wire.to].some(endpoint => root(endpoint).startsWith('pvSpare.'))));
  assert.deepEqual(wire('pv-cutoff-combiner-positive'), ['pvCutoff.positiveOut', 'pvCombiner.positiveIn']);
  assert.deepEqual(wire('pv-output-positive'), ['pvCombiner.positiveOut', 'smartSolar.pvPositive']);
});

test('reported PV earth is daisy chained through the SPD and chassis, without a busbar', () => {
  assert.ok(!devices.has('earthBar'));
  assert.deepEqual(wire('pv-frame-inside'), ['servicePenetration.frameInside', 'pvSurge.earth']);
  assert.deepEqual(wire('multiplus-chassis-earth'), ['multiPlus.chassisEarth', 'pvSurge.earth']);
  assert.deepEqual(wire('earth-electrode-inside'), ['earthPenetration.inside', 'multiPlus.chassisEarth']);
  assert.ok(!dseTopology.connections.some(connection => ['ac-main-earth', 'ac-earth-continuity'].includes(connection.id)));
  for (const device of dseTopology.devices) for (const port of device.conductors.filter(port => port.kind === 'ac-neutral')) {
    assert.ok(!(port.internalMates ?? []).some(mate => device.conductors.find(candidate => candidate.id === mate)?.kind === 'earth'), `${device.id} does not invent an N–PE bridge`);
  }
});

test('rocker commons are daisy chained and only Internet on returns to the secondary box', () => {
  assert.deepEqual(wire('service-split'), ['switchedServicesBus.post3', 'switchInternet.common']);
  assert.deepEqual(wire('switch-common-top-middle'), ['switchInternet.common', 'switchOrion.common']);
  assert.deepEqual(wire('switch-common-middle-bottom'), ['switchOrion.common', 'switchLights.common']);
  assert.deepEqual(wire('internet-switch-split'), ['switchInternet.on', 'internetSplit.in']);
  assert.deepEqual(wire('orion-remote-h'), ['switchOrion.on', 'usbOrion.remoteH']);
  assert.deepEqual(wire('room-light-positive'), ['switchLights.on', 'indoorLightBreakout.positive']);
  for (const id of ['switchInternet', 'switchOrion', 'switchLights']) assert.ok(!dseTopology.connections.some(connection => [connection.from, connection.to].includes(`${id}.loop`)));
  assert.ok(!devices.has('serviceSplit') && !devices.has('roomSwitch'));
  for (const id of ['orion-remote-h', 'room-light-positive']) assert.ok(!dseRuntime.glands.some(gland => gland.junctionId === 'secondaryJunction' && gland.connectionIds.includes(id)));
});

test('both indoor lights share a two-core string and socket return originates at Orion', () => {
  assert.ok(!devices.has('outdoorLight') && !devices.has('outdoorLightBreakout'));
  assert.deepEqual(wire('room-light-cable'), ['indoorLightBreakout.cable', 'lightSplice.in']);
  assert.deepEqual(wire('light-middle-branch'), ['lightSplice.branch', 'indoorLight.power']);
  assert.deepEqual(wire('light-string-continuation'), ['lightSplice.out', 'indoorLight2.power']);
  assert.deepEqual(wire('socket-negative-feed'), ['usbOrion.ground', 'usbSocketA.negative']);
  assert.deepEqual(wire('multiplus-v-sense-negative'), ['battery1.negative', 'multiPlus.voltageSenseNegative']);
});

test('the installed model has a real northwest corner and the reported battery orientation', () => {
  assert.deepEqual(dseTopology.site!.walls.map(wall => wall.id), ['west', 'north']);
  const batteries = ['battery1', 'battery2', 'battery3', 'battery4'].map(id => dseRuntime.deviceById.get(id)!);
  assert.deepEqual(batteries.map(battery => battery.label), ['A1', 'A2', 'B1', 'B2']);
  batteries.forEach((battery, index) => {
    if (index) assert.ok(battery.position[2] > batteries[index - 1].position[2]);
    assert.ok(Math.abs(rotateVector([1, 0, 0], battery.rotation)[0]) > .99, 'long side runs east–west');
  });
  for (const id of ['multiPlus', 'smartSolar', 'ekrano', 'mainPositiveBus', 'mainNegativeBus', 'pvJunction', 'batteryCutoffJunction', 'balancerA', 'balancerB']) {
    const placement = devices.get(id)!.placement;
    assert.ok(placement.space === 'world' && placement.wallId === 'west', id);
  }
  for (const id of ['acJunction', 'usbMiniA', 'usbOrion', 'wallSwitchJunction', 'secondaryJunction']) {
    const placement = devices.get(id)!.placement;
    assert.ok(placement.space === 'world' && placement.wallId === 'north', id);
  }
  const y = (id: string) => dseRuntime.deviceById.get(id)!.position[1];
  assert.ok(y('acJunction') < dseTopology.site!.shelf.center[1]);
  assert.ok(dseTopology.site!.shelf.center[1] < y('usbMiniA'));
  assert.ok(y('usbMiniA') < y('usbOrion') && y('usbOrion') < y('secondaryJunction'));
});

test('operator diagram derives grouped power and remote-control connections from the detailed graph', () => {
  const edges = operatorEdges();
  assert.equal(edges.length, 14);
  assert.deepEqual(edges.filter(edge => edge.control).map(edge => [edge.from, edge.to]), [['fast', 'switches']]);
  assert.ok(operatorBlocks.find(block => block.id === 'fast')!.devices.includes('usbOrion'));
  assert.equal(operatorBlocks.find(block => block.id === 'chargeit')!.devices.length, 4);
  edges.forEach(edge => assert.ok(edge.connectionIds.length && edge.connectionIds.every(id => dseTopology.connections.some(connection => connection.id === id))));
  const removed = operatorEdges({ ...dseTopology, connections: dseTopology.connections.filter(connection => connection.id !== 'orion-remote-h') });
  assert.ok(!removed.some(edge => edge.control), 'removing a real connection removes its operator link');
});


test('operator power paths never cross another block or imply an unintended junction', () => {
  const segments = operatorEdges().flatMap(edge => {
    const path = operatorPath(edge);
    return path.points.slice(1).map((to, index) => ({ edge, from: path.points[index], to }));
  });
  for (const segment of segments) {
    const [x1, y1] = segment.from, [x2, y2] = segment.to;
    assert.ok(x1 === x2 || y1 === y2);
    for (const block of operatorBlocks) {
      if ([segment.edge.from, segment.edge.to].includes(block.id)) continue;
      const through = x1 === x2
        ? x1 > block.x && x1 < block.x + 230 && Math.max(y1, y2) > block.y && Math.min(y1, y2) < block.y + 90
        : y1 > block.y && y1 < block.y + 90 && Math.max(x1, x2) > block.x && Math.min(x1, x2) < block.x + 230;
      assert.equal(through, false, `path through ${block.id}`);
    }
  }
  segments.forEach((a, index) => segments.slice(index + 1).forEach(b => {
    if (a.edge === b.edge) return;
    const ah = a.from[1] === a.to[1], bh = b.from[1] === b.to[1];
    const range = (value: number, first: number, last: number) => value >= Math.min(first, last) && value <= Math.max(first, last);
    let crosses = false;
    if (ah !== bh) {
      const h = ah ? a : b, v = ah ? b : a;
      crosses = range(v.from[0], h.from[0], h.to[0]) && range(h.from[1], v.from[1], v.to[1]);
    } else {
      const fixed = ah ? 1 : 0, moving = ah ? 0 : 1;
      crosses = a.from[fixed] === b.from[fixed] && Math.max(Math.min(a.from[moving], a.to[moving]), Math.min(b.from[moving], b.to[moving])) <= Math.min(Math.max(a.from[moving], a.to[moving]), Math.max(b.from[moving], b.to[moving]));
    }
    assert.equal(crosses, false, `${a.edge.from}/${a.edge.to} crosses ${b.edge.from}/${b.edge.to}`);
  }));
});


test('photographed secondary box has the compact installed backplate and one 10 A output tap', () => {
  const box = dseRuntime.deviceById.get('secondaryJunction')!;
  assert.ok(box.size[0] <= .40 && box.size[1] <= .44);
  const local = (id: string) => deviceLocalPoint(box, dseRuntime.deviceById.get(id)!.position);
  assert.ok(local('secondaryPositiveBus')[0] < 0 && local('secondaryNegativeBus')[0] > 0);
  assert.equal(local('secondaryPositiveBus')[1], local('secondaryNegativeBus')[1]);
  assert.ok(local('secondaryPositiveBus')[1] < local('sharedServicesBreaker')[1]);
  assert.ok(local('unifiPower')[0] > 0 && local('unifiPower')[1] > local('switchedServicesBus')[1]);
  for (const id of ['orionBreaker32', 'chargeItBreaker32', 'sharedServicesBreaker']) assert.ok(local(id)[0] < 0);
  const bar = dseRuntime.deviceById.get('switchedServicesBus')!;
  assert.ok(worldHalfExtents(bar)[1] > worldHalfExtents(bar)[0], 'middle bar is vertical');
  assert.deepEqual(wire('service-breaker-bus'), ['sharedServicesBreaker.load', 'switchedServicesBus.post1']);
  assert.equal(dseTopology.connections.filter(connection => [connection.from, connection.to].some(endpoint => endpoint.startsWith('switchedServicesBus.'))).length, 2, 'one feed and one outgoing tap');
  const unifi = dseRuntime.deviceById.get('unifi')!;
  assert.ok(Math.abs(unifi.position[1] - worldHalfExtents(unifi)[1] - box.position[1] - box.size[1] / 2) < .001);
});

test('installed geometry corrections keep panel direction, entries, shelf and terminals consistent', () => {
  for (const panel of dseRuntime.devices.filter(device => device.kind === 'panel')) {
    const normal = rotateVector([0, 0, 1], panel.rotation);
    assert.ok(normal[1] > 0 && normal[2] < 0, 'panel face points upward and north');
  }
  const get = (id: string) => dseRuntime.deviceById.get(id)!;
  assert.equal(get('indoorLight').position[2], get('indoorLight2').position[2]);
  assert.equal(get('balancerA').position[2], get('battery1').position[2]);
  assert.ok(get('balancerA').position[1] > get('battery1').position[1] + get('battery1').size[1] / 2);
  for (const id of ['acInputProtection', 'acOutputProtection']) assert.equal(get(id).conductors.find(port => port.id === 'earth')!.face, 'top');
  assert.ok(!dseRuntime.devices.some(device => device.kind === 'generator'));
  assert.match(get('generator').label, /Type I male plug/);
  assert.equal(get('generator').position[1], get('toolOutlet').position[1]);
  assert.ok(Math.abs(get('generator').position[0] - get('toolOutlet').position[0]) < .25);
  assert.equal(get('earthPenetration').position[1], 0);
  assert.ok(get('earthElectrode').position[1] < 0);
  assert.ok(get('servicePenetration').position[1] > get('pvSurge').position[1]);
  assert.ok(get('starlink').position[0] < .4 && get('starlink').position[2] < .4);
  const glands = dseRuntime.glands.filter(gland => gland.junctionId === 'batteryCutoffJunction');
  assert.equal(glands.filter(gland => gland.face === 'top').length, 3);
  assert.equal(glands.filter(gland => gland.face === 'bottom').length, 3);
  assert.deepEqual(sampledRouteSiteConflicts(dseRuntime.routes, dseTopology), []);
  const shelf = dseTopology.site!.shelf;
  const collision = { ...dseRuntime.routes[0], points: [[shelf.center[0], shelf.center[1] - .1, shelf.center[2]], [shelf.center[0], shelf.center[1] + .1, shelf.center[2]]] as const };
  assert.ok(sampledRouteSiteConflicts([collision], dseTopology).length > 0, 'shelf audit detects a wire through the shelf');
});


test('solar power uses a white series chain and a polarity-separated white downlead Y', () => {
  const cable = (id: string) => dseTopology.cables.find(cable => cable.id === dseRuntime.routeById.get(id)!.cableId)!;
  assert.deepEqual(wire('pv-series-1-2'), ['panel1.positive', 'panel2.negative']);
  assert.deepEqual(wire('pv-series-2-3'), ['panel2.positive', 'panel3.negative']);
  assert.deepEqual(wire('pv-positive-outside'), ['panel3.positive', 'pvArrayBreakout.positive']);
  assert.deepEqual(wire('pv-negative-outside'), ['panel1.negative', 'pvArrayBreakout.negative']);
  for (const id of ['pv-series-1-2', 'pv-series-2-3', 'pv-positive-outside', 'pv-negative-outside', 'pv-downlead-outside', 'pv-downlead-inside']) assert.equal(cable(id).sheath, 'white');
  assert.deepEqual(cable('pv-downlead-outside').carriedChannels, ['positive', 'negative']);
  assert.deepEqual(wire('pv-downlead-outside'), ['pvArrayBreakout.cable', 'servicePenetration.pvCableOutside']);
  assert.deepEqual(wire('pv-downlead-inside'), ['servicePenetration.pvCableInside', 'pvInputBreakout.cable']);
  assert.deepEqual(wire('pv-positive-inside'), ['pvInputBreakout.positive', 'pvCutoff.positiveIn']);
  assert.deepEqual(wire('pv-negative-inside'), ['pvInputBreakout.negative', 'pvCutoff.negativeIn']);
  const fan = renderedSemanticCables(dseRuntime.devices, dseRuntime.conductors, dseRuntime.routes).filter(cable => cable.deviceId === 'pvArrayBreakout');
  assert.equal(fan.length, 3);
  assert.ok(fan.every(cable => cable.color === 'white'));
  for (const id of ['pvArrayBreakout', 'pvInputBreakout']) {
    const ports = devices.get(id)!.conductors;
    assert.deepEqual(ports.find(port => port.id === 'positive')!.internalMates, ['cable']);
    assert.deepEqual(ports.find(port => port.id === 'negative')!.internalMates, ['cable']);
  }
});

test('two continuous transverse solar rails replace panel-frame earth daisy chains', () => {
  const rails = dseRuntime.devices.filter(device => device.componentId === 'solarMounting');
  assert.equal(rails.length, 2);
  const panel = dseRuntime.deviceById.get('panel2')!;
  assert.deepEqual(sampledResolvedDeviceOverlaps([panel, ...rails]), []);
  assert.ok(sampledResolvedDeviceOverlaps([panel, { ...rails[0], position: panel.position }]).length > 0, 'oriented overlap audit still detects a rail inside a panel');
  rails.forEach(rail => {
    assert.ok(rail.size[0] > 3.6, 'one rail spans all three panels');
    assert.deepEqual(rotateVector([1, 0, 0], rail.rotation), [1, 0, 0], 'rails run east–west');
  });
  assert.ok(Math.abs(rails[0].position[2] - rails[1].position[2]) > 1);
  assert.deepEqual(wire('pv-frame-outside'), ['solarRailLower.earth', 'servicePenetration.frameOutside']);
  assert.ok(!dseTopology.connections.some(connection => ['pv-frame-1-2', 'pv-frame-2-3'].includes(connection.id)));
  assert.ok(dseTopology.devices.filter(device => device.kind === 'panel').every(panel => panel.conductors.every(port => port.kind !== 'earth')));
});
