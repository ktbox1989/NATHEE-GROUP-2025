import assert from "node:assert/strict";
import test from "node:test";
import { parseQuotationForm } from "../lib/quotation.ts";

function validForm() {
  const form = new FormData();
  form.set("requestKey", "quote-123e4567-e89b-42d3-a456-426614174000");
  form.set("contactName", "สมชาย ใจดี");
  form.set("phone", "081-234-5678");
  form.set("origin", "กรุงเทพฯ");
  form.set("destination", "เชียงใหม่");
  form.set("quantity", "12");
  form.set("vehicleType", "MOTORCYCLE");
  form.set("privacyConsent", "yes");
  form.append("extras", "STORAGE");
  return form;
}

test("quotation accepts bounded real request data and normalizes phone", () => {
  const parsed = parseQuotationForm(validForm());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.phone, "0812345678");
  assert.equal(parsed.value.quantity, 12);
  assert.deepEqual(parsed.value.extras, ["STORAGE"]);
});

test("quotation rejects missing consent, honeypot and malformed identity", () => {
  const noConsent = validForm(); noConsent.delete("privacyConsent");
  assert.deepEqual(parseQuotationForm(noConsent), { ok: false, error: "consent" });
  const bot = validForm(); bot.set("website", "https://spam.example");
  assert.deepEqual(parseQuotationForm(bot), { ok: false, error: "bot" });
  const badKey = validForm(); badKey.set("requestKey", "predictable");
  assert.deepEqual(parseQuotationForm(badKey), { ok: false, error: "invalid" });
});

test("quotation rejects invalid phone, quantities, dates and extras", () => {
  for (const [field, value] of [["phone", "123"], ["quantity", "0"], ["quantity", "10001"], ["desiredDate", "2026-02-31"], ["vehicleType", "CAR"]]) {
    const form = validForm(); form.set(field, value);
    assert.deepEqual(parseQuotationForm(form), { ok: false, error: "invalid" }, `${field}=${value}`);
  }
  const badExtra = validForm(); badExtra.append("extras", "ADMIN");
  assert.deepEqual(parseQuotationForm(badExtra), { ok: false, error: "invalid" });
});

test("quotation accepts international Thai phone and optional fields", () => {
  const form = validForm();
  form.set("phone", "+66812345678");
  form.set("email", " OWNER@EXAMPLE.COM ");
  form.set("desiredDate", "2026-09-30");
  const parsed = parseQuotationForm(form);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.phone, "0812345678");
  assert.equal(parsed.value.email, "owner@example.com");
});
