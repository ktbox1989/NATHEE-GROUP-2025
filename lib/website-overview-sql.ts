/**
 * What the Owner's "จัดการเว็บไซต์" screen is allowed to say, as SQL rather than
 * as a query builder call, so the same text that runs against D1 can be run
 * against the real migrated schema in a test.
 *
 * Every number on that screen is a count of rows. None of it is estimated,
 * rounded or carried forward from a previous render, because a content
 * dashboard exists to answer one question — what is actually live right now —
 * and a number that is nearly right answers it wrongly.
 *
 * The same rule decides "live" everywhere: the most recent publication event
 * wins, and a HIDE is an event rather than a deletion. The counts below are
 * therefore derived from the event history rather than from a status column
 * that could disagree with it.
 */

/**
 * Every managed page and what a reader is being served for it.
 *
 * A page with no publication event is not broken: the source-controlled default
 * is still being served, which is a real and valid state and is reported as
 * such rather than as "missing". The revision count says whether anyone has
 * ever edited it.
 */
export const SITE_PAGE_STATE_SQL = `
  SELECT
    p.slug            AS slug,
    latest.action     AS action,
    latest.created_at AS changed_at,
    (SELECT COUNT(*) FROM site_page_revisions WHERE page_id = p.id) AS revision_count
  FROM site_pages p
  LEFT JOIN site_page_publication_events latest
    ON latest.id = (
      SELECT id FROM site_page_publication_events
      WHERE page_id = p.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
  ORDER BY p.slug ASC
  LIMIT 50
`;

/** How many posts exist, and how many of them a reader can currently reach. */
export const POST_STATE_COUNTS_SQL = `
  SELECT
    COUNT(*)                                                        AS total,
    SUM(CASE WHEN latest.action = 'PUBLISH' THEN 1 ELSE 0 END)      AS published,
    SUM(CASE WHEN latest.action = 'HIDE' THEN 1 ELSE 0 END)         AS hidden
  FROM posts p
  LEFT JOIN post_publication_events latest
    ON latest.id = (
      SELECT id FROM post_publication_events
      WHERE post_id = p.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
`;

/**
 * The Media Library, split the way it matters to an Owner: what the public can
 * see, what is waiting to be reviewed, and how much of the library is
 * operational rather than public. That last number is why the split is here at
 * all — public marketing media and customer or internal evidence live in one
 * table, and a screen that reported a single total would invite someone to
 * publish the wrong half.
 */
export const GALLERY_STATE_COUNTS_SQL = `
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'PUBLISHED' AND visibility = 'PUBLIC' THEN 1 ELSE 0 END) AS public_published,
    SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS drafts,
    SUM(CASE WHEN status = 'PUBLISHED' AND visibility = 'PUBLIC' AND is_featured = 1 THEN 1 ELSE 0 END) AS featured,
    SUM(CASE WHEN visibility <> 'PUBLIC' THEN 1 ELSE 0 END) AS not_public
  FROM gallery_items
`;

/**
 * The shared header, footer and contact details.
 *
 * Written as three scalar subqueries so it returns exactly one row whether or
 * not settings have ever been published — a join would return no row at all in
 * the state the screen most needs to describe.
 */
export const SITE_SETTINGS_STATE_SQL = `
  SELECT
    (SELECT revision_id FROM site_settings_publication_events ORDER BY created_at DESC, id DESC LIMIT 1) AS revision_id,
    (SELECT created_at  FROM site_settings_publication_events ORDER BY created_at DESC, id DESC LIMIT 1) AS changed_at,
    (SELECT COUNT(*)    FROM site_settings_revisions) AS revision_count
`;
