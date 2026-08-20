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
  "documents:read",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = "OWNER" | "STAFF" | "CUSTOMER";

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

export function can(
  actor: Actor,
  permission: Permission,
  targetCompanyId?: string | null,
): boolean {
  if (actor.role === "OWNER") return true;

  if (actor.role === "STAFF") {
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
