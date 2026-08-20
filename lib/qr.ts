export const MOTORCYCLE_QR_PREFIX = "NATHEE:MC:";
export const MOTORCYCLE_PUBLIC_ID_PATTERN = /^mc_[a-f0-9]{32}$/;
export const QR_INPUT_MAX_LENGTH = 128;
export const LABEL_BATCH_SIZE = 48;

export function isMotorcyclePublicId(value: string): boolean {
  return MOTORCYCLE_PUBLIC_ID_PATTERN.test(value);
}

export function createMotorcycleQrToken(publicId: string): string {
  if (!isMotorcyclePublicId(publicId)) {
    throw new Error("Invalid motorcycle public identifier.");
  }
  return `${MOTORCYCLE_QR_PREFIX}${publicId}`;
}

export function parseMotorcycleQrToken(rawValue: string): string | null {
  if (!rawValue || rawValue.length > QR_INPUT_MAX_LENGTH || rawValue !== rawValue.trim()) {
    return null;
  }

  const publicId = rawValue.startsWith(MOTORCYCLE_QR_PREFIX)
    ? rawValue.slice(MOTORCYCLE_QR_PREFIX.length)
    : rawValue;
  return isMotorcyclePublicId(publicId) ? publicId : null;
}

export function parseLabelCursor(value: string | undefined): number | null {
  if (value === undefined) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
