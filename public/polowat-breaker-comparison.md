# Polowat non-polarized breaker routing

Same enclosure and device positions; minimize the existing layout score: area m² + 0.01 × total rounded cable m + 0.02 × upstream battery-positive lead m. This is a routing score, not a dollar price. Reject every geometry or routing failure.

Only the three declared non-polarized 30 A breakers can exchange top/bottom connections. Physical terminal IDs, pole identities, device positions and polarized PV/load breakers stay fixed. All eight combinations are tested.

| Reversed connections | Valid | Rounded cable (m) | Battery source leads (m) | Turns | Score |
| --- | --- | --- | --- | --- | --- |
| None (baseline) | Yes | 31.406 | 2.254 | 245 | 0.67113 |
| Battery A | Yes | 30.881 | 2.018 | 243 | 0.66117 |
| Battery B | Yes | 31.468 | 1.913 | 239 | 0.66495 |
| Battery A, Battery B | Rejected | 30.999 | 1.642 | 243 | — |
| Controller | Yes | 31.14 | 2.254 | 244 | 0.66847 |
| Battery A, Controller | Yes | 30.812 | 2.018 | 242 | 0.66048 |
| Battery B, Controller | Yes | 31.354 | 1.913 | 239 | 0.6638 |
| Battery A, Battery B, Controller | Rejected | 29.057 | 1.642 | 215 | — |

Lowest valid score: **Battery A, Controller**, 0.66048, versus 0.67113 before. Total modeled cable changes by -0.594 m; upstream battery-positive leads change by -0.236 m.

These are modeled route lengths. Pack quantities and procurement prices are unchanged. Reproduce with `npm run compare:polowat-breakers`; rejected candidates and audit counts are retained in `data/generated/polowat-breaker-comparison.json`.
