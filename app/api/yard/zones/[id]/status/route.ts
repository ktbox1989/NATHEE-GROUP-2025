import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { yardZones } from "@/db/schema";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "yard:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const { id } = await context.params;
  const form = await request.formData();
  const newStatus = String(form.get("status") ?? "");
  if (newStatus !== "ACTIVE" && newStatus !== "INACTIVE") {
    return NextResponse.redirect(new URL("/app/yard?error=invalid_zone_status", request.url), 303);
  }
  const zone = await getDb()
    .select({ id: yardZones.id, code: yardZones.code, status: yardZones.status })
    .from(yardZones)
    .where(eq(yardZones.id, id))
    .get();
  if (!zone || zone.status === newStatus) {
    return NextResponse.redirect(new URL("/app/yard?error=stale_zone", request.url), 303);
  }

  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  try {
    const results = await getD1().batch([
      getD1().prepare(`
        UPDATE yard_zones
        SET status = ?, updated_at = ?
        WHERE id = ? AND status = ?
          AND (
            ? = 'ACTIVE' OR NOT EXISTS (
              SELECT 1 FROM yard_placements active
              WHERE active.yard_zone_id = yard_zones.id AND active.exited_at IS NULL
            )
          )
      `).bind(newStatus, now, id, zone.status, newStatus),
      getD1().prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, action, entity_type, entity_id,
           before_json, after_json, created_at)
        SELECT ?, ?, 'YARD_ZONE_STATUS', 'yard_zone', id, ?, ?, ?
        FROM yard_zones WHERE id = ? AND status = ? AND updated_at = ?
      `).bind(
        auditId,
        actor.userId,
        JSON.stringify({ status: zone.status }),
        JSON.stringify({ status: newStatus }),
        now,
        id,
        newStatus,
        now,
      ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
      return NextResponse.redirect(new URL("/app/yard?error=zone_occupied", request.url), 303);
    }
  } catch {
    return NextResponse.redirect(new URL("/app/yard?error=save_zone", request.url), 303);
  }
  return NextResponse.redirect(new URL("/app/yard?status=zone_updated", request.url), 303);
}
