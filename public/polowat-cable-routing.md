# Polowat cable routing and stock estimate — P16-2026-09-19

Shared 20 mm physical layout and turn-aware A*; device-front exclusion, negotiated cable clearance and exact rounded-geometry audits; lengths measured on the rendered curves. 15% plus 50 mm per end, each cut rounded up to 50 mm; corresponding parallel battery branch lengths equalized.

Planning geometry, not surveyed site distances or a fabrication release. All modeled routes pass the shared device, cable, wall, self-intersection and rounded-geometry checks. Received hardware and installation clearances still require physical verification. PV span in scene is illustrative, not a surveyed roof run. Check the remaining shared 10 AWG stock after controller cuts before installation.

| Gauge / use | Red cuts | Black cuts | Stock per colour |
|---|---:|---:|---:|
| 8 AWG DC | 4.50 m | 3.40 m | 7.620 m |
| 10 AWG PV | 5.20 m | 6.55 m | 9.144 m shared PV/controller |
| 10 AWG DC | 1.75 m | 0.95 m | 9.144 m shared PV/controller |
| 12 AWG DC | 3.80 m | 2.30 m | 7.620 m |

The shared 10 AWG stock must cover PV, controller and both shunt legs together: 6.95 m red and 7.50 m black in this illustrative layout. Measure the actual roof run before cutting. The BMV kit supplies its 2 m fused positive lead and 10 m RJ12 cable; these are not extra field-wire purchases. Add two 10 AWG × M10 closed lugs for the shunt studs.

## Electrical limits

At 20 A, 11.8 V and 75°C copper, modeled battery/controller drop is 0.314 V (2.66%); cut allowances give 0.421 V (3.57%). Both include the 500 A / 50 mV shunt's 2 mV drop at 20 A; terminal/contact resistance is additional. The 3% target remains unresolved. Shorten and measure the physical arrangement or revise the conductor plan before fabrication. Battery-to-box positives remain upstream of their in-box isolators; source-end protection remains unresolved.

| Circuit | Gauge / colour | Model length | Cut with allowance |
|---|---|---:|---:|
| 3S home run + · 4.84 A | 10 AWG PV / red | 3.479 m | 4.15 m |
| 3S home run − | 10 AWG PV / black | 4.650 m | 5.45 m |
| PV + | 10 AWG PV / red | 0.795 m | 1.05 m |
| PV − | 10 AWG PV / black | 0.867 m | 1.10 m |
| BATT + · 20 A / 30 A OCP | 10 AWG DC / red | 0.990 m | 1.25 m |
| Protected charge path | 10 AWG DC / red | 0.346 m | 0.50 m |
| BATT − via shunt SYSTEM side | 10 AWG DC / black | 0.174 m | 0.35 m |
| Combined bank − → shunt BATTERY MINUS | 10 AWG DC / black | 0.401 m | 0.60 m |
| Battery A + | 8 AWG DC / red | 1.133 m | 1.45 m |
| 30 A protected + | 8 AWG DC / red | 0.581 m | 0.80 m |
| Battery A − | 8 AWG DC / black | 1.387 m | 1.70 m |
| Battery B + | 8 AWG DC / red | 1.121 m | 1.90 m |
| 30 A protected + | 8 AWG DC / red | 0.177 m | 0.35 m |
| Battery B − | 8 AWG DC / black | 0.633 m | 1.70 m |
| LOAD + · 20 A max | 12 AWG DC / red | 0.488 m | 0.70 m |
| LOAD − · 11.8 V disconnect | 12 AWG DC / black | 0.438 m | 0.65 m |
| Starlink + | 12 AWG DC / red | 0.660 m | 0.90 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.679 m | 0.90 m |
| Starlink return | 12 AWG DC / black | 0.801 m | 1.05 m |
| USB + | 12 AWG DC / red | 0.380 m | 0.55 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.535 m | 0.75 m |
| USB return | 12 AWG DC / black | 0.418 m | 0.60 m |
