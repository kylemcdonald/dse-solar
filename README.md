# DSE Fiji solar-system viewer

This viewer is the installation record for the Drua Sailing Experience solar system in Fiji. R30 supports one project and one wiring authority: the canonical graph in `app/dseTopology.ts`.

The detailed diagram and 3D scene resolve the same graph through `app/dseRuntime.ts`. There is no PNG/PG mode, overview diagram, separate junction-box tab, AC-junction tab or hand-maintained physical-layout JSON. The optional R30 layout optimizer is a bounded, exact-gated proposal tool; it is not a browser router or an unattended authority that rewrites the canonical topology.

## Run it

```bash
npm install
npm run dev
```

The development service must listen on all interfaces. Open:

- http://vibecheck.local:3000/
- http://vibecheck.taildd340.ts.net:3000/

Production:

```bash
npm run build
npm start
```

## Change the system

Most changes now take place in one file:

1. Add, remove or move a device in `app/dseTopology.ts`.
2. Give every physical terminal a conductor ID, kind and device face.
3. Add or remove graph connections using `device.conductor` endpoint keys.
4. Run `npm test`.

No diagram node, 3D mesh, gland row or route artifact needs a parallel edit. Device geometry is deliberately simple and uses the declared physical envelope. Geometry uses a 10 mm integer unit and axis-aligned terminals share the global 20 mm route lattice; DIN breaker/protection geometry therefore renders at `20 mm × way count`. All such devices share one renderer.

## Runtime pipeline

```text
dseTopology.ts
  devices + conductors + cables + connections + enclosures
            │
            ├─ systemGraphRuntime.ts + renderedCableGeometry.ts
            │             └─ generate:runtime → data/generated/dse-runtime.json
            │                                    └─ dseRuntime.ts → 3D scene
            │
            └─ generate:diagram-layouts → data/generated/diagram-layouts.json
                                           └─ detailed diagram
```

Both checked artifacts carry a source hash and are regenerated only when their inputs change. The browser validates cardinalities and hydrates lookup maps; it never runs voxel A* or diagram routing. That keeps the first page interactive while the Three.js view remains an on-demand chunk.

Repeated physical families declare their diagram rows or grids in the canonical device data. The 2D view is a logical left-to-right schematic: PV and other sources sit on the left, protection and conversion occupy the center, loads fan out to the right, and the 2 × 2 battery bank stays close below the battery-adjacent cutoff and external main-distribution cluster. Abstract junctions and their internal subpatches place incoming conductors on the left, outgoing conductors on the right, and battery, earth and data conductors along the bottom. The external AC chain is one protected row centered on the UniFi service column: generator, generator breakout, AC input/output box, outlet breakout and Type I outlet, with dedicated junction-side routing corridors and no unrelated route allowed to cross the four local fans. The MultiPlus and its AC-in/AC-out breakouts occupy a distinct conversion row below it, with the breakouts immediately flanking the inverter. The AC-in breakout stays right of the SmartSolar battery and PV frame-bond trunks; AC-out stays left of the MultiPlus-negative and SmartSolar VE.Direct trunks. This keeps each white sheath intact up to its adjacent breakout and prevents unrelated equipment or jump arcs from entering the external chain. The AC-box protective-earth daisy chains use straight orthogonal T taps rather than diagonal Y fans. The first tee aligns with its breakout lead; downstream tees absorb upward branch corners, making the generator inter-tee arm horizontal and both protection-earth arms vertical. Independent L/N paths align as rows, and an explicit straight PE trunk connects the generator/input chain to the AC-output/socket chain, using arched jumps only where it crosses insulated cables. Because every unused arm in one continuous tee chain is electrically equivalent, diagram generation exhaustively permutes those arm assignments and tries both diameter-first and short-first production routing. Junction busbar landings with the same occupancy are likewise matched to their peers in crossing-minimal order; multi-wire stacks move only as intact bundles to preserve the modeled landing count. For a complex full-system busbar fan, a fast baseline route treats the equipotential bar as one virtual target, records the cyclic order in which conductors enter a device-sized envelope, assigns display slots in that order and puts spare posts in the largest unused gap. No route-specific busbar order is authored: the landing order is recomputed from current geometry whenever equipment or routes move. Physical endpoint identities and routing-group compatibility remain unchanged. A reserved orthogonal terminal fan carries that planar order from the envelope to the individual displayed posts, while the ordinary A* router owns the paths outside it. The production router then reruns the complete diagram. A virtual-target result can never worsen a hard geometry or clearance audit; among safe results, it is accepted when the lexicographic visual objective improves—crossings first, then turns, then routed length. This logical port placement is intentionally independent of the physical single bottom gland row retained by the 3D model. Conductor and gland hover names are derived by traversing through graph plumbing such as glands, cable breakouts and join arms to the meaningful connected equipment; internal identifiers are retained for diagnostics, not used as the primary user-facing name. Protective earth uses a brighter green so it remains legible against the diagram background.

Each diagram scope retains its own view transform. Entering a junction, returning with Back, or leaving with Escape restores the preceding scope's exact zoom and pan instead of refitting it. The 3D camera maps ordinary wheel/two-finger trackpad scroll to cursor-anchored zoom at the original response, one-touch drag to orbit, and two-touch or right-button drag to pan.

The build-time router sorts cables by outside diameter, thickest first, then solves and locks them strictly one at a time on the global 20 mm lattice. Mechanically equivalent busbar terminals opt into explicit routing pools. Before cable reservations, a multi-goal voxel solve treats each currently unused compatible terminal as a zero-cost edge to one virtual device target; equal-diameter claims assign the most distant connection first, and explicit stack capacity is considered only after every physical terminal has its first wire. This can exchange physical posts without changing the electrical device-level graph, while terminal size, polarity and capacity remain hard constraints. Fixed gland throats remain reserved, while terminal-clearance reservations respect route priority. The router blocks volumes around unrelated world equipment and projects every rear-mounted enclosure component's X/Y footprint through the complete open-front depth, so an unrelated wire must go around a device rather than hiding a crossing in front of it. It strongly penalizes distance from the wall, prefers lower exterior routes, lightly penalizes turns, and assigns every occupied cable cell to one connection so later wires cannot reuse or intersect it. Bundle IDs describe procurement and shared glands only. There is no fallback path: an unroutable connection fails generation with diagnostics. Radius-aware audits reject centerline crossings, cable-envelope contact, cable self-intersection, device contact or front-projection crossing, wall-volume crossings, off-axis terminal approaches, and conflicts in the exact rounded cable and join geometry shared with the Three.js renderer. Curvature is also checked against cable radius.

The checked R30 artifact evaluates 28 pooled bus endpoints and changes 20 authored physical landings. It contains 86 devices, 291 conductors and 137 routed connections totaling 148.52 m with 850 turns. All device, rendered-geometry and cable-clearance conflict counts remain zero with the strict enclosure-front rule.

`scripts/propose-physical-layout.ts` performs a deterministic, seeded macro search while keeping batteries, cutoff, main buses, SmartShunt, balancers, MultiPlus and its AC breakouts in their required rigid/fixed relationships. A candidate is only emitted after the production router and exact geometry audits pass with zero conflicts, the current-safety finding set does not regress, total routed length improves, high-current routed length does not grow and no unprotected battery-positive source lead grows. The present layout is always retained as a candidate, so a coarse score cannot displace a safer exact layout.

`scripts/propose-diagram-layout.ts` applies the same proposal-only policy to the global 2D schematic. It searches deterministic 20 × 10 macro placements, keeps attachment chains with their owners and each declared `layoutGroup` family in its canonical order, expands candidates with the real asymmetric node footprints, and sends only a bounded finalist set through `buildDiagramLayout` and the production router. Every finalist must preserve cardinality, flow direction, parallel-wire clearance, canvas size and all zero-conflict geometry audits without regressing crossings, turns or routed length. All exact survivors are Pareto-ranked; otherwise the current exact layout is retained. Output is source-hashed JSON on stdout and never rewrites authored coordinates or generated artifacts.

Current limiting and overcurrent protection are analyzed separately by programmatic graph traversal from every declared supply. The report grades evidence as verified, provisional or incomplete; follows each active channel and explicit protective-device terminal pair; records per-source protection evidence; checks downstream conductor and device ratings; aggregates supplies that can feed a common segment; and identifies incomplete source, channel or return-pair metadata. A breaker rating is overcurrent coordination evidence, not an assumed prospective-fault-current limit; interrupt capacity and fault clearing remain separate commissioning evidence. The verified Orion output limiter enables its downstream socket wiring, while the Orion's published normal/short-circuit envelopes and unresolved fault-clearing evidence remain visible as structured verifier limitations rather than blanket wire holds.

The two DIHOOL 10 A AC-in/out RCBO + SPD units are recorded as purchased, so purchase-fade mode treats them like other received equipment. Both devices and the AC enclosure remain commissioning holds until their exact received Type A/30 mA/SPD, pole, interrupt, PE and 230 V / 50 Hz suitability are accepted.

Every exterior circuit is split at the one modeled inside/outside service penetration. Generator AC, the electrode bond, all PV leads and frame bonds, the outdoor light, and both Starlink leads therefore route independently on each side of the wall without introducing hidden wall crossings.

R30 models three AIKO-A490-MCE54Mw 490 W modules as one 3S string through one 20 A common-trip two-pole cutoff. There is no active combiner, comb rail, SPD or redundant PV disconnect. Four Victron BAT412201104 12 V / 220 Ah GEL batteries form two 24 V series strings in parallel for 24 V / 440 Ah. The bulk wire schedule is available at `/cable-plan` and consolidates field conductors to 1/0 AWG, 35 mm², 16 mm², 6 mm², 4 mm² and 1.5 mm², plus purpose-built multicore and factory leads.

Ordinary enclosure widths/heights grow from DIN and backplate contents plus routing clearance; the two accepted `verified-fixed` shells retain their declared routing envelopes. Their real fit is accepted from the user's received-hardware check, not inferred from rendered size. Crossing cable bundles receive one evenly spaced row of bottom glands. There are no extra-row or per-device routing exceptions.

R30 uses two DC junction boxes and an exposed main-distribution zone:

1. A battery-adjacent cutoff box containing exactly three purchased non-polarized DIHOOL 120 A devices: battery string A, battery string B and the SmartSolar battery-side cutoff. The fit of the second purchased Mollom HT-8 shell (advertised 200 × 155 × 92 mm) is verified and accepted for this exact three-device layout; the first HT-8 remains an AC-unsuitable spare.
2. An exposed, guarded main-distribution cluster containing the purchased Joinfworld 250 A four-stud positive and negative buses plus the SmartShunt beside the negative bus. Install the supplied red/black bus covers; the IP65 SmartShunt itself remains uncovered. Battery negatives land only on SmartShunt BATTERY MINUS; SmartShunt SYSTEM MINUS feeds the main negative bus. The required main-positive lug stacking is approved for the accepted layout.
3. A secondary-services box containing the purchased 10 A shared-services breaker, the two purchased 32 A Orion and ChargeIT breakers, one Blue Sea 2314 secondary positive bus, one Blue Sea 2314 secondary negative bus, the six-gang service switch panel, the 24 V-to-5 V USB-A converter and the internal Starlink power routing. Both buses mount on the rear plane about one-third of the way up. The switch panel and UniFi converter occupy the rear top edge; all seven switch posts and all three converter posts, including the white USB cable post, face down. The routed envelope is 600 × 640 × 240 mm; select and mock up a larger shell before purchase. The owned 302 × 302 × 178 mm enclosure is an undersized spare, not the installed box.

The secondary feeder is modeled as one positive conductor and one negative conductor through ordinary glands. There is no separate 80 A battery incomer. The direct positive feeder remains a commissioning hold until its source-side overcurrent protection, ampacity and both 100 A secondary-bus envelopes are documented; downstream branch breakers do not protect the feeder from an upstream fault. No insulated positive or negative feed-through stud has been purchased or approved; bulkhead studs must not replace the glanded arrangement until their insulation, current rating, creepage, sealing and mechanical protection are selected and verified.

The secondary negative bus has nine direct modeled connections—one main-bus feeder and eight equipment returns—against seven physical landing positions. R30 deliberately removes the former service-return, lighting-return and Starlink/UniFi-return split devices from the graph and drawings. The terminal-count excess is a visible installation warning; an installer may select appropriate splitters onsite, but the schematic does not invent or imply them.

The 3D enclosure bodies and their nearby 10/20 mm lattice envelopes are planning geometry used to keep routed terminal launches and cable clearance deterministic; the rendering does not constitute a true-size enclosure fit check. Only the 200 × 155 × 92 mm cutoff-shell fit is accepted from the user's received-hardware verification. The larger secondary shell remains a fit/purchase hold. The MPPT, Orion and secondary enclosure share the MultiPlus bottom datum; the compact PV cutoff box sits above the service penetration, and the tool outlet, AC box, Ekrano and UniFi share the higher UniFi datum. The MultiPlus VE.Bus receptacle is on its bottom edge. The indoor-light breakout is at the left cable bend so the short black return stops there and only the red switched conductor makes the long lateral run to the wall switch.

Integrated cable breakouts are physical outside-device geometry. The generator's red/black/green output posts merge outside the generator into one white three-core cable, while the Type I trailing outlet's white cable splits outside the outlet; both retain ordinary depth testing. Charging-device receptacles use port-specific USB-C pill geometry or USB-A rectangular-shell/tongue geometry instead of generic dark slots.

The retained 1/0 AWG inventory is five Shirbly red/black pairs: three 1.5 ft pairs and two 2 ft pairs. That is ten individual preterminated cables and 17 conductor-feet. All four iGreely pairs were returned and their combined refund is tracked separately, so they are not usable inventory. The retained cables' fixed 3/8 in / M10 ring ends do not automatically fit the battery M8 posts, MultiPlus M8 posts or clamp-style breaker/SmartSolar terminals. Keep the battery-to-cutoff and nearby main-distribution paths as short as practical, but allocate each assembly only after a full-size received-hardware mock-up.

The final routed 1/0 field-cable geometry totals 9.12 m; adding at least 10% service/bend allowance per route produces a 10.40 m / 34.12 ft procurement/mock-up plan. The four battery source leads total 2.60 m, down from 6.58 m in the retired layout. Use the imported fixed assemblies only where their received length, conductor markings and lug geometry match; purchase the remaining correctly terminated 1/0 AWG cable onsite in Fiji, including both MultiPlus feeds and the secondary feeder pair.

## Tests and speed

```bash
npm run benchmark:routing
npx tsx scripts/propose-physical-layout.ts > /tmp/dse-layout-proposal.json
npx tsx scripts/propose-diagram-layout.ts > /tmp/dse-diagram-layout-proposal.json
npm test
npm run test:e2e
npm run lint
```

The routing benchmark performs one cold full-graph build and fails above 60 seconds, if any path is unroutable, if true-radius cable sweeps touch, if a cable intersects itself, or if a route intersects or passes in front of an unrelated device. Browser hydration uses only the precomputed artifact. The diagram scopes are likewise generated ahead of time and load from their checked artifact with zero browser routing. Diagram generation rejects fallback routes, node or conductor overlaps, diagonal/coincident segments and wires passing through nodes; regression budgets also cap crossings, turns and routed length. The canonical test suite checks the split cutoff/main/secondary topology, full-depth enclosure front projections, single-penetration topology, short adjacent battery jumpers, high-current placement, direct secondary returns, USB daisy topology, graph-derived labels, three-core breakouts, straight AC earth tees, terminal metadata/orientation, current-protection traversal, integer-lattice alignment, enclosure fit, single gland rows and successful A* routes. Browser tests check the retained tabs, shared diagram/model counts, directional junction ports, per-scope Back/Escape view restoration, arched crossing jumps, direct reselection, purchased-device fade with independent hold state, the bright yellow 3D hover bound, wire rendering, USB port geometry, BOM weights and route diagnostics.

## Order-receipt ingestion

Private receipts go in `private/to-process/`. Extract only non-PII order data, validate line-item and grand-total arithmetic, reconcile the BOM/delivery/customs files, update the retailer-specific PII-free private aggregate, then move and rename each receipt into `private/`. The latest order/return reconciliation is encoded in `scripts/ingest-2026-08-30-amazon-audit.mjs`; the prior batches remain in the dated Aug 24–26 scripts. Rerunning any applicable ingestion must not duplicate orders or BOM rows. The queue must be empty before the run is complete. Full policy lives in `AGENTS.md`; never commit `private/`.

Every BOM row records unit and extended mass plus a provenance basis: retailer listing first, manufacturer datasheet second, documented estimate third, or explicit `not-applicable` for non-physical cost rows. These are planning/net weights, not guaranteed airline packed weights; weigh the final packed cases before travel.

BOM accounting keeps solar/internet design costs separate from other managed purchases. Rows tagged `accountingGroup: "additional"`—including phones, laptops, personal equipment and their allocated tax or promotion adjustments—appear in the additional-purchases total, never the design total. Return-pending, research and otherwise excluded rows remain visible for tracking but contribute to neither total.

## Public and private checkouts

`data/dse-receipts.json` is the public, PII-free receipt index. It contains numeric invoice references, dates, suppliers, filenames, item-to-invoice mappings and ASIN mappings, but never receipt contents, names, addresses, payment details or account data. Development and build hooks regenerate it automatically when the ignored private reconciliation inputs exist, and preserve the committed index when they do not. The customs page uses this index in both public and private checkouts, so it can refer to supporting PDFs without committing them.

Customs line descriptions are normalized by `scripts/normalize-customs-descriptions.mjs` into make, model and non-duplicative additional information. The customs page uses that same structured row set for its editable table and CSV download; return-bound and personal-use rows are excluded before either representation is built.

The entire `private/` directory remains ignored. A public checkout builds and runs without it. Set `DSE_PRIVATE_MODE=1` only on a trusted private machine that has the archived PDFs; the Costs and Customs pages will then expose a **Download all receipts (.zip)** action. Each PDF in the ZIP is prefixed with its zero-padded public receipt reference (for example, `09-amazon-…pdf`). The server endpoint enumerates only strict root-level `private/*.pdf` basenames, rejects traversal, escaping symlinks, and PDFs without a public receipt reference, and is unavailable in public mode. The endpoint has no application login: every client permitted to reach the private service can download the archive, so keep it behind trusted LAN/Tailscale ACLs and never expose it to the public internet. The local `dse-solar-viewer.service` is configured for private mode.

The Costs page is a category-colored treemap of every positive-cost BOM row, with rectangle area proportional to total USD item cost and accounting scope called out for solar/internet, additional purchases and excluded/return items. Its scope selector can isolate any one of those accounting subsets and recomputes the treemap, legend, row count, positive value and applicable credits together. Its grant-report PDF and CSV separate intended-use sections from payer subtotals, track IYOIYO against the $8,000 PTS check, record every Fiji purchase and customs invoice 00070037 as DSE-paid, and attribute the Ekrano GX funding to Erik Godo without deducting it from IYOIYO purchases. Both exports use the same cost-descending section order and totals. Credits remain in the BOM accounting totals but do not receive invalid negative treemap area. The Shipping page is a category-colored, area-proportional treemap of every physical BOM row marked `Import`. Customs deliberately omits planning masses. Its optional low-cost-accessory grouping is only a broker-review presentation: every goods line below USD 30 is grouped, every underlying item name is retained in the description, and the exact values, ASINs and invoice references remain preserved in the disclosure. Country-of-origin research is stored per item with provenance; unresolved data remains blank and is displayed as `N/A` pending label or invoice confirmation.

## Electrical design policy

Use resettable breakers instead of field-replaceable distribution fuses wherever a correctly rated breaker can provide the required protection and interrupt capacity. Fiji island availability is a design constraint. Nominal systems at 24 V or less are treated as touch-safe for enclosure partitioning, but battery fault current, terminal guarding, strain relief, torque and overcurrent protection remain mandatory. The graph verifier is a consistency and evidence tool, not an approval of unverified breaker interrupt ratings, fault-clearing time or local-code acceptance. See `AGENTS.md` for the complete current safety holds.
