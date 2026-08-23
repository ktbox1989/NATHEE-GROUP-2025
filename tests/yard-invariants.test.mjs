import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The yard is the module whose whole purpose is knowing where every motorcycle
// is. Its rules were enforced only by the SQL in lib/yard-sql.ts, which is
// correct but is not the only way a row can be written: trucks and containers
// both enforce the equivalent rules with triggers, and the yard did not. These
// prove the database now refuses the same mistakes on its own.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));

function migrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ'),
           ('company-b', 'CUS-B', 'บริษัท บี จำกัด', 'บริษัท บี');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
    VALUES ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-001', 'company-a', 'A', 'B', 'OPEN', 'owner-a');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status)
    VALUES ('mc-1', 'mc-1', 'company-a', 'job-a', 1, 'IN_YARD'),
           ('mc-2', 'mc-2', 'company-a', 'job-a', 2, 'IN_YARD'),
           ('mc-3', 'mc-3', 'company-a', 'job-a', 3, 'IN_YARD');
    INSERT INTO yard_zones (id, public_id, code, name, capacity, created_by)
    VALUES ('zone-one', 'yard_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'A-01', 'Zone A', 1, 'owner-a'),
           ('zone-open', 'yard_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'B-01', 'Zone B', NULL, 'owner-a');
    INSERT INTO yard_zones (id, public_id, code, name, status, created_by)
    VALUES ('zone-closed', 'yard_cccccccccccccccccccccccccccccccc', 'C-01', 'Zone C', 'INACTIVE', 'owner-a');
  `);
  return db;
}

const place = (db, id, motorcycleId, zoneId, options = {}) =>
  db.exec(
    `INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, exited_at, placed_by)
     VALUES ('${id}', 'key-${id}', '${motorcycleId}', '${options.companyId ?? "company-a"}', '${zoneId}',
             '${options.enteredAt ?? "2026-08-20T10:00:00.000Z"}',
             ${options.exitedAt ? `'${options.exitedAt}'` : "NULL"}, 'owner-a')`,
  );

test("a zone at capacity refuses another motorcycle", () => {
  const db = migrated();
  place(db, "p1", "mc-1", "zone-one");
  assert.throws(() => place(db, "p2", "mc-2", "zone-one"), /already at capacity/);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM yard_placements WHERE yard_zone_id = 'zone-one' AND exited_at IS NULL").get().n,
    1,
  );
  db.close();
});

test("a zone with no stated capacity holds what it is given", () => {
  const db = migrated();
  place(db, "p1", "mc-1", "zone-open");
  place(db, "p2", "mc-2", "zone-open");
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM yard_placements WHERE yard_zone_id = 'zone-open' AND exited_at IS NULL").get().n,
    2,
  );
  db.close();
});

test("moving a motorcycle out frees the space it held", () => {
  const db = migrated();
  place(db, "p1", "mc-1", "zone-one");
  db.exec("UPDATE yard_placements SET exited_at = '2026-08-21T10:00:00.000Z' WHERE id = 'p1'");
  place(db, "p2", "mc-2", "zone-one");
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM yard_placements WHERE yard_zone_id = 'zone-one' AND exited_at IS NULL").get().n,
    1,
  );
  db.close();
});

// Backfilling history must stay possible: a placement that is already closed
// occupies nothing, so it is not capacity-checked.
test("recording a placement that has already ended does not consume capacity", () => {
  const db = migrated();
  place(db, "p1", "mc-1", "zone-one");
  place(db, "p-old", "mc-2", "zone-one", { exitedAt: "2026-07-01T10:00:00.000Z", enteredAt: "2026-06-01T10:00:00.000Z" });
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM yard_placements WHERE yard_zone_id = 'zone-one' AND exited_at IS NULL").get().n,
    1,
  );
  db.close();
});

test("a zone that is not active cannot take a motorcycle", () => {
  const db = migrated();
  assert.throws(() => place(db, "p1", "mc-1", "zone-closed"), /not active/);
  db.close();
});

// The column is NOT NULL and indexed, which invites a company-scoped query. It
// must therefore agree with the motorcycle it describes.
test("a placement cannot record a company that does not own the motorcycle", () => {
  const db = migrated();
  assert.throws(() => place(db, "p1", "mc-1", "zone-open", { companyId: "company-b" }), /company that owns/);
  db.close();
});

test("a motorcycle is only ever in one place at a time", () => {
  const db = migrated();
  place(db, "p1", "mc-1", "zone-open");
  assert.throws(() => place(db, "p2", "mc-1", "zone-open"), /UNIQUE|constraint/i);
  db.close();
});

test("where a motorcycle was cannot be rewritten, only when it left", () => {
  const db = migrated();
  place(db, "p1", "mc-1", "zone-open");
  for (const change of [
    "motorcycle_id = 'mc-2'",
    "company_id = 'company-b'",
    "yard_zone_id = 'zone-one'",
    "entered_at = '2020-01-01T00:00:00.000Z'",
    "request_key = 'rewritten'",
  ]) {
    assert.throws(() => db.exec(`UPDATE yard_placements SET ${change} WHERE id = 'p1'`), /only its exit may be set/, change);
  }
  db.exec("UPDATE yard_placements SET exited_at = '2026-08-22T10:00:00.000Z' WHERE id = 'p1'");
  assert.equal(db.prepare("SELECT exited_at FROM yard_placements WHERE id = 'p1'").get().exited_at, "2026-08-22T10:00:00.000Z");
  db.close();
});

test("locating a motorcycle stays index-backed", () => {
  const db = migrated();
  place(db, "p1", "mc-1", "zone-open");
  const plan = db
    .prepare("EXPLAIN QUERY PLAN SELECT yard_zone_id FROM yard_placements WHERE motorcycle_id = ? AND exited_at IS NULL")
    .all()
    .map((row) => row.detail)
    .join(" ");
  assert.match(plan, /uq_yard_placements_motorcycle_active|idx_yard_placements_motorcycle_entered/);
  db.close();
});
