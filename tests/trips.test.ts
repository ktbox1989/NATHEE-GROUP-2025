import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedTripTransitions,
  bangkokInputToUtc,
  canTransitionTrip,
  canTransitionTripAssignment,
  isTripRequestKey,
  isPlannedTripOrderValid,
  normalizeRegistration,
  normalizeLoadBoardSearch,
  normalizeTruckCode,
  motorcycleStatusAllowsAssignmentState,
  parseTruckCapacity,
  tripReadinessIssue,
  tripStatusAllowsAssignmentTransition,
  TRIP_PAGE_SIZE,
} from "../lib/trips.ts";

test("truck input is canonical and capacity remains optional", () => {
  assert.equal(normalizeTruckCode(" ng 01 "), "NG-01");
  assert.equal(normalizeTruckCode("รถ-1"), null);
  assert.equal(normalizeRegistration(" 1กข   1234 "), "1กข 1234");
  assert.equal(normalizeRegistration("ก".repeat(31)), undefined);
  assert.equal(parseTruckCapacity(""), null);
  assert.equal(parseTruckCapacity("24"), 24);
  assert.equal(parseTruckCapacity("0"), undefined);
  assert.equal(parseTruckCapacity("1.5"), undefined);
});

test("load-board prefix search is bounded and rejects wildcard scans", () => {
  assert.equal(normalizeLoadBoardSearch("  JOB-2026-001  "), "JOB-2026-001");
  assert.equal(normalizeLoadBoardSearch("1กข  1234"), "1กข 1234");
  assert.equal(normalizeLoadBoardSearch(""), null);
  assert.equal(normalizeLoadBoardSearch("x"), undefined);
  assert.equal(normalizeLoadBoardSearch("%"), undefined);
  assert.equal(normalizeLoadBoardSearch("ABC*"), undefined);
  assert.equal(normalizeLoadBoardSearch("a".repeat(51)), undefined);
});

test("load assignment state follows the audited motorcycle workflow", () => {
  assert.equal(canTransitionTripAssignment("ASSIGNED", "LOADED"), true);
  assert.equal(canTransitionTripAssignment("ASSIGNED", "UNLOADED"), false);
  assert.equal(canTransitionTripAssignment("LOADED", "UNLOADED"), true);
  assert.equal(canTransitionTripAssignment("UNLOADED", "RELEASED"), true);
  assert.equal(canTransitionTripAssignment("RELEASED", "ASSIGNED"), false);
  assert.equal(motorcycleStatusAllowsAssignmentState("ASSIGNED", "SCHEDULED"), true);
  assert.equal(motorcycleStatusAllowsAssignmentState("ASSIGNED", "IN_YARD"), false);
  assert.equal(motorcycleStatusAllowsAssignmentState("LOADED", "LOADED"), true);
  assert.equal(motorcycleStatusAllowsAssignmentState("UNLOADED", "ARRIVED"), true);
  assert.equal(motorcycleStatusAllowsAssignmentState("UNLOADED", "IN_TRANSIT"), false);
  assert.equal(tripStatusAllowsAssignmentTransition("ASSIGNED", "LOADED", "LOADING"), true);
  assert.equal(tripStatusAllowsAssignmentTransition("ASSIGNED", "LOADED", "PLANNED"), false);
  assert.equal(tripStatusAllowsAssignmentTransition("LOADED", "UNLOADED", "ARRIVED"), true);
  assert.equal(tripStatusAllowsAssignmentTransition("UNLOADED", "RELEASED", "COMPLETED"), true);
});

test("trip readiness never infers motorcycle workflow completion", () => {
  assert.match(tripReadinessIssue("LOADING", []) ?? "", /อย่างน้อย 1/);
  assert.match(tripReadinessIssue("IN_TRANSIT", [{ state: "ASSIGNED", motorcycleStatus: "SCHEDULED" }]) ?? "", /ขึ้นรถ/);
  assert.match(tripReadinessIssue("IN_TRANSIT", [{ state: "LOADED", motorcycleStatus: "LOADED" }]) ?? "", /กำลังขนส่ง/);
  assert.equal(tripReadinessIssue("IN_TRANSIT", [{ state: "LOADED", motorcycleStatus: "IN_TRANSIT" }]), null);
  assert.match(tripReadinessIssue("COMPLETED", [{ state: "LOADED", motorcycleStatus: "ARRIVED" }]) ?? "", /ลงรถ/);
  assert.match(tripReadinessIssue("COMPLETED", [{ state: "UNLOADED", motorcycleStatus: "ARRIVED" }]) ?? "", /ส่งมอบ/);
  assert.equal(tripReadinessIssue("COMPLETED", [{ state: "UNLOADED", motorcycleStatus: "DELIVERED" }]), null);
  assert.match(tripReadinessIssue("CANCELLED", [{ state: "LOADED", motorcycleStatus: "LOADED" }]) ?? "", /ยกเลิก/);
});

test("Bangkok planning input becomes timezone-aware UTC and rejects malformed values", () => {
  assert.equal(bangkokInputToUtc("2026-08-21T09:30"), "2026-08-21T02:30:00.000Z");
  assert.equal(bangkokInputToUtc(""), null);
  assert.equal(bangkokInputToUtc("21/08/2026 09:30"), undefined);
  assert.equal(bangkokInputToUtc("2026-02-30T09:30"), undefined);
  assert.equal(isPlannedTripOrderValid("2026-08-21T02:30:00.000Z", "2026-08-21T05:00:00.000Z"), true);
  assert.equal(isPlannedTripOrderValid("2026-08-21T05:00:00.000Z", "2026-08-21T02:30:00.000Z"), false);
});

test("trip lifecycle is ordered and terminal states cannot restart", () => {
  assert.deepEqual(allowedTripTransitions("DRAFT"), ["PLANNED", "CANCELLED"]);
  assert.equal(canTransitionTrip("PLANNED", "LOADING"), true);
  assert.equal(canTransitionTrip("PLANNED", "IN_TRANSIT"), false);
  assert.equal(canTransitionTrip("IN_TRANSIT", "ARRIVED"), true);
  assert.equal(canTransitionTrip("COMPLETED", "PLANNED"), false);
  assert.equal(canTransitionTrip("CANCELLED", "DRAFT"), false);
  assert.equal(TRIP_PAGE_SIZE, 50);
  assert.equal(isTripRequestKey("0198f708-44a3-7ef7-8d4f-4f477922ff2a"), true);
  assert.equal(isTripRequestKey("not-a-request"), false);
});
