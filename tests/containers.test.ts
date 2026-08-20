import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContainerNumber, normalizeContainerText } from "../lib/containers.ts";

test("ISO 6346 container numbers are canonical and check-digit verified", () => {
  assert.equal(normalizeContainerNumber("CSQU 305438-3"), "CSQU3054383");
  assert.equal(normalizeContainerNumber("CSQU3054382"), null);
  assert.equal(normalizeContainerNumber("ABCX1234567"), null);
  assert.equal(normalizeContainerNumber(""), null);
});

test("container port, country and seal text remain bounded", () => {
  assert.equal(normalizeContainerText("  Laem   Chabang  "), "Laem Chabang");
  assert.equal(normalizeContainerText(""), null);
  assert.equal(normalizeContainerText("x".repeat(101)), undefined);
  assert.equal(normalizeContainerText("SEAL-001", 50), "SEAL-001");
});
