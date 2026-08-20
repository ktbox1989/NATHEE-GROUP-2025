import assert from "node:assert/strict";
import test from "node:test";
import { parseQuotationForm } from "../lib/quotation.ts";
import {
  prepareQuotationAttachments,
  quotationAttachmentDisposition,
  safeAttachmentFilename,
} from "../lib/quotation-attachments.ts";
import {
  QUOTATION_TURNSTILE_ACTION,
  turnstileKeysReady,
  turnstileRemoteIp,
  validTurnstileVerification,
  verifyTurnstile,
} from "../lib/turnstile.ts";

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

test("quotation attachments accept verified PDF, CSV, XLSX and image bytes", async () => {
  const form = new FormData();
  form.append("attachments", new File(["%PDF-1.7\nreal"], "รายละเอียด.pdf", { type: "application/pdf" }));
  form.append("attachments", new File(["registration,vin\n1กข1234,VIN001\n"], "รายการรถ.csv", { type: "text/csv" }));
  form.append("attachments", new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "[Content_Types].xml xl/workbook.xml"], "รายการรถ.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  form.append("attachments", new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "ภาพรถ.jpg", { type: "image/jpeg" }));
  const result = await prepareQuotationAttachments(form);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.map((item) => item.contentType), ["application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/jpeg"]);
  assert.ok(result.value.every((item) => /^[0-9a-f]{64}$/.test(item.checksum)));
});

test("quotation attachments reject executable, MIME mismatch, forged signatures and duplicates", async () => {
  for (const file of [
    new File(["MZ"], "payload.exe", { type: "application/octet-stream" }),
    new File(["%PDF-1.7"], "wrong.jpg", { type: "image/jpeg" }),
    new File(["not a pdf"], "forged.pdf", { type: "application/pdf" }),
  ]) {
    const form = new FormData(); form.append("attachments", file);
    assert.equal((await prepareQuotationAttachments(form)).ok, false);
  }
  const duplicate = new FormData();
  duplicate.append("attachments", new File(["a,b\n1,2\n"], "one.csv", { type: "text/csv" }));
  duplicate.append("attachments", new File(["a,b\n1,2\n"], "two.csv", { type: "text/csv" }));
  assert.deepEqual(await prepareQuotationAttachments(duplicate), { ok: false, error: "file_type" });
});

test("quotation attachment bounds and filename headers fail closed", async () => {
  const tooMany = new FormData();
  for (let index = 0; index < 6; index += 1) tooMany.append("attachments", new File([`a${index}`], `${index}.csv`, { type: "text/csv" }));
  assert.deepEqual(await prepareQuotationAttachments(tooMany), { ok: false, error: "file_count" });
  const tooLarge = new FormData();
  tooLarge.append("attachments", new File([new Uint8Array(8 * 1024 * 1024 + 1)], "oversized.csv", { type: "text/csv" }));
  assert.deepEqual(await prepareQuotationAttachments(tooLarge), { ok: false, error: "file_size" });
  const tooLargeTogether = new FormData();
  for (let index = 0; index < 3; index += 1) tooLargeTogether.append("attachments", new File([new Uint8Array(7 * 1024 * 1024)], `${index}.csv`, { type: "text/csv" }));
  assert.deepEqual(await prepareQuotationAttachments(tooLargeTogether), { ok: false, error: "file_size" });
  assert.equal(safeAttachmentFilename("../../รายการรถ.csv"), "รายการรถ.csv");
  assert.equal(safeAttachmentFilename("bad\u202Efdp.exe"), "badfdp.exe");
  const disposition = quotationAttachmentDisposition("รายการรถ.csv");
  assert.match(disposition, /^attachment; filename="[_]+\.csv"; filename\*=UTF-8''/);
  assert.doesNotMatch(disposition, /[\r\n]/);
});

test("Turnstile configuration and response checks require exact hostname and action", () => {
  const siteKey = "1x00000000000000000000AA";
  const secretKey = `1x${"0".repeat(31)}AA`;
  assert.equal(turnstileKeysReady(siteKey, secretKey), true);
  assert.equal(turnstileKeysReady("turnstile_site_key_replace_me", secretKey), false);
  assert.equal(validTurnstileVerification({ success: true, hostname: "natheegroup2025.com", action: QUOTATION_TURNSTILE_ACTION }, "natheegroup2025.com"), true);
  assert.equal(validTurnstileVerification({ success: true, hostname: "attacker.invalid", action: QUOTATION_TURNSTILE_ACTION }, "natheegroup2025.com"), false);
  assert.equal(validTurnstileVerification({ success: true, hostname: "natheegroup2025.com", action: "login" }, "natheegroup2025.com"), false);
  assert.equal(turnstileRemoteIp(" 2001:db8::1 "), "2001:db8::1");
  assert.equal(turnstileRemoteIp("forwarded-for: attacker"), null);
});

test("Turnstile Siteverify keeps the secret in POST body and retries fail-closed", async () => {
  const bodies: string[] = [];
  let calls = 0;
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    bodies.push(String(init?.body ?? ""));
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return Response.json({ success: true, hostname: "natheegroup2025.com", action: QUOTATION_TURNSTILE_ACTION });
  };
  const result = await verifyTurnstile({
    token: "verified-browser-token",
    remoteIp: "203.0.113.10",
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    expectedHostname: "natheegroup2025.com",
    secretKey: `1x${"0".repeat(31)}AA`,
    fetcher: fetcher as typeof fetch,
  });
  assert.equal(result, true);
  assert.equal(calls, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.match(bodies[0], /response=verified-browser-token/);
  assert.match(bodies[0], /idempotency_key=123e4567-e89b-42d3-a456-426614174000/);
  assert.equal(await verifyTurnstile({ token: "", remoteIp: null, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", expectedHostname: "natheegroup2025.com", secretKey: `1x${"0".repeat(31)}AA`, fetcher: fetcher as typeof fetch }), false);
});
