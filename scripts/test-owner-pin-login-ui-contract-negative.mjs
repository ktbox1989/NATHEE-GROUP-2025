import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A gate that cannot fail is worse than no gate, because it gets reported as
// evidence. Each case below is one specific way the Owner PIN login could stop
// being safe or honest, applied to a copy of the tree.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts/test-owner-pin-login-ui-contract.mjs");
const TRACKED_TREES = ["app", "lib"];

const PAGE = "app/login/page.tsx";
const LIB = "lib/owner-pin-login.ts";
const CSS = "app/globals.css";

const CASES = [
  {
    name: "the form posts to the password login route, which cannot read a PIN",
    apply: (d) => edit(d, PAGE, (s) => s.replace('action="/api/auth/owner-pin/login"', 'action="/api/auth/login"')),
  },
  {
    name: "the route moves behind a constant the header gate cannot read",
    apply: (d) => edit(d, PAGE, (s) => s.replace('action="/api/auth/owner-pin/login"', "action={OWNER_PIN_LOGIN_ACTION}")),
  },
  {
    name: "the constant and the page drift to two different routes",
    apply: (d) => edit(d, LIB, (s) => s.replace('OWNER_PIN_LOGIN_ACTION = "/api/auth/owner-pin/login"', 'OWNER_PIN_LOGIN_ACTION = "/api/auth/pin/login"')),
  },
  {
    name: "the PIN is posted under a field name the route does not read",
    apply: (d) => edit(d, PAGE, (s) => s.replace('name="pin"', 'name="ownerPin"')),
  },
  {
    name: "an editable email field is added back, so the browser nominates the account",
    apply: (d) => edit(d, PAGE, (s) => s.replace('<input type="hidden" name="returnTo"', '<input name="email" type="email" /><input type="hidden" name="returnTo"')),
  },
  {
    name: "the fixed Owner address is submitted as a hidden field",
    apply: (d) => edit(d, PAGE, (s) => s.replace('<input type="hidden" name="returnTo"', '<input type="hidden" name="email" value={OWNER_LOGIN_EMAIL} /><input type="hidden" name="returnTo"')),
  },
  {
    name: "the Owner address becomes an input the person at the keyboard can change",
    apply: (d) => edit(d, PAGE, (s) => s.replace("<strong className=\"owner-identity-value\">{OWNER_LOGIN_EMAIL}</strong>", '<input className="owner-identity-value" defaultValue={OWNER_LOGIN_EMAIL} />')),
  },
  {
    name: "the login page hardcodes its own copy of the Owner address",
    apply: (d) => edit(d, PAGE, (s) => s.replace("{OWNER_LOGIN_EMAIL}", "{\"kaikt143@gmail.com\"}")),
  },
  {
    name: "the shared constant is pointed at a different Owner",
    apply: (d) => edit(d, LIB, (s) => s.replace('OWNER_LOGIN_EMAIL = "kaikt143@gmail.com"', 'OWNER_LOGIN_EMAIL = "owner@natheegroup2025.com"')),
  },
  {
    name: "the PIN becomes a visible text field",
    apply: (d) => edit(d, PAGE, (s) => s.replace('type="password"', 'type="text"')),
  },
  {
    name: "the PIN loses its length bound, so a seventh character is accepted",
    apply: (d) => edit(d, PAGE, (s) => s.replace("maxLength={OWNER_PIN_LENGTH}", "")),
  },
  {
    name: "the PIN pattern widens to \\d, which admits Thai and Arabic-Indic digits",
    apply: (d) => edit(d, LIB, (s) => s.replace('OWNER_PIN_PATTERN = "[0-9]{6}"', 'OWNER_PIN_PATTERN = "\\\\d{6}"')),
  },
  {
    name: "the PIN length stops being six",
    apply: (d) => edit(d, LIB, (s) => s.replace("OWNER_PIN_LENGTH = 6", "OWNER_PIN_LENGTH = 4")),
  },
  {
    name: "a failed attempt puts the typed PIN back into the field",
    apply: (d) => edit(d, PAGE, (s) => s.replace('inputMode="numeric"', 'inputMode="numeric"\n              defaultValue={params.pin}')),
  },
  {
    name: "the PIN field loses the autofill hint a password manager needs",
    apply: (d) => edit(d, PAGE, (s) => s.replace('autoComplete="current-password"', 'autoComplete="off"')),
  },
  {
    name: "the raw returnTo from the URL is rendered into the form",
    apply: (d) => edit(d, PAGE, (s) => s.replace("value={returnTo}", "value={params.returnTo}")),
  },
  {
    name: "returnTo stops being sanitised at all",
    apply: (d) => edit(d, PAGE, (s) => s.replace("ownerLoginReturnTo(params.returnTo)", 'params.returnTo ?? "/app/website"')),
  },
  {
    name: "the direct-login destination moves away from the website workspace",
    apply: (d) => edit(d, LIB, (s) => s.replace('OWNER_PIN_DEFAULT_RETURN_TO = "/app/website"', 'OWNER_PIN_DEFAULT_RETURN_TO = "/app"')),
  },
  {
    name: "same-origin is decided by a second copy of the rules instead of safeReturnTo",
    apply: (d) => edit(d, LIB, (s) => s.replaceAll("safeReturnTo(", "localReturnTo(")),
  },
  {
    name: "the Supabase configuration gate comes back and locks the Owner out of their own CMS",
    apply: (d) => edit(d, PAGE, (s) => s.replace("const returnTo =", 'const configured = isSupabaseConfigured();\n  const returnTo =')),
  },
  {
    name: "the submit button is disabled again on a configuration check",
    apply: (d) => edit(d, PAGE, (s) => s.replace('className="button button-gradient login-submit" type="submit"', 'className="button button-gradient login-submit" type="submit" disabled={true}')),
  },
  {
    name: "a refusal loses its Thai message and renders as a blank card",
    apply: (d) => edit(d, LIB, (s) => s.replace("  unavailable:", "  unavailble:")),
  },
  {
    name: "the lockout message is dropped, so a locked-out Owner is told nothing",
    apply: (d) => edit(d, LIB, (s) => s.replace("  too_many_attempts:", "  tooManyAttempts:")),
  },
  {
    name: "a refusal is rendered in the success slot",
    apply: (d) => edit(d, PAGE, (s) => s.replace('{error && <div className="form-message error" role="alert">{error}</div>}', '{error && <div className="form-message success" role="alert">{error}</div>}')),
  },
  {
    name: "logging out stops being confirmed",
    apply: (d) => edit(d, LIB, (s) => s.replace("  logged_out:", "  loggedOut:")),
  },
  {
    name: "the sign-in screen becomes indexable",
    apply: (d) => edit(d, PAGE, (s) => s.replace("robots: { index: false, follow: false },", "")),
  },
  {
    name: "a PIN-shaped literal is committed into the login UI",
    apply: (d) => edit(d, LIB, (s) => s.replace("export const OWNER_PIN_LENGTH = 6;", "export const OWNER_PIN_LENGTH = 6;\nexport const FALLBACK_PIN = \"481902\";")),
  },
  {
    name: "the login UI starts reading a PIN out of the environment",
    apply: (d) => edit(d, LIB, (s) => s.replace("export const OWNER_PIN_LENGTH = 6;", "export const OWNER_PIN_LENGTH = 6;\nexport const configuredPin = process.env.OWNER_PIN;")),
  },
  {
    name: "password recovery is offered as the Owner's path again",
    apply: (d) => edit(d, PAGE, (s) => s.replace('<Link href="/">← กลับหน้าแรก</Link>', '<Link href="/forgot-password">ลืมรหัสผ่าน?</Link>')),
  },
  {
    name: "the PIN field loses its label association",
    apply: (d) => edit(d, PAGE, (s) => s.replace('htmlFor="pin"', 'className="pin-label"')),
  },
  {
    name: "the PIN rule stops being announced with the field",
    apply: (d) => edit(d, PAGE, (s) => s.replace('aria-describedby="pin-hint"', "")),
  },
  {
    name: "a refused PIN stops being marked on the field itself",
    apply: (d) => edit(d, PAGE, (s) => s.replace("aria-invalid={pinRejected || undefined}", "")),
  },
  {
    name: "the PIN field keeps its desktop tracking at 320px and overflows the card",
    apply: (d) => edit(d, CSS, (s) => s.replace("  .owner-pin-input { font-size: 18px;", "  .owner-pin-input-wide { font-size: 18px;")),
  },
  {
    name: "a long Owner address stops wrapping and widens the card",
    apply: (d) => edit(d, CSS, (s) => s.replace(".owner-identity-value { min-width: 0; overflow-wrap: anywhere;", ".owner-identity-value { white-space: nowrap;")),
  },
];

function edit(directory, file, transform) {
  const path = join(directory, file);
  // Normalise to LF first: .ts and .tsx are unpinned in .gitattributes, so on a
  // Windows checkout every anchor written with "\n" would match nothing and each
  // case would become a silent no-op.
  const before = readFileSync(path, "utf8").split("\r\n").join("\n");
  const after = transform(before);
  if (after === before) throw new Error(`the edit to ${file} changed nothing, so the case proves nothing`);
  writeFileSync(path, after);
}

function makeCopy() {
  const directory = mkdtempSync(join(tmpdir(), "nathee-owner-pin-ui-"));
  for (const tree of TRACKED_TREES) cpSync(join(root, tree), join(directory, tree), { recursive: true });
  return directory;
}

const runGate = (directory) =>
  spawnSync(process.execPath, [gate], { env: { ...process.env, OWNER_PIN_UI_ROOT: directory }, encoding: "utf8" });

let failures = 0;

const clean = makeCopy();
const cleanResult = runGate(clean);
if (cleanResult.status !== 0) {
  failures += 1;
  console.error(`OWNER_PIN_UI_NEGATIVE_FAIL unmodified tree was rejected\n${cleanResult.stderr}`);
}
rmSync(clean, { recursive: true, force: true });

for (const testCase of CASES) {
  const directory = makeCopy();
  try {
    testCase.apply(directory);
    if (runGate(directory).status === 0) {
      failures += 1;
      console.error(`OWNER_PIN_UI_NEGATIVE_FAIL gate accepted: ${testCase.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`OWNER_PIN_UI_NEGATIVE_FAIL case failed to run: ${testCase.name}: ${error}`);
  }
  rmSync(directory, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log(`OWNER_PIN_UI_NEGATIVE_PASS rejections=${CASES.length} acceptances=1`);
