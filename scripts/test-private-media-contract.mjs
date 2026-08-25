import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// R2 holds the things a customer would least like to see published: inspection
// and damage photographs of their vehicles, Proof of Delivery evidence,
// recipient signatures and quotation attachments.
//
// The bucket is private, so the only way those bytes reach a browser is through
// a route in this application. Two properties therefore carry the whole
// contract, and both are easy to lose in a refactor that looks harmless:
//
//  1. Every read and every write of an object is preceded by an authorization
//     decision in the same request.
//  2. A response carrying private bytes is never marked cacheable by a shared
//     cache. Getting that wrong publishes a customer's evidence to whoever asks
//     the CDN next, and nothing in the application would report a failure.

const root = process.env.PRIVATE_MEDIA_CONTRACT_ROOT
  ? resolve(process.env.PRIVATE_MEDIA_CONTRACT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (path) =>
  (await readFile(join(root, path), "utf8")).replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

/** Anything that establishes who is asking and whether they may have it. */
const AUTHORIZES =
  /\b(getCurrentActor|requireActor)\s*\(|\bcan\s*\(actor|\bactor\.role\s*!==\s*"OWNER"/;

/**
 * The readiness probe touches R2 on purpose and cannot require a session: it is
 * how an operator learns the binding works at all. It reads no object — it heads
 * a key that is never written — and returns a boolean, never bytes.
 */
const PROBE = {
  path: "app/api/health/route.ts",
  reason: "readiness probe; heads a non-existent key, returns a boolean, never object bytes",
};

/**
 * The one place an unauthenticated caller may write to storage: a member of the
 * public attaching a vehicle list to a quotation request. It is declared rather
 * than waved through, and the controls that stand in place of a session are
 * asserted — without them this is an open upload endpoint into the same bucket
 * that holds customer evidence.
 */
const PUBLIC_WRITERS = [
  {
    path: "app/api/quotation/route.ts",
    reason: "public quotation intake; guarded by same-origin, Turnstile, a bounded request and append-only storage",
    guards: [
      ["isSameOrigin(request)", "same-origin"],
      ["verifyTurnstile(", "anti-abuse challenge"],
      ["validateBoundedMultipartRequest(", "bounded request body"],
    ],
    mustNotRead: true,
  },
];

/**
 * The one place an object may leave without a session: CMS media the Owner has
 * deliberately published to the public website.
 *
 * A public website cannot ask a visitor to sign in for its photographs, so this
 * is a real requirement rather than a convenience. It is declared here instead
 * of being allowed to satisfy the generic rule by accident, because the generic
 * rule is the opposite one - private bytes, never shareable - and a route that
 * is exempt from it has to earn the exemption in writing.
 *
 * What stands in place of an authorization check is asserted, not described:
 * the decision is made in the query against the stored row, the identity served
 * is one the delivery contract can produce, and no session is consulted at all,
 * so the response cannot vary by viewer and is honestly cacheable.
 */
const PUBLIC_READERS = [
  {
    path: "app/assets/media/[itemId]/[variant]/route.ts",
    reason:
      "public CMS media delivery; serves only PUBLISHED and PUBLIC gallery rows, decided in the query, with no session consulted",
    guards: [
      ["parsePublicMediaPath(", "delivery-contract path parse"],
      ['eq(galleryItems.status, "PUBLISHED")', "published state decided in the query"],
      ['eq(galleryItems.visibility, "PUBLIC")', "public visibility decided in the query"],
    ],
    /**
     * A shareable response must not depend on who is asking. Resolving an actor
     * here would make one, and a shared cache would then hand the first
     * viewer's answer to everyone behind it.
     */
    forbidden: [
      ["getCurrentActor", "a session reader"],
      ["requireActor", "a session reader"],
    ],
    /**
     * `ORIGINAL` is the untouched upload, with whatever the camera recorded in
     * it. The delivery contract gives it no public role, and this proves the
     * route never reaches for it by name either.
     */
    mustNotServeOriginal: true,
  },
];

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
    else if (/\.tsx?$/.test(entry.name)) files.push(child);
  }
  return files;
}

const sources = (await Promise.all([walk("app"), walk("lib")]))
  .flat()
  .map((path) => path.split(sep).join("/"))
  .sort();
require(sources.length > 0, "no sources were found; the scan is misconfigured");

let readers = 0;
let writers = 0;
let publicReaders = 0;
let probeSeen = false;

for (const path of sources) {
  const source = await read(path);
  const reads = source.includes("env.FILES.get(");
  const writes = source.includes("env.FILES.put(") || source.includes("env.FILES.delete(");
  const heads = source.includes("env.FILES.head(");
  if (!reads && !writes && !heads) continue;

  if (path === PROBE.path) {
    probeSeen = true;
    require(Boolean(PROBE.reason.trim()), `${PROBE.path}: the probe exemption has no stated reason`);
    require(
      !reads && !writes,
      `${PROBE.path}: the readiness probe may only head a key, never read or write an object`,
    );
    continue;
  }

  const publicReader = PUBLIC_READERS.find((entry) => entry.path === path);
  if (publicReader) {
    require(Boolean(publicReader.reason.trim()), `${path}: the public-reader exemption has no stated reason`);
    for (const [needle, label] of publicReader.guards) {
      require(source.includes(needle), `${path}: public read is missing its ${label} guard`);
    }
    for (const [needle, label] of publicReader.forbidden) {
      require(!source.includes(needle), `${path}: a cacheable public response must not consult ${label}`);
    }
    require(
      !publicReader.mustNotServeOriginal || !source.includes('"ORIGINAL"'),
      `${path}: the untouched original upload must have no public delivery path`,
    );
    require(
      !source.includes("env.FILES.put(") && !source.includes("env.FILES.delete("),
      `${path}: a public delivery route must never write or remove an object`,
    );
    publicReaders += 1;
    continue;
  }

  const publicWriter = PUBLIC_WRITERS.find((entry) => entry.path === path);
  if (publicWriter) {
    require(Boolean(publicWriter.reason.trim()), `${path}: the public-writer exemption has no stated reason`);
    for (const [needle, label] of publicWriter.guards) {
      require(source.includes(needle), `${path}: public write is missing its ${label} guard`);
    }
    require(
      !publicWriter.mustNotRead || !reads,
      `${path}: an unauthenticated route may write an attachment but must never read one back`,
    );
    writers += 1;
    continue;
  }

  require(
    AUTHORIZES.test(source),
    `${path}: touches private storage with no authorization decision in the same request`,
  );
  if (reads) readers += 1;
  if (writes) writers += 1;

  // 2. A response carrying object bytes must not be shareable unless the route
  //    proves the object is public first.
  if (!reads) continue;
  const marksPublic = source.includes('"public, max-age') || source.includes("public, max-age");
  const marksPrivate = source.includes('"private, no-store"');
  require(
    marksPrivate,
    `${path}: a response carrying object bytes must declare 'private, no-store'`,
  );
  if (marksPublic) {
    // The only acceptable shape: the public marking is conditional on a proven
    // public state, and the private marking is the alternative.
    require(
      source.includes("isPublic ?") || source.includes("isPublic\n"),
      `${path}: a shareable cache header must be conditional on a proven public state`,
    );
    require(
      source.includes('item.status === "PUBLISHED"') && source.includes('item.visibility === "PUBLIC"'),
      `${path}: 'public' must mean PUBLISHED and PUBLIC, decided from the stored row`,
    );
  }
}

require(probeSeen, `${PROBE.path}: the readiness probe no longer touches storage; the exemption is stale`);
for (const entry of PUBLIC_READERS) {
  const source = await read(entry.path).catch(() => "");
  require(
    source.includes("env.FILES.get("),
    `${entry.path}: declared as a public reader but no longer reads storage; the exemption is stale`,
  );
}
for (const entry of PUBLIC_WRITERS) {
  const source = await read(entry.path).catch(() => "");
  require(
    source.includes("env.FILES.put(") || source.includes("env.FILES.delete("),
    `${entry.path}: declared as a public writer but no longer writes storage; the exemption is stale`,
  );
}
require(readers >= 4, `expected the private media read routes, found ${readers}`);
require(writers >= 3, `expected the media write routes, found ${writers}`);

// 3. A storage key is internal layout. Handing one to a browser tells an
//    attacker how the bucket is organised and what to ask a misconfigured
//    bucket for.
for (const path of sources) {
  const source = await read(path);
  if (!source.includes("storageKey")) continue;
  require(
    !/NextResponse\.json\([^)]*storageKey/s.test(source) && !/Response\.json\([^)]*storageKey/s.test(source),
    `${path}: a storage key must not be returned to the client`,
  );
}

// 4. The bucket binding itself must stay declared as private infrastructure.
const hosting = JSON.parse(await read(".openai/hosting.json"));
require(hosting.r2 === "FILES", ".openai/hosting.json: the private bucket binding must remain FILES");

const architecture = await read("docs/DEPLOYMENT_ARCHITECTURE.md");
require(
  /R2/.test(architecture) && /private/i.test(architecture),
  "docs/DEPLOYMENT_ARCHITECTURE.md: the private storage requirement must stay documented",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`PRIVATE_MEDIA_CONTRACT_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `PRIVATE_MEDIA_CONTRACT_PASS readRoutes=${readers} writeRoutes=${writers} probeExempt=1 declaredPublicWriters=${PUBLIC_WRITERS.length} declaredPublicReaders=${publicReaders} sharedCacheOnPrivateBytes=0`,
);
