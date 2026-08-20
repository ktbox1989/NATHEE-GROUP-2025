import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

function createMigratedDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migration of migrations) applyMigration(db, `${migrationDirectory}/${migration}`);
  return db;
}

function applyMigration(db, path) {
  const sql = readFileSync(path, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
}

function seedCoreRecords(db) {
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs
      (id, job_number, company_id, origin, destination, status, created_by)
    VALUES
      ('job-a', 'JOB-2026-000001', 'company-a', 'กรุงเทพฯ', 'เชียงใหม่', 'OPEN', 'owner-a');
    INSERT INTO motorcycles
      (id, public_id, company_id, job_id, sequence_number, vin, engine_number, current_status)
    VALUES
      ('motorcycle-a', 'mc_public_a', 'company-a', 'job-a', 1, 'VIN-0001', 'ENG-0001', 'IN_YARD');
  `);
}

test("fresh migrations create every phase-one table", () => {
  const db = createMigratedDatabase();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);

  assert.deepEqual(tables, [
    "audit_logs",
    "companies",
    "container_motorcycle_assignments",
    "container_status_events",
    "gallery_categories",
    "gallery_image_variants",
    "gallery_items",
    "motorcycle_images",
    "motorcycles",
    "notifications",
    "quote_requests",
    "sequence_counters",
    "shipping_containers",
    "status_events",
    "transport_jobs",
    "trip_motorcycle_assignments",
    "trip_status_events",
    "trips",
    "trucks",
    "user_permissions",
    "user_role_assignments",
    "users",
    "yard_placements",
    "yard_zones",
  ]);
  db.close();
});

test("role-system migration backfills legacy identities and enforces safe mappings", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  applyMigration(db, `${migrationDirectory}/0000_harsh_speed_demon.sql`);
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name)
    VALUES ('company-a', 'CUS-A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO users (id, external_auth_id, email, display_name, role, company_id)
    VALUES
      ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER', NULL),
      ('staff-a', 'auth-staff-a', 'staff@example.test', 'Staff', 'STAFF', NULL),
      ('customer-a', 'auth-customer-a', 'customer@example.test', 'Customer', 'CUSTOMER', 'company-a');
  `);
  applyMigration(db, `${migrationDirectory}/0004_role_system_foundation.sql`);

  assert.deepEqual(
    db.prepare("SELECT user_id, role FROM user_role_assignments ORDER BY user_id").all().map((row) => ({ ...row })),
    [
      { user_id: "customer-a", role: "CUSTOMER_VIEWER" },
      { user_id: "owner-a", role: "OWNER" },
      { user_id: "staff-a", role: "STAFF" },
    ],
  );

  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('admin-a', 'auth-admin-a', 'admin@example.test', 'Admin', 'STAFF');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('admin-a', 'ADMIN', 'owner-a');
  `);
  assert.throws(() => db.exec("UPDATE user_role_assignments SET role = 'CUSTOMER_ADMIN' WHERE user_id = 'admin-a'"));
  assert.throws(() => db.exec("UPDATE users SET company_id = NULL WHERE id = 'customer-a'"));
  assert.throws(() => db.exec("INSERT INTO user_role_assignments (user_id, role) VALUES ('missing', 'DRIVER')"));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("member lifecycle migration serializes management claims and preserves an active owner", () => {
  const db = createMigratedDatabase();
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES
      ('owner-a', 'auth-owner-a', 'owner-a@example.test', 'Owner A', 'OWNER'),
      ('staff-a', 'auth-staff-a', 'staff-a@example.test', 'Staff A', 'STAFF');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES
      ('owner-a', 'OWNER', 'owner-a'),
      ('staff-a', 'STAFF', 'owner-a');
  `);

  assert.throws(() => db.exec("UPDATE users SET status = 'INACTIVE' WHERE id = 'owner-a'"));
  assert.throws(() => db.exec("DELETE FROM user_role_assignments WHERE user_id = 'owner-a'"));

  const firstClaim = db.prepare(`
    UPDATE users
    SET management_revision = management_revision + 1,
        last_management_request_id = 'request-a'
    WHERE id = 'staff-a' AND management_revision = 0
  `).run();
  const staleClaim = db.prepare(`
    UPDATE users
    SET management_revision = management_revision + 1,
        last_management_request_id = 'request-b'
    WHERE id = 'staff-a' AND management_revision = 0
  `).run();
  assert.equal(firstClaim.changes, 1);
  assert.equal(staleClaim.changes, 0);
  assert.deepEqual(
    { ...db.prepare("SELECT management_revision, last_management_request_id FROM users WHERE id = 'staff-a'").get() },
    { management_revision: 1, last_management_request_id: "request-a" },
  );

  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-b', 'auth-owner-b', 'owner-b@example.test', 'Owner B', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('owner-b', 'OWNER', 'owner-a');
    UPDATE users SET status = 'INACTIVE' WHERE id = 'owner-a';
  `);
  assert.equal(db.prepare("SELECT status FROM users WHERE id = 'owner-a'").get().status, "INACTIVE");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("truck and trip constraints preserve fleet identity, time order and immutable history", () => {
  const db = createMigratedDatabase();
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES
      ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER'),
      ('driver-a', 'auth-driver-a', 'driver@example.test', 'Driver', 'STAFF'),
      ('staff-a', 'auth-staff-a', 'staff@example.test', 'Staff', 'STAFF');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES
      ('owner-a', 'OWNER', 'owner-a'),
      ('driver-a', 'DRIVER', 'owner-a'),
      ('staff-a', 'STAFF', 'owner-a');
    INSERT INTO trucks
      (id, request_key, public_id, code, registration, type, capacity_motorcycles, created_by)
    VALUES
      ('truck-a', '0198f708-44a3-7ef7-8d4f-4f477922ff2a', 'truck-public-a', 'NG-01', '1กข 1234', 'SIX_WHEEL', 24, 'owner-a');
    INSERT INTO trips
      (id, request_key, public_id, trip_number, truck_id, driver_user_id, origin, destination,
       planned_departure_at, planned_arrival_at, created_by)
    VALUES
      ('trip-a', '0198f708-44a3-7ef7-8d4f-4f477922ff2b', 'trip-public-a', 'TRIP-2026-000001', 'truck-a', 'driver-a',
       'กรุงเทพฯ', 'เชียงใหม่', '2026-08-21T02:30:00.000Z', '2026-08-21T12:00:00.000Z', 'owner-a');
    INSERT INTO trip_status_events (id, trip_id, previous_status, new_status, created_by)
    VALUES ('trip-event-a', 'trip-a', NULL, 'DRAFT', 'owner-a');
  `);

  assert.throws(() => db.exec(`
    INSERT INTO trucks (id, request_key, public_id, code, registration, type, capacity_motorcycles, created_by)
    VALUES ('truck-b', '0198f708-44a3-7ef7-8d4f-4f477922ff2c', 'truck-public-b', 'NG-02', '1กข 1234', 'FOUR_WHEEL', 0, 'owner-a')
  `));
  assert.throws(() => db.exec(`
    INSERT INTO trips
      (id, request_key, public_id, trip_number, truck_id, origin, destination,
       planned_departure_at, planned_arrival_at, created_by)
    VALUES
      ('trip-b', '0198f708-44a3-7ef7-8d4f-4f477922ff2d', 'trip-public-b', 'TRIP-2026-000002', 'truck-a', 'A', 'B',
       '2026-08-22T12:00:00.000Z', '2026-08-22T02:00:00.000Z', 'owner-a')
  `));
  assert.throws(() => db.exec(`
    INSERT INTO trucks (id, request_key, public_id, code, type, created_by)
    VALUES ('truck-c', '0198f708-44a3-7ef7-8d4f-4f477922ff2a', 'truck-public-c', 'NG-03', 'FOUR_WHEEL', 'owner-a')
  `));
  assert.throws(() => db.exec(`
    INSERT INTO trips
      (id, request_key, public_id, trip_number, truck_id, driver_user_id, origin, destination, created_by)
    VALUES
      ('trip-c', '0198f708-44a3-7ef7-8d4f-4f477922ff2e', 'trip-public-c', 'TRIP-2026-000003',
       'truck-a', 'staff-a', 'A', 'B', 'owner-a')
  `));
  assert.throws(() => db.exec("UPDATE trips SET driver_user_id = 'owner-a' WHERE id = 'trip-a'"));
  db.exec("UPDATE trucks SET status = 'MAINTENANCE' WHERE id = 'truck-a'");
  assert.throws(() => db.exec(`
    INSERT INTO trips
      (id, request_key, public_id, trip_number, truck_id, origin, destination, created_by)
    VALUES
      ('trip-d', '0198f708-44a3-7ef7-8d4f-4f477922ff2f', 'trip-public-d', 'TRIP-2026-000004',
       'truck-a', 'A', 'B', 'owner-a')
  `));
  assert.throws(() => db.exec("DELETE FROM trips WHERE id = 'trip-a'"));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("container registry preserves ISO identity and refuses planning before a real load assignment", () => {
  const db = createMigratedDatabase();
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-container', 'auth-owner-container', 'container@example.test', 'Owner', 'OWNER');
    INSERT INTO shipping_containers
      (id, request_key, public_id, container_number, seal_number, type, capacity_motorcycles, port, country, created_by)
    VALUES
      ('container-a', '0198f708-44a3-7ef7-8d4f-4f477922ad01', 'container-public-a', 'CSQU3054383', 'SEAL-001', '40HC', 120, 'Laem Chabang', 'Japan', 'owner-container');
    INSERT INTO container_status_events (id, container_id, previous_status, new_status, note, created_by)
    VALUES ('container-event-a', 'container-a', NULL, 'DRAFT', 'สร้างทะเบียนตู้', 'owner-container');
  `);
  assert.throws(() => db.exec(`
    INSERT INTO shipping_containers
      (id, request_key, public_id, container_number, type, port, country, created_by)
    VALUES ('container-b', '0198f708-44a3-7ef7-8d4f-4f477922ad02', 'container-public-b', 'BAD-NUMBER', '20FT', 'Port', 'Country', 'owner-container')
  `));
  assert.throws(() => db.exec("UPDATE shipping_containers SET container_number = 'CSQU3054391' WHERE id = 'container-a'"), /identity is immutable/);
  assert.throws(() => db.exec("UPDATE shipping_containers SET status = 'PLANNED' WHERE id = 'container-a'"), /readiness/);
  assert.throws(() => db.exec("DELETE FROM shipping_containers WHERE id = 'container-a'"), /cannot be deleted/);
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM shipping_containers WHERE status = ? ORDER BY created_at, id LIMIT 51").all("DRAFT").map((row) => String(row.detail)).join(" ");
  assert.match(plan, /idx_shipping_containers_status_created/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("active trip planning uses truck and status indexes", () => {
  const db = createMigratedDatabase();
  const truckPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM trips WHERE truck_id = ? AND status = ? ORDER BY planned_departure_at").all("truck-a", "PLANNED").map((row) => String(row.detail)).join(" ");
  const statusPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM trips WHERE status = ? ORDER BY planned_departure_at LIMIT 51").all("PLANNED").map((row) => String(row.detail)).join(" ");
  assert.match(truckPlan, /idx_trips_truck_status/);
  assert.match(statusPlan, /idx_trips_status_planned/);
  db.close();
});

test("fleet prefix lookup remains bounded and index-backed", () => {
  const db = createMigratedDatabase();
  const codePlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM trucks WHERE code GLOB ? ORDER BY code LIMIT 101").all("NG-*").map((row) => String(row.detail)).join(" ");
  const registrationPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM trucks WHERE registration IS NOT NULL AND registration <> '' AND registration GLOB ? ORDER BY registration LIMIT 101").all("1กข*").map((row) => String(row.detail)).join(" ");
  assert.match(codePlan, /SEARCH trucks USING INDEX uq_trucks_code/);
  assert.match(registrationPlan, /SEARCH trucks USING INDEX uq_trucks_registration/);
  db.close();
});

test("eligible motorcycle prefix lookups use field-specific indexes", () => {
  const db = createMigratedDatabase();
  const commonJoin = " FROM motorcycles m JOIN transport_jobs j ON j.id = m.job_id LEFT JOIN trip_motorcycle_assignments a ON a.motorcycle_id = m.id AND a.released_at IS NULL ";
  const commonScope = " AND m.current_status = 'SCHEDULED' AND a.id IS NULL LIMIT 101";
  const jobPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT m.id${commonJoin}WHERE j.job_number GLOB ?${commonScope}`).all("JOB-*").map((row) => String(row.detail)).join(" ");
  const publicIdPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT m.id${commonJoin}WHERE m.public_id GLOB ?${commonScope}`).all("public-*").map((row) => String(row.detail)).join(" ");
  const registrationPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT m.id${commonJoin}WHERE m.registration IS NOT NULL AND m.registration <> '' AND m.registration GLOB ?${commonScope}`).all("1กข*").map((row) => String(row.detail)).join(" ");
  assert.match(jobPlan, /uq_transport_jobs_job_number/);
  assert.match(publicIdPlan, /uq_motorcycles_public_id/);
  assert.match(registrationPlan, /idx_motorcycles_registration/);
  assert.match(`${jobPlan} ${publicIdPlan} ${registrationPlan}`, /uq_trip_assignments_motorcycle_active/);
  db.close();
});

test("yard migration preserves existing staff permissions", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  applyMigration(db, `${migrationDirectory}/0000_harsh_speed_demon.sql`);
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES
      ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER'),
      ('staff-a', 'auth-staff-a', 'staff@example.test', 'Staff', 'STAFF');
    INSERT INTO user_permissions (user_id, permission, granted_by)
    VALUES ('staff-a', 'jobs:read', 'owner-a');
  `);
  applyMigration(db, `${migrationDirectory}/0001_dark_blue_shield.sql`);
  assert.deepEqual(
    db.prepare("SELECT permission FROM user_permissions WHERE user_id = 'staff-a' ORDER BY permission").all().map((row) => row.permission),
    ["jobs:read"],
  );
  db.exec("INSERT INTO user_permissions (user_id, permission, granted_by) VALUES ('staff-a', 'yard:read', 'owner-a')");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM user_permissions WHERE user_id = 'staff-a'").get().total, 2);
  db.close();
});

test("database constraints reject invalid tenant and motorcycle records", () => {
  const db = createMigratedDatabase();
  seedCoreRecords(db);

  assert.throws(() =>
    db.exec("INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES ('customer-bad', 'auth-bad', 'bad@example.test', 'Bad', 'CUSTOMER')"),
  );
  assert.throws(() =>
    db.exec("INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, vin, current_status) VALUES ('motorcycle-b', 'mc_public_b', 'company-a', 'job-a', 2, 'VIN-0001', 'IN_YARD')"),
  );
  assert.throws(() =>
    db.exec("INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number, current_status) VALUES ('motorcycle-c', 'mc_public_c', 'company-a', 'job-a', 0, 'NOT_A_STATUS')"),
  );
  assert.throws(() =>
    db.exec("INSERT INTO user_permissions (user_id, permission, granted_by) VALUES ('owner-a', 'system:root', 'owner-a')"),
  );
  db.exec(`
    INSERT INTO yard_zones (id, code, name, capacity, created_by)
    VALUES ('yard-a', 'A-01', 'โซน A', 2, 'owner-a');
    INSERT INTO yard_placements
      (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by)
    VALUES
      ('placement-a', 'request-a', 'motorcycle-a', 'company-a', 'yard-a', '2026-08-20T10:00:00.000Z', 'owner-a');
  `);
  assert.throws(() =>
    db.exec("INSERT INTO yard_placements (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by) VALUES ('placement-b', 'request-b', 'motorcycle-a', 'company-a', 'yard-a', '2026-08-20T11:00:00.000Z', 'owner-a')"),
  );
  assert.throws(() =>
    db.exec("INSERT INTO yard_zones (id, code, name, capacity, created_by) VALUES ('yard-b', 'B-01', 'Bad', 0, 'owner-a')"),
  );
  db.close();
});

test("company and status queries use the compound motorcycle index", () => {
  const db = createMigratedDatabase();
  seedCoreRecords(db);
  const plan = db
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM motorcycles WHERE company_id = ? AND current_status = ?")
    .all("company-a", "IN_YARD")
    .map((row) => String(row.detail))
    .join(" ");

  assert.match(plan, /idx_motorcycles_company_status/);
  db.close();
});

test("active yard queries use the partial zone index", () => {
  const db = createMigratedDatabase();
  seedCoreRecords(db);
  db.exec(`
    INSERT INTO yard_zones (id, code, name, capacity, created_by)
    VALUES ('yard-a', 'A-01', 'โซน A', 20, 'owner-a');
    INSERT INTO yard_placements
      (id, request_key, motorcycle_id, company_id, yard_zone_id, entered_at, placed_by)
    VALUES
      ('placement-a', 'request-a', 'motorcycle-a', 'company-a', 'yard-a', '2026-08-20T10:00:00.000Z', 'owner-a');
  `);
  const plan = db
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM yard_placements WHERE yard_zone_id = ? AND exited_at IS NULL ORDER BY entered_at")
    .all("yard-a")
    .map((row) => String(row.detail))
    .join(" ");
  assert.match(plan, /idx_yard_placements_zone_active/);
  db.close();
});

test("gallery constraints keep public media separate from customer job evidence", () => {
  const db = createMigratedDatabase();
  seedCoreRecords(db);
  db.exec(`
    INSERT INTO gallery_categories (id, slug, name, created_by)
    VALUES ('category-a', 'domestic', 'ขนส่งในประเทศ', 'owner-a');
    INSERT INTO gallery_items
      (id, request_key, category_id, title, alt_text, visibility, uploaded_by)
    VALUES
      ('gallery-a', 'gallery-request-a', 'category-a', 'งานขนส่งจริง', 'รถจักรยานยนต์บนรถขนส่ง', 'PUBLIC', 'owner-a');
  `);
  assert.throws(() => db.exec(`
    INSERT INTO gallery_items
      (id, request_key, category_id, company_id, job_id, title, alt_text, visibility, uploaded_by)
    VALUES
      ('gallery-b', 'gallery-request-b', 'category-a', 'company-a', 'job-a', 'ข้อมูลลูกค้า', 'รูปงานลูกค้า', 'PUBLIC', 'owner-a');
  `));
  assert.throws(() => db.exec("UPDATE gallery_items SET status = 'PUBLISHED' WHERE id = 'gallery-a'"));
  db.exec(`
    INSERT INTO gallery_image_variants
      (id, gallery_item_id, role, storage_key, content_type, width, height, byte_size, checksum)
    VALUES
      ('variant-a', 'gallery-a', 'DISPLAY', 'gallery/gallery-a/display.webp', 'image/webp', 1200, 900, 1024, '${"a".repeat(64)}');
    UPDATE gallery_items
    SET status = 'PUBLISHED', published_by = 'owner-a', published_at = '2026-08-20T12:00:00.000Z'
    WHERE id = 'gallery-a';
  `);
  assert.equal(db.prepare("SELECT status FROM gallery_items WHERE id = 'gallery-a'").get().status, "PUBLISHED");
  db.close();
});

test("gallery public listing uses its bounded ordering index", () => {
  const db = createMigratedDatabase();
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM gallery_items WHERE visibility = 'PUBLIC' AND status = 'PUBLISHED' ORDER BY is_featured, sort_order, created_at").all().map((row) => String(row.detail)).join(" ");
  assert.match(plan, /idx_gallery_items_public_order/);
  db.close();
});

test("gallery metadata migration preserves existing items and leaves unknown fields null", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  applyMigration(db, `${migrationDirectory}/0000_harsh_speed_demon.sql`);
  applyMigration(db, `${migrationDirectory}/0001_dark_blue_shield.sql`);
  applyMigration(db, `${migrationDirectory}/0002_overrated_klaw.sql`);
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO gallery_categories (id, slug, name, created_by)
    VALUES ('category-a', 'domestic', 'ขนส่งในประเทศ', 'owner-a');
    INSERT INTO gallery_items (id, request_key, category_id, title, alt_text, uploaded_by)
    VALUES ('gallery-a', 'request-a', 'category-a', 'ภาพเดิม', 'ภาพงานเดิม', 'owner-a');
  `);
  applyMigration(db, `${migrationDirectory}/0003_late_doctor_octopus.sql`);
  const row = db.prepare("SELECT title, taken_at, location, public_job_reference FROM gallery_items WHERE id = 'gallery-a'").get();
  assert.deepEqual({ ...row }, { title: "ภาพเดิม", taken_at: null, location: null, public_job_reference: null });
  db.close();
});
