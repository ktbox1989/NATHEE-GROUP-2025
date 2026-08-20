import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

function createDatabase({ capacity = 2 } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) {
    const sql = readFileSync(`${directory}/${name}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
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
    INSERT INTO trucks (id, request_key, public_id, code, type, capacity_motorcycles, created_by)
    VALUES ('truck-a', '0198f708-44a3-7ef7-8d4f-4f477922aa01', 'truck_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'NG-01', 'SIX_WHEEL', ${capacity}, 'owner-a');
    INSERT INTO trips (id, request_key, public_id, trip_number, truck_id, origin, destination, created_by)
    VALUES
      ('trip-a', '0198f708-44a3-7ef7-8d4f-4f477922aa02', 'trip_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'TRIP-A', 'truck-a', 'A', 'B', 'owner-a'),
      ('trip-b', '0198f708-44a3-7ef7-8d4f-4f477922aa03', 'trip_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'TRIP-B', 'truck-a', 'A', 'C', 'owner-a');
  `);
  return db;
}

test("migration 0008 upgrades an existing trip database without rewriting prior records", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry < "0008").sort()) {
    const sql = readFileSync(`${directory}/${name}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
  }
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-upgrade', 'auth-owner-upgrade', 'upgrade@example.test', 'Owner', 'OWNER');
    INSERT INTO trucks (id, request_key, public_id, code, type, created_by)
    VALUES ('truck-upgrade', '0198f708-44a3-7ef7-8d4f-4f477922ac01', 'truck-public-upgrade', 'UP-01', 'FOUR_WHEEL', 'owner-upgrade');
    INSERT INTO trips (id, request_key, public_id, trip_number, truck_id, origin, destination, created_by)
    VALUES ('trip-upgrade', '0198f708-44a3-7ef7-8d4f-4f477922ac02', 'trip-public-upgrade', 'TRIP-UPGRADE', 'truck-upgrade', 'A', 'B', 'owner-upgrade');
  `);
  const migration = readFileSync(`${directory}/0008_trip_motorcycle_loads.sql`, "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);

  assert.equal(db.prepare("SELECT trip_number FROM trips WHERE id = 'trip-upgrade'").get().trip_number, "TRIP-UPGRADE");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM trip_motorcycle_assignments").get().total, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

function assign(db, {
  id = "assignment-a",
  requestKey = "0198f708-44a3-7ef7-8d4f-4f477922ab01",
  tripId = "trip-a",
  motorcycleId = "motorcycle-a",
  companyId = "company-a",
} = {}) {
  db.prepare(`
    INSERT INTO trip_motorcycle_assignments
      (id, request_key, trip_id, motorcycle_id, company_id, assigned_by, assigned_at)
    VALUES (?, ?, ?, ?, ?, 'owner-a', '2026-08-21T03:00:00.000Z')
  `).run(id, requestKey, tripId, motorcycleId, companyId);
}

test("trip assignments fail closed for duplicate, tenant, status and capacity violations", () => {
  const db = createDatabase({ capacity: 1 });
  assign(db);
  assert.throws(() => assign(db, { id: "assignment-duplicate", requestKey: "0198f708-44a3-7ef7-8d4f-4f477922ab02", tripId: "trip-b" }));
  assert.throws(() => assign(db, { id: "assignment-capacity", requestKey: "0198f708-44a3-7ef7-8d4f-4f477922ab03", motorcycleId: "motorcycle-b" }), /available capacity/);
  assert.throws(() => assign(db, { id: "assignment-wrong-company", requestKey: "0198f708-44a3-7ef7-8d4f-4f477922ab04", tripId: "trip-b", motorcycleId: "motorcycle-c", companyId: "company-a" }), /matching company/);
  assert.throws(() => assign(db, { id: "assignment-wrong-status", requestKey: "0198f708-44a3-7ef7-8d4f-4f477922ab05", tripId: "trip-b", motorcycleId: "motorcycle-yard" }), /scheduled motorcycle/);
  assert.throws(() => assign(db, { id: "assignment-request", tripId: "trip-b", motorcycleId: "motorcycle-b" }));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("trip readiness follows audited motorcycle and load assignment states", () => {
  const db = createDatabase();
  assign(db);

  assert.throws(() => db.exec("UPDATE trips SET status = 'LOADING' WHERE id = 'trip-b'"), /readiness/);
  db.exec("UPDATE trips SET status = 'PLANNED' WHERE id = 'trip-a'");
  db.exec("UPDATE trips SET status = 'LOADING' WHERE id = 'trip-a'");
  assert.throws(() => db.exec("UPDATE trips SET status = 'IN_TRANSIT' WHERE id = 'trip-a'"), /readiness/);
  assert.throws(() => db.exec("UPDATE trip_motorcycle_assignments SET state = 'LOADED', loaded_at = '2026-08-21T03:10:00.000Z' WHERE id = 'assignment-a'"), /motorcycle workflow/);

  db.exec("UPDATE motorcycles SET current_status = 'LOADED' WHERE id = 'motorcycle-a'");
  db.exec("UPDATE trip_motorcycle_assignments SET state = 'LOADED', loaded_at = '2026-08-21T03:10:00.000Z' WHERE id = 'assignment-a'");
  assert.throws(() => db.exec("UPDATE trips SET status = 'IN_TRANSIT' WHERE id = 'trip-a'"), /readiness/);
  db.exec("UPDATE motorcycles SET current_status = 'IN_TRANSIT' WHERE id = 'motorcycle-a'");
  db.exec("UPDATE trips SET status = 'IN_TRANSIT' WHERE id = 'trip-a'");

  assert.throws(() => db.exec("UPDATE trips SET status = 'ARRIVED' WHERE id = 'trip-a'"), /readiness/);
  db.exec("UPDATE motorcycles SET current_status = 'ARRIVED' WHERE id = 'motorcycle-a'");
  db.exec("UPDATE trips SET status = 'ARRIVED' WHERE id = 'trip-a'");
  assert.throws(() => db.exec("UPDATE trips SET status = 'COMPLETED' WHERE id = 'trip-a'"), /readiness/);

  db.exec("UPDATE trip_motorcycle_assignments SET state = 'UNLOADED', unloaded_at = '2026-08-21T10:00:00.000Z' WHERE id = 'assignment-a'");
  assert.throws(() => db.exec("UPDATE trips SET status = 'COMPLETED' WHERE id = 'trip-a'"), /readiness/);
  db.exec(`
    INSERT INTO motorcycle_images
      (id, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by)
    VALUES ('delivery-trip-a', 'motorcycle-a', 'company-a', 'delivery-trip-a.jpg', 'DELIVERY', 'image/jpeg', 100, '${"f".repeat(64)}', 'owner-a');
    INSERT INTO proof_of_delivery_records
      (id, request_key, motorcycle_id, company_id, recipient_name, delivery_location, delivered_at, evidence_image_id, received_by)
    VALUES ('pod-trip-a', '0198f708-44a3-7ef7-8d4f-4f477922af01', 'motorcycle-a', 'company-a', 'ผู้รับ', 'Destination B', '2026-08-21T10:05:00.000Z', 'delivery-trip-a', 'owner-a');
  `);
  db.exec("UPDATE motorcycles SET current_status = 'DELIVERED' WHERE id = 'motorcycle-a'");
  db.exec("UPDATE trips SET status = 'COMPLETED' WHERE id = 'trip-a'");
  db.exec("UPDATE trip_motorcycle_assignments SET state = 'RELEASED', released_at = '2026-08-21T10:10:00.000Z', release_reason = 'TRIP_COMPLETED' WHERE id = 'assignment-a'");

  assert.equal(db.prepare("SELECT status FROM trips WHERE id = 'trip-a'").get().status, "COMPLETED");
  assert.equal(db.prepare("SELECT state FROM trip_motorcycle_assignments WHERE id = 'assignment-a'").get().state, "RELEASED");
  assert.throws(() => db.exec("DELETE FROM trip_motorcycle_assignments WHERE id = 'assignment-a'"), /cannot be deleted/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("active load-board query uses the trip assignment index", () => {
  const db = createDatabase();
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM trip_motorcycle_assignments WHERE trip_id = ? AND state = ? ORDER BY assigned_at").all("trip-a", "ASSIGNED").map((row) => String(row.detail)).join(" ");
  assert.match(plan, /idx_trip_assignments_trip_state/);
  db.close();
});
