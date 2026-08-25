import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  auditLogs,
  postPublicationEvents,
  postRevisions,
  posts,
  postSlugHistory,
  sitePagePublicationEvents,
  sitePageRevisions,
  sitePages,
} from "../db/schema.ts";
import { getPostEditorState, getPublishedPost, getRevisionContent, listPosts } from "../lib/post-cms-store.ts";
import { listPostRedirects } from "../lib/post-slug-history.ts";
import { decidePublication, postMovedEvent, postPublishEvent, sitePagePublishEvent } from "../lib/publication-events.ts";
import { getPublishedSitePage } from "../lib/site-cms.ts";
import { d1Over, migratedSqlite } from "./support/d1-over-sqlite.mjs";

// Draft -> Preview -> Publish -> Unpublish -> Revert, run against a real
// migrated database through the code the routes call.
//
// The claim being proven is not "the endpoint returned 200". It is the one that
// matters to an Owner: while a draft exists, the public reader still returns the
// previously published content, and it changes at the moment of publication and
// not before. That cannot be shown by a source scan, and a blanket 401 from an
// unauthenticated request would show it even if the CMS were broken.

const HASH = "b".repeat(64);

/**
 * The driver wraps a database error in a "Failed query" error and keeps the
 * real one as the cause, so matching on the top-level message would pass for
 * any failure at all - including the query being malformed.
 */
function refusedBecause(pattern) {
  return (error) => {
    for (let current = error; current; current = current.cause) {
      if (pattern.test(String(current.message))) return true;
    }
    throw new Error(`refused for the wrong reason: ${error?.message}`);
  };
}

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

let tick = 0;
/** Distinct one-second timestamps, the resolution the timestamp contract uses. */
function at() {
  tick += 1;
  return `2026-08-25 10:${String(Math.floor(tick / 60)).padStart(2, "0")}:${String(tick % 60).padStart(2, "0")}`;
}

/** A revision the real parser accepts; nothing here is looser than production. */
function postContent(title) {
  return {
    version: 1,
    title,
    excerpt: `${title} — สรุปงานขนส่งรถจักรยานยนต์ประจำเดือนอย่างย่อ`,
    category: { id: "news", label: "ข่าวสาร" },
    featuredImageItemId: "",
    seo: {
      title: `${title} | นที กรุ๊ป`,
      description: `${title} รายละเอียดงานขนส่งรถจักรยานยนต์ทั่วประเทศ`,
      robots: "INDEX",
    },
    sections: [
      { id: "s1", type: "CONTENT", enabled: true, heading: "รายละเอียด", body: title, imageItemId: "", items: [] },
    ],
  };
}

async function saveRevision(db, postId, title, key) {
  const id = `rev-${key}`;
  await db.insert(postRevisions).values({
    id,
    requestKey: `save-${key}`,
    postId,
    contentJson: JSON.stringify(postContent(title)),
    contentHash: HASH,
    changeNote: `saved ${key}`,
    createdBy: "user-owner",
    createdAt: at(),
  });
  return id;
}

async function publish(db, postId, slug, revisionId, key) {
  const outcome = decidePublication(postPublishEvent(slug, revisionId ? "PUBLISH" : "HIDE", revisionId));
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.reason);
  const eventId = `pub-${key}`;
  await db.batch([
    db.insert(postPublicationEvents).values({
      id: eventId,
      requestKey: `publish-${key}`,
      postId,
      revisionId,
      action: revisionId ? "PUBLISH" : "HIDE",
      createdBy: "user-owner",
      createdAt: at(),
    }),
    db.insert(auditLogs).values({
      id: `audit-${key}`,
      actorUserId: "user-owner",
      action: revisionId ? "PUBLISH" : "HIDE",
      entityType: "post_publication",
      entityId: eventId,
      afterJson: JSON.stringify({ slug, revisionId, invalidation: outcome.ok ? outcome.invalidation : null }),
    }),
  ]);
  return outcome.ok ? outcome.invalidation : null;
}

test("a post lifecycle: draft is invisible, publish makes it live, revert restores", async () => {
  const { sqlite, db } = setup();
  await db.insert(posts).values({ id: "post-1", slug: "first-post", createdBy: "user-owner", createdAt: at(), updatedAt: at() });

  // 1. A draft exists and the public reader has nothing.
  const first = await saveRevision(db, "post-1", "ฉบับแรก", "one");
  assert.equal(await getPublishedPost("first-post", db), null, "an unpublished draft was public");
  assert.equal((await listPosts(db))[0].state, "DRAFT");

  // 2. Preview reads the draft, scoped to its own post.
  const previewed = await getRevisionContent("post-1", first, db);
  assert.equal(previewed.title, "ฉบับแรก");

  // 3. Publishing makes exactly that revision live.
  const firstPlan = await publish(db, "post-1", "first-post", first, "one");
  assert.deepEqual(firstPlan.paths, ["/news/", "/news/first-post/"]);
  let live = await getPublishedPost("first-post", db);
  assert.equal(live.title ?? live.content.title, "ฉบับแรก");
  assert.equal(live.revisionId, first);
  assert.equal(live.updatedAt, null, "a post published once has never been edited");

  // 4. A second draft changes nothing for a reader until it is published.
  const second = await saveRevision(db, "post-1", "ฉบับสอง", "two");
  live = await getPublishedPost("first-post", db);
  assert.equal(live.content.title, "ฉบับแรก", "saving a draft changed what the public sees");
  assert.equal(live.revisionId, first);
  assert.equal((await getRevisionContent("post-1", second, db)).title, "ฉบับสอง", "preview does not show the draft");

  // 5. Publishing it moves the public reader forward, and marks the post edited.
  await publish(db, "post-1", "first-post", second, "two");
  live = await getPublishedPost("first-post", db);
  assert.equal(live.content.title, "ฉบับสอง");
  assert.ok(live.updatedAt, "a republished post must report when it was edited");

  // 6. Revert is publishing the earlier revision again, not editing anything.
  await publish(db, "post-1", "first-post", first, "revert");
  live = await getPublishedPost("first-post", db);
  assert.equal(live.content.title, "ฉบับแรก", "revert did not restore the previous version");
  assert.equal(live.revisionId, first);

  // 7. Both revisions survive the revert; history is append-only.
  const editor = await getPostEditorState("first-post", db);
  assert.equal(editor.revisions.length, 2);
  assert.equal((await getRevisionContent("post-1", second, db)).title, "ฉบับสอง");

  // 8. Unpublishing takes it away from the public reader without deleting it.
  await publish(db, "post-1", "first-post", null, "hide");
  assert.equal(await getPublishedPost("first-post", db), null, "a hidden post was still public");
  assert.equal((await getPostEditorState("first-post", db)).revisions.length, 2);

  // 9. Every step left a record.
  const events = sqlite.prepare("SELECT count(*) AS n FROM post_publication_events").get();
  assert.equal(events.n, 4);
  const audits = sqlite.prepare("SELECT count(*) AS n FROM audit_logs WHERE entity_type = 'post_publication'").get();
  assert.equal(audits.n, 4);
  // And each audit row carries the exact URLs the publication made untrue.
  const recorded = sqlite
    .prepare("SELECT after_json FROM audit_logs WHERE entity_type = 'post_publication'")
    .all()
    .map((row) => JSON.parse(row.after_json).invalidation);
  for (const plan of recorded) {
    assert.equal(plan.delivery, "CACHE");
    assert.ok(plan.paths.includes("/news/first-post/"));
  }
  sqlite.close();
});

// The reason `rowid` replaced the UUID tie-break: an Owner who publishes and
// immediately reverts must get the revert, not a coin flip.
test("a publish and a revert inside one second resolve in the order they happened", async () => {
  const { sqlite, db } = setup();
  await db.insert(posts).values({ id: "post-1", slug: "first-post", createdBy: "user-owner" });
  const first = await saveRevision(db, "post-1", "ฉบับแรก", "one");
  const second = await saveRevision(db, "post-1", "ฉบับสอง", "two");

  const sameSecond = "2026-08-25 12:00:00";
  // Ids chosen so the *earlier* publication sorts higher as a string: without
  // the insertion-order tie-break this test serves the wrong revision.
  await db.insert(postPublicationEvents).values({
    id: "zzzz-first", requestKey: "p-1", postId: "post-1", revisionId: second, action: "PUBLISH",
    createdBy: "user-owner", createdAt: sameSecond,
  });
  await db.insert(postPublicationEvents).values({
    id: "aaaa-second", requestKey: "p-2", postId: "post-1", revisionId: first, action: "PUBLISH",
    createdBy: "user-owner", createdAt: sameSecond,
  });

  const live = await getPublishedPost("first-post", db);
  assert.equal(live.revisionId, first, "the later publication did not win");
  sqlite.close();
});

test("a managed page lifecycle behaves the same, and the home page cannot be hidden", async () => {
  const { sqlite, db } = setup();
  await db.insert(sitePages).values({ id: "page-home", slug: "home", displayName: "หน้าแรก", createdBy: "user-owner" });

  const content = (title) =>
    JSON.stringify({
      version: 1,
      seo: { title: `${title} | นที กรุ๊ป`, description: `${title} ผู้ให้บริการขนส่งรถจักรยานยนต์ทั่วประเทศ` },
      sections: [
        { id: "hero", type: "HERO", enabled: true, eyebrow: "", heading: title, body: "ขนส่งรถจักรยานยนต์ทั่วประเทศ", imageItemId: "", primaryLabel: "", primaryHref: "", secondaryLabel: "", secondaryHref: "", galleryCategorySlug: "", galleryLimit: 12, items: [] },
      ],
    });
  await db.insert(sitePageRevisions).values({
    id: "sp-rev-1", requestKey: "sp-1", pageId: "page-home", contentJson: content("บ้านเดิม"),
    contentHash: HASH, createdBy: "user-owner", createdAt: at(),
  });

  // A draft page is not published.
  assert.equal((await getPublishedSitePage("home", db)).status, "UNMANAGED");

  const plan = decidePublication(sitePagePublishEvent("home", "PUBLISH", "sp-rev-1"));
  assert.equal(plan.ok, true);
  await db.insert(sitePagePublicationEvents).values({
    id: "sp-pub-1", requestKey: "spk-1", pageId: "page-home", revisionId: "sp-rev-1", action: "PUBLISH",
    createdBy: "user-owner", createdAt: at(),
  });

  const published = await getPublishedSitePage("home", db);
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.content.seo.title, "บ้านเดิม | นที กรุ๊ป");
  assert.equal(published.content.sections[0].heading, "บ้านเดิม");

  // The home page is the site. Hiding it is refused before anything is written.
  const hide = decidePublication(sitePagePublishEvent("home", "HIDE", null));
  assert.equal(hide.ok, false);
  assert.match(hide.reason, /home page cannot be unpublished/);
  assert.equal((await getPublishedSitePage("home", db)).status, "PUBLISHED", "the home page stopped being published");
  sqlite.close();
});

// A rename has to keep the old URL working, or every inbound link is lost.
test("renaming a published post moves it and leaves the old URL redirecting", async () => {
  const { sqlite, db } = setup();
  await db.insert(posts).values({ id: "post-1", slug: "first-post", createdBy: "user-owner" });
  const revision = await saveRevision(db, "post-1", "ฉบับแรก", "one");
  await publish(db, "post-1", "first-post", revision, "one");

  const move = decidePublication(postMovedEvent("first-post", "second-post"));
  assert.equal(move.ok, true);
  await db.batch([
    db.update(posts).set({ slug: "second-post", updatedAt: at() }).where(eq(posts.id, "post-1")),
    db.insert(postSlugHistory).values({
      id: "hist-1", requestKey: "mv-1", postId: "post-1", fromSlug: "first-post", toSlug: "second-post",
      createdBy: "user-owner", createdAt: at(),
    }),
  ]);

  // The post answers at its new URL, with the same published revision.
  const moved = await getPublishedPost("second-post", db);
  assert.ok(moved, "the post did not follow its rename");
  assert.equal(moved.revisionId, revision);
  // And nothing answers at the old one, which is what the redirect is for.
  assert.equal(await getPublishedPost("first-post", db), null);
  assert.deepEqual(await listPostRedirects(db), [{ from: "/news/first-post/", to: "/news/second-post/" }]);
  sqlite.close();
});

// Idempotency is a database property here, not a code path that might be missed.
test("replaying a publish or a save is refused by the request key, not duplicated", async () => {
  const { sqlite, db } = setup();
  await db.insert(posts).values({ id: "post-1", slug: "first-post", createdBy: "user-owner" });
  const revision = await saveRevision(db, "post-1", "ฉบับแรก", "one");
  await publish(db, "post-1", "first-post", revision, "one");

  await assert.rejects(
    () => saveRevision(db, "post-1", "ฉบับแรก", "one"),
    refusedBecause(/UNIQUE constraint failed: post_revisions\.request_key/),
    "the same save request key was accepted twice",
  );
  await assert.rejects(
    () =>
      db.insert(postPublicationEvents).values({
        id: "pub-dup", requestKey: "publish-one", postId: "post-1", revisionId: revision,
        action: "PUBLISH", createdBy: "user-owner",
      }),
    refusedBecause(/UNIQUE constraint failed: post_publication_events\.request_key/),
    "the same publish request key was accepted twice",
  );

  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM post_publication_events").get().n, 1);
  sqlite.close();
});

// Publishing another post's revision would serve the wrong content at this URL.
test("a post cannot publish a revision belonging to another post", async () => {
  const { sqlite, db } = setup();
  await db.insert(posts).values({ id: "post-1", slug: "first-post", createdBy: "user-owner" });
  await db.insert(posts).values({ id: "post-2", slug: "second-post", createdBy: "user-owner" });
  const revision = await saveRevision(db, "post-1", "ฉบับแรก", "one");

  await assert.rejects(
    () =>
      db.insert(postPublicationEvents).values({
        id: "pub-x", requestKey: "px", postId: "post-2", revisionId: revision,
        action: "PUBLISH", createdBy: "user-owner",
      }),
    refusedBecause(/must belong to the same post/),
  );
  // And the preview reader refuses the same crossing.
  assert.equal(await getRevisionContent("post-2", revision, db), null);
  sqlite.close();
});

test("a published post that loses its revision content is served as nothing, not as a broken page", async () => {
  const { sqlite, db } = setup();
  await db.insert(posts).values({ id: "post-1", slug: "first-post", createdBy: "user-owner" });
  const revision = await saveRevision(db, "post-1", "ฉบับแรก", "one");
  await publish(db, "post-1", "first-post", revision, "one");

  // Content that no longer parses - a shape from a future version, say.
  sqlite.exec("PRAGMA writable_schema = ON");
  sqlite.exec("DROP TRIGGER trg_post_revisions_immutable_update");
  sqlite.exec(`UPDATE post_revisions SET content_json = '{"version":99}' WHERE id = '${revision}'`);

  assert.equal(await getPublishedPost("first-post", db), null);
  sqlite.close();
});

test("the audit trail records who published, what, and when", async () => {
  const { sqlite, db } = setup();
  await db.insert(posts).values({ id: "post-1", slug: "first-post", createdBy: "user-owner" });
  const revision = await saveRevision(db, "post-1", "ฉบับแรก", "one");
  await publish(db, "post-1", "first-post", revision, "one");

  const row = sqlite
    .prepare("SELECT actor_user_id, action, entity_type, created_at, after_json FROM audit_logs WHERE entity_type = 'post_publication'")
    .get();
  assert.equal(row.actor_user_id, "user-owner");
  assert.equal(row.action, "PUBLISH");
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(JSON.parse(row.after_json).revisionId, revision);

  // The trail cannot be rewritten to say something else happened.
  assert.throws(() => sqlite.exec("UPDATE audit_logs SET action = 'HIDE'"), /append-only|immutable|cannot/i);
  sqlite.close();
});

// Publication state is derived from the event history rather than stored, so
// "what is live" and "what happened" cannot disagree.
test("there is no way to make a post live except by an event that says so", async () => {
  const { sqlite, db } = setup();
  await db.insert(posts).values({ id: "post-1", slug: "first-post", createdBy: "user-owner" });
  await saveRevision(db, "post-1", "ฉบับแรก", "one");

  assert.equal(await getPublishedPost("first-post", db), null);
  const columns = sqlite.prepare("PRAGMA table_info(posts)").all().map((row) => row.name);
  assert.deepEqual(columns.filter((name) => /status|published|live/i.test(name)), [], "posts carries a publication column");
  sqlite.close();
});

test("a hidden post that is republished becomes live again at the revision named", async () => {
  const { sqlite, db } = setup();
  await db.insert(posts).values({ id: "post-1", slug: "first-post", createdBy: "user-owner" });
  const revision = await saveRevision(db, "post-1", "ฉบับแรก", "one");
  await publish(db, "post-1", "first-post", revision, "one");
  await publish(db, "post-1", "first-post", null, "hide");
  assert.equal(await getPublishedPost("first-post", db), null);

  await publish(db, "post-1", "first-post", revision, "again");
  const live = await getPublishedPost("first-post", db);
  assert.ok(live);
  assert.equal(live.revisionId, revision);
  // Hiding does not change when the post was first published.
  assert.ok(live.publishedAt);
  sqlite.close();
});
