/**
 * A password change needs proof that the person asking is the account holder.
 *
 * There are two honest proofs. Someone who still knows the current password can
 * supply it. Someone who does not — a user recovering a forgotten password, or an
 * invited user who has never had one — proves it instead by having opened a link
 * sent to their mailbox.
 *
 * Holding a session cookie is not one of those proofs. Without this, anyone who
 * reaches an unlocked browser, or lifts a session cookie, can take an account
 * over permanently; for the OWNER account that is the whole platform.
 *
 * `/auth/callback` is the only place in this application where a link from a
 * mailbox becomes a session, so it is the only place that mints a grant. The
 * grant is a 256-bit random value handed to the browser in a cookie; the
 * database keeps only its digest, so reading the table yields nothing that can be
 * replayed. It is bound to one authentication identity, single-use, and short
 * lived.
 */

export const RECOVERY_GRANT_COOKIE = "nathee_password_grant";

/** Long enough to choose a password, short enough that a stale tab is not a key. */
export const RECOVERY_GRANT_TTL_MS = 30 * 60_000;

/** Consumed or expired grants are reclaimed in bounded batches, like the attempt counters. */
export const RECOVERY_GRANT_RETENTION_MS = 24 * 60 * 60_000;
export const RECOVERY_GRANT_CLEANUP_LIMIT = 50;

/** The path a recovery or invitation link is allowed to land on. */
export const RECOVERY_GRANT_DESTINATION = "/reset-password";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function isRecoveryGrantToken(value: string | undefined | null): boolean {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** The secret handed to the browser. It is never stored. */
export function createRecoveryGrantToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** What the database stores in place of the token. */
export async function recoveryGrantDigest(token: string): Promise<string> {
  if (!isRecoveryGrantToken(token)) {
    throw new Error("Recovery grant tokens must be 64 hexadecimal characters.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A grant is minted only for a callback that is actually completing a recovery
 * or invitation, so an ordinary sign-in callback cannot produce one.
 */
export function shouldIssueRecoveryGrant(next: string): boolean {
  return next === RECOVERY_GRANT_DESTINATION;
}

export type RecoveryGrantCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
};

/**
 * `Lax` rather than `Strict`: the cookie has to survive the top-level redirect
 * from the provider's link into `/reset-password`, but must not be attached to a
 * cross-site POST.
 */
export function recoveryGrantCookieOptions(requestUrl: string): RecoveryGrantCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(requestUrl),
    path: "/",
    maxAge: Math.floor(RECOVERY_GRANT_TTL_MS / 1000),
  };
}

export function clearedRecoveryGrantCookieOptions(
  requestUrl: string,
): RecoveryGrantCookieOptions {
  return { ...recoveryGrantCookieOptions(requestUrl), maxAge: 0 };
}

function isSecureRequest(requestUrl: string): boolean {
  try {
    return new URL(requestUrl).protocol === "https:";
  } catch {
    return true;
  }
}

/**
 * How a password change was authorised. `grant` and `password` are the two
 * accepted proofs; `none` is the refusal, and it is the default.
 */
export type PasswordChangeProof = "grant" | "password" | "none";

export function passwordChangeAccepted(proof: PasswordChangeProof): boolean {
  return proof === "grant" || proof === "password";
}

export type PasswordChangeInput = {
  password: string;
  confirmation: string;
};

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * The provider enforces its own password policy; this only rejects what the
 * application must not forward — an empty, mismatched or unbounded value.
 */
export function validPasswordChange(input: PasswordChangeInput): boolean {
  if (input.password.length < MIN_PASSWORD_LENGTH) return false;
  if (input.password.length > MAX_PASSWORD_LENGTH) return false;
  return input.password === input.confirmation;
}
