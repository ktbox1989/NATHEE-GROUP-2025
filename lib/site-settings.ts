import { desc, eq, sql } from "drizzle-orm";
import { siteSettingsPublicationEvents, siteSettingsRevisions } from "../db/schema.ts";
import type { CmsDatabase } from "./cms-database.ts";
import {
  DEFAULT_SITE_SETTINGS,
  parseSiteSettingsJson,
  type SiteSettings,
} from "./site-settings-content.ts";

export * from "./site-settings-content.ts";

export async function getPublishedSiteSettings(database?: CmsDatabase): Promise<SiteSettings> {
  try {
    // Imported only when no handle was supplied, exactly as `getPublishedSitePage`
    // does: resolving the D1 binding is what makes this module unusable outside
    // the worker runtime, and taking the handle is what lets the contact fields
    // be proven end to end against a real database rather than described.
    const db = database ?? (await import("@/db")).getDb();
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
