import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot = path.join(root, "private");
const queue = path.join(privateRoot, "to-process");
const aggregatePath = path.join(privateRoot, "bank-of-america-wires-through-2026-08-25.json");
const aggregate = JSON.parse(fs.readFileSync(aggregatePath, "utf8"));
const cents = (amount) => Math.round(amount * 100);
const sum = (key) => aggregate.payments.reduce((total, payment) => total + cents(payment[key]), 0);
for (const key of ["amountUsd", "amountFjd", "feeUsd"]) {
  if (sum(key) !== cents(aggregate.totals[key])) throw new Error(`Wire aggregate does not reconcile: ${key}`);
}
if (new Set(aggregate.payments.map((payment) => payment.receiptFile)).size !== aggregate.payments.length) {
  throw new Error("Duplicate payment evidence in wire aggregate");
}

// Extract only accounting fields. Never persist or print bank identifiers,
// email headers, addresses or the complete PDF text.
const parse = (filename) => {
  const text = execFileSync("pdftotext", ["-layout", filename, "-"], { encoding: "utf8" });
  const amount = text.match(/Amount:\s*\$([\d,.]+)\s*\(([\d,.]+) FJD\)/);
  const date = text.match(/Send on Date:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const fee = text.match(/Fee:\s*([\d,.]+)/);
  if (!amount || !date || !fee || !text.includes("WIND SOLAR BATTERY PACIFIC PTE LTD")) return null;
  const number = (value) => Number(value.replaceAll(",", ""));
  return {
    date: `${date[3]}-${date[1]}-${date[2]}`,
    amountUsd: number(amount[1]), amountFjd: number(amount[2]), feeUsd: number(fee[1]),
  };
};
const queued = fs.existsSync(queue) ? fs.readdirSync(queue).filter((name) => /\.pdf$/i.test(name)) : [];
const parsedQueue = queued.map((name) => ({ name, fields: parse(path.join(queue, name)) }));
const matched = new Set();
const archive = aggregate.payments.map((payment) => {
  if (!/^bank-of-america-\d{4}-\d{2}-\d{2}-wire-wind-solar-battery-pacific\.pdf$/.test(payment.receiptFile)) {
    throw new Error("Unsafe wire receipt filename");
  }
  const matches = (fields) => fields && fields.date === payment.date
    && ["amountUsd", "amountFjd", "feeUsd"].every((key) => cents(fields[key]) === cents(payment[key]));
  const candidates = parsedQueue.filter(({ fields }) => matches(fields));
  if (candidates.length > 1) throw new Error(`Multiple queued documents for payment on ${payment.date}; reconcile before archiving`);
  const destination = path.join(privateRoot, payment.receiptFile);
  const exists = fs.existsSync(destination);
  if (exists && !matches(parse(destination))) throw new Error(`Archived wire differs from aggregate on ${payment.date}`);
  if (!exists && candidates.length === 0) throw new Error(`Missing wire evidence on ${payment.date}`);
  const source = candidates[0]?.name;
  if (source) matched.add(source);
  return { source, destination, exists };
});
if (queued.some((name) => !matched.has(name))) {
  throw new Error("Additional receipt PDFs are queued; reconcile them before completing this ingestion");
}
if (!aggregate.payments.every((payment) => payment.allocationStatus === "Owner confirmed"
  && payment.bomIds?.length === 1 && payment.bomIds[0] === "dse-multiplus"
  && payment.payerOrganization === "IYOIYO" && payment.feeUsd === 0)) {
  throw new Error("MultiPlus payment allocation must be confirmed before updating the purchase ledger");
}
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const writeJson = (relative, value) => fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
const system = readJson("data/dse-system.json");
const delivery = readJson("data/dse-delivery.json");
const multiplus = system.bom.find((item) => item.id === "dse-multiplus");
if (!multiplus) throw new Error("Missing MultiPlus BOM row");
const paymentNote = "IYOIYO paid USD 273.28 on 20 Aug, USD 942.33 on 21 Aug and USD 167.11 on 25 Aug 2026: USD 1,382.72 actual bank debits for FJD 2,971.00, with zero stated fees. All three wires pay for this one MultiPlus; the final payment settled the shortfall. No balance remains due.";
Object.assign(multiplus, {
  unitCost: aggregate.totals.amountFjd, currency: "FJD", sourceTotal: aggregate.totals.amountFjd,
  totalUsd: aggregate.totals.amountUsd, location: "Fiji · Wind Solar Battery Pacific",
  procurement: "Purchased · paid in full by IYOIYO · installed",
  priority: "Installed · accepted upstream protection", accountingGroup: "system", includedInTotal: true,
  grantPayer: "IYOIYO", grantSection: "fiji", grantPaymentNote: paymentNote, purchaseDate: "2026-08-25",
  description: `${paymentNote} Exact PMP242305010, 230 V non-GX inverter/charger, installed on Fulaga. The Ekrano is the system's GX controller. The direct 1/0 AWG DC pair uses the accepted upstream battery-string and SmartSolar breaker protection scheme. Retain the installed one-tool operating limit of 1,200 W and protected indoor location. The previous $939 planning estimate and provisional deposit fraction are superseded by the three documented payments.`,
});
delete multiplus.paidFraction;
system.currency.note = "USD remains the reporting base. Original FJD purchase amounts are preserved. The MultiPlus uses the actual USD bank debits; other Fiji purchases and customs costs retain 2.20 FJD/USD where no actual USD debit is documented.";
system.budget.note = system.budget.note
  .replace("Purchases and transaction adjustments are reconciled through 2 Sep 2026.", "Purchases and transaction adjustments include the three August MultiPlus wires reconciled on 12 Sep 2026.")
  .replace("; delivery confirmation remains pending.", "; the system is now installed on Fulaga.")
  .replace("Actual FJD values remain visible by item; USD reports use 2.20 FJD/USD.", "Actual FJD values remain visible by item; MultiPlus reporting uses actual USD bank debits, while other Fiji purchases retain 2.20 FJD/USD.")
  .replaceAll("$11,156.93", "$12,539.65").replaceAll("$14,579.43", "$15,962.15")
  .replace("MultiPlus final Fiji invoicing, local labor, delivery/receipt confirmation and any remaining installation materials still require reconciliation.", "The MultiPlus is fully paid by IYOIYO: FJD 2,971.00 / USD 1,382.72 across three wires. The remaining USD 631.86 of historical allowances are not documented expenses; with USD 424.88 in refunds/promotions, they explain the difference between the USD 17,018.89 positive-value chart and USD 15,962.15 grant total. Any additional installation expenses require actual purchase evidence.");
const retired = readJson("archive/retired-installation-allowances-2026-09-13.json");
const retiredIds = new Set(retired.rows.map((item) => item.id));
system.bom = system.bom.filter((item) => !retiredIds.has(item.id));
for (const id of retiredIds) delete delivery.items[id];
system.budget.note = system.budget.note.replace(
  "The remaining USD 631.86 of historical allowances are not documented expenses; with USD 424.88 in refunds/promotions, they explain the difference between the USD 17,018.89 positive-value chart and USD 15,962.15 grant total. Any additional installation expenses require actual purchase evidence.",
  "All USD 631.86 of historical installation, freight and baggage allowances were removed from the active ledger after the owner confirmed the installation was complete. Baggage was handled elsewhere, outside this project. The USD 16,387.03 positive-value chart less USD 424.88 in documented refunds/promotions equals the USD 15,962.15 IYOIYO grant expense total.",
);
// Do not reintroduce obsolete delivery claims through payment notes in exports.
for (const item of system.bom) {
  if (item.grantPaymentNote) item.grantPaymentNote = item.grantPaymentNote
    .replace("; delivery confirmation remains pending.", ".");
}
delivery.checkedOn = "2026-09-13";
delivery.items["dse-multiplus"] = {
  amazonStatus: "purchased-local", sourceLabel: "Wind Solar Battery Pacific · paid in full by IYOIYO",
  eta: "Installed on Fulaga", time: "Final payment sent 25 Aug 2026", note: paymentNote,
};
// This was a local Fiji purchase; the imported-goods customs manifest stays unchanged.
writeJson("data/dse-system.json", system);
writeJson("data/dse-delivery.json", delivery);

// All three original-currency and bank-debit amounts validated before moving
// any evidence. The archive step is idempotent and never adds purchase rows.
for (const { source, destination, exists } of archive) {
  if (!source) continue;
  const sourcePath = path.join(queue, source);
  if (exists) {
    if (!fs.readFileSync(sourcePath).equals(fs.readFileSync(destination))) {
      throw new Error("A queued receipt differs from its archive; preserve both for review");
    }
    fs.unlinkSync(sourcePath);
  } else fs.renameSync(sourcePath, destination);
  const extraction = sourcePath.replace(/\.pdf$/i, ".txt");
  if (fs.existsSync(extraction)) fs.unlinkSync(extraction);
}
execFileSync(process.execPath, [path.join(root, "scripts/generate-public-receipt-manifest.mjs")], { stdio: "inherit" });
if (fs.existsSync(queue) && fs.readdirSync(queue).length) throw new Error("Receipt queue is not empty");
console.log(`Validated and archived ${aggregate.payments.length} wire receipts; queue empty. No duplicate purchase charges added.`);
