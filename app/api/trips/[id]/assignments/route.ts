import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, motorcycles, tripMotorcycleAssignments, trips } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can, isInternalRole } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { isTripRequestKey } from "@/lib/trips";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:write") || !can(actor, "motorcycles:write")) {
    return NextResponse.redirect(new URL("/app", request.url), 303);
  }

  const { id: tripId } = await context.params;
  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "");
  const motorcycleId = String(form.get("motorcycleId") ?? "");
  if (!isTripRequestKey(requestKey) || !motorcycleId) return redirect(request, tripId, "error", "invalid_assignment");

  const db = getDb();
  const existing = await db
    .select({ tripId: tripMotorcycleAssignments.tripId, motorcycleId: tripMotorcycleAssignments.motorcycleId })
    .from(tripMotorcycleAssignments)
    .where(eq(tripMotorcycleAssignments.requestKey, requestKey))
    .get();
  if (existing) {
    return existing.tripId === tripId && existing.motorcycleId === motorcycleId
      ? redirect(request, tripId, "status", "assignment_exists")
      : redirect(request, tripId, "error", "request_conflict");
  }

  const [trip, motorcycle] = await Promise.all([
    db.select({ id: trips.id, status: trips.status }).from(trips).where(eq(trips.id, tripId)).get(),
    db.select({ id: motorcycles.id, companyId: motorcycles.companyId, status: motorcycles.currentStatus }).from(motorcycles).where(eq(motorcycles.id, motorcycleId)).get(),
  ]);
  if (!trip || !["DRAFT", "PLANNED"].includes(trip.status)) return redirect(request, tripId, "error", "trip_not_assignable");
  if (!motorcycle || motorcycle.status !== "SCHEDULED" || !can(actor, "motorcycles:write", motorcycle.companyId)) {
    return redirect(request, tripId, "error", "motorcycle_not_assignable");
  }

  const assignmentId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.insert(tripMotorcycleAssignments).values({
        id: assignmentId,
        requestKey,
        tripId,
        motorcycleId,
        companyId: motorcycle.companyId,
        assignedBy: actor.userId,
        assignedAt: now,
      }),
      db.insert(auditLogs).values(makeAuditRecord({
        actor,
        action: "ASSIGN",
        entityType: "trip_motorcycle_assignment",
        entityId: assignmentId,
        companyId: motorcycle.companyId,
        after: { tripId, motorcycleId, state: "ASSIGNED" },
      })),
    ]);
  } catch {
    const raced = await getDb()
      .select({ tripId: tripMotorcycleAssignments.tripId, motorcycleId: tripMotorcycleAssignments.motorcycleId })
      .from(tripMotorcycleAssignments)
      .where(eq(tripMotorcycleAssignments.requestKey, requestKey))
      .get();
    if (raced && raced.tripId === tripId && raced.motorcycleId === motorcycleId) {
      return redirect(request, tripId, "status", "assignment_exists");
    }
    const active = await getDb()
      .select({ id: tripMotorcycleAssignments.id })
      .from(tripMotorcycleAssignments)
      .where(and(eq(tripMotorcycleAssignments.motorcycleId, motorcycleId), isNull(tripMotorcycleAssignments.releasedAt)))
      .get();
    return redirect(request, tripId, "error", active ? "motorcycle_already_assigned" : "save_assignment");
  }
  return redirect(request, tripId, "status", "assignment_created");
}

function redirect(request: NextRequest, tripId: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/trips/${tripId}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
