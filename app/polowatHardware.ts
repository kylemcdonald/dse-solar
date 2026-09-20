/** Physical terminal identities and received-part notes. Positions come only from the shared layout solver. */
export const polowatParts = [
  {
    "id": "batteryShunt",
    "label": "BMV 500 A shunt",
    "size": [
      0.12,
      0.05,
      0.065
    ],
    "kind": "shunt",
    "basis": "Included 500 A / 50 mV shunt, M10 studs. 120 × 50 × 65 mm planning service envelope, not measured body dimensions. Keep dry and allow lug/tool access."
  },
  {
    "id": "monitorFuse",
    "label": "BMV supplied 1 A fuse",
    "size": [
      0.04,
      0.015,
      0.015
    ],
    "kind": "fuse",
    "basis": "Manufacturer-supplied 1 A slow-blow fuse on the 2 m positive lead. Preserve this factory fuse and carry exact spares; holder envelope is provisional."
  },
  {
    "id": "batteryMonitor",
    "label": "BMV-700 display",
    "size": [
      0.069,
      0.069,
      0.031
    ],
    "kind": "monitor",
    "basis": "Victron: 69 × 69 mm optional square bezel, 63 mm round face, 52 mm body diameter and 31 mm depth. Sheltered display position is provisional; final panel cutout and rear plug clearance need verification."
  },
  {
    "id": "mppt",
    "label": "SmartSolar",
    "size": [
      0.131,
      0.1,
      0.06
    ],
    "kind": "controller",
    "basis": "Victron published 131 × 100 × 60 mm body; 100 mm clearance above/below."
  },
  {
    "id": "starlinkConverter",
    "label": "24 V converter",
    "size": [
      0.15,
      0.09,
      0.055
    ],
    "kind": "converter",
    "basis": "Conservative installation envelope, not a measured received body. Confirm before drilling."
  },
  {
    "id": "pvBreaker",
    "label": "PV 10 A",
    "size": [
      0.054,
      0.092,
      0.07
    ],
    "kind": "breaker",
    "basis": "Conservative installation envelope, not a measured received body. Confirm before drilling."
  },
  {
    "id": "controllerBreaker",
    "label": "DC 30 A · 1P",
    "size": [
      0.018,
      0.092,
      0.077
    ],
    "kind": "breaker",
    "basis": "DIHOOL B0BFF6RN2N: single-pole, single-width body. 18 × 92 × 77 mm planning envelope; photo establishes one pole, received dimensions/terminals remain to measure."
  },
  {
    "id": "starlinkBreaker",
    "label": "10 A",
    "size": [
      0.018,
      0.092,
      0.07
    ],
    "kind": "breaker",
    "basis": "Conservative installation envelope, not a measured received body. Confirm before drilling."
  },
  {
    "id": "usbBreaker",
    "label": "10 A",
    "size": [
      0.018,
      0.092,
      0.07
    ],
    "kind": "breaker",
    "basis": "Conservative installation envelope, not a measured received body. Confirm before drilling."
  },
  {
    "id": "loadPositiveBus",
    "label": "DK10N LOAD +",
    "size": [
      0.02,
      0.0432,
      0.0493
    ],
    "kind": "terminals",
    "basis": "DK10N: 10 mm pitch, 43.2 mm body length, 49.3 mm rail-mounted height. End stops/rail shown separately."
  },
  {
    "id": "loadNegativeBus",
    "label": "DK10N LOAD −",
    "size": [
      0.02,
      0.0432,
      0.0493
    ],
    "kind": "terminals",
    "basis": "DK10N: 10 mm pitch, 43.2 mm body length, 49.3 mm rail-mounted height. End stops/rail shown separately."
  },
  {
    "id": "batteryBreakerA",
    "label": "Battery A 30 A",
    "size": [
      0.018,
      0.092,
      0.077
    ],
    "kind": "breaker",
    "basis": "DIHOOL B0BFF6RN2N: single-pole, single-width body. 18 × 92 × 77 mm planning envelope; photo establishes one pole, received dimensions/terminals remain to measure."
  },
  {
    "id": "batteryBreakerB",
    "label": "Battery B 30 A",
    "size": [
      0.018,
      0.092,
      0.077
    ],
    "kind": "breaker",
    "basis": "DIHOOL B0BFF6RN2N: single-pole, single-width body. 18 × 92 × 77 mm planning envelope; photo establishes one pole, received dimensions/terminals remain to measure."
  },
  {
    "id": "usbCharger",
    "label": "USB converter",
    "size": [
      0.089,
      0.051,
      0.027
    ],
    "kind": "converter",
    "basis": "Coolgear published body 88.4 × 50.5 × 26.2 mm; plug/service space is additional."
  },
  {
    "id": "positiveBus",
    "label": "DK10N BATT +",
    "size": [
      0.02,
      0.0432,
      0.0493
    ],
    "kind": "terminals",
    "basis": "DK10N: 10 mm pitch, 43.2 mm body length, 49.3 mm rail-mounted height. End stops/rail shown separately."
  },
  {
    "id": "negativeBus",
    "label": "DK10N BATT −",
    "size": [
      0.02,
      0.0432,
      0.0493
    ],
    "kind": "terminals",
    "basis": "DK10N: 10 mm pitch, 43.2 mm body length, 49.3 mm rail-mounted height. End stops/rail shown separately."
  }
] as const;
export const polowatPorts = [
  {
    "id": "main-positive-0",
    "owner": "positiveBus",
    "label": "BATT + · Battery A +",
    "face": "top"
  },
  {
    "id": "main-positive-1",
    "owner": "positiveBus",
    "label": "BATT + · Battery B +",
    "face": "bottom"
  },
  {
    "id": "main-positive-2",
    "owner": "positiveBus",
    "label": "BATT + · MPPT breaker feed",
    "face": "top"
  },
  {
    "id": "main-positive-3",
    "owner": "positiveBus",
    "label": "BATT + · BMV fused positive lead",
    "face": "bottom"
  },
  {
    "id": "main-negative-0",
    "owner": "negativeBus",
    "label": "BATT − · Battery A −",
    "face": "top"
  },
  {
    "id": "main-negative-1",
    "owner": "negativeBus",
    "label": "BATT − · Battery B −",
    "face": "bottom"
  },
  {
    "id": "main-negative-2",
    "owner": "negativeBus",
    "label": "BATT − · Shunt BATTERY MINUS",
    "face": "top"
  },
  {
    "id": "main-negative-3",
    "owner": "negativeBus",
    "label": "BATT − · Spare",
    "face": "bottom"
  },
  {
    "id": "load-positive-0",
    "owner": "loadPositiveBus",
    "label": "LOAD + · MPPT LOAD+",
    "face": "top"
  },
  {
    "id": "load-positive-1",
    "owner": "loadPositiveBus",
    "label": "LOAD + · Starlink breaker",
    "face": "bottom"
  },
  {
    "id": "load-positive-2",
    "owner": "loadPositiveBus",
    "label": "LOAD + · USB breaker",
    "face": "top"
  },
  {
    "id": "load-positive-3",
    "owner": "loadPositiveBus",
    "label": "LOAD + · Spare",
    "face": "bottom"
  },
  {
    "id": "load-negative-0",
    "owner": "loadNegativeBus",
    "label": "LOAD − · MPPT LOAD−",
    "face": "top"
  },
  {
    "id": "load-negative-1",
    "owner": "loadNegativeBus",
    "label": "LOAD − · Starlink return",
    "face": "bottom"
  },
  {
    "id": "load-negative-2",
    "owner": "loadNegativeBus",
    "label": "LOAD − · USB return",
    "face": "top"
  },
  {
    "id": "load-negative-3",
    "owner": "loadNegativeBus",
    "label": "LOAD − · Spare",
    "face": "bottom"
  },
  {
    "id": "mppt-pv+",
    "owner": "mppt",
    "label": "PV+",
    "face": "bottom"
  },
  {
    "id": "mppt-pv-",
    "owner": "mppt",
    "label": "PV-",
    "face": "bottom"
  },
  {
    "id": "mppt-batt+",
    "owner": "mppt",
    "label": "BATT+",
    "face": "bottom"
  },
  {
    "id": "mppt-batt-",
    "owner": "mppt",
    "label": "BATT-",
    "face": "bottom"
  },
  {
    "id": "mppt-load+",
    "owner": "mppt",
    "label": "LOAD+",
    "face": "bottom"
  },
  {
    "id": "mppt-load-",
    "owner": "mppt",
    "label": "LOAD-",
    "face": "bottom"
  },
  {
    "id": "pvBreaker-top-0",
    "owner": "pvBreaker",
    "label": "Source clamp 1",
    "face": "top"
  },
  {
    "id": "pvBreaker-bottom-0",
    "owner": "pvBreaker",
    "label": "Load clamp 1",
    "face": "bottom"
  },
  {
    "id": "pvBreaker-top-1",
    "owner": "pvBreaker",
    "label": "Source clamp 2",
    "face": "top"
  },
  {
    "id": "pvBreaker-bottom-1",
    "owner": "pvBreaker",
    "label": "Load clamp 2",
    "face": "bottom"
  },
  {
    "id": "controllerBreaker-top-0",
    "owner": "controllerBreaker",
    "label": "Top clamp 1",
    "face": "top"
  },
  {
    "id": "controllerBreaker-bottom-0",
    "owner": "controllerBreaker",
    "label": "Bottom clamp 1",
    "face": "bottom"
  },
  {
    "id": "starlinkBreaker-top-0",
    "owner": "starlinkBreaker",
    "label": "Source clamp 1",
    "face": "top"
  },
  {
    "id": "starlinkBreaker-bottom-0",
    "owner": "starlinkBreaker",
    "label": "Load clamp 1",
    "face": "bottom"
  },
  {
    "id": "usbBreaker-top-0",
    "owner": "usbBreaker",
    "label": "Source clamp 1",
    "face": "top"
  },
  {
    "id": "usbBreaker-bottom-0",
    "owner": "usbBreaker",
    "label": "Load clamp 1",
    "face": "bottom"
  },
  {
    "id": "batteryBreakerA-top-0",
    "owner": "batteryBreakerA",
    "label": "Top clamp 1",
    "face": "top"
  },
  {
    "id": "batteryBreakerA-bottom-0",
    "owner": "batteryBreakerA",
    "label": "Bottom clamp 1",
    "face": "bottom"
  },
  {
    "id": "batteryBreakerB-top-0",
    "owner": "batteryBreakerB",
    "label": "Top clamp 1",
    "face": "top"
  },
  {
    "id": "batteryBreakerB-bottom-0",
    "owner": "batteryBreakerB",
    "label": "Bottom clamp 1",
    "face": "bottom"
  },
  {
    "id": "starlinkConverter+",
    "owner": "starlinkConverter",
    "label": "DC input +",
    "face": "bottom"
  },
  {
    "id": "starlinkConverter-",
    "owner": "starlinkConverter",
    "label": "DC input −",
    "face": "bottom"
  },
  {
    "id": "starlinkConverterout",
    "owner": "starlinkConverter",
    "label": "24 V factory output",
    "face": "right"
  },
  {
    "id": "usbCharger+",
    "owner": "usbCharger",
    "label": "DC input +",
    "face": "bottom"
  },
  {
    "id": "usbCharger-",
    "owner": "usbCharger",
    "label": "DC input −",
    "face": "bottom"
  },
  {
    "id": "usbChargerout",
    "owner": "usbCharger",
    "label": "USB sockets / male extension plugs",
    "face": "right"
  },
  {
    "id": "shunt-battery",
    "owner": "batteryShunt",
    "label": "BATTERY MINUS · M10",
    "face": "left"
  },
  {
    "id": "shunt-system",
    "owner": "batteryShunt",
    "label": "LOAD AND CHARGER · M10",
    "face": "right"
  },
  {
    "id": "shunt-positive",
    "owner": "batteryShunt",
    "label": "+B1 · fused supply",
    "face": "bottom"
  },
  {
    "id": "shunt-rj12",
    "owner": "batteryShunt",
    "label": "RJ12 · display power/data",
    "face": "bottom"
  },
  {
    "id": "monitor-fuse-in",
    "owner": "monitorFuse",
    "label": "Battery positive · factory lead",
    "face": "bottom"
  },
  {
    "id": "monitor-fuse-out",
    "owner": "monitorFuse",
    "label": "1 A fused output",
    "face": "bottom"
  },
  {
    "id": "monitor-rj12",
    "owner": "batteryMonitor",
    "label": "RJ12 · from shunt",
    "face": "bottom"
  }
] as const;
export const polowatLandings = [
  {
    "id": "pv-home-positive",
    "from": "pv-in+",
    "to": "pvBreaker-top-0",
    "diameter": 6.5
  },
  {
    "id": "pv-home-negative",
    "from": "pv-in-",
    "to": "pvBreaker-top-1",
    "diameter": 6.5
  },
  {
    "id": "pv-breaker-positive",
    "from": "pvBreaker-bottom-0",
    "to": "mppt-pv+",
    "diameter": 6.5
  },
  {
    "id": "pv-breaker-negative",
    "from": "pvBreaker-bottom-1",
    "to": "mppt-pv-",
    "diameter": 6.5
  },
  {
    "id": "mppt-battery-positive",
    "from": "controllerBreaker-bottom-0",
    "to": "mppt-batt+",
    "diameter": 6.5
  },
  {
    "id": "controller-positive-bus",
    "from": "main-positive-2",
    "to": "controllerBreaker-top-0",
    "diameter": 6.5
  },
  {
    "id": "mppt-battery-negative",
    "from": "mppt-batt-",
    "to": "shunt-system",
    "diameter": 6.5
  },
  {
    "id": "battery-bus-shunt",
    "from": "main-negative-2",
    "to": "shunt-battery",
    "diameter": 6.5
  },
  {
    "id": "monitor-positive-fuse",
    "from": "main-positive-3",
    "to": "monitor-fuse-in",
    "diameter": 2
  },
  {
    "id": "monitor-fuse-shunt",
    "from": "monitor-fuse-out",
    "to": "shunt-positive",
    "diameter": 2
  },
  {
    "id": "monitor-rj12",
    "from": "shunt-rj12",
    "to": "monitor-rj12",
    "diameter": 5
  },
  {
    "id": "battery-a-positive",
    "from": "battery-a+",
    "to": "batteryBreakerA-top-0",
    "diameter": 7.9
  },
  {
    "id": "battery-a-positive-bus",
    "from": "batteryBreakerA-bottom-0",
    "to": "main-positive-0",
    "diameter": 7.9
  },
  {
    "id": "battery-a-negative",
    "from": "battery-a-",
    "to": "main-negative-0",
    "diameter": 7.9
  },
  {
    "id": "battery-b-positive",
    "from": "battery-b+",
    "to": "batteryBreakerB-top-0",
    "diameter": 7.9
  },
  {
    "id": "battery-b-positive-bus",
    "from": "batteryBreakerB-bottom-0",
    "to": "main-positive-1",
    "diameter": 7.9
  },
  {
    "id": "battery-b-negative",
    "from": "battery-b-",
    "to": "main-negative-1",
    "diameter": 7.9
  },
  {
    "id": "mppt-load-positive",
    "from": "mppt-load+",
    "to": "load-positive-0",
    "diameter": 4
  },
  {
    "id": "mppt-load-negative",
    "from": "mppt-load-",
    "to": "load-negative-0",
    "diameter": 4
  },
  {
    "id": "load-starlink-positive",
    "from": "load-positive-1",
    "to": "starlinkBreaker-top-0",
    "diameter": 4
  },
  {
    "id": "starlink-breaker-converter",
    "from": "starlinkBreaker-bottom-0",
    "to": "starlinkConverter+",
    "diameter": 4
  },
  {
    "id": "load-starlink-negative",
    "from": "load-negative-1",
    "to": "starlinkConverter-",
    "diameter": 4
  },
  {
    "id": "load-usb-positive",
    "from": "load-positive-2",
    "to": "usbBreaker-top-0",
    "diameter": 4
  },
  {
    "id": "usb-breaker-charger",
    "from": "usbBreaker-bottom-0",
    "to": "usbCharger+",
    "diameter": 4
  },
  {
    "id": "load-usb-negative",
    "from": "load-negative-2",
    "to": "usbCharger-",
    "diameter": 4
  },
  {
    "id": "starlink-regulated",
    "from": "starlinkConverterout",
    "to": "starlink-out",
    "diameter": 5
  },
  {
    "id": "usb-device-leads",
    "from": "usbChargerout",
    "to": "usb-c",
    "diameter": 5
  }
] as const;
export const terminalGroups = [
  {
    "id": "main-positive",
    "part": "positiveBus",
    "label": "BATT +",
    "blockCount": 2,
    "bridge": true
  },
  {
    "id": "main-negative",
    "part": "negativeBus",
    "label": "BATT −",
    "blockCount": 2,
    "bridge": true
  },
  {
    "id": "load-positive",
    "part": "loadPositiveBus",
    "label": "LOAD +",
    "blockCount": 2,
    "bridge": true
  },
  {
    "id": "load-negative",
    "part": "loadNegativeBus",
    "label": "LOAD −",
    "blockCount": 2,
    "bridge": true
  }
] as const;
