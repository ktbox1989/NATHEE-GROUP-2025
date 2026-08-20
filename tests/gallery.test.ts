import assert from "node:assert/strict";
import test from "node:test";
import { canPublishGalleryItem, isConfirmedGalleryUploadResponse, isGalleryUploadRequestKey, normalizeGallerySlug, parseGallerySortOrder, preferredGalleryContentTypes } from "../lib/gallery.ts";

test("gallery slugs are deterministic and reject an empty normalized value", () => {
  assert.equal(normalizeGallerySlug("  International Jobs  "), "international-jobs");
  assert.equal(normalizeGallerySlug("***"), "");
});

test("gallery ordering is bounded and non-negative", () => {
  assert.equal(parseGallerySortOrder("12"), 12);
  assert.equal(parseGallerySortOrder("-1"), undefined);
  assert.equal(parseGallerySortOrder("1.5"), undefined);
});

test("gallery upload idempotency requires a cryptographic request identity", () => {
  assert.equal(isGalleryUploadRequestKey("gallery-upload-123e4567-e89b-42d3-a456-426614174000"), true);
  assert.equal(isGalleryUploadRequestKey("queue-123e4567-e89b-42d3-a456-426614174000"), false);
  assert.equal(isGalleryUploadRequestKey("gallery-upload-not-random"), false);
  assert.equal(isGalleryUploadRequestKey("gallery-upload-123e4567-e89b-12d3-a456-426614174000"), false);
});

test("gallery upload never treats followed redirect HTML or incomplete JSON as success", () => {
  assert.equal(isConfirmedGalleryUploadResponse(201, { ok: true, galleryItemId: "gallery-a", duplicate: false }), true);
  assert.equal(isConfirmedGalleryUploadResponse(200, { ok: true, galleryItemId: "gallery-a", duplicate: true }), true);
  assert.equal(isConfirmedGalleryUploadResponse(200, null), false);
  assert.equal(isConfirmedGalleryUploadResponse(200, "<html>validation error</html>"), false);
  assert.equal(isConfirmedGalleryUploadResponse(200, { ok: true }), false);
  assert.equal(isConfirmedGalleryUploadResponse(303, { ok: true, galleryItemId: "gallery-a", duplicate: false }), false);
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
