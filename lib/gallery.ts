import type { GalleryItemStatus, GalleryVariantRole, GalleryVisibility } from "@/db/schema";

export const GALLERY_PAGE_SIZE = 24;
export const GALLERY_ADMIN_PAGE_SIZE = 50;
export const GALLERY_MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
export const GALLERY_MAX_VARIANT_BYTES = 5 * 1024 * 1024;

export const galleryStatuses = new Set<GalleryItemStatus>(["DRAFT", "PUBLISHED", "HIDDEN", "ARCHIVED"]);
export const galleryVisibilities = new Set<GalleryVisibility>(["PUBLIC", "CUSTOMER_JOB", "INTERNAL"]);
export const galleryVariantRoles = new Set<GalleryVariantRole>(["ORIGINAL", "DISPLAY", "THUMBNAIL"]);

export function isGalleryUploadRequestKey(value: string): boolean {
  return /^gallery-upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isConfirmedGalleryUploadResponse(status: number, payload: unknown): boolean {
  if (status < 200 || status >= 300 || typeof payload !== "object" || payload === null) return false;
  const response = payload as { ok?: unknown; galleryItemId?: unknown; duplicate?: unknown };
  return response.ok === true
    && typeof response.galleryItemId === "string"
    && response.galleryItemId.length > 0
    && typeof response.duplicate === "boolean";
}

export function normalizeGallerySlug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized.length >= 2 && normalized.length <= 80 ? normalized : "";
}

export function parseGallerySortOrder(value: FormDataEntryValue | null): number | undefined {
  if (value === null || String(value).trim() === "") return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000 ? number : undefined;
}

export function parsePositiveDimension(value: FormDataEntryValue | null): number | null | undefined {
  if (value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 50_000 ? number : undefined;
}

export function boundedText(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function preferredGalleryContentTypes(acceptHeader: string | null): readonly string[] {
  const accept = acceptHeader?.toLowerCase() ?? "";
  const preferred: string[] = [];
  if (accept.includes("image/avif")) preferred.push("image/avif");
  if (accept.includes("image/webp")) preferred.push("image/webp");
  return [...new Set([...preferred, "image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"])];
}

export function canPublishGalleryItem(input: {
  visibility: GalleryVisibility;
  hasDisplayVariant: boolean;
  altText: string;
}): boolean {
  return input.visibility !== "INTERNAL" && input.hasDisplayVariant && input.altText.trim().length >= 3;
}
