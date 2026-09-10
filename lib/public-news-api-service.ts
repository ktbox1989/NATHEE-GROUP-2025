import { getD1, getDb } from "@/db";
import { parsePostContentJson } from "@/lib/post-cms-content";
import { mapStoredPostToPublicPost, type PostGalleryResolver, type StoredPost } from "@/lib/post-cms-public";
import { collectPostReferences, getPublishedPost } from "@/lib/post-cms-store";
import { createPublicMediaResolver, resolvePublicMedia } from "@/lib/public-media-store";
import type { PublicMedia } from "@/lib/public-cms/contract";
import type { PublicPost } from "@/lib/public-cms/posts";
import type { PublicNewsApiSource } from "@/lib/public-news-api-contract";
import { toPublicationIso, type NewsIndexRow } from "@/lib/public-news-content";
import { readNewsGalleryItemsByCategory } from "@/lib/public-news";
import { loadPublishedNewsSelection } from "@/lib/public-news-selection";

function storedPostFromRow(row: NewsIndexRow): StoredPost | null {
  if (typeof row.slug !== "string" || typeof row.revision_id !== "string" || typeof row.content_json !== "string") {
    return null;
  }
  const content = parsePostContentJson(row.content_json);
  const publishedAt = toPublicationIso(row.first_published);
  if (!content || !publishedAt) return null;
  const updatedAt = Number(row.publish_count ?? 0) > 1 ? toPublicationIso(row.last_published) : null;
  return { slug: row.slug, revisionId: row.revision_id, content, publishedAt, updatedAt };
}

/**
 * What a post's GALLERY sections resolve to, for the detail payload.
 *
 * Photographs are resolved one category at a time, because the media resolver
 * refuses more than sixty-four ids in one call and a post may draw on several
 * categories of twenty-four. An item archived after publication resolves to
 * nothing here and is dropped by the mapper, exactly as a single unresolvable
 * section image is.
 */
async function resolvePostGallery(sections: StoredPost["content"]["sections"]): Promise<PostGalleryResolver> {
  const enabled = sections.filter((section) => section.enabled);
  const bySlug = await readNewsGalleryItemsByCategory(enabled);
  const perSlug = new Map<string, PublicMedia[]>();
  const db = getDb();
  for (const [slug, items] of bySlug) {
    const resolved: PublicMedia[] = [];
    if (items.length > 0) {
      const { media } = await resolvePublicMedia(db, items.map((item) => item.id));
      for (const item of items) {
        const value = media.get(item.id);
        if (value) resolved.push(value);
      }
    }
    perSlug.set(slug, resolved);
  }
  return (categorySlug, limit) => (perSlug.get(categorySlug) ?? []).slice(0, limit);
}

export const publicNewsApiSource: PublicNewsApiSource = {
  async list({ limit, after }) {
    const selection = await loadPublishedNewsSelection(getD1(), { limit: limit + 1, after });
    const pageRows = selection.rows.slice(0, limit);
    const stored = pageRows.map(storedPostFromRow).filter((post): post is StoredPost => post !== null);
    const coverIds = stored.map((post) => post.content.featuredImageItemId).filter(Boolean);
    const resolution = await resolvePublicMedia(getDb(), coverIds);
    const resolveMedia = createPublicMediaResolver(resolution);
    const posts = stored
      .map((post) => mapStoredPostToPublicPost(post, resolveMedia))
      .filter((result) => result.ok)
      .map((result) => result.post);

    const last = pageRows.at(-1);
    const next = selection.rows.length > limit
      && last
      && typeof last.first_published === "string"
      && typeof last.slug === "string"
      ? { publishedAt: last.first_published, slug: last.slug }
      : null;
    return { posts, next };
  },

  async detail(slug): Promise<PublicPost | null> {
    const db = getDb();
    const stored = await getPublishedPost(slug, db);
    if (!stored) return null;
    const references = collectPostReferences(stored.content);
    const resolution = await resolvePublicMedia(db, references.imageItemIds);
    const resolveGallery = await resolvePostGallery(stored.content.sections);
    const mapped = mapStoredPostToPublicPost(stored, createPublicMediaResolver(resolution), resolveGallery);
    return mapped.ok ? mapped.post : null;
  },
};
