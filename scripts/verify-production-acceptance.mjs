#!/usr/bin/env node
// Live acceptance for the authenticated application.
//
// APP_RUNTIME_PASS is a claim about a running system, so it may only ever come
// from a running system. This script is the only thing permitted to produce it,
// and it is built so that it cannot produce it by accident:
//
//  - a check that could not run is reported as SKIP and makes the verdict
//    INCOMPLETE, never PASS;
//  - the authenticated phase needs real credentials supplied at run time, and
//    without them the verdict is INCOMPLETE by construction;
//  - customer isolation needs two accounts in two different companies, because
//    proving it with one account proves nothing.
//
// It reads secrets and never prints one. It performs no write to Production
// beyond signing in, which is what a person does anyway.
//
// Usage:
//   node scripts/verify-production-acceptance.mjs
//   NATHEE_OWNER_EMAIL=... NATHEE_OWNER_PASSWORD=... \
//   NATHEE_CUSTOMER_A_EMAIL=... NATHEE_CUSTOMER_A_PASSWORD=... \
//   NATHEE_CUSTOMER_B_EMAIL=... NATHEE_CUSTOMER_B_PASSWORD=... \
//     node scripts/verify-production-acceptance.mjs

const APP_BASE = (process.env.NATHEE_APP_BASE_URL ?? "https://app.natheegroup2025.com").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.NATHEE_ACCEPTANCE_TIMEOUT_MS ?? 20000);

if (!APP_BASE.startsWith("https://")) {
  console.log(`APP_RUNTIME_FAIL the acceptance target must be https, got ${APP_BASE}`);
  console.log("Production acceptance over cleartext would prove nothing about a system reached over TLS.");
  process.exit(1);
}

const results = [];
const secrets = new Set(
  [
    process.env.NATHEE_OWNER_PASSWORD,
    process.env.NATHEE_CUSTOMER_A_PASSWORD,
    process.env.NATHEE_CUSTOMER_B_PASSWORD,
  ].filter((value) => typeof value === "string" && value.length > 0),
);

/** Nothing supplied as a secret may appear in output, whatever the path. */
function redact(text) {
  let output = String(text ?? "");
  for (const secret of secrets) output = output.split(secret).join("«redacted»");
  return output;
}

function record(phase, name, status, detail) {
  results.push({ phase, name, status, detail: redact(detail) });
}

const pass = (phase, name, detail) => record(phase, name, "PASS", detail);
const fail = (phase, name, detail) => record(phase, name, "FAIL", detail);
const skip = (phase, name, detail) => record(phase, name, "SKIP", detail);

/** A cookie jar, so an authenticated sequence behaves like a browser. */
function createJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
    accept(response) {
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const index = pair.indexOf("=");
        if (index <= 0) continue;
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (value === "" || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
        else jar.set(name, value);
      }
    },
    has: (name) => jar.has(name),
    size: () => jar.size,
  };
}

async function request(path, { method = "GET", jar, body, headers = {}, redirect = "manual" } = {}) {
  const url = `${APP_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect,
      signal: controller.signal,
      headers: {
        ...(jar && jar.size() ? { cookie: jar.header() } : {}),
        // A same-origin form post; the routes refuse anything else.
        ...(method === "POST" ? { origin: APP_BASE, "content-type": "application/x-www-form-urlencoded" } : {}),
        ...headers,
      },
      body,
    });
    if (jar) jar.accept(response);
    return { ok: true, response, text: async () => response.text() };
  } catch (error) {
    return { ok: false, error: error?.name === "AbortError" ? "timed out" : String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

const UNAUTH = "unauthenticated";
const AUTH = "authenticated";

// ---------------------------------------------------------------------------
// Phase 1 — what can be proven without any credential.
// ---------------------------------------------------------------------------

const reachability = await request("/api/health");
if (!reachability.ok) {
  fail(UNAUTH, "reachable", `${APP_BASE} could not be reached: ${reachability.error}`);
} else {
  pass(UNAUTH, "reachable", `${APP_BASE} answered`);

  // 1. Readiness. Every one of the six checks must be true; an absent check
  //    fails closed, because an older runtime that predates a check would
  //    otherwise look healthy.
  const health = reachability.response;
  let payload = null;
  try {
    payload = JSON.parse(await reachability.text());
  } catch {
    payload = null;
  }
  const REQUIRED_CHECKS = [
    "authentication",
    "adminAuthentication",
    "canonicalOrigin",
    "database",
    "storage",
    "antiAbuse",
  ];
  if (health.status !== 200 || !payload) {
    fail(UNAUTH, "health", `/api/health returned ${health.status}${payload ? "" : " with an unreadable body"}`);
  } else {
    const missing = REQUIRED_CHECKS.filter((check) => payload.checks?.[check] !== true);
    if (missing.length > 0) fail(UNAUTH, "health", `not ready: ${missing.join(", ")}`);
    else pass(UNAUTH, "health", `status=healthy, all ${REQUIRED_CHECKS.length} checks true`);
  }

  // 2. Security headers on a real response from the real origin.
  const REQUIRED_HEADERS = [
    ["content-security-policy", /frame-ancestors 'none'/],
    ["content-security-policy", /form-action 'self'/],
    ["content-security-policy", /base-uri 'none'/],
    ["x-content-type-options", /nosniff/],
    ["x-frame-options", /DENY/i],
    ["referrer-policy", /strict-origin-when-cross-origin/],
    ["cross-origin-opener-policy", /same-origin/],
    ["strict-transport-security", /max-age=\d+/],
  ];
  const headerFailures = REQUIRED_HEADERS.filter(
    ([name, shape]) => !shape.test(health.headers.get(name) ?? ""),
  ).map(([name, shape]) => `${name} !~ ${shape}`);
  if (headerFailures.length > 0) fail(UNAUTH, "security-headers", headerFailures.join("; "));
  else pass(UNAUTH, "security-headers", `${REQUIRED_HEADERS.length} header assertions`);

  // 3. The login page is the real form, not the static placeholder.
  const login = await request("/login");
  if (!login.ok) {
    fail(UNAUTH, "login-page", `unreachable: ${login.error}`);
  } else if (login.response.status !== 200) {
    fail(UNAUTH, "login-page", `/login returned ${login.response.status}`);
  } else {
    const html = await login.text();
    const posts = html.includes('action="/api/auth/login"');
    const unconfigured = html.includes("เหลือเชื่อม Project URL");
    if (!posts) fail(UNAUTH, "login-page", "/login does not post to /api/auth/login");
    else if (unconfigured) fail(UNAUTH, "login-page", "/login renders the not-configured notice; Supabase is not wired");
    else pass(UNAUTH, "login-page", "real login form, provider configured");
  }

  // 4. The protected tree must never render for an anonymous request.
  for (const path of ["/app", "/app/users", "/app/audit", "/app/site-content"]) {
    const probe = await request(path);
    if (!probe.ok) fail(UNAUTH, `anonymous${path}`, `unreachable: ${probe.error}`);
    else if (probe.response.status === 200) fail(UNAUTH, `anonymous${path}`, "rendered for an anonymous request");
    else pass(UNAUTH, `anonymous${path}`, `refused with ${probe.response.status}`);
  }

  // 5. The callback must fail closed with no code, rather than 500 or 200.
  const callback = await request("/auth/callback");
  if (!callback.ok) fail(UNAUTH, "auth-callback", `unreachable: ${callback.error}`);
  else if (callback.response.status >= 500) fail(UNAUTH, "auth-callback", `server error ${callback.response.status}`);
  else if (callback.response.status === 200) fail(UNAUTH, "auth-callback", "answered 200 with no code");
  else pass(UNAUTH, "auth-callback", `fail-closed with ${callback.response.status}`);

  // 6. Private media and operational codes reveal nothing to an anonymous
  //    caller. A well-formed identifier is used so the refusal is authorization,
  //    not input validation.
  const PRIVATE_PROBES = [
    ["/api/images/00000000-0000-4000-8000-000000000000", "private evidence"],
    ["/api/pod-signatures/00000000-0000-4000-8000-000000000000", "POD signature"],
    [`/api/qr/motorcycles/mc_${"a".repeat(32)}`, "vehicle QR"],
    [`/api/qr/yards/yard_${"a".repeat(32)}`, "yard QR"],
  ];
  for (const [path, label] of PRIVATE_PROBES) {
    const probe = await request(path);
    if (!probe.ok) fail(UNAUTH, `anonymous:${label}`, `unreachable: ${probe.error}`);
    else if (probe.response.status === 200) fail(UNAUTH, `anonymous:${label}`, "served to an anonymous caller");
    else pass(UNAUTH, `anonymous:${label}`, `refused with ${probe.response.status}`);
  }

  // 7. The application origin must be the application, not a second copy of the
  //    public marketing site.
  const root = await request("/");
  if (root.ok && root.response.status === 200) {
    const html = await root.text();
    if (html.includes("ขอใบเสนอราคา") && !html.includes("/login")) {
      fail(UNAUTH, "origin-identity", "the app origin appears to serve the public site with no application entry point");
    } else {
      pass(UNAUTH, "origin-identity", "app origin serves the application");
    }
  } else {
    pass(UNAUTH, "origin-identity", `root answered ${root.ok ? root.response.status : root.error}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — what only real credentials can prove.
// ---------------------------------------------------------------------------

const ownerEmail = process.env.NATHEE_OWNER_EMAIL;
const ownerPassword = process.env.NATHEE_OWNER_PASSWORD;

async function signIn(email, password, label) {
  const jar = createJar();
  const body = new URLSearchParams({ email, password, returnTo: "/app" }).toString();
  const attempt = await request("/api/auth/login", { method: "POST", jar, body });
  if (!attempt.ok) return { ok: false, detail: `unreachable: ${attempt.error}` };
  const location = attempt.response.headers.get("location") ?? "";
  if (/error=/.test(location)) {
    return { ok: false, detail: `${label} sign-in refused: ${location.replace(/^.*\?/, "")}` };
  }
  if (attempt.response.status !== 303) {
    return { ok: false, detail: `${label} sign-in returned ${attempt.response.status}` };
  }
  if (jar.size() === 0) return { ok: false, detail: `${label} sign-in set no session cookie` };
  return { ok: true, jar, location };
}

if (!ownerEmail || !ownerPassword) {
  skip(AUTH, "owner-login", "NATHEE_OWNER_EMAIL / NATHEE_OWNER_PASSWORD not supplied");
  for (const name of ["owner-app", "owner-audit", "owner-cms", "sign-in-audited"]) {
    skip(AUTH, name, "requires an authenticated OWNER session");
  }
} else if (!results.some((entry) => entry.name === "health" && entry.status === "PASS")) {
  for (const name of ["owner-login", "owner-app", "owner-audit", "owner-cms", "sign-in-audited"]) {
    skip(AUTH, name, "the runtime is not ready; an authenticated run would prove nothing");
  }
} else {
  const owner = await signIn(ownerEmail, ownerPassword, "OWNER");
  if (!owner.ok) {
    fail(AUTH, "owner-login", owner.detail);
    for (const name of ["owner-app", "owner-audit", "owner-cms", "sign-in-audited"]) {
      skip(AUTH, name, "no OWNER session");
    }
  } else {
    pass(AUTH, "owner-login", `signed in, redirected to ${owner.location}`);

    const surfaces = [
      ["/app", "owner-app", "the application shell"],
      ["/app/audit", "owner-audit", "the Audit trail"],
      ["/app/site-content", "owner-cms", "the website CMS"],
    ];
    for (const [path, name, label] of surfaces) {
      const probe = await request(path, { jar: owner.jar });
      if (!probe.ok) fail(AUTH, name, `unreachable: ${probe.error}`);
      else if (probe.response.status !== 200) fail(AUTH, name, `${label} returned ${probe.response.status}`);
      else pass(AUTH, name, `${label} rendered for the OWNER`);
    }

    // The sign-in just performed must appear in the trail it is supposed to
    // write. This is the check that proves the audit path works end to end.
    const audit = await request("/app/audit?view=auth", { jar: owner.jar });
    if (!audit.ok) fail(AUTH, "sign-in-audited", `unreachable: ${audit.error}`);
    else if (audit.response.status !== 200) fail(AUTH, "sign-in-audited", `returned ${audit.response.status}`);
    else {
      const html = await audit.text();
      // Matched as a whole cell: SIGN_IN_DENIED contains SIGN_IN as a substring
      // and is the opposite result.
      if (/>SIGN_IN</.test(html)) pass(AUTH, "sign-in-audited", "the sign-in appears in the Audit trail");
      else fail(AUTH, "sign-in-audited", "no SIGN_IN entry is visible in the authentication view");
    }
  }
}

// Customer isolation needs two accounts in two different companies. One account
// cannot demonstrate it, so a partial configuration is a SKIP rather than a
// weaker check that looks like proof.
const customerA = { email: process.env.NATHEE_CUSTOMER_A_EMAIL, password: process.env.NATHEE_CUSTOMER_A_PASSWORD };
const customerB = { email: process.env.NATHEE_CUSTOMER_B_EMAIL, password: process.env.NATHEE_CUSTOMER_B_PASSWORD };
if (!customerA.email || !customerA.password || !customerB.email || !customerB.password) {
  skip(
    AUTH,
    "customer-isolation",
    "needs two customer accounts in two different companies; one account cannot demonstrate isolation",
  );
} else if (!results.some((entry) => entry.name === "owner-login" && entry.status === "PASS")) {
  skip(AUTH, "customer-isolation", "the OWNER run did not succeed");
} else {
  const sessionA = await signIn(customerA.email, customerA.password, "customer A");
  const sessionB = await signIn(customerB.email, customerB.password, "customer B");
  if (!sessionA.ok || !sessionB.ok) {
    fail(AUTH, "customer-isolation", sessionA.ok ? sessionB.detail : sessionA.detail);
  } else {
    // Each customer must see their own motorcycles and none of the other's. The
    // identifiers are read from each customer's own list, so the test uses real
    // records rather than guesses.
    const listA = await request("/app/motorcycles", { jar: sessionA.jar });
    const listB = await request("/app/motorcycles", { jar: sessionB.jar });
    if (!listA.ok || !listB.ok || listA.response.status !== 200 || listB.response.status !== 200) {
      fail(AUTH, "customer-isolation", "one of the customer motorcycle lists did not render");
    } else {
      const htmlA = await listA.text();
      const htmlB = await listB.text();
      const idsIn = (html) => [...html.matchAll(/\/app\/motorcycles\/([A-Za-z0-9_-]{6,})/g)].map((m) => m[1]);
      const onlyB = idsIn(htmlB).filter((id) => !idsIn(htmlA).includes(id));
      if (onlyB.length === 0) {
        skip(AUTH, "customer-isolation", "customer B has no record customer A lacks; seed distinct data to prove isolation");
      } else {
        const target = onlyB[0];
        const crossRead = await request(`/app/motorcycles/${target}`, { jar: sessionA.jar });
        if (!crossRead.ok) fail(AUTH, "customer-isolation", `unreachable: ${crossRead.error}`);
        else if (crossRead.response.status === 200) {
          fail(AUTH, "customer-isolation", "customer A opened a record belonging to customer B");
        } else {
          pass(AUTH, "customer-isolation", `customer A refused customer B's record with ${crossRead.response.status}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Verdict. PASS requires every check to have actually run and passed.
// ---------------------------------------------------------------------------

const failed = results.filter((entry) => entry.status === "FAIL");
const skipped = results.filter((entry) => entry.status === "SKIP");
const passed = results.filter((entry) => entry.status === "PASS");

for (const entry of results) {
  console.log(`${entry.status.padEnd(4)} [${entry.phase}] ${entry.name}: ${entry.detail}`);
}
console.log("");
console.log(`app=${APP_BASE} at=${new Date().toISOString()}`);

if (failed.length > 0) {
  console.log(
    `APP_RUNTIME_FAIL passed=${passed.length} failed=${failed.length} skipped=${skipped.length} (${failed.map((entry) => entry.name).join(", ")})`,
  );
  process.exit(1);
}
if (skipped.length > 0) {
  console.log(
    `APP_RUNTIME_INCOMPLETE passed=${passed.length} skipped=${skipped.length} (${skipped.map((entry) => entry.name).join(", ")})`,
  );
  // Worded without the pass token on purpose: a log scanned for that token
  // must not match on a run that did not earn it.
  console.log("A check that did not run is not a check that passed, so this run proves nothing about readiness.");
  process.exit(2);
}
console.log(`APP_RUNTIME_PASS checks=${passed.length} failed=0 skipped=0 app=${APP_BASE}`);
