import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, postRevisions, posts } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { sha256Hex } from "@/lib/image-validation";
import { isValidPostSlug, parsePostContentJson, serializePostContent } from "@/lib/post-cms-content";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

/**
 * Saves a draft. Never changes what the public site serves: that is decided by
 * a publication event, so an editor can save freely without anything going live.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "site:write")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);

  const { slug } = await context.params;
  if (!isValidPostSlug(slug)) return NextResponse.redirect(new URL("/app/posts?error=invalid_page", request.url), 303);

  const form = await request.formData();
  const requestKey = text(form.get("requestKey"), 120);
  const changeNote = text(form.get("changeNote"), 500) || null;
  const content = parsePostContentJson(String(form.get("contentJson") ?? ""));
  if (!requestKey || !content) return redirectError(request, slug, "invalid_content");

  const db = getDb();
  const post = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).get();
  if (!post) return redirectError(request, slug, "post_not_found");

  const existing = await db
    .select({ id: postRevisions.id })
    .from(postRevisions)
    .where(eq(postRevisions.requestKey, requestKey))
    .get();
  if (existing) {
    return NextResponse.redirect(
      new URL(`/app/posts/${slug}?status=already_saved&revision=${existing.id}`, request.url),
      303,
    );
  }

  const contentJson = serializePostContent(content);
  const revisionId = crypto.randomUUID();
  const recordedAt = recordTimestamp();

  try {
    await db.batch([
      db.insert(postRevisions).values({
        id: revisionId,
        requestKey,
        postId: post.id,
        contentJson,
        contentHash: await sha256Hex(new TextEncoder().encode(contentJson)),
        changeNote,
        createdBy: actor.userId,
      }),
      db.update(posts).set({ updatedAt: recordedAt }).where(eq(posts.id, post.id)),
      db.insert(auditLogs).values(
        makeAuditRecord({
          actor,
          action: "CREATE_REVISION",
          entityType: "post",
          entityId: post.id,
          after: {
            slug,
            revisionId,
            title: content.title,
            robots: content.seo.robots,
            sectionCount: content.sections.length,
            changeNote,
          },
        }),
      ),
    ]);
  } catch {
    const concurrent = await db
      .select({ id: postRevisions.id })
      .from(postRevisions)
      .where(eq(postRevisions.requestKey, requestKey))
      .get();
    if (concurrent) {
      return NextResponse.redirect(
        new URL(`/app/posts/${slug}?status=already_saved&revision=${concurrent.id}`, request.url),
        303,
      );
    }
    return redirectError(request, slug, "save_failed");
  }

  return NextResponse.redirect(new URL(`/app/posts/${slug}?status=saved&revision=${revisionId}`, request.url), 303);
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
