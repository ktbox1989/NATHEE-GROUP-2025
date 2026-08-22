import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isPubliclyServable } from "../lib/gallery-mutation.ts";
import { recordTimestamp } from "../lib/timestamps.ts";

// Draft, hidden, archived, internal and customer-owned photographs must never
// reach an anonymous reader. That decision is made by a WHERE clause, so it is
// proven here against the real migrated schema with one row in every state.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const GALLERY_PAGE = fileURLToPath(new URL("../app/gallery/page.tsx", import.meta.url));
const CMS_RENDERER = fileURLToPath(new URL("../components/cms-public-page.tsx", import.meta.url));

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
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO transport_jobs (id, public_id, job_number, company_id, origin, destination, status, created_by)
    VALUES ('job-a', 'job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'JOB-2026-000001', 'company-a', 'กรุงเทพฯ', 'เชียงใหม่', 'OPEN', 'owner-a');
    INSERT INTO gallery_categories (id, slug, name, status, created_by) VALUES
      ('cat-active', 'work', 'งานจริง', 'ACTIVE', 'owner-a'),
      ('cat-hidden', 'retired', 'หมวดที่ปิดแล้ว', 'HIDDEN', 'owner-a');
  `);
  return db;
}

function addItem(db, id, { status, visibility, categoryId = "cat-active", featured = 0 }) {
  const scoped = visibility === "CUSTOMER_JOB";
  db.prepare(
    "INSERT INTO gallery_items (id, request_key, category_id, company_id, job_id, title, alt_text, status, visibility, is_featured, uploaded_by, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?, 'คำบรรยายภาพจริง', ?, ?, ?, 'owner-a', ?, ?)",
  ).run(
    id,
    `req-${id}`,
    categoryId,
    scoped ? "company-a" : null,
    scoped ? "job-a" : null,
    `ภาพ ${id}`,
    status,
    visibility,
    featured,
    status === "PUBLISHED" ? "owner-a" : null,
    status === "PUBLISHED" ? "2026-08-23T09:00:00.000Z" : null,
  );
}

/** Exactly the WHERE app/gallery/page.tsx applies for an anonymous reader. */
function publicListing(db, categoryId = null) {
  const clause = categoryId ? " AND items.category_id = ?" : "";
  const params = categoryId ? [categoryId] : [];
  return db
    .prepare(
      `SELECT items.id FROM gallery_items items
       JOIN gallery_categories cats ON cats.id = items.category_id
       WHERE items.status = 'PUBLISHED' AND items.visibility = 'PUBLIC' AND cats.status = 'ACTIVE'${clause}
       ORDER BY items.sort_order ASC, items.created_at DESC, items.id DESC`,
    )
    .all(...params)
    .map((row) => row.id);
}

/** Exactly the lookup getPublicMedia() in components/cms-public-page.tsx makes. */
function publicMedia(db, id) {
  return db
    .prepare("SELECT id FROM gallery_items WHERE id = ? AND status = 'PUBLISHED' AND visibility = 'PUBLIC'")
    .get(id) ?? null;
}

test("only a published public photograph in an active category reaches the public gallery", () => {
  const db = migrated();
  addItem(db, "draft-public", { status: "DRAFT", visibility: "PUBLIC" });
  addItem(db, "hidden-public", { status: "HIDDEN", visibility: "PUBLIC" });
  addItem(db, "archived-public", { status: "ARCHIVED", visibility: "PUBLIC" });
  addItem(db, "published-internal", { status: "PUBLISHED", visibility: "INTERNAL" });
  addItem(db, "published-customer", { status: "PUBLISHED", visibility: "CUSTOMER_JOB" });
  addItem(db, "published-hidden-category", { status: "PUBLISHED", visibility: "PUBLIC", categoryId: "cat-hidden" });
  addItem(db, "published-public", { status: "PUBLISHED", visibility: "PUBLIC" });

  assert.deepEqual(publicListing(db), ["published-public"]);
  db.close();
});

test("a customer's job photograph is never public, however it is filtered", () => {
  const db = migrated();
  addItem(db, "published-customer", { status: "PUBLISHED", visibility: "CUSTOMER_JOB" });
  assert.deepEqual(publicListing(db), []);
  assert.deepEqual(publicListing(db, "cat-active"), []);
  assert.equal(publicMedia(db, "published-customer"), null);
  db.close();
});

test("hiding a live photograph removes it from the public gallery immediately", () => {
  const db = migrated();
  addItem(db, "item-a", { status: "PUBLISHED", visibility: "PUBLIC", featured: 1 });
  assert.deepEqual(publicListing(db), ["item-a"]);

  // What the HIDE action writes.
  db.prepare("UPDATE gallery_items SET status = 'HIDDEN', is_featured = 0, updated_at = ? WHERE id = 'item-a'").run(
    recordTimestamp(),
  );
  assert.deepEqual(publicListing(db), []);
  assert.equal(publicMedia(db, "item-a"), null);
  assert.equal(db.prepare("SELECT is_featured FROM gallery_items WHERE id = 'item-a'").get().is_featured, 0);
  db.close();
});

test("archiving removes it too, and re-publishing brings it back", () => {
  const db = migrated();
  addItem(db, "item-a", { status: "PUBLISHED", visibility: "PUBLIC" });
  db.prepare(
    "UPDATE gallery_items SET status = 'ARCHIVED', is_featured = 0, archived_at = ?, updated_at = ? WHERE id = 'item-a'",
  ).run("2026-08-23T10:00:00.000Z", recordTimestamp());
  assert.deepEqual(publicListing(db), []);

  db.prepare(
    "UPDATE gallery_items SET status = 'PUBLISHED', published_by = 'owner-a', published_at = ?, archived_at = NULL, updated_at = ? WHERE id = 'item-a'",
  ).run("2026-08-23T11:00:00.000Z", recordTimestamp());
  assert.deepEqual(publicListing(db), ["item-a"]);
  db.close();
});

test("hiding a category removes every photograph in it without touching the rows", () => {
  const db = migrated();
  addItem(db, "item-a", { status: "PUBLISHED", visibility: "PUBLIC" });
  addItem(db, "item-b", { status: "PUBLISHED", visibility: "PUBLIC" });
  // Equal sort_order ties break on created_at then id, both descending.
  assert.deepEqual(publicListing(db), ["item-b", "item-a"]);

  db.prepare("UPDATE gallery_categories SET status = 'HIDDEN' WHERE id = 'cat-active'").run();
  assert.deepEqual(publicListing(db), []);
  assert.equal(
    db.prepare("SELECT count(*) AS total FROM gallery_items WHERE status = 'PUBLISHED'").get().total,
    2,
    "the photographs are still published, they are simply not reachable",
  );
  db.close();
});

test("reordering changes the order and nothing else", () => {
  const db = migrated();
  addItem(db, "item-a", { status: "PUBLISHED", visibility: "PUBLIC" });
  addItem(db, "item-b", { status: "PUBLISHED", visibility: "PUBLIC" });
  // Deliberately the opposite of the default tie-break, so this only holds
  // because sort_order was changed.
  assert.deepEqual(publicListing(db), ["item-b", "item-a"]);
  db.prepare("UPDATE gallery_items SET sort_order = 1 WHERE id = 'item-a'").run();
  db.prepare("UPDATE gallery_items SET sort_order = 10 WHERE id = 'item-b'").run();
  assert.deepEqual(publicListing(db), ["item-a", "item-b"]);
  db.close();
});

test("the stored state and the shared policy agree on every combination", () => {
  const db = migrated();
  const combinations = [];
  for (const status of ["DRAFT", "PUBLISHED", "HIDDEN", "ARCHIVED"]) {
    for (const visibility of ["PUBLIC", "CUSTOMER_JOB", "INTERNAL"]) {
      for (const categoryId of ["cat-active", "cat-hidden"]) {
        const id = `${status}-${visibility}-${categoryId}`.toLowerCase();
        addItem(db, id, { status, visibility, categoryId });
        combinations.push({
          id,
          categoryStatus: categoryId === "cat-active" ? "ACTIVE" : "HIDDEN",
          status,
          visibility,
        });
      }
    }
  }
  const listed = new Set(publicListing(db));
  for (const combination of combinations) {
    assert.equal(
      listed.has(combination.id),
      isPubliclyServable(combination),
      `${combination.id}: the query and the policy disagree`,
    );
  }
  assert.equal(listed.size, 1, "exactly one combination is public");
  db.close();
});

test("the surfaces these cases mirror still filter the way the cases assume", () => {
  const gallery = readFileSync(GALLERY_PAGE, "utf8");
  for (const needle of [
    'eq(galleryItems.status, "PUBLISHED")',
    'eq(galleryItems.visibility, "PUBLIC")',
    'eq(galleryCategories.status, "ACTIVE")',
  ]) {
    assert.ok(gallery.includes(needle), `app/gallery/page.tsx no longer applies ${needle}`);
  }
  const renderer = readFileSync(CMS_RENDERER, "utf8");
  assert.ok(
    renderer.includes('eq(galleryItems.status, "PUBLISHED")') &&
      renderer.includes('eq(galleryItems.visibility, "PUBLIC")'),
    "components/cms-public-page.tsx no longer restricts public media",
  );
});
