import { CANONICAL_PRODUCTION_ORIGIN, PUBLIC_WEBSITE_ORIGIN } from "./app-origin.ts";
import { PUBLIC_ROUTE_PATHS } from "./public-cms/contract.ts";
import { POSTS_INDEX_PATH, isPostPath } from "./public-cms/posts.ts";

/**
 * Routes that need the request proxy solely to hand duplicate public
 * presentation on the application host to the canonical apex.
 *
 * Keep this list literal: the framework statically analyses proxy matchers.
 * `scripts/test-session-refresh-coverage.mjs` proves that every entry is wired
 * into `proxy.ts`, while the helper's unit tests prove that it cannot catch an
 * application, API, authentication or private-media route.
 */
export const CANONICAL_PUBLIC_REDIRECT_MATCHERS = [
  "/",
  "/services/:path*",
  "/motorcycle-transport/:path*",
  "/international/:path*",
  "/storage/:path*",
  "/container-loading/:path*",
  "/dealer-fleet/:path*",
  "/gallery/:path*",
  "/about/:path*",
  "/contact/:path*",
  "/quotation/:path*",
  "/news/:path*",
  "/sitemap.xml",
] as const;

const APP_PUBLIC_HOSTNAME = new URL(CANONICAL_PRODUCTION_ORIGIN).hostname;
const canonicalMarketingPaths = new Set<string>(PUBLIC_ROUTE_PATHS);

function withTrailingSlash(pathname: string): string {
  return pathname === "/" || pathname.endsWith("/") ? pathname : `${pathname}/`;
}

/**
 * Resolve the canonical apex URL for public presentation requested from the
 * application hostname. Returns null for every request that should stay on the
 * application, and for non-production hosts so local development remains local.
 */
export function canonicalPublicRedirectUrl(requestUrl: string | URL): URL | null {
  const request = typeof requestUrl === "string" ? new URL(requestUrl) : requestUrl;
  if (request.hostname !== APP_PUBLIC_HOSTNAME) return null;

  const normalizedPath = withTrailingSlash(request.pathname);
  const isMarketingPage = canonicalMarketingPaths.has(normalizedPath);
  const isNewsPage = normalizedPath === POSTS_INDEX_PATH || isPostPath(normalizedPath);
  const isCanonicalSitemap = request.pathname === "/sitemap.xml";
  if (!isMarketingPage && !isNewsPage && !isCanonicalSitemap) return null;

  const destination = new URL(isCanonicalSitemap ? "/sitemap.xml" : normalizedPath, PUBLIC_WEBSITE_ORIGIN);
  // Query parameters such as the news archive page are part of the public
  // presentation. Preserve them byte-for-byte; fragments never reach a server.
  destination.search = request.search;
  return destination;
}
