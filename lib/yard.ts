import type { MotorcycleStatus } from "../db/schema.ts";

export const YARD_PAGE_SIZE = 50;
export const YARD_EXIT_VALUE = "__EXIT__";

const zoneCodePattern = /^[A-Z0-9][A-Z0-9-]{1,29}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const yardEligibleStatuses = new Set<MotorcycleStatus>([
  "RECEIVED",
  "INSPECTED",
  "IN_YARD",
  "SCHEDULED",
  "ISSUE",
  "DAMAGED",
  "WAITING_DOCUMENTS",
]);

export function normalizeYardZoneCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return zoneCodePattern.test(normalized) ? normalized : null;
}

export function parseYardCapacity(value: string): number | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^[1-9][0-9]*$/.test(normalized)) return undefined;
  const capacity = Number(normalized);
  return Number.isSafeInteger(capacity) && capacity <= 100_000 ? capacity : undefined;
}

export function isYardRequestKey(value: string): boolean {
  return uuidPattern.test(value);
}

export function isYardPlacementAllowed(status: MotorcycleStatus): boolean {
  return yardEligibleStatuses.has(status);
}

export function parseYardCursor(
  before: string | undefined,
  beforeId: string | undefined,
): { enteredAt: string; id: string } | null | undefined {
  if (before === undefined && beforeId === undefined) return undefined;
  if (!before || !beforeId || before.length > 40 || !uuidPattern.test(beforeId)) return null;
  const parsed = new Date(before);
  if (Number.isNaN(parsed.getTime())) return null;
  return { enteredAt: before, id: beforeId };
}
