import { desc, eq, notExists, sql } from "drizzle-orm";
import { postSlugHistory, posts } from "../db/schema.ts";
import type { CmsDatabase } from "./cms-database.ts";
import { postPath, validatePostRedirect, type PostRedirect } from "./public-cms/posts.ts";

/**
 * The redirect table the public site has always been able to serve and never
 * had.
 *
 * `resolvePostRedirect` resolves whole rename chains and refuses loops. This is
 * the only thing that feeds it, and two rules decide what it is allowed to say.
 *
 * A previous slug that is a live post again is excluded. That happens honestly
 * — a post renamed away and later renamed back, or a new post given the freed
 * slug — and a redirect from a URL that currently answers with real content
 * would take a visitor away from the page they asked for.
 *
 * Where a slug was abandoned more than once, the most recent row wins: the last
 * post to occupy that URL is the one whose move a visitor should follow. That
 * is decided in the query rather than by a unique constraint, so an Owner can
 * always rename a post again.
 */

/** More rename history than a marketing site accumulates in years. */
export const POST_REDIRECT_LIMIT = 500;

export async function listPostRedirects(
  db: CmsDatabase,
  limit = POST_REDIRECT_LIMIT,
): Promise<PostRedirect[]> {
  const bounded = Number.isInteger(limit) && limit > 0 ? Math.min(limit, POST_REDIRECT_LIMIT) : POST_REDIRECT_LIMIT;

  const rows = await db
    .select({ fromSlug: postSlugHistory.fromSlug, toSlug: postSlugHistory.toSlug })
    .from(postSlugHistory)
    // Index-backed anti-join against the unique post slug, not a scan of both
    // tables: an abandoned slug that is live again has no redirect to give.
    .where(
      notExists(
        db.select({ one: sql`1` }).from(posts).where(eq(posts.slug, postSlugHistory.fromSlug)),
      ),
    )
    .orderBy(desc(postSlugHistory.createdAt), desc(postSlugHistory.id))
    .limit(bounded)
    .all();

  const redirects: PostRedirect[] = [];
  const claimed = new Set<string>();
  for (const row of rows) {
    // Newest first, so the first row for a slug is the one that wins.
    if (claimed.has(row.fromSlug)) continue;
    claimed.add(row.fromSlug);
    const redirect = { from: postPath(row.fromSlug), to: postPath(row.toSlug) };
    // Checked with the public site's own validator rather than trusted. A row
    // that cannot be served safely is dropped here, where it is one missing
    // redirect, instead of on the apex where it would be an open redirect or a
    // loop.
    if (validatePostRedirect(redirect).length === 0) redirects.push(redirect);
  }
  return redirects;
}

/** Every slug this post has been served at, oldest first, for the editor. */
export async function listSlugHistoryForPost(
  db: CmsDatabase,
  postId: string,
): Promise<Array<{ fromSlug: string; toSlug: string; createdAt: string }>> {
  return db
    .select({
      fromSlug: postSlugHistory.fromSlug,
      toSlug: postSlugHistory.toSlug,
      createdAt: postSlugHistory.createdAt,
    })
    .from(postSlugHistory)
    .where(eq(postSlugHistory.postId, postId))
    .orderBy(postSlugHistory.createdAt, postSlugHistory.id)
    .limit(POST_REDIRECT_LIMIT)
    .all();
}
