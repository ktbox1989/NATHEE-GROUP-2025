import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, postSlugHistory, posts } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isValidPostSlug } from "@/lib/post-cms-content";
import { decidePublication, postMovedEvent } from "@/lib/publication-events";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

/**
 * Moves a published post to a new URL without throwing away the old one.
 *
 * Until now the slug was fixed at creation, and the comment on the create route
 * said why: changing it would move a published post to a new URL and leave the
 * old one dead. That was the right refusal while there was nowhere to record
 * the previous slug. There is now, so a rename is a real operation with a real
 * redirect behind it rather than a silent loss of every inbound link.
 *
 * It needs `site:publish`, not `site:write`. A rename does not change what a
 * post says; it changes which URLs the public site answers, which is the same
 * kind of decision as publishing and hiding.
 *
 * The order matters and is enforced by the database, not by this code being
 * careful: the post is renamed first, and only then is the history row written,
 * because a trigger refuses a row whose `to_slug` is not the slug the post
 * actually has. A record of a move that did not happen cannot be created.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "site:publish")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);

  const { slug } = await context.params;
  if (!isValidPostSlug(slug)) return NextResponse.redirect(new URL("/app/posts?error=invalid_page", request.url), 303);

  const form = await request.formData();
  const requestKey = text(form.get("requestKey"), 120);
  const nextSlug = text(form.get("slug"), 80).toLowerCase();
  const note = text(form.get("note"), 500) || null;

  if (!requestKey) return redirectError(request, slug, "invalid_rename");
  if (!isValidPostSlug(nextSlug)) return redirectError(request, slug, "invalid_slug");
  if (nextSlug === slug) return redirectError(request, slug, "same_slug");

  const db = getDb();

  // Replaying the same submission must not rename a second time. The request
  // key is unique, so a retry that already landed is reported as done rather
  // than moving the post again — which, after a later rename, would otherwise
  // send it somewhere the editor never asked for.
  const replay = await db
    .select({ toSlug: postSlugHistory.toSlug })
    .from(postSlugHistory)
    .where(eq(postSlugHistory.requestKey, requestKey))
    .get();
  if (replay) {
    return NextResponse.redirect(
      new URL(`/app/posts/${encodeURIComponent(replay.toSlug)}?status=already_renamed`, request.url),
      303,
    );
  }

  const post = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).get();
  if (!post) return redirectError(request, slug, "post_not_found");
  if (await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, nextSlug)).get()) {
    return redirectError(request, slug, "slug_taken");
  }

  // Both URLs change behaviour: the old one starts redirecting and the new one
  // starts answering. The contract decides that, and a refusal stops the rename
  // rather than being recorded as a move nothing acted on.
  const delivery = decidePublication(postMovedEvent(slug, nextSlug));
  if (!delivery.ok) return redirectError(request, slug, "rename_rejected");

  const historyId = crypto.randomUUID();
  const recordedAt = recordTimestamp();

  try {
    await db.batch([
      db.update(posts).set({ slug: nextSlug, updatedAt: recordedAt }).where(eq(posts.id, post.id)),
      db.insert(postSlugHistory).values({
        id: historyId,
        requestKey,
        postId: post.id,
        fromSlug: slug,
        toSlug: nextSlug,
        createdBy: actor.userId,
      }),
      db.insert(auditLogs).values(
        makeAuditRecord({
          actor,
          action: "MOVE",
          entityType: "post",
          entityId: post.id,
          before: { slug },
          after: { slug: nextSlug, note, invalidation: delivery.invalidation },
        }),
      ),
    ]);
  } catch {
    const concurrent = await db
      .select({ toSlug: postSlugHistory.toSlug })
      .from(postSlugHistory)
      .where(eq(postSlugHistory.requestKey, requestKey))
      .get();
    if (concurrent) {
      return NextResponse.redirect(
        new URL(`/app/posts/${encodeURIComponent(concurrent.toSlug)}?status=already_renamed`, request.url),
        303,
      );
    }
    return redirectError(request, slug, "rename_failed");
  }

  return NextResponse.redirect(
    new URL(`/app/posts/${encodeURIComponent(nextSlug)}?status=renamed&from=${encodeURIComponent(slug)}`, request.url),
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
