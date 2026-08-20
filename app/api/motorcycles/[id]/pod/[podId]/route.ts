import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { motorcycles, proofOfDeliveryRecords } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { normalizeInspectionText } from "@/lib/inspections";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; podId: string }> },
) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const { id: motorcycleId, podId } = await context.params;
  const form = await request.formData();
  const reason = normalizeInspectionText(String(form.get("reason") ?? ""), { min: 3, max: 500 });
  if (!reason) return redirect(request, motorcycleId, "error", "invalid_void_reason");

  const pod = await getDb()
    .select({
      id: proofOfDeliveryRecords.id,
      status: proofOfDeliveryRecords.status,
      companyId: proofOfDeliveryRecords.companyId,
      motorcycleStatus: motorcycles.currentStatus,
    })
    .from(proofOfDeliveryRecords)
    .innerJoin(motorcycles, eq(motorcycles.id, proofOfDeliveryRecords.motorcycleId))
    .where(and(
      eq(proofOfDeliveryRecords.id, podId),
      eq(proofOfDeliveryRecords.motorcycleId, motorcycleId),
    ))
    .get();
  if (
    !pod
    || pod.status !== "ACTIVE"
    || pod.motorcycleStatus !== "ARRIVED"
    || !isInternalRole(actor.role)
    || !can(actor, "status:write", pod.companyId)
  ) return redirect(request, motorcycleId, "error", "pod_not_voidable");

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  try {
    const d1 = getD1();
    const results = await d1.batch([
      d1.prepare(`
        UPDATE proof_of_delivery_records
        SET status = 'VOIDED', void_reason = ?, voided_by = ?, voided_at = ?
        WHERE id = ? AND motorcycle_id = ? AND status = 'ACTIVE'
      `).bind(reason, actor.userId, now, podId, motorcycleId),
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, company_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
        SELECT ?, ?, company_id, 'VOID', 'proof_of_delivery', id, ?, ?, ?, ?
        FROM proof_of_delivery_records
        WHERE id = ? AND motorcycle_id = ? AND status = 'VOIDED' AND voided_at = ?
      `).bind(
        auditId,
        actor.userId,
        JSON.stringify({ status: "ACTIVE" }),
        JSON.stringify({ status: "VOIDED" }),
        reason,
        now,
        podId,
        motorcycleId,
        now,
      ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
      return redirect(request, motorcycleId, "error", "stale_pod");
    }
  } catch {
    return redirect(request, motorcycleId, "error", "save_pod_void");
  }
  return redirect(request, motorcycleId, "status", "pod_voided");
}

function redirect(request: NextRequest, motorcycleId: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/motorcycles/${motorcycleId}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
