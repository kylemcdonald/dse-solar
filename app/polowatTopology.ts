import { benchDevicePlacement, polowatPlanningShell } from "./polowatEnclosure";

export type PolowatDeviceKind =
  | "panel"
  | "battery"
  | "breaker"
  | "controller"
  | "bus"
  | "converter"
  | "distribution"
  | "load"
  | "enclosure"
  | "shunt"
  | "monitor"
  | "fuse";

export type PolowatConductorKind = "positive" | "negative" | "pv" | "series" | "regulated" | "usb" | "data";

export type PolowatDevice = {
  id: string;
  label: string;
  subtitle: string;
  kind: PolowatDeviceKind;
  bomId?: string;
  position: readonly [number, number, number];
  size: readonly [number, number, number];
  rotation?: readonly [number, number, number];
};

export type PolowatConnection = {
  id: string;
  from: string;
  to: string;
  kind: PolowatConductorKind;
  label: string;
  gauge: string;
  routeLift?: number;
};

const devices: PolowatDevice[] = ([
  {
    id: "panel1",
    label: "Renogy panel 1",
    subtitle: "100 W · series negative end",
    kind: "panel",
    bomId: "polowat-panels",
    position: [-1.86, 2.86, 0.30],
    size: [0.582, 1.093, 0.018],
    rotation: [-0.22, 0, 0],
  },
  {
    id: "panel2",
    label: "Renogy panel 2",
    subtitle: "100 W · series middle",
    kind: "panel",
    bomId: "polowat-panels",
    position: [-1.24, 2.86, 0.30],
    size: [0.582, 1.093, 0.018],
    rotation: [-0.22, 0, 0],
  },
  {
    id: "panel3",
    label: "Renogy panel 3",
    subtitle: "100 W · series positive end",
    kind: "panel",
    bomId: "polowat-panels",
    position: [-0.62, 2.86, 0.30],
    size: [0.582, 1.093, 0.018],
    rotation: [-0.22, 0, 0],
  },
  {
    id: "pvBreaker",
    label: "PV disconnect",
    subtitle: "10 A polarized · two-pole",
    kind: "breaker",
    bomId: "polowat-pv-breaker",
    position: [0.14, 1.64, 0.20],
    size: [0.054, 0.092, 0.070],
  },
  {
    id: "mppt",
    label: "SmartSolar 100/20",
    subtitle: "100 V PV · 20 A charge/load",
    kind: "controller",
    bomId: "polowat-mppt",
    position: [0.28, 1.64, 0.20],
    size: [0.131, 0.100, 0.060],
  },
  {
    id: "controllerBreaker",
    label: "MPPT battery breaker",
    subtitle: "30 A non-polarized · bus end",
    kind: "breaker",
    bomId: "polowat-controller-breaker",
    position: [0.40, 1.64, 0.20],
    size: [0.027, 0.092, 0.070],
  },
  {
    id: "positiveBus",
    label: "BATT + bus",
    subtitle: "DK10N bridged pair · 60 A body",
    kind: "bus",
    bomId: "polowat-din-distribution",
    position: [0.24, 1.49, 0.20],
    size: [0.170, 0.034, 0.045],
  },
  {
    id: "negativeBus",
    label: "BATT − bus",
    subtitle: "DK10N bridged pair · 60 A body",
    kind: "bus",
    bomId: "polowat-din-distribution",
    position: [0.24, 1.42, 0.20],
    size: [0.170, 0.034, 0.045],
  },
  {
    id: "batteryShunt", label: "BMV 500 A shunt", subtitle: "500 A / 50 mV · BATTERY MINUS → LOAD AND CHARGER",
    kind: "shunt", bomId: "polowat-battery-monitor", position: [0, 0, 0], size: [0.120, 0.050, 0.065],
  },
  {
    id: "batteryMonitor", label: "BMV-700 display", subtitle: "Wired battery % · volts · amps · <4 mA with backlight off",
    kind: "monitor", bomId: "polowat-battery-monitor", position: [0, 0, 0], size: [0.069, 0.069, 0.031],
  },
  {
    id: "monitorFuse", label: "BMV supplied fuse", subtitle: "1 A slow-blow · factory positive sense/power lead",
    kind: "fuse", bomId: "polowat-battery-monitor", position: [0, 0, 0], size: [0.040, 0.015, 0.015],
  },
  {
    id: "batteryBreakerA",
    label: "Battery A isolate",
    subtitle: "30 A non-polarized · inside junction box",
    kind: "breaker",
    bomId: "polowat-battery-breakers",
    position: [-0.22, 0.76, 0.24],
    size: [0.027, 0.092, 0.070],
  },
  {
    id: "batteryBreakerB",
    label: "Battery B isolate",
    subtitle: "30 A non-polarized · inside junction box",
    kind: "breaker",
    bomId: "polowat-battery-breakers",
    position: [0.42, 0.76, 0.24],
    size: [0.027, 0.092, 0.070],
  },
  {
    id: "batteryA",
    label: "Battery A",
    subtitle: "12 V · 150 Ah deep cycle",
    kind: "battery",
    bomId: "polowat-batteries",
    position: [-0.22, 0.42, 0.18],
    size: [0.48, 0.25, 0.24],
  },
  {
    id: "batteryB",
    label: "Battery B",
    subtitle: "12 V · 150 Ah deep cycle",
    kind: "battery",
    bomId: "polowat-batteries",
    position: [0.42, 0.42, 0.18],
    size: [0.48, 0.25, 0.24],
  },
  ...["loadPositiveBus", "loadNegativeBus"].map((id, index) => ({
    id, label: index === 0 ? "LOAD + bus" : "LOAD − bus",
    bomId: "polowat-din-distribution",
    subtitle: "DK10N bridged pair · 20 A LOAD circuit",
    kind: "bus" as const,
    position: [0.50, 1.49, 0.20] as const,
    size: [0.020, 0.0432, 0.0493] as const,
  })),
  {
    id: "starlinkBreaker",
    label: "Starlink branch",
    subtitle: "10 A breaker",
    kind: "breaker",
    bomId: "polowat-load-breakers",
    position: [0.14, 1.31, 0.20],
    size: [0.027, 0.092, 0.070],
  },
  {
    id: "starlinkConverter",
    label: "12 → 24 V regulator",
    subtitle: "72 W · switched",
    kind: "converter",
    bomId: "polowat-starlink-converter",
    position: [0.27, 1.30, 0.20],
    size: [0.150, 0.090, 0.055],
  },
  {
    id: "starlink",
    label: "Starlink Mini",
    subtitle: "Integrated Wi-Fi · 25–40 W average",
    kind: "load",
    bomId: "polowat-starlink",
    position: [1.32, 2.08, 0.34],
    size: [0.259, 0.299, 0.039],
    rotation: [-0.32, 0, -0.08],
  },
  {
    id: "usbBreaker",
    label: "USB branch",
    subtitle: "10 A breaker",
    kind: "breaker",
    bomId: "polowat-load-breakers",
    position: [0.42, 1.31, 0.20],
    size: [0.027, 0.092, 0.070],
  },
  {
    id: "usbCharger",
    label: "USB charging",
    subtitle: "60 W USB-C + 18 W USB-A",
    kind: "converter",
    bomId: "polowat-usb",
    position: [0.52, 1.30, 0.20],
    size: [0.095, 0.065, 0.045],
  },
  {
    id: "devices",
    label: "Laptop + phones",
    subtitle: "One laptop and two phone charges/day",
    kind: "load",
    position: [1.32, 0.52, 0.14],
    size: [0.42, 0.24, 0.035],
    rotation: [-0.18, 0, 0],
  },
  {
    id: "equipmentEnclosure",
    label: "Main junction box",
    subtitle: "Planning enclosure sized to layout · final box order deferred",
    kind: "enclosure",
    bomId: "polowat-enclosure",
    position: polowatPlanningShell.position,
    size: polowatPlanningShell.size,
  },
] as PolowatDevice[]).map(device => ({ ...device, ...benchDevicePlacement(device.id) }));

const connections: PolowatConnection[] = [
  { id: "panel-series-1", from: "panel1", to: "panel2", kind: "series", label: "MC4 series link", gauge: "Panel leads", routeLift: 0.39 },
  { id: "panel-series-2", from: "panel2", to: "panel3", kind: "series", label: "MC4 series link", gauge: "Panel leads", routeLift: 0.41 },
  { id: "pv-home-positive", from: "panel3", to: "pvBreaker", kind: "pv", label: "3S home run + · 4.84 A", gauge: "10 AWG PV", routeLift: 0.46 },
  { id: "pv-home-negative", from: "panel1", to: "pvBreaker", kind: "negative", label: "3S home run −", gauge: "10 AWG PV", routeLift: 0.49 },
  { id: "pv-breaker-positive", from: "pvBreaker", to: "mppt", kind: "pv", label: "PV +", gauge: "10 AWG PV", routeLift: 0.34 },
  { id: "pv-breaker-negative", from: "pvBreaker", to: "mppt", kind: "negative", label: "PV −", gauge: "10 AWG PV", routeLift: 0.37 },
  { id: "mppt-battery-positive", from: "mppt", to: "controllerBreaker", kind: "positive", label: "BATT + · 20 A / 30 A OCP", gauge: "10 AWG DC", routeLift: 0.30 },
  { id: "controller-positive-bus", from: "controllerBreaker", to: "positiveBus", kind: "positive", label: "Protected charge path", gauge: "10 AWG DC", routeLift: 0.32 },
  { id: "mppt-battery-negative", from: "mppt", to: "batteryShunt", kind: "negative", label: "BATT − via shunt SYSTEM side", gauge: "10 AWG DC", routeLift: 0.34 },
  { id: "battery-bus-shunt", from: "negativeBus", to: "batteryShunt", kind: "negative", label: "Combined bank − → shunt BATTERY MINUS", gauge: "10 AWG DC" },
  { id: "monitor-positive-fuse", from: "positiveBus", to: "monitorFuse", kind: "positive", label: "BMV positive sense/power · supplied 1 A fuse", gauge: "Factory fused lead" },
  { id: "monitor-fuse-shunt", from: "monitorFuse", to: "batteryShunt", kind: "positive", label: "Fused supply → shunt +B1", gauge: "Factory fused lead" },
  { id: "monitor-rj12", from: "batteryShunt", to: "batteryMonitor", kind: "data", label: "BMV display · RJ12 power/data", gauge: "Factory RJ12 cable" },
  { id: "battery-a-positive", from: "batteryA", to: "batteryBreakerA", kind: "positive", label: "Battery A +", gauge: "8 AWG DC", routeLift: 0.28 },
  { id: "battery-a-positive-bus", from: "batteryBreakerA", to: "positiveBus", kind: "positive", label: "30 A protected +", gauge: "8 AWG DC", routeLift: 0.30 },
  { id: "battery-a-negative", from: "batteryA", to: "negativeBus", kind: "negative", label: "Battery A −", gauge: "8 AWG DC", routeLift: 0.33 },
  { id: "battery-b-positive", from: "batteryB", to: "batteryBreakerB", kind: "positive", label: "Battery B +", gauge: "8 AWG DC", routeLift: 0.36 },
  { id: "battery-b-positive-bus", from: "batteryBreakerB", to: "positiveBus", kind: "positive", label: "30 A protected +", gauge: "8 AWG DC", routeLift: 0.38 },
  { id: "battery-b-negative", from: "batteryB", to: "negativeBus", kind: "negative", label: "Battery B −", gauge: "8 AWG DC", routeLift: 0.41 },
  { id: "mppt-load-positive", from: "mppt", to: "loadPositiveBus", kind: "positive", label: "LOAD + · 20 A max", gauge: "12 AWG DC", routeLift: 0.36 },
  { id: "mppt-load-negative", from: "mppt", to: "loadNegativeBus", kind: "negative", label: "LOAD − · 11.8 V disconnect", gauge: "12 AWG DC", routeLift: 0.39 },
  { id: "load-starlink-positive", from: "loadPositiveBus", to: "starlinkBreaker", kind: "positive", label: "Starlink +", gauge: "12 AWG DC", routeLift: 0.42 },
  { id: "starlink-breaker-converter", from: "starlinkBreaker", to: "starlinkConverter", kind: "positive", label: "10 A switched 12 V", gauge: "12 AWG DC", routeLift: 0.45 },
  { id: "load-starlink-negative", from: "loadNegativeBus", to: "starlinkConverter", kind: "negative", label: "Starlink return", gauge: "12 AWG DC", routeLift: 0.48 },
  { id: "starlink-regulated", from: "starlinkConverter", to: "starlink", kind: "regulated", label: "Regulated 24 V · OEM cable", gauge: "Factory lead", routeLift: 0.51 },
  { id: "load-usb-positive", from: "loadPositiveBus", to: "usbBreaker", kind: "positive", label: "USB +", gauge: "12 AWG DC", routeLift: 0.54 },
  { id: "usb-breaker-charger", from: "usbBreaker", to: "usbCharger", kind: "positive", label: "10 A switched 12 V", gauge: "12 AWG DC", routeLift: 0.57 },
  { id: "load-usb-negative", from: "loadNegativeBus", to: "usbCharger", kind: "negative", label: "USB return", gauge: "12 AWG DC", routeLift: 0.60 },
  { id: "usb-device-leads", from: "usbCharger", to: "devices", kind: "usb", label: "Capped USB-C + USB-A ports", gauge: "Factory USB leads", routeLift: 0.63 },
];

export const polowatTopology = {
  id: "inowon-polowat-compact-12v",
  revision: "P16-2026-09-19",
  devices,
  connections,
  designNotes: [
    "BMV-700 kit includes one 500 A / 50 mV shunt, wired display, RJ12 cable and 1 A fused positive lead. Both battery negatives combine before BATTERY MINUS; MPPT BATT− goes only to LOAD AND CHARGER. Keep LOAD− separate. This is not the Bluetooth SmartShunt product.",
    "Three panels are in series, so no PV combiner or string fuses are required; the two-pole 10 A device is a service disconnect.",
    "Each battery positive enters a 30 A non-polarized breaker inside the junction box. The upstream battery-to-box lead is not protected by that downstream breaker; source-end fault protection remains unresolved. Equal-length pairs support either battery alone at 20 A; bus-end backfeed fault coordination remains unresolved.",
    "SmartSolar LOAD is rated 20 A. Set user-defined 11.8 V disconnect; two 10 A breakers protect Starlink/USB branches but do not form an instantaneous 20 A clamp.",
    "Battery pairs: 8 AWG at ≤2 m; controller pair: 10 AWG at ≤0.5 m; LOAD routes: 12 AWG at ≤1 m total; PV: shared 10 AWG stock at ≤8 m. Require correct derated ampacity. See the circuit audit for assumed lengths and fault/termination holds.",
  ],
} as const;

export const polowatDeviceById = new Map(polowatTopology.devices.map((device) => [device.id, device]));
