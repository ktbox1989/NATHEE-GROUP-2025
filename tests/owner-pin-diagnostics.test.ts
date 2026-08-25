import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  OWNER_PIN_STAGES,
  ownerPinStageDiagnostic,
} from "../lib/owner-pin-diagnostics.ts";

function headers(values: Record<string, string> = {}): Pick<Headers, "get"> {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => normalized.get(name.toLowerCase()) ?? null };
}

test("each unavailable stage emits only the four safe diagnostic fields", () => {
  for (const stage of OWNER_PIN_STAGES) {
    const diagnostic = ownerPinStageDiagnostic(stage, new Error("runtime unavailable"), headers());
    assert.deepEqual(Object.keys(diagnostic), [
      "OWNER_PIN_STAGE",
      "exception_class",
      "exception_message",
      "request_correlation_id",
    ]);
    assert.equal(diagnostic.OWNER_PIN_STAGE, stage);
    assert.equal(diagnostic.request_correlation_id, "not-provided");
  }
});

test("the live PBKDF2 failure remains identifiable without exposing credentials", () => {
  const error = new DOMException(
    "Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000).",
    "NotSupportedError",
  );
  const diagnostic = ownerPinStageDiagnostic("verify", error, headers({ "cf-ray": "abc123-BKK" }));
  assert.equal(diagnostic.exception_class, "NotSupportedError");
  assert.match(diagnostic.exception_message, /requested 210000/);
  assert.equal(diagnostic.request_correlation_id, "abc123-BKK");
});

test("PINs, credentials, sessions, fixed identity and long tokens are redacted", () => {
  const diagnostic = ownerPinStageDiagnostic(
    "bootstrap",
    new Error(
      "PIN=123456 OWNER_PIN_CREDENTIAL=$pbkdf2-sha256$210000$salt$hash " +
        "OWNER_SESSION_SECRET=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 " +
        "nathee_owner_session=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 " +
        "owner-pin:kaikt143@gmail.com kaikt143@gmail.com",
    ),
    headers({ "cf-ray": "bad\nvalue", "x-request-id": "req-123" }),
  );
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /123456|\$pbkdf2|salt|hash|abcdefghijklmnopqrstuvwxyz|kaikt143/);
  assert.equal(diagnostic.request_correlation_id, "req-123");
});

test("the route logs the first exception at all three unavailable stages", async () => {
  const source = await readFile(new URL("../app/api/auth/owner-pin/login/route.ts", import.meta.url), "utf8");
  const stages = [...source.matchAll(/logOwnerPinStageFailure\("(throttle|verify|bootstrap)", error, request\.headers\)/g)]
    .map((match) => match[1]);
  assert.deepEqual(stages, ["throttle", "verify", "bootstrap"]);
});
