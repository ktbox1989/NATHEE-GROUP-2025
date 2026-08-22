import {
  AUTH_THROTTLE_CLEANUP_LIMIT,
  AUTH_THROTTLE_RETENTION_MS,
  lockoutDurationMs,
  type AuthThrottlePolicy,
  type AuthThrottleScope,
} from "./auth-throttle.ts";

/**
 * Every statement here is a single atomic step. The counters are written by
 * unauthenticated requests that can arrive concurrently, so nothing may be
 * implemented as read-then-write in application code: a lost increment is a
 * free extra guess.
 *
 * Parameters are anonymous `?` markers because D1 binds positionally. Each
 * statement therefore ships with a builder that produces its argument list, and
 * the builders are covered by tests so the ordering cannot drift.
 */

/**
 * Reserves one attempt. The `ON CONFLICT` guard refuses the write while the row
 * is locked, or while the window budget is already spent, so a refused attempt
 * does not inflate the counter. `RETURNING` is the discriminator: rows come back
 * only when the reservation was actually taken.
 */
export const RESERVE_AUTH_ATTEMPT_SQL = `
  INSERT INTO auth_attempt_counters
    (scope, scope_key, failure_count, window_started_at, locked_until, lockout_count, updated_at)
  VALUES (?, ?, 1, ?, NULL, 0, ?)
  ON CONFLICT(scope, scope_key) DO UPDATE SET
    failure_count = CASE WHEN ? - window_started_at >= ? THEN 1 ELSE failure_count + 1 END,
    window_started_at = CASE WHEN ? - window_started_at >= ? THEN ? ELSE window_started_at END,
    lockout_count = CASE
      WHEN ? - COALESCE(locked_until, window_started_at) >= ? THEN 0
      ELSE lockout_count
    END,
    locked_until = NULL,
    updated_at = ?
  WHERE (locked_until IS NULL OR locked_until <= ?)
    AND (failure_count < ? OR ? - window_started_at >= ?)
  RETURNING failure_count, window_started_at, locked_until, lockout_count
`;

export function reserveAuthAttemptParams(
  scope: AuthThrottleScope,
  scopeKey: string,
  now: number,
  policy: AuthThrottlePolicy,
): ReadonlyArray<string | number> {
  return [
    scope,
    scopeKey,
    now,
    now,
    now,
    policy.windowMs,
    now,
    policy.windowMs,
    now,
    now,
    policy.escalationResetMs,
    now,
    now,
    policy.maxFailures,
    now,
    policy.windowMs,
  ];
}

export const READ_AUTH_ATTEMPT_SQL = `
  SELECT failure_count, window_started_at, locked_until, lockout_count
  FROM auth_attempt_counters
  WHERE scope = ? AND scope_key = ?
`;

export function readAuthAttemptParams(
  scope: AuthThrottleScope,
  scopeKey: string,
): ReadonlyArray<string | number> {
  return [scope, scopeKey];
}

/**
 * Converts an exhausted window into an explicit lockout, escalating the ladder
 * step. The `failure_count >= ?` guard makes this safe to run after every failed
 * attempt: below the budget it matches nothing.
 */
export const LOCK_AUTH_ATTEMPT_SQL = `
  UPDATE auth_attempt_counters
  SET lockout_count = lockout_count + 1,
      locked_until = ? + CASE
        WHEN lockout_count <= 0 THEN ?
        WHEN lockout_count = 1 THEN ?
        ELSE ?
      END,
      updated_at = ?
  WHERE scope = ? AND scope_key = ?
    AND failure_count >= ?
    AND (locked_until IS NULL OR locked_until <= ?)
`;

export function lockAuthAttemptParams(
  scope: AuthThrottleScope,
  scopeKey: string,
  now: number,
  policy: AuthThrottlePolicy,
): ReadonlyArray<string | number> {
  return [
    now,
    lockoutDurationMs(policy, 0),
    lockoutDurationMs(policy, 1),
    lockoutDurationMs(policy, 2),
    now,
    scope,
    scopeKey,
    policy.maxFailures,
    now,
  ];
}

/** A proven identity clears its own budget. */
export const RESET_AUTH_ATTEMPT_SQL = `
  UPDATE auth_attempt_counters
  SET failure_count = 0, window_started_at = ?, locked_until = NULL, updated_at = ?
  WHERE scope = ? AND scope_key = ? AND (locked_until IS NULL OR locked_until <= ?)
`;

export function resetAuthAttemptParams(
  scope: AuthThrottleScope,
  scopeKey: string,
  now: number,
): ReadonlyArray<string | number> {
  return [now, now, scope, scopeKey, now];
}

/** Gives back exactly the one reservation an attempt took, never more. */
export const RELEASE_AUTH_ATTEMPT_SQL = `
  UPDATE auth_attempt_counters
  SET failure_count = CASE WHEN failure_count > 0 THEN failure_count - 1 ELSE 0 END,
      updated_at = ?
  WHERE scope = ? AND scope_key = ? AND (locked_until IS NULL OR locked_until <= ?)
`;

export function releaseAuthAttemptParams(
  scope: AuthThrottleScope,
  scopeKey: string,
  now: number,
): ReadonlyArray<string | number> {
  return [now, scope, scopeKey, now];
}

/**
 * Bounded reclamation. Without it an attacker choosing a fresh subject per
 * request would grow the table without limit; with it the table only holds
 * counters that are still meaningful.
 */
export const CLEANUP_AUTH_ATTEMPTS_SQL = `
  DELETE FROM auth_attempt_counters
  WHERE rowid IN (
    SELECT rowid FROM auth_attempt_counters
    WHERE updated_at < ? AND (locked_until IS NULL OR locked_until <= ?)
    ORDER BY updated_at
    LIMIT ?
  )
`;

export function cleanupAuthAttemptsParams(now: number): ReadonlyArray<number> {
  return [now - AUTH_THROTTLE_RETENTION_MS, now, AUTH_THROTTLE_CLEANUP_LIMIT];
}
