const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);

export const SUPPORTED_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

export function hasExpectedImageSignature(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  if (contentType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }

  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }

  if (contentType === "image/webp") {
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  }

  if (contentType === "image/heic" || contentType === "image/heif") {
    return bytes.length >= 12 &&
      ascii(bytes, 4, 8) === "ftyp" &&
      HEIF_BRANDS.has(ascii(bytes, 8, 12));
  }

  return false;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return "";
  return String.fromCharCode(...bytes.slice(start, end));
}
