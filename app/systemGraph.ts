export type Vec3 = readonly [number, number, number];

/**
 * Every resolved dimension and unrotated coordinate is represented on one
 * integer 10 mm half-cell lattice. A* advances exactly two units (20 mm)
 * everywhere—inside enclosures, in the room and outdoors—so geometry and
 * routing cannot drift onto unrelated floating-point grids.
 */
export const GEOMETRY_UNIT_M = 0.010;
export const JUNCTION_ROUTING_STEP_UNITS = 2;
export const WORLD_ROUTING_STEP_UNITS = 2;

export const geometryUnits = (metres: number) => Math.round(metres / GEOMETRY_UNIT_M);
export const geometryMetres = (units: number) => Number((units * GEOMETRY_UNIT_M).toFixed(7));
export const snapGeometry = (metres: number) => geometryMetres(geometryUnits(metres));
export const snapGeometryVec = (value: Vec3): Vec3 => value.map(snapGeometry) as unknown as Vec3;

export type ConductorKind =
  | "positive"
  | "negative"
  | "earth"
  | "data"
  | "ac-line"
  | "ac-neutral"
  | "control"
  /** One selectable physical port carrying two or more insulated cores. */
  | "multicore";

export type DeviceKind =
  | "panel"
  | "battery"
  | "breaker"
  | "busbar"
  | "converter"
  | "inverter"
  | "monitor"
  | "load"
  | "switch"
  | "connector"
  | "junction"
  | "protection"
  | "generator"
  | "earth";

export type Face = "top" | "bottom" | "left" | "right" | "front" | "back";

export type Surface = "wall" | "ceiling" | "floor" | "roof" | "outside-wall" | "outside";

/**
 * Canonical finite equipment-wall volume shared by routing and rendering.
 * Outside roof equipment may legitimately use either sign on the world Z
 * axis, so this physical slab—not a global Z plane—defines where a visible
 * cable would actually pass through the wall.
 */
export const EQUIPMENT_WALL_VOLUME = {
  center: [3.05, 1.78, -0.040] as Vec3,
  size: [6.35, 3.55, 0.035] as Vec3,
};

export type Conductor = {
  id: string;
  label: string;
  kind: ConductorKind;
  face: Face;
  /** Optional order along the selected face. Positions are otherwise automatic. */
  order?: number;
  /** Optional schematic edge. Physical terminal geometry still comes from
   * `face`; this keeps a panel junction lead or battery post physically honest
   * while allowing the wiring diagram to read consistently left-to-right. */
  diagramSide?: "input" | "output" | "neutral";
  /** Installed conductor size, when the landing is already defined. */
  gauge?: string;
  /** Physical terminal family: stud, screw clamp, plug, receptacle, etc. */
  terminal?: string;
  /** Manufacturer terminal capacity or physical thread/contact size. */
  terminalSize?: string;
  /** Field termination required at this endpoint. */
  termination?: string;
  /** True-scale visible contact diameter; the renderer applies a small legibility floor. */
  terminalDiameterMm?: number;
  /** Visible axial projection from the device body. */
  terminalLengthMm?: number;
  /** Source or received-part caveat attached to this individual landing. */
  terminalNote?: string;
  /** Intrinsic contacts inside a connector/device, not a field-installed wire. */
  internalMates?: readonly string[];
  optional?: boolean;
  /** A received terminal normally accepts one field conductor. `warning`
   * keeps multiple graph edges attached directly to the physical landing and
   * reports the stack as an unresolved installation warning instead of
   * inventing a splice or distribution component. */
  sharedConnectionPolicy?: "expand" | "warning" | "approved-stack";
  /** Supply metadata belongs to the physical output terminal. The graph-level
   * source inventory is derived from these declarations, which prevents a
   * real supply terminal from being silently omitted from traversal. */
  currentSource?: TerminalCurrentSource;
  /** One terminal can anchor an active or return side of a named current
   * domain. A return landing with this metadata is paired structurally to the
   * domain's active landing(s), rather than borrowing an unrelated branch by
   * connection ID. */
  currentDomain?: CurrentDomainTerminal;
};

export type ProcurementStatus = "purchased" | "existing" | "planned";

export type CurrentActiveChannel = "positive" | "ac-line";
export type CurrentReturnChannel = "negative" | "ac-neutral";
export type CurrentSafetyChannel = CurrentActiveChannel | CurrentReturnChannel;

export type CurrentDomainTerminal = {
  id: string;
  role: "active" | "return";
};

/** A galvanic path through one member of a series source assembly. The two
 * terminals remain opposite polarities electrically; this metadata says only
 * that current from the declared assembly source can traverse the source body
 * while the verifier follows series jumpers and intermediate taps. */
export type CurrentSourceAssemblyPath = {
  assemblyId: string;
  activeChannel: CurrentActiveChannel;
  terminalPair: readonly [string, string];
};

export type InherentCurrentLimit = {
  currentLimitA: number;
  verified: boolean;
  note?: string;
};

export type CurrentSource = {
  id: string;
  label: string;
  endpoint: string;
  channel: CurrentActiveChannel;
  /** Available operating capacity. This is source metadata, not downstream
   * demand, and is therefore never presented as conductor load current. */
  continuousCapacityA: number;
  /** Short-duration source capability, when the maker publishes one. */
  peakCapacity?: { currentA: number; durationSeconds: number };
  /** Prospective contribution into a fault. Breakers and fuses do not cap
   * this value; only an explicit verified inherent/hard current limit does. */
  shortCircuitCurrentA: number | "unbounded";
  inherentCurrentLimit?: InherentCurrentLimit;
  verified: boolean;
  basis: "electrochemical-source" | "photovoltaic-source" | "regulated-output" | "upstream-protected-source";
  note?: string;
};

export type TerminalCurrentSource = Omit<CurrentSource, "endpoint">;

export type CurrentProtection = {
  kind: "breaker" | "fuse" | "hard-current-limit";
  /** Breaker/fuse coordination rating, or a hard limiter's maximum output. */
  ratedCurrentA: number;
  verified: boolean;
  /** Device-local terminal pairs crossed by this protective element. A
   * connection-integrated protector does not use this field. */
  terminalPairs?: readonly (readonly [string, string])[];
  /** Prospective fault current the breaker/fuse can interrupt. It is kept
   * separate from the trip/rated current. */
  interruptRatingA?: number;
  note?: string;
};

export type Placement =
  | {
      space: "world";
      surface: Surface;
      /** Device centre in metres. The equipment wall is the x/y plane at z=0. */
      position: Vec3;
      /** Explicit Euler XYZ orientation; otherwise the surface supplies it. */
      rotation?: Vec3;
    }
  | {
      space: "junction";
      junctionId: string;
      /** In a bottom-DIN junction, DIN then power members share one declared
       * low band; backplate is the compact low-current band at the top. */
      section: "din" | "power" | "backplate" | "sidewall";
      order: number;
    };

export type Device = {
  id: string;
  label: string;
  subtitle?: string;
  kind: DeviceKind;
  /** Collision/routing envelope. Axis-aligned routable geometry stays on the
   * shared lattice so terminal launches and cable clearances remain exact. */
  size: Vec3;
  /** Received external dimensions used for visual rendering and inspection
   * when a verified shell does not land on the routing lattice. */
  physicalSize?: Vec3;
  placement: Placement;
  conductors: readonly Conductor[];
  componentId?: string;
  bomIds?: readonly string[];
  purchaseUrl?: string;
  technicalUrl?: string;
  status?: "purchased" | "existing" | "planned" | "hold";
  /** Procurement and commissioning are independent. `status: "hold"` can be
   * paired with `procurementStatus: "purchased"` for received equipment that
   * must remain de-energized pending verification. */
  procurementStatus?: ProcurementStatus;
  holdReason?: string;
  poles?: 1 | 2 | 3 | 4;
  color?: string;
  /** View-independent grouping hint for repeated physical families. Consumers
   * may arrange members in this declared column count without inferring IDs. */
  layoutGroup?: {
    id: string;
    label: string;
    columns: number;
    order: number;
  };
  /** Optional maker-derived pitch for terminals on a face. It must be an
   * integer multiple of the global route cell; this keeps large hardware such
   * as battery posts physically separated without per-device coordinates. */
  terminalPitchByFaceM?: Partial<Record<Face, number>>;
  /**
   * A bodyless connector anchored to a physical conductor. Its resolved
   * position and orientation are derived from that terminal, while placement
   * still identifies the world/enclosure routing space it belongs to.
   */
  attachment?: { endpoint: string };
  /** A continuous rigid rail whose selectable taps are anchored one cell from
   * collinear target terminals. Internal mates carry the electrical continuity. */
  railTargets?: Readonly<Record<string, string>>;
  /** Semantic physical presentation used by every view; never an ID-specific
   * rendering branch. Cable breakouts and wire joins keep graph identity
   * without introducing a rectangular device body; an integrated breakout
   * keeps its real device body and overlays the internal multicore split. */
  presentation?: "default" | "cable-breakout" | "integrated-cable-breakout" | "wire-join" | "service-splice" | "rigid-rail" | "wall-passthrough";
  /** Diagram-only bodyless fan/join presentation. The physical model retains
   * the real connector body and terminal construction. */
  diagramPresentation?: "join";
  /** Series protection automatically spans the powered terminals on this
   * device. Direction is graph-derived so non-polarized devices work in either
   * source orientation. */
  currentProtection?: CurrentProtection;
  /** Continuous current rating used by the current-safety traversal where the
   * hardware rating is known (notably distribution buses). */
  currentRatingA?: number;
  /** Explicit source-body paths. Members sharing an assembly ID must contain a
   * valid terminal-owned supply somewhere in that assembly; malformed or
   * source-less declarations are excluded from traversal and reported. */
  currentSourceAssemblyPaths?: readonly CurrentSourceAssemblyPath[];
};

export type Cable = {
  id: string;
  label: string;
  cores: number;
  outsideDiameterMm: number;
  conductorSize: string;
  sheath: "single" | "white";
  /** Installed circuit ampacity used by the graph safety verifier. */
  ampacityA?: number;
  /** Insulated electrical channels carried by a multicore sheath. */
  carriedChannels?: readonly Exclude<ConductorKind, "multicore">[];
  notes?: string;
};

export type Connection = {
  id: string;
  from: string;
  to: string;
  kind: ConductorKind;
  cableId: string;
  /** Conductors sharing one physical cable share a bundle and one gland. */
  bundleId?: string;
  label?: string;
  status?: "design" | "hold";
  holdReason?: string;
  /** Protection integrated into this particular lead, such as a supplied
   * fused equipment harness. */
  currentProtection?: CurrentProtection;
  /** A deliberately short conductor between a source/bus and its first
   * protective device. It remains a structured warning, never a silent pass. */
  sourceLeadReason?: string;
  /** A negative/neutral conductor borrows the upstream protective envelope of
   * this active connection. A multicore carrying both channels pairs itself
   * automatically. */
  returnFor?: string;
  /** Independently authored circuit identity shared by an active conductor
   * and its return. `returnFor` is rejected when these identities are absent
   * or differ, preventing an unrelated protected branch from being borrowed. */
  circuitId?: string;
  /** Explicit source-string series jumper. Its active-channel conductor
   * intentionally lands on one battery/module negative post; ordinary
   * positive wiring may not use a negative endpoint. */
  seriesLink?: true;
  /** Explicitly removes an optional or deliberately de-energized conductor
   * from energized-island coverage while retaining a structured reason. */
  deenergizedReason?: string;
  /** Geometry-only segment joining a physical terminal to an automatically
   * expanded wire-join body. It remains in electrical traversal as intrinsic
   * continuity, but is not a separately authored branch/return circuit. */
  topologyRole?: "terminal-join";
};

export type Junction = {
  id: string;
  deviceId: string;
  label: string;
  minimumSize: Vec3;
  padding: number;
  dinGap: number;
  backplateGap: number;
  glandSpacing: number;
  /** A received enclosure whose external dimensions and internal fit were
   * physically verified. Its authored device size is the finished shell size;
   * routing/layout must fit that envelope instead of enlarging the rendering. */
  sizePolicy?: "auto" | "verified-fixed";
  /** Declarative band policy; avoids enclosure-ID placement branches. */
  dinPosition?: "top" | "bottom";
};

export type SystemGraph = {
  id: string;
  label: string;
  revision: string;
  devices: readonly Device[];
  cables: readonly Cable[];
  connections: readonly Connection[];
  junctions: readonly Junction[];
  currentSources: readonly CurrentSource[];
};

export type ResolvedConductor = Conductor & {
  key: string;
  deviceId: string;
  position: Vec3;
  direction: Vec3;
};

export type ResolvedDevice = Device & {
  position: Vec3;
  size: Vec3;
  /** Euler XYZ rotation applied to both the body and its conductors. */
  rotation: Vec3;
  /** Generated world contacts for geometry-derived devices such as rigid rails. */
  resolvedConductorPositions?: Readonly<Record<string, Vec3>>;
  resolvedConductorDirections?: Readonly<Record<string, Vec3>>;
};

export type Gland = {
  id: string;
  /** Human-facing name derived from the external graph peer, independent of
   * gland order and terminal IDs. */
  label: string;
  junctionId: string;
  bundleId: string;
  position: Vec3;
  connectionIds: readonly string[];
};

export type CurrentSafetyIssue = {
  severity: "warning" | "error";
  code:
    | "invalid-current-metadata"
    | "unverified-current-source"
    | "unverified-protective-element"
    | "unprotected-source-lead"
    | "untraced-active-conductor"
    | "unpaired-return-conductor"
    | "missing-device-rating"
    | "missing-interrupt-rating"
    | "interrupt-rating-insufficient"
    | "conductor-protection-incomplete"
    | "conductor-protection-provisional"
    | "device-protection-incomplete"
    | "device-protection-provisional"
    | "terminal-over-capacity";
  message: string;
  sourceIds?: readonly string[];
  connectionId?: string;
  deviceId?: string;
  endpoint?: string;
  channel?: CurrentSafetyChannel;
  prospectiveFaultCurrentA?: number | "unbounded";
  ratingA?: number;
};

export type CurrentProtectionEvidence = {
  sourceId: string;
  prospectiveFaultCurrentA: number | "unbounded";
  verifiedBy: readonly string[];
  provisionalBy: readonly string[];
};

export type CurrentSafetyConnectionCheck = {
  connectionId: string;
  channel: CurrentSafetyChannel;
  sourceIds: readonly string[];
  pairedActiveConnectionId?: string;
  pairedActiveEndpointIds?: readonly string[];
  prospectiveFaultCurrentA: number | "unbounded";
  verifiedProtectionEnvelopeA: number | "unbounded";
  provisionalProtectionEnvelopeA: number | "unbounded";
  ampacityA?: number;
  status: "verified" | "provisional" | "incomplete";
  protectionBySource: readonly CurrentProtectionEvidence[];
};

export type CurrentSafetyDeviceCheck = {
  deviceId: string;
  channel: CurrentSafetyChannel;
  sourceIds: readonly string[];
  ratingA?: number;
  status: "verified" | "provisional" | "incomplete";
  verifiedProtectionEnvelopeA: number | "unbounded";
  provisionalProtectionEnvelopeA: number | "unbounded";
  protectionBySource: readonly CurrentProtectionEvidence[];
};

export type CurrentSafetyReport = {
  scope: "supply-active-and-explicitly-paired-returns";
  status: "verified" | "provisional" | "incomplete";
  excludedConductorKinds: readonly Exclude<ConductorKind, CurrentSafetyChannel>[];
  limitations: readonly string[];
  sources: readonly CurrentSource[];
  connections: readonly CurrentSafetyConnectionCheck[];
  devices: readonly CurrentSafetyDeviceCheck[];
  warnings: readonly CurrentSafetyIssue[];
  errors: readonly CurrentSafetyIssue[];
};

export type RoutedConnection = Connection & {
  points: readonly Vec3[];
  lengthM: number;
  diameterMm: number;
  routed: boolean;
  /** Zero-based, diameter-descending serial solve precedence. */
  routingRank: number;
};

export type GraphRuntime = {
  graph: SystemGraph;
  devices: readonly ResolvedDevice[];
  deviceById: ReadonlyMap<string, ResolvedDevice>;
  conductors: readonly ResolvedConductor[];
  conductorByKey: ReadonlyMap<string, ResolvedConductor>;
  glands: readonly Gland[];
  routes: readonly RoutedConnection[];
  routeById: ReadonlyMap<string, RoutedConnection>;
  diagnostics: {
    buildMs: number;
    /** Cold geometry plus serial voxel solve, before rendered-curve audit. */
    routingMs: number;
    /** Offline exact TubeGeometry/Y centreline certification time. */
    renderedAuditMs: number;
    /** Time spent rebuilding Map indexes from a precomputed public artifact. */
    hydrateMs: number;
    /** Distinguishes the cold test/CLI solver from the browser's static artifact. */
    source: "solver" | "precomputed";
    /** UTF-8 byte size of the static artifact, when precomputed. */
    artifactBytes: number;
    routed: number;
    fallbacks: number;
    occupiedCells: number;
    centerlineConflicts: number;
    sweptCableConflicts: number;
    selfIntersections: number;
    deviceConflicts: number;
    /** Conflicts after applying the exact rounded TubeGeometry/Y centrelines. */
    renderedGeometryConflicts: number;
    totalLengthM: number;
    totalTurns: number;
    routingOrder: readonly string[];
    /** Deterministic graph/max-flow proof over every declared supply. */
    currentSafety: CurrentSafetyReport;
  };
};

/** JSON-safe runtime emitted by scripts/generate-runtime.ts. Maps are rebuilt
 * in app/dseRuntime.ts; the expensive geometry/A* implementation is never
 * imported by a browser module. */
export type GraphRuntimeArtifact = {
  schemaVersion: 2;
  generatorVersion: string;
  sourceHash: string;
  graphId: string;
  graphRevision: string;
  devices: readonly ResolvedDevice[];
  conductors: readonly ResolvedConductor[];
  glands: readonly Gland[];
  routes: readonly RoutedConnection[];
  diagnostics: Omit<GraphRuntime["diagnostics"], "buildMs" | "hydrateMs" | "source" | "artifactBytes">;
};

export type GraphSelection =
  | { type: "device"; deviceId: string }
  | { type: "conductor"; conductorKey: string; connectionId?: string };

export const conductorColor: Record<ConductorKind, string> = {
  positive: "#dc2626",
  negative: "#111827",
  earth: "#16a34a",
  data: "#2563eb",
  "ac-line": "#dc2626",
  "ac-neutral": "#111827",
  control: "#2563eb",
  multicore: "#f8fafc",
};

const genericTerminalByKind: Record<ConductorKind, Pick<Conductor,
  "terminal" | "terminalSize" | "termination" | "terminalDiameterMm" | "terminalLengthMm" | "terminalNote"
>> = {
  positive: {
    terminal: "Device power terminal",
    terminalSize: "Verify on received device",
    termination: "Match terminal after measurement",
    terminalDiameterMm: 5,
    terminalLengthMm: 10,
    terminalNote: "Generic fallback only; the received terminal governs.",
  },
  negative: {
    terminal: "Device power terminal",
    terminalSize: "Verify on received device",
    termination: "Match terminal after measurement",
    terminalDiameterMm: 5,
    terminalLengthMm: 10,
    terminalNote: "Generic fallback only; the received terminal governs.",
  },
  earth: {
    terminal: "Protective-earth landing",
    terminalSize: "Verify on received device",
    termination: "Closed ring or accepted clamp termination",
    terminalDiameterMm: 5,
    terminalLengthMm: 10,
    terminalNote: "Use the equipment maker's PE terminal and qualified-installer torque.",
  },
  data: {
    terminal: "Factory data receptacle",
    terminalSize: "Mating factory plug",
    termination: "No field crimp",
    terminalDiameterMm: 6,
    terminalLengthMm: 9,
    terminalNote: "Use the specified complete data lead.",
  },
  "ac-line": {
    terminal: "AC screw/clamp terminal",
    terminalSize: "Verify on received device",
    termination: "Bootlace ferrule only if terminal maker accepts it",
    terminalDiameterMm: 5,
    terminalLengthMm: 10,
    terminalNote: "Active core is rendered red in this design language.",
  },
  "ac-neutral": {
    terminal: "AC screw/clamp terminal",
    terminalSize: "Verify on received device",
    termination: "Bootlace ferrule only if terminal maker accepts it",
    terminalDiameterMm: 5,
    terminalLengthMm: 10,
    terminalNote: "Neutral is rendered black and remains electrically distinct from PE.",
  },
  control: {
    terminal: "Low-current control terminal",
    terminalSize: "Verify on received device",
    termination: "Bootlace ferrule if accepted",
    terminalDiameterMm: 3.5,
    terminalLengthMm: 8,
    terminalNote: "Blue identifies data/control, not a power return.",
  },
  multicore: {
    terminal: "Multicore cable / factory connector",
    terminalSize: "Complete mating cable",
    termination: "No exposed single-core termination",
    terminalDiameterMm: 8,
    terminalLengthMm: 12,
    terminalNote: "White represents the complete outer sheath; core colors appear only at an exposed breakout.",
  },
};

export function conductor(
  id: string,
  label: string,
  kind: ConductorKind,
  face: Face,
  options: Omit<Conductor, "id" | "label" | "kind" | "face"> = {},
): Conductor {
  return { id, label, kind, face, ...genericTerminalByKind[kind], ...options };
}

export function connection(
  id: string,
  from: string,
  to: string,
  kind: ConductorKind,
  cableId: string,
  options: Omit<Connection, "id" | "from" | "to" | "kind" | "cableId"> = {},
): Connection {
  return { id, from, to, kind, cableId, ...options };
}

export function endpoint(deviceId: string, conductorId: string) {
  return `${deviceId}.${conductorId}`;
}

/** Build the traversal inventory from terminal-owned supply declarations.
 * Callers never maintain a second hand-authored list of source endpoints. */
export function currentSourcesFromDevices(devices: readonly Device[]): readonly CurrentSource[] {
  return devices.flatMap((device) => device.conductors.flatMap((port) => (
    port.currentSource ? [{ ...port.currentSource, endpoint: endpoint(device.id, port.id) }] : []
  )));
}

export function titleCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\b(ac|dc|gx|lan|mppt|pe|pv|usb|ve)\b/gi, (word) => word.toUpperCase())
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isPurchasedDevice(device: Pick<Device, "procurementStatus" | "status">) {
  return device.procurementStatus === "purchased" || device.status === "purchased";
}

function endpointParts(endpointId: string) {
  const separator = endpointId.lastIndexOf(".");
  return separator < 0
    ? { deviceId: endpointId, conductorId: "" }
    : { deviceId: endpointId.slice(0, separator), conductorId: endpointId.slice(separator + 1) };
}

function isDisplayTransparent(device: Device) {
  return Boolean(device.attachment)
    || [
      "cable-breakout",
      "wire-join",
      "service-splice",
      "rigid-rail",
      "wall-passthrough",
    ].includes(device.presentation ?? "");
}

type DisplayChannel = Exclude<ConductorKind, "multicore">;
type DisplayFlow = "forward" | "reverse" | "either";

type DisplayTraversalState = {
  endpointId: string;
  /** A multicore sheath carries this one logical core while the naming walk
   * crosses breakouts and penetrations. Leaving this undefined means the walk
   * is describing the complete cable, so it must not fan into sibling cores. */
  channel?: DisplayChannel;
  /** Graph connection orientation is authored supply-to-load (including
   * returns). Once the walk leaves the inspected edge, retain that direction
   * instead of wandering back through an adjacent branch. */
  flow: DisplayFlow;
};

function displayChannelsAtEndpoint(graph: SystemGraph, endpointId: string) {
  const { deviceId, conductorId } = endpointParts(endpointId);
  const device = graph.devices.find((candidate) => candidate.id === deviceId);
  const conductor = device?.conductors.find((candidate) => candidate.id === conductorId);
  if (!conductor || conductor.kind !== "multicore") return [];
  const cableById = new Map(graph.cables.map((cable) => [cable.id, cable]));
  const declared = (conductor.internalMates ?? []).flatMap((mateId) => {
    const mate = device?.conductors.find((candidate) => candidate.id === mateId);
    return mate && mate.kind !== "multicore" ? [mate.kind] : [];
  });
  const cableChannels = graph.connections.flatMap((connection) => (
    connection.from === endpointId || connection.to === endpointId
      ? cableById.get(connection.cableId)?.carriedChannels ?? []
      : []
  ));
  return [...new Set([...declared, ...cableChannels])].toSorted();
}

function internalDisplayPeers(
  device: Device,
  conductorId: string,
  carriedChannel?: DisplayChannel,
): { conductorId: string; channel?: DisplayChannel }[] {
  const conductor = device.conductors.find((candidate) => candidate.id === conductorId);
  if (!conductor) return [];
  const declared = conductor?.internalMates?.filter((mateId) => (
    device.conductors.some((candidate) => candidate.id === mateId)
  )) ?? [];
  const peers = declared.length > 0
    ? declared.map((mateId) => device.conductors.find((candidate) => candidate.id === mateId)!)
    : device.presentation === "service-splice"
      ? device.conductors
      .filter((candidate) => candidate.id !== conductorId && candidate.kind === conductor?.kind)
      : [];

  const channel = conductor.kind === "multicore" ? carriedChannel : conductor.kind;
  return peers.flatMap((peer) => {
    if (peer.kind === "multicore") {
      return [{ conductorId: peer.id, channel }];
    }
    // A concrete core may enter its shared sheath, but that sheath may only
    // emerge through the same electrical channel. An untyped whole-cable walk
    // deliberately stays on multicore ports rather than visiting every core.
    if (!channel || peer.kind !== channel) return [];
    return [{ conductorId: peer.id, channel }];
  });
}

function walkEndpointOwnerLabels(
  graph: SystemGraph,
  endpointId: string,
  excludedConnectionIds: ReadonlySet<string>,
  initialChannel?: DisplayChannel,
) {
  const deviceById = new Map(graph.devices.map((device) => [device.id, device]));
  const initialDeviceId = endpointParts(endpointId).deviceId;
  const connectionsByEndpoint = new Map<string, Connection[]>();
  graph.connections.forEach((connection) => {
    [connection.from, connection.to].forEach((endpoint) => {
      connectionsByEndpoint.set(endpoint, [...(connectionsByEndpoint.get(endpoint) ?? []), connection]);
    });
  });
  const excludedAtEndpoint = graph.connections.filter((connection) => (
    excludedConnectionIds.has(connection.id)
      && (connection.from === endpointId || connection.to === endpointId)
  ));
  const initialDevice = deviceById.get(initialDeviceId);
  const traverseInitialAttachment = Boolean(initialDevice?.attachment && excludedAtEndpoint.some((connection) => (
    (connection.from === initialDevice.attachment!.endpoint && connection.to === endpointId)
    || (connection.to === initialDevice.attachment!.endpoint && connection.from === endpointId)
  )));
  const initialFlows = new Set(excludedAtEndpoint.map((connection): DisplayFlow => (
    connection.to === endpointId ? "forward" : "reverse"
  )));
  const initialFlow: DisplayFlow = initialFlows.size === 1 ? [...initialFlows][0] : "either";
  const queue: DisplayTraversalState[] = [{
    endpointId,
    channel: initialChannel,
    flow: initialFlow,
  }];
  const visited = new Set<string>();
  const labels = new Set<string>();
  const queueConnectionPeers = (state: DisplayTraversalState) => {
    (connectionsByEndpoint.get(state.endpointId) ?? []).forEach((connection) => {
      if (excludedConnectionIds.has(connection.id)) return;
      const followsForward = connection.from === state.endpointId;
      if (state.flow === "forward" && !followsForward) return;
      if (state.flow === "reverse" && followsForward) return;
      const connectionChannel = connection.kind === "multicore" ? state.channel : connection.kind;
      if (state.channel && connection.kind !== "multicore" && connection.kind !== state.channel) return;
      queue.push({
        endpointId: followsForward ? connection.to : connection.from,
        channel: connectionChannel,
        flow: state.flow === "either" ? (followsForward ? "forward" : "reverse") : state.flow,
      });
    });
  };
  const traversalStateLimit = graph.devices.reduce((sum, device) => sum + device.conductors.length, 0) * 6;
  while (queue.length > 0 && visited.size < traversalStateLimit) {
    const current = queue.shift()!;
    const visitKey = `${current.endpointId}|${current.channel ?? "whole-cable"}|${current.flow}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    const { deviceId, conductorId } = endpointParts(current.endpointId);
    const device = deviceById.get(deviceId);
    if (!device) continue;
    if (!isDisplayTransparent(device)) {
      labels.add(device.label);
      continue;
    }
    const enteredFromAttachment = current.endpointId === endpointId && traverseInitialAttachment;
    if (device.attachment) {
      const attachmentOwner = deviceById.get(endpointParts(device.attachment.endpoint).deviceId);
      if (attachmentOwner && !isDisplayTransparent(attachmentOwner)) {
        labels.add(attachmentOwner.label);
        if (device.id !== initialDeviceId || !traverseInitialAttachment) continue;
        // Direction and channel are retained while crossing the join. This
        // exposes the remote equipment from the host-side device link without
        // allowing a branch walk to reverse into a sibling circuit. A second
        // attached join is already meaningful remote equipment, so it ends
        // this arm instead of expanding an entire daisy chain into the label.
      }
    }
    internalDisplayPeers(device, conductorId, current.channel).forEach((peer) => {
      queue.push({
        endpointId: `${device.id}.${peer.conductorId}`,
        channel: peer.channel,
        // The host-to-join link terminates at the centre of a physical splice.
        // From that one centre landing, every other arm is remote regardless
        // of how its circuit edge is authored. Walk each arm outward, then
        // lock to that arm's direction at its first external connection.
        flow: enteredFromAttachment ? "either" : current.flow,
      });
    });
    queueConnectionPeers(current);
  }
  return [...labels].toSorted();
}

/** Resolve the meaningful equipment at one side of a route while collapsing
 * purely topological joins, cable breakouts and wall penetrations. A whole
 * multicore cable is evaluated once per declared electrical channel; only
 * owners common to every channel are returned. This reaches a common device
 * such as a MultiPlus without ever crossing from one sibling core to another. */
export function graphEndpointOwnerLabels(
  graph: SystemGraph,
  endpointId: string,
  excludedConnectionIds: ReadonlySet<string> = new Set(),
) {
  const { deviceId, conductorId } = endpointParts(endpointId);
  const conductor = graph.devices.find((device) => device.id === deviceId)
    ?.conductors.find((candidate) => candidate.id === conductorId);
  if (!conductor) return [];
  if (conductor.kind !== "multicore") {
    return walkEndpointOwnerLabels(graph, endpointId, excludedConnectionIds, conductor.kind);
  }
  const channels = displayChannelsAtEndpoint(graph, endpointId);
  if (channels.length === 0) return walkEndpointOwnerLabels(graph, endpointId, excludedConnectionIds);
  const labelsByChannel = channels.map((channel) => (
    new Set(walkEndpointOwnerLabels(graph, endpointId, excludedConnectionIds, channel))
  ));
  if (labelsByChannel.some((labels) => labels.size === 0)) return [];
  return [...labelsByChannel[0]].filter((label) => (
    labelsByChannel.every((labels) => labels.has(label))
  )).toSorted();
}

const automaticConductorRole: Record<ConductorKind, string> = {
  positive: "positive terminal",
  negative: "negative return",
  earth: "protective earth",
  data: "data port",
  "ac-line": "active terminal",
  "ac-neutral": "neutral terminal",
  control: "control terminal",
  multicore: "cable connection",
};

/** Human-facing terminal name generated from graph peers. When no meaningful
 * external owner resolves (for example an internal breakout core or a genuine
 * spare), preserve the authored semantic terminal name instead of exposing an
 * implementation id. */
export function graphEndpointDisplayLabel(graph: SystemGraph, endpointId: string) {
  const { deviceId, conductorId } = endpointParts(endpointId);
  const device = graph.devices.find((candidate) => candidate.id === deviceId);
  const conductor = device?.conductors.find((candidate) => candidate.id === conductorId);
  if (!device || !conductor) return titleCase(endpointId);
  const attached = graph.connections.filter((connection) => (
    connection.from === endpointId || connection.to === endpointId
  ));
  if (isDisplayTransparent(device) && device.attachment && attached.length === 1) {
    return graphConnectionDisplayLabel(graph, attached[0]);
  }
  const peerLabels = new Set<string>();
  attached.forEach((connection) => {
    const peer = connection.from === endpointId ? connection.to : connection.from;
    graphEndpointOwnerLabels(graph, peer, new Set([connection.id])).forEach((label) => peerLabels.add(label));
  });
  let resolvedThroughSelf = false;
  if (peerLabels.size === 0 && isDisplayTransparent(device) && conductor.kind === "multicore" && attached.length > 0) {
    graphEndpointOwnerLabels(graph, endpointId, new Set(attached.map((connection) => connection.id)))
      .forEach((label) => peerLabels.add(label));
    resolvedThroughSelf = peerLabels.size > 0;
  }
  const labels = [...peerLabels].filter((label) => label !== device.label).toSorted();
  if (labels.length === 0) return conductor.label || automaticConductorRole[conductor.kind];
  const compact = conductor.sharedConnectionPolicy === "approved-stack"
    ? labels.join(" / ")
    : labels.length <= 2 ? labels.join(" / ") : `${labels.slice(0, 2).join(" / ")} +${labels.length - 2}`;
  const outgoing = attached.filter((connection) => connection.from === endpointId).length;
  const incoming = attached.filter((connection) => connection.to === endpointId).length;
  const connectsViaAttachment = attached.some((connection) => {
    const peer = connection.from === endpointId ? connection.to : connection.from;
    const peerDevice = graph.devices.find((candidate) => candidate.id === endpointParts(peer).deviceId);
    return peerDevice?.attachment?.endpoint === endpointId;
  });
  const relation = connectsViaAttachment
    ? "Connected to"
    : resolvedThroughSelf
      ? incoming > 0 && outgoing === 0 ? "To" : outgoing > 0 && incoming === 0 ? "From" : "Connected to"
      : outgoing > 0 && incoming === 0 ? "To" : incoming > 0 && outgoing === 0 ? "From" : "Connected to";
  return `${relation} ${compact}`;
}

/** Stable route title derived from meaningful endpoint owners rather than a
 * hand-maintained alias or implementation ID. */
export function graphConnectionDisplayLabel(graph: SystemGraph, connection: Connection) {
  const excluded = new Set([connection.id]);
  const ownerLabels = (endpointId: string) => {
    const logical = graphEndpointOwnerLabels(graph, endpointId, excluded);
    if (logical.length > 0) return logical;
    const { deviceId } = endpointParts(endpointId);
    return [graph.devices.find((device) => device.id === deviceId)?.label ?? titleCase(deviceId)];
  };
  const fromOwners = ownerLabels(connection.from);
  const toOwners = ownerLabels(connection.to);
  const fromSet = new Set(fromOwners);
  const toSet = new Set(toOwners);
  const distinctFrom = fromOwners.filter((label) => !toSet.has(label));
  const distinctTo = toOwners.filter((label) => !fromSet.has(label));
  return `${(distinctFrom.length > 0 ? distinctFrom : fromOwners).join(" / ")} → `
    + `${(distinctTo.length > 0 ? distinctTo : toOwners).join(" / ")} · ${titleCase(connection.kind)}`;
}
