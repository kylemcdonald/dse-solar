# DSE solar system viewer

Interactive desktop and mobile viewer for the proposed Drua Sailing Experience (Fiji) solar system and the Pasana Group (Papua New Guinea) reference system. It includes connectivity diagrams, a measured-envelope 3D fit model, system planning notes, BOMs and field notes. In the 3D view, one-finger touch rotates around the picked model point; two-finger touch pans and pinch-zooms at that depth.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000/>.

Canonical system specifications live in `data/dse-system.json` and `data/pg-system.json`. Physical envelopes and site-layout assumptions for the DSE 3D view live in `data/dse-model.json`. `app/physicalLayoutSolver.ts` independently generates component positions, explicit ports, major routed centerlines, cable lengths, direction-reversal checks, clearance checks and an optimization score; Three.js consumes that specification. The scene uses one metre per unit, preserves separate positive/negative conductors and distinguishes verified product dimensions from planning assumptions. A shared cable-routing system renders continuous radius-controlled bends, carries all 23 junction-box conductors through explicit glands on continuous centerlines, audits tangent render handoffs, checks registered solids and separates non-terminal cable crossings in depth. Four batteries sit on the floor in a 2 × 2 footprint. The junction-box preset exposes the selector, both sides of the SmartShunt, separate 24 V busbars, positive-only 12 V branch fuses and the unfused 12 V negative-return bus. Protective-earth runs terminate at a modeled electrode, array lug, main PE bar or equipment lug; the Starlink Ethernet route is generated directly to the UniFi WAN port without a horizontal double-back.

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
