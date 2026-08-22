import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { motorcycles, tripMotorcycleAssignments, trips, TRIP_STATUSES, type TripStatus } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { canTransitionTrip, tripReadinessIssue } from "@/lib/trips";
import { eventTimestamp, recordTimestamp } from "@/lib/timestamps";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const { id } = await context.params;
  const trip = await getDb().select().from(trips).where(eq(trips.id, id)).get();
  if (!trip) return redirect(request, "error", "trip_not_found");
  const form = await request.formData();
  const rawStatus = String(form.get("newStatus") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 1000) || null;
  if (!TRIP_STATUSES.includes(rawStatus as TripStatus)) return redirect(request, "error", "invalid_status");
  const newStatus = rawStatus as TripStatus;
  if (!canTransitionTrip(trip.status, newStatus) || (newStatus === "CANCELLED" && !note)) return redirect(request, "error", "invalid_transition");

  const assignments = await getDb()
    .select({ state: tripMotorcycleAssignments.state, motorcycleStatus: motorcycles.currentStatus })
    .from(tripMotorcycleAssignments)
    .innerJoin(motorcycles, eq(motorcycles.id, tripMotorcycleAssignments.motorcycleId))
    .where(and(eq(tripMotorcycleAssignments.tripId, id), isNull(tripMotorcycleAssignments.releasedAt)))
    .all();
  if (tripReadinessIssue(newStatus, assignments)) return redirect(request, "error", "trip_not_ready");

  // Real-world instants stay ISO-8601 because CHECK constraints compare them
  // as text; record columns match what CURRENT_TIMESTAMP writes.
  const occurredAt = eventTimestamp();
  const recordedAt = recordTimestamp();
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const setDeparture = newStatus === "IN_TRANSIT" ? 1 : 0;
  const setArrival = newStatus === "ARRIVED" || newStatus === "COMPLETED" ? 1 : 0;
  const releaseFrom = newStatus === "CANCELLED" ? "ASSIGNED" : newStatus === "COMPLETED" ? "UNLOADED" : null;
  const releaseReason = newStatus === "CANCELLED" ? "TRIP_CANCELLED" : newStatus === "COMPLETED" ? "TRIP_COMPLETED" : null;
  const expectedReleased = releaseFrom ? assignments.length : 0;
  try {
    const d1 = getD1();
    const results = await d1.batch([
      d1.prepare(`
        INSERT INTO trip_status_events
          (id, trip_id, previous_status, new_status, note, created_by, created_at)
        SELECT ?, id, status, ?, ?, ?, ? FROM trips
        WHERE id = ? AND status = ?
      `).bind(eventId, newStatus, note, actor.userId, recordedAt, id, trip.status),
      d1.prepare(`
        UPDATE trips
        SET status = ?,
            actual_departure_at = CASE WHEN ? = 1 THEN COALESCE(actual_departure_at, ?) ELSE actual_departure_at END,
            actual_arrival_at = CASE WHEN ? = 1 THEN COALESCE(actual_arrival_at, ?) ELSE actual_arrival_at END,
            updated_at = ?
        WHERE id = ? AND status = ?
          AND EXISTS (SELECT 1 FROM trip_status_events WHERE id = ?)
      `).bind(newStatus, setDeparture, occurredAt, setArrival, occurredAt, recordedAt, id, trip.status, eventId),
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
        SELECT ?, ?, 'STATUS_CHANGE', 'trip', ?, ?, ?, ?, ?
        FROM trip_status_events WHERE id = ?
      `).bind(
        auditId,
        actor.userId,
        id,
        JSON.stringify({ status: trip.status }),
        JSON.stringify({ status: newStatus }),
        note,
        recordedAt,
        eventId,
      ),
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, company_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
        SELECT lower(hex(randomblob(16))), ?, company_id, 'STATUS_CHANGE',
               'trip_motorcycle_assignment', id, ?, ?, ?, ?
        FROM trip_motorcycle_assignments
        WHERE trip_id = ? AND released_at IS NULL AND state = ?
      `).bind(
        actor.userId,
        JSON.stringify({ state: releaseFrom }),
        JSON.stringify({ state: "RELEASED" }),
        releaseReason,
        recordedAt,
        id,
        releaseFrom,
      ),
      d1.prepare(`
        UPDATE trip_motorcycle_assignments
        SET state = 'RELEASED', released_at = ?, release_reason = ?, updated_at = ?
        WHERE trip_id = ? AND released_at IS NULL AND state = ?
      `).bind(occurredAt, releaseReason, recordedAt, id, releaseFrom),
    ]);
    if (
      (results[0].meta.changes ?? 0) !== 1
      || (results[1].meta.changes ?? 0) !== 1
      || (results[2].meta.changes ?? 0) !== 1
      || (results[3].meta.changes ?? 0) !== expectedReleased
      || (results[4].meta.changes ?? 0) !== expectedReleased
    ) {
      return redirect(request, "error", "stale_trip");
    }
  } catch {
    return redirect(request, "error", "save_status");
  }
  return redirect(request, "status", "trip_updated");
}

function redirect(request: NextRequest, key: string, value: string) {
  const id = request.nextUrl.pathname.split("/").filter(Boolean).at(-2);
  return NextResponse.redirect(new URL(`/app/trips/${id}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
