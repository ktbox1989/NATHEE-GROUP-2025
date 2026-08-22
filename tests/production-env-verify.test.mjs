import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

const MANAGED = [
  "APP_ORIGIN",
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
