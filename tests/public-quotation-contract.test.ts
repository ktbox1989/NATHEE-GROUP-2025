import assert from "node:assert/strict";
import test from "node:test";
import {
  VERIFIED_CONTACT_NUMBERS,
  createRequestKey,
  normalisePhone,
  parseAcknowledgement,
  reduceSubmission,
  shouldOfferTelephoneFallback,
  validateQuotationDraft,
  type QuotationDraft,
} from "../lib/public-forms/quotation-contract.ts";

function draft(overrides: Partial<QuotationDraft> = {}): QuotationDraft {
  return {
    contactName: "คุณสมชาย",
    phone: "063-194-1191",
    email: "",
    origin: "กรุงเทพฯ",
    destination: "เชียงใหม่",
    motorcycleCount: "12",
    details: "",
    consent: true,
    ...overrides,
  };
}

test("a complete enquiry passes client validation", () => {
  assert.deepEqual(validateQuotationDraft(draft()), []);
});

test("Thai phone numbers are accepted in the forms people actually type", () => {
  for (const phone of ["0631941191", "063-194-1191", "063 194 1191", "+66631941191", "(063) 194-1191"]) {
    assert.deepEqual(
      validateQuotationDraft(draft({ phone })).filter((error) => error.field === "phone"),
      [],
      `${phone} should be accepted`,
    );
  }
  for (const phone of ["", "12345", "abcdefghij", "06319411910000"]) {
    assert.ok(
      validateQuotationDraft(draft({ phone })).some((error) => error.field === "phone"),
      `${phone} should be rejected`,
    );
  }
  assert.equal(normalisePhone("(063) 194-1191"), "0631941191");
});

test("email is optional but must be well formed when given", () => {
  assert.deepEqual(validateQuotationDraft(draft({ email: "" })), []);
  assert.deepEqual(validateQuotationDraft(draft({ email: "owner@natheegroup2025.com" })), []);
  assert.ok(validateQuotationDraft(draft({ email: "not-an-email" })).some((error) => error.field === "email"));
});

test("consent is required before the enquiry can be stored", () => {
  const errors = validateQuotationDraft(draft({ consent: false }));
  assert.ok(errors.some((error) => error.field === "consent"));
});

test("the motorcycle count must be a whole number within the supported range", () => {
  for (const count of ["0", "-1", "501", "abc", "1.5", ""]) {
    assert.ok(
      validateQuotationDraft(draft({ motorcycleCount: count })).some((error) => error.field === "motorcycleCount"),
      `${count} should be rejected`,
    );
  }
  for (const count of ["1", "50", "500"]) {
    assert.deepEqual(
      validateQuotationDraft(draft({ motorcycleCount: count })).filter((error) => error.field === "motorcycleCount"),
      [],
    );
  }
});

test("every problem is reported at once rather than one per submission", () => {
  const errors = validateQuotationDraft(
    draft({ contactName: "", phone: "x", origin: "", destination: "", motorcycleCount: "0", consent: false }),
  );
  assert.ok(errors.length >= 6, `expected several errors, got ${errors.length}`);
});

// --- the rule that matters -------------------------------------------------

test("only a complete matching acknowledgement counts as success", () => {
  const key = "abc123";
  const state = reduceSubmission({ httpStatus: 200, payload: { ok: true, reference: "QT-2026-0001", requestKey: key } }, key);
  assert.equal(state.status, "SUCCESS");
  assert.equal(state.status === "SUCCESS" && state.reference, "QT-2026-0001");
});

test("a bare 200 is never reported as success", () => {
  const key = "abc123";
  // An HTML page, an empty body, a redirect that happened to resolve: all of
  // these are 200s that mean nothing was stored.
  for (const payload of [null, undefined, {}, "<html></html>", { ok: true }, { ok: false, reference: "x", requestKey: key }]) {
    const state = reduceSubmission({ httpStatus: 200, payload }, key);
    assert.equal(state.status, "ERROR", `payload ${JSON.stringify(payload)} must not be a success`);
  }
});

test("an acknowledgement for a different request is refused", () => {
  const state = reduceSubmission(
    { httpStatus: 200, payload: { ok: true, reference: "QT-1", requestKey: "someone-else" } },
    "mine",
  );
  assert.equal(state.status, "ERROR");
  const parsed = parseAcknowledgement({ ok: true, reference: "QT-1", requestKey: "someone-else" }, "mine");
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok === false ? parsed.reason : "", /different request/);
});

test("an empty reference number is refused", () => {
  const key = "k";
  for (const reference of ["", "   ", 123, null]) {
    const state = reduceSubmission({ httpStatus: 200, payload: { ok: true, reference, requestKey: key } }, key);
    assert.equal(state.status, "ERROR", `reference ${String(reference)} must not succeed`);
  }
});

test("server and network failures are retryable, validation failures are not", () => {
  const key = "k";
  for (const status of [500, 502, 503, 0, 429, 403]) {
    const state = reduceSubmission({ httpStatus: status, payload: null }, key);
    assert.equal(state.status, "ERROR");
    assert.equal(state.status === "ERROR" && state.retryable, true, `${status} should be retryable`);
  }
  for (const status of [400, 422]) {
    const state = reduceSubmission({ httpStatus: status, payload: null }, key);
    assert.equal(state.status === "ERROR" && state.retryable, false, `${status} should not be retryable`);
  }
});

test("the request key is random, long and stable across retries", () => {
  const keys = new Set(Array.from({ length: 200 }, () => createRequestKey()));
  assert.equal(keys.size, 200, "request keys must not collide");
  for (const key of keys) assert.match(key, /^[0-9a-f]{32}$/);

  // A retry reuses the same key, so a network failure cannot create a second
  // enquiry once the server has already stored the first.
  const key = createRequestKey();
  const first = reduceSubmission({ httpStatus: 0, payload: null }, key);
  const second = reduceSubmission({ httpStatus: 200, payload: { ok: true, reference: "QT-9", requestKey: key } }, key);
  assert.equal(first.status === "ERROR" && first.requestKey, key);
  assert.equal(second.status === "SUCCESS" && second.requestKey, key);
});

test("the verified telephone numbers stay available when the form cannot be used", () => {
  assert.deepEqual([...VERIFIED_CONTACT_NUMBERS], ["063-194-1191", "085-680-2082"]);
  assert.equal(shouldOfferTelephoneFallback({ status: "IDLE" }), true);
  assert.equal(shouldOfferTelephoneFallback({ status: "ERROR", message: "x", requestKey: "k", retryable: true }), true);
  assert.equal(shouldOfferTelephoneFallback({ status: "SUCCESS", reference: "QT-1", requestKey: "k" }), false);
});
