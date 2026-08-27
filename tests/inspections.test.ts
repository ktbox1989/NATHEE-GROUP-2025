import assert from "node:assert/strict";
import test from "node:test";
import {
  parseReceiptEvidence,
  receiptEvidenceMatches,
  receiptInspectionHasFourAngles,
} from "../lib/intake-inspection.ts";
import {
  canCreateProofOfDelivery,
  inspectionTypeAllowedForStatus,
  isReasonableRecordedTime,
  maskPhone,
  normalizeInspectionText,
  parseOdometerKm,
} from "../lib/inspections.ts";

test("inspection types are limited to compatible motorcycle workflow states", () => {
  assert.equal(inspectionTypeAllowedForStatus("RECEIPT", "RECEIVED"), true);
  assert.equal(inspectionTypeAllowedForStatus("RECEIPT", "IN_TRANSIT"), false);
  assert.equal(inspectionTypeAllowedForStatus("PRE_LOAD", "SCHEDULED"), true);
  assert.equal(inspectionTypeAllowedForStatus("DELIVERY", "ARRIVED"), true);
  assert.equal(inspectionTypeAllowedForStatus("DELIVERY", "IN_YARD"), false);
});

test("inspection and POD text/odometer input is canonical and bounded", () => {
  assert.equal(normalizeInspectionText("  กันชน   หน้า  ", { max: 100 }), "กันชน หน้า");
  assert.equal(normalizeInspectionText("", { max: 100 }), null);
  assert.equal(normalizeInspectionText("x", { min: 3, max: 100 }), undefined);
  assert.equal(parseOdometerKm("1200"), 1200);
  assert.equal(parseOdometerKm(""), null);
  assert.equal(parseOdometerKm("-1"), undefined);
  assert.equal(parseOdometerKm("10000001"), undefined);
});

test("proof of delivery is created only after arrival and phone output is masked", () => {
  assert.equal(canCreateProofOfDelivery("ARRIVED"), true);
  assert.equal(canCreateProofOfDelivery("IN_TRANSIT"), false);
  assert.equal(canCreateProofOfDelivery("DELIVERED"), false);
  assert.equal(maskPhone("0812345678"), "••••••5678");
  assert.equal(maskPhone(null), "ไม่ระบุ");
  assert.equal(isReasonableRecordedTime("2026-08-21T05:00:00.000Z", Date.parse("2026-08-21T05:10:00.000Z")), true);
  assert.equal(isReasonableRecordedTime("2026-08-21T05:30:01.000Z", Date.parse("2026-08-21T05:10:00.000Z")), false);
});

test("receipt evidence requires four distinct, correctly categorised images from the same motorcycle", () => {
  const form = new FormData();
  form.set("leftImageId", "left");
  form.set("rightImageId", "right");
  form.set("frontImageId", "front");
  form.set("rearImageId", "rear");
  const evidence = parseReceiptEvidence(form);
  assert.ok(evidence);
  const metadata = [
    { id: "left", motorcycleId: "mc-a", companyId: "company-a", category: "LEFT" as const },
    { id: "right", motorcycleId: "mc-a", companyId: "company-a", category: "RIGHT" as const },
    { id: "front", motorcycleId: "mc-a", companyId: "company-a", category: "FRONT" as const },
    { id: "rear", motorcycleId: "mc-a", companyId: "company-a", category: "REAR" as const },
  ];
  assert.equal(receiptEvidenceMatches(evidence, metadata, "mc-a", "company-a"), true);
  assert.equal(receiptEvidenceMatches(evidence, metadata, "mc-b", "company-a"), false);
  assert.equal(receiptEvidenceMatches({ ...evidence, leftImageId: "front" }, metadata, "mc-a", "company-a"), false);
});

test("receipt completion is false until every canonical angle is linked", () => {
  assert.equal(receiptInspectionHasFourAngles({ leftImageId: "left", rightImageId: "right", frontImageId: "front", rearImageId: "rear" }), true);
  assert.equal(receiptInspectionHasFourAngles({ leftImageId: "left", rightImageId: "right", frontImageId: null, rearImageId: "rear" }), false);
  const missing = new FormData();
  missing.set("leftImageId", "left");
  assert.equal(parseReceiptEvidence(missing), null);
});
