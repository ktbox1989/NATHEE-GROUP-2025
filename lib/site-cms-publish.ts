import type { CmsPageContent } from "./site-cms-content.ts";
import type { SiteSettings } from "./site-settings-content.ts";

/**
 * Publishing decides what the public site shows. It did not check that the media
 * a revision points at can actually be shown.
 *
 * The public renderer serves a gallery item only when it is PUBLISHED and PUBLIC,
 * and falls back to the Owner-supplied static manifest otherwise. An item that is
 * neither simply renders as nothing. So an editor could pick an image, save,
 * publish, and get a live page with a missing hero — with no error anywhere,
 * because every individual step succeeded.
 *
 * These helpers collect what a revision points at so publish can resolve it
 * first and refuse rather than ship a page that is quietly incomplete.
 */

export type PublishReferences = {
  /** Gallery items a reader would be shown. */
  imageItemIds: readonly string[];
  /** Gallery categories a section draws its images from. */
  galleryCategorySlugs: readonly string[];
};

export type PublishReferenceResolution = {
  publishableImageItemIds: ReadonlySet<string>;
  publishableCategorySlugs: ReadonlySet<string>;
};

export type UnpublishableReference = {
  kind: "image" | "category";
  id: string;
};

/**
 * Only enabled sections count. A disabled section is not rendered, and enabling
 * one needs a new revision and a new publish, so it is checked then.
 */
export function collectPageReferences(content: CmsPageContent): PublishReferences {
  const imageItemIds = new Set<string>();
  const galleryCategorySlugs = new Set<string>();
  for (const section of content.sections) {
    if (!section.enabled) continue;
    if (section.imageItemId) imageItemIds.add(section.imageItemId);
    // An empty slug means every category, which needs no particular one to exist.
    if (section.type === "GALLERY" && section.galleryCategorySlug) {
      galleryCategorySlugs.add(section.galleryCategorySlug);
    }
  }
  return { imageItemIds: [...imageItemIds].sort(), galleryCategorySlugs: [...galleryCategorySlugs].sort() };
}

export function collectSettingsReferences(settings: SiteSettings): PublishReferences {
  // The logo appears on every page and the LINE QR is the channel the contact
  // page tells people to scan. Publishing settings that point at media a reader
  // cannot be served would blank either one site-wide, and the QR silently -
  // nobody sees a missing QR from inside the editor.
  const imageItemIds = [settings.brand.logoItemId, settings.contact.lineQrItemId]
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .sort();
  return { imageItemIds, galleryCategorySlugs: [] };
}

/**
 * What a reader would not be shown. Order is stable so the first problem
 * reported is the same one every time.
 */
export function unpublishableReferences(
  references: PublishReferences,
  resolution: PublishReferenceResolution,
): readonly UnpublishableReference[] {
  const problems: UnpublishableReference[] = [];
  for (const id of references.imageItemIds) {
    if (!resolution.publishableImageItemIds.has(id)) problems.push({ kind: "image", id });
  }
  for (const id of references.galleryCategorySlugs) {
    if (!resolution.publishableCategorySlugs.has(id)) problems.push({ kind: "category", id });
  }
  return problems;
}

export function hasPublishableReferences(
  references: PublishReferences,
  resolution: PublishReferenceResolution,
): boolean {
  return unpublishableReferences(references, resolution).length === 0;
}

/** A bounded, URL-safe form of the first problem, for the editor's error message. */
export function firstUnpublishableLabel(problems: readonly UnpublishableReference[]): string | null {
  const first = problems[0];
  if (!first) return null;
  const id = first.id.slice(0, 80).replace(/[^A-Za-z0-9_-]/g, "");
  return id ? `${first.kind}:${id}` : first.kind;
}
