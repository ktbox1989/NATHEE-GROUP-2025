import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { motorcycles } from "@/db/schema";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import {
  canEditMotorcycleIntake,
  motorcycleIntakeFingerprint,
  parseMotorcycleIntakeForm,
  type MotorcycleIntakeSnapshot,
} from "@/lib/motorcycle-intake";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp, timestampInstant } from "@/lib/timestamps";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);

  const { id } = await context.params;
  const record = await getDb().select().from(motorcycles).where(eq(motorcycles.id, id)).get();
  if (!record || !can(actor, "motorcycles:write", record.companyId)) return redirect(request, id, "forbidden");
  if (!canEditMotorcycleIntake(record.currentStatus)) return redirect(request, id, "intake_locked");

  const form = await request.formData();
  const parsed = parseMotorcycleIntakeForm(form);
  const expectedFingerprint = String(form.get("expectedFingerprint") ?? "");
  const snapshot = pickSnapshot(record);
  if (!parsed.ok || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) return redirect(request, id, "validation");
  if (expectedFingerprint !== await motorcycleIntakeFingerprint(snapshot)) return redirect(request, id, "stale_intake");

  const oldInstant = timestampInstant(record.updatedAt) ?? 0;
  const now = new Date();
  const recordedAt = recordTimestamp(now.getTime() <= oldInstant ? new Date(oldInstant + 1000) : now);
  const afterJson = JSON.stringify({ ...parsed.values, currentStatus: record.currentStatus });
  const beforeJson = JSON.stringify({ ...snapshot });
  const d1 = getD1();

  try {
    const results = await d1.batch([
      d1.prepare(`
        UPDATE motorcycles
        SET make = ?, model = ?, variant = ?, model_year = ?, color = ?, registration = ?,
            province = ?, vin = ?, engine_number = ?, vehicle_condition = ?, notes = ?, updated_at = ?
        WHERE id = ? AND current_status = 'PENDING_RECEIPT'
          AND make IS ? AND model IS ? AND variant IS ? AND model_year IS ? AND color IS ?
          AND registration IS ? AND province IS ? AND vin IS ? AND engine_number IS ?
          AND vehicle_condition IS ? AND notes IS ? AND updated_at = ?
      `).bind(
        parsed.values.make,
        parsed.values.model,
        parsed.values.variant,
        parsed.values.modelYear,
        parsed.values.color,
        parsed.values.registration,
        parsed.values.province,
        parsed.values.vin,
        parsed.values.engineNumber,
        parsed.values.vehicleCondition,
        parsed.values.notes,
        recordedAt,
        id,
        snapshot.make,
        snapshot.model,
        snapshot.variant,
        snapshot.modelYear,
        snapshot.color,
        snapshot.registration,
        snapshot.province,
        snapshot.vin,
        snapshot.engineNumber,
        snapshot.vehicleCondition,
        snapshot.notes,
        snapshot.updatedAt,
      ),
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, company_id, action, entity_type, entity_id,
           before_json, after_json, created_at)
        SELECT ?, ?, company_id, 'UPDATE', 'motorcycle', id, ?, ?, ?
        FROM motorcycles WHERE id = ? AND updated_at = ? AND changes() = 1
      `).bind(crypto.randomUUID(), actor.userId, beforeJson, afterJson, recordedAt, id, recordedAt),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
      return redirect(request, id, "stale_intake");
    }
  } catch {
    return redirect(request, id, "duplicate_intake");
  }

  return NextResponse.redirect(new URL(`/app/motorcycles/${id}?status=intake_updated`, request.url), 303);
}

function pickSnapshot(record: typeof motorcycles.$inferSelect): MotorcycleIntakeSnapshot {
  return {
    id: record.id,
    currentStatus: record.currentStatus,
    updatedAt: record.updatedAt,
    make: record.make,
    model: record.model,
    variant: record.variant,
    modelYear: record.modelYear,
    color: record.color,
    registration: record.registration,
    province: record.province,
    vin: record.vin,
    engineNumber: record.engineNumber,
    vehicleCondition: record.vehicleCondition,
    notes: record.notes,
  };
}

function redirect(request: NextRequest, id: string, error: string) {
  return NextResponse.redirect(new URL(`/app/motorcycles/${id}?error=${encodeURIComponent(error)}`, request.url), 303);
}
