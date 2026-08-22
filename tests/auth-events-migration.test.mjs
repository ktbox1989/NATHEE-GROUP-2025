import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AUTH_EVENT_ENTITY_TYPE, authEventDetail } from "../lib/auth-events.ts";
import {
  RECORD_AUTH_EVENT_SQL,
  RECORD_SIGN_IN_SQL,
  recordAuthEventParams,
  recordSignInParams,
} from "../lib/auth-events-sql.ts";
import { auditViewActions } from "../lib/audit-view.ts";
import { recordTimestamp } from "../lib/timestamps.ts";

// These rows are written on an unauthenticated request path, so what matters is
// not only that they appear but that a stranger cannot cause them, and that the
// Owner can trust what they say about the account.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const ACTIVE_AUTH_ID = "3f2b9c1a-7d4e-4a6b-9c3d-1e2f3a4b5c6d";
const INACTIVE_AUTH_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const UNKNOWN_AUTH_ID = "11111111-2222-4333-8444-555555555555";
const AT = recordTimestamp(new Date("2026-08-23T03:12:00.000Z"));

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
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status)
    VALUES ('owner-a', '${ACTIVE_AUTH_ID}', 'owner@example.test', 'Owner', 'OWNER', NULL, 'ACTIVE');
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status)
    VALUES ('customer-a', '${INACTIVE_AUTH_ID}', 'gone@example.test', 'อดีตลูกค้า', 'CUSTOMER', 'company-a', 'INACTIVE');
  `);
  return db;
}

function signIn(db, auditId, authId, at = AT) {
  return db.prepare(RECORD_SIGN_IN_SQL).run(...recordSignInParams(auditId, "password", at, authId));
}

function events(db) {
  return db
    .prepare("SELECT id, actor_user_id, company_id, action, entity_type, entity_id, after_json, created_at FROM audit_logs ORDER BY created_at DESC, id DESC")
    .all();
}

test("a sign-in is recorded against the application user, not the provider identity", () => {
  const db = migrated();
  signIn(db, "audit-signin", ACTIVE_AUTH_ID);
  const [row] = events(db);
  assert.equal(row.action, "SIGN_IN");
  assert.equal(row.actor_user_id, "owner-a");
  assert.equal(row.entity_type, AUTH_EVENT_ENTITY_TYPE);
  assert.equal(row.entity_id, "owner-a");
  assert.equal(row.after_json, authEventDetail("password"));
  assert.equal(row.created_at, AT);
  assert.equal(row.company_id, null);
  db.close();
});

test("valid credentials for a deactivated account are recorded as a refusal", () => {
  const db = migrated();
  signIn(db, "audit-denied", INACTIVE_AUTH_ID);
  const [row] = events(db);
  assert.equal(row.action, "SIGN_IN_DENIED");
  assert.equal(row.actor_user_id, "customer-a");
  assert.equal(row.company_id, "company-a", "a customer event stays attributed to its company");
  db.close();
});

test("an identity with no application user writes nothing at all", () => {
  const db = migrated();
  const result = signIn(db, "audit-unknown", UNKNOWN_AUTH_ID);
  assert.equal(result.changes, 0);
  assert.equal(events(db).length, 0, "a stranger at the identity provider cannot grow the Audit table");
  db.close();
});

test("the status is read at write time, so a reactivated account records correctly", () => {
  const db = migrated();
  signIn(db, "audit-before", INACTIVE_AUTH_ID);
  db.exec("UPDATE users SET status = 'ACTIVE' WHERE id = 'customer-a'");
  signIn(db, "audit-after", INACTIVE_AUTH_ID, recordTimestamp(new Date("2026-08-23T04:00:00.000Z")));
  const actions = events(db).map((row) => `${row.id}:${row.action}`);
  assert.deepEqual(actions, ["audit-after:SIGN_IN", "audit-before:SIGN_IN_DENIED"]);
  db.close();
});

test("a completed password change records how it was proved", () => {
  const db = migrated();
  db.prepare(RECORD_AUTH_EVENT_SQL).run(
    ...recordAuthEventParams("audit-recovery", "PASSWORD_CHANGED", "recovery_link", AT, ACTIVE_AUTH_ID),
  );
  db.prepare(RECORD_AUTH_EVENT_SQL).run(
    ...recordAuthEventParams(
      "audit-current",
      "PASSWORD_CHANGED",
      "current_password",
      recordTimestamp(new Date("2026-08-23T05:00:00.000Z")),
      ACTIVE_AUTH_ID,
    ),
  );
  const rows = events(db);
  assert.deepEqual(rows.map((row) => row.action), ["PASSWORD_CHANGED", "PASSWORD_CHANGED"]);
  assert.deepEqual(
    rows.map((row) => JSON.parse(row.after_json).method),
    ["current_password", "recovery_link"],
  );
  db.close();
});

test("auth events interleave with business events in true chronological order", () => {
  const db = migrated();
  db.prepare(
    "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, created_at) VALUES (?, 'owner-a', 'UPDATE_ACCESS', 'user', 'customer-a', ?)",
  ).run("audit-role-change", recordTimestamp(new Date("2026-08-23T03:20:00.000Z")));
  signIn(db, "audit-signin", ACTIVE_AUTH_ID);

  assert.deepEqual(
    events(db).map((row) => row.id),
    ["audit-role-change", "audit-signin"],
    "the sign-in at 03:12 must precede the role change at 03:20",
  );
  db.close();
});

test("nothing the caller supplies reaches the stored row", () => {
  const db = migrated();
  // The only caller-influenced value is the provider identity, and it is matched,
  // never stored: the row's identifiers all come from the users table.
  signIn(db, "audit-injection", ACTIVE_AUTH_ID);
  const [row] = events(db);
  assert.equal(row.after_json, '{"method":"password"}');
  assert.ok(!row.after_json.includes(ACTIVE_AUTH_ID), "the provider identity is matched, never stored");
  assert.equal(row.entity_id, "owner-a", "the row identifies the application user, not the provider identity");
  assert.notEqual(row.entity_id, ACTIVE_AUTH_ID);
  db.close();
});

test("the trail cannot be edited or erased once written", () => {
  const db = migrated();
  signIn(db, "audit-signin", ACTIVE_AUTH_ID);
  assert.throws(
    () => db.prepare("UPDATE audit_logs SET action = 'NOTHING_HAPPENED' WHERE id = 'audit-signin'").run(),
    /cannot be modified/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM audit_logs WHERE id = 'audit-signin'").run(),
    /cannot be deleted/,
  );
  const [row] = events(db);
  assert.equal(row.action, "SIGN_IN");
  assert.equal(events(db).length, 1);
  db.close();
});

test("migration 0024 preserves the audit history that already exists", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const all = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
  for (const name of all.filter((entry) => entry < "0024_")) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', '${ACTIVE_AUTH_ID}', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, created_at)
    VALUES ('legacy-entry', 'owner-a', 'CREATE', 'company', 'company-a', '2026-08-01 09:00:00');
  `);

  const migration = all.find((entry) => entry.startsWith("0024_"));
  assert.ok(migration, "migration 0024 is required");
  for (const statement of readFileSync(`${directory}/${migration}`, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }

  assert.equal(db.prepare("SELECT count(*) total FROM audit_logs").get().total, 1);
  assert.throws(() => db.exec("DELETE FROM audit_logs WHERE id = 'legacy-entry'"), /cannot be deleted/);
  // New entries are still accepted; only rewriting history is refused.
  signIn(db, "audit-after-migration", ACTIVE_AUTH_ID);
  assert.equal(db.prepare("SELECT count(*) total FROM audit_logs").get().total, 2);
  db.close();
});

// --- filtered views -------------------------------------------------------

function auditRow(db, id, action, entityType, at) {
  db.prepare(
    "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, created_at) VALUES (?, 'owner-a', ?, ?, 'owner-a', ?)",
  ).run(id, action, entityType, at);
}

function seedMixedTrail(db) {
  const at = (minute) => recordTimestamp(new Date(Date.UTC(2026, 7, 23, 10, minute, 0)));
  auditRow(db, "e1-signin", "SIGN_IN", "session", at(1));
  auditRow(db, "e2-create", "CREATE", "company", at(2));
  auditRow(db, "e3-denied", "SIGN_IN_DENIED", "session", at(3));
  auditRow(db, "e4-access", "UPDATE_ACCESS", "user", at(4));
  auditRow(db, "e5-status", "STATUS_CHANGE", "motorcycle", at(5));
  auditRow(db, "e6-password", "PASSWORD_CHANGED", "session", at(6));
  auditRow(db, "e7-invite", "INVITE", "user", at(7));
  return at;
}

// Exactly the shape app/app/audit/page.tsx issues for a filtered view.
function filteredPage(db, actions, limit = 51, cursor = null) {
  const placeholders = actions.map(() => "?").join(", ");
  const cursorClause = cursor
    ? " AND (created_at < ? OR (created_at = ? AND id < ?))"
    : "";
  const params = cursor
    ? [...actions, cursor.createdAt, cursor.createdAt, cursor.id, limit]
    : [...actions, limit];
  return db
    .prepare(
      `SELECT id, created_at FROM audit_logs WHERE action IN (${placeholders})${cursorClause} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...params);
}

test("the sign-in view returns only authentication events, newest first", () => {
  const db = migrated();
  seedMixedTrail(db);
  const actions = [...(auditViewActions("auth") ?? [])];
  assert.deepEqual(
    filteredPage(db, actions).map((row) => row.id),
    ["e6-password", "e3-denied", "e1-signin"],
  );
  db.close();
});

test("the access view returns only the actions that change who can do what", () => {
  const db = migrated();
  seedMixedTrail(db);
  const actions = [...(auditViewActions("access") ?? [])];
  assert.deepEqual(
    filteredPage(db, actions).map((row) => row.id),
    ["e7-invite", "e4-access"],
  );
  db.close();
});

test("a filtered view is served by its own index rather than scanning the trail", () => {
  const db = migrated();
  seedMixedTrail(db);
  const actions = [...(auditViewActions("auth") ?? [])];
  const placeholders = actions.map(() => "?").join(", ");
  const plan = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM audit_logs WHERE action IN (${placeholders}) ORDER BY created_at DESC, id DESC LIMIT 51`,
    )
    .all(...actions)
    .map((row) => String(row.detail))
    .join(" ");
  assert.match(plan, /idx_audit_logs_action_created/);
  assert.doesNotMatch(plan, /SCAN audit_logs(?! USING)/);
  db.close();
});

test("keyset pagination inside a filtered view walks the same order without repeating", () => {
  const db = migrated();
  const at = seedMixedTrail(db);
  for (let extra = 0; extra < 3; extra += 1) {
    auditRow(db, `e8-signin-${extra}`, "SIGN_IN", "session", at(10 + extra));
  }
  const actions = [...(auditViewActions("auth") ?? [])];

  const first = filteredPage(db, actions, 3);
  assert.deepEqual(first.map((row) => row.id), ["e8-signin-2", "e8-signin-1", "e8-signin-0"]);

  const cursor = { createdAt: first.at(-1).created_at, id: first.at(-1).id };
  const second = filteredPage(db, actions, 3, cursor);
  assert.deepEqual(second.map((row) => row.id), ["e6-password", "e3-denied", "e1-signin"]);

  const seen = new Set([...first, ...second].map((row) => row.id));
  assert.equal(seen.size, 6, "no row appears on two pages");
  db.close();
});

test("migration 0025 adds only its index and preserves the trail", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const all = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
  for (const name of all.filter((entry) => entry < "0025_")) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', '${ACTIVE_AUTH_ID}', 'owner@example.test', 'Owner', 'OWNER');
  `);
  auditRow(db, "before-index", "SIGN_IN", "session", recordTimestamp(new Date("2026-08-01T09:00:00.000Z")));

  const migration = all.find((entry) => entry.startsWith("0025_"));
  assert.ok(migration, "migration 0025 is required");
  for (const statement of readFileSync(`${directory}/${migration}`, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }

  assert.equal(db.prepare("SELECT count(*) total FROM audit_logs").get().total, 1);
  assert.deepEqual(
    filteredPage(db, [...(auditViewActions("auth") ?? [])]).map((row) => row.id),
    ["before-index"],
  );
  db.close();
});
