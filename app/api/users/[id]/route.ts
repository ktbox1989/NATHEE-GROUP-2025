import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getD1, getDb } from "@/db";
import {
  companies,
  userPermissions,
  userRoleAssignments,
  users,
  USER_ROLES,
  type UserRole,
} from "@/db/schema";
import { makeAuditRecord } from "@/lib/audit";
import { effectiveRoleFromLegacy, legacyRoleFor, type Permission } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import {
  assertManagedUserChange,
  hasManagedUserChange,
  MANAGED_USER_STATUSES,
  MemberLifecycleError,
  normalizeManagedCompany,
  normalizeManagedPermissions,
  type ManagedUserState,
  type ManagedUserStatus,
} from "@/lib/member-lifecycle";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return redirect(request, "error", "not_authorized");
  if (actor.role !== "OWNER") return NextResponse.redirect(new URL("/app", request.url), 303);

  const { id } = await context.params;
  const db = getDb();
  const target = await db
    .select({
      id: users.id,
      legacyRole: users.role,
      assignedRole: userRoleAssignments.role,
      companyId: users.companyId,
      status: users.status,
      managementRevision: users.managementRevision,
    })
    .from(users)
    .leftJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
    .where(eq(users.id, id))
    .get();
  if (!target || target.status === "ARCHIVED") return redirect(request, "error", "not_found");

  const permissionRows = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, id))
    .all();
  const before: ManagedUserState = {
    userId: id,
    role: target.assignedRole ?? effectiveRoleFromLegacy(target.legacyRole),
    companyId: target.companyId,
    status: target.status,
    permissions: permissionRows.map((row) => row.permission as Permission),
  };

  const form = await request.formData();
  const rawRole = String(form.get("role") ?? "");
  const rawStatus = String(form.get("status") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (
    !USER_ROLES.includes(rawRole as UserRole) ||
    !MANAGED_USER_STATUSES.includes(rawStatus as ManagedUserStatus) ||
    reason.length < 3 ||
    reason.length > 500
  ) return redirect(request, "error", "invalid");

  const role = rawRole as UserRole;
  let companyId: string | null;
  try {
    companyId = normalizeManagedCompany(role, String(form.get("companyId") ?? "") || null);
  } catch {
    return redirect(request, "error", "company");
  }
  if (companyId) {
    const company = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.status, "ACTIVE")))
      .get();
    if (!company) return redirect(request, "error", "company");
  }

  const after: ManagedUserState = {
    userId: id,
    role,
    companyId,
    status: rawStatus as ManagedUserStatus,
    permissions: normalizeManagedPermissions(role, form.getAll("permissions").map(String)),
  };
  if (!hasManagedUserChange(before, after)) return redirect(request, "status", "no_change");

  const d1 = getD1();
  const ownerCount = await d1.prepare(`
    SELECT COUNT(*) AS total
    FROM users u
    LEFT JOIN user_role_assignments r ON r.user_id = u.id
    WHERE u.status = 'ACTIVE'
      AND COALESCE(
        r.role,
        CASE u.role WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END
      ) = 'OWNER'
  `).first<{ total: number }>();
  try {
    assertManagedUserChange({
      actorUserId: actor.userId,
      before,
      after,
      activeOwnerCount: Number(ownerCount?.total ?? 0),
    });
  } catch (error) {
    if (error instanceof MemberLifecycleError) return redirect(request, "error", error.code.toLowerCase());
    return redirect(request, "error", "invalid");
  }

  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();
  const legacyBefore = legacyRoleFor(before.role);
  const legacyAfter = legacyRoleFor(after.role);
  const legacyGroupChanges = legacyBefore !== legacyAfter;
  const roleChanges = before.role !== after.role;
  const operations = [d1.prepare(`
    UPDATE users
    SET management_revision = management_revision + 1,
        last_management_request_id = ?, updated_at = ?
    WHERE id = ? AND management_revision = ?
      AND status = ? AND role = ?
      AND ((company_id IS NULL AND ? IS NULL) OR company_id = ?)
  `).bind(requestId, now, id, target.managementRevision, target.status, target.legacyRole, target.companyId, target.companyId)];

  if (legacyGroupChanges) {
    operations.push(d1.prepare(`
      DELETE FROM user_role_assignments
      WHERE user_id = ?
        AND EXISTS (SELECT 1 FROM users WHERE id = ? AND last_management_request_id = ?)
    `).bind(id, id, requestId));
  }

  operations.push(d1.prepare(`
    UPDATE users SET role = ?, company_id = ?, status = ?, updated_at = ?
    WHERE id = ? AND last_management_request_id = ?
  `).bind(legacyAfter, after.companyId, after.status, now, id, requestId));

  if (roleChanges || !target.assignedRole) {
    operations.push(d1.prepare(`
      INSERT INTO user_role_assignments (user_id, role, assigned_by, created_at, updated_at)
      SELECT id, ?, ?, ?, ? FROM users
      WHERE id = ? AND last_management_request_id = ?
      ON CONFLICT(user_id) DO UPDATE SET
        role = excluded.role, assigned_by = excluded.assigned_by, updated_at = excluded.updated_at
    `).bind(after.role, actor.userId, now, now, id, requestId));
  }

  operations.push(d1.prepare(`
    DELETE FROM user_permissions
    WHERE user_id = ?
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND last_management_request_id = ?)
  `).bind(id, id, requestId));
  for (const permission of after.permissions) {
    operations.push(d1.prepare(`
      INSERT INTO user_permissions (user_id, permission, granted_by, created_at)
      SELECT id, ?, ?, ? FROM users
      WHERE id = ? AND last_management_request_id = ?
    `).bind(permission, actor.userId, now, id, requestId));
  }

  const audit = makeAuditRecord({
    actor,
    action: "UPDATE_ACCESS",
    entityType: "user",
    entityId: id,
    companyId: after.companyId,
    before,
    after,
    reason,
  });
  operations.push(d1.prepare(`
    INSERT INTO audit_logs
      (id, actor_user_id, company_id, action, entity_type, entity_id,
       before_json, after_json, reason, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM users WHERE id = ? AND last_management_request_id = ?
  `).bind(
    audit.id, audit.actorUserId, audit.companyId, audit.action, audit.entityType,
    audit.entityId, audit.beforeJson, audit.afterJson, audit.reason, now, id, requestId,
  ));

  try {
    const results = await d1.batch(operations);
    if ((results[0].meta.changes ?? 0) !== 1 || (results.at(-1)?.meta.changes ?? 0) !== 1) {
      return redirect(request, "error", "stale");
    }
  } catch {
    return redirect(request, "error", "save");
  }

  return NextResponse.redirect(new URL(`/app/users?status=updated#${id}`, request.url), 303);
}

function redirect(request: NextRequest, key: string, value: string) {
  return NextResponse.redirect(new URL(`/app/users?${key}=${encodeURIComponent(value)}`, request.url), 303);
}
