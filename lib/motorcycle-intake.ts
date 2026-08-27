import type { MotorcycleStatus } from "../db/schema.ts";

export const MOTORCYCLE_INTAKE_FIELD_LIMITS = {
  make: 80,
  model: 80,
  variant: 80,
  color: 60,
  registration: 30,
  province: 80,
  vin: 50,
  engineNumber: 50,
  notes: 1000,
} as const;

export type MotorcycleIntakeValues = {
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
};

export type MotorcycleIntakeParseResult =
  | { ok: true; values: MotorcycleIntakeValues }
  | { ok: false; error: "validation" };

export function parseMotorcycleIntakeForm(form: FormData, now = new Date()): MotorcycleIntakeParseResult {
  for (const [name, max] of Object.entries(MOTORCYCLE_INTAKE_FIELD_LIMITS)) {
    if (String(form.get(name) ?? "").trim().length > max) return { ok: false, error: "validation" };
  }

  const modelYear = integerOptional(form, "modelYear", 1900, now.getUTCFullYear() + 1);
  const conditionValue = String(form.get("vehicleCondition") ?? "UNKNOWN");
  const vehicleCondition = ["NEW", "USED", "UNKNOWN"].includes(conditionValue)
    ? conditionValue as MotorcycleIntakeValues["vehicleCondition"]
    : null;
  const vin = upperOptional(form, "vin", MOTORCYCLE_INTAKE_FIELD_LIMITS.vin);
  const engineNumber = upperOptional(form, "engineNumber", MOTORCYCLE_INTAKE_FIELD_LIMITS.engineNumber);
  if (modelYear === undefined || !vehicleCondition || (!vin && !engineNumber)) {
    return { ok: false, error: "validation" };
  }

  return {
    ok: true,
    values: {
      make: optional(form, "make", MOTORCYCLE_INTAKE_FIELD_LIMITS.make),
      model: optional(form, "model", MOTORCYCLE_INTAKE_FIELD_LIMITS.model),
      variant: optional(form, "variant", MOTORCYCLE_INTAKE_FIELD_LIMITS.variant),
      modelYear,
      color: optional(form, "color", MOTORCYCLE_INTAKE_FIELD_LIMITS.color),
      registration: upperOptional(form, "registration", MOTORCYCLE_INTAKE_FIELD_LIMITS.registration),
      province: optional(form, "province", MOTORCYCLE_INTAKE_FIELD_LIMITS.province),
      vin,
      engineNumber,
      vehicleCondition,
      notes: optional(form, "notes", MOTORCYCLE_INTAKE_FIELD_LIMITS.notes),
    },
  };
}

export function canEditMotorcycleIntake(status: MotorcycleStatus): boolean {
  return status === "PENDING_RECEIPT";
}

export type MotorcycleIntakeSnapshot = MotorcycleIntakeValues & {
  id: string;
  currentStatus: MotorcycleStatus;
  updatedAt: string;
};

/**
 * A browser-visible optimistic-concurrency token. It is not an authorization
 * credential: the route re-reads and authorizes the motorcycle, then makes the
 * SQL update conditional on every original value as the race-proof backstop.
 */
export async function motorcycleIntakeFingerprint(snapshot: MotorcycleIntakeSnapshot): Promise<string> {
  const ordered = [
    snapshot.id,
    snapshot.currentStatus,
    snapshot.updatedAt,
    snapshot.make,
    snapshot.model,
    snapshot.variant,
    snapshot.modelYear,
    snapshot.color,
    snapshot.registration,
    snapshot.province,
    snapshot.vin,
    snapshot.engineNumber,
    snapshot.vehicleCondition,
    snapshot.notes,
  ];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(ordered)));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function optional(form: FormData, name: string, max: number): string | null {
  const value = cleanUserText(String(form.get(name) ?? ""));
  if (value.length > max) return null;
  return value || null;
}

function upperOptional(form: FormData, name: string, max: number): string | null {
  return optional(form, name, max)?.toUpperCase() ?? null;
}

function integerOptional(form: FormData, name: string, min: number, max: number): number | null | undefined {
  const value = String(form.get(name) ?? "").trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function cleanUserText(value: string): string {
  const bidi = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 || bidi.has(code) ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
