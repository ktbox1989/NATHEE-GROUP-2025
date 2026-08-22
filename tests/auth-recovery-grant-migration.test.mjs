import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createRecoveryGrantToken,
  recoveryGrantDigest,
  RECOVERY_GRANT_CLEANUP_LIMIT,
  RECOVERY_GRANT_RETENTION_MS,
  RECOVERY_GRANT_TTL_MS,
} from "../lib/auth-recovery-grant.ts";
import {
  CLEANUP_RECOVERY_GRANTS_SQL,
  cleanupRecoveryGrantsParams,
  CONSUME_RECOVERY_GRANT_SQL,
  consumeRecoveryGrantParams,
  ISSUE_RECOVERY_GRANT_SQL,
  issueRecoveryGrantParams,
  PEEK_RECOVERY_GRANT_SQL,
  peekRecoveryGrantParams,
  SUPERSEDE_RECOVERY_GRANTS_SQL,
  supersedeRecoveryGrantsParams,
} from "../lib/auth-recovery-grant-sql.ts";

// A grant is the only thing that lets a password be changed without knowing the
// old one. Single use, expiry and identity binding are the whole control, and
// all three are enforced by one conditional UPDATE, so they are proven here
// against the real migrated schema.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const AUTH_ID = "3f2b9c1a-7d4e-4a6b-9c3d-1e2f3a4b5c6d";
const OTHER_AUTH_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

function apply(db, path) {
  for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
}

function migrations() {
  return readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
}

function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of migrations()) apply(db, `${directory}/${name}`);
  return db;
}

function digest(label) {
  return createHash("sha256").update(label).digest("hex");
}

// Mirrors lib/auth-recovery-grant-store.ts against a synchronous database.
function issue(db, grantDigest, externalAuthId, now) {
  db.prepare(CLEANUP_RECOVERY_GRANTS_SQL).run(...cleanupRecoveryGrantsParams(now));
  db.prepare(ISSUE_RECOVERY_GRANT_SQL).run(
    ...issueRecoveryGrantParams(grantDigest, externalAuthId, now, RECOVERY_GRANT_TTL_MS),
  );
  db.prepare(SUPERSEDE_RECOVERY_GRANTS_SQL).run(
    ...supersedeRecoveryGrantsParams(externalAuthId, grantDigest),
  );
}

function consume(db, grantDigest, externalAuthId, now) {
  return (
    db
      .prepare(CONSUME_RECOVERY_GRANT_SQL)
      .all(...consumeRecoveryGrantParams(grantDigest, externalAuthId, now)).length > 0
  );
}

function peek(db, grantDigest, externalAuthId, now) {
  return (
    db.prepare(PEEK_RECOVERY_GRANT_SQL).all(...peekRecoveryGrantParams(grantDigest, externalAuthId, now))
      .length > 0
  );
}

test("the grant migration adds only its own table and leaves existing rows untouched", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const all = migrations();
  for (const name of all.filter((entry) => entry < "0023_")) apply(db, `${directory}/${name}`);

  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', '${AUTH_ID}', 'owner@example.test', 'Owner', 'OWNER');
  `);

  const migration = all.find((entry) => entry.startsWith("0023_"));
  assert.ok(migration, "migration 0023 is required");
  apply(db, `${directory}/${migration}`);

  assert.equal(db.prepare("SELECT count(*) total FROM users").get().total, 1);
  assert.equal(db.prepare("SELECT count(*) total FROM auth_recovery_grants").get().total, 0);
  const plan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT rowid FROM auth_recovery_grants WHERE expires_at < ? ORDER BY expires_at LIMIT 50",
    )
    .all(NOW)
    .map((row) => String(row.detail))
    .join(" ");
  assert.match(plan, /idx_auth_recovery_grants_expires/);
  db.close();
});

test("the table refuses anything that is not a real grant", () => {
  const db = migratedDatabase();
  const insert = (id, authId, issuedAt, expiresAt, consumedAt = null) =>
    db
      .prepare(
        "INSERT INTO auth_recovery_grants (id, external_auth_id, issued_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, authId, issuedAt, expiresAt, consumedAt);

  assert.throws(() => insert("short", AUTH_ID, NOW, NOW + MINUTE), /CHECK|constraint/i);
  assert.throws(() => insert(digest("a").toUpperCase(), AUTH_ID, NOW, NOW + MINUTE), /CHECK|constraint/i);
  assert.throws(() => insert(digest("b"), "not-a-uuid", NOW, NOW + MINUTE), /CHECK|constraint/i);
  assert.throws(() => insert(digest("c"), AUTH_ID, 0, NOW), /CHECK|constraint/i);
  // An expiry that is not after issuance would be a grant that never worked.
  assert.throws(() => insert(digest("d"), AUTH_ID, NOW, NOW), /CHECK|constraint/i);
  assert.throws(() => insert(digest("e"), AUTH_ID, NOW, NOW + MINUTE, NOW - 1), /CHECK|constraint/i);

  insert(digest("valid"), AUTH_ID, NOW, NOW + MINUTE);
  assert.throws(() => insert(digest("valid"), AUTH_ID, NOW, NOW + MINUTE), /UNIQUE|constraint/i);
  db.close();
});

test("a runtime token satisfies the stored constraint and can be spent once", async () => {
  const db = migratedDatabase();
  const token = createRecoveryGrantToken();
  const stored = await recoveryGrantDigest(token);

  issue(db, stored, AUTH_ID, NOW);
  assert.equal(peek(db, stored, AUTH_ID, NOW + MINUTE), true);
  assert.equal(consume(db, stored, AUTH_ID, NOW + MINUTE), true);
  assert.equal(consume(db, stored, AUTH_ID, NOW + 2 * MINUTE), false, "a grant is single use");
  assert.equal(peek(db, stored, AUTH_ID, NOW + 2 * MINUTE), false);
  db.close();
});

test("the stored row is a digest, so it cannot be read back and replayed", async () => {
  const db = migratedDatabase();
  const token = createRecoveryGrantToken();
  const stored = await recoveryGrantDigest(token);
  issue(db, stored, AUTH_ID, NOW);

  const rows = db.prepare("SELECT id FROM auth_recovery_grants").all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].id, token);
  // What the table holds is not itself a usable token: presenting it would be
  // hashed again and match nothing.
  const rehashed = await recoveryGrantDigest(rows[0].id);
  assert.equal(consume(db, rehashed, AUTH_ID, NOW + MINUTE), false);
  db.close();
});

test("a grant only works for the identity it was minted for", () => {
  const db = migratedDatabase();
  const stored = digest("bound");
  issue(db, stored, AUTH_ID, NOW);

  assert.equal(peek(db, stored, OTHER_AUTH_ID, NOW + MINUTE), false);
  assert.equal(consume(db, stored, OTHER_AUTH_ID, NOW + MINUTE), false);
  assert.equal(consume(db, stored, AUTH_ID, NOW + MINUTE), true, "the bound identity still works");
  db.close();
});

test("an expired grant is refused, and expiry is measured from issuance", () => {
  const db = migratedDatabase();
  const stored = digest("expiring");
  issue(db, stored, AUTH_ID, NOW);

  const justInside = NOW + RECOVERY_GRANT_TTL_MS - 1;
  const justOutside = NOW + RECOVERY_GRANT_TTL_MS + 1;
  assert.equal(peek(db, stored, AUTH_ID, justInside), true);
  assert.equal(consume(db, stored, AUTH_ID, justOutside), false);
  assert.equal(consume(db, stored, AUTH_ID, justInside), true);
  db.close();
});

test("only one caller can spend a grant, even from the same starting view", () => {
  const db = migratedDatabase();
  const stored = digest("raced");
  issue(db, stored, AUTH_ID, NOW);

  // Both statements are built from the same pre-consumption view of the row.
  const params = consumeRecoveryGrantParams(stored, AUTH_ID, NOW + MINUTE);
  const first = db.prepare(CONSUME_RECOVERY_GRANT_SQL).all(...params).length > 0;
  const second = db.prepare(CONSUME_RECOVERY_GRANT_SQL).all(...params).length > 0;
  assert.equal(first, true);
  assert.equal(second, false);
  db.close();
});

test("a new recovery link invalidates the unused link before it", () => {
  const db = migratedDatabase();
  const first = digest("first-link");
  const second = digest("second-link");
  issue(db, first, AUTH_ID, NOW);
  issue(db, second, AUTH_ID, NOW + MINUTE);

  assert.equal(consume(db, first, AUTH_ID, NOW + 2 * MINUTE), false);
  assert.equal(consume(db, second, AUTH_ID, NOW + 2 * MINUTE), true);
  db.close();
});

test("superseding one identity's links never touches another identity's", () => {
  const db = migratedDatabase();
  const mine = digest("mine");
  const theirs = digest("theirs");
  issue(db, mine, AUTH_ID, NOW);
  issue(db, theirs, OTHER_AUTH_ID, NOW);
  issue(db, digest("mine-again"), AUTH_ID, NOW + MINUTE);

  assert.equal(consume(db, mine, AUTH_ID, NOW + 2 * MINUTE), false);
  assert.equal(consume(db, theirs, OTHER_AUTH_ID, NOW + 2 * MINUTE), true);
  db.close();
});

test("cleanup reclaims spent and expired grants in bounded batches, and keeps live ones", () => {
  const db = migratedDatabase();
  const insert = db.prepare(
    "INSERT INTO auth_recovery_grants (id, external_auth_id, issued_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?)",
  );
  const old = NOW - RECOVERY_GRANT_RETENTION_MS - MINUTE;

  const total = RECOVERY_GRANT_CLEANUP_LIMIT + 5;
  for (let index = 0; index < total; index += 1) {
    insert.run(digest(`expired-${index}`), AUTH_ID, old, old + MINUTE, null);
  }
  insert.run(digest("long-consumed"), AUTH_ID, old, NOW + RECOVERY_GRANT_TTL_MS, old + 1);
  insert.run(digest("live"), AUTH_ID, NOW - MINUTE, NOW + RECOVERY_GRANT_TTL_MS, null);

  db.prepare(CLEANUP_RECOVERY_GRANTS_SQL).run(...cleanupRecoveryGrantsParams(NOW));
  assert.equal(
    db.prepare("SELECT count(*) total FROM auth_recovery_grants").get().total,
    total + 2 - RECOVERY_GRANT_CLEANUP_LIMIT,
  );

  db.prepare(CLEANUP_RECOVERY_GRANTS_SQL).run(...cleanupRecoveryGrantsParams(NOW));
  const remaining = db
    .prepare("SELECT id FROM auth_recovery_grants ORDER BY id")
    .all()
    .map((row) => row.id);
  assert.deepEqual(remaining, [digest("live")]);
  assert.equal(peek(db, digest("live"), AUTH_ID, NOW), true);
  db.close();
});
