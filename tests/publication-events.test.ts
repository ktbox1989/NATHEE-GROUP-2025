import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_ROUTE_PATHS } from "../lib/public-cms/contract.ts";
import { POSTS_INDEX_PATH, resolvePostRedirect } from "../lib/public-cms/posts.ts";
import {
  decidePublication,
  MAX_RECORDED_INVALIDATION_PATHS,
  postMovedEvent,
  postPublishEvent,
  publicPathForSitePage,
  recordInvalidation,
  siteSettingsPublishEvent,
  sitePagePublishEvent,
} from "../lib/publication-events.ts";
import { SITE_PAGE_DEFINITIONS, type SitePageSlug } from "../lib/site-cms-content.ts";

const SLUGS = Object.keys(SITE_PAGE_DEFINITIONS) as SitePageSlug[];

// The whole point of the emitter: a page an Owner can publish must map to a URL
// the public site actually serves. A page that mapped to nothing would publish
// successfully and invalidate nothing.
test("every managed page maps to a public route", () => {
  for (const slug of SLUGS) {
    const path = publicPathForSitePage(slug);
    assert.ok(path, `${slug} maps to no public path`);
    assert.ok(PUBLIC_ROUTE_PATHS.includes(path!), `${slug} maps to ${path}, which is not a public route`);
  }
  assert.equal(new Set(SLUGS.map(publicPathForSitePage)).size, SLUGS.length, "two pages map to one URL");
});

test("publishing a page invalidates that page and regenerates the sitemap", () => {
  const outcome = decidePublication(sitePagePublishEvent("about", "PUBLISH", "rev-1"));
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.invalidation.delivery, "CACHE");
  assert.deepEqual(outcome.invalidation.paths, ["/about/"]);
  assert.equal(outcome.invalidation.regenerateSitemap, true);
  assert.deepEqual(outcome.invalidation.removedPaths, []);
});

test("hiding a page stops its URL returning 200 and takes it out of the sitemap", () => {
  const outcome = decidePublication(sitePagePublishEvent("about", "HIDE", null));
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.invalidation.removedPaths, ["/about/"]);
  assert.ok(outcome.invalidation.paths.includes("/sitemap.xml"));
});

// The home page is the site. A publish route that treated this as "nothing
// needed doing" would report success for a change the public site can never
// reach.
test("hiding the home page is refused rather than silently doing nothing", () => {
  const outcome = decidePublication(sitePagePublishEvent("home", "HIDE", null));
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.reason, /home page cannot be unpublished/);
});

test("a publish with no revision to publish is refused", () => {
  assert.equal(decidePublication(sitePagePublishEvent("about", "PUBLISH", null)).ok, false);
  assert.equal(decidePublication(postPublishEvent("a-post", "PUBLISH", null)).ok, false);
  assert.equal(decidePublication(null).ok, false);
});

test("publishing a post invalidates the post and the index that lists it", () => {
  const outcome = decidePublication(postPublishEvent("first-post", "PUBLISH", "rev-9"));
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.invalidation.paths, ["/news/", "/news/first-post/"]);
  assert.equal(outcome.invalidation.regenerateSitemap, true);
});

test("hiding a post removes its URL, and the index survives", () => {
  const outcome = decidePublication(postPublishEvent("first-post", "HIDE", null));
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.invalidation.removedPaths, ["/news/first-post/"]);
  assert.ok(outcome.invalidation.paths.includes(POSTS_INDEX_PATH));
  assert.equal(outcome.invalidation.removedPaths.includes(POSTS_INDEX_PATH), false);
});

// Dropping either URL leaves half the site serving the state from before the
// rename, and the old one must keep answering - with a 301 - or the inbound
// links are lost anyway.
test("a rename invalidates both URLs and removes neither", () => {
  const outcome = decidePublication(postMovedEvent("first-post", "second-post"));
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.ok(outcome.invalidation.paths.includes("/news/first-post/"));
  assert.ok(outcome.invalidation.paths.includes("/news/second-post/"));
  assert.deepEqual(outcome.invalidation.removedPaths, []);
});

test("a rename to the same slug is refused", () => {
  const outcome = decidePublication(postMovedEvent("first-post", "first-post"));
  assert.equal(outcome.ok, false);
});

test("publishing settings invalidates every public route and robots.txt", () => {
  const outcome = decidePublication(siteSettingsPublishEvent("rev-settings"));
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  for (const path of PUBLIC_ROUTE_PATHS) {
    assert.ok(outcome.invalidation.paths.includes(path), `${path} was not invalidated`);
  }
  assert.ok(outcome.invalidation.paths.includes("/robots.txt"));
  assert.equal(outcome.invalidation.truncated, false, "the settings fan-out must fit in an audit row");
  assert.ok(outcome.invalidation.paths.length <= MAX_RECORDED_INVALIDATION_PATHS);
});

// An audit row records the plan so it can be checked afterwards against what
// the public site actually served. It has to stay a bounded row to do that.
test("a recorded plan is bounded and reports its own truncation", () => {
  const recorded = recordInvalidation(siteSettingsPublishEvent("rev-settings"));
  assert.ok(recorded.reason.length <= 300);
  assert.equal(typeof recorded.truncated, "boolean");
  assert.equal(JSON.stringify(recorded).length < 4000, true);
});

// The two halves meeting: what a rename records, and what the public site does
// with it. Neither side is mocked - this is Lane B's event feeding Lane A's
// resolver.
test("the redirects a rename records are the ones the public site can resolve", () => {
  const renames = [
    ["first-post", "second-post"],
    ["second-post", "third-post"],
  ] as const;

  for (const [from, to] of renames) {
    assert.equal(decidePublication(postMovedEvent(from, to)).ok, true, `${from} -> ${to} was refused`);
  }

  const redirects = renames.map(([from, to]) => ({ from: `/news/${from}/`, to: `/news/${to}/` }));
  assert.deepEqual(resolvePostRedirect("/news/first-post/", redirects), { to: "/news/third-post/", hops: 2 });
  assert.deepEqual(resolvePostRedirect("/news/second-post/", redirects), { to: "/news/third-post/", hops: 1 });
  assert.equal(resolvePostRedirect("/news/never-existed/", redirects), null);
});
