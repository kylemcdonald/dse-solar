import { currentSourcesFromDevices } from "./systemGraph";
import type {
  CurrentSafetyChannel,
  CurrentSafetyConnectionCheck,
  CurrentSafetyDeviceCheck,
  CurrentSafetyIssue,
  CurrentSafetyReport,
  Device,
  SystemGraph,
} from "./systemGraph";


const UNBOUNDED_CURRENT_A = 1_000_000_000;
type CurrentNetworkEdge = {
  first: string;
  second: string;
  capacityA: number;
  protectionId?: string;
};

function currentVertex(endpoint: string, channel: CurrentSafetyChannel) {
  return `${channel}|endpoint|${endpoint}`;
}

function currentConnectionVertex(connectionId: string, channel: CurrentSafetyChannel) {
  return `${channel}|connection|${connectionId}`;
}

function maximumCurrentFlow(
  edges: readonly CurrentNetworkEdge[],
  sources: readonly { id: string; vertex: string; capacityA: number }[],
  targets: ReadonlySet<string>,
) {
  const sourceNode = "__current_super_source__";
  const sinkNode = "__current_target__";
  const nodes = new Set<string>([sourceNode, sinkNode]);
  edges.forEach((edge) => { nodes.add(edge.first); nodes.add(edge.second); });
  sources.forEach((source) => nodes.add(source.vertex));
  targets.forEach((target) => nodes.add(target));
  const indexByNode = new Map([...nodes].map((node, index) => [node, index]));
  type FlowEdge = { to: number; reverse: number; capacity: number };
  const adjacency: FlowEdge[][] = Array.from({ length: nodes.size }, () => []);
  const addDirected = (from: string, to: string, capacity: number) => {
    const fromIndex = indexByNode.get(from)!;
    const toIndex = indexByNode.get(to)!;
    const forward: FlowEdge = { to: toIndex, reverse: adjacency[toIndex].length, capacity };
    const reverse: FlowEdge = { to: fromIndex, reverse: adjacency[fromIndex].length, capacity: 0 };
    adjacency[fromIndex].push(forward);
    adjacency[toIndex].push(reverse);
  };
  edges.forEach((edge) => {
    addDirected(edge.first, edge.second, edge.capacityA);
    addDirected(edge.second, edge.first, edge.capacityA);
  });
  sources.forEach((source) => addDirected(sourceNode, source.vertex, source.capacityA));
  targets.forEach((target) => addDirected(target, sinkNode, UNBOUNDED_CURRENT_A));
  const sourceIndex = indexByNode.get(sourceNode)!;
  const sinkIndex = indexByNode.get(sinkNode)!;
  let total = 0;
  while (total < UNBOUNDED_CURRENT_A) {
    const level = Array(nodes.size).fill(-1);
    level[sourceIndex] = 0;
    const queue = [sourceIndex];
    while (queue.length > 0) {
      const current = queue.shift()!;
      adjacency[current].forEach((edge) => {
        if (edge.capacity > 1e-9 && level[edge.to] < 0) {
          level[edge.to] = level[current] + 1;
          queue.push(edge.to);
        }
      });
    }
    if (level[sinkIndex] < 0) break;
    const nextEdge = Array(nodes.size).fill(0);
    const send = (node: number, available: number): number => {
      if (node === sinkIndex) return available;
      for (; nextEdge[node] < adjacency[node].length; nextEdge[node] += 1) {
        const edge = adjacency[node][nextEdge[node]];
        if (edge.capacity <= 1e-9 || level[edge.to] !== level[node] + 1) continue;
        const sent = send(edge.to, Math.min(available, edge.capacity));
        if (sent <= 1e-9) continue;
        edge.capacity -= sent;
        adjacency[edge.to][edge.reverse].capacity += sent;
        return sent;
      }
      return 0;
    };
    while (total < UNBOUNDED_CURRENT_A) {
      const sent = send(sourceIndex, UNBOUNDED_CURRENT_A - total);
      if (sent <= 1e-9) break;
      total += sent;
    }
  }
  const residualReachable = new Set<number>([sourceIndex]);
  const residualQueue = [sourceIndex];
  while (residualQueue.length > 0) {
    const current = residualQueue.shift()!;
    adjacency[current].forEach((edge) => {
      if (edge.capacity <= 1e-9 || residualReachable.has(edge.to)) return;
      residualReachable.add(edge.to);
      residualQueue.push(edge.to);
    });
  }
  const crossesResidualCut = (first: string, second: string) => (
    residualReachable.has(indexByNode.get(first)!) !== residualReachable.has(indexByNode.get(second)!)
  );
  return {
    currentA: total,
    cutProtectionIds: edges
      .filter((edge) => edge.protectionId && crossesResidualCut(edge.first, edge.second))
      .map((edge) => edge.protectionId!)
      .toSorted(),
    cutSourceIds: sources
      .filter((source) => crossesResidualCut(sourceNode, source.vertex))
      .map((source) => source.id)
      .toSorted(),
  };
}

const R28_ACTIVE_CHANNELS = ["positive", "ac-line"] as const;
const R28_RETURN_CHANNELS = ["negative", "ac-neutral"] as const;

type R28ActiveChannel = (typeof R28_ACTIVE_CHANNELS)[number];
type R28NetworkEdge = { first: string; second: string; protectionId?: string };
type R28Protection = NonNullable<Device["currentProtection"]>;
type R28Source = NonNullable<SystemGraph["currentSources"]>[number];
type R28ProtectionCredit = "none" | "provisional" | "verified";
type R28CreditedProtection = { protection: R28Protection; credit: R28ProtectionCredit };

const r28SourceAssemblyPathKey = (deviceId: string, index: number) => `${deviceId}|${index}`;

function r28ConnectionCarries(
  graph: SystemGraph,
  connection: SystemGraph["connections"][number],
  channel: CurrentSafetyChannel,
) {
  if (connection.kind === channel) return true;
  if (connection.kind !== "multicore") return false;
  return Boolean(graph.cables.find((cable) => cable.id === connection.cableId)?.carriedChannels?.includes(channel));
}

function r28ConnectionSupportsChannel(
  graph: SystemGraph,
  connection: SystemGraph["connections"][number],
  channel: CurrentSafetyChannel,
) {
  if (!r28ConnectionCarries(graph, connection, channel)) return false;
  const port = (endpoint: string) => {
    const separator = endpoint.lastIndexOf(".");
    const device = graph.devices.find((candidate) => candidate.id === endpoint.slice(0, separator));
    return device?.conductors.find((candidate) => candidate.id === endpoint.slice(separator + 1));
  };
  const device = (endpoint: string) => {
    const separator = endpoint.lastIndexOf(".");
    let resolved = graph.devices.find((candidate) => candidate.id === endpoint.slice(0, separator));
    const visited = new Set<string>();
    while (resolved?.attachment && !visited.has(resolved.id)) {
      visited.add(resolved.id);
      const ownerId = resolved.attachment.endpoint.slice(0, resolved.attachment.endpoint.lastIndexOf("."));
      resolved = graph.devices.find((candidate) => candidate.id === ownerId);
    }
    return resolved;
  };
  const expectedKind = connection.kind === "multicore" ? "multicore" : channel;
  const fromKind = port(connection.from)?.kind;
  const toKind = port(connection.to)?.kind;
  if (fromKind === expectedKind && toKind === expectedKind) return true;
  return channel === "positive" && connection.seriesLink === true
    && fromKind === "positive" && toKind === "negative"
    && ["battery", "panel"].includes(device(connection.from)?.kind ?? "")
    && device(connection.from)?.kind === device(connection.to)?.kind;
}

function r28IsIntrinsicTerminalJoin(
  graph: SystemGraph,
  connection: SystemGraph["connections"][number],
) {
  if (connection.topologyRole !== "terminal-join") return false;
  return ([
    [connection.from, connection.to],
    [connection.to, connection.from],
  ] as const).some(([physicalEndpoint, joinEndpoint]) => {
    const separator = joinEndpoint.lastIndexOf(".");
    const owner = graph.devices.find((candidate) => candidate.id === joinEndpoint.slice(0, separator));
    return owner?.presentation === "wire-join"
      && owner.attachment?.endpoint === physicalEndpoint
      && joinEndpoint.slice(separator + 1) === "device";
  });
}

function buildR28CurrentNetwork(
  graph: SystemGraph,
  channel: R28ActiveChannel,
  protectionCreditById: ReadonlyMap<string, R28ProtectionCredit>,
  validSourceAssemblyPathKeys: ReadonlySet<string>,
) {
  const edges: R28NetworkEdge[] = [];
  const protections = new Map<string, R28CreditedProtection>();
  const supportedEndpoints = new Set<string>();
  graph.connections.filter((connection) => r28ConnectionSupportsChannel(graph, connection, channel)).forEach((connection) => {
    supportedEndpoints.add(connection.from);
    supportedEndpoints.add(connection.to);
  });
  graph.currentSources.filter((source) => source.channel === channel).forEach((source) => {
    supportedEndpoints.add(source.endpoint);
  });
  graph.devices.forEach((device) => device.currentSourceAssemblyPaths?.forEach((path, index) => {
    if (path.activeChannel !== channel || !validSourceAssemblyPathKeys.has(r28SourceAssemblyPathKey(device.id, index))) return;
    path.terminalPair.forEach((terminalId) => supportedEndpoints.add(`${device.id}.${terminalId}`));
  }));
  const addEdge = (first: string, second: string, protectionId?: string) => {
    if (first !== second) edges.push({ first, second, protectionId });
  };

  graph.connections.forEach((connection) => {
    if (!r28ConnectionSupportsChannel(graph, connection, channel)) return;
    const middle = currentConnectionVertex(connection.id, channel);
    const authoredProtectionId = connection.currentProtection ? `connection:${connection.id}` : undefined;
    const protectionId = authoredProtectionId && protectionCreditById.get(authoredProtectionId) !== "none"
      ? authoredProtectionId
      : undefined;
    if (protectionId) protections.set(protectionId, {
      protection: connection.currentProtection!,
      credit: protectionCreditById.get(protectionId) ?? "none",
    });
    // Integrated lead protection is directional: canonical connections run
    // source -> load, and the connection midpoint represents its protected
    // conductor body. A reverse-fed path is intentionally not credited.
    addEdge(currentVertex(connection.from, channel), middle, protectionId);
    addEdge(middle, currentVertex(connection.to, channel));
  });

  graph.devices.forEach((device) => {
    const endpoints = device.conductors
      .map((port) => `${device.id}.${port.id}`)
      .filter((endpoint) => supportedEndpoints.has(endpoint));
    const endpointSet = new Set(endpoints);
    const paired = new Set<string>();
    const addPair = (first: string, second: string, protectionId?: string) => {
      const key = [first, second].toSorted().join("|");
      if (paired.has(key)) return;
      paired.add(key);
      addEdge(currentVertex(first, channel), currentVertex(second, channel), protectionId);
    };
    device.conductors.forEach((port) => {
      const first = `${device.id}.${port.id}`;
      if (!endpointSet.has(first)) return;
      (port.internalMates ?? []).forEach((mateId) => {
        const second = `${device.id}.${mateId}`;
        if (endpointSet.has(second)) addPair(first, second);
      });
    });
    device.currentSourceAssemblyPaths?.forEach((path, index) => {
      if (path.activeChannel !== channel || !validSourceAssemblyPathKeys.has(r28SourceAssemblyPathKey(device.id, index))) return;
      const [firstId, secondId] = path.terminalPair;
      const first = `${device.id}.${firstId}`;
      const second = `${device.id}.${secondId}`;
      if (endpointSet.has(first) && endpointSet.has(second)) addPair(first, second);
    });
    const passivelyCommon = device.kind === "busbar"
      || device.kind === "switch"
      || device.presentation === "service-splice"
      || ((device.kind === "breaker" || device.kind === "protection") && !device.currentProtection);
    if (passivelyCommon) endpoints.forEach((first, index) => {
      endpoints.slice(index + 1).forEach((second) => addPair(first, second));
    });
    if (device.currentProtection?.terminalPairs) {
      const authoredProtectionId = `device:${device.id}`;
      const protectionId = protectionCreditById.get(authoredProtectionId) !== "none"
        ? authoredProtectionId
        : undefined;
      if (protectionId) protections.set(protectionId, {
        protection: device.currentProtection,
        credit: protectionCreditById.get(protectionId) ?? "none",
      });
      device.currentProtection.terminalPairs.forEach(([firstId, secondId]) => {
        const first = `${device.id}.${firstId}`;
        const second = `${device.id}.${secondId}`;
        const firstPort = device.conductors.find((port) => port.id === firstId);
        const secondPort = device.conductors.find((port) => port.id === secondId);
        if (endpointSet.has(first) && endpointSet.has(second)
          && firstPort?.kind === channel && secondPort?.kind === channel) {
          addPair(first, second, protectionId);
        }
      });
    }
  });
  return {
    edges,
    protections,
    sources: graph.currentSources.filter((source) => source.channel === channel),
  };
}

function r28Reachable(
  start: string,
  targets: ReadonlySet<string>,
  edges: readonly R28NetworkEdge[],
  excludedProtectionId?: string,
) {
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (excludedProtectionId !== undefined && edge.protectionId === excludedProtectionId) return;
    adjacency.set(edge.first, [...(adjacency.get(edge.first) ?? []), edge.second]);
    adjacency.set(edge.second, [...(adjacency.get(edge.second) ?? []), edge.first]);
  });
  const queue = [start];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    if (targets.has(current)) return true;
    visited.add(current);
    (adjacency.get(current) ?? []).forEach((next) => queue.push(next));
  }
  return false;
}

function r28ProtectionEnvelope(
  network: ReturnType<typeof buildR28CurrentNetwork>,
  sources: readonly R28Source[],
  targets: ReadonlySet<string>,
  verifiedOnly: boolean,
): { currentA: number | "unbounded"; protectedBy: readonly string[] } {
  const edges: CurrentNetworkEdge[] = network.edges.map((edge) => {
    const credited = edge.protectionId ? network.protections.get(edge.protectionId) : undefined;
    const receivesCredit = credited && (credited.credit === "verified"
      || (!verifiedOnly && credited.credit === "provisional"));
    return {
      ...edge,
      capacityA: receivesCredit
        ? credited.protection.ratedCurrentA
        : UNBOUNDED_CURRENT_A,
    };
  });
  const flowSources = sources.map((source) => ({
    id: source.id,
    vertex: currentVertex(source.endpoint, source.channel),
    capacityA: source.inherentCurrentLimit && (!verifiedOnly || source.inherentCurrentLimit.verified)
      ? source.inherentCurrentLimit.currentLimitA
      : UNBOUNDED_CURRENT_A,
  }));
  const result = maximumCurrentFlow(edges, flowSources, targets);
  return {
    currentA: result.currentA >= UNBOUNDED_CURRENT_A - 1
      ? "unbounded"
      : Number(result.currentA.toFixed(3)),
    protectedBy: [
      ...result.cutProtectionIds,
      ...result.cutSourceIds.map((sourceId) => `source:${sourceId}`),
    ].toSorted(),
  };
}

function r28ProspectiveFaultEnvelope(
  network: ReturnType<typeof buildR28CurrentNetwork>,
  sources: readonly R28Source[],
  targets: ReadonlySet<string>,
  excludedProtectionId?: string,
): number | "unbounded" {
  const edges: CurrentNetworkEdge[] = network.edges
    .filter((edge) => excludedProtectionId === undefined || edge.protectionId !== excludedProtectionId)
    .map((edge) => {
      const credited = edge.protectionId ? network.protections.get(edge.protectionId) : undefined;
      return {
        ...edge,
        // A breaker/fuse trip rating never limits prospective fault current.
        // Only a verified hard-current-limit is a physical source bound.
        capacityA: credited?.protection.kind === "hard-current-limit" && credited.credit === "verified"
          ? credited.protection.ratedCurrentA
          : UNBOUNDED_CURRENT_A,
      };
    });
  const result = maximumCurrentFlow(edges, sources.map((source) => {
    const publishedFault = source.shortCircuitCurrentA === "unbounded"
      ? UNBOUNDED_CURRENT_A
      : source.shortCircuitCurrentA;
    const inherent = source.inherentCurrentLimit?.verified
      ? source.inherentCurrentLimit.currentLimitA
      : UNBOUNDED_CURRENT_A;
    return {
      id: source.id,
      vertex: currentVertex(source.endpoint, source.channel),
      capacityA: Math.min(publishedFault, inherent),
    };
  }), targets);
  return result.currentA >= UNBOUNDED_CURRENT_A - 1
    ? "unbounded"
    : Number(result.currentA.toFixed(3));
}

/**
 * Fail-closed graph audit for current-path/OCP coordination.
 *
 * This deliberately does not infer load current from source capacity. A
 * breaker/fuse rating is per-source cut-set evidence against conductor
 * ampacity, never a cap on prospective fault current. Only an explicit,
 * verified inherent or series hard-current-limit can cap a contribution.
 */
export function verifyCurrentProtection(graph: SystemGraph): CurrentSafetyReport {
  const issues: CurrentSafetyIssue[] = [];
  const connectionChecks: CurrentSafetyConnectionCheck[] = [];
  const deviceChecks: CurrentSafetyDeviceCheck[] = [];
  const deviceById = new Map(graph.devices.map((device) => [device.id, device]));
  const cableById = new Map(graph.cables.map((cable) => [cable.id, cable]));
  const endpointById = new Map<string, Device["conductors"][number]>(graph.devices.flatMap((device) => (
    device.conductors.map((port) => [`${device.id}.${port.id}`, port] as const)
  )));
  const endpointSet = new Set(endpointById.keys());
  const issue = (finding: CurrentSafetyIssue) => issues.push(finding);

  const sourceSignature = (source: R28Source) => JSON.stringify([
    source.id,
    source.label,
    source.endpoint,
    source.channel,
    source.continuousCapacityA,
    source.peakCapacity?.currentA,
    source.peakCapacity?.durationSeconds,
    source.shortCircuitCurrentA,
    source.inherentCurrentLimit?.currentLimitA,
    source.inherentCurrentLimit?.verified,
    source.inherentCurrentLimit?.note,
    source.verified,
    source.basis,
    source.note,
  ]);
  const terminalSources = currentSourcesFromDevices(graph.devices);
  const terminalSourcesById = new Map<string, R28Source[]>();
  terminalSources.forEach((source) => terminalSourcesById.set(
    source.id,
    [...(terminalSourcesById.get(source.id) ?? []), source],
  ));
  terminalSources.forEach((terminalSource) => {
    const authoredMatches = graph.currentSources.filter((source) => (
      sourceSignature(source) === sourceSignature(terminalSource)
    ));
    if (authoredMatches.length === 1) return;
    issue({
      severity: "error",
      code: "invalid-current-metadata",
      sourceIds: [terminalSource.id],
      endpoint: terminalSource.endpoint,
      channel: terminalSource.channel,
      message: `${terminalSource.endpoint}: terminal-declared supply ${terminalSource.id} is missing or differs from the graph source inventory`,
    });
  });

  const endpointUseCount = new Map<string, number>();
  graph.connections.forEach((connection) => [connection.from, connection.to].forEach((endpoint) => {
    endpointUseCount.set(endpoint, (endpointUseCount.get(endpoint) ?? 0) + 1);
  }));
  graph.devices.forEach((device) => {
    const required = device.conductors.reduce((sum, port) => (
      sum + (endpointUseCount.get(`${device.id}.${port.id}`) ?? 0)
    ), 0);
    device.conductors.forEach((port) => {
      const endpoint = `${device.id}.${port.id}`;
      const landingUses = endpointUseCount.get(endpoint) ?? 0;
      if (port.sharedConnectionPolicy !== "warning" || landingUses <= 1) return;
      issue({
        severity: "warning", code: "terminal-over-capacity", deviceId: device.id, endpoint,
        message: `${endpoint}: ${landingUses} field connections share one warning-policy landing; ${device.id}: terminal capacity exceeded: ${required} required / ${device.conductors.length} available`,
      });
    });
  });

  graph.connections.forEach((connection) => {
    const cable = cableById.get(connection.cableId);
    if (connection.topologyRole === "terminal-join" && !r28IsIntrinsicTerminalJoin(graph, connection)) {
      issue({
        severity: "error", code: "invalid-current-metadata", connectionId: connection.id,
        message: `${connection.id}: terminal-join topology role does not connect a host landing to its attached wire-join device arm`,
      });
    }
    if (connection.kind === "multicore" && (!cable?.carriedChannels || cable.carriedChannels.length === 0)
      && !connection.deenergizedReason) {
      issue({
        severity: "error", code: "invalid-current-metadata", connectionId: connection.id,
        message: `${connection.id}: multicore power channels are not declared; add Cable.carriedChannels or an explicit de-energized reason`,
      });
    }
    const channels = connection.kind === "multicore"
      ? (cable?.carriedChannels ?? []).filter((kind): kind is CurrentSafetyChannel => (
        [...R28_ACTIVE_CHANNELS, ...R28_RETURN_CHANNELS].includes(kind as CurrentSafetyChannel)
      ))
      : [...R28_ACTIVE_CHANNELS, ...R28_RETURN_CHANNELS].includes(connection.kind as CurrentSafetyChannel)
        ? [connection.kind as CurrentSafetyChannel]
        : [];
    channels.filter((channel) => !r28ConnectionSupportsChannel(graph, connection, channel)).forEach((channel) => issue({
      severity: "error", code: "invalid-current-metadata", connectionId: connection.id, channel,
      message: `${connection.id}: connection endpoints do not both support the declared ${channel} power channel`,
    }));
  });

  const sourceIdCounts = new Map<string, number>();
  graph.currentSources.forEach((source) => sourceIdCounts.set(source.id, (sourceIdCounts.get(source.id) ?? 0) + 1));
  const validSourceIds = new Set<string>();
  graph.currentSources.forEach((source) => {
    const duplicate = (sourceIdCounts.get(source.id) ?? 0) > 1;
    const finiteContinuous = Number.isFinite(source.continuousCapacityA) && source.continuousCapacityA > 0;
    const peakCurrentA = source.peakCapacity?.currentA ?? source.continuousCapacityA;
    const validFault = source.shortCircuitCurrentA === "unbounded"
      || (Number.isFinite(source.shortCircuitCurrentA) && source.shortCircuitCurrentA > 0
        && source.shortCircuitCurrentA + 1e-9 >= peakCurrentA);
    const validPeak = !source.peakCapacity
      || (Number.isFinite(source.peakCapacity.currentA)
        && source.peakCapacity.currentA + 1e-9 >= source.continuousCapacityA
        && Number.isFinite(source.peakCapacity.durationSeconds) && source.peakCapacity.durationSeconds > 0);
    const validLimit = !source.inherentCurrentLimit
      || (Number.isFinite(source.inherentCurrentLimit.currentLimitA)
        && source.inherentCurrentLimit.currentLimitA + 1e-9 >= peakCurrentA
        && (source.shortCircuitCurrentA === "unbounded"
          || source.inherentCurrentLimit.currentLimitA <= source.shortCircuitCurrentA + 1e-9));
    const sourcePort = endpointById.get(source.endpoint);
    const validChannel = sourcePort?.kind === source.channel
      || (sourcePort?.kind === "multicore" && graph.connections.some((connection) => (
        (connection.from === source.endpoint || connection.to === source.endpoint)
        && r28ConnectionSupportsChannel(graph, connection, source.channel)
      )));
    const terminalDefinitions = terminalSourcesById.get(source.id) ?? [];
    const validTerminalInventory = terminalDefinitions.length === 1
      && sourceSignature(terminalDefinitions[0]) === sourceSignature(source);
    if (duplicate || !endpointSet.has(source.endpoint) || !validChannel || !finiteContinuous || !validFault || !validPeak || !validLimit
      || !validTerminalInventory) {
      issue({
        severity: "error", code: "invalid-current-metadata", sourceIds: [source.id], endpoint: source.endpoint, channel: source.channel,
        message: `${source.id}: invalid${duplicate ? " duplicate" : ""} source ratings, endpoint, or terminal-owned inventory`,
      });
    } else validSourceIds.add(source.id);
    if (!source.verified) issue({
      severity: "warning", code: "unverified-current-source", sourceIds: [source.id], endpoint: source.endpoint, channel: source.channel,
      prospectiveFaultCurrentA: source.shortCircuitCurrentA,
      message: `${source.id}: ${source.label} source envelope is not verified`,
    });
  });

  const returnChannelForActive = { positive: "negative", "ac-line": "ac-neutral" } as const;
  const sourceAssemblyRecords = graph.devices.flatMap((device) => (
    (device.currentSourceAssemblyPaths ?? []).map((path, index) => ({ device, path, index }))
  ));
  const assemblyMembersById = new Map<string, Set<string>>();
  sourceAssemblyRecords.forEach(({ device, path }) => {
    const members = assemblyMembersById.get(path.assemblyId) ?? new Set<string>();
    members.add(device.id);
    assemblyMembersById.set(path.assemblyId, members);
  });
  const sourceAssemblyMemberCounts = new Map<string, number>();
  sourceAssemblyRecords.forEach(({ device, path }) => {
    const memberKey = `${device.id}|${path.assemblyId}`;
    sourceAssemblyMemberCounts.set(memberKey, (sourceAssemblyMemberCounts.get(memberKey) ?? 0) + 1);
  });
  const validSourceAssemblyPathKeys = new Set<string>();
  sourceAssemblyRecords.forEach(({ device, path, index }) => {
    const [firstId, secondId] = path.terminalPair;
    const first = device.conductors.find((port) => port.id === firstId);
    const second = device.conductors.find((port) => port.id === secondId);
    const expectedReturn = returnChannelForActive[path.activeChannel];
    const validChannelPair = Boolean(expectedReturn) && Boolean(first) && Boolean(second)
      && firstId !== secondId
      && ((first!.kind === path.activeChannel && second!.kind === expectedReturn)
        || (second!.kind === path.activeChannel && first!.kind === expectedReturn));
    const members = assemblyMembersById.get(path.assemblyId) ?? new Set<string>();
    const hasValidAssemblySource = graph.currentSources.some((source) => (
      validSourceIds.has(source.id)
      && source.channel === path.activeChannel
      && members.has(source.endpoint.slice(0, source.endpoint.lastIndexOf(".")))
    ));
    const memberKey = `${device.id}|${path.assemblyId}`;
    const valid = path.assemblyId.trim().length > 0
      && (sourceAssemblyMemberCounts.get(memberKey) ?? 0) === 1
      && validChannelPair
      && hasValidAssemblySource;
    if (valid) {
      validSourceAssemblyPathKeys.add(r28SourceAssemblyPathKey(device.id, index));
      return;
    }
    issue({
      severity: "error", code: "invalid-current-metadata", deviceId: device.id,
      endpoint: first ? `${device.id}.${first.id}` : undefined,
      channel: path.activeChannel,
      message: `${device.id}: invalid or source-less ${path.assemblyId || "unnamed"} source-assembly path ${firstId}/${secondId}`,
    });
  });

  const currentDomainRecords = graph.devices.flatMap((device) => device.conductors.flatMap((port) => (
    port.currentDomain ? [{ device, port, endpoint: `${device.id}.${port.id}`, domain: port.currentDomain }] : []
  )));
  const currentDomainRecordsById = new Map<string, typeof currentDomainRecords>();
  currentDomainRecords.forEach((record) => currentDomainRecordsById.set(
    record.domain.id,
    [...(currentDomainRecordsById.get(record.domain.id) ?? []), record],
  ));
  const validCurrentDomains = new Map<string, {
    activeChannel: R28ActiveChannel;
    activeEndpoints: readonly string[];
    returnEndpoints: ReadonlySet<string>;
  }>();
  currentDomainRecordsById.forEach((records, domainId) => {
    const active = records.filter((record) => record.domain.role === "active");
    const returns = records.filter((record) => record.domain.role === "return");
    const activeChannels = new Set(active.map((record) => record.port.kind).filter((kind): kind is R28ActiveChannel => (
      R28_ACTIVE_CHANNELS.includes(kind as R28ActiveChannel)
    )));
    const activeChannel = activeChannels.size === 1 ? [...activeChannels][0] : undefined;
    const expectedReturn = activeChannel ? returnChannelForActive[activeChannel] : undefined;
    const valid = domainId.trim().length > 0
      && active.length > 0
      && returns.length > 0
      && records.length === active.length + returns.length
      && activeChannels.size === 1
      && active.every((record) => record.port.kind === activeChannel)
      && returns.every((record) => record.port.kind === expectedReturn);
    if (valid && activeChannel) {
      validCurrentDomains.set(domainId, {
        activeChannel,
        activeEndpoints: active.map((record) => record.endpoint).toSorted(),
        returnEndpoints: new Set(returns.map((record) => record.endpoint)),
      });
      return;
    }
    issue({
      severity: "error", code: "invalid-current-metadata",
      deviceId: records[0]?.device.id, endpoint: records[0]?.endpoint,
      message: `${domainId || "unnamed current domain"}: current domain requires matching active and return anchors in one DC or AC channel family`,
    });
  });

  const attachmentRootEndpoint = (initialEndpoint: string) => {
    let endpoint = initialEndpoint;
    const visited = new Set<string>();
    while (!visited.has(endpoint)) {
      visited.add(endpoint);
      const separator = endpoint.lastIndexOf(".");
      const device = deviceById.get(endpoint.slice(0, separator));
      if (!device?.attachment) break;
      endpoint = device.attachment.endpoint;
    }
    return endpoint;
  };
  const validAssemblyIdsAtEndpoint = (initialEndpoint: string, channel: CurrentSafetyChannel) => {
    const endpoint = attachmentRootEndpoint(initialEndpoint);
    const separator = endpoint.lastIndexOf(".");
    const device = deviceById.get(endpoint.slice(0, separator));
    const terminalId = endpoint.slice(separator + 1);
    if (!device || endpointById.get(endpoint)?.kind !== channel) return new Set<string>();
    return new Set((device.currentSourceAssemblyPaths ?? []).flatMap((path, index) => (
      validSourceAssemblyPathKeys.has(r28SourceAssemblyPathKey(device.id, index))
        && path.terminalPair.includes(terminalId)
        && (path.activeChannel === channel || returnChannelForActive[path.activeChannel] === channel)
        ? [path.assemblyId]
        : []
    )));
  };
  const validDomainIdsAtEndpoint = (
    initialEndpoint: string,
    role: "active" | "return",
    activeChannel: R28ActiveChannel,
  ) => {
    const endpoint = attachmentRootEndpoint(initialEndpoint);
    const terminal = endpointById.get(endpoint)?.currentDomain;
    if (!terminal || terminal.role !== role) return new Set<string>();
    const domain = validCurrentDomains.get(terminal.id);
    if (!domain || domain.activeChannel !== activeChannel) return new Set<string>();
    const declaredEndpoints = role === "active" ? new Set(domain.activeEndpoints) : domain.returnEndpoints;
    return declaredEndpoints.has(endpoint) ? new Set([terminal.id]) : new Set<string>();
  };
  const transparentPresentations = new Set([
    "cable-breakout",
    "wire-join",
    "service-splice",
    "rigid-rail",
    "wall-passthrough",
  ]);
  const connectionsByEndpoint = new Map<string, SystemGraph["connections"]>();
  graph.connections.forEach((connection) => [connection.from, connection.to].forEach((endpoint) => {
    connectionsByEndpoint.set(endpoint, [...(connectionsByEndpoint.get(endpoint) ?? []), connection]);
  }));
  const electricalOwnerIdsAtEndpoint = (
    initialEndpoint: string,
    channel: CurrentSafetyChannel,
    excludedConnectionIds: ReadonlySet<string>,
  ) => {
    const owners = new Set<string>();
    const queue = [initialEndpoint];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const endpoint = queue.shift()!;
      if (visited.has(endpoint)) continue;
      visited.add(endpoint);
      const separator = endpoint.lastIndexOf(".");
      const device = deviceById.get(endpoint.slice(0, separator));
      const terminalId = endpoint.slice(separator + 1);
      const terminal = device?.conductors.find((candidate) => candidate.id === terminalId);
      if (!device || !terminal) continue;
      const transparent = Boolean(device.attachment)
        || transparentPresentations.has(device.presentation ?? "");
      if (!transparent) {
        owners.add(device.id);
        continue;
      }
      if (device.attachment) queue.push(device.attachment.endpoint);
      const internalPeers = terminal.internalMates?.length
        ? terminal.internalMates
        : device.presentation === "service-splice"
          ? device.conductors.filter((candidate) => candidate.kind === terminal.kind).map((candidate) => candidate.id)
          : [];
      internalPeers.forEach((peerId) => {
        const peer = device.conductors.find((candidate) => candidate.id === peerId);
        if (!peer) return;
        const supportsChannel = (terminal.kind === channel || terminal.kind === "multicore")
          && (peer.kind === channel || peer.kind === "multicore");
        if (supportsChannel) queue.push(`${device.id}.${peer.id}`);
      });
      (connectionsByEndpoint.get(endpoint) ?? []).forEach((connection) => {
        if (excludedConnectionIds.has(connection.id)
          || !r28ConnectionSupportsChannel(graph, connection, channel)) return;
        queue.push(connection.from === endpoint ? connection.to : connection.from);
      });
    }
    return owners;
  };
  const setsIntersect = (first: ReadonlySet<string>, second: ReadonlySet<string>) => (
    [...first].some((entry) => second.has(entry))
  );
  const structurallyPairsReturn = (
    active: SystemGraph["connections"][number],
    returned: SystemGraph["connections"][number],
    activeChannel: R28ActiveChannel,
    returnChannel: (typeof R28_RETURN_CHANNELS)[number],
  ) => {
    const excluded = new Set([active.id, returned.id]);
    const endpointPair = (activeEndpoint: string, returnEndpoint: string) => (
      setsIntersect(
        electricalOwnerIdsAtEndpoint(activeEndpoint, activeChannel, excluded),
        electricalOwnerIdsAtEndpoint(returnEndpoint, returnChannel, excluded),
      )
      || setsIntersect(
        validAssemblyIdsAtEndpoint(activeEndpoint, activeChannel),
        validAssemblyIdsAtEndpoint(returnEndpoint, returnChannel),
      )
    );
    if (endpointPair(active.from, returned.from) || endpointPair(active.to, returned.to)) return true;
    const sameDomain = (activeEndpoint: string, returnEndpoint: string) => setsIntersect(
      validDomainIdsAtEndpoint(activeEndpoint, "active", activeChannel),
      validDomainIdsAtEndpoint(returnEndpoint, "return", activeChannel),
    );
    return sameDomain(active.from, returned.from) && sameDomain(active.to, returned.to);
  };

  const protectors: Array<{
    id: string;
    protection: R28Protection;
    deviceId?: string;
    connectionId?: string;
  }> = [
    ...graph.devices.flatMap((device) => device.currentProtection ? [{
      id: `device:${device.id}`, protection: device.currentProtection, deviceId: device.id,
    }] : []),
    ...graph.connections.flatMap((connection) => connection.currentProtection ? [{
      id: `connection:${connection.id}`, protection: connection.currentProtection, connectionId: connection.id,
    }] : []),
  ];
  const protectionCreditById = new Map<string, R28ProtectionCredit>();
  protectors.forEach(({ id, protection, deviceId, connectionId }) => {
    const validRating = Number.isFinite(protection.ratedCurrentA) && protection.ratedCurrentA > 0;
    const validInterrupt = protection.interruptRatingA === undefined
      || (Number.isFinite(protection.interruptRatingA) && protection.interruptRatingA > 0);
    const device = deviceId ? graph.devices.find((candidate) => candidate.id === deviceId) : undefined;
    const validPairs = !device || Boolean(protection.terminalPairs?.length)
      && protection.terminalPairs!.every(([first, second]) => {
        const firstPort = device.conductors.find((port) => port.id === first);
        const secondPort = device.conductors.find((port) => port.id === second);
        return first !== second && Boolean(firstPort) && Boolean(secondPort)
          && firstPort!.kind === secondPort!.kind
          && R28_ACTIVE_CHANNELS.includes(firstPort!.kind as R28ActiveChannel);
      });
    const metadataValid = validRating && validInterrupt && validPairs;
    const hasRequiredInterruptEvidence = protection.kind === "hard-current-limit"
      || protection.interruptRatingA !== undefined;
    protectionCreditById.set(id, !metadataValid
      ? "none"
      : protection.verified && hasRequiredInterruptEvidence ? "verified" : "provisional");
    if (!metadataValid) issue({
      severity: "error", code: "invalid-current-metadata", deviceId, connectionId, ratingA: protection.ratedCurrentA,
      message: `${id}: invalid protective rating, interrupt rating, or explicit terminal-pair metadata`,
    });
    if (!protection.verified) issue({
      severity: "warning", code: "unverified-protective-element", deviceId, connectionId, ratingA: protection.ratedCurrentA,
      message: `${id}: modeled ${protection.ratedCurrentA} A ${protection.kind} remains unverified`,
    });
    if (protection.kind !== "hard-current-limit" && protection.interruptRatingA === undefined) issue({
      severity: "warning", code: "missing-interrupt-rating", deviceId, connectionId, ratingA: protection.ratedCurrentA,
      message: `${id}: interrupt rating is not declared; fault-clearing capability remains outside this proof`,
    });
  });

  protectors.forEach(({ id, protection, deviceId, connectionId }) => {
    if (protection.kind === "hard-current-limit" || protection.interruptRatingA === undefined) return;
    R28_ACTIVE_CHANNELS.forEach((channel) => {
      const network = buildR28CurrentNetwork(graph, channel, protectionCreditById, validSourceAssemblyPathKeys);
      const protectedEdges = network.edges.filter((edge) => edge.protectionId === id);
      if (protectedEdges.length === 0) return;
      const prospectiveFaultCurrentA = r28ProspectiveFaultEnvelope(
        network,
        network.sources.filter((source) => validSourceIds.has(source.id)),
        new Set(protectedEdges.flatMap((edge) => [edge.first, edge.second])),
        id,
      );
      if (prospectiveFaultCurrentA === "unbounded") {
        if (protectionCreditById.get(id) === "verified") protectionCreditById.set(id, "provisional");
        issue({
          severity: "warning", code: "fault-current-unresolved", deviceId, connectionId, channel,
          prospectiveFaultCurrentA, ratingA: protection.interruptRatingA,
          message: `${id}: ${protection.interruptRatingA} A interrupt rating is declared, but source fault current is not yet bounded; this is an evidence hold, not proof that the rating is insufficient`,
        });
      } else if (prospectiveFaultCurrentA > protection.interruptRatingA! + 1e-9) {
        if (protectionCreditById.get(id) === "verified") protectionCreditById.set(id, "provisional");
        issue({
          severity: "error", code: "interrupt-rating-insufficient", deviceId, connectionId, channel,
          prospectiveFaultCurrentA, ratingA: protection.interruptRatingA,
          message: `${id}: ${protection.interruptRatingA} A interrupt rating is below the ${prospectiveFaultCurrentA} A prospective ${channel} contribution`,
        });
      }
    });
  });

  type ActiveTrace = {
    reachableSources: readonly R28Source[];
    evidence: readonly {
      source: R28Source;
      contribution: number | "unbounded";
      verifiedEnvelope: ReturnType<typeof r28ProtectionEnvelope>;
      provisionalEnvelope: ReturnType<typeof r28ProtectionEnvelope>;
    }[];
    verifiedProtectionEnvelopeA: number | "unbounded";
    provisionalProtectionEnvelopeA: number | "unbounded";
    prospectiveFaultCurrentA: number | "unbounded";
  };
  const activeTraces = new Map<string, ActiveTrace>();
  const traceTargets = (
    targets: ReadonlySet<string>,
    channel: R28ActiveChannel,
    network: ReturnType<typeof buildR28CurrentNetwork>,
  ): ActiveTrace => {
    const reachableSources = network.sources.filter((source) => (
      validSourceIds.has(source.id)
      && r28Reachable(currentVertex(source.endpoint, channel), targets, network.edges)
    ));
    const evidence = reachableSources.map((source) => ({
      source,
      contribution: r28ProspectiveFaultEnvelope(network, [source], targets),
      verifiedEnvelope: r28ProtectionEnvelope(network, [source], targets, true),
      provisionalEnvelope: r28ProtectionEnvelope(network, [source], targets, false),
    }));
    const verifiedEnvelope = r28ProtectionEnvelope(network, reachableSources, targets, true);
    const provisionalEnvelope = r28ProtectionEnvelope(network, reachableSources, targets, false);
    return {
      reachableSources,
      evidence,
      verifiedProtectionEnvelopeA: verifiedEnvelope.currentA,
      provisionalProtectionEnvelopeA: provisionalEnvelope.currentA,
      prospectiveFaultCurrentA: r28ProspectiveFaultEnvelope(network, reachableSources, targets),
    };
  };
  const currentEnvelopeValue = (value: number | "unbounded") => value === "unbounded"
    ? Number.POSITIVE_INFINITY
    : value;
  const worstEnvelope = (
    envelopes: readonly ReturnType<typeof r28ProtectionEnvelope>[],
  ): ReturnType<typeof r28ProtectionEnvelope> => {
    const maximum = Math.max(...envelopes.map((envelope) => currentEnvelopeValue(envelope.currentA)));
    const worst = envelopes.filter((envelope) => currentEnvelopeValue(envelope.currentA) === maximum);
    return {
      currentA: maximum === Number.POSITIVE_INFINITY ? "unbounded" : maximum,
      protectedBy: [...new Set(worst.flatMap((envelope) => envelope.protectedBy))].toSorted(),
    };
  };
  const combineConductorSideTraces = (traces: readonly ActiveTrace[]): ActiveTrace => {
    const reachableSourceById = new Map(traces.flatMap((trace) => trace.reachableSources)
      .map((source) => [source.id, source] as const));
    const evidence = [...reachableSourceById.values()].map((source) => {
      const paths = traces.flatMap((trace) => trace.evidence.filter((candidate) => candidate.source.id === source.id));
      const contribution = Math.max(...paths.map((path) => currentEnvelopeValue(path.contribution)));
      return {
        source,
        contribution: contribution === Number.POSITIVE_INFINITY ? "unbounded" as const : contribution,
        verifiedEnvelope: worstEnvelope(paths.map((path) => path.verifiedEnvelope)),
        provisionalEnvelope: worstEnvelope(paths.map((path) => path.provisionalEnvelope)),
      };
    });
    const verified = Math.max(...traces.map((trace) => currentEnvelopeValue(trace.verifiedProtectionEnvelopeA)));
    const provisional = Math.max(...traces.map((trace) => currentEnvelopeValue(trace.provisionalProtectionEnvelopeA)));
    const prospective = Math.max(...traces.map((trace) => currentEnvelopeValue(trace.prospectiveFaultCurrentA)));
    return {
      reachableSources: [...reachableSourceById.values()],
      evidence,
      verifiedProtectionEnvelopeA: verified === Number.POSITIVE_INFINITY ? "unbounded" : verified,
      provisionalProtectionEnvelopeA: provisional === Number.POSITIVE_INFINITY ? "unbounded" : provisional,
      prospectiveFaultCurrentA: prospective === Number.POSITIVE_INFINITY ? "unbounded" : prospective,
    };
  };
  const traceActive = (
    connection: SystemGraph["connections"][number],
    channel: R28ActiveChannel,
    network: ReturnType<typeof buildR28CurrentNetwork>,
  ) => {
    const middle = currentConnectionVertex(connection.id, channel);
    const endpointVertices = [currentVertex(connection.from, channel), currentVertex(connection.to, channel)];
    const conductorEdges = network.edges.filter((edge) => (
      (edge.first === middle && endpointVertices.includes(edge.second))
      || (edge.second === middle && endpointVertices.includes(edge.first))
    ));
    if (conductorEdges.length !== 2) return traceTargets(new Set([middle]), channel, network);
    const otherEdges = network.edges.filter((edge) => !conductorEdges.includes(edge));
    const sideTraces = conductorEdges.map((edge) => traceTargets(new Set([middle]), channel, {
      ...network,
      edges: [...otherEdges, edge],
    }));
    return combineConductorSideTraces(sideTraces);
  };

  const evaluate = (
    connection: SystemGraph["connections"][number],
    channel: CurrentSafetyChannel,
    trace: ActiveTrace,
    pairedActiveConnectionId?: string,
    pairedActiveEndpointIds?: readonly string[],
  ): CurrentSafetyConnectionCheck => {
    const ampacityA = cableById.get(connection.cableId)?.ampacityA;
    const protectionBySource = trace.evidence.map(({ source, contribution, verifiedEnvelope, provisionalEnvelope }) => {
      const verifiedBy = ampacityA !== undefined && verifiedEnvelope.currentA !== "unbounded"
        && verifiedEnvelope.currentA <= ampacityA + 1e-9 ? verifiedEnvelope.protectedBy : [];
      const provisionalBy = ampacityA !== undefined && provisionalEnvelope.currentA !== "unbounded"
        && provisionalEnvelope.currentA <= ampacityA + 1e-9 ? provisionalEnvelope.protectedBy : [];
      return { sourceId: source.id, prospectiveFaultCurrentA: contribution, verifiedBy, provisionalBy };
    });
    const verifiedEnvelopeFits = ampacityA !== undefined && trace.verifiedProtectionEnvelopeA !== "unbounded"
      && trace.verifiedProtectionEnvelopeA <= ampacityA + 1e-9;
    const provisionalEnvelopeFits = ampacityA !== undefined && trace.provisionalProtectionEnvelopeA !== "unbounded"
      && trace.provisionalProtectionEnvelopeA <= ampacityA + 1e-9;
    const calculatedStatus = ampacityA === undefined || !provisionalEnvelopeFits
      || protectionBySource.some((entry) => entry.verifiedBy.length === 0 && entry.provisionalBy.length === 0)
      ? "incomplete" as const
      : !verifiedEnvelopeFits || protectionBySource.some((entry) => entry.verifiedBy.length === 0)
        ? "provisional" as const
        : "verified" as const;
    const approvalDevicesValid = connection.protectionApproval?.protectionDeviceIds.every((deviceId) => (
      deviceById.get(deviceId)?.currentProtection?.kind === "breaker"
    )) ?? false;
    const protectionApproval = connection.protectionApproval && approvalDevicesValid
      ? connection.protectionApproval
      : undefined;
    if (connection.protectionApproval && !approvalDevicesValid) issue({
      severity: "error", code: "invalid-current-metadata", connectionId: connection.id, channel,
      message: `${connection.id}: accepted protection scheme references a missing or non-breaker protective device`,
    });
    const status = protectionApproval && calculatedStatus !== "verified"
      ? "accepted" as const
      : calculatedStatus;
    return {
      connectionId: connection.id,
      channel,
      sourceIds: trace.reachableSources.map((source) => source.id).toSorted(),
      pairedActiveConnectionId,
      pairedActiveEndpointIds,
      prospectiveFaultCurrentA: trace.prospectiveFaultCurrentA,
      verifiedProtectionEnvelopeA: trace.verifiedProtectionEnvelopeA,
      provisionalProtectionEnvelopeA: trace.provisionalProtectionEnvelopeA,
      ampacityA,
      status,
      protectionApproval,
      protectionBySource,
    };
  };

  const reportCheck = (check: CurrentSafetyConnectionCheck, connection: SystemGraph["connections"][number]) => {
    const cable = cableById.get(connection.cableId);
    if (connection.sourceLeadReason) issue({
      severity: "warning", code: "unprotected-source-lead", connectionId: connection.id, channel: check.channel,
      sourceIds: check.sourceIds, prospectiveFaultCurrentA: check.prospectiveFaultCurrentA, ratingA: check.ampacityA,
      message: `${connection.id} (${check.channel}): deliberately short source-side lead · ${connection.sourceLeadReason}`,
    });
    if (check.ampacityA === undefined) issue({
      severity: "error", code: "invalid-current-metadata", connectionId: connection.id, channel: check.channel,
      sourceIds: check.sourceIds, prospectiveFaultCurrentA: check.prospectiveFaultCurrentA,
      message: `${connection.id} (${check.channel}): ${cable?.label ?? connection.cableId} has no numeric ampacity`,
    });
    else if (check.protectionApproval) {
      issue({
        severity: "warning", code: "accepted-protection-scheme", connectionId: connection.id, channel: check.channel,
        sourceIds: check.sourceIds, prospectiveFaultCurrentA: check.prospectiveFaultCurrentA, ratingA: check.ampacityA,
        message: `${connection.id} (${check.channel}): accepted upstream protection scheme · ${check.protectionApproval.note}`,
      });
      return;
    }
    else if (connection.sourceLeadReason) {
      // A deliberately identified first-protector lead has a different failure
      // mode from an accidentally unprotected branch. Keep the explicit
      // shortest-practical/guarded installation warning, but do not duplicate
      // it as a generic conductor error.
      return;
    }
    else if (check.status === "incomplete") issue({
      severity: "error", code: "conductor-protection-incomplete", connectionId: connection.id, channel: check.channel,
      sourceIds: check.sourceIds, prospectiveFaultCurrentA: check.prospectiveFaultCurrentA, ratingA: check.ampacityA,
      message: `${connection.id} (${check.channel}): no per-source OCP/current-limit cut set coordinates every source with the ${check.ampacityA} A conductor`,
    });
    else if (check.status === "provisional") issue({
      severity: "warning", code: "conductor-protection-provisional", connectionId: connection.id, channel: check.channel,
      sourceIds: check.sourceIds, prospectiveFaultCurrentA: check.prospectiveFaultCurrentA, ratingA: check.ampacityA,
      message: `${connection.id} (${check.channel}): conductor coordination relies on at least one unverified or interrupt-unproved protective element`,
    });
  };

  const reportDevice = (
    device: Device,
    channel: CurrentSafetyChannel,
    trace: ActiveTrace,
  ) => {
    // Breaker/fuse trip values coordinate downstream conductors and are not
    // body ratings. Protective devices without an explicit body/input rating
    // are already covered by their terminal-pair and interrupt audit.
    const ratingA = device.currentRatingA;
    if (ratingA === undefined) {
      if (["busbar", "switch"].includes(device.kind)) issue({
        severity: "warning", code: "missing-device-rating", deviceId: device.id, channel,
        sourceIds: trace.reachableSources.map((source) => source.id).toSorted(),
        message: `${device.id}: energized ${channel} pass-through hardware has no declared continuous-current rating`,
      });
      return;
    }
    const protectionBySource = trace.evidence.map(({ source, contribution, verifiedEnvelope, provisionalEnvelope }) => ({
      sourceId: source.id,
      prospectiveFaultCurrentA: contribution,
      verifiedBy: ratingA !== undefined && verifiedEnvelope.currentA !== "unbounded"
        && verifiedEnvelope.currentA <= ratingA + 1e-9 ? verifiedEnvelope.protectedBy : [],
      provisionalBy: ratingA !== undefined && provisionalEnvelope.currentA !== "unbounded"
        && provisionalEnvelope.currentA <= ratingA + 1e-9 ? provisionalEnvelope.protectedBy : [],
    }));
    const provisionalFits = ratingA !== undefined && trace.provisionalProtectionEnvelopeA !== "unbounded"
      && trace.provisionalProtectionEnvelopeA <= ratingA + 1e-9;
    const verifiedFits = ratingA !== undefined && trace.verifiedProtectionEnvelopeA !== "unbounded"
      && trace.verifiedProtectionEnvelopeA <= ratingA + 1e-9;
    const status = ratingA === undefined || !provisionalFits
      || protectionBySource.some((entry) => entry.verifiedBy.length === 0 && entry.provisionalBy.length === 0)
      ? "incomplete" as const
      : !verifiedFits || protectionBySource.some((entry) => entry.verifiedBy.length === 0)
        ? "provisional" as const
        : "verified" as const;
    deviceChecks.push({
      deviceId: device.id, channel,
      sourceIds: trace.reachableSources.map((source) => source.id).toSorted(), ratingA, status,
      verifiedProtectionEnvelopeA: trace.verifiedProtectionEnvelopeA,
      provisionalProtectionEnvelopeA: trace.provisionalProtectionEnvelopeA,
      protectionBySource,
    });
    if (status === "incomplete") issue({
      severity: "error", code: "device-protection-incomplete", deviceId: device.id, channel, ratingA,
      sourceIds: trace.reachableSources.map((source) => source.id).toSorted(),
      message: `${device.id}: aggregate upstream protection envelope is not coordinated with the ${ratingA} A device/input rating`,
    }); else if (ratingA !== undefined && status === "provisional") issue({
      severity: "warning", code: "device-protection-provisional", deviceId: device.id, channel, ratingA,
      sourceIds: trace.reachableSources.map((source) => source.id).toSorted(),
      message: `${device.id}: device/input coordination relies on unverified protection metadata`,
    });
  };

  R28_ACTIVE_CHANNELS.forEach((channel) => {
    const network = buildR28CurrentNetwork(graph, channel, protectionCreditById, validSourceAssemblyPathKeys);
    graph.connections.forEach((connection) => {
      if (r28IsIntrinsicTerminalJoin(graph, connection)) return;
      if (!r28ConnectionCarries(graph, connection, channel)) return;
      const trace = traceActive(connection, channel, network);
      activeTraces.set(`${connection.id}:${channel}`, trace);
      if (trace.reachableSources.length === 0) {
        if (!connection.deenergizedReason) issue({
          severity: "error", code: "untraced-active-conductor", connectionId: connection.id, channel,
          message: `${connection.id}: energized ${channel} conductor is unreachable from every declared source`,
        });
        return;
      }
      const check = evaluate(connection, channel, trace);
      connectionChecks.push(check);
      reportCheck(check, connection);
    });

    graph.devices.forEach((device) => {
      const targets = new Set(graph.connections.filter((connection) => (
        r28ConnectionSupportsChannel(graph, connection, channel)
        && (connection.from.startsWith(`${device.id}.`) || connection.to.startsWith(`${device.id}.`))
      )).map((connection) => currentVertex(
        connection.from.startsWith(`${device.id}.`) ? connection.from : connection.to,
        channel,
      )));
      if (targets.size === 0) return;
      const trace = traceTargets(targets, channel, network);
      if (trace.reachableSources.length === 0) return;
      reportDevice(device, channel, trace);
    });
  });

  const activeForReturn = { negative: "positive", "ac-neutral": "ac-line" } as const;
  const connectionById = new Map(graph.connections.map((connection) => [connection.id, connection]));
  R28_RETURN_CHANNELS.forEach((channel) => {
    const activeChannel = activeForReturn[channel];
    const network = buildR28CurrentNetwork(graph, activeChannel, protectionCreditById, validSourceAssemblyPathKeys);
    const ratedReturnDeviceTargets = new Map<string, Set<string>>();
    graph.connections.forEach((connection) => {
      if (r28IsIntrinsicTerminalJoin(graph, connection)) return;
      if (!r28ConnectionCarries(graph, connection, channel)) return;
      const cable = cableById.get(connection.cableId);
      const selfPairedMulticore = connection.kind === "multicore"
        && cable?.carriedChannels?.includes(activeChannel)
        && r28ConnectionSupportsChannel(graph, connection, channel)
        && r28ConnectionSupportsChannel(graph, connection, activeChannel);
      const pairedActiveConnectionId = selfPairedMulticore ? connection.id : connection.returnFor;
      const pairedActive = pairedActiveConnectionId ? connectionById.get(pairedActiveConnectionId) : undefined;
      const validCircuitPair = selfPairedMulticore || Boolean(
        pairedActive
        && r28ConnectionSupportsChannel(graph, pairedActive, activeChannel)
        && connection.circuitId
        && connection.circuitId === pairedActive.circuitId
        && structurallyPairsReturn(pairedActive, connection, activeChannel, channel),
      );
      const domainMatches = new Map<string, (typeof validCurrentDomains extends Map<string, infer Value> ? Value : never)>();
      [connection.from, connection.to].forEach((endpoint) => {
        const domainTerminal = endpointById.get(endpoint)?.currentDomain;
        if (!domainTerminal || domainTerminal.role !== "return") return;
        const domain = validCurrentDomains.get(domainTerminal.id);
        if (domain?.activeChannel === activeChannel && domain.returnEndpoints.has(endpoint)) {
          domainMatches.set(domainTerminal.id, domain);
        }
      });
      const domain = domainMatches.size === 1 ? [...domainMatches.values()][0] : undefined;
      const validDomainPair = !pairedActiveConnectionId && domainMatches.size === 1;
      const activeTargets = validDomainPair && domain
        ? new Set(domain.activeEndpoints.map((endpoint) => currentVertex(endpoint, activeChannel)))
        : pairedActiveConnectionId && validCircuitPair
          ? new Set([currentConnectionVertex(pairedActiveConnectionId, activeChannel)])
          : new Set<string>();
      const trace = pairedActiveConnectionId && validCircuitPair
        ? activeTraces.get(`${pairedActiveConnectionId}:${activeChannel}`)
        : activeTargets.size > 0 ? traceTargets(activeTargets, activeChannel, network) : undefined;
      if ((!validCircuitPair && !validDomainPair) || !trace || trace.reachableSources.length === 0) {
        if (!connection.deenergizedReason) issue({
          severity: "error", code: "unpaired-return-conductor", connectionId: connection.id, channel,
          message: `${connection.id}: ${channel} conductor has no traced ${activeChannel} pairing with matching circuit identity and structural endpoint ownership, source assembly, or current-domain evidence`,
        });
        return;
      }
      const pairedActiveEndpointIds = validDomainPair ? domain?.activeEndpoints : undefined;
      const check = evaluate(connection, channel, trace, pairedActiveConnectionId, pairedActiveEndpointIds);
      connectionChecks.push(check);
      reportCheck(check, connection);
      [connection.from, connection.to].forEach((endpoint) => {
        const separator = endpoint.lastIndexOf(".");
        const deviceId = endpoint.slice(0, separator);
        if (graph.devices.find((device) => device.id === deviceId)?.currentRatingA === undefined) return;
        const key = `${deviceId}|${channel}`;
        const targets = ratedReturnDeviceTargets.get(key) ?? new Set<string>();
        activeTargets.forEach((target) => targets.add(target));
        ratedReturnDeviceTargets.set(key, targets);
      });
    });
    ratedReturnDeviceTargets.forEach((targets, key) => {
      const [deviceId] = key.split("|");
      const device = graph.devices.find((candidate) => candidate.id === deviceId);
      if (!device) return;
      const trace = traceTargets(targets, activeChannel, network);
      if (trace.reachableSources.length > 0) reportDevice(device, channel, trace);
    });
  });

  const issueOrder = (first: CurrentSafetyIssue, second: CurrentSafetyIssue) => (
    first.code.localeCompare(second.code)
    || (first.connectionId ?? "").localeCompare(second.connectionId ?? "")
    || (first.deviceId ?? "").localeCompare(second.deviceId ?? "")
    || (first.endpoint ?? "").localeCompare(second.endpoint ?? "")
    || (first.channel ?? "").localeCompare(second.channel ?? "")
    || first.message.localeCompare(second.message)
  );
  const warnings = issues.filter((finding) => finding.severity === "warning").toSorted(issueOrder);
  const errors = issues.filter((finding) => finding.severity === "error").toSorted(issueOrder);
  return {
    scope: "supply-active-and-explicitly-paired-returns",
    status: errors.length > 0
      ? "incomplete"
      : warnings.length > 0 ? "provisional" : "verified",
    excludedConductorKinds: ["earth", "data", "control", "multicore"],
    limitations: [
      "Normal operating demand is reported separately in graph.powerCircuits; this report checks fault/OCP paths and never mistakes source capacity for load current.",
      "A conductor fault is evaluated from each physical side of the conductor and compared using the worse side. Sources feeding opposite ends are not incorrectly summed through one cable cross-section; sources on the same side still aggregate.",
      "Prospective fault contribution is separate and is never capped by a breaker/fuse trip rating. Interrupt capacity, time-current curves, selectivity and let-through energy remain engineering inputs unless explicitly declared.",
      "A breaker/fuse can receive verified coordination credit only with valid, verified trip metadata and a declared adequate interrupt rating; otherwise it remains provisional or receives no credit.",
      "Negative and neutral conductors are checked only when returnFor has matching circuit identity plus structural endpoint/source-assembly evidence, when both route sides share validated typed current domains, when one typed domain anchors the return directly, or when a multicore explicitly carries both active and return channels.",
      "Multicore channels come only from Cable.carriedChannels; a sheath never implicitly merges DC, AC, return or neutral networks.",
      "Device/body coordination is checked only where currentRatingA is explicitly declared. An ordinary load's wattage is not treated as a protective-device rating; unrated pass-through bus/switch hardware remains an evidence warning.",
    ],
    sources: [...graph.currentSources],
    connections: connectionChecks.toSorted((first, second) => (
      first.connectionId.localeCompare(second.connectionId) || first.channel.localeCompare(second.channel)
    )),
    devices: deviceChecks.toSorted((first, second) => (
      first.deviceId.localeCompare(second.deviceId) || first.channel.localeCompare(second.channel)
    )),
    warnings,
    errors,
  };
}
