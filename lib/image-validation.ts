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
  ["image/avif", "avif"],
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

  if (contentType === "image/avif") {
    return bytes.length >= 12 &&
      ascii(bytes, 4, 8) === "ftyp" &&
      ["avif", "avis"].includes(ascii(bytes, 8, 12));
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

export type ImageDimensions = { width: number; height: number };

export function readImageDimensions(
  bytes: Uint8Array,
  contentType: string,
): ImageDimensions | undefined {
  if (!hasExpectedImageSignature(bytes, contentType)) return undefined;
  const dimensions = contentType === "image/png"
    ? readPngDimensions(bytes)
    : contentType === "image/jpeg"
      ? readJpegDimensions(bytes)
      : contentType === "image/webp"
        ? readWebpDimensions(bytes)
        : contentType === "image/avif" || contentType === "image/heic" || contentType === "image/heif"
          ? readIsoMediaDimensions(bytes)
          : undefined;
  return dimensions && isSafeImageGeometry(dimensions) ? dimensions : undefined;
}

export function imageDimensionsMatchClaim(
  dimensions: ImageDimensions,
  claimedWidth: number | null | undefined,
  claimedHeight: number | null | undefined,
  requireClaim = true,
): boolean {
  if (claimedWidth == null || claimedHeight == null) return !requireClaim;
  return dimensions.width === claimedWidth && dimensions.height === claimedHeight;
}

function isSafeImageGeometry({ width, height }: ImageDimensions): boolean {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width >= 1
    && height >= 1
    && width <= 50_000
    && height <= 50_000
    && width * height <= 80_000_000;
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24 || ascii(bytes, 12, 16) !== "IHDR") return undefined;
  const view = viewOf(bytes);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (isJpegStartOfFrame(marker)) {
      if (length < 7) return undefined;
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return undefined;
}

function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30) return undefined;
  const chunk = ascii(bytes, 12, 16);
  if (chunk === "VP8X") {
    return { width: 1 + uint24le(bytes, 24), height: 1 + uint24le(bytes, 27) };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  if (chunk === "VP8 " && ascii(bytes, 23, 26) === "\u009d\u0001*") {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  return undefined;
}

function readIsoMediaDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  const view = viewOf(bytes);
  for (let offset = 4; offset + 16 <= bytes.length; offset += 1) {
    if (ascii(bytes, offset, offset + 4) !== "ispe") continue;
    const boxStart = offset - 4;
    const boxSize = view.getUint32(boxStart, false);
    if (boxSize < 20 || boxStart + boxSize > bytes.length) continue;
    return { width: view.getUint32(offset + 8, false), height: view.getUint32(offset + 12, false) };
  }
  return undefined;
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return "";
  return String.fromCharCode(...bytes.slice(start, end));
}
