import { and, eq, notInArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, motorcycles, statusEvents, transportJobs } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { nextSequence } from "@/lib/business-numbers";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const form = await request.formData();
  const jobId = String(form.get("jobId") ?? "");
  const db = getDb();
  const job = await db
    .select({ id: transportJobs.id, companyId: transportJobs.companyId })
    .from(transportJobs)
    .where(
      and(
        eq(transportJobs.id, jobId),
        notInArray(transportJobs.status, ["COMPLETED", "CANCELLED"]),
      ),
    )
    .get();
  if (!job || !can(actor, "motorcycles:write", job.companyId)) {
    return NextResponse.redirect(new URL("/app/motorcycles?error=job", request.url), 303);
  }

  const id = crypto.randomUUID();
  const sequenceNumber = await nextSequence(`motorcycle:${job.id}`);
  const record = {
    id,
    publicId: `mc_${crypto.randomUUID().replaceAll("-", "")}`,
    companyId: job.companyId,
    jobId: job.id,
    sequenceNumber,
    make: optional(form, "make"),
    model: optional(form, "model"),
    color: optional(form, "color"),
    registration: upperOptional(form, "registration"),
    vin: upperOptional(form, "vin"),
    engineNumber: upperOptional(form, "engineNumber"),
    currentStatus: "PENDING_RECEIPT" as const,
  };

  try {
    await db.batch([
      db.insert(motorcycles).values(record),
      db.insert(statusEvents).values({
        id: crypto.randomUUID(),
        motorcycleId: id,
        companyId: job.companyId,
        previousStatus: null,
        newStatus: "PENDING_RECEIPT",
        note: "สร้างทะเบียนรถในระบบ",
        createdBy: actor.userId,
      }),
      db
        .update(transportJobs)
        .set({ status: "IN_PROGRESS", updatedAt: new Date().toISOString() })
        .where(and(eq(transportJobs.id, job.id), eq(transportJobs.status, "OPEN"))),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "motorcycle", entityId: id, companyId: job.companyId, after: record })),
    ]);
  } catch {
    return NextResponse.redirect(new URL("/app/motorcycles?error=duplicate", request.url), 303);
  }
  return NextResponse.redirect(new URL("/app/motorcycles?status=created", request.url), 303);
}

function optional(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
}

function upperOptional(form: FormData, name: string): string | null {
  return optional(form, name)?.toUpperCase() ?? null;
}
