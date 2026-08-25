import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  GALLERY_STATE_COUNTS_SQL,
  POST_STATE_COUNTS_SQL,
  SITE_PAGE_STATE_SQL,
  SITE_SETTINGS_STATE_SQL,
} from "../lib/website-overview-sql.ts";

// The Owner's website screen answers one question — what is live right now —
// and every answer on it is a count of rows. A count that is nearly right is
// worse than no screen at all, so each rule is executed against the real
// migrated schema rather than asserted about.

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
  for (const migration of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${directory}/${migration}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
  `);
  return db;
}

const HASH = "a".repeat(64);
const JSON_BLOB = JSON.stringify({ version: 1 });

function addPage(db, id, slug) {
  db.prepare("INSERT INTO site_pages (id, slug, display_name, created_by) VALUES (?, ?, ?, 'owner')").run(id, slug, slug);
}

function addPageRevision(db, id, pageId) {
  db.prepare(
    `INSERT INTO site_page_revisions (id, request_key, page_id, content_json, content_hash, created_by)
     VALUES (?, ?, ?, ?, ?, 'owner')`,
  ).run(id, `key-${id}`, pageId, JSON_BLOB, HASH);
}

function pageEvent(db, id, pageId, action, revisionId, at) {
  db.prepare(
    `INSERT INTO site_page_publication_events (id, request_key, page_id, revision_id, action, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'owner', ?)`,
  ).run(id, `key-${id}`, pageId, revisionId, action, at);
}

const pageStates = (db) => db.prepare(SITE_PAGE_STATE_SQL).all();

test("a page that has never been published reports no publication, not a missing row", () => {
  const db = createDatabase();
  addPage(db, "page-home", "home");
  const [row] = pageStates(db);
  assert.equal(row.slug, "home");
  assert.equal(row.action, null);
  assert.equal(row.revision_count, 0);
});

test("a page reports the most recent publication event, and a hide wins when it is last", () => {
  const db = createDatabase();
  addPage(db, "page-about", "about");
  addPageRevision(db, "rev-1", "page-about");
  pageEvent(db, "evt-1", "page-about", "PUBLISH", "rev-1", "2026-08-01 09:00:00");
  assert.equal(pageStates(db)[0].action, "PUBLISH");

  pageEvent(db, "evt-2", "page-about", "HIDE", null, "2026-08-02 09:00:00");
  const hidden = pageStates(db)[0];
  assert.equal(hidden.action, "HIDE");
  assert.equal(hidden.changed_at, "2026-08-02 09:00:00");

  pageEvent(db, "evt-3", "page-about", "PUBLISH", "rev-1", "2026-08-03 09:00:00");
  assert.equal(pageStates(db)[0].action, "PUBLISH");
});

test("the revision count is the page's own, never another page's", () => {
  const db = createDatabase();
  addPage(db, "page-a", "about");
  addPage(db, "page-b", "contact");
  addPageRevision(db, "rev-a1", "page-a");
  addPageRevision(db, "rev-a2", "page-a");
  addPageRevision(db, "rev-b1", "page-b");

  const rows = pageStates(db);
  assert.deepEqual(
    rows.map((row) => [row.slug, row.revision_count]),
    [["about", 2], ["contact", 1]],
  );
});

test("the home page cannot be hidden, so the site always has a root", () => {
  const db = createDatabase();
  addPage(db, "page-home", "home");
  addPageRevision(db, "rev-1", "page-home");
  pageEvent(db, "evt-1", "page-home", "PUBLISH", "rev-1", "2026-08-01 09:00:00");
  assert.throws(
    () => pageEvent(db, "evt-2", "page-home", "HIDE", null, "2026-08-02 09:00:00"),
    /home|hide/i,
  );
  assert.equal(pageStates(db)[0].action, "PUBLISH");
});

test("post counts split by what a reader can currently reach", () => {
  const db = createDatabase();
  const seed = (id, slug) => {
    db.prepare("INSERT INTO posts (id, slug, created_by) VALUES (?, ?, 'owner')").run(id, slug);
    db.prepare(
      `INSERT INTO post_revisions (id, request_key, post_id, content_json, content_hash, created_by)
       VALUES (?, ?, ?, ?, ?, 'owner')`,
    ).run(`rev-${id}`, `key-rev-${id}`, id, JSON_BLOB, HASH);
  };
  const event = (id, postId, action, revisionId, at) =>
    db.prepare(
      `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'owner', ?)`,
    ).run(id, `key-${id}`, postId, revisionId, action, at);

  seed("post-live", "post-live");
  seed("post-hidden", "post-hidden");
  seed("post-draft", "post-draft");
  event("e1", "post-live", "PUBLISH", "rev-post-live", "2026-08-01 09:00:00");
  event("e2", "post-hidden", "PUBLISH", "rev-post-hidden", "2026-08-01 09:00:00");
  event("e3", "post-hidden", "HIDE", null, "2026-08-02 09:00:00");

  const counts = db.prepare(POST_STATE_COUNTS_SQL).get();
  assert.equal(counts.total, 3);
  assert.equal(counts.published, 1);
  assert.equal(counts.hidden, 1);
  // The draft is what is left, which is why the screen derives it rather than
  // counting it separately and risking three numbers that do not add up.
  assert.equal(counts.total - counts.published - counts.hidden, 1);
});

test("media counts keep public marketing photographs apart from operational evidence", () => {
  const db = createDatabase();
  db.exec(`
    INSERT INTO companies (id, code, legal_name, display_name) VALUES ('company-a', 'A', 'บริษัท เอ จำกัด', 'บริษัท เอ');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
    VALUES ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-A', 'company-a', 'กรุงเทพฯ', 'เชียงใหม่', 'OPEN', 'owner');
    INSERT INTO gallery_categories (id, slug, name, created_by) VALUES ('category-1', 'work', 'ผลงาน', 'owner');
  `);
  // A PUBLISHED row must name who published it and when; the schema refuses one
  // that does not, so the fixture supplies both rather than working around it.
  const item = (id, status, visibility, featured, companyId = null, jobId = null) =>
    db.prepare(
      `INSERT INTO gallery_items (id, request_key, category_id, company_id, job_id, title, alt_text, status, visibility, is_featured, uploaded_by, published_by, published_at)
       VALUES (?, ?, 'category-1', ?, ?, ?, 'คำบรรยายภาพ', ?, ?, ?, 'owner', ?, ?)`,
    ).run(
      id,
      `key-${id}`,
      companyId,
      jobId,
      id,
      status,
      visibility,
      featured,
      status === "PUBLISHED" ? "owner" : null,
      status === "PUBLISHED" ? "2026-08-01T09:00:00.000Z" : null,
    );

  item("public-1", "PUBLISHED", "PUBLIC", 1);
  item("public-2", "PUBLISHED", "PUBLIC", 0);
  item("draft-1", "DRAFT", "PUBLIC", 0);
  item("internal-1", "PUBLISHED", "INTERNAL", 0);
  item("evidence-1", "PUBLISHED", "CUSTOMER_JOB", 0, "company-a", "job-a");

  const counts = db.prepare(GALLERY_STATE_COUNTS_SQL).get();
  assert.equal(counts.total, 5);
  assert.equal(counts.public_published, 2);
  assert.equal(counts.drafts, 1);
  assert.equal(counts.featured, 1);
  // Internal and customer evidence, which must never be counted as publishable.
  assert.equal(counts.not_public, 2);
});

test("settings report the default state as a state, not as an empty result", () => {
  const db = createDatabase();
  const before = db.prepare(SITE_SETTINGS_STATE_SQL).get();
  assert.equal(before.revision_id, null);
  assert.equal(before.revision_count, 0);

  db.prepare(
    `INSERT INTO site_settings_revisions (id, request_key, settings_json, settings_hash, created_by)
     VALUES (?, ?, ?, ?, 'owner')`,
  ).run("settings-1", "key-settings-1", JSON_BLOB, HASH);
  db.prepare(
    `INSERT INTO site_settings_revisions (id, request_key, settings_json, settings_hash, created_by)
     VALUES (?, ?, ?, ?, 'owner')`,
  ).run("settings-2", "key-settings-2", JSON_BLOB, HASH);
  db.prepare(
    `INSERT INTO site_settings_publication_events (id, request_key, revision_id, created_by, created_at)
     VALUES (?, ?, ?, 'owner', ?)`,
  ).run("pub-1", "key-pub-1", "settings-1", "2026-08-01 09:00:00");
  db.prepare(
    `INSERT INTO site_settings_publication_events (id, request_key, revision_id, created_by, created_at)
     VALUES (?, ?, ?, 'owner', ?)`,
  ).run("pub-2", "key-pub-2", "settings-2", "2026-08-05 09:00:00");

  const after = db.prepare(SITE_SETTINGS_STATE_SQL).get();
  assert.equal(after.revision_id, "settings-2");
  assert.equal(after.changed_at, "2026-08-05 09:00:00");
  assert.equal(after.revision_count, 2);
});

test("rolling settings back reports the older revision as live, without deleting history", () => {
  const db = createDatabase();
  for (const id of ["settings-1", "settings-2"]) {
    db.prepare(
      `INSERT INTO site_settings_revisions (id, request_key, settings_json, settings_hash, created_by)
       VALUES (?, ?, ?, ?, 'owner')`,
    ).run(id, `key-${id}`, JSON_BLOB, HASH);
  }
  const publish = (id, revisionId, at) =>
    db.prepare(
      `INSERT INTO site_settings_publication_events (id, request_key, revision_id, created_by, created_at)
       VALUES (?, ?, ?, 'owner', ?)`,
    ).run(id, `key-${id}`, revisionId, at);

  publish("pub-1", "settings-1", "2026-08-01 09:00:00");
  publish("pub-2", "settings-2", "2026-08-05 09:00:00");
  publish("pub-3", "settings-1", "2026-08-06 09:00:00");

  const rolledBack = db.prepare(SITE_SETTINGS_STATE_SQL).get();
  assert.equal(rolledBack.revision_id, "settings-1");
  assert.equal(rolledBack.revision_count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM site_settings_publication_events").get().n, 3);
});
