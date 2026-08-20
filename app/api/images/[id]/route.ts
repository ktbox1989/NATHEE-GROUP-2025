import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { getDb } from "@/db";
import { motorcycleImages, motorcycleImageVariants } from "@/db/schema";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { parseMotorcycleImageRole, preferredMotorcycleImageContentTypes } from "@/lib/motorcycle-image-variants";

type StoredImage = { storageKey: string; contentType: string; byteSize: number; servedRole: string };

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id } = await context.params;
  const db = getDb();
  const metadata = await db.select().from(motorcycleImages).where(eq(motorcycleImages.id, id)).get();
  if (!metadata || !can(actor, "images:read", metadata.companyId)) return new Response("Not found", { status: 404 });

  const requestedRole = parseMotorcycleImageRole(request.nextUrl.searchParams.get("role"));
  const original: StoredImage = { storageKey: metadata.storageKey, contentType: metadata.contentType, byteSize: metadata.byteSize, servedRole: requestedRole === "ORIGINAL" ? "original" : "original-fallback" };
  const candidates: StoredImage[] = [];
  if (requestedRole !== "ORIGINAL") {
    const variants = await db.select().from(motorcycleImageVariants).where(and(eq(motorcycleImageVariants.motorcycleImageId, id), eq(motorcycleImageVariants.role, requestedRole))).all();
    for (const contentType of preferredMotorcycleImageContentTypes(request.headers.get("Accept"))) {
      const variant = variants.find((item) => item.contentType === contentType);
      if (variant) candidates.push({ storageKey: variant.storageKey, contentType: variant.contentType, byteSize: variant.byteSize, servedRole: requestedRole.toLowerCase() });
    }
  }
  candidates.push(original);

  for (const candidate of candidates) {
    const object = await env.FILES.get(candidate.storageKey);
    if (!object) continue;
    const headers = new Headers({
      "Content-Type": candidate.contentType,
      "Content-Length": String(candidate.byteSize),
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "X-Nathee-Image-Variant": candidate.servedRole,
      "Vary": "Accept",
    });
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    return new Response(object.body, { status: 200, headers });
  }
  return new Response("Not found", { status: 404 });
}
