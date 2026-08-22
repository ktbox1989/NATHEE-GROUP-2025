import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// A Server Component cannot write cookies. When one refreshes an expired access
// token, the rotated refresh token is computed and then thrown away, and the
// browser keeps a refresh token the provider has already consumed — so the next
// request cannot refresh at all and the person is signed out.
//
// The request proxy is the only place a refresh is persisted. Any surface that
// reads a session therefore has to be inside its matcher, and the failure mode
// if it is not is silent: it works for a fresh session and drops an idle one.
// That is not something to re-check by hand each time a page is added.

const root = process.env.SESSION_REFRESH_COVERAGE_ROOT
  ? resolve(process.env.SESSION_REFRESH_COVERAGE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

/** Anything that resolves a session from request cookies. */
const READS_SESSION =
  /\b(createSupabaseServerClient|createSupabaseRouteClient|getCurrentActor|requireActor)\s*\(/;

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

/** `app/api/users/[id]/route.ts` -> `/api/users/[id]` */
function routePathFor(file) {
  const withoutFile = file.replace(/\/(route\.ts|page\.tsx|layout\.tsx)$/, "");
  const path = withoutFile.replace(/^app/, "");
  return path === "" ? "/" : path;
}

/**
 * Converts the Next-style matcher entries this project uses into predicates.
 * Only `:param*` suffixes and literal paths appear here; anything else is
 * refused rather than silently treated as matching nothing.
 */
function matcherPredicate(pattern) {
  const wildcard = pattern.match(/^(.*)\/:[A-Za-z]+\*$/);
  if (wildcard) {
    const prefix = wildcard[1];
    return (path) => path === prefix || path.startsWith(`${prefix}/`);
  }
  if (/^\/[A-Za-z0-9\-_/[\]]*$/.test(pattern)) {
    return (path) => path === pattern;
  }
  return null;
}

const proxySource = await read("proxy.ts");

// The proxy must actually perform the refresh it exists for.
const proxyLib = await read("lib/supabase/proxy.ts");
require(
  /supabase\.auth\.(getClaims|getUser|getSession)\s*\(/.test(proxyLib),
  "lib/supabase/proxy.ts: the proxy must ask the auth client for the session, which is what triggers a refresh",
);
require(
  proxyLib.includes("response.cookies.set(name, value, options)"),
  "lib/supabase/proxy.ts: refreshed cookies must be written onto the response",
);
require(
  proxySource.includes("updateSession(request)"),
  "proxy.ts: the proxy must delegate to updateSession",
);

// A Server Component client must not pretend it can persist a refresh.
const serverClient = await read("lib/supabase/server.ts");
require(
  /catch\s*\{[\s\S]*?\}/.test(serverClient),
  "lib/supabase/server.ts: a Server Component cookie write must stay non-fatal",
);

const matcherBlock = proxySource.slice(proxySource.indexOf("matcher: ["));
const patterns = [...matcherBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
require(patterns.length > 0, "proxy.ts: no matcher entries were found; the scan is misconfigured");

const predicates = [];
for (const pattern of patterns) {
  const predicate = matcherPredicate(pattern);
  require(predicate !== null, `proxy.ts: matcher entry '${pattern}' is not a shape this check understands`);
  if (predicate) predicates.push({ pattern, predicate });
}

const surfaces = (await walk("app")).map((path) => path.split(sep).join("/")).sort();
require(surfaces.length > 0, "no server surfaces were found; the scan is misconfigured");

let covered = 0;
const readers = [];
for (const file of surfaces) {
  const source = await read(file);
  if (!READS_SESSION.test(source)) continue;
  const routePath = routePathFor(file);
  readers.push(routePath);
  const matched = predicates.some(({ predicate }) => predicate(routePath));
  require(
    matched,
    `${file}: reads a session at ${routePath} but the proxy matcher does not cover it, so an idle session is dropped instead of refreshed`,
  );
  if (matched) covered += 1;
}
require(readers.length > 0, "no session readers were found; the scan is misconfigured");

// A matcher entry that covers nothing is either a typo or a leftover.
for (const { pattern, predicate } of predicates) {
  require(
    readers.some((routePath) => predicate(routePath)),
    `proxy.ts: matcher entry '${pattern}' covers no session reader`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`SESSION_REFRESH_COVERAGE_FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `SESSION_REFRESH_COVERAGE_PASS sessionReaders=${readers.length} covered=${covered} matcherEntries=${patterns.length}`,
);
