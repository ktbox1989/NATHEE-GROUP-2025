import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A gate that cannot fail proves nothing. Each case below breaks exactly one of
// the wiring guarantees in a copy of the real sources and requires the gate to
// reject it; the unmodified copy must still pass, so the gate is not simply
// rejecting everything.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-auth-security-gates.mjs");

const TRACKED = [
  "app/api/auth/login/route.ts",
  "app/api/auth/forgot-password/route.ts",
  "app/api/auth/logout/route.ts",
  "app/api/auth/update-password/route.ts",
  "app/auth/callback/route.ts",
  "lib/auth-throttle.ts",
  "lib/auth-throttle-sql.ts",
  "lib/auth-throttle-store.ts",
  "lib/client-address.ts",
  "lib/runtime-readiness.ts",
];

const CASES = [
  {
    name: "provider is asked before the budget is spent",
    file: "app/api/auth/login/route.ts",
    edit: (source) =>
      source
        .replace("reserveAuthAttempt(", "deferredReserveAuthAttempt(")
        .concat("\n// reserveAuthAttempt( appears only after signInWithPassword(\n"),
  },
  {
    name: "the attempt is never settled",
    file: "app/api/auth/login/route.ts",
    edit: (source) => source.replaceAll("settleAuthAttempt(", "skipSettle("),
  },
  {
    name: "an unreachable counter falls through instead of failing closed",
    file: "app/api/auth/login/route.ts",
    edit: (source) => source.replaceAll("error=unavailable", "error=config"),
  },
  {
    name: "a refusal has no user-visible outcome",
    file: "app/api/auth/forgot-password/route.ts",
    edit: (source) => source.replaceAll("error=too_many_attempts", "sent=1"),
  },
  {
    name: "recovery is throttled with the login budget",
    file: "app/api/auth/forgot-password/route.ts",
    edit: (source) => source.replace('authThrottleTargets("recovery"', 'authThrottleTargets("login"'),
  },
  {
    name: "a caller-controlled header scopes the client budget",
    file: "app/api/auth/login/route.ts",
    edit: (source) =>
      source.replace(
        "trustedClientAddress(request.headers)",
        'request.headers.get("x-forwarded-for")',
      ),
  },
  {
    name: "the address helper trusts a forwarded header",
    file: "lib/client-address.ts",
    edit: (source) =>
      source.replace('headers.get("cf-connecting-ip")', 'headers.get("x-forwarded-for")'),
  },
  {
    name: "the same-origin check is dropped from an Auth mutation",
    file: "app/api/auth/forgot-password/route.ts",
    edit: (source) => source.replace("isSameOrigin(request)", "true"),
  },
  {
    name: "a runtime missing the counter table can still report healthy",
    file: "lib/runtime-readiness.ts",
    edit: (source) => source.replace('{ type: "table", name: "auth_attempt_counters" },', ""),
  },
  {
    name: "the store swallows its own failures",
    file: "lib/auth-throttle-store.ts",
    edit: (source) =>
      source.replace(
        "const results = await database.batch<CounterColumns>(statements);",
        "let results;\n  try {\n    results = await database.batch<CounterColumns>(statements);\n  } catch {\n    results = [];\n  }",
      ),
  },
  {
    name: "an environment value can switch the throttle off",
    file: "lib/auth-throttle.ts",
    edit: (source) => `${source}\nexport const THROTTLE_DISABLED = process.env.NATHEE_OFF === "1";\n`,
  },
  {
    name: "a built-in account is reintroduced",
    file: "app/api/auth/login/route.ts",
    edit: (source) => `${source}\n// fallback: demo@natheegroup2025.com\n`,
  },
];

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-auth-gate-"));
  for (const relative of TRACKED) {
    const target = join(directory, relative);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, relative), target);
  }
  return directory;
}

function runGate(directory) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, AUTH_SECURITY_GATE_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`AUTH_SECURITY_NEGATIVE_FAIL unmodified sources were rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  const target = join(directory, testCase.file);
  const original = readFileSync(target, "utf8");
  const broken = testCase.edit(original);
  if (broken === original) {
    failures += 1;
    console.error(`AUTH_SECURITY_NEGATIVE_FAIL case did not change anything: ${testCase.name}`);
  } else {
    writeFileSync(target, broken);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`AUTH_SECURITY_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`AUTH_SECURITY_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
