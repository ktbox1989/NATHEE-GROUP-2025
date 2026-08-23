import assert from "node:assert/strict";
import test from "node:test";
import {
  QUOTATION_ATTACHMENT_LIMITS,
  QUOTATION_EXTRAS,
  QUOTATION_LIMITS,
  QUOTATION_VEHICLE_TYPES,
  UNMAPPABLE_QUOTATION_FIELDS,
  VERIFIED_CONTACT_NUMBERS,
  buildQuotationFormData,
  createRequestKey,
  isQuotationReference,
  isWireRequestKey,
  normalisePhone,
  reduceSubmission,
  shouldOfferTelephoneFallback,
  validateQuotationAttachments,
  validateQuotationDraft,
  type QuotationDraft,
} from "../lib/public-forms/quotation-contract.ts";
import { QUOTATION_EXTRAS as SERVER_EXTRAS, QUOTATION_VEHICLE_TYPES as SERVER_VEHICLE_TYPES } from "../lib/quotation.ts";

function draft(overrides: Partial<QuotationDraft> = {}): QuotationDraft {
  return {
    companyName: "",
    contactName: "คุณสมชาย",
    phone: "063-194-1191",
    lineId: "",
    email: "",
    origin: "กรุงเทพฯ",
    destination: "เชียงใหม่",
    quantity: "12",
    vehicleType: "MOTORCYCLE",
    desiredDate: "",
    extras: [],
    notes: "",
    consent: true,
    ...overrides,
  };
}

const APP_ORIGIN = "https://app.natheegroup2025.com";
const redirectTo = (query: string) => `${APP_ORIGIN}/quotation?${query}`;

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

test("company and LINE are optional, because many customers are neither", () => {
  assert.deepEqual(validateQuotationDraft(draft({ companyName: "", lineId: "" })), []);
  assert.deepEqual(validateQuotationDraft(draft({ companyName: "ร้านมอเตอร์ไซค์", lineId: "@nathee" })), []);
});

test("consent is required before the enquiry can be stored", () => {
  const errors = validateQuotationDraft(draft({ consent: false }));
  assert.ok(errors.some((error) => error.field === "consent"));
});

test("the vehicle type must be one the server stores", () => {
  for (const vehicleType of QUOTATION_VEHICLE_TYPES) {
    assert.deepEqual(validateQuotationDraft(draft({ vehicleType })), []);
  }
  for (const vehicleType of ["", "SCOOTER", "motorcycle"] as QuotationDraft["vehicleType"][]) {
    assert.ok(
      validateQuotationDraft(draft({ vehicleType })).some((error) => error.field === "vehicleType"),
      `${vehicleType} should be rejected`,
    );
  }
});

test("the desired date is optional but must be a real calendar date", () => {
  assert.deepEqual(validateQuotationDraft(draft({ desiredDate: "" })), []);
  assert.deepEqual(validateQuotationDraft(draft({ desiredDate: "2026-09-01" })), []);
  for (const desiredDate of ["2026-13-01", "2026-02-30", "01/09/2026", "2026-9-1"]) {
    assert.ok(
      validateQuotationDraft(draft({ desiredDate })).some((error) => error.field === "desiredDate"),
      `${desiredDate} should be rejected`,
    );
  }
});

test("service extras are limited to the ones the server understands", () => {
  assert.deepEqual(validateQuotationDraft(draft({ extras: ["STORAGE", "CONTAINER", "INTERNATIONAL", "LARGE_BATCH"] })), []);
  assert.ok(
    validateQuotationDraft(draft({ extras: ["EXPRESS"] as unknown as QuotationDraft["extras"] })).some(
      (error) => error.field === "extras",
    ),
  );
});

// --- the reconciliation with Lane B ----------------------------------------

test("the accepted vehicle types and extras are exactly the server's", () => {
  // Drifting apart here is silent: the browser offers a choice the server
  // rejects as `invalid`, and the customer sees a validation error with
  // nothing wrong on their form.
  assert.deepEqual([...QUOTATION_VEHICLE_TYPES], [...SERVER_VEHICLE_TYPES]);
  assert.deepEqual([...QUOTATION_EXTRAS], [...SERVER_EXTRAS]);
});

test("client bounds match the server's, so nothing is silently truncated", () => {
  // The server trims with slice() rather than rejecting, so a client bound
  // looser than the server's loses the tail of what the customer typed.
  assert.equal(QUOTATION_LIMITS.companyName.max, 160);
  assert.equal(QUOTATION_LIMITS.contactName.max, 120);
  assert.equal(QUOTATION_LIMITS.lineId.max, 100);
  assert.equal(QUOTATION_LIMITS.email.max, 254);
  assert.equal(QUOTATION_LIMITS.origin.max, 180);
  assert.equal(QUOTATION_LIMITS.destination.max, 180);
  assert.equal(QUOTATION_LIMITS.notes.max, 1500);
  // And a bound tighter than the server's refuses an enquiry it would have
  // accepted. A dealer moving a whole shipment is a real customer.
  assert.equal(QUOTATION_LIMITS.quantity.max, 10_000);
  assert.deepEqual(validateQuotationDraft(draft({ quantity: "10000" })), []);
});

test("the quantity must be a whole number within the supported range", () => {
  for (const quantity of ["0", "-1", "10001", "abc", "1.5", ""]) {
    assert.ok(
      validateQuotationDraft(draft({ quantity })).some((error) => error.field === "quantity"),
      `${quantity} should be rejected`,
    );
  }
  for (const quantity of ["1", "50", "10000"]) {
    assert.deepEqual(
      validateQuotationDraft(draft({ quantity })).filter((error) => error.field === "quantity"),
      [],
    );
  }
});

test("over-long free text is reported rather than quietly cut off", () => {
  assert.ok(
    validateQuotationDraft(draft({ notes: "ก".repeat(QUOTATION_LIMITS.notes.max + 1) })).some(
      (error) => error.field === "notes",
    ),
  );
  assert.deepEqual(validateQuotationDraft(draft({ notes: "ก".repeat(QUOTATION_LIMITS.notes.max) })), []);
});

test("a question the server cannot store is not asked", () => {
  // New/used has no column in quote_requests, and an unknown form field is
  // discarded without comment. Asking would put a question on the form whose
  // answer is thrown away.
  const fields = UNMAPPABLE_QUOTATION_FIELDS.map((entry) => entry.field);
  assert.deepEqual(fields, ["condition"]);
  const form = buildQuotationFormData(draft(), createRequestKey());
  for (const field of fields) assert.equal(form.get(field), null, `${field} must not be sent`);
});

test("every problem is reported at once rather than one per submission", () => {
  const errors = validateQuotationDraft(
    draft({ contactName: "", phone: "x", origin: "", destination: "", quantity: "0", vehicleType: "", consent: false }),
  );
  assert.ok(errors.length >= 7, `expected several errors, got ${errors.length}`);
});

// --- the wire format -------------------------------------------------------

test("the request key is the format the server actually parses", () => {
  // The previous format — 32 bare hex characters — was rejected by
  // parseQuotationForm as `invalid` before reaching D1, so every submission
  // would have failed while looking like a validation problem on the form.
  const keys = new Set(Array.from({ length: 200 }, () => createRequestKey()));
  assert.equal(keys.size, 200, "request keys must not collide");
  for (const key of keys) assert.ok(isWireRequestKey(key), `${key} must satisfy the server's pattern`);

  assert.equal(isWireRequestKey("2c78a52121bb1d5a98e148c7a195dd0a"), false);
  assert.equal(isWireRequestKey(crypto.randomUUID()), false, "the quote- prefix is load-bearing");
  assert.equal(isWireRequestKey(`quote-${crypto.randomUUID()}`), true);
});

test("the form body carries the server's field names, not this module's", () => {
  const form = buildQuotationFormData(
    draft({
      companyName: "ร้านมอเตอร์ไซค์",
      lineId: "@nathee",
      email: "owner@natheegroup2025.com",
      desiredDate: "2026-09-01",
      extras: ["STORAGE", "CONTAINER", "STORAGE"],
      notes: "รับที่หน้าร้าน",
    }),
    "quote-11111111-2222-4333-8444-555555555555",
  );

  assert.equal(form.get("requestKey"), "quote-11111111-2222-4333-8444-555555555555");
  assert.equal(form.get("companyName"), "ร้านมอเตอร์ไซค์");
  assert.equal(form.get("contactName"), "คุณสมชาย");
  assert.equal(form.get("phone"), "063-194-1191");
  assert.equal(form.get("lineId"), "@nathee");
  assert.equal(form.get("email"), "owner@natheegroup2025.com");
  assert.equal(form.get("origin"), "กรุงเทพฯ");
  assert.equal(form.get("destination"), "เชียงใหม่");
  assert.equal(form.get("quantity"), "12");
  assert.equal(form.get("vehicleType"), "MOTORCYCLE");
  assert.equal(form.get("desiredDate"), "2026-09-01");
  assert.equal(form.get("notes"), "รับที่หน้าร้าน");
  // Repeated entries, de-duplicated: that is how getAll reads them.
  assert.deepEqual(form.getAll("extras"), ["STORAGE", "CONTAINER"]);
  // The literal the server compares against, and the honeypot it checks first.
  assert.equal(form.get("privacyConsent"), "yes");
  assert.equal(form.get("website"), "");
});

test("consent that is not the server's literal is sent as refused", () => {
  const form = buildQuotationFormData(draft({ consent: false }), createRequestKey());
  assert.notEqual(form.get("privacyConsent"), "yes");
});

test("a malformed request key fails here rather than at the server", () => {
  assert.throws(() => buildQuotationFormData(draft(), "abc123"), /quote-/);
  assert.throws(() => buildQuotationFormData(draft(), crypto.randomUUID()), /quote-/);
});

test("attachments are checked against the limits the server enforces", () => {
  assert.deepEqual(validateQuotationAttachments([{ name: "list.xlsx", size: 1024 }]), []);
  assert.deepEqual(validateQuotationAttachments([{ name: "list.csv", size: 1024 }]), []);
  assert.deepEqual(validateQuotationAttachments([{ name: "bike.jpg", size: 1024 }]), []);

  const tooMany = Array.from({ length: QUOTATION_ATTACHMENT_LIMITS.maxCount + 1 }, () => ({ name: "a.jpg", size: 10 }));
  assert.ok(validateQuotationAttachments(tooMany).some((error) => error.field === "attachments"));

  assert.ok(
    validateQuotationAttachments([{ name: "big.jpg", size: QUOTATION_ATTACHMENT_LIMITS.maxBytesEach + 1 }]).length > 0,
  );
  assert.ok(
    validateQuotationAttachments(
      Array.from({ length: 4 }, () => ({ name: "a.jpg", size: 6 * 1024 * 1024 })),
    ).some((error) => error.field === "attachments"),
    "the combined total is checked as well as each file",
  );
  assert.ok(validateQuotationAttachments([{ name: "notes.exe", size: 10 }]).length > 0);
  assert.ok(validateQuotationAttachments([{ name: "noextension", size: 10 }]).length > 0);
});

// --- the rule that matters -------------------------------------------------

test("only the server's own redirect carrying a real request number is success", () => {
  const key = createRequestKey();
  const state = reduceSubmission(
    { httpStatus: 200, finalUrl: redirectTo("submitted=QT-2026-000042") },
    key,
  );
  assert.equal(state.status, "SUCCESS");
  assert.equal(state.status === "SUCCESS" && state.reference, "QT-2026-000042");
  assert.equal(state.status === "SUCCESS" && state.requestKey, key);
});

test("a 303 observed without following the redirect is read the same way", () => {
  // Whether the client follows the redirect or reads Location itself, the
  // evidence is identical, and a relative Location is normal.
  const key = createRequestKey();
  const state = reduceSubmission({ httpStatus: 303, finalUrl: "/quotation?submitted=QT-2026-000042" }, key);
  assert.equal(state.status, "SUCCESS");
});

test("a bare 200 is never reported as success", () => {
  const key = createRequestKey();
  // An HTML page, an empty body, a redirect that landed somewhere else: all of
  // these are 200s that mean nothing was stored.
  const outcomes: Array<{ httpStatus: number; finalUrl: string | null; contentType?: string | null }> = [
    { httpStatus: 200, finalUrl: null },
    { httpStatus: 200, finalUrl: `${APP_ORIGIN}/quotation`, contentType: "text/html" },
    { httpStatus: 200, finalUrl: `${APP_ORIGIN}/`, contentType: "text/html" },
    { httpStatus: 200, finalUrl: "not a url at all" },
    { httpStatus: 201, finalUrl: null },
  ];
  for (const outcome of outcomes) {
    const state = reduceSubmission(outcome, key);
    assert.equal(state.status, "ERROR", `${JSON.stringify(outcome)} must not be a success`);
  }
});

test("a reference that is not a business number is refused", () => {
  const key = createRequestKey();
  for (const reference of ["", "   ", "QT-1", "ok", "QT-2026-42", "<script>", "QT-2026-0000001"]) {
    const state = reduceSubmission({ httpStatus: 200, finalUrl: redirectTo(`submitted=${encodeURIComponent(reference)}`) }, key);
    assert.equal(state.status, "ERROR", `reference "${reference}" must not succeed`);
  }
  assert.equal(isQuotationReference("QT-2026-000001"), true);
  assert.equal(isQuotationReference("QT-2026-1"), false);
});

test("a URL carrying both parameters is never read as a success", () => {
  const key = createRequestKey();
  const state = reduceSubmission(
    { httpStatus: 200, finalUrl: redirectTo("error=save&submitted=QT-2026-000042") },
    key,
  );
  assert.equal(state.status, "ERROR");
});

test("every failure code the server can emit is answered", () => {
  const key = createRequestKey();
  const codes = ["invalid", "consent", "bot", "challenge", "file_count", "file_size", "file_type", "file_name", "save", "cleanup"];
  for (const code of codes) {
    const state = reduceSubmission({ httpStatus: 200, finalUrl: redirectTo(`error=${code}`) }, key);
    assert.equal(state.status, "ERROR", `${code} must be an error`);
    assert.ok(state.status === "ERROR" && state.message.length > 0, `${code} must say something useful`);
  }
  // A code this file has never seen must not be mistaken for anything else.
  const unknown = reduceSubmission({ httpStatus: 200, finalUrl: redirectTo("error=something_new") }, key);
  assert.equal(unknown.status, "ERROR");
  assert.equal(unknown.status === "ERROR" && unknown.retryable, true);
});

test("a rejected submission is not offered as retryable when retrying cannot help", () => {
  const key = createRequestKey();
  for (const code of ["invalid", "consent", "bot", "file_count", "file_size", "file_type", "file_name", "cleanup"]) {
    const state = reduceSubmission({ httpStatus: 200, finalUrl: redirectTo(`error=${code}`) }, key);
    assert.equal(state.status === "ERROR" && state.retryable, false, `${code} should not be retryable`);
  }
  for (const code of ["challenge", "save"]) {
    const state = reduceSubmission({ httpStatus: 200, finalUrl: redirectTo(`error=${code}`) }, key);
    assert.equal(state.status === "ERROR" && state.retryable, true, `${code} should be retryable`);
  }
});

test("transport failures are retryable and never claim success", () => {
  const key = createRequestKey();
  for (const status of [500, 502, 503, 0, 429, 403]) {
    const state = reduceSubmission({ httpStatus: status, finalUrl: null }, key);
    assert.equal(state.status, "ERROR");
    assert.equal(state.status === "ERROR" && state.retryable, true, `${status} should be retryable`);
  }
});

test("the request key is stable across retries so a retry cannot double-book", () => {
  // The server looks the key up first and returns the original request number
  // rather than storing a second enquiry.
  const key = createRequestKey();
  const first = reduceSubmission({ httpStatus: 0, finalUrl: null }, key);
  const second = reduceSubmission({ httpStatus: 303, finalUrl: redirectTo("submitted=QT-2026-000007") }, key);
  assert.equal(first.status === "ERROR" && first.requestKey, key);
  assert.equal(second.status === "SUCCESS" && second.requestKey, key);
  assert.equal(second.status === "SUCCESS" && second.reference, "QT-2026-000007");
});

test("the verified telephone numbers stay available when the form cannot be used", () => {
  assert.deepEqual([...VERIFIED_CONTACT_NUMBERS], ["063-194-1191", "085-680-2082"]);
  assert.equal(shouldOfferTelephoneFallback({ status: "IDLE" }), true);
  assert.equal(shouldOfferTelephoneFallback({ status: "ERROR", message: "x", requestKey: "k", retryable: true }), true);
  assert.equal(shouldOfferTelephoneFallback({ status: "SUCCESS", reference: "QT-2026-000001", requestKey: "k" }), false);
});
