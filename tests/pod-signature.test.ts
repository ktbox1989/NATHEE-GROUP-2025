import assert from "node:assert/strict";
import test from "node:test";
import { browserSecureUuid } from "../lib/browser-secure-id.ts";
import { hasPodSignatureAttestation, isPodSignatureGeometry, parsePodSignatureDimension, readPngDimensions } from "../lib/pod-signature.ts";

test("POD signature dimensions and attestation fail closed", () => {
  assert.equal(parsePodSignatureDimension("720"), 720);
  assert.equal(parsePodSignatureDimension("0"), undefined);
  assert.equal(parsePodSignatureDimension("720.5"), undefined);
  assert.equal(parsePodSignatureDimension("not-a-number"), undefined);
  assert.equal(isPodSignatureGeometry(720, 240), true);
  assert.equal(isPodSignatureGeometry(240, 720), false);
  assert.equal(isPodSignatureGeometry(199, 100), false);
  assert.equal(isPodSignatureGeometry(720, 79), false);
  assert.equal(hasPodSignatureAttestation("confirmed"), true);
  assert.equal(hasPodSignatureAttestation("on"), false);
  assert.equal(hasPodSignatureAttestation(null), false);
});

test("POD signature dimensions come from the PNG artifact rather than client claims", () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 720, false);
  view.setUint32(20, 240, false);
  assert.deepEqual(readPngDimensions(bytes), { width: 720, height: 240 });
  bytes[12] = 0;
  assert.equal(readPngDimensions(bytes), undefined);
  assert.equal(readPngDimensions(new Uint8Array(10)), undefined);
});

test("secure browser UUID uses randomUUID when available", () => {
  assert.match(browserSecureUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("secure browser UUID falls back to getRandomValues without Math.random", { concurrency: false }, () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  let called = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(values: Uint8Array) {
        called += 1;
        values.forEach((_value, index) => { values[index] = index + 1; });
        return values;
      },
    },
  });
  try {
    assert.equal(browserSecureUuid(), "01020304-0506-4708-890a-0b0c0d0e0f10");
    assert.equal(called, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});

test("secure browser UUID refuses an environment without secure randomness", { concurrency: false }, () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
  try {
    assert.throws(() => browserSecureUuid(), /secure random unavailable/);
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});
