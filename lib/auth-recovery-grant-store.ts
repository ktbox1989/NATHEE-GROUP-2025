import { getD1 } from "@/db";
import {
  createRecoveryGrantToken,
  recoveryGrantDigest,
  RECOVERY_GRANT_TTL_MS,
} from "@/lib/auth-recovery-grant";
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
} from "@/lib/auth-recovery-grant-sql";

/**
 * Mints the token the browser receives, and records only its digest.
 *
 * Issuing also drops every older unused grant for the same identity, so a second
 * recovery link invalidates the first rather than leaving two keys in play.
 */
export async function issueRecoveryGrant(
  externalAuthId: string,
  now: number = Date.now(),
): Promise<string> {
  const token = createRecoveryGrantToken();
  const digest = await recoveryGrantDigest(token);
  const database = getD1();

  await database.batch([
    database.prepare(CLEANUP_RECOVERY_GRANTS_SQL).bind(...cleanupRecoveryGrantsParams(now)),
    database
      .prepare(ISSUE_RECOVERY_GRANT_SQL)
      .bind(...issueRecoveryGrantParams(digest, externalAuthId, now, RECOVERY_GRANT_TTL_MS)),
    database
      .prepare(SUPERSEDE_RECOVERY_GRANTS_SQL)
      .bind(...supersedeRecoveryGrantsParams(externalAuthId, digest)),
  ]);

  return token;
}

/**
 * Spends a grant. Returns true only for the one caller that took it: the write
 * is conditional, so a replayed, expired, or differently-bound token cannot
 * authorise a second password change.
 */
export async function consumeRecoveryGrant(
  token: string,
  externalAuthId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const digest = await recoveryGrantDigest(token);
  const result = await getD1()
    .prepare(CONSUME_RECOVERY_GRANT_SQL)
    .bind(...consumeRecoveryGrantParams(digest, externalAuthId, now))
    .all<{ id: string }>();
  return (result.results?.length ?? 0) > 0;
}

/**
 * Read-only. Used by the reset page to decide whether to ask for the current
 * password; rendering a page must never spend a grant.
 */
export async function hasUsableRecoveryGrant(
  token: string,
  externalAuthId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const digest = await recoveryGrantDigest(token);
  const row = await getD1()
    .prepare(PEEK_RECOVERY_GRANT_SQL)
    .bind(...peekRecoveryGrantParams(digest, externalAuthId, now))
    .first<{ id: string }>();
  return row !== null;
}
