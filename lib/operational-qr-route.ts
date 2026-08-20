import { eq } from "drizzle-orm";
import { getDb } from "../db/index.ts";
import { transportJobs, trips, trucks, yardZones } from "../db/schema.ts";
import { can, isInternalRole, type Actor } from "./authorization.ts";
import { getCurrentActor } from "./current-actor.ts";
import { isOperationalPublicId, type OperationalQrEntityType } from "./qr.ts";
import { renderOperationalQrSvg } from "./qr-svg.ts";

export async function operationalQrResponse(entityType: Exclude<OperationalQrEntityType, "motorcycle">, publicId: string): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  if (!isOperationalPublicId(entityType, publicId)) return new Response("Not found", { status: 404 });

  const authorized = await isAuthorized(entityType, publicId, actor);
  if (!authorized) return new Response("Not found", { status: 404 });

  const svg = await renderOperationalQrSvg(entityType, publicId);
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="nathee-${entityType}-${publicId}.svg"`,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function isAuthorized(
  entityType: Exclude<OperationalQrEntityType, "motorcycle">,
  publicId: string,
  actor: Actor,
): Promise<boolean> {
  const db = getDb();
  if (entityType === "job") {
    const record = await db.select({ companyId: transportJobs.companyId }).from(transportJobs).where(eq(transportJobs.publicId, publicId)).get();
    return Boolean(record && can(actor, "jobs:read", record.companyId));
  }
  if (!isInternalRole(actor.role)) return false;
  if (entityType === "yard") {
    const record = await db.select({ id: yardZones.id }).from(yardZones).where(eq(yardZones.publicId, publicId)).get();
    return Boolean(record && can(actor, "yard:read"));
  }
  const record = entityType === "truck"
    ? await db.select({ id: trucks.id }).from(trucks).where(eq(trucks.publicId, publicId)).get()
    : await db.select({ id: trips.id }).from(trips).where(eq(trips.publicId, publicId)).get();
  return Boolean(record && can(actor, "jobs:read"));
}
