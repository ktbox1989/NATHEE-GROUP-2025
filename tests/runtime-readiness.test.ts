import assert from "node:assert/strict";
import test from "node:test";
import { databaseObjectsReady, REQUIRED_DATABASE_OBJECTS, runtimeReadiness } from "../lib/runtime-readiness.ts";

test("runtime readiness passes only when every production service is ready", () => {
  const ready = runtimeReadiness({
    authentication: true,
    adminAuthentication: true,
    canonicalOrigin: true,
    database: true,
    storage: true,
  });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.payload.status, "healthy");
});

test("runtime readiness fails closed for every missing dependency", () => {
  for (const missing of ["authentication", "adminAuthentication", "canonicalOrigin", "database", "storage"] as const) {
    const checks = {
      authentication: true,
      adminAuthentication: true,
      canonicalOrigin: true,
      database: true,
      storage: true,
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
