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
  // The Owner PIN is six digits. The budget in front of it is not a hardening
  // measure there, it is the entire reason a six-digit secret is defensible, so
  // the same ordering is required of it as of the password door.
  {
    path: "app/api/auth/owner-pin/login/route.ts",
    providerCall: "verifyOwnerPin(",
    kind: '"login"',
    refusal: "error=too_many_attempts",
    unavailable: "error=unavailable",
  },
];

const loginRoute = await read("app/api/auth/login/route.ts");

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

// The Audit trail records what people changed; without these it still records
// nothing about getting in, so a compromised account leaves no trace unless it
// also changes something.
require(
  loginRoute.includes("recordSignInEvent("),
  "app/api/auth/login/route.ts: a successful sign-in must reach the Audit trail",
);
orderedBefore(
  loginRoute,
  "signInWithPassword(",
  "recordSignInEvent(",
  "app/api/auth/login/route.ts",
);
require(
  updatePassword.includes('recordAuthEvent(') && updatePassword.includes('"PASSWORD_CHANGED"'),
  "app/api/auth/update-password/route.ts: a completed password change must reach the Audit trail",
);
orderedBefore(
  updatePassword,
  "client.auth.updateUser(",
  "recordAuthEvent(",
  "app/api/auth/update-password/route.ts",
);

const eventsSql = await read("lib/auth-events-sql.ts");
require(
  eventsSql.includes("FROM users u") && eventsSql.includes("u.external_auth_id = ?"),
  "lib/auth-events-sql.ts: an event must be written from the authoritative users row",
);
require(
  eventsSql.includes("CASE WHEN u.status = 'ACTIVE' THEN 'SIGN_IN' ELSE 'SIGN_IN_DENIED' END"),
  "lib/auth-events-sql.ts: the recorded action must come from the account's own status",
);
require(
  !/cf-connecting-ip|remoteIp|clientAddress/i.test(eventsSql) &&
    !/cf-connecting-ip|remoteIp/i.test(await read("lib/auth-events.ts")),
  "lib/auth-events.ts: recording a client address is an Owner decision, not a default",
);

const readinessTriggers = (await read("lib/runtime-readiness.ts")).split("\r\n").join("\n");
for (const trigger of ["trg_audit_logs_no_update", "trg_audit_logs_no_delete"]) {
  require(
    readinessTriggers.includes(`\n  "${trigger}",\n`),
    `lib/runtime-readiness.ts: a runtime whose Audit trail can be rewritten must report degraded (${trigger})`,
  );
}

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

// Inviting a member and changing a role decide who may act at all. A session
// alone must not be enough: a stolen OWNER session could otherwise invite a
// second OWNER and survive the real Owner changing their password.
const PRIVILEGED_ROUTES = [
  { path: "app/api/users/invite/route.ts", write: "admin.auth.admin.inviteUserByEmail(" },
  { path: "app/api/users/[id]/route.ts", write: "d1.batch(operations)" },
];
for (const route of PRIVILEGED_ROUTES) {
  const source = await read(route.path);
  require(
    source.includes("requireCurrentPassword("),
    `${route.path}: a privileged write must require the actor's current password`,
  );
  orderedBefore(source, "requireCurrentPassword(", route.write, route.path);
  require(
    source.includes("privilegedProofAccepted("),
    `${route.path}: the proof must be checked, not merely obtained`,
  );
  require(
    source.includes('actor.role !== "OWNER"'),
    `${route.path}: the OWNER-only check must remain in addition to the proof`,
  );
  require(
    source.includes("isSameOrigin(request)"),
    `${route.path}: same-origin mutation check is missing`,
  );
}

const privilegedGuard = await read("lib/privileged-action-guard.ts");
require(
  privilegedGuard.includes("reserveAuthAttempt("),
  "lib/privileged-action-guard.ts: verifying a password is a guess and must spend the login budget",
);
orderedBefore(
  privilegedGuard,
  "reserveAuthAttempt(",
  "signInWithPassword(",
  "lib/privileged-action-guard.ts",
);
require(
  privilegedGuard.includes('return { ok: false, error: "unavailable" }'),
  "lib/privileged-action-guard.ts: an unreachable counter must refuse the write, not allow it",
);

// The admin surface has to actually ask for the password, or the control is
// only reachable by hand-crafting a request.
const usersPage = await read("app/app/users/page.tsx");
require(
  (usersPage.match(/name="currentPassword"/g) ?? []).length >= 2,
  "app/app/users/page.tsx: both the invite and the role form must ask for the current password",
);

const clientAddress = await read("lib/client-address.ts");
require(
  clientAddress.includes('headers.get("cf-connecting-ip")'),
  "lib/client-address.ts: the edge-set header is the only trusted source",
);
require(
  !clientAddress.includes("x-forwarded-for") && !clientAddress.includes("x-real-ip"),
  "lib/client-address.ts: forwarded headers must not be read",
);

// Line endings are normalised because the checkout may hold either, and the
// entry shape below is what makes the check precise.
const readiness = (await read("lib/runtime-readiness.ts")).split("\r\n").join("\n");

// The requirement lists are generated from the migrations, so a name counts as
// required only when it appears as its own quoted entry. A mention in prose is
// not a requirement.
function requires(name) {
  return readiness.includes(`\n  "${name}",\n`);
}

require(
  requires("auth_attempt_counters"),
  "lib/runtime-readiness.ts: a runtime without the counter table must report degraded",
);
require(
  requires("auth_recovery_grants"),
  "lib/runtime-readiness.ts: a runtime without the grant table must report degraded",
);

const storeSource = await read("lib/auth-throttle-store.ts");
require(
  !storeSource.includes("catch {") && !storeSource.includes("catch ("),
  "lib/auth-throttle-store.ts: the store must propagate failures so callers fail closed",
);

// --- The Owner PIN door ------------------------------------------------------
//
// A six-digit secret is defensible only while four things hold together: the
// account is fixed rather than named by the caller, the verifier is slow and
// salted, the budget is spent before the verifier runs (asserted above with the
// other throttled routes), and the session it issues cannot be edited or
// outlive the credential it was issued under.

const OWNER_PIN_ROUTE = "app/api/auth/owner-pin/login/route.ts";
const ownerPinRoute = await read(OWNER_PIN_ROUTE);
const ownerPin = await read("lib/owner-pin.ts");
const ownerPinSql = await read("lib/owner-pin-sql.ts");
const ownerPinStore = await read("lib/owner-pin-store.ts");
const currentActor = await read("lib/current-actor.ts");
const logoutRoute = await read("app/api/auth/logout/route.ts");

// The account is a server constant. An address read from the form would let a
// caller aim the attempt at another account and spend that account's lockout.
require(
  !/formData\.get\(\s*["']email["']\s*\)/.test(ownerPinRoute),
  `${OWNER_PIN_ROUTE}: the Owner address must never be read from the request`,
);
require(
  ownerPinRoute.includes("normalizeIdentitySubject(OWNER_EMAIL)"),
  `${OWNER_PIN_ROUTE}: the throttle subject must be the server constant, so PIN and password guesses share one budget`,
);
require(
  ownerPinRoute.includes("isSixDigitPin(pin)"),
  `${OWNER_PIN_ROUTE}: the PIN shape must be checked, and checked before anything is spent`,
);
orderedBefore(ownerPinRoute, "isSixDigitPin(pin)", "verifyOwnerPin(", OWNER_PIN_ROUTE);
orderedBefore(ownerPinRoute, "verifyOwnerPin(", "ensureOwnerPinIdentity(", OWNER_PIN_ROUTE);
orderedBefore(ownerPinRoute, "ensureOwnerPinIdentity(", "createOwnerSessionToken(", OWNER_PIN_ROUTE);
require(
  ownerPinRoute.includes("error=owner_conflict"),
  `${OWNER_PIN_ROUTE}: a refused bootstrap must be visible rather than a session issued anyway`,
);
require(
  ownerPinRoute.includes("recordSignInEvent("),
  `${OWNER_PIN_ROUTE}: an Owner sign-in must reach the Audit trail`,
);

// The verifier: slow, salted, and compared without leaking how much matched.
require(
  ownerPin.includes('name: "PBKDF2"') && ownerPin.includes('hash: "SHA-256"'),
  "lib/owner-pin.ts: the PIN must be verified with a slow KDF",
);
require(
  ownerPin.includes("MIN_PBKDF2_ITERATIONS = 200_000"),
  "lib/owner-pin.ts: the iteration floor must stay at 200k",
);
require(
  ownerPin.includes("iterations < MIN_PBKDF2_ITERATIONS"),
  "lib/owner-pin.ts: a credential below the floor must be refused, not accepted with a weaker parameter",
);
require(
  ownerPin.includes("salt.length < MIN_SALT_BYTES"),
  "lib/owner-pin.ts: a credential with a short salt must be refused",
);
require(
  ownerPin.includes("constantTimeEquals(derived, parsed.hash)"),
  "lib/owner-pin.ts: the PIN comparison must not leak a matching prefix",
);

// The session cookie: unforgeable, bounded, revoked by rotation, and never
// standing for an address other than the canonical Owner.
require(
  ownerPin.includes("httpOnly: true") &&
    ownerPin.includes("secure: true") &&
    ownerPin.includes('sameSite: "lax"'),
  "lib/owner-pin.ts: the session cookie must be HttpOnly, Secure and same-site",
);
require(
  ownerPin.includes("constantTimeEquals(providedSignature, new Uint8Array(expected))"),
  "lib/owner-pin.ts: the session signature must be checked, and checked in constant time",
);
require(
  ownerPin.includes("payload.exp <= input.now"),
  "lib/owner-pin.ts: a session must expire",
);
require(
  ownerPin.includes("payload.exp - payload.iat > OWNER_SESSION_TTL_MS"),
  "lib/owner-pin.ts: a session signed with a longer life than the policy must still be refused",
);
require(
  ownerPin.includes("payload.fp !== input.fingerprint"),
  "lib/owner-pin.ts: replacing the credential must invalidate every session issued under the old one",
);
require(
  ownerPin.includes("payload.email !== OWNER_EMAIL"),
  "lib/owner-pin.ts: a session naming any other address must be refused",
);

// The bootstrap may create the Owner, and may do nothing. It may never rebind
// or promote an account it did not create.
for (const guard of [
  "NOT EXISTS (SELECT 1 FROM users WHERE external_auth_id = ?)",
  "NOT EXISTS (SELECT 1 FROM users WHERE email = ?)",
]) {
  require(
    ownerPinSql.includes(guard),
    `lib/owner-pin-sql.ts: the Owner insert must be guarded by '${guard}'`,
  );
}
for (const forbidden of [/\bUPDATE\s/, /\bDELETE\s/]) {
  require(
    !forbidden.test(ownerPinSql),
    `lib/owner-pin-sql.ts: the bootstrap must only ever insert (${forbidden})`,
  );
}
require(
  ownerPinStore.includes("ownerBootstrapOutcome(ownerIdentityState(await readOwnerPinIdentityRows"),
  "lib/owner-pin-store.ts: the outcome must come from a read of the database, not from what a write believed it did",
);
require(
  ownerPinStore.includes("actor.userId !== payload.sub"),
  "lib/owner-pin-store.ts: a session must name the row it was issued for",
);

// The PIN session is resolved before the provider, and an absent provider is
// no longer a reason to tell a configured Owner that nothing is wired up.
orderedBefore(
  currentActor,
  "resolveOwnerPinSession(",
  "createSupabaseServerClient(",
  "lib/current-actor.ts",
);
require(
  currentActor.includes("authModeConfigured({"),
  "lib/current-actor.ts: the config redirect must consider every configured door, not Supabase alone",
);
require(
  !/if\s*\(!getSupabaseConfig\(\)\)\s*redirect\(/.test(currentActor),
  "lib/current-actor.ts: an absent provider must not lock out an Owner whose PIN is configured",
);

// Signing out has to end the session that exists, whichever door opened it.
require(
  logoutRoute.includes("clearedOwnerSessionCookieOptions()"),
  "app/api/auth/logout/route.ts: logout must clear the Owner PIN cookie",
);
orderedBefore(
  logoutRoute,
  "clearedOwnerSessionCookieOptions()",
  "getSupabaseConfig()",
  "app/api/auth/logout/route.ts",
);

// No Auth surface may carry a built-in account, and no throttle may be disabled
// by an environment value that Production could be missing.
const authSources = await Promise.all(
  [
    "app/api/auth/login/route.ts",
    "app/api/auth/forgot-password/route.ts",
    "app/api/auth/logout/route.ts",
    "app/api/auth/update-password/route.ts",
    OWNER_PIN_ROUTE,
    "app/auth/callback/route.ts",
    "lib/auth-recovery-grant.ts",
    "lib/auth-recovery-grant-sql.ts",
    "lib/auth-recovery-grant-store.ts",
    "lib/auth-throttle.ts",
    "lib/auth-throttle-sql.ts",
    "lib/auth-throttle-store.ts",
    "lib/owner-pin.ts",
    "lib/owner-pin-identity.ts",
    "lib/owner-pin-sql.ts",
    "lib/owner-pin-store.ts",
  ].map(async (path) => ({ path, source: await read(path) })),
);
for (const { path, source } of authSources) {
  for (const forbidden of [
    /DISABLE_[A-Z_]*THROTTL/,
    /THROTTLE_DISABLED/,
    /demo@/i,
    /\badmin123\b/i,
    // A PIN, a credential or a signing key with a value in the source is the
    // same defect in three shapes: a secret that ships in the repository.
    /\bpin\s*[:=]\s*["'][0-9]{4,}["']/i,
    /OWNER_PIN_CREDENTIAL\s*(\?\?|\|\|)/,
    /OWNER_SESSION_SECRET\s*(\?\?|\|\|)/,
    /v1\$pbkdf2-sha256\$[0-9]+\$[A-Za-z0-9_-]{8,}/,
  ]) {
    require(!forbidden.test(source), `${path}: forbidden escape hatch or built-in credential (${forbidden})`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`AUTH_SECURITY_GATE_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `AUTH_SECURITY_GATE_PASS throttledRoutes=${throttledRoutes.length} clientScope=cf-connecting-ip passwordChange=grant-or-current-password privilegedWrites=reauthenticated auditedEvents=sign-in,sign-in-denied,password-changed readiness=auth_attempt_counters,auth_recovery_grants ownerPin=fixed-account,pbkdf2-sha256>=200k,fingerprinted-session,insert-only-bootstrap`,
);
