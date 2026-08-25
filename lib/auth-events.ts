/**
 * The Audit trail records what people did once they were inside the
 * application. It records nothing about getting in.
 *
 * That is the gap this closes. If an account is compromised, the Owner today has
 * no way to see that it was used at all — only what it changed, and only if it
 * changed something. A sign-in trail is what turns "this role assignment looks
 * wrong" into "and it was done from a session that started at 03:12, when nobody
 * was working".
 *
 * What is deliberately *not* recorded is the client address. It would help, but
 * it makes the Audit table a permanent location log of the Owner's own staff,
 * and the retention and consent that implies is the Owner's decision, not a
 * default this code should quietly take. Everything here is derivable from what
 * the application already stores.
 */

export const AUTH_EVENT_ACTIONS = ["SIGN_IN", "SIGN_IN_DENIED", "PASSWORD_CHANGED"] as const;
export type AuthEventAction = (typeof AUTH_EVENT_ACTIONS)[number];

/** How the person proved they were entitled to what they just did. */
export const AUTH_EVENT_METHODS = [
  "password",
  "recovery_link",
  "current_password",
  "owner_pin",
] as const;
export type AuthEventMethod = (typeof AUTH_EVENT_METHODS)[number];

/** Audit rows about getting in describe a session, not a business record. */
export const AUTH_EVENT_ENTITY_TYPE = "session";

export function isAuthEventMethod(value: string): value is AuthEventMethod {
  return (AUTH_EVENT_METHODS as readonly string[]).includes(value);
}

/**
 * The `after_json` payload. Small and fixed on purpose: an unauthenticated
 * caller influences when these rows are written, so nothing it supplies is
 * stored.
 */
export function authEventDetail(method: AuthEventMethod): string {
  return JSON.stringify({ method });
}
