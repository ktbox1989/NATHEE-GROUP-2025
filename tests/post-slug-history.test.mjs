import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { listPostRedirects, listSlugHistoryForPost } from "../lib/post-slug-history.ts";
import { resolvePostRedirect } from "../lib/public-cms/posts.ts";
import { d1Over, migratedSqlite } from "./support/d1-over-sqlite.mjs";

// What the public site is handed when a visitor asks for a URL that no longer
// exists. Run against real rows through the real query, because the interesting
// cases are all about which rows the query must refuse to return.

function setup() {
  const sqlite = migratedSqlite();
  sqlite.exec(`
    INSERT INTO users (id, external_auth_id, email, display_name, role)
    VALUES ('user-owner', 'auth-owner', 'owner@example.test', 'Owner', 'OWNER');
    INSERT INTO user_role_assignments (user_id, role, assigned_by)
    VALUES ('user-owner', 'OWNER', 'user-owner');
  `);
  return { sqlite, db: drizzle(d1Over(sqlite)) };
}

function createPost(sqlite, id, slug) {
  sqlite.exec(`INSERT INTO posts (id, slug, created_by) VALUES ('${id}', '${slug}', 'user-owner')`);
}

/** The rename in the order the route performs it, with a distinct timestamp. */
let clock = 0;
function rename(sqlite, postId, from, to) {
  clock += 1;
  const at = `2026-08-25 00:00:${String(clock).padStart(2, "0")}`;
  sqlite.exec(`UPDATE posts SET slug = '${to}' WHERE id = '${postId}'`);
  sqlite.exec(
    `INSERT INTO post_slug_history (id, request_key, post_id, from_slug, to_slug, created_by, created_at)
     VALUES ('h-${clock}', 'rk-${clock}', '${postId}', '${from}', '${to}', 'user-owner', '${at}')`,
  );
}

test("a rename chain resolves to where the post actually is", async () => {
  const { sqlite, db } = setup();
  createPost(sqlite, "post-1", "first-post");
  rename(sqlite, "post-1", "first-post", "second-post");
  rename(sqlite, "post-1", "second-post", "third-post");

  const redirects = await listPostRedirects(db);
  assert.equal(redirects.length, 2);
  assert.deepEqual(resolvePostRedirect("/news/first-post/", redirects), { to: "/news/third-post/", hops: 2 });
  assert.deepEqual(resolvePostRedirect("/news/second-post/", redirects), { to: "/news/third-post/", hops: 1 });
  sqlite.close();
});

// The failure this rule prevents: a visitor asks for a URL that answers with a
// real post and is redirected away from it.
test("a previous slug that is a live post again gives no redirect", async () => {
  const { sqlite, db } = setup();
  createPost(sqlite, "post-1", "first-post");
  rename(sqlite, "post-1", "first-post", "second-post");

  // Someone else takes the freed slug.
  createPost(sqlite, "post-2", "first-post");

  const redirects = await listPostRedirects(db);
  assert.deepEqual(redirects, [], "a live URL was given a redirect away from itself");
  sqlite.close();
});

test("a post renamed away and back leaves no redirect from its own URL", async () => {
  const { sqlite, db } = setup();
  createPost(sqlite, "post-1", "first-post");
  rename(sqlite, "post-1", "first-post", "second-post");
  rename(sqlite, "post-1", "second-post", "first-post");

  const redirects = await listPostRedirects(db);
  // `first-post` is live again, so only the abandoned `second-post` redirects.
  assert.deepEqual(redirects, [{ from: "/news/second-post/", to: "/news/first-post/" }]);
  assert.equal(resolvePostRedirect("/news/first-post/", redirects), null);
  sqlite.close();
});

// Two posts can each have occupied one URL over time. The last one to leave it
// is the move a visitor should follow.
test("where one slug was abandoned twice, the most recent move wins", async () => {
  const { sqlite, db } = setup();
  createPost(sqlite, "post-1", "shared-slug");
  rename(sqlite, "post-1", "shared-slug", "first-destination");

  createPost(sqlite, "post-2", "shared-slug");
  rename(sqlite, "post-2", "shared-slug", "second-destination");

  const redirects = await listPostRedirects(db);
  const forShared = redirects.filter((redirect) => redirect.from === "/news/shared-slug/");
  assert.equal(forShared.length, 1, "one URL must not redirect to two places");
  assert.deepEqual(forShared[0], { from: "/news/shared-slug/", to: "/news/second-destination/" });
  sqlite.close();
});

test("with no renames there are no redirects at all", async () => {
  const { sqlite, db } = setup();
  createPost(sqlite, "post-1", "first-post");
  assert.deepEqual(await listPostRedirects(db), []);
  sqlite.close();
});

test("the editor can see every URL a post has been served at", async () => {
  const { sqlite, db } = setup();
  createPost(sqlite, "post-1", "first-post");
  rename(sqlite, "post-1", "first-post", "second-post");
  rename(sqlite, "post-1", "second-post", "third-post");

  const history = await listSlugHistoryForPost(db, "post-1");
  assert.deepEqual(
    history.map((row) => `${row.fromSlug}->${row.toSlug}`),
    ["first-post->second-post", "second-post->third-post"],
  );
  sqlite.close();
});

// Every redirect handed to the public site has passed its own validator, so a
// row that could become an open redirect or a loop is one missing redirect
// here rather than a defect on the apex.
test("only redirects the public site would accept are returned", async () => {
  const { sqlite, db } = setup();
  createPost(sqlite, "post-1", "first-post");
  rename(sqlite, "post-1", "first-post", "second-post");

  for (const redirect of await listPostRedirects(db)) {
    assert.match(redirect.from, /^\/news\/[a-z0-9-]+\/$/);
    assert.match(redirect.to, /^\/news\/[a-z0-9-]+\/$/);
    assert.notEqual(redirect.from, redirect.to);
  }
  sqlite.close();
});
