"use client";

import {
  lazy,
  Suspense,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dseRaw from "@/data/dse-system.json";
import pgRaw from "@/data/pg-system.json";

const SystemModel3D = lazy(() =>
  import("./SystemModel3D").then((module) => ({ default: module.SystemModel3D })),
);

type FlowType =
  | "all"
  | "solar"
  | "battery"
  | "dc12"
  | "ac"
  | "generator"
  | "data"
  | "earth"
  | "control";

type ComponentKind =
  | "solar"
  | "battery"
  | "protection"
  | "conversion"
  | "generator"
  | "loadAc"
  | "loadDc"
  | "distribution"
  | "control"
  | "earth"
  | "structure"
  | "alternate";

type ComponentData = {
  id: string;
  title: string;
  kicker: string;
  kind: ComponentKind;
  summary: string;
  specs: string[];
  note?: string;
  sourceUrl?: string;
};

type DiagramNode = {
  id: string;
  x: number;
  y: number;
  featured?: boolean;
};

type DiagramEdge = {
  id: string;
  from: string;
  to: string;
  type: Exclude<FlowType, "all">;
  label: string;
  portOffset?: number;
  waypoints?: Array<{ x: number; y: number }>;
  labelAt?: { x: number; y: number };
};

type DiagramRegion = {
  id: string;
  label: string;
  memberIds: string[];
};

type DiagramView = {
  label: string;
  canvas: { width: number; height: number };
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  regions?: DiagramRegion[];
};

type BomItem = {
  id: string;
  category: string;
  item: string;
  qty: number;
  unit: string;
  unitCost: number;
  currency: "USD" | "FJD";
  totalUsd: number;
  location: string;
  procurement: string;
  priority: string;
  description: string;
  productUrl?: string;
  specUrl?: string;
  includedInTotal?: boolean;
};

type SystemData = {
  id: "dse" | "pg";
  shortName: string;
  name: string;
  subtitle: string;
  location: string;
  revision: string;
  status: string;
  summary: string;
  currency: { base: string; fjdPerUsd: number; note: string };
  budget: {
    targetUsd: number;
    targetBasis?: "total" | "remaining";
    donorFundedIncrementUsd?: number;
    contingencyIncluded: boolean;
    note: string;
  };
  keyFacts: Array<{ label: string; value: string; detail: string }>;
  powerModel: {
    nominalBatteryKwh: number;
    usableBatteryKwh: number;
    averageSolarKwhDay: number | null;
    assumptions: string;
  };
  components: ComponentData[];
  diagram: {
    singleLineNote: string;
    views: { overview: DiagramView; detail: DiagramView };
  };
  bom: BomItem[];
  operatingRules: string[];
  commissioning: string[];
  research: Array<{ title: string; publisher: string; url: string }>;
};

const systems: Record<"dse" | "pg", SystemData> = {
  dse: dseRaw as SystemData,
  pg: pgRaw as SystemData,
};

const NODE_W = 226;
const NODE_H = 104;

const flowMeta: Array<{
  id: FlowType;
  label: string;
  shortLabel: string;
}> = [
  { id: "all", label: "All circuits", shortLabel: "All" },
  { id: "solar", label: "PV circuit", shortLabel: "PV" },
  { id: "battery", label: "Battery circuit", shortLabel: "Battery" },
  { id: "dc12", label: "Regulated DC", shortLabel: "12 V DC" },
  { id: "ac", label: "AC output", shortLabel: "230 V AC" },
  { id: "generator", label: "Generator input", shortLabel: "Generator" },
  { id: "data", label: "Data", shortLabel: "Data" },
  { id: "earth", label: "Earth / bonding", shortLabel: "Earth" },
];

const kindLabels: Record<ComponentKind, string> = {
  solar: "Solar generation",
  battery: "Energy storage",
  protection: "Circuit protection",
  conversion: "Power conversion",
  generator: "Backup generation",
  loadAc: "AC load",
  loadDc: "DC load",
  distribution: "Distribution",
  control: "Monitoring / control",
  earth: "Earthing / bonding",
  structure: "Mounting",
  alternate: "Alternate path",
};

function money(value: number, currency: "USD" | "FJD" = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "FJD" ? 0 : 0,
  }).format(value);
}

function preciseMoney(value: number, currency: "USD" | "FJD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function ComponentIcon({ kind }: { kind: ComponentKind }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (kind === "solar") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M12 2v1.7M12 12.3V14M6 8H4.3M19.7 8H18M7.8 3.8 6.6 2.6M17.4 13.4l-1.2-1.2M16.2 3.8l1.2-1.2M6.6 13.4l1.2-1.2M4 18h16M7 18l1-3h8l1 3M9 22h6" />
      </svg>
    );
  }
  if (kind === "battery") {
    return (
      <svg {...common}>
        <rect x="3" y="7" width="17" height="11" rx="2" />
        <path d="M20 10h1.5v5H20M7 10v5M4.5 12.5h5M13.5 12.5h3" />
      </svg>
    );
  }
  if (kind === "protection") {
    return (
      <svg {...common}>
        <path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" />
        <path d="m9.2 12 1.8 1.8 4-4" />
      </svg>
    );
  }
  if (kind === "conversion") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m7 10 2-2 2 2M9 8v6M17 14l-2 2-2-2M15 16v-6" />
      </svg>
    );
  }
  if (kind === "generator") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M6 12c1.5-3 3-3 4.5 0s3 3 4.5 0 3-3 4.5 0M7 8h2" />
      </svg>
    );
  }
  if (kind === "loadAc") {
    return (
      <svg {...common}>
        <path d="M8 3v6M16 3v6M6 9h12v2a6 6 0 0 1-6 6v4M9 13h6" />
      </svg>
    );
  }
  if (kind === "loadDc") {
    return (
      <svg {...common}>
        <path d="m13 2-7 12h6l-1 8 7-12h-6l1-8Z" />
      </svg>
    );
  }
  if (kind === "distribution") {
    return (
      <svg {...common}>
        <path d="M12 3v6M5 21v-5h14v5M5 16v-4h14v4M12 9v3" />
        <circle cx="5" cy="21" r="1" /><circle cx="12" cy="21" r="1" /><circle cx="19" cy="21" r="1" />
      </svg>
    );
  }
  if (kind === "earth") {
    return (
      <svg {...common}>
        <path d="M12 3v10M6 13h12M8 17h8M10 21h4" />
      </svg>
    );
  }
  if (kind === "structure") {
    return (
      <svg {...common}>
        <path d="M4 21V4h16v17M4 8h16M8 4v17M16 4v17" />
      </svg>
    );
  }
  if (kind === "alternate") {
    return (
      <svg {...common}>
        <path d="M4 6h8a5 5 0 0 1 5 5v7M14 15l3 3 3-3M4 18h4" strokeDasharray="3 2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2M12 3v2M12 19v2M3 12h2M19 12h2" />
    </svg>
  );
}

function ProjectSelector({
  current,
  onChange,
}: {
  current: "dse" | "pg";
  onChange: (id: "dse" | "pg") => void;
}) {
  return (
    <div className="project-selector" aria-label="Choose system">
      {(Object.keys(systems) as Array<"dse" | "pg">).map((id) => (
        <button
          type="button"
          key={id}
          className={current === id ? "active" : ""}
          onClick={() => onChange(id)}
          aria-pressed={current === id}
        >
          <span className={`system-dot system-dot-${id}`} />
          <span>{systems[id].shortName}</span>
        </button>
      ))}
    </div>
  );
}

function BudgetCard({ system }: { system: SystemData }) {
  const included = system.bom.filter((item) => item.includedInTotal !== false);
  const total = included.reduce((sum, item) => sum + item.totalUsd, 0);
  const donorFunded = system.budget.donorFundedIncrementUsd ?? 0;
  const baseTotal = total - donorFunded;
  const purchased = included
    .filter((item) => item.procurement === "Purchased")
    .reduce((sum, item) => sum + item.totalUsd, 0);
  const remaining = total - purchased;
  const baseRemaining = Math.max(0, remaining - donorFunded);
  const targetIsRemaining = system.budget.targetBasis === "remaining";
  const budgetMeasure = targetIsRemaining ? baseRemaining : baseTotal;
  const delta = budgetMeasure - system.budget.targetUsd;
  const progress = Math.min(100, (budgetMeasure / system.budget.targetUsd) * 100);
  const purchasedShare = total ? (purchased / total) * 100 : 0;

  return (
    <section className="budget-card" aria-label="Project budget">
      <div className="rail-section-label">Planning total</div>
      <div className="budget-total-row">
        <strong>{money(total)}</strong>
        <span className={delta > 0.5 ? "budget-over" : "budget-ok"}>
          {delta > 0.5
            ? `+${money(delta)} ${targetIsRemaining ? "remaining" : "base"}`
            : delta < -0.5
              ? `${money(Math.abs(delta))} below target`
              : `${targetIsRemaining ? "remaining" : "base"} at target`}
        </span>
      </div>
      <div className="budget-target">
        {targetIsRemaining ? "Remaining-spend" : "Base"} target {money(system.budget.targetUsd)}
        {donorFunded > 0 && ` · ${money(donorFunded)} donor-funded`}
      </div>
      <div className="budget-bar" aria-hidden="true">
        {!targetIsRemaining && (
          <span
            className="budget-bar-purchased"
            style={{ width: `${Math.min(progress, purchasedShare)}%` }}
          />
        )}
        <span
          className="budget-bar-remaining"
          style={{
            left: targetIsRemaining ? "0%" : `${Math.min(progress, purchasedShare)}%`,
            width: targetIsRemaining
              ? `${progress}%`
              : `${Math.max(0, Math.min(100, progress) - purchasedShare)}%`,
          }}
        />
      </div>
      <dl className={`budget-breakdown ${donorFunded > 0 ? "with-donor" : ""}`}>
        <div>
          <dt>Purchased</dt>
          <dd>{money(purchased)}</dd>
        </div>
        <div>
          <dt>{donorFunded > 0 ? "Base remaining" : "Still to buy"}</dt>
          <dd>{money(donorFunded > 0 ? baseRemaining : remaining)}</dd>
        </div>
        {donorFunded > 0 && (
          <div>
            <dt>Donor upgrade</dt>
            <dd>{money(donorFunded)}</dd>
          </div>
        )}
      </dl>
      {!system.budget.contingencyIncluded && (
        <p className="budget-caveat">No general contingency included.</p>
      )}
    </section>
  );
}

function SystemOverview({ system }: { system: SystemData }) {
  return (
    <section className="system-view" aria-label={`${system.name} system overview`}>
      <div className="system-view-heading">
        <div>
          <span>System planning</span>
          <h1>{system.name}</h1>
        </div>
        <p>{system.shortName}</p>
      </div>
      <div className="system-overview-grid">
        <BudgetCard system={system} />
        <section className="system-facts-card">
          <div className="rail-section-label">System at a glance</div>
          <dl>
            {system.keyFacts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
                <span>{fact.detail}</span>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <div className="planning-details-grid">
        <article>
          <div className="rail-section-label">Scope boundary</div>
          <p>{system.budget.note}</p>
        </article>
        <article>
          <div className="rail-section-label">Energy assumptions</div>
          <p>{system.powerModel.assumptions}</p>
        </article>
      </div>
    </section>
  );
}

function nodeBoundaryPoint(
  node: DiagramNode,
  toward: { x: number; y: number },
  portOffset = 0,
) {
  const center = { x: node.x + NODE_W / 2, y: node.y + NODE_H / 2 };
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;

  if (Math.abs(dx) >= Math.abs(dy) * 0.62) {
    return {
      x: center.x + (NODE_W / 2) * (dx >= 0 ? 1 : -1),
      y: center.y + portOffset,
    };
  }
  return {
    x: center.x + portOffset,
    y: center.y + (NODE_H / 2) * (dy >= 0 ? 1 : -1),
  };
}

function edgeGeometry(from: DiagramNode, to: DiagramNode, edge: DiagramEdge) {
  const fromCenter = { x: from.x + NODE_W / 2, y: from.y + NODE_H / 2 };
  const toCenter = { x: to.x + NODE_W / 2, y: to.y + NODE_H / 2 };
  const portOffset = edge.portOffset ?? 0;

  if (edge.waypoints?.length) {
    const start = nodeBoundaryPoint(from, edge.waypoints[0], portOffset);
    const end = nodeBoundaryPoint(
      to,
      edge.waypoints[edge.waypoints.length - 1],
      portOffset,
    );
    const points = [start, ...edge.waypoints, end];
    const longestSegment = points.slice(1).reduce(
      (best, point, index) => {
        const previous = points[index];
        const length = Math.hypot(point.x - previous.x, point.y - previous.y);
        return length > best.length ? { from: previous, to: point, length } : best;
      },
      { from: points[0], to: points[1], length: 0 },
    );
    return {
      d: points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
        .join(" "),
      labelX:
        edge.labelAt?.x ?? (longestSegment.from.x + longestSegment.to.x) / 2,
      labelY:
        edge.labelAt?.y ?? (longestSegment.from.y + longestSegment.to.y) / 2,
    };
  }

  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  let sx: number;
  let sy: number;
  let tx: number;
  let ty: number;
  let d: string;

  if (Math.abs(dx) >= Math.abs(dy) * 0.62) {
    const direction = dx >= 0 ? 1 : -1;
    sx = fromCenter.x + (NODE_W / 2) * direction;
    sy = fromCenter.y + portOffset;
    tx = toCenter.x - (NODE_W / 2) * direction;
    ty = toCenter.y + portOffset;
    const curve = Math.max(54, Math.abs(tx - sx) * 0.42);
    d = `M ${sx} ${sy} C ${sx + curve * direction} ${sy}, ${tx - curve * direction} ${ty}, ${tx} ${ty}`;
  } else {
    const direction = dy >= 0 ? 1 : -1;
    sx = fromCenter.x + portOffset;
    sy = fromCenter.y + (NODE_H / 2) * direction;
    tx = toCenter.x + portOffset;
    ty = toCenter.y - (NODE_H / 2) * direction;
    const curve = Math.max(42, Math.abs(ty - sy) * 0.42);
    d = `M ${sx} ${sy} C ${sx} ${sy + curve * direction}, ${tx} ${ty - curve * direction}, ${tx} ${ty}`;
  }
  return {
    d,
    labelX: (sx + tx) / 2,
    labelY: (sy + ty) / 2,
  };
}

function placeEdgeLabel(
  labelX: number,
  labelY: number,
  labelWidth: number,
  view: DiagramView,
  occupiedLabels: Array<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }> = [],
) {
  const labelHeight = 30;
  const direction = labelY < view.canvas.height / 2 ? -1 : 1;
  const verticalOffsets = [
    0,
    76 * direction,
    116 * direction,
    156 * direction,
    -76 * direction,
    -116 * direction,
    -156 * direction,
    196 * direction,
    -196 * direction,
  ];
  const horizontalDirection = labelX < view.canvas.width / 2 ? 1 : -1;
  const horizontalShift = labelWidth / 2 + 48;
  const horizontalOffsets = [
    0,
    horizontalShift * horizontalDirection,
    -horizontalShift * horizontalDirection,
  ];

  for (const horizontalOffset of horizontalOffsets) {
    for (const verticalOffset of verticalOffsets) {
      const candidateX = labelX + horizontalOffset;
      const candidateY = labelY + verticalOffset;
      const labelRect = {
        left: candidateX - labelWidth / 2,
        right: candidateX + labelWidth / 2,
        top: candidateY - labelHeight / 2,
        bottom: candidateY + labelHeight / 2,
      };
      const insideCanvas =
        labelRect.left >= 8 &&
        labelRect.right <= view.canvas.width - 8 &&
        labelRect.top >= 8 &&
        labelRect.bottom <= view.canvas.height - 8;
      const hitsNode = view.nodes.some(
        (node) =>
          labelRect.left < node.x + NODE_W &&
          labelRect.right > node.x &&
          labelRect.top < node.y + NODE_H &&
          labelRect.bottom > node.y,
      );
      const hitsLabel = occupiedLabels.some(
        (occupied) =>
          labelRect.left < occupied.right + 10 &&
          labelRect.right > occupied.left - 10 &&
          labelRect.top < occupied.bottom + 8 &&
          labelRect.bottom > occupied.top - 8,
      );
      if (insideCanvas && !hitsNode && !hitsLabel) {
        occupiedLabels.push(labelRect);
        return { x: candidateX, y: candidateY };
      }
    }
  }

  occupiedLabels.push({
    left: labelX - labelWidth / 2,
    right: labelX + labelWidth / 2,
    top: labelY - labelHeight / 2,
    bottom: labelY + labelHeight / 2,
  });
  return { x: labelX, y: labelY };
}

function DiagramCanvas({
  system,
  viewKey,
  selectedId,
  onSelect,
  onViewChange,
}: {
  system: SystemData;
  viewKey: "overview" | "detail";
  selectedId: string | null;
  onSelect: (id: string) => void;
  onViewChange: (key: "overview" | "detail") => void;
}) {
  const view = system.diagram.views[viewKey];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [flow, setFlow] = useState<FlowType>("all");
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const wheelTargetRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const wheelFrameRef = useRef<number | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const components = useMemo(
    () => new Map(system.components.map((component) => [component.id, component])),
    [system],
  );
  const nodes = useMemo(
    () => new Map(view.nodes.map((node) => [node.id, node])),
    [view.nodes],
  );
  const connected = useMemo(() => {
    const ids = new Set<string>(selectedId ? [selectedId] : []);
    view.edges.forEach((edge) => {
      if (edge.from === selectedId) ids.add(edge.to);
      if (edge.to === selectedId) ids.add(edge.from);
    });
    return ids;
  }, [selectedId, view.edges]);
  const nodeRegions = useMemo(() => {
    const memberships = new Map<string, DiagramRegion>();
    view.regions?.forEach((region) => {
      region.memberIds.forEach((memberId) => memberships.set(memberId, region));
    });
    return memberships;
  }, [view.regions]);

  function stopWheelMotion() {
    if (wheelFrameRef.current !== null) {
      cancelAnimationFrame(wheelFrameRef.current);
      wheelFrameRef.current = null;
    }
    wheelTargetRef.current = {
      zoom: zoomRef.current,
      pan: panRef.current,
    };
  }

  function setTransformNow(nextZoom: number, nextPan: { x: number; y: number }) {
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    wheelTargetRef.current = { zoom: nextZoom, pan: nextPan };
    setZoom(nextZoom);
    setPan(nextPan);
  }

  function zoomBy(delta: number) {
    stopWheelMotion();
    const currentZoom = zoomRef.current;
    const nextZoom = Math.min(1.8, Math.max(0.62, currentZoom + delta));
    const centerX = view.canvas.width / 2;
    const centerY = view.canvas.height / 2;
    const worldX = (centerX - panRef.current.x) / currentZoom;
    const worldY = (centerY - panRef.current.y) / currentZoom;
    setTransformNow(nextZoom, {
      x: centerX - worldX * nextZoom,
      y: centerY - worldY * nextZoom,
    });
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    function animateWheel() {
      const target = wheelTargetRef.current;
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      const easedZoom = currentZoom + (target.zoom - currentZoom) * 0.22;
      const easedPan = {
        x: currentPan.x + (target.pan.x - currentPan.x) * 0.22,
        y: currentPan.y + (target.pan.y - currentPan.y) * 0.22,
      };
      const settled =
        Math.abs(target.zoom - easedZoom) < 0.00025 &&
        Math.abs(target.pan.x - easedPan.x) < 0.05 &&
        Math.abs(target.pan.y - easedPan.y) < 0.05;
      const nextZoom = settled ? target.zoom : easedZoom;
      const nextPan = settled ? target.pan : easedPan;

      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);

      if (settled) {
        wheelFrameRef.current = null;
      } else {
        wheelFrameRef.current = requestAnimationFrame(animateWheel);
      }
    }

    function captureWheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();

      const rect = stage!.getBoundingClientRect();
      const canvasScale = Math.min(
        rect.width / view.canvas.width,
        rect.height / view.canvas.height,
      );
      const offsetX = (rect.width - view.canvas.width * canvasScale) / 2;
      const offsetY = (rect.height - view.canvas.height * canvasScale) / 2;
      const cursorX = (event.clientX - rect.left - offsetX) / canvasScale;
      const cursorY = (event.clientY - rect.top - offsetY) / canvasScale;
      const deltaPixels =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * rect.height
            : event.deltaY;
      const boundedDelta = Math.max(-160, Math.min(160, deltaPixels));
      const base = wheelTargetRef.current;
      const nextZoom = Math.min(
        1.8,
        Math.max(0.62, base.zoom * Math.exp(-boundedDelta * 0.0006)),
      );
      const worldX = (cursorX - base.pan.x) / base.zoom;
      const worldY = (cursorY - base.pan.y) / base.zoom;

      wheelTargetRef.current = {
        zoom: nextZoom,
        pan: {
          x: cursorX - worldX * nextZoom,
          y: cursorY - worldY * nextZoom,
        },
      };
      if (wheelFrameRef.current === null) {
        wheelFrameRef.current = requestAnimationFrame(animateWheel);
      }
    }

    stage.addEventListener("wheel", captureWheel, {
      passive: false,
      capture: true,
    });
    return () => {
      stage.removeEventListener("wheel", captureWheel, true);
      if (wheelFrameRef.current !== null) {
        cancelAnimationFrame(wheelFrameRef.current);
        wheelFrameRef.current = null;
      }
    };
  }, [view.canvas.height, view.canvas.width]);

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest("[data-diagram-node]")) return;
    stopWheelMotion();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragRef.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const canvasScale = Math.min(
      rect.width / view.canvas.width,
      rect.height / view.canvas.height,
    );
    setTransformNow(zoomRef.current, {
      x:
        dragRef.current.panX +
        (event.clientX - dragRef.current.startX) / canvasScale,
      y:
        dragRef.current.panY +
        (event.clientY - dragRef.current.startY) / canvasScale,
    });
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const occupiedLabels: Array<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }> = [];
  const edgeLayouts = view.edges.flatMap((edge) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) return [];

    const geo = edgeGeometry(from, to, edge);
    const selectedEdge = edge.from === selectedId || edge.to === selectedId;
    const flowMuted = flow !== "all" && edge.type !== flow;
    const selectionMuted = selectedId && !selectedEdge;
    const muted = flowMuted || selectionMuted;
    const labelWidth = Math.max(62, edge.label.length * 8 + 24);
    let labelPosition: { x: number; y: number };

    if (edge.labelAt) {
      labelPosition = edge.labelAt;
      occupiedLabels.push({
        left: labelPosition.x - labelWidth / 2,
        right: labelPosition.x + labelWidth / 2,
        top: labelPosition.y - 15,
        bottom: labelPosition.y + 15,
      });
    } else {
      labelPosition = placeEdgeLabel(
        geo.labelX,
        geo.labelY,
        labelWidth,
        view,
        occupiedLabels,
      );
    }

    return [{ edge, geo, selectedEdge, flowMuted, muted, labelWidth, labelPosition }];
  });
  const orderedEdgeLayouts = hoveredEdgeId
    ? [
        ...edgeLayouts.filter(({ edge }) => edge.id !== hoveredEdgeId),
        ...edgeLayouts.filter(({ edge }) => edge.id === hoveredEdgeId),
      ]
    : edgeLayouts;

  return (
    <section className="diagram-panel" aria-label={`${system.name} wiring diagram`}>
      <div className="diagram-toolbar">
        <div className="flow-filters" aria-label="Filter circuit type">
          {flowMeta.map((item) => (
            <button
              type="button"
              key={item.id}
              className={flow === item.id ? "active" : ""}
              onClick={() => setFlow(item.id)}
              title={item.label}
            >
              {item.id !== "all" && (
                <span className={`flow-swatch flow-${item.id}`} />
              )}
              {item.shortLabel}
            </button>
          ))}
        </div>
        <div className="diagram-toolbar-actions">
          <div className="view-toggle" aria-label="Diagram detail level">
            {(Object.keys(system.diagram.views) as Array<"overview" | "detail">).map((key) => (
              <button
                type="button"
                key={key}
                className={viewKey === key ? "active" : ""}
                onClick={() => onViewChange(key)}
              >
                {system.diagram.views[key].label}
              </button>
            ))}
          </div>
          <div className="zoom-controls" aria-label="Diagram zoom controls">
            <button type="button" onClick={() => zoomBy(-0.1)} aria-label="Zoom out">
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => zoomBy(0.1)} aria-label="Zoom in">
              +
            </button>
            <button
              type="button"
              className="fit-button"
              onClick={() => {
                stopWheelMotion();
                setTransformNow(1, { x: 0, y: 0 });
              }}
            >
              Fit
            </button>
          </div>
        </div>
      </div>
      <div className="diagram-stage" ref={stageRef}>
        <svg
          viewBox={`0 0 ${view.canvas.width} ${view.canvas.height}`}
          role="img"
          aria-label={`${system.name} ${view.label} single-line diagram`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <defs>
            <pattern id={`grid-${system.id}`} width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" className="grid-line" />
            </pattern>
            {flowMeta
              .filter((item) => item.id !== "all")
              .map((item) => (
                <marker
                  key={item.id}
                  id={`arrow-${system.id}-${item.id}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className={`marker-${item.id}`} />
                </marker>
              ))}
          </defs>
          <rect
            width={view.canvas.width}
            height={view.canvas.height}
            fill={`url(#grid-${system.id})`}
            data-canvas="true"
          />
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {view.regions?.length ? (
              <g className="diagram-regions" aria-hidden="true">
                {view.regions.map((region) => (
                  <g key={region.id} data-region-id={region.id}>
                    {region.memberIds.map((memberId) => {
                      const member = nodes.get(memberId);
                      if (!member) return null;
                      return (
                        <rect
                          key={memberId}
                          className="diagram-region-halo"
                          data-region-member={memberId}
                          x={member.x - 15}
                          y={member.y - 15}
                          width={NODE_W + 30}
                          height={NODE_H + 30}
                          rx="17"
                        />
                      );
                    })}
                  </g>
                ))}
              </g>
            ) : null}
            <g className="diagram-edges">
              {orderedEdgeLayouts.map(
                ({ edge, geo, selectedEdge, flowMuted, muted, labelWidth, labelPosition }) => {
                  const hovered = hoveredEdgeId === edge.id;
                return (
                  <g
                    key={edge.id}
                    className={`diagram-edge edge-${edge.type} ${muted ? "muted" : ""} ${selectedEdge ? "selected" : ""} ${hovered ? "is-hovered" : ""}`}
                    data-edge-id={edge.id}
                    onMouseEnter={() => setHoveredEdgeId(edge.id)}
                    onMouseLeave={() =>
                      setHoveredEdgeId((current) => (current === edge.id ? null : current))
                    }
                  >
                    <path
                      className="edge-hit"
                      d={geo.d}
                      fill="none"
                    />
                    <path
                      className="edge-line"
                      d={geo.d}
                      fill="none"
                      markerEnd={`url(#arrow-${system.id}-${edge.type})`}
                    />
                    {!flowMuted && (
                      <g
                        className="edge-label"
                        transform={`translate(${labelPosition.x} ${labelPosition.y})`}
                      >
                        <rect
                          x={-labelWidth / 2}
                          y="-15"
                          width={labelWidth}
                          height="30"
                          rx="9"
                        />
                        <text textAnchor="middle" dominantBaseline="central">
                          {edge.label}
                        </text>
                      </g>
                    )}
                  </g>
                );
                },
              )}
            </g>
            <g className="diagram-nodes">
              {view.nodes.map((node) => {
                const component = components.get(node.id);
                if (!component) return null;
                const containingRegion = nodeRegions.get(node.id);
                const selected = selectedId === node.id;
                const muted = Boolean(selectedId) && !connected.has(node.id);
                const flowConnected =
                  flow === "all" ||
                  view.edges.some(
                    (edge) =>
                      edge.type === flow &&
                      (edge.from === node.id || edge.to === node.id),
                  );
                return (
                  <foreignObject
                    key={node.id}
                    x={node.x}
                    y={node.y}
                    width={NODE_W}
                    height={NODE_H}
                    className={`${muted || !flowConnected ? "node-muted" : ""}`}
                    data-diagram-node="true"
                    data-node-id={node.id}
                    data-contained-in={containingRegion?.id}
                  >
                    <button
                      type="button"
                      className={`diagram-node kind-${component.kind} ${selected ? "selected" : ""} ${node.featured ? "featured" : ""} ${containingRegion ? "contained-node" : ""}`}
                      onClick={() => onSelect(node.id)}
                      title={`Inspect ${component.title}`}
                    >
                      <span className="node-icon">
                        <ComponentIcon kind={component.kind} />
                      </span>
                      <span className="node-copy">
                        <span className="node-kicker">{component.kicker}</span>
                        <strong>{component.title}</strong>
                      </span>
                      <span className="node-chevron">›</span>
                    </button>
                  </foreignObject>
                );
              })}
            </g>
          </g>
        </svg>
        {view.regions?.map((region) => (
          <div className="diagram-region-key" key={region.id} data-region-key={region.id}>
            <span aria-hidden="true" />
            {region.label}
          </div>
        ))}
        <div className="canvas-hint">
          <span className="mouse-glyph" aria-hidden="true" />
          Scroll to zoom · drag canvas to pan · click a component
        </div>
      </div>
    </section>
  );
}

function Inspector({
  system,
  viewKey,
  selectedId,
  onSelect,
  onClose,
}: {
  system: SystemData;
  viewKey: "overview" | "detail";
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const component = system.components.find((item) => item.id === selectedId);
  const view = system.diagram.views[viewKey];
  const relatedIds = component
    ? Array.from(
        new Set(
          view.edges.flatMap((edge) => {
            if (edge.from === component.id) return [edge.to];
            if (edge.to === component.id) return [edge.from];
            return [];
          }),
        ),
      )
    : [];
  const related = relatedIds
    .map((id) => system.components.find((item) => item.id === id))
    .filter((item): item is ComponentData => Boolean(item));

  if (!component) return null;

  return (
    <aside className="inspector" aria-label="Component details" role="dialog">
      <button
        type="button"
        className="inspector-close"
        onClick={onClose}
        aria-label="Close component details"
      >
        ×
      </button>
      <div className="inspector-topline">
        <span className={`inspector-icon kind-${component.kind}`}>
          <ComponentIcon kind={component.kind} />
        </span>
        <span>{kindLabels[component.kind]}</span>
      </div>
      <h2>{component.title}</h2>
      <p className="inspector-kicker">{component.kicker}</p>
      <p className="inspector-summary">{component.summary}</p>
      <div className="inspector-section">
        <div className="rail-section-label">Design values</div>
        <ul className="spec-list">
          {component.specs.map((spec) => (
            <li key={spec}>{spec}</li>
          ))}
        </ul>
      </div>
      {component.note && (
        <div className="engineering-note">
          <div className="engineering-note-title">
            <span>!</span> Engineering note
          </div>
          <p>{component.note}</p>
        </div>
      )}
      {related.length > 0 && (
        <div className="inspector-section">
          <div className="rail-section-label">Directly connected</div>
          <div className="related-list">
            {related.map((item) => (
              <button type="button" key={item.id} onClick={() => onSelect(item.id)}>
                <span className={`mini-kind kind-${item.kind}`}>
                  <ComponentIcon kind={item.kind} />
                </span>
                <span>{item.title}</span>
                <b>›</b>
              </button>
            ))}
          </div>
        </div>
      )}
      {component.sourceUrl && component.sourceUrl.startsWith("http") && (
        <a
          className="source-button"
          href={component.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open technical source <span>↗</span>
        </a>
      )}
    </aside>
  );
}

function BomView({ system }: { system: SystemData }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [displayCurrency, setDisplayCurrency] = useState<"USD" | "FJD">("USD");
  const filters = useMemo(() => {
    const locations = Array.from(new Set(system.bom.map((item) => item.location)));
    return ["All", "Purchased", ...locations.filter((item) => item !== "Excluded"), "Excluded"];
  }, [system.bom]);
  const included = system.bom.filter((item) => item.includedInTotal !== false);
  const total = included.reduce((sum, item) => sum + item.totalUsd, 0);
  const purchased = included
    .filter((item) => item.procurement === "Purchased")
    .reduce((sum, item) => sum + item.totalUsd, 0);
  const importTotal = included
    .filter((item) => item.location === "Import")
    .reduce((sum, item) => sum + item.totalUsd, 0);
  const localTotal = total - importTotal;
  const rows = system.bom.filter((item) => {
    const needle = `${item.item} ${item.category} ${item.description}`.toLowerCase();
    const queryMatch = needle.includes(query.trim().toLowerCase());
    const filterMatch =
      filter === "All" ||
      (filter === "Purchased" && item.procurement === "Purchased") ||
      (filter === "Excluded" && item.location === "Excluded") ||
      item.location === filter;
    return queryMatch && filterMatch;
  });

  function display(valueUsd: number) {
    return displayCurrency === "USD"
      ? money(valueUsd, "USD")
      : money(valueUsd * system.currency.fjdPerUsd, "FJD");
  }

  return (
    <section className="bom-view">
      <div className="bom-summary-grid">
        <article>
          <span>Project total</span>
          <strong>{display(total)}</strong>
          <small>
            {included.length} priced line items
            {system.budget.donorFundedIncrementUsd
              ? ` · ${display(system.budget.donorFundedIncrementUsd)} donor-funded`
              : ""}
          </small>
        </article>
        <article>
          <span>Already purchased</span>
          <strong>{display(purchased)}</strong>
          <small>{total ? Math.round((purchased / total) * 100) : 0}% of known cost</small>
        </article>
        <article>
          <span>{system.id === "dse" ? "Fiji / local" : "Local + purchased"}</span>
          <strong>{display(localTotal)}</strong>
          <small>Includes purchased hardware</small>
        </article>
        <article>
          <span>Import / bring in</span>
          <strong>{display(importTotal)}</strong>
          <small>{system.id === "dse" ? "Includes LAX → Nadi bag" : "Original import list"}</small>
        </article>
      </div>
      <div className="bom-controls">
        <label className="bom-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 5 5" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search items, categories or notes…"
            aria-label="Search bill of materials"
          />
        </label>
        <div className="bom-filter-list" aria-label="Filter bill of materials">
          {filters.map((item) => (
            <button
              type="button"
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="currency-toggle" aria-label="Display currency">
          {(["USD", "FJD"] as const).map((currency) => (
            <button
              type="button"
              key={currency}
              className={displayCurrency === currency ? "active" : ""}
              onClick={() => setDisplayCurrency(currency)}
            >
              {currency}
            </button>
          ))}
        </div>
      </div>
      <div className="bom-table-wrap">
        <table className="bom-table">
          <thead>
            <tr>
              <th>Item / specification</th>
              <th>Source</th>
              <th>Qty</th>
              <th>Unit cost</th>
              <th>Line total</th>
              <th>Status</th>
              <th aria-label="Product links" />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const originalUnit = preciseMoney(item.unitCost, item.currency);
              const excluded = item.includedInTotal === false;
              return (
                <tr key={item.id} className={excluded ? "excluded-row" : ""}>
                  <td>
                    <div className="bom-item-title">{item.item}</div>
                    <div className="bom-item-category">{item.category}</div>
                    <p>{item.description}</p>
                  </td>
                  <td>
                    <span className={`location-pill location-${item.location.toLowerCase()}`}>
                      {item.location}
                    </span>
                  </td>
                  <td className="numeric-cell">
                    {item.qty} <span>{item.unit}</span>
                  </td>
                  <td className="numeric-cell">{excluded ? "—" : originalUnit}</td>
                  <td className="numeric-cell line-total">
                    {excluded ? "—" : display(item.totalUsd)}
                  </td>
                  <td>
                    <span
                      className={`procurement-pill procurement-${item.procurement
                        .toLowerCase()
                        .replaceAll(" ", "-")}`}
                    >
                      {item.procurement}
                    </span>
                  </td>
                  <td>
                    <div className="bom-links">
                      {item.productUrl && (
                        <a href={item.productUrl} target="_blank" rel="noreferrer" title="Open product or price source">
                          <span>↗</span>
                        </a>
                      )}
                      {item.specUrl && (
                        <a href={item.specUrl} target="_blank" rel="noreferrer" title="Open technical specification">
                          <span>≡</span>
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                {rows.length} of {system.bom.length} rows shown
              </td>
              <td className="numeric-cell">{display(total)}</td>
              <td colSpan={2}>Project total</td>
            </tr>
          </tfoot>
        </table>
        {rows.length === 0 && (
          <div className="empty-state">No BOM items match that search and filter.</div>
        )}
      </div>
      <div className="bom-footnotes">
        <span>Planning FX: 1 USD = {system.currency.fjdPerUsd.toFixed(2)} FJD.</span>
        <span>Prices are planning values; verify before ordering.</span>
        {system.budget.donorFundedIncrementUsd && (
          <span>{display(system.budget.donorFundedIncrementUsd)} net Ekrano upgrade is donor-funded.</span>
        )}
        <span>{system.budget.contingencyIncluded ? "Contingency included." : "No general contingency included."}</span>
      </div>
    </section>
  );
}

function FieldNotes({ system }: { system: SystemData }) {
  return (
    <section className="field-notes">
      <div className="notes-grid">
        <article>
          <div className="notes-heading">
            <span>01</span>
            <div>
              <p>Operations</p>
              <h2>Rules to post beside the system</h2>
            </div>
          </div>
          <ol>
            {system.operatingRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ol>
        </article>
        <article>
          <div className="notes-heading">
            <span>02</span>
            <div>
              <p>Before handoff</p>
              <h2>Commissioning checklist</h2>
            </div>
          </div>
          <ol>
            {system.commissioning.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>
      </div>
      <article className="research-card">
        <div>
          <p>Research trail</p>
          <h2>Primary technical sources</h2>
          <span>Product data and current pricing references used by this revision.</span>
        </div>
        <div className="research-links">
          {system.research.map((source) =>
            source.url.startsWith("http") ? (
              <a key={source.title} href={source.url} target="_blank" rel="noreferrer">
                <span>
                  <b>{source.title}</b>
                  <small>{source.publisher}</small>
                </span>
                <em>↗</em>
              </a>
            ) : (
              <div key={source.title} className="research-local">
                <span>
                  <b>{source.title}</b>
                  <small>{source.publisher}</small>
                </span>
                <em>local</em>
              </div>
            ),
          )}
        </div>
      </article>
    </section>
  );
}

export function SystemViewer() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [systemId, setSystemId] = useState<"dse" | "pg">("dse");
  const [mode, setMode] = useState<"diagram" | "model" | "system" | "bom" | "notes">("diagram");
  const [viewKey, setViewKey] = useState<"overview" | "detail">("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const system = systems[systemId];

  useEffect(() => {
    shellRef.current?.setAttribute("data-viewer-ready", "true");
  }, []);

  function changeSystem(id: "dse" | "pg") {
    setSystemId(id);
    setViewKey("overview");
    setSelectedId(null);
    window.scrollTo({ top: 0 });
  }

  function changeView(key: "overview" | "detail") {
    setViewKey(key);
    if (
      selectedId &&
      !system.diagram.views[key].nodes.some((node) => node.id === selectedId)
    ) {
      setSelectedId(null);
    }
  }

  function changeMode(nextMode: "diagram" | "model" | "system" | "bom" | "notes") {
    setMode(nextMode);
    setSelectedId(null);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="app-shell" data-viewer-ready="false" ref={shellRef}>
      <header className="app-header">
        <nav className="mode-tabs" aria-label="Viewer mode">
          <button
            type="button"
            className={mode === "diagram" ? "active" : ""}
            onClick={() => changeMode("diagram")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="7" height="6" rx="1" />
              <rect x="14" y="14" width="7" height="6" rx="1" />
              <path d="M10 7h5a3 3 0 0 1 3 3v4M6.5 10v5a2 2 0 0 0 2 2H14" />
            </svg>
            Diagram
          </button>
          <button
            type="button"
            className={mode === "model" ? "active" : ""}
            onClick={() => changeMode("model")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
              <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
            </svg>
            3D model
          </button>
          <button
            type="button"
            className={mode === "system" ? "active" : ""}
            onClick={() => changeMode("system")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
            </svg>
            System
          </button>
          <button
            type="button"
            className={mode === "bom" ? "active" : ""}
            onClick={() => changeMode("bom")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
            </svg>
            Bill of materials
            <span>{system.bom.length}</span>
          </button>
          <button
            type="button"
            className={mode === "notes" ? "active" : ""}
            onClick={() => changeMode("notes")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5" />
            </svg>
            Field notes
          </button>
        </nav>
        <ProjectSelector current={systemId} onChange={changeSystem} />
      </header>

      <main>
        {mode === "diagram" && (
          <div className="diagram-workspace">
            <div className="diagram-main">
              <DiagramCanvas
                key={`${system.id}-${viewKey}`}
                system={system}
                viewKey={viewKey}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onViewChange={changeView}
              />
            </div>
            {selectedId && (
              <div className="inspector-layer">
                <button
                  type="button"
                  className="inspector-backdrop"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close component details"
                />
                <Inspector
                  system={system}
                  viewKey={viewKey}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            )}
          </div>
        )}

        {mode === "model" && (
          <div className="model-workspace">
            <Suspense fallback={<div className="model-loading">Preparing measured 3D scene…</div>}>
              <SystemModel3D
                key={system.id}
                system={system}
                onSelect={setSelectedId}
                onOpenDse={() => changeSystem("dse")}
              />
            </Suspense>
            {selectedId && (
              <div className="inspector-layer">
                <button
                  type="button"
                  className="inspector-backdrop"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close component details"
                />
                <Inspector
                  system={system}
                  viewKey="detail"
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            )}
          </div>
        )}

        {mode === "system" && <SystemOverview system={system} />}
        {mode === "bom" && <BomView key={system.id} system={system} />}
        {mode === "notes" && <FieldNotes system={system} />}
      </main>
    </div>
  );
}
