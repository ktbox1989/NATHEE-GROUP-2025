import assert from "node:assert/strict";
import test from "node:test";
import { isSafeNotificationHref, statusNotificationContent } from "../lib/notifications.ts";

test("status notification content is derived from a real status and local record link", () => {
  assert.deepEqual(statusNotificationContent({
    motorcycleId: "motorcycle-a",
    publicId: "mc_public_a",
    newStatus: "IN_TRANSIT",
  }), {
    title: "สถานะรถมีการอัปเดต",
    body: "mc_public_a · กำลังขนส่ง",
    severity: "INFO",
    href: "/app/motorcycles/motorcycle-a",
  });
});

test("operational exceptions are visibly elevated without exposing private data", () => {
  const damaged = statusNotificationContent({
    motorcycleId: "motorcycle-a",
    publicId: "mc_public_a",
    newStatus: "DAMAGED",
  });
  assert.equal(damaged.severity, "CRITICAL");
  assert.equal(damaged.title, "มีสถานะรถที่ต้องตรวจสอบ");
  assert.doesNotMatch(damaged.body, /VIN|engine|phone|email/i);
});

test("notification navigation accepts only local application paths", () => {
  assert.equal(isSafeNotificationHref("/app/motorcycles/motorcycle-a"), true);
  assert.equal(isSafeNotificationHref("https://attacker.example/app/a"), false);
  assert.equal(isSafeNotificationHref("//attacker.example/app/a"), false);
  assert.equal(isSafeNotificationHref("/app/..\\login"), false);
  assert.equal(isSafeNotificationHref("/app/%2e%2e/login"), false);
});
