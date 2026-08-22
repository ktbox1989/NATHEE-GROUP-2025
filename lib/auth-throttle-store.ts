import { getD1 } from "@/db";
import {
  authThrottleDecision,
  authThrottlePolicy,
  authThrottleScopeKey,
  type AuthCounterRow,
  type AuthThrottleScope,
  type AuthThrottleScopeState,
  type AuthThrottleTarget,
} from "@/lib/auth-throttle";
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
} from "@/lib/auth-throttle-sql";

export type AuthThrottleEntry = {
  scope: AuthThrottleScope;
  scopeKey: string;
};

export type AuthThrottleReservation = {
  allowed: boolean;
  retryAfterSeconds: number;
  refusedScopes: readonly AuthThrottleScope[];
  entries: readonly AuthThrottleEntry[];
};

export type AuthAttemptOutcome = "success" | "failure";

type CounterColumns = {
  failure_count: number;
  window_started_at: number;
  locked_until: number | null;
  lockout_count: number;
};

/**
 * Takes one attempt from every scope's budget, before the identity provider is
 * asked anything.
 *
 * Reserving first is what makes the control fail closed: a request that times
 * out, is cancelled, or dies inside the provider call has still spent its
 * attempt. Callers that are refused must not contact the provider at all, and
 * callers that cannot reach this function at all must refuse the request —
 * an unavailable counter is not a licence to guess passwords.
 */
export async function reserveAuthAttempt(
  targets: readonly AuthThrottleTarget[],
  now: number = Date.now(),
): Promise<AuthThrottleReservation> {
  const entries = await Promise.all(
    targets.map(async (target) => ({
      scope: target.scope,
      scopeKey: await authThrottleScopeKey(target.scope, target.subject),
    })),
  );

  const database = getD1();
  const statements = [
    database.prepare(CLEANUP_AUTH_ATTEMPTS_SQL).bind(...cleanupAuthAttemptsParams(now)),
    ...entries.flatMap((entry) => {
      const policy = authThrottlePolicy(entry.scope);
      return [
        database
          .prepare(RESERVE_AUTH_ATTEMPT_SQL)
          .bind(...reserveAuthAttemptParams(entry.scope, entry.scopeKey, now, policy)),
        database
          .prepare(READ_AUTH_ATTEMPT_SQL)
          .bind(...readAuthAttemptParams(entry.scope, entry.scopeKey)),
      ];
    }),
  ];

  const results = await database.batch<CounterColumns>(statements);
  const states: AuthThrottleScopeState[] = entries.map((entry, index) => ({
    scope: entry.scope,
    reserved: (results[1 + index * 2]?.results?.length ?? 0) > 0,
    row: toCounterRow(results[2 + index * 2]?.results?.[0]),
  }));

  const decision = authThrottleDecision(states, now);
  const reserved = entries.filter((_, index) => states[index].reserved);

  // Nothing was asked of the provider, so a scope that did accept must not be
  // charged for an attempt another scope refused. Releasing here keeps a single
  // locked-out account from consuming a shared office address's budget.
  if (!decision.allowed && reserved.length > 0) {
    await releaseEntries(reserved, now);
  }

  return {
    allowed: decision.allowed,
    retryAfterSeconds: decision.retryAfterSeconds,
    refusedScopes: decision.refusedScopes,
    entries: decision.allowed ? reserved : [],
  };
}

/**
 * Records what the provider actually said.
 *
 * A failure escalates an exhausted window into a lockout. A success releases
 * according to each scope's policy. If this write is lost the attempt still
 * stands as spent, and the window budget alone continues to refuse further
 * attempts — the lockout only ever extends a refusal, never creates the
 * possibility of one.
 */
export async function settleAuthAttempt(
  reservation: AuthThrottleReservation,
  outcome: AuthAttemptOutcome,
  now: number = Date.now(),
): Promise<void> {
  if (reservation.entries.length === 0) return;

  const database = getD1();
  const statements = reservation.entries.flatMap((entry) => {
    const policy = authThrottlePolicy(entry.scope);
    if (outcome === "failure") {
      return [
        database
          .prepare(LOCK_AUTH_ATTEMPT_SQL)
          .bind(...lockAuthAttemptParams(entry.scope, entry.scopeKey, now, policy)),
      ];
    }
    if (policy.releaseOnSuccess === "reset") {
      return [
        database
          .prepare(RESET_AUTH_ATTEMPT_SQL)
          .bind(...resetAuthAttemptParams(entry.scope, entry.scopeKey, now)),
      ];
    }
    if (policy.releaseOnSuccess === "undo") {
      return [
        database
          .prepare(RELEASE_AUTH_ATTEMPT_SQL)
          .bind(...releaseAuthAttemptParams(entry.scope, entry.scopeKey, now)),
      ];
    }
    return [];
  });

  if (statements.length === 0) return;
  await database.batch(statements);
}

async function releaseEntries(
  entries: readonly AuthThrottleEntry[],
  now: number,
): Promise<void> {
  const database = getD1();
  await database.batch(
    entries.map((entry) =>
      database
        .prepare(RELEASE_AUTH_ATTEMPT_SQL)
        .bind(...releaseAuthAttemptParams(entry.scope, entry.scopeKey, now)),
    ),
  );
}

function toCounterRow(columns: CounterColumns | undefined): AuthCounterRow | null {
  if (!columns) return null;
  return {
    failureCount: columns.failure_count,
    windowStartedAt: columns.window_started_at,
    lockedUntil: columns.locked_until,
    lockoutCount: columns.lockout_count,
  };
}
