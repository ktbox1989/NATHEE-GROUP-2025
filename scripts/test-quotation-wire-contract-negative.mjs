import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A gate is only worth its runtime if it rejects the thing it exists for. Each
// case below is a drift between the public form and the endpoint that stores
// the enquiry — and each one is drawn from a mismatch that was actually present
// in this repository before the contract was reconciled, or is one line away
// from being reintroduced.
//
// What they have in common is that none of them is visible to the customer. The
// form submits, the server answers, and the enquiry is lost or truncated with
// no error anywhere.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-quotation-wire-contract.mjs");

const TRACKED_TREES = ["app", "lib"];

const CLIENT = "lib/public-forms/quotation-contract.ts";
const PARSER = "lib/quotation.ts";
const ROUTE = "app/api/quotation/route.ts";

const CASES = [
  {
    // The defect this gate was written for: 32 bare hex characters, refused by
    // the server as `invalid` before reaching D1.
    name: "the request key goes back to a format the server refuses",
    apply: (directory) =>
      edit(directory, CLIENT, (source) =>
        source.replace(
          "return `quote-${crypto.randomUUID()}`;",
          'return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");',
        ),
      ),
  },
  {
    name: "the request key loses the prefix the Turnstile idempotency key is sliced from",
    apply: (directory) =>
      edit(directory, CLIENT, (source) =>
        source.replace("return `quote-${crypto.randomUUID()}`;", "return crypto.randomUUID();"),
      ),
  },
  {
    name: "the client's own key predicate becomes looser than the server's",
    apply: (directory) =>
      edit(directory, CLIENT, (source) =>
        source.replace("return WIRE_REQUEST_KEY.test(value);", "return value.length > 0;"),
      ),
  },
  {
    name: "a field the server reads stops being sent",
    apply: (directory) =>
      edit(directory, CLIENT, (source) => source.replace(/^\s*form\.set\("lineId".*$/m, "")),
    },
  {
    name: "a field is sent under a name the server never reads, so it is discarded",
    apply: (directory) =>
      edit(directory, CLIENT, (source) => source.replace('form.set("notes"', 'form.set("details"')),
  },
  {
    name: "the honeypot stops being sent, so the form cannot prove it was rendered",
    apply: (directory) => edit(directory, CLIENT, (source) => source.replace('form.set("website", "");', "")),
  },
  {
    name: "consent is sent as a boolean instead of the literal the server compares",
    apply: (directory) =>
      edit(directory, CLIENT, (source) =>
        source.replace('form.set("privacyConsent", draft.consent ? "yes" : "no");', 'form.set("privacyConsent", String(draft.consent));'),
      ),
  },
  {
    // The server calls slice(), so this is silent truncation rather than an
    // error: the end of the customer's message simply never arrives.
    name: "a text bound drifts looser than the server's and the tail is silently cut",
    apply: (directory) =>
      edit(directory, CLIENT, (source) => source.replace("notes: Object.freeze({ max: 1500 })", "notes: Object.freeze({ max: 2000 })")),
  },
  {
    name: "the quantity bound drifts tighter and refuses an enquiry the server accepts",
    apply: (directory) =>
      edit(directory, CLIENT, (source) =>
        source.replace("quantity: Object.freeze({ min: 1, max: 10_000 })", "quantity: Object.freeze({ min: 1, max: 500 })"),
      ),
  },
  {
    name: "the form offers a vehicle type the server rejects",
    apply: (directory) =>
      edit(directory, CLIENT, (source) =>
        source.replace(
          'export const QUOTATION_VEHICLE_TYPES = ["MOTORCYCLE", "BIG_BIKE", "MIXED", "OTHER"] as const;',
          'export const QUOTATION_VEHICLE_TYPES = ["MOTORCYCLE", "BIG_BIKE", "MIXED", "OTHER", "SCOOTER"] as const;',
        ),
      ),
  },
  {
    name: "the form offers a service extra the server rejects",
    apply: (directory) =>
      edit(directory, CLIENT, (source) =>
        source.replace(
          'export const QUOTATION_EXTRAS = ["STORAGE", "CONTAINER", "INTERNATIONAL", "LARGE_BATCH"] as const;',
          'export const QUOTATION_EXTRAS = ["STORAGE", "CONTAINER", "INTERNATIONAL", "LARGE_BATCH", "EXPRESS"] as const;',
        ),
      ),
  },
  {
    name: "the server gains a failure code the form has no answer for",
    apply: (directory) =>
      edit(directory, ROUTE, (source) =>
        source.replace('return redirect(request, "error", "challenge");', 'return redirect(request, "error", "blocked");'),
      ),
  },
  {
    // The whole point of the module: a customer told their enquiry was received
    // when it was not will simply wait.
    name: "a bare 200 with no redirect starts counting as success",
    apply: (directory) =>
      edit(directory, CLIENT, (source) =>
        source.replace(
          "  const submitted = url?.searchParams.get(\"submitted\");",
          "  const submitted = url?.searchParams.get(\"submitted\") ?? \"QT-2026-000001\";",
        ),
      ),
  },
  {
    name: "any reference shape starts counting as a request number",
    apply: (directory) =>
      edit(directory, CLIENT, (source) => source.replace("return REFERENCE_NUMBER.test(value);", "return value.length > 0;")),
  },
  {
    name: "a failure code alongside a reference stops winning",
    apply: (directory) =>
      edit(directory, CLIENT, (source) => source.replace("  if (serverError) {", "  if (false) {")),
  },
  {
    name: "the endpoint stops restricting the origin, moving where the form may live",
    apply: (directory) =>
      edit(directory, ROUTE, (source) =>
        source.replace('if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });', ""),
      ),
  },
  {
    name: "the server's request-key rule changes and the form is not updated",
    apply: (directory) =>
      edit(directory, PARSER, (source) =>
        source.replace("/^quote-[0-9a-f]{8}-", "/^quotation-[0-9a-f]{8}-"),
      ),
  },
  {
    name: "the server tightens a bound and the form keeps sending more",
    apply: (directory) =>
      edit(directory, PARSER, (source) => source.replace('optional(form.get("notes"), 1500)', 'optional(form.get("notes"), 800)')),
  },
];

function edit(directory, relativePath, transform) {
  const target = join(directory, relativePath);
  // Normalise to LF first: every anchor below is written with "\n", and on a
  // CRLF checkout the replacement would silently become a no-op.
  const original = readFileSync(target, "utf8").split("\r\n").join("\n");
  const next = transform(original);
  if (next === original) throw new Error(`mutation changed nothing: ${relativePath}`);
  writeFileSync(target, next);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-quotation-wire-"));
  for (const tree of TRACKED_TREES) {
    cpSync(join(root, tree), join(directory, tree), { recursive: true });
  }
  mkdirSync(join(directory, "scripts"), { recursive: true });
  // This gate imports the modules rather than only reading them, so the copy
  // needs the module type or Node loads the .ts files as CommonJS and every
  // case fails for the wrong reason.
  writeFileSync(join(directory, "package.json"), '{ "type": "module" }\n');
  return directory;
}

function runGate(directory) {
  return spawnSync(process.execPath, [gate], {
    env: { ...process.env, QUOTATION_WIRE_CONTRACT_ROOT: directory },
    encoding: "utf8",
  });
}

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`QUOTATION_WIRE_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`QUOTATION_WIRE_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`QUOTATION_WIRE_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`QUOTATION_WIRE_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
