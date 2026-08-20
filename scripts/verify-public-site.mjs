import { readFile, readdir, lstat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = resolve(process.argv[2] ?? join(repositoryRoot, "public-site"));

const requiredFiles = [
  ".htaccess",
  "index.html",
  "login-status.html",
  "404.html",
  "favicon.svg",
  "robots.txt",
  "sitemap.xml",
  "assets/site.css",
  "assets/site.js",
];

const forbiddenPatterns = [
  ["wrong canonical hostname", /https:\/\/nateegroup2025\.com/i],
  ["placeholder phone", /02-000-0000/i],
  ["unverified LINE ID", /@natheegroup/i],
  ["fictional company", /ABC MOTOR/i],
  ["prototype quote store", /nathee-quotes|window\.storage|localStorage/i],
  ["demo credentials", /abc123|owner123|staff123|nathee2025/i],
  ["unverified statistics", /10\+\s*ปี|1,000\+|10,000\+/i],
  ["WordPress rewrite", /RewriteRule[^\n]*index\.php/i],
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in public-site: ${relative(siteRoot, path)}`);
    }
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

for (const file of requiredFiles) {
  const path = join(siteRoot, file);
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile()) throw new Error(`Required public-site file is missing: ${file}`);
}

const files = await listFiles(siteRoot);
const deployableText = new Map();
for (const file of files) {
  const extension = extname(file).toLowerCase();
  if (["", ".html", ".css", ".js", ".txt", ".xml", ".svg"].includes(extension)) {
    deployableText.set(relative(siteRoot, file).replaceAll("\\", "/"), await readFile(file, "utf8"));
  }
}

for (const [label, pattern] of forbiddenPatterns) {
  for (const [file, content] of deployableText) {
    if (pattern.test(content)) throw new Error(`${label} found in ${file}`);
  }
}

const home = deployableText.get("index.html");
const loginStatus = deployableText.get("login-status.html");
const notFound = deployableText.get("404.html");
const htaccess = deployableText.get(".htaccess");
const robots = deployableText.get("robots.txt");
const sitemap = deployableText.get("sitemap.xml");

const homeRequirements = [
  '<link rel="canonical" href="https://natheegroup2025.com/">',
  '<meta property="og:url" content="https://natheegroup2025.com/">',
  '<meta property="og:title"',
  '<meta property="og:description"',
  '<meta name="twitter:card" content="summary">',
  '<meta name="twitter:title"',
  '<meta name="twitter:description"',
  '<link rel="alternate" hreflang="th-TH" href="https://natheegroup2025.com/">',
  '<link rel="alternate" hreflang="x-default" href="https://natheegroup2025.com/">',
  'href="tel:0631941191"',
  'href="tel:0856802082"',
  'href="login-status.html"',
  'href="#quotation"',
  'LINE Official',
  'อยู่ระหว่างอัปเดต',
];
for (const requirement of homeRequirements) {
  if (!home.includes(requirement)) throw new Error(`Homepage contract missing: ${requirement}`);
}
if (/<form\b/i.test(home)) throw new Error("Public site must not expose a fake quotation form.");
if (/type=["']password["']/i.test(home)) throw new Error("Public site must not expose prototype login fields.");

const canonicalCount = (home.match(/<link\s+rel=["']canonical["']/gi) ?? []).length;
if (canonicalCount !== 1) throw new Error(`Homepage must contain exactly one canonical URL; found ${canonicalCount}.`);
if (!/<html\s+lang=["']th["']/i.test(home)) throw new Error("Homepage language must be Thai.");
if ((home.match(/<h1\b/gi) ?? []).length !== 1) throw new Error("Homepage must contain exactly one H1.");

const jsonLdMatches = [...home.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)];
if (jsonLdMatches.length !== 1) throw new Error(`Homepage must contain exactly one JSON-LD block; found ${jsonLdMatches.length}.`);
let organization;
try {
  organization = JSON.parse(jsonLdMatches[0][1]);
} catch {
  throw new Error("Homepage JSON-LD is not valid JSON.");
}
if (
  organization?.["@context"] !== "https://schema.org" ||
  organization?.["@type"] !== "Organization" ||
  organization?.name !== "บริษัท นทีกรุ๊ป2025 จำกัด" ||
  organization?.url !== "https://natheegroup2025.com/" ||
  !Array.isArray(organization?.telephone) ||
  organization.telephone.length !== 2
) {
  throw new Error("Homepage Organization structured data is incomplete or non-canonical.");
}

for (const [fileName, html] of deployableText) {
  if (extname(fileName) !== ".html") continue;
  for (const image of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt=["'][^"']*["']/i.test(image[0])) {
      throw new Error(`Image is missing alt text in ${fileName}: ${image[0]}`);
    }
  }
}

if (!loginStatus.includes('<meta name="robots" content="noindex,nofollow,noarchive">')) {
  throw new Error("Login status page must be noindex, nofollow, and noarchive.");
}
if (!notFound.includes('<meta name="robots" content="noindex,nofollow,noarchive">')) {
  throw new Error("404 page must be noindex, nofollow, and noarchive.");
}

for (const requirement of [
  "DirectoryIndex index.html",
  "ErrorDocument 404 /404.html",
  "^www\\.natheegroup2025\\.com$",
  "X-Content-Type-Options",
  "Content-Security-Policy",
  "Strict-Transport-Security",
  'X-Robots-Tag "noindex, nofollow, noarchive"',
]) {
  if (!htaccess.includes(requirement)) throw new Error(`.htaccess contract missing: ${requirement}`);
}

if (!robots.includes("https://natheegroup2025.com/sitemap.xml")) {
  throw new Error("robots.txt points to the wrong sitemap URL.");
}
for (const privatePath of ["/login-status.html", "/auth/", "/app/", "/api/"]) {
  if (!robots.includes(`Disallow: ${privatePath}`)) {
    throw new Error(`robots.txt does not exclude private path: ${privatePath}`);
  }
}
if (!sitemap.includes("<loc>https://natheegroup2025.com/</loc>")) {
  throw new Error("sitemap.xml points to the wrong canonical URL.");
}
if (/login-status|\/auth\/|\/app\/|\/api\//i.test(sitemap)) {
  throw new Error("sitemap.xml exposes a private or noindex route.");
}

const byteBudgets = new Map([
  ["index.html", 40 * 1024],
  ["assets/site.css", 32 * 1024],
  ["assets/site.js", 8 * 1024],
]);
let criticalBytes = 0;
for (const [fileName, budget] of byteBudgets) {
  const content = deployableText.get(fileName);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > budget) throw new Error(`${fileName} exceeds its mobile byte budget: ${bytes} > ${budget}.`);
  criticalBytes += bytes;
}
if (criticalBytes > 80 * 1024) {
  throw new Error(`Critical public-site payload exceeds mobile byte budget: ${criticalBytes} > ${80 * 1024}.`);
}
if (!home.includes('<meta name="viewport" content="width=device-width, initial-scale=1">')) {
  throw new Error("Homepage mobile viewport metadata is missing.");
}
if (!home.includes('<script src="assets/site.js" defer></script>')) {
  throw new Error("Homepage JavaScript must load with defer.");
}
const siteCss = deployableText.get("assets/site.css");
if (!siteCss.includes("@media (max-width: 980px)") || !siteCss.includes("@media (max-width: 680px)")) {
  throw new Error("Public stylesheet is missing required tablet/mobile breakpoints.");
}

const localReferencePattern = /(?:href|src)=["']([^"']+)["']/g;
for (const [name, content] of deployableText) {
  if (extname(name) !== ".html") continue;
  for (const match of content.matchAll(localReferencePattern)) {
    const reference = match[1].split("#", 1)[0];
    if (!reference || /^(?:https?:|tel:|mailto:|data:)/i.test(reference)) continue;
    const target = resolve(siteRoot, reference);
    if (!target.startsWith(`${siteRoot}${sep}`) && target !== siteRoot) {
      throw new Error(`Reference escapes public-site in ${name}: ${reference}`);
    }
    const info = await lstat(target).catch(() => null);
    if (!info?.isFile()) throw new Error(`Broken local reference in ${name}: ${reference}`);
  }
}

console.log(`PUBLIC_SITE_VERIFY_PASS files=${files.length} textFiles=${deployableText.size}`);
console.log(`PUBLIC_SEO_VERIFY_PASS canonical=1 jsonld=Organization noindex=verified sitemap=public-only images=alt-checked`);
console.log(`PUBLIC_MOBILE_PERFORMANCE_PASS criticalBytes=${criticalBytes} budget=${80 * 1024} javascript=defer breakpoints=980,680`);
