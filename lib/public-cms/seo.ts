// SEO for a CMS-backed public site.
//
// Static pages get their SEO from the build, which cannot drift. Once content
// is editable at runtime, SEO becomes data, and data can be wrong in ways that
// quietly cost the site its search presence: an unpublished page still
// returning 200, a canonical pointing at a preview, a withdrawn URL left in
// the sitemap, a renamed slug losing its inbound links.
//
// This file states what the public site emits for each case, so those failures
// are decided here and tested, rather than emerging in production weeks later.

import { CANONICAL_ORIGIN, PUBLIC_ROUTE_PATHS, type PublicPage, type PublicRoutePath } from "./contract.ts";

export type PageAvailability =
  | { state: "PUBLISHED"; page: PublicPage }
  | { state: "UNPUBLISHED" }
  | { state: "MOVED"; to: PublicRoutePath };

export type SeoResponse = {
  httpStatus: 200 | 301 | 404;
  location?: string;
  canonical?: string;
  title?: string;
  description?: string;
  robots: string;
  includeInSitemap: boolean;
  jsonLd?: Record<string, unknown>;
};

export function absoluteUrl(path: string): string {
  return `${CANONICAL_ORIGIN}${path}`;
}

/**
 * The single decision point for what a public URL returns.
 *
 * Unpublished is 404, never a 200 with empty content: a soft 404 keeps the URL
 * indexed and advertises that something used to be there.
 */
export function resolveSeoResponse(availability: PageAvailability, isPreview = false): SeoResponse {
  if (availability.state === "UNPUBLISHED") {
    return {
      httpStatus: 404,
      robots: "noindex, nofollow, noarchive",
      includeInSitemap: false,
    };
  }

  if (availability.state === "MOVED") {
    // A permanent redirect is correct here, unlike the login handoff: a slug
    // rename is a durable content decision, and 301 is what transfers the
    // inbound links and ranking to the new URL.
    return {
      httpStatus: 301,
      location: absoluteUrl(availability.to),
      robots: "noindex, nofollow",
      includeInSitemap: false,
    };
  }

  const { page } = availability;

  if (isPreview) {
    // A preview renders unpublished copy at a public origin. It must never be
    // indexable and must never claim to be the canonical page.
    return {
      httpStatus: 200,
      canonical: absoluteUrl(page.path),
      title: page.seo.title,
      description: page.seo.description,
      robots: "noindex, nofollow, noarchive",
      includeInSitemap: false,
    };
  }

  return {
    httpStatus: 200,
    canonical: absoluteUrl(page.seo.canonicalPath),
    title: page.seo.title,
    description: page.seo.description,
    robots: page.seo.robots === "INDEX" ? "index, follow" : "noindex, nofollow",
    includeInSitemap: page.seo.robots === "INDEX",
    jsonLd: buildJsonLd(page),
  };
}

function buildJsonLd(page: PublicPage): Record<string, unknown> {
  const url = absoluteUrl(page.seo.canonicalPath);
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.seo.title,
    description: page.seo.description,
    url,
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement:
        page.path === "/"
          ? [{ "@type": "ListItem", position: 1, name: "หน้าแรก", item: absoluteUrl("/") }]
          : [
              { "@type": "ListItem", position: 1, name: "หน้าแรก", item: absoluteUrl("/") },
              { "@type": "ListItem", position: 2, name: page.heading, item: url },
            ],
    },
  };
}

/**
 * The sitemap lists only pages that are published AND indexable. A page that
 * is noindex but present in the sitemap sends contradictory signals.
 */
export function buildSitemapUrls(pages: ReadonlyArray<PageAvailability>): string[] {
  return pages
    .filter((availability) => availability.state === "PUBLISHED")
    .map((availability) => (availability as { page: PublicPage }).page)
    .filter((page) => page.seo.robots === "INDEX")
    .map((page) => absoluteUrl(page.seo.canonicalPath))
    .filter((url, index, all) => all.indexOf(url) === index)
    .sort();
}

export type SlugRedirect = { from: string; to: PublicRoutePath };

/**
 * Validates a redirect before it can be served. A redirect to a non-public
 * route, off-site, or to itself is refused rather than published, because a
 * loop or an open redirect on the apex is worse than a dead link.
 */
export function validateSlugRedirect(redirect: SlugRedirect): string[] {
  const problems: string[] = [];
  const { from, to } = redirect;

  if (!from.startsWith("/")) problems.push("from must be a same-origin path");
  if (from.includes("..")) problems.push("from must not contain a traversal");
  if (from.startsWith("//")) problems.push("from must not be protocol-relative");
  if (!PUBLIC_ROUTE_PATHS.includes(to)) problems.push("to must be a public route");
  if (from === to) problems.push("a redirect to itself would loop");
  if (PUBLIC_ROUTE_PATHS.includes(from as PublicRoutePath)) {
    problems.push("from is a live public route and must not be redirected away");
  }
  return problems;
}

/**
 * Resolves a request path through the redirect table.
 *
 * Always a single hop, and no chain detection is needed because the validation
 * rules make chains impossible: a valid redirect must point AT a public route,
 * and a valid redirect may never point AWAY FROM one. So the target of one
 * redirect can never be the source of another. `redirectChainIsImpossible`
 * states that invariant, and the tests hold it.
 */
export function resolveRedirect(
  path: string,
  redirects: ReadonlyArray<SlugRedirect>,
): { to: PublicRoutePath } | null {
  const match = redirects
    .filter((redirect) => validateSlugRedirect(redirect).length === 0)
    .find((redirect) => redirect.from === path);
  return match ? { to: match.to } : null;
}

/**
 * True when no valid redirect's target is also a valid redirect's source.
 * Kept as an explicit, testable statement of why single-hop resolution is
 * sufficient rather than an assumption buried in the resolver.
 */
export function redirectChainIsImpossible(redirects: ReadonlyArray<SlugRedirect>): boolean {
  const valid = redirects.filter((redirect) => validateSlugRedirect(redirect).length === 0);
  const sources = new Set(valid.map((redirect) => redirect.from));
  return valid.every((redirect) => !sources.has(redirect.to));
}
