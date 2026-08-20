export const MOTORCYCLE_QR_PREFIX = "NATHEE:MC:";
export const MOTORCYCLE_PUBLIC_ID_PATTERN = /^mc_[a-f0-9]{32}$/;
export const QR_INPUT_MAX_LENGTH = 128;
export const LABEL_BATCH_SIZE = 48;

export const OPERATIONAL_QR_ENTITY_TYPES = ["motorcycle", "job", "yard", "truck", "trip"] as const;
export type OperationalQrEntityType = (typeof OPERATIONAL_QR_ENTITY_TYPES)[number];

const qrContracts: Record<OperationalQrEntityType, { prefix: string; pattern: RegExp; idPrefix: string }> = {
  motorcycle: { prefix: MOTORCYCLE_QR_PREFIX, pattern: MOTORCYCLE_PUBLIC_ID_PATTERN, idPrefix: "mc_" },
  job: { prefix: "NATHEE:JOB:", pattern: /^job_[a-f0-9]{32}$/, idPrefix: "job_" },
  yard: { prefix: "NATHEE:YARD:", pattern: /^yard_[a-f0-9]{32}$/, idPrefix: "yard_" },
  truck: { prefix: "NATHEE:TRUCK:", pattern: /^truck_[a-f0-9]{32}$/, idPrefix: "truck_" },
  trip: { prefix: "NATHEE:TRIP:", pattern: /^trip_[a-f0-9]{32}$/, idPrefix: "trip_" },
};

export type ParsedOperationalQrToken = {
  entityType: OperationalQrEntityType;
  publicId: string;
};

export function createOpaquePublicId(entityType: OperationalQrEntityType): string {
  return `${qrContracts[entityType].idPrefix}${crypto.randomUUID().replaceAll("-", "")}`;
}

export function isOperationalPublicId(entityType: OperationalQrEntityType, value: string): boolean {
  return qrContracts[entityType].pattern.test(value);
}

export function createOperationalQrToken(entityType: OperationalQrEntityType, publicId: string): string {
  if (!isOperationalPublicId(entityType, publicId)) throw new Error("Invalid operational public identifier.");
  return `${qrContracts[entityType].prefix}${publicId}`;
}

export function parseOperationalQrToken(rawValue: string): ParsedOperationalQrToken | null {
  if (!rawValue || rawValue.length > QR_INPUT_MAX_LENGTH || rawValue !== rawValue.trim()) return null;
  for (const entityType of OPERATIONAL_QR_ENTITY_TYPES) {
    const contract = qrContracts[entityType];
    const publicId = rawValue.startsWith(contract.prefix)
      ? rawValue.slice(contract.prefix.length)
      : rawValue;
    if (contract.pattern.test(publicId)) return { entityType, publicId };
  }
  return null;
}

export function isMotorcyclePublicId(value: string): boolean {
  return MOTORCYCLE_PUBLIC_ID_PATTERN.test(value);
}

export function createMotorcycleQrToken(publicId: string): string {
  return createOperationalQrToken("motorcycle", publicId);
}

export function parseMotorcycleQrToken(rawValue: string): string | null {
  const parsed = parseOperationalQrToken(rawValue);
  return parsed?.entityType === "motorcycle" ? parsed.publicId : null;
}

export function parseLabelCursor(value: string | undefined): number | null {
  if (value === undefined) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
