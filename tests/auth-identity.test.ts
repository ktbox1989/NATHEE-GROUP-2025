import assert from "node:assert/strict";
import test from "node:test";
import { confirmedAuthIdentity } from "../lib/auth-identity.ts";

const validIdentity = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  email: " Owner@Example.com ",
  email_confirmed_at: "2026-08-21T00:00:00.000Z",
};

test("confirmed authentication identity is canonicalized", () => {
  assert.deepEqual(confirmedAuthIdentity(validIdentity), {
    externalAuthId: validIdentity.id,
    email: "owner@example.com",
  });
});

test("unconfirmed, malformed or incomplete identities fail closed", () => {
  assert.equal(confirmedAuthIdentity({ ...validIdentity, email_confirmed_at: undefined }), null);
  assert.equal(confirmedAuthIdentity({ ...validIdentity, id: "pending:owner@example.com" }), null);
  assert.equal(confirmedAuthIdentity({ ...validIdentity, id: "not-a-uuid" }), null);
  assert.equal(confirmedAuthIdentity({ ...validIdentity, email: "" }), null);
  assert.equal(confirmedAuthIdentity(null), null);
});
