import { and, eq, like } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { userPermissions, users } from "@/db/schema";
import type { Actor, Permission } from "@/lib/authorization";
import { safeReturnTo } from "@/lib/safe-return-to";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CurrentActor = Actor & {
  email: string;
  displayName: string;
};

const resolveCurrentActor = cache(async (): Promise<CurrentActor | null> => {
  if (!getSupabaseConfig()) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const authUser = data.user;
  if (error || !authUser?.email) return null;

  const db = getDb();
  let appUser = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.externalAuthId, authUser.id),
        eq(users.status, "ACTIVE"),
      ),
    )
    .get();

  if (!appUser) {
    const pendingUser = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.email, authUser.email.toLowerCase()),
          like(users.externalAuthId, "pending:%"),
          eq(users.status, "ACTIVE"),
        ),
      )
      .get();

    if (pendingUser) {
      const result = await db
        .update(users)
        .set({ externalAuthId: authUser.id, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(users.id, pendingUser.id),
            eq(users.externalAuthId, pendingUser.externalAuthId),
          ),
        )
        .returning()
        .get();
      appUser = result ?? null;
    }
  }

  if (!appUser) return null;

  const permissionRows =
    appUser.role === "STAFF"
      ? await db
          .select({ permission: userPermissions.permission })
          .from(userPermissions)
          .where(eq(userPermissions.userId, appUser.id))
          .all()
      : [];

  return {
    userId: appUser.id,
    role: appUser.role,
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
  if (!getSupabaseConfig()) redirect("/login?error=config");

  const actor = await getCurrentActor();
  if (!actor) {
    redirect(
      `/login?error=not_authorized&returnTo=${encodeURIComponent(safePath)}`,
    );
  }
  return actor;
}
