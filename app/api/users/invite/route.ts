import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, companies, userPermissions, userRoleAssignments, users, USER_ROLES } from "@/db/schema";
import type { UserRole } from "@/db/schema";
import { buildAuthCallbackUrl } from "@/lib/app-origin";
import { makeAuditRecord } from "@/lib/audit";
import { isCustomerRole, legacyRoleFor, PERMISSIONS, usesExplicitPermissions } from "@/lib/authorization";
import type { Permission } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { privilegedProofAccepted } from "@/lib/privileged-action";
import { requireCurrentPassword } from "@/lib/privileged-action-guard";
import { isSameOrigin } from "@/lib/same-origin";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (actor.role !== "OWNER") return NextResponse.redirect(new URL("/app", request.url), 303);

  const form = await request.formData();

  // Inviting a member decides who may act at all, and a second OWNER survives
  // the real Owner changing their password. Holding a session is not enough.
  const { client, applyAuthCookies } = createSupabaseRouteClient(request);
  const { data: session } = await client.auth.getUser();
  const proof = await requireCurrentPassword({
    client,
    email: session.user?.email,
    submitted: form.get("currentPassword"),
    headers: request.headers,
  });
  if (!proof.ok || !privilegedProofAccepted(proof.proof)) {
    const suffix = proof.ok ? "" : proof.error === "too_many_attempts" && proof.retryAfterSeconds ? `&retryAfter=${proof.retryAfterSeconds}` : "";
    return applyAuthCookies(
      NextResponse.redirect(new URL(`/app/users?error=${proof.ok ? "reauthenticate" : proof.error}${suffix}`, request.url), 303),
    );
  }

  const displayName = String(form.get("displayName") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const rawRole = String(form.get("role") ?? "");
  const requestedCompanyId = String(form.get("companyId") ?? "") || null;
  if (!displayName || !email || !USER_ROLES.includes(rawRole as UserRole)) {
    return applyAuthCookies(NextResponse.redirect(new URL("/app/users?error=invalid", request.url), 303));
  }
  const role = rawRole as UserRole;
  const companyId = isCustomerRole(role) ? requestedCompanyId : null;
  if (isCustomerRole(role) && !companyId) {
    return applyAuthCookies(NextResponse.redirect(new URL("/app/users?error=company", request.url), 303));
  }

  const db = getDb();
  if (companyId) {
    const company = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, companyId), eq(companies.status, "ACTIVE"))).get();
    if (!company) return applyAuthCookies(NextResponse.redirect(new URL("/app/users?error=company", request.url), 303));
  }
  const selectedPermissions = usesExplicitPermissions(role)
    ? form.getAll("permissions").map(String).filter((value): value is Permission => PERMISSIONS.includes(value as Permission))
    : [];

  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let authUserId: string;
  try {
    admin = createSupabaseAdminClient();
    const redirectTo = buildAuthCallbackUrl("/reset-password", request.url);
    if (!redirectTo) throw new Error("Application origin is not configured");
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo.toString(),
      data: { display_name: displayName },
    });
    if (error || !data.user) throw error ?? new Error("Invite failed");
    authUserId = data.user.id;
  } catch {
    return applyAuthCookies(NextResponse.redirect(new URL("/app/users?error=invite", request.url), 303));
  }

  const id = crypto.randomUUID();
  try {
    await db.batch([
      db.insert(users).values({ id, externalAuthId: authUserId, email, displayName, role: legacyRoleFor(role), companyId }),
      db.insert(userRoleAssignments).values({ userId: id, role, assignedBy: actor.userId }),
      ...selectedPermissions.map((permission) => db.insert(userPermissions).values({ userId: id, permission, grantedBy: actor.userId })),
      db.insert(auditLogs).values(makeAuditRecord({ actor, action: "INVITE", entityType: "user", entityId: id, companyId, after: { email, displayName, role, companyId, permissions: selectedPermissions } })),
    ]);
  } catch {
    if (admin) {
      await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    }
    return applyAuthCookies(NextResponse.redirect(new URL("/app/users?error=save", request.url), 303));
  }
  return applyAuthCookies(NextResponse.redirect(new URL("/app/users?status=invited", request.url), 303));
}
