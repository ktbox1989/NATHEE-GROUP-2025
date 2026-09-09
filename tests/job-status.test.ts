import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedJobTransitions,
  canTransitionJob,
  jobCompletionIssue,
  parseJobStatus,
} from "../lib/job-status.ts";

test("job statuses only move through the operational lifecycle", () => {
  assert.deepEqual(allowedJobTransitions("OPEN"), ["IN_PROGRESS", "CANCELLED"]);
  assert.deepEqual(allowedJobTransitions("IN_PROGRESS"), ["COMPLETED", "CANCELLED"]);
  assert.deepEqual(allowedJobTransitions("COMPLETED"), []);
  assert.deepEqual(allowedJobTransitions("CANCELLED"), []);

  assert.equal(canTransitionJob("OPEN", "IN_PROGRESS"), true);
  assert.equal(canTransitionJob("OPEN", "COMPLETED"), false);
  assert.equal(canTransitionJob("COMPLETED", "IN_PROGRESS"), false);
});

test("job status parser fails closed", () => {
  assert.equal(parseJobStatus("OPEN"), "OPEN");
  assert.equal(parseJobStatus("completed"), null);
  assert.equal(parseJobStatus("DELETE"), null);
});
test("a job cannot be completed while motorcycles are still active", () => {
  assert.equal(jobCompletionIssue([]), "no_motorcycles");
  assert.equal(
    jobCompletionIssue(["DELIVERED", "IN_TRANSIT"]),
    "pending_motorcycles",
  );
  assert.equal(
    jobCompletionIssue(["DELIVERED", "CLOSED", "CANCELLED"]),
    null,
  );
});
