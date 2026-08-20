import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, trucks, TRUCK_TYPES, type TruckType } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can, isInternalRole } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { isTripRequestKey, normalizeRegistration, normalizeTruckCode, parseTruckCapacity } from "@/lib/trips";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "");
  const code = normalizeTruckCode(String(form.get("code") ?? ""));
  const registration = normalizeRegistration(String(form.get("registration") ?? ""));
  const rawType = String(form.get("type") ?? "");
  const capacityMotorcycles = parseTruckCapacity(String(form.get("capacityMotorcycles") ?? ""));
  const notes = optional(form, "notes", 1000);
  if (!isTripRequestKey(requestKey) || !code || registration === undefined || !TRUCK_TYPES.includes(rawType as TruckType) || capacityMotorcycles === undefined) return redirect(request, "error", "invalid_truck");

  const existingRequest = await getDb().select({ id: trucks.id }).from(trucks).where(eq(trucks.requestKey, requestKey)).get();
  if (existingRequest) return redirect(request, "status", "truck_exists");

  const id = crypto.randomUUID();
  const record = { id, requestKey, publicId: crypto.randomUUID(), code, registration, type: rawType as TruckType, capacityMotorcycles, notes, createdBy: actor.userId };
  try {
    const db = getDb();
    await db.batch([
      db.insert(trucks).values(record),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "truck", entityId: id, after: { ...record, publicId: "[opaque]" } })),
    ]);
  } catch {
    const existing = await getDb().select({ id: trucks.id }).from(trucks).where(eq(trucks.requestKey, requestKey)).get();
    if (existing) return redirect(request, "status", "truck_exists");
    return redirect(request, "error", "duplicate_truck");
  }
  return redirect(request, "status", "truck_created");
}

function optional(form: FormData, name: string, maxLength: number): string | null {
  const value = String(form.get(name) ?? "").trim().slice(0, maxLength);
  return value || null;
}

function redirect(request: NextRequest, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/trips?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
