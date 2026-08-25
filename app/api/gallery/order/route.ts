import { and, asc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { auditLogs, galleryCategories, galleryItems } from "@/db/schema";
import { can } from "@/lib/authorization";
import { getCurrentActor } from "@/lib/current-actor";
import { boundedText } from "@/lib/gallery";
import {
  GALLERY_ORDER_MAX_ITEMS,
  isGalleryOrderRequestKey,
  orderIsUnchanged,
  parseGalleryOrderIds,
  verifyGalleryOrder,
} from "@/lib/gallery-order";
import { sha256Hex } from "@/lib/image-validation";
import { isSameOrigin } from "@/lib/same-origin";
import { recordTimestamp } from "@/lib/timestamps";

/**
 * Places one category of the public gallery in one order, in one write.
 *
 * The order arrives as ids in sequence rather than as a number per item,
 * because the Owner is arranging photographs and sending positions would let
 * two items claim the same one. Positions are derived and spaced in tens so a
 * later single insertion does not force another full renumber.
 *
 * Every id is validated against the stored rows **before** anything is written,
 * and the whole renumber plus its audit row go in one `db.batch`, which D1 runs
 * as a single implicit transaction. That is the point of the endpoint: the
 * reorder screen's sequential writes are real but leave the earlier rows moved
 * when one fails part way, which is a third order that nobody chose.
 *
 * Idempotency without a new table: the audit row's id is derived from the
 * request key, so a replay collides with the primary key, the batch rolls back,
 * and the reorder cannot be applied twice. `audit_logs` is append-only by
 * trigger, so that constraint cannot be edited away either.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL("/login?error=not_authorized", request.url), 303);
  if (!can(actor, "gallery:write")) return redirect(request, "error", "forbidden");

  const form = await request.formData();
  const requestKey = boundedText(form.get("requestKey"), 120);
  const categoryId = boundedText(form.get("categoryId"), 80);
  const returnTo = boundedText(form.get("returnTo"), 200);
  // Repeated `orderedIds` fields, or one separated field: a drag-and-drop list
  // and a plain form post are both legitimate callers.
  const raw = form.getAll("orderedIds").flatMap((value) =>
    String(value).split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean),
  );

  if (!isGalleryOrderRequestKey(requestKey)) return redirect(request, "error", "invalid_request_key");
  if (!categoryId) return redirect(request, "error", "invalid_category");

  const parsed = parseGalleryOrderIds(raw);
  if (!parsed.ok) return redirect(request, "error", `invalid_order_${parsed.reason}`);

  const db = getDb();
  const category = await db
    .select({ id: galleryCategories.id })
    .from(galleryCategories)
    .where(eq(galleryCategories.id, categoryId))
    .get();
  if (!category) return redirect(request, "error", "invalid_category");

  // Every publicly visible item in the category, read once, before any write.
  // The completeness rule is only enforceable against the whole set: ordering a
  // subset would leave the rest at their old numbers, in front of everything
  // the Owner just arranged.
  const rows = await db
    .select({
      id: galleryItems.id,
      categoryId: galleryItems.categoryId,
      status: galleryItems.status,
      visibility: galleryItems.visibility,
      sortOrder: galleryItems.sortOrder,
    })
    .from(galleryItems)
    .where(
      and(
        eq(galleryItems.categoryId, categoryId),
        eq(galleryItems.status, "PUBLISHED"),
        eq(galleryItems.visibility, "PUBLIC"),
      ),
    )
    .orderBy(asc(galleryItems.sortOrder), asc(galleryItems.id))
    .limit(GALLERY_ORDER_MAX_ITEMS + 1)
    .all();

  if (rows.length > GALLERY_ORDER_MAX_ITEMS) return redirect(request, "error", "category_too_large");

  const verdict = verifyGalleryOrder(parsed.ids, categoryId, rows);
  if (!verdict.ok) return redirect(request, "error", verdict.reason);

  const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
  const auditId = `gallery-order-${(await sha256Hex(new TextEncoder().encode(requestKey))).slice(0, 32)}`;

  // A replay of a request that already landed is reported as done rather than
  // as a failure. Checked here for the ordinary case; the primary key below is
  // what closes the race between two concurrent submissions.
  const alreadyApplied = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(eq(auditLogs.id, auditId))
    .get();
  if (alreadyApplied) return done(request, returnTo, "already_ordered");

  // Nothing to write is a success, not a no-op that reports failure: the order
  // the Owner asked for is the order that is stored.
  if (orderIsUnchanged(verdict.positions, current)) return done(request, returnTo, "reordered");

  const [first, ...rest] = verdict.positions;
  const recordedAt = recordTimestamp();
  const place = (position: { id: string; sortOrder: number }) =>
    db
      .update(galleryItems)
      .set({ sortOrder: position.sortOrder, updatedAt: recordedAt })
      .where(eq(galleryItems.id, position.id));

  try {
    // Spelled as a non-empty tuple rather than cast to one: the parse refuses an
    // empty list, so the first element genuinely exists and the type says so.
    await db.batch([
      place(first),
      ...rest.map(place),
      db.insert(auditLogs).values({
        id: auditId,
        actorUserId: actor.userId,
        // A reorder is one decision about a sequence, so it is one row. The
        // entity is the category, because no single photograph is its subject.
        action: "REORDER",
        entityType: "gallery_order",
        entityId: categoryId,
        beforeJson: JSON.stringify(Object.fromEntries(current)),
        afterJson: JSON.stringify({
          requestKey,
          categoryId,
          order: verdict.positions,
        }),
      }),
    ]);
  } catch {
    // The audit id is derived from the request key, so a primary-key collision
    // here means this exact request already landed and the batch rolled back
    // rather than applying it twice.
    const concurrent = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.id, auditId))
      .get();
    if (concurrent) return done(request, returnTo, "already_ordered");
    return redirect(request, "error", "gallery_order");
  }

  return done(request, returnTo, "reordered");
}

/**
 * Back to the screen that asked, so the Owner reads the order from the database
 * rather than from what their browser was holding. The target is bounded to a
 * same-origin gallery path; anything else falls back to the default.
 */
function done(request: NextRequest, returnTo: string, status: string) {
  const safe = /^\/app\/gallery(\/[a-z-]*)?(\?[\w=&%-]*)?$/.test(returnTo) ? returnTo : "/app/gallery/order";
  const url = new URL(safe, request.url);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, 303);
}

function redirect(request: NextRequest, key: string, value: string) {
  return NextResponse.redirect(
    new URL(`/app/gallery/order?${key}=${encodeURIComponent(value)}`, request.url),
    303,
  );
}
