import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthCallbackUrl,
  CANONICAL_PRODUCTION_ORIGIN,
  normalizeConfiguredAppOrigin,
  resolveAppOrigin,
} from "../lib/app-origin.ts";
import { isSupabaseSecretKey } from "../lib/supabase/admin.ts";
import { parseSupabaseConfig } from "../lib/supabase/config.ts";

test("application origin accepts only canonical, preview and local origins", () => {
  assert.equal(normalizeConfiguredAppOrigin("https://natheegroup2025.com"), CANONICAL_PRODUCTION_ORIGIN);
  assert.equal(normalizeConfiguredAppOrigin("https://nathee-preview.chatgpt.site"), "https://nathee-preview.chatgpt.site");
  assert.equal(normalizeConfiguredAppOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeConfiguredAppOrigin("http://natheegroup2025.com"), null);
  assert.equal(normalizeConfiguredAppOrigin("https://natheegroup2025.com/path"), null);
  assert.equal(normalizeConfiguredAppOrigin("https://attacker.invalid"), null);
  assert.equal(resolveAppOrigin(undefined, "https://request.invalid/app", "production"), null);
  assert.equal(resolveAppOrigin(undefined, "http://localhost:3000/app", "development"), "http://localhost:3000");
});

test("auth callback is derived from configured origin and never from a spoofed Host", () => {
  const callback = buildAuthCallbackUrl(
    "/reset-password",
    "https://attacker.invalid/api/auth/forgot-password",
    CANONICAL_PRODUCTION_ORIGIN,
    "production",
  );
  assert.equal(callback?.toString(), "https://natheegroup2025.com/auth/callback?next=%2Freset-password");
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
