import { and, desc, eq, sql } from "drizzle-orm";
import { sitePagePublicationEvents, sitePageRevisions, sitePages } from "../db/schema.ts";
import type { CmsDatabase } from "./cms-database.ts";
import { parseCmsPageContentJson, type CmsPageContent, type SitePageSlug } from "./site-cms-content.ts";

export * from "./site-cms-content.ts";

export type PublishedSitePageState =
  | { status: "UNMANAGED" | "HIDDEN" | "BROKEN"; content: null; revisionId: null }
  | { status: "PUBLISHED"; content: CmsPageContent; revisionId: string };

export async function getPublishedSitePage(
  slug: SitePageSlug,
  database?: CmsDatabase,
): Promise<PublishedSitePageState> {
  try {
    // Imported only when no handle was supplied: resolving the D1 binding is
    // what makes this module unusable outside the worker runtime.
    const db = database ?? (await import("@/db")).getDb();
    const page = await db.select({ id: sitePages.id }).from(sitePages).where(eq(sitePages.slug, slug)).get();
    if (!page) return { status: "UNMANAGED", content: null, revisionId: null };
    const event = await db.select({ action: sitePagePublicationEvents.action, revisionId: sitePagePublicationEvents.revisionId })
      .from(sitePagePublicationEvents).where(eq(sitePagePublicationEvents.pageId, page.id))
      // One-second timestamps tie; `rowid` is insertion order and is never
      // reused here, because deletion is refused by trigger. Without it a
      // publish and a revert inside the same second resolve by random UUID.
      .orderBy(desc(sitePagePublicationEvents.createdAt), desc(sql`rowid`)).limit(1).get();
    if (!event) return { status: "UNMANAGED", content: null, revisionId: null };
    if (event.action === "HIDE" || !event.revisionId) return { status: "HIDDEN", content: null, revisionId: null };
    const revision = await db.select({ id: sitePageRevisions.id, contentJson: sitePageRevisions.contentJson })
      .from(sitePageRevisions).where(and(eq(sitePageRevisions.id, event.revisionId), eq(sitePageRevisions.pageId, page.id))).get();
    const content = revision ? parseCmsPageContentJson(revision.contentJson) : null;
    return content && revision ? { status: "PUBLISHED", content, revisionId: revision.id } : { status: "BROKEN", content: null, revisionId: null };
  } catch {
    return { status: "UNMANAGED", content: null, revisionId: null };
  }
}
