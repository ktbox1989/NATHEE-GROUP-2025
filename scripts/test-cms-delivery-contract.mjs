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

// 5. The controls that change what the public sees are idempotent and
//    deliberate. The server already refuses a repeated request key; what a
//    hand-rolled form loses is the other half — an operator being told the
//    first click was received. A button that looks inert is why people click
//    twice, and a one-click unpublish takes a page away from every visitor
//    with no moment to reconsider.
const PUBLISH_SURFACES = [
  "app/app/site-content/[slug]/page.tsx",
  "app/app/site-settings/page.tsx",
  "app/app/posts/[slug]/page.tsx",
];
const PUBLISH_CONTROL = "components/publish-form.tsx";

for (const path of PUBLISH_SURFACES) {
  const source = await read(path);
  require(
    source.includes('from "@/components/publish-form"'),
    `${path}: publication must go through the shared control rather than a hand-rolled form`,
  );
  require(
    !/<form[^>]*publish/.test(source),
    `${path}: a hand-rolled publish form bypasses the double-submit guard`,
  );
  require(
    source.includes("requestKey:"),
    `${path}: every publication must carry a request key, or a repeat becomes a second event`,
  );
}

const publishControl = await read(PUBLISH_CONTROL);
require(
  publishControl.includes("disabled={busy}"),
  `${PUBLISH_CONTROL}: the control must refuse a second click before the first is answered`,
);
require(
  publishControl.includes("setBusy(true)"),
  `${PUBLISH_CONTROL}: the control must record that a submission is in flight`,
);
require(
  publishControl.indexOf("event.preventDefault()") < publishControl.indexOf("setBusy(true)"),
  `${PUBLISH_CONTROL}: disabling before the browser accepts the submission would cancel the request it was meant to send`,
);

// Unpublishing is explicit. Publishing is too, but it adds rather than removes.
for (const path of ["app/app/site-content/[slug]/page.tsx", "app/app/posts/[slug]/page.tsx"]) {
  const source = await read(path);
  const hide = source.indexOf('action: "HIDE"');
  require(
    hide >= 0 && source.slice(hide, hide + 900).includes("confirm="),
    `${path}: unpublishing must be confirmed rather than one click away`,
  );
}

// 6. One public media delivery contract, and a closed list of what has not
//    moved to it yet.
//
//    `/assets/media/…` is public by the shape of its path. `/api/gallery/images/`
//    is an authenticated route, which `lib/public-cms/contract.ts` refuses in a
//    payload outright. Two renderers still build the authenticated form: they
//    predate the delivery contract, they emit server-rendered HTML rather than a
//    validated payload, so nothing is violated today — and moving them depends
//    on every already-published gallery item having a jpeg or png display
//    variant, which the uploader only began guaranteeing in this cycle.
//
//    They are listed rather than tolerated. A new public surface cannot quietly
//    adopt the old strategy, and when the host mapping lands this list goes to
//    empty rather than being forgotten.
const LEGACY_AUTHENTICATED_MEDIA = [
  "components/cms-public-page.tsx",
  "components/gallery-lightbox.tsx",
];
const PUBLIC_MEDIA_SURFACES = [
  "app/news/page.tsx",
  "app/news/[slug]/page.tsx",
  "components/public-media-image.tsx",
  "lib/public-news.ts",
  "lib/public-news-content.ts",
  "lib/cms-public-route.ts",
];

for (const path of PUBLIC_MEDIA_SURFACES) {
  const source = await read(path);
  require(
    !source.includes("/api/gallery/images/"),
    `${path}: builds an authenticated media URL; public media is /assets/media/ and there is only one contract`,
  );
}
// The share card carries the universal raster. Several crawlers decode neither
// webp nor avif, and a card pointing at an image they cannot read is worse than
// a card with no image at all.
const publicRouteSource = await read("lib/cms-public-route.ts");
require(
  publicRouteSource.includes('variant.role === "display" && variant.format === "jpeg"'),
  "lib/cms-public-route.ts: a share image must be the jpeg display variant, not whichever variant sorts first",
);

for (const path of LEGACY_AUTHENTICATED_MEDIA) {
  const source = await read(path);
  require(
    source.includes("/api/gallery/images/"),
    `${path}: is listed as not yet migrated to the delivery contract but no longer uses the old form — remove it from LEGACY_AUTHENTICATED_MEDIA`,
  );
}

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
  `CMS_DELIVERY_CONTRACT_PASS managedPublicPages=${managedPublicPages} revalidation=per-request previewIndexable=false draftsInPublicTree=0 publishSurfaces=${PUBLISH_SURFACES.length} doubleSubmitGuarded=true unpublishConfirmed=true publicMediaContract=/assets/media legacyAuthenticatedMedia=${LEGACY_AUTHENTICATED_MEDIA.length}`,
);
