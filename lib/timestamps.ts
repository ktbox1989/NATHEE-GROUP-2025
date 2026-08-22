/**
 * Two kinds of timestamp are stored in this database, and they are not
 * interchangeable.
 *
 * `created_at` and `updated_at` are the only columns with a database default, and
 * that default is SQLite's `CURRENT_TIMESTAMP`, which writes
 * `YYYY-MM-DD HH:MM:SS` in UTC. Any row inserted without naming them gets that
 * form. Writing ISO-8601 into the same column produces two representations of
 * the same instant that do not sort against each other: within one date, every
 * `2026-08-23T00:00:01.000Z` sorts above every `2026-08-23 23:59:00`, because
 * `T` is greater than a space. That is not cosmetic — the Owner's Audit page
 * orders by `created_at` and pages through it with a keyset cursor, so a mixed
 * column shows the day's events in the wrong order and pages through the wrong
 * order too. Use {@link recordTimestamp}.
 *
 * Every other `*_at` column records when something happened in the real world:
 * a motorcycle entered a yard, a load was released, a customer consented. Those
 * are always supplied by the application, never defaulted, and several are
 * compared against each other by CHECK constraints as text
 * (`exited_at >= entered_at`, `unloaded_at >= loaded_at`). They are ISO-8601 and
 * must stay ISO-8601: switching their representation would make a row written
 * before the switch fail its constraint against one written after, rejecting a
 * legitimate yard exit or unload. Use {@link eventTimestamp}.
 *
 * Neither function ever produces the other's format, which is what makes the
 * distinction checkable rather than a convention someone remembers.
 */

/**
 * For `created_at` and `updated_at`. Byte-identical in form to what
 * `CURRENT_TIMESTAMP` writes, so an explicit write and a defaulted one sort
 * together.
 */
export function recordTimestamp(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("A record timestamp needs a valid date.");
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * For every other `*_at` column: a real-world instant, in the ISO-8601 form the
 * existing rows and CHECK constraints already use.
 */
export function eventTimestamp(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("An event timestamp needs a valid date.");
  }
  return date.toISOString();
}

const RECORD_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const EVENT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isRecordTimestamp(value: string): boolean {
  return RECORD_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value.replace(" ", "T")}Z`));
}

export function isEventTimestamp(value: string): boolean {
  return EVENT_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * The instant a stored value denotes, whichever form it is in. Reading tolerates
 * both, because a database written before this contract existed may hold either;
 * only writing is restricted.
 */
export function timestampInstant(value: string): number | null {
  if (isRecordTimestamp(value)) return Date.parse(`${value.replace(" ", "T")}Z`);
  if (isEventTimestamp(value)) return Date.parse(value);
  return null;
}
