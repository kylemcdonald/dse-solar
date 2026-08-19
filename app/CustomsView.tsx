"use client";

import { useMemo, useState } from "react";
import customsRaw from "@/data/dse-customs.json";

type CustomsBomItem = {
  id: string;
  item: string;
  qty: number;
  unit: string;
  unitCost: number;
  currency: "USD" | "FJD";
  totalUsd: number;
  location: string;
  procurement: string;
};

type ItemMeta = {
  model: string;
  origin: string;
  serialRequired: boolean;
  tafPermitRequired?: boolean;
};

type CustomsData = {
  checkedOn: string;
  manifestTitle: string;
  declaredPurpose: string;
  defaultConsignee: string;
  defaultDestination: string;
  departureDate: string;
  vatRate: number;
  itemMeta: Record<string, ItemMeta>;
  sources: Array<{
    id: string;
    title: string;
    publisher: string;
    url: string;
  }>;
};

type ManifestEdit = {
  qty: string;
  unitCost: string;
  origin: string;
  condition: string;
  receipt: string;
  serials: string;
  caseNo: string;
};

type HeaderFields = {
  consignee: string;
  tin: string;
  traveler: string;
  passport: string;
  flight: string;
  arrivalDate: string;
  destination: string;
  customsAgent: string;
  customsEntry: string;
  concessionReference: string;
  tafPermit: string;
  purpose: string;
  fjdPerUsd: string;
  supplierFreight: string;
  internationalFreight: string;
  insurance: string;
};

const customs = customsRaw as CustomsData;

function valueOf(input: string) {
  const parsed = Number.parseFloat(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function usd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fjd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "FJD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CustomsView({
  bom,
  planningFjdPerUsd,
}: {
  bom: CustomsBomItem[];
  planningFjdPerUsd: number;
}) {
  const manifestItems = useMemo(
    () => bom.filter((item) => item.location === "Import" && customs.itemMeta[item.id]),
    [bom],
  );
  const [fields, setFields] = useState<HeaderFields>(() => ({
    consignee: customs.defaultConsignee,
    tin: "",
    traveler: "",
    passport: "",
    flight: "",
    arrivalDate: "",
    destination: customs.defaultDestination,
    customsAgent: "",
    customsEntry: "",
    concessionReference: "",
    tafPermit: "",
    purpose: customs.declaredPurpose,
    fjdPerUsd: planningFjdPerUsd.toFixed(2),
    supplierFreight: bom.find((item) => item.id === "dse-supplier-freight")?.totalUsd.toFixed(2) ?? "0.00",
    internationalFreight: bom.find((item) => item.id === "dse-baggage")?.totalUsd.toFixed(2) ?? "0.00",
    insurance: "0.00",
  }));
  const [edits, setEdits] = useState<Record<string, ManifestEdit>>(() =>
    Object.fromEntries(
      manifestItems.map((item) => [
        item.id,
        {
          qty: String(item.qty),
          unitCost: (item.totalUsd / item.qty).toFixed(2),
          origin: customs.itemMeta[item.id].origin,
          condition: "New",
          receipt: "",
          serials: "",
          caseNo: "",
        },
      ]),
    ),
  );

  const goodsTotal = manifestItems.reduce((sum, item) => {
    const edit = edits[item.id];
    return sum + valueOf(edit.qty) * valueOf(edit.unitCost);
  }, 0);
  const freightAndInsurance =
    valueOf(fields.supplierFreight) +
    valueOf(fields.internationalFreight) +
    valueOf(fields.insurance);
  const planningCif = goodsTotal + freightAndInsurance;
  const fxRate = valueOf(fields.fjdPerUsd);
  const planningVatFloor = planningCif * customs.vatRate;

  function updateField(key: keyof HeaderFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function updateEdit(id: string, key: keyof ManifestEdit, value: string) {
    setEdits((current) => ({
      ...current,
      [id]: { ...current[id], [key]: value },
    }));
  }

  return (
    <section className="customs-view" aria-label="Fiji customs planning and packing manifest">
      <div className="customs-screen-only">
        <div className="customs-heading">
          <div>
            <span>Fiji arrival planning · researched {customs.checkedOn}</span>
            <h1>Customs &amp; packing manifest</h1>
            <p>
              This is project equipment worth more than FJ$1,000. Pre-clear it; do not rely on
              completing everything at the baggage desk.
            </p>
          </div>
          <button type="button" className="customs-print-button" onClick={() => window.print()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z" />
            </svg>
            Print / save PDF
          </button>
        </div>

        <div className="customs-alert-grid">
          <article className="customs-alert customs-alert-urgent">
            <span>Clearance route</span>
            <strong>Licensed agent before arrival</strong>
            <p>Without pre-clearance, FRCS says goods over FJ$1,000 will be detained.</p>
          </article>
          <article className="customs-alert">
            <span>Planning goods value</span>
            <strong>{usd(goodsTotal)}</strong>
            <p>Replace every allowance with the final receipt amount before printing.</p>
          </article>
          <article className="customs-alert">
            <span>Planning CIF</span>
            <strong>{usd(planningCif)}</strong>
            <p>Goods + entered freight + insurance; the customs agent controls the final basis.</p>
          </article>
          <article className="customs-alert customs-alert-warn">
            <span>Telecom permit</span>
            <strong>Four radio models</strong>
            <p>Apply for the UniFi plus three wireless Victron models; TAF may also require type approval.</p>
          </article>
        </div>

        <div className="customs-guidance-grid">
          <article>
            <div className="customs-card-number">01</div>
            <h2>Do this before the flight</h2>
            <ol>
              <li>Confirm the Fiji legal consignee and its TIN.</li>
              <li>
                Engage a <a href={customs.sources.find((source) => source.id === "brokers")?.url}>licensed Nadi customs agent</a> now.
              </li>
              <li>Send the agent this manifest, every invoice, flight details and consignee TIN.</li>
              <li>Ask the agent to pre-register the ASYCUDA SAD within FRCS&apos;s three-day pre-advance window.</li>
              <li>Apply to TAF for the UniFi Express, Ekrano GX, SmartSolar and SmartShunt. Ask which models already hold Fiji type approval; a new type approval can take 10 working days.</li>
            </ol>
          </article>
          <article>
            <div className="customs-card-number">02</div>
            <h2>What to carry on arrival</h2>
            <ul>
              <li>Printed signed manifest and a copy for Customs</li>
              <li>Commercial invoices, eBay/Amazon receipts and proof of payment</li>
              <li>Donation letter plus beneficiary acceptance letter</li>
              <li>Customs Entry/SAD and duty receipt if pre-cleared</li>
              <li>TAF permit(s) listing all four wireless models</li>
              <li>Any written FRCS concession approval and registration certificate</li>
            </ul>
            <p className="customs-arrival-note">
              Declare the goods on the Passenger Arrival Card and present them at the Customs Secondary Checkpoint in the baggage hall.
            </p>
          </article>
          <article>
            <div className="customs-card-number">03</div>
            <h2>School status is not automatic relief</h2>
            <p>
              Calling the recipient a school does not by itself remove duty or VAT. The clearly relevant published route is Concession Code 215, and it applies only if the Fiji recipient is a legally registered charitable or religious organisation and FRCS approves the goods case by case before import.
            </p>
            <p>
              If eligible, send a request letter, registration certificate, packing list and transport document to <a href="mailto:tariff&trade@frcs.org.fj">tariff&amp;trade@frcs.org.fj</a>. Ask for written approval; do not assume the airport officer can grant it on arrival.
            </p>
          </article>
          <article>
            <div className="customs-card-number">04</div>
            <h2>How charges are determined</h2>
            <p>
              FRCS bases duty on CIF: cost + insurance + freight. Fiscal duty and import excise depend on the agent&apos;s HS classification. VAT is currently 12.5% and is applied after any dutiable additions.
            </p>
            <dl className="customs-fee-preview">
              <div><dt>CIF in FJD</dt><dd>{fjd(planningCif * fxRate)}</dd></div>
              <div><dt>12.5% VAT-only floor</dt><dd>{usd(planningVatFloor)}</dd></div>
            </dl>
            <p className="customs-caution">
              The VAT-only figure assumes zero fiscal duty and zero import excise. It is not a quote and excludes broker, storage and permit fees.
            </p>
          </article>
        </div>

        <section className="customs-sources">
          <div>
            <span>Official references</span>
            <h2>Current Fiji government guidance</h2>
          </div>
          <div className="customs-source-links">
            {customs.sources.map((source) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                <b>{source.title}</b>
                <small>{source.publisher}</small>
                <em>↗</em>
              </a>
            ))}
          </div>
          <p>
            FRCS: <a href="mailto:CustomsRevenue@frcs.org.fj">CustomsRevenue@frcs.org.fj</a> · duty help: <a href="mailto:customshelp@frcs.org.fj">customshelp@frcs.org.fj</a> · TAF: <a href="mailto:contact@taf.org.fj">contact@taf.org.fj</a>
          </p>
        </section>
      </div>

      <section className="customs-manifest-section">
        <div className="customs-manifest-title">
          <div>
            <span>Commercial / project equipment · accompanied baggage</span>
            <h2>{customs.manifestTitle}</h2>
            <p>Planning manifest — replace estimates with actual receipts before submission.</p>
          </div>
          <button type="button" className="customs-print-button customs-screen-only" onClick={() => window.print()}>
            Print / save PDF
          </button>
        </div>

        <div className="customs-form-grid">
          <label>
            <span>Fiji consignee / legal recipient</span>
            <input value={fields.consignee} onChange={(event) => updateField("consignee", event.target.value)} />
          </label>
          <label>
            <span>Consignee TIN</span>
            <input value={fields.tin} onChange={(event) => updateField("tin", event.target.value)} placeholder="Required for pre-clearance" />
          </label>
          <label>
            <span>Traveler / importer</span>
            <input value={fields.traveler} onChange={(event) => updateField("traveler", event.target.value)} />
          </label>
          <label>
            <span>Passport number</span>
            <input value={fields.passport} onChange={(event) => updateField("passport", event.target.value)} />
          </label>
          <label>
            <span>Flight number</span>
            <input value={fields.flight} onChange={(event) => updateField("flight", event.target.value)} placeholder="LAX → NAN" />
          </label>
          <label>
            <span>Arrival date in Fiji</span>
            <input type="date" value={fields.arrivalDate} onChange={(event) => updateField("arrivalDate", event.target.value)} />
          </label>
          <label className="customs-field-wide">
            <span>Final destination</span>
            <input value={fields.destination} onChange={(event) => updateField("destination", event.target.value)} />
          </label>
          <label>
            <span>Licensed customs agent</span>
            <input value={fields.customsAgent} onChange={(event) => updateField("customsAgent", event.target.value)} />
          </label>
          <label>
            <span>Customs Entry / SAD reference</span>
            <input value={fields.customsEntry} onChange={(event) => updateField("customsEntry", event.target.value)} />
          </label>
          <label>
            <span>Concession approval reference</span>
            <input value={fields.concessionReference} onChange={(event) => updateField("concessionReference", event.target.value)} placeholder="If approved; otherwise N/A" />
          </label>
          <label>
            <span>TAF permit reference(s)</span>
            <input value={fields.tafPermit} onChange={(event) => updateField("tafPermit", event.target.value)} />
          </label>
          <label className="customs-field-full">
            <span>Purpose / end use</span>
            <textarea value={fields.purpose} onChange={(event) => updateField("purpose", event.target.value)} rows={2} />
          </label>
        </div>

        <div className="customs-table-wrap">
          <table className="customs-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Description / model</th>
                <th>Qty</th>
                <th>Country of origin</th>
                <th>Condition</th>
                <th>Unit value USD</th>
                <th>Total USD</th>
                <th>Invoice / receipt</th>
                <th>Serial number(s)</th>
                <th>Bag / case</th>
              </tr>
            </thead>
            <tbody>
              {manifestItems.map((item, index) => {
                const edit = edits[item.id];
                const meta = customs.itemMeta[item.id];
                const lineTotal = valueOf(edit.qty) * valueOf(edit.unitCost);
                return (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>{item.item}</strong>
                      <span>{meta.model}</span>
                      {meta.tafPermitRequired && <em className="customs-taf-flag">TAF radio permit</em>}
                    </td>
                    <td>
                      <input aria-label={`${item.item} quantity`} inputMode="decimal" value={edit.qty} onChange={(event) => updateEdit(item.id, "qty", event.target.value)} />
                      <small>{item.unit}</small>
                    </td>
                    <td><input aria-label={`${item.item} country of origin`} value={edit.origin} onChange={(event) => updateEdit(item.id, "origin", event.target.value)} /></td>
                    <td><input aria-label={`${item.item} condition`} value={edit.condition} onChange={(event) => updateEdit(item.id, "condition", event.target.value)} /></td>
                    <td><input aria-label={`${item.item} unit value`} inputMode="decimal" value={edit.unitCost} onChange={(event) => updateEdit(item.id, "unitCost", event.target.value)} /></td>
                    <td className="customs-total-cell">{usd(lineTotal)}</td>
                    <td><input aria-label={`${item.item} invoice or receipt`} value={edit.receipt} onChange={(event) => updateEdit(item.id, "receipt", event.target.value)} placeholder="Attach" /></td>
                    <td>
                      <input aria-label={`${item.item} serial numbers`} value={edit.serials} onChange={(event) => updateEdit(item.id, "serials", event.target.value)} placeholder={meta.serialRequired ? "Required" : "N/A"} />
                    </td>
                    <td><input aria-label={`${item.item} bag or case`} value={edit.caseNo} onChange={(event) => updateEdit(item.id, "caseNo", event.target.value)} placeholder="IM2875 #" /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Declared goods subtotal</td>
                <td>{usd(goodsTotal)}</td>
                <td colSpan={3}>Actual transaction values required</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="customs-valuation-grid">
          <label><span>Supplier freight to LAX · USD</span><input inputMode="decimal" value={fields.supplierFreight} onChange={(event) => updateField("supplierFreight", event.target.value)} /></label>
          <label><span>International baggage/freight · USD</span><input inputMode="decimal" value={fields.internationalFreight} onChange={(event) => updateField("internationalFreight", event.target.value)} /></label>
          <label><span>Insurance · USD</span><input inputMode="decimal" value={fields.insurance} onChange={(event) => updateField("insurance", event.target.value)} /></label>
          <label><span>Planning FJD per USD</span><input inputMode="decimal" value={fields.fjdPerUsd} onChange={(event) => updateField("fjdPerUsd", event.target.value)} /></label>
          <div><span>Planning CIF · USD</span><strong>{usd(planningCif)}</strong></div>
          <div><span>Planning CIF · FJD</span><strong>{fjd(planningCif * fxRate)}</strong></div>
        </div>

        <div className="customs-manifest-notes">
          <div>
            <h3>Attachments</h3>
            <p>□ Itemized receipts/invoices &nbsp; □ Proof of payment &nbsp; □ Donation letter &nbsp; □ Beneficiary acceptance &nbsp; □ TAF permit(s) &nbsp; □ SAD/Customs Entry &nbsp; □ Concession approval, if any</p>
          </div>
          <div>
            <h3>Declaration</h3>
            <p>I declare that this manifest is complete and that the values shown are the actual prices paid or payable. The goods are permanent project equipment for the stated recipient and are not for resale.</p>
            <div className="customs-signature-lines"><span>Traveler signature</span><span>Date</span><span>Customs agent / witness</span></div>
          </div>
          <p className="customs-fine-print">
            Classification, customs value, exchange rate, concessions and final taxes are determined by FRCS and the licensed customs agent. Split mixed kits into invoice-level sub-lines if requested. Used eBay goods still require the actual purchase receipt and an honest used condition/value.
          </p>
        </div>
      </section>
    </section>
  );
}
