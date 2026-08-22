import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The drift this gate exists to stop was real and silent: a safety trigger that
// exists in the migrations, is enforced nowhere in Production, and leaves the
// probe reporting healthy. Each case below reproduces one shape of that drift.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TRACKED_TREES = ["drizzle", "lib"];
const TRACKED_FILES = ["app/api/health/route.ts"];

const CASES = [
  {
    name: "a migration adds a safety trigger that nothing requires",
    apply: (directory) =>
      write(
        directory,
        "drizzle/0026_regression.sql",
        "CREATE TRIGGER `trg_regression_no_delete`\nBEFORE DELETE ON `audit_logs`\nBEGIN\n\tSELECT RAISE(ABORT, 'no');\nEND;\n",
      ),
  },
  {
    name: "a migration adds a table that nothing requires",
    apply: (directory) =>
      write(
        directory,
        "drizzle/0026_regression.sql",
        "CREATE TABLE `regression` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n",
      ),
  },
  {
    name: "a migration adds an index that nothing requires",
    apply: (directory) =>
      write(
        directory,
        "drizzle/0026_regression.sql",
        "CREATE INDEX `idx_regression_created` ON `audit_logs` (`entity_id`);\n",
      ),
  },
  {
    name: "the last-OWNER protection is dropped from the requirements",
    apply: (directory) =>
      edit(directory, "lib/runtime-readiness.ts", (source) =>
        source.replace('  "trg_users_keep_last_active_owner_status",\n', ""),
      ),
  },
  {
    name: "the role and company compatibility triggers are dropped from the requirements",
    apply: (directory) =>
      edit(directory, "lib/runtime-readiness.ts", (source) =>
        source.replace('  "trg_user_role_assignments_compatible_insert",\n', ""),
      ),
  },
  {
    name: "a required object no migration creates is invented",
    apply: (directory) =>
      edit(directory, "lib/runtime-readiness.ts", (source) =>
        source.replace('export const REQUIRED_TRIGGERS = [\n', 'export const REQUIRED_TRIGGERS = [\n  "aaa_trg_invented",\n'),
      ),
  },
  {
    name: "a requirement list loses its sorted order",
    apply: (directory) =>
      edit(directory, "lib/runtime-readiness.ts", (source) => {
        const marker = "export const REQUIRED_TABLES = [\n";
        const start = source.indexOf(marker) + marker.length;
        const end = source.indexOf("] as const;", start);
        const names = source.slice(start, end).trimEnd().split("\n");
        const reversed = [...names].reverse().join("\n");
        return `${source.slice(0, start)}${reversed}\n${source.slice(end)}`;
      }),
  },
  {
    name: "a requirement is listed twice",
    apply: (directory) =>
      edit(directory, "lib/runtime-readiness.ts", (source) =>
        source.replace('  "audit_logs",\n', '  "audit_logs",\n  "audit_logs",\n'),
      ),
  },
  {
    name: "the probe goes back to binding one parameter per required object",
    apply: (directory) =>
      edit(directory, "app/api/health/route.ts", (source) =>
        source.replace(
          `      .prepare("SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'index', 'trigger')")`,
          "      .prepare(`SELECT name, type FROM sqlite_schema WHERE name IN (${REQUIRED_DATABASE_OBJECTS.map(() => \"?\").join(\", \")})`)",
        ),
      ),
  },
  {
    name: "the probe stops deciding with the shared contract",
    apply: (directory) =>
      edit(directory, "app/api/health/route.ts", (source) =>
        source.replace("checks.database = databaseObjectsReady(result.results);", "checks.database = true;"),
      ),
  },
];

function edit(directory, relativePath, transform) {
  const target = join(directory, relativePath);
  // Normalise to LF first: every anchor below is written with "\n", and on a
  // CRLF checkout the replacement would silently become a no-op.
  const original = readFileSync(target, "utf8").split("\r\n").join("\n");
  const next = transform(original);
  if (next === original) throw new Error(`mutation changed nothing: ${relativePath}`);
  writeFileSync(target, next);
}

function write(directory, relativePath, contents) {
  const target = join(directory, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-readiness-"));
  for (const tree of TRACKED_TREES) {
    cpSync(join(root, tree), join(directory, tree), { recursive: true });
  }
  for (const file of TRACKED_FILES) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target);
  }
  // The gate imports the readiness module from the copy under test, so the copy
  // needs the module type declaration too — without it Node resolves the .ts
  // file as CommonJS and its named exports disappear.
  mkdirSync(join(directory, "scripts"), { recursive: true });
  cpSync(join(root, "scripts/test-readiness-contract.mjs"), join(directory, "scripts/test-readiness-contract.mjs"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  return directory;
}

function runGate(directory) {
  return spawnSync(process.execPath, [join(directory, "scripts/test-readiness-contract.mjs")], {
    env: { ...process.env, READINESS_CONTRACT_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`READINESS_CONTRACT_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`READINESS_CONTRACT_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`READINESS_CONTRACT_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`READINESS_CONTRACT_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
