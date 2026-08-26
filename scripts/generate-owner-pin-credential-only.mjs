#!/usr/bin/env node
// Rotates only OWNER_PIN_CREDENTIAL to the Sites-compatible v2 format.
// The PIN is read locally with terminal echo disabled and is never written to
// stdout, stderr, a file, or an argument vector. OWNER_SESSION_SECRET is
// intentionally outside this command's responsibility and remains unchanged.

import { createInterface } from "node:readline";
import {
  OWNER_EMAIL,
  OWNER_PIN_LENGTH,
  OWNER_PIN_V2_ALGORITHM,
  SEGMENT_A_ITERATIONS,
  SEGMENT_B_ITERATIONS,
  SEGMENT_C_ITERATIONS,
  V2_SALT_BYTES,
  V2_TOTAL_PBKDF2_WORK,
  deriveOwnerPinV2Digest,
  formatOwnerPinV2Credential,
  isSixDigitPin,
  verifyOwnerPin,
} from "../lib/owner-pin.ts";

function fail(message) {
  process.stderr.write(`OWNER_PIN_CREDENTIAL_ONLY_FAIL: ${message}\n`);
  process.exit(1);
}

if (process.argv.length !== 2) {
  fail("this command accepts no arguments; enter the PIN only at the hidden prompt");
}

const terminal = Boolean(process.stdin.isTTY);
const prompts = process.stderr;
const reader = createInterface({ input: process.stdin, output: prompts, terminal });
let muted = false;
const echo = reader._writeToOutput?.bind(reader);
reader._writeToOutput = (chunk) => {
  if (!muted && echo) echo(chunk);
};
const lines = reader[Symbol.asyncIterator]();

async function askPin(label) {
  if (terminal) prompts.write(label);
  muted = true;
  const { value, done } = await lines.next();
  muted = false;
  if (terminal) prompts.write("\n");
  if (done) fail("the PIN was not entered; nothing was generated");
  return String(value).trim();
}

prompts.write(`Owner PIN credential rotation for ${OWNER_EMAIL}. Nothing you type is shown or stored.\n`);
const pin = await askPin(`PIN (${OWNER_PIN_LENGTH} digits): `);
const confirmation = await askPin("Repeat the PIN: ");
reader.close();

if (!isSixDigitPin(pin)) fail(`the PIN must be exactly ${OWNER_PIN_LENGTH} digits, 0-9`);
if (pin !== confirmation) fail("the two entries did not match; nothing was generated");

const saltA = new Uint8Array(V2_SALT_BYTES);
const saltB = new Uint8Array(V2_SALT_BYTES);
const saltC = new Uint8Array(V2_SALT_BYTES);
crypto.getRandomValues(saltA);
crypto.getRandomValues(saltB);
crypto.getRandomValues(saltC);

const credential = formatOwnerPinV2Credential({
  saltA,
  saltB,
  saltC,
  finalDigest: await deriveOwnerPinV2Digest(pin, saltA, saltB, saltC),
});

if (!(await verifyOwnerPin(pin, credential))) {
  fail("the derived credential did not verify against the PIN; nothing was generated");
}

process.stdout.write(`OWNER_PIN_CREDENTIAL=${credential}\n`);
process.stderr.write(
  `OWNER_PIN_CREDENTIAL_ONLY_READY algorithm=${OWNER_PIN_V2_ALGORITHM} segments=${SEGMENT_A_ITERATIONS}+${SEGMENT_B_ITERATIONS}+${SEGMENT_C_ITERATIONS} totalWork=${V2_TOTAL_PBKDF2_WORK} saltBytesEach=${V2_SALT_BYTES} pinPrinted=no filesWritten=none\n`,
);
