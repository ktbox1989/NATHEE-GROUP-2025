/**
 * What the public /news/ index is allowed to read, as SQL rather than as a
 * query builder call, so the same text that runs against D1 can be run against
 * the real migrated schema in a test.
 *
 * The rule the index has to get right is "what is live", and it is the same
 * rule `lib/post-cms-store.ts` applies to a single post: the most recent
 * publication event wins. A post that was published and then hidden must not
 * appear, and a post whose latest event is a HIDE has a null `revision_id` by
 * CHECK constraint, so "latest event carries a revision" and "currently
 * published" are the same condition rather than two that have to agree.
 *
 * `published_at` is the *first* PUBLISH and `updated_at` the most recent one,
 * which is what `PublicPost` means by those fields. Ordering by the first
 * publication rather than by the latest event keeps a corrected typo from
 * throwing an old article back to the top of the news page.
 *
 * Which publication is the latest one is decided the same way
 * `lib/post-cms-store.ts` decides it for a single post: `created_at` has
 * one-second resolution by the timestamp contract, so two publications inside
 * the same second tie, and the tie-break is `rowid` — insertion order, never
 * reused because deletion is refused by trigger — rather than a random UUID.
 * The index and the article must not be able to disagree about which revision
 * is live: publishing and reverting inside one second would otherwise let the
 * index list a post the article answers 404 for.
 *
 * The listing tie-break is the slug, matching `comparePostsForList` in
 * `lib/public-cms/posts.ts`, so the runtime index and the statically built one
 * order a same-timestamp batch identically rather than each being internally
 * consistent and disagreeing with the other.
 *
 * Scale path: the index is bounded by LIMIT/OFFSET over editorial content, and
 * the offset stays small because the page is bounded too. If the archive ever
 * outgrows that, the replacement is a keyset cursor on
 * (first_published, posts.slug) — the same ordering, so no page changes shape.
 */

/** Posts whose most recent publication event is a PUBLISH, newest first. */
export const PUBLISHED_POSTS_INDEX_SQL = `
  SELECT
    p.slug              AS slug,
    r.id                AS revision_id,
    r.content_json      AS content_json,
    pub.first_published AS first_published,
    pub.last_published  AS last_published,
    pub.publish_count   AS publish_count
  FROM posts p
  JOIN (
    SELECT post_id,
           MIN(created_at) AS first_published,
           MAX(created_at) AS last_published,
           COUNT(*)        AS publish_count
    FROM post_publication_events
    WHERE action = 'PUBLISH'
    GROUP BY post_id
  ) pub ON pub.post_id = p.id
  JOIN post_publication_events latest
    ON latest.id = (
      SELECT id FROM post_publication_events
      WHERE post_id = p.id
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    )
  JOIN post_revisions r
    ON r.id = latest.revision_id AND r.post_id = p.id
  WHERE latest.action = 'PUBLISH'
  ORDER BY pub.first_published DESC, p.slug ASC
  LIMIT ? OFFSET ?
`;

/**
 * The same published selection for an opaque keyset cursor.
 *
 * The cursor carries the last row's first-publication timestamp and slug. A
 * timestamp can tie because publication events have one-second resolution, so
 * the slug is part of both the ORDER BY and the continuation predicate. The
 * query deliberately asks for a caller-supplied bound; the API requests one
 * extra row to decide whether a continuation exists.
 */
export const PUBLISHED_POSTS_CURSOR_SQL = `
  SELECT
    p.slug              AS slug,
    r.id                AS revision_id,
    r.content_json      AS content_json,
    pub.first_published AS first_published,
    pub.last_published  AS last_published,
    pub.publish_count   AS publish_count
  FROM posts p
  JOIN (
    SELECT post_id,
           MIN(created_at) AS first_published,
           MAX(created_at) AS last_published,
           COUNT(*)        AS publish_count
    FROM post_publication_events
    WHERE action = 'PUBLISH'
    GROUP BY post_id
  ) pub ON pub.post_id = p.id
  JOIN post_publication_events latest
    ON latest.id = (
      SELECT id FROM post_publication_events
      WHERE post_id = p.id
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    )
  JOIN post_revisions r
    ON r.id = latest.revision_id AND r.post_id = p.id
  WHERE latest.action = 'PUBLISH'
    AND (
      ? IS NULL
      OR pub.first_published < ?
      OR (pub.first_published = ? AND p.slug > ?)
    )
  ORDER BY pub.first_published DESC, p.slug ASC
  LIMIT ?
`;

/** How many posts the index has, for pagination that cannot overshoot. */
export const PUBLISHED_POSTS_COUNT_SQL = `
  SELECT COUNT(*) AS total
  FROM posts p
  JOIN post_publication_events latest
    ON latest.id = (
      SELECT id FROM post_publication_events
      WHERE post_id = p.id
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    )
  WHERE latest.action = 'PUBLISH'
`;

export function publishedPostsIndexParams(limit: number, offset: number): [number, number] {
  return [limit, offset];
}

export function publishedPostsCursorParams(
  limit: number,
  after: { publishedAt: string; slug: string } | null,
): [string | null, string | null, string | null, string | null, number] {
  return [
    after?.publishedAt ?? null,
    after?.publishedAt ?? null,
    after?.publishedAt ?? null,
    after?.slug ?? null,
    limit,
  ];
}
