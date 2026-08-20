import { unzipSync } from "fflate";

export const MOTORCYCLE_IMPORT_MAX_ROWS = 500;
export const MOTORCYCLE_IMPORT_MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MOTORCYCLE_IMPORT_MAX_XLSX_BYTES = 5 * 1024 * 1024;
export const MOTORCYCLE_IMPORT_MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const XLSX_MAX_UNCOMPRESSED_BYTES = 12 * 1024 * 1024;
const XLSX_MAX_ENTRIES = 120;

export type MotorcycleImportSourceType = "CSV" | "XLSX";
export type MotorcycleImportRow = {
  id: string;
  sourceRowNumber: number;
  recordId: string;
  publicId: string;
  rawPayload: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  modelYear: number | null;
  color: string | null;
  registration: string | null;
  province: string | null;
  vin: string | null;
  engineNumber: string | null;
  vehicleCondition: "NEW" | "USED" | "UNKNOWN";
  notes: string | null;
  validationStatus: "VALID" | "ERROR";
  errorMessage: string | null;
};

export type PreparedMotorcycleImport = {
  sourceFilename: string;
  sourceType: MotorcycleImportSourceType;
  checksum: string;
  rows: MotorcycleImportRow[];
};

const headers = new Map<string, keyof ParsedRow>([
  ["make", "make"], ["brand", "make"], ["ยี่ห้อ", "make"],
  ["model", "model"], ["รุ่น", "model"],
  ["variant", "variant"], ["รุ่นย่อย", "variant"],
  ["year", "modelYear"], ["modelyear", "modelYear"], ["ปี", "modelYear"], ["ปีรถ", "modelYear"],
  ["color", "color"], ["สี", "color"],
  ["registration", "registration"], ["ทะเบียน", "registration"], ["เลขทะเบียน", "registration"],
  ["province", "province"], ["จังหวัด", "province"],
  ["vin", "vin"], ["frame", "vin"], ["framenumber", "vin"], ["เลขตัวถัง", "vin"], ["เลขโครง", "vin"],
  ["enginenumber", "engineNumber"], ["engine", "engineNumber"], ["เลขเครื่อง", "engineNumber"],
  ["condition", "vehicleCondition"], ["สภาพรถ", "vehicleCondition"], ["รถใหม่มือสอง", "vehicleCondition"],
  ["notes", "notes"], ["note", "notes"], ["หมายเหตุ", "notes"],
]);

type ParsedRow = {
  make: string;
  model: string;
  variant: string;
  modelYear: string;
  color: string;
  registration: string;
  province: string;
  vin: string;
  engineNumber: string;
  vehicleCondition: string;
  notes: string;
};

export async function prepareMotorcycleImport(file: File): Promise<PreparedMotorcycleImport> {
  const sourceFilename = safeFilename(file.name);
  const lower = sourceFilename.toLowerCase();
  const sourceType: MotorcycleImportSourceType = lower.endsWith(".csv") ? "CSV" : lower.endsWith(".xlsx") ? "XLSX" : fail("รองรับเฉพาะไฟล์ .csv และ .xlsx");
  const limit = sourceType === "CSV" ? MOTORCYCLE_IMPORT_MAX_CSV_BYTES : MOTORCYCLE_IMPORT_MAX_XLSX_BYTES;
  if (file.size < 1 || file.size > limit) throw new Error(`ไฟล์ต้องมีขนาด 1 ไบต์ถึง ${Math.floor(limit / 1024 / 1024)} MB`);
  validateMime(file.type, sourceType);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checksum = await sha256(bytes);
  const matrix = sourceType === "CSV" ? parseCsv(decodeUtf8(bytes)) : parseXlsx(bytes);
  return { sourceFilename, sourceType, checksum, rows: normalizeRows(matrix) };
}

export function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"' && value[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (quoted) throw new Error("CSV มีเครื่องหมายคำพูดที่ปิดไม่ครบ");
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function normalizeRows(matrix: string[][]): MotorcycleImportRow[] {
  if (matrix.length < 2) throw new Error("ไฟล์ต้องมีหัวตารางและข้อมูลอย่างน้อย 1 รายการ");
  const rawHeaders = matrix[0].map(normalizeHeader);
  if (rawHeaders.length > 20) throw new Error("ไฟล์มีจำนวนคอลัมน์เกินขอบเขตที่รองรับ");
  const mapped = rawHeaders.map((header) => headers.get(header) ?? null);
  const unknown = rawHeaders.filter((header, index) => header && !mapped[index]);
  if (unknown.length) throw new Error(`ไม่รู้จักหัวตาราง: ${unknown.slice(0, 5).join(", ")}`);
  const present = mapped.filter(Boolean);
  if (new Set(present).size !== present.length) throw new Error("หัวตารางซ้ำหรือมีชื่อที่หมายถึงข้อมูลเดียวกัน");
  if (!present.includes("vin") && !present.includes("engineNumber")) throw new Error("ต้องมีคอลัมน์ VIN/เลขโครง หรือเลขเครื่องอย่างน้อยหนึ่งคอลัมน์");

  const dataRows = matrix.slice(1).map((cells, index) => ({ cells, sourceRowNumber: index + 2 })).filter(({ cells }) => cells.some((cell) => cell.trim()));
  if (!dataRows.length || dataRows.length > MOTORCYCLE_IMPORT_MAX_ROWS) throw new Error(`จำนวนข้อมูลต้องอยู่ระหว่าง 1 ถึง ${MOTORCYCLE_IMPORT_MAX_ROWS} รายการ`);
  if (dataRows.some((row) => row.sourceRowNumber > MOTORCYCLE_IMPORT_MAX_ROWS + 1)) throw new Error("ข้อมูลต้องอยู่ภายใน 500 แถวถัดจากหัวตาราง โดยไม่เว้นแถวว่างจำนวนมาก");
  const rows = dataRows.map(({ cells, sourceRowNumber }) => normalizeRow(cells, mapped, sourceRowNumber));
  markDuplicate(rows, "vin", "VIN/เลขโครงซ้ำภายในไฟล์");
  markDuplicate(rows, "engineNumber", "เลขเครื่องซ้ำภายในไฟล์");
  return rows;
}

function normalizeRow(cells: string[], mapped: Array<keyof ParsedRow | null>, sourceRowNumber: number): MotorcycleImportRow {
  const source = blankParsedRow();
  mapped.forEach((field, index) => { if (field) source[field] = cells[index] ?? ""; });
  const errors: string[] = [];
  const make = textValue(source.make, 80, "ยี่ห้อ", errors);
  const model = textValue(source.model, 80, "รุ่น", errors);
  const variant = textValue(source.variant, 80, "รุ่นย่อย", errors);
  const color = textValue(source.color, 60, "สี", errors);
  const registration = upperValue(source.registration, 30, "ทะเบียน", errors);
  const province = textValue(source.province, 80, "จังหวัด", errors);
  const vin = upperValue(source.vin, 50, "VIN/เลขโครง", errors);
  const engineNumber = upperValue(source.engineNumber, 50, "เลขเครื่อง", errors);
  const notes = textValue(source.notes, 1000, "หมายเหตุ", errors);
  const modelYear = yearValue(source.modelYear, errors);
  const vehicleCondition = conditionValue(source.vehicleCondition, errors);
  if (!vin && !engineNumber) errors.push("ต้องมี VIN/เลขโครง หรือเลขเครื่อง");
  const normalized = { make, model, variant, modelYear, color, registration, province, vin, engineNumber, vehicleCondition, notes };
  return {
    id: crypto.randomUUID(), sourceRowNumber, recordId: crypto.randomUUID(), publicId: `mc_${crypto.randomUUID().replaceAll("-", "")}`,
    rawPayload: JSON.stringify(normalized), ...normalized,
    validationStatus: errors.length ? "ERROR" : "VALID", errorMessage: errors.length ? errors.join("; ") : null,
  };
}

function markDuplicate(rows: MotorcycleImportRow[], field: "vin" | "engineNumber", message: string) {
  const groups = new Map<string, MotorcycleImportRow[]>();
  for (const row of rows) {
    const value = row[field];
    if (value) groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  for (const group of groups.values()) if (group.length > 1) for (const row of group) addRowError(row, message);
}

function addRowError(row: MotorcycleImportRow, message: string) {
  row.validationStatus = "ERROR";
  row.errorMessage = row.errorMessage ? `${row.errorMessage}; ${message}` : message;
}

function parseXlsx(bytes: Uint8Array): string[][] {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) throw new Error("ไฟล์ XLSX ไม่มี ZIP signature ที่ถูกต้อง");
  let archive: Record<string, Uint8Array>;
  let entryCount = 0, declaredUncompressedBytes = 0;
  try {
    archive = unzipSync(bytes, { filter: (entry) => {
      entryCount += 1;
      declaredUncompressedBytes += entry.originalSize;
      if (entryCount > XLSX_MAX_ENTRIES || declaredUncompressedBytes > XLSX_MAX_UNCOMPRESSED_BYTES) throw new Error("xlsx_limit");
      return entry.name === "[Content_Types].xml" || entry.name === "xl/workbook.xml" || entry.name === "xl/_rels/workbook.xml.rels" || entry.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/[a-zA-Z0-9_.-]+\.xml$/.test(entry.name);
    } });
  } catch { throw new Error("เปิดโครงสร้าง XLSX ไม่สำเร็จหรือขยายข้อมูลเกินขอบเขตความปลอดภัย"); }
  const entries = Object.entries(archive);
  if (entries.length > XLSX_MAX_ENTRIES || entries.reduce((total, [, value]) => total + value.byteLength, 0) > XLSX_MAX_UNCOMPRESSED_BYTES) throw new Error("XLSX ขยายข้อมูลเกินขอบเขตความปลอดภัย");
  const contentTypes = xmlFile(archive, "[Content_Types].xml");
  const workbook = xmlFile(archive, "xl/workbook.xml");
  const relationships = xmlFile(archive, "xl/_rels/workbook.xml.rels");
  if (!contentTypes.includes("spreadsheetml") || !workbook.includes("<sheet")) throw new Error("ไฟล์ไม่ใช่ Excel Workbook ที่รองรับ");
  const sheetTag = workbook.match(/<sheet\b[^>]*\br:id=(?:"([^"]+)"|'([^']+)')[^>]*\/?\s*>/i)?.[0];
  const relationId = sheetTag ? attr(sheetTag, "r:id") : null;
  if (!relationId) throw new Error("XLSX ไม่มี Worksheet ที่อ่านได้");
  const relationTag = [...relationships.matchAll(/<Relationship\b[^>]*\/?>/gi)].map((match) => match[0]).find((tag) => attr(tag, "Id") === relationId);
  const target = relationTag ? attr(relationTag, "Target") : null;
  if (!target || target.includes("..") || target.startsWith("/") || target.includes("\\")) throw new Error("XLSX Worksheet path ไม่ปลอดภัย");
  const sheetPath = target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = xmlFile(archive, sheetPath);
  if (/<f(?:\s|>)/i.test(sheet)) throw new Error("XLSX ที่มีสูตรไม่รองรับ กรุณาแปลงสูตรเป็นค่าก่อนนำเข้า");
  const shared = archive["xl/sharedStrings.xml"] ? parseSharedStrings(xmlFile(archive, "xl/sharedStrings.xml")) : [];
  const result: string[][] = [];
  let previousRowNumber = 0;
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const rowNumber = Number(attr(`<row ${rowMatch[1]}>`, "r") ?? previousRowNumber + 1);
    if (!Number.isSafeInteger(rowNumber) || rowNumber <= previousRowNumber || rowNumber > MOTORCYCLE_IMPORT_MAX_ROWS + 1) throw new Error("หมายเลขแถวใน XLSX ไม่ถูกต้องหรือเกินขอบเขต 500 รายการ");
    while (result.length < rowNumber - 1) result.push([]);
    const row: string[] = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const tag = `<c ${cellMatch[1]}>`, reference = attr(tag, "r");
      if (!reference) continue;
      if (Number(reference.match(/\d+$/)?.[0]) !== rowNumber) throw new Error("Cell reference ใน XLSX ไม่ตรงกับหมายเลขแถว");
      const column = columnIndex(reference);
      if (column < 0 || column >= 20) throw new Error("XLSX มีคอลัมน์เกินขอบเขตที่รองรับ");
      const type = attr(tag, "t");
      const content = cellMatch[2];
      const raw = type === "inlineStr" ? joinTextNodes(content) : decodeXml(content.match(/<v>([\s\S]*?)<\/v>/i)?.[1] ?? "");
      row[column] = type === "s" ? shared[Number(raw)] ?? "" : raw;
    }
    result.push(row.map((value) => value ?? ""));
    previousRowNumber = rowNumber;
  }
  return result;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => joinTextNodes(match[1]));
}

function joinTextNodes(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1])).join("");
}

function xmlFile(archive: Record<string, Uint8Array>, path: string): string {
  const value = archive[path];
  if (!value) throw new Error(`XLSX ขาดไฟล์โครงสร้าง ${path}`);
  return decodeUtf8(value);
}

function attr(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decodeXml(match[1] ?? match[2] ?? "") : null;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return -1;
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function decodeXml(value: string): string {
  return value.replace(/&#x([0-9a-f]+);|&#([0-9]+);|&quot;|&apos;|&lt;|&gt;|&amp;/gi, (entity, hex, decimal) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return ({ "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" } as Record<string, string>)[entity.toLowerCase()] ?? entity;
  });
}

function safeFilename(value: string): string {
  const filename = cleanUnsafeCharacters(value.replaceAll("\\", "/").split("/").pop() ?? "", "").trim();
  if (!filename || filename.length > 160) throw new Error("ชื่อไฟล์ไม่ถูกต้องหรือยาวเกิน 160 ตัวอักษร");
  return filename;
}

function validateMime(type: string, sourceType: MotorcycleImportSourceType) {
  const allowed = sourceType === "CSV" ? ["", "text/csv", "application/csv", "application/vnd.ms-excel"] : ["", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
  if (!allowed.includes(type.toLowerCase())) throw new Error("ชนิดไฟล์ไม่ตรงกับนามสกุล");
}

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new Error("ไฟล์ต้องเป็น UTF-8 ที่ถูกต้อง"); }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer))].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizeHeader(value: string): string { return value.trim().toLowerCase().replace(/[\s_.\-/]+/g, ""); }
function blankParsedRow(): ParsedRow { return { make: "", model: "", variant: "", modelYear: "", color: "", registration: "", province: "", vin: "", engineNumber: "", vehicleCondition: "", notes: "" }; }
function clean(value: string): string { return cleanUnsafeCharacters(value, " ").replace(/\s+/g, " ").trim(); }
function cleanUnsafeCharacters(value: string, replacement: string): string {
  const bidi = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
  return [...value].map((character) => { const code = character.codePointAt(0) ?? 0; return code < 32 || code === 127 || bidi.has(code) ? replacement : character; }).join("");
}
function textValue(value: string, max: number, label: string, errors: string[]): string | null { const normalized = clean(value); if (normalized.length > max) errors.push(`${label}ยาวเกิน ${max} ตัวอักษร`); return normalized ? normalized.slice(0, max) : null; }
function upperValue(value: string, max: number, label: string, errors: string[]): string | null { return textValue(value, max, label, errors)?.toUpperCase() ?? null; }
function yearValue(value: string, errors: string[]): number | null { const normalized = clean(value); if (!normalized) return null; if (!/^\d{4}$/.test(normalized)) { errors.push("ปีรถต้องเป็นเลข 4 หลัก"); return null; } const year = Number(normalized); const max = new Date().getUTCFullYear() + 1; if (year < 1900 || year > max) { errors.push(`ปีรถต้องอยู่ระหว่าง 1900 ถึง ${max}`); return null; } return year; }
function conditionValue(value: string, errors: string[]): "NEW" | "USED" | "UNKNOWN" { const normalized = clean(value).toUpperCase(); if (!normalized) return "UNKNOWN"; if (["NEW", "ใหม่", "รถใหม่"].includes(normalized)) return "NEW"; if (["USED", "มือสอง", "รถมือสอง"].includes(normalized)) return "USED"; if (["UNKNOWN", "ไม่ระบุ"].includes(normalized)) return "UNKNOWN"; errors.push("สภาพรถต้องเป็น NEW/USED/UNKNOWN หรือ ใหม่/มือสอง/ไม่ระบุ"); return "UNKNOWN"; }
function fail(message: string): never { throw new Error(message); }
