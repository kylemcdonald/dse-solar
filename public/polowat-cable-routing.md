# Polowat cable routing and stock estimate — P16-2026-09-19

Shared 20 mm physical layout and turn-aware A*; device-front exclusion, negotiated cable clearance and exact rounded-geometry audits; lengths measured on the rendered curves. 15% plus 50 mm per end, each cut rounded up to 50 mm; corresponding parallel battery branch lengths equalized.

Planning geometry, not surveyed site distances or a fabrication release. All modeled routes pass the shared device, cable, wall, self-intersection and rounded-geometry checks. Received hardware and installation clearances still require physical verification. PV span in scene is illustrative, not a surveyed roof run. Check the remaining shared 10 AWG stock after controller cuts before installation.

| Gauge / use | Red cuts | Black cuts | Stock per colour |
|---|---:|---:|---:|
| 8 AWG DC | 3.20 m | 3.10 m | 7.620 m |
| 10 AWG PV | 5.15 m | 6.35 m | 9.144 m shared PV/controller |
| 10 AWG DC | 1.40 m | 0.85 m | 9.144 m shared PV/controller |
| 12 AWG DC | 3.15 m | 2.25 m | 7.620 m |

The shared 10 AWG stock must cover PV, controller and both shunt legs together: 6.55 m red and 7.20 m black in this illustrative layout. Measure the actual roof run before cutting. The BMV kit supplies its 2 m fused positive lead and 10 m RJ12 cable; these are not extra field-wire purchases. Add two 10 AWG × M10 closed lugs for the shunt studs.

## Electrical limits

At 20 A, 11.8 V and 75°C copper, modeled battery/controller drop is 0.235 V (1.99%); cut allowances give 0.344 V (2.92%). Both include the 500 A / 50 mV shunt's 2 mV drop at 20 A; terminal/contact resistance is additional. Modeled cut allowances meet the 3% target before terminal/contact resistance; verify the remaining margin on the physical assembly. Battery-to-box positives remain upstream of their in-box isolators; source-end protection remains unresolved.

| Circuit | Gauge / colour | Model length | Cut with allowance |
|---|---|---:|---:|
| 3S home run + · 4.84 A | 10 AWG PV / red | 3.478 m | 4.10 m |
| 3S home run − | 10 AWG PV / black | 4.530 m | 5.35 m |
| PV + | 10 AWG PV / red | 0.784 m | 1.05 m |
| PV − | 10 AWG PV / black | 0.754 m | 1.00 m |
| BATT + · 20 A / 30 A OCP | 10 AWG DC / red | 0.742 m | 1.00 m |
| Protected charge path | 10 AWG DC / red | 0.226 m | 0.40 m |
| BATT − via shunt SYSTEM side | 10 AWG DC / black | 0.174 m | 0.35 m |
| Combined bank − → shunt BATTERY MINUS | 10 AWG DC / black | 0.334 m | 0.50 m |
| Battery A + | 8 AWG DC / red | 0.790 m | 1.25 m |
| 30 A protected + | 8 AWG DC / red | 0.206 m | 0.35 m |
| Battery A − | 8 AWG DC / black | 1.230 m | 1.55 m |
| Battery B + | 8 AWG DC / red | 0.709 m | 0.95 m |
| 30 A protected + | 8 AWG DC / red | 0.458 m | 0.65 m |
| Battery B − | 8 AWG DC / black | 0.631 m | 1.55 m |
| LOAD + · 20 A max | 12 AWG DC / red | 0.419 m | 0.60 m |
| LOAD − · 11.8 V disconnect | 12 AWG DC / black | 0.357 m | 0.55 m |
| Starlink + | 12 AWG DC / red | 0.457 m | 0.65 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.599 m | 0.80 m |
| Starlink return | 12 AWG DC / black | 0.877 m | 1.15 m |
| USB + | 12 AWG DC / red | 0.265 m | 0.45 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.449 m | 0.65 m |
| USB return | 12 AWG DC / black | 0.381 m | 0.55 m |
