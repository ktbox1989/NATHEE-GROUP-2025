#!/usr/bin/env node
import { normalizeConfiguredAppOrigin, buildAuthCallbackUrl, CANONICAL_PRODUCTION_ORIGIN } from "../lib/app-origin.ts";
import { isSupabaseSecretKey } from "../lib/supabase/admin.ts";
import { parseSupabaseConfig } from "../lib/supabase/config.ts";
import { turnstileKeysReady } from "../lib/turnstile.ts";

// Activation fails for boring reasons: a key pasted from the wrong field, a URL
// with a trailing slash, the publishable and secret values swapped. Each one
// produces a runtime that starts, refuses every login, and gives no useful
// reason — /api/health can only say "authentication: false".
//
// This checks the values *before* anything is deployed, using the exact
// validators the runtime uses, so a mistake is named rather than guessed at.
//
// It reads environment variables and never prints one. It makes no network call:
// it proves the values are well formed and consistent with each other, not that
// the credentials are accepted by the provider. Proving that needs the real
// Production secrets against the live project, which is the Owner's step.

const checks = [];
const env = process.env;

function record(name, ok, detail, { required = true } = {}) {
  checks.push({ name, ok, detail, required });
}

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// --- Application origin -----------------------------------------------------
const appOrigin = normalizeConfiguredAppOrigin(env.APP_ORIGIN);
if (!present(env.APP_ORIGIN)) {
  record("APP_ORIGIN", false, "not set; Production fails closed without a trusted origin");
} else if (!appOrigin) {
  record(
    "APP_ORIGIN",
    false,
    "not an accepted origin; expected exactly https://natheegroup2025.com with no path, query or trailing slash",
  );
} else if (appOrigin !== CANONICAL_PRODUCTION_ORIGIN) {
  record("APP_ORIGIN", false, `set to a non-Production origin (${appOrigin}); Production requires ${CANONICAL_PRODUCTION_ORIGIN}`);
} else {
  record("APP_ORIGIN", true, "canonical Production origin");
}

// --- Supabase public configuration ------------------------------------------
// The runtime validator takes both values together, so each is checked against
// it with a well-formed stand-in for the other. A wrong key must not be reported
// as a wrong URL.
const PROBE_PUBLISHABLE_KEY = `sb_publishable_${"a".repeat(24)}`;
const supabase = parseSupabaseConfig(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const urlAlone = parseSupabaseConfig(env.NEXT_PUBLIC_SUPABASE_URL, PROBE_PUBLISHABLE_KEY);
if (!present(env.NEXT_PUBLIC_SUPABASE_URL)) {
  record("NEXT_PUBLIC_SUPABASE_URL", false, "not set");
} else if (!urlAlone) {
  record(
    "NEXT_PUBLIC_SUPABASE_URL",
    false,
    "rejected; expected an https project URL with no path, query, fragment or credentials (https://<ref>.supabase.co)",
  );
} else {
  record("NEXT_PUBLIC_SUPABASE_URL", true, "https project URL");
}

if (!present(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  record("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", false, "not set");
} else if (isSupabaseSecretKey(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  record(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    false,
    "holds a SECRET key. This value is sent to browsers. Rotate it now, then set the sb_publishable_... value here",
  );
} else if (!parseSupabaseConfig("https://probe.supabase.co", env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  record("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", false, "rejected; expected an sb_publishable_... value");
} else {
  record("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", true, "publishable key shape");
}

// Both together are what the runtime actually loads.
if (present(env.NEXT_PUBLIC_SUPABASE_URL) && present(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  record(
    "SUPABASE_PUBLIC_CONFIG",
    Boolean(supabase),
    supabase ? "the runtime would load this pair" : "the pair is rejected by the runtime validator",
  );
}

// --- Supabase administrative configuration ----------------------------------
if (!present(env.SUPABASE_SECRET_KEY)) {
  record("SUPABASE_SECRET_KEY", false, "not set; Owner invitations cannot be issued without it");
} else if (/^sb_publishable_/.test(env.SUPABASE_SECRET_KEY.trim())) {
  record("SUPABASE_SECRET_KEY", false, "holds the publishable key; expected the sb_secret_... value");
} else if (!isSupabaseSecretKey(env.SUPABASE_SECRET_KEY)) {
  record("SUPABASE_SECRET_KEY", false, "rejected; expected an sb_secret_... value");
} else {
  record("SUPABASE_SECRET_KEY", true, "secret key shape");
}

// Only meaningful once both values exist; claiming they "differ" while both are
// unset would be a check that always passes.
if (present(env.SUPABASE_SECRET_KEY) && present(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  const identical = env.SUPABASE_SECRET_KEY.trim() === env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim();
  record(
    "SUPABASE_KEY_SEPARATION",
    !identical,
    identical ? "the public and secret values are identical" : "public and secret values differ",
  );
}

// --- Anti-abuse -------------------------------------------------------------
if (!present(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) && !present(env.TURNSTILE_SECRET_KEY)) {
  record("TURNSTILE", false, "not set; the public quotation form stays visibly unavailable", { required: false });
} else if (!turnstileKeysReady(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, env.TURNSTILE_SECRET_KEY)) {
  record("TURNSTILE", false, "one or both keys are missing or malformed; both are required together", { required: false });
} else {
  record("TURNSTILE", true, "site and secret key shapes", { required: false });
}

// --- Derived values the Owner must mirror in the provider dashboard ---------
const callback = appOrigin ? buildAuthCallbackUrl("/reset-password", undefined, env.APP_ORIGIN, "production") : null;

const required = checks.filter((check) => check.required);
const failed = required.filter((check) => !check.ok);

for (const check of checks) {
  const status = check.ok ? "OK  " : check.required ? "FAIL" : "WARN";
  console.log(`${status} ${check.name}: ${check.detail}`);
}

if (appOrigin) {
  console.log("");
  console.log("Set these in the Supabase Auth dashboard, exactly:");
  console.log(`  Site URL:          ${appOrigin}`);
  console.log(`  Redirect URL:      ${appOrigin}/auth/callback`);
  if (callback) console.log(`  Recovery lands on: ${callback.toString()}`);
}

console.log("");
if (failed.length > 0) {
  console.log(
    `PRODUCTION_ENV_VERIFY_FAIL required=${required.length} failed=${failed.length} (${failed.map((check) => check.name).join(", ")})`,
  );
  process.exit(1);
}

const warnings = checks.filter((check) => !check.required && !check.ok).length;
console.log(
  `PRODUCTION_ENV_VERIFY_PASS required=${required.length} warnings=${warnings} shapeOnly=true providerNotContacted=true`,
);
