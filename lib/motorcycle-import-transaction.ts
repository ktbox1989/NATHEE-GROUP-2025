export type ImportSqlStatement = { sql: string; params: Array<string | number | null> };

export function motorcycleImportConfirmationPlan(input: {
  batchId: string;
  importRequestKey: string;
  actorUserId: string;
  auditId: string;
  now: string;
}): ImportSqlStatement[] {
  const { batchId, importRequestKey, actorUserId, auditId, now } = input;
  return [
    statement(`
      UPDATE motorcycle_import_batches
      SET status = 'IMPORTING', import_request_key = ?
      WHERE id = ? AND status = 'VALIDATED' AND error_count = 0 AND import_request_key IS NULL
    `, importRequestKey, batchId),
    statement(`
      INSERT INTO sequence_counters (name, value, updated_at)
      SELECT 'motorcycle:' || job_id, row_count, ? FROM motorcycle_import_batches
      WHERE id = ? AND status = 'IMPORTING' AND import_request_key = ?
      ON CONFLICT(name) DO UPDATE SET value = sequence_counters.value + excluded.value, updated_at = excluded.updated_at
    `, now, batchId, importRequestKey),
    statement(`
      INSERT INTO motorcycles
        (id, public_id, company_id, job_id, sequence_number, make, model, variant, model_year,
         color, registration, province, vin, engine_number, vehicle_condition, notes,
         current_status, created_at, updated_at)
      SELECT row.record_id, row.public_id, batch.company_id, batch.job_id,
        counter.value - batch.row_count + row_number() OVER (ORDER BY row.source_row_number),
        row.make, row.model, row.variant, row.model_year, row.color, row.registration, row.province,
        row.vin, row.engine_number, row.vehicle_condition, row.notes, 'PENDING_RECEIPT', ?, ?
      FROM motorcycle_import_rows row
      JOIN motorcycle_import_batches batch ON batch.id = row.batch_id
      JOIN sequence_counters counter ON counter.name = 'motorcycle:' || batch.job_id
      WHERE batch.id = ? AND batch.status = 'IMPORTING' AND batch.import_request_key = ? AND row.validation_status = 'VALID'
      ORDER BY row.source_row_number
    `, now, now, batchId, importRequestKey),
    statement(`
      INSERT INTO status_events
        (id, motorcycle_id, company_id, previous_status, new_status, note, created_by, created_at)
      SELECT lower(hex(randomblob(16))), row.record_id, batch.company_id, NULL, 'PENDING_RECEIPT',
        'สร้างทะเบียนรถจาก Bulk Import', ?, ?
      FROM motorcycle_import_rows row JOIN motorcycle_import_batches batch ON batch.id = row.batch_id
      WHERE batch.id = ? AND batch.status = 'IMPORTING' AND batch.import_request_key = ? AND row.validation_status = 'VALID'
    `, actorUserId, now, batchId, importRequestKey),
    statement(`
      INSERT INTO audit_logs
        (id, actor_user_id, company_id, action, entity_type, entity_id, after_json, reason, created_at)
      SELECT lower(hex(randomblob(16))), ?, batch.company_id, 'CREATE', 'motorcycle', row.record_id,
        json_object('jobId', batch.job_id, 'importBatchId', batch.id, 'sourceRowNumber', row.source_row_number,
                    'publicId', row.public_id, 'currentStatus', 'PENDING_RECEIPT'),
        'Confirmed server-validated bulk import', ?
      FROM motorcycle_import_rows row JOIN motorcycle_import_batches batch ON batch.id = row.batch_id
      WHERE batch.id = ? AND batch.status = 'IMPORTING' AND batch.import_request_key = ? AND row.validation_status = 'VALID'
    `, actorUserId, now, batchId, importRequestKey),
    statement(`UPDATE transport_jobs SET status = 'IN_PROGRESS', updated_at = ? WHERE id = (SELECT job_id FROM motorcycle_import_batches WHERE id = ? AND status = 'IMPORTING' AND import_request_key = ?) AND status = 'OPEN'`, now, batchId, importRequestKey),
    statement(`
      UPDATE motorcycle_import_rows
      SET validation_status = 'IMPORTED', imported_record_id = record_id, imported_at = ?
      WHERE batch_id = ? AND validation_status = 'VALID'
        AND EXISTS (SELECT 1 FROM motorcycle_import_batches WHERE id = ? AND status = 'IMPORTING' AND import_request_key = ?)
    `, now, batchId, batchId, importRequestKey),
    statement(`
      UPDATE motorcycle_import_batches
      SET status = 'IMPORTED', imported_at = ?
      WHERE id = ? AND status = 'IMPORTING' AND import_request_key = ?
        AND (SELECT count(*) FROM motorcycle_import_rows WHERE batch_id = ? AND validation_status = 'IMPORTED') = row_count
    `, now, batchId, importRequestKey, batchId),
    statement(`
      INSERT INTO audit_logs
        (id, actor_user_id, company_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
      SELECT ?, ?, company_id, 'STATUS_CHANGE', 'motorcycle_import_batch', id,
        json_object('status', 'VALIDATED'), json_object('status', 'IMPORTED', 'importedCount', row_count),
        'Bulk import confirmed after zero-error validation', ?
      FROM motorcycle_import_batches WHERE id = ? AND status = 'IMPORTED' AND import_request_key = ?
    `, auditId, actorUserId, now, batchId, importRequestKey),
    statement(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM motorcycle_import_batches
        WHERE id = ? AND status = 'IMPORTED' AND import_request_key = ? AND imported_at IS NOT NULL
      ) THEN 1 ELSE json_extract('not-json', '$') END AS committed
    `, batchId, importRequestKey),
  ];
}

function statement(sql: string, ...params: Array<string | number | null>): ImportSqlStatement { return { sql, params }; }
