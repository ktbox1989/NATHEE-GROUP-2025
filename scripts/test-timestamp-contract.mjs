import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The database stores two kinds of timestamp that do not sort against each
// other. `created_at` and `updated_at` are the only columns with a database
// default, and that default writes `YYYY-MM-DD HH:MM:SS`; every other `*_at`
// column is an application-supplied ISO-8601 instant that CHECK constraints
// compare as text.
//
// The defect this prevents is not hypothetical: writing ISO into `created_at`
// put the Owner's Audit page out of order within every single day, because `T`
// sorts above a space. `new Date().toISOString()` is the idiom that did it, so
// server code must go through the two named helpers instead, and the choice is
// then visible at each call site.

const root = process.env.TIMESTAMP_CONTRACT_ROOT
  ? resolve(process.env.TIMESTAMP_CONTRACT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

const CONTRACT_MODULE = "lib/timestamps.ts";
const SCANNED_TREES = ["app/api", "lib"];

async function walk(directory) {
  const absolute = join(root, directory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (/\.tsx?$/.test(entry.name)) files.push(child);
  }
  return files;
}

// 1. The contract module must produce exactly the two forms and never confuse them.
const contract = await read(CONTRACT_MODULE);
require(
  contract.includes('.slice(0, 19).replace("T", " ")'),
  `${CONTRACT_MODULE}: recordTimestamp must produce the CURRENT_TIMESTAMP form`,
);
require(
  /export function eventTimestamp[\s\S]*?return date\.toISOString\(\);/.test(contract),
  `${CONTRACT_MODULE}: eventTimestamp must produce the ISO-8601 form`,
);

// 2. The premise: only created_at and updated_at carry a database default. If a
//    real-world column ever gained one, its rows would mix representations too.
const schema = await read("db/schema.ts");
const defaulted = [...schema.matchAll(/text\("([a-z_]+)"\)\.notNull\(\)\.default\(sql`CURRENT_TIMESTAMP`\)/g)].map(
  (match) => match[1],
);
require(defaulted.length > 0, "db/schema.ts: no CURRENT_TIMESTAMP defaults were found; the scan is misconfigured");
for (const column of defaulted) {
  require(
    column === "created_at" || column === "updated_at",
    `db/schema.ts: ${column} must not default to CURRENT_TIMESTAMP; only record columns may`,
  );
}
const migrations = await readdir(join(root, "drizzle")).catch(() => []);
for (const migration of migrations.filter((name) => name.endsWith(".sql"))) {
  const sql = await read(`drizzle/${migration}`);
  for (const match of sql.matchAll(/`([a-z_]+)` text DEFAULT CURRENT_TIMESTAMP/g)) {
    require(
      match[1] === "created_at" || match[1] === "updated_at",
      `drizzle/${migration}: ${match[1]} must not default to CURRENT_TIMESTAMP`,
    );
  }
}

// 3. Server code chooses a representation explicitly, every time.
const sources = (await Promise.all(SCANNED_TREES.map(walk)))
  .flat()
  .map((path) => path.split(sep).join("/"))
  .filter((path) => path !== CONTRACT_MODULE)
  .sort();
require(sources.length > 0, "no server sources were found; the scan is misconfigured");

let usingContract = 0;
for (const path of sources) {
  const source = await read(path);
  require(
    !source.includes("new Date().toISOString()"),
    `${path}: use recordTimestamp() for created_at/updated_at or eventTimestamp() for a real-world instant`,
  );
  require(
    !source.includes("Date.now().toString()"),
    `${path}: an epoch string is neither stored representation`,
  );
  if (source.includes("recordTimestamp(") || source.includes("eventTimestamp(")) usingContract += 1;
}

// 4. A file that writes both kinds of column must produce both kinds of value.
//    This is what catches a conversion that reached for one helper and used it
//    everywhere — the exact shape of the original defect, in reverse.
//
//    These are the real-world columns CHECK constraints compare as text, so a
//    record-form value written into one would reject a legitimate operation.
function camelCase(column) {
  return column.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

const REAL_WORLD_COLUMNS = [
  "entered_at",
  "exited_at",
  "loaded_at",
  "unloaded_at",
  "released_at",
  "assigned_at",
  "planned_departure_at",
  "planned_arrival_at",
  "actual_departure_at",
  "actual_arrival_at",
];

for (const path of sources) {
  const source = await read(path);
  const callsRecord = source.includes("recordTimestamp(");
  const callsEvent = source.includes("eventTimestamp(");
  if (!callsRecord && !callsEvent) continue;

  // Only text record columns count; the Auth counters keep epoch integers on
  // purpose and never mix with CURRENT_TIMESTAMP.
  const writesRecordColumn =
    /\b(created_at|updated_at)\s*=\s*\?/.test(source) ||
    /\bcreated_at\)/.test(source) ||
    /\b(createdAt|updatedAt):\s*[A-Za-z]/.test(source);
  // Plain substring matching on purpose: a built regular expression here would
  // need escaping that is easy to get subtly wrong, and a check that silently
  // matches nothing is worse than no check.
  const writesRealWorldColumn = REAL_WORLD_COLUMNS.some(
    (column) =>
      source.includes(`${column} = ?`) ||
      source.includes(`${column},`) ||
      source.includes(`${column})`) ||
      source.includes(`${camelCase(column)}:`) ||
      source.includes(`${camelCase(column)},`),
  );

  require(
    !writesRecordColumn || callsRecord,
    `${path}: writes created_at/updated_at, so it must produce a recordTimestamp()`,
  );
  require(
    !writesRealWorldColumn || callsEvent,
    `${path}: writes a CHECK-compared real-world column, so it must produce an eventTimestamp()`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`TIMESTAMP_CONTRACT_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `TIMESTAMP_CONTRACT_PASS sourcesScanned=${sources.length} usingContract=${usingContract} defaultedColumns=${[...new Set(defaulted)].sort().join(",")}`,
);
