import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, sitePageRevisions, sitePages } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { sha256Hex } from "@/lib/image-validation";
import { isSameOrigin } from "@/lib/same-origin";
import { isSitePageSlug, parseCmsPageContentJson, serializeCmsPageContent, SITE_PAGE_DEFINITIONS } from "@/lib/site-cms";
import { recordTimestamp } from "@/lib/timestamps";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "site:write")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);
  const { slug } = await context.params;
  if (!isSitePageSlug(slug)) return NextResponse.redirect(new URL("/app/site-content?error=invalid_page", request.url), 303);
  const form = await request.formData();
  const requestKey = text(form.get("requestKey"), 120);
  const contentRaw = String(form.get("contentJson") ?? "");
  const changeNote = text(form.get("changeNote"), 500) || null;
  const content = parseCmsPageContentJson(contentRaw);
  if (!requestKey || !content) return redirectError(request, slug, "invalid_content");
  const contentJson = serializeCmsPageContent(content);
  const contentHash = await sha256Hex(new TextEncoder().encode(contentJson));
  const db = getDb();
  const existing = await db.select({ id: sitePageRevisions.id }).from(sitePageRevisions).where(eq(sitePageRevisions.requestKey, requestKey)).get();
  if (existing) return NextResponse.redirect(new URL(`/app/site-content/${slug}?status=already_saved&revision=${existing.id}`, request.url), 303);
  const pageId = `site-page-${slug}`;
  const revisionId = crypto.randomUUID();
  const recordedAt = recordTimestamp();
  try {
    await db.batch([
      db.insert(sitePages).values({ id: pageId, slug, displayName: SITE_PAGE_DEFINITIONS[slug].label, createdBy: actor.userId, updatedAt: recordedAt }).onConflictDoNothing(),
      db.insert(sitePageRevisions).values({ id: revisionId, requestKey, pageId, contentJson, contentHash, changeNote, createdBy: actor.userId }),
      db.update(sitePages).set({ updatedAt: recordedAt }).where(eq(sitePages.id, pageId)),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE_REVISION", entityType: "site_page", entityId: pageId, after: { slug, revisionId, contentHash, sectionCount: content.sections.length, changeNote } })),
    ]);
  } catch {
    const concurrent = await db.select({ id: sitePageRevisions.id }).from(sitePageRevisions).where(eq(sitePageRevisions.requestKey, requestKey)).get();
    if (concurrent) return NextResponse.redirect(new URL(`/app/site-content/${slug}?status=already_saved&revision=${concurrent.id}`, request.url), 303);
    return redirectError(request, slug, "save_failed");
  }
  return NextResponse.redirect(new URL(`/app/site-content/${slug}?status=saved&revision=${revisionId}`, request.url), 303);
}

function redirectError(request: NextRequest, slug: string, code: string) {
  return NextResponse.redirect(new URL(`/app/site-content/${encodeURIComponent(slug)}?error=${encodeURIComponent(code)}`, request.url), 303);
}

function text(value: FormDataEntryValue | null, max: number) {
  return String(value ?? "").trim().slice(0, max);
}
