# DSE Fiji + Inowon Polowat solar-system viewer

This viewer contains two intentionally separate systems selected from the top-right project switcher:

- **DSE / Fiji** is the installation record for the Drua Sailing Experience system. R33 uses the canonical graph in `app/dseTopology.ts`.
- **Inowon / Polowat** is a compact planning design for Starlink Mini and USB charging. P1 uses the shared device/connection topology in `app/polowatTopology.ts` and planning ledger in `data/polowat-system.json`.

The legacy PNG/PG mode remains retired; the new Polowat design is a fresh, load-sized system rather than a restoration of that dataset. In DSE mode, the detailed diagram and 3D scene resolve the same graph through `app/dseRuntime.ts`. The Simple diagram groups functional blocks and explains the physical controls. Detailed junction diagrams open from their enclosure nodes; there is no separate physical-layout JSON. The optional layout optimizer is a bounded, exact-gated proposal tool; it is not a browser router or an unattended authority that rewrites the canonical topology.

## Run it

```bash
npm install
npm run dev -- --host 0.0.0.0
```

The development service must listen on all interfaces. Open:

- http://vibecheck.local:3000/
- http://vibecheck.taildd340.ts.net:3000/

Production:

```bash
npm run build
npm start -- --host 0.0.0.0
```

## Maintain the system

DSE is fully installed on Fulaga as of 11 Sep 2026. The latest owner report defines the installed wiring and northwest-corner arrangement. Equipment is fixed; historical procurement and cut-schedule notes are not new purchasing or fabrication instructions. `app/dseTopology.ts` remains the authority. Run `npm test` after changes.

No diagram node, 3D mesh, gland row or route artifact needs a parallel edit. Device geometry is deliberately simple and uses the declared physical envelope. Geometry uses a 10 mm integer unit and axis-aligned terminals share the global 20 mm route lattice; DIN breaker/protection geometry therefore renders at `20 mm × way count`. All such devices share one renderer.

For the compact Polowat mode, change electrical devices, connections, schematic routes, and planning geometry together in `app/polowatTopology.ts`; change quantities, costs, weights, operating assumptions, and source links in `data/polowat-system.json`.

## Runtime pipeline

```text
dseTopology.ts
  devices + conductors + cables + connections + enclosures
            │
            ├─ physicalLayout.ts (placement, terminals, glands)
            │   └─ voxelRouter.ts (20 mm lattice A*) → routeAudits.ts → currentSafety.ts
            │       └─ generate:runtime → data/generated/dse-runtime.json
            │                              └─ dseRuntime.ts → 3D scene (UnifiedSystemModel3D.tsx)
            │
            └─ diagramNodes.ts → diagramPlacement.ts (islands + layered core) → diagramLayout.ts (12 px grid router + compaction)
                └─ generate:diagram-layouts → data/generated/diagram-layouts.json
                                               └─ detailed diagram (UnifiedSystemDiagram.tsx)
```

Both checked artifacts carry a source hash and are regenerated only when their inputs change. The browser validates cardinalities and hydrates lookup maps; it never runs voxel A* or diagram routing. That keeps the first page interactive while the Three.js view remains an on-demand chunk.

## Compact Polowat design

P1 is deliberately direct DC: 3 × 100 W flexible panels in series feed a SmartSolar 100/20; two matched 12 V / 150 Ah deep-cycle batteries sit in parallel behind independent 25 A positive breakers; the controller's protected 20 A load output feeds only a regulated Starlink Mini branch and a 75 W USB charging branch. The modeled load is 520 Wh/day at a 150 W simultaneous peak. Storage is 3.6 kWh nominal, 1.8 kWh at the provisional 50% depth-of-discharge limit, and 0.9 kWh with one battery isolated.

The Polowat BOM assigns only the batteries, 20 conductor-metres of UV-rated 4 mm² PV cable, and 12 conductor-metres of flexible 4 mm² DC cable to local Chuuk purchase. Everything else—including the battery boxes—is an import. P1 estimates USD 2,096.87 in hardware before freight, duty, tax, and subscription; the imported equipment is 21.48 kg net / about 24.7 kg packed, while local equipment is provisionally 85.7 kg. The estimate uses Starlink's current USD 260 Micronesia hardware starting price and excludes recurring service. These figures are planning values until the exact batteries, account/plan, site distances, roof attachment, and final packed cartons are known.

## Installed DSE layout

The panels are on the roof. Along the west wall, batteries A1, A2, B1 and B2 run north to south with their long sides parallel to the north wall. Above them are the balancers, battery/MPPT cutoff box, main positive and negative buses, MPPT/Ekrano, then PV box/MultiPlus. The north wall carries the AC box, charging shelf and four ChargeITs, Orion and three-gang rocker plate, then the secondary services box.

The roof array has two continuous transverse mounting rails. White power cables link the three panels in series; a white Y breakout gathers the separate array ends into one white two-core downlead to the PV box.

The PV DIN rail has four devices, left to right: breaker 1, disconnected breaker 2, 40 A DC 600 V combiner, and DC 600 V 40 kA SPD. The reported earth chain is PV mounting rails → SPD → MultiPlus chassis → grounding rod, with no earth busbar. The negative V-sense lead goes to A1 negative. Exact AC PE/N bridge terminals and the positive V-sense connection have not been recorded; do not interpret neutral as a replacement for protective earth.

The external Australian three-gang plate controls Internet, Orion remote H and both indoor lights, top to bottom. Commons daisy-chain from the shared 10 A feed. Internet on returns to the three-way WAGO in the secondary box; Orion H and lighting go directly to their destinations. Both indoor lights share one two-core string with a middle splice. Socket negatives return to Orion common negative. No outdoor-light circuit or six-gang panel is modeled.

`operatorDiagram.ts` collapses the actual terminal graph into functional blocks. Its presentation paths have dedicated lanes so unrelated connections never cross or merge. The detailed diagram retains terminals, disconnected spare/loop ports and selectable junction internals. Families declare the PV rail and vertical rocker order once in the topology.

`site.walls` supplies oriented wall volumes to the router, geometric audits and 3D scene. Enclosure placement, backplate packing, glands, launch reservations and audits operate in each enclosure's local frame. The model includes a cutaway roof outline, shelf and corner/west/north camera presets. Photo-derived positions and expanded routing envelopes are illustrative; they are not measurements or a hardware fit certificate.

The historical `batteryCablePlan` is preserved unchanged, including its planned assembly lengths. The Wire cut list now identifies it as a pre-installation record. Earlier design/procurement instructions are archived in `archive/pre-installation-2026-08-31.json` and `archive/pre-installation-README.md`. See [INSTALLED.md](INSTALLED.md) for the record and unresolved observations.

## Tests and speed

```bash
npm run benchmark:routing            # cold 3D solve, add -- --audit for the rendered-tube gate
npm run benchmark:diagram            # every diagram scope with metrics and timing
npm run update:cable-plan            # historical planning tool; do not overwrite the installed record
npx tsx scripts/propose-physical-layout.ts > /tmp/dse-layout-proposal.json
npm test
npm run test:e2e
npm run lint
npm run typecheck
```

The routing benchmark performs one cold full-graph build and fails above 60 seconds, if any path is unroutable, if true-radius cable sweeps touch, if a cable intersects itself, or if a route intersects or passes in front of an unrelated device. Browser hydration uses only the precomputed artifact. The diagram scopes are likewise generated ahead of time and load from their checked artifact with zero browser routing. Diagram generation rejects fallback routes, node or conductor overlaps, diagonal/coincident segments and wires passing through nodes; regression budgets also cap crossings, turns and routed length. The canonical test suite checks the split cutoff/main/secondary topology, wall-aware enclosure front projections, single-penetration topology, battery-string continuity, installed equipment order, Orion socket returns, USB daisy topology, graph-derived labels, three-core breakouts, straight AC earth tees, terminal metadata/orientation, current-protection traversal, integer-lattice alignment, enclosure fit, single gland rows and successful A* routes. Browser tests check the retained tabs, shared diagram/model counts, directional junction ports, per-scope Back/Escape view restoration, arched crossing jumps, direct reselection, purchased-device fade with independent hold state, the bright yellow 3D hover bound, wire rendering, USB port geometry, BOM weights and route diagnostics.

## Order-receipt ingestion

Private receipts go in `private/to-process/`. Extract only non-PII accounting data, validate line-item and grand-total arithmetic, reconcile the BOM/delivery/customs files, update a source-specific PII-free private aggregate, then move and rename each source into `private/`. The latest local-purchase reconciliation is encoded in `scripts/ingest-2026-09-02-fiji-purchases.mjs`; the Amazon audit remains in `scripts/ingest-2026-08-30-amazon-audit.mjs`. Rerunning an applicable ingestion must not duplicate documents, BOM rows or totals. The queue must be empty before the run is complete. Full policy lives in `AGENTS.md`; never commit `private/`.

Every BOM row records unit and extended mass plus a provenance basis: retailer listing first, manufacturer datasheet second, documented estimate third, or explicit `not-applicable` for non-physical cost rows. These are planning/net weights, not guaranteed airline packed weights; weigh the final packed cases before travel.

BOM accounting keeps solar/internet design costs separate from other managed purchases. Rows tagged `accountingGroup: "additional"`—including phones, laptops, their portable accessories, personal equipment and their dedicated tax or promotion adjustments—appear in the additional-purchases total, never the design total. Return-pending, research and otherwise excluded rows remain visible for tracking but contribute to neither total.

## Public and private checkouts

`data/dse-receipts.json` is the public, PII-free evidence index. It contains numeric references, dates, suppliers, safe filenames, document kinds, non-sensitive references, item-to-document mappings and ASIN mappings, but never document contents, names, addresses, bank confirmation numbers, payment credentials or account data. Development and build hooks regenerate it automatically when the ignored private reconciliation inputs exist, and preserve the committed index when they do not. The grant exports use the index to distinguish a receipt from a quote and its matching payment confirmation without counting the same purchase twice.

Customs line descriptions remain normalized by `scripts/normalize-customs-descriptions.mjs` for audit history. The arrival-only Shipping and Customs components and their regression tests were archived under `archive/arrival/` on 2026-09-03; neither screen is imported, linked or bundled by the production viewer now that the equipment is in Fiji. The underlying delivery and customs ledgers remain available for reconciliation.

The entire `private/` directory remains ignored. A public checkout builds and runs without it. Set `DSE_PRIVATE_MODE=1` only on a trusted private machine that has the archived PDFs; the Costs page will then expose a **Download all receipts (.zip)** action. Each PDF in the ZIP is prefixed with its zero-padded public evidence reference (for example, `09-amazon-…pdf`). The server endpoint enumerates only strict root-level `private/*.pdf` basenames, rejects traversal, escaping symlinks, and PDFs without a public reference, and is unavailable in public mode. The endpoint has no application login: every client permitted to reach the private service can download the archive, so keep it behind trusted LAN/Tailscale ACLs and never expose it to the public internet. The local `dse-solar-viewer.service` is configured for private mode.

The Costs page is a category-colored treemap of every positive-cost BOM row, with rectangle area proportional to the USD accounting equivalent and accounting scope called out for solar/internet, additional purchases and excluded/return items. Original FJD amounts and payer attribution are retained in each Fiji item's details. Its scope selector recomputes the treemap, legend, row count, positive value and applicable credits together. The redesigned grant PDF and CSV form one evidence-backed ledger: on-site Fiji purchases show both FJD and USD, Solar Fiji quote #49 is paired with payment confirmation #50, R.C. Manubhai tax invoice #48 records the separate cash purchase, and customs invoice #44 supports the import-tax and agent costs. Every documented cost was paid by IYOIYO, so the exports state that basis once and omit a redundant per-row payer column. The closing scope summary reconciles $11,156.93 in solar-system/shared project costs plus $3,422.50 outside scope to the unchanged $14,579.43 combined total. One of the two SSDs and one of the two SD card readers are visibly allocated to Inowon in Polowat at $179.98 in documented item prices; shared order-level adjustments and customs charges remain unallocated by recipient. The funding summary compares IYOIYO's full purchase total with the $8,000 PTS advance and preserves the Ekrano GX donation attribution without deducting it from purchases. Credits remain in accounting totals but do not receive invalid negative treemap area.

## Electrical design policy

Use resettable breakers instead of field-replaceable distribution fuses wherever a correctly rated breaker can provide the required protection and interrupt capacity. Fiji island availability is a design constraint. Nominal systems at 24 V or less are treated as touch-safe for enclosure partitioning, but battery fault current, terminal guarding, strain relief, torque and overcurrent protection remain mandatory. The graph verifier is a consistency and evidence tool, not an approval of unverified breaker interrupt ratings, fault-clearing time or local-code acceptance. See `AGENTS.md` for the complete current safety holds.

## Wall plan (experimental)

`scripts/generate-wall-plan.ts` derives a 3D wall layout from the wiring diagram's flow placement: each wall device takes its diagram centre scaled onto the equipment wall, wires attract their ends with the fourth power of cable diameter so the heavy-current cluster closes up around the floor batteries, heavy links share a mounting row, bodies push apart to real sizes plus cable clearance, and floor equipment slides under its feeders. The plan is written to `data/generated/wall-plan.json` and applied by `generate:runtime` only with `DSE_WALL_PLAN=1`: as of 2026-09-04 it routes (144 m of cable, 614 turns) but misses the physical budgets the tests hold the authored layout to (battery source leads 6.4 m against 4.0 m, the SmartShunt off the negative bus's row, protective-earth landings 7.1 m against 5.6 m), so the checked artifacts keep the authored positions.

## Serving

The page is server-rendered and shows a loading overlay until the client has hydrated. `scripts/serve-production.sh 3001` builds and serves in the foreground on all interfaces. The script never kills another process using the port. The installed user services serve the production build on ports 3000 and 3001 from this checkout:

- http://vibecheck.local:3000/ and http://vibecheck.taildd340.ts.net:3000/
- http://vibecheck.local:3001/ and http://vibecheck.taildd340.ts.net:3001/

After building, restart `dse-solar-viewer.service` and `dse-solar-viewer@3001.service`. The latter uses `systemd/dse-solar-viewer@.service`. No service depends on the former Fable checkout.

Type checking generates ignored Cloudflare runtime declarations using the installed `wrangler`, then checks the browser and Worker projects separately. `worker/types.wrangler.jsonc` is a local type-generation config with no credentials or resource bindings.
