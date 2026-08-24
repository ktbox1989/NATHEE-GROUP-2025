import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Production stopped cleanly after 0009 and rolled 0010 back with
// `SQLITE_ERROR: incomplete input`. That error is what SQLite says when it is
// handed SQL that stops in the middle of a statement, so it describes how the
// file was *split*, not what the file contains.
//
// These tests pin the execution path rather than the symptom: the migrations
// must survive both splitters that can plausibly run them, every statement must
// be whole, and a failure part-way through must leave nothing behind. The one
// splitter that genuinely produces the Production error is exercised too, so
// that nobody adopts it while trying to fix a future failure.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const require = createRequire(import.meta.url);
// The real Cloudflare D1 statement splitter (wrangler src/d1/splitter.ts),
// exported for exactly this kind of use. Using the shipped implementation means
// these tests track D1's semantics instead of a local guess at them.
const { unstable_splitSqlQuery: splitLikeD1 } = require("wrangler");

const MIGRATIONS = readdirSync(directory)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

/** Line endings differ between a Linux CI checkout and a Windows one. */
const lf = (sql) => sql.replace(/\r\n/g, "\n");
const read = (name) => lf(readFileSync(`${directory}${name}`, "utf8"));

/** How drizzle intends these files to be executed: the journal says breakpoints. */
const splitOnMarkers = (sql) =>
  sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);

// The D1 splitter consumes `--` comments while the marker split keeps them, so
// comparing the SQL means dropping commentary and collapsing whitespace first.
const normalize = (sql) =>
  sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/;\s*$/, "")
    .trim();

function applyThrough(db, lastIndex, split = splitOnMarkers) {
  for (const name of MIGRATIONS.slice(0, lastIndex + 1)) {
    for (const statement of split(read(name))) db.exec(statement);
  }
}

function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const objectNames = (db) =>
  new Set(
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','index','trigger')")
      .all()
      .map((row) => row.name),
  );

const TENTH = "0010_container_motorcycle_loads.sql";
const NINTH_INDEX = MIGRATIONS.indexOf("0009_container_registry.sql");
const TENTH_INDEX = MIGRATIONS.indexOf(TENTH);
const REPLACED_TRIGGER = "trg_shipping_containers_lifecycle_not_activated";

test("0010 is pinned to the exact content Production rejected", () => {
  // Hashed after normalising line endings, so the pin means the same thing on a
  // Windows worktree and a Linux CI checkout. If this fails the file changed,
  // and every claim below is about different bytes.
  const digest = createHash("sha256").update(read(TENTH)).digest("hex");
  assert.equal(digest, "8f93f9e3e4c9bfa6790e881a70e8b7d46882fe0633e8e482a034ad650ace8055");
  assert.equal(Buffer.byteLength(read(TENTH)), 11154);
});

test("0010 holds ten complete BEGIN...END trigger bodies", () => {
  const sql = read(TENTH);
  // Every trigger body carries a RAISE(ABORT) statement terminated by a
  // semicolon inside BEGIN...END. That is the construct a naive splitter cuts
  // in half, and the reason the reported error is about incomplete input.
  assert.equal((sql.match(/\bBEGIN\b/g) ?? []).length, 10);
  assert.equal((sql.match(/\bEND\b/g) ?? []).length, 10);
  assert.equal((sql.match(/\bCASE\b/g) ?? []).length, 0);
  assert.ok((sql.match(/RAISE\(ABORT/g) ?? []).length >= 10);
});

test("the two splitters build the same schema, whichever the platform uses", () => {
  // The invariant that matters is the resulting schema, not the chunk count:
  // the D1 splitter merges some statements (see the CASE test below), which is
  // harmless when each chunk is executed but would not be if chunk counts were
  // asserted to match.
  const viaMarkers = fresh();
  applyThrough(viaMarkers, MIGRATIONS.length - 1, splitOnMarkers);
  const viaD1 = fresh();
  applyThrough(viaD1, MIGRATIONS.length - 1, splitLikeD1);
  assert.deepEqual([...objectNames(viaD1)].sort(), [...objectNames(viaMarkers)].sort());
});

test("the D1 splitter merges statements only where CASE appears", () => {
  // wrangler's splitter opens a compound frame on BEGIN *or* CASE and closes it
  // on END. A CASE...END nested inside a trigger's BEGIN...END mis-pairs, so the
  // frame outlives the trigger and the next semicolons stop separating
  // statements. It under-splits — it never cuts a statement in half — so the
  // chunks still execute, but the effect is characterised here rather than left
  // to be rediscovered. 0010 contains no CASE, which is why both splitters
  // agree on it exactly.
  const merged = [];
  for (const name of MIGRATIONS) {
    const sql = read(name);
    const byMarker = splitOnMarkers(sql);
    const byD1 = splitLikeD1(sql);
    const hasCase = /\bCASE\b/.test(sql);
    if (byD1.length !== byMarker.length) merged.push(name);
    assert.ok(byD1.length <= byMarker.length, `${name}: the D1 splitter produced more chunks than statements`);
    if (!hasCase) {
      assert.equal(byD1.length, byMarker.length, `${name} has no CASE, so the splitters must agree`);
      for (const [index, statement] of byMarker.entries()) {
        assert.equal(normalize(byD1[index]), normalize(statement), `${name} statement ${index + 1} differs`);
      }
    }
  }
  assert.deepEqual(merged, [
    "0004_role_system_foundation.sql",
    "0005_member_lifecycle_safety.sql",
    "0007_truck_trip_foundation.sql",
  ]);
});

test("no statement produced by either splitter stops mid-trigger", () => {
  for (const name of MIGRATIONS) {
    for (const split of [splitOnMarkers, splitLikeD1]) {
      for (const statement of split(read(name))) {
        const begins = (statement.match(/\bBEGIN\b/g) ?? []).length;
        const ends = (statement.match(/\bEND\b/g) ?? []).length;
        const cases = (statement.match(/\bCASE\b/g) ?? []).length;
        assert.equal(begins + cases, ends, `${name}: a statement has unbalanced BEGIN/CASE...END`);
      }
    }
  }
});

test("the whole chain applies to an empty database under D1 splitter semantics", () => {
  const db = fresh();
  applyThrough(db, MIGRATIONS.length - 1, splitLikeD1);
  const names = objectNames(db);
  assert.ok(names.has("container_motorcycle_assignments"));
  assert.ok(names.has("yard_slots"), "the chain must reach 0029");
});

test("0010 applies to a database stopped exactly after 0009", () => {
  // The exact Production shape: 0000-0009 applied, 0010 not.
  const db = fresh();
  applyThrough(db, NINTH_INDEX);
  const before = objectNames(db);
  assert.ok(before.has(REPLACED_TRIGGER), "0009 must leave the trigger 0010 replaces");
  assert.ok(!before.has("container_motorcycle_assignments"));

  for (const statement of splitLikeD1(read(TENTH))) db.exec(statement);

  const after = objectNames(db);
  assert.ok(after.has("container_motorcycle_assignments"));
  assert.ok(after.has("trg_shipping_containers_validate_status"));
  // 0010 drops that trigger and does not recreate it: the pair of locks below
  // replaces it, so its absence afterwards is the intended outcome.
  assert.ok(!after.has(REPLACED_TRIGGER));
  assert.ok(after.has("trg_shipping_containers_plan_fields_locked"));
  assert.ok(after.has("trg_shipping_containers_seal_locked"));
});

test("a 0010 that fails part-way leaves no partial schema", () => {
  const db = fresh();
  applyThrough(db, NINTH_INDEX);
  const before = objectNames(db);

  // Break the file the way a bad splitter would: cut the final statement so it
  // stops inside BEGIN...END, which is what produces `incomplete input`.
  const statements = splitLikeD1(read(TENTH));
  const truncated = statements.slice(0, -1).concat(statements.at(-1).slice(0, 120));

  let failure = null;
  db.exec("BEGIN");
  try {
    for (const statement of truncated) db.exec(statement);
    db.exec("COMMIT");
  } catch (error) {
    failure = error;
    db.exec("ROLLBACK");
  }

  assert.ok(failure, "the truncated migration must fail");
  assert.match(failure.message, /incomplete input/);
  // Nothing 0010 creates may survive, and - the loss that would otherwise be
  // silent - the trigger 0010 drops must still be there.
  assert.deepEqual([...objectNames(db)].sort(), [...before].sort());
  assert.ok(objectNames(db).has(REPLACED_TRIGGER));
});

test("splitting on bare semicolons is not a usable execution path", () => {
  // Documents the one splitter that genuinely produces the Production error, so
  // that it is never adopted as a fix. It breaks at 0004, long before 0010,
  // which is why a Production that applied 0000-0009 was not using it.
  const db = fresh();
  let broke = null;
  outer: for (const name of MIGRATIONS) {
    for (const statement of read(name).split(";").map((part) => part.trim()).filter(Boolean)) {
      try {
        db.exec(`${statement};`);
      } catch (error) {
        broke = { name, message: error.message };
        break outer;
      }
    }
  }
  assert.ok(broke, "a bare-semicolon split must fail somewhere");
  assert.match(broke.message, /incomplete input/);
  assert.equal(broke.name, "0004_role_system_foundation.sql");
});

test("migrations execute identically whichever line endings they are checked out with", () => {
  // .gitattributes pins *.sql to LF, but a file that reaches the runtime with
  // CRLF must still apply, or a Windows-built artifact would behave unlike CI's.
  for (const endings of [(sql) => sql, (sql) => sql.replace(/\n/g, "\r\n")]) {
    const db = fresh();
    for (const name of MIGRATIONS.slice(0, TENTH_INDEX + 1)) {
      for (const statement of splitLikeD1(endings(read(name)))) db.exec(statement);
    }
    assert.ok(objectNames(db).has("container_motorcycle_assignments"));
  }
});
