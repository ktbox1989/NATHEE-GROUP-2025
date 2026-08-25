import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getD1, getDb } from "@/db";
import { userPermissions, userRoleAssignments, users } from "@/db/schema";
import {
  effectiveRoleFromLegacy,
  usesExplicitPermissions,
  type Actor,
  type Permission,
} from "@/lib/authorization";
import { safeReturnTo } from "@/lib/safe-return-to";
import { confirmedAuthIdentity } from "@/lib/auth-identity";
import {
  authModeConfigured,
  getOwnerPinAuthConfig,
  isOwnerPinConfigured,
  OWNER_PIN_COOKIE,
} from "@/lib/owner-pin";
import type { OwnerPinActor } from "@/lib/owner-pin-identity";
import { resolveOwnerPinSession } from "@/lib/owner-pin-store";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CurrentActor = Actor & {
  email: string;
  displayName: string;
};

/**
 * The Owner PIN session is resolved first, and on its own.
 *
 * It has to be first because it must work when Supabase is absent — that is the
 * entire reason it exists — and asking an unconfigured provider first would
 * either throw or return "no session" and take the Owner's real one with it. It
 * is deliberately not merged with the provider path either: the two prove
 * different things and share nothing but the `users` table they both end at.
 *
 * The database is consulted on every request, so ACTIVE and OWNER are properties
 * of the account right now rather than of the moment the cookie was signed.
 */
async function resolveOwnerActor(): Promise<CurrentActor | null> {
  const config = getOwnerPinAuthConfig();
  if (!config) return null;

  // No cookie, no database round trip. Every anonymous request to a protected
  // page would otherwise cost one query to discover it is anonymous.
  const cookieStore = await cookies();
  const token = cookieStore.get(OWNER_PIN_COOKIE)?.value;
  if (!token) return null;

  let owner: OwnerPinActor | null;
  try {
    owner = await resolveOwnerPinSession({ token, config, database: getD1() });
  } catch {
    // A database this request cannot reach resolves no actor. Denying access is
    // the fail-closed answer; a 500 out of the application layout is not, and it
    // would tell an anonymous caller that the binding is missing.
    return null;
  }
  if (!owner) return null;

  // OWNER is not a role that reads explicit permissions; `can()` grants it
  // everything, exactly as it does for a provider-authenticated Owner.
  return {
    userId: owner.userId,
    role: owner.role,
    companyId: owner.companyId,
    permissions: [],
    email: owner.email,
    displayName: owner.displayName,
  };
}

const resolveCurrentActor = cache(async (): Promise<CurrentActor | null> => {
  const owner = await resolveOwnerActor();
  if (owner) return owner;

  if (!getSupabaseConfig()) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const identity = confirmedAuthIdentity(data.user);
  if (error || !identity) return null;

  const db = getDb();
  const actorSelection = {
    id: users.id,
    externalAuthId: users.externalAuthId,
    email: users.email,
    displayName: users.displayName,
    companyId: users.companyId,
    legacyRole: users.role,
    assignedRole: userRoleAssignments.role,
  };
  const appUser = await db
    .select(actorSelection)
    .from(users)
    .leftJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
    .where(
      and(
        eq(users.externalAuthId, identity.externalAuthId),
        eq(users.status, "ACTIVE"),
      ),
    )
    .get();

  if (!appUser) return null;

  const effectiveRole = appUser.assignedRole ?? effectiveRoleFromLegacy(appUser.legacyRole);

  const permissionRows =
    usesExplicitPermissions(effectiveRole)
      ? await db
          .select({ permission: userPermissions.permission })
          .from(userPermissions)
          .where(eq(userPermissions.userId, appUser.id))
          .all()
      : [];

  return {
    userId: appUser.id,
    role: effectiveRole,
    companyId: appUser.companyId,
    permissions: permissionRows.map((row) => row.permission as Permission),
    email: appUser.email,
    displayName: appUser.displayName,
  };
});

export async function getCurrentActor(): Promise<CurrentActor | null> {
  return resolveCurrentActor();
}

export async function requireActor(returnTo = "/app"): Promise<CurrentActor> {
  const safePath = safeReturnTo(returnTo);
  // `?error=config` means "this runtime has no way to authenticate anyone". With
  // an Owner PIN configured that is false, and sending the Owner to a page that
  // says the login is unwired — while the login they are meant to use works —
  // would have locked them out of their own CMS.
  if (!authModeConfigured({ ownerPin: isOwnerPinConfigured(), supabase: Boolean(getSupabaseConfig()) })) {
    redirect("/login?error=config");
  }

  const actor = await getCurrentActor();
  if (!actor) {
    redirect(
      `/login?error=not_authorized&returnTo=${encodeURIComponent(safePath)}`,
    );
  }
  return actor;
}
