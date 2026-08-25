import { OWNER_DISPLAY_NAME, OWNER_EMAIL, OWNER_EXTERNAL_AUTH_ID } from "./owner-pin.ts";

/**
 * The canonical Owner row, written against the existing schema and no other.
 *
 * There is no migration here and there is nothing new to migrate: the Owner PIN
 * occupies the same `users` row, the same `user_role_assignments` row and the
 * same `audit_logs` trail as every other account, and is distinguished only by
 * the `external_auth_id` it holds.
 *
 * Every statement is `INSERT ... SELECT ... WHERE NOT EXISTS`, so the whole
 * bootstrap is idempotent and safe to run on every single login. That matters
 * more than it looks: the alternative — a one-time flag somewhere — is a second
 * source of truth about whether the Owner exists, and the day it disagrees with
 * the database is the day the Owner cannot get in.
 *
 * `created_at` and `updated_at` are left to the schema's own
 * `CURRENT_TIMESTAMP` default, except in the audit row, where the caller
 * supplies the value in the form `lib/timestamps.ts` requires.
 */

export const OWNER_BOOTSTRAP_AUDIT_ACTION = "BOOTSTRAP_OWNER_PIN_IDENTITY";

/**
 * Guarded twice on purpose. The identity guard makes a repeat run a no-op; the
 * address guard is what refuses to create a second account when the canonical
 * address is already held by someone else, so a conflict ends as "nothing was
 * written" rather than as a unique-index error after a partial batch.
 */
export const ENSURE_OWNER_PIN_USER_SQL = `
  INSERT INTO users (id, external_auth_id, email, username, display_name, role, company_id, status)
  SELECT ?, ?, ?, NULL, ?, 'OWNER', NULL, 'ACTIVE'
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE external_auth_id = ?)
    AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)
`;

export function ensureOwnerPinUserParams(userId: string): ReadonlyArray<string> {
  return [
    userId,
    OWNER_EXTERNAL_AUTH_ID,
    OWNER_EMAIL,
    OWNER_DISPLAY_NAME,
    OWNER_EXTERNAL_AUTH_ID,
    OWNER_EMAIL,
  ];
}

/**
 * The explicit assignment, because `user_role_assignments` is authoritative and
 * the legacy `users.role` column is only a fallback. Keyed on the identity *and*
 * the address together, so this statement can never write an OWNER assignment
 * onto an account that merely shares one of them.
 */
export const ENSURE_OWNER_PIN_ROLE_SQL = `
  INSERT INTO user_role_assignments (user_id, role, assigned_by)
  SELECT u.id, 'OWNER', u.id
  FROM users u
  WHERE u.external_auth_id = ?
    AND u.email = ?
    AND NOT EXISTS (SELECT 1 FROM user_role_assignments r WHERE r.user_id = u.id)
`;

export function ensureOwnerPinRoleParams(): ReadonlyArray<string> {
  return [OWNER_EXTERNAL_AUTH_ID, OWNER_EMAIL];
}

/**
 * Creating the account that can do anything must leave the same evidence as
 * every other privileged change. Written once: a repeat login adds no row.
 */
export const RECORD_OWNER_PIN_BOOTSTRAP_SQL = `
  INSERT INTO audit_logs
    (id, actor_user_id, company_id, action, entity_type, entity_id,
     before_json, after_json, reason, created_at)
  SELECT ?, u.id, NULL, ?, 'user', u.id, NULL,
         json_object('role', 'OWNER', 'status', 'ACTIVE', 'authMethod', 'owner_pin'),
         'First Owner PIN sign-in created the canonical Owner account', ?
  FROM users u
  WHERE u.external_auth_id = ?
    AND u.email = ?
    AND NOT EXISTS (
      SELECT 1 FROM audit_logs a WHERE a.entity_id = u.id AND a.action = ?
    )
`;

export function recordOwnerPinBootstrapParams(
  auditId: string,
  recordedAt: string,
): ReadonlyArray<string> {
  return [
    auditId,
    OWNER_BOOTSTRAP_AUDIT_ACTION,
    recordedAt,
    OWNER_EXTERNAL_AUTH_ID,
    OWNER_EMAIL,
    OWNER_BOOTSTRAP_AUDIT_ACTION,
  ];
}

/**
 * Everything that holds the canonical identity *or* the canonical address.
 *
 * The `OR` is the point. Reading only by identity would miss the account that
 * already owns the address, which is precisely the case that must refuse rather
 * than proceed. Both columns are uniquely indexed, so this is two index probes
 * and returns at most two rows.
 */
export const READ_OWNER_PIN_IDENTITY_SQL = `
  SELECT u.id AS id,
         u.external_auth_id AS external_auth_id,
         u.email AS email,
         u.display_name AS display_name,
         u.company_id AS company_id,
         u.status AS status,
         u.role AS legacy_role,
         r.role AS assigned_role
  FROM users u
  LEFT JOIN user_role_assignments r ON r.user_id = u.id
  WHERE u.external_auth_id = ? OR u.email = ?
`;

export function readOwnerPinIdentityParams(): ReadonlyArray<string> {
  return [OWNER_EXTERNAL_AUTH_ID, OWNER_EMAIL];
}
