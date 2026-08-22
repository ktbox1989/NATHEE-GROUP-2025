import assert from "node:assert/strict";
import test from "node:test";
import { validateBoundedMultipartRequest } from "../lib/bounded-multipart.ts";
import { isSameOrigin } from "../lib/same-origin.ts";
import { safeReturnTo } from "../lib/safe-return-to.ts";

test("safe return paths preserve only local application URLs", () => {
  assert.equal(safeReturnTo("/app/jobs?view=open"), "/app/jobs?view=open");
  assert.equal(safeReturnTo("/portal#latest"), "/portal#latest");
  assert.equal(safeReturnTo("https://attacker.invalid"), "/app");
  assert.equal(safeReturnTo("//attacker.invalid"), "/app");
  assert.equal(safeReturnTo("/\\attacker.invalid"), "/app");
  assert.equal(safeReturnTo(null), "/app");
});

test("mutation origin checks accept same-origin browser posts only", () => {
  const sameOrigin = new Request("https://system.nathee.example/api/jobs", {
    method: "POST",
    headers: { origin: "https://system.nathee.example" },
  });
  const crossOrigin = new Request("https://system.nathee.example/api/jobs", {
    method: "POST",
    headers: { origin: "https://attacker.invalid" },
  });
  const fetchMetadataFallback = new Request(
    "https://system.nathee.example/api/jobs",
    { method: "POST", headers: { "sec-fetch-site": "same-origin" } },
  );
  const headerless = new Request("https://system.nathee.example/api/jobs", {
    method: "POST",
  });

  assert.equal(isSameOrigin(sameOrigin as never), true);
  assert.equal(isSameOrigin(crossOrigin as never), false);
  assert.equal(isSameOrigin(fetchMetadataFallback as never), true);
  assert.equal(isSameOrigin(headerless as never), false);
});

test("production mutations require the configured canonical host and reject Host spoofing", () => {
  const canonical = new Request("https://app.natheegroup2025.com/api/jobs", {
    method: "POST",
    headers: { origin: "https://app.natheegroup2025.com" },
  });
  const spoofed = new Request("https://attacker.invalid/api/jobs", {
    method: "POST",
    headers: { origin: "https://attacker.invalid", "sec-fetch-site": "same-origin" },
  });
  assert.equal(isSameOrigin(canonical as never, "https://app.natheegroup2025.com", "production"), true);
  assert.equal(isSameOrigin(spoofed as never, "https://app.natheegroup2025.com", "production"), false);
  assert.equal(isSameOrigin(canonical as never, undefined, "production"), false);
});

test("configuring the public website as the application origin fails every mutation closed", () => {
  // Not a cosmetic misconfiguration: the apex is refused, so resolveAppOrigin
  // yields nothing and every same-origin check denies rather than defaulting to
  // the request's own host.
  const request = new Request("https://natheegroup2025.com/api/jobs", {
    method: "POST",
    headers: { origin: "https://natheegroup2025.com" },
  });
  assert.equal(isSameOrigin(request as never, "https://natheegroup2025.com", "production"), false);

  // And a request arriving at the public apex is not same-origin for an
  // application correctly configured on its own subdomain.
  assert.equal(isSameOrigin(request as never, "https://app.natheegroup2025.com", "production"), false);
});

test("multipart uploads require a real boundary and a bounded explicit byte length", () => {
  assert.deepEqual(validateBoundedMultipartRequest("multipart/form-data; boundary=abc123", "1024", 2048), { ok: true, contentLength: 1024 });
  assert.deepEqual(validateBoundedMultipartRequest('multipart/form-data; boundary="quoted-boundary"', "2048", 2048), { ok: true, contentLength: 2048 });
  assert.deepEqual(validateBoundedMultipartRequest("application/json", "100", 2048), { ok: false, error: "unsupported_media_type", status: 415 });
  assert.deepEqual(validateBoundedMultipartRequest("multipart/form-data", "100", 2048), { ok: false, error: "unsupported_media_type", status: 415 });
  assert.deepEqual(validateBoundedMultipartRequest("multipart/form-data; boundary=abc", null, 2048), { ok: false, error: "length_required", status: 411 });
  assert.deepEqual(validateBoundedMultipartRequest("multipart/form-data; boundary=abc", "0", 2048), { ok: false, error: "length_required", status: 411 });
  assert.deepEqual(validateBoundedMultipartRequest("multipart/form-data; boundary=abc", "12.5", 2048), { ok: false, error: "length_required", status: 411 });
  assert.deepEqual(validateBoundedMultipartRequest("multipart/form-data; boundary=abc", "2049", 2048), { ok: false, error: "request_too_large", status: 413 });
});
