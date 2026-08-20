import type { TripStatus } from "../db/schema.ts";

export const TRIP_PAGE_SIZE = 50;

const transitions: Record<TripStatus, readonly TripStatus[]> = {
  DRAFT: ["PLANNED", "CANCELLED"],
  PLANNED: ["LOADING", "CANCELLED"],
  LOADING: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["ARRIVED"],
  ARRIVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function normalizeTruckCode(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "-");
  return /^[A-Z0-9-]{2,30}$/.test(normalized) ? normalized : null;
}

export function normalizeRegistration(value: string): string | null | undefined {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length <= 30 ? normalized : undefined;
}

export function isTripRequestKey(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseTruckCapacity(value: string): number | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return undefined;
  const result = Number(normalized);
  return Number.isSafeInteger(result) && result >= 1 && result <= 1000 ? result : undefined;
}

export function bangkokInputToUtc(value: string): string | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(normalized)) return undefined;
  const withSeconds = normalized.length === 16 ? `${normalized}:00` : normalized;
  const parsed = new Date(`${withSeconds}+07:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const roundTrip = new Date(parsed.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 19);
  return roundTrip === withSeconds ? parsed.toISOString() : undefined;
}

export function isPlannedTripOrderValid(departure: string | null, arrival: string | null): boolean {
  return !departure || !arrival || arrival >= departure;
}

export function canTransitionTrip(from: TripStatus, to: TripStatus): boolean {
  return transitions[from].includes(to);
}

export function allowedTripTransitions(from: TripStatus): readonly TripStatus[] {
  return transitions[from];
}
