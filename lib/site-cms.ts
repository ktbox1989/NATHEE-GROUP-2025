import { and, desc, eq } from "drizzle-orm";
import { sitePagePublicationEvents, sitePageRevisions, sitePages } from "@/db/schema";
import { parseCmsPageContentJson, type CmsPageContent, type SitePageSlug } from "@/lib/site-cms-content";

export * from "@/lib/site-cms-content";

export type PublishedSitePageState =
  | { status: "UNMANAGED" | "HIDDEN" | "BROKEN"; content: null; revisionId: null }
  | { status: "PUBLISHED"; content: CmsPageContent; revisionId: string };

export async function getPublishedSitePage(slug: SitePageSlug): Promise<PublishedSitePageState> {
  try {
    const { getDb } = await import("@/db");
    const db = getDb();
    const page = await db.select({ id: sitePages.id }).from(sitePages).where(eq(sitePages.slug, slug)).get();
    if (!page) return { status: "UNMANAGED", content: null, revisionId: null };
    const event = await db.select({ action: sitePagePublicationEvents.action, revisionId: sitePagePublicationEvents.revisionId })
      .from(sitePagePublicationEvents).where(eq(sitePagePublicationEvents.pageId, page.id))
      .orderBy(desc(sitePagePublicationEvents.createdAt), desc(sitePagePublicationEvents.id)).limit(1).get();
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
