import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { trips, TRIP_STATUSES, type TripStatus } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { canTransitionTrip } from "@/lib/trips";

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

  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const setDeparture = newStatus === "IN_TRANSIT" ? 1 : 0;
  const setArrival = newStatus === "ARRIVED" || newStatus === "COMPLETED" ? 1 : 0;
  try {
    const d1 = getD1();
    const results = await d1.batch([
      d1.prepare(`
        INSERT INTO trip_status_events
          (id, trip_id, previous_status, new_status, note, created_by, created_at)
        SELECT ?, id, status, ?, ?, ?, ? FROM trips
        WHERE id = ? AND status = ?
      `).bind(eventId, newStatus, note, actor.userId, now, id, trip.status),
      d1.prepare(`
        UPDATE trips
        SET status = ?,
            actual_departure_at = CASE WHEN ? = 1 THEN COALESCE(actual_departure_at, ?) ELSE actual_departure_at END,
            actual_arrival_at = CASE WHEN ? = 1 THEN COALESCE(actual_arrival_at, ?) ELSE actual_arrival_at END,
            updated_at = ?
        WHERE id = ? AND status = ?
          AND EXISTS (SELECT 1 FROM trip_status_events WHERE id = ?)
      `).bind(newStatus, setDeparture, now, setArrival, now, now, id, trip.status, eventId),
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
        now,
        eventId,
      ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1 || (results[2].meta.changes ?? 0) !== 1) {
      return redirect(request, "error", "stale_trip");
    }
  } catch {
    return redirect(request, "error", "save_status");
  }
  return redirect(request, "status", "trip_updated");
}

function redirect(request: NextRequest, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/trips?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
