import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { toBase64Url } from "../lib/owner-pin.ts";

// The verifier exists to catch activation mistakes before a deploy, and it reads
// real Production secrets to do it. Two things therefore have to hold: it names
// the actual mistake, and it never prints the value it was given.

const SCRIPT = fileURLToPath(new URL("../scripts/verify-production-env.mjs", import.meta.url));

const PUBLISHABLE = `sb_publishable_${"p".repeat(24)}`;
const SECRET = `sb_secret_${"s".repeat(24)}`;
const TURNSTILE_SITE = `0x${"A".repeat(22)}`;
const TURNSTILE_SECRET = `0x${"B".repeat(22)}`;

const VALID = {
  APP_ORIGIN: "https://app.natheegroup2025.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://exampleref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  SUPABASE_SECRET_KEY: SECRET,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_SITE,
  TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
};

const OWNER_PIN_CREDENTIAL = `v1$pbkdf2-sha256$210000$${toBase64Url(new Uint8Array(32).fill(3))}$${toBase64Url(new Uint8Array(32).fill(4))}`;
const OWNER_PIN_V2_CREDENTIAL = `v2$pbkdf2-sha256-composite210k$${toBase64Url(new Uint8Array(32).fill(1))}$${toBase64Url(new Uint8Array(32).fill(2))}$${toBase64Url(new Uint8Array(32).fill(3))}$${toBase64Url(new Uint8Array(32).fill(4))}`;
const OWNER_SESSION_SECRET = toBase64Url(new Uint8Array(32).fill(5));

const OWNER_PIN_ONLY = {
  APP_ORIGIN: "https://app.natheegroup2025.com",
  OWNER_PIN_CREDENTIAL,
  OWNER_SESSION_SECRET,
};

const MANAGED = [
  "APP_ORIGIN",
  "OWNER_PIN_CREDENTIAL",
  "OWNER_SESSION_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
];

function run(overrides = {}) {
  const env = { ...process.env };
  for (const name of MANAGED) delete env[name];
  for (const [name, value] of Object.entries(overrides)) {
    if (value !== undefined) env[name] = value;
  }
  const result = spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("a complete, well-formed environment passes", () => {
  const { status, output } = run(VALID);
  assert.equal(status, 0, output);
  assert.match(output, /PRODUCTION_ENV_VERIFY_PASS/);
  assert.match(output, /shapeOnly=true providerNotContacted=true/);
});

test("no secret the verifier was given is ever printed", () => {
  const outputs = [
    run(VALID).output,
    run({}).output,
    run({ ...VALID, SUPABASE_SECRET_KEY: PUBLISHABLE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SECRET }).output,
    run({ ...VALID, TURNSTILE_SECRET_KEY: "0xnot-a-key" }).output,
  ];
  for (const output of outputs) {
    for (const secret of [SECRET, PUBLISHABLE, TURNSTILE_SITE, TURNSTILE_SECRET]) {
      assert.ok(!output.includes(secret), `the verifier printed a supplied value: ${output}`);
    }
  }
});

test("an empty environment fails and names every missing value", () => {
  const { status, output } = run({});
  assert.equal(status, 1);
  assert.match(output, /PRODUCTION_ENV_VERIFY_FAIL/);
  for (const name of ["APP_ORIGIN", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
    assert.match(output, new RegExp(`FAIL ${name}`));
  }
});

test("a secret key pasted into the public slot is called out as an exposure", () => {
  const { status, output } = run({ ...VALID, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SECRET });
  assert.equal(status, 1);
  assert.match(output, /FAIL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: holds a SECRET key/);
  assert.match(output, /Rotate it now/);
});

test("swapped keys are reported as swapped, not as a broken URL", () => {
  const { status, output } = run({
    ...VALID,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SECRET,
    SUPABASE_SECRET_KEY: PUBLISHABLE,
  });
  assert.equal(status, 1);
  assert.match(output, /OK {3}NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(output, /FAIL SUPABASE_SECRET_KEY: holds the publishable key/);
});

test("a non-Production application origin is refused", () => {
  for (const origin of [
    "http://natheegroup2025.com",
    "https://app.natheegroup2025.com/app",
    "https://attacker.invalid",
    "http://localhost:3000",
  ]) {
    const { status, output } = run({ ...VALID, APP_ORIGIN: origin });
    assert.equal(status, 1, origin);
    assert.match(output, /FAIL APP_ORIGIN/, origin);
  }
});

test("the dashboard values the Owner must mirror are derived, not typed", () => {
  const { output } = run(VALID);
  assert.match(output, /Site URL: {10}https:\/\/app\.natheegroup2025\.com$/m);
  assert.match(output, /Redirect URL: {6}https:\/\/app\.natheegroup2025\.com\/auth\/callback$/m);
  assert.match(output, /Recovery lands on: https:\/\/app\.natheegroup2025\.com\/auth\/callback\?next=%2Freset-password/);
});

test("the public website is refused as the application origin, and said so by name", () => {
  // The single most plausible wrong value: the application must not share an
  // origin with a document root Lane A deploys to by file copy.
  for (const apex of ["https://natheegroup2025.com", "https://natheegroup2025.com/"]) {
    const { status, output } = run({ ...VALID, APP_ORIGIN: apex });
    assert.equal(status, 1, apex);
    assert.match(output, /FAIL APP_ORIGIN: set to the public website/, apex);
    assert.match(output, /The application has its own origin: https:\/\/app\.natheegroup2025\.com/, apex);
  }
});

test("a www or bare host is not quietly accepted as the application", () => {
  for (const origin of ["https://www.natheegroup2025.com", "https://app.natheegroup2025.com:8443", "https://natheegroup2025.com.attacker.invalid"]) {
    const { status } = run({ ...VALID, APP_ORIGIN: origin });
    assert.equal(status, 1, origin);
  }
});

test("missing anti-abuse keys warn without blocking activation", () => {
  const { status, output } = run({
    ...VALID,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined,
    TURNSTILE_SECRET_KEY: undefined,
  });
  assert.equal(status, 0);
  assert.match(output, /WARN TURNSTILE/);
  assert.match(output, /warnings=1/);
});

test("one anti-abuse key without the other is a warning, not a silent pass", () => {
  const { status, output } = run({ ...VALID, TURNSTILE_SECRET_KEY: undefined });
  assert.equal(status, 0);
  assert.match(output, /WARN TURNSTILE: one or both keys/);
});

test("the verifier makes no claim about the provider accepting the credentials", () => {
  const { output } = run(VALID);
  assert.match(output, /providerNotContacted=true/);
  assert.ok(!/verified with supabase/i.test(output));
});

test("the artifact's runtime bindings are checked before anything is deployed", () => {
  const { output } = run(VALID);
  assert.match(output, /OK {3}RUNTIME_BINDINGS: artifact declares D1 'DB' and private R2 'FILES'/);
});

test("a secret shipped to browsers is the mistake that cannot be walked back", () => {
  const exposures = [
    ["NEXT_PUBLIC_SUPABASE_SERVICE_KEY", "eyJhbGciOiJIUzI1NiJ9.payload.signature", /service-role token/],
    ["NEXT_PUBLIC_SUPABASE_ADMIN", `sb_secret_${"z".repeat(24)}`, /Supabase secret key/],
    ["NEXT_PUBLIC_PROVIDER_KEY", "sk-abcdefghijklmnopqrstuvwx", /provider secret key/],
    ["NEXT_PUBLIC_SIGNING_KEY", "-----BEGIN RSA PRIVATE KEY-----abc", /private key/],
  ];
  for (const [name, value, described] of exposures) {
    const { status, output } = run({ ...VALID, [name]: value });
    assert.equal(status, 1, name);
    assert.match(output, /FAIL BROWSER_EXPOSED_SECRETS/, name);
    assert.match(output, described, name);
    assert.match(output, /cannot be recalled/, name);
    // The value itself is still never printed.
    assert.ok(!output.includes(value), `the verifier printed ${name}`);
  }
});

test("an ordinary public value is not mistaken for a secret", () => {
  const { status } = run({
    ...VALID,
    NEXT_PUBLIC_SITE_NAME: "NATHEE GROUP 2025",
    NEXT_PUBLIC_ANALYTICS_ID: "G-ABC123",
  });
  assert.equal(status, 0);
});

test("a value pasted with a trailing carriage return is accepted, as the runtime accepts it", () => {
  // Copying from a CRLF file or a Windows terminal appends \r. The verifier and
  // the runtime both trim, so the verifier must not report a failure the runtime
  // would not have — that would send the Owner hunting a problem that is not
  // there.
  const carriage = String.fromCharCode(13);
  const withCr = Object.fromEntries(Object.entries(VALID).map(([name, value]) => [name, `${value}${carriage}`]));
  const { status, output } = run(withCr);
  assert.equal(status, 0, output);
  assert.match(output, /PRODUCTION_ENV_VERIFY_PASS/);
  // And the printed dashboard values carry no stray carriage return.
  assert.match(output, /Redirect URL: {6}https:\/\/app\.natheegroup2025\.com\/auth\/callback$/m);
});

test("leading whitespace is trimmed too, and an internal space is still refused", () => {
  assert.equal(run({ ...VALID, APP_ORIGIN: "  https://app.natheegroup2025.com  " }).status, 0);
  assert.equal(run({ ...VALID, APP_ORIGIN: "https://app .natheegroup2025.com" }).status, 1);
});

// --- Owner CMS PIN mode -----------------------------------------------------
// The Owner reaches the website editor with a PIN and no identity provider at
// all. Activation therefore has to accept a deployment that is complete for the
// mode it is actually in, without ever reporting the absent mode as ready.

test("the Owner PIN alone satisfies activation, and Supabase becomes a warning rather than a block", () => {
  const { status, output } = run(OWNER_PIN_ONLY);
  assert.equal(status, 0, output);
  assert.match(output, /PRODUCTION_ENV_VERIFY_PASS/);
  assert.match(output, /authMode=owner-pin$/m);
  assert.match(output, /OK {3}OWNER_PIN_CREDENTIAL: pbkdf2-sha256, 210000 iterations, 32-byte salt/);
  assert.match(output, /OK {3}OWNER_SESSION_SECRET: session signing key shape/);
  assert.match(output, /OK {3}AUTH_MODE: owner-pin/);
  // Absent, and said so as a warning. Never reported as ready.
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
    assert.match(output, new RegExp(`WARN ${name}: not set`), name);
    assert.ok(!new RegExp(`OK {3}${name}`).test(output), `${name} was claimed ready while absent`);
  }
  // And no provider dashboard instructions for a provider that is not in use.
  assert.ok(!/Supabase Auth dashboard/.test(output));
});

test("the v2 composite Owner PIN credential satisfies activation without exposing its fields", () => {
  const { status, output } = run({ ...OWNER_PIN_ONLY, OWNER_PIN_CREDENTIAL: OWNER_PIN_V2_CREDENTIAL });
  assert.equal(status, 0, output);
  assert.match(output, /PRODUCTION_ENV_VERIFY_PASS/);
  assert.match(output, /OK {3}OWNER_PIN_CREDENTIAL: pbkdf2-sha256-composite210k, 210000 total iterations, three salted segments/);
  assert.ok(!output.includes(OWNER_PIN_V2_CREDENTIAL));
});

test("both modes configured is reported as both, and neither is inferred from the other", () => {
  const { status, output } = run({ ...VALID, OWNER_PIN_CREDENTIAL, OWNER_SESSION_SECRET });
  assert.equal(status, 0, output);
  assert.match(output, /authMode=owner-pin\+supabase$/m);
  assert.match(output, /OK {3}SUPABASE_PUBLIC_CONFIG/);
  assert.match(output, /OK {3}OWNER_PIN_CREDENTIAL/);
  assert.match(output, /Supabase Auth dashboard/);
});

test("a runtime with no complete mode is refused and told which two to choose from", () => {
  const { status, output } = run({ APP_ORIGIN: "https://app.natheegroup2025.com" });
  assert.equal(status, 1);
  assert.match(output, /FAIL AUTH_MODE: no complete authentication mode/);
  assert.match(output, /npm run owner:pin/);
  assert.match(output, /authMode=none/);
  assert.match(output, /FAIL OWNER_PIN_CREDENTIAL/);
  assert.match(output, /FAIL NEXT_PUBLIC_SUPABASE_URL/);
});

test("half an Owner PIN mode is refused, and named as half", () => {
  for (const half of [
    { APP_ORIGIN: OWNER_PIN_ONLY.APP_ORIGIN, OWNER_PIN_CREDENTIAL },
    { APP_ORIGIN: OWNER_PIN_ONLY.APP_ORIGIN, OWNER_SESSION_SECRET },
  ]) {
    const { status, output } = run(half);
    assert.equal(status, 1, JSON.stringify(Object.keys(half)));
    assert.match(output, /FAIL OWNER_PIN_PAIR: only one of OWNER_PIN_CREDENTIAL and OWNER_SESSION_SECRET is set/);
    assert.match(output, /authMode=none/);
  }
});

test("a malformed Owner PIN value is named, and never treated as a weaker credential", () => {
  const weak = `v1$pbkdf2-sha256$1000$${toBase64Url(new Uint8Array(32).fill(3))}$${toBase64Url(new Uint8Array(32).fill(4))}`;
  const { status, output } = run({ ...OWNER_PIN_ONLY, OWNER_PIN_CREDENTIAL: weak });
  assert.equal(status, 1);
  assert.match(output, /FAIL OWNER_PIN_CREDENTIAL: rejected; expected a supported v1 PBKDF2 credential or v2 pbkdf2-sha256-composite210k credential/);

  const shortSecret = run({ ...OWNER_PIN_ONLY, OWNER_SESSION_SECRET: "too-short" });
  assert.equal(shortSecret.status, 1);
  assert.match(shortSecret.output, /FAIL OWNER_SESSION_SECRET: rejected; expected at least 43 base64url characters/);
});

test("an unusable Owner PIN value does not block a deployment that runs on Supabase", () => {
  const { status, output } = run({ ...VALID, OWNER_PIN_CREDENTIAL: "nonsense", OWNER_SESSION_SECRET });
  assert.equal(status, 0, output);
  assert.match(output, /WARN OWNER_PIN_CREDENTIAL: rejected/);
  assert.match(output, /authMode=supabase$/m);
});

test("neither Owner PIN value the verifier was given is ever printed", () => {
  const outputs = [
    run(OWNER_PIN_ONLY).output,
    run({ ...OWNER_PIN_ONLY, OWNER_SESSION_SECRET: "too-short" }).output,
    run({ ...VALID, OWNER_PIN_CREDENTIAL, OWNER_SESSION_SECRET }).output,
  ];
  for (const output of outputs) {
    assert.ok(!output.includes(OWNER_PIN_CREDENTIAL), "the verifier printed the PIN credential");
    assert.ok(!output.includes(OWNER_SESSION_SECRET), "the verifier printed the session secret");
  }
});
