import assert from "node:assert/strict";
import test from "node:test";
import type { PublicMedia } from "../lib/public-cms/contract.ts";
import {
  GALLERY_INITIAL_LIMIT,
  GALLERY_VISIBILITY_IS_PUBLIC,
  LIGHTBOX_KEYS,
  LIGHTBOX_SWIPE_MIN_PX,
  buildGalleryView,
  buildLightbox,
  compareGalleryItems,
  reduceLightbox,
  toPublicGalleryItem,
  type CmsGalleryItemInput,
  type PublicGalleryItem,
} from "../lib/public-cms/gallery.ts";
import { galleryVisibilities, galleryStatuses } from "../lib/gallery.ts";

const variants: PublicMedia["variants"] = [
  { src: "/assets/gallery/a-thumbnail.jpg", width: 640, height: 360, format: "jpeg", role: "thumbnail" },
  { src: "/assets/gallery/a-display.jpg", width: 1600, height: 900, format: "jpeg", role: "display" },
  { src: "/assets/gallery/a-display.webp", width: 1600, height: 900, format: "webp", role: "display" },
];

function input(overrides: Partial<CmsGalleryItemInput> = {}): CmsGalleryItemInput {
  return {
    id: "motorcycle-truck-loading-01",
    title: "ขนส่งรถจักรยานยนต์ด้วยรถบรรทุก 4 ล้อ",
    status: "PUBLISHED",
    visibility: "PUBLIC",
    altText: "รถบรรทุก 4 ล้อบรรทุกรถจักรยานยนต์",
    caption: "การจัดเรียงรถระหว่างปฏิบัติงาน",
    categoryId: "truck-loading",
    categoryLabel: "โหลดรถขึ้นรถบรรทุก",
    featured: true,
    order: 10,
    variants,
    ...overrides,
  };
}

function item(overrides: Partial<PublicGalleryItem> = {}): PublicGalleryItem {
  const built = toPublicGalleryItem(input());
  assert.ok(built.ok);
  return { ...built.item, ...overrides };
}

// --- the boundary that keeps private work private --------------------------

test("only a published, publicly visible item is publishable", () => {
  assert.equal(toPublicGalleryItem(input()).ok, true);
  for (const status of ["DRAFT", "HIDDEN", "ARCHIVED", "", "published"]) {
    assert.equal(toPublicGalleryItem(input({ status })).ok, false, `${status} must be refused`);
  }
});

test("customer and internal photographs are refused even when published", () => {
  // The same library holds customer motorcycles, inspection findings, proof of
  // delivery and signatures. Publishing one of those is not a typo, it is an
  // incident.
  for (const visibility of ["CUSTOMER_JOB", "INTERNAL"]) {
    const result = toPublicGalleryItem(input({ visibility, status: "PUBLISHED" }));
    assert.equal(result.ok, false, `${visibility} must never be public`);
    assert.match(result.ok === false ? result.reason : "", /not public/);
  }
});

test("a visibility this contract has never heard of is refused, not tolerated", () => {
  for (const visibility of ["", "public", "SHARED", "UNKNOWN", "TRUE"]) {
    assert.equal(toPublicGalleryItem(input({ visibility })).ok, false, `${visibility} must be refused`);
  }
});

test("every visibility the media library defines has a stated public decision", () => {
  // A visibility added on Lane B's side must be an explicit decision here
  // rather than defaulting to visible.
  for (const visibility of galleryVisibilities) {
    assert.equal(
      typeof GALLERY_VISIBILITY_IS_PUBLIC[visibility],
      "boolean",
      `${visibility} has no stated public decision`,
    );
  }
  assert.equal(GALLERY_VISIBILITY_IS_PUBLIC.PUBLIC, true);
  assert.equal(Object.values(GALLERY_VISIBILITY_IS_PUBLIC).filter(Boolean).length, 1);
  // And the states the library defines are the ones the refusal test covers.
  assert.ok(galleryStatuses.has("PUBLISHED"));
});

test("a public item whose media points at an authenticated path is still refused", () => {
  // Two independent conditions: one flipped visibility column must not be
  // enough to put a customer's motorcycle on a marketing page.
  for (const src of [
    "/api/motorcycles/1/images/2.jpg",
    "/app/jobs/5/pod.jpg",
    "/auth/session.png",
    "/_next/static/a.jpg",
    "https://example.com/a.jpg",
    "//example.com/a.jpg",
    "/assets/../private/a.jpg",
    "data:image/png;base64,AAA",
  ]) {
    const result = toPublicGalleryItem(
      input({ variants: [{ src, width: 800, height: 600, format: "jpeg", role: "display" }] }),
    );
    assert.equal(result.ok, false, `${src} must be refused`);
  }
});

test("an item without alt text or real dimensions is refused rather than lowered", () => {
  assert.equal(toPublicGalleryItem(input({ altText: "" })).ok, false);
  assert.equal(
    toPublicGalleryItem(input({ variants: [{ src: "/assets/gallery/a.jpg", width: 0, height: 600, format: "jpeg", role: "display" }] })).ok,
    false,
  );
  assert.equal(toPublicGalleryItem(input({ variants: [] })).ok, false);
  assert.equal(toPublicGalleryItem(input({ title: "" })).ok, false);
  assert.equal(toPublicGalleryItem(input({ id: "" })).ok, false);
});

test("an uncategorised item is publishable, it simply has no category", () => {
  const result = toPublicGalleryItem(input({ categoryId: null, categoryLabel: null }));
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.item.category, null);
  // Half a category is not a category.
  const halfway = toPublicGalleryItem(input({ categoryLabel: null }));
  assert.equal(halfway.ok && halfway.item.category, null);
});

// --- ordering ---------------------------------------------------------------

test("featured photographs come first, then the editor's order", () => {
  const items = [
    item({ id: "c", featured: false, order: 1 }),
    item({ id: "a", featured: true, order: 30 }),
    item({ id: "b", featured: false, order: 0 }),
  ];
  const view = buildGalleryView(items);
  assert.deepEqual(view.cards.map((card) => card.id), ["a", "b", "c"]);
});

test("two items given the same order do not shuffle between renders", () => {
  // Without a tie-break, "load more" shows a duplicate and hides something
  // else — the same defect the post list has, for the same reason.
  const items = [item({ id: "z", order: 5 }), item({ id: "m", order: 5 }), item({ id: "a", order: 5 })];
  const first = buildGalleryView(items).cards.map((card) => card.id);
  const second = buildGalleryView([...items].reverse()).cards.map((card) => card.id);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["a", "m", "z"]);
  assert.ok(compareGalleryItems(item({ id: "a", order: 5 }), item({ id: "b", order: 5 })) < 0);
});

test("an item with no usable order sorts last rather than first", () => {
  const built = toPublicGalleryItem(input({ order: Number.NaN }));
  assert.ok(built.ok);
  const view = buildGalleryView([built.item, item({ id: "ordered", featured: true, order: 1 })]);
  assert.equal(view.cards[0]?.id, "ordered");
});

// --- filters ----------------------------------------------------------------

const categorised = (id: string, categoryId: string, label: string, order = 0) => {
  const built = toPublicGalleryItem(input({ id, categoryId, categoryLabel: label, featured: false, order }));
  assert.ok(built.ok);
  return built.item;
};

test("the filter row offers only categories that actually have photographs", () => {
  const items = [
    categorised("a", "storage", "ลานสต๊อก"),
    categorised("b", "storage", "ลานสต๊อก", 1),
    categorised("c", "delivery", "ส่งมอบปลายทาง"),
  ];
  const view = buildGalleryView(items);
  // "ทั้งหมด" is always first; the rest follow the Thai alphabet, so
  // "ลานสต๊อก" precedes "ส่งมอบปลายทาง" as it would in a Thai index.
  assert.deepEqual(view.filters.map((filter) => filter.id), ["all", "storage", "delivery"]);
  assert.equal(view.filters.find((filter) => filter.id === "storage")?.count, 2);
  assert.equal(view.filters.find((filter) => filter.id === "all")?.count, 3);
  assert.equal(view.filters.find((filter) => filter.id === "all")?.active, true);
});

test("filtering shows exactly that category and marks the control pressed", () => {
  const items = [categorised("a", "storage", "ลานสต๊อก"), categorised("c", "container", "Container")];
  const view = buildGalleryView(items, { activeCategory: "storage" });
  assert.deepEqual(view.cards.map((card) => card.id), ["a"]);
  assert.equal(view.filters.find((filter) => filter.id === "storage")?.active, true);
  assert.equal(view.filters.find((filter) => filter.id === "all")?.active, false);
  assert.equal(view.matching, 1);
  assert.equal(view.total, 2);
});

test("a stale category link shows the whole gallery rather than a dead end", () => {
  const items = [categorised("a", "storage", "ลานสต๊อก")];
  const view = buildGalleryView(items, { activeCategory: "a-category-the-owner-emptied" });
  assert.equal(view.cards.length, 1);
  assert.equal(view.filters.find((filter) => filter.id === "all")?.active, true);
  assert.equal(view.emptyReason, null);
});

test("an item whose category is unknown still gets a label, never an empty one", () => {
  const built = toPublicGalleryItem(input({ categoryId: null, categoryLabel: null }));
  assert.ok(built.ok);
  const view = buildGalleryView([built.item]);
  assert.equal(view.cards[0]?.categoryLabel, "ผลงานจริง");
});

// --- paging and failure -----------------------------------------------------

test("the grid stops at the limit and reports that there is more", () => {
  const items = Array.from({ length: GALLERY_INITIAL_LIMIT + 3 }, (_, index) =>
    categorised(`item-${String(index).padStart(2, "0")}`, "storage", "ลานสต๊อก", index),
  );
  const view = buildGalleryView(items);
  assert.equal(view.shown, GALLERY_INITIAL_LIMIT);
  assert.equal(view.hasMore, true);
  assert.equal(view.matching, GALLERY_INITIAL_LIMIT + 3);

  const all = buildGalleryView(items, { limit: 100 });
  assert.equal(all.hasMore, false);
  assert.equal(all.shown, GALLERY_INITIAL_LIMIT + 3);
});

test("one broken photograph does not empty the gallery", () => {
  const broken = item({ id: "broken", media: { ...item().media, variants: [{ src: "/assets/a.avif", width: 10, height: 10, format: "avif", role: "display" }] } });
  const view = buildGalleryView([item({ id: "good", order: 0 }), broken]);
  assert.deepEqual(view.cards.map((card) => card.id), ["good"]);
  assert.deepEqual(view.skipped.map((entry) => entry.id), ["broken"]);
  assert.equal(view.emptyReason, null);
});

test("more is measured against what matched, so a skipped item is not offered again", () => {
  const items = [
    item({ id: "a", order: 0 }),
    item({ id: "b", order: 1, media: { ...item().media, variants: [] } }),
    item({ id: "c", order: 2 }),
  ];
  const view = buildGalleryView(items, { limit: 2 });
  assert.equal(view.shown, 1, "b was inside the limit but could not be rendered");
  assert.equal(view.matching, 3);
  assert.equal(view.hasMore, true, "c has still not been shown");
});

test("an empty gallery says why, and says something different for an empty category", () => {
  assert.equal(buildGalleryView([]).emptyReason, "ยังไม่มีภาพที่เผยแพร่");
  const items = [categorised("a", "storage", "ลานสต๊อก"), categorised("b", "container", "Container")];
  // A category with no matches is only reachable when it exists in the filter
  // row, so an explicitly empty result comes from a limit of zero matches.
  const filtered = buildGalleryView(items, { activeCategory: "container" });
  assert.equal(filtered.emptyReason, null);

  const allBroken = buildGalleryView([item({ id: "x", media: { ...item().media, variants: [] } })]);
  assert.equal(allBroken.emptyReason, "ไม่สามารถแสดงภาพในหมวดนี้ได้");
  assert.equal(allBroken.skipped.length, 1);
});

test("only the first card of the first screen loads eagerly", () => {
  const items = [item({ id: "a", order: 0 }), item({ id: "b", order: 1 })];
  const view = buildGalleryView(items, { mediaOptions: { priority: true } });
  assert.equal(view.cards[0]?.image.img.loading, "eager");
  assert.equal(view.cards[0]?.image.img.fetchpriority, "high");
  assert.equal(view.cards[1]?.image.img.loading, "lazy");

  const lazy = buildGalleryView(items);
  assert.equal(lazy.cards[0]?.image.img.loading, "lazy");
});

test("every card carries alt text and intrinsic dimensions", () => {
  const view = buildGalleryView([item()]);
  const card = view.cards[0];
  assert.ok(card);
  assert.equal(card.image.img.alt, "รถบรรทุก 4 ล้อบรรทุกรถจักรยานยนต์");
  assert.equal(card.image.img.width > 0 && card.image.img.height > 0, true);
  assert.equal(card.image.aspectRatio, "1600 / 900");
  assert.ok(card.image.img.srcset.includes("640w"), "the thumbnail is offered to small screens");
  assert.ok(card.image.sources.some((source) => source.type === "image/webp"));
});

// --- the lightbox -----------------------------------------------------------

test("the lightbox answers Escape and both arrow keys", () => {
  assert.deepEqual(LIGHTBOX_KEYS, { Escape: "CLOSE", ArrowLeft: "PREVIOUS", ArrowRight: "NEXT" });
});

test("navigation wraps, so no arrow key is ever dead", () => {
  const view = buildGalleryView([item({ id: "a", order: 0 }), item({ id: "b", order: 1 }), item({ id: "c", order: 2 })]);
  const first = buildLightbox(view, 0);
  assert.ok(first);
  assert.equal(first?.previousIndex, 2);
  assert.equal(first?.nextIndex, 1);

  const last = buildLightbox(view, 2);
  assert.equal(last?.nextIndex, 0);
  assert.equal(last?.previousIndex, 1);

  assert.equal(reduceLightbox(first!, "NEXT"), 1);
  assert.equal(reduceLightbox(first!, "PREVIOUS"), 2);
  assert.equal(reduceLightbox(first!, "CLOSE"), null);
});

test("a single photograph still navigates to itself rather than breaking", () => {
  const view = buildGalleryView([item()]);
  const model = buildLightbox(view, 0);
  assert.equal(model?.previousIndex, 0);
  assert.equal(model?.nextIndex, 0);
});

test("an index outside the set opens nothing", () => {
  const view = buildGalleryView([item()]);
  for (const index of [-1, 1, 1.5, Number.NaN]) {
    assert.equal(buildLightbox(view, index), null, `${index} must not open`);
  }
  assert.equal(buildLightbox(buildGalleryView([]), 0), null);
});

test("the lightbox loads the requested photograph eagerly at display size", () => {
  // The visitor asked for this exact image; lazily loading it shows them an
  // empty dialog.
  const view = buildGalleryView([item()]);
  const model = buildLightbox(view, 0);
  assert.equal(model?.current.image.img.loading, "eager");
  assert.equal(model?.current.image.img.src, "/assets/gallery/a-display.jpg");
});

test("a swipe moves the way the picture does, and a stray drag does not", () => {
  const view = buildGalleryView([item({ id: "a", order: 0 }), item({ id: "b", order: 1 })]);
  const model = buildLightbox(view, 0);
  assert.equal(model?.gestures.swipeLeft, "NEXT");
  assert.equal(model?.gestures.swipeRight, "PREVIOUS");
  // Below this, someone trying to scroll would advance the gallery instead,
  // which on a phone makes the page feel broken.
  assert.equal(model?.gestures.minimumDistancePx, LIGHTBOX_SWIPE_MIN_PX);
  assert.ok(LIGHTBOX_SWIPE_MIN_PX >= 32);
});

test("the lightbox traps focus and gives it back", () => {
  const view = buildGalleryView([item()]);
  const model = buildLightbox(view, 0);
  assert.equal(model?.focus.initial, "close");
  assert.deepEqual([...(model?.focus.trap ?? [])], ["close", "previous", "next"]);
  assert.equal(model?.focus.restoreToOpener, true);
});

test("every lightbox control is named, and the position is announced", () => {
  const view = buildGalleryView([item({ id: "a", order: 0 }), item({ id: "b", order: 1 })]);
  const model = buildLightbox(view, 1);
  for (const label of Object.values(model?.labels ?? {})) {
    assert.ok(typeof label === "string" && label.trim().length > 0);
  }
  // A screen reader otherwise has no way to know how far through forty
  // photographs it is.
  assert.equal(model?.labels.position, "ภาพที่ 2 จาก 2");
});
