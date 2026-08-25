import assert from "node:assert/strict";
import test from "node:test";
import {
  assignGalleryPositions,
  isGalleryOrderRequestKey,
  orderIsUnchanged,
  parseGalleryOrderIds,
  verifyGalleryOrder,
  GALLERY_ORDER_MAX_ITEMS,
  GALLERY_ORDER_STEP,
  type OrderableRow,
} from "../lib/gallery-order.ts";

// The policy behind POST /api/gallery/order, provable without a binding.

const CATEGORY = "cat-truck-loading";

function row(id: string, overrides: Partial<OrderableRow> = {}): OrderableRow {
  return { id, categoryId: CATEGORY, status: "PUBLISHED", visibility: "PUBLIC", ...overrides };
}

const ids = ["item-a", "item-b", "item-c"];
const rows = ids.map((id) => row(id));

test("an order is the ids in sequence, and positions are derived from it", () => {
  assert.deepEqual(parseGalleryOrderIds(ids), { ok: true, ids });
  assert.deepEqual(assignGalleryPositions(ids), [
    { id: "item-a", sortOrder: GALLERY_ORDER_STEP },
    { id: "item-b", sortOrder: GALLERY_ORDER_STEP * 2 },
    { id: "item-c", sortOrder: GALLERY_ORDER_STEP * 3 },
  ]);
});

// Gaps are what let a later single insertion take a place without another full
// renumber, and starting a whole step in leaves room before the first item.
test("positions are spaced, ascending, and leave room at the front", () => {
  const positions = assignGalleryPositions(ids);
  assert.ok(positions[0].sortOrder > 0);
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index].sortOrder - positions[index - 1].sortOrder >= 2);
  }
  // `ck_gallery_items_sort` is `sort_order >= 0`, and the item edit form bounds
  // a typed position at 1,000,000.
  const full = assignGalleryPositions(Array.from({ length: GALLERY_ORDER_MAX_ITEMS }, (_, i) => `item-${i}`));
  for (const position of full) {
    assert.ok(Number.isSafeInteger(position.sortOrder) && position.sortOrder >= 0);
    assert.ok(position.sortOrder <= 1_000_000);
  }
});

test("the request key is the shape the other gallery writes already use", () => {
  assert.equal(isGalleryOrderRequestKey("gallery-order-0f1e2d3c-4b5a-4968-8776-655443322110"), true);
  for (const invalid of [
    "gallery-upload-0f1e2d3c-4b5a-4968-8776-655443322110",
    "gallery-order-not-a-uuid",
    "gallery-order-0f1e2d3c-4b5a-1968-8776-655443322110", // not v4
    "gallery-order-",
    "",
  ]) {
    assert.equal(isGalleryOrderRequestKey(invalid), false, `${invalid} was accepted`);
  }
});

// A duplicate means the caller sent an order it did not mean; choosing one of
// the two positions would be a guess at which.
test("a duplicated id is refused rather than de-duplicated", () => {
  assert.deepEqual(parseGalleryOrderIds(["item-a", "item-b", "item-a"]), { ok: false, reason: "duplicate_id" });
});

test("an empty order, and one larger than a single batch, are both refused", () => {
  assert.deepEqual(parseGalleryOrderIds([]), { ok: false, reason: "empty" });
  const tooMany = Array.from({ length: GALLERY_ORDER_MAX_ITEMS + 1 }, (_, i) => `item-${i}`);
  assert.deepEqual(parseGalleryOrderIds(tooMany), { ok: false, reason: "too_many" });
});

test("an id that could be a path, a wildcard or an injection is not an id", () => {
  for (const invalid of ["../secrets", "item a", "item/a", "item'a", "%2e%2e", "", "ไทย", "a".repeat(101)]) {
    assert.deepEqual(parseGalleryOrderIds([invalid]), { ok: false, reason: "invalid_id" }, invalid);
  }
  for (const invalid of [null, undefined, 42, {}, ["nested"]]) {
    assert.deepEqual(parseGalleryOrderIds([invalid]), { ok: false, reason: "invalid_id" });
  }
});

test("a complete, in-category, public order is accepted", () => {
  const verdict = verifyGalleryOrder(["item-c", "item-a", "item-b"], CATEGORY, rows);
  assert.equal(verdict.ok, true);
  if (!verdict.ok) return;
  assert.deepEqual(verdict.positions.map((position) => position.id), ["item-c", "item-a", "item-b"]);
});

// The rule that would be most tempting to relax. Renumbering a subset to
// 10, 20, 30 leaves every unnamed item at its old number - usually 0 - which
// puts them all in front of the ones the Owner just arranged.
test("a partial order is refused, and says how many the category has", () => {
  const verdict = verifyGalleryOrder(["item-a", "item-b"], CATEGORY, rows);
  assert.deepEqual(verdict, { ok: false, reason: "incomplete_order", detail: "3" });
});

test("an id the library does not have is named rather than skipped", () => {
  const verdict = verifyGalleryOrder(["item-a", "item-b", "item-missing"], CATEGORY, rows);
  assert.deepEqual(verdict, { ok: false, reason: "unknown_item", detail: "item-missing" });
});

// Reordering one category must not be able to renumber another's photographs.
test("an id from another category is refused", () => {
  const mixed = [...rows, row("item-other", { categoryId: "cat-storage" })];
  const verdict = verifyGalleryOrder([...ids, "item-other"], CATEGORY, mixed);
  assert.deepEqual(verdict, { ok: false, reason: "wrong_category", detail: "item-other" });
});

// The read is already scoped to PUBLISHED + PUBLIC; this is the second lock, so
// a widened query cannot quietly put private media into a public order.
test("anything that is not published and public has no place in a public order", () => {
  for (const [label, override] of [
    ["draft", { status: "DRAFT" }],
    ["hidden", { status: "HIDDEN" }],
    ["archived", { status: "ARCHIVED" }],
    ["internal", { visibility: "INTERNAL" }],
    ["customer job", { visibility: "CUSTOMER_JOB" }],
  ] as const) {
    const withPrivate = [row("item-a"), row("item-b"), row("item-c", override)];
    const verdict = verifyGalleryOrder(ids, CATEGORY, withPrivate);
    assert.deepEqual(verdict, { ok: false, reason: "not_public", detail: "item-c" }, label);
  }
});

// Applying the same order twice must reach the same state; that is what makes a
// replayed submission safe rather than a second renumber.
test("an order that changes nothing is recognised as changing nothing", () => {
  const positions = assignGalleryPositions(ids);
  const applied = new Map(positions.map((position) => [position.id, position.sortOrder]));
  assert.equal(orderIsUnchanged(positions, applied), true);
  assert.equal(orderIsUnchanged(positions, new Map(ids.map((id) => [id, 0]))), false);
  assert.deepEqual(assignGalleryPositions(ids), positions);
});
