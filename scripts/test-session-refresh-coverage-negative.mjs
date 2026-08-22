import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The regression this catches is silent: a page outside the matcher works for a
// fresh session and drops an idle one. Each case makes that mistake on purpose.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-session-refresh-coverage.mjs");

const TRACKED_TREES = ["app"];
const TRACKED_FILES = ["proxy.ts", "lib/supabase/proxy.ts", "lib/supabase/server.ts"];

const CASES = [
  {
    name: "the page that reads a session to choose a password form loses its matcher entry",
    apply: (directory) =>
      edit(directory, "proxy.ts", (source) => source.replace('    "/reset-password",\n', "")),
  },
  {
    name: "a new session-reading page is added outside the matcher",
    apply: (directory) =>
      write(
        directory,
        "app/account/page.tsx",
        `import { requireActor } from "@/lib/current-actor";\n` +
          `export default async function AccountPage() {\n` +
          `  const actor = await requireActor("/account");\n` +
          `  return <main>{actor.displayName}</main>;\n` +
          `}\n`,
      ),
  },
  {
    name: "the protected application tree is dropped from the matcher",
    apply: (directory) =>
      edit(directory, "proxy.ts", (source) => source.replace('    "/app/:path*",\n', "")),
  },
  {
    name: "the API tree is dropped from the matcher",
    apply: (directory) =>
      edit(directory, "proxy.ts", (source) =>
        source.replace('    "/api/auth/:path*",\n    "/api/:path*",\n', ""),
      ),
  },
  {
    name: "the proxy stops asking the auth client for the session",
    apply: (directory) =>
      edit(directory, "lib/supabase/proxy.ts", (source) =>
        source.replace("await supabase.auth.getClaims();", "void supabase;"),
      ),
  },
  {
    name: "the proxy stops writing refreshed cookies onto the response",
    apply: (directory) =>
      edit(directory, "lib/supabase/proxy.ts", (source) =>
        source.replace("response.cookies.set(name, value, options)", "void name"),
      ),
  },
  {
    name: "the proxy stops delegating to updateSession",
    apply: (directory) =>
      edit(directory, "proxy.ts", (source) =>
        source.replace("return updateSession(request);", "return undefined;"),
      ),
  },
  {
    name: "a matcher entry is written in a shape the check cannot verify",
    apply: (directory) =>
      edit(directory, "proxy.ts", (source) =>
        source.replace('"/app/:path*"', '"/((?!_next).*)"'),
      ),
  },
  {
    name: "a matcher entry outlives every surface it covered",
    apply: (directory) =>
      edit(directory, "proxy.ts", (source) =>
        source.replace('    "/reset-password",\n', '    "/reset-password",\n    "/legacy-console/:path*",\n'),
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

function write(directory, relativePath, contents) {
  const target = join(directory, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-session-"));
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
    env: { ...process.env, SESSION_REFRESH_COVERAGE_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`SESSION_REFRESH_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`SESSION_REFRESH_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`SESSION_REFRESH_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`SESSION_REFRESH_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
