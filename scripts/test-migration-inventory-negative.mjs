import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These mistakes are only visible across the whole inventory, which is exactly
// why nobody spots them reading a single diff — and each one is discovered at
// the worst moment, part-way through applying to a database holding real
// customer records.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-migration-inventory.mjs");

const TRACKED_TREES = ["drizzle", "docs"];

const CASES = [
  {
    name: "a gap in the sequence makes 'apply everything after N' ambiguous",
    apply: (directory) => unlinkSync(join(directory, "drizzle/0020_awesome_quentin_quire.sql")),
  },
  {
    name: "two migrations share an index",
    apply: (directory) =>
      writeFileSync(join(directory, "drizzle/0025_duplicate_index.sql"), "CREATE INDEX `idx_x` ON `audit_logs` (`action`);\n"),
  },
  {
    name: "a migration is named outside the convention",
    apply: (directory) =>
      renameSync(join(directory, "drizzle/0025_audit_action_index.sql"), join(directory, "drizzle/0025-Audit-Action.sql")),
  },
  {
    name: "the ledger claims a migration that does not exist",
    apply: (directory) =>
      editJson(directory, "drizzle/meta/_journal.json", (journal) => {
        journal.entries.push({ idx: journal.entries.length, version: "6", when: Date.now(), tag: "0026_invented", breakpoints: true });
        return journal;
      }),
  },
  {
    name: "the ledger misses a migration that does exist",
    apply: (directory) =>
      editJson(directory, "drizzle/meta/_journal.json", (journal) => {
        journal.entries.pop();
        return journal;
      }),
  },
  {
    name: "the ledger lists migrations out of order",
    apply: (directory) =>
      editJson(directory, "drizzle/meta/_journal.json", (journal) => {
        const [a, b] = [journal.entries.at(-2), journal.entries.at(-1)];
        journal.entries[journal.entries.length - 2] = { ...b, idx: a.idx };
        journal.entries[journal.entries.length - 1] = { ...a, idx: b.idx };
        return journal;
      }),
  },
  {
    name: "ledger timestamps go backwards, making applied order ambiguous",
    apply: (directory) =>
      editJson(directory, "drizzle/meta/_journal.json", (journal) => {
        journal.entries.at(-1).when = journal.entries.at(-2).when - 1;
        return journal;
      }),
  },
  {
    name: "a migration drops a table without copying its rows forward",
    apply: (directory) =>
      writeFileSync(join(directory, "drizzle/0026_destructive.sql"), "DROP TABLE `audit_logs`;\n"),
  },
  {
    name: "a migration drops a column, discarding stored data",
    apply: (directory) =>
      writeFileSync(join(directory, "drizzle/0026_destructive.sql"), "ALTER TABLE `users` DROP COLUMN `username`;\n"),
  },
  {
    name: "a migration deletes rows",
    apply: (directory) =>
      writeFileSync(join(directory, "drizzle/0026_destructive.sql"), "DELETE FROM `audit_logs` WHERE `action` = 'SIGN_IN';\n"),
  },
  {
    name: "the pre-migration backup requirement is removed from the runbook",
    apply: (directory) =>
      edit(directory, "docs/PRODUCTION_GO_LIVE.md", (source) =>
        source.replaceAll(/back\s?up/gi, "proceed"),
      ),
  },
  {
    name: "the Owner gate loses its ordering instruction",
    apply: (directory) =>
      edit(directory, "docs/OWNER_GATE_CHECKLIST.md", (source) =>
        source.replace("once each, in order", "as convenient"),
      ),
  },
];

function edit(directory, relativePath, transform) {
  const target = join(directory, relativePath);
  const original = readFileSync(target, "utf8");
  const next = transform(original);
  if (next === original) throw new Error(`mutation changed nothing: ${relativePath}`);
  writeFileSync(target, next);
}

function editJson(directory, relativePath, transform) {
  const target = join(directory, relativePath);
  const journal = JSON.parse(readFileSync(target, "utf8"));
  writeFileSync(target, JSON.stringify(transform(journal), null, 2));
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-migrations-"));
  for (const tree of TRACKED_TREES) {
    cpSync(join(root, tree), join(directory, tree), { recursive: true });
  }
  mkdirSync(join(directory, "scripts"), { recursive: true });
  return directory;
}

function runGate(directory) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, MIGRATION_INVENTORY_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`MIGRATION_INVENTORY_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`MIGRATION_INVENTORY_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`MIGRATION_INVENTORY_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`MIGRATION_INVENTORY_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
