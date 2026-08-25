import { and, desc, eq, sql } from "drizzle-orm";
import { postPublicationEvents, postRevisions, posts, users } from "../db/schema.ts";
import type { CmsDatabase } from "./cms-database.ts";
import { parsePostContentJson, type PostContent } from "./post-cms-content.ts";
import type { PublishReferences } from "./site-cms-publish.ts";
import type { StoredPost } from "./post-cms-public.ts";

/**
 * Reads for the post editor and for the public payload.
 *
 * Publication state is derived from the event history rather than stored, so
 * "what is live" and "what happened" cannot disagree. Every lookup below is
 * bounded and index-backed; the editor lists at most a page of revisions.
 */

const REVISION_PAGE = 20;

/**
 * The database handle, taken as an argument when one is given.
 *
 * `getDb()` resolves the Cloudflare D1 binding, so importing it eagerly makes
 * this module unloadable outside the worker runtime - including in a test. The
 * import stays dynamic and the handle stays overridable, which is what lets the
 * publish lifecycle below be proven against a real database rather than
 * described by a source scan. Production passes nothing and gets the binding.
 */
async function resolveDb(database?: CmsDatabase): Promise<CmsDatabase> {
  if (database) return database;
  const { getDb } = await import("@/db");
  return getDb() as CmsDatabase;
}


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

/**
 * Which publication is the latest one.
 *
 * `created_at` is `YYYY-MM-DD HH:MM:SS` - one-second resolution, by the
 * timestamp contract, so that a defaulted write and an explicit one sort
 * together. Two publications inside the same second therefore tie, and the
 * tie-break used to be the row id, which is a random UUID: publishing and then
 * reverting within a second would leave whichever id happened to sort higher
 * as the live revision, and that could be the one the Owner just replaced.
 *
 * SQLite assigns `rowid` in insertion order, and every one of these tables
 * forbids deletion by trigger, so no rowid is ever reused. Ordering by it
 * breaks the tie by what actually happened rather than by a coin flip.
 */
async function publicationState(db: CmsDatabase, postId: string): Promise<PostPublicationState | null> {
  const latest = await db
    .select({ action: postPublicationEvents.action, revisionId: postPublicationEvents.revisionId })
    .from(postPublicationEvents)
    .where(eq(postPublicationEvents.postId, postId))
    .orderBy(desc(postPublicationEvents.createdAt), desc(sql`rowid`))
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

export async function listPosts(database?: CmsDatabase): Promise<PostSummary[]> {
  const db = await resolveDb(database);
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
    const publication = await publicationState(db, row.id);
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

export async function getPostEditorState(
  slug: string,
  database?: CmsDatabase,
): Promise<PostEditorState | null> {
  const db = await resolveDb(database);
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
    publication: await publicationState(db, post.id),
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

export async function getRevisionContent(
  postId: string,
  revisionId: string,
  database?: CmsDatabase,
): Promise<PostContent | null> {
  const db = await resolveDb(database);
  const row = await db
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
export async function getPublishedPost(slug: string, database?: CmsDatabase): Promise<StoredPost | null> {
  const db = await resolveDb(database);
  const post = await db.select({ id: posts.id, slug: posts.slug }).from(posts).where(eq(posts.slug, slug)).get();
  if (!post) return null;

  const publication = await publicationState(db, post.id);
  if (!publication || publication.action !== "PUBLISH" || !publication.revisionId || !publication.publishedAt) {
    return null;
  }

  const content = await getRevisionContent(post.id, publication.revisionId, db);
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
