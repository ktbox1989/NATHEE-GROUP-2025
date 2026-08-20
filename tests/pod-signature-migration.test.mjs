import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
function apply(db, path) { for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement); }

test("POD signature migration preserves legacy evidence and enforces signed new delivery", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
  for (const name of migrations.filter((entry) => entry < "0021_")) apply(db, `${directory}/${name}`);
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES
      ('company-a', 'A', 'Company A', 'Company A'),
      ('company-b', 'B', 'Company B', 'Company B');
    INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES ('owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by) VALUES
      ('job', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-1', 'company-a', 'A', 'B', 'OPEN', 'owner');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status) VALUES
      ('motorcycle-legacy', 'mc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'company-a', 'job', 1, 'ARRIVED'),
      ('motorcycle-new', 'mc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'company-a', 'job', 2, 'ARRIVED');
    INSERT INTO motorcycle_images (id, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by) VALUES
      ('image-legacy', 'motorcycle-legacy', 'company-a', 'legacy.jpg', 'DELIVERY', 'image/jpeg', 1000, '${"a".repeat(64)}', 'owner'),
      ('image-new', 'motorcycle-new', 'company-a', 'new.jpg', 'DELIVERY', 'image/jpeg', 1000, '${"b".repeat(64)}', 'owner');
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by)
    VALUES ('pod-legacy', 'legacy-request', 'motorcycle-legacy', 'company-a', 'Legacy Recipient', 'Bangkok', '2026-08-21T06:00:00.000Z', 'image-legacy', 'owner');
  `);
  const migration = migrations.find((entry) => entry.startsWith("0021_"));
  assert.ok(migration, "migration 0021 is required");
  apply(db, `${directory}/${migration}`);

  assert.equal(db.prepare("SELECT signature_required FROM proof_of_delivery_records WHERE id='pod-legacy'").get().signature_required, 0);
  db.exec("UPDATE motorcycles SET current_status='DELIVERED' WHERE id='motorcycle-legacy'");
  assert.throws(() => db.exec(`
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by)
    VALUES ('pod-missing-flag', 'missing-flag', 'motorcycle-new', 'company-a', 'Recipient', 'Bangkok', '2026-08-21T06:00:00.000Z', 'image-new', 'owner')
  `), /requires signature evidence/);
  db.exec(`
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by, signature_required)
    VALUES ('pod-new', 'new-request', 'motorcycle-new', 'company-a', 'Recipient', 'Bangkok', '2026-08-21T06:00:00.000Z', 'image-new', 'owner', 1)
  `);
  assert.throws(() => db.exec("UPDATE motorcycles SET current_status='DELIVERED' WHERE id='motorcycle-new'"), /signed proof/);
  assert.throws(() => db.exec(`INSERT INTO proof_of_delivery_signatures (id,pod_id,company_id,storage_key,content_type,width,height,byte_size,checksum,attested_by,attested_at) VALUES ('bad-company','pod-new','company-b','bad-company.png','image/png',720,240,500,'${"c".repeat(64)}','owner','2026-08-21T06:01:00.000Z')`), /matching proof/);
  assert.throws(() => db.exec(`INSERT INTO proof_of_delivery_signatures (id,pod_id,company_id,storage_key,content_type,width,height,byte_size,checksum,attested_by,attested_at) VALUES ('bad-shape','pod-new','company-a','bad-shape.png','image/png',240,720,500,'${"c".repeat(64)}','owner','2026-08-21T06:01:00.000Z')`));
  assert.throws(() => db.exec(`INSERT INTO proof_of_delivery_signatures (id,pod_id,company_id,storage_key,content_type,width,height,byte_size,checksum,attested_by,attested_at) VALUES ('bad-checksum','pod-new','company-a','bad-checksum.png','image/png',720,240,500,'not-a-checksum','owner','2026-08-21T06:01:00.000Z')`));
  db.exec(`INSERT INTO proof_of_delivery_signatures (id,pod_id,company_id,storage_key,content_type,width,height,byte_size,checksum,attested_by,attested_at) VALUES ('signature-new','pod-new','company-a','signature-new.png','image/png',720,240,500,'${"c".repeat(64)}','owner','2026-08-21T06:01:00.000Z')`);
  assert.throws(() => db.exec("UPDATE proof_of_delivery_signatures SET width=700 WHERE id='signature-new'"), /immutable/);
  assert.throws(() => db.exec("DELETE FROM proof_of_delivery_signatures WHERE id='signature-new'"), /cannot be deleted/);
  assert.throws(() => db.exec("UPDATE proof_of_delivery_records SET signature_required=0 WHERE id='pod-new'"), /immutable/);
  db.exec("UPDATE motorcycles SET current_status='DELIVERED' WHERE id='motorcycle-new'");

  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM proof_of_delivery_signatures WHERE pod_id=?").all("pod-new").map((row) => String(row.detail)).join(" ");
  assert.match(plan, /uq_pod_signatures_pod/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
