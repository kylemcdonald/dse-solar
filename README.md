# DSE solar system viewer

Interactive desktop and mobile viewer for the proposed Drua Sailing Experience (Fiji) solar system and the Pasana Group (Papua New Guinea) reference system. It includes connectivity diagrams, a measured-envelope 3D fit model, system planning notes, BOMs and field notes. In the 3D view, one-finger touch rotates around the picked model point; two-finger touch pans and pinch-zooms at that depth.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000/>.

Canonical system specifications live in `data/dse-system.json` and `data/pg-system.json`. Physical envelopes and site-layout assumptions for the DSE 3D view live in `data/dse-model.json`; the reproducible optimized site/wall result lives in `data/optimized-physical-layout.json`, and the optimized junction-box result lives in `data/junction-optimized-layout.json`. `app/physicalLayoutSolver.ts` runs only in offline scripts and tests: it generates component positions, oriented terminal ports, major routed centerlines, cable lengths, direction-reversal checks, device-front clearance checks and an optimization score. The browser imports the frozen specification through `app/physicalLayout.ts`; it contains no layout editor, local-storage overrides, browser-time route solving or renderer-time detours. The scene uses one metre per unit, preserves separate positive/negative conductors and distinguishes verified product dimensions from planning assumptions. Every cable connection is represented by a cylindrical port touching the device face, and every route must approach that port straight along its sole legal axis before turning. A shared cable renderer creates continuous radius-controlled bends, carries 35 internal wire segments through 14 bottom-face cable glands and one Starlink jack, and audits tangent render handoffs. Four batteries sit on the floor in a 2 × 2 footprint. The junction-box preset exposes the whole-bank ON/OFF disconnect, both sides of the SmartShunt, its supplied fused Vbatt+ sense lead, the exact Blue Sea busbars, resettable positive-side service breakers and the unswitched negative-return bus. The physical model also includes two independent balancer-alarm links and the MultiPlus battery-temperature sensor; Ekrano DVCC receives Shared Voltage/Current Sense from the SmartShunt and Shared Temperature Sense from the MultiPlus. Each low-current load pair shares one gland and separates only inside the box. Protective-earth runs terminate at a modeled electrode, array lug, main PE bar or equipment lug; the Starlink Ethernet route is generated directly to the UniFi WAN port without a horizontal double-back.

The physical layout optimizer uses a deterministic evolutionary search and regenerates every terminal-derived route for each candidate. Its default run is one minute; the checked-in result keeps the batteries and equipment cluster at the array-side end, shifts both lights left, locks the Ekrano center at 1.58 m, and enforces a 200 mm device-to-device service border. Thick cable length costs 2× thin cable length; integrated distance from the wall, every cable turn and the unfused battery-positive leads to the two Class T holders add explicit cost. Every connection must leave its oriented port axially; wall-mounted leads then drop vertically and remain outside every device-front projection. Re-finalize after changing deterministic routing rules to refresh metrics without discarding the original run history:

```sh
npm run optimize:layout
npm run optimize:layout -- --seconds 60 --resume data/optimized-physical-layout.json
npm run optimize:layout -- --finalize --resume data/optimized-physical-layout.json
```

## Optimize the junction box

```bash
npm run optimize:junction
```

The default run uses a deterministic seed and a measured one-minute wall-clock budget. A budget-safe steady-state evolutionary loop checks the deadline after every completed candidate and will not start another candidate when its observed evaluation time no longer fits. It warm-starts from the saved result when one exists, then evolves 9 component centers plus the order and row split of all 15 bottom-face interfaces. A deterministic sequential 3D A* finalizer derives all 35 wire segments, reserving each accepted rounded centerline at its full rendered radius plus a 1 mm air gap. It also reserves every future connector approach before routing earlier conductors, so a cable cannot consume the only legal path into a later port. Older saved genomes are schema-reconciled automatically when a circuit or gland is added. A fast `--pack-only` preflight verifies component feasibility independently of routing. The DSE enclosure uses a 340 × 235 mm interior (about 370 × 265 × 150 mm / 14.6 × 10.4 × 5.9 in exterior), only 20 × 18 mm larger than the PG footprint; the original PG-sized interior could not satisfy the physical clearances. Each component terminal receives an oriented cylindrical port touching its device face, and every conductor must meet it straight along its sole legal axis. Through-wall switch bodies are interior keep-outs and each bottom gland owns a straight breakout column through a device-free gutter. Before an artifact can be saved, a renderer-equivalent rounded-tube audit must report zero cable contacts, zero device contacts, zero coincident runs and zero invalid port approaches inside the 130 mm routing envelope. Thick conductors of at least 10 mm modeled outside diameter cost 2× per metre; integrated distance from the inner back wall and every 3D turn add cost. No renderer-time crossover repair mutates the saved result. The command writes the full genome, convergence history, metrics and renderer-ready paths atomically to `data/junction-optimized-layout.json`.

Useful reproducible variants:

```bash
npm run optimize:junction -- --seconds 60 --seed 20260817
npm run optimize:junction -- --seconds 60 --resume data/junction-optimized-layout.json
npm run optimize:junction -- --seconds 60 --fresh
npm run optimize:junction -- --seconds 15 --population 24 --output data/junction-trial.json
npm run optimize:junction -- --evaluate-only --resume data/junction-optimized-layout.json
npm run optimize:junction -- --finalize --resume data/junction-optimized-layout.json
```

`--evaluate-only` reruns the exact geometry and clearance audit without mutating the result. `--finalize` reapplies direction-preserving polyline compaction and the renderer-equivalent rounded-tube audit to a saved evolutionary winner while preserving its original elapsed time, evaluation count and convergence history.

## Verification

```bash
npm run lint
npm test
npm run test:e2e
npx playwright test --config=playwright.config.mjs --browser=webkit -g "mobile layout"
```

The browser interaction test is in `tests/viewer.e2e.spec.mjs` and can be run with the globally installed Playwright test runner while the local server is active. Its mobile scenario covers portrait and landscape layouts plus one- and two-finger camera gestures; the WebKit run exercises the Safari engine.

## GitHub Pages

`npm run build:pages` produces a static client build in `dist-pages/`. The GitHub Actions workflow in `.github/workflows/pages.yml` builds and publishes that artifact whenever `main` is pushed. Use `npm run preview:pages -- --host localhost --port 4173` to review the Pages build locally.
