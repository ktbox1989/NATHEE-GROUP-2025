import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, motorcycleImages, motorcycles, proofOfDeliveryRecords, proofOfDeliverySignatures } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can, isInternalRole } from "@/lib/authorization";
import { validateBoundedMultipartRequest } from "@/lib/bounded-multipart";
import { getCurrentActor } from "@/lib/current-actor";
import { hasExpectedImageSignature, sha256Hex } from "@/lib/image-validation";
import { canCreateProofOfDelivery, isReasonableRecordedTime, normalizeInspectionText } from "@/lib/inspections";
import { hasPodSignatureAttestation, isPodSignatureGeometry, parsePodSignatureDimension, POD_SIGNATURE_CONTENT_TYPE, POD_SIGNATURE_MAX_BYTES, readPngDimensions } from "@/lib/pod-signature";
import { isSameOrigin } from "@/lib/same-origin";
import { bangkokInputToUtc, isTripRequestKey } from "@/lib/trips";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return respondError(request, "forbidden", 403);
  const requestBounds = validateBoundedMultipartRequest(request.headers.get("content-type"), request.headers.get("content-length"), MAX_REQUEST_BYTES);
  if (!requestBounds.ok) return respondError(request, requestBounds.error, requestBounds.status);
  const actor = await getCurrentActor();
  if (!actor) return respondError(request, "not_authorized", 401, "/login?error=not_authorized");
  const { id: motorcycleId } = await context.params;
  const db = getDb();
  const motorcycle = await db.select({ id: motorcycles.id, companyId: motorcycles.companyId, status: motorcycles.currentStatus }).from(motorcycles).where(eq(motorcycles.id, motorcycleId)).get();
  if (!motorcycle || !isInternalRole(actor.role) || !can(actor, "status:write", motorcycle.companyId) || !can(actor, "images:read", motorcycle.companyId)) return respondError(request, "forbidden", 403, "/app/motorcycles?error=forbidden");
  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "");
  const recipientName = normalizeInspectionText(String(form.get("recipientName") ?? ""), { max: 160 });
  const recipientPhone = normalizeInspectionText(String(form.get("recipientPhone") ?? ""), { min: 6, max: 50 });
  const deliveryLocation = normalizeInspectionText(String(form.get("deliveryLocation") ?? ""), { min: 2, max: 300 });
  const deliveredAt = bangkokInputToUtc(String(form.get("deliveredAt") ?? ""));
  const evidenceImageId = String(form.get("evidenceImageId") ?? "");
  const notes = normalizeInspectionText(String(form.get("notes") ?? ""), { max: 2000 });
  if (!isTripRequestKey(requestKey)) return respondError(request, "invalid_request", 422, `/app/motorcycles/${motorcycleId}?error=invalid_pod`);
  const existing = await db.select({ id: proofOfDeliveryRecords.id, motorcycleId: proofOfDeliveryRecords.motorcycleId }).from(proofOfDeliveryRecords).where(eq(proofOfDeliveryRecords.requestKey, requestKey)).get();
  if (existing) return existing.motorcycleId === motorcycleId ? respondSuccess(request, existing.id, true, motorcycleId) : respondError(request, "request_conflict", 409, `/app/motorcycles/${motorcycleId}?error=request_conflict`);

  const signature = form.get("signature");
  const signatureWidth = parsePodSignatureDimension(form.get("signatureWidth"));
  const signatureHeight = parsePodSignatureDimension(form.get("signatureHeight"));
  if (!recipientName || recipientPhone === undefined || !deliveryLocation || !deliveredAt || !isReasonableRecordedTime(deliveredAt) || !evidenceImageId || notes === undefined || !canCreateProofOfDelivery(motorcycle.status) || !(signature instanceof File) || signature.type !== POD_SIGNATURE_CONTENT_TYPE || signature.size < 200 || signature.size > POD_SIGNATURE_MAX_BYTES || !signatureWidth || !signatureHeight || !isPodSignatureGeometry(signatureWidth, signatureHeight) || !hasPodSignatureAttestation(form.get("signatureAttestation"))) return respondError(request, "invalid_pod", 422, `/app/motorcycles/${motorcycleId}?error=invalid_pod`);

  const signatureBytes = new Uint8Array(await signature.arrayBuffer());
  if (signatureBytes.byteLength !== signature.size || !hasExpectedImageSignature(signatureBytes, signature.type)) return respondError(request, "invalid_signature", 422, `/app/motorcycles/${motorcycleId}?error=invalid_pod_signature`);
  const signatureDimensions = readPngDimensions(signatureBytes);
  if (!signatureDimensions || signatureDimensions.width !== signatureWidth || signatureDimensions.height !== signatureHeight) return respondError(request, "invalid_signature_dimensions", 422, `/app/motorcycles/${motorcycleId}?error=invalid_pod_signature`);
  const image = await db.select({ id: motorcycleImages.id, motorcycleId: motorcycleImages.motorcycleId, companyId: motorcycleImages.companyId, category: motorcycleImages.category }).from(motorcycleImages).where(and(eq(motorcycleImages.id, evidenceImageId), eq(motorcycleImages.motorcycleId, motorcycleId))).get();
  if (!image || image.companyId !== motorcycle.companyId || image.category !== "DELIVERY") return respondError(request, "invalid_pod_evidence", 422, `/app/motorcycles/${motorcycleId}?error=invalid_pod_evidence`);

  const podId = crypto.randomUUID();
  const signatureId = crypto.randomUUID();
  const signatureChecksum = await sha256Hex(signatureBytes);
  const signatureStorageKey = `companies/${motorcycle.companyId}/motorcycles/${motorcycleId}/pod/${podId}/signature-${signatureId}.png`;
  const now = new Date().toISOString();
  try {
    await env.FILES.put(signatureStorageKey, signatureBytes, { httpMetadata: { contentType: POD_SIGNATURE_CONTENT_TYPE }, customMetadata: { podId, motorcycleId, companyId: motorcycle.companyId, attestedBy: actor.userId, checksum: signatureChecksum } });
    await db.batch([
      db.insert(proofOfDeliveryRecords).values({ id: podId, requestKey, motorcycleId, companyId: motorcycle.companyId, recipientName, recipientPhone, deliveryLocation, deliveredAt, evidenceImageId, notes, receivedBy: actor.userId, signatureRequired: 1 }),
      db.insert(proofOfDeliverySignatures).values({ id: signatureId, podId, companyId: motorcycle.companyId, storageKey: signatureStorageKey, contentType: POD_SIGNATURE_CONTENT_TYPE, width: signatureWidth, height: signatureHeight, byteSize: signature.size, checksum: signatureChecksum, attestedBy: actor.userId, attestedAt: now }),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "proof_of_delivery", entityId: podId, companyId: motorcycle.companyId, after: { motorcycleId, deliveredAt, evidenceImageId, hasRecipientPhone: Boolean(recipientPhone), hasSignature: true, signatureId, signatureChecksum } })),
    ]);
  } catch {
    await env.FILES.delete(signatureStorageKey);
    const raced = await db.select({ id: proofOfDeliveryRecords.id, motorcycleId: proofOfDeliveryRecords.motorcycleId }).from(proofOfDeliveryRecords).where(eq(proofOfDeliveryRecords.requestKey, requestKey)).get();
    if (raced?.motorcycleId === motorcycleId) return respondSuccess(request, raced.id, true, motorcycleId);
    return respondError(request, raced ? "request_conflict" : "save_pod", raced ? 409 : 500, `/app/motorcycles/${motorcycleId}?error=${raced ? "request_conflict" : "save_pod"}`);
  }
  return respondSuccess(request, podId, false, motorcycleId);
}

function wantsJson(request: NextRequest): boolean {
  return request.headers.get("Accept")?.toLowerCase().includes("application/json") ?? false;
}

function respondSuccess(request: NextRequest, podId: string, duplicate: boolean, motorcycleId: string) {
  return wantsJson(request) ? NextResponse.json({ ok: true, podId, duplicate }, { status: duplicate ? 200 : 201 }) : NextResponse.redirect(new URL(`/app/motorcycles/${motorcycleId}?status=${duplicate ? "pod_exists" : "pod_created"}`, request.url), 303);
}

function respondError(request: NextRequest, error: string, status: number, location = `/app/motorcycles?error=${encodeURIComponent(error)}`) {
  return wantsJson(request) ? NextResponse.json({ ok: false, error }, { status }) : NextResponse.redirect(new URL(location, request.url), 303);
}
