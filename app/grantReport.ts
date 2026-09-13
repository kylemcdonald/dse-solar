export type GrantReportCurrency = "USD" | "FJD";
export type GrantReportScope = "solar-system" | "outside-scope";

export type GrantReportAllocation = {
  recipientOrganization: string;
  location?: string;
  qty: number;
  amountUsd: number;
  note: string;
};

export type GrantReportBomItem = {
  id: string;
  item: string;
  qty: number;
  unit: string;
  unitCost: number;
  currency: string;
  sourceTotal?: number;
  totalUsd: number;
  procurement: string;
  category?: string;
  accountingGroup?: string;
  grantScope?: GrantReportScope;
  grantSection?: string;
  grantAllocations?: GrantReportAllocation[];
  grantFundingSource?: string;
  grantFundingAmountUsd?: number;
  grantFundingTreatment?: string;
  grantPaymentNote?: string;
};

export type GrantReportInvoice = {
  number: number;
  date: string;
  supplier: string;
  filename: string;
  kind?: string;
  reference?: string;
};

export type GrantReportReceiptIndex = {
  invoices: GrantReportInvoice[];
  itemInvoices: Record<string, number[]>;
};

export type GrantReportSectionId = "fiji" | "solar" | "customs" | "outside";

export type GrantReportEvidence = Pick<GrantReportInvoice, "number" | "supplier" | "kind" | "reference">;

export type GrantReportLine = {
  id: string;
  item: string;
  qty: number;
  unit: string;
  sourceCurrency: GrantReportCurrency;
  sourceAmount: number;
  costUsd: number;
  receiptRefs: number[];
  evidence: GrantReportEvidence[];
  scope: GrantReportScope;
  allocations: GrantReportAllocation[];
  note?: string;
};

export type GrantReportSection = {
  id: GrantReportSectionId;
  title: string;
  lines: GrantReportLine[];
  subtotalUsd: number;
};

export type GrantPurchaseReport = {
  title: string;
  generatedDate: string;
  generatedDateLabel: string;
  explanation: string;
  sections: GrantReportSection[];
  fijiPurchasesSourceFjd: number;
  fijiPurchasesSubtotalUsd: number;
  iyoyioPurchasesSubtotalUsd: number;
  solarSystemSubtotalUsd: number;
  outsideScopeSubtotalUsd: number;
  inowonAllocationUsd: number;
  iyoyioCheckAmountUsd: number;
  iyoyioCheckBalanceUsd: number;
  grandTotalUsd: number;
  costReconciliation: {
    positiveTotalUsd: number;
    omittedPositiveTotalUsd: number;
    creditsUsd: number;
    omittedLines: Array<{ id: string; item: string; costUsd: number; reason: string }>;
  };
};

const CUSTOMS_IDS = new Set(["dse-customs-vat", "dse-customs-agent-costs"]);
const IYOIYO_CHECK_AMOUNT_USD = 8_000;

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const subtotal = (lines: readonly GrantReportLine[]) => roundMoney(lines.reduce((sum, line) => sum + line.costUsd, 0));
const byDescendingCost = (lines: readonly GrantReportLine[]) => [...lines].sort((first, second) =>
  second.costUsd - first.costUsd || first.item.localeCompare(second.item));

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sourceAmountFor(item: GrantReportBomItem) {
  if (Number.isFinite(item.sourceTotal)) return roundMoney(item.sourceTotal!);
  return item.currency === "FJD" ? roundMoney(item.unitCost * item.qty) : item.totalUsd;
}

function scopeFor(item: GrantReportBomItem): GrantReportScope {
  if (item.grantScope) return item.grantScope;
  return item.accountingGroup === "additional" ? "outside-scope" : "solar-system";
}

function lineFor(
  item: GrantReportBomItem,
  evidence: readonly GrantReportEvidence[],
): GrantReportLine {
  const fundingNote = item.grantFundingSource
    ? `Funding attribution: ${item.grantFundingSource}; remains included in IYOIYO purchases.`
    : undefined;
  const allocations = item.grantAllocations ?? [];
  const note = [item.grantPaymentNote, fundingNote, ...allocations.map((allocation) => allocation.note)].filter(Boolean).join(" ") || undefined;
  const sortedEvidence = [...new Map(evidence.map((entry) => [entry.number, entry])).values()]
    .sort((first, second) => first.number - second.number);
  return {
    id: item.id,
    item: item.item,
    qty: item.qty,
    unit: item.unit,
    sourceCurrency: item.currency === "FJD" ? "FJD" : "USD",
    sourceAmount: sourceAmountFor(item),
    costUsd: item.totalUsd,
    receiptRefs: sortedEvidence.map((entry) => entry.number),
    evidence: sortedEvidence,
    scope: scopeFor(item),
    allocations,
    note,
  };
}

export function buildGrantPurchaseReport(
  bom: readonly GrantReportBomItem[],
  receipts: GrantReportReceiptIndex,
  generatedAt = new Date(),
): GrantPurchaseReport {
  const itemById = new Map(bom.map((item) => [item.id, item]));
  const invoiceByNumber = new Map(receipts.invoices.map((invoice) => [invoice.number, invoice]));
  const evidenceFor = (id: string): GrantReportEvidence[] => [...new Set(receipts.itemInvoices[id] ?? [])]
    .map((number) => invoiceByNumber.get(number))
    .filter((invoice): invoice is GrantReportInvoice => Boolean(invoice))
    .map(({ number, supplier, kind, reference }) => ({ number, supplier, kind, reference }));
  const eligible = bom
    .filter((item) => item.procurement.includes("Purchased"))
    .filter((item) => Number.isFinite(item.totalUsd) && item.totalUsd !== 0)
    .flatMap((item) => {
      const evidence = evidenceFor(item.id);
      return evidence.length ? [lineFor(item, evidence)] : [];
    });

  const outsideLines = byDescendingCost(eligible.filter((line) => line.scope === "outside-scope"));
  const fijiLines = byDescendingCost(eligible.filter((line) => line.scope === "solar-system"
    && itemById.get(line.id)?.grantSection === "fiji"));
  const customsLines = byDescendingCost(eligible.filter((line) => line.scope === "solar-system"
    && CUSTOMS_IDS.has(line.id)));
  const assigned = new Set([...fijiLines, ...customsLines, ...outsideLines].map((line) => line.id));
  const solarLines = byDescendingCost(eligible.filter((line) => !assigned.has(line.id)));

  const sections: GrantReportSection[] = [
    { id: "fiji", title: "On-site Fiji purchases", lines: fijiLines, subtotalUsd: subtotal(fijiLines) },
    { id: "solar", title: "Other solar-system purchases", lines: solarLines, subtotalUsd: subtotal(solarLines) },
    { id: "customs", title: "Fiji customs and clearance costs", lines: customsLines, subtotalUsd: subtotal(customsLines) },
    { id: "outside", title: "Outside-scope purchases", lines: outsideLines, subtotalUsd: subtotal(outsideLines) },
  ];
  const reportLines = sections.flatMap((section) => section.lines);
  const iyoyioPurchasesSubtotalUsd = subtotal(reportLines);
  const solarSystemSubtotalUsd = subtotal(reportLines.filter((line) => line.scope === "solar-system"));
  const outsideScopeSubtotalUsd = subtotal(reportLines.filter((line) => line.scope === "outside-scope"));
  const inowonAllocationUsd = roundMoney(reportLines.flatMap((line) => line.allocations)
    .filter((allocation) => allocation.recipientOrganization === "Inowon")
    .reduce((sum, allocation) => sum + allocation.amountUsd, 0));
  const iyoyioCheckBalanceUsd = roundMoney(IYOIYO_CHECK_AMOUNT_USD - iyoyioPurchasesSubtotalUsd);
  const reportedIds = new Set(reportLines.map((line) => line.id));
  const positiveItems = bom.filter((item) => Number.isFinite(item.totalUsd) && item.totalUsd > 0);
  const omittedLines = positiveItems.filter((item) => !reportedIds.has(item.id))
    .map((item) => ({
      id: item.id, item: item.item, costUsd: item.totalUsd,
      reason: !item.procurement.includes("Purchased")
        ? `Not recorded as a completed purchase: ${item.procurement}`
        : "Purchase recorded; supporting receipt is missing",
    })).sort((first, second) => second.costUsd - first.costUsd || first.item.localeCompare(second.item));

  return {
    title: "DSE Grant Purchase Report",
    generatedDate: localIsoDate(generatedAt),
    generatedDateLabel: new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "long", day: "numeric",
    }).format(generatedAt),
    explanation: "All documented purchase and customs costs in this report were paid by IYOIYO. The final summary separates solar-system costs from explicitly outside-scope purchases. Shared order-level charges and customs costs without item-level allocations remain with the solar-system total. One of two SSDs and one of two SD card readers are allocated to Inowon in Polowat at their documented item prices.",
    sections,
    fijiPurchasesSourceFjd: roundMoney(fijiLines.reduce((sum, line) => sum +
      (line.sourceCurrency === "FJD" ? line.sourceAmount : 0), 0)),
    fijiPurchasesSubtotalUsd: subtotal(fijiLines),
    iyoyioPurchasesSubtotalUsd,
    solarSystemSubtotalUsd,
    outsideScopeSubtotalUsd,
    inowonAllocationUsd,
    iyoyioCheckAmountUsd: IYOIYO_CHECK_AMOUNT_USD,
    iyoyioCheckBalanceUsd,
    grandTotalUsd: iyoyioPurchasesSubtotalUsd,
    costReconciliation: {
      positiveTotalUsd: roundMoney(positiveItems.reduce((sum, item) => sum + item.totalUsd, 0)),
      omittedPositiveTotalUsd: roundMoney(omittedLines.reduce((sum, line) => sum + line.costUsd, 0)),
      creditsUsd: -subtotal(reportLines.filter((line) => line.costUsd < 0)),
      omittedLines,
    },
  };
}

export function compactReceiptReferences(receiptRefs: readonly number[]) {
  const refs = [...new Set(receiptRefs)].sort((first, second) => first - second);
  const ranges: string[] = [];
  for (let index = 0; index < refs.length;) {
    const start = refs[index];
    let end = start;
    while (index + 1 < refs.length && refs[index + 1] === end + 1) {
      index += 1;
      end = refs[index];
    }
    ranges.push(start === end ? `#${start}` : `#${start}-${end}`);
    index += 1;
  }
  return ranges.join(", ");
}

export function describeEvidence(evidence: readonly GrantReportEvidence[]) {
  return evidence.map((entry) => {
    const kind = entry.kind ?? "Receipt";
    const reference = entry.reference ? ` ${entry.reference}` : "";
    return `#${entry.number} ${kind}${reference} (${entry.supplier})`;
  }).join("; ");
}

function compactPdfEvidence(line: GrantReportLine) {
  if (!line.evidence.some((entry) => entry.kind)) return compactReceiptReferences(line.receiptRefs);
  return line.evidence.map((entry) => {
    const kind = entry.kind === "Payment confirmation" ? "P"
      : entry.kind === "Tax invoice" ? "Inv"
        : entry.kind === "Quote" ? "Q" : "R";
    return `#${entry.number} ${kind}`;
  }).join(" + ");
}

const usdMoney = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;
const sourceMoney = (currency: GrantReportCurrency, value: number) => currency === "FJD"
  ? `FJD ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : usdMoney(value);

type CsvValue = string | number;
const CSV_COLUMN_COUNT = 10;
const csvCell = (value: CsvValue) => {
  const text = String(value);
  if (!text) return "";
  if (typeof value === "number" || /^-?\d+(?:\.\d+)?$/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
};

function singleSourceCurrency(lines: readonly GrantReportLine[]) {
  const currencies = new Set(lines.map((line) => line.sourceCurrency));
  return currencies.size === 1 ? lines[0]?.sourceCurrency : undefined;
}

export function createGrantReportCsv(report: GrantPurchaseReport) {
  const rows: CsvValue[][] = [
    ["Report", report.title],
    ["Generated date", report.generatedDate],
    ["Basis", report.explanation],
    [],
    ["Row type", "Section", "Item", "Quantity", "Unit", "Evidence", "Original currency", "Original amount", "USD equivalent", "Note"],
  ];

  for (const section of report.sections) {
    rows.push(["Section", section.title]);
    for (const line of section.lines) {
      rows.push([
        "Item", section.title, line.item, line.qty, line.unit, describeEvidence(line.evidence),
        line.sourceCurrency, line.sourceAmount.toFixed(2), line.costUsd.toFixed(2), line.note ?? "",
      ]);
    }
    const sourceCurrency = singleSourceCurrency(section.lines);
    const sourceSubtotal = sourceCurrency
      ? roundMoney(section.lines.reduce((sum, line) => sum + line.sourceAmount, 0)).toFixed(2)
      : "";
    rows.push(["Section subtotal", section.title, `${section.title} subtotal`, "", "", "",
      sourceCurrency ?? "", sourceSubtotal, section.subtotalUsd.toFixed(2)]);
    rows.push([]);
  }

  const checkBalanceNote = report.iyoyioCheckBalanceUsd >= 0
    ? `${usdMoney(report.iyoyioCheckBalanceUsd)} remains from the ${usdMoney(report.iyoyioCheckAmountUsd)} PTS advance`
    : `${usdMoney(Math.abs(report.iyoyioCheckBalanceUsd))} paid by IYOIYO beyond the ${usdMoney(report.iyoyioCheckAmountUsd)} PTS advance`;
  rows.push(
    ["Source reconciliation", "Funding summary", "Verified on-site Fiji purchases", "", "",
      compactReceiptReferences(report.sections.filter((section) => section.id === "fiji")
        .flatMap((section) => section.lines.flatMap((line) => line.receiptRefs))),
      "FJD", report.fijiPurchasesSourceFjd.toFixed(2), report.fijiPurchasesSubtotalUsd.toFixed(2),
      "Original FJD amounts retained; USD uses documented bank debits where available, otherwise the retained 2.20 FJD/USD accounting rate"],
    ["Purchase subtotal", "Funding summary", "All purchases paid by IYOIYO", "", "", "", "", "",
      report.iyoyioPurchasesSubtotalUsd.toFixed(2)],
    ["Funding advance", "Funding summary", "Pacific Traditions Society advance", "", "", "", "USD",
      report.iyoyioCheckAmountUsd.toFixed(2), report.iyoyioCheckAmountUsd.toFixed(2)],
    ["Funding balance", "Funding summary", "PTS advance less IYOIYO purchases", "", "", "", "USD",
      report.iyoyioCheckBalanceUsd.toFixed(2), report.iyoyioCheckBalanceUsd.toFixed(2), checkBalanceNote],
    [],
    ["Scope subtotal", "Purchase scope summary", "Solar system", "", "", "", "", "",
      report.solarSystemSubtotalUsd.toFixed(2), "Includes shared order-level charges and customs costs that lack item-level scope allocations"],
    ["Scope subtotal", "Purchase scope summary", "Outside scope", "", "", "", "", "",
      report.outsideScopeSubtotalUsd.toFixed(2), "Includes dedicated outside-scope sales-tax and promotion adjustments"],
    ["Allocation detail", "Purchase scope summary", "Inowon in Polowat", "", "", "", "", "",
      report.inowonAllocationUsd.toFixed(2), "Included in outside scope: one SSD and one SD card reader at documented item prices; shared charges remain unallocated"],
    ["Grand total", "Purchase scope summary", "COMBINED TOTAL", "", "", "", "", "",
      report.grandTotalUsd.toFixed(2)],
  );
  const reconciliation = report.costReconciliation;
  rows.push([], ["Reconciliation", "Cost chart to grant report", "All positive item value", "", "", "", "", "",
    reconciliation.positiveTotalUsd.toFixed(2)]);
  for (const line of reconciliation.omittedLines) {
    rows.push(["Excluded from report", "Cost chart to grant report", line.item, "", "", "", "", "",
      (-line.costUsd).toFixed(2), line.reason]);
  }
  rows.push(
    ["Reconciliation", "Cost chart to grant report", "Refunds and promotions included in report", "", "", "", "", "",
      (-reconciliation.creditsUsd).toFixed(2)],
    ["Reconciliation", "Cost chart to grant report", "IYOIYO net expenses", "", "", "", "", "",
      report.grandTotalUsd.toFixed(2)],
  );

  const encodeRow = (row: readonly CsvValue[]) => Array.from(
    { length: CSV_COLUMN_COUNT }, (_, index) => csvCell(row[index] ?? ""),
  ).join(",");
  return `\uFEFF${rows.map(encodeRow).join("\r\n")}\r\n`;
}

const ascii = (value: string) => value
  .replaceAll("→", "->")
  .replaceAll("×", "x")
  .replace(/[–—]/g, "-")
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, "\"")
  .replaceAll("·", "-")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\x20-\x7e]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const escapePdfText = (value: string) => ascii(value).replace(/([\\()])/g, "\\$1");

function wrapText(value: string, maximumCharacters: number) {
  const words = ascii(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maximumCharacters) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

type PdfPage = { commands: string[] };

const pdfText = (text: string, x: number, y: number, size: number, bold = false, color = "0.16 0.21 0.20") =>
  `BT /${bold ? "F2" : "F1"} ${size.toFixed(1)} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`;
const pdfLine = (x1: number, y1: number, x2: number, y2: number, color = "0.82 0.84 0.81", width = 0.5) =>
  `q ${color} RG ${width.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`;
const pdfRect = (x: number, y: number, width: number, height: number, color: string) =>
  `q ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f Q`;

function reportPages(report: GrantPurchaseReport) {
  const pages: PdfPage[] = [];
  let page: PdfPage = { commands: [] };
  let y = 0;

  const startPage = (firstPage = false) => {
    page = { commands: [] };
    pages.push(page);
    if (firstPage) {
      page.commands.push(pdfText(report.title, 48, 748, 20, true, "0.08 0.28 0.29"));
      page.commands.push(pdfText("Funding reconciliation & purchase ledger", 48, 726, 10, true, "0.38 0.43 0.41"));
      page.commands.push(pdfText(`Generated ${report.generatedDateLabel}`, 422, 748, 8, false, "0.38 0.43 0.41"));
      wrapText(report.explanation, 110).forEach((line, index) =>
        page.commands.push(pdfText(line, 48, 700 - index * 10, 8.2, false, "0.30 0.35 0.34")));

      const cards = [
        ["IYOIYO PAID", usdMoney(report.iyoyioPurchasesSubtotalUsd)],
        ["PTS ADVANCE", usdMoney(report.iyoyioCheckAmountUsd)],
        [report.iyoyioCheckBalanceUsd < 0 ? "IYOIYO ABOVE ADVANCE" : "ADVANCE REMAINING",
          usdMoney(Math.abs(report.iyoyioCheckBalanceUsd))],
      ] as const;
      cards.forEach(([label, value], index) => {
        const x = 48 + index * 176;
        page.commands.push(pdfRect(x, 590, 164, 54, index === 2 ? "0.10 0.32 0.33" : "0.91 0.94 0.92"));
        page.commands.push(pdfText(label, x + 10, 626, 7.2, true, index === 2 ? "0.84 0.94 0.91" : "0.35 0.43 0.41"));
        page.commands.push(pdfText(value, x + 10, 604, 14, true, index === 2 ? "1 1 1" : "0.08 0.28 0.29"));
      });
      page.commands.push(pdfRect(48, 520, 516, 54, "0.96 0.92 0.82"));
      page.commands.push(pdfText("VERIFIED FIJI SOURCE TOTAL", 59, 555, 7.2, true, "0.43 0.35 0.18"));
      page.commands.push(pdfText(sourceMoney("FJD", report.fijiPurchasesSourceFjd), 59, 535, 13, true, "0.30 0.28 0.20"));
      page.commands.push(pdfText(`${usdMoney(report.fijiPurchasesSubtotalUsd)} USD accounting total`, 250, 541, 8.2, false, "0.30 0.28 0.20"));
      page.commands.push(pdfText("Actual bank debits where documented; otherwise 2.20 FJD/USD", 250, 529, 7, false, "0.30 0.28 0.20"));
      y = 496;
    } else {
      page.commands.push(pdfText(`${report.title} - purchase ledger`, 48, 748, 10, true, "0.08 0.28 0.29"));
      page.commands.push(pdfLine(48, 738, 564, 738, "0.46 0.61 0.59", 0.8));
      y = 720;
    }
  };

  const ensureSpace = (height: number) => {
    if (y - height >= 50) return false;
    startPage();
    return true;
  };

  const tableHeader = () => {
    page.commands.push(pdfRect(48, y - 18, 516, 18, "0.91 0.94 0.92"));
    page.commands.push(pdfText("ITEM", 54, y - 12, 6.7, true, "0.25 0.34 0.32"));
    page.commands.push(pdfText("EVIDENCE", 334, y - 12, 6.7, true, "0.25 0.34 0.32"));
    page.commands.push(pdfText("ORIGINAL", 420, y - 12, 6.7, true, "0.25 0.34 0.32"));
    page.commands.push(pdfText("USD", 540, y - 12, 6.7, true, "0.25 0.34 0.32"));
    y -= 18;
  };

  startPage(true);
  for (const section of report.sections) {
    ensureSpace(60);
    page.commands.push(pdfRect(48, y - 24, 516, 24, "0.10 0.32 0.33"));
    page.commands.push(pdfText(section.title, 55, y - 16, 9.5, true, "1 1 1"));
    const sectionTotal = usdMoney(section.subtotalUsd);
    page.commands.push(pdfText(sectionTotal, 556 - sectionTotal.length * 4.6, y - 16, 9, true, "1 1 1"));
    y -= 30;
    tableHeader();

    for (const line of section.lines) {
      const itemLines = wrapText(`${line.qty} ${line.unit} - ${line.item}`, 56);
      const noteLines = !line.note ? [] : wrapText(line.note, 70);
      const evidenceLines = wrapText(compactPdfEvidence(line), 17);
      const originalLines = wrapText(sourceMoney(line.sourceCurrency, line.sourceAmount), 18);
      const rowHeight = Math.max(itemLines.length + noteLines.length, evidenceLines.length, originalLines.length) * 8.5 + 9;
      if (ensureSpace(rowHeight + 25)) {
        page.commands.push(pdfText(`${section.title} - continued`, 48, y, 9, true, "0.08 0.28 0.29"));
        y -= 15;
        tableHeader();
      }
      const textY = y - 12;
      itemLines.forEach((text, index) => page.commands.push(pdfText(text, 54, textY - index * 8.5, 7.4)));
      noteLines.forEach((text, index) => page.commands.push(pdfText(text, 54,
        textY - (itemLines.length + index) * 8.5, 6.2, false, "0.42 0.46 0.44")));
      evidenceLines.forEach((text, index) => page.commands.push(pdfText(text, 334, textY - index * 8.5, 7.2, false, "0.31 0.39 0.37")));
      originalLines.forEach((text, index) => page.commands.push(pdfText(text, 420, textY - index * 8.5, 7.1)));
      const cost = usdMoney(line.costUsd);
      page.commands.push(pdfText(cost, 558 - cost.length * 3.8, textY, 7.2, true));
      y -= rowHeight;
      page.commands.push(pdfLine(48, y, 564, y));
    }
    y -= 14;
  }

  ensureSpace(282);
  page.commands.push(pdfLine(48, y, 564, y, "0.10 0.32 0.33", 1.1));
  y -= 24;
  page.commands.push(pdfText("FUNDING RECONCILIATION", 48, y, 9, true, "0.08 0.28 0.29"));
  y -= 25;
  const fundingRows: Array<[string, string, string?]> = [
    ["Purchases paid by IYOIYO", usdMoney(report.iyoyioPurchasesSubtotalUsd)],
    ["Pacific Traditions Society advance", `(${usdMoney(report.iyoyioCheckAmountUsd)})`],
    [report.iyoyioCheckBalanceUsd < 0 ? "IYOIYO paid beyond PTS advance" : "PTS advance remaining",
      usdMoney(Math.abs(report.iyoyioCheckBalanceUsd)), report.iyoyioCheckBalanceUsd < 0 ? "overage" : "balance"],
  ];
  fundingRows.forEach(([label, value, detail], index) => {
    const rowY = y - index * 24;
    page.commands.push(pdfText(label, 54, rowY, index === 2 ? 8.7 : 8, index === 2));
    if (detail) page.commands.push(pdfText(detail, 275, rowY, 6.5, false, "0.42 0.46 0.44"));
    page.commands.push(pdfText(value, 558 - value.length * 4.3, rowY, index === 2 ? 9 : 8, true));
  });
  y -= fundingRows.length * 24 + 18;
  page.commands.push(pdfLine(48, y, 564, y, "0.46 0.61 0.59", 0.8));
  y -= 24;
  page.commands.push(pdfText("PURCHASE SCOPE SUMMARY", 48, y, 9, true, "0.08 0.28 0.29"));
  y -= 25;
  const scopeRows: Array<[string, string, string?]> = [
    ["Solar system", usdMoney(report.solarSystemSubtotalUsd), "includes shared/unallocated project costs"],
    ["Outside scope", usdMoney(report.outsideScopeSubtotalUsd)],
    ["of which Inowon in Polowat", usdMoney(report.inowonAllocationUsd), "included; item prices only"],
  ];
  scopeRows.forEach(([label, value, detail], index) => {
    const rowY = y - index * 24;
    page.commands.push(pdfText(label, 54, rowY, index < 2 ? 8.7 : 7.6, index < 2));
    if (detail) page.commands.push(pdfText(detail, 230, rowY, 6.5, false, "0.42 0.46 0.44"));
    page.commands.push(pdfText(value, 558 - value.length * 4.3, rowY, index < 2 ? 9 : 8, true));
  });
  y -= scopeRows.length * 24 + 8;
  page.commands.push(pdfRect(48, y - 36, 516, 36, "0.10 0.32 0.33"));
  page.commands.push(pdfText("COMBINED TOTAL", 58, y - 23, 10.5, true, "1 1 1"));
  const grandTotal = usdMoney(report.grandTotalUsd);
  page.commands.push(pdfText(grandTotal, 556 - grandTotal.length * 6, y - 23, 11.5, true, "1 1 1"));

  y -= 62;
  ensureSpace(90);
  page.commands.push(pdfText("COST CHART TO GRANT REPORT", 48, y, 9, true, "0.08 0.28 0.29"));
  y -= 22;
  const reconciliation = report.costReconciliation;
  const reconciliationRows: Array<[string, number]> = [
    ["All positive item value", reconciliation.positiveTotalUsd],
    ["Less items not recorded as supported purchases", -reconciliation.omittedPositiveTotalUsd],
    ["Less refunds and promotions", -reconciliation.creditsUsd],
    ["IYOIYO net expenses", report.grandTotalUsd],
  ];
  for (const [label, amount] of reconciliationRows) {
    ensureSpace(22);
    page.commands.push(pdfText(label, 54, y, 8));
    const value = usdMoney(amount);
    page.commands.push(pdfText(value, 558 - value.length * 4.3, y, 8, true));
    y -= 22;
  }
  for (const line of reconciliation.omittedLines) {
    const lines = wrapText(`${usdMoney(line.costUsd)} - ${line.item}. ${line.reason}.`, 108);
    ensureSpace(lines.length * 10 + 6);
    lines.forEach((text) => {
      page.commands.push(pdfText(text, 54, y, 7, false, "0.42 0.46 0.44"));
      y -= 10;
    });
    y -= 6;
  }

  pages.forEach((currentPage, index) => {
    currentPage.commands.push(pdfLine(48, 40, 564, 40, "0.82 0.84 0.81", 0.4));
    currentPage.commands.push(pdfText(`DSE Grant Purchase Report | Page ${index + 1} of ${pages.length}`, 48, 25, 7, false, "0.48 0.52 0.50"));
  });
  return pages;
}

export function createGrantReportPdf(report: GrantPurchaseReport) {
  const pages = reportPages(report);
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  const infoObjectId = 5 + pages.length * 2;
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((currentPage, index) => {
    const pageObjectId = pageObjectIds[index];
    const contentObjectId = pageObjectId + 1;
    const content = `${currentPage.commands.join("\n")}\n`;
    const contentLength = new TextEncoder().encode(content).length;
    objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId] = `<< /Length ${contentLength} >>\nstream\n${content}endstream`;
  });
  objects[infoObjectId] = `<< /Title (${escapePdfText(report.title)}) /Subject (Grant purchase and funding reconciliation) /CreationDate (D:${report.generatedDate.replaceAll("-", "")}000000) >>`;

  const encoder = new TextEncoder();
  let pdf = "%PDF-1.4\n% DSE grant purchase report\n";
  const offsets = new Array(objects.length).fill(0);
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = encoder.encode(pdf).length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
}

export const grantReportFilename = (report: Pick<GrantPurchaseReport, "generatedDate">) =>
  `dse-grant-purchase-report-${report.generatedDate}.pdf`;

export const grantReportCsvFilename = (report: Pick<GrantPurchaseReport, "generatedDate">) =>
  `dse-grant-purchase-report-${report.generatedDate}.csv`;
