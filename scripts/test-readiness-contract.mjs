import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_DATABASE_OBJECTS,
  REQUIRED_INDEXES,
  REQUIRED_TABLES,
  REQUIRED_TRIGGERS,
} from "../lib/runtime-readiness.ts";

// "The schema is applied" has to mean every object the migrations create.
//
// The list this checks used to be curated by hand and had drifted badly: 48 of
// the 81 safety triggers were missing from it, including the ones that keep a
// last active OWNER from being removed and the ones that keep a role and a
// company scope compatible. A runtime missing those enforces none of them and
// still answers `healthy`, because nothing looks for them. Triggers are exactly
// the objects that fail silently.
//
// Deriving the same three sets from the migrations and demanding equality makes
// drift impossible in either direction: a new invariant that is not required, or
// a required object no migration creates.

const root = process.env.READINESS_CONTRACT_ROOT
  ? resolve(process.env.READINESS_CONTRACT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

/**
 * Replays the migrations in order, tracking creates and drops, so a later
 * migration that removes an object removes it from the contract too.
 */
async function schemaObjectsFromMigrations() {
  const directory = join(root, "drizzle");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const tables = new Set();
  const triggers = new Set();
  const indexes = new Set();

  for (const file of files) {
    const sql = await readFile(join(directory, file), "utf8");
    // Statement by statement, in order. Applying every CREATE and then every
    // DROP loses a migration that supersedes a trigger by dropping and
    // recreating it under the same name: the drop would win regardless of where
    // it appeared, and the object would vanish from the contract while still
    // existing in the database.
    for (const statement of sql.split("--> statement-breakpoint")) {
      for (const [, name] of statement.matchAll(/CREATE TABLE `([a-z_0-9]+)`/g)) {
        // Drizzle rebuilds a table by creating `__new_x`, copying, and renaming.
        if (!name.startsWith("__new")) tables.add(name);
      }
      for (const [, name] of statement.matchAll(/CREATE TRIGGER `([a-z_0-9]+)`/g)) triggers.add(name);
      for (const [, name] of statement.matchAll(/CREATE (?:UNIQUE )?INDEX `([a-z_0-9]+)`/g)) indexes.add(name);
      for (const [, name] of statement.matchAll(/DROP TABLE (?:IF EXISTS )?`([a-z_0-9]+)`/g)) tables.delete(name);
      // ...and finishes by renaming `__new_x` back to `x`. Without this the drop
      // above removed the table for good, so every rebuilt table fell out of the
      // contract. That is how `user_permissions` and `gallery_items` came to be
      // unchecked: a runtime missing the table that resolves permissions still
      // reported `database: true`.
      for (const [, from, to] of statement.matchAll(/ALTER TABLE `([a-z_0-9]+)` RENAME TO `([a-z_0-9]+)`/g)) {
        tables.delete(from);
        if (!to.startsWith("__new")) tables.add(to);
      }
      for (const [, name] of statement.matchAll(/DROP TRIGGER (?:IF EXISTS )?`([a-z_0-9]+)`/g)) triggers.delete(name);
      for (const [, name] of statement.matchAll(/DROP INDEX (?:IF EXISTS )?`([a-z_0-9]+)`/g)) indexes.delete(name);
    }
  }
  return { files, tables, triggers, indexes };
}

const { files, tables, triggers, indexes } = await schemaObjectsFromMigrations();
require(files.length > 0, "no migrations were found; the scan is misconfigured");
require(tables.size > 0 && triggers.size > 0 && indexes.size > 0, "the migration scan found no objects");

function compare(kind, declared, actual) {
  const declaredSet = new Set(declared);
  for (const name of [...actual].sort()) {
    require(declaredSet.has(name), `lib/runtime-readiness.ts: ${kind} '${name}' is created by a migration but not required`);
  }
  for (const name of [...declaredSet].sort()) {
    require(actual.has(name), `lib/runtime-readiness.ts: ${kind} '${name}' is required but no migration creates it`);
  }
  require(
    declared.length === declaredSet.size,
    `lib/runtime-readiness.ts: the ${kind} list contains a duplicate`,
  );
  const sorted = [...declared].sort();
  require(
    declared.every((name, index) => name === sorted[index]),
    `lib/runtime-readiness.ts: the ${kind} list must stay sorted so a diff shows what changed`,
  );
}

compare("table", [...REQUIRED_TABLES], tables);
compare("trigger", [...REQUIRED_TRIGGERS], triggers);
compare("index", [...REQUIRED_INDEXES], indexes);

// The flat contract the probe uses must cover all three sets exactly once.
const flat = REQUIRED_DATABASE_OBJECTS.map((object) => `${object.type}:${object.name}`);
require(new Set(flat).size === flat.length, "lib/runtime-readiness.ts: the flat contract contains a duplicate");
require(
  flat.length === REQUIRED_TABLES.length + REQUIRED_TRIGGERS.length + REQUIRED_INDEXES.length,
  "lib/runtime-readiness.ts: the flat contract does not cover every declared object",
);

// The probe cannot bind one parameter per object; D1 caps them well below this.
const health = await readFile(join(root, "app/api/health/route.ts"), "utf8");
require(
  !health.includes("REQUIRED_DATABASE_OBJECTS"),
  "app/api/health/route.ts: the probe must not bind one parameter per required object",
);
require(
  health.includes("FROM sqlite_schema WHERE type IN ('table', 'index', 'trigger')"),
  "app/api/health/route.ts: the probe must read the schema catalogue and compare in the application",
);
require(
  health.includes("databaseObjectsReady("),
  "app/api/health/route.ts: the probe must decide with the shared contract",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`READINESS_CONTRACT_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `READINESS_CONTRACT_PASS migrations=${files.length} tables=${tables.size} triggers=${triggers.size} indexes=${indexes.size} required=${flat.length}`,
);
