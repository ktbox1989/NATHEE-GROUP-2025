import assert from "node:assert/strict";
import test from "node:test";
import {
  eventTimestamp,
  isEventTimestamp,
  isRecordTimestamp,
  recordTimestamp,
  timestampInstant,
} from "../lib/timestamps.ts";

const INSTANT = new Date("2026-08-23T07:05:09.123Z");

test("a record timestamp is written exactly as CURRENT_TIMESTAMP writes it", () => {
  assert.equal(recordTimestamp(INSTANT), "2026-08-23 07:05:09");
  assert.match(recordTimestamp(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(isRecordTimestamp(recordTimestamp()), true);
  assert.equal(isEventTimestamp(recordTimestamp()), false);
});

test("an event timestamp keeps the ISO form the CHECK constraints compare", () => {
  assert.equal(eventTimestamp(INSTANT), "2026-08-23T07:05:09.123Z");
  assert.equal(isEventTimestamp(eventTimestamp()), true);
  assert.equal(isRecordTimestamp(eventTimestamp()), false);
});

test("both forms are UTC, so neither drifts with the server's timezone", () => {
  const instant = new Date("2026-08-23T00:30:00.000Z");
  assert.equal(recordTimestamp(instant), "2026-08-23 00:30:00");
  assert.equal(eventTimestamp(instant), "2026-08-23T00:30:00.000Z");
});

test("record timestamps sort chronologically against each other", () => {
  const earlier = recordTimestamp(new Date("2026-08-23T00:00:01.000Z"));
  const later = recordTimestamp(new Date("2026-08-23T23:59:00.000Z"));
  assert.ok(later > earlier);
  assert.ok(recordTimestamp(new Date("2026-08-24T00:00:00.000Z")) > later);
});

test("the mixed pair is exactly the ordering defect this contract removes", () => {
  // Same day, thirteen hours apart, written by the two former conventions.
  const lateRecord = "2026-08-23 23:59:00";
  const earlyIso = "2026-08-23T00:00:01.000Z";
  assert.ok(earlyIso > lateRecord, "an earlier ISO value sorts above a later record value");
  assert.ok(
    (timestampInstant(earlyIso) ?? 0) < (timestampInstant(lateRecord) ?? 0),
    "…even though it is the earlier instant",
  );
  // Written through the contract, the same two instants sort correctly.
  assert.ok(
    recordTimestamp(new Date(earlyIso)) < recordTimestamp(new Date(lateRecord)),
  );
});

test("stored values of either form can still be read back as instants", () => {
  assert.equal(timestampInstant("2026-08-23 07:05:09"), Date.parse("2026-08-23T07:05:09Z"));
  assert.equal(timestampInstant("2026-08-23T07:05:09.123Z"), Date.parse("2026-08-23T07:05:09.123Z"));
  for (const invalid of ["", "2026-08-23", "23/08/2026", "2026-08-23 07:05", "not a time", "2026-13-45 99:99:99"]) {
    assert.equal(timestampInstant(invalid), null, invalid);
  }
});

test("an invalid date is refused rather than stored as 'Invalid Date'", () => {
  assert.throws(() => recordTimestamp(new Date("nonsense")), RangeError);
  assert.throws(() => eventTimestamp(new Date("nonsense")), RangeError);
});
