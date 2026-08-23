// The public portfolio: real work, shown as case studies.
//
// This is the highest-risk content type on the site, and not because of
// anything about rendering. A portfolio entry is *derived from a real job*, and
// the job it is derived from carries the customer's company name, their
// telephone number, the vehicle's VIN and registration, the driver, the
// inspection and the proof of delivery. Every one of those is a column that
// exists a short object-spread away from a published page.
//
// So the contract refuses in two independent ways:
//
//   1. By shape. `PublicWorkItem` has no field for any of it, so a correct
//      mapper cannot carry it.
//   2. By inspection. The validator walks the payload and refuses any object
//      carrying a key named after one of those columns, however deeply nested.
//
// The second rule exists because the first is not enough. The realistic failure
// is not someone adding a `customerName` field to the type — it is
// `{ ...jobRow, title, summary }` in a mapper, which satisfies the type
// perfectly and ships the whole row. A type cannot see that. This can.

import {
  CANONICAL_ORIGIN,
  PUBLIC_ROUTE_PATHS,
  isIsoTimestamp,
  isNonEmptyString,
  validateMedia,
  type ContractViolation,
  type PublicMedia,
  type PublicRoutePath,
  type ValidationResult,
} from "./contract.ts";
import { isRenderableHref, validateBlocks, type BlockAction, type PublicBlock } from "./blocks.ts";

export const WORK_INDEX_PATH = "/work/";
export const WORK_PAGE_SIZE = 12;

/**
 * The categories a piece of work can be filed under.
 *
 * These are the gallery manifest's category ids, deliberately, rather than a
 * second taxonomy invented for the portfolio. One vocabulary means a
 * photograph and the case study it belongs to can be filtered the same way, and
 * a test holds this list against the shipped manifest so the two cannot drift.
 */
export const WORK_CATEGORY_IDS = [
  "domestic",
  "international",
  "truck-4",
  "truck-6",
  "storage",
  "container",
  "dealer-fleet",
  "large-batch",
  "truck-loading",
  "delivery",
] as const;

export type WorkCategoryId = (typeof WORK_CATEGORY_IDS)[number];

/**
 * Keys that must never appear anywhere in a published payload.
 *
 * Every one of these is a real column name from `db/schema.ts`. They are listed
 * by name rather than matched by a pattern because a pattern would either miss
 * `vin` or refuse `province` in a sentence — and the point is to catch a copied
 * database row, which always brings its column names with it.
 */
export const FORBIDDEN_PAYLOAD_KEYS: ReadonlyArray<string> = Object.freeze([
  // Who the customer is.
  "companyId",
  "companyName",
  "customerId",
  "customerName",
  "contactEmail",
  "contactPhone",
  "email",
  "phone",
  "recipientPhone",
  // Which job this was.
  "jobId",
  "jobNumber",
  "publicJobReference",
  "province",
  // Which vehicle it was.
  "vin",
  "registration",
  "engineNumber",
  "chassisNumber",
  // Who handled it, and the evidence they produced.
  "driverUserId",
  "inspectionId",
  "podId",
  "signatureUrl",
  // Where the private bytes live.
  "storageKey",
  // Internal commentary.
  "note",
  "notes",
  "changeNote",
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 80;
const RESERVED_SLUGS = new Set(["page", "feed", "rss", "atom", "sitemap", "index", "all", "category", "tag"]);

export type PublicWorkItem = {
  contractVersion: number;
  status: "PUBLISHED";
  slug: string;
  path: string;
  /** The single h1. */
  title: string;
  /** What the list card shows, and the meta description when SEO omits one. */
  summary: string;
  categoryIds: WorkCategoryId[];
  featured: boolean;
  order: number;
  publishedAt: string;
  /** Required: a portfolio card with no photograph is a headline in a box. */
  featuredImage: PublicMedia;
  gallery: PublicMedia[];
  /** The body, as blocks. No hero: the title above them is the h1. */
  blocks: PublicBlock[];
  relatedServices: BlockAction[];
  seo: { title: string; description: string; canonicalPath: string; robots: "INDEX" | "NOINDEX" };
  revisionId: string;
};

export function isValidWorkSlug(slug: unknown): slug is string {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > SLUG_MAX_LENGTH) return false;
  if (!SLUG.test(slug)) return false;
  return !RESERVED_SLUGS.has(slug);
}

export function workPath(slug: string): string {
  return `${WORK_INDEX_PATH}${slug}/`;
}

export function isWorkPath(path: string): boolean {
  if (!path.startsWith(WORK_INDEX_PATH)) return false;
  const remainder = path.slice(WORK_INDEX_PATH.length);
  if (remainder === "") return true;
  if (!remainder.endsWith("/")) return false;
  return isValidWorkSlug(remainder.slice(0, -1));
}

/**
 * Walks a payload looking for a key that should never have been published.
 *
 * Bounded in depth and breadth so a hostile or malformed payload cannot make
 * this run forever, and the bound is reported rather than treated as a pass:
 * "too deep to check" is not the same as "checked and clean".
 */
export function findForbiddenKeys(
  value: unknown,
  path = "payload",
  depth = 0,
): ContractViolation[] {
  if (depth > 8) return [{ field: path, reason: "is nested too deeply to verify and is refused" }];
  if (Array.isArray(value)) {
    if (value.length > 500) return [{ field: path, reason: "has too many entries to verify and is refused" }];
    return value.flatMap((entry, index) => findForbiddenKeys(entry, `${path}[${index}]`, depth + 1));
  }
  if (typeof value !== "object" || value === null) return [];

  const violations: ContractViolation[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.includes(key)) {
      violations.push({
        field: `${path}.${key}`,
        reason: "is customer or job data and must never appear in published content",
      });
      continue;
    }
    violations.push(...findForbiddenKeys(entry, `${path}.${key}`, depth + 1));
  }
  return violations;
}

function validateWorkSeo(input: unknown, path: unknown): ContractViolation[] {
  if (typeof input !== "object" || input === null) return [{ field: "seo", reason: "must be an object" }];
  const seo = input as Partial<PublicWorkItem["seo"]>;
  const violations: ContractViolation[] = [];
  if (!isNonEmptyString(seo.title, 200)) violations.push({ field: "seo.title", reason: "must be a non-empty title" });
  if (!isNonEmptyString(seo.description, 400)) violations.push({ field: "seo.description", reason: "must be a non-empty description" });
  if (seo.canonicalPath !== path) violations.push({ field: "seo.canonicalPath", reason: "must equal the work path" });
  if (seo.robots !== "INDEX" && seo.robots !== "NOINDEX") violations.push({ field: "seo.robots", reason: "must be INDEX or NOINDEX" });
  return violations;
}

/**
 * The single gate every portfolio entry passes before it can be rendered.
 */
export function validateWorkItem(input: unknown, contractVersion: number): ValidationResult<PublicWorkItem> {
  if (typeof input !== "object" || input === null) {
    return { ok: false, violations: [{ field: "work", reason: "must be an object" }] };
  }

  // Before anything else. If the payload carries a copied job row, nothing
  // about the rest of it matters.
  const leaked = findForbiddenKeys(input, "work");
  if (leaked.length > 0) return { ok: false, violations: leaked };

  const work = input as Partial<PublicWorkItem>;
  const violations: ContractViolation[] = [];

  if (work.contractVersion !== contractVersion) {
    violations.push({ field: "contractVersion", reason: `must be ${contractVersion}` });
  }
  if (work.status !== "PUBLISHED") violations.push({ field: "status", reason: "must be PUBLISHED" });

  if (!isValidWorkSlug(work.slug)) {
    violations.push({ field: "slug", reason: "must be lowercase latin words joined by single hyphens" });
  } else if (work.path !== workPath(work.slug)) {
    violations.push({ field: "path", reason: "must be the path derived from the slug" });
  } else if (PUBLIC_ROUTE_PATHS.includes(work.path as PublicRoutePath)) {
    violations.push({ field: "path", reason: "must not collide with a marketing route" });
  }

  if (!isNonEmptyString(work.title, 300)) violations.push({ field: "title", reason: "must be a non-empty h1" });
  if (!isNonEmptyString(work.summary, 500)) violations.push({ field: "summary", reason: "must be a non-empty summary" });
  if (!isNonEmptyString(work.revisionId, 200)) violations.push({ field: "revisionId", reason: "must be a non-empty string" });
  if (!isIsoTimestamp(work.publishedAt)) violations.push({ field: "publishedAt", reason: "must be an ISO timestamp" });
  if (typeof work.featured !== "boolean") violations.push({ field: "featured", reason: "must be stated as a boolean" });
  if (!Number.isFinite(work.order)) violations.push({ field: "order", reason: "must be a number" });

  if (!Array.isArray(work.categoryIds) || work.categoryIds.length === 0) {
    // An uncategorised entry cannot be found by any filter, which on a
    // portfolio page is the only way most visitors navigate.
    violations.push({ field: "categoryIds", reason: "must name at least one category" });
  } else if (work.categoryIds.length > 4) {
    violations.push({ field: "categoryIds", reason: "must name at most four categories" });
  } else {
    work.categoryIds.forEach((id, index) => {
      if (!WORK_CATEGORY_IDS.includes(id)) {
        violations.push({ field: `categoryIds[${index}]`, reason: "must be a known work category" });
      }
    });
    if (new Set(work.categoryIds).size !== work.categoryIds.length) {
      violations.push({ field: "categoryIds", reason: "must not repeat a category" });
    }
  }

  violations.push(...validateMedia(work.featuredImage, "featuredImage"));

  if (!Array.isArray(work.gallery)) {
    violations.push({ field: "gallery", reason: "must be an array" });
  } else {
    if (work.gallery.length > 40) violations.push({ field: "gallery", reason: "must contain at most 40 photographs" });
    work.gallery.forEach((media, index) => violations.push(...validateMedia(media, `gallery[${index}]`)));
  }

  // The title is the h1, so the body opens at h2 and carries no hero of its own.
  const blocks = validateBlocks(work.blocks, { requireHero: false });
  if (!blocks.ok) violations.push(...blocks.violations);
  else if (blocks.blocks.some((block) => block.type === "HERO")) {
    violations.push({ field: "blocks", reason: "must not contain a HERO; the title is the page heading" });
  }

  if (!Array.isArray(work.relatedServices)) {
    violations.push({ field: "relatedServices", reason: "must be an array" });
  } else {
    if (work.relatedServices.length > 6) {
      violations.push({ field: "relatedServices", reason: "must name at most six services" });
    }
    work.relatedServices.forEach((link, index) => {
      if (!isNonEmptyString(link?.label, 80)) {
        violations.push({ field: `relatedServices[${index}].label`, reason: "must be a non-empty label" });
      }
      if (!isRenderableHref(link?.href)) {
        violations.push({ field: `relatedServices[${index}].href`, reason: "must be a same-origin path to a live public route" });
      }
    });
  }

  violations.push(...validateWorkSeo(work.seo, work.path));

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value: work as PublicWorkItem };
}

// --- the index ----------------------------------------------------------------

/**
 * Featured first, then the editor's order, then newest, then the slug.
 *
 * Four keys rather than two because a portfolio is curated: the Owner picks
 * what leads, orders the rest by hand, and everything they have not ordered
 * should still fall in a stable, sensible sequence rather than shuffling.
 */
export function compareWorkItems(left: PublicWorkItem, right: PublicWorkItem): number {
  if (left.featured !== right.featured) return left.featured ? -1 : 1;
  if (left.order !== right.order) return left.order - right.order;
  const byDate = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  if (byDate !== 0) return byDate;
  return left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
}

export type WorkListQuery = { category?: string | null; page?: number; pageSize?: number };

export type WorkListResult =
  | {
      ok: true;
      items: PublicWorkItem[];
      page: number;
      pageCount: number;
      total: number;
      category: string | null;
      filters: Array<{ id: string; count: number; active: boolean }>;
    }
  | { ok: false; reason: string };

export function buildWorkList(
  items: ReadonlyArray<PublicWorkItem>,
  query: WorkListQuery = {},
): WorkListResult {
  const pageSize = query.pageSize ?? WORK_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return { ok: false, reason: "page size is out of range" };
  }
  const page = query.page ?? 1;
  if (!Number.isInteger(page) || page < 1) return { ok: false, reason: "page number is not a positive integer" };

  const category = query.category ?? null;
  const matching = items.filter((item) => category === null || item.categoryIds.includes(category as WorkCategoryId));

  if (category !== null && matching.length === 0) {
    return { ok: false, reason: `no published work in category "${category}"` };
  }

  const total = matching.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (page > pageCount) return { ok: false, reason: `page ${page} is past the end` };

  // Only categories that actually have work are offered: a filter leading to an
  // empty grid is worse than no filter.
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const id of item.categoryIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const filters = WORK_CATEGORY_IDS.filter((id) => counts.has(id)).map((id) => ({
    id,
    count: counts.get(id) ?? 0,
    active: id === category,
  }));

  const ordered = [...matching].sort(compareWorkItems);
  return {
    ok: true,
    items: ordered.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageCount,
    total,
    category,
    filters,
  };
}

// --- availability and the sitemap ---------------------------------------------

export type WorkAvailability =
  | { state: "PUBLISHED"; work: PublicWorkItem }
  | { state: "UNPUBLISHED" }
  | { state: "MOVED"; to: string };

export function absoluteWorkUrl(path: string): string {
  return `${CANONICAL_ORIGIN}${path}`;
}

export function buildWorkSitemapUrls(availability: ReadonlyArray<WorkAvailability>): string[] {
  const urls = availability
    .filter((entry): entry is { state: "PUBLISHED"; work: PublicWorkItem } => entry.state === "PUBLISHED")
    .map((entry) => entry.work)
    .filter((work) => work.seo.robots === "INDEX")
    .map((work) => absoluteWorkUrl(work.seo.canonicalPath));

  if (urls.length > 0) urls.push(absoluteWorkUrl(WORK_INDEX_PATH));
  return [...new Set(urls)].sort();
}

/** หน้าแรก → ผลงาน → this entry. */
export function workBreadcrumb(work: PublicWorkItem): Array<{ name: string; item: string }> {
  return [
    { name: "หน้าแรก", item: `${CANONICAL_ORIGIN}/` },
    { name: "ผลงาน", item: absoluteWorkUrl(WORK_INDEX_PATH) },
    { name: work.title, item: absoluteWorkUrl(work.seo.canonicalPath) },
  ];
}
