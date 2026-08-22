import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CUSTOMER_USER_ROLES, INTERNAL_USER_ROLES } from "../db/schema.ts";
import { can, PERMISSIONS, type Permission } from "../lib/authorization.ts";

// Customer A must never see Customer B. That property is enforced in two
// places: the shape of can(), and the requirement that every route touching
// company-owned data actually calls an authorization check. Both are tested
// here, because a leak needs only one of them to regress.

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const OTHER_COMPANY = "company-b";
const OWN_COMPANY = "company-a";

function customerActor(role: (typeof CUSTOMER_USER_ROLES)[number]) {
  return { userId: "customer-1", role, companyId: OWN_COMPANY };
}

test("no customer role can ever hold a write capability", () => {
  const writePermissions = PERMISSIONS.filter((permission) => !permission.endsWith(":read"));
  assert.ok(writePermissions.length > 0, "the permission list must contain write capabilities");

  for (const role of CUSTOMER_USER_ROLES) {
    for (const permission of writePermissions) {
      // Including their own company: a customer is read-only everywhere.
      assert.equal(
        can(customerActor(role), permission, OWN_COMPANY),
        false,
        `${role} must not hold ${permission} for its own company`,
      );
      assert.equal(can(customerActor(role), permission, OTHER_COMPANY), false);
    }
  }
});

test("a customer is denied every capability for another company", () => {
  for (const role of CUSTOMER_USER_ROLES) {
    for (const permission of PERMISSIONS) {
      assert.equal(
        can(customerActor(role), permission, OTHER_COMPANY),
        false,
        `${role} must not hold ${permission} for another company`,
      );
    }
  }
});

test("a customer is denied when the target company is unknown", () => {
  // Internal-only surfaces call can(actor, permission) with no company. That
  // must deny customers by construction, otherwise every such page leaks.
  for (const role of CUSTOMER_USER_ROLES) {
    for (const permission of PERMISSIONS) {
      assert.equal(can(customerActor(role), permission), false, `${role}/${permission} with no company`);
      assert.equal(can(customerActor(role), permission, null), false, `${role}/${permission} with null company`);
      assert.equal(can(customerActor(role), permission, undefined), false);
    }
  }
});

test("a customer without a company is denied even for a matching target", () => {
  for (const role of CUSTOMER_USER_ROLES) {
    const orphan = { userId: "customer-2", role, companyId: null };
    for (const permission of PERMISSIONS) {
      assert.equal(can(orphan, permission, OWN_COMPANY), false, `${role}/${permission}`);
      assert.equal(can(orphan, permission, null), false);
    }
  }
});

test("an internal role holds nothing it was not explicitly granted", () => {
  for (const role of INTERNAL_USER_ROLES) {
    if (role === "OWNER") continue;
    const bare = { userId: "staff-1", role, companyId: null, permissions: [] as Permission[] };
    for (const permission of PERMISSIONS) {
      assert.equal(can(bare, permission, OWN_COMPANY), false, `${role} must not hold ${permission} by default`);
    }

    // A granted capability must not become a different one.
    const granted = { userId: "staff-1", role, companyId: null, permissions: ["motorcycles:read"] as Permission[] };
    assert.equal(can(granted, "motorcycles:read", OWN_COMPANY), true);
    assert.equal(can(granted, "motorcycles:write", OWN_COMPANY), false);
    assert.equal(can(granted, "audit:read", OWN_COMPANY), false);
  }
});

// Tables whose rows belong to exactly one customer company. A route reading
// one of these without an authorization call is a cross-tenant leak.
const COMPANY_OWNED_TABLES = [
  "motorcycles",
  "transportJobs",
  "companies",
  "motorcycleImages",
  "proofOfDeliveryRecords",
  "motorcycleInspections",
  "tripMotorcycleAssignments",
  "containerMotorcycleAssignments",
  "motorcycleImportBatches",
  "galleryItems",
  "statusEvents",
  "yardPlacements",
];

// Each recognised way a route can establish authority. `can-internal-only` is
// safe for customers precisely because of the "unknown target company" test
// above: with no company argument, can() denies every customer role.
const AUTHORIZATION_MECHANISMS: ReadonlyArray<[string, RegExp]> = [
  ["can+company", /can\(actor,\s*"[a-z:]+",/],
  ["can-internal-only", /can\(actor,\s*"[a-z:]+"\)/],
  ["customer-branch", /isCustomerRole\(/],
  ["owner-only", /actor\.role\s*!==\s*"OWNER"/],
  ["self-scoped", /actor\.userId/],
  ["shared-helper", /operationalQrResponse/],
];

async function routeFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await routeFiles(path)));
    else if (entry.isFile() && (entry.name === "route.ts" || entry.name === "page.tsx")) found.push(path);
  }
  return found;
}

test("every route reading company-owned data performs an authorization check", async () => {
  const files = [
    ...(await routeFiles(join(repositoryRoot, "app", "api"))),
    ...(await routeFiles(join(repositoryRoot, "app", "app"))),
  ];
  assert.ok(files.length > 40, `expected the full route set, found ${files.length}`);

  const unguarded: string[] = [];
  let inspected = 0;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const readsCompanyData = COMPANY_OWNED_TABLES.some((table) => new RegExp(`\\b${table}\\b`).test(source));
    if (!readsCompanyData) continue;

    inspected += 1;
    const mechanisms = AUTHORIZATION_MECHANISMS.filter(([, pattern]) => pattern.test(source));
    if (mechanisms.length === 0) {
      unguarded.push(relative(repositoryRoot, file).replaceAll("\\", "/"));
    }
  }

  assert.ok(inspected >= 45, `expected the company-data routes to be found, inspected ${inspected}`);
  assert.deepEqual(
    unguarded,
    [],
    `these routes read company-owned data with no authorization check:\n${unguarded.join("\n")}`,
  );
});

test("the guard actually detects an unguarded route", async () => {
  // A guard that cannot fail proves nothing, so confirm the detection logic
  // rejects a route that reads company data and never checks authority.
  const leakySource = [
    'import { getDb } from "@/db";',
    'import { motorcycles } from "@/db/schema";',
    "export async function GET() {",
    "  return Response.json(await getDb().select().from(motorcycles).all());",
    "}",
  ].join("\n");

  const readsCompanyData = COMPANY_OWNED_TABLES.some((table) => new RegExp(`\\b${table}\\b`).test(leakySource));
  assert.equal(readsCompanyData, true, "the fixture must be recognised as reading company data");
  assert.equal(
    AUTHORIZATION_MECHANISMS.filter(([, pattern]) => pattern.test(leakySource)).length,
    0,
    "the fixture must be reported as unguarded",
  );
});
