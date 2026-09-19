# Polowat cable routing and stock estimate — P16-2026-09-19

Shared 20 mm physical layout and turn-aware A*; device-front exclusion, negotiated cable clearance and exact rounded-geometry audits; lengths measured on the rendered curves. 15% plus 50 mm per end, each cut rounded up to 50 mm; corresponding parallel battery branch lengths equalized.

Planning geometry, not surveyed site distances or a fabrication release. All modeled routes pass the shared device, cable, wall, self-intersection and rounded-geometry checks. Received hardware and installation clearances still require physical verification. PV span in scene is illustrative, not a surveyed roof run. Check the remaining shared 10 AWG stock after controller cuts before installation.

| Gauge / use | Red cuts | Black cuts | Stock per colour |
|---|---:|---:|---:|
| 8 AWG DC | 5.90 m | 5.20 m | 7.620 m |
| 10 AWG PV | 5.90 m | 7.10 m | 9.144 m shared PV/controller |
| 10 AWG DC | 2.00 m | 2.35 m | 9.144 m shared PV/controller |
| 12 AWG DC | 4.40 m | 3.70 m | 7.620 m |

The shared 10 AWG stock must cover PV, controller and both shunt legs together: 7.90 m red and 9.45 m black in this illustrative layout. Measure the actual roof run before cutting. The BMV kit supplies its 2 m fused positive lead and 10 m RJ12 cable; these are not extra field-wire purchases. Add two 10 AWG × M10 closed lugs for the shunt studs.

## Electrical limits

At 20 A, 11.8 V and 75°C copper, modeled battery/controller drop is 0.500 V (4.24%); cut allowances give 0.636 V (5.39%). Both include the 500 A / 50 mV shunt's 2 mV drop at 20 A; terminal/contact resistance is additional. The 3% target remains unresolved. Shorten and measure the physical arrangement or revise the conductor plan before fabrication. Battery-to-box positives remain upstream of their in-box isolators; source-end protection remains unresolved.

| Circuit | Gauge / colour | Model length | Cut with allowance |
|---|---|---:|---:|
| 3S home run + · 4.84 A | 10 AWG PV / red | 3.916 m | 4.65 m |
| 3S home run − | 10 AWG PV / black | 4.952 m | 5.80 m |
| PV + | 10 AWG PV / red | 0.994 m | 1.25 m |
| PV − | 10 AWG PV / black | 1.026 m | 1.30 m |
| BATT + · 20 A / 30 A OCP | 10 AWG DC / red | 1.028 m | 1.30 m |
| Protected charge path | 10 AWG DC / red | 0.482 m | 0.70 m |
| BATT − via shunt SYSTEM side | 10 AWG DC / black | 0.569 m | 0.80 m |
| Combined bank − → shunt BATTERY MINUS | 10 AWG DC / black | 1.240 m | 1.55 m |
| Battery A + | 8 AWG DC / red | 1.969 m | 2.40 m |
| 30 A protected + | 8 AWG DC / red | 0.390 m | 0.55 m |
| Battery A − | 8 AWG DC / black | 2.148 m | 2.60 m |
| Battery B + | 8 AWG DC / red | 1.403 m | 2.65 m |
| 30 A protected + | 8 AWG DC / red | 0.168 m | 0.30 m |
| Battery B − | 8 AWG DC / black | 1.211 m | 2.60 m |
| LOAD + · 20 A max | 12 AWG DC / red | 1.359 m | 1.70 m |
| LOAD − · 11.8 V disconnect | 12 AWG DC / black | 1.197 m | 1.50 m |
| Starlink + | 12 AWG DC / red | 0.593 m | 0.80 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.469 m | 0.65 m |
| Starlink return | 12 AWG DC / black | 0.886 m | 1.15 m |
| USB + | 12 AWG DC / red | 0.525 m | 0.75 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.330 m | 0.50 m |
| USB return | 12 AWG DC / black | 0.799 m | 1.05 m |
