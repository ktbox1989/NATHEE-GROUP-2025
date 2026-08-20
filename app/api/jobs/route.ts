import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, companies, transportJobs } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { nextBusinessNumber } from "@/lib/business-numbers";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { createOpaquePublicId } from "@/lib/qr";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const form = await request.formData();
  const companyId = String(form.get("companyId") ?? "");
  const origin = String(form.get("origin") ?? "").trim();
  const destination = String(form.get("destination") ?? "").trim();
  if (!companyId || !origin || !destination || !can(actor, "jobs:write", companyId)) {
    return NextResponse.redirect(new URL("/app/jobs?error=invalid", request.url), 303);
  }

  const db = getDb();
  const company = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.status, "ACTIVE")))
    .get();
  if (!company) return NextResponse.redirect(new URL("/app/jobs?error=company", request.url), 303);

  const id = crypto.randomUUID();
  const jobNumber = await nextBusinessNumber("JOB");
  const record = {
    id,
    publicId: createOpaquePublicId("job"),
    jobNumber,
    companyId,
    origin,
    destination,
    plannedPickupDate: optional(form, "plannedPickupDate"),
    plannedDeliveryDate: optional(form, "plannedDeliveryDate"),
    notes: optional(form, "notes"),
    status: "OPEN" as const,
    createdBy: actor.userId,
  };

  try {
    await db.batch([
      db.insert(transportJobs).values(record),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "transport_job", entityId: id, companyId, after: { ...record, publicId: "[opaque]" } })),
    ]);
  } catch {
    return NextResponse.redirect(new URL("/app/jobs?error=save", request.url), 303);
  }
  return NextResponse.redirect(new URL("/app/jobs?status=created", request.url), 303);
}

function optional(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
}
