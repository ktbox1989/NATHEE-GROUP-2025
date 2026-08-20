import { redirect } from "next/navigation";
import { requireActor } from "@/lib/current-actor";

export const dynamic = "force-dynamic";

export default async function CustomerPortalEntry() {
  const actor = await requireActor("/portal");
  if (actor.role !== "CUSTOMER") redirect("/app");
  redirect("/app");
}
