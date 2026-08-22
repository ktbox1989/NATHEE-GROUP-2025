import {
  RECOVERY_GRANT_CLEANUP_LIMIT,
  RECOVERY_GRANT_RETENTION_MS,
} from "./auth-recovery-grant.ts";

/**
 * Grant lifecycle statements. Consumption in particular must be a single
 * conditional write: checking a grant and then marking it used would let two
 * simultaneous requests both spend the same one.
 */

export const ISSUE_RECOVERY_GRANT_SQL = `
  INSERT INTO auth_recovery_grants (id, external_auth_id, issued_at, expires_at, consumed_at)
  VALUES (?, ?, ?, ?, NULL)
`;

export function issueRecoveryGrantParams(
  digest: string,
  externalAuthId: string,
  now: number,
  ttlMs: number,
): ReadonlyArray<string | number> {
  return [digest, externalAuthId, now, now + ttlMs];
}

/** A new link supersedes every older unused one for the same identity. */
export const SUPERSEDE_RECOVERY_GRANTS_SQL = `
  DELETE FROM auth_recovery_grants
  WHERE external_auth_id = ? AND consumed_at IS NULL AND id <> ?
`;

export function supersedeRecoveryGrantsParams(
  externalAuthId: string,
  keptDigest: string,
): ReadonlyArray<string> {
  return [externalAuthId, keptDigest];
}

/**
 * Single-use consumption. `RETURNING` reports whether this caller is the one
 * that spent the grant; an expired, already-spent, or differently-bound grant
 * matches nothing and returns nothing.
 */
export const CONSUME_RECOVERY_GRANT_SQL = `
  UPDATE auth_recovery_grants
  SET consumed_at = ?
  WHERE id = ?
    AND external_auth_id = ?
    AND consumed_at IS NULL
    AND expires_at > ?
  RETURNING id
`;

export function consumeRecoveryGrantParams(
  digest: string,
  externalAuthId: string,
  now: number,
): ReadonlyArray<string | number> {
  return [now, digest, externalAuthId, now];
}

/**
 * Read-only check used to decide whether the form should ask for the current
 * password. It must never consume, or rendering the page would spend the grant.
 */
export const PEEK_RECOVERY_GRANT_SQL = `
  SELECT id FROM auth_recovery_grants
  WHERE id = ? AND external_auth_id = ? AND consumed_at IS NULL AND expires_at > ?
`;

export function peekRecoveryGrantParams(
  digest: string,
  externalAuthId: string,
  now: number,
): ReadonlyArray<string | number> {
  return [digest, externalAuthId, now];
}

export const CLEANUP_RECOVERY_GRANTS_SQL = `
  DELETE FROM auth_recovery_grants
  WHERE rowid IN (
    SELECT rowid FROM auth_recovery_grants
    WHERE expires_at < ? OR consumed_at < ?
    ORDER BY expires_at
    LIMIT ?
  )
`;

export function cleanupRecoveryGrantsParams(now: number): ReadonlyArray<number> {
  return [now, now - RECOVERY_GRANT_RETENTION_MS, RECOVERY_GRANT_CLEANUP_LIMIT];
}
