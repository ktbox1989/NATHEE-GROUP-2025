import assert from "node:assert/strict";
import test from "node:test";
import { YARD_PAGE_SIZE, expandSlotCodeRange, isYardPlacementAllowed, isYardRequestKey, normalizeYardPositionCode, normalizeYardZoneCode, parseYardCapacity, parseYardCursor } from "../lib/yard.ts";

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


// A row of parking bays is built once, so the form takes a range. The padding
// matters: a label printed `1` and a label printed `01` are the same bay to a
// person and two different codes to the database.
test("a slot range expands to the exact codes that will be painted on the ground", () => {
  assert.deepEqual(expandSlotCodeRange("01-05"), ["01", "02", "03", "04", "05"]);
  assert.deepEqual(expandSlotCodeRange("A1-A3"), ["A1", "A2", "A3"]);
  assert.deepEqual(expandSlotCodeRange("7"), ["7"]);
  assert.deepEqual(expandSlotCodeRange(" b7 "), ["B7"]);
  assert.equal(expandSlotCodeRange("001-003")?.[0], "001", "padding is taken from the first code");
});

test("a range that cannot be built is refused rather than guessed", () => {
  assert.equal(expandSlotCodeRange("05-01"), null, "backwards");
  assert.equal(expandSlotCodeRange("A1-B3"), null, "two different prefixes");
  assert.equal(expandSlotCodeRange("01-999"), null, "beyond the per-row bound");
  assert.equal(expandSlotCodeRange(""), null);
  assert.equal(expandSlotCodeRange("ช่อง1"), null, "codes must be printable on a label");
});

test("a position code is upper case and label-sized", () => {
  assert.equal(normalizeYardPositionCode(" r1 "), "R1");
  assert.equal(normalizeYardPositionCode("A-01"), "A-01");
  assert.equal(normalizeYardPositionCode(""), null);
  assert.equal(normalizeYardPositionCode("-LEADING"), null);
  assert.equal(normalizeYardPositionCode("X".repeat(21)), null);
});
