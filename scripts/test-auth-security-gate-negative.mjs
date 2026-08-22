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

/** One entry of a generated requirement list, as the file writes it. */
function entryLine(name) {
  return `${String.fromCharCode(10)}  "${name}",${String.fromCharCode(10)}`;
}
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
  "app/api/users/invite/route.ts",
  "app/api/users/[id]/route.ts",
  "app/app/users/page.tsx",
  "lib/privileged-action.ts",
  "lib/privileged-action-guard.ts",
  "lib/auth-events.ts",
  "lib/auth-events-sql.ts",
  "lib/auth-events-store.ts",
  "lib/auth-recovery-grant.ts",
  "lib/auth-recovery-grant-sql.ts",
  "lib/auth-recovery-grant-store.ts",
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
    edit: (source) => source.replace(entryLine("auth_attempt_counters"), ""),
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
  {
    name: "a session cookie alone authorises a password change",
    file: "app/api/auth/update-password/route.ts",
    edit: (source) => source.replace("passwordChangeAccepted(proof)", "true"),
  },
  {
    name: "the recovery grant is trusted without being consumed",
    file: "app/api/auth/update-password/route.ts",
    edit: (source) => source.replace("consumeRecoveryGrant(", "assumeRecoveryGrant("),
  },
  {
    name: "an unproven change is refused silently",
    file: "app/api/auth/update-password/route.ts",
    edit: (source) => source.replace("error=reauthenticate", "status=password_updated"),
  },
  {
    name: "the current-password check is not throttled",
    file: "app/api/auth/update-password/route.ts",
    edit: (source) => source.replaceAll("reserveAuthAttempt(", "skipReserve("),
  },
  {
    name: "the grant cookie survives the password change",
    file: "app/api/auth/update-password/route.ts",
    edit: (source) =>
      source.replace(
        "clearedRecoveryGrantCookieOptions(request.url)",
        "recoveryGrantCookieOptions(request.url)",
      ),
  },
  {
    name: "any callback destination mints a recovery grant",
    file: "app/auth/callback/route.ts",
    edit: (source) => source.replace("shouldIssueRecoveryGrant(next)", "true"),
  },
  {
    name: "the grant cookie becomes readable by script",
    file: "lib/auth-recovery-grant.ts",
    edit: (source) => source.replaceAll("httpOnly: true", "httpOnly: false as true"),
  },
  {
    name: "grant tokens stop being cryptographically random",
    file: "lib/auth-recovery-grant.ts",
    edit: (source) => source.replace("crypto.getRandomValues(bytes)", "bytes.fill(1)"),
  },
  {
    name: "the raw token is stored instead of its digest",
    file: "lib/auth-recovery-grant.ts",
    edit: (source) => source.replace('crypto.subtle.digest("SHA-256"', 'Promise.resolve("SHA-256"'),
  },
  {
    name: "a grant can be spent more than once",
    file: "lib/auth-recovery-grant-sql.ts",
    edit: (source) => source.replace("    AND consumed_at IS NULL", "    AND 1 = 1"),
  },
  {
    name: "a grant works for an identity it was not minted for",
    file: "lib/auth-recovery-grant-sql.ts",
    edit: (source) => source.replaceAll("external_auth_id = ?", "1 = 1"),
  },
  {
    name: "a runtime missing the grant table can still report healthy",
    file: "lib/runtime-readiness.ts",
    edit: (source) => source.replace(entryLine("auth_recovery_grants"), ""),
  },
  {
    name: "a sign-in stops reaching the Audit trail",
    file: "app/api/auth/login/route.ts",
    edit: (source) => source.replace("recordSignInEvent(", "skipSignInEvent("),
  },
  {
    name: "a completed password change stops reaching the Audit trail",
    file: "app/api/auth/update-password/route.ts",
    edit: (source) => source.replace("recordAuthEvent(", "skipAuthEvent("),
  },
  {
    name: "the recorded action stops depending on the account's own status",
    file: "lib/auth-events-sql.ts",
    edit: (source) =>
      source.replace(
        "CASE WHEN u.status = 'ACTIVE' THEN 'SIGN_IN' ELSE 'SIGN_IN_DENIED' END",
        "'SIGN_IN'",
      ),
  },
  {
    name: "an event is written from something other than the users row",
    file: "lib/auth-events-sql.ts",
    edit: (source) => source.replaceAll("u.external_auth_id = ?", "1 = 1"),
  },
  {
    name: "the client address is quietly added to the Audit trail",
    file: "lib/auth-events.ts",
    edit: (source) => `${source}\nexport const CLIENT_ADDRESS_HEADER = "cf-connecting-ip";\n`,
  },
  {
    name: "the Audit trail can be rewritten without the runtime noticing",
    file: "lib/runtime-readiness.ts",
    edit: (source) => source.replace(entryLine("trg_audit_logs_no_delete"), ""),
  },
  {
    name: "an invitation no longer requires the inviter's password",
    file: "app/api/users/invite/route.ts",
    edit: (source) => source.replace("requireCurrentPassword(", "skipCurrentPassword("),
  },
  {
    name: "a role change no longer requires the actor's password",
    file: "app/api/users/[id]/route.ts",
    edit: (source) => source.replace("requireCurrentPassword(", "skipCurrentPassword("),
  },
  {
    name: "the proof is obtained but never checked",
    file: "app/api/users/[id]/route.ts",
    edit: (source) => source.replace("privilegedProofAccepted(proof.proof)", "true"),
  },
  {
    name: "the OWNER-only check is dropped now that a password is required",
    file: "app/api/users/invite/route.ts",
    edit: (source) => source.replace('actor.role !== "OWNER"', "false"),
  },
  {
    name: "the re-authentication check stops spending the login budget",
    file: "lib/privileged-action-guard.ts",
    edit: (source) => source.replace("reserveAuthAttempt(", "skipReserve("),
  },
  {
    name: "an unreachable counter lets a privileged write through",
    file: "lib/privileged-action-guard.ts",
    edit: (source) =>
      source.replace('return { ok: false, error: "unavailable" };', 'return { ok: true, proof: "current_password" };'),
  },
  {
    name: "the admin page stops asking for the password",
    file: "app/app/users/page.tsx",
    edit: (source) => source.replace('name="currentPassword"', 'name="unusedField"'),
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
  // Normalise to LF first: the anchors are written with a newline escape,
  // and on a CRLF checkout the edit would silently become a no-op.
  const original = readFileSync(target, "utf8").split("\r\n").join("\n");
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
