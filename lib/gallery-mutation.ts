import type { GalleryItemStatus, GalleryVisibility } from "../db/schema.ts";
import { canPublishGalleryItem, galleryVisibilities } from "./gallery.ts";

/**
 * The rules that decide what may be done to a gallery item.
 *
 * These lived inline in `app/api/gallery/[id]/route.ts`, which made them
 * unreachable from a test: the route needs a Cloudflare binding to run at all.
 * The policy is the part worth proving — who may act, from which state, and what
 * a published item is allowed to be — so it lives here and the route consults it.
 */

export const GALLERY_ACTIONS = ["UPDATE", "PUBLISH", "HIDE", "ARCHIVE", "FEATURE", "UNFEATURE"] as const;
export type GalleryAction = (typeof GALLERY_ACTIONS)[number];

export function isGalleryAction(value: string): value is GalleryAction {
  return (GALLERY_ACTIONS as readonly string[]).includes(value);
}

/**
 * `gallery:write` is enough to edit a draft. Anything that changes what the
 * public sees — or any edit to an item that is already published — additionally
 * needs `gallery:publish`, so an editor cannot alter live media on their own.
 */
export function requiresPublishPermission(action: string, currentStatus: GalleryItemStatus): boolean {
  return currentStatus === "PUBLISHED" || ["PUBLISH", "HIDE", "FEATURE", "UNFEATURE"].includes(action);
}

export type GalleryScope = {
  visibility: string;
  companyId: string | null;
  jobId: string | null;
};

export type GalleryScopeVerdict =
  | { ok: true; visibility: GalleryVisibility }
  | { ok: false; reason: "invalid_gallery" | "invalid_scope" };

/**
 * Visibility and ownership are one decision, not two.
 *
 * A PUBLIC photograph is company-less by construction: attaching a customer to
 * something shown on the marketing site is how a customer's job leaks into
 * public view. A CUSTOMER_JOB photograph is the mirror — it is meaningless
 * without the company and job it belongs to, because that pair is what scopes
 * who may see it.
 */
export function validateGalleryScope(scope: GalleryScope): GalleryScopeVerdict {
  const visibility = scope.visibility.trim().toUpperCase();
  if (!galleryVisibilities.has(visibility as GalleryVisibility)) return { ok: false, reason: "invalid_gallery" };
  if (visibility === "PUBLIC" && (scope.companyId || scope.jobId)) return { ok: false, reason: "invalid_scope" };
  if (visibility === "CUSTOMER_JOB" && (!scope.companyId || !scope.jobId)) {
    return { ok: false, reason: "invalid_scope" };
  }
  return { ok: true, visibility: visibility as GalleryVisibility };
}

/**
 * What a photograph must have before the public may see it: an active category,
 * a rendered display variant, real alt text, and a visibility that is not
 * internal-only.
 */
export function canPublishGallery(input: {
  categoryStatus: string | undefined;
  visibility: GalleryVisibility;
  hasDisplayVariant: boolean;
  altText: string;
}): boolean {
  if (input.categoryStatus !== "ACTIVE") return false;
  return canPublishGalleryItem({
    visibility: input.visibility,
    hasDisplayVariant: input.hasDisplayVariant,
    altText: input.altText,
  });
}

/**
 * Featuring promotes a photograph on the public site, so only something already
 * public can be featured. Hiding or archiving clears it, which is why those
 * paths reset the flag rather than leaving a hidden item featured.
 */
export function canFeatureGallery(input: { status: GalleryItemStatus; visibility: GalleryVisibility }): boolean {
  return input.status === "PUBLISHED" && input.visibility === "PUBLIC";
}

/** Statuses that clear the featured flag whenever they are entered. */
export function clearsFeatured(action: GalleryAction): boolean {
  return action === "HIDE" || action === "ARCHIVE" || action === "UNFEATURE";
}

/** The only (status, visibility) pair the public gallery and CMS may serve. */
export function isPubliclyServable(input: { status: string; visibility: string; categoryStatus: string }): boolean {
  return input.status === "PUBLISHED" && input.visibility === "PUBLIC" && input.categoryStatus === "ACTIVE";
}
