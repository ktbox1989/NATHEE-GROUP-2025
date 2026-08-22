import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { galleryCategories, galleryItems } from "@/db/schema";
import { getPublicGalleryFallback, getPublicMediaFallback } from "@/lib/public-gallery-fallback";
import type { PublishReferences, PublishReferenceResolution } from "@/lib/site-cms-publish";

/**
 * Resolves references the same way the public renderer does, so the answer here
 * is the answer a reader gets.
 *
 * The renderer accepts a gallery item that is PUBLISHED and PUBLIC in the
 * database, and otherwise falls back to the Owner-supplied static manifest.
 * Checking only the database would refuse legitimate publishes of the pages that
 * ship with the site; checking only the manifest would let a hidden item pass.
 */
export async function resolvePublishReferences(
  references: PublishReferences,
): Promise<PublishReferenceResolution> {
  const publishableImageItemIds = new Set<string>();
  const publishableCategorySlugs = new Set<string>();

  for (const id of references.imageItemIds) {
    if (getPublicMediaFallback(id)) publishableImageItemIds.add(id);
  }
  for (const slug of references.galleryCategorySlugs) {
    if (getPublicGalleryFallback(slug, 1).length > 0) publishableCategorySlugs.add(slug);
  }

  const unresolvedImages = references.imageItemIds.filter((id) => !publishableImageItemIds.has(id));
  const unresolvedCategories = references.galleryCategorySlugs.filter(
    (slug) => !publishableCategorySlugs.has(slug),
  );
  if (unresolvedImages.length === 0 && unresolvedCategories.length === 0) {
    return { publishableImageItemIds, publishableCategorySlugs };
  }

  const db = getDb();
  if (unresolvedImages.length > 0) {
    const rows = await db
      .select({ id: galleryItems.id })
      .from(galleryItems)
      .where(
        and(
          inArray(galleryItems.id, [...unresolvedImages]),
          eq(galleryItems.status, "PUBLISHED"),
          eq(galleryItems.visibility, "PUBLIC"),
        ),
      )
      .all();
    for (const row of rows) publishableImageItemIds.add(row.id);
  }
  if (unresolvedCategories.length > 0) {
    const rows = await db
      .select({ slug: galleryCategories.slug })
      .from(galleryCategories)
      .where(
        and(inArray(galleryCategories.slug, [...unresolvedCategories]), eq(galleryCategories.status, "ACTIVE")),
      )
      .all();
    for (const row of rows) publishableCategorySlugs.add(row.slug);
  }

  return { publishableImageItemIds, publishableCategorySlugs };
}
