import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { eventTimestamp, recordTimestamp } from "../lib/timestamps.ts";

// The Owner's Audit page orders by created_at and pages through it with a keyset
// cursor. That only works if every row in the column uses one representation.
// These run against the real migrated schema, because the representation that
// matters is the one SQLite's own default writes.

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
    INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
  `);
  return db;
}

function insertAudit(db, id, createdAt) {
  if (createdAt === undefined) {
    db.prepare("INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id) VALUES (?, 'owner-a', 'CREATE', 'company', 'company-a')").run(id);
    return;
  }
  db.prepare("INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, created_at) VALUES (?, 'owner-a', 'UPDATE_ACCESS', 'user', 'owner-a', ?)").run(id, createdAt);
}

// Exactly the query app/app/audit/page.tsx issues.
function newestFirst(db) {
  return db
    .prepare("SELECT id FROM audit_logs ORDER BY created_at DESC, id DESC")
    .all()
    .map((row) => row.id);
}

test("the column default and recordTimestamp() produce the same representation", () => {
  const db = migrated();
  insertAudit(db, "defaulted");
  insertAudit(db, "explicit", recordTimestamp());
  const [defaulted, explicit] = db
    .prepare("SELECT created_at FROM audit_logs ORDER BY id")
    .all()
    .map((row) => row.created_at);
  assert.match(defaulted, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(explicit.length, defaulted.length);
  assert.equal(explicit[10], defaulted[10], "the date and time must be joined the same way");
  db.close();
});

test("an ISO write breaks the Audit page's order within a single day", () => {
  const db = migrated();
  // 23:59 written the way the column default writes it.
  insertAudit(db, "late-defaulted", "2026-08-23 23:59:00");
  // 00:00 written the way the raw-SQL routes used to write it.
  insertAudit(db, "early-iso", eventTimestamp(new Date("2026-08-23T00:00:01.000Z")));
  assert.deepEqual(
    newestFirst(db),
    ["early-iso", "late-defaulted"],
    "this is the defect: the earlier event is shown first",
  );
  db.close();
});

test("written through the contract, the same two events order correctly", () => {
  const db = migrated();
  insertAudit(db, "late", recordTimestamp(new Date("2026-08-23T23:59:00.000Z")));
  insertAudit(db, "early", recordTimestamp(new Date("2026-08-23T00:00:01.000Z")));
  assert.deepEqual(newestFirst(db), ["late", "early"]);
  db.close();
});

test("a defaulted row and an explicit row interleave by time, not by writer", () => {
  const db = migrated();
  insertAudit(db, "b-explicit-earliest", recordTimestamp(new Date("2026-08-23T01:00:00.000Z")));
  insertAudit(db, "c-explicit-latest", recordTimestamp(new Date("2026-08-23T03:00:00.000Z")));
  insertAudit(db, "a-explicit-middle", recordTimestamp(new Date("2026-08-23T02:00:00.000Z")));
  assert.deepEqual(newestFirst(db), ["c-explicit-latest", "a-explicit-middle", "b-explicit-earliest"]);
  db.close();
});

test("keyset pagination stays index-backed and walks the true order", () => {
  const db = migrated();
  const stamps = [];
  for (let minute = 0; minute < 5; minute += 1) {
    const at = recordTimestamp(new Date(Date.UTC(2026, 7, 23, 10, minute, 0)));
    stamps.push(at);
    insertAudit(db, `event-${minute}`, at);
  }

  const plan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM audit_logs WHERE created_at < ? ORDER BY created_at DESC, id DESC LIMIT 3",
    )
    .all(stamps[4])
    .map((row) => String(row.detail))
    .join(" ");
  assert.match(plan, /idx_audit_logs_created_id/);

  const page = db
    .prepare("SELECT id FROM audit_logs WHERE created_at < ? ORDER BY created_at DESC, id DESC LIMIT 3")
    .all(stamps[4])
    .map((row) => row.id);
  assert.deepEqual(page, ["event-3", "event-2", "event-1"]);
  db.close();
});

test("real-world instants keep the ISO form their CHECK constraints compare", () => {
  const db = migrated();
  db.exec(`
    INSERT INTO yard_zones (id, public_id, code, name, status, created_by)
    VALUES ('zone-a', 'yard_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'A-01', 'โซน A', 'ACTIVE', 'owner-a');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
    VALUES ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-2026-000001', 'company-a', 'กรุงเทพฯ', 'เชียงใหม่', 'OPEN', 'owner-a');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, vin, engine_number, current_status)
    VALUES ('mc-a', 'mc_public_a', 'company-a', 'job-a', 1, 'VIN-0001', 'ENG-0001', 'IN_YARD');
  `);

  const enteredAt = eventTimestamp(new Date("2026-08-23T01:00:00.000Z"));
  const exitedAt = eventTimestamp(new Date("2026-08-23T05:00:00.000Z"));
  db.prepare(
    "INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by) VALUES ('p-a', 'yard-a', 'mc-a', 'company-a', 'zone-a', ?, 'owner-a')",
  ).run(enteredAt);
  db.prepare("UPDATE yard_placements SET exited_at = ? WHERE id = 'p-a'").run(exitedAt);
  assert.equal(db.prepare("SELECT exited_at FROM yard_placements WHERE id = 'p-a'").get().exited_at, exitedAt);

  // ck_yard_placements_time_order compares these two columns as text. A later
  // exit written in the record form would be rejected against an ISO entry,
  // which is why the two representations are not interchangeable.
  db.prepare(
    "INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by) VALUES ('p-b', 'yard-b', 'mc-a', 'company-a', 'zone-a', ?, 'owner-a')",
  ).run(enteredAt);
  assert.throws(
    () =>
      db
        .prepare("UPDATE yard_placements SET exited_at = ? WHERE id = 'p-b'")
        .run(recordTimestamp(new Date("2026-08-23T05:00:00.000Z"))),
    /CHECK|constraint/i,
  );
  db.close();
});
