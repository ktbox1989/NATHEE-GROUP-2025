import { redirect } from "next/navigation";
import { isCustomerRole } from "@/lib/authorization";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

export default async function CustomerPortalEntry() {
  const actor = await requireActor("/portal");
  if (!isCustomerRole(actor.role)) redirect("/app");
  redirect("/app");
}
