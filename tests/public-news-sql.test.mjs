import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PUBLISHED_POSTS_COUNT_SQL, PUBLISHED_POSTS_INDEX_SQL } from "../lib/public-news-sql.ts";

// The /news/ index decides what an anonymous reader sees. Every rule below is
// one where getting it wrong publishes something that was never published, or
// hides something that was.

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
const content = (title) => JSON.stringify({ version: 1, title });

function addPost(db, id, slug) {
  db.exec(`INSERT INTO posts (id, slug, created_by) VALUES ('${id}', '${slug}', 'owner')`);
}

function addRevision(db, id, postId, title) {
  db.prepare(
    `INSERT INTO post_revisions (id, request_key, post_id, content_json, content_hash, created_by)
     VALUES (?, ?, ?, ?, ?, 'owner')`,
  ).run(id, `key-${id}`, postId, content(title), HASH);
}

function publish(db, id, postId, revisionId, at) {
  db.prepare(
    `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by, created_at)
     VALUES (?, ?, ?, ?, 'PUBLISH', 'owner', ?)`,
  ).run(id, `key-${id}`, postId, revisionId, at);
}

function hide(db, id, postId, at) {
  db.prepare(
    `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by, created_at)
     VALUES (?, ?, ?, NULL, 'HIDE', 'owner', ?)`,
  ).run(id, `key-${id}`, postId, at);
}

const index = (db, limit = 12, offset = 0) => db.prepare(PUBLISHED_POSTS_INDEX_SQL).all(limit, offset);
const total = (db) => db.prepare(PUBLISHED_POSTS_COUNT_SQL).get().total;

test("a post that was never published has no representation in the index", () => {
  const db = createDatabase();
  addPost(db, "post-draft", "draft-only");
  addRevision(db, "rev-draft", "post-draft", "Draft");
  assert.deepEqual(index(db), []);
  assert.equal(total(db), 0);
});

test("a published post appears with the revision that was published", () => {
  const db = createDatabase();
  addPost(db, "post-1", "first-post");
  addRevision(db, "rev-1", "post-1", "First");
  addRevision(db, "rev-2", "post-1", "Second, saved but not published");
  publish(db, "evt-1", "post-1", "rev-1", "2026-08-01 09:00:00");

  const rows = index(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slug, "first-post");
  // The live revision is the one the publication event names, not the newest
  // saved one: saving must never change what a reader is served.
  assert.equal(rows[0].revision_id, "rev-1");
  assert.equal(JSON.parse(rows[0].content_json).title, "First");
  assert.equal(total(db), 1);
});

test("hiding a published post removes it from the index without deleting anything", () => {
  const db = createDatabase();
  addPost(db, "post-1", "first-post");
  addRevision(db, "rev-1", "post-1", "First");
  publish(db, "evt-1", "post-1", "rev-1", "2026-08-01 09:00:00");
  hide(db, "evt-2", "post-1", "2026-08-02 09:00:00");

  assert.deepEqual(index(db), []);
  assert.equal(total(db), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM post_revisions").get().n, 1);
});

test("republishing after a hide brings the post back and keeps its original date", () => {
  const db = createDatabase();
  addPost(db, "post-1", "first-post");
  addRevision(db, "rev-1", "post-1", "First");
  publish(db, "evt-1", "post-1", "rev-1", "2026-08-01 09:00:00");
  hide(db, "evt-2", "post-1", "2026-08-02 09:00:00");
  publish(db, "evt-3", "post-1", "rev-1", "2026-08-03 09:00:00");

  const rows = index(db);
  assert.equal(rows.length, 1);
  // published_at is when it first went live; a hide-and-restore is not a new
  // publication, and telling a search engine it is would be a lie.
  assert.equal(rows[0].first_published, "2026-08-01 09:00:00");
  assert.equal(rows[0].last_published, "2026-08-03 09:00:00");
  assert.equal(rows[0].publish_count, 2);
});

test("a post published exactly once reports one publication, so updatedAt can stay null", () => {
  const db = createDatabase();
  addPost(db, "post-1", "first-post");
  addRevision(db, "rev-1", "post-1", "First");
  publish(db, "evt-1", "post-1", "rev-1", "2026-08-01 09:00:00");
  assert.equal(index(db)[0].publish_count, 1);
});

test("the index is newest first by first publication, not by latest edit", () => {
  const db = createDatabase();
  for (const [id, slug, at] of [["post-a", "post-a", "2026-08-01 09:00:00"], ["post-b", "post-b", "2026-08-05 09:00:00"], ["post-c", "post-c", "2026-08-03 09:00:00"]]) {
    addPost(db, id, slug);
    addRevision(db, `rev-${id}`, id, slug);
    publish(db, `evt-${id}`, id, `rev-${id}`, at);
  }
  // post-a is edited last of all; it must not jump to the top.
  publish(db, "evt-a2", "post-a", "rev-post-a", "2026-08-09 09:00:00");

  assert.deepEqual(index(db).map((row) => row.slug), ["post-b", "post-c", "post-a"]);
});

test("pagination returns each post exactly once", () => {
  const db = createDatabase();
  for (let position = 0; position < 5; position += 1) {
    const id = `post-${position}`;
    addPost(db, id, id);
    addRevision(db, `rev-${id}`, id, id);
    publish(db, `evt-${id}`, id, `rev-${id}`, `2026-08-0${position + 1} 09:00:00`);
  }
  assert.equal(total(db), 5);
  const first = index(db, 2, 0).map((row) => row.slug);
  const second = index(db, 2, 2).map((row) => row.slug);
  const third = index(db, 2, 4).map((row) => row.slug);
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(third.length, 1);
  assert.equal(new Set([...first, ...second, ...third]).size, 5);
});

test("one post's publication event can never serve another post's revision", () => {
  const db = createDatabase();
  addPost(db, "post-1", "post-one");
  addPost(db, "post-2", "post-two");
  addRevision(db, "rev-1", "post-1", "One");
  assert.throws(
    () => publish(db, "evt-x", "post-2", "rev-1", "2026-08-01 09:00:00"),
    /same post/i,
  );
});

test("posts published in the same second are ordered by slug, not by insertion", () => {
  const db = createDatabase();
  for (const slug of ["charlie-post", "alpha-post", "bravo-post"]) {
    addPost(db, slug, slug);
    addRevision(db, `rev-${slug}`, slug, slug);
    publish(db, `evt-${slug}`, slug, `rev-${slug}`, "2026-08-01 09:00:00");
  }
  // Without a deterministic tie-break a same-second batch shuffles between
  // requests, which paginates one post twice and hides another. The rule is the
  // one comparePostsForList already uses for the static release.
  assert.deepEqual(index(db).map((row) => row.slug), ["alpha-post", "bravo-post", "charlie-post"]);
});

test("a publish and a revert inside the same second resolve to the revert", () => {
  const db = createDatabase();
  addPost(db, "post-1", "first-post");
  addRevision(db, "rev-1", "post-1", "First");
  // created_at has one-second resolution by the timestamp contract, so these
  // tie. The tie-break must be insertion order, not the random UUID primary
  // key: with an id tie-break the outcome depends on which uuid sorted higher,
  // and half the time the index would keep listing a post the Owner just took
  // down - and which /news/<slug>/ already answers 404 for, because
  // lib/post-cms-store.ts breaks the same tie on rowid.
  publish(db, "evt-aaaa", "post-1", "rev-1", "2026-08-01 09:00:00");
  hide(db, "evt-0000", "post-1", "2026-08-01 09:00:00");

  assert.deepEqual(index(db), []);
  assert.equal(total(db), 0);
});

test("a revert and a re-publish inside the same second resolve to the re-publish", () => {
  const db = createDatabase();
  addPost(db, "post-1", "first-post");
  addRevision(db, "rev-1", "post-1", "First");
  publish(db, "evt-zzzz", "post-1", "rev-1", "2026-08-01 09:00:00");
  hide(db, "evt-yyyy", "post-1", "2026-08-01 09:00:00");
  publish(db, "evt-0001", "post-1", "rev-1", "2026-08-01 09:00:00");

  assert.equal(index(db).length, 1);
  assert.equal(total(db), 1);
});
