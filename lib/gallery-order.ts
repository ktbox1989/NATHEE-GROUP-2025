/**
 * A gallery reorder, as one decision.
 *
 * The column has always been able to hold an order: `gallery_items.sort_order`
 * is a `NOT NULL` integer with a `>= 0` check, covered by
 * `idx_gallery_items_public_order`. No migration is involved in any of this.
 *
 * What could not be expressed was the *move*. `POST /api/gallery/[id]` writes
 * one item and replaces every field on it, and every item defaults to
 * `sort_order = 0`, so in the ordinary case every item is tied and there is no
 * integer between two neighbours to move into. The reorder screen works around
 * that by renumbering the whole visible sequence one request at a time, which
 * is real but is neither atomic nor one audit record.
 *
 * The policy lives here rather than in the route so it can be proven without a
 * Cloudflare binding, the same split `gallery-mutation.ts` already uses.
 *
 * Two rules are worth stating because they are the ones that would be tempting
 * to relax:
 *
 * **The order must be complete for its category.** Renumbering a subset to
 * 10, 20, 30 while the rest of the category keeps `sort_order = 0` would put
 * every unnamed item *in front* of the ones the Owner just arranged. A partial
 * order is therefore refused rather than applied — the caller is told how many
 * items the category has.
 *
 * **A duplicate id is refused rather than de-duplicated.** It means the caller
 * sent an order it did not mean, and choosing one of the two positions for it
 * would be a guess at which.
 */

/** Gaps of ten, so a later insertion does not need everything renumbered. */
export const GALLERY_ORDER_STEP = 10;

/**
 * More photographs than one category of a marketing gallery holds, with
 * headroom over the reorder screen's page size. A bound is what keeps the
 * reorder a single statement batch; a category larger than this is refused
 * outright rather than ordered in part.
 */
export const GALLERY_ORDER_MAX_ITEMS = 200;

/** `gallery-order-<uuid v4>`, the same shape the upload request key uses. */
export function isGalleryOrderRequestKey(value: string): boolean {
  return /^gallery-order-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export type GalleryOrderRejection =
  | "empty"
  | "too_many"
  | "invalid_id"
  | "duplicate_id";

export type GalleryOrderParse =
  | { ok: true; ids: string[] }
  | { ok: false; reason: GalleryOrderRejection };

export function parseGalleryOrderIds(input: readonly unknown[]): GalleryOrderParse {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, reason: "empty" };
  if (input.length > GALLERY_ORDER_MAX_ITEMS) return { ok: false, reason: "too_many" };

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string" || !ITEM_ID_PATTERN.test(raw)) return { ok: false, reason: "invalid_id" };
    if (seen.has(raw)) return { ok: false, reason: "duplicate_id" };
    seen.add(raw);
    ids.push(raw);
  }
  return { ok: true, ids };
}

export type GalleryPosition = { id: string; sortOrder: number };

/**
 * The position each id takes. A pure function of the list, which is what makes
 * applying the same order twice reach the same state.
 */
export function assignGalleryPositions(ids: readonly string[]): GalleryPosition[] {
  return ids.map((id, index) => ({ id, sortOrder: (index + 1) * GALLERY_ORDER_STEP }));
}

/** What a stored row has to look like for the order to be applied to it. */
export type OrderableRow = {
  id: string;
  categoryId: string;
  status: string;
  visibility: string;
};

export type GalleryOrderVerdict =
  | { ok: true; positions: GalleryPosition[] }
  | { ok: false; reason: "unknown_item" | "wrong_category" | "not_public" | "incomplete_order"; detail?: string };

/**
 * Decides whether this exact order may be applied to these exact rows.
 *
 * `rows` is every `PUBLISHED` + `PUBLIC` item in the category, read before any
 * write. Checking against the whole category rather than only the named ids is
 * what makes the completeness rule enforceable at all.
 */
export function verifyGalleryOrder(
  ids: readonly string[],
  categoryId: string,
  rows: readonly OrderableRow[],
): GalleryOrderVerdict {
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) return { ok: false, reason: "unknown_item", detail: id };
    if (row.categoryId !== categoryId) return { ok: false, reason: "wrong_category", detail: id };
    // Belt and braces: the read is already scoped, and a row that is not
    // publicly visible has no place in a public order.
    if (row.status !== "PUBLISHED" || row.visibility !== "PUBLIC") {
      return { ok: false, reason: "not_public", detail: id };
    }
  }

  if (ids.length !== rows.length) {
    return { ok: false, reason: "incomplete_order", detail: String(rows.length) };
  }

  return { ok: true, positions: assignGalleryPositions(ids) };
}

/** True when the order would change nothing, so nothing needs writing. */
export function orderIsUnchanged(
  positions: readonly GalleryPosition[],
  current: ReadonlyMap<string, number>,
): boolean {
  return positions.every((position) => current.get(position.id) === position.sortOrder);
}
