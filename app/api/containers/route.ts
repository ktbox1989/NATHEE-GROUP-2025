import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, containerStatusEvents, shippingContainers, CONTAINER_TYPES, type ContainerType } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can, isInternalRole } from "@/lib/authorization";
import { normalizeContainerNumber, normalizeContainerText } from "@/lib/containers";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { isTripRequestKey, parseTruckCapacity } from "@/lib/trips";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!isInternalRole(actor.role) || !can(actor, "jobs:write")) return NextResponse.redirect(new URL("/app", request.url), 303);

  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "");
  const containerNumber = normalizeContainerNumber(String(form.get("containerNumber") ?? ""));
  const sealNumber = normalizeContainerText(String(form.get("sealNumber") ?? ""), 50);
  const rawType = String(form.get("type") ?? "");
  const capacityMotorcycles = parseTruckCapacity(String(form.get("capacityMotorcycles") ?? ""));
  const port = normalizeContainerText(String(form.get("port") ?? ""));
  const country = normalizeContainerText(String(form.get("country") ?? ""));
  const notes = normalizeContainerText(String(form.get("notes") ?? ""), 1000);
  if (
    !isTripRequestKey(requestKey)
    || !containerNumber
    || sealNumber === undefined
    || !CONTAINER_TYPES.includes(rawType as ContainerType)
    || capacityMotorcycles === undefined
    || !port
    || !country
    || notes === undefined
  ) return redirect(request, "error", "invalid_container");

  const db = getDb();
  const existing = await db.select({ id: shippingContainers.id }).from(shippingContainers).where(eq(shippingContainers.requestKey, requestKey)).get();
  if (existing) return redirect(request, "status", "container_exists");

  const id = crypto.randomUUID();
  const record = {
    id,
    requestKey,
    publicId: crypto.randomUUID(),
    containerNumber,
    sealNumber,
    type: rawType as ContainerType,
    capacityMotorcycles,
    port,
    country,
    notes,
    status: "DRAFT" as const,
    createdBy: actor.userId,
  };
  try {
    await db.batch([
      db.insert(shippingContainers).values(record),
      db.insert(containerStatusEvents).values({ id: crypto.randomUUID(), containerId: id, previousStatus: null, newStatus: "DRAFT", note: "สร้างทะเบียนตู้คอนเทนเนอร์", createdBy: actor.userId }),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "shipping_container", entityId: id, after: { ...record, publicId: "[opaque]" } })),
    ]);
  } catch {
    const raced = await getDb().select({ id: shippingContainers.id }).from(shippingContainers).where(eq(shippingContainers.requestKey, requestKey)).get();
    return redirect(request, raced ? "status" : "error", raced ? "container_exists" : "duplicate_container");
  }
  return redirect(request, "status", "container_created");
}

function redirect(request: NextRequest, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/containers?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
