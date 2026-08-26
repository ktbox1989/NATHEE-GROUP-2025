import assert from "node:assert/strict";
import { createHash, pbkdf2Sync } from "node:crypto";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  authModeConfigured,
  clearedOwnerSessionCookieOptions,
  constantTimeEquals,
  createOwnerSessionToken,
  DEFAULT_PBKDF2_ITERATIONS,
  deriveOwnerPinHash,
  deriveOwnerPinV2Digest,
  FINAL_DIGEST_BYTES,
  formatOwnerPinCredential,
  formatOwnerPinV2Credential,
  fromBase64Url,
  isSixDigitPin,
  MAX_PBKDF2_ITERATIONS,
  MAX_SINGLE_PBKDF2_CALL,
  MIN_PBKDF2_ITERATIONS,
  OWNER_EMAIL,
  OWNER_EXTERNAL_AUTH_ID,
  OWNER_PIN_COOKIE,
  OWNER_PIN_LENGTH,
  OWNER_PIN_V2_ALGORITHM,
  OWNER_SESSION_TTL_MS,
  ownerCredentialFingerprint,
  ownerSessionCookieOptions,
  ownerSessionPayload,
  parseOwnerPinAuthConfig,
  parseOwnerPinCredential,
  parseOwnerSessionSecret,
  SEGMENT_A_ITERATIONS,
  SEGMENT_B_ITERATIONS,
  SEGMENT_C_ITERATIONS,
  toBase64Url,
  V2_SALT_BYTES,
  V2_TOTAL_PBKDF2_WORK,
  verifyOwnerPin,
  verifyOwnerSessionToken,
} from "../lib/owner-pin.ts";
import { safeReturnTo } from "../lib/safe-return-to.ts";

// The PIN is six digits. Everything that makes that defensible is in this file
// or in the throttle it sits behind, so each property is asserted rather than
// assumed: the verifier is slow and salted, a near-miss is a miss, a cookie
// cannot be edited, and rotating the credential retires every session.

const PIN = "046913";
const SECRET = toBase64Url(new Uint8Array(32).fill(7));
const FIXED_210K_CREDENTIAL = `v1$pbkdf2-sha256$210000$${toBase64Url(new Uint8Array(32).fill(3))}$-BtgYw21fr4dtIy_Qe8DRA8DnLE8WcmqpE2uR8JK5c8`;
const V2_SALT_A = new Uint8Array(V2_SALT_BYTES).fill(1);
const V2_SALT_B = new Uint8Array(V2_SALT_BYTES).fill(2);
const V2_SALT_C = new Uint8Array(V2_SALT_BYTES).fill(3);
const V2_FINAL_DIGEST = "EeynXy-e8rHdavqZQFrNhmEVxeUwRegq7VVHyxVS2hY";
const FIXED_V2_CREDENTIAL = `v2$${OWNER_PIN_V2_ALGORITHM}$${toBase64Url(V2_SALT_A)}$${toBase64Url(V2_SALT_B)}$${toBase64Url(V2_SALT_C)}$${V2_FINAL_DIGEST}`;

async function credentialFor(pin: string, iterations = MIN_PBKDF2_ITERATIONS): Promise<string> {
  const salt = new Uint8Array(32).fill(3);
  return formatOwnerPinCredential({
    iterations,
    salt,
    hash: await deriveOwnerPinHash(pin, salt, iterations),
  });
}

async function v2CredentialFor(pin: string): Promise<string> {
  return formatOwnerPinV2Credential({
    saltA: V2_SALT_A,
    saltB: V2_SALT_B,
    saltC: V2_SALT_C,
    finalDigest: await deriveOwnerPinV2Digest(pin, V2_SALT_A, V2_SALT_B, V2_SALT_C),
  });
}

test("a PIN is exactly six ASCII digits and nothing else", () => {
  assert.equal(OWNER_PIN_LENGTH, 6);
  assert.equal(isSixDigitPin("000000"), true);
  assert.equal(isSixDigitPin(PIN), true);
  for (const rejected of [
    "12345",
    "1234567",
    "",
    " 046913",
    "046913 ",
    "04691a",
    "04-913",
    "٠٤٦٩١٣", // Arabic-Indic digits: \d would accept these, [0-9] must not
    "0469１3", // full-width digit
    "046913\n",
  ]) {
    assert.equal(isSixDigitPin(rejected), false, rejected);
  }
  for (const notAString of [null, undefined, 46913, { toString: () => "046913" }]) {
    assert.equal(isSixDigitPin(notAString), false);
  }
});

test("base64url round-trips and refuses anything that is not base64url", () => {
  for (const bytes of [new Uint8Array(0), new Uint8Array([0]), new Uint8Array([255, 254, 253]), new Uint8Array(32).fill(9)]) {
    const encoded = toBase64Url(bytes);
    assert.match(encoded, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(fromBase64Url(encoded) ?? new Uint8Array(0), bytes);
  }
  for (const rejected of ["a b", "AA==", "AA+/", "!", "AAAAA"]) {
    assert.equal(fromBase64Url(rejected), null, rejected);
  }
});

test("constant-time comparison answers correctly for equal, unequal and different lengths", () => {
  assert.equal(constantTimeEquals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(constantTimeEquals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(constantTimeEquals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])), false);
  assert.equal(constantTimeEquals(new Uint8Array(0), new Uint8Array(0)), true);
});

test("a credential encodes the parameters it was derived with, and parses back to them", async () => {
  const encoded = await credentialFor(PIN);
  assert.match(encoded, /^v1\$pbkdf2-sha256\$200000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  const parsed = parseOwnerPinCredential(encoded);
  assert.ok(parsed?.version === "v1");
  assert.equal(parsed.iterations, MIN_PBKDF2_ITERATIONS);
  assert.equal(parsed.salt.length, 32);
  assert.equal(parsed.hash.length, 32);
  // Whitespace from a pasted secret is trimmed, exactly as the runtime trims it.
  assert.ok(parseOwnerPinCredential(`  ${encoded}\r\n`));
});

test("the production 210k verifier uses the standard PBKDF2-SHA256 result", async () => {
  const salt = new Uint8Array(32).fill(3);
  const derived = await deriveOwnerPinHash(PIN, salt, 210_000);
  assert.equal(toBase64Url(derived), "-BtgYw21fr4dtIy_Qe8DRA8DnLE8WcmqpE2uR8JK5c8");
});

test("an existing v1 210k credential verifies without rotation", async () => {
  assert.equal(DEFAULT_PBKDF2_ITERATIONS, 210_000);
  assert.ok(MIN_PBKDF2_ITERATIONS >= 200_000);
  assert.equal(parseOwnerPinCredential(FIXED_210K_CREDENTIAL)?.iterations, 210_000);
  assert.equal(await verifyOwnerPin(PIN, FIXED_210K_CREDENTIAL), true);
  assert.equal(await verifyOwnerPin("046912", FIXED_210K_CREDENTIAL), false);
});

test("the Sites Workerd configuration supports the three bounded v2 PBKDF2 segments", async () => {
  const script = [
    'import { pbkdf2Sync } from "node:crypto";',
    'const pin = "046913";',
    'const a = pbkdf2Sync(pin, new Uint8Array(32).fill(1), 100000, 32, "sha256");',
    'const b = pbkdf2Sync(pin, new Uint8Array(32).fill(2), 100000, 32, "sha256");',
    'const c = pbkdf2Sync(pin, new Uint8Array(32).fill(3), 10000, 32, "sha256");',
    'const prefix = new TextEncoder().encode("nathee-owner-pin-v2\\0");',
    'const input = new Uint8Array(prefix.length + a.length + b.length + c.length);',
    'input.set(prefix); input.set(a, prefix.length); input.set(b, prefix.length + a.length); input.set(c, prefix.length + a.length + b.length);',
    'export default { async fetch() { const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input)); const hex = Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join(""); return Response.json({ bytes: digest.byteLength, hex }); } };',
  ].join("\n");
  const runtime = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
  });

  try {
    const response = await runtime.dispatchFetch("http://localhost/");
    const result = (await response.json()) as { bytes: number; hex: string };
    assert.equal(result.bytes, 32);
    assert.equal(result.hex, "11eca75f2f9ef2b1dd6afa99405acd866115c5e53045e82aed5547cb1552da16");
  } finally {
    await runtime.dispose();
  }
});

test("v2 has a fixed 210k composite work contract with no call above 100k", () => {
  assert.equal(SEGMENT_A_ITERATIONS, 100_000);
  assert.equal(SEGMENT_B_ITERATIONS, 100_000);
  assert.equal(SEGMENT_C_ITERATIONS, 10_000);
  assert.equal(V2_TOTAL_PBKDF2_WORK, 210_000);
  assert.equal(MAX_SINGLE_PBKDF2_CALL, 100_000);
  assert.ok(Math.max(SEGMENT_A_ITERATIONS, SEGMENT_B_ITERATIONS, SEGMENT_C_ITERATIONS) <= MAX_SINGLE_PBKDF2_CALL);
  assert.equal(FINAL_DIGEST_BYTES, 32);
});

test("v2 output and final digest match an independent Node reference", async () => {
  const segmentA = pbkdf2Sync(PIN, V2_SALT_A, 100_000, 32, "sha256");
  const segmentB = pbkdf2Sync(PIN, V2_SALT_B, 100_000, 32, "sha256");
  const segmentC = pbkdf2Sync(PIN, V2_SALT_C, 10_000, 32, "sha256");
  assert.equal(toBase64Url(segmentA), "5hWN3DGWJAhgLG_5H1c3r3AUFnBFsuj2yzw8QZ25fwQ");
  assert.equal(toBase64Url(segmentB), "yNSYmuNJRnz_GZXNpoq5glSNPDG3J6404nUeRxl3xDI");
  assert.equal(toBase64Url(segmentC), "vSfGukH_ihynkDOLWD-w4zlJtNUMi9PbBcmu_2rHlYI");

  const reference = createHash("sha256")
    .update(Buffer.from("nathee-owner-pin-v2\0", "utf8"))
    .update(segmentA)
    .update(segmentB)
    .update(segmentC)
    .digest();
  assert.equal(toBase64Url(reference), V2_FINAL_DIGEST);
  assert.equal(toBase64Url(await deriveOwnerPinV2Digest(PIN, V2_SALT_A, V2_SALT_B, V2_SALT_C)), V2_FINAL_DIGEST);
  assert.equal(await v2CredentialFor(PIN), FIXED_V2_CREDENTIAL);
});

test("v2 parses, verifies both outcomes, and stores only salts plus the final digest", async () => {
  const parsed = parseOwnerPinCredential(FIXED_V2_CREDENTIAL);
  assert.ok(parsed?.version === "v2");
  assert.equal(parsed.algorithm, OWNER_PIN_V2_ALGORITHM);
  assert.equal(parsed.iterations, 210_000);
  assert.deepEqual(parsed.saltA, V2_SALT_A);
  assert.deepEqual(parsed.saltB, V2_SALT_B);
  assert.deepEqual(parsed.saltC, V2_SALT_C);
  assert.equal(toBase64Url(parsed.finalDigest), V2_FINAL_DIGEST);
  assert.equal(await verifyOwnerPin(PIN, FIXED_V2_CREDENTIAL), true);
  assert.equal(await verifyOwnerPin("046912", FIXED_V2_CREDENTIAL), false);

  const fields = FIXED_V2_CREDENTIAL.split("$");
  assert.equal(fields.length, 6);
  for (const rawSegment of [
    "5hWN3DGWJAhgLG_5H1c3r3AUFnBFsuj2yzw8QZ25fwQ",
    "yNSYmuNJRnz_GZXNpoq5glSNPDG3J6404nUeRxl3xDI",
    "vSfGukH_ihynkDOLWD-w4zlJtNUMi9PbBcmu_2rHlYI",
  ]) {
    assert.ok(!fields.includes(rawSegment));
  }
});

test("v2 parser rejects malformed, lower-work and caller-parameterised credentials", async () => {
  const salt = toBase64Url(new Uint8Array(32).fill(4));
  const shortSalt = toBase64Url(new Uint8Array(15).fill(4));
  const digest = toBase64Url(new Uint8Array(32).fill(5));
  const malformed = [
    `v3$${OWNER_PIN_V2_ALGORITHM}$${salt}$${salt}$${salt}$${digest}`,
    `v2$pbkdf2-sha256-composite200k$${salt}$${salt}$${salt}$${digest}`,
    `v2$${OWNER_PIN_V2_ALGORITHM}$100000$100000$10000$${salt}$${salt}$${salt}$${digest}`,
    `v2$${OWNER_PIN_V2_ALGORITHM}$${salt}$${salt}$${digest}`,
    `v2$${OWNER_PIN_V2_ALGORITHM}$${salt}$${salt}$${salt}$${digest}$extra`,
    `v2$${OWNER_PIN_V2_ALGORITHM}$not+base64$${salt}$${salt}$${digest}`,
    `v2$${OWNER_PIN_V2_ALGORITHM}$${shortSalt}$${salt}$${salt}$${digest}`,
    `v2$${OWNER_PIN_V2_ALGORITHM}$${salt}$${shortSalt}$${salt}$${digest}`,
    `v2$${OWNER_PIN_V2_ALGORITHM}$${salt}$${salt}$${shortSalt}$${digest}`,
    `v2$${OWNER_PIN_V2_ALGORITHM}$${salt}$${salt}$${salt}$${toBase64Url(new Uint8Array(31).fill(5))}`,
    `v2$${OWNER_PIN_V2_ALGORITHM}$${salt}$${salt}$${salt}$${toBase64Url(new Uint8Array(33).fill(5))}`,
  ];
  for (const value of malformed) {
    assert.equal(parseOwnerPinCredential(value), null, value);
    assert.equal(await verifyOwnerPin(PIN, value), false, value);
  }
});

test("a malformed credential is the absence of a credential, never a weaker one", async () => {
  const salt = toBase64Url(new Uint8Array(32).fill(3));
  const hash = toBase64Url(new Uint8Array(32).fill(4));
  const malformed = [
    "",
    "   ",
    "not-a-credential",
    `v2$pbkdf2-sha256$200000$${salt}$${hash}`,
    `v1$pbkdf2-sha1$200000$${salt}$${hash}`,
    `v1$pbkdf2-sha256$200000$${salt}$${hash}$extra`,
    `v1$pbkdf2-sha256$${salt}$${hash}`,
    // Below the iteration floor: a credential that would verify quickly is
    // refused rather than accepted with a weaker parameter.
    `v1$pbkdf2-sha256$199999$${salt}$${hash}`,
    `v1$pbkdf2-sha256$1$${salt}$${hash}`,
    `v1$pbkdf2-sha256$0$${salt}$${hash}`,
    `v1$pbkdf2-sha256$-200000$${salt}$${hash}`,
    `v1$pbkdf2-sha256$${MAX_PBKDF2_ITERATIONS + 1}$${salt}$${hash}`,
    // A short salt and a short or long hash.
    `v1$pbkdf2-sha256$200000$${toBase64Url(new Uint8Array(15).fill(3))}$${hash}`,
    `v1$pbkdf2-sha256$200000$${salt}$${toBase64Url(new Uint8Array(31).fill(4))}`,
    `v1$pbkdf2-sha256$200000$${salt}$${toBase64Url(new Uint8Array(33).fill(4))}`,
    `v1$pbkdf2-sha256$200000$not base64$${hash}`,
    `v1$pbkdf2-sha256$200000$$${hash}`,
  ];
  for (const value of malformed) {
    assert.equal(parseOwnerPinCredential(value), null, value);
    assert.equal(await verifyOwnerPin(PIN, value), false, value);
  }
  assert.equal(parseOwnerPinCredential(undefined), null);
  assert.equal(await verifyOwnerPin(PIN, null), false);
});

test("the right PIN verifies and every near miss does not", async () => {
  const encoded = await credentialFor(PIN);
  assert.equal(await verifyOwnerPin(PIN, encoded), true);
  for (const wrong of ["046912", "146913", "046931", "000000", "999999"]) {
    assert.equal(await verifyOwnerPin(wrong, encoded), false, wrong);
  }
  // A PIN of the wrong shape can never be the PIN, whatever the credential says.
  for (const wrong of ["04691", "0469133", "", "abcdef"]) {
    assert.equal(await verifyOwnerPin(wrong, encoded), false, wrong);
  }
});

test("the salt is what makes one credential unusable against another", async () => {
  const first = await credentialFor(PIN);
  const secondSalt = new Uint8Array(32).fill(11);
  const second = formatOwnerPinCredential({
    iterations: MIN_PBKDF2_ITERATIONS,
    salt: secondSalt,
    hash: await deriveOwnerPinHash(PIN, secondSalt, MIN_PBKDF2_ITERATIONS),
  });
  assert.notEqual(first, second);
  assert.equal(await verifyOwnerPin(PIN, second), true);
  // Same PIN, different salt: the stored hashes must not match, or the salt is
  // decorative and a precomputed table would work against both.
  const parsedFirst = parseOwnerPinCredential(first);
  const parsedSecond = parseOwnerPinCredential(second);
  assert.ok(parsedFirst?.version === "v1");
  assert.ok(parsedSecond?.version === "v1");
  assert.notEqual(parsedFirst.hash.join(","), parsedSecond.hash.join(","));
});

test("a session secret must carry real key material", () => {
  assert.equal(parseOwnerSessionSecret(SECRET), SECRET);
  assert.equal(parseOwnerSessionSecret(` ${SECRET} `), SECRET);
  for (const rejected of ["", "   ", "short", "a".repeat(42), "a".repeat(513), `${"a".repeat(43)}!`, "a a".padEnd(43, "b")]) {
    assert.equal(parseOwnerSessionSecret(rejected), null, JSON.stringify(rejected));
  }
  assert.equal(parseOwnerSessionSecret(undefined), null);
});

test("configuration is both values or neither", async () => {
  const encoded = await credentialFor(PIN);
  assert.ok(parseOwnerPinAuthConfig(encoded, SECRET));
  assert.equal(parseOwnerPinAuthConfig(await v2CredentialFor(PIN), SECRET)?.credential.version, "v2");
  assert.equal(parseOwnerPinAuthConfig(encoded, undefined), null);
  assert.equal(parseOwnerPinAuthConfig(undefined, SECRET), null);
  assert.equal(parseOwnerPinAuthConfig("broken", SECRET), null);
  assert.equal(parseOwnerPinAuthConfig(encoded, "short"), null);
});

test("a runtime with either door configured is not a runtime with no way in", () => {
  assert.equal(authModeConfigured({ ownerPin: true, supabase: false }), true);
  assert.equal(authModeConfigured({ ownerPin: false, supabase: true }), true);
  assert.equal(authModeConfigured({ ownerPin: true, supabase: true }), true);
  assert.equal(authModeConfigured({ ownerPin: false, supabase: false }), false);
});

test("a session verifies only under the signature, the fixed address and the fingerprint it was issued with", async () => {
  const now = Date.UTC(2026, 7, 25, 9, 0, 0);
  const fingerprint = await ownerCredentialFingerprint(await credentialFor(PIN));
  const payload = ownerSessionPayload("user-1", fingerprint, now);
  const token = await createOwnerSessionToken(payload, SECRET);

  const verified = await verifyOwnerSessionToken({ token, secret: SECRET, fingerprint, now: now + 1000 });
  assert.notEqual(verified, null);
  assert.equal(verified!.sub, "user-1");
  assert.equal(verified!.email, OWNER_EMAIL);
  assert.equal(verified!.exp - verified!.iat, OWNER_SESSION_TTL_MS);

  // A different signing key.
  assert.equal(
    await verifyOwnerSessionToken({ token, secret: toBase64Url(new Uint8Array(32).fill(8)), fingerprint, now }),
    null,
  );
  // A tampered payload, re-encoded but not re-signed.
  const forgedPayload = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ ...payload, sub: "someone-else" })),
  );
  assert.equal(
    await verifyOwnerSessionToken({
      token: `${forgedPayload}.${token.split(".")[1]}`,
      secret: SECRET,
      fingerprint,
      now,
    }),
    null,
  );
  // Structural nonsense.
  for (const broken of ["", "   ", ".", "a.b.c", token.split(".")[0], `${token}x`, `x${token}`, "a".repeat(5000)]) {
    assert.equal(await verifyOwnerSessionToken({ token: broken, secret: SECRET, fingerprint, now }), null, broken.slice(0, 12));
  }
  assert.equal(await verifyOwnerSessionToken({ token: undefined, secret: SECRET, fingerprint, now }), null);
});

test("a session expires, and cannot be issued with a life longer than the policy", async () => {
  const now = Date.UTC(2026, 7, 25, 9, 0, 0);
  const fingerprint = await ownerCredentialFingerprint(await credentialFor(PIN));
  const token = await createOwnerSessionToken(ownerSessionPayload("user-1", fingerprint, now), SECRET);

  assert.ok(await verifyOwnerSessionToken({ token, secret: SECRET, fingerprint, now: now + OWNER_SESSION_TTL_MS - 1 }));
  assert.equal(await verifyOwnerSessionToken({ token, secret: SECRET, fingerprint, now: now + OWNER_SESSION_TTL_MS }), null);
  assert.equal(await verifyOwnerSessionToken({ token, secret: SECRET, fingerprint, now: now + OWNER_SESSION_TTL_MS + 60_000 }), null);

  // A request for a longer life is clamped at issue.
  const clamped = ownerSessionPayload("user-1", fingerprint, now, OWNER_SESSION_TTL_MS * 10);
  assert.equal(clamped.exp - clamped.iat, OWNER_SESSION_TTL_MS);

  // And a cookie signed by hand with a longer life is refused at verification,
  // even though its signature is perfectly good.
  const overlong = await createOwnerSessionToken(
    { v: 1, sub: "user-1", email: OWNER_EMAIL, fp: fingerprint, iat: now, exp: now + OWNER_SESSION_TTL_MS + 1 },
    SECRET,
  );
  assert.equal(await verifyOwnerSessionToken({ token: overlong, secret: SECRET, fingerprint, now: now + 1000 }), null);

  // A session dated far in the future is not a session yet.
  const future = await createOwnerSessionToken(ownerSessionPayload("user-1", fingerprint, now + 3_600_000), SECRET);
  assert.equal(await verifyOwnerSessionToken({ token: future, secret: SECRET, fingerprint, now }), null);
});

test("changing the credential revokes every session signed under the old one", async () => {
  const now = Date.UTC(2026, 7, 25, 9, 0, 0);
  const oldCredential = await credentialFor(PIN);
  const newCredential = await v2CredentialFor(PIN);
  const oldFingerprint = await ownerCredentialFingerprint(oldCredential);
  const newFingerprint = await ownerCredentialFingerprint(newCredential);
  assert.notEqual(oldFingerprint, newFingerprint);
  assert.match(oldFingerprint, /^[0-9a-f]{32}$/);

  const token = await createOwnerSessionToken(ownerSessionPayload("user-1", oldFingerprint, now), SECRET);
  assert.ok(await verifyOwnerSessionToken({ token, secret: SECRET, fingerprint: oldFingerprint, now: now + 1000 }));
  // Same PIN and signing key, but v1 -> v2 credential rotation: refused, with nothing to revoke.
  assert.equal(
    await verifyOwnerSessionToken({ token, secret: SECRET, fingerprint: newFingerprint, now: now + 1000 }),
    null,
  );
});

test("the fingerprint is a digest of the verifier and discloses no PIN", async () => {
  const encoded = await credentialFor(PIN);
  const fingerprint = await ownerCredentialFingerprint(encoded);
  assert.equal(fingerprint.length, 32);
  assert.ok(!encoded.includes(fingerprint));
  assert.ok(!fingerprint.includes(PIN));
  // Stable across calls and insensitive to pasted whitespace.
  assert.equal(await ownerCredentialFingerprint(encoded), fingerprint);
  assert.equal(await ownerCredentialFingerprint(` ${encoded}\n`), fingerprint);
});

test("a session naming any address but the canonical Owner is refused", async () => {
  const now = Date.UTC(2026, 7, 25, 9, 0, 0);
  const fingerprint = await ownerCredentialFingerprint(await credentialFor(PIN));
  for (const email of ["attacker@example.com", "KAIKT143@gmail.com", "", "kaikt143@gmail.com.attacker.invalid"]) {
    const token = await createOwnerSessionToken(
      { v: 1, sub: "user-1", email, fp: fingerprint, iat: now, exp: now + 60_000 },
      SECRET,
    );
    assert.equal(await verifyOwnerSessionToken({ token, secret: SECRET, fingerprint, now }), null, email);
  }
  assert.equal(OWNER_EMAIL, "kaikt143@gmail.com");
  // The identity the PIN Owner occupies can never be produced by the provider,
  // whose identifiers are UUIDs.
  assert.equal(OWNER_EXTERNAL_AUTH_ID, "owner-pin:kaikt143@gmail.com");
});

test("the session cookie is HttpOnly, Secure, SameSite=Lax, path-scoped and bounded", () => {
  const options = ownerSessionCookieOptions();
  assert.equal(OWNER_PIN_COOKIE, "nathee_owner_session");
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
  assert.equal(options.maxAge, OWNER_SESSION_TTL_MS / 1000);
  assert.equal(options.maxAge, 7 * 24 * 60 * 60);

  const cleared = clearedOwnerSessionCookieOptions();
  assert.equal(cleared.maxAge, 0);
  assert.equal(cleared.httpOnly, true);
  assert.equal(cleared.secure, true);
  assert.equal(cleared.sameSite, "lax");
  assert.equal(cleared.path, "/");

  // A longer request is clamped here too, so the cookie can never outlive the token.
  assert.equal(ownerSessionCookieOptions(OWNER_SESSION_TTL_MS * 5).maxAge, OWNER_SESSION_TTL_MS / 1000);
});

test("the login form's returnTo cannot leave this origin", () => {
  assert.equal(safeReturnTo("/app/website"), "/app/website");
  assert.equal(safeReturnTo("/app/site-settings?tab=contact"), "/app/site-settings?tab=contact");
  for (const hostile of [
    "https://attacker.invalid/app",
    "//attacker.invalid/app",
    "/\\attacker.invalid",
    "javascript:alert(1)",
    "",
    null,
  ]) {
    assert.equal(safeReturnTo(hostile), "/app", String(hostile));
  }
});
