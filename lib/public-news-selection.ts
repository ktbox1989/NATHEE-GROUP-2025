import type { NewsIndexRow } from "./public-news-content.ts";
import { PUBLISHED_POSTS_CURSOR_SQL, publishedPostsCursorParams } from "./public-news-sql.ts";

/** The key behind the opaque API cursor. It is not an internal record id. */
export type PublishedNewsCursorKey = { publishedAt: string; slug: string };

/** The small part of D1 this read-only loader needs, kept injectable in tests. */
export type PublishedNewsDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results?: T[] }>;
    };
  };
};

export type PublishedNewsSelection = {
  rows: NewsIndexRow[];
  next: PublishedNewsCursorKey | null;
};

/**
 * Shared source of truth for cursor consumers such as the data API and sitemap.
 * Eligibility is decided inside PUBLISHED_POSTS_CURSOR_SQL by the latest
 * publication event, so callers cannot accidentally widen it to drafts.
 */
export async function loadPublishedNewsSelection(
  database: PublishedNewsDatabase,
  options: { limit: number; after?: PublishedNewsCursorKey | null },
): Promise<PublishedNewsSelection> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 501) {
    throw new RangeError("published News selection limit is out of range");
  }

  const { results } = await database
    .prepare(PUBLISHED_POSTS_CURSOR_SQL)
    .bind(...publishedPostsCursorParams(options.limit, options.after ?? null))
    .all<NewsIndexRow>();
  const rows = results ?? [];
  const last = rows.at(-1);
  const next = last && typeof last.first_published === "string" && typeof last.slug === "string"
    ? { publishedAt: last.first_published, slug: last.slug }
    : null;
  return { rows, next };
}
