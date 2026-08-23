import assert from "node:assert/strict";
import test from "node:test";
import { PUBLIC_CMS_CONTRACT_VERSION, PUBLIC_ROUTE_PATHS, type PublicMedia, type PublicPage } from "../lib/public-cms/contract.ts";
import { postPath, type PublicPost } from "../lib/public-cms/posts.ts";
import {
  PUBLIC_ROUTE_SCHEMA_TYPES,
  STATIC_SITE_IDENTITY,
  buildPageHead,
  buildPostHead,
  siteIdentityFromSettings,
  type HeadModel,
} from "../lib/public-cms/seo.ts";
import { DEFAULT_SITE_SETTINGS } from "../lib/site-settings-content.ts";

const photo: PublicMedia = {
  id: "photo-1",
  altText: "รถบรรทุก 6 ล้อบรรทุกรถจักรยานยนต์",
  caption: null,
  variants: [
    { src: "/assets/gallery/a-display.avif", width: 1600, height: 900, format: "avif", role: "display" },
    { src: "/assets/gallery/a-display.jpg", width: 1600, height: 900, format: "jpeg", role: "display" },
  ],
};

function page(overrides: Partial<PublicPage> = {}): PublicPage {
  const path = overrides.path ?? "/services/";
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    slug: "services",
    path,
    status: "PUBLISHED",
    heading: "บริการขนส่งที่วางแผนตามงานจริง",
    seo: {
      title: "บริการขนส่งรถจักรยานยนต์ครบวงจร | NATHEE GROUP 2025",
      description: "รวมบริการขนส่งรถจักรยานยนต์ทั่วประเทศและต่างประเทศ",
      canonicalPath: path,
      robots: "INDEX",
    },
    sections: [{ id: "s1", heading: "งานจริง", headingLevel: 2, body: ["เนื้อหา"], media: [photo] }],
    revisionId: "rev-1",
    publishedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function post(overrides: Partial<PublicPost> = {}): PublicPost {
  const slug = overrides.slug ?? "new-six-wheel-truck";
  return {
    contractVersion: PUBLIC_CMS_CONTRACT_VERSION,
    status: "PUBLISHED",
    slug,
    path: postPath(slug),
    title: "รับมอบรถบรรทุก 6 ล้อคันใหม่",
    excerpt: "เพิ่มกำลังขนส่งสำหรับงานล็อตใหญ่",
    category: { id: "fleet", label: "ข่าวรถขนส่ง" },
    publishedAt: "2026-08-01T09:00:00.000Z",
    updatedAt: null,
    featuredImage: photo,
    sections: [{ id: "body", heading: null, headingLevel: 2, body: ["เนื้อหาข่าว"], media: [] }],
    seo: {
      title: "รับมอบรถบรรทุก 6 ล้อคันใหม่ | NATHEE GROUP 2025",
      description: "เพิ่มกำลังขนส่งสำหรับงานล็อตใหญ่",
      canonicalPath: postPath(slug),
      robots: "INDEX",
    },
    revisionId: "rev-1",
    ...overrides,
  };
}

const graphOf = (head: HeadModel) => (head.jsonLd[0]?.["@graph"] as Array<Record<string, unknown>>) ?? [];
const nodeOfType = (head: HeadModel, type: string) =>
  graphOf(head).find((node) => {
    const nodeType = node["@type"];
    return Array.isArray(nodeType) ? nodeType.includes(type) : nodeType === type;
  });

// --- pages ------------------------------------------------------------------

test("a published page emits a canonical, hreflang and an indexable robots directive", () => {
  const head = buildPageHead({ state: "PUBLISHED", page: page() });
  assert.equal(head.httpStatus, 200);
  assert.equal(head.canonical, "https://natheegroup2025.com/services/");
  assert.equal(head.robots, "index, follow");
  assert.deepEqual(head.alternates, [
    { hreflang: "th-TH", href: "https://natheegroup2025.com/services/" },
    { hreflang: "x-default", href: "https://natheegroup2025.com/services/" },
  ]);
  assert.equal(head.includeInSitemap, true);
});

test("every marketing route keeps the schema type the static release already publishes", () => {
  // Switching a route to the CMS must not quietly change how a search engine
  // is told to read it.
  for (const route of PUBLIC_ROUTE_PATHS) {
    assert.ok(PUBLIC_ROUTE_SCHEMA_TYPES[route], `${route} has no schema type`);
  }
  assert.equal(PUBLIC_ROUTE_SCHEMA_TYPES["/"], "Organization");
  assert.equal(PUBLIC_ROUTE_SCHEMA_TYPES["/services/"], "Service");
  assert.equal(PUBLIC_ROUTE_SCHEMA_TYPES["/gallery/"], "CollectionPage");
  assert.equal(PUBLIC_ROUTE_SCHEMA_TYPES["/about/"], "AboutPage");
  assert.equal(PUBLIC_ROUTE_SCHEMA_TYPES["/contact/"], "ContactPage");
});

test("a service page names its provider rather than orphaning the record", () => {
  const head = buildPageHead({ state: "PUBLISHED", page: page({ path: "/storage/", seo: { ...page().seo, canonicalPath: "/storage/" } }) });
  const service = nodeOfType(head, "Service");
  assert.ok(service);
  assert.deepEqual(service?.provider, { "@id": "https://natheegroup2025.com/#organization" });
  // And the Organization it points at is actually in the graph.
  assert.ok(nodeOfType(head, "Organization"));
});

test("the home page is the Organization rather than carrying a duplicate of it", () => {
  const home = page({ path: "/", seo: { ...page().seo, canonicalPath: "/" } });
  const head = buildPageHead({ state: "PUBLISHED", page: home });
  const organizations = graphOf(head).filter((node) => {
    const type = node["@type"];
    return Array.isArray(type) ? type.includes("Organization") : type === "Organization";
  });
  assert.equal(organizations.length, 1, "two Organization records would compete");
  assert.equal(organizations[0]?.["@id"], "https://natheegroup2025.com/#organization");
});

test("the organization record carries the local business details a search result shows", () => {
  const head = buildPageHead({ state: "PUBLISHED", page: page() });
  const organization = nodeOfType(head, "LocalBusiness");
  assert.ok(organization);
  assert.deepEqual(organization?.["@type"], ["Organization", "LocalBusiness"]);
  assert.deepEqual(organization?.telephone, ["+66-63-194-1191", "+66-85-680-2082"]);
  assert.equal(organization?.areaServed, "TH");
});

test("the breadcrumb is one level on the home page and two below it", () => {
  const home = buildPageHead({ state: "PUBLISHED", page: page({ path: "/", seo: { ...page().seo, canonicalPath: "/" } }) });
  const homeTrail = nodeOfType(home, "BreadcrumbList")?.itemListElement as unknown[];
  assert.equal(homeTrail.length, 1);

  const inner = buildPageHead({ state: "PUBLISHED", page: page() });
  const trail = nodeOfType(inner, "BreadcrumbList")?.itemListElement as Array<Record<string, unknown>>;
  assert.equal(trail.length, 2);
  assert.equal(trail[0].name, "หน้าแรก");
  assert.equal(trail[1].item, "https://natheegroup2025.com/services/");
  assert.deepEqual(trail.map((entry) => entry.position), [1, 2]);
});

test("social tags describe the page and point at a decodable image", () => {
  const head = buildPageHead({ state: "PUBLISHED", page: page() });
  assert.equal(head.openGraph["og:type"], "website");
  assert.equal(head.openGraph["og:locale"], "th_TH");
  assert.equal(head.openGraph["og:url"], "https://natheegroup2025.com/services/");
  assert.equal(head.openGraph["og:title"], page().seo.title);
  // AVIF is skipped: several chat clients cannot decode it and show no image
  // at all rather than falling back.
  assert.equal(head.openGraph["og:image"], "https://natheegroup2025.com/assets/gallery/a-display.jpg");
  assert.equal(head.openGraph["og:image:width"], "1600");
  assert.equal(head.openGraph["og:image:height"], "900");
  assert.equal(head.openGraph["og:image:alt"], photo.altText);
  assert.equal(head.twitter["twitter:card"], "summary_large_image");
  assert.equal(head.twitter["twitter:image"], head.openGraph["og:image"]);
});

test("a page with no usable photograph falls back to the brand image, never to nothing", () => {
  const withoutMedia = page({ sections: [{ id: "s1", heading: "งานจริง", headingLevel: 2, body: ["เนื้อหา"], media: [] }] });
  const head = buildPageHead({ state: "PUBLISHED", page: withoutMedia });
  assert.equal(head.openGraph["og:image"], STATIC_SITE_IDENTITY.logo.url);
  assert.equal(head.openGraph["og:image:width"], "1000");

  // A photograph offered only as AVIF is not a usable unfurl image either.
  const avifOnly = page({
    sections: [
      {
        id: "s1",
        heading: "งานจริง",
        headingLevel: 2,
        body: ["เนื้อหา"],
        media: [{ ...photo, variants: [photo.variants[0]] }],
      },
    ],
  });
  assert.equal(buildPageHead({ state: "PUBLISHED", page: avifOnly }).openGraph["og:image"], STATIC_SITE_IDENTITY.logo.url);
});

test("an unpublished page is a 404 with no metadata to read", () => {
  const head = buildPageHead({ state: "UNPUBLISHED" });
  assert.equal(head.httpStatus, 404);
  assert.equal(head.includeInSitemap, false);
  assert.deepEqual(head.openGraph, {});
  assert.deepEqual(head.jsonLd, []);
  assert.equal(head.canonical, undefined);
  assert.match(head.robots, /noindex/);
});

test("a renamed page is a permanent redirect and advertises nothing", () => {
  const head = buildPageHead({ state: "MOVED", to: "/services/" });
  assert.equal(head.httpStatus, 301);
  assert.equal(head.location, "https://natheegroup2025.com/services/");
  assert.equal(head.includeInSitemap, false);
  assert.deepEqual(head.openGraph, {});
});

test("a noindex page is served but stays out of the sitemap", () => {
  const hidden = page({ seo: { ...page().seo, robots: "NOINDEX" } });
  const head = buildPageHead({ state: "PUBLISHED", page: hidden });
  assert.equal(head.httpStatus, 200);
  assert.equal(head.robots, "noindex, nofollow");
  assert.equal(head.includeInSitemap, false);
  // It is still worth a card when someone shares it deliberately.
  assert.ok(head.openGraph["og:title"]);
});

// --- the preview boundary ---------------------------------------------------

test("a preview emits no social tags at all", () => {
  // noindex is read by crawlers, not by LINE or email. Without this, pasting a
  // preview link into a conversation unfurls the unpublished copy to everyone
  // in it — the exact leak the preview boundary exists to prevent.
  for (const head of [
    buildPageHead({ state: "PUBLISHED", page: page() }, { isPreview: true }),
    buildPostHead({ state: "PUBLISHED", post: post() }, { isPreview: true }),
  ]) {
    assert.deepEqual(head.openGraph, {});
    assert.deepEqual(head.twitter, {});
    assert.deepEqual(head.jsonLd, []);
    assert.match(head.robots, /noindex/);
    assert.equal(head.includeInSitemap, false);
    assert.deepEqual(head.alternates, [], "a preview must not claim an alternate either");
  }
});

test("a preview canonical points at the published URL, not at itself", () => {
  const pageHead = buildPageHead({ state: "PUBLISHED", page: page() }, { isPreview: true });
  assert.equal(pageHead.canonical, "https://natheegroup2025.com/services/");
  const postHead = buildPostHead({ state: "PUBLISHED", post: post() }, { isPreview: true });
  assert.equal(postHead.canonical, "https://natheegroup2025.com/news/new-six-wheel-truck/");
});

// --- posts ------------------------------------------------------------------

test("a published post is an article with real dates", () => {
  const head = buildPostHead({ state: "PUBLISHED", post: post({ updatedAt: "2026-08-05T09:00:00.000Z" }) });
  assert.equal(head.httpStatus, 200);
  assert.equal(head.canonical, "https://natheegroup2025.com/news/new-six-wheel-truck/");
  assert.equal(head.robots, "index, follow");
  assert.equal(head.includeInSitemap, true);
  assert.equal(head.openGraph["og:type"], "article");
  assert.equal(head.openGraph["article:published_time"], "2026-08-01T09:00:00.000Z");
  assert.equal(head.openGraph["article:modified_time"], "2026-08-05T09:00:00.000Z");
  assert.equal(head.openGraph["article:section"], "ข่าวรถขนส่ง");

  const article = nodeOfType(head, "BlogPosting");
  assert.ok(article);
  assert.equal(article?.headline, post().title);
  assert.equal(article?.datePublished, "2026-08-01T09:00:00.000Z");
  assert.equal(article?.dateModified, "2026-08-05T09:00:00.000Z");
  assert.deepEqual(article?.publisher, { "@id": "https://natheegroup2025.com/#organization" });
  assert.deepEqual(article?.mainEntityOfPage, {
    "@type": "WebPage",
    "@id": "https://natheegroup2025.com/news/new-six-wheel-truck/",
  });
});

test("a post that was never edited claims no modification date", () => {
  // A dateModified defaulted to the publication date tells a search engine the
  // post was edited when it was not.
  const head = buildPostHead({ state: "PUBLISHED", post: post({ updatedAt: null }) });
  assert.equal(head.openGraph["article:modified_time"], undefined);
  assert.equal(nodeOfType(head, "BlogPosting")?.dateModified, undefined);
});

test("an uncategorised post omits the section rather than inventing one", () => {
  const head = buildPostHead({ state: "PUBLISHED", post: post({ category: null }) });
  assert.equal(head.openGraph["article:section"], undefined);
  assert.equal(nodeOfType(head, "BlogPosting")?.articleSection, undefined);
});

test("the post breadcrumb runs home, news, article", () => {
  const head = buildPostHead({ state: "PUBLISHED", post: post() });
  const trail = nodeOfType(head, "BreadcrumbList")?.itemListElement as Array<Record<string, unknown>>;
  assert.equal(trail.length, 3);
  assert.deepEqual(trail.map((entry) => entry.item), [
    "https://natheegroup2025.com/",
    "https://natheegroup2025.com/news/",
    "https://natheegroup2025.com/news/new-six-wheel-truck/",
  ]);
});

test("the featured image is published with its real dimensions", () => {
  const head = buildPostHead({ state: "PUBLISHED", post: post() });
  const image = nodeOfType(head, "ImageObject");
  assert.equal(image?.url, "https://natheegroup2025.com/assets/gallery/a-display.jpg");
  assert.equal(image?.width, 1600);
  assert.equal(image?.height, 900);
  assert.equal(image?.caption, photo.altText);
});

test("an unpublished post is a 404 and a renamed one is a 301", () => {
  const gone = buildPostHead({ state: "UNPUBLISHED" });
  assert.equal(gone.httpStatus, 404);
  assert.deepEqual(gone.jsonLd, []);

  const moved = buildPostHead({ state: "MOVED", to: "/news/renamed/" });
  assert.equal(moved.httpStatus, 301);
  assert.equal(moved.location, "https://natheegroup2025.com/news/renamed/");
  assert.equal(moved.includeInSitemap, false);
});

test("a noindex post is served but stays out of the sitemap", () => {
  const head = buildPostHead({ state: "PUBLISHED", post: post({ seo: { ...post().seo, robots: "NOINDEX" } }) });
  assert.equal(head.httpStatus, 200);
  assert.equal(head.robots, "noindex, nofollow");
  assert.equal(head.includeInSitemap, false);
});

// --- identity ---------------------------------------------------------------

test("the identity can come from published settings, so an edit reaches every page", () => {
  const identity = siteIdentityFromSettings(DEFAULT_SITE_SETTINGS);
  assert.equal(identity.name, "NATHEE GROUP 2025");
  assert.equal(identity.legalName, "บริษัท นทีกรุ๊ป2025 จำกัด");
  assert.deepEqual(identity.telephones, ["063-194-1191", "085-680-2082"]);

  const head = buildPageHead({ state: "PUBLISHED", page: page() }, { identity });
  assert.deepEqual(nodeOfType(head, "Organization")?.telephone, ["063-194-1191", "085-680-2082"]);
  assert.equal(head.openGraph["og:site_name"], "NATHEE GROUP 2025");
});

test("a settings payload with one telephone number does not publish an empty one", () => {
  const identity = siteIdentityFromSettings({
    brand: { name: "N", legalName: "L" },
    contact: { primaryPhone: "063-194-1191", secondaryPhone: "" },
  });
  assert.deepEqual(identity.telephones, ["063-194-1191"]);
});

test("the structured data survives serialisation, which is how it is emitted", () => {
  for (const head of [
    buildPageHead({ state: "PUBLISHED", page: page() }),
    buildPostHead({ state: "PUBLISHED", post: post() }),
  ]) {
    const serialised = JSON.stringify(head.jsonLd);
    assert.equal(serialised.includes("undefined"), false);
    assert.deepEqual(JSON.parse(serialised), JSON.parse(JSON.stringify(head.jsonLd)));
  }
});
