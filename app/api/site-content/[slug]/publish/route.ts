import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, sitePagePublicationEvents, sitePageRevisions, sitePages } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { decidePublication, sitePagePublishEvent } from "@/lib/publication-events";
import { isSameOrigin } from "@/lib/same-origin";
import { isSitePageSlug, parseCmsPageContentJson } from "@/lib/site-cms";
import { collectPageReferences, firstUnpublishableLabel, unpublishableReferences } from "@/lib/site-cms-publish";
import { resolvePublishReferences } from "@/lib/site-cms-publish-store";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "site:publish")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);
  const { slug } = await context.params;
  if (!isSitePageSlug(slug)) return NextResponse.redirect(new URL("/app/site-content?error=invalid_page", request.url), 303);
  const form = await request.formData();
  const action = String(form.get("action") ?? "").toUpperCase();
  const requestKey = text(form.get("requestKey"), 120);
  const revisionId = text(form.get("revisionId"), 100) || null;
  const note = text(form.get("note"), 500) || null;
  if (!requestKey || !["PUBLISH", "HIDE"].includes(action) || action === "PUBLISH" && !revisionId || action === "HIDE" && (revisionId || slug === "home")) return redirectError(request, slug, "invalid_publish");
  const db = getDb();
  const page = await db.select({ id: sitePages.id }).from(sitePages).where(eq(sitePages.slug, slug)).get();
  if (!page) return redirectError(request, slug, "page_not_saved");
  const existing = await db.select({ id: sitePagePublicationEvents.id }).from(sitePagePublicationEvents).where(eq(sitePagePublicationEvents.requestKey, requestKey)).get();
  if (existing) return NextResponse.redirect(new URL(`/app/site-content/${slug}?status=already_published`, request.url), 303);
  let referenceCount = 0;
  if (action === "PUBLISH") {
    const revision = await db.select({ id: sitePageRevisions.id, contentJson: sitePageRevisions.contentJson }).from(sitePageRevisions).where(and(eq(sitePageRevisions.id, revisionId!), eq(sitePageRevisions.pageId, page.id))).get();
    if (!revision) return redirectError(request, slug, "revision_not_found");
    // Publishing decides what the public site shows, so the media it points at
    // has to be showable. Without this an editor gets a live page with a missing
    // hero and no error anywhere, because every individual step succeeded.
    const content = parseCmsPageContentJson(revision.contentJson);
    if (!content) return redirectError(request, slug, "revision_unreadable");
    // The home page is the site. Publishing it NOINDEX de-indexes the domain
    // from the one URL every other page links to, and search engines are slow
    // to forgive it - so it is refused here for the same reason hiding it is
    // refused above: it is not a content decision. Every other page may be
    // published unlisted.
    if (slug === "home" && content.seo.robots === "NOINDEX") {
      return redirectError(request, slug, "home_cannot_be_noindex");
    }
    const references = collectPageReferences(content);
    referenceCount = references.imageItemIds.length + references.galleryCategorySlugs.length;
    let problems;
    try {
      problems = unpublishableReferences(references, await resolvePublishReferences(references));
    } catch {
      return redirectError(request, slug, "publish_failed");
    }
    if (problems.length > 0) {
      const label = firstUnpublishableLabel(problems);
      return NextResponse.redirect(new URL(`/app/site-content/${encodeURIComponent(slug)}?error=unpublishable_media${label ? `&missing=${encodeURIComponent(label)}` : ""}`, request.url), 303);
    }
  }
  // What this publication makes untrue on the public site, decided by the
  // revalidation contract rather than by this route. A refusal is a refusal:
  // recording the publication anyway would tell an editor a change is live
  // that the public site can never reach.
  const delivery = decidePublication(sitePagePublishEvent(slug, action as "PUBLISH" | "HIDE", action === "PUBLISH" ? revisionId : null));
  if (!delivery.ok) return redirectError(request, slug, "publish_rejected");

  const eventId = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(sitePagePublicationEvents).values({ id: eventId, requestKey, pageId: page.id, revisionId: action === "PUBLISH" ? revisionId : null, action: action as "PUBLISH" | "HIDE", note, createdBy: actor.userId }),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action, entityType: "site_page_publication", entityId: eventId, after: { slug, revisionId: action === "PUBLISH" ? revisionId : null, note, verifiedReferences: referenceCount, invalidation: delivery.invalidation } })),
    ]);
  } catch {
    const concurrent = await db.select({ id: sitePagePublicationEvents.id }).from(sitePagePublicationEvents).where(eq(sitePagePublicationEvents.requestKey, requestKey)).get();
    if (concurrent) return NextResponse.redirect(new URL(`/app/site-content/${slug}?status=already_published`, request.url), 303);
    return redirectError(request, slug, "publish_failed");
  }
  return NextResponse.redirect(new URL(`/app/site-content/${slug}?status=${action === "PUBLISH" ? "published" : "hidden"}`, request.url), 303);
}

function redirectError(request: NextRequest, slug: string, code: string) {
  return NextResponse.redirect(new URL(`/app/site-content/${encodeURIComponent(slug)}?error=${encodeURIComponent(code)}`, request.url), 303);
}

function text(value: FormDataEntryValue | null, max: number) {
  return String(value ?? "").trim().slice(0, max);
}
