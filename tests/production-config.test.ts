import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthCallbackUrl,
  CANONICAL_PRODUCTION_ORIGIN,
  isPublicWebsiteOrigin,
  normalizeConfiguredAppOrigin,
  PUBLIC_WEBSITE_ORIGIN,
  resolveAppOrigin,
} from "../lib/app-origin.ts";
import { isSupabaseSecretKey } from "../lib/supabase/admin.ts";
import { parseSupabaseConfig } from "../lib/supabase/config.ts";

test("application origin accepts only canonical, preview and local origins", () => {
  assert.equal(normalizeConfiguredAppOrigin("https://app.natheegroup2025.com"), CANONICAL_PRODUCTION_ORIGIN);
  assert.equal(normalizeConfiguredAppOrigin("https://nathee-preview.chatgpt.site"), "https://nathee-preview.chatgpt.site");
  assert.equal(normalizeConfiguredAppOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeConfiguredAppOrigin("http://app.natheegroup2025.com"), null);
  assert.equal(normalizeConfiguredAppOrigin("https://app.natheegroup2025.com/path"), null);
  assert.equal(normalizeConfiguredAppOrigin("https://attacker.invalid"), null);
  assert.equal(resolveAppOrigin(undefined, "https://request.invalid/app", "production"), null);
  assert.equal(resolveAppOrigin(undefined, "http://localhost:3000/app", "development"), "http://localhost:3000");
});

test("the public website is never accepted as the application origin", () => {
  // The application holds sessions, customer records and private media. The
  // apex is a static document root Lane A deploys to by file copy; sharing an
  // origin would share every Auth cookie and redirect target with it.
  assert.equal(CANONICAL_PRODUCTION_ORIGIN, "https://app.natheegroup2025.com");
  assert.equal(PUBLIC_WEBSITE_ORIGIN, "https://natheegroup2025.com");
  assert.notEqual(CANONICAL_PRODUCTION_ORIGIN, PUBLIC_WEBSITE_ORIGIN);

  for (const apex of [
    "https://natheegroup2025.com",
    "https://natheegroup2025.com/",
    "http://natheegroup2025.com",
    "https://www.natheegroup2025.com",
  ]) {
    assert.equal(normalizeConfiguredAppOrigin(apex), null, apex);
  }
  assert.equal(isPublicWebsiteOrigin("https://natheegroup2025.com"), true);
  assert.equal(isPublicWebsiteOrigin("https://natheegroup2025.com/"), true);
  assert.equal(isPublicWebsiteOrigin("https://app.natheegroup2025.com"), false);
  assert.equal(isPublicWebsiteOrigin(undefined), false);
});

test("a lookalike host cannot pass as the application origin", () => {
  for (const lookalike of [
    "https://natheegroup2025.com.attacker.invalid",
    "https://app.natheegroup2025.com.attacker.invalid",
    "https://app-natheegroup2025.com",
    "https://appnatheegroup2025.com",
    "https://app.natheegroup2025.com:8443",
    "https://evil.app.natheegroup2025.com",
  ]) {
    assert.equal(normalizeConfiguredAppOrigin(lookalike), null, lookalike);
  }
});

test("auth callback is derived from configured origin and never from a spoofed Host", () => {
  const callback = buildAuthCallbackUrl(
    "/reset-password",
    "https://attacker.invalid/api/auth/forgot-password",
    CANONICAL_PRODUCTION_ORIGIN,
    "production",
  );
  assert.equal(callback?.toString(), "https://app.natheegroup2025.com/auth/callback?next=%2Freset-password");
  assert.equal(buildAuthCallbackUrl("/app", "https://attacker.invalid", undefined, "production"), null);
});

test("Supabase runtime values reject placeholders and private keys in public configuration", () => {
  const valid = parseSupabaseConfig("https://project-ref.supabase.co", `sb_publishable_${"a".repeat(24)}`);
  assert.deepEqual(valid, {
    url: "https://project-ref.supabase.co",
    publishableKey: `sb_publishable_${"a".repeat(24)}`,
  });
  assert.equal(parseSupabaseConfig("http://project-ref.supabase.co", `sb_publishable_${"a".repeat(24)}`), null);
  assert.equal(parseSupabaseConfig("https://your-project.supabase.co", "sb_publishable_replace_me"), null);
  assert.equal(parseSupabaseConfig("https://project-ref.supabase.co", `sb_secret_${"a".repeat(24)}`), null);
  assert.equal(isSupabaseSecretKey(`sb_secret_${"a".repeat(24)}`), true);
  assert.equal(isSupabaseSecretKey(`sb_publishable_${"a".repeat(24)}`), false);
  assert.equal(isSupabaseSecretKey("sb_secret_replace_me"), false);
});
