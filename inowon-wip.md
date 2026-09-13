# Inowon Polowat solar deployment — work in progress

Last updated: 7 September 2026

This document records the current planning state for the small Inowon Sailing School deployment in Polowat, Chuuk State, FSM. It is a deferred decision log, not a construction approval or final procurement release.

## Objective

Provide the smallest practical direct-DC system for:

- a Starlink Mini for approximately eight hours per day;
- ordinary USB phone charging; and
- one USB-C laptop charge per day.

The design deliberately omits an inverter, separate router, shunt/display, PV combiner, AC distribution, cigarette-lighter sockets, and other unmodeled loads. The Starlink Mini's integrated Wi-Fi is used.

## Current planning design

- Three Renogy RNG-100DB-H-US 100 W flexible panels in one series string.
  - Array rating: 300 W.
  - String operating voltage: 62.1 Vmp.
  - String open-circuit voltage at 25 °C: 73.2 V Voc.
  - String operating current: 4.84 A Imp.
  - String short-circuit current: 5.16 A Isc.
- One 10 A common-trip, two-pole PV disconnect rated for at least 100 VDC, with a documented interrupt rating.
- One Victron SmartSolar MPPT 100/20 charge controller.
  - The 300 W array is 10 W above the controller's 290 W nominal PV rating at 12 V; the controller limits input power, so only a small ideal-condition peak may clip.
  - The controller's physical 20 A LOAD output and BatteryLife function provide low-voltage load control.
- Two matched 12 V, 150 Ah deep-cycle lead-acid batteries connected in parallel.
  - Bank rating: 12 V, 300 Ah, or 3.6 kWh nominal.
  - Planning usable energy: 1.8 kWh at a provisional 50% depth of discharge.
  - One-battery usable energy: 0.9 kWh at the same planning limit.
  - Each battery positive has its own shortest-practical 25 A DC breaker.
  - Positive battery leads are equal in length to one another, and negative battery leads are equal in length to one another.
- One 25 A breaker on the SmartSolar battery connection, following the controller's 25–30 A protection guidance.
- One covered positive bus and one covered negative bus, rated at least 60 A.
- The controller LOAD output feeds two separately protected branches:
  - one 10 A branch supplying a regulated 12-to-24 V, 72 W converter and the Starlink Mini; and
  - one 10 A branch supplying a Coolgear CG-PD60PPS module with up to 60 W USB-C PD plus 18 W USB-A output.
- A provisional ventilated, corrosion-resistant 600 × 500 × 180 mm equipment enclosure contains the controller, busbars, and breakers. It must remain sheltered from salt spray and outside the battery-gas path.
- All field power conductors use 4 mm² copper to minimize the number of locally stocked sizes:
  - UV-resistant PV cable outdoors; and
  - flexible DC cable indoors.

## Battery redundancy qualification

The two batteries are parallel sources with independent positive breakers. Either battery can be manually isolated and the remaining battery can carry the complete modeled load and the controller's 20 A LOAD-output limit.

This arrangement supports continued operation after an open-circuit failure or after a defective branch has been safely isolated. It is not a promise that every internal battery failure will automatically or harmlessly self-isolate. A hard internal short can draw fault current from the healthy parallel battery; the branch breaker must have adequate DC interrupt capacity for the selected batteries and installation. An internal self-heating fault inside the defective battery cannot itself be stopped by an external breaker.

If uninterrupted automatic fault isolation is required, the architecture needs additional fault-detection/isolation equipment and a new cost and reliability review. The current design assumes trained manual isolation is acceptable.

## Load and production model

| Load | Planning basis | Daily energy | Peak |
| --- | ---: | ---: | ---: |
| Starlink Mini | 40 W × 8 h | 320 Wh | 60 W |
| Laptop | one 70 Wh charge | 70 Wh | 60 W |
| Phones | two 15 Wh charges | 30 Wh | 15 W |
| Conversion, controller, cable loss, and reserve | allowance | 100 Wh | 15 W |
| **Total** |  | **520 Wh/day** | **150 W simultaneous design case** |

At the 11.8 V planning load-disconnect floor, 150 W is approximately 12.7 A, below the SmartSolar's 20 A LOAD-output rating.

The provisional solar model uses four peak-sun-hours and a 75% field-yield factor:

- Three panels: 300 W × 4.0 h × 75% = 900 Wh/day, leaving about 380 Wh/day above the modeled load.
- Two panels: 200 W × 4.0 h × 75% = 600 Wh/day, leaving only about 80 Wh/day above the modeled load.

Three panels are therefore the current recommendation. Two panels reduce purchase cost and imported mass but provide very little allowance for cloud, shade, soiling, battery recharge after a poor day, or greater-than-modeled use.

## Sourcing plan

Purchase in Chuuk:

- two matched 12 V, 150 Ah deep-cycle batteries;
- 20 conductor-metres of 4 mm² PV cable, provisionally 10 m red and 10 m black; and
- 12 conductor-metres of flexible 4 mm² DC cable, red and black as required.

Import everything else, including the panels, controller, Starlink equipment if not already owned, converter, USB module, breakers, busbars, enclosure, battery boxes, mounting hardware, terminations, and charging leads.

Final cable quantities must be replaced with measured routes before cutting or ordering. Battery terminal and lug sizes cannot be finalized until the exact local battery model is known.

## Preliminary cost estimate

| Procurement scope | Estimate |
| --- | ---: |
| Imported hardware | $1,326.87 |
| Batteries and cable purchased in Chuuk | $770.00 |
| **Itemized hardware total** | **$2,096.87** |
| Working planning ceiling | $2,350.00 |

The estimate excludes international and inter-island freight, duty, tax, installation labor, and recurring Starlink service. The Starlink line currently includes a $260 Micronesia hardware allowance; remove it if Inowon already owns a compatible kit. At the 3 September 2026 research date, Starlink's Micronesia page advertised service starting at $50/month.

The Renogy panel line uses $149.99 per panel from the official store as checked on 3 September 2026. The named panel was backordered at that time, so availability or approval of a dimensionally and electrically compatible substitute remains a procurement hold.

## Preliminary weight estimate

| Scope | Estimate |
| --- | ---: |
| Imported equipment, net | 21.48 kg |
| Imported equipment with 15% packing allowance | 24.7 kg |
| Locally purchased batteries and cable | 85.7 kg |
| **Installed equipment total** | **107.18 kg** |

The two assumed 42 kg batteries dominate the installed weight. Imported item weights mix manufacturer data and planning estimates; every packed carton must be weighed before freight is booked.

## Installation and commissioning holds

- Record the battery manufacturer, model, chemistry, capacity, charge settings, terminal style, date codes, purchase price, and actual weight.
- Buy two identical batteries and bring them to the same rested state of charge before first paralleling them.
- Configure the exact battery manufacturer's charge profile. Flooded, AGM, and GEL batteries have different charging and ventilation requirements. Never enable equalization unless the selected battery datasheet explicitly requires it.
- Verify every breaker's actual DC voltage rating, polarity requirements, trip curve, interrupt capacity, terminal preparation, and installation acceptance.
- Verify 4 mm² conductor markings and hot/bundled ampacity before energizing. Keep battery and controller runs shortest-practical.
- Confirm roof material, unshaded dimensions, wind exposure, attachment method, panel edge restraint, and the measured one-way roof-to-controller route. Adhesive alone is not assumed adequate for severe wind.
- Verify the full-scale enclosure layout, ventilation clearance, cable bend space, terminal guarding, screened vents, glands, and corrosion protection.
- Configure the SmartSolar LOAD output for BatteryLife or an installer-approved low-voltage threshold.
- Bench-test the Starlink converter with the complete OEM cable at the 11.8 V planning floor. Measure startup current, average consumption, voltage drop, and converter temperature.
- Test battery A alone, battery B alone, and both together while running Starlink and a 60 W laptop charge.
- Give Starlink priority during poor-energy periods and stop laptop charging first after low-voltage events.
- Do not connect an inverter, power tools, pumps, refrigeration, or other unmodeled loads without redesigning the system.

## Deferred major questions

1. What exact battery brand, model, chemistry, terminal type, price, and weight are available in Chuuk? Can a genuinely matched pair be obtained?
2. Is manual isolation and restart after a battery fault acceptable, or is automatic fault isolation required?
3. What are the Polowat roof material, usable unshaded dimensions, wind exposure, and one-way array-to-controller distance?
4. Does Inowon already own a Starlink Mini? Which Micronesia service plan will be used, and how many hours per day must it actually operate?
5. Which laptop and phones will be charged? Is a maximum 60 W USB-C laptop output sufficient, and must more than one laptop be charged per day?
6. Is the three-panel recommendation approved, or should the project accept the small energy margin of a cheaper two-panel system?
7. If the named Renogy panel remains unavailable, may an electrically and dimensionally compatible flexible-panel substitute be selected?
8. Who will perform and approve the final electrical, battery-ventilation, roof-attachment, and commissioning checks in Chuuk/Polowat?

## Reference links

- Renogy 100 W flexible panel: <https://www.renogy.com/collections/flexible-solar-panel/products/100-watt-12-volt-flexible-monocrystalline-solar-panel>
- Victron SmartSolar 75/10 through 100/20 manual: <https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/index-en.html>
- Starlink Mini specification sheet: <https://www.starlink.com/public-files/specification_sheet_mini.pdf>
- Starlink Micronesia Roam page: <https://starlink.com/fm/roam>
- Coolgear CG-PD60PPS data sheet: <https://www.coolgear.com/wp-content/uploads/CG-PD60PPS_Technical-Data-Sheet-06-260205.pdf>

## Viewer implementation

The interactive site has a separate **Inowon · Polowat** selector at the upper right. Its wiring diagram and 3D view share the same compact topology source. The system, BOM, shipping, cost, operating-rule, and commissioning views all read from the Polowat planning data rather than modifying the DSE/Fiji system.
