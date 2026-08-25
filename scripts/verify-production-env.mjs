#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  buildAuthCallbackUrl,
  CANONICAL_PRODUCTION_ORIGIN,
  isPublicWebsiteOrigin,
  normalizeConfiguredAppOrigin,
  PUBLIC_WEBSITE_ORIGIN,
} from "../lib/app-origin.ts";
import {
  OWNER_EMAIL,
  parseOwnerPinCredential,
  parseOwnerSessionSecret,
} from "../lib/owner-pin.ts";
import { authMode } from "../lib/runtime-readiness.ts";
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
} else if (isPublicWebsiteOrigin(env.APP_ORIGIN)) {
  // The most plausible wrong value, so it is named rather than lumped in with
  // "not accepted": the apex is the public marketing site, and the application
  // must not share an origin with a document root deployed by file copy.
  record(
    "APP_ORIGIN",
    false,
    `set to the public website (${PUBLIC_WEBSITE_ORIGIN}). The application has its own origin: ${CANONICAL_PRODUCTION_ORIGIN}`,
  );
} else if (!appOrigin) {
  record(
    "APP_ORIGIN",
    false,
    `not an accepted origin; expected exactly ${CANONICAL_PRODUCTION_ORIGIN} with no path, query or trailing slash`,
  );
} else if (appOrigin !== CANONICAL_PRODUCTION_ORIGIN) {
  record("APP_ORIGIN", false, `set to a non-Production origin (${appOrigin}); Production requires ${CANONICAL_PRODUCTION_ORIGIN}`);
} else {
  record("APP_ORIGIN", true, "canonical Production origin");
}

// --- Owner CMS PIN authentication -------------------------------------------
// The Owner reaches the website editor with a PIN, and that path depends on no
// identity provider at all. So there are two ways for this runtime to be able
// to authenticate somebody, and requiring both would refuse a deployment that
// is complete for what it is actually being used for.
//
// The rule is one complete mode, not two: whichever mode is not configured is
// reported as a warning rather than reported as ready. Nothing here ever prints
// a credential or a secret, only whether the value has the shape the runtime
// parses.
const supabase = parseSupabaseConfig(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const supabaseAuthComplete = Boolean(supabase) && isSupabaseSecretKey(env.SUPABASE_SECRET_KEY ?? "");
const ownerPinCredential = parseOwnerPinCredential(env.OWNER_PIN_CREDENTIAL);
const ownerSessionSecret = parseOwnerSessionSecret(env.OWNER_SESSION_SECRET);
const ownerPinReady = Boolean(ownerPinCredential && ownerSessionSecret);

// Reported only when the Owner PIN is actually in play: either a value for it
// was set, or Supabase is not complete and something has to be. A deployment
// that runs entirely on Supabase is not asked about a mode it does not use.
const ownerPinInUse =
  present(env.OWNER_PIN_CREDENTIAL) || present(env.OWNER_SESSION_SECRET) || !supabaseAuthComplete;
const ownerPinRequired = !supabaseAuthComplete;

// Mirrored: with a complete Owner PIN mode, an absent Supabase is a warning
// rather than a blocked activation. It is never reported as ready.
const supabaseRequired = !ownerPinReady;

if (ownerPinInUse) {
  if (!present(env.OWNER_PIN_CREDENTIAL)) {
    record("OWNER_PIN_CREDENTIAL", false, "not set; generate it with `npm run owner:pin`", {
      required: ownerPinRequired,
    });
  } else if (!ownerPinCredential) {
    record(
      "OWNER_PIN_CREDENTIAL",
      false,
      "rejected; expected v1$pbkdf2-sha256$<iterations>$<salt>$<hash> with at least 200000 iterations, a 16-byte salt and a 32-byte hash",
      { required: ownerPinRequired },
    );
  } else {
    record(
      "OWNER_PIN_CREDENTIAL",
      true,
      `pbkdf2-sha256, ${ownerPinCredential.iterations} iterations, ${ownerPinCredential.salt.length}-byte salt`,
      { required: ownerPinRequired },
    );
  }

  if (!present(env.OWNER_SESSION_SECRET)) {
    record("OWNER_SESSION_SECRET", false, "not set; generate it with `npm run owner:pin`", {
      required: ownerPinRequired,
    });
  } else if (!ownerSessionSecret) {
    record(
      "OWNER_SESSION_SECRET",
      false,
      "rejected; expected at least 43 base64url characters (32 bytes of key material)",
      { required: ownerPinRequired },
    );
  } else {
    record("OWNER_SESSION_SECRET", true, "session signing key shape", { required: ownerPinRequired });
  }

  // The address is a public identifier and is fixed in the server source, so
  // naming it here tells the operator which seat the PIN opens without
  // disclosing anything. There is no environment variable to get wrong.
  record("OWNER_PIN_ACCOUNT", true, `${OWNER_EMAIL} (fixed in source; never read from a request)`, {
    required: false,
  });

  // Two halves of one mode. A credential with no signing key can verify a PIN
  // and then has no way to remember that it did.
  if (present(env.OWNER_PIN_CREDENTIAL) !== present(env.OWNER_SESSION_SECRET)) {
    record(
      "OWNER_PIN_PAIR",
      false,
      "only one of OWNER_PIN_CREDENTIAL and OWNER_SESSION_SECRET is set; both are required together",
      { required: ownerPinRequired },
    );
  }
}

// --- Supabase public configuration ------------------------------------------
// The runtime validator takes both values together, so each is checked against
// it with a well-formed stand-in for the other. A wrong key must not be reported
// as a wrong URL.
const PROBE_PUBLISHABLE_KEY = `sb_publishable_${"a".repeat(24)}`;
const urlAlone = parseSupabaseConfig(env.NEXT_PUBLIC_SUPABASE_URL, PROBE_PUBLISHABLE_KEY);
if (!present(env.NEXT_PUBLIC_SUPABASE_URL)) {
  record("NEXT_PUBLIC_SUPABASE_URL", false, "not set", { required: supabaseRequired });
} else if (!urlAlone) {
  record(
    "NEXT_PUBLIC_SUPABASE_URL",
    false,
    "rejected; expected an https project URL with no path, query, fragment or credentials (https://<ref>.supabase.co)",
    { required: supabaseRequired },
  );
} else {
  record("NEXT_PUBLIC_SUPABASE_URL", true, "https project URL", { required: supabaseRequired });
}

if (!present(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  record("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", false, "not set", { required: supabaseRequired });
} else if (isSupabaseSecretKey(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  record(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    false,
    "holds a SECRET key. This value is sent to browsers. Rotate it now, then set the sb_publishable_... value here",
  );
} else if (!parseSupabaseConfig("https://probe.supabase.co", env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  record("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", false, "rejected; expected an sb_publishable_... value", { required: supabaseRequired });
} else {
  record("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", true, "publishable key shape", { required: supabaseRequired });
}

// Both together are what the runtime actually loads.
if (present(env.NEXT_PUBLIC_SUPABASE_URL) && present(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
  record(
    "SUPABASE_PUBLIC_CONFIG",
    Boolean(supabase),
    supabase ? "the runtime would load this pair" : "the pair is rejected by the runtime validator",
    { required: supabaseRequired },
  );
}

// --- Supabase administrative configuration ----------------------------------
if (!present(env.SUPABASE_SECRET_KEY)) {
  record("SUPABASE_SECRET_KEY", false, "not set; Owner invitations cannot be issued without it", { required: supabaseRequired });
} else if (/^sb_publishable_/.test(env.SUPABASE_SECRET_KEY.trim())) {
  record("SUPABASE_SECRET_KEY", false, "holds the publishable key; expected the sb_secret_... value", { required: supabaseRequired });
} else if (!isSupabaseSecretKey(env.SUPABASE_SECRET_KEY)) {
  record("SUPABASE_SECRET_KEY", false, "rejected; expected an sb_secret_... value", { required: supabaseRequired });
} else {
  record("SUPABASE_SECRET_KEY", true, "secret key shape", { required: supabaseRequired });
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

// --- Runtime bindings -------------------------------------------------------
// Declared, not probed: the verifier runs before anything is deployed, so it
// checks that the artifact asks for the right bindings. Whether the live
// bindings exist is what /api/health answers after a deploy.
let hosting = null;
try {
  hosting = JSON.parse(readFileSync(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
} catch {
  hosting = null;
}
if (!hosting) {
  record("RUNTIME_BINDINGS", false, "cannot read .openai/hosting.json; the artifact declares no bindings");
} else {
  const d1 = hosting.d1 === "DB";
  const r2 = hosting.r2 === "FILES";
  record(
    "RUNTIME_BINDINGS",
    d1 && r2,
    d1 && r2
      ? "artifact declares D1 'DB' and private R2 'FILES'"
      : `artifact declares d1=${JSON.stringify(hosting.d1)} r2=${JSON.stringify(hosting.r2)}; expected "DB" and "FILES"`,
  );
}

// --- Nothing secret may be browser-visible ----------------------------------
// NEXT_PUBLIC_ values are compiled into pages a customer downloads. This is the
// mistake that cannot be walked back: once shipped, the value is public.
const SECRET_SHAPES = [
  [/^sb_secret_/, "a Supabase secret key"],
  [/^eyJ[A-Za-z0-9_-]+\./, "a JWT, which for Supabase is a service-role token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/^sk[-_]/, "a provider secret key"],
];
const exposed = [];
for (const [name, value] of Object.entries(env)) {
  if (!name.startsWith("NEXT_PUBLIC_") || typeof value !== "string") continue;
  const trimmed = value.trim();
  for (const [shape, described] of SECRET_SHAPES) {
    if (shape.test(trimmed)) exposed.push(`${name} holds ${described}`);
  }
}
record(
  "BROWSER_EXPOSED_SECRETS",
  exposed.length === 0,
  exposed.length === 0
    ? "no NEXT_PUBLIC_ value carries a secret shape"
    : `${exposed.join("; ")}. Rotate before deploying; a shipped public value cannot be recalled`,
);

// --- Which door this runtime can actually open -------------------------------
// Named rather than inferred from the list above, because "one complete mode"
// is the rule the required/warning split is derived from, and an operator
// reading FAIL lines has to be able to see which mode was being judged.
// The same function /api/health reports with, so the verifier and the running
// probe can never disagree about which mode a deployment is in.
const mode = authMode({ ownerPin: ownerPinReady, supabase: supabaseAuthComplete });
record(
  "AUTH_MODE",
  mode !== "none",
  mode === "none"
    ? "no complete authentication mode; configure the Owner PIN (npm run owner:pin) or the full Supabase pair"
    : `${mode}; the other mode is optional and is reported above as configured or not`,
);

// --- Derived values the Owner must mirror in the provider dashboard ---------
const callback = appOrigin ? buildAuthCallbackUrl("/reset-password", undefined, env.APP_ORIGIN, "production") : null;

const required = checks.filter((check) => check.required);
const failed = required.filter((check) => !check.ok);

for (const check of checks) {
  const status = check.ok ? "OK  " : check.required ? "FAIL" : "WARN";
  console.log(`${status} ${check.name}: ${check.detail}`);
}

// Only when Supabase is in play. A runtime the Owner runs on a PIN alone has
// no provider dashboard to mirror anything into.
if (appOrigin && (present(env.NEXT_PUBLIC_SUPABASE_URL) || present(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) || present(env.SUPABASE_SECRET_KEY))) {
  console.log("");
  console.log("Set these in the Supabase Auth dashboard, exactly:");
  console.log(`  Site URL:          ${appOrigin}`);
  console.log(`  Redirect URL:      ${appOrigin}/auth/callback`);
  if (callback) console.log(`  Recovery lands on: ${callback.toString()}`);
}

console.log("");
if (failed.length > 0) {
  console.log(
    `PRODUCTION_ENV_VERIFY_FAIL required=${required.length} failed=${failed.length} authMode=${mode} (${failed.map((check) => check.name).join(", ")})`,
  );
  process.exit(1);
}

const warnings = checks.filter((check) => !check.required && !check.ok).length;
console.log(
  `PRODUCTION_ENV_VERIFY_PASS required=${required.length} warnings=${warnings} shapeOnly=true providerNotContacted=true bindingsDeclared=true authMode=${mode}`,
);
