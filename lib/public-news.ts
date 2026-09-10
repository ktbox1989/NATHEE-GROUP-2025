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

import { and, asc, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { galleryCategories, galleryItems } from "@/db/schema";
import { getPublishedPost } from "@/lib/post-cms-store";
import type { PublicMedia } from "@/lib/public-cms/contract";
import { POSTS_PAGE_SIZE, postPath, resolvePostRedirect } from "@/lib/public-cms/posts";
import { listPostRedirects } from "@/lib/post-slug-history";
import { resolvePublicMedia } from "@/lib/public-media-store";
import {
  MAX_NEWS_PAGE,
  referencedIndexImageIds,
  toNewsCard,
  type NewsGalleryItem,
  type NewsIndexRow,
  type PublicNewsArticle,
  type PublicNewsCard,
  type PublicNewsIndex,
} from "@/lib/public-news-content";
import {
  PUBLISHED_POSTS_COUNT_SQL,
  PUBLISHED_POSTS_INDEX_SQL,
  publishedPostsIndexParams,
} from "@/lib/public-news-sql";

export * from "@/lib/public-news-content";

/**
 * Resolves gallery ids to the media a public payload may carry.
 *
 * This is `resolvePublicMedia` and nothing of its own. It is the production
 * `PostMediaResolver` the contract was waiting for, it selects only PUBLISHED
 * and PUBLIC rows in the query, it builds every source through the delivery
 * contract so a storage key never leaves the server, and it re-checks its own
 * output with `validateMedia` before returning it. A second resolver here would
 * be a second set of rules that agree until one of them is edited.
 *
 * An id that does not resolve — archived after the post was published, made
 * private, or without a raster fallback a browser is required to decode — is
 * dropped rather than rendered as a broken image, which is what
 * `mapStoredPostToPublicPost` does for the same case.
 */
async function resolveImages(ids: readonly string[]): Promise<Map<string, PublicMedia>> {
  const { media } = await resolvePublicMedia(getDb(), ids.filter(Boolean));
  return media;
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

/**
 * Where a slug moved to, or null if it did not move.
 *
 * Asked only after the article itself is not found, so a live post never pays
 * for it. `listPostRedirects` excludes a previous slug that belongs to a live
 * post again, and `resolvePostRedirect` follows rename chains and refuses loops
 * — both rules live on their own side of the contract and neither is repeated
 * here.
 */
export async function resolveRenamedNewsPath(slug: string): Promise<string | null> {
  try {
    const redirects = await listPostRedirects(getDb());
    return resolvePostRedirect(postPath(slug), redirects)?.to ?? null;
  } catch {
    // No redirect table, no redirect: the reader gets the 404 they would have
    // got anyway rather than an error page.
    return null;
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
    const gallerySections = await readNewsGallerySections(enabled);

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
        type: section.type,
        heading: section.heading,
        eyebrow: section.eyebrow,
        body: section.body,
        items: section.items,
        image: section.imageItemId ? images.get(section.imageItemId) ?? null : null,
        gallery: section.type === "GALLERY" ? gallerySections.get(section.id) ?? [] : [],
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

/**
 * The work photographs a post's GALLERY sections would show, keyed by category
 * slug and bounded by the largest limit any one section asked for.
 *
 * One query per distinct category, never per section, so three sections drawing
 * on the same category pay for it once. The selection and the ordering are the
 * marketing pages' `GallerySection` verbatim — PUBLISHED and PUBLIC items in an
 * ACTIVE category, featured first then by the gallery lane's own order — so a
 * photograph cannot be visible in one place and refused in the other. A
 * category that cannot be read yields no photographs rather than no article.
 */
export async function readNewsGalleryItemsByCategory(
  sections: ReadonlyArray<{ type: string; galleryCategorySlug: string; galleryLimit: number }>,
): Promise<Map<string, NewsGalleryItem[]>> {
  const byCategory = new Map<string, number>();
  for (const section of sections) {
    if (section.type !== "GALLERY") continue;
    const key = section.galleryCategorySlug;
    // The largest limit asked for a category is the one that satisfies every
    // section drawing on it; slicing per section happens at render.
    byCategory.set(key, Math.max(byCategory.get(key) ?? 0, section.galleryLimit));
  }

  const bySlug = new Map<string, NewsGalleryItem[]>();
  const db = getDb();
  for (const [slug, limit] of byCategory) {
    try {
      const category = slug
        ? await db
            .select({ id: galleryCategories.id })
            .from(galleryCategories)
            .where(and(eq(galleryCategories.slug, slug), eq(galleryCategories.status, "ACTIVE")))
            .get()
        : null;
      const rows = await db
        .select({
          id: galleryItems.id,
          title: galleryItems.title,
          caption: galleryItems.caption,
          altText: galleryItems.altText,
          takenAt: galleryItems.takenAt,
          location: galleryItems.location,
          categoryName: galleryCategories.name,
        })
        .from(galleryItems)
        .innerJoin(galleryCategories, eq(galleryCategories.id, galleryItems.categoryId))
        .where(
          and(
            eq(galleryItems.status, "PUBLISHED"),
            eq(galleryItems.visibility, "PUBLIC"),
            eq(galleryCategories.status, "ACTIVE"),
            category ? eq(galleryItems.categoryId, category.id) : undefined,
          ),
        )
        .orderBy(desc(galleryItems.isFeatured), asc(galleryItems.sortOrder), desc(galleryItems.createdAt), desc(galleryItems.id))
        .limit(limit)
        .all();
      bySlug.set(slug, rows);
    } catch {
      bySlug.set(slug, []);
    }
  }
  return bySlug;
}

/** The same photographs, keyed by the section that will render them. */
export async function readNewsGallerySections(
  sections: ReadonlyArray<{ id: string; type: string; galleryCategorySlug: string; galleryLimit: number }>,
): Promise<Map<string, NewsGalleryItem[]>> {
  const bySlug = await readNewsGalleryItemsByCategory(sections);
  const perSection = new Map<string, NewsGalleryItem[]>();
  for (const section of sections) {
    if (section.type !== "GALLERY") continue;
    perSection.set(section.id, (bySlug.get(section.galleryCategorySlug) ?? []).slice(0, section.galleryLimit));
  }
  return perSection;
}
