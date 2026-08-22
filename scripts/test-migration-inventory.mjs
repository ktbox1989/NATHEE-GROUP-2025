import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Migrations are applied to Production once each, in order, against a database
// holding real customer records. The properties that make that safe are
// structural, and none of them is visible by reading one file:
//
//  - the inventory is a gapless, duplicate-free sequence, so "apply everything
//    after N" is a well-defined instruction;
//  - the ledger and the files agree, so the ledger cannot claim a migration that
//    does not exist or miss one that does;
//  - nothing after the base migration destroys data. SQLite cannot drop a column
//    in place, so Drizzle rebuilds a table by copying it — that is legitimate and
//    is required to actually copy. A bare DROP is not.

const root = process.env.MIGRATION_INVENTORY_ROOT
  ? resolve(process.env.MIGRATION_INVENTORY_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (path) =>
  (await readFile(join(root, path), "utf8")).replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

const files = (await readdir(join(root, "drizzle")))
  .filter((name) => name.endsWith(".sql"))
  .sort();
require(files.length > 0, "no migrations were found; the scan is misconfigured");

// 1. A gapless, duplicate-free sequence starting at 0000.
const indices = [];
for (const name of files) {
  const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
  require(match !== null, `drizzle/${name}: a migration must be NNNN_snake_case_name.sql`);
  if (match) indices.push(Number(match[1]));
}
require(indices[0] === 0, `the first migration must be 0000, found ${String(indices[0]).padStart(4, "0")}`);
for (let position = 1; position < indices.length; position += 1) {
  require(
    indices[position] === indices[position - 1] + 1,
    `migration sequence breaks between ${String(indices[position - 1]).padStart(4, "0")} and ${String(indices[position]).padStart(4, "0")}`,
  );
}
require(new Set(indices).size === indices.length, "two migrations share an index");

// 2. The ledger agrees with the files, in order.
const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
const entries = journal.entries ?? [];
require(entries.length === files.length, `the ledger lists ${entries.length} migrations but ${files.length} exist`);
entries.forEach((entry, position) => {
  const expected = files[position]?.replace(/\.sql$/, "");
  require(entry.tag === expected, `ledger entry ${position} is '${entry.tag}', expected '${expected}'`);
  require(entry.idx === position, `ledger entry '${entry.tag}' has idx ${entry.idx}, expected ${position}`);
});
for (let position = 1; position < entries.length; position += 1) {
  require(
    entries[position].when > entries[position - 1].when,
    `ledger timestamps go backwards at '${entries[position].tag}'; applied order would be ambiguous`,
  );
}

// 3. Nothing after the base migration destroys data.
const BASE = files[0];
let rebuilds = 0;
for (const name of files) {
  if (name === BASE) continue;
  const sql = await read(`drizzle/${name}`);

  const droppedTables = [...sql.matchAll(/DROP TABLE (?:IF EXISTS )?`([a-z_0-9]+)`/g)].map((match) => match[1]);
  for (const table of droppedTables) {
    // The Drizzle rebuild: build `__new_x`, copy the rows in, drop `x`, rename.
    // It is only safe if the copy is actually there.
    const rebuild =
      sql.includes(`CREATE TABLE \`__new_${table}\``) &&
      sql.includes(`INSERT INTO \`__new_${table}\``) &&
      sql.includes(`ALTER TABLE \`__new_${table}\` RENAME TO \`${table}\``);
    require(
      rebuild,
      `drizzle/${name}: drops \`${table}\` without a rebuild that copies its rows forward`,
    );
    if (rebuild) rebuilds += 1;
  }

  require(
    !/DROP COLUMN/i.test(sql),
    `drizzle/${name}: dropping a column discards stored data`,
  );
  require(
    !/\bDELETE FROM\b/i.test(sql),
    `drizzle/${name}: a migration must not delete rows`,
  );
  require(
    !/\bTRUNCATE\b/i.test(sql),
    `drizzle/${name}: a migration must not truncate a table`,
  );
}

// 4. The rollback path is documented, because a failed apply is when someone
//    needs it and is least able to work it out.
const goLive = await read("docs/PRODUCTION_GO_LIVE.md");
require(
  /back\s?up/i.test(goLive),
  "docs/PRODUCTION_GO_LIVE.md: the pre-migration backup requirement must stay documented",
);
require(
  /ledger/i.test(goLive),
  "docs/PRODUCTION_GO_LIVE.md: the migration ledger check must stay documented",
);
const checklist = await read("docs/OWNER_GATE_CHECKLIST.md");
require(
  /back up the Production D1/i.test(checklist) && /once each, in order/i.test(checklist),
  "docs/OWNER_GATE_CHECKLIST.md: the D1 gate must keep its backup and ordering instruction",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`MIGRATION_INVENTORY_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `MIGRATION_INVENTORY_PASS migrations=${files.length} range=${String(indices[0]).padStart(4, "0")}-${String(indices.at(-1)).padStart(4, "0")} ledgerEntries=${entries.length} tableRebuilds=${rebuilds} destructiveStatements=0`,
);
