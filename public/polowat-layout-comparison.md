# Polowat enclosure layout comparison

Historical enclosure/backplate comparison. The subsequent [DIN ordering and spacing optimization](polowat-din-optimization.md) supersedes the rail order, spacing and cable totals below.

Eight deterministic layouts were tested on the shared 20 mm router. Only Polowat opts into touching DIN components and centered gland bores. Fiji’s device, terminal, gland and route geometry is protected by a saved SHA-256 regression fixture.

Reject every collision and routing/gland failure. Prefer lower DIN. Compare footprint, cable length and battery source-lead length; score = area m² + 0.01 × cable m + 0.02 × battery source-lead m (lower is better).

| Layout | Result | Envelope W × H × D (mm) | Cable (m) | Battery source leads (m) | Score |
| --- | --- | --- | --- | --- | --- |
| top-sources-3 | Audit rejected | 520 × 640 × 240 | 26.857 | 3.059 | — |
| bottom-sources-2 | Pass | 520 × 680 × 240 | 32.008 | 2.493 | 0.72353 |
| bottom-sources-3 | Pass | 520 × 640 × 240 | 31.89 | 2.493 | 0.70155 |
| bottom-batteries-3 | Pass | 520 × 640 × 240 | 33.273 | 2.252 | 0.71056 |
| bottom-loads-3 | Pass | 520 × 640 × 240 | 34.216 | 2.526 | 0.72549 |
| bottom-converters-3 | Pass | 520 × 680 × 240 | 30.905 | 2.489 | 0.71242 |
| bottom-wide-3 | Pass | 600 × 560 × 240 | 29.205 | 2.484 | 0.67774 |
| bottom-wide-monitor-3 **selected** | Pass | 600 × 520 × 240 | 31.406 | 2.254 | 0.67113 |

Selected **bottom-wide-monitor-3**: 600 × 520 × 240 mm. The lower rail holds all six breakers and four terminal-pair devices edge-to-edge. Space under the rail remains for gland entries and cable bends. Backplate order from lower rows upward: batteryShunt, monitorFuse, batteryMonitor, mppt, starlinkConverter, usbCharger.

The previous 100 mm controller-layout constraint and declared inter-device gaps are removed. Functional space for terminal exits, cable radii and routing lanes remains. Cables go around the continuous DIN row. All nine entries have hollow sleeves, matching panel openings and straight approaches; their complete rounded centerlines pass the bore audit.

This is the best score among these tested candidates, not a proof of a globally optimal layout. Dimensions are routing envelopes, not a fabrication template or a new enclosure purchase. The generated cable schedule supersedes previous length estimates.

The layout sweep above uses the original breaker terminal directions. The subsequent [non-polarized breaker comparison](polowat-breaker-comparison.md) tests all eight direction combinations on the optimized rail; its selected routes supersede the cable totals above.

Reproduce with `npm run compare:polowat-layouts`. Raw results, including rejected candidates, are in `data/generated/polowat-layout-comparison.json`. Each solve has a 45-second budget; timed-out or invalid candidates cannot be selected.
