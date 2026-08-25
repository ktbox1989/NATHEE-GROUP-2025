/**
 * What the public /news/ routes read, and nothing else.
 *
 * The Owner has been able to write, preview, publish and unpublish a post since
 * Lane B shipped the posts schema, but a published post had nowhere to appear:
 * `POSTS_INDEX_PATH` named a route that did not exist. This is the reading half
 * of that route, kept beside the published-state helpers the marketing pages
 * use rather than inside a page component, so a draft has no path to an
 * anonymous reader even if a future page forgets to ask for published state.
 *
 * Reuse over reimplementation: a single article is read through
 * `getPublishedPost`, which already derives publication state from the event
 * history and refuses anything whose latest event is not a PUBLISH. Only the
 * index — which did not exist in any form — is new, and it is one bounded query
 * rather than a per-post loop.
 *
 * Every export here fails closed. A database that cannot be reached produces an
 * honest "temporarily unavailable" index and a 404 for one article, never a
 * stack trace on a URL a search engine holds.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { galleryImageVariants, galleryItems } from "@/db/schema";
import { getPublishedPost } from "@/lib/post-cms-store";
import { POSTS_PAGE_SIZE } from "@/lib/public-cms/posts";
import {
  MAX_NEWS_PAGE,
  referencedIndexImageIds,
  toNewsCard,
  type NewsIndexRow,
  type PublicNewsArticle,
  type PublicNewsCard,
  type PublicNewsImage,
  type PublicNewsIndex,
} from "@/lib/public-news-content";
import {
  PUBLISHED_POSTS_COUNT_SQL,
  PUBLISHED_POSTS_INDEX_SQL,
  publishedPostsIndexParams,
} from "@/lib/public-news-sql";
import { postPath } from "@/lib/public-cms/posts";

export * from "@/lib/public-news-content";

/**
 * Resolves gallery ids to renderable media in one query.
 *
 * Only PUBLISHED + PUBLIC items resolve. An id that does not — archived after
 * the post was published, or never public — is dropped rather than rendered as
 * a broken image, which is what `mapStoredPostToPublicPost` does for the same
 * case. Publishing already refuses a revision whose media cannot be served, so
 * reaching here means the item changed after the post went live.
 */
async function resolveImages(ids: readonly string[]): Promise<Map<string, PublicNewsImage>> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 60);
  const resolved = new Map<string, PublicNewsImage>();
  if (unique.length === 0) return resolved;

  const db = getDb();
  const items = await db
    .select({ id: galleryItems.id, altText: galleryItems.altText })
    .from(galleryItems)
    .where(
      and(
        inArray(galleryItems.id, unique),
        eq(galleryItems.status, "PUBLISHED"),
        eq(galleryItems.visibility, "PUBLIC"),
      ),
    )
    .all();
  if (items.length === 0) return resolved;

  // Intrinsic dimensions come from the DISPLAY variant so the space is reserved
  // before the photograph arrives; without them the article reflows as it loads.
  const variants = await db
    .select({
      galleryItemId: galleryImageVariants.galleryItemId,
      width: galleryImageVariants.width,
      height: galleryImageVariants.height,
    })
    .from(galleryImageVariants)
    .where(
      and(
        inArray(
          galleryImageVariants.galleryItemId,
          items.map((item) => item.id),
        ),
        eq(galleryImageVariants.role, "DISPLAY"),
      ),
    )
    .all();
  const dimensions = new Map(variants.map((variant) => [variant.galleryItemId, variant]));

  for (const item of items) {
    const variant = dimensions.get(item.id);
    resolved.set(item.id, {
      id: item.id,
      altText: item.altText,
      width: variant?.width ?? null,
      height: variant?.height ?? null,
    });
  }
  return resolved;
}

/** The published archive, one page at a time. Never throws. */
export async function readPublishedNewsIndex(page: number): Promise<PublicNewsIndex> {
  const requested = Math.min(Math.max(Math.trunc(page) || 1, 1), MAX_NEWS_PAGE);
  try {
    const database = getD1();
    const counted = await database.prepare(PUBLISHED_POSTS_COUNT_SQL).first<{ total: number }>();
    const total = Number(counted?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / POSTS_PAGE_SIZE));
    const current = Math.min(requested, pageCount);
    const { results } = await database
      .prepare(PUBLISHED_POSTS_INDEX_SQL)
      .bind(...publishedPostsIndexParams(POSTS_PAGE_SIZE, (current - 1) * POSTS_PAGE_SIZE))
      .all<NewsIndexRow>();
    const rows = results ?? [];
    const images = await resolveImages(referencedIndexImageIds(rows));

    return {
      posts: rows
        .map((row) => toNewsCard(row, images))
        .filter((card): card is PublicNewsCard => card !== null),
      page: current,
      pageCount,
      total,
      unavailable: false,
    };
  } catch {
    return { posts: [], page: requested, pageCount: 1, total: 0, unavailable: true };
  }
}

/** One published article, or null when there is no published post at that slug. */
export async function readPublishedNewsArticle(slug: string): Promise<PublicNewsArticle | null> {
  try {
    const stored = await getPublishedPost(slug);
    if (!stored) return null;
    const { content } = stored;

    const enabled = content.sections.filter((section) => section.enabled);
    const images = await resolveImages([content.featuredImageItemId, ...enabled.map((section) => section.imageItemId)]);

    return {
      slug: stored.slug,
      path: postPath(stored.slug),
      title: content.title,
      excerpt: content.excerpt,
      category: content.category,
      publishedAt: stored.publishedAt,
      updatedAt: stored.updatedAt,
      revisionId: stored.revisionId,
      image: content.featuredImageItemId ? images.get(content.featuredImageItemId) ?? null : null,
      seo: content.seo,
      sections: enabled.map((section) => ({
        id: section.id,
        heading: section.heading,
        eyebrow: section.eyebrow,
        body: section.body,
        items: section.items,
        image: section.imageItemId ? images.get(section.imageItemId) ?? null : null,
        primaryLabel: section.primaryLabel,
        primaryHref: section.primaryHref,
        secondaryLabel: section.secondaryLabel,
        secondaryHref: section.secondaryHref,
      })),
    };
  } catch {
    // An article that cannot be read is a 404 for the reader rather than a 500:
    // the alternative is an error page on a URL a search engine already holds.
    return null;
  }
}
