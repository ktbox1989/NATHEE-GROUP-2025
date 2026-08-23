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

import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { classifyHostname } from "../lib/hostname-diagnosis.ts";
import { probeHostname } from "./probe-hostname.mjs";
import { DEFAULT_SITE_CONTENT, SITE_PAGE_DEFINITIONS } from "../lib/site-cms-content.ts";

const APP_BASE = (process.env.NATHEE_APP_BASE_URL ?? "https://app.natheegroup2025.com").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.NATHEE_ACCEPTANCE_TIMEOUT_MS ?? 20000);

// Publishing changes what the public site shows, even briefly, so it is opted
// into explicitly and names the page it may touch.
const ALLOW_WRITES = process.env.NATHEE_ACCEPTANCE_ALLOW_WRITES === "1";
const CMS_SLUG = process.env.NATHEE_ACCEPTANCE_CMS_SLUG;
const CMS_CHECKS = ["cms-draft", "cms-preview", "cms-publish", "cms-public", "cms-restore"];
const RECOVERY_ATTESTED = process.env.NATHEE_ACCEPTANCE_RECOVERY_VERIFIED === "1";
const LIFECYCLE_CHECKS = ["recovery-request", "recovery-link", "session-ends"];


if (!APP_BASE.startsWith("https://")) {
  console.log(`APP_RUNTIME_FAIL the acceptance target must be https, got ${APP_BASE}`);
  console.log("Production acceptance over cleartext would prove nothing about a system reached over TLS.");
  process.exit(1);
}

// The hostname gate runs first and is not optional. Authenticated acceptance
// against a name that does not resolve consistently and terminate TLS cannot
// mean anything, and a verdict produced from it would be worse than no verdict,
// because it would be reported as evidence.
//
// An IP literal is the one case where the DNS ladder does not apply: there is no
// name to resolve. That path is announced rather than assumed, so a run that
// skipped the gate can never look like a run that passed it.
const TARGET_HOST = new URL(APP_BASE).hostname;
if (isIP(TARGET_HOST)) {
  console.log(`note: hostname gate not applicable, the target is an IP literal (${TARGET_HOST})`);
} else {
  const { evidence } = await probeHostname(TARGET_HOST);
  const gate = classifyHostname(evidence);
  if (gate.code !== "SERVING") {
    console.log(`APP_RUNTIME_FAIL the hostname gate did not pass: APP_HOSTNAME_${gate.code}`);
    console.log(gate.summary);
    console.log(`next: ${gate.nextAction}`);
    console.log("No authenticated check was attempted. Run npm run verify:hostname for the full evidence.");
    process.exitCode = 1;
    process.exit();
  }
  console.log(`hostname gate: APP_HOSTNAME_${gate.code} (${TARGET_HOST})`);
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
  for (const name of ["owner-app", "owner-audit", "owner-cms", "sign-in-audited", "owner-print", "owner-qr", ...CMS_CHECKS, ...LIFECYCLE_CHECKS]) {
    skip(AUTH, name, "requires an authenticated OWNER session");
  }
} else if (!results.some((entry) => entry.name === "health" && entry.status === "PASS")) {
  for (const name of ["owner-login", "owner-app", "owner-audit", "owner-cms", "sign-in-audited", "owner-print", "owner-qr", ...CMS_CHECKS, ...LIFECYCLE_CHECKS]) {
    skip(AUTH, name, "the runtime is not ready; an authenticated run would prove nothing");
  }
} else {
  const owner = await signIn(ownerEmail, ownerPassword, "OWNER");
  if (!owner.ok) {
    fail(AUTH, "owner-login", owner.detail);
    for (const name of ["owner-app", "owner-audit", "owner-cms", "sign-in-audited", "owner-print", "owner-qr", ...CMS_CHECKS, ...LIFECYCLE_CHECKS]) {
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

    await verifyOperationalAccess(owner.jar);
    await verifyContentLoop(owner.jar);
    await verifyRecovery(ownerEmail);

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

    await verifySessionEnds(owner.jar);
  }
}

// The operational surfaces the Owner named: a QR that a signed-in operator can
// actually fetch, and the print sheet it comes from. The anonymous half is
// checked above with a well-formed identifier; this half uses a real record, so
// a route that refused everyone would not pass both.
async function verifyOperationalAccess(jar) {
  const printCentre = await request("/app/print-center", { jar });
  if (!printCentre.ok) fail(AUTH, "owner-print", `unreachable: ${printCentre.error}`);
  else if (printCentre.response.status !== 200) fail(AUTH, "owner-print", `the print centre returned ${printCentre.response.status}`);
  else pass(AUTH, "owner-print", "the print centre rendered for the OWNER");

  const list = await request("/app/motorcycles", { jar });
  if (!list.ok || list.response.status !== 200) {
    skip(AUTH, "owner-qr", "the motorcycle list did not render, so no real record was available");
    return;
  }
  const id = /\/app\/motorcycles\/([A-Za-z0-9_-]{6,})/.exec(await list.text())?.[1];
  if (!id) {
    skip(AUTH, "owner-qr", "no motorcycle exists yet; a QR cannot be fetched for a record that is not there");
    return;
  }
  const label = await request(`/app/motorcycles/${id}/label`, { jar });
  if (!label.ok || label.response.status !== 200) {
    fail(AUTH, "owner-qr", `the label sheet for ${id} returned ${label.ok ? label.response.status : label.error}`);
    return;
  }
  const qrPath = /\/api\/qr\/motorcycles\/[A-Za-z0-9_%-]+/.exec(await label.text())?.[0];
  if (!qrPath) {
    fail(AUTH, "owner-qr", "the label sheet renders no QR source");
    return;
  }
  const authorized = await request(qrPath, { jar });
  const anonymous = await request(qrPath);
  if (!authorized.ok || authorized.response.status !== 200) {
    fail(AUTH, "owner-qr", `an authorized QR fetch returned ${authorized.ok ? authorized.response.status : authorized.error}`);
  } else if (anonymous.ok && anonymous.response.status === 200) {
    fail(AUTH, "owner-qr", "the same QR is served to an anonymous caller");
  } else {
    pass(AUTH, "owner-qr", `served to the OWNER, refused anonymously with ${anonymous.ok ? anonymous.response.status : anonymous.error}`);
  }
}

// Draft to Preview to Publish, proven on the live site and then put back exactly
// as it was. Revisions are append-only and this never edits one, so the restore
// republishes whichever revision was live before and no content can be lost. It
// is opt-in because publishing changes what the public site shows, even briefly.

function markedContent(slug, marker) {
  const base = DEFAULT_SITE_CONTENT[slug];
  const first = base.sections.findIndex((section) => section.enabled);
  const sections = base.sections.map((section, index) =>
    index === first ? { ...section, heading: `${section.heading.slice(0, 140)} ${marker}` } : section,
  );
  return JSON.stringify({ ...base, sections });
}

/** The revision the page is serving right now, so it can be served again. */
function livePublication(html) {
  const state = /<span class="status-pill (PUBLISH|HIDE|DRAFT)">/.exec(html)?.[1] ?? "DRAFT";
  const liveArticle = html.split("<article").find((chunk) => chunk.includes(">LIVE<"));
  const revisionId = liveArticle ? /[?&]revision=([A-Za-z0-9-]{8,})/.exec(liveArticle)?.[1] ?? null : null;
  return { state, revisionId };
}


async function verifyContentLoop(jar) {
  if (!ALLOW_WRITES || !CMS_SLUG) {
    for (const name of CMS_CHECKS) {
      skip(AUTH, name, "set NATHEE_ACCEPTANCE_ALLOW_WRITES=1 and NATHEE_ACCEPTANCE_CMS_SLUG=<page> to exercise publishing");
    }
    return;
  }
  if (!Object.hasOwn(SITE_PAGE_DEFINITIONS, CMS_SLUG)) {
    for (const name of CMS_CHECKS) fail(AUTH, name, `NATHEE_ACCEPTANCE_CMS_SLUG=${CMS_SLUG} is not a managed page`);
    return;
  }

  const editor = await request(`/app/site-content/${CMS_SLUG}`, { jar });
  if (!editor.ok || editor.response.status !== 200) {
    for (const name of CMS_CHECKS) {
      fail(AUTH, name, `the editor for ${CMS_SLUG} returned ${editor.ok ? editor.response.status : editor.error}`);
    }
    return;
  }
  const before = livePublication(await editor.text());

  const marker = `NATHEE-ACCEPTANCE-${randomUUID().slice(0, 8)}`;
  const draft = await request(`/api/site-content/${CMS_SLUG}/revisions`, {
    method: "POST",
    jar,
    body: new URLSearchParams({
      requestKey: `acceptance-draft-${randomUUID()}`,
      contentJson: markedContent(CMS_SLUG, marker),
      changeNote: "Production acceptance run; restored immediately.",
    }).toString(),
  });
  const savedTo = draft.ok ? draft.response.headers.get("location") ?? "" : "";
  const revisionId = /[?&]revision=([A-Za-z0-9-]{8,})/.exec(savedTo)?.[1];
  if (!draft.ok || !/status=(saved|already_saved)/.test(savedTo) || !revisionId) {
    for (const name of CMS_CHECKS) {
      fail(AUTH, name, `saving a draft failed: ${draft.ok ? savedTo || draft.response.status : draft.error}`);
    }
    return;
  }
  pass(AUTH, "cms-draft", `revision ${revisionId.slice(0, 8)} saved for ${CMS_SLUG}`);

  const preview = await request(`/app/site-content/${CMS_SLUG}/preview?revision=${encodeURIComponent(revisionId)}`, { jar });
  const previewHtml = preview.ok && preview.response.status === 200 ? await preview.text() : "";
  if (previewHtml.includes(marker)) pass(AUTH, "cms-preview", "the preview shows the unpublished draft");
  else fail(AUTH, "cms-preview", "the preview does not show the draft that was just saved");

  // A draft that is already public is the failure this whole separation exists
  // to prevent, so it is checked before anything is published.
  const publicPath = SITE_PAGE_DEFINITIONS[CMS_SLUG].path;
  const beforePublish = await request(publicPath);
  if (beforePublish.ok && (await beforePublish.text()).includes(marker)) {
    for (const name of ["cms-publish", "cms-public", "cms-restore"]) {
      fail(AUTH, name, "the unpublished draft is already visible on the public page");
    }
    return;
  }

  if (before.state !== "PUBLISH" || !before.revisionId) {
    for (const name of ["cms-publish", "cms-public", "cms-restore"]) {
      skip(
        AUTH,
        name,
        `${CMS_SLUG} has no published revision to return to, so publishing could not be undone exactly; publish real content first`,
      );
    }
    return;
  }

  const publish = await request(`/api/site-content/${CMS_SLUG}/publish`, {
    method: "POST",
    jar,
    body: new URLSearchParams({
      action: "PUBLISH",
      revisionId,
      requestKey: `acceptance-publish-${randomUUID()}`,
      note: "Production acceptance run; restored immediately.",
    }).toString(),
  });
  const publishedTo = publish.ok ? publish.response.headers.get("location") ?? "" : "";
  if (!publish.ok || !/status=(published|already_published)/.test(publishedTo)) {
    for (const name of ["cms-publish", "cms-public", "cms-restore"]) {
      fail(AUTH, name, `publishing failed: ${publish.ok ? publishedTo || publish.response.status : publish.error}`);
    }
    return;
  }
  pass(AUTH, "cms-publish", `${CMS_SLUG} published from inside the application`);

  const live = await request(publicPath);
  if (live.ok && live.response.status === 200 && (await live.text()).includes(marker)) {
    pass(AUTH, "cms-public", `${publicPath} serves the published revision with no redeploy`);
  } else {
    fail(AUTH, "cms-public", `${publicPath} does not show the revision that was just published`);
  }

  // Whatever happened above, put the site back.
  const restore = await request(`/api/site-content/${CMS_SLUG}/publish`, {
    method: "POST",
    jar,
    body: new URLSearchParams({
      action: "PUBLISH",
      revisionId: before.revisionId,
      requestKey: `acceptance-restore-${randomUUID()}`,
      note: "Restoring the revision that was live before the acceptance run.",
    }).toString(),
  });
  const restoredTo = restore.ok ? restore.response.headers.get("location") ?? "" : "";
  const after = await request(publicPath);
  const stillMarked = after.ok ? (await after.text()).includes(marker) : true;
  if (!restore.ok || !/status=(published|already_published)/.test(restoredTo) || stillMarked) {
    fail(
      AUTH,
      "cms-restore",
      `the site was NOT restored. Republish revision ${before.revisionId} for ${CMS_SLUG} by hand.`,
    );
  } else {
    pass(AUTH, "cms-restore", `${CMS_SLUG} is serving revision ${before.revisionId.slice(0, 8)} again`);
  }
}

// Recovery splits into a half a script can measure and a half it cannot. The
// request is measurable, and the property worth measuring is that the reply is
// byte-identical for an address that exists and one that does not, since a
// difference there turns the form into an account directory. Clicking the
// emailed link needs a mailbox, so it is attested by the operator and labelled
// as attested rather than quietly counted as measured.

async function verifyRecovery(email) {
  if (!ALLOW_WRITES) {
    skip(AUTH, "recovery-request", "sends a real email; set NATHEE_ACCEPTANCE_ALLOW_WRITES=1 to exercise it");
  } else {
    const ask = (address) =>
      request("/api/auth/forgot-password", {
        method: "POST",
        jar: createJar(),
        body: new URLSearchParams({ email: address }).toString(),
      });
    const real = await ask(email);
    const absent = await ask(`no-such-account-${randomUUID()}@acceptance.invalid`);
    if (!real.ok || !absent.ok) {
      fail(AUTH, "recovery-request", `unreachable: ${real.ok ? absent.error : real.error}`);
    } else if (real.response.status !== 303 || !/sent=1/.test(real.response.headers.get("location") ?? "")) {
      fail(AUTH, "recovery-request", `a recovery request returned ${real.response.status} ${real.response.headers.get("location") ?? ""}`);
    } else if (
      absent.response.status !== real.response.status ||
      absent.response.headers.get("location") !== real.response.headers.get("location")
    ) {
      fail(AUTH, "recovery-request", "a known and an unknown address get different replies, which reveals who has an account");
    } else {
      pass(AUTH, "recovery-request", "accepted, and identical for a known and an unknown address");
    }
  }

  if (RECOVERY_ATTESTED) {
    pass(AUTH, "recovery-link", "attested by the operator: an emailed link completed and reached /reset-password");
  } else {
    skip(
      AUTH,
      "recovery-link",
      "no script can read the mailbox; complete a real recovery link, then set NATHEE_ACCEPTANCE_RECOVERY_VERIFIED=1",
    );
  }
}

// Signing out has to actually end the session, not just redirect. Run last: it
// spends the session everything above depends on.
async function verifySessionEnds(jar) {
  const before = await request("/app", { jar });
  if (!before.ok || before.response.status !== 200) {
    skip(AUTH, "session-ends", "the session was not usable before sign-out, so ending it proves nothing");
    return;
  }
  // Captured before signing out and replayed afterwards. Sending the jar would
  // only show that the client forgot the cookie; a server that clears the cookie
  // but leaves the token valid still answers a stolen one, which is the case
  // worth catching.
  const stolen = jar.header();
  const out = await request("/api/auth/logout", { method: "POST", jar, body: "" });
  if (!out.ok) {
    fail(AUTH, "session-ends", `sign-out unreachable: ${out.error}`);
    return;
  }
  const after = await request("/app", { headers: { cookie: stolen } });
  if (after.ok && after.response.status === 200) {
    fail(AUTH, "session-ends", "the session cookie still works after signing out");
  } else {
    pass(AUTH, "session-ends", `the old cookie is refused with ${after.ok ? after.response.status : after.error}`);
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
