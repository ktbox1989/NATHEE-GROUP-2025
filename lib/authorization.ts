import {
  CUSTOMER_USER_ROLES,
  INTERNAL_USER_ROLES,
  type LegacyUserRole,
  type UserRole,
} from "../db/schema.ts";

export const PERMISSIONS = [
  "companies:read",
  "companies:write",
  "jobs:read",
  "jobs:write",
  "motorcycles:read",
  "motorcycles:write",
  "images:read",
  "images:write",
  "status:read",
  "status:write",
  "yard:read",
  "yard:write",
  "documents:read",
  "audit:read",
  "gallery:read",
  "gallery:write",
  "gallery:publish",
  "site:read",
  "site:write",
  "site:publish",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = UserRole;

export type Actor = {
  userId: string;
  role: Role;
  companyId: string | null;
  permissions?: readonly Permission[];
};

const customerReadPermissions = new Set<Permission>([
  "jobs:read",
  "motorcycles:read",
  "images:read",
  "status:read",
  "documents:read",
]);

export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";

  constructor() {
    super("You do not have permission to access this resource.");
    this.name = "AuthorizationError";
  }
}

export function isCustomerRole(role: Role): boolean {
  return CUSTOMER_USER_ROLES.includes(role as (typeof CUSTOMER_USER_ROLES)[number]);
}

export function isInternalRole(role: Role): boolean {
  return INTERNAL_USER_ROLES.includes(role as (typeof INTERNAL_USER_ROLES)[number]);
}

export function usesExplicitPermissions(role: Role): boolean {
  return role !== "OWNER" && isInternalRole(role);
}

export function legacyRoleFor(role: Role): LegacyUserRole {
  if (role === "OWNER") return "OWNER";
  return isCustomerRole(role) ? "CUSTOMER" : "STAFF";
}

export function effectiveRoleFromLegacy(role: LegacyUserRole): Role {
  if (role === "OWNER") return "OWNER";
  if (role === "CUSTOMER") return "CUSTOMER_VIEWER";
  return "STAFF";
}

export function can(
  actor: Actor,
  permission: Permission,
  targetCompanyId?: string | null,
): boolean {
  if (actor.role === "OWNER") return true;

  if (usesExplicitPermissions(actor.role)) {
    return actor.permissions?.includes(permission) ?? false;
  }

  if (!actor.companyId || !targetCompanyId) return false;
  if (actor.companyId !== targetCompanyId) return false;

  return customerReadPermissions.has(permission);
}

export function assertCan(
  actor: Actor,
  permission: Permission,
  targetCompanyId?: string | null,
): void {
  if (!can(actor, permission, targetCompanyId)) {
    throw new AuthorizationError();
  }
}
