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
 * Creates a post and its first revision together. A post row with no revision
 * has nothing to edit, preview or publish, so the two are one action.
 *
 * The slug is fixed at creation. Changing it later would move a published post
 * to a new URL and leave the old one dead, which is a redirect decision rather
 * than an edit.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "site:write")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);

  const form = await request.formData();
  const requestKey = text(form.get("requestKey"), 120);
  const slug = text(form.get("slug"), 80).toLowerCase();
  const changeNote = text(form.get("changeNote"), 500) || null;
  const content = parsePostContentJson(String(form.get("contentJson") ?? ""));

  if (!requestKey || !content) return redirectError(request, "invalid_content");
  // The same rule the public site enforces, checked before the database so the
  // editor gets a reason rather than a constraint violation.
  if (!isValidPostSlug(slug)) return redirectError(request, "invalid_slug");

  const db = getDb();
  const existingRevision = await db
    .select({ id: postRevisions.id, postId: postRevisions.postId })
    .from(postRevisions)
    .where(eq(postRevisions.requestKey, requestKey))
    .get();
  if (existingRevision) {
    return NextResponse.redirect(new URL(`/app/posts/${slug}?status=already_saved`, request.url), 303);
  }
  if (await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).get()) {
    return redirectError(request, "slug_taken");
  }

  const contentJson = serializePostContent(content);
  const postId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const recordedAt = recordTimestamp();

  try {
    await db.batch([
      db.insert(posts).values({ id: postId, slug, createdBy: actor.userId, updatedAt: recordedAt }),
      db.insert(postRevisions).values({
        id: revisionId,
        requestKey,
        postId,
        contentJson,
        contentHash: await sha256Hex(new TextEncoder().encode(contentJson)),
        changeNote,
        createdBy: actor.userId,
      }),
      db.insert(auditLogs).values(
        makeAuditRecord({
          actor,
          action: "CREATE_REVISION",
          entityType: "post",
          entityId: postId,
          after: { slug, revisionId, title: content.title, robots: content.seo.robots, changeNote },
        }),
      ),
    ]);
  } catch {
    const concurrent = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).get();
    if (concurrent) return NextResponse.redirect(new URL(`/app/posts/${slug}?status=already_saved`, request.url), 303);
    return redirectError(request, "save_failed");
  }

  return NextResponse.redirect(new URL(`/app/posts/${slug}?status=saved&revision=${revisionId}`, request.url), 303);
}

function redirectError(request: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/app/posts?error=${encodeURIComponent(code)}`, request.url), 303);
}

function text(value: FormDataEntryValue | null, max: number) {
  return String(value ?? "").trim().slice(0, max);
}
