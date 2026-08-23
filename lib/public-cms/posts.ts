// What the public website requires of CMS posts and news articles.
//
// The eleven marketing routes are a closed list: a CMS page for anything else
// is refused. Posts are the opposite shape — the whole point is that an editor
// creates URLs nobody enumerated in advance — so the safety has to come from
// the slug rules and the published state rather than from an allowlist of
// paths.
//
// Everything a post renders that a page also renders is the page's code:
// sections, media and the heading outline all come from `contract.ts`. The
// accessibility rules are properties of the public site, not of a content
// type, and a second copy of them would be a second chance to get one wrong.
//
// Lane B has no posts schema today. This is the receiving end of a contract
// that does not yet have a sender, written now so that when the schema arrives
// the work is a mapping function rather than a design.

import {
  CANONICAL_ORIGIN,
  PUBLIC_ROUTE_PATHS,
  isIsoTimestamp,
  isNonEmptyString,
  validateMedia,
  validateSections,
  type ContractViolation,
  type PublicMedia,
  type PublicRoutePath,
  type PublicSection,
  type ValidationResult,
} from "./contract.ts";

/** The index that lists posts. A real public route, unlike the posts under it. */
export const POSTS_INDEX_PATH = "/news/";

/** How many posts one index page shows. */
export const POSTS_PAGE_SIZE = 12;

// Slugs that would collide with the index, its pagination, or a feed if one is
// ever added. Refused rather than escaped, because a post at /news/page/2/ is
// unreachable however carefully it is rendered.
const RESERVED_POST_SLUGS = new Set(["page", "feed", "rss", "atom", "sitemap", "index", "all", "category", "tag"]);

// Lowercase, hyphen-separated, no leading, trailing or doubled hyphen. Thai
// titles produce Thai slugs if left alone, and a percent-encoded Thai slug is
// unreadable in a share and fragile in a sitemap, so the CMS must supply a
// latin slug and this refuses anything else rather than transliterating.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 80;

export type PublicPostCategory = {
  id: string;
  label: string;
};

export type PublicPostSeo = {
  title: string;
  description: string;
  /** Must equal the post's own path. */
  canonicalPath: string;
  robots: "INDEX" | "NOINDEX";
};

export type PublicPost = {
  contractVersion: number;
  // Only ever PUBLISHED, exactly as for pages: a draft has no representation
  // in the type, so a draft cannot be rendered by construction.
  status: "PUBLISHED";
  slug: string;
  path: string;
  /** The single h1. */
  title: string;
  /** Shown in the list and used as the meta description when SEO omits one. */
  excerpt: string;
  category: PublicPostCategory | null;
  publishedAt: string;
  /** Null when the post has never been edited since publication. */
  updatedAt: string | null;
  featuredImage: PublicMedia | null;
  sections: PublicSection[];
  seo: PublicPostSeo;
  revisionId: string;
};

export function isValidPostSlug(slug: unknown): slug is string {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > SLUG_MAX_LENGTH) return false;
  if (!SLUG_PATTERN.test(slug)) return false;
  return !RESERVED_POST_SLUGS.has(slug);
}

export function postPath(slug: string): string {
  return `${POSTS_INDEX_PATH}${slug}/`;
}

/**
 * True when a path is the index or one post under it.
 *
 * Deliberately strict about the trailing slash and about depth: `/news/a/b/`
 * is not a post, and treating it as one would serve the same content at two
 * URLs.
 */
export function isPostPath(path: string): boolean {
  if (!path.startsWith(POSTS_INDEX_PATH)) return false;
  const remainder = path.slice(POSTS_INDEX_PATH.length);
  if (remainder === "") return true;
  if (!remainder.endsWith("/")) return false;
  return isValidPostSlug(remainder.slice(0, -1));
}

function validatePostSeo(input: unknown, path: unknown): ContractViolation[] {
  if (typeof input !== "object" || input === null) return [{ field: "seo", reason: "must be an object" }];
  const seo = input as Partial<PublicPostSeo>;
  const violations: ContractViolation[] = [];

  if (!isNonEmptyString(seo.title, 200)) violations.push({ field: "seo.title", reason: "must be a non-empty title" });
  if (!isNonEmptyString(seo.description, 400)) {
    violations.push({ field: "seo.description", reason: "must be a non-empty description" });
  }
  if (seo.canonicalPath !== path) {
    // A canonical pointing anywhere but the post's own path silently
    // de-indexes it or hands its ranking to another URL.
    violations.push({ field: "seo.canonicalPath", reason: "must equal the post path" });
  }
  if (seo.robots !== "INDEX" && seo.robots !== "NOINDEX") {
    violations.push({ field: "seo.robots", reason: "must be INDEX or NOINDEX" });
  }
  return violations;
}

function validateCategory(input: unknown): ContractViolation[] {
  if (input === null) return [];
  if (typeof input !== "object") return [{ field: "category", reason: "must be null or an object" }];
  const category = input as Partial<PublicPostCategory>;
  const violations: ContractViolation[] = [];
  if (!isNonEmptyString(category.id, 100)) violations.push({ field: "category.id", reason: "must be a non-empty string" });
  if (!isNonEmptyString(category.label, 120)) {
    violations.push({ field: "category.label", reason: "must be a non-empty label" });
  }
  return violations;
}

/**
 * The single gate every CMS post passes before it can be rendered. Anything
 * that fails is refused whole, exactly as for a page: a partially trusted post
 * is not rendered partially.
 */
export function validatePublicPost(input: unknown, contractVersion: number): ValidationResult<PublicPost> {
  if (typeof input !== "object" || input === null) {
    return { ok: false, violations: [{ field: "post", reason: "must be an object" }] };
  }
  const post = input as Partial<PublicPost>;
  const violations: ContractViolation[] = [];

  if (post.contractVersion !== contractVersion) {
    violations.push({ field: "contractVersion", reason: `must be ${contractVersion}` });
  }
  if (post.status !== "PUBLISHED") {
    violations.push({ field: "status", reason: "must be PUBLISHED" });
  }

  if (!isValidPostSlug(post.slug)) {
    violations.push({
      field: "slug",
      reason: "must be lowercase latin words joined by single hyphens, and not a reserved name",
    });
  } else if (post.path !== postPath(post.slug)) {
    // The path is derived from the slug, so a disagreement means one of them
    // is wrong and there is no way to tell which.
    violations.push({ field: "path", reason: "must be the path derived from the slug" });
  } else if (PUBLIC_ROUTE_PATHS.includes(post.path as PublicRoutePath)) {
    violations.push({ field: "path", reason: "must not collide with a marketing route" });
  }

  if (!isNonEmptyString(post.title, 300)) violations.push({ field: "title", reason: "must be a non-empty h1" });
  if (!isNonEmptyString(post.excerpt, 500)) {
    // The excerpt is what the list page shows. A post with none renders as a
    // headline with nothing under it, which reads as a broken card.
    violations.push({ field: "excerpt", reason: "must be a non-empty excerpt" });
  }
  if (!isNonEmptyString(post.revisionId, 200)) violations.push({ field: "revisionId", reason: "must be a non-empty string" });
  if (!isIsoTimestamp(post.publishedAt)) violations.push({ field: "publishedAt", reason: "must be an ISO timestamp" });
  if (post.updatedAt !== null && !isIsoTimestamp(post.updatedAt)) {
    violations.push({ field: "updatedAt", reason: "must be null or an ISO timestamp" });
  }
  if (
    post.updatedAt &&
    isIsoTimestamp(post.publishedAt) &&
    Date.parse(post.updatedAt) < Date.parse(post.publishedAt)
  ) {
    // An edit that predates the publication is a data error, and it would be
    // published to search engines as an Article dateModified.
    violations.push({ field: "updatedAt", reason: "must not precede publishedAt" });
  }

  violations.push(...validateCategory(post.category));

  if (post.featuredImage !== null) {
    violations.push(...validateMedia(post.featuredImage, "featuredImage"));
  }

  violations.push(...validatePostSeo(post.seo, post.path));
  violations.push(...validateSections(post.sections));

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value: post as PublicPost };
}

// --- the list ---------------------------------------------------------------

export type PostListQuery = {
  /** Category id, or null for every category. */
  category?: string | null;
  /** One-based, as it appears in the URL. */
  page?: number;
  pageSize?: number;
};

export type PostListResult =
  | {
      ok: true;
      items: PublicPost[];
      page: number;
      pageCount: number;
      total: number;
      category: string | null;
      /** Set only when the list is legitimately empty; never on a refusal. */
      emptyState: ListEmptyState | null;
    }
  // A page or category that does not exist must 404 rather than render an
  // empty list at 200: a soft 404 keeps the URL indexed and tells a visitor
  // the site is broken rather than that they mistyped.
  | { ok: false; reason: string };

/**
 * Newest first, with the slug as the tie-break.
 *
 * The tie-break is not cosmetic: several posts published in the same batch
 * share a timestamp, and without a deterministic order the list would shuffle
 * between requests and paginate inconsistently, showing one post twice and
 * hiding another.
 */
export function comparePostsForList(left: PublicPost, right: PublicPost): number {
  const byDate = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  if (byDate !== 0) return byDate;
  return left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
}

export function buildPostList(posts: ReadonlyArray<PublicPost>, query: PostListQuery = {}): PostListResult {
  const pageSize = query.pageSize ?? POSTS_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return { ok: false, reason: "page size is out of range" };
  }

  const page = query.page ?? 1;
  if (!Number.isInteger(page) || page < 1) return { ok: false, reason: "page number is not a positive integer" };

  const category = query.category ?? null;
  // Only published posts exist in this type at all, so the filter is about the
  // category alone.
  const matching = posts.filter((post) => category === null || post.category?.id === category);

  if (category !== null && matching.length === 0) {
    return { ok: false, reason: `no posts in category "${category}"` };
  }

  const total = matching.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (page > pageCount) return { ok: false, reason: `page ${page} is past the end` };

  const ordered = [...matching].sort(comparePostsForList);
  const items = ordered.slice((page - 1) * pageSize, page * pageSize);
  return {
    ok: true,
    items,
    page,
    pageCount,
    total,
    category,
    // The only way to reach here with nothing is an empty site: a category with
    // no posts and a page past the end are both refusals above.
    emptyState: items.length === 0 ? POSTS_EMPTY_STATE : null,
  };
}

/** The categories that have at least one published post, in label order. */
export function buildPostCategories(posts: ReadonlyArray<PublicPost>): Array<PublicPostCategory & { count: number }> {
  const counts = new Map<string, PublicPostCategory & { count: number }>();
  for (const post of posts) {
    if (!post.category) continue;
    const existing = counts.get(post.category.id);
    if (existing) existing.count += 1;
    else counts.set(post.category.id, { ...post.category, count: 1 });
  }
  return [...counts.values()].sort((left, right) => left.label.localeCompare(right.label, "th"));
}

// --- availability and redirects --------------------------------------------

export type PostAvailability =
  | { state: "PUBLISHED"; post: PublicPost }
  | { state: "UNPUBLISHED" }
  | { state: "MOVED"; to: string };

export type PostRedirect = { from: string; to: string };

/**
 * Validates a post redirect before it can be served.
 *
 * Renaming a slug is the ordinary way a post's URL changes, and getting it
 * wrong on the apex is worse than a dead link: an open redirect, or a loop.
 * The rules mirror the page redirects, with one addition — the target must be
 * a post path, so a rename cannot quietly point at a marketing route.
 */
export function validatePostRedirect(redirect: PostRedirect): string[] {
  const problems: string[] = [];
  const { from, to } = redirect;

  if (typeof from !== "string" || !from.startsWith("/")) problems.push("from must be a same-origin path");
  if (typeof from === "string" && from.includes("..")) problems.push("from must not contain a traversal");
  if (typeof from === "string" && from.startsWith("//")) problems.push("from must not be protocol-relative");
  if (typeof to !== "string" || !isPostPath(to) || to === POSTS_INDEX_PATH) {
    problems.push("to must be a post path");
  }
  if (from === to) problems.push("a redirect to itself would loop");
  if (typeof from === "string" && PUBLIC_ROUTE_PATHS.includes(from as PublicRoutePath)) {
    problems.push("from is a live marketing route and must not be redirected away");
  }
  return problems;
}

/**
 * Resolves a request path through the post redirect table.
 *
 * Unlike the marketing routes, a post redirect's target CAN later be renamed,
 * so chains are possible here and are resolved rather than assumed away — up
 * to a small bound, after which the table is treated as broken and the visitor
 * gets a 404 rather than a redirect loop in their browser.
 */
export function resolvePostRedirect(
  path: string,
  redirects: ReadonlyArray<PostRedirect>,
  maxHops = 4,
): { to: string; hops: number } | null {
  const valid = redirects.filter((redirect) => validatePostRedirect(redirect).length === 0);
  let current = path;
  for (let hops = 1; hops <= maxHops; hops += 1) {
    const match = valid.find((redirect) => redirect.from === current);
    if (!match) return hops === 1 ? null : { to: current, hops: hops - 1 };
    if (match.to === path) return null; // a cycle back to where we started
    current = match.to;
  }
  return null;
}

// --- sitemap ----------------------------------------------------------------

export function absolutePostUrl(path: string): string {
  return `${CANONICAL_ORIGIN}${path}`;
}

/**
 * The sitemap lists the index and every published, indexable post.
 *
 * Unpublished posts are absent because they are absent from the input: an
 * unpublished post has no `PublicPost` to be listed. A `NOINDEX` post is
 * served but excluded, because a noindex URL in a sitemap sends contradictory
 * signals.
 */
export function buildPostSitemapUrls(
  availability: ReadonlyArray<PostAvailability>,
  options: { includeIndex?: boolean } = {},
): string[] {
  const urls = availability
    .filter((entry): entry is { state: "PUBLISHED"; post: PublicPost } => entry.state === "PUBLISHED")
    .map((entry) => entry.post)
    .filter((post) => post.seo.robots === "INDEX")
    .map((post) => absolutePostUrl(post.seo.canonicalPath));

  // An index with nothing on it is not worth submitting, and listing it would
  // advertise an empty section of the site.
  if (options.includeIndex !== false && urls.length > 0) urls.push(absolutePostUrl(POSTS_INDEX_PATH));

  return [...new Set(urls)].sort();
}

// --- what the reader sees when there is nothing, or when they finish reading --

/**
 * What a surface says when it has nothing to show.
 *
 * Rendered rather than left blank, and rendered differently depending on why:
 * "there are no posts yet" and "there are none in this category" are different
 * facts, and telling a visitor the wrong one makes the site look broken. Each
 * carries a way out, because a dead end with an apology on it is still a dead
 * end.
 */
export type ListEmptyState = {
  heading: string;
  body: string;
  action: { label: string; href: string } | null;
};

export const POSTS_EMPTY_STATE: Readonly<ListEmptyState> = Object.freeze({
  heading: "ยังไม่มีข่าวสารเผยแพร่",
  body: "เมื่อมีประกาศหรือความคืบหน้าใหม่ จะแสดงที่หน้านี้",
  action: Object.freeze({ label: "ดูบริการทั้งหมด", href: "/services/" }),
});

/**
 * Posts worth reading next.
 *
 * Same category first because that is the strongest signal of relevance, then
 * filled from the newest remaining posts rather than left short — a "related"
 * strip with one item in it looks like a defect. The current post is always
 * excluded, and the order is deterministic so the strip does not reshuffle
 * between requests on the same article.
 */
export function buildRelatedPosts(
  current: PublicPost,
  all: ReadonlyArray<PublicPost>,
  limit = 3,
): PublicPost[] {
  if (!Number.isInteger(limit) || limit < 1) return [];

  const candidates = all.filter((post) => post.slug !== current.slug);
  const sameCategory = current.category
    ? candidates.filter((post) => post.category?.id === current.category?.id)
    : [];
  const others = candidates.filter((post) => !sameCategory.includes(post));

  return [...sameCategory.sort(comparePostsForList), ...others.sort(comparePostsForList)].slice(0, limit);
}
