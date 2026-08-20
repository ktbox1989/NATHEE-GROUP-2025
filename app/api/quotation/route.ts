import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, quoteRequestAttachments, quoteRequests } from "@/db/schema";
import { validateBoundedMultipartRequest } from "@/lib/bounded-multipart";
import { nextBusinessNumber } from "@/lib/business-numbers";
import { parseQuotationForm } from "@/lib/quotation";
import { prepareQuotationAttachments, QUOTATION_MAX_REQUEST_BYTES } from "@/lib/quotation-attachments";
import { isSameOrigin } from "@/lib/same-origin";
import { getAppOrigin } from "@/lib/app-origin";
import { turnstileRemoteIp, verifyTurnstile } from "@/lib/turnstile";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const requestBounds = validateBoundedMultipartRequest(request.headers.get("content-type"), request.headers.get("content-length"), QUOTATION_MAX_REQUEST_BYTES);
  if (!requestBounds.ok) return redirect(request, "error", requestBounds.error === "request_too_large" ? "file_size" : "invalid");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect(request, "error", "invalid");
  }
  const parsed = parseQuotationForm(form);
  if (!parsed.ok) return redirect(request, "error", parsed.error);
  const db = getDb();
  try {
    const existing = await db.select({ requestNumber: quoteRequests.requestNumber }).from(quoteRequests).where(eq(quoteRequests.requestKey, parsed.value.requestKey)).get();
    if (existing) return redirect(request, "submitted", existing.requestNumber);
  } catch {
    return redirect(request, "error", "save");
  }
  const appOrigin = getAppOrigin(request.url);
  const token = typeof form.get("cf-turnstile-response") === "string" ? String(form.get("cf-turnstile-response")) : "";
  const challengePassed = appOrigin ? await verifyTurnstile({
    token,
    remoteIp: turnstileRemoteIp(request.headers.get("cf-connecting-ip")),
    idempotencyKey: parsed.value.requestKey.slice("quote-".length),
    expectedHostname: new URL(appOrigin).hostname,
  }) : false;
  if (!challengePassed) return redirect(request, "error", "challenge");
  let attachmentResult;
  try {
    attachmentResult = await prepareQuotationAttachments(form);
  } catch {
    return redirect(request, "error", "file_type");
  }
  if (!attachmentResult.ok) return redirect(request, "error", attachmentResult.error);

  const storedKeys: string[] = [];
  try {
    const id = crypto.randomUUID();
    const requestNumber = await nextBusinessNumber("QT");
    const consentAt = new Date().toISOString();
    const attachments = attachmentResult.value.map((attachment) => {
      const attachmentId = crypto.randomUUID();
      return { ...attachment, id: attachmentId, storageKey: `quotations/${id}/${attachmentId}.${attachment.extension}` };
    });
    for (const attachment of attachments) {
      storedKeys.push(attachment.storageKey);
      await env.FILES.put(attachment.storageKey, attachment.bytes, {
        httpMetadata: { contentType: attachment.contentType },
        customMetadata: { quoteRequestId: id, checksum: attachment.checksum },
      });
    }
    await db.batch([
      db.insert(quoteRequests).values({
        id,
        requestNumber,
        requestKey: parsed.value.requestKey,
        source: "PUBLIC_WEBSITE",
        companyName: parsed.value.companyName,
        contactName: parsed.value.contactName,
        phone: parsed.value.phone,
        lineId: parsed.value.lineId,
        email: parsed.value.email,
        origin: parsed.value.origin,
        destination: parsed.value.destination,
        quantity: parsed.value.quantity,
        vehicleType: parsed.value.vehicleType,
        desiredDate: parsed.value.desiredDate,
        extrasJson: JSON.stringify(parsed.value.extras),
        notes: parsed.value.notes,
        consentAt,
        status: "NEW",
      }),
      ...attachments.map((attachment) => db.insert(quoteRequestAttachments).values({
        id: attachment.id,
        quoteRequestId: id,
        storageKey: attachment.storageKey,
        originalFilename: attachment.originalFilename,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
        checksum: attachment.checksum,
      })),
      db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        actorUserId: null,
        companyId: null,
        action: "PUBLIC_QUOTATION_SUBMIT",
        entityType: "quote_request",
        entityId: id,
        beforeJson: null,
        afterJson: JSON.stringify({ requestNumber, source: "PUBLIC_WEBSITE", quantity: parsed.value.quantity, extras: parsed.value.extras, attachmentCount: attachments.length, attachmentTypes: [...new Set(attachments.map((attachment) => attachment.contentType))] }),
        reason: "Customer consent recorded with quotation request",
      }),
    ]);
    return redirect(request, "submitted", requestNumber);
  } catch {
    const cleanup = await Promise.allSettled(storedKeys.map((key) => env.FILES.delete(key)));
    if (cleanup.some((result) => result.status === "rejected")) return redirect(request, "error", "cleanup");
    try {
      const existing = await db.select({ requestNumber: quoteRequests.requestNumber }).from(quoteRequests).where(eq(quoteRequests.requestKey, parsed.value.requestKey)).get();
      if (existing) return redirect(request, "submitted", existing.requestNumber);
    } catch {
      // Fail closed below; no success is shown without a durable D1 record.
    }
    return redirect(request, "error", "save");
  }
}

function redirect(request: NextRequest, key: "submitted" | "error", value: string) {
  const url = new URL("/quotation", request.url);
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}
