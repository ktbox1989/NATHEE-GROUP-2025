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

const positionCodePattern = /^[A-Z0-9][A-Z0-9-]{0,19}$/;

/** Row and slot codes share one rule: short, upper case, printable on a label. */
export function normalizeYardPositionCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return positionCodePattern.test(normalized) ? normalized : null;
}

/**
 * Expands `01-20` into twenty slot codes, so a row of real parking bays is one
 * action rather than twenty. A plain code is returned as a single slot.
 *
 * The bound and zero-padding come from the first code, so `01-20` produces
 * `01..20` and not `1..20`: a label printed `1` and a label printed `01` are the
 * same bay to a person and different codes to the database.
 */
export function expandSlotCodeRange(value: string, limit = 200): string[] | null {
  const normalized = value.trim().toUpperCase();
  const range = /^([A-Z]*)(\d+)-([A-Z]*)(\d+)$/.exec(normalized);
  if (!range) {
    const single = normalizeYardPositionCode(normalized);
    return single ? [single] : null;
  }
  const [, prefix, fromDigits, toPrefix, toDigits] = range;
  if (prefix !== toPrefix) return null;
  const from = Number(fromDigits);
  const to = Number(toDigits);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) return null;
  if (to - from + 1 > limit) return null;
  const width = fromDigits.length;
  const codes: string[] = [];
  for (let value = from; value <= to; value += 1) {
    const code = `${prefix}${String(value).padStart(width, "0")}`;
    const normalizedCode = normalizeYardPositionCode(code);
    if (!normalizedCode) return null;
    codes.push(normalizedCode);
  }
  return codes;
}
