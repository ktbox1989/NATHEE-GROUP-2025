import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import {
  auditLogs,
  motorcycleImages,
  motorcycles,
  proofOfDeliveryRecords,
} from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can, isInternalRole } from "@/lib/authorization";
import { canCreateProofOfDelivery, isReasonableRecordedTime, normalizeInspectionText } from "@/lib/inspections";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { bangkokInputToUtc, isTripRequestKey } from "@/lib/trips";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const { id: motorcycleId } = await context.params;
  const motorcycle = await getDb()
    .select({ id: motorcycles.id, companyId: motorcycles.companyId, status: motorcycles.currentStatus })
    .from(motorcycles)
    .where(eq(motorcycles.id, motorcycleId))
    .get();
  if (
    !motorcycle
    || !isInternalRole(actor.role)
    || !can(actor, "status:write", motorcycle.companyId)
    || !can(actor, "images:read", motorcycle.companyId)
  ) return NextResponse.redirect(new URL("/app/motorcycles?error=forbidden", request.url), 303);

  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "");
  const recipientName = normalizeInspectionText(String(form.get("recipientName") ?? ""), { max: 160 });
  const recipientPhone = normalizeInspectionText(String(form.get("recipientPhone") ?? ""), { min: 6, max: 50 });
  const deliveryLocation = normalizeInspectionText(String(form.get("deliveryLocation") ?? ""), { min: 2, max: 300 });
  const deliveredAt = bangkokInputToUtc(String(form.get("deliveredAt") ?? ""));
  const evidenceImageId = String(form.get("evidenceImageId") ?? "");
  const notes = normalizeInspectionText(String(form.get("notes") ?? ""), { max: 2000 });
  if (
    !isTripRequestKey(requestKey)
    || !recipientName
    || recipientPhone === undefined
    || !deliveryLocation
    || !deliveredAt
    || !isReasonableRecordedTime(deliveredAt)
    || !evidenceImageId
    || notes === undefined
    || !canCreateProofOfDelivery(motorcycle.status)
  ) return redirect(request, motorcycleId, "error", "invalid_pod");

  const db = getDb();
  const existing = await db
    .select({ motorcycleId: proofOfDeliveryRecords.motorcycleId })
    .from(proofOfDeliveryRecords)
    .where(eq(proofOfDeliveryRecords.requestKey, requestKey))
    .get();
  if (existing) {
    return existing.motorcycleId === motorcycleId
      ? redirect(request, motorcycleId, "status", "pod_exists")
      : redirect(request, motorcycleId, "error", "request_conflict");
  }
  const image = await db
    .select({ id: motorcycleImages.id, motorcycleId: motorcycleImages.motorcycleId, companyId: motorcycleImages.companyId, category: motorcycleImages.category })
    .from(motorcycleImages)
    .where(and(eq(motorcycleImages.id, evidenceImageId), eq(motorcycleImages.motorcycleId, motorcycleId)))
    .get();
  if (!image || image.companyId !== motorcycle.companyId || image.category !== "DELIVERY") {
    return redirect(request, motorcycleId, "error", "invalid_pod_evidence");
  }

  const podId = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(proofOfDeliveryRecords).values({
        id: podId,
        requestKey,
        motorcycleId,
        companyId: motorcycle.companyId,
        recipientName,
        recipientPhone,
        deliveryLocation,
        deliveredAt,
        evidenceImageId,
        notes,
        receivedBy: actor.userId,
      }),
      db.insert(auditLogs).values(makeAuditRecord({
        actor,
        action: "CREATE",
        entityType: "proof_of_delivery",
        entityId: podId,
        companyId: motorcycle.companyId,
        after: { motorcycleId, deliveredAt, evidenceImageId, hasRecipientPhone: Boolean(recipientPhone) },
      })),
    ]);
  } catch {
    const raced = await getDb()
      .select({ motorcycleId: proofOfDeliveryRecords.motorcycleId })
      .from(proofOfDeliveryRecords)
      .where(eq(proofOfDeliveryRecords.requestKey, requestKey))
      .get();
    return redirect(
      request,
      motorcycleId,
      raced?.motorcycleId === motorcycleId ? "status" : "error",
      raced?.motorcycleId === motorcycleId ? "pod_exists" : "save_pod",
    );
  }
  return redirect(request, motorcycleId, "status", "pod_created");
}

function redirect(request: NextRequest, motorcycleId: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/motorcycles/${motorcycleId}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
