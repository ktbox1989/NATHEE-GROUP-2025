import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Auth throttle is only worth anything if the routes actually consult it,
// and consult it *before* the identity provider. Behaviour tests prove the
// counter is correct; this proves the wiring, because the wiring is what a later
// refactor silently drops.

// The gate runs against the repository by default. A root override lets the
// negative test point it at deliberately broken copies of the same files.
const root = process.env.AUTH_SECURITY_GATE_ROOT
  ? resolve(process.env.AUTH_SECURITY_GATE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

function orderedBefore(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  require(firstIndex >= 0, `${message}: '${first}' is absent`);
  require(secondIndex >= 0, `${message}: '${second}' is absent`);
  require(
    firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex,
    `${message}: '${first}' must run before '${second}'`,
  );
}

const throttledRoutes = [
  {
    path: "app/api/auth/login/route.ts",
    providerCall: "signInWithPassword(",
    kind: '"login"',
    refusal: "error=too_many_attempts",
    unavailable: "error=unavailable",
  },
  {
    path: "app/api/auth/forgot-password/route.ts",
    providerCall: "resetPasswordForEmail(",
    kind: '"recovery"',
    refusal: "error=too_many_attempts",
    unavailable: "error=unavailable",
  },
];

for (const route of throttledRoutes) {
  const source = await read(route.path);
  orderedBefore(source, "reserveAuthAttempt(", route.providerCall, route.path);
  require(source.includes(`authThrottleTargets(${route.kind}`), `${route.path}: wrong throttle kind`);
  require(source.includes("settleAuthAttempt("), `${route.path}: attempt is never settled`);
  require(source.includes(route.refusal), `${route.path}: refusal has no user-visible outcome`);
  require(
    source.includes(route.unavailable),
    `${route.path}: an unreachable counter must fail closed, not fall through`,
  );
  require(
    source.includes("isSameOrigin(request)"),
    `${route.path}: same-origin mutation check is missing`,
  );
  require(
    source.includes("trustedClientAddress(request.headers)"),
    `${route.path}: client scope must use the trusted address helper`,
  );
  require(
    !source.includes("x-forwarded-for"),
    `${route.path}: X-Forwarded-For is caller-controlled and must never scope a budget`,
  );
}

// A password change must be authorised by something other than possession of a
// session cookie, or an unlocked browser is an account takeover.
const updatePassword = await read("app/api/auth/update-password/route.ts");
orderedBefore(
  updatePassword,
  "passwordChangeAccepted(proof)",
  "client.auth.updateUser(",
  "app/api/auth/update-password/route.ts",
);
require(
  updatePassword.includes("consumeRecoveryGrant("),
  "app/api/auth/update-password/route.ts: a recovery link must be the proof it claims to be",
);
require(
  updatePassword.includes("error=reauthenticate"),
  "app/api/auth/update-password/route.ts: an unproven change must be refused visibly",
);
require(
  updatePassword.includes("reserveAuthAttempt("),
  "app/api/auth/update-password/route.ts: verifying the current password is a guess and must spend budget",
);
orderedBefore(
  updatePassword,
  "reserveAuthAttempt(",
  "client.auth.signInWithPassword(",
  "app/api/auth/update-password/route.ts",
);
require(
  updatePassword.includes("clearedRecoveryGrantCookieOptions(request.url)"),
  "app/api/auth/update-password/route.ts: the grant cookie must not survive the change",
);

const callback = await read("app/auth/callback/route.ts");
orderedBefore(
  callback,
  "client.auth.exchangeCodeForSession(",
  "issueRecoveryGrant(",
  "app/auth/callback/route.ts",
);
require(
  callback.includes("shouldIssueRecoveryGrant(next)"),
  "app/auth/callback/route.ts: only a recovery or invitation callback may mint a grant",
);

const grant = await read("lib/auth-recovery-grant.ts");
require(
  grant.includes("httpOnly: true") && grant.includes('sameSite: "lax"'),
  "lib/auth-recovery-grant.ts: the grant cookie must be HttpOnly and same-site",
);
require(
  grant.includes("crypto.getRandomValues(bytes)"),
  "lib/auth-recovery-grant.ts: grant tokens must come from a cryptographic source",
);
require(
  grant.includes('crypto.subtle.digest("SHA-256"'),
  "lib/auth-recovery-grant.ts: only a digest of the token may be stored",
);

const grantSql = await read("lib/auth-recovery-grant-sql.ts");

// Scoped to the consumption statement itself. A guard that survives only in the
// read-only peek statement protects nothing.
function statementBody(source, exportName, endMarker, message) {
  const start = source.indexOf(`export const ${exportName}`);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start) {
    failures.push(`${message}: ${exportName} is absent or reordered`);
    return "";
  }
  return source.slice(start, end);
}

const consumeStatement = statementBody(
  grantSql,
  "CONSUME_RECOVERY_GRANT_SQL",
  "export function consumeRecoveryGrantParams",
  "lib/auth-recovery-grant-sql.ts",
);
for (const guard of ["consumed_at IS NULL", "expires_at > ?", "external_auth_id = ?", "RETURNING"]) {
  require(
    consumeStatement.includes(guard),
    `lib/auth-recovery-grant-sql.ts: consumption must be guarded by '${guard}'`,
  );
}

const peekStatement = statementBody(
  grantSql,
  "PEEK_RECOVERY_GRANT_SQL",
  "export function peekRecoveryGrantParams",
  "lib/auth-recovery-grant-sql.ts",
);
require(
  peekStatement.includes("SELECT") && !/\b(UPDATE|DELETE|INSERT)\b/.test(peekStatement),
  "lib/auth-recovery-grant-sql.ts: the page-render check must never spend a grant",
);
for (const guard of ["consumed_at IS NULL", "expires_at > ?", "external_auth_id = ?"]) {
  require(
    peekStatement.includes(guard),
    `lib/auth-recovery-grant-sql.ts: the render check must be guarded by '${guard}'`,
  );
}

const clientAddress = await read("lib/client-address.ts");
require(
  clientAddress.includes('headers.get("cf-connecting-ip")'),
  "lib/client-address.ts: the edge-set header is the only trusted source",
);
require(
  !clientAddress.includes("x-forwarded-for") && !clientAddress.includes("x-real-ip"),
  "lib/client-address.ts: forwarded headers must not be read",
);

const readiness = await read("lib/runtime-readiness.ts");
require(
  readiness.includes('name: "auth_attempt_counters"'),
  "lib/runtime-readiness.ts: a runtime without the counter table must report degraded",
);
require(
  readiness.includes('name: "auth_recovery_grants"'),
  "lib/runtime-readiness.ts: a runtime without the grant table must report degraded",
);

const storeSource = await read("lib/auth-throttle-store.ts");
require(
  !storeSource.includes("catch {") && !storeSource.includes("catch ("),
  "lib/auth-throttle-store.ts: the store must propagate failures so callers fail closed",
);

// No Auth surface may carry a built-in account, and no throttle may be disabled
// by an environment value that Production could be missing.
const authSources = await Promise.all(
  [
    "app/api/auth/login/route.ts",
    "app/api/auth/forgot-password/route.ts",
    "app/api/auth/logout/route.ts",
    "app/api/auth/update-password/route.ts",
    "app/auth/callback/route.ts",
    "lib/auth-recovery-grant.ts",
    "lib/auth-recovery-grant-sql.ts",
    "lib/auth-recovery-grant-store.ts",
    "lib/auth-throttle.ts",
    "lib/auth-throttle-sql.ts",
    "lib/auth-throttle-store.ts",
  ].map(async (path) => ({ path, source: await read(path) })),
);
for (const { path, source } of authSources) {
  for (const forbidden of [/DISABLE_[A-Z_]*THROTTL/, /THROTTLE_DISABLED/, /demo@/i, /\badmin123\b/i]) {
    require(!forbidden.test(source), `${path}: forbidden escape hatch or built-in account (${forbidden})`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`AUTH_SECURITY_GATE_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `AUTH_SECURITY_GATE_PASS throttledRoutes=${throttledRoutes.length} clientScope=cf-connecting-ip passwordChange=grant-or-current-password readiness=auth_attempt_counters,auth_recovery_grants`,
);
