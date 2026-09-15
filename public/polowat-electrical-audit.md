# Inowon / Polowat electrical survey — P9, 15 September 2026

The selection retains shared 10 AWG PV/controller cable, 8 AWG battery branches and 12 AWG LOAD wiring. P9 uses one $35.99 DK10N kit for all four isolated BATT+/BATT−/LOAD+/LOAD− groups: eight blocks, four bridges and two unbridged spare blocks. All ten blocks stay contiguous on one rail so the supplied single end cover and two stops suffice. One bare stranded conductor per clamp, 12–14 mm strip and 1.3 Nm. Six bus-end eyelets are eliminated; only four battery-post lugs remain. Both Blue Sea buses, DK4N kit and unneeded 22–10 AWG eyelet assortment are removed from the cart. See the [assembly review](polowat-assembly-review.md).

## Why 300 W does not require AWG 7 here

300 W / 12 V is 25 A, not 30 A. At 11.8 V it is 25.4 A. A hypothetical 300 W load through an 85%-efficient inverter would draw 29.9 A at 11.8 V, but this system has no inverter or 300 W load. PV is a source, operating at about 62 V, and the selected charger caps battery charging at 20 A. Its 12 V nominal PV recommendation is 290 W; excess array power is clipped. The physical LOAD output is also rated 20 A continuous at 12 V. Charge current and discharge current flow in opposite directions on the battery pair and are not added to make 40 A. [Victron ratings](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/technical-specifications.html).

4 mm² is indeed close to AWG 11: AWG 12 = 3.31 mm², AWG 11 = 4.17, AWG 10 = 5.26, AWG 8 = 8.37 and AWG 7 = 10.55. Gauge alone is not an ampacity rating. Insulation, temperature, bundling, termination limits, protection and round-trip voltage drop all matter. Thus 4 mm² is not intrinsically unsafe at 20 A, but the old “4 mm² everywhere” specification omitted necessary installation limits. At the owner's longer battery-route boundary, 8 AWG improves voltage drop; the short controller pair stays 10 AWG to fit its 6 mm² / 10 AWG maximum. Require verified **≥30 A derated ampacity** for both sizes under their 30 A protection; do not infer it from an Amazon gauge label. Use flexible, fine-stranded copper with at least 90°C insulation and approved terminations. [Victron wiring](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/safety-precautions.html), [Blue Sea sizing method](https://www.bluesea.com/resources/1437/DC_Electrical_System_Design_Recommendations).

## Circuit-by-circuit current envelope

Positive and return conductors have the same current requirement. The following covers all 25 existing topology connections; factory paired leads remain grouped as in the planning graph.

| Circuit | Current basis | Revised wiring and protection |
|---|---|---|
| Three panels, two series links | 4.84 A Imp, 5.16 A Isc; sizing basis 1.5625 × Isc = 8.06 A | Factory panel leads; verify labels. Series connection adds voltage, not current. |
| Array home-run pair and PV breaker→controller pair | Same string current | 10 AWG UV/PV copper, 5.26 mm² design area, ≤8 m complete one-way route; 10 A common-trip two-pole disconnect, correct DC polarity/voltage. |
| Battery A→breaker→buses, including negative | Up to 20 A charge or discharge with B isolated | 8 AWG, ≤2 m one way including breaker segments; 30 A non-polarized breaker adjacent to battery positive; bus-end fault hold below. |
| Battery B→breaker→buses, including negative | Up to 20 A with A isolated | Same size and matching corresponding cable resistance as A. Do not size on an assumed 10 A equal share. |
| Buses↔controller BATT pair | Up to 20 A normal in either direction | 10 AWG, ≤0.5 m one way; 30 A non-polarized breaker at the positive-bus end. |
| Controller LOAD±→separate +/− splits | 20 A nameplate; approximately 14 A design demand | 12 AWG, ≤0.25 m one way, ≥25 A derated ampacity ahead of branch breakers; controller electronic LOAD protection. |
| Split→10 A breaker→XTAR and return | 72 / 0.85 / 11.5 = 7.37 A at full converter rating; 60 W Mini case = 6.14 A | 12 AWG, ≤0.75 m one way; verify factory input lead/ring size or approved enclosed transition. |
| Split→10 A breaker→Coolgear and return | 78 / 11.5 = 6.78 A maximum stated input basis | 12 AWG, ≤0.75 m one way; Phoenix terminal capacity unconfirmed. Approved short factory/14 AWG pigtail only if accepted for this circuit. |
| XTAR regulated 24 V→Mini | Mini 60 W / 24 V = 2.5 A; converter 72 W / 24 V = 3 A | Retain factory/OEM cable and weatherproof mating connector. Wire gauge not documented here; measure loaded end voltage with full cable. |
| USB-C→laptop | 60 W maximum; 20 V / 60 W profile is 3 A | QIANRENON capped round 0.3 m female panel extension, advertised PD 20 V/3 A; 60 W source remains. Verify PD negotiation in both orientations with user-supplied device lead. |
| USB-A→phone | 18 W maximum, negotiated voltage/current | Owner-approved capped 0.3 m BATIGE A-female extension is staged; current, charging protocol and sealing remain bench checks. No loose A-to-C charging cable is procured. Retain the conservative source envelope. |

Coolgear publishes a 9–28 V input range and 78 W maximum input draw; use that value rather than its “75 W” product name. XTAR publishes 9–20 V input and 24 V / 72 W output, but no minimum efficiency. The **85% efficiency and ≥11.5 V at converter terminals are provisional test requirements**, not manufacturer guarantees. Mini is rated for 12–48 V, 60 W maximum and typically 25–40 W. [Coolgear datasheet](https://www.coolgear.com/wp-content/uploads/CG-PD60PPS_Technical-Data-Sheet-06-260205.pdf), [XTAR](https://xtar-link.com/products/starlink-mini-12v-to-24v-dc-step-up-converter), [Starlink Mini](https://www.starlink.com/public-files/specification_sheet_mini.pdf).

Expected simultaneous maximum is 60 / 0.85 + 78 = **148.6 W** before cable losses. Using the converter's full 72 W output gives 162.7 W; the revised design envelope is **165 W**, about **14.0 A at 11.8 V**. Both branches are below 8 A under these assumptions. Two 10 A breakers are not an instantaneous 20 A limiter: their overload curves permit temporary excess. Preserve electronic LOAD protection and verify cold-start current and full-load thermal behavior.

Daily energy remains 520 Wh; storage remains 3.6 kWh nominal / 1.8 kWh planning usable, or 0.9 kWh usable on one battery. Full 20 A charging is 0.067 C for the pair or 0.133 C for a single 150 Ah battery; the exact battery manufacturer must permit it. The 900 Wh/day solar estimate is weather dependent and assumes field/clipping losses within its 75% yield factor.

## Length and voltage-drop survey

The owner supplied upper bounds: **battery→bus under 2 m one way**, and **controller→Starlink/USB converters under 1 m total one way**, all inside the junction box. Calculate each battery branch at 2 m; retain **0.5 m bus→controller as an assumption**, not an owner measurement. Allocate the converter route as 0.25 m shared plus 0.75 m after the split. Positive lengths include breaker segments, and the return conductor is included. Match corresponding cable resistance between the two batteries.

Shared iGreely B09BYGJGTB stock is 30 ft / 9.144 m EACH red and black. Per colour budget 8 m complete PV route, 0.5 m bus/controller path and 0.644 m trimming/slack. Treat as 10 AWG / 5.26 mm²: the 6 mm² title conflicts with the stated strand construction (~5.36 mm²). Measure before cutting; add wire if routes exceed the budget. Separate Ancor 10 AWG rolls and the local PV allowance are removed. Four Ancor rolls remain: 8 AWG red/black 25 ft each and 12 AWG red/black 12 ft each.

Calculations use copper resistivity 0.0175 Ω·mm²/m at 20°C, coefficient 0.00393/°C, 75°C conductor temperature, and both conductors: ΔV = 2 L I ρ [1 + α(T−20)] / area. Sum battery and controller segments separately because their areas differ. These are wire-only estimates; breaker/contact resistance is additional.

| Battery-to-controller case | Calculated drop at 11.8 V | Consequence |
|---|---:|---|
| Prior 4 mm² throughout, 2 m battery + 0.5 m controller, 20 A | 0.532 V / 4.51% | Exceeds the 3% target at the owner’s route boundary. |
| Prior 10 AWG throughout, same route/current | 0.405 V / 3.43% | Also exceeds the 3% target. |
| Selected 8 AWG battery + 10 AWG controller, same route/current | 0.284 V / 2.41% | Below the 3% wire-only target; contact losses still need checking. |
| Selected sizes with battery route extended to 3 m, controller still 0.5 m | 0.386 V / 3.27% | Exceeds the target; shorten or redesign. |

| Other route | Wire-only drop | Consequence |
|---|---:|---|
| 10 AWG PV (5.26 mm²), 8 m one way at 4.84 A | 0.313 V / 0.50% at 62.1 V | Includes breaker/controller tails; stock shared with BATT cuts. |
| 12 AWG shared LOAD, 0.25 m one way at 20 A | 0.064 V | Keep the shared link short. |
| 12 AWG XTAR branch, 0.75 m one way at 7.37 A | 0.071 V | Combined shared + branch drop is about 0.135 V. |
| 12 AWG USB branch, 0.75 m one way at 6.78 A | 0.065 V | Combined shared + branch drop is about 0.130 V. |

The converter paths remain inside the 0.3 V allowance from the controller LOAD terminals, before contacts. The new 12 AWG area is **3.31 mm²**, not equivalent to the previous 4 mm²; it was selected after recalculation for the confirmed short routes. At 20 A the selected battery/controller path loses about 5.68 W in copper. Charging drop also lowers voltage delivered to battery posts; verify absorption voltage there. The viewer compares route lengths interactively.

Ancor retained 8/12 AWG stock is tinned fine-stranded copper, 600 V, **105°C dry / 75°C wet**, with published jacket diameters 7.9 mm and 4.0 mm respectively. Keep it dry for Victron’s ≥90°C wire requirement. iGreely claims 90°C and 1.5 kV DC; verify its received markings and jacket diameter, rather than transferring Ancor’s 105°C ampacity table to it. Select glands and PV connector seals by measured jacket OD. [Ancor specifications](https://www.navico.com/content/dam/navico/integrated-sites/ancor/resources/products/wire-and-cable/SPEC_Ancor_Primary_Wire_Battery_Cable_TCHDAT.pdf), [iGreely cable](https://www.amazon.com/dp/B09BYGJGTB).

Require ≥30 A derated ampacity on battery/controller pairs, ≥25 A on shared LOAD, and ≥10 A after the branch breakers. As a manufacturer table example for 105°C wire outside engine spaces, a 4–6 conductor bundle gives 48 A for 8 AWG and 27 A for 12 AWG. Its 7–24 conductor case reduces 12 AWG to 22.5 A, below the shared-wire design requirement. Route that shared pair separately from larger bundles; verify actual ambient, terminal limits and applicable installation rules rather than treating these examples as unconditional ratings. [Ancor ampacity/bundling table](https://docs.navico.com/view/362211770/65/). These Ancor examples do not establish the replacement iGreely cable’s ampacity; verify ≥30 A after its own thermal/bundling/termination limits.

Use a user-defined 11.8 V LOAD disconnect, with **13.1 V provisional reconnect**, subject to the actual battery's requirements. BatteryLife is adaptive and does not itself guarantee an 11.8 V floor. This threshold also does not prove a particular state of charge. Test disconnect/reconnect behavior and confirm ≥11.5 V at both converter inputs under load. [Victron settings](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/configuration-and-settings.html).

## Protection and termination findings

The owner excludes MidNite and permits only **CHTAIXI for polarized protection and DIHOOL for non-polarized protection**. The two 30 A battery-branch positions and one 30 A MPPT battery position remain DIHOOL candidates at $13.99 each, on 8/10 AWG wire. The three candidates are unstaged while contradictory specifications are reconciled. The current graph shows the isolation functions; final two-pole wiring still needs confirmation. MidNites have been removed from the cart. [DIHOOL candidate](https://www.amazon.com/dp/B0B253VBWG).

The owner correctly identified the seller’s photographed rating: **DZ47X-63, 30 A, non-polarized, 12–500 VDC, Icu 6 kA**, with a **C curve** in the parameter image. The photo establishes the advertised voltage range. The [generic DIHOOL family page](https://www.dihool.net/detail_DZ47X-Electric-Linear-Actuator/2540_457) gives different 4 kA/B-curve information, and the [Amazon bullet](https://www.amazon.com/dp/B0B253VBWG) still restricts its short-circuit claim to ≥48 V. Resolve the supplied-revision mismatch; do not describe the candidate as lacking a 12 V voltage marking. No seller message has been sent.

The **PV disconnect is already a polarized 10 A two-pole CHTAIXI**, on the array → MPPT PV-input path. Follow its source/load polarity markings. The **MPPT BATT connection and both battery branches require bidirectional interruption**: solar charging sends current toward the batteries, while stored energy returns through the MPPT to its LOAD output. These are the three non-polarized DIHOOL positions. Normal PV flow is one-way; that does not itself establish reverse-fault protection. Battery fault current, source contributions and cable/protection coordination remain installation checks. Battery boxes are excluded.

**Parallel-source fault protection is still unresolved.** A battery branch cable can be back-fed from the other battery and the MPPT. Its battery-end breaker alone does not prove protection of every bus-side cable segment. Normal 20 A current calculations are not a fault study, and breaker ampere numbers are not instantaneous clamps. Before construction, establish actual battery prospective fault current, breaker curves/clearing energy and cable withstand, using protected short routes; otherwise add appropriately rated bus-end protection and revise the mounting/BOM. Likewise verify bus fault withstand and controller source-end breaker placement. The two 100 A Blue Sea buses have adequate normal-current headroom but do not limit battery fault current.

P9 uses one $35.99 DK10N kit for all four isolated BATT+/BATT−/LOAD+/LOAD− groups: eight blocks, four bridges and two unbridged spare blocks. All ten blocks stay contiguous on one rail so the supplied single end cover and two stops suffice. One bare stranded conductor per clamp, 12–14 mm strip and 1.3 Nm. Six bus-end eyelets are eliminated; only four battery-post lugs remain. Both Blue Sea buses, DK4N kit and unneeded 22–10 AWG eyelet assortment are removed from the cart. [DK10N specifications](https://www.dinkle.com/en/terminal/DK10N).

Four 8 AWG battery-post lugs remain, with holes matched to the received batteries and proper lug-crimp tooling. All six bus-end eyelets are removed; DK10N uses bare stranded cage terminations. Never clamp an eyelet in a wire cage or trim strands. Final DIHOOL pole/clamp instructions and converter input terminal compatibility remain open.

## PV, guards, environment and bonding

The array's provisional 73.2 V Voc at 25°C leaves margin below 100 V, but cold Voc must be calculated from the **received** panel label and coefficient. An illustrative −0.3%/°C coefficient at 0°C gives 78.7 V; that coefficient is not established for the received product revision. Amazon panel dimensions differ from the earlier US reference, so electrical values, geometry and mounting remain label checks. A single PV string may never supply enough fault current to trip a 10 A breaker: the device is also the required service disconnect, not proof of every PV fault being cleared.

Continuous custom PV conductors now eliminate the Renogy pigtails, two roof splices and separate splice housing. Only one male and one female connector are required at the array ends. Included MUYI connectors are not automatically approved mates for the received panel connectors; verify matching manufacturer/type, crimp tooling/contact and jacket-seal range. Do not cross-mate incompatible connector brands. [Stäubli guidance](https://www.staubli.com/us/en/electrical-connectors/industries/renewable-energy/cross-connection.html).

The optional WireBox-S 100/20 remains excluded; its 5 mm secured-jacket limit is not verified against the selected iGreely cable. Use suitable internal terminal guarding in the main box without obstructing cooling. Covered busbars already include guards. [WireBox guide](https://www.victronenergy.com/upload/documents/Quick-Install-Guide-MPPT-WireBox-S-100_20-EN.pdf).

**Owner reference box: ANIMACYN B0CT5LRGRF, 13.8 × 9.7 × 5.9 inches, $59.99**, the model previously used for Pasana Group / PNG. The listing describes clear-cover ventilated ABS with a mounting panel and cable grommets. Assume it in the full estimate, but **do not stage or order it**. The owner will hand-assemble received components, establish actual dimensions, and then order the junction box. The large QILIPSU fitted layout is withdrawn. The reference outline and unpacked 3D bench arrangement assert no internal-fit dimensions or drilling pattern. [Owner reference enclosure](https://www.amazon.com/dp/B0CT5LRGRF).

No separate QWORK vent is required. Preserve the controller’s specified nonflammable mounting and cooling clearances during assembly; the $11.99 aluminum sheet is cuttable stock, not a claim that its uncut dimensions fit the case. Battery breakers remain in guarded housings near battery posts. Resolve final bends, glands, USB entries, terminal guards and component layout by hand assembly. Check thermal and weather performance with the final lid closed; the approximate 25–35 W heat allowance is not a guaranteed maximum. Maintain ≤40°C controller ambient for full output. The prior large-case footprint is not a requirement to buy a larger enclosure. [Victron installation](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/installation.html).

The owner accepts **waterproof with USB caps closed, sheltered while charging**. Both round extensions are now staged: [BATIGE USB-A B0BDWSQ49P](https://www.amazon.com/dp/B0BDWSQ49P), 0.3 m, $7.90, and [QIANRENON USB-C B0DRVMXWHX](https://www.amazon.com/dp/B0DRVMXWHX), 0.3 m, **PD 60 W at 20 V/3 A**, $15.99. The USB-C socket uses an 18.5 mm cutout and permits up to 20 mm panel thickness. It replaces the rejected $26.99 flat 100 W cable, saving $11. The Coolgear USB-C ceiling remains 60 W; a higher-rated cable would only add capacity, not faster charging. Verify received sealing, PD/QC modes in both orientations, loaded voltage drop and temperature. BATIGE does not publish formal current/QC/IP ratings; the complete drilled box has no established IP rating. The user's devices supply external charging leads.

Grounding, exposed roof/metalwork bonding, earth conductor sizing, lightning/surge measures and any locally required ground-fault protection were missing from the earlier BOM and are now explicit unpriced scope. Do not ground PV+ or PV−. Do not introduce a LOAD− bypass. Frameless panels do not establish that the roof needs no bonding. Local requirements, hardware and electrode arrangements must be established rather than copying the installed Fiji scheme. [Victron installation and grounding](https://www.victronenergy.com/media/pg/Manual_SmartSolar_MPPT_75-10_up_to_100-20/en/installation.html).

## Procurement result

See the [staging and outstanding list](polowat-amazon-staging.md). 31 BOM rows: $2,033.09 equipment ($1,333.09 imports / $700 local), plus $129.98 estimated LA tax: **$2,163.07 total**. Includes the deferred box and held DIHOOL allowances. Three unpriced scopes, freight, duty and service excluded. Imported mass 22.54 kg net / 25.9 kg packed is provisional.

Authenticated cart verified: **21 listings / 24 units / $907.15 before tax**, plus **$88.45 estimated LA tax = $995.60 before delivery**. This revision saves $57.73 in staged merchandise. Nothing purchased.

## Terminal-level assembly review

The new terminal-level 3D study shows individual cages, screws, jumpers, rail stops/end cover, device envelopes, controller cooling, cable endpoints, bottom glands and capped USB ports. It is a dimensioned assembly study, not a fabrication release. The 325 × 424 mm workspace exceeds the reference enclosure’s 246.4 × 350.5 mm outside footprint. Converter bodies, final cable bends/collision clearance and compact layout need received measurements; do not claim the reference box fits or order it yet. DIHOOL pole wiring/fault coordination, battery-post size, PV connector family and full-load thermal/weather tests remain unresolved.

[Open detailed findings](polowat-assembly-review.md).
