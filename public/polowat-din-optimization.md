# Polowat DIN rail optimization

Minimize enclosure area m² + 0.01 × rounded cable m + 0.02 × upstream battery-positive lead m. All physical, gland, orthogonality and rendered audits are mandatory. Scores are routing comparisons, not dollar prices.

Connected clamps vote at the far end of each wire (all connected poles on breakers and all 3–4 used clamps on terminal pairs). Stable mean-x ordering is rerouted repeatedly until a fixed point, cycle, invalid route or 12 iterations. A second seed uses enclosure glands as local anchors. Uniform 0/20/40 mm spacing seeds explore routing aisles. The best basins are compacted, then adjacent swaps and ±20 mm aisle changes undergo full rerouting until no neighbor improves the score. Gaps are capped at 60 mm. This is a local search, not proof of the global optimum.

Evaluated 163 distinct arrangements; 163 valid. Refinement converged after 5 sweeps. Each candidate has a 90-second solve budget; failures/timeouts cannot be selected.

| Metric | Previous layout | Selected layout |
| --- | ---: | ---: |
| Rounded cable (m) | 30.05233 | 27.13739 |
| Battery source leads (m) | 2.04340 | 1.84032 |
| Bends | 197 | 175 |
| Routing score | 0.65339 | 0.62018 |
| Enclosure mm | 600 × 520 × 240 | 600 × 520 × 240 |

Left to right: pvBreaker, batteryBreakerA, controllerBreaker, positiveBus, negativeBus, loadNegativeBus, loadPositiveBus, starlinkBreaker, batteryBreakerB, usbBreaker.
Explicit aisles after devices (metres): {"positiveBus":0.02,"loadNegativeBus":0.02,"loadPositiveBus":0.02}. Other neighbors touch; wires may use only actual open aisles and must clear all bodies and their front/rear exclusion volumes.

This rail search holds the pre-search breaker direction assignment fixed (Battery A and Battery B reversed). The subsequent [breaker-direction comparison](polowat-breaker-comparison.md) retests all eight assignments on this rail; its totals and the cable schedule describe the final model. Separating terminal pairs requires checking the received end covers and rail stops. Electrical topology, procurement and Fiji installation remain unchanged. Run a fresh search with `npm run optimize:polowat-din`, or continue from the best recorded trials with `npm run optimize:polowat-din -- --resume`. Resume rejects changed physical inputs; a fresh local search can follow a different path. Raw rejected/valid candidates and endpoint means are retained in `data/generated/polowat-din-optimization.json`. The selected arrangement is a generated input to the shared layout engine.
