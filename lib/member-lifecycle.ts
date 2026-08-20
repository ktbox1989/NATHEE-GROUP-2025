import type { UserRole } from "../db/schema.ts";
import {
  isCustomerRole,
  PERMISSIONS,
  usesExplicitPermissions,
  type Permission,
} from "./authorization.ts";

export const MANAGED_USER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type ManagedUserStatus = (typeof MANAGED_USER_STATUSES)[number];

export type ManagedUserState = {
  userId: string;
  role: UserRole;
  companyId: string | null;
  status: ManagedUserStatus;
  permissions: readonly Permission[];
};

export type MemberLifecycleErrorCode =
  | "INVALID_COMPANY"
  | "INVALID_STATUS"
  | "LAST_OWNER"
  | "SELF_LOCKOUT";

export class MemberLifecycleError extends Error {
  readonly code: MemberLifecycleErrorCode;

  constructor(code: MemberLifecycleErrorCode) {
    super(code);
    this.code = code;
    this.name = "MemberLifecycleError";
  }
}

export function normalizeManagedPermissions(
  role: UserRole,
  values: readonly string[],
): Permission[] {
  if (!usesExplicitPermissions(role)) return [];

  return [...new Set(
    values.filter((value): value is Permission =>
      PERMISSIONS.includes(value as Permission),
    ),
  )].sort();
}

export function normalizeManagedCompany(
  role: UserRole,
  requestedCompanyId: string | null,
): string | null {
  if (!isCustomerRole(role)) return null;
  const companyId = requestedCompanyId?.trim() || null;
  if (!companyId) throw new MemberLifecycleError("INVALID_COMPANY");
  return companyId;
}

export function assertManagedUserChange(input: {
  actorUserId: string;
  before: ManagedUserState;
  after: ManagedUserState;
  activeOwnerCount: number;
}): void {
  const { actorUserId, before, after, activeOwnerCount } = input;
  if (!MANAGED_USER_STATUSES.includes(after.status)) {
    throw new MemberLifecycleError("INVALID_STATUS");
  }
  if (isCustomerRole(after.role) !== Boolean(after.companyId)) {
    throw new MemberLifecycleError("INVALID_COMPANY");
  }

  const removesActiveOwner =
    before.role === "OWNER" &&
    before.status === "ACTIVE" &&
    (after.role !== "OWNER" || after.status !== "ACTIVE");

  if (
    before.userId === actorUserId &&
    (before.role !== after.role || before.status !== after.status)
  ) {
    throw new MemberLifecycleError("SELF_LOCKOUT");
  }
  if (removesActiveOwner && activeOwnerCount <= 1) {
    throw new MemberLifecycleError("LAST_OWNER");
  }
}

export function hasManagedUserChange(
  before: ManagedUserState,
  after: ManagedUserState,
): boolean {
  return (
    before.role !== after.role ||
    before.companyId !== after.companyId ||
    before.status !== after.status ||
    normalizedPermissionKey(before.permissions) !==
      normalizedPermissionKey(after.permissions)
  );
}

function normalizedPermissionKey(permissions: readonly Permission[]): string {
  return [...new Set(permissions)].sort().join("\n");
}
