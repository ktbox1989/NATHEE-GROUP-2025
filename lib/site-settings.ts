import { desc, eq, sql } from "drizzle-orm";
import { siteSettingsPublicationEvents, siteSettingsRevisions } from "@/db/schema";
import {
  DEFAULT_SITE_SETTINGS,
  parseSiteSettingsJson,
  type SiteSettings,
} from "@/lib/site-settings-content";

export * from "@/lib/site-settings-content";

export async function getPublishedSiteSettings(): Promise<SiteSettings> {
  try {
    const { getDb } = await import("@/db");
    const db = getDb();
    const publication = await db.select({ revisionId: siteSettingsPublicationEvents.revisionId })
      .from(siteSettingsPublicationEvents)
      // See lib/site-cms.ts: one-second timestamps tie, and `rowid` is the
      // insertion order that a random UUID is not.
      .orderBy(desc(siteSettingsPublicationEvents.createdAt), desc(sql`rowid`))
      .limit(1).get();
    if (!publication) return DEFAULT_SITE_SETTINGS;
    const revision = await db.select({ settingsJson: siteSettingsRevisions.settingsJson })
      .from(siteSettingsRevisions)
      .where(eq(siteSettingsRevisions.id, publication.revisionId)).get();
    return revision ? parseSiteSettingsJson(revision.settingsJson) ?? DEFAULT_SITE_SETTINGS : DEFAULT_SITE_SETTINGS;
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}
