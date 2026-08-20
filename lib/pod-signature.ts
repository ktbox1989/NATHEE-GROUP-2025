export const POD_SIGNATURE_CONTENT_TYPE = "image/png";
export const POD_SIGNATURE_MAX_BYTES = 1024 * 1024;

export function parsePodSignatureDimension(value: FormDataEntryValue | null): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 4096 ? parsed : undefined;
}

export function isPodSignatureGeometry(width: number, height: number): boolean {
  return width >= 200 && width <= 2048 && height >= 80 && height <= 1024 && width > height;
}

export function hasPodSignatureAttestation(value: FormDataEntryValue | null): boolean {
  return value === "confirmed";
}

export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.byteLength < 24) return undefined;
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!pngSignature.every((value, index) => bytes[index] === value)) return undefined;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : undefined;
}
