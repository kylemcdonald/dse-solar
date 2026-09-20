# Polowat terminal-level assembly review — P9, 15 September 2026

## P17 · purchased single-pole breakers · 19 September 2026

This update supersedes earlier two-pole DIHOOL candidate/hold statements below. Two B0BFF6RN2N two-packs supply four 30 A non-polarized single-pole, single-width breakers: battery A positive, battery B positive, controller positive, and one unmounted spare. Each BOM row is one two-pack; the controller row includes its spare. Battery negatives remain continuous through the BMV shunt. The private Amazon invoice is reviewed and archived, with refreshed expense PDF, CSV and receipt ZIP.

The exact single-pole photo shows DZ47X-63 / 30 A / 400 V AC/DC / Icu 4 kA. The owner accepts the listing wording as poor copy and authorizes this selection. Superseded 6 kA/C-curve claims must not be applied to this variant. Received terminals, torque, source-end protection and parallel-source fault coordination remain installation checks. The three narrow bodies use one module and two clamps each; generated routes, diagram and cable schedule describe the updated geometry. The existing optimized ordering is retained, with all eight permitted breaker directions retested for this hardware. Fiji is unchanged.


## Ground plane

The equipment wall meets Polowat’s floor at y=0. Both battery bases sit on that plane; their cable routes and cut estimates follow the grounded positions. The floor spans the wall’s full width and extends forward from its front face. Fiji’s floor and installed geometry remain unchanged.

## Terminal-grid alignment

The DIN row and centered fuse terminals now align with the main 20 mm routing grid. Neighbors touch except at explicitly tested routing aisles; terminal leads leave square to their device faces. Diagonal lead adapters are removed. Every Polowat route segment, including terminal leads, must be axis-aligned before smooth elbows are rendered. Fiji is unchanged. The breaker direction comparison and cable schedule are regenerated for this alignment.

## Non-polarized breaker direction

The three 30 A Battery A, Battery B and controller breakers may exchange top/bottom connection assignments. All eight combinations are compared on the same physical layout in the [breaker-routing comparison](polowat-breaker-comparison.md). The lowest-cost valid assignment drives the diagram, model and generated cable schedule. Polarized PV/load breakers keep their existing directions; terminal IDs and pole identities remain physical.

## Compact lower-rail layout · 19 September 2026

The Polowat layout no longer enforces the previous 100 mm controller separation or declared inter-device gaps. All six DIN breakers and four terminal-pair devices share one lower rail. The endpoint-guided ordering search reroutes every candidate and retains explicit routing aisles only when they improve its score. Wires route around bodies or through real open aisles. Functional space for terminal exits and cable bends remains.

Nine bottom glands now have actual sleeve bores and matching panel openings. Routes stay centered through each sleeve with straight approaches on both sides. Exact rounded-cable checks reject misaligned entries. The shunt, supplied fuse and display remain modeled and connected.

See the [DIN ordering and spacing search](polowat-din-optimization.md) for the current selection. The [eight-layout comparison](polowat-layout-comparison.md) records the historical enclosure/backplate choice. The live study and [cable schedule](polowat-cable-routing.md) follow the optimized rail and subsequent breaker-direction comparison. Separating terminal pairs may require additional end covers or rail stops; verify those against the received kit before assembly. No hardware purchase or financial record is changed by this routing study. Fiji’s device positions, terminals, glands and cable routes are unchanged and protected by an exact geometry regression test.

## Shared physical layout · 19 September 2026

The current model replaces the earlier bench arrangement and front service loops below. It now uses Fiji's enclosure packing, 20 mm routing lattice, device-front exclusion, smooth bend rendering and collision audits. Data cables are blue. The BMV shunt, display and fused lead remain one purchased kit; USB-A and USB-C are separate modeled leads. The four isolated terminal pairs remain declared in the shared graph. The owner-requested compact layout below supersedes the former controller-spacing constraint.

The automatically sized enclosure is a routing study, not the deferred retail box or a drilling template. See the live enclosure study and [generated cable schedule](polowat-cable-routing.md) for current dimensions, cut allowances and stock demand. Verify the real roof run and final layout before cutting; the linked generated schedule contains current stock demand. Procurement is unchanged. Earlier revisions below are historical and their cable lengths and placement sketches are superseded.


## P16 · BMV-700 ordered, 19 September 2026

The owner ordered one Victron BMV-700 kit (Amazon B01BVQR0V8), item price $88.40. Invoice and actual tax/payment reconciliation are archived in the private Polowat receipt ledger; the public BOM records the kit once. It includes the display, 500 A / 50 mV shunt, 10 m RJ12 cable and 2 m positive lead with a supplied 1 A slow-blow fuse. No separate SmartShunt or Bluetooth accessory is ordered.

Both battery negatives join at the existing BATT− DK10N pair, then a 10 AWG lead reaches shunt BATTERY MINUS. Shunt LOAD AND CHARGER connects to MPPT BATT−; LOAD− stays separate. The spare BATT+ cage feeds the supplied fused lead to +B1. Add two 10 AWG × M10 closed lugs and exact spare factory fuses to the existing unpriced termination scope. Display, fuse and shunt are separate modeled devices sharing one BOM kit. Display face is 63 mm round with optional 69 mm square bezel; 52 mm body diameter / 31 mm depth, with rear connector clearance still to verify. All monitor parts stay dry and sheltered. Final panel location and enclosure purchase await hand assembly.

Set 300 Ah for both batteries (150 Ah with one isolated), use battery-specific full-charge detection and enable backlight timeout. Electronics draw <4 mA with backlight off (<1.152 Wh/day at 12 V); shunt loss is 0.04 W at 20 A. These fit within the existing 100 Wh/day control/conversion reserve. The 520 Wh/day budget stays unchanged.

The [regenerated cable schedule](polowat-cable-routing.md) supersedes earlier route/drop numbers. The shunt and display are included in both diagram and 3D model. The expanded mounting study remains provisional, not evidence that the deferred reference box fits.

Sources: [Victron datasheet](https://www.victronenergy.com/upload/documents/Datasheet-BMV-700-series-EN.pdf), [installation](https://www.victronenergy.com/media/pg/BMV-700/en/installation.html).

Earlier revision record follows; procurement and monitor changes above supersede conflicting historical statements.


P9 uses one $35.99 DK10N kit for all four isolated BATT+/BATT−/LOAD+/LOAD− groups: eight blocks, four bridges and two unbridged spare blocks. The eight installed blocks stay contiguous on one rail; two unused kit blocks are stored off the assembly so the supplied single end cover and two stops suffice. One bare stranded conductor per clamp, 12–14 mm strip and 1.3 Nm. Six bus-end eyelets are eliminated; only four battery-post lugs remain. Both Blue Sea buses, DK4N kit and unneeded 22–10 AWG eyelet assortment are removed from the cart.

The new terminal-level 3D study shows individual cages, screws, jumpers, rail stops/end cover, device envelopes, controller cooling, cable endpoints, bottom glands and capped USB ports. It is a dimensioned assembly study, not a fabrication release. The 325 × 424 mm workspace exceeds the reference enclosure’s 246.4 × 350.5 mm outside footprint. Converter bodies, final cable bends/collision clearance and compact layout need received measurements; do not claim the reference box fits or order it yet. DIHOOL pole wiring/fault coordination, battery-post size, PV connector family and full-load thermal/weather tests remain unresolved.

## Review the model

Open `/polowat/model` for the whole-system scene with detailed internal hardware and click inspection. Both battery isolators are inside the planning enclosure. `/polowat/diagram` uses Fiji’s shared renderer; open the junction-box subpatch to inspect all four DIN bus circuits independently.

## Fixed integration issues

- Replaced undersized DK4N main-battery candidates with DK10N cages accepting 8 AWG / 8.37 mm². Current system limits remain 20 A normal and coordinated 30 A protection; the block’s 60 A body rating does not prove battery fault withstand.
- Mounted eight blocks in one continuous mechanical assembly; the two unused blocks supplied with the kit remain off-board as spares. Only four within-pair bridges are fitted; no electrical bridge crosses group boundaries. The supplied single end cover and two rail stops are sufficient here. Four separately mounted pairs would require extra covers/stops.
- Removed six bus-end eyelets and the unused 22–10 AWG terminal assortment. Battery-post lugs remain unpriced because the local battery stud geometry is unknown.
- Reserved the two unbridged blocks for converter input transitions if the received Coolgear plug will not accept 12 AWG. Exact pigtail size/termination must be accepted by its plug and 10 A branch protection.
- Added distinct physical USB-A/USB-C extensions and nine bottom entry positions; USB-C nominal cutout is 18.5 mm. Hole/gland dimensions are provisional, not drilling instructions.

## Remaining issues and limits

The new terminal-level 3D study shows individual cages, screws, jumpers, rail stops/end cover, device envelopes, controller cooling, cable endpoints, bottom glands and capped USB ports. It is a dimensioned assembly study, not a fabrication release. The 325 × 424 mm workspace exceeds the reference enclosure’s 246.4 × 350.5 mm outside footprint. Converter bodies, final cable bends/collision clearance and compact layout need received measurements; do not claim the reference box fits or order it yet. DIHOOL pole wiring/fault coordination, battery-post size, PV connector family and full-load thermal/weather tests remain unresolved.

The mockup retains provisional device envelopes rather than shrinking parts to claim fit. The controller body and 100 mm above/below cooling requirement are manufacturer-based. DK10N dimensions are manufacturer-based; converter connector and breaker service envelopes need received verification. The front cable loops deliberately expose depth demand; their polyline lengths and 6×OD bend targets are review estimates, not manufacturer-approved radii, collision-free routes or fabrication cuts. This does not establish that the reference box is impossible with a different compact layout. The owner’s hand assembly remains the final sizing step.

The second DIHOOL controller pole is not bridged speculatively. Three DIHOOL devices remain unstaged because published short-circuit specifications and parallel-source fault coordination are unresolved. The model does not override those holds.

## Cost and procurement

32 BOM rows: $2,045.25 equipment ($1,345.25 imports / $700 local), plus $131.16 estimated LA tax: **$2,176.41 total**. Includes the deferred box and held DIHOOL allowances. Three unpriced scopes, freight, duty and service excluded. Imported mass 22.54 kg net / 25.9 kg packed is provisional.

Authenticated cart verified: **22 listings / 25 units / $919.31 before tax**, plus **$89.63 estimated LA tax = $1,008.94 before delivery**. P11 removes the $11.99 sheet and replaces the $9.99 drill set with a $28.49 better-reviewed bit; net increase $6.51 from P10. Nothing purchased.

[DK10N manufacturer specifications](https://www.dinkle.com/en/terminal/DK10N), [selected kit](https://www.amazon.com/dp/B07TN3RLYZ), [Victron mounting requirements](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/installation.html).

P12 visualization: the model uses a derived planning enclosure around the component footprint, service loops and nine entry openings; the reference retail box is not shown as a falsely fitted shell. Only eight terminal blocks are mounted; two kit spares are off the model. Polowat now uses Fiji’s shared schematic placement, orthogonal routing, crossing jumps, enclosure subpatch navigation and inspection. Layouts are generated offline, and the old hand-positioned Polowat diagram is removed. These display changes do not establish received component fit, bend-radius certification or a new enclosure purchase.

## P13 layout and PV expansion review

Four distinct bus devices represent BATT+, BATT−, LOAD+ and LOAD−. Eight physical blocks and four within-pair jumpers are unchanged. Both battery isolators and their entry-to-breaker-to-bus wiring are inside the planning shell; component study width is now 409 mm. Reference-box purchase remains deferred.

Battery isolators are inside the main junction box by owner request. Battery-to-box positive leads are upstream of their breakers: a fault there cannot be cleared by those downstream breakers. Source-end fault protection, mechanical guarding and parallel-bank backfeed coordination remain unresolved; keep leads shortest-practical. Moving a breaker does not extend its protection upstream.

Retain the 10 A PV disconnect for the present 3S string (4.84 A Imp / 5.16 A Isc; 8.06 A sizing basis). A 20 A device can only be considered as an adequately rated service disconnect where string overcurrent protection is not required, not as 20 A protection for panels with a 15 A maximum series fuse rating. The MPPT battery-charge rating is not the PV breaker sizing basis. Future parallel strings require a new protection review, total array Isc below the 20 A controller limit and cold Voc below 100 V; the controller still caps battery charging at 20 A (290 W nominal PV at 12 V). Cart remains 10 A.

Sources: [Victron ratings](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/technical-specifications.html), [Renogy flexible panel](https://www.renogy.com/products/100-watt-12-volt-flexible-monocrystalline-solar-panel).

## P14 routed stock and faster shipping

The rendered 3D centreline routes now generate a [per-circuit cable schedule](polowat-cable-routing.md). Allowance cuts total 6.60/4.90 m red/black in 8 AWG and 2.95/1.85 m in 12 AWG. YDDECW 25 ft-per-colour and NOVINO 15 ft-per-colour paired packs replace all four Ancor coils; wire cost falls $59.06 with Sep 16–17 delivery shown. The owner-selected Klein 11061 is staged at $22.96; 8/10 AWG stranded tooling remains unresolved. The route-plus-allowance battery/controller drop is 3.78%, exceeding the 3% target; shorten the physical layout or revise the conductor plan before cutting. Old compact length assumptions are targets only.

P14 equipment $1,979.17 ($1,279.17 import / $700.00 local), LA tax estimate $124.72, total $2,103.89. Cart $853.23 before tax. Includes deferred box and held DIHOOL allowances; unpriced scopes, freight, duty and service excluded. Routed voltage drop, tooling, mounting and enclosure fit remain unresolved.

P15 owner preference: YDDECW for both 8 AWG and 12 AWG, each 25 ft red + 25 ft black. NOVINO B0FCLPKH31 removed; YDDECW B0DTPDQ656 staged at $25.99, Sep 17 delivery shown. Cart $859.23 before tax / $943.00 with estimated LA tax. BOM total $2,110.47 including estimated LA tax. Wire route/cut allowances unchanged. Nothing purchased.
