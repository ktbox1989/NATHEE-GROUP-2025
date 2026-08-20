import { normalizeDirectorySearch } from "./directory-search.ts";

export const PRINT_CENTER_PAGE_SIZE = 50;

export const PRINT_CENTER_SEARCH_KINDS = [
  "job",
  "motorcycle-registration",
  "motorcycle-vin",
  "motorcycle-engine",
  "yard",
  "truck",
  "trip",
  "container",
] as const;

export type PrintCenterSearchKind = (typeof PRINT_CENTER_SEARCH_KINDS)[number];

export const PRINT_CENTER_KIND_LABELS: Record<PrintCenterSearchKind, string> = {
  job: "Job / เลขงาน",
  "motorcycle-registration": "รถ / ทะเบียน",
  "motorcycle-vin": "รถ / VIN",
  "motorcycle-engine": "รถ / เลขเครื่อง",
  yard: "ลาน / รหัสโซน",
  truck: "รถขนส่ง / รหัสรถ",
  trip: "เที่ยว / เลขเที่ยว",
  container: "Container / เลขตู้",
};

export function parsePrintCenterKind(value?: string): PrintCenterSearchKind | null {
  if (!value) return "job";
  return PRINT_CENTER_SEARCH_KINDS.includes(value as PrintCenterSearchKind)
    ? value as PrintCenterSearchKind
    : null;
}

export function normalizePrintCenterSearch(value: string): string | null | undefined {
  const normalized = normalizeDirectorySearch(value);
  return typeof normalized === "string" ? normalized.toUpperCase() : normalized;
}
