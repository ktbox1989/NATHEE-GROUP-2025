import assert from "node:assert/strict";
import test from "node:test";
import {
  assertManagedUserChange,
  hasManagedUserChange,
  MemberLifecycleError,
  normalizeManagedCompany,
  normalizeManagedPermissions,
  type ManagedUserState,
} from "../lib/member-lifecycle.ts";

const owner: ManagedUserState = {
  userId: "owner-a",
  role: "OWNER",
  companyId: null,
  status: "ACTIVE",
  permissions: [],
};

test("permissions are allowlisted, deduplicated and only retained for explicit roles", () => {
  assert.deepEqual(
    normalizeManagedPermissions("ADMIN", ["jobs:write", "bad", "jobs:read", "jobs:write"]),
    ["jobs:read", "jobs:write"],
  );
  assert.deepEqual(normalizeManagedPermissions("OWNER", ["jobs:write"]), []);
  assert.deepEqual(normalizeManagedPermissions("CUSTOMER_ADMIN", ["jobs:write"]), []);
});

test("customer roles require a company while internal roles are unscoped", () => {
  assert.equal(normalizeManagedCompany("CUSTOMER_VIEWER", " company-a "), "company-a");
  assert.equal(normalizeManagedCompany("WAREHOUSE", "company-a"), null);
  assert.throws(
    () => normalizeManagedCompany("CUSTOMER_ADMIN", null),
    (error) => error instanceof MemberLifecycleError && error.code === "INVALID_COMPANY",
  );
});

test("an owner cannot demote or deactivate their own active identity", () => {
  assert.throws(
    () => assertManagedUserChange({
      actorUserId: owner.userId,
      before: owner,
      after: { ...owner, role: "ADMIN" },
      activeOwnerCount: 2,
    }),
    (error) => error instanceof MemberLifecycleError && error.code === "SELF_LOCKOUT",
  );
  assert.throws(
    () => assertManagedUserChange({
      actorUserId: owner.userId,
      before: owner,
      after: { ...owner, status: "INACTIVE" },
      activeOwnerCount: 2,
    }),
    (error) => error instanceof MemberLifecycleError && error.code === "SELF_LOCKOUT",
  );
});

test("the final active owner cannot be removed by another owner", () => {
  assert.throws(
    () => assertManagedUserChange({
      actorUserId: "owner-b",
      before: owner,
      after: { ...owner, status: "INACTIVE" },
      activeOwnerCount: 1,
    }),
    (error) => error instanceof MemberLifecycleError && error.code === "LAST_OWNER",
  );
});

test("a second owner can safely deactivate an owner and permission order is stable", () => {
  const before: ManagedUserState = {
    userId: "staff-a",
    role: "STAFF",
    companyId: null,
    status: "ACTIVE",
    permissions: ["jobs:read", "jobs:write"],
  };
  const equivalent = { ...before, permissions: ["jobs:write", "jobs:read"] as const };
  assert.equal(hasManagedUserChange(before, equivalent), false);
  assert.doesNotThrow(() => assertManagedUserChange({
    actorUserId: "owner-b",
    before: owner,
    after: { ...owner, status: "INACTIVE" },
    activeOwnerCount: 2,
  }));
});
