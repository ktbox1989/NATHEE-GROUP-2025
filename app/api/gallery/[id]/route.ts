import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, galleryCategories, galleryImageVariants, galleryItems, transportJobs } from "@/db/schema";
import type { GalleryVisibility } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { boundedText, canPublishGalleryItem, galleryVisibilities, parseGallerySortOrder } from "@/lib/gallery";
import { isSameOrigin } from "@/lib/same-origin";
import { eventTimestamp, recordTimestamp } from "@/lib/timestamps";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "gallery:write")) return redirect(request, "error", "forbidden");
  const { id } = await context.params;
  const db = getDb();
  const before = await db.select().from(galleryItems).where(eq(galleryItems.id, id)).get();
  if (!before) return redirect(request, "error", "not_found");
  const form = await request.formData();
  const action = boundedText(form.get("action"), 30).toUpperCase();
  const requiresPublisher = before.status === "PUBLISHED" || ["PUBLISH", "HIDE", "FEATURE", "UNFEATURE"].includes(action);
  if (requiresPublisher && !can(actor, "gallery:publish")) return redirect(request, "error", "publish_forbidden");

  // publishedAt and archivedAt record when the decision happened; updatedAt is a record column.
  const occurredAt = eventTimestamp();
  const recordedAt = recordTimestamp();
  let values: Partial<typeof galleryItems.$inferInsert>;
  if (action === "UPDATE") {
    const categoryId = boundedText(form.get("categoryId"), 80);
    const title = boundedText(form.get("title"), 160);
    const caption = boundedText(form.get("caption"), 1000) || null;
    const altText = boundedText(form.get("altText"), 300);
    const takenAt = boundedText(form.get("takenAt"), 40) || null;
    const location = boundedText(form.get("location"), 200) || null;
    const publicJobReference = boundedText(form.get("publicJobReference"), 100) || null;
    const visibilityValue = boundedText(form.get("visibility"), 30).toUpperCase();
    const visibility = galleryVisibilities.has(visibilityValue as GalleryVisibility) ? visibilityValue as GalleryVisibility : null;
    const sortOrder = parseGallerySortOrder(form.get("sortOrder"));
    const companyId = boundedText(form.get("companyId"), 80) || null;
    const jobId = boundedText(form.get("jobId"), 80) || null;
    if (!categoryId || !title || altText.length < 3 || !visibility || sortOrder === undefined) return redirect(request, "error", "invalid_gallery");
    if ((visibility === "PUBLIC" && (companyId || jobId)) || (visibility === "CUSTOMER_JOB" && (!companyId || !jobId))) return redirect(request, "error", "invalid_scope");
    const category = await db.select({ id: galleryCategories.id }).from(galleryCategories).where(eq(galleryCategories.id, categoryId)).get();
    if (!category) return redirect(request, "error", "invalid_category");
    if (visibility === "CUSTOMER_JOB") {
      const job = await db.select({ id: transportJobs.id }).from(transportJobs).where(and(eq(transportJobs.id, jobId!), eq(transportJobs.companyId, companyId!))).get();
      if (!job) return redirect(request, "error", "invalid_job_scope");
    }
    values = { categoryId, title, caption, altText, takenAt, location, publicJobReference, visibility, sortOrder, companyId, jobId, updatedAt: recordedAt };
  } else if (action === "PUBLISH") {
    const category = await db.select({ status: galleryCategories.status }).from(galleryCategories).where(eq(galleryCategories.id, before.categoryId)).get();
    const displayVariant = await db.select({ id: galleryImageVariants.id }).from(galleryImageVariants).where(and(eq(galleryImageVariants.galleryItemId, id), eq(galleryImageVariants.role, "DISPLAY"))).get();
    if (category?.status !== "ACTIVE" || !canPublishGalleryItem({ visibility: before.visibility, hasDisplayVariant: Boolean(displayVariant), altText: before.altText })) return redirect(request, "error", "publish_requirements");
    values = { status: "PUBLISHED", publishedBy: actor.userId, publishedAt: occurredAt, archivedAt: null, updatedAt: recordedAt };
  } else if (action === "HIDE") {
    values = { status: "HIDDEN", isFeatured: 0, updatedAt: recordedAt };
  } else if (action === "ARCHIVE") {
    values = { status: "ARCHIVED", isFeatured: 0, archivedAt: occurredAt, updatedAt: recordedAt };
  } else if (action === "FEATURE" || action === "UNFEATURE") {
    if (action === "FEATURE" && (before.status !== "PUBLISHED" || before.visibility !== "PUBLIC")) return redirect(request, "error", "feature_requirements");
    values = { isFeatured: action === "FEATURE" ? 1 : 0, updatedAt: recordedAt };
  } else {
    return redirect(request, "error", "invalid_action");
  }

  try {
    await db.batch([
      db.update(galleryItems).set(values).where(eq(galleryItems.id, id)),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action, entityType: "gallery_item", entityId: id, companyId: before.companyId, before, after: values })),
    ]);
  } catch {
    return redirect(request, "error", "gallery_update");
  }
  return NextResponse.redirect(new URL(`/app/gallery?status=updated#${id}`, request.url), 303);
}

function redirect(request: NextRequest, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/gallery?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
