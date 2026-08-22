import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_VIEWS,
  auditRowDetail,
  auditViewActions,
  auditViewKeys,
  DEFAULT_AUDIT_VIEW,
  isAuditViewKey,
  parseAuditView,
} from "../lib/audit-view.ts";
import { AUTH_EVENT_ACTIONS, AUTH_EVENT_ENTITY_TYPE, authEventDetail } from "../lib/auth-events.ts";

test("an unknown view is a wrong URL, not a silent fallback to everything", () => {
  assert.equal(parseAuditView(undefined), undefined);
  assert.equal(parseAuditView(""), undefined);
  assert.equal(parseAuditView("all"), "all");
  assert.equal(parseAuditView("auth"), "auth");
  assert.equal(parseAuditView("access"), "access");
  for (const invalid of ["everything", "AUTH", "all;drop", "__proto__", "constructor", "toString"]) {
    assert.equal(parseAuditView(invalid), null, invalid);
  }
});

test("view keys are the ones the page offers, and the default shows everything", () => {
  assert.deepEqual([...auditViewKeys()], ["all", "auth", "access"]);
  assert.equal(DEFAULT_AUDIT_VIEW, "all");
  assert.equal(auditViewActions("all"), null);
  assert.ok(auditViewKeys().every((key) => AUDIT_VIEWS[key].label.length > 0));
});

test("the sign-in view covers exactly the authentication actions that are recorded", () => {
  assert.deepEqual([...(auditViewActions("auth") ?? [])], [...AUTH_EVENT_ACTIONS]);
  assert.deepEqual([...(auditViewActions("access") ?? [])], ["INVITE", "UPDATE_ACCESS"]);
});

test("prototype keys cannot be smuggled in as a view", () => {
  assert.equal(isAuditViewKey("hasOwnProperty"), false);
  assert.equal(isAuditViewKey("__proto__"), false);
});

test("an explicit reason always wins over a derived one", () => {
  assert.equal(auditRowDetail("user", null, "ปรับสิทธิ์ตามคำขอ"), "ปรับสิทธิ์ตามคำขอ");
  assert.equal(
    auditRowDetail(AUTH_EVENT_ENTITY_TYPE, authEventDetail("password"), "เหตุผลที่บันทึกไว้"),
    "เหตุผลที่บันทึกไว้",
  );
});

test("an authentication row reads as how the person proved who they were", () => {
  assert.equal(auditRowDetail(AUTH_EVENT_ENTITY_TYPE, authEventDetail("password"), null), "ยืนยันด้วยรหัสผ่าน");
  assert.equal(
    auditRowDetail(AUTH_EVENT_ENTITY_TYPE, authEventDetail("recovery_link"), null),
    "ยืนยันด้วยลิงก์ทางอีเมล",
  );
  assert.equal(
    auditRowDetail(AUTH_EVENT_ENTITY_TYPE, authEventDetail("current_password"), null),
    "ยืนยันด้วยรหัสผ่านปัจจุบัน",
  );
});

test("a payload that is not a recognised authentication detail renders nothing", () => {
  for (const payload of [
    null,
    "",
    "not json",
    "{}",
    '{"method":"telepathy"}',
    '{"method":123}',
    '{"method":"<script>alert(1)</script>"}',
    '["password"]',
  ]) {
    assert.equal(auditRowDetail(AUTH_EVENT_ENTITY_TYPE, payload, null), null, String(payload));
  }
  // A business row carries its own payload and must not be read as a method.
  assert.equal(auditRowDetail("motorcycle", '{"method":"password"}', null), null);
});
