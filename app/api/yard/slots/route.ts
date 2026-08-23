import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, yardRows, yardSlots } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { expandSlotCodeRange } from "@/lib/yard";

/**
 * Creates the parking positions in a row. `01-20` creates twenty, because a real
 * row is built once and a form that took them one at a time would be abandoned.
 *
 * The whole range is written in one batch: a half-built row is worse than none,
 * since the missing bays look like they do not exist.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "yard:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const form = await request.formData();
  const rowId = String(form.get("rowId") ?? "");
  const codes = expandSlotCodeRange(String(form.get("codes") ?? ""));
  if (!rowId || !codes || codes.length === 0) return redirect(null, "invalid_slot", request.url);

  const db = getDb();
  const row = await db
    .select({ id: yardRows.id, zoneId: yardRows.yardZoneId })
    .from(yardRows)
    .where(eq(yardRows.id, rowId))
    .get();
  if (!row) return redirect(null, "invalid_slot", request.url);

  const records = codes.map((code, index) => ({
    id: crypto.randomUUID(),
    yardRowId: rowId,
    code,
    sortOrder: index,
    createdBy: actor.userId,
  }));

  try {
    await db.batch([
      db.insert(yardSlots).values(records),
      db.insert(auditLogs).values(
        makeAuditRecord({
          actor,
          action: "CREATE",
          entityType: "yard_slot",
          entityId: rowId,
          after: { rowId, zoneId: row.zoneId, codes, created: records.length },
        }),
      ),
    ]);
  } catch {
    // The commonest cause is a code already used in this row, and the second is
    // a zone that still carries a hand-written capacity.
    return redirect(row.zoneId, "slot_rejected", request.url);
  }
  return NextResponse.redirect(new URL(`/app/yard/${row.zoneId}?status=slots_created`, request.url), 303);
}

function redirect(zoneId: string | null, error: string, requestUrl: string) {
  const target = zoneId ? `/app/yard/${encodeURIComponent(zoneId)}` : "/app/yard";
  return NextResponse.redirect(new URL(`${target}?error=${encodeURIComponent(error)}`, requestUrl), 303);
}
