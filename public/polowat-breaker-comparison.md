# Polowat non-polarized breaker routing

Same enclosure and device positions; minimize the existing layout score: area m² + 0.01 × total rounded cable m + 0.02 × upstream battery-positive lead m. This is a routing score, not a dollar price. Reject every geometry or routing failure.

Only the three declared non-polarized 30 A breakers can exchange top/bottom connections. Physical terminal IDs, pole identities, device positions and polarized PV/load breakers stay fixed. All eight combinations are tested.

| Reversed connections | Valid | Rounded cable (m) | Battery source leads (m) | Turns | Score |
| --- | --- | --- | --- | --- | --- |
| None (baseline) | Yes | 27.73 | 2.514 | 180 | 0.63958 |
| Battery A | Yes | 26.958 | 2.182 | 177 | 0.62522 |
| Battery B | Yes | 27.634 | 2.253 | 179 | 0.63339 |
| Battery A, Battery B | Yes | 27.112 | 1.88 | 171 | 0.62072 |
| Controller | Yes | 27.477 | 2.514 | 185 | 0.63705 |
| Battery A, Controller | Yes | 26.963 | 2.182 | 176 | 0.62527 |
| Battery B, Controller | Yes | 27.447 | 2.253 | 181 | 0.63153 |
| Battery A, Battery B, Controller | Yes | 27.059 | 1.88 | 175 | 0.6202 |

Lowest valid score: **Battery A, Battery B, Controller**, 0.6202, versus 0.63958 before. Total modeled cable changes by -0.671 m; upstream battery-positive leads change by -0.634 m.

These are modeled route lengths. Pack quantities and procurement prices are unchanged. Reproduce with `npm run compare:polowat-breakers`; rejected candidates and audit counts are retained in `data/generated/polowat-breaker-comparison.json`.
