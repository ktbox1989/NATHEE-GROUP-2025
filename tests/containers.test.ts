import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedContainerTransitions,
  canTransitionContainerAssignment,
  containerReadinessIssue,
  containerStatusAllowsAssignmentTransition,
  motorcycleStatusAllowsContainerAssignmentState,
  normalizeContainerNumber,
  normalizeContainerText,
} from "../lib/containers.ts";

test("ISO 6346 container numbers are canonical and check-digit verified", () => {
  assert.equal(normalizeContainerNumber("CSQU 305438-3"), "CSQU3054383");
  assert.equal(normalizeContainerNumber("CSQU3054382"), null);
  assert.equal(normalizeContainerNumber("ABCX1234567"), null);
  assert.equal(normalizeContainerNumber(""), null);
});

test("container port, country and seal text remain bounded", () => {
  assert.equal(normalizeContainerText("  Laem   Chabang  "), "Laem Chabang");
  assert.equal(normalizeContainerText(""), null);
  assert.equal(normalizeContainerText("x".repeat(101)), undefined);
  assert.equal(normalizeContainerText("SEAL-001", 50), "SEAL-001");
});

test("container lifecycle is linear and fail-closed after the seal is applied", () => {
  assert.deepEqual(allowedContainerTransitions("DRAFT"), ["PLANNED", "CANCELLED"]);
  assert.deepEqual(allowedContainerTransitions("LOADING"), ["SEALED", "CANCELLED"]);
  assert.deepEqual(allowedContainerTransitions("SEALED"), ["IN_TRANSIT"]);
  assert.deepEqual(allowedContainerTransitions("COMPLETED"), []);
});

test("container assignment transitions require matching container and motorcycle states", () => {
  assert.equal(canTransitionContainerAssignment("ASSIGNED", "LOADED"), true);
  assert.equal(canTransitionContainerAssignment("LOADED", "RELEASED"), false);
  assert.equal(motorcycleStatusAllowsContainerAssignmentState("LOADED", "LOADED"), true);
  assert.equal(motorcycleStatusAllowsContainerAssignmentState("LOADED", "IN_TRANSIT"), false);
  assert.equal(containerStatusAllowsAssignmentTransition("ASSIGNED", "LOADED", "LOADING"), true);
  assert.equal(containerStatusAllowsAssignmentTransition("LOADED", "UNLOADED", "ARRIVED"), false);
  assert.equal(containerStatusAllowsAssignmentTransition("LOADED", "UNLOADED", "UNLOADING"), true);
});

test("container readiness requires real load, seal and motorcycle workflow evidence", () => {
  const assigned = [{ state: "ASSIGNED" as const, motorcycleStatus: "SCHEDULED" as const }];
  const loaded = [{ state: "LOADED" as const, motorcycleStatus: "LOADED" as const }];
  const travelling = [{ state: "LOADED" as const, motorcycleStatus: "IN_TRANSIT" as const }];
  const arrived = [{ state: "LOADED" as const, motorcycleStatus: "ARRIVED" as const }];
  const delivered = [{ state: "UNLOADED" as const, motorcycleStatus: "DELIVERED" as const }];

  assert.match(containerReadinessIssue("PLANNED", [], null) ?? "", /อย่างน้อย 1/);
  assert.equal(containerReadinessIssue("PLANNED", assigned, null), null);
  assert.match(containerReadinessIssue("SEALED", loaded, null) ?? "", /Seal/);
  assert.match(containerReadinessIssue("SEALED", assigned, "SEAL-001") ?? "", /ครบทุกคัน/);
  assert.equal(containerReadinessIssue("SEALED", loaded, "SEAL-001"), null);
  assert.equal(containerReadinessIssue("IN_TRANSIT", travelling, "SEAL-001"), null);
  assert.equal(containerReadinessIssue("ARRIVED", arrived, "SEAL-001"), null);
  assert.equal(containerReadinessIssue("UNLOADING", arrived, "SEAL-001"), null);
  assert.equal(containerReadinessIssue("COMPLETED", delivered, "SEAL-001"), null);
  assert.match(containerReadinessIssue("CANCELLED", loaded, "SEAL-001") ?? "", /ยกเลิก/);
});
