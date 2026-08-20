import {
  hasExpectedImageSignature,
  sha256Hex,
  SUPPORTED_IMAGE_TYPES,
} from "./image-validation.ts";

export const QUOTATION_MAX_ATTACHMENT_COUNT = 5;
export const QUOTATION_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const QUOTATION_MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const QUOTATION_MAX_REQUEST_BYTES = 22 * 1024 * 1024;

const PDF_TYPE = "application/pdf";
const CSV_TYPE = "text/csv";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const IMAGE_EXTENSIONS = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
]);

export type PreparedQuotationAttachment = {
  originalFilename: string;
  extension: string;
  contentType: string;
  byteSize: number;
  checksum: string;
  bytes: Uint8Array;
};

export type QuotationAttachmentParseResult =
  | { ok: true; value: PreparedQuotationAttachment[] }
  | { ok: false; error: "file_count" | "file_size" | "file_type" | "file_name" };

export async function prepareQuotationAttachments(form: FormData): Promise<QuotationAttachmentParseResult> {
  const values = form.getAll("attachments");
  if (values.some((value) => typeof value === "string")) return { ok: false, error: "file_type" };
  const files = values.filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > QUOTATION_MAX_ATTACHMENT_COUNT) return { ok: false, error: "file_count" };
  if (files.reduce((total, file) => total + file.size, 0) > QUOTATION_MAX_TOTAL_ATTACHMENT_BYTES) return { ok: false, error: "file_size" };

  const prepared: PreparedQuotationAttachment[] = [];
  const checksums = new Set<string>();
  for (const file of files) {
    if (file.size > QUOTATION_MAX_ATTACHMENT_BYTES) return { ok: false, error: "file_size" };
    const originalFilename = safeAttachmentFilename(file.name);
    if (!originalFilename) return { ok: false, error: "file_name" };
    const extension = extensionOf(originalFilename);
    const contentType = canonicalContentType(extension);
    if (!contentType || !acceptsBrowserContentType(extension, file.type)) return { ok: false, error: "file_type" };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size || !hasExpectedSignature(bytes, extension, contentType)) return { ok: false, error: "file_type" };
    const checksum = await sha256Hex(bytes);
    if (checksums.has(checksum)) return { ok: false, error: "file_type" };
    checksums.add(checksum);
    prepared.push({ originalFilename, extension, contentType, byteSize: file.size, checksum, bytes });
  }
  return { ok: true, value: prepared };
}

export function quotationAttachmentDisposition(filename: string): string {
  const safe = safeAttachmentFilename(filename) || "attachment";
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "attachment";
  const encoded = encodeURIComponent(safe).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function safeAttachmentFilename(value: string): string {
  const leaf = value.normalize("NFC").split(/[\\/]/).at(-1) ?? "";
  const sanitized = [...leaf]
    .filter((character) => !isUnsafeFilenameCharacter(character))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized || sanitized === "." || sanitized === ".." || sanitized.length > 160) return "";
  return sanitized;
}

function isUnsafeFilenameCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

function extensionOf(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function canonicalContentType(extension: string): string | null {
  if (IMAGE_EXTENSIONS.has(extension)) return IMAGE_EXTENSIONS.get(extension)!;
  if (extension === "pdf") return PDF_TYPE;
  if (extension === "csv") return CSV_TYPE;
  if (extension === "xlsx") return XLSX_TYPE;
  return null;
}

function acceptsBrowserContentType(extension: string, providedType: string): boolean {
  const normalized = providedType.toLowerCase().split(";", 1)[0].trim();
  if (!normalized) return true;
  if (IMAGE_EXTENSIONS.has(extension)) return normalized === IMAGE_EXTENSIONS.get(extension);
  if (extension === "pdf") return normalized === PDF_TYPE;
  if (extension === "csv") return [CSV_TYPE, "application/csv", "application/vnd.ms-excel", "text/plain"].includes(normalized);
  if (extension === "xlsx") return [XLSX_TYPE, "application/zip", "application/octet-stream"].includes(normalized);
  return false;
}

function hasExpectedSignature(bytes: Uint8Array, extension: string, contentType: string): boolean {
  if (IMAGE_EXTENSIONS.has(extension)) return SUPPORTED_IMAGE_TYPES.has(contentType) && hasExpectedImageSignature(bytes, contentType);
  if (extension === "pdf") return ascii(bytes, 0, 5) === "%PDF-";
  if (extension === "csv") {
    if (bytes.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }
  if (extension === "xlsx") {
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return false;
    return containsAscii(bytes, "[Content_Types].xml") && containsAscii(bytes, "xl/workbook.xml");
  }
  return false;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return "";
  return String.fromCharCode(...bytes.slice(start, end));
}

function containsAscii(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}
