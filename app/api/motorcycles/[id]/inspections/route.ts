import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import {
  auditLogs,
  DAMAGE_SEVERITIES,
  FUEL_LEVELS,
  inspectionFindings,
  INSPECTION_RESULTS,
  INSPECTION_TYPES,
  motorcycleImages,
  motorcycleInspections,
  motorcycles,
  type DamageSeverity,
  type FuelLevel,
  type InspectionResult,
  type InspectionType,
} from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { can } from "@/lib/authorization";
import {
  inspectionTypeAllowedForStatus,
  isReasonableRecordedTime,
  normalizeInspectionText,
  parseOdometerKm,
} from "@/lib/inspections";
import { getCurrentActor } from "@/lib/current-actor";
import { isSameOrigin } from "@/lib/same-origin";
import { bangkokInputToUtc, isTripRequestKey } from "@/lib/trips";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const { id: motorcycleId } = await context.params;
  const motorcycle = await getDb()
    .select({ id: motorcycles.id, companyId: motorcycles.companyId, status: motorcycles.currentStatus })
    .from(motorcycles)
    .where(eq(motorcycles.id, motorcycleId))
    .get();
  if (!motorcycle || !can(actor, "status:write", motorcycle.companyId)) {
    return NextResponse.redirect(new URL("/app/motorcycles?error=forbidden", request.url), 303);
  }

  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "");
  const rawType = String(form.get("type") ?? "");
  const rawResult = String(form.get("result") ?? "");
  const rawFuel = String(form.get("fuelLevel") ?? "UNKNOWN");
  const odometerKm = parseOdometerKm(String(form.get("odometerKm") ?? ""));
  const notes = normalizeInspectionText(String(form.get("notes") ?? ""), { max: 2000 });
  const inspectedAt = bangkokInputToUtc(String(form.get("inspectedAt") ?? ""));
  const type = rawType as InspectionType;
  const result = rawResult as InspectionResult;
  const fuelLevel = rawFuel as FuelLevel;
  const area = normalizeInspectionText(String(form.get("findingArea") ?? ""), { max: 100 });
  const description = normalizeInspectionText(String(form.get("findingDescription") ?? ""), { min: 3, max: 1000 });
  const rawSeverity = String(form.get("findingSeverity") ?? "");
  const evidenceImageId = String(form.get("evidenceImageId") ?? "").trim() || null;
  const hasFindingInput = Boolean(area || description || rawSeverity || evidenceImageId);

  if (
    !isTripRequestKey(requestKey)
    || !INSPECTION_TYPES.includes(type)
    || !INSPECTION_RESULTS.includes(result)
    || !FUEL_LEVELS.includes(fuelLevel)
    || odometerKm === undefined
    || notes === undefined
    || inspectedAt === undefined
    || !inspectedAt
    || !isReasonableRecordedTime(inspectedAt)
    || !inspectionTypeAllowedForStatus(type, motorcycle.status)
    || (result !== "PASS" && (!notes || notes.length < 3))
    || (result === "PASS" && hasFindingInput)
    || (hasFindingInput && (!area || !description || !DAMAGE_SEVERITIES.includes(rawSeverity as DamageSeverity)))
  ) {
    return redirect(request, motorcycleId, "error", "invalid_inspection");
  }

  const db = getDb();
  const existing = await db
    .select({ motorcycleId: motorcycleInspections.motorcycleId })
    .from(motorcycleInspections)
    .where(eq(motorcycleInspections.requestKey, requestKey))
    .get();
  if (existing) {
    return existing.motorcycleId === motorcycleId
      ? redirect(request, motorcycleId, "status", "inspection_exists")
      : redirect(request, motorcycleId, "error", "request_conflict");
  }

  if (evidenceImageId) {
    const metadata = await db.select().from(motorcycleImages).where(eq(motorcycleImages.id, evidenceImageId)).get();
    if (!metadata || metadata.motorcycleId !== motorcycleId || metadata.companyId !== motorcycle.companyId || metadata.category !== "DAMAGE") {
      return redirect(request, motorcycleId, "error", "invalid_evidence");
    }
  }

  const inspectionId = crypto.randomUUID();
  const findingId = hasFindingInput ? crypto.randomUUID() : null;
  const inspectionInsert = db.insert(motorcycleInspections).values({
    id: inspectionId,
    requestKey,
    motorcycleId,
    companyId: motorcycle.companyId,
    type,
    result,
    odometerKm,
    fuelLevel,
    notes,
    inspectedBy: actor.userId,
    inspectedAt,
  });
  const auditInsert = db.insert(auditLogs).values(makeAuditRecord({
    actor,
    action: "CREATE",
    entityType: "motorcycle_inspection",
    entityId: inspectionId,
    companyId: motorcycle.companyId,
    after: { motorcycleId, type, result, findingCount: findingId ? 1 : 0, hasEvidence: Boolean(evidenceImageId) },
  }));

  try {
    if (findingId && area && description) {
      await db.batch([
        inspectionInsert,
        db.insert(inspectionFindings).values({
          id: findingId,
          inspectionId,
          area,
          severity: rawSeverity as DamageSeverity,
          description,
          evidenceImageId,
          createdBy: actor.userId,
        }),
        auditInsert,
      ]);
    } else {
      await db.batch([inspectionInsert, auditInsert]);
    }
  } catch {
    const raced = await getDb()
      .select({ motorcycleId: motorcycleInspections.motorcycleId })
      .from(motorcycleInspections)
      .where(eq(motorcycleInspections.requestKey, requestKey))
      .get();
    return redirect(
      request,
      motorcycleId,
      raced?.motorcycleId === motorcycleId ? "status" : "error",
      raced?.motorcycleId === motorcycleId ? "inspection_exists" : "save_inspection",
    );
  }
  return redirect(request, motorcycleId, "status", "inspection_created");
}

function redirect(request: NextRequest, motorcycleId: string, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/motorcycles/${motorcycleId}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
