import assert from "node:assert/strict";
import test from "node:test";
import { assertStatusTransition, canTransition, InvalidStatusTransitionError } from "../lib/status-transitions.ts";

test("normal motorcycle workflow allows each adjacent transition", () => {
  const path = [
    "PENDING_RECEIPT", "RECEIVED", "INSPECTED", "IN_YARD", "SCHEDULED",
    "LOADED", "IN_TRANSIT", "ARRIVED", "DELIVERED", "CLOSED",
  ] as const;

  for (let index = 0; index < path.length - 1; index += 1) {
    assert.equal(canTransition(path[index], path[index + 1]), true);
  }
});

test("workflow does not allow skipping operational checkpoints", () => {
  assert.equal(canTransition("RECEIVED", "IN_TRANSIT"), false);
  assert.throws(
    () => assertStatusTransition("RECEIVED", "IN_TRANSIT"),
    InvalidStatusTransitionError,
  );
});

test("closed and cancelled records are terminal", () => {
  assert.equal(canTransition("CLOSED", "RECEIVED"), false);
  assert.equal(canTransition("CANCELLED", "RECEIVED"), false);
});
