import { getD1, getDb } from "@/db";
import { parsePostContentJson } from "@/lib/post-cms-content";
import { mapStoredPostToPublicPost, type StoredPost } from "@/lib/post-cms-public";
import { collectPostReferences, getPublishedPost } from "@/lib/post-cms-store";
import { createPublicMediaResolver, resolvePublicMedia } from "@/lib/public-media-store";
import type { PublicPost } from "@/lib/public-cms/posts";
import type { PublicNewsApiSource } from "@/lib/public-news-api-contract";
import { toPublicationIso, type NewsIndexRow } from "@/lib/public-news-content";
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
    const mapped = mapStoredPostToPublicPost(stored, createPublicMediaResolver(resolution));
    return mapped.ok ? mapped.post : null;
  },
};
