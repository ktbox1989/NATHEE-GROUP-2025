import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_THROTTLE_CLEANUP_LIMIT,
  AUTH_THROTTLE_POLICIES,
  AUTH_THROTTLE_RETENTION_MS,
  authThrottleDecision,
  authThrottlePolicy,
  authThrottleScopeKey,
  authThrottleTargets,
  isAuthThrottleScope,
  lockoutDurationMs,
  MAX_RETRY_AFTER_SECONDS,
  normalizeClientSubject,
  normalizeIdentitySubject,
  retryAfterMinutes,
  retryAfterSeconds,
  shouldLockAfterFailure,
  UNKNOWN_CLIENT_SUBJECT,
  type AuthCounterRow,
  type AuthThrottleScope,
} from "../lib/auth-throttle.ts";
import {
  cleanupAuthAttemptsParams,
  lockAuthAttemptParams,
  readAuthAttemptParams,
  releaseAuthAttemptParams,
  reserveAuthAttemptParams,
  resetAuthAttemptParams,
} from "../lib/auth-throttle-sql.ts";
import { isIpAddress, trustedClientAddress } from "../lib/client-address.ts";
import { AUTH_ATTEMPT_SCOPES } from "../db/schema.ts";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

function row(overrides: Partial<AuthCounterRow> = {}): AuthCounterRow {
  return {
    failureCount: 0,
    windowStartedAt: NOW,
    lockedUntil: null,
    lockoutCount: 0,
    ...overrides,
  };
}

test("every scope declared by the schema has a policy, and no others exist", () => {
  assert.deepEqual(Object.keys(AUTH_THROTTLE_POLICIES).sort(), [...AUTH_ATTEMPT_SCOPES].sort());
  for (const scope of AUTH_ATTEMPT_SCOPES) {
    assert.equal(isAuthThrottleScope(scope), true);
    const policy = authThrottlePolicy(scope);
    assert.ok(policy.windowMs > 0);
    assert.ok(policy.maxFailures > 0);
    assert.equal(policy.lockoutLadderMs.length, 3);
    assert.ok(policy.lockoutLadderMs.every((duration) => duration > 0));
  }
  assert.equal(isAuthThrottleScope("login:admin"), false);
});

test("an identity budget is tighter than the client budget that carries it", () => {
  assert.ok(
    AUTH_THROTTLE_POLICIES["login:identity"].maxFailures <
      AUTH_THROTTLE_POLICIES["login:client"].maxFailures,
  );
  assert.ok(
    AUTH_THROTTLE_POLICIES["recovery:identity"].maxFailures <
      AUTH_THROTTLE_POLICIES["recovery:client"].maxFailures,
  );
});

test("a proven password clears only the identity budget, never the shared client budget", () => {
  assert.equal(AUTH_THROTTLE_POLICIES["login:identity"].releaseOnSuccess, "reset");
  assert.equal(AUTH_THROTTLE_POLICIES["login:client"].releaseOnSuccess, "undo");
  // Recovery cannot observe success without becoming an existence oracle.
  assert.equal(AUTH_THROTTLE_POLICIES["recovery:identity"].releaseOnSuccess, "consume");
  assert.equal(AUTH_THROTTLE_POLICIES["recovery:client"].releaseOnSuccess, "consume");
});

test("identity subjects are normalised so case and spacing cannot buy extra attempts", () => {
  assert.equal(normalizeIdentitySubject("  Owner@NatheeGroup2025.com "), "owner@natheegroup2025.com");
  assert.equal(normalizeIdentitySubject("   "), null);
  assert.equal(normalizeIdentitySubject(""), null);
  assert.equal(normalizeIdentitySubject(`${"a".repeat(250)}@x.test`), null);
});

test("a request with no trusted client address still lands in a client bucket", () => {
  assert.equal(normalizeClientSubject(null), UNKNOWN_CLIENT_SUBJECT);
  assert.equal(normalizeClientSubject("   "), UNKNOWN_CLIENT_SUBJECT);
  assert.equal(normalizeClientSubject("203.0.113.7"), "203.0.113.7");
});

test("scope keys are unlinkable digests rather than stored subjects", async () => {
  const key = await authThrottleScopeKey("login:identity", "owner@natheegroup2025.com");
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, await authThrottleScopeKey("login:identity", "owner@natheegroup2025.com"));
  assert.notEqual(key, await authThrottleScopeKey("recovery:identity", "owner@natheegroup2025.com"));
  assert.notEqual(key, await authThrottleScopeKey("login:identity", "other@natheegroup2025.com"));
  assert.ok(!key.includes("owner"));
});

test("one attempt always spends both a client and an identity budget", () => {
  const login = authThrottleTargets("login", "owner@natheegroup2025.com", "203.0.113.7");
  assert.deepEqual(login, [
    { scope: "login:client", subject: "203.0.113.7" },
    { scope: "login:identity", subject: "owner@natheegroup2025.com" },
  ]);
  const recovery = authThrottleTargets("recovery", "owner@natheegroup2025.com", null);
  assert.deepEqual(recovery, [
    { scope: "recovery:client", subject: UNKNOWN_CLIENT_SUBJECT },
    { scope: "recovery:identity", subject: "owner@natheegroup2025.com" },
  ]);
});

test("a decision is allowed only when every scope reserved", () => {
  const allowed = authThrottleDecision(
    [
      { scope: "login:client", reserved: true, row: row({ failureCount: 3 }) },
      { scope: "login:identity", reserved: true, row: row({ failureCount: 1 }) },
    ],
    NOW,
  );
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.retryAfterSeconds, 0);
  assert.deepEqual(allowed.refusedScopes, []);

  const refused = authThrottleDecision(
    [
      { scope: "login:client", reserved: true, row: row({ failureCount: 3 }) },
      {
        scope: "login:identity",
        reserved: false,
        // A lockout always follows a partly elapsed window, and outlives it.
        row: row({
          failureCount: 5,
          windowStartedAt: NOW - 12 * MINUTE,
          lockedUntil: NOW + 10 * MINUTE,
        }),
      },
    ],
    NOW,
  );
  assert.equal(refused.allowed, false);
  assert.deepEqual(refused.refusedScopes, ["login:identity"]);
  assert.equal(refused.retryAfterSeconds, 10 * 60);
});

test("a caller refused by two scopes waits for the longer one", () => {
  const decision = authThrottleDecision(
    [
      {
        scope: "login:client",
        reserved: false,
        row: row({ failureCount: 20, lockedUntil: NOW + 45 * MINUTE }),
      },
      {
        scope: "login:identity",
        reserved: false,
        row: row({ failureCount: 5, lockedUntil: NOW + 15 * MINUTE }),
      },
    ],
    NOW,
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.retryAfterSeconds, 45 * 60);
  assert.deepEqual(decision.refusedScopes, ["login:client", "login:identity"]);
});

test("an exhausted window without a lockout still reports the honest remaining wait", () => {
  const policy = authThrottlePolicy("login:identity");
  const exhausted = row({ failureCount: policy.maxFailures, windowStartedAt: NOW - 5 * MINUTE });
  assert.equal(retryAfterSeconds(exhausted, NOW, policy), 10 * 60);
});

test("retry waits are always positive and bounded", () => {
  const policy = authThrottlePolicy("login:identity");
  assert.equal(retryAfterSeconds(null, NOW, policy), 1);
  assert.equal(retryAfterSeconds(row({ windowStartedAt: NOW - policy.windowMs }), NOW, policy), 1);
  const absurd = row({ lockedUntil: NOW + 10 * 365 * 24 * 60 * MINUTE });
  assert.equal(retryAfterSeconds(absurd, NOW, policy), MAX_RETRY_AFTER_SECONDS);
});

test("lockouts escalate along the ladder and stop at its last step", () => {
  const policy = authThrottlePolicy("login:identity");
  assert.equal(lockoutDurationMs(policy, 0), 15 * MINUTE);
  assert.equal(lockoutDurationMs(policy, 1), 30 * MINUTE);
  assert.equal(lockoutDurationMs(policy, 2), 60 * MINUTE);
  assert.equal(lockoutDurationMs(policy, 9), 60 * MINUTE);
  assert.equal(lockoutDurationMs(policy, -1), 15 * MINUTE);
  assert.equal(lockoutDurationMs(policy, Number.NaN), 15 * MINUTE);
});

test("a failure locks only once the budget is spent, and never re-locks a live lockout", () => {
  const policy = authThrottlePolicy("login:identity");
  assert.equal(shouldLockAfterFailure(null, NOW, policy), false);
  assert.equal(shouldLockAfterFailure(row({ failureCount: 4 }), NOW, policy), false);
  assert.equal(shouldLockAfterFailure(row({ failureCount: 5 }), NOW, policy), true);
  assert.equal(shouldLockAfterFailure(row({ failureCount: 6 }), NOW, policy), true);
  assert.equal(
    shouldLockAfterFailure(row({ failureCount: 6, lockedUntil: NOW + MINUTE }), NOW, policy),
    false,
  );
  assert.equal(
    shouldLockAfterFailure(row({ failureCount: 6, lockedUntil: NOW - MINUTE }), NOW, policy),
    true,
  );
});

test("the displayed wait is parsed strictly and never trusts the query string", () => {
  assert.equal(retryAfterMinutes("900"), 15);
  assert.equal(retryAfterMinutes("1"), 1);
  assert.equal(retryAfterMinutes("61"), 2);
  assert.equal(retryAfterMinutes(undefined), null);
  assert.equal(retryAfterMinutes("0"), null);
  assert.equal(retryAfterMinutes("-60"), null);
  assert.equal(retryAfterMinutes("60.5"), null);
  assert.equal(retryAfterMinutes("1e9"), null);
  assert.equal(retryAfterMinutes(String(MAX_RETRY_AFTER_SECONDS + 1)), null);
  assert.equal(retryAfterMinutes("<script>"), null);
});

test("only the edge-controlled header is trusted as a client address", () => {
  assert.equal(
    trustedClientAddress(new Headers({ "cf-connecting-ip": "203.0.113.7" })),
    "203.0.113.7",
  );
  assert.equal(
    trustedClientAddress(new Headers({ "x-forwarded-for": "203.0.113.7" })),
    null,
  );
  assert.equal(
    trustedClientAddress(
      new Headers({ "cf-connecting-ip": "203.0.113.7, 198.51.100.4" }),
    ),
    null,
  );
  assert.equal(trustedClientAddress(new Headers()), null);
  assert.equal(
    trustedClientAddress(new Headers({ "cf-connecting-ip": " 2001:DB8::1 " })),
    "2001:db8::1",
  );
});

test("address validation accepts real addresses and rejects invented buckets", () => {
  for (const valid of [
    "0.0.0.0",
    "203.0.113.7",
    "255.255.255.255",
    "::1",
    "::",
    "2001:db8::1",
    "2001:0db8:0000:0000:0000:0000:0000:0001",
    "::ffff:203.0.113.7",
  ]) {
    assert.equal(isIpAddress(valid), true, valid);
  }
  for (const invalid of [
    "",
    "203.0.113",
    "203.0.113.256",
    "203.0.113.07",
    "203.0.113.7:443",
    "2001:db8::1::2",
    "2001:db8:0:0:0:0:0:0:1",
    "gggg::1",
    "203.0.113.7 ",
    "localhost",
    "user@example.test",
  ]) {
    assert.equal(isIpAddress(invalid), false, invalid);
  }
});

test("reserve parameters are bound in the order the statement reads them", () => {
  const policy = authThrottlePolicy("login:identity");
  assert.deepEqual(reserveAuthAttemptParams("login:identity", "a".repeat(64), NOW, policy), [
    "login:identity",
    "a".repeat(64),
    NOW,
    NOW,
    NOW,
    policy.windowMs,
    NOW,
    policy.windowMs,
    NOW,
    NOW,
    policy.escalationResetMs,
    NOW,
    NOW,
    policy.maxFailures,
    NOW,
    policy.windowMs,
  ]);
});

test("settlement and cleanup parameters carry the policy the scope declares", () => {
  const policy = authThrottlePolicy("login:identity");
  assert.deepEqual(lockAuthAttemptParams("login:identity", "b".repeat(64), NOW, policy), [
    NOW,
    15 * MINUTE,
    30 * MINUTE,
    60 * MINUTE,
    NOW,
    "login:identity",
    "b".repeat(64),
    policy.maxFailures,
    NOW,
  ]);
  assert.deepEqual(readAuthAttemptParams("login:client", "c".repeat(64)), [
    "login:client",
    "c".repeat(64),
  ]);
  assert.deepEqual(resetAuthAttemptParams("login:identity", "d".repeat(64), NOW), [
    NOW,
    NOW,
    "login:identity",
    "d".repeat(64),
    NOW,
  ]);
  assert.deepEqual(releaseAuthAttemptParams("login:client", "e".repeat(64), NOW), [
    NOW,
    "login:client",
    "e".repeat(64),
    NOW,
  ]);
  assert.deepEqual(cleanupAuthAttemptsParams(NOW), [
    NOW - AUTH_THROTTLE_RETENTION_MS,
    NOW,
    AUTH_THROTTLE_CLEANUP_LIMIT,
  ]);
});

test("cleanup never reclaims a counter that is still doing its job", () => {
  const scopes: readonly AuthThrottleScope[] = AUTH_ATTEMPT_SCOPES;
  const longestBlock = scopes.reduce((longest, scope) => {
    const policy = authThrottlePolicy(scope);
    return Math.max(longest, policy.windowMs, ...policy.lockoutLadderMs);
  }, 0);
  assert.ok(AUTH_THROTTLE_RETENTION_MS > longestBlock);
});
