import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { getDb } from "@/db";
import { galleryImageVariants, galleryItems } from "@/db/schema";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { preferredGalleryContentTypes } from "@/lib/gallery";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const requestedRole = request.nextUrl.searchParams.get("role") === "thumbnail" ? "THUMBNAIL" : "DISPLAY";
  const db = getDb();
  const item = await db.select({ id: galleryItems.id, status: galleryItems.status, visibility: galleryItems.visibility, companyId: galleryItems.companyId }).from(galleryItems).where(eq(galleryItems.id, id)).get();
  if (!item) return new Response("Not found", { status: 404 });
  const isPublic = item.status === "PUBLISHED" && item.visibility === "PUBLIC";
  if (!isPublic) {
    const actor = await getCurrentActor();
    const authorized = actor && (can(actor, "gallery:read") || (item.visibility === "CUSTOMER_JOB" && item.status === "PUBLISHED" && can(actor, "images:read", item.companyId)));
    if (!authorized) return new Response("Not found", { status: 404 });
  }
  const variants = await db.select().from(galleryImageVariants).where(and(eq(galleryImageVariants.galleryItemId, id), eq(galleryImageVariants.role, requestedRole))).all();
  const preferred = preferredGalleryContentTypes(request.headers.get("Accept"));
  const metadata = preferred.map((type) => variants.find((variant) => variant.contentType === type)).find(Boolean) ?? variants[0];
  if (!metadata) return new Response("Not found", { status: 404 });
  const object = await env.FILES.get(metadata.storageKey);
  if (!object) return new Response("Not found", { status: 404 });
  if (object.httpEtag && request.headers.get("If-None-Match") === object.httpEtag) return new Response(null, { status: 304 });
  const headers = new Headers({
    "Content-Type": metadata.contentType,
    "Content-Length": String(metadata.byteSize),
    "Cache-Control": isPublic ? "public, max-age=3600, stale-while-revalidate=86400" : "private, no-store",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Accept",
  });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { status: 200, headers });
}
