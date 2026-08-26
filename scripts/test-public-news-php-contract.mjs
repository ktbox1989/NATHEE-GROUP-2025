import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");
const [gateway, newsEntry, mediaEntry, sitemapEntry, htaccess] = await Promise.all([
  read("public-site/_nathee/news-gateway.php"),
  read("public-site/news/index.php"),
  read("public-site/assets/media/index.php"),
  read("public-site/sitemap.php"),
  read("public-site/.htaccess"),
]);

for (const token of [
  "const NATHEE_NEWS_UPSTREAM_ORIGIN = 'https://app.natheegroup2025.com';",
  "const NATHEE_NEWS_LIST_PATH = '/api/public/v1/news';",
  "CURLOPT_SSL_VERIFYPEER => true",
  "CURLOPT_SSL_VERIFYHOST => 2",
  "CURLOPT_CONNECTTIMEOUT_MS",
  "CURLOPT_TIMEOUT_MS",
  "CURLOPT_WRITEFUNCTION",
  "NATHEE_NEWS_JSON_MAX_BYTES",
  "NATHEE_MEDIA_MAX_BYTES",
]) {
  if (!gateway.includes(token)) throw new Error(`PHP News gateway safety token missing: ${token}`);
}

for (const forbidden of [
  /\$_COOKIE/,
  /HTTP_AUTHORIZATION/,
  /HTTP_X_FORWARDED/i,
  /CURLOPT_FOLLOWLOCATION\s*=>\s*true/,
  /CURLOPT_SSL_VERIFYPEER\s*=>\s*false/,
  /CURLOPT_SSL_VERIFYHOST\s*=>\s*0/,
  /\$_(?:GET|POST)\[["'](?:url|host|upstream)["']\]/i,
]) {
  if (forbidden.test(gateway)) throw new Error(`PHP News gateway contains forbidden visitor/upstream behavior: ${forbidden}`);
}

for (const file of [gateway, newsEntry, mediaEntry, sitemapEntry, htaccess]) {
  if (/\bProxyPass\b|SSLProxyEngine|\[P(?:,|\])/i.test(file)) throw new Error("PHP News release must not depend on mod_proxy or RewriteRule [P].");
  if (/\/_next\/static/i.test(file)) throw new Error("PHP News release must not depend on Next static assets.");
}

for (const rule of [
  "RewriteRule ^news/?$ news/index.php [L]",
  "RewriteRule ^news/[a-z0-9]+(?:-[a-z0-9]+)*/?$ news/index.php [L]",
  "RewriteRule ^sitemap\\.xml$ sitemap.php [L]",
  "RewriteRule ^assets/media/",
]) {
  if (!htaccess.includes(rule)) throw new Error(`Local PHP routing rule missing: ${rule}`);
}

if (!gateway.includes("/assets/media/") || gateway.includes("/api/images/")) {
  throw new Error("PHP News media path must use only the canonical public media grammar.");
}
if (!gateway.includes("nathee_news_slug") || !gateway.includes("rawurldecode")) {
  throw new Error("PHP News route must validate slugs and encoded paths before upstream access.");
}
if (!gateway.includes("NATHEE_STATIC_SITEMAP_PATHS") || !gateway.includes("['robots'] !== 'INDEX'")) {
  throw new Error("PHP sitemap must preserve static routes and include only indexable published News.");
}
if (!gateway.includes("ยังไม่มีข่าวสารเผยแพร่") || /ตัวอย่างข่าว|Lorem ipsum/i.test(gateway)) {
  throw new Error("PHP News empty state must be real and contain no fabricated article.");
}

console.log("PUBLIC_NEWS_PHP_CONTRACT_PASS fixedOrigin=yes localRouting=yes modProxy=no nextStatic=no publicMedia=narrow sitemap=published-only");
