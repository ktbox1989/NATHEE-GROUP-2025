import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));

function applyMigration(db, path) {
  const sql = readFileSync(path, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
}

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(migrationDirectory).filter((entry) => entry.endsWith(".sql")).sort()) {
    applyMigration(db, `${migrationDirectory}/${name}`);
  }
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES
      ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ'),
      ('company-b', 'CUS-B', 'บริษัท บี จำกัด', 'บริษัท บี');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('owner-a', 'OWNER', 'owner-a');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
    VALUES
      ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-A', 'company-a', 'A', 'B', 'OPEN', 'owner-a'),
      ('job-b', 'job_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'JOB-B', 'company-b', 'A', 'B', 'OPEN', 'owner-a');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status)
    VALUES
      ('motorcycle-a', 'public-a', 'company-a', 'job-a', 1, 'RECEIVED'),
      ('motorcycle-b', 'public-b', 'company-a', 'job-a', 2, 'ARRIVED'),
      ('motorcycle-c', 'public-c', 'company-b', 'job-b', 1, 'RECEIVED'),
      ('motorcycle-d', 'public-d', 'company-a', 'job-a', 3, 'ARRIVED');
    INSERT INTO motorcycle_images
      (id, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by)
    VALUES
      ('damage-image-a', 'motorcycle-a', 'company-a', 'damage-a.jpg', 'DAMAGE', 'image/jpeg', 100, '${"a".repeat(64)}', 'owner-a'),
      ('left-image-a', 'motorcycle-a', 'company-a', 'left-a.jpg', 'LEFT', 'image/jpeg', 100, '${"e".repeat(64)}', 'owner-a'),
      ('right-image-a', 'motorcycle-a', 'company-a', 'right-a.jpg', 'RIGHT', 'image/jpeg', 100, '${"f".repeat(64)}', 'owner-a'),
      ('front-image-a', 'motorcycle-a', 'company-a', 'front-a.jpg', 'FRONT', 'image/jpeg', 100, '${"1".repeat(64)}', 'owner-a'),
      ('rear-image-a', 'motorcycle-a', 'company-a', 'rear-a.jpg', 'REAR', 'image/jpeg', 100, '${"2".repeat(64)}', 'owner-a'),
      ('delivery-image-b', 'motorcycle-b', 'company-a', 'delivery-b.jpg', 'DELIVERY', 'image/jpeg', 100, '${"b".repeat(64)}', 'owner-a'),
      ('delivery-image-d', 'motorcycle-d', 'company-a', 'delivery-d.jpg', 'DELIVERY', 'image/jpeg', 100, '${"d".repeat(64)}', 'owner-a');
  `);
  return db;
}

test("migration 0011 upgrades prior operational records without rewriting them", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(migrationDirectory).filter((entry) => entry.endsWith(".sql") && entry < "0011").sort()) {
    applyMigration(db, `${migrationDirectory}/${name}`);
  }
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-upgrade', 'UP', 'Upgrade Co', 'Upgrade');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-upgrade', 'auth-owner-upgrade', 'upgrade@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, job_number, company_id, origin, destination, created_by)
    VALUES ('job-upgrade', 'JOB-UPGRADE', 'company-upgrade', 'A', 'B', 'owner-upgrade');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status)
    VALUES ('motorcycle-upgrade', 'public-upgrade', 'company-upgrade', 'job-upgrade', 1, 'RECEIVED');
  `);
  applyMigration(db, `${migrationDirectory}/0011_inspection_damage_pod.sql`);
  assert.equal(db.prepare("SELECT current_status FROM motorcycles WHERE id = 'motorcycle-upgrade'").get().current_status, "RECEIVED");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM motorcycle_inspections").get().total, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("receipt inspection is append-only and required before INSPECTED status", () => {
  const db = createDatabase();
  assert.throws(() => db.exec("UPDATE motorcycles SET current_status = 'INSPECTED' WHERE id = 'motorcycle-a'"), /passed receipt inspection/);
  assert.throws(() => db.exec(`
    INSERT INTO motorcycle_inspections
      (id, request_key, motorcycle_id, company_id, type, result, fuel_level, left_image_id, right_image_id, front_image_id, rear_image_id, inspected_by, inspected_at)
    VALUES ('inspection-bad-company', '0198f708-44a3-7ef7-8d4f-4f477922ca01', 'motorcycle-a', 'company-b', 'RECEIPT', 'PASS', 'UNKNOWN', 'left-image-a', 'right-image-a', 'front-image-a', 'rear-image-a', 'owner-a', '2026-08-21T05:00:00.000Z')
  `), /matching motorcycle/);
  assert.throws(() => db.exec(`
    INSERT INTO motorcycle_inspections
      (id, request_key, motorcycle_id, company_id, type, result, fuel_level, left_image_id, right_image_id, front_image_id, rear_image_id, inspected_by, inspected_at)
    VALUES ('inspection-no-note', '0198f708-44a3-7ef7-8d4f-4f477922ca02', 'motorcycle-a', 'company-a', 'RECEIPT', 'DAMAGE', 'UNKNOWN', 'left-image-a', 'right-image-a', 'front-image-a', 'rear-image-a', 'owner-a', '2026-08-21T05:00:00.000Z')
  `), /issue notes/);
  db.exec(`
    INSERT INTO motorcycle_inspections
      (id, request_key, motorcycle_id, company_id, type, result, odometer_km, fuel_level, left_image_id, right_image_id, front_image_id, rear_image_id, inspected_by, inspected_at)
    VALUES ('inspection-pass', '0198f708-44a3-7ef7-8d4f-4f477922ca03', 'motorcycle-a', 'company-a', 'RECEIPT', 'PASS', 1200, 'HALF', 'left-image-a', 'right-image-a', 'front-image-a', 'rear-image-a', 'owner-a', '2026-08-21T05:00:00.000Z')
  `);
  db.exec("UPDATE motorcycles SET current_status = 'INSPECTED' WHERE id = 'motorcycle-a'");
  assert.equal(db.prepare("SELECT current_status FROM motorcycles WHERE id = 'motorcycle-a'").get().current_status, "INSPECTED");
  assert.throws(() => db.exec("UPDATE motorcycle_inspections SET notes = 'changed' WHERE id = 'inspection-pass'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM motorcycle_inspections WHERE id = 'inspection-pass'"), /cannot be deleted/);
  db.close();
});

test("damage findings accept only matching DAMAGE evidence and retain history", () => {
  const db = createDatabase();
  db.exec(`
    INSERT INTO motorcycle_inspections
      (id, request_key, motorcycle_id, company_id, type, result, fuel_level, notes, left_image_id, right_image_id, front_image_id, rear_image_id, inspected_by, inspected_at)
    VALUES ('inspection-damage', '0198f708-44a3-7ef7-8d4f-4f477922cb01', 'motorcycle-a', 'company-a', 'RECEIPT', 'DAMAGE', 'UNKNOWN', 'พบรอยที่กันชนหน้า', 'left-image-a', 'right-image-a', 'front-image-a', 'rear-image-a', 'owner-a', '2026-08-21T05:00:00.000Z');
    INSERT INTO inspection_findings
      (id, inspection_id, area, severity, description, evidence_image_id, created_by)
    VALUES ('finding-a', 'inspection-damage', 'กันชนหน้า', 'MODERATE', 'มีรอยแตกด้านซ้าย', 'damage-image-a', 'owner-a');
  `);
  assert.throws(() => db.exec(`
    INSERT INTO inspection_findings
      (id, inspection_id, area, severity, description, evidence_image_id, created_by)
    VALUES ('finding-wrong-evidence', 'inspection-damage', 'กันชนหน้า', 'MINOR', 'รอยขีดข่วน', 'delivery-image-b', 'owner-a')
  `), /matching DAMAGE evidence/);
  assert.throws(() => db.exec("UPDATE inspection_findings SET description = 'changed' WHERE id = 'finding-a'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM inspection_findings WHERE id = 'finding-a'"), /cannot be deleted/);
  db.close();
});

test("proof of delivery requires ARRIVED status, same-motorcycle DELIVERY evidence and active record", () => {
  const db = createDatabase();
  assert.throws(() => db.exec("UPDATE motorcycles SET current_status = 'DELIVERED' WHERE id = 'motorcycle-b'"), /active proof/);
  assert.throws(() => db.exec(`
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by, signature_required)
    VALUES ('pod-wrong-image', '0198f708-44a3-7ef7-8d4f-4f477922cc01', 'motorcycle-b', 'company-a', 'ผู้รับ', 'Bangkok', '2026-08-21T06:00:00.000Z', 'damage-image-a', 'owner-a', 1)
  `), /matching DELIVERY evidence/);
  db.exec(`
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, recipient_phone, delivery_location, delivered_at, evidence_image_id, received_by, signature_required)
    VALUES ('pod-b', '0198f708-44a3-7ef7-8d4f-4f477922cc02', 'motorcycle-b', 'company-a', 'ผู้รับจริง', '0812345678', 'Bangkok', '2026-08-21T06:00:00.000Z', 'delivery-image-b', 'owner-a', 1);
    INSERT INTO proof_of_delivery_signatures
      (id, pod_id, company_id, storage_key, content_type, width, height, byte_size, checksum, attested_by, attested_at)
    VALUES ('signature-b', 'pod-b', 'company-a', 'signature-b.png', 'image/png', 720, 240, 500, '${"c".repeat(64)}', 'owner-a', '2026-08-21T06:00:00.000Z')
  `);
  assert.throws(() => db.exec(`
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by, signature_required)
    VALUES ('pod-duplicate', '0198f708-44a3-7ef7-8d4f-4f477922cc03', 'motorcycle-b', 'company-a', 'ผู้รับจริง', 'Bangkok', '2026-08-21T06:00:00.000Z', 'delivery-image-b', 'owner-a', 1)
  `));
  db.exec("UPDATE motorcycles SET current_status = 'DELIVERED' WHERE id = 'motorcycle-b'");
  assert.throws(() => db.exec("UPDATE proof_of_delivery_records SET status = 'VOIDED', void_reason = 'แก้ไขข้อมูล', voided_by = 'owner-a', voided_at = '2026-08-21T06:10:00.000Z' WHERE id = 'pod-b'"), /before motorcycle delivery/);
  assert.throws(() => db.exec("DELETE FROM proof_of_delivery_records WHERE id = 'pod-b'"), /cannot be deleted/);
  db.close();
});

test("an arrived POD can be voided with reason and replaced without reusing history", () => {
  const db = createDatabase();
  db.exec(`
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by, signature_required)
    VALUES ('pod-d-old', '0198f708-44a3-7ef7-8d4f-4f477922cd01', 'motorcycle-d', 'company-a', 'ชื่อผิด', 'Bangkok', '2026-08-21T06:00:00.000Z', 'delivery-image-d', 'owner-a', 1);
    UPDATE proof_of_delivery_records
    SET status = 'VOIDED', void_reason = 'แก้ไขชื่อผู้รับ', voided_by = 'owner-a', voided_at = '2026-08-21T06:10:00.000Z'
    WHERE id = 'pod-d-old';
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by, signature_required)
    VALUES ('pod-d-new', '0198f708-44a3-7ef7-8d4f-4f477922cd02', 'motorcycle-d', 'company-a', 'ชื่อถูกต้อง', 'Bangkok', '2026-08-21T06:00:00.000Z', 'delivery-image-d', 'owner-a', 1);
  `);
  assert.deepEqual(
    db.prepare("SELECT id, status FROM proof_of_delivery_records WHERE motorcycle_id = 'motorcycle-d' ORDER BY created_at, id").all().map((row) => ({ ...row })),
    [{ id: "pod-d-new", status: "ACTIVE" }, { id: "pod-d-old", status: "VOIDED" }],
  );
  db.close();
});

test("inspection and POD operational lookups use bounded indexes", () => {
  const db = createDatabase();
  const inspectionPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM motorcycle_inspections WHERE motorcycle_id = ? AND type = ? ORDER BY inspected_at, id LIMIT 51").all("motorcycle-a", "RECEIPT").map((row) => String(row.detail)).join(" ");
  const podPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM proof_of_delivery_records WHERE motorcycle_id = ? AND status = 'ACTIVE'").all("motorcycle-b").map((row) => String(row.detail)).join(" ");
  assert.match(inspectionPlan, /idx_motorcycle_inspections_motorcycle_type_at/);
  assert.match(podPlan, /uq_pod_records_motorcycle_active/);
  db.close();
});
