import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { CmsPublicPage } from "@/components/cms-public-page";
import { getDb } from "@/db";
import { sitePageRevisions, sitePages } from "@/db/schema";
import { can } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";
import { isSitePageSlug, parseCmsPageContentJson } from "@/lib/site-cms";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ revision?: string }> };

export default async function SitePagePreview({ params, searchParams }: Props) {
  const actor = await requireActor("/app/site-content");
  if (!can(actor, "site:read")) redirect("/app");
  const { slug } = await params;
  const { revision } = await searchParams;
  if (!isSitePageSlug(slug) || !revision) notFound();
  const db = getDb();
  const page = await db.select({ id: sitePages.id }).from(sitePages).where(eq(sitePages.slug, slug)).get();
  if (!page) notFound();
  const row = await db.select({ contentJson: sitePageRevisions.contentJson }).from(sitePageRevisions).where(and(eq(sitePageRevisions.id, revision), eq(sitePageRevisions.pageId, page.id))).get();
  const content = row ? parseCmsPageContentJson(row.contentJson) : null;
  if (!content) notFound();
  return <CmsPublicPage content={content} slug={slug} preview />;
}
