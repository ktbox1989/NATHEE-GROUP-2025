import { recordTimestamp } from "./timestamps.ts";
import {
  ownerBootstrapOutcome,
  ownerIdentityState,
  ownerPinActorFrom,
  type OwnerBootstrapOutcome,
  type OwnerIdentityRow,
  type OwnerPinActor,
} from "./owner-pin-identity.ts";
import {
  ENSURE_OWNER_PIN_ROLE_SQL,
  ENSURE_OWNER_PIN_USER_SQL,
  READ_OWNER_PIN_IDENTITY_SQL,
  RECORD_OWNER_PIN_BOOTSTRAP_SQL,
  ensureOwnerPinRoleParams,
  ensureOwnerPinUserParams,
  readOwnerPinIdentityParams,
  recordOwnerPinBootstrapParams,
} from "./owner-pin-sql.ts";
import {
  ownerCredentialFingerprint,
  verifyOwnerSessionToken,
  type OwnerPinAuthConfig,
} from "./owner-pin.ts";

/**
 * The D1 side of the Owner PIN, kept free of the `cloudflare:workers` binding so
 * the same functions that run in Production can be run in a test against the
 * real migrated schema. Callers pass the database; nothing here reaches for one.
 */

export async function readOwnerPinIdentityRows(
  database: D1Database,
): Promise<readonly OwnerIdentityRow[]> {
  const result = await database
    .prepare(READ_OWNER_PIN_IDENTITY_SQL)
    .bind(...readOwnerPinIdentityParams())
    .all<OwnerIdentityRow>();
  return result.results ?? [];
}

/**
 * Makes the canonical Owner exist, or explains why it must not.
 *
 * The common path — every login after the first — is a single indexed read that
 * writes nothing. Only an absent identity reaches the batch, and every statement
 * in that batch is guarded, so two first logins racing each other produce one
 * account and one audit row rather than an error either of them has to interpret.
 *
 * A failed batch is not reported as a failure. What matters is the state the
 * database is actually in afterwards, so the answer always comes from a read
 * rather than from what a write believed it did.
 */
export async function ensureOwnerPinIdentity(
  database: D1Database,
  now: number = Date.now(),
): Promise<OwnerBootstrapOutcome> {
  const existing = ownerIdentityState(await readOwnerPinIdentityRows(database));
  if (existing.state !== "absent") return ownerBootstrapOutcome(existing, false);

  try {
    await database.batch([
      database
        .prepare(ENSURE_OWNER_PIN_USER_SQL)
        .bind(...ensureOwnerPinUserParams(crypto.randomUUID())),
      database.prepare(ENSURE_OWNER_PIN_ROLE_SQL).bind(...ensureOwnerPinRoleParams()),
      database
        .prepare(RECORD_OWNER_PIN_BOOTSTRAP_SQL)
        .bind(
          ...recordOwnerPinBootstrapParams(crypto.randomUUID(), recordTimestamp(new Date(now))),
        ),
    ]);
  } catch {
    // Another request may have won the race and written the same rows. The read
    // below decides; a lost batch cannot turn a healthy account into a refusal,
    // and cannot turn a conflict into an acceptance either.
  }

  return ownerBootstrapOutcome(ownerIdentityState(await readOwnerPinIdentityRows(database)), true);
}

export type OwnerPinSessionInput = {
  /** The raw cookie value, as received. */
  token: string | undefined | null;
  config: OwnerPinAuthConfig | null;
  database: D1Database;
  now?: number;
};

/**
 * The actor a valid Owner PIN cookie stands for, or nothing.
 *
 * The cookie proves only that this runtime issued it under the credential that
 * is configured *right now*. Whether the account may still act is a question
 * only the database answers, and it is asked on every request: a deactivated
 * Owner, or one whose role assignment has been changed, stops being an actor
 * immediately rather than when the cookie happens to expire.
 */
export async function resolveOwnerPinSession(
  input: OwnerPinSessionInput,
): Promise<OwnerPinActor | null> {
  if (!input.config) return null;

  const payload = await verifyOwnerSessionToken({
    token: input.token,
    secret: input.config.sessionSecret,
    fingerprint: await ownerCredentialFingerprint(input.config.encodedCredential),
    now: input.now ?? Date.now(),
  });
  if (!payload) return null;

  const state = ownerIdentityState(await readOwnerPinIdentityRows(input.database));
  if (state.state !== "bound") return null;

  const actor = ownerPinActorFrom(state.row);
  // The cookie names the row it was issued for. A row recreated under a new id
  // is a different account, and an old cookie must not act as it.
  if (!actor || actor.userId !== payload.sub) return null;
  return actor;
}
