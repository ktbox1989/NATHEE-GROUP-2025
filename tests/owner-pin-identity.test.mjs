import assert from "node:assert/strict";
import test from "node:test";
import {
  authThrottleScopeKey,
  authThrottleTargets,
  AUTH_THROTTLE_POLICIES,
  normalizeIdentitySubject,
} from "../lib/auth-throttle.ts";
import {
  LOCK_AUTH_ATTEMPT_SQL,
  lockAuthAttemptParams,
  READ_AUTH_ATTEMPT_SQL,
  readAuthAttemptParams,
  RESERVE_AUTH_ATTEMPT_SQL,
  reserveAuthAttemptParams,
} from "../lib/auth-throttle-sql.ts";
import {
  createOwnerSessionToken,
  deriveOwnerPinHash,
  formatOwnerPinCredential,
  MIN_PBKDF2_ITERATIONS,
  OWNER_DISPLAY_NAME,
  OWNER_EMAIL,
  OWNER_EXTERNAL_AUTH_ID,
  ownerCredentialFingerprint,
  ownerSessionPayload,
  parseOwnerPinAuthConfig,
  toBase64Url,
} from "../lib/owner-pin.ts";
import {
  authModeConfigured,
  getOwnerPinAuthConfig,
  isOwnerPinConfigured,
} from "../lib/owner-pin.ts";
import { OWNER_BOOTSTRAP_AUDIT_ACTION } from "../lib/owner-pin-sql.ts";
import { ensureOwnerPinIdentity, resolveOwnerPinSession } from "../lib/owner-pin-store.ts";
import { isSupabaseConfigured } from "../lib/supabase/config.ts";
import { d1Over, migratedSqlite } from "./support/d1-over-sqlite.mjs";

// The Owner PIN writes into the tables every other account already uses, so the
// only honest place to prove it is the real migrated schema, with the real
// triggers and the real unique indexes in force. Nothing here creates a table.

const NOW = Date.UTC(2026, 7, 25, 9, 0, 0);
const PIN = "046913";
const SESSION_SECRET = toBase64Url(new Uint8Array(32).fill(5));
const OTHER_AUTH_ID = "3f2b9c1a-7d4e-4a6b-9c3d-1e2f3a4b5c6d";

let cachedCredential = null;
async function credential() {
  if (!cachedCredential) {
    const salt = new Uint8Array(32).fill(3);
    cachedCredential = formatOwnerPinCredential({
      iterations: MIN_PBKDF2_ITERATIONS,
      salt,
      hash: await deriveOwnerPinHash(PIN, salt, MIN_PBKDF2_ITERATIONS),
    });
  }
  return cachedCredential;
}

async function config() {
  return parseOwnerPinAuthConfig(await credential(), SESSION_SECRET);
}

function fresh() {
  const database = migratedSqlite();
  return { database, d1: d1Over(database) };
}

function insertUser(database, options) {
  database
    .prepare(
      "INSERT INTO users (id, external_auth_id, email, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      options.id,
      options.externalAuthId,
      options.email,
      "ทดสอบ",
      options.role ?? "STAFF",
      options.status ?? "ACTIVE",
    );
}

function assignRole(database, userId, role) {
  database
    .prepare("INSERT INTO user_role_assignments (user_id, role, assigned_by) VALUES (?, ?, ?)")
    .run(userId, role, userId);
}

function counts(database) {
  const one = (sql, ...params) => database.prepare(sql).get(...params).total;
  return {
    users: one("SELECT COUNT(*) AS total FROM users"),
    assignments: one("SELECT COUNT(*) AS total FROM user_role_assignments"),
    bootstrapAudits: one(
      "SELECT COUNT(*) AS total FROM audit_logs WHERE action = ?",
      OWNER_BOOTSTRAP_AUDIT_ACTION,
    ),
  };
}

function ownerRow(database) {
  return database
    .prepare(
      "SELECT u.id AS id, u.email AS email, u.status AS status, u.role AS legacy_role," +
        " r.role AS assigned_role, u.company_id AS company_id, u.display_name AS display_name" +
        " FROM users u LEFT JOIN user_role_assignments r ON r.user_id = u.id" +
        " WHERE u.external_auth_id = ?",
    )
    .get(OWNER_EXTERNAL_AUTH_ID);
}

test("the first Owner PIN sign-in creates the canonical account, its OWNER assignment and one audit row", async () => {
  const { database, d1 } = fresh();
  assert.deepEqual(counts(database), { users: 0, assignments: 0, bootstrapAudits: 0 });

  const outcome = await ensureOwnerPinIdentity(d1, NOW);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.created, true);

  const row = ownerRow(database);
  assert.equal(row.email, OWNER_EMAIL);
  assert.equal(row.display_name, OWNER_DISPLAY_NAME);
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.legacy_role, "OWNER");
  // The explicit assignment is authoritative; the legacy column alone would have
  // resolved to OWNER too, which is exactly why it must not be relied on.
  assert.equal(row.assigned_role, "OWNER");
  assert.equal(row.company_id, null);
  assert.equal(outcome.userId, row.id);

  assert.deepEqual(counts(database), { users: 1, assignments: 1, bootstrapAudits: 1 });

  const audit = database
    .prepare("SELECT * FROM audit_logs WHERE action = ?")
    .get(OWNER_BOOTSTRAP_AUDIT_ACTION);
  assert.equal(audit.actor_user_id, row.id);
  assert.equal(audit.entity_type, "user");
  assert.equal(audit.entity_id, row.id);
  assert.equal(audit.company_id, null);
  assert.deepEqual(JSON.parse(audit.after_json), {
    role: "OWNER",
    status: "ACTIVE",
    authMethod: "owner_pin",
  });
  // The Audit page sorts and pages by created_at, so the bootstrap row must be
  // written in the same representation CURRENT_TIMESTAMP produces.
  assert.match(audit.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("every later sign-in is a read that writes nothing", async () => {
  const { database, d1 } = fresh();
  const first = await ensureOwnerPinIdentity(d1, NOW);
  const before = counts(database);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const again = await ensureOwnerPinIdentity(d1, NOW + attempt * 1000);
    assert.equal(again.ok, true);
    assert.equal(again.created, false);
    assert.equal(again.userId, first.userId);
  }

  assert.deepEqual(counts(database), before);
  assert.deepEqual(before, { users: 1, assignments: 1, bootstrapAudits: 1 });
});

test("the canonical address already bound to another identity is refused, and nothing is written", async () => {
  const { database, d1 } = fresh();
  insertUser(database, {
    id: "existing-user",
    externalAuthId: OTHER_AUTH_ID,
    email: OWNER_EMAIL,
    role: "STAFF",
  });
  assignRole(database, "existing-user", "STAFF");
  const before = counts(database);

  const outcome = await ensureOwnerPinIdentity(d1, NOW);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "conflict");
  assert.match(outcome.detail, /already bound to another identity/);

  // Not rebound, not promoted, not duplicated.
  assert.deepEqual(counts(database), before);
  const existing = database.prepare("SELECT * FROM users WHERE id = 'existing-user'").get();
  assert.equal(existing.external_auth_id, OTHER_AUTH_ID);
  assert.equal(existing.role, "STAFF");
  assert.equal(
    database.prepare("SELECT role FROM user_role_assignments WHERE user_id = 'existing-user'").get().role,
    "STAFF",
  );
  assert.equal(ownerRow(database), undefined);
});

test("the Owner PIN identity bound to a different address is refused", async () => {
  const { database, d1 } = fresh();
  insertUser(database, {
    id: "drifted",
    externalAuthId: OWNER_EXTERNAL_AUTH_ID,
    email: "someone-else@example.com",
    role: "OWNER",
  });
  const before = counts(database);

  const outcome = await ensureOwnerPinIdentity(d1, NOW);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "conflict");
  assert.match(outcome.detail, /bound to another address/);
  assert.deepEqual(counts(database), before);
});

test("the address and the identity on two different accounts is a conflict, not a choice", async () => {
  const { database, d1 } = fresh();
  insertUser(database, { id: "holds-address", externalAuthId: OTHER_AUTH_ID, email: OWNER_EMAIL });
  insertUser(database, {
    id: "holds-identity",
    externalAuthId: OWNER_EXTERNAL_AUTH_ID,
    email: "other@example.com",
  });
  const before = counts(database);

  const outcome = await ensureOwnerPinIdentity(d1, NOW);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "conflict");
  assert.match(outcome.detail, /different accounts/);
  assert.deepEqual(counts(database), before);
});

test("a canonical row that is not an ACTIVE OWNER is refused rather than promoted", async () => {
  for (const account of [
    { label: "explicitly assigned STAFF", role: "STAFF", assigned: "STAFF", status: "ACTIVE" },
    { label: "deactivated", role: "OWNER", assigned: "OWNER", status: "INACTIVE" },
    { label: "archived", role: "OWNER", assigned: "OWNER", status: "ARCHIVED" },
    { label: "a customer role", role: "STAFF", assigned: "SALE", status: "ACTIVE" },
  ]) {
    const { database, d1 } = fresh();
    insertUser(database, {
      id: "canonical",
      externalAuthId: OWNER_EXTERNAL_AUTH_ID,
      email: OWNER_EMAIL,
      role: account.role,
      status: account.status,
    });
    assignRole(database, "canonical", account.assigned);
    const before = counts(database);

    const outcome = await ensureOwnerPinIdentity(d1, NOW);
    assert.equal(outcome.ok, false, account.label);
    assert.equal(outcome.reason, "not_owner", account.label);
    assert.deepEqual(counts(database), before, account.label);
    assert.equal(
      database.prepare("SELECT role FROM user_role_assignments WHERE user_id = 'canonical'").get().role,
      account.assigned,
      account.label,
    );
  }
});

test("a valid cookie resolves to the OWNER actor the row actually describes", async () => {
  const { database, d1 } = fresh();
  const bootstrap = await ensureOwnerPinIdentity(d1, NOW);
  const authConfig = await config();
  const token = await createOwnerSessionToken(
    ownerSessionPayload(
      bootstrap.userId,
      await ownerCredentialFingerprint(authConfig.encodedCredential),
      NOW,
    ),
    SESSION_SECRET,
  );

  const actor = await resolveOwnerPinSession({ token, config: authConfig, database: d1, now: NOW + 1000 });
  assert.ok(actor);
  assert.equal(actor.userId, bootstrap.userId);
  assert.equal(actor.role, "OWNER");
  assert.equal(actor.email, OWNER_EMAIL);
  assert.equal(actor.displayName, OWNER_DISPLAY_NAME);
  assert.equal(actor.companyId, null);
  assert.equal(ownerRow(database).id, actor.userId);
});

test("the database, not the cookie, decides whether the Owner may still act", async () => {
  const authConfig = await config();
  const fingerprint = await ownerCredentialFingerprint(authConfig.encodedCredential);

  async function sessionAfter(mutate) {
    const { database, d1 } = fresh();
    const bootstrap = await ensureOwnerPinIdentity(d1, NOW);
    // A second active OWNER, because the schema refuses to deactivate or demote
    // the last one. Without it these mutations would be rejected by a trigger
    // and the test would prove nothing about the session.
    insertUser(database, { id: "other-owner", externalAuthId: OTHER_AUTH_ID, email: "other-owner@example.com", role: "OWNER" });
    assignRole(database, "other-owner", "OWNER");
    const token = await createOwnerSessionToken(
      ownerSessionPayload(bootstrap.userId, fingerprint, NOW),
      SESSION_SECRET,
    );
    mutate(database, bootstrap.userId);
    return resolveOwnerPinSession({ token, config: authConfig, database: d1, now: NOW + 1000 });
  }

  // Untouched, the same session resolves; each mutation below is the only change.
  assert.ok(await sessionAfter(() => {}));

  // Deactivated.
  assert.equal(
    await sessionAfter((database, id) => {
      database.prepare("UPDATE users SET status = 'INACTIVE' WHERE id = ?").run(id);
    }),
    null,
  );
  // Demoted. The role system will not let an assignment and the legacy column
  // disagree at any instant, so a demotion is a removal followed by the legacy
  // fallback — which is what the Owner's own admin surface writes.
  assert.equal(
    await sessionAfter((database, id) => {
      database.prepare("DELETE FROM user_role_assignments WHERE user_id = ?").run(id);
      database.prepare("UPDATE users SET role = 'STAFF' WHERE id = ?").run(id);
    }),
    null,
  );
  // The address changed underneath the session.
  assert.equal(
    await sessionAfter((database, id) => {
      database.prepare("UPDATE users SET email = 'moved@example.com' WHERE id = ?").run(id);
    }),
    null,
  );
});

test("a cookie naming a different row does not act as the Owner", async () => {
  const { d1 } = fresh();
  const bootstrap = await ensureOwnerPinIdentity(d1, NOW);
  const authConfig = await config();
  const fingerprint = await ownerCredentialFingerprint(authConfig.encodedCredential);

  assert.ok(
    await resolveOwnerPinSession({
      token: await createOwnerSessionToken(ownerSessionPayload(bootstrap.userId, fingerprint, NOW), SESSION_SECRET),
      config: authConfig,
      database: d1,
      now: NOW + 1000,
    }),
  );
  // Correctly signed, correctly fingerprinted, and pointing at an id the
  // canonical row does not have: an account recreated under a new id is a
  // different account, and the old cookie must not act as it.
  assert.equal(
    await resolveOwnerPinSession({
      token: await createOwnerSessionToken(ownerSessionPayload("some-other-id", fingerprint, NOW), SESSION_SECRET),
      config: authConfig,
      database: d1,
      now: NOW + 1000,
    }),
    null,
  );
});

test("no session resolves without configuration, without a cookie, or after the credential is rotated", async () => {
  const { d1 } = fresh();
  const bootstrap = await ensureOwnerPinIdentity(d1, NOW);
  const authConfig = await config();
  const fingerprint = await ownerCredentialFingerprint(authConfig.encodedCredential);
  const token = await createOwnerSessionToken(
    ownerSessionPayload(bootstrap.userId, fingerprint, NOW),
    SESSION_SECRET,
  );

  assert.equal(await resolveOwnerPinSession({ token, config: null, database: d1, now: NOW }), null);
  assert.equal(await resolveOwnerPinSession({ token: undefined, config: authConfig, database: d1, now: NOW }), null);
  assert.equal(await resolveOwnerPinSession({ token: "", config: authConfig, database: d1, now: NOW }), null);

  const rotatedSalt = new Uint8Array(32).fill(21);
  const rotated = parseOwnerPinAuthConfig(
    formatOwnerPinCredential({
      iterations: MIN_PBKDF2_ITERATIONS,
      salt: rotatedSalt,
      hash: await deriveOwnerPinHash("713002", rotatedSalt, MIN_PBKDF2_ITERATIONS),
    }),
    SESSION_SECRET,
  );
  assert.equal(await resolveOwnerPinSession({ token, config: rotated, database: d1, now: NOW + 1000 }), null);
});

// `lib/current-actor.ts` cannot be imported here — it resolves the D1 binding
// through `cloudflare:workers` — so what it does is proven through the exact
// functions it calls, with the environment in the state that matters: a runtime
// where no identity provider is configured at all.
test("with Supabase absent, the Owner PIN alone resolves an actor and is not a config error", async () => {
  const MANAGED = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "OWNER_PIN_CREDENTIAL",
    "OWNER_SESSION_SECRET",
  ];
  const restore = Object.fromEntries(MANAGED.map((name) => [name, process.env[name]]));
  try {
    for (const name of MANAGED) delete process.env[name];
    process.env.OWNER_PIN_CREDENTIAL = await credential();
    process.env.OWNER_SESSION_SECRET = SESSION_SECRET;

    assert.equal(isSupabaseConfigured(), false);
    assert.equal(isOwnerPinConfigured(), true);
    // The decision `requireActor` makes: with a door configured, an absent
    // provider must not send the Owner to /login?error=config.
    assert.equal(
      authModeConfigured({ ownerPin: isOwnerPinConfigured(), supabase: isSupabaseConfigured() }),
      true,
    );

    const { database, d1 } = fresh();
    const bootstrap = await ensureOwnerPinIdentity(d1, NOW);
    const authConfig = getOwnerPinAuthConfig();
    assert.ok(authConfig);
    const token = await createOwnerSessionToken(
      ownerSessionPayload(
        bootstrap.userId,
        await ownerCredentialFingerprint(authConfig.encodedCredential),
        NOW,
      ),
      SESSION_SECRET,
    );

    const actor = await resolveOwnerPinSession({ token, config: authConfig, database: d1, now: NOW + 1000 });
    assert.ok(actor, "the Owner could not sign in with no identity provider configured");
    assert.equal(actor.role, "OWNER");

    // The same runtime, the same cookie, after the account is deactivated: a
    // resolution that still succeeded here would mean the CMS trusts a cookie.
    insertUser(database, {
      id: "other-owner",
      externalAuthId: OTHER_AUTH_ID,
      email: "other-owner@example.com",
      role: "OWNER",
    });
    assignRole(database, "other-owner", "OWNER");
    database.prepare("UPDATE users SET status = 'INACTIVE' WHERE id = ?").run(bootstrap.userId);
    assert.equal(
      await resolveOwnerPinSession({ token, config: authConfig, database: d1, now: NOW + 1000 }),
      null,
    );

    // And with neither door configured, there is genuinely no way in.
    delete process.env.OWNER_PIN_CREDENTIAL;
    delete process.env.OWNER_SESSION_SECRET;
    assert.equal(isOwnerPinConfigured(), false);
    assert.equal(
      authModeConfigured({ ownerPin: isOwnerPinConfigured(), supabase: isSupabaseConfigured() }),
      false,
    );
  } finally {
    for (const [name, value] of Object.entries(restore)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("a PIN attempt spends the very budget a password attempt on the same address spends", async () => {
  const { database } = fresh();
  const subject = normalizeIdentitySubject(OWNER_EMAIL);
  assert.equal(subject, OWNER_EMAIL);

  // The route builds its targets from the server constant, never from a form.
  const targets = authThrottleTargets("login", subject, "203.0.113.10");
  assert.deepEqual(targets.map((target) => target.scope).sort(), ["login:client", "login:identity"]);

  const identityKey = await authThrottleScopeKey("login:identity", subject);
  // Byte-identical to what the password login would compute for the same
  // address, so PIN guesses and password guesses share one lockout.
  assert.equal(
    identityKey,
    await authThrottleScopeKey("login:identity", normalizeIdentitySubject(" KAIKT143@Gmail.com ")),
  );
  assert.match(identityKey, /^[0-9a-f]{64}$/);

  const policy = AUTH_THROTTLE_POLICIES["login:identity"];
  const reserve = (now) =>
    database
      .prepare(RESERVE_AUTH_ATTEMPT_SQL)
      .all(...reserveAuthAttemptParams("login:identity", identityKey, now, policy));
  const lock = (now) =>
    database
      .prepare(LOCK_AUTH_ATTEMPT_SQL)
      .run(...lockAuthAttemptParams("login:identity", identityKey, now, policy));

  for (let attempt = 0; attempt < policy.maxFailures; attempt += 1) {
    assert.equal(reserve(NOW + attempt).length, 1, `attempt ${attempt}`);
    lock(NOW + attempt);
  }
  // Six guesses at a six-digit PIN, and the sixth is refused.
  assert.equal(reserve(NOW + policy.maxFailures).length, 0);

  const row = database
    .prepare(READ_AUTH_ATTEMPT_SQL)
    .get(...readAuthAttemptParams("login:identity", identityKey));
  assert.equal(row.failure_count >= policy.maxFailures, true);
  assert.equal(row.locked_until > NOW, true);
  // The counter stores a digest, never the address that was typed.
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS total FROM auth_attempt_counters WHERE scope_key LIKE ?")
      .get(`%${OWNER_EMAIL}%`).total,
    0,
  );
});
