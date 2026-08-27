import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { MOTORCYCLE_STATUSES, motorcycleInspections, motorcycles } from "@/db/schema";
import type { MotorcycleStatus } from "@/db/schema";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { STATUS_NOTIFICATION_INSERT_SQL } from "@/lib/notification-sql";
import { statusNotificationContent } from "@/lib/notifications";
import { isSameOrigin } from "@/lib/same-origin";
import { canTransition } from "@/lib/status-transitions";
import { recordTimestamp } from "@/lib/timestamps";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const { id } = await context.params;
  const db = getDb();
  const motorcycle = await db.select().from(motorcycles).where(eq(motorcycles.id, id)).get();
  if (!motorcycle || !can(actor, "status:write", motorcycle.companyId)) {
    return NextResponse.redirect(new URL("/app/motorcycles?error=forbidden", request.url), 303);
  }
  const form = await request.formData();
  const rawStatus = String(form.get("newStatus") ?? "");
  if (!MOTORCYCLE_STATUSES.includes(rawStatus as MotorcycleStatus)) {
    return NextResponse.redirect(new URL(`/app/motorcycles/${id}?error=status`, request.url), 303);
  }
  const newStatus = rawStatus as MotorcycleStatus;
  const note = String(form.get("note") ?? "").trim().slice(0, 1000) || null;
  const requiresReason = ["ISSUE", "DAMAGED", "CANCELLED"].includes(newStatus);
  const requiresReceiptEvidence = newStatus === "RECEIVED" || newStatus === "INSPECTED";
  const receiptEvidence = requiresReceiptEvidence
    ? await db
        .select({ id: motorcycleInspections.id })
        .from(motorcycleInspections)
        .where(and(
          eq(motorcycleInspections.motorcycleId, id),
          eq(motorcycleInspections.type, "RECEIPT"),
          eq(motorcycleInspections.result, "PASS"),
          isNotNull(motorcycleInspections.leftImageId),
          isNotNull(motorcycleInspections.rightImageId),
          isNotNull(motorcycleInspections.frontImageId),
          isNotNull(motorcycleInspections.rearImageId),
        ))
        .get()
    : null;
  if (!canTransition(motorcycle.currentStatus, newStatus) || (requiresReason && !note) || (requiresReceiptEvidence && !receiptEvidence)) {
    return NextResponse.redirect(new URL(`/app/motorcycles/${id}?error=transition`, request.url), 303);
  }

  const recordedAt = recordTimestamp();
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const notification = statusNotificationContent({
    motorcycleId: motorcycle.id,
    publicId: motorcycle.publicId,
    newStatus,
  });
  try {
    const d1 = getD1();
    const results = await d1.batch([
      d1.prepare(`
        INSERT INTO status_events
          (id, motorcycle_id, company_id, previous_status, new_status, note, created_by, created_at)
        SELECT ?, id, company_id, current_status, ?, ?, ?, ?
        FROM motorcycles
        WHERE id = ? AND current_status = ?
      `).bind(eventId, newStatus, note, actor.userId, recordedAt, id, motorcycle.currentStatus),
      d1.prepare(`
        UPDATE motorcycles
        SET current_status = ?, updated_at = ?
        WHERE id = ? AND current_status = ?
          AND EXISTS (SELECT 1 FROM status_events WHERE id = ?)
      `).bind(newStatus, recordedAt, id, motorcycle.currentStatus, eventId),
      d1.prepare(STATUS_NOTIFICATION_INSERT_SQL).bind(
        eventId,
        notification.severity,
        notification.title,
        notification.body,
        notification.href,
        recordedAt,
        eventId,
      ),
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, company_id, action, entity_type, entity_id,
           before_json, after_json, reason, created_at)
        SELECT ?, ?, company_id, 'STATUS_CHANGE', 'motorcycle', ?, ?, ?, ?, ?
        FROM status_events
        WHERE id = ?
      `).bind(
        auditId,
        actor.userId,
        id,
        JSON.stringify({ currentStatus: motorcycle.currentStatus }),
        JSON.stringify({ currentStatus: newStatus }),
        note,
        recordedAt,
        eventId,
      ),
    ]);

    if ((results[0].meta.changes ?? 0) !== 1) {
      return NextResponse.redirect(
        new URL(`/app/motorcycles/${id}?error=stale`, request.url),
        303,
      );
    }
  } catch {
    return NextResponse.redirect(
      new URL(`/app/motorcycles/${id}?error=save`, request.url),
      303,
    );
  }
  return NextResponse.redirect(new URL(`/app/motorcycles/${id}?status=updated`, request.url), 303);
}
