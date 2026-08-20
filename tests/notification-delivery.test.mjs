import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { STATUS_NOTIFICATION_INSERT_SQL } from "../lib/notification-sql.ts";

function applyMigration(db, path) {
  const sql = readFileSync(path, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
}

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  for (const migration of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    applyMigration(db, `${directory}/${migration}`);
  }
  return db;
}

test("a status event notifies only authorized active recipients and owning-company customers", () => {
  const db = createDatabase();
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES
      ('company-a', 'A', 'บริษัท เอ จำกัด', 'บริษัท เอ'),
      ('company-b', 'B', 'บริษัท บี จำกัด', 'บริษัท บี');
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status) VALUES
      ('owner-a', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER', NULL, 'ACTIVE'),
      ('staff-a', 'auth-staff', 'staff@example.test', 'Staff', 'STAFF', NULL, 'ACTIVE'),
      ('customer-a', 'auth-a', 'a@example.test', 'Customer A', 'CUSTOMER', 'company-a', 'ACTIVE'),
      ('customer-b', 'auth-b', 'b@example.test', 'Customer B', 'CUSTOMER', 'company-b', 'ACTIVE'),
      ('customer-inactive', 'auth-i', 'i@example.test', 'Inactive', 'CUSTOMER', 'company-a', 'INACTIVE');
    INSERT INTO user_role_assignments (user_id, role, assigned_by) VALUES
      ('owner-a', 'OWNER', 'owner-a'),
      ('staff-a', 'STAFF', 'owner-a'),
      ('customer-a', 'CUSTOMER_ADMIN', 'owner-a'),
      ('customer-b', 'CUSTOMER_VIEWER', 'owner-a'),
      ('customer-inactive', 'CUSTOMER_VIEWER', 'owner-a');
    INSERT INTO user_permissions (user_id, permission, granted_by)
    VALUES ('staff-a', 'status:read', 'owner-a');
    INSERT INTO transport_jobs (id, job_number, company_id, origin, destination, status, created_by)
    VALUES ('job-a', 'JOB-A', 'company-a', 'กรุงเทพฯ', 'เชียงใหม่', 'OPEN', 'owner-a');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status)
    VALUES ('motorcycle-a', 'mc_public_a', 'company-a', 'job-a', 1, 'IN_TRANSIT');
    INSERT INTO status_events
      (id, motorcycle_id, company_id, previous_status, new_status, created_by)
    VALUES ('event-a', 'motorcycle-a', 'company-a', 'LOADED', 'IN_TRANSIT', 'owner-a');
  `);

  const statement = db.prepare(STATUS_NOTIFICATION_INSERT_SQL);
  const values = [
    "event-a", "INFO", "สถานะรถมีการอัปเดต", "mc_public_a · กำลังขนส่ง",
    "/app/motorcycles/motorcycle-a", "2026-08-21T12:00:00.000Z", "event-a",
  ];
  assert.equal(statement.run(...values).changes, 2);
  assert.equal(statement.run(...values).changes, 0);

  assert.deepEqual(
    db.prepare("SELECT recipient_user_id, company_id, source_event_id FROM notifications ORDER BY recipient_user_id").all().map((row) => ({ ...row })),
    [
      { recipient_user_id: "customer-a", company_id: "company-a", source_event_id: "event-a" },
      { recipient_user_id: "staff-a", company_id: "company-a", source_event_id: "event-a" },
    ],
  );
  const notificationId = db.prepare("SELECT id FROM notifications WHERE recipient_user_id = 'customer-a'").get().id;
  assert.equal(
    db.prepare("UPDATE notifications SET read_at = '2026-08-21T12:05:00.000Z' WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL").run(notificationId, "customer-b").changes,
    0,
  );
  assert.equal(
    db.prepare("UPDATE notifications SET read_at = '2026-08-21T12:05:00.000Z' WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL").run(notificationId, "customer-a").changes,
    1,
  );
  assert.throws(() => db.exec(`
    INSERT INTO notifications
      (id, idempotency_key, recipient_user_id, company_id, source_event_id, type, title, body, href)
    VALUES
      ('bad', 'bad', 'customer-a', 'company-a', 'event-a', 'MOTORCYCLE_STATUS_CHANGED', 'Bad', 'Bad', 'https://attacker.example')
  `));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("unread notification lookup uses the bounded recipient index", () => {
  const db = createDatabase();
  const plan = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT id FROM notifications
    WHERE recipient_user_id = ? AND read_at IS NULL
    ORDER BY created_at DESC LIMIT 51
  `).all("customer-a").map((row) => String(row.detail)).join(" ");
  assert.match(plan, /idx_notifications_recipient_unread/);
  db.close();
});
