"use client";

import dseRaw from "@/data/dse-system.json";
import runtimeRaw from "@/data/generated/dse-runtime.json";
import { PrintButton } from "./cable-plan/PrintButton";
import styles from "./cable-plan/page.module.css";

type CableAssembly = {
  route: string;
  pairedRunId?: string;
  gauge: "1/0 AWG · 53.5 mm²" | "2 AWG · 33.6 mm²" | "8 AWG · 8.37 mm²";
  qty: number;
  routedLengthM: number;
  planningLengthM: number;
  color: "red" | "black";
  from: string;
  to: string;
  lugs: string;
  purpose: string;
};

type BatteryCablePlan = {
  measurementRule: string;
  assemblies: CableAssembly[];
};

type EndPlan = {
  label: string;
  kind: "ring" | "verify" | "hold";
};

type RuntimeRoute = {
  id: string;
  cableId: string;
  lengthM: number;
  returnFor?: string | null;
};

type FieldWireRow = {
  id: string;
  size: string;
  construction: string;
  cableIds: string[];
  planningLengthM?: number;
  use: string;
  orderNote: string;
};

const plan = dseRaw.batteryCablePlan as BatteryCablePlan;
const runtimeRoutes = runtimeRaw.routes as RuntimeRoute[];

function routesFor(cableIds: string[]) {
  return runtimeRoutes.filter((route) => cableIds.includes(route.cableId));
}

function roundedProcurementLength(routedLengthM: number) {
  return Math.ceil(routedLengthM * 1.15 * 2) / 2;
}

function matchedPairRoutedTotal(routes: RuntimeRoute[]) {
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const matchedLengths = new Map(routes.map((route) => [route.id, route.lengthM]));
  for (const route of routes) {
    if (!route.returnFor) continue;
    const positive = routeById.get(route.returnFor);
    if (!positive) continue;
    const matchedLengthM = Math.max(route.lengthM, positive.lengthM);
    matchedLengths.set(route.id, matchedLengthM);
    matchedLengths.set(positive.id, matchedLengthM);
  }
  return [...matchedLengths.values()].reduce((total, lengthM) => total + lengthM, 0);
}

function assemblyPlanningLength(gauge: CableAssembly["gauge"]) {
  return plan.assemblies
    .filter((assembly) => assembly.gauge === gauge)
    .reduce((total, assembly) => total + assembly.planningLengthM * assembly.qty, 0);
}

const fieldWireRows: FieldWireRow[] = [
  {
    id: "battery53",
    size: "1/0 AWG · 53.5 mm²",
    construction: "Red / black flexible single-core",
    cableIds: ["battery53"],
    planningLengthM: assemblyPlanningLength("1/0 AWG · 53.5 mm²"),
    use: "Aggregate SmartShunt trunk and direct MultiPlus pair",
    orderNote: "Use the three agreed terminated assemblies listed below.",
  },
  {
    id: "dc2",
    size: "2 AWG · 33.6 mm²",
    construction: "Red / black flexible single-core",
    cableIds: ["dc2", "dc2Battery"],
    planningLengthM: assemblyPlanningLength("2 AWG · 33.6 mm²"),
    use: "Battery strings, all 120 A disconnect landings and the SmartSolar battery branch",
    orderNote: "Use the eleven agreed terminated assemblies listed below.",
  },
  {
    id: "dc8Feeder",
    size: "8 AWG · 8.37 mm²",
    construction: "Red / black flexible single-core",
    cableIds: ["dc8Feeder"],
    planningLengthM: assemblyPlanningLength("8 AWG · 8.37 mm²"),
    use: "Main buses to the secondary-services buses",
    orderNote: "Use the two agreed M10-to-#10 terminated assemblies listed below.",
  },
  {
    id: "dc16",
    size: "16 mm²",
    construction: "Green/yellow or identified bonding conductor",
    cableIds: ["dc16"],
    use: "Main chassis and earth-electrode bonding",
    orderNote: "Do not substitute an ordinary current-carrying color for protective bonding conductors.",
  },
  {
    id: "dc6",
    size: "6 mm²",
    construction: "Red / black flexible single-core",
    cableIds: ["dc6"],
    use: "Both 32 A USB supply branches",
    orderNote: "Terminal-fit checks remain at the ChargeIT Phoenix plugs.",
  },
  {
    id: "pv4",
    size: "4 mm²",
    construction: "Red / black PV-rated single-core outdoors",
    cableIds: ["pv4"],
    planningLengthM: 35,
    use: "AIKO 3S string, one 15 m home-run pair, PV cutoff and small 10 A service feed",
    orderNote: "The fixed plan allows 35 m total: 30 m for the home-run pair plus 5 m for indoor and service wiring.",
  },
  {
    id: "earth4",
    size: "4 mm²",
    construction: "Green/yellow protective-earth single-core",
    cableIds: ["earth4"],
    use: "AIKO frame bonds and main PE distribution",
    orderNote: "Keep the protective-earth color and installation rating distinct from PV cable.",
  },
  {
    id: "branch1.5",
    size: "1.5 mm²",
    construction: "Color-coded flexible single-core",
    cableIds: ["branch1.5"],
    use: "Balancer, switches, lighting tails and low-current services",
    orderNote: "Preserve polarity, function colors and the near-battery protection checks.",
  },
  {
    id: "ac3",
    size: "3 × 1.5 mm²",
    construction: "Jacketed three-core 230 V cable",
    cableIds: ["ac3"],
    use: "Generator input, MultiPlus AC-in/out and tool outlet",
    orderNote: "Exposed core tails are part of these assemblies, not extra bulk cable.",
  },
  {
    id: "light2",
    size: "2 × 1.5 mm²",
    construction: "Jacketed two-core DC lighting cable",
    cableIds: ["light2"],
    use: "Shared two-core string for both indoor lights",
    orderNote: "Historical cable quantity; installed lighting-string length has not been measured.",
  },
].map((row) => {
  const routedLengthM = matchedPairRoutedTotal(routesFor(row.cableIds));
  return {
    ...row,
    planningLengthM: row.planningLengthM ?? roundedProcurementLength(routedLengthM),
  };
});

function endPlans(assembly: CableAssembly): [EndPlan, EndPlan] {
  const lugs = assembly.lugs;
  if (lugs.startsWith("M8–M8")) return [
    { label: "M8 closed ring", kind: "ring" },
    { label: "M8 closed ring", kind: "ring" },
  ];
  if (lugs.startsWith("M8–M10")) return [
    { label: "M8 closed ring", kind: "ring" },
    { label: "M10 closed ring", kind: "ring" },
  ];
  if (lugs.startsWith("M10–M10")) return [
    { label: "M10 closed ring", kind: "ring" },
    { label: "M10 closed ring", kind: "ring" },
  ];
  if (lugs.startsWith("M10–M8")) return [
    { label: "M10 closed ring", kind: "ring" },
    { label: "M8 closed ring", kind: "ring" },
  ];
  if (lugs.startsWith("M10–#10")) return [
    { label: "M10 closed ring", kind: "ring" },
    { label: "#10 closed ring", kind: "ring" },
  ];
  if (lugs.startsWith("M8 ring at battery")) return [
    { label: "M8 closed ring", kind: "ring" },
    { label: "2 AWG disconnect end", kind: "verify" },
  ];
  if (lugs.startsWith("prepared 2 AWG controller-terminal end–prepared 2 AWG disconnect-clamp end")) return [
    { label: "2 AWG controller end", kind: "verify" },
    { label: "2 AWG disconnect end", kind: "verify" },
  ];
  if (lugs.startsWith("prepared 2 AWG controller-terminal end–M10")) return [
    { label: "2 AWG controller end", kind: "verify" },
    { label: "M10 closed ring", kind: "ring" },
  ];
  if (lugs.startsWith("prepared 2 AWG")) return [
    { label: "2 AWG disconnect end", kind: "verify" },
    { label: "M10 closed ring", kind: "ring" },
  ];
  return [
    { label: "Verify end A", kind: "verify" },
    { label: "Verify end B", kind: "verify" },
  ];
}

const assemblies = plan.assemblies.map((assembly) => ({ ...assembly, ends: endPlans(assembly) }));
const ringCounts = assemblies.flatMap((assembly) => assembly.ends)
  .filter((end) => end.kind === "ring")
  .reduce((counts, end) => {
    if (end.label.startsWith("M8")) counts.M8 += 1;
    else if (end.label.startsWith("M10")) counts.M10 += 1;
    else if (end.label.startsWith("#10")) counts.number10 += 1;
    return counts;
  }, { M8: 0, M10: 0, number10: 0 });
const preparedTwoAwgEndCount = assemblies.flatMap((assembly) => assembly.ends)
  .filter((end) => end.kind === "verify" && end.label.startsWith("2 AWG"))
  .length;

function formatMetres(value: number) {
  return `${value.toFixed(2)} m`;
}

function formatMillimetres(value: number) {
  return `${Math.round(value * 1000)} mm`;
}

export function CablePlanView() {
  return (
    <section className={styles.page} aria-labelledby="wire-cut-list-title">
      <div className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Fulaga · R32 · metric installation schedule</p>
            <h1 id="wire-cut-list-title">Wire cut list</h1>
            <p className={styles.intro}>
              Consolidated cable quantities for the three-panel AIKO array and 440 Ah Victron GEL bank, followed by
              agreed heavy-DC assembly lengths and end terminations. “Eyelet” means a closed heavy-duty ring lug
              sized to the actual terminal stud. These are historical pre-installation planned lengths. The installed corner arrangement has changed; neither these lengths nor the illustrative 3D routes are field measurements.
            </p>
          </div>
          <div className={styles.actions}><PrintButton className={styles.printButton} /></div>
        </section>

        <section className={styles.measurementWarning}>
          <div className={styles.warningIcon} aria-hidden="true">!</div>
          <div>
            <strong>Historical schedule — not installed cable measurements.</strong>
            <p>{plan.measurementRule}</p>
          </div>
        </section>

        <section className={styles.schedule} aria-labelledby="field-wire-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Procurement schedule</p>
              <h2 id="field-wire-heading">Field wire by size and construction</h2>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.fieldTable}`}>
              <thead><tr>
                <th scope="col">Conductor size</th>
                <th scope="col">Construction / color</th>
                <th scope="col">Planning quantity</th>
                <th scope="col">Use and field note</th>
              </tr></thead>
              <tbody>{fieldWireRows.map((row) => (
                <tr key={row.id}>
                  <td><span className={styles.gaugeBadge}>{row.size}</span></td>
                  <td><strong>{row.construction}</strong></td>
                  <td className={styles.orderLength}><strong>{formatMetres(row.planningLengthM ?? 0)}</strong></td>
                  <td><strong>{row.use}</strong><small className={styles.rowNote}>{row.orderNote}</small></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className={styles.modelCaveat}>Bulk quantities replace both members of every declared positive/negative pair with the longer routed member before adding routing allowance. Factory Starlink, USB, data and socket harnesses remain specified assemblies and are not included as bulk field wire.</p>
        </section>

        <div className={styles.subsectionTitle}>
          <p className={styles.eyebrow}>Fabricator detail</p>
          <h2>Heavy-DC assembly cuts and eyelets</h2>
          <p>Every declared red/black pair below already uses the longer member’s agreed length for both finished cables.</p>
        </div>

        <section className={styles.schedule} aria-labelledby="cut-schedule-heading">
          <div className={styles.sectionHeading}><div>
            <p className={styles.eyebrow}>On-site worksheet</p>
            <h2 id="cut-schedule-heading">Cut and termination schedule</h2>
          </div></div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr>
                <th scope="col">Cable / connection</th>
                <th scope="col">Agreed length</th>
                <th scope="col">End A</th>
                <th scope="col">End B</th>
              </tr></thead>
              <tbody>{assemblies.map((assembly, index) => (
                <tr key={assembly.route} data-cable-route={assembly.route} data-paired-run={assembly.pairedRunId}>
                  <td>
                    <div className={styles.connectionTitle}>
                      <span className={`${styles.cableSwatch} ${styles[assembly.color]}`} aria-label={`${assembly.color} cable`} />
                      <div>
                        <span className={styles.cableNumber}>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{assembly.from} <b aria-hidden="true">→</b> {assembly.to}</strong>
                        <span className={styles.gaugeBadge}>{assembly.gauge}</span>
                      </div>
                    </div>
                    <small>{assembly.purpose}</small>
                  </td>
                  <td className={styles.orderLength}><strong>{formatMillimetres(assembly.planningLengthM)}</strong></td>
                  {assembly.ends.map((end, endIndex) => (
                    <td key={`${assembly.route}-${endIndex}`}><span className={`${styles.endBadge} ${styles[`end-${end.kind}`]}`}>{end.label}</span></td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        <section className={styles.procurementGrid}>
          <article className={styles.procurementCard}>
            <p className={styles.eyebrow}>Confirmed termination count</p>
            <h2>Ring-lug requirements</h2>
            <div className={styles.lugTotals}>
              <span><strong>{ringCounts.M8}</strong><small>M8 closed rings</small></span>
              <span><strong>{ringCounts.M10}</strong><small>M10 closed rings</small></span>
              <span><strong>{ringCounts.number10}</strong><small>#10 closed rings</small></span>
              <span><strong>{preparedTwoAwgEndCount}</strong><small>Prepared 2 AWG ends</small></span>
            </div>
            <p className={styles.cardNote}>Verify actual stud and ring-hole dimensions; never drill a lug or trim conductor strands to force a fit.</p>
          </article>
          <article className={styles.procurementCard}>
            <p className={styles.eyebrow}>Fabricator specification</p>
            <h2>Assembly checks</h2>
            <ul className={styles.specList}>
              <li>Use the exact 8 AWG, 2 AWG or 1/0 AWG flexible-copper size shown for each assembly; no CCA or aluminum.</li>
              <li>Use closed tinned-copper lugs with the exact #10, M8 or M10 hole specified.</li>
              <li>Use adhesive-lined red or black heat shrink and a durable circuit label at both ends.</li>
              <li>State every finished dimension as lug-hole center to lug-hole center.</li>
              <li>Provide the crimp die/tool record and a completed pull-test or inspection record.</li>
            </ul>
          </article>
        </section>

        <section className={styles.holdSection}>
          <div><p className={styles.eyebrow}>Termination and approval notes</p><h2>Feeder protection remains held</h2></div>
          <div className={styles.holdColumns}>
            <article><span>Battery and SmartSolar ends</span><p>All prepared controller and disconnect ends are exact 2 AWG. Confirm the received screw-terminal preparation and torque before fabrication; do not substitute a ring lug.</p></article>
            <article><span>Secondary-bus ends</span><p>The 8 AWG feeder pair uses M10 closed rings at the main buses and direct #10 closed rings at the Blue Sea buses. Verify lug fit and torque; protection coordination remains on hold.</p></article>
            <article><span>MultiPlus pair · accepted</span><p>Installation approval has been received for the direct 1/0 pair without a dedicated branch breaker. The two independently protected 120 A battery strings and protected SmartSolar source form the accepted upstream scheme.</p></article>
          </div>
        </section>
      </div>
    </section>
  );
}
