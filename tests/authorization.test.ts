import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCan,
  AuthorizationError,
  can,
  effectiveRoleFromLegacy,
  isCustomerRole,
  legacyRoleFor,
  usesExplicitPermissions,
} from "../lib/authorization.ts";

test("owner has access to every company and capability", () => {
  const owner = { userId: "owner-1", role: "OWNER" as const, companyId: null };
  assert.equal(can(owner, "companies:write", "company-b"), true);
  assert.equal(can(owner, "audit:read"), true);
  assert.equal(can(owner, "yard:write"), true);
  assert.equal(can(owner, "gallery:publish"), true);
});

test("staff access requires an explicit capability", () => {
  const staff = {
    userId: "staff-1",
    role: "STAFF" as const,
    companyId: null,
    permissions: ["jobs:read", "yard:read", "gallery:read", "gallery:write"] as const,
  };
  assert.equal(can(staff, "jobs:read", "company-a"), true);
  assert.equal(can(staff, "jobs:write", "company-a"), false);
  assert.equal(can(staff, "yard:read"), true);
  assert.equal(can(staff, "yard:write"), false);
  assert.equal(can(staff, "gallery:write"), true);
  assert.equal(can(staff, "gallery:publish"), false);
});

test("every non-owner internal role is fail-closed without explicit permissions", () => {
  for (const role of ["ADMIN", "STAFF", "SALE", "WAREHOUSE", "CHECKER", "DRIVER", "ACCOUNTING"] as const) {
    const actor = { userId: `user-${role}`, role, companyId: null, permissions: ["jobs:read"] as const };
    assert.equal(usesExplicitPermissions(role), true);
    assert.equal(can(actor, "jobs:read"), true);
    assert.equal(can(actor, "jobs:write"), false);
    assert.equal(legacyRoleFor(role), "STAFF");
  }
});

test("customer roles can read only records owned by their company", () => {
  for (const role of ["CUSTOMER_ADMIN", "CUSTOMER_VIEWER"] as const) {
    const customer = { userId: `customer-${role}`, role, companyId: "company-a" };
    assert.equal(isCustomerRole(role), true);
    assert.equal(legacyRoleFor(role), "CUSTOMER");
    assert.equal(can(customer, "motorcycles:read", "company-a"), true);
    assert.equal(can(customer, "motorcycles:read", "company-b"), false);
    assert.equal(can(customer, "motorcycles:write", "company-a"), false);
    assert.equal(can(customer, "motorcycles:read"), false);
    assert.equal(can(customer, "yard:read", "company-a"), false);
    assert.equal(can(customer, "gallery:read", "company-a"), false);
  }
});

test("legacy roles preserve access without locking out existing users", () => {
  assert.equal(effectiveRoleFromLegacy("OWNER"), "OWNER");
  assert.equal(effectiveRoleFromLegacy("STAFF"), "STAFF");
  assert.equal(effectiveRoleFromLegacy("CUSTOMER"), "CUSTOMER_VIEWER");
});

test("a denied operation throws a generic authorization error", () => {
  const customer = {
    userId: "customer-1",
    role: "CUSTOMER_VIEWER" as const,
    companyId: "company-a",
  };
  assert.throws(
    () => assertCan(customer, "images:read", "company-b"),
    AuthorizationError,
  );
});
