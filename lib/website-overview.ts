/**
 * Reads the Owner's website overview in four bounded queries.
 *
 * Four rather than one per page, per post and per gallery item: the screen is
 * opened often and it is the first thing the Owner sees, so it must not become
 * a fan-out that grows with the amount of content. Each query returns either a
 * single row of counts or one row per managed page, of which there are ten.
 *
 * The whole read fails closed together. A partial overview — real page states
 * beside zeroed post counts — is worse than an honest "cannot read this right
 * now", because every number on the screen would still look authoritative.
 */

import { getD1 } from "@/db";
import {
  buildMediaOverview,
  buildPostOverview,
  buildSettingsOverview,
  buildSitePageOverview,
  unavailableOverview,
  type SitePageStateRow,
  type WebsiteOverview,
} from "@/lib/website-overview-content";
import {
  GALLERY_STATE_COUNTS_SQL,
  POST_STATE_COUNTS_SQL,
  SITE_PAGE_STATE_SQL,
  SITE_SETTINGS_STATE_SQL,
} from "@/lib/website-overview-sql";

export * from "@/lib/website-overview-content";

export async function readWebsiteOverview(): Promise<WebsiteOverview> {
  try {
    const database = getD1();
    const [pages, posts, media, settings] = await Promise.all([
      database.prepare(SITE_PAGE_STATE_SQL).all<SitePageStateRow>(),
      database.prepare(POST_STATE_COUNTS_SQL).first<{ total: number; published: number; hidden: number }>(),
      database
        .prepare(GALLERY_STATE_COUNTS_SQL)
        .first<{ total: number; public_published: number; drafts: number; featured: number; not_public: number }>(),
      database
        .prepare(SITE_SETTINGS_STATE_SQL)
        .first<{ revision_id: string | null; changed_at: string | null; revision_count: number }>(),
    ]);

    return {
      pages: buildSitePageOverview(pages.results ?? []),
      posts: buildPostOverview(posts),
      media: buildMediaOverview(media),
      settings: buildSettingsOverview(settings),
      unavailable: false,
    };
  } catch {
    return unavailableOverview();
  }
}
