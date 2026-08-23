import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, yardRows, yardZones } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { normalizeYardPositionCode } from "@/lib/yard";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "yard:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const form = await request.formData();
  const zoneId = String(form.get("zoneId") ?? "");
  const code = normalizeYardPositionCode(String(form.get("code") ?? ""));
  const name = String(form.get("name") ?? "").trim().slice(0, 120) || null;
  const sortOrder = Number(String(form.get("sortOrder") ?? "0"));
  if (!zoneId || !code || !Number.isSafeInteger(sortOrder) || sortOrder < 0) {
    return redirect(zoneId, "invalid_row", request.url);
  }

  const db = getDb();
  const zone = await db.select({ id: yardZones.id }).from(yardZones).where(eq(yardZones.id, zoneId)).get();
  if (!zone) return redirect(zoneId, "invalid_row", request.url);

  const id = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(yardRows).values({ id, yardZoneId: zoneId, code, name, sortOrder, createdBy: actor.userId }),
      db.insert(auditLogs).values(
        makeAuditRecord({
          actor,
          action: "CREATE",
          entityType: "yard_row",
          entityId: id,
          after: { zoneId, code, name, sortOrder, status: "ACTIVE" },
        }),
      ),
    ]);
  } catch {
    return redirect(zoneId, "duplicate_row", request.url);
  }
  return NextResponse.redirect(new URL(`/app/yard/${zoneId}?status=row_created`, request.url), 303);
}

function redirect(zoneId: string, error: string, requestUrl: string) {
  const target = zoneId ? `/app/yard/${encodeURIComponent(zoneId)}` : "/app/yard";
  return NextResponse.redirect(new URL(`${target}?error=${encodeURIComponent(error)}`, requestUrl), 303);
}
