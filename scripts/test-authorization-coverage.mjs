import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Server-side authorization currently holds on every protected surface, and it
// holds because someone checked each one by hand. That is not a property a
// codebase keeps: the next route added under app/api is authorized only if its
// author remembers. This turns the hand check into a build failure.
//
// A surface passes by resolving the actor *and* making a decision with it.
// Resolving alone is identification, not authorization — it would let any signed
// -in customer read another company's records. Being public is allowed, but only
// as a declared entry with a stated reason, so it is a reviewed decision rather
// than an omission.

const root = process.env.AUTHORIZATION_COVERAGE_ROOT
  ? resolve(process.env.AUTHORIZATION_COVERAGE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

/**
 * Directories whose every server surface must be authorized.
 *
 * `app/assets` is here even though the name says otherwise. Public CMS media is
 * served from a path under `/assets/` rather than under `/api/`, because Lane
 * A's public contract refuses authenticated prefixes outright — so the one
 * route that hands out object bytes without a session lives outside the three
 * trees this gate used to scan. Leaving it unscanned would have made "every
 * server surface is authorized" true only of the surfaces the gate happened to
 * look at.
 */
const PROTECTED_TREES = ["app/api", "app/app", "app/portal", "app/assets"];

/** Resolving the acting user from the session. */
const RESOLVES_ACTOR = /\b(requireActor|getCurrentActor)\s*\(/;

/**
 * Using that actor to decide. `actor.userId` and `actor.companyId` count because
 * scoping a query to the actor's own records is the decision for those surfaces.
 */
const MAKES_DECISION =
  /\b(assertCan|can|isInternalRole|isCustomerRole)\s*\(|\bactor\.(role|companyId|userId)\b/;

const MUTATING_HANDLER = /^export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/m;
const SAME_ORIGIN = /\bisSameOrigin\s*\(\s*request\s*\)/;

/**
 * Helpers that carry the whole authorization decision for their callers. Each is
 * verified below, so delegating is not a way to escape the requirement.
 */
const AUTHORIZATION_DELEGATES = [
  {
    module: "lib/operational-qr-route.ts",
    specifier: "@/lib/operational-qr-route",
    reason:
      "Resolves the actor and enforces company scope and permission for every operational QR entity.",
  },
];

/**
 * Surfaces an unauthenticated caller is meant to reach. Each states what stands
 * in place of an authorization check.
 */
const PUBLIC_SURFACES = [
  {
    path: "app/api/auth/login/route.ts",
    reason: "Establishes a session. Guarded by same-origin and the login attempt budgets.",
  },
  {
    path: "app/api/auth/owner-pin/login/route.ts",
    reason:
      "Establishes the Owner's session from a PIN. Guarded by same-origin, the same login attempt budgets as the password door, and an account that is a server constant rather than anything the caller names.",
  },
  {
    path: "app/api/auth/logout/route.ts",
    reason: "Ends a session. Guarded by same-origin; ending a session it does not have is a no-op.",
  },
  {
    path: "app/api/auth/forgot-password/route.ts",
    reason:
      "Sends a recovery link. Guarded by same-origin, the recovery budgets, and a reply that reveals nothing.",
  },
  {
    path: "app/api/auth/update-password/route.ts",
    reason:
      "Completes a recovery. Guarded by same-origin and by requiring a recovery grant or the current password.",
  },
  {
    path: "app/api/health/route.ts",
    reason: "Runtime readiness probe. Read-only, reports no record and no configured value.",
  },
  {
    path: "app/api/quotation/route.ts",
    reason:
      "Public quotation intake. Guarded by same-origin, Turnstile, bounded multipart and append-only storage.",
  },
  {
    path: "app/api/public/v1/news/route.ts",
    reason:
      "Anonymous read-only News index. The shared selection requires the latest publication event to be PUBLISH, the response passes through the public CMS and media validators, and the route exports only GET and HEAD.",
  },
  {
    path: "app/api/public/v1/news/[slug]/route.ts",
    reason:
      "Anonymous read-only News detail. Strict slugs resolve through getPublishedPost and the validated public CMS/media mapper; unpublished content is represented only as 404.",
  },
  {
    path: "app/assets/media/[itemId]/[variant]/route.ts",
    reason:
      "Public CMS media delivery. A visitor cannot sign in for a marketing photograph; what stands in place of a session is that only PUBLISHED and PUBLIC gallery rows match the query, the served identity is one the delivery contract can produce, and the untouched original has no public role. Asserted in scripts/test-private-media-contract.mjs.",
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
    else if (/^(route\.ts|page\.tsx|layout\.tsx)$/.test(entry.name)) files.push(child);
  }
  return files;
}

function normalize(path) {
  return path.split(sep).join("/");
}

// 1. Every declared delegate must actually carry the decision it claims to.
const delegateSpecifiers = new Set();
for (const delegate of AUTHORIZATION_DELEGATES) {
  let source = "";
  try {
    source = await read(delegate.module);
  } catch {
    require(false, `${delegate.module}: declared authorization delegate does not exist`);
    continue;
  }
  require(RESOLVES_ACTOR.test(source), `${delegate.module}: delegate never resolves an actor`);
  require(MAKES_DECISION.test(source), `${delegate.module}: delegate never decides with the actor`);
  require(Boolean(delegate.reason?.trim()), `${delegate.module}: delegate has no stated reason`);
  delegateSpecifiers.add(delegate.specifier);
}

const publicByPath = new Map(PUBLIC_SURFACES.map((entry) => [entry.path, entry]));
const surfaces = (await Promise.all(PROTECTED_TREES.map(walk))).flat().map(normalize).sort();
require(surfaces.length > 0, "no server surfaces were found; the scan is misconfigured");

const seenPublic = new Set();
let authorized = 0;

for (const path of surfaces) {
  const source = await read(path);
  const declaredPublic = publicByPath.get(path);

  // 2. Every mutating handler is a state change and needs the same-origin check,
  //    public or not; a session cookie travels with a cross-site form post.
  if (MUTATING_HANDLER.test(source)) {
    require(SAME_ORIGIN.test(source), `${path}: mutating handler does not check same-origin`);
  }

  if (declaredPublic) {
    seenPublic.add(path);
    require(Boolean(declaredPublic.reason?.trim()), `${path}: public surface has no stated reason`);
    continue;
  }

  const delegated = [...delegateSpecifiers].some((specifier) => source.includes(`"${specifier}"`));
  require(
    RESOLVES_ACTOR.test(source) || delegated,
    `${path}: protected surface never resolves an actor and declares no delegate`,
  );
  require(
    MAKES_DECISION.test(source) || delegated,
    `${path}: protected surface resolves an actor but never decides with it`,
  );
  authorized += 1;
}

// 3. A stale exception is how a surface silently loses its check years later.
for (const entry of PUBLIC_SURFACES) {
  require(
    seenPublic.has(entry.path),
    `${entry.path}: declared public but is not a server surface under ${PROTECTED_TREES.join(", ")}`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`AUTHORIZATION_COVERAGE_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `AUTHORIZATION_COVERAGE_PASS surfaces=${surfaces.length} authorized=${authorized} public=${PUBLIC_SURFACES.length} delegates=${AUTHORIZATION_DELEGATES.length}`,
);
