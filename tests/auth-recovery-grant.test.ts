import assert from "node:assert/strict";
import test from "node:test";
import {
  clearedRecoveryGrantCookieOptions,
  createRecoveryGrantToken,
  isRecoveryGrantToken,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordChangeAccepted,
  recoveryGrantCookieOptions,
  recoveryGrantDigest,
  RECOVERY_GRANT_CLEANUP_LIMIT,
  RECOVERY_GRANT_COOKIE,
  RECOVERY_GRANT_DESTINATION,
  RECOVERY_GRANT_RETENTION_MS,
  RECOVERY_GRANT_TTL_MS,
  shouldIssueRecoveryGrant,
  validPasswordChange,
} from "../lib/auth-recovery-grant.ts";
import {
  cleanupRecoveryGrantsParams,
  consumeRecoveryGrantParams,
  issueRecoveryGrantParams,
  peekRecoveryGrantParams,
  supersedeRecoveryGrantsParams,
} from "../lib/auth-recovery-grant-sql.ts";
import { authIdentityId, confirmedAuthIdentity } from "../lib/auth-identity.ts";

const NOW = 1_800_000_000_000;
const AUTH_ID = "3f2b9c1a-7d4e-4a6b-9c3d-1e2f3a4b5c6d";
const DIGEST = "a".repeat(64);

test("a grant token is a full-entropy random value, not a guessable identifier", () => {
  const tokens = new Set<string>();
  for (let index = 0; index < 64; index += 1) {
    const token = createRecoveryGrantToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(isRecoveryGrantToken(token), true);
    tokens.add(token);
  }
  assert.equal(tokens.size, 64, "tokens must not repeat");
});

test("anything that is not a full token is rejected before it reaches the database", () => {
  for (const invalid of [
    undefined,
    null,
    "",
    "a".repeat(63),
    "a".repeat(65),
    `${"a".repeat(63)}Z`,
    `${"a".repeat(63)}'`,
    "' OR 1=1 --",
  ]) {
    assert.equal(isRecoveryGrantToken(invalid), false, String(invalid));
  }
});

test("the database stores a digest, so a stolen row cannot be replayed as a grant", async () => {
  const token = createRecoveryGrantToken();
  const digest = await recoveryGrantDigest(token);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.notEqual(digest, token);
  assert.equal(digest, await recoveryGrantDigest(token));
  assert.notEqual(digest, await recoveryGrantDigest(createRecoveryGrantToken()));
  await assert.rejects(() => recoveryGrantDigest("not-a-token"));
});

test("only a callback that completes a recovery or invitation mints a grant", () => {
  assert.equal(shouldIssueRecoveryGrant(RECOVERY_GRANT_DESTINATION), true);
  for (const other of ["/app", "/app/users", "/reset-password/", "/reset-password?x=1", "/"]) {
    assert.equal(shouldIssueRecoveryGrant(other), false, other);
  }
});

test("the grant cookie cannot be read by script or attached to a cross-site post", () => {
  const secure = recoveryGrantCookieOptions("https://natheegroup2025.com/auth/callback");
  assert.equal(secure.httpOnly, true);
  assert.equal(secure.sameSite, "lax");
  assert.equal(secure.secure, true);
  assert.equal(secure.path, "/");
  assert.equal(secure.maxAge, RECOVERY_GRANT_TTL_MS / 1000);

  // Local development is the only case that may drop the Secure attribute.
  assert.equal(recoveryGrantCookieOptions("http://localhost:3000/auth/callback").secure, false);
  // An unparseable URL must not be treated as insecure.
  assert.equal(recoveryGrantCookieOptions("not-a-url").secure, true);

  const cleared = clearedRecoveryGrantCookieOptions("https://natheegroup2025.com/x");
  assert.equal(cleared.maxAge, 0);
  assert.equal(cleared.httpOnly, true);
  assert.equal(cleared.path, "/");
});

test("holding a session is not one of the accepted proofs", () => {
  assert.equal(passwordChangeAccepted("grant"), true);
  assert.equal(passwordChangeAccepted("password"), true);
  assert.equal(passwordChangeAccepted("none"), false);
});

test("a password change is forwarded only when it is complete, matching and bounded", () => {
  const valid = "correct horse battery";
  assert.equal(validPasswordChange({ password: valid, confirmation: valid }), true);
  assert.equal(validPasswordChange({ password: valid, confirmation: `${valid} ` }), false);
  assert.equal(validPasswordChange({ password: "", confirmation: "" }), false);
  assert.equal(
    validPasswordChange({ password: "a".repeat(MIN_PASSWORD_LENGTH - 1), confirmation: "a".repeat(MIN_PASSWORD_LENGTH - 1) }),
    false,
  );
  assert.equal(
    validPasswordChange({ password: "a".repeat(MIN_PASSWORD_LENGTH), confirmation: "a".repeat(MIN_PASSWORD_LENGTH) }),
    true,
  );
  assert.equal(
    validPasswordChange({ password: "a".repeat(MAX_PASSWORD_LENGTH), confirmation: "a".repeat(MAX_PASSWORD_LENGTH) }),
    true,
  );
  assert.equal(
    validPasswordChange({ password: "a".repeat(MAX_PASSWORD_LENGTH + 1), confirmation: "a".repeat(MAX_PASSWORD_LENGTH + 1) }),
    false,
  );
});

test("binding a grant needs the provider's identifier, not a confirmed mailbox", () => {
  // An invited user is completing confirmation at the moment the grant is minted,
  // so requiring it here would break the invitation this is meant to protect.
  const invited = { id: AUTH_ID, email: "new@natheegroup2025.test" };
  assert.equal(authIdentityId(invited), AUTH_ID);
  assert.equal(confirmedAuthIdentity(invited), null);

  const confirmed = { ...invited, email_confirmed_at: "2026-08-23T00:00:00.000Z" };
  assert.equal(authIdentityId(confirmed), AUTH_ID);
  assert.equal(confirmedAuthIdentity(confirmed)?.externalAuthId, AUTH_ID);

  // Surrounding whitespace is trimmed; a value that is not a UUID is refused.
  assert.equal(authIdentityId({ id: ` ${AUTH_ID} ` }), AUTH_ID);
  for (const invalid of [
    undefined,
    null,
    { id: "" },
    { id: "not-a-uuid" },
    { id: AUTH_ID.slice(0, 35) },
    { id: AUTH_ID.replace("-4a6b-", "-0a6b-") },
    { id: `${AUTH_ID}${AUTH_ID}` },
  ]) {
    assert.equal(authIdentityId(invalid), null, JSON.stringify(invalid));
  }
});

test("grant lifetime, retention and cleanup bounds hold together", () => {
  assert.ok(RECOVERY_GRANT_TTL_MS > 0);
  assert.ok(RECOVERY_GRANT_RETENTION_MS > RECOVERY_GRANT_TTL_MS);
  assert.ok(RECOVERY_GRANT_CLEANUP_LIMIT > 0);
  assert.equal(RECOVERY_GRANT_COOKIE, "nathee_password_grant");
});

test("grant statements are bound in the order they read their parameters", () => {
  assert.deepEqual(issueRecoveryGrantParams(DIGEST, AUTH_ID, NOW, RECOVERY_GRANT_TTL_MS), [
    DIGEST,
    AUTH_ID,
    NOW,
    NOW + RECOVERY_GRANT_TTL_MS,
  ]);
  assert.deepEqual(supersedeRecoveryGrantsParams(AUTH_ID, DIGEST), [AUTH_ID, DIGEST]);
  assert.deepEqual(consumeRecoveryGrantParams(DIGEST, AUTH_ID, NOW), [NOW, DIGEST, AUTH_ID, NOW]);
  assert.deepEqual(peekRecoveryGrantParams(DIGEST, AUTH_ID, NOW), [DIGEST, AUTH_ID, NOW]);
  assert.deepEqual(cleanupRecoveryGrantsParams(NOW), [
    NOW,
    NOW - RECOVERY_GRANT_RETENTION_MS,
    RECOVERY_GRANT_CLEANUP_LIMIT,
  ]);
});
