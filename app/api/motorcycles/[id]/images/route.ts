import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, motorcycleImages, motorcycles } from "@/db/schema";
import type { ImageCategory } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";

const allowedTypes = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
  ["image/heic", "heic"], ["image/heif", "heif"],
]);
const allowedCategories = new Set(["FRONT", "REAR", "LEFT", "RIGHT", "DAMAGE", "DELIVERY", "OTHER"]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const { id } = await context.params;
  const db = getDb();
  const motorcycle = await db.select({ id: motorcycles.id, companyId: motorcycles.companyId }).from(motorcycles).where(eq(motorcycles.id, id)).get();
  if (!motorcycle || !can(actor, "images:write", motorcycle.companyId)) {
    return NextResponse.redirect(new URL("/app/motorcycles?error=forbidden", request.url), 303);
  }
  const form = await request.formData();
  const file = form.get("image");
  const category = String(form.get("category") ?? "OTHER").toUpperCase();
  if (!(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024 || !allowedTypes.has(file.type) || !allowedCategories.has(category)) {
    return NextResponse.redirect(new URL(`/app/motorcycles/${id}?error=image`, request.url), 303);
  }

  const imageId = crypto.randomUUID();
  const extension = allowedTypes.get(file.type)!;
  const storageKey = `companies/${motorcycle.companyId}/motorcycles/${id}/${imageId}.${extension}`;
  await env.FILES.put(storageKey, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { motorcycleId: id, companyId: motorcycle.companyId, uploadedBy: actor.userId },
  });
  try {
    const metadata = { id: imageId, motorcycleId: id, companyId: motorcycle.companyId, storageKey, category: category as ImageCategory, contentType: file.type, byteSize: file.size, uploadedBy: actor.userId };
    await db.batch([
      db.insert(motorcycleImages).values(metadata),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "UPLOAD_IMAGE", entityType: "motorcycle_image", entityId: imageId, companyId: motorcycle.companyId, after: { motorcycleId: id, category, contentType: file.type, byteSize: file.size } })),
    ]);
  } catch {
    await env.FILES.delete(storageKey);
    return NextResponse.redirect(new URL(`/app/motorcycles/${id}?error=image_save`, request.url), 303);
  }
  return NextResponse.redirect(new URL(`/app/motorcycles/${id}?status=image_uploaded`, request.url), 303);
}
