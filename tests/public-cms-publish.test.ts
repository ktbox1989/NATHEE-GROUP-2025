import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_CMS_CONTRACT_VERSION, PUBLIC_ROUTE_PATHS, type PublicPage } from "../lib/public-cms/contract.ts";
import { POSTS_INDEX_PATH, postPath, type PostAvailability, type PublicPost } from "../lib/public-cms/posts.ts";
import { planInvalidation, requiresPublicDeployment, wasRejected, type PublishEvent } from "../lib/public-cms/revalidation.ts";
import { ROBOTS_DISALLOWED, buildRobotsTxt, buildSitemap, type PageAvailability } from "../lib/public-cms/seo.ts";

function page(path: PublicPage["path"], overrides: Partial<PublicPage> = {}): PublicPage {
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    slug: path.replaceAll("/", "") || "home",
    path,
    status: "PUBLISHED",
    heading: "หัวข้อ",
    seo: { title: `ชื่อ ${path}`, description: "รายละเอียด", canonicalPath: path, robots: "INDEX" },
    sections: [],
    revisionId: "rev-1",
    publishedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function post(slug: string, overrides: Partial<PublicPost> = {}): PublicPost {
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    status: "PUBLISHED",
    slug,
    path: postPath(slug),
    title: "ข่าว",
    excerpt: "สรุปข่าว",
    category: null,
    publishedAt: "2026-08-01T09:00:00.000Z",
    updatedAt: null,
    featuredImage: null,
    sections: [],
    seo: { title: "ข่าว", description: "รายละเอียด", canonicalPath: postPath(slug), robots: "INDEX" },
    revisionId: "rev-1",
    ...overrides,
  };
}

// --- publishing a post ------------------------------------------------------

test("publishing a post refreshes the post, the index and the sitemap", () => {
  const plan = planInvalidation({ kind: "POST_PUBLISHED", path: postPath("new-truck"), revisionId: "rev-7" });
  assert.equal(plan.delivery, "CACHE");
  assert.deepEqual(plan.paths, ["/news/", "/news/new-truck/"]);
  assert.equal(plan.regenerateSitemap, true);
  assert.deepEqual(plan.removedPaths, []);
});

test("publishing a post does not dump the cache for the whole site", () => {
  // Fanning out further would mean every editorial edit invalidated eleven
  // marketing routes that do not show posts at all.
  const plan = planInvalidation({ kind: "POST_PUBLISHED", path: postPath("a"), revisionId: "r" });
  for (const route of PUBLIC_ROUTE_PATHS) {
    assert.equal(plan.paths.includes(route), false, `${route} does not show posts and must not be dropped`);
  }
});

test("unpublishing a post stops the URL answering and takes it out of the sitemap", () => {
  const plan = planInvalidation({ kind: "POST_UNPUBLISHED", path: postPath("withdrawn") });
  assert.equal(plan.delivery, "CACHE");
  assert.deepEqual(plan.removedPaths, ["/news/withdrawn/"]);
  assert.equal(plan.paths.includes("/sitemap.xml"), true);
  assert.equal(plan.paths.includes(POSTS_INDEX_PATH), true);
  assert.equal(plan.regenerateSitemap, true);
});

test("renaming a post invalidates both URLs and keeps the old one answering", () => {
  const plan = planInvalidation({ kind: "POST_MOVED", from: postPath("old-name"), to: postPath("new-name") });
  assert.equal(plan.delivery, "CACHE");
  assert.equal(plan.paths.includes("/news/old-name/"), true);
  assert.equal(plan.paths.includes("/news/new-name/"), true);
  // The old URL must answer with a 301, not a 404: that is what carries the
  // inbound links to the new slug. Removing it would throw them away.
  assert.deepEqual(plan.removedPaths, []);
  assert.equal(plan.regenerateSitemap, true);
});

test("a malformed post event is refused rather than purging or silently passing", () => {
  const bad: PublishEvent[] = [
    { kind: "POST_PUBLISHED", path: "/about/", revisionId: "r" },
    { kind: "POST_PUBLISHED", path: POSTS_INDEX_PATH, revisionId: "r" },
    { kind: "POST_PUBLISHED", path: "/news/Not A Slug/", revisionId: "r" },
    { kind: "POST_UNPUBLISHED", path: "/" },
    { kind: "POST_MOVED", from: postPath("a"), to: "/about/" },
    { kind: "POST_MOVED", from: postPath("a"), to: postPath("a") },
  ];
  for (const event of bad) {
    const plan = planInvalidation(event);
    assert.equal(plan.delivery, "REJECTED", `${JSON.stringify(event)} must be refused`);
    // Neither of the wrong answers: nothing is purged, and nothing is claimed.
    assert.deepEqual(plan.paths, []);
    assert.equal(plan.regenerateSitemap, false);
    assert.equal(wasRejected(event), true);
    // A deployment would not fix a malformed event, so it must not ask for one.
    assert.equal(requiresPublicDeployment(event), false);
  }
});

test("how a change reaches visitors is a field, not a phrase to match on", () => {
  assert.equal(planInvalidation({ kind: "PAGE_PUBLISHED", path: "/about/", revisionId: "r" }).delivery, "CACHE");
  assert.equal(planInvalidation({ kind: "SETTINGS_PUBLISHED", revisionId: "r" }).delivery, "CACHE");
  assert.equal(planInvalidation({ kind: "TEMPLATE_CHANGED" } as never).delivery, "DEPLOY");
  assert.equal(planInvalidation({ kind: "PAGE_UNPUBLISHED", path: "/" }).delivery, "REJECTED");
  assert.equal(requiresPublicDeployment({ kind: "TEMPLATE_CHANGED" } as never), true);
});

test("ordinary editorial work never requires a deployment", () => {
  const events: PublishEvent[] = [
    { kind: "POST_PUBLISHED", path: postPath("a"), revisionId: "r" },
    { kind: "POST_UNPUBLISHED", path: postPath("a") },
    { kind: "POST_MOVED", from: postPath("a"), to: postPath("b") },
  ];
  for (const event of events) {
    assert.equal(requiresPublicDeployment(event), false, `${event.kind} must not need a deploy`);
  }
});

// --- one sitemap ------------------------------------------------------------

const published = (value: PublicPage): PageAvailability => ({ state: "PUBLISHED", page: value });
const publishedPost = (value: PublicPost): PostAvailability => ({ state: "PUBLISHED", post: value });

test("the sitemap carries both content types, deduplicated and sorted", () => {
  const entries = buildSitemap(
    [published(page("/")), published(page("/about/"))],
    [publishedPost(post("b-post")), publishedPost(post("a-post"))],
  );
  assert.deepEqual(entries.map((entry) => entry.url), [
    "https://natheegroup2025.com/",
    "https://natheegroup2025.com/about/",
    "https://natheegroup2025.com/news/",
    "https://natheegroup2025.com/news/a-post/",
    "https://natheegroup2025.com/news/b-post/",
  ]);
});

test("sorting makes the sitemap diffable rather than merely observable", () => {
  const forwards = buildSitemap([published(page("/about/")), published(page("/"))], [publishedPost(post("x"))]);
  const backwards = buildSitemap([published(page("/")), published(page("/about/"))], [publishedPost(post("x"))]);
  assert.deepEqual(forwards, backwards);
});

test("a site with no posts has no news section in its sitemap", () => {
  const entries = buildSitemap([published(page("/"))]);
  assert.deepEqual(entries.map((entry) => entry.url), ["https://natheegroup2025.com/"]);
  assert.equal(entries.some((entry) => entry.url.includes("/news/")), false);
});

test("nothing unpublished or noindex reaches the sitemap", () => {
  const entries = buildSitemap(
    [
      published(page("/")),
      published(page("/about/", { seo: { ...page("/about/").seo, robots: "NOINDEX" } })),
      { state: "UNPUBLISHED" },
      { state: "MOVED", to: "/contact/" },
    ],
    [
      publishedPost(post("visible")),
      publishedPost(post("hidden", { seo: { ...post("hidden").seo, robots: "NOINDEX" } })),
      { state: "UNPUBLISHED" },
    ],
  );
  const urls = entries.map((entry) => entry.url);
  assert.equal(urls.includes("https://natheegroup2025.com/about/"), false);
  assert.equal(urls.includes("https://natheegroup2025.com/news/hidden/"), false);
  assert.equal(urls.includes("https://natheegroup2025.com/news/visible/"), true);
  assert.equal(urls.includes("https://natheegroup2025.com/contact/"), false, "a redirect target is not itself published here");
});

test("a post reports its edit date, and its publication date when never edited", () => {
  const entries = buildSitemap(
    [],
    [
      publishedPost(post("edited", { updatedAt: "2026-08-10T00:00:00.000Z" })),
      publishedPost(post("untouched")),
    ],
  );
  const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
  assert.equal(byUrl.get("https://natheegroup2025.com/news/edited/")?.lastModified, "2026-08-10T00:00:00.000Z");
  assert.equal(byUrl.get("https://natheegroup2025.com/news/untouched/")?.lastModified, "2026-08-01T09:00:00.000Z");
  // The index changed when the newest post did.
  assert.equal(byUrl.get("https://natheegroup2025.com/news/")?.lastModified, "2026-08-10T00:00:00.000Z");
});

test("a page reports when it was published", () => {
  const entries = buildSitemap([published(page("/", { publishedAt: "2026-07-04T00:00:00.000Z" }))]);
  assert.equal(entries[0]?.lastModified, "2026-07-04T00:00:00.000Z");
});

// --- robots -----------------------------------------------------------------

test("robots keeps crawlers out of the authenticated surfaces", () => {
  const robots = buildRobotsTxt();
  for (const path of ["/api/", "/app/", "/auth/", "/login/"]) {
    assert.ok(robots.includes(`Disallow: ${path}`), `${path} must be disallowed`);
  }
  assert.ok(robots.includes("Allow: /"));
  assert.ok(robots.includes("Sitemap: https://natheegroup2025.com/sitemap.xml"));
  assert.deepEqual(
    [...ROBOTS_DISALLOWED],
    ["/api/", "/app/", "/auth/", "/login/", "/login-status.html"],
  );
});

test("the disallow list matches what the shipped robots.txt already says", async () => {
  // The generated contract and the file currently on the site must not drift:
  // one of them is what visitors and crawlers actually get.
  const shipped = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../public-site/robots.txt", import.meta.url), "utf8"),
  );
  for (const path of ROBOTS_DISALLOWED) {
    assert.ok(shipped.includes(`Disallow: ${path}`), `the shipped robots.txt does not disallow ${path}`);
  }
  assert.ok(shipped.includes("Sitemap: https://natheegroup2025.com/sitemap.xml"));
});

test("a non-canonical origin disallows everything rather than competing with the real site", () => {
  // A staging copy indexed alongside production splits the site's ranking
  // between two hosts, and the wrong one wins about half the time.
  const robots = buildRobotsTxt({ indexable: false });
  assert.ok(robots.includes("Disallow: /"));
  assert.equal(robots.includes("Allow: /"), false);
  assert.equal(robots.includes("Sitemap:"), false, "a staging copy must not advertise a sitemap either");
});
