/**
 * The render model behind /news/, and the rules for building it — with no
 * database import, so every rule here is testable on its own.
 *
 * The split mirrors `site-cms-content.ts` beside `site-cms.ts`: what a post
 * looks like once it is allowed to be rendered is a property of the content,
 * and what is currently published is a property of the database.
 *
 * This is not a second copy of `lib/public-cms/posts.ts`. That module is the
 * contract for the statically built release, where media is served from a
 * document root under `/assets/` and a whole archive is held in memory to be
 * paginated. This one is the runtime-rendered site, where media comes from the
 * authorization-aware image route and pagination happens in SQL. The two share
 * what can be shared — the slug rule, the path, the page size, the empty state
 * copy — and the ordering tie-break is deliberately identical so a batch
 * published in the same second lists the same way on both.
 */

import { parsePostContentJson, type PostRobots } from "./post-cms-content.ts";
import { postPath } from "./public-cms/posts.ts";
import type { CmsFeature } from "./site-cms-content.ts";
import { timestampInstant } from "./timestamps.ts";

/**
 * A page bound, so an offset stays small and a crafted `?page=` cannot ask the
 * database to skip a million rows.
 */
export const MAX_NEWS_PAGE = 50;

export type PublicNewsImage = {
  id: string;
  altText: string;
  width: number | null;
  height: number | null;
};

export type PublicNewsCard = {
  slug: string;
  path: string;
  title: string;
  excerpt: string;
  category: { id: string; label: string } | null;
  /** ISO-8601, the first publication. */
  publishedAt: string;
  /** ISO-8601 of the most recent republish, null when published only once. */
  updatedAt: string | null;
  image: PublicNewsImage | null;
};

export type PublicNewsSection = {
  id: string;
  heading: string;
  eyebrow: string;
  body: string;
  items: CmsFeature[];
  image: PublicNewsImage | null;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
};

export type PublicNewsArticle = PublicNewsCard & {
  revisionId: string;
  seo: { title: string; description: string; robots: PostRobots };
  sections: PublicNewsSection[];
};

export type PublicNewsIndex = {
  posts: PublicNewsCard[];
  page: number;
  pageCount: number;
  total: number;
  /**
   * True when the archive could not be read at all. The page says so instead of
   * showing "no articles yet", because those are different facts and telling a
   * reader the second when the first is true makes an outage look like an
   * editorial decision.
   */
  unavailable: boolean;
};

/** One row of `PUBLISHED_POSTS_INDEX_SQL`, before anything is trusted about it. */
export type NewsIndexRow = {
  slug: unknown;
  revision_id: unknown;
  content_json: unknown;
  first_published: unknown;
  last_published: unknown;
  publish_count: unknown;
};

/**
 * The route a reader is served this image from.
 *
 * `/api/gallery/images/:id` serves a PUBLISHED + PUBLIC item to anyone and
 * refuses everything else, which is the same route every managed marketing page
 * already uses. It is deliberately not the `/assets/` form
 * `lib/public-cms/contract.ts` requires: that prefix belongs to the statically
 * built release served from a document root, and where runtime CMS media lives
 * under `/assets/` is a deployment decision that has not been made. See
 * `docs/LANE_A_CONTRACT_ASKS.md`.
 */
export function newsImageSrc(id: string, role: "display" | "thumbnail"): string {
  return `/api/gallery/images/${encodeURIComponent(id)}?role=${role}`;
}

/** A `?page=` value from a stranger, reduced to a page number this site has. */
export function clampNewsPage(value: string | undefined): number {
  const page = Number(value ?? 1);
  if (!Number.isSafeInteger(page) || page < 1) return 1;
  return Math.min(page, MAX_NEWS_PAGE);
}

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** Bangkok is UTC+7 and has no daylight saving, so the shift is a constant. */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * A publication date as a Thai reader expects to see it: Bangkok time, Buddhist
 * era. Written out rather than delegated to `Intl`, so the same input produces
 * the same string in a test, in the Workers runtime and on the Owner's laptop —
 * and so an evening publish is not shown as the previous day, which is what
 * rendering the UTC date would do for a third of every day.
 */
export function formatThaiDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  const local = new Date(parsed + BANGKOK_OFFSET_MS);
  return `${local.getUTCDate()} ${THAI_MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear() + 543}`;
}

/** The instant a stored publication timestamp denotes, as ISO-8601. */
export function toPublicationIso(recorded: unknown): string | null {
  if (typeof recorded !== "string") return null;
  const instant = timestampInstant(recorded);
  return instant === null ? null : new Date(instant).toISOString();
}

/**
 * Turns one index row into a card, or null if it cannot be rendered honestly.
 *
 * A revision that no longer parses stays in history and the editor can still
 * open it. What it must not do is reach a reader as a half-built card with a
 * missing headline, so it is dropped from the list rather than patched with
 * placeholders.
 */
export function toNewsCard(row: NewsIndexRow, images: ReadonlyMap<string, PublicNewsImage>): PublicNewsCard | null {
  if (typeof row.slug !== "string" || typeof row.content_json !== "string") return null;
  const content = parsePostContentJson(row.content_json);
  const publishedAt = toPublicationIso(row.first_published);
  if (!content || !publishedAt || !content.title || !content.excerpt) return null;

  // Published more than once means it has been edited since going live. Once
  // means it never has, and updatedAt stays null rather than repeating the
  // publication date, which would tell a search engine about an edit that
  // never happened.
  const republished = Number(row.publish_count ?? 0) > 1;
  return {
    slug: row.slug,
    path: postPath(row.slug),
    title: content.title,
    excerpt: content.excerpt,
    category: content.category,
    publishedAt,
    updatedAt: republished ? toPublicationIso(row.last_published) : null,
    image: content.featuredImageItemId ? images.get(content.featuredImageItemId) ?? null : null,
  };
}

/** The gallery ids one page of index rows needs resolved, bounded and unique. */
export function referencedIndexImageIds(rows: ReadonlyArray<NewsIndexRow>): string[] {
  const ids = rows
    .map((row) => (typeof row.content_json === "string" ? parsePostContentJson(row.content_json) : null))
    .map((content) => content?.featuredImageItemId ?? "")
    .filter(Boolean);
  return [...new Set(ids)];
}
