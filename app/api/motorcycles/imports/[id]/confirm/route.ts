import { and, eq, notInArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { motorcycleImportBatches, transportJobs } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { motorcycleImportConfirmationPlan } from "@/lib/motorcycle-import-transaction";
import { isSameOrigin } from "@/lib/same-origin";
import { isTripRequestKey } from "@/lib/trips";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const { id } = await context.params;
  const form = await request.formData();
  const importRequestKey = String(form.get("requestKey") ?? "");
  if (!isInternalRole(actor.role) || !isTripRequestKey(importRequestKey)) return redirect(request, id, "invalid_request");
  const db = getDb();
  const batch = await db.select({ id: motorcycleImportBatches.id, jobId: motorcycleImportBatches.jobId, companyId: motorcycleImportBatches.companyId, status: motorcycleImportBatches.status, rowCount: motorcycleImportBatches.rowCount, errorCount: motorcycleImportBatches.errorCount }).from(motorcycleImportBatches).innerJoin(transportJobs, eq(transportJobs.id, motorcycleImportBatches.jobId)).where(and(eq(motorcycleImportBatches.id, id), notInArray(transportJobs.status, ["COMPLETED", "CANCELLED"]))).get();
  if (!batch || !can(actor, "motorcycles:write", batch.companyId)) return redirect(request, id, "forbidden");
  if (batch.status === "IMPORTED") return redirect(request, id, "already_imported", "status");
  if (batch.status !== "VALIDATED" || batch.errorCount !== 0) return redirect(request, id, "not_ready");

  const now = new Date().toISOString();
  const d1 = getD1();
  try {
    const plan = motorcycleImportConfirmationPlan({ batchId: id, importRequestKey, actorUserId: actor.userId, auditId: crypto.randomUUID(), now });
    const result = await d1.batch(plan.map((item) => d1.prepare(item.sql).bind(...item.params)));
    if (Number(result[0]?.meta?.changes ?? 0) !== 1 || Number(result[7]?.meta?.changes ?? 0) !== 1) return redirect(request, id, "stale");
  } catch {
    const current = await db.select({ status: motorcycleImportBatches.status }).from(motorcycleImportBatches).where(eq(motorcycleImportBatches.id, id)).get();
    return current?.status === "IMPORTED" ? redirect(request, id, "already_imported", "status") : redirect(request, id, "import_failed");
  }
  return redirect(request, id, "imported", "status");
}

function redirect(request: NextRequest, id: string, value: string, key = "error") {
  return NextResponse.redirect(new URL(`/app/motorcycles/imports/${encodeURIComponent(id)}?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
