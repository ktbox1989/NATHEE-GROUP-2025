import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { motorcycles, yardPlacements, yardRows, yardSlots, yardZones } from "@/db/schema";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { isYardPlacementAllowed, isYardRequestKey, YARD_EXIT_VALUE } from "@/lib/yard";
import {
  CLOSE_ACTIVE_YARD_PLACEMENT_FOR_MOVE_SQL,
  CLOSE_ACTIVE_YARD_PLACEMENT_FOR_SLOT_MOVE_SQL,
  EXIT_ACTIVE_YARD_PLACEMENT_SQL,
  insertYardPlacementSql,
  insertYardSlotPlacementSql,
} from "@/lib/yard-sql";
import { eventTimestamp, recordTimestamp } from "@/lib/timestamps";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);

  const { id } = await context.params;
  const db = getDb();
  const motorcycle = await db
    .select({ id: motorcycles.id, companyId: motorcycles.companyId, currentStatus: motorcycles.currentStatus })
    .from(motorcycles)
    .where(eq(motorcycles.id, id))
    .get();
  if (!motorcycle || !can(actor, "yard:write")) {
    return NextResponse.redirect(new URL("/app/motorcycles?error=forbidden", request.url), 303);
  }

  const form = await request.formData();
  const destinationZoneId = String(form.get("destinationZoneId") ?? "");
  const destinationSlotId = String(form.get("destinationSlotId") ?? "");
  const expectedPlacementId = String(form.get("expectedPlacementId") ?? "");
  const requestKey = String(form.get("requestKey") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  if (!isYardRequestKey(requestKey) || !expectedPlacementId) {
    return redirectTo(id, "invalid_yard", request.url);
  }

  const current = await db
    .select({
      id: yardPlacements.id,
      yardZoneId: yardPlacements.yardZoneId,
      yardRowId: yardPlacements.yardRowId,
      yardSlotId: yardPlacements.yardSlotId,
    })
    .from(yardPlacements)
    .where(and(eq(yardPlacements.motorcycleId, id), isNull(yardPlacements.exitedAt)))
    .get();
  if (expectedPlacementId !== (current?.id ?? "none")) {
    return redirectTo(id, "stale_yard", request.url);
  }

  // The placement instant is compared against other placement instants by a
  // CHECK constraint; the audit column is ordered against CURRENT_TIMESTAMP rows.
  const occurredAt = eventTimestamp();
  const recordedAt = recordTimestamp();
  const d1 = getD1();
  if (destinationZoneId === YARD_EXIT_VALUE) {
    if (!current) return redirectTo(id, "invalid_yard", request.url);
    const auditId = crypto.randomUUID();
    try {
      const results = await d1.batch([
        d1.prepare(EXIT_ACTIVE_YARD_PLACEMENT_SQL).bind(occurredAt, current.id, id),
        d1.prepare(`
          INSERT INTO audit_logs
            (id, actor_user_id, company_id, action, entity_type, entity_id,
             before_json, after_json, reason, created_at)
          SELECT ?, ?, company_id, 'YARD_EXIT', 'motorcycle', motorcycle_id, ?, ?, ?, ?
          FROM yard_placements WHERE id = ? AND exited_at = ?
        `).bind(
          auditId,
          actor.userId,
          JSON.stringify({ yardZoneId: current.yardZoneId, yardRowId: current.yardRowId, yardSlotId: current.yardSlotId }),
          JSON.stringify({ yardZoneId: null, yardRowId: null, yardSlotId: null }),
          note,
          recordedAt,
          current.id,
          occurredAt,
        ),
      ]);
      if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
        return redirectTo(id, "stale_yard", request.url);
      }
    } catch {
      return redirectTo(id, "save_yard", request.url);
    }
    return NextResponse.redirect(new URL(`/app/motorcycles/${id}?status=yard_updated`, request.url), 303);
  }

  // An exact slot decides its own zone and row, so a caller cannot name a slot
  // in one zone and a zone in another. Everything below reads the destination
  // from the slot alone.
  if (destinationSlotId) {
    if (!isYardPlacementAllowed(motorcycle.currentStatus) || current?.yardSlotId === destinationSlotId) {
      return redirectTo(id, "invalid_yard", request.url);
    }
    const slot = await db
      .select({ slotId: yardSlots.id, rowId: yardRows.id, zoneId: yardRows.yardZoneId })
      .from(yardSlots)
      .innerJoin(yardRows, eq(yardRows.id, yardSlots.yardRowId))
      .innerJoin(yardZones, eq(yardZones.id, yardRows.yardZoneId))
      .where(
        and(
          eq(yardSlots.id, destinationSlotId),
          eq(yardSlots.status, "ACTIVE"),
          eq(yardRows.status, "ACTIVE"),
          eq(yardZones.status, "ACTIVE"),
        ),
      )
      .get();
    if (!slot) return redirectTo(id, "invalid_yard", request.url);

    const placementId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    try {
      const statements = [];
      if (current) {
        statements.push(
          d1.prepare(CLOSE_ACTIVE_YARD_PLACEMENT_FOR_SLOT_MOVE_SQL).bind(occurredAt, current.id, id, destinationSlotId),
        );
      }
      statements.push(
        d1.prepare(insertYardSlotPlacementSql(Boolean(current))).bind(
          placementId,
          requestKey,
          id,
          motorcycle.companyId,
          occurredAt,
          actor.userId,
          note,
          destinationSlotId,
          id,
          ...(current ? [current.id, occurredAt] : []),
        ),
      );
      statements.push(
        d1.prepare(`
          INSERT INTO audit_logs
            (id, actor_user_id, company_id, action, entity_type, entity_id,
             before_json, after_json, reason, created_at)
          SELECT ?, ?, company_id, ?, 'motorcycle', motorcycle_id, ?, ?, ?, ?
          FROM yard_placements WHERE id = ?
        `).bind(
          auditId,
          actor.userId,
          current ? "YARD_MOVE" : "YARD_ENTRY",
          JSON.stringify({
            yardZoneId: current?.yardZoneId ?? null,
            yardRowId: current?.yardRowId ?? null,
            yardSlotId: current?.yardSlotId ?? null,
          }),
          JSON.stringify({ yardZoneId: slot.zoneId, yardRowId: slot.rowId, yardSlotId: slot.slotId }),
          note,
          recordedAt,
          placementId,
        ),
      );

      const results = await d1.batch(statements);
      const insertIndex = current ? 1 : 0;
      const auditIndex = current ? 2 : 1;
      const closed = !current || (results[0].meta.changes ?? 0) === 1;
      // A slot taken between the check and the write leaves the motorcycle where
      // it was: the close is conditional on the same emptiness the insert is.
      if (!closed || (results[insertIndex].meta.changes ?? 0) !== 1 || (results[auditIndex].meta.changes ?? 0) !== 1) {
        return redirectTo(id, "yard_conflict", request.url);
      }
    } catch {
      return redirectTo(id, "save_yard", request.url);
    }
    return NextResponse.redirect(new URL(`/app/motorcycles/${id}?status=yard_updated`, request.url), 303);
  }

  if (!isYardPlacementAllowed(motorcycle.currentStatus) || current?.yardZoneId === destinationZoneId) {
    return redirectTo(id, "invalid_yard", request.url);
  }
  const zone = await db
    .select({ id: yardZones.id })
    .from(yardZones)
    .where(and(eq(yardZones.id, destinationZoneId), eq(yardZones.status, "ACTIVE")))
    .get();
  if (!zone) return redirectTo(id, "invalid_yard", request.url);

  const placementId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const beforeJson = JSON.stringify({
    yardZoneId: current?.yardZoneId ?? null,
    yardRowId: current?.yardRowId ?? null,
    yardSlotId: current?.yardSlotId ?? null,
  });
  const afterJson = JSON.stringify({ yardZoneId: destinationZoneId, yardRowId: null, yardSlotId: null });
  const auditAction = current ? "YARD_MOVE" : "YARD_ENTRY";
  try {
    const statements = [];
    if (current) {
      statements.push(d1.prepare(CLOSE_ACTIVE_YARD_PLACEMENT_FOR_MOVE_SQL).bind(occurredAt, current.id, id, destinationZoneId));
    }
    statements.push(d1.prepare(insertYardPlacementSql(Boolean(current))).bind(
      placementId,
      requestKey,
      id,
      motorcycle.companyId,
      occurredAt,
      actor.userId,
      note,
      destinationZoneId,
      id,
      ...(current ? [current.id, occurredAt] : []),
    ));
    statements.push(d1.prepare(`
      INSERT INTO audit_logs
        (id, actor_user_id, company_id, action, entity_type, entity_id,
         before_json, after_json, reason, created_at)
      SELECT ?, ?, company_id, ?, 'motorcycle', motorcycle_id, ?, ?, ?, ?
      FROM yard_placements WHERE id = ?
    `).bind(auditId, actor.userId, auditAction, beforeJson, afterJson, note, recordedAt, placementId));

    const results = await d1.batch(statements);
    const insertIndex = current ? 1 : 0;
    const auditIndex = current ? 2 : 1;
    const updateSucceeded = !current || (results[0].meta.changes ?? 0) === 1;
    if (!updateSucceeded || (results[insertIndex].meta.changes ?? 0) !== 1 || (results[auditIndex].meta.changes ?? 0) !== 1) {
      return redirectTo(id, "yard_conflict", request.url);
    }
  } catch {
    return redirectTo(id, "save_yard", request.url);
  }
  return NextResponse.redirect(new URL(`/app/motorcycles/${id}?status=yard_updated`, request.url), 303);
}

function redirectTo(id: string, error: string, requestUrl: string) {
  return NextResponse.redirect(new URL(`/app/motorcycles/${id}?error=${error}`, requestUrl), 303);
}
