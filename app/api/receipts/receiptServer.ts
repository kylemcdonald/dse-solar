import fs from "node:fs";
import path from "node:path";
import receiptsRaw from "../../../data/dse-receipts.json";
export { privateModeEnabled } from "./privateMode";

export type ReceiptReference = { number: number; filename: string };
const receiptReferences = (receiptsRaw as { invoices: ReceiptReference[] }).invoices;

export function receiptAllowlist(privateRoot = path.resolve(process.cwd(), "private")) {
  const result = new Set<string>();
  for (const filename of fs.readdirSync(privateRoot).sort()) {
    if (!filename.toLowerCase().endsWith(".pdf")) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i.test(filename) || path.basename(filename) !== filename) {
      throw new Error(`Unsafe private receipt filename: ${filename}`);
    }
    result.add(filename);
  }
  return result;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

type ZipInput = { name: string; data: Buffer; modified: Date };
export function createStoredZip(files: ZipInput[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const stamp = dosTime(file.modified);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, file.data);
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function receiptZipFilename(filename: string, references: readonly ReceiptReference[] = receiptReferences) {
  const matchingReference = [...references]
    .sort((first, second) => second.filename.length - first.filename.length)
    .find((reference) => {
      const stem = reference.filename.replace(/\.pdf$/i, "");
      return filename === reference.filename || filename.startsWith(`${stem}-`);
    });
  if (!matchingReference) throw new Error(`No public receipt reference for archived PDF: ${filename}`);
  if (!Number.isInteger(matchingReference.number) || matchingReference.number < 1) {
    throw new Error(`Invalid public receipt reference for archived PDF: ${filename}`);
  }
  const referenceWidth = Math.max(2, ...references.map((reference) => String(reference.number).length));
  return `${String(matchingReference.number).padStart(referenceWidth, "0")}-${filename}`;
}

export function loadReceiptArchive(
  privateRoot = path.resolve(process.cwd(), "private"),
  references: readonly ReceiptReference[] = receiptReferences,
) {
  privateRoot = path.resolve(privateRoot);
  const allowlist = receiptAllowlist(privateRoot);
  const realPrivateRoot = fs.realpathSync(privateRoot);
  const files: ZipInput[] = [];
  for (const filename of allowlist) {
    const candidate = path.resolve(privateRoot, filename);
    if (path.dirname(candidate) !== privateRoot) throw new Error(`Receipt path escaped private root: ${filename}`);
    const realCandidate = fs.realpathSync(candidate);
    if (!realCandidate.startsWith(`${realPrivateRoot}${path.sep}`)) throw new Error(`Receipt symlink escaped private root: ${filename}`);
    const stat = fs.statSync(realCandidate);
    if (!stat.isFile()) throw new Error(`Receipt is not a regular file: ${filename}`);
    files.push({ name: receiptZipFilename(filename, references), data: fs.readFileSync(realCandidate), modified: stat.mtime });
  }
  return createStoredZip(files.sort((first, second) => first.name.localeCompare(second.name)));
}
