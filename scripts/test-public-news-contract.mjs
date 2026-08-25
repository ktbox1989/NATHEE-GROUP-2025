import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The Owner could write, preview, publish and unpublish a post before /news/
// existed, and none of it reached a reader. Now that it does, the same
// properties the managed pages are held to have to hold for posts, and three of
// them are the kind that fail quietly:
//
//  1. A publish reaches the live page on the next request, so the index and the
//     article resolve per request rather than from a cache nothing invalidates.
//  2. Unpublishing actually unpublishes. A hidden post must have no
//     representation on the public side at all, not a 200 with an empty body.
//  3. The editor's NOINDEX choice is the editor's. A route that hardcodes
//     index:true publishes something the Owner asked to keep out of search.
//
// Plus the rule that outranks all three: nothing on the public side reads a
// revision. Preview is the one place a draft renders and it lives behind
// authentication in the protected tree.

const root = process.env.PUBLIC_NEWS_CONTRACT_ROOT
  ? resolve(process.env.PUBLIC_NEWS_CONTRACT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
// .ts and .tsx are not pinned in .gitattributes, so a Windows checkout carries
// CRLF. Every assertion below is written with "\n"; normalising here keeps the
// gate from quietly weakening depending on where it runs.
const read = async (path) => (await readFile(join(root, path), "utf8")).split("\r\n").join("\n");
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

const INDEX_ROUTE = "app/news/page.tsx";
const ARTICLE_ROUTE = "app/news/[slug]/page.tsx";
const READER = "lib/public-news.ts";
const CONTENT = "lib/public-news-content.ts";
const SQL = "lib/public-news-sql.ts";
const DYNAMIC_DIRECTIVE = 'export const dynamic = "force-dynamic"';

const [indexRoute, articleRoute, reader, content, sql] = await Promise.all([
  read(INDEX_ROUTE),
  read(ARTICLE_ROUTE),
  read(READER),
  read(CONTENT),
  read(SQL),
]);

// 1. Both public news surfaces resolve per request.
for (const [path, source] of [[INDEX_ROUTE, indexRoute], [ARTICLE_ROUTE, articleRoute]]) {
  require(
    source.includes(DYNAMIC_DIRECTIVE),
    `${path}: renders published posts without '${DYNAMIC_DIRECTIVE}', so a publish would not take effect`,
  );
}

// 2. Neither route touches a revision or the post tables directly; both go
//    through the reader, which is the only thing that decides what is live.
for (const [path, source] of [[INDEX_ROUTE, indexRoute], [ARTICLE_ROUTE, articleRoute]]) {
  for (const forbidden of ["postRevisions", "post_revisions", "postPublicationEvents", "@/db/schema"]) {
    require(
      !source.includes(forbidden),
      `${path}: reads ${forbidden} directly, which is how an unpublished draft reaches the public`,
    );
  }
  require(
    source.includes("readPublishedNewsIndex(") || source.includes("readPublishedNewsArticle("),
    `${path}: must read posts through the published-state reader`,
  );
}

// 3. What is live is the most recent publication event, and a HIDE wins.
require(
  sql.includes("ORDER BY created_at DESC, id DESC"),
  `${SQL}: the live revision must be the most recent publication event`,
);
// Both the listing and the count must agree on it. A count that still
// includes hidden posts paginates readers into empty pages.
require(
  sql.split("WHERE latest.action = 'PUBLISH'").length - 1 === 2,
  `${SQL}: the index and its count must both require the most recent event to be a PUBLISH, so a hidden post disappears`,
);
require(
  sql.includes("MIN(created_at) AS first_published"),
  `${SQL}: publishedAt must be the first publication, so a correction does not re-date the article`,
);
require(
  reader.includes("getPublishedPost("),
  `${READER}: one article must be read through the published-state helper rather than re-deriving it`,
);

// 4. The reader fails closed. An unreachable database is an honest empty state
//    and a 404, never a stack trace on a URL a search engine holds.
require(
  /catch\s*\{[\s\S]*unavailable:\s*true/.test(reader),
  `${READER}: the index must report an outage as unavailable rather than as an empty archive`,
);
require(
  /catch\s*\{[\s\S]*return null/.test(reader),
  `${READER}: one article must fail closed to a 404 rather than throwing`,
);
require(
  indexRoute.includes("index.unavailable"),
  `${INDEX_ROUTE}: an outage and an empty archive must not render the same message`,
);
require(
  articleRoute.includes("notFound()"),
  `${ARTICLE_ROUTE}: a post that is not published must 404 rather than render`,
);

// 5. The editor decides indexing, not the route.
require(
  articleRoute.includes('article.seo.robots === "INDEX"'),
  `${ARTICLE_ROUTE}: indexing must follow the post's own robots field`,
);
require(
  articleRoute.includes("index: indexable, follow: indexable"),
  `${ARTICLE_ROUTE}: a NOINDEX post must not be published to search anyway`,
);
// Present only when there was an edit, and never defaulted to the publication
// date: telling a search engine an article was revised when it was not is a
// claim about the content, not a formatting detail.
for (const field of ["modifiedTime", "dateModified"]) {
  require(
    articleRoute.includes(`...(article.updatedAt ? { ${field}: article.updatedAt } : {})`),
    `${ARTICLE_ROUTE}: ${field} must be emitted only when the post has actually been edited`,
  );
  for (const fallback of [`${field}: article.updatedAt ??`, `${field}: article.publishedAt`]) {
    require(
      !articleRoute.includes(fallback),
      `${ARTICLE_ROUTE}: ${field} must not fall back to the publication date`,
    );
  }
}

// 6. Media reaches a reader only through the route that checks whether it may
//    be seen. A storage key or a bare bucket path here is a privacy incident,
//    not a broken image.
require(
  content.includes("/api/gallery/images/") && content.includes("encodeURIComponent(id)"),
  `${CONTENT}: media must be served through the authorization-aware image route`,
);
for (const [path, source] of [[INDEX_ROUTE, indexRoute], [ARTICLE_ROUTE, articleRoute], [READER, reader], [CONTENT, content]]) {
  for (const forbidden of ["storageKey", "storage_key", "env.FILES"]) {
    require(!source.includes(forbidden), `${path}: references ${forbidden}, which is private storage the public must not address`);
  }
}
require(
  reader.includes('eq(galleryItems.status, "PUBLISHED")') && reader.includes('eq(galleryItems.visibility, "PUBLIC")'),
  `${READER}: only a published, public gallery item may appear on a post`,
);

// 7. The index is bounded. An unbounded page number becomes an unbounded
//    OFFSET, and an unbounded page size becomes a full scan per request.
require(content.includes("MAX_NEWS_PAGE"), `${CONTENT}: the page number must be bounded`);
require(
  reader.includes("MAX_NEWS_PAGE") && reader.includes("POSTS_PAGE_SIZE"),
  `${READER}: the index must be bounded by both a page size and a page bound`,
);
require(sql.includes("LIMIT ? OFFSET ?"), `${SQL}: the index must be paginated in SQL rather than in memory`);

// 8. Every image the site renders carries the two attributes that keep the page
//    from reflowing as photographs arrive, and the alt text the gallery stored.
for (const [path, source] of [[INDEX_ROUTE, indexRoute], [ARTICLE_ROUTE, articleRoute]]) {
  for (const match of source.matchAll(/<img\b[\s\S]*?\/>/g)) {
    for (const attribute of ["alt=", "width=", "height=", "sizes="]) {
      require(match[0].includes(attribute), `${path}: an image is missing ${attribute}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`PUBLIC_NEWS_CONTRACT_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  "PUBLIC_NEWS_CONTRACT_PASS routes=2 revalidation=per-request draftsInPublicTree=0 robots=editor-controlled media=authorization-aware",
);
