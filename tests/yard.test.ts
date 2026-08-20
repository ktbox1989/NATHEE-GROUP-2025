import assert from "node:assert/strict";
import test from "node:test";
import { isYardPlacementAllowed, isYardRequestKey, normalizeYardZoneCode, parseYardCapacity, parseYardCursor, YARD_PAGE_SIZE } from "../lib/yard.ts";

test("yard zone codes are canonical and bounded", () => {
  assert.equal(normalizeYardZoneCode(" a-01 "), "A-01");
  assert.equal(normalizeYardZoneCode("A"), null);
  assert.equal(normalizeYardZoneCode("ลาน-1"), null);
  assert.equal(normalizeYardZoneCode(`A${"1".repeat(30)}`), null);
});

test("yard capacity is optional but must be a positive bounded integer", () => {
  assert.equal(parseYardCapacity(""), null);
  assert.equal(parseYardCapacity("50"), 50);
  assert.equal(parseYardCapacity("0"), undefined);
  assert.equal(parseYardCapacity("1.5"), undefined);
  assert.equal(parseYardCapacity("100001"), undefined);
});

test("yard request keys and cursors fail closed", () => {
  const id = "0198f708-44a3-7ef7-8d4f-4f477922ff2a";
  assert.equal(isYardRequestKey(id), true);
  assert.equal(isYardRequestKey("not-a-uuid"), false);
  assert.deepEqual(parseYardCursor("2026-08-20T12:00:00.000Z", id), {
    enteredAt: "2026-08-20T12:00:00.000Z",
    id,
  });
  assert.equal(parseYardCursor(undefined, undefined), undefined);
  assert.equal(parseYardCursor("bad", id), null);
  assert.equal(parseYardCursor("2026-08-20T12:00:00.000Z", undefined), null);
  assert.equal(YARD_PAGE_SIZE, 50);
});

test("yard assignment is allowed only for operationally compatible statuses", () => {
  assert.equal(isYardPlacementAllowed("RECEIVED"), true);
  assert.equal(isYardPlacementAllowed("IN_YARD"), true);
  assert.equal(isYardPlacementAllowed("DAMAGED"), true);
  assert.equal(isYardPlacementAllowed("IN_TRANSIT"), false);
  assert.equal(isYardPlacementAllowed("DELIVERED"), false);
  assert.equal(isYardPlacementAllowed("CLOSED"), false);
});
