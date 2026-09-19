# Polowat cable routing and stock estimate — P16-2026-09-19

Shared 20 mm physical layout and turn-aware A*; device-front exclusion, negotiated cable clearance and exact rounded-geometry audits; lengths measured on the rendered curves. 15% plus 50 mm per end, each cut rounded up to 50 mm; corresponding parallel battery branch lengths equalized.

Planning geometry, not surveyed site distances or a fabrication release. All modeled routes pass the shared device, cable, wall, self-intersection and rounded-geometry checks. Received hardware and installation clearances still require physical verification. PV span in scene is illustrative, not a surveyed roof run. Check the remaining shared 10 AWG stock after controller cuts before installation.

| Gauge / use | Red cuts | Black cuts | Stock per colour |
|---|---:|---:|---:|
| 8 AWG DC | 3.30 m | 3.50 m | 7.620 m |
| 10 AWG PV | 4.25 m | 5.85 m | 9.144 m shared PV/controller |
| 10 AWG DC | 1.00 m | 0.90 m | 9.144 m shared PV/controller |
| 12 AWG DC | 2.60 m | 1.90 m | 7.620 m |

The shared 10 AWG stock must cover PV, controller and both shunt legs together: 5.25 m red and 6.75 m black in this illustrative layout. Measure the actual roof run before cutting. The BMV kit supplies its 2 m fused positive lead and 10 m RJ12 cable; these are not extra field-wire purchases. Add two 10 AWG × M10 closed lugs for the shunt studs.

## Electrical limits

At 20 A, 11.8 V and 75°C copper, modeled battery/controller drop is 0.236 V (2.00%); cut allowances give 0.329 V (2.79%). Both include the 500 A / 50 mV shunt's 2 mV drop at 20 A; terminal/contact resistance is additional. Modeled cut allowances meet the 3% target before terminal/contact resistance; verify the remaining margin on the physical assembly. Battery-to-box positives remain upstream of their in-box isolators; source-end protection remains unresolved.

| Circuit | Gauge / colour | Model length | Cut with allowance |
|---|---|---:|---:|
| 3S home run + · 4.84 A | 10 AWG PV / red | 3.077 m | 3.65 m |
| 3S home run − | 10 AWG PV / black | 4.366 m | 5.15 m |
| PV + | 10 AWG PV / red | 0.397 m | 0.60 m |
| PV − | 10 AWG PV / black | 0.516 m | 0.70 m |
| BATT + · 20 A / 30 A OCP | 10 AWG DC / red | 0.396 m | 0.60 m |
| Protected charge path | 10 AWG DC / red | 0.256 m | 0.40 m |
| BATT − via shunt SYSTEM side | 10 AWG DC / black | 0.174 m | 0.35 m |
| Combined bank − → shunt BATTERY MINUS | 10 AWG DC / black | 0.383 m | 0.55 m |
| Battery A + | 8 AWG DC / red | 1.080 m | 1.35 m |
| 30 A protected + | 8 AWG DC / red | 0.167 m | 0.30 m |
| Battery A − | 8 AWG DC / black | 1.422 m | 1.75 m |
| Battery B + | 8 AWG DC / red | 0.760 m | 1.05 m |
| 30 A protected + | 8 AWG DC / red | 0.398 m | 0.60 m |
| Battery B − | 8 AWG DC / black | 0.899 m | 1.75 m |
| LOAD + · 20 A max | 12 AWG DC / red | 0.455 m | 0.65 m |
| LOAD − · 11.8 V disconnect | 12 AWG DC / black | 0.375 m | 0.55 m |
| Starlink + | 12 AWG DC / red | 0.168 m | 0.30 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.499 m | 0.70 m |
| Starlink return | 12 AWG DC / black | 0.500 m | 0.70 m |
| USB + | 12 AWG DC / red | 0.206 m | 0.35 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.402 m | 0.60 m |
| USB return | 12 AWG DC / black | 0.441 m | 0.65 m |
