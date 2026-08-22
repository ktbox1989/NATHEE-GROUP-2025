import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, galleryCategories } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { boundedText, normalizeGallerySlug, parseGallerySortOrder } from "@/lib/gallery";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "gallery:write")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);
  const { id } = await context.params;
  const db = getDb();
  const before = await db.select().from(galleryCategories).where(eq(galleryCategories.id, id)).get();
  if (!before) return NextResponse.redirect(new URL("/app/gallery?error=category_not_found", request.url), 303);
  const form = await request.formData();
  const slug = normalizeGallerySlug(String(form.get("slug") ?? ""));
  const name = boundedText(form.get("name"), 120);
  const description = boundedText(form.get("description"), 500) || null;
  const sortOrder = parseGallerySortOrder(form.get("sortOrder"));
  const status = boundedText(form.get("status"), 20).toUpperCase();
  if (!slug || !name || sortOrder === undefined || !["ACTIVE", "HIDDEN"].includes(status)) return NextResponse.redirect(new URL("/app/gallery?error=invalid_category", request.url), 303);
  const values = { slug, name, description, sortOrder, status: status as "ACTIVE" | "HIDDEN", updatedAt: recordTimestamp() };
  try {
    await db.batch([
      db.update(galleryCategories).set(values).where(eq(galleryCategories.id, id)),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "UPDATE", entityType: "gallery_category", entityId: id, before, after: values })),
    ]);
  } catch {
    return NextResponse.redirect(new URL("/app/gallery?error=category_update", request.url), 303);
  }
  return NextResponse.redirect(new URL("/app/gallery?status=category_updated", request.url), 303);
}
