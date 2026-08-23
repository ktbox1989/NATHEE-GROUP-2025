// What the public website requires FROM a CMS, stated from the consumer side.
//
// Lane B owns the CMS schema, storage and write APIs. This file owns nothing of
// theirs: it declares the shape the public site can safely render, and the
// rules a payload must satisfy before a single byte of it reaches a visitor.
// When Lane B publishes the canonical schema, a thin mapping converts their
// payload into these types; nothing here needs to guess their column names.
//
// Everything is pure and dependency-free so it can be tested without D1, R2,
// Supabase or a running application.

// Bumped only for a breaking change to the consumer contract. A CMS payload
// that does not declare a compatible version is refused, which is what keeps
// the integration inactive until Lane B deliberately targets this version.
export const PUBLIC_CMS_CONTRACT_VERSION = 1;

// The eleven routes the public site serves. A CMS page for anything else is
// refused rather than rendered at an unknown URL.
export const PUBLIC_ROUTE_PATHS = [
  "/",
  "/services/",
  "/motorcycle-transport/",
  "/international/",
  "/storage/",
  "/container-loading/",
  "/dealer-fleet/",
  "/gallery/",
  "/about/",
  "/contact/",
  "/quotation/",
] as const;

export type PublicRoutePath = (typeof PUBLIC_ROUTE_PATHS)[number];

export const CANONICAL_ORIGIN = "https://natheegroup2025.com";

// Public media lives under /assets/. Everything below is authenticated
// customer or job evidence and must never appear in a public payload, whatever
// the CMS says its visibility is.
const PRIVATE_MEDIA_PREFIXES = ["/api/", "/app/", "/auth/", "/_next/"] as const;
const PUBLIC_MEDIA_PREFIX = "/assets/";

export type PublicMediaVariant = {
  src: string;
  width: number;
  height: number;
  format: "jpeg" | "webp" | "avif" | "png";
  role: "thumbnail" | "display";
};

export type PublicMedia = {
  id: string;
  altText: string;
  caption: string | null;
  variants: PublicMediaVariant[];
};

export type PublicSeo = {
  title: string;
  description: string;
  canonicalPath: PublicRoutePath;
  // Public pages are indexable; preview and unpublished surfaces never are.
  robots: "INDEX" | "NOINDEX";
};

export type PublicSection = {
  id: string;
  heading: string | null;
  // Heading rank the renderer must emit. The public site requires a single h1
  // and no skipped level, so the CMS must state the rank rather than leave the
  // renderer to guess it.
  headingLevel: 2 | 3;
  body: string[];
  media: PublicMedia[];
};

export type PublicPage = {
  contractVersion: number;
  slug: string;
  path: PublicRoutePath;
  // Only ever PUBLISHED. A draft has no representation in this type, so a
  // draft cannot be rendered by construction.
  status: "PUBLISHED";
  seo: PublicSeo;
  heading: string;
  sections: PublicSection[];
  // Used for cache validation and invalidation, never displayed.
  revisionId: string;
  publishedAt: string;
};

export type ContractViolation = { field: string; reason: string };

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; violations: ContractViolation[] };

export function isNonEmptyString(value: unknown, max = 5000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isPrivateMediaPath(src: string): boolean {
  return PRIVATE_MEDIA_PREFIXES.some((prefix) => src.startsWith(prefix));
}

/**
 * A media source is publishable only when it is a same-origin path under
 * /assets/. Absolute URLs, protocol-relative URLs, traversal and every
 * authenticated media route are refused.
 */
export function validateMediaSrc(src: unknown, field: string): ContractViolation[] {
  if (!isNonEmptyString(src, 2048)) return [{ field, reason: "must be a non-empty string" }];
  if (src.includes("..")) return [{ field, reason: "must not contain a path traversal" }];
  if (src.startsWith("//")) return [{ field, reason: "must not be protocol-relative" }];
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) return [{ field, reason: "must be a same-origin path, not an absolute URL" }];
  if (isPrivateMediaPath(src)) return [{ field, reason: "references authenticated media and must never be public" }];
  if (!src.startsWith(PUBLIC_MEDIA_PREFIX)) return [{ field, reason: `must start with ${PUBLIC_MEDIA_PREFIX}` }];
  return [];
}

function validateVariant(input: unknown, field: string): ContractViolation[] {
  const violations: ContractViolation[] = [];
  if (typeof input !== "object" || input === null) return [{ field, reason: "must be an object" }];
  const variant = input as Partial<PublicMediaVariant>;

  violations.push(...validateMediaSrc(variant.src, `${field}.src`));

  for (const dimension of ["width", "height"] as const) {
    const value = variant[dimension];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 20000) {
      // Intrinsic dimensions prevent layout shift; a missing one is a defect,
      // not a cosmetic omission.
      violations.push({ field: `${field}.${dimension}`, reason: "must be a positive integer" });
    }
  }

  if (!["jpeg", "webp", "avif", "png"].includes(variant.format as string)) {
    violations.push({ field: `${field}.format`, reason: "must be jpeg, webp, avif or png" });
  }
  if (!["thumbnail", "display"].includes(variant.role as string)) {
    violations.push({ field: `${field}.role`, reason: "must be thumbnail or display" });
  }
  return violations;
}

export function validateMedia(input: unknown, field: string): ContractViolation[] {
  const violations: ContractViolation[] = [];
  if (typeof input !== "object" || input === null) return [{ field, reason: "must be an object" }];
  const media = input as Partial<PublicMedia>;

  if (!isNonEmptyString(media.id, 200)) violations.push({ field: `${field}.id`, reason: "must be a non-empty string" });

  // Alt text is not optional. A public image without it fails the accessibility
  // gate the live site is already held to.
  if (!isNonEmptyString(media.altText, 500)) {
    violations.push({ field: `${field}.altText`, reason: "must be non-empty alt text" });
  }
  if (media.caption !== null && !isNonEmptyString(media.caption, 1000)) {
    violations.push({ field: `${field}.caption`, reason: "must be null or a non-empty string" });
  }

  if (!Array.isArray(media.variants) || media.variants.length === 0) {
    violations.push({ field: `${field}.variants`, reason: "must contain at least one variant" });
  } else {
    media.variants.forEach((variant, index) => {
      violations.push(...validateVariant(variant, `${field}.variants[${index}]`));
    });
    if (!media.variants.some((variant) => (variant as PublicMediaVariant)?.role === "display")) {
      violations.push({ field: `${field}.variants`, reason: "must include a display variant" });
    }
  }

  return violations;
}

function validateSeo(input: unknown, path: unknown): ContractViolation[] {
  const violations: ContractViolation[] = [];
  if (typeof input !== "object" || input === null) return [{ field: "seo", reason: "must be an object" }];
  const seo = input as Partial<PublicSeo>;

  if (!isNonEmptyString(seo.title, 200)) violations.push({ field: "seo.title", reason: "must be a non-empty title" });
  if (!isNonEmptyString(seo.description, 400)) {
    violations.push({ field: "seo.description", reason: "must be a non-empty description" });
  }
  if (seo.canonicalPath !== path) {
    // A canonical pointing anywhere but the page's own path silently
    // de-indexes the page or hands its ranking to another URL.
    violations.push({ field: "seo.canonicalPath", reason: "must equal the page path" });
  }
  if (seo.robots !== "INDEX" && seo.robots !== "NOINDEX") {
    violations.push({ field: "seo.robots", reason: "must be INDEX or NOINDEX" });
  }
  return violations;
}

function validateSection(input: unknown, index: number, prefix = "sections"): ContractViolation[] {
  const field = `${prefix}[${index}]`;
  const violations: ContractViolation[] = [];
  if (typeof input !== "object" || input === null) return [{ field, reason: "must be an object" }];
  const section = input as Partial<PublicSection>;

  if (!isNonEmptyString(section.id, 200)) violations.push({ field: `${field}.id`, reason: "must be a non-empty string" });
  if (section.heading !== null && !isNonEmptyString(section.heading, 300)) {
    violations.push({ field: `${field}.heading`, reason: "must be null or a non-empty string" });
  }
  if (section.headingLevel !== 2 && section.headingLevel !== 3) {
    violations.push({ field: `${field}.headingLevel`, reason: "must be 2 or 3" });
  }
  if (section.heading === null && section.headingLevel !== undefined && section.headingLevel !== 2) {
    // A section with no heading cannot introduce a deeper rank.
    violations.push({ field: `${field}.headingLevel`, reason: "a section without a heading cannot be level 3" });
  }
  if (!Array.isArray(section.body)) {
    violations.push({ field: `${field}.body`, reason: "must be an array of paragraphs" });
  } else if (section.body.some((paragraph) => !isNonEmptyString(paragraph))) {
    violations.push({ field: `${field}.body`, reason: "paragraphs must be non-empty strings" });
  }

  if (!Array.isArray(section.media)) {
    violations.push({ field: `${field}.media`, reason: "must be an array" });
  } else {
    section.media.forEach((media, mediaIndex) => {
      violations.push(...validateMedia(media, `${field}.media[${mediaIndex}]`));
    });
  }
  return violations;
}

/**
 * The single gate every CMS payload passes before it can be rendered.
 * Anything that fails is refused whole; the caller falls back to the static
 * release rather than rendering a partially trusted page.
 */
export function validatePublicPage(input: unknown): ValidationResult<PublicPage> {
  if (typeof input !== "object" || input === null) {
    return { ok: false, violations: [{ field: "page", reason: "must be an object" }] };
  }
  const page = input as Partial<PublicPage>;
  const violations: ContractViolation[] = [];

  if (page.contractVersion !== PUBLIC_CMS_CONTRACT_VERSION) {
    // Refusing an unknown version is what keeps the integration inactive until
    // Lane B deliberately targets it.
    violations.push({
      field: "contractVersion",
      reason: `must be ${PUBLIC_CMS_CONTRACT_VERSION}`,
    });
  }

  if (page.status !== "PUBLISHED") {
    // The one rule that prevents draft leakage: nothing but PUBLISHED renders.
    violations.push({ field: "status", reason: "must be PUBLISHED" });
  }

  if (!isNonEmptyString(page.slug, 200)) violations.push({ field: "slug", reason: "must be a non-empty string" });
  if (!PUBLIC_ROUTE_PATHS.includes(page.path as PublicRoutePath)) {
    violations.push({ field: "path", reason: "must be one of the known public routes" });
  }
  if (!isNonEmptyString(page.heading, 300)) violations.push({ field: "heading", reason: "must be a non-empty h1" });
  if (!isNonEmptyString(page.revisionId, 200)) violations.push({ field: "revisionId", reason: "must be a non-empty string" });
  if (!isIsoTimestamp(page.publishedAt)) violations.push({ field: "publishedAt", reason: "must be an ISO timestamp" });

  violations.push(...validateSeo(page.seo, page.path));
  violations.push(...validateSections(page.sections));

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value: page as PublicPage };
}

/**
 * Validates a body of sections and the heading outline they produce.
 *
 * Shared by every content type that renders authored copy under a single h1 —
 * pages today, posts as well — because the accessibility rule is a property of
 * the public site, not of one content type. A second copy of it would be a
 * second chance to get it wrong.
 *
 * `startingLevel` is the rank already emitted above these sections, which is
 * always the h1 the content type supplies from its own title or heading.
 */
export function validateSections(
  input: unknown,
  field = "sections",
  startingLevel = 1,
): ContractViolation[] {
  if (!Array.isArray(input)) return [{ field, reason: "must be an array" }];

  const violations: ContractViolation[] = [];
  input.forEach((section, index) => violations.push(...validateSection(section, index, field)));

  // The public site is held to a single h1 and no skipped heading level.
  // Enforce it on the data so the renderer cannot produce an invalid outline.
  let previous = startingLevel;
  input.forEach((section, index) => {
    const level = (section as PublicSection)?.headingLevel;
    if (level === 2 || level === 3) {
      if (level - previous > 1) {
        violations.push({
          field: `${field}[${index}].headingLevel`,
          reason: `heading order jumps h${previous} to h${level}`,
        });
      }
      previous = level;
    }
  });

  return violations;
}
