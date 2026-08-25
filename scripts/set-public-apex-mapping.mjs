#!/usr/bin/env node
// Switches the apex proxy for the application's two public surfaces —
// /assets/media/ and /sitemap.xml — by rewriting one managed block in
// public-site/.htaccess.
//
// Activation is a release action, not an edit, and it is refused unless two
// facts have been proven on the real host: mod_proxy is available, and the
// application is reachable. Proxying to a host that is not serving turns a
// working static site into a broken one, and a [P] rule without mod_proxy does
// not proxy at all.
//
// Usage:
//   node scripts/set-public-apex-mapping.mjs --print
//   node scripts/set-public-apex-mapping.mjs --state inactive
//   node scripts/set-public-apex-mapping.mjs --state active --evidence <file> --proxy-evidence <file>
//   node scripts/set-public-apex-mapping.mjs --state inactive --file <path-to-.htaccess>

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APEX_MAPPING_BEGIN,
  APEX_MAPPING_END,
  APEX_MAPPING_TARGET,
  parseApexMappingState,
  renderApexMappingBlock,
} from "../lib/public-apex-mapping.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultHtaccessPath = join(repositoryRoot, "public-site", ".htaccess");

/** Written by scripts/verify-app-integration.sh once the application answered. */
const REQUIRED_APP_TOKEN = "APP_INTEGRATION_GATE_PASS";
/** Written by scripts/probe-zcom-runtime.sh only when mod_proxy is really there. */
const REQUIRED_PROXY_TOKEN = "ZCOM_MOD_PROXY=AVAILABLE";

const USAGE = `Usage:
  node scripts/set-public-apex-mapping.mjs --print
  node scripts/set-public-apex-mapping.mjs --state inactive
  node scripts/set-public-apex-mapping.mjs --state active --evidence <app-gate-output> --proxy-evidence <zcom-probe-output>

Activation requires both:
  ${REQUIRED_APP_TOKEN}   from scripts/verify-app-integration.sh
  ${REQUIRED_PROXY_TOKEN}  from scripts/probe-zcom-runtime.sh, run on the web host
`;

function fail(message) {
  process.stderr.write(`PUBLIC_APEX_MAPPING_FAIL: ${message}\n\n${USAGE}`);
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

async function requireToken(path, token, what) {
  if (!path) fail(`activation requires ${what}`);
  let evidence = "";
  try {
    evidence = await readFile(resolve(path), "utf8");
  } catch {
    fail(`could not read the evidence file: ${path}`);
  }
  if (!evidence.includes(token)) {
    fail(`the evidence file does not contain ${token}; that fact is not proven`);
  }
}

const args = parseArguments(process.argv.slice(2));
for (const key of args.keys()) {
  if (!["state", "evidence", "proxy-evidence", "print", "file"].includes(key)) fail(`unknown argument: --${key}`);
}

const htaccessPath = args.get("file") ? resolve(args.get("file")) : defaultHtaccessPath;
const original = await readFile(htaccessPath, "utf8");
if (parseApexMappingState(original) === "MISSING") {
  fail(`the managed apex-mapping block is missing from ${htaccessPath}`);
}

if (args.has("print")) {
  process.stdout.write(
    `PUBLIC_APEX_MAPPING_STATE=${parseApexMappingState(original)} target=${APEX_MAPPING_TARGET}\n`,
  );
  process.exit(0);
}

const requested = (args.get("state") ?? "").trim().toLowerCase();
if (!["active", "inactive"].includes(requested)) fail("--state must be active or inactive");

if (requested === "active") {
  await requireToken(args.get("evidence"), REQUIRED_APP_TOKEN, "--evidence from scripts/verify-app-integration.sh");
  await requireToken(
    args.get("proxy-evidence"),
    REQUIRED_PROXY_TOKEN,
    "--proxy-evidence from scripts/probe-zcom-runtime.sh run on the web host",
  );
}

const beginIndex = original.indexOf(APEX_MAPPING_BEGIN);
const endIndex = original.indexOf(APEX_MAPPING_END);
const replacement = renderApexMappingBlock(requested === "active" ? "ACTIVE" : "INACTIVE");
const updated = `${original.slice(0, beginIndex)}${replacement}${original.slice(endIndex + APEX_MAPPING_END.length)}`;

if (updated === original) {
  process.stdout.write(`PUBLIC_APEX_MAPPING_UNCHANGED state=${requested.toUpperCase()}\n`);
  process.exit(0);
}

await writeFile(htaccessPath, updated.replaceAll("\r\n", "\n"), "utf8");
process.stdout.write(
  `PUBLIC_APEX_MAPPING_SET state=${requested.toUpperCase()} target=${APEX_MAPPING_TARGET} file=public-site/.htaccess\n`,
);
process.stdout.write("Redeploy through the guarded Z.com flow for this to take effect.\n");
