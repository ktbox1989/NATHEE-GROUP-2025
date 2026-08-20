import type { MotorcycleImageVariantRole } from "@/db/schema";

export const MOTORCYCLE_IMAGE_MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;
export const MOTORCYCLE_IMAGE_MAX_DISPLAY_BYTES = 3 * 1024 * 1024;
export const MOTORCYCLE_IMAGE_MAX_THUMBNAIL_BYTES = 1024 * 1024;
export const MOTORCYCLE_IMAGE_VARIANT_TYPES = new Set(["image/webp", "image/avif"]);

export type MotorcycleImageRequestedRole = MotorcycleImageVariantRole | "ORIGINAL";

export function isMotorcycleImageRequestKey(value: string): boolean {
  return /^motorcycle-image-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseMotorcycleImageRole(value: string | null): MotorcycleImageRequestedRole {
  if (value?.toLowerCase() === "original") return "ORIGINAL";
  if (value?.toLowerCase() === "thumbnail") return "THUMBNAIL";
  return "DISPLAY";
}

export function preferredMotorcycleImageContentTypes(acceptHeader: string | null): readonly string[] {
  const accept = acceptHeader?.toLowerCase() ?? "";
  const preferred: string[] = [];
  if (accept.includes("image/avif")) preferred.push("image/avif");
  if (accept.includes("image/webp")) preferred.push("image/webp");
  return [...new Set(preferred)];
}

export function parseMotorcycleImageDimension(value: FormDataEntryValue | null): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 50_000 ? parsed : undefined;
}

export function hasRequiredMotorcycleImageVariants(
  variants: ReadonlyArray<{ role: MotorcycleImageVariantRole; contentType: string }>,
): boolean {
  return variants.some((variant) => variant.role === "DISPLAY" && variant.contentType === "image/webp")
    && variants.some((variant) => variant.role === "THUMBNAIL" && variant.contentType === "image/webp");
}

export function motorcycleImageVariantByteLimit(role: MotorcycleImageVariantRole): number {
  return role === "THUMBNAIL" ? MOTORCYCLE_IMAGE_MAX_THUMBNAIL_BYTES : MOTORCYCLE_IMAGE_MAX_DISPLAY_BYTES;
}
