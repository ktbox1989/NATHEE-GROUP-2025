import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The rules that must hold even against a direct write, because an application
// bug or a console session is exactly when they matter.

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
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('user-owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('user-owner', 'OWNER', 'user-owner');
  `);
  return db;
}

const CONTENT = JSON.stringify({ version: 1, title: "t", excerpt: "e" });
const HASH = "a".repeat(64);

function seedPost(db, slug = "first-post") {
  db.exec(`INSERT INTO posts (id, slug, created_by) VALUES ('post-1', '${slug}', 'user-owner')`);
  db.exec(
    `INSERT INTO post_revisions (id, request_key, post_id, content_json, content_hash, created_by)
     VALUES ('rev-1', 'key-1', 'post-1', '${CONTENT}', '${HASH}', 'user-owner')`,
  );
}

test("a post slug must be the shape the public site can serve", () => {
  const db = migrated();
  for (const slug of ["Upper", "with space", "-leading", "trailing-", "double--hyphen", "ไทย", ""]) {
    assert.throws(
      () => db.exec(`INSERT INTO posts (id, slug, created_by) VALUES ('p', '${slug}', 'user-owner')`),
      /CHECK|constraint/i,
      `slug ${JSON.stringify(slug)} was accepted`,
    );
  }
  db.exec("INSERT INTO posts (id, slug, created_by) VALUES ('p-ok', 'a-good-slug-2026', 'user-owner')");
  db.close();
});

// A post at /news/page/ would be unreachable behind the index pagination.
test("slugs that collide with the index or a feed are refused", () => {
  const db = migrated();
  for (const slug of ["page", "feed", "rss", "atom", "sitemap", "index", "all", "category", "tag"]) {
    assert.throws(
      () => db.exec(`INSERT INTO posts (id, slug, created_by) VALUES ('p-${slug}', '${slug}', 'user-owner')`),
      /CHECK|constraint/i,
      `reserved slug ${slug} was accepted`,
    );
  }
  db.close();
});

test("two posts cannot share a slug", () => {
  const db = migrated();
  seedPost(db);
  assert.throws(
    () => db.exec("INSERT INTO posts (id, slug, created_by) VALUES ('post-2', 'first-post', 'user-owner')"),
    /UNIQUE|constraint/i,
  );
  db.close();
});

test("revisions are append-only", () => {
  const db = migrated();
  seedPost(db);
  assert.throws(() => db.exec("UPDATE post_revisions SET content_hash = 'b' WHERE id = 'rev-1'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM post_revisions WHERE id = 'rev-1'"), /cannot be deleted/);
  db.close();
});

test("publication history is append-only, so a post cannot be un-published by deletion", () => {
  const db = migrated();
  seedPost(db);
  db.exec(
    `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by)
     VALUES ('pub-1', 'pk-1', 'post-1', 'rev-1', 'PUBLISH', 'user-owner')`,
  );
  assert.throws(() => db.exec("UPDATE post_publication_events SET action = 'HIDE' WHERE id = 'pub-1'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM post_publication_events WHERE id = 'pub-1'"), /cannot be deleted/);
  db.close();
});

// Publishing another post's revision would serve the wrong content under this
// slug, and nothing else in the write path can see across posts.
test("a published revision must belong to the post it is published under", () => {
  const db = migrated();
  seedPost(db);
  db.exec("INSERT INTO posts (id, slug, created_by) VALUES ('post-2', 'second-post', 'user-owner')");
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by)
         VALUES ('pub-x', 'pk-x', 'post-2', 'rev-1', 'PUBLISH', 'user-owner')`,
      ),
    /must belong to the same post/,
  );
  db.close();
});

test("a publish needs a revision and a hide must not carry one", () => {
  const db = migrated();
  seedPost(db);
  // Refused by the scope trigger rather than the CHECK: a NULL revision belongs
  // to no post, so the trigger fires first. Either way it does not get in.
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by)
         VALUES ('pub-a', 'pk-a', 'post-1', NULL, 'PUBLISH', 'user-owner')`,
      ),
    /must belong to the same post|CHECK|constraint/i,
  );
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by)
         VALUES ('pub-b', 'pk-b', 'post-1', 'rev-1', 'HIDE', 'user-owner')`,
      ),
    /CHECK|constraint/i,
  );
  db.close();
});

test("a repeated request key cannot create a second revision or a second publication", () => {
  const db = migrated();
  seedPost(db);
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO post_revisions (id, request_key, post_id, content_json, content_hash, created_by)
         VALUES ('rev-2', 'key-1', 'post-1', '${CONTENT}', '${HASH}', 'user-owner')`,
      ),
    /UNIQUE|constraint/i,
  );
  db.exec(
    `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by)
     VALUES ('pub-1', 'pk-1', 'post-1', 'rev-1', 'PUBLISH', 'user-owner')`,
  );
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by)
         VALUES ('pub-2', 'pk-1', 'post-1', 'rev-1', 'PUBLISH', 'user-owner')`,
      ),
    /UNIQUE|constraint/i,
  );
  db.close();
});

test("content must be bounded valid JSON with a real content hash", () => {
  const db = migrated();
  db.exec("INSERT INTO posts (id, slug, created_by) VALUES ('post-1', 'first-post', 'user-owner')");
  const insert = (json, hash) =>
    db.exec(
      `INSERT INTO post_revisions (id, request_key, post_id, content_json, content_hash, created_by)
       VALUES ('r', 'k', 'post-1', '${json}', '${hash}', 'user-owner')`,
    );
  assert.throws(() => insert("not json", HASH), /CHECK|constraint/i);
  assert.throws(() => insert(CONTENT, "tooshort"), /CHECK|constraint/i);
  assert.throws(() => insert(CONTENT, "g".repeat(64)), /CHECK|constraint/i);
  db.close();
});

// What the public payload derives its dates from, proven against real rows.
test("the first publish is the publication date and a later one is an edit", () => {
  const db = migrated();
  seedPost(db);
  db.exec(
    `INSERT INTO post_revisions (id, request_key, post_id, content_json, content_hash, created_by)
     VALUES ('rev-2', 'key-2', 'post-1', '${CONTENT}', '${HASH}', 'user-owner')`,
  );
  db.exec(
    `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by, created_at)
     VALUES ('pub-1', 'pk-1', 'post-1', 'rev-1', 'PUBLISH', 'user-owner', '2026-08-01 03:00:00')`,
  );
  db.exec(
    `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by, created_at)
     VALUES ('pub-2', 'pk-2', 'post-1', 'rev-2', 'PUBLISH', 'user-owner', '2026-08-09 04:30:00')`,
  );

  const row = db
    .prepare(
      `SELECT min(created_at) AS published_at, max(created_at) AS latest_at, count(*) AS publishes
       FROM post_publication_events WHERE post_id = 'post-1' AND action = 'PUBLISH'`,
    )
    .get();
  assert.equal(row.published_at, "2026-08-01 03:00:00");
  assert.equal(row.latest_at, "2026-08-09 04:30:00");
  assert.equal(row.publishes, 2, "two publishes means the post has been edited since it went live");
  db.close();
});

test("the post history lookup is index-backed rather than a scan", () => {
  const db = migrated();
  seedPost(db);
  const plan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM post_publication_events WHERE post_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
    )
    .all()
    .map((row) => row.detail)
    .join(" ");
  assert.match(plan, /idx_post_publication_post_created/);
  assert.doesNotMatch(plan, /SCAN post_publication_events(?! USING)/);
  db.close();
});
