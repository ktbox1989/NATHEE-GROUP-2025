import assert from "node:assert/strict";
import test from "node:test";
import { assertCan, AuthorizationError, can } from "../lib/authorization.ts";

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

test("customer can read only records owned by its company", () => {
  const customer = {
    userId: "customer-1",
    role: "CUSTOMER" as const,
    companyId: "company-a",
  };
  assert.equal(can(customer, "motorcycles:read", "company-a"), true);
  assert.equal(can(customer, "motorcycles:read", "company-b"), false);
  assert.equal(can(customer, "motorcycles:write", "company-a"), false);
  assert.equal(can(customer, "motorcycles:read"), false);
  assert.equal(can(customer, "yard:read", "company-a"), false);
  assert.equal(can(customer, "gallery:read", "company-a"), false);
});

test("a denied operation throws a generic authorization error", () => {
  const customer = {
    userId: "customer-1",
    role: "CUSTOMER" as const,
    companyId: "company-a",
  };
  assert.throws(
    () => assertCan(customer, "images:read", "company-b"),
    AuthorizationError,
  );
});
