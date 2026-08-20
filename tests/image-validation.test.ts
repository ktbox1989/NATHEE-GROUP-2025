import assert from "node:assert/strict";
import test from "node:test";
import {
  hasExpectedImageSignature,
  imageDimensionsMatchClaim,
  readImageDimensions,
  sha256Hex,
} from "../lib/image-validation.ts";

test("image signatures must match the declared content type", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = new TextEncoder().encode("RIFF0000WEBP");
  const heic = new TextEncoder().encode("0000ftypheic");
  const avif = new TextEncoder().encode("0000ftypavif");

  assert.equal(hasExpectedImageSignature(jpeg, "image/jpeg"), true);
  assert.equal(hasExpectedImageSignature(png, "image/png"), true);
  assert.equal(hasExpectedImageSignature(webp, "image/webp"), true);
  assert.equal(hasExpectedImageSignature(heic, "image/heic"), true);
  assert.equal(hasExpectedImageSignature(avif, "image/avif"), true);
  assert.equal(hasExpectedImageSignature(jpeg, "image/png"), false);
  assert.equal(
    hasExpectedImageSignature(new TextEncoder().encode("<script>"), "image/jpeg"),
    false,
  );
});

test("image checksum is deterministic SHA-256", async () => {
  const checksum = await sha256Hex(new TextEncoder().encode("nathee"));
  assert.equal(
    checksum,
    "f39ff411f9e1bb2ac9a2c85bd0221fd3e1d8536c67874553d678ca2e0774e82b",
  );
});

test("image dimensions come from PNG and WebP artifact bytes", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(png.buffer).setUint32(16, 1600, false);
  new DataView(png.buffer).setUint32(20, 900, false);
  assert.deepEqual(readImageDimensions(png, "image/png"), { width: 1600, height: 900 });

  const webp = new Uint8Array(30);
  webp.set(new TextEncoder().encode("RIFF0000WEBPVP8X"));
  webp.set([0x3f, 0x06, 0x00], 24); // 1600 - 1
  webp.set([0x83, 0x03, 0x00], 27); // 900 - 1
  assert.deepEqual(readImageDimensions(webp, "image/webp"), { width: 1600, height: 900 });
});

test("server-derived dimensions reject client metadata mismatch and decompression bombs", () => {
  const actual = { width: 1600, height: 900 };
  assert.equal(imageDimensionsMatchClaim(actual, 1600, 900), true);
  assert.equal(imageDimensionsMatchClaim(actual, 1599, 900), false);
  assert.equal(imageDimensionsMatchClaim(actual, null, null), false);
  assert.equal(imageDimensionsMatchClaim(actual, null, null, false), true);

  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(png.buffer).setUint32(16, 20_000, false);
  new DataView(png.buffer).setUint32(20, 20_000, false);
  assert.equal(readImageDimensions(png, "image/png"), undefined);
});
