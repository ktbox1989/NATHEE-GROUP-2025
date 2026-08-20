import assert from "node:assert/strict";
import test from "node:test";
import { canPublishGalleryItem, normalizeGallerySlug, parseGallerySortOrder, preferredGalleryContentTypes } from "../lib/gallery.ts";

test("gallery slugs are deterministic and reject an empty normalized value", () => {
  assert.equal(normalizeGallerySlug("  International Jobs  "), "international-jobs");
  assert.equal(normalizeGallerySlug("***"), "");
});

test("gallery ordering is bounded and non-negative", () => {
  assert.equal(parseGallerySortOrder("12"), 12);
  assert.equal(parseGallerySortOrder("-1"), undefined);
  assert.equal(parseGallerySortOrder("1.5"), undefined);
});

test("public publishing requires a display variant and alt text", () => {
  assert.equal(canPublishGalleryItem({ visibility: "PUBLIC", hasDisplayVariant: true, altText: "รถจักรยานยนต์กำลังโหลดขึ้นรถขนส่ง" }), true);
  assert.equal(canPublishGalleryItem({ visibility: "PUBLIC", hasDisplayVariant: false, altText: "ภาพงานจริง" }), false);
  assert.equal(canPublishGalleryItem({ visibility: "CUSTOMER_JOB", hasDisplayVariant: true, altText: "ภาพส่งมอบรถของงานลูกค้า" }), true);
  assert.equal(canPublishGalleryItem({ visibility: "INTERNAL", hasDisplayVariant: true, altText: "ภาพงานจริง" }), false);
});

test("content negotiation prefers modern formats only when accepted", () => {
  assert.deepEqual(preferredGalleryContentTypes("image/avif,image/webp,*/*").slice(0, 2), ["image/avif", "image/webp"]);
  assert.equal(preferredGalleryContentTypes("image/jpeg")[0], "image/jpeg");
});
