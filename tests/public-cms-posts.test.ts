import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_CMS_CONTRACT_VERSION, PUBLIC_ROUTE_PATHS, type PublicMedia } from "../lib/public-cms/contract.ts";
import {
  POSTS_INDEX_PATH,
  POSTS_PAGE_SIZE,
  buildPostCategories,
  buildPostList,
  buildPostSitemapUrls,
  comparePostsForList,
  isPostPath,
  isValidPostSlug,
  postPath,
  resolvePostRedirect,
  validatePostRedirect,
  validatePublicPost,
  type PublicPost,
} from "../lib/public-cms/posts.ts";

const image: PublicMedia = {
  id: "media-1",
  altText: "รถบรรทุกขนส่งรถจักรยานยนต์",
  caption: null,
  variants: [{ src: "/assets/gallery/a-display.jpg", width: 1600, height: 900, format: "jpeg", role: "display" }],
};

function post(overrides: Partial<PublicPost> = {}): PublicPost {
  const slug = overrides.slug ?? "new-six-wheel-truck";
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    status: "PUBLISHED",
    slug,
    path: postPath(slug),
    title: "รับมอบรถบรรทุก 6 ล้อคันใหม่",
    excerpt: "เพิ่มกำลังขนส่งสำหรับงานล็อตใหญ่ในเส้นทางภาคเหนือ",
    category: { id: "fleet", label: "ข่าวรถขนส่ง" },
    publishedAt: "2026-08-01T09:00:00.000Z",
    updatedAt: null,
    featuredImage: image,
    sections: [{ id: "body", heading: null, headingLevel: 2, body: ["เนื้อหาข่าว"], media: [] }],
    seo: {
      title: "รับมอบรถบรรทุก 6 ล้อคันใหม่ | NATHEE GROUP 2025",
      description: "เพิ่มกำลังขนส่งสำหรับงานล็อตใหญ่ในเส้นทางภาคเหนือ",
      canonicalPath: postPath(slug),
      robots: "INDEX",
    },
    revisionId: "rev-1",
    ...overrides,
  };
}

const accept = (input: unknown) => validatePublicPost(input, PUBLIC_CMS_CONTRACT_VERSION);
const fieldsOf = (input: unknown) => {
  const result = accept(input);
  return result.ok ? [] : result.violations.map((violation) => violation.field);
};

// --- the published-only rule ------------------------------------------------

test("a well formed published post is accepted", () => {
  const result = accept(post());
  assert.equal(result.ok, true);
});

test("nothing but PUBLISHED renders", () => {
  for (const status of ["DRAFT", "SCHEDULED", "HIDDEN", "ARCHIVED", "REVIEW", "", null, undefined]) {
    const result = accept({ ...post(), status });
    assert.equal(result.ok, false, `${String(status)} must be refused`);
    assert.ok(fieldsOf({ ...post(), status }).includes("status"));
  }
});

test("a post declaring another contract version is refused whole", () => {
  assert.ok(fieldsOf({ ...post(), contractVersion: PUBLIC_CMS_CONTRACT_VERSION + 1 }).includes("contractVersion"));
  assert.ok(fieldsOf({ ...post(), contractVersion: undefined }).includes("contractVersion"));
});

test("a payload that is not an object is refused rather than probed", () => {
  for (const input of [null, undefined, "post", 42, []]) {
    const result = accept(input);
    // An array reaches the field checks and fails all of them, which is still
    // a refusal; the only requirement is that nothing renders.
    assert.equal(result.ok, false, `${JSON.stringify(input)} must be refused`);
  }
});

// --- slugs and paths --------------------------------------------------------

test("slugs are lowercase latin words joined by single hyphens", () => {
  for (const slug of ["news", "new-truck", "q3-2026-update", "a", "0"]) {
    assert.equal(isValidPostSlug(slug), true, `${slug} should be accepted`);
  }
  for (const slug of [
    "",
    "New-Truck",
    "new_truck",
    "new--truck",
    "-leading",
    "trailing-",
    "with space",
    "ข่าวใหม่",
    "a/b",
    "..",
    "a".repeat(81),
  ]) {
    assert.equal(isValidPostSlug(slug), false, `${slug} should be refused`);
  }
});

test("a slug that would collide with the index or its pagination is refused", () => {
  // A post at /news/page/2/ is unreachable however carefully it is rendered.
  for (const slug of ["page", "feed", "rss", "atom", "sitemap", "index", "all", "category", "tag"]) {
    assert.equal(isValidPostSlug(slug), false, `${slug} is reserved`);
    assert.ok(fieldsOf(post({ slug, path: postPath(slug) })).includes("slug"));
  }
});

test("the path must be the one derived from the slug", () => {
  assert.equal(postPath("new-truck"), "/news/new-truck/");
  assert.ok(fieldsOf(post({ slug: "new-truck", path: "/news/other-truck/" })).includes("path"));
  assert.ok(fieldsOf(post({ slug: "new-truck", path: "/news/new-truck" })).includes("path"));
  assert.ok(fieldsOf(post({ slug: "new-truck", path: "/about/" })).includes("path"));
});

test("a post can never take over a marketing route", () => {
  for (const route of PUBLIC_ROUTE_PATHS) {
    const result = accept(post({ slug: "about", path: route }));
    assert.equal(result.ok, false, `${route} must stay a marketing route`);
  }
});

test("post paths are recognised strictly, so one post has one URL", () => {
  assert.equal(isPostPath(POSTS_INDEX_PATH), true);
  assert.equal(isPostPath("/news/new-truck/"), true);
  assert.equal(isPostPath("/news/new-truck"), false, "the trailing slash is not optional");
  assert.equal(isPostPath("/news/a/b/"), false, "posts are not nested");
  assert.equal(isPostPath("/news/../about/"), false);
  assert.equal(isPostPath("/newsletter/"), false);
  assert.equal(isPostPath("/about/"), false);
});

// --- the fields a list and an article need ---------------------------------

test("a post without an excerpt is refused, because the list would show a bare headline", () => {
  assert.ok(fieldsOf(post({ excerpt: "" })).includes("excerpt"));
  assert.ok(fieldsOf(post({ excerpt: "   " })).includes("excerpt"));
});

test("the title is the single h1 and cannot be empty", () => {
  assert.ok(fieldsOf(post({ title: "" })).includes("title"));
});

test("the category is optional but cannot be half filled in", () => {
  assert.equal(accept(post({ category: null })).ok, true);
  assert.ok(fieldsOf(post({ category: { id: "", label: "ข่าว" } })).includes("category.id"));
  assert.ok(fieldsOf(post({ category: { id: "fleet", label: "" } })).includes("category.label"));
});

test("publication dates are real timestamps and an edit cannot predate them", () => {
  assert.ok(fieldsOf(post({ publishedAt: "yesterday" })).includes("publishedAt"));
  assert.ok(fieldsOf(post({ publishedAt: "" })).includes("publishedAt"));
  assert.equal(accept(post({ updatedAt: null })).ok, true);
  assert.equal(accept(post({ updatedAt: "2026-08-02T09:00:00.000Z" })).ok, true);
  // Published to search engines as an Article dateModified, so a nonsensical
  // pair is a defect rather than a curiosity.
  assert.ok(fieldsOf(post({ updatedAt: "2026-07-01T09:00:00.000Z" })).includes("updatedAt"));
});

test("a featured image is optional, and a bad one is refused rather than rendered", () => {
  assert.equal(accept(post({ featuredImage: null })).ok, true);
  assert.ok(fieldsOf(post({ featuredImage: { ...image, altText: "" } })).includes("featuredImage.altText"));
  assert.ok(
    fieldsOf(post({ featuredImage: { ...image, variants: [{ ...image.variants[0], src: "/api/motorcycles/1/photo.jpg" }] } }))
      .some((field) => field.startsWith("featuredImage.variants")),
    "private media must be refused on a post exactly as on a page",
  );
});

test("the heading outline rules are the page's rules, not a second copy", () => {
  // h1 is the title, so a section may not open at h3.
  assert.ok(
    fieldsOf(post({ sections: [{ id: "a", heading: "ลึกเกินไป", headingLevel: 3, body: [], media: [] }] }))
      .includes("sections[0].headingLevel"),
  );
  assert.ok(fieldsOf(post({ sections: "not an array" as unknown as PublicPost["sections"] })).includes("sections"));
});

test("the canonical must be the post's own path", () => {
  assert.ok(fieldsOf(post({ seo: { ...post().seo, canonicalPath: "/news/somewhere-else/" } })).includes("seo.canonicalPath"));
  assert.ok(fieldsOf(post({ seo: { ...post().seo, canonicalPath: "/" } })).includes("seo.canonicalPath"));
});

test("robots must be stated, not inferred", () => {
  assert.ok(fieldsOf(post({ seo: { ...post().seo, robots: "MAYBE" as "INDEX" } })).includes("seo.robots"));
});

// --- the list ---------------------------------------------------------------

const dated = (slug: string, publishedAt: string, category: string | null = "fleet") =>
  post({
    slug,
    path: postPath(slug),
    publishedAt,
    category: category === null ? null : { id: category, label: category === "fleet" ? "ข่าวรถขนส่ง" : "ประกาศ" },
    seo: { ...post().seo, canonicalPath: postPath(slug) },
  });

test("the list is newest first", () => {
  const posts = [dated("older", "2026-01-01T00:00:00.000Z"), dated("newer", "2026-06-01T00:00:00.000Z")];
  const result = buildPostList(posts);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.items.map((entry) => entry.slug), ["newer", "older"]);
});

test("posts published in the same batch keep a stable order", () => {
  // Without the tie-break the list reshuffles between requests, which
  // paginates inconsistently: one post appears twice and another vanishes.
  const stamp = "2026-06-01T00:00:00.000Z";
  const posts = [dated("charlie", stamp), dated("alpha", stamp), dated("bravo", stamp)];
  const first = buildPostList(posts);
  const second = buildPostList([...posts].reverse());
  assert.deepEqual(
    first.ok && first.items.map((entry) => entry.slug),
    second.ok && second.items.map((entry) => entry.slug),
  );
  assert.deepEqual(first.ok && first.items.map((entry) => entry.slug), ["alpha", "bravo", "charlie"]);
  assert.equal(comparePostsForList(dated("a", stamp), dated("b", stamp)) < 0, true);
});

test("pagination covers every post exactly once", () => {
  const posts = Array.from({ length: 25 }, (_, index) =>
    dated(`post-${String(index).padStart(2, "0")}`, new Date(Date.UTC(2026, 0, index + 1)).toISOString()),
  );
  const seen: string[] = [];
  const firstPage = buildPostList(posts, { page: 1, pageSize: 10 });
  assert.equal(firstPage.ok && firstPage.pageCount, 3);
  assert.equal(firstPage.ok && firstPage.total, 25);
  for (let page = 1; page <= 3; page += 1) {
    const result = buildPostList(posts, { page, pageSize: 10 });
    assert.equal(result.ok, true);
    if (result.ok) seen.push(...result.items.map((entry) => entry.slug));
  }
  assert.equal(new Set(seen).size, 25, "no post is shown twice or skipped");
  assert.equal(seen.length, 25);
});

test("a page past the end is a refusal, not an empty list at 200", () => {
  // An empty list served as 200 is a soft 404: it keeps the URL indexed and
  // tells the visitor the site is broken rather than that they mistyped.
  const posts = [dated("only", "2026-01-01T00:00:00.000Z")];
  assert.equal(buildPostList(posts, { page: 2 }).ok, false);
  assert.equal(buildPostList(posts, { page: 0 }).ok, false);
  assert.equal(buildPostList(posts, { page: -1 }).ok, false);
  assert.equal(buildPostList(posts, { page: 1.5 }).ok, false);
  assert.equal(buildPostList(posts, { pageSize: 0 }).ok, false);
  assert.equal(buildPostList(posts, { pageSize: 1000 }).ok, false);
  // An empty site still has a first page; there is simply nothing on it.
  assert.equal(buildPostList([], { page: 1 }).ok, true);
  assert.equal(buildPostList([], { page: 2 }).ok, false);
});

test("filtering by category is exact, and an unknown category is a refusal", () => {
  const posts = [dated("a", "2026-01-01T00:00:00.000Z", "fleet"), dated("b", "2026-02-01T00:00:00.000Z", "notice")];
  const fleet = buildPostList(posts, { category: "fleet" });
  assert.deepEqual(fleet.ok && fleet.items.map((entry) => entry.slug), ["a"]);
  assert.equal(fleet.ok && fleet.total, 1);
  assert.equal(buildPostList(posts, { category: "does-not-exist" }).ok, false);
  const uncategorised = buildPostList([dated("c", "2026-03-01T00:00:00.000Z", null)], { category: "fleet" });
  assert.equal(uncategorised.ok, false);
});

test("the default page size is the one the index is built for", () => {
  const posts = Array.from({ length: POSTS_PAGE_SIZE + 1 }, (_, index) =>
    dated(`p-${index}`, new Date(Date.UTC(2026, 0, index + 1)).toISOString()),
  );
  const result = buildPostList(posts);
  assert.equal(result.ok && result.items.length, POSTS_PAGE_SIZE);
  assert.equal(result.ok && result.pageCount, 2);
});

test("categories are listed with their counts, and only when they have posts", () => {
  const posts = [
    dated("a", "2026-01-01T00:00:00.000Z", "fleet"),
    dated("b", "2026-02-01T00:00:00.000Z", "fleet"),
    dated("c", "2026-03-01T00:00:00.000Z", "notice"),
    dated("d", "2026-04-01T00:00:00.000Z", null),
  ];
  const categories = buildPostCategories(posts);
  assert.equal(categories.length, 2);
  assert.equal(categories.find((entry) => entry.id === "fleet")?.count, 2);
  assert.equal(categories.find((entry) => entry.id === "notice")?.count, 1);
  assert.deepEqual(buildPostCategories([]), []);
});

// --- redirects --------------------------------------------------------------

test("a post redirect must point at a post and never away from a marketing route", () => {
  assert.deepEqual(validatePostRedirect({ from: "/news/old-name/", to: "/news/new-name/" }), []);
  assert.ok(validatePostRedirect({ from: "/news/a/", to: "https://example.com/" }).length > 0);
  assert.ok(validatePostRedirect({ from: "/news/a/", to: "/about/" }).length > 0);
  assert.ok(validatePostRedirect({ from: "/news/a/", to: POSTS_INDEX_PATH }).length > 0);
  assert.ok(validatePostRedirect({ from: "/about/", to: "/news/a/" }).length > 0);
  assert.ok(validatePostRedirect({ from: "//evil.example", to: "/news/a/" }).length > 0);
  assert.ok(validatePostRedirect({ from: "/news/../a/", to: "/news/b/" }).length > 0);
  assert.ok(validatePostRedirect({ from: "/news/a/", to: "/news/a/" }).length > 0);
});

test("a renamed-twice post still resolves, and a loop does not", () => {
  // Unlike the marketing routes, a post's target can itself be renamed later,
  // so chains exist here and are resolved rather than assumed away.
  const chain = [
    { from: "/news/first/", to: "/news/second/" },
    { from: "/news/second/", to: "/news/third/" },
  ];
  assert.deepEqual(resolvePostRedirect("/news/first/", chain), { to: "/news/third/", hops: 2 });
  assert.deepEqual(resolvePostRedirect("/news/second/", chain), { to: "/news/third/", hops: 1 });
  assert.equal(resolvePostRedirect("/news/unknown/", chain), null);

  const loop = [
    { from: "/news/a/", to: "/news/b/" },
    { from: "/news/b/", to: "/news/a/" },
  ];
  assert.equal(resolvePostRedirect("/news/a/", loop), null, "a loop is a 404, not a browser redirect loop");

  const long = Array.from({ length: 10 }, (_, index) => ({
    from: `/news/step-${index}/`,
    to: `/news/step-${index + 1}/`,
  }));
  assert.equal(resolvePostRedirect("/news/step-0/", long), null, "an over-long chain is treated as broken");
});

test("an invalid redirect is ignored rather than served", () => {
  const redirects = [{ from: "/news/old/", to: "/about/" }];
  assert.equal(resolvePostRedirect("/news/old/", redirects), null);
});

// --- the sitemap ------------------------------------------------------------

test("the sitemap lists published indexable posts and the index above them", () => {
  const urls = buildPostSitemapUrls([
    { state: "PUBLISHED", post: dated("a", "2026-01-01T00:00:00.000Z") },
    { state: "PUBLISHED", post: dated("b", "2026-02-01T00:00:00.000Z") },
  ]);
  assert.deepEqual(urls, [
    "https://natheegroup2025.com/news/",
    "https://natheegroup2025.com/news/a/",
    "https://natheegroup2025.com/news/b/",
  ]);
});

test("an unpublished post leaves the sitemap", () => {
  const urls = buildPostSitemapUrls([
    { state: "PUBLISHED", post: dated("live", "2026-01-01T00:00:00.000Z") },
    { state: "UNPUBLISHED" },
    { state: "MOVED", to: "/news/renamed/" },
  ]);
  assert.equal(urls.includes("https://natheegroup2025.com/news/live/"), true);
  assert.equal(urls.length, 2, "only the live post and the index");
});

test("a noindex post is served but kept out of the sitemap", () => {
  const hidden = dated("hidden", "2026-01-01T00:00:00.000Z");
  const urls = buildPostSitemapUrls([
    { state: "PUBLISHED", post: { ...hidden, seo: { ...hidden.seo, robots: "NOINDEX" } } },
  ]);
  assert.deepEqual(urls, [], "and the index is not advertised for an empty section either");
});

test("the sitemap does not repeat a URL", () => {
  const same = dated("a", "2026-01-01T00:00:00.000Z");
  const urls = buildPostSitemapUrls([
    { state: "PUBLISHED", post: same },
    { state: "PUBLISHED", post: same },
  ]);
  assert.deepEqual(urls, ["https://natheegroup2025.com/news/", "https://natheegroup2025.com/news/a/"]);
});
