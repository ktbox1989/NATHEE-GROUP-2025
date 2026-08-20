import assert from "node:assert/strict";
import test from "node:test";
import {
  hasExpectedImageSignature,
  sha256Hex,
} from "../lib/image-validation.ts";

test("image signatures must match the declared content type", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = new TextEncoder().encode("RIFF0000WEBP");
  const heic = new TextEncoder().encode("0000ftypheic");

  assert.equal(hasExpectedImageSignature(jpeg, "image/jpeg"), true);
  assert.equal(hasExpectedImageSignature(png, "image/png"), true);
  assert.equal(hasExpectedImageSignature(webp, "image/webp"), true);
  assert.equal(hasExpectedImageSignature(heic, "image/heic"), true);
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
