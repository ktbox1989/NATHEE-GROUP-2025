import assert from "node:assert/strict";
import test from "node:test";
import { createMotorcycleQrToken, isMotorcyclePublicId, LABEL_BATCH_SIZE, parseLabelCursor, parseMotorcycleQrToken, QR_INPUT_MAX_LENGTH } from "../lib/qr.ts";

const PUBLIC_ID = `mc_${"a".repeat(32)}`;

test("motorcycle QR token round-trips without exposing record data", () => {
  const token = createMotorcycleQrToken(PUBLIC_ID);
  assert.equal(token, `NATHEE:MC:${PUBLIC_ID}`);
  assert.equal(parseMotorcycleQrToken(token), PUBLIC_ID);
  assert.equal(token.includes("VIN"), false);
  assert.equal(token.includes("ทะเบียน"), false);
  assert.equal(token.includes("customer"), false);
});

test("manual lookup accepts the canonical opaque public identifier", () => {
  assert.equal(isMotorcyclePublicId(PUBLIC_ID), true);
  assert.equal(parseMotorcycleQrToken(PUBLIC_ID), PUBLIC_ID);
});

test("invalid, malformed, padded, and oversized tokens fail closed", () => {
  const invalid = [
    "",
    "NATHEE:MC:",
    `NATHEE:MC:mc_${"g".repeat(32)}`,
    `${PUBLIC_ID}extra`,
    ` ${PUBLIC_ID}`,
    `${PUBLIC_ID} `,
    "x".repeat(QR_INPUT_MAX_LENGTH + 1),
  ];
  for (const value of invalid) assert.equal(parseMotorcycleQrToken(value), null, value);
  assert.throws(() => createMotorcycleQrToken("mc_not-valid"));
});

test("batch label cursor is bounded to non-negative safe integers", () => {
  assert.equal(LABEL_BATCH_SIZE, 48);
  assert.equal(parseLabelCursor(undefined), 0);
  assert.equal(parseLabelCursor("0"), 0);
  assert.equal(parseLabelCursor("48"), 48);
  assert.equal(parseLabelCursor("-1"), null);
  assert.equal(parseLabelCursor("01"), null);
  assert.equal(parseLabelCursor("1.5"), null);
  assert.equal(parseLabelCursor(String(Number.MAX_SAFE_INTEGER + 1)), null);
});
