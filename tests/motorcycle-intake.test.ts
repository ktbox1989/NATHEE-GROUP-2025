import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditMotorcycleIntake,
  motorcycleIntakeFingerprint,
  parseMotorcycleIntakeForm,
  type MotorcycleIntakeSnapshot,
} from "../lib/motorcycle-intake.ts";

function validForm() {
  const form = new FormData();
  form.set("make", " Honda ");
  form.set("model", "Wave 125i");
  form.set("modelYear", "2026");
  form.set("registration", "กข 123");
  form.set("vin", "vin-0001");
  form.set("vehicleCondition", "NEW");
  return form;
}

test("intake create normalizes canonical fields and requires VIN or engine number", () => {
  const parsed = parseMotorcycleIntakeForm(validForm(), new Date("2026-08-27T00:00:00Z"));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.values.make, "Honda");
  assert.equal(parsed.values.vin, "VIN-0001");
  assert.equal(parsed.values.registration, "กข 123");
  assert.equal(parsed.values.modelYear, 2026);

  const missingIdentity = validForm();
  missingIdentity.delete("vin");
  assert.deepEqual(parseMotorcycleIntakeForm(missingIdentity), { ok: false, error: "validation" });
});

test("intake create rejects overlong, future and invalid-enum data", () => {
  const overlong = validForm();
  overlong.set("notes", "x".repeat(1001));
  assert.equal(parseMotorcycleIntakeForm(overlong).ok, false);
  const future = validForm();
  future.set("modelYear", "2028");
  assert.equal(parseMotorcycleIntakeForm(future, new Date("2026-08-27T00:00:00Z")).ok, false);
  const invalidCondition = validForm();
  invalidCondition.set("vehicleCondition", "DEMO");
  assert.equal(parseMotorcycleIntakeForm(invalidCondition).ok, false);
});

test("intake edit closes once the canonical receipt workflow advances", () => {
  assert.equal(canEditMotorcycleIntake("PENDING_RECEIPT"), true);
  for (const status of ["RECEIVED", "INSPECTED", "IN_YARD", "CANCELLED"] as const) {
    assert.equal(canEditMotorcycleIntake(status), false, status);
  }
});

test("intake edit fingerprint changes for same-second concurrent data changes", async () => {
  const snapshot: MotorcycleIntakeSnapshot = {
    id: "motorcycle-a",
    currentStatus: "PENDING_RECEIPT",
    updatedAt: "2026-08-27 10:00:00",
    make: "Honda",
    model: "Wave 125i",
    variant: null,
    modelYear: 2026,
    color: "แดง",
    registration: null,
    province: null,
    vin: "VIN-A",
    engineNumber: null,
    vehicleCondition: "NEW",
    notes: null,
  };
  const original = await motorcycleIntakeFingerprint(snapshot);
  const concurrent = await motorcycleIntakeFingerprint({ ...snapshot, color: "น้ำเงิน" });
  assert.match(original, /^[0-9a-f]{64}$/);
  assert.notEqual(original, concurrent);
  assert.equal(await motorcycleIntakeFingerprint({ ...snapshot }), original);
});
