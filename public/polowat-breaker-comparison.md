# Polowat non-polarized breaker routing

Same enclosure and device positions; minimize the existing layout score: area m² + 0.01 × total rounded cable m + 0.02 × upstream battery-positive lead m. This is a routing score, not a dollar price. Reject every geometry or routing failure.

Only the three declared non-polarized 30 A breakers can exchange top/bottom connections. Physical terminal IDs, pole identities, device positions and polarized PV/load breakers stay fixed. All eight combinations are tested.

| Reversed connections | Valid | Rounded cable (m) | Battery source leads (m) | Turns | Score |
| --- | --- | --- | --- | --- | --- |
| None (baseline) | Yes | 30.524 | 2.523 | 198 | 0.66771 |
| Battery A | Yes | 30.187 | 2.375 | 197 | 0.66136 |
| Battery B | Yes | 30.526 | 2.231 | 197 | 0.66188 |
| Battery A, Battery B | Yes | 30.052 | 2.043 | 197 | 0.65339 |
| Controller | Yes | 30.954 | 2.523 | 200 | 0.672 |
| Battery A, Controller | Yes | 30.24 | 2.334 | 200 | 0.66107 |
| Battery B, Controller | Yes | 30.912 | 2.231 | 200 | 0.66574 |
| Battery A, Battery B, Controller | Yes | 30.107 | 2.043 | 196 | 0.65394 |

Lowest valid score: **Battery A, Battery B**, 0.65339, versus 0.66771 before. Total modeled cable changes by -0.472 m; upstream battery-positive leads change by -0.480 m.

These are modeled route lengths. Pack quantities and procurement prices are unchanged. Reproduce with `npm run compare:polowat-breakers`; rejected candidates and audit counts are retained in `data/generated/polowat-breaker-comparison.json`.
