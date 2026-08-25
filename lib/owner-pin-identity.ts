import type { LegacyUserRole } from "../db/schema.ts";
import { effectiveRoleFromLegacy, type Role } from "./authorization.ts";
import { OWNER_EMAIL, OWNER_EXTERNAL_AUTH_ID } from "./owner-pin.ts";

/**
 * What the canonical Owner row is allowed to look like, decided away from the
 * database so every branch is testable and none of them is an implicit "else".
 *
 * The dangerous case is not the missing row; it is the row that already exists
 * under this address and belongs to something else. Rebinding it — writing the
 * PIN identity onto whatever account happens to hold kaikt143@gmail.com — would
 * silently hand the Owner's seat to whoever the address was previously bound
 * to, or take an existing account over. So a mismatch is refused and reported,
 * and nothing is written. Recovering from that is a deliberate act by the Owner
 * against the database, which is exactly the level of ceremony it deserves.
 */

export type OwnerIdentityRow = {
  id: string;
  external_auth_id: string;
  email: string;
  display_name: string;
  company_id: string | null;
  status: string;
  /** NULL when no explicit assignment exists; the legacy column then decides. */
  assigned_role: string | null;
  legacy_role: string;
};

export type OwnerIdentityState =
  /** No row holds the canonical address or the canonical identity. */
  | { state: "absent" }
  /** Exactly one row, holding both, whatever its status and role turn out to be. */
  | { state: "bound"; row: OwnerIdentityRow }
  /** Something else already occupies the address or the identity. */
  | { state: "conflict"; detail: string };

export function effectiveRoleOf(row: OwnerIdentityRow): Role {
  return (row.assigned_role as Role | null) ?? effectiveRoleFromLegacy(row.legacy_role as LegacyUserRole);
}

/**
 * `rows` is the result of selecting every user matching the canonical identity
 * *or* the canonical address. Two rows means the address and the identity have
 * drifted onto different accounts, which is a conflict by definition.
 */
export function ownerIdentityState(rows: readonly OwnerIdentityRow[]): OwnerIdentityState {
  if (rows.length === 0) return { state: "absent" };
  if (rows.length > 1) {
    return {
      state: "conflict",
      detail: "the canonical Owner address and the Owner PIN identity are held by different accounts",
    };
  }
  const [row] = rows;
  if (row.external_auth_id !== OWNER_EXTERNAL_AUTH_ID) {
    return { state: "conflict", detail: "the canonical Owner address is already bound to another identity" };
  }
  if (row.email !== OWNER_EMAIL) {
    return { state: "conflict", detail: "the Owner PIN identity is bound to another address" };
  }
  return { state: "bound", row };
}

export type OwnerPinActor = {
  userId: string;
  role: Role;
  companyId: string | null;
  email: string;
  displayName: string;
};

/**
 * The row is re-checked on every request rather than trusted from the cookie.
 * A session that was legitimately issued must stop working the moment the
 * account is deactivated or its role is changed, and the only thing that can
 * know that is the database.
 */
export function ownerPinActorFrom(row: OwnerIdentityRow | undefined | null): OwnerPinActor | null {
  if (!row) return null;
  if (row.status !== "ACTIVE") return null;
  if (row.email !== OWNER_EMAIL || row.external_auth_id !== OWNER_EXTERNAL_AUTH_ID) return null;
  if (effectiveRoleOf(row) !== "OWNER") return null;
  return {
    userId: row.id,
    role: "OWNER",
    companyId: row.company_id,
    email: row.email,
    displayName: row.display_name,
  };
}

/** Why a bootstrap or a session refused. Reported to the operator, never to a guesser. */
export type OwnerBootstrapOutcome =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; reason: "conflict"; detail: string }
  | { ok: false; reason: "not_owner"; detail: string };

/**
 * The decision made after the idempotent write has been attempted and the row
 * has been read back. A row that exists but is not an ACTIVE OWNER is refused:
 * the bootstrap may create the Owner, and may do nothing, but must never
 * *promote* an account it did not create.
 */
export function ownerBootstrapOutcome(
  state: OwnerIdentityState,
  created: boolean,
): OwnerBootstrapOutcome {
  if (state.state === "conflict") return { ok: false, reason: "conflict", detail: state.detail };
  if (state.state === "absent") {
    return { ok: false, reason: "conflict", detail: "the canonical Owner row could not be written" };
  }
  const actor = ownerPinActorFrom(state.row);
  if (!actor) {
    return {
      ok: false,
      reason: "not_owner",
      detail: "the canonical Owner account is not an ACTIVE account with the OWNER role",
    };
  }
  return { ok: true, userId: actor.userId, created };
}
