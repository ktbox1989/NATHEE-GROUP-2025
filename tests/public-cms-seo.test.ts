import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_CMS_CONTRACT_VERSION, type PublicPage } from "../lib/public-cms/contract.ts";
import {
  buildSitemapUrls,
  redirectChainIsImpossible,
  resolveRedirect,
  resolveSeoResponse,
  validateSlugRedirect,
} from "../lib/public-cms/seo.ts";

function page(overrides: Partial<PublicPage> = {}): PublicPage {
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    slug: "about",
    path: "/about/",
    status: "PUBLISHED",
    heading: "เกี่ยวกับเรา",
    seo: {
      title: "เกี่ยวกับเรา | NATHEE GROUP 2025",
      description: "ข้อมูลบริษัท",
      canonicalPath: "/about/",
      robots: "INDEX",
    },
    sections: [],
    revisionId: "rev-1",
    publishedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  } as PublicPage;
}

test("a published indexable page returns 200 with canonical, metadata and JSON-LD", () => {
  const response = resolveSeoResponse({ state: "PUBLISHED", page: page() });
  assert.equal(response.httpStatus, 200);
  assert.equal(response.canonical, "https://natheegroup2025.com/about/");
  assert.equal(response.robots, "index, follow");
  assert.equal(response.includeInSitemap, true);
  assert.equal(response.title, "เกี่ยวกับเรา | NATHEE GROUP 2025");
  // The structured data must be real JSON, not a template string.
  assert.equal(JSON.parse(JSON.stringify(response.jsonLd))["@type"], "WebPage");
});

test("an unpublished page is a hard 404, never a soft one", () => {
  const response = resolveSeoResponse({ state: "UNPUBLISHED" });
  // A 200 with empty content keeps the URL indexed and advertises that
  // something used to be there.
  assert.equal(response.httpStatus, 404);
  assert.equal(response.includeInSitemap, false);
  assert.match(response.robots, /noindex/);
  assert.equal(response.canonical, undefined);
});

test("a noindex page is served but kept out of the sitemap", () => {
  const response = resolveSeoResponse({
    state: "PUBLISHED",
    page: page({ seo: { ...page().seo, robots: "NOINDEX" } }),
  });
  assert.equal(response.httpStatus, 200);
  assert.match(response.robots, /noindex/);
  // Listing a noindex URL in the sitemap sends contradictory signals.
  assert.equal(response.includeInSitemap, false);
});

test("a preview is never indexable and never claims to be canonical for itself", () => {
  const response = resolveSeoResponse({ state: "PUBLISHED", page: page() }, true);
  assert.equal(response.httpStatus, 200);
  assert.match(response.robots, /noindex/);
  assert.match(response.robots, /noarchive/);
  assert.equal(response.includeInSitemap, false);
  // The canonical points at the published URL.
  assert.equal(response.canonical, "https://natheegroup2025.com/about/");
  assert.equal(response.jsonLd, undefined, "a preview must not emit structured data");
});

test("a moved page returns a permanent redirect to an absolute HTTPS URL", () => {
  const response = resolveSeoResponse({ state: "MOVED", to: "/services/" });
  // 301 here is correct: a slug rename is durable and must transfer ranking.
  assert.equal(response.httpStatus, 301);
  assert.equal(response.location, "https://natheegroup2025.com/services/");
  assert.equal(response.includeInSitemap, false);
});

test("the sitemap lists only published indexable pages, deduplicated and sorted", () => {
  const urls = buildSitemapUrls([
    { state: "PUBLISHED", page: page({ path: "/about/", seo: { ...page().seo, canonicalPath: "/about/" } }) },
    { state: "PUBLISHED", page: page({ path: "/about/", seo: { ...page().seo, canonicalPath: "/about/" } }) },
    { state: "PUBLISHED", page: page({ path: "/storage/", seo: { ...page().seo, canonicalPath: "/storage/", robots: "NOINDEX" } }) },
    { state: "UNPUBLISHED" },
    { state: "MOVED", to: "/services/" },
    { state: "PUBLISHED", page: page({ path: "/", seo: { ...page().seo, canonicalPath: "/" } }) },
  ]);

  assert.deepEqual(urls, ["https://natheegroup2025.com/", "https://natheegroup2025.com/about/"]);
});

test("a redirect cannot point off-site, traverse, or loop", () => {
  assert.ok(validateSlugRedirect({ from: "https://evil.example/x", to: "/about/" }).length > 0);
  assert.ok(validateSlugRedirect({ from: "//evil.example/x", to: "/about/" }).length > 0);
  assert.ok(validateSlugRedirect({ from: "/old/../etc", to: "/about/" }).length > 0);
  assert.ok(validateSlugRedirect({ from: "/about/", to: "/about/" }).length > 0);
  assert.ok(validateSlugRedirect({ from: "/old-page/", to: "/nowhere/" as never }).length > 0);
});

test("a live public route cannot be redirected away", () => {
  // Publishing this by accident would take a working page off the site.
  const problems = validateSlugRedirect({ from: "/services/", to: "/about/" });
  assert.ok(problems.some((problem) => problem.includes("live public route")));
});

test("a valid legacy slug resolves to its public route", () => {
  const resolved = resolveRedirect("/bike-transport/", [{ from: "/bike-transport/", to: "/motorcycle-transport/" }]);
  assert.deepEqual(resolved, { to: "/motorcycle-transport/" });
  assert.equal(resolveRedirect("/unknown/", [{ from: "/bike-transport/", to: "/motorcycle-transport/" }]), null);
});

test("redirect chains cannot exist, so a single hop is sufficient", () => {
  // A valid redirect must point AT a public route and may never point AWAY
  // from one, so no valid redirect's target can be another's source. That is
  // why the resolver does one hop and needs no cycle detection.
  const attemptedChain = [
    { from: "/a/", to: "/about/" as const },
    { from: "/about/", to: "/services/" as const },
  ];
  assert.equal(redirectChainIsImpossible(attemptedChain), true);

  // The second hop is invalid, so it never resolves and the first is safe.
  assert.equal(resolveRedirect("/about/", attemptedChain), null);
  assert.deepEqual(resolveRedirect("/a/", attemptedChain), { to: "/about/" });

  // The invariant holds for the legacy slugs a migration would actually add.
  const legacy = [
    { from: "/bike-transport/", to: "/motorcycle-transport/" as const },
    { from: "/warehouse/", to: "/storage/" as const },
    { from: "/quote/", to: "/quotation/" as const },
  ];
  assert.equal(redirectChainIsImpossible(legacy), true);
});

test("an invalid redirect is ignored instead of served", () => {
  const resolved = resolveRedirect("/services/", [{ from: "/services/", to: "/about/" }]);
  assert.equal(resolved, null, "a redirect away from a live route must never resolve");
});
