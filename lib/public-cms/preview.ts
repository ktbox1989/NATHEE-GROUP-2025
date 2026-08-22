// Secure preview of unpublished content.
//
// Preview is the one place where non-published content is rendered at a public
// origin, so it is treated as a leak risk rather than a convenience. A preview
// must be unguessable, expiring, scoped to a single revision of a single page,
// never indexable, never cacheable and never present in the sitemap.
//
// Lane B owns who may request a preview. This file owns what the public site
// will accept and how it must respond.

import type { PublicRoutePath } from "./contract.ts";

// Short by design. A preview link is shared in chat and email; a long-lived one
// becomes a permanent unauthenticated window onto unpublished content.
export const PREVIEW_MAX_TTL_SECONDS = 15 * 60;

export const PREVIEW_QUERY_PARAMETER = "preview_token";

// Response headers a preview MUST carry. Indexing an unpublished page can put
// draft copy into a search engine long after the preview link dies.
export const PREVIEW_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "Referrer-Policy": "no-referrer",
});

export type PreviewClaim = {
  path: PublicRoutePath;
  // Binding to one revision means a token cannot be replayed against later,
  // different draft content.
  revisionId: string;
  expiresAt: number;
};

export type PreviewVerdict =
  | { ok: true; claim: PreviewClaim }
  | { ok: false; reason: string };

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeClaim(claim: PreviewClaim): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(claim)));
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

/** Comparison that does not leak how much of the signature matched. */
function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function assertUsableSecret(secret: string | undefined): string {
  // A short or absent secret would make tokens forgeable, so preview fails
  // closed rather than running with a weak one.
  if (!secret || secret.trim().length < 32) {
    throw new Error("preview secret must be at least 32 characters");
  }
  return secret;
}

export async function createPreviewToken(
  claim: Omit<PreviewClaim, "expiresAt">,
  secret: string,
  nowMs: number,
  ttlSeconds = PREVIEW_MAX_TTL_SECONDS,
): Promise<string> {
  assertUsableSecret(secret);
  if (ttlSeconds <= 0 || ttlSeconds > PREVIEW_MAX_TTL_SECONDS) {
    throw new Error(`preview ttl must be between 1 and ${PREVIEW_MAX_TTL_SECONDS} seconds`);
  }
  const payload = encodeClaim({ ...claim, expiresAt: nowMs + ttlSeconds * 1000 });
  return `${payload}.${await sign(payload, secret)}`;
}

/**
 * Verifies a preview token. Every failure returns the same shape and a generic
 * reason for the caller to log; the caller must not tell the visitor which part
 * failed, or the token becomes an oracle.
 */
export async function verifyPreviewToken(
  token: string | null | undefined,
  expected: { path: string; revisionId?: string },
  secret: string,
  nowMs: number,
): Promise<PreviewVerdict> {
  assertUsableSecret(secret);
  if (!token || typeof token !== "string" || token.length > 4096) {
    return { ok: false, reason: "missing token" };
  }

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return { ok: false, reason: "malformed token" };

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!payload || !signature) return { ok: false, reason: "malformed token" };

  const expectedSignature = await sign(payload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) return { ok: false, reason: "bad signature" };

  const decoded = base64UrlDecode(payload);
  if (!decoded) return { ok: false, reason: "malformed payload" };

  let claim: PreviewClaim;
  try {
    claim = JSON.parse(new TextDecoder().decode(decoded)) as PreviewClaim;
  } catch {
    return { ok: false, reason: "malformed payload" };
  }

  if (typeof claim?.expiresAt !== "number" || !Number.isFinite(claim.expiresAt)) {
    return { ok: false, reason: "malformed payload" };
  }
  if (claim.expiresAt <= nowMs) return { ok: false, reason: "expired" };
  if (claim.expiresAt - nowMs > PREVIEW_MAX_TTL_SECONDS * 1000) {
    // A token minted with an over-long life, whatever signed it.
    return { ok: false, reason: "ttl exceeds the maximum" };
  }
  if (claim.path !== expected.path) return { ok: false, reason: "path mismatch" };
  if (expected.revisionId !== undefined && claim.revisionId !== expected.revisionId) {
    return { ok: false, reason: "revision mismatch" };
  }

  return { ok: true, claim };
}

/**
 * Preview URLs are never public surface. Nothing that lists the site may
 * include them, and no preview path may be treated as canonical.
 */
export function isPreviewRequest(url: URL): boolean {
  return url.searchParams.has(PREVIEW_QUERY_PARAMETER);
}

export function canonicalUrlForPreview(url: URL): string {
  // The canonical always points at the published URL, never at the preview,
  // so a leaked preview link cannot compete with the real page in search.
  const canonical = new URL(url.toString());
  canonical.searchParams.delete(PREVIEW_QUERY_PARAMETER);
  canonical.search = canonical.searchParams.toString();
  return canonical.toString();
}
