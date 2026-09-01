export type GrantReportBomItem = {
  id: string;
  item: string;
  qty: number;
  unit: string;
  totalUsd: number;
  procurement: string;
  grantPayer?: GrantReportPayer;
  grantPaymentNote?: string;
  grantFundingSource?: string;
  grantFundingAmountUsd?: number;
  grantFundingTreatment?: string;
};

export type GrantReportReceiptIndex = {
  invoices: Array<{ number: number; date: string; supplier: string; filename: string }>;
  itemInvoices: Record<string, number[]>;
};

export type GrantReportSectionId = "fiji" | "personal" | "hvta" | "dse";
export type GrantReportPayer = "IYOIYO" | "DSE";

export type GrantReportLine = {
  id: string;
  item: string;
  qty: number;
  unit: string;
  costUsd: number;
  receiptRefs: number[];
  payer: GrantReportPayer;
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
  iyoyioPurchasesSubtotalUsd: number;
  dsePurchasesSubtotalUsd: number;
  iyoyioCheckAmountUsd: number;
  iyoyioCheckBalanceUsd: number;
  grandTotalUsd: number;
};

const FIJI_PURCHASE_IDS = ["dse-suntech-panels-superseded", "dse-everexceed-batteries-superseded"] as const;
const PERSONAL_USE_IDS = ["dse-personal-garmin-montana-710i", "dse-personal-flexsolar-panels"] as const;
const HVTA_IDS = ["dse-personal-takoci-hx870-batteries"] as const;
const ASSIGNED_IDS = new Set<string>([...PERSONAL_USE_IDS, ...HVTA_IDS]);
const IYOIYO_CHECK_AMOUNT_USD = 8_000;

const roundUsd = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const subtotal = (lines: readonly GrantReportLine[]) => roundUsd(lines.reduce((sum, line) => sum + line.costUsd, 0));
const byDescendingCost = (lines: readonly GrantReportLine[]) => [...lines].sort((first, second) =>
  second.costUsd - first.costUsd || first.item.localeCompare(second.item));

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function lineFor(item: GrantReportBomItem, receiptRefs: readonly number[], defaultPayer: GrantReportPayer): GrantReportLine {
  const fundingNote = item.grantFundingSource
    ? `Funding attribution: ${item.grantFundingSource}; remains included in IYOIYO purchases.`
    : undefined;
  return {
    id: item.id,
    item: item.item,
    qty: item.qty,
    unit: item.unit,
    costUsd: item.totalUsd,
    receiptRefs: [...new Set(receiptRefs)].sort((first, second) => first - second),
    payer: item.grantPayer ?? defaultPayer,
    note: item.grantPaymentNote ?? fundingNote,
  };
}

export function buildGrantPurchaseReport(
  bom: readonly GrantReportBomItem[],
  receipts: GrantReportReceiptIndex,
  generatedAt = new Date(),
): GrantPurchaseReport {
  const itemsById = new Map(bom.map((item) => [item.id, item]));
  const knownInvoiceNumbers = new Set(receipts.invoices.map((invoice) => invoice.number));
  const receiptRefsFor = (id: string) => (receipts.itemInvoices[id] ?? [])
    .filter((number) => knownInvoiceNumbers.has(number));
  const exactLines = (ids: readonly string[], defaultPayer: GrantReportPayer, includeReceiptRefs = true) => ids.flatMap((id) => {
    const item = itemsById.get(id);
    if (!item || !Number.isFinite(item.totalUsd) || item.totalUsd === 0) return [];
    return [lineFor(item, includeReceiptRefs ? receiptRefsFor(id) : [], defaultPayer)];
  });

  const fijiLines = byDescendingCost(exactLines(FIJI_PURCHASE_IDS, "DSE", false));
  const personalLines = byDescendingCost(exactLines(PERSONAL_USE_IDS, "IYOIYO"));
  const hvtaLines = byDescendingCost(exactLines(HVTA_IDS, "IYOIYO"));
  const dseLines = byDescendingCost(bom
    .filter((item) => !ASSIGNED_IDS.has(item.id))
    .filter((item) => item.procurement.includes("Purchased"))
    .filter((item) => Number.isFinite(item.totalUsd) && item.totalUsd !== 0)
    .filter((item) => receiptRefsFor(item.id).length > 0)
    .map((item) => lineFor(item, receiptRefsFor(item.id), "IYOIYO")));

  const sections: GrantReportSection[] = [
    { id: "fiji", title: "Items purchased in Fiji", lines: fijiLines, subtotalUsd: subtotal(fijiLines) },
    { id: "personal", title: "Items purchased for personal use", lines: personalLines, subtotalUsd: subtotal(personalLines) },
    { id: "hvta", title: "Items purchased for HVTA", lines: hvtaLines, subtotalUsd: subtotal(hvtaLines) },
    { id: "dse", title: "Items purchased for DSE", lines: dseLines, subtotalUsd: subtotal(dseLines) },
  ];
  const reportLines = sections.flatMap((section) => section.lines);
  const iyoyioPurchasesSubtotalUsd = subtotal(reportLines.filter((line) => line.payer === "IYOIYO"));
  const dsePurchasesSubtotalUsd = subtotal(reportLines.filter((line) => line.payer === "DSE"));
  const iyoyioCheckBalanceUsd = roundUsd(IYOIYO_CHECK_AMOUNT_USD - iyoyioPurchasesSubtotalUsd);

  return {
    title: "DSE Grant Purchase Report",
    generatedDate: localIsoDate(generatedAt),
    generatedDateLabel: new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "long", day: "numeric",
    }).format(generatedAt),
    explanation: "Costs are in USD. Sections show where purchases were made or who they were for; payer subtotals show who paid. Numbered receipts refer to the project archive. All Fiji purchases and customs invoice #44 were paid by DSE.",
    sections,
    iyoyioPurchasesSubtotalUsd,
    dsePurchasesSubtotalUsd,
    iyoyioCheckAmountUsd: IYOIYO_CHECK_AMOUNT_USD,
    iyoyioCheckBalanceUsd,
    grandTotalUsd: roundUsd(iyoyioPurchasesSubtotalUsd + dsePurchasesSubtotalUsd),
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

const pdfMoney = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

type CsvValue = string | number;
const CSV_COLUMN_COUNT = 9;
const csvCell = (value: CsvValue) => {
  const text = String(value);
  if (!text) return "";
  if (typeof value === "number" || /^-?\d+(?:\.\d+)?$/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
};

export function createGrantReportCsv(report: GrantPurchaseReport) {
  const rows: CsvValue[][] = [
    ["Report", report.title],
    ["Generated date", report.generatedDate],
    ["Explanation", report.explanation],
    [],
    ["Row type", "Section", "Item", "Quantity", "Unit", "Receipt reference", "Paid by", "Amount (USD)", "Note"],
  ];

  for (const section of report.sections) {
    rows.push(["Section", section.title]);
    for (const line of section.lines) {
      rows.push([
        "Item",
        section.title,
        line.item,
        line.qty,
        line.unit,
        line.receiptRefs.length ? compactReceiptReferences(line.receiptRefs) : "Fiji receipt - not indexed",
        line.payer,
        line.costUsd.toFixed(2),
        line.note ?? "",
      ]);
    }
    rows.push(["Section subtotal", section.title, `${section.title} subtotal`, "", "", "", "",
      section.subtotalUsd.toFixed(2)]);
    rows.push([]);
  }

  const checkBalanceNote = report.iyoyioCheckBalanceUsd >= 0
    ? `${pdfMoney(report.iyoyioCheckBalanceUsd)} remaining from ${pdfMoney(report.iyoyioCheckAmountUsd)} PTS check`
    : `${pdfMoney(Math.abs(report.iyoyioCheckBalanceUsd))} over ${pdfMoney(report.iyoyioCheckAmountUsd)} PTS check`;
  rows.push(
    ["Payer subtotal", "Payer summary", "Purchases made by IYOIYO", "", "", "", "IYOIYO",
      report.iyoyioPurchasesSubtotalUsd.toFixed(2)],
    ["Check amount", "Payer summary", "Pacific Traditions Society check", "", "", "", "IYOIYO",
      report.iyoyioCheckAmountUsd.toFixed(2)],
    ["Check balance", "Payer summary", "PTS check balance", "", "", "", "IYOIYO",
      report.iyoyioCheckBalanceUsd.toFixed(2), checkBalanceNote],
    ["Payer subtotal", "Payer summary", "Purchases made by DSE", "", "", "", "DSE",
      report.dsePurchasesSubtotalUsd.toFixed(2),
      "All Fiji purchases plus customs invoice #44; customs paid directly by Seta for DSE"],
    ["Grand total", "Payer summary", "GRAND TOTAL - DSE + IYOIYO", "", "", "", "",
      report.grandTotalUsd.toFixed(2)],
  );

  const encodeRow = (row: readonly CsvValue[]) => Array.from(
    { length: CSV_COLUMN_COUNT },
    (_, index) => csvCell(row[index] ?? ""),
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
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= maximumCharacters) current += ` ${word}`;
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
      page.commands.push(pdfText(report.title, 48, 744, 19, true, "0.08 0.28 0.29"));
      page.commands.push(pdfText(`Generated ${report.generatedDateLabel}`, 48, 721, 9, false, "0.38 0.43 0.41"));
      const explanation = wrapText(report.explanation, 108);
      explanation.forEach((line, index) => page.commands.push(pdfText(line, 48, 698 - index * 11, 8.5, false, "0.30 0.35 0.34")));
      y = 698 - explanation.length * 11 - 15;
    } else {
      page.commands.push(pdfText(`${report.title} - continued`, 48, 748, 10, true, "0.08 0.28 0.29"));
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
    page.commands.push(pdfRect(48, y - 17, 516, 17, "0.91 0.94 0.92"));
    page.commands.push(pdfText("ITEM", 54, y - 12, 7.2, true, "0.25 0.34 0.32"));
    page.commands.push(pdfText("RECEIPT REF.", 405, y - 12, 7.2, true, "0.25 0.34 0.32"));
    page.commands.push(pdfText("COST", 536, y - 12, 7.2, true, "0.25 0.34 0.32"));
    y -= 17;
  };

  startPage(true);
  for (const section of report.sections) {
    if (ensureSpace(58)) {
      // A normal section heading follows the repeated page header.
    }
    page.commands.push(pdfRect(48, y - 24, 516, 24, "0.10 0.32 0.33"));
    page.commands.push(pdfText(section.title, 55, y - 16, 10, true, "1 1 1"));
    y -= 30;
    tableHeader();

    for (let index = 0; index < section.lines.length; index += 1) {
      const line = section.lines[index];
      const itemLines = wrapText(`${line.qty} ${line.unit} - ${line.item}`, 72);
      const noteLines = line.note ? wrapText(line.note, 72) : [];
      const receiptText = line.receiptRefs.length ? compactReceiptReferences(line.receiptRefs) : "Fiji receipt - not indexed";
      const receiptLines = wrapText(receiptText, 22);
      const rowHeight = Math.max(itemLines.length + noteLines.length, receiptLines.length) * 9 + 9;
      if (ensureSpace(rowHeight + 25)) {
        page.commands.push(pdfText(`${section.title} - continued`, 48, y, 9.5, true, "0.08 0.28 0.29"));
        y -= 15;
        tableHeader();
      }
      const textY = y - 12;
      itemLines.forEach((text, lineIndex) => page.commands.push(pdfText(text, 54, textY - lineIndex * 9, 7.8)));
      noteLines.forEach((text, lineIndex) => page.commands.push(pdfText(text, 54,
        textY - (itemLines.length + lineIndex) * 9, 6.7, false, "0.42 0.46 0.44")));
      receiptLines.forEach((text, lineIndex) => page.commands.push(pdfText(text, 405, textY - lineIndex * 9, 7.8, false, "0.31 0.39 0.37")));
      const cost = pdfMoney(line.costUsd);
      page.commands.push(pdfText(cost, 558 - cost.length * 4.15, textY, 7.8, true));
      y -= rowHeight;
      page.commands.push(pdfLine(48, y, 564, y));
    }

    if (ensureSpace(30)) {
      page.commands.push(pdfText(`${section.title} subtotal`, 48, y, 9, true, "0.08 0.28 0.29"));
      y -= 17;
    }
    page.commands.push(pdfRect(48, y - 24, 516, 24, "0.94 0.91 0.84"));
    page.commands.push(pdfText(`${section.title} subtotal`, 55, y - 16, 8, true, "0.30 0.28 0.20"));
    const sectionTotal = pdfMoney(section.subtotalUsd);
    page.commands.push(pdfText(sectionTotal, 558 - sectionTotal.length * 4.3, y - 16, 8.3, true, "0.30 0.28 0.20"));
    y -= 39;
  }

  ensureSpace(140);
  page.commands.push(pdfLine(48, y, 564, y, "0.10 0.32 0.33", 1.1));
  y -= 24;
  page.commands.push(pdfText("Purchases made by IYOIYO", 48, y, 10, true, "0.08 0.28 0.29"));
  const checkBalance = report.iyoyioCheckBalanceUsd >= 0
    ? `${pdfMoney(report.iyoyioCheckBalanceUsd)} remaining from ${pdfMoney(report.iyoyioCheckAmountUsd)} PTS check`
    : `${pdfMoney(Math.abs(report.iyoyioCheckBalanceUsd))} over ${pdfMoney(report.iyoyioCheckAmountUsd)} PTS check`;
  page.commands.push(pdfText(checkBalance, 48, y - 13, 7.5, false, "0.38 0.43 0.41"));
  const iyoyioPurchases = pdfMoney(report.iyoyioPurchasesSubtotalUsd);
  page.commands.push(pdfText(iyoyioPurchases, 558 - iyoyioPurchases.length * 5.2, y, 10, true, "0.08 0.28 0.29"));
  y -= 43;
  page.commands.push(pdfText("Purchases made by DSE", 48, y, 10, true, "0.08 0.28 0.29"));
  page.commands.push(pdfText("All Fiji purchases plus customs invoice #44; customs paid directly by Seta for DSE", 48, y - 13, 7.5, false, "0.38 0.43 0.41"));
  const dsePurchases = pdfMoney(report.dsePurchasesSubtotalUsd);
  page.commands.push(pdfText(dsePurchases, 558 - dsePurchases.length * 5.2, y, 10, true, "0.08 0.28 0.29"));
  y -= 43;
  page.commands.push(pdfRect(48, y - 34, 516, 34, "0.10 0.32 0.33"));
  page.commands.push(pdfText("GRAND TOTAL - DSE + IYOIYO", 58, y - 22, 11, true, "1 1 1"));
  const grandTotal = pdfMoney(report.grandTotalUsd);
  page.commands.push(pdfText(grandTotal, 556 - grandTotal.length * 6.3, y - 22, 12, true, "1 1 1"));

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
  pages.forEach((page, index) => {
    const pageObjectId = pageObjectIds[index];
    const contentObjectId = pageObjectId + 1;
    const content = `${page.commands.join("\n")}\n`;
    const contentLength = new TextEncoder().encode(content).length;
    objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId] = `<< /Length ${contentLength} >>\nstream\n${content}endstream`;
  });
  objects[infoObjectId] = `<< /Title (${escapePdfText(report.title)}) /Subject (Grant purchase breakdown) /CreationDate (D:${report.generatedDate.replaceAll("-", "")}000000) >>`;

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
