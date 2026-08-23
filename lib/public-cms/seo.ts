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

import {
  CANONICAL_ORIGIN,
  PUBLIC_ROUTE_PATHS,
  type PublicMedia,
  type PublicPage,
  type PublicRoutePath,
} from "./contract.ts";
import {
  POSTS_INDEX_PATH,
  absolutePostUrl,
  type PostAvailability,
  type PublicPost,
} from "./posts.ts";

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

// ---------------------------------------------------------------------------
// The head a CMS-rendered surface emits
//
// Static SEO comes from the build and cannot drift. Once the content is
// editable, everything a search engine and a chat unfurl read becomes data, so
// the head is modelled here as one value and tested, rather than assembled in
// a template where a missing tag is invisible.
//
// The model deliberately covers pages and posts with the same code: the parts
// that differ between them are the schema type, the article dates and the
// breadcrumb depth, and nothing else. Two templates would drift.
// ---------------------------------------------------------------------------

/**
 * The schema.org type each marketing route presents itself as. Mirrors what the
 * current static release already emits, so switching a route to the CMS does not
 * silently change how it is described to a search engine.
 */
export const PUBLIC_ROUTE_SCHEMA_TYPES: Readonly<Record<PublicRoutePath, string>> = Object.freeze({
  "/": "Organization",
  "/services/": "Service",
  "/motorcycle-transport/": "Service",
  "/international/": "Service",
  "/storage/": "Service",
  "/container-loading/": "Service",
  "/dealer-fleet/": "Service",
  "/gallery/": "CollectionPage",
  "/about/": "AboutPage",
  "/contact/": "ContactPage",
  "/quotation/": "WebPage",
});

export type SocialImage = { url: string; width: number; height: number; alt: string };

export type SiteIdentity = {
  name: string;
  legalName: string;
  telephones: string[];
  logo: SocialImage;
};

/** Exactly what the current static release publishes. */
export const STATIC_SITE_IDENTITY: SiteIdentity = Object.freeze({
  name: "NATHEE GROUP 2025",
  legalName: "บริษัท นทีกรุ๊ป2025 จำกัด",
  telephones: ["+66-63-194-1191", "+66-85-680-2082"],
  logo: Object.freeze({
    url: absoluteUrl("/assets/brand/nathee-logo-display.jpg"),
    width: 1000,
    height: 1000,
    alt: "โลโก้ NATHEE GROUP 2025 พร้อมภาพรถจักรยานยนต์และรถบรรทุก",
  }),
}) as SiteIdentity;

/**
 * Derives the identity from published site settings.
 *
 * Brand name, legal name and the telephone numbers appear on every page and in
 * the Organization record, so an editor changing them in the CMS must change
 * them everywhere at once. The logo stays a build asset: it is referenced by
 * absolute URL in unfurls and its dimensions have to be real.
 */
export function siteIdentityFromSettings(settings: {
  brand: { name: string; legalName: string };
  contact: { primaryPhone: string; secondaryPhone: string };
}): SiteIdentity {
  return {
    name: settings.brand.name,
    legalName: settings.brand.legalName,
    telephones: [settings.contact.primaryPhone, settings.contact.secondaryPhone].filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    ),
    logo: STATIC_SITE_IDENTITY.logo,
  };
}

export type HeadModel = {
  httpStatus: 200 | 301 | 404;
  location?: string;
  title?: string;
  description?: string;
  canonical?: string;
  robots: string;
  /** hreflang pairs. The site is Thai only, so this is th-TH and x-default. */
  alternates: Array<{ hreflang: string; href: string }>;
  /** property -> content, ready to emit as an Open Graph meta tag. */
  openGraph: Record<string, string>;
  /** name -> content. */
  twitter: Record<string, string>;
  jsonLd: Array<Record<string, unknown>>;
  includeInSitemap: boolean;
};

const NOINDEX = "noindex, nofollow, noarchive";
const ORGANIZATION_ID = `${CANONICAL_ORIGIN}/#organization`;

function redirectHead(location: string): HeadModel {
  return {
    httpStatus: 301,
    location,
    robots: "noindex, nofollow",
    alternates: [],
    openGraph: {},
    twitter: {},
    jsonLd: [],
    includeInSitemap: false,
  };
}

function goneHead(): HeadModel {
  return {
    httpStatus: 404,
    robots: NOINDEX,
    alternates: [],
    openGraph: {},
    twitter: {},
    jsonLd: [],
    includeInSitemap: false,
  };
}

function socialImageFrom(media: PublicMedia | null, fallback: SocialImage): SocialImage {
  if (!media) return fallback;
  // The display variant is the one worth unfurling; a thumbnail in a chat card
  // looks like a broken image. AVIF and WebP are skipped because several chat
  // clients still cannot decode them and fall back to no image at all.
  const variant =
    media.variants.find((entry) => entry.role === "display" && (entry.format === "jpeg" || entry.format === "png")) ??
    media.variants.find((entry) => entry.format === "jpeg" || entry.format === "png");
  if (!variant) return fallback;
  return { url: absoluteUrl(variant.src), width: variant.width, height: variant.height, alt: media.altText };
}

function organizationNode(identity: SiteIdentity): Record<string, unknown> {
  return {
    "@type": ["Organization", "LocalBusiness"],
    "@id": ORGANIZATION_ID,
    name: identity.legalName,
    alternateName: identity.name,
    url: absoluteUrl("/"),
    telephone: identity.telephones,
    areaServed: "TH",
    image: identity.logo.url,
    logo: {
      "@type": "ImageObject",
      url: identity.logo.url,
      width: identity.logo.width,
      height: identity.logo.height,
    },
  };
}

function breadcrumbNode(trail: Array<{ name: string; item: string }>): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  };
}

function imageObjectNode(image: SocialImage): Record<string, unknown> {
  return {
    "@type": "ImageObject",
    url: image.url,
    width: image.width,
    height: image.height,
    caption: image.alt,
  };
}

function socialTags(
  head: { title: string; description: string; url: string; type: string },
  image: SocialImage,
  identity: SiteIdentity,
  extra: Record<string, string> = {},
): Pick<HeadModel, "openGraph" | "twitter"> {
  return {
    openGraph: {
      "og:type": head.type,
      "og:locale": "th_TH",
      "og:site_name": identity.name,
      "og:title": head.title,
      "og:description": head.description,
      "og:url": head.url,
      "og:image": image.url,
      "og:image:width": String(image.width),
      "og:image:height": String(image.height),
      "og:image:alt": image.alt,
      ...extra,
    },
    twitter: {
      "twitter:card": "summary_large_image",
      "twitter:title": head.title,
      "twitter:description": head.description,
      "twitter:image": image.url,
      "twitter:image:alt": image.alt,
    },
  };
}

export type HeadOptions = {
  isPreview?: boolean;
  identity?: SiteIdentity;
};

/**
 * The head for one marketing page.
 *
 * A preview emits no Open Graph or Twitter tags at all. A preview link is
 * pasted into LINE and email, and those clients unfurl it: without this the
 * card would render unpublished copy to everyone in the conversation, which is
 * the leak the preview boundary exists to prevent. `noindex` does not stop an
 * unfurl — it is read by crawlers, not by chat clients.
 */
export function buildPageHead(availability: PageAvailability, options: HeadOptions = {}): HeadModel {
  const identity = options.identity ?? STATIC_SITE_IDENTITY;

  if (availability.state === "UNPUBLISHED") return goneHead();
  if (availability.state === "MOVED") return redirectHead(absoluteUrl(availability.to));

  const response = resolveSeoResponse(availability, options.isPreview);
  const { page } = availability;
  const url = absoluteUrl(page.seo.canonicalPath);

  const base: HeadModel = {
    httpStatus: 200,
    title: page.seo.title,
    description: page.seo.description,
    canonical: response.canonical,
    robots: response.robots,
    alternates: options.isPreview
      ? []
      : [
          { hreflang: "th-TH", href: url },
          { hreflang: "x-default", href: url },
        ],
    openGraph: {},
    twitter: {},
    jsonLd: [],
    includeInSitemap: response.includeInSitemap,
  };

  if (options.isPreview) return base;

  const firstImage = page.sections.flatMap((section) => section.media)[0] ?? null;
  const image = socialImageFrom(firstImage, identity.logo);

  const schemaType = PUBLIC_ROUTE_SCHEMA_TYPES[page.path];
  const organization = organizationNode(identity);
  const breadcrumb = breadcrumbNode(
    page.path === "/"
      ? [{ name: "หน้าแรก", item: absoluteUrl("/") }]
      : [
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: page.heading, item: url },
        ],
  );

  const primary: Record<string, unknown> =
    schemaType === "Organization"
      ? organization
      : {
          "@type": schemaType,
          name: page.seo.title,
          description: page.seo.description,
          url,
          // A Service without a provider is an orphan record; the reference
          // points at the one Organization node rather than repeating it.
          ...(schemaType === "Service" ? { provider: { "@id": ORGANIZATION_ID } } : {}),
        };

  return {
    ...base,
    ...socialTags({ title: page.seo.title, description: page.seo.description, url, type: "website" }, image, identity),
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@graph": [
          primary,
          ...(schemaType === "Organization" ? [] : [organization]),
          breadcrumb,
          imageObjectNode(image),
        ],
      },
    ],
  };
}

/**
 * The head for one post.
 *
 * The only differences from a page are the ones that genuinely differ: an
 * article rather than a website, real publication dates, the category as a
 * section, and a breadcrumb one level deeper.
 */
export function buildPostHead(availability: PostAvailability, options: HeadOptions = {}): HeadModel {
  const identity = options.identity ?? STATIC_SITE_IDENTITY;

  if (availability.state === "UNPUBLISHED") return goneHead();
  if (availability.state === "MOVED") return redirectHead(absolutePostUrl(availability.to));

  const post: PublicPost = availability.post;
  const url = absolutePostUrl(post.seo.canonicalPath);
  const indexed = post.seo.robots === "INDEX";

  const base: HeadModel = {
    httpStatus: 200,
    title: post.seo.title,
    description: post.seo.description,
    // Even in preview the canonical points at the published URL, so a leaked
    // preview link cannot compete with the real post in search.
    canonical: url,
    robots: options.isPreview ? NOINDEX : indexed ? "index, follow" : "noindex, nofollow",
    alternates: options.isPreview
      ? []
      : [
          { hreflang: "th-TH", href: url },
          { hreflang: "x-default", href: url },
        ],
    openGraph: {},
    twitter: {},
    jsonLd: [],
    includeInSitemap: !options.isPreview && indexed,
  };

  if (options.isPreview) return base;

  const image = socialImageFrom(post.featuredImage, identity.logo);

  return {
    ...base,
    ...socialTags({ title: post.seo.title, description: post.seo.description, url, type: "article" }, image, identity, {
      "article:published_time": post.publishedAt,
      ...(post.updatedAt ? { "article:modified_time": post.updatedAt } : {}),
      ...(post.category ? { "article:section": post.category.label } : {}),
    }),
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "BlogPosting",
            headline: post.title,
            description: post.excerpt,
            url,
            mainEntityOfPage: { "@type": "WebPage", "@id": url },
            datePublished: post.publishedAt,
            // A missing dateModified reads as "never edited", which is exactly
            // what null means here, so it is omitted rather than defaulted to
            // the publication date.
            ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),
            ...(post.category ? { articleSection: post.category.label } : {}),
            image: imageObjectNode(image),
            author: { "@id": ORGANIZATION_ID },
            publisher: { "@id": ORGANIZATION_ID },
          },
          organizationNode(identity),
          breadcrumbNode([
            { name: "หน้าแรก", item: absoluteUrl("/") },
            { name: "ข่าวสาร", item: absolutePostUrl(POSTS_INDEX_PATH) },
            { name: post.title, item: url },
          ]),
          imageObjectNode(image),
        ],
      },
    ],
  };
}
