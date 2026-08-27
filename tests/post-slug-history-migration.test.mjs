import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Migration 0030 is the first new one since Production closed at 0029, so it is
// proven three ways rather than one: applied from nothing, applied on top of a
// database that already stopped at 0029, and rolled back mid-way. The third
// matters most - a rename is two writes, and a failure between them would leave
// a post at a URL with no record of where it came from.

const directory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const ALL = readdirSync(directory).filter((entry) => entry.endsWith(".sql")).sort();
const NEW_MIGRATION = "0030_post_slug_history.sql";

function apply(db, files) {
  for (const name of files) {
    for (const statement of readFileSync(`${directory}/${name}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }
}

function seedOwner(db) {
  db.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('user-owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('user-owner', 'OWNER', 'user-owner');
  `);
}

function migrated(files = ALL) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  apply(db, files);
  seedOwner(db);
  return db;
}

function seedPost(db, id = "post-1", slug = "first-post") {
  db.exec(`INSERT INTO posts (id, slug, created_by) VALUES ('${id}', '${slug}', 'user-owner')`);
}

/** The rename, in the order the route performs it. */
function rename(db, postId, from, to, key) {
  const requestKey = key ?? `rk-${to}`;
  db.exec(`UPDATE posts SET slug = '${to}' WHERE id = '${postId}'`);
  db.exec(
    `INSERT INTO post_slug_history (id, request_key, post_id, from_slug, to_slug, created_by)
     VALUES ('h-${requestKey}', '${requestKey}', '${postId}', '${from}', '${to}', 'user-owner')`,
  );
}

test("the sequence is gapless and 0030 remains immediately after 0029", () => {
  assert.equal(ALL[29], "0029_yard_rows_and_slots.sql");
  assert.equal(ALL[30], NEW_MIGRATION);
  assert.equal(ALL[31], "0031_intake_inspection_evidence.sql");
  ALL.forEach((name, index) => assert.equal(name.slice(0, 4), String(index).padStart(4, "0")));
});

test("a virgin database migrates through the current chain and gains exactly the slug history objects", () => {
  const db = migrated();
  const objects = db
    .prepare("SELECT type, name FROM sqlite_master WHERE name LIKE '%post_slug_history%' ORDER BY name")
    .all()
    .map((row) => `${row.type}:${row.name}`)
    .sort();
  assert.deepEqual(
    objects,
    [
      "index:idx_post_slug_history_from_created",
      "index:idx_post_slug_history_post_created",
      // SQLite's own index for the text primary key, as on every other table
      // here. Named rather than filtered out, so the set is the whole truth.
      "index:sqlite_autoindex_post_slug_history_1",
      "index:uq_post_slug_history_request_key",
      "table:post_slug_history",
      "trigger:trg_post_slug_history_immutable_update",
      "trigger:trg_post_slug_history_no_delete",
      "trigger:trg_post_slug_history_source_is_free",
      "trigger:trg_post_slug_history_target_is_current",
    ].sort(),
  );
  db.close();
});

// The upgrade a Production database will actually perform.
test("a database that stopped at 0029 upgrades without disturbing what is already stored", () => {
  const db = migrated(ALL.filter((name) => name < NEW_MIGRATION));
  seedPost(db);
  db.exec(
    `INSERT INTO post_revisions (id, request_key, post_id, content_json, content_hash, created_by)
     VALUES ('rev-1', 'k-1', 'post-1', '{"version":1}', '${"a".repeat(64)}', 'user-owner')`,
  );
  db.exec(
    `INSERT INTO post_publication_events (id, request_key, post_id, revision_id, action, created_by)
     VALUES ('pub-1', 'pk-1', 'post-1', 'rev-1', 'PUBLISH', 'user-owner')`,
  );
  // Before the migration there is nowhere to record a previous slug at all.
  assert.throws(() => db.exec("SELECT 1 FROM post_slug_history"), /no such table/i);

  apply(db, [NEW_MIGRATION]);

  // Everything that was there is still there, and the new table is usable.
  assert.equal(db.prepare("SELECT slug FROM posts WHERE id = 'post-1'").get().slug, "first-post");
  assert.equal(db.prepare("SELECT count(*) AS n FROM post_revisions").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM post_publication_events").get().n, 1);
  rename(db, "post-1", "first-post", "second-post");
  assert.equal(db.prepare("SELECT count(*) AS n FROM post_slug_history").get().n, 1);
  db.close();
});

test("history is append-only, so a redirect cannot be re-pointed after the links are made", () => {
  const db = migrated();
  seedPost(db);
  rename(db, "post-1", "first-post", "second-post");
  assert.throws(
    () => db.exec("UPDATE post_slug_history SET to_slug = 'elsewhere' WHERE from_slug = 'first-post'"),
    /append-only/,
  );
  assert.throws(() => db.exec("DELETE FROM post_slug_history WHERE from_slug = 'first-post'"), /cannot be deleted/);
  db.close();
});

// A row claiming a move that did not happen is the one lie that would make the
// public site serve a redirect to a URL that answers with nothing.
test("a history row must name the slug the post actually has now", () => {
  const db = migrated();
  seedPost(db);
  // The post really is renamed, so `from_slug` is genuinely free and only the
  // destination is wrong. Isolating it this way is the point: with both rules
  // violated at once either trigger could be the one that fires.
  db.exec("UPDATE posts SET slug = 'second-post' WHERE id = 'post-1'");
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO post_slug_history (id, request_key, post_id, from_slug, to_slug, created_by)
         VALUES ('h-1', 'rk-1', 'post-1', 'first-post', 'never-happened', 'user-owner')`,
      ),
    /must name the slug the post now has/,
  );
  db.close();
});

test("a previous slug that still belongs to a live post is refused", () => {
  const db = migrated();
  seedPost(db, "post-1", "first-post");
  seedPost(db, "post-2", "second-post");
  // post-2 moved to third-post, but claiming first-post - which post-1 holds -
  // as its previous slug would shadow a real URL.
  db.exec("UPDATE posts SET slug = 'third-post' WHERE id = 'post-2'");
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO post_slug_history (id, request_key, post_id, from_slug, to_slug, created_by)
         VALUES ('h-2', 'rk-2', 'post-2', 'first-post', 'third-post', 'user-owner')`,
      ),
    /cannot still belong to a live post/,
  );
  db.close();
});

test("both slugs must be shapes the public site can serve, and they must differ", () => {
  const db = migrated();
  seedPost(db);
  db.exec("UPDATE posts SET slug = 'second-post' WHERE id = 'post-1'");
  for (const from of ["Upper", "with space", "-leading", "trailing-", "double--hyphen", ""]) {
    assert.throws(
      () =>
        db.exec(
          `INSERT INTO post_slug_history (id, request_key, post_id, from_slug, to_slug, created_by)
           VALUES ('h-x', 'rk-x', 'post-1', '${from}', 'second-post', 'user-owner')`,
        ),
      /CHECK|constraint/i,
      `from_slug ${JSON.stringify(from)} was accepted`,
    );
  }
  // A redirect from a slug to itself is refused, and it is worth recording
  // which rule gets there first: `to_slug` has to be the post's current slug,
  // so a row with `from_slug` equal to it is naming a slug that is still live,
  // and the trigger fires before the CHECK. Blocked either way; the CHECK is
  // the backstop for a row that reached the table by some other route.
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO post_slug_history (id, request_key, post_id, from_slug, to_slug, created_by)
         VALUES ('h-same', 'rk-same', 'post-1', 'second-post', 'second-post', 'user-owner')`,
      ),
    /cannot still belong to a live post|CHECK|constraint/i,
  );
  db.close();
});

test("replaying one rename submission cannot move a post twice", () => {
  const db = migrated();
  seedPost(db);
  rename(db, "post-1", "first-post", "second-post", "same-key");
  db.exec("UPDATE posts SET slug = 'third-post' WHERE id = 'post-1'");
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO post_slug_history (id, request_key, post_id, from_slug, to_slug, created_by)
         VALUES ('h-dup', 'same-key', 'post-1', 'second-post', 'third-post', 'user-owner')`,
      ),
    /UNIQUE|constraint/i,
  );
  db.close();
});

// The property the whole rename depends on: two writes, one outcome.
test("a rename that fails half way leaves the post where it was", () => {
  const db = migrated();
  seedPost(db);
  db.exec("BEGIN");
  db.exec("UPDATE posts SET slug = 'second-post' WHERE id = 'post-1'");
  assert.throws(
    () =>
      db.exec(
        // The wrong destination: the trigger refuses it, exactly as it would if
        // the application had computed the pair wrongly.
        `INSERT INTO post_slug_history (id, request_key, post_id, from_slug, to_slug, created_by)
         VALUES ('h-bad', 'rk-bad', 'post-1', 'first-post', 'somewhere-else', 'user-owner')`,
      ),
    /must name the slug the post now has/,
  );
  db.exec("ROLLBACK");

  assert.equal(db.prepare("SELECT slug FROM posts WHERE id = 'post-1'").get().slug, "first-post");
  assert.equal(db.prepare("SELECT count(*) AS n FROM post_slug_history").get().n, 0);
  db.close();
});

// Renaming away, back, and away again is an ordinary editorial sequence. A
// unique index on the previous slug would have made the third step impossible.
test("a slug can be abandoned, reclaimed and abandoned again", () => {
  const db = migrated();
  seedPost(db);
  rename(db, "post-1", "first-post", "second-post", "k1");
  rename(db, "post-1", "second-post", "first-post", "k2");
  rename(db, "post-1", "first-post", "third-post", "k3");
  const rows = db
    .prepare("SELECT from_slug, to_slug FROM post_slug_history ORDER BY created_at, id")
    .all()
    .map((row) => `${row.from_slug}->${row.to_slug}`);
  assert.equal(rows.length, 3);
  assert.ok(rows.includes("first-post->third-post"), `unexpected history: ${rows.join(", ")}`);
  assert.equal(db.prepare("SELECT slug FROM posts WHERE id = 'post-1'").get().slug, "third-post");
  db.close();
});
