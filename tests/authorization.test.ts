import assert from "node:assert/strict";
import test from "node:test";
import { assertCan, AuthorizationError, can } from "../lib/authorization.ts";

test("owner has access to every company and capability", () => {
  const owner = { userId: "owner-1", role: "OWNER" as const, companyId: null };
  assert.equal(can(owner, "companies:write", "company-b"), true);
  assert.equal(can(owner, "audit:read"), true);
});

test("staff access requires an explicit capability", () => {
  const staff = {
    userId: "staff-1",
    role: "STAFF" as const,
    companyId: null,
    permissions: ["jobs:read"] as const,
  };
  assert.equal(can(staff, "jobs:read", "company-a"), true);
  assert.equal(can(staff, "jobs:write", "company-a"), false);
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
