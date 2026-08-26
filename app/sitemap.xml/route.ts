import { getD1 } from "@/db";
import { parsePostContentJson } from "@/lib/post-cms-content";
import { loadPublishedNewsSelection } from "@/lib/public-news-selection";
import {
  buildSitemapPaths,
  renderSitemapXml,
  sitemapPathForSlug,
  type SitemapPage,
  type SitemapPost,
} from "@/lib/public-sitemap";
import { SITE_PAGE_DEFINITIONS, type SitePageSlug } from "@/lib/site-cms-content";
import { getPublishedSitePage } from "@/lib/site-cms";

/**
 * The canonical sitemap.
 *
 * Resolved per request, for the same reason every managed public page is: a
 * publish must be visible on the next request, and there is no cache here to
 * invalidate. A sitemap is the one surface where staleness is invisible — it
 * keeps advertising withdrawn URLs and hiding new ones, and nothing reports a
 * failure — so it is never generated ahead of time.
 */
export const dynamic = "force-dynamic";

/** More posts than a marketing site's archive holds, and a bound either way. */
const MAX_SITEMAP_POSTS = 500;

async function readPages(): Promise<SitemapPage[]> {
  const slugs = Object.keys(SITE_PAGE_DEFINITIONS) as SitePageSlug[];
  const states = await Promise.all(slugs.map((slug) => getPublishedSitePage(slug)));

  const pages: SitemapPage[] = [];
  slugs.forEach((slug, index) => {
    const path = sitemapPathForSlug(slug);
    if (!path) return;
    const state = states[index];
    // HIDDEN is the only state a reader cannot reach. UNMANAGED means the
    // source-controlled default is being served, which is a live page, and its
    // default robots is INDEX.
    if (state.status === "HIDDEN") return;
    pages.push({
      path,
      reachable: true,
      robots: state.status === "PUBLISHED" ? state.content.seo.robots : "INDEX",
    });
  });
  return pages;
}

async function readPosts(): Promise<SitemapPost[]> {
  const { rows } = await loadPublishedNewsSelection(getD1(), { limit: MAX_SITEMAP_POSTS });

  const posts: SitemapPost[] = [];
  for (const row of rows) {
    if (typeof row.slug !== "string" || typeof row.content_json !== "string") continue;
    const content = parsePostContentJson(row.content_json);
    // A revision that no longer parses is not listed. It is also not rendered,
    // so listing it would advertise a URL that answers with nothing.
    if (!content) continue;
    posts.push({ slug: row.slug, robots: content.seo.robots });
  }
  return posts;
}

export async function GET(): Promise<Response> {
  let paths: string[];
  try {
    const [pages, posts] = await Promise.all([readPages(), readPosts()]);
    paths = buildSitemapPaths(pages, posts);
  } catch {
    // An unreadable database must not produce an empty sitemap: submitting one
    // tells a crawler the site has no pages, which is a far more damaging claim
    // than a temporary error. The eleven marketing routes are always live, so
    // they are the honest floor.
    paths = buildSitemapPaths(
      (Object.keys(SITE_PAGE_DEFINITIONS) as SitePageSlug[])
        .map((slug) => sitemapPathForSlug(slug))
        .filter((path): path is NonNullable<typeof path> => path !== null)
        .map((path) => ({ path, reachable: true, robots: "INDEX" as const })),
      [],
    );
  }

  return new Response(renderSitemapXml(paths), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Short and revalidating, for the same reason the static release marks
      // its own sitemap that way: a publish changes this document, and a cache
      // that invented its own lifetime would keep serving the previous one.
      "Cache-Control": "public, max-age=300, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
