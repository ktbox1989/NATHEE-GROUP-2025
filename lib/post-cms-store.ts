import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { postPublicationEvents, postRevisions, posts, users } from "@/db/schema";
import { parsePostContentJson, type PostContent } from "@/lib/post-cms-content";
import type { PublishReferences } from "@/lib/site-cms-publish";
import type { StoredPost } from "@/lib/post-cms-public";

/**
 * Reads for the post editor and for the public payload.
 *
 * Publication state is derived from the event history rather than stored, so
 * "what is live" and "what happened" cannot disagree. Every lookup below is
 * bounded and index-backed; the editor lists at most a page of revisions.
 */

const REVISION_PAGE = 20;

export type PostPublicationState = {
  action: "PUBLISH" | "HIDE";
  revisionId: string | null;
  /** ISO-8601, the first time this post was published. */
  publishedAt: string | null;
  /** ISO-8601 of the most recent republish, null when published only once. */
  updatedAt: string | null;
};

export type PostSummary = {
  slug: string;
  title: string | null;
  state: "PUBLISHED" | "HIDDEN" | "DRAFT";
  revisionCount: number;
  updatedAt: string;
};

/** A stored timestamp is `YYYY-MM-DD HH:MM:SS` in UTC; the contract wants ISO. */
function toIso(recorded: string | null): string | null {
  if (!recorded) return null;
  const normalized = recorded.includes("T") ? recorded : `${recorded.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function publicationState(postId: string): Promise<PostPublicationState | null> {
  const db = getDb();
  const latest = await db
    .select({ action: postPublicationEvents.action, revisionId: postPublicationEvents.revisionId })
    .from(postPublicationEvents)
    .where(eq(postPublicationEvents.postId, postId))
    .orderBy(desc(postPublicationEvents.createdAt), desc(postPublicationEvents.id))
    .limit(1)
    .get();
  if (!latest) return null;

  // Publication dates are facts about PUBLISH events only: hiding a post does
  // not change when it was published, and republishing after a hide is an edit.
  const publishes = await db
    .select({
      first: sql<string | null>`min(${postPublicationEvents.createdAt})`,
      last: sql<string | null>`max(${postPublicationEvents.createdAt})`,
      total: sql<number>`count(*)`,
    })
    .from(postPublicationEvents)
    .where(and(eq(postPublicationEvents.postId, postId), eq(postPublicationEvents.action, "PUBLISH")))
    .get();

  return {
    action: latest.action,
    revisionId: latest.revisionId,
    publishedAt: toIso(publishes?.first ?? null),
    updatedAt: (publishes?.total ?? 0) > 1 ? toIso(publishes?.last ?? null) : null,
  };
}

export async function listPosts(): Promise<PostSummary[]> {
  const db = getDb();
  const rows = await db
    .select({ id: posts.id, slug: posts.slug, updatedAt: posts.updatedAt })
    .from(posts)
    .orderBy(desc(posts.updatedAt), desc(posts.id))
    .limit(200)
    .all();

  const summaries: PostSummary[] = [];
  for (const row of rows) {
    const revisions = await db
      .select({ id: postRevisions.id, contentJson: postRevisions.contentJson })
      .from(postRevisions)
      .where(eq(postRevisions.postId, row.id))
      .orderBy(desc(postRevisions.createdAt), desc(postRevisions.id))
      .limit(REVISION_PAGE)
      .all();
    const publication = await publicationState(row.id);
    const latest = revisions[0] ? parsePostContentJson(revisions[0].contentJson) : null;
    summaries.push({
      slug: row.slug,
      title: latest?.title ?? null,
      state: publication?.action === "PUBLISH" ? "PUBLISHED" : publication?.action === "HIDE" ? "HIDDEN" : "DRAFT",
      revisionCount: revisions.length,
      updatedAt: row.updatedAt,
    });
  }
  return summaries;
}

export type PostEditorState = {
  postId: string;
  slug: string;
  publication: PostPublicationState | null;
  revisions: Array<{
    id: string;
    contentHash: string;
    changeNote: string | null;
    createdAt: string;
    author: string;
    content: PostContent | null;
  }>;
};

export async function getPostEditorState(slug: string): Promise<PostEditorState | null> {
  const db = getDb();
  const post = await db.select({ id: posts.id, slug: posts.slug }).from(posts).where(eq(posts.slug, slug)).get();
  if (!post) return null;

  const revisions = await db
    .select({
      id: postRevisions.id,
      contentJson: postRevisions.contentJson,
      contentHash: postRevisions.contentHash,
      changeNote: postRevisions.changeNote,
      createdAt: postRevisions.createdAt,
      author: users.displayName,
    })
    .from(postRevisions)
    .innerJoin(users, eq(users.id, postRevisions.createdBy))
    .where(eq(postRevisions.postId, post.id))
    .orderBy(desc(postRevisions.createdAt), desc(postRevisions.id))
    .limit(REVISION_PAGE)
    .all();

  return {
    postId: post.id,
    slug: post.slug,
    publication: await publicationState(post.id),
    revisions: revisions.map((revision) => ({
      id: revision.id,
      contentHash: revision.contentHash,
      changeNote: revision.changeNote,
      createdAt: revision.createdAt,
      author: revision.author,
      content: parsePostContentJson(revision.contentJson),
    })),
  };
}

export async function getRevisionContent(postId: string, revisionId: string): Promise<PostContent | null> {
  const row = await getDb()
    .select({ contentJson: postRevisions.contentJson })
    .from(postRevisions)
    .where(and(eq(postRevisions.id, revisionId), eq(postRevisions.postId, postId)))
    .get();
  return row ? parsePostContentJson(row.contentJson) : null;
}

/**
 * What the public site may serve. Returns null unless the most recent event is
 * a PUBLISH, so a hidden post has no representation here at all.
 */
export async function getPublishedPost(slug: string): Promise<StoredPost | null> {
  const db = getDb();
  const post = await db.select({ id: posts.id, slug: posts.slug }).from(posts).where(eq(posts.slug, slug)).get();
  if (!post) return null;

  const publication = await publicationState(post.id);
  if (!publication || publication.action !== "PUBLISH" || !publication.revisionId || !publication.publishedAt) {
    return null;
  }

  const content = await getRevisionContent(post.id, publication.revisionId);
  if (!content) return null;

  return {
    slug: post.slug,
    revisionId: publication.revisionId,
    content,
    publishedAt: publication.publishedAt,
    updatedAt: publication.updatedAt,
  };
}

/** Media a post points at, so publish can refuse a revision it cannot render. */
export function collectPostReferences(content: PostContent): PublishReferences {
  const imageItemIds = new Set<string>();
  if (content.featuredImageItemId) imageItemIds.add(content.featuredImageItemId);
  for (const section of content.sections) {
    if (section.enabled && section.imageItemId) imageItemIds.add(section.imageItemId);
  }
  return { imageItemIds: [...imageItemIds], galleryCategorySlugs: [] };
}
