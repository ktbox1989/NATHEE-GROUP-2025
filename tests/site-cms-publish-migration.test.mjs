import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectPageReferences, unpublishableReferences } from "../lib/site-cms-publish.ts";
import { parseCmsPageContentJson, serializeCmsPageContent } from "../lib/site-cms-content.ts";
import { recordTimestamp } from "../lib/timestamps.ts";

// The public site must only ever show a revision that was published, and only
// media a reader is allowed to see. Both decisions are made in SQL, so both are
// proven against the real migrated schema.

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
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('owner-a', 'auth-owner-a', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO site_pages (id, slug, display_name, created_by)
    VALUES ('site-page-home', 'home', 'หน้าแรก', 'owner-a'),
           ('site-page-services', 'services', 'บริการ', 'owner-a');
    INSERT INTO gallery_categories (id, slug, name, status, created_by)
    VALUES ('cat-transport', 'transport', 'งานขนส่ง', 'ACTIVE', 'owner-a'),
           ('cat-retired', 'retired', 'หมวดที่ปิดแล้ว', 'HIDDEN', 'owner-a');
  `);
  return db;
}

function content(sections) {
  return serializeCmsPageContent({
    version: 1,
    seo: { title: "หัวข้อหน้าแรก", description: "คำอธิบายหน้าแรกที่ยาวพอสำหรับการตรวจสอบเนื้อหา" },
    sections: sections.map((section, index) => ({
      id: `section-${index}`,
      type: "CONTENT",
      enabled: true,
      eyebrow: "",
      heading: "หัวข้อ",
      body: "",
      imageItemId: "",
      primaryLabel: "",
      primaryHref: "",
      secondaryLabel: "",
      secondaryHref: "",
      galleryCategorySlug: "",
      galleryLimit: 12,
      items: [],
      ...section,
    })),
  });
}

// The home page can never be hidden — trg_site_home_cannot_hide enforces that —
// so the publish/hide lifecycle is exercised on a page that may be.
const PAGE = "site-page-services";

function addRevision(db, id, sections, pageId = PAGE) {
  const contentJson = content(sections);
  // The schema requires the real digest, the same one the route computes.
  const contentHash = createHash("sha256").update(contentJson, "utf8").digest("hex");
  db.prepare(
    "INSERT INTO site_page_revisions (id, request_key, page_id, content_json, content_hash, created_by) VALUES (?, ?, ?, ?, ?, 'owner-a')",
  ).run(id, `key-${id}`, pageId, contentJson, contentHash);
}

function addPublication(db, id, action, revisionId, createdAt, pageId = PAGE) {
  db.prepare(
    "INSERT INTO site_page_publication_events (id, request_key, page_id, revision_id, action, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'owner-a', ?)",
  ).run(id, `key-${id}`, pageId, revisionId, action, createdAt);
}

// Exactly what lib/site-cms.ts resolves for a public request.
function publishedState(db, pageId = PAGE) {
  const event = db
    .prepare(
      "SELECT action, revision_id FROM site_page_publication_events WHERE page_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(pageId);
  if (!event) return { status: "UNMANAGED", revisionId: null };
  if (event.action === "HIDE" || !event.revision_id) return { status: "HIDDEN", revisionId: null };
  const revision = db
    .prepare("SELECT id, content_json FROM site_page_revisions WHERE id = ? AND page_id = ?")
    .get(event.revision_id, pageId);
  return revision ? { status: "PUBLISHED", revisionId: revision.id } : { status: "BROKEN", revisionId: null };
}

test("a saved revision is not public until it is published", () => {
  const db = migrated();
  addRevision(db, "rev-draft", [{ heading: "ฉบับร่าง" }]);
  assert.deepEqual(publishedState(db), { status: "UNMANAGED", revisionId: null });

  addPublication(db, "pub-1", "PUBLISH", "rev-draft", recordTimestamp(new Date("2026-08-23T10:00:00.000Z")));
  assert.deepEqual(publishedState(db), { status: "PUBLISHED", revisionId: "rev-draft" });
  db.close();
});

test("a newer draft does not replace the published revision until it is published too", () => {
  const db = migrated();
  addRevision(db, "rev-one", [{ heading: "ฉบับหนึ่ง" }]);
  addPublication(db, "pub-1", "PUBLISH", "rev-one", recordTimestamp(new Date("2026-08-23T10:00:00.000Z")));
  addRevision(db, "rev-two", [{ heading: "ฉบับสอง" }]);

  assert.equal(publishedState(db).revisionId, "rev-one", "the draft must not go live on save");
  addPublication(db, "pub-2", "PUBLISH", "rev-two", recordTimestamp(new Date("2026-08-23T11:00:00.000Z")));
  assert.equal(publishedState(db).revisionId, "rev-two");
  db.close();
});

test("hiding takes effect, and re-publishing brings back exactly the chosen revision", () => {
  const db = migrated();
  addRevision(db, "rev-one", [{ heading: "ฉบับหนึ่ง" }]);
  addRevision(db, "rev-two", [{ heading: "ฉบับสอง" }]);
  addPublication(db, "pub-1", "PUBLISH", "rev-two", recordTimestamp(new Date("2026-08-23T10:00:00.000Z")));
  addPublication(db, "pub-2", "HIDE", null, recordTimestamp(new Date("2026-08-23T11:00:00.000Z")));
  assert.deepEqual(publishedState(db), { status: "HIDDEN", revisionId: null });

  addPublication(db, "pub-3", "PUBLISH", "rev-one", recordTimestamp(new Date("2026-08-23T12:00:00.000Z")));
  assert.equal(publishedState(db).revisionId, "rev-one", "rollback is another event, not an edit");
  db.close();
});

test("which publication wins is decided by the record timestamp, within a single day", () => {
  const db = migrated();
  addRevision(db, "rev-one", [{ heading: "ฉบับหนึ่ง" }]);
  // Just after midnight, then just before midnight on the same date: the second
  // must win. Mixing timestamp representations here is exactly what made the
  // Audit page order wrongly, and it would silently un-hide a page.
  addPublication(db, "pub-early", "PUBLISH", "rev-one", recordTimestamp(new Date("2026-08-23T00:00:01.000Z")));
  addPublication(db, "pub-late", "HIDE", null, recordTimestamp(new Date("2026-08-23T23:59:00.000Z")));
  assert.deepEqual(publishedState(db), { status: "HIDDEN", revisionId: null });
  db.close();
});

test("publication history is append-only, so a page cannot be un-published by deletion", () => {
  const db = migrated();
  addRevision(db, "rev-one", [{ heading: "ฉบับหนึ่ง" }]);
  addPublication(db, "pub-1", "PUBLISH", "rev-one", recordTimestamp(new Date("2026-08-23T10:00:00.000Z")));
  assert.throws(() => db.exec("DELETE FROM site_page_publication_events WHERE id = 'pub-1'"));
  assert.throws(() => db.exec("UPDATE site_page_revisions SET content_json = '{}' WHERE id = 'rev-one'"));
  assert.equal(publishedState(db).revisionId, "rev-one");
  db.close();
});

test("the home page cannot be hidden, so the public site always has an entry point", () => {
  const db = migrated();
  addRevision(db, "rev-home", [{ heading: "หน้าแรก" }], "site-page-home");
  addPublication(db, "pub-home", "PUBLISH", "rev-home", recordTimestamp(new Date("2026-08-23T10:00:00.000Z")), "site-page-home");
  assert.equal(publishedState(db, "site-page-home").revisionId, "rev-home");

  assert.throws(
    () =>
      addPublication(db, "pub-hide-home", "HIDE", null, recordTimestamp(new Date("2026-08-23T11:00:00.000Z")), "site-page-home"),
    /home page cannot be hidden/,
  );
  assert.equal(publishedState(db, "site-page-home").revisionId, "rev-home");
  db.close();
});

// Mirrors lib/site-cms-publish-store.ts: the database half of the same decision
// the public renderer makes.
function resolveFromDatabase(db, references) {
  const publishableImageItemIds = new Set();
  const publishableCategorySlugs = new Set();
  for (const id of references.imageItemIds) {
    const row = db
      .prepare("SELECT id FROM gallery_items WHERE id = ? AND status = 'PUBLISHED' AND visibility = 'PUBLIC'")
      .get(id);
    if (row) publishableImageItemIds.add(row.id);
  }
  for (const slug of references.galleryCategorySlugs) {
    const row = db.prepare("SELECT slug FROM gallery_categories WHERE slug = ? AND status = 'ACTIVE'").get(slug);
    if (row) publishableCategorySlugs.add(row.slug);
  }
  return { publishableImageItemIds, publishableCategorySlugs };
}

function addGalleryItem(db, id, status, visibility) {
  db.prepare(
    "INSERT INTO gallery_items (id, request_key, category_id, title, alt_text, status, visibility, uploaded_by, published_by, published_at) VALUES (?, ?, 'cat-transport', 'ภาพงาน', 'คำบรรยายภาพ', ?, ?, 'owner-a', ?, ?)",
  ).run(
    id,
    `req-${id}`,
    status,
    visibility,
    status === "PUBLISHED" ? "owner-a" : null,
    status === "PUBLISHED" ? "2026-08-23T09:00:00.000Z" : null,
  );
}

test("a revision pointing at a published public image may be published", () => {
  const db = migrated();
  addGalleryItem(db, "img-public", "PUBLISHED", "PUBLIC");
  const references = collectPageReferences(parseCmsPageContentJson(content([{ imageItemId: "img-public" }])));
  assert.deepEqual(unpublishableReferences(references, resolveFromDatabase(db, references)), []);
  db.close();
});

test("a revision pointing at a draft or internal image is refused", () => {
  const db = migrated();
  addGalleryItem(db, "img-draft", "DRAFT", "PUBLIC");
  addGalleryItem(db, "img-internal", "PUBLISHED", "INTERNAL");

  for (const id of ["img-draft", "img-internal", "img-missing"]) {
    const references = collectPageReferences(parseCmsPageContentJson(content([{ imageItemId: id }])));
    assert.deepEqual(
      unpublishableReferences(references, resolveFromDatabase(db, references)),
      [{ kind: "image", id }],
      `${id} would render as nothing on the live page`,
    );
  }
  db.close();
});

test("a gallery section pointing at a hidden category is refused", () => {
  const db = migrated();
  const active = collectPageReferences(
    parseCmsPageContentJson(content([{ type: "GALLERY", galleryCategorySlug: "transport" }])),
  );
  assert.deepEqual(unpublishableReferences(active, resolveFromDatabase(db, active)), []);

  const hidden = collectPageReferences(
    parseCmsPageContentJson(content([{ type: "GALLERY", galleryCategorySlug: "retired" }])),
  );
  assert.deepEqual(unpublishableReferences(hidden, resolveFromDatabase(db, hidden)), [
    { kind: "category", id: "retired" },
  ]);
  db.close();
});

test("archiving the image a live page depends on does not rewrite the published revision", () => {
  const db = migrated();
  addGalleryItem(db, "img-public", "PUBLISHED", "PUBLIC");
  addRevision(db, "rev-one", [{ imageItemId: "img-public" }]);
  addPublication(db, "pub-1", "PUBLISH", "rev-one", recordTimestamp(new Date("2026-08-23T10:00:00.000Z")));

  db.exec("UPDATE gallery_items SET status = 'ARCHIVED' WHERE id = 'img-public'");
  // The page stays published against the revision it was published with; the
  // image simply stops resolving. Re-publishing it is what the contract refuses.
  assert.equal(publishedState(db).revisionId, "rev-one");
  const references = collectPageReferences(parseCmsPageContentJson(content([{ imageItemId: "img-public" }])));
  assert.deepEqual(unpublishableReferences(references, resolveFromDatabase(db, references)), [
    { kind: "image", id: "img-public" },
  ]);
  db.close();
});
