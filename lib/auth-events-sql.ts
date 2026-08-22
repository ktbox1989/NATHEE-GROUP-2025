import { AUTH_EVENT_ENTITY_TYPE, type AuthEventAction, type AuthEventMethod } from "./auth-events.ts";
import { authEventDetail } from "./auth-events.ts";

/**
 * One statement, keyed on the provider identity, so the row is written from the
 * authoritative `users` row rather than from anything the caller supplied.
 *
 * `INSERT ... SELECT` rather than read-then-write matters twice here. It cannot
 * record an actor that does not exist, and it cannot record a stale role or
 * company: the values come from the same read that decides whether to write at
 * all. An identity with no application user writes nothing, which is what keeps
 * this bounded — a stranger who created an account at the identity provider
 * cannot make the Owner's Audit table grow.
 */
export const RECORD_SIGN_IN_SQL = `
  INSERT INTO audit_logs
    (id, actor_user_id, company_id, action, entity_type, entity_id,
     before_json, after_json, reason, created_at)
  SELECT ?, u.id, u.company_id,
         CASE WHEN u.status = 'ACTIVE' THEN 'SIGN_IN' ELSE 'SIGN_IN_DENIED' END,
         ?, u.id, NULL, ?, NULL, ?
  FROM users u
  WHERE u.external_auth_id = ?
`;

export function recordSignInParams(
  auditId: string,
  method: AuthEventMethod,
  recordedAt: string,
  externalAuthId: string,
): ReadonlyArray<string> {
  return [auditId, AUTH_EVENT_ENTITY_TYPE, authEventDetail(method), recordedAt, externalAuthId];
}

/**
 * The same shape for a completed password change. The action is fixed rather
 * than derived, because a password change is only ever reached after the route
 * has accepted a proof.
 */
export const RECORD_AUTH_EVENT_SQL = `
  INSERT INTO audit_logs
    (id, actor_user_id, company_id, action, entity_type, entity_id,
     before_json, after_json, reason, created_at)
  SELECT ?, u.id, u.company_id, ?, ?, u.id, NULL, ?, NULL, ?
  FROM users u
  WHERE u.external_auth_id = ?
`;

export function recordAuthEventParams(
  auditId: string,
  action: AuthEventAction,
  method: AuthEventMethod,
  recordedAt: string,
  externalAuthId: string,
): ReadonlyArray<string> {
  return [
    auditId,
    action,
    AUTH_EVENT_ENTITY_TYPE,
    authEventDetail(method),
    recordedAt,
    externalAuthId,
  ];
}
