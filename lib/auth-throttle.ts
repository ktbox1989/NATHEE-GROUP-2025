import { AUTH_ATTEMPT_SCOPES } from "../db/schema.ts";

/**
 * Server-side attempt budgets for the two unauthenticated Auth endpoints.
 *
 * Supabase applies its own provider-side limits, but they are global to the
 * project and invisible to this application: they cannot lock a single targeted
 * account, they cannot be reasoned about in a test, and a Production runtime
 * cannot prove they are in force. These budgets are the application's own
 * control and are enforced before any provider call.
 *
 * Every attempt is reserved *before* the provider is asked, so a crashed or
 * timed-out request still consumes budget. A successful password login releases
 * its identity reservation; nothing else is released.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type AuthThrottleScope = (typeof AUTH_ATTEMPT_SCOPES)[number];

/**
 * `reset` returns the counter to zero (a correct password proves the account is
 * not under a successful guess). `undo` only gives back the one reservation, so
 * an attacker who owns a valid account cannot clear a shared client budget
 * between guesses. `consume` never releases: password recovery has no failure
 * signal, because the response is deliberately identical whether or not the
 * address exists.
 */
export type AuthThrottleRelease = "reset" | "undo" | "consume";

export type AuthThrottlePolicy = {
  windowMs: number;
  maxFailures: number;
  lockoutLadderMs: readonly [number, number, number];
  escalationResetMs: number;
  releaseOnSuccess: AuthThrottleRelease;
};

export const AUTH_THROTTLE_POLICIES: Record<AuthThrottleScope, AuthThrottlePolicy> = {
  // One account, any source. Stops password guessing against a known address —
  // including the OWNER — even when the guesses are spread across many clients.
  "login:identity": {
    windowMs: 15 * MINUTE,
    maxFailures: 5,
    lockoutLadderMs: [15 * MINUTE, 30 * MINUTE, 60 * MINUTE],
    escalationResetMs: 24 * HOUR,
    releaseOnSuccess: "reset",
  },
  // One client, any account. Stops password spraying across many addresses. The
  // budget is deliberately far above the identity budget so that a shared office
  // address is not locked out by ordinary mistyping.
  "login:client": {
    windowMs: 15 * MINUTE,
    maxFailures: 20,
    lockoutLadderMs: [15 * MINUTE, 30 * MINUTE, 60 * MINUTE],
    escalationResetMs: 24 * HOUR,
    releaseOnSuccess: "undo",
  },
  // Recovery mail is a real cost and a real inbox. An unbounded endpoint lets
  // anyone bomb a mailbox and exhaust the provider's send quota, which would
  // deny recovery to the account that actually needs it.
  "recovery:identity": {
    windowMs: HOUR,
    maxFailures: 3,
    lockoutLadderMs: [HOUR, HOUR, HOUR],
    escalationResetMs: 24 * HOUR,
    releaseOnSuccess: "consume",
  },
  "recovery:client": {
    windowMs: HOUR,
    maxFailures: 15,
    lockoutLadderMs: [HOUR, HOUR, HOUR],
    escalationResetMs: 24 * HOUR,
    releaseOnSuccess: "consume",
  },
};

/** Untouched, unlocked counters are removed after this long; they carry no history worth keeping. */
export const AUTH_THROTTLE_RETENTION_MS = 24 * HOUR;

/** Upper bound on rows one attempt may reclaim, so cleanup cost stays constant. */
export const AUTH_THROTTLE_CLEANUP_LIMIT = 50;

/**
 * Bucket used when no trusted client address is available. Every such request
 * shares one budget rather than escaping the client scope entirely.
 */
export const UNKNOWN_CLIENT_SUBJECT = "unknown-client";

/** Clamp reported wait times so a caller cannot be told to wait for an absurd period. */
export const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

export type AuthCounterRow = {
  failureCount: number;
  windowStartedAt: number;
  lockedUntil: number | null;
  lockoutCount: number;
};

export function isAuthThrottleScope(value: string): value is AuthThrottleScope {
  return (AUTH_ATTEMPT_SCOPES as readonly string[]).includes(value);
}

export function authThrottlePolicy(scope: AuthThrottleScope): AuthThrottlePolicy {
  return AUTH_THROTTLE_POLICIES[scope];
}

/**
 * The subject a scope counts. Identity subjects are normalised the same way the
 * login route normalises the submitted address, so "Owner@X" and "owner@x "
 * share one budget and cannot be used to buy extra attempts.
 */
export function normalizeIdentitySubject(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return normalized && normalized.length <= 254 ? normalized : null;
}

export function normalizeClientSubject(clientIp: string | null): string {
  const normalized = clientIp?.trim().toLowerCase() ?? "";
  return normalized || UNKNOWN_CLIENT_SUBJECT;
}

/**
 * Scope keys are SHA-256 hex digests. The counter only ever compares subjects,
 * so it never needs to read one back, and the table cannot accumulate a list of
 * email addresses typed at the login form or of client addresses that reached
 * it. The scope is mixed in so the same subject cannot be correlated across
 * scopes by digest alone.
 */
export async function authThrottleScopeKey(
  scope: AuthThrottleScope,
  subject: string,
): Promise<string> {
  const encoded = new TextEncoder().encode(`nathee-auth-throttle:v1:${scope}:${subject}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function lockoutDurationMs(policy: AuthThrottlePolicy, lockoutCount: number): number {
  const ladder = policy.lockoutLadderMs;
  if (!Number.isFinite(lockoutCount) || lockoutCount <= 0) return ladder[0];
  return ladder[Math.min(Math.trunc(lockoutCount), ladder.length - 1)];
}

/**
 * Seconds a refused caller must wait. A refusal is either an explicit lockout or
 * an exhausted window, and the window remainder is the honest answer in the
 * second case: waiting it out is exactly what restores the budget.
 */
export function retryAfterSeconds(
  row: AuthCounterRow | null,
  now: number,
  policy: AuthThrottlePolicy,
): number {
  if (!row) return 1;
  const lockedUntil = row.lockedUntil ?? 0;
  const windowEndsAt = row.windowStartedAt + policy.windowMs;
  const waitMs = Math.max(lockedUntil - now, windowEndsAt - now);
  if (waitMs <= 0) return 1;
  return Math.min(Math.ceil(waitMs / 1000), MAX_RETRY_AFTER_SECONDS);
}

export type AuthThrottleScopeState = {
  scope: AuthThrottleScope;
  reserved: boolean;
  row: AuthCounterRow | null;
};

export type AuthThrottleDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  refusedScopes: readonly AuthThrottleScope[];
};

/**
 * A reservation succeeds only when every scope accepted it. A scope that did not
 * accept is refused; the caller waits for the longest refusal.
 */
export function authThrottleDecision(
  states: readonly AuthThrottleScopeState[],
  now: number,
): AuthThrottleDecision {
  const refused = states.filter((state) => !state.reserved);
  if (refused.length === 0) {
    return { allowed: true, retryAfterSeconds: 0, refusedScopes: [] };
  }
  const wait = refused.reduce(
    (longest, state) =>
      Math.max(longest, retryAfterSeconds(state.row, now, authThrottlePolicy(state.scope))),
    1,
  );
  return {
    allowed: false,
    retryAfterSeconds: wait,
    refusedScopes: refused.map((state) => state.scope),
  };
}

/**
 * Whole minutes to show a refused caller, from the `retryAfter` query parameter
 * the Auth routes attach to their redirect. The value only ever shortens a wait
 * the caller is already serving, so it is not a secret, but it is still parsed
 * strictly: anything that is not a plausible second count renders no number
 * rather than a wrong or attacker-chosen one.
 */
export function retryAfterMinutes(value: string | undefined): number | null {
  if (!value || !/^[0-9]{1,6}$/.test(value)) return null;
  const seconds = Number(value);
  if (seconds < 1 || seconds > MAX_RETRY_AFTER_SECONDS) return null;
  return Math.max(1, Math.ceil(seconds / 60));
}

export type AuthThrottleTarget = {
  scope: AuthThrottleScope;
  subject: string;
};

/**
 * The pair of budgets one unauthenticated attempt spends. Both are always
 * present: the identity scope alone would let a spray across many addresses
 * pass unnoticed, and the client scope alone would let a distributed guess at
 * one account pass unnoticed.
 */
export function authThrottleTargets(
  kind: "login" | "recovery",
  identitySubject: string,
  clientIp: string | null,
): readonly AuthThrottleTarget[] {
  return [
    { scope: `${kind}:client`, subject: normalizeClientSubject(clientIp) },
    { scope: `${kind}:identity`, subject: identitySubject },
  ];
}

/**
 * True when a settled failure should convert the exhausted window into an
 * explicit lockout. The reservation already wrote the count, so this reads the
 * post-reservation row.
 */
export function shouldLockAfterFailure(
  row: AuthCounterRow | null,
  now: number,
  policy: AuthThrottlePolicy,
): boolean {
  if (!row) return false;
  if ((row.lockedUntil ?? 0) > now) return false;
  return row.failureCount >= policy.maxFailures;
}
