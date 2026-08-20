import assert from "node:assert/strict";
import test from "node:test";
import {
  hasRequiredMotorcycleImageVariants,
  isMotorcycleImageRequestKey,
  motorcycleImageVariantByteLimit,
  parseMotorcycleImageDimension,
  parseMotorcycleImageRole,
  preferredMotorcycleImageContentTypes,
} from "../lib/motorcycle-image-variants.ts";

test("motorcycle image request keys use a strict cryptographic UUID identity", () => {
  assert.equal(isMotorcycleImageRequestKey("motorcycle-image-123e4567-e89b-42d3-a456-426614174000"), true);
  assert.equal(isMotorcycleImageRequestKey("motorcycle-image-not-random"), false);
  assert.equal(isMotorcycleImageRequestKey("gallery-upload-123e4567-e89b-42d3-a456-426614174000"), false);
});

test("private image role parsing is bounded and defaults to display", () => {
  assert.equal(parseMotorcycleImageRole("thumbnail"), "THUMBNAIL");
  assert.equal(parseMotorcycleImageRole("original"), "ORIGINAL");
  assert.equal(parseMotorcycleImageRole("unexpected"), "DISPLAY");
  assert.equal(parseMotorcycleImageRole(null), "DISPLAY");
});

test("content negotiation prefers AVIF only when the browser accepts it", () => {
  assert.deepEqual(preferredMotorcycleImageContentTypes("image/avif,image/webp,*/*"), ["image/avif", "image/webp"]);
  assert.deepEqual(preferredMotorcycleImageContentTypes("image/jpeg"), []);
});

test("new uploads require WebP display and thumbnail variants", () => {
  assert.equal(hasRequiredMotorcycleImageVariants([{ role: "DISPLAY", contentType: "image/webp" }, { role: "THUMBNAIL", contentType: "image/webp" }]), true);
  assert.equal(hasRequiredMotorcycleImageVariants([{ role: "DISPLAY", contentType: "image/avif" }, { role: "THUMBNAIL", contentType: "image/avif" }]), false);
  assert.equal(hasRequiredMotorcycleImageVariants([{ role: "DISPLAY", contentType: "image/webp" }]), false);
});

test("variant dimensions must be positive bounded integers", () => {
  assert.equal(parseMotorcycleImageDimension("640"), 640);
  assert.equal(parseMotorcycleImageDimension("0"), undefined);
  assert.equal(parseMotorcycleImageDimension("1.5"), undefined);
  assert.equal(parseMotorcycleImageDimension("50001"), undefined);
});

test("thumbnail payloads have a stricter mobile byte budget than display images", () => {
  assert.equal(motorcycleImageVariantByteLimit("THUMBNAIL"), 1024 * 1024);
  assert.equal(motorcycleImageVariantByteLimit("DISPLAY"), 3 * 1024 * 1024);
});
