# Fable integration — 8 Sep 2026

The Fable working tree and the newer local changes were merged against their shared Git base, `50224ff`. No commits were made and the source folder was left intact for its owner to delete.

## Included

- Separate physical placement, voxel routing, route-audit and current-protection modules; a small runtime coordinator.
- Hierarchical diagram placement, terminal slot optimization, compacted routing, paired supply sheaths, enclosure subpatches and corrected terminal geometry.
- Lazy 3D/cable-plan screens and the hydration overlay. React Suspense replaces duplicate manual module-loading state.
- Routing/diagram benchmarks, generated experimental wall-plan output, and the cable-plan updater.
- Newer Fiji purchases, grant reporting, private receipts, Polowat planning and archived arrival screens retained from the main checkout.

## Fixed installation

DSE is on Fulaga. No equipment, BOM/accounting entries, electrical connections or agreed cable assembly lengths were changed by the integration. Cable route measurements now reflect the improved solver; the 17.65 m finished-assembly schedule remains intact. The updater fails rather than silently increasing a scheduled assembly. The experimental wall placement stays opt-in and is not used by either production server. Historical purchasing and fit notes remain evidence, not new procurement instructions.

The 135 physical cable routes total 127.7043 m with 559 turns (previous main checkout: 140.46 m and 848 turns). All fallback, centerline, swept-cable, self-intersection, device and rendered-geometry conflicts are zero. The full diagram has 34 crossings, 138 turns and 53,688 px of routed wire.

## Additional fixes

- Production diagram generation no longer depends on the previous output or wall-clock optimization deadlines. Fixed trial limits and normalized timing fields make a clean rebuild byte-for-byte reproducible.
- Runtime/diagram source hashes cover their helper modules. Runtime generation always runs the exact rendered-geometry audit; an explicitly requested missing wall plan fails instead of silently falling back.
- Phone toolbars wrap without hiding zoom controls; Fit can show the complete system. The canvas uses the space left by its actual toolbar height.
- Browser and Worker type checks run separately, using generated, ignored Cloudflare runtime declarations.
- The production launch script validates its port and runs in the foreground without killing unrelated port users.

## Runtime and recovery

Both user services use `/home/kyle/Documents/GitHub/dse-solar/viewer`:

- `dse-solar-viewer.service`: port 3000.
- `dse-solar-viewer@3001.service`: port 3001, replacing the former process in the Fable folder.

Both ports bind all interfaces and accept `vibecheck.local` and `vibecheck.taildd340.ts.net`. No source symlinks or running viewer processes depend on the old checkout.

The original source trees, private inputs, both Git histories and Fable local state were backed up to:

`/home/kyle/Documents/dse-integration-backup-20260908-134705`

The private receipt comparison found 145 identical files and two older differing variants. Those variants are also retained in ignored `private/fable-retained/`; they do not replace the newer accounting inputs or enter receipt downloads. Shared source documents outside Git were compared as well.

## Verification

- Production and static Pages builds.
- 82 Node tests, including graph completeness, geometry, protection evidence, fixed cable lengths and accounting.
- 11 browser tests: diagram/subpatch navigation, models, inspection, both projects, cable schedule, costs, PDF/CSV exports, private receipt ZIP, and phone zoom controls/full-diagram fitting.
- ESLint and separate browser/Worker TypeScript checks.
- Byte-for-byte equality after deleting and regenerating the diagram artifact.
- Desktop and 390 px phone screenshots under ignored `.qa/integration/`.
