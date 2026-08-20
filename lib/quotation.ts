export const QUOTATION_EXTRAS = ["STORAGE", "CONTAINER", "INTERNATIONAL", "LARGE_BATCH"] as const;
export const QUOTATION_VEHICLE_TYPES = ["MOTORCYCLE", "BIG_BIKE", "MIXED", "OTHER"] as const;

export type QuotationInput = {
  requestKey: string;
  companyName: string | null;
  contactName: string;
  phone: string;
  lineId: string | null;
  email: string | null;
  origin: string;
  destination: string;
  quantity: number;
  vehicleType: (typeof QUOTATION_VEHICLE_TYPES)[number];
  desiredDate: string | null;
  extras: (typeof QUOTATION_EXTRAS)[number][];
  notes: string | null;
};

export type QuotationParseResult = { ok: true; value: QuotationInput } | { ok: false; error: "invalid" | "consent" | "bot" };

export function parseQuotationForm(form: FormData): QuotationParseResult {
  if (bounded(form.get("website"), 200)) return { ok: false, error: "bot" };
  if (form.get("privacyConsent") !== "yes") return { ok: false, error: "consent" };

  const requestKey = bounded(form.get("requestKey"), 100);
  const contactName = bounded(form.get("contactName"), 120);
  const phone = normalizeThaiPhone(bounded(form.get("phone"), 30));
  const origin = bounded(form.get("origin"), 180);
  const destination = bounded(form.get("destination"), 180);
  const quantity = Number(form.get("quantity"));
  const vehicleType = bounded(form.get("vehicleType"), 30);
  const email = optional(form.get("email"), 254)?.toLowerCase() ?? null;
  const desiredDate = optional(form.get("desiredDate"), 10);
  const extras = [...new Set(form.getAll("extras").map((value) => bounded(value, 30)))];

  if (!/^quote-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) return { ok: false, error: "invalid" };
  if (contactName.length < 2 || !phone || origin.length < 2 || destination.length < 2) return { ok: false, error: "invalid" };
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10_000) return { ok: false, error: "invalid" };
  if (!QUOTATION_VEHICLE_TYPES.includes(vehicleType as QuotationInput["vehicleType"])) return { ok: false, error: "invalid" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "invalid" };
  if (desiredDate && !isIsoDate(desiredDate)) return { ok: false, error: "invalid" };
  if (extras.some((value) => !QUOTATION_EXTRAS.includes(value as QuotationInput["extras"][number]))) return { ok: false, error: "invalid" };

  return {
    ok: true,
    value: {
      requestKey,
      companyName: optional(form.get("companyName"), 160),
      contactName,
      phone,
      lineId: optional(form.get("lineId"), 100),
      email,
      origin,
      destination,
      quantity,
      vehicleType: vehicleType as QuotationInput["vehicleType"],
      desiredDate,
      extras: extras as QuotationInput["extras"],
      notes: optional(form.get("notes"), 1500),
    },
  };
}

function normalizeThaiPhone(value: string): string | null {
  const compact = value.replace(/[\s()-]/g, "");
  if (/^0\d{8,9}$/.test(compact)) return compact;
  if (/^\+66\d{8,9}$/.test(compact)) return `0${compact.slice(3)}`;
  return null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function optional(value: FormDataEntryValue | null, max: number): string | null {
  const result = bounded(value, max);
  return result || null;
}

function bounded(value: FormDataEntryValue | null, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
