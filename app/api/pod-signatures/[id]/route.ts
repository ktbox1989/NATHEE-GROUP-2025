import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { getDb } from "@/db";
import { proofOfDeliverySignatures } from "@/db/schema";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id } = await context.params;
  const metadata = await getDb().select().from(proofOfDeliverySignatures).where(eq(proofOfDeliverySignatures.id, id)).get();
  if (!metadata || !can(actor, "documents:read", metadata.companyId)) return new Response("Not found", { status: 404 });
  const object = await env.FILES.get(metadata.storageKey);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": metadata.contentType,
    "Content-Length": String(metadata.byteSize),
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { status: 200, headers });
}
