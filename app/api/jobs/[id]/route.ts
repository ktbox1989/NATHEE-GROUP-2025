import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { transportJobs } from "@/db/schema";
import { adminReturnTarget } from "@/lib/admin-return";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);

  const { id } = await context.params;
  const job = await getDb()
    .select({
      id: transportJobs.id,
      companyId: transportJobs.companyId,
      status: transportJobs.status,
      origin: transportJobs.origin,
      destination: transportJobs.destination,
      plannedPickupDate: transportJobs.plannedPickupDate,
      plannedDeliveryDate: transportJobs.plannedDeliveryDate,
      notes: transportJobs.notes,
      updatedAt: transportJobs.updatedAt,
    })
    .from(transportJobs)
    .where(eq(transportJobs.id, id))
    .get();

  if (!job || !can(actor, "jobs:write", job.companyId)) {
    return redirect(request, `/app/jobs/${encodeURIComponent(id)}`, "error", "forbidden");
  }
  if (job.status === "COMPLETED" || job.status === "CANCELLED") {
    return redirect(request, `/app/jobs/${encodeURIComponent(id)}`, "error", "locked");
  }

  const form = await request.formData();
  const back = adminReturnTarget(form, `/app/jobs/${encodeURIComponent(id)}`);
  const expectedUpdatedAt = String(form.get("expectedUpdatedAt") ?? "");
  if (!expectedUpdatedAt || expectedUpdatedAt !== job.updatedAt) {
    return redirect(request, back, "error", "stale");
  }

  const origin = String(form.get("origin") ?? "").trim();
  const destination = String(form.get("destination") ?? "").trim();
  const notes = String(form.get("notes") ?? "").trim();
  const changeReason = String(form.get("changeReason") ?? "").trim();
  const pickup = optionalDate(form, "plannedPickupDate");
  const delivery = optionalDate(form, "plannedDeliveryDate");

  if (!origin || origin.length > 200 || !destination || destination.length > 200) {
    return redirect(request, back, "error", "invalid_details");
  }
  if (notes.length > 2000 || changeReason.length < 3 || changeReason.length > 500) {
    return redirect(request, back, "error", "invalid_details");
  }
  if (pickup === undefined || delivery === undefined || (pickup && delivery && delivery < pickup)) {
    return redirect(request, back, "error", "invalid_schedule");
  }

  const next = {
    origin,
    destination,
    plannedPickupDate: pickup,
    plannedDeliveryDate: delivery,
    notes: notes || null,
  };
  const previous = {
    origin: job.origin,
    destination: job.destination,
    plannedPickupDate: job.plannedPickupDate,
    plannedDeliveryDate: job.plannedDeliveryDate,
    notes: job.notes,
  };
  if (JSON.stringify(next) === JSON.stringify(previous)) {
    return redirect(request, back, "status", "unchanged");
  }

  const recordedAt = recordTimestamp();
  const auditId = crypto.randomUUID();
  try {
    const d1 = getD1();
    const results = await d1.batch([
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, company_id, action, entity_type, entity_id,
           before_json, after_json, reason, created_at)
        SELECT ?, ?, company_id, 'UPDATE', 'transport_job', ?, ?, ?, ?, ?
        FROM transport_jobs
        WHERE id = ? AND status = ? AND updated_at = ?
          AND origin = ? AND destination = ?
          AND planned_pickup_date IS ? AND planned_delivery_date IS ?
          AND notes IS ?
      `).bind(
        auditId,
        actor.userId,
        id,
        JSON.stringify(previous),
        JSON.stringify(next),
        changeReason,
        recordedAt,
        id,
        job.status,
        expectedUpdatedAt,
        job.origin,
        job.destination,
        job.plannedPickupDate,
        job.plannedDeliveryDate,
        job.notes,
      ),
      d1.prepare(`
        UPDATE transport_jobs
        SET origin = ?, destination = ?, planned_pickup_date = ?,
            planned_delivery_date = ?, notes = ?, updated_at = ?
        WHERE id = ? AND status = ?
          AND EXISTS (SELECT 1 FROM audit_logs WHERE id = ?)
      `).bind(
        origin,
        destination,
        pickup,
        delivery,
        next.notes,
        recordedAt,
        id,
        job.status,
        auditId,
      ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
      return redirect(request, back, "error", "stale");
    }
  } catch {
    return redirect(request, back, "error", "save_details");
  }

  return redirect(request, back, "status", "details_updated");
}

function optionalDate(form: FormData, name: string): string | null | undefined {
  const value = String(form.get(name) ?? "").trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function redirect(
  request: NextRequest,
  base: string,
  key: "status" | "error",
  value: string,
) {
  return NextResponse.redirect(new URL(`${base}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
