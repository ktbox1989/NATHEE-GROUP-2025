import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A motorcycle could not be in two trips at once, but the truck carrying it and
// the driver driving it could. Both are physical objects that can only be in one
// place, so the asymmetry was a real conflict the planner could create.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));

const ACTIVE = ["PLANNED", "LOADING", "IN_TRANSIT", "ARRIVED"];

function migrated() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER'),
           ('driver-a', 'auth-driver-a', 'driver-a@example.test', 'Driver A', 'STAFF'),
           ('driver-b', 'auth-driver-b', 'driver-b@example.test', 'Driver B', 'STAFF');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('owner-a', 'OWNER', 'owner-a'),
           ('driver-a', 'DRIVER', 'owner-a'),
           ('driver-b', 'DRIVER', 'owner-a');
    INSERT INTO trucks (id, request_key, public_id, code, type, created_by)
    VALUES ('truck-a', 'rk-truck-a', 'truck_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'NG-01', 'SIX_WHEEL', 'owner-a'),
           ('truck-b', 'rk-truck-b', 'truck_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'NG-02', 'SIX_WHEEL', 'owner-a');
  `);
  return db;
}

let publicSuffix = 0;
function trip(db, id, { truck = "truck-a", driver = null, status = "DRAFT" } = {}) {
  publicSuffix += 1;
  const publicId = `trip_${String(publicSuffix).padStart(2, "0")}${"a".repeat(30)}`;
  db.exec(
    `INSERT INTO trips (id, request_key, public_id, trip_number, truck_id, driver_user_id, origin, destination, status, created_by)
     VALUES ('${id}', 'rk-${id}', '${publicId}', 'TRIP-${id}', '${truck}',
             ${driver ? `'${driver}'` : "NULL"}, 'A', 'B', '${status}', 'owner-a')`,
  );
}

test("a truck cannot be committed to two trips at once", () => {
  const db = migrated();
  trip(db, "t1", { status: "IN_TRANSIT" });
  assert.throws(() => trip(db, "t2", { status: "PLANNED" }), /truck is already committed/);
  db.close();
});

test("every committed state blocks a second commitment of the same truck", () => {
  for (const status of ACTIVE) {
    const db = migrated();
    trip(db, "t1", { status });
    assert.throws(() => trip(db, "t2", { status: "PLANNED" }), /truck is already committed/, status);
    db.close();
  }
});

// A trip being drafted has not claimed anything yet, so planning several at once
// must stay possible.
test("a draft does not hold a truck", () => {
  const db = migrated();
  trip(db, "t1", { status: "DRAFT" });
  trip(db, "t2", { status: "DRAFT" });
  trip(db, "t3", { status: "PLANNED" });
  assert.equal(db.prepare("SELECT count(*) AS n FROM trips WHERE truck_id = 'truck-a'").get().n, 3);
  db.close();
});

test("a finished or cancelled trip releases its truck", () => {
  for (const status of ["COMPLETED", "CANCELLED"]) {
    const db = migrated();
    trip(db, "t1", { status });
    trip(db, "t2", { status: "PLANNED" });
    assert.equal(db.prepare("SELECT count(*) AS n FROM trips WHERE truck_id = 'truck-a'").get().n, 2, status);
    db.close();
  }
});

test("a truck cannot be moved onto a trip it is already committed elsewhere for", () => {
  const db = migrated();
  trip(db, "t1", { truck: "truck-a", status: "PLANNED" });
  trip(db, "t2", { truck: "truck-b", status: "PLANNED" });
  assert.throws(
    () => db.exec("UPDATE trips SET truck_id = 'truck-a' WHERE id = 't2'"),
    /truck is already committed/,
  );
  db.close();
});

// Promoting a draft is the ordinary way a conflict appears: two drafts on one
// truck are fine until the second is planned.
test("promoting a second draft onto a busy truck is refused", () => {
  const db = migrated();
  trip(db, "t1", { status: "DRAFT" });
  trip(db, "t2", { status: "DRAFT" });
  db.exec("UPDATE trips SET status = 'PLANNED' WHERE id = 't1'");
  assert.throws(() => db.exec("UPDATE trips SET status = 'PLANNED' WHERE id = 't2'"), /truck is already committed/);
  db.close();
});

test("a driver cannot be committed to two trips at once", () => {
  const db = migrated();
  trip(db, "t1", { truck: "truck-a", driver: "driver-a", status: "IN_TRANSIT" });
  assert.throws(
    () => trip(db, "t2", { truck: "truck-b", driver: "driver-a", status: "PLANNED" }),
    /driver is already committed/,
  );
  db.close();
});

test("a second driver may take the second truck", () => {
  const db = migrated();
  trip(db, "t1", { truck: "truck-a", driver: "driver-a", status: "IN_TRANSIT" });
  trip(db, "t2", { truck: "truck-b", driver: "driver-b", status: "PLANNED" });
  assert.equal(db.prepare("SELECT count(*) AS n FROM trips WHERE status IN ('PLANNED','IN_TRANSIT')").get().n, 2);
  db.close();
});

test("a trip with no driver assigned does not block another driverless trip", () => {
  const db = migrated();
  trip(db, "t1", { truck: "truck-a", status: "PLANNED" });
  trip(db, "t2", { truck: "truck-b", status: "PLANNED" });
  assert.equal(db.prepare("SELECT count(*) AS n FROM trips WHERE driver_user_id IS NULL").get().n, 2);
  db.close();
});

test("reassigning a busy driver onto another trip is refused", () => {
  const db = migrated();
  trip(db, "t1", { truck: "truck-a", driver: "driver-a", status: "PLANNED" });
  trip(db, "t2", { truck: "truck-b", driver: "driver-b", status: "PLANNED" });
  assert.throws(
    () => db.exec("UPDATE trips SET driver_user_id = 'driver-a' WHERE id = 't2'"),
    /driver is already committed/,
  );
  db.close();
});

// Existing rules, locked so the new triggers cannot be read as replacing them.
test("a driver must be an active user holding the driver role", () => {
  const db = migrated();
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('staff-a', 'auth-staff', 'staff@example.test', 'Staff', 'STAFF');
    INSERT INTO user_role_assignments (user_id, role, assigned_by) VALUES ('staff-a', 'STAFF', 'owner-a');
  `);
  assert.throws(
    () => trip(db, "t1", { driver: "staff-a", status: "PLANNED" }),
    /active truck and active driver role/,
  );
  db.exec("UPDATE users SET status = 'INACTIVE' WHERE id = 'driver-a'");
  assert.throws(
    () => trip(db, "t2", { driver: "driver-a", status: "PLANNED" }),
    /active truck and active driver role/,
  );
  db.close();
});

test("finding what a truck is committed to stays index-backed", () => {
  const db = migrated();
  trip(db, "t1", { status: "PLANNED" });
  const plan = db
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM trips WHERE truck_id = ? AND status IN ('PLANNED','LOADING','IN_TRANSIT','ARRIVED')")
    .all()
    .map((row) => row.detail)
    .join(" ");
  assert.match(plan, /idx_trips_truck_status/);
  db.close();
});
