import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
function apply(db, path) { for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement); }

test("private image variant migration preserves originals and enforces immutable metadata", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
  for (const name of migrations.filter((entry) => entry < "0020_")) apply(db, `${directory}/${name}`);
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company', 'CUS', 'Company', 'Company');
    INSERT INTO users (id, external_auth_id, email, display_name, role) VALUES ('owner', 'auth', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by) VALUES ('job', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-1', 'company', 'A', 'B', 'OPEN', 'owner');
    INSERT INTO motorcycles (id, public_id, company_id, job_id, sequence_number) VALUES ('motorcycle', 'mc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'company', 'job', 1);
    INSERT INTO motorcycle_images (id, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by) VALUES ('image-legacy', 'motorcycle', 'company', 'companies/company/original.jpg', 'FRONT', 'image/jpeg', 2000000, '${"a".repeat(64)}', 'owner');
  `);
  const migration = migrations.find((entry) => entry.startsWith("0020_"));
  assert.ok(migration, "migration 0020 is required");
  apply(db, `${directory}/${migration}`);

  assert.deepEqual({ ...db.prepare("SELECT id, request_key FROM motorcycle_images WHERE id='image-legacy'").get() }, { id: "image-legacy", request_key: null });
  db.exec(`INSERT INTO motorcycle_image_variants (id, motorcycle_image_id, role, storage_key, content_type, width, height, byte_size, checksum) VALUES ('variant-display', 'image-legacy', 'DISPLAY', 'companies/company/display.webp', 'image/webp', 1200, 900, 100000, '${"b".repeat(64)}')`);
  assert.throws(() => db.exec(`INSERT INTO motorcycle_image_variants (id, motorcycle_image_id, role, storage_key, content_type, width, height, byte_size, checksum) VALUES ('variant-bad', 'image-legacy', 'THUMBNAIL', 'companies/company/thumb.jpg', 'image/jpeg', 640, 480, 10000, '${"c".repeat(64)}')`));
  assert.throws(() => db.exec("UPDATE motorcycle_image_variants SET width=1000 WHERE id='variant-display'"), /immutable/);
  assert.throws(() => db.exec("DELETE FROM motorcycle_image_variants WHERE id='variant-display'"), /cannot be deleted/);
  assert.throws(() => db.exec("UPDATE motorcycle_images SET category='OTHER' WHERE id='image-legacy'"), /immutable/);
  assert.throws(() => db.exec("DELETE FROM motorcycle_images WHERE id='image-legacy'"), /cannot be deleted/);
  db.exec(`INSERT INTO motorcycle_images (id, request_key, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by) VALUES ('image-new', 'motorcycle-image-123e4567-e89b-42d3-a456-426614174000', 'motorcycle', 'company', 'companies/company/new.jpg', 'FRONT', 'image/jpeg', 1000, '${"d".repeat(64)}', 'owner')`);
  assert.throws(() => db.exec(`INSERT INTO motorcycle_images (id, request_key, motorcycle_id, company_id, storage_key, category, content_type, byte_size, checksum, uploaded_by) VALUES ('image-race', 'motorcycle-image-123e4567-e89b-42d3-a456-426614174000', 'motorcycle', 'company', 'companies/company/race.jpg', 'FRONT', 'image/jpeg', 1000, '${"e".repeat(64)}', 'owner')`));
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT storage_key FROM motorcycle_image_variants WHERE motorcycle_image_id=? AND role=?").all("image-legacy", "DISPLAY").map((row) => String(row.detail)).join(" ");
  assert.match(plan, /idx_motorcycle_image_variants_image_role/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});
