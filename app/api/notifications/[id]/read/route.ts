import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { notifications } from "@/db/schema";
import { getCurrentActor } from "@/lib/current-actor";
import { isSafeNotificationHref } from "@/lib/notifications";
import { isSameOrigin } from "@/lib/same-origin";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  const { id } = await context.params;
  const db = getDb();
  const row = await db
    .select({ id: notifications.id, href: notifications.href, readAt: notifications.readAt })
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, actor.userId)))
    .get();
  if (!row || !isSafeNotificationHref(row.href)) {
    return NextResponse.redirect(new URL("/app/notifications?error=not_found", request.url), 303);
  }

  if (!row.readAt) {
    await db
      .update(notifications)
      .set({ readAt: new Date().toISOString() })
      .where(and(
        eq(notifications.id, id),
        eq(notifications.recipientUserId, actor.userId),
        isNull(notifications.readAt),
      ))
      .run();
  }

  return NextResponse.redirect(new URL(row.href, request.url), 303);
}
