import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, postRevisions, posts } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { sha256Hex } from "@/lib/image-validation";
import {
  DEFAULT_POST_CONTENT,
  isValidPostSlug,
  parsePostContent,
  serializePostContent,
} from "@/lib/post-cms-content";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

/**
 * The plain-form back office's post creator.
 *
 * The full editor composes a revision in the browser and posts validated JSON;
 * that needs client script. This endpoint takes ordinary fields — a title, a
 * slug, a summary, one body, and an optional work-gallery section — and builds
 * the same `PostContent` server-side, so a browser with JavaScript switched off
 * can still create a draft. The document is validated by the same
 * `parsePostContent` the revision API trusts; nothing here invents a second
 * contract. A repeated submission is caught by the same slug-uniqueness rule
 * the full editor relies on.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "site:write")) return NextResponse.redirect(new URL("/admin/posts?error=forbidden", request.url), 303);

  const form = await request.formData();
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  const changeNote = String(form.get("changeNote") ?? "").trim().slice(0, 500) || null;

  const sections: unknown[] = [
    {
      id: "body",
      type: "CONTENT",
      enabled: true,
      eyebrow: "",
      heading: String(form.get("bodyHeading") ?? "").trim() || "รายละเอียด",
      body: String(form.get("body") ?? "").trim(),
      imageItemId: "",
      primaryLabel: "",
      primaryHref: "",
      secondaryLabel: "",
      secondaryHref: "",
      galleryCategorySlug: "",
      galleryLimit: 12,
      items: [],
    },
  ];
  const galleryCategorySlug = String(form.get("galleryCategorySlug") ?? "").trim();
  const galleryLimit = Number(form.get("galleryLimit") ?? 0);
  if (galleryCategorySlug !== "" || galleryLimit > 0) {
    sections.push({
      id: "work-gallery",
      type: "GALLERY",
      enabled: true,
      eyebrow: "",
      heading: String(form.get("galleryHeading") ?? "").trim() || "ภาพผลงาน",
      body: "",
      imageItemId: "",
      primaryLabel: "",
      primaryHref: "",
      secondaryLabel: "",
      secondaryHref: "",
      galleryCategorySlug,
      galleryLimit: Number.isSafeInteger(galleryLimit) && galleryLimit >= 1 && galleryLimit <= 24 ? galleryLimit : 12,
      items: [],
    });
  }

  const categoryLabel = String(form.get("categoryLabel") ?? "").trim();
  const latinId = categoryLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const candidate = {
    ...DEFAULT_POST_CONTENT,
    title: String(form.get("title") ?? "").trim(),
    excerpt: String(form.get("excerpt") ?? "").trim(),
    category: categoryLabel ? { id: latinId || "news", label: categoryLabel } : null,
    sections,
    seo: {
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("excerpt") ?? "").trim(),
      robots: "INDEX",
    },
  };

  if (!isValidPostSlug(slug)) {
    return NextResponse.redirect(new URL("/admin/posts?error=invalid_slug", request.url), 303);
  }
  const content = parsePostContent(candidate);
  if (!content) {
    return NextResponse.redirect(new URL("/admin/posts?error=invalid_content", request.url), 303);
  }

  const db = getDb();
  if (await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).get()) {
    return NextResponse.redirect(new URL("/admin/posts?error=slug_taken", request.url), 303);
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
        requestKey: `admin-post-${crypto.randomUUID()}`,
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
          after: { slug, revisionId, title: content.title, source: "admin-plain-form" },
        }),
      ),
    ]);
  } catch {
    const existing = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).get();
    if (existing) return NextResponse.redirect(new URL(`/admin/posts?status=already_saved`, request.url), 303);
    return NextResponse.redirect(new URL("/admin/posts?error=save", request.url), 303);
  }
  return NextResponse.redirect(new URL(`/admin/posts?status=created&slug=${encodeURIComponent(slug)}`, request.url), 303);
}
