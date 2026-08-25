import type { CmsDatabase } from "./cms-database.ts";
import type { PublicMedia } from "./public-cms/contract.ts";
import { resolvePublicMedia } from "./public-media-store.ts";
import type { SiteSettings } from "./site-settings-content.ts";

/**
 * The two photographs published site settings can point at, resolved for a
 * reader who has no session.
 *
 * `brand.logoItemId` and `contact.lineQrItemId` are gallery item ids, exactly
 * like a section's `imageItemId`. They are resolved here through the one
 * delivery contract rather than by building a URL, which decides three things
 * at once and decides them the same way for both:
 *
 *  - only a `PUBLISHED` and `PUBLIC` row can resolve at all. The query never
 *    selects a draft, a hidden or archived item, an `INTERNAL` photograph, or a
 *    customer's `CUSTOMER_JOB` evidence, so an id that names one comes back as
 *    nothing rather than as something the caller has to remember to filter;
 *  - every source is a `/assets/media/…` path built by the delivery contract,
 *    so no storage key leaves the server and no public payload can point at the
 *    authenticated gallery image route, which `validateMediaSrc` refuses by its
 *    prefix outright;
 *  - a jpeg or png display variant is required, so a `<picture>` always has a
 *    raster fallback and the QR is decodable by every client.
 *
 * A QR that cannot be resolved is `null`, and the caller renders nothing. That
 * is the honest outcome: an unreadable QR on a contact page is worse than an
 * absent one, because a visitor will try to scan it.
 */

export type SettingsMedia = {
  logo: PublicMedia | null;
  lineQr: PublicMedia | null;
  /**
   * Ids that were named and could not be served, with the reason.
   *
   * Publishing already refuses a settings revision whose media cannot be
   * resolved (`collectSettingsReferences`), so a non-empty list here means the
   * item was withdrawn *after* publication. Reported rather than swallowed, so
   * an Owner can be told which photograph stopped being public.
   */
  unresolvable: Array<{ id: string; reason: string }>;
};

export async function resolveSettingsMedia(
  db: CmsDatabase,
  settings: SiteSettings,
): Promise<SettingsMedia> {
  const wanted = [settings.brand.logoItemId, settings.contact.lineQrItemId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (wanted.length === 0) return { logo: null, lineQr: null, unresolvable: [] };

  const resolution = await resolvePublicMedia(db, wanted);
  return {
    logo: settings.brand.logoItemId ? resolution.media.get(settings.brand.logoItemId) ?? null : null,
    lineQr: settings.contact.lineQrItemId
      ? resolution.media.get(settings.contact.lineQrItemId) ?? null
      : null,
    unresolvable: resolution.unresolvable,
  };
}
