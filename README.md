# DSE Fiji solar-system viewer

This viewer is the installation record for the Drua Sailing Experience solar system in Fiji. R27 supports one project and one wiring authority: the canonical graph in `app/dseTopology.ts`.

The detailed diagram and 3D scene resolve the same graph through `app/dseRuntime.ts`. There is no PNG/PG mode, overview diagram, separate junction-box tab, AC-junction tab, hand-maintained physical-layout JSON, or overnight layout optimizer.

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

Repeated physical families declare their diagram rows or grids in the canonical device data. The 2D view is a logical left-to-right schematic: PV and other sources sit on the left, protection and conversion occupy the center, loads fan out to the right, and the battery bank stays below the battery-adjacent cutoff and external main-distribution cluster. Abstract junctions and their internal subpatches place incoming conductors on the left, outgoing conductors on the right, and battery, earth and data conductors along the bottom. This logical port placement is intentionally independent of the physical single bottom gland row retained by the 3D model. The 3D camera maps ordinary wheel/two-finger trackpad scroll to cursor-anchored zoom at the doubled response, one-touch drag to orbit, and two-touch or right-button drag to pan.

The build-time router sorts cables by outside diameter, thickest first, then solves and locks them strictly one at a time on the global 20 mm lattice. Fixed gland throats remain reserved, while terminal-clearance reservations respect that route priority. It blocks routing volumes around unrelated devices, strongly penalizes distance from the wall, prefers lower exterior routes, lightly penalizes turns, and assigns every occupied cable cell to one connection so later wires cannot reuse or intersect it. Bundle IDs describe procurement and shared glands only. There is no fallback path: an unroutable connection fails generation with diagnostics. Radius-aware audits reject centerline crossings, cable-envelope contact, cable self-intersection, device contact, wall-volume crossings, off-axis terminal approaches, and conflicts in the exact rounded cable and Y-join geometry shared with the Three.js renderer. Curvature is also checked against cable radius.

Every exterior circuit is split at the one modeled inside/outside service penetration. Generator AC, the electrode bond, all PV leads and frame bonds, the outdoor light, and both Starlink leads therefore route independently on each side of the wall without introducing hidden wall crossings.

Ordinary enclosure widths/heights grow from DIN and backplate contents plus routing clearance; the two accepted `verified-fixed` shells retain their checked envelopes. Crossing cable bundles receive one evenly spaced row of bottom glands. There are no extra-row or per-device routing exceptions.

R27 replaces the former single main 24 V enclosure with three coordinated zones:

1. A battery-adjacent cutoff box containing exactly three purchased non-polarized DIHOOL 120 A devices: battery string A, battery string B and the SmartSolar battery-side cutoff. The fit of the second purchased Mollom HT-8 shell (advertised 200 × 155 × 92 mm) is verified and accepted for this exact three-device layout; the first HT-8 remains an AC-unsuitable spare.
2. An exposed, guarded main-distribution cluster containing the purchased Joinfworld 250 A four-stud positive and negative buses plus the SmartShunt beside the negative bus. Install the supplied red/black bus covers; the IP65 SmartShunt itself remains uncovered. Battery negatives land only on SmartShunt BATTERY MINUS; SmartShunt SYSTEM MINUS feeds the main negative bus. The required main-positive lug stacking is approved for the accepted layout.
3. A secondary-services box containing a selected-to-buy generic 10 A shared-services breaker, the two purchased 32 A Orion and ChargeIT breakers, one Blue Sea 2314 secondary positive bus, one Blue Sea 2314 secondary negative bus, the six-gang service switch panel, the USB-C converter and the internal Starlink power routing. Fit of the purchased 302 × 302 × 178 mm nominal ventilated ABS shell is verified and accepted for these contents.

The secondary feeder is modeled as one source-protected positive conductor and one negative conductor through ordinary glands. Before energizing, coordinate the source-side protective device and feeder ampacity with both 100 A secondary buses. No insulated positive or negative feed-through stud has been purchased or approved; bulkhead studs must not replace the glanded arrangement until their insulation, current rating, creepage, sealing and mechanical protection are selected and verified.

The 3D view renders the received 200 × 155 × 92 mm cutoff shell and 302 × 302 × 178 mm secondary shell at their true external dimensions. Their nearby 10/20 mm lattice envelopes are solver-only geometry used to keep every routed terminal launch and cable clearance deterministic; they are not substituted for the visible enclosure bodies or inspector dimensions.

The actual 1/0 AWG inventory is nine red/black pairs: three 1 ft iGreely pairs, three 1.5 ft Shirbly pairs and three 2 ft pairs (one iGreely and two Shirbly). That is 18 individual preterminated cables and 27 conductor-feet. Their fixed 3/8 in / M10 ring ends do not automatically fit the battery M8 posts, MultiPlus M8 posts or clamp-style breaker/SmartSolar terminals. Keep the battery-to-cutoff and nearby main-distribution paths as short as practical, but allocate each assembly only after a full-size received-hardware mock-up.

The final routed 1/0 field-cable geometry totals 9.84 m; adding at least 10% service/bend allowance per route produces an 11.20 m / 36.75 ft cutting plan. The four battery source leads total 2.60 m, down from 6.58 m in the retired layout. Use the imported fixed assemblies only where their received length, conductor markings and lug geometry match; purchase the remaining correctly terminated 1/0 AWG cable onsite in Fiji, including both MultiPlus feeds and the secondary feeder pair.

## Tests and speed

```bash
npm run benchmark:routing
npm test
npm run test:e2e
npm run lint
```

The routing benchmark performs one cold full-graph build and fails above 60 seconds, if any path is unroutable, if true-radius cable sweeps touch, if a cable intersects itself, or if a route intersects an unrelated device. Browser hydration uses only the precomputed artifact. The diagram scopes are likewise generated ahead of time and load from their checked artifact with zero browser routing. Diagram generation rejects fallback routes, node or conductor overlaps, diagonal/coincident segments and wires passing through nodes; regression budgets also cap crossings, turns and routed length. The canonical test suite checks the split cutoff/main/secondary topology, single-penetration topology, short adjacent battery jumpers, high-current placement, USB daisy topology, explicit joins, integrated three-core breakouts, terminal metadata/orientation, integer-lattice alignment, enclosure fit, single gland rows and successful A* routes. Browser tests check the retained tabs, shared diagram/model counts, directional junction ports, arched crossing jumps, direct reselection, fade camera persistence, conductor hover bounds, wire rendering, BOM weights and route diagnostics.

## Order-receipt ingestion

Private receipts go in `private/to-process/`. Extract only non-PII order data, validate line-item and grand-total arithmetic, reconcile the BOM/delivery/customs files, update the retailer-specific PII-free private aggregate, then move and rename each receipt into `private/`. The latest incremental reconciliations are encoded in the dated `scripts/ingest-2026-08-26-*.mjs` scripts; the prior batches remain in the Aug 24 and Aug 25 scripts. Rerunning any applicable ingestion must not duplicate orders or BOM rows. The queue must be empty before the run is complete. Full policy lives in `AGENTS.md`; never commit `private/`.

Every BOM row records unit and extended mass plus a provenance basis: retailer listing first, manufacturer datasheet second, documented estimate third, or explicit `not-applicable` for non-physical cost rows. These are planning/net weights, not guaranteed airline packed weights; weigh the final packed cases before travel.

BOM accounting keeps solar/internet design costs separate from other managed purchases. Rows tagged `accountingGroup: "additional"`—including phones, laptops, personal equipment and their allocated tax or promotion adjustments—appear in the additional-purchases total, never the design total. Return-pending, research and otherwise excluded rows remain visible for tracking but contribute to neither total.

## Public and private checkouts

`data/dse-receipts.json` is the public, PII-free receipt index. It contains numeric invoice references, dates, suppliers, filenames, item-to-invoice mappings and ASIN mappings, but never receipt contents, names, addresses, payment details or account data. Development and build hooks regenerate it automatically when the ignored private reconciliation inputs exist, and preserve the committed index when they do not. The customs page uses this index in both public and private checkouts, so it can refer to supporting PDFs without committing them.

Customs line descriptions are normalized by `scripts/normalize-customs-descriptions.mjs` into make, model and non-duplicative additional information. The customs page uses that same structured row set for its editable table and CSV download; return-bound and personal-use rows are excluded before either representation is built.

The entire `private/` directory remains ignored. A public checkout builds and runs without it. Set `DSE_PRIVATE_MODE=1` only on a trusted private machine that has the archived PDFs; the customs page will then expose a **Download receipts (.zip)** action. Its server endpoint enumerates only strict root-level `private/*.pdf` basenames, rejects traversal and escaping symlinks, and is unavailable in public mode. The endpoint has no application login: every client permitted to reach the private service can download the archive, so keep it behind trusted LAN/Tailscale ACLs and never expose it to the public internet. The local `dse-solar-viewer.service` is configured for private mode.

The Shipping page is a category-colored, area-proportional treemap of every physical BOM row marked `Import`. Customs deliberately omits planning masses. Its optional low-cost-accessory grouping is only a broker-review presentation: every goods line below USD 30 is grouped, every underlying item name is retained in the description, and the exact values, ASINs and invoice references remain preserved in the disclosure. Country-of-origin research is stored per item with provenance; unresolved data remains blank and is displayed as `N/A` pending label or invoice confirmation.

## Electrical design policy

Use resettable breakers instead of field-replaceable distribution fuses wherever a correctly rated breaker can provide the required protection and interrupt capacity. Fiji island availability is a design constraint. Nominal systems at 24 V or less are treated as touch-safe for enclosure partitioning, but battery fault current, terminal guarding, strain relief, torque and overcurrent protection remain mandatory. See `AGENTS.md` for the complete current safety holds.
