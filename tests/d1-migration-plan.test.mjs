import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { migrationSteps, parseDeployedObjects, planMigrations } from "../lib/d1-migration-plan.ts";

// The plan decides what gets applied to a database holding real customer
// records, so it is proven against databases built from the real migrations
// rather than against hand-written fixtures.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));

const files = readdirSync(directory)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

const sources = files.map((name) => ({
  tag: name.replace(/\.sql$/, ""),
  sql: readFileSync(`${directory}/${name}`, "utf8"),
}));

/** A database with the first `count` migrations applied, as a real apply would. */
function databaseAfter(count) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const { sql } of sources.slice(0, count)) {
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  const rows = db
    .prepare("SELECT type, name FROM sqlite_schema WHERE type IN ('table','index','trigger')")
    .all();
  db.close();
  return rows.map((row) => ({ type: row.type, name: row.name }));
}

const steps = migrationSteps(sources);

test("every migration in the repository becomes a step", () => {
  assert.equal(steps.length, sources.length);
  assert.equal(steps[0].tag, sources[0].tag);
});

test("a fully migrated database reports nothing remaining", () => {
  const plan = planMigrations(steps, databaseAfter(sources.length));
  assert.equal(plan.remainingTags.length, 0, `remaining: ${plan.remainingTags.join(", ")}`);
  assert.equal(plan.appliedThrough, sources.length - 1);
  assert.equal(plan.partial, null);
  assert.deepEqual(plan.unexpected, []);
});

test("an empty database reports the whole chain, in order", () => {
  const plan = planMigrations(steps, []);
  assert.equal(plan.appliedThrough, -1);
  assert.equal(plan.appliedTags.length, 0);
  assert.deepEqual(plan.remainingTags, sources.map((source) => source.tag));
  assert.equal(plan.partial, null);
});

// The property that matters: from any point in a real apply, the plan is a
// clean state with nothing half-done, and following it never re-runs a
// migration that already ran. Where two states are indistinguishable the plan
// must say so rather than pick one silently.
test("from any point in the chain the plan is a clean state and says so when it cannot tell", () => {
  for (let applied = 0; applied <= sources.length; applied += 1) {
    const plan = planMigrations(steps, databaseAfter(applied));
    assert.equal(plan.partial, null, `after ${applied} migrations`);

    // Whatever it concluded, the remainder plus the conclusion must cover the
    // whole chain exactly once.
    assert.equal(
      plan.appliedTags.length + plan.remainingTags.length,
      sources.length,
      `after ${applied} migrations`,
    );

    if (plan.appliedThrough !== applied - 1) {
      // The only acceptable disagreement is one the schema cannot resolve, and
      // it has to be declared.
      assert.ok(
        plan.ambiguous.length > 0,
        `after ${applied} migrations the plan said ${plan.appliedThrough} without declaring ambiguity`,
      );
    }
  }
});

test("a migration that leaves the schema untouched is declared ambiguous, not assumed", () => {
  // Some migrations rebuild a table and end exactly where they started, so the
  // catalogue cannot show whether they ran. Find one rather than assume which.
  const noOp = steps.findIndex((step, index) => index > 0 && step.introduces.size === 0);
  assert.ok(noOp > 0, "this repository should contain at least one schema-neutral rebuild");

  const plan = planMigrations(steps, databaseAfter(noOp));
  assert.ok(
    plan.ambiguous.length > 0,
    `applying ${noOp} migrations left an indistinguishable state that was not declared`,
  );
  assert.ok(
    plan.ambiguous.every((tag) => sources.some((source) => source.tag === tag)),
    "ambiguous entries must be real migration tags",
  );
});

// Never propose re-running a migration that rebuilds a table: that drops live
// rows, and the schema alone cannot prove it has not already run.
test("an ambiguous rebuild is left applied rather than proposed again", () => {
  for (let applied = 0; applied <= sources.length; applied += 1) {
    const plan = planMigrations(steps, databaseAfter(applied));
    assert.ok(
      plan.appliedThrough >= applied - 1,
      `after ${applied} migrations the plan proposed re-running an applied migration`,
    );
  }
});

test("a half-applied migration is reported as partial, not as progress", () => {
  // A migration that actually adds objects, so half of it is a meaningful state.
  const applied = steps.findIndex((step, index) => index > 0 && step.introduces.size > 1);
  assert.ok(applied > 0, "expected a migration introducing more than one object");

  const deployed = databaseAfter(applied);
  const introduced = [...steps[applied].introduces];
  const [type, name] = introduced[0].split(":");
  const plan = planMigrations(steps, [...deployed, { type, name }]);

  assert.notEqual(plan.partial, null);
  assert.equal(plan.partial.tag, steps[applied].tag);
  assert.ok(plan.partial.present.length > 0);
  assert.ok(plan.partial.missing.length > 0);
  // It must not count the interrupted migration as applied.
  assert.equal(plan.appliedThrough, applied - 1);
});

test("objects no migration creates are reported rather than ignored", () => {
  const deployed = [...databaseAfter(sources.length), { type: "table", name: "left_over_import" }];
  const plan = planMigrations(steps, deployed);
  assert.deepEqual(plan.unexpected, ["table:left_over_import"]);
});

test("sqlite internals and rebuild leftovers are not mistaken for migration objects", () => {
  const deployed = [
    ...databaseAfter(sources.length),
    { type: "index", name: "sqlite_autoindex_users_1" },
    { type: "table", name: "__new_motorcycles" },
  ];
  const plan = planMigrations(steps, deployed);
  assert.deepEqual(plan.unexpected, []);
  assert.equal(plan.remainingTags.length, 0);
});

test("a catalogue is read from JSON rows or from plain lines", () => {
  const json = parseDeployedObjects('[{"type":"table","name":"users"},{"type":"index","name":"idx_a"}]');
  assert.deepEqual(json, [
    { type: "table", name: "users" },
    { type: "index", name: "idx_a" },
  ]);

  const wrapped = parseDeployedObjects('{"result":[{"results":[{"type":"trigger","name":"trg_a"}]}]}');
  assert.deepEqual(wrapped, [{ type: "trigger", name: "trg_a" }]);

  const lines = parseDeployedObjects("type|name\ntable|users\nindex|idx_a\n");
  assert.deepEqual(lines, [
    { type: "table", name: "users" },
    { type: "index", name: "idx_a" },
  ]);
});

// An unreadable catalogue must never degrade into "nothing is applied", because
// that reads as an empty database and invites re-applying the whole chain over
// real data.
test("an unreadable catalogue is an error, never an empty database", () => {
  assert.throws(() => parseDeployedObjects(""), /empty/);
  assert.throws(() => parseDeployedObjects('{"rows":[]}'), /no array/);
  assert.throws(() => parseDeployedObjects("table|users\nview|customer_summary\n"), /unexpected object type/);
  assert.throws(() => parseDeployedObjects('[{"type":"table"}]'), /no object name/);
});
