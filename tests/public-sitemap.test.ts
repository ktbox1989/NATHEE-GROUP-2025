import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PUBLIC_ROUTE_PATHS } from "../lib/public-cms/contract.ts";
import { POSTS_INDEX_PATH, postPath } from "../lib/public-cms/posts.ts";
import {
  APEX_FORBIDDEN_PATHS,
  APEX_MAPPING_TARGET,
  parseApexMappingState,
  renderApexMappingBlock,
  staticCacheRuleExcludesProxiedMedia,
} from "../lib/public-apex-mapping.ts";
import {
  buildSitemapPaths,
  buildStaticReleaseSitemap,
  renderSitemapXml,
  sitemapPathForSlug,
  type SitemapPage,
} from "../lib/public-sitemap.ts";

const page = (path: string, robots: "INDEX" | "NOINDEX" = "INDEX", reachable = true) =>
  ({ path, robots, reachable }) as SitemapPage;

// --- what the sitemap lists ---------------------------------------------------

test("a NOINDEX page is excluded, because listing it contradicts its own directive", () => {
  const paths = buildSitemapPaths([page("/"), page("/about/", "NOINDEX")], []);
  assert.ok(paths.includes("/"));
  assert.ok(!paths.includes("/about/"));
});

test("a hidden page is excluded, because a reader cannot reach it", () => {
  const paths = buildSitemapPaths([page("/"), page("/about/", "INDEX", false)], []);
  assert.ok(!paths.includes("/about/"));
});

test("a NOINDEX post is excluded and an INDEX post is listed at its own path", () => {
  const paths = buildSitemapPaths([page("/")], [
    { slug: "new-route-chiang-rai", robots: "INDEX" },
    { slug: "internal-note", robots: "NOINDEX" },
  ]);
  assert.ok(paths.includes(postPath("new-route-chiang-rai")));
  assert.ok(!paths.includes(postPath("internal-note")));
});

test("the news index appears only once there is a post on it", () => {
  assert.ok(!buildSitemapPaths([page("/")], []).includes(POSTS_INDEX_PATH));
  assert.ok(!buildSitemapPaths([page("/")], [{ slug: "hidden", robots: "NOINDEX" }]).includes(POSTS_INDEX_PATH));
  assert.ok(buildSitemapPaths([page("/")], [{ slug: "live", robots: "INDEX" }]).includes(POSTS_INDEX_PATH));
});

test("an unpublished post has no representation, because it is never in the input", () => {
  // The route only reads posts whose latest event is a PUBLISH, so a draft
  // cannot reach the builder. Asserted here so the property is not lost if the
  // caller changes.
  const paths = buildSitemapPaths([page("/")], []);
  assert.deepEqual(paths.filter((path) => path.startsWith("/news/")), []);
});

test("a renamed post is listed once, at the slug it has now", () => {
  // The old URL is a 301 served by /news/[slug]. A redirect is a hop, not a
  // destination, and listing it would ask a crawler to index the hop.
  const paths = buildSitemapPaths([page("/")], [{ slug: "new-name", robots: "INDEX" }]);
  assert.ok(paths.includes(postPath("new-name")));
  assert.ok(!paths.includes(postPath("old-name")));
  assert.equal(paths.filter((path) => path.startsWith("/news/") && path !== POSTS_INDEX_PATH).length, 1);
});

test("a slug the public route could not serve is refused rather than listed", () => {
  assert.deepEqual(
    buildSitemapPaths([page("/")], [{ slug: "Not A Slug", robots: "INDEX" }]).filter((p) => p !== "/" && p !== "/gallery/"),
    [],
  );
});

test("the gallery is always listed, and every URL is canonical and public", () => {
  const paths = buildSitemapPaths([page("/")], [{ slug: "live", robots: "INDEX" }]);
  assert.ok(paths.includes("/gallery/"));
  const xml = renderSitemapXml(paths);
  for (const path of paths) assert.ok(xml.includes(`<loc>https://natheegroup2025.com${path}</loc>`));
  for (const forbidden of ["/api", "/app/", "/auth", "/login", "login-status"]) {
    assert.ok(!xml.includes(forbidden), `${forbidden} must never appear in the sitemap`);
  }
});

test("a managed slug maps to a path the public route list actually contains", () => {
  assert.equal(sitemapPathForSlug("home"), "/");
  assert.equal(sitemapPathForSlug("about"), "/about/");
  for (const slug of ["home", "services", "about", "contact", "quotation"] as const) {
    assert.ok(PUBLIC_ROUTE_PATHS.includes(sitemapPathForSlug(slug)!));
  }
});

test("the static release sitemap is the eleven marketing routes and nothing else", () => {
  const xml = buildStaticReleaseSitemap();
  assert.equal((xml.match(/<loc>/g) ?? []).length, PUBLIC_ROUTE_PATHS.length);
  for (const route of PUBLIC_ROUTE_PATHS) {
    assert.ok(xml.includes(`<loc>https://natheegroup2025.com${route}</loc>`), route);
  }
  // No posts: the static release has no database, so it cannot have any.
  assert.ok(!xml.includes("/news/"));
});

test("the committed static sitemap is the builder's output, not a hand-maintained second source", () => {
  const path = fileURLToPath(new URL("../public-site/sitemap.xml", import.meta.url));
  assert.equal(readFileSync(path, "utf8").replaceAll("\r\n", "\n"), buildStaticReleaseSitemap());
});

// --- the apex mapping ---------------------------------------------------------

test("an inactive mapping contains no rule at all", () => {
  const block = renderApexMappingBlock("INACTIVE");
  assert.equal(parseApexMappingState(block), "INACTIVE");
  assert.ok(!block.includes("RewriteRule"));
});

test("an active mapping proxies both surfaces, preserving the query string", () => {
  const block = renderApexMappingBlock("ACTIVE");
  assert.equal(parseApexMappingState(block), "ACTIVE");
  assert.ok(block.includes(`RewriteRule ^assets/media/(.*)$ ${APEX_MAPPING_TARGET}/assets/media/$1 [P,QSA,L]`));
  assert.ok(block.includes(`RewriteRule ^sitemap\\.xml$ ${APEX_MAPPING_TARGET}/sitemap.xml [P,QSA,L]`));
});

test("an active mapping is a proxy and never a redirect", () => {
  // A redirect cannot deliver these bytes: the application sets
  // Cross-Origin-Resource-Policy: same-origin, so the browser blocks an image
  // fetched cross-origin.
  const block = renderApexMappingBlock("ACTIVE");
  assert.ok(!/R=30[12]/.test(block));
  assert.ok(block.includes("[P,QSA,L]"));
});

test("an active mapping is guarded against a loop and against a missing module", () => {
  const block = renderApexMappingBlock("ACTIVE");
  assert.ok(block.includes("RewriteCond %{HTTP_HOST} ^natheegroup2025\\.com$ [NC]"));
  assert.ok(block.includes("<IfModule mod_proxy.c>"));
});

test("no authenticated path is ever proxied onto the apex", () => {
  const block = renderApexMappingBlock("ACTIVE");
  for (const forbidden of APEX_FORBIDDEN_PATHS) {
    for (const line of block.split("\n").filter((entry) => entry.includes("RewriteRule"))) {
      assert.ok(!line.includes(forbidden), `${forbidden} must never be proxied: ${line}`);
    }
  }
});

test("the release .htaccess declares the block and exempts proxied media from the static cache rule", () => {
  const htaccess = readFileSync(fileURLToPath(new URL("../public-site/.htaccess", import.meta.url)), "utf8");
  assert.equal(parseApexMappingState(htaccess), "INACTIVE");
  // The application decides how long a public variant may be cached; the static
  // rule would replace that with its own value.
  assert.ok(staticCacheRuleExcludesProxiedMedia(htaccess));
});
