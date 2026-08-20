import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import {
  containerMotorcycleAssignments,
  motorcycles,
  shippingContainers,
  CONTAINER_STATUSES,
  type ContainerStatus,
} from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import {
  canTransitionContainer,
  containerReadinessIssue,
  normalizeContainerText,
} from "@/lib/containers";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:write")) {
    return NextResponse.redirect(new URL("/app", request.url), 303);
  }

  const { id } = await context.params;
  const container = await getDb().select().from(shippingContainers).where(eq(shippingContainers.id, id)).get();
  if (!container) return redirect(request, id, "error", "container_not_found");
  const form = await request.formData();
  const rawStatus = String(form.get("newStatus") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 1000) || null;
  if (!CONTAINER_STATUSES.includes(rawStatus as ContainerStatus)) {
    return redirect(request, id, "error", "invalid_status");
  }
  const newStatus = rawStatus as ContainerStatus;
  if (!canTransitionContainer(container.status, newStatus) || (newStatus === "CANCELLED" && !note)) {
    return redirect(request, id, "error", "invalid_transition");
  }

  const submittedSeal = newStatus === "SEALED"
    ? normalizeContainerText(String(form.get("sealNumber") ?? ""), 50)
    : container.sealNumber;
  if (submittedSeal === undefined || (newStatus === "SEALED" && !submittedSeal)) {
    return redirect(request, id, "error", "invalid_seal");
  }

  const assignments = await getDb()
    .select({ state: containerMotorcycleAssignments.state, motorcycleStatus: motorcycles.currentStatus })
    .from(containerMotorcycleAssignments)
    .innerJoin(motorcycles, eq(motorcycles.id, containerMotorcycleAssignments.motorcycleId))
    .where(and(
      eq(containerMotorcycleAssignments.containerId, id),
      isNull(containerMotorcycleAssignments.releasedAt),
    ))
    .limit(1000)
    .all();
  if (containerReadinessIssue(newStatus, assignments, submittedSeal)) {
    return redirect(request, id, "error", "container_not_ready");
  }

  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const setSeal = newStatus === "SEALED" ? 1 : 0;
  const releaseFrom = newStatus === "CANCELLED" ? "ASSIGNED" : newStatus === "COMPLETED" ? "UNLOADED" : null;
  const releaseReason = newStatus === "CANCELLED" ? "CONTAINER_CANCELLED" : newStatus === "COMPLETED" ? "CONTAINER_COMPLETED" : null;
  const expectedReleased = releaseFrom ? assignments.length : 0;
  try {
    const d1 = getD1();
    const results = await d1.batch([
      d1.prepare(`
        INSERT INTO container_status_events
          (id, container_id, previous_status, new_status, note, created_by, created_at)
        SELECT ?, id, status, ?, ?, ?, ? FROM shipping_containers
        WHERE id = ? AND status = ?
      `).bind(eventId, newStatus, note, actor.userId, now, id, container.status),
      d1.prepare(`
        UPDATE shipping_containers
        SET status = ?,
            seal_number = CASE WHEN ? = 1 THEN ? ELSE seal_number END,
            updated_at = ?
        WHERE id = ? AND status = ?
          AND EXISTS (SELECT 1 FROM container_status_events WHERE id = ?)
      `).bind(newStatus, setSeal, submittedSeal, now, id, container.status, eventId),
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
        SELECT ?, ?, 'STATUS_CHANGE', 'shipping_container', ?, ?, ?, ?, ?
        FROM container_status_events WHERE id = ?
      `).bind(
        auditId,
        actor.userId,
        id,
        JSON.stringify({ status: container.status, seal: container.sealNumber ? "PRESENT" : "MISSING" }),
        JSON.stringify({ status: newStatus, seal: submittedSeal ? "PRESENT" : "MISSING" }),
        note,
        now,
        eventId,
      ),
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, company_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
        SELECT lower(hex(randomblob(16))), ?, company_id, 'STATUS_CHANGE',
               'container_motorcycle_assignment', id, ?, ?, ?, ?
        FROM container_motorcycle_assignments
        WHERE container_id = ? AND released_at IS NULL AND state = ?
      `).bind(
        actor.userId,
        JSON.stringify({ state: releaseFrom }),
        JSON.stringify({ state: "RELEASED" }),
        releaseReason,
        now,
        id,
        releaseFrom,
      ),
      d1.prepare(`
        UPDATE container_motorcycle_assignments
        SET state = 'RELEASED', released_at = ?, release_reason = ?, updated_at = ?
        WHERE container_id = ? AND released_at IS NULL AND state = ?
      `).bind(now, releaseReason, now, id, releaseFrom),
    ]);
    if (
      (results[0].meta.changes ?? 0) !== 1
      || (results[1].meta.changes ?? 0) !== 1
      || (results[2].meta.changes ?? 0) !== 1
      || (results[3].meta.changes ?? 0) !== expectedReleased
      || (results[4].meta.changes ?? 0) !== expectedReleased
    ) {
      return redirect(request, id, "error", "stale_container");
    }
  } catch {
    return redirect(request, id, "error", "save_status");
  }
  return redirect(request, id, "status", "container_updated");
}

function redirect(request: NextRequest, id: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/containers/${id}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
