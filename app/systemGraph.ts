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
};

export type Cable = {
  id: string;
  label: string;
  cores: number;
  outsideDiameterMm: number;
  conductorSize: string;
  sheath: "single" | "white";
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
  junctionId: string;
  bundleId: string;
  position: Vec3;
  connectionIds: readonly string[];
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
  };
};

/** JSON-safe runtime emitted by scripts/generate-runtime.ts. Maps are rebuilt
 * in app/dseRuntime.ts; the expensive geometry/A* implementation is never
 * imported by a browser module. */
export type GraphRuntimeArtifact = {
  schemaVersion: 1;
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

export function titleCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\b(ac|dc|gx|lan|mppt|pe|pv|usb|ve)\b/gi, (word) => word.toUpperCase())
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
