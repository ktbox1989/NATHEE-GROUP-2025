import assert from "node:assert/strict";
import test from "node:test";
import { validateMedia, validateMediaSrc, type PublicMedia } from "../lib/public-cms/contract.ts";
import { POSTS_INDEX_PATH, isPostPath, isValidPostSlug } from "../lib/public-cms/posts.ts";
import { buildPublicMediaPath } from "../lib/public-media-delivery.ts";
import {
  MAX_NEWS_PAGE,
  clampNewsPage,
  formatThaiDate,
  referencedIndexImageIds,
  toNewsCard,
  toPublicationIso,
  type NewsIndexRow,
} from "../lib/public-news-content.ts";

// Built through the delivery contract rather than by hand, so the fixture
// cannot drift from the paths the route actually serves.
const image: PublicMedia = {
  id: "photo-1",
  altText: "รถบรรทุกกำลังโหลดรถจักรยานยนต์",
  caption: null,
  variants: [
    { src: buildPublicMediaPath({ itemId: "photo-1", role: "display", format: "jpeg" })!, width: 1600, height: 1200, format: "jpeg", role: "display" },
    { src: buildPublicMediaPath({ itemId: "photo-1", role: "display", format: "webp" })!, width: 1600, height: 1200, format: "webp", role: "display" },
    { src: buildPublicMediaPath({ itemId: "photo-1", role: "thumbnail", format: "jpeg" })!, width: 640, height: 480, format: "jpeg", role: "thumbnail" },
  ],
};
const images = new Map<string, PublicMedia>([[image.id, image]]);

function content(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    title: "เปิดเส้นทางใหม่ กรุงเทพฯ–เชียงราย",
    excerpt: "รองรับงานรายคันและงานล็อตบนเส้นทางภาคเหนือตอนบน",
    category: { id: "route", label: "เส้นทาง" },
    featuredImageItemId: "",
    sections: [
      { id: "body-1", type: "CONTENT", enabled: true, heading: "รายละเอียดเส้นทาง", body: "รับงานรายคันและงานล็อต" },
    ],
    seo: { title: "เปิดเส้นทางใหม่", description: "รายละเอียดเส้นทางใหม่", robots: "INDEX" },
    ...overrides,
  });
}

function row(overrides: Partial<NewsIndexRow> = {}): NewsIndexRow {
  return {
    slug: "new-route-chiang-rai",
    revision_id: "rev-1",
    content_json: content(),
    first_published: "2026-08-01 09:00:00",
    last_published: "2026-08-01 09:00:00",
    publish_count: 1,
    ...overrides,
  };
}

test("a card carries the published revision, and its path is derived from the slug", () => {
  const card = toNewsCard(row(), images);
  assert.ok(card);
  assert.equal(card.slug, "new-route-chiang-rai");
  assert.equal(card.path, "/news/new-route-chiang-rai/");
  // The path the card links to must be one the route can actually serve.
  assert.ok(isPostPath(card.path));
  assert.ok(isValidPostSlug(card.slug));
  assert.equal(card.title, "เปิดเส้นทางใหม่ กรุงเทพฯ–เชียงราย");
  assert.deepEqual(card.category, { id: "route", label: "เส้นทาง" });
});

test("a post published once reports no edit, so nothing claims an edit that never happened", () => {
  const card = toNewsCard(row({ publish_count: 1, last_published: "2026-08-09 09:00:00" }), images);
  assert.equal(card?.updatedAt, null);
});

test("a post published again reports the later publication as the edit", () => {
  const card = toNewsCard(row({ publish_count: 2, last_published: "2026-08-09 09:00:00" }), images);
  assert.equal(card?.publishedAt, "2026-08-01T09:00:00.000Z");
  assert.equal(card?.updatedAt, "2026-08-09T09:00:00.000Z");
});

test("a featured image resolves only when the gallery item is renderable", () => {
  const withImage = toNewsCard(row({ content_json: content({ featuredImageItemId: "photo-1" }) }), images);
  assert.deepEqual(withImage?.image, image);

  // Archived or made private after publication: dropped rather than rendered as
  // a broken image.
  const withMissingImage = toNewsCard(row({ content_json: content({ featuredImageItemId: "photo-gone" }) }), images);
  assert.equal(withMissingImage?.image, null);
});

test("a revision that no longer parses is dropped from the index rather than half-rendered", () => {
  assert.equal(toNewsCard(row({ content_json: "{not json" }), images), null);
  assert.equal(toNewsCard(row({ content_json: JSON.stringify({ version: 2 }) }), images), null);
  assert.equal(toNewsCard(row({ content_json: content({ title: "" }) }), images), null);
  // A card with a headline and nothing under it reads as a defect.
  assert.equal(toNewsCard(row({ content_json: content({ excerpt: "" }) }), images), null);
});

test("a row without a usable publication date is not rendered", () => {
  assert.equal(toNewsCard(row({ first_published: null }), images), null);
  assert.equal(toNewsCard(row({ first_published: "not a date" }), images), null);
});

test("a row that is not the shape the query returns is refused rather than trusted", () => {
  assert.equal(toNewsCard(row({ slug: 42 }), images), null);
  assert.equal(toNewsCard(row({ content_json: null }), images), null);
});

test("both stored timestamp forms are read, and nothing else is", () => {
  assert.equal(toPublicationIso("2026-08-01 09:00:00"), "2026-08-01T09:00:00.000Z");
  assert.equal(toPublicationIso("2026-08-01T09:00:00.000Z"), "2026-08-01T09:00:00.000Z");
  assert.equal(toPublicationIso("01/08/2026"), null);
  assert.equal(toPublicationIso(undefined), null);
});

test("a page number from a stranger is reduced to one this site has", () => {
  assert.equal(clampNewsPage(undefined), 1);
  assert.equal(clampNewsPage("1"), 1);
  assert.equal(clampNewsPage("3"), 3);
  assert.equal(clampNewsPage("0"), 1);
  assert.equal(clampNewsPage("-4"), 1);
  assert.equal(clampNewsPage("1.5"), 1);
  assert.equal(clampNewsPage("abc"), 1);
  // An unbounded page would become an unbounded OFFSET.
  assert.equal(clampNewsPage("999999"), MAX_NEWS_PAGE);
  // Not a safe integer at all, so it is the first page rather than the last.
  assert.equal(clampNewsPage("9e99"), 1);
});

test("a publication date is shown in Bangkok time and Buddhist era", () => {
  assert.equal(formatThaiDate("2026-08-01T09:00:00.000Z"), "1 สิงหาคม 2569");
  // 20:30 UTC is half past three the next morning in Bangkok. Rendering the UTC
  // date would show an evening publish as the previous day.
  assert.equal(formatThaiDate("2026-08-01T20:30:00.000Z"), "2 สิงหาคม 2569");
  assert.equal(formatThaiDate("2025-12-31T17:00:00.000Z"), "1 มกราคม 2569");
  assert.equal(formatThaiDate("not a date"), "");
});

test("a post carries the same public media a page does, from the same contract", () => {
  // The single delivery contract: every source is a path under /assets/media/,
  // and the authenticated routes are refused outright. A news payload built the
  // old way — /api/gallery/images/<id> — could never satisfy this.
  assert.deepEqual(validateMedia(image, "featuredImage"), []);
  for (const variant of image.variants) {
    assert.ok(variant.src.startsWith("/assets/media/"), variant.src);
    assert.deepEqual(validateMediaSrc(variant.src, "src"), []);
  }
  assert.equal(image.variants[0].src, "/assets/media/photo-1/display.jpg");

  // The shape the contract refuses, stated so the reason is not lost.
  assert.equal(
    validateMediaSrc("/api/gallery/images/photo-1?role=display", "src")[0]?.reason,
    "references authenticated media and must never be public",
  );
});

test("one page of rows asks for each image once", () => {
  const ids = referencedIndexImageIds([
    row({ content_json: content({ featuredImageItemId: "photo-1" }) }),
    row({ content_json: content({ featuredImageItemId: "photo-1" }) }),
    row({ content_json: content({ featuredImageItemId: "photo-2" }) }),
    row({ content_json: content({ featuredImageItemId: "" }) }),
    row({ content_json: "{not json" }),
  ]);
  assert.deepEqual(ids, ["photo-1", "photo-2"]);
});

test("the index path the routes serve is the one the contract names", () => {
  assert.equal(POSTS_INDEX_PATH, "/news/");
  assert.ok(isPostPath(POSTS_INDEX_PATH));
});
