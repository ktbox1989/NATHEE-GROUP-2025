import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import {
  containerMotorcycleAssignments,
  motorcycles,
  shippingContainers,
  type ContainerAssignmentState,
} from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import {
  canTransitionContainerAssignment,
  containerStatusAllowsAssignmentTransition,
  motorcycleStatusAllowsContainerAssignmentState,
} from "@/lib/containers";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { eventTimestamp, recordTimestamp } from "@/lib/timestamps";

const actionTargets = {
  MARK_LOADED: "LOADED",
  MARK_UNLOADED: "UNLOADED",
  RELEASE: "RELEASED",
} as const satisfies Record<string, ContainerAssignmentState>;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; assignmentId: string }> },
) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:write") || !can(actor, "motorcycles:write")) {
    return NextResponse.redirect(new URL("/app", request.url), 303);
  }

  const { id: containerId, assignmentId } = await context.params;
  const form = await request.formData();
  const rawAction = String(form.get("action") ?? "");
  const newState = actionTargets[rawAction as keyof typeof actionTargets];
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500) || null;
  if (!newState || (newState === "RELEASED" && (!reason || reason.length < 3))) {
    return redirect(request, containerId, "error", "invalid_assignment_action");
  }

  const assignment = await getDb()
    .select({
      companyId: containerMotorcycleAssignments.companyId,
      state: containerMotorcycleAssignments.state,
      motorcycleStatus: motorcycles.currentStatus,
      containerStatus: shippingContainers.status,
    })
    .from(containerMotorcycleAssignments)
    .innerJoin(motorcycles, eq(motorcycles.id, containerMotorcycleAssignments.motorcycleId))
    .innerJoin(shippingContainers, eq(shippingContainers.id, containerMotorcycleAssignments.containerId))
    .where(and(
      eq(containerMotorcycleAssignments.id, assignmentId),
      eq(containerMotorcycleAssignments.containerId, containerId),
    ))
    .get();
  if (!assignment || !can(actor, "motorcycles:write", assignment.companyId)) {
    return redirect(request, containerId, "error", "assignment_not_found");
  }
  if (
    !canTransitionContainerAssignment(assignment.state, newState)
    || !motorcycleStatusAllowsContainerAssignmentState(newState, assignment.motorcycleStatus)
    || !containerStatusAllowsAssignmentTransition(assignment.state, newState, assignment.containerStatus)
  ) {
    return redirect(request, containerId, "error", "assignment_state_mismatch");
  }

  // Load-state instants are CHECK-compared against assigned_at as text; the
  // record columns sort against rows that took the CURRENT_TIMESTAMP default.
  const occurredAt = eventTimestamp();
  const recordedAt = recordTimestamp();
  const auditId = crypto.randomUUID();
  try {
    const d1 = getD1();
    const results = await d1.batch([
      d1.prepare(`
        UPDATE container_motorcycle_assignments
        SET state = ?,
            loaded_at = CASE WHEN ? = 'LOADED' THEN ? ELSE loaded_at END,
            unloaded_at = CASE WHEN ? = 'UNLOADED' THEN ? ELSE unloaded_at END,
            released_at = CASE WHEN ? = 'RELEASED' THEN ? ELSE released_at END,
            release_reason = CASE WHEN ? = 'RELEASED' THEN ? ELSE release_reason END,
            updated_at = ?
        WHERE id = ? AND container_id = ? AND state = ?
      `).bind(
        newState,
        newState,
        occurredAt,
        newState,
        occurredAt,
        newState,
        occurredAt,
        newState,
        reason,
        recordedAt,
        assignmentId,
        containerId,
        assignment.state,
      ),
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, company_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
        SELECT ?, ?, company_id, 'STATUS_CHANGE', 'container_motorcycle_assignment', id, ?, ?, ?, ?
        FROM container_motorcycle_assignments
        WHERE id = ? AND container_id = ? AND state = ? AND updated_at = ?
      `).bind(
        auditId,
        actor.userId,
        JSON.stringify({ state: assignment.state }),
        JSON.stringify({ state: newState }),
        reason,
        recordedAt,
        assignmentId,
        containerId,
        newState,
        recordedAt,
      ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
      return redirect(request, containerId, "error", "stale_assignment");
    }
  } catch {
    return redirect(request, containerId, "error", "save_assignment_state");
  }
  return redirect(request, containerId, "status", newState.toLowerCase());
}

function redirect(request: NextRequest, containerId: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/containers/${containerId}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
