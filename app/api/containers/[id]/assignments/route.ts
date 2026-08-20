import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import {
  auditLogs,
  containerMotorcycleAssignments,
  motorcycles,
  shippingContainers,
  tripMotorcycleAssignments,
} from "@/db/schema";
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

  const { id: containerId } = await context.params;
  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "");
  const motorcycleId = String(form.get("motorcycleId") ?? "");
  if (!isTripRequestKey(requestKey) || !motorcycleId) {
    return redirect(request, containerId, "error", "invalid_assignment");
  }

  const db = getDb();
  const existing = await db
    .select({
      containerId: containerMotorcycleAssignments.containerId,
      motorcycleId: containerMotorcycleAssignments.motorcycleId,
    })
    .from(containerMotorcycleAssignments)
    .where(eq(containerMotorcycleAssignments.requestKey, requestKey))
    .get();
  if (existing) {
    return existing.containerId === containerId && existing.motorcycleId === motorcycleId
      ? redirect(request, containerId, "status", "assignment_exists")
      : redirect(request, containerId, "error", "request_conflict");
  }

  const [container, motorcycle] = await Promise.all([
    db
      .select({ id: shippingContainers.id, status: shippingContainers.status })
      .from(shippingContainers)
      .where(eq(shippingContainers.id, containerId))
      .get(),
    db
      .select({ id: motorcycles.id, companyId: motorcycles.companyId, status: motorcycles.currentStatus })
      .from(motorcycles)
      .where(eq(motorcycles.id, motorcycleId))
      .get(),
  ]);
  if (!container || !["DRAFT", "PLANNED"].includes(container.status)) {
    return redirect(request, containerId, "error", "container_not_assignable");
  }
  if (!motorcycle || motorcycle.status !== "SCHEDULED" || !can(actor, "motorcycles:write", motorcycle.companyId)) {
    return redirect(request, containerId, "error", "motorcycle_not_assignable");
  }

  const assignmentId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.insert(containerMotorcycleAssignments).values({
        id: assignmentId,
        requestKey,
        containerId,
        motorcycleId,
        companyId: motorcycle.companyId,
        assignedBy: actor.userId,
        assignedAt: now,
      }),
      db.insert(auditLogs).values(makeAuditRecord({
        actor,
        action: "ASSIGN",
        entityType: "container_motorcycle_assignment",
        entityId: assignmentId,
        companyId: motorcycle.companyId,
        after: { containerId, motorcycleId, state: "ASSIGNED" },
      })),
    ]);
  } catch {
    const raced = await getDb()
      .select({
        containerId: containerMotorcycleAssignments.containerId,
        motorcycleId: containerMotorcycleAssignments.motorcycleId,
      })
      .from(containerMotorcycleAssignments)
      .where(eq(containerMotorcycleAssignments.requestKey, requestKey))
      .get();
    if (raced && raced.containerId === containerId && raced.motorcycleId === motorcycleId) {
      return redirect(request, containerId, "status", "assignment_exists");
    }
    const [activeContainer, activeTrip] = await Promise.all([
      getDb()
        .select({ id: containerMotorcycleAssignments.id })
        .from(containerMotorcycleAssignments)
        .where(and(eq(containerMotorcycleAssignments.motorcycleId, motorcycleId), isNull(containerMotorcycleAssignments.releasedAt)))
        .get(),
      getDb()
        .select({ id: tripMotorcycleAssignments.id })
        .from(tripMotorcycleAssignments)
        .where(and(eq(tripMotorcycleAssignments.motorcycleId, motorcycleId), isNull(tripMotorcycleAssignments.releasedAt)))
        .get(),
    ]);
    return redirect(
      request,
      containerId,
      "error",
      activeContainer || activeTrip ? "motorcycle_already_assigned" : "save_assignment",
    );
  }
  return redirect(request, containerId, "status", "assignment_created");
}

function redirect(request: NextRequest, containerId: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/containers/${containerId}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
