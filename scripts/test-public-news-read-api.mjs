import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.PUBLIC_NEWS_READ_API_ROOT
  ? resolve(process.env.PUBLIC_NEWS_READ_API_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (path) => (await readFile(join(root, path), "utf8")).split("\r\n").join("\n");
const failures = [];
const require = (condition, message) => { if (!condition) failures.push(message); };

const LIST_ROUTE = "app/api/public/v1/news/route.ts";
const DETAIL_ROUTE = "app/api/public/v1/news/[slug]/route.ts";
const CONTRACT = "lib/public-news-api-contract.ts";
const SERVICE = "lib/public-news-api-service.ts";
const SELECTION = "lib/public-news-selection.ts";
const SQL = "lib/public-news-sql.ts";
const SITEMAP = "app/sitemap.xml/route.ts";
const DOC = "docs/PUBLIC_NEWS_READ_API.md";

const [listRoute, detailRoute, contract, service, selection, sql, sitemap, doc] = await Promise.all(
  [LIST_ROUTE, DETAIL_ROUTE, CONTRACT, SERVICE, SELECTION, SQL, SITEMAP, DOC].map(read),
);

for (const [path, route] of [[LIST_ROUTE, listRoute], [DETAIL_ROUTE, detailRoute]]) {
  require(route.includes('export const dynamic = "force-dynamic"'), `${path}: must resolve current publication state per request`);
  require(/export async function GET\b/.test(route), `${path}: GET is absent`);
  require(/export async function HEAD\b/.test(route), `${path}: HEAD is absent`);
  require(!/export async function (POST|PUT|PATCH|DELETE)\b/.test(route), `${path}: public read API gained a mutation handler`);
  for (const forbidden of ["requireActor(", "getCurrentActor(", "Authorization", "Cookie", "preview", "postRevisions"]) {
    require(!route.includes(forbidden), `${path}: public data selection depends on ${forbidden}`);
  }
}

require(contract.includes("PUBLIC_NEWS_API_VERSION = 1"), `${CONTRACT}: version 1 is not explicit`);
require(contract.includes("PUBLIC_NEWS_DEFAULT_LIMIT = 20"), `${CONTRACT}: default limit must be 20`);
require(contract.includes("PUBLIC_NEWS_MAX_LIMIT = 50"), `${CONTRACT}: maximum limit must be 50`);
require(contract.includes("limit <= PUBLIC_NEWS_MAX_LIMIT"), `${CONTRACT}: caller limit is not bounded`);
require(contract.includes("decodePublicNewsCursor("), `${CONTRACT}: cursor is not decoded and validated`);
require(contract.includes("isValidPostSlug(slug)"), `${CONTRACT}: detail slug is not validated by the canonical rule`);
require(contract.includes("public, max-age=0, s-maxage=60, stale-while-revalidate=300"), `${CONTRACT}: bounded shared-cache policy is absent`);
require(contract.includes('"private, no-store"'), `${CONTRACT}: errors are cacheable`);
require(contract.includes('"method_not_allowed"'), `${CONTRACT}: mutation refusal is absent`);
require(contract.includes('"GET, HEAD"'), `${CONTRACT}: allowed methods drifted`);
require(!contract.includes("revisionId:"), `${CONTRACT}: response exposes a revision id`);
require(!contract.includes("storageKey"), `${CONTRACT}: response exposes a storage key`);
for (const header of ["Authorization", "Cookie"]) {
  require(!contract.includes(`headers.get("${header}")`), `${CONTRACT}: ${header} changes public selection`);
}

require(service.includes("loadPublishedNewsSelection("), `${SERVICE}: list bypasses the shared published selection`);
require(service.includes("getPublishedPost("), `${SERVICE}: detail bypasses the canonical publication lifecycle`);
require(service.includes("resolvePublicMedia("), `${SERVICE}: public media is not resolved by the PUBLISHED + PUBLIC store`);
require(service.includes("mapStoredPostToPublicPost("), `${SERVICE}: stored content bypasses the public CMS validator`);
for (const forbidden of ["getDraft", "getPreview", "postRevisions", "storageKey", "requireActor", "getCurrentActor"]) {
  require(!service.includes(forbidden), `${SERVICE}: public service references forbidden ${forbidden}`);
}

require(selection.includes("PUBLISHED_POSTS_CURSOR_SQL"), `${SELECTION}: shared loader does not use the cursor query`);
require(selection.includes("options.limit > 501"), `${SELECTION}: shared loader is unbounded`);
require(sql.includes("PUBLISHED_POSTS_CURSOR_SQL"), `${SQL}: cursor query is absent`);
require(
  sql.split("WHERE latest.action = 'PUBLISH'").length - 1 === 3,
  `${SQL}: every offset, cursor and count selection must require the latest PUBLISH`,
);
require(sql.includes("ORDER BY created_at DESC, rowid DESC"), `${SQL}: latest lifecycle event is not selected deterministically`);
require(sql.includes("pub.first_published DESC, p.slug ASC"), `${SQL}: cursor ordering lacks its deterministic tie-break`);
require(sql.includes("LIMIT ?"), `${SQL}: cursor query is unbounded`);

require(sitemap.includes("loadPublishedNewsSelection("), `${SITEMAP}: sitemap duplicates or bypasses the API published selection`);
require(!sitemap.includes("PUBLISHED_POSTS_INDEX_SQL"), `${SITEMAP}: sitemap still owns a second SQL selection path`);
require(doc.includes("CUSTOM_OWNER_ONLY"), `${DOC}: current Sites reachability constraint is undocumented`);
require(doc.includes("stale-while-revalidate=300"), `${DOC}: worst-case cache staleness is undocumented`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`PUBLIC_NEWS_READ_API_FAIL ${failure}`);
  process.exit(1);
}

console.log("PUBLIC_NEWS_READ_API_PASS version=1 methods=GET,HEAD defaultLimit=20 maxLimit=50 selection=latest-publish sitemap=shared");
