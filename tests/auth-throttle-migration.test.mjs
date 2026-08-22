import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUTH_THROTTLE_CLEANUP_LIMIT,
  AUTH_THROTTLE_POLICIES,
  AUTH_THROTTLE_RETENTION_MS,
  authThrottleDecision,
  authThrottleScopeKey,
} from "../lib/auth-throttle.ts";
import {
  CLEANUP_AUTH_ATTEMPTS_SQL,
  cleanupAuthAttemptsParams,
  LOCK_AUTH_ATTEMPT_SQL,
  lockAuthAttemptParams,
  READ_AUTH_ATTEMPT_SQL,
  readAuthAttemptParams,
  RELEASE_AUTH_ATTEMPT_SQL,
  releaseAuthAttemptParams,
  RESERVE_AUTH_ATTEMPT_SQL,
  reserveAuthAttemptParams,
  RESET_AUTH_ATTEMPT_SQL,
  resetAuthAttemptParams,
} from "../lib/auth-throttle-sql.ts";

// The throttle is the only thing standing between the OWNER account and an
// unlimited number of password guesses, and every decision it makes is made by
// SQL rather than by application code. It therefore has to be proven against the
// real migrated schema, running the exact statements the runtime runs.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 1_800_000_000_000;

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

function key(label) {
  return createHash("sha256").update(label).digest("hex");
}

function readCounter(db, scope, scopeKey) {
  const row = db.prepare(READ_AUTH_ATTEMPT_SQL).get(...readAuthAttemptParams(scope, scopeKey));
  if (!row) return null;
  return {
    failureCount: Number(row.failure_count),
    windowStartedAt: Number(row.window_started_at),
    lockedUntil: row.locked_until === null ? null : Number(row.locked_until),
    lockoutCount: Number(row.lockout_count),
  };
}

// Mirrors lib/auth-throttle-store.ts. Any drift between the two is a defect in
// the runtime, not in this harness: both consume the same statements and the
// same parameter builders.
function reserve(db, targets, now) {
  db.prepare(CLEANUP_AUTH_ATTEMPTS_SQL).run(...cleanupAuthAttemptsParams(now));
  const states = targets.map(({ scope, scopeKey }) => {
    const policy = AUTH_THROTTLE_POLICIES[scope];
    const returned = db
      .prepare(RESERVE_AUTH_ATTEMPT_SQL)
      .all(...reserveAuthAttemptParams(scope, scopeKey, now, policy));
    return { scope, reserved: returned.length > 0, row: readCounter(db, scope, scopeKey) };
  });

  const decision = authThrottleDecision(states, now);
  const reserved = targets.filter((_, index) => states[index].reserved);
  if (!decision.allowed) {
    for (const { scope, scopeKey } of reserved) {
      db.prepare(RELEASE_AUTH_ATTEMPT_SQL).run(...releaseAuthAttemptParams(scope, scopeKey, now));
    }
  }
  return { ...decision, entries: decision.allowed ? reserved : [] };
}

function settle(db, reservation, outcome, now) {
  for (const { scope, scopeKey } of reservation.entries) {
    const policy = AUTH_THROTTLE_POLICIES[scope];
    if (outcome === "failure") {
      db.prepare(LOCK_AUTH_ATTEMPT_SQL).run(...lockAuthAttemptParams(scope, scopeKey, now, policy));
    } else if (policy.releaseOnSuccess === "reset") {
      db.prepare(RESET_AUTH_ATTEMPT_SQL).run(...resetAuthAttemptParams(scope, scopeKey, now));
    } else if (policy.releaseOnSuccess === "undo") {
      db.prepare(RELEASE_AUTH_ATTEMPT_SQL).run(...releaseAuthAttemptParams(scope, scopeKey, now));
    }
  }
}

function loginTargets(identityKey, clientKey) {
  return [
    { scope: "login:client", scopeKey: clientKey },
    { scope: "login:identity", scopeKey: identityKey },
  ];
}

function attemptLogin(db, targets, now, outcome) {
  const reservation = reserve(db, targets, now);
  if (reservation.allowed) settle(db, reservation, outcome, now);
  return reservation;
}

test("the throttle migration adds only its own table and leaves existing rows untouched", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const all = migrations();
  for (const name of all.filter((entry) => entry < "0022_")) apply(db, `${directory}/${name}`);

  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
  `);
  const before = db.prepare("SELECT count(*) total FROM users").get().total;

  const migration = all.find((entry) => entry.startsWith("0022_"));
  assert.ok(migration, "migration 0022 is required");
  apply(db, `${directory}/${migration}`);

  assert.equal(db.prepare("SELECT count(*) total FROM users").get().total, before);
  assert.equal(
    db.prepare("SELECT count(*) total FROM auth_attempt_counters").get().total,
    0,
  );
  const plan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT rowid FROM auth_attempt_counters WHERE updated_at < ? ORDER BY updated_at LIMIT 50",
    )
    .all(NOW)
    .map((row) => String(row.detail))
    .join(" ");
  assert.match(plan, /idx_auth_attempt_counters_updated/);
  db.close();
});

test("a digest produced by the runtime satisfies the stored key constraint", async () => {
  const db = migratedDatabase();
  const scopeKey = await authThrottleScopeKey("login:identity", "owner@natheegroup2025.com");
  const reservation = reserve(db, [{ scope: "login:identity", scopeKey }], NOW);
  assert.equal(reservation.allowed, true);
  assert.equal(readCounter(db, "login:identity", scopeKey).failureCount, 1);
  db.close();
});

test("the table refuses anything that is not a real counter", () => {
  const db = migratedDatabase();
  const insert = (scope, scopeKey, failureCount = 0, lockoutCount = 0, windowStartedAt = NOW) =>
    db
      .prepare(
        "INSERT INTO auth_attempt_counters (scope, scope_key, failure_count, window_started_at, locked_until, lockout_count, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
      )
      .run(scope, scopeKey, failureCount, windowStartedAt, lockoutCount, NOW);

  assert.throws(() => insert("login:admin", key("a")), /CHECK|constraint/i);
  assert.throws(() => insert("login:identity", "not-a-digest"), /CHECK|constraint/i);
  assert.throws(() => insert("login:identity", key("a").toUpperCase()), /CHECK|constraint/i);
  assert.throws(() => insert("login:identity", key("a").slice(0, 63)), /CHECK|constraint/i);
  assert.throws(() => insert("login:identity", key("b"), -1), /CHECK|constraint/i);
  assert.throws(() => insert("login:identity", key("c"), 0, -1), /CHECK|constraint/i);
  assert.throws(() => insert("login:identity", key("d"), 0, 0, 0), /CHECK|constraint/i);

  insert("login:identity", key("valid"));
  assert.throws(() => insert("login:identity", key("valid")), /UNIQUE|constraint/i);
  db.close();
});

test("password guessing against one account stops at the identity budget", () => {
  const db = migratedDatabase();
  const identity = key("identity:owner");
  const client = key("client:203.0.113.7");
  const budget = AUTH_THROTTLE_POLICIES["login:identity"].maxFailures;

  for (let attempt = 1; attempt <= budget; attempt += 1) {
    const reservation = attemptLogin(db, loginTargets(identity, client), NOW + attempt, "failure");
    assert.equal(reservation.allowed, true, `attempt ${attempt} must reach the provider`);
  }

  const refused = attemptLogin(db, loginTargets(identity, client), NOW + budget + 1, "failure");
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.refusedScopes, ["login:identity"]);
  assert.equal(refused.retryAfterSeconds, 15 * 60);

  const counter = readCounter(db, "login:identity", identity);
  assert.equal(counter.failureCount, budget, "a refused attempt must not inflate the counter");
  assert.equal(counter.lockoutCount, 1);
  assert.equal(counter.lockedUntil, NOW + budget + 15 * MINUTE);
  db.close();
});

test("a locked account stays locked past its window and is not charged to the shared client budget", () => {
  const db = migratedDatabase();
  const identity = key("identity:owner");
  const client = key("client:shared-office");
  const budget = AUTH_THROTTLE_POLICIES["login:identity"].maxFailures;

  for (let attempt = 1; attempt <= budget; attempt += 1) {
    attemptLogin(db, loginTargets(identity, client), NOW + attempt, "failure");
  }
  const clientAfterLock = readCounter(db, "login:client", client).failureCount;
  assert.equal(clientAfterLock, budget);

  // Long enough for the 15-minute window to roll, still inside the 15-minute lockout.
  const later = NOW + budget + 14 * MINUTE;
  const refused = attemptLogin(db, loginTargets(identity, client), later, "failure");
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.refusedScopes, ["login:identity"]);
  assert.equal(
    readCounter(db, "login:client", client).failureCount,
    clientAfterLock,
    "an attempt refused by another scope must not spend the client budget",
  );

  const afterLockout = NOW + budget + 15 * MINUTE + 1;
  const allowed = attemptLogin(db, loginTargets(identity, client), afterLockout, "failure");
  assert.equal(allowed.allowed, true);
  assert.equal(readCounter(db, "login:identity", identity).failureCount, 1);
  db.close();
});

test("lockouts escalate on repeat offences and stop at the last ladder step", () => {
  const db = migratedDatabase();
  const identity = key("identity:repeat");
  const client = key("client:repeat");
  const budget = AUTH_THROTTLE_POLICIES["login:identity"].maxFailures;
  const ladder = AUTH_THROTTLE_POLICIES["login:identity"].lockoutLadderMs;

  let clock = NOW;
  const observed = [];
  for (let round = 0; round < 4; round += 1) {
    for (let attempt = 0; attempt < budget; attempt += 1) {
      clock += 1;
      attemptLogin(db, loginTargets(identity, client), clock, "failure");
    }
    const counter = readCounter(db, "login:identity", identity);
    observed.push(counter.lockedUntil - clock);
    clock = counter.lockedUntil + 1;
  }

  assert.deepEqual(observed, [ladder[0], ladder[1], ladder[2], ladder[2]]);
  assert.equal(readCounter(db, "login:identity", identity).lockoutCount, 4);
  db.close();
});

test("escalation decays, so an old lockout does not punish a later mistake", () => {
  const db = migratedDatabase();
  const identity = key("identity:decay");
  const client = key("client:decay");
  const budget = AUTH_THROTTLE_POLICIES["login:identity"].maxFailures;
  const policy = AUTH_THROTTLE_POLICIES["login:identity"];

  let clock = NOW;
  for (let attempt = 0; attempt < budget; attempt += 1) {
    clock += 1;
    attemptLogin(db, loginTargets(identity, client), clock, "failure");
  }
  assert.equal(readCounter(db, "login:identity", identity).lockoutCount, 1);

  clock = readCounter(db, "login:identity", identity).lockedUntil + policy.escalationResetMs;
  for (let attempt = 0; attempt < budget; attempt += 1) {
    clock += 1;
    attemptLogin(db, loginTargets(identity, client), clock, "failure");
  }
  const counter = readCounter(db, "login:identity", identity);
  assert.equal(counter.lockoutCount, 1, "the ladder restarts once the escalation window has passed");
  assert.equal(counter.lockedUntil - clock, policy.lockoutLadderMs[0]);
  db.close();
});

test("a proven password clears its own budget but only returns one shared client attempt", () => {
  const db = migratedDatabase();
  const identity = key("identity:proven");
  const client = key("client:proven");

  let clock = NOW;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    clock += 1;
    attemptLogin(db, loginTargets(identity, client), clock, "failure");
  }
  assert.equal(readCounter(db, "login:identity", identity).failureCount, 3);
  assert.equal(readCounter(db, "login:client", client).failureCount, 3);

  clock += 1;
  const success = attemptLogin(db, loginTargets(identity, client), clock, "success");
  assert.equal(success.allowed, true);
  assert.equal(readCounter(db, "login:identity", identity).failureCount, 0);
  assert.equal(
    readCounter(db, "login:client", client).failureCount,
    3,
    "a valid account must not clear the budget its neighbours share",
  );
  db.close();
});

test("spraying many accounts from one client stops at the client budget", () => {
  const db = migratedDatabase();
  const client = key("client:sprayer");
  const budget = AUTH_THROTTLE_POLICIES["login:client"].maxFailures;

  let clock = NOW;
  for (let attempt = 0; attempt < budget; attempt += 1) {
    clock += 1;
    const reservation = attemptLogin(
      db,
      loginTargets(key(`identity:victim-${attempt}`), client),
      clock,
      "failure",
    );
    assert.equal(reservation.allowed, true, `spray ${attempt} must still reach the provider`);
  }

  clock += 1;
  const refused = attemptLogin(db, loginTargets(key("identity:victim-next"), client), clock, "failure");
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.refusedScopes, ["login:client"]);
  assert.equal(readCounter(db, "login:client", client).lockoutCount, 1);
  assert.equal(
    readCounter(db, "login:identity", key("identity:victim-next")).failureCount,
    0,
    "a victim whose account was never offered to the provider must not be charged",
  );
  db.close();
});

test("the window restores the budget once it has rolled", () => {
  const db = migratedDatabase();
  const identity = key("identity:window");
  const client = key("client:window");
  const policy = AUTH_THROTTLE_POLICIES["login:identity"];

  let clock = NOW;
  for (let attempt = 0; attempt < policy.maxFailures - 1; attempt += 1) {
    clock += 1;
    attemptLogin(db, loginTargets(identity, client), clock, "failure");
  }
  assert.equal(readCounter(db, "login:identity", identity).failureCount, policy.maxFailures - 1);

  const rolled = NOW + policy.windowMs + 1;
  attemptLogin(db, loginTargets(identity, client), rolled, "failure");
  const counter = readCounter(db, "login:identity", identity);
  assert.equal(counter.failureCount, 1);
  assert.equal(counter.windowStartedAt, rolled);
  assert.equal(counter.lockedUntil, null);
  db.close();
});

test("recovery requests are budgeted per address and per client", () => {
  const db = migratedDatabase();
  const identity = key("recovery:owner");
  const client = key("recovery:client");
  const targets = [
    { scope: "recovery:client", scopeKey: client },
    { scope: "recovery:identity", scopeKey: identity },
  ];
  const budget = AUTH_THROTTLE_POLICIES["recovery:identity"].maxFailures;

  let clock = NOW;
  for (let attempt = 0; attempt < budget; attempt += 1) {
    clock += 1;
    const reservation = reserve(db, targets, clock);
    assert.equal(reservation.allowed, true);
    settle(db, reservation, "failure", clock);
  }

  clock += 1;
  const refused = reserve(db, targets, clock);
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.refusedScopes, ["recovery:identity"]);
  assert.equal(refused.retryAfterSeconds, 60 * 60);
  assert.equal(readCounter(db, "recovery:identity", identity).failureCount, budget);
  db.close();
});

test("a lockout that was never written still cannot be guessed past", () => {
  const db = migratedDatabase();
  const identity = key("identity:unsettled");
  const client = key("client:unsettled");
  const budget = AUTH_THROTTLE_POLICIES["login:identity"].maxFailures;

  // The settlement write is deliberately skipped, standing in for a runtime that
  // died between the provider answering and the lockout being recorded.
  let clock = NOW;
  for (let attempt = 0; attempt < budget; attempt += 1) {
    clock += 1;
    assert.equal(reserve(db, loginTargets(identity, client), clock).allowed, true);
  }
  const counter = readCounter(db, "login:identity", identity);
  assert.equal(counter.lockedUntil, null, "no lockout was ever recorded");

  clock += 1;
  const refused = reserve(db, loginTargets(identity, client), clock);
  assert.equal(refused.allowed, false, "the spent window alone must refuse the next attempt");
  assert.deepEqual(refused.refusedScopes, ["login:identity"]);
  db.close();
});

test("counters are incremented by the database, so a stale reader cannot lose an attempt", () => {
  const db = migratedDatabase();
  const identity = key("identity:concurrent");
  const policy = AUTH_THROTTLE_POLICIES["login:identity"];

  // Both statements are built from the same pre-attempt view of the row, exactly
  // as two simultaneous requests would be.
  const params = reserveAuthAttemptParams("login:identity", identity, NOW, policy);
  db.prepare(RESERVE_AUTH_ATTEMPT_SQL).all(...params);
  db.prepare(RESERVE_AUTH_ATTEMPT_SQL).all(...params);
  assert.equal(readCounter(db, "login:identity", identity).failureCount, 2);
  db.close();
});

test("cleanup reclaims only counters that have stopped mattering, and only in bounded batches", () => {
  const db = migratedDatabase();
  const stale = NOW - AUTH_THROTTLE_RETENTION_MS - MINUTE;
  const insert = db.prepare(
    "INSERT INTO auth_attempt_counters (scope, scope_key, failure_count, window_started_at, locked_until, lockout_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );

  const total = AUTH_THROTTLE_CLEANUP_LIMIT + 10;
  for (let index = 0; index < total; index += 1) {
    insert.run("login:identity", key(`stale-${index}`), 1, stale, null, 0, stale);
  }
  insert.run("login:identity", key("fresh"), 1, NOW - MINUTE, null, 0, NOW - MINUTE);
  insert.run("login:identity", key("locked"), 5, stale, NOW + HOUR, 1, stale);

  db.prepare(CLEANUP_AUTH_ATTEMPTS_SQL).run(...cleanupAuthAttemptsParams(NOW));
  assert.equal(
    db.prepare("SELECT count(*) total FROM auth_attempt_counters").get().total,
    total + 2 - AUTH_THROTTLE_CLEANUP_LIMIT,
  );

  db.prepare(CLEANUP_AUTH_ATTEMPTS_SQL).run(...cleanupAuthAttemptsParams(NOW));
  const remaining = db
    .prepare("SELECT scope_key FROM auth_attempt_counters ORDER BY scope_key")
    .all()
    .map((row) => row.scope_key)
    .sort();
  assert.deepEqual(remaining, [key("fresh"), key("locked")].sort());
  db.close();
});
