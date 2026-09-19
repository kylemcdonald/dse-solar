# Polowat cable routing and stock estimate — P16-2026-09-19

10 mm 3D A* service-zone grid; exclusive grid cells; exact terminal and entry stubs; piecewise-linear rendered centreline lengths. 15% plus 50 mm per end, each cut rounded up to 50 mm; corresponding parallel battery branch lengths equalized.

Planning geometry, not surveyed site distances or a fabrication release. Grid paths avoid component bodies in the front service zone; terminal stubs, rounded bends, cable-to-cable swept clearance and received glands still require physical verification. PV span in scene is illustrative, not a surveyed roof run. Check the remaining shared 10 AWG stock after controller cuts before installation.

| Gauge / use | Red cuts | Black cuts | Stock per colour |
|---|---:|---:|---:|
| 8 AWG DC | 6.60 m | 4.90 m | 7.620 m |
| 10 AWG PV | 5.00 m | 6.45 m | 9.144 m shared PV/controller |
| 10 AWG DC | 1.40 m | 1.95 m | 9.144 m shared PV/controller |
| 12 AWG DC | 2.95 m | 1.85 m | 7.620 m |

The shared 10 AWG stock must cover PV, controller and both shunt legs together: 6.40 m red and 8.40 m black in this illustrative layout. Measure the actual roof run before cutting. The BMV kit supplies its 2 m fused positive lead and 10 m RJ12 cable; these are not extra field-wire purchases. Add two 10 AWG × M10 closed lugs for the shunt studs.

## Electrical limits

At 20 A, 11.8 V and 75°C copper, modeled battery/controller drop is 0.439 V (3.72%); cut allowances give 0.566 V (4.79%). Both include the 500 A / 50 mV shunt's 2 mV drop at 20 A; terminal/contact resistance is additional. The 3% target remains unresolved. Shorten and measure the physical arrangement or revise the conductor plan before fabrication. Battery-to-box positives remain upstream of their in-box isolators; source-end protection remains unresolved.

| Circuit | Gauge / colour | Model length | Cut with allowance |
|---|---|---:|---:|
| 3S home run + · 4.84 A | 10 AWG PV / red | 3.707 m | 4.40 m |
| 3S home run − | 10 AWG PV / black | 4.978 m | 5.85 m |
| PV + | 10 AWG PV / red | 0.411 m | 0.60 m |
| PV − | 10 AWG PV / black | 0.423 m | 0.60 m |
| BATT + · 20 A / 30 A OCP | 10 AWG DC / red | 0.422 m | 0.60 m |
| Protected charge path | 10 AWG DC / red | 0.592 m | 0.80 m |
| BATT − via shunt SYSTEM side | 10 AWG DC / black | 0.751 m | 1.00 m |
| Combined bank − → shunt BATTERY MINUS | 10 AWG DC / black | 0.705 m | 0.95 m |
| Battery A + | 8 AWG DC / red | 2.115 m | 2.55 m |
| 30 A protected + | 8 AWG DC / red | 0.551 m | 0.75 m |
| Battery A − | 8 AWG DC / black | 2.006 m | 2.45 m |
| Battery B + | 8 AWG DC / red | 1.835 m | 2.55 m |
| 30 A protected + | 8 AWG DC / red | 0.555 m | 0.75 m |
| Battery B − | 8 AWG DC / black | 1.462 m | 2.45 m |
| LOAD + · 20 A max | 12 AWG DC / red | 0.346 m | 0.50 m |
| LOAD − · 11.8 V disconnect | 12 AWG DC / black | 0.346 m | 0.50 m |
| Starlink + | 12 AWG DC / red | 0.478 m | 0.65 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.488 m | 0.70 m |
| Starlink return | 12 AWG DC / black | 0.589 m | 0.80 m |
| USB + | 12 AWG DC / red | 0.433 m | 0.60 m |
| 10 A switched 12 V | 12 AWG DC / red | 0.307 m | 0.50 m |
| USB return | 12 AWG DC / black | 0.383 m | 0.55 m |
