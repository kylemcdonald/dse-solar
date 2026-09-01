import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import customs from "../data/dse-customs.json";
import receipts from "../data/dse-receipts.json";
import system from "../data/dse-system.json";
import { buildCostTreemap, costTreemapItems, filterCostTreemapItems, type CostBomItem } from "../app/CostView";
import { buildCustomsCsv, buildCustomsLines, hasDistinctModel, isCustomsManifestItem, sortCustomsItems, stripAsinFromDescription, unitCostInput, type CustomsBomItem } from "../app/CustomsView";
import { buildWeightTreemap, shippingGroupFor, type ShippingBomItem } from "../app/ShippingView";
import { createStoredZip, loadReceiptArchive, privateModeEnabled, receiptAllowlist, receiptZipFilename } from "../app/api/receipts/receiptServer";
import { GET as getReceiptStatus } from "../app/api/receipts/status/route";
import { GET as downloadReceipts } from "../app/api/receipts/download/route";

const imports = system.bom.filter((item) => isCustomsManifestItem(item as CustomsBomItem)) as CustomsBomItem[];
const itemMeta = customs.itemMeta as Record<string, {
  make: string; model: string; additionalInfo?: string; origin: string; originReviewedOn?: string; originSourceUrl?: string; defaultCondition?: string;
  serialRequired: boolean; defaultSerials?: string; tafPermitRequired?: boolean;
}>;
const itemInvoices = receipts.itemInvoices as Record<string, number[]>;
const edits = Object.fromEntries(imports.map((item) => [item.id, {
  qty: String(item.qty), unitCost: unitCostInput(item),
  origin: itemMeta[item.id].origin,
  condition: itemMeta[item.id].defaultCondition ?? "New", serials: itemMeta[item.id].defaultSerials ?? "",
}]));

function storedZipEntryNames(archive: Buffer) {
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    names.push(archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + size;
  }
  return names;
}

test("radio permit items sort first and item values are conserved by optional grouping", () => {
  const sorted = sortCustomsItems(imports);
  const permitCount = sorted.filter((item) => itemMeta[item.id].tafPermitRequired).length;
  assert.ok(permitCount > 0);
  assert.ok(sorted.slice(0, permitCount).every((item) => itemMeta[item.id].tafPermitRequired));
  const detailed = buildCustomsLines(imports, edits, false);
  const grouped = buildCustomsLines(imports, edits, true);
  const detailedById = new Map(detailed.map((line) => [line.id, line]));
  assert.ok(Math.abs(detailed.reduce((sum, line) => sum + line.lineTotal, 0) - imports.reduce((sum, item) => sum + item.totalUsd, 0)) < 1e-9);
  assert.ok(Math.abs(grouped.reduce((sum, line) => sum + line.lineTotal, 0) - detailed.reduce((sum, line) => sum + line.lineTotal, 0)) < 1e-9);
  const miscellaneous = grouped.find((line) => line.groupedItemIds);
  assert.ok(miscellaneous && miscellaneous.groupedItemIds && miscellaneous.groupedItemIds.length > 1);
  const expectedGroupedIds = imports
    .filter((item) => item.totalUsd < customs.miscGrouping.maximumLineUsd)
    .map((item) => item.id)
    .sort();
  assert.deepEqual([...miscellaneous.groupedItemIds].sort(), expectedGroupedIds);
  for (const id of miscellaneous.groupedItemIds) {
    const item = imports.find((candidate) => candidate.id === id)!;
    assert.ok(item.totalUsd < customs.miscGrouping.maximumLineUsd);
    assert.ok(miscellaneous.model.includes(`${itemMeta[id].make} / ${itemMeta[id].model}`));
  }
  assert.equal(miscellaneous.model, miscellaneous.groupedItemIds
    .map((id) => `${detailedById.get(id)!.make} / ${detailedById.get(id)!.model}`).join("; "));
  assert.equal(grouped.at(-1)?.id, "miscellaneous-electrical-accessories");
  assert.equal(miscellaneous.additionalInfo, "");
  assert.ok(imports.filter((item) => item.totalUsd >= customs.miscGrouping.maximumLineUsd)
    .every((item) => !miscellaneous.groupedItemIds!.includes(item.id)));
});

test("public invoice references are numeric, canonical and separate from ASIN descriptions", () => {
  assert.equal(receipts.invoices.length, 47);
  assert.ok(receipts.invoices.every((invoice, index) => invoice.number === index + 1));
  assert.ok(receipts.invoices.every((invoice) => /^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/.test(invoice.filename)));
  const validInvoiceNumbers = new Set(receipts.invoices.map((invoice) => invoice.number));
  assert.ok(Object.values(receipts.itemInvoices).flat().every((number) => validInvoiceNumbers.has(number)));
  const purchasedWithoutAutomaticReceipt = imports
    .filter((item) => item.procurement.includes("Purchased") && !itemInvoices[item.id]?.length)
    .map((item) => item.id)
    .sort();
  assert.deepEqual(purchasedWithoutAutomaticReceipt, [...receipts.purchasedWithoutReceipt].sort());
  assert.deepEqual(purchasedWithoutAutomaticReceipt, []);
  const routerLine = buildCustomsLines(imports, edits, false).find((line) => line.id === "dse-router");
  assert.equal(routerLine?.receiptMissing, false);
  assert.deepEqual(itemInvoices["dse-router"], [2]);
  assert.deepEqual(itemInvoices["dse-ac-rcbo"], [36]);
  assert.deepEqual(itemInvoices["dse-orion-input-breaker"], [37]);
  assert.deepEqual(itemInvoices["dse-chargeit-branch-breaker"], [37]);
  assert.deepEqual(itemInvoices["dse-pv-string-breakers"], [37]);
  assert.deepEqual(itemInvoices["dse-battery-cable"], [38]);
  assert.deepEqual(itemInvoices["dse-battery-string-breakers"], [39]);
  assert.deepEqual(itemInvoices["dse-breaker-mnedc100"], [39]);
  assert.deepEqual(itemInvoices["dse-shirbly-2awg-cable-pairs"], [38, 40]);
  assert.deepEqual(itemInvoices["dse-airic-npt-cable-glands"], [41]);
  assert.deepEqual(itemInvoices["dse-main-busbars"], [41]);
  assert.deepEqual(itemInvoices["dse-ventilated-ip65-enclosure"], [41]);
  assert.deepEqual(itemInvoices["dse-pg11-cable-glands"], [42]);
  assert.deepEqual(itemInvoices["dse-mollom-8-way-enclosure-second"], [42]);
  assert.deepEqual(itemInvoices["dse-switched-load-breaker"], [43]);
  assert.deepEqual(itemInvoices["dse-extra-dihool-120a-breaker"], [45]);
  assert.deepEqual(itemInvoices["dse-extra-ac-rcbo-pair"], [46]);
  assert.deepEqual(itemInvoices["dse-kerwinn-shared-services-breaker-alternate"], [47]);
  assert.deepEqual(receipts.invoices.find((invoice) => invoice.number === 44), {
    number: 44,
    date: "2026-08-28",
    filename: "extreme-customs-clearance-2026-08-28-invoice-00070037-drua-sailing.pdf",
    supplier: "Extreme Customs Clearance",
  });
  assert.deepEqual(itemInvoices["dse-customs-vat"], [44]);
  assert.deepEqual(itemInvoices["dse-customs-agent-costs"], [44]);
  assert.deepEqual(receipts.invoices.at(-1), {
    number: 47,
    date: "2026-08-28",
    filename: "amazon-2026-08-28-order-111-7441385-7705847-kerwinn-10a-shared-services-breaker.pdf",
    supplier: "Amazon",
  });
  assert.equal(stripAsinFromDescription("Breaker · ASIN B0B1WC651R"), "Breaker");
  assert.equal(stripAsinFromDescription("Victron Ekrano GX BPP900480100"), "Victron Ekrano GX BPP900480100");
  assert.equal(hasDistinctModel("Same title", "same title"), false);
  assert.equal(hasDistinctModel("Title", "Model 123"), true);
});

test("new purchases retain receipt status while the larger secondary shell supersedes the owned spare", () => {
  const purchasedIds = [
    "dse-airic-npt-cable-glands", "dse-ventilated-ip65-enclosure", "dse-pg11-cable-glands",
    "dse-mollom-8-way-enclosure-second", "dse-shirbly-2awg-cable-pairs",
  ];
  const purchasedRows = purchasedIds.map((id) => system.bom.find((item) => item.id === id)!);
  assert.ok(purchasedRows.every((row) => row.procurement === "Purchased"));
  assert.deepEqual(Object.fromEntries(purchasedRows.map((row) => [row.id, row.priority])), {
    "dse-airic-npt-cable-glands": "Integration pending",
    "dse-ventilated-ip65-enclosure": "Not in design · owned undersized spare",
    "dse-pg11-cable-glands": "Integration pending",
    "dse-mollom-8-way-enclosure-second": "Must · verified cutoff enclosure",
    "dse-shirbly-2awg-cable-pairs": "Integration pending",
  });
  assert.ok(purchasedRows.every((row) => row.location === "Import" && row.totalWeightKg > 0));
  assert.equal(Math.round(purchasedRows.reduce((sum, row) => sum + row.totalUsd, 0) * 100) / 100, 136.34);
  assert.ok(purchasedIds.every((id) => itemMeta[id] && itemInvoices[id]?.length >= 1));
  const topology = fs.readFileSync("app/dseTopology.ts", "utf8");
  const installedEnclosureIds = [
    "dse-airic-npt-cable-glands", "dse-pg11-cable-glands",
    "dse-mollom-8-way-enclosure-second", "dse-secondary-enclosure-larger",
  ];
  assert.ok(installedEnclosureIds.every((id) => topology.includes(id)),
    "the split-DC revision explicitly allocates the installed enclosure hardware");
  assert.ok(!topology.includes("dse-ventilated-ip65-enclosure"),
    "the undersized owned enclosure is no longer allocated to a device");
  const replacementEnclosure = system.bom.find((item) => item.id === "dse-secondary-enclosure-larger")!;
  assert.equal(replacementEnclosure.location, "Fiji");
  assert.match(replacementEnclosure.procurement, /select and buy/i);
  assert.equal(replacementEnclosure.totalUsd, 0);
  assert.ok(!topology.includes("dse-shirbly-2awg-cable-pairs"),
    "bulk cable inventory remains procurement data rather than a device allocation");
  const mainBusbars = system.bom.find((item) => item.id === "dse-main-busbars")!;
  assert.equal(mainBusbars.item, "Joinfworld 250 A four-stud covered positive/negative main busbar pair");
  assert.equal(mainBusbars.procurement, "Purchased");
  assert.equal(mainBusbars.priority, "Must · selected main buses");
  assert.equal(mainBusbars.totalUsd, 21.55);
  assert.deepEqual(itemInvoices[mainBusbars.id], [41]);
  assert.match(topology, /bomIds: \["dse-main-busbars"\]/);
  const removedBusbars = system.bom.find((item) => item.id === "dse-amomd-600a-busbars-unused")!;
  assert.equal(removedBusbars.location, "Return");
  assert.equal(removedBusbars.includedInTotal, false);
  assert.ok(!imports.some((item) => item.id === removedBusbars.id));
  assert.ok(!topology.includes(removedBusbars.id));
  const tax = system.bom.find((item) => item.id === "dse-us-sales-tax")!;
  assert.equal(tax.totalUsd, 379.24);
});

test("customs descriptions are structured once and CSV mirrors the filing table", () => {
  const normalized = (value = "") => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  assert.ok(Object.values(itemMeta).every((meta) => meta.make && meta.model));
  assert.ok(Object.values(itemMeta).every((meta) => !/\bASIN\b|\bB[A-Z0-9]{9}\b/i.test(
    `${meta.make} ${meta.model} ${meta.additionalInfo ?? ""}`,
  )));
  assert.ok(Object.values(itemMeta).every((meta) => {
    const make = normalized(meta.make);
    const model = normalized(meta.model);
    const additionalInfo = normalized(meta.additionalInfo);
    return !model.includes(make) && !additionalInfo.includes(make) && !additionalInfo.includes(model);
  }));
  const lines = buildCustomsLines(imports, edits, false);
  const csv = buildCustomsCsv(lines, system.currency.fjdPerUsd);
  assert.ok(csv.startsWith('"No.","Make / model","ASIN","Qty","Country of origin","Unit value USD","Total USD","Total FJD","Ref","Serial number(s)"\r\n'));
  assert.match(csv, /"Ubiquiti \/ UniFi Express\nUX-US","—","1 ea"/);
  assert.equal(csv.trimEnd().split("\r\n").length, lines.length + 1);
});

test("return-bound and personal-use goods stay in the BOM but out of project imports", () => {
  const pendingReturnIds = [
    "dse-b125-chtaixi-unused", "dse-battery-string-breakers-midnite-unused", "dse-pv-breakers-32a-rejected",
    "dse-usb-output-breaker", "dse-starlink-portable-battery-cable",
  ];
  const completedOrRefundedReturnIds = [
    "dse-chtai-ac-rcbos-rejected", "dse-ac-30a-rejected", "dse-mppt-wirebox-mc4-rejected",
    "dse-amomd-600a-busbars-unused", "dse-1-0-battery-cables-1ft", "dse-1-0-battery-cables-2ft",
  ];
  for (const id of pendingReturnIds) {
    const row = system.bom.find((item) => item.id === id)!;
    assert.equal(row.location, "Return");
    assert.equal(row.procurement, "Purchased · return pending");
    assert.ok(!imports.some((item) => item.id === id));
  }
  for (const id of completedOrRefundedReturnIds) {
    const row = system.bom.find((item) => item.id === id)!;
    assert.equal(row.location, "Return");
    assert.match(row.procurement, /refund (?:issued|credited)/);
    assert.equal(row.includedInTotal, false);
    assert.ok(!imports.some((item) => item.id === id));
  }
  const decisionIds = [
    "dse-extra-dihool-120a-breaker", "dse-extra-ac-rcbo-pair",
    "dse-kerwinn-shared-services-breaker-alternate",
  ];
  assert.ok(decisionIds.every((id) => {
    const row = system.bom.find((item) => item.id === id)!;
    return row.location === "Return" && row.includedInTotal === false && !imports.some((item) => item.id === id);
  }));
  const refundRows = system.bom.filter((item) => item.id.startsWith("dse-refund-"));
  assert.equal(refundRows.length, 5);
  assert.equal(Math.round(refundRows.reduce((sum, row) => sum + row.totalUsd, 0) * 100) / 100, -324.95);
  assert.ok(refundRows.every((row) => row.procurement === "Purchased · refund issued" && row.includedInTotal === false));
  const personalIds = ["dse-personal-garmin-montana-710i", "dse-personal-flexsolar-panels", "dse-personal-takoci-hx870-batteries"];
  for (const id of personalIds) {
    const row = system.bom.find((item) => item.id === id)!;
    assert.equal(row.location, "Personal baggage");
    assert.equal(row.includedInTotal, false);
    assert.ok(!customs.itemMeta[id as keyof typeof customs.itemMeta]);
  }
  const topology = fs.readFileSync("app/dseTopology.ts", "utf8");
  assert.match(topology, /bomIds: \["dse-router"\]/);
  assert.ok(personalIds.every((id) => !topology.includes(id)));
  assert.ok(["dse-unused-galaxy-s24-pair", "dse-unused-macbook-air-15-m4", "dse-unused-sandisk-portable-ssd"]
    .every((id) => !topology.includes(id)));
});

test("origin data is researched, blank when unresolved, and never stores the US display default", () => {
  const importedMeta = imports.map((item) => itemMeta[item.id]);
  assert.ok(importedMeta.every((meta) => ["2026-08-25", "2026-08-26"].includes(meta.originReviewedOn ?? "")));
  assert.ok(importedMeta.every((meta) => meta.origin === "" || /^[A-Z]{2}$/.test(meta.origin)));
  assert.equal(importedMeta.filter((meta) => Boolean(meta.origin)).length, 16);
  assert.equal(importedMeta.filter((meta) => !meta.origin).length, 65);
  assert.equal("originDisplayDefault" in customs, false);
  assert.equal(customs.itemMeta["dse-multiplus"].origin, "");
  assert.equal(itemMeta["dse-balancers"].defaultCondition, "1 new; 1 used - mint");
  assert.ok(Object.values(itemMeta).every((meta) => meta.originSourceUrl !== ""));
});

test("known equipment serials are prefilled and unknown serials stay blank", () => {
  assert.equal(itemMeta["dse-router"].defaultSerials, "942A6F249E89");
  assert.equal(itemMeta["dse-ekrano-gx"].defaultSerials, "HQ2509RURDF");
  assert.equal(itemMeta["dse-orion-usb-converter"].defaultSerials, "HQ2524CKDAW");
  assert.equal(itemMeta["dse-smartsolar"].defaultSerials, "HQ2522V4MVF");
  assert.equal(itemMeta["dse-unused-galaxy-s24-pair"].defaultSerials,
    "RFCWC04EX2V (IMEI 1: 353690625019873; IMEI 2: 354376945019871); RFCWCOXMNKK (IMEI 1: 353690625388534; IMEI 2: 354376945388532)");
  assert.equal(itemMeta["dse-unused-macbook-air-15-m4"].defaultSerials,
    "LKQVK4R7LF; Wi-Fi MAC: 1c:f6:4c:a8:14:70");
  assert.equal(itemMeta["dse-shunt"].defaultSerials, "HQ2301TYFRT");
  assert.equal(itemMeta["dse-ex-starlink"].defaultSerials, "");
});

test("shipping treemap covers every imported physical row with area proportional to mass", () => {
  const weighted = (imports as ShippingBomItem[]).map((item) => ({
    ...item, totalWeightKg: Number(item.totalWeightKg), shippingGroup: shippingGroupFor(item.category),
  }));
  const tiles = buildWeightTreemap(weighted);
  assert.equal(tiles.length, imports.length);
  const totalMass = weighted.reduce((sum, item) => sum + item.totalWeightKg, 0);
  const totalArea = tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
  assert.ok(Math.abs(totalArea - 10_000) < 0.001);
  for (const tile of tiles) {
    const actual = tile.width * tile.height / 10_000;
    const expected = tile.item.totalWeightKg / totalMass;
    assert.ok(Math.abs(actual - expected) < 1e-10);
  }
});

test("cost treemap covers every positive-cost BOM row with area proportional to USD value", () => {
  const costed = costTreemapItems(system.bom as CostBomItem[]);
  const tiles = buildCostTreemap(costed);
  assert.equal(costed.length, 120);
  assert.equal(tiles.length, costed.length);
  assert.ok(costed.every((item) => item.totalUsd > 0));
  assert.ok(costed.some((item) => item.costScope === "Solar + internet"));
  assert.ok(costed.some((item) => item.costScope === "Additional purchases"));
  assert.ok(costed.some((item) => item.costScope === "Excluded / returns"));
  assert.deepEqual(Object.fromEntries(([
    "Solar + internet", "Additional purchases", "Excluded / returns",
  ] as const).map((scope) => {
    const subset = filterCostTreemapItems(costed, scope);
    return [scope, { rows: subset.length, total: Math.round(subset.reduce((sum, item) => sum + item.totalUsd, 0) * 100) / 100 }];
  })), {
    "Solar + internet": { rows: 96, total: 10_654.71 },
    "Additional purchases": { rows: 10, total: 3_348.22 },
    "Excluded / returns": { rows: 14, total: 572.12 },
  });
  const totalCost = costed.reduce((sum, item) => sum + item.totalUsd, 0);
  assert.ok(Math.abs(totalCost - 14_575.05) < 0.001);
  const totalArea = tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
  assert.ok(Math.abs(totalArea - 10_000) < 0.001);
  for (const tile of tiles) {
    const actual = tile.width * tile.height / 10_000;
    const expected = tile.item.totalUsd / totalCost;
    assert.ok(Math.abs(actual - expected) < 1e-10);
  }
});

test("obsolete enclosure placeholders are removed while the selected PV enclosure remains documented", () => {
  const bomById = new Map(system.bom.map((item) => [item.id, item]));
  const pv = bomById.get("dse-pv-protection")!;

  assert.equal(bomById.has("dse-junction-box"), false);
  assert.equal(bomById.has("dse-ac-install-enclosure"), false);
  assert.equal(itemMeta["dse-junction-box"], undefined);
  assert.equal(itemMeta["dse-ac-install-enclosure"], undefined);
  assert.match(pv.description, /320 × 280 × 150 mm/);
  assert.match(pv.description, /four active bottom-row glands/);
  assert.equal(pv.procurement, "Purchased");
});

test("receipt ZIP creation is portable to public checkouts and rejects unsafe files", () => {
  assert.equal(privateModeEnabled({}), false);
  assert.equal(privateModeEnabled({ DSE_PRIVATE_MODE: "1" }), true);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dse-receipts-test-"));
  const privateRoot = path.join(fixtureRoot, "private");
  fs.mkdirSync(privateRoot);
  try {
    const filenames = ["amazon-2026-08-24-order-111-test.pdf", "home-depot-2026-08-23-order-test.pdf"];
    const references = [
      { number: 7, filename: filenames[0] },
      { number: 12, filename: filenames[1] },
    ];
    for (const filename of filenames) fs.writeFileSync(path.join(privateRoot, filename), Buffer.from("%PDF-1.4\n% test receipt\n"));
    fs.writeFileSync(path.join(privateRoot, "ignored.txt"), "not a receipt");
    assert.deepEqual([...receiptAllowlist(privateRoot)], filenames);
    const archive = loadReceiptArchive(privateRoot, references);
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    assert.equal(archive.readUInt16LE(archive.length - 12), filenames.length);
    assert.deepEqual(storedZipEntryNames(archive), [
      `07-${filenames[0]}`,
      `12-${filenames[1]}`,
    ]);
    assert.equal(receiptZipFilename("amazon-2026-08-24-order-111-test-status-update.pdf", references),
      "07-amazon-2026-08-24-order-111-test-status-update.pdf");
    assert.throws(() => receiptZipFilename("unindexed-receipt.pdf", references), /No public receipt reference/);

    const unsafeName = path.join(privateRoot, "unsafe receipt.pdf");
    fs.writeFileSync(unsafeName, Buffer.from("%PDF-1.4\n"));
    assert.throws(() => receiptAllowlist(privateRoot), /Unsafe private receipt filename/);
    fs.unlinkSync(unsafeName);

    const outsidePdf = path.join(fixtureRoot, "outside.pdf");
    fs.writeFileSync(outsidePdf, Buffer.from("%PDF-1.4\n"));
    fs.symlinkSync(outsidePdf, path.join(privateRoot, "escape.pdf"));
    assert.throws(() => loadReceiptArchive(privateRoot, references), /Receipt symlink escaped private root/);
    assert.equal(createStoredZip([]).readUInt32LE(0), 0x06054b50);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("receipt endpoints are unavailable publicly", async () => {
  const previous = process.env.DSE_PRIVATE_MODE;
  try {
    delete process.env.DSE_PRIVATE_MODE;
    assert.equal((await getReceiptStatus()).status, 404);
    assert.equal((await downloadReceipts()).status, 404);
  } finally {
    if (previous === undefined) delete process.env.DSE_PRIVATE_MODE;
    else process.env.DSE_PRIVATE_MODE = previous;
  }
});

const localPrivateRoot = path.resolve("private");
test("private receipt endpoint includes every archived PDF", { skip: !fs.existsSync(localPrivateRoot) }, async () => {
  const previous = process.env.DSE_PRIVATE_MODE;
  try {
    const pdfCount = fs.readdirSync(localPrivateRoot).filter((name) => name.toLowerCase().endsWith(".pdf")).length;
    assert.equal(receiptAllowlist(localPrivateRoot).size, pdfCount);
    assert.ok(pdfCount >= receipts.invoices.length);
    const localArchive = loadReceiptArchive(localPrivateRoot);
    assert.equal(localArchive.readUInt16LE(localArchive.length - 12), pdfCount);
    const localEntryNames = storedZipEntryNames(localArchive);
    assert.equal(localEntryNames.length, pdfCount);
    assert.ok(localEntryNames.every((name) => /^\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/.test(name)));
    assert.ok(receipts.invoices.every((invoice) => localEntryNames.includes(
      `${String(invoice.number).padStart(2, "0")}-${invoice.filename}`,
    )));

    process.env.DSE_PRIVATE_MODE = "1";
    assert.equal((await getReceiptStatus()).status, 200);
    const response = await downloadReceipts();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/zip");
    assert.equal(response.headers.get("X-Receipt-Count"), String(pdfCount));
    assert.deepEqual(storedZipEntryNames(Buffer.from(await response.arrayBuffer())), localEntryNames);
  } finally {
    if (previous === undefined) delete process.env.DSE_PRIVATE_MODE;
    else process.env.DSE_PRIVATE_MODE = previous;
  }
});

test("customs presentation has no mass, bag/case or condition columns", () => {
  const source = fs.readFileSync("app/CustomsView.tsx", "utf8");
  const css = fs.readFileSync("app/globals.css", "utf8");
  const headings = [...source.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);
  assert.ok(!headings.some((heading) => /weight|bag|case|condition/i.test(heading)));
  assert.ok(headings.includes("ASIN"));
  assert.ok(headings.includes("Make / model"));
  assert.ok(headings.includes("Ref"));
  assert.ok(source.includes("Invoice / receipt references"));
  assert.ok(source.includes("Export CSV"));
  assert.ok(source.includes('className="customs-fjd-column">Total FJD'));
  assert.ok(source.includes('className="customs-serial-column">Serial number(s)'));
  assert.match(css, /\.customs-serial-column\s*\{\s*display: none;/);
  assert.ok(source.includes("customs-export-excluded"));
  assert.ok(!source.includes("Passport number"));
  assert.ok(!source.includes("Concession approval reference"));
  assert.ok(!source.includes("TAF permit reference(s)"));
  assert.match(css, /\.customs-table td\s*\{[\s\S]*?border-bottom: 1px solid/);
  assert.doesNotMatch(css, /\.customs-table tbody td:nth-child\(4\)[\s\S]{0,180}border-bottom-color:\s*transparent/);
  assert.match(css, /\.customs-table tbody td:nth-child\(4\) input,[\s\S]*?nth-child\(6\) input\s*\{\s*border-bottom:\s*0;/);
  const asinRule = css.match(/\.customs-asin-cell\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(asinRule);
  assert.doesNotMatch(asinRule, /font-size/);
});
