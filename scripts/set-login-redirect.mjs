#!/usr/bin/env node
// Switches the public /login/ entry point between the local placeholder page
// and the application runtime, by rewriting one managed block in
// public-site/.htaccess.
//
// Activation is a release action, not an edit: the Owner runs this, redeploys
// through the existing guarded Z.com flow, and can reverse it the same way.
// It refuses to activate unless the application has been proven reachable,
// because a redirect to a runtime that is not live takes the login entry point
// off the air.
//
// Usage:
//   node scripts/set-login-redirect.mjs --state inactive
//   node scripts/set-login-redirect.mjs --state active --evidence <file>
//   node scripts/set-login-redirect.mjs --print
//   node scripts/set-login-redirect.mjs --state inactive --file <path-to-.htaccess>

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultHtaccessPath = join(repositoryRoot, "public-site", ".htaccess");

const BEGIN = "# BEGIN NATHEE LOGIN REDIRECT";
const END = "# END NATHEE LOGIN REDIRECT";

// The one host the public login entry point may hand off to.
const APP_LOGIN_URL = "https://app.natheegroup2025.com/login";
const PUBLIC_HOST = "natheegroup2025.com";

// The integration gate writes this token only after every application check
// passed. Activation without it would be a guess.
const REQUIRED_EVIDENCE_TOKEN = "APP_INTEGRATION_GATE_PASS";

const USAGE = `Usage:
  node scripts/set-login-redirect.mjs --state inactive
  node scripts/set-login-redirect.mjs --state active --evidence <gate-output-file>
  node scripts/set-login-redirect.mjs --print

Activation additionally requires that scripts/verify-app-integration.sh passed
and that its output was saved to the file given to --evidence.
`;

function fail(message) {
  process.stderr.write(`LOGIN_REDIRECT_FAIL: ${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseArguments(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "print") {
      parsed.set(key, "true");
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for --${key}`);
    parsed.set(key, value);
    index += 1;
  }
  return parsed;
}

function inactiveBlock() {
  return [
    BEGIN,
    "# NATHEE_LOGIN_REDIRECT_STATE=INACTIVE",
    `# NATHEE_LOGIN_REDIRECT_TARGET=${APP_LOGIN_URL}`,
    "#",
    "# The public /login/ page is served from this site while the application",
    "# runtime is not accepted. Managed by scripts/set-login-redirect.mjs;",
    "# do not edit by hand.",
    END,
  ].join("\n");
}

function activeBlock() {
  return [
    BEGIN,
    "# NATHEE_LOGIN_REDIRECT_STATE=ACTIVE",
    `# NATHEE_LOGIN_REDIRECT_TARGET=${APP_LOGIN_URL}`,
    "#",
    "# Managed by scripts/set-login-redirect.mjs; do not edit by hand.",
    "<IfModule mod_rewrite.c>",
    "  RewriteEngine On",
    "",
    "  # Only the canonical apex hands off. Without this the rule would loop if",
    `  # the application host were ever pointed at this same document root.`,
    `  RewriteCond %{HTTP_HOST} ^${PUBLIC_HOST.replaceAll(".", "\\\\.")}$ [NC]`,
    "  # 302, never 301. Activation must stay reversible: a permanent redirect",
    "  # is cached by browsers and cannot be withdrawn if the application is",
    "  # rolled back. QSA keeps returnTo and error; NE avoids double-encoding.",
    `  RewriteRule ^login/?$ ${APP_LOGIN_URL} [R=302,L,QSA,NE]`,
    "</IfModule>",
    END,
  ].join("\n");
}

const args = parseArguments(process.argv.slice(2));
for (const key of args.keys()) {
  if (!["state", "evidence", "print", "file"].includes(key)) fail(`unknown argument: --${key}`);
}

// --file lets the regression tests exercise both states against a copy of the
// release, so testing never rewrites the real one.
const htaccessPath = args.get("file") ? resolve(args.get("file")) : defaultHtaccessPath;

const original = await readFile(htaccessPath, "utf8");
const beginIndex = original.indexOf(BEGIN);
const endIndex = original.indexOf(END);
if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
  fail(`the managed login-redirect block is missing from ${htaccessPath}`);
}

if (args.has("print")) {
  const state = original.match(/^# NATHEE_LOGIN_REDIRECT_STATE=([A-Z]+)/m)?.[1] ?? "MISSING";
  process.stdout.write(`LOGIN_REDIRECT_STATE=${state} target=${APP_LOGIN_URL}\n`);
  process.exit(0);
}

const requested = (args.get("state") ?? "").trim().toLowerCase();
if (!["active", "inactive"].includes(requested)) fail("--state must be active or inactive");

if (requested === "active") {
  const evidencePath = args.get("evidence");
  if (!evidencePath) fail("activation requires --evidence from scripts/verify-app-integration.sh");
  let evidence = "";
  try {
    evidence = await readFile(evidencePath, "utf8");
  } catch {
    fail(`could not read the integration gate evidence: ${evidencePath}`);
  }
  if (!evidence.includes(REQUIRED_EVIDENCE_TOKEN)) {
    fail(`the evidence file does not contain ${REQUIRED_EVIDENCE_TOKEN}; the application is not proven ready`);
  }
}

const replacement = requested === "active" ? activeBlock() : inactiveBlock();
const updated = `${original.slice(0, beginIndex)}${replacement}${original.slice(endIndex + END.length)}`;

if (updated === original) {
  process.stdout.write(`LOGIN_REDIRECT_UNCHANGED state=${requested.toUpperCase()}\n`);
  process.exit(0);
}

await writeFile(htaccessPath, updated.replaceAll("\r\n", "\n"), "utf8");
process.stdout.write(
  `LOGIN_REDIRECT_SET state=${requested.toUpperCase()} target=${APP_LOGIN_URL} file=public-site/.htaccess\n`,
);
process.stdout.write("Redeploy through the guarded Z.com flow for this to take effect.\n");
