# Polowat non-polarized breaker routing

Same enclosure and device positions; minimize the existing layout score: area m² + 0.01 × total rounded cable m + 0.02 × upstream battery-positive lead m. This is a routing score, not a dollar price. Reject every geometry or routing failure.

Only the three declared non-polarized 30 A breakers can exchange top/bottom connections. Physical terminal IDs, pole identities, device positions and polarized PV/load breakers stay fixed. All eight combinations are tested.

| Reversed connections | Valid | Rounded cable (m) | Battery source leads (m) | Turns | Score |
| --- | --- | --- | --- | --- | --- |
| None (baseline) | Yes | 29.311 | 1.979 | 194 | 0.6447 |
| Battery A | Yes | 28.974 | 1.83 | 193 | 0.63835 |
| Battery B | Yes | 29.313 | 1.687 | 193 | 0.63887 |
| Battery A, Battery B | Yes | 28.84 | 1.499 | 193 | 0.63038 |
| Controller | Yes | 29.741 | 1.979 | 196 | 0.64899 |
| Battery A, Controller | Yes | 29.027 | 1.789 | 196 | 0.63806 |
| Battery B, Controller | Yes | 29.699 | 1.687 | 196 | 0.64273 |
| Battery A, Battery B, Controller | Yes | 28.894 | 1.499 | 192 | 0.63093 |

Lowest valid score: **Battery A, Battery B**, 0.63038, versus 0.6447 before. Total modeled cable changes by -0.471 m; upstream battery-positive leads change by -0.480 m.

These are modeled route lengths. Pack quantities and procurement prices are unchanged. Reproduce with `npm run compare:polowat-breakers`; rejected candidates and audit counts are retained in `data/generated/polowat-breaker-comparison.json`.
