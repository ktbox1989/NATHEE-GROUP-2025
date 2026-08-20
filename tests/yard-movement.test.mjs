import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CLOSE_ACTIVE_YARD_PLACEMENT_FOR_MOVE_SQL, insertYardPlacementSql } from "../lib/yard-sql.ts";

function createDatabase() {
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
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
    VALUES ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-001', 'company-a', 'A', 'B', 'OPEN', 'owner-a');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status)
    VALUES
      ('motorcycle-a', 'mc-a', 'company-a', 'job-a', 1, 'IN_YARD'),
      ('motorcycle-b', 'mc-b', 'company-a', 'job-a', 2, 'IN_YARD');
    INSERT INTO yard_zones (id, public_id, code, name, capacity, created_by)
    VALUES
      ('zone-a', 'yard_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'A-01', 'Zone A', 1, 'owner-a'),
      ('zone-b', 'yard_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'B-01', 'Zone B', 1, 'owner-a');
    INSERT INTO yard_placements
      (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by)
    VALUES
      ('placement-a', 'request-a', 'motorcycle-a', 'company-a', 'zone-a', '2026-08-20T10:00:00.000Z', 'owner-a'),
      ('placement-b', 'request-b', 'motorcycle-b', 'company-a', 'zone-b', '2026-08-20T10:00:00.000Z', 'owner-a');
  `);
  return db;
}

test("a full destination never closes the current yard placement", () => {
  const db = createDatabase();
  const now = "2026-08-20T11:00:00.000Z";
  const closed = db.prepare(CLOSE_ACTIVE_YARD_PLACEMENT_FOR_MOVE_SQL).run(now, "placement-a", "motorcycle-a", "zone-b");
  const inserted = db.prepare(insertYardPlacementSql(true)).run(
    "placement-new", "request-new", "motorcycle-a", "company-a", now, "owner-a", null,
    "zone-b", "motorcycle-a", "placement-a", now,
  );
  assert.equal(closed.changes, 0);
  assert.equal(inserted.changes, 0);
  assert.deepEqual(
    db.prepare("SELECT yard_zone_id FROM yard_placements WHERE motorcycle_id = ? AND exited_at IS NULL").all("motorcycle-a").map((row) => row.yard_zone_id),
    ["zone-a"],
  );
  db.close();
});

test("a valid move closes history and creates exactly one active placement", () => {
  const db = createDatabase();
  db.exec("UPDATE yard_placements SET exited_at = '2026-08-20T10:30:00.000Z' WHERE id = 'placement-b'");
  const now = "2026-08-20T11:00:00.000Z";
  db.exec("BEGIN IMMEDIATE");
  const closed = db.prepare(CLOSE_ACTIVE_YARD_PLACEMENT_FOR_MOVE_SQL).run(now, "placement-a", "motorcycle-a", "zone-b");
  const inserted = db.prepare(insertYardPlacementSql(true)).run(
    "placement-new", "request-new", "motorcycle-a", "company-a", now, "owner-a", "ย้ายโซน",
    "zone-b", "motorcycle-a", "placement-a", now,
  );
  db.exec("COMMIT");
  assert.equal(closed.changes, 1);
  assert.equal(inserted.changes, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM yard_placements WHERE motorcycle_id = ? AND exited_at IS NULL").get("motorcycle-a").total, 1);
  assert.equal(db.prepare("SELECT yard_zone_id FROM yard_placements WHERE motorcycle_id = ? AND exited_at IS NULL").get("motorcycle-a").yard_zone_id, "zone-b");
  db.close();
});

test("duplicate request keys roll back a partially started move", () => {
  const db = createDatabase();
  db.exec("UPDATE yard_placements SET exited_at = '2026-08-20T10:30:00.000Z' WHERE id = 'placement-b'");
  const now = "2026-08-20T11:00:00.000Z";
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(CLOSE_ACTIVE_YARD_PLACEMENT_FOR_MOVE_SQL).run(now, "placement-a", "motorcycle-a", "zone-b");
    db.prepare(insertYardPlacementSql(true)).run(
      "placement-new", "request-a", "motorcycle-a", "company-a", now, "owner-a", null,
      "zone-b", "motorcycle-a", "placement-a", now,
    );
    assert.fail("duplicate request key should fail");
  } catch {
    db.exec("ROLLBACK");
  }
  assert.equal(db.prepare("SELECT exited_at FROM yard_placements WHERE id = 'placement-a'").get().exited_at, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM yard_placements WHERE motorcycle_id = ? AND exited_at IS NULL").get("motorcycle-a").total, 1);
  db.close();
});
