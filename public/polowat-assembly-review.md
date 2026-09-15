# Polowat terminal-level assembly review — P9, 15 September 2026

P9 uses one $35.99 DK10N kit for all four isolated BATT+/BATT−/LOAD+/LOAD− groups: eight blocks, four bridges and two unbridged spare blocks. All ten blocks stay contiguous on one rail so the supplied single end cover and two stops suffice. One bare stranded conductor per clamp, 12–14 mm strip and 1.3 Nm. Six bus-end eyelets are eliminated; only four battery-post lugs remain. Both Blue Sea buses, DK4N kit and unneeded 22–10 AWG eyelet assortment are removed from the cart.

The new terminal-level 3D study shows individual cages, screws, jumpers, rail stops/end cover, device envelopes, controller cooling, cable endpoints, bottom glands and capped USB ports. It is a dimensioned assembly study, not a fabrication release. The 325 × 424 mm workspace exceeds the reference enclosure’s 246.4 × 350.5 mm outside footprint. Converter bodies, final cable bends/collision clearance and compact layout need received measurements; do not claim the reference box fits or order it yet. DIHOOL pole wiring/fault coordination, battery-post size, PV connector family and full-load thermal/weather tests remain unresolved.

## Review the model

Open `/polowat/model`: Detailed assembly is the default; Whole system retains the array, battery pair and battery-adjacent disconnects. Use Front, Oblique, DIN terminals and Depth views; toggle wires and the reference outside limits. Click parts, screws, gold landing points and wires for dimensions, conductor sizes and assumptions. Save image exports the current view. The page includes the full terminal and point-to-point schedules.

## Fixed integration issues

- Replaced undersized DK4N main-battery candidates with DK10N cages accepting 8 AWG / 8.37 mm². Current system limits remain 20 A normal and coordinated 30 A protection; the block’s 60 A body rating does not prove battery fault withstand.
- Kept all ten blocks in one continuous mechanical assembly. Only four within-pair bridges are fitted; no electrical bridge crosses group boundaries. The supplied single end cover and two rail stops are sufficient here. Four separately mounted pairs would require extra covers/stops.
- Removed six bus-end eyelets and the unused 22–10 AWG terminal assortment. Battery-post lugs remain unpriced because the local battery stud geometry is unknown.
- Reserved the two unbridged blocks for converter input transitions if the received Coolgear plug will not accept 12 AWG. Exact pigtail size/termination must be accepted by its plug and 10 A branch protection.
- Added distinct physical USB-A/USB-C extensions and nine bottom entry positions; USB-C nominal cutout is 18.5 mm. Hole/gland dimensions are provisional, not drilling instructions.

## Remaining issues and limits

The new terminal-level 3D study shows individual cages, screws, jumpers, rail stops/end cover, device envelopes, controller cooling, cable endpoints, bottom glands and capped USB ports. It is a dimensioned assembly study, not a fabrication release. The 325 × 424 mm workspace exceeds the reference enclosure’s 246.4 × 350.5 mm outside footprint. Converter bodies, final cable bends/collision clearance and compact layout need received measurements; do not claim the reference box fits or order it yet. DIHOOL pole wiring/fault coordination, battery-post size, PV connector family and full-load thermal/weather tests remain unresolved.

The mockup retains provisional device envelopes rather than shrinking parts to claim fit. The controller body and 100 mm above/below cooling requirement are manufacturer-based. DK10N dimensions are manufacturer-based; converter connector and breaker service envelopes need received verification. The front cable loops deliberately expose depth demand; their polyline lengths and 6×OD bend targets are review estimates, not manufacturer-approved radii, collision-free routes or fabrication cuts. This does not establish that the reference box is impossible with a different compact layout. The owner’s hand assembly remains the final sizing step.

The second DIHOOL controller pole is not bridged speculatively. Three DIHOOL devices remain unstaged because published short-circuit specifications and parallel-source fault coordination are unresolved. The model does not override those holds.

## Cost and procurement

31 BOM rows: $2,033.09 equipment ($1,333.09 imports / $700 local), plus $129.98 estimated LA tax: **$2,163.07 total**. Includes the deferred box and held DIHOOL allowances. Three unpriced scopes, freight, duty and service excluded. Imported mass 22.54 kg net / 25.9 kg packed is provisional.

Authenticated cart verified: **21 listings / 24 units / $907.15 before tax**, plus **$88.45 estimated LA tax = $995.60 before delivery**. This revision saves $57.73 in staged merchandise. Nothing purchased.

[DK10N manufacturer specifications](https://www.dinkle.com/en/terminal/DK10N), [selected kit](https://www.amazon.com/dp/B07TN3RLYZ), [Victron mounting requirements](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/installation.html).
