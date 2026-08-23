import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, yardPlacements, yardRows, yardSlots } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

const STATUSES = new Set(["ACTIVE", "BLOCKED", "RETIRED"]);

/**
 * Blocks, retires or reopens one parking position.
 *
 * A slot with a motorcycle in it cannot be blocked or retired: the vehicle would
 * still be there and the yard map would say the bay is unusable, which is how a
 * motorcycle gets lost.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "yard:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const { id } = await context.params;
  const form = await request.formData();
  const status = String(form.get("status") ?? "").toUpperCase();
  if (!STATUSES.has(status)) return NextResponse.redirect(new URL("/app/yard?error=invalid_slot", request.url), 303);

  const db = getDb();
  const slot = await db
    .select({ id: yardSlots.id, status: yardSlots.status, code: yardSlots.code, zoneId: yardRows.yardZoneId })
    .from(yardSlots)
    .innerJoin(yardRows, eq(yardRows.id, yardSlots.yardRowId))
    .where(eq(yardSlots.id, id))
    .get();
  if (!slot) return NextResponse.redirect(new URL("/app/yard?error=invalid_slot", request.url), 303);

  if (status !== "ACTIVE") {
    const occupant = await db
      .select({ id: yardPlacements.id })
      .from(yardPlacements)
      .where(and(eq(yardPlacements.yardSlotId, id), isNull(yardPlacements.exitedAt)))
      .get();
    if (occupant) {
      return NextResponse.redirect(new URL(`/app/yard/${slot.zoneId}?error=slot_occupied`, request.url), 303);
    }
  }

  await db.batch([
    db.update(yardSlots).set({ status: status as "ACTIVE" | "BLOCKED" | "RETIRED", updatedAt: recordTimestamp() }).where(eq(yardSlots.id, id)),
    db.insert(auditLogs).values(
      makeAuditRecord({
        actor,
        action: "UPDATE",
        entityType: "yard_slot",
        entityId: id,
        before: { status: slot.status },
        after: { status, code: slot.code },
      }),
    ),
  ]);
  return NextResponse.redirect(new URL(`/app/yard/${slot.zoneId}?status=slot_updated`, request.url), 303);
}
