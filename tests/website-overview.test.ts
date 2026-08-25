import assert from "node:assert/strict";
import test from "node:test";
import { SITE_PAGE_DEFINITIONS } from "../lib/site-cms-content.ts";
import {
  UNHIDEABLE_PAGE_SLUG,
  buildAttentionList,
  buildMediaOverview,
  buildPostOverview,
  buildSettingsOverview,
  buildSitePageOverview,
  unavailableOverview,
  type WebsiteOverview,
} from "../lib/website-overview-content.ts";

const managedSlugs = Object.keys(SITE_PAGE_DEFINITIONS);

test("every managed route appears, including ones the CMS has never touched", () => {
  const pages = buildSitePageOverview([]);
  assert.equal(pages.length, managedSlugs.length);
  assert.deepEqual(pages.map((page) => page.slug), managedSlugs);
  // A route with no row is still a route the public can reach; leaving it off
  // the screen would hide a live page from the person responsible for it.
  assert.ok(pages.every((page) => page.state === "SOURCE_DEFAULT"));
  assert.ok(pages.every((page) => page.path === SITE_PAGE_DEFINITIONS[page.slug].path));
});

test("a page reports what a reader is actually being served", () => {
  const pages = buildSitePageOverview([
    { slug: "home", action: "PUBLISH", changed_at: "2026-08-01 09:00:00", revision_count: 3 },
    { slug: "about", action: "HIDE", changed_at: "2026-08-02 09:00:00", revision_count: 1 },
  ]);
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  assert.equal(bySlug.get("home")?.state, "PUBLISHED");
  assert.equal(bySlug.get("home")?.changedAt, "2026-08-01T09:00:00.000Z");
  assert.equal(bySlug.get("home")?.revisionCount, 3);
  assert.equal(bySlug.get("about")?.state, "HIDDEN");
  assert.equal(bySlug.get("contact")?.state, "SOURCE_DEFAULT");
});

test("the home page is never offered a hide control, because the database refuses one", () => {
  const pages = buildSitePageOverview([]);
  const home = pages.find((page) => page.slug === UNHIDEABLE_PAGE_SLUG);
  assert.equal(home?.canHide, false);
  assert.ok(pages.filter((page) => page.slug !== UNHIDEABLE_PAGE_SLUG).every((page) => page.canHide));
});

test("a row that is not the shape the query returns is ignored rather than trusted", () => {
  const pages = buildSitePageOverview([
    { slug: 42, action: "PUBLISH", changed_at: "2026-08-01 09:00:00", revision_count: 3 },
    { slug: "home", action: "SOMETHING_ELSE", changed_at: "not a date", revision_count: -5 },
  ]);
  const home = pages.find((page) => page.slug === "home");
  assert.equal(home?.state, "SOURCE_DEFAULT");
  assert.equal(home?.changedAt, null);
  assert.equal(home?.revisionCount, 0);
});

test("post states always add up to the total", () => {
  const posts = buildPostOverview({ total: 7, published: 3, hidden: 2 });
  assert.deepEqual(posts, { total: 7, published: 3, hidden: 2, draft: 2 });
  assert.equal(posts.published + posts.hidden + posts.draft, posts.total);

  // Nothing recorded at all is zero everywhere rather than a negative draft
  // count, which is what a subtraction would produce from a partial read.
  assert.deepEqual(buildPostOverview(null), { total: 0, published: 0, hidden: 0, draft: 0 });
  assert.equal(buildPostOverview({ total: 1, published: 4, hidden: 0 }).draft, 0);
});

test("media is reported split, so public photographs and operational evidence never share a number", () => {
  const media = buildMediaOverview({ total: 5, public_published: 2, drafts: 1, featured: 1, not_public: 2 });
  assert.deepEqual(media, { total: 5, publicPublished: 2, drafts: 1, featured: 1, notPublic: 2 });
  assert.deepEqual(buildMediaOverview(null), { total: 0, publicPublished: 0, drafts: 0, featured: 0, notPublic: 0 });
});

test("settings distinguish published from never-published", () => {
  assert.deepEqual(buildSettingsOverview({ revision_id: null, changed_at: null, revision_count: 2 }), {
    published: false,
    revisionId: null,
    changedAt: null,
    revisionCount: 2,
  });
  assert.deepEqual(
    buildSettingsOverview({ revision_id: "settings-1", changed_at: "2026-08-05 09:00:00", revision_count: 4 }),
    { published: true, revisionId: "settings-1", changedAt: "2026-08-05T09:00:00.000Z", revisionCount: 4 },
  );
  // An empty string is not a revision id.
  assert.equal(buildSettingsOverview({ revision_id: "", changed_at: null, revision_count: 0 }).published, false);
});

test("an unreadable database is reported as unreadable, never as an empty site", () => {
  const overview = unavailableOverview();
  assert.equal(overview.unavailable, true);
  // Every managed route is still listed, so the screen keeps its shape and the
  // Owner is not shown a site that appears to have lost its pages.
  assert.equal(overview.pages.length, managedSlugs.length);
  assert.equal(overview.posts.total, 0);
});

function overviewWith(overrides: Partial<WebsiteOverview> = {}): WebsiteOverview {
  return {
    pages: buildSitePageOverview([{ slug: "home", action: "PUBLISH", changed_at: "2026-08-01 09:00:00", revision_count: 1 }]),
    posts: { total: 1, published: 1, hidden: 0, draft: 0 },
    media: { total: 2, publicPublished: 2, drafts: 0, featured: 1, notPublic: 0 },
    settings: { published: true, revisionId: "settings-1", changedAt: "2026-08-01T09:00:00.000Z", revisionCount: 1 },
    unavailable: false,
    ...overrides,
  };
}

test("nothing is flagged when there is nothing to act on", () => {
  assert.deepEqual(buildAttentionList(overviewWith()), []);
});

test("a hidden page stays visible to the Owner, so it cannot be forgotten", () => {
  const attention = buildAttentionList(
    overviewWith({
      pages: buildSitePageOverview([
        { slug: "home", action: "PUBLISH", changed_at: null, revision_count: 1 },
        { slug: "about", action: "HIDE", changed_at: null, revision_count: 1 },
      ]),
    }),
  );
  assert.equal(attention.length, 1);
  assert.equal(attention[0].href, "/app/site-content/about");
});

test("work that has stalled is named with its count and a way to it", () => {
  const attention = buildAttentionList(
    overviewWith({
      posts: { total: 4, published: 1, hidden: 0, draft: 3 },
      media: { total: 9, publicPublished: 2, drafts: 7, featured: 1, notPublic: 0 },
      settings: { published: false, revisionId: null, changedAt: null, revisionCount: 0 },
    }),
  );
  assert.deepEqual(attention.map((item) => item.href), ["/app/gallery", "/app/posts", "/app/site-settings"]);
  assert.ok(attention[0].detail.includes("7"));
  assert.ok(attention[1].detail.includes("3"));
});

test("a page still serving its source default is not treated as a problem", () => {
  // It is the normal state of a site nobody has edited yet, and listing ten of
  // them would bury the one thing that does need attention.
  const attention = buildAttentionList(overviewWith());
  assert.ok(attention.every((item) => !item.href.startsWith("/app/site-content/")));
});
