"use client";

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  solvePhysicalLayout,
  type LayoutVector,
  type PhysicalCableRoute,
  type PhysicalDevice,
  type PhysicalLayoutInput,
  type PhysicalLayoutSpecification,
} from "@/app/physicalLayoutSolver";

export type WallDeviceOverrides = NonNullable<PhysicalLayoutInput["deviceOverrides"]>;

export type DetailedCablePath = {
  id: string;
  color: number;
  points: LayoutVector[];
  radiusM: number;
  visibility: "context" | "junction";
};

type WallLayoutEditorProps = {
  committedLayout: PhysicalLayoutSpecification;
  detailedCablePaths: DetailedCablePath[];
  draftLayout: PhysicalLayoutSpecification;
  draftOverrides: WallDeviceOverrides;
  detailedRouteIssues: number | null;
  rebuilding: boolean;
  onCommit: (overrides: WallDeviceOverrides, layout: PhysicalLayoutSpecification) => void;
  onDraftChange: (overrides: WallDeviceOverrides, layout: PhysicalLayoutSpecification) => void;
};

type PlaceholderConnection = {
  id: string;
  kind: "positive" | "negative" | "midpoint" | "data" | "earth" | "ac";
  routeId: string;
};

type DragState = {
  deviceId: string;
  grabOffset: readonly [number, number];
  moved: boolean;
  nextLayout: PhysicalLayoutSpecification;
  nextOverrides: WallDeviceOverrides;
  pointerId: number;
  startOverrides: WallDeviceOverrides;
};

const DEVICE_LABELS: Record<string, string> = {
  generatorInlet: "Generator inlet",
  pvEntry: "PV entry",
  smartSolar: "SmartSolar",
  multiPlus: "MultiPlus-II",
  acBoard: "AC protection",
  junction: "Junction box",
  ekran: "Ekrano GX",
  unifi: "UniFi Express",
  usb: "USB charging",
  orion: "Orion 24/12",
  balancerA: "Balancer A",
  balancerB: "Balancer B",
  classTA: "Class T A",
  classTB: "Class T B",
  earthBar: "PE bar",
};

const DEVICE_CLASSES: Record<string, string> = {
  generatorInlet: "protection",
  pvEntry: "protection",
  smartSolar: "victron",
  multiPlus: "victron",
  acBoard: "protection",
  junction: "junction",
  ekran: "monitor",
  unifi: "network",
  usb: "distribution",
  orion: "victron",
  balancerA: "victron",
  balancerB: "victron",
  classTA: "protection",
  classTB: "protection",
  earthBar: "earth",
};

const DEVICE_SHORT_LABELS: Record<string, string> = {
  generatorInlet: "GEN IN",
  pvEntry: "PV PROTECTION",
  smartSolar: "MPPT",
  multiPlus: "MULTIPLUS",
  acBoard: "AC OUT",
  junction: "JUNCTION BOX",
  ekran: "EKRANO GX",
  unifi: "UNIFI",
  usb: "USB",
  orion: "ORION",
  balancerA: "BAL A",
  balancerB: "BAL B",
  classTA: "CLASS T A",
  classTB: "CLASS T B",
  earthBar: "PE",
};

function placeholderKind(route: PhysicalCableRoute): PlaceholderConnection["kind"] {
  if (route.id.includes("midpoint")) return "midpoint";
  if (route.kind === "dc-positive" || route.kind === "pv-positive") return "positive";
  if (route.kind === "dc-negative" || route.kind === "pv-negative") return "negative";
  if (route.kind === "three-core-ac") return "ac";
  return route.kind;
}

const roundPosition = (value: number) => Math.round(value * 100) / 100;

function editorPoint(
  world: LayoutVector,
  boardLeft: number,
  boardTop: number,
) {
  return [world[0] - boardLeft, boardTop - world[1]] as const;
}

function placeholderPath(
  connection: PlaceholderConnection,
  layout: PhysicalLayoutSpecification,
) {
  const board = layout.surfaces.equipmentBoard;
  const boardLeft = board.center[0] - board.size[0] / 2;
  const boardTop = board.center[1] + board.size[1] / 2;
  const route = layout.routes[connection.routeId];
  return route ? projectedDetailedPath(route.points, boardLeft, boardTop) : "";
}

function projectedDetailedPath(
  points: LayoutVector[],
  boardLeft: number,
  boardTop: number,
) {
  const projected = points
    .map((point) => editorPoint(point, boardLeft, boardTop))
    .filter((point, index, all) => (
      index === 0 ||
      Math.hypot(point[0] - all[index - 1][0], point[1] - all[index - 1][1]) > 0.0001
    ));
  if (projected.length < 2) return "";
  return projected.map((point, index) => (
    `${index === 0 ? "M" : "L"} ${point[0].toFixed(4)} ${point[1].toFixed(4)}`
  )).join(" ");
}

function colorHex(color: number) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function WallLayoutEditor({
  committedLayout,
  detailedCablePaths,
  draftLayout,
  draftOverrides,
  detailedRouteIssues,
  rebuilding,
  onCommit,
  onDraftChange,
}: WallLayoutEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [selectedId, setSelectedId] = useState("junction");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const board = draftLayout.surfaces.equipmentBoard;
  const boardLeft = board.center[0] - board.size[0] / 2;
  const boardTop = board.center[1] + board.size[1] / 2;
  const boardRight = board.center[0] + board.size[0] / 2;
  const boardBottom = board.center[1] - board.size[1] / 2;
  const editableDevices = Object.values(draftLayout.devices)
    .filter((device) => device.mounting === "wall" && device.id !== "equipmentBoard");
  const overlapIds = new Set(draftLayout.metrics.wallOverlapIssues.flatMap((issue) => issue.split(":")));
  const selected = draftLayout.devices[selectedId];
  const showDetailedRoutes = !draggingId && !rebuilding && detailedCablePaths.length > 0;
  const placeholderConnections: PlaceholderConnection[] = Object.values(draftLayout.routes)
    .filter((route) => route.routing === "automatic-rectilinear")
    .map((route) => ({ id: route.id, routeId: route.id, kind: placeholderKind(route) }));

  function pointerWorld(event: ReactPointerEvent<SVGGElement>) {
    const svg = svgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [boardLeft + point.x, boardTop - point.y] as const;
  }

  function moveDevice(event: ReactPointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    const world = pointerWorld(event);
    const device = draftLayout.devices[drag.deviceId];
    if (!world || !device) return drag;
    const x = roundPosition(Math.min(
      boardRight - device.size[0] / 2,
      Math.max(boardLeft + device.size[0] / 2, world[0] + drag.grabOffset[0]),
    ));
    const y = roundPosition(Math.min(
      boardTop - device.size[1] / 2,
      Math.max(boardBottom + device.size[1] / 2, world[1] + drag.grabOffset[1]),
    ));
    const nextOverrides: WallDeviceOverrides = {
      ...drag.startOverrides,
      [device.id]: { position: [x, y, device.position[2]] },
    };
    const nextLayout = solvePhysicalLayout({ deviceOverrides: nextOverrides });
    const moved = drag.moved ||
      Math.abs(x - committedLayout.devices[device.id].position[0]) > 0.001 ||
      Math.abs(y - committedLayout.devices[device.id].position[1]) > 0.001;
    const nextDrag = { ...drag, moved, nextLayout, nextOverrides };
    dragRef.current = nextDrag;
    onDraftChange(nextOverrides, nextLayout);
    return nextDrag;
  }

  function beginDrag(event: ReactPointerEvent<SVGGElement>, device: PhysicalDevice) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(device.id);
    setDraggingId(device.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    const world = pointerWorld(event);
    dragRef.current = {
      deviceId: device.id,
      grabOffset: world
        ? [device.position[0] - world[0], device.position[1] - world[1]]
        : [0, 0],
      moved: false,
      nextLayout: draftLayout,
      nextOverrides: draftOverrides,
      pointerId: event.pointerId,
      startOverrides: draftOverrides,
    };
  }

  function moveDeviceWithKeyboard(event: ReactKeyboardEvent<SVGGElement>, device: PhysicalDevice) {
    const movement: Record<string, readonly [number, number]> = {
      ArrowLeft: [-0.05, 0],
      ArrowRight: [0.05, 0],
      ArrowUp: [0, 0.05],
      ArrowDown: [0, -0.05],
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.2 : 1;
    const x = roundPosition(Math.min(
      boardRight - device.size[0] / 2,
      Math.max(boardLeft + device.size[0] / 2, device.position[0] + delta[0] * step),
    ));
    const y = roundPosition(Math.min(
      boardTop - device.size[1] / 2,
      Math.max(boardBottom + device.size[1] / 2, device.position[1] + delta[1] * step),
    ));
    const nextOverrides: WallDeviceOverrides = {
      ...draftOverrides,
      [device.id]: { position: [x, y, device.position[2]] },
    };
    const nextLayout = solvePhysicalLayout({ deviceOverrides: nextOverrides });
    setSelectedId(device.id);
    onDraftChange(nextOverrides, nextLayout);
    onCommit(nextOverrides, nextLayout);
  }

  function finishDrag(event: ReactPointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDraggingId(null);
    if (drag.moved) onCommit(drag.nextOverrides, drag.nextLayout);
  }

  return (
    <section
      className={`wall-layout-editor ${draggingId ? "is-dragging" : ""}`}
      data-layout-dragging={draggingId ?? "none"}
      data-layout-routing-mode={draggingId ? "placeholder" : rebuilding ? "rebuilding-full" : "full-current"}
      data-detailed-route-issues={detailedRouteIssues ?? "pending"}
      data-placeholder-route-count={showDetailedRoutes ? 0 : placeholderConnections.length}
      data-detailed-route-count={showDetailedRoutes ? detailedCablePaths.length : 0}
      data-detailed-route-point-count={showDetailedRoutes
        ? detailedCablePaths.reduce((total, cable) => total + cable.points.length, 0)
        : 0}
      data-route-projection-source={showDetailedRoutes ? "final-threejs-centerlines" : "automatic-rectilinear-preview"}
      data-selected-device={selectedId}
      aria-label="Editable two-dimensional equipment wall layout"
    >
      <div className="wall-layout-status">
        <div>
          <strong>{DEVICE_LABELS[selectedId] ?? selectedId}</strong>
          <span>{selected ? `x ${selected.position[0].toFixed(2)} m · y ${selected.position[1].toFixed(2)} m` : "Select a device"}</span>
        </div>
        <div className="wall-layout-live-state" aria-live="polite">
          <b>{draggingId ? "Live shortest-path routing" : rebuilding ? "Building detailed tubes…" : "Final 3D routes · front projection"}</b>
          <span>
            {draftLayout.metrics.totalRenderedCableM.toFixed(1)} m modeled · {draftLayout.metrics.wallOverlapCount} device overlaps
            {!draggingId && !rebuilding && detailedRouteIssues !== null ? ` · ${detailedRouteIssues} detailed route conflicts` : ""}
          </span>
        </div>
      </div>
      <svg
        ref={svgRef}
        className="wall-layout-board"
        viewBox={`0 0 ${board.size[0]} ${board.size[1]}`}
        role="img"
        aria-label="Front view of the plywood equipment board with draggable devices, final routed cables, and live drag previews"
      >
        <defs>
          <pattern id="wall-layout-grid" width="0.1" height="0.1" patternUnits="userSpaceOnUse">
            <path d="M 0.1 0 L 0 0 0 0.1" className="wall-layout-grid-line" />
          </pattern>
        </defs>
        <rect className="wall-layout-board-surface" width={board.size[0]} height={board.size[1]} />
        <rect className="wall-layout-grid" width={board.size[0]} height={board.size[1]} fill="url(#wall-layout-grid)" />
        {showDetailedRoutes ? (
          <g className="wall-detailed-routes" aria-label="Front projection of final three-dimensional cable centerlines">
            {detailedCablePaths.map((cable) => {
              const path = projectedDetailedPath(cable.points, boardLeft, boardTop);
              if (!path) return null;
              return (
                <path
                  key={cable.id}
                  className={`wall-detailed-route route-${cable.visibility} ${cable.color === 0xf2f1ec || cable.color === 0xf5f3e9 ? "route-light" : ""}`}
                  d={path}
                  data-detailed-cable-path={cable.id}
                  data-final-3d-path="true"
                  fill="none"
                  stroke={colorHex(cable.color)}
                  strokeWidth={Math.max(0.006, cable.radiusM * 2)}
                />
              );
            })}
          </g>
        ) : (
          <g className="wall-placeholder-routes" aria-label="Live placeholder cable routes">
            {placeholderConnections.map((connection) => (
              <path
                key={connection.id}
                className={`wall-placeholder-route route-${connection.kind}`}
                d={placeholderPath(connection, draftLayout)}
                data-placeholder-route={connection.id}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}
        <g className="wall-layout-devices">
          {editableDevices.map((device) => {
            const x = device.position[0] - device.size[0] / 2 - boardLeft;
            const y = boardTop - device.position[1] - device.size[1] / 2;
            const selectedDevice = selectedId === device.id;
            const overlap = overlapIds.has(device.id);
            return (
              <g
                key={device.id}
                className={`wall-layout-device device-${DEVICE_CLASSES[device.id] ?? "default"} ${selectedDevice ? "is-selected" : ""} ${overlap ? "has-overlap" : ""}`}
                data-wall-device={device.id}
                data-layout-x={device.position[0].toFixed(2)}
                data-layout-y={device.position[1].toFixed(2)}
                role="button"
                aria-label={`Move ${DEVICE_LABELS[device.id] ?? device.id}`}
                tabIndex={0}
                onPointerDown={(event) => beginDrag(event, device)}
                onPointerMove={moveDevice}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onKeyDown={(event) => moveDeviceWithKeyboard(event, device)}
              >
                <rect x={x} y={y} width={device.size[0]} height={device.size[1]} rx={0.018} />
                <text x={x + device.size[0] / 2} y={y + device.size[1] / 2}>
                  {DEVICE_SHORT_LABELS[device.id] ?? device.id}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="wall-layout-scale" aria-hidden="true"><i />0.5 m</div>
    </section>
  );
}
