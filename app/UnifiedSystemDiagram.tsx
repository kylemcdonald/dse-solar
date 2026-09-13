"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import diagramLayoutsArtifact from "../data/generated/diagram-layouts.json";
import { CurrentSafetySummary } from "./CurrentSafetySummary";
import {
  MIN_WIRE_LANE_SPACING,
  PORT_RADIUS,
  diagramConductorColor,
  isDiagramJoin,
  portPoint,
  routeStrokeWidth,
} from "./diagramLayout";
import type { DiagramLayout, DiagramNode, DiagramPort, Point, RoutedWire } from "./diagramLayout";
import { dseRuntime } from "./dseRuntime";
import { isPurchasedDevice } from "./systemGraph";
import type { GraphSelection } from "./systemGraph";

type Props = {
  fadePurchased: boolean;
  onFadePurchasedChange: (fade: boolean) => void;
  onSelect: (selection: GraphSelection) => void;
  onClearSelection?: () => void;
  inspectorOpen?: boolean;
};

type ViewTransform = { x: number; y: number; scale: number };

const MIN_SCALE = 0.025;
const LABEL_SCALE_FLOOR = 0.16;
const MAX_SCALE = 2.4;

/** A join arm is as wide as the wire on it: the routed wire when the layout
 * has one (pair sheaths exist only in the diagram), else the physical route. */
function wireJoinArmWidth(node: DiagramNode, port: DiagramPort, widthByEndpoint?: ReadonlyMap<string, number>) {
  const endpoint = `${node.device.id}.${port.id}`;
  const routed = widthByEndpoint?.get(endpoint);
  if (routed !== undefined) return routed;
  const route = dseRuntime.routes.find((candidate) => candidate.from === endpoint || candidate.to === endpoint);
  return route ? routeStrokeWidth(route) : 4;
}

type SerializedDiagramLayout = Omit<DiagramLayout, "junction" | "nodes" | "wires"> & {
  junctionId?: string;
  nodes: Array<Omit<DiagramNode, "device"> & { deviceId: string; device?: DiagramNode["device"] }>;
  wires: Array<Omit<RoutedWire, "route"> & { routeId: string; route?: RoutedWire["route"] }>;
};

const generatedLayouts = diagramLayoutsArtifact as unknown as {
  graphId: string;
  graphRevision: string;
  layouts: Record<string, SerializedDiagramLayout>;
};
const hydratedLayoutCache = new Map<string, DiagramLayout>();

function hydrateDiagramLayout(activeJunctionId?: string) {
  const key = activeJunctionId ?? "system";
  const cached = hydratedLayoutCache.get(key);
  if (cached) return cached;
  if (generatedLayouts.graphId !== dseRuntime.graph.id || generatedLayouts.graphRevision !== dseRuntime.graph.revision) {
    throw new Error("Generated diagram geometry is stale; run npm run generate:diagram-layouts.");
  }
  const started = performance.now();
  const serialized = generatedLayouts.layouts[key];
  if (!serialized) throw new Error(`Generated diagram geometry has no ${key} scope.`);
  const layout: DiagramLayout = {
    ...serialized,
    junction: serialized.junctionId ? dseRuntime.deviceById.get(serialized.junctionId) : undefined,
    nodes: serialized.nodes.map(({ deviceId, device, ...node }) => ({
      ...node,
      device: dseRuntime.deviceById.get(deviceId) ?? device!,
    })),
    wires: serialized.wires.map(({ routeId, route, ...wire }) => ({
      ...wire,
      route: dseRuntime.routeById.get(routeId) ?? route!,
    })),
    precomputedLayoutMs: serialized.layoutMs,
    layoutMs: performance.now() - started,
  };
  hydratedLayoutCache.set(key, layout);
  return layout;
}

const WIRE_JUMP_HALF_LENGTH = 12;
const WIRE_JUMP_GROUP_GAP = WIRE_JUMP_HALF_LENGTH * 2;
const WIRE_JUMP_RISE = 10;
const HOVERED_WIRE_WIDTH = 10;
const HOVERED_WIRE_CLEARANCE = 6;

type WireJumpGeometry = {
  axis: "horizontal" | "vertical";
  start: Point;
  end: Point;
  rise: number;
  crossingCount: number;
};

function segmentAxis(first: Point, second: Point) {
  if (first.y === second.y && first.x !== second.x) return "horizontal" as const;
  if (first.x === second.x && first.y !== second.y) return "vertical" as const;
  return undefined;
}

function axisCoordinate(point: Point, axis: WireJumpGeometry["axis"]) {
  return axis === "horizontal" ? point.x : point.y;
}

function pointOnAxis(axis: WireJumpGeometry["axis"], coordinate: number, fixedCoordinate: number): Point {
  return axis === "horizontal"
    ? { x: coordinate, y: fixedCoordinate }
    : { x: fixedCoordinate, y: coordinate };
}

function bridgeIsOnSegment(bridge: RoutedWire["bridges"][number], first: Point, second: Point) {
  const axis = segmentAxis(first, second);
  if (!axis || bridge.axis !== axis) return false;
  const coordinate = axisCoordinate(bridge.point, axis);
  const firstCoordinate = axisCoordinate(first, axis); const secondCoordinate = axisCoordinate(second, axis);
  const fixedCoordinate = axis === "horizontal" ? first.y : first.x;
  return (axis === "horizontal" ? bridge.point.y : bridge.point.x) === fixedCoordinate
    && coordinate >= Math.min(firstCoordinate, secondCoordinate)
    && coordinate <= Math.max(firstCoordinate, secondCoordinate);
}

function jumpCurveCommands(jump: WireJumpGeometry) {
  const vector = { x: jump.end.x - jump.start.x, y: jump.end.y - jump.start.y };
  const normal = jump.axis === "horizontal" ? { x: 0, y: -jump.rise } : { x: jump.rise, y: 0 };
  const apex = {
    x: (jump.start.x + jump.end.x) / 2 + normal.x,
    y: (jump.start.y + jump.end.y) / 2 + normal.y,
  };
  const firstControl = { x: jump.start.x + vector.x * 0.22, y: jump.start.y + vector.y * 0.22 };
  const secondControl = { x: apex.x - vector.x * 0.12, y: apex.y - vector.y * 0.12 };
  const thirdControl = { x: apex.x + vector.x * 0.12, y: apex.y + vector.y * 0.12 };
  const fourthControl = { x: jump.end.x - vector.x * 0.22, y: jump.end.y - vector.y * 0.22 };
  return `C${firstControl.x},${firstControl.y} ${secondControl.x},${secondControl.y} ${apex.x},${apex.y} `
    + `C${thirdControl.x},${thirdControl.y} ${fourthControl.x},${fourthControl.y} ${jump.end.x},${jump.end.y}`;
}

function localJumpPath(jump: WireJumpGeometry) {
  return `M${jump.start.x},${jump.start.y} ${jumpCurveCommands(jump)}`;
}

const INTEGRATED_FUSION_OFFSET = 22;

function isIntegratedCableEndpoint(endpointId: string) {
  const port = dseRuntime.conductorByKey.get(endpointId);
  const owner = port ? dseRuntime.deviceById.get(port.deviceId) : undefined;
  return owner?.presentation === "integrated-cable-breakout"
    && port?.kind === "multicore" && (port.internalMates?.length ?? 0) >= 2;
}

function trimDiagramPolyline(points: readonly Point[], fromStart: boolean, trimDistance: number) {
  const ordered = fromStart ? [...points] : [...points].reverse();
  let remaining = trimDistance;
  let segmentIndex = 0;
  for (; segmentIndex < ordered.length - 1; segmentIndex += 1) {
    const first = ordered[segmentIndex]; const second = ordered[segmentIndex + 1];
    const length = Math.hypot(second.x - first.x, second.y - first.y);
    if (remaining < length) {
      const amount = remaining / length;
      const fusion = { x: first.x + (second.x - first.x) * amount, y: first.y + (second.y - first.y) * amount };
      const trimmed = [fusion, ...ordered.slice(segmentIndex + 1)];
      return fromStart ? trimmed : trimmed.reverse();
    }
    remaining -= length;
  }
  return [...points];
}

function wireRenderGeometry(wire: RoutedWire) {
  const trimmedEndpoints: string[] = [];
  let visiblePoints = [...wire.points];
  if (isIntegratedCableEndpoint(wire.fromEndpointId)) {
    visiblePoints = trimDiagramPolyline(visiblePoints, true, INTEGRATED_FUSION_OFFSET);
    trimmedEndpoints.push(wire.fromEndpointId);
  }
  if (isIntegratedCableEndpoint(wire.toEndpointId)) {
    visiblePoints = trimDiagramPolyline(visiblePoints, false, INTEGRATED_FUSION_OFFSET);
    trimmedEndpoints.push(wire.toEndpointId);
  }
  const segmentBridges = visiblePoints.slice(0, -1).map(() => [] as Array<RoutedWire["bridges"][number]>);
  wire.bridges.forEach((bridge) => {
    const candidates = visiblePoints.slice(0, -1).flatMap((first, segmentIndex) => {
      const second = visiblePoints[segmentIndex + 1];
      if (!bridgeIsOnSegment(bridge, first, second)) return [];
      const coordinate = axisCoordinate(bridge.point, bridge.axis);
      const clearance = Math.min(
        Math.abs(coordinate - axisCoordinate(first, bridge.axis)),
        Math.abs(coordinate - axisCoordinate(second, bridge.axis)),
      );
      return [{ segmentIndex, clearance }];
    });
    const selected = candidates.toSorted((first, second) => second.clearance - first.clearance)[0];
    if (selected) segmentBridges[selected.segmentIndex].push(bridge);
  });

  const jumpsBySegment = segmentBridges.map((bridges, segmentIndex) => {
    const first = visiblePoints[segmentIndex]; const second = visiblePoints[segmentIndex + 1];
    const axis = segmentAxis(first, second);
    if (!axis || bridges.length === 0) return [];
    const firstCoordinate = axisCoordinate(first, axis); const secondCoordinate = axisCoordinate(second, axis);
    const segmentLow = Math.min(firstCoordinate, secondCoordinate);
    const segmentHigh = Math.max(firstCoordinate, secondCoordinate);
    const coordinates = bridges.map((bridge) => axisCoordinate(bridge.point, axis)).toSorted((a, b) => a - b);
    const groups: number[][] = [];
    coordinates.forEach((coordinate) => {
      const group = groups.at(-1);
      if (!group || coordinate - group.at(-1)! > WIRE_JUMP_GROUP_GAP) groups.push([coordinate]);
      else group.push(coordinate);
    });
    const fixedCoordinate = axis === "horizontal" ? first.y : first.x;
    const direction = Math.sign(secondCoordinate - firstCoordinate);
    const jumps = groups.map((group): WireJumpGeometry => {
      const low = Math.max(segmentLow, group[0] - WIRE_JUMP_HALF_LENGTH);
      const high = Math.min(segmentHigh, group.at(-1)! + WIRE_JUMP_HALF_LENGTH);
      const startCoordinate = direction > 0 ? low : high; const endCoordinate = direction > 0 ? high : low;
      return {
        axis,
        start: pointOnAxis(axis, startCoordinate, fixedCoordinate),
        end: pointOnAxis(axis, endCoordinate, fixedCoordinate),
        rise: Math.min(WIRE_JUMP_RISE, Math.max(4, Math.abs(high - low) * 0.42)),
        crossingCount: group.length,
      };
    });
    return direction > 0 ? jumps : jumps.reverse();
  });

  const path = [`M${visiblePoints[0].x},${visiblePoints[0].y}`];
  visiblePoints.slice(0, -1).forEach((_, segmentIndex) => {
    jumpsBySegment[segmentIndex].forEach((jump) => {
      path.push(`L${jump.start.x},${jump.start.y}`, jumpCurveCommands(jump));
    });
    const end = visiblePoints[segmentIndex + 1];
    path.push(`L${end.x},${end.y}`);
  });
  return { path: path.join(" "), jumps: jumpsBySegment.flat(), trimmedEndpoints };
}

function wrappedLabel(label: string, maxCharacters: number, maxLines: number) {
  const words = label.trim().split(/\s+/); const lines: string[] = [];
  for (const word of words) {
    if (word.length > maxCharacters) return undefined;
    const candidate = lines.length ? `${lines.at(-1)} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      if (lines.length) lines[lines.length - 1] = candidate;
      else lines.push(candidate);
    } else if (lines.length < maxLines) lines.push(word);
    else return undefined;
  }
  return lines;
}

function truncatedLabel(label: string, maxCharacters: number, maxLines: number) {
  const lines: string[] = []; let remaining = label.trim().replace(/\s+/g, " ");
  while (remaining && lines.length < maxLines) {
    if (remaining.length <= maxCharacters) { lines.push(remaining); break; }
    const lastLine = lines.length === maxLines - 1;
    const limit = Math.max(2, maxCharacters - (lastLine ? 1 : 0));
    const wordBoundary = remaining.lastIndexOf(" ", limit);
    const cut = wordBoundary >= Math.ceil(limit * 0.5) ? wordBoundary : limit;
    lines.push(`${remaining.slice(0, cut).trim()}${lastLine ? "…" : ""}`);
    remaining = remaining.slice(cut).trim();
  }
  return lines;
}

function deviceLabelLayout(label: string, width: number, height: number, viewScale: number) {
  const minimumFontSize = Math.max(15, 8 / Math.max(LABEL_SCALE_FLOOR, viewScale));
  const maximumFontSize = Math.max(28, minimumFontSize);
  for (let fontSize = maximumFontSize; fontSize >= minimumFontSize; fontSize -= 0.5) {
    const maxCharacters = Math.max(3, Math.floor((width - 30) / (fontSize * 0.59)));
    const maxLines = Math.max(1, Math.min(3, Math.floor((height - 22) / (fontSize * 1.16))));
    const lines = wrappedLabel(label, maxCharacters, maxLines);
    if (lines) return { lines, fontSize, lineHeight: fontSize * 1.16 };
  }
  const fontSize = minimumFontSize;
  const maxCharacters = Math.max(3, Math.floor((width - 30) / (fontSize * 0.59)));
  const maxLines = Math.max(1, Math.min(3, Math.floor((height - 22) / (fontSize * 1.16))));
  return { lines: truncatedLabel(label, maxCharacters, maxLines), fontSize, lineHeight: fontSize * 1.16 };
}

function PortGraphic({ port, point, ownerLabel, viewScale, onSelect, boundary = false }: {
  port: DiagramPort; point: Point; ownerLabel: string; viewScale: number;
  onSelect: (selection: GraphSelection) => void;
  boundary?: boolean;
}) {
  const textWidth = Math.max(74, Math.min(310, port.label.length * 6.7 + 20));
  const inverseScale = 1 / Math.max(LABEL_SCALE_FLOOR, viewScale);
  const labelX = (port.side === "input" ? boundary ? 12 : -textWidth - 12
    : port.side === "output" ? boundary ? -textWidth - 12 : 12 : -textWidth / 2) * inverseScale;
  const labelY = (port.side === "neutral" ? boundary ? -40 : 15 : port.side === "top" ? -40 : -14) * inverseScale;
  return (
    <g className="diagram-port-anchor" transform={`translate(${point.x} ${point.y})`}>
      <g className={`diagram-port diagram-port-${port.side}`}
        data-port-side={port.side} data-boundary-port={boundary ? "true" : "false"}
        data-endpoint-id={port.selectionKey}
        role="button" tabIndex={0} aria-label={`${ownerLabel} · ${port.label}`}
        onClick={(event) => { event.stopPropagation(); onSelect({ type: "conductor", conductorKey: port.selectionKey, connectionId: port.connectionId }); }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation(); onSelect({ type: "conductor", conductorKey: port.selectionKey, connectionId: port.connectionId });
        } }}>
        <circle r={PORT_RADIUS + 6} className="diagram-port-hit" />
        <circle r={PORT_RADIUS} className="diagram-conductor" style={{ fill: diagramConductorColor[port.kind] }} />
        <title>{port.label}</title>
      </g>
      <g className="diagram-port-label" transform={`translate(${labelX} ${labelY}) scale(${inverseScale})`}>
        <rect width={textWidth} height="25" rx="5" /><text x="10" y="17">{port.label}</text>
      </g>
    </g>
  );
}

function centroid(points: readonly Point[]) {
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: center.x / points.length, y: center.y / points.length };
}

export function UnifiedSystemDiagram({ fadePurchased, onFadePurchasedChange, onSelect, onClearSelection,
  inspectorOpen = false }: Props) {
  const [activeJunctionId, setActiveJunctionId] = useState<string>();
  const [hoveredWireId, setHoveredWireId] = useState<string>();
  const [view, setViewState] = useState<ViewTransform>({ x: 0, y: 0, scale: 0.5 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const diagramRef = useRef<HTMLElement>(null); const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<SVGGElement>(null); const viewRef = useRef(view);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: ViewTransform; center: Point; distance: number; world: Point } | undefined>(undefined);
  const nativeGesture = useRef<{ view: ViewTransform; scale: number; world: Point } | undefined>(undefined);
  const moved = useRef(false); const suppressClickUntil = useRef(0);
  const viewFrame = useRef<number | undefined>(undefined);
  const viewCommitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rememberedViews = useRef(new Map<string, ViewTransform>());
  const mountedLayoutKey = useRef<string | undefined>(undefined);
  const layout = useMemo(() => hydrateDiagramLayout(activeJunctionId), [activeJunctionId]);
  const wireWidthByEndpoint = useMemo(() => new Map(layout.wires.flatMap((wire) => [[wire.fromEndpointId, wire.width], [wire.toEndpointId, wire.width]] as const)), [layout]);
  const renderedWires = useMemo(() => layout.wires.map((wire) => ({
    wire,
    ...wireRenderGeometry(wire),
  })), [layout]);
  const hoveredWire = renderedWires.find(({ wire }) => wire.route.id === hoveredWireId);
  const applyViewToDom = useCallback((value: ViewTransform) => {
    contentRef.current?.setAttribute("transform", `translate(${value.x} ${value.y}) scale(${value.scale})`);
    if (diagramRef.current) {
      diagramRef.current.dataset.viewX = value.x.toFixed(2);
      diagramRef.current.dataset.viewY = value.y.toFixed(2);
      diagramRef.current.dataset.viewScale = value.scale.toFixed(4);
    }
  }, []);
  const setView = useCallback((next: ViewTransform | ((previous: ViewTransform) => ViewTransform)) => {
    const value = typeof next === "function" ? next(viewRef.current) : next;
    viewRef.current = value;
    if (viewCommitTimer.current !== undefined) clearTimeout(viewCommitTimer.current);
    // Reconcile label sizing and toolbar text only after the gesture becomes
    // idle. During a pinch, Chromium receives one transform mutation per RAF
    // instead of reconciling the full SVG tree for every wheel event.
    viewCommitTimer.current = setTimeout(() => {
      viewCommitTimer.current = undefined; setViewState(viewRef.current);
    }, 90);
    if (viewFrame.current === undefined) viewFrame.current = requestAnimationFrame(() => {
      viewFrame.current = undefined; applyViewToDom(viewRef.current);
    });
  }, [applyViewToDom]);
  const setViewImmediately = useCallback((value: ViewTransform) => {
    viewRef.current = value;
    if (viewCommitTimer.current !== undefined) {
      clearTimeout(viewCommitTimer.current);
      viewCommitTimer.current = undefined;
    }
    if (viewFrame.current !== undefined) {
      cancelAnimationFrame(viewFrame.current);
      viewFrame.current = undefined;
    }
    applyViewToDom(value);
    setViewState(value);
  }, [applyViewToDom]);
  const fitLayout = useCallback((target = layout) => {
    if (!viewportSize.width || !viewportSize.height) return;
    const padding = 46;
    const scale = Math.max(MIN_SCALE, Math.min(1.18,
      (viewportSize.width - padding * 2) / target.width, (viewportSize.height - padding * 2) / target.height));
    setViewImmediately({ scale, x: (viewportSize.width - target.width * scale) / 2,
      y: (viewportSize.height - target.height * scale) / 2 });
  }, [layout, setViewImmediately, viewportSize]);
  const rememberCurrentView = useCallback(() => {
    rememberedViews.current.set(layout.key, { ...viewRef.current });
  }, [layout.key]);
  const enterJunction = useCallback((junctionId: string) => {
    rememberCurrentView();
    onClearSelection?.();
    setActiveJunctionId(junctionId);
  }, [onClearSelection, rememberCurrentView]);
  const exitJunction = useCallback(() => {
    rememberCurrentView();
    onClearSelection?.();
    setActiveJunctionId(undefined);
  }, [onClearSelection, rememberCurrentView]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(viewport); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!viewportSize.width || mountedLayoutKey.current === layout.key) return;
    mountedLayoutKey.current = layout.key;
    const remembered = rememberedViews.current.get(layout.key);
    if (remembered) setViewImmediately(remembered);
    else fitLayout(layout);
  }, [fitLayout, layout, setViewImmediately, viewportSize]);
  useLayoutEffect(() => { applyViewToDom(viewRef.current); }, [applyViewToDom, layout, view]);
  useEffect(() => () => {
    if (viewFrame.current !== undefined) cancelAnimationFrame(viewFrame.current);
    if (viewCommitTimer.current !== undefined) clearTimeout(viewCommitTimer.current);
  }, []);
  useEffect(() => {
    if (!activeJunctionId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (inspectorOpen) return;
      event.preventDefault();
      event.stopPropagation();
      exitJunction();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeJunctionId, exitJunction, inspectorOpen]);
  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect(); return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);
  const beginGesture = useCallback(() => {
    const values = [...pointers.current.values()];
    if (values.length === 0) { gesture.current = undefined; return; }
    const center = centroid(values);
    const distance = values.length > 1 ? Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) : 0;
    const current = viewRef.current;
    gesture.current = { view: current, center, distance,
      world: { x: (center.x - current.x) / current.scale, y: (center.y - current.y) / current.scale } };
  }, []);
  const zoomAt = useCallback((point: Point, factor: number) => {
    setView((current) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
      const world = { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale };
      return { scale, x: point.x - world.x * scale, y: point.y - world.y * scale };
    });
  }, [setView]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // React delegates wheel events at the document root, where Chromium may
    // treat the listener as passive. A native non-passive listener on the
    // patcher itself guarantees that trackpad pinch never escapes to browser
    // page zoom. Plain two-finger scroll remains screen-space pan.
    const handleWheel = (rawEvent: Event) => {
      const event = rawEvent as WheelEvent;
      event.preventDefault(); event.stopPropagation();
      if (event.ctrlKey) {
        zoomAt(localPoint(event.clientX, event.clientY), Math.exp(-event.deltaY * 0.012));
        return;
      }
      setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    type NativeGestureEvent = Event & { clientX?: number; clientY?: number; scale?: number };
    const gesturePoint = (event: NativeGestureEvent) => event.clientX === undefined || event.clientY === undefined
      ? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }
      : localPoint(event.clientX, event.clientY);
    const handleGestureStart = (rawEvent: Event) => {
      const event = rawEvent as NativeGestureEvent; event.preventDefault(); event.stopPropagation();
      const point = gesturePoint(event); const current = viewRef.current;
      nativeGesture.current = { view: current, scale: event.scale ?? 1,
        world: { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale } };
    };
    const handleGestureChange = (rawEvent: Event) => {
      const event = rawEvent as NativeGestureEvent; event.preventDefault(); event.stopPropagation();
      const initial = nativeGesture.current;
      if (!initial) return;
      const point = gesturePoint(event);
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
        initial.view.scale * (event.scale ?? 1) / Math.max(0.01, initial.scale)));
      setView({ scale, x: point.x - initial.world.x * scale, y: point.y - initial.world.y * scale });
    };
    const handleGestureEnd = (event: Event) => {
      event.preventDefault(); event.stopPropagation(); nativeGesture.current = undefined;
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("gesturestart", handleGestureStart, { passive: false });
    viewport.addEventListener("gesturechange", handleGestureChange, { passive: false });
    viewport.addEventListener("gestureend", handleGestureEnd, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("gesturestart", handleGestureStart);
      viewport.removeEventListener("gesturechange", handleGestureChange);
      viewport.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [localPoint, setView, zoomAt]);

  return (
    <section ref={diagramRef} className="unified-diagram" data-diagram="canonical-graph-subpatch" data-diagram-scope={layout.scope}
      data-junction-id={activeJunctionId ?? ""} data-device-count={dseRuntime.devices.length}
      data-wire-count={dseRuntime.routes.length} data-visible-device-count={layout.nodes.length}
      data-visible-wire-count={layout.wires.length} data-junctions-abstracted={layout.scope === "system" ? "true" : "false"}
      data-orthogonal-t-join-count={layout.nodes.filter((node) => node.device.diagramJoinGeometry === "orthogonal-t").length}
      data-junction-internals-visible={layout.scope === "junction" ? "true" : "false"}
      data-coincident-wire-segments={layout.coincidentSegments} data-conductor-overlaps={layout.conductorOverlaps}
      data-non-orthogonal-wire-segments={layout.nonOrthogonalSegments}
      data-unbridged-wire-crossings={layout.unbridgedCrossings} data-bridged-wire-crossings={layout.bridgedCrossings}
      data-parallel-wire-envelope-overlaps={layout.parallelEnvelopeOverlaps}
      data-minimum-parallel-wire-separation={layout.minimumParallelWireSeparation}
      data-routing-lane-spacing={MIN_WIRE_LANE_SPACING}
      data-wire-node-body-crossings={layout.nodeBodyCrossings}
      data-masked-wire-node-body-crossings={layout.maskedNodeBodyCrossings}
      data-node-overlaps={layout.nodeOverlaps} data-wire-turns={layout.wireTurns}
      data-wire-length={layout.wireLength}
      data-routing-fallbacks={layout.routingFallbacks} data-layout-hydration="index-only"
      data-current-safety-status={dseRuntime.diagnostics.currentSafety.status}
      data-current-safety-errors={dseRuntime.diagnostics.currentSafety.errors.length}
      data-current-safety-warnings={dseRuntime.diagnostics.currentSafety.warnings.length}
      data-precomputed-layout-ms={layout.precomputedLayoutMs?.toFixed(1)}
      data-diagram-routing-ms="0.0" data-layout-source="build-generated-artifact"
      data-wire-geometry="orthogonal-grid" data-wire-crossing-rendering="arched-jumps"
      data-wire-continuity="single-path-with-integrated-jumps"
      data-port-layout="inputs-left-outputs-right-storage-signals-bottom" data-page-zoom-captured="true"
      data-zoom-rendering="raf-transform-idle-react-reconcile"
      data-view-memory="per-layout-preserved" data-earth-color={diagramConductorColor.earth}
      data-escape-navigation={inspectorOpen ? "close-inspector" : activeJunctionId ? "back-to-system" : "inactive"}
      data-view-x={view.x.toFixed(2)} data-view-y={view.y.toFixed(2)} data-view-scale={view.scale.toFixed(4)}
      data-touch-navigation="pinch-zoom-two-finger-pan">
      <div className="diagram-unified-toolbar">
        <div className="diagram-title-stack">
          <div className="diagram-breadcrumbs">
            {activeJunctionId && <button type="button" className="diagram-back-button"
              onClick={exitJunction}
              aria-label="Back to full-system diagram"><span aria-hidden="true">←</span> System</button>}
            <strong>{layout.junction?.label ?? "Detailed wiring diagram"}</strong>
          </div>
          <span>{layout.scope === "system"
            ? `PV / sources → protection & conversion → loads · batteries below · ${layout.nodes.length} devices`
            : `${layout.boundaryPorts.filter((port) => port.side === "input").length} incoming left · `
              + `${layout.boundaryPorts.filter((port) => port.side === "output").length} outgoing right · `
              + `${layout.boundaryPorts.filter((port) => port.side === "neutral").length} battery / earth / data below`}</span>
        </div>
        <div className="diagram-zoom-controls" aria-label="Diagram zoom">
          <CurrentSafetySummary />
          <button type="button" onClick={() => zoomAt({ x: viewportSize.width / 2, y: viewportSize.height / 2 }, 0.82)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => fitLayout()} aria-label="Fit diagram">{Math.round(view.scale * 100)}%</button>
          <button type="button" onClick={() => zoomAt({ x: viewportSize.width / 2, y: viewportSize.height / 2 }, 1.22)} aria-label="Zoom in">+</button>
          <label className="fade-toggle"><input type="checkbox" checked={fadePurchased}
            onChange={(event) => onFadePurchasedChange(event.target.checked)} />Fade purchased</label>
        </div>
      </div>
      <div ref={viewportRef} className="unified-diagram-viewport"
        role="button" tabIndex={0} aria-label="Interactive wiring diagram canvas"
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && inspectorOpen) onClearSelection?.();
        }}
        onClick={() => {
          if (performance.now() < suppressClickUntil.current) return;
          onClearSelection?.();
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 1) return;
          event.preventDefault();
          // Pointer capture retargets the eventual mouse click to the viewport
          // in Chromium. Touch needs capture for a stable two-finger gesture;
          // mouse clicks must remain targeted at nodes and conductors.
          if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, localPoint(event.clientX, event.clientY)); moved.current = false; beginGesture();
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, localPoint(event.clientX, event.clientY));
          const values = [...pointers.current.values()];
          if (!(event.pointerType === "mouse" || values.length >= 2) || !gesture.current) return;
          const center = centroid(values);
          if (Math.hypot(center.x - gesture.current.center.x, center.y - gesture.current.center.y) > 3) moved.current = true;
          const distance = values.length > 1 ? Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y) : gesture.current.distance;
          const scale = values.length > 1 && gesture.current.distance > 4
            ? Math.max(MIN_SCALE, Math.min(MAX_SCALE, gesture.current.view.scale * distance / gesture.current.distance))
            : gesture.current.view.scale;
          event.preventDefault(); setView({ scale, x: center.x - gesture.current.world.x * scale,
            y: center.y - gesture.current.world.y * scale });
        }}
        onPointerUp={(event) => { pointers.current.delete(event.pointerId);
          if (moved.current) suppressClickUntil.current = performance.now() + 180; beginGesture(); }}
        onPointerCancel={(event) => { pointers.current.delete(event.pointerId); beginGesture(); }}>
        <svg className="unified-diagram-svg" width="100%" height="100%" role="img"
          aria-label={layout.scope === "system" ? "Detailed DSE Fiji electrical wiring diagram"
            : `${layout.junction!.label} internal wiring subpatch`}>
          <g ref={contentRef} key={layout.key} className="diagram-content"
            transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <g className="diagram-wire-layer">
              {renderedWires.map(({ wire, path, jumps, trimmedEndpoints }) => <g key={wire.route.id}>
                <path d={path}
                  className={`diagram-wire ${wire.route.status === "hold" ? "hold" : ""}`}
                  style={{ stroke: wire.color, strokeWidth: wire.width }} data-connection-id={wire.route.id}
                  data-from-endpoint={wire.fromEndpointId} data-to-endpoint={wire.toEndpointId}
                  data-integrated-fusion-trimmed={trimmedEndpoints.length > 0
                    ? trimmedEndpoints.join(" ") : undefined}
                  data-crossing-count={wire.bridges.length} data-jump-count={jumps.length}
                  onPointerEnter={() => setHoveredWireId(wire.route.id)}
                  onPointerLeave={() => setHoveredWireId((current) => current === wire.route.id ? undefined : current)}
                  onClick={(event) => { event.stopPropagation();
                    const conductorKey = dseRuntime.conductorByKey.has(wire.fromEndpointId)
                      ? wire.fromEndpointId : wire.route.from;
                    onSelect({ type: "conductor", conductorKey, connectionId: wire.route.id }); }}>
                  <title>{wire.route.label ?? wire.route.id}</title>
                </path>
              </g>)}
              <g className="diagram-local-bridge-layer" aria-hidden="true">
                {renderedWires.flatMap(({ wire, jumps }) => jumps.map((jump, index) => <g
                  key={`${wire.route.id}-bridge-${index}`} data-connection-id={wire.route.id}
                  data-crossing-count={jump.crossingCount}>
                  <path d={localJumpPath(jump)} className="diagram-wire-local-underlay"
                    style={{ strokeWidth: wire.width + 6 }} />
                  <path d={localJumpPath(jump)} className="diagram-wire-local-overpass"
                    style={{ stroke: wire.color, strokeWidth: wire.width }} />
                </g>))}
              </g>
            </g>
            {layout.nodes.map((node) => {
              const faded = fadePurchased && isPurchasedDevice(node.device);
              const label = deviceLabelLayout(node.device.label, node.width, node.height, view.scale);
              const wireJoin = isDiagramJoin(node.device);
              const rigidRail = node.device.presentation === "rigid-rail";
              const integratedCable = node.device.presentation === "integrated-cable-breakout"
                ? node.device.conductors.find((conductor) => (
                  conductor.kind === "multicore" && (conductor.internalMates?.length ?? 0) >= 2
                ))
                : undefined;
              const integratedCablePort = integratedCable
                ? node.ports.find((port) => port.id === integratedCable.id)
                : undefined;
              const integratedCablePoint = integratedCablePort ? portPoint(node, integratedCablePort) : undefined;
              const integratedFusion = integratedCablePort && integratedCablePoint ? (() => {
                const local = { x: integratedCablePoint.x - node.x, y: integratedCablePoint.y - node.y };
                if (integratedCablePort.side === "input") return { x: -node.width / 2 - 22, y: local.y };
                if (integratedCablePort.side === "output") return { x: node.width / 2 + 22, y: local.y };
                return { x: local.x, y: node.height / 2 + 22 };
              })() : undefined;
              const joinArmWidths = wireJoin ? node.ports.map((port) => wireJoinArmWidth(node, port, wireWidthByEndpoint)) : [];
              const railGroups = rigidRail
                ? Object.values(Object.groupBy(node.ports, (port) => port.kind)).filter(Boolean)
                : [];
              return <g key={node.device.id}
                className={`diagram-device diagram-device-${node.device.kind}${node.abstractJunction ? " diagram-subpatch-node" : ""}${wireJoin ? " diagram-wire-join-node" : ""}${node.device.diagramJoinGeometry === "orthogonal-t" ? " diagram-wire-join-orthogonal-t" : ""}${rigidRail ? " diagram-rigid-rail-node" : ""}${faded ? " faded" : ""}${node.device.status === "hold" ? " hold" : ""}`}
                transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={node.device.label}
                data-device-id={node.device.id} data-join-geometry={node.device.diagramJoinGeometry ?? ""}
                onClick={(event) => { event.stopPropagation(); if (performance.now() < suppressClickUntil.current) return;
                  if (node.abstractJunction) { enterJunction(node.device.id); return; }
                  onSelect({ type: "device", deviceId: node.device.id }); }}
                onKeyDown={(event) => { if (event.key !== "Enter" && event.key !== " ") return;
                  if (node.abstractJunction) { enterJunction(node.device.id); return; }
                  onSelect({ type: "device", deviceId: node.device.id }); }}>
                {wireJoin ? <>
                  <circle className="diagram-wire-join-hit" r={node.width / 2} />
                  {node.ports.map((port) => {
                    const point = portPoint(node, port);
                    return <path key={port.id} className="diagram-wire-join-arm"
                      data-endpoint-id={`${node.device.id}.${port.id}`}
                      d={`M${point.x - node.x},${point.y - node.y} L0,0`}
                      style={{ stroke: diagramConductorColor[port.kind], strokeWidth: wireJoinArmWidth(node, port, wireWidthByEndpoint) }} />;
                  })}
                  <circle className="diagram-wire-join-center"
                    r={Math.max(5, ...joinArmWidths.map((width) => width / 2 + 2))}
                    style={{ fill: diagramConductorColor[node.ports[0]?.kind ?? "data"] }} />
                </> : rigidRail ? <>
                  <rect className="diagram-rigid-rail-hit" x={-node.width / 2} y={-node.height / 2}
                    width={node.width} height={node.height} rx="8" />
                  {railGroups.map((ports) => {
                    const present = ports!; const points = present.map((port) => portPoint(node, port));
                    const left = Math.min(...points.map((point) => point.x - node.x)) - 12;
                    const right = Math.max(...points.map((point) => point.x - node.x)) + 12;
                    return <g key={present[0].kind}>
                      <path className="diagram-rigid-rail-backbone" d={`M${left},0 H${right}`} />
                      <path className="diagram-rigid-rail-core" d={`M${left},0 H${right}`}
                        style={{ stroke: diagramConductorColor[present[0].kind] }} />
                      {present.map((port, index) => <path key={port.id} className="diagram-rigid-rail-tooth"
                        d={`M${points[index].x - node.x},${points[index].y - node.y} V0`}
                        style={{ stroke: diagramConductorColor[port.kind] }} />)}
                    </g>;
                  })}
                  <text className="diagram-rigid-rail-label" textAnchor="middle" y="-15">{node.device.label}</text>
                </> : <>
                  <rect x={-node.width / 2} y={-node.height / 2} width={node.width} height={node.height}
                    rx={node.device.kind === "breaker" ? 5 : 11} />
                  {integratedCable && integratedFusion && <g className="diagram-integrated-breakout"
                    data-integrated-cable-endpoint={`${node.device.id}.${integratedCable.id}`}>
                    {integratedCable.internalMates?.map((mateId) => {
                      const mate = node.ports.find((port) => port.id === mateId);
                      if (!mate) return null;
                      const point = portPoint(node, mate);
                      return <path key={mate.id} className="diagram-integrated-breakout-arm"
                        data-endpoint-id={`${node.device.id}.${mate.id}`}
                        d={`M${point.x - node.x},${point.y - node.y} L${integratedFusion.x},${integratedFusion.y}`}
                        style={{ stroke: diagramConductorColor[mate.kind], strokeWidth: wireJoinArmWidth(node, mate, wireWidthByEndpoint) }} />;
                    })}
                    <circle className="diagram-integrated-breakout-center" cx={integratedFusion.x}
                      cy={integratedFusion.y} r="5" />
                  </g>}
                  {node.abstractJunction && <>
                    <path className="diagram-subpatch-arrow" d={`M${node.width / 2 - 42},${-node.height / 2 + 27} h18 m-7,-7 7,7 -7,7`} />
                    {node.ports.some((port) => port.side === "input") && <text className="diagram-junction-edge-label"
                      x={-node.width / 2 + 20} y={-node.height / 2 + 30}>INPUTS</text>}
                    {node.ports.some((port) => port.side === "output") && <text className="diagram-junction-edge-label"
                      textAnchor="end" x={node.width / 2 - 52} y={-node.height / 2 + 30}>OUTPUTS</text>}
                  </>}
                  <text className="diagram-device-title" textAnchor="middle"
                    style={{ fontSize: label.fontSize }}
                    y={-(label.lines.length - 1) * label.lineHeight / 2 + label.fontSize * 0.34}>
                    {label.lines.map((line, index) => <tspan key={`${line}-${index}`} x="0"
                      dy={index === 0 ? 0 : label.lineHeight}>{line}</tspan>)}
                  </text>
                </>}
                <title>{node.device.label}</title>
              </g>;
            })}
            {layout.nodes.flatMap((node) => isDiagramJoin(node.device) ? [] : node.ports
              .filter((port) => !isIntegratedCableEndpoint(port.selectionKey))
              .map((port) => <PortGraphic key={`${node.device.id}-${port.id}`} port={port} point={portPoint(node, port)}
                ownerLabel={node.device.label} viewScale={view.scale} onSelect={onSelect} />))}
            {layout.scope === "junction" && <g className="diagram-boundary-glands">
              {Object.entries(Object.groupBy(layout.boundaryPorts, (port) => port.glandId ?? port.id)).map(([glandId, ports]) => {
                const present = ports!; const vertical = present[0].side !== "neutral";
                const minimum = Math.min(...present.map((port) => vertical ? port.point.y : port.point.x));
                const maximum = Math.max(...present.map((port) => vertical ? port.point.y : port.point.x));
                const anchor = present[0].point;
                return <g key={glandId}><rect x={vertical ? anchor.x - 13 : minimum - 15}
                  y={vertical ? minimum - 15 : anchor.y - 13}
                  width={vertical ? 26 : maximum - minimum + 30}
                  height={vertical ? maximum - minimum + 30 : 26} rx="13" />
                </g>;
              })}
            </g>}
            {layout.boundaryPorts.map((port) => <PortGraphic key={port.id} port={port} point={port.point}
              ownerLabel={layout.junction!.label} viewScale={view.scale} onSelect={onSelect} boundary />)}
            {hoveredWire && <g className="diagram-wire-hover-layer" aria-hidden="true"
              data-connection-id={hoveredWire.wire.route.id} data-jump-count={hoveredWire.jumps.length}>
              <path d={hoveredWire.path} className="diagram-wire-hover-clearance"
                style={{ strokeWidth: HOVERED_WIRE_WIDTH + HOVERED_WIRE_CLEARANCE }} />
              <path d={hoveredWire.path}
                className={`diagram-wire-foreground ${hoveredWire.wire.route.status === "hold" ? "hold" : ""}`}
                style={{ stroke: hoveredWire.wire.color, strokeWidth: HOVERED_WIRE_WIDTH }} />
            </g>}
          </g>
        </svg>
      </div>
    </section>
  );
}
