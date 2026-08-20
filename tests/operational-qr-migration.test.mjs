import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));

function apply(db, path) {
  const sql = readFileSync(path, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
}

test("migration 0018 backfills opaque identities without dropping operational records", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
  for (const name of migrations.filter((entry) => entry < "0018_")) apply(db, `${directory}/${name}`);
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'Company A', 'Company A');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, job_number, company_id, origin, destination, status, created_by)
    VALUES ('job-a', 'JOB-A', 'company-a', 'A', 'B', 'OPEN', 'owner-a');
    INSERT INTO yard_zones (id, code, name, capacity, created_by)
    VALUES ('yard-a', 'A-01', 'Zone A', 20, 'owner-a');
    INSERT INTO trucks (id, request_key, public_id, code, type, created_by)
    VALUES ('truck-a', '0198f708-44a3-7ef7-8d4f-4f477922dd01', 'legacy-truck-public', 'NG-01', 'FOUR_WHEEL', 'owner-a');
    INSERT INTO trips (id, request_key, public_id, trip_number, truck_id, origin, destination, created_by)
    VALUES ('trip-a', '0198f708-44a3-7ef7-8d4f-4f477922dd02', 'legacy-trip-public', 'TRIP-A', 'truck-a', 'A', 'B', 'owner-a');
  `);
  const before = db.prepare("SELECT (SELECT COUNT(*) FROM transport_jobs) jobs, (SELECT COUNT(*) FROM yard_zones) yards, (SELECT COUNT(*) FROM trucks) trucks, (SELECT COUNT(*) FROM trips) trips").get();

  apply(db, `${directory}/${migrations.find((entry) => entry.startsWith("0018_"))}`);

  const after = db.prepare("SELECT (SELECT COUNT(*) FROM transport_jobs) jobs, (SELECT COUNT(*) FROM yard_zones) yards, (SELECT COUNT(*) FROM trucks) trucks, (SELECT COUNT(*) FROM trips) trips").get();
  assert.deepEqual({ ...after }, { ...before });
  assert.match(db.prepare("SELECT public_id FROM transport_jobs WHERE id='job-a'").get().public_id, /^job_[0-9a-f]{32}$/);
  assert.match(db.prepare("SELECT public_id FROM yard_zones WHERE id='yard-a'").get().public_id, /^yard_[0-9a-f]{32}$/);
  assert.match(db.prepare("SELECT public_id FROM trucks WHERE id='truck-a'").get().public_id, /^truck_[0-9a-f]{32}$/);
  assert.match(db.prepare("SELECT public_id FROM trips WHERE id='trip-a'").get().public_id, /^trip_[0-9a-f]{32}$/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("operational public identities are unique, valid, immutable and index-backed", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) apply(db, `${directory}/${name}`);
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company-a', 'CUS-A', 'Company A', 'Company A');
    INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, created_by)
    VALUES ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-A', 'company-a', 'A', 'B', 'owner-a');
    INSERT INTO yard_zones (id, public_id, code, name, created_by)
    VALUES ('yard-a', 'yard_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'A-01', 'Zone A', 'owner-a');
    INSERT INTO trucks (id, request_key, public_id, code, type, created_by)
    VALUES ('truck-a', '0198f708-44a3-7ef7-8d4f-4f477922ee01', 'truck_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'NG-01', 'FOUR_WHEEL', 'owner-a');
    INSERT INTO trips (id, request_key, public_id, trip_number, truck_id, origin, destination, created_by)
    VALUES ('trip-a', '0198f708-44a3-7ef7-8d4f-4f477922ee02', 'trip_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'TRIP-A', 'truck-a', 'A', 'B', 'owner-a');
  `);
  assert.throws(() => db.exec("INSERT INTO transport_jobs (id, job_number, company_id, origin, destination, created_by) VALUES ('job-missing', 'JOB-MISSING', 'company-a', 'A', 'B', 'owner-a')"), /public identity is invalid/);
  assert.throws(() => db.exec("INSERT INTO yard_zones (id, public_id, code, name, created_by) VALUES ('yard-bad', 'yard_not-opaque', 'B-01', 'Bad', 'owner-a')"), /public identity is invalid/);
  assert.throws(() => db.exec("INSERT INTO trucks (id, request_key, public_id, code, type, created_by) VALUES ('truck-bad', '0198f708-44a3-7ef7-8d4f-4f477922ee03', 'truck_not-opaque', 'NG-02', 'FOUR_WHEEL', 'owner-a')"), /public identity is invalid/);
  assert.throws(() => db.exec("INSERT INTO trips (id, request_key, public_id, trip_number, truck_id, origin, destination, created_by) VALUES ('trip-bad', '0198f708-44a3-7ef7-8d4f-4f477922ee04', 'trip_not-opaque', 'TRIP-B', 'truck-a', 'A', 'B', 'owner-a')"), /public identity is invalid/);
  assert.throws(() => db.exec("UPDATE transport_jobs SET public_id='job_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' WHERE id='job-a'"), /immutable/);
  assert.throws(() => db.exec("UPDATE yard_zones SET public_id='yard_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' WHERE id='yard-a'"), /immutable/);
  assert.throws(() => db.exec("UPDATE trucks SET public_id='truck_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' WHERE id='truck-a'"), /immutable/);
  assert.throws(() => db.exec("UPDATE trips SET public_id='trip_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' WHERE id='trip-a'"), /immutable/);
  const jobPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM transport_jobs WHERE public_id=?").all("job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").map((row) => String(row.detail)).join(" ");
  const yardPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM yard_zones WHERE public_id=?").all("yard_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").map((row) => String(row.detail)).join(" ");
  const truckPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM trucks WHERE public_id=?").all("truck_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").map((row) => String(row.detail)).join(" ");
  const tripPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM trips WHERE public_id=?").all("trip_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").map((row) => String(row.detail)).join(" ");
  assert.match(jobPlan, /uq_transport_jobs_public_id/);
  assert.match(yardPlan, /uq_yard_zones_public_id/);
  assert.match(truckPlan, /uq_trucks_public_id/);
  assert.match(tripPlan, /uq_trips_public_id/);
  db.close();
});
