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

  for (const migration of migrations) {
    const sql = readFileSync(`${migrationDirectory}/${migration}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  return db;
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
    "motorcycle_images",
    "motorcycles",
    "quote_requests",
    "sequence_counters",
    "status_events",
    "transport_jobs",
    "user_permissions",
    "users",
  ]);
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
