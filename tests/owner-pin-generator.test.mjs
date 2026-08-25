import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  parseOwnerPinAuthConfig,
  parseOwnerPinCredential,
  parseOwnerSessionSecret,
  verifyOwnerPin,
} from "../lib/owner-pin.ts";

// The generator is the only place a human PIN is ever typed. Two things have to
// hold, and neither is provable by reading it once: what it produces is what the
// runtime accepts, and the PIN itself appears nowhere in what it produces.

const SCRIPT = fileURLToPath(new URL("../scripts/generate-owner-pin-credential.mjs", import.meta.url));
const PIN = "046913";

function run(input, args = []) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function assignments(stdout) {
  return Object.fromEntries(
    stdout
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
  );
}

test("a confirmed PIN produces a credential the runtime accepts and a usable session secret", async () => {
  const { status, stdout, stderr } = run(`${PIN}\n${PIN}\n`);
  assert.equal(status, 0, stderr);

  const values = assignments(stdout);
  assert.deepEqual(Object.keys(values).sort(), ["OWNER_PIN_CREDENTIAL", "OWNER_SESSION_SECRET"]);

  const credential = parseOwnerPinCredential(values.OWNER_PIN_CREDENTIAL);
  assert.ok(credential);
  assert.equal(credential.iterations, DEFAULT_PBKDF2_ITERATIONS);
  assert.equal(credential.salt.length, 32);
  assert.equal(credential.hash.length, 32);
  assert.equal(parseOwnerSessionSecret(values.OWNER_SESSION_SECRET), values.OWNER_SESSION_SECRET);
  // The pair is exactly what `getOwnerPinAuthConfig` would load.
  assert.ok(parseOwnerPinAuthConfig(values.OWNER_PIN_CREDENTIAL, values.OWNER_SESSION_SECRET));

  assert.equal(await verifyOwnerPin(PIN, values.OWNER_PIN_CREDENTIAL), true);
  assert.equal(await verifyOwnerPin("046912", values.OWNER_PIN_CREDENTIAL), false);

  assert.match(stderr, /OWNER_PIN_CREDENTIAL_READY .*pinPrinted=no filesWritten=none/);
});

test("the PIN is never printed, in success or in any failure", () => {
  const runs = [
    run(`${PIN}\n${PIN}\n`),
    run(`${PIN}\n046914\n`),
    run(`${PIN}\n`),
    run("12345\n12345\n"),
    run(`${PIN}\n${PIN}\n`, ["--iterations", "1"]),
  ];
  for (const { stdout, stderr } of runs) {
    assert.ok(!stdout.includes(PIN), `stdout carried the PIN: ${stdout}`);
    assert.ok(!stderr.includes(PIN), `stderr carried the PIN: ${stderr}`);
  }
});

test("two different runs of the same PIN produce different credentials", () => {
  const first = assignments(run(`${PIN}\n${PIN}\n`).stdout);
  const second = assignments(run(`${PIN}\n${PIN}\n`).stdout);
  // A shared salt would make one leaked hash usable against the other.
  assert.notEqual(first.OWNER_PIN_CREDENTIAL, second.OWNER_PIN_CREDENTIAL);
  assert.notEqual(first.OWNER_SESSION_SECRET, second.OWNER_SESSION_SECRET);
});

test("a PIN that is not six digits is refused and nothing is generated", () => {
  for (const rejected of ["12345", "1234567", "04691a", "", "  "]) {
    const { status, stdout, stderr } = run(`${rejected}\n${rejected}\n`);
    assert.equal(status, 1, rejected);
    assert.equal(stdout, "", rejected);
    assert.match(stderr, /OWNER_PIN_FAIL: the PIN must be exactly 6 digits/, rejected);
  }
});

test("a mismatched confirmation is refused, and refused after the shape check", () => {
  const { status, stdout, stderr } = run(`${PIN}\n046914\n`);
  assert.equal(status, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /the two entries did not match/);

  // A malformed first entry reports the shape, never that the two disagreed —
  // which would tell an onlooker the first entry was at least well formed.
  const malformed = run("12345\n046913\n");
  assert.match(malformed.stderr, /must be exactly 6 digits/);
  assert.ok(!/did not match/.test(malformed.stderr));
});

test("input that ends before the PIN arrives is a refusal, not an empty PIN", () => {
  for (const input of ["", `${PIN}\n`]) {
    const { status, stdout } = run(input);
    assert.equal(status, 1, JSON.stringify(input));
    assert.equal(stdout, "", JSON.stringify(input));
  }
});

test("the iteration floor cannot be argued down, and the ceiling cannot be argued up", () => {
  for (const [count, expectation] of [
    ["1", /between 200000 and 5000000/],
    ["199999", /between 200000 and 5000000/],
    ["5000001", /between 200000 and 5000000/],
    ["abc", /must be a whole number/],
    ["-1", /must be a whole number/],
  ]) {
    const { status, stdout, stderr } = run(`${PIN}\n${PIN}\n`, ["--iterations", count]);
    assert.equal(status, 1, count);
    assert.equal(stdout, "", count);
    assert.match(stderr, expectation, count);
  }

  const accepted = run(`${PIN}\n${PIN}\n`, ["--iterations", String(MIN_PBKDF2_ITERATIONS)]);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(
    parseOwnerPinCredential(assignments(accepted.stdout).OWNER_PIN_CREDENTIAL).iterations,
    MIN_PBKDF2_ITERATIONS,
  );
});

test("an unknown or malformed argument is refused rather than ignored", () => {
  for (const args of [["--pin", PIN], ["--iterations"], ["not-a-flag"], ["--iterations", "250000", "--iterations", "260000"]]) {
    const { status, stdout } = run(`${PIN}\n${PIN}\n`, args);
    assert.equal(status, 1, args.join(" "));
    assert.equal(stdout, "", args.join(" "));
  }
});
