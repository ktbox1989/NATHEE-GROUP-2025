import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));

function applyFile(db, name) {
  for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
}

function migrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) {
    applyFile(db, name);
  }
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES
      ('company-a', 'CUS-A', 'Company A', 'Company A'),
      ('company-b', 'CUS-B', 'Company B', 'Company B');
    INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES
      ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
      VALUES ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-A', 'company-a', 'A', 'B', 'OPEN', 'owner-a');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status)
      VALUES ('mc-a', 'mc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'company-a', 'job-a', 1, 'PENDING_RECEIPT');
    INSERT INTO motorcycle_images
      (id, request_key, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by)
      VALUES
      ('left-a', 'motorcycle-image-10000000-0000-4000-8000-000000000001', 'mc-a', 'company-a', 'private/left.jpg', 'LEFT', 'image/jpeg', 10, '${"a".repeat(64)}', 'owner-a'),
      ('right-a', 'motorcycle-image-10000000-0000-4000-8000-000000000002', 'mc-a', 'company-a', 'private/right.jpg', 'RIGHT', 'image/jpeg', 10, '${"b".repeat(64)}', 'owner-a'),
      ('front-a', 'motorcycle-image-10000000-0000-4000-8000-000000000003', 'mc-a', 'company-a', 'private/front.jpg', 'FRONT', 'image/jpeg', 10, '${"c".repeat(64)}', 'owner-a'),
      ('rear-a', 'motorcycle-image-10000000-0000-4000-8000-000000000004', 'mc-a', 'company-a', 'private/rear.jpg', 'REAR', 'image/jpeg', 10, '${"d".repeat(64)}', 'owner-a'),
      ('other-a', 'motorcycle-image-10000000-0000-4000-8000-000000000005', 'mc-a', 'company-a', 'private/other.jpg', 'OTHER', 'image/jpeg', 10, '${"f".repeat(64)}', 'owner-a'),
      ('left-wrong-company', 'motorcycle-image-10000000-0000-4000-8000-000000000006', 'mc-a', 'company-b', 'private/left-wrong-company.jpg', 'LEFT', 'image/jpeg', 10, '${"1".repeat(64)}', 'owner-a');
  `);
  return db;
}

function receipt(db, overrides = {}) {
  const values = {
    id: "inspection-a",
    requestKey: "10000000-0000-4000-8000-000000000010",
    motorcycleId: "mc-a",
    companyId: "company-a",
    result: "PASS",
    left: "left-a",
    right: "right-a",
    front: "front-a",
    rear: "rear-a",
    ...overrides,
  };
  db.prepare(`
    INSERT INTO motorcycle_inspections
      (id, request_key, motorcycle_id, company_id, type, result, fuel_level, notes,
       left_image_id, right_image_id, front_image_id, rear_image_id, inspected_by, inspected_at)
    VALUES (?, ?, ?, ?, 'RECEIPT', ?, 'UNKNOWN', 'acceptance evidence', ?, ?, ?, ?, 'owner-a', '2026-08-27T10:00:00.000Z')
  `).run(values.id, values.requestKey, values.motorcycleId, values.companyId, values.result, values.left, values.right, values.front, values.rear);
}

test("receipt inspection refuses every missing mandatory angle", () => {
  for (const field of ["left", "right", "front", "rear"]) {
    const db = migrated();
    assert.throws(() => receipt(db, { [field]: null }), /left, right, front and rear/, field);
    assert.equal(db.prepare("SELECT count(*) AS n FROM motorcycle_inspections").get().n, 0);
    db.close();
  }
});

test("receipt inspection links four matching private image records to the exact motorcycle", () => {
  const db = migrated();
  receipt(db);
  assert.deepEqual(
    db.prepare("SELECT id, category, motorcycle_id, company_id FROM motorcycle_images WHERE id IN ('left-a', 'right-a', 'front-a', 'rear-a') ORDER BY category").all().map((row) => ({ ...row })),
    [
      { id: "front-a", category: "FRONT", motorcycle_id: "mc-a", company_id: "company-a" },
      { id: "left-a", category: "LEFT", motorcycle_id: "mc-a", company_id: "company-a" },
      { id: "rear-a", category: "REAR", motorcycle_id: "mc-a", company_id: "company-a" },
      { id: "right-a", category: "RIGHT", motorcycle_id: "mc-a", company_id: "company-a" },
    ],
  );
  assert.deepEqual(
    { ...db.prepare("SELECT left_image_id, right_image_id, front_image_id, rear_image_id FROM motorcycle_inspections WHERE id='inspection-a'").get() },
    { left_image_id: "left-a", right_image_id: "right-a", front_image_id: "front-a", rear_image_id: "rear-a" },
  );
  db.exec("UPDATE motorcycles SET current_status='RECEIVED' WHERE id='mc-a'");
  assert.equal(db.prepare("SELECT current_status FROM motorcycles WHERE id='mc-a'").get().current_status, "RECEIVED");
  db.close();
});

test("receipt evidence rejects category substitution and another motorcycle's image", () => {
  const wrongAngle = migrated();
  assert.throws(() => receipt(wrongAngle, { left: "front-a" }), /left, right, front and rear/);
  assert.throws(() => receipt(wrongAngle, { left: "other-a" }), /left, right, front and rear/);
  wrongAngle.close();

  const wrongCompany = migrated();
  assert.throws(() => receipt(wrongCompany, { left: "left-wrong-company" }), /left, right, front and rear/);
  wrongCompany.close();

  const wrongMotorcycle = migrated();
  wrongMotorcycle.exec(`
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
      VALUES ('job-b', 'job_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'JOB-B', 'company-b', 'A', 'B', 'OPEN', 'owner-a');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number)
      VALUES ('mc-b', 'mc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'company-b', 'job-b', 1);
    INSERT INTO motorcycle_images
      (id, request_key, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by)
      VALUES ('left-b', 'motorcycle-image-10000000-0000-4000-8000-000000000020', 'mc-b', 'company-b', 'private/left-b.jpg', 'LEFT', 'image/jpeg', 10, '${"e".repeat(64)}', 'owner-a');
  `);
  assert.throws(() => receipt(wrongMotorcycle, { left: "left-b" }), /left, right, front and rear/);
  wrongMotorcycle.close();
});

test("motorcycle cannot be confirmed received without a passed four-angle receipt inspection", () => {
  const db = migrated();
  assert.throws(() => db.exec("UPDATE motorcycles SET current_status='RECEIVED' WHERE id='mc-a'"), /four-angle evidence/);
  receipt(db, { result: "ISSUE" });
  assert.throws(() => db.exec("UPDATE motorcycles SET current_status='RECEIVED' WHERE id='mc-a'"), /four-angle evidence/);
  db.close();
});

test("new evidence columns preserve the append-only inspection contract", () => {
  const db = migrated();
  receipt(db);
  assert.throws(() => db.exec("UPDATE motorcycle_inspections SET left_image_id='front-a' WHERE id='inspection-a'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM motorcycle_inspections WHERE id='inspection-a'"), /cannot be deleted/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("0031 is additive and preserves inspections created by the 0000-0030 schema", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const names = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
  for (const name of names.filter((entry) => entry < "0031_")) applyFile(db, name);
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company-old', 'OLD', 'Existing Company', 'Existing Company');
    INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES ('owner-old', 'auth-old', 'old@example.test', 'Existing Owner', 'OWNER');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
      VALUES ('job-old', 'job_cccccccccccccccccccccccccccccccc', 'JOB-OLD', 'company-old', 'A', 'B', 'OPEN', 'owner-old');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status)
      VALUES ('mc-old', 'mc_cccccccccccccccccccccccccccccccc', 'company-old', 'job-old', 1, 'PENDING_RECEIPT');
    INSERT INTO motorcycle_inspections
      (id, request_key, motorcycle_id, company_id, type, result, fuel_level, notes, inspected_by, inspected_at)
      VALUES ('inspection-old', '10000000-0000-4000-8000-000000000099', 'mc-old', 'company-old', 'RECEIPT', 'PASS', 'UNKNOWN', 'pre-0031 record', 'owner-old', '2026-08-26T10:00:00.000Z');
  `);

  const migration = readFileSync(`${directory}/0031_intake_inspection_evidence.sql`, "utf8");
  assert.doesNotMatch(migration, /^\s*(?:DROP|DELETE|UPDATE)\b/im);
  applyFile(db, "0031_intake_inspection_evidence.sql");
  assert.deepEqual(
    { ...db.prepare("SELECT id, notes, left_image_id, right_image_id, front_image_id, rear_image_id FROM motorcycle_inspections WHERE id='inspection-old'").get() },
    { id: "inspection-old", notes: "pre-0031 record", left_image_id: null, right_image_id: null, front_image_id: null, rear_image_id: null },
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
