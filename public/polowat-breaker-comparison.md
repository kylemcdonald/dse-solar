# Polowat non-polarized breaker routing

Same enclosure and device positions; minimize the existing layout score: area m² + 0.01 × total rounded cable m + 0.02 × upstream battery-positive lead m. This is a routing score, not a dollar price. Reject every geometry or routing failure.

Only the three declared non-polarized 30 A breakers can exchange top/bottom connections. Physical terminal IDs, pole identities, device positions and polarized PV/load breakers stay fixed. All eight combinations are tested.

| Reversed connections | Valid | Rounded cable (m) | Battery source leads (m) | Turns | Score |
| --- | --- | --- | --- | --- | --- |
| None (baseline) | Yes | 27.898 | 2.56 | 186 | 0.64219 |
| Battery A | Yes | 27.15 | 2.142 | 179 | 0.62633 |
| Battery B | Yes | 27.965 | 2.259 | 182 | 0.63682 |
| Battery A, Battery B | Yes | 27.137 | 1.84 | 175 | 0.62018 |
| Controller | Yes | 27.745 | 2.56 | 186 | 0.64065 |
| Battery A, Controller | Yes | 27.158 | 2.142 | 178 | 0.62642 |
| Battery B, Controller | Yes | 27.957 | 2.259 | 187 | 0.63674 |
| Battery A, Battery B, Controller | Yes | 27.088 | 1.84 | 179 | 0.61969 |

Lowest valid score: **Battery A, Battery B, Controller**, 0.61969, versus 0.64219 before. Total modeled cable changes by -0.810 m; upstream battery-positive leads change by -0.720 m.

These are modeled route lengths. Pack quantities and procurement prices are unchanged. Reproduce with `npm run compare:polowat-breakers`; rejected candidates and audit counts are retained in `data/generated/polowat-breaker-comparison.json`.
