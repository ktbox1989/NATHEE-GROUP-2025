import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));

function applyMigration(db, path) {
  const sql = readFileSync(path, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.exec(statement);
}

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(migrationDirectory).filter((entry) => entry.endsWith(".sql")).sort()) {
    applyMigration(db, `${migrationDirectory}/${name}`);
  }
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('owner-a', 'OWNER', 'owner-a');
    INSERT INTO site_pages (id, slug, display_name, created_by)
    VALUES
      ('site-page-home', 'home', 'หน้าแรก', 'owner-a'),
      ('site-page-about', 'about', 'เกี่ยวกับเรา', 'owner-a');
    INSERT INTO site_page_revisions
      (id, request_key, page_id, content_json, content_hash, created_by)
    VALUES
      ('home-r1', 'request-home-r1', 'site-page-home', '{"version":1}', '${"a".repeat(64)}', 'owner-a'),
      ('home-r2', 'request-home-r2', 'site-page-home', '{"version":1}', '${"b".repeat(64)}', 'owner-a'),
      ('about-r1', 'request-about-r1', 'site-page-about', '{"version":1}', '${"c".repeat(64)}', 'owner-a');
  `);
  return db;
}

test("migration 0012 preserves existing explicit staff permissions", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const migrations = readdirSync(migrationDirectory).filter((entry) => entry.endsWith(".sql")).sort();
  for (const name of migrations.filter((entry) => entry < "0012")) applyMigration(db, `${migrationDirectory}/${name}`);
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES
      ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER'),
      ('staff-a', 'auth-staff-a', 'staff@example.test', 'Staff', 'STAFF');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES
      ('owner-a', 'OWNER', 'owner-a'),
      ('staff-a', 'STAFF', 'owner-a');
    INSERT INTO user_permissions (user_id, permission, granted_by)
    VALUES ('staff-a', 'gallery:write', 'owner-a');
  `);
  applyMigration(db, `${migrationDirectory}/${migrations.find((entry) => entry.startsWith("0012_"))}`);
  assert.deepEqual(
    db.prepare("SELECT user_id, permission, granted_by FROM user_permissions").all().map((row) => ({ ...row })),
    [{ user_id: "staff-a", permission: "gallery:write", granted_by: "owner-a" }],
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("site CMS migrations apply cleanly and preserve foreign-key integrity", () => {
  const db = createDatabase();
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM site_pages").get().total, 2);
  db.close();
});

test("site revisions and publication history are append-only", () => {
  const db = createDatabase();
  db.exec(`INSERT INTO site_page_publication_events
    (id, request_key, page_id, revision_id, action, created_by)
    VALUES ('publish-1', 'request-publish-1', 'site-page-home', 'home-r1', 'PUBLISH', 'owner-a')`);
  assert.throws(() => db.exec("UPDATE site_page_revisions SET change_note = 'changed' WHERE id = 'home-r1'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM site_page_revisions WHERE id = 'home-r1'"), /cannot be deleted/);
  assert.throws(() => db.exec("UPDATE site_page_publication_events SET note = 'changed' WHERE id = 'publish-1'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM site_page_publication_events WHERE id = 'publish-1'"), /cannot be deleted/);
  db.close();
});

test("publication is page-scoped, home cannot be hidden, and rollback is another event", () => {
  const db = createDatabase();
  assert.throws(() => db.exec(`INSERT INTO site_page_publication_events
    (id, request_key, page_id, revision_id, action, created_by)
    VALUES ('wrong-scope', 'request-wrong-scope', 'site-page-home', 'about-r1', 'PUBLISH', 'owner-a')`), /same page/);
  assert.throws(() => db.exec(`INSERT INTO site_page_publication_events
    (id, request_key, page_id, action, created_by)
    VALUES ('hide-home', 'request-hide-home', 'site-page-home', 'HIDE', 'owner-a')`), /cannot be hidden/);
  db.exec(`
    INSERT INTO site_page_publication_events (id, request_key, page_id, revision_id, action, created_by)
    VALUES
      ('publish-r1', 'request-publish-r1', 'site-page-home', 'home-r1', 'PUBLISH', 'owner-a'),
      ('publish-r2', 'request-publish-r2', 'site-page-home', 'home-r2', 'PUBLISH', 'owner-a'),
      ('rollback-r1', 'request-rollback-r1', 'site-page-home', 'home-r1', 'PUBLISH', 'owner-a');
  `);
  const latest = db.prepare("SELECT revision_id FROM site_page_publication_events WHERE page_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get("site-page-home");
  assert.equal(latest.revision_id, "home-r1");
  db.close();
});

test("site content operational lookups use bounded indexes", () => {
  const db = createDatabase();
  const revisions = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM site_page_revisions WHERE page_id = ? ORDER BY created_at DESC, id DESC LIMIT 20").all("site-page-home").map((row) => String(row.detail)).join(" ");
  const publications = db.prepare("EXPLAIN QUERY PLAN SELECT revision_id FROM site_page_publication_events WHERE page_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").all("site-page-home").map((row) => String(row.detail)).join(" ");
  assert.match(revisions, /idx_site_page_revisions_page_created/);
  assert.match(publications, /idx_site_page_publication_page_created/);
  db.close();
});
