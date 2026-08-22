import { and, eq, notInArray, or } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import { motorcycleImportBatches, transportJobs } from "@/db/schema";
import { can, isInternalRole } from "@/lib/authorization";
import { validateBoundedMultipartRequest } from "@/lib/bounded-multipart";
import { getCurrentActor } from "@/lib/current-actor";
import { MOTORCYCLE_IMPORT_MAX_REQUEST_BYTES, prepareMotorcycleImport } from "@/lib/motorcycle-import";
import { isSameOrigin } from "@/lib/same-origin";
import { isTripRequestKey } from "@/lib/trips";
import { recordTimestamp } from "@/lib/timestamps";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const requestBounds = validateBoundedMultipartRequest(request.headers.get("content-type"), request.headers.get("content-length"), MOTORCYCLE_IMPORT_MAX_REQUEST_BYTES);
  if (!requestBounds.ok) return redirect(request, "invalid_request");
  const form = await request.formData();
  const requestKey = String(form.get("requestKey") ?? "");
  const jobId = String(form.get("jobId") ?? "");
  const file = form.get("file");
  if (!isInternalRole(actor.role) || !isTripRequestKey(requestKey) || !(file instanceof File)) return redirect(request, "invalid_request");

  const db = getDb();
  const existingRequest = await db.select({ id: motorcycleImportBatches.id }).from(motorcycleImportBatches).where(eq(motorcycleImportBatches.requestKey, requestKey)).get();
  if (existingRequest) return NextResponse.redirect(new URL(`/app/motorcycles/imports/${existingRequest.id}`, request.url), 303);
  const job = await db.select({ id: transportJobs.id, companyId: transportJobs.companyId }).from(transportJobs).where(and(eq(transportJobs.id, jobId), notInArray(transportJobs.status, ["COMPLETED", "CANCELLED"]))).get();
  if (!job || !can(actor, "motorcycles:write", job.companyId)) return redirect(request, "job");

  let prepared;
  try { prepared = await prepareMotorcycleImport(file); }
  catch { return redirect(request, "invalid_file"); }
  const existingFile = await db.select({ id: motorcycleImportBatches.id }).from(motorcycleImportBatches).where(and(eq(motorcycleImportBatches.jobId, job.id), eq(motorcycleImportBatches.checksum, prepared.checksum))).get();
  if (existingFile) return NextResponse.redirect(new URL(`/app/motorcycles/imports/${existingFile.id}?status=file_exists`, request.url), 303);

  const batchId = crypto.randomUUID();
  const recordedAt = recordTimestamp();
  const validCount = prepared.rows.filter((row) => row.validationStatus === "VALID").length;
  const errorCount = prepared.rows.length - validCount;
  const rowsJson = JSON.stringify(prepared.rows);
  const d1 = getD1();
  try {
    await d1.batch([
      d1.prepare(`
        INSERT INTO motorcycle_import_batches
          (id, request_key, job_id, company_id, source_filename, source_type, checksum,
           row_count, valid_count, error_count, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALIDATED', ?, ?)
      `).bind(batchId, requestKey, job.id, job.companyId, prepared.sourceFilename, prepared.sourceType, prepared.checksum, prepared.rows.length, validCount, errorCount, actor.userId, recordedAt),
      d1.prepare(`
        INSERT INTO motorcycle_import_rows
          (id, batch_id, source_row_number, record_id, public_id, raw_payload, make, model, variant,
           model_year, color, registration, province, vin, engine_number, vehicle_condition, notes,
           validation_status, error_message, created_at)
        SELECT
          json_extract(value, '$.id'), ?, json_extract(value, '$.sourceRowNumber'),
          json_extract(value, '$.recordId'), json_extract(value, '$.publicId'), json_extract(value, '$.rawPayload'),
          json_extract(value, '$.make'), json_extract(value, '$.model'), json_extract(value, '$.variant'),
          json_extract(value, '$.modelYear'), json_extract(value, '$.color'), json_extract(value, '$.registration'),
          json_extract(value, '$.province'), json_extract(value, '$.vin'), json_extract(value, '$.engineNumber'),
          json_extract(value, '$.vehicleCondition'), json_extract(value, '$.notes'),
          json_extract(value, '$.validationStatus'), json_extract(value, '$.errorMessage'), ?
        FROM json_each(?)
      `).bind(batchId, recordedAt, rowsJson),
      d1.prepare(`
        UPDATE motorcycle_import_rows AS source
        SET validation_status = 'ERROR',
            error_message = trim(
              coalesce(source.error_message || '; ', '') ||
              CASE WHEN source.vin IS NOT NULL AND EXISTS (SELECT 1 FROM motorcycles WHERE vin = source.vin) THEN 'VIN/เลขโครงมีอยู่ในระบบแล้ว; ' ELSE '' END ||
              CASE WHEN source.engine_number IS NOT NULL AND EXISTS (SELECT 1 FROM motorcycles WHERE engine_number = source.engine_number) THEN 'เลขเครื่องมีอยู่ในระบบแล้ว; ' ELSE '' END,
              '; '
            )
        WHERE source.batch_id = ? AND (
          (source.vin IS NOT NULL AND EXISTS (SELECT 1 FROM motorcycles WHERE vin = source.vin)) OR
          (source.engine_number IS NOT NULL AND EXISTS (SELECT 1 FROM motorcycles WHERE engine_number = source.engine_number))
        )
      `).bind(batchId),
      d1.prepare(`
        UPDATE motorcycle_import_batches
        SET valid_count = (SELECT count(*) FROM motorcycle_import_rows WHERE batch_id = ? AND validation_status = 'VALID'),
            error_count = (SELECT count(*) FROM motorcycle_import_rows WHERE batch_id = ? AND validation_status = 'ERROR')
        WHERE id = ?
      `).bind(batchId, batchId, batchId),
      d1.prepare(`
        INSERT INTO audit_logs
          (id, actor_user_id, company_id, action, entity_type, entity_id, after_json, reason, created_at)
        SELECT ?, ?, company_id, 'CREATE', 'motorcycle_import_batch', id,
          json_object('jobId', job_id, 'sourceType', source_type, 'rowCount', row_count,
                      'validCount', valid_count, 'errorCount', error_count, 'checksum', checksum),
          'Server-validated bulk import staging', ?
        FROM motorcycle_import_batches WHERE id = ?
      `).bind(crypto.randomUUID(), actor.userId, recordedAt, batchId),
    ]);
  } catch {
    const raced = await db.select({ id: motorcycleImportBatches.id }).from(motorcycleImportBatches).where(or(eq(motorcycleImportBatches.requestKey, requestKey), and(eq(motorcycleImportBatches.jobId, job.id), eq(motorcycleImportBatches.checksum, prepared.checksum)))).get();
    return raced ? NextResponse.redirect(new URL(`/app/motorcycles/imports/${raced.id}?status=file_exists`, request.url), 303) : redirect(request, "save");
  }
  return NextResponse.redirect(new URL(`/app/motorcycles/imports/${batchId}`, request.url), 303);
}

function redirect(request: NextRequest, error: string) {
  return NextResponse.redirect(new URL(`/app/motorcycles/imports?error=${encodeURIComponent(error)}`, request.url), 303);
}
