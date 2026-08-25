import assert from "node:assert/strict";
import test from "node:test";
import { POST_ROBOTS } from "../lib/post-cms-content.ts";
import { mapCmsPageToPublicPage } from "../lib/public-cms/map-from-cms.ts";
import { buildSitemapUrls, resolveSeoResponse } from "../lib/public-cms/seo.ts";
import {
  CMS_ROBOTS,
  DEFAULT_SITE_CONTENT,
  SITE_PAGE_DEFINITIONS,
  parseCmsPageContent,
  parseCmsPageContentJson,
  serializeCmsPageContent,
  type SitePageSlug,
} from "../lib/site-cms-content.ts";

// A managed page could be published or hidden and nothing in between. NOINDEX
// is the state in between: served, but not asking to be found - a seasonal
// landing page, or one linked only from a quotation.
//
// Lane A had already built both consumers. `resolveSeoResponse` emits
// "noindex, nofollow" and drops the page from the sitemap; neither had anything
// to read, because the field did not exist.

const SLUGS = Object.keys(SITE_PAGE_DEFINITIONS) as SitePageSlug[];

function page(seo: Record<string, unknown>) {
  return parseCmsPageContent({
    ...DEFAULT_SITE_CONTENT.about,
    seo: { ...DEFAULT_SITE_CONTENT.about.seo, ...seo },
  });
}

test("posts and pages answer the indexing question from one list", () => {
  assert.deepEqual([...CMS_ROBOTS], ["INDEX", "NOINDEX"]);
  // The same array, not a second copy that agrees today.
  assert.equal(POST_ROBOTS, CMS_ROBOTS);
});

test("every page that ships with the release stays indexable", () => {
  for (const slug of SLUGS) assert.equal(DEFAULT_SITE_CONTENT[slug].seo.robots, "INDEX", slug);
});

// Revisions are immutable, so a revision written before the field existed has
// to keep parsing, and keep meaning what it meant when it was published.
test("a page revision written before the field existed is still indexable", () => {
  const parsed = parseCmsPageContent({
    version: 1,
    seo: { title: DEFAULT_SITE_CONTENT.about.seo.title, description: DEFAULT_SITE_CONTENT.about.seo.description },
    sections: DEFAULT_SITE_CONTENT.about.sections,
  });
  assert.ok(parsed, "a legacy revision was refused");
  assert.equal(parsed.seo.robots, "INDEX");
});

test("a page can be published but unlisted", () => {
  assert.equal(page({ robots: "NOINDEX" })?.seo.robots, "NOINDEX");
  assert.equal(page({ robots: "INDEX" })?.seo.robots, "INDEX");
});

// "Do not silently widen arbitrary values": an unrecognised value must not
// fall back to INDEX, or a typo publishes a page the Owner asked to keep out.
test("a robots value this codebase has never heard of is refused, not defaulted", () => {
  for (const invalid of ["noindex", "NONE", "index,follow", "", "ALL", 1, true, null, {}]) {
    assert.equal(page({ robots: invalid }), null, `${JSON.stringify(invalid)} was accepted`);
  }
  // Surrounding whitespace is trimmed, as it is for every other field in this
  // parser. That is normalisation, not widening: the value still has to be one
  // of the two.
  assert.equal(page({ robots: " NOINDEX " })?.seo.robots, "NOINDEX");
});

test("the field survives a round trip through storage", () => {
  const content = page({ robots: "NOINDEX" });
  assert.ok(content);
  const json = serializeCmsPageContent(content);
  assert.ok(json.length < 50_000, `page revision is ${json.length} bytes`);
  assert.deepEqual(parseCmsPageContentJson(json), content);
});

// --- the two consumers that were already built ------------------------------

function mapped(robots: "INDEX" | "NOINDEX") {
  const content = page({ robots });
  assert.ok(content);
  return mapCmsPageToPublicPage({
    slug: "about",
    cmsPath: SITE_PAGE_DEFINITIONS.about.path,
    state: { status: "PUBLISHED", content, revisionId: "rev-1" },
    publishedAt: "2026-08-25T00:00:00.000Z",
    resolveMedia: () => null,
  });
}

test("the mapper carries the page's own robots rather than asserting INDEX", () => {
  const indexed = mapped("INDEX");
  assert.equal(indexed.ok, true, indexed.ok ? "" : JSON.stringify(indexed));
  if (indexed.ok) assert.equal(indexed.page.seo.robots, "INDEX");

  const unlisted = mapped("NOINDEX");
  assert.equal(unlisted.ok, true, unlisted.ok ? "" : JSON.stringify(unlisted));
  if (unlisted.ok) assert.equal(unlisted.page.seo.robots, "NOINDEX");
});

test("a published NOINDEX page is served, and says noindex", () => {
  const unlisted = mapped("NOINDEX");
  assert.ok(unlisted.ok);
  if (!unlisted.ok) return;
  const response = resolveSeoResponse({ state: "PUBLISHED", page: unlisted.page });
  // Served: an unlisted page is not a hidden one.
  assert.equal(response.httpStatus, 200);
  assert.equal(response.robots, "noindex, nofollow");
  assert.equal(response.includeInSitemap, false);
});

test("a published INDEX page is served, indexable and in the sitemap", () => {
  const indexed = mapped("INDEX");
  assert.ok(indexed.ok);
  if (!indexed.ok) return;
  const response = resolveSeoResponse({ state: "PUBLISHED", page: indexed.page });
  assert.equal(response.httpStatus, 200);
  assert.equal(response.robots, "index, follow");
  assert.equal(response.includeInSitemap, true);
});

// A preview link is pasted into LINE and email. It must never be indexable
// whatever the page itself says, and the page setting must not be able to
// widen it.
test("preview is noindex regardless of what the page asks for", () => {
  for (const robots of ["INDEX", "NOINDEX"] as const) {
    const result = mapped(robots);
    assert.ok(result.ok);
    if (!result.ok) continue;
    const preview = resolveSeoResponse({ state: "PUBLISHED", page: result.page }, true);
    assert.equal(preview.robots, "noindex, nofollow, noarchive", `preview of a ${robots} page`);
    assert.equal(preview.includeInSitemap, false);
  }
});

test("the sitemap lists the indexable page and omits the unlisted one", () => {
  const indexed = mapped("INDEX");
  const unlisted = mapped("NOINDEX");
  assert.ok(indexed.ok && unlisted.ok);
  if (!indexed.ok || !unlisted.ok) return;

  const withIndexed = buildSitemapUrls([{ state: "PUBLISHED", page: indexed.page }]);
  assert.equal(withIndexed.length, 1, `expected the page to be listed: ${withIndexed.join(", ")}`);

  const withUnlisted = buildSitemapUrls([{ state: "PUBLISHED", page: unlisted.page }]);
  assert.deepEqual(withUnlisted, [], "an unlisted page was advertised in the sitemap");
});
