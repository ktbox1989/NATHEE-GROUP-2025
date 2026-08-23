import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// An acceptance script that has never been shown to reject a broken runtime is
// not evidence of anything.
//
// Deliberately not named `*-negative.mjs`: that suffix means a suite that
// mutates copied source to prove a static gate rejects it, and
// `test-line-ending-independence.mjs` scans those files for carriage-return
// handling. This suite never reads or rewrites a source file — it stands up a
// server and breaks its behaviour — so it has no replacement anchors to survive
// a CRLF checkout, and satisfying that scan here would be decoration rather
// than a check. It must stay free of source mutation for that to remain true. This stands up a real HTTPS server that impersonates
// the application, then breaks it one way at a time and requires the acceptance
// run to notice — including the two ways it could lie by omission: reporting PASS
// when a check never ran, and reporting isolation proven from data that could not
// prove it.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const acceptance = join(root, "scripts/verify-production-acceptance.mjs");

// Generated per run and never written to the repository, so nothing resembling a
// credential is committed and no run reuses another run's values.
const OWNER = { email: `owner-${randomUUID()}@acceptance.invalid`, password: randomUUID(), company: null };
const CUSTOMER_A = { email: `a-${randomUUID()}@acceptance.invalid`, password: randomUUID(), company: "A" };
const CUSTOMER_B = { email: `b-${randomUUID()}@acceptance.invalid`, password: randomUUID(), company: "B" };

const MOTORCYCLES = { A: ["mc_alpha_00000001"], B: ["mc_bravo_00000001"] };
const QR_PUBLIC_ID = "mc_" + "a".repeat(32);
// A managed page and its public path, matching lib/site-cms-content.ts.
const CMS_SLUG = "contact";
const CMS_PUBLIC_PATH = "/contact";
const ORIGINAL_REVISION = "rev-live-original";
const ORIGINAL_CONTENT = "เนื้อหาที่เผยแพร่อยู่เดิม";

const certificateDirectory = mkdtempSync(join(tmpdir(), "nathee-acceptance-tls-"));
const keyPath = join(certificateDirectory, "key.pem");
const certPath = join(certificateDirectory, "cert.pem");
const openssl = spawnSync(
  "openssl",
  [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath, "-days", "1",
    "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
  ],
  { encoding: "utf8" },
);
if (openssl.status !== 0) {
  console.error(`ACCEPTANCE_NEGATIVE_FAIL could not generate a test certificate\n${openssl.stderr}`);
  rmSync(certificateDirectory, { recursive: true, force: true });
  process.exit(1);
}

const SECURITY_HEADERS = {
  "Content-Security-Policy": "base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const HEALTHY_CHECKS = {
  authentication: true,
  adminAuthentication: true,
  canonicalOrigin: true,
  database: true,
  storage: true,
  antiAbuse: true,
};

/**
 * Every way the running system can be wrong that the acceptance run is supposed
 * to catch. `expect` is the verdict the run must reach.
 */
const CASES = [
  { name: "a healthy runtime with every credential", defect: null, credentials: "all", expect: "PASS" },
  { name: "no credentials at all", defect: null, credentials: "none", expect: "INCOMPLETE" },
  { name: "an OWNER credential but no customers", defect: null, credentials: "owner", expect: "INCOMPLETE" },
  { name: "two customers whose records are indistinguishable", defect: "identicalCustomerData", credentials: "all", expect: "INCOMPLETE" },
  { name: "publishing was not opted into", defect: null, credentials: "all", writes: false, expect: "INCOMPLETE" },
  { name: "the chosen page has never been published", defect: "cmsNeverPublished", credentials: "all", expect: "INCOMPLETE" },

  { name: "one readiness check is false", defect: "degradedHealth", credentials: "all", expect: "FAIL" },
  { name: "a readiness check is absent from the payload", defect: "missingHealthCheck", credentials: "all", expect: "FAIL" },
  { name: "health answers 503", defect: "healthUnavailable", credentials: "all", expect: "FAIL" },
  { name: "the Content-Security-Policy is dropped", defect: "noCsp", credentials: "all", expect: "FAIL" },
  { name: "form-action is missing from the policy", defect: "weakCsp", credentials: "all", expect: "FAIL" },
  { name: "HSTS is not declared", defect: "noHsts", credentials: "all", expect: "FAIL" },
  { name: "nosniff is dropped", defect: "noSniff", credentials: "all", expect: "FAIL" },
  { name: "login still renders the not-configured placeholder", defect: "placeholderLogin", credentials: "all", expect: "FAIL" },
  { name: "the login page has no real form", defect: "loginWithoutForm", credentials: "all", expect: "FAIL" },
  { name: "the application shell renders for an anonymous request", defect: "anonymousApp", credentials: "all", expect: "FAIL" },
  { name: "the Audit trail renders for an anonymous request", defect: "anonymousAudit", credentials: "all", expect: "FAIL" },
  { name: "the callback answers 200 with no code", defect: "callbackAccepts", credentials: "all", expect: "FAIL" },
  { name: "the callback raises a server error", defect: "callbackErrors", credentials: "all", expect: "FAIL" },
  { name: "private evidence is served to an anonymous caller", defect: "publicMedia", credentials: "all", expect: "FAIL" },
  { name: "a QR code is served to an anonymous caller", defect: "publicQr", credentials: "all", expect: "FAIL" },
  { name: "the OWNER credential is refused", defect: "refuseOwner", credentials: "all", expect: "FAIL" },
  { name: "sign-in sets no session cookie", defect: "noSessionCookie", credentials: "all", expect: "FAIL" },
  { name: "the CMS surface errors for the OWNER", defect: "cmsBroken", credentials: "all", expect: "FAIL" },
  { name: "the sign-in is never written to the Audit trail", defect: "noAuditSignIn", credentials: "all", expect: "FAIL" },
  { name: "the trail shows only a denied sign-in", defect: "auditDeniedOnly", credentials: "all", expect: "FAIL" },
  { name: "one customer can open a record belonging to the other", defect: "crossTenantRead", credentials: "all", expect: "FAIL" },
  { name: "the print centre errors for the OWNER", defect: "printBroken", credentials: "all", expect: "FAIL" },
  { name: "the label sheet renders no QR", defect: "labelNoQr", credentials: "all", expect: "FAIL" },
  { name: "a draft cannot be saved", defect: "draftRejected", credentials: "all", expect: "FAIL" },
  { name: "the preview does not show the draft", defect: "previewMissesDraft", credentials: "all", expect: "FAIL" },
  { name: "saving a draft publishes it immediately", defect: "draftLeaksPublic", credentials: "all", expect: "FAIL" },
  { name: "publishing is refused", defect: "publishRefused", credentials: "all", expect: "FAIL" },
  { name: "publishing succeeds but the public page does not change", defect: "publishNotLive", credentials: "all", expect: "FAIL" },
  { name: "the site is not restored after the run", defect: "restoreIgnored", credentials: "all", expect: "FAIL" },
];

function buildHandler(defect) {
  const sessions = new Map();
  const revisions = new Map([[ORIGINAL_REVISION, ORIGINAL_CONTENT]]);
  let published = ORIGINAL_REVISION;
  let nextRevision = 0;

  const accountFor = (email, password) => {
    for (const account of [OWNER, CUSTOMER_A, CUSTOMER_B]) {
      if (account.email === email && account.password === password) return account;
    }
    return null;
  };

  const sessionOf = (request) => {
    const cookie = request.headers.cookie ?? "";
    const match = /nathee_session=([^;]+)/.exec(cookie);
    return match ? sessions.get(match[1]) ?? null : null;
  };

  const ownedBy = (account) =>
    account.company ? MOTORCYCLES[account.company] : [...MOTORCYCLES.A, ...MOTORCYCLES.B];

  const send = (response, status, body, extraHeaders = {}) => {
    const headers = { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...extraHeaders };
    if (defect === "noCsp") delete headers["Content-Security-Policy"];
    if (defect === "weakCsp") {
      headers["Content-Security-Policy"] = "base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
    }
    if (defect === "noHsts") delete headers["Strict-Transport-Security"];
    if (defect === "noSniff") delete headers["X-Content-Type-Options"];
    response.writeHead(status, headers);
    response.end(body ?? "");
  };

  return (request, response) => {
    const url = new URL(request.url, "https://127.0.0.1");
    const path = url.pathname;
    const session = sessionOf(request);

    if (path === "/api/health") {
      const checks = { ...HEALTHY_CHECKS };
      if (defect === "degradedHealth") checks.database = false;
      if (defect === "missingHealthCheck") delete checks.antiAbuse;
      const unavailable = defect === "healthUnavailable";
      const healthy = !unavailable && Object.values(checks).every(Boolean);
      return send(
        response,
        unavailable ? 503 : 200,
        JSON.stringify({ status: healthy ? "healthy" : "degraded", checks }),
        { "content-type": "application/json" },
      );
    }

    if (path === "/login") {
      if (defect === "placeholderLogin") {
        return send(
          response,
          200,
          '<main><p>UI พร้อมใช้งานแล้ว เหลือเชื่อม Project URL และ Publishable Key</p>' +
            '<form action="/api/auth/login" method="post"></form></main>',
        );
      }
      if (defect === "loginWithoutForm") return send(response, 200, "<main><p>เข้าสู่ระบบ</p></main>");
      return send(
        response,
        200,
        '<main class="login-page"><form action="/api/auth/login" method="post"><input name="email"/></form></main>',
      );
    }

    if (path === "/api/auth/login" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const form = new URLSearchParams(body);
        const account = accountFor(form.get("email"), form.get("password"));
        if (!account || (defect === "refuseOwner" && account === OWNER)) {
          return send(response, 303, "", { location: "/login?error=invalid_credentials" });
        }
        const token = randomUUID();
        sessions.set(token, account);
        const headers = { location: "/app" };
        if (defect !== "noSessionCookie") {
          headers["set-cookie"] = `nathee_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`;
        }
        send(response, 303, "", headers);
      });
      return undefined;
    }

    if (path === "/auth/callback") {
      if (defect === "callbackAccepts") return send(response, 200, "<main>ok</main>");
      if (defect === "callbackErrors") return send(response, 500, "error");
      return send(response, 303, "", { location: "/forgot-password?error=expired" });
    }

    if (path.startsWith("/api/images/") || path.startsWith("/api/pod-signatures/")) {
      if (defect === "publicMedia" || session) return send(response, 200, "binary");
      return send(response, 401, "Unauthorized");
    }

    if (path.startsWith("/api/qr/")) {
      if (defect === "publicQr" || session) return send(response, 200, "<svg/>");
      return send(response, 401, "Unauthorized");
    }

    if (path === "/app/site-content") {
      if (!session) return send(response, 303, "", { location: "/login" });
      if (defect === "cmsBroken") return send(response, 500, "error");
      return send(response, 200, "<main>จัดการเว็บไซต์</main>");
    }

    if (path === "/app/print-center") {
      if (!session) return send(response, 303, "", { location: "/login" });
      if (defect === "printBroken") return send(response, 500, "error");
      return send(response, 200, "<main>ศูนย์พิมพ์</main>");
    }

    if (/^\/app\/motorcycles\/[^/]+\/label$/.test(path)) {
      if (!session) return send(response, 303, "", { location: "/login" });
      if (defect === "labelNoQr") return send(response, 200, "<main><p>ไม่มี QR</p></main>");
      return send(response, 200, `<main><img src="/api/qr/motorcycles/${QR_PUBLIC_ID}" /></main>`);
    }

    if (path === `/app/site-content/${CMS_SLUG}`) {
      if (!session) return send(response, 303, "", { location: "/login" });
      if (defect === "cmsNeverPublished") {
        return send(response, 200, '<main><span class="status-pill DRAFT">DRAFT</span></main>');
      }
      return send(
        response,
        200,
        '<main><span class="status-pill PUBLISH">PUBLISH</span>' +
          `<article><b>${published.slice(0, 8)}…</b><span class="status-pill PUBLISH">LIVE</span>` +
          `<a href="/app/site-content/${CMS_SLUG}?revision=${published}">เปิดแก้จาก Revision นี้</a></article></main>`,
      );
    }

    if (path === `/app/site-content/${CMS_SLUG}/preview`) {
      if (!session) return send(response, 303, "", { location: "/login" });
      const wanted = url.searchParams.get("revision") ?? "";
      const content = defect === "previewMissesDraft" ? revisions.get(ORIGINAL_REVISION) : revisions.get(wanted);
      if (content === undefined) return send(response, 404, "Not found");
      return send(response, 200, `<main>${content}</main>`);
    }

    if (path === `/api/site-content/${CMS_SLUG}/revisions` && request.method === "POST") {
      if (!session) return send(response, 303, "", { location: "/login?error=not_authorized" });
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const form = new URLSearchParams(body);
        const contentJson = form.get("contentJson") ?? "";
        if (defect === "draftRejected") {
          return send(response, 303, "", { location: `/app/site-content/${CMS_SLUG}?error=invalid_content` });
        }
        nextRevision += 1;
        const id = `rev-draft-${String(nextRevision).padStart(6, "0")}`;
        revisions.set(id, contentJson);
        if (defect === "draftLeaksPublic") published = id;
        send(response, 303, "", { location: `/app/site-content/${CMS_SLUG}?status=saved&revision=${id}` });
      });
      return undefined;
    }

    if (path === `/api/site-content/${CMS_SLUG}/publish` && request.method === "POST") {
      if (!session) return send(response, 303, "", { location: "/login?error=not_authorized" });
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const form = new URLSearchParams(body);
        const wanted = form.get("revisionId") ?? "";
        const restoring = wanted === ORIGINAL_REVISION;
        if (defect === "publishRefused" && !restoring) {
          return send(response, 303, "", { location: `/app/site-content/${CMS_SLUG}?error=publish_failed` });
        }
        const ignore = (defect === "publishNotLive" && !restoring) || (defect === "restoreIgnored" && restoring);
        if (!ignore && revisions.has(wanted)) published = wanted;
        send(response, 303, "", { location: `/app/site-content/${CMS_SLUG}?status=published` });
      });
      return undefined;
    }

    if (path === CMS_PUBLIC_PATH) {
      return send(response, 200, `<main>${revisions.get(published) ?? ""}</main>`);
    }

    if (path === "/app/audit") {
      if (!session && defect !== "anonymousAudit") return send(response, 303, "", { location: "/login" });
      let pill = '<span class="status-pill">SIGN_IN</span>';
      if (defect === "noAuditSignIn") pill = '<span class="status-pill">UPDATE</span>';
      if (defect === "auditDeniedOnly") pill = '<span class="status-pill">SIGN_IN_DENIED</span>';
      return send(response, 200, `<main><table><tbody><tr><td>${pill}</td></tr></tbody></table></main>`);
    }

    if (path === "/app/motorcycles") {
      if (!session) return send(response, 303, "", { location: "/login" });
      const owned = defect === "identicalCustomerData"
        ? [...MOTORCYCLES.A, ...MOTORCYCLES.B]
        : ownedBy(session);
      const rows = owned.map((id) => `<a href="/app/motorcycles/${id}">คัน</a>`).join("");
      return send(response, 200, `<main>${rows}</main>`);
    }

    if (path.startsWith("/app/motorcycles/")) {
      if (!session) return send(response, 303, "", { location: "/login" });
      const id = path.slice("/app/motorcycles/".length);
      if (defect === "crossTenantRead" || ownedBy(session).includes(id)) {
        return send(response, 200, "<main>คัน</main>");
      }
      return send(response, 403, "Forbidden");
    }

    if (path.startsWith("/app")) {
      if (defect === "anonymousApp" || session) return send(response, 200, "<main>แดชบอร์ด</main>");
      return send(response, 303, "", { location: "/login" });
    }

    if (path === "/") return send(response, 200, '<main><a href="/login">เข้าสู่ระบบ</a></main>');
    return send(response, 404, "Not found");
  };
}

function credentialEnvironment(mode) {
  if (mode === "none") return {};
  const owner = {
    NATHEE_OWNER_EMAIL: OWNER.email,
    NATHEE_OWNER_PASSWORD: OWNER.password,
  };
  if (mode === "owner") return owner;
  return {
    ...owner,
    NATHEE_CUSTOMER_A_EMAIL: CUSTOMER_A.email,
    NATHEE_CUSTOMER_A_PASSWORD: CUSTOMER_A.password,
    NATHEE_CUSTOMER_B_EMAIL: CUSTOMER_B.email,
    NATHEE_CUSTOMER_B_PASSWORD: CUSTOMER_B.password,
  };
}

async function runCase(testCase) {
  const server = createServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    buildHandler(testCase.defect),
  );
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  try {
    // Spawned asynchronously on purpose: the stub above serves from this
    // process, so a synchronous child would block the very event loop that has
    // to answer its requests, and every check would time out.
    const child = spawn(process.execPath, [acceptance], {
      env: {
        ...process.env,
        // Test-only: the certificate above is generated for this run and is not
        // meant to chain to anything.
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        NATHEE_APP_BASE_URL: `https://127.0.0.1:${port}`,
        NATHEE_ACCEPTANCE_TIMEOUT_MS: "10000",
        ...(testCase.writes === false
          ? {}
          : { NATHEE_ACCEPTANCE_ALLOW_WRITES: "1", NATHEE_ACCEPTANCE_CMS_SLUG: CMS_SLUG }),
        ...credentialEnvironment(testCase.credentials),
      },
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    await new Promise((resolveExit) => child.on("close", resolveExit));
    return output;
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

let failures = 0;

for (const testCase of CASES) {
  const output = await runCase(testCase);
  const verdict = /APP_RUNTIME_(PASS|FAIL|INCOMPLETE)/.exec(output)?.[1] ?? "NONE";
  if (verdict !== testCase.expect) {
    failures += 1;
    console.error(
      `ACCEPTANCE_NEGATIVE_FAIL expected ${testCase.expect} but got ${verdict}: ${testCase.name}\n${output.trim()}`,
    );
    continue;
  }
  // A run that is not a clean pass must never also print the pass token, or a
  // reader scanning the log would find it.
  if (testCase.expect !== "PASS" && /APP_RUNTIME_PASS\b/.test(output)) {
    failures += 1;
    console.error(`ACCEPTANCE_NEGATIVE_FAIL a ${verdict} run also printed APP_RUNTIME_PASS: ${testCase.name}`);
  }
  // Nothing supplied as a password may ever appear in the output.
  for (const secret of [OWNER.password, CUSTOMER_A.password, CUSTOMER_B.password]) {
    if (output.includes(secret)) {
      failures += 1;
      console.error(`ACCEPTANCE_NEGATIVE_FAIL a credential was printed: ${testCase.name}`);
    }
  }
}

// Cleartext is not an acceptable acceptance target, whatever it answers.
const cleartext = spawnSync(process.execPath, [acceptance], {
  encoding: "utf8",
  env: { ...process.env, NATHEE_APP_BASE_URL: "http://127.0.0.1:1" },
});
if (!/APP_RUNTIME_FAIL/.test(cleartext.stdout ?? "")) {
  failures += 1;
  console.error("ACCEPTANCE_NEGATIVE_FAIL an http target was not rejected outright");
}

rmSync(certificateDirectory, { recursive: true, force: true });

if (failures > 0) process.exit(1);
const rejections = CASES.filter((testCase) => testCase.expect === "FAIL").length;
const incomplete = CASES.filter((testCase) => testCase.expect === "INCOMPLETE").length;
console.log(
  `ACCEPTANCE_NEGATIVE_PASS rejections=${rejections} incomplete=${incomplete} acceptances=1 cleartextRejected=1`,
);
