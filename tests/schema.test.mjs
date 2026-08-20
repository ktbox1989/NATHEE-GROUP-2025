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
    "gallery_categories",
    "gallery_image_variants",
    "gallery_items",
    "motorcycle_images",
    "motorcycles",
    "quote_requests",
    "sequence_counters",
    "status_events",
    "transport_jobs",
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
