# Fulaga installed record — 12 September 2026

The owner reports the system fully installed. Equipment is fixed. This update records the installation and makes the viewer usable for both operators and wiring inspection.

## Wiring and model

- PV box: breaker 1, disconnected breaker 2, 40 A DC 600 V combiner and DC 600 V 40 kA SPD, left to right.
- PV mounting rails → SPD → MultiPlus chassis → floor entry near A1 → rod. No earth busbar or separate AC-box-to-earth-bus link.
- MultiPlus V-sense negative → A1 negative.
- Batteries labeled A1, A2, B1, B2, north to south along the west wall.
- Two indoor lights on one two-conductor string with a middle splice; no outdoor-light branch.
- External three-gang Australian rocker plate: Internet, Orion H, lights. Every rocker exposes common/on/unused loop. Commons daisy-chain from the vertical Blue Sea bar on the secondary-box 10 A output; Internet on returns to its three-way WAGO. Orion H and lights run directly.
- Cigarette socket negatives come from Orion common negative.
- Roof panels, northwest corner, the reported west/north equipment order, charging shelf and wall-specific camera views. Geometry uses the owner report and partial IMG_1402 photo; positions, roof pitch and unmeasured enclosure envelopes are illustrative.

## Observations still to confirm

The exact AC bridge terminals were not identified in the report. The detailed diagram provisionally retains PE continuity through the existing three-core input/output cables and the per-protector PE bypasses. It does **not** add neutral-to-earth bridges or depict neutral as replacing PE. The MultiPlus ground relay's neutral/chassis bond is distinct from protective-earth cable continuity: [Victron installation manual](https://www.victronenergy.com/media/pg/MultiPlus-II_230V/en/installation.html).

Only the negative V-sense wire was reported. The positive wire is not invented. The active PV path is provisionally represented as breaker 1 → combiner → MPPT, with the SPD in shunt; the device order and markings are owner-reported, while that exact internal sequence awaits confirmation.

The pre-installation cable schedule is historical. Actual installed cable lengths and enclosure dimensions were not supplied. Automatic wire joins represent terminal branching geometrically; they are not a new connector purchase list. Existing missing electrical test evidence is retained separately from the report that installation is complete.

## Software changes

The simple diagram derives its links from the detailed graph and groups the battery bank, panels, ChargeITs, fast charging and Internet equipment. It explains the three physical rockers and the separate ChargeIT breaker. Dedicated presentation lanes prevent accidental visual junctions.

Both walls share one geometry definition across the router, audits and renderer. Enclosure placement and gland reservation now honor rotation. Enclosure-member clearance columns stop at the enclosure rather than extending through the room. Depth placement enforces both front and back clearance. The schematic handles earth taps whose destinations are outside their local group without producing infinite coordinates, and rejects non-finite placement early.

Generated results: 141 physical routes, 112.2806 m of illustrative centerlines, 578 turns; zero fallbacks or geometric conflicts. Six detailed views, including the wall-switch plate; full-system diagram: 36 bridged crossings, 144 turns and zero routing/overlap errors. All 14 simplified power/control paths are disjoint and avoid unrelated blocks.

Purchase amounts, grant accounting and Polowat are preserved. The earlier Fable integration remains in this checkout; no sibling-folder runtime dependency was introduced. A source backup from before these changes is at `/home/kyle/Documents/dse-installed-backup-20260911-225215/viewer`.

Verification: production build, application and worker type checks, 93 automated code tests and all 12 production-browser tests passed. Browser coverage includes phone layouts, every detailed enclosure view, the simple diagram, 3D navigation and routing, Polowat, costs and grant downloads. Both existing local viewer services were restarted with this build.


## 12 September layout corrections

IMG_1394 and the owner report now define the compact secondary backplate: 32 A / 32 A / 10 A breakers left of center, positive and negative bars at bottom left/right, a vertical Blue Sea 10 A output bar in the middle, and the 25 W converter at top right. One outgoing tap on the vertical bar feeds the three-gang commons. UniFi rests on the box top. The 400 × 440 × 200 mm modeled envelope is illustrative, not a measured enclosure size.

Balancer A is directly above A1. Battery and wall overlays are removed. AC RCBO/SPD earth terminals are on top. The model shows only the generator lead's male Type I plug beside the outlet. Panels face north; the Starlink sits at the northwest roof corner; lights share one north-wall offset. The wall penetration is above the PV surge protector, while a separate electrode cable entry sits in the floor near A1. The battery box has three top and three bottom glands. The shelf is lower and is now included in both routing obstacles and swept cable audits.

Backup before this revision: `/home/kyle/Documents/dse-layout-backup-20260912/viewer`.


## Solar cable and rail correction

The panel-to-panel series links are white. A white cable Y collects the array's free positive and negative ends into a single two-core white downlead, through the wall entry and into the PV box. The two polarities stay electrically separate through both cable breakouts. Two continuous rails span all three panels across the array, at its upper and lower ends; the solar earth conductor lands on the mounting railwork rather than daisy-chaining individual panel earth terminals. Rail clamp position and cable jacket diameter are illustrative.

The enclosure packer now reserves the full height of stacked terminal joins before placing the top wall. This prevents the added PV cable-entry fan from leaving a connection branch outside the box. Backup before this revision: `/home/kyle/Documents/dse-pv-cable-backup-20260912/viewer`.

The solid-body overlap audit now checks oriented boxes after its broad phase and ignores degenerate parallel cross-product axes. Tests distinguish a rail below a tilted panel from a rail intersecting that panel.
