import { CANONICAL_ORIGIN, PUBLIC_ROUTE_PATHS, type PublicRoutePath } from "./public-cms/contract.ts";
import { POSTS_INDEX_PATH, isValidPostSlug, postPath } from "./public-cms/posts.ts";
import { SITE_PAGE_DEFINITIONS, type CmsRobots, type SitePageSlug } from "./site-cms-content.ts";

/**
 * The one sitemap.
 *
 * There is exactly one builder, used by both surfaces that can serve
 * `https://natheegroup2025.com/sitemap.xml`: the application route, which reads
 * live publication state, and the static release artifact, which is generated
 * from this rather than hand-maintained. Two independent sitemaps would drift
 * the first time either changed, and a sitemap that disagrees with the site is
 * worse than none — it advertises URLs that 404 and hides ones that exist.
 *
 * The application owns it. A static file cannot: posts are published from the
 * CMS without a deploy, and a page can be taken out of the index the same way,
 * so a file copied at release time is stale as soon as either happens.
 *
 * ## What is in it, and what is deliberately not
 *
 * A URL appears only when a reader can actually reach it *and* the page asks to
 * be found. `NOINDEX` is not a weaker `INDEX`: listing a page in the sitemap
 * while its own robots directive says noindex sends a crawler two contradictory
 * instructions, and the one that loses is usually the one the Owner meant.
 *
 * Hidden pages, unpublished posts and every authenticated path are absent
 * because they are absent from the input — the callers pass only what is live.
 * `/news/` itself is listed only when at least one post is, because an index
 * with nothing on it is not worth submitting.
 *
 * A renamed post appears at its current URL and only there. The old URL is a
 * 301 served by `/news/[slug]`, and a redirect has no place in a sitemap: it is
 * not a destination, and listing it would ask a crawler to index a hop.
 */

export type SitemapPage = {
  /** A path from the closed public route list, always with its trailing slash. */
  path: PublicRoutePath;
  /** False when the page is hidden, so a reader would get nothing. */
  reachable: boolean;
  robots: CmsRobots;
};

export type SitemapPost = {
  slug: string;
  robots: CmsRobots;
};

/** The public path a managed page slug is served at, with the trailing slash. */
export function sitemapPathForSlug(slug: SitePageSlug): PublicRoutePath | null {
  const definition = SITE_PAGE_DEFINITIONS[slug];
  if (!definition) return null;
  const path = definition.path === "/" ? "/" : `${definition.path}/`;
  // Checked against the closed list rather than trusted: a definition that
  // drifted would otherwise put a URL in the sitemap that the site never serves.
  return PUBLIC_ROUTE_PATHS.includes(path as PublicRoutePath) ? (path as PublicRoutePath) : null;
}

/**
 * `/gallery/` is a public route with no managed page behind it.
 *
 * It is served by its own route and has no CMS revision, so it has no robots
 * field to consult and is always listed.
 */
export const UNMANAGED_PUBLIC_ROUTES: readonly PublicRoutePath[] = ["/gallery/"];

export function buildSitemapPaths(pages: readonly SitemapPage[], posts: readonly SitemapPost[]): string[] {
  const paths = new Set<string>();

  for (const page of pages) {
    if (!page.reachable || page.robots !== "INDEX") continue;
    if (!PUBLIC_ROUTE_PATHS.includes(page.path)) continue;
    paths.add(page.path);
  }
  for (const route of UNMANAGED_PUBLIC_ROUTES) paths.add(route);

  let listedPosts = 0;
  for (const post of posts) {
    if (post.robots !== "INDEX" || !isValidPostSlug(post.slug)) continue;
    paths.add(postPath(post.slug));
    listedPosts += 1;
  }
  // The index earns its place only when it has something on it.
  if (listedPosts > 0) paths.add(POSTS_INDEX_PATH);

  return [...paths].sort();
}

export function absolutePublicUrl(path: string): string {
  return `${CANONICAL_ORIGIN}${path}`;
}

/** Minimal, valid sitemap XML. No changefreq or priority: both are advisory,
 * every major crawler ignores them, and a number nobody computed is a number
 * nobody can defend. */
export function renderSitemapXml(paths: readonly string[]): string {
  const urls = paths.map((path) => `  <url><loc>${absolutePublicUrl(path)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * The sitemap the static release ships.
 *
 * The static site serves the eleven marketing routes and no posts — it has no
 * database, so it cannot have any. Generated from the same list the application
 * uses, so the two can never disagree about what a marketing route is called.
 */
export function buildStaticReleaseSitemap(): string {
  return renderSitemapXml([...PUBLIC_ROUTE_PATHS].sort());
}
