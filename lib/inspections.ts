import type {
  InspectionType,
  MotorcycleStatus,
} from "../db/schema.ts";

const allowedInspectionStatuses: Record<InspectionType, readonly MotorcycleStatus[]> = {
  RECEIPT: ["PENDING_RECEIPT", "RECEIVED", "ISSUE", "DAMAGED"],
  PRE_LOAD: ["INSPECTED", "IN_YARD", "SCHEDULED", "ISSUE", "DAMAGED"],
  DELIVERY: ["ARRIVED", "DELIVERED", "ISSUE", "DAMAGED"],
};

export function inspectionTypeAllowedForStatus(type: InspectionType, status: MotorcycleStatus): boolean {
  return allowedInspectionStatuses[type].includes(status);
}

export function normalizeInspectionText(
  value: string,
  { min = 1, max }: { min?: number; max: number },
): string | null | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length >= min && normalized.length <= max ? normalized : undefined;
}

export function parseOdometerKm(value: string): number | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return undefined;
  const result = Number(normalized);
  return Number.isSafeInteger(result) && result >= 0 && result <= 10_000_000 ? result : undefined;
}

export function canCreateProofOfDelivery(status: MotorcycleStatus): boolean {
  return status === "ARRIVED";
}

export function isReasonableRecordedTime(value: string, nowMs = Date.now()): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs + 15 * 60 * 1000;
}

export function maskPhone(value: string | null): string {
  if (!value) return "ไม่ระบุ";
  const visible = [...value];
  if (visible.length <= 4) return "••••";
  return `${"•".repeat(Math.min(visible.length - 4, 8))}${visible.slice(-4).join("")}`;
}
