import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { motorcycleImportConfirmationPlan } from "../lib/motorcycle-import-transaction.ts";

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
function apply(db, path) { for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement); }
function migrated() { const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys = ON"); for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) apply(db, `${directory}/${name}`); return db; }

test("migration 0017 preserves existing motorcycle rows and earlier lifecycle triggers", () => {
  const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
  for (const name of migrations.filter((entry) => entry < "0017_")) apply(db, `${directory}/${name}`);
  db.exec(`INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company', 'CUS', 'Company', 'Company'); INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES ('owner', 'auth', 'owner@example.test', 'Owner', 'OWNER'); INSERT INTO transport_jobs (id, job_number, company_id, origin, destination, status, created_by) VALUES ('job', 'JOB-1', 'company', 'A', 'B', 'OPEN', 'owner'); INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, vin) VALUES ('mc', 'mc_public', 'company', 'job', 1, 'VIN1');`);
  const triggersBefore = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='motorcycles' ORDER BY name").all().map((row) => row.name);
  apply(db, `${directory}/${migrations.find((entry) => entry.startsWith("0017_"))}`);
  assert.deepEqual({ ...db.prepare("SELECT id, vin, variant, model_year, province, vehicle_condition, notes FROM motorcycles WHERE id='mc'").get() }, { id: "mc", vin: "VIN1", variant: null, model_year: null, province: null, vehicle_condition: "UNKNOWN", notes: null });
  assert.equal(db.prepare("SELECT value FROM sequence_counters WHERE name='motorcycle:job'").get().value, 1);
  const triggersAfter = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='motorcycles' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(triggersAfter, triggersBefore);
  db.close();
});

test("import ledger is immutable, bounded and transitions only after clean validation", () => {
  const db = migrated();
  db.exec(`INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company', 'CUS', 'Company', 'Company'); INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES ('owner', 'auth', 'owner@example.test', 'Owner', 'OWNER'); INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by) VALUES ('job', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-1', 'company', 'A', 'B', 'OPEN', 'owner'); INSERT INTO motorcycle_import_batches (id, request_key, job_id, company_id, source_filename, source_type, checksum, row_count, valid_count, error_count, created_by) VALUES ('batch', '0198f708-44a3-7ef7-8d4f-4f477922ff2a', 'job', 'company', 'import.csv', 'CSV', '${"a".repeat(64)}', 1, 1, 0, 'owner'); INSERT INTO motorcycle_import_rows (id, batch_id, source_row_number, record_id, public_id, raw_payload, vin, vehicle_condition, validation_status) VALUES ('row', 'batch', 2, 'mc-new', 'mc_public_new', '{"vin":"VIN2"}', 'VIN2', 'NEW', 'VALID');`);
  assert.throws(() => db.exec("DELETE FROM motorcycle_import_batches WHERE id='batch'"));
  assert.throws(() => db.exec("DELETE FROM motorcycle_import_rows WHERE id='row'"));
  assert.throws(() => db.exec("UPDATE motorcycle_import_batches SET status='IMPORTED' WHERE id='batch'"));
  assert.throws(() => db.exec("UPDATE motorcycle_import_rows SET vin='CHANGED' WHERE id='row'"));
  db.exec("UPDATE motorcycle_import_batches SET status='IMPORTING', import_request_key='0198f708-44a3-7ef7-8d4f-4f477922ff2b' WHERE id='batch'");
  db.exec("INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, vin, vehicle_condition) VALUES ('mc-new', 'mc_public_new', 'company', 'job', 1, 'VIN2', 'NEW')");
  db.exec("UPDATE motorcycle_import_rows SET validation_status='IMPORTED', imported_record_id=record_id, imported_at=CURRENT_TIMESTAMP WHERE id='row'");
  db.exec("UPDATE motorcycle_import_batches SET status='IMPORTED', imported_at=CURRENT_TIMESTAMP WHERE id='batch'");
  assert.equal(db.prepare("SELECT status FROM motorcycle_import_batches WHERE id='batch'").get().status, "IMPORTED");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("the production confirmation plan atomically imports 500 rows with contiguous non-reused sequences", () => {
  const db = migrated(); seedImportCore(db);
  db.exec(`INSERT INTO motorcycle_import_batches (id, request_key, job_id, company_id, source_filename, source_type, checksum, row_count, valid_count, error_count, created_by) VALUES ('batch-500', '0198f708-44a3-7ef7-8d4f-4f477922aa01', 'job', 'company', 'five-hundred.csv', 'CSV', '${"b".repeat(64)}', 500, 500, 0, 'owner')`);
  const insert = db.prepare(`INSERT INTO motorcycle_import_rows (id, batch_id, source_row_number, record_id, public_id, raw_payload, vin, vehicle_condition, validation_status) VALUES (?, 'batch-500', ?, ?, ?, ?, ?, 'NEW', 'VALID')`);
  for (let index = 0; index < 500; index += 1) insert.run(`row-${index}`, index + 2, `mc-${index}`, `mc_public_${index}`, JSON.stringify({ vin: `VIN-${index}` }), `VIN-${index}`);
  const plan = motorcycleImportConfirmationPlan({ batchId: "batch-500", importRequestKey: "0198f708-44a3-7ef7-8d4f-4f477922aa02", actorUserId: "owner", auditId: "audit-batch-500", now: "2026-08-21T03:00:00.000Z" });
  runPlan(db, plan);
  assert.deepEqual({ ...db.prepare("SELECT count(*) AS total, min(sequence_number) AS first, max(sequence_number) AS last FROM motorcycles WHERE job_id='job'").get() }, { total: 500, first: 1, last: 500 });
  assert.equal(db.prepare("SELECT count(*) AS total FROM status_events WHERE motorcycle_id LIKE 'mc-%'").get().total, 500);
  assert.equal(db.prepare("SELECT count(*) AS total FROM motorcycle_import_rows WHERE batch_id='batch-500' AND validation_status='IMPORTED'").get().total, 500);
  assert.equal(db.prepare("SELECT status FROM motorcycle_import_batches WHERE id='batch-500'").get().status, "IMPORTED");
  assert.equal(db.prepare("SELECT value FROM sequence_counters WHERE name='motorcycle:job'").get().value, 500);
  assert.throws(() => runPlan(db, motorcycleImportConfirmationPlan({ batchId: "batch-500", importRequestKey: "0198f708-44a3-7ef7-8d4f-4f477922aa03", actorUserId: "owner", auditId: "audit-replay", now: "2026-08-21T03:01:00.000Z" })));
  assert.equal(db.prepare("SELECT count(*) AS total FROM motorcycles").get().total, 500);
  db.close();
});

test("a uniqueness race rolls back the whole import plan without consuming sequences", () => {
  const db = migrated(); seedImportCore(db);
  db.exec(`INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, vin) VALUES ('existing', 'mc_existing', 'company', 'job', 1, 'VIN-DUP'); INSERT INTO motorcycle_import_batches (id, request_key, job_id, company_id, source_filename, source_type, checksum, row_count, valid_count, error_count, created_by) VALUES ('batch-race', '0198f708-44a3-7ef7-8d4f-4f477922bb01', 'job', 'company', 'race.csv', 'CSV', '${"c".repeat(64)}', 1, 1, 0, 'owner'); INSERT INTO motorcycle_import_rows (id, batch_id, source_row_number, record_id, public_id, raw_payload, vin, validation_status) VALUES ('race-row', 'batch-race', 2, 'raced-record', 'mc_raced', '{"vin":"VIN-DUP"}', 'VIN-DUP', 'VALID')`);
  assert.throws(() => runPlan(db, motorcycleImportConfirmationPlan({ batchId: "batch-race", importRequestKey: "0198f708-44a3-7ef7-8d4f-4f477922bb02", actorUserId: "owner", auditId: "audit-race", now: "2026-08-21T03:00:00.000Z" })));
  assert.deepEqual({ ...db.prepare("SELECT status, import_request_key FROM motorcycle_import_batches WHERE id='batch-race'").get() }, { status: "VALIDATED", import_request_key: null });
  assert.equal(db.prepare("SELECT count(*) AS total FROM motorcycles").get().total, 1);
  assert.equal(db.prepare("SELECT count(*) AS total FROM sequence_counters WHERE name='motorcycle:job'").get().total, 0);
  assert.equal(db.prepare("SELECT validation_status FROM motorcycle_import_rows WHERE id='race-row'").get().validation_status, "VALID");
  db.close();
});

function seedImportCore(db) {
  db.exec(`INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company', 'CUS', 'Company', 'Company'); INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES ('owner', 'auth', 'owner@example.test', 'Owner', 'OWNER'); INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by) VALUES ('job', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-1', 'company', 'A', 'B', 'OPEN', 'owner')`);
}

function runPlan(db, plan) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of plan) {
      const prepared = db.prepare(item.sql);
      if (item.sql.trimStart().toUpperCase().startsWith("SELECT")) prepared.all(...item.params);
      else prepared.run(...item.params);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
