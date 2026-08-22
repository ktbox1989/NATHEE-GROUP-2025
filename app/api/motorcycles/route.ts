import { and, eq, notInArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, motorcycles, statusEvents, transportJobs } from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { nextSequence } from "@/lib/business-numbers";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

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

  const boundedFields = { make: 80, model: 80, variant: 80, color: 60, registration: 30, province: 80, vin: 50, engineNumber: 50, notes: 1000 } as const;
  if (Object.entries(boundedFields).some(([name, max]) => String(form.get(name) ?? "").trim().length > max)) {
    return NextResponse.redirect(new URL("/app/motorcycles?error=validation", request.url), 303);
  }

  const modelYear = integerOptional(form, "modelYear", 1900, new Date().getUTCFullYear() + 1);
  const conditionValue = String(form.get("vehicleCondition") ?? "UNKNOWN");
  const vehicleCondition = ["NEW", "USED", "UNKNOWN"].includes(conditionValue) ? conditionValue as "NEW" | "USED" | "UNKNOWN" : null;
  const vin = upperOptional(form, "vin", 50);
  const engineNumber = upperOptional(form, "engineNumber", 50);
  if (modelYear === undefined || !vehicleCondition || (!vin && !engineNumber)) {
    return NextResponse.redirect(new URL("/app/motorcycles?error=validation", request.url), 303);
  }

  const id = crypto.randomUUID();
  const sequenceNumber = await nextSequence(`motorcycle:${job.id}`);
  const record = {
    id,
    publicId: `mc_${crypto.randomUUID().replaceAll("-", "")}`,
    companyId: job.companyId,
    jobId: job.id,
    sequenceNumber,
    make: optional(form, "make", 80),
    model: optional(form, "model", 80),
    variant: optional(form, "variant", 80),
    modelYear,
    color: optional(form, "color", 60),
    registration: upperOptional(form, "registration", 30),
    province: optional(form, "province", 80),
    vin,
    engineNumber,
    vehicleCondition,
    notes: optional(form, "notes", 1000),
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
        .set({ status: "IN_PROGRESS", updatedAt: recordTimestamp() })
        .where(and(eq(transportJobs.id, job.id), eq(transportJobs.status, "OPEN"))),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "CREATE", entityType: "motorcycle", entityId: id, companyId: job.companyId, after: record })),
    ]);
  } catch {
    return NextResponse.redirect(new URL("/app/motorcycles?error=duplicate", request.url), 303);
  }
  return NextResponse.redirect(new URL("/app/motorcycles?status=created", request.url), 303);
}

function optional(form: FormData, name: string, max: number): string | null {
  const value = cleanUserText(String(form.get(name) ?? ""));
  if (value.length > max) return null;
  return value || null;
}

function upperOptional(form: FormData, name: string, max: number): string | null {
  return optional(form, name, max)?.toUpperCase() ?? null;
}

function integerOptional(form: FormData, name: string, min: number, max: number): number | null | undefined {
  const value = String(form.get(name) ?? "").trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function cleanUserText(value: string): string {
  const bidi = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
  return [...value].map((character) => { const code = character.codePointAt(0) ?? 0; return code < 32 || code === 127 || bidi.has(code) ? " " : character; }).join("").replace(/\s+/g, " ").trim();
}
