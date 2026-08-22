import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The OWNER bootstrap is the one privileged write that happens outside the
// application, against a live Production database, by hand. It therefore has to
// be proven against the real migrated schema rather than reviewed by eye.

const GENERATOR = fileURLToPath(new URL("../scripts/generate-owner-bootstrap.mjs", import.meta.url));

const AUTH_ID = "3f2b9c1a-7d4e-4a6b-9c3d-1e2f3a4b5c6d";
const OTHER_AUTH_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const EMAIL = "owner@natheegroup2025.test";
const DISPLAY_NAME = "คุณเจ้าของ NATHEE";

function createMigratedDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  for (const name of readdirSync(migrationDirectory).filter((entry) => entry.endsWith(".sql")).sort()) {
    const sql = readFileSync(`${migrationDirectory}/${name}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  return db;
}

function generateBootstrapSql(options = {}) {
  return execFileSync(
    process.execPath,
    [
      GENERATOR,
      "--auth-id", options.authId ?? AUTH_ID,
      "--email", options.email ?? EMAIL,
      "--display-name", options.displayName ?? DISPLAY_NAME,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

// Mirrors the effective-role resolution in lib/current-actor.ts, so the test
// proves the runtime would actually see this identity as OWNER.
function resolveEffectiveRole(db, authId) {
  return db
    .prepare(
      `SELECT u.id AS id, u.status AS status,
              COALESCE(r.role, CASE u.role WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) AS effective_role
       FROM users u
       LEFT JOIN user_role_assignments r ON r.user_id = u.id
       WHERE u.external_auth_id = ? AND u.status = 'ACTIVE'`,
    )
    .get(authId);
}

function counts(db) {
  return {
    users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    roles: db.prepare("SELECT COUNT(*) AS count FROM user_role_assignments").get().count,
    audits: db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'BOOTSTRAP_OWNER_IDENTITY'").get().count,
  };
}

test("bootstrap SQL creates a resolvable canonical OWNER on the real schema", () => {
  const db = createMigratedDatabase();
  db.exec(generateBootstrapSql());

  const actor = resolveEffectiveRole(db, AUTH_ID);
  assert.ok(actor, "the bootstrapped identity must resolve");
  assert.equal(actor.effective_role, "OWNER");
  assert.equal(actor.status, "ACTIVE");

  const stored = db.prepare("SELECT email, display_name, role FROM users WHERE external_auth_id = ?").get(AUTH_ID);
  assert.equal(stored.email, EMAIL, "the email must be stored normalised");
  assert.equal(stored.display_name, DISPLAY_NAME, "Thai display names must survive intact");
  assert.equal(stored.role, "OWNER", "the legacy role column must stay consistent");

  // The role system treats user_role_assignments as authoritative, so the
  // bootstrap must write it rather than depend on the legacy fallback.
  const assignment = db.prepare("SELECT role FROM user_role_assignments WHERE user_id = ?").get(actor.id);
  assert.equal(assignment.role, "OWNER");

  const audit = db
    .prepare("SELECT actor_user_id, entity_type, after_json FROM audit_logs WHERE action = 'BOOTSTRAP_OWNER_IDENTITY'")
    .get();
  assert.ok(audit, "creating the first privileged identity must be audited");
  assert.equal(audit.actor_user_id, actor.id);
  assert.equal(audit.entity_type, "user");
  assert.equal(JSON.parse(audit.after_json).externalAuthId, AUTH_ID);

  db.close();
});

test("re-running the same bootstrap changes nothing", () => {
  const db = createMigratedDatabase();
  const sql = generateBootstrapSql();
  db.exec(sql);
  const first = counts(db);

  db.exec(sql);
  assert.deepEqual(counts(db), first, "a repeated run must be a no-op");

  // A freshly generated file carries new random ids; it must still be a no-op.
  db.exec(generateBootstrapSql());
  assert.deepEqual(counts(db), first, "a regenerated file must not create a second OWNER");

  db.close();
});

test("bootstrap refuses to rebind an email that already belongs to someone else", () => {
  const db = createMigratedDatabase();
  db.exec(generateBootstrapSql());
  const before = counts(db);

  // Same email, different Supabase identity: the existing account must not be
  // silently rebound, and no second user may appear.
  db.exec(generateBootstrapSql({ authId: OTHER_AUTH_ID }));

  assert.deepEqual(counts(db), before, "a conflicting identity must not change anything");
  assert.equal(resolveEffectiveRole(db, OTHER_AUTH_ID), undefined, "the conflicting identity must not resolve");
  assert.equal(resolveEffectiveRole(db, AUTH_ID).effective_role, "OWNER", "the original OWNER must survive");

  db.close();
});

test("bootstrap refuses to reuse an identity already mapped to another account", () => {
  const db = createMigratedDatabase();
  db.exec(generateBootstrapSql());
  const before = counts(db);

  // Same Supabase identity, different email.
  db.exec(generateBootstrapSql({ email: "someone-else@natheegroup2025.test" }));

  assert.deepEqual(counts(db), before, "an already-mapped identity must not be duplicated");
  assert.equal(
    db.prepare("SELECT email FROM users WHERE external_auth_id = ?").get(AUTH_ID).email,
    EMAIL,
    "the original email mapping must be unchanged",
  );

  db.close();
});

test("a second distinct owner can still be bootstrapped deliberately", () => {
  const db = createMigratedDatabase();
  db.exec(generateBootstrapSql());
  db.exec(generateBootstrapSql({ authId: OTHER_AUTH_ID, email: "second-owner@natheegroup2025.test", displayName: "Second Owner" }));

  assert.equal(resolveEffectiveRole(db, AUTH_ID).effective_role, "OWNER");
  assert.equal(resolveEffectiveRole(db, OTHER_AUTH_ID).effective_role, "OWNER");
  assert.equal(counts(db).audits, 2, "each bootstrap must leave its own audit record");

  db.close();
});

test("the generator rejects input the runtime could not resolve", () => {
  const rejected = [
    ["--auth-id", "not-a-uuid", "--email", EMAIL, "--display-name", DISPLAY_NAME],
    ["--auth-id", AUTH_ID, "--email", "missing-at-sign", "--display-name", DISPLAY_NAME],
    ["--auth-id", AUTH_ID, "--email", EMAIL, "--display-name", "X"],
    ["--auth-id", AUTH_ID, "--email", EMAIL, "--display-name", "Name\u0000injected"],
    ["--auth-id", AUTH_ID, "--email", EMAIL, "--display-name", DISPLAY_NAME, "--unexpected", "1"],
  ];

  for (const args of rejected) {
    assert.throws(
      () => execFileSync(process.execPath, [GENERATOR, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      `expected rejection for: ${args.join(" ")}`,
    );
  }
});

test("a quoted display name cannot inject SQL", () => {
  const db = createMigratedDatabase();
  const hostileName = "O'Brien'); DROP TABLE users; --";
  db.exec(generateBootstrapSql({ displayName: hostileName }));

  assert.equal(
    db.prepare("SELECT display_name FROM users WHERE external_auth_id = ?").get(AUTH_ID).display_name,
    hostileName,
    "the name must be stored literally, not executed",
  );
  assert.ok(
    db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'users'").get(),
    "the users table must still exist",
  );

  db.close();
});
