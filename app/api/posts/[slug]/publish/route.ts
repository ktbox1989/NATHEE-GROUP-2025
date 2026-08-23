import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, postPublicationEvents, postRevisions, posts } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isValidPostSlug, parsePostContentJson } from "@/lib/post-cms-content";
import { collectPostReferences } from "@/lib/post-cms-store";
import { isSameOrigin } from "@/lib/same-origin";
import { firstUnpublishableLabel, unpublishableReferences } from "@/lib/site-cms-publish";
import { resolvePublishReferences } from "@/lib/site-cms-publish-store";

/**
 * Decides what the public site serves.
 *
 * PUBLISH names the revision it publishes, so reverting is publishing an older
 * one rather than editing anything: history stays append-only and the post can
 * always go back to a state it was actually in. HIDE unpublishes without
 * deleting, so the content survives and can be republished.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "site:publish")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);

  const { slug } = await context.params;
  if (!isValidPostSlug(slug)) return NextResponse.redirect(new URL("/app/posts?error=invalid_page", request.url), 303);

  const form = await request.formData();
  const action = String(form.get("action") ?? "").toUpperCase();
  const requestKey = text(form.get("requestKey"), 120);
  const revisionId = text(form.get("revisionId"), 100) || null;
  const note = text(form.get("note"), 500) || null;

  if (
    !requestKey ||
    !["PUBLISH", "HIDE"].includes(action) ||
    (action === "PUBLISH" && !revisionId) ||
    (action === "HIDE" && revisionId)
  ) {
    return redirectError(request, slug, "invalid_publish");
  }

  const db = getDb();
  const post = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).get();
  if (!post) return redirectError(request, slug, "post_not_found");

  const existing = await db
    .select({ id: postPublicationEvents.id })
    .from(postPublicationEvents)
    .where(eq(postPublicationEvents.requestKey, requestKey))
    .get();
  if (existing) {
    return NextResponse.redirect(new URL(`/app/posts/${slug}?status=already_published`, request.url), 303);
  }

  let referenceCount = 0;
  if (action === "PUBLISH") {
    const revision = await db
      .select({ id: postRevisions.id, contentJson: postRevisions.contentJson })
      .from(postRevisions)
      .where(and(eq(postRevisions.id, revisionId!), eq(postRevisions.postId, post.id)))
      .get();
    if (!revision) return redirectError(request, slug, "revision_not_found");

    const content = parsePostContentJson(revision.contentJson);
    if (!content) return redirectError(request, slug, "revision_unreadable");

    // The media a post points at has to be showable. Without this an editor
    // gets a live post with a missing hero and no error anywhere, because every
    // individual step succeeded.
    const references = collectPostReferences(content);
    referenceCount = references.imageItemIds.length;
    let problems;
    try {
      problems = unpublishableReferences(references, await resolvePublishReferences(references));
    } catch {
      return redirectError(request, slug, "publish_failed");
    }
    if (problems.length > 0) {
      const label = firstUnpublishableLabel(problems);
      return NextResponse.redirect(
        new URL(
          `/app/posts/${encodeURIComponent(slug)}?error=unpublishable_media${label ? `&missing=${encodeURIComponent(label)}` : ""}`,
          request.url,
        ),
        303,
      );
    }
  }

  const eventId = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(postPublicationEvents).values({
        id: eventId,
        requestKey,
        postId: post.id,
        revisionId: action === "PUBLISH" ? revisionId : null,
        action: action as "PUBLISH" | "HIDE",
        note,
        createdBy: actor.userId,
      }),
      db.insert(auditLogs).values(
        makeAuditRecord({
          actor,
          action,
          entityType: "post_publication",
          entityId: eventId,
          after: { slug, revisionId: action === "PUBLISH" ? revisionId : null, note, verifiedReferences: referenceCount },
        }),
      ),
    ]);
  } catch {
    const concurrent = await db
      .select({ id: postPublicationEvents.id })
      .from(postPublicationEvents)
      .where(eq(postPublicationEvents.requestKey, requestKey))
      .get();
    if (concurrent) {
      return NextResponse.redirect(new URL(`/app/posts/${slug}?status=already_published`, request.url), 303);
    }
    return redirectError(request, slug, "publish_failed");
  }

  return NextResponse.redirect(
    new URL(`/app/posts/${slug}?status=${action === "PUBLISH" ? "published" : "hidden"}`, request.url),
    303,
  );
}

function redirectError(request: NextRequest, slug: string, code: string) {
  return NextResponse.redirect(
    new URL(`/app/posts/${encodeURIComponent(slug)}?error=${encodeURIComponent(code)}`, request.url),
    303,
  );
}

function text(value: FormDataEntryValue | null, max: number) {
  return String(value ?? "").trim().slice(0, max);
}
