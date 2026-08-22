import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVILEGED_ACTIONS,
  PRIVILEGED_ACTION_MESSAGES,
  privilegedActionMessage,
  privilegedProofAccepted,
  REAUTHENTICATION_ERROR,
  submittedCurrentPassword,
} from "../lib/privileged-action.ts";

// Inviting a member and changing a role decide who may act at all. Holding a
// session was enough to do either, which meant a stolen OWNER session could
// invite a second OWNER and keep that access after the real Owner changed their
// password — persistence, not just impersonation.

test("the privileged set is exactly the actions that decide who may act", () => {
  assert.deepEqual([...PRIVILEGED_ACTIONS], ["INVITE_MEMBER", "UPDATE_ACCESS"]);
});

test("only a verified current password is an accepted proof", () => {
  assert.equal(privilegedProofAccepted("current_password"), true);
  assert.equal(privilegedProofAccepted("none"), false);
});

test("an absent password and a wrong one are both simply refused", () => {
  // Reporting them differently would tell an attacker which half to work on.
  assert.equal(submittedCurrentPassword(null), "");
  assert.equal(submittedCurrentPassword(""), "");
  assert.equal(submittedCurrentPassword("correct horse"), "correct horse");
});

test("a submitted password is bounded before it is forwarded to the provider", () => {
  assert.equal(submittedCurrentPassword("a".repeat(200)).length, 200);
  assert.equal(submittedCurrentPassword("a".repeat(201)), "");
  // A file upload entry is not a password.
  assert.equal(submittedCurrentPassword({ name: "x" } as never), "");
});

test("every refusal the guard can produce has operator-facing copy", () => {
  for (const code of ["reauthenticate", "wrong_password", "too_many_attempts", "unavailable"]) {
    const message = privilegedActionMessage(code);
    assert.ok(message && message.length > 0, `${code} has no message`);
    assert.equal(PRIVILEGED_ACTION_MESSAGES[code], message);
  }
  assert.equal(privilegedActionMessage(undefined), null);
  assert.equal(privilegedActionMessage("something_else"), null);
});

test("the refusal code the admin pages read is the one the routes emit", () => {
  assert.equal(REAUTHENTICATION_ERROR, "reauthenticate");
  assert.ok(PRIVILEGED_ACTION_MESSAGES[REAUTHENTICATION_ERROR]);
});
