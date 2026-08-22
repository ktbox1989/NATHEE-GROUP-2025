import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Each case is a way the timestamp contract can be lost again — including the
// exact regression that put the Audit page out of order in the first place.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-timestamp-contract.mjs");

const TRACKED_TREES = ["app/api", "lib", "drizzle"];
const TRACKED_FILES = ["db/schema.ts"];

const CASES = [
  {
    name: "a route goes back to writing a raw ISO 'now' into a record column",
    apply: (directory) =>
      edit(directory, "app/api/users/[id]/route.ts", (source) =>
        source.replace("const recordedAt = recordTimestamp();", "const recordedAt = new Date().toISOString();"),
      ),
  },
  {
    name: "a library goes back to a raw ISO 'now'",
    apply: (directory) =>
      edit(directory, "lib/timestamps-regression.ts", () => "", { create: true, contents: "export const stamp = new Date().toISOString();\n" }),
  },
  {
    name: "a record column is written with the real-world representation only",
    apply: (directory) =>
      edit(directory, "app/api/yard/zones/[id]/status/route.ts", (source) =>
        source
          .replace('import { recordTimestamp } from "@/lib/timestamps";', 'import { eventTimestamp } from "@/lib/timestamps";')
          .replaceAll("recordTimestamp()", "eventTimestamp()"),
      ),
  },
  {
    name: "a CHECK-compared real-world column is written with the record representation only",
    apply: (directory) =>
      edit(directory, "app/api/trips/[id]/assignments/route.ts", (source) =>
        source
          .replace('import { eventTimestamp } from "@/lib/timestamps";', 'import { recordTimestamp } from "@/lib/timestamps";')
          .replaceAll("eventTimestamp()", "recordTimestamp()"),
      ),
  },
  {
    name: "recordTimestamp stops producing the CURRENT_TIMESTAMP form",
    apply: (directory) =>
      edit(directory, "lib/timestamps.ts", (source) =>
        source.replace('.slice(0, 19).replace("T", " ")', ""),
      ),
  },
  {
    name: "eventTimestamp stops producing the ISO form",
    apply: (directory) =>
      edit(directory, "lib/timestamps.ts", (source) =>
        source.replace(
          "export function eventTimestamp(date: Date = new Date()): string {\n  if (Number.isNaN(date.getTime())) {\n    throw new RangeError(\"An event timestamp needs a valid date.\");\n  }\n  return date.toISOString();\n}",
          "export function eventTimestamp(date: Date = new Date()): string {\n  return recordTimestamp(date);\n}",
        ),
      ),
  },
  {
    name: "a real-world column gains a CURRENT_TIMESTAMP default in the schema",
    apply: (directory) =>
      edit(directory, "db/schema.ts", (source) =>
        source.replace(
          'const createdAt = () =>\n  text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);',
          'const createdAt = () =>\n  text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);\nexport const enteredAtDefault = () =>\n  text("entered_at").notNull().default(sql`CURRENT_TIMESTAMP`);',
        ),
      ),
  },
  {
    name: "a migration gives a real-world column a CURRENT_TIMESTAMP default",
    apply: (directory) =>
      edit(directory, "drizzle/0024_regression.sql", () => "", {
        create: true,
        contents: "CREATE TABLE `regression` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`exited_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL\n);\n",
      }),
  },
];

function edit(directory, relativePath, transform, options = {}) {
  const target = join(directory, relativePath);
  if (options.create) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, options.contents);
    return;
  }
  // Normalise to LF first: every anchor below is written with "\n", and on a
  // CRLF checkout the replacement would silently become a no-op.
  const original = readFileSync(target, "utf8").split("\r\n").join("\n");
  const next = transform(original);
  if (next === original) throw new Error(`mutation changed nothing: ${relativePath}`);
  writeFileSync(target, next);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-timestamps-"));
  for (const tree of TRACKED_TREES) {
    cpSync(join(root, tree), join(directory, tree), { recursive: true });
  }
  for (const file of TRACKED_FILES) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target);
  }
  return directory;
}

function runGate(directory) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, TIMESTAMP_CONTRACT_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`TIMESTAMP_CONTRACT_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`TIMESTAMP_CONTRACT_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`TIMESTAMP_CONTRACT_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`TIMESTAMP_CONTRACT_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
