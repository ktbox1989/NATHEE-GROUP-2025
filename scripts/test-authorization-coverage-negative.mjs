import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The coverage gate exists to catch a route that was added without an
// authorization check. Each case here is that mistake, made deliberately in a
// copy of the tree; the gate must reject every one, and must still accept the
// unmodified tree.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-authorization-coverage.mjs");

const TRACKED_TREES = ["app/api", "app/app", "app/portal"];
const TRACKED_FILES = ["lib/operational-qr-route.ts"];

const ADDED_ROUTE = "app/api/companies/exports/route.ts";

const CASES = [
  {
    name: "a new route resolves nobody at all",
    apply: (directory) =>
      write(
        directory,
        ADDED_ROUTE,
        `import { NextResponse } from "next/server";\n` +
          `export async function GET() {\n  return NextResponse.json({ companies: [] });\n}\n`,
      ),
  },
  {
    name: "a new route identifies the caller but never decides",
    apply: (directory) =>
      write(
        directory,
        ADDED_ROUTE,
        `import { NextResponse } from "next/server";\n` +
          `import { getCurrentActor } from "@/lib/current-actor";\n` +
          `export async function GET() {\n` +
          `  const actor = await getCurrentActor();\n` +
          `  if (!actor) return new NextResponse("Unauthorized", { status: 401 });\n` +
          `  return NextResponse.json({ companies: [] });\n` +
          `}\n`,
      ),
  },
  {
    name: "a new mutating route skips the same-origin check",
    apply: (directory) =>
      write(
        directory,
        ADDED_ROUTE,
        `import { NextResponse } from "next/server";\n` +
          `import { can } from "@/lib/authorization";\n` +
          `import { getCurrentActor } from "@/lib/current-actor";\n` +
          `export async function POST() {\n` +
          `  const actor = await getCurrentActor();\n` +
          `  if (!actor || !can(actor, "companies:write")) {\n` +
          `    return new NextResponse("Forbidden", { status: 403 });\n` +
          `  }\n` +
          `  return NextResponse.json({ ok: true });\n` +
          `}\n`,
      ),
  },
  {
    name: "a new protected page renders without resolving anyone",
    apply: (directory) =>
      write(
        directory,
        "app/app/exports/page.tsx",
        `export default async function ExportsPage() {\n  return <main>รายงานส่งออก</main>;\n}\n`,
      ),
  },
  {
    name: "an existing route loses its authorization decision",
    apply: (directory) =>
      edit(directory, "app/api/companies/route.ts", (source) =>
        source
          .replaceAll("assertCan(", "skipAssert(")
          .replaceAll(/\bcan\(/g, "skipCan(")
          .replaceAll("actor.role", "SKIPPED_ROLE")
          .replaceAll("actor.companyId", "SKIPPED_COMPANY")
          .replaceAll("actor.userId", "SKIPPED_USER"),
      ),
  },
  {
    name: "an existing route loses its same-origin check",
    apply: (directory) =>
      edit(directory, "app/api/companies/route.ts", (source) =>
        source.replaceAll("isSameOrigin(request)", "true"),
      ),
  },
  {
    name: "the delegate that four QR routes rely on stops deciding",
    apply: (directory) =>
      edit(directory, "lib/operational-qr-route.ts", (source) =>
        source
          .replaceAll(/\bcan\(/g, "skipCan(")
          .replaceAll("isInternalRole(", "skipInternal(")
          .replaceAll("actor.role", "SKIPPED_ROLE"),
      ),
  },
  {
    name: "the delegate stops resolving an actor",
    apply: (directory) =>
      edit(directory, "lib/operational-qr-route.ts", (source) =>
        source.replaceAll("getCurrentActor(", "assumeActor("),
      ),
  },
  {
    name: "a declared public exception outlives the route it covered",
    apply: (directory) => unlinkSync(join(directory, "app/api/health/route.ts")),
  },
];

function write(directory, relativePath, contents) {
  const target = join(directory, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function edit(directory, relativePath, transform) {
  const target = join(directory, relativePath);
  const original = readFileSync(target, "utf8");
  const next = transform(original);
  if (next === original) throw new Error(`mutation changed nothing: ${relativePath}`);
  writeFileSync(target, next);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-authz-"));
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
    env: { ...process.env, AUTHORIZATION_COVERAGE_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(
    `AUTHORIZATION_COVERAGE_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`,
  );
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`AUTHORIZATION_COVERAGE_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`AUTHORIZATION_COVERAGE_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(
  `AUTHORIZATION_COVERAGE_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`,
);
