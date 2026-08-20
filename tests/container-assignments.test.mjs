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

function createDatabase({ capacity = 2 } = {}) {
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
      ('motorcycle-a', 'public-a', 'company-a', 'job-a', 1, 'SCHEDULED'),
      ('motorcycle-b', 'public-b', 'company-a', 'job-a', 2, 'SCHEDULED'),
      ('motorcycle-c', 'public-c', 'company-b', 'job-b', 1, 'SCHEDULED'),
      ('motorcycle-yard', 'public-yard', 'company-a', 'job-a', 3, 'IN_YARD');
    INSERT INTO shipping_containers
      (id, request_key, public_id, container_number, seal_number, type, capacity_motorcycles, port, country, created_by)
    VALUES
      ('container-a', '0198f708-44a3-7ef7-8d4f-4f477922ba01', 'container-public-a', 'CSQU3054383', 'SEAL-001', '40HC', ${capacity}, 'Laem Chabang', 'Japan', 'owner-a'),
      ('container-b', '0198f708-44a3-7ef7-8d4f-4f477922ba02', 'container-public-b', 'MSKU9070323', 'SEAL-002', '20FT', 10, 'Laem Chabang', 'Japan', 'owner-a');
    INSERT INTO container_status_events (id, container_id, previous_status, new_status, note, created_by)
    VALUES
      ('container-event-a', 'container-a', NULL, 'DRAFT', 'created', 'owner-a'),
      ('container-event-b', 'container-b', NULL, 'DRAFT', 'created', 'owner-a');
    INSERT INTO trucks (id, request_key, public_id, code, type, capacity_motorcycles, created_by)
    VALUES ('truck-a', '0198f708-44a3-7ef7-8d4f-4f477922ba03', 'truck_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'NG-01', 'SIX_WHEEL', 10, 'owner-a');
    INSERT INTO trips (id, request_key, public_id, trip_number, truck_id, origin, destination, created_by)
    VALUES ('trip-a', '0198f708-44a3-7ef7-8d4f-4f477922ba04', 'trip_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'TRIP-A', 'truck-a', 'A', 'B', 'owner-a');
  `);
  return db;
}

function assign(db, {
  id = "assignment-a",
  requestKey = "0198f708-44a3-7ef7-8d4f-4f477922bb01",
  containerId = "container-a",
  motorcycleId = "motorcycle-a",
  companyId = "company-a",
} = {}) {
  db.prepare(`
    INSERT INTO container_motorcycle_assignments
      (id, request_key, container_id, motorcycle_id, company_id, assigned_by, assigned_at)
    VALUES (?, ?, ?, ?, ?, 'owner-a', '2026-08-21T04:00:00.000Z')
  `).run(id, requestKey, containerId, motorcycleId, companyId);
}

test("migration 0010 upgrades an existing registry without rewriting container records", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(migrationDirectory).filter((entry) => entry.endsWith(".sql") && entry < "0010").sort()) {
    applyMigration(db, `${migrationDirectory}/${name}`);
  }
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-upgrade', 'auth-owner-upgrade', 'upgrade@example.test', 'Owner', 'OWNER');
    INSERT INTO shipping_containers
      (id, request_key, public_id, container_number, type, port, country, created_by)
    VALUES ('container-upgrade', '0198f708-44a3-7ef7-8d4f-4f477922bc01', 'container-public-upgrade', 'CSQU3054383', '20FT', 'Port', 'Country', 'owner-upgrade');
  `);
  applyMigration(db, `${migrationDirectory}/0010_container_motorcycle_loads.sql`);

  assert.equal(db.prepare("SELECT container_number FROM shipping_containers WHERE id = 'container-upgrade'").get().container_number, "CSQU3054383");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM container_motorcycle_assignments").get().total, 0);
  assert.throws(() => db.exec("UPDATE shipping_containers SET status = 'PLANNED' WHERE id = 'container-upgrade'"), /readiness/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("container assignment rejects duplicates, cross-company records, invalid status, cross-mode assignment and capacity overflow", () => {
  const db = createDatabase({ capacity: 1 });
  assign(db);
  assert.throws(() => assign(db, { id: "assignment-duplicate", requestKey: "0198f708-44a3-7ef7-8d4f-4f477922bb02", containerId: "container-b" }));
  assert.throws(() => assign(db, { id: "assignment-capacity", requestKey: "0198f708-44a3-7ef7-8d4f-4f477922bb03", motorcycleId: "motorcycle-b" }), /available capacity/);
  assert.throws(() => assign(db, { id: "assignment-company", requestKey: "0198f708-44a3-7ef7-8d4f-4f477922bb04", containerId: "container-b", motorcycleId: "motorcycle-c", companyId: "company-a" }), /matching company/);
  assert.throws(() => assign(db, { id: "assignment-status", requestKey: "0198f708-44a3-7ef7-8d4f-4f477922bb05", containerId: "container-b", motorcycleId: "motorcycle-yard" }), /scheduled unassigned motorcycle/);
  assert.throws(() => db.exec(`
    INSERT INTO trip_motorcycle_assignments
      (id, request_key, trip_id, motorcycle_id, company_id, assigned_by, assigned_at)
    VALUES ('trip-assignment-a', '0198f708-44a3-7ef7-8d4f-4f477922bb06', 'trip-a', 'motorcycle-a', 'company-a', 'owner-a', '2026-08-21T04:10:00.000Z')
  `), /active container assignment/);

  db.exec("UPDATE motorcycles SET current_status = 'SCHEDULED' WHERE id = 'motorcycle-b'");
  db.exec(`
    INSERT INTO trip_motorcycle_assignments
      (id, request_key, trip_id, motorcycle_id, company_id, assigned_by, assigned_at)
    VALUES ('trip-assignment-b', '0198f708-44a3-7ef7-8d4f-4f477922bb07', 'trip-a', 'motorcycle-b', 'company-a', 'owner-a', '2026-08-21T04:10:00.000Z')
  `);
  assert.throws(() => assign(db, { id: "assignment-trip", requestKey: "0198f708-44a3-7ef7-8d4f-4f477922bb08", containerId: "container-b", motorcycleId: "motorcycle-b" }), /scheduled unassigned motorcycle/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("container lifecycle requires Seal, load evidence and matching motorcycle states", () => {
  const db = createDatabase();
  assign(db);

  db.exec("UPDATE shipping_containers SET status = 'PLANNED' WHERE id = 'container-a'");
  assert.throws(() => db.exec("UPDATE shipping_containers SET capacity_motorcycles = 4 WHERE id = 'container-a'"), /locked after planning/);
  db.exec("UPDATE shipping_containers SET status = 'LOADING' WHERE id = 'container-a'");
  assert.throws(() => db.exec("UPDATE shipping_containers SET status = 'SEALED' WHERE id = 'container-a'"), /readiness/);
  assert.throws(() => db.exec("UPDATE container_motorcycle_assignments SET state = 'LOADED', loaded_at = '2026-08-21T04:10:00.000Z' WHERE id = 'assignment-a'"), /motorcycle workflow/);

  db.exec("UPDATE motorcycles SET current_status = 'LOADED' WHERE id = 'motorcycle-a'");
  db.exec("UPDATE container_motorcycle_assignments SET state = 'LOADED', loaded_at = '2026-08-21T04:10:00.000Z' WHERE id = 'assignment-a'");
  db.exec("UPDATE shipping_containers SET status = 'SEALED' WHERE id = 'container-a'");
  assert.throws(() => db.exec("UPDATE shipping_containers SET seal_number = 'SEAL-NEW' WHERE id = 'container-a'"), /immutable after sealing/);
  assert.throws(() => db.exec("UPDATE shipping_containers SET status = 'IN_TRANSIT' WHERE id = 'container-a'"), /readiness/);

  db.exec("UPDATE motorcycles SET current_status = 'IN_TRANSIT' WHERE id = 'motorcycle-a'");
  db.exec("UPDATE shipping_containers SET status = 'IN_TRANSIT' WHERE id = 'container-a'");
  assert.throws(() => db.exec("UPDATE shipping_containers SET status = 'ARRIVED' WHERE id = 'container-a'"), /readiness/);
  db.exec("UPDATE motorcycles SET current_status = 'ARRIVED' WHERE id = 'motorcycle-a'");
  db.exec("UPDATE shipping_containers SET status = 'ARRIVED' WHERE id = 'container-a'");
  db.exec("UPDATE shipping_containers SET status = 'UNLOADING' WHERE id = 'container-a'");
  assert.throws(() => db.exec("UPDATE shipping_containers SET status = 'COMPLETED' WHERE id = 'container-a'"), /readiness/);

  db.exec("UPDATE container_motorcycle_assignments SET state = 'UNLOADED', unloaded_at = '2026-08-21T10:00:00.000Z' WHERE id = 'assignment-a'");
  db.exec(`
    INSERT INTO motorcycle_images
      (id, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by)
    VALUES ('delivery-container-a', 'motorcycle-a', 'company-a', 'delivery-container-a.jpg', 'DELIVERY', 'image/jpeg', 100, '${"e".repeat(64)}', 'owner-a');
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by, signature_required)
    VALUES ('pod-container-a', '0198f708-44a3-7ef7-8d4f-4f477922be01', 'motorcycle-a', 'company-a', 'ผู้รับ', 'Japan', '2026-08-21T10:05:00.000Z', 'delivery-container-a', 'owner-a', 1);
    INSERT INTO proof_of_delivery_signatures
      (id, pod_id, company_id, storage_key, content_type, width, height, byte_size, checksum, attested_by, attested_at)
    VALUES ('signature-container-a', 'pod-container-a', 'company-a', 'signature-container-a.png', 'image/png', 720, 240, 500, '${"c".repeat(64)}', 'owner-a', '2026-08-21T10:05:00.000Z');
  `);
  db.exec("UPDATE motorcycles SET current_status = 'DELIVERED' WHERE id = 'motorcycle-a'");
  db.exec("UPDATE shipping_containers SET status = 'COMPLETED' WHERE id = 'container-a'");
  db.exec("UPDATE container_motorcycle_assignments SET state = 'RELEASED', released_at = '2026-08-21T10:10:00.000Z', release_reason = 'CONTAINER_COMPLETED' WHERE id = 'assignment-a'");

  assert.equal(db.prepare("SELECT status FROM shipping_containers WHERE id = 'container-a'").get().status, "COMPLETED");
  assert.equal(db.prepare("SELECT state FROM container_motorcycle_assignments WHERE id = 'assignment-a'").get().state, "RELEASED");
  assert.throws(() => db.exec("DELETE FROM container_motorcycle_assignments WHERE id = 'assignment-a'"), /cannot be deleted/);
  assert.throws(() => db.exec("DELETE FROM container_status_events WHERE id = 'container-event-a'"), /cannot be deleted/);
  assert.throws(() => db.exec("UPDATE container_status_events SET note = 'changed' WHERE id = 'container-event-a'"), /append-only/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("container cancellation releases only assignments that never started loading", () => {
  const db = createDatabase();
  assign(db);
  db.exec("UPDATE shipping_containers SET status = 'CANCELLED' WHERE id = 'container-a'");
  db.exec("UPDATE container_motorcycle_assignments SET state = 'RELEASED', released_at = '2026-08-21T05:00:00.000Z', release_reason = 'CONTAINER_CANCELLED' WHERE id = 'assignment-a'");
  assert.equal(db.prepare("SELECT state FROM container_motorcycle_assignments WHERE id = 'assignment-a'").get().state, "RELEASED");
  db.close();
});

test("container load-board lookup remains bounded and index-backed", () => {
  const db = createDatabase();
  const loadPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM container_motorcycle_assignments WHERE container_id = ? AND state = ? ORDER BY assigned_at, id LIMIT 51").all("container-a", "ASSIGNED").map((row) => String(row.detail)).join(" ");
  const activePlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM container_motorcycle_assignments WHERE motorcycle_id = ? AND released_at IS NULL").all("motorcycle-a").map((row) => String(row.detail)).join(" ");
  assert.match(loadPlan, /idx_container_assignments_container_state/);
  assert.match(activePlan, /uq_container_assignments_motorcycle_active/);
  db.close();
});
