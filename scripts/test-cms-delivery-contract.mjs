import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Publish is only meaningful if two things hold, and both are currently true by
// habit rather than by rule.
//
// A public page that renders managed content must be dynamic. If one were
// cached, an editor would publish, see the editor say "published", and the live
// page would keep serving the previous revision — with nothing anywhere
// reporting a failure. That is the revalidation contract: there is no cache to
// invalidate because the page is resolved per request.
//
// And nothing outside the protected tree may read a revision directly. The
// public tree resolves content only through the published-state helpers, so a
// draft has no path to an anonymous reader. Preview is the deliberate exception,
// and it lives behind authentication and a noindex directive.

const root = process.env.CMS_DELIVERY_CONTRACT_ROOT
  ? resolve(process.env.CMS_DELIVERY_CONTRACT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

const PROTECTED_TREES = ["app/app", "app/api", "app/portal"];
const PREVIEW_ROUTE = "app/app/site-content/[slug]/preview/page.tsx";
const APPLICATION_LAYOUT = "app/app/layout.tsx";

/** Managed content reaches a reader through exactly these. */
const PUBLISHED_STATE_HELPERS = ["getManagedPageContent", "getManagedPageMetadata", "getPublishedSitePage"];
const DYNAMIC_DIRECTIVE = 'export const dynamic = "force-dynamic"';

async function walk(directory) {
  const absolute = join(root, directory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (/^(page\.tsx|route\.ts|layout\.tsx)$/.test(entry.name)) files.push(child);
  }
  return files;
}

const surfaces = (await walk("app")).map((path) => path.split(sep).join("/")).sort();
require(surfaces.length > 0, "no routes were found; the scan is misconfigured");

const isProtected = (path) => PROTECTED_TREES.some((tree) => path.startsWith(`${tree}/`));

// 1. A public page rendering managed content must resolve it per request.
let managedPublicPages = 0;
for (const path of surfaces) {
  if (isProtected(path)) continue;
  const source = await read(path);
  const rendersManaged = PUBLISHED_STATE_HELPERS.some((helper) => source.includes(`${helper}(`));
  if (!rendersManaged) continue;
  managedPublicPages += 1;
  require(
    source.includes(DYNAMIC_DIRECTIVE),
    `${path}: renders managed content without '${DYNAMIC_DIRECTIVE}', so a publish would not take effect`,
  );
}
require(managedPublicPages >= 9, `expected the managed public pages, found ${managedPublicPages}`);

// 2. No public surface may read a revision, published or otherwise.
for (const path of surfaces) {
  if (isProtected(path)) continue;
  const source = await read(path);
  require(
    !source.includes("sitePageRevisions"),
    `${path}: reads revisions directly, which is how an unpublished draft reaches the public`,
  );
  require(
    !source.includes("siteSettingsRevisions"),
    `${path}: reads settings revisions directly instead of the published state`,
  );
}

// 3. The published-state helper is the only thing that decides what is public.
const cmsPublicRoute = await read("lib/cms-public-route.ts");
require(
  cmsPublicRoute.includes('state.status === "PUBLISHED"'),
  "lib/cms-public-route.ts: content must be served only when the page is published",
);
require(
  cmsPublicRoute.includes('state.status === "HIDDEN"'),
  "lib/cms-public-route.ts: a hidden page must resolve to nothing rather than to a default",
);
const siteCms = await read("lib/site-cms.ts");
require(
  siteCms.includes("desc(sitePagePublicationEvents.createdAt)"),
  "lib/site-cms.ts: the live revision must be the most recent publication event",
);
require(
  siteCms.includes('event.action === "HIDE"'),
  "lib/site-cms.ts: a hide event must win when it is the most recent",
);

// 4. Preview is the one place a draft is rendered, and it is private.
const layout = await read(APPLICATION_LAYOUT);
require(
  /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/.test(layout),
  `${APPLICATION_LAYOUT}: the protected tree must declare index:false, follow:false so a draft is never indexed`,
);
require(layout.includes(DYNAMIC_DIRECTIVE), `${APPLICATION_LAYOUT}: the protected tree must resolve per request`);

const preview = await read(PREVIEW_ROUTE);
require(preview.includes("requireActor("), `${PREVIEW_ROUTE}: preview must require an authenticated actor`);
require(preview.includes('can(actor, "site:read")'), `${PREVIEW_ROUTE}: preview must require the site read capability`);
require(
  preview.includes("preview />") || preview.includes("preview={true}"),
  `${PREVIEW_ROUTE}: preview must render with the draft banner, so it is never mistaken for the live page`,
);
require(
  preview.includes("eq(sitePageRevisions.pageId, page.id)"),
  `${PREVIEW_ROUTE}: a revision must be scoped to its own page, or one page can preview another's draft`,
);

const renderer = await read("components/cms-public-page.tsx");
require(
  renderer.includes("preview &&") && renderer.includes("ยังไม่เผยแพร่"),
  "components/cms-public-page.tsx: a preview must be visibly marked as an unpublished draft",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`CMS_DELIVERY_CONTRACT_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `CMS_DELIVERY_CONTRACT_PASS managedPublicPages=${managedPublicPages} revalidation=per-request previewIndexable=false draftsInPublicTree=0`,
);
