import { benchDevicePlacement, polowatEnclosure } from "./polowatEnclosure";

export type PolowatDeviceKind =
  | "panel"
  | "battery"
  | "breaker"
  | "controller"
  | "bus"
  | "converter"
  | "distribution"
  | "load"
  | "enclosure";

export type PolowatConductorKind = "positive" | "negative" | "pv" | "series" | "regulated" | "usb";

export type PolowatDiagramBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PolowatDevice = {
  id: string;
  label: string;
  subtitle: string;
  kind: PolowatDeviceKind;
  bomId?: string;
  position: readonly [number, number, number];
  size: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  diagram?: PolowatDiagramBox;
};

export type PolowatConnection = {
  id: string;
  from: string;
  to: string;
  kind: PolowatConductorKind;
  label: string;
  gauge: string;
  labelAt?: readonly [number, number];
  diagramRoute?: readonly (readonly [number, number])[];
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
    diagram: { x: 58, y: 98, width: 154, height: 82 },
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
    diagram: { x: 242, y: 98, width: 154, height: 82 },
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
    diagram: { x: 426, y: 98, width: 154, height: 82 },
  },
  {
    id: "pvBreaker",
    label: "PV disconnect",
    subtitle: "10 A polarized · two-pole",
    kind: "breaker",
    bomId: "polowat-pv-breaker",
    position: [0.14, 1.64, 0.20],
    size: [0.054, 0.092, 0.070],
    diagram: { x: 658, y: 88, width: 144, height: 102 },
  },
  {
    id: "mppt",
    label: "SmartSolar 100/20",
    subtitle: "100 V PV · 20 A charge/load",
    kind: "controller",
    bomId: "polowat-mppt",
    position: [0.28, 1.64, 0.20],
    size: [0.131, 0.100, 0.060],
    diagram: { x: 882, y: 76, width: 178, height: 126 },
  },
  {
    id: "controllerBreaker",
    label: "MPPT battery breaker",
    subtitle: "30 A non-polarized · bus end",
    kind: "breaker",
    bomId: "polowat-controller-breaker",
    position: [0.40, 1.64, 0.20],
    size: [0.027, 0.092, 0.070],
    diagram: { x: 902, y: 330, width: 138, height: 88 },
  },
  {
    id: "positiveBus",
    label: "Positive bus",
    subtitle: "DK10N bridged pair · 60 A body",
    kind: "bus",
    bomId: "polowat-din-distribution",
    position: [0.24, 1.49, 0.20],
    size: [0.170, 0.034, 0.045],
    diagram: { x: 660, y: 488, width: 150, height: 68 },
  },
  {
    id: "negativeBus",
    label: "Negative bus",
    subtitle: "DK10N bridged pair · 60 A body",
    kind: "bus",
    bomId: "polowat-din-distribution",
    position: [0.24, 1.42, 0.20],
    size: [0.170, 0.034, 0.045],
    diagram: { x: 660, y: 582, width: 150, height: 68 },
  },
  {
    id: "batteryBreakerA",
    label: "Battery A isolate",
    subtitle: "30 A non-polarized · at battery",
    kind: "breaker",
    bomId: "polowat-battery-breakers",
    position: [-0.22, 0.76, 0.24],
    size: [0.027, 0.092, 0.070],
    diagram: { x: 310, y: 492, width: 154, height: 82 },
  },
  {
    id: "batteryBreakerB",
    label: "Battery B isolate",
    subtitle: "30 A non-polarized · at battery",
    kind: "breaker",
    bomId: "polowat-battery-breakers",
    position: [0.42, 0.76, 0.24],
    size: [0.027, 0.092, 0.070],
    diagram: { x: 310, y: 686, width: 154, height: 82 },
  },
  {
    id: "batteryA",
    label: "Battery A",
    subtitle: "12 V · 150 Ah deep cycle",
    kind: "battery",
    bomId: "polowat-batteries",
    position: [-0.22, 0.42, 0.18],
    size: [0.48, 0.25, 0.24],
    diagram: { x: 72, y: 482, width: 170, height: 102 },
  },
  {
    id: "batteryB",
    label: "Battery B",
    subtitle: "12 V · 150 Ah deep cycle",
    kind: "battery",
    bomId: "polowat-batteries",
    position: [0.42, 0.42, 0.18],
    size: [0.48, 0.25, 0.24],
    diagram: { x: 72, y: 676, width: 170, height: 102 },
  },
  {
    id: "loadSplit",
    label: "DIN load distribution",
    bomId: "polowat-din-distribution",
    subtitle: "Two isolated bridged pairs · 20 A max",
    kind: "distribution",
    position: [0.50, 1.49, 0.20],
    size: [0.082, 0.055, 0.045],
    diagram: { x: 1140, y: 88, width: 168, height: 102 },
  },
  {
    id: "starlinkBreaker",
    label: "Starlink branch",
    subtitle: "10 A breaker",
    kind: "breaker",
    bomId: "polowat-load-breakers",
    position: [0.14, 1.31, 0.20],
    size: [0.027, 0.092, 0.070],
    diagram: { x: 1110, y: 308, width: 150, height: 84 },
  },
  {
    id: "starlinkConverter",
    label: "12 → 24 V regulator",
    subtitle: "72 W · switched",
    kind: "converter",
    bomId: "polowat-starlink-converter",
    position: [0.27, 1.30, 0.20],
    size: [0.150, 0.090, 0.055],
    diagram: { x: 1346, y: 308, width: 168, height: 84 },
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
    diagram: { x: 1346, y: 472, width: 168, height: 104 },
  },
  {
    id: "usbBreaker",
    label: "USB branch",
    subtitle: "10 A breaker",
    kind: "breaker",
    bomId: "polowat-load-breakers",
    position: [0.42, 1.31, 0.20],
    size: [0.027, 0.092, 0.070],
    diagram: { x: 1110, y: 652, width: 150, height: 84 },
  },
  {
    id: "usbCharger",
    label: "USB charging",
    subtitle: "60 W USB-C + 18 W USB-A",
    kind: "converter",
    bomId: "polowat-usb",
    position: [0.52, 1.30, 0.20],
    size: [0.095, 0.065, 0.045],
    diagram: { x: 1346, y: 652, width: 168, height: 96 },
  },
  {
    id: "devices",
    label: "Laptop + phones",
    subtitle: "One laptop and two phone charges/day",
    kind: "load",
    position: [1.32, 0.52, 0.14],
    size: [0.42, 0.24, 0.035],
    rotation: [-0.18, 0, 0],
    diagram: { x: 1346, y: 784, width: 168, height: 100 },
  },
  {
    id: "equipmentEnclosure",
    label: "Main junction box",
    subtitle: "ANIMACYN · 13.8 × 9.7 × 5.9 in · order after bench assembly",
    kind: "enclosure",
    bomId: "polowat-enclosure",
    position: [0.90, 1.47, 0.06],
    size: [polowatEnclosure.outer.width / 1000, polowatEnclosure.outer.height / 1000, polowatEnclosure.outer.depth / 1000],
  },
] as PolowatDevice[]).map(device => ({ ...device, ...benchDevicePlacement(device.id) }));

const connections: PolowatConnection[] = [
  { id: "panel-series-1", from: "panel1", to: "panel2", kind: "series", label: "MC4 series link", gauge: "Panel leads", diagramRoute: [[212, 126], [228, 126], [228, 112], [242, 112]], routeLift: 0.39 },
  { id: "panel-series-2", from: "panel2", to: "panel3", kind: "series", label: "MC4 series link", gauge: "Panel leads", diagramRoute: [[396, 164], [412, 164], [412, 150], [426, 150]], routeLift: 0.41 },
  { id: "pv-home-positive", from: "panel3", to: "pvBreaker", kind: "pv", label: "3S home run + · 4.84 A", gauge: "10 AWG PV", labelAt: [620, 82], diagramRoute: [[580, 119], [610, 119], [610, 102], [658, 102]], routeLift: 0.46 },
  { id: "pv-home-negative", from: "panel1", to: "pvBreaker", kind: "negative", label: "3S home run −", gauge: "10 AWG PV", diagramRoute: [[58, 162], [46, 162], [46, 212], [620, 212], [620, 174], [658, 174]], routeLift: 0.49 },
  { id: "pv-breaker-positive", from: "pvBreaker", to: "mppt", kind: "pv", label: "PV +", gauge: "10 AWG PV", diagramRoute: [[802, 112], [842, 112], [842, 104], [882, 104]], routeLift: 0.34 },
  { id: "pv-breaker-negative", from: "pvBreaker", to: "mppt", kind: "negative", label: "PV −", gauge: "10 AWG PV", diagramRoute: [[802, 166], [852, 166], [852, 178], [882, 178]], routeLift: 0.37 },
  { id: "mppt-battery-positive", from: "mppt", to: "controllerBreaker", kind: "positive", label: "BATT + · 20 A / 30 A OCP", gauge: "10 AWG DC", labelAt: [972, 274], diagramRoute: [[940, 202], [940, 270], [971, 270], [971, 330]], routeLift: 0.30 },
  { id: "controller-positive-bus", from: "controllerBreaker", to: "positiveBus", kind: "positive", label: "Protected charge path", gauge: "10 AWG DC", diagramRoute: [[902, 374], [850, 374], [850, 512], [810, 512]], routeLift: 0.32 },
  { id: "mppt-battery-negative", from: "mppt", to: "negativeBus", kind: "negative", label: "BATT −", gauge: "10 AWG DC", labelAt: [1016, 616], diagramRoute: [[1015, 202], [1072, 202], [1072, 616], [810, 616]], routeLift: 0.34 },
  { id: "battery-a-positive", from: "batteryA", to: "batteryBreakerA", kind: "positive", label: "Battery A +", gauge: "8 AWG DC", diagramRoute: [[242, 514], [310, 514]], routeLift: 0.28 },
  { id: "battery-a-positive-bus", from: "batteryBreakerA", to: "positiveBus", kind: "positive", label: "30 A protected +", gauge: "8 AWG DC", labelAt: [545, 490], diagramRoute: [[464, 514], [620, 514], [620, 506], [660, 506]], routeLift: 0.30 },
  { id: "battery-a-negative", from: "batteryA", to: "negativeBus", kind: "negative", label: "Battery A −", gauge: "8 AWG DC", labelAt: [456, 604], diagramRoute: [[157, 584], [157, 620], [580, 620], [580, 624], [660, 624]], routeLift: 0.33 },
  { id: "battery-b-positive", from: "batteryB", to: "batteryBreakerB", kind: "positive", label: "Battery B +", gauge: "8 AWG DC", diagramRoute: [[242, 710], [310, 710]], routeLift: 0.36 },
  { id: "battery-b-positive-bus", from: "batteryBreakerB", to: "positiveBus", kind: "positive", label: "30 A protected +", gauge: "8 AWG DC", labelAt: [540, 688], diagramRoute: [[464, 710], [610, 710], [610, 542], [660, 542]], routeLift: 0.38 },
  { id: "battery-b-negative", from: "batteryB", to: "negativeBus", kind: "negative", label: "Battery B −", gauge: "8 AWG DC", labelAt: [480, 824], diagramRoute: [[157, 778], [157, 834], [628, 834], [628, 640], [660, 640]], routeLift: 0.41 },
  { id: "mppt-load-positive", from: "mppt", to: "loadSplit", kind: "positive", label: "LOAD + · 20 A max", gauge: "12 AWG DC", labelAt: [1100, 88], diagramRoute: [[1060, 112], [1140, 112]], routeLift: 0.36 },
  { id: "mppt-load-negative", from: "mppt", to: "loadSplit", kind: "negative", label: "LOAD − · 11.8 V disconnect", gauge: "12 AWG DC", diagramRoute: [[1060, 172], [1140, 172]], routeLift: 0.39 },
  { id: "load-starlink-positive", from: "loadSplit", to: "starlinkBreaker", kind: "positive", label: "Starlink +", gauge: "12 AWG DC", diagramRoute: [[1180, 190], [1180, 308]], routeLift: 0.42 },
  { id: "starlink-breaker-converter", from: "starlinkBreaker", to: "starlinkConverter", kind: "positive", label: "10 A switched 12 V", gauge: "12 AWG DC", labelAt: [1303, 306], diagramRoute: [[1260, 330], [1346, 330]], routeLift: 0.45 },
  { id: "load-starlink-negative", from: "loadSplit", to: "starlinkConverter", kind: "negative", label: "Starlink return", gauge: "12 AWG DC", diagramRoute: [[1308, 150], [1328, 150], [1328, 370], [1346, 370]], routeLift: 0.48 },
  { id: "starlink-regulated", from: "starlinkConverter", to: "starlink", kind: "regulated", label: "Regulated 24 V · OEM cable", gauge: "Factory lead", labelAt: [1430, 432], diagramRoute: [[1430, 392], [1430, 472]], routeLift: 0.51 },
  { id: "load-usb-positive", from: "loadSplit", to: "usbBreaker", kind: "positive", label: "USB +", gauge: "12 AWG DC", diagramRoute: [[1140, 170], [1098, 170], [1098, 694], [1110, 694]], routeLift: 0.54 },
  { id: "usb-breaker-charger", from: "usbBreaker", to: "usbCharger", kind: "positive", label: "10 A switched 12 V", gauge: "12 AWG DC", labelAt: [1303, 650], diagramRoute: [[1260, 676], [1346, 676]], routeLift: 0.57 },
  { id: "load-usb-negative", from: "loadSplit", to: "usbCharger", kind: "negative", label: "USB return", gauge: "12 AWG DC", diagramRoute: [[1308, 176], [1540, 176], [1540, 620], [1430, 620], [1430, 652]], routeLift: 0.60 },
  { id: "usb-device-leads", from: "usbCharger", to: "devices", kind: "usb", label: "Capped USB-C + USB-A ports", gauge: "Factory USB leads", labelAt: [1430, 768], diagramRoute: [[1430, 748], [1430, 784]], routeLift: 0.63 },
];

export const polowatTopology = {
  id: "inowon-polowat-compact-12v",
  revision: "P9-2026-09-15",
  devices,
  connections,
  designNotes: [
    "Three panels are in series, so no PV combiner or string fuses are required; the two-pole 10 A device is a service disconnect.",
    "Every battery positive has a shortest-practical 30 A non-polarized breaker. Equal-length pairs support either battery alone at 20 A; bus-end backfeed fault coordination remains unresolved.",
    "SmartSolar LOAD is rated 20 A. Set user-defined 11.8 V disconnect; two 10 A breakers protect Starlink/USB branches but do not form an instantaneous 20 A clamp.",
    "Battery pairs: 8 AWG at ≤2 m; controller pair: 10 AWG at ≤0.5 m; LOAD routes: 12 AWG at ≤1 m total; PV: shared 10 AWG stock at ≤8 m. Require correct derated ampacity. See the circuit audit for assumed lengths and fault/termination holds.",
  ],
} as const;

export const polowatDeviceById = new Map(polowatTopology.devices.map((device) => [device.id, device]));
