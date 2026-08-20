import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import {
  auditLogs,
  DAMAGE_SEVERITIES,
  inspectionFindings,
  motorcycleImages,
  motorcycleInspections,
  motorcycles,
  type DamageSeverity,
} from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import { normalizeInspectionText } from "@/lib/inspections";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { isTripRequestKey } from "@/lib/trips";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; inspectionId: string }> },
) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const { id: motorcycleId, inspectionId } = await context.params;
  const form = await request.formData();
  const findingId = String(form.get("requestKey") ?? "");
  const area = normalizeInspectionText(String(form.get("area") ?? ""), { max: 100 });
  const description = normalizeInspectionText(String(form.get("description") ?? ""), { min: 3, max: 1000 });
  const rawSeverity = String(form.get("severity") ?? "");
  const evidenceImageId = String(form.get("evidenceImageId") ?? "").trim() || null;
  if (
    !isTripRequestKey(findingId)
    || !area
    || !description
    || !DAMAGE_SEVERITIES.includes(rawSeverity as DamageSeverity)
  ) return redirect(request, motorcycleId, "error", "invalid_finding");

  const db = getDb();
  const inspection = await db
    .select({
      motorcycleId: motorcycleInspections.motorcycleId,
      companyId: motorcycleInspections.companyId,
      result: motorcycleInspections.result,
      motorcycleExists: motorcycles.id,
    })
    .from(motorcycleInspections)
    .innerJoin(motorcycles, eq(motorcycles.id, motorcycleInspections.motorcycleId))
    .where(and(eq(motorcycleInspections.id, inspectionId), eq(motorcycleInspections.motorcycleId, motorcycleId)))
    .get();
  if (!inspection || !["ISSUE", "DAMAGE"].includes(inspection.result) || !can(actor, "status:write", inspection.companyId)) {
    return redirect(request, motorcycleId, "error", "inspection_not_found");
  }

  const existing = await db.select({ inspectionId: inspectionFindings.inspectionId }).from(inspectionFindings).where(eq(inspectionFindings.id, findingId)).get();
  if (existing) {
    return existing.inspectionId === inspectionId
      ? redirect(request, motorcycleId, "status", "finding_exists")
      : redirect(request, motorcycleId, "error", "request_conflict");
  }
  if (evidenceImageId) {
    const image = await db.select().from(motorcycleImages).where(eq(motorcycleImages.id, evidenceImageId)).get();
    if (!image || image.motorcycleId !== motorcycleId || image.companyId !== inspection.companyId || image.category !== "DAMAGE") {
      return redirect(request, motorcycleId, "error", "invalid_evidence");
    }
  }

  try {
    await db.batch([
      db.insert(inspectionFindings).values({
        id: findingId,
        inspectionId,
        area,
        severity: rawSeverity as DamageSeverity,
        description,
        evidenceImageId,
        createdBy: actor.userId,
      }),
      db.insert(auditLogs).values(makeAuditRecord({
        actor,
        action: "CREATE",
        entityType: "inspection_finding",
        entityId: findingId,
        companyId: inspection.companyId,
        after: { inspectionId, area, severity: rawSeverity, hasEvidence: Boolean(evidenceImageId) },
      })),
    ]);
  } catch {
    const raced = await getDb().select({ inspectionId: inspectionFindings.inspectionId }).from(inspectionFindings).where(eq(inspectionFindings.id, findingId)).get();
    return redirect(
      request,
      motorcycleId,
      raced?.inspectionId === inspectionId ? "status" : "error",
      raced?.inspectionId === inspectionId ? "finding_exists" : "save_finding",
    );
  }
  return redirect(request, motorcycleId, "status", "finding_created");
}

function redirect(request: NextRequest, motorcycleId: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/motorcycles/${motorcycleId}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
