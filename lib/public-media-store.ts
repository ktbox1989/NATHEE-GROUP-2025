import { and, eq, inArray } from "drizzle-orm";
import { galleryImageVariants, galleryItems } from "../db/schema.ts";
import type { CmsDatabase } from "./cms-database.ts";
import { validateMedia, type PublicMedia, type PublicMediaVariant } from "./public-cms/contract.ts";
import {
  buildPublicMediaPath,
  publicMediaFormatForContentType,
  publicMediaRoleForStoredRole,
} from "./public-media-delivery.ts";

/**
 * Turns gallery item ids into the media a public payload may carry.
 *
 * This is the production `PostMediaResolver` the contract has been waiting for.
 * It answers with media or with nothing; there is no third state, because a
 * partially resolved image is how a live page ends up with a broken hero and no
 * error anywhere.
 *
 * Three properties carry the safety, and each is enforced here rather than
 * assumed of the caller:
 *
 *  1. Only PUBLISHED and PUBLIC rows are looked at, decided in the query. A
 *     draft, a hidden item, an archived one, an INTERNAL one and a customer's
 *     job evidence are not filtered out afterwards — they are never selected.
 *  2. Every source is a `/assets/media/…` path built by the delivery contract,
 *     so a storage key never leaves the server and the payload can never point
 *     at an authenticated route.
 *  3. The result is checked with Lane A's own `validateMedia` before it is
 *     returned. The mapper that produces media does not get to be the judge of
 *     whether it is publishable.
 *
 * Bounded and index-backed: two queries for any number of ids, both keyed, so
 * a post with a dozen images costs the same round trips as one with a single
 * image. There is no per-image lookup anywhere in this file.
 */

/** More references than any single revision can legitimately carry. */
export const MAX_RESOLVABLE_MEDIA_IDS = 64;

/**
 * A public image needs a format every browser can decode.
 *
 * WebP and AVIF are what the library stores by default, and both are refused
 * as the *only* option: the `<img>` fallback inside a `<picture>` has to be
 * raster and universal, or a browser that understands neither gets an empty
 * box. Lane A's renderer refuses such media outright, so accepting it here
 * would move the failure from publish time — where an editor can fix it — to
 * render time, where nobody sees it.
 */
function hasUniversalFallback(variants: readonly PublicMediaVariant[]): boolean {
  return variants.some(
    (variant) => variant.role === "display" && (variant.format === "jpeg" || variant.format === "png"),
  );
}

function toVariant(row: {
  role: string;
  contentType: string;
  width: number | null;
  height: number | null;
  galleryItemId: string;
}): PublicMediaVariant | null {
  const role = publicMediaRoleForStoredRole(row.role);
  const format = publicMediaFormatForContentType(row.contentType);
  // `ORIGINAL` has no public role, and HEIC/HEIF have no public format. Both
  // are stored on purpose and neither is servable, so both drop out here.
  if (!role || !format) return null;
  // Dimensions are nullable in the schema. A variant without them cannot
  // reserve its space in the layout, and inventing a pair would be a made-up
  // number in a payload that is meant to carry only measured ones.
  if (!Number.isInteger(row.width) || !Number.isInteger(row.height)) return null;
  if ((row.width as number) <= 0 || (row.height as number) <= 0) return null;

  const src = buildPublicMediaPath({ itemId: row.galleryItemId, role, format });
  if (!src) return null;

  return { src, width: row.width as number, height: row.height as number, format, role };
}

export type UnresolvableMedia = { id: string; reason: string };

export type PublicMediaResolution = {
  media: Map<string, PublicMedia>;
  /** Ids that exist but cannot be served, with the reason, for the editor. */
  unresolvable: UnresolvableMedia[];
};

/**
 * Resolves a bounded set of gallery item ids in two queries.
 *
 * An id that is absent from `media` is not publishable, whatever the reason —
 * missing, draft, private, or lacking a renderable variant. `unresolvable`
 * separates "the row is there but cannot be shown" from "there is no such
 * item", because those are different mistakes and an editor fixes them
 * differently.
 */
export async function resolvePublicMedia(
  db: CmsDatabase,
  itemIds: readonly string[],
): Promise<PublicMediaResolution> {
  const media = new Map<string, PublicMedia>();
  const unresolvable: UnresolvableMedia[] = [];

  const wanted = [...new Set(itemIds)].filter((id) => typeof id === "string" && id.length > 0);
  if (wanted.length === 0) return { media, unresolvable };
  if (wanted.length > MAX_RESOLVABLE_MEDIA_IDS) {
    // Refused rather than truncated: silently resolving the first sixty-four
    // would publish a revision whose remaining images were never checked.
    return {
      media,
      unresolvable: wanted.map((id) => ({ id, reason: "too many media references in one revision" })),
    };
  }

  const items = await db
    .select({
      id: galleryItems.id,
      altText: galleryItems.altText,
      caption: galleryItems.caption,
    })
    .from(galleryItems)
    .where(
      and(
        inArray(galleryItems.id, wanted),
        eq(galleryItems.status, "PUBLISHED"),
        eq(galleryItems.visibility, "PUBLIC"),
      ),
    )
    .all();

  const found = new Set(items.map((item) => item.id));
  for (const id of wanted) {
    if (!found.has(id)) unresolvable.push({ id, reason: "not a published public gallery item" });
  }
  if (items.length === 0) return { media, unresolvable };

  const variantRows = await db
    .select({
      galleryItemId: galleryImageVariants.galleryItemId,
      role: galleryImageVariants.role,
      contentType: galleryImageVariants.contentType,
      width: galleryImageVariants.width,
      height: galleryImageVariants.height,
    })
    .from(galleryImageVariants)
    .where(inArray(galleryImageVariants.galleryItemId, [...found]))
    .all();

  const byItem = new Map<string, PublicMediaVariant[]>();
  for (const row of variantRows) {
    const variant = toVariant(row);
    if (!variant) continue;
    const existing = byItem.get(row.galleryItemId);
    if (existing) existing.push(variant);
    else byItem.set(row.galleryItemId, [variant]);
  }

  for (const item of items) {
    const variants = (byItem.get(item.id) ?? []).sort(
      (left, right) => left.role.localeCompare(right.role) || left.format.localeCompare(right.format),
    );
    const candidate: PublicMedia = {
      id: item.id,
      altText: item.altText,
      caption: item.caption?.trim() ? item.caption.trim() : null,
      variants,
    };

    const violations = validateMedia(candidate, "media");
    if (violations.length > 0) {
      unresolvable.push({ id: item.id, reason: violations[0]?.reason ?? "media failed the public contract" });
      continue;
    }
    if (!hasUniversalFallback(variants)) {
      unresolvable.push({ id: item.id, reason: "no jpeg or png display variant to fall back to" });
      continue;
    }

    media.set(item.id, candidate);
  }

  return { media, unresolvable };
}

/**
 * A synchronous resolver over an already-loaded set.
 *
 * The mapper is synchronous by design — it is a pure function of stored content
 * — so the loading happens once, in the caller, and the resolver is a lookup.
 * That is what keeps a post with a dozen images from becoming a dozen queries.
 */
export function createPublicMediaResolver(
  resolution: PublicMediaResolution,
): (imageItemId: string) => PublicMedia | null {
  return (imageItemId: string) => resolution.media.get(imageItemId) ?? null;
}
