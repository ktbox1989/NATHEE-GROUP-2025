import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Two invariants decide whether this platform can be administered at all, and
// both live in the database rather than the application:
//
//  - there is always at least one active OWNER, so nobody can lock everyone out;
//  - a role and a company scope always agree, so a customer role cannot exist
//    without the company that scopes what it may see.
//
// The readiness contract requires these triggers to be present. Nothing proved
// what they actually do, which means "present" was the whole of the guarantee.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));

function migrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status)
    VALUES ('owner-1', 'auth-owner-1', 'owner1@example.test', 'Owner One', 'OWNER', NULL, 'ACTIVE');
    INSERT INTO user_role_assignments (user_id, role) VALUES ('owner-1', 'OWNER');
  `);
  return db;
}

function addOwner(db, id) {
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status)
    VALUES ('${id}', 'auth-${id}', '${id}@example.test', 'Owner', 'OWNER', NULL, 'ACTIVE');
    INSERT INTO user_role_assignments (user_id, role) VALUES ('${id}', 'OWNER');
  `);
}

function activeOwners(db) {
  return db
    .prepare(
      `SELECT COUNT(*) AS total FROM users u
       LEFT JOIN user_role_assignments r ON r.user_id = u.id
       WHERE u.status = 'ACTIVE'
         AND COALESCE(r.role, CASE u.role WHEN 'OWNER' THEN 'OWNER' WHEN 'CUSTOMER' THEN 'CUSTOMER_VIEWER' ELSE 'STAFF' END) = 'OWNER'`,
    )
    .get().total;
}

test("the last active OWNER cannot be deactivated", () => {
  const db = migrated();
  assert.equal(activeOwners(db), 1);
  assert.throws(
    () => db.exec("UPDATE users SET status = 'INACTIVE' WHERE id = 'owner-1'"),
    /owner/i,
  );
  assert.equal(activeOwners(db), 1, "the platform still has someone who can administer it");
  db.close();
});

test("the last active OWNER cannot be archived either", () => {
  const db = migrated();
  assert.throws(() => db.exec("UPDATE users SET status = 'ARCHIVED' WHERE id = 'owner-1'"), /owner/i);
  assert.equal(activeOwners(db), 1);
  db.close();
});

test("the last active OWNER cannot be demoted through the legacy role column", () => {
  const db = migrated();
  // Refused as an incompatible pairing rather than by the last-owner rule: the
  // assignment still says OWNER, so the account and its role would disagree.
  // The demotion is blocked either way, and this is the earlier of the two.
  assert.throws(
    () => db.exec("UPDATE users SET role = 'STAFF' WHERE id = 'owner-1'"),
    /incompatible legacy user role/i,
  );
  assert.equal(activeOwners(db), 1);

  // Removing the assignment first does not open a path either: that is what the
  // last-owner rule refuses.
  assert.throws(() => db.exec("DELETE FROM user_role_assignments WHERE user_id = 'owner-1'"), /owner/i);
  assert.equal(activeOwners(db), 1);
  db.close();
});

test("the last OWNER's role assignment cannot be changed or deleted", () => {
  const db = migrated();
  assert.throws(() => db.exec("UPDATE user_role_assignments SET role = 'STAFF' WHERE user_id = 'owner-1'"), /owner/i);
  assert.throws(() => db.exec("DELETE FROM user_role_assignments WHERE user_id = 'owner-1'"), /owner/i);
  assert.equal(activeOwners(db), 1);
  db.close();
});

test("with a second OWNER present, either one may be stood down", () => {
  const db = migrated();
  addOwner(db, "owner-2");
  assert.equal(activeOwners(db), 2);

  // The invariant is "at least one", not "never change an owner".
  db.exec("UPDATE users SET status = 'INACTIVE' WHERE id = 'owner-1'");
  assert.equal(activeOwners(db), 1);

  // And now the remaining one is protected again.
  assert.throws(() => db.exec("UPDATE users SET status = 'INACTIVE' WHERE id = 'owner-2'"), /owner/i);
  assert.equal(activeOwners(db), 1);
  db.close();
});

test("an inactive OWNER does not count towards the guarantee", () => {
  const db = migrated();
  addOwner(db, "owner-2");
  db.exec("UPDATE users SET status = 'INACTIVE' WHERE id = 'owner-2'");
  assert.equal(activeOwners(db), 1);
  // owner-1 is now the last *active* owner, even though two OWNER rows exist.
  assert.throws(() => db.exec("UPDATE users SET status = 'INACTIVE' WHERE id = 'owner-1'"), /owner/i);
  db.close();
});

test("a customer role cannot exist without the company that scopes it", () => {
  const db = migrated();
  // The account itself cannot be created company-less, so an unscoped customer
  // role has nothing to attach to. The guarantee holds one step earlier than the
  // role assignment.
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status)
        VALUES ('cust-orphan', 'auth-orphan', 'orphan@example.test', 'Orphan', 'CUSTOMER', NULL, 'ACTIVE')
      `),
    /ck_customer_requires_company/,
  );

  // And an internal account, which may legitimately have no company, still
  // cannot be handed a customer role.
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status)
    VALUES ('staff-orphan', 'auth-so', 'so@example.test', 'พนักงาน', 'STAFF', NULL, 'ACTIVE');
  `);
  assert.throws(
    () => db.exec("INSERT INTO user_role_assignments (user_id, role) VALUES ('staff-orphan', 'CUSTOMER_VIEWER')"),
    /role/i,
  );
  db.close();
});

test("a role assignment must agree with the account's own kind", () => {
  const db = migrated();
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status) VALUES
      ('cust-1', 'auth-c1', 'c1@example.test', 'ลูกค้า', 'CUSTOMER', 'company-a', 'ACTIVE'),
      ('staff-1', 'auth-s1', 's1@example.test', 'พนักงาน', 'STAFF', NULL, 'ACTIVE');
  `);
  // A customer account may not be given an internal role.
  for (const role of ["OWNER", "ADMIN", "STAFF", "WAREHOUSE"]) {
    assert.throws(
      () => db.exec(`INSERT INTO user_role_assignments (user_id, role) VALUES ('cust-1', '${role}')`),
      /role/i,
      `a CUSTOMER account must not receive ${role}`,
    );
  }
  // And a staff account may not be given a customer role.
  for (const role of ["CUSTOMER_ADMIN", "CUSTOMER_VIEWER"]) {
    assert.throws(
      () => db.exec(`INSERT INTO user_role_assignments (user_id, role) VALUES ('staff-1', '${role}')`),
      /role/i,
      `a STAFF account must not receive ${role}`,
    );
  }
  // The compatible pairings are accepted.
  db.exec("INSERT INTO user_role_assignments (user_id, role) VALUES ('cust-1', 'CUSTOMER_VIEWER')");
  db.exec("INSERT INTO user_role_assignments (user_id, role) VALUES ('staff-1', 'WAREHOUSE')");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM user_role_assignments").get().total, 3);
  db.close();
});

test("an existing assignment cannot be updated into an incompatible pairing", () => {
  const db = migrated();
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status)
    VALUES ('cust-1', 'auth-c1', 'c1@example.test', 'ลูกค้า', 'CUSTOMER', 'company-a', 'ACTIVE');
    INSERT INTO user_role_assignments (user_id, role) VALUES ('cust-1', 'CUSTOMER_VIEWER');
  `);
  assert.throws(
    () => db.exec("UPDATE user_role_assignments SET role = 'OWNER' WHERE user_id = 'cust-1'"),
    /role/i,
    "a customer must not be promoted to OWNER by editing the assignment alone",
  );
  // Moving between two customer roles is legitimate.
  db.exec("UPDATE user_role_assignments SET role = 'CUSTOMER_ADMIN' WHERE user_id = 'cust-1'");
  assert.equal(
    db.prepare("SELECT role FROM user_role_assignments WHERE user_id = 'cust-1'").get().role,
    "CUSTOMER_ADMIN",
  );
  db.close();
});

test("a customer account cannot be created without a company at all", () => {
  const db = migrated();
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO users (id, external_auth_id, email, display_name, role, company_id, status)
        VALUES ('cust-2', 'auth-c2', 'c2@example.test', 'ไร้บริษัท', 'CUSTOMER', NULL, 'ACTIVE')
      `),
    /constraint/i,
  );
  db.close();
});
