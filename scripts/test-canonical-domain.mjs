import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Two origins, deliberately. The public marketing website is the apex; the
// application has its own subdomain because it holds authenticated sessions and
// private media, and must not share an origin with a static document root that
// a deploy script overwrites by file copy.
const canonicalDomain = "natheegroup2025.com";
const canonicalUrl = `https://${canonicalDomain}`;
const applicationOrigin = `https://app.${canonicalDomain}`;
const applicationCallback = `${applicationOrigin}/auth/callback`;
const wrongDomain = ["natee", "group2025.com"].join("");
const productionRoot = `/home/zptqqwps/public_html/${canonicalDomain}`;
const ignored = new Set([".git", ".next", ".vinext", ".wrangler", "dist", "node_modules", "outputs"]);
const textExtensions = new Set(["", ".css", ".html", ".js", ".json", ".md", ".mjs", ".sh", ".svg", ".ts", ".tsx", ".txt", ".xml", ".yml", ".yaml"]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    if (entry.isFile() && textExtensions.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

const files = await walk(root);
for (const file of files) {
  const content = await readFile(file, "utf8");
  if (content.toLowerCase().includes(wrongDomain)) throw new Error(`Canonical domain typo found in ${relative(root, file)}`);
}

const contracts = new Map([
  ["public-site/index.html", `${canonicalUrl}/`],
  ["public-site/.htaccess", `https://${canonicalDomain}`],
  ["public-site/robots.txt", `${canonicalUrl}/sitemap.xml`],
  ["public-site/sitemap.xml", `${canonicalUrl}/`],
  ["scripts/deploy-zcom.sh", productionRoot],
  ["scripts/rollback-zcom.sh", productionRoot],
  ["scripts/postcheck-production.sh", canonicalDomain],
  ["scripts/build-public-site.mjs", canonicalUrl],
  // Application origin, not the public apex.
  ["docs/AUTH_SETUP.md", applicationCallback],
  ["docs/PRODUCTION_GO_LIVE.md", applicationCallback],
  [".env.example", applicationCallback],
]);
for (const [name, expected] of contracts) {
  const content = await readFile(join(root, name), "utf8");
  if (!content.includes(expected)) throw new Error(`Canonical domain contract missing from ${name}: ${expected}`);
}

// The apex callback is the value this project used before the application was
// given its own origin. It must not come back: an Auth callback on the public
// document root would put session cookies in the static site's scope.
const applicationFiles = ["docs/AUTH_SETUP.md", "docs/PRODUCTION_GO_LIVE.md", ".env.example", "lib/app-origin.ts"];
// Line-agnostic: a checkout on Windows holds CRLF, and a check anchored to a
// newline would silently match nothing there while passing here.
const apexApplicationValues = [`APP_ORIGIN=${canonicalUrl}`, `Site URL: ${canonicalUrl}`, `Callback: ${canonicalUrl}/auth/callback`];
for (const name of applicationFiles) {
  const content = await readFile(join(root, name), "utf8");
  for (const forbidden of apexApplicationValues) {
    // `endsWith` on the line, not the file, so `https://app.<domain>` never
    // matches `https://<domain>` by being a longer string that contains it.
    const lines = content.split("\n").map((line) => line.trimEnd());
    if (lines.some((line) => line.includes(forbidden) && !line.includes(`https://app.${canonicalDomain}`))) {
      throw new Error(`Application origin must not be the public apex in ${name}: ${forbidden}`);
    }
  }
}

console.log(`CANONICAL_DOMAIN_GUARD_PASS publicDomain=${canonicalDomain} applicationOrigin=${applicationOrigin} filesScanned=${files.length} productionRoot=locked authCallback=locked`);
