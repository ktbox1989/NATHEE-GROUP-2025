import { getD1 } from "@/db";
import type { AuthEventAction, AuthEventMethod } from "@/lib/auth-events";
import {
  RECORD_AUTH_EVENT_SQL,
  RECORD_SIGN_IN_SQL,
  recordAuthEventParams,
  recordSignInParams,
} from "@/lib/auth-events-sql";
import { recordTimestamp } from "@/lib/timestamps";

/**
 * Records that someone got in, or was refused after presenting valid provider
 * credentials.
 *
 * The action is decided by SQL from the application user's own status, so a
 * deactivated account that still holds working provider credentials is recorded
 * as refused rather than as a sign-in. An identity with no application user is
 * recorded not at all.
 */
export async function recordSignInEvent(
  externalAuthId: string,
  method: AuthEventMethod,
  now: number = Date.now(),
): Promise<void> {
  await getD1()
    .prepare(RECORD_SIGN_IN_SQL)
    .bind(
      ...recordSignInParams(
        crypto.randomUUID(),
        method,
        recordTimestamp(new Date(now)),
        externalAuthId,
      ),
    )
    .run();
}

export async function recordAuthEvent(
  externalAuthId: string,
  action: AuthEventAction,
  method: AuthEventMethod,
  now: number = Date.now(),
): Promise<void> {
  await getD1()
    .prepare(RECORD_AUTH_EVENT_SQL)
    .bind(
      ...recordAuthEventParams(
        crypto.randomUUID(),
        action,
        method,
        recordTimestamp(new Date(now)),
        externalAuthId,
      ),
    )
    .run();
}
