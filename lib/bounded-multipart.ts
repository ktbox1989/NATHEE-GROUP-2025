export type BoundedMultipartResult =
  | { ok: true; contentLength: number }
  | { ok: false; error: "unsupported_media_type" | "length_required" | "request_too_large"; status: 411 | 413 | 415 };

export function validateBoundedMultipartRequest(
  contentType: string | null,
  contentLength: string | null,
  maximumBytes: number,
): BoundedMultipartResult {
  if (!hasSafeMultipartBoundary(contentType)) return { ok: false, error: "unsupported_media_type", status: 415 };
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) return { ok: false, error: "request_too_large", status: 413 };
  if (!contentLength || !/^[1-9][0-9]{0,15}$/.test(contentLength)) return { ok: false, error: "length_required", status: 411 };
  const parsed = Number(contentLength);
  if (!Number.isSafeInteger(parsed) || parsed > maximumBytes) return { ok: false, error: "request_too_large", status: 413 };
  return { ok: true, contentLength: parsed };
}

function hasSafeMultipartBoundary(contentType: string | null): boolean {
  if (!contentType) return false;
  const parts = contentType.split(";").map((part) => part.trim());
  if (parts.shift()?.toLowerCase() !== "multipart/form-data") return false;
  const boundaryPart = parts.find((part) => part.toLowerCase().startsWith("boundary="));
  if (!boundaryPart) return false;
  let boundary = boundaryPart.slice(boundaryPart.indexOf("=") + 1);
  if (boundary.startsWith('"') && boundary.endsWith('"')) boundary = boundary.slice(1, -1);
  return boundary.length >= 1
    && boundary.length <= 200
    && !/[\s"\\\r\n]/.test(boundary);
}
