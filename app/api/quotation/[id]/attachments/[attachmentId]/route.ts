import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, quoteRequestAttachments, quoteRequests } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { getCurrentActor } from "@/lib/current-actor";
import { quotationAttachmentDisposition } from "@/lib/quotation-attachments";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (actor.role !== "OWNER") return new Response("Not found", { status: 404 });
  const { id, attachmentId } = await params;
  const db = getDb();
  const metadata = await db
    .select({
      id: quoteRequestAttachments.id,
      storageKey: quoteRequestAttachments.storageKey,
      originalFilename: quoteRequestAttachments.originalFilename,
      contentType: quoteRequestAttachments.contentType,
      byteSize: quoteRequestAttachments.byteSize,
      checksum: quoteRequestAttachments.checksum,
      requestNumber: quoteRequests.requestNumber,
    })
    .from(quoteRequestAttachments)
    .innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestAttachments.quoteRequestId))
    .where(and(eq(quoteRequestAttachments.id, attachmentId), eq(quoteRequestAttachments.quoteRequestId, id)))
    .get();
  if (!metadata) return new Response("Not found", { status: 404 });
  const object = await env.FILES.get(metadata.storageKey);
  if (!object) return new Response("Not found", { status: 404 });
  try {
    await db.insert(auditLogs).values(makeAuditRecord({
      actor,
      action: "DOWNLOAD_QUOTATION_ATTACHMENT",
      entityType: "quote_request_attachment",
      entityId: metadata.id,
      after: { requestNumber: metadata.requestNumber, contentType: metadata.contentType, byteSize: metadata.byteSize, checksum: metadata.checksum },
    }));
  } catch {
    return new Response("Audit unavailable", { status: 503 });
  }
  const headers = new Headers({
    "Content-Type": metadata.contentType,
    "Content-Length": String(metadata.byteSize),
    "Content-Disposition": quotationAttachmentDisposition(metadata.originalFilename),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { status: 200, headers });
}
