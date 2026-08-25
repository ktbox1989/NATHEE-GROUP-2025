import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticationConfigured,
  authMode,
  databaseObjectsReady,
  REQUIRED_DATABASE_OBJECTS,
  runtimeReadiness,
} from "../lib/runtime-readiness.ts";

test("runtime readiness passes only when every production service is ready", () => {
  const ready = runtimeReadiness({
    authentication: true,
    adminAuthentication: true,
    canonicalOrigin: true,
    database: true,
    storage: true,
    antiAbuse: true,
  });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.payload.status, "healthy");
});

test("runtime readiness fails closed for every missing dependency", () => {
  for (const missing of ["authentication", "adminAuthentication", "canonicalOrigin", "database", "storage", "antiAbuse"] as const) {
    const checks = {
      authentication: true,
      adminAuthentication: true,
      canonicalOrigin: true,
      database: true,
      storage: true,
      antiAbuse: true,
      [missing]: false,
    };
    const result = runtimeReadiness(checks);
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.status, "degraded");
    assert.equal(result.payload.checks[missing], false);
  }
});

test("database readiness requires the latest tables, indexes and safety triggers", () => {
  const complete = REQUIRED_DATABASE_OBJECTS.map((object) => ({ ...object }));
  assert.equal(databaseObjectsReady(complete), true);
  for (const missing of REQUIRED_DATABASE_OBJECTS) {
    assert.equal(databaseObjectsReady(complete.filter((object) => object.name !== missing.name)), false);
  }
});

// There are now two independent ways for this runtime to be able to
// authenticate somebody, and the probe is unauthenticated. It therefore has to
// say which mode is in force without ever claiming the absent one is ready.

test("the auth mode names what is configured, and never infers one from the other", () => {
  assert.equal(authMode({ ownerPin: false, supabase: false }), "none");
  assert.equal(authMode({ ownerPin: true, supabase: false }), "owner-pin");
  assert.equal(authMode({ ownerPin: false, supabase: true }), "supabase");
  assert.equal(authMode({ ownerPin: true, supabase: true }), "owner-pin+supabase");

  assert.equal(authenticationConfigured({ ownerPin: true, supabase: false }), true);
  assert.equal(authenticationConfigured({ ownerPin: false, supabase: true }), true);
  assert.equal(authenticationConfigured({ ownerPin: false, supabase: false }), false);
});

test("the probe reports the mode alongside the checks, and reports Supabase as absent when it is", () => {
  const checks = {
    authentication: true,
    adminAuthentication: false,
    canonicalOrigin: true,
    database: true,
    storage: true,
    antiAbuse: false,
  };
  const readiness = runtimeReadiness(checks, { ownerPin: true, supabase: false, supabaseAdmin: false });
  assert.equal(readiness.payload.auth?.mode, "owner-pin");
  assert.equal(readiness.payload.auth?.ownerPin, true);
  assert.equal(readiness.payload.auth?.supabase, false);
  assert.equal(readiness.payload.auth?.supabaseAdmin, false);
  // The verdict stays all-or-nothing: a partially configured runtime is exactly
  // the state that looks healthy and is not.
  assert.equal(readiness.statusCode, 503);
  assert.equal(readiness.payload.status, "degraded");

  // Nothing derived from a credential or a signing key is in the payload.
  const serialised = JSON.stringify(readiness.payload);
  assert.ok(!/credential|secret|pbkdf2|fingerprint/i.test(serialised), serialised);
});

test("a probe given no auth detail reports none, rather than inventing one", () => {
  const readiness = runtimeReadiness({
    authentication: true,
    adminAuthentication: true,
    canonicalOrigin: true,
    database: true,
    storage: true,
    antiAbuse: true,
  });
  assert.equal(readiness.statusCode, 200);
  assert.equal("auth" in readiness.payload, false);
});
