import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, yardZones } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { normalizeYardZoneCode, parseYardCapacity } from "@/lib/yard";
import { createOpaquePublicId } from "@/lib/qr";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "yard:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const form = await request.formData();
  const code = normalizeYardZoneCode(String(form.get("code") ?? ""));
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const description = optional(form, "description", 500);
  const capacity = parseYardCapacity(String(form.get("capacity") ?? ""));
  if (!code || !name || capacity === undefined) {
    return NextResponse.redirect(new URL("/app/yard?error=invalid_zone", request.url), 303);
  }

  const id = crypto.randomUUID();
  const record = { id, publicId: createOpaquePublicId("yard"), code, name, description, capacity, createdBy: actor.userId };
  try {
    const db = getDb();
    await db.batch([
      db.insert(yardZones).values(record),
      db.insert(auditLogs).values(makeAuditRecord({
        actor,
        action: "CREATE",
        entityType: "yard_zone",
        entityId: id,
        after: { publicId: "[opaque]", code, name, description, capacity, status: "ACTIVE" },
      })),
    ]);
  } catch {
    return NextResponse.redirect(new URL("/app/yard?error=duplicate_zone", request.url), 303);
  }
  return NextResponse.redirect(new URL("/app/yard?status=zone_created", request.url), 303);
}

function optional(form: FormData, name: string, maxLength: number): string | null {
  const value = String(form.get(name) ?? "").trim().slice(0, maxLength);
  return value || null;
}
