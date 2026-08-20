import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalDomain = "natheegroup2025.com";
const canonicalUrl = `https://${canonicalDomain}`;
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
  ["docs/AUTH_SETUP.md", `${canonicalUrl}/auth/callback`],
  ["docs/PRODUCTION_GO_LIVE.md", `${canonicalUrl}/auth/callback`],
  [".env.example", `${canonicalUrl}/auth/callback`],
]);
for (const [name, expected] of contracts) {
  const content = await readFile(join(root, name), "utf8");
  if (!content.includes(expected)) throw new Error(`Canonical domain contract missing from ${name}: ${expected}`);
}

console.log(`CANONICAL_DOMAIN_GUARD_PASS domain=${canonicalDomain} filesScanned=${files.length} productionRoot=locked authCallback=locked`);
