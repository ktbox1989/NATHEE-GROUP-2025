import { redirect } from "next/navigation";
import {
  can,
  isInternalRole,
  type Permission,
} from "@/lib/authorization";
import {
  requireActor,
  type CurrentActor,
} from "@/lib/current-actor";

export async function requireAdminActor(returnTo = "/admin"): Promise<CurrentActor> {
  const actor = await requireActor(returnTo);
  if (!isInternalRole(actor.role)) {
    redirect("/app");
  }
  return actor;
}

export async function requireAdminPermission(
  permission: Permission,
  returnTo: string,
): Promise<CurrentActor> {
  const actor = await requireAdminActor(returnTo);
  if (!can(actor, permission)) {
    redirect("/app");
  }
  return actor;
}
