import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  databaseObjectsReady,
  missingDatabaseObjects,
  REQUIRED_DATABASE_OBJECTS,
  REQUIRED_TRIGGERS,
} from "../lib/runtime-readiness.ts";

// The readiness probe decides whether Production may be called healthy. Proving
// it against a real migrated database is the only way to know that "healthy"
// means the schema is actually applied.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));

function migrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  return db;
}

// Exactly the query app/api/health/route.ts issues.
function schemaObjects(db) {
  return db
    .prepare("SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'index', 'trigger')")
    .all()
    .map((row) => ({ name: row.name, type: row.type }));
}

test("a fully migrated database satisfies the readiness contract", () => {
  const db = migrated();
  const objects = schemaObjects(db);
  assert.deepEqual(missingDatabaseObjects(objects), []);
  assert.equal(databaseObjectsReady(objects), true);
  db.close();
});

test("the probe reads the catalogue without binding a parameter per object", () => {
  // D1 caps bound parameters far below the size of this contract, so the query
  // must not grow with it.
  assert.ok(REQUIRED_DATABASE_OBJECTS.length > 100);
  const db = migrated();
  const objects = schemaObjects(db);
  assert.ok(objects.length >= REQUIRED_DATABASE_OBJECTS.length);
  db.close();
});

test("a runtime missing the last-OWNER protection is not healthy", () => {
  // This is the drift that prompted the fix: the trigger existed in the
  // migrations and nothing was checking for it.
  const db = migrated();
  db.exec("DROP TRIGGER trg_users_keep_last_active_owner_status");
  const objects = schemaObjects(db);
  assert.equal(databaseObjectsReady(objects), false);
  assert.deepEqual(missingDatabaseObjects(objects), [
    { type: "trigger", name: "trg_users_keep_last_active_owner_status" },
  ]);
  db.close();
});

test("a runtime missing role and company compatibility enforcement is not healthy", () => {
  const db = migrated();
  db.exec("DROP TRIGGER trg_user_role_assignments_compatible_insert");
  const objects = schemaObjects(db);
  assert.equal(databaseObjectsReady(objects), false);
  assert.deepEqual(
    missingDatabaseObjects(objects).map((object) => object.name),
    ["trg_user_role_assignments_compatible_insert"],
  );
  db.close();
});

test("every safety trigger the migrations create is individually required", () => {
  const db = migrated();
  const objects = schemaObjects(db);
  const present = new Set(objects.filter((object) => object.type === "trigger").map((object) => object.name));
  for (const trigger of REQUIRED_TRIGGERS) {
    assert.ok(present.has(trigger), `${trigger} is required but a fully migrated database does not have it`);
    assert.equal(
      databaseObjectsReady(objects.filter((object) => object.name !== trigger)),
      false,
      `${trigger} can go missing without the runtime noticing`,
    );
  }
  db.close();
});

test("an unrelated extra object in the database does not make it unready", () => {
  const db = migrated();
  db.exec("CREATE TABLE d1_migrations (id integer PRIMARY KEY, name text)");
  assert.equal(databaseObjectsReady(schemaObjects(db)), true);
  db.close();
});

test("an empty database is refused rather than treated as nothing to check", () => {
  const db = new DatabaseSync(":memory:");
  assert.equal(databaseObjectsReady(schemaObjects(db)), false);
  assert.equal(missingDatabaseObjects(schemaObjects(db)).length, REQUIRED_DATABASE_OBJECTS.length);
  db.close();
});

test("a base-only database, which is what Production holds today, is refused", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const first = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()[0];
  for (const statement of readFileSync(`${directory}/${first}`, "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
  const objects = schemaObjects(db);
  assert.equal(databaseObjectsReady(objects), false);
  assert.ok(missingDatabaseObjects(objects).length > 0);
  db.close();
});
