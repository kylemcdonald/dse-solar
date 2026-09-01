import dseRaw from "@/data/dse-system.json";
import runtimeRaw from "@/data/generated/dse-runtime.json";
import { PrintButton } from "./PrintButton";
import styles from "./page.module.css";

type CableAssembly = {
  route: string;
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
  conductor: string;
  procurement: string;
  routedTotalLengthM: number;
  planningTotalLengthM: number;
  planningTotalLengthFt: number;
  planningRule: string;
  inventoryAllocationStatus: string;
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
};

type FieldWireRow = {
  id: string;
  size: string;
  construction: string;
  cableIds: string[];
  planningLengthM?: number;
  routedLengthM?: number;
  routeCount?: number;
  use: string;
  orderNote: string;
};

const system = dseRaw;
const plan = dseRaw.batteryCablePlan as BatteryCablePlan;
const runtimeRoutes = runtimeRaw.routes as RuntimeRoute[];

function routesFor(cableIds: string[]) {
  return runtimeRoutes.filter((route) => cableIds.includes(route.cableId));
}

function roundedProcurementLength(routedLengthM: number) {
  return Math.ceil(routedLengthM * 1.15 * 2) / 2;
}

const fieldWireRows: FieldWireRow[] = [
  {
    id: "battery53",
    size: "1/0 AWG · 53.5 mm²",
    construction: "Red / black flexible single-core",
    cableIds: ["battery53"],
    routedLengthM: plan.routedTotalLengthM,
    planningLengthM: plan.planningTotalLengthM,
    routeCount: plan.assemblies.length,
    use: "Battery strings, main buses, SmartShunt, MultiPlus and secondary feeders",
    orderNote: "Order as the individually terminated assemblies listed below; several ends remain on hold.",
  },
  {
    id: "dc35",
    size: "35 mm²",
    construction: "Red / black flexible single-core",
    cableIds: ["dc35"],
    use: "SmartSolar battery-side branch",
    orderNote: "Keep the Victron 35 mm² / 100–120 A manufacturer envelope; verify the received cable and terminals.",
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
    orderNote: "Common consolidated branch size; terminal-fit holds remain at the ChargeIT Phoenix plugs.",
  },
  {
    id: "pv4",
    size: "4 mm²",
    construction: "Red / black PV-rated single-core outdoors",
    cableIds: ["pv4"],
    planningLengthM: 35,
    use: "AIKO 3S string, one 15 m home-run pair, PV cutoff and small 10 A service feed",
    orderNote: "35 m overrides the scaled 3D total: 30 m home-run loop plus 5 m indoor/service allowance.",
  },
  {
    id: "earth4",
    size: "4 mm²",
    construction: "Green/yellow protective-earth single-core",
    cableIds: ["earth4"],
    use: "AIKO frame bonds and main PE distribution",
    orderNote: "Same copper area as PV cable, but keep the protective-earth color and installation rating distinct.",
  },
  {
    id: "branch1.5",
    size: "1.5 mm²",
    construction: "Color-coded flexible single-core",
    cableIds: ["branch1.5"],
    use: "Balancer, switches, lighting tails and low-current services",
    orderNote: "One consolidated small-conductor size; preserve polarity, function colors and near-battery protection holds.",
  },
  {
    id: "ac3",
    size: "3 × 1.5 mm²",
    construction: "Jacketed three-core 230 V cable",
    cableIds: ["ac3"],
    use: "Generator input, MultiPlus AC-in/out and tool outlet",
    orderNote: "The displayed route total is jacketed cable; modeled exposed core tails are part of these assemblies, not extra cable.",
  },
  {
    id: "light2",
    size: "2 × 1.5 mm²",
    construction: "Jacketed two-core DC lighting cable",
    cableIds: ["light2"],
    use: "Indoor and outdoor light runs",
    orderNote: "Keep the outdoor segment UV/weather suitable and maintain DC polarity identification.",
  },
].map((row) => {
  const routes = routesFor(row.cableIds);
  const routedLengthM = row.routedLengthM ?? routes.reduce((total, route) => total + route.lengthM, 0);
  return {
    ...row,
    routedLengthM,
    routeCount: row.routeCount ?? routes.length,
    planningLengthM: row.planningLengthM ?? roundedProcurementLength(routedLengthM),
  };
});

const distinctFieldSizes = new Set(["53.5", "35", "16", "6", "4", "1.5"]).size;

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
  if (lugs.startsWith("M8 ring at battery")) return [
    { label: "M8 closed ring", kind: "ring" },
    { label: "Breaker end · verify clamp", kind: "verify" },
  ];
  if (lugs.startsWith("factory-prepared breaker end")) return [
    { label: "Breaker end · verify clamp", kind: "verify" },
    { label: "M10 closed ring", kind: "ring" },
  ];
  return [
    { label: "M10 closed ring", kind: "ring" },
    { label: "#10-32 transition · HOLD", kind: "hold" },
  ];
}

function assemblyStatus(assembly: CableAssembly) {
  if (assembly.route.includes("multiplus")) return {
    label: "Protection hold",
    tone: "hold" as const,
    detail: "Wait for the required external MultiPlus DC protection and final route.",
  };
  if (assembly.lugs.includes("selection hold")) return {
    label: "Transition hold",
    tone: "hold" as const,
    detail: "The secondary-bus #10-32 transition is not selected or approved.",
  };
  if (assembly.lugs.includes("breaker end")) return {
    label: "Verify breaker",
    tone: "verify" as const,
    detail: "Inspect the received DIHOOL clamp before specifying this end.",
  };
  return {
    label: "Measure, then order",
    tone: "ready" as const,
    detail: "Both ring sizes are defined; confirm the physical center-to-center length.",
  };
}

const assemblies = plan.assemblies.map((assembly) => ({
  ...assembly,
  ends: endPlans(assembly),
  status: assemblyStatus(assembly),
}));

const ringCounts = assemblies.flatMap((assembly) => assembly.ends)
  .filter((end) => end.kind === "ring")
  .reduce((counts, end) => {
    const size = end.label.startsWith("M8") ? "M8" : "M10";
    counts[size] += 1;
    return counts;
  }, { M8: 0, M10: 0 });

const colorTotals = assemblies.reduce((totals, assembly) => {
  totals[assembly.color] += assembly.planningLengthM * assembly.qty;
  return totals;
}, { red: 0, black: 0 });

function formatMetres(value: number) {
  return `${value.toFixed(2)} m`;
}

function formatMillimetres(value: number) {
  return `${Math.round(value * 1000)} mm`;
}

function formatInches(value: number) {
  return `${(value * 39.3701).toFixed(1)} in`;
}

export default function CablePlanPage() {
  return (
    <div className={styles.page}>
      <title>Wire Cut List · DSE Fiji</title>
      <meta
        name="description"
        content="Model-derived field-wire totals and the vendor-ready DSE Fiji 1/0 AWG cable assembly schedule."
      />
      <header className={styles.siteHeader}>
        <a className={styles.brand} href="../" aria-label="Return to DSE Fiji system viewer">
          <span className={styles.brandMark}>DSE</span>
          <span>Fiji solar system</span>
        </a>
        <div className={styles.revision}>
          <span>Installation worksheet</span>
          <strong>{system.revision}</strong>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>R30 · model-derived installation schedule</p>
            <h1>Wire cut list</h1>
            <p className={styles.intro}>
              Consolidated field-cable totals for the three-panel AIKO array and 440 Ah Victron GEL bank, followed
              by provisional 1/0 AWG cut lengths and end terminations. “Eyelet” means a closed heavy-duty ring lug
              sized to the actual terminal stud.
            </p>
          </div>
          <div className={styles.actions}>
            <a href="../">Back to system viewer</a>
            <PrintButton className={styles.printButton} />
          </div>
        </section>

        <section className={styles.stats} aria-label="R30 wire schedule summary">
          <article>
            <span>Field conductor sizes</span>
            <strong>{distinctFieldSizes}</strong>
            <small>53.5 · 35 · 16 · 6 · 4 · 1.5 mm²</small>
          </article>
          <article>
            <span>Scheduled constructions</span>
            <strong>{fieldWireRows.length}</strong>
            <small>Single-core plus 2- and 3-core</small>
          </article>
          <article>
            <span>PV cable order</span>
            <strong>35.00 m</strong>
            <small>One 15 m positive/negative home run + allowance</small>
          </article>
          <article>
            <span>PV topology</span>
            <strong>3S</strong>
            <small>One string · one 20 A cutoff</small>
          </article>
          <article>
            <span>1/0 planning total</span>
            <strong>{formatMetres(plan.planningTotalLengthM)}</strong>
            <small>{plan.assemblies.length} individual assemblies</small>
          </article>
        </section>

        <section className={styles.measurementWarning}>
          <div className={styles.warningIcon} aria-hidden="true">!</div>
          <div>
            <strong>These are planning lengths, not final cut instructions.</strong>
            <p>
              Lock the equipment positions and measure each supported route from terminal to terminal. Confirm cable
              construction, terminal take-up, bend radius, lug orientation and service allowance before ordering.
            </p>
          </div>
        </section>

        <section className={styles.schedule} aria-labelledby="field-wire-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Consolidated procurement schedule</p>
              <h2 id="field-wire-heading">Field wire by size and construction</h2>
            </div>
            <p className={styles.scheduleBasis}>15% model allowance, rounded up to 0.5 m, except the fixed 35 m PV requirement and the individually rounded 1/0 schedule.</p>
          </div>

          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.fieldTable}`}>
              <thead>
                <tr>
                  <th scope="col">Conductor size</th>
                  <th scope="col">Construction / color</th>
                  <th scope="col">Model routes</th>
                  <th scope="col">3D centerlines</th>
                  <th scope="col">Planning quantity</th>
                  <th scope="col">Use and order note</th>
                </tr>
              </thead>
              <tbody>
                {fieldWireRows.map((row) => (
                  <tr key={row.id}>
                    <td><span className={styles.gaugeBadge}>{row.size}</span></td>
                    <td><strong>{row.construction}</strong></td>
                    <td className={styles.routeLength}>{row.routeCount}</td>
                    <td className={styles.routeLength}>{formatMetres(row.routedLengthM ?? 0)}</td>
                    <td className={styles.orderLength}><strong>{formatMetres(row.planningLengthM ?? 0)}</strong></td>
                    <td><strong>{row.use}</strong><small className={styles.rowNote}>{row.orderNote}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.modelCaveat}>
            Factory Starlink, USB, data and socket harnesses remain their specified assemblies and are not included as
            bulk field wire. The rendered roof-to-wall distance is a physical-layout proxy; the PV order therefore uses
            the project’s 15 m one-way design run rather than the shorter scene centerline.
          </p>
        </section>

        <div className={styles.subsectionTitle}>
          <p className={styles.eyebrow}>Fabricator detail</p>
          <h2>1/0 AWG assembly cuts and eyelets</h2>
          <p>Use this section to quote each heavy-current assembly after the final center-to-center site measurement.</p>
        </div>

        <section className={styles.stats} aria-label="Cable plan totals">
          <article>
            <span>Assemblies</span>
            <strong>{assemblies.length}</strong>
            <small>Individual 1/0 cables</small>
          </article>
          <article>
            <span>3D centerlines</span>
            <strong>{formatMetres(plan.routedTotalLengthM)}</strong>
            <small>Geometry evidence</small>
          </article>
          <article>
            <span>Planning allowance</span>
            <strong>{formatMetres(plan.planningTotalLengthM)}</strong>
            <small>{plan.planningTotalLengthFt.toFixed(2)} ft total</small>
          </article>
          <article className={styles.redStat}>
            <span>Red cable</span>
            <strong>{formatMetres(colorTotals.red)}</strong>
            <small>Planning quantity</small>
          </article>
          <article className={styles.blackStat}>
            <span>Black cable</span>
            <strong>{formatMetres(colorTotals.black)}</strong>
            <small>Planning quantity</small>
          </article>
        </section>

        <section className={styles.schedule} aria-labelledby="cut-schedule-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Vendor worksheet</p>
              <h2 id="cut-schedule-heading">Cut and termination schedule</h2>
            </div>
            <div className={styles.legend} aria-label="Status legend">
              <span><i className={styles.readyDot} /> Measure, then order</span>
              <span><i className={styles.verifyDot} /> Hardware verification</span>
              <span><i className={styles.holdDot} /> Design hold</span>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Cable / connection</th>
                  <th scope="col">3D route</th>
                  <th scope="col">Provisional order length</th>
                  <th scope="col">End A</th>
                  <th scope="col">End B</th>
                  <th scope="col">Order status</th>
                </tr>
              </thead>
              <tbody>
                {assemblies.map((assembly, index) => (
                  <tr key={assembly.route}>
                    <td>
                      <div className={styles.connectionTitle}>
                        <span className={`${styles.cableSwatch} ${styles[assembly.color]}`} aria-label={`${assembly.color} cable`} />
                        <div>
                          <span className={styles.cableNumber}>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{assembly.from} <b aria-hidden="true">→</b> {assembly.to}</strong>
                        </div>
                      </div>
                      <small>{assembly.purpose}</small>
                    </td>
                    <td className={styles.routeLength}>{formatMetres(assembly.routedLengthM)}</td>
                    <td className={styles.orderLength}>
                      <strong>{formatMillimetres(assembly.planningLengthM)}</strong>
                      <small>{formatInches(assembly.planningLengthM)}</small>
                    </td>
                    {assembly.ends.map((end, endIndex) => (
                      <td key={`${assembly.route}-${endIndex}`}>
                        <span className={`${styles.endBadge} ${styles[`end-${end.kind}`]}`}>{end.label}</span>
                      </td>
                    ))}
                    <td>
                      <span className={`${styles.statusBadge} ${styles[`status-${assembly.status.tone}`]}`}>
                        {assembly.status.label}
                      </span>
                      <small className={styles.statusDetail}>{assembly.status.detail}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
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
              <span><strong>4</strong><small>Breaker ends to verify</small></span>
              <span><strong>2</strong><small>Secondary transitions held</small></span>
            </div>
            <p className={styles.cardNote}>
              M8 and M10 are not interchangeable. Verify the actual stud and ring-hole dimensions; never drill a lug
              or trim conductor strands to force a fit.
            </p>
          </article>

          <article className={styles.procurementCard}>
            <p className={styles.eyebrow}>Fabricator specification</p>
            <h2>What to put on the order</h2>
            <ul className={styles.specList}>
              <li>1/0 AWG / 53.5 mm² flexible copper conductor; no CCA or aluminum.</li>
              <li>Closed tinned-copper heavy lugs with the exact M8 or M10 hole specified.</li>
              <li>Adhesive-lined red or black heat shrink and a durable circuit label at both ends.</li>
              <li>State every finished dimension as lug-hole center to lug-hole center.</li>
              <li>Ask for the crimp die/tool record and a completed pull-test or inspection record.</li>
            </ul>
          </article>
        </section>

        <section className={styles.holdSection}>
          <div>
            <p className={styles.eyebrow}>Do not fabricate yet</p>
            <h2>Six cable ends remain unresolved</h2>
          </div>
          <div className={styles.holdColumns}>
            <article>
              <span>4 breaker ends</span>
              <p>
                The DIHOOL devices use screw clamps. Inspect their received conductor range and instructions before
                selecting bare fine strand, a pin/ferrule, or a listed transition. Do not order a ring lug by assumption.
              </p>
            </article>
            <article>
              <span>2 secondary-bus ends</span>
              <p>
                The current #10-32 landing needs an engineer-approved 1/0 transition. This is not an ordinary 1/0 lug
                with an undersized hole, and both secondary feeders remain on design hold.
              </p>
            </article>
            <article>
              <span>MultiPlus pair</span>
              <p>
                Although both current lug sizes are known, hold fabrication until the required external DC protection
                is selected and placed; that decision can change the positive cable count and both final lengths.
              </p>
            </article>
          </div>
        </section>

        <footer className={styles.footer}>
          <p><strong>Source:</strong> canonical DSE battery cable plan and routed R30 system geometry.</p>
          <p>{plan.planningRule}</p>
        </footer>
      </main>
    </div>
  );
}
