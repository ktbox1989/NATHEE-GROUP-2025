import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, galleryCategories } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { boundedText, normalizeGallerySlug, parseGallerySortOrder } from "@/lib/gallery";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "gallery:write")) return NextResponse.redirect(new URL("/app?error=forbidden", request.url), 303);
  const form = await request.formData();
  const slug = normalizeGallerySlug(String(form.get("slug") ?? ""));
  const name = boundedText(form.get("name"), 120);
  const description = boundedText(form.get("description"), 500) || null;
  const sortOrder = parseGallerySortOrder(form.get("sortOrder"));
  if (!slug || !name || sortOrder === undefined) return NextResponse.redirect(new URL("/app/gallery?error=invalid_category", request.url), 303);
  const id = crypto.randomUUID();
  try {
    const db = getDb();
    await db.batch([
      db.insert(galleryCategories).values({ id, slug, name, description, sortOrder, createdBy: actor.userId }),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "gallery_category", entityId: id, after: { slug, name, description, sortOrder, status: "ACTIVE" } })),
    ]);
  } catch {
    return NextResponse.redirect(new URL("/app/gallery?error=duplicate_category", request.url), 303);
  }
  return NextResponse.redirect(new URL("/app/gallery?status=category_created", request.url), 303);
}
