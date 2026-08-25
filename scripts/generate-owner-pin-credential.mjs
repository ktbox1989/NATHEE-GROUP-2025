#!/usr/bin/env node
// Derives the two runtime values the Owner PIN login needs, from a PIN the
// operator types and this script never repeats.
//
// Usage:
//   npm run owner:pin
//   node scripts/generate-owner-pin-credential.mjs --iterations 300000
//
// What it prints on stdout, and nothing else:
//   OWNER_PIN_CREDENTIAL=v1$pbkdf2-sha256$<iterations>$<salt>$<hash>
//   OWNER_SESSION_SECRET=<32 random bytes, base64url>
//
// What it never prints, writes or stores: the PIN. It is read with the terminal
// echo off, held in memory for as long as it takes to derive one hash, and
// never reaches stdout, stderr, a file or an argument vector. Passing it as a
// command-line argument is not offered on purpose — that would put it in the
// shell history and in every process listing on the machine.
//
// It makes no network call and touches no database. The values it prints are
// pasted into the deployment's secret store by hand; nothing here belongs in
// Git, and .env is already ignored.

import { createInterface } from "node:readline";
import {
  DEFAULT_PBKDF2_ITERATIONS,
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  OWNER_EMAIL,
  OWNER_PIN_LENGTH,
  deriveOwnerPinHash,
  formatOwnerPinCredential,
  isSixDigitPin,
  toBase64Url,
  verifyOwnerPin,
} from "../lib/owner-pin.ts";

const SALT_BYTES = 32;
const SESSION_SECRET_BYTES = 32;

const USAGE = `Usage:
  npm run owner:pin
  node scripts/generate-owner-pin-credential.mjs [--iterations <count>]

Options:
  --iterations  PBKDF2 iteration count. Default ${DEFAULT_PBKDF2_ITERATIONS},
                minimum ${MIN_PBKDF2_ITERATIONS}, maximum ${MAX_PBKDF2_ITERATIONS}.
`;

// Every failure message is written by this file. None of them interpolates the
// PIN, and there is no debug branch that would.
function fail(message) {
  process.stderr.write(`OWNER_PIN_FAIL: ${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseArguments(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!["iterations"].includes(key)) fail(`unknown argument: --${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for --${key}`);
    if (parsed.has(key)) fail(`duplicate argument: --${key}`);
    parsed.set(key, value);
    index += 1;
  }
  return parsed;
}

const args = parseArguments(process.argv.slice(2));
const iterationsText = args.get("iterations") ?? String(DEFAULT_PBKDF2_ITERATIONS);
if (!/^[0-9]{1,9}$/.test(iterationsText)) fail("--iterations must be a whole number");
const iterations = Number(iterationsText);
if (iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
  fail(`--iterations must be between ${MIN_PBKDF2_ITERATIONS} and ${MAX_PBKDF2_ITERATIONS}`);
}

// Prompts go to stderr so that stdout carries only the two assignments and can
// be piped into a secret store without being edited by hand.
const terminal = Boolean(process.stdin.isTTY);
const prompts = process.stderr;
const reader = createInterface({ input: process.stdin, output: prompts, terminal });

let muted = false;
const echo = reader._writeToOutput?.bind(reader);
reader._writeToOutput = (chunk) => {
  if (!muted && echo) echo(chunk);
};

// One iterator over the whole input, created before the first prompt. Asking
// question by question loses a line when the input arrives all at once rather
// than a keystroke at a time, which is how this is driven in a test.
const lines = reader[Symbol.asyncIterator]();

async function askPin(label) {
  if (terminal) prompts.write(label);
  muted = true;
  const { value, done } = await lines.next();
  muted = false;
  if (terminal) prompts.write("\n");
  // Input that ends before an answer arrives is a refusal, not an empty PIN.
  if (done) fail("the PIN was not entered; nothing was generated");
  return String(value).trim();
}

prompts.write(`Owner PIN for ${OWNER_EMAIL}. Nothing you type is shown or stored.\n`);
const pin = await askPin(`PIN (${OWNER_PIN_LENGTH} digits): `);
const confirmation = await askPin("Repeat the PIN: ");
reader.close();

// Shape first, then agreement. A mismatch reported before the shape check would
// tell an onlooker that the first entry was at least well formed.
if (!isSixDigitPin(pin)) fail(`the PIN must be exactly ${OWNER_PIN_LENGTH} digits, 0-9`);
if (pin !== confirmation) fail("the two entries did not match; nothing was generated");

const salt = new Uint8Array(SALT_BYTES);
crypto.getRandomValues(salt);
const credential = formatOwnerPinCredential({
  iterations,
  salt,
  hash: await deriveOwnerPinHash(pin, salt, iterations),
});

// The runtime's own verifier, run here, so a credential that the application
// would reject is never handed to an operator as if it worked.
if (!(await verifyOwnerPin(pin, credential))) {
  fail("the derived credential did not verify against the PIN; nothing was written");
}

const sessionSecretBytes = new Uint8Array(SESSION_SECRET_BYTES);
crypto.getRandomValues(sessionSecretBytes);
const sessionSecret = toBase64Url(sessionSecretBytes);

process.stdout.write(`OWNER_PIN_CREDENTIAL=${credential}\n`);
process.stdout.write(`OWNER_SESSION_SECRET=${sessionSecret}\n`);

prompts.write(`
Set both values as secrets in the application environment, alongside APP_ORIGIN.
Neither belongs in Git, in .env.example, or in a message thread.

  OWNER_PIN_CREDENTIAL  verifies the PIN. It cannot be reversed into the PIN,
                        but it is still the thing an offline guess would attack,
                        so treat it as a secret.
  OWNER_SESSION_SECRET  signs the Owner session cookie. Anyone holding it can
                        mint a session without the PIN.

Replacing OWNER_PIN_CREDENTIAL changes the PIN and, by itself, invalidates every
session issued under the old one. There is no second step and nothing to revoke.

Verify the shape before deploying, without contacting any provider:
  npm run verify:env
`);
process.stderr.write(
  `OWNER_PIN_CREDENTIAL_READY algorithm=pbkdf2-sha256 iterations=${iterations} saltBytes=${SALT_BYTES} sessionSecretBytes=${SESSION_SECRET_BYTES} pinPrinted=no filesWritten=none\n`,
);
