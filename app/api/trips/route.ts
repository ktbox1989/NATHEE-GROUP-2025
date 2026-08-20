import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, trips, tripStatusEvents, trucks, userRoleAssignments, users } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can, effectiveRoleFromLegacy, isInternalRole } from "@/lib/authorization";
import { nextBusinessNumber } from "@/lib/business-numbers";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { bangkokInputToUtc, isPlannedTripOrderValid, isTripRequestKey } from "@/lib/trips";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "");
  const truckId = String(form.get("truckId") ?? "");
  const driverUserId = String(form.get("driverUserId") ?? "") || null;
  const origin = String(form.get("origin") ?? "").trim().slice(0, 200);
  const destination = String(form.get("destination") ?? "").trim().slice(0, 200);
  const plannedDepartureAt = bangkokInputToUtc(String(form.get("plannedDepartureAt") ?? ""));
  const plannedArrivalAt = bangkokInputToUtc(String(form.get("plannedArrivalAt") ?? ""));
  const notes = optional(form, "notes", 1000);
  if (!isTripRequestKey(requestKey) || !truckId || !origin || !destination || plannedDepartureAt === undefined || plannedArrivalAt === undefined || !isPlannedTripOrderValid(plannedDepartureAt, plannedArrivalAt)) return redirect(request, "error", "invalid_trip");

  const db = getDb();
  const existingRequest = await db.select({ id: trips.id }).from(trips).where(eq(trips.requestKey, requestKey)).get();
  if (existingRequest) return redirect(request, "status", "trip_exists");
  const truck = await db.select({ id: trucks.id }).from(trucks).where(and(eq(trucks.id, truckId), eq(trucks.status, "ACTIVE"))).get();
  if (!truck) return redirect(request, "error", "truck_unavailable");
  if (driverUserId) {
    const driver = await db
      .select({ legacyRole: users.role, assignedRole: userRoleAssignments.role })
      .from(users)
      .leftJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
      .where(and(eq(users.id, driverUserId), eq(users.status, "ACTIVE")))
      .get();
    const role = driver ? driver.assignedRole ?? effectiveRoleFromLegacy(driver.legacyRole) : null;
    if (role !== "DRIVER") return redirect(request, "error", "invalid_driver");
  }

  const id = crypto.randomUUID();
  const tripNumber = await nextBusinessNumber("TRIP");
  const record = { id, requestKey, publicId: crypto.randomUUID(), tripNumber, truckId, driverUserId, origin, destination, plannedDepartureAt, plannedArrivalAt, notes, status: "DRAFT" as const, createdBy: actor.userId };
  try {
    await db.batch([
      db.insert(trips).values(record),
      db.insert(tripStatusEvents).values({ id: crypto.randomUUID(), tripId: id, previousStatus: null, newStatus: "DRAFT", note: "สร้างเที่ยววิ่ง", createdBy: actor.userId }),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "trip", entityId: id, after: { ...record, publicId: "[opaque]" } })),
    ]);
  } catch {
    const existing = await getDb().select({ id: trips.id }).from(trips).where(eq(trips.requestKey, requestKey)).get();
    if (existing) return redirect(request, "status", "trip_exists");
    return redirect(request, "error", "save_trip");
  }
  return redirect(request, "status", "trip_created");
}

function optional(form: FormData, name: string, maxLength: number): string | null {
  const value = String(form.get(name) ?? "").trim().slice(0, maxLength);
  return value || null;
}

function redirect(request: NextRequest, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/trips?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
