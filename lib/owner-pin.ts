/**
 * The Owner's own way in, and the only one that does not depend on an external
 * identity provider.
 *
 * The Owner CMS is unreachable whenever Supabase is unconfigured, because every
 * protected surface resolves its actor from a Supabase session. That is the
 * right design for staff and customers — an invitation, a mailbox, a recovery
 * link — and the wrong one for the single account that has to be able to reach
 * the website editor on a day when no provider is wired up at all.
 *
 * So there is exactly one PIN account: the canonical Owner, at a fixed address
 * this module owns. The address is a public identifier and is written here
 * rather than read from a form, because an email supplied by a caller is a
 * claim, and a claim that selects which account to authenticate is the whole
 * vulnerability.
 *
 * Two runtime values carry the secrecy, and neither has a default:
 *
 *   OWNER_PIN_CREDENTIAL   a PBKDF2-SHA256 verifier for the PIN. The PIN itself
 *                          is never stored, transmitted anywhere but the login
 *                          post, or written to this repository.
 *   OWNER_SESSION_SECRET   the HMAC key the session cookie is signed with.
 *
 * A six-digit PIN is a million possibilities, which is small. It is defensible
 * only because three things hold at once, and all three are enforced elsewhere
 * in code that this module is written to fit: the verifier is deliberately slow
 * (>=200k PBKDF2 iterations), every attempt spends the existing login attempt
 * budget before it is checked, and the identity budget locks the one account a
 * guesser can name. Weaken any of the three and the PIN is not enough.
 */

/** Public identifier, never a secret, and never accepted from a request. */
export const OWNER_EMAIL = "kaikt143@gmail.com";

/**
 * The `users.external_auth_id` the PIN Owner occupies.
 *
 * Deliberately not a UUID. `lib/auth-identity.ts` refuses anything that is not a
 * UUID, so no Supabase identity can ever resolve to this row, and no PIN session
 * can ever be mistaken for a provider one. The two authentication paths cannot
 * collide even if both are configured.
 */
export const OWNER_EXTERNAL_AUTH_ID = "owner-pin:kaikt143@gmail.com";

/** Shown in the application shell; the Owner can change it in the database. */
export const OWNER_DISPLAY_NAME = "เจ้าของระบบ NATHEE GROUP";

export const OWNER_PIN_COOKIE = "nathee_owner_session";

/** Upper bound on how long one PIN entry keeps the CMS open. */
export const OWNER_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

/** Tolerance for a clock that is a little ahead of the one that signed. */
const CLOCK_SKEW_MS = 60_000;

/** Exactly six ASCII digits. Not five, not seven, and not a Unicode digit. */
export const OWNER_PIN_LENGTH = 6;
const PIN_PATTERN = /^[0-9]{6}$/;

/**
 * Slow on purpose. 200k is the floor the credential format refuses to go below;
 * the generator writes more, and an old credential with fewer iterations is
 * treated as malformed rather than quietly accepted.
 */
export const MIN_PBKDF2_ITERATIONS = 200_000;

/** A bound, so a malformed value cannot turn one login into a minute of CPU. */
export const MAX_PBKDF2_ITERATIONS = 5_000_000;

export const DEFAULT_PBKDF2_ITERATIONS = 210_000;

const MIN_SALT_BYTES = 16;
const HASH_BYTES = 32;

/** 32 bytes of base64url is 43 characters; anything shorter is not a key. */
const SESSION_SECRET_PATTERN = /^[A-Za-z0-9_-]{43,512}$/;

export function isSixDigitPin(value: unknown): value is string {
  return typeof value === "string" && PIN_PATTERN.test(value);
}

// --- Encoding ---------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padding = (4 - (value.length % 4)) % 4;
  if (padding === 3) return null;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(padding));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Length-independent equality. `===` on two strings, or an early `return false`
 * inside a loop, leaks how much of a value matched, and a verifier that leaks
 * that is a verifier an attacker can walk one byte at a time.
 */
export function constantTimeEquals(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

// --- The PIN credential -----------------------------------------------------

export type OwnerPinCredential = {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
};

/** `v1$pbkdf2-sha256$<iterations>$<salt-b64url>$<hash-b64url>` */
export function formatOwnerPinCredential(credential: OwnerPinCredential): string {
  return [
    "v1",
    "pbkdf2-sha256",
    String(credential.iterations),
    toBase64Url(credential.salt),
    toBase64Url(credential.hash),
  ].join("$");
}

/**
 * Every field is checked, and a value that fails any check is `null` rather
 * than a credential with a weaker parameter. A truncated salt or an iteration
 * count of 1 is not a credential that "still works"; it is the absence of one.
 */
export function parseOwnerPinCredential(value: string | undefined | null): OwnerPinCredential | null {
  const encoded = value?.trim();
  if (!encoded) return null;
  const parts = encoded.split("$");
  if (parts.length !== 5) return null;
  const [version, algorithm, iterationsText, saltText, hashText] = parts;
  if (version !== "v1" || algorithm !== "pbkdf2-sha256") return null;
  if (!/^[0-9]{1,9}$/.test(iterationsText)) return null;
  const iterations = Number(iterationsText);
  if (iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) return null;
  const salt = fromBase64Url(saltText);
  const hash = fromBase64Url(hashText);
  if (!salt || salt.length < MIN_SALT_BYTES) return null;
  if (!hash || hash.length !== HASH_BYTES) return null;
  return { iterations, salt, hash };
}

export async function deriveOwnerPinHash(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Fails closed on every path: a PIN of the wrong shape, an unreadable
 * credential and a wrong PIN are all `false`, and none of them is
 * distinguishable from the others by the caller.
 */
export async function verifyOwnerPin(
  pin: string,
  credential: OwnerPinCredential | string | null | undefined,
): Promise<boolean> {
  const parsed = typeof credential === "string" ? parseOwnerPinCredential(credential) : credential;
  if (!parsed) return false;
  if (!isSixDigitPin(pin)) return false;
  const derived = await deriveOwnerPinHash(pin, parsed.salt, parsed.iterations);
  return constantTimeEquals(derived, parsed.hash);
}

/**
 * A short digest of the configured credential, carried inside every session.
 *
 * This is what makes rotation mean something. Changing OWNER_PIN_CREDENTIAL
 * changes the fingerprint, so every cookie signed under the old one stops
 * verifying on the next request — the Owner does not have to find and revoke
 * sessions, and a PIN believed to be compromised is actually retired by the act
 * of replacing it. It is a digest of a verifier, not of the PIN, so it discloses
 * nothing that the environment does not already hold.
 */
export async function ownerCredentialFingerprint(encodedCredential: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`nathee-owner-pin-credential:v1:${encodedCredential.trim()}`),
  );
  return toHex(new Uint8Array(digest)).slice(0, 32);
}

// --- Runtime configuration --------------------------------------------------

export type OwnerPinAuthConfig = {
  /** The encoded value exactly as configured; only ever used to derive the fingerprint. */
  encodedCredential: string;
  credential: OwnerPinCredential;
  sessionSecret: string;
};

export function parseOwnerSessionSecret(value: string | undefined | null): string | null {
  const secret = value?.trim();
  return secret && SESSION_SECRET_PATTERN.test(secret) ? secret : null;
}

/**
 * Both values or neither. A credential with no signing key can verify a PIN and
 * then has no way to remember that it did; a signing key with no credential can
 * sign a session nothing was ever proven for.
 */
export function parseOwnerPinAuthConfig(
  credentialValue: string | undefined,
  secretValue: string | undefined,
): OwnerPinAuthConfig | null {
  const credential = parseOwnerPinCredential(credentialValue);
  const sessionSecret = parseOwnerSessionSecret(secretValue);
  if (!credential || !sessionSecret) return null;
  return { encodedCredential: credentialValue!.trim(), credential, sessionSecret };
}

export function getOwnerPinAuthConfig(): OwnerPinAuthConfig | null {
  return parseOwnerPinAuthConfig(process.env.OWNER_PIN_CREDENTIAL, process.env.OWNER_SESSION_SECRET);
}

export function isOwnerPinConfigured(): boolean {
  return getOwnerPinAuthConfig() !== null;
}

/**
 * Whether *some* way in exists. `requireActor` used to redirect to
 * `/login?error=config` on the absence of Supabase alone, which with a PIN
 * configured would have locked the Owner out of a working login.
 */
export function authModeConfigured(modes: { ownerPin: boolean; supabase: boolean }): boolean {
  return modes.ownerPin || modes.supabase;
}

// --- The session cookie -----------------------------------------------------

export type OwnerSessionPayload = {
  /** Payload format. */
  v: 1;
  /** The application `users.id` this session acts as. */
  sub: string;
  /** The canonical Owner address, so a payload naming anything else is refused. */
  email: string;
  /** Credential fingerprint; see `ownerCredentialFingerprint`. */
  fp: string;
  /** Issued-at and expiry, in epoch milliseconds. */
  iat: number;
  exp: number;
};

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * `<payload>.<signature>`, both base64url.
 *
 * The payload is readable by anyone holding the cookie, which is fine: it names
 * the Owner's own id and address and nothing else. What it cannot be is
 * *changed*, and that is the signature's job.
 */
export async function createOwnerSessionToken(
  payload: OwnerSessionPayload,
  secret: string,
): Promise<string> {
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

export function ownerSessionPayload(
  userId: string,
  fingerprint: string,
  now: number,
  ttlMs: number = OWNER_SESSION_TTL_MS,
): OwnerSessionPayload {
  return {
    v: 1,
    sub: userId,
    email: OWNER_EMAIL,
    fp: fingerprint,
    iat: now,
    exp: now + Math.min(ttlMs, OWNER_SESSION_TTL_MS),
  };
}

export type OwnerSessionVerification = {
  token: string | undefined | null;
  secret: string;
  fingerprint: string;
  now: number;
};

/**
 * Returns the payload only when the signature, the format, the fixed address,
 * the credential fingerprint and both time bounds all hold. Anything else is
 * `null`; there is no partial acceptance and no reason reported to the caller,
 * because every failure has the same remedy — enter the PIN again.
 */
export async function verifyOwnerSessionToken(
  input: OwnerSessionVerification,
): Promise<OwnerSessionPayload | null> {
  const token = input.token?.trim();
  if (!token || token.length > 4096) return null;
  const separator = token.indexOf(".");
  if (separator <= 0 || token.indexOf(".", separator + 1) !== -1) return null;

  const encodedPayload = token.slice(0, separator);
  const providedSignature = fromBase64Url(token.slice(separator + 1));
  if (!providedSignature) return null;

  const expected = await crypto.subtle.sign(
    "HMAC",
    await signingKey(input.secret),
    new TextEncoder().encode(encodedPayload),
  );
  if (!constantTimeEquals(providedSignature, new Uint8Array(expected))) return null;

  const decoded = fromBase64Url(encodedPayload);
  if (!decoded) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const payload = parsed as Partial<OwnerSessionPayload>;
  if (payload.v !== 1) return null;
  if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 64) return null;
  if (payload.email !== OWNER_EMAIL) return null;
  if (typeof payload.fp !== "string" || payload.fp !== input.fingerprint) return null;
  if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) return null;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  if (payload.exp <= input.now) return null;
  if (payload.iat > input.now + CLOCK_SKEW_MS) return null;
  // A cookie signed with a longer life than the policy allows is refused even
  // though its signature is good; the bound is the policy, not the issuer.
  if (payload.exp - payload.iat > OWNER_SESSION_TTL_MS) return null;

  return { v: 1, sub: payload.sub, email: payload.email, fp: payload.fp, iat: payload.iat, exp: payload.exp };
}

export type OwnerSessionCookieOptions = {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

/**
 * `Secure` unconditionally: browsers treat `http://localhost` as a secure
 * context, so development is unaffected and no deployment can end up handing
 * this cookie out over plain HTTP.
 *
 * `Lax` rather than `Strict` so that following a link into the CMS from
 * elsewhere still arrives signed in, while a cross-site form post carries
 * nothing. Scoped to `/` because the CMS spans `/app` and the API.
 */
export function ownerSessionCookieOptions(ttlMs: number = OWNER_SESSION_TTL_MS): OwnerSessionCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(Math.min(ttlMs, OWNER_SESSION_TTL_MS) / 1000),
  };
}

export function clearedOwnerSessionCookieOptions(): OwnerSessionCookieOptions {
  return { ...ownerSessionCookieOptions(), maxAge: 0 };
}
